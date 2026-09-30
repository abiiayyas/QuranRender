use serde::{Deserialize, Serialize};

pub mod normalization;
pub mod sidecar;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentRequest {
    pub audio_path: String,
    pub surah: u32,
    pub ayahs: Vec<u32>,
    pub texts: Vec<String>, // Arabic text of the ayahs for forced alignment
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordTiming {
    pub word: String,
    pub start_ms: u32,
    pub end_ms: u32,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AyahSegment {
    pub surah: u32,
    pub ayah: u32,
    pub text: String,
    pub start_ms: u32,
    pub end_ms: u32,
    pub words: Vec<WordTiming>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentationResult {
    pub success: bool,
    pub error_message: Option<String>,
    pub total_duration_ms: u32,
    pub ayahs: Vec<AyahSegment>,
}
