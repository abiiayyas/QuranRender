//! Validator kebijakan konten CNT-1..5 dan validasi pra-ekspor lengkap (PRD §6, CNT-1..5, EXP-5, EXP-6, B2-10).
//! Mengacu ke docs/product/PRD.md §6, §7 EXP-5..6 dan docs/engineering/01_TECHNICAL_HANDOFF.md §11.

pub mod package;

pub use package::{generate_credits_text, generate_upload_text, validate_cnt3_cnt4_metadata};

use qr_core::project::{Project, TrackKind};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::Path;
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
    /// Kesalahan fatal yang memblokir ekspor sesuai PRD CNT-1..5 / EXP-6.
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
                    "Segmen '{}:{}' memiliki waktu mulai ({}) yang lebih besar atau sama dengan waktu selesai ({}). Sesuaikan batas segmen di timeline.",
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
                        "Segmen '{}:{}' memotong kata indeks {}. Batas kata ({}-{}) melampaui rentang segmen ({}-{}). Geser titik potong agar kata tetap utuh.",
                        seg.surah_id, seg.ayah_number, wt.word_idx, wt.start_tick, wt.end_tick, seg.start_tick, seg.end_tick
                    ),
                    severity: ViolationSeverity::Blocking,
                    segment_id: Some(seg.id.clone()),
                });
            }
        }
    }
}

/// CNT-1 untuk ayat yang dibagi per rentang kata: rentang harus valid (mulai ≥ 1, mulai ≤ akhir) dan
/// tidak boleh tumpang tindih antar-segmen pada ayat yang sama. Pemotongan hanya di batas kata, karena
/// rentang dinyatakan dalam indeks kata utuh.
pub fn validate_cnt1_word_ranges(project: &Project, report: &mut ExportValidationReport) {
    use std::collections::BTreeMap;
    let mut by_ayah: BTreeMap<(u32, u32), Vec<&qr_core::project::AyahSegment>> = BTreeMap::new();
    for seg in &project.segments {
        if let Some((a, b)) = seg.word_range {
            if a == 0 || a > b {
                report.add(PolicyViolation {
                    code: "CNT-1".into(),
                    title: "Rentang kata segmen tidak valid".into(),
                    description: format!(
                        "Segmen '{}:{}' memiliki rentang kata {a}-{b}. Indeks kata dimulai dari 1 dan awal tidak boleh melebihi akhir.",
                        seg.surah_id, seg.ayah_number
                    ),
                    severity: ViolationSeverity::Blocking,
                    segment_id: Some(seg.id.clone()),
                });
                continue;
            }
        }
        by_ayah
            .entry((seg.surah_id, seg.ayah_number))
            .or_default()
            .push(seg);
    }
    for ((s, a), segs) in by_ayah {
        let mut ranged: Vec<_> = segs
            .iter()
            .filter_map(|g| g.word_range.map(|r| (r, g)))
            .collect();
        ranged.sort_by_key(|((from, _), _)| *from);
        for pair in ranged.windows(2) {
            let ((_, prev_end), _) = pair[0];
            let ((next_start, _), seg) = pair[1];
            if next_start <= prev_end {
                report.add(PolicyViolation {
                    code: "CNT-1".into(),
                    title: "Rentang kata antar-segmen tumpang tindih".into(),
                    description: format!(
                        "Ayat {s}:{a}: segmen lain sudah menampilkan kata sampai indeks {prev_end}, sedangkan segmen ini mulai dari {next_start}. Satu kata tidak boleh tampil di dua segmen."
                    ),
                    severity: ViolationSeverity::Blocking,
                    segment_id: Some(seg.id.clone()),
                });
            }
        }
        // Segmen tanpa rentang bercampur dengan segmen berrentang pada ayat yang sama = ambigu.
        if segs.len() > 1 && segs.iter().any(|g| g.word_range.is_none()) {
            report.add(PolicyViolation {
                code: "CNT-1".into(),
                title: "Pembagian ayat ambigu".into(),
                description: format!("Ayat {s}:{a} muncul di beberapa segmen, tetapi tidak semuanya memiliki rentang kata."),
                severity: ViolationSeverity::Warning,
                segment_id: None,
            });
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

/// Validator EXP-6: Pemeriksaan aset hilang pada disk fisik (PRD EXP-6, B2-10).
pub fn validate_assets_presence(project: &Project, report: &mut ExportValidationReport) {
    for (asset_id, asset_ref) in &project.assets {
        let path = Path::new(&asset_ref.path);
        if !path.exists() {
            report.add(PolicyViolation {
                code: "EXP-MISSING-ASSET".into(),
                title: "Aset media tidak ditemukan di disk".into(),
                description: format!(
                    "Aset '{}' ({:?}) hilang atau telah dipindahkan. Sambungkan kembali (relink) file sumber sebelum mengekspor.",
                    asset_id, asset_ref.path
                ),
                severity: ViolationSeverity::Blocking,
                segment_id: None,
            });
        }
    }
}

/// Validator EXP-6: Pemeriksaan durasi nol pada klip atau proyek (PRD EXP-6).
pub fn validate_zero_duration(project: &Project, report: &mut ExportValidationReport) {
    for track in &project.tracks {
        for clip in &track.clips {
            if clip.start_tick >= clip.end_tick {
                report.add(PolicyViolation {
                    code: "EXP-ZERO-DURATION".into(),
                    title: "Klip memiliki durasi nol atau negatif".into(),
                    description: format!(
                        "Klip '{}' pada trek '{}' memiliki rentang tick tidak valid ({}-{}). Hapus atau sesuaikan durasi klip.",
                        clip.label, track.name, clip.start_tick, clip.end_tick
                    ),
                    severity: ViolationSeverity::Blocking,
                    segment_id: Some(clip.id.clone()),
                });
            }
        }
    }
}

/// Validasi kelayakan pra-ekspor menyeluruh terhadap proyek (EXP-6).
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
    validate_cnt1_word_ranges(project, &mut report);

    // 3. Validasi CNT-2 (Integritas teks Al-Qur'an)
    validate_cnt2_text_integrity(project, &mut report);

    // 4. Validasi CNT-5 (Keterbacaan & kontras)
    validate_cnt5_legibility_and_contrast(project, &mut report);

    // 5. Validasi EXP-6 (Aset hilang di disk)
    validate_assets_presence(project, &mut report);

    // 6. Validasi EXP-6 (Durasi nol)
    validate_zero_duration(project, &mut report);

    // 7. Validasi status peninjauan (Confidence < 0.80 yang belum diverifikasi)
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

    fn seg(id: &str, range: Option<(u32, u32)>) -> AyahSegment {
        AyahSegment {
            id: id.into(),
            surah_id: 2,
            ayah_number: 282,
            start_tick: 0,
            end_tick: 48_000,
            word_timings: vec![],
            confidence: 1.0,
            manual_override: false,
            word_range: range,
        }
    }

    fn cnt1_blocking(segs: Vec<AyahSegment>) -> usize {
        let mut p = Project::new("x");
        p.segments = segs;
        let r = validate_export_readiness(&p);
        r.violations
            .iter()
            .filter(|v| v.code == "CNT-1" && v.severity == ViolationSeverity::Blocking)
            .count()
    }

    #[test]
    fn word_ranges_must_be_valid_and_not_overlap() {
        assert_eq!(
            cnt1_blocking(vec![seg("a", Some((1, 40))), seg("b", Some((41, 90)))]),
            0
        );
        assert_eq!(
            cnt1_blocking(vec![seg("a", Some((1, 40))), seg("b", Some((40, 90)))]),
            1,
            "kata 40 tampil dua kali"
        );
        assert_eq!(
            cnt1_blocking(vec![seg("a", Some((0, 5)))]),
            1,
            "indeks dimulai dari 1"
        );
        assert_eq!(
            cnt1_blocking(vec![seg("a", Some((9, 3)))]),
            1,
            "awal > akhir"
        );
        assert_eq!(cnt1_blocking(vec![seg("a", None)]), 0);
    }

    #[test]
    fn mixed_whole_and_ranged_segments_of_one_ayah_warn() {
        let mut p = Project::new("x");
        p.segments = vec![seg("a", None), seg("b", Some((1, 5)))];
        let r = validate_export_readiness(&p);
        assert!(r.violations.iter().any(|v| v.title.contains("ambigu")));
    }

    use super::*;
    use qr_core::project::{AssetKind, AssetRef, AyahSegment, Clip, Track, TrackKind, WordTiming};

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
            word_range: None,
        });

        let report = validate_export_readiness(&project);
        assert!(report.is_ready);
        assert_eq!(report.blocking_count, 0);
        assert_eq!(report.warning_count, 0);
    }

    #[test]
    fn test_missing_asset_blocks_export() {
        let mut project = Project::new("Proyek Aset Hilang");
        project.segments.push(AyahSegment {
            id: "seg_1_1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![],
            confidence: 0.98,
            manual_override: true,
            word_range: None,
        });

        project.assets.insert(
            "audio_1".into(),
            AssetRef {
                id: "audio_1".into(),
                path: "/path/to/nonexistent_audio.m4a".into(),
                sha256: "fakehash".into(),
                kind: AssetKind::Audio,
                duration_ticks: 48000 * 5,
                size_bytes: 1024,
            },
        );

        let report = validate_export_readiness(&project);
        assert!(!report.is_ready);
        assert!(report
            .violations
            .iter()
            .any(|v| v.code == "EXP-MISSING-ASSET"));
    }

    #[test]
    fn test_zero_duration_clip_blocks_export() {
        let mut project = Project::new("Proyek Klip Nol");
        project.segments.push(AyahSegment {
            id: "seg_1_1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![],
            confidence: 0.98,
            manual_override: true,
            word_range: None,
        });

        let track = Track {
            id: "t1".into(),
            name: "Overlay".into(),
            kind: TrackKind::Overlay,
            clips: vec![Clip {
                id: "c1".into(),
                asset_id: None,
                start_tick: 100,
                end_tick: 100, // Durasi 0!
                trim_in_tick: 0,
                trim_out_tick: 0,
                label: "Teks Nol".into(),
            }],
            visible: true,
            locked: false,
            muted: false,
        };
        project.tracks.push(track);

        let report = validate_export_readiness(&project);
        assert!(!report.is_ready);
        assert!(report
            .violations
            .iter()
            .any(|v| v.code == "EXP-ZERO-DURATION"));
    }
}
