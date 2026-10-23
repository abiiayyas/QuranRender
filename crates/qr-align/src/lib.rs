//! VAD, model akustik ONNX, identifikasi ayat, forced alignment.

#[derive(Debug, Clone)]
pub struct AlignmentConfig {
    pub sample_rate: u32,
}
