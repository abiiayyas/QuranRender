use anyhow::{bail, Context, Result};
use read_fonts::{FontRef, TableProvider};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use qr_quran::{clean_translation, tokenize_ayah_v1, ARABIC_ALLOWLIST_V1};

#[derive(Debug, Deserialize, Serialize)]
struct ContentManifest {
    schema: u32,
    entries: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ManifestEntry {
    path: String,
    sha256: String,
    kind: String,
    source: String,
    license: String,
    attribution: String,
    redistribution: String,
}

#[derive(Debug, Deserialize)]
struct SurahListItem {
    nomor: u32,
    nama: String,
    nama_latin: String,
    jumlah_ayat: u32,
    tempat_turun: String,
    arti: String,
    deskripsi: String,
    english_name: String,
    english_meaning: String,
}

#[derive(Debug, Deserialize)]
struct RawAyah {
    aya_id: u32,
    aya_number: u32,
    aya_text: String,
    sura_id: u32,
    juz_id: u32,
    page_number: u32,
    translation_aya_text: String,
}

#[derive(Debug, Deserialize)]
struct SurahData {
    data: Vec<RawAyah>,
}

#[derive(Debug, Deserialize)]
struct JuzData {
    nomor: u32,
    data: Vec<RawAyah>,
}

#[derive(Debug, Deserialize)]
struct FontsConfig {
    font: Vec<FontConfigEntry>,
}

#[derive(Debug, Deserialize)]
struct FontConfigEntry {
    key: String,
    file: String,
    roles: Vec<String>,
    #[serde(default)]
    required_for_dataset: bool,
}

#[derive(Debug, Deserialize)]
struct AnomaliesConfig {
    #[serde(default)]
    anomaly: Vec<AnomalyEntry>,
}

#[derive(Debug, Deserialize, Clone)]
struct AnomalyEntry {
    ayah: String,
    codepoint: String,
    code: String,
    status: String,
    note: String,
}

#[derive(Debug, Serialize)]
struct DatasetManifest {
    dataset_id: String,
    dataset_version: String,
    content_sha256: String,
    quran_db_sha256: String,
    tokenizer_version: u32,
    source_manifest_sha256: String,
    stats: DatasetStats,
}

#[derive(Debug, Serialize)]
struct DatasetStats {
    total_surahs: usize,
    total_ayahs: usize,
    total_words: usize,
    max_words_in_ayah: usize,
    rub_el_hizb_count: usize,
    juz_end_mark_count: usize,
    sajdah_count: usize,
}

fn compute_sha256(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("Gagal membuka file untuk hash: {:?}", path))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

/// S0: Verifikasi manifest terhadap file di disk (03 §5.1)
pub fn verify_manifest(manifest_path: &Path, is_release: bool) -> Result<usize> {
    let content = fs::read_to_string(manifest_path)
        .with_context(|| format!("Gagal membaca manifest di {:?}", manifest_path))?;
    let manifest: ContentManifest =
        serde_json::from_str(&content).context("Format content-manifest.json tidak valid")?;

    if manifest.schema != 1 {
        bail!(
            "Skema content-manifest.json harus 1, ditemukan {}",
            manifest.schema
        );
    }

    let base_dir = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let mut tracked_paths = HashSet::new();

    for entry in &manifest.entries {
        let p = base_dir.join(&entry.path);
        if !p.exists() {
            bail!("File di manifest tidak ditemukan di disk: {:?}", p);
        }

        let actual_hash = compute_sha256(&p)?;
        if actual_hash != entry.sha256 {
            bail!(
                "Hash mismatch untuk {}: manifest={}, disk={}",
                entry.path,
                entry.sha256,
                actual_hash
            );
        }

        if is_release
            && (entry.source.contains("PERLU DIISI")
                || entry.license.contains("PERLU DIISI")
                || entry.attribution.contains("PERLU DIISI"))
        {
            bail!("Build rilis menolak entri PERLU DIISI di {}", entry.path);
        }

        let canonical_p = p.canonicalize().unwrap_or(p);
        tracked_paths.insert(canonical_p);
    }

    let check_dirs = [
        base_dir.join("data/surah"),
        base_dir.join("data/juz"),
        base_dir.join("assets/fonts/quran"),
    ];

    for dir in &check_dirs {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') {
                        continue;
                    }
                }
                let canonical_path = path.canonicalize().unwrap_or(path.clone());
                if !tracked_paths.contains(&canonical_path) {
                    bail!("File tidak terdaftar di content-manifest.json: {:?}", path);
                }
            }
        }
    }

    Ok(manifest.entries.len())
}

/// S1 & S2: Parse sumber dan validasi struktur invarian (03 §5.2)
pub fn verify_structure(root_dir: &Path) -> Result<()> {
    let surah_list_path = root_dir.join("data/surah/list-surah.json");
    let surah_list_content = fs::read_to_string(&surah_list_path)
        .with_context(|| format!("Gagal membaca {:?}", surah_list_path))?;
    let surah_list: Vec<SurahListItem> = serde_json::from_str(&surah_list_content)?;

    if surah_list.len() != 114 {
        bail!(
            "list-surah.json harus memuat 114 surah, ditemukan {}",
            surah_list.len()
        );
    }

    let mut surah_ayat_counts = HashMap::new();
    let mut makkiyah_count = 0;
    let mut madaniyah_count = 0;

    for s in &surah_list {
        surah_ayat_counts.insert(s.nomor, s.jumlah_ayat);
        match s.tempat_turun.to_lowercase().as_str() {
            "mekah" => makkiyah_count += 1,
            "madinah" => madaniyah_count += 1,
            other => bail!("Tempat turun tidak valid pada surah {}: {}", s.nomor, other),
        }
    }

    if makkiyah_count != 86 || madaniyah_count != 28 {
        bail!(
            "Distribusi tempat turun salah: makkiyah={}, madaniyah={} (diharapkan 86 & 28)",
            makkiyah_count,
            madaniyah_count
        );
    }

    let mut expected_aya_id = 1;
    let mut last_juz_id = 1;
    let mut last_page_number = 1;
    let mut unique_pages = HashSet::new();
    let mut surah_ayahs_map: HashMap<(u32, u32), RawAyah> = HashMap::new();

    for sura_id in 1..=114 {
        let surah_path = root_dir.join(format!("data/surah/{}.json", sura_id));
        let content = fs::read_to_string(&surah_path)
            .with_context(|| format!("Gagal membaca {:?}", surah_path))?;
        let surah: SurahData = serde_json::from_str(&content)?;

        let expected_count = *surah_ayat_counts
            .get(&sura_id)
            .context("Surah tidak ditemukan di list-surah.json")?;
        if surah.data.len() as u32 != expected_count {
            bail!(
                "Jumlah ayat surah {} ({}) tidak cocok dengan list-surah.json ({})",
                sura_id,
                surah.data.len(),
                expected_count
            );
        }

        for (expected_aya_num, ayah) in (1..).zip(surah.data) {
            if ayah.aya_id != expected_aya_id {
                bail!(
                    "aya_id tidak berurutan: diharapkan {}, ditemukan {}",
                    expected_aya_id,
                    ayah.aya_id
                );
            }
            if ayah.aya_number != expected_aya_num {
                bail!(
                    "aya_number surah {} salah: diharapkan {}, ditemukan {}",
                    sura_id,
                    expected_aya_num,
                    ayah.aya_number
                );
            }
            if ayah.sura_id != sura_id {
                bail!(
                    "sura_id salah di {}:{}: ditemukan {}",
                    sura_id,
                    ayah.aya_number,
                    ayah.sura_id
                );
            }
            if ayah.juz_id < last_juz_id || ayah.juz_id > 30 {
                bail!(
                    "juz_id menurun atau di luar batas di {}:{}: {}",
                    sura_id,
                    ayah.aya_number,
                    ayah.juz_id
                );
            }
            last_juz_id = ayah.juz_id;

            if ayah.page_number < last_page_number || ayah.page_number > 604 {
                bail!(
                    "page_number menurun atau di luar batas di {}:{}: {}",
                    sura_id,
                    ayah.aya_number,
                    ayah.page_number
                );
            }
            last_page_number = ayah.page_number;
            unique_pages.insert(ayah.page_number);

            surah_ayahs_map.insert((ayah.sura_id, ayah.aya_number), ayah);
            expected_aya_id += 1;
        }
    }

    if expected_aya_id != 6237 {
        bail!("Total ayat harus 6.236, ditemukan {}", expected_aya_id - 1);
    }

    if unique_pages.len() != 604 {
        bail!(
            "Jumlah halaman unik harus 604, ditemukan {}",
            unique_pages.len()
        );
    }

    let mut juz_total_ayat = 0;
    for juz_id in 1..=30 {
        let juz_path = root_dir.join(format!("data/juz/juz_{}.json", juz_id));
        let content = fs::read_to_string(&juz_path)
            .with_context(|| format!("Gagal membaca {:?}", juz_path))?;
        let juz: JuzData = serde_json::from_str(&content)?;

        if juz.nomor != juz_id {
            bail!("Nomor juz salah di {:?}: {}", juz_path, juz.nomor);
        }

        for ayah in juz.data {
            juz_total_ayat += 1;
            let surah_ayah = surah_ayahs_map
                .get(&(ayah.sura_id, ayah.aya_number))
                .with_context(|| {
                    format!(
                        "Ayat {}:{} di juz {} tidak ditemukan di data surah",
                        ayah.sura_id, ayah.aya_number, juz_id
                    )
                })?;

            if ayah.aya_text != surah_ayah.aya_text {
                bail!(
                    "aya_text {}:{} di juz {} berbeda byte dari data surah",
                    ayah.sura_id,
                    ayah.aya_number,
                    juz_id
                );
            }
            if ayah.translation_aya_text != surah_ayah.translation_aya_text {
                bail!(
                    "translation_aya_text {}:{} di juz {} berbeda byte dari data surah",
                    ayah.sura_id,
                    ayah.aya_number,
                    juz_id
                );
            }
        }
    }

    if juz_total_ayat != 6236 {
        bail!(
            "Total ayat di data/juz/ harus 6.236, ditemukan {}",
            juz_total_ayat
        );
    }

    Ok(())
}

/// Sanitasi deskripsi surah: buang `<a>` keeping text, buang semua tag kecuali `<i>` dan `<br>`, buang attributes (03 §5.7)
fn sanitize_description_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag.push(tc);
            }
            let tag_lower = tag.trim().to_lowercase();
            if tag_lower == "i" {
                out.push_str("<i>");
            } else if tag_lower == "/i" {
                out.push_str("</i>");
            } else if tag_lower == "br" || tag_lower == "br/" || tag_lower == "br /" {
                out.push_str("<br>");
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Bangun quran.db, manifest, laporan, dan golden tokenisasi (S0–S10)
pub fn build_dataset(root_dir: &Path, out_dir: &Path, is_release: bool) -> Result<String> {
    fs::create_dir_all(out_dir).with_context(|| format!("Gagal membuat out_dir {:?}", out_dir))?;

    // S0: Verifikasi manifest
    let manifest_path = root_dir.join("content-manifest.json");
    verify_manifest(&manifest_path, is_release)?;
    let source_manifest_hash = compute_sha256(&manifest_path)?;

    // S1 & S2: Validasi struktur
    verify_structure(root_dir)?;

    // Baca font config & anomalies
    let fonts_toml_path = root_dir.join("fonts.toml");
    let fonts_config: FontsConfig = toml::from_str(&fs::read_to_string(&fonts_toml_path)?)?;

    let anomalies_toml_path = root_dir.join("data-anomalies.toml");
    let anomalies_config: AnomaliesConfig =
        toml::from_str(&fs::read_to_string(&anomalies_toml_path)?)?;

    let mut anomaly_by_ayah: HashMap<String, AnomalyEntry> = HashMap::new();
    for a in &anomalies_config.anomaly {
        anomaly_by_ayah.insert(a.ayah.clone(), a.clone());
    }

    // Baca list-surah.json
    let surah_list_path = root_dir.join("data/surah/list-surah.json");
    let surah_list: Vec<SurahListItem> =
        serde_json::from_str(&fs::read_to_string(&surah_list_path)?)?;

    // S8: Cakupan font
    let mut font_coverage_records = Vec::new();
    for font_entry in &fonts_config.font {
        let font_path = root_dir.join(&font_entry.file);
        let font_data =
            fs::read(&font_path).with_context(|| format!("Gagal membaca font {:?}", font_path))?;
        let font_ref = FontRef::new(&font_data)
            .with_context(|| format!("Font tidak valid: {:?}", font_path))?;
        let cmap = font_ref
            .cmap()
            .with_context(|| format!("Tabel cmap tidak ditemukan di {:?}", font_path))?;

        let mut missing_cps = Vec::new();
        for &cp in ARABIC_ALLOWLIST_V1 {
            if cmap.map_codepoint(cp).is_none() {
                missing_cps.push(cp);
            }
        }

        let passes_ayah = missing_cps.is_empty();
        if font_entry.required_for_dataset && !passes_ayah {
            bail!(
                "Font {} wajib lulus cakupan penuh ayat, tetapi kehilangan {} codepoint: {:X?}",
                font_entry.key,
                missing_cps.len(),
                missing_cps
            );
        }

        let font_sha256 = Sha256::digest(&font_data);

        font_coverage_records.push((
            font_entry.key.clone(),
            font_entry.file.clone(),
            font_sha256.to_vec(),
            font_entry.roles.clone(),
            missing_cps,
            passes_ayah,
        ));
    }

    // Aliran byte kanonik untuk content_sha256 (03 §5.10)
    let mut canonical_ayah_stream = Vec::new();
    let mut canonical_word_stream = Vec::new();
    let mut canonical_tr_stream = Vec::new();
    let mut canonical_surah_stream = Vec::new();

    // Data tokenisasi golden TSV
    let mut tsv_lines =
        vec!["ayah_id\tidx\tspan_start\tspan_end\tcore_start\tcore_end\ttext".to_string()];

    let db_path = out_dir.join("quran.db");
    if db_path.exists() {
        fs::remove_file(&db_path)?;
    }

    let mut conn = Connection::open(&db_path)?;

    // S9: Pengaturan pragma performa & deterministik
    conn.execute_batch(
        "PRAGMA page_size = 4096;
         PRAGMA journal_mode = OFF;
         PRAGMA synchronous = OFF;",
    )?;

    // Buat skema quran.db (02 §3)
    conn.execute_batch(
        "CREATE TABLE dataset_info (
           key   TEXT PRIMARY KEY,
           value TEXT NOT NULL
         ) STRICT;

         CREATE TABLE surah (
           id             INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 114),
           name_ar        TEXT    NOT NULL,
           name_latin     TEXT    NOT NULL,
           name_en        TEXT    NOT NULL,
           meaning_id     TEXT    NOT NULL,
           meaning_en     TEXT    NOT NULL,
           revelation     TEXT    NOT NULL CHECK (revelation IN ('makkiyah','madaniyah')),
           ayah_count     INTEGER NOT NULL CHECK (ayah_count > 0),
           first_ayah_id  INTEGER NOT NULL,
           description_html TEXT  NOT NULL
         ) STRICT;

         CREATE TABLE juz (
           id             INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 30),
           label          TEXT    NOT NULL,
           first_ayah_id  INTEGER NOT NULL,
           last_ayah_id   INTEGER NOT NULL,
           CHECK (first_ayah_id <= last_ayah_id)
         ) STRICT;

         CREATE TABLE ayah (
           id           INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 6236),
           surah_id     INTEGER NOT NULL REFERENCES surah(id),
           number       INTEGER NOT NULL CHECK (number >= 1),
           juz_id       INTEGER NOT NULL REFERENCES juz(id),
           page         INTEGER NOT NULL CHECK (page BETWEEN 1 AND 604),
           text         TEXT    NOT NULL,
           text_sha256  BLOB    NOT NULL CHECK (length(text_sha256) = 32),
           word_count   INTEGER NOT NULL CHECK (word_count >= 1),
           flags        INTEGER NOT NULL DEFAULT 0,
           UNIQUE (surah_id, number)
         ) STRICT;

         CREATE TABLE word (
           ayah_id      INTEGER NOT NULL REFERENCES ayah(id),
           idx          INTEGER NOT NULL CHECK (idx >= 0),
           text         TEXT    NOT NULL,
           span_start   INTEGER NOT NULL,
           span_end     INTEGER NOT NULL,
           core_start   INTEGER NOT NULL,
           core_end     INTEGER NOT NULL,
           search_form  TEXT    NOT NULL,
           flags        INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (ayah_id, idx),
           CHECK (span_start <= core_start AND core_start < core_end AND core_end <= span_end)
         ) STRICT, WITHOUT ROWID;

         CREATE TABLE anomaly (
           id          INTEGER PRIMARY KEY,
           ayah_id     INTEGER NOT NULL REFERENCES ayah(id),
           byte_offset INTEGER NOT NULL,
           codepoint   INTEGER NOT NULL,
           code        TEXT    NOT NULL CHECK (code IN ('unexpected_codepoint','word_joiner_suspect','trailing_symbol')),
           status      TEXT    NOT NULL CHECK (status IN ('needs_review','confirmed_intentional','corrected')),
           note        TEXT    NOT NULL
         ) STRICT;

         CREATE TABLE translation_edition (
           key             TEXT PRIMARY KEY,
           language        TEXT NOT NULL,
           direction       TEXT NOT NULL CHECK (direction IN ('ltr','rtl')),
           name            TEXT NOT NULL,
           translator      TEXT NOT NULL,
           publisher       TEXT,
           source          TEXT NOT NULL,
           source_url      TEXT,
           license         TEXT NOT NULL,
           permission      TEXT NOT NULL CHECK (permission IN ('granted','pending','user_download_only')),
           version         TEXT NOT NULL,
           content_sha256  BLOB NOT NULL CHECK (length(content_sha256) = 32),
           attribution     TEXT NOT NULL CHECK (length(attribution) > 0)
         ) STRICT;

         CREATE TABLE translation_text (
           edition_key  TEXT    NOT NULL REFERENCES translation_edition(key),
           ayah_id      INTEGER NOT NULL CHECK (ayah_id BETWEEN 1 AND 6236),
           text         TEXT    NOT NULL,
           PRIMARY KEY (edition_key, ayah_id)
         ) STRICT, WITHOUT ROWID;

         CREATE TABLE footnote (
           edition_key  TEXT    NOT NULL REFERENCES translation_edition(key),
           ayah_id      INTEGER NOT NULL,
           ordinal      INTEGER NOT NULL,
           source_ref   TEXT    NOT NULL,
           anchor       INTEGER NOT NULL,
           text         TEXT    NOT NULL,
           PRIMARY KEY (edition_key, ayah_id, ordinal)
         ) STRICT, WITHOUT ROWID;

         CREATE TABLE font (
           key           TEXT PRIMARY KEY,
           file          TEXT NOT NULL,
           family        TEXT NOT NULL,
           style         TEXT NOT NULL,
           sha256        BLOB NOT NULL CHECK (length(sha256) = 32),
           license       TEXT NOT NULL,
           source_url    TEXT NOT NULL,
           roles         TEXT NOT NULL
         ) STRICT;

         CREATE TABLE font_coverage (
           font_key            TEXT NOT NULL REFERENCES font(key),
           dataset_id          TEXT NOT NULL,
           missing_codepoints  TEXT NOT NULL,
           passes_ayah         INTEGER NOT NULL CHECK (passes_ayah IN (0,1)),
           PRIMARY KEY (font_key, dataset_id)
         ) STRICT;

         CREATE VIRTUAL TABLE ayah_search USING fts5(
           ar,
           id_text,
           surah_name,
           content='',
           tokenize = 'unicode61 remove_diacritics 2'
         );",
    )?;

    let tx = conn.transaction()?;

    // 1. Insert Juz 1..=30 terlebih dahulu agar foreign key ayah(juz_id) terpenuhi
    let mut insert_juz = tx.prepare(
        "INSERT INTO juz (id, label, first_ayah_id, last_ayah_id) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for juz_id in 1..=30 {
        let juz_path = root_dir.join(format!("data/juz/juz_{}.json", juz_id));
        let juz_data: JuzData = serde_json::from_str(&fs::read_to_string(&juz_path)?)?;
        let first_ayah_id = juz_data.data.first().context("Juz kosong")?.aya_id;
        let last_ayah_id = juz_data.data.last().context("Juz kosong")?.aya_id;
        let label = format!("Juz {}", juz_id);
        insert_juz
            .execute((juz_id, label, first_ayah_id, last_ayah_id))
            .with_context(|| format!("insert_juz {}", juz_id))?;
    }
    drop(insert_juz);

    // 2. Insert Font & Font Coverage terlebih dahulu
    let mut insert_font = tx.prepare(
        "INSERT INTO font (key, file, family, style, sha256, license, source_url, roles)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut insert_coverage = tx.prepare(
        "INSERT INTO font_coverage (font_key, dataset_id, missing_codepoints, passes_ayah)
         VALUES (?1, ?2, ?3, ?4)",
    )?;

    for (key, file, sha_bytes, roles, missing_cps, passes_ayah) in font_coverage_records {
        let (family, style, license, source_url) = match key.as_str() {
            "lpmq" => (
                "LPMQ IsepMisbah",
                "Regular",
                "Izin Kemenag RI",
                "https://lpmq.kemenag.go.id",
            ),
            "amiri-regular" => (
                "Amiri",
                "Regular",
                "OFL-1.1",
                "https://github.com/aliftype/amiri",
            ),
            "amiri-bold" => (
                "Amiri",
                "Bold",
                "OFL-1.1",
                "https://github.com/aliftype/amiri",
            ),
            "me-quran" => ("me_quran", "Regular", "PERLU DIISI", "PERLU DIISI"),
            "indopak" => (
                "AlQuran IndoPak by QuranWBW",
                "Regular",
                "PERLU DIISI",
                "PERLU DIISI",
            ),
            _ => ("Unknown", "Regular", "Unknown", "Unknown"),
        };
        let roles_json = serde_json::to_string(&roles)?;
        let missing_json = serde_json::to_string(&missing_cps)?;

        insert_font.execute((
            &key, file, family, style, sha_bytes, license, source_url, roles_json,
        ))?;

        insert_coverage.execute((
            &key,
            "kemenag-msi-hafs",
            missing_json,
            if passes_ayah { 1 } else { 0 },
        ))?;
    }
    drop(insert_font);
    drop(insert_coverage);

    // 3. Pre-scan terjemahan untuk menghitung sha256 edition dan insert translation_edition
    let mut all_translations_concatenated = Vec::new();
    for sura_id in 1..=114 {
        let surah_path = root_dir.join(format!("data/surah/{}.json", sura_id));
        let surah_data: SurahData = serde_json::from_str(&fs::read_to_string(&surah_path)?)?;
        for ayah in surah_data.data {
            let cleaned = clean_translation(&ayah.translation_aya_text)?;
            all_translations_concatenated.extend_from_slice(cleaned.as_bytes());
        }
    }
    let tr_hash = Sha256::digest(&all_translations_concatenated).to_vec();

    tx.execute(
        "INSERT INTO translation_edition (key, language, direction, name, translator, publisher, source, source_url, license, permission, version, content_sha256, attribution)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        (
            "id.kemenag",
            "id",
            "ltr",
            "Terjemahan Kemenag RI",
            "Tim Penerjemah Kementerian Agama RI",
            Some("Kementerian Agama Republik Indonesia"),
            "data/ (format API quran.kemenag.go.id)",
            Some("https://quran.kemenag.go.id"),
            "Izin bundling dikonfirmasi pemilik produk (PRD D1, D7)",
            "granted",
            "1.0.0",
            tr_hash,
            "Lajnah Pentashihan Mushaf Al-Qur'an, Kementerian Agama RI",
        ),
    )?;

    // 4. Insert Surah, Ayah, Word, TranslationText, Anomaly, FTS
    let mut current_global_ayah_id = 1;
    let mut total_words = 0;
    let mut max_words_in_ayah = 0;
    let mut rub_el_hizb_count = 0;
    let mut juz_end_mark_count = 0;
    let mut sajdah_count = 0;

    let mut insert_surah = tx.prepare(
        "INSERT INTO surah (id, name_ar, name_latin, name_en, meaning_id, meaning_en, revelation, ayah_count, first_ayah_id, description_html)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;

    let mut insert_ayah = tx.prepare(
        "INSERT INTO ayah (id, surah_id, number, juz_id, page, text, text_sha256, word_count, flags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;

    let mut insert_word = tx.prepare(
        "INSERT INTO word (ayah_id, idx, text, span_start, span_end, core_start, core_end, search_form, flags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;

    let mut insert_translation = tx.prepare(
        "INSERT INTO translation_text (edition_key, ayah_id, text)
         VALUES (?1, ?2, ?3)",
    )?;

    let mut insert_fts = tx.prepare(
        "INSERT INTO ayah_search (rowid, ar, id_text, surah_name)
         VALUES (?1, ?2, ?3, ?4)",
    )?;

    let mut insert_anomaly = tx.prepare(
        "INSERT INTO anomaly (id, ayah_id, byte_offset, codepoint, code, status, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;

    let mut anomaly_pk = 1;

    for s_meta in &surah_list {
        let sura_id = s_meta.nomor;
        let surah_path = root_dir.join(format!("data/surah/{}.json", sura_id));
        let surah_data: SurahData = serde_json::from_str(&fs::read_to_string(&surah_path)?)?;

        let first_ayah_id = current_global_ayah_id;
        let rev = if s_meta.tempat_turun.to_lowercase() == "mekah" {
            "makkiyah"
        } else {
            "madaniyah"
        };
        let desc_clean = sanitize_description_html(&s_meta.deskripsi);

        insert_surah.execute((
            // surah
            sura_id,
            &s_meta.nama,
            &s_meta.nama_latin,
            &s_meta.english_name,
            &s_meta.arti,
            &s_meta.english_meaning,
            rev,
            s_meta.jumlah_ayat,
            first_ayah_id,
            &desc_clean,
        ))?;

        canonical_surah_stream.push(format!(
            "surah\t{}\t{}\t{}\t{}\n",
            sura_id, s_meta.nama, s_meta.nama_latin, s_meta.jumlah_ayat
        ));

        for ayah in surah_data.data {
            let ayah_id = current_global_ayah_id;
            let trimmed_text = ayah.aya_text.trim();
            let text_hash = Sha256::digest(trimmed_text.as_bytes()).to_vec();

            let (words, meta) = tokenize_ayah_v1(trimmed_text)?;
            let word_count = words.len();
            total_words += word_count;
            if word_count > max_words_in_ayah {
                max_words_in_ayah = word_count;
            }
            if meta.has_rub_el_hizb {
                rub_el_hizb_count += 1;
            }
            if meta.has_juz_end_mark {
                juz_end_mark_count += 1;
            }
            if meta.has_sajdah {
                sajdah_count += 1;
            }

            // Cek anomali (03 §5.3)
            let ayah_key = format!("{}:{}", sura_id, ayah.aya_number);
            let has_anomaly = anomaly_by_ayah.contains_key(&ayah_key);

            // Flag ayah
            let mut ayah_flags = 0;
            if meta.has_sajdah {
                ayah_flags |= 0x01;
            }
            if meta.has_rub_el_hizb {
                ayah_flags |= 0x02;
            }
            if meta.has_juz_end_mark {
                ayah_flags |= 0x04;
            }
            if has_anomaly {
                ayah_flags |= 0x08;
            }

            // 1. Insert ayah terlebih dahulu agar foreign key anomaly & word terpenuhi
            insert_ayah.execute((
                ayah_id,
                sura_id,
                ayah.aya_number,
                ayah.juz_id,
                ayah.page_number,
                trimmed_text,
                text_hash,
                word_count as u32,
                ayah_flags,
            ))?;

            // 2. Insert anomaly setelah ayah ada
            if let Some(anomaly_entry) = anomaly_by_ayah.get(&ayah_key) {
                let cp_val =
                    u32::from_str_radix(anomaly_entry.codepoint.trim_start_matches("U+"), 16)?;
                insert_anomaly.execute((
                    anomaly_pk,
                    ayah_id,
                    0, // byte offset
                    cp_val,
                    &anomaly_entry.code,
                    &anomaly_entry.status,
                    &anomaly_entry.note,
                ))?;
                anomaly_pk += 1;
            }

            canonical_ayah_stream.push(format!(
                "ayah\t{}\t{}\t{}\t{}\t{}\t{}\n",
                ayah_id, sura_id, ayah.aya_number, ayah.juz_id, ayah.page_number, trimmed_text
            ));

            // Terjemahan Kemenag
            let cleaned_tr = clean_translation(&ayah.translation_aya_text)?;
            insert_translation.execute((
                // translation
                "id.kemenag",
                ayah_id,
                &cleaned_tr,
            ))?;
            canonical_tr_stream.push(format!("tr\tid.kemenag\t{}\t{}\n", ayah_id, cleaned_tr));

            // Kata
            let mut search_forms = Vec::new();
            for (idx_0, w) in words.into_iter().enumerate() {
                let mut word_flags = 0;
                if w.text.contains('\u{06E9}') {
                    word_flags |= 0x02; // sajdah
                }
                if w.text.starts_with('\u{06DE}') {
                    word_flags |= 0x04; // rub el hizb
                }
                if w.text
                    .chars()
                    .any(|c| (0x06D6..=0x06DC).contains(&(c as u32)))
                {
                    word_flags |= 0x01; // waqf
                }
                if w.core.contains('\u{0608}') || w.core.contains('\u{0609}') {
                    word_flags |= 0x08; // anomaly
                }

                insert_word.execute((
                    // word
                    ayah_id,
                    idx_0 as u32,
                    &w.text,
                    w.span_start as u32,
                    w.span_end as u32,
                    w.core_start as u32,
                    w.core_end as u32,
                    &w.search_form,
                    word_flags,
                ))?;

                canonical_word_stream.push(format!(
                    "word\t{}\t{}\t{}\t{}\t{}\t{}\n",
                    ayah_id, idx_0, w.span_start, w.span_end, w.core_start, w.core_end
                ));

                tsv_lines.push(format!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                    ayah_id, idx_0, w.span_start, w.span_end, w.core_start, w.core_end, w.text
                ));

                search_forms.push(w.search_form);
            }

            // FTS
            let ar_search = search_forms.join(" ");
            let surah_search = format!("{} {}", s_meta.nama_latin, s_meta.arti);
            insert_fts.execute((ayah_id, ar_search, cleaned_tr, surah_search))?;

            current_global_ayah_id += 1;
        }
    }

    drop(insert_surah);
    drop(insert_ayah);
    drop(insert_word);
    drop(insert_translation);
    drop(insert_fts);
    drop(insert_anomaly);
    // Hitung content_sha256 kanonik
    let mut canonical_hasher = Sha256::new();
    for line in canonical_ayah_stream {
        canonical_hasher.update(line.as_bytes());
    }
    for line in canonical_word_stream {
        canonical_hasher.update(line.as_bytes());
    }
    for line in canonical_tr_stream {
        canonical_hasher.update(line.as_bytes());
    }
    for line in canonical_surah_stream {
        canonical_hasher.update(line.as_bytes());
    }
    let content_sha256 = hex::encode(canonical_hasher.finalize());

    // Dataset Info
    let mut insert_info = tx.prepare("INSERT INTO dataset_info (key, value) VALUES (?1, ?2)")?;
    insert_info.execute(("dataset_id", "kemenag-msi-hafs"))?;
    insert_info.execute(("dataset_version", "1.0.0"))?;
    insert_info.execute(("content_sha256", &content_sha256))?;
    insert_info.execute(("tokenizer_version", "1"))?;
    insert_info.execute(("source_manifest_sha256", &source_manifest_hash))?;
    insert_info.execute(("schema_version", "1"))?;
    drop(insert_info);

    let mut check_stmt = tx.prepare("PRAGMA foreign_key_check")?;
    let mut rows = check_stmt.query([])?;
    while let Some(row) = rows.next()? {
        let table: String = row.get(0)?;
        let rowid: i64 = row.get(1)?;
        let parent: String = row.get(2)?;
        let fkid: i64 = row.get(3)?;
        eprintln!(
            "FK FAILURE: table={}, rowid={}, parent={}, fkid={}",
            table, rowid, parent, fkid
        );
    }
    drop(rows);
    drop(check_stmt);
    tx.commit()?;

    // FTS optimize & finalize
    conn.execute_batch(
        "INSERT INTO ayah_search(ayah_search) VALUES('optimize');
         PRAGMA user_version = 1;
         VACUUM;",
    )?;

    drop(conn);

    let quran_db_sha256 = compute_sha256(&db_path)?;

    // Tulis tokenization.tsv
    let tsv_content = tsv_lines.join("\n") + "\n";
    fs::write(out_dir.join("tokenization.tsv"), &tsv_content)?;

    // Salin ke tests/golden/tokenization.tsv
    let golden_path = root_dir.join("tests/golden/tokenization.tsv");
    fs::create_dir_all(golden_path.parent().context("Parent golden path")?)?;
    fs::write(&golden_path, &tsv_content)?;

    // Tulis dataset-manifest.json
    let manifest = DatasetManifest {
        dataset_id: "kemenag-msi-hafs".to_string(),
        dataset_version: "1.0.0".to_string(),
        content_sha256: content_sha256.clone(),
        quran_db_sha256: quran_db_sha256.clone(),
        tokenizer_version: 1,
        source_manifest_sha256: source_manifest_hash,
        stats: DatasetStats {
            total_surahs: 114,
            total_ayahs: 6236,
            total_words,
            max_words_in_ayah,
            rub_el_hizb_count,
            juz_end_mark_count,
            sajdah_count,
        },
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)? + "\n";
    fs::write(out_dir.join("dataset-manifest.json"), &manifest_json)?;

    // Tulis laporan JSON
    fs::write(out_dir.join("report.json"), &manifest_json)?;

    Ok(quran_db_sha256)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "verify-sources" => {
            let is_release = args.iter().any(|a| a == "--release");
            let manifest_path = Path::new("content-manifest.json");
            let entries_count = verify_manifest(manifest_path, is_release)?;
            println!(
                "✓ S0: Manifest diverifikasi ({} entri, SHA-256 cocok)",
                entries_count
            );

            verify_structure(Path::new("."))?;
            println!(
                "✓ S1–S2: Struktur sumber diverifikasi (114 surah, 6.236 ayat, 30 juz identik)"
            );
            println!("✓ Semua pemeriksaan sumber lulus.");
            Ok(())
        }
        "build" => {
            let out_idx = args.iter().position(|a| a == "--out").unwrap_or(0);
            let out_dir = if out_idx > 0 && out_idx + 1 < args.len() {
                PathBuf::from(&args[out_idx + 1])
            } else {
                PathBuf::from("build/dataset")
            };
            let is_release = args.iter().any(|a| a == "--release");

            println!("Membangun dataset QuranRender ke {:?}...", out_dir);
            let hash = build_dataset(Path::new("."), &out_dir, is_release)?;
            println!("✓ S0–S10: Dataset berhasil dibangun!");
            println!("  quran.db SHA-256: {}", hash);
            println!("  Golden tokenisasi ditulis ke tests/golden/tokenization.tsv");
            println!(
                "  Manifest ditulis ke {:?}",
                out_dir.join("dataset-manifest.json")
            );
            Ok(())
        }
        "help" | "--help" | "-h" => {
            println!("Pipeline dataset QuranRender:");
            println!("  qr-dataset verify-sources [--release]   Verifikasi manifest dan struktur sumber (S0–S2)");
            println!(
                "  qr-dataset build --out <dir>           Bangun quran.db dan laporan (S0–S10)"
            );
            Ok(())
        }
        other => {
            bail!(
                "Perintah tidak dikenal: '{}'. Jalankan 'qr-dataset --help' untuk bantuan.",
                other
            );
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_font_coverage() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let fonts = [
            ("LPMQ", "assets/fonts/quran/LPMQ.ttf", 0),
            ("Amiri-Regular", "assets/fonts/quran/Amiri-Regular.ttf", 1),
            ("Amiri-Bold", "assets/fonts/quran/Amiri-Bold.ttf", 1),
            ("Uthmanic", "assets/fonts/quran/Uthmanic.ttf", 5),
            ("IndoPak", "assets/fonts/quran/IndoPak.ttf", 3),
        ];
        for (name, path, expected_missing) in fonts {
            let data = fs::read(root.join(path)).unwrap();
            let font = FontRef::new(&data).unwrap();
            let cmap = font.cmap().unwrap();
            let mut missing = Vec::new();
            for &cp in ARABIC_ALLOWLIST_V1 {
                if cmap.map_codepoint(cp).is_none() {
                    missing.push(cp);
                }
            }
            assert_eq!(
                missing.len(),
                expected_missing,
                "Font {} missing mismatch",
                name
            );
        }
    }

    #[test]
    fn test_verify_manifest_and_structure() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let manifest = root.join("content-manifest.json");
        let count = verify_manifest(&manifest, false).expect("Verifikasi manifest gagal");
        assert_eq!(count, 153);
        verify_structure(&root).expect("Verifikasi struktur gagal");
    }

    #[test]
    fn test_dataset_build_reproducibility() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir1 = root.join("target/test_dataset_build_1");
        let dir2 = root.join("target/test_dataset_build_2");

        let hash1 = build_dataset(&root, &dir1, false).expect("Build 1 gagal");
        let hash2 = build_dataset(&root, &dir2, false).expect("Build 2 gagal");

        assert_eq!(
            hash1, hash2,
            "Build harus 100% reproducible (hash quran.db identik)"
        );

        // Verifikasi isi db
        let conn = Connection::open(dir1.join("quran.db")).unwrap();
        let total_ayahs: i64 = conn
            .query_row("SELECT count(*) FROM ayah", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_ayahs, 6236);

        let total_words: i64 = conn
            .query_row("SELECT count(*) FROM word", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_words, 77511);

        let total_surahs: i64 = conn
            .query_row("SELECT count(*) FROM surah", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_surahs, 114);

        let total_juz: i64 = conn
            .query_row("SELECT count(*) FROM juz", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_juz, 30);
    }
}
