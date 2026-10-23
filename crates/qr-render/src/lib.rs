//! Render scene -> frame: layout, shaping, animasi, wgpu/vello, fallback CPU (tiny-skia), subtitle, template, font, collision.
//! Mengacu ke PRD RND-1..5, STY-1..8, ANM-1..3, EXP-4 dan docs/design/05_VIDEO_TEMPLATES.md.

pub mod anim;
pub mod collision;
pub mod font;
pub mod scene;
pub mod subtitle;
pub mod template;

pub use anim::{
    calculate_slide_y_offset, calculate_transition_alpha, evaluate_verse_karaoke, HighlightStyle,
    InOutAnimation, WordKaraokeState,
};
pub use collision::{calculate_autofit_scale, resolve_vertical_collision, LayoutBox};
pub use font::{FontCoverageValidator, FontGlyphReport};
pub use scene::{
    DecorationElement, RenderError, RenderScene, SafeAreaConfig, SceneBuilder, SocialPlatform,
    SoftwareRenderer, TemplateConfig,
};
pub use subtitle::{
    export_subtitles, generate_ass, generate_srt, generate_vtt, SubtitleCue, SubtitleExportOptions,
    SubtitleFormat, SubtitleTrackSelection,
};
pub use template::{
    check_template_fonts_availability, list_builtin_templates, MissingFontReport, TemplatePackage,
};
