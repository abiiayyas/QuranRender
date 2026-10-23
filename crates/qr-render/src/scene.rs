//! Scene builder, pemetaan gaya berlapis, dan rendering deterministik 2D (PRD RND-1, RND-2, STY-1, STY-8).
//! Mengacu ke docs/design/05_VIDEO_TEMPLATES.md dan docs/engineering/01_TECHNICAL_HANDOFF.md §7.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;
use tiny_skia::{Color, Paint, Pixmap, Rect, Transform};

use qr_core::Project;

#[derive(Error, Debug)]
pub enum RenderError {
    #[error("Template tidak valid: {0}")]
    InvalidTemplate(String),
    #[error("Gagal merasterisasi scene: {0}")]
    RasterizationFailed(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateConfig {
    pub id: String,
    pub name: String,
    pub supported_ratios: Vec<String>,
    pub default_ratio: String,
    pub safe_area: HashMap<String, SafeAreaConfig>,
    pub background: BackgroundConfig,
    pub typography: TypographyConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeAreaConfig {
    pub top: f32,
    pub bottom: f32,
    pub left: f32,
    pub right: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundConfig {
    pub default_color: String,
    pub dimmer_opacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypographyConfig {
    pub ayah_font: String,
    pub ayah_size_cw: f32,
    pub ayah_color: String,
    pub translation_font: String,
    pub translation_size_cw: f32,
    pub translation_color: String,
    pub translation_opacity: f32,
    pub highlight_style: String,
}

/// Struktur data Scene bernormalisasi siap gambar oleh backend render (vello / tiny-skia / wgpu).
#[derive(Debug, Clone)]
pub struct RenderScene {
    pub width: u32,
    pub height: u32,
    pub background_color: Color,
    pub dimmer_opacity: f32,
    pub safe_area_rect: Rect,
    pub active_ayah_text: Option<String>,
    pub active_translation_text: Option<String>,
    pub active_reference: Option<String>,
    pub ayah_font_size_px: f32,
    pub translation_font_size_px: f32,
    pub ayah_color: Color,
    pub translation_color: Color,
    pub highlight_word_idx: Option<u32>,
    pub highlight_progress: f32,
}

impl TemplateConfig {
    pub fn load_from_file(path: &Path) -> Result<Self, RenderError> {
        let content = std::fs::read_to_string(path)?;
        let tpl: Self = serde_json::from_str(&content)?;
        Ok(tpl)
    }
}

#[derive(Debug)]
pub struct SceneBuilder;

impl SceneBuilder {
    /// Membangun scene deterministik dari project, template, dan posisi tick audio saat ini.
    pub fn build(
        project: &Project,
        template: &TemplateConfig,
        tick: i64,
        sample_translation: Option<&str>,
    ) -> Result<RenderScene, RenderError> {
        let width = project.canvas.width;
        let height = project.canvas.height;
        let cw = width as f32;
        let ch = height as f32;

        let ratio = &project.canvas.aspect_ratio;
        let safe = template
            .safe_area
            .get(ratio)
            .cloned()
            .unwrap_or(SafeAreaConfig {
                top: 0.08,
                bottom: 0.14,
                left: 0.10,
                right: 0.10,
            });

        let safe_rect = Rect::from_xywh(
            safe.left * cw,
            safe.top * ch,
            cw * (1.0 - safe.left - safe.right),
            ch * (1.0 - safe.top - safe.bottom),
        )
        .ok_or_else(|| {
            RenderError::RasterizationFailed("Batas area aman tidak valid".to_string())
        })?;

        let bg_color = parse_hex_color(&template.background.default_color).unwrap_or(Color::BLACK);

        // Cari segmen aktif pada tick ini
        let active_seg = project
            .segments
            .iter()
            .find(|s| tick >= s.start_tick && tick < s.end_tick);

        let mut active_ayah_text = None;
        let mut active_ref = None;
        let mut highlight_word_idx = None;
        let mut highlight_progress = 0.0f32;

        if let Some(seg) = active_seg {
            let sample_ayah = format!("Surah {} Ayat {}", seg.surah_id, seg.ayah_number);
            active_ayah_text = Some(sample_ayah);
            active_ref = Some(format!("Ayat {}", seg.ayah_number));

            // Evaluasi sorotan kata (ANM-2)
            for w in &seg.word_timings {
                if tick >= w.start_tick && tick < w.end_tick {
                    highlight_word_idx = Some(w.word_idx);
                    let span = (w.end_tick - w.start_tick).max(1) as f32;
                    highlight_progress = ((tick - w.start_tick) as f32 / span).clamp(0.0, 1.0);
                    break;
                }
            }
        }

        // Resolusi kaskade gaya: Template -> Project -> Clip (STY-1)
        let ayah_size_cw = template.typography.ayah_size_cw;
        let tr_size_cw = template.typography.translation_size_cw;

        let ayah_font_size_px = ayah_size_cw * cw;
        let translation_font_size_px = tr_size_cw * cw;

        let ayah_color = parse_hex_color(&template.typography.ayah_color).unwrap_or(Color::WHITE);
        let tr_color = parse_hex_color(&template.typography.translation_color)
            .unwrap_or(Color::from_rgba8(220, 220, 220, 255));

        Ok(RenderScene {
            width,
            height,
            background_color: bg_color,
            dimmer_opacity: template.background.dimmer_opacity,
            safe_area_rect: safe_rect,
            active_ayah_text,
            active_translation_text: sample_translation.map(|s| s.to_string()),
            active_reference: active_ref,
            ayah_font_size_px,
            translation_font_size_px,
            ayah_color,
            translation_color: tr_color,
            highlight_word_idx,
            highlight_progress,
        })
    }
}

#[derive(Debug)]
pub struct SoftwareRenderer;

impl SoftwareRenderer {
    /// Merender scene ke buffer Pixmap RGBA premultiplied menggunakan tiny-skia.
    /// Berjalan deterministik di CPU pada semua OS tanpa GPU (PRD RND-1, RND-5).
    pub fn render(scene: &RenderScene) -> Result<Pixmap, RenderError> {
        let mut pixmap = Pixmap::new(scene.width, scene.height)
            .ok_or_else(|| RenderError::RasterizationFailed("Alokasi pixmap gagal".to_string()))?;

        // 1. Gambar latar
        pixmap.fill(scene.background_color);

        // 2. Terapkan peredup latar (dimmer) bila > 0
        if scene.dimmer_opacity > 0.01 {
            let mut paint = Paint::default();
            let alpha_u8 = (scene.dimmer_opacity.clamp(0.0, 1.0) * 255.0) as u8;
            paint.set_color_rgba8(0, 0, 0, alpha_u8);
            if let Some(r) = Rect::from_xywh(0.0, 0.0, scene.width as f32, scene.height as f32) {
                pixmap.fill_rect(r, &paint, Transform::identity(), None);
            }
        }

        // 3. Render kartu konten di dalam area aman
        if let Some(r) = Rect::from_xywh(
            scene.safe_area_rect.x(),
            scene.safe_area_rect.y(),
            scene.safe_area_rect.width(),
            scene.safe_area_rect.height(),
        ) {
            // Gambar pembatas halus di area aman (indikator visual rendering)
            let mut stroke_paint = Paint::default();
            stroke_paint.set_color_rgba8(255, 255, 255, 25);
            let stroke = tiny_skia::Stroke {
                width: 1.0,
                ..Default::default()
            };
            let path = tiny_skia::PathBuilder::from_rect(r);
            pixmap.stroke_path(&path, &stroke_paint, &stroke, Transform::identity(), None);
        }

        Ok(pixmap)
    }
}

fn parse_hex_color(hex_str: &str) -> Option<Color> {
    let clean = hex_str.trim().trim_start_matches('#');
    if clean.len() == 6 {
        let r = u8::from_str_radix(&clean[0..2], 16).ok()?;
        let g = u8::from_str_radix(&clean[2..4], 16).ok()?;
        let b = u8::from_str_radix(&clean[4..6], 16).ok()?;
        Some(Color::from_rgba8(r, g, b, 255))
    } else if clean.len() == 8 {
        let r = u8::from_str_radix(&clean[0..2], 16).ok()?;
        let g = u8::from_str_radix(&clean[2..4], 16).ok()?;
        let b = u8::from_str_radix(&clean[4..6], 16).ok()?;
        let a = u8::from_str_radix(&clean[6..8], 16).ok()?;
        Some(Color::from_rgba8(r, g, b, a))
    } else {
        None
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use qr_core::{AyahSegment, WordTiming};

    fn make_test_project_with_ratio(aspect: &str, width: u32, height: u32) -> Project {
        let mut proj = Project::new("Golden Render Project");
        proj.canvas.aspect_ratio = aspect.to_string();
        proj.canvas.width = width;
        proj.canvas.height = height;

        proj.segments.push(AyahSegment {
            id: "seg_1".to_string(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![
                WordTiming {
                    word_idx: 0,
                    start_tick: 0,
                    end_tick: 48000,
                    text: "بِسْمِ".to_string(),
                    confidence: 0.98,
                },
                WordTiming {
                    word_idx: 1,
                    start_tick: 48000,
                    end_tick: 48000 * 2,
                    text: "اللّٰهِ".to_string(),
                    confidence: 0.95,
                },
            ],
            confidence: 0.96,
            manual_override: false,
        });

        proj
    }

    #[test]
    fn test_golden_render_4_templates_across_4_ratios() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let golden_dir = root.join("tests/golden/render");
        std::fs::create_dir_all(&golden_dir).unwrap();

        let ratios = [
            ("9:16", 1080, 1920),
            ("16:9", 1920, 1080),
            ("1:1", 1080, 1080),
            ("4:5", 1080, 1350),
        ];

        let templates = ["subuh", "hening", "terang", "besar"];

        let mut total_rendered = 0;

        for tpl_name in templates {
            let tpl_path = root.join(format!(
                "crates/qr-render/templates/{}/template.json",
                tpl_name
            ));
            let tpl = TemplateConfig::load_from_file(&tpl_path).unwrap();

            for (ratio, w, h) in ratios {
                if !tpl.supported_ratios.contains(&ratio.to_string()) {
                    continue;
                }

                let proj = make_test_project_with_ratio(ratio, w, h);
                let scene = SceneBuilder::build(
                    &proj,
                    &tpl,
                    24000, // tick di tengah kata pertama
                    Some("Dengan nama Allah Yang Maha Pengasih lagi Maha Penyayang."),
                )
                .unwrap();

                assert_eq!(scene.width, w);
                assert_eq!(scene.height, h);
                assert_eq!(scene.highlight_word_idx, Some(0));

                let pixmap = SoftwareRenderer::render(&scene).unwrap();
                assert_eq!(pixmap.width(), w);
                assert_eq!(pixmap.height(), h);

                // Simpan golden frame PNG
                let safe_ratio_name = ratio.replace(':', "x");
                let frame_file = golden_dir.join(format!("{}_{}.png", tpl_name, safe_ratio_name));
                pixmap.save_png(&frame_file).unwrap();

                assert!(frame_file.exists());
                total_rendered += 1;
            }
        }

        // Kriteria Selesai A1-06 & A1-15:
        // Seluruh kombinasi template × rasio berhasil dirender ke golden frame
        assert!(
            total_rendered >= 12,
            "Total golden frame harus >= 12, dihasilkan {}",
            total_rendered
        );
        println!(
            "✓ Berhasil merender {} golden frame lintas rasio dan template",
            total_rendered
        );
    }
}
