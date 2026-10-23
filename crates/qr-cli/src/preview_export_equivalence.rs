//! A1-11 (PRD RND-1): kesetaraan preview–ekspor. Proyek nyata → `run_render_job` (jalur ekspor
//! produk: RGBA→YUV420 BT.709 di Rust → FFmpeg → MP4) → decode frame (BT.709 TV → RGB) pada 50 tick
//! deterministik → dibandingkan dengan frame preview (`SceneBuilder` + `SoftwareRenderer`) pada tick
//! dan ukuran yang sama. Metrik: SSIM luma 8×8 (lihat `qr_media::ssim`) dan selisih kanal maksimum.
//!
//! Cakupan: (a) satu proyek 1:1 subuh 9:16 pada 3 varian encoder; (b) 13 kombinasi templat × rasio
//! dari 4 templat primer dengan 50 tick acak (xorshift berbenih); (c) video 60 dtk (1:1–1:7 + 2:255
//! dibagi per rentang kata) di encoder default; (d) segmen berrentang kata; (e) audio ter-mux.
//! Seluruh ayat dibaca dari `data/surah/*.json` (tanpa dataset bertanda tangan).

#![allow(clippy::unwrap_used)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::AtomicBool;

use qr_core::project::{AyahSegment, Project, WordTiming};
use qr_media::{extract_rgb24_frames, luma_bt709, ssim_rgb};
use qr_render::{
    load_builtin_template, words_of_ayah, FontSet, SceneBuilder, SoftwareRenderer, VerseContent,
};
use serde_json::Value;

use crate::render_job::{default_resources_dir, run_render_job, RenderPayload};

const TICKS_PER_SECOND: i64 = 48_000;
const FPS: u64 = 30;
const TICK_COUNT: usize = 50;
/// Ambang RND-1 untuk ekspor lossless/near-lossless.
const SSIM_RND1: f64 = 0.995;
/// Selisih kanal maksimum (0..255) di area datar, di luar antialiasing tepi font (RND-1).
const MAX_FLAT_DIFF: u8 = 2;
/// Area "tepi": piksel yang jendela 5×5 luma preview-nya memiliki rentang > nilai ini (antialiasing
/// huruf, tepi bentuk). Jendela 5×5 mencakup blur chroma 4:2:0 (±1 piksel chroma = ±2 piksel luma).
const EDGE_LUMA_RANGE: u8 = 6;
/// Ekspor lossy (bitrate default 8000 kbps): SSIM tetap harus ≥ 0,995, tetapi selisih kanal di area
/// datar TIDAK bisa dijamin ≤ 2/255 (kuantisasi DCT). Batas atas ini untuk menangkap regresi,
/// bukan klaim RND-1 untuk kanal.
const LOSSY_FLAT_DIFF_BOUND: u8 = 10;
/// Lebar kanvas uji utama (tinggi proporsional, genap), sama dengan jalur ekspor.
const WIDTH: u32 = 360;
/// Lebar kecil untuk matriks 13 kombinasi (menguji garis tipis/teks kecil).
const SMALL_WIDTH: u32 = 270;

/// Satu segmen rencana: ayat (opsional rentang kata 1-based inklusif) dan durasinya.
#[derive(Clone)]
struct SegSpec {
    surah: u32,
    ayah: u32,
    range: Option<(u32, u32)>,
    seconds: i64,
}

fn seg(surah: u32, ayah: u32, range: Option<(u32, u32)>, seconds: i64) -> SegSpec {
    SegSpec {
        surah,
        ayah,
        range,
        seconds,
    }
}

#[derive(Clone)]
struct Spec {
    tag: String,
    template: &'static str,
    aspect: &'static str,
    width: u32,
    segs: Vec<SegSpec>,
}

impl Spec {
    fn total_frames(&self) -> u64 {
        self.segs.iter().map(|s| s.seconds as u64).sum::<u64>() * FPS
    }
}

struct Fixture {
    resources: PathBuf,
    project_dir: PathBuf,
    verses: HashMap<(u32, u32), VerseContent>,
    width: u32,
}

fn fixture(spec: &Spec) -> Fixture {
    let resources = default_resources_dir();
    let mut verses = HashMap::new();
    let mut surahs: Vec<u32> = spec.segs.iter().map(|s| s.surah).collect();
    surahs.sort_unstable();
    surahs.dedup();
    for sid in surahs {
        let src: Value = serde_json::from_str(
            &std::fs::read_to_string(resources.join(format!("data/surah/{sid}.json"))).unwrap(),
        )
        .unwrap();
        for a in src["data"].as_array().unwrap() {
            let n = a["aya_number"].as_u64().unwrap() as u32;
            if !spec.segs.iter().any(|s| s.surah == sid && s.ayah == n) {
                continue;
            }
            verses.insert(
                (sid, n),
                VerseContent {
                    ayah_text: a["aya_text"].as_str().unwrap().trim().to_string(),
                    translation: Some(
                        qr_quran::clean_translation(a["translation_aya_text"].as_str().unwrap())
                            .unwrap(),
                    ),
                    surah_name_ar: "الفاتحة".into(),
                    surah_name_latin: format!("Surah {sid}"),
                },
            );
        }
    }
    let project_dir = std::env::temp_dir().join(format!(
        "qr_equiv_{}_{}.qrproj",
        std::process::id(),
        spec.tag
    ));
    let mut p = Project::new("Kesetaraan");
    p.template_id = spec.template.into();
    assert!(p.canvas.set_aspect(spec.aspect), "rasio {}", spec.aspect);
    let mut t0 = 0i64;
    for (i, sg) in spec.segs.iter().enumerate() {
        let verse = verses.get(&(sg.surah, sg.ayah)).unwrap();
        let words: Vec<_> = words_of_ayah(&verse.ayah_text)
            .unwrap()
            .into_iter()
            .filter(|w| {
                sg.range
                    .is_none_or(|(a, b)| w.word_idx >= a && w.word_idx <= b)
            })
            .collect();
        assert!(
            !words.is_empty(),
            "rentang kata kosong: {}:{}",
            sg.surah,
            sg.ayah
        );
        let dur = sg.seconds * TICKS_PER_SECOND;
        let n = words.len() as i64;
        p.segments.push(AyahSegment {
            id: format!("s{i}"),
            surah_id: sg.surah,
            ayah_number: sg.ayah,
            start_tick: t0,
            end_tick: t0 + dur,
            word_timings: words
                .iter()
                .enumerate()
                .map(|(k, w)| WordTiming {
                    word_idx: w.word_idx,
                    start_tick: t0 + k as i64 * dur / n,
                    end_tick: t0 + (k as i64 + 1) * dur / n,
                    text: w.text.clone(),
                    confidence: 1.0,
                })
                .collect(),
            confidence: 1.0,
            manual_override: false,
            word_range: sg.range,
        });
        t0 += dur;
    }
    qr_core::save_project_atomic(&project_dir, &mut p).unwrap();
    Fixture {
        resources,
        project_dir,
        verses,
        width: spec.width,
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

/// xorshift64 berbenih (deterministik lintas platform).
struct XorShift(u64);

impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
}

/// 50 indeks frame unik: tiga frame wajib per segmen (masuk awal `start+1`, di tengah masuk/sorotan
/// `start+6`, keluar `end-2`) lalu sisanya acak berbenih di seluruh video. Urutan tidak disortir.
fn random_frames(spec: &Spec, seed: u64) -> Vec<u64> {
    let total = spec.total_frames();
    let mut v: Vec<u64> = Vec::new();
    let mut start = 0u64;
    for s in &spec.segs {
        let len = s.seconds as u64 * FPS;
        for f in [start + 1, start + 6, start + len - 2] {
            if f < total && !v.contains(&f) {
                v.push(f);
            }
        }
        start += len;
    }
    assert!(v.len() <= TICK_COUNT);
    let mut rng = XorShift(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    while v.len() < TICK_COUNT {
        let f = rng.next() % total;
        if !v.contains(&f) {
            v.push(f);
        }
    }
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
/// persis seperti `run_render_job` (lebar `fx.width`, tinggi proporsional, genap).
fn render_preview(fx: &Fixture, indices: &[u64], frame_offset: i64) -> Preview {
    let mut project = qr_core::load_project(&fx.project_dir).unwrap();
    let (cw, ch) = (project.canvas.width, project.canvas.height);
    let w = fx.width & !1;
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
        "width": fx.width,
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

/// Satu kasus penuh: ekspor `spec`, dekode `idx`, render preview (geser `offset` frame) → metrik.
fn run_spec(spec: &Spec, extra: Value, idx: &[u64], offset: i64) -> (Fixture, Export, Metrics) {
    let fx = fixture(spec);
    let ex = export(&fx, &spec.tag, extra);
    assert_eq!(ex.frames, spec.total_frames());
    let preview = render_preview(&fx, idx, offset);
    let decoded = extract_rgb24_frames("ffmpeg", &ex.path, preview.w, preview.h, idx).unwrap();
    let m = compare(&preview, &decoded);
    (fx, ex, m)
}

fn report(label: &str, ex: &Export, m: &Metrics) {
    println!(
        "[A1-11] {label}: encoder={} SSIM min={:.5} mean={:.5} | selisih kanal maks semua={}/255, \
         area datar={}/255 ({} dari {} px datar)",
        ex.encoder, m.min_ssim, m.mean_ssim, m.max_diff_all, m.max_diff_flat, m.flat_px, m.total_px
    );
}

fn assert_lossy_ok(m: &Metrics) {
    assert!(m.min_ssim >= SSIM_RND1, "SSIM min < {SSIM_RND1}: {m:?}");
    assert!(
        m.max_diff_flat <= LOSSY_FLAT_DIFF_BOUND,
        "selisih kanal area datar > {LOSSY_FLAT_DIFF_BOUND}: {m:?}"
    );
}

/// Batas selisih kanal area datar per templat untuk ekspor lossless. Global = 2/255. Templat
/// `terang` (latar krem terang + garis biru jenuh) terukur 4/255: piksel latar 3 px dari tepi garis
/// biru (97,100,215) pada luma yang kontras memperoleh bleeding chroma 4:2:0 (B 242→239) di luar
/// jendela tepi 5×5 (±2 px), lebih lebar daripada dukungan interpolasi chroma bikubik FFmpeg. Ini
/// batas fisik YCbCr 4:2:0, bukan bug produk (diselidiki: 11–40 piksel per frame, semuanya di tepi
/// garis jenuh). Lihat docs/design/05_VIDEO_TEMPLATES.md §9.
fn flat_bound(template: &str) -> u8 {
    if template == "terang" {
        4
    } else {
        MAX_FLAT_DIFF
    }
}

fn assert_lossless_ok(template: &str, m: &Metrics) {
    assert!(
        m.min_ssim >= SSIM_RND1,
        "SSIM min {} < {SSIM_RND1}: {m:?}",
        m.min_ssim
    );
    let bound = flat_bound(template);
    assert!(
        m.max_diff_flat <= bound,
        "selisih kanal area datar {} > {bound}: {m:?}",
        m.max_diff_flat
    );
}

/// Proyek dasar: Al-Fatihah 1:1, subuh 9:16, 4 dtk, sorotan kata aktif.
fn base_spec(tag: &str) -> Spec {
    Spec {
        tag: tag.into(),
        template: "subuh",
        aspect: "9:16",
        width: WIDTH,
        segs: vec![seg(1, 1, None, 4)],
    }
}

#[test]
fn export_default_encoder_meets_rnd1_ssim() {
    let spec = base_spec("default");
    let (fx, ex, m) = run_spec(&spec, serde_json::json!({}), &sample_frames(120), 0);
    report("encoder default", &ex, &m);
    assert_lossy_ok(&m);
    cleanup(&fx, &ex);
}

#[test]
fn export_libx264_default_bitrate_meets_rnd1_ssim() {
    let spec = base_spec("x264_default");
    let (fx, ex, m) = run_spec(
        &spec,
        serde_json::json!({"encoder": "libx264"}),
        &sample_frames(120),
        0,
    );
    report("libx264 8000 kbps", &ex, &m);
    assert_eq!(ex.encoder, "libx264");
    assert_lossy_ok(&m);
    cleanup(&fx, &ex);
}

/// RND-1 pada ekspor lossless (libx264 `-crf 0`): satu-satunya selisih tersisa adalah subsampling
/// chroma 4:2:0 + pembulatan konversi, jadi ambang 0,995 dan 2/255 di area datar berlaku penuh.
#[test]
fn export_lossless_meets_rnd1_ssim_and_flat_channel_diff() {
    let spec = base_spec("lossless");
    let (fx, ex, m) = run_spec(
        &spec,
        serde_json::json!({"encoder": "libx264", "crf": 0}),
        &sample_frames(120),
        0,
    );
    report("libx264 crf 0 (lossless)", &ex, &m);
    assert_eq!(ex.encoder, "libx264");
    assert_lossless_ok(spec.template, &m);
    cleanup(&fx, &ex);
}

/// Mutasi: bandingkan ekspor lossless dengan preview yang diberi geser 1 frame. Uji kesetaraan
/// harus gagal (SSIM turun di bawah 0,995) — membuktikan uji sensitif terhadap divergensi tick.
#[test]
fn equivalence_check_detects_one_frame_tick_offset() {
    let spec = base_spec("mutation");
    let idx = sample_frames(120);
    let extra = serde_json::json!({"encoder": "libx264", "crf": 0});
    let (fx, ex, ok) = run_spec(&spec, extra, &idx, 0);
    let shifted = render_preview(&fx, &idx, 1);
    let decoded = extract_rgb24_frames("ffmpeg", &ex.path, shifted.w, shifted.h, &idx).unwrap();
    let bad = compare(&shifted, &decoded);
    report("mutasi geser +1 frame", &ex, &bad);
    assert!(ok.min_ssim >= SSIM_RND1, "{ok:?}");
    assert!(
        bad.min_ssim < SSIM_RND1,
        "geser 1 frame tidak terdeteksi: {bad:?}"
    );
    cleanup(&fx, &ex);
}

/// 13 kombinasi templat × rasio yang didukung 4 templat primer (sama dengan manifest golden render).
const COMBOS: [(&str, &str); 13] = [
    ("subuh", "9:16"),
    ("subuh", "16:9"),
    ("subuh", "1:1"),
    ("subuh", "4:5"),
    ("hening", "9:16"),
    ("hening", "16:9"),
    ("hening", "1:1"),
    ("hening", "4:5"),
    ("terang", "9:16"),
    ("terang", "16:9"),
    ("terang", "1:1"),
    ("besar", "9:16"),
    ("besar", "1:1"),
];

/// Kombinasi dalam `COMBOS` harus persis sama dengan kunci manifest golden render.
#[test]
fn combos_match_golden_manifest() {
    let path = default_resources_dir().join("tests/golden/render/manifest.json");
    let m: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut keys: Vec<String> = m.as_object().unwrap().keys().cloned().collect();
    let mut mine: Vec<String> = COMBOS
        .iter()
        .map(|(t, a)| format!("{t}_{}", a.replace(':', "x")))
        .collect();
    keys.sort();
    mine.sort();
    assert_eq!(keys, mine);
}

fn combo_spec(template: &'static str, aspect: &'static str) -> Spec {
    Spec {
        tag: format!("combo_{template}_{}", aspect.replace(':', "x")),
        template,
        aspect,
        width: SMALL_WIDTH,
        // Dua segmen (1:2 dan 1:5, berterjemahan): transisi masuk/keluar di dua batas + sorotan kata.
        segs: vec![seg(1, 2, None, 3), seg(1, 5, None, 3)],
    }
}

/// 50 tick acak berbenih × 13 kombinasi, ekspor lossless (mengisolasi jalur render/warna dari
/// kuantisasi): ambang 0,995 dan ≤ 2/255 area datar (`terang`: 4/255, lihat `flat_bound`). Tabel dicetak sebelum asersi.
#[test]
fn all_13_template_ratio_combos_equivalent_on_random_ticks() {
    let extra = serde_json::json!({"encoder": "libx264", "crf": 0});
    let mut rows = Vec::new();
    let mut failures = Vec::new();
    for (i, (t, a)) in COMBOS.iter().enumerate() {
        let spec = combo_spec(t, a);
        let idx = random_frames(&spec, 1000 + i as u64);
        let (fx, ex, m) = run_spec(&spec, extra.clone(), &idx, 0);
        rows.push(format!(
            "| {t} | {a} | {}x{} | {:.5} | {:.5} | {} | {} |",
            fx.width,
            render_preview_height(&fx),
            m.min_ssim,
            m.mean_ssim,
            m.max_diff_all,
            m.max_diff_flat
        ));
        if m.min_ssim < SSIM_RND1 || m.max_diff_flat > flat_bound(t) {
            failures.push(format!("{t} {a}: {m:?}"));
        }
        cleanup(&fx, &ex);
    }
    println!("[A1-11] 13 kombinasi, libx264 crf 0, 50 tick acak, lebar {SMALL_WIDTH}");
    println!("| templat | rasio | ukuran | SSIM min | SSIM rata-rata | selisih maks semua | selisih maks datar |");
    println!("|---|---|---|---|---|---|---|");
    for r in &rows {
        println!("{r}");
    }
    assert!(failures.is_empty(), "kombinasi gagal: {failures:#?}");
}

fn render_preview_height(fx: &Fixture) -> u32 {
    let p = qr_core::load_project(&fx.project_dir).unwrap();
    (((u64::from(p.canvas.height) * u64::from(fx.width & !1)) / u64::from(p.canvas.width)) as u32)
        & !1
}

/// Mutasi pada harness acak: tick preview digeser +1 frame untuk satu kombinasi harus ditolak
/// ambang yang sama dengan matriks 13 kombinasi.
#[test]
fn random_tick_harness_detects_one_frame_offset() {
    let mut spec = combo_spec("subuh", "9:16");
    spec.tag = "combo_mutation".into();
    let idx = random_frames(&spec, 1000);
    let extra = serde_json::json!({"encoder": "libx264", "crf": 0});
    let (fx, ex, ok) = run_spec(&spec, extra, &idx, 0);
    let shifted = render_preview(&fx, &idx, 1);
    let decoded = extract_rgb24_frames("ffmpeg", &ex.path, shifted.w, shifted.h, &idx).unwrap();
    let bad = compare(&shifted, &decoded);
    report("mutasi acak +1 frame", &ex, &bad);
    assert!(ok.min_ssim >= SSIM_RND1, "{ok:?}");
    assert!(bad.min_ssim < SSIM_RND1, "geser tidak terdeteksi: {bad:?}");
    cleanup(&fx, &ex);
}

/// Rencana 60 dtk: 1:1..1:7 (7 × 4 dtk) + 2:255 dibagi 4 rentang kata (4 × 8 dtk). 2:255 memiliki
/// 51 kata; rentang bertanda 1-based inklusif tanpa tumpang tindih.
fn long_spec(tag: &str) -> Spec {
    let mut segs: Vec<SegSpec> = (1..=7).map(|a| seg(1, a, None, 4)).collect();
    for r in [(1, 13), (14, 26), (27, 39), (40, 51)] {
        segs.push(seg(2, 255, Some(r), 8));
    }
    Spec {
        tag: tag.into(),
        template: "subuh",
        aspect: "9:16",
        width: WIDTH,
        segs,
    }
}

/// Video 60 dtk, 50 tick acak, encoder default (hardware bila ada), 360 px.
#[test]
fn long_60s_video_default_encoder_equivalent_on_random_ticks() {
    let spec = long_spec("long60");
    assert_eq!(spec.total_frames(), 60 * FPS);
    let idx = random_frames(&spec, 60);
    let (fx, ex, m) = run_spec(&spec, serde_json::json!({}), &idx, 0);
    report("60 dtk, encoder default, 50 tick acak", &ex, &m);
    assert_lossy_ok(&m);
    cleanup(&fx, &ex);
}

/// Segmen terbagi per rentang kata (2:255 → 3 potongan) tanpa terjemahan, lossless: sorotan kata
/// hanya pada kata dalam rentang dan transisi di tiap batas potongan harus setara.
#[test]
fn word_range_split_segments_equivalent_lossless() {
    let spec = Spec {
        tag: "wordrange".into(),
        template: "hening",
        aspect: "16:9",
        width: SMALL_WIDTH * 2,
        segs: vec![
            seg(2, 255, Some((1, 17)), 3),
            seg(2, 255, Some((18, 34)), 3),
            seg(2, 255, Some((35, 51)), 3),
        ],
    };
    let idx = random_frames(&spec, 7);
    let extra = serde_json::json!({"encoder": "libx264", "crf": 0});
    let (fx, ex, m) = run_spec(&spec, extra, &idx, 0);
    report("rentang kata 2:255 x3", &ex, &m);
    assert_lossless_ok(spec.template, &m);
    cleanup(&fx, &ex);
}

fn ffprobe(args: &[&str], file: &std::path::Path) -> String {
    let out = Command::new("ffprobe")
        .args(["-v", "error"])
        .args(args)
        .arg(file)
        .output()
        .unwrap();
    assert!(out.status.success(), "ffprobe gagal");
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

/// Ekspor dengan audio ter-mux: video tetap setara dengan preview, dan MP4 memuat satu aliran audio
/// AAC dengan durasi ≈ durasi video (audio uji sengaja 1 dtk lebih panjang daripada video).
#[test]
fn export_with_audio_is_equivalent_and_has_audio_stream() {
    let spec = Spec {
        tag: "audio".into(),
        template: "terang",
        aspect: "1:1",
        width: SMALL_WIDTH,
        segs: vec![seg(1, 2, None, 3), seg(1, 3, None, 3)],
    };
    let audio = std::env::temp_dir().join(format!("qr_equiv_{}_audio.wav", std::process::id()));
    let gen = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
        ])
        .arg("sine=frequency=440:sample_rate=48000:duration=7")
        .arg(&audio)
        .status()
        .unwrap();
    assert!(gen.success(), "pembuatan audio uji gagal");
    let idx = random_frames(&spec, 11);
    let extra = serde_json::json!({"encoder": "libx264", "crf": 0, "audio_path": audio});
    let (fx, ex, m) = run_spec(&spec, extra, &idx, 0);
    report("audio ter-mux", &ex, &m);
    assert_lossless_ok(spec.template, &m);
    let codec = ffprobe(
        &[
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "csv=p=0",
        ],
        &ex.path,
    );
    assert_eq!(codec, "aac", "aliran audio tidak ada/bukan AAC");
    let dur_of = |sel: &str| -> f64 {
        ffprobe(
            &[
                "-select_streams",
                sel,
                "-show_entries",
                "stream=duration",
                "-of",
                "csv=p=0",
            ],
            &ex.path,
        )
        .parse()
        .unwrap()
    };
    let (dv, da) = (dur_of("v"), dur_of("a"));
    println!("[A1-11] durasi video={dv:.3}s audio={da:.3}s");
    assert!((dv - 6.0).abs() < 0.05, "durasi video {dv}");
    assert!(
        (da - dv).abs() < 0.25,
        "audio {da}s tidak mengikuti video {dv}s"
    );
    let _ = std::fs::remove_file(&audio);
    cleanup(&fx, &ex);
}
