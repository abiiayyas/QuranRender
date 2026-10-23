//! Dekode audio dari berkas apa pun yang didukung FFmpeg menjadi sampel f32 mono (SRC-1).
//! Hasilnya adalah masukan untuk waveform, LUFS, dan VAD/alignment.

use std::path::Path;
use std::process::{Command, Stdio};

use crate::probe::MediaError;

/// Mendekode audio ke f32 mono pada `sample_rate` Hz (semua kanal di-downmix oleh FFmpeg).
pub fn decode_audio_mono_f32(
    ffmpeg_bin: &str,
    path: &Path,
    sample_rate: u32,
) -> Result<Vec<f32>, MediaError> {
    if !path.exists() {
        return Err(MediaError::FileNotFound(path.to_path_buf()));
    }
    let out = Command::new(ffmpeg_bin)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-vn",
            "-ac",
            "1",
            "-ar",
            &sample_rate.to_string(),
            "-f",
            "f32le",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| MediaError::ProbeFailed(format!("ffmpeg tidak dapat dijalankan: {e}")))?;
    if !out.status.success() {
        return Err(MediaError::ProbeFailed(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    if out.stdout.is_empty() {
        return Err(MediaError::ProbeFailed("berkas tidak memuat audio".into()));
    }
    Ok(out
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn decodes_stereo_file_to_mono_with_expected_length_and_level() {
        let f = std::env::temp_dir().join(format!("qr_dec_{}.wav", std::process::id()));
        let st = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-ac",
                "2",
                "-ar",
                "44100",
            ])
            .arg(&f)
            .status()
            .unwrap();
        assert!(st.success());
        let s = decode_audio_mono_f32("ffmpeg", &f, 48_000).unwrap();
        // 2 dtk @ 48 kHz (toleransi resampler).
        assert!((s.len() as i64 - 96_000).abs() < 200, "len {}", s.len());
        let peak = s.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        assert!(peak > 0.1 && peak <= 1.0, "puncak {peak}");
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn missing_and_non_audio_files_are_errors() {
        assert!(decode_audio_mono_f32("ffmpeg", Path::new("/tidak/ada.wav"), 48_000).is_err());
        let f = std::env::temp_dir().join(format!("qr_dec_bad_{}.wav", std::process::id()));
        std::fs::write(&f, b"bukan audio").unwrap();
        assert!(decode_audio_mono_f32("ffmpeg", &f, 48_000).is_err());
        let _ = std::fs::remove_file(&f);
    }
}
