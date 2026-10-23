//! Akses proyek terdaftar yang dipakai bersama oleh perintah audio, ekspor, antrean, dan playback.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use qr_core::load_project;
use qr_core::project::{AssetKind, Project, TrackKind};
use qr_store::AppDb;

/// Folder proyek dari indeks `app.db`. Gagal bila proyek tidak terdaftar atau foldernya hilang.
pub fn project_dir_for(db: &Mutex<AppDb>, id: &str) -> Result<PathBuf, String> {
    let entry = db
        .lock()
        .map_err(|e| e.to_string())?
        .get_project_index(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Proyek dengan ID '{id}' tidak ditemukan"))?;
    let dir = PathBuf::from(entry.path);
    if !dir.join("project.json").is_file() {
        return Err(format!(
            "Folder proyek '{}' tidak ditemukan atau tidak berisi project.json",
            dir.display()
        ));
    }
    Ok(dir)
}

/// Memuat proyek terdaftar beserta foldernya.
pub fn load_registered(db: &Mutex<AppDb>, id: &str) -> Result<(PathBuf, Project), String> {
    let dir = project_dir_for(db, id)?;
    let project = load_project(&dir).map_err(|e| e.to_string())?;
    Ok((dir, project))
}

/// Berkas audio utama proyek: klip pertama di trek audio yang merujuk aset audio; bila tidak ada,
/// aset audio dengan id terkecil. `None` bila proyek belum punya audio.
pub fn project_audio_path(project: &Project) -> Option<PathBuf> {
    let from_track = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Audio)
        .flat_map(|t| t.clips.iter())
        .filter_map(|c| c.asset_id.as_ref())
        .filter_map(|id| project.assets.get(id))
        .find(|a| a.kind == AssetKind::Audio);
    let asset = from_track.or_else(|| {
        let mut audio: Vec<_> = project
            .assets
            .values()
            .filter(|a| a.kind == AssetKind::Audio)
            .collect();
        audio.sort_by(|a, b| a.id.cmp(&b.id));
        audio.into_iter().next()
    })?;
    Some(PathBuf::from(&asset.path))
}

/// Audio utama proyek yang harus ada di disk; galat Indonesia yang jelas bila belum diimpor atau hilang.
pub fn require_project_audio(project: &Project) -> Result<PathBuf, String> {
    let path = project_audio_path(project).ok_or_else(|| {
        "Proyek belum memiliki audio. Impor audio dulu (audio_import).".to_string()
    })?;
    if !path.is_file() {
        return Err(format!(
            "Berkas audio proyek tidak ditemukan: {} (dipindahkan atau dihapus?). Impor ulang audionya.",
            path.display()
        ));
    }
    Ok(path)
}

/// Menyimpan perubahan proyek ke folder indeksnya secara atomik dan menyegarkan entri indeks.
pub fn save_registered(
    db: &Mutex<AppDb>,
    dir: &Path,
    project: &mut Project,
    duration_ticks: Option<i64>,
) -> Result<(), String> {
    qr_core::save_project_atomic(dir, project).map_err(|e| e.to_string())?;
    let guard = db.lock().map_err(|e| e.to_string())?;
    if let Some(mut entry) = guard
        .get_project_index(&project.id)
        .map_err(|e| e.to_string())?
    {
        entry.updated_at = project.updated_at as i64;
        if let Some(d) = duration_ticks {
            entry.duration_ticks = d;
        }
        guard
            .upsert_project_index(&entry)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
pub(crate) mod test_support {
    use super::*;
    use qr_store::ProjectIndexEntry;

    /// Folder sementara yang dihapus saat di-drop.
    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(tag: &str) -> Self {
            let d = std::env::temp_dir().join(format!(
                "qr_desk_{tag}_{}",
                ulid::Ulid::generate().to_string().to_lowercase()
            ));
            std::fs::create_dir_all(&d).unwrap();
            Self(d)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Membuat proyek tersimpan di `projects_dir` dan mendaftarkannya di `db`.
    pub fn register_project(
        db: &Mutex<AppDb>,
        projects_dir: &Path,
        project: &mut Project,
    ) -> PathBuf {
        let dir = projects_dir.join(format!("{}.qrproj", project.name));
        qr_core::save_project_atomic(&dir, project).unwrap();
        let entry = ProjectIndexEntry {
            id: project.id.clone(),
            path: dir.to_string_lossy().to_string(),
            name: project.name.clone(),
            reciter: project.reciter.clone(),
            category: Some("Studio".into()),
            status: "draft".into(),
            aspect: project.canvas.aspect_ratio.clone(),
            duration_ticks: 0,
            dataset_version: "1.0.0".into(),
            thumbnail_path: None,
            missing: false,
            created_at: project.created_at as i64,
            updated_at: project.updated_at as i64,
            opened_at: None,
        };
        db.lock().unwrap().upsert_project_index(&entry).unwrap();
        dir
    }

    /// Membuat berkas audio uji (sine) lewat ffmpeg.
    pub fn make_sine_wav(path: &Path, seconds: f64, freq: u32) {
        let st = std::process::Command::new(crate::tools::media_tool("ffmpeg"))
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg(format!("sine=frequency={freq}:duration={seconds}"))
            .args(["-ar", "44100", "-ac", "2"])
            .arg(path)
            .status()
            .unwrap();
        assert!(st.success(), "ffmpeg gagal membuat audio uji");
    }
}
