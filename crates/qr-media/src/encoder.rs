//! Deteksi encoder hardware, fallback libx264, dan pipa ekspor MP4 (PRD EXP-1..2, ADR S4, A1-10, A1-11).
//! Mengacu ke docs/product/PRD.md §7 EXP-1..2 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.1.

use serde::{Deserialize, Serialize};

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

/// Mendeteksi ketersediaan encoder pada sistem operasi saat ini.
pub fn probe_available_encoders() -> Vec<VideoEncoder> {
    let mut encoders = Vec::new();

    // 1. Deteksi hardware encoder berdasarkan platform
    #[cfg(target_os = "macos")]
    {
        encoders.push(VideoEncoder::Hardware(HwEncoderKind::VideoToolbox));
    }

    #[cfg(target_os = "windows")]
    {
        // Di Windows, probe NVENC / QSV / AMF jika driver tersedia
        encoders.push(VideoEncoder::Hardware(HwEncoderKind::Nvenc));
        encoders.push(VideoEncoder::Hardware(HwEncoderKind::Qsv));
        encoders.push(VideoEncoder::Hardware(HwEncoderKind::Amf));
    }

    #[cfg(target_os = "linux")]
    {
        // Di Linux, probe NVENC / QSV
        encoders.push(VideoEncoder::Hardware(HwEncoderKind::Nvenc));
        encoders.push(VideoEncoder::Hardware(HwEncoderKind::Qsv));
    }

    // 2. Fallback universal software (libx264 selalu ada sebagai jaminan)
    encoders.push(VideoEncoder::SoftwareLibx264);

    encoders
}

/// Menentukan encoder terbaik: memilih hardware jika diminta/tersedia, atau fallback ke libx264 (EXP-2).
pub fn select_best_encoder(config: &Mp4ExportConfig) -> VideoEncoder {
    let available = probe_available_encoders();

    if let Some(preferred) = &config.preferred_encoder {
        if available.contains(preferred) {
            return preferred.clone();
        }
    }

    // Pilih encoder hardware pertama yang tersedia, jika tidak ada fallback ke libx264
    for enc in &available {
        if let VideoEncoder::Hardware(_) = enc {
            return enc.clone();
        }
    }

    VideoEncoder::SoftwareLibx264
}

/// Menyusun argumen perintah FFmpeg untuk ekspor MP4 dari pipa rawvideo stdin (A1-10).
pub fn build_ffmpeg_export_args(
    config: &Mp4ExportConfig,
    encoder: &VideoEncoder,
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
        "-".into(), // Baca frame dari stdin
    ];

    // Video codec
    args.push("-c:v".into());
    args.push(encoder.ffmpeg_codec_name().into());

    // Bitrate dan preset
    args.push("-b:v".into());
    args.push(format!("{}k", config.video_bitrate_kbps));
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());

    if *encoder == VideoEncoder::SoftwareLibx264 {
        args.push("-preset".into());
        args.push("medium".into());
    }

    // Output path
    args.push(output_path.into());

    args
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
    fn test_encoder_probing_always_includes_software_libx264() {
        let encoders = probe_available_encoders();
        assert!(!encoders.is_empty());
        assert!(encoders.contains(&VideoEncoder::SoftwareLibx264));
    }

    #[test]
    fn test_ffmpeg_args_generation() {
        let config = Mp4ExportConfig {
            width: 1080,
            height: 1920,
            fps: 30,
            video_bitrate_kbps: 6000,
            audio_sample_rate: 48000,
            audio_bitrate_kbps: 192,
            preferred_encoder: Some(VideoEncoder::SoftwareLibx264),
        };

        let encoder = select_best_encoder(&config);
        let args = build_ffmpeg_export_args(&config, &encoder, "/tmp/out.mp4");

        assert!(args.contains(&"-pix_fmt".into()));
        assert!(args.contains(&"1080x1920".into()));
        assert!(args.contains(&"/tmp/out.mp4".into()));
    }

    #[test]
    fn test_frame_equivalence_passes_within_tolerance() {
        let preview = vec![100u8, 150, 200, 255];
        let export_close = vec![101u8, 149, 202, 255]; // Selisih maks 2
        let export_divergent = vec![100u8, 150, 215, 255]; // Selisih 15 > toleransi 2

        assert!(check_frame_equivalence(&preview, &export_close, 2).is_ok());
        assert!(check_frame_equivalence(&preview, &export_divergent, 2).is_err());
    }
}
