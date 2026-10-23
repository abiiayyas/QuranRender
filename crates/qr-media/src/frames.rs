//! Ekstraksi frame video terdekode sebagai RGB24 mentah (untuk uji kesetaraan preview–ekspor, A1-11).

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

/// Mendekode `video` dengan FFmpeg ke RGB24 (YUV BT.709 rentang TV → RGB rentang penuh, tanpa
/// penskalaan) dan mengembalikan frame ber-indeks `indices` (indeks decode 0-based, tanpa
/// duplikasi/penurunan frame: `-fps_mode passthrough`). Urutan hasil = urutan `indices`.
/// Gagal bila video lebih pendek dari indeks terbesar. Tiap frame `width·height·3` byte.
pub fn extract_rgb24_frames(
    ffmpeg_bin: &str,
    video: &Path,
    width: u32,
    height: u32,
    indices: &[u64],
) -> Result<Vec<Vec<u8>>, String> {
    let Some(&max_idx) = indices.iter().max() else {
        return Ok(Vec::new());
    };
    let mut child = Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(video)
        .args([
            "-fps_mode",
            "passthrough",
            "-vf",
            "scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ffmpeg tidak dapat dijalankan: {e}"))?;
    let mut out = child
        .stdout
        .take()
        .ok_or_else(|| "stdout ffmpeg tidak tersedia".to_string())?;
    let frame_len = width as usize * height as usize * 3;
    let mut buf = vec![0u8; frame_len];
    let mut found: Vec<Option<Vec<u8>>> = vec![None; indices.len()];
    let mut idx = 0u64;
    while idx <= max_idx {
        if let Err(e) = out.read_exact(&mut buf) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "video hanya memiliki {idx} frame, diminta indeks {max_idx}: {e}"
            ));
        }
        for (slot, _) in found
            .iter_mut()
            .zip(indices)
            .filter(|(_, want)| **want == idx)
        {
            *slot = Some(buf.clone());
        }
        idx += 1;
    }
    let _ = child.kill();
    let _ = child.wait();
    found
        .into_iter()
        .map(|f| f.ok_or_else(|| "frame tidak ditemukan".to_string()))
        .collect()
}
