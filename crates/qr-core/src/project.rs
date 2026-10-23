//! Model proyek QuranRender v1, penulisan atomik, manajemen lock, dan snapshot riwayat.
//! Mengacu ke PRD PRJ-2, PRJ-3, dan docs/engineering/01_TECHNICAL_HANDOFF.md §6, §8.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;
use ulid::Ulid;

#[derive(Error, Debug)]
pub enum ProjectError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Proyek sedang dikunci oleh proses lain (PID {pid})")]
    Locked { pid: u32, created_at: u64 },
    #[error("Versi skema tidak didukung: {0} (aplikasi mendukung v{1})")]
    UnsupportedSchemaVersion(u32, u32),
    #[error("File proyek tidak ditemukan di {:?}", .0)]
    NotFound(PathBuf),
    #[error("Injeksi kegagalan penulisan sengaja dipicu (fault injection)")]
    InjectedFault,
    #[error("Format arsip .qrpack rusak atau tidak valid: {0}")]
    Corrupted(String),
}

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const MAX_SNAPSHOTS: usize = 20;

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq)]
pub struct Project {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[specta(type = f64)]
    pub created_at: u64,
    #[specta(type = f64)]
    pub updated_at: u64,
    #[specta(type = f64)]
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reciter: Option<String>,
    pub canvas: CanvasConfig,
    pub template_id: String,
    #[serde(default)]
    pub assets: HashMap<String, AssetRef>,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub segments: Vec<AyahSegment>,
    #[serde(default)]
    #[specta(type = std::collections::HashMap<String, String>)]
    pub style_overrides: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq, Eq)]
pub struct CanvasConfig {
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub aspect_ratio: String,
}

impl Default for CanvasConfig {
    fn default() -> Self {
        Self {
            width: 1080,
            height: 1920,
            fps_num: 30,
            fps_den: 1,
            aspect_ratio: "9:16".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq, Eq)]
pub enum AssetKind {
    Audio,
    Video,
    Image,
    Font,
    Subtitle,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq, Eq)]
pub struct AssetRef {
    pub id: String,
    pub path: String,
    pub sha256: String,
    pub kind: AssetKind,
    #[specta(type = f64)]
    pub duration_ticks: i64,
    #[specta(type = f64)]
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq, Eq)]
pub enum TrackKind {
    Background,
    Audio,
    Ayah,
    Translation,
    Overlay,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq, Eq)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub kind: TrackKind,
    #[serde(default)]
    pub clips: Vec<Clip>,
    pub visible: bool,
    pub locked: bool,
    pub muted: bool,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq, Eq)]
pub struct Clip {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[specta(type = f64)]
    pub start_tick: i64,
    #[specta(type = f64)]
    pub end_tick: i64,
    #[specta(type = f64)]
    pub trim_in_tick: i64,
    #[specta(type = f64)]
    pub trim_out_tick: i64,
    pub label: String,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq)]
pub struct AyahSegment {
    pub id: String,
    pub surah_id: u32,
    pub ayah_number: u32,
    #[specta(type = f64)]
    pub start_tick: i64,
    #[specta(type = f64)]
    pub end_tick: i64,
    #[serde(default)]
    pub word_timings: Vec<WordTiming>,
    pub confidence: f32,
    pub manual_override: bool,
}

#[derive(Serialize, Deserialize, JsonSchema, Type, Debug, Clone, PartialEq)]
pub struct WordTiming {
    pub word_idx: u32,
    #[specta(type = f64)]
    pub start_tick: i64,
    #[specta(type = f64)]
    pub end_tick: i64,
    pub text: String,
    pub confidence: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct LockFileContent {
    pub pid: u32,
    pub machine_id: String,
    pub timestamp: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct SnapshotMeta {
    pub path: PathBuf,
    pub revision: u64,
    pub timestamp: u64,
    pub note: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl Project {
    /// Membuat proyek baru dengan nilai default.
    pub fn new(name: impl Into<String>) -> Self {
        let ts = now_ms();
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            id: Ulid::generate().to_string(),
            name: name.into(),
            created_at: ts,
            updated_at: ts,
            revision: 1,
            reciter: None,
            canvas: CanvasConfig::default(),
            template_id: "subuh".to_string(),
            assets: HashMap::new(),
            tracks: vec![
                Track {
                    id: "track_bg".to_string(),
                    name: "Latar".to_string(),
                    kind: TrackKind::Background,
                    clips: Vec::new(),
                    visible: true,
                    locked: false,
                    muted: false,
                },
                Track {
                    id: "track_audio".to_string(),
                    name: "Audio".to_string(),
                    kind: TrackKind::Audio,
                    clips: Vec::new(),
                    visible: true,
                    locked: false,
                    muted: false,
                },
                Track {
                    id: "track_ayah".to_string(),
                    name: "Ayat".to_string(),
                    kind: TrackKind::Ayah,
                    clips: Vec::new(),
                    visible: true,
                    locked: false,
                    muted: false,
                },
                Track {
                    id: "track_tr".to_string(),
                    name: "Terjemahan".to_string(),
                    kind: TrackKind::Translation,
                    clips: Vec::new(),
                    visible: true,
                    locked: false,
                    muted: false,
                },
                Track {
                    id: "track_overlay".to_string(),
                    name: "Overlay".to_string(),
                    kind: TrackKind::Overlay,
                    clips: Vec::new(),
                    visible: true,
                    locked: false,
                    muted: false,
                },
            ],
            segments: Vec::new(),
            style_overrides: HashMap::new(),
        }
    }
}

/// Menghasilkan JSON Schema untuk Project v1.
pub fn project_json_schema() -> schemars::schema::RootSchema {
    schemars::schema_for!(Project)
}

/// Penulisan atomik project.json (PRJ-3).
/// Menulis ke file sementara dengan fsync, lalu me-rename secara atomik.
pub fn save_project_atomic(project_dir: &Path, project: &mut Project) -> Result<(), ProjectError> {
    save_project_atomic_internal(project_dir, project, |_| Ok(()))
}

/// Penulisan atomik dengan dukungan injeksi kesalahan (fault injection) untuk pengujian.
pub fn save_project_atomic_fault_injected<F>(
    project_dir: &Path,
    project: &mut Project,
    fault_hook: F,
) -> Result<(), ProjectError>
where
    F: FnOnce(&Path) -> Result<(), ProjectError>,
{
    save_project_atomic_internal(project_dir, project, fault_hook)
}

fn save_project_atomic_internal<F>(
    project_dir: &Path,
    project: &mut Project,
    fault_hook: F,
) -> Result<(), ProjectError>
where
    F: FnOnce(&Path) -> Result<(), ProjectError>,
{
    fs::create_dir_all(project_dir)?;

    project.updated_at = now_ms();
    project.revision += 1;

    let target_file = project_dir.join("project.json");
    let tmp_file = project_dir.join(format!("project.json.tmp.{}", Ulid::generate()));

    // 1. Tulis ke file sementara
    {
        let mut file = File::create(&tmp_file)?;
        let json_bytes = serde_json::to_vec_pretty(project)?;
        file.write_all(&json_bytes)?;
        file.sync_all()?;
    }

    // 2. Jalankan fault injection bila ada
    fault_hook(&tmp_file)?;

    // 3. Rename atomik ke target
    fs::rename(&tmp_file, &target_file)?;

    Ok(())
}

/// Membaca project.json dari direktori proyek.
pub fn load_project(project_dir: &Path) -> Result<Project, ProjectError> {
    let target_file = project_dir.join("project.json");
    if !target_file.exists() {
        return Err(ProjectError::NotFound(target_file));
    }

    let content = fs::read_to_string(&target_file)?;
    let project: Project = serde_json::from_str(&content)?;

    if project.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(ProjectError::UnsupportedSchemaVersion(
            project.schema_version,
            CURRENT_SCHEMA_VERSION,
        ));
    }

    Ok(project)
}

/// Pengelola lock file proyek (.project.lock).
#[derive(Debug)]
pub struct ProjectLock {
    lock_path: PathBuf,
}

impl ProjectLock {
    /// Mengakuisisi lock pada direktori proyek.
    /// Gagal bila lock sudah ada dan proses pemilik masih berjalan.
    pub fn acquire(project_dir: &Path) -> Result<Self, ProjectError> {
        let lock_path = project_dir.join(".project.lock");

        if lock_path.exists() {
            if let Ok(content) = fs::read_to_string(&lock_path) {
                if let Ok(info) = serde_json::from_str::<LockFileContent>(&content) {
                    if is_process_running(info.pid) {
                        return Err(ProjectError::Locked {
                            pid: info.pid,
                            created_at: info.timestamp,
                        });
                    }
                }
            }
            // Lock kedaluwarsa / proses lama telah mati -> aman diambil alih
            let _ = fs::remove_file(&lock_path);
        }

        let info = LockFileContent {
            pid: std::process::id(),
            machine_id: "local".to_string(),
            timestamp: now_ms(),
        };

        let mut file = File::create(&lock_path)?;
        file.write_all(&serde_json::to_vec_pretty(&info)?)?;
        file.sync_all()?;

        Ok(Self { lock_path })
    }

    pub fn is_locked(project_dir: &Path) -> bool {
        let lock_path = project_dir.join(".project.lock");
        if !lock_path.exists() {
            return false;
        }
        if let Ok(content) = fs::read_to_string(&lock_path) {
            if let Ok(info) = serde_json::from_str::<LockFileContent>(&content) {
                return is_process_running(info.pid);
            }
        }
        false
    }
}

impl Drop for ProjectLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock_path);
    }
}

fn is_process_running(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }
    #[cfg(unix)]
    {
        // Safe check via command kill -0 tanpa blok unsafe
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Menyimpan snapshot riwayat versi proyek (PRJ-3).
/// Memangkas snapshot lama agar tidak melebihi MAX_SNAPSHOTS (20 snapshot).
pub fn create_snapshot(
    project_dir: &Path,
    project: &Project,
    note: &str,
) -> Result<PathBuf, ProjectError> {
    let snapshots_dir = project_dir.join(".snapshots");
    fs::create_dir_all(&snapshots_dir)?;

    let ts = now_ms();
    let file_name = format!("snapshot_{:06}_{}.json", project.revision, ts);
    let snapshot_path = snapshots_dir.join(file_name);

    let content = serde_json::to_vec_pretty(project)?;
    let mut file = File::create(&snapshot_path)?;
    file.write_all(&content)?;
    file.sync_all()?;

    // Simpan catatan ke file meta sampingan
    let meta_path = snapshot_path.with_extension("meta.json");
    let meta = SnapshotMeta {
        path: snapshot_path.clone(),
        revision: project.revision,
        timestamp: ts,
        note: note.to_string(),
    };
    fs::write(&meta_path, serde_json::to_vec_pretty(&meta)?)?;

    prune_snapshots(&snapshots_dir, MAX_SNAPSHOTS)?;

    Ok(snapshot_path)
}

/// Memangkas snapshot tertua jika jumlahnya melebihi limit.
fn prune_snapshots(snapshots_dir: &Path, max_keep: usize) -> Result<(), ProjectError> {
    let mut snapshots = Vec::new();

    if !snapshots_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(snapshots_dir)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_file()
            && p.extension().and_then(|e| e.to_str()) == Some("json")
            && !p.to_string_lossy().ends_with(".meta.json")
        {
            snapshots.push(p);
        }
    }

    // Urutkan alfabetis (karena nama berformat snapshot_{rev}_{ts}.json)
    snapshots.sort();

    if snapshots.len() > max_keep {
        let to_remove = snapshots.len() - max_keep;
        for path in snapshots.iter().take(to_remove) {
            let _ = fs::remove_file(path);
            let meta = path.with_extension("meta.json");
            let _ = fs::remove_file(meta);
        }
    }

    Ok(())
}

/// Mengembalikan daftar snapshot yang tersedia untuk proyek.
pub fn list_snapshots(project_dir: &Path) -> Result<Vec<SnapshotMeta>, ProjectError> {
    let snapshots_dir = project_dir.join(".snapshots");
    if !snapshots_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    for entry in fs::read_dir(snapshots_dir)? {
        let entry = entry?;
        let p = entry.path();
        if p.to_string_lossy().ends_with(".meta.json") {
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(meta) = serde_json::from_str::<SnapshotMeta>(&content) {
                    if meta.path.exists() {
                        list.push(meta);
                    }
                }
            }
        }
    }

    list.sort_by_key(|m| m.timestamp);
    Ok(list)
}

/// Memulihkan proyek dari snapshot tertentu.
pub fn restore_snapshot(project_dir: &Path, snapshot_path: &Path) -> Result<Project, ProjectError> {
    if !snapshot_path.exists() {
        return Err(ProjectError::NotFound(snapshot_path.to_path_buf()));
    }

    let content = fs::read_to_string(snapshot_path)?;
    let mut project: Project = serde_json::from_str(&content)?;

    // Simpan snapshot saat ini sebelum pemulihan
    if let Ok(current) = load_project(project_dir) {
        let _ = create_snapshot(project_dir, &current, "Snapshot otomatis sebelum pemulihan");
    }

    // Tulis atomik project yang dipulihkan
    save_project_atomic(project_dir, &mut project)?;

    Ok(project)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_project_schema_generation() {
        let schema = project_json_schema();
        let schema_json = serde_json::to_string_pretty(&schema).unwrap();
        assert!(schema_json.contains("\"Project\""));
        assert!(schema_json.contains("\"CanvasConfig\""));
        assert!(schema_json.contains("\"AyahSegment\""));
    }

    #[test]
    fn test_atomic_write_and_load() {
        let temp_dir = std::env::temp_dir().join(format!("qr_test_proj_{}", Ulid::generate()));
        let mut proj = Project::new("Proyek Uji Al-Fatihah");
        proj.reciter = Some("Mishary Rashid".to_string());

        save_project_atomic(&temp_dir, &mut proj).unwrap();

        let loaded = load_project(&temp_dir).unwrap();
        assert_eq!(loaded.name, "Proyek Uji Al-Fatihah");
        assert_eq!(loaded.reciter, Some("Mishary Rashid".to_string()));
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.tracks.len(), 5);

        // Bersihkan
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_fault_injection_kill_during_save_leaves_project_intact() {
        let temp_dir = std::env::temp_dir().join(format!("qr_test_fault_{}", Ulid::generate()));
        let mut proj = Project::new("Proyek Asli");

        // Simpan versi awal dengan sukses
        save_project_atomic(&temp_dir, &mut proj).unwrap();
        let original_file = temp_dir.join("project.json");
        let original_content = fs::read_to_string(&original_file).unwrap();

        // Coba simpan versi kedua, tetapi injeksikan kegagalan sebelum rename
        let mut modified = proj.clone();
        modified.name = "Proyek Modifikasi Gagal".to_string();

        let res = save_project_atomic_fault_injected(&temp_dir, &mut modified, |_tmp| {
            // Simulasi proses mati / error disk sebelum rename
            Err(ProjectError::InjectedFault)
        });

        assert!(res.is_err());

        // Pastikan project.json ASLI tetap utuh dan valid!
        let post_fault_content = fs::read_to_string(&original_file).unwrap();
        assert_eq!(original_content, post_fault_content);

        let reloaded = load_project(&temp_dir).unwrap();
        assert_eq!(reloaded.name, "Proyek Asli");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_project_lock() {
        let temp_dir = std::env::temp_dir().join(format!("qr_test_lock_{}", Ulid::generate()));
        fs::create_dir_all(&temp_dir).unwrap();

        assert!(!ProjectLock::is_locked(&temp_dir));

        let lock1 = ProjectLock::acquire(&temp_dir).unwrap();
        assert!(ProjectLock::is_locked(&temp_dir));

        // Percobaan lock kedua harus gagal karena PID sama dan masih hidup
        let lock2_res = ProjectLock::acquire(&temp_dir);
        assert!(lock2_res.is_err());

        drop(lock1);
        assert!(!ProjectLock::is_locked(&temp_dir));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_snapshots_and_restore() {
        let temp_dir = std::env::temp_dir().join(format!("qr_test_snap_{}", Ulid::generate()));
        let mut proj = Project::new("Proyek Versi 1");
        save_project_atomic(&temp_dir, &mut proj).unwrap();

        let snap1 = create_snapshot(&temp_dir, &proj, "Versi 1 awal").unwrap();

        // Ubah proyek
        proj.name = "Proyek Versi 2".to_string();
        save_project_atomic(&temp_dir, &mut proj).unwrap();
        let _ = create_snapshot(&temp_dir, &proj, "Versi 2 setelah edit").unwrap();

        let list = list_snapshots(&temp_dir).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].note, "Versi 1 awal");

        // Pulihkan ke snap1
        let restored = restore_snapshot(&temp_dir, &snap1).unwrap();
        assert_eq!(restored.name, "Proyek Versi 1");

        let current = load_project(&temp_dir).unwrap();
        assert_eq!(current.name, "Proyek Versi 1");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_snapshot_pruning_max_20() {
        let temp_dir = std::env::temp_dir().join(format!("qr_test_prune_{}", Ulid::generate()));
        let mut proj = Project::new("Proyek Prune");
        save_project_atomic(&temp_dir, &mut proj).unwrap();

        // Buat 25 snapshot
        for i in 1..=25 {
            proj.revision = i;
            create_snapshot(&temp_dir, &proj, &format!("Snapshot {}", i)).unwrap();
        }

        let list = list_snapshots(&temp_dir).unwrap();
        assert_eq!(
            list.len(),
            MAX_SNAPSHOTS,
            "Jumlah snapshot harus dipangkas ke 20"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
