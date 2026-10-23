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
    #[error("Migrasi skema proyek gagal: {0}")]
    Migration(String),
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

impl CanvasConfig {
    /// Mengatur rasio beserta resolusi dasar (sisi pendek 1080 px). `false` bila rasio tidak dikenal.
    pub fn set_aspect(&mut self, aspect: &str) -> bool {
        let (w, h) = match aspect {
            "9:16" => (1080, 1920),
            "16:9" => (1920, 1080),
            "1:1" => (1080, 1080),
            "4:5" => (1080, 1350),
            _ => return false,
        };
        self.width = w;
        self.height = h;
        self.aspect_ratio = aspect.to_string();
        true
    }
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
    /// Rentang kata (1-based, inklusif) dari ayat ini yang ditampilkan segmen. `None` = seluruh ayat.
    /// Ayat panjang (mis. 2:282) dibagi ke beberapa segmen; pembagian hanya di batas kata (CNT-1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<Vec<u32>>)]
    pub word_range: Option<(u32, u32)>,
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

/// Satu langkah migrasi skema: mengubah dokumen `project.json` dari versi `from` ke `from + 1`.
/// Fungsi tidak perlu mengubah `schema_version`; kerangka migrasi menaikkannya setelah langkah sukses.
#[derive(Clone, Copy, Debug)]
pub struct Migration {
    pub from: u32,
    pub apply: fn(serde_json::Value) -> Result<serde_json::Value, ProjectError>,
}

/// Daftar migrasi produksi. Kosong karena `CURRENT_SCHEMA_VERSION` masih 1 (belum ada skema lama yang
/// pernah dirilis). Saat skema naik ke v2, tambahkan `Migration { from: 1, apply: ... }` di sini.
pub const MIGRATIONS: &[Migration] = &[];

/// Membaca project.json dari direktori proyek, memigrasikan skema lama bila perlu (dengan cadangan).
pub fn load_project(project_dir: &Path) -> Result<Project, ProjectError> {
    load_project_with(project_dir, CURRENT_SCHEMA_VERSION, MIGRATIONS)
}

/// Seperti [`load_project`] dengan versi target dan rantai migrasi yang dapat disuntikkan (untuk uji).
///
/// Skema lebih baru dari `target` ditolak. Skema lebih lama dimigrasikan berurutan; rantai yang
/// tidak lengkap ditolak sebelum menyentuh disk. Migrasi dijalankan di memori; hanya setelah hasilnya
/// valid, `project.json` lama disalin utuh ke `backups/project.v{N}.{timestamp}.json` lalu diganti
/// secara atomik. Kegagalan di tahap mana pun membiarkan `project.json` asli tidak berubah.
pub fn load_project_with(
    project_dir: &Path,
    target: u32,
    migrations: &[Migration],
) -> Result<Project, ProjectError> {
    let target_file = project_dir.join("project.json");
    if !target_file.exists() {
        return Err(ProjectError::NotFound(target_file));
    }

    let original = fs::read(&target_file)?;
    let doc: serde_json::Value = serde_json::from_slice(&original)?;
    let version = doc
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            ProjectError::Corrupted("project.json tidak memiliki schema_version yang valid".into())
        })?;
    let version = u32::try_from(version)
        .map_err(|_| ProjectError::UnsupportedSchemaVersion(u32::MAX, target))?;

    if version > target {
        return Err(ProjectError::UnsupportedSchemaVersion(version, target));
    }
    if version == target {
        return Ok(serde_json::from_value(doc)?);
    }

    // Rantai harus lengkap sebelum apa pun dijalankan.
    let mut steps = Vec::new();
    for from in version..target {
        let m = migrations.iter().find(|m| m.from == from).ok_or_else(|| {
            ProjectError::Migration(format!(
                "tidak ada migrasi dari skema v{from} ke v{} (proyek v{version}, aplikasi v{target})",
                from + 1
            ))
        })?;
        steps.push(m);
    }
    let mut doc = doc;
    for m in steps {
        doc = (m.apply)(doc)?;
        match doc.as_object_mut() {
            Some(obj) => {
                obj.insert("schema_version".into(), serde_json::json!(m.from + 1));
            }
            None => {
                return Err(ProjectError::Migration(format!(
                    "migrasi v{} menghasilkan dokumen yang bukan objek JSON",
                    m.from
                )))
            }
        }
    }
    let project: Project = serde_json::from_value(doc).map_err(|e| {
        ProjectError::Migration(format!(
            "hasil migrasi tidak valid sebagai proyek v{target}: {e}"
        ))
    })?;

    backup_raw_project(project_dir, version, &original)?;
    write_bytes_atomic(
        project_dir,
        "project.json",
        &serde_json::to_vec_pretty(&project)?,
    )?;
    Ok(project)
}

/// Menyalin `project.json` lama apa adanya ke `backups/project.v{N}.{timestamp}.json`.
fn backup_raw_project(
    project_dir: &Path,
    version: u32,
    bytes: &[u8],
) -> Result<PathBuf, ProjectError> {
    let dir = project_dir.join("backups");
    fs::create_dir_all(&dir)?;
    let mut ts = now_ms();
    loop {
        let path = dir.join(format!("project.v{version}.{ts}.json"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                let res = f.write_all(bytes).and_then(|()| f.sync_all());
                if let Err(e) = res {
                    let _ = fs::remove_file(&path);
                    return Err(e.into());
                }
                return Ok(path);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => ts += 1,
            Err(e) => return Err(e.into()),
        }
    }
}

/// Menulis berkas di `dir` secara atomik (tulis sementara + fsync + rename) tanpa mengubah revisi.
fn write_bytes_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), ProjectError> {
    let tmp = dir.join(format!("{name}.tmp.{}", Ulid::generate()));
    let res = (|| -> io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, dir.join(name))
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
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
    fn set_aspect_updates_resolution_and_rejects_unknown() {
        let mut c = CanvasConfig::default();
        assert!(c.set_aspect("16:9"));
        assert_eq!(
            (c.width, c.height, c.aspect_ratio.as_str()),
            (1920, 1080, "16:9")
        );
        assert!(c.set_aspect("4:5"));
        assert_eq!((c.width, c.height), (1080, 1350));
        assert!(!c.set_aspect("21:9"));
        assert_eq!(
            (c.width, c.height),
            (1080, 1350),
            "rasio tak dikenal tidak boleh mengubah kanvas"
        );
    }

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

    // ---- Migrasi skema (kerangka dapat disuntikkan; rantai produksi kosong) ----

    fn migrate_judul_to_name(
        mut doc: serde_json::Value,
    ) -> Result<serde_json::Value, ProjectError> {
        let obj = doc
            .as_object_mut()
            .ok_or_else(|| ProjectError::Migration("bukan objek".into()))?;
        let judul = obj
            .remove("judul")
            .ok_or_else(|| ProjectError::Migration("kunci 'judul' tidak ada".into()))?;
        obj.insert("name".into(), judul);
        Ok(doc)
    }

    fn migrate_always_fails(_: serde_json::Value) -> Result<serde_json::Value, ProjectError> {
        Err(ProjectError::Migration("sengaja gagal".into()))
    }

    fn migrate_garbage(_: serde_json::Value) -> Result<serde_json::Value, ProjectError> {
        Ok(serde_json::json!({"bukan": "proyek"}))
    }

    /// Menulis `project.json` skema "lama" (v1) dengan kunci lama `judul` menggantikan `name`.
    fn write_legacy_v1(dir: &Path) -> Vec<u8> {
        let mut v = serde_json::to_value(Project::new("x")).unwrap();
        let obj = v.as_object_mut().unwrap();
        obj.remove("name");
        obj.insert("judul".into(), serde_json::json!("Judul Lama"));
        fs::create_dir_all(dir).unwrap();
        let bytes = serde_json::to_vec_pretty(&v).unwrap();
        fs::write(dir.join("project.json"), &bytes).unwrap();
        bytes
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("qr_mig_{tag}_{}", Ulid::generate()))
    }

    #[test]
    fn production_migration_chain_is_empty_for_schema_v1() {
        assert_eq!(CURRENT_SCHEMA_VERSION, 1);
        assert!(MIGRATIONS.is_empty());
    }

    #[test]
    fn injected_migration_backs_up_original_and_result_loads() {
        let dir = tmp_dir("ok");
        let original = write_legacy_v1(&dir);
        let chain = [Migration {
            from: 1,
            apply: migrate_judul_to_name,
        }];

        let p = load_project_with(&dir, 2, &chain).unwrap();
        assert_eq!(p.name, "Judul Lama");
        assert_eq!(p.schema_version, 2);

        // Cadangan berisi byte asli versi lama.
        let backups: Vec<_> = fs::read_dir(dir.join("backups"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 1);
        let fname = backups[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(
            fname.starts_with("project.v1.") && fname.ends_with(".json"),
            "{fname}"
        );
        assert_eq!(fs::read(&backups[0]).unwrap(), original);

        // project.json di disk sudah v2 dan dapat dimuat ulang tanpa migrasi lagi.
        let again = load_project_with(&dir, 2, &chain).unwrap();
        assert_eq!(again, p);
        assert_eq!(fs::read_dir(dir.join("backups")).unwrap().count(), 1);
        assert!(
            fs::read_dir(&dir).unwrap().all(|e| !e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp.")),
            "tidak boleh ada berkas sementara"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_migration_leaves_original_untouched() {
        for (tag, apply) in [
            ("gagal", migrate_always_fails as fn(_) -> _),
            ("sampah", migrate_garbage),
        ] {
            let dir = tmp_dir(tag);
            let original = write_legacy_v1(&dir);
            let chain = [Migration { from: 1, apply }];
            let err = load_project_with(&dir, 2, &chain).unwrap_err();
            assert!(matches!(err, ProjectError::Migration(_)), "{tag}: {err}");
            assert_eq!(fs::read(dir.join("project.json")).unwrap(), original);
            assert!(!dir.join("backups").exists(), "{tag}: tidak ada cadangan");
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn incomplete_chain_newer_and_unversioned_documents_are_clear_errors() {
        let dir = tmp_dir("rantai");
        let original = write_legacy_v1(&dir);
        // v1 -> v3 hanya punya langkah 1 -> 2: ditolak sebelum menyentuh disk.
        let chain = [Migration {
            from: 1,
            apply: migrate_judul_to_name,
        }];
        let e = load_project_with(&dir, 3, &chain).unwrap_err().to_string();
        assert!(e.contains("v2") && e.contains("v3"), "{e}");
        assert_eq!(fs::read(dir.join("project.json")).unwrap(), original);
        assert!(!dir.join("backups").exists());
        // Tanpa migrasi sama sekali.
        assert!(load_project_with(&dir, 2, &[]).is_err());
        // Versi lebih baru dari aplikasi.
        let e = load_project_with(&dir, 0, &chain).unwrap_err();
        assert!(
            matches!(e, ProjectError::UnsupportedSchemaVersion(1, 0)),
            "{e}"
        );
        // Tanpa schema_version.
        fs::write(dir.join("project.json"), br#"{"id":"x"}"#).unwrap();
        assert!(matches!(
            load_project(&dir).unwrap_err(),
            ProjectError::Corrupted(_)
        ));
        let _ = fs::remove_dir_all(&dir);
    }
}
