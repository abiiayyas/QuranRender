//! Decode/encode libav, audio engine (cpal), waveform, thumbnail, normalisasi LUFS, dan video fx.
//! Mengacu ke PRD SRC-1, SRC-2, SRC-5, TML-2, SYN-9 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.2.

pub mod clock;
pub mod encoder;
pub mod lufs;
pub mod probe;
pub mod video_fx;
pub mod waveform;

pub use clock::{frame_to_tick, tick_to_frame, AudioClock};
pub use encoder::{
    build_ffmpeg_export_args, build_ffmpeg_transparent_export_args, check_frame_equivalence,
    generate_unique_export_path, probe_available_encoders, select_best_encoder, HwEncoderKind,
    Mp4ExportConfig, TransparentExportFormat, VideoEncoder,
};
pub use lufs::{calculate_normalization_gain, measure_integrated_lufs};
pub use probe::{is_supported_media_extension, probe_media, MediaMetadata};
pub use video_fx::{map_timeline_to_source_tick, OverlayTransform, VideoPlaybackFx};
pub use waveform::{
    compute_waveform_peaks, deserialize_waveform_cache, serialize_waveform_cache, WaveformPeak,
};

#[derive(Debug, Clone)]
pub struct AudioSampleRate(pub u32);
