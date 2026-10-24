//! Latar media proyek (gambar/video) untuk jalur render bersama: preview (satu frame pada tick) dan
//! ekspor (frame berurutan). Keduanya memakai penskalaan *cover-fit* yang sama (`qr-media::background`)
//! dan pemetaan waktu yang sama (`map_timeline_to_source_tick`, putaran/pemotongan), sehingga frame
//! latar pada tick yang sama identik di preview dan ekspor.
//!
//! Frame video dikuantisasi ke fps proyek: frame ke-`j` = frame sumber pada waktu `j / fps` dari titik
//! `trim_in` putaran tersebut (ekspor memakai filter `fps`, preview mencari ke `j/fps − ½ frame`).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use qr_core::project::{AssetKind, Project, TrackKind};
use qr_media::{
    extract_cover_frame, map_timeline_to_source_tick, BackgroundKind, LoopingCoverVideo,
    VideoPlaybackFx,
};
use qr_render::{background_pixmap, Pixmap};

/// Tick proyek = sampel pada 48 kHz.
const TICKS_PER_SECOND: i64 = 48_000;

/// Batas cache frame latar preview: jumlah entri dan total byte piksel.
const CACHE_MAX_ENTRIES: usize = 48;
const CACHE_MAX_BYTES: usize = 96 * 1024 * 1024;

/// Fps bilangan bulat yang dipakai ekspor (`fps_num / fps_den`, minimal 1); preview memakai nilai sama.
pub fn project_fps(project: &Project) -> u32 {
    (project.canvas.fps_num / project.canvas.fps_den.max(1)).max(1)
}

/// Akhir timeline proyek (tick): terjauh antara akhir segmen terakhir dan durasi aset audio. 0 bila kosong.
pub fn timeline_end_ticks(project: &Project) -> i64 {
    let segments = project
        .segments
        .iter()
        .map(|s| s.end_tick)
        .max()
        .unwrap_or(0);
    let audio = project
        .assets
        .values()
        .filter(|a| a.kind == AssetKind::Audio)
        .map(|a| a.duration_ticks)
        .max()
        .unwrap_or(0);
    segments.max(audio)
}

/// Klip latar proyek beserta berkas medianya.
#[derive(Debug, Clone, PartialEq)]
pub struct BackgroundPlan {
    pub path: PathBuf,
    pub kind: BackgroundKind,
    clip_start: i64,
    clip_end: i64,
    trim_in: i64,
    trim_out: i64,
    fps: u32,
}

impl BackgroundPlan {
    /// Klip latar pertama yang memuat aset pada track latar yang terlihat; `None` bila tidak ada latar
    /// media. Gagal bila klip merujuk aset yang tidak terdaftar atau bukan gambar/video.
    pub fn from_project(project: &Project) -> Result<Option<Self>, String> {
        let clip = project
            .tracks
            .iter()
            .filter(|t| t.kind == TrackKind::Background && t.visible)
            .flat_map(|t| t.clips.iter())
            .find(|c| c.asset_id.is_some());
        let Some(clip) = clip else {
            return Ok(None);
        };
        let id = clip.asset_id.as_deref().unwrap_or_default();
        let asset = project
            .assets
            .get(id)
            .ok_or_else(|| format!("Aset latar '{id}' tidak terdaftar di proyek"))?;
        let kind = match asset.kind {
            AssetKind::Image => BackgroundKind::Image,
            AssetKind::Video => BackgroundKind::Video,
            _ => {
                return Err(format!(
                    "Aset latar '{id}' bukan gambar atau video ({:?})",
                    asset.kind
                ))
            }
        };
        Ok(Some(Self {
            path: PathBuf::from(&asset.path),
            kind,
            clip_start: clip.start_tick,
            // Latar menutupi seluruh timeline: audio/segmen yang ditambahkan sesudah impor latar
            // (atau diperpanjang) tidak membuat latar berhenti di tengah video.
            clip_end: clip.end_tick.max(timeline_end_ticks(project)),
            trim_in: clip.trim_in_tick,
            trim_out: clip.trim_out_tick,
            fps: project_fps(project),
        }))
    }

    /// Apakah klip latar menutupi `tick` (di luar klip → latar warna).
    pub fn is_active(&self, tick: i64) -> bool {
        tick >= self.clip_start && tick < self.clip_end
    }

    fn pass_duration_sec(&self) -> f64 {
        (self.trim_out - self.trim_in).max(1) as f64 / TICKS_PER_SECOND as f64
    }

    /// Indeks frame video (pada `fps` proyek) dalam satu putaran sumber untuk `tick`: video diputar
    /// berulang bila lebih pendek dari klip, dan klip yang lebih pendek dari video memotongnya.
    pub fn video_frame_index(&self, tick: i64) -> u64 {
        let src = map_timeline_to_source_tick(
            tick,
            self.clip_start,
            self.trim_in,
            self.trim_out,
            &VideoPlaybackFx::default(),
        );
        let local_sec = (src - self.trim_in).max(0) as f64 / TICKS_PER_SECOND as f64;
        (local_sec * f64::from(self.fps)).round() as u64
    }

    /// Frame latar untuk preview pada `tick`, ukuran `width×height`. `Ok(None)` bila tick di luar klip
    /// atau berkas latar hilang (preview jatuh ke warna dasar). Hasil di-cache (LRU) agar scrubbing
    /// tidak menjalankan FFmpeg berulang untuk frame yang sama.
    pub fn preview_frame(
        &self,
        ffmpeg_bin: &str,
        tick: i64,
        width: u32,
        height: u32,
    ) -> Result<Option<Arc<Pixmap>>, String> {
        if !self.is_active(tick) || !self.path.is_file() {
            return Ok(None);
        }
        let (index, seek) = match self.kind {
            BackgroundKind::Image => (None, None),
            BackgroundKind::Video => {
                let j = self.video_frame_index(tick);
                let trim_in_sec = self.trim_in as f64 / TICKS_PER_SECOND as f64;
                let seek = trim_in_sec + (j as f64 - 0.5).max(0.0) / f64::from(self.fps);
                (Some(j), Some(seek))
            }
        };
        let key = CacheKey::new(&self.path, width, height, index);
        if let Some(hit) = cache_get(&key) {
            return Ok(Some(hit));
        }
        let rgba = extract_cover_frame(ffmpeg_bin, &self.path, seek, width, height)?;
        let pm = background_pixmap(width, height, &rgba).map_err(|e| e.to_string())?;
        cache_put(key, Arc::clone(&pm));
        Ok(Some(pm))
    }

    /// Sumber frame berurutan untuk ekspor pada ukuran keluaran `width×height`. Gambar didekode sekali.
    pub fn export_frames(
        &self,
        ffmpeg_bin: &str,
        width: u32,
        height: u32,
    ) -> Result<BackgroundFrames, String> {
        let source = match self.kind {
            BackgroundKind::Image => {
                let rgba = extract_cover_frame(ffmpeg_bin, &self.path, None, width, height)?;
                Source::Image(background_pixmap(width, height, &rgba).map_err(|e| e.to_string())?)
            }
            BackgroundKind::Video => Source::Video {
                reader: LoopingCoverVideo::new(
                    ffmpeg_bin,
                    &self.path,
                    self.trim_in as f64 / TICKS_PER_SECOND as f64,
                    self.pass_duration_sec(),
                    self.fps,
                    width,
                    height,
                )?,
                last: None,
            },
        };
        Ok(BackgroundFrames {
            plan: self.clone(),
            width,
            height,
            source,
        })
    }
}

#[derive(Debug)]
enum Source {
    Image(Arc<Pixmap>),
    Video {
        reader: LoopingCoverVideo,
        /// Frame terakhir yang sudah dikonversi (indeks efektif, piksel) agar frame ganda tidak dikonversi ulang.
        last: Option<(u64, Arc<Pixmap>)>,
    },
}

/// Frame latar ekspor; dimiliki satu thread produsen yang meminta tick secara menaik.
#[derive(Debug)]
pub struct BackgroundFrames {
    plan: BackgroundPlan,
    width: u32,
    height: u32,
    source: Source,
}

impl BackgroundFrames {
    /// Frame latar pada `tick`; `None` bila tick di luar klip.
    pub fn frame(&mut self, tick: i64) -> Result<Option<Arc<Pixmap>>, String> {
        if !self.plan.is_active(tick) {
            return Ok(None);
        }
        match &mut self.source {
            Source::Image(pm) => Ok(Some(Arc::clone(pm))),
            Source::Video { reader, last } => {
                let want = self.plan.video_frame_index(tick);
                let (effective, rgba) = reader.frame(want)?;
                if let Some((idx, pm)) = last {
                    if *idx == effective {
                        return Ok(Some(Arc::clone(pm)));
                    }
                }
                let pm =
                    background_pixmap(self.width, self.height, rgba).map_err(|e| e.to_string())?;
                *last = Some((effective, Arc::clone(&pm)));
                Ok(Some(pm))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CacheKey {
    path: PathBuf,
    /// Waktu ubah + ukuran berkas: berkas yang diganti di path yang sama tidak memakai cache lama.
    stamp: (u128, u64),
    width: u32,
    height: u32,
    index: Option<u64>,
}

impl CacheKey {
    fn new(path: &Path, width: u32, height: u32, index: Option<u64>) -> Self {
        let stamp = std::fs::metadata(path)
            .ok()
            .map(|m| {
                let t = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_nanos());
                (t, m.len())
            })
            .unwrap_or_default();
        Self {
            path: path.to_path_buf(),
            stamp,
            width,
            height,
            index,
        }
    }
}

static CACHE: Mutex<VecDeque<(CacheKey, Arc<Pixmap>)>> = Mutex::new(VecDeque::new());

fn cache_get(key: &CacheKey) -> Option<Arc<Pixmap>> {
    let mut cache = CACHE.lock().ok()?;
    let pos = cache.iter().position(|(k, _)| k == key)?;
    let entry = cache.remove(pos)?;
    let pm = Arc::clone(&entry.1);
    cache.push_back(entry);
    Some(pm)
}

fn cache_put(key: CacheKey, pm: Arc<Pixmap>) {
    let Ok(mut cache) = CACHE.lock() else {
        return;
    };
    cache.push_back((key, pm));
    let mut bytes: usize = cache.iter().map(|(_, p)| p.data().len()).sum();
    while cache.len() > CACHE_MAX_ENTRIES || (bytes > CACHE_MAX_BYTES && cache.len() > 1) {
        if let Some((_, old)) = cache.pop_front() {
            bytes -= old.data().len();
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use qr_core::project::{AssetRef, Clip};

    fn project_with(kind: AssetKind, start: i64, end: i64, trim_out: i64) -> Project {
        let mut p = Project::new("bg");
        p.assets.insert(
            "bg_1".into(),
            AssetRef {
                id: "bg_1".into(),
                path: "/tmp/tidak-ada.mp4".into(),
                sha256: String::new(),
                kind,
                duration_ticks: trim_out,
                size_bytes: 0,
            },
        );
        let track = p
            .tracks
            .iter_mut()
            .find(|t| t.kind == TrackKind::Background)
            .unwrap();
        track.clips = vec![Clip {
            id: "clip_bg_1".into(),
            asset_id: Some("bg_1".into()),
            start_tick: start,
            end_tick: end,
            trim_in_tick: 0,
            trim_out_tick: trim_out,
            label: String::new(),
        }];
        p
    }

    #[test]
    fn plan_absent_without_media_clip_and_errors_on_unknown_asset() {
        let mut p = Project::new("kosong");
        assert_eq!(BackgroundPlan::from_project(&p).unwrap(), None);
        p = project_with(AssetKind::Video, 0, 480_000, 96_000);
        p.assets.clear();
        assert!(BackgroundPlan::from_project(&p)
            .unwrap_err()
            .contains("tidak terdaftar"));
        let p = project_with(AssetKind::Audio, 0, 480_000, 96_000);
        assert!(BackgroundPlan::from_project(&p)
            .unwrap_err()
            .contains("bukan gambar atau video"));
    }

    /// Video 2 dtk pada klip 5 dtk @30 fps: diputar berulang (putaran ke-2 mulai dari frame 0) dan
    /// klip berakhir pada 5 dtk (dipotong).
    #[test]
    fn video_shorter_than_clip_loops_and_clip_trims() {
        let p = project_with(AssetKind::Video, 0, 5 * 48_000, 2 * 48_000);
        let plan = BackgroundPlan::from_project(&p).unwrap().unwrap();
        assert_eq!(plan.video_frame_index(0), 0);
        assert_eq!(plan.video_frame_index(48_000 / 2), 15); // 0,5 dtk
        assert_eq!(plan.video_frame_index(2 * 48_000), 0); // awal putaran ke-2
        assert_eq!(plan.video_frame_index(2 * 48_000 + 48_000 / 2), 15);
        assert_eq!(plan.video_frame_index(4 * 48_000 + 24_000), 15); // putaran ke-3
        assert!(plan.is_active(5 * 48_000 - 1));
        assert!(!plan.is_active(5 * 48_000));
        assert!(!plan.is_active(-1));
    }

    #[test]
    fn video_longer_than_clip_is_trimmed_not_looped() {
        let p = project_with(AssetKind::Video, 0, 48_000, 10 * 48_000);
        let plan = BackgroundPlan::from_project(&p).unwrap().unwrap();
        assert_eq!(plan.video_frame_index(47_999), 30);
        assert!(!plan.is_active(48_000));
    }

    #[test]
    fn missing_file_falls_back_to_none_in_preview() {
        let p = project_with(AssetKind::Image, 0, 48_000, 48_000);
        let plan = BackgroundPlan::from_project(&p).unwrap().unwrap();
        assert!(plan.preview_frame("ffmpeg", 0, 64, 64).unwrap().is_none());
    }
}
