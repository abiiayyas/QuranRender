use super::SegmentationResult;

pub fn normalize_segmentation(mut result: SegmentationResult) -> SegmentationResult {
    // Normalization logic:
    // If the audio starts with Basmala but the text doesn't,
    // the aligner might have hallucinated words or mapped them.
    // In our MVP, we pass it through. A robust implementation
    // would filter out words that don't match the Arabic input.
    
    if let Some(first_ayah) = result.ayahs.first() {
        if first_ayah.start_ms > 5000 {
            // There's a 5+ second gap before the first ayah.
            // This might be silence or Basmala/Isti'adha.
        }
    }
    
    result
}
