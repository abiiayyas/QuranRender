//! app.db, indeks proyek, pengaturan, keychain.

#[derive(Debug, Clone)]
pub struct StoreManager {
    pub db_path: std::path::PathBuf,
}
