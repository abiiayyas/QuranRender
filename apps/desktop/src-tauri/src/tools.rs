//! Pencarian biner eksternal: worker `qurender`, `ffmpeg`, `ffprobe`.
//!
//! Aplikasi macOS yang dibuka dari Finder mewarisi `PATH` minimal (`/usr/bin:/bin:/usr/sbin:/sbin`),
//! tanpa `/usr/local/bin` atau `/opt/homebrew/bin` tempat Homebrew memasang FFmpeg. Karena itu pencarian
//! juga memeriksa folder umum tersebut; hasilnya diteruskan ke worker lewat payload (`ffmpeg_bin`).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Variabel lingkungan untuk menunjuk biner worker secara eksplisit.
pub const WORKER_ENV: &str = "QR_WORKER_BIN";

/// Nama berkas worker di platform ini (`qurender` atau `qurender.exe`).
pub fn worker_file_name() -> String {
    format!("qurender{}", std::env::consts::EXE_SUFFIX)
}

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

/// Urutan pencarian worker: `env_value` (`QR_WORKER_BIN`) → saudara dari `current_exe`
/// (`Contents/MacOS/qurender` pada bundel, atau `target/<profil>/qurender` saat dev) → `qurender` di `PATH`.
/// Nilai `QR_WORKER_BIN` yang diset tetapi salah adalah galat (tidak jatuh diam-diam ke kandidat lain).
pub fn resolve_worker_with(
    env_value: Option<&str>,
    current_exe: Option<&Path>,
    path_var: Option<&OsStr>,
) -> Result<PathBuf, String> {
    let mut tried: Vec<String> = Vec::new();
    if let Some(v) = env_value.filter(|v| !v.trim().is_empty()) {
        let p = PathBuf::from(v);
        if is_file(&p) {
            return Ok(p);
        }
        return Err(format!(
            "{WORKER_ENV} menunjuk '{v}' tetapi berkas itu tidak ada. Perbaiki atau hapus variabel tersebut."
        ));
    }
    let file = worker_file_name();
    if let Some(dir) = current_exe.and_then(Path::parent) {
        let sibling = dir.join(&file);
        if is_file(&sibling) {
            return Ok(sibling);
        }
        tried.push(sibling.display().to_string());
    }
    if let Some(p) = find_executable("qurender", path_var, &[]) {
        return Ok(p);
    }
    tried.push("qurender di PATH".to_string());
    Err(format!(
        "Worker ekspor (qurender) tidak ditemukan. Dicari: {}. Bangun dengan `cargo build -p qr-cli` \
         atau set {WORKER_ENV} ke lokasi biner.",
        tried.join("; ")
    ))
}

/// [`resolve_worker_with`] dengan lingkungan proses saat ini.
pub fn resolve_worker() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().ok();
    resolve_worker_with(
        std::env::var(WORKER_ENV).ok().as_deref(),
        exe.as_deref(),
        std::env::var_os("PATH").as_deref(),
    )
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
    fn env_variable_wins_over_sibling_and_path() {
        let d = tmp("env");
        let env_bin = touch(&d, "kustom");
        let exe_dir = tmp("env_exe");
        touch(&exe_dir, &worker_file_name());
        let got = resolve_worker_with(
            Some(env_bin.to_str().unwrap()),
            Some(&exe_dir.join("quranrender")),
            None,
        )
        .unwrap();
        assert_eq!(got, env_bin);
    }

    #[test]
    fn wrong_env_value_is_an_error_not_a_silent_fallback() {
        let exe_dir = tmp("badenv");
        touch(&exe_dir, &worker_file_name());
        let err = resolve_worker_with(
            Some("/tidak/ada/qurender"),
            Some(&exe_dir.join("quranrender")),
            None,
        )
        .unwrap_err();
        assert!(
            err.contains(WORKER_ENV) && err.contains("/tidak/ada/qurender"),
            "{err}"
        );
    }

    #[test]
    fn sibling_of_current_exe_is_found_before_path() {
        let exe_dir = tmp("sib");
        let sib = touch(&exe_dir, &worker_file_name());
        let path_dir = tmp("sib_path");
        touch(&path_dir, &worker_file_name());
        let path_var = std::env::join_paths([&path_dir]).unwrap();
        let got = resolve_worker_with(
            None,
            Some(&exe_dir.join("quranrender")),
            Some(path_var.as_os_str()),
        )
        .unwrap();
        assert_eq!(got, sib);
    }

    #[test]
    fn falls_back_to_path_then_fails_with_every_place_tried() {
        let exe_dir = tmp("nosib");
        let path_dir = tmp("nosib_path");
        let in_path = touch(&path_dir, &worker_file_name());
        let path_var = std::env::join_paths([&path_dir]).unwrap();
        let got = resolve_worker_with(
            None,
            Some(&exe_dir.join("quranrender")),
            Some(path_var.as_os_str()),
        )
        .unwrap();
        assert_eq!(got, in_path);

        let empty = std::env::join_paths([tmp("kosong")]).unwrap();
        let err = resolve_worker_with(
            None,
            Some(&exe_dir.join("quranrender")),
            Some(empty.as_os_str()),
        )
        .unwrap_err();
        assert!(
            err.contains("tidak ditemukan") && err.contains("PATH") && err.contains(WORKER_ENV),
            "{err}"
        );
        assert!(err.contains(exe_dir.to_str().unwrap()), "{err}");
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
