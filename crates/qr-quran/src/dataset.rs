//! Runtime akses dataset Al-Qur'an (quran.db) dengan verifikasi tanda tangan minisign dan hash SHA-256.
//! Mengacu ke PRD QRN-1, CNT-2, dan docs/engineering/02_DATABASE_SPECIFICATION.md §3.

use std::fs::{self, File};
use std::io;
use std::path::Path;

use minisign_verify::{PublicKey, Signature};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatasetError {
    #[error("DATASET_INTEGRITY: Hash database quran.db ({actual}) tidak cocok dengan manifest ({expected})")]
    DatasetIntegrity { actual: String, expected: String },

    #[error("DATASET_INTEGRITY: Verifikasi tanda tangan digital manifest gagal: {0}")]
    SignatureVerification(String),

    #[error("I/O error saat mengakses dataset: {0}")]
    Io(#[from] io::Error),

    #[error("Database SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Ayat tidak ditemukan: surah {0}, ayat {1}")]
    AyahNotFound(u32, u32),

    #[error("Ayat ID {0} tidak ditemukan")]
    AyahIdNotFound(u32),

    #[error("Surah {0} tidak ditemukan")]
    SurahNotFound(u32),

    #[error("Juz {0} tidak ditemukan")]
    JuzNotFound(u32),

    #[error("Terjemahan edisi '{edition}' tidak ditemukan untuk ayat ID {ayah_id}")]
    TranslationNotFound { edition: String, ayah_id: u32 },
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DatasetManifestJson {
    pub dataset_id: String,
    pub dataset_version: String,
    pub content_sha256: String,
    pub quran_db_sha256: String,
    pub tokenizer_version: u32,
    pub source_manifest_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetInfo {
    pub dataset_id: String,
    pub dataset_version: String,
    pub content_sha256: String,
    pub tokenizer_version: u32,
    pub source_manifest_sha256: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Surah {
    pub id: u32,
    pub name_ar: String,
    pub name_latin: String,
    pub name_en: String,
    pub meaning_id: String,
    pub meaning_en: String,
    pub revelation: String,
    pub ayah_count: u32,
    pub first_ayah_id: u32,
    pub description_html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Juz {
    pub id: u32,
    pub label: String,
    pub first_ayah_id: u32,
    pub last_ayah_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Ayah {
    pub id: u32,
    pub surah_id: u32,
    pub number: u32,
    pub juz_id: u32,
    pub page: u32,
    pub text: String,
    pub word_count: u32,
    pub flags: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Word {
    pub ayah_id: u32,
    pub idx: u32,
    pub text: String,
    pub span_start: usize,
    pub span_end: usize,
    pub core_start: usize,
    pub core_end: usize,
    pub search_form: String,
    pub flags: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FullAyah {
    pub ayah: Ayah,
    pub words: Vec<Word>,
    pub translation_kemenag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchResult {
    pub ayah_id: u32,
    pub surah_id: u32,
    pub ayah_number: u32,
    pub arabic_text: String,
    pub translation_text: String,
    pub surah_name: String,
}

/// Edisi terjemahan bawaan dataset (`translation_edition` di quran.db).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetEdition {
    pub key: String,
    /// Kode bahasa (mis. `id`).
    pub language: String,
    pub direction: String,
    pub name: String,
    pub translator: String,
}

/// Instance koneksi read-only ke quran.db yang telah terverifikasi integritasnya.
pub struct QuranDatabase {
    conn: Connection,
    /// `content.db` (edisi unduhan pengguna) sudah di-ATTACH sebagai skema `user` (02 §4).
    installed_attached: AtomicBool,
}

impl std::fmt::Debug for QuranDatabase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QuranDatabase").finish_non_exhaustive()
    }
}

fn compute_sha256(path: &Path) -> Result<String, DatasetError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

impl QuranDatabase {
    /// Membuka database quran.db dengan verifikasi integritas penuh:
    /// 1. Tanda tangan minisign pada `manifest_path` diverifikasi dengan `pubkey_str`.
    /// 2. Hash SHA-256 berkas `quran.db` diverifikasi terhadap `quran_db_sha256` di manifest.
    ///
    /// Bila verifikasi gagal, memicu error `DATASET_INTEGRITY` dan koneksi tidak dibuka (QRN-1, CNT-2).
    pub fn open_with_verification(
        db_path: &Path,
        manifest_path: &Path,
        sig_path: &Path,
        pubkey_str: &str,
    ) -> Result<Self, DatasetError> {
        // 1. Verifikasi tanda tangan digital manifest
        let manifest_bytes = fs::read(manifest_path)?;
        let sig_str = fs::read_to_string(sig_path)?;

        let pubkey_line = pubkey_str
            .lines()
            .find(|l| !l.starts_with("untrusted comment:"))
            .ok_or_else(|| {
                DatasetError::SignatureVerification("Format kunci publik tidak valid".to_string())
            })?
            .trim();

        let pk = PublicKey::from_base64(pubkey_line).map_err(|e| {
            DatasetError::SignatureVerification(format!("Decode public key gagal: {}", e))
        })?;

        let sig = Signature::decode(&sig_str).map_err(|e| {
            DatasetError::SignatureVerification(format!("Decode signature gagal: {}", e))
        })?;

        pk.verify(&manifest_bytes, &sig, false).map_err(|_| {
            DatasetError::SignatureVerification(
                "Tanda tangan minisign manifest tidak valid".to_string(),
            )
        })?;

        // 2. Parse manifest & verifikasi hash quran.db
        let manifest: DatasetManifestJson = serde_json::from_slice(&manifest_bytes)?;
        let actual_db_hash = compute_sha256(db_path)?;

        if actual_db_hash != manifest.quran_db_sha256 {
            return Err(DatasetError::DatasetIntegrity {
                actual: actual_db_hash,
                expected: manifest.quran_db_sha256,
            });
        }

        // 3. Buka koneksi read-only SQLite dengan mode query_only = ON (02 §3.1)
        Self::open_readonly_connection(db_path)
    }

    /// Membuka database tanpa verifikasi (khusus untuk pengujian unit lokal).
    pub fn open_unverified_for_test(db_path: &Path) -> Result<Self, DatasetError> {
        Self::open_readonly_connection(db_path)
    }

    fn open_readonly_connection(db_path: &Path) -> Result<Self, DatasetError> {
        let conn = Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )?;

        conn.execute_batch("PRAGMA query_only = ON;")?;

        conn.busy_timeout(std::time::Duration::from_secs(2))?;

        Ok(Self {
            conn,
            installed_attached: AtomicBool::new(false),
        })
    }

    /// Mendapatkan metadata dataset dari tabel `dataset_info`.
    pub fn get_dataset_info(&self) -> Result<DatasetInfo, DatasetError> {
        let mut info_map = std::collections::HashMap::new();
        let mut stmt = self.conn.prepare("SELECT key, value FROM dataset_info")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;

        for item in rows {
            let (k, v) = item?;
            info_map.insert(k, v);
        }

        Ok(DatasetInfo {
            dataset_id: info_map
                .get("dataset_id")
                .cloned()
                .unwrap_or_else(|| "unknown".to_string()),
            dataset_version: info_map
                .get("dataset_version")
                .cloned()
                .unwrap_or_else(|| "1.0.0".to_string()),
            content_sha256: info_map.get("content_sha256").cloned().unwrap_or_default(),
            tokenizer_version: info_map
                .get("tokenizer_version")
                .and_then(|s| s.parse().ok())
                .unwrap_or(1),
            source_manifest_sha256: info_map
                .get("source_manifest_sha256")
                .cloned()
                .unwrap_or_default(),
            schema_version: info_map
                .get("schema_version")
                .and_then(|s| s.parse().ok())
                .unwrap_or(1),
        })
    }

    /// Mengambil daftar semua 114 surah berurutan.
    pub fn get_surah_list(&self) -> Result<Vec<Surah>, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name_ar, name_latin, name_en, meaning_id, meaning_en, revelation, ayah_count, first_ayah_id, description_html
             FROM surah ORDER BY id ASC",
        )?;

        let rows = stmt.query_map([], |r| {
            Ok(Surah {
                id: r.get(0)?,
                name_ar: r.get(1)?,
                name_latin: r.get(2)?,
                name_en: r.get(3)?,
                meaning_id: r.get(4)?,
                meaning_en: r.get(5)?,
                revelation: r.get(6)?,
                ayah_count: r.get(7)?,
                first_ayah_id: r.get(8)?,
                description_html: r.get(9)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    /// Mengambil data satu surah berdasar nomor surah (1..=114).
    pub fn get_surah(&self, surah_id: u32) -> Result<Surah, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name_ar, name_latin, name_en, meaning_id, meaning_en, revelation, ayah_count, first_ayah_id, description_html
             FROM surah WHERE id = ?1",
        )?;

        stmt.query_row([surah_id], |r| {
            Ok(Surah {
                id: r.get(0)?,
                name_ar: r.get(1)?,
                name_latin: r.get(2)?,
                name_en: r.get(3)?,
                meaning_id: r.get(4)?,
                meaning_en: r.get(5)?,
                revelation: r.get(6)?,
                ayah_count: r.get(7)?,
                first_ayah_id: r.get(8)?,
                description_html: r.get(9)?,
            })
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DatasetError::SurahNotFound(surah_id),
            other => DatasetError::Sqlite(other),
        })
    }

    /// Mengambil daftar seluruh 30 juz berurutan.
    pub fn get_juz_list(&self) -> Result<Vec<Juz>, DatasetError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, label, first_ayah_id, last_ayah_id FROM juz ORDER BY id ASC")?;

        let rows = stmt.query_map([], |r| {
            Ok(Juz {
                id: r.get(0)?,
                label: r.get(1)?,
                first_ayah_id: r.get(2)?,
                last_ayah_id: r.get(3)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    /// Mengambil data satu juz berdasar ID (1..=30).
    pub fn get_juz(&self, juz_id: u32) -> Result<Juz, DatasetError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, label, first_ayah_id, last_ayah_id FROM juz WHERE id = ?1")?;

        stmt.query_row([juz_id], |r| {
            Ok(Juz {
                id: r.get(0)?,
                label: r.get(1)?,
                first_ayah_id: r.get(2)?,
                last_ayah_id: r.get(3)?,
            })
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DatasetError::JuzNotFound(juz_id),
            other => DatasetError::Sqlite(other),
        })
    }

    /// Mengambil ayat berdasar ID global (1..=6236).
    pub fn get_ayah(&self, ayah_id: u32) -> Result<Ayah, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, surah_id, number, juz_id, page, text, word_count, flags FROM ayah WHERE id = ?1",
        )?;

        stmt.query_row([ayah_id], |r| {
            Ok(Ayah {
                id: r.get(0)?,
                surah_id: r.get(1)?,
                number: r.get(2)?,
                juz_id: r.get(3)?,
                page: r.get(4)?,
                text: r.get(5)?,
                word_count: r.get(6)?,
                flags: r.get(7)?,
            })
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DatasetError::AyahIdNotFound(ayah_id),
            other => DatasetError::Sqlite(other),
        })
    }

    /// Mengambil ayat berdasar nomor surah dan nomor ayat (mis. surah 1, ayat 1).
    pub fn get_ayah_by_surah(&self, surah_id: u32, ayah_num: u32) -> Result<Ayah, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, surah_id, number, juz_id, page, text, word_count, flags
             FROM ayah WHERE surah_id = ?1 AND number = ?2",
        )?;

        stmt.query_row([surah_id, ayah_num], |r| {
            Ok(Ayah {
                id: r.get(0)?,
                surah_id: r.get(1)?,
                number: r.get(2)?,
                juz_id: r.get(3)?,
                page: r.get(4)?,
                text: r.get(5)?,
                word_count: r.get(6)?,
                flags: r.get(7)?,
            })
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DatasetError::AyahNotFound(surah_id, ayah_num),
            other => DatasetError::Sqlite(other),
        })
    }

    /// Mengambil rentang ayat inklusif berdasar ID (mis. 1..=7 untuk Al-Fatihah).
    pub fn get_ayahs_range(
        &self,
        start_ayah_id: u32,
        end_ayah_id: u32,
    ) -> Result<Vec<Ayah>, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, surah_id, number, juz_id, page, text, word_count, flags
             FROM ayah WHERE id BETWEEN ?1 AND ?2 ORDER BY id ASC",
        )?;

        let rows = stmt.query_map([start_ayah_id, end_ayah_id], |r| {
            Ok(Ayah {
                id: r.get(0)?,
                surah_id: r.get(1)?,
                number: r.get(2)?,
                juz_id: r.get(3)?,
                page: r.get(4)?,
                text: r.get(5)?,
                word_count: r.get(6)?,
                flags: r.get(7)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    /// Mengambil daftar kata-kata terurut untuk satu ayat tertentu.
    pub fn get_words(&self, ayah_id: u32) -> Result<Vec<Word>, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT ayah_id, idx, text, span_start, span_end, core_start, core_end, search_form, flags
             FROM word WHERE ayah_id = ?1 ORDER BY idx ASC",
        )?;

        let rows = stmt.query_map([ayah_id], |r| {
            Ok(Word {
                ayah_id: r.get(0)?,
                idx: r.get(1)?,
                text: r.get(2)?,
                span_start: r.get::<_, u32>(3)? as usize,
                span_end: r.get::<_, u32>(4)? as usize,
                core_start: r.get::<_, u32>(5)? as usize,
                core_end: r.get::<_, u32>(6)? as usize,
                search_form: r.get(7)?,
                flags: r.get(8)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    /// Mengambil teks terjemahan bersih untuk ayat tertentu.
    pub fn get_translation(&self, edition_key: &str, ayah_id: u32) -> Result<String, DatasetError> {
        let mut stmt = self
            .conn
            .prepare("SELECT text FROM translation_text WHERE edition_key = ?1 AND ayah_id = ?2")?;

        stmt.query_row(params![edition_key, ayah_id], |r| r.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => DatasetError::TranslationNotFound {
                    edition: edition_key.to_string(),
                    ayah_id,
                },
                other => DatasetError::Sqlite(other),
            })
    }

    /// Menyambungkan `content.db` (edisi terjemahan unduhan) sebagai skema `user` secara read-only
    /// (02 §4 "akses gabungan"). Idempoten; `Ok(false)` bila berkas belum ada (belum ada edisi terpasang).
    /// Koneksi ini tetap read-only: penulisan content.db hanya lewat koneksi milik aplikasi.
    pub fn attach_installed_translations(&self, content_db: &Path) -> Result<bool, DatasetError> {
        if self.installed_attached.load(Ordering::Acquire) {
            return Ok(true);
        }
        if !content_db.is_file() {
            return Ok(false);
        }
        self.conn.execute(
            "ATTACH DATABASE ?1 AS user",
            params![content_db.to_string_lossy()],
        )?;
        self.installed_attached.store(true, Ordering::Release);
        Ok(true)
    }

    /// Daftar edisi terjemahan bawaan dataset.
    pub fn list_dataset_editions(&self) -> Result<Vec<DatasetEdition>, DatasetError> {
        let mut stmt = self.conn.prepare(
            "SELECT key, language, direction, name, translator FROM translation_edition ORDER BY key",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(DatasetEdition {
                key: r.get(0)?,
                language: r.get(1)?,
                direction: r.get(2)?,
                name: r.get(3)?,
                translator: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Terjemahan bersih satu ayat untuk edisi mana pun: edisi dataset lebih dulu, lalu edisi unduhan
    /// (`content.db`, bila sudah di-attach). `Ok(None)` bila edisi atau ayat tidak tersedia.
    pub fn verse_translation(
        &self,
        edition_key: &str,
        surah_id: u32,
        ayah_number: u32,
    ) -> Result<Option<String>, DatasetError> {
        let bundled: Option<String> = self
            .conn
            .prepare_cached(
                "SELECT t.text FROM translation_text t JOIN ayah a ON a.id = t.ayah_id
                 WHERE t.edition_key = ?1 AND a.surah_id = ?2 AND a.number = ?3",
            )?
            .query_row(params![edition_key, surah_id, ayah_number], |r| r.get(0))
            .optional()?;
        if bundled.is_some() || !self.installed_attached.load(Ordering::Acquire) {
            return Ok(bundled);
        }
        Ok(self
            .conn
            .prepare_cached(
                "SELECT clean_text FROM user.translation_text
                 WHERE edition_id = ?1 AND surah_id = ?2 AND ayah_number = ?3",
            )?
            .query_row(params![edition_key, surah_id, ayah_number], |r| r.get(0))
            .optional()?)
    }

    /// Seluruh `(surah, ayat)` dalam urutan mushaf (untuk memvalidasi unduhan edisi lengkap).
    pub fn all_verse_refs(&self) -> Result<Vec<(u32, u32)>, DatasetError> {
        let mut stmt = self
            .conn
            .prepare("SELECT surah_id, number FROM ayah ORDER BY id ASC")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Mengambil ayat lengkap: teks Arab, daftar kata beserta offset, dan terjemahan Kemenag.
    pub fn get_full_ayah(&self, ayah_id: u32) -> Result<FullAyah, DatasetError> {
        let ayah = self.get_ayah(ayah_id)?;
        let words = self.get_words(ayah_id)?;
        let translation_kemenag = self
            .get_translation("id.kemenag", ayah_id)
            .unwrap_or_default();

        Ok(FullAyah {
            ayah,
            words,
            translation_kemenag,
        })
    }

    /// Pencarian teks Al-Qur'an dan terjemahan menggunakan FTS5 (02 §3.8).
    pub fn search_fts(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, DatasetError> {
        let clean_q = query.trim().replace('"', "");
        if clean_q.is_empty() {
            return Ok(Vec::new());
        }

        // FTS match query
        let fts_query = format!("\"{}\"*", clean_q);

        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.surah_id, a.number, a.text, t.text, s.name_latin
             FROM ayah_search s_fts
             JOIN ayah a ON a.id = s_fts.rowid
             JOIN surah s ON s.id = a.surah_id
             JOIN translation_text t ON t.ayah_id = a.id AND t.edition_key = 'id.kemenag'
             WHERE ayah_search MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![fts_query, limit as i64], |r| {
            Ok(SearchResult {
                ayah_id: r.get(0)?,
                surah_id: r.get(1)?,
                ayah_number: r.get(2)?,
                arabic_text: r.get(3)?,
                translation_text: r.get(4)?,
                surah_name: r.get(5)?,
            })
        })?;

        let mut results = Vec::new();
        for item in rows {
            results.push(item?);
        }
        Ok(results)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn get_paths() -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        String,
    ) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let db_path = root.join("build/dataset/quran.db");
        let manifest_path = root.join("build/dataset/dataset-manifest.json");
        let sig_path = root.join("build/dataset/dataset-manifest.json.minisig");
        let pubkey = fs::read_to_string(root.join("assets/keys/dataset.pub")).unwrap();
        (db_path, manifest_path, sig_path, pubkey)
    }

    #[test]
    #[ignore = "butuh build/dataset/quran.db bertanda tangan (qr-dataset build); jalankan: cargo test -- --ignored"]
    fn test_open_with_verification_success() {
        let (db_path, manifest_path, sig_path, pubkey) = get_paths();
        assert!(db_path.exists(), "build/dataset/quran.db tidak ada");

        let db =
            QuranDatabase::open_with_verification(&db_path, &manifest_path, &sig_path, &pubkey)
                .expect("Membuka dataset dengan verifikasi harus sukses");

        let info = db.get_dataset_info().unwrap();
        assert_eq!(info.dataset_id, "kemenag-msi-hafs");
        assert_eq!(info.dataset_version, "1.0.0");
    }

    #[test]
    #[ignore = "butuh build/dataset/quran.db bertanda tangan (qr-dataset build); jalankan: cargo test -- --ignored"]
    fn test_corrupted_hash_triggers_dataset_integrity_error() {
        let (db_path, manifest_path, sig_path, pubkey) = get_paths();
        assert!(db_path.exists(), "build/dataset/quran.db tidak ada");

        // Buat file quran.db tiruan yang isinya diubah sedikit (corrupted)
        let temp_dir = std::env::temp_dir().join("qr_test_integrity");
        let _ = fs::create_dir_all(&temp_dir);
        let fake_db = temp_dir.join("quran_corrupt.db");
        let mut db_bytes = fs::read(&db_path).unwrap();
        // Rusak 1 byte di akhir
        if let Some(last) = db_bytes.last_mut() {
            *last ^= 0xFF;
        }
        fs::write(&fake_db, &db_bytes).unwrap();

        // Mencoba membuka file yang hash-nya tidak cocok harus gagal dengan DatasetIntegrity
        let res =
            QuranDatabase::open_with_verification(&fake_db, &manifest_path, &sig_path, &pubkey);

        match res {
            Err(DatasetError::DatasetIntegrity { .. }) => {
                // Sesuai kriteria A1-01 & PRD CNT-2: hash rusak memicu error DATASET_INTEGRITY
            }
            other => panic!("Diharapkan DatasetIntegrity error, ditemukan {:?}", other),
        }

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    #[ignore = "butuh build/dataset/quran.db bertanda tangan (qr-dataset build); jalankan: cargo test -- --ignored"]
    fn test_query_surah_juz_ayah_and_words() {
        let (db_path, _, _, _) = get_paths();
        assert!(db_path.exists(), "build/dataset/quran.db tidak ada");

        let db = QuranDatabase::open_unverified_for_test(&db_path).unwrap();

        // 1. Surah list
        let surahs = db.get_surah_list().unwrap();
        assert_eq!(surahs.len(), 114);
        assert_eq!(surahs[0].name_latin, "Al-Fatihah");
        assert_eq!(surahs[0].ayah_count, 7);

        // 2. Juz list
        let juzs = db.get_juz_list().unwrap();
        assert_eq!(juzs.len(), 30);
        assert_eq!(juzs[0].first_ayah_id, 1);
        assert_eq!(juzs[0].last_ayah_id, 148);

        // 3. Al-Fatihah ayat 1
        let ayah1 = db.get_ayah_by_surah(1, 1).unwrap();
        assert_eq!(ayah1.id, 1);
        assert_eq!(ayah1.text, "بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ");

        // 4. Words for Al-Fatihah 1:1
        let words = db.get_words(1).unwrap();
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].text, "بِسْمِ");
        assert_eq!(words[1].text, "اللّٰهِ");
        assert_eq!(words[2].text, "الرَّحْمٰنِ");
        assert_eq!(words[3].text, "الرَّحِيْمِ");

        // 5. Terjemahan Kemenag
        let tr = db.get_translation("id.kemenag", 1).unwrap();
        assert_eq!(tr, "Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.");

        // 6. Full ayah
        let full = db.get_full_ayah(1).unwrap();
        assert_eq!(full.words.len(), 4);
        assert_eq!(full.translation_kemenag, tr);
    }

    #[test]
    #[ignore = "butuh build/dataset/quran.db bertanda tangan (qr-dataset build); jalankan: cargo test -- --ignored"]
    fn test_search_fts5() {
        let (db_path, _, _, _) = get_paths();
        assert!(db_path.exists(), "build/dataset/quran.db tidak ada");

        let db = QuranDatabase::open_unverified_for_test(&db_path).unwrap();

        // Cari "Penyayang" dalam terjemahan
        let res = db.search_fts("Penyayang", 5).unwrap();
        assert!(!res.is_empty());
        assert!(res.iter().any(|r| r.ayah_id == 1));
        assert_eq!(res[0].surah_name, "Al-Fatihah");
    }

    /// quran.db mini sintetis + content.db (skema qr-sources) untuk menguji akses gabungan tanpa dataset.
    #[test]
    fn installed_editions_are_read_through_attached_content_db() {
        let dir = std::env::temp_dir().join(format!("qr_attach_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let quran = dir.join("quran.db");
        let c = Connection::open(&quran).unwrap();
        c.execute_batch(
            "CREATE TABLE ayah (id INTEGER PRIMARY KEY, surah_id INTEGER, number INTEGER);
             CREATE TABLE translation_edition (key TEXT PRIMARY KEY, language TEXT, direction TEXT,
                 name TEXT, translator TEXT);
             CREATE TABLE translation_text (edition_key TEXT, ayah_id INTEGER, text TEXT);
             INSERT INTO ayah VALUES (1, 1, 1), (2, 1, 2);
             INSERT INTO translation_edition VALUES ('id.kemenag', 'id', 'ltr', 'Kemenag', 'Tim');
             INSERT INTO translation_text VALUES ('id.kemenag', 2, 'Segala puji bagi Allah.');",
        )
        .unwrap();
        drop(c);
        let content = dir.join("content.db");

        let db = QuranDatabase::open_unverified_for_test(&quran).unwrap();
        assert_eq!(db.all_verse_refs().unwrap(), vec![(1, 1), (1, 2)]);
        assert_eq!(db.list_dataset_editions().unwrap()[0].language, "id");
        assert_eq!(
            db.verse_translation("id.kemenag", 1, 2).unwrap().as_deref(),
            Some("Segala puji bagi Allah.")
        );
        // Belum ada content.db: edisi unduhan tidak ada, tanpa galat.
        assert!(!db.attach_installed_translations(&content).unwrap());
        assert_eq!(db.verse_translation("en.qdc20", 1, 2).unwrap(), None);

        let w = Connection::open(&content).unwrap();
        w.execute_batch(
            "CREATE TABLE edition (id TEXT PRIMARY KEY);
             CREATE TABLE translation_text (edition_id TEXT, surah_id INTEGER, ayah_number INTEGER,
                 text TEXT, clean_text TEXT, footnotes_json TEXT);
             INSERT INTO edition VALUES ('en.qdc20');
             INSERT INTO translation_text VALUES ('en.qdc20', 1, 2, 'raw<sup>1</sup>', '[All] praise is [due] to Allah', NULL);",
        )
        .unwrap();
        assert!(db.attach_installed_translations(&content).unwrap());
        assert!(
            db.attach_installed_translations(&content).unwrap(),
            "idempoten"
        );
        assert_eq!(
            db.verse_translation("en.qdc20", 1, 2).unwrap().as_deref(),
            Some("[All] praise is [due] to Allah")
        );
        // Perubahan dari koneksi tulis aplikasi langsung terlihat (hapus edisi).
        w.execute("DELETE FROM translation_text", []).unwrap();
        assert_eq!(db.verse_translation("en.qdc20", 1, 2).unwrap(), None);
        drop(db);
        let _ = fs::remove_dir_all(&dir);
    }
}
