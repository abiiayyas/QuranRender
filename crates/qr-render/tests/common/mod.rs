#![allow(dead_code, clippy::unwrap_used)]
//! Pembantu uji: memuat ayat dari `data/surah/*.json` (sumber kebenaran repositori).

use qr_core::project::{AyahSegment, Project, WordTiming};
use qr_render::{FontSet, TemplateDoc, VerseContent};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn fonts() -> FontSet {
    FontSet::load(&repo_root().join("assets")).expect("font repositori harus ada")
}

pub fn template(id: &str) -> TemplateDoc {
    TemplateDoc::load(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("templates")
            .join(id)
            .join("template.json"),
    )
    .unwrap()
}

/// Semua ayat 6.236 dari `data/surah/*.json`: (surah, ayat) → teks Arab verbatim.
pub fn all_ayat() -> Vec<(u32, u32, String)> {
    let mut out = Vec::new();
    for s in 1..=114u32 {
        let p = repo_root().join(format!("data/surah/{s}.json"));
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        for a in v["data"].as_array().unwrap() {
            out.push((
                s,
                a["aya_number"].as_u64().unwrap() as u32,
                a["aya_text"].as_str().unwrap().trim().to_string(),
            ));
        }
    }
    out
}

pub fn verses(want: &[(u32, u32)]) -> HashMap<(u32, u32), VerseContent> {
    let names: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(repo_root().join("data/surah/list-surah.json")).unwrap(),
    )
    .unwrap();
    let names = names
        .as_array()
        .cloned()
        .unwrap_or_else(|| names["data"].as_array().cloned().unwrap());
    let mut m = HashMap::new();
    for &(s, a) in want {
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(repo_root().join(format!("data/surah/{s}.json"))).unwrap(),
        )
        .unwrap();
        let ay = v["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["aya_number"].as_u64() == Some(u64::from(a)))
            .unwrap();
        let n = names
            .iter()
            .find(|x| x["nomor"].as_u64() == Some(u64::from(s)))
            .unwrap();
        m.insert(
            (s, a),
            VerseContent {
                ayah_text: ay["aya_text"].as_str().unwrap().trim().to_string(),
                translations: std::collections::BTreeMap::from([(
                    "id.kemenag".to_string(),
                    qr_quran::clean_translation(ay["translation_aya_text"].as_str().unwrap())
                        .unwrap(),
                )]),
                surah_name_ar: n["nama"].as_str().unwrap().to_string(),
                surah_name_latin: n["nama_latin"].as_str().unwrap().to_string(),
            },
        );
    }
    m
}

pub fn canvas_for(ratio: &str) -> (u32, u32) {
    match ratio {
        "9:16" => (1080, 1920),
        "16:9" => (1920, 1080),
        "1:1" => (1080, 1080),
        "4:5" => (1080, 1350),
        other => panic!("rasio {other}"),
    }
}

/// Proyek satu segmen (10 detik) dengan timing kata merata (hanya untuk uji).
pub fn project_with(
    surah: u32,
    ayah: u32,
    text: &str,
    ratio: &str,
    reciter: Option<&str>,
) -> Project {
    let (w, h) = canvas_for(ratio);
    let mut p = Project::new("Uji Render");
    p.canvas.width = w;
    p.canvas.height = h;
    p.canvas.aspect_ratio = ratio.to_string();
    p.reciter = reciter.map(str::to_string);
    let words = qr_render::words_of_ayah(text).unwrap();
    let total = 48_000i64 * 10;
    let per = total / words.len() as i64;
    let timings = words
        .iter()
        .enumerate()
        .map(|(i, wd)| WordTiming {
            word_idx: wd.word_idx,
            start_tick: i as i64 * per,
            end_tick: (i as i64 + 1) * per,
            text: wd.text.clone(),
            confidence: 0.95,
        })
        .collect();
    p.segments.push(AyahSegment {
        id: format!("seg_{surah}_{ayah}"),
        surah_id: surah,
        ayah_number: ayah,
        start_tick: 0,
        end_tick: total,
        word_timings: timings,
        confidence: 0.95,
        manual_override: false,
        word_range: None,
        ..Default::default()
    });
    p
}
