#![allow(clippy::unwrap_used)]
//! Latar media: primitif gambar di bawah dimmer dan teks, dimmer efektif dari
//! `style_overrides["background_dimmer"]` (angka atau string numerik), validasi ukuran.

mod common;

use qr_render::{background_pixmap, Primitive, SceneBuilder, SoftwareRenderer};
use serde_json::json;

const W: u32 = 270;
const H: u32 = 480;
/// Di dalam segmen (teks tampil) dan sesudah segmen (tanpa teks).
const T_TEXT: i64 = 48_000 * 5;
const T_AFTER: i64 = 48_000 * 11;

fn red_background() -> std::sync::Arc<qr_render::Pixmap> {
    let rgba: Vec<u8> = (0..W * H).flat_map(|_| [200u8, 40, 20, 255]).collect();
    background_pixmap(W, H, &rgba).unwrap()
}

fn project() -> qr_core::Project {
    let verses = common::verses(&[(1, 2)]);
    let text = verses[&(1, 2)].ayah_text.clone();
    let mut p = common::project_with(1, 2, &text, "9:16", None);
    p.canvas.width = W;
    p.canvas.height = H;
    p
}

fn render(
    p: &qr_core::Project,
    tick: i64,
    bg: Option<&std::sync::Arc<qr_render::Pixmap>>,
) -> qr_render::Pixmap {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(1, 2)]);
    let scene = SceneBuilder::build_with_background(p, &tpl, &fonts, tick, &verses, bg).unwrap();
    SoftwareRenderer::render(&scene, &fonts).unwrap()
}

fn px(pm: &qr_render::Pixmap, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * pm.width() + x) * 4) as usize;
    let d = pm.data();
    [d[i], d[i + 1], d[i + 2], d[i + 3]]
}

#[test]
fn image_primitive_sits_between_fill_and_text() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(1, 2)]);
    let mut p = project();
    p.style_overrides
        .insert("background_dimmer".into(), json!("0.35"));
    let bg = red_background();
    let scene =
        SceneBuilder::build_with_background(&p, &tpl, &fonts, T_TEXT, &verses, Some(&bg)).unwrap();
    let image = scene
        .primitives
        .iter()
        .position(|q| matches!(q, Primitive::Image { .. }))
        .unwrap();
    let fill = scene
        .primitives
        .iter()
        .position(|q| matches!(q, Primitive::Fill { .. }))
        .unwrap();
    let first_text = scene
        .primitives
        .iter()
        .position(|q| matches!(q, Primitive::Text(_)))
        .unwrap();
    assert!(fill < image && image < first_text);
    // Tanpa latar media tidak ada primitif gambar.
    let plain = SceneBuilder::build(&p, &tpl, &fonts, T_TEXT, &verses).unwrap();
    assert!(!plain
        .primitives
        .iter()
        .any(|q| matches!(q, Primitive::Image { .. })));
}

#[test]
fn background_differs_from_colour_fill_and_text_stays_on_top() {
    let mut p = project();
    p.style_overrides
        .insert("background_dimmer".into(), json!("0.35"));
    let bg = red_background();
    let with_bg = render(&p, T_TEXT, Some(&bg));
    let without = render(&p, T_TEXT, None);
    assert_ne!(with_bg.data(), without.data());

    // Frame tanpa segmen aktif = latar saja; selisih terhadap frame bertulisan = piksel teks, yang
    // harus ada (teks digambar di atas latar) sementara sudut tetap latar.
    let only_bg = render(&p, T_AFTER, Some(&bg));
    assert_ne!(
        with_bg.data(),
        only_bg.data(),
        "teks tidak tergambar di atas latar"
    );
    assert_eq!(px(&with_bg, 0, 0), px(&only_bg, 0, 0));
    // Warna latar merah tembus (dimmer 35% mengurangi, tidak menggantikan dengan warna template).
    let c = px(&only_bg, 0, 0);
    assert!(
        c[0] > c[1] && c[0] > c[2],
        "latar merah tidak terlihat: {c:?}"
    );
}

#[test]
fn effective_dimmer_comes_from_override_number_or_numeric_string() {
    let bg = red_background();
    let corner = |p: &qr_core::Project| px(&render(p, T_AFTER, Some(&bg)), 0, 0);

    let mut p = project();
    // Tanpa nilai: tanpa peredup → piksel latar asli.
    assert_eq!(corner(&p), [200, 40, 20, 255]);
    p.style_overrides
        .insert("background_dimmer".into(), json!(0.5));
    let numeric = corner(&p);
    p.style_overrides
        .insert("background_dimmer".into(), json!("0.5"));
    let string = corner(&p);
    assert_eq!(numeric, string);
    assert!(numeric[0] < 140 && numeric[0] > 60, "{numeric:?}");
    p.style_overrides
        .insert("background_dimmer".into(), json!("tidak angka"));
    assert_eq!(corner(&p), [200, 40, 20, 255]);
    p.style_overrides
        .insert("background_dimmer".into(), json!("1"));
    assert_eq!(corner(&p)[0], 0, "dimmer 100% hitam");
}

#[test]
fn background_size_must_match_canvas() {
    let fonts = common::fonts();
    let tpl = common::template("hening");
    let verses = common::verses(&[(1, 2)]);
    let mut p = project();
    p.canvas.width = W + 2;
    let err = SceneBuilder::build_with_background(
        &p,
        &tpl,
        &fonts,
        T_TEXT,
        &verses,
        Some(&red_background()),
    )
    .unwrap_err();
    assert!(err.to_string().contains("Ukuran latar"), "{err}");
}

#[test]
fn background_pixmap_composites_transparency_over_black_and_checks_length() {
    let rgba = vec![255u8, 255, 255, 128, 10, 20, 30, 0];
    let pm = background_pixmap(2, 1, &rgba).unwrap();
    assert_eq!(px(&pm, 0, 0), [128, 128, 128, 255]);
    assert_eq!(px(&pm, 1, 0), [0, 0, 0, 255]);
    assert!(background_pixmap(2, 2, &rgba).is_err());
}
