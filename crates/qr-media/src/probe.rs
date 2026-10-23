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

/// Parsing pecahan "30000/1001" → 29.97.
fn parse_rate(r: &str) -> Option<f64> {
    let (n, d) = r.split_once('/')?;
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    (d > 0.0 && n > 0.0).then(|| n / d)
}

/// Mengubah keluaran JSON `ffprobe` menjadi `MediaMetadata`. Gagal bila tidak ada stream audio/video
/// atau durasi tidak dapat ditentukan: tidak pernah menebak nilai.
pub fn parse_ffprobe_json(
    path: &Path,
    json: &str,
    file_size_bytes: u64,
) -> Result<MediaMetadata, MediaError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| MediaError::ProbeFailed(format!("keluaran ffprobe bukan JSON: {e}")))?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let audio = streams.iter().find(|s| s["codec_type"] == "audio");
    // Cover art (mp3/m4a) dilaporkan sebagai stream video dengan disposition attached_pic.
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    if audio.is_none() && video.is_none() {
        return Err(MediaError::ProbeFailed(
            "tidak ada stream audio/video".into(),
        ));
    }
    let duration_sec = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or_else(|| MediaError::ProbeFailed("durasi tidak dapat ditentukan".into()))?;
    let sample_rate = audio
        .and_then(|a| a["sample_rate"].as_str())
        .and_then(|r| r.parse::<u32>().ok())
        .unwrap_or(0);
    let channels = audio
        .and_then(|a| a["channels"].as_u64())
        .map_or(0, |c| c as u16);
    Ok(MediaMetadata {
        path: path.to_path_buf(),
        format_name: v["format"]["format_name"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        duration_sec,
        duration_ticks: (duration_sec * f64::from(SAMPLE_RATE)).round() as i64,
        sample_rate,
        channels,
        has_video: video.is_some(),
        video_width: video.and_then(|s| s["width"].as_u64()).map(|w| w as u32),
        video_height: video.and_then(|s| s["height"].as_u64()).map(|h| h as u32),
        video_fps: video
            .and_then(|s| s["avg_frame_rate"].as_str())
            .and_then(parse_rate),
        file_size_bytes,
    })
}

/// Probe berkas audio/video dengan `ffprobe` (dari PATH).
pub fn probe_media(path: &Path) -> Result<MediaMetadata, MediaError> {
    probe_media_with("ffprobe", path)
}

/// Probe dengan biner `ffprobe` tertentu (mis. yang dibundel bersama aplikasi).
pub fn probe_media_with(ffprobe_bin: &str, path: &Path) -> Result<MediaMetadata, MediaError> {
    if !path.exists() {
        return Err(MediaError::FileNotFound(path.to_path_buf()));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(MediaError::UnsupportedFormat(ext));
    }
    let out = std::process::Command::new(ffprobe_bin)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|e| MediaError::ProbeFailed(format!("ffprobe tidak dapat dijalankan: {e}")))?;
    if !out.status.success() {
        return Err(MediaError::ProbeFailed(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    parse_ffprobe_json(
        path,
        &String::from_utf8_lossy(&out.stdout),
        fs::metadata(path)?.len(),
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("qr_probe_{}_{name}", std::process::id()))
    }

    fn gen(args: &[&str], out: &Path) {
        let st = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-y"])
            .args(args)
            .arg(out)
            .status()
            .unwrap();
        assert!(st.success(), "ffmpeg wajib ada untuk uji probe");
    }

    #[test]
    fn test_supported_extensions() {
        assert!(is_supported_media_extension(Path::new("a.MP3")));
        assert!(!is_supported_media_extension(Path::new("a.txt")));
    }

    #[test]
    fn probes_real_audio_file_duration_rate_and_channels() {
        let f = tmp("a.wav");
        gen(
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2.5",
                "-ar",
                "44100",
                "-ac",
                "2",
            ],
            &f,
        );
        let m = probe_media(&f).unwrap();
        assert!(
            (m.duration_sec - 2.5).abs() < 0.05,
            "durasi {}",
            m.duration_sec
        );
        assert_eq!((m.sample_rate, m.channels, m.has_video), (44100, 2, false));
        assert_eq!(m.duration_ticks, (m.duration_sec * 48000.0).round() as i64);
        assert!(m.file_size_bytes > 1000);
        let _ = fs::remove_file(&f);
    }

    #[test]
    fn probes_real_video_dimensions_and_fps() {
        let f = tmp("v.mp4");
        gen(
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=1",
                "-pix_fmt",
                "yuv420p",
            ],
            &f,
        );
        let m = probe_media(&f).unwrap();
        assert!(m.has_video);
        assert_eq!((m.video_width, m.video_height), (Some(320), Some(240)));
        assert!((m.video_fps.unwrap() - 25.0).abs() < 0.01);
        let _ = fs::remove_file(&f);
    }

    #[test]
    fn rejects_missing_unsupported_and_corrupt_files() {
        assert!(matches!(
            probe_media(Path::new("/tidak/ada.mp3")),
            Err(MediaError::FileNotFound(_))
        ));
        let txt = tmp("x.txt");
        fs::write(&txt, "x").unwrap();
        assert!(matches!(
            probe_media(&txt),
            Err(MediaError::UnsupportedFormat(_))
        ));
        let bad = tmp("rusak.mp3");
        fs::write(&bad, b"bukan audio sama sekali").unwrap();
        assert!(matches!(probe_media(&bad), Err(MediaError::ProbeFailed(_))));
        let _ = fs::remove_file(&txt);
        let _ = fs::remove_file(&bad);
    }

    #[test]
    fn json_without_duration_or_streams_is_an_error_not_a_guess() {
        let p = Path::new("x.mp3");
        assert!(parse_ffprobe_json(p, r#"{"streams":[],"format":{"duration":"3"}}"#, 1).is_err());
        assert!(
            parse_ffprobe_json(p, r#"{"streams":[{"codec_type":"audio"}],"format":{}}"#, 1)
                .is_err()
        );
        assert!(parse_ffprobe_json(p, "bukan json", 1).is_err());
    }
}
