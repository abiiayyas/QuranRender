//! Indeks proyek lokal (project_index) pada app.db.
//! Mengacu ke PRD PRJ-1, PRJ-6, dan docs/engineering/02_DATABASE_SPECIFICATION.md §5.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{AppDb, StoreError};

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct ProjectIndexEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub reciter: Option<String>,
    pub category: Option<String>,
    pub status: String, // 'draft', 'ready', 'published'
    pub aspect: String, // '16:9', '9:16', '1:1', '4:5'
    #[specta(type = f64)]
    pub duration_ticks: i64,
    pub dataset_version: String,
    pub thumbnail_path: Option<String>,
    pub missing: bool,
    #[specta(type = f64)]
    pub created_at: i64,
    #[specta(type = f64)]
    pub updated_at: i64,
    #[specta(type = Option<f64>)]
    pub opened_at: Option<i64>,
}

impl AppDb {
    /// Menambah atau memperbarui rekaman indeks proyek.
    pub fn upsert_project_index(&self, entry: &ProjectIndexEntry) -> Result<(), StoreError> {
        let missing_int = if entry.missing { 1 } else { 0 };
        self.conn.execute(
            "INSERT INTO project_index (
                id, path, name, reciter, category, status, aspect,
                duration_ticks, dataset_version, thumbnail_path, missing,
                created_at, updated_at, opened_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO UPDATE SET
                path = excluded.path,
                name = excluded.name,
                reciter = excluded.reciter,
                category = excluded.category,
                status = excluded.status,
                aspect = excluded.aspect,
                duration_ticks = excluded.duration_ticks,
                dataset_version = excluded.dataset_version,
                thumbnail_path = excluded.thumbnail_path,
                missing = excluded.missing,
                updated_at = excluded.updated_at,
                opened_at = excluded.opened_at",
            params![
                entry.id,
                entry.path,
                entry.name,
                entry.reciter,
                entry.category,
                entry.status,
                entry.aspect,
                entry.duration_ticks,
                entry.dataset_version,
                entry.thumbnail_path,
                missing_int,
                entry.created_at,
                entry.updated_at,
                entry.opened_at,
            ],
        )?;

        Ok(())
    }

    /// Mengambil daftar seluruh proyek yang terindeks, diurutkan dari yang terakhir diubah.
    pub fn list_project_index(&self) -> Result<Vec<ProjectIndexEntry>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, reciter, category, status, aspect,
                    duration_ticks, dataset_version, thumbnail_path, missing,
                    created_at, updated_at, opened_at
             FROM project_index
             ORDER BY updated_at DESC",
        )?;

        let rows = stmt.query_map([], |r| {
            let missing_int: i32 = r.get(10)?;
            Ok(ProjectIndexEntry {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                reciter: r.get(3)?,
                category: r.get(4)?,
                status: r.get(5)?,
                aspect: r.get(6)?,
                duration_ticks: r.get(7)?,
                dataset_version: r.get(8)?,
                thumbnail_path: r.get(9)?,
                missing: missing_int != 0,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                opened_at: r.get(13)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    /// Mengambil informasi indeks proyek berdasarkan ID.
    pub fn get_project_index(&self, id: &str) -> Result<Option<ProjectIndexEntry>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, reciter, category, status, aspect,
                    duration_ticks, dataset_version, thumbnail_path, missing,
                    created_at, updated_at, opened_at
             FROM project_index WHERE id = ?1",
        )?;

        let mut rows = stmt.query([id])?;
        if let Some(r) = rows.next()? {
            let missing_int: i32 = r.get(10)?;
            Ok(Some(ProjectIndexEntry {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                reciter: r.get(3)?,
                category: r.get(4)?,
                status: r.get(5)?,
                aspect: r.get(6)?,
                duration_ticks: r.get(7)?,
                dataset_version: r.get(8)?,
                thumbnail_path: r.get(9)?,
                missing: missing_int != 0,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                opened_at: r.get(13)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// Menghapus proyek dari indeks.
    pub fn delete_project_index(&self, id: &str) -> Result<bool, StoreError> {
        let count = self
            .conn
            .execute("DELETE FROM project_index WHERE id = ?1", [id])?;
        Ok(count > 0)
    }

    /// Membangun ulang indeks proyek dengan memindai direktori (PRD PRJ-1, PRJ-6, 02 §5).
    /// Menandai `missing = 1` bila folder proyek di disk sudah tidak ada.
    pub fn rebuild_index_from_directory(&self, projects_dir: &Path) -> Result<usize, StoreError> {
        let mut indexed_count = 0;

        // 1. Periksa proyek yang ada di DB: tandai missing jika foldernya hilang
        let current_entries = self.list_project_index()?;
        for mut entry in current_entries {
            let p = Path::new(&entry.path);
            let exists = p.exists() && p.join("project.json").exists();
            if entry.missing != !exists {
                entry.missing = !exists;
                self.upsert_project_index(&entry)?;
            }
        }

        // 2. Pindai direktori untuk menemukan paket .qrproj baru
        if projects_dir.exists() {
            for dir_entry in fs::read_dir(projects_dir)? {
                let dir_entry = dir_entry?;
                let path = dir_entry.path();
                if path.is_dir() {
                    let project_json = path.join("project.json");
                    if project_json.exists() {
                        if let Ok(content) = fs::read_to_string(&project_json) {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                if let (Some(id), Some(name)) = (
                                    val.get("id").and_then(|v| v.as_str()),
                                    val.get("name").and_then(|v| v.as_str()),
                                ) {
                                    let aspect = val
                                        .get("canvas")
                                        .and_then(|c| c.get("aspect_ratio"))
                                        .and_then(|a| a.as_str())
                                        .unwrap_or("9:16")
                                        .to_string();

                                    let entry = ProjectIndexEntry {
                                        id: id.to_string(),
                                        path: path.to_string_lossy().to_string(),
                                        name: name.to_string(),
                                        reciter: val
                                            .get("reciter")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string()),
                                        category: Some("Studio".to_string()),
                                        status: "draft".to_string(),
                                        aspect,
                                        duration_ticks: 0,
                                        dataset_version: "1.0.0".to_string(),
                                        thumbnail_path: None,
                                        missing: false,
                                        created_at: val
                                            .get("created_at")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0)
                                            as i64,
                                        updated_at: val
                                            .get("updated_at")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0)
                                            as i64,
                                        opened_at: None,
                                    };
                                    self.upsert_project_index(&entry)?;
                                    indexed_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(indexed_count)
    }
}

/// Menduplikasi proyek ke folder tujuan baru dengan ID dan nama baru.
pub fn duplicate_project_folder(
    src_dir: &Path,
    dest_dir: &Path,
    new_name: &str,
    new_id: &str,
) -> Result<PathBuf, StoreError> {
    let src_json = src_dir.join("project.json");
    if !src_json.exists() {
        return Err(StoreError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
    }

    fs::create_dir_all(dest_dir)?;

    let content = fs::read_to_string(&src_json)?;
    let mut val: serde_json::Value = serde_json::from_str(&content)?;

    // Update ID, nama, dan timestamp
    val["id"] = serde_json::json!(new_id);
    val["name"] = serde_json::json!(new_name);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    val["created_at"] = serde_json::json!(now);
    val["updated_at"] = serde_json::json!(now);
    val["revision"] = serde_json::json!(1);

    let dest_json = dest_dir.join("project.json");
    fs::write(&dest_json, serde_json::to_vec_pretty(&val)?)?;

    Ok(dest_json)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_project_index_crud() {
        let db = AppDb::open_in_memory().unwrap();

        let entry1 = ProjectIndexEntry {
            id: "01J00000000000000000000001".to_string(),
            path: "/path/to/Al-Fatihah.qrproj".to_string(),
            name: "Al-Fatihah".to_string(),
            reciter: Some("Mishary Rashid".to_string()),
            category: Some("Studio".to_string()),
            status: "ready".to_string(),
            aspect: "9:16".to_string(),
            duration_ticks: 48000 * 47,
            dataset_version: "1.0.0".to_string(),
            thumbnail_path: None,
            missing: false,
            created_at: 1000,
            updated_at: 2000,
            opened_at: Some(2050),
        };

        // 1. Insert
        db.upsert_project_index(&entry1).unwrap();

        // 2. Query single
        let fetched = db.get_project_index(&entry1.id).unwrap().unwrap();
        assert_eq!(fetched.name, "Al-Fatihah");
        assert_eq!(fetched.status, "ready");
        assert!(!fetched.missing);

        // 3. Update
        let mut entry1_mod = entry1.clone();
        entry1_mod.status = "published".to_string();
        entry1_mod.updated_at = 3000;
        db.upsert_project_index(&entry1_mod).unwrap();

        let list = db.list_project_index().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].status, "published");

        // 4. Delete
        assert!(db.delete_project_index(&entry1.id).unwrap());
        assert_eq!(db.list_project_index().unwrap().len(), 0);
    }

    #[test]
    fn test_rebuild_index_detects_missing() {
        let db = AppDb::open_in_memory().unwrap();
        let temp_dir = std::env::temp_dir().join("qr_test_rebuild_index");
        let _ = fs::create_dir_all(&temp_dir);

        let proj1_dir = temp_dir.join("P1.qrproj");
        fs::create_dir_all(&proj1_dir).unwrap();
        fs::write(
            proj1_dir.join("project.json"),
            serde_json::json!({
                "id": "PROJ_1",
                "name": "Proyek Nyata",
                "canvas": { "aspect_ratio": "9:16" },
                "created_at": 1000,
                "updated_at": 1000
            })
            .to_string(),
        )
        .unwrap();

        // Rebuild 1: mendeteksi P1
        let count = db.rebuild_index_from_directory(&temp_dir).unwrap();
        assert_eq!(count, 1);
        let list = db.list_project_index().unwrap();
        assert_eq!(list.len(), 1);
        assert!(!list[0].missing);

        // Hapus folder proyek di disk
        fs::remove_dir_all(&proj1_dir).unwrap();

        // Rebuild 2: P1 harus ditandai missing = true
        db.rebuild_index_from_directory(&temp_dir).unwrap();
        let list_after = db.list_project_index().unwrap();
        assert_eq!(list_after.len(), 1);
        assert!(
            list_after[0].missing,
            "Proyek yang foldernya terhapus harus ditandai missing = true"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
