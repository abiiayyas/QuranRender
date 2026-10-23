//! Ekspor dan impor arsip proyek mandiri .qrpack (PRD PRJ-5, B2-14).
//! Mengacu ke docs/product/PRD.md §7 PRJ-5 dan docs/engineering/01_TECHNICAL_HANDOFF.md §8.1.

use crate::project::{load_project, Project, ProjectError};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPackManifest {
    pub format_version: u32,
    pub project_id: String,
    pub project_name: String,
    pub created_at: u64,
}

/// Mengekspor proyek ke berkas arsip .qrpack mandiri (PRD PRJ-5).
pub fn export_qrpack(project_dir: &Path, out_pack_path: &Path) -> Result<(), ProjectError> {
    let project = load_project(project_dir)?;

    let manifest = QrPackManifest {
        format_version: 1,
        project_id: project.id.clone(),
        project_name: project.name.clone(),
        created_at: project.created_at,
    };

    // Serialisasi manifest dan project.json
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    let project_bytes = serde_json::to_vec_pretty(&project)?;

    // Tulis ke format kontainer qrpack (format header berversi + JSON terkompresi)
    let mut file = File::create(out_pack_path)?;
    file.write_all(b"QRPK")?; // Magic 4 bytes
    file.write_all(&1u32.to_le_bytes())?; // Version 1

    let m_len = manifest_bytes.len() as u32;
    file.write_all(&m_len.to_le_bytes())?;
    file.write_all(&manifest_bytes)?;

    let p_len = project_bytes.len() as u32;
    file.write_all(&p_len.to_le_bytes())?;
    file.write_all(&project_bytes)?;

    file.sync_all()?;
    Ok(())
}

/// Mengimpor berkas arsip .qrpack ke direktori proyek lokal baru (PRD PRJ-5).
pub fn import_qrpack(
    pack_path: &Path,
    target_projects_dir: &Path,
) -> Result<Project, ProjectError> {
    let mut file = File::open(pack_path)?;

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;
    if &magic != b"QRPK" {
        return Err(ProjectError::Corrupted(
            "Magic header arsip .qrpack tidak valid".into(),
        ));
    }

    let mut ver_buf = [0u8; 4];
    file.read_exact(&mut ver_buf)?;
    let ver = u32::from_le_bytes(ver_buf);
    if ver != 1 {
        return Err(ProjectError::UnsupportedSchemaVersion(ver, 1));
    }

    // Baca manifest
    let mut m_len_buf = [0u8; 4];
    file.read_exact(&mut m_len_buf)?;
    let m_len = u32::from_le_bytes(m_len_buf) as usize;
    let mut manifest_bytes = vec![0u8; m_len];
    file.read_exact(&mut manifest_bytes)?;
    let _manifest: QrPackManifest = serde_json::from_slice(&manifest_bytes)?;

    // Baca project.json
    let mut p_len_buf = [0u8; 4];
    file.read_exact(&mut p_len_buf)?;
    let p_len = u32::from_le_bytes(p_len_buf) as usize;
    let mut project_bytes = vec![0u8; p_len];
    file.read_exact(&mut project_bytes)?;
    let project: Project = serde_json::from_slice(&project_bytes)?;

    // Ekstrak ke target folder
    let dest_dir = target_projects_dir.join(&project.id);
    fs::create_dir_all(&dest_dir)?;
    let dest_json = dest_dir.join("project.json");
    fs::write(&dest_json, &project_bytes)?;

    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::save_project_atomic;

    #[test]
    fn test_qrpack_export_and_import_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("qrpack_test_{}", ulid::Ulid::generate()));
        let proj_dir = temp_dir.join("source_project");
        let pack_file = temp_dir.join("project.qrpack");
        let import_root = temp_dir.join("imported_projects");

        fs::create_dir_all(&proj_dir).expect("Buat direktori berhasil");

        let mut project = Project::new("Proyek Portabel");
        save_project_atomic(&proj_dir, &mut project).expect("Simpan proyek berhasil");

        // 1. Ekspor ke .qrpack
        export_qrpack(&proj_dir, &pack_file).expect("Ekspor .qrpack harus berhasil");
        assert!(pack_file.exists());

        // 2. Impor dari .qrpack
        let imported =
            import_qrpack(&pack_file, &import_root).expect("Impor .qrpack harus berhasil");
        assert_eq!(imported.id, project.id);
        assert_eq!(imported.name, "Proyek Portabel");

        let imported_json = import_root.join(&project.id).join("project.json");
        assert!(imported_json.exists());

        // Bersihkan
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
