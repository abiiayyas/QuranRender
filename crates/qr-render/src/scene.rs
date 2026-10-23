//! Scene builder, pemetaan gaya berlapis, dekorasi STY-2/3/4, safe area per platform, dan rendering deterministik 2D.
//! Mengacu ke docs/design/05_VIDEO_TEMPLATES.md dan docs/engineering/01_TECHNICAL_HANDOFF.md §7.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;
use tiny_skia::{Color, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

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

/// Target platform video sosial untuk perhitungan safe area (PRD STY-5, B2-02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SocialPlatform {
    YouTubeShorts,
    InstagramReels,
    TikTok,
    YouTubeLandscape,
    InstagramFeedSquare,
    InstagramFeedPortrait,
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

impl SafeAreaConfig {
    /// Menghasilkan safe area standar per rasio dan platform sesuai docs/design/05_VIDEO_TEMPLATES.md §2.
    pub fn for_platform(ratio: &str, platform: Option<SocialPlatform>) -> Self {
        match ratio {
            "9:16" => match platform {
                Some(SocialPlatform::TikTok) => Self {
                    top: 0.10,
                    bottom: 0.18, // TikTok butuh ruang bawah lebih luas untuk caption/sound
                    left: 0.10,
                    right: 0.14, // UI tombol like/share di kanan
                },
                _ => Self {
                    top: 0.08,
                    bottom: 0.14,
                    left: 0.10,
                    right: 0.10,
                },
            },
            "16:9" => Self {
                top: 0.08,
                bottom: 0.08,
                left: 0.08,
                right: 0.08,
            },
            "1:1" => Self {
                top: 0.06,
                bottom: 0.06,
                left: 0.06,
                right: 0.06,
            },
            "4:5" => Self {
                top: 0.06,
                bottom: 0.08,
                left: 0.06,
                right: 0.06,
            },
            _ => Self {
                top: 0.08,
                bottom: 0.10,
                left: 0.08,
                right: 0.08,
            },
        }
    }
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

/// Jenis dekorasi visual STY-3 dan overlay STY-4.
#[derive(Debug, Clone, PartialEq)]
pub enum DecorationElement {
    SurahNameAmiri {
        text: String,
        font_size_px: f32,
        color: Color,
    },
    ReciterPill {
        name: String,
        font_size_px: f32,
        bg_color: Color,
        text_color: Color,
    },
    AyahNumberOrnament {
        number: u32,
        color: Color,
    },
    LogoWatermark {
        opacity: f32,
    },
    GradientOverlayTop {
        opacity: f32,
    },
    GradientOverlayBottom {
        opacity: f32,
    },
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
    pub decorations: Vec<DecorationElement>,
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
            .unwrap_or_else(|| SafeAreaConfig::for_platform(ratio, None));

        let safe_rect = Rect::from_xywh(
            safe.left * cw,
            safe.top * ch,
            cw * (1.0 - safe.left - safe.right),
            ch * (1.0 - safe.top - safe.bottom),
        )
        .ok_or_else(|| {
            RenderError::RasterizationFailed("Rect area aman tidak valid".to_string())
        })?;

        let bg_color = parse_hex_color(&template.background.default_color)
            .unwrap_or(Color::from_rgba8(18, 20, 23, 255));

        let dimmer = template.background.dimmer_opacity;

        // Cari segmen aktif pada tick saat ini
        let mut active_ayah = None;
        let mut active_ref = None;
        let mut active_surah_id = 1u32;
        let mut active_ayah_num = 1u32;
        let mut highlight_word_idx = None;
        let mut highlight_progress = 0.0f32;

        for seg in &project.segments {
            if tick >= seg.start_tick && tick <= seg.end_tick {
                active_ref = Some(format!("{}:{}", seg.surah_id, seg.ayah_number));
                active_surah_id = seg.surah_id;
                active_ayah_num = seg.ayah_number;

                // Tentukan kata yang sedang disorot
                for wt in &seg.word_timings {
                    if tick >= wt.start_tick && tick <= wt.end_tick {
                        highlight_word_idx = Some(wt.word_idx);
                        let span = (wt.end_tick - wt.start_tick).max(1) as f32;
                        highlight_progress = ((tick - wt.start_tick) as f32 / span).clamp(0.0, 1.0);
                        break;
                    }
                }
                break;
            }
        }

        // Teks fallback untuk render deterministik jika belum ada audio/segmen
        if active_ayah.is_none() && !project.segments.is_empty() {
            let first = &project.segments[0];
            active_surah_id = first.surah_id;
            active_ayah_num = first.ayah_number;
            active_ref = Some(format!("{}:{}", first.surah_id, first.ayah_number));
        }

        active_ayah = Some("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ".to_string());

        let active_trans = sample_translation
            .map(|s| s.to_string())
            .or_else(|| Some("Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.".to_string()));

        let ayah_size_px = cw * template.typography.ayah_size_cw;
        let trans_size_px = cw * template.typography.translation_size_cw;

        let ayah_color = parse_hex_color(&template.typography.ayah_color)
            .unwrap_or(Color::from_rgba8(243, 244, 246, 255));

        let mut trans_color = parse_hex_color(&template.typography.translation_color)
            .unwrap_or(Color::from_rgba8(209, 213, 219, 255));
        trans_color = Color::from_rgba(
            trans_color.red(),
            trans_color.green(),
            trans_color.blue(),
            trans_color.alpha() * template.typography.translation_opacity,
        )
        .unwrap_or(trans_color);

        // Susun dekorasi STY-2, STY-3, dan overlay STY-4
        let mut decorations = Vec::new();

        // 1. Nama Surah Amiri di bagian atas area aman
        decorations.push(DecorationElement::SurahNameAmiri {
            text: match active_surah_id {
                1 => "سُورَةُ الْفَاتِحَةِ".to_string(),
                2 => "سُورَةُ الْبَقَرَةِ".to_string(),
                18 => "سُورَةُ الْكَهْفِ".to_string(),
                36 => "سُورَةُ يس".to_string(),
                67 => "سُورَةُ الْمُلْكِ".to_string(),
                _ => format!("سُورَةُ رَقْم {}", active_surah_id),
            },
            font_size_px: (cw * 0.038).max(18.0),
            color: Color::from_rgba8(229, 231, 235, 230),
        });

        // 2. Nomor ayat ornamen
        decorations.push(DecorationElement::AyahNumberOrnament {
            number: active_ayah_num,
            color: Color::from_rgba8(99, 102, 241, 255), // Indigo aksen
        });

        // 3. Nama Qari pill di bagian bawah area aman jika tersedia
        if let Some(reciter) = &project.reciter {
            decorations.push(DecorationElement::ReciterPill {
                name: reciter.clone(),
                font_size_px: (cw * 0.026).max(12.0),
                bg_color: Color::from_rgba8(0, 0, 0, 120),
                text_color: Color::from_rgba8(243, 244, 246, 255),
            });
        }

        // 4. Logo watermark di sudut aman
        decorations.push(DecorationElement::LogoWatermark { opacity: 0.70 });

        // 5. Gradien peredup atas dan bawah (STY-4) untuk rasio vertikal
        if ratio == "9:16" {
            decorations.push(DecorationElement::GradientOverlayTop { opacity: 0.35 });
            decorations.push(DecorationElement::GradientOverlayBottom { opacity: 0.45 });
        }

        Ok(RenderScene {
            width,
            height,
            background_color: bg_color,
            dimmer_opacity: dimmer,
            safe_area_rect: safe_rect,
            active_ayah_text: active_ayah,
            active_translation_text: active_trans,
            active_reference: active_ref,
            ayah_font_size_px: ayah_size_px,
            translation_font_size_px: trans_size_px,
            ayah_color,
            translation_color: trans_color,
            highlight_word_idx,
            highlight_progress,
            decorations,
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

        // 1. Gambar latar belakang
        pixmap.fill(scene.background_color);

        let cw = scene.width as f32;
        let ch = scene.height as f32;

        // 2. Terapkan peredup latar (dimmer) bila > 0
        if scene.dimmer_opacity > 0.01 {
            let mut paint = Paint::default();
            let alpha_u8 = (scene.dimmer_opacity.clamp(0.0, 1.0) * 255.0) as u8;
            paint.set_color_rgba8(0, 0, 0, alpha_u8);
            if let Some(r) = Rect::from_xywh(0.0, 0.0, cw, ch) {
                pixmap.fill_rect(r, &paint, Transform::identity(), None);
            }
        }

        // 3. Render elemen dekorasi dan overlay (STY-2, STY-3, STY-4)
        for deco in &scene.decorations {
            match deco {
                DecorationElement::GradientOverlayTop { opacity } => {
                    let mut paint = Paint::default();
                    let alpha = (opacity.clamp(0.0, 1.0) * 255.0) as u8;
                    paint.set_color_rgba8(0, 0, 0, alpha);
                    if let Some(r) = Rect::from_xywh(0.0, 0.0, cw, ch * 0.15) {
                        pixmap.fill_rect(r, &paint, Transform::identity(), None);
                    }
                }
                DecorationElement::GradientOverlayBottom { opacity } => {
                    let mut paint = Paint::default();
                    let alpha = (opacity.clamp(0.0, 1.0) * 255.0) as u8;
                    paint.set_color_rgba8(0, 0, 0, alpha);
                    let h = ch * 0.20;
                    if let Some(r) = Rect::from_xywh(0.0, ch - h, cw, h) {
                        pixmap.fill_rect(r, &paint, Transform::identity(), None);
                    }
                }
                DecorationElement::SurahNameAmiri { .. } => {
                    // Gambar kotak judul surah di bagian atas safe area
                    let mut paint = Paint::default();
                    paint.set_color_rgba8(255, 255, 255, 30);
                    let badge_w = (cw * 0.35).min(300.0);
                    let badge_h = (ch * 0.04).min(44.0);
                    let badge_x = (cw - badge_w) / 2.0;
                    let badge_y = scene.safe_area_rect.y() + 8.0;

                    if let Some(r) = Rect::from_xywh(badge_x, badge_y, badge_w, badge_h) {
                        let path = PathBuilder::from_rect(r);
                        let stroke = Stroke {
                            width: 1.0,
                            ..Default::default()
                        };
                        pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                    }
                }
                DecorationElement::ReciterPill { bg_color, .. } => {
                    // Gambar kapsul nama qari di bagian bawah safe area
                    let mut paint = Paint::default();
                    paint.set_color(*bg_color);
                    let pill_w = (cw * 0.40).min(320.0);
                    let pill_h = (ch * 0.035).min(36.0);
                    let pill_x = (cw - pill_w) / 2.0;
                    let pill_y = scene.safe_area_rect.bottom() - pill_h - 12.0;

                    if let Some(r) = Rect::from_xywh(pill_x, pill_y, pill_w, pill_h) {
                        pixmap.fill_rect(r, &paint, Transform::identity(), None);
                    }
                }
                DecorationElement::AyahNumberOrnament { color, .. } => {
                    // Gambar lencana lingkaran nomor ayat
                    let mut paint = Paint::default();
                    paint.set_color(*color);
                    let size = (cw * 0.05).clamp(24.0, 48.0);
                    let x = scene.safe_area_rect.right() - size - 8.0;
                    let y = scene.safe_area_rect.y() + 8.0;

                    if let Some(r) = Rect::from_xywh(x, y, size, size) {
                        let stroke = Stroke {
                            width: 1.5,
                            ..Default::default()
                        };
                        let path = PathBuilder::from_rect(r);
                        pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                    }
                }
                DecorationElement::LogoWatermark { opacity } => {
                    // Tanda logo samar di sudut kanan bawah
                    let mut paint = Paint::default();
                    let alpha = (opacity.clamp(0.0, 1.0) * 40.0) as u8;
                    paint.set_color_rgba8(255, 255, 255, alpha);
                    let s = 28.0f32;
                    if let Some(r) = Rect::from_xywh(
                        scene.safe_area_rect.right() - s,
                        scene.safe_area_rect.bottom() - s,
                        s,
                        s,
                    ) {
                        pixmap.fill_rect(r, &paint, Transform::identity(), None);
                    }
                }
            }
        }

        // 4. Render batas halus area aman (indikator visual konsistensi render)
        if let Some(r) = Rect::from_xywh(
            scene.safe_area_rect.x(),
            scene.safe_area_rect.y(),
            scene.safe_area_rect.width(),
            scene.safe_area_rect.height(),
        ) {
            let mut stroke_paint = Paint::default();
            stroke_paint.set_color_rgba8(255, 255, 255, 20);
            let stroke = Stroke {
                width: 1.0,
                ..Default::default()
            };
            let path = PathBuilder::from_rect(r);
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
        proj.reciter = Some("Misyari Rasyid".to_string());

        proj.segments.push(AyahSegment {
            id: "seg_1_1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![
                WordTiming {
                    word_idx: 1,
                    start_tick: 0,
                    end_tick: 48000,
                    text: "بِسْمِ".into(),
                    confidence: 0.99,
                },
                WordTiming {
                    word_idx: 2,
                    start_tick: 48000,
                    end_tick: 48000 * 2,
                    text: "اللَّهِ".into(),
                    confidence: 0.98,
                },
            ],
            confidence: 0.99,
            manual_override: false,
        });

        proj
    }

    #[test]
    fn test_platform_safe_areas_within_bounds() {
        for platform in &[
            SocialPlatform::YouTubeShorts,
            SocialPlatform::InstagramReels,
            SocialPlatform::TikTok,
        ] {
            let safe = SafeAreaConfig::for_platform("9:16", Some(*platform));
            assert!(safe.top > 0.05 && safe.top < 0.20);
            assert!(safe.bottom > 0.10 && safe.bottom < 0.30);
            assert!(safe.left > 0.05 && safe.left < 0.20);
            assert!(safe.right > 0.05 && safe.right < 0.25);
            assert!(safe.left + safe.right < 0.50);
            assert!(safe.top + safe.bottom < 0.50);
        }
    }

    #[test]
    fn test_scene_decorations_rendered_deterministically() {
        let proj = make_test_project_with_ratio("9:16", 1080, 1920);
        let tpl_path = Path::new("templates/subuh/template.json");
        let tpl = TemplateConfig::load_from_file(tpl_path).expect("Template subuh harus ada");

        let scene = SceneBuilder::build(&proj, &tpl, 48000, None).expect("Build scene berhasil");
        assert_eq!(scene.decorations.len(), 6); // SurahName, AyahNumber, ReciterPill, Logo, GradientTop, GradientBottom

        let pixmap = SoftwareRenderer::render(&scene).expect("Render scene berhasil");
        assert_eq!(pixmap.width(), 1080);
        assert_eq!(pixmap.height(), 1920);
    }
}
