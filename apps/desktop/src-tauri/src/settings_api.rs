//! Pengaturan non-rahasia di tabel `setting` (app.db). Rahasia (API key, token, dst.) hanya boleh di
//! keychain OS (PRD SET-2) dan ditolak di sini sebelum menyentuh database.

use std::sync::Mutex;

use qr_store::{is_secret_key, AppDb};
use serde::{Deserialize, Serialize};
use specta::Type;

const MAX_KEY_LEN: usize = 100;

/// Nilai pengaturan skalar. Objek/array/null tidak didukung.
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum SettingValue {
    Bool(bool),
    Number(f64),
    Text(String),
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return Err(format!(
            "Kunci pengaturan harus 1–{MAX_KEY_LEN} karakter (diterima {})",
            key.len()
        ));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(format!(
            "Kunci pengaturan '{key}' hanya boleh huruf, angka, '.', '_' dan '-'"
        ));
    }
    if is_secret_key(key) {
        return Err(format!(
            "Kunci '{key}' tampak seperti rahasia (memuat key/token/secret/password). Rahasia hanya boleh di keychain OS, bukan di pengaturan."
        ));
    }
    Ok(())
}

fn to_json(value: &SettingValue) -> Result<serde_json::Value, String> {
    match value {
        SettingValue::Bool(b) => Ok(serde_json::Value::Bool(*b)),
        SettingValue::Text(s) => Ok(serde_json::Value::String(s.clone())),
        SettingValue::Number(n) => serde_json::Number::from_f64(*n)
            .map(serde_json::Value::Number)
            .ok_or_else(|| "Nilai angka harus berhingga (bukan NaN/tak hingga)".to_string()),
    }
}

fn from_json(key: &str, v: serde_json::Value) -> Result<SettingValue, String> {
    match v {
        serde_json::Value::Bool(b) => Ok(SettingValue::Bool(b)),
        serde_json::Value::String(s) => Ok(SettingValue::Text(s)),
        serde_json::Value::Number(n) => n
            .as_f64()
            .map(SettingValue::Number)
            .ok_or_else(|| format!("Nilai pengaturan '{key}' bukan angka yang valid")),
        other => Err(format!(
            "Nilai pengaturan '{key}' bertipe tidak didukung ({}); hanya boolean/angka/teks",
            match other {
                serde_json::Value::Null => "null",
                serde_json::Value::Array(_) => "array",
                _ => "objek",
            }
        )),
    }
}

pub fn settings_get_impl(db: &Mutex<AppDb>, key: &str) -> Result<Option<SettingValue>, String> {
    validate_key(key)?;
    db.lock()
        .map_err(|e| e.to_string())?
        .get_setting(key)
        .map_err(|e| e.to_string())?
        .map(|v| from_json(key, v))
        .transpose()
}

pub fn settings_set_impl(db: &Mutex<AppDb>, key: &str, value: &SettingValue) -> Result<(), String> {
    validate_key(key)?;
    let json = to_json(value)?;
    if let SettingValue::Text(s) = value {
        if s.len() > 64 * 1024 {
            return Err("Nilai teks pengaturan terlalu besar (maksimum 64 KiB)".to_string());
        }
    }
    db.lock()
        .map_err(|e| e.to_string())?
        .set_setting(key, &json)
        .map_err(|e| e.to_string())
}

/// Membaca pengaturan non-rahasia; `null` bila belum diset. Kunci bergaya rahasia ditolak.
#[tauri::command]
#[specta::specta]
pub fn settings_get(
    key: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<SettingValue>, String> {
    settings_get_impl(&state.db, &key)
}

/// Menyimpan pengaturan non-rahasia (boolean/angka/teks). Kunci memuat key/token/secret/password ditolak.
#[tauri::command]
#[specta::specta]
pub fn settings_set(
    key: String,
    value: SettingValue,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    settings_set_impl(&state.db, &key, &value)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn db() -> Mutex<AppDb> {
        Mutex::new(AppDb::open_in_memory().unwrap())
    }

    #[test]
    fn roundtrips_bool_number_and_text_and_overwrites() {
        let db = db();
        assert_eq!(settings_get_impl(&db, "ui.tema").unwrap(), None);
        settings_set_impl(&db, "ui.tema", &SettingValue::Text("gelap".into())).unwrap();
        settings_set_impl(&db, "ekspor.lebar", &SettingValue::Number(1080.0)).unwrap();
        settings_set_impl(&db, "ui.sidebar", &SettingValue::Bool(true)).unwrap();
        assert_eq!(
            settings_get_impl(&db, "ui.tema").unwrap(),
            Some(SettingValue::Text("gelap".into()))
        );
        assert_eq!(
            settings_get_impl(&db, "ekspor.lebar").unwrap(),
            Some(SettingValue::Number(1080.0))
        );
        assert_eq!(
            settings_get_impl(&db, "ui.sidebar").unwrap(),
            Some(SettingValue::Bool(true))
        );
        settings_set_impl(&db, "ui.tema", &SettingValue::Text("terang".into())).unwrap();
        assert_eq!(
            settings_get_impl(&db, "ui.tema").unwrap(),
            Some(SettingValue::Text("terang".into()))
        );
    }

    #[test]
    fn secret_looking_keys_are_rejected_for_get_and_set_and_nothing_is_stored() {
        let db = db();
        for key in [
            "api_key",
            "quran.com.token",
            "Client-Secret",
            "db_password",
            "APIKEY",
        ] {
            let err =
                settings_set_impl(&db, key, &SettingValue::Text("rahasia".into())).unwrap_err();
            assert!(err.contains("rahasia"), "{key}: {err}");
            assert!(settings_get_impl(&db, key).is_err());
        }
        let n: i64 = db
            .lock()
            .unwrap()
            .connection()
            .query_row("SELECT COUNT(*) FROM setting", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn malformed_keys_and_values_are_rejected() {
        let db = db();
        assert!(settings_set_impl(&db, "", &SettingValue::Bool(true)).is_err());
        assert!(settings_set_impl(&db, "a b", &SettingValue::Bool(true)).is_err());
        assert!(settings_set_impl(&db, "../x", &SettingValue::Bool(true)).is_err());
        assert!(settings_set_impl(&db, &"k".repeat(101), &SettingValue::Bool(true)).is_err());
        assert!(settings_set_impl(&db, "ok", &SettingValue::Number(f64::NAN)).is_err());
        assert!(settings_set_impl(&db, "ok", &SettingValue::Number(f64::INFINITY)).is_err());
        assert!(settings_set_impl(&db, "ok", &SettingValue::Text("x".repeat(70_000))).is_err());
    }

    #[test]
    fn non_scalar_stored_values_are_reported_not_coerced() {
        let db = db();
        db.lock()
            .unwrap()
            .set_setting("legacy", &serde_json::json!({"a": 1}))
            .unwrap();
        let err = settings_get_impl(&db, "legacy").unwrap_err();
        assert!(err.contains("tidak didukung"), "{err}");
    }

    #[test]
    fn untagged_json_shape_is_plain_scalar() {
        assert_eq!(
            serde_json::to_string(&SettingValue::Bool(false)).unwrap(),
            "false"
        );
        assert_eq!(
            serde_json::to_string(&SettingValue::Number(2.5)).unwrap(),
            "2.5"
        );
        let v: SettingValue = serde_json::from_str("\"x\"").unwrap();
        assert_eq!(v, SettingValue::Text("x".into()));
    }
}
