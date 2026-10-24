//! Database edisi terjemahan unduhan dan catatan kaki tambahan (content.db) (PRD QRN-12..14, B2-13).
//! Mengacu ke docs/engineering/02_DATABASE_SPECIFICATION.md §4.
//!
//! Koneksi baca-tulis milik aplikasi (pasang/hapus edisi, cache katalog). Renderer membaca edisi yang
//! terpasang lewat `qr_quran::QuranDatabase::attach_installed_translations` (ATTACH read-only).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstalledEdition {
    pub id: String,
    pub name: String,
    pub language: String,
    pub bcp_47: String,
    pub direction: String,
    pub translator: Option<String>,
    pub source: String,
    pub total_verses: u32,
    pub downloaded_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranslationVerse {
    pub edition_id: String,
    pub surah_id: u32,
    pub ayah_number: u32,
    pub text: String,
    pub clean_text: String,
    pub footnotes_json: Option<String>,
}

const SCHEMA: &str = "PRAGMA foreign_keys = ON;
     CREATE TABLE IF NOT EXISTS edition (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         language TEXT NOT NULL,
         bcp_47 TEXT NOT NULL,
         direction TEXT NOT NULL,
         translator TEXT,
         source TEXT NOT NULL,
         total_verses INTEGER NOT NULL,
         downloaded_at INTEGER NOT NULL
     ) STRICT;

     CREATE TABLE IF NOT EXISTS translation_text (
         edition_id TEXT NOT NULL REFERENCES edition(id) ON DELETE CASCADE,
         surah_id INTEGER NOT NULL,
         ayah_number INTEGER NOT NULL,
         text TEXT NOT NULL,
         clean_text TEXT NOT NULL,
         footnotes_json TEXT,
         PRIMARY KEY (edition_id, surah_id, ayah_number)
     ) STRICT;
     CREATE INDEX IF NOT EXISTS idx_tr_verse ON translation_text(surah_id, ayah_number);

     CREATE TABLE IF NOT EXISTS catalog_cache (
         name TEXT PRIMARY KEY,
         body TEXT NOT NULL,
         fetched_at INTEGER NOT NULL
     ) STRICT;";

#[derive(Debug)]
pub struct ContentDb {
    conn: Connection,
}

impl ContentDb {
    /// Membuka atau membuat database content.db dengan mode STRICT dan Foreign Keys aktif.
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        Self::init(Connection::open(path)?)
    }

    /// Membuka content.db in-memory untuk pengujian.
    pub fn open_in_memory() -> Result<Self, rusqlite::Error> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, rusqlite::Error> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Menyimpan atau memperbarui data edisi terjemahan.
    pub fn upsert_edition(&self, ed: &InstalledEdition) -> Result<(), rusqlite::Error> {
        Self::upsert_edition_on(&self.conn, ed)
    }

    fn upsert_edition_on(conn: &Connection, ed: &InstalledEdition) -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT INTO edition (id, name, language, bcp_47, direction, translator, source, total_verses, downloaded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 language = excluded.language,
                 bcp_47 = excluded.bcp_47,
                 direction = excluded.direction,
                 translator = excluded.translator,
                 source = excluded.source,
                 downloaded_at = excluded.downloaded_at,
                 total_verses = excluded.total_verses",
            params![
                ed.id,
                ed.name,
                ed.language,
                ed.bcp_47,
                ed.direction,
                ed.translator,
                ed.source,
                ed.total_verses,
                ed.downloaded_at as i64
            ],
        )?;
        Ok(())
    }

    /// Menyimpan terjemahan ayat beserta catatan kaki JSON.
    pub fn insert_translation_verse(&self, tv: &TranslationVerse) -> Result<(), rusqlite::Error> {
        Self::insert_verse_on(&self.conn, tv)
    }

    fn insert_verse_on(conn: &Connection, tv: &TranslationVerse) -> Result<(), rusqlite::Error> {
        conn.prepare_cached(
            "INSERT OR REPLACE INTO translation_text (edition_id, surah_id, ayah_number, text, clean_text, footnotes_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?
        .execute(params![
            tv.edition_id,
            tv.surah_id,
            tv.ayah_number,
            tv.text,
            tv.clean_text,
            tv.footnotes_json
        ])?;
        Ok(())
    }

    /// Memasang edisi lengkap secara atomik: metadata + seluruh ayat dalam satu transaksi. Isi lama edisi
    /// yang sama diganti seluruhnya (tidak ada campuran versi bila unduhan ulang).
    pub fn replace_edition(
        &mut self,
        ed: &InstalledEdition,
        verses: &[TranslationVerse],
    ) -> Result<(), rusqlite::Error> {
        let tx = self.conn.transaction()?;
        Self::upsert_edition_on(&tx, ed)?;
        tx.execute(
            "DELETE FROM translation_text WHERE edition_id = ?1",
            params![ed.id],
        )?;
        for v in verses {
            Self::insert_verse_on(&tx, v)?;
        }
        tx.commit()
    }

    /// Menghapus edisi beserta seluruh teksnya. `false` bila edisi tidak terpasang.
    pub fn remove_edition(&self, edition_id: &str) -> Result<bool, rusqlite::Error> {
        let n = self
            .conn
            .execute("DELETE FROM edition WHERE id = ?1", params![edition_id])?;
        Ok(n > 0)
    }

    /// Mengambil terjemahan ayat tertentu.
    pub fn get_translation_verse(
        &self,
        edition_id: &str,
        surah_id: u32,
        ayah_number: u32,
    ) -> Result<Option<TranslationVerse>, rusqlite::Error> {
        self.conn
            .query_row(
                "SELECT edition_id, surah_id, ayah_number, text, clean_text, footnotes_json
                 FROM translation_text
                 WHERE edition_id = ?1 AND surah_id = ?2 AND ayah_number = ?3",
                params![edition_id, surah_id, ayah_number],
                |row| {
                    Ok(TranslationVerse {
                        edition_id: row.get(0)?,
                        surah_id: row.get(1)?,
                        ayah_number: row.get(2)?,
                        text: row.get(3)?,
                        clean_text: row.get(4)?,
                        footnotes_json: row.get(5)?,
                    })
                },
            )
            .optional()
    }

    /// Mengambil daftar seluruh edisi yang telah diinstal.
    pub fn list_editions(&self) -> Result<Vec<InstalledEdition>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, language, bcp_47, direction, translator, source, total_verses, downloaded_at
             FROM edition ORDER BY name ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            let down_at: i64 = row.get(8)?;
            Ok(InstalledEdition {
                id: row.get(0)?,
                name: row.get(1)?,
                language: row.get(2)?,
                bcp_47: row.get(3)?,
                direction: row.get(4)?,
                translator: row.get(5)?,
                source: row.get(6)?,
                total_verses: row.get(7)?,
                downloaded_at: down_at as u64,
            })
        })?;
        rows.collect()
    }

    /// Menyimpan badan respons katalog (mis. daftar edisi remote) agar tetap tersedia saat offline.
    pub fn put_catalog(
        &self,
        name: &str,
        body: &str,
        fetched_at: u64,
    ) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "INSERT INTO catalog_cache (name, body, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at",
            params![name, body, fetched_at as i64],
        )?;
        Ok(())
    }

    /// Badan katalog tersimpan terakhir beserta waktu pengambilannya (detik UNIX).
    pub fn get_catalog(&self, name: &str) -> Result<Option<(String, u64)>, rusqlite::Error> {
        self.conn
            .query_row(
                "SELECT body, fetched_at FROM catalog_cache WHERE name = ?1",
                params![name],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)),
            )
            .optional()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn saheeh() -> InstalledEdition {
        InstalledEdition {
            id: "en.saheeh".into(),
            name: "Saheeh International".into(),
            language: "english".into(),
            bcp_47: "en".into(),
            direction: "ltr".into(),
            translator: Some("Saheeh International".into()),
            source: "Quran.com".into(),
            total_verses: 6236,
            downloaded_at: 1700000000,
        }
    }

    fn verse(id: &str, a: u32, t: &str) -> TranslationVerse {
        TranslationVerse {
            edition_id: id.into(),
            surah_id: 1,
            ayah_number: a,
            text: t.into(),
            clean_text: t.into(),
            footnotes_json: None,
        }
    }

    #[test]
    fn test_content_db_edition_and_verse_crud() {
        let db = ContentDb::open_in_memory().expect("Buka DB in-memory berhasil");
        db.upsert_edition(&saheeh()).expect("Upsert edisi berhasil");

        let editions = db.list_editions().expect("List edisi berhasil");
        assert_eq!(editions.len(), 1);
        assert_eq!(editions[0].id, "en.saheeh");

        let tv = TranslationVerse {
            footnotes_json: Some("[]".into()),
            ..verse(
                "en.saheeh",
                1,
                "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
            )
        };
        db.insert_translation_verse(&tv)
            .expect("Insert ayat berhasil");

        let fetched = db
            .get_translation_verse("en.saheeh", 1, 1)
            .expect("Get ayat berhasil")
            .expect("Ayat harus ditemukan");
        assert_eq!(fetched.text, tv.text);
        assert!(db
            .get_translation_verse("en.saheeh", 1, 9)
            .unwrap()
            .is_none());
    }

    #[test]
    fn replace_edition_swaps_content_atomically_and_remove_cascades() {
        let mut db = ContentDb::open_in_memory().unwrap();
        db.replace_edition(
            &saheeh(),
            &[verse("en.saheeh", 1, "a"), verse("en.saheeh", 2, "b")],
        )
        .unwrap();
        // Unduh ulang dengan isi berbeda: ayat lama yang tidak ada lagi ikut hilang.
        let mut ed = saheeh();
        ed.total_verses = 1;
        db.replace_edition(&ed, &[verse("en.saheeh", 1, "a2")])
            .unwrap();
        assert_eq!(
            db.get_translation_verse("en.saheeh", 1, 1)
                .unwrap()
                .unwrap()
                .text,
            "a2"
        );
        assert!(db
            .get_translation_verse("en.saheeh", 1, 2)
            .unwrap()
            .is_none());
        assert_eq!(db.list_editions().unwrap()[0].total_verses, 1);

        assert!(db.remove_edition("en.saheeh").unwrap());
        assert!(!db.remove_edition("en.saheeh").unwrap());
        assert!(db.list_editions().unwrap().is_empty());
        assert!(db
            .get_translation_verse("en.saheeh", 1, 1)
            .unwrap()
            .is_none());
    }

    #[test]
    fn catalog_cache_roundtrip() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(db.get_catalog("translations").unwrap().is_none());
        db.put_catalog("translations", "{\"a\":1}", 10).unwrap();
        db.put_catalog("translations", "{\"a\":2}", 20).unwrap();
        assert_eq!(
            db.get_catalog("translations").unwrap(),
            Some(("{\"a\":2}".to_string(), 20))
        );
    }
}
