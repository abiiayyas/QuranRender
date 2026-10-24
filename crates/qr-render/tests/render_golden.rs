#![allow(clippy::unwrap_used)]
//! Golden render (doc 05 §9 butir 2): hash piksel dibandingkan dengan `tests/golden/render/manifest.json`.
//! Perbarui sengaja dengan `QR_UPDATE_GOLDEN=1 cargo test -p qr-render --test render_golden`.

mod common;
use qr_render::{pixmap_digest, SceneBuilder, SoftwareRenderer};
use std::collections::BTreeMap;

const PRIMARY: [&str; 4] = ["subuh", "hening", "terang", "besar"];
/// Ayat uji: Al-Fatihah 1:5 (pendek, dengan sorotan kata aktif di tengah).
const VERSE: (u32, u32) = (1, 5);

fn golden_dir() -> std::path::PathBuf {
    common::repo_root().join("tests/golden/render")
}

fn render_case(template_id: &str, ratio: &str) -> (RenderOut, String) {
    let fonts = common::fonts();
    let tpl = common::template(template_id);
    let verses = common::verses(&[VERSE]);
    let text = verses[&VERSE].ayah_text.clone();
    let project = common::project_with(VERSE.0, VERSE.1, &text, ratio, Some("Qari Contoh"));
    // Tick tengah segmen: kata ke-2 sedang disorot, di luar rentang transisi masuk/keluar.
    let scene = SceneBuilder::build(&project, &tpl, &fonts, 48_000 * 4, &verses).unwrap();
    assert!(
        !scene.text_overflow,
        "{template_id} {ratio}: golden tidak boleh overflow"
    );
    let pm = SoftwareRenderer::render(&scene, &fonts).unwrap();
    let digest = pixmap_digest(&pm);
    let png = pm.encode_png().unwrap();
    (
        RenderOut {
            png,
            text: scene.ayah_text.unwrap(),
        },
        digest,
    )
}

struct RenderOut {
    png: Vec<u8>,
    text: String,
}

#[test]
fn golden_frames_match_committed_hashes() {
    let update = std::env::var("QR_UPDATE_GOLDEN").is_ok();
    let manifest_path = golden_dir().join("manifest.json");
    let mut expected: BTreeMap<String, String> = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut produced = BTreeMap::new();
    let mut mismatches = Vec::new();

    for id in PRIMARY {
        let tpl = common::template(id);
        for ratio in &tpl.supported_ratios {
            let name = format!("{id}_{}", ratio.replace(':', "x"));
            let (out, digest) = render_case(id, ratio);
            assert_eq!(
                out.text,
                common::verses(&[VERSE])[&VERSE].ayah_text,
                "teks harus verbatim dari dataset"
            );
            if update {
                std::fs::create_dir_all(golden_dir()).unwrap();
                std::fs::write(golden_dir().join(format!("{name}.png")), &out.png).unwrap();
            } else if expected.get(&name) != Some(&digest) {
                mismatches.push(format!(
                    "{name}: diharapkan {:?}, hasil {digest}",
                    expected.get(&name)
                ));
            }
            produced.insert(name, digest);
        }
    }
    if update {
        std::fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&produced).unwrap() + "\n",
        )
        .unwrap();
        expected = produced.clone();
    }
    assert_eq!(
        expected.keys().collect::<Vec<_>>(),
        produced.keys().collect::<Vec<_>>(),
        "set frame golden berubah"
    );
    assert!(
        mismatches.is_empty(),
        "Golden tidak cocok:\n{}",
        mismatches.join("\n")
    );
    // Katalog doc 05 §8: subuh 4 + hening 4 + terang 3 + besar 2 rasio.
    assert_eq!(produced.len(), 13);
}

#[test]
fn rendering_is_deterministic_across_runs() {
    let (_, a) = render_case("subuh", "9:16");
    let (_, b) = render_case("subuh", "9:16");
    assert_eq!(a, b);
}

#[test]
fn different_verses_produce_different_frames() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(1, 1), (2, 255)]);
    let mut digests = Vec::new();
    for key in [(1u32, 1u32), (2, 255)] {
        let text = verses[&key].ayah_text.clone();
        let p = common::project_with(key.0, key.1, &text, "9:16", None);
        let scene = SceneBuilder::build(&p, &tpl, &fonts, 48_000 * 5, &verses).unwrap();
        assert_eq!(scene.ayah_text.as_deref(), Some(text.as_str()));
        digests.push(pixmap_digest(
            &SoftwareRenderer::render(&scene, &fonts).unwrap(),
        ));
    }
    assert_ne!(
        digests[0], digests[1],
        "renderer tidak boleh menampilkan teks tetap"
    );
}

#[test]
fn missing_verse_text_fails_instead_of_falling_back() {
    let fonts = common::fonts();
    let tpl = common::template("subuh");
    let verses = common::verses(&[(1, 1)]);
    let text = verses[&(1, 1)].ayah_text.clone();
    let p = common::project_with(1, 2, &text, "9:16", None); // 1:2 tidak ada di `verses`
    let err = SceneBuilder::build(&p, &tpl, &fonts, 48_000, &verses).unwrap_err();
    assert!(err.to_string().contains("1:2"), "{err}");
}

#[test]
fn unsupported_ratio_is_rejected() {
    let fonts = common::fonts();
    let tpl = common::template("besar"); // hanya 9:16 dan 1:1
    let verses = common::verses(&[VERSE]);
    let text = verses[&VERSE].ayah_text.clone();
    let p = common::project_with(1, 5, &text, "16:9", None);
    assert!(SceneBuilder::build(&p, &tpl, &fonts, 48_000, &verses).is_err());
}

#[test]
fn long_ayah_2_282_overflow_is_flagged_and_word_range_split_fits() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(2, 282)]);
    let text = verses[&(2, 282)].ayah_text.clone();
    let sa = tpl.safe_area_for("9:16").unwrap();
    let (cw, ch) = (1080.0f32, 1920.0f32);
    let (left, right) = (sa.left * cw, cw * (1.0 - sa.right));
    let (top, bottom) = (sa.top * ch, ch * (1.0 - sa.bottom));

    // 1) Seluruh ayat dalam satu segmen: tidak muat -> harus ditandai, bukan digambar diam-diam.
    let whole = common::project_with(2, 282, &text, "9:16", None);
    let scene = SceneBuilder::build(&whole, &tpl, &fonts, 48_000 * 5, &verses).unwrap();
    assert!(
        scene.text_overflow,
        "2:282 satu segmen harus ditandai overflow"
    );
    assert_eq!(
        scene.ayah_fit_iterations, 5,
        "auto-fit harus sampai iterasi terakhir"
    );

    // 2) Dibagi per rentang kata memakai saran renderer: semua segmen muat, rentang menyambung tanpa
    //    tumpang tindih dan mencakup seluruh kata (tidak ada kata terpotong atau hilang).
    let words = qr_render::words_of_ayah(&text).unwrap();
    let ranges = qr_render::suggest_word_ranges(
        &fonts.lpmq,
        &words,
        qr_render::TextDirection::ArabicRtl,
        0.098 * cw,
        0.80 * cw,
        (bottom - top) - 0.08 * ch,
        1.95,
    )
    .unwrap();
    assert!(
        ranges.len() >= 2,
        "2:282 harus dibagi (tidak muat satu layar), dapat {} rentang",
        ranges.len()
    );
    assert_eq!(ranges.first().unwrap().0, 1);
    assert_eq!(ranges.last().unwrap().1 as usize, words.len());
    for pair in ranges.windows(2) {
        assert_eq!(
            pair[0].1 + 1,
            pair[1].0,
            "rentang harus menyambung tanpa celah/tumpang tindih"
        );
    }
    // Bagian ini menguji pembagian teks Arab saja: proyek tanpa edisi terjemahan. (Segmen sebagian
    // ayat kini menampilkan terjemahan ayat utuh berstatus "perlu ditinjau" bila belum dipotong;
    // terjemahan 2:282 utuh memang tidak muat dan harus dipotong lewat fitur pemotongan terjemahan.)
    for (a, b) in ranges {
        let mut p = common::project_with(2, 282, &text, "9:16", None);
        p.translation_editions.clear();
        p.segments[0].word_range = Some((a, b));
        let scene = SceneBuilder::build(&p, &tpl, &fonts, 48_000 * 5, &verses).unwrap();
        assert!(!scene.text_overflow, "rentang {a}-{b} masih overflow");
        for prim in &scene.primitives {
            if let qr_render::Primitive::Text(t) = prim {
                assert!(
                    t.y >= top - 1.0 && t.y + t.layout.height_px <= bottom + 1.0,
                    "rentang {a}-{b}: teks keluar area aman vertikal"
                );
                let maxw = t
                    .layout
                    .lines
                    .iter()
                    .map(|l| l.width_px)
                    .fold(0.0, f32::max);
                assert!(
                    t.x + (t
                        .layout
                        .lines
                        .iter()
                        .map(|l| l.width_px)
                        .fold(0.0, f32::max)
                        - maxw)
                        / 2.0
                        >= left - 1.0
                );
                assert!(
                    t.x + maxw <= right + 1.0,
                    "rentang {a}-{b}: baris keluar area aman horizontal"
                );
            }
        }
    }
}

#[test]
fn rendered_frame_contains_text_pixels() {
    // Bukti bahwa teks benar-benar digambar: template hening (latar #101114, teks terang).
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[VERSE]);
    let text = verses[&VERSE].ayah_text.clone();
    let p = common::project_with(1, 5, &text, "9:16", None);
    let scene = SceneBuilder::build(&p, &tpl, &fonts, 48_000 * 4, &verses).unwrap();
    let pm = SoftwareRenderer::render(&scene, &fonts).unwrap();
    let bright = pm
        .pixels()
        .iter()
        .filter(|px| px.red() > 150 && px.green() > 150)
        .count();
    assert!(
        bright > 5_000,
        "hanya {bright} piksel terang: teks tampaknya tidak tergambar"
    );
}
