//! Media probe & ekstraksi metadata untuk impor audio dan video (PRD SRC-1).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.2 dan 04_IMPLEMENTATION_PLAN.md A1-04.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::clock::SAMPLE_RATE;

#[derive(Error, Debug)]
pub enum MediaError {
    #[error("File media tidak ditemukan: {0:?}")]
    FileNotFound(PathBuf),
    #[error("Format file tidak didukung: '{0}' (didukung: mp3, m4a, aac, wav, flac, ogg, opus, mp4, mov, mkv, webm)")]
    UnsupportedFormat(String),
    #[error("Gagal mendeteksi informasi media: {0}")]
    ProbeFailed(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaMetadata {
    pub path: PathBuf,
    pub format_name: String,
    pub duration_sec: f64,
    pub duration_ticks: i64,
    pub sample_rate: u32,
    pub channels: u16,
    pub has_video: bool,
    pub video_width: Option<u32>,
    pub video_height: Option<u32>,
    pub video_fps: Option<f64>,
    pub file_size_bytes: u64,
}

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "mp4", "mov", "mkv", "webm",
];

/// Memeriksa apakah ekstensi file termasuk format media yang didukung aplikasi.
pub fn is_supported_media_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Melakukan probe berkas audio atau video untuk mengekstrak metadata penting.
pub fn probe_media(path: &Path) -> Result<MediaMetadata, MediaError> {
    if !path.exists() {
        return Err(MediaError::FileNotFound(path.to_path_buf()));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(MediaError::UnsupportedFormat(ext));
    }

    let metadata = fs::metadata(path)?;
    let file_size_bytes = metadata.len();

    let has_video = matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "webm");

    // Simulasi estimasi metadata dari header container (akan digantikan libav probe saat runtime penuh)
    let estimated_duration_sec = 60.0;
    let duration_ticks = ((estimated_duration_sec * (SAMPLE_RATE as f64)).floor()) as i64;

    Ok(MediaMetadata {
        path: path.to_path_buf(),
        format_name: ext,
        duration_sec: estimated_duration_sec,
        duration_ticks,
        sample_rate: SAMPLE_RATE,
        channels: 2,
        has_video,
        video_width: if has_video { Some(1080) } else { None },
        video_height: if has_video { Some(1920) } else { None },
        video_fps: if has_video { Some(30.0) } else { None },
        file_size_bytes,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_extensions() {
        assert!(is_supported_media_extension(Path::new("recitation.m4a")));
        assert!(is_supported_media_extension(Path::new("video.mp4")));
        assert!(is_supported_media_extension(Path::new("audio.wav")));
        assert!(!is_supported_media_extension(Path::new("document.pdf")));
        assert!(!is_supported_media_extension(Path::new("script.py")));
    }
}
