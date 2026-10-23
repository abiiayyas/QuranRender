//! Decode/encode libav, audio engine (cpal), waveform, thumbnail, dan normalisasi loudness LUFS.
//! Mengacu ke PRD SRC-1, SRC-2, SYN-9 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.2.

pub mod clock;
pub mod lufs;
pub mod probe;
pub mod waveform;

pub use clock::{frame_to_tick, tick_to_frame, AudioClock, SAMPLE_RATE};
pub use lufs::{calculate_normalization_gain, measure_integrated_lufs};
pub use probe::{is_supported_media_extension, probe_media, MediaError, MediaMetadata};
pub use waveform::{
    compute_waveform_peaks, deserialize_waveform_cache, serialize_waveform_cache, WaveformPeak,
};

#[derive(Debug, Clone)]
pub struct AudioSampleRate(pub u32);
