//! Sinkron otomatis lewat aligner cloud (HF Space `hetchyy/quranic-universal-aligner`, sama dengan Quran
//! Caption): audio proyek diringkas ke FLAC mono 16 kHz di folder sementara, diunggah, lalu hasilnya
//! dipetakan ke segmen proyek. Butuh persetujuan pengguna (`sync.cloud_consent`) karena audio dikirim ke
//! internet. Tidak menyimpan proyek (seperti `align_auto`); UI meninjau lalu menyimpan lewat `project_save`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use qr_render::VerseSource;
use qr_sources::cloud_aligner::AlignerResult;
use qr_sources::{
    map_alignment, AlignProgressEvent, AlignStage, CloudAlignOptions, CloudAlignOutcome,
    CloudAlignerClient, CloudError,
};
use qr_store::AppDb;

use crate::audio_api::MediaTools;
use crate::project_io::{load_registered, require_project_audio};
use crate::settings_api::{settings_get_impl, SettingValue};

/// Nama event kemajuan sinkron (payload [`AlignProgressEvent`]).
pub const EVENT_ALIGN_PROGRESS: &str = "align-progress";
/// Kunci pengaturan persetujuan mengirim audio ke layanan cloud.
pub const CLOUD_CONSENT_KEY: &str = "sync.cloud_consent";
/// Laju sampel audio unggahan (cukup untuk pengenal ucapan; ≈1 MB per menit dalam FLAC).
const UPLOAD_SAMPLE_RATE: u32 = 16_000;

/// Menolak bila pengguna belum menyetujui pengiriman audio ke layanan cloud.
pub fn require_cloud_consent(db: &Mutex<AppDb>) -> Result<(), String> {
    match settings_get_impl(db, CLOUD_CONSENT_KEY)? {
        Some(SettingValue::Bool(true)) => Ok(()),
        _ => Err("CLOUD_CONSENT_REQUIRED: Sinkron online mengirim audio proyek ke layanan penyelaras di internet (Hugging Face). Setujui dulu sebelum melanjutkan.".to_string()),
    }
}

/// Galat cloud → pesan untuk UI; tanpa koneksi diberi awalan `CLOUD_OFFLINE:`.
pub fn cloud_error(e: CloudError) -> String {
    match e {
        CloudError::Offline => format!("CLOUD_OFFLINE: {e}"),
        other => other.to_string(),
    }
}

/// Folder kerja sementara yang dihapus saat di-drop (juga saat galat).
struct WorkDir(PathBuf);

impl WorkDir {
    fn create() -> Result<Self, String> {
        let dir = std::env::temp_dir().join(format!(
            "quranrender_align_{}",
            ulid::Ulid::generate().to_string().to_lowercase()
        ));
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Gagal membuat folder sementara untuk sinkron: {e}"))?;
        Ok(Self(dir))
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_dir_all(&self.0) {
            tracing::warn!(%e, dir = %self.0.display(), "gagal menghapus folder sementara sinkron");
        }
    }
}

/// Meringkas `input` menjadi FLAC mono 16 kHz di `out_dir`.
pub fn transcode_for_upload(ffmpeg: &str, input: &Path, out_dir: &Path) -> Result<PathBuf, String> {
    let out = out_dir.join("audio.flac");
    let res = Command::new(ffmpeg)
        .args(["-nostdin", "-v", "error", "-y", "-i"])
        .arg(input)
        .args(["-vn", "-ac", "1", "-ar"])
        .arg(UPLOAD_SAMPLE_RATE.to_string())
        .args(["-sample_fmt", "s16", "-c:a", "flac"])
        .arg(&out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg tidak dapat dijalankan untuk menyiapkan audio: {e}"))?;
    if !res.status.success() {
        return Err(format!(
            "Gagal menyiapkan audio untuk diunggah ({}): {}",
            input.display(),
            String::from_utf8_lossy(&res.stderr).trim()
        ));
    }
    Ok(out)
}

/// Persetujuan + audio proyek. Dipanggil sebelum menyentuh jaringan.
pub fn prepare_cloud_align(db: &Mutex<AppDb>, project_id: &str) -> Result<PathBuf, String> {
    require_cloud_consent(db)?;
    let (_, project) = load_registered(db, project_id)?;
    let audio = require_project_audio(&project)?;
    if !audio.is_file() {
        return Err(format!("Berkas audio tidak ditemukan: {}", audio.display()));
    }
    Ok(audio)
}

/// Meringkas audio lalu menjalankan `align` (unggah + proses). Berkas sementara selalu dihapus.
pub fn run_cloud_aligner(
    audio: &Path,
    tools: &MediaTools,
    align: impl FnOnce(&Path, &mut dyn FnMut(AlignStage, String)) -> Result<AlignerResult, CloudError>,
    progress: &mut dyn FnMut(AlignStage, String),
) -> Result<AlignerResult, String> {
    progress(
        AlignStage::Preparing,
        "Menyiapkan audio (mono 16 kHz)…".to_string(),
    );
    let work = WorkDir::create()?;
    let flac = transcode_for_upload(&tools.ffmpeg, audio, &work.0)?;
    let result = align(&flac, progress).map_err(cloud_error);
    drop(work);
    result
}

/// Kata dataset per ayat (tokenisasi sama dengan perender/`verse_words`).
pub fn dataset_words(verses: &dyn VerseSource, surah: u32, ayah: u32) -> Option<Vec<String>> {
    let v = verses.verse(surah, ayah)?;
    qr_render::words_of_ayah(&v.ayah_text)
        .ok()
        .map(|w| w.into_iter().map(|x| x.text).collect())
}

/// Memetakan hasil aligner ke segmen memakai teks dataset.
pub fn map_with_verses(
    result: &AlignerResult,
    verses: &dyn VerseSource,
    fill_silence: bool,
) -> CloudAlignOutcome {
    map_alignment(result, &|s, a| dataset_words(verses, s, a), fill_silence)
}

fn emit_progress(app: &tauri::AppHandle, stage: AlignStage, message: String) {
    use tauri::Emitter;
    if let Err(e) = app.emit(EVENT_ALIGN_PROGRESS, AlignProgressEvent { stage, message }) {
        tracing::warn!(%e, "gagal memancarkan {EVENT_ALIGN_PROGRESS}");
    }
}

/// Sinkron otomatis audio proyek lewat aligner cloud: ayat dikenali otomatis, timing per kata, segmen
/// basmalah/isti'adzah. Butuh `sync.cloud_consent = true` (galat `CLOUD_CONSENT_REQUIRED:`); tanpa internet
/// galat `CLOUD_OFFLINE:`. Memancarkan `align-progress`. Tidak menyimpan proyek.
#[tauri::command]
#[specta::specta]
pub async fn align_cloud(
    project_id: String,
    options: CloudAlignOptions,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CloudAlignOutcome, String> {
    let audio = prepare_cloud_align(&state.db, &project_id)?;
    let emitter = app.clone();
    let opts = options.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut progress = |stage, message| emit_progress(&emitter, stage, message);
        let client = CloudAlignerClient::new().map_err(cloud_error)?;
        run_cloud_aligner(
            &audio,
            &MediaTools::discover(),
            |flac, cb| client.align_file(flac, &opts, cb),
            &mut progress,
        )
    })
    .await
    .map_err(|e| format!("Proses sinkron online berhenti tak terduga: {e}"))??;

    emit_progress(
        &app,
        AlignStage::Mapping,
        "Mencocokkan hasil dengan teks ayat…".to_string(),
    );
    let outcome = state.with_dataset(|db| {
        let verses = qr_render::QuranDbVerses { db };
        Ok(map_with_verses(&result, &verses, options.fill_silence))
    })?;
    emit_progress(
        &app,
        AlignStage::Done,
        format!("Selesai: {} segmen", outcome.segments.len()),
    );
    Ok(outcome)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::audio_api::audio_import_impl;
    use crate::project_io::test_support::{make_sine_wav, register_project, TempDir};
    use crate::settings_api::settings_set_impl;
    use qr_core::project::{Project, SegmentKind};
    use qr_render::VerseContent;
    use std::collections::HashMap;

    fn tools() -> MediaTools {
        MediaTools::discover()
    }

    #[test]
    fn consent_is_required_before_anything_else() {
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let err = require_cloud_consent(&db).unwrap_err();
        assert!(err.starts_with("CLOUD_CONSENT_REQUIRED:"), "{err}");
        // Proyek tidak dikenal pun ditolak karena persetujuan lebih dulu (tidak ada akses jaringan/berkas).
        let err = prepare_cloud_align(&db, "tidak-ada").unwrap_err();
        assert!(err.starts_with("CLOUD_CONSENT_REQUIRED:"), "{err}");

        settings_set_impl(&db, CLOUD_CONSENT_KEY, &SettingValue::Bool(false)).unwrap();
        assert!(require_cloud_consent(&db)
            .unwrap_err()
            .starts_with("CLOUD_CONSENT_REQUIRED:"));
        settings_set_impl(&db, CLOUD_CONSENT_KEY, &SettingValue::Text("true".into())).unwrap();
        assert!(require_cloud_consent(&db).is_err(), "hanya boolean true");
        settings_set_impl(&db, CLOUD_CONSENT_KEY, &SettingValue::Bool(true)).unwrap();
        require_cloud_consent(&db).unwrap();
    }

    #[test]
    fn offline_errors_are_prefixed_and_others_plain() {
        assert!(cloud_error(CloudError::Offline).starts_with("CLOUD_OFFLINE: "));
        let msg = cloud_error(CloudError::Server("Layanan penyelaras sibuk.".into()));
        assert_eq!(msg, "Layanan penyelaras sibuk.");
    }

    #[test]
    fn progress_event_serializes_lowercase_stage() {
        let v = serde_json::to_value(AlignProgressEvent {
            stage: AlignStage::Preparing,
            message: "x".into(),
        })
        .unwrap();
        assert_eq!(v["stage"], "preparing");
    }

    #[test]
    fn transcodes_project_audio_to_mono_16k_flac_and_cleans_up() {
        let tmp = TempDir::new("cloud");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        settings_set_impl(&db, CLOUD_CONSENT_KEY, &SettingValue::Bool(true)).unwrap();
        let mut p = Project::new("Cloud");
        register_project(&db, tmp.path(), &mut p);

        let err = prepare_cloud_align(&db, &p.id).unwrap_err();
        assert!(err.contains("belum memiliki audio"), "{err}");

        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, 2.0, 440);
        audio_import_impl(&db, &p.id, &wav, &tools()).unwrap();
        let audio = prepare_cloud_align(&db, &p.id).unwrap();

        let mut stages = Vec::new();
        let mut seen: Option<PathBuf> = None;
        let out = run_cloud_aligner(
            &audio,
            &tools(),
            |flac, cb| {
                let meta = qr_media::probe_media_with(&tools().ffprobe, flac).unwrap();
                assert_eq!((meta.sample_rate, meta.channels), (16_000, 1));
                seen = Some(flac.to_path_buf());
                cb(AlignStage::Uploading, "unggah".into());
                Err(CloudError::Offline)
            },
            &mut |stage, _| stages.push(stage),
        );
        assert!(out.unwrap_err().starts_with("CLOUD_OFFLINE:"));
        assert_eq!(stages, vec![AlignStage::Preparing, AlignStage::Uploading]);
        let flac = seen.unwrap();
        assert!(!flac.exists(), "berkas sementara dihapus");
        assert!(!flac.parent().unwrap().exists(), "folder sementara dihapus");
    }

    #[test]
    fn maps_with_dataset_words_from_verse_source() {
        let mut verses: HashMap<(u32, u32), VerseContent> = HashMap::new();
        verses.insert(
            (112, 1),
            VerseContent {
                ayah_text: "قُلْ هُوَ اللّٰهُ اَحَدٌۚ".into(),
                surah_name_ar: "الإخلاص".into(),
                surah_name_latin: "Al-Ikhlas".into(),
                ..Default::default()
            },
        );
        let result = qr_sources::cloud_aligner::parse_complete_data(
            r#"[{"segments":[
                {"time_from":0.2,"time_to":2.0,"kind":"special","special_type":"Basmala","matched_text":"بِسْمِ ٱللَّهِ","words":[]},
                {"time_from":2.0,"time_to":4.0,"kind":"quran","ref_from":"112:1:1","ref_to":"112:1:2","confidence":0.97,
                 "words":[{"location":"112:1:1","start":0.0,"end":0.5},{"location":"112:1:2","start":0.5,"end":1.0}]}]}]"#,
        )
        .unwrap();
        let out = map_with_verses(&result, &verses, true);
        assert_eq!(out.segments.len(), 2);
        assert_eq!(out.segments[0].kind, SegmentKind::Basmala);
        let s = &out.segments[1];
        assert_eq!(s.word_range, Some((1, 2)));
        assert_eq!(s.word_timings[0].text, "قُلْ");
        assert_eq!(s.word_timings[1].text, "هُوَ");
        assert_eq!(out.segments[0].end_tick, s.start_tick);
    }
}
