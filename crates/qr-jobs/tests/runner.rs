//! Uji `QueueRunner` dengan worker palsu berbasis `sh` yang berbicara protokol NDJSON asli
//! (`WorkerCommand::Start` masuk, `WorkerEvent` keluar). Worker `qurender` sungguhan diuji di
//! `crates/qr-cli/tests/job_queue.rs`.
#![cfg(unix)]
#![allow(clippy::unwrap_used)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use qr_jobs::{JobKind, JobState, JobSupervisor, QueueRunner, WorkerSpec};
use serde_json::json;

/// Mode dipilih lewat `payload.mode`: ok | fail | crash | hang.
const FAKE_WORKER: &str = r#"
read line
id=$(printf '%s' "$line" | sed -e 's/.*"job_id":"\([^"]*\)".*/\1/')
case "$line" in
  *'"mode":"crash"'*)
    echo "boom: worker rusak" >&2
    exit 3 ;;
  *'"mode":"hang"'*)
    echo "{\"event\":\"started\",\"job_id\":\"$id\",\"total_steps\":1}"
    exec sleep 60 ;;
  *'"mode":"fail"'*)
    echo "{\"event\":\"started\",\"job_id\":\"$id\",\"total_steps\":1}"
    echo "{\"event\":\"failed\",\"job_id\":\"$id\",\"error_code\":\"FAKE_FAIL\",\"message\":\"gagal sengaja\"}" ;;
  *)
    echo "{\"event\":\"started\",\"job_id\":\"$id\",\"total_steps\":2}"
    echo "{\"event\":\"progress\",\"job_id\":\"$id\",\"step\":1,\"total_steps\":2,\"progress_fraction\":0.5,\"message\":\"separuh\"}"
    echo "{\"event\":\"succeeded\",\"job_id\":\"$id\",\"output_path\":\"/tmp/$id.mp4\"}" ;;
esac
cat > /dev/null
"#;

static N: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    dir: PathBuf,
    script: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("qr_jobs_runner_{tag}_{}_{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("worker.sh");
        std::fs::write(&script, FAKE_WORKER).unwrap();
        Self { dir, script }
    }

    fn db(&self) -> PathBuf {
        self.dir.join("app.db")
    }

    fn spec(&self) -> WorkerSpec {
        WorkerSpec {
            program: "/bin/sh".into(),
            args: vec![self.script.to_string_lossy().into_owned()],
            envs: vec![],
        }
    }

    fn runner(&self, s: &JobSupervisor) -> QueueRunner {
        let mut r = QueueRunner::new(s.clone(), self.spec());
        r.cancel_grace = Duration::from_millis(300);
        r.poll_interval = Duration::from_millis(10);
        r
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn enq(s: &JobSupervisor, id: &str, mode: &str, priority: i32) {
    s.enqueue(
        id.into(),
        JobKind::Render,
        None,
        json!({ "mode": mode }),
        priority,
    )
    .unwrap();
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}

#[test]
fn failing_and_crashing_jobs_do_not_stop_the_queue() {
    let fx = Fixture::new("isolation");
    let s = JobSupervisor::open(&fx.db()).unwrap();
    for (id, mode) in [
        ("j1", "ok"),
        ("j2", "fail"),
        ("j3", "crash"),
        ("j4", "ok"),
        ("j5", "ok"),
    ] {
        enq(&s, id, mode, 0);
    }
    let summary = fx.runner(&s).run_until_idle().unwrap();

    let order: Vec<&str> = summary.executed.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(order, ["j1", "j2", "j3", "j4", "j5"]);
    assert_eq!(summary.count(JobState::Succeeded), 3);
    assert_eq!(summary.count(JobState::Failed), 2);

    let j2 = s.get_job("j2").unwrap().unwrap();
    assert_eq!(j2.error_code.as_deref(), Some("FAKE_FAIL"));
    assert_eq!(j2.error_detail.as_deref(), Some("gagal sengaja"));
    let j3 = s.get_job("j3").unwrap().unwrap();
    assert_eq!(j3.error_code.as_deref(), Some("WORKER_EXITED"));
    let detail = j3.error_detail.unwrap();
    assert!(
        detail.contains("boom: worker rusak") && detail.contains('3'),
        "{detail}"
    );

    let j5 = s.get_job("j5").unwrap().unwrap();
    assert_eq!(j5.state, JobState::Succeeded);
    assert_eq!(j5.progress, 1.0);
    assert_eq!(j5.output_path.as_deref(), Some("/tmp/j5.mp4"));
    assert_eq!(j5.worker_pid, None, "pid dibersihkan setelah selesai");
    assert!(j5.started_at.is_some() && j5.finished_at.is_some());
}

#[test]
fn runner_executes_by_priority_and_skips_paused_until_resumed() {
    let fx = Fixture::new("priority");
    let s = JobSupervisor::open(&fx.db()).unwrap();
    enq(&s, "low", "ok", 0);
    enq(&s, "mid", "ok", 5);
    enq(&s, "high", "ok", 9);
    enq(&s, "held", "ok", 7);
    s.pause_job("held").unwrap();
    let r = fx.runner(&s);

    let first = r.run_until_idle().unwrap();
    let order: Vec<&str> = first.executed.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(order, ["high", "mid", "low"]);
    assert_eq!(s.get_job("held").unwrap().unwrap().state, JobState::Paused);

    s.resume_job("held").unwrap();
    let second = r.run_until_idle().unwrap();
    assert_eq!(second.executed, [("held".to_string(), JobState::Succeeded)]);
}

#[test]
fn canceling_a_running_job_kills_the_worker_process_and_queue_continues() {
    let fx = Fixture::new("cancel");
    let s = JobSupervisor::open(&fx.db()).unwrap();
    enq(&s, "stuck", "hang", 9);
    enq(&s, "after", "ok", 0);
    let r = fx.runner(&s);

    // Pembatal: tunggu worker hidup (pid tercatat), beri waktu masuk fase `sleep`, lalu batalkan
    // lewat supervisor dan kembalikan pid untuk diperiksa.
    let canceller = {
        let s = s.clone();
        std::thread::spawn(move || {
            let t0 = Instant::now();
            loop {
                let j = s.get_job("stuck").unwrap().unwrap();
                if let (JobState::Running, Some(pid)) = (j.state, j.worker_pid) {
                    std::thread::sleep(Duration::from_millis(200));
                    assert!(alive(pid), "worker harus hidup sebelum dibatalkan");
                    s.cancel_job("stuck").unwrap();
                    return pid;
                }
                assert!(
                    t0.elapsed() < Duration::from_secs(20),
                    "worker tidak pernah berjalan"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        })
    };

    let t0 = Instant::now();
    let summary = r.run_until_idle().unwrap();
    let pid = canceller.join().unwrap();

    assert_eq!(
        summary.executed,
        [
            ("stuck".to_string(), JobState::Canceled),
            ("after".to_string(), JobState::Succeeded)
        ]
    );
    // `sleep 60` mengabaikan Cancel: hanya kill paksa yang bisa mengakhirinya dalam << 60 dtk.
    assert!(t0.elapsed() < Duration::from_secs(20), "{:?}", t0.elapsed());
    assert!(
        !alive(pid),
        "proses worker {pid} masih hidup setelah pembatalan"
    );
    let stuck = s.get_job("stuck").unwrap().unwrap();
    assert_eq!(stuck.state, JobState::Canceled);
    assert_eq!(stuck.error_code, None, "pembatalan bukan kegagalan");
}

#[test]
fn queued_job_canceled_before_start_never_spawns_a_worker() {
    let fx = Fixture::new("cancel_queued");
    let s = JobSupervisor::open(&fx.db()).unwrap();
    enq(&s, "a", "ok", 0);
    enq(&s, "b", "ok", 0);
    s.cancel_job("a").unwrap();
    let summary = fx.runner(&s).run_until_idle().unwrap();
    assert_eq!(summary.executed, [("b".to_string(), JobState::Succeeded)]);
    assert_eq!(s.get_job("a").unwrap().unwrap().attempts, 0);
}

#[test]
fn unspawnable_worker_fails_every_job_but_runner_drains_the_queue() {
    let fx = Fixture::new("spawn");
    let s = JobSupervisor::open(&fx.db()).unwrap();
    for id in ["a", "b", "c"] {
        enq(&s, id, "ok", 0);
    }
    let spec = WorkerSpec {
        program: Path::new("/tidak/ada/qurender").into(),
        args: vec![],
        envs: vec![],
    };
    let summary = QueueRunner::new(s.clone(), spec).run_until_idle().unwrap();
    assert_eq!(summary.count(JobState::Failed), 3);
    for id in ["a", "b", "c"] {
        assert_eq!(
            s.get_job(id).unwrap().unwrap().error_code.as_deref(),
            Some("WORKER_SPAWN")
        );
    }
}

#[test]
fn jobs_orphaned_by_a_crash_run_to_completion_after_restart() {
    let fx = Fixture::new("orphan");
    {
        let s = JobSupervisor::open(&fx.db()).unwrap();
        enq(&s, "a", "ok", 0);
        enq(&s, "b", "ok", 0);
        // Pelari lama mati setelah mengklaim `a`: job tertinggal `running` dengan pid mati.
        let a = s.claim_next().unwrap().unwrap();
        s.set_worker_pid(&a.id, Some(4_000_000)).unwrap();
    }
    let s = JobSupervisor::open(&fx.db()).unwrap();
    assert_eq!(s.orphans_recovered(), 1);
    let summary = fx.runner(&s).run_until_idle().unwrap();
    assert_eq!(
        summary.executed,
        [
            ("a".to_string(), JobState::Succeeded),
            ("b".to_string(), JobState::Succeeded)
        ]
    );
    assert_eq!(s.get_job("a").unwrap().unwrap().attempts, 2);
}
