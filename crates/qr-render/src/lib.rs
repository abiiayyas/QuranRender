//! Render scene → frame: shaping (harfrust), tata letak, animasi, perender CPU (tiny-skia),
//! subtitle, template `.qrtemplate`, validasi font.
//!
//! Satu jalur render untuk preview dan ekspor (PRD RND-1). Backend GPU (wgpu/vello) belum ada —
//! lihat `docs/engineering/05_AUDIT_FASE_0_2.md`.

pub mod anim;
pub mod collision;
pub mod font;
pub mod scene;
pub mod subtitle;
pub mod template;
pub mod text;

pub use anim::{
    calculate_slide_y_offset, calculate_transition_alpha, ease, evaluate_verse_karaoke,
    template_transition_alpha, HighlightStyle, InOutAnimation, WordKaraokeState,
};
pub use collision::{calculate_autofit_scale, resolve_vertical_collision, LayoutBox};
pub use font::{FontCoverageValidator, FontGlyphReport};
pub use scene::{
    parse_color, pixmap_digest, FontSet, Primitive, QuranDbVerses, RenderError, RenderScene,
    SceneBuilder, SoftwareRenderer, VerseContent, VerseSource,
};
pub use subtitle::{
    export_subtitles, generate_ass, generate_srt, generate_vtt, SubtitleCue, SubtitleExportOptions,
    SubtitleFormat, SubtitleTrackSelection,
};
pub use template::{
    check_template_fonts_availability, export_qrtemplate_zip, import_qrtemplate,
    list_builtin_templates, load_builtin_template, Layer, LayerKind, MissingFontReport, SafeArea,
    TemplateDoc,
};
pub use text::{
    fit_text, layout_words, suggest_word_ranges, words_of_ayah, FontFace, ShapedGlyph,
    TextDirection,
};
