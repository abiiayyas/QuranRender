#![allow(clippy::unwrap_used)]
//! Regresi hasil spike S2 (ADR-0003): harfrust + LPMQ pada seluruh 6.236 ayat dataset.

mod common;
use qr_render::{FontFace, TextDirection};

fn lpmq() -> FontFace {
    FontFace::from_file(
        "LPMQ",
        &common::repo_root().join("assets/fonts/quran/LPMQ.ttf"),
    )
    .unwrap()
}

#[test]
fn all_6236_ayat_shape_without_notdef() {
    let face = lpmq();
    let ayat = common::all_ayat();
    assert_eq!(ayat.len(), 6236);
    let mut bad = Vec::new();
    for (s, a, text) in &ayat {
        let glyphs = face.shape(text, TextDirection::ArabicRtl).unwrap();
        if glyphs.is_empty() || glyphs.iter().any(|g| g.glyph_id == 0) {
            bad.push(format!("{s}:{a}"));
        }
    }
    assert!(
        bad.is_empty(),
        "{} ayat menghasilkan .notdef: {:?}",
        bad.len(),
        &bad[..bad.len().min(10)]
    );
}

#[test]
fn shaping_matches_harfbuzz_reference_fixture() {
    let face = lpmq();
    let fx: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/hb_shape_ref.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let rows = fx["ayat"].as_array().unwrap();
    assert!(rows.len() >= 40);
    for row in rows {
        let text = row["text"].as_str().unwrap();
        let got = face.shape(text, TextDirection::ArabicRtl).unwrap();
        let want = row["glyphs"].as_array().unwrap();
        assert_eq!(
            got.len(),
            want.len(),
            "ayah_id {}: jumlah glyph",
            row["ayah_id"]
        );
        for (g, w) in got.iter().zip(want) {
            let cl = text[..g.cluster as usize].chars().count() as i64;
            assert_eq!(
                i64::from(g.glyph_id),
                w["g"].as_i64().unwrap(),
                "ayah_id {}",
                row["ayah_id"]
            );
            assert_eq!(cl, w["cl"].as_i64().unwrap());
            assert!((i64::from(g.x_advance) - w["ax"].as_i64().unwrap()).abs() <= 1);
            assert!((i64::from(g.x_offset) - w["dx"].as_i64().unwrap()).abs() <= 1);
            assert!((i64::from(g.y_offset) - w["dy"].as_i64().unwrap()).abs() <= 1);
        }
    }
}

#[test]
fn waqf_marks_never_become_standalone_words_and_text_is_preserved() {
    // Tokenizer v1 (03 §5.4): token tanpa huruf menempel ke kata sebelumnya (beserta spasinya).
    // Aturan 1 tokenizer v1: U+06D4 (penanda akhir juz) dicatat sebagai metadata, bukan bagian kata
    // (Q5 pada PRD masih menunggu keputusan pemilik tentang codepoint ini).
    let norm = |s: &str| {
        s.replace('\u{06D4}', "")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    for (s, a, text) in common::all_ayat().iter().step_by(7) {
        let words = qr_render::words_of_ayah(text).unwrap();
        assert!(!words.is_empty(), "{s}:{a} tanpa kata");
        assert!(
            words
                .iter()
                .all(|w| w.text.chars().any(char::is_alphabetic)),
            "{s}:{a}: ada kata tanpa huruf yang berdiri sendiri"
        );
        let joined = words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(
            norm(&joined),
            norm(text),
            "{s}:{a}: gabungan kata harus sama dengan teks asli"
        );
    }
}
