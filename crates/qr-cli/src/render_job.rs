//! Job render nyata: proyek + dataset → frame (renderer Rust yang sama dengan preview) → FFmpeg → MP4.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use qr_media::{export_mp4, ExportError, Mp4ExportConfig};
use qr_render::{load_builtin_template, FontSet, SceneBuilder, SoftwareRenderer, VerseSource};
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
    verses: &dyn VerseSource,
    cancel: &AtomicBool,
    progress: impl FnMut(u64, u64),
) -> Result<ExportSummary, JobError> {
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

    // Konteks sekali pakai: pastikan seluruh ayat ada sebelum menjalankan FFmpeg.
    for s in &project.segments {
        if verses.verse(s.surah_id, s.ayah_number).is_none() {
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
                    "Teks ayat {}:{} terlalu panjang untuk satu layar pada template '{}'. Bagi segmen per rentang kata.",
                    s.surah_id, s.ayah_number, project.template_id
                ),
            ));
        }
    }

    let config = Mp4ExportConfig {
        width,
        height,
        fps,
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

    let stats = export_mp4(
        &ffmpeg,
        &config,
        payload.audio_path.as_deref(),
        &payload.output_path,
        total_frames,
        |i| {
            let scene = SceneBuilder::build(&project, &tpl, &fonts, frame_ticks(i), verses)
                .map_err(|e| e.to_string())?;
            let pm = SoftwareRenderer::render(&scene, &fonts).map_err(|e| e.to_string())?;
            Ok(pm.data().to_vec())
        },
        progress,
        cancel,
    )
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
