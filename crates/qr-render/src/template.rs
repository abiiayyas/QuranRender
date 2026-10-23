//! Manajemen galeri template >= 12, impor/ekspor .qrtemplate, dan verifikasi ketersediaan font (PRD STY-6, B2-03).
//! Mengacu ke docs/design/05_VIDEO_TEMPLATES.md §6 dan docs/engineering/01_TECHNICAL_HANDOFF.md §7.

use crate::scene::{RenderError, TemplateConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// Laporan font yang hilang atau belum terinstal saat template dibuka/diimpor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissingFontReport {
    pub template_id: String,
    pub missing_fonts: Vec<String>,
    pub is_blocked: bool,
}

/// Mengambil daftar semua 12 template bawaan dari direktori template.
pub fn list_builtin_templates(templates_dir: &Path) -> Result<Vec<TemplateConfig>, RenderError> {
    let mut list = Vec::new();
    if !templates_dir.exists() {
        return Ok(list);
    }

    let entries = fs::read_dir(templates_dir)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let tpl_file = path.join("template.json");
            if tpl_file.exists() {
                let tpl = TemplateConfig::load_from_file(&tpl_file)?;
                list.push(tpl);
            }
        }
    }

    list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(list)
}

/// Memeriksa apakah font yang dibutuhkan template tersedia di sistem atau folder aset.
pub fn check_template_fonts_availability(
    template: &TemplateConfig,
    available_font_families: &HashSet<String>,
) -> MissingFontReport {
    let mut missing = Vec::new();

    let ayah_font = &template.typography.ayah_font;
    if !available_font_families.contains(ayah_font) {
        missing.push(ayah_font.clone());
    }

    let trans_font = &template.typography.translation_font;
    if !available_font_families.contains(trans_font) {
        missing.push(trans_font.clone());
    }

    MissingFontReport {
        template_id: template.id.clone(),
        is_blocked: !missing.is_empty(),
        missing_fonts: missing,
    }
}

/// Paket template `.qrtemplate` untuk ekspor/impor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplatePackage {
    pub manifest_version: u32,
    pub config: TemplateConfig,
    pub preview_png_base64: Option<String>,
}

impl TemplatePackage {
    pub fn export_to_json(&self) -> Result<String, RenderError> {
        serde_json::to_string_pretty(self).map_err(RenderError::Json)
    }

    pub fn import_from_json(json_str: &str) -> Result<Self, RenderError> {
        serde_json::from_str(json_str).map_err(RenderError::Json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_list_all_12_builtin_templates() {
        let dir = PathBuf::from("templates");
        let list = list_builtin_templates(&dir).expect("Harus berhasil memuat template bawaan");
        assert_eq!(
            list.len(),
            12,
            "Total template bawaan harus tepat 12 (katalog 05_VIDEO_TEMPLATES.md)"
        );

        let ids: HashSet<String> = list.into_iter().map(|t| t.id).collect();
        let expected = [
            "subuh",
            "hening",
            "terang",
            "besar",
            "senja",
            "madinah",
            "naskh",
            "modern",
            "editorial",
            "siaran",
            "tadabbur",
            "fokus",
        ];
        for id in &expected {
            assert!(ids.contains(*id), "Template {} harus ada di katalog", id);
        }
    }

    #[test]
    fn test_missing_font_report() {
        let dir = PathBuf::from("templates");
        let tpl_path = dir.join("subuh/template.json");
        let tpl = TemplateConfig::load_from_file(&tpl_path).expect("Muat template subuh berhasil");

        let mut available = HashSet::new();
        available.insert("Inter".to_string());
        // LPMQ IsepMisbah sengaja tidak dimasukkan

        let report = check_template_fonts_availability(&tpl, &available);
        assert!(report.is_blocked);
        assert_eq!(report.missing_fonts.len(), 1);
        assert_eq!(report.missing_fonts[0], "LPMQ");
    }
}
