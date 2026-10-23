use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use qr_core::{load_project, save_project_atomic, Project};
use qr_policy::{validate_export_readiness, ExportValidationReport};
use qr_render::{export_subtitles, SubtitleCue, SubtitleExportOptions};

use qr_store::{duplicate_project_folder, AppDb, ProjectIndexEntry};
use serde::Serialize;
use specta::Type;
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
        name: "QuranRender".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: "Fase 1 — Alpha (vertical slice)".to_string(),
    }
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
        proj.canvas.aspect_ratio = asp.clone();
    }

    let folder_name = format!("{}.qrproj", name.replace(['/', '\\', ':'], "-"));
    let proj_dir = state.projects_dir.join(folder_name);

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
fn subtitle_export(project: Project, options: SubtitleExportOptions) -> String {
    let cues: Vec<SubtitleCue> = project
        .segments
        .iter()
        .map(|seg| SubtitleCue {
            start_tick: seg.start_tick,
            end_tick: seg.end_tick,
            ayah_text: None,
            translation_text: None,
            surah_id: seg.surah_id,
            ayah_number: seg.ayah_number,
        })
        .collect();

    export_subtitles(&project, &cues, &options, &project.name)
}

#[tauri::command]
#[specta::specta]
fn project_delete(id: String, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = db.get_project_index(&id).map_err(|e| e.to_string())? {
        let p = PathBuf::from(&entry.path);
        if p.exists() {
            let _ = fs::remove_dir_all(&p);
        }
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
        subtitle_export
    ])
}

fn main() {
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
    fn test_greet() {
        assert_eq!(greet("Dunia".to_string()), "Salam, Dunia!");
    }

    #[test]
    fn test_get_app_info() {
        let info = get_app_info();
        assert_eq!(info.name, "QuranRender");
        assert_eq!(info.status, "Fase 1 — Alpha (vertical slice)");
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
