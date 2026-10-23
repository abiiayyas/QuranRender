//! Antrean job persisten + worker `qurender` sungguhan (A1-09, B2-12).
//!
//! * `real_worker_*_without_dataset_*` berjalan di CI tanpa dataset: memakai biner `qurender worker`
//!   asli yang gagal start karena dataset tidak ada, dan membuktikan antrean tetap berjalan.
//! * Uji lain memerlukan `build/dataset` bertanda tangan (`cargo run -p qr-dataset -- build`) dan font/template
//!   repositori; dijalankan dengan `cargo test -p qr-cli --test job_queue -- --ignored --nocapture`.
#![allow(clippy::unwrap_used)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use qr_core::project::{AyahSegment, Project};
use qr_jobs::{JobKind, JobState, JobSupervisor, QueueRunner, WorkerSpec};
use serde_json::json;

static N: AtomicUsize = AtomicUsize::new(0);

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("qr_cli_queue_{tag}_{}_{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn qurender() -> WorkerSpec {
    WorkerSpec::qurender(env!("CARGO_BIN_EXE_qurender"))
}

/// Proyek satu segmen (satu ayat nyata dari dataset) berdurasi `seconds`.
fn make_project(dir: &Path, name: &str, surah: u32, ayah: u32, seconds: i64) -> PathBuf {
    let proj_dir = dir.join(format!("{name}.qrproj"));
    let mut p = Project::new(name);
    p.template_id = "subuh".into();
    p.segments.push(AyahSegment {
        id: format!("s_{surah}_{ayah}"),
        surah_id: surah,
        ayah_number: ayah,
        start_tick: 0,
        end_tick: seconds * 48_000,
        word_timings: vec![],
        confidence: 1.0,
        manual_override: false,
        word_range: None,
    });
    qr_core::save_project_atomic(&proj_dir, &mut p).unwrap();
    proj_dir
}

fn render_payload(project: &Path, out: &Path, width: u32) -> serde_json::Value {
    json!({"project_dir": project, "output_path": out, "width": width, "threads": 2})
}

fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn ffprobe_frames(path: &Path) -> String {
    let o = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,nb_read_frames",
            "-of",
            "default=nw=1",
        ])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&o.stdout).to_string()
}

#[test]
fn real_worker_that_cannot_open_dataset_fails_each_job_and_queue_continues() {
    let tmp = TempDir::new("nodataset");
    let s = JobSupervisor::open(&tmp.path().join("app.db")).unwrap();
    for i in 0..4 {
        s.enqueue(
            format!("j{i}"),
            JobKind::Render,
            None,
            json!({"project_dir": tmp.path().join("x.qrproj"), "output_path": tmp.path().join(format!("o{i}.mp4"))}),
            0,
        )
        .unwrap();
    }
    // Dataset sengaja menunjuk folder kosong: worker asli keluar saat start dengan galat di stderr.
    let spec = qurender().with_env(
        "QR_DATASET_DIR",
        tmp.path().join("tidak-ada").to_string_lossy(),
    );
    let mut runner = QueueRunner::new(s.clone(), spec);
    runner.cancel_grace = Duration::from_secs(5);

    let summary = runner.run_until_idle().unwrap();
    assert_eq!(summary.executed.len(), 4, "semua job harus dicoba");
    assert_eq!(summary.count(JobState::Failed), 4);
    for i in 0..4 {
        let j = s.get_job(&format!("j{i}")).unwrap().unwrap();
        assert_eq!(j.error_code.as_deref(), Some("WORKER_EXITED"));
        let detail = j.error_detail.unwrap();
        assert!(detail.contains("Dataset tidak dapat dibuka"), "{detail}");
        assert_eq!(j.attempts, 1);
    }
    assert!(s
        .list_jobs()
        .unwrap()
        .iter()
        .all(|j| j.state == JobState::Failed));
}

#[test]
#[ignore = "butuh build/dataset bertanda tangan (qr-dataset build) dan ffmpeg/ffprobe"]
fn fifty_clip_queue_finishes_unattended_and_one_failing_clip_does_not_stop_it() {
    let tmp = TempDir::new("fifty");
    let db_path = tmp.path().join("app.db");
    // 50 ayat nyata pendek: Al-Fatihah, Al-Ikhlas, Al-Kautsar, Al-Ashr, An-Nashr, Al-Lahab, ...
    let verses: Vec<(u32, u32)> = [
        (1, 7),
        (112, 4),
        (108, 3),
        (103, 3),
        (110, 3),
        (111, 5),
        (114, 6),
        (113, 5),
        (109, 6),
        (107, 7),
        (105, 5),
    ]
    .iter()
    .flat_map(|&(s, n)| (1..=n).map(move |a| (s, a)))
    .take(50)
    .collect();
    assert_eq!(verses.len(), 50);

    let failing_index = 24usize;
    let high_priority_index = 49usize;
    let s = JobSupervisor::open(&db_path).unwrap();
    let mut expected_frames = std::collections::HashMap::new();
    for (i, &(surah, ayah)) in verses.iter().enumerate() {
        let id = format!("clip_{i:02}");
        let seconds = 1 + (i % 2) as i64; // 1-2 dtk
        let width = 64 + 2 * (i as u32 % 33); // 64..128
        let out = tmp.path().join(format!("{id}.mp4"));
        let payload = if i == failing_index {
            // Sengaja gagal: folder proyek tidak ada.
            render_payload(&tmp.path().join("tidak-ada.qrproj"), &out, width)
        } else {
            let proj = make_project(tmp.path(), &id, surah, ayah, seconds);
            expected_frames.insert(id.clone(), seconds as u64 * 30);
            render_payload(&proj, &out, width)
        };
        let priority = if i == high_priority_index { 9 } else { 0 };
        s.enqueue(id, JobKind::Render, None, payload, priority)
            .unwrap();
    }

    // Simulasi crash: pelari mengklaim job prioritas tinggi lalu proses mati sebelum selesai.
    let claimed = s.claim_next().unwrap().unwrap();
    assert_eq!(claimed.id, format!("clip_{high_priority_index:02}"));
    drop(s);
    let s = JobSupervisor::open(&db_path).unwrap();
    assert_eq!(s.orphans_recovered(), 1);
    let jobs = s.list_jobs().unwrap();
    assert_eq!(jobs.len(), 50);
    assert!(jobs.iter().all(|j| j.state == JobState::Queued));

    let mut runner = QueueRunner::new(s.clone(), qurender());
    runner.cancel_grace = Duration::from_secs(10);
    let t0 = Instant::now();
    let summary = runner.run_until_idle().unwrap();
    let elapsed = t0.elapsed();
    eprintln!(
        "ANTREAN 50 JOB: {:.1} dtk total, {:.2} dtk/job (build {})",
        elapsed.as_secs_f64(),
        elapsed.as_secs_f64() / 50.0,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );

    assert_eq!(summary.executed.len(), 50);
    assert_eq!(
        summary.executed[0].0,
        format!("clip_{high_priority_index:02}"),
        "prioritas tinggi dahulu"
    );
    assert_eq!(
        summary.count(JobState::Succeeded),
        49,
        "{:?}",
        summary.executed
    );
    assert_eq!(summary.count(JobState::Failed), 1);

    let bad = s
        .get_job(&format!("clip_{failing_index:02}"))
        .unwrap()
        .unwrap();
    assert_eq!(bad.state, JobState::Failed);
    assert_eq!(
        bad.error_code.as_deref(),
        Some("PROJECT_LOAD"),
        "{:?}",
        bad.error_detail
    );
    // Job setelah yang gagal tetap dijalankan sampai selesai.
    let pos = |id: &str| summary.executed.iter().position(|(x, _)| x == id).unwrap();
    assert!(pos("clip_25") > pos(&bad.id) && pos("clip_49") < pos(&bad.id));
    assert_eq!(
        s.get_job("clip_49").unwrap().unwrap().attempts,
        2,
        "dijalankan ulang setelah yatim"
    );

    for (id, frames) in &expected_frames {
        let j = s.get_job(id).unwrap().unwrap();
        assert_eq!(
            j.state,
            JobState::Succeeded,
            "{id}: {:?} {:?}",
            j.error_code,
            j.error_detail
        );
        let out = PathBuf::from(j.output_path.unwrap());
        let probe = ffprobe_frames(&out);
        assert!(
            probe.contains("codec_name=h264")
                && probe.contains(&format!("nb_read_frames={frames}")),
            "{id}: {probe}"
        );
    }
    // Setelah semua selesai, tidak ada pekerjaan tersisa dan state bertahan di app.db.
    drop(s);
    let s = JobSupervisor::open(&db_path).unwrap();
    assert_eq!(s.orphans_recovered(), 0);
    assert!(s.claim_next().unwrap().is_none());
}

#[test]
#[ignore = "butuh build/dataset bertanda tangan (qr-dataset build) dan ffmpeg/ffprobe"]
fn canceling_a_running_real_render_kills_the_worker_and_leaves_no_partial_file() {
    let tmp = TempDir::new("cancel");
    let s = JobSupervisor::open(&tmp.path().join("app.db")).unwrap();
    let long = make_project(tmp.path(), "long", 1, 1, 600); // 18.000 frame: tidak selesai sebelum dibatalkan
    let long_out = tmp.path().join("long.mp4");
    let short = make_project(tmp.path(), "short", 112, 1, 1);
    let short_out = tmp.path().join("short.mp4");
    s.enqueue(
        "long".into(),
        JobKind::Render,
        None,
        render_payload(&long, &long_out, 128),
        9,
    )
    .unwrap();
    s.enqueue(
        "short".into(),
        JobKind::Render,
        None,
        render_payload(&short, &short_out, 128),
        0,
    )
    .unwrap();

    let canceller = {
        let s = s.clone();
        std::thread::spawn(move || {
            let t0 = Instant::now();
            loop {
                let j = s.get_job("long").unwrap().unwrap();
                // Tunggu sampai render benar-benar berjalan (ada kemajuan) agar ffmpeg sudah hidup.
                if let (JobState::Running, Some(pid), true) =
                    (j.state, j.worker_pid, j.progress > 0.0)
                {
                    s.cancel_job("long").unwrap();
                    return pid;
                }
                assert!(
                    t0.elapsed() < Duration::from_secs(120),
                    "render tidak pernah berjalan: {j:?}"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        })
    };
    let mut runner = QueueRunner::new(s.clone(), qurender());
    runner.cancel_grace = Duration::from_secs(10);
    let t0 = Instant::now();
    let summary = runner.run_until_idle().unwrap();
    let pid = canceller.join().unwrap();

    assert_eq!(
        summary.executed,
        [
            ("long".to_string(), JobState::Canceled),
            ("short".to_string(), JobState::Succeeded)
        ]
    );
    assert!(
        !pid_alive(pid),
        "worker {pid} masih hidup setelah dibatalkan"
    );
    assert!(!long_out.exists(), "berkas parsial harus dihapus");
    assert!(short_out.is_file());
    eprintln!(
        "batal + job berikutnya selesai dalam {:.1} dtk",
        t0.elapsed().as_secs_f64()
    );
}
