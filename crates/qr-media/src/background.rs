//! Latar gambar/video (paritas Quran Caption): probe gambar, dekode satu frame dan aliran frame video
//! yang sudah di-*cover-fit* (skala menutup kanvas + potong tengah) ke ukuran kanvas, dengan FFmpeg.
//!
//! Penskalaan/pemotongan dilakukan FFmpeg (setelah autorotate) dengan satu rumus yang sama untuk preview
//! dan ekspor, sehingga piksel kedua jalur identik pada ukuran yang sama. Keluaran selalu RGBA 8-bit
//! mentah berukuran `lebar·tinggi·4` byte.

use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};

use crate::probe::MediaError;

/// Ekstensi gambar yang diterima sebagai latar.
pub const BACKGROUND_IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "bmp"];
/// Ekstensi video yang diterima sebagai latar.
pub const BACKGROUND_VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mov", "mkv", "webm"];

/// Jenis latar berdasarkan ekstensi berkas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundKind {
    Image,
    Video,
}

/// Menentukan jenis latar dari ekstensi (tanpa membedakan huruf besar/kecil); `None` bila tidak didukung.
pub fn background_kind_for(path: &Path) -> Option<BackgroundKind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if BACKGROUND_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        Some(BackgroundKind::Image)
    } else if BACKGROUND_VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some(BackgroundKind::Video)
    } else {
        None
    }
}

/// Filter FFmpeg *cover-fit*: skala sehingga kedua sisi ≥ kanvas (`max(W, ⌈iw·H/ih⌉)` ×
/// `max(H, ⌈ih·W/iw⌉)`, rasio sumber dipertahankan), lalu potong `W×H` dari tengah.
/// Contoh: sumber lanskap 16:9 ke kanvas 9:16 → tinggi penuh, kiri-kanan terpotong simetris.
pub fn cover_filter(width: u32, height: u32) -> String {
    format!(
        "scale=w='max({width},ceil(iw*{height}/ih))':h='max({height},ceil(ih*{width}/iw))':flags=bicubic,crop={width}:{height},format=rgba"
    )
}

fn frame_len(width: u32, height: u32) -> usize {
    width as usize * height as usize * 4
}

fn check_dims(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Ukuran kanvas latar nol".to_string());
    }
    Ok(())
}

/// Membaca dimensi (lebar, tinggi) gambar dengan ffprobe; gagal bila berkas bukan gambar yang dapat dibaca.
pub fn probe_image_with(ffprobe_bin: &str, path: &Path) -> Result<(u32, u32), MediaError> {
    if !path.is_file() {
        return Err(MediaError::FileNotFound(path.to_path_buf()));
    }
    let out = Command::new(ffprobe_bin)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|e| MediaError::ProbeFailed(format!("ffprobe tidak dapat dijalankan: {e}")))?;
    if !out.status.success() {
        return Err(MediaError::ProbeFailed(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    parse_image_probe(&String::from_utf8_lossy(&out.stdout))
}

fn parse_image_probe(json: &str) -> Result<(u32, u32), MediaError> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| MediaError::ProbeFailed(e.to_string()))?;
    let stream = v
        .get("streams")
        .and_then(|s| s.get(0))
        .ok_or_else(|| MediaError::ProbeFailed("tidak ada stream gambar".into()))?;
    let dim = |k: &str| {
        stream
            .get(k)
            .and_then(serde_json::Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0)
    };
    match (dim("width"), dim("height")) {
        (Some(w), Some(h)) => Ok((w, h)),
        _ => Err(MediaError::ProbeFailed("dimensi gambar tidak valid".into())),
    }
}

/// Mendekode satu frame (gambar, atau frame video pada `seek_sec`) yang sudah di-cover-fit ke
/// `width×height`. Hasil RGBA `width·height·4` byte. `seek_sec` memakai seek akurat: frame pertama
/// dengan pts ≥ `seek_sec`.
pub fn extract_cover_frame(
    ffmpeg_bin: &str,
    path: &Path,
    seek_sec: Option<f64>,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    check_dims(width, height)?;
    let mut cmd = Command::new(ffmpeg_bin);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if let Some(s) = seek_sec {
        cmd.arg("-ss").arg(format!("{:.6}", s.max(0.0)));
    }
    let out = cmd
        .arg("-i")
        .arg(path)
        .args(["-an", "-frames:v", "1", "-vf"])
        .arg(cover_filter(width, height))
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg tidak dapat dijalankan: {e}"))?;
    let want = frame_len(width, height);
    if !out.status.success() || out.stdout.len() != want {
        return Err(format!(
            "frame latar tidak dapat didekode dari {}: {}",
            path.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

/// Aliran frame video latar berurutan (`fps` tetap, sudah di-cover-fit) dari satu proses FFmpeg.
/// Proses dihentikan saat objek dilepas.
#[derive(Debug)]
struct CoverVideoStream {
    child: Child,
    out: ChildStdout,
}

impl CoverVideoStream {
    fn spawn(
        ffmpeg_bin: &str,
        path: &Path,
        trim_in_sec: f64,
        duration_sec: f64,
        fps: u32,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let mut child = Command::new(ffmpeg_bin)
            .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
            .arg("-ss")
            .arg(format!("{:.6}", trim_in_sec.max(0.0)))
            .arg("-t")
            .arg(format!("{:.6}", duration_sec.max(0.001)))
            .arg("-i")
            .arg(path)
            .args(["-an", "-vf"])
            .arg(format!("fps={fps},{}", cover_filter(width, height)))
            .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("ffmpeg tidak dapat dijalankan: {e}"))?;
        let out = child
            .stdout
            .take()
            .ok_or_else(|| "stdout ffmpeg tidak tersedia".to_string())?;
        Ok(Self { child, out })
    }

    /// Membaca frame berikutnya ke `buf`; `Ok(false)` bila video habis.
    fn read_frame(&mut self, buf: &mut [u8]) -> Result<bool, String> {
        let mut filled = 0;
        while filled < buf.len() {
            match self.out.read(&mut buf[filled..]) {
                Ok(0) => {
                    return if filled == 0 {
                        Ok(false)
                    } else {
                        Err("frame video latar terpotong".to_string())
                    }
                }
                Ok(n) => filled += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => return Err(format!("pembacaan frame latar gagal: {e}")),
            }
        }
        Ok(true)
    }
}

impl Drop for CoverVideoStream {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Pembaca frame video latar dengan akses berindeks untuk ekspor: frame ke-`j` = frame pada waktu
/// `j / fps` dari titik `trim_in` (satu putaran). Akses maju membaca berurutan dari satu proses FFmpeg;
/// mundur (awal putaran perulangan) memulai ulang prosesnya. Melewati akhir video menahan frame terakhir.
#[derive(Debug)]
pub struct LoopingCoverVideo {
    ffmpeg_bin: String,
    path: std::path::PathBuf,
    trim_in_sec: f64,
    duration_sec: f64,
    fps: u32,
    width: u32,
    height: u32,
    stream: Option<CoverVideoStream>,
    /// Indeks frame yang sedang ada di `buf` (−1 = belum ada).
    current: i64,
    buf: Vec<u8>,
    exhausted: bool,
}

impl LoopingCoverVideo {
    pub fn new(
        ffmpeg_bin: &str,
        path: &Path,
        trim_in_sec: f64,
        duration_sec: f64,
        fps: u32,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        check_dims(width, height)?;
        Ok(Self {
            ffmpeg_bin: ffmpeg_bin.to_string(),
            path: path.to_path_buf(),
            trim_in_sec,
            duration_sec,
            fps: fps.max(1),
            width,
            height,
            stream: None,
            current: -1,
            buf: vec![0; frame_len(width, height)],
            exhausted: false,
        })
    }

    /// Mengembalikan `(indeks efektif, piksel RGBA)` untuk frame `index`. Indeks efektif lebih kecil dari
    /// `index` bila video habis lebih dulu (frame terakhir ditahan); pemanggil dapat memakainya untuk
    /// menggunakan ulang hasil konversi yang sama.
    pub fn frame(&mut self, index: u64) -> Result<(u64, &[u8]), String> {
        let want = i64::try_from(index).unwrap_or(i64::MAX);
        if self.stream.is_none() || want < self.current {
            self.stream = Some(CoverVideoStream::spawn(
                &self.ffmpeg_bin,
                &self.path,
                self.trim_in_sec,
                self.duration_sec,
                self.fps,
                self.width,
                self.height,
            )?);
            self.current = -1;
            self.exhausted = false;
        }
        while self.current < want && !self.exhausted {
            let Some(stream) = self.stream.as_mut() else {
                return Err("aliran video latar tidak ada".to_string());
            };
            if stream.read_frame(&mut self.buf)? {
                self.current += 1;
            } else {
                self.exhausted = true;
            }
        }
        if self.current < 0 {
            return Err(format!(
                "video latar tidak memuat frame yang dapat didekode: {}",
                self.path.display()
            ));
        }
        Ok((self.current as u64, &self.buf))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn ffmpeg_available() -> bool {
        Command::new("ffmpeg")
            .arg("-version")
            .output()
            .is_ok_and(|o| o.status.success())
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("qr_bg_media_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    fn lavfi(args: &[&str], out: &Path) {
        let st = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(args)
            .arg(out)
            .status()
            .unwrap();
        assert!(st.success());
    }

    #[test]
    fn kind_from_extension() {
        assert_eq!(
            background_kind_for(Path::new("/a/B.PNG")),
            Some(BackgroundKind::Image)
        );
        assert_eq!(
            background_kind_for(Path::new("x.webm")),
            Some(BackgroundKind::Video)
        );
        assert_eq!(background_kind_for(Path::new("x.mp3")), None);
        assert_eq!(background_kind_for(Path::new("noext")), None);
    }

    #[test]
    fn cover_filter_uses_cover_formula() {
        let f = cover_filter(1080, 1920);
        assert!(f.contains("max(1080,ceil(iw*1920/ih))"));
        assert!(f.contains("max(1920,ceil(ih*1080/iw))"));
        assert!(f.contains("crop=1080:1920"));
    }

    #[test]
    fn parse_image_probe_reads_dimensions_and_rejects_garbage() {
        assert_eq!(
            parse_image_probe(r#"{"streams":[{"width":640,"height":360}]}"#).unwrap(),
            (640, 360)
        );
        assert!(parse_image_probe(r#"{"streams":[]}"#).is_err());
        assert!(parse_image_probe("bukan json").is_err());
    }

    /// Sumber lanskap 3 pita (merah | hijau | biru) ke kanvas potret 9:16: tinggi penuh, pita tengah
    /// mengisi seluruh kanvas dan tepi merah/biru terpotong simetris.
    #[test]
    fn landscape_source_into_portrait_canvas_crops_center() {
        if !ffmpeg_available() {
            return;
        }
        let img = tmp("bands.png");
        lavfi(
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x360,format=rgb24[r];color=c=0x00ff00:s=320x360,format=rgb24[g];color=c=blue:s=320x360,format=rgb24[b];[r][g][b]hstack=inputs=3",
                "-frames:v",
                "1",
            ],
            &img,
        );
        // Kanvas 90×160 dari sumber 960×360: skala 427×160 (⌈960·160/360⌉), pita hijau = x 142..284.
        let (w, h) = (90u32, 160u32);
        let px = extract_cover_frame("ffmpeg", &img, None, w, h).unwrap();
        assert_eq!(px.len(), (w * h * 4) as usize);
        let at = |x: u32, y: u32| {
            let i = ((y * w + x) * 4) as usize;
            [px[i], px[i + 1], px[i + 2]]
        };
        for (x, y) in [
            (0, 0),
            (w - 1, 0),
            (w / 2, h / 2),
            (0, h - 1),
            (w - 1, h - 1),
        ] {
            let p = at(x, y);
            assert!(
                p[1] > 200 && p[0] < 60 && p[2] < 60,
                "({x},{y}) bukan hijau: {p:?}"
            );
        }
    }

    #[test]
    fn square_source_into_landscape_canvas_crops_top_bottom() {
        if !ffmpeg_available() {
            return;
        }
        let img = tmp("vbands.png");
        lavfi(
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=200x100,format=rgb24[r];color=c=0x00ff00:s=200x400,format=rgb24[g];color=c=blue:s=200x100,format=rgb24[b];[r][g][b]vstack=inputs=3",
                "-frames:v",
                "1",
            ],
            &img,
        );
        // 200×600 ke 160×90: skala 160×480, potong tengah vertikal (y 195..285) → seluruhnya hijau.
        let (w, h) = (160u32, 90u32);
        let px = extract_cover_frame("ffmpeg", &img, None, w, h).unwrap();
        for (x, y) in [(0, 0), (w - 1, 0), (w / 2, h / 2), (0, h - 1)] {
            let i = ((y * w + x) * 4) as usize;
            assert!(px[i + 1] > 200 && px[i] < 60 && px[i + 2] < 60);
        }
    }

    #[test]
    fn probe_image_with_reports_dimensions() {
        if !ffmpeg_available() {
            return;
        }
        let img = tmp("probe.png");
        lavfi(
            &["-f", "lavfi", "-i", "color=c=red:s=64x48", "-frames:v", "1"],
            &img,
        );
        assert_eq!(probe_image_with("ffprobe", &img).unwrap(), (64, 48));
        let err = probe_image_with("ffprobe", &tmp("tidak-ada.png")).unwrap_err();
        assert!(matches!(err, MediaError::FileNotFound(_)));
    }

    /// Video 1 dtk @10 fps dengan gradasi waktu: frame `j` berubah monoton, indeks melewati akhir menahan
    /// frame terakhir, dan akses mundur (awal putaran) memulai ulang aliran.
    #[test]
    fn looping_reader_is_indexed_and_restarts_on_wrap() {
        if !ffmpeg_available() {
            return;
        }
        let vid = tmp("ramp.mp4");
        lavfi(
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:r=10:d=1,geq=lum='255*N/9':cb=128:cr=128",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "0",
            ],
            &vid,
        );
        let mut r = LoopingCoverVideo::new("ffmpeg", &vid, 0.0, 1.0, 10, 32, 32).unwrap();
        let luma = |px: &[u8]| i32::from(px[0]);
        let (i0, f0) = r.frame(0).unwrap();
        let l0 = luma(f0);
        assert_eq!(i0, 0);
        let (i5, f5) = r.frame(5).unwrap();
        let l5 = luma(f5);
        assert_eq!(i5, 5);
        assert!(l5 > l0 + 60, "gradasi waktu tidak naik: {l0} → {l5}");
        let (i_end, _) = r.frame(50).unwrap();
        assert!((8..=10).contains(&i_end), "frame terakhir ditahan: {i_end}");
        let (iw, fw) = r.frame(0).unwrap();
        assert_eq!(iw, 0);
        assert_eq!(luma(fw), l0, "putaran ulang harus kembali ke frame awal");
    }
}
