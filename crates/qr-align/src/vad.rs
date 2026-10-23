//! Voice Activity Detection (VAD) berbasis energi RMS dan zero-crossing (PRD SYN-1).
//! Mengelompokkan sinyal audio menjadi segmen bicara (speech) dan hening (silence).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub sample_rate: u32,
    pub frame_size_ms: u32,
    pub energy_threshold: f32,
    pub min_speech_ms: u32,
    pub min_silence_ms: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            frame_size_ms: 30,
            energy_threshold: 0.015,
            min_speech_ms: 250,
            min_silence_ms: 300,
        }
    }
}

/// Rentang audio bicara dalam satuan sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpeechRegion {
    pub start_sample: usize,
    pub end_sample: usize,
}

/// Mendeteksi segmen bicara (speech) dari sampel audio mono PCM f32.
pub fn detect_speech_regions(samples: &[f32], config: &VadConfig) -> Vec<SpeechRegion> {
    if samples.is_empty() {
        return Vec::new();
    }

    let frame_samples = (config.sample_rate as usize * config.frame_size_ms as usize) / 1000;
    if frame_samples == 0 {
        return Vec::new();
    }

    let min_speech_samples = (config.sample_rate as usize * config.min_speech_ms as usize) / 1000;
    let min_silence_samples = (config.sample_rate as usize * config.min_silence_ms as usize) / 1000;

    let mut speech_frames: Vec<bool> = Vec::new();
    for chunk in samples.chunks(frame_samples) {
        let sum_sq: f32 = chunk.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / chunk.len() as f32).sqrt();
        speech_frames.push(rms >= config.energy_threshold);
    }

    // Gabungkan frame bicara menjadi rentang
    let mut regions = Vec::new();
    let mut in_speech = false;
    let mut speech_start = 0;
    let mut silence_start = 0;

    for (i, &is_speech) in speech_frames.iter().enumerate() {
        let sample_pos = i * frame_samples;

        if is_speech {
            if !in_speech {
                in_speech = true;
                speech_start = sample_pos;
            }
        } else if in_speech {
            // Cek apakah hening sudah melampaui min_silence_samples
            if silence_start == 0 {
                silence_start = sample_pos;
            } else if sample_pos - silence_start >= min_silence_samples {
                let speech_end = silence_start;
                if speech_end - speech_start >= min_speech_samples {
                    regions.push(SpeechRegion {
                        start_sample: speech_start,
                        end_sample: speech_end.min(samples.len()),
                    });
                }
                in_speech = false;
                silence_start = 0;
            }
        }
    }

    // Handle rentang terakhir jika audio berakhir saat masih bicara
    if in_speech {
        let speech_end = samples.len();
        if speech_end - speech_start >= min_speech_samples {
            regions.push(SpeechRegion {
                start_sample: speech_start,
                end_sample: speech_end,
            });
        }
    }

    regions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vad_detects_speech_burst_between_silence() {
        let config = VadConfig {
            sample_rate: 48000,
            frame_size_ms: 10,
            energy_threshold: 0.05,
            min_speech_ms: 100,
            min_silence_ms: 100,
        };

        // Buat 1 detik hening, 0.5 detik bicara (sinus), 1 detik hening
        let mut samples = vec![0.0f32; 48000 * 3];
        let speech_start = 48000;
        let speech_end = 48000 + 24000;
        for (i, sample) in samples
            .iter_mut()
            .enumerate()
            .take(speech_end)
            .skip(speech_start)
        {
            *sample = (i as f32 * 0.1).sin() * 0.5;
        }

        let regions = detect_speech_regions(&samples, &config);
        assert_eq!(regions.len(), 1, "Harus mendeteksi tepat 1 region bicara");
        let reg = regions[0];

        // Toleransi rentang sekitar 50ms
        let tol = 48000 / 20;
        assert!(
            (reg.start_sample as i64 - speech_start as i64).abs() < tol as i64,
            "Start sample {} harus mendekati {}",
            reg.start_sample,
            speech_start
        );
        assert!(
            (reg.end_sample as i64 - speech_end as i64).abs() < tol as i64,
            "End sample {} harus mendekati {}",
            reg.end_sample,
            speech_end
        );
    }
}
