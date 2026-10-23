//! Crash log lokal dan pengaturan telemetri (B2-20, PRD SET-5).
//!
//! Kebijakan: **tidak ada kode jaringan** di berkas ini maupun di tempat lain untuk telemetri.
//! Panic dicatat satu baris per kejadian ke `<folder aplikasi>/crash.log` di perangkat pengguna.
//! Baris hanya memuat versi aplikasi, OS/arsitektur, lokasi kode sumber (dua segmen terakhir), dan
//! pesan panic yang sudah dibersihkan: bukan-ASCII (teks Quran, nama berkas Arab) diganti `?`,
//! token berbentuk path dikurangi menjadi nama berkasnya, dan panjang dibatasi. Isi proyek, teks
//! Quran, dan path media pengguna tidak pernah ditulis.
//!
//! Pengaturan `telemetry_opt_in` (default `false`) tersimpan di `app.db`. Pratinjau yang dikembalikan
//! `telemetry_status` adalah teks `crash.log` apa adanya, yaitu persis yang akan dikirim bila suatu
//! hari pengunggahan dibuat dan pengguna menyetujuinya. Saat ini pengunggahan tidak ada.

use std::fs;
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use qr_store::AppDb;
use serde::Serialize;
use specta::Type;

use crate::AppState;

/// Kunci pengaturan di tabel `setting` (bukan rahasia; lolos `is_secret_key`).
pub const TELEMETRY_SETTING_KEY: &str = "telemetry_opt_in";
/// Log dirotasi (`crash.log.old`) bila melewati ukuran ini.
const MAX_LOG_BYTES: u64 = 256 * 1024;
/// Batas pratinjau yang dikirim ke UI (ekor berkas).
const MAX_PREVIEW_BYTES: usize = 64 * 1024;
const MAX_MESSAGE_CHARS: usize = 300;

/// `<folder aplikasi>/crash.log`, di sebelah `app.db`.
pub fn default_log_path() -> PathBuf {
    crate::get_default_db_path()
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
        .join("crash.log")
}

fn is_path_like(token: &str) -> bool {
    token.contains('/') || token.contains('\\')
}

/// Membersihkan pesan panic agar tidak membocorkan isi proyek, teks Quran, atau path pengguna.
pub fn scrub_message(raw: &str) -> String {
    let mut out = String::new();
    for token in raw.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        if is_path_like(token) {
            // Pertahankan hanya nama berkas (tanpa tanda baca di ujung yang ikut tertangkap).
            let trimmed =
                token.trim_matches(|c: char| matches!(c, '"' | '\'' | '(' | ')' | ',' | ':' | ';'));
            let name = trimmed
                .rsplit(['/', '\\'])
                .find(|s| !s.is_empty())
                .unwrap_or("");
            out.push_str("<path>/");
            out.push_str(name);
        } else {
            out.push_str(token);
        }
    }
    let ascii: String = out
        .chars()
        .map(|c| {
            if c.is_ascii() && !c.is_ascii_control() {
                c
            } else {
                '?'
            }
        })
        .collect();
    if ascii.chars().count() > MAX_MESSAGE_CHARS {
        let cut: String = ascii.chars().take(MAX_MESSAGE_CHARS).collect();
        format!("{cut}...")
    } else {
        ascii
    }
}

/// Dua segmen terakhir path sumber (`src/main.rs`); path build absolut bisa memuat nama pengguna.
fn scrub_location(file: &str) -> String {
    let parts: Vec<&str> = file
        .rsplit(['/', '\\'])
        .filter(|s| !s.is_empty())
        .take(2)
        .collect();
    let mut parts = parts;
    parts.reverse();
    parts.join("/")
}

/// Menyusun satu baris log (tanpa newline di tengah; diakhiri `\n`). Fungsi murni agar dapat diuji
/// tanpa memicu panic sungguhan.
pub fn format_crash_entry(
    unix_ms: u64,
    version: &str,
    os: &str,
    arch: &str,
    message: &str,
    location: Option<(&str, u32, u32)>,
) -> String {
    let loc = location.map_or_else(
        || "unknown".to_string(),
        |(f, l, c)| format!("{}:{l}:{c}", scrub_location(f)),
    );
    format!(
        "ts_ms={unix_ms} version={version} os={os} arch={arch} location={loc} message=\"{}\"\n",
        scrub_message(message).replace('"', "'")
    )
}

/// Menambahkan satu entri ke `path`, merotasi bila berkas sudah terlalu besar.
pub fn append_entry(path: &Path, entry: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::metadata(path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
        fs::rename(path, path.with_extension("log.old"))?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    f.write_all(entry.as_bytes())
}

fn payload_message(info: &PanicHookInfo<'_>) -> String {
    let p = info.payload();
    p.downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic tanpa pesan teks".to_string())
}

/// Memasang panic hook yang menulis ke `log_path`, lalu meneruskan ke hook sebelumnya.
/// Kegagalan menulis log diabaikan (hook tidak boleh panic).
pub fn install_panic_hook(log_path: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let entry = format_crash_entry(
            ms,
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH,
            &payload_message(info),
            info.location().map(|l| (l.file(), l.line(), l.column())),
        );
        let _ = append_entry(&log_path, &entry);
        previous(info);
    }));
}

#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct TelemetryStatus {
    /// Persetujuan pengguna; default `false`.
    pub opt_in: bool,
    /// Selalu `false` saat ini: tidak ada kode pengiriman. Data hanya tersimpan lokal.
    pub upload_implemented: bool,
    pub crash_log_path: String,
    /// Jumlah entri (baris) pada crash log lokal.
    pub entries: u32,
    /// Teks persis yang akan dikirim jika pengunggahan ada: isi `crash.log` (ekor bila sangat panjang).
    pub preview: String,
    pub preview_truncated: bool,
}

pub fn read_opt_in(db: &AppDb) -> Result<bool, String> {
    Ok(db
        .get_setting(TELEMETRY_SETTING_KEY)
        .map_err(|e| e.to_string())?
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

pub fn write_opt_in(db: &AppDb, enabled: bool) -> Result<(), String> {
    db.set_setting(TELEMETRY_SETTING_KEY, &serde_json::Value::Bool(enabled))
        .map_err(|e| e.to_string())
}

pub fn build_status(db: &AppDb, log_path: &Path) -> Result<TelemetryStatus, String> {
    let bytes = match fs::read(log_path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("Gagal membaca crash log: {e}")),
    };
    let entries = bytes.iter().filter(|b| **b == b'\n').count() as u32;
    let truncated = bytes.len() > MAX_PREVIEW_BYTES;
    let tail = if truncated {
        &bytes[bytes.len() - MAX_PREVIEW_BYTES..]
    } else {
        &bytes[..]
    };
    let mut preview = String::from_utf8_lossy(tail).into_owned();
    if truncated {
        // Buang baris pertama yang mungkin terpotong di tengah.
        if let Some(i) = preview.find('\n') {
            preview.drain(..=i);
        }
    }
    Ok(TelemetryStatus {
        opt_in: read_opt_in(db)?,
        upload_implemented: false,
        crash_log_path: log_path.to_string_lossy().into_owned(),
        entries,
        preview,
        preview_truncated: truncated,
    })
}

/// Status telemetri dan pratinjau data yang akan dikirim (crash log lokal).
#[tauri::command]
#[specta::specta]
pub fn telemetry_status(state: tauri::State<'_, AppState>) -> Result<TelemetryStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    build_status(&db, &default_log_path())
}

/// Mengubah persetujuan telemetri (default mati). Tidak memicu pengiriman apa pun.
#[tauri::command]
#[specta::specta]
pub fn telemetry_set_opt_in(
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    write_opt_in(&db, enabled)?;
    read_opt_in(&db)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn entry_has_version_os_location_and_message_on_one_line() {
        let line = format_crash_entry(
            1_700_000_000_000,
            "0.1.0",
            "macos",
            "x86_64",
            "index out of bounds: the len is 3\nbut the index is 7",
            Some((
                "/Users/budi/Development/QuranRender/crates/qr-core/src/pack.rs",
                42,
                9,
            )),
        );
        assert_eq!(
            line,
            "ts_ms=1700000000000 version=0.1.0 os=macos arch=x86_64 \
             location=src/pack.rs:42:9 message=\"index out of bounds: the len is 3 but the index is 7\"\n"
        );
        assert_eq!(line.matches('\n').count(), 1);
        assert!(
            !line.contains("budi"),
            "nama pengguna dari path build tidak boleh bocor"
        );
    }

    #[test]
    fn message_never_carries_quran_text_user_paths_or_control_chars() {
        let msg = "gagal membuka /Users/budi/Media/rekaman pribadi.wav: \
                   \"\u{0628}\u{0650}\u{0633}\u{0652}\u{0645}\u{0650} \u{0627}\u{0644}\u{0644}\u{0647}\" \
                   C:\\Users\\Siti\\Videos\\latar.mp4\u{0007}";
        let s = scrub_message(msg);
        assert!(s.is_ascii(), "{s}");
        assert!(
            !s.contains("budi") && !s.contains("Siti") && !s.contains("Users"),
            "{s}"
        );
        assert!(s.contains("<path>/") && s.contains("latar.mp4"), "{s}");
        assert!(!s.chars().any(|c| c.is_control()), "{s:?}");
        // Panjang dibatasi.
        let long = "x".repeat(5000);
        assert!(scrub_message(&long).chars().count() <= MAX_MESSAGE_CHARS + 3);
        // Tanda kutip tidak merusak format `message="..."`.
        let line = format_crash_entry(1, "v", "o", "a", "a \"b\" c", None);
        assert!(line.ends_with("message=\"a 'b' c\"\n"), "{line}");
        assert!(line.contains("location=unknown"));
    }

    #[test]
    fn append_writes_lines_and_rotates_when_large() {
        let dir = std::env::temp_dir().join(format!("qr_crash_{}", ulid::Ulid::generate()));
        let log = dir.join("sub/crash.log");
        append_entry(&log, "satu\n").unwrap();
        append_entry(&log, "dua\n").unwrap();
        assert_eq!(fs::read_to_string(&log).unwrap(), "satu\ndua\n");
        fs::write(&log, vec![b'x'; (MAX_LOG_BYTES + 1) as usize]).unwrap();
        append_entry(&log, "baru\n").unwrap();
        assert_eq!(fs::read_to_string(&log).unwrap(), "baru\n");
        assert_eq!(
            fs::metadata(log.with_extension("log.old")).unwrap().len(),
            MAX_LOG_BYTES + 1
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn telemetry_defaults_off_and_preview_is_exactly_the_log_text() {
        let db = AppDb::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join(format!("qr_tele_{}", ulid::Ulid::generate()));
        let log = dir.join("crash.log");

        // Tanpa log: default mati, pratinjau kosong, tidak ada pengiriman.
        let st = build_status(&db, &log).unwrap();
        assert!(!st.opt_in);
        assert!(!st.upload_implemented);
        assert_eq!(
            (st.entries, st.preview.as_str(), st.preview_truncated),
            (0, "", false)
        );

        let entry = format_crash_entry(
            5,
            "0.1.0",
            "linux",
            "aarch64",
            "boom",
            Some(("a/b/c.rs", 1, 2)),
        );
        append_entry(&log, &entry).unwrap();
        write_opt_in(&db, true).unwrap();
        let st = build_status(&db, &log).unwrap();
        assert!(st.opt_in);
        assert_eq!(st.preview, entry, "pratinjau harus persis isi crash.log");
        assert_eq!(st.entries, 1);
        write_opt_in(&db, false).unwrap();
        assert!(!read_opt_in(&db).unwrap());

        // Log sangat panjang: pratinjau memotong dari depan pada batas baris.
        let many: String = (0..20_000).map(|i| format!("baris {i}\n")).collect();
        fs::write(&log, &many).unwrap();
        let st = build_status(&db, &log).unwrap();
        assert!(st.preview_truncated && st.preview.len() <= MAX_PREVIEW_BYTES);
        assert!(st.preview.starts_with("baris ") && many.ends_with(&st.preview));
        let _ = fs::remove_dir_all(&dir);
    }
}
