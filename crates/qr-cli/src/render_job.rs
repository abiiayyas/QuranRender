//! Job render nyata: proyek + dataset → frame (renderer Rust yang sama dengan preview) → FFmpeg → MP4.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::background::BackgroundPlan;
use qr_media::{
    export_mp4, rgba_to_yuv420_bt709, ExportError, Mp4ExportConfig, RawFrameFormat, VideoEncoder,
};
use qr_render::{
    load_builtin_template, FontSet, Pixmap, SceneBuilder, SoftwareRenderer, VerseSource,
};
use serde::Deserialize;

/// Tick proyek = sampel pada 48 kHz.
const TICKS_PER_SECOND: i64 = 48_000;

#[derive(Debug, Clone, Deserialize)]
pub struct RenderPayload {
    /// Folder proyek (`*.qrproj`) berisi `project.json`.
    pub project_dir: PathBuf,
    pub output_path: PathBuf,
    #[serde(default)]
    pub audio_path: Option<PathBuf>,
    /// Akar sumber daya (font, template). Default: `QR_RESOURCES_DIR` atau akar repositori (mode dev).
    #[serde(default)]
    pub resources_dir: Option<PathBuf>,
    /// Lebar keluaran (rasio kanvas dipertahankan). Default: lebar kanvas proyek.
    #[serde(default)]
    pub width: Option<u32>,
    /// Batasi durasi ekspor (detik); untuk uji/cuplikan.
    #[serde(default)]
    pub max_seconds: Option<f64>,
    #[serde(default)]
    pub ffmpeg_bin: Option<String>,
    /// Izinkan menimpa berkas keluaran yang sudah ada. Default `false` (anti-timpa, EXP-5).
    #[serde(default)]
    pub overwrite: bool,
    /// Jumlah thread render frame. Default: jumlah inti (maks 8, batas memori buffer frame).
    #[serde(default)]
    pub threads: Option<usize>,
    /// Paksa libx264 (`"libx264"`); default: encoder terbaik (hardware bila ada). Nilai lain ditolak.
    #[serde(default)]
    pub encoder: Option<String>,
    /// Kualitas konstan libx264 (`-crf`, 0 = lossless); menggantikan bitrate. Hanya untuk `encoder = "libx264"`.
    #[serde(default)]
    pub crf: Option<u8>,
}

#[derive(Debug)]
pub struct JobError {
    pub code: &'static str,
    pub message: String,
}

impl JobError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn default_resources_dir() -> PathBuf {
    std::env::var("QR_RESOURCES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

/// Menjalankan job render. `verses` menyuplai teks ayat/terjemahan (dataset terverifikasi di produksi).
/// Validasi pra-ekspor (`qr-policy`) memblokir proyek yang melanggar CNT-1/2/5 sebelum frame pertama.
pub fn run_render_job(
    payload: &RenderPayload,
    verses: &(dyn VerseSource + Sync),
    cancel: &AtomicBool,
    progress: impl FnMut(u64, u64),
) -> Result<ExportSummary, JobError> {
    if let Some(w) = payload.width {
        if !(64..=7680).contains(&w) {
            return Err(JobError::new(
                "INVALID_PAYLOAD",
                format!("Lebar keluaran {w} di luar rentang 64..7680"),
            ));
        }
    }
    if payload.output_path.exists() && !payload.overwrite {
        return Err(JobError::new(
            "OUTPUT_EXISTS",
            format!(
                "Berkas keluaran sudah ada: {} (gunakan nama lain atau izinkan menimpa)",
                payload.output_path.display()
            ),
        ));
    }
    if let Some(a) = &payload.audio_path {
        if !a.is_file() {
            return Err(JobError::new(
                "AUDIO_MISSING",
                format!("Berkas audio tidak ditemukan: {}", a.display()),
            ));
        }
    }
    if let Some(dir) = payload
        .output_path
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
    {
        std::fs::create_dir_all(dir).map_err(|e| {
            JobError::new(
                "OUTPUT_DIR",
                format!(
                    "Folder keluaran tidak dapat dibuat ({}): {e}",
                    dir.display()
                ),
            )
        })?;
    }
    let mut project = qr_core::load_project(&payload.project_dir)
        .map_err(|e| JobError::new("PROJECT_LOAD", e.to_string()))?;

    let report = qr_policy::validate_export_readiness(&project);
    if !report.is_ready {
        let first = report.violations.first();
        return Err(JobError::new(
            "EXPORT_BLOCKED",
            first
                .map(|v| format!("[{}] {}: {}", v.code, v.title, v.description))
                .unwrap_or_else(|| "Proyek diblokir oleh kebijakan konten".into()),
        ));
    }

    let resources = payload
        .resources_dir
        .clone()
        .unwrap_or_else(default_resources_dir);
    let fonts = FontSet::load(&resources.join("assets"))
        .map_err(|e| JobError::new("FONT_LOAD", e.to_string()))?;
    let tpl = load_builtin_template(&resources, &project.template_id)
        .map_err(|e| JobError::new("TEMPLATE_LOAD", e.to_string()))?;
    // Latar media (gambar/video); hilang/rusak ditolak lebih dulu oleh validasi aset (EXP-MISSING-ASSET).
    let background = BackgroundPlan::from_project(&project)
        .map_err(|e| JobError::new("BACKGROUND_FAILED", e))?;

    let (cw, ch) = (project.canvas.width.max(2), project.canvas.height.max(2));
    let width = payload.width.unwrap_or(cw).max(2) & !1; // yuv420p butuh dimensi genap
    let height = (((u64::from(ch) * u64::from(width)) / u64::from(cw)) as u32).max(2) & !1;
    project.canvas.width = width;
    project.canvas.height = height;

    let fps = (project.canvas.fps_num / project.canvas.fps_den.max(1)).max(1);
    let duration_ticks = project
        .segments
        .iter()
        .map(|s| s.end_tick)
        .max()
        .unwrap_or(0);
    let mut seconds = duration_ticks as f64 / TICKS_PER_SECOND as f64;
    if let Some(m) = payload.max_seconds {
        seconds = seconds.min(m);
    }
    let total_frames = (seconds * f64::from(fps)).ceil() as u64;
    if total_frames == 0 {
        return Err(JobError::new(
            "EMPTY_PROJECT",
            "Proyek tidak memiliki segmen untuk diekspor",
        ));
    }

    // Konteks sekali pakai: pastikan seluruh teks segmen (ayat atau teks khusus) ada sebelum FFmpeg.
    for s in &project.segments {
        if qr_render::segment_content(s, &project.translation_editions, verses).is_none() {
            return Err(JobError::new(
                "MISSING_VERSE",
                format!("Ayat {}:{} tidak ada di dataset", s.surah_id, s.ayah_number),
            ));
        }
    }

    // CNT-5: teks ayat harus muat di area aman pada ukuran minimum. Diuji pada tengah tiap segmen
    // sebelum FFmpeg dijalankan; ayat yang meluber harus dibagi per rentang kata.
    for s in &project.segments {
        let mid = (s.start_tick + s.end_tick) / 2;
        let scene = SceneBuilder::build(&project, &tpl, &fonts, mid, verses)
            .map_err(|e| JobError::new("RENDER_FAILED", e.to_string()))?;
        if scene.text_overflow {
            return Err(JobError::new(
                "CNT-5-OVERFLOW",
                format!(
                    "Teks ayat {}:{} beserta terjemahannya terlalu panjang untuk satu layar pada template '{}'. Bagi segmen per rentang kata atau potong terjemahannya.",
                    s.surah_id, s.ayah_number, project.template_id
                ),
            ));
        }
    }

    let preferred_encoder = match payload.encoder.as_deref() {
        None => None,
        Some("libx264") => Some(VideoEncoder::SoftwareLibx264),
        Some(other) => {
            return Err(JobError::new(
                "INVALID_PAYLOAD",
                format!("Encoder '{other}' tidak dikenal (hanya \"libx264\")"),
            ))
        }
    };
    if payload.crf.is_some() && preferred_encoder.is_none() {
        return Err(JobError::new(
            "INVALID_PAYLOAD",
            "crf hanya berlaku bersama encoder = \"libx264\"",
        ));
    }
    let config = Mp4ExportConfig {
        width,
        height,
        fps,
        preferred_encoder,
        crf: payload.crf,
        raw_format: RawFrameFormat::Yuv420p,
        ..Mp4ExportConfig::default()
    };
    let ffmpeg = payload
        .ffmpeg_bin
        .clone()
        .unwrap_or_else(|| "ffmpeg".into());
    let frame_ticks = |i: u64| -> i64 {
        (i as i64 * TICKS_PER_SECOND * i64::from(project.canvas.fps_den.max(1)))
            / i64::from(project.canvas.fps_num.max(1))
    };

    let threads = payload
        .threads
        .or_else(|| std::thread::available_parallelism().ok().map(usize::from))
        .unwrap_or(1)
        .clamp(1, 8);
    let render_one = |i: u64, bg: Option<Arc<Pixmap>>| -> Result<Vec<u8>, String> {
        let scene = SceneBuilder::build_with_background(
            &project,
            &tpl,
            &fonts,
            frame_ticks(i),
            verses,
            bg.as_ref(),
        )
        .map_err(|e| e.to_string())?;
        let pm = SoftwareRenderer::render(&scene, &fonts).map_err(|e| e.to_string())?;
        Ok(rgba_to_yuv420_bt709(pm.data(), width, height))
    };
    let (background_ref, ffmpeg_ref, ticks_ref) = (&background, &ffmpeg, &frame_ticks);
    // Frame independen: satu thread produsen merender `threads` frame sekaligus secara paralel dan
    // mengirimkannya berurutan lewat kanal berbatas, sehingga render tumpang tindih dengan penulisan
    // ke FFmpeg. Bila pemanggil mengulang dari frame lain (fallback encoder), produsen dimulai ulang.
    let render_ref = &render_one;
    let stats = std::thread::scope(|sc| {
        let mut rx: Option<std::sync::mpsc::Receiver<Result<Vec<u8>, String>>> = None;
        let mut next = 0u64;
        let render_frame = move |i: u64| -> Result<Vec<u8>, String> {
            if rx.is_none() || i != next {
                let (tx, r) = std::sync::mpsc::sync_channel(threads * 2);
                rx = Some(r); // receiver lama dilepas: produsen lama berhenti saat send gagal
                sc.spawn(move || {
                    // Frame latar diambil berurutan oleh produsen ini (satu aliran FFmpeg), lalu
                    // dibagikan ke render paralel per potongan.
                    let mut bg_frames = match background_ref {
                        Some(plan) => match plan.export_frames(ffmpeg_ref, width, height) {
                            Ok(f) => Some(f),
                            Err(e) => {
                                let _ = tx.send(Err(format!("Latar media gagal dimuat: {e}")));
                                return;
                            }
                        },
                        None => None,
                    };
                    let mut start = i;
                    while start < total_frames {
                        let end = (start + threads as u64).min(total_frames);
                        let mut inputs: Vec<(u64, Option<Arc<Pixmap>>)> = Vec::new();
                        for k in start..end {
                            let bg = match bg_frames.as_mut() {
                                Some(f) => match f.frame(ticks_ref(k)) {
                                    Ok(bg) => bg,
                                    Err(e) => {
                                        let _ = tx.send(Err(format!("Frame latar gagal: {e}")));
                                        return;
                                    }
                                },
                                None => None,
                            };
                            inputs.push((k, bg));
                        }
                        let chunk: Vec<Result<Vec<u8>, String>> = std::thread::scope(|inner| {
                            let handles: Vec<_> = inputs
                                .into_iter()
                                .map(|(k, bg)| inner.spawn(move || render_ref(k, bg)))
                                .collect();
                            handles
                                .into_iter()
                                .map(|h| {
                                    h.join()
                                        .unwrap_or_else(|_| Err("thread render panik".to_string()))
                                })
                                .collect()
                        });
                        for r in chunk {
                            if tx.send(r).is_err() {
                                return;
                            }
                        }
                        start = end;
                    }
                });
            }
            next = i + 1;
            match rx.as_ref() {
                Some(r) => r
                    .recv()
                    .map_err(|_| "produsen frame berhenti".to_string())?,
                None => Err("kanal frame tidak ada".to_string()),
            }
        };
        export_mp4(
            &ffmpeg,
            &config,
            payload.audio_path.as_deref(),
            &payload.output_path,
            total_frames,
            render_frame,
            progress,
            cancel,
        )
    })
    .map_err(|e| match e {
        ExportError::Cancelled => JobError::new("CANCELED", "Job dibatalkan oleh pengguna."),
        ExportError::FfmpegUnavailable(..) => JobError::new("FFMPEG_MISSING", e.to_string()),
        ExportError::EncoderFailed { .. } | ExportError::NoEncoder => {
            JobError::new("ENCODER_FAILED", e.to_string())
        }
        other => JobError::new("RENDER_FAILED", other.to_string()),
    })?;

    Ok(ExportSummary {
        output_path: payload.output_path.clone(),
        frames: stats.frames,
        encoder: stats.encoder.ffmpeg_codec_name().to_string(),
        fell_back_to_software: stats.fell_back_to_software,
    })
}

#[derive(Debug, Clone)]
pub struct ExportSummary {
    pub output_path: PathBuf,
    pub frames: u64,
    pub encoder: String,
    pub fell_back_to_software: bool,
}
