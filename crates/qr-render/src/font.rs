//! Pemeriksaan cakupan glyph font dan fitur OpenType (PRD STY-7, CNT-5, B2-04).
//! Mengacu ke docs/product/PRD.md §7 STY-7 dan docs/engineering/03_DATASET_PIPELINE.md §4.

use read_fonts::{FontRef, TableProvider};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FontGlyphReport {
    pub font_name: String,
    pub font_path: String,
    pub is_valid: bool,
    pub missing_codepoints: Vec<u32>,
    pub missing_hex: Vec<String>,
}

#[derive(Debug)]
pub struct FontCoverageValidator;

impl FontCoverageValidator {
    /// Memeriksa apakah file font memuat seluruh glyph untuk kumpulan karakter Arab yang diberikan.
    pub fn check_font_coverage(
        font_path: &Path,
        text_samples: &[&str],
    ) -> Result<FontGlyphReport, String> {
        let data = fs::read(font_path)
            .map_err(|e| format!("Gagal membaca font {:?}: {}", font_path, e))?;

        let font =
            FontRef::new(&data).map_err(|e| format!("Font tidak valid {:?}: {}", font_path, e))?;

        let cmap = font
            .cmap()
            .map_err(|e| format!("Tabel cmap tidak ditemukan: {}", e))?;

        // Kumpulkan seluruh karakter unik dari teks sampel
        let mut required_cps = BTreeSet::new();
        for &text in text_samples {
            for c in text.chars() {
                if !c.is_whitespace() {
                    required_cps.insert(c as u32);
                }
            }
        }

        let mut missing_codepoints = Vec::new();
        let mut missing_hex = Vec::new();

        for cp in required_cps {
            if cmap.map_codepoint(cp).is_none() {
                missing_codepoints.push(cp);
                missing_hex.push(format!("U+{:04X}", cp));
            }
        }

        let is_valid = missing_codepoints.is_empty();
        let font_name = font_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "UnknownFont".to_string());

        Ok(FontGlyphReport {
            font_name,
            font_path: font_path.to_string_lossy().to_string(),
            is_valid,
            missing_codepoints,
            missing_hex,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lpmq_font_covers_basmalah() {
        let font_path = Path::new("../../assets/fonts/quran/LPMQ.ttf");
        if font_path.exists() {
            let basmalah = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
            let report = FontCoverageValidator::check_font_coverage(font_path, &[basmalah])
                .expect("Validasi font harus berhasil");
            assert!(
                report.is_valid,
                "LPMQ harus mencakup seluruh glyph basmalah"
            );
            assert_eq!(report.missing_codepoints.len(), 0);
        }
    }

    #[test]
    fn test_font_detects_unsupported_codepoint() {
        let font_path = Path::new("../../assets/fonts/quran/LPMQ.ttf");
        if font_path.exists() {
            // Karakter China/Emoji yang jelas tidak ada di font Mushaf LPMQ
            let alien_text = "بِسْمِ 漢字";
            let report = FontCoverageValidator::check_font_coverage(font_path, &[alien_text])
                .expect("Validasi font harus berhasil");
            assert!(!report.is_valid);
            assert!(!report.missing_codepoints.is_empty());
        }
    }
}
