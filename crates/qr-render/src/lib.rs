//! Render scene -> frame: layout, shaping, animasi, wgpu/vello, fallback CPU (tiny-skia), subtitle.
//! Mengacu ke PRD RND-1..5, STY-1..8, ANM-1..3, EXP-4 dan docs/design/05_VIDEO_TEMPLATES.md.

pub mod scene;
pub mod subtitle;

pub use scene::{RenderError, RenderScene, SceneBuilder, SoftwareRenderer, TemplateConfig};
pub use subtitle::{
    export_subtitles, generate_ass, generate_srt, generate_vtt, SubtitleCue, SubtitleExportOptions,
    SubtitleFormat, SubtitleTrackSelection,
};
