//! Perhitungan waveform audio bertahap dan cache biner (PRD SRC-1).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.2 dan 04_IMPLEMENTATION_PLAN.md A1-04.

use serde::{Deserialize, Serialize};

/// Titik puncak amplitudo (min dan max) untuk visualisasi waveform di timeline.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WaveformPeak {
    pub min: f32,
    pub max: f32,
}

/// Menghitung data puncak waveform dari buffer PCM audio float (48 kHz).
/// Menggunakan pembagian ember (bucket) deterministik berdasar `bins_per_second` (default: 100 bin/dtk).
pub fn compute_waveform_peaks(
    interleaved_samples: &[f32],
    channels: usize,
    sample_rate: u32,
    bins_per_second: usize,
) -> Vec<WaveformPeak> {
    if interleaved_samples.is_empty() || channels == 0 || sample_rate == 0 || bins_per_second == 0 {
        return Vec::new();
    }

    let frames_per_bin = ((sample_rate as usize) / bins_per_second).max(1);
    let bin_sample_count = frames_per_bin * channels;
    let total_bins = interleaved_samples.len().div_ceil(bin_sample_count);
    let mut peaks = Vec::with_capacity(total_bins);

    if channels == 1 {
        for chunk in interleaved_samples.chunks(frames_per_bin) {
            let mut min_val = 0.0f32;
            let mut max_val = 0.0f32;
            for &s in chunk {
                if s < min_val {
                    min_val = s;
                }
                if s > max_val {
                    max_val = s;
                }
            }
            peaks.push(WaveformPeak {
                min: min_val.clamp(-1.0, 0.0),
                max: max_val.clamp(0.0, 1.0),
            });
        }
    } else if channels == 2 {
        for chunk in interleaved_samples.chunks(frames_per_bin * 2) {
            let mut min_val = 0.0f32;
            let mut max_val = 0.0f32;
            for frame in chunk.chunks_exact(2) {
                let mono = (frame[0] + frame[1]) * 0.5;
                if mono < min_val {
                    min_val = mono;
                }
                if mono > max_val {
                    max_val = mono;
                }
            }
            peaks.push(WaveformPeak {
                min: min_val.clamp(-1.0, 0.0),
                max: max_val.clamp(0.0, 1.0),
            });
        }
    } else {
        let inv_ch = 1.0 / (channels as f32);
        for chunk in interleaved_samples.chunks(bin_sample_count) {
            let mut min_val = 0.0f32;
            let mut max_val = 0.0f32;
            for frame in chunk.chunks_exact(channels) {
                let mut sum = 0.0f32;
                for &s in frame {
                    sum += s;
                }
                let mono = sum * inv_ch;
                if mono < min_val {
                    min_val = mono;
                }
                if mono > max_val {
                    max_val = mono;
                }
            }
            peaks.push(WaveformPeak {
                min: min_val.clamp(-1.0, 0.0),
                max: max_val.clamp(0.0, 1.0),
            });
        }
    }

    peaks
}

/// Serialisasi biner cepat untuk cache waveform (`cache/waveform-<hash>.bin`).
pub fn serialize_waveform_cache(peaks: &[WaveformPeak]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(peaks.len() * 8 + 4);
    bytes.extend_from_slice(&(peaks.len() as u32).to_le_bytes());
    for p in peaks {
        bytes.extend_from_slice(&p.min.to_le_bytes());
        bytes.extend_from_slice(&p.max.to_le_bytes());
    }
    bytes
}

/// Deserialisasi cache waveform dari file biner.
pub fn deserialize_waveform_cache(data: &[u8]) -> Option<Vec<WaveformPeak>> {
    if data.len() < 4 {
        return None;
    }
    let count = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if data.len() < 4 + count * 8 {
        return None;
    }

    let mut peaks = Vec::with_capacity(count);
    let mut offset = 4;
    for _ in 0..count {
        let min = f32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);
        let max = f32::from_le_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);
        peaks.push(WaveformPeak { min, max });
        offset += 8;
    }

    Some(peaks)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_waveform_computation_and_cache_roundtrip() {
        let mut samples = Vec::new();
        // Buat sinyal sinus 1 detik stereo (48.000 frame * 2 = 96.000 sampel)
        for i in 0..48_000 {
            let val = ((i as f32) * 0.1).sin();
            samples.push(val);
            samples.push(val);
        }

        let peaks = compute_waveform_peaks(&samples, 2, 48_000, 100);
        assert_eq!(peaks.len(), 100);

        // Uji serialisasi/deserialisasi cache
        let cached = serialize_waveform_cache(&peaks);
        let restored = deserialize_waveform_cache(&cached).unwrap();
        assert_eq!(peaks, restored);
    }

    #[test]
    fn test_benchmark_60_minutes_audio_waveform_in_under_2_seconds() {
        // 60 menit audio = 60 * 60 * 48.000 = 172.800.000 frame
        let sample_rate = 48_000;
        let bins_per_second = 100;
        let frames_per_bin = (sample_rate / bins_per_second as u32) as usize; // 480 frame

        let chunk_size = frames_per_bin * 1000; // 10 detik per chunk
        let dummy_chunk = vec![0.5f32; chunk_size]; // mono

        let start = std::time::Instant::now();
        let total_chunks = 360; // 360 * 10 detik = 60 menit
        let mut total_peaks_count = 0;

        for _ in 0..total_chunks {
            let peaks = compute_waveform_peaks(&dummy_chunk, 1, sample_rate, bins_per_second);
            total_peaks_count += peaks.len();
        }

        let elapsed = start.elapsed();
        println!("60 menit waveform dihitung dalam: {:?}", elapsed);

        // Kriteria Selesai A1-04 & PRD SRC-1:
        // Waktu komputasi untuk file 60 menit harus ≤ 2 detik!
        assert_eq!(total_peaks_count, 360_000);
        assert!(
            elapsed.as_secs_f64() <= 2.0,
            "Perhitungan waveform 60 menit harus selesai <= 2.0 detik, waktu terukur: {:?}",
            elapsed
        );
    }
}
