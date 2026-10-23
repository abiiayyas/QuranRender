//! Visual merge dan anti-collision dasar pada layout teks dan dekorasi (PRD TML-4, B2-06).
//! Mengacu ke docs/product/PRD.md §7 TML-4 dan docs/design/05_VIDEO_TEMPLATES.md §2.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LayoutBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl LayoutBox {
    pub fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn top(&self) -> f32 {
        self.y
    }

    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }

    pub fn intersects(&self, other: &LayoutBox) -> bool {
        self.x < other.x + other.width
            && self.x + self.width > other.x
            && self.y < other.y + other.height
            && self.y + self.height > other.y
    }
}

/// Menghitung penyesuaian posisi vertikal agar dua kotak elemen tidak bertabrakan (anti-collision).
pub fn resolve_vertical_collision(
    upper: &LayoutBox,
    lower: &mut LayoutBox,
    min_gap: f32,
    safe_bottom: f32,
) -> bool {
    if upper.intersects(lower) || lower.top() < upper.bottom() + min_gap {
        let new_y = upper.bottom() + min_gap;
        if new_y + lower.height <= safe_bottom {
            lower.y = new_y;
            return true;
        }
    }
    false
}

/// Menghitung faktor skala auto-fit agar teks ayat panjang tetap muat dalam area aman (PRD STY-8).
pub fn calculate_autofit_scale(required_height: f32, available_height: f32, min_scale: f32) -> f32 {
    if required_height <= available_height || required_height <= 0.0 {
        return 1.0;
    }

    let scale = available_height / required_height;
    scale.clamp(min_scale, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collision_detection_and_resolution() {
        let title_box = LayoutBox::new(100.0, 50.0, 200.0, 40.0);
        let mut verse_box = LayoutBox::new(100.0, 70.0, 300.0, 150.0); // Tabrakan dengan title_box

        assert!(title_box.intersects(&verse_box));

        let resolved = resolve_vertical_collision(&title_box, &mut verse_box, 16.0, 800.0);
        assert!(resolved);
        assert!(!title_box.intersects(&verse_box));
        assert_eq!(verse_box.top(), title_box.bottom() + 16.0);
    }

    #[test]
    fn test_autofit_scale_bounded() {
        assert_eq!(calculate_autofit_scale(200.0, 400.0, 0.65), 1.0);
        assert_eq!(calculate_autofit_scale(400.0, 200.0, 0.65), 0.65); // Ter-clamp di min_scale
        assert_eq!(calculate_autofit_scale(300.0, 240.0, 0.65), 0.80);
    }
}
