//! Ekspor MP4 nyata: frame RGBA dialirkan ke proses `ffmpeg` (rawvideo → H.264/AAC) (A1-10, EXP-1, EXP-2).
//! Tidak ada dependensi ke renderer: pemanggil menyuplai frame lewat closure.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::encoder::{
    build_ffmpeg_export_args, probe_available_encoders, select_best_encoder, Mp4ExportConfig,
    VideoEncoder,
};

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("FFmpeg tidak dapat dijalankan ('{0}'): {1}")]
    FfmpegUnavailable(String, std::io::Error),
    #[error("Tidak ada encoder H.264 yang tersedia pada FFmpeg ini")]
    NoEncoder,
    #[error("Encoder {encoder} gagal: {stderr}")]
    EncoderFailed { encoder: String, stderr: String },
    #[error("Pembuatan frame {frame} gagal: {message}")]
    Frame { frame: u64, message: String },
    #[error("Frame {frame} berukuran {got} byte, diharapkan {want}")]
    FrameSize { frame: u64, got: usize, want: usize },
    #[error("Ekspor dibatalkan")]
    Cancelled,
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ExportStats {
    pub frames: u64,
    /// Encoder yang akhirnya dipakai (setelah fallback bila ada).
    pub encoder: VideoEncoder,
    /// `true` bila encoder hardware gagal dan ekspor diulang dengan libx264.
    pub fell_back_to_software: bool,
}

#[allow(clippy::too_many_arguments)]
fn run_once<F, P>(
    ffmpeg_bin: &str,
    config: &Mp4ExportConfig,
    encoder: &VideoEncoder,
    audio: Option<&Path>,
    out: &Path,
    total_frames: u64,
    render_frame: &mut F,
    progress: &mut P,
    cancel: &AtomicBool,
) -> Result<(), ExportError>
where
    F: FnMut(u64) -> Result<Vec<u8>, String>,
    P: FnMut(u64, u64),
{
    let audio_s = audio.map(|a| a.to_string_lossy().to_string());
    let out_s = out.to_string_lossy().to_string();
    let args = build_ffmpeg_export_args(config, encoder, audio_s.as_deref(), &out_s);
    let mut child = Command::new(ffmpeg_bin)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ExportError::FfmpegUnavailable(ffmpeg_bin.to_string(), e))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ExportError::Io(std::io::Error::other("stdin ffmpeg tidak tersedia")))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| ExportError::Io(std::io::Error::other("stderr ffmpeg tidak tersedia")))?;
    // Kuras stderr di thread terpisah agar ffmpeg tidak macet saat pipa penuh.
    let drain = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let want = config.width as usize * config.height as usize * 4;
    let mut result: Result<(), ExportError> = Ok(());
    for i in 0..total_frames {
        if cancel.load(Ordering::Relaxed) {
            result = Err(ExportError::Cancelled);
            break;
        }
        let frame = match render_frame(i) {
            Ok(f) => f,
            Err(message) => {
                result = Err(ExportError::Frame { frame: i, message });
                break;
            }
        };
        if frame.len() != want {
            result = Err(ExportError::FrameSize {
                frame: i,
                got: frame.len(),
                want,
            });
            break;
        }
        if stdin.write_all(&frame).is_err() {
            // ffmpeg menutup pipa lebih awal: penyebab sebenarnya ada di stderr.
            break;
        }
        progress(i + 1, total_frames);
    }
    drop(stdin);
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait()?;
    let err_text = drain.join().unwrap_or_default();
    result?;
    if !status.success() {
        return Err(ExportError::EncoderFailed {
            encoder: encoder.ffmpeg_codec_name().to_string(),
            stderr: err_text.trim().to_string(),
        });
    }
    Ok(())
}

/// Mengekspor `total_frames` frame RGBA ke `out` (MP4). Encoder hardware yang gagal dipaksa jatuh ke
/// libx264 dengan mengulang dari frame 0 (EXP-2). File parsial dihapus saat gagal/dibatalkan.
#[allow(clippy::too_many_arguments)]
pub fn export_mp4<F, P>(
    ffmpeg_bin: &str,
    config: &Mp4ExportConfig,
    audio: Option<&Path>,
    out: &Path,
    total_frames: u64,
    mut render_frame: F,
    mut progress: P,
    cancel: &AtomicBool,
) -> Result<ExportStats, ExportError>
where
    F: FnMut(u64) -> Result<Vec<u8>, String>,
    P: FnMut(u64, u64),
{
    let available = probe_available_encoders(ffmpeg_bin)
        .map_err(|e| ExportError::FfmpegUnavailable(ffmpeg_bin.to_string(), e))?;
    let chosen = select_best_encoder(config, &available).ok_or(ExportError::NoEncoder)?;

    let first = run_once(
        ffmpeg_bin,
        config,
        &chosen,
        audio,
        out,
        total_frames,
        &mut render_frame,
        &mut progress,
        cancel,
    );
    let outcome = match first {
        Ok(()) => Ok(ExportStats {
            frames: total_frames,
            encoder: chosen,
            fell_back_to_software: false,
        }),
        Err(ExportError::EncoderFailed { .. })
            if matches!(chosen, VideoEncoder::Hardware(_))
                && available.contains(&VideoEncoder::SoftwareLibx264) =>
        {
            let sw = VideoEncoder::SoftwareLibx264;
            run_once(
                ffmpeg_bin,
                config,
                &sw,
                audio,
                out,
                total_frames,
                &mut render_frame,
                &mut progress,
                cancel,
            )
            .map(|()| ExportStats {
                frames: total_frames,
                encoder: sw,
                fell_back_to_software: true,
            })
        }
        Err(e) => Err(e),
    };
    if outcome.is_err() {
        let _ = std::fs::remove_file(out);
    }
    outcome
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::encoder::{parse_ffmpeg_encoders, HwEncoderKind};

    fn cfg(w: u32, h: u32) -> Mp4ExportConfig {
        Mp4ExportConfig {
            width: w,
            height: h,
            fps: 10,
            video_bitrate_kbps: 500,
            ..Mp4ExportConfig::default()
        }
    }

    fn solid(w: u32, h: u32, i: u64) -> Vec<u8> {
        let v = (i * 20 % 255) as u8;
        [v, 80, 160, 255].repeat((w * h) as usize)
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("qr_export_{}_{name}", std::process::id()))
    }

    fn ffprobe(path: &Path, entries: &str) -> String {
        let o = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                entries,
                "-of",
                "default=nw=1",
                &path.to_string_lossy(),
            ])
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout).to_string()
    }

    #[test]
    fn parses_installed_encoders_from_ffmpeg_listing() {
        let sample = " V....D libx264              libx264 H.264\n V....D h264_videotoolbox    VideoToolbox H.264 Encoder\n V....D libx265 x\n";
        assert_eq!(
            parse_ffmpeg_encoders(sample),
            vec![
                VideoEncoder::Hardware(HwEncoderKind::VideoToolbox),
                VideoEncoder::SoftwareLibx264
            ]
        );
        assert!(parse_ffmpeg_encoders("").is_empty());
    }

    #[test]
    fn export_produces_real_mp4_with_audio_bt709_and_frame_count() {
        let wav = tmp("a.wav");
        let ok = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=3",
                "-ar",
                "48000",
                &wav.to_string_lossy(),
            ])
            .status()
            .unwrap();
        assert!(ok.success(), "ffmpeg wajib ada untuk uji ekspor");
        let out = tmp("o.mp4");
        let cancel = AtomicBool::new(false);
        let mut seen = 0;
        let stats = export_mp4(
            "ffmpeg",
            &cfg(160, 288),
            Some(&wav),
            &out,
            20,
            |i| Ok(solid(160, 288, i)),
            |d, _| seen = d,
            &cancel,
        )
        .unwrap();
        assert_eq!((stats.frames, seen), (20, 20));
        let v = ffprobe(
            &out,
            "stream=codec_name,width,height,pix_fmt,color_space,nb_frames",
        );
        assert!(
            v.contains("codec_name=h264") && v.contains("width=160") && v.contains("height=288"),
            "{v}"
        );
        assert!(v.contains("color_space=bt709"), "{v}");
        assert!(v.contains("nb_frames=20"), "{v}");
        assert!(v.contains("codec_name=aac"), "audio harus ter-mux: {v}");
        let _ = std::fs::remove_file(&wav);
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn cancellation_stops_and_removes_partial_file() {
        let out = tmp("c.mp4");
        let cancel = AtomicBool::new(false);
        let r = export_mp4(
            "ffmpeg",
            &cfg(64, 64),
            None,
            &out,
            1000,
            |i| {
                if i == 5 {
                    cancel.store(true, Ordering::Relaxed);
                }
                Ok(solid(64, 64, i))
            },
            |_, _| {},
            &cancel,
        );
        assert!(matches!(r, Err(ExportError::Cancelled)));
        assert!(!out.exists());
    }

    #[test]
    fn frame_with_wrong_size_is_rejected() {
        let out = tmp("s.mp4");
        let cancel = AtomicBool::new(false);
        let r = export_mp4(
            "ffmpeg",
            &cfg(64, 64),
            None,
            &out,
            3,
            |_| Ok(vec![0u8; 10]),
            |_, _| {},
            &cancel,
        );
        assert!(
            matches!(r, Err(ExportError::FrameSize { frame: 0, .. })),
            "{r:?}"
        );
        assert!(!out.exists());
    }

    #[test]
    fn missing_ffmpeg_binary_is_reported() {
        let cancel = AtomicBool::new(false);
        let r = export_mp4(
            "ffmpeg-tidak-ada",
            &cfg(64, 64),
            None,
            &tmp("m.mp4"),
            1,
            |_| Ok(vec![]),
            |_, _| {},
            &cancel,
        );
        assert!(matches!(r, Err(ExportError::FfmpegUnavailable(..))));
    }

    #[test]
    fn args_include_bt709_and_audio_mapping() {
        let a = build_ffmpeg_export_args(
            &cfg(64, 64),
            &VideoEncoder::SoftwareLibx264,
            Some("a.wav"),
            "o.mp4",
        );
        let j = a.join(" ");
        assert!(
            j.contains("out_color_matrix=bt709")
                && j.contains("-map 1:a:0")
                && j.contains("-shortest")
        );
        let n =
            build_ffmpeg_export_args(&cfg(64, 64), &VideoEncoder::SoftwareLibx264, None, "o.mp4");
        assert!(!n.join(" ").contains("-map 1:a:0"));
    }
}
