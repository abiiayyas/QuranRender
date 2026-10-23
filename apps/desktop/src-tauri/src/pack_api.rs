//! Perintah Tauri untuk arsip proyek `.qrpack` (B2-14): ekspor proyek terdaftar dan impor ke folder baru.

use std::path::{Path, PathBuf};

use qr_core::{export_qrpack, import_qrpack, read_qrpack_manifest, Project, QrPackManifest};
use qr_store::{AppDb, ProjectIndexEntry};
use serde::Serialize;
use specta::Type;

use crate::{remove_project_folder, unique_project_dir, AppState};

#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct PackSummary {
    pub project_id: String,
    pub project_name: String,
    /// Path berkas `.qrpack` yang ditulis.
    pub path: String,
    /// Jumlah berkas di dalam arsip (project.json + aset, tanpa manifest).
    pub files: u32,
    #[specta(type = f64)]
    pub total_bytes: u64,
}

fn summarize(m: &QrPackManifest, path: &Path) -> PackSummary {
    PackSummary {
        project_id: m.project_id.clone(),
        project_name: m.project_name.clone(),
        path: path.to_string_lossy().into_owned(),
        files: m.files.len() as u32,
        total_bytes: m.files.iter().map(|f| f.size).sum(),
    }
}

/// Nama folder yang aman dari nama proyek yang datang dari arsip tak tepercaya.
fn folder_stem_from_pack_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .take(80)
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        "Proyek-impor".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn export_pack_impl(db: &AppDb, id: &str, dest: &Path) -> Result<PackSummary, String> {
    let entry = db
        .get_project_index(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Proyek dengan ID '{id}' tidak ditemukan"))?;
    let dest: PathBuf = if dest.extension().is_some() {
        dest.to_path_buf()
    } else {
        dest.with_extension("qrpack")
    };
    let manifest = export_qrpack(Path::new(&entry.path), &dest).map_err(|e| e.to_string())?;
    Ok(summarize(&manifest, &dest))
}

pub(crate) fn import_pack_impl(
    db: &std::sync::Mutex<AppDb>,
    projects_dir: &Path,
    src: &Path,
) -> Result<Project, String> {
    let manifest = read_qrpack_manifest(src).map_err(|e| e.to_string())?;
    {
        let db = db.lock().map_err(|e| e.to_string())?;
        if db
            .get_project_index(&manifest.project_id)
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err(format!(
                "Proyek dengan ID '{}' sudah ada. Gunakan 'Duplikat' bila ingin salinan; impor tidak menimpa proyek.",
                manifest.project_id
            ));
        }
    }

    std::fs::create_dir_all(projects_dir).map_err(|e| e.to_string())?;
    let dest = unique_project_dir(
        projects_dir,
        &folder_stem_from_pack_name(&manifest.project_name),
    );
    let proj = import_qrpack(src, &dest).map_err(|e| e.to_string())?;

    let entry = ProjectIndexEntry {
        id: proj.id.clone(),
        path: dest.to_string_lossy().into_owned(),
        name: proj.name.clone(),
        reciter: proj.reciter.clone(),
        category: Some("Studio".to_string()),
        status: "draft".to_string(),
        aspect: proj.canvas.aspect_ratio.clone(),
        duration_ticks: 0,
        dataset_version: "1.0.0".to_string(),
        thumbnail_path: None,
        missing: false,
        created_at: proj.created_at as i64,
        updated_at: proj.updated_at as i64,
        opened_at: Some(proj.updated_at as i64),
    };
    let registered = db
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|db| db.upsert_project_index(&entry).map_err(|e| e.to_string()));
    if let Err(e) = registered {
        // Jangan tinggalkan folder yatim yang tidak terdaftar.
        let _ = remove_project_folder(&dest);
        return Err(e);
    }
    Ok(proj)
}

/// Mengekspor proyek terdaftar ke berkas `.qrpack` di `dest` (tidak menimpa berkas yang ada).
#[tauri::command]
#[specta::specta]
pub fn project_export_pack(
    id: String,
    dest: String,
    state: tauri::State<'_, AppState>,
) -> Result<PackSummary, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    export_pack_impl(&db, &id, Path::new(&dest))
}

/// Mengimpor `.qrpack` dari `src` menjadi proyek baru yang terdaftar. Tidak pernah menimpa folder
/// atau proyek yang ada.
#[tauri::command]
#[specta::specta]
pub fn project_import_pack(
    src: String,
    state: tauri::State<'_, AppState>,
) -> Result<Project, String> {
    import_pack_impl(&state.db, &state.projects_dir, Path::new(&src))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use qr_core::{save_project_atomic, AssetKind, AssetRef};
    use std::fs;
    use std::sync::Mutex;

    fn register(db: &AppDb, dir: &Path, p: &Project) {
        db.upsert_project_index(&ProjectIndexEntry {
            id: p.id.clone(),
            path: dir.to_string_lossy().into_owned(),
            name: p.name.clone(),
            reciter: None,
            category: Some("Studio".into()),
            status: "draft".into(),
            aspect: "9:16".into(),
            duration_ticks: 0,
            dataset_version: "1.0.0".into(),
            thumbnail_path: None,
            missing: false,
            created_at: 1,
            updated_at: 1,
            opened_at: None,
        })
        .unwrap();
    }

    #[test]
    fn folder_stem_neutralizes_hostile_names() {
        assert_eq!(
            folder_stem_from_pack_name("../../etc/passwd"),
            "-..-etc-passwd"
        );
        assert_eq!(folder_stem_from_pack_name(".."), "Proyek-impor");
        assert_eq!(folder_stem_from_pack_name("  "), "Proyek-impor");
        assert_eq!(folder_stem_from_pack_name("C:\\x\0y"), "C--x-y");
        assert_eq!(folder_stem_from_pack_name("Kajian Subuh"), "Kajian Subuh");
        assert!(folder_stem_from_pack_name(&"a".repeat(500)).chars().count() <= 80);
    }

    #[test]
    fn export_then_import_registers_a_new_project_without_overwriting() {
        let root = std::env::temp_dir().join(format!("qr_packapi_{}", ulid::Ulid::generate()));
        let src_proj_dir = root.join("Asal.qrproj");
        fs::create_dir_all(&root).unwrap();
        let audio = root.join("qari.wav");
        fs::write(&audio, vec![9u8; 4096]).unwrap();

        let mut p = Project::new("Proyek Asal");
        p.assets.insert(
            "a1".into(),
            AssetRef {
                id: "a1".into(),
                path: audio.to_string_lossy().into_owned(),
                sha256: String::new(),
                kind: AssetKind::Audio,
                duration_ticks: 0,
                size_bytes: 0,
            },
        );
        save_project_atomic(&src_proj_dir, &mut p).unwrap();

        let db = AppDb::open_in_memory().unwrap();
        register(&db, &src_proj_dir, &p);

        // Ekspor: ekstensi ditambahkan bila hilang; tidak menimpa.
        let summary = export_pack_impl(&db, &p.id, &root.join("keluar")).unwrap();
        assert!(summary.path.ends_with("keluar.qrpack"), "{}", summary.path);
        assert_eq!(summary.files, 2);
        assert!(summary.total_bytes >= 4096);
        assert!(export_pack_impl(&db, &p.id, &root.join("keluar.qrpack")).is_err());
        assert!(export_pack_impl(&db, "tidak-ada", &root.join("x.qrpack")).is_err());

        // Impor ke instalasi lain (indeks kosong) dua kali tidak mungkin menimpa: kedua kalinya
        // ditolak karena ID sudah terdaftar, dan folder pertama utuh.
        let projects = root.join("Projects");
        let db2 = Mutex::new(AppDb::open_in_memory().unwrap());
        let imported = import_pack_impl(&db2, &projects, Path::new(&summary.path)).unwrap();
        assert_eq!(imported.id, p.id);
        let entries = db2.lock().unwrap().list_project_index().unwrap();
        assert_eq!(entries.len(), 1);
        let dir = PathBuf::from(&entries[0].path);
        assert_eq!(dir.file_name().unwrap(), "Proyek Asal.qrproj");
        assert!(dir.starts_with(&projects) && dir.join("project.json").is_file());
        assert_eq!(
            fs::read(dir.join(&imported.assets["a1"].path)).unwrap(),
            vec![9u8; 4096]
        );
        fs::write(dir.join("catatan-pengguna.txt"), b"tetap").unwrap();

        let again = import_pack_impl(&db2, &projects, Path::new(&summary.path));
        assert!(again.unwrap_err().contains("sudah ada"));
        assert!(dir.join("catatan-pengguna.txt").is_file());
        assert_eq!(fs::read_dir(&projects).unwrap().count(), 1, "tanpa sisa");

        // Folder dengan nama sama yang sudah ada (indeks berbeda) -> nama unik, tidak menimpa.
        let db3 = Mutex::new(AppDb::open_in_memory().unwrap());
        let second = import_pack_impl(&db3, &projects, Path::new(&summary.path)).unwrap();
        assert_eq!(second.id, p.id);
        let dir2 = PathBuf::from(&db3.lock().unwrap().list_project_index().unwrap()[0].path);
        assert_eq!(dir2.file_name().unwrap(), "Proyek Asal-2.qrproj");
        assert!(dir.join("catatan-pengguna.txt").is_file());

        // Arsip rusak ditolak tanpa mendaftarkan apa pun.
        let junk = root.join("rusak.qrpack");
        fs::write(&junk, b"bukan zip").unwrap();
        let db4 = Mutex::new(AppDb::open_in_memory().unwrap());
        assert!(import_pack_impl(&db4, &root.join("P4"), &junk).is_err());
        assert!(db4.lock().unwrap().list_project_index().unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
