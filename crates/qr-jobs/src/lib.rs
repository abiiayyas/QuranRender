//! Antrean job persisten dan supervisor eksekusi worker (PRD EXP-7, BAT-1..3, A1-09, B2-12).
//! Mengacu ke docs/product/PRD.md §7 EXP-7, BAT-1..3 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.4.

pub mod batch;
pub mod protocol;

pub use batch::{
    enqueue_batch_jobs, split_project_into_batch_clips, BatchClipItem, BatchSplitMethod,
};
pub use protocol::{WorkerCommand, WorkerEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JobError {
    #[error("Job tidak ditemukan: {0}")]
    NotFound(String),
    #[error("Transisi status tidak sah: dari {0:?} ke {1:?}")]
    InvalidStateTransition(JobState, JobState),
    #[error("Kesalahan internal: {0}")]
    Internal(String),
}

/// Jenis tugas yang dapat dijalankan worker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Render,
    Align,
    BatchSplit,
    DownloadEdition,
    DownloadModel,
}

/// Status siklus hidup job dalam antrean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running,
    Paused,
    Succeeded,
    Failed,
    Canceled,
}

/// Rekod job persisten.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRecord {
    pub id: String,
    pub kind: JobKind,
    pub project_id: Option<String>,
    pub batch_id: Option<String>,
    pub payload: serde_json::Value,
    pub state: JobState,
    pub priority: i32,
    pub position: i64,
    pub attempts: u32,
    pub progress: f64,
    pub output_path: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
}

/// Supervisor antrean job in-memory (disinkronkan dengan app.db).
#[derive(Debug, Clone, Default)]
pub struct JobSupervisor {
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
}

impl JobSupervisor {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Menambahkan job baru ke antrean.
    pub fn enqueue(
        &self,
        id: String,
        kind: JobKind,
        project_id: Option<String>,
        payload: serde_json::Value,
        priority: i32,
    ) -> JobRecord {
        let mut map = self.jobs.lock().expect("Poisoned lock");
        let position = map.len() as i64;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());

        let record = JobRecord {
            id: id.clone(),
            kind,
            project_id,
            batch_id: None,
            payload,
            state: JobState::Queued,
            priority,
            position,
            attempts: 0,
            progress: 0.0,
            output_path: None,
            error_code: None,
            error_detail: None,
            created_at: now,
            started_at: None,
            finished_at: None,
        };

        map.insert(id, record.clone());
        record
    }

    /// Mengambil daftar semua job yang diurutkan berdasarkan prioritas dan posisi.
    pub fn list_jobs(&self) -> Vec<JobRecord> {
        let map = self.jobs.lock().expect("Poisoned lock");
        let mut list: Vec<JobRecord> = map.values().cloned().collect();
        list.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| a.position.cmp(&b.position))
        });
        list
    }

    /// Mengambil satu job berdasarkan ID.
    pub fn get_job(&self, id: &str) -> Option<JobRecord> {
        let map = self.jobs.lock().expect("Poisoned lock");
        map.get(id).cloned()
    }

    /// Memperbarui kemajuan dari WorkerEvent.
    pub fn handle_worker_event(&self, event: WorkerEvent) -> Result<(), JobError> {
        let mut map = self.jobs.lock().expect("Poisoned lock");
        match event {
            WorkerEvent::Started { job_id, .. } => {
                let job = map.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
                job.state = JobState::Running;
                job.started_at = Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_or(0, |d| d.as_secs()),
                );
            }
            WorkerEvent::Progress {
                job_id,
                progress_fraction,
                ..
            } => {
                let job = map.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
                if job.state == JobState::Running {
                    job.progress = progress_fraction.clamp(0.0, 1.0);
                }
            }
            WorkerEvent::Succeeded {
                job_id,
                output_path,
            } => {
                let job = map.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
                job.state = JobState::Succeeded;
                job.progress = 1.0;
                job.output_path = output_path;
                job.finished_at = Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_or(0, |d| d.as_secs()),
                );
            }
            WorkerEvent::Failed {
                job_id,
                error_code,
                message,
            } => {
                let job = map.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
                job.state = JobState::Failed;
                job.error_code = Some(error_code);
                job.error_detail = Some(message);
                job.finished_at = Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_or(0, |d| d.as_secs()),
                );
            }
        }
        Ok(())
    }

    /// Menjeda job yang sedang berjalan.
    pub fn pause_job(&self, id: &str) -> Result<(), JobError> {
        let mut map = self.jobs.lock().expect("Poisoned lock");
        let job = map
            .get_mut(id)
            .ok_or_else(|| JobError::NotFound(id.into()))?;
        if job.state == JobState::Running || job.state == JobState::Queued {
            job.state = JobState::Paused;
            Ok(())
        } else {
            Err(JobError::InvalidStateTransition(
                job.state,
                JobState::Paused,
            ))
        }
    }

    /// Melanjutkan job yang dijeda.
    pub fn resume_job(&self, id: &str) -> Result<(), JobError> {
        let mut map = self.jobs.lock().expect("Poisoned lock");
        let job = map
            .get_mut(id)
            .ok_or_else(|| JobError::NotFound(id.into()))?;
        if job.state == JobState::Paused {
            job.state = JobState::Queued;
            Ok(())
        } else {
            Err(JobError::InvalidStateTransition(
                job.state,
                JobState::Queued,
            ))
        }
    }

    /// Membatalkan job.
    pub fn cancel_job(&self, id: &str) -> Result<(), JobError> {
        let mut map = self.jobs.lock().expect("Poisoned lock");
        let job = map
            .get_mut(id)
            .ok_or_else(|| JobError::NotFound(id.into()))?;
        if job.state != JobState::Succeeded {
            job.state = JobState::Canceled;
            job.finished_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_secs()),
            );
            Ok(())
        } else {
            Err(JobError::InvalidStateTransition(
                job.state,
                JobState::Canceled,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_supervisor_lifecycle() {
        let supervisor = JobSupervisor::new();
        let job = supervisor.enqueue(
            "job_1".into(),
            JobKind::Render,
            Some("p1".into()),
            serde_json::json!({"preset": "1080p"}),
            10,
        );
        assert_eq!(job.state, JobState::Queued);

        // Handle started
        supervisor
            .handle_worker_event(WorkerEvent::Started {
                job_id: "job_1".into(),
                total_steps: 100,
            })
            .expect("Started event harus berhasil");
        let j = supervisor.get_job("job_1").expect("Pengujian job berhasil");
        assert_eq!(j.state, JobState::Running);

        // Handle progress
        supervisor
            .handle_worker_event(WorkerEvent::Progress {
                job_id: "job_1".into(),
                step: 42,
                total_steps: 100,
                progress_fraction: 0.42,
                message: "Merender frame 42/100".into(),
            })
            .expect("Progress event harus berhasil");
        let j = supervisor.get_job("job_1").expect("Pengujian job berhasil");
        assert_eq!(j.progress, 0.42);

        // Handle succeeded
        supervisor
            .handle_worker_event(WorkerEvent::Succeeded {
                job_id: "job_1".into(),
                output_path: Some("/tmp/out.mp4".into()),
            })
            .expect("Succeeded event harus berhasil");
        let j = supervisor.get_job("job_1").expect("Pengujian job berhasil");
        assert_eq!(j.state, JobState::Succeeded);
        assert_eq!(j.progress, 1.0);
        assert_eq!(j.output_path, Some("/tmp/out.mp4".into()));
    }

    #[test]
    fn test_job_pause_resume_cancel() {
        let supervisor = JobSupervisor::new();
        supervisor.enqueue(
            "job_2".into(),
            JobKind::Align,
            None,
            serde_json::json!({}),
            5,
        );

        supervisor
            .pause_job("job_2")
            .expect("Pengujian job berhasil");
        assert_eq!(
            supervisor
                .get_job("job_2")
                .expect("Pengujian job berhasil")
                .state,
            JobState::Paused
        );

        supervisor
            .resume_job("job_2")
            .expect("Pengujian job berhasil");
        assert_eq!(
            supervisor
                .get_job("job_2")
                .expect("Pengujian job berhasil")
                .state,
            JobState::Queued
        );

        supervisor
            .cancel_job("job_2")
            .expect("Pengujian job berhasil");
        assert_eq!(
            supervisor
                .get_job("job_2")
                .expect("Pengujian job berhasil")
                .state,
            JobState::Canceled
        );
    }
}
