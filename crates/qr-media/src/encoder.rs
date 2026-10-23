//! Deteksi encoder hardware, fallback libx264, ekspor transparan, dan pola nama anti-timpa (PRD EXP-1..3, EXP-5, ADR S4, B2-09).
//! Mengacu ke docs/product/PRD.md §7 EXP-1..3, EXP-5 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.1.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HwEncoderKind {
    VideoToolbox,
    Nvenc,
    Qsv,
    Amf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoEncoder {
    Hardware(HwEncoderKind),
    SoftwareLibx264,
}

/// Format video dengan transparansi alpha channel (PRD EXP-3, B2-09).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransparentExportFormat {
    /// Apple ProRes 4444 dalam kontainer .mov (alpha straight 10-bit).
    ProRes4444Mov,
    /// WebM VP9 dengan alpha channel (yuva420p).
    WebmVp9,
    /// Urutan gambar PNG terpisah (frame_%05d.png).
    PngSequence,
}

impl VideoEncoder {
    pub fn ffmpeg_codec_name(&self) -> &'static str {
        match self {
            VideoEncoder::Hardware(HwEncoderKind::VideoToolbox) => "h264_videotoolbox",
            VideoEncoder::Hardware(HwEncoderKind::Nvenc) => "h264_nvenc",
            VideoEncoder::Hardware(HwEncoderKind::Qsv) => "h264_qsv",
            VideoEncoder::Hardware(HwEncoderKind::Amf) => "h264_amf",
            VideoEncoder::SoftwareLibx264 => "libx264",
        }
    }
}

/// Konfigurasi ekspor MP4 (H.264/AAC).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mp4ExportConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub video_bitrate_kbps: u32,
    pub audio_sample_rate: u32,
    pub audio_bitrate_kbps: u32,
    pub preferred_encoder: Option<VideoEncoder>,
}

impl Default for Mp4ExportConfig {
    fn default() -> Self {
        Self {
            width: 1080,
            height: 1920,
            fps: 30,
            video_bitrate_kbps: 8000,
            audio_sample_rate: 48000,
            audio_bitrate_kbps: 192,
            preferred_encoder: None,
        }
    }
}

/// Urutan preferensi encoder hardware H.264 per nama codec FFmpeg.
const HW_CANDIDATES: [(&str, HwEncoderKind); 4] = [
    ("h264_videotoolbox", HwEncoderKind::VideoToolbox),
    ("h264_nvenc", HwEncoderKind::Nvenc),
    ("h264_qsv", HwEncoderKind::Qsv),
    ("h264_amf", HwEncoderKind::Amf),
];

/// Mengurai keluaran `ffmpeg -hide_banner -encoders` menjadi encoder H.264 yang *terpasang* pada build ini.
/// Keberadaan di daftar belum menjamin perangkat kerasnya ada; kegagalan runtime ditangani fallback (EXP-2).
pub fn parse_ffmpeg_encoders(encoders_output: &str) -> Vec<VideoEncoder> {
    let names: Vec<&str> = encoders_output
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .collect();
    let mut out: Vec<VideoEncoder> = HW_CANDIDATES
        .iter()
        .filter(|(n, _)| names.contains(n))
        .map(|(_, k)| VideoEncoder::Hardware(*k))
        .collect();
    if names.contains(&"libx264") {
        out.push(VideoEncoder::SoftwareLibx264);
    }
    out
}

/// Menjalankan `ffmpeg -encoders` dan mengembalikan encoder H.264 yang tersedia.
pub fn probe_available_encoders(ffmpeg_bin: &str) -> std::io::Result<Vec<VideoEncoder>> {
    let out = std::process::Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-encoders"])
        .output()?;
    Ok(parse_ffmpeg_encoders(&String::from_utf8_lossy(&out.stdout)))
}

/// Memilih encoder: preferensi pengguna bila tersedia, lalu hardware pertama, lalu libx264 (EXP-2).
/// `None` bila tidak ada encoder H.264 sama sekali.
pub fn select_best_encoder(
    config: &Mp4ExportConfig,
    available: &[VideoEncoder],
) -> Option<VideoEncoder> {
    if let Some(preferred) = &config.preferred_encoder {
        if available.contains(preferred) {
            return Some(preferred.clone());
        }
    }
    available
        .iter()
        .find(|e| matches!(e, VideoEncoder::Hardware(_)))
        .or_else(|| {
            available
                .iter()
                .find(|e| **e == VideoEncoder::SoftwareLibx264)
        })
        .cloned()
}

/// Menyusun argumen FFmpeg untuk ekspor MP4 dari pipa rawvideo RGBA di stdin (A1-10).
/// Konversi RGB→YUV memakai matriks BT.709 rentang TV dan ditandai di metadata (tanpa ini swscale
/// memakai BT.601 dan warna bergeser). Audio (bila ada) di-mux sebagai AAC dan memotong ke yang terpendek.
pub fn build_ffmpeg_export_args(
    config: &Mp4ExportConfig,
    encoder: &VideoEncoder,
    audio_path: Option<&str>,
    output_path: &str,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect();
    args.extend(["-s".into(), format!("{}x{}", config.width, config.height)]);
    args.extend(["-r".into(), config.fps.to_string(), "-i".into(), "-".into()]);
    if let Some(a) = audio_path {
        args.extend(["-i".into(), a.into()]);
    }
    args.extend(["-map".into(), "0:v:0".into()]);
    if audio_path.is_some() {
        args.extend(["-map".into(), "1:a:0".into()]);
    }
    args.extend([
        "-vf".into(),
        "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p".into(),
        "-c:v".into(),
        encoder.ffmpeg_codec_name().into(),
        "-b:v".into(),
        format!("{}k", config.video_bitrate_kbps),
        "-colorspace".into(),
        "bt709".into(),
        "-color_primaries".into(),
        "bt709".into(),
        "-color_trc".into(),
        "bt709".into(),
        "-color_range".into(),
        "tv".into(),
    ]);
    if *encoder == VideoEncoder::SoftwareLibx264 {
        args.extend(["-preset".into(), "medium".into()]);
    }
    if audio_path.is_some() {
        args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            format!("{}k", config.audio_bitrate_kbps),
            "-ar".into(),
            config.audio_sample_rate.to_string(),
            "-shortest".into(),
        ]);
    }
    args.extend(["-movflags".into(), "+faststart".into(), output_path.into()]);
    args
}

/// Menyusun argumen FFmpeg untuk ekspor video transparan (PRD EXP-3, B2-09).
pub fn build_ffmpeg_transparent_export_args(
    config: &Mp4ExportConfig,
    format: TransparentExportFormat,
    output_path: &str,
) -> Vec<String> {
    let mut args = vec![
        "-y".into(),
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-s".into(),
        format!("{}x{}", config.width, config.height),
        "-r".into(),
        config.fps.to_string(),
        "-i".into(),
        "-".into(),
    ];

    match format {
        TransparentExportFormat::ProRes4444Mov => {
            args.push("-c:v".into());
            args.push("prores_ks".into());
            args.push("-profile:v".into());
            args.push("4".into()); // Profile 4 = 4444
            args.push("-pix_fmt".into());
            args.push("yuva444p10le".into());
        }
        TransparentExportFormat::WebmVp9 => {
            args.push("-c:v".into());
            args.push("libvpx-vp9".into());
            args.push("-pix_fmt".into());
            args.push("yuva420p".into());
            args.push("-b:v".into());
            args.push(format!("{}k", config.video_bitrate_kbps));
        }
        TransparentExportFormat::PngSequence => {
            args.push("-c:v".into());
            args.push("png".into());
            args.push("-pix_fmt".into());
            args.push("rgba".into());
        }
    }

    args.push(output_path.into());
    args
}

/// Menghasilkan path file unik agar tidak menimpa file yang sudah ada (PRD EXP-5, B2-10).
pub fn generate_unique_export_path(output_dir: &Path, base_name: &str, extension: &str) -> PathBuf {
    let sanitized = base_name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let ext = extension.trim_start_matches('.');

    let mut candidate = output_dir.join(format!("{}.{}", sanitized, ext));
    if !candidate.exists() {
        return candidate;
    }

    let mut counter = 1;
    loop {
        let new_name = format!("{} ({}).{}", sanitized, counter, ext);
        candidate = output_dir.join(new_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// Uji kesetaraan frame preview dan frame video ekspor (PRD §7.3, A1-11).
/// Memeriksa bahwa selisih maksimal per kanal warna <= tolerance (default 2/255).
pub fn check_frame_equivalence(
    preview_pixels: &[u8],
    export_pixels: &[u8],
    tolerance: u8,
) -> Result<(), String> {
    if preview_pixels.len() != export_pixels.len() {
        return Err(format!(
            "Ukuran buffer tidak sama: preview {} byte, export {} byte",
            preview_pixels.len(),
            export_pixels.len()
        ));
    }

    let mut max_diff: u8 = 0;
    let mut differing_pixels = 0usize;

    for (p, e) in preview_pixels.iter().zip(export_pixels.iter()) {
        let diff = (*p as i16 - *e as i16).unsigned_abs() as u8;
        if diff > max_diff {
            max_diff = diff;
        }
        if diff > tolerance {
            differing_pixels += 1;
        }
    }

    if differing_pixels > 0 {
        return Err(format!(
            "Kesetaraan preview-export gagal: {} pixel melampaui toleransi {}/255 (selisih terbesar: {}/255)",
            differing_pixels, tolerance, max_diff
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transparent_prores_args() {
        let config = Mp4ExportConfig::default();
        let args = build_ffmpeg_transparent_export_args(
            &config,
            TransparentExportFormat::ProRes4444Mov,
            "/tmp/out.mov",
        );

        assert!(args.contains(&"prores_ks".into()));
        assert!(args.contains(&"yuva444p10le".into()));
    }

    #[test]
    fn test_transparent_webm_vp9_args() {
        let config = Mp4ExportConfig::default();
        let args = build_ffmpeg_transparent_export_args(
            &config,
            TransparentExportFormat::WebmVp9,
            "/tmp/out.webm",
        );

        assert!(args.contains(&"libvpx-vp9".into()));
        assert!(args.contains(&"yuva420p".into()));
    }

    #[test]
    fn test_anti_collision_filepath_generation() {
        let temp_dir = std::env::temp_dir();
        let base = "Al-Fatihah_1-7";

        // Buat file dummy pertama
        let f1 = temp_dir.join(format!("{}.mp4", base));
        let _ = std::fs::write(&f1, b"dummy1");

        let unique = generate_unique_export_path(&temp_dir, base, "mp4");
        assert_eq!(unique, temp_dir.join(format!("{} (1).mp4", base)));

        // Hapus file uji
        let _ = std::fs::remove_file(f1);
    }
}
