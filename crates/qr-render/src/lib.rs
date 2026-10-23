//! Render scene -> frame: layout, shaping, animasi, wgpu/vello, fallback CPU.

#[derive(Debug, Clone)]
pub struct RenderScene {
    pub width: u32,
    pub height: u32,
}
