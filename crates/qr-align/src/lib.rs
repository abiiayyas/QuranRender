//! VAD, segmentasi tilawah, dan forced alignment tingkat kata (PRD SYN-1..9, A1-08).
//! Mengacu ke docs/product/PRD.md §8 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.3.

pub mod vad;

use qr_core::project::{AyahSegment, WordTiming};
use qr_quran::tokenize_ayah_v1;
use serde::{Deserialize, Serialize};
use thiserror::Error;
pub use vad::{detect_speech_regions, SpeechRegion, VadConfig};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AlignmentError {
    #[error("Audio kosong atau durasi terlalu pendek")]
    AudioTooShort,
    #[error("Gagal mendeteksi wilayah bacaan (tidak ada suara terdeteksi)")]
    NoSpeechDetected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlignmentConfig {
    pub sample_rate: u32,
    pub review_threshold: f32, // Default 0.80 (PRD SYN-4)
    pub vad: VadConfig,
}

impl Default for AlignmentConfig {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            review_threshold: 0.80,
            vad: VadConfig::default(),
        }
    }
}

/// Menghitung forced alignment kata per kata (WBW) secara proporsional terhadap bobot teks (SYN-3).
/// Memastikan invarian batas kata (tidak ada kata yang melewati batas segmen, dan urutan monoton naik).
pub fn align_verse_words(
    verse_text: &str,
    start_tick: i64,
    end_tick: i64,
    base_confidence: f32,
) -> Vec<WordTiming> {
    let (tokens, _meta) = match tokenize_ayah_v1(verse_text) {
        Ok(res) => res,
        Err(_) => return Vec::new(),
    };
    if tokens.is_empty() {
        return Vec::new();
    }

    let total_duration = end_tick - start_tick;
    if total_duration <= 0 {
        return Vec::new();
    }

    // Hitung bobot tiap kata berdasarkan panjang rentang byte
    let weights: Vec<usize> = tokens
        .iter()
        .map(|t| (t.span_end - t.span_start).max(1))
        .collect();
    let total_weight: usize = weights.iter().sum();

    let mut result = Vec::with_capacity(tokens.len());
    let mut current_tick = start_tick;

    for (i, token) in tokens.iter().enumerate() {
        let is_last = i == tokens.len() - 1;
        let word_duration = if is_last {
            end_tick - current_tick
        } else {
            (total_duration * weights[i] as i64) / total_weight as i64
        };

        let word_end = (current_tick + word_duration).min(end_tick);
        let word_text = if token.span_end <= verse_text.len() {
            verse_text[token.span_start..token.span_end].to_string()
        } else {
            String::new()
        };

        result.push(WordTiming {
            word_idx: token.idx,
            start_tick: current_tick,
            end_tick: word_end,
            text: word_text,
            confidence: base_confidence,
        });

        current_tick = word_end;
    }

    result
}

/// Laju baca acuan untuk heuristik durasi (detik per huruf Arab). Nilai awal; harus dikalibrasi
/// dengan set uji internal (tugas S3). Tilawah murottal sedang ≈ 0,10–0,20 detik per huruf.
pub const REFERENCE_SECONDS_PER_LETTER: f64 = 0.14;

/// Hasil segmentasi beserta temuan yang tidak boleh disembunyikan dari pengguna.
#[derive(Debug, Clone)]
pub struct AlignmentOutcome {
    pub segments: Vec<AyahSegment>,
    pub speech_regions: usize,
    pub verses_expected: usize,
    /// Peringatan yang harus ditampilkan di langkah Sinkron (mis. jumlah wilayah ≠ jumlah ayat).
    pub warnings: Vec<String>,
}

/// Jumlah huruf dasar Arab (tanpa harakat/tanda baca; `char::is_alphabetic` salah menghitung
/// harakat karena properti Other_Alphabetic).
pub fn arabic_base_letters(text: &str) -> usize {
    text.chars()
        .filter(|c| matches!(*c, '\u{0621}'..='\u{064A}' | '\u{0671}'..='\u{06D3}'))
        .count()
}

/// Skor keyakinan 0..1 dari dua sinyal nyata — BUKAN keluaran model akustik:
/// 1. kewajaran durasi: durasi wilayah suara vs. durasi harapan dari jumlah huruf ayat;
/// 2. kontras energi: RMS wilayah suara vs. lantai derau (RMS di luar wilayah suara).
pub fn heuristic_confidence(
    region_seconds: f64,
    verse_text: &str,
    region_rms: f32,
    noise_floor_rms: f32,
) -> f32 {
    let letters = arabic_base_letters(verse_text).max(1) as f64;
    let expected = letters * REFERENCE_SECONDS_PER_LETTER;
    let ratio = (region_seconds.max(1e-3) / expected).ln();
    let duration_score = (-(ratio * ratio) / (2.0 * 0.5 * 0.5)).exp();
    let snr = f64::from(region_rms) / f64::from(noise_floor_rms.max(1e-4));
    let energy_score = (snr / 8.0).clamp(0.0, 1.0);
    ((0.7 * duration_score + 0.3 * energy_score) as f32).clamp(0.0, 1.0)
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

/// Menjalankan segmentasi tilawah berbasis VAD + pembobotan teks:
/// 1. deteksi wilayah suara (VAD energi);
/// 2. pemetaan berurutan wilayah ke-i → ayat ke-i (hanya valid bila jumlah sama);
/// 3. timing kata proporsional terhadap panjang kata;
/// 4. keyakinan dari [`heuristic_confidence`]; < `review_threshold` ⇒ perlu ditinjau (SYN-4).
///
/// Ini BUKAN identifikasi ayat atau forced alignment akustik (S3 belum dikerjakan): bila jumlah
/// wilayah ≠ jumlah ayat, hasil diberi peringatan dan keyakinan segmen yang tidak terpetakan
/// jujur rendah, sehingga pengguna wajib meninjau.
pub fn align_recitation(
    audio_samples: &[f32],
    verses: &[(u32, u32, String)], // (surah_id, ayah_number, verse_text)
    config: &AlignmentConfig,
) -> Result<AlignmentOutcome, AlignmentError> {
    if audio_samples.is_empty() {
        return Err(AlignmentError::AudioTooShort);
    }
    let regions = detect_speech_regions(audio_samples, &config.vad);
    if regions.is_empty() {
        return Err(AlignmentError::NoSpeechDetected);
    }

    // Lantai derau = RMS seluruh sampel di luar wilayah suara.
    let mut outside: Vec<f32> = Vec::new();
    let mut cursor = 0usize;
    for r in &regions {
        outside.extend_from_slice(&audio_samples[cursor..r.start_sample.min(audio_samples.len())]);
        cursor = r.end_sample.min(audio_samples.len());
    }
    outside.extend_from_slice(&audio_samples[cursor..]);
    let noise_floor = rms(&outside);

    let mut warnings = Vec::new();
    if regions.len() != verses.len() {
        warnings.push(format!(
            "Jumlah wilayah suara ({}) tidak sama dengan jumlah ayat yang diharapkan ({}). Pemetaan berurutan tidak dapat dipercaya; tinjau semua segmen.",
            regions.len(),
            verses.len()
        ));
    }
    let mismatch_penalty = if regions.len() == verses.len() {
        1.0
    } else {
        0.5
    };

    let mut segments = Vec::new();
    for (region, (surah_id, ayah_number, verse_text)) in regions.iter().zip(verses.iter()) {
        let start_tick = (region.start_sample as i64 * 48000) / i64::from(config.sample_rate);
        let end_tick = (region.end_sample as i64 * 48000) / i64::from(config.sample_rate);
        let seconds =
            (region.end_sample - region.start_sample) as f64 / f64::from(config.sample_rate);
        let region_rms =
            rms(&audio_samples[region.start_sample..region.end_sample.min(audio_samples.len())]);
        let conf =
            heuristic_confidence(seconds, verse_text, region_rms, noise_floor) * mismatch_penalty;
        let word_timings = align_verse_words(verse_text, start_tick, end_tick, conf);
        segments.push(AyahSegment {
            id: format!("seg_{surah_id}_{ayah_number}"),
            surah_id: *surah_id,
            ayah_number: *ayah_number,
            start_tick,
            end_tick,
            word_timings,
            confidence: conf,
            manual_override: false,
            word_range: None,
        });
    }
    if verses.len() > regions.len() {
        warnings.push(format!(
            "{} ayat tidak mendapat segmen sama sekali.",
            verses.len() - regions.len()
        ));
    }
    Ok(AlignmentOutcome {
        segments,
        speech_regions: regions.len(),
        verses_expected: verses.len(),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_align_verse_words_produces_monotonic_word_timings() {
        let text = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
        let start_tick = 48000 * 2;
        let end_tick = 48000 * 6;
        let words = align_verse_words(text, start_tick, end_tick, 0.98);

        assert_eq!(words.len(), 4);
        assert_eq!(words[0].start_tick, start_tick);
        assert_eq!(words.last().expect("Harus ada kata").end_tick, end_tick);

        for i in 1..words.len() {
            assert!(words[i].start_tick >= words[i - 1].end_tick);
            assert!(words[i].end_tick <= end_tick);
        }
    }

    fn burst(audio: &mut [f32], start: usize, len: usize, amp: f32) {
        for (i, sample) in audio.iter_mut().enumerate().skip(start).take(len) {
            *sample = (i as f32 * 0.1).sin() * amp;
        }
    }

    fn cfg() -> AlignmentConfig {
        AlignmentConfig {
            sample_rate: 48000,
            review_threshold: 0.80,
            vad: VadConfig {
                sample_rate: 48000,
                frame_size_ms: 20,
                energy_threshold: 0.02,
                min_speech_ms: 100,
                min_silence_ms: 100,
            },
        }
    }

    #[test]
    fn confidence_is_computed_from_signal_not_from_ayah_number() {
        let fatihah1 = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
        let letters = arabic_base_letters(fatihah1) as f64;
        let expected = letters * REFERENCE_SECONDS_PER_LETTER;
        let good = heuristic_confidence(expected, fatihah1, 0.3, 0.001);
        let too_short = heuristic_confidence(expected / 6.0, fatihah1, 0.3, 0.001);
        let too_long = heuristic_confidence(expected * 6.0, fatihah1, 0.3, 0.001);
        let noisy = heuristic_confidence(expected, fatihah1, 0.003, 0.002);
        assert!(
            good > 0.9,
            "durasi wajar + kontras tinggi harus yakin: {good}"
        );
        assert!(
            too_short < 0.5 && too_long < 0.5,
            "durasi tak wajar harus rendah: {too_short} {too_long}"
        );
        assert!(
            noisy < good - 0.2,
            "kontras energi rendah harus menurunkan keyakinan"
        );
        // Nomor ayat sama sekali tidak berpengaruh.
        assert_eq!(good, heuristic_confidence(expected, fatihah1, 0.3, 0.001));
    }

    #[test]
    fn align_recitation_flags_count_mismatch_and_low_confidence() {
        let v: Vec<(u32, u32, String)> = vec![
            (1, 1, "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ".into()),
            (1, 2, "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ".into()),
            (1, 3, "الرَّحْمَٰنِ الرَّحِيمِ".into()),
        ];
        // Sesuai: 3 wilayah ~ durasi wajar (harapan ≈ 2,7 / 3,0 / 2,2 dtk).
        let dur = |i: usize| {
            (arabic_base_letters(&v[i].2) as f64 * REFERENCE_SECONDS_PER_LETTER * 48000.0) as usize
        };
        let mut audio = vec![0.0f32; 48000 * 14];
        burst(&mut audio, 48000, dur(0), 0.4);
        burst(&mut audio, 48000 * 5, dur(1), 0.4);
        burst(&mut audio, 48000 * 10, dur(2), 0.4);
        let ok = align_recitation(&audio, &v, &cfg()).expect("harus berhasil");
        assert!(ok.warnings.is_empty(), "{:?}", ok.warnings);
        assert_eq!(ok.segments.len(), 3);
        assert!(
            ok.segments.iter().all(|s| s.confidence >= 0.8),
            "{:?}",
            ok.segments.iter().map(|s| s.confidence).collect::<Vec<_>>()
        );

        // Hanya 2 wilayah untuk 3 ayat: peringatan + keyakinan <= 0,5 (perlu ditinjau).
        let mut audio2 = vec![0.0f32; 48000 * 8];
        burst(&mut audio2, 48000, dur(0), 0.4);
        burst(&mut audio2, 48000 * 5, dur(1), 0.4);
        let bad = align_recitation(&audio2, &v, &cfg()).expect("tetap menghasilkan keluaran");
        assert_eq!(bad.speech_regions, 2);
        assert!(bad.warnings.iter().any(|w| w.contains("tidak sama")));
        assert!(bad
            .warnings
            .iter()
            .any(|w| w.contains("tidak mendapat segmen")));
        assert!(bad.segments.iter().all(|s| s.confidence <= 0.5));
    }
}
