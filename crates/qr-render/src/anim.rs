//! Animasi masuk/keluar, transisi, dan karaoke per kata kontinu (PRD ANM-1..3, B2-05).
//! Mengacu ke docs/product/PRD.md §7 ANM-1..3 dan docs/design/05_VIDEO_TEMPLATES.md §2.

use qr_core::project::WordTiming;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InOutAnimation {
    None,
    Fade,
    SlideUp,
    ScaleUp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HighlightStyle {
    SmoothFade,
    WordPill,
    Underline,
}

/// Menghitung faktor transisi masuk/keluar (0.0 = tak tampak, 1.0 = penuh) secara deterministik dari tick audio.
pub fn calculate_transition_alpha(
    current_tick: i64,
    seg_start: i64,
    seg_end: i64,
    trans_duration_ticks: i64,
) -> f32 {
    if current_tick < seg_start || current_tick > seg_end {
        return 0.0;
    }

    let dur = trans_duration_ticks.max(1);

    // Animasi masuk (Fade In)
    if current_tick - seg_start < dur {
        let elapsed = current_tick - seg_start;
        return (elapsed as f32 / dur as f32).clamp(0.0, 1.0);
    }

    // Animasi keluar (Fade Out)
    if seg_end - current_tick < dur {
        let remaining = seg_end - current_tick;
        return (remaining as f32 / dur as f32).clamp(0.0, 1.0);
    }

    1.0
}

/// Menghitung pergeseran posisi Y untuk transisi geser (Slide Up).
pub fn calculate_slide_y_offset(
    current_tick: i64,
    seg_start: i64,
    trans_duration_ticks: i64,
    max_offset_px: f32,
) -> f32 {
    let dur = trans_duration_ticks.max(1);
    if current_tick - seg_start < dur {
        let progress = (current_tick - seg_start) as f32 / dur as f32;
        // Bergerak dari +max_offset ke 0
        return max_offset_px * (1.0 - progress.clamp(0.0, 1.0));
    }
    0.0
}

/// Status sorotan karaoke kata pada tick tertentu.
#[derive(Debug, Clone, PartialEq)]
pub struct WordKaraokeState {
    pub word_idx: u32,
    pub is_active: bool,
    pub progress: f32, // 0.0 (baru mulai) sampai 1.0 (selesai diucapkan)
}

/// Menghitung status karaoke kontinu untuk setiap kata dalam ayat (PRD ANM-2).
pub fn evaluate_verse_karaoke(
    word_timings: &[WordTiming],
    current_tick: i64,
) -> Vec<WordKaraokeState> {
    word_timings
        .iter()
        .map(|wt| {
            let is_active = current_tick >= wt.start_tick && current_tick <= wt.end_tick;
            let progress = if current_tick < wt.start_tick {
                0.0
            } else if current_tick > wt.end_tick {
                1.0
            } else {
                let span = (wt.end_tick - wt.start_tick).max(1) as f32;
                ((current_tick - wt.start_tick) as f32 / span).clamp(0.0, 1.0)
            };

            WordKaraokeState {
                word_idx: wt.word_idx,
                is_active,
                progress,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transition_alpha_curve() {
        let start = 0;
        let end = 48000 * 5; // 5 detik
        let trans = 48000 / 2; // 0.5 detik

        assert_eq!(calculate_transition_alpha(-10, start, end, trans), 0.0);
        assert_eq!(calculate_transition_alpha(0, start, end, trans), 0.0);
        assert_eq!(
            calculate_transition_alpha(trans / 2, start, end, trans),
            0.5
        );
        assert_eq!(calculate_transition_alpha(trans, start, end, trans), 1.0);
        assert_eq!(
            calculate_transition_alpha(48000 * 2, start, end, trans),
            1.0
        );
        assert_eq!(
            calculate_transition_alpha(end - trans / 2, start, end, trans),
            0.5
        );
        assert_eq!(calculate_transition_alpha(end, start, end, trans), 0.0);
    }

    #[test]
    fn test_karaoke_progress_continuous() {
        let timings = vec![
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
                confidence: 0.99,
            },
        ];

        let state_mid_first = evaluate_verse_karaoke(&timings, 24000);
        assert!(state_mid_first[0].is_active);
        assert_eq!(state_mid_first[0].progress, 0.5);
        assert!(!state_mid_first[1].is_active);
        assert_eq!(state_mid_first[1].progress, 0.0);

        let state_mid_second = evaluate_verse_karaoke(&timings, 48000 + 24000);
        assert!(!state_mid_second[0].is_active);
        assert_eq!(state_mid_second[0].progress, 1.0);
        assert!(state_mid_second[1].is_active);
        assert_eq!(state_mid_second[1].progress, 0.5);
    }
}
