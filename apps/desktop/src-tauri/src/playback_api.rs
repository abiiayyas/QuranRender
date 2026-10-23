//! Playback audio proyek lewat `qr_media::AudioEngine`.
//!
//! `cpal::Stream` (di dalam `AudioEngine`) tidak aman dipindah antar thread di beberapa host, jadi engine
//! dibuat dan dimiliki satu thread khusus; perintah Tauri berkomunikasi lewat kanal. Logika kontrol
//! ([`PlaybackController`]) murni dan diuji dengan engine palsu; engine nyata hanya di [`RealEngine`].

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use qr_media::{decode_audio_mono_f32, AudioClock, AudioEngine};
use serde::Serialize;
use specta::Type;

/// Batas menunggu jawaban thread engine (membuka stream perangkat bisa lambat, tetapi tidak boleh menggantung UI).
const REPLY_TIMEOUT: Duration = Duration::from_secs(20);

/// Status playback. `tick` dalam tick 48 kHz.
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct PlaybackStatus {
    pub loaded: bool,
    pub playing: bool,
    pub tick: f64,
    pub finished: bool,
    pub error: Option<String>,
}

impl PlaybackStatus {
    fn unloaded() -> Self {
        Self {
            loaded: false,
            playing: false,
            tick: 0.0,
            finished: false,
            error: None,
        }
    }
}

/// Engine yang dikendalikan controller. Tidak perlu `Send`: instance dibuat dan hidup di thread engine.
pub trait PlaybackEngine {
    fn play(&self);
    fn pause(&self);
    fn seek(&self, tick: i64);
    fn tick(&self) -> i64;
    fn is_playing(&self) -> bool;
    fn is_finished(&self) -> bool;
    fn error(&self) -> Option<String>;
    fn duration_ticks(&self) -> i64;
}

/// Pembuat engine dari sampel mono pada `sample_rate` perangkat.
pub type EngineFactory =
    Arc<dyn Fn(Vec<f32>, u32) -> Result<Box<dyn PlaybackEngine>, String> + Send + Sync>;

/// Adaptor `qr_media::AudioEngine`.
pub struct RealEngine(AudioEngine);

impl RealEngine {
    pub fn open(samples: Vec<f32>, sample_rate: u32, volume: f32) -> Result<Self, String> {
        let engine = AudioEngine::new(samples, sample_rate, AudioClock::new())
            .map_err(|e| format!("Perangkat audio tidak dapat dibuka: {e}"))?;
        engine.set_volume(volume);
        Ok(Self(engine))
    }
}

impl PlaybackEngine for RealEngine {
    fn play(&self) {
        self.0.play();
    }
    fn pause(&self) {
        self.0.pause();
    }
    fn seek(&self, tick: i64) {
        self.0.seek(tick);
    }
    fn tick(&self) -> i64 {
        self.0.clock().get_tick()
    }
    fn is_playing(&self) -> bool {
        self.0.is_playing()
    }
    fn is_finished(&self) -> bool {
        self.0.is_finished()
    }
    fn error(&self) -> Option<String> {
        self.0.has_stream_error().then(|| {
            "Stream audio gagal (perangkat dicabut atau berubah). Muat ulang audio.".to_string()
        })
    }
    fn duration_ticks(&self) -> i64 {
        self.0.duration_ticks()
    }
}

/// Factory engine nyata dengan volume awal `volume` (0.0..=1.0).
pub fn real_factory(volume: f32) -> EngineFactory {
    Arc::new(move |samples, rate| {
        Ok(Box::new(RealEngine::open(samples, rate, volume)?) as Box<dyn PlaybackEngine>)
    })
}

/// Logika kontrol murni: satu engine aktif, galat jelas bila belum dimuat.
pub struct PlaybackController {
    factory: EngineFactory,
    engine: Option<Box<dyn PlaybackEngine>>,
}

impl std::fmt::Debug for PlaybackController {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlaybackController")
            .field("loaded", &self.engine.is_some())
            .finish_non_exhaustive()
    }
}

const NOT_LOADED: &str = "Belum ada audio yang dimuat. Panggil playback_load dulu.";

impl PlaybackController {
    pub fn new(factory: EngineFactory) -> Self {
        Self {
            factory,
            engine: None,
        }
    }

    /// Menggantikan engine aktif dengan audio baru (dalam keadaan jeda, tick 0). Bila gagal, engine lama
    /// dilepas juga agar status tidak berbohong tentang apa yang dimuat.
    pub fn load(&mut self, samples: Vec<f32>, sample_rate: u32) -> Result<(), String> {
        self.engine = None;
        if samples.is_empty() {
            return Err("Audio kosong; tidak ada yang bisa diputar".to_string());
        }
        self.engine = Some((self.factory)(samples, sample_rate)?);
        Ok(())
    }

    fn engine(&self) -> Result<&dyn PlaybackEngine, String> {
        self.engine.as_deref().ok_or_else(|| NOT_LOADED.to_string())
    }

    pub fn play(&self) -> Result<(), String> {
        self.engine()?.play();
        Ok(())
    }

    pub fn pause(&self) -> Result<(), String> {
        self.engine()?.pause();
        Ok(())
    }

    /// Seek ke `tick` (48 kHz); di-clamp ke [0, durasi]. Nilai tak hingga/NaN ditolak.
    pub fn seek(&self, tick: f64) -> Result<(), String> {
        let engine = self.engine()?;
        if !tick.is_finite() {
            return Err(format!("Posisi seek tidak valid: {tick}"));
        }
        let max = engine.duration_ticks().max(0);
        let target = if tick <= 0.0 {
            0
        } else {
            (tick as i64).min(max)
        };
        engine.seek(target);
        Ok(())
    }

    pub fn status(&self) -> PlaybackStatus {
        match self.engine.as_deref() {
            None => PlaybackStatus::unloaded(),
            Some(e) => PlaybackStatus {
                loaded: true,
                playing: e.is_playing(),
                tick: e.tick().max(0) as f64,
                finished: e.is_finished(),
                error: e.error(),
            },
        }
    }
}

enum Msg {
    Load {
        samples: Vec<f32>,
        sample_rate: u32,
        reply: Sender<Result<PlaybackStatus, String>>,
    },
    Play(Sender<Result<PlaybackStatus, String>>),
    Pause(Sender<Result<PlaybackStatus, String>>),
    Seek(f64, Sender<Result<PlaybackStatus, String>>),
    Status(Sender<Result<PlaybackStatus, String>>),
}

fn engine_thread(factory: EngineFactory, rx: mpsc::Receiver<Msg>) {
    let mut ctl = PlaybackController::new(factory);
    // Berakhir sendiri saat semua pengirim di-drop (service di-drop) → engine/stream ikut di-drop di thread ini.
    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Load {
                samples,
                sample_rate,
                reply,
            } => {
                let r = ctl.load(samples, sample_rate).map(|()| ctl.status());
                let _ = reply.send(r);
            }
            Msg::Play(reply) => {
                let _ = reply.send(ctl.play().map(|()| ctl.status()));
            }
            Msg::Pause(reply) => {
                let _ = reply.send(ctl.pause().map(|()| ctl.status()));
            }
            Msg::Seek(tick, reply) => {
                let _ = reply.send(ctl.seek(tick).map(|()| ctl.status()));
            }
            Msg::Status(reply) => {
                let _ = reply.send(Ok(ctl.status()));
            }
        }
    }
}

/// Pegangan thread engine; dibuat malas pada `load` pertama.
pub struct PlaybackService {
    factory: EngineFactory,
    tx: Mutex<Option<Sender<Msg>>>,
}

impl std::fmt::Debug for PlaybackService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlaybackService").finish_non_exhaustive()
    }
}

impl PlaybackService {
    pub fn new(factory: EngineFactory) -> Self {
        Self {
            factory,
            tx: Mutex::new(None),
        }
    }

    pub fn real() -> Self {
        Self::new(real_factory(1.0))
    }

    fn sender(&self, create: bool) -> Result<Option<Sender<Msg>>, String> {
        let mut guard = self.tx.lock().map_err(|e| e.to_string())?;
        if guard.is_none() && create {
            let (tx, rx) = mpsc::channel();
            let factory = self.factory.clone();
            std::thread::Builder::new()
                .name("qr-audio-engine".into())
                .spawn(move || engine_thread(factory, rx))
                .map_err(|e| format!("Thread audio tidak dapat dibuat: {e}"))?;
            *guard = Some(tx);
        }
        Ok(guard.clone())
    }

    fn call(
        &self,
        create: bool,
        make: impl FnOnce(Sender<Result<PlaybackStatus, String>>) -> Msg,
    ) -> Result<PlaybackStatus, String> {
        let Some(tx) = self.sender(create)? else {
            return Err(NOT_LOADED.to_string());
        };
        let (rtx, rrx) = mpsc::channel();
        if tx.send(make(rtx)).is_err() {
            // Thread engine mati (mis. panik di driver): lepas agar `load` berikutnya membuat thread baru.
            *self.tx.lock().map_err(|e| e.to_string())? = None;
            return Err("Mesin audio berhenti tak terduga. Muat ulang audio.".to_string());
        }
        match rrx.recv_timeout(REPLY_TIMEOUT) {
            Ok(r) => r,
            Err(RecvTimeoutError::Timeout) => {
                Err("Mesin audio tidak merespons (perangkat audio macet?).".to_string())
            }
            Err(RecvTimeoutError::Disconnected) => {
                *self.tx.lock().map_err(|e| e.to_string())? = None;
                Err("Mesin audio berhenti tak terduga. Muat ulang audio.".to_string())
            }
        }
    }

    /// Memuat sampel mono pada `sample_rate` (rate perangkat) ke engine.
    pub fn load_samples(
        &self,
        samples: Vec<f32>,
        sample_rate: u32,
    ) -> Result<PlaybackStatus, String> {
        self.call(true, |reply| Msg::Load {
            samples,
            sample_rate,
            reply,
        })
    }

    pub fn play(&self) -> Result<PlaybackStatus, String> {
        self.call(false, Msg::Play)
    }

    pub fn pause(&self) -> Result<PlaybackStatus, String> {
        self.call(false, Msg::Pause)
    }

    pub fn seek(&self, tick: f64) -> Result<PlaybackStatus, String> {
        self.call(false, |reply| Msg::Seek(tick, reply))
    }

    pub fn status(&self) -> PlaybackStatus {
        // Tanpa engine / thread mati: status "belum dimuat"; galat komunikasi disampaikan di `error`.
        match self.call(false, Msg::Status) {
            Ok(s) => s,
            Err(e) if e == NOT_LOADED => PlaybackStatus::unloaded(),
            Err(e) => PlaybackStatus {
                error: Some(e),
                ..PlaybackStatus::unloaded()
            },
        }
    }
}

/// Memuat audio proyek ke playback: sample rate perangkat → dekode pada rate itu → engine.
/// Tanpa perangkat audio mengembalikan `Err` (bukan panik).
pub fn load_project_audio(
    service: &PlaybackService,
    audio: &std::path::Path,
    ffmpeg: &str,
) -> Result<(), String> {
    let rate = AudioEngine::default_output_sample_rate()
        .map_err(|e| format!("Tidak dapat memutar audio: {e}"))?;
    let samples = decode_audio_mono_f32(ffmpeg, audio, rate)
        .map_err(|e| format!("Audio tidak dapat didekode ({}): {e}", audio.display()))?;
    service.load_samples(samples, rate).map(|_| ())
}

/// Memuat audio proyek ke engine playback (didekode pada sample rate perangkat). `Err` bila tidak ada
/// perangkat audio, proyek belum punya audio, atau berkas hilang.
#[tauri::command]
#[specta::specta]
pub async fn playback_load(
    project_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let (_, project) = crate::project_io::load_registered(&state.db, &project_id)?;
    let audio = crate::project_io::require_project_audio(&project)?;
    load_project_audio(&state.playback, &audio, &crate::tools::media_tool("ffmpeg"))
}

#[tauri::command]
#[specta::specta]
pub fn playback_play(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    state.playback.play().map(|_| ())
}

#[tauri::command]
#[specta::specta]
pub fn playback_pause(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    state.playback.pause().map(|_| ())
}

/// Seek ke `tick` (48 kHz); di-clamp ke [0, durasi].
#[tauri::command]
#[specta::specta]
pub fn playback_seek(tick: f64, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    state.playback.seek(tick).map(|_| ())
}

/// Status playback; `tick` dibaca dari jam audio (48 kHz). Aman dipanggil berkala (mis. tiap frame).
#[tauri::command]
#[specta::specta]
pub fn playback_status(state: tauri::State<'_, crate::AppState>) -> PlaybackStatus {
    state.playback.status()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

    /// Engine palsu: mencatat panggilan, tanpa perangkat.
    #[derive(Default)]
    struct FakeState {
        playing: AtomicBool,
        finished: AtomicBool,
        tick: AtomicI64,
        duration: i64,
        fail_error: Option<String>,
    }

    struct FakeEngine(Arc<FakeState>);

    impl PlaybackEngine for FakeEngine {
        fn play(&self) {
            if self.0.finished.swap(false, Ordering::SeqCst) {
                self.0.tick.store(0, Ordering::SeqCst);
            }
            self.0.playing.store(true, Ordering::SeqCst);
        }
        fn pause(&self) {
            self.0.playing.store(false, Ordering::SeqCst);
        }
        fn seek(&self, tick: i64) {
            self.0.tick.store(tick, Ordering::SeqCst);
        }
        fn tick(&self) -> i64 {
            self.0.tick.load(Ordering::SeqCst)
        }
        fn is_playing(&self) -> bool {
            self.0.playing.load(Ordering::SeqCst)
        }
        fn is_finished(&self) -> bool {
            self.0.finished.load(Ordering::SeqCst)
        }
        fn error(&self) -> Option<String> {
            self.0.fail_error.clone()
        }
        fn duration_ticks(&self) -> i64 {
            self.0.duration
        }
    }

    fn fake_factory(state: Arc<FakeState>) -> EngineFactory {
        Arc::new(move |samples, rate| {
            assert!(!samples.is_empty() && rate > 0);
            Ok(Box::new(FakeEngine(state.clone())) as Box<dyn PlaybackEngine>)
        })
    }

    fn state(duration: i64) -> Arc<FakeState> {
        Arc::new(FakeState {
            duration,
            ..FakeState::default()
        })
    }

    #[test]
    fn controller_requires_load_before_transport_commands() {
        let c = PlaybackController::new(fake_factory(state(100)));
        for r in [c.play(), c.pause(), c.seek(5.0)] {
            assert!(r.unwrap_err().contains("playback_load"));
        }
        assert_eq!(c.status(), PlaybackStatus::unloaded());
    }

    #[test]
    fn controller_play_pause_seek_status_flow() {
        let st = state(48_000 * 10);
        let mut c = PlaybackController::new(fake_factory(st.clone()));
        c.load(vec![0.0; 100], 48_000).unwrap();
        let s = c.status();
        assert!(s.loaded && !s.playing && !s.finished && s.error.is_none());

        c.play().unwrap();
        assert!(c.status().playing);
        c.seek(48_000.0 * 3.0).unwrap();
        assert_eq!(c.status().tick, 144_000.0);
        c.pause().unwrap();
        assert!(!c.status().playing);

        // Di-clamp ke [0, durasi]; negatif → 0.
        c.seek(1e12).unwrap();
        assert_eq!(c.status().tick, 480_000.0);
        c.seek(-50.0).unwrap();
        assert_eq!(c.status().tick, 0.0);
        // NaN/∞ ditolak dan tidak mengubah posisi.
        c.seek(1000.0).unwrap();
        assert!(c.seek(f64::NAN).is_err());
        assert!(c.seek(f64::INFINITY).is_err());
        assert_eq!(c.status().tick, 1000.0);

        // Selesai: play lagi mulai dari awal.
        st.finished.store(true, Ordering::SeqCst);
        assert!(c.status().finished);
        c.play().unwrap();
        let s = c.status();
        assert!(!s.finished && s.tick == 0.0 && s.playing);
    }

    #[test]
    fn controller_reports_engine_error_and_unloads_on_failed_load() {
        let st = Arc::new(FakeState {
            duration: 10,
            fail_error: Some("perangkat dicabut".into()),
            ..FakeState::default()
        });
        let mut c = PlaybackController::new(fake_factory(st));
        c.load(vec![0.0; 10], 48_000).unwrap();
        assert_eq!(c.status().error.as_deref(), Some("perangkat dicabut"));

        // Muat gagal → engine lama dilepas (status tidak berbohong).
        assert!(c.load(vec![], 48_000).unwrap_err().contains("kosong"));
        assert!(!c.status().loaded);

        let failing: EngineFactory =
            Arc::new(|_, _| Err("Perangkat audio tidak dapat dibuka: tidak ada".into()));
        let mut c2 = PlaybackController::new(failing);
        let err = c2.load(vec![0.0; 10], 48_000).unwrap_err();
        assert!(err.contains("Perangkat audio"), "{err}");
        assert!(!c2.status().loaded);
    }

    #[test]
    fn service_runs_engine_on_a_dedicated_thread_and_never_panics_without_device() {
        let main_thread = std::thread::current().id();
        let st = state(48_000 * 5);
        let seen_thread = Arc::new(Mutex::new(None));
        let seen2 = seen_thread.clone();
        let st2 = st.clone();
        let factory: EngineFactory = Arc::new(move |_, _| {
            *seen2.lock().unwrap() = Some(std::thread::current().id());
            Ok(Box::new(FakeEngine(st2.clone())) as Box<dyn PlaybackEngine>)
        });
        let svc = PlaybackService::new(factory);

        // Sebelum load: status "belum dimuat", transport → Err.
        assert!(!svc.status().loaded);
        assert!(svc.play().unwrap_err().contains("playback_load"));

        svc.load_samples(vec![0.0; 10], 48_000).unwrap();
        assert_ne!(seen_thread.lock().unwrap().unwrap(), main_thread);
        svc.play().unwrap();
        svc.seek(48_000.0).unwrap();
        let s = svc.status();
        assert!(s.loaded && s.playing);
        assert_eq!(s.tick, 48_000.0);
        svc.pause().unwrap();
        assert!(!svc.status().playing);

        // Tanpa perangkat: factory gagal → Err jelas, service tetap hidup untuk percobaan berikutnya.
        let bad = PlaybackService::new(Arc::new(|_, _| {
            Err("tidak ada perangkat keluaran audio".into())
        }));
        let err = bad.load_samples(vec![0.0; 10], 48_000).unwrap_err();
        assert!(err.contains("perangkat"), "{err}");
        assert!(!bad.status().loaded);
    }

    #[test]
    fn service_recovers_when_the_engine_thread_panics() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let c2 = calls.clone();
        let st = state(100);
        let factory: EngineFactory = Arc::new(move |_, _| {
            if c2.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("driver audio meledak (uji)");
            }
            Ok(Box::new(FakeEngine(st.clone())) as Box<dyn PlaybackEngine>)
        });
        let svc = PlaybackService::new(factory);
        let err = svc.load_samples(vec![0.0; 4], 48_000).unwrap_err();
        assert!(err.contains("berhenti"), "{err}");
        // Muat ulang membuat thread baru dan berhasil.
        svc.load_samples(vec![0.0; 4], 48_000).unwrap();
        assert!(svc.status().loaded);
    }

    #[test]
    #[ignore = "butuh perangkat audio; jalankan: cargo test -p quranrender -- --ignored"]
    fn real_engine_plays_a_sine_at_volume_zero_through_the_service() {
        let tmp = crate::project_io::test_support::TempDir::new("play");
        let wav = tmp.path().join("sine.wav");
        crate::project_io::test_support::make_sine_wav(&wav, 3.0, 440);
        let svc = PlaybackService::new(real_factory(0.0));
        let rate = AudioEngine::default_output_sample_rate().expect("perangkat keluaran audio");
        let samples =
            decode_audio_mono_f32(&crate::tools::media_tool("ffmpeg"), &wav, rate).unwrap();
        svc.load_samples(samples, rate).unwrap();
        assert!(svc.status().loaded && !svc.status().playing);
        svc.play().unwrap();
        std::thread::sleep(Duration::from_millis(600));
        let s = svc.status();
        assert!(s.playing && s.error.is_none(), "{s:?}");
        assert!(
            s.tick > 48_000.0 * 0.2 && s.tick < 48_000.0 * 2.0,
            "tick {}",
            s.tick
        );
        svc.seek(48_000.0 * 2.0).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let s = svc.status();
        assert!(s.tick >= 48_000.0 * 2.0, "setelah seek: {}", s.tick);
        svc.pause().unwrap();
        let t1 = svc.status().tick;
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(svc.status().tick, t1, "jam tidak maju saat jeda");
    }
}
