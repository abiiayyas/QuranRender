mod crashlog;
mod pack_api;
mod render_api;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use qr_core::{load_project, save_project_atomic, Project};
use qr_policy::{validate_export_readiness, ExportValidationReport};
use qr_render::{export_subtitles, QuranDbVerses, SubtitleExportOptions};

use qr_store::{duplicate_project_folder, AppDb, ProjectIndexEntry};
use serde::Serialize;
use specta::Type;
#[cfg(any(debug_assertions, test))]
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};
use ulid::Ulid;

#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub status: String,
}

// State aplikasi untuk koneksi database lokal app.db
pub struct AppState {
    pub db: Mutex<AppDb>,
    pub projects_dir: PathBuf,
    /// Dataset terverifikasi, dibuka malas saat pertama dipakai.
    pub dataset: Mutex<Option<qr_quran::QuranDatabase>>,
}

const DATASET_PUBKEY: &str = include_str!("../../../../assets/keys/dataset.pub");

impl AppState {
    fn with_dataset<T>(
        &self,
        f: impl FnOnce(&qr_quran::QuranDatabase) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.dataset.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(render_api::open_dataset(
                &render_api::dataset_dir(),
                DATASET_PUBKEY,
            )?);
        }
        match guard.as_ref() {
            Some(db) => f(db),
            None => Err("Dataset tidak tersedia".to_string()),
        }
    }
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("projects_dir", &self.projects_dir)
            .finish_non_exhaustive()
    }
}

fn get_default_projects_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("QuranRender").join("Projects")
    } else if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join("QuranRender").join("Projects")
    } else {
        std::env::temp_dir().join("QuranRender").join("Projects")
    }
}

fn get_default_db_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("QuranRender").join("app.db")
    } else if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join("QuranRender").join("app.db")
    } else {
        std::env::temp_dir().join("QuranRender").join("app.db")
    }
}

#[tauri::command]
#[specta::specta]
fn greet(name: String) -> String {
    format!("Salam, {}!", name)
}

#[tauri::command]
#[specta::specta]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Quran Render".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: "Pra-alpha — Fase 1 belum selesai".to_string(),
    }
}

/// Folder proyek baru yang tidak menimpa proyek lain: `Nama.qrproj`, `Nama-2.qrproj`, ...
fn unique_project_dir(projects_dir: &std::path::Path, name: &str) -> PathBuf {
    let base = name.replace(['/', '\\', ':'], "-");
    let mut candidate = projects_dir.join(format!("{base}.qrproj"));
    let mut n = 2;
    while candidate.exists() {
        candidate = projects_dir.join(format!("{base}-{n}.qrproj"));
        n += 1;
    }
    candidate
}

#[tauri::command]
#[specta::specta]
fn project_create(
    name: String,
    reciter: Option<String>,
    aspect: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Project, String> {
    let mut proj = Project::new(&name);
    proj.reciter = reciter.clone();
    if let Some(asp) = &aspect {
        if !proj.canvas.set_aspect(asp) {
            return Err(format!(
                "Rasio tidak dikenal: {asp} (didukung: 9:16, 16:9, 1:1, 4:5)"
            ));
        }
    }

    let proj_dir = unique_project_dir(&state.projects_dir, &name);

    save_project_atomic(&proj_dir, &mut proj).map_err(|e| e.to_string())?;

    let entry = ProjectIndexEntry {
        id: proj.id.clone(),
        path: proj_dir.to_string_lossy().to_string(),
        name: proj.name.clone(),
        reciter,
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

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.upsert_project_index(&entry).map_err(|e| e.to_string())?;

    Ok(proj)
}

#[tauri::command]
#[specta::specta]
fn project_list(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectIndexEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Sinkronisasi folder dengan indeks proyek (deteksi missing)
    let _ = db.rebuild_index_from_directory(&state.projects_dir);
    db.list_project_index().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn project_open(id: String, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entry = db
        .get_project_index(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Proyek dengan ID '{}' tidak ditemukan", id))?;

    let p = PathBuf::from(&entry.path);
    let proj = load_project(&p).map_err(|e| e.to_string())?;

    // Perbarui opened_at
    let mut updated_entry = entry;
    updated_entry.opened_at = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    );
    let _ = db.upsert_project_index(&updated_entry);

    Ok(proj)
}

#[tauri::command]
#[specta::specta]
fn project_duplicate(
    id: String,
    new_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<Project, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entry = db
        .get_project_index(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Proyek dengan ID '{}' tidak ditemukan", id))?;

    let src_dir = PathBuf::from(&entry.path);
    let new_folder_name = format!("{}.qrproj", new_name.replace(['/', '\\', ':'], "-"));
    let dest_dir = state.projects_dir.join(new_folder_name);
    let new_id = Ulid::generate().to_string();

    duplicate_project_folder(&src_dir, &dest_dir, &new_name, &new_id).map_err(|e| e.to_string())?;

    let new_proj = load_project(&dest_dir).map_err(|e| e.to_string())?;

    let new_entry = ProjectIndexEntry {
        id: new_proj.id.clone(),
        path: dest_dir.to_string_lossy().to_string(),
        name: new_proj.name.clone(),
        reciter: new_proj.reciter.clone(),
        category: entry.category.clone(),
        status: "draft".to_string(),
        aspect: new_proj.canvas.aspect_ratio.clone(),
        duration_ticks: entry.duration_ticks,
        dataset_version: entry.dataset_version.clone(),
        thumbnail_path: entry.thumbnail_path.clone(),
        missing: false,
        created_at: new_proj.created_at as i64,
        updated_at: new_proj.updated_at as i64,
        opened_at: Some(new_proj.updated_at as i64),
    };

    db.upsert_project_index(&new_entry)
        .map_err(|e| e.to_string())?;

    Ok(new_proj)
}

#[tauri::command]
#[specta::specta]
fn project_save(mut project: Project, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let project_dir = state.projects_dir.join(&project.id);
    fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    save_project_atomic(&project_dir, &mut project).map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let entry = ProjectIndexEntry {
        id: project.id.clone(),
        path: project_dir.to_string_lossy().to_string(),
        name: project.name.clone(),
        reciter: project.reciter.clone(),
        category: Some("Pribadi".to_string()),
        status: "ready".to_string(),
        aspect: project.canvas.aspect_ratio.clone(),
        duration_ticks: project.canvas.fps_num as i64 * 48000,
        dataset_version: "1.0.0".into(),
        thumbnail_path: None,
        missing: false,
        created_at: project.created_at as i64,
        updated_at: project.updated_at as i64,
        opened_at: Some(project.updated_at as i64),
    };

    db.upsert_project_index(&entry).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
#[specta::specta]
fn project_validate(project: Project) -> ExportValidationReport {
    validate_export_readiness(&project)
}

#[tauri::command]
#[specta::specta]
fn subtitle_export(
    project: Project,
    options: SubtitleExportOptions,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state.with_dataset(|db| {
        let verses = QuranDbVerses {
            db,
            edition_key: Some(render_api::DEFAULT_TRANSLATION_EDITION),
        };
        let cues = render_api::subtitle_cues(&project, &verses, options.track)?;
        Ok(export_subtitles(&project, &cues, &options, &project.name))
    })
}

/// Satu frame preview dari renderer Rust yang sama dengan ekspor (prinsip #3: tanpa preview DOM).
#[tauri::command]
#[specta::specta]
fn preview_frame(
    project: Project,
    tick: f64,
    max_width: u32,
    state: tauri::State<'_, AppState>,
) -> Result<render_api::PreviewFrame, String> {
    state.with_dataset(|db| {
        let verses = QuranDbVerses {
            db,
            edition_key: Some(render_api::DEFAULT_TRANSLATION_EDITION),
        };
        render_api::render_preview(
            &project,
            &render_api::resources_root(),
            &verses,
            tick.max(0.0) as i64,
            max_width,
        )
    })
}

/// Menghapus folder proyek hanya bila benar-benar folder proyek (`*.qrproj` berisi `project.json`).
/// Entri indeks yang rusak atau dimanipulasi tidak boleh bisa menghapus folder sembarang.
fn remove_project_folder(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let is_qrproj = path.extension().is_some_and(|e| e == "qrproj");
    if !is_qrproj || !path.join("project.json").is_file() || path.is_symlink() {
        return Err(format!(
            "Menolak menghapus '{}': bukan folder proyek Quran Render (*.qrproj dengan project.json)",
            path.display()
        ));
    }
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn project_delete(id: String, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = db.get_project_index(&id).map_err(|e| e.to_string())? {
        remove_project_folder(&PathBuf::from(&entry.path))?;
        db.delete_project_index(&id).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn create_specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        greet,
        get_app_info,
        project_create,
        project_list,
        project_open,
        project_save,
        project_duplicate,
        project_delete,
        project_validate,
        subtitle_export,
        preview_frame,
        pack_api::project_export_pack,
        pack_api::project_import_pack,
        crashlog::telemetry_status,
        crashlog::telemetry_set_opt_in
    ])
}

fn main() {
    // Pertama-tama: panic apa pun (termasuk saat membuka app.db) tercatat di crash log lokal.
    crashlog::install_panic_hook(crashlog::default_log_path());
    let builder = create_specta_builder();

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/bindings.ts")
        .expect("gagal mengekspor binding typescript");

    let db_path = get_default_db_path();
    let db = AppDb::open(&db_path).expect("Gagal menginisialisasi app.db");
    let projects_dir = get_default_projects_dir();
    let _ = fs::create_dir_all(&projects_dir);

    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(db),
            projects_dir,
            dataset: Mutex::new(None),
        })
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                render_api::set_bundled_resources(dir);
            }
            match render_api::self_check(DATASET_PUBKEY) {
                Ok(msg) => eprintln!("[Quran Render] {msg}"),
                Err(e) => eprintln!("[Quran Render] PERINGATAN sumber daya: {e}"),
            }
            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("galat saat menjalankan aplikasi tauri");
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn unique_project_dir_never_reuses_an_existing_folder() {
        let tmp = std::env::temp_dir().join(format!("qr_uniq_{}", Ulid::generate()));
        fs::create_dir_all(&tmp).unwrap();
        let a = unique_project_dir(&tmp, "Kajian/Subuh");
        assert_eq!(a.file_name().unwrap(), "Kajian-Subuh.qrproj");
        fs::create_dir_all(&a).unwrap();
        let b = unique_project_dir(&tmp, "Kajian/Subuh");
        assert_eq!(b.file_name().unwrap(), "Kajian-Subuh-2.qrproj");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn remove_project_folder_refuses_anything_that_is_not_a_project() {
        let tmp = std::env::temp_dir().join(format!("qr_del_{}", Ulid::generate()));
        let proj = tmp.join("Uji.qrproj");
        let other = tmp.join("dokumen-penting");
        fs::create_dir_all(&proj).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("rahasia.txt"), "x").unwrap();
        fs::write(proj.join("project.json"), "{}").unwrap();

        assert!(remove_project_folder(&other).is_err());
        assert!(other.join("rahasia.txt").exists());
        // `.qrproj` tanpa project.json juga ditolak.
        let fake = tmp.join("Palsu.qrproj");
        fs::create_dir_all(&fake).unwrap();
        assert!(remove_project_folder(&fake).is_err());
        assert!(fake.exists());

        assert!(remove_project_folder(&proj).is_ok());
        assert!(!proj.exists());
        assert!(
            remove_project_folder(&proj).is_ok(),
            "sudah hilang: bukan galat"
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_greet() {
        assert_eq!(greet("Dunia".to_string()), "Salam, Dunia!");
    }

    #[test]
    fn test_get_app_info() {
        let info = get_app_info();
        assert_eq!(info.name, "Quran Render");
        assert_eq!(info.status, "Pra-alpha — Fase 1 belum selesai");
    }

    #[test]
    fn test_export_bindings() {
        let builder = create_specta_builder();
        builder
            .export(Typescript::default(), "../src/bindings.ts")
            .expect("gagal mengekspor binding typescript dalam test");
    }

    #[test]
    fn test_project_commands_in_memory() {
        let temp_dir = std::env::temp_dir().join(format!("qr_cmd_test_{}", Ulid::generate()));
        fs::create_dir_all(&temp_dir).unwrap();

        let db = AppDb::open_in_memory().unwrap();
        let state = AppState {
            db: Mutex::new(db),
            projects_dir: temp_dir.clone(),
            dataset: Mutex::new(None),
        };

        // Tauri state wrapper test
        // 1. Create project
        let mut proj = Project::new("Proyek Baru Alpha");
        proj.reciter = Some("Qari Uji".to_string());
        let proj_dir = temp_dir.join("Proyek-Baru-Alpha.qrproj");
        save_project_atomic(&proj_dir, &mut proj).unwrap();

        let entry = ProjectIndexEntry {
            id: proj.id.clone(),
            path: proj_dir.to_string_lossy().to_string(),
            name: proj.name.clone(),
            reciter: proj.reciter.clone(),
            category: Some("Studio".to_string()),
            status: "draft".to_string(),
            aspect: "9:16".to_string(),
            duration_ticks: 0,
            dataset_version: "1.0.0".to_string(),
            thumbnail_path: None,
            missing: false,
            created_at: 1000,
            updated_at: 1000,
            opened_at: Some(1000),
        };

        state
            .db
            .lock()
            .unwrap()
            .upsert_project_index(&entry)
            .unwrap();

        let list = state.db.lock().unwrap().list_project_index().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Proyek Baru Alpha");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
