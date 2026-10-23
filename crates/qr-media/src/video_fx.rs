//! Efek pemutaran video latar (loop, reverse, speed, blur) dan transformasi klip overlay / PiP (PRD TML-2, SRC-5, B2-07, B2-08).
//! Mengacu ke docs/product/PRD.md §7 TML-2, SRC-5 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.2.

use serde::{Deserialize, Serialize};

/// Efek pemutaran untuk klip video latar (PRD SRC-5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoPlaybackFx {
    pub is_loop: bool,
    pub is_reverse: bool,
    pub speed: f32,       // 0.25x s/d 4.0x
    pub blur_radius: f32, // 0.0 s/d 100.0
}

impl Default for VideoPlaybackFx {
    fn default() -> Self {
        Self {
            is_loop: true,
            is_reverse: false,
            speed: 1.0,
            blur_radius: 0.0,
        }
    }
}

/// Transformasi dan penempatan klip overlay / Picture-in-Picture (PRD TML-2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OverlayTransform {
    pub x: f32, // Posisi X ternormalisasi (0.0..1.0)
    pub y: f32, // Posisi Y ternormalisasi (0.0..1.0)
    pub width: f32,
    pub height: f32,
    pub opacity: f32, // 0.0 s/d 1.0
    pub corner_radius_px: f32,
    pub is_pip: bool,
}

impl Default for OverlayTransform {
    fn default() -> Self {
        Self {
            x: 0.05,
            y: 0.05,
            width: 0.30,
            height: 0.30,
            opacity: 1.0,
            corner_radius_px: 12.0,
            is_pip: false,
        }
    }
}

/// Menghitung posisi tick sumber audio/video berdasarkan kecepatan, pembalikan (reverse), dan perulangan (loop).
pub fn map_timeline_to_source_tick(
    current_tick: i64,
    clip_start_tick: i64,
    trim_in_tick: i64,
    trim_out_tick: i64,
    fx: &VideoPlaybackFx,
) -> i64 {
    let source_duration = (trim_out_tick - trim_in_tick).max(1);
    let elapsed_timeline = (current_tick - clip_start_tick).max(0);

    // Terapkan faktor kecepatan (speed)
    let speed = fx.speed.clamp(0.25, 4.0);
    let scaled_elapsed = (elapsed_timeline as f64 * speed as f64) as i64;

    let source_offset = if fx.is_loop {
        scaled_elapsed % source_duration
    } else {
        scaled_elapsed.min(source_duration)
    };

    if fx.is_reverse {
        trim_out_tick - source_offset
    } else {
        trim_in_tick + source_offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_playback_tick_mapping() {
        let fx = VideoPlaybackFx {
            is_loop: false,
            is_reverse: false,
            speed: 1.0,
            blur_radius: 0.0,
        };

        // Clip start di tick 100, trim in 0, trim out 500
        assert_eq!(map_timeline_to_source_tick(100, 100, 0, 500, &fx), 0);
        assert_eq!(map_timeline_to_source_tick(250, 100, 0, 500, &fx), 150);
        assert_eq!(map_timeline_to_source_tick(700, 100, 0, 500, &fx), 500); // Ter-clamp di trim_out
    }

    #[test]
    fn test_reverse_playback_tick_mapping() {
        let fx = VideoPlaybackFx {
            is_loop: false,
            is_reverse: true,
            speed: 1.0,
            blur_radius: 0.0,
        };

        // Mulai dari trim_out (500) dan mundur ke 0
        assert_eq!(map_timeline_to_source_tick(100, 100, 0, 500, &fx), 500);
        assert_eq!(map_timeline_to_source_tick(250, 100, 0, 500, &fx), 350);
        assert_eq!(map_timeline_to_source_tick(600, 100, 0, 500, &fx), 0);
    }

    #[test]
    fn test_looping_playback_tick_mapping() {
        let fx = VideoPlaybackFx {
            is_loop: true,
            is_reverse: false,
            speed: 1.0,
            blur_radius: 0.0,
        };

        // Durasi sumber 100 tick (0..100)
        assert_eq!(map_timeline_to_source_tick(50, 0, 0, 100, &fx), 50);
        assert_eq!(map_timeline_to_source_tick(150, 0, 0, 100, &fx), 50); // Loop kedua
        assert_eq!(map_timeline_to_source_tick(250, 0, 0, 100, &fx), 50); // Loop ketiga
    }

    #[test]
    fn test_double_speed_playback_tick_mapping() {
        let fx = VideoPlaybackFx {
            is_loop: false,
            is_reverse: false,
            speed: 2.0,
            blur_radius: 0.0,
        };

        // Kecepatan 2x: 50 tick timeline memajukan 100 tick sumber
        assert_eq!(map_timeline_to_source_tick(50, 0, 0, 1000, &fx), 100);
    }
}
