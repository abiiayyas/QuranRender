//! Manajemen penyimpanan lokal QuranRender: app.db, project_index, pengaturan, dan migrasi.
//! Mengacu ke PRD SET-2 dan docs/engineering/02_DATABASE_SPECIFICATION.md §5.

use rusqlite::Connection;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("Database SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Kunci rahasia '{0}' dilarang disimpan di tabel setting (PRD SET-2)")]
    SecretRejected(String),
    #[error("Versi migrasi tidak valid atau lebih baru dari yang didukung aplikasi")]
    InvalidMigrationVersion,
}

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");

pub struct AppDb {
    conn: Connection,
}

impl std::fmt::Debug for AppDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppDb").finish_non_exhaustive()
    }
}

impl AppDb {
    /// Membuka atau membuat database in-memory (berguna untuk testing).
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        let mut db = Self { conn };
        db.setup_pragmas()?;
        db.migrate()?;
        Ok(db)
    }

    /// Membuka atau membuat database pada path file yang ditentukan.
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        }
        let conn = Connection::open(path)?;
        let mut db = Self { conn };
        db.setup_pragmas()?;
        db.migrate()?;
        Ok(db)
    }

    fn setup_pragmas(&self) -> Result<(), StoreError> {
        self.conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(())
    }

    /// Menjalankan migrasi bertahap berdasar `PRAGMA user_version` (02 §5).
    pub fn migrate(&mut self) -> Result<(), StoreError> {
        let current_version: i32 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;

        if current_version < 1 {
            let tx = self.conn.transaction()?;
            tx.execute_batch(INITIAL_MIGRATION)?;
            tx.execute_batch("PRAGMA user_version = 1;")?;
            tx.commit()?;
        }

        Ok(())
    }

    /// Mengambil nilai pengaturan berdasar kunci.
    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM setting WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            let val_str: String = row.get(0)?;
            let val: serde_json::Value = serde_json::from_str(&val_str)?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    /// Menyimpan pengaturan.
    /// Kunci yang memuat kata kunci rahasia (`key`, `token`, `secret`, `password`) ditolak keras (PRD SET-2).
    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<(), StoreError> {
        if is_secret_key(key) {
            return Err(StoreError::SecretRejected(key.to_string()));
        }

        let val_str = serde_json::to_string(value)?;
        self.conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, &val_str],
        )?;

        Ok(())
    }

    /// Menghapus pengaturan berdasar kunci.
    pub fn remove_setting(&self, key: &str) -> Result<bool, StoreError> {
        let affected = self
            .conn
            .execute("DELETE FROM setting WHERE key = ?1", [key])?;
        Ok(affected > 0)
    }

    /// Mendapatkan referensi koneksi SQLite di bawahnya.
    pub fn connection(&self) -> &Connection {
        &self.conn
    }
}

/// Memeriksa apakah sebuah nama kunci pengaturan berpotensi memuat kredensial / rahasia.
/// Menggunakan regex case-insensitive `/(key|token|secret|password)/i`.
pub fn is_secret_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    lower.contains("key")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_app_db_migration_from_empty() {
        let db = AppDb::open_in_memory().unwrap();
        let version: i32 = db
            .connection()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1);

        // Pastikan tabel-tabel inti ada
        let tables: Vec<String> = db
            .connection()
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|res| res.unwrap())
            .collect();

        assert!(tables.contains(&"project_index".to_string()));
        assert!(tables.contains(&"job".to_string()));
        assert!(tables.contains(&"job_event".to_string()));
        assert!(tables.contains(&"setting".to_string()));
        assert!(tables.contains(&"model_pack".to_string()));
        assert!(tables.contains(&"template_index".to_string()));
    }

    #[test]
    fn test_setting_store_and_retrieve() {
        let db = AppDb::open_in_memory().unwrap();

        // 1. Simpan pengaturan normal
        let lang = serde_json::json!("id");
        db.set_setting("ui.language", &lang).unwrap();

        let retrieved = db.get_setting("ui.language").unwrap().unwrap();
        assert_eq!(retrieved, "id");

        // 2. Timpa pengaturan
        let lang_en = serde_json::json!("en");
        db.set_setting("ui.language", &lang_en).unwrap();
        assert_eq!(db.get_setting("ui.language").unwrap().unwrap(), "en");

        // 3. Hapus pengaturan
        assert!(db.remove_setting("ui.language").unwrap());
        assert_eq!(db.get_setting("ui.language").unwrap(), None);
    }

    #[test]
    fn test_secret_rejection_in_setting_table() {
        let db = AppDb::open_in_memory().unwrap();
        let val = serde_json::json!("super_secret_val");

        // Semua variasi kunci rahasia harus ditolak (PRD SET-2)
        assert!(matches!(
            db.set_setting("llm.api_key", &val),
            Err(StoreError::SecretRejected(_))
        ));
        assert!(matches!(
            db.set_setting("hf_token", &val),
            Err(StoreError::SecretRejected(_))
        ));
        assert!(matches!(
            db.set_setting("auth.client_secret", &val),
            Err(StoreError::SecretRejected(_))
        ));
        assert!(matches!(
            db.set_setting("db_password", &val),
            Err(StoreError::SecretRejected(_))
        ));
        assert!(matches!(
            db.set_setting("SECRET_TOKEN", &val),
            Err(StoreError::SecretRejected(_))
        ));

        // Kunci normal yang tidak memuat substring rahasia harus diizinkan
        assert!(db
            .set_setting("export.default_folder", &serde_json::json!("/path"))
            .is_ok());
        assert!(db
            .set_setting("preview.resolution", &serde_json::json!("1080p"))
            .is_ok());
    }
}
