#![allow(clippy::unwrap_used)]
use qr_quran::{clean_translation, tokenize_ayah_v1};
use serde::Deserialize;
use std::fs;

#[derive(Deserialize)]
struct AyahJson {
    aya_number: u32,
    aya_text: String,
    sura_id: u32,
    translation_aya_text: String,
}

#[derive(Deserialize)]
struct SurahJson {
    data: Vec<AyahJson>,
}

#[test]
fn test_tokenize_entire_quran_dataset() {
    let mut total_words = 0;
    let mut max_words = 0;
    let mut max_ayah = (0, 0);
    let mut rub_count = 0;
    let mut juz_end_count = 0;
    let mut sajdah_count = 0;

    for sura_id in 1..=114 {
        let path = format!("../../data/surah/{}.json", sura_id);
        let content = fs::read_to_string(&path).unwrap_or_else(|_| {
            fs::read_to_string(format!("data/surah/{}.json", sura_id)).unwrap()
        });
        let surah: SurahJson = serde_json::from_str(&content).unwrap();

        for ayah in surah.data {
            assert_eq!(ayah.sura_id, sura_id);

            // 1. Uji normalisasi terjemahan Kemenag
            let cleaned_tr = clean_translation(&ayah.translation_aya_text).unwrap_or_else(|e| {
                panic!(
                    "Gagal membersihkan terjemahan {}:{}: {:?}",
                    sura_id, ayah.aya_number, e
                )
            });
            assert!(!cleaned_tr.is_empty());

            // 2. Uji tokenizer v1
            let (words, meta) = tokenize_ayah_v1(&ayah.aya_text).unwrap_or_else(|e| {
                panic!("Gagal tokenisasi {}:{}: {:?}", sura_id, ayah.aya_number, e)
            });

            let word_count = words.len();
            total_words += word_count;

            if word_count > max_words {
                max_words = word_count;
                max_ayah = (sura_id, ayah.aya_number);
            }

            if meta.has_rub_el_hizb {
                rub_count += 1;
            }
            if meta.has_juz_end_mark {
                juz_end_count += 1;
            }
            if meta.has_sajdah {
                sajdah_count += 1;
            }

            // Periksa offset span dan core
            let trimmed = ayah.aya_text.trim();
            for w in words {
                assert_eq!(&trimmed[w.span_start..w.span_end], &w.text);
                assert_eq!(&trimmed[w.core_start..w.core_end], &w.core);
            }
        }
    }

    // Bandingkan dengan statistik terukur di docs/engineering/03_DATASET_PIPELINE.md §5.4
    assert_eq!(total_words, 77511, "Total kata harus persis 77.511");
    assert_eq!(max_words, 129, "Kata terbanyak dalam satu ayat harus 129");
    assert_eq!(
        max_ayah,
        (2, 282),
        "Ayat terpanjang harus 2:282 (Ayat Mudayanah)"
    );
    assert_eq!(rub_count, 181, "Ayat dengan tanda ۞ harus 181");
    assert_eq!(
        juz_end_count, 29,
        "Ayat dengan tanda penanda akhir juz harus 29"
    );
    assert_eq!(sajdah_count, 15, "Ayat sajdah (۩) harus 15");
}
