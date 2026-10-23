//! Audio engine: keluaran cpal + jam master tick + seek (PRD SYN-9, RND-3; plan A1-05).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §6.
//!
//! # Arsitektur
//! - [`PlayerCore`] adalah logika callback murni (tanpa perangkat): mengisi buffer keluaran dari
//!   [`AudioSource`], menerapkan volume/seek/pause, lalu menulis posisi ke [`AudioClock`].
//!   Dapat diuji tanpa perangkat keras dengan memanggil [`PlayerCore::render`] berulang kali.
//! - [`AudioEngine`] membuka perangkat keluaran default cpal dan menjalankan `PlayerCore` di
//!   thread audio.
//! - [`PlaybackControl`] adalah pegangan lock-free (atomik) untuk play/pause/seek/volume dari
//!   thread mana pun.
//!
//! # Sumber kebenaran jam
//! Satu-satunya penulis `AudioClock` selama engine hidup adalah callback audio. Setelah setiap
//! callback, jam diset ke `frame_dikirim_ke_perangkat × 48000 / sample_rate_perangkat`
//! (pembagian bilangan bulat, dibulatkan ke bawah; identik dengan jumlah frame untuk 48 kHz),
//! dikurangi latensi keluaran yang dilaporkan cpal (`playback - callback`) bila tersedia.
//! Karena posisi dihitung dari bilangan bulat frame yang benar-benar diserahkan ke perangkat,
//! tidak ada drift (0 sampel) berapa pun lama playback.
//! `seek`/`play`/`pause` hanya mengubah atomik kontrol; callback menerapkannya di awal callback
//! berikutnya, sehingga jam mencerminkan seek paling lambat setelah satu buffer perangkat.
//! Selama stream hidup, pemanggil TIDAK boleh menulis `AudioClock::seek` langsung.
//!
//! # Pemakaian dari desktop
//! ```no_run
//! use qr_media::{decode_audio_mono_f32, AudioClock, AudioEngine};
//! use std::path::Path;
//!
//! # fn demo() -> Result<(), Box<dyn std::error::Error>> {
//! let rate = AudioEngine::default_output_sample_rate()?;
//! // Dekode pada sample rate perangkat → tidak perlu resampling di engine.
//! let samples = decode_audio_mono_f32("ffmpeg", Path::new("qari.mp3"), rate)?;
//! let clock = AudioClock::new();
//! let engine = AudioEngine::new(samples, rate, clock.clone())?;
//! engine.play();
//! // UI/preview membaca `clock.get_tick()` (tick 48 kHz) tiap frame video.
//! engine.seek(48_000 * 30); // loncat ke detik 30
//! engine.set_volume(0.8);
//! engine.pause();
//! # Ok(()) }
//! ```
//! `AudioEngine` memegang `cpal::Stream` yang tidak aman dibagi antar thread di beberapa host;
//! simpan di thread pemilik (atau bungkus dengan `Mutex`) dan bagikan `AudioClock`/
//! [`PlaybackControl`] (keduanya `Clone + Send + Sync`) ke thread lain.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};

use crate::clock::{AudioClock, SAMPLE_RATE};

/// Jumlah frame mono maksimum yang dibaca per iterasi (scratch dialokasikan sekali di awal).
const SCRATCH_FRAMES: usize = 2048;
/// Penanda "tidak ada seek tertunda" pada `pending_seek`.
const NO_SEEK: i64 = -1;

#[derive(Debug, thiserror::Error)]
pub enum AudioEngineError {
    #[error("tidak ada perangkat keluaran audio")]
    NoOutputDevice,
    #[error(
        "perangkat tidak mendukung sample rate {requested} Hz (default perangkat {device} Hz)"
    )]
    UnsupportedSampleRate { requested: u32, device: u32 },
    #[error("format sampel perangkat tidak didukung: {0}")]
    UnsupportedSampleFormat(String),
    #[error("sample rate harus > 0 dan buffer audio tidak boleh kosong")]
    InvalidSource,
    #[error("kesalahan perangkat audio: {0}")]
    Device(String),
}

/// Sumber sampel mono f32 yang dapat dibaca acak dari thread audio (tanpa alokasi).
pub trait AudioSource: Send + Sync + 'static {
    /// Jumlah frame mono total.
    fn len_frames(&self) -> u64;
    /// Mengisi `dst` dengan sampel mulai frame `start`. Pemanggil menjamin
    /// `start + dst.len() <= len_frames()`.
    fn read(&self, start: u64, dst: &mut [f32]);
}

/// Sumber dari buffer sampel yang sudah didekode di memori.
#[derive(Debug, Clone)]
pub struct BufferSource {
    samples: Arc<[f32]>,
}

impl BufferSource {
    pub fn new(samples: Vec<f32>) -> Self {
        Self {
            samples: samples.into(),
        }
    }
}

impl AudioSource for BufferSource {
    fn len_frames(&self) -> u64 {
        self.samples.len() as u64
    }

    fn read(&self, start: u64, dst: &mut [f32]) {
        let start = usize::try_from(start).unwrap_or(usize::MAX);
        let src = start
            .checked_add(dst.len())
            .and_then(|end| self.samples.get(start..end));
        match src {
            Some(src) => dst.copy_from_slice(src),
            // Di luar jangkauan (tidak terjadi bila kontrak dipenuhi): keheningan, bukan panic.
            None => dst.fill(0.0),
        }
    }
}

/// Konversi frame perangkat → tick 48 kHz (bulat ke bawah, tanpa floating-point).
pub fn frames_to_ticks(frames: u64, sample_rate: u32) -> i64 {
    let rate = u128::from(sample_rate.max(1));
    let ticks = u128::from(frames) * u128::from(SAMPLE_RATE) / rate;
    i64::try_from(ticks).unwrap_or(i64::MAX)
}

/// Konversi tick 48 kHz → frame perangkat (bulat ke bawah); tick negatif dianggap 0.
pub fn ticks_to_frames(tick: i64, sample_rate: u32) -> u64 {
    let tick = u128::from(tick.max(0) as u64);
    let frames = tick * u128::from(sample_rate) / u128::from(SAMPLE_RATE);
    u64::try_from(frames).unwrap_or(u64::MAX)
}

/// Status bersama thread kontrol ↔ thread audio. Semua atomik, tanpa lock.
#[derive(Debug)]
struct PlaybackShared {
    playing: AtomicBool,
    finished: AtomicBool,
    volume_bits: AtomicU32,
    /// Seek tertunda dalam frame perangkat, `NO_SEEK` bila tidak ada.
    pending_seek: AtomicI64,
    /// Posisi terakhir yang dipublikasikan callback (frame perangkat).
    position_frames: AtomicU64,
    stream_failed: AtomicBool,
}

/// Pegangan kontrol playback lock-free; aman dipakai dari thread mana pun.
#[derive(Debug, Clone)]
pub struct PlaybackControl {
    shared: Arc<PlaybackShared>,
    clock: AudioClock,
    sample_rate: u32,
}

impl PlaybackControl {
    /// Mulai/lanjut playback. Bila sudah selesai (mencapai akhir), mulai dari awal.
    pub fn play(&self) {
        if self.shared.finished.load(Ordering::Acquire) {
            self.shared.pending_seek.store(0, Ordering::Release);
        }
        self.shared.playing.store(true, Ordering::Release);
        self.clock.set_playing(true);
    }

    /// Jeda: callback mengeluarkan keheningan dan posisi tidak maju.
    pub fn pause(&self) {
        self.shared.playing.store(false, Ordering::Release);
        self.clock.set_playing(false);
    }

    /// Seek ke `tick` (48 kHz); diterapkan di awal callback berikutnya dan di-clamp ke akhir sumber.
    pub fn seek(&self, tick: i64) {
        let frames = ticks_to_frames(tick, self.sample_rate);
        let frames = i64::try_from(frames).unwrap_or(i64::MAX);
        self.shared.pending_seek.store(frames, Ordering::Release);
    }

    /// Volume linear 0.0..=1.0 (di luar rentang di-clamp; NaN → 0).
    pub fn set_volume(&self, volume: f32) {
        let v = if volume.is_nan() {
            0.0
        } else {
            volume.clamp(0.0, 1.0)
        };
        self.shared
            .volume_bits
            .store(v.to_bits(), Ordering::Relaxed);
    }

    pub fn volume(&self) -> f32 {
        f32::from_bits(self.shared.volume_bits.load(Ordering::Relaxed))
    }

    pub fn is_playing(&self) -> bool {
        self.shared.playing.load(Ordering::Acquire)
    }

    /// `true` bila playback mencapai akhir sumber (sampai `play`/`seek` berikutnya).
    pub fn is_finished(&self) -> bool {
        self.shared.finished.load(Ordering::Acquire)
    }

    /// Posisi (frame perangkat) yang terakhir diserahkan ke perangkat, tanpa pengurangan latensi.
    pub fn position_frames(&self) -> u64 {
        self.shared.position_frames.load(Ordering::Acquire)
    }

    /// `true` bila cpal melaporkan kesalahan stream (mis. perangkat dicabut).
    pub fn has_stream_error(&self) -> bool {
        self.shared.stream_failed.load(Ordering::Acquire)
    }

    pub fn clock(&self) -> &AudioClock {
        &self.clock
    }
}

/// Logika callback murni: mengisi buffer interleaved dan menggerakkan [`AudioClock`].
pub struct PlayerCore<S: AudioSource> {
    source: S,
    channels: usize,
    sample_rate: u32,
    shared: Arc<PlaybackShared>,
    clock: AudioClock,
    /// Posisi frame berikutnya yang akan diserahkan ke perangkat.
    pos: u64,
    scratch: Box<[f32]>,
}

impl<S: AudioSource> std::fmt::Debug for PlayerCore<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlayerCore")
            .field("channels", &self.channels)
            .field("sample_rate", &self.sample_rate)
            .field("pos", &self.pos)
            .finish_non_exhaustive()
    }
}

impl<S: AudioSource> PlayerCore<S> {
    /// Membuat core dalam keadaan jeda di posisi 0 dan menyetel `clock` ke tick 0.
    pub fn new(
        source: S,
        sample_rate: u32,
        channels: u16,
        clock: AudioClock,
    ) -> Result<(Self, PlaybackControl), AudioEngineError> {
        if sample_rate == 0 || channels == 0 || source.len_frames() == 0 {
            return Err(AudioEngineError::InvalidSource);
        }
        let shared = Arc::new(PlaybackShared {
            playing: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            volume_bits: AtomicU32::new(1.0f32.to_bits()),
            pending_seek: AtomicI64::new(NO_SEEK),
            position_frames: AtomicU64::new(0),
            stream_failed: AtomicBool::new(false),
        });
        clock.seek(0);
        clock.set_playing(false);
        clock.set_hardware_latency(0);
        let control = PlaybackControl {
            shared: Arc::clone(&shared),
            clock: clock.clone(),
            sample_rate,
        };
        let core = Self {
            source,
            channels: usize::from(channels),
            sample_rate,
            shared,
            clock,
            pos: 0,
            scratch: vec![0.0; SCRATCH_FRAMES].into_boxed_slice(),
        };
        Ok((core, control))
    }

    /// Mengisi satu callback perangkat. Realtime-safe: tanpa alokasi, tanpa lock.
    ///
    /// `out` adalah buffer interleaved `channels` kanal; mono diduplikasi ke semua kanal.
    /// `latency` = (waktu putar prediksi − waktu callback) dari cpal, bila tersedia.
    pub fn render<T>(&mut self, out: &mut [T], latency: Option<Duration>)
    where
        T: Sample + FromSample<f32>,
    {
        let len = self.source.len_frames();

        // 1. Terapkan seek tertunda.
        let pending = self.shared.pending_seek.swap(NO_SEEK, Ordering::AcqRel);
        if pending >= 0 {
            self.pos = u64::try_from(pending).unwrap_or(0).min(len);
            self.shared
                .finished
                .store(self.pos >= len, Ordering::Release);
        }

        // 2. Isi buffer.
        let silence = T::EQUILIBRIUM;
        let mut advanced: u64 = 0;
        if self.shared.playing.load(Ordering::Acquire) {
            let volume = f32::from_bits(self.shared.volume_bits.load(Ordering::Relaxed));
            let total_frames = out.len() / self.channels;
            let mut frames = out.chunks_exact_mut(self.channels);
            let mut remaining = total_frames;
            while remaining > 0 && self.pos < len {
                let left = usize::try_from(len - self.pos).unwrap_or(usize::MAX);
                let n = remaining.min(self.scratch.len()).min(left);
                let chunk = self.scratch.split_at_mut(n).0;
                self.source.read(self.pos, chunk);
                for (frame, &s) in frames.by_ref().take(n).zip(chunk.iter()) {
                    let v = T::from_sample(s * volume);
                    frame.fill(v);
                }
                self.pos += n as u64;
                advanced += n as u64;
                remaining -= n;
            }
            for frame in frames.by_ref() {
                frame.fill(silence);
            }
            frames.into_remainder().fill(silence);

            if self.pos >= len {
                self.shared.finished.store(true, Ordering::Release);
                self.shared.playing.store(false, Ordering::Release);
                self.clock.set_playing(false);
            }
        } else {
            out.fill(silence);
        }
        debug_assert!(advanced <= len);

        // 3. Publikasikan posisi → jam master (penulis tunggal).
        self.shared
            .position_frames
            .store(self.pos, Ordering::Release);
        if let Some(lat) = latency {
            let ticks = lat.as_nanos() * u128::from(SAMPLE_RATE) / 1_000_000_000;
            self.clock
                .set_hardware_latency(i64::try_from(ticks).unwrap_or(i64::MAX));
        }
        self.clock.seek(frames_to_ticks(self.pos, self.sample_rate));
    }
}

/// Mesin audio nyata: stream keluaran default cpal yang digerakkan oleh [`PlayerCore`].
pub struct AudioEngine {
    // Dijaga hidup; menghentikan stream saat di-drop.
    _stream: cpal::Stream,
    control: PlaybackControl,
    sample_rate: u32,
    channels: u16,
    total_frames: u64,
}

impl std::fmt::Debug for AudioEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudioEngine")
            .field("sample_rate", &self.sample_rate)
            .field("channels", &self.channels)
            .field("total_frames", &self.total_frames)
            .finish_non_exhaustive()
    }
}

fn device_err(e: impl std::fmt::Display) -> AudioEngineError {
    AudioEngineError::Device(e.to_string())
}

impl AudioEngine {
    /// Sample rate default perangkat keluaran; dekode audio pada rate ini sebelum [`Self::new`].
    pub fn default_output_sample_rate() -> Result<u32, AudioEngineError> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or(AudioEngineError::NoOutputDevice)?;
        Ok(device
            .default_output_config()
            .map_err(device_err)?
            .sample_rate())
    }

    /// Membuka perangkat keluaran default dan memulai stream (dalam keadaan jeda, tick 0).
    ///
    /// `samples` adalah audio mono f32 yang didekode pada `sample_rate` Hz. Engine tidak
    /// melakukan resampling: perangkat harus mendukung `sample_rate` (kalau tidak,
    /// `UnsupportedSampleRate`). `clock` dipakai bersama (di-clone) oleh pembaca jam.
    pub fn new(
        samples: Vec<f32>,
        sample_rate: u32,
        clock: AudioClock,
    ) -> Result<Self, AudioEngineError> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or(AudioEngineError::NoOutputDevice)?;
        let default = device.default_output_config().map_err(device_err)?;
        let supported = if default.sample_rate() == sample_rate {
            default
        } else {
            let range = device
                .supported_output_configs()
                .map_err(device_err)?
                .filter(|r| {
                    r.contains_rate(sample_rate)
                        && matches!(
                            r.sample_format(),
                            SampleFormat::F32
                                | SampleFormat::I16
                                | SampleFormat::U16
                                | SampleFormat::I32
                        )
                })
                .max_by_key(|r| r.sample_format() == SampleFormat::F32);
            match range {
                Some(r) => r.with_sample_rate(sample_rate),
                None => {
                    return Err(AudioEngineError::UnsupportedSampleRate {
                        requested: sample_rate,
                        device: default.sample_rate(),
                    })
                }
            }
        };

        let channels = supported.channels();
        let format = supported.sample_format();
        let config = supported.config();
        let source = BufferSource::new(samples);
        let total_frames = source.len_frames();
        let (core, control) = PlayerCore::new(source, sample_rate, channels, clock)?;

        let stream = match format {
            SampleFormat::F32 => build_stream::<f32>(&device, config, core, &control)?,
            SampleFormat::I16 => build_stream::<i16>(&device, config, core, &control)?,
            SampleFormat::U16 => build_stream::<u16>(&device, config, core, &control)?,
            SampleFormat::I32 => build_stream::<i32>(&device, config, core, &control)?,
            other => {
                return Err(AudioEngineError::UnsupportedSampleFormat(format!(
                    "{other:?}"
                )))
            }
        };
        // Stream berjalan terus (mengeluarkan keheningan saat jeda) agar seek saat jeda
        // tetap tercermin di jam.
        stream.play().map_err(device_err)?;

        Ok(Self {
            _stream: stream,
            control,
            sample_rate,
            channels,
            total_frames,
        })
    }

    pub fn play(&self) {
        self.control.play();
    }

    pub fn pause(&self) {
        self.control.pause();
    }

    /// Seek ke `tick` (48 kHz), sampel-akurat pada rate perangkat.
    pub fn seek(&self, tick: i64) {
        self.control.seek(tick);
    }

    pub fn set_volume(&self, volume: f32) {
        self.control.set_volume(volume);
    }

    pub fn is_playing(&self) -> bool {
        self.control.is_playing()
    }

    pub fn is_finished(&self) -> bool {
        self.control.is_finished()
    }

    pub fn has_stream_error(&self) -> bool {
        self.control.has_stream_error()
    }

    pub fn clock(&self) -> &AudioClock {
        self.control.clock()
    }

    /// Pegangan kontrol yang dapat di-clone dan dibagikan ke thread lain.
    pub fn control(&self) -> PlaybackControl {
        self.control.clone()
    }

    pub fn device_sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn device_channels(&self) -> u16 {
        self.channels
    }

    /// Durasi sumber dalam tick 48 kHz.
    pub fn duration_ticks(&self) -> i64 {
        frames_to_ticks(self.total_frames, self.sample_rate)
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut core: PlayerCore<BufferSource>,
    control: &PlaybackControl,
) -> Result<cpal::Stream, AudioEngineError>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let shared = Arc::clone(&control.shared);
    device
        .build_output_stream::<T, _, _>(
            config,
            move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                let ts = info.timestamp();
                core.render(data, ts.playback.checked_duration_since(ts.callback));
            },
            move |err| {
                use cpal::ErrorKind;
                // Xrun/DeviceChanged/RealtimeDenied tidak fatal: stream tetap berjalan.
                if matches!(
                    err.kind(),
                    ErrorKind::Xrun | ErrorKind::DeviceChanged | ErrorKind::RealtimeDenied
                ) {
                    tracing::warn!("peringatan stream audio: {:?}: {err}", err.kind());
                } else {
                    tracing::error!("stream audio gagal: {:?}: {err}", err.kind());
                    shared.stream_failed.store(true, Ordering::Release);
                }
            },
            None,
        )
        .map_err(device_err)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Sumber sintetis deterministik tanpa buffer (agar 60 menit tidak butuh ~700 MB).
    struct Synth {
        len: u64,
    }

    fn synth(i: u64) -> f32 {
        ((i % 1009) as f32 - 504.0) / 1009.0
    }

    impl AudioSource for Synth {
        fn len_frames(&self) -> u64 {
            self.len
        }
        fn read(&self, start: u64, dst: &mut [f32]) {
            for (k, d) in dst.iter_mut().enumerate() {
                *d = synth(start + k as u64);
            }
        }
    }

    fn core_with(
        len: u64,
        rate: u32,
        channels: u16,
    ) -> (PlayerCore<Synth>, PlaybackControl, AudioClock) {
        let clock = AudioClock::new();
        let (core, ctl) = PlayerCore::new(Synth { len }, rate, channels, clock.clone()).unwrap();
        (core, ctl, clock)
    }

    #[test]
    fn jam_nol_drift_setelah_60_menit_buffer_ganjil_seek_pause() {
        const RATE: u32 = 48_000;
        const CH: usize = 2;
        const LEN: u64 = 3610 * RATE as u64; // 60 menit + 10 dtk
        const MIN_PLAYED: u64 = 3600 * RATE as u64;
        let sizes: [usize; 7] = [441, 480, 1021, 256, 1, 977, 512];

        let (mut core, ctl, clock) = core_with(LEN, RATE, CH as u16);
        let mut buf = vec![0.0f32; 1021 * CH];
        let t0 = Instant::now();

        ctl.play();
        let mut model_pos: u64 = 0;
        let mut played: u64 = 0;
        let mut callbacks: u64 = 0;
        let (mut did_back, mut did_pause) = (false, false);
        let mut k = 0usize;

        while !ctl.is_finished() {
            let n = sizes[k % sizes.len()];
            k += 1;
            let out = &mut buf[..n * CH];
            core.render(out, None);
            callbacks += 1;

            let adv = (n as u64).min(LEN - model_pos);
            // Isi benar: frame pertama dan terakhir yang maju sama dengan sumber pada posisi model.
            if adv > 0 {
                let first = synth(model_pos);
                let last = synth(model_pos + adv - 1);
                let adv = adv as usize;
                assert_eq!(out[0], first);
                assert_eq!(out[1], first);
                assert_eq!(out[(adv - 1) * CH], last);
                assert_eq!(out[(adv - 1) * CH + 1], last);
                assert!(out[adv * CH..].iter().all(|&s| s == 0.0));
            }
            model_pos += adv;
            played += adv;
            assert_eq!(
                clock.get_tick(),
                model_pos as i64,
                "drift pada callback {callbacks}"
            );
            assert_eq!(ctl.position_frames(), model_pos);

            // Seek mundur 5 dtk pada menit ke-15.
            if !did_back && played >= 15 * 60 * RATE as u64 {
                did_back = true;
                model_pos -= 5 * RATE as u64;
                ctl.seek(model_pos as i64);
            }
            // Pause pada menit ke-30, seek maju 5 dtk saat jeda, lalu lanjut.
            if !did_pause && played >= 30 * 60 * RATE as u64 {
                did_pause = true;
                ctl.pause();
                for j in 0..7 {
                    let m = sizes[j % sizes.len()];
                    let o = &mut buf[..m * CH];
                    o.fill(9.0);
                    core.render(o, None);
                    assert!(o.iter().all(|&s| s == 0.0), "jeda harus hening");
                    assert_eq!(clock.get_tick(), model_pos as i64, "jeda tidak boleh maju");
                    if j == 3 {
                        model_pos += 5 * RATE as u64;
                        ctl.seek(model_pos as i64);
                    }
                }
                assert_eq!(clock.get_tick(), model_pos as i64);
                ctl.play();
            }
        }

        assert!(did_back && did_pause);
        assert_eq!(model_pos, LEN);
        assert_eq!(clock.get_tick(), LEN as i64);
        assert_eq!(played, LEN);
        assert!(played >= MIN_PLAYED);
        assert!(!ctl.is_playing());
        eprintln!(
            "60 menit ekuivalen: {played} frame ({:.1} dtk audio) dalam {callbacks} callback, runtime {:?}",
            played as f64 / RATE as f64,
            t0.elapsed()
        );
    }

    #[test]
    fn jam_nol_drift_pada_44100_hz_sebagai_floor_tick() {
        const RATE: u32 = 44_100;
        let len = 600 * u64::from(RATE);
        let (mut core, ctl, clock) = core_with(len, RATE, 2);
        ctl.play();
        let mut buf = vec![0.0f32; 1021 * 2];
        let sizes = [441usize, 480, 1021];
        let mut pos = 0u64;
        let mut k = 0;
        while !ctl.is_finished() {
            let n = sizes[k % 3];
            k += 1;
            core.render(&mut buf[..n * 2], None);
            pos = (pos + n as u64).min(len);
            assert_eq!(clock.get_tick(), (pos * 48_000 / u64::from(RATE)) as i64);
        }
        assert_eq!(clock.get_tick(), 600 * 48_000);
    }

    #[test]
    fn pause_hening_dan_tidak_maju_untuk_semua_format() {
        fn check<T: Sample + FromSample<f32> + PartialEq + std::fmt::Debug + Copy>() {
            let (mut core, ctl, clock) = core_with(48_000, 48_000, 2);
            let mut out = vec![T::from_sample(0.7f32); 480 * 2];
            core.render(&mut out, None); // belum play
            assert!(out.iter().all(|&s| s == T::EQUILIBRIUM));
            assert_eq!(clock.get_tick(), 0);

            ctl.play();
            core.render(&mut out, None);
            assert_eq!(clock.get_tick(), 480);
            assert!(out.iter().any(|&s| s != T::EQUILIBRIUM));

            ctl.pause();
            for _ in 0..5 {
                out.fill(T::from_sample(0.7f32));
                core.render(&mut out, None);
                assert!(out.iter().all(|&s| s == T::EQUILIBRIUM));
                assert_eq!(clock.get_tick(), 480);
            }
            ctl.play();
            core.render(&mut out, None);
            assert_eq!(clock.get_tick(), 960);
        }
        check::<f32>();
        check::<i16>();
        check::<u16>();
    }

    #[test]
    fn seek_sampel_akurat() {
        let (mut core, ctl, clock) = core_with(10 * 48_000, 48_000, 1);
        ctl.play();
        let mut out = vec![0.0f32; 333];
        core.render(&mut out, None);
        ctl.seek(123_457);
        core.render(&mut out, None);
        assert_eq!(out[0], synth(123_457));
        assert_eq!(out[332], synth(123_457 + 332));
        assert_eq!(clock.get_tick(), 123_457 + 333);
        // Seek saat jeda: posisi langsung tercermin, tanpa audio.
        ctl.pause();
        ctl.seek(7);
        core.render(&mut out, None);
        assert_eq!(clock.get_tick(), 7);
        assert!(out.iter().all(|&s| s == 0.0));
        ctl.play();
        core.render(&mut out, None);
        assert_eq!(out[0], synth(7));
        // Tick negatif → 0.
        ctl.seek(-500);
        core.render(&mut out, None);
        assert_eq!(out[0], synth(0));
        assert_eq!(clock.get_tick(), 333);
    }

    #[test]
    fn mencapai_akhir_berhenti_dan_melapor_selesai() {
        let (mut core, ctl, clock) = core_with(1000, 48_000, 2);
        ctl.play();
        let mut out = vec![5.0f32; 600 * 2];
        core.render(&mut out, None);
        assert!(!ctl.is_finished());
        assert_eq!(clock.get_tick(), 600);

        core.render(&mut out, None); // hanya 400 frame tersisa
        assert!(ctl.is_finished());
        assert!(!ctl.is_playing());
        assert!(!clock.is_playing());
        assert_eq!(clock.get_tick(), 1000);
        assert_eq!(out[399 * 2], synth(999));
        assert!(out[400 * 2..].iter().all(|&s| s == 0.0));

        for _ in 0..3 {
            core.render(&mut out, None);
            assert_eq!(clock.get_tick(), 1000);
            assert!(out.iter().all(|&s| s == 0.0));
        }

        // play() setelah selesai → mulai dari awal.
        ctl.play();
        core.render(&mut out, None);
        assert!(!ctl.is_finished());
        assert_eq!(out[0], synth(0));
        assert_eq!(clock.get_tick(), 600);
    }

    #[test]
    fn seek_melewati_akhir_di_clamp_dan_selesai() {
        let (mut core, ctl, clock) = core_with(1000, 48_000, 1);
        ctl.play();
        ctl.seek(999_999);
        let mut out = vec![1.0f32; 100];
        core.render(&mut out, None);
        assert!(ctl.is_finished());
        assert_eq!(clock.get_tick(), 1000);
        assert!(out.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn mono_diduplikasi_ke_semua_kanal_dan_volume_berlaku() {
        let (mut core, ctl, _clock) = core_with(48_000, 48_000, 6);
        ctl.set_volume(0.5);
        ctl.play();
        let mut out = vec![0.0f32; 4 * 6 + 3]; // sisa 3 slot (bukan frame utuh) → hening
        core.render(&mut out, None);
        for f in 0..4 {
            for c in 0..6 {
                assert_eq!(out[f * 6 + c], synth(f as u64) * 0.5);
            }
        }
        assert!(out[24..].iter().all(|&s| s == 0.0));
        ctl.set_volume(f32::NAN);
        assert_eq!(ctl.volume(), 0.0);
        ctl.set_volume(7.0);
        assert_eq!(ctl.volume(), 1.0);
    }

    #[test]
    fn latensi_perangkat_dikurangkan_dari_jam() {
        let (mut core, ctl, clock) = core_with(48_000, 48_000, 2);
        ctl.play();
        let mut out = vec![0.0f32; 4800 * 2];
        core.render(&mut out, Some(Duration::from_millis(10)));
        assert_eq!(clock.get_tick(), 4800 - 480);
        core.render(&mut out, Some(Duration::from_millis(10)));
        assert_eq!(clock.get_tick(), 9600 - 480);
    }

    #[test]
    fn konversi_tick_frame_bulat_ke_bawah() {
        assert_eq!(frames_to_ticks(44_100, 44_100), 48_000);
        assert_eq!(frames_to_ticks(1, 44_100), 1);
        assert_eq!(ticks_to_frames(48_000, 44_100), 44_100);
        assert_eq!(ticks_to_frames(-5, 48_000), 0);
        assert_eq!(frames_to_ticks(123_456, 48_000), 123_456);
    }

    #[test]
    fn sumber_kosong_atau_parameter_nol_ditolak() {
        let clock = AudioClock::new();
        assert!(PlayerCore::new(Synth { len: 0 }, 48_000, 2, clock.clone()).is_err());
        assert!(PlayerCore::new(Synth { len: 1 }, 0, 2, clock.clone()).is_err());
        assert!(PlayerCore::new(Synth { len: 1 }, 48_000, 0, clock).is_err());
    }

    #[test]
    fn buffer_source_di_luar_jangkauan_hening_tanpa_panic() {
        let s = BufferSource::new(vec![0.25; 4]);
        let mut dst = [1.0f32; 3];
        s.read(3, &mut dst);
        assert_eq!(dst, [0.0; 3]);
        s.read(1, &mut dst);
        assert_eq!(dst, [0.25; 3]);
    }

    /// Smoke test perangkat nyata: sinus 3 dtk pada volume 0 (senyap); jam harus maju ~1 dtk
    /// per 1 dtk waktu dinding.
    #[test]
    #[ignore = "butuh perangkat audio"]
    fn smoke_perangkat_nyata_jam_maju_sesuai_waktu_dinding() {
        let rate = AudioEngine::default_output_sample_rate().expect("perangkat keluaran");
        let samples: Vec<f32> = (0..rate as usize * 3)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin())
            .collect();
        let clock = AudioClock::new();
        let engine = AudioEngine::new(samples, rate, clock.clone()).expect("engine");
        engine.set_volume(0.0);
        engine.play();

        std::thread::sleep(Duration::from_millis(500));
        let (w0, t0) = (Instant::now(), clock.get_tick());
        std::thread::sleep(Duration::from_millis(1000));
        let (w1, t1) = (Instant::now(), clock.get_tick());

        let wall_ticks = w1.duration_since(w0).as_secs_f64() * f64::from(SAMPLE_RATE);
        let advanced = (t1 - t0) as f64;
        eprintln!(
            "rate={rate} Hz kanal={} tick maju={advanced} (~{:.3} dtk) waktu dinding={:.3} dtk",
            engine.device_channels(),
            advanced / f64::from(SAMPLE_RATE),
            wall_ticks / f64::from(SAMPLE_RATE)
        );
        assert!((advanced - wall_ticks).abs() < 0.1 * f64::from(SAMPLE_RATE));
        assert!(!engine.has_stream_error());

        // Seek pada perangkat nyata.
        engine.pause();
        engine.seek(48_000);
        std::thread::sleep(Duration::from_millis(300));
        let after = clock.get_tick();
        let raw = engine.control().position_frames();
        eprintln!("setelah seek ke 48000 saat jeda: posisi frame={raw}, jam={after}");
        // Posisi frame yang diserahkan ke perangkat persis hasil seek; jam = posisi − latensi.
        assert_eq!(raw, u64::from(rate));
        assert!(after <= 48_000 && after >= 48_000 - i64::from(SAMPLE_RATE) / 5);
    }
}
