//! Database edisi terjemahan dan catatan kaki tambahan (content.db) (PRD QRN-12..14, B2-13).
//! Mengacu ke docs/engineering/02_DATABASE_SPECIFICATION.md §4.

use rusqlite::{params, Connection};
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

#[derive(Debug)]
pub struct ContentDb {
    conn: Connection,
}

impl ContentDb {
    /// Membuka atau membuat database content.db dengan mode STRICT dan Foreign Keys aktif.
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
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
             CREATE INDEX IF NOT EXISTS idx_tr_verse ON translation_text(surah_id, ayah_number);",
        )?;

        Ok(Self { conn })
    }

    /// Membuka content.db in-memory untuk pengujian.
    pub fn open_in_memory() -> Result<Self, rusqlite::Error> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
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
             ) STRICT;",
        )?;

        Ok(Self { conn })
    }

    /// Menyimpan atau memperbarui data edisi terjemahan.
    pub fn upsert_edition(&self, ed: &InstalledEdition) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "INSERT INTO edition (id, name, language, bcp_47, direction, translator, source, total_verses, downloaded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
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
        self.conn.execute(
            "INSERT OR REPLACE INTO translation_text (edition_id, surah_id, ayah_number, text, clean_text, footnotes_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                tv.edition_id,
                tv.surah_id,
                tv.ayah_number,
                tv.text,
                tv.clean_text,
                tv.footnotes_json
            ],
        )?;
        Ok(())
    }

    /// Mengambil terjemahan ayat tertentu.
    pub fn get_translation_verse(
        &self,
        edition_id: &str,
        surah_id: u32,
        ayah_number: u32,
    ) -> Result<Option<TranslationVerse>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT edition_id, surah_id, ayah_number, text, clean_text, footnotes_json
             FROM translation_text
             WHERE edition_id = ?1 AND surah_id = ?2 AND ayah_number = ?3",
        )?;

        let mut rows = stmt.query(params![edition_id, surah_id, ayah_number])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TranslationVerse {
                edition_id: row.get(0)?,
                surah_id: row.get(1)?,
                ayah_number: row.get(2)?,
                text: row.get(3)?,
                clean_text: row.get(4)?,
                footnotes_json: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
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

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_db_edition_and_verse_crud() {
        let db = ContentDb::open_in_memory().expect("Buka DB in-memory berhasil");

        let ed = InstalledEdition {
            id: "en.saheeh".into(),
            name: "Saheeh International".into(),
            language: "English".into(),
            bcp_47: "en".into(),
            direction: "ltr".into(),
            translator: Some("Saheeh International".into()),
            source: "Quran.com".into(),
            total_verses: 6236,
            downloaded_at: 1700000000,
        };
        db.upsert_edition(&ed).expect("Upsert edisi berhasil");

        let editions = db.list_editions().expect("List edisi berhasil");
        assert_eq!(editions.len(), 1);
        assert_eq!(editions[0].id, "en.saheeh");

        let tv = TranslationVerse {
            edition_id: "en.saheeh".into(),
            surah_id: 1,
            ayah_number: 1,
            text: "In the name of Allah, the Entirely Merciful, the Especially Merciful.".into(),
            clean_text: "In the name of Allah, the Entirely Merciful, the Especially Merciful."
                .into(),
            footnotes_json: Some("[]".into()),
        };
        db.insert_translation_verse(&tv)
            .expect("Insert ayat berhasil");

        let fetched = db
            .get_translation_verse("en.saheeh", 1, 1)
            .expect("Get ayat berhasil")
            .expect("Ayat harus ditemukan");
        assert_eq!(fetched.text, tv.text);
    }
}
