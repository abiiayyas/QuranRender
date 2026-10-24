//! Logika perintah render/subtitle yang tidak bergantung pada Tauri (agar bisa diuji langsung).
//! Satu jalur render untuk preview dan ekspor: `qr_render::SceneBuilder` + `SoftwareRenderer`.

use std::path::{Path, PathBuf};

use base64::Engine;
use qr_cli::background::BackgroundPlan;
use qr_core::project::SegmentKind;
use qr_core::Project;
use qr_quran::QuranDatabase;
use qr_render::{
    load_builtin_template, pixmap_digest, resolve_segment_translations, segment_content,
    words_of_ayah, FontSet, SceneBuilder, SoftwareRenderer, SubtitleCue, SubtitleTrackSelection,
    VerseSource,
};
use serde::Serialize;
use specta::Type;

#[derive(Serialize, Type, Debug, Clone)]
pub struct PreviewFrame {
    /// `data:image/png;base64,...`
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    /// Teks ayat melebihi area aman pada ukuran minimum — segmen harus dibagi per rentang kata.
    pub text_overflow: bool,
    /// SHA-256 piksel (untuk perbandingan preview↔ekspor).
    pub digest: String,
}

static BUNDLED_RESOURCES: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Dipanggil sekali saat start aplikasi dengan folder resource bundel Tauri (`resource_dir`).
pub fn set_bundled_resources(dir: PathBuf) {
    let _ = BUNDLED_RESOURCES.set(dir);
}

/// Lokasi sumber daya (font, template, dataset). Urutan: `QR_RESOURCES_DIR` → resource bundel Tauri bila
/// berisi `assets/fonts` → akar repositori (hanya build debug/dev).
pub fn resources_root() -> PathBuf {
    if let Ok(p) = std::env::var("QR_RESOURCES_DIR") {
        return PathBuf::from(p);
    }
    if let Some(dir) = BUNDLED_RESOURCES.get() {
        if dir.join("assets/fonts").is_dir() {
            return dir.clone();
        }
    }
    if cfg!(any(debug_assertions, test)) {
        return Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    }
    // Rilis tanpa resource: jalur yang jelas-jelas tidak ada agar galatnya menyebut lokasi yang dicari.
    BUNDLED_RESOURCES
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("resources-tidak-ditemukan"))
}

pub fn dataset_dir() -> PathBuf {
    std::env::var("QR_DATASET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| resources_root().join("build/dataset"))
}

/// Pemeriksaan start-up: font dimuat dan dataset lolos verifikasi tanda tangan + hash dari lokasi
/// sumber daya yang berlaku. Mengembalikan ringkasan satu baris untuk log.
pub fn self_check(pubkey: &str) -> Result<String, String> {
    let root = resources_root();
    FontSet::load(&root.join("assets"))
        .map_err(|e| format!("font tidak dapat dimuat dari {}: {e}", root.display()))?;
    let db = open_dataset(&dataset_dir(), pubkey)?;
    let info = db.get_dataset_info().map_err(|e| e.to_string())?;
    Ok(format!(
        "sumber daya OK di {} (dataset {} terverifikasi)",
        root.display(),
        info.dataset_id
    ))
}

/// Membuka `quran.db` dengan verifikasi tanda tangan + SHA-256 (CNT-2). Tidak ada jalur tanpa verifikasi.
pub fn open_dataset(dir: &Path, pubkey: &str) -> Result<QuranDatabase, String> {
    QuranDatabase::open_with_verification(
        &dir.join("quran.db"),
        &dir.join("dataset-manifest.json"),
        &dir.join("dataset-manifest.json.minisig"),
        pubkey,
    )
    .map_err(|e| format!("Dataset Quran tidak dapat dibuka ({}): {e}", dir.display()))
}

/// Cue subtitle dari teks dataset. Gagal keras bila ayat tidak ditemukan (tidak pernah teks kosong).
/// Terjemahan mengikuti `project.translation_editions` (urut, satu baris per edisi) dengan aturan yang
/// sama dengan renderer: segmen sebagian ayat memakai potongan terjemahannya, atau terjemahan ayat
/// utuh bila belum dipotong; segmen khusus memakai terjemahan bawaan.
pub fn subtitle_cues(
    project: &Project,
    verses: &dyn VerseSource,
    track: SubtitleTrackSelection,
) -> Result<Vec<SubtitleCue>, String> {
    let mut cues = Vec::with_capacity(project.segments.len());
    for seg in &project.segments {
        let v = segment_content(seg, &project.translation_editions, verses).ok_or_else(|| {
            format!(
                "Ayat {}:{} tidak ada di dataset",
                seg.surah_id, seg.ayah_number
            )
        })?;
        let ayah_text = match (seg.kind, seg.word_range) {
            (SegmentKind::Ayah, Some((a, b))) => {
                let words = words_of_ayah(&v.ayah_text).map_err(|e| e.to_string())?;
                let part: Vec<&str> = words
                    .iter()
                    .filter(|w| w.word_idx >= a && w.word_idx <= b)
                    .map(|w| w.text.as_str())
                    .collect();
                if part.is_empty() {
                    return Err(format!(
                        "Rentang kata {a}-{b} kosong pada {}:{}",
                        seg.surah_id, seg.ayah_number
                    ));
                }
                part.join(" ")
            }
            _ => v.ayah_text.clone(),
        };
        let resolved =
            resolve_segment_translations(seg, &project.translation_editions, &v.translations);
        let translation = (!resolved.is_empty()).then(|| {
            resolved
                .iter()
                .map(|t| t.text.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        });
        if matches!(
            track,
            SubtitleTrackSelection::TranslationOnly | SubtitleTrackSelection::Bilingual
        ) && translation.is_none()
            && seg.kind == SegmentKind::Ayah
        {
            return Err(format!(
                "Terjemahan ayat {}:{} tidak tersedia untuk edisi terjemahan proyek. Pilih edisi yang terpasang atau ekspor subtitle teks Arab saja.",
                seg.surah_id, seg.ayah_number
            ));
        }
        cues.push(SubtitleCue {
            start_tick: seg.start_tick,
            end_tick: seg.end_tick,
            ayah_text: Some(ayah_text),
            translation_text: translation,
            surah_id: seg.surah_id,
            ayah_number: seg.ayah_number,
        });
    }
    Ok(cues)
}

/// Merender satu frame preview memakai jalur render yang sama dengan ekspor. Kanvas diskalakan ke
/// `max_width` dengan rasio tetap (tata letak ternormalisasi, sehingga identik secara proporsional).
/// Latar media proyek diambil pada `tick` lewat `ffmpeg_bin` (di-cache); latar yang tidak bisa dimuat
/// (berkas hilang/rusak) membuat preview jatuh ke latar warna, bukan gagal.
pub fn render_preview(
    project: &Project,
    resources: &Path,
    verses: &dyn VerseSource,
    tick: i64,
    max_width: u32,
    ffmpeg_bin: &str,
) -> Result<PreviewFrame, String> {
    let fonts = FontSet::load(&resources.join("assets")).map_err(|e| e.to_string())?;
    let tpl = load_builtin_template(resources, &project.template_id)
        .map_err(|e| format!("Template '{}': {e}", project.template_id))?;

    let mut p = project.clone();
    let (w, h) = (project.canvas.width.max(1), project.canvas.height.max(1));
    let width = max_width.clamp(64, w);
    let height = ((u64::from(h) * u64::from(width)) / u64::from(w)).max(1) as u32;
    p.canvas.width = width;
    p.canvas.height = height;

    let background = match BackgroundPlan::from_project(&p) {
        Ok(Some(plan)) => plan
            .preview_frame(ffmpeg_bin, tick, width, height)
            .unwrap_or_else(|e| {
                tracing::warn!("Latar preview tidak dapat dimuat, memakai warna dasar: {e}");
                None
            }),
        Ok(None) => None,
        Err(e) => {
            tracing::warn!("Latar proyek tidak valid, preview memakai warna dasar: {e}");
            None
        }
    };

    let scene =
        SceneBuilder::build_with_background(&p, &tpl, &fonts, tick, verses, background.as_ref())
            .map_err(|e| e.to_string())?;
    let pm = SoftwareRenderer::render(&scene, &fonts).map_err(|e| e.to_string())?;
    let png = pm.encode_png().map_err(|e| e.to_string())?;
    Ok(PreviewFrame {
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ),
        width,
        height,
        text_overflow: scene.text_overflow,
        digest: pixmap_digest(&pm),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use qr_core::project::AyahSegment;
    use qr_render::VerseContent;
    use std::collections::HashMap;

    fn verses() -> HashMap<(u32, u32), VerseContent> {
        let mut m = HashMap::new();
        m.insert(
            (1, 2),
            VerseContent {
                ayah_text: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ".into(),
                translations: std::collections::BTreeMap::from([
                    (
                        "id.kemenag".to_string(),
                        "Segala puji bagi Allah, Tuhan seluruh alam.".to_string(),
                    ),
                    (
                        "en.qdc20".to_string(),
                        "[All] praise is [due] to Allah, Lord of the worlds -".to_string(),
                    ),
                ]),
                surah_name_ar: "الفاتحة".into(),
                surah_name_latin: "Al-Fatihah".into(),
            },
        );
        m
    }

    fn project(range: Option<(u32, u32)>, ayah: u32) -> Project {
        let mut p = Project::new("Uji");
        p.segments.push(AyahSegment {
            id: "s1".into(),
            surah_id: 1,
            ayah_number: ayah,
            start_tick: 0,
            end_tick: 48_000 * 4,
            word_timings: vec![],
            confidence: 1.0,
            manual_override: false,
            word_range: range,
            ..Default::default()
        });
        p
    }

    #[test]
    fn subtitle_cues_carry_real_dataset_text() {
        let cues = subtitle_cues(
            &project(None, 2),
            &verses(),
            SubtitleTrackSelection::Bilingual,
        )
        .unwrap();
        assert_eq!(cues[0].ayah_text.as_deref(), Some("الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"));
        assert!(cues[0]
            .translation_text
            .as_deref()
            .unwrap()
            .starts_with("Segala puji"));
    }

    #[test]
    fn subtitle_cues_fail_loudly_for_unknown_ayah() {
        let err = subtitle_cues(
            &project(None, 99),
            &verses(),
            SubtitleTrackSelection::AyahOnly,
        )
        .unwrap_err();
        assert!(err.contains("1:99"), "{err}");
    }

    #[test]
    fn word_range_segment_keeps_only_its_words_and_includes_translation() {
        use qr_core::project::{SegmentTranslation, TranslationStatus};
        let cues = subtitle_cues(
            &project(Some((1, 2)), 2),
            &verses(),
            SubtitleTrackSelection::AyahOnly,
        )
        .unwrap();
        assert_eq!(cues[0].ayah_text.as_deref(), Some("الْحَمْدُ لِلَّهِ"));
        // Belum dipotong: terjemahan ayat utuh (perlu ditinjau), bukan galat atau kosong.
        let mut p = project(Some((1, 2)), 2);
        let cues = subtitle_cues(&p, &verses(), SubtitleTrackSelection::Bilingual).unwrap();
        assert_eq!(
            cues[0].translation_text.as_deref(),
            Some("Segala puji bagi Allah, Tuhan seluruh alam.")
        );
        // Potongan tersimpan dipakai; edisi kedua (tanpa potongan) memakai ayat utuh, urut edisi.
        p.segments[0].translations.insert(
            "id.kemenag".into(),
            SegmentTranslation {
                text: "Segala puji bagi Allah,".into(),
                status: TranslationStatus::AutoTrimmed,
            },
        );
        p.translation_editions = vec!["id.kemenag".into(), "en.qdc20".into()];
        let cues = subtitle_cues(&p, &verses(), SubtitleTrackSelection::Bilingual).unwrap();
        assert_eq!(
            cues[0].translation_text.as_deref(),
            Some("Segala puji bagi Allah,\n[All] praise is [due] to Allah, Lord of the worlds -")
        );
        let opts = qr_render::SubtitleExportOptions {
            track: SubtitleTrackSelection::Bilingual,
            format: qr_render::SubtitleFormat::Srt,
            ..Default::default()
        };
        let srt = qr_render::export_subtitles(&p, &cues, &opts, "uji");
        assert!(
            srt.contains("الْحَمْدُ لِلَّهِ\nSegala puji bagi Allah,\n[All] praise"),
            "{srt}"
        );
    }

    #[test]
    fn special_segments_export_builtin_text_and_missing_edition_is_plain_error() {
        use qr_core::project::SegmentKind;
        let mut v = verses();
        v.insert(
            (1, 1),
            VerseContent {
                ayah_text: "بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ".into(),
                ..Default::default()
            },
        );
        let mut p = project(None, 2);
        p.segments.insert(
            0,
            AyahSegment {
                id: "b".into(),
                kind: SegmentKind::Basmala,
                end_tick: 1,
                ..Default::default()
            },
        );
        let cues = subtitle_cues(&p, &v, SubtitleTrackSelection::Bilingual).unwrap();
        assert_eq!(cues[0].ayah_text.as_deref(), Some("بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ"));
        assert_eq!(
            cues[0].translation_text.as_deref(),
            Some("Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.")
        );
        p.translation_editions = vec!["fr.qdc31".into()];
        let err = subtitle_cues(&p, &v, SubtitleTrackSelection::TranslationOnly).unwrap_err();
        assert!(err.contains("1:2") && err.contains("edisi"), "{err}");
        assert!(subtitle_cues(&p, &v, SubtitleTrackSelection::AyahOnly).is_ok());
    }

    #[test]
    fn preview_is_scaled_and_deterministic() {
        let mut p = project(None, 2);
        p.canvas.width = 1080;
        p.canvas.height = 1920;
        p.canvas.aspect_ratio = "9:16".into();
        let a =
            render_preview(&p, &resources_root(), &verses(), 48_000 * 2, 270, "ffmpeg").unwrap();
        let b =
            render_preview(&p, &resources_root(), &verses(), 48_000 * 2, 270, "ffmpeg").unwrap();
        assert_eq!((a.width, a.height), (270, 480));
        assert_eq!(a.digest, b.digest);
        assert!(a.data_url.starts_with("data:image/png;base64,"));
        assert!(!a.text_overflow);
    }

    #[test]
    fn bundled_resource_dir_is_used_only_when_it_contains_fonts() {
        // Satu-satunya tes yang memakai OnceLock global; QR_RESOURCES_DIR tidak boleh diset.
        assert!(std::env::var("QR_RESOURCES_DIR").is_err());
        let tmp = std::env::temp_dir().join(format!("qr_res_{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        set_bundled_resources(tmp.clone());
        // Tanpa assets/fonts: jatuh ke akar repositori (build debug).
        assert_ne!(resources_root(), tmp);
        std::fs::create_dir_all(tmp.join("assets/fonts")).unwrap();
        assert_eq!(resources_root(), tmp);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn preview_with_missing_template_is_an_error() {
        let mut p = project(None, 2);
        p.template_id = "tidak-ada".into();
        assert!(render_preview(&p, &resources_root(), &verses(), 0, 270, "ffmpeg").is_err());
    }

    #[test]
    #[ignore = "butuh build/dataset bertanda tangan; jalankan: cargo test -p quranrender -- --ignored"]
    fn verified_dataset_drives_subtitles_and_preview() {
        let pubkey = include_str!("../../../../assets/keys/dataset.pub");
        let db = open_dataset(&dataset_dir(), pubkey).expect("verifikasi dataset harus lolos");
        let v = qr_render::QuranDbVerses { db: &db };
        let mut p = project(None, 1);
        p.segments[0].ayah_number = 255;
        p.segments[0].surah_id = 2;
        let cues = subtitle_cues(&p, &v, SubtitleTrackSelection::Bilingual).unwrap();
        let src: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(resources_root().join("data/surah/2.json")).unwrap(),
        )
        .unwrap();
        let want = src["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["aya_number"].as_u64() == Some(255))
            .unwrap()["aya_text"]
            .as_str()
            .unwrap()
            .trim();
        assert_eq!(
            cues[0].ayah_text.as_deref(),
            Some(want),
            "teks harus byte-identik dengan sumber"
        );
        assert!(!cues[0].translation_text.as_deref().unwrap().is_empty());
        let f = render_preview(&p, &resources_root(), &v, 48_000 * 2, 360, "ffmpeg").unwrap();
        assert!(!f.digest.is_empty());
    }

    /// Latar gambar tampil di preview; berkas hilang → jatuh ke warna dasar (tanpa galat).
    #[test]
    fn preview_draws_background_image_and_falls_back_when_file_is_missing() {
        use qr_core::project::{AssetKind, AssetRef, Clip, TrackKind};
        let png = std::env::temp_dir().join(format!("qr_prev_bg_{}.png", std::process::id()));
        let st = std::process::Command::new(crate::tools::media_tool("ffmpeg"))
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=160x90",
            ])
            .args(["-frames:v", "1"])
            .arg(&png)
            .status()
            .unwrap();
        assert!(st.success());

        let plain = project(None, 2);
        let mut p = plain.clone();
        p.assets.insert(
            "bg_1".into(),
            AssetRef {
                id: "bg_1".into(),
                path: png.to_string_lossy().into_owned(),
                sha256: String::new(),
                kind: AssetKind::Image,
                duration_ticks: 0,
                size_bytes: 0,
            },
        );
        p.tracks
            .iter_mut()
            .find(|t| t.kind == TrackKind::Background)
            .unwrap()
            .clips
            .push(Clip {
                id: "clip_bg_1".into(),
                asset_id: Some("bg_1".into()),
                start_tick: 0,
                end_tick: 48_000 * 4,
                trim_in_tick: 0,
                trim_out_tick: 48_000 * 4,
                label: String::new(),
            });
        p.style_overrides
            .insert("background_dimmer".into(), serde_json::json!("0.35"));
        let tick = 48_000 * 2;
        let ffmpeg = crate::tools::media_tool("ffmpeg");
        let base =
            render_preview(&plain, &resources_root(), &verses(), tick, 270, &ffmpeg).unwrap();
        let with_bg = render_preview(&p, &resources_root(), &verses(), tick, 270, &ffmpeg).unwrap();
        let again = render_preview(&p, &resources_root(), &verses(), tick, 270, &ffmpeg).unwrap();
        assert_ne!(with_bg.digest, base.digest);
        assert_eq!(
            with_bg.digest, again.digest,
            "deterministik (termasuk dari cache)"
        );

        std::fs::remove_file(&png).unwrap();
        let missing = render_preview(&p, &resources_root(), &verses(), tick, 270, &ffmpeg).unwrap();
        assert_ne!(missing.digest, with_bg.digest);
    }
}
