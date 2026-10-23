//! Adapter Quran.com untuk parsing terjemahan Saheeh International dan catatan kaki (PRD QRN-12, B2-13).
//! Mengacu ke docs/product/PRD.md §8.4 QRN-12 dan docs/engineering/03_DATASET_PIPELINE.md §6.2.

use crate::content_db::TranslationVerse;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuranComTranslationResponse {
    pub translations: Vec<QuranComTranslationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuranComTranslationItem {
    pub resource_id: u32,
    pub text: String,
    pub verse_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FootnoteItem {
    pub id: u32,
    pub text: String,
}

/// Membersihkan tag HTML footnote seperti `<sup foot_note=1>1</sup>` menjadi teks bersih.
pub fn extract_clean_translation_and_footnotes(raw_html: &str) -> (String, Vec<FootnoteItem>) {
    let mut clean = String::with_capacity(raw_html.len());
    let mut footnotes = Vec::new();
    let mut chars = raw_html.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag.push(tc);
            }

            // Jika tag adalah footnote: <sup foot_note=...
            if tag.starts_with("sup foot_note=") {
                let note_num_str: String = tag
                    .trim_start_matches("sup foot_note=")
                    .chars()
                    .take_while(|ch| ch.is_ascii_digit())
                    .collect();
                if let Ok(num) = note_num_str.parse::<u32>() {
                    footnotes.push(FootnoteItem {
                        id: num,
                        text: format!("Catatan kaki nomor {}", num),
                    });
                }
            }
        } else {
            clean.push(c);
        }
    }

    (clean.trim().to_string(), footnotes)
}

/// Mem-parsing payload JSON terjemahan Quran.com menjadi entri `TranslationVerse`.
pub fn parse_quran_com_payload(
    edition_id: &str,
    json_str: &str,
) -> Result<Vec<TranslationVerse>, String> {
    let parsed: QuranComTranslationResponse = serde_json::from_str(json_str)
        .map_err(|e| format!("Gagal parsing JSON Quran.com: {}", e))?;

    let mut verses = Vec::with_capacity(parsed.translations.len());

    for item in parsed.translations {
        let (surah_id, ayah_number) = if let Some(key) = &item.verse_key {
            let parts: Vec<&str> = key.split(':').collect();
            if parts.len() == 2 {
                (
                    parts[0].parse::<u32>().unwrap_or(1),
                    parts[1].parse::<u32>().unwrap_or(1),
                )
            } else {
                (1, 1)
            }
        } else {
            (1, 1)
        };

        let (clean_text, footnotes) = extract_clean_translation_and_footnotes(&item.text);
        let footnotes_json = serde_json::to_string(&footnotes).ok();

        verses.push(TranslationVerse {
            edition_id: edition_id.to_string(),
            surah_id,
            ayah_number,
            text: item.text,
            clean_text,
            footnotes_json,
        });
    }

    Ok(verses)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_clean_text_and_footnotes() {
        let raw = "In the name of Allah, the Entirely Merciful,<sup foot_note=1>1</sup> the Especially Merciful.";
        let (clean, notes) = extract_clean_translation_and_footnotes(raw);

        assert_eq!(
            clean,
            "In the name of Allah, the Entirely Merciful,1 the Especially Merciful."
        );
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, 1);
    }

    #[test]
    fn test_parse_quran_com_json_response() {
        let payload = r#"{
            "translations": [
                {
                    "resource_id": 20,
                    "text": "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
                    "verse_key": "1:1"
                },
                {
                    "resource_id": 20,
                    "text": "[All] praise is [due] to Allah, Lord of the worlds -<sup foot_note=2>2</sup>",
                    "verse_key": "1:2"
                }
            ]
        }"#;

        let verses = parse_quran_com_payload("en.saheeh", payload)
            .expect("Parsing payload Quran.com harus berhasil");
        assert_eq!(verses.len(), 2);
        assert_eq!(verses[0].surah_id, 1);
        assert_eq!(verses[0].ayah_number, 1);
        assert_eq!(verses[1].ayah_number, 2);
        assert!(verses[1]
            .footnotes_json
            .as_ref()
            .expect("Footnote JSON harus ada")
            .contains("\"id\":2"));
    }
}
