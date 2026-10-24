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

/// Membersihkan teks terjemahan: menghapus penanda catatan kaki `<sup foot_note=N>N</sup>` **beserta
/// angkanya**, dan menghapus tag HTML lain tanpa menghapus isinya. Mengembalikan teks bersih dan id
/// catatan kaki yang ditemukan.
///
/// Isi catatan kaki TIDAK ada pada respons terjemahan; harus diambil terpisah (Quran.com `foot_notes`).
/// Karena itu `FootnoteItem.text` dibiarkan kosong, bukan diisi teks karangan.
pub fn extract_clean_translation_and_footnotes(raw_html: &str) -> (String, Vec<FootnoteItem>) {
    let mut clean = String::with_capacity(raw_html.len());
    let mut footnotes = Vec::new();
    let mut chars = raw_html.chars().peekable();
    let mut skip_until_sup_close = false;

    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag.push(tc);
            }
            if let Some(rest) = tag.strip_prefix("sup foot_note=") {
                let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
                if let Ok(id) = digits.parse::<u32>() {
                    footnotes.push(FootnoteItem {
                        id,
                        text: String::new(),
                    });
                    skip_until_sup_close = true;
                }
            } else if tag == "/sup" {
                skip_until_sup_close = false;
            }
        } else if !skip_until_sup_close {
            clean.push(c);
        }
    }

    // Sisa tag HTML, entitas HTML, dan spasi ganda dibereskan oleh normalisasi yang sama dengan dataset
    // (03 §5.6). Teks yang kosong setelah normalisasi dikembalikan kosong (ditolak oleh pemanggil).
    let normalized = qr_quran::clean_translation(&clean).unwrap_or_default();
    (normalized, footnotes)
}

/// Mem-parsing dan **memvalidasi** respons terjemahan Quran.com (03 §6.2). Respons ditolak seluruhnya bila:
/// - bukan JSON yang valid;
/// - jumlah `translations` ≠ jumlah ayat yang diharapkan;
/// - `verse_key` hilang/tidak valid atau urutannya ≠ urutan `expected` (dari `quran.db`);
/// - `resource_id` ≠ `expected_resource_id`;
/// - ada teks kosong setelah normalisasi.
pub fn parse_quran_com_payload(
    edition_id: &str,
    expected_resource_id: u32,
    expected: &[(u32, u32)],
    json_str: &str,
) -> Result<Vec<TranslationVerse>, String> {
    let parsed: QuranComTranslationResponse =
        serde_json::from_str(json_str).map_err(|e| format!("Gagal parsing JSON Quran.com: {e}"))?;
    if parsed.translations.len() != expected.len() {
        return Err(format!(
            "Jumlah terjemahan {} tidak sama dengan yang diharapkan {}",
            parsed.translations.len(),
            expected.len()
        ));
    }

    let mut verses = Vec::with_capacity(expected.len());
    for (idx, (item, &(want_s, want_a))) in
        parsed.translations.into_iter().zip(expected).enumerate()
    {
        if item.resource_id != expected_resource_id {
            return Err(format!(
                "Entri {idx}: resource_id {} bukan {expected_resource_id}",
                item.resource_id
            ));
        }
        let key = item
            .verse_key
            .as_deref()
            .ok_or_else(|| format!("Entri {idx}: verse_key hilang"))?;
        let (s, a) = key
            .split_once(':')
            .and_then(|(s, a)| Some((s.parse::<u32>().ok()?, a.parse::<u32>().ok()?)))
            .ok_or_else(|| format!("Entri {idx}: verse_key '{key}' tidak valid"))?;
        if (s, a) != (want_s, want_a) {
            return Err(format!(
                "Entri {idx}: urutan salah, dapat {s}:{a}, diharapkan {want_s}:{want_a}"
            ));
        }

        let (clean_text, footnotes) = extract_clean_translation_and_footnotes(&item.text);
        if clean_text.is_empty() {
            return Err(format!(
                "Entri {idx} ({key}): teks kosong setelah normalisasi"
            ));
        }
        let footnotes_json = if footnotes.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&footnotes).map_err(|e| e.to_string())?)
        };
        verses.push(TranslationVerse {
            edition_id: edition_id.to_string(),
            surah_id: s,
            ayah_number: a,
            text: item.text,
            clean_text,
            footnotes_json,
        });
    }
    Ok(verses)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn payload(items: &[(&str, u32, &str)]) -> String {
        let v: Vec<serde_json::Value> = items
            .iter()
            .map(|(k, r, t)| serde_json::json!({"verse_key": k, "resource_id": r, "text": t}))
            .collect();
        serde_json::json!({ "translations": v }).to_string()
    }

    const EXPECTED: [(u32, u32); 2] = [(1, 1), (1, 2)];

    #[test]
    fn footnote_marker_and_its_number_are_removed_from_clean_text() {
        let raw = "In the name of Allah, the Entirely Merciful,<sup foot_note=1>1</sup> the Especially Merciful.";
        let (clean, notes) = extract_clean_translation_and_footnotes(raw);
        assert_eq!(
            clean,
            "In the name of Allah, the Entirely Merciful, the Especially Merciful."
        );
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, 1);
        assert!(
            notes[0].text.is_empty(),
            "isi catatan kaki tidak boleh dikarang"
        );
    }

    #[test]
    fn other_html_tags_are_stripped_but_text_kept() {
        let (clean, notes) = extract_clean_translation_and_footnotes("A <i>kind</i> word");
        assert_eq!(clean, "A kind word");
        assert!(notes.is_empty());
    }

    #[test]
    fn html_entities_are_decoded_after_markers_removed() {
        let (clean, notes) = extract_clean_translation_and_footnotes(
            "He said, &quot;Indeed, I know&quot;<sup foot_note=7>1</sup>  &amp; more.",
        );
        assert_eq!(clean, "He said, \"Indeed, I know\" & more.");
        assert_eq!(notes[0].id, 7);
    }

    #[test]
    fn valid_payload_is_parsed_in_order_with_footnote_ids() {
        let p = payload(&[
            (
                "1:1",
                20,
                "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
            ),
            (
                "1:2",
                20,
                "[All] praise is [due] to Allah, Lord of the worlds -<sup foot_note=2>2</sup>",
            ),
        ]);
        let v = parse_quran_com_payload("en.saheeh", 20, &EXPECTED, &p).unwrap();
        assert_eq!(
            (v[0].surah_id, v[0].ayah_number, v[1].ayah_number),
            (1, 1, 2)
        );
        assert!(v[0].footnotes_json.is_none());
        assert!(v[1].footnotes_json.as_ref().unwrap().contains("\"id\":2"));
        assert!(
            !v[1].clean_text.contains('2'),
            "angka catatan kaki bocor ke teks: {}",
            v[1].clean_text
        );
    }

    #[test]
    fn invalid_responses_are_rejected_entirely() {
        let ok = ("1:1", 20, "Text one.");
        let ok2 = ("1:2", 20, "Text two.");
        let cases: Vec<(String, &str)> = vec![
            ("bukan json".into(), "parsing"),
            (payload(&[ok]), "Jumlah"),
            (payload(&[ok2, ok]), "urutan salah"),
            (payload(&[ok, ("1:2", 21, "Text two.")]), "resource_id"),
            (payload(&[ok, ("1:2", 20, "<sup foot_note=1>1</sup>")]), "kosong"),
            (payload(&[ok, ("1:2", 20, "   ")]), "kosong"),
            (payload(&[ok, ("bukan-kunci", 20, "Text two.")]), "tidak valid"),
            (r#"{"translations":[{"resource_id":20,"text":"a"},{"resource_id":20,"text":"b","verse_key":"1:2"}]}"#.into(), "hilang"),
        ];
        for (body, needle) in cases {
            let err = parse_quran_com_payload("en.saheeh", 20, &EXPECTED, &body).unwrap_err();
            assert!(
                err.to_lowercase().contains(&needle.to_lowercase()),
                "{needle}: {err}"
            );
        }
    }
}
