//! A1-11 (PRD RND-1): kesetaraan preview–ekspor. Proyek nyata → `run_render_job` (jalur ekspor
//! produk: RGBA→YUV420 BT.709 di Rust → FFmpeg → MP4) → decode frame (BT.709 TV → RGB) pada 50 tick
//! deterministik → dibandingkan dengan frame preview (`SceneBuilder` + `SoftwareRenderer`) pada tick
//! dan ukuran yang sama. Metrik: SSIM luma 8×8 (lihat `qr_media::ssim`) dan selisih kanal maksimum.

#![allow(clippy::unwrap_used)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use qr_core::project::{AyahSegment, Project, WordTiming};
use qr_media::{extract_rgb24_frames, luma_bt709, ssim_rgb};
use qr_render::{load_builtin_template, FontSet, SceneBuilder, SoftwareRenderer, VerseContent};
use serde_json::Value;

use crate::render_job::{default_resources_dir, run_render_job, RenderPayload};

const TICKS_PER_SECOND: i64 = 48_000;
const FPS: u64 = 30;
const SECONDS: i64 = 4;
const WIDTH: u32 = 360;
const TICK_COUNT: usize = 50;
/// Ambang RND-1 untuk ekspor lossless/near-lossless.
const SSIM_RND1: f64 = 0.995;
/// Selisih kanal maksimum (0..255) di area datar, di luar antialiasing tepi font (RND-1).
const MAX_FLAT_DIFF: u8 = 2;
/// Area "tepi": piksel yang jendela 5×5 luma preview-nya memiliki rentang > nilai ini (antialiasing
/// huruf, tepi bentuk). Jendela 5×5 mencakup blur chroma 4:2:0 (±1 piksel chroma = ±2 piksel luma).
const EDGE_LUMA_RANGE: u8 = 6;

struct Fixture {
    resources: PathBuf,
    project_dir: PathBuf,
    verses: HashMap<(u32, u32), VerseContent>,
}

fn fixture(tag: &str) -> Fixture {
    let resources = default_resources_dir();
    let src: Value = serde_json::from_str(
        &std::fs::read_to_string(resources.join("data/surah/1.json")).unwrap(),
    )
    .unwrap();
    let a = &src["data"][0];
    let text = a["aya_text"].as_str().unwrap().trim().to_string();
    let mut verses = HashMap::new();
    verses.insert(
        (1, 1),
        VerseContent {
            ayah_text: text.clone(),
            translation: Some(
                qr_quran::clean_translation(a["translation_aya_text"].as_str().unwrap()).unwrap(),
            ),
            surah_name_ar: "الفاتحة".into(),
            surah_name_latin: "Al-Fatihah".into(),
        },
    );
    let project_dir =
        std::env::temp_dir().join(format!("qr_equiv_{}_{tag}.qrproj", std::process::id()));
    let mut p = Project::new("Kesetaraan");
    p.template_id = "subuh".into();
    let words: Vec<&str> = text.split_whitespace().collect();
    let per_word = SECONDS * TICKS_PER_SECOND / words.len() as i64;
    p.segments.push(AyahSegment {
        id: "s1".into(),
        surah_id: 1,
        ayah_number: 1,
        start_tick: 0,
        end_tick: SECONDS * TICKS_PER_SECOND,
        word_timings: words
            .iter()
            .enumerate()
            .map(|(i, w)| WordTiming {
                word_idx: i as u32,
                start_tick: i as i64 * per_word,
                end_tick: (i as i64 + 1) * per_word,
                text: (*w).to_string(),
                confidence: 1.0,
            })
            .collect(),
        confidence: 1.0,
        manual_override: false,
        word_range: None,
    });
    qr_core::save_project_atomic(&project_dir, &mut p).unwrap();
    Fixture {
        resources,
        project_dir,
        verses,
    }
}

/// 50 indeks frame deterministik: 25 frame beruntun pertama (fade-in + awal karaoke) lalu 25 frame
/// tersebar rata sampai akhir segmen, sehingga transisi, sorotan kata, dan keadaan stabil tercakup.
fn sample_frames(total: u64) -> Vec<u64> {
    let mut v: Vec<u64> = (0..25).collect();
    let rest = TICK_COUNT as u64 - 25;
    v.extend((0..rest).map(|k| 25 + k * (total - 25) / rest));
    v
}

fn frame_tick(idx: u64) -> i64 {
    idx as i64 * TICKS_PER_SECOND / FPS as i64
}

struct Preview {
    w: u32,
    h: u32,
    /// Frame RGB24 untuk setiap tick sampel, sesuai `indices` (+ `offset` frame).
    frames: Vec<Vec<u8>>,
}

/// Frame preview: jalur yang sama dengan UI (`SceneBuilder` + `SoftwareRenderer`), kanvas diskalakan
/// persis seperti `run_render_job` (lebar `WIDTH`, tinggi proporsional, genap).
fn render_preview(fx: &Fixture, indices: &[u64], frame_offset: i64) -> Preview {
    let mut project = qr_core::load_project(&fx.project_dir).unwrap();
    let (cw, ch) = (project.canvas.width, project.canvas.height);
    let w = WIDTH & !1;
    let h = (((u64::from(ch) * u64::from(w)) / u64::from(cw)) as u32) & !1;
    project.canvas.width = w;
    project.canvas.height = h;
    let fonts = FontSet::load(&fx.resources.join("assets")).unwrap();
    let tpl = load_builtin_template(&fx.resources, &project.template_id).unwrap();
    let frames = indices
        .iter()
        .map(|&i| {
            let tick = frame_tick((i as i64 + frame_offset) as u64);
            let scene = SceneBuilder::build(&project, &tpl, &fonts, tick, &fx.verses).unwrap();
            let pm = SoftwareRenderer::render(&scene, &fonts).unwrap();
            pm.data()
                .chunks_exact(4)
                .flat_map(|p| [p[0], p[1], p[2]])
                .collect()
        })
        .collect();
    Preview { w, h, frames }
}

struct Export {
    path: PathBuf,
    encoder: String,
    frames: u64,
}

fn export(fx: &Fixture, tag: &str, extra: Value) -> Export {
    let out = std::env::temp_dir().join(format!("qr_equiv_{}_{tag}.mp4", std::process::id()));
    let _ = std::fs::remove_file(&out);
    let mut payload = serde_json::json!({
        "project_dir": fx.project_dir,
        "output_path": out,
        "width": WIDTH,
        "resources_dir": fx.resources,
    });
    payload
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let payload: RenderPayload = serde_json::from_value(payload).unwrap();
    let sum = run_render_job(&payload, &fx.verses, &AtomicBool::new(false), |_, _| {}).unwrap();
    Export {
        path: out,
        encoder: sum.encoder,
        frames: sum.frames,
    }
}

#[derive(Debug)]
struct Metrics {
    min_ssim: f64,
    mean_ssim: f64,
    max_diff_all: u8,
    /// Selisih kanal maksimum hanya di area datar (di luar tepi font/bentuk).
    max_diff_flat: u8,
    flat_px: u64,
    total_px: u64,
}

fn edge_mask(rgb: &[u8], w: usize, h: usize) -> Vec<bool> {
    let y = luma_bt709(rgb, 3);
    let mut edge = vec![false; w * h];
    for py in 0..h {
        for px in 0..w {
            let (mut lo, mut hi) = (255u8, 0u8);
            for yy in py.saturating_sub(2)..(py + 3).min(h) {
                for xx in px.saturating_sub(2)..(px + 3).min(w) {
                    let v = y[yy * w + xx];
                    lo = lo.min(v);
                    hi = hi.max(v);
                }
            }
            edge[py * w + px] = hi - lo > EDGE_LUMA_RANGE;
        }
    }
    edge
}

fn compare(preview: &Preview, decoded: &[Vec<u8>]) -> Metrics {
    let (w, h) = (preview.w as usize, preview.h as usize);
    let mut m = Metrics {
        min_ssim: 1.0,
        mean_ssim: 0.0,
        max_diff_all: 0,
        max_diff_flat: 0,
        flat_px: 0,
        total_px: 0,
    };
    for (p, d) in preview.frames.iter().zip(decoded) {
        let s = ssim_rgb(p, d, w, h, 3).unwrap();
        m.min_ssim = m.min_ssim.min(s);
        m.mean_ssim += s / decoded.len() as f64;
        let edge = edge_mask(p, w, h);
        for (i, (a, b)) in p.chunks_exact(3).zip(d.chunks_exact(3)).enumerate() {
            let diff = a.iter().zip(b).map(|(x, y)| x.abs_diff(*y)).max().unwrap();
            m.max_diff_all = m.max_diff_all.max(diff);
            m.total_px += 1;
            if !edge[i] {
                m.flat_px += 1;
                m.max_diff_flat = m.max_diff_flat.max(diff);
            }
        }
    }
    m
}

fn cleanup(fx: &Fixture, ex: &Export) {
    let _ = std::fs::remove_file(&ex.path);
    let _ = std::fs::remove_dir_all(&fx.project_dir);
}

fn run_case(tag: &str, extra: Value) -> (Fixture, Export, Preview, Vec<Vec<u8>>) {
    let fx = fixture(tag);
    let ex = export(&fx, tag, extra);
    assert_eq!(ex.frames, (SECONDS as u64) * FPS);
    let idx = sample_frames(ex.frames);
    let preview = render_preview(&fx, &idx, 0);
    let decoded = extract_rgb24_frames("ffmpeg", &ex.path, preview.w, preview.h, &idx).unwrap();
    (fx, ex, preview, decoded)
}

fn report(label: &str, ex: &Export, m: &Metrics) {
    println!(
        "[A1-11] {label}: encoder={} SSIM min={:.5} mean={:.5} | selisih kanal maks semua={}/255, \
         area datar={}/255 ({} dari {} px datar)",
        ex.encoder, m.min_ssim, m.mean_ssim, m.max_diff_all, m.max_diff_flat, m.flat_px, m.total_px
    );
}

/// Ekspor lossy (bitrate default 8000 kbps): SSIM tetap harus ≥ 0,995, tetapi selisih kanal di area
/// datar TIDAK bisa dijamin ≤ 2/255 (terukur 6/255 VideoToolbox, 3/255 libx264; kuantisasi DCT).
/// Batas atas ini untuk menangkap regresi, bukan klaim RND-1 untuk kanal.
const LOSSY_FLAT_DIFF_BOUND: u8 = 10;

fn assert_lossy_ok(m: &Metrics) {
    assert!(m.min_ssim >= SSIM_RND1, "SSIM min < {SSIM_RND1}: {m:?}");
    assert!(
        m.max_diff_flat <= LOSSY_FLAT_DIFF_BOUND,
        "selisih kanal area datar > {LOSSY_FLAT_DIFF_BOUND}: {m:?}"
    );
}

#[test]
fn export_default_encoder_meets_rnd1_ssim() {
    let (fx, ex, preview, decoded) = run_case("default", serde_json::json!({}));
    let m = compare(&preview, &decoded);
    report("encoder default", &ex, &m);
    assert_lossy_ok(&m);
    cleanup(&fx, &ex);
}

#[test]
fn export_libx264_default_bitrate_meets_rnd1_ssim() {
    let (fx, ex, preview, decoded) =
        run_case("x264_default", serde_json::json!({"encoder": "libx264"}));
    let m = compare(&preview, &decoded);
    report("libx264 8000 kbps", &ex, &m);
    assert_eq!(ex.encoder, "libx264");
    assert_lossy_ok(&m);
    cleanup(&fx, &ex);
}

/// RND-1 pada ekspor lossless (libx264 `-crf 0`): satu-satunya selisih tersisa adalah subsampling
/// chroma 4:2:0 + pembulatan konversi, jadi ambang 0,995 dan 2/255 di area datar berlaku penuh.
#[test]
fn export_lossless_meets_rnd1_ssim_and_flat_channel_diff() {
    let (fx, ex, preview, decoded) = run_case(
        "lossless",
        serde_json::json!({"encoder": "libx264", "crf": 0}),
    );
    let m = compare(&preview, &decoded);
    report("libx264 crf 0 (lossless)", &ex, &m);
    assert_eq!(ex.encoder, "libx264");
    assert!(
        m.min_ssim >= SSIM_RND1,
        "SSIM min {} < {SSIM_RND1}: {m:?}",
        m.min_ssim
    );
    assert!(
        m.max_diff_flat <= MAX_FLAT_DIFF,
        "selisih kanal area datar {} > {MAX_FLAT_DIFF}: {m:?}",
        m.max_diff_flat
    );
    cleanup(&fx, &ex);
}

/// Mutasi: bandingkan ekspor lossless dengan preview yang diberi geser 1 frame. Uji kesetaraan
/// harus gagal (SSIM turun di bawah 0,995) — membuktikan uji sensitif terhadap divergensi tick.
#[test]
fn equivalence_check_detects_one_frame_tick_offset() {
    let (fx, ex, preview, decoded) = run_case(
        "mutation",
        serde_json::json!({"encoder": "libx264", "crf": 0}),
    );
    let idx = sample_frames(ex.frames);
    let shifted = render_preview(&fx, &idx, 1);
    let ok = compare(&preview, &decoded);
    let bad = compare(&shifted, &decoded);
    report("mutasi geser +1 frame", &ex, &bad);
    assert!(ok.min_ssim >= SSIM_RND1, "{ok:?}");
    assert!(
        bad.min_ssim < SSIM_RND1,
        "geser 1 frame tidak terdeteksi: {bad:?}"
    );
    cleanup(&fx, &ex);
}
