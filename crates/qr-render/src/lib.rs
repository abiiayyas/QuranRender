//! Render scene -> frame: layout, shaping, animasi, wgpu/vello, fallback CPU (tiny-skia).
//! Mengacu ke PRD RND-1..5, STY-1..8, ANM-1..3 dan docs/design/05_VIDEO_TEMPLATES.md.

pub mod scene;

pub use scene::{RenderError, RenderScene, SceneBuilder, SoftwareRenderer, TemplateConfig};
