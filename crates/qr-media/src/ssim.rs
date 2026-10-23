//! SSIM (Wang et al., 2004) murni Rust untuk uji kesetaraan preview–ekspor (A1-11, RND-1).
//!
//! Definisi persis yang dipakai:
//! - Kanal: luma `Y = 0,2126·R + 0,7152·G + 0,0722·B` (BT.709, dibulatkan ke 0..255) untuk `ssim_rgb`;
//!   `ssim_gray` menerima bidang 8-bit langsung.
//! - Jendela: seragam 8×8, langkah 1 piksel, hanya jendela yang seluruhnya di dalam gambar
//!   (`(w-7)·(h-7)` jendela). Rata-rata/varians/kovarians populasi (pembagi N = 64).
//! - Konstanta: `L = 255`, `K1 = 0,01`, `K2 = 0,03`, `C1 = (K1·L)²`, `C2 = (K2·L)²`.
//! - Per jendela: `((2·μx·μy + C1)(2·σxy + C2)) / ((μx² + μy² + C1)(σx² + σy² + C2))`.
//! - Skor gambar = rata-rata peta SSIM atas semua jendela (MSSIM).
//!
//! Jumlah jendela dihitung eksak dengan tabel integral bilangan bulat (u64), sehingga hasil tidak
//! bergantung pada urutan penjumlahan.

const WIN: usize = 8;
const C1: f64 = (0.01 * 255.0) * (0.01 * 255.0);
const C2: f64 = (0.03 * 255.0) * (0.03 * 255.0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SsimError {
    /// Panjang buffer tidak sama dengan `lebar × tinggi × kanal`.
    SizeMismatch,
    /// Lebar atau tinggi lebih kecil dari jendela 8×8.
    TooSmall,
}

impl std::fmt::Display for SsimError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SsimError::SizeMismatch => f.write_str("ukuran buffer tidak cocok dengan dimensi"),
            SsimError::TooSmall => f.write_str("gambar lebih kecil dari jendela SSIM 8x8"),
        }
    }
}

impl std::error::Error for SsimError {}

/// Luma BT.709 dari buffer interleaved dengan `channels` ≥ 3 kanal (RGB24 = 3, RGBA = 4).
pub fn luma_bt709(pixels: &[u8], channels: usize) -> Vec<u8> {
    pixels
        .chunks_exact(channels)
        .map(|p| {
            let y = 0.2126 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.0722 * f64::from(p[2]);
            y.round().clamp(0.0, 255.0) as u8
        })
        .collect()
}

/// Tabel integral berukuran `(w+1)·(h+1)` untuk nilai `f(i)` per piksel.
fn integral(w: usize, h: usize, f: impl Fn(usize) -> u64) -> Vec<u64> {
    let stride = w + 1;
    let mut t = vec![0u64; stride * (h + 1)];
    for y in 0..h {
        let mut row = 0u64;
        for x in 0..w {
            row += f(y * w + x);
            t[(y + 1) * stride + x + 1] = t[y * stride + x + 1] + row;
        }
    }
    t
}

fn window_sum(t: &[u64], stride: usize, x: usize, y: usize) -> u64 {
    t[(y + WIN) * stride + x + WIN] + t[y * stride + x]
        - t[y * stride + x + WIN]
        - t[(y + WIN) * stride + x]
}

/// MSSIM antara dua bidang 8-bit berukuran `width × height`. 1,0 = identik.
pub fn ssim_gray(a: &[u8], b: &[u8], width: usize, height: usize) -> Result<f64, SsimError> {
    if a.len() != width * height || b.len() != width * height {
        return Err(SsimError::SizeMismatch);
    }
    if width < WIN || height < WIN {
        return Err(SsimError::TooSmall);
    }
    let stride = width + 1;
    let ta = integral(width, height, |i| u64::from(a[i]));
    let tb = integral(width, height, |i| u64::from(b[i]));
    let taa = integral(width, height, |i| u64::from(a[i]) * u64::from(a[i]));
    let tbb = integral(width, height, |i| u64::from(b[i]) * u64::from(b[i]));
    let tab = integral(width, height, |i| u64::from(a[i]) * u64::from(b[i]));
    let n = (WIN * WIN) as f64;
    let mut total = 0.0f64;
    for y in 0..=height - WIN {
        for x in 0..=width - WIN {
            let sa = window_sum(&ta, stride, x, y) as f64;
            let sb = window_sum(&tb, stride, x, y) as f64;
            let saa = window_sum(&taa, stride, x, y) as f64;
            let sbb = window_sum(&tbb, stride, x, y) as f64;
            let sab = window_sum(&tab, stride, x, y) as f64;
            let (ma, mb) = (sa / n, sb / n);
            let va = (saa - sa * sa / n) / n;
            let vb = (sbb - sb * sb / n) / n;
            let cov = (sab - sa * sb / n) / n;
            total += ((2.0 * ma * mb + C1) * (2.0 * cov + C2))
                / ((ma * ma + mb * mb + C1) * (va + vb + C2));
        }
    }
    Ok(total / ((width - WIN + 1) * (height - WIN + 1)) as f64)
}

/// MSSIM pada luma BT.709 dari dua gambar interleaved dengan `channels` kanal (3 = RGB, 4 = RGBA).
pub fn ssim_rgb(
    a: &[u8],
    b: &[u8],
    width: usize,
    height: usize,
    channels: usize,
) -> Result<f64, SsimError> {
    if channels < 3 || a.len() != width * height * channels || b.len() != a.len() {
        return Err(SsimError::SizeMismatch);
    }
    ssim_gray(
        &luma_bt709(a, channels),
        &luma_bt709(b, channels),
        width,
        height,
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// Gambar sintetis berpola (gradien + blok) agar varians tidak nol.
    fn pattern(w: usize, h: usize) -> Vec<u8> {
        (0..w * h)
            .map(|i| {
                let (x, y) = (i % w, i / w);
                if (x / 8 + y / 8) % 2 == 0 {
                    ((x * 3 + y * 2) % 200) as u8 + 30
                } else {
                    40
                }
            })
            .collect()
    }

    #[test]
    fn identical_is_exactly_one() {
        let a = pattern(64, 48);
        assert_eq!(ssim_gray(&a, &a, 64, 48).unwrap(), 1.0);
    }

    #[test]
    fn noise_lowers_score_monotonically() {
        let a = pattern(64, 48);
        let noisy = |amp: i32| -> Vec<u8> {
            let mut s = 12345u32;
            a.iter()
                .map(|&v| {
                    s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    let n = ((s >> 24) as i32 % (2 * amp + 1)) - amp;
                    (i32::from(v) + n).clamp(0, 255) as u8
                })
                .collect()
        };
        let low = ssim_gray(&a, &noisy(4), 64, 48).unwrap();
        let high = ssim_gray(&a, &noisy(40), 64, 48).unwrap();
        assert!(low < 1.0 && high < low, "low={low} high={high}");
        assert!(high < 0.9, "{high}");
    }

    #[test]
    fn shift_lowers_score() {
        let (w, h) = (64, 48);
        let a = pattern(w, h);
        let shifted: Vec<u8> = (0..w * h)
            .map(|i| a[(i / w) * w + ((i % w) + 3).min(w - 1)])
            .collect();
        let s = ssim_gray(&a, &shifted, w, h).unwrap();
        assert!(s < 0.9, "{s}");
    }

    #[test]
    fn constant_images_with_different_means_match_formula() {
        // σ = 0: SSIM = (2·μx·μy + C1) / (μx² + μy² + C1).
        let (a, b) = (vec![100u8; 16 * 16], vec![150u8; 16 * 16]);
        let expect = (2.0 * 100.0 * 150.0 + C1) / (100.0 * 100.0 + 150.0 * 150.0 + C1);
        let got = ssim_gray(&a, &b, 16, 16).unwrap();
        assert!((got - expect).abs() < 1e-12, "{got} vs {expect}");
    }

    #[test]
    fn rgb_wrapper_and_errors() {
        let rgb: Vec<u8> = (0..16 * 16 * 3).map(|i| (i % 251) as u8).collect();
        assert_eq!(ssim_rgb(&rgb, &rgb, 16, 16, 3).unwrap(), 1.0);
        assert_eq!(
            ssim_gray(&[0; 10], &[0; 10], 4, 4),
            Err(SsimError::SizeMismatch)
        );
        assert_eq!(
            ssim_gray(&[0; 16], &[0; 16], 4, 4),
            Err(SsimError::TooSmall)
        );
    }
}
