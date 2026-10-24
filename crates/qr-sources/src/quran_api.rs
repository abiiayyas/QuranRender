//! Klien Quran.com API v4 untuk katalog edisi terjemahan dan pemasangan edisi lengkap ke content.db
//! (PRD QRN-12, 03_DATASET_PIPELINE §6). Seluruh akses jaringan lewat [`HttpTransport`] (allowlist).
//!
//! - Katalog: `GET /resources/translations` + `GET /resources/languages` (kode ISO dan arah tulis).
//!   Badan respons disimpan di content.db (`catalog_cache`) sehingga daftar tetap tersedia offline.
//! - Edisi: `GET /quran/translations/{id}?fields=verse_key` → divalidasi penuh terhadap urutan ayat
//!   `quran.db` ([`parse_quran_com_payload`]) lalu dipasang atomik.
//!
//! Kunci edisi terpasang: `{iso}.qdc{id}` (mis. `en.qdc20`), sesuai 02 §4 (sufiks sumber). Prefiks
//! bahasa dipakai renderer untuk memilih terjemahan bawaan segmen khusus (basmalah/isti'adzah).

use crate::content_db::{ContentDb, InstalledEdition};
use crate::http::{HttpTransport, NetError};
use crate::quran_com::parse_quran_com_payload;
use serde::Deserialize;

pub const QURAN_API_BASE: &str = "https://api.quran.com/api/v4";
const CATALOG_TRANSLATIONS: &str = "qdc.translations";
const CATALOG_LANGUAGES: &str = "qdc.languages";
/// Nilai kolom `edition.source` untuk edisi dari Quran.com; menyimpan id sumber.
const SOURCE_PREFIX: &str = "quran.com:";

/// Satu edisi terjemahan di katalog Quran.com.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEdition {
    pub id: u32,
    pub name: String,
    pub author: Option<String>,
    /// Nama bahasa dari API (huruf kecil, mis. `english`).
    pub language_name: String,
    /// Kode ISO 639-1 bila dikenal (mis. `en`), selain itu `und`.
    pub iso_code: String,
    /// `ltr` atau `rtl`.
    pub direction: String,
}

impl RemoteEdition {
    pub fn key(&self) -> String {
        installed_edition_key(&self.iso_code, self.id)
    }
}

#[derive(Debug, Deserialize)]
struct TranslationsResponse {
    translations: Vec<TranslationResource>,
}

#[derive(Debug, Deserialize)]
struct TranslationResource {
    id: u32,
    name: String,
    #[serde(default)]
    author_name: Option<String>,
    #[serde(default)]
    language_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LanguagesResponse {
    languages: Vec<LanguageResource>,
}

#[derive(Debug, Deserialize)]
struct LanguageResource {
    name: String,
    #[serde(default)]
    iso_code: Option<String>,
    #[serde(default)]
    direction: Option<String>,
}

/// Kunci edisi terpasang dari kode bahasa dan id Quran.com.
pub fn installed_edition_key(iso_code: &str, id: u32) -> String {
    format!("{iso_code}.qdc{id}")
}

/// Id Quran.com dari kunci edisi terpasang (`en.qdc20` → 20); `None` untuk kunci lain.
pub fn remote_id_from_key(key: &str) -> Option<u32> {
    key.rsplit_once('.')?.1.strip_prefix("qdc")?.parse().ok()
}

/// Menggabungkan respons `/resources/translations` dan `/resources/languages` menjadi katalog,
/// diurutkan per bahasa lalu nama. Bahasa yang tidak ada di daftar bahasa mendapat kode `und`.
pub fn parse_catalog(
    translations_json: &str,
    languages_json: &str,
) -> Result<Vec<RemoteEdition>, String> {
    let tr: TranslationsResponse = serde_json::from_str(translations_json)
        .map_err(|e| format!("Daftar edisi Quran.com tidak dapat dibaca: {e}"))?;
    let langs: LanguagesResponse = serde_json::from_str(languages_json)
        .map_err(|e| format!("Daftar bahasa Quran.com tidak dapat dibaca: {e}"))?;
    let lookup = |name: &str| {
        langs
            .languages
            .iter()
            .find(|l| l.name.eq_ignore_ascii_case(name))
    };
    let mut out: Vec<RemoteEdition> = tr
        .translations
        .into_iter()
        .filter(|t| !t.name.trim().is_empty())
        .map(|t| {
            let language_name = t.language_name.unwrap_or_default().trim().to_lowercase();
            let lang = lookup(&language_name);
            let iso_code = lang
                .and_then(|l| l.iso_code.clone())
                .filter(|c| !c.is_empty() && c.chars().all(|ch| ch.is_ascii_alphabetic()))
                .map_or_else(|| "und".to_string(), |c| c.to_ascii_lowercase());
            let direction = match lang.and_then(|l| l.direction.as_deref()) {
                Some("rtl") => "rtl",
                _ => "ltr",
            }
            .to_string();
            let author = t
                .author_name
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty() && !a.eq_ignore_ascii_case("unknown"));
            RemoteEdition {
                id: t.id,
                name: t.name.trim().to_string(),
                author,
                language_name,
                iso_code,
                direction,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        a.language_name
            .cmp(&b.language_name)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

/// Katalog edisi. Salinan tersimpan yang berumur kurang dari `max_age_secs` dipakai tanpa jaringan;
/// selain itu diambil ulang dari jaringan lalu disimpan, dan bila gagal (offline) memakai salinan
/// terakhir berapa pun umurnya. Mengembalikan `(katalog, dari_cache)`; `Err` hanya bila jaringan gagal
/// dan belum pernah ada salinan.
pub fn fetch_catalog(
    http: &dyn HttpTransport,
    db: &ContentDb,
    now_unix: u64,
    max_age_secs: u64,
) -> Result<(Vec<RemoteEdition>, bool), NetError> {
    let fresh = db
        .get_catalog(CATALOG_TRANSLATIONS)
        .ok()
        .flatten()
        .is_some_and(|(_, at)| now_unix.saturating_sub(at) < max_age_secs);
    if fresh {
        if let Some(c) = cached_catalog(db) {
            return Ok((c, true));
        }
    }
    let fetched = http
        .get_text(&format!("{QURAN_API_BASE}/resources/translations"))
        .and_then(|t| {
            http.get_text(&format!("{QURAN_API_BASE}/resources/languages"))
                .map(|l| (t, l))
        });
    match fetched {
        Ok((t, l)) => {
            let catalog = parse_catalog(&t, &l).map_err(NetError::Other)?;
            db.put_catalog(CATALOG_TRANSLATIONS, &t, now_unix)
                .and_then(|()| db.put_catalog(CATALOG_LANGUAGES, &l, now_unix))
                .map_err(|e| NetError::Other(format!("cache katalog: {e}")))?;
            Ok((catalog, false))
        }
        Err(net) => match cached_catalog(db) {
            Some(c) => Ok((c, true)),
            None => Err(net),
        },
    }
}

/// Katalog dari salinan tersimpan (tanpa jaringan).
pub fn cached_catalog(db: &ContentDb) -> Option<Vec<RemoteEdition>> {
    let (t, _) = db.get_catalog(CATALOG_TRANSLATIONS).ok()??;
    let (l, _) = db.get_catalog(CATALOG_LANGUAGES).ok()??;
    parse_catalog(&t, &l).ok()
}

/// Id Quran.com dari edisi terpasang (`edition.source = "quran.com:{id}"`).
pub fn remote_id_of(ed: &InstalledEdition) -> Option<u32> {
    ed.source
        .strip_prefix(SOURCE_PREFIX)
        .and_then(|s| s.parse().ok())
        .or_else(|| remote_id_from_key(&ed.id))
}

/// Mengunduh, memvalidasi, dan memasang satu edisi lengkap. `expected` = seluruh `(surah, ayat)` dari
/// `quran.db` dalam urutan mushaf; respons yang tidak cocok ditolak seluruhnya (tidak ada pemasangan
/// sebagian).
pub fn install_edition(
    http: &dyn HttpTransport,
    db: &mut ContentDb,
    remote: &RemoteEdition,
    expected: &[(u32, u32)],
    now_unix: u64,
) -> Result<InstalledEdition, String> {
    let url = format!(
        "{QURAN_API_BASE}/quran/translations/{}?fields=verse_key",
        remote.id
    );
    let body = http.get_text(&url).map_err(|e| e.to_string())?;
    install_edition_from_payload(db, remote, expected, &body, now_unix)
}

/// Bagian murni dari [`install_edition`]: validasi + penulisan atomik dari badan respons.
pub fn install_edition_from_payload(
    db: &mut ContentDb,
    remote: &RemoteEdition,
    expected: &[(u32, u32)],
    body: &str,
    now_unix: u64,
) -> Result<InstalledEdition, String> {
    let key = remote.key();
    let verses = parse_quran_com_payload(&key, remote.id, expected, body)
        .map_err(|e| format!("Edisi '{}' dari Quran.com tidak valid: {e}", remote.name))?;
    let ed = InstalledEdition {
        id: key,
        name: remote.name.clone(),
        language: remote.language_name.clone(),
        bcp_47: remote.iso_code.clone(),
        direction: remote.direction.clone(),
        translator: remote.author.clone(),
        source: format!("{SOURCE_PREFIX}{}", remote.id),
        total_verses: u32::try_from(verses.len()).unwrap_or(u32::MAX),
        downloaded_at: now_unix,
    };
    db.replace_edition(&ed, &verses)
        .map_err(|e| format!("Gagal menyimpan edisi ke content.db: {e}"))?;
    Ok(ed)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const TRANSLATIONS: &str = r#"{"translations":[
        {"id":20,"name":"Saheeh International","author_name":"Saheeh International","slug":"en-sahih-international","language_name":"english","translated_name":{"name":"Saheeh International","language_name":"english"}},
        {"id":134,"name":"King Fahad Quran Complex","author_name":"King Fahad Quran Complex","slug":null,"language_name":"indonesian"},
        {"id":97,"name":"Tafheem e Quran","author_name":"Unknown","language_name":"urdu"},
        {"id":999,"name":"Edisi Misterius","author_name":"","language_name":"klingon"}
    ]}"#;
    const LANGUAGES: &str = r#"{"languages":[
        {"id":38,"name":"English","iso_code":"en","native_name":"English","direction":"ltr"},
        {"id":174,"name":"Urdu","iso_code":"ur","native_name":"اردو","direction":"rtl"},
        {"id":33,"name":"Indonesian","iso_code":"id","direction":"ltr"}
    ]}"#;

    /// Transport palsu: URL → respons, mencatat URL yang diminta.
    struct FakeHttp {
        routes: Vec<(String, Result<String, NetError>)>,
        seen: Mutex<Vec<String>>,
    }

    impl HttpTransport for FakeHttp {
        fn get_text(&self, url: &str) -> Result<String, NetError> {
            self.seen.lock().unwrap().push(url.to_string());
            self.routes
                .iter()
                .find(|(u, _)| u == url)
                .map(|(_, r)| r.clone())
                .unwrap_or_else(|| Err(NetError::Offline("api.quran.com".into())))
        }
        fn post_json(
            &self,
            _: &str,
            _: Option<&str>,
            _: &serde_json::Value,
        ) -> Result<String, NetError> {
            unreachable!("Quran.com hanya GET")
        }
    }

    fn online() -> FakeHttp {
        FakeHttp {
            routes: vec![
                (
                    format!("{QURAN_API_BASE}/resources/translations"),
                    Ok(TRANSLATIONS.into()),
                ),
                (
                    format!("{QURAN_API_BASE}/resources/languages"),
                    Ok(LANGUAGES.into()),
                ),
            ],
            seen: Mutex::new(vec![]),
        }
    }

    fn offline() -> FakeHttp {
        FakeHttp {
            routes: vec![],
            seen: Mutex::new(vec![]),
        }
    }

    #[test]
    fn catalog_maps_iso_code_direction_and_author() {
        let c = parse_catalog(TRANSLATIONS, LANGUAGES).unwrap();
        let saheeh = c.iter().find(|e| e.id == 20).unwrap();
        assert_eq!(saheeh.iso_code, "en");
        assert_eq!(saheeh.key(), "en.qdc20");
        assert_eq!(saheeh.author.as_deref(), Some("Saheeh International"));
        let urdu = c.iter().find(|e| e.id == 97).unwrap();
        assert_eq!(
            (urdu.iso_code.as_str(), urdu.direction.as_str()),
            ("ur", "rtl")
        );
        assert!(urdu.author.is_none(), "penulis 'Unknown' tidak ditampilkan");
        let unknown = c.iter().find(|e| e.id == 999).unwrap();
        assert_eq!(unknown.key(), "und.qdc999");
        // Urut per bahasa.
        let langs: Vec<_> = c.iter().map(|e| e.language_name.as_str()).collect();
        assert_eq!(langs, ["english", "indonesian", "klingon", "urdu"]);
    }

    #[test]
    fn remote_id_roundtrips_through_key() {
        assert_eq!(remote_id_from_key("en.qdc20"), Some(20));
        assert_eq!(remote_id_from_key("und.qdc999"), Some(999));
        assert_eq!(remote_id_from_key("id.kemenag"), None);
        assert_eq!(remote_id_from_key("qdc20"), None);
    }

    #[test]
    fn catalog_is_cached_and_served_offline() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(matches!(
            fetch_catalog(&offline(), &db, 1, 100),
            Err(NetError::Offline(_))
        ));
        let (c, cached) = fetch_catalog(&online(), &db, 2, 100).unwrap();
        assert!(!cached);
        assert_eq!(c.len(), 4);
        // Masih segar: tanpa permintaan jaringan.
        let http = online();
        let (_, cached) = fetch_catalog(&http, &db, 50, 100).unwrap();
        assert!(cached);
        assert!(http.seen.lock().unwrap().is_empty());
        // Kedaluwarsa + offline: salinan lama tetap dipakai.
        let (c2, cached2) = fetch_catalog(&offline(), &db, 1_000, 100).unwrap();
        assert!(cached2);
        assert_eq!(c, c2);
        // Kedaluwarsa + online: diambil ulang.
        let http = online();
        let (_, cached3) = fetch_catalog(&http, &db, 1_000, 100).unwrap();
        assert!(!cached3);
        assert_eq!(http.seen.lock().unwrap().len(), 2);
    }

    #[test]
    fn install_validates_and_stores_clean_text_with_source_id() {
        let mut db = ContentDb::open_in_memory().unwrap();
        let remote = parse_catalog(TRANSLATIONS, LANGUAGES)
            .unwrap()
            .into_iter()
            .find(|e| e.id == 20)
            .unwrap();
        let body = r#"{"translations":[
            {"resource_id":20,"verse_key":"1:1","text":"In the name of Allāh,<sup foot_note=195932>1</sup> the Entirely Merciful, the Especially Merciful.<sup foot_note=195931>2</sup>"},
            {"resource_id":20,"verse_key":"1:2","text":"[All] praise is [due] to Allāh, Lord<sup foot_note=195933>1</sup> of the worlds -"}
        ]}"#;
        let http = FakeHttp {
            routes: vec![(
                format!("{QURAN_API_BASE}/quran/translations/20?fields=verse_key"),
                Ok(body.into()),
            )],
            seen: Mutex::new(vec![]),
        };
        let ed = install_edition(&http, &mut db, &remote, &[(1, 1), (1, 2)], 42).unwrap();
        assert_eq!(ed.id, "en.qdc20");
        assert_eq!(ed.total_verses, 2);
        assert_eq!(remote_id_of(&ed), Some(20));
        let v = db.get_translation_verse("en.qdc20", 1, 1).unwrap().unwrap();
        assert_eq!(
            v.clean_text,
            "In the name of Allāh, the Entirely Merciful, the Especially Merciful."
        );
        assert!(v.footnotes_json.unwrap().contains("195932"));

        // Respons tidak lengkap ditolak seluruhnya, isi lama tetap utuh.
        let err =
            install_edition_from_payload(&mut db, &remote, &[(1, 1), (1, 2), (1, 3)], body, 43)
                .unwrap_err();
        assert!(err.contains("Saheeh"), "{err}");
        assert_eq!(db.list_editions().unwrap()[0].downloaded_at, 42);
    }

    #[test]
    fn install_offline_reports_plain_error() {
        let mut db = ContentDb::open_in_memory().unwrap();
        let remote = parse_catalog(TRANSLATIONS, LANGUAGES).unwrap().remove(0);
        let err = install_edition(&offline(), &mut db, &remote, &[(1, 1)], 1).unwrap_err();
        assert!(err.contains("koneksi internet"), "{err}");
        assert!(db.list_editions().unwrap().is_empty());
    }
}
