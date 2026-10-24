#![allow(clippy::unwrap_used)]
//! Terjemahan di scene: segmen sebagian ayat, beberapa edisi, dan segmen khusus (basmalah/isti'adzah).

mod common;

use qr_core::project::{SegmentKind, SegmentTranslation, TranslationStatus};
use qr_render::{SceneBuilder, ISTIADHA_AR};

const T: i64 = 48_000 * 5;

#[test]
fn partial_segment_shows_trimmed_entry_or_whole_translation() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(1, 2)]);
    let text = verses[&(1, 2)].ayah_text.clone();
    let whole = verses[&(1, 2)].translations["id.kemenag"].clone();

    let mut p = common::project_with(1, 2, &text, "9:16", None);
    p.segments[0].word_range = Some((1, 2));
    // Tanpa entri: terjemahan ayat utuh (status "perlu ditinjau"), bukan disembunyikan.
    let scene = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    assert_eq!(scene.translations, vec![whole.clone()]);

    p.segments[0].translations.insert(
        "id.kemenag".into(),
        SegmentTranslation {
            text: "Segala puji bagi Allah,".into(),
            status: TranslationStatus::Reviewed,
        },
    );
    let scene = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    assert_eq!(
        scene.translations,
        vec!["Segala puji bagi Allah,".to_string()]
    );
    assert!(!scene.text_overflow);
}

#[test]
fn multiple_editions_are_stacked_in_project_order() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let mut verses = common::verses(&[(1, 2)]);
    verses.get_mut(&(1, 2)).unwrap().translations.insert(
        "en.qdc20".into(),
        "[All] praise is [due] to Allah, Lord of the worlds -".into(),
    );
    let text = verses[&(1, 2)].ayah_text.clone();
    let mut p = common::project_with(1, 2, &text, "9:16", None);

    let single = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    p.translation_editions = vec!["en.qdc20".into(), "id.kemenag".into()];
    let both = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    assert_eq!(both.translations.len(), 2);
    assert!(both.translations[0].starts_with("[All] praise"));
    assert!(both.translations[1].starts_with("Segala puji"));

    let height = |s: &qr_render::RenderScene| {
        s.primitives
            .iter()
            .filter_map(|p| match p {
                qr_render::Primitive::Text(t) if t.family == "Inter" => Some(t.layout.height_px),
                _ => None,
            })
            .fold(0.0f32, f32::max)
    };
    assert!(
        height(&both) > height(&single),
        "dua edisi harus menambah tinggi blok terjemahan"
    );

    // Edisi yang tidak tersedia dilewati tanpa galat.
    p.translation_editions = vec!["fr.qdc31".into()];
    let none = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    assert!(none.translations.is_empty());
}

#[test]
fn special_segments_render_builtin_arabic_and_translation_without_reference() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(1, 1)]);
    let basmala = verses[&(1, 1)].ayah_text.clone();

    let mut p = common::project_with(1, 1, &basmala, "9:16", None);
    p.translation_editions = vec!["id.kemenag".into(), "en.qdc20".into()];
    let sg = &mut p.segments[0];
    sg.kind = SegmentKind::Basmala;
    sg.surah_id = 0;
    sg.ayah_number = 0;
    let scene = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    assert_eq!(scene.ayah_text.as_deref(), Some(basmala.as_str()));
    assert_eq!(scene.translations.len(), 2);
    assert!(scene.translations[0].starts_with("Dengan nama Allah"));
    assert!(scene.translations[1].starts_with("In the name of Allah"));
    // Tanpa label "surah : ayat" (hanya teks Arab + terjemahan).
    let inter_blocks = scene
        .primitives
        .iter()
        .filter(|p| matches!(p, qr_render::Primitive::Text(t) if t.family == "Inter"))
        .count();
    assert_eq!(
        inter_blocks, 1,
        "hanya blok terjemahan; tanpa lencana referensi"
    );

    let sg = &mut p.segments[0];
    sg.kind = SegmentKind::Istiadha;
    sg.word_timings.clear();
    let scene = SceneBuilder::build(&p, &tpl, &fonts, T, &verses).unwrap();
    assert_eq!(scene.ayah_text.as_deref(), Some(ISTIADHA_AR));
    assert!(scene.translations[0].starts_with("Aku berlindung"));
}
