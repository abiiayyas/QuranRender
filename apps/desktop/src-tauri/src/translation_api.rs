//! Perintah edisi terjemahan dan pemotongan terjemahan per segmen (paritas Quran Caption).
//!
//! - Katalog edisi: bawaan dataset (`quran.db`), terpasang (`content.db`), dan remote Quran.com v4
//!   (`/resources/translations`, disimpan di content.db agar tetap tampil saat offline).
//! - Pasang/hapus edisi: teks lengkap diunduh, divalidasi terhadap urutan ayat dataset, dibersihkan
//!   dari HTML/penanda catatan kaki, lalu ditulis atomik ke content.db. Koneksi dataset aplikasi
//!   meng-ATTACH content.db, dan worker ekspor menerima path yang sama lewat `QR_CONTENT_DB`, sehingga
//!   preview, ekspor, dan subtitle membaca edisi yang sama tanpa membawa teks di payload job.
//! - Pemotongan terjemahan untuk segmen sebagian ayat: heuristik (`AutoTrimmed`) atau AI lewat
//!   endpoint OpenAI-compatible (`AiTrimmed`; kunci API di keychain OS). Hasil tidak disimpan: UI
//!   menggabungkannya ke proyek lalu memanggil `project_save`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use qr_core::project::{AyahSegment, Project, SegmentKind, SegmentTranslation, TranslationStatus};
use qr_quran::DatasetEdition;
use qr_render::{auto_trim_translation, edition_language, words_of_ayah, VerseSource};
use qr_sources::ai_trim::{self, AiConfig, AiTrimInput, DEFAULT_AI_ENDPOINT, DEFAULT_AI_MODEL};
use qr_sources::quran_api::{self, RemoteEdition};
use qr_sources::{ContentDb, HttpTransport, InstalledEdition, NetworkPolicy, UreqTransport};
use qr_store::AppDb;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::settings_api::{settings_get_impl, SettingValue};

/// Katalog remote dianggap segar selama sehari (tidak ada permintaan jaringan di antaranya).
const CATALOG_MAX_AGE_SECS: u64 = 24 * 60 * 60;
/// Keychain (01_TECHNICAL_HANDOFF §8.4): service aplikasi, account `<jenis>:<nama>`.
const KEYCHAIN_SERVICE: &str = "app.quranrender.desktop";
const AI_KEY_ACCOUNT: &str = "llm:openai";
const SETTING_AI_ENDPOINT: &str = "ai.endpoint";
const SETTING_AI_MODEL: &str = "ai.model";

#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditionOrigin {
    /// Terbundel di dataset (mis. `id.kemenag`); tidak dapat dihapus.
    Dataset,
    /// Diunduh pengguna ke content.db.
    Installed,
    /// Tersedia di Quran.com, belum diunduh.
    Remote,
}

#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct EditionInfo {
    /// Kunci edisi untuk `Project::translation_editions` (mis. `id.kemenag`, `en.qdc20`).
    pub key: String,
    pub name: String,
    /// Kode bahasa ISO 639-1 (mis. `id`, `en`); nama bahasa bila kodenya tidak dikenal.
    pub language: String,
    pub author: Option<String>,
    pub origin: EditionOrigin,
    pub installed: bool,
    /// Id Quran.com (untuk `translation_edition_install`).
    pub remote_id: Option<u32>,
}

#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerseRef {
    pub surah: u32,
    pub ayah: u32,
}

#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct VerseTranslationDto {
    pub surah: u32,
    pub ayah: u32,
    pub edition_key: String,
    pub text: String,
}

/// Lokasi content.db: `QR_CONTENT_DB`, selain itu di samping app.db (`~/QuranRender/content.db`).
pub fn content_db_path() -> PathBuf {
    std::env::var(qr_cli::CONTENT_DB_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate::get_default_db_path().with_file_name("content.db"))
}

/// Koneksi baca-tulis content.db milik aplikasi, dibuka malas (folder dibuat bila perlu).
pub struct ContentStore {
    path: PathBuf,
    conn: Mutex<Option<ContentDb>>,
}

impl std::fmt::Debug for ContentStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContentStore")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl ContentStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            conn: Mutex::new(None),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn with<T>(
        &self,
        f: impl FnOnce(&mut ContentDb) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            if let Some(dir) = self.path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| {
                    format!(
                        "Folder data terjemahan tidak dapat dibuat ({}): {e}",
                        dir.display()
                    )
                })?;
            }
            *guard = Some(ContentDb::open(&self.path).map_err(|e| {
                format!(
                    "Database terjemahan tidak dapat dibuka ({}): {e}",
                    self.path.display()
                )
            })?);
        }
        match guard.as_mut() {
            Some(db) => f(db),
            None => Err("Database terjemahan tidak tersedia".to_string()),
        }
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn quran_com_transport() -> UreqTransport {
    UreqTransport::new(NetworkPolicy::new(), Duration::from_secs(120))
}

/// Menggabungkan katalog: bawaan dataset, lalu terpasang, lalu remote yang belum terpasang.
pub fn merge_editions(
    dataset: &[DatasetEdition],
    installed: &[InstalledEdition],
    remote: &[RemoteEdition],
) -> Vec<EditionInfo> {
    let mut out: Vec<EditionInfo> = dataset
        .iter()
        .map(|d| EditionInfo {
            key: d.key.clone(),
            name: d.name.clone(),
            language: d.language.clone(),
            author: Some(d.translator.clone()).filter(|a| !a.is_empty()),
            origin: EditionOrigin::Dataset,
            installed: true,
            remote_id: None,
        })
        .collect();
    out.extend(installed.iter().map(|e| EditionInfo {
        key: e.id.clone(),
        name: e.name.clone(),
        language: if e.bcp_47 == "und" {
            e.language.clone()
        } else {
            e.bcp_47.clone()
        },
        author: e.translator.clone(),
        origin: EditionOrigin::Installed,
        installed: true,
        remote_id: quran_api::remote_id_of(e),
    }));
    let installed_ids: Vec<u32> = installed
        .iter()
        .filter_map(quran_api::remote_id_of)
        .collect();
    out.extend(
        remote
            .iter()
            .filter(|r| !installed_ids.contains(&r.id))
            .map(|r| EditionInfo {
                key: r.key(),
                name: r.name.clone(),
                language: if r.iso_code == "und" {
                    r.language_name.clone()
                } else {
                    r.iso_code.clone()
                },
                author: r.author.clone(),
                origin: EditionOrigin::Remote,
                installed: false,
                remote_id: Some(r.id),
            }),
    );
    out
}

/// Terjemahan ayat utuh untuk tiap `refs` × `edition_keys` yang tersedia (yang tidak ada dilewati).
pub fn verse_translations_impl(
    verses: &dyn VerseSource,
    edition_keys: &[String],
    refs: &[VerseRef],
) -> Vec<VerseTranslationDto> {
    refs.iter()
        .flat_map(|r| {
            edition_keys.iter().filter_map(move |k| {
                verses
                    .translation(k, r.surah, r.ayah)
                    .map(|text| VerseTranslationDto {
                        surah: r.surah,
                        ayah: r.ayah,
                        edition_key: k.clone(),
                        text,
                    })
            })
        })
        .collect()
}

/// Bahan pemotongan satu segmen sebagian ayat.
#[derive(Debug, Clone)]
pub struct TrimTarget {
    pub segment: AyahSegment,
    pub range: (u32, u32),
    pub total_words: u32,
    pub arabic_segment: String,
    pub arabic_full: String,
    pub translation_full: String,
}

/// Segmen `segment_ids` yang bisa dipotong (ayat dengan rentang kata) beserta teks Arab dan terjemahan
/// ayat utuhnya. Ayat utuh dan segmen khusus dilewati (terjemahannya sudah lengkap).
pub fn trim_targets(
    project: &Project,
    segment_ids: &[String],
    edition_key: &str,
    verses: &dyn VerseSource,
) -> Result<Vec<TrimTarget>, String> {
    let mut out = Vec::new();
    for id in segment_ids {
        let seg = project
            .segments
            .iter()
            .find(|s| &s.id == id)
            .ok_or_else(|| {
                format!("Segmen '{id}' tidak ditemukan di proyek tersimpan. Simpan proyek lalu coba lagi.")
            })?;
        let Some(range) = seg.word_range.filter(|_| seg.kind == SegmentKind::Ayah) else {
            continue;
        };
        let (s, a) = (seg.surah_id, seg.ayah_number);
        let verse = verses
            .verse(s, a)
            .ok_or_else(|| format!("Ayat {s}:{a} tidak ada di dataset"))?;
        let words = words_of_ayah(&verse.ayah_text).map_err(|e| e.to_string())?;
        let arabic_segment = words
            .iter()
            .filter(|w| w.word_idx >= range.0 && w.word_idx <= range.1)
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if arabic_segment.is_empty() {
            return Err(format!(
                "Rentang kata {}-{} kosong pada ayat {s}:{a}",
                range.0, range.1
            ));
        }
        let translation_full = verses.translation(edition_key, s, a).ok_or_else(|| {
            format!(
                "Terjemahan edisi '{edition_key}' untuk ayat {s}:{a} tidak tersedia. Pasang edisinya terlebih dahulu."
            )
        })?;
        out.push(TrimTarget {
            segment: seg.clone(),
            range,
            total_words: u32::try_from(words.len()).unwrap_or(u32::MAX),
            arabic_segment,
            arabic_full: verse.ayah_text,
            translation_full,
        });
    }
    Ok(out)
}

fn with_translation(
    t: &TrimTarget,
    edition_key: &str,
    text: String,
    status: TranslationStatus,
) -> AyahSegment {
    let mut seg = t.segment.clone();
    seg.translations
        .insert(edition_key.to_string(), SegmentTranslation { text, status });
    seg
}

/// Pemotongan heuristik untuk tiap target (status `AutoTrimmed`).
pub fn auto_trim_impl(targets: &[TrimTarget], edition_key: &str) -> Vec<AyahSegment> {
    targets
        .iter()
        .map(|t| {
            let text = auto_trim_translation(&t.translation_full, t.range, t.total_words);
            with_translation(t, edition_key, text, TranslationStatus::AutoTrimmed)
        })
        .collect()
}

/// Pemotongan AI untuk tiap target (status `AiTrimmed`). Berhenti pada galat pertama.
pub fn ai_trim_impl(
    targets: &[TrimTarget],
    edition_key: &str,
    http: &dyn HttpTransport,
    cfg: &AiConfig,
) -> Result<Vec<AyahSegment>, String> {
    let language = edition_language(edition_key);
    targets
        .iter()
        .map(|t| {
            let input = AiTrimInput {
                surah: t.segment.surah_id,
                ayah: t.segment.ayah_number,
                word_range: t.range,
                total_words: t.total_words,
                arabic_segment: &t.arabic_segment,
                arabic_full: &t.arabic_full,
                translation_full: &t.translation_full,
                language,
            };
            let text = ai_trim::ai_trim(http, cfg, &input).map_err(|e| {
                format!(
                    "Pemotongan AI ayat {}:{} (kata {}–{}) gagal: {e}",
                    t.segment.surah_id, t.segment.ayah_number, t.range.0, t.range.1
                )
            })?;
            Ok(with_translation(
                t,
                edition_key,
                text,
                TranslationStatus::AiTrimmed,
            ))
        })
        .collect()
}

fn setting_text(db: &Mutex<AppDb>, key: &str) -> Result<Option<String>, String> {
    Ok(match settings_get_impl(db, key)? {
        Some(SettingValue::Text(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    })
}

fn is_local_endpoint(endpoint: &str) -> bool {
    matches!(
        qr_sources::allowlist::host_of(endpoint).as_str(),
        "localhost" | "127.0.0.1"
    )
}

/// Konfigurasi AI dari pengaturan (`ai.endpoint`, `ai.model`) dan kunci API keychain. Kunci wajib
/// kecuali untuk server di komputer ini.
pub fn ai_config_from(
    endpoint: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<AiConfig, String> {
    let endpoint = endpoint.unwrap_or_else(|| DEFAULT_AI_ENDPOINT.to_string());
    if api_key.is_none() && !is_local_endpoint(&endpoint) {
        return Err(
            "Kunci API AI belum diatur. Buka Pengaturan lalu masukkan kunci API layanan AI Anda."
                .to_string(),
        );
    }
    Ok(AiConfig {
        endpoint,
        model: model.unwrap_or_else(|| DEFAULT_AI_MODEL.to_string()),
        api_key,
    })
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, AI_KEY_ACCOUNT)
        .map_err(|e| format!("Keychain sistem tidak dapat diakses: {e}"))
}

fn ai_key_get() -> Result<Option<String>, String> {
    match keychain_entry()?.get_password() {
        Ok(k) if !k.trim().is_empty() => Ok(Some(k)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Kunci API tidak dapat dibaca dari keychain: {e}")),
    }
}

/// Validasi kunci API sebelum disimpan ke keychain.
pub fn normalize_api_key(key: &str) -> Result<String, String> {
    let k = key.trim();
    if k.is_empty() {
        return Err("Kunci API tidak boleh kosong.".to_string());
    }
    if k.len() > 4096 || k.chars().any(char::is_control) {
        return Err("Kunci API tidak valid.".to_string());
    }
    Ok(k.to_string())
}

/// Daftar edisi: bawaan dataset, terpasang, dan remote Quran.com. Tanpa internet, katalog remote
/// diambil dari salinan terakhir (bila pernah diambil); bila belum pernah, hanya bawaan + terpasang.
#[tauri::command]
#[specta::specta]
pub async fn translation_editions_list(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<EditionInfo>, String> {
    let dataset = state.with_dataset(|db| db.list_dataset_editions().map_err(|e| e.to_string()))?;
    let (installed, remote) = state.content.with(|db| {
        let installed = db.list_editions().map_err(|e| e.to_string())?;
        let remote =
            quran_api::fetch_catalog(&quran_com_transport(), db, now_unix(), CATALOG_MAX_AGE_SECS)
                .map(|(c, _)| c)
                .unwrap_or_default();
        Ok((installed, remote))
    })?;
    Ok(merge_editions(&dataset, &installed, &remote))
}

/// Mengunduh edisi Quran.com `remote_id` lengkap ke content.db (menggantikan versi lama bila ada).
#[tauri::command]
#[specta::specta]
pub async fn translation_edition_install(
    remote_id: u32,
    state: tauri::State<'_, crate::AppState>,
) -> Result<EditionInfo, String> {
    let expected = state.with_dataset(|db| db.all_verse_refs().map_err(|e| e.to_string()))?;
    let http = quran_com_transport();
    let installed = state.content.with(|db| {
        let (catalog, _) = quran_api::fetch_catalog(&http, db, now_unix(), CATALOG_MAX_AGE_SECS)
            .map_err(|e| e.to_string())?;
        let remote = catalog
            .into_iter()
            .find(|r| r.id == remote_id)
            .ok_or_else(|| format!("Edisi Quran.com nomor {remote_id} tidak ada di katalog."))?;
        quran_api::install_edition(&http, db, &remote, &expected, now_unix())
    })?;
    state.with_dataset(|db| {
        db.attach_installed_translations(state.content.path())
            .map_err(|e| e.to_string())
    })?;
    Ok(merge_editions(&[], std::slice::from_ref(&installed), &[]).remove(0))
}

/// Menghapus edisi terpasang. Edisi bawaan dataset tidak dapat dihapus.
#[tauri::command]
#[specta::specta]
pub async fn translation_edition_remove(
    key: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let is_dataset = state.with_dataset(|db| {
        Ok(db
            .list_dataset_editions()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|d| d.key == key))
    })?;
    if is_dataset {
        return Err(format!("Edisi bawaan '{key}' tidak dapat dihapus."));
    }
    if state
        .content
        .with(|db| db.remove_edition(&key).map_err(|e| e.to_string()))?
    {
        Ok(())
    } else {
        Err(format!("Edisi '{key}' tidak terpasang."))
    }
}

/// Terjemahan ayat utuh untuk edisi-edisi yang diminta (yang tidak tersedia dilewati).
#[tauri::command]
#[specta::specta]
pub async fn verse_translations(
    edition_keys: Vec<String>,
    refs: Vec<VerseRef>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<VerseTranslationDto>, String> {
    if refs.len() > 7000 {
        return Err("Terlalu banyak ayat dalam satu permintaan (maksimum 7000).".to_string());
    }
    state.with_dataset(|db| {
        let verses = qr_render::QuranDbVerses { db };
        Ok(verse_translations_impl(&verses, &edition_keys, &refs))
    })
}

/// Potong terjemahan segmen sebagian ayat secara heuristik (status `AutoTrimmed`). Tidak menyimpan.
#[tauri::command]
#[specta::specta]
pub async fn translation_auto_trim(
    project_id: String,
    segment_ids: Vec<String>,
    edition_key: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<AyahSegment>, String> {
    let (_, project) = crate::project_io::load_registered(&state.db, &project_id)?;
    let targets = state.with_dataset(|db| {
        trim_targets(
            &project,
            &segment_ids,
            &edition_key,
            &qr_render::QuranDbVerses { db },
        )
    })?;
    Ok(auto_trim_impl(&targets, &edition_key))
}

/// Potong terjemahan segmen sebagian ayat dengan AI (status `AiTrimmed`). Tidak menyimpan.
#[tauri::command]
#[specta::specta]
pub async fn translation_ai_trim(
    project_id: String,
    segment_ids: Vec<String>,
    edition_key: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<AyahSegment>, String> {
    let cfg = ai_config_from(
        setting_text(&state.db, SETTING_AI_ENDPOINT)?,
        setting_text(&state.db, SETTING_AI_MODEL)?,
        ai_key_get()?,
    )?;
    let policy = NetworkPolicy::new().with_user_endpoint(&cfg.endpoint)?;
    let (_, project) = crate::project_io::load_registered(&state.db, &project_id)?;
    // Teks dikumpulkan dulu agar kunci dataset tidak ditahan selama permintaan jaringan.
    let targets = state.with_dataset(|db| {
        trim_targets(
            &project,
            &segment_ids,
            &edition_key,
            &qr_render::QuranDbVerses { db },
        )
    })?;
    let http = UreqTransport::new(policy, Duration::from_secs(90));
    ai_trim_impl(&targets, &edition_key, &http, &cfg)
}

/// Menyimpan kunci API layanan AI ke keychain OS (bukan ke app.db).
#[tauri::command]
#[specta::specta]
pub fn ai_key_set(key: String) -> Result<(), String> {
    let key = normalize_api_key(&key)?;
    keychain_entry()?
        .set_password(&key)
        .map_err(|e| format!("Kunci API tidak dapat disimpan ke keychain: {e}"))
}

/// Menghapus kunci API layanan AI dari keychain OS.
#[tauri::command]
#[specta::specta]
pub fn ai_key_clear() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Kunci API tidak dapat dihapus dari keychain: {e}")),
    }
}

/// `true` bila kunci API layanan AI sudah tersimpan di keychain.
#[tauri::command]
#[specta::specta]
pub fn ai_key_status() -> Result<bool, String> {
    Ok(ai_key_get()?.is_some())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use qr_render::VerseContent;
    use qr_sources::NetError;
    use std::collections::{BTreeMap, HashMap};

    fn verses() -> HashMap<(u32, u32), VerseContent> {
        HashMap::from([(
            (1, 2),
            VerseContent {
                ayah_text: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ".into(),
                translations: BTreeMap::from([
                    (
                        "id.kemenag".into(),
                        "Segala puji bagi Allah, Tuhan seluruh alam.".into(),
                    ),
                    (
                        "en.qdc20".into(),
                        "[All] praise is [due] to Allah, Lord of the worlds -".into(),
                    ),
                ]),
                surah_name_ar: "الفاتحة".into(),
                surah_name_latin: "Al-Fatihah".into(),
            },
        )])
    }

    fn project() -> Project {
        let mut p = Project::new("uji");
        let mk = |id: &str, range: Option<(u32, u32)>| AyahSegment {
            id: id.into(),
            surah_id: 1,
            ayah_number: 2,
            word_range: range,
            ..Default::default()
        };
        p.segments = vec![
            mk("a", Some((1, 2))),
            mk("b", Some((3, 4))),
            mk("w", None),
            AyahSegment {
                id: "s".into(),
                kind: SegmentKind::Basmala,
                ..Default::default()
            },
        ];
        p
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn editions_are_merged_dataset_installed_then_remote_without_duplicates() {
        let dataset = [DatasetEdition {
            key: "id.kemenag".into(),
            language: "id".into(),
            direction: "ltr".into(),
            name: "Terjemahan Kemenag RI".into(),
            translator: "Tim Kemenag".into(),
        }];
        let installed = [InstalledEdition {
            id: "en.qdc20".into(),
            name: "Saheeh International".into(),
            language: "english".into(),
            bcp_47: "en".into(),
            direction: "ltr".into(),
            translator: Some("Saheeh International".into()),
            source: "quran.com:20".into(),
            total_verses: 6236,
            downloaded_at: 1,
        }];
        let remote = |id: u32, iso: &str, lang: &str| RemoteEdition {
            id,
            name: format!("Edisi {id}"),
            author: None,
            language_name: lang.into(),
            iso_code: iso.into(),
            direction: "ltr".into(),
        };
        let list = merge_editions(
            &dataset,
            &installed,
            &[
                remote(20, "en", "english"),
                remote(85, "en", "english"),
                remote(999, "und", "klingon"),
            ],
        );
        let summary: Vec<_> = list
            .iter()
            .map(|e| (e.key.as_str(), e.origin, e.installed, e.remote_id))
            .collect();
        assert_eq!(
            summary,
            [
                ("id.kemenag", EditionOrigin::Dataset, true, None),
                ("en.qdc20", EditionOrigin::Installed, true, Some(20)),
                ("en.qdc85", EditionOrigin::Remote, false, Some(85)),
                ("und.qdc999", EditionOrigin::Remote, false, Some(999)),
            ]
        );
        assert_eq!(list[1].language, "en");
        assert_eq!(list[3].language, "klingon");
    }

    #[test]
    fn verse_translations_skip_missing_editions() {
        let out = verse_translations_impl(
            &verses(),
            &ids(&["en.qdc20", "fr.qdc31", "id.kemenag"]),
            &[
                VerseRef { surah: 1, ayah: 2 },
                VerseRef { surah: 1, ayah: 9 },
            ],
        );
        let keys: Vec<_> = out.iter().map(|d| d.edition_key.as_str()).collect();
        assert_eq!(keys, ["en.qdc20", "id.kemenag"]);
        assert!(out[0].text.starts_with("[All] praise"));
    }

    #[test]
    fn auto_trim_only_touches_partial_segments_and_marks_status() {
        let p = project();
        let targets =
            trim_targets(&p, &ids(&["a", "b", "w", "s"]), "id.kemenag", &verses()).unwrap();
        assert_eq!(targets.len(), 2, "ayat utuh dan segmen khusus dilewati");
        assert_eq!(targets[0].total_words, 4);
        assert_eq!(targets[0].arabic_segment, "الْحَمْدُ لِلَّهِ");
        let out = auto_trim_impl(&targets, "id.kemenag");
        let a = &out[0].translations["id.kemenag"];
        let b = &out[1].translations["id.kemenag"];
        assert_eq!(a.status, TranslationStatus::AutoTrimmed);
        assert_eq!(
            format!("{} {}", a.text, b.text),
            "Segala puji bagi Allah, Tuhan seluruh alam."
        );
        assert_eq!(a.text, "Segala puji bagi Allah,");
    }

    #[test]
    fn trim_reports_plain_errors() {
        let p = project();
        let err = trim_targets(&p, &ids(&["x"]), "id.kemenag", &verses()).unwrap_err();
        assert!(err.contains("tidak ditemukan"), "{err}");
        let err = trim_targets(&p, &ids(&["a"]), "fr.qdc31", &verses()).unwrap_err();
        assert!(err.contains("Pasang edisinya"), "{err}");
    }

    struct FakeAi(Mutex<Vec<serde_json::Value>>);

    impl HttpTransport for FakeAi {
        fn get_text(&self, _: &str) -> Result<String, NetError> {
            unreachable!()
        }
        fn post_json(
            &self,
            _: &str,
            bearer: Option<&str>,
            body: &serde_json::Value,
        ) -> Result<String, NetError> {
            assert_eq!(bearer, Some("sk-uji"));
            let mut seen = self.0.lock().unwrap();
            seen.push(body.clone());
            let fragment = if seen.len() == 1 {
                "[All] praise is [due] to Allah,"
            } else {
                "Lord of the worlds -"
            };
            Ok(serde_json::json!({
                "choices": [{"message": {"content": serde_json::json!({"fragment": fragment}).to_string()}}]
            })
            .to_string())
        }
    }

    #[test]
    fn ai_trim_sends_segment_words_and_marks_ai_status() {
        let p = project();
        let targets = trim_targets(&p, &ids(&["a", "b"]), "en.qdc20", &verses()).unwrap();
        let fake = FakeAi(Mutex::new(vec![]));
        let cfg = ai_config_from(None, None, Some("sk-uji".into())).unwrap();
        assert_eq!(cfg.endpoint, DEFAULT_AI_ENDPOINT);
        let out = ai_trim_impl(&targets, "en.qdc20", &fake, &cfg).unwrap();
        assert_eq!(
            out[0].translations["en.qdc20"].text,
            "[All] praise is [due] to Allah,"
        );
        assert_eq!(out[1].translations["en.qdc20"].text, "Lord of the worlds -");
        assert!(out
            .iter()
            .all(|s| s.translations["en.qdc20"].status == TranslationStatus::AiTrimmed));
        let sent = fake.0.lock().unwrap();
        let user = sent[1]["messages"][1]["content"].as_str().unwrap();
        assert!(
            user.contains("رَبِّ الْعَالَمِينَ") && user.contains("\"en\""),
            "{user}"
        );
    }

    #[test]
    fn ai_config_requires_key_except_for_local_servers() {
        let err = ai_config_from(None, None, None).unwrap_err();
        assert!(err.contains("Kunci API AI belum diatur"), "{err}");
        let local = ai_config_from(
            Some("http://localhost:11434/v1".into()),
            Some("llama3".into()),
            None,
        )
        .unwrap();
        assert_eq!((local.model.as_str(), local.api_key), ("llama3", None));
        assert!(normalize_api_key("   ").is_err());
        assert!(normalize_api_key("sk\nx").is_err());
        assert_eq!(normalize_api_key("  sk-abc ").unwrap(), "sk-abc");
    }
}
