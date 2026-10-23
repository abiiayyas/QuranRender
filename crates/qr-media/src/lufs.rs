//! Pengukuran loudness terintegrasi EBU R128 (LUFS) dan normalisasi gain statis (PRD SRC-2).
//! Mengacu ke ITU-R BS.1770-4 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.2.

/// Parameter filter K-weighting standar ITU-R BS.1770 pada sample rate 48.000 Hz.
struct KWeightingFilter {
    // Stage 1: High shelf filter
    b1_0: f64,
    b1_1: f64,
    b1_2: f64,
    a1_1: f64,
    a1_2: f64,
    x1_1: f64,
    x1_2: f64,
    y1_1: f64,
    y1_2: f64,

    // Stage 2: High pass (RLB weighting)
    b2_0: f64,
    b2_1: f64,
    b2_2: f64,
    a2_1: f64,
    a2_2: f64,
    x2_1: f64,
    x2_2: f64,
    y2_1: f64,
    y2_2: f64,
}

impl KWeightingFilter {
    pub fn new_48k() -> Self {
        // Koefisien resmi ITU-R BS.1770 pada fs = 48 kHz
        Self {
            b1_0: 1.53512485958697,
            b1_1: -2.69169618940638,
            b1_2: 1.19839281085285,
            a1_1: -1.69065929318241,
            a1_2: 0.73248077421585,
            x1_1: 0.0,
            x1_2: 0.0,
            y1_1: 0.0,
            y1_2: 0.0,

            b2_0: 1.0,
            b2_1: -2.0,
            b2_2: 1.0,
            a2_1: -1.99004745483398,
            a2_2: 0.99007225036621,
            x2_1: 0.0,
            x2_2: 0.0,
            y2_1: 0.0,
            y2_2: 0.0,
        }
    }

    pub fn process_sample(&mut self, x: f64) -> f64 {
        // Stage 1
        let y1 = self.b1_0 * x + self.b1_1 * self.x1_1 + self.b1_2 * self.x1_2
            - self.a1_1 * self.y1_1
            - self.a1_2 * self.y1_2;
        self.x1_2 = self.x1_1;
        self.x1_1 = x;
        self.y1_2 = self.y1_1;
        self.y1_1 = y1;

        // Stage 2
        let y2 = self.b2_0 * y1 + self.b2_1 * self.x2_1 + self.b2_2 * self.x2_2
            - self.a2_1 * self.y2_1
            - self.a2_2 * self.y2_2;
        self.x2_2 = self.x2_1;
        self.x2_1 = y1;
        self.y2_2 = self.y2_1;
        self.y2_1 = y2;

        y2
    }
}

/// Mengukur loudness terintegrasi (LUFS) dari audio float interleaved (48 kHz) sesuai EBU R128 / ITU-R BS.1770.
pub fn measure_integrated_lufs(interleaved_samples: &[f32], channels: usize) -> f32 {
    if interleaved_samples.is_empty() || channels == 0 {
        return -70.0;
    }

    let total_frames = interleaved_samples.len() / channels;
    let fs = 48000;
    // Ukuran blok gating 400 ms dengan 75% overlap (loncat 100 ms)
    let block_size = (fs as f64 * 0.400) as usize; // 19.200 frame
    let step_size = (fs as f64 * 0.100) as usize; // 4.800 frame

    if total_frames < block_size {
        // Bila durasi lebih pendek dari 400 ms, ukur RMS sederhana
        let mut sum_sq = 0.0f64;
        for &s in interleaved_samples {
            sum_sq += (s as f64) * (s as f64);
        }
        let mean = sum_sq / (interleaved_samples.len() as f64);
        if mean <= 1e-12 {
            return -70.0;
        }
        return (-0.691 + 10.0 * mean.log10()) as f32;
    }

    // Filter K-weighting per channel
    let mut filtered_channels: Vec<Vec<f64>> = (0..channels)
        .map(|_| Vec::with_capacity(total_frames))
        .collect();

    for ch in 0..channels {
        let mut filter = KWeightingFilter::new_48k();
        for frame_idx in 0..total_frames {
            let sample = interleaved_samples[frame_idx * channels + ch] as f64;
            let filtered = filter.process_sample(sample);
            filtered_channels[ch].push(filtered);
        }
    }

    // Hitung energi blok z_j
    let mut block_loudness: Vec<f64> = Vec::new();
    let num_blocks = (total_frames - block_size) / step_size + 1;

    for b in 0..num_blocks {
        let start = b * step_size;
        let end = start + block_size;

        let mut block_energy = 0.0f64;
        for (ch, channel_samples) in filtered_channels.iter().enumerate().take(channels) {
            let mut sum_sq = 0.0f64;
            for &s in &channel_samples[start..end] {
                sum_sq += s * s;
            }
            let z_i = sum_sq / (block_size as f64);
            // Bobot channel (L=1.0, R=1.0, C=1.0, LFE=0.0, Ls=1.41, Rs=1.41)
            let g_i = if ch >= 2 { 1.41 } else { 1.0 };
            block_energy += g_i * z_i;
        }

        let l_j = -0.691 + 10.0 * block_energy.max(1e-12).log10();
        block_loudness.push(l_j);
    }

    // Gating Tahap 1: Ambang absolut (-70.0 LKFS)
    let above_abs: Vec<f64> = block_loudness.into_iter().filter(|&l| l > -70.0).collect();

    if above_abs.is_empty() {
        return -70.0;
    }

    // Hitung rata-rata di atas ambang absolut untuk mencari ambang relatif
    let mut sum_power = 0.0f64;
    for &l in &above_abs {
        sum_power += 10.0f64.powf((l + 0.691) / 10.0);
    }
    let mean_above_abs = -0.691 + 10.0 * (sum_power / (above_abs.len() as f64)).log10();
    let relative_threshold = mean_above_abs - 10.0;

    // Gating Tahap 2: Ambang relatif
    let mut final_sum_power = 0.0f64;
    let mut final_count = 0;
    for &l in &above_abs {
        if l > relative_threshold {
            final_sum_power += 10.0f64.powf((l + 0.691) / 10.0);
            final_count += 1;
        }
    }

    if final_count == 0 {
        return -70.0;
    }

    let integrated_lufs = -0.691 + 10.0 * (final_sum_power / (final_count as f64)).log10();
    integrated_lufs as f32
}

/// Menghitung gain normalisasi statis (dalam dB) agar audio mencapai target LUFS.
/// Maksimal penguatan dibatasi oleh `max_gain_db` (default: +12.0 dB per PRD SRC-2).
pub fn calculate_normalization_gain(current_lufs: f32, target_lufs: f32, max_gain_db: f32) -> f32 {
    if current_lufs <= -69.0 {
        return 0.0; // Keheningan tidak diberi gain
    }

    let needed_gain = target_lufs - current_lufs;
    // Batasi penguatan maksimum hingga +12.0 dB, reduksi tidak dibatasi
    if needed_gain > max_gain_db {
        max_gain_db
    } else {
        needed_gain
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_silence_lufs() {
        let silence = vec![0.0f32; 96000]; // 2 detik hening
        let lufs = measure_integrated_lufs(&silence, 2);
        assert!(lufs <= -69.0);
    }

    #[test]
    fn test_sine_wave_lufs_and_gain_calculation() {
        // Buat sinyal sinus 1 kHz pada 48 kHz stereo 2 detik
        let mut samples = Vec::new();
        let fs = 48000.0f32;
        let freq = 1000.0f32;
        for i in 0..96000 {
            let t = (i as f32) / fs;
            let val = (2.0 * std::f32::consts::PI * freq * t).sin() * 0.5; // -6 dBFS
            samples.push(val);
        }

        let lufs = measure_integrated_lufs(&samples, 2);
        println!("Sine wave 1kHz LUFS: {}", lufs);

        // Sinus 0.5 amplitudo memiliki LUFS sekitar -6 s.d. -9 LUFS
        assert!(lufs > -15.0 && lufs < -3.0);

        // Uji normalisasi ke YouTube (-16 LUFS)
        let gain_yt = calculate_normalization_gain(lufs, -16.0, 12.0);
        assert!((lufs + gain_yt - (-16.0)).abs() < 0.1);

        // Uji batas maksimum gain +12 dB (PRD SRC-2)
        let extreme_quiet_lufs = -35.0f32;
        let gain_clamped = calculate_normalization_gain(extreme_quiet_lufs, -14.0, 12.0);
        assert_eq!(gain_clamped, 12.0, "Gain harus dibatasi maksimum +12 dB");
    }
}
