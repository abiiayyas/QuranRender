//! Supervisor antrean job persisten: seluruh status hidup di tabel `job` pada app.db (A1-09, B2-12).
//!
//! Satu `JobSupervisor` adalah pemilik antrean untuk satu app.db: saat dibuka, job yang tertinggal
//! `running` dianggap yatim (proses sebelumnya mati) dan dikembalikan ke `queued`. Jangan membuka dua
//! supervisor aktif pada berkas yang sama.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use qr_store::{AppDb, NewJobRow};

use crate::{JobError, JobKind, JobRecord, JobState, WorkerEvent};

/// Job baru untuk antrean.
#[derive(Debug, Clone)]
pub struct NewJob {
    pub id: String,
    pub kind: JobKind,
    pub project_id: Option<String>,
    pub batch_id: Option<String>,
    pub payload: serde_json::Value,
    /// Angka lebih besar dijalankan lebih dulu.
    pub priority: i32,
}

#[derive(Debug, Clone)]
pub struct JobSupervisor {
    db: Arc<Mutex<AppDb>>,
    orphans_recovered: usize,
}

/// Menolak payload yang memuat kunci objek rahasia di kedalaman mana pun (aturan sama dengan `setting`).
fn reject_secret_keys(v: &serde_json::Value) -> Result<(), JobError> {
    match v {
        serde_json::Value::Object(map) => {
            for (k, child) in map {
                if qr_store::is_secret_key(k) {
                    return Err(JobError::SecretRejected(k.clone()));
                }
                reject_secret_keys(child)?;
            }
            Ok(())
        }
        serde_json::Value::Array(items) => items.iter().try_for_each(reject_secret_keys),
        _ => Ok(()),
    }
}

impl JobSupervisor {
    /// Membuka antrean di app.db pada `path` (dibuat/dimigrasi bila perlu) dan memulihkan job yatim.
    pub fn open(path: &Path) -> Result<Self, JobError> {
        Self::from_db(AppDb::open(path)?)
    }

    /// Antrean di memori (uji; hilang saat proses berakhir).
    pub fn in_memory() -> Result<Self, JobError> {
        Self::from_db(AppDb::open_in_memory()?)
    }

    /// Mengambil alih `db` sebagai antrean dan memulihkan job yatim: `running` → `queued` (A1-09).
    pub fn from_db(db: AppDb) -> Result<Self, JobError> {
        let orphans_recovered = db.job_recover_orphans()?;
        if orphans_recovered > 0 {
            tracing::warn!(
                orphans_recovered,
                "job yatim dikembalikan ke antrean saat supervisor start"
            );
        }
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            orphans_recovered,
        })
    }

    /// Jumlah job yatim yang dikembalikan ke `queued` saat supervisor ini dibuka.
    pub fn orphans_recovered(&self) -> usize {
        self.orphans_recovered
    }

    fn db(&self) -> Result<MutexGuard<'_, AppDb>, JobError> {
        self.db
            .lock()
            .map_err(|_| JobError::Internal("kunci antrean rusak (panic di thread lain)".into()))
    }

    /// Menambahkan job baru ke akhir antrean. Payload yang memuat kunci rahasia ditolak.
    pub fn enqueue(
        &self,
        id: String,
        kind: JobKind,
        project_id: Option<String>,
        payload: serde_json::Value,
        priority: i32,
    ) -> Result<JobRecord, JobError> {
        self.enqueue_job(NewJob {
            id,
            kind,
            project_id,
            batch_id: None,
            payload,
            priority,
        })
    }

    pub fn enqueue_job(&self, job: NewJob) -> Result<JobRecord, JobError> {
        reject_secret_keys(&job.payload)?;
        let row = NewJobRow {
            payload: serde_json::to_string(&job.payload)?,
            id: job.id,
            kind: job.kind.as_str().into(),
            project_id: job.project_id,
            batch_id: job.batch_id,
            priority: job.priority,
        };
        match self.db()?.job_insert(&row) {
            Ok(r) => r.try_into(),
            Err(qr_store::StoreError::JobExists(id)) => Err(JobError::Duplicate(id)),
            Err(e) => Err(e.into()),
        }
    }

    /// Semua job, urut prioritas turun lalu posisi naik (urutan eksekusi untuk yang `queued`).
    pub fn list_jobs(&self) -> Result<Vec<JobRecord>, JobError> {
        self.db()?
            .job_list()?
            .into_iter()
            .map(JobRecord::try_from)
            .collect()
    }

    pub fn get_job(&self, id: &str) -> Result<Option<JobRecord>, JobError> {
        self.db()?.job_get(id)?.map(JobRecord::try_from).transpose()
    }

    fn require_job(&self, id: &str) -> Result<JobRecord, JobError> {
        self.get_job(id)?
            .ok_or_else(|| JobError::NotFound(id.into()))
    }

    /// Mengambil job `queued` terdepan (prioritas tertinggi, lalu paling awal masuk) dan menandainya `running`.
    pub fn claim_next(&self) -> Result<Option<JobRecord>, JobError> {
        self.db()?
            .job_claim_next()?
            .map(JobRecord::try_from)
            .transpose()
    }

    pub fn set_worker_pid(&self, id: &str, pid: Option<u32>) -> Result<(), JobError> {
        Ok(self.db()?.job_set_worker_pid(id, pid)?)
    }

    /// Memperbarui status dari `WorkerEvent`. Event untuk job yang sudah `canceled` diabaikan
    /// (worker bisa saja masih mengirim `Failed{CANCELED}` setelah pembatalan).
    pub fn handle_worker_event(&self, event: WorkerEvent) -> Result<(), JobError> {
        let db = self.db()?;
        let job_id = match &event {
            WorkerEvent::Started { job_id, .. }
            | WorkerEvent::Progress { job_id, .. }
            | WorkerEvent::Succeeded { job_id, .. }
            | WorkerEvent::Failed { job_id, .. } => job_id.clone(),
        };
        let current = db
            .job_get(&job_id)?
            .ok_or_else(|| JobError::NotFound(job_id.clone()))?;
        let state = JobState::parse(&current.state).ok_or_else(|| {
            JobError::Internal(format!("status tidak dikenal: {}", current.state))
        })?;
        if state == JobState::Canceled {
            return Ok(());
        }
        let invalid = |to: JobState| Err(JobError::InvalidStateTransition(state, to));
        match event {
            WorkerEvent::Started { .. } => {
                if !db.job_transition(&job_id, &["queued", "running"], "running")? {
                    return invalid(JobState::Running);
                }
            }
            WorkerEvent::Progress {
                progress_fraction,
                message,
                ..
            } => {
                db.job_set_progress(&job_id, progress_fraction, Some(&message))?;
            }
            WorkerEvent::Succeeded { output_path, .. } => {
                if !db.job_finish(&job_id, true, output_path.as_deref(), None)? {
                    return invalid(JobState::Succeeded);
                }
            }
            WorkerEvent::Failed {
                error_code,
                message,
                ..
            } => {
                if !db.job_finish(&job_id, false, None, Some((&error_code, &message)))? {
                    return invalid(JobState::Failed);
                }
            }
        }
        Ok(())
    }

    /// Menandai job `running` sebagai gagal tanpa event worker (worker mati/tidak dapat dijalankan).
    pub fn fail_job(&self, id: &str, error_code: &str, message: &str) -> Result<(), JobError> {
        if self
            .db()?
            .job_finish(id, false, None, Some((error_code, message)))?
        {
            Ok(())
        } else {
            let job = self.require_job(id)?;
            Err(JobError::InvalidStateTransition(
                job.state,
                JobState::Failed,
            ))
        }
    }

    /// Menjeda job `queued` (dilewati runner sampai dilanjutkan). Job yang sedang `running` tidak dapat
    /// dijeda: worker render belum mendukung jeda (`UNSUPPORTED`), jadi ditolak, bukan dipura-purakan.
    pub fn pause_job(&self, id: &str) -> Result<(), JobError> {
        if self.db()?.job_transition(id, &["queued"], "paused")? {
            return Ok(());
        }
        let job = self.require_job(id)?;
        if job.state == JobState::Running {
            Err(JobError::Unsupported(
                "jeda job yang sedang berjalan belum didukung worker; batalkan job atau tunggu selesai".into(),
            ))
        } else {
            Err(JobError::InvalidStateTransition(
                job.state,
                JobState::Paused,
            ))
        }
    }

    /// Melanjutkan job yang dijeda; kembali ke posisi semula di antrean.
    pub fn resume_job(&self, id: &str) -> Result<(), JobError> {
        if self.db()?.job_transition(id, &["paused"], "queued")? {
            return Ok(());
        }
        let job = self.require_job(id)?;
        Err(JobError::InvalidStateTransition(
            job.state,
            JobState::Queued,
        ))
    }

    /// Membatalkan job `queued`/`paused`/`running`. Untuk job `running`, `QueueRunner` yang sedang
    /// memegang worker melihat status ini dan menghentikan proses worker.
    pub fn cancel_job(&self, id: &str) -> Result<(), JobError> {
        if self
            .db()?
            .job_transition(id, &["queued", "paused", "running"], "canceled")?
        {
            return Ok(());
        }
        let job = self.require_job(id)?;
        Err(JobError::InvalidStateTransition(
            job.state,
            JobState::Canceled,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_db(tag: &str) -> std::path::PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!("qr_jobs_{tag}_{}_{n}.db", std::process::id()))
    }

    fn cleanup(path: &Path) {
        for ext in ["", "-wal", "-shm"] {
            let mut p = path.as_os_str().to_owned();
            p.push(ext);
            let _ = std::fs::remove_file(p);
        }
    }

    fn enq(s: &JobSupervisor, id: &str, priority: i32) {
        s.enqueue(id.into(), JobKind::Render, None, json!({"n": id}), priority)
            .expect("enqueue");
    }

    #[test]
    fn lifecycle_progress_and_success_are_persisted() {
        let s = JobSupervisor::in_memory().expect("db");
        let job = s
            .enqueue(
                "job_1".into(),
                JobKind::Render,
                Some("p1".into()),
                json!({"preset": "1080p"}),
                10,
            )
            .expect("enqueue");
        assert_eq!(job.state, JobState::Queued);
        assert_eq!(job.payload, json!({"preset": "1080p"}));

        let claimed = s.claim_next().expect("claim").expect("ada job");
        assert_eq!(
            (claimed.id.as_str(), claimed.state),
            ("job_1", JobState::Running)
        );
        assert_eq!(claimed.attempts, 1);

        s.handle_worker_event(WorkerEvent::Progress {
            job_id: "job_1".into(),
            step: 42,
            total_steps: 100,
            progress_fraction: 0.42,
            message: "Merender frame 42/100".into(),
        })
        .expect("progress");
        let j = s.get_job("job_1").expect("get").expect("ada");
        assert_eq!(j.progress, 0.42);
        assert_eq!(j.progress_label.as_deref(), Some("Merender frame 42/100"));

        s.handle_worker_event(WorkerEvent::Succeeded {
            job_id: "job_1".into(),
            output_path: Some("/tmp/out.mp4".into()),
        })
        .expect("succeeded");
        let j = s.get_job("job_1").expect("get").expect("ada");
        assert_eq!(j.state, JobState::Succeeded);
        assert_eq!(j.progress, 1.0);
        assert_eq!(j.output_path.as_deref(), Some("/tmp/out.mp4"));
        assert!(j.finished_at.is_some());
        // Setelah selesai tidak ada lagi yang bisa diambil.
        assert!(s.claim_next().expect("claim").is_none());
    }

    #[test]
    fn failed_event_records_error_and_cannot_fail_twice() {
        let s = JobSupervisor::in_memory().expect("db");
        enq(&s, "a", 0);
        s.claim_next().expect("claim");
        s.handle_worker_event(WorkerEvent::Failed {
            job_id: "a".into(),
            error_code: "PROJECT_LOAD".into(),
            message: "tidak ada".into(),
        })
        .expect("failed");
        let j = s.get_job("a").expect("get").expect("ada");
        assert_eq!(j.state, JobState::Failed);
        assert_eq!(j.error_code.as_deref(), Some("PROJECT_LOAD"));
        assert_eq!(j.error_detail.as_deref(), Some("tidak ada"));
        assert!(matches!(
            s.fail_job("a", "X", "y"),
            Err(JobError::InvalidStateTransition(
                JobState::Failed,
                JobState::Failed
            ))
        ));
    }

    #[test]
    fn queue_survives_reopen_with_state_priority_and_payload() {
        let path = temp_db("reopen");
        {
            let s = JobSupervisor::open(&path).expect("open");
            enq(&s, "low", 0);
            enq(&s, "high", 9);
            enq(&s, "paused", 5);
            s.pause_job("paused").expect("pause");
            s.claim_next().expect("claim"); // high -> running
            s.handle_worker_event(WorkerEvent::Succeeded {
                job_id: "high".into(),
                output_path: None,
            })
            .expect("done");
        }
        let s = JobSupervisor::open(&path).expect("reopen");
        assert_eq!(s.orphans_recovered(), 0);
        let jobs = s.list_jobs().expect("list");
        let view: Vec<(&str, JobState)> = jobs.iter().map(|j| (j.id.as_str(), j.state)).collect();
        assert_eq!(
            view,
            [
                ("high", JobState::Succeeded),
                ("paused", JobState::Paused),
                ("low", JobState::Queued)
            ]
        );
        assert_eq!(jobs[2].payload, json!({"n": "low"}));
        // Dilanjutkan setelah reopen: kembali ke antrean dengan prioritasnya.
        s.resume_job("paused").expect("resume");
        let next = s.claim_next().expect("claim").expect("ada");
        assert_eq!(next.id, "paused");
        cleanup(&path);
    }

    #[test]
    fn orphaned_running_jobs_return_to_queued_on_start_after_simulated_crash() {
        let path = temp_db("orphan");
        {
            let s = JobSupervisor::open(&path).expect("open");
            enq(&s, "a", 0);
            enq(&s, "b", 0);
            enq(&s, "c", 0);
            let a = s.claim_next().expect("claim").expect("ada");
            s.set_worker_pid(&a.id, Some(999_999)).expect("pid");
            s.handle_worker_event(WorkerEvent::Progress {
                job_id: "a".into(),
                step: 50,
                total_steps: 100,
                progress_fraction: 0.5,
                message: "setengah".into(),
            })
            .expect("progress");
            s.cancel_job("c").expect("cancel");
            // "Crash": supervisor dibuang tanpa menyelesaikan job `a`.
        }
        let s = JobSupervisor::open(&path).expect("reopen");
        assert_eq!(s.orphans_recovered(), 1);
        let a = s.get_job("a").expect("get").expect("ada");
        assert_eq!(a.state, JobState::Queued);
        assert_eq!((a.progress, a.worker_pid, a.started_at), (0.0, None, None));
        assert_eq!(a.attempts, 1, "percobaan sebelumnya tetap tercatat");
        assert_eq!(
            s.get_job("c").expect("get").expect("ada").state,
            JobState::Canceled
        );
        // `a` mendahului `b`: posisi semula dipertahankan.
        assert_eq!(s.claim_next().expect("claim").expect("ada").id, "a");
        assert_eq!(s.get_job("a").expect("get").expect("ada").attempts, 2);
        cleanup(&path);
    }

    #[test]
    fn claim_order_is_priority_desc_then_insertion_order() {
        let s = JobSupervisor::in_memory().expect("db");
        for (id, p) in [("a", 0), ("b", 5), ("c", 5), ("d", 9), ("e", -1)] {
            enq(&s, id, p);
        }
        let order: Vec<String> = std::iter::from_fn(|| s.claim_next().expect("claim"))
            .map(|j| j.id)
            .collect();
        assert_eq!(order, ["d", "b", "c", "a", "e"]);
    }

    #[test]
    fn pause_resume_cancel_rules() {
        let s = JobSupervisor::in_memory().expect("db");
        enq(&s, "q", 0);
        s.pause_job("q").expect("pause");
        // Job dijeda tidak diambil.
        assert!(s.claim_next().expect("claim").is_none());
        assert!(matches!(
            s.pause_job("q"),
            Err(JobError::InvalidStateTransition(
                JobState::Paused,
                JobState::Paused
            ))
        ));
        s.resume_job("q").expect("resume");
        assert!(matches!(
            s.resume_job("q"),
            Err(JobError::InvalidStateTransition(
                JobState::Queued,
                JobState::Queued
            ))
        ));
        s.claim_next().expect("claim");
        // Jeda saat berjalan ditolak jujur, status tidak berubah.
        assert!(matches!(s.pause_job("q"), Err(JobError::Unsupported(_))));
        assert_eq!(
            s.get_job("q").expect("get").expect("ada").state,
            JobState::Running
        );
        s.cancel_job("q").expect("cancel");
        let q = s.get_job("q").expect("get").expect("ada");
        assert_eq!(q.state, JobState::Canceled);
        assert!(q.finished_at.is_some());
        assert!(matches!(
            s.cancel_job("q"),
            Err(JobError::InvalidStateTransition(
                JobState::Canceled,
                JobState::Canceled
            ))
        ));
        assert!(matches!(s.cancel_job("nope"), Err(JobError::NotFound(_))));
    }

    #[test]
    fn late_worker_events_do_not_resurrect_a_canceled_job() {
        let s = JobSupervisor::in_memory().expect("db");
        enq(&s, "a", 0);
        s.claim_next().expect("claim");
        s.cancel_job("a").expect("cancel");
        s.handle_worker_event(WorkerEvent::Failed {
            job_id: "a".into(),
            error_code: "CANCELED".into(),
            message: "dibatalkan".into(),
        })
        .expect("diabaikan");
        s.handle_worker_event(WorkerEvent::Succeeded {
            job_id: "a".into(),
            output_path: Some("/x".into()),
        })
        .expect("diabaikan");
        let a = s.get_job("a").expect("get").expect("ada");
        assert_eq!(
            (a.state, a.error_code, a.output_path),
            (JobState::Canceled, None, None)
        );
    }

    #[test]
    fn secrets_in_payload_are_rejected_and_nothing_is_stored() {
        let s = JobSupervisor::in_memory().expect("db");
        for payload in [
            json!({"api_key": "x"}),
            json!({"opts": {"hf_token": "x"}}),
            json!({"list": [{"client_secret": "x"}]}),
            json!({"Password": "x"}),
        ] {
            assert!(matches!(
                s.enqueue("s".into(), JobKind::DownloadModel, None, payload, 0),
                Err(JobError::SecretRejected(_))
            ),);
        }
        assert!(s.list_jobs().expect("list").is_empty());
        s.enqueue(
            "ok".into(),
            JobKind::Render,
            None,
            json!({"output_path": "/o.mp4", "width": 128}),
            0,
        )
        .expect("payload biasa diterima");
    }

    #[test]
    fn duplicate_id_is_rejected() {
        let s = JobSupervisor::in_memory().expect("db");
        enq(&s, "a", 0);
        assert!(matches!(
            s.enqueue("a".into(), JobKind::Render, None, json!({}), 0),
            Err(JobError::Duplicate(_))
        ));
    }
}
