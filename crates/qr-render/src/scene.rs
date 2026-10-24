//! Pembangun scene deterministik dan perender CPU (tiny-skia) untuk preview dan ekspor.
//! Mengacu ke docs/design/05_VIDEO_TEMPLATES.md §2–§6 dan PRD RND-1, RND-2, STY-1..4, STY-8.
//!
//! Scene dibangun dari `Project` + `TemplateDoc` + tick + teks ayat nyata (`VerseSource`). Tidak ada
//! teks bawaan untuk ayat: bila teks ayat segmen aktif tidak tersedia, pembangunan scene gagal.
//! Pengecualian: segmen khusus — basmalah memakai teks Arab 1:1 dataset, isti'adzah memakai
//! [`crate::translation::ISTIADHA_AR`] (bukan ayat). Keduanya tanpa label surah/ayat.
//! Terjemahan mengikuti `Project::translation_editions` lewat
//! [`crate::translation::resolve_segment_translations`].

use crate::anim::{ease, template_transition_alpha, HighlightStyle};
use crate::template::{Layer, LayerKind, TemplateDoc};
use crate::text::{
    fit_text, layout_words, paint_layout, words_of_ayah, FontFace, InputWord, TextDirection,
    TextLayout,
};
use crate::translation::{resolve_segment_translations, ISTIADHA_AR};
use qr_core::project::{AyahSegment, Project, SegmentKind};
use qr_core::style::resolve;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;
use tiny_skia::{
    Color, FillRule, Paint, PathBuilder, Pixmap, PixmapPaint, Rect, Stroke, Transform,
};

#[derive(Error, Debug)]
pub enum RenderError {
    #[error("Template tidak valid: {0}")]
    InvalidTemplate(String),
    #[error("Gagal merasterisasi scene: {0}")]
    Rasterization(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Font bermasalah: {0}")]
    Font(String),
    #[error("Shaping/tata letak gagal: {0}")]
    Shaping(String),
    #[error("Teks ayat {surah}:{ayah} tidak tersedia untuk dirender")]
    MissingVerse { surah: u32, ayah: u32 },
}

/// Font yang dibutuhkan renderer, dimuat dari folder `assets/fonts`.
#[derive(Debug)]
pub struct FontSet {
    pub lpmq: FontFace,
    pub amiri: FontFace,
    pub inter: FontFace,
}

impl FontSet {
    /// `assets_dir` = folder `assets/` repositori (atau resource bundle aplikasi).
    pub fn load(assets_dir: &Path) -> Result<Self, RenderError> {
        Ok(Self {
            lpmq: FontFace::from_file("LPMQ", &assets_dir.join("fonts/quran/LPMQ.ttf"))?,
            amiri: FontFace::from_file("Amiri", &assets_dir.join("fonts/quran/Amiri-Regular.ttf"))?,
            inter: FontFace::from_file("Inter", &assets_dir.join("fonts/ui/Inter-Variable.ttf"))?,
        })
    }

    pub fn family(&self, name: &str) -> Result<&FontFace, RenderError> {
        match name {
            "LPMQ" => Ok(&self.lpmq),
            "Amiri" => Ok(&self.amiri),
            "Inter" => Ok(&self.inter),
            other => Err(RenderError::Font(format!(
                "Keluarga font '{other}' tidak dikenal"
            ))),
        }
    }

    pub fn available_families(&self) -> HashSet<String> {
        ["LPMQ", "Amiri", "Inter"]
            .iter()
            .map(|s| (*s).to_string())
            .collect()
    }
}

/// Konten satu ayat yang akan ditampilkan (diambil dari `quran.db`, tidak pernah diketik ulang).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VerseContent {
    pub ayah_text: String,
    /// Terjemahan ayat utuh yang dibawa langsung oleh sumber (kunci edisi → teks bersih). Sumber
    /// berbasis database membiarkannya kosong dan menjawab lewat [`VerseSource::translation`].
    pub translations: BTreeMap<String, String>,
    pub surah_name_ar: String,
    pub surah_name_latin: String,
}

pub trait VerseSource {
    fn verse(&self, surah: u32, ayah: u32) -> Option<VerseContent>;

    /// Terjemahan bersih ayat utuh untuk `edition_key`; `None` bila edisi/ayat tidak tersedia.
    fn translation(&self, edition_key: &str, surah: u32, ayah: u32) -> Option<String> {
        self.verse(surah, ayah)?.translations.remove(edition_key)
    }
}

impl VerseSource for HashMap<(u32, u32), VerseContent> {
    fn verse(&self, surah: u32, ayah: u32) -> Option<VerseContent> {
        self.get(&(surah, ayah)).cloned()
    }

    fn translation(&self, edition_key: &str, surah: u32, ayah: u32) -> Option<String> {
        self.get(&(surah, ayah))?
            .translations
            .get(edition_key)
            .cloned()
    }
}

/// Sumber ayat dari `quran.db` terverifikasi (`qr-quran`). Terjemahan dari edisi dataset maupun edisi
/// unduhan (`content.db` yang sudah di-attach, lihat `QuranDatabase::attach_installed_translations`).
#[derive(Debug)]
pub struct QuranDbVerses<'a> {
    pub db: &'a qr_quran::QuranDatabase,
}

impl VerseSource for QuranDbVerses<'_> {
    fn verse(&self, surah: u32, ayah: u32) -> Option<VerseContent> {
        let a = self.db.get_ayah_by_surah(surah, ayah).ok()?;
        let s = self.db.get_surah(surah).ok()?;
        Some(VerseContent {
            ayah_text: a.text,
            translations: BTreeMap::new(),
            surah_name_ar: s.name_ar,
            surah_name_latin: s.name_latin,
        })
    }

    fn translation(&self, edition_key: &str, surah: u32, ayah: u32) -> Option<String> {
        self.db
            .verse_translation(edition_key, surah, ayah)
            .ok()
            .flatten()
    }
}

/// Teks yang ditampilkan untuk satu segmen: teks Arab (verbatim dari sumber) + terjemahan ayat utuh
/// per edisi proyek. Segmen khusus mendapat teks Arab khususnya dan nama surah kosong.
/// `None` bila teks Arab tidak tersedia (ayat tidak ada di dataset).
pub fn segment_content(
    seg: &AyahSegment,
    editions: &[String],
    verses: &dyn VerseSource,
) -> Option<VerseContent> {
    match seg.kind {
        SegmentKind::Ayah => {
            let mut c = verses.verse(seg.surah_id, seg.ayah_number)?;
            c.translations = editions
                .iter()
                .filter_map(|k| {
                    verses
                        .translation(k, seg.surah_id, seg.ayah_number)
                        .map(|t| (k.clone(), t))
                })
                .collect();
            Some(c)
        }
        SegmentKind::Basmala => Some(VerseContent {
            ayah_text: verses.verse(1, 1)?.ayah_text,
            ..VerseContent::default()
        }),
        SegmentKind::Istiadha => Some(VerseContent {
            ayah_text: ISTIADHA_AR.to_string(),
            ..VerseContent::default()
        }),
    }
}

/// Primitif gambar bernormalisasi piksel yang dihasilkan scene builder.
#[derive(Debug, Clone)]
pub enum Primitive {
    /// Gambar/frame latar yang sudah di-cover-fit ke ukuran kanvas, digambar penuh dari (0,0).
    Image {
        pixmap: Arc<Pixmap>,
    },
    Fill {
        rgba: [u8; 4],
    },
    DimmerVertical {
        rgb: [u8; 3],
        alpha_top: f32,
        alpha_bottom: f32,
    },
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        fill: [u8; 4],
        stroke: Option<([u8; 4], f32)>,
    },
    Text(TextPrimitive),
}

#[derive(Debug, Clone)]
pub struct TextPrimitive {
    pub family: String,
    pub layout: TextLayout,
    pub x: f32,
    pub y: f32,
    pub rgb: [u8; 3],
    pub alpha: f32,
    /// Alpha tambahan per kata (karaoke terang bertahap). Kata yang tidak terdaftar = 1.0.
    pub word_alpha: HashMap<u32, f32>,
    pub highlight: Option<Highlight>,
}

#[derive(Debug, Clone)]
pub struct Highlight {
    pub style: HighlightStyle,
    pub word_idx: u32,
    /// Progres 0..1 sepanjang rentang kata (untuk garis bawah).
    pub span_progress: f32,
    pub rgba: [u8; 4],
}

#[derive(Debug, Clone)]
pub struct RenderScene {
    pub width: u32,
    pub height: u32,
    pub primitives: Vec<Primitive>,
    pub active_segment_id: Option<String>,
    /// Teks ayat yang digambar (verbatim dari sumber), untuk inspeksi dan uji.
    pub ayah_text: Option<String>,
    pub ayah_fit_iterations: u8,
    /// `true` bila teks ayat tetap melebihi area aman pada ukuran minimum auto-fit (65%).
    /// Pemanggil (validator pra-ekspor) wajib menolak atau meminta segmen dibagi per rentang kata.
    pub text_overflow: bool,
    /// Terjemahan yang digambar (urut edisi proyek), untuk inspeksi dan uji.
    pub translations: Vec<String>,
}

/// Menguraikan warna `#RRGGBB`, `#RRGGBBAA`, atau `rgba(r, g, b, a)`.
pub fn parse_color(s: &str) -> Option<[u8; 4]> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        let b = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
        return match hex.len() {
            6 => Some([b(0)?, b(2)?, b(4)?, 255]),
            8 => Some([b(0)?, b(2)?, b(4)?, b(6)?]),
            _ => None,
        };
    }
    let inner = s.strip_prefix("rgba(")?.strip_suffix(')')?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() != 4 {
        return None;
    }
    let a: f32 = parts[3].parse().ok()?;
    Some([
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
        (a.clamp(0.0, 1.0) * 255.0).round() as u8,
    ])
}

#[derive(Clone, Copy)]
struct Px {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

struct Ctx<'a> {
    project: &'a Project,
    seg_id: Option<&'a str>,
    cw: f32,
    ch: f32,
}

impl Ctx<'_> {
    fn value(&self, layer: &Layer, key: &str) -> Option<Value> {
        resolve(
            self.project,
            self.seg_id,
            &layer.id,
            key,
            layer.properties.get(key),
        )
        .0
    }
    fn f(&self, layer: &Layer, key: &str, default: f32) -> f32 {
        self.value(layer, key)
            .and_then(|v| v.as_f64())
            .map_or(default, |v| v as f32)
    }
    fn s(&self, layer: &Layer, key: &str) -> Option<String> {
        self.value(layer, key)
            .and_then(|v| v.as_str().map(str::to_string))
    }
    fn color(&self, layer: &Layer, key: &str, default: [u8; 4]) -> [u8; 4] {
        self.s(layer, key)
            .and_then(|c| parse_color(&c))
            .unwrap_or(default)
    }
    fn visible(&self, layer: &Layer) -> bool {
        self.value(layer, "visible")
            .and_then(|v| v.as_bool())
            .unwrap_or(layer.visible)
    }
    fn box_px(&self, layer: &Layer) -> Option<Px> {
        let b = layer.properties.get("box")?;
        let g = |k: &str| b.get(k).and_then(Value::as_f64).map(|v| v as f32);
        Some(Px {
            x: g("x")? * self.cw,
            y: g("y")? * self.ch,
            w: g("w")? * self.cw,
            h: g("h")? * self.ch,
        })
    }
}

fn split_plain_words(text: &str) -> Vec<InputWord> {
    text.split_whitespace()
        .enumerate()
        .map(|(i, w)| InputWord {
            word_idx: (i + 1) as u32,
            text: w.to_string(),
        })
        .collect()
}

#[derive(Debug)]
pub struct SceneBuilder;

impl SceneBuilder {
    /// Membangun scene pada `tick` (48 kHz). Mengembalikan scene tanpa teks bila tidak ada segmen
    /// aktif; gagal bila segmen aktif tidak punya teks ayat (tidak ada nilai pengganti).
    pub fn build(
        project: &Project,
        template: &TemplateDoc,
        fonts: &FontSet,
        tick: i64,
        verses: &dyn VerseSource,
    ) -> Result<RenderScene, RenderError> {
        Self::build_with_background(project, template, fonts, tick, verses, None)
    }

    /// Seperti [`SceneBuilder::build`], dengan latar media. `background` harus berukuran persis kanvas
    /// proyek (cover-fit dilakukan pemanggil, lihat `qr-media::background`); `None` = latar warna.
    /// Dengan latar media, dimmer efektif = `style_overrides["background_dimmer"]` (0..1, kosong = 0);
    /// dimmer milik template hanya berlaku tanpa latar media.
    pub fn build_with_background(
        project: &Project,
        template: &TemplateDoc,
        fonts: &FontSet,
        tick: i64,
        verses: &dyn VerseSource,
        background: Option<&Arc<Pixmap>>,
    ) -> Result<RenderScene, RenderError> {
        if let Some(bg) = background {
            if bg.width() != project.canvas.width || bg.height() != project.canvas.height {
                return Err(RenderError::Rasterization(format!(
                    "Ukuran latar {}x{} berbeda dari kanvas {}x{}",
                    bg.width(),
                    bg.height(),
                    project.canvas.width,
                    project.canvas.height
                )));
            }
        }
        let ratio = project.canvas.aspect_ratio.as_str();
        if !template.supported_ratios.iter().any(|r| r == ratio) {
            return Err(RenderError::InvalidTemplate(format!(
                "Template '{}' tidak mendukung rasio {ratio}",
                template.id
            )));
        }
        let (width, height) = (project.canvas.width, project.canvas.height);
        let (cw, ch) = (width as f32, height as f32);
        let sa = template.safe_area_for(ratio)?;
        let safe = Px {
            x: sa.left * cw,
            y: sa.top * ch,
            w: cw * (1.0 - sa.left - sa.right),
            h: ch * (1.0 - sa.top - sa.bottom),
        };

        let seg: Option<&AyahSegment> = project
            .segments
            .iter()
            .find(|s| tick >= s.start_tick && tick < s.end_tick);
        let ctx = Ctx {
            project,
            seg_id: seg.map(|s| s.id.as_str()),
            cw,
            ch,
        };
        let content = match seg {
            Some(s) => Some(
                segment_content(s, &project.translation_editions, verses).ok_or(
                    RenderError::MissingVerse {
                        surah: s.surah_id,
                        ayah: s.ayah_number,
                    },
                )?,
            ),
            None => None,
        };
        let mut translations_out: Vec<String> = Vec::new();

        // Transisi masuk/keluar (doc 05 §5.1).
        let anim = &template.animations;
        let (alpha, slide_dy, scale) = match seg {
            Some(s) => {
                let a = template_transition_alpha(
                    tick,
                    s.start_tick,
                    s.end_tick,
                    anim.transition_in.duration_ticks,
                    &anim.transition_in.easing,
                    anim.transition_out.duration_ticks,
                    &anim.transition_out.easing,
                );
                let p_in = if anim.transition_in.duration_ticks > 0 {
                    ease(
                        &anim.transition_in.easing,
                        (tick - s.start_tick) as f32 / anim.transition_in.duration_ticks as f32,
                    )
                } else {
                    1.0
                };
                let dy = if anim.transition_in.kind == "slide_up" {
                    0.03 * ch * (1.0 - p_in)
                } else {
                    0.0
                };
                let sc = if anim.transition_in.kind == "scale" {
                    0.96 + 0.04 * p_in
                } else {
                    1.0
                };
                (a, dy, sc)
            }
            None => (0.0, 0.0, 1.0),
        };

        let mut prims: Vec<Primitive> = Vec::new();
        let mut ayah_text_out = None;
        let mut fit_iter = 0u8;
        let mut text_overflow = false;

        // Tata letak blok teks (ayat, terjemahan, referensi) dihitung sekali karena saling bergantung.
        let ayah_layer = template.layer(LayerKind::AyahText);
        let tr_layer = template.layer(LayerKind::TranslationText);
        let ref_layer = template.layer(LayerKind::ReferenceBadge);

        struct Block {
            layout: TextLayout,
            x: f32,
            y: f32,
        }
        let mut ayah_block: Option<Block> = None;
        let mut tr_block: Option<Block> = None;
        let mut ref_block: Option<(Block, String)> = None;

        if let (Some(c), Some(sg)) = (&content, seg) {
            let al = ayah_layer
                .ok_or_else(|| RenderError::InvalidTemplate("layer ayah_text hilang".into()))?;
            let ayah_face =
                fonts.family(&ctx.s(al, "font_family").unwrap_or_else(|| "LPMQ".into()))?;
            let size_scale = ctx.f(al, "font_size_scale", 1.0) * scale;
            let ayah_px = ctx.f(al, "font_size_cw", 0.092) * cw * size_scale;
            let lh = ctx.f(al, "line_height_multiplier", 1.95);
            let abox = ctx.box_px(al);
            let area = abox.unwrap_or(safe);
            let max_w = (ctx.f(al, "max_width_cw", 0.80) * cw).min(area.w);
            let all_words = words_of_ayah(&c.ayah_text)?;
            // Segmen khusus selalu tampil utuh (rentang kata hanya berlaku untuk ayat).
            let range = match sg.kind {
                SegmentKind::Ayah => sg.word_range,
                SegmentKind::Basmala | SegmentKind::Istiadha => None,
            };
            let words: Vec<InputWord> = match range {
                Some((a, b)) => all_words
                    .into_iter()
                    .filter(|w| w.word_idx >= a && w.word_idx <= b)
                    .collect(),
                None => all_words,
            };
            if words.is_empty() {
                return Err(RenderError::Shaping(format!(
                    "Rentang kata segmen {} kosong atau di luar ayat {}:{}",
                    sg.id, sg.surah_id, sg.ayah_number
                )));
            }

            // Terjemahan lebih dulu: tingginya menentukan ruang yang tersisa untuk ayat. Tiap edisi
            // proyek ditata sebagai paragraf sendiri (urut edisi, yang utama di atas) dengan parameter
            // yang sama, lalu baris-barisnya disusun menjadi satu blok.
            let mut tr_h = 0.0f32;
            let mut tr_margin = 0.0f32;
            let mut tr_layout: Option<(TextLayout, Option<Px>)> = None;
            let resolved =
                resolve_segment_translations(sg, &project.translation_editions, &c.translations);
            if let Some(tl) = tr_layer.filter(|tl| ctx.visible(tl) && !resolved.is_empty()) {
                let tface =
                    fonts.family(&ctx.s(tl, "font_family").unwrap_or_else(|| "Inter".into()))?;
                let tbox = ctx.box_px(tl);
                let tmax = (ctx.f(tl, "max_width_cw", 0.76) * cw).min(tbox.map_or(safe.w, |b| b.w));
                let tpx = ctx.f(tl, "font_size_cw", 0.040)
                    * cw
                    * ctx.f(tl, "font_size_scale", 1.0)
                    * scale;
                let tlh = ctx.f(tl, "line_height_multiplier", 1.45);
                let mut block: Option<TextLayout> = None;
                for r in &resolved {
                    let l = layout_words(
                        tface,
                        &split_plain_words(&r.text),
                        TextDirection::LatinLtr,
                        tpx,
                        tmax,
                        tlh,
                    )?;
                    block = Some(match block {
                        None => l,
                        Some(mut acc) => {
                            acc.lines.extend(l.lines);
                            acc.height_px += l.height_px;
                            acc
                        }
                    });
                    translations_out.push(r.text.clone());
                }
                if let Some(l) = block {
                    if tbox.is_none() {
                        tr_h = l.height_px;
                        tr_margin = ctx.f(tl, "margin_top_ch", 0.025) * ch;
                    }
                    tr_layout = Some((l, tbox));
                }
            }
            let mut ref_layout: Option<(TextLayout, String)> = None;
            let mut ref_h = 0.0f32;
            let mut ref_margin = 0.0f32;
            if let Some(rl) = ref_layer.filter(|_| sg.kind == SegmentKind::Ayah) {
                if ctx.visible(rl) {
                    let text = format!("{} : {}", c.surah_name_latin, sg.ayah_number);
                    let rface = fonts
                        .family(&ctx.s(rl, "font_family").unwrap_or_else(|| "Inter".into()))?;
                    let rpx = ctx.f(rl, "font_size_cw", 0.032) * cw * scale;
                    let l = layout_words(
                        rface,
                        &split_plain_words(&text),
                        TextDirection::LatinLtr,
                        rpx,
                        safe.w,
                        1.3,
                    )?;
                    ref_h = l.height_px;
                    ref_margin = ctx.f(rl, "margin_top_ch", 0.018) * ch;
                    ref_layout = Some((l, text));
                }
            }

            let reserve = if abox.is_some() {
                0.0
            } else {
                tr_h + if tr_h > 0.0 { tr_margin } else { 0.0 }
                    + ref_h
                    + if ref_h > 0.0 { ref_margin } else { 0.0 }
            };
            let max_h = (area.h - reserve).max(area.h * 0.3);
            let layout = fit_text(
                ayah_face,
                &words,
                TextDirection::ArabicRtl,
                ayah_px,
                max_w,
                max_h,
                lh,
            )?;
            fit_iter = layout.fit_iterations;
            text_overflow = layout.height_px > max_h + 0.5;

            let ax = area.x + (area.w - max_w) / 2.0;
            let (ay, mut cursor);
            if abox.is_some() {
                ay = area.y + (area.h - layout.height_px) / 2.0;
                cursor = ay + layout.height_px;
            } else {
                let total = layout.height_px + reserve;
                ay = area.y + ((area.h - total) / 2.0).max(0.0);
                cursor = ay + layout.height_px;
            }
            let ay = ay + slide_dy;
            cursor += slide_dy;
            ayah_block = Some(Block {
                layout,
                x: ax,
                y: ay,
            });

            if let Some((l, tbox)) = tr_layout {
                let (tx, ty) = match tbox {
                    Some(b) => {
                        let m = (ctx.f(
                            tr_layer.ok_or_else(|| {
                                RenderError::InvalidTemplate("translation".into())
                            })?,
                            "max_width_cw",
                            0.76,
                        ) * cw)
                            .min(b.w);
                        (
                            b.x + (b.w - m) / 2.0,
                            b.y + (b.h - l.height_px) / 2.0 + slide_dy,
                        )
                    }
                    None => {
                        let m = (ctx.f(
                            tr_layer.ok_or_else(|| {
                                RenderError::InvalidTemplate("translation".into())
                            })?,
                            "max_width_cw",
                            0.76,
                        ) * cw)
                            .min(safe.w);
                        let y = cursor + tr_margin;
                        cursor = y + l.height_px;
                        (safe.x + (safe.w - m) / 2.0, y)
                    }
                };
                tr_block = Some(Block {
                    layout: l,
                    x: tx,
                    y: ty,
                });
            }
            if let Some((l, text)) = ref_layout {
                let y = cursor + ref_margin;
                ref_block = Some((
                    Block {
                        layout: l,
                        x: safe.x,
                        y,
                    },
                    text,
                ));
            }
            // Tumpukan ayat + terjemahan + referensi (tanpa kotak) harus muat di area aman; bila tidak,
            // yang terpotong layar bisa saja terjemahan, bukan ayat. Offset animasi geser dikeluarkan.
            if abox.is_none() {
                let top = ay - slide_dy;
                let bottom = ref_block
                    .as_ref()
                    .map_or(cursor, |(b, _)| b.y + b.layout.height_px)
                    - slide_dy;
                if top < safe.y - 0.5 || bottom > safe.y + safe.h + 0.5 {
                    text_overflow = true;
                }
            }
            ayah_text_out = Some(match range {
                None => c.ayah_text.clone(),
                Some(_) => words
                    .iter()
                    .map(|w| w.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            });
        }

        // Emisi primitif mengikuti urutan layer (urutan gambar = urutan di template.json).
        for layer in &template.layers {
            if !ctx.visible(layer) {
                continue;
            }
            match layer.kind {
                LayerKind::Background => {
                    let base = ctx.color(layer, "default_color", [16, 17, 20, 255]);
                    prims.push(Primitive::Fill { rgba: base });
                    let dim = match background {
                        Some(bg) => {
                            prims.push(Primitive::Image {
                                pixmap: Arc::clone(bg),
                            });
                            project.background_dimmer().map_or(0.0, |v| v as f32)
                        }
                        None => ctx.f(layer, "dimmer_opacity", 0.0).clamp(0.0, 1.0),
                    };
                    if dim > 0.0 {
                        let dc = ctx.color(layer, "dimmer_color", [0, 0, 0, 255]);
                        match ctx.s(layer, "dimmer_type").as_deref() {
                            Some("linear_gradient_vertical") => {
                                prims.push(Primitive::DimmerVertical {
                                    rgb: [dc[0], dc[1], dc[2]],
                                    alpha_top: dim * 0.40,
                                    alpha_bottom: dim,
                                })
                            }
                            _ => prims.push(Primitive::Rect {
                                x: 0.0,
                                y: 0.0,
                                w: cw,
                                h: ch,
                                radius: 0.0,
                                fill: [dc[0], dc[1], dc[2], (dim * 255.0).round() as u8],
                                stroke: None,
                            }),
                        }
                    }
                }
                LayerKind::ShapeRect => {
                    let stroke_w = ctx.f(layer, "stroke_width_cw", 0.0) * cw;
                    let stroke_c = ctx.color(layer, "stroke", [0, 0, 0, 0]);
                    prims.push(Primitive::Rect {
                        x: ctx.f(layer, "x", 0.0) * cw,
                        y: ctx.f(layer, "y", 0.0) * ch,
                        w: ctx.f(layer, "w", 1.0) * cw,
                        h: ctx.f(layer, "h", 1.0) * ch,
                        radius: ctx.f(layer, "radius_cw", 0.0) * cw,
                        fill: ctx.color(layer, "fill", [0, 0, 0, 0]),
                        stroke: (stroke_w > 0.0 && stroke_c[3] > 0).then_some((stroke_c, stroke_w)),
                    });
                }
                LayerKind::SurahTitle => {
                    if let Some(c) = content.as_ref().filter(|c| !c.surah_name_ar.is_empty()) {
                        let face = fonts.family(
                            &ctx.s(layer, "font_family")
                                .unwrap_or_else(|| "Amiri".into()),
                        )?;
                        let px = ctx.f(layer, "font_size_cw", 0.065) * cw * scale;
                        let b = ctx.box_px(layer);
                        let maxw = b.map_or(safe.w, |b| b.w);
                        let l = layout_words(
                            face,
                            &words_of_ayah(&c.surah_name_ar)?,
                            TextDirection::ArabicRtl,
                            px,
                            maxw,
                            1.4,
                        )?;
                        let off = ctx.f(layer, "offset_y_ch", 0.155) * ch;
                        let (x, y) = match b {
                            Some(b) => (b.x, b.y + (b.h - l.height_px) / 2.0),
                            None => (safe.x + (safe.w - maxw) / 2.0, off - l.height_px / 2.0),
                        };
                        let col = ctx.color(layer, "text_color", [244, 245, 247, 255]);
                        prims.push(Primitive::Text(TextPrimitive {
                            family: face.name().to_string(),
                            layout: l,
                            x,
                            y,
                            rgb: [col[0], col[1], col[2]],
                            alpha: alpha * f32::from(col[3]) / 255.0,
                            word_alpha: HashMap::new(),
                            highlight: None,
                        }));
                    }
                }
                LayerKind::AyahText => {
                    if let (Some(b), Some(sg)) = (ayah_block.take(), seg) {
                        let col = ctx.color(layer, "text_color", [244, 245, 247, 255]);
                        let style = ctx
                            .s(layer, "highlight_style")
                            .and_then(|s| HighlightStyle::parse(&s))
                            .unwrap_or(HighlightStyle::SmoothFade);
                        let inactive = ctx
                            .f(layer, "highlight_inactive_opacity", 0.70)
                            .clamp(0.0, 1.0);
                        let (word_alpha, highlight) = karaoke(
                            sg,
                            tick,
                            anim.karaoke.transition_duration_ticks,
                            &anim.karaoke.easing,
                            style,
                            inactive,
                            ctx.color(layer, "highlight_active_color", [255, 255, 255, 255]),
                            ctx.color(layer, "highlight_underline_color", col),
                        );
                        prims.push(Primitive::Text(TextPrimitive {
                            family: ctx.s(layer, "font_family").unwrap_or_else(|| "LPMQ".into()),
                            layout: b.layout,
                            x: b.x,
                            y: b.y,
                            rgb: [col[0], col[1], col[2]],
                            alpha: alpha * f32::from(col[3]) / 255.0,
                            word_alpha,
                            highlight,
                        }));
                    }
                }
                LayerKind::TranslationText => {
                    if let Some(b) = tr_block.take() {
                        let col = ctx.color(layer, "text_color", [229, 231, 235, 255]);
                        prims.push(Primitive::Text(TextPrimitive {
                            family: ctx
                                .s(layer, "font_family")
                                .unwrap_or_else(|| "Inter".into()),
                            layout: b.layout,
                            x: b.x,
                            y: b.y,
                            rgb: [col[0], col[1], col[2]],
                            alpha: alpha * ctx.f(layer, "opacity", 0.88),
                            word_alpha: HashMap::new(),
                            highlight: None,
                        }));
                    }
                }
                LayerKind::ReferenceBadge => {
                    if let Some((b, _)) = ref_block.take() {
                        let col = ctx.color(layer, "text_color", [229, 231, 235, 255]);
                        prims.push(Primitive::Text(TextPrimitive {
                            family: ctx
                                .s(layer, "font_family")
                                .unwrap_or_else(|| "Inter".into()),
                            layout: b.layout,
                            x: b.x,
                            y: b.y,
                            rgb: [col[0], col[1], col[2]],
                            alpha: alpha * ctx.f(layer, "opacity", 0.65),
                            word_alpha: HashMap::new(),
                            highlight: None,
                        }));
                    }
                }
                LayerKind::ReciterPill => {
                    if let (Some(name), Some(_)) = (project.reciter.as_deref(), seg) {
                        let face = fonts.family(
                            &ctx.s(layer, "font_family")
                                .unwrap_or_else(|| "Inter".into()),
                        )?;
                        let px = ctx.f(layer, "font_size_cw", 0.034) * cw * scale;
                        let l = layout_words(
                            face,
                            &split_plain_words(name),
                            TextDirection::LatinLtr,
                            px,
                            safe.w,
                            1.2,
                        )?;
                        let tw = l.lines.iter().map(|ln| ln.width_px).fold(0.0f32, f32::max);
                        let (pv, ph) =
                            match layer.properties.get("padding_cw").and_then(Value::as_array) {
                                Some(a) if a.len() == 2 => (
                                    a[0].as_f64().unwrap_or(0.008) as f32 * cw,
                                    a[1].as_f64().unwrap_or(0.025) as f32 * cw,
                                ),
                                _ => (0.008 * cw, 0.025 * cw),
                            };
                        let (w, h) = (tw + 2.0 * ph, l.height_px + 2.0 * pv);
                        let cy = ch * (1.0 - ctx.f(layer, "offset_y_ch", 0.26));
                        let (x, y) = (safe.x + (safe.w - w) / 2.0, cy - h / 2.0);
                        let bgc = ctx.color(layer, "background_color", [8, 9, 12, 140]);
                        prims.push(Primitive::Rect {
                            x,
                            y,
                            w,
                            h,
                            radius: ctx.f(layer, "border_radius_cw", 0.02) * cw,
                            fill: [
                                bgc[0],
                                bgc[1],
                                bgc[2],
                                (f32::from(bgc[3]) * alpha).round() as u8,
                            ],
                            stroke: None,
                        });
                        let col = ctx.color(layer, "text_color", [255, 255, 255, 255]);
                        prims.push(Primitive::Text(TextPrimitive {
                            family: face.name().to_string(),
                            layout: l,
                            x: x + ph,
                            y: y + pv,
                            rgb: [col[0], col[1], col[2]],
                            alpha,
                            word_alpha: HashMap::new(),
                            highlight: None,
                        }));
                    }
                }
                LayerKind::WordCard => {
                    if let (Some(sg), Some(_)) = (seg, &content) {
                        let active = sg
                            .word_timings
                            .iter()
                            .find(|w| tick >= w.start_tick && tick <= w.end_tick)
                            .or_else(|| sg.word_timings.iter().rev().find(|w| tick > w.end_tick));
                        if let Some(w) = active {
                            let (x, y, ww, hh) = (
                                ctx.f(layer, "x", 0.1) * cw,
                                ctx.f(layer, "y", 0.7) * ch,
                                ctx.f(layer, "w", 0.8) * cw,
                                ctx.f(layer, "h", 0.2) * ch,
                            );
                            let sc = ctx.color(layer, "stroke", [255, 255, 255, 56]);
                            let swidth = ctx.f(layer, "stroke_width_cw", 0.002) * cw;
                            prims.push(Primitive::Rect {
                                x,
                                y,
                                w: ww,
                                h: hh,
                                radius: ctx.f(layer, "radius_cw", 0.03) * cw,
                                fill: ctx.color(layer, "fill", [255, 255, 255, 20]),
                                stroke: Some((sc, swidth)),
                            });
                            let face = fonts.family(
                                &ctx.s(layer, "font_family").unwrap_or_else(|| "LPMQ".into()),
                            )?;
                            let l = layout_words(
                                face,
                                &[InputWord {
                                    word_idx: w.word_idx,
                                    text: w.text.clone(),
                                }],
                                TextDirection::ArabicRtl,
                                ctx.f(layer, "font_size_cw", 0.045) * cw,
                                ww,
                                1.6,
                            )?;
                            let col = ctx.color(layer, "text_color", [255, 255, 255, 255]);
                            prims.push(Primitive::Text(TextPrimitive {
                                family: face.name().to_string(),
                                x,
                                y: y + (hh - l.height_px) / 2.0,
                                layout: l,
                                rgb: [col[0], col[1], col[2]],
                                alpha,
                                word_alpha: HashMap::new(),
                                highlight: None,
                            }));
                        }
                    }
                }
            }
        }

        Ok(RenderScene {
            width,
            height,
            primitives: prims,
            active_segment_id: seg.map(|s| s.id.clone()),
            ayah_text: ayah_text_out,
            ayah_fit_iterations: fit_iter,
            text_overflow,
            translations: translations_out,
        })
    }
}

/// Status karaoke (doc 05 §5.2): alpha per kata dan sorotan kata aktif.
#[allow(clippy::too_many_arguments)]
fn karaoke(
    seg: &AyahSegment,
    tick: i64,
    fade_ticks: i64,
    easing: &str,
    style: HighlightStyle,
    inactive: f32,
    active_rgba: [u8; 4],
    underline_rgba: [u8; 4],
) -> (HashMap<u32, f32>, Option<Highlight>) {
    let mut alpha = HashMap::new();
    if seg.word_timings.is_empty() {
        return (alpha, None);
    }
    let mut active: Option<(u32, f32)> = None;
    for w in &seg.word_timings {
        let fade = if tick < w.start_tick {
            0.0
        } else if fade_ticks > 0 {
            ease(easing, (tick - w.start_tick) as f32 / fade_ticks as f32)
        } else {
            1.0
        };
        if style == HighlightStyle::SmoothFade {
            alpha.insert(w.word_idx, inactive + (1.0 - inactive) * fade);
        }
        if tick >= w.start_tick && tick <= w.end_tick {
            let span = (w.end_tick - w.start_tick).max(1) as f32;
            active = Some((
                w.word_idx,
                ((tick - w.start_tick) as f32 / span).clamp(0.0, 1.0),
            ));
        }
    }
    let hl = match (style, active) {
        (HighlightStyle::SmoothFade, _) | (_, None) => None,
        (s, Some((idx, p))) => Some(Highlight {
            style: s,
            word_idx: idx,
            span_progress: p,
            rgba: if s == HighlightStyle::Underline {
                underline_rgba
            } else {
                [active_rgba[0], active_rgba[1], active_rgba[2], 56]
            },
        }),
    };
    (alpha, hl)
}

#[derive(Debug)]
pub struct SoftwareRenderer;

fn round_rect_path(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    if r <= 0.01 {
        return Some(PathBuilder::from_rect(Rect::from_xywh(x, y, w, h)?));
    }
    let k = 0.552_284_7 * r;
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

impl SoftwareRenderer {
    /// Merender scene ke Pixmap RGBA (premultiplied). Deterministik, hanya CPU (RND-5).
    pub fn render(scene: &RenderScene, fonts: &FontSet) -> Result<Pixmap, RenderError> {
        let mut pm = Pixmap::new(scene.width, scene.height)
            .ok_or_else(|| RenderError::Rasterization("Alokasi pixmap gagal".into()))?;
        for p in &scene.primitives {
            match p {
                Primitive::Fill { rgba } => {
                    pm.fill(Color::from_rgba8(rgba[0], rgba[1], rgba[2], rgba[3]));
                }
                Primitive::Image { pixmap } => {
                    pm.draw_pixmap(
                        0,
                        0,
                        pixmap.as_ref().as_ref(),
                        &PixmapPaint::default(),
                        Transform::identity(),
                        None,
                    );
                }
                Primitive::DimmerVertical {
                    rgb,
                    alpha_top,
                    alpha_bottom,
                } => {
                    // Gradien vertikal: alpha konstan per baris, dicampur langsung pada piksel premultiplied.
                    // Jauh lebih cepat daripada shader per-piksel (±34 ms → <3 ms pada 1080×1920).
                    let (width, height) = (pm.width() as usize, pm.height() as usize);
                    let data = pm.data_mut();
                    for y in 0..height {
                        let t = (y as f32 + 0.5) / height as f32;
                        let a = (alpha_top + (alpha_bottom - alpha_top) * t).clamp(0.0, 1.0);
                        let a8 = (a * 255.0).round() as u32;
                        let inv = 255 - a8;
                        let src = [
                            (u32::from(rgb[0]) * a8 + 127) / 255,
                            (u32::from(rgb[1]) * a8 + 127) / 255,
                            (u32::from(rgb[2]) * a8 + 127) / 255,
                            a8,
                        ];
                        for px in data[y * width * 4..(y + 1) * width * 4].chunks_exact_mut(4) {
                            for (ch, s) in px.iter_mut().zip(src) {
                                *ch = (s + (u32::from(*ch) * inv + 127) / 255).min(255) as u8;
                            }
                        }
                    }
                }
                Primitive::Rect {
                    x,
                    y,
                    w: rw,
                    h: rh,
                    radius,
                    fill,
                    stroke,
                } => {
                    let Some(path) = round_rect_path(*x, *y, *rw, *rh, *radius) else {
                        continue;
                    };
                    if fill[3] > 0 {
                        let mut paint = Paint::default();
                        paint.set_color_rgba8(fill[0], fill[1], fill[2], fill[3]);
                        paint.anti_alias = true;
                        pm.fill_path(
                            &path,
                            &paint,
                            FillRule::Winding,
                            Transform::identity(),
                            None,
                        );
                    }
                    if let Some((c, sw)) = stroke {
                        let mut paint = Paint::default();
                        paint.set_color_rgba8(c[0], c[1], c[2], c[3]);
                        paint.anti_alias = true;
                        let st = Stroke {
                            width: *sw,
                            ..Stroke::default()
                        };
                        pm.stroke_path(&path, &paint, &st, Transform::identity(), None);
                    }
                }
                Primitive::Text(t) => Self::draw_text(&mut pm, fonts, t)?,
            }
        }
        Ok(pm)
    }

    fn draw_text(pm: &mut Pixmap, fonts: &FontSet, t: &TextPrimitive) -> Result<(), RenderError> {
        let face = fonts.family(&t.family)?;
        // Sorotan latar (pil/kotak) digambar sebelum teks.
        if let Some(hl) = &t.highlight {
            if matches!(hl.style, HighlightStyle::Pill | HighlightStyle::Box) {
                if let Some((li, word)) = find_word(&t.layout, hl.word_idx) {
                    let pad = t.layout.font_size_px * 0.10;
                    let top =
                        t.y + li as f32 * t.layout.line_height_px + t.layout.line_height_px * 0.12;
                    let hh = t.layout.line_height_px * 0.76;
                    if let Some(path) = round_rect_path(
                        t.x + word.x_px - pad,
                        top,
                        word.width_px + 2.0 * pad,
                        hh,
                        if hl.style == HighlightStyle::Pill {
                            hh / 2.0
                        } else {
                            hh * 0.08
                        },
                    ) {
                        let mut paint = Paint::default();
                        paint.set_color_rgba8(
                            hl.rgba[0],
                            hl.rgba[1],
                            hl.rgba[2],
                            (f32::from(hl.rgba[3]) * t.alpha).round() as u8,
                        );
                        paint.anti_alias = true;
                        pm.fill_path(
                            &path,
                            &paint,
                            FillRule::Winding,
                            Transform::identity(),
                            None,
                        );
                    }
                }
            }
        }
        paint_layout(
            pm,
            face,
            &t.layout,
            (t.x, t.y),
            t.rgb,
            t.alpha,
            &t.word_alpha,
        )?;
        if let Some(hl) = &t.highlight {
            if hl.style == HighlightStyle::Underline {
                if let Some((li, word)) = find_word(&t.layout, hl.word_idx) {
                    let thick = (t.layout.font_size_px * 0.035).max(1.5);
                    let y = t.y
                        + li as f32 * t.layout.line_height_px
                        + t.layout.line_height_px * 0.72
                        + t.layout.font_size_px * 0.22;
                    let len = word.width_px * hl.span_progress;
                    // RTL: garis tumbuh dari tepi kanan kata.
                    let x = t.x + word.x_px + word.width_px - len;
                    if let Some(r) = Rect::from_xywh(x, y, len.max(0.0), thick) {
                        let mut paint = Paint::default();
                        paint.set_color_rgba8(
                            hl.rgba[0],
                            hl.rgba[1],
                            hl.rgba[2],
                            (255.0 * t.alpha).round() as u8,
                        );
                        paint.anti_alias = true;
                        pm.fill_rect(r, &paint, Transform::identity(), None);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn render_png(scene: &RenderScene, fonts: &FontSet) -> Result<Vec<u8>, RenderError> {
        Self::render(scene, fonts)?
            .encode_png()
            .map_err(|e| RenderError::Rasterization(format!("Encode PNG gagal: {e}")))
    }
}

fn find_word(layout: &TextLayout, idx: u32) -> Option<(usize, &crate::text::PlacedWord)> {
    layout
        .lines
        .iter()
        .enumerate()
        .find_map(|(li, ln)| ln.words.iter().find(|w| w.word_idx == idx).map(|w| (li, w)))
}

/// Membungkus piksel RGBA mentah (frame latar yang sudah di-cover-fit, lurus/non-premultiplied) menjadi
/// `Pixmap` buram untuk [`SceneBuilder::build_with_background`]. Piksel transparan dicampur ke hitam,
/// sehingga hasilnya selalu opak (deterministik, tidak bergantung pada latar warna template).
pub fn background_pixmap(width: u32, height: u32, rgba: &[u8]) -> Result<Arc<Pixmap>, RenderError> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(RenderError::Rasterization(format!(
            "Piksel latar {} byte, diharapkan {expected} ({width}x{height} RGBA)",
            rgba.len()
        )));
    }
    let mut pm = Pixmap::new(width, height)
        .ok_or_else(|| RenderError::Rasterization("Alokasi pixmap latar gagal".into()))?;
    for (dst, src) in pm.data_mut().chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        let a = u32::from(src[3]);
        for (d, s) in dst.iter_mut().zip(src).take(3) {
            *d = ((u32::from(*s) * a + 127) / 255) as u8;
        }
        dst[3] = 255;
    }
    Ok(Arc::new(pm))
}

/// Digest SHA-256 piksel RGBA (premultiplied) untuk uji golden.
pub fn pixmap_digest(pm: &Pixmap) -> String {
    let mut h = Sha256::new();
    h.update(pm.width().to_le_bytes());
    h.update(pm.height().to_le_bytes());
    h.update(pm.data());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Lebar total sebuah blok teks (px), dipakai pemeriksaan area aman.
pub fn layout_extent(layout: &TextLayout) -> f32 {
    layout.lines.iter().map(|l| l.width_px).fold(0.0, f32::max)
}
