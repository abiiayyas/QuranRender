//! Shaping teks (harfrust), outline glyph, tata letak word-aware dan auto-fit (PRD STY-8, RND-2).
//! Mengacu ke docs/design/05_VIDEO_TEMPLATES.md §6 dan ADR-0003 (hasil spike S2: harfrust identik
//! dengan HarfBuzz pada 6.236 ayat LPMQ).

use crate::scene::RenderError;
use harfrust::{font::Font, Buffer, Direction, Language, Script, ShapeOptions, ShaperFont, Tag};
use read_fonts::model::glyph::outline::DrawMemory;
use read_fonts::model::glyph::outline::{DrawOptions, PathElement};
use read_fonts::types::GlyphId;
use std::collections::HashMap;
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tiny_skia::{FillRule, Paint, Path as SkPath, PathBuilder, Pixmap, Transform};

/// Arah dasar teks yang dishaping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextDirection {
    /// Arab (RTL): `script=Arab`, `lang=ar`.
    ArabicRtl,
    /// Latin (LTR): `script=Latn`, `lang=id`.
    LatinLtr,
}

/// Satu glyph hasil shaping dalam satuan font (unit em).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShapedGlyph {
    pub glyph_id: u32,
    pub x_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    /// Offset byte UTF-8 pada teks sumber (satuan cluster harfrust).
    pub cluster: u32,
}

/// Font yang dimuat penuh: dipakai untuk shaping dan mengambil outline.
pub struct FontFace {
    name: String,
    font: Font,
    units_per_em: f32,
    /// Path glyph (satuan font) di-cache antar frame: ekstraksi outline mendominasi biaya render.
    paths: Mutex<HashMap<u32, Option<Arc<SkPath>>>>,
}

impl std::fmt::Debug for FontFace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FontFace")
            .field("name", &self.name)
            .field("units_per_em", &self.units_per_em)
            .finish_non_exhaustive()
    }
}

impl FontFace {
    pub fn from_bytes(name: &str, bytes: Vec<u8>) -> Result<Self, RenderError> {
        let font = Font::new(bytes, 0)
            .ok_or_else(|| RenderError::Font(format!("Font '{name}' tidak dapat dibaca")))?;
        let units_per_em = f32::from(font.units_per_em());
        Ok(Self {
            name: name.to_string(),
            font,
            units_per_em,
            paths: Mutex::new(HashMap::new()),
        })
    }

    /// Path glyph dalam satuan font (cache). `None` untuk glyph tanpa kontur (mis. spasi).
    pub fn glyph_path(&self, glyph_id: u32) -> Result<Option<Arc<SkPath>>, RenderError> {
        let mut cache = self
            .paths
            .lock()
            .map_err(|_| RenderError::Font("cache glyph rusak".into()))?;
        if let Some(hit) = cache.get(&glyph_id) {
            return Ok(hit.clone());
        }
        let path = build_path(&self.glyph_outline(glyph_id)?).map(Arc::new);
        cache.insert(glyph_id, path.clone());
        Ok(path)
    }

    pub fn from_file(name: &str, path: &Path) -> Result<Self, RenderError> {
        let bytes = std::fs::read(path)?;
        Self::from_bytes(name, bytes)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn units_per_em(&self) -> f32 {
        self.units_per_em
    }

    /// Memeriksa apakah codepoint punya glyph di cmap (bukan `.notdef`).
    pub fn has_glyph(&self, ch: char) -> bool {
        self.font
            .charmap()
            .map_unicode(u32::from(ch))
            .is_some_and(|g| g.to_u32() != 0)
    }

    /// Shaping satu rentang teks. Urutan glyph = urutan visual kiri → kanan.
    pub fn shape(&self, text: &str, dir: TextDirection) -> Result<Vec<ShapedGlyph>, RenderError> {
        let shaper_font = ShaperFont::new(&self.font);
        let mut buf = Buffer::new();
        buf.push_str(text);
        let (direction, tag, lang) = match dir {
            TextDirection::ArabicRtl => (Direction::RightToLeft, *b"Arab", "ar"),
            TextDirection::LatinLtr => (Direction::LeftToRight, *b"Latn", "id"),
        };
        buf.set_direction(direction);
        buf.set_script(Script::from_iso15924_tag(Tag::new(&tag)));
        buf.set_language(Language::from_str(lang).ok());
        harfrust::shape(&shaper_font, &mut buf, ShapeOptions::new())
            .map_err(|e| RenderError::Shaping(format!("{e:?}")))?;
        Ok(buf
            .glyph_infos()
            .iter()
            .zip(buf.glyph_positions())
            .map(|(i, p)| ShapedGlyph {
                glyph_id: i.glyph_id,
                x_advance: p.x_advance,
                x_offset: p.x_offset,
                y_offset: p.y_offset,
                cluster: i.cluster,
            })
            .collect())
    }

    /// Outline glyph dalam satuan font (y ke atas).
    pub fn glyph_outline(&self, glyph_id: u32) -> Result<Vec<PathElement>, RenderError> {
        let outlines = self.font.outline_glyphs();
        let glyph = outlines
            .get(GlyphId::new(glyph_id))
            .ok_or_else(|| RenderError::Font(format!("Glyph {glyph_id} tanpa outline")))?;
        let mut sink: Vec<PathElement> = Vec::new();
        glyph
            .draw(&DrawOptions::new(), DrawMemory::default(), &mut sink)
            .map_err(|e| RenderError::Font(format!("Gagal menggambar glyph {glyph_id}: {e:?}")))?;
        Ok(sink)
    }
}

/// Lebar total deretan glyph (unit font).
pub fn run_width(glyphs: &[ShapedGlyph]) -> i64 {
    glyphs.iter().map(|g| i64::from(g.x_advance)).sum()
}

/// Kata yang sudah dishaping dan diletakkan pada satu baris.
#[derive(Debug, Clone)]
pub struct PlacedWord {
    /// Indeks kata (1-based, sama dengan tokenizer v1 dan `WordTiming.word_idx`).
    pub word_idx: u32,
    pub glyphs: Vec<ShapedGlyph>,
    /// Tepi kiri kata relatif terhadap kotak teks (px).
    pub x_px: f32,
    pub width_px: f32,
}

#[derive(Debug, Clone)]
pub struct PlacedLine {
    pub words: Vec<PlacedWord>,
    pub width_px: f32,
}

/// Hasil tata letak sebuah blok teks.
#[derive(Debug, Clone)]
pub struct TextLayout {
    pub lines: Vec<PlacedLine>,
    pub font_size_px: f32,
    pub line_height_px: f32,
    pub height_px: f32,
    /// Jumlah iterasi auto-fit yang dipakai (1 = tanpa pengecilan).
    pub fit_iterations: u8,
    /// Faktor skala font akhir terhadap ukuran template (1.0 = 100%).
    pub fit_scale: f32,
}

/// Satu kata masukan: indeks + teks (termasuk tanda waqaf yang menempel, sesuai tokenizer v1).
#[derive(Debug, Clone)]
pub struct InputWord {
    pub word_idx: u32,
    pub text: String,
}

/// Memecah teks ayat menjadi kata memakai tokenizer v1 (`qr-quran`). Tanda waqaf tidak pernah
/// dipisah dari kata yang diikutinya (doc 05 §6.1).
pub fn words_of_ayah(text: &str) -> Result<Vec<InputWord>, RenderError> {
    let trimmed = text.trim();
    let (tokens, _meta) = qr_quran::tokenize_ayah_v1(trimmed)
        .map_err(|e| RenderError::Shaping(format!("Tokenisasi gagal: {e}")))?;
    Ok(tokens
        .into_iter()
        .map(|t| InputWord {
            word_idx: t.idx,
            text: trimmed[t.span_start..t.span_end].to_string(),
        })
        .collect())
}

/// Tata letak satu ukuran font: pemenggalan baris hanya di batas kata, teks rata tengah.
pub fn layout_words(
    face: &FontFace,
    words: &[InputWord],
    dir: TextDirection,
    font_size_px: f32,
    max_width_px: f32,
    line_height_mult: f32,
) -> Result<TextLayout, RenderError> {
    let scale = font_size_px / face.units_per_em();
    let space_units = face
        .shape(" ", dir)?
        .iter()
        .map(|g| g.x_advance)
        .sum::<i32>();
    let space_px = space_units as f32 * scale;

    let mut shaped: Vec<(u32, Vec<ShapedGlyph>, f32)> = Vec::with_capacity(words.len());
    for w in words {
        let g = face.shape(&w.text, dir)?;
        let width = run_width(&g) as f32 * scale;
        shaped.push((w.word_idx, g, width));
    }

    // Pemenggalan baris greedy (urutan logis). Kata tunggal yang lebih lebar dari kotak tetap
    // satu baris sendiri (tidak pernah dipotong).
    let mut raw_lines: Vec<Vec<usize>> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    let mut cur_w = 0.0f32;
    for (i, (_, _, w)) in shaped.iter().enumerate() {
        let add = if cur.is_empty() { *w } else { space_px + *w };
        if !cur.is_empty() && cur_w + add > max_width_px {
            raw_lines.push(std::mem::take(&mut cur));
            cur_w = 0.0;
            cur.push(i);
            cur_w += *w;
        } else {
            cur.push(i);
            cur_w += add;
        }
    }
    if !cur.is_empty() {
        raw_lines.push(cur);
    }

    let rtl = dir == TextDirection::ArabicRtl;
    let mut lines = Vec::with_capacity(raw_lines.len());
    for idxs in raw_lines {
        let line_w: f32 = idxs.iter().map(|&i| shaped[i].2).sum::<f32>()
            + space_px * (idxs.len().saturating_sub(1)) as f32;
        let start = (max_width_px - line_w) / 2.0;
        let mut placed = Vec::with_capacity(idxs.len());
        if rtl {
            // Kata pertama (logis) berada paling kanan.
            let mut right = start + line_w;
            for &i in &idxs {
                let (idx, g, w) = &shaped[i];
                placed.push(PlacedWord {
                    word_idx: *idx,
                    glyphs: g.clone(),
                    x_px: right - w,
                    width_px: *w,
                });
                right -= w + space_px;
            }
        } else {
            let mut left = start;
            for &i in &idxs {
                let (idx, g, w) = &shaped[i];
                placed.push(PlacedWord {
                    word_idx: *idx,
                    glyphs: g.clone(),
                    x_px: left,
                    width_px: *w,
                });
                left += w + space_px;
            }
        }
        lines.push(PlacedLine {
            words: placed,
            width_px: line_w,
        });
    }

    let line_height_px = font_size_px * line_height_mult;
    Ok(TextLayout {
        height_px: line_height_px * lines.len() as f32,
        lines,
        font_size_px,
        line_height_px,
        fit_iterations: 1,
        fit_scale: 1.0,
    })
}

/// Skala font tiap iterasi auto-fit (doc 05 §6.2): 100% → turun 7% per langkah → batas bawah 65%.
const FIT_SCALES: [f32; 5] = [1.00, 0.93, 0.86, 0.79, 0.65];
/// Batas bawah jarak antarbaris pada iterasi terakhir.
const MIN_LINE_HEIGHT_MULT: f32 = 1.65;

/// Auto-fit deterministik maksimal 5 iterasi. Iterasi ke-5 (65%) juga menurunkan jarak antarbaris
/// hingga minimal 1,65×.
pub fn fit_text(
    face: &FontFace,
    words: &[InputWord],
    dir: TextDirection,
    base_font_px: f32,
    max_width_px: f32,
    max_height_px: f32,
    base_line_height_mult: f32,
) -> Result<TextLayout, RenderError> {
    let mut last = None;
    for (i, s) in FIT_SCALES.iter().enumerate() {
        let is_last = i == FIT_SCALES.len() - 1;
        let lh = if is_last {
            MIN_LINE_HEIGHT_MULT.min(base_line_height_mult)
        } else {
            base_line_height_mult
        };
        let mut layout = layout_words(face, words, dir, base_font_px * s, max_width_px, lh)?;
        layout.fit_iterations = (i + 1) as u8;
        layout.fit_scale = *s;
        let fits = layout.height_px <= max_height_px;
        last = Some(layout);
        if fits {
            break;
        }
    }
    last.ok_or_else(|| RenderError::Shaping("Auto-fit tidak menghasilkan tata letak".into()))
}

/// Pewarnaan per kata saat menggambar (karaoke): alpha 0..1 untuk tiap `word_idx`.
pub fn paint_layout(
    pixmap: &mut Pixmap,
    face: &FontFace,
    layout: &TextLayout,
    origin: (f32, f32),
    rgb: [u8; 3],
    base_alpha: f32,
    word_alpha: &HashMap<u32, f32>,
) -> Result<(), RenderError> {
    let (origin_x, origin_y) = origin;
    let scale = layout.font_size_px / face.units_per_em();
    for (li, line) in layout.lines.iter().enumerate() {
        // Garis dasar: ~72% tinggi baris dari atas (menyisakan ruang tanda baca di atas dan bawah).
        let baseline = origin_y + li as f32 * layout.line_height_px + layout.line_height_px * 0.72;
        for word in &line.words {
            let alpha = (base_alpha * word_alpha.get(&word.word_idx).copied().unwrap_or(1.0))
                .clamp(0.0, 1.0);
            let mut paint = Paint::default();
            paint.set_color_rgba8(rgb[0], rgb[1], rgb[2], (alpha * 255.0).round() as u8);
            paint.anti_alias = true;
            let mut pen = origin_x + word.x_px;
            for g in &word.glyphs {
                if let Some(path) = face.glyph_path(g.glyph_id)? {
                    let tx = pen + g.x_offset as f32 * scale;
                    let ty = baseline - g.y_offset as f32 * scale;
                    pixmap.fill_path(
                        &path,
                        &paint,
                        FillRule::Winding,
                        Transform::from_row(scale, 0.0, 0.0, -scale, tx, ty),
                        None,
                    );
                }
                pen += g.x_advance as f32 * scale;
            }
        }
    }
    Ok(())
}

fn build_path(elements: &[PathElement]) -> Option<SkPath> {
    let mut pb = PathBuilder::new();
    for e in elements {
        match *e {
            PathElement::MoveTo { x, y } => pb.move_to(x, y),
            PathElement::LineTo { x, y } => pb.line_to(x, y),
            PathElement::QuadTo { cx0, cy0, x, y } => pb.quad_to(cx0, cy0, x, y),
            PathElement::CurveTo {
                cx0,
                cy0,
                cx1,
                cy1,
                x,
                y,
            } => pb.cubic_to(cx0, cy0, cx1, cy1, x, y),
            PathElement::Close => pb.close(),
        }
    }
    pb.finish()
}

/// Menyarankan pembagian ayat panjang menjadi rentang kata `(awal, akhir)` (1-based, inklusif) yang
/// masing-masing muat pada area `max_width_px × max_height_px` (auto-fit tetap diizinkan sampai 65%).
/// Pembagian hanya di batas kata. Kata tunggal yang tidak muat tetap menjadi satu rentang sendiri.
pub fn suggest_word_ranges(
    face: &FontFace,
    words: &[InputWord],
    dir: TextDirection,
    base_font_px: f32,
    max_width_px: f32,
    max_height_px: f32,
    line_height_mult: f32,
) -> Result<Vec<(u32, u32)>, RenderError> {
    let mut ranges = Vec::new();
    let mut start = 0usize;
    while start < words.len() {
        let mut end = start + 1; // eksklusif; minimal satu kata
        while end < words.len() {
            let l = fit_text(
                face,
                &words[start..=end],
                dir,
                base_font_px,
                max_width_px,
                max_height_px,
                line_height_mult,
            )?;
            if l.height_px > max_height_px + 0.5 {
                break;
            }
            end += 1;
        }
        ranges.push((words[start].word_idx, words[end - 1].word_idx));
        start = end;
    }
    Ok(ranges)
}
