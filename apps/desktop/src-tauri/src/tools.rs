//! Pencarian biner: worker ekspor, `ffmpeg`, `ffprobe`.
//!
//! Worker ekspor adalah executable aplikasi ini sendiri (`<app> worker`, lihat `main`), sehingga bundel
//! cukup satu biner. Aplikasi macOS yang dibuka dari Finder mewarisi `PATH` minimal
//! (`/usr/bin:/bin:/usr/sbin:/sbin`), tanpa `/usr/local/bin` atau `/opt/homebrew/bin` tempat Homebrew
//! memasang FFmpeg. Karena itu pencarian FFmpeg juga memeriksa folder umum tersebut; hasilnya
//! diteruskan ke worker lewat payload (`ffmpeg_bin`).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Variabel lingkungan untuk menunjuk biner worker lain (mis. `qurender` atau worker palsu saat uji).
pub const WORKER_ENV: &str = "QR_WORKER_BIN";

fn exe_name(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

fn is_file(p: &Path) -> bool {
    p.is_file()
}

/// Mencari `name` di setiap folder `PATH` (`path_var`), lalu di `extra_dirs`.
pub fn find_executable(
    name: &str,
    path_var: Option<&OsStr>,
    extra_dirs: &[PathBuf],
) -> Option<PathBuf> {
    let file = exe_name(name);
    let from_path = path_var
        .map(|p| std::env::split_paths(p).collect::<Vec<_>>())
        .unwrap_or_default();
    from_path
        .iter()
        .chain(extra_dirs.iter())
        .map(|d| d.join(&file))
        .find(|c| is_file(c))
}

fn common_tool_dirs() -> Vec<PathBuf> {
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        .iter()
        .map(PathBuf::from)
        .collect()
}

/// Jalur absolut `ffmpeg`/`ffprobe` bila ditemukan; jika tidak, nama polos (galat jelas muncul saat
/// dijalankan: "ffmpeg tidak dapat dijalankan"). Variabel `QR_FFMPEG_BIN`/`QR_FFPROBE_BIN` menimpa.
pub fn media_tool(name: &str) -> String {
    let env_key = format!("QR_{}_BIN", name.to_uppercase());
    if let Ok(p) = std::env::var(&env_key) {
        if !p.trim().is_empty() {
            return p;
        }
    }
    find_executable(
        name,
        std::env::var_os("PATH").as_deref(),
        &common_tool_dirs(),
    )
    .map_or_else(|| name.to_string(), |p| p.to_string_lossy().to_string())
}

/// Worker ekspor: `env_value` (`QR_WORKER_BIN`) bila diset, selain itu executable aplikasi ini sendiri.
/// Nilai `QR_WORKER_BIN` yang diset tetapi salah adalah galat (tidak jatuh diam-diam ke aplikasi).
pub fn resolve_worker_with(
    env_value: Option<&str>,
    current_exe: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(v) = env_value.filter(|v| !v.trim().is_empty()) {
        let p = PathBuf::from(v);
        if is_file(&p) {
            return Ok(p);
        }
        return Err(format!(
            "{WORKER_ENV} menunjuk '{v}' tetapi berkas itu tidak ada. Perbaiki atau hapus variabel tersebut."
        ));
    }
    current_exe.map(Path::to_path_buf).ok_or_else(|| {
        format!("Lokasi executable aplikasi tidak diketahui; set {WORKER_ENV} ke biner worker.")
    })
}

/// [`resolve_worker_with`] dengan lingkungan proses saat ini.
pub fn resolve_worker() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().ok();
    resolve_worker_with(std::env::var(WORKER_ENV).ok().as_deref(), exe.as_deref())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static N: AtomicUsize = AtomicUsize::new(0);

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "qr_tools_{tag}_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, b"x").unwrap();
        p
    }

    #[test]
    fn env_variable_wins_over_the_app_executable() {
        let d = tmp("env");
        let env_bin = touch(&d, "kustom");
        let got = resolve_worker_with(
            Some(env_bin.to_str().unwrap()),
            Some(Path::new("/app/quranrender")),
        )
        .unwrap();
        assert_eq!(got, env_bin);
    }

    #[test]
    fn wrong_env_value_is_an_error_not_a_silent_fallback() {
        let err = resolve_worker_with(
            Some("/tidak/ada/qurender"),
            Some(Path::new("/app/quranrender")),
        )
        .unwrap_err();
        assert!(
            err.contains(WORKER_ENV) && err.contains("/tidak/ada/qurender"),
            "{err}"
        );
    }

    #[test]
    fn without_env_the_app_executable_is_the_worker() {
        let app = Path::new("/Applications/Quran Render.app/Contents/MacOS/quranrender");
        assert_eq!(resolve_worker_with(None, Some(app)).unwrap(), app);
        assert_eq!(resolve_worker_with(Some("  "), Some(app)).unwrap(), app);
        assert!(resolve_worker_with(None, None)
            .unwrap_err()
            .contains(WORKER_ENV));
    }

    #[test]
    fn find_executable_checks_path_then_extra_dirs() {
        let a = tmp("fa");
        let b = tmp("fb");
        let in_b = touch(&b, &exe_name("alat"));
        let path_var = std::env::join_paths([&a]).unwrap();
        assert_eq!(
            find_executable("alat", Some(path_var.as_os_str()), std::slice::from_ref(&b)),
            Some(in_b)
        );
        assert_eq!(
            find_executable("alat", Some(path_var.as_os_str()), &[]),
            None
        );
    }
}
