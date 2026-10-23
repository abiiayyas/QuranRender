//! Pemecahan proyek menjadi klip batch dan pengantrean render per klip.
//!
//! Catatan jujur tentang pustaka: `qr_jobs::enqueue_batch_jobs` memasukkan job dengan payload metadata klip
//! (bukan `RenderPayload`), sehingga worker `qurender` menolaknya (`INVALID_PAYLOAD`). Di sini tiap klip
//! dibuat menjadi **sub-proyek** sungguhan (segmen digeser ke 0, audio dipotong) dan dimasukkan sebagai job
//! render yang dapat dijalankan worker. Mode `by_marker` dan `manual_ranges` di pustaka belum diimplementasikan
//! (jatuh diam-diam ke per-ayat), jadi sengaja tidak diekspos.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use qr_core::project::{Project, TrackKind};
use qr_jobs::{split_project_into_batch_clips, BatchClipItem, BatchSplitMethod};
use qr_store::AppDb;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::audio_api::MediaTools;
use crate::export_api::{job_dto, BatchInfo, ExportService, JobDto, RenderJobSpec};
use crate::project_io::{load_registered, project_audio_path};

const TICKS_PER_SECOND: f64 = 48_000.0;

/// Mode pemecahan batch yang benar-benar didukung.
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum BatchMode {
    /// Satu klip per `count` ayat berurutan.
    ByAyahCount { count: u32 },
    /// Klip sepanjang mungkin tanpa melebihi `max_seconds` (satu ayat yang lebih panjang tetap satu klip).
    ByMaxDurationSec { max_seconds: u32 },
}

impl BatchMode {
    fn method(&self) -> Result<BatchSplitMethod, String> {
        match self {
            Self::ByAyahCount { count } if *count >= 1 => {
                Ok(BatchSplitMethod::ByAyahCount { count: *count })
            }
            Self::ByAyahCount { .. } => Err("Jumlah ayat per klip harus ≥ 1".to_string()),
            Self::ByMaxDurationSec { max_seconds } if *max_seconds >= 1 => {
                Ok(BatchSplitMethod::ByMaxDurationSec {
                    max_seconds: *max_seconds,
                })
            }
            Self::ByMaxDurationSec { .. } => {
                Err("Durasi maksimum klip harus ≥ 1 detik".to_string())
            }
        }
    }
}

/// Satu klip hasil pemecahan.
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct BatchClipDto {
    /// Mulai dari 1.
    pub clip_index: u32,
    pub title: String,
    pub surah_id: u32,
    pub start_ayah: u32,
    pub end_ayah: u32,
    /// Tick 48 kHz pada garis waktu proyek asal.
    pub start_tick: f64,
    pub end_tick: f64,
    pub duration_seconds: f64,
    /// Ada segmen berkeyakinan < 0,8 yang belum dikonfirmasi manual.
    pub has_low_confidence: bool,
}

fn clip_dto(c: &BatchClipItem) -> BatchClipDto {
    BatchClipDto {
        clip_index: u32::try_from(c.clip_index).unwrap_or(u32::MAX),
        title: c.title.clone(),
        surah_id: c.surah_id,
        start_ayah: c.start_ayah,
        end_ayah: c.end_ayah,
        start_tick: c.start_tick as f64,
        end_tick: c.end_tick as f64,
        duration_seconds: c.duration_seconds,
        has_low_confidence: c.has_low_confidence,
    }
}

fn split(project: &Project, mode: &BatchMode) -> Result<Vec<BatchClipItem>, String> {
    let method = mode.method()?;
    if project.segments.is_empty() {
        return Err(
            "Proyek belum memiliki segmen ayat; jalankan sinkron (penjajaran) lebih dulu"
                .to_string(),
        );
    }
    Ok(split_project_into_batch_clips(project, &method))
}

/// Pratinjau pemecahan batch tanpa efek samping.
pub fn batch_split_impl(
    db: &Mutex<AppDb>,
    project_id: &str,
    mode: &BatchMode,
) -> Result<Vec<BatchClipDto>, String> {
    let (_, project) = load_registered(db, project_id)?;
    Ok(split(&project, mode)?.iter().map(clip_dto).collect())
}

/// Sub-proyek untuk satu klip: hanya segmen yang berada penuh di dalam klip, ticks digeser agar klip mulai di 0.
/// Referensi audio proyek asal dihapus (audio klip diteruskan lewat payload job).
pub fn build_clip_project(project: &Project, clip: &BatchClipItem) -> Project {
    let shift = clip.start_tick;
    let mut p = project.clone();
    p.id = ulid::Ulid::generate().to_string();
    p.name = clip.title.clone();
    p.segments = project
        .segments
        .iter()
        .filter(|s| s.start_tick >= clip.start_tick && s.end_tick <= clip.end_tick)
        .cloned()
        .map(|mut s| {
            s.start_tick -= shift;
            s.end_tick -= shift;
            for w in &mut s.word_timings {
                w.start_tick -= shift;
                w.end_tick -= shift;
            }
            s
        })
        .collect();
    p.assets
        .retain(|_, a| a.kind != qr_core::project::AssetKind::Audio);
    for t in p.tracks.iter_mut().filter(|t| t.kind == TrackKind::Audio) {
        t.clips.clear();
    }
    p
}

/// Memotong audio `[start_sec, start_sec+dur_sec)` ke `dest` (AAC) dengan ffmpeg.
pub fn trim_audio(
    ffmpeg: &str,
    src: &Path,
    start_sec: f64,
    dur_sec: f64,
    dest: &Path,
) -> Result<(), String> {
    let out = Command::new(ffmpeg)
        .args(["-v", "error", "-y", "-ss"])
        .arg(format!("{start_sec:.6}"))
        .arg("-t")
        .arg(format!("{dur_sec:.6}"))
        .arg("-i")
        .arg(src)
        .args(["-vn", "-c:a", "aac", "-b:a", "192k"])
        .arg(dest)
        .output()
        .map_err(|e| format!("ffmpeg tidak dapat dijalankan: {e}"))?;
    if !out.status.success() || !dest.is_file() {
        return Err(format!(
            "Gagal memotong audio klip: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Nama berkas aman dari judul klip.
pub fn safe_file_stem(title: &str) -> String {
    let s: String = title
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        "klip".to_string()
    } else {
        s.chars().take(80).collect()
    }
}

/// Folder kerja klip batch: bersebelahan dengan folder proyek (bukan di dalamnya, agar tidak terindeks
/// sebagai proyek). Dibersihkan manual; tidak dihapus otomatis karena worker masih memerlukannya saat antre.
pub fn batch_work_dir(projects_dir: &Path, batch_id: &str) -> PathBuf {
    projects_dir
        .parent()
        .map_or_else(|| projects_dir.to_path_buf(), Path::to_path_buf)
        .join("BatchWork")
        .join(batch_id)
}

/// Memecah proyek dan memasukkan satu job render per klip ke antrean (lalu menjalankan antrean).
/// Semua-atau-tidak-sama-sekali: galat di tengah membatalkan job yang sudah masuk dan menghapus folder kerja.
#[allow(clippy::too_many_arguments)]
pub fn enqueue_batch_impl(
    svc: &ExportService,
    db: &Mutex<AppDb>,
    projects_dir: &Path,
    project_id: &str,
    mode: &BatchMode,
    output_dir: &Path,
    width: Option<u32>,
    overwrite: bool,
    tools: &MediaTools,
) -> Result<Vec<JobDto>, String> {
    let (_, project) = load_registered(db, project_id)?;
    let clips = split(&project, mode)?;
    if !output_dir.is_absolute() {
        return Err(format!(
            "Folder keluaran harus absolut: {}",
            output_dir.display()
        ));
    }
    let audio = match project_audio_path(&project) {
        Some(p) if p.is_file() => Some(p),
        Some(p) => {
            return Err(format!(
                "Berkas audio proyek tidak ditemukan: {}. Impor ulang audionya.",
                p.display()
            ))
        }
        None => None,
    };

    let batch_id = format!(
        "batch_{}",
        ulid::Ulid::generate().to_string().to_lowercase()
    );
    let work = batch_work_dir(projects_dir, &batch_id);
    let prepared = (|| -> Result<Vec<(String, RenderJobSpec, BatchInfo)>, String> {
        std::fs::create_dir_all(output_dir).map_err(|e| {
            format!(
                "Folder keluaran tidak dapat dibuat ({}): {e}",
                output_dir.display()
            )
        })?;
        let mut jobs = Vec::with_capacity(clips.len());
        for clip in &clips {
            let stem = format!("{:02}-{}", clip.clip_index, safe_file_stem(&clip.title));
            let out = output_dir.join(format!("{stem}.mp4"));
            let spec_probe = RenderJobSpec {
                project_id: project_id.to_string(),
                project_dir: PathBuf::new(),
                output_path: out.clone(),
                audio_path: None,
                width,
                overwrite,
            };
            svc.validate_export(&spec_probe)?;

            let clip_dir = work.join(format!("klip-{:02}.qrproj", clip.clip_index));
            let mut clip_project = build_clip_project(&project, clip);
            if clip_project.segments.is_empty() {
                return Err(format!(
                    "Klip {} tidak memiliki segmen (segmen tumpang tindih di batas klip?)",
                    clip.clip_index
                ));
            }
            qr_core::save_project_atomic(&clip_dir, &mut clip_project)
                .map_err(|e| e.to_string())?;
            let audio_path = match &audio {
                Some(src) => {
                    let dest = clip_dir.join("audio.m4a");
                    trim_audio(
                        &tools.ffmpeg,
                        src,
                        clip.start_tick as f64 / TICKS_PER_SECOND,
                        (clip.end_tick - clip.start_tick) as f64 / TICKS_PER_SECOND,
                        &dest,
                    )?;
                    Some(dest)
                }
                None => None,
            };
            jobs.push((
                format!("{batch_id}_{}", clip.clip_index),
                RenderJobSpec {
                    project_dir: clip_dir,
                    audio_path,
                    ..spec_probe
                },
                BatchInfo {
                    batch_id: batch_id.clone(),
                    extra: serde_json::json!({
                        "title": clip.title,
                        "clip_index": clip.clip_index,
                        "surah_id": clip.surah_id,
                        "start_ayah": clip.start_ayah,
                        "end_ayah": clip.end_ayah,
                        "source_start_tick": clip.start_tick,
                        "source_end_tick": clip.end_tick,
                    }),
                },
            ));
        }
        Ok(jobs)
    })();
    let jobs = match prepared {
        Ok(j) => j,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            return Err(e);
        }
    };
    match svc.enqueue_batch(&jobs) {
        Ok(records) => Ok(records.iter().map(job_dto).collect()),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            Err(e)
        }
    }
}

/// Pratinjau pemecahan proyek menjadi klip batch (tanpa efek samping). Mode: `by_ayah_count`, `by_max_duration_sec`.
#[tauri::command]
#[specta::specta]
pub fn batch_split(
    project_id: String,
    mode: BatchMode,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<BatchClipDto>, String> {
    batch_split_impl(&state.db, &project_id, &mode)
}

/// Memecah proyek lalu mengantre satu job render per klip ke `output_dir` (`NN-judul.mp4`). Antrean langsung
/// berjalan; pantau lewat `queue_list`. Semua-atau-tidak-sama-sekali.
#[tauri::command]
#[specta::specta]
pub async fn queue_enqueue_batch(
    project_id: String,
    mode: BatchMode,
    output_dir: String,
    width: Option<u32>,
    overwrite: bool,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<JobDto>, String> {
    enqueue_batch_impl(
        &state.jobs,
        &state.db,
        &state.projects_dir,
        &project_id,
        &mode,
        Path::new(&output_dir),
        width,
        overwrite,
        &MediaTools::discover(),
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::audio_api::audio_import_impl;
    use crate::export_api::tests::{service_with, setup_for, write_fake_worker};
    use crate::project_io::test_support::{make_sine_wav, register_project, TempDir};
    use qr_core::project::{AyahSegment, WordTiming};
    use std::time::Duration;

    fn seg(ayah: u32, start_s: i64, end_s: i64, confidence: f32) -> AyahSegment {
        AyahSegment {
            id: format!("s{ayah}"),
            surah_id: 1,
            ayah_number: ayah,
            start_tick: start_s * 48_000,
            end_tick: end_s * 48_000,
            word_timings: vec![WordTiming {
                word_idx: 0,
                start_tick: start_s * 48_000,
                end_tick: end_s * 48_000,
                text: "x".into(),
                confidence,
            }],
            confidence,
            manual_override: false,
            word_range: None,
        }
    }

    fn project_with_three_ayahs(name: &str) -> Project {
        let mut p = Project::new(name);
        p.segments = vec![seg(1, 0, 2, 0.95), seg(2, 2, 4, 0.5), seg(3, 4, 6, 0.9)];
        p
    }

    #[test]
    fn split_modes_match_the_library_and_expose_plain_numbers() {
        let tmp = TempDir::new("bat_split");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = project_with_three_ayahs("Batch");
        register_project(&db, tmp.path(), &mut p);

        let two = batch_split_impl(&db, &p.id, &BatchMode::ByAyahCount { count: 2 }).unwrap();
        assert_eq!(two.len(), 2);
        assert_eq!(
            (two[0].clip_index, two[0].start_ayah, two[0].end_ayah),
            (1, 1, 2)
        );
        assert_eq!((two[1].start_ayah, two[1].end_ayah), (3, 3));
        assert_eq!(two[0].start_tick, 0.0);
        assert_eq!(two[0].end_tick, 4.0 * 48_000.0);
        assert!((two[0].duration_seconds - 4.0).abs() < 1e-9);
        assert!(two[0].has_low_confidence && !two[1].has_low_confidence);

        let by_dur =
            batch_split_impl(&db, &p.id, &BatchMode::ByMaxDurationSec { max_seconds: 3 }).unwrap();
        assert_eq!(
            by_dur.len(),
            3,
            "tiap ayat 2 dtk; dua ayat (4 dtk) melebihi 3 dtk"
        );

        assert!(batch_split_impl(&db, &p.id, &BatchMode::ByAyahCount { count: 0 }).is_err());
        assert!(
            batch_split_impl(&db, &p.id, &BatchMode::ByMaxDurationSec { max_seconds: 0 }).is_err()
        );
        assert!(batch_split_impl(&db, "tidak-ada", &BatchMode::ByAyahCount { count: 1 }).is_err());

        let mut empty = Project::new("Kosong");
        register_project(&db, tmp.path(), &mut empty);
        let err =
            batch_split_impl(&db, &empty.id, &BatchMode::ByAyahCount { count: 1 }).unwrap_err();
        assert!(err.contains("sinkron"), "{err}");
    }

    #[test]
    fn batch_mode_json_shape_is_tagged_by_method() {
        let m: BatchMode = serde_json::from_str(r#"{"method":"by_ayah_count","count":4}"#).unwrap();
        assert_eq!(m, BatchMode::ByAyahCount { count: 4 });
        let m: BatchMode =
            serde_json::from_str(r#"{"method":"by_max_duration_sec","max_seconds":60}"#).unwrap();
        assert_eq!(m, BatchMode::ByMaxDurationSec { max_seconds: 60 });
        // Mode yang belum diimplementasikan pustaka tidak bisa dipilih.
        assert!(serde_json::from_str::<BatchMode>(r#"{"method":"by_marker"}"#).is_err());
        assert!(serde_json::from_str::<BatchMode>(
            r#"{"method":"manual_ranges","ranges":[[1,2]]}"#
        )
        .is_err());
    }

    #[test]
    fn clip_project_shifts_ticks_keeps_only_its_segments_and_drops_source_audio() {
        let mut p = project_with_three_ayahs("Asal");
        crate::audio_api::set_primary_audio(
            &mut p,
            qr_core::project::AssetRef {
                id: "a".into(),
                path: "/x/a.wav".into(),
                sha256: "00".into(),
                kind: qr_core::project::AssetKind::Audio,
                duration_ticks: 6 * 48_000,
                size_bytes: 1,
            },
            "a.wav",
        );
        let clips = split_project_into_batch_clips(&p, &BatchSplitMethod::ByAyahCount { count: 2 });
        let c2 = build_clip_project(&p, &clips[1]);
        assert_eq!(c2.segments.len(), 1);
        assert_eq!(c2.segments[0].ayah_number, 3);
        assert_eq!(
            (c2.segments[0].start_tick, c2.segments[0].end_tick),
            (0, 2 * 48_000)
        );
        assert_eq!(c2.segments[0].word_timings[0].start_tick, 0);
        assert_eq!(c2.segments[0].word_timings[0].end_tick, 2 * 48_000);
        assert!(c2.assets.is_empty());
        assert!(c2
            .tracks
            .iter()
            .filter(|t| t.kind == TrackKind::Audio)
            .all(|t| t.clips.is_empty()));
        assert_ne!(c2.id, p.id);
        assert_eq!(c2.name, clips[1].title);
        // Proyek asal tidak berubah.
        assert_eq!(p.segments[2].start_tick, 4 * 48_000);
        // Klip pertama memuat dua segmen.
        assert_eq!(build_clip_project(&p, &clips[0]).segments.len(), 2);
    }

    #[test]
    fn safe_file_stem_removes_path_and_reserved_characters() {
        assert_eq!(safe_file_stem("Al-Fatihah 1:2/3"), "Al-Fatihah 1-2-3");
        assert_eq!(safe_file_stem("..."), "klip");
        assert_eq!(safe_file_stem("  "), "klip");
        assert_eq!(safe_file_stem("a\\b*c?"), "a-b-c-");
        assert!(safe_file_stem(&"x".repeat(300)).len() <= 80);
    }

    #[test]
    fn trim_audio_produces_a_clip_of_the_requested_length() {
        let tmp = TempDir::new("bat_trim");
        let src = tmp.path().join("src.wav");
        make_sine_wav(&src, 6.0, 440);
        let dest = tmp.path().join("klip.m4a");
        let tools = MediaTools::discover();
        trim_audio(&tools.ffmpeg, &src, 2.0, 2.0, &dest).unwrap();
        let meta = qr_media::probe_media_with(&tools.ffprobe, &dest).unwrap();
        assert!(
            (meta.duration_sec - 2.0).abs() < 0.15,
            "{}",
            meta.duration_sec
        );
        assert!(trim_audio(
            &tools.ffmpeg,
            &tmp.path().join("tidak-ada.wav"),
            0.0,
            1.0,
            &tmp.path().join("x.m4a")
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn enqueue_batch_creates_runnable_sub_projects_and_runs_the_queue() {
        let tmp = TempDir::new("bat_run");
        let projects_dir = tmp.path().join("Projects");
        std::fs::create_dir_all(&projects_dir).unwrap();
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = project_with_three_ayahs("Kajian");
        register_project(&db, &projects_dir, &mut p);
        let tools = MediaTools::discover();
        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, 6.0, 440);
        audio_import_impl(&db, &p.id, &wav, &tools).unwrap();

        let worker = write_fake_worker(tmp.path());
        let (svc, _sink) = service_with({
            let w = worker.clone();
            move || Ok(setup_for(&w))
        });
        let out_dir = tmp.path().join("Keluaran");
        let jobs = enqueue_batch_impl(
            &svc,
            &db,
            &projects_dir,
            &p.id,
            &BatchMode::ByAyahCount { count: 2 },
            &out_dir,
            Some(270),
            false,
            &tools,
        )
        .unwrap();
        assert_eq!(jobs.len(), 2);
        assert!(jobs
            .iter()
            .all(|j| j.kind == "render" && j.batch_id.is_some() && j.priority == 5));
        assert_eq!(jobs[0].title.as_deref(), Some("Kajian 1:2"));

        // Antrean berjalan sendiri sampai kedua klip jadi.
        let end = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            let all = svc.list().unwrap();
            if all.iter().all(|j| j.state == "succeeded") && all.len() == 2 {
                break;
            }
            assert!(
                std::time::Instant::now() < end,
                "antrean tidak selesai: {all:?}"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(out_dir.join("01-Kajian 1:2.mp4".replace(':', "-")).exists());
        assert!(out_dir.join("02-Kajian 3:3.mp4".replace(':', "-")).exists());

        // Sub-proyek nyata yang bisa dimuat worker: segmen tergeser dan audio dipotong.
        let payload = svc
            .supervisor()
            .get_job(&jobs[1].id)
            .unwrap()
            .unwrap()
            .payload;
        let clip_dir = PathBuf::from(payload["project_dir"].as_str().unwrap());
        let sub = qr_core::load_project(&clip_dir).unwrap();
        assert_eq!(sub.segments.len(), 1);
        assert_eq!(sub.segments[0].start_tick, 0);
        let audio = PathBuf::from(payload["audio_path"].as_str().unwrap());
        let meta = qr_media::probe_media_with(&tools.ffprobe, &audio).unwrap();
        assert!(
            (meta.duration_sec - 2.0).abs() < 0.15,
            "{}",
            meta.duration_sec
        );
        assert_eq!(payload["width"], 270);
        assert!(
            clip_dir.starts_with(tmp.path().join("BatchWork")),
            "{clip_dir:?}"
        );
    }

    #[test]
    fn enqueue_batch_is_all_or_nothing_when_an_output_already_exists() {
        let tmp = TempDir::new("bat_exist");
        let projects_dir = tmp.path().join("Projects");
        std::fs::create_dir_all(&projects_dir).unwrap();
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = project_with_three_ayahs("Kajian");
        register_project(&db, &projects_dir, &mut p);
        let (svc, _sink) = service_with(|| Err("tidak dipanggil".into()));
        let out_dir = tmp.path().join("Keluaran");
        std::fs::create_dir_all(&out_dir).unwrap();
        std::fs::write(out_dir.join("02-Kajian 3-3.mp4"), "lama").unwrap();
        let err = enqueue_batch_impl(
            &svc,
            &db,
            &projects_dir,
            &p.id,
            &BatchMode::ByAyahCount { count: 2 },
            &out_dir,
            None,
            false,
            &MediaTools::discover(),
        )
        .unwrap_err();
        assert!(err.contains("sudah ada"), "{err}");
        assert!(svc.list().unwrap().is_empty());
        assert!(
            !tmp.path().join("BatchWork").exists()
                || std::fs::read_dir(tmp.path().join("BatchWork"))
                    .unwrap()
                    .count()
                    == 0
        );
        assert_eq!(
            std::fs::read_to_string(out_dir.join("02-Kajian 3-3.mp4")).unwrap(),
            "lama"
        );

        // Folder keluaran relatif ditolak; worker hilang: galat jelas dan tidak ada job.
        let err = enqueue_batch_impl(
            &svc,
            &db,
            &projects_dir,
            &p.id,
            &BatchMode::ByAyahCount { count: 2 },
            Path::new("rel"),
            None,
            false,
            &MediaTools::discover(),
        )
        .unwrap_err();
        assert!(err.contains("absolut"), "{err}");
        let err = enqueue_batch_impl(
            &svc,
            &db,
            &projects_dir,
            &p.id,
            &BatchMode::ByAyahCount { count: 3 },
            &tmp.path().join("Baru"),
            None,
            false,
            &MediaTools::discover(),
        )
        .unwrap_err();
        assert!(err.contains("tidak dipanggil"), "{err}");
        assert!(svc.list().unwrap().is_empty());
    }
}
