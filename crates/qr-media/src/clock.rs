//! Jam master audio berbasis tick (48.000 Hz) dan kontrol sinkronisasi playback (PRD SYN-9, RND-3).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §6 dan 04_IMPLEMENTATION_PLAN.md A1-05.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;

pub const SAMPLE_RATE: u32 = 48_000;

/// Jam master audio berbasis tick integer 64-bit tanpa drift floating-point.
#[derive(Debug, Clone)]
pub struct AudioClock {
    /// Posisi playback saat ini dalam satuan tick (1 tick = 1 sampel pada 48 kHz).
    current_tick: Arc<AtomicI64>,
    /// Status apakah audio sedang diputar.
    playing: Arc<AtomicBool>,
    /// Latensi hardware audio yang dilaporkan oleh driver audio (dalam sampel/tick).
    hardware_latency_ticks: Arc<AtomicI64>,
}

impl Default for AudioClock {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioClock {
    pub fn new() -> Self {
        Self {
            current_tick: Arc::new(AtomicI64::new(0)),
            playing: Arc::new(AtomicBool::new(false)),
            hardware_latency_ticks: Arc::new(AtomicI64::new(0)),
        }
    }

    /// Mengambil posisi waktu tick saat ini yang diselaraskan dengan keluaran speaker.
    /// Rumus (01 §6): `samples_handed_to_device - hardware_latency`.
    pub fn get_tick(&self) -> i64 {
        let raw = self.current_tick.load(Ordering::Relaxed);
        let lat = self.hardware_latency_ticks.load(Ordering::Relaxed);
        (raw - lat).max(0)
    }

    /// Mengubah posisi playhead (seek) ke tick tertentu.
    pub fn seek(&self, target_tick: i64) {
        self.current_tick
            .store(target_tick.max(0), Ordering::SeqCst);
    }

    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }

    pub fn set_playing(&self, playing: bool) {
        self.playing.store(playing, Ordering::SeqCst);
    }

    pub fn set_hardware_latency(&self, latency_ticks: i64) {
        self.hardware_latency_ticks
            .store(latency_ticks, Ordering::Relaxed);
    }

    /// Memajukan jam audio sebanyak `sample_frames` (dipanggil di dalam callback cpal audio thread).
    /// Bersifat realtime-safe (lock-free dan tanpa alokasi memori).
    pub fn advance_frames(&self, sample_frames: usize) {
        if self.is_playing() {
            self.current_tick
                .fetch_add(sample_frames as i64, Ordering::Relaxed);
        }
    }
}

/// Menghitung tick awal frame ke-n pada fps rasional num/den (01 §6).
/// Menggunakan pembulatan ke bawah yang deterministik.
pub fn frame_to_tick(frame_index: u64, fps_num: u32, fps_den: u32) -> i64 {
    ((frame_index as i64) * (SAMPLE_RATE as i64) * (fps_den as i64)) / (fps_num as i64)
}

/// Menghitung index frame terdekat dari posisi tick tertentu.
pub fn tick_to_frame(tick: i64, fps_num: u32, fps_den: u32) -> u64 {
    let num = fps_num as i64;
    let den = fps_den as i64;
    let sr = SAMPLE_RATE as i64;
    ((tick * num) / (sr * den)).max(0) as u64
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_clock_seek_and_latency() {
        let clock = AudioClock::new();
        assert_eq!(clock.get_tick(), 0);

        clock.seek(48_000); // Seek ke 1 detik
        assert_eq!(clock.get_tick(), 48_000);

        clock.set_hardware_latency(480); // Latensi 10 ms (480 tick)
        assert_eq!(clock.get_tick(), 48_000 - 480);
    }

    #[test]
    fn test_rational_fps_frame_to_tick() {
        // 30 fps standar (30/1): 1 frame = 1.600 tick
        assert_eq!(frame_to_tick(0, 30, 1), 0);
        assert_eq!(frame_to_tick(1, 30, 1), 1600);
        assert_eq!(frame_to_tick(30, 30, 1), 48000);

        // 24 fps film (24/1): 1 frame = 2.000 tick
        assert_eq!(frame_to_tick(1, 24, 1), 2000);

        // 29.97 fps NTSC (30000/1001) deterministik
        let tick_ntsc_1 = frame_to_tick(1, 30000, 1001);
        assert_eq!(tick_ntsc_1, 1601);
    }

    #[test]
    fn test_zero_drift_after_60_minutes_playback_simulation() {
        // Kriteria Selesai A1-05 & PRD SYN-9:
        // "Drift jam vs posisi sampel 0 setelah 60 menit playback (uji otomatis)"
        let clock = AudioClock::new();
        clock.set_playing(true);

        let sixty_minutes_seconds = 60 * 60; // 3600 detik
        let expected_total_ticks = (sixty_minutes_seconds as i64) * (SAMPLE_RATE as i64); // 172.800.000 tick

        // Simulasi callback buffer audio cpal: 1024 sampel per callback
        let buffer_size = 1024;
        let mut total_samples_fed = 0usize;

        while total_samples_fed < expected_total_ticks as usize {
            let frames = buffer_size.min(expected_total_ticks as usize - total_samples_fed);
            clock.advance_frames(frames);
            total_samples_fed += frames;
        }

        let actual_tick = clock.get_tick();

        // Drift harus TEPAT 0!
        let drift = actual_tick - expected_total_ticks;
        assert_eq!(
            drift, 0,
            "Drift jam audio harus tepat 0 setelah 60 menit, ditemukan {} tick",
            drift
        );
    }
}
