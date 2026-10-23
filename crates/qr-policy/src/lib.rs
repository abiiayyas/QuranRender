//! Validator kebijakan konten CNT-1..5 dan validasi pra-ekspor (PRD §6, CNT-1..5, A1-16).
//! Mengacu ke docs/product/PRD.md §6 dan docs/engineering/01_TECHNICAL_HANDOFF.md §11.

use qr_core::project::{Project, TrackKind};
use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("Ekspor diblokir karena pelanggaran kebijakan konten: {0}")]
    Blocked(String),
}

/// Tingkat keparahan temuan validasi.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum ViolationSeverity {
    /// Peringatan non-fatal (tidak memblokir ekspor).
    Warning,
    /// Kesalahan fatal yang memblokir ekspor sesuai PRD CNT-1..5.
    Blocking,
}

/// Pelanggaran atau peringatan kebijakan konten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PolicyViolation {
    pub code: String,
    pub title: String,
    pub description: String,
    pub severity: ViolationSeverity,
    pub segment_id: Option<String>,
}

/// Laporan hasil validasi pra-ekspor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ExportValidationReport {
    pub is_ready: bool,
    #[specta(type = f64)]
    pub blocking_count: usize,
    #[specta(type = f64)]
    pub warning_count: usize,
    pub violations: Vec<PolicyViolation>,
}

impl ExportValidationReport {
    pub fn new() -> Self {
        Self {
            is_ready: true,
            blocking_count: 0,
            warning_count: 0,
            violations: Vec::new(),
        }
    }

    pub fn add(&mut self, violation: PolicyViolation) {
        if violation.severity == ViolationSeverity::Blocking {
            self.blocking_count += 1;
            self.is_ready = false;
        } else {
            self.warning_count += 1;
        }
        self.violations.push(violation);
    }
}

impl Default for ExportValidationReport {
    fn default() -> Self {
        Self::new()
    }
}

/// Validator CNT-1: Larangan pemotongan kata di perbatasan segmen.
/// Teks Arab Al-Qur'an TIDAK BOLEH dipotong di tengah kata antar-segmen.
/// Setiap batas segmen harus jatuh di batas kata (word boundary).
pub fn validate_cnt1_word_boundaries(project: &Project, report: &mut ExportValidationReport) {
    for seg in &project.segments {
        if seg.start_tick >= seg.end_tick {
            report.add(PolicyViolation {
                code: "CNT-1".into(),
                title: "Batas waktu segmen tidak valid".into(),
                description: format!(
                    "Segmen '{}:{}' memiliki waktu mulai ({}) yang lebih besar atau sama dengan waktu selesai ({}).",
                    seg.surah_id, seg.ayah_number, seg.start_tick, seg.end_tick
                ),
                severity: ViolationSeverity::Blocking,
                segment_id: Some(seg.id.clone()),
            });
        }

        // Periksa apakah timing kata berada dalam rentang segmen
        for wt in &seg.word_timings {
            if wt.start_tick < seg.start_tick || wt.end_tick > seg.end_tick {
                report.add(PolicyViolation {
                    code: "CNT-1".into(),
                    title: "Kata terpotong di perbatasan segmen".into(),
                    description: format!(
                        "Segmen '{}:{}' memotong kata indeks {}. Batas kata ({}-{}) melampaui rentang segmen ({}-{}).",
                        seg.surah_id, seg.ayah_number, wt.word_idx, wt.start_tick, wt.end_tick, seg.start_tick, seg.end_tick
                    ),
                    severity: ViolationSeverity::Blocking,
                    segment_id: Some(seg.id.clone()),
                });
            }
        }
    }
}

/// Validator CNT-2: Larangan perubahan teks Al-Qur'an.
/// Nomor surah dan ayat harus valid (surah 1..=114, ayat >= 1).
pub fn validate_cnt2_text_integrity(project: &Project, report: &mut ExportValidationReport) {
    for seg in &project.segments {
        if seg.surah_id == 0 || seg.surah_id > 114 {
            report.add(PolicyViolation {
                code: "CNT-2".into(),
                title: "Nomor surah tidak sah".into(),
                description: format!(
                    "Segmen '{}' memiliki surah_id {} yang berada di luar rentang resmi Al-Qur'an (1..114).",
                    seg.id, seg.surah_id
                ),
                severity: ViolationSeverity::Blocking,
                segment_id: Some(seg.id.clone()),
            });
        }

        if seg.ayah_number == 0 {
            report.add(PolicyViolation {
                code: "CNT-2".into(),
                title: "Nomor ayat tidak sah".into(),
                description: format!(
                    "Segmen '{}' memiliki nomor ayat 0. Penomoran ayat harus dimulai dari 1.",
                    seg.id
                ),
                severity: ViolationSeverity::Blocking,
                segment_id: Some(seg.id.clone()),
            });
        }
    }
}

/// Validator CNT-5: Keterbacaan dan kontras teks Arab Al-Qur'an.
/// Teks ayat Al-Qur'an harus selalu terbaca jelas, memiliki kontras minimal,
/// dan tidak boleh dijadikan ornamen semata.
pub fn validate_cnt5_legibility_and_contrast(
    project: &Project,
    report: &mut ExportValidationReport,
) {
    // Jika proyek memiliki latar media (foto/video), periksa apakah ada peredup (dimmer)
    let has_media_background = project
        .tracks
        .iter()
        .any(|t| t.kind == TrackKind::Background && t.clips.iter().any(|c| c.asset_id.is_some()));

    if has_media_background {
        let has_dimmer = project
            .style_overrides
            .get("background_dimmer")
            .is_some_and(|v| {
                if let Some(num) = v.as_f64() {
                    num >= 0.20 // Minimal 20% dimmer untuk latar media
                } else {
                    false
                }
            });

        if !has_dimmer {
            report.add(PolicyViolation {
                code: "CNT-5".into(),
                title: "Kontras teks ayat terhadap latar belakang kurang aman".into(),
                description: "Latar gambar/video digunakan tanpa peredup minimal 20%. Tambahkan peredup latar agar teks ayat Al-Qur'an tetap kontras dan terbaca jelas (WCAG AA).".into(),
                severity: ViolationSeverity::Warning,
                segment_id: None,
            });
        }
    }
}

/// Validasi kelayakan pra-ekspor menyeluruh terhadap proyek.
pub fn validate_export_readiness(project: &Project) -> ExportValidationReport {
    let mut report = ExportValidationReport::new();

    // 1. Validasi keberadaan segmen ayat
    if project.segments.is_empty() {
        report.add(PolicyViolation {
            code: "PRD-EMPTY".into(),
            title: "Proyek belum memiliki segmen ayat".into(),
            description: "Tidak ada segmen tilawah Al-Qur'an yang siap diekspor.".into(),
            severity: ViolationSeverity::Blocking,
            segment_id: None,
        });
        return report;
    }

    // 2. Validasi CNT-1 (Word boundary)
    validate_cnt1_word_boundaries(project, &mut report);

    // 3. Validasi CNT-2 (Integritas teks Al-Qur'an)
    validate_cnt2_text_integrity(project, &mut report);

    // 4. Validasi CNT-5 (Keterbacaan & kontras)
    validate_cnt5_legibility_and_contrast(project, &mut report);

    // 5. Validasi status peninjauan (Confidence < 0.80 yang belum diverifikasi)
    for seg in &project.segments {
        if seg.confidence < 0.80 && !seg.manual_override {
            report.add(PolicyViolation {
                code: "SYN-REVIEW".into(),
                title: "Segmen belum ditinjau".into(),
                description: format!(
                    "Segmen '{}:{}' memiliki tingkat keyakinan rendah ({:.0}%) dan belum ditinjau secara manual.",
                    seg.surah_id, seg.ayah_number, seg.confidence * 100.0
                ),
                severity: ViolationSeverity::Warning,
                segment_id: Some(seg.id.clone()),
            });
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use qr_core::project::{AyahSegment, Clip, Track, TrackKind, WordTiming};

    #[test]
    fn test_valid_project_passes_export_validation() {
        let mut project = Project::new("Proyek Uji");
        project.segments.push(AyahSegment {
            id: "seg_1_1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![WordTiming {
                word_idx: 0,
                start_tick: 0,
                end_tick: 48000,
                text: "بِسْمِ".into(),
                confidence: 0.99,
            }],
            confidence: 0.98,
            manual_override: true,
        });

        let report = validate_export_readiness(&project);
        assert!(report.is_ready);
        assert_eq!(report.blocking_count, 0);
        assert_eq!(report.warning_count, 0);
    }

    #[test]
    fn test_empty_project_blocks_export() {
        let project = Project::new("Proyek Kosong");
        let report = validate_export_readiness(&project);
        assert!(!report.is_ready);
        assert_eq!(report.blocking_count, 1);
        assert_eq!(report.violations[0].code, "PRD-EMPTY");
    }

    #[test]
    fn test_cnt1_word_split_blocks_export() {
        let mut project = Project::new("Proyek Rusak CNT-1");
        project.segments.push(AyahSegment {
            id: "seg_1_7".into(),
            surah_id: 1,
            ayah_number: 7,
            start_tick: 48000 * 10,
            end_tick: 48000 * 15,
            word_timings: vec![WordTiming {
                word_idx: 3,
                start_tick: 48000 * 14,
                end_tick: 48000 * 16,
                text: "الرَّحِيمِ".into(),
                confidence: 0.85, // Melampaui end_tick segmen (15s)!
            }],
            confidence: 0.75,
            manual_override: false,
        });

        let report = validate_export_readiness(&project);
        assert!(!report.is_ready);
        assert!(report.blocking_count >= 1);
        assert!(report.violations.iter().any(|v| v.code == "CNT-1"));
    }

    #[test]
    fn test_cnt2_invalid_surah_blocks_export() {
        let mut project = Project::new("Proyek Rusak CNT-2");
        project.segments.push(AyahSegment {
            id: "seg_invalid".into(),
            surah_id: 115, // Di luar 1..114!
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![],
            confidence: 0.90,
            manual_override: true,
        });

        let report = validate_export_readiness(&project);
        assert!(!report.is_ready);
        assert_eq!(report.blocking_count, 1);
        assert_eq!(report.violations[0].code, "CNT-2");
    }

    #[test]
    fn test_cnt5_media_without_dimmer_issues_warning() {
        let mut project = Project::new("Proyek Latar Tanpa Dimmer");
        project.segments.push(AyahSegment {
            id: "seg_1_1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![],
            confidence: 0.95,
            manual_override: true,
        });
        let track_latar = Track {
            id: "t_bg".into(),
            name: "Latar Belakang".into(),
            kind: TrackKind::Background,
            clips: vec![Clip {
                id: "c_bg".into(),
                asset_id: Some("asset_bg_image".into()),
                start_tick: 0,
                end_tick: 48000 * 5,
                trim_in_tick: 0,
                trim_out_tick: 48000 * 5,
                label: "Sunrise".into(),
            }],
            visible: true,
            locked: false,
            muted: false,
        };
        project.tracks.push(track_latar);
        // Tanpa background_dimmer di style_overrides

        let report = validate_export_readiness(&project);
        assert!(report.is_ready); // Warning tidak memblokir ekspor
        assert_eq!(report.blocking_count, 0);
        assert_eq!(report.warning_count, 1);
        assert_eq!(report.violations[0].code, "CNT-5");
    }

    #[test]
    fn test_unverified_low_confidence_issues_warning() {
        let mut project = Project::new("Proyek Perlu Tinjau");
        project.segments.push(AyahSegment {
            id: "seg_1_3".into(),
            surah_id: 1,
            ayah_number: 3,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![],
            confidence: 0.74, // < 0.80
            manual_override: false,
        });

        let report = validate_export_readiness(&project);
        assert!(report.is_ready); // Warning
        assert_eq!(report.warning_count, 1);
        assert_eq!(report.violations[0].code, "SYN-REVIEW");
    }
}
