//! Decode/encode libav, audio engine (cpal), waveform, thumbnail, normalisasi LUFS, dan video fx.
//! Mengacu ke PRD SRC-1, SRC-2, SRC-5, TML-2, SYN-9 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.2.

pub mod audio_engine;
pub mod clock;
pub mod decode;
pub mod encoder;
pub mod export;
pub mod frames;
pub mod lufs;
pub mod probe;
pub mod ssim;
pub mod video_fx;
pub mod waveform;

pub use audio_engine::{
    frames_to_ticks, ticks_to_frames, AudioEngine, AudioEngineError, AudioSource, BufferSource,
    PlaybackControl, PlayerCore,
};
pub use clock::{frame_to_tick, tick_to_frame, AudioClock};
pub use decode::decode_audio_mono_f32;
pub use encoder::{
    build_ffmpeg_export_args, build_ffmpeg_transparent_export_args, check_frame_equivalence,
    generate_unique_export_path, parse_ffmpeg_encoders, probe_available_encoders,
    rgba_to_yuv420_bt709, select_best_encoder, HwEncoderKind, Mp4ExportConfig, RawFrameFormat,
    TransparentExportFormat, VideoEncoder,
};
pub use export::{export_mp4, ExportError, ExportStats};
pub use frames::extract_rgb24_frames;
pub use lufs::{calculate_normalization_gain, measure_integrated_lufs};
pub use probe::{
    is_supported_media_extension, parse_ffprobe_json, probe_media, probe_media_with, MediaMetadata,
};
pub use ssim::{luma_bt709, ssim_gray, ssim_rgb, SsimError};
pub use video_fx::{map_timeline_to_source_tick, OverlayTransform, VideoPlaybackFx};
pub use waveform::{
    compute_waveform_peaks, deserialize_waveform_cache, serialize_waveform_cache, WaveformPeak,
};

#[derive(Debug, Clone)]
pub struct AudioSampleRate(pub u32);
