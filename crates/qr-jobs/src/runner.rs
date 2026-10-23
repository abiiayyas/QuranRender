//! Pelari antrean: menjalankan job `queued` satu per satu lewat proses `qurender worker` (A1-09, B2-12).
//!
//! Per job: spawn worker → tulis `WorkerCommand::Start` (NDJSON) ke stdin → baca `WorkerEvent` dari stdout
//! dan simpan ke app.db lewat `JobSupervisor`. Job gagal dicatat dan antrean lanjut ke job berikutnya.
//! Pembatalan (`JobSupervisor::cancel_job`) dilihat pelari: worker diminta berhenti (`Cancel`, agar berkas
//! parsial dibersihkan), lalu dimatikan bila tidak keluar dalam `cancel_grace`.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use crate::{JobError, JobRecord, JobState, JobSupervisor, WorkerCommand, WorkerEvent};

/// Cara menjalankan worker: biner + argumen + environment tambahan.
#[derive(Debug, Clone)]
pub struct WorkerSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
}

impl WorkerSpec {
    /// `<program> worker`, sesuai CLI `qurender worker`.
    pub fn qurender(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: vec!["worker".into()],
            envs: Vec::new(),
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }
}

/// Hasil satu putaran `run_until_idle`, sesuai urutan eksekusi.
#[derive(Debug, Clone, Default)]
pub struct RunSummary {
    /// `(job_id, status akhir)` per job yang dijalankan.
    pub executed: Vec<(String, JobState)>,
}

impl RunSummary {
    pub fn count(&self, state: JobState) -> usize {
        self.executed.iter().filter(|(_, s)| *s == state).count()
    }
}

#[derive(Debug, Clone)]
pub struct QueueRunner {
    supervisor: JobSupervisor,
    worker: WorkerSpec,
    /// Batas waktu worker keluar sendiri setelah `Cancel`/EOF sebelum dimatikan paksa.
    pub cancel_grace: Duration,
    /// Selang pengecekan pembatalan saat menunggu event worker.
    pub poll_interval: Duration,
}

/// Ekor stderr worker yang disimpan untuk pesan galat bila worker mati tanpa event akhir.
const STDERR_TAIL_BYTES: usize = 2048;

enum Outcome {
    /// Worker mengirim `Succeeded`/`Failed` (sudah tercatat).
    Finished,
    Canceled,
    /// stdout tertutup tanpa event akhir.
    WorkerGone,
}

impl QueueRunner {
    pub fn new(supervisor: JobSupervisor, worker: WorkerSpec) -> Self {
        Self {
            supervisor,
            worker,
            cancel_grace: Duration::from_secs(10),
            poll_interval: Duration::from_millis(50),
        }
    }

    pub fn supervisor(&self) -> &JobSupervisor {
        &self.supervisor
    }

    /// Menjalankan job sampai tidak ada lagi yang `queued`. Kegagalan satu job tidak menghentikan antrean;
    /// galat hanya dikembalikan bila penyimpanan antrean sendiri rusak.
    pub fn run_until_idle(&self) -> Result<RunSummary, JobError> {
        let mut summary = RunSummary::default();
        while let Some(done) = self.run_next()? {
            summary.executed.push((done.id, done.state));
        }
        Ok(summary)
    }

    /// Menjalankan satu job `queued` terdepan sampai berakhir; `None` bila antrean kosong.
    pub fn run_next(&self) -> Result<Option<JobRecord>, JobError> {
        let Some(job) = self.supervisor.claim_next()? else {
            return Ok(None);
        };
        self.execute(&job)?;
        self.supervisor.get_job(&job.id)
    }

    fn execute(&self, job: &JobRecord) -> Result<(), JobError> {
        let mut cmd = Command::new(&self.worker.program);
        cmd.args(&self.worker.args)
            .envs(self.worker.envs.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                return self.supervisor.fail_job(
                    &job.id,
                    "WORKER_SPAWN",
                    &format!(
                        "Worker tidak dapat dijalankan ({}): {e}",
                        self.worker.program.display()
                    ),
                );
            }
        };
        self.supervisor.set_worker_pid(&job.id, Some(child.id()))?;

        let (err_tx, err_rx) = mpsc::channel::<String>();
        if let Some(s) = child.stderr.take() {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = s.take(1 << 20).read_to_end(&mut buf);
                let start = buf.len().saturating_sub(STDERR_TAIL_BYTES);
                let _ = err_tx.send(String::from_utf8_lossy(&buf[start..]).trim().to_string());
            });
        }
        let (tx, rx) = mpsc::channel::<WorkerEvent>();
        if let Some(stdout) = child.stdout.take() {
            // Thread ini berakhir sendiri saat stdout tertutup; sengaja tidak di-join (bila worker
            // dimatikan paksa, proses cucu bisa menahan pipa).
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    match serde_json::from_str::<WorkerEvent>(&line) {
                        Ok(ev) => {
                            if tx.send(ev).is_err() {
                                break;
                            }
                        }
                        Err(e) => tracing::warn!(%e, line, "baris stdout worker bukan WorkerEvent"),
                    }
                }
            });
        }

        let mut stdin = child.stdin.take();
        let start = WorkerCommand::Start {
            job_id: job.id.clone(),
            kind: job.kind.as_str().into(),
            payload: job.payload.clone(),
        };
        if let Some(w) = stdin.as_mut() {
            // Gagal menulis berarti worker sudah mati; ditangani sebagai `WorkerGone` di bawah.
            if let Err(e) = write_command(w, &start) {
                tracing::warn!(job = %job.id, %e, "gagal menulis Start ke worker");
            }
        }

        let outcome = self.pump_events(job, &rx)?;
        let status = match outcome {
            Outcome::Canceled => {
                if let Some(w) = stdin.as_mut() {
                    let _ = write_command(
                        w,
                        &WorkerCommand::Cancel {
                            job_id: job.id.clone(),
                        },
                    );
                }
                self.stop_worker(&mut child, stdin.take())
            }
            Outcome::Finished | Outcome::WorkerGone => self.stop_worker(&mut child, stdin.take()),
        };
        if matches!(outcome, Outcome::WorkerGone) {
            let tail = err_rx
                .recv_timeout(Duration::from_millis(500))
                .ok()
                .filter(|t| !t.is_empty());
            let exit = status.map_or_else(|| "status tidak diketahui".into(), |s| s.to_string());
            let mut message = format!("Worker berhenti tanpa melaporkan hasil ({exit})");
            if let Some(t) = tail {
                message.push_str(": ");
                message.push_str(&t);
            }
            // Bila dibatalkan bersamaan, fail_job ditolak karena status bukan `running`: abaikan.
            match self.supervisor.fail_job(&job.id, "WORKER_EXITED", &message) {
                Ok(()) | Err(JobError::InvalidStateTransition(..)) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }

    /// Membaca event worker sampai ada hasil akhir, pembatalan, atau worker hilang.
    fn pump_events(
        &self,
        job: &JobRecord,
        rx: &mpsc::Receiver<WorkerEvent>,
    ) -> Result<Outcome, JobError> {
        loop {
            match rx.recv_timeout(self.poll_interval) {
                Ok(event) => {
                    let (id, terminal) = match &event {
                        WorkerEvent::Started { job_id, .. }
                        | WorkerEvent::Progress { job_id, .. } => (job_id, false),
                        WorkerEvent::Succeeded { job_id, .. }
                        | WorkerEvent::Failed { job_id, .. } => (job_id, true),
                    };
                    if *id != job.id {
                        tracing::warn!(expected = %job.id, got = %id, "event worker untuk job lain diabaikan");
                        continue;
                    }
                    self.supervisor.handle_worker_event(event)?;
                    if terminal {
                        // Pembatalan yang menyusul bersamaan dengan hasil akhir tidak mengubah hasil.
                        return Ok(if self.state_of(&job.id)? == Some(JobState::Canceled) {
                            Outcome::Canceled
                        } else {
                            Outcome::Finished
                        });
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Ok(if self.state_of(&job.id)? == Some(JobState::Canceled) {
                        Outcome::Canceled
                    } else {
                        Outcome::WorkerGone
                    });
                }
            }
            if self.state_of(&job.id)? == Some(JobState::Canceled) {
                return Ok(Outcome::Canceled);
            }
        }
    }

    fn state_of(&self, id: &str) -> Result<Option<JobState>, JobError> {
        Ok(self.supervisor.get_job(id)?.map(|j| j.state))
    }

    /// Menutup stdin (EOF), menunggu worker keluar sampai `cancel_grace`, lalu mematikannya bila perlu.
    /// Selalu me-reap proses. Mengembalikan status keluar bila diketahui.
    fn stop_worker(&self, child: &mut Child, stdin: Option<ChildStdin>) -> Option<ExitStatus> {
        drop(stdin);
        let deadline = Instant::now() + self.cancel_grace;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return Some(status),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!(%e, "try_wait worker gagal");
                    break;
                }
            }
        }
        if let Err(e) = child.kill() {
            tracing::warn!(%e, "kill worker gagal");
        }
        child.wait().ok()
    }
}

fn write_command(w: &mut ChildStdin, cmd: &WorkerCommand) -> std::io::Result<()> {
    let mut line = serde_json::to_string(cmd).map_err(std::io::Error::other)?;
    line.push('\n');
    w.write_all(line.as_bytes())?;
    w.flush()
}
