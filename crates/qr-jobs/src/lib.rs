//! Antrean job persisten dan supervisor eksekusi worker (PRD EXP-7, BAT-1..3, A1-09, B2-12).
//! Mengacu ke docs/product/PRD.md §7 EXP-7, BAT-1..3 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.4.
//!
//! Antrean disimpan di tabel `job` pada app.db (lewat `qr-store`). `JobSupervisor` memegang statusnya;
//! `QueueRunner` menjalankan job `queued` satu per satu lewat proses `qurender worker`.

pub mod batch;
pub mod protocol;
pub mod runner;
pub mod supervisor;

pub use batch::{
    enqueue_batch_jobs, split_project_into_batch_clips, BatchClipItem, BatchSplitMethod,
};
pub use protocol::{WorkerCommand, WorkerEvent};
pub use runner::{QueueRunner, RunSummary, WorkerSpec};
pub use supervisor::{JobSupervisor, NewJob};

use qr_store::JobRow;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JobError {
    #[error("Job tidak ditemukan: {0}")]
    NotFound(String),
    #[error("Job '{0}' sudah ada di antrean")]
    Duplicate(String),
    #[error("Transisi status tidak sah: dari {0:?} ke {1:?}")]
    InvalidStateTransition(JobState, JobState),
    #[error("Tidak didukung: {0}")]
    Unsupported(String),
    #[error(
        "Payload job memuat kunci rahasia '{0}'; rahasia hanya boleh di keychain OS (PRD SET-2)"
    )]
    SecretRejected(String),
    #[error("Penyimpanan antrean gagal: {0}")]
    Store(#[from] qr_store::StoreError),
    #[error("Payload job tidak dapat diserialisasi: {0}")]
    Json(#[from] serde_json::Error),
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

impl JobKind {
    /// Nama yang sama dengan nilai kolom `job.kind` dan field `kind` pada `WorkerCommand::Start`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Render => "render",
            Self::Align => "align",
            Self::BatchSplit => "batch_split",
            Self::DownloadEdition => "download_edition",
            Self::DownloadModel => "download_model",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "render" => Self::Render,
            "align" => Self::Align,
            "batch_split" => Self::BatchSplit,
            "download_edition" => Self::DownloadEdition,
            "download_model" => Self::DownloadModel,
            _ => return None,
        })
    }
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

impl JobState {
    /// Nama yang sama dengan nilai kolom `job.state`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "queued" => Self::Queued,
            "running" => Self::Running,
            "paused" => Self::Paused,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            "canceled" => Self::Canceled,
            _ => return None,
        })
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Canceled)
    }
}

/// Rekod job persisten. Waktu dalam unix ms UTC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRecord {
    pub id: String,
    pub kind: JobKind,
    pub project_id: Option<String>,
    pub batch_id: Option<String>,
    pub payload: serde_json::Value,
    pub state: JobState,
    /// Angka lebih besar dijalankan lebih dulu; seri diurutkan menurut `position` (urutan masuk).
    pub priority: i32,
    pub position: i64,
    pub attempts: u32,
    pub progress: f64,
    pub progress_label: Option<String>,
    pub output_path: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub worker_pid: Option<u32>,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
}

impl TryFrom<JobRow> for JobRecord {
    type Error = JobError;

    fn try_from(r: JobRow) -> Result<Self, JobError> {
        let kind = JobKind::parse(&r.kind)
            .ok_or_else(|| JobError::Internal(format!("kind job tidak dikenal: {}", r.kind)))?;
        let state = JobState::parse(&r.state)
            .ok_or_else(|| JobError::Internal(format!("status job tidak dikenal: {}", r.state)))?;
        let ms = |v: i64| u64::try_from(v).unwrap_or(0);
        Ok(Self {
            payload: serde_json::from_str(&r.payload)?,
            id: r.id,
            kind,
            project_id: r.project_id,
            batch_id: r.batch_id,
            state,
            priority: r.priority,
            position: r.position,
            attempts: r.attempts,
            progress: r.progress,
            progress_label: r.progress_label,
            output_path: r.output_path,
            error_code: r.error_code,
            error_detail: r.error_detail,
            worker_pid: r.worker_pid,
            created_at: ms(r.created_at),
            started_at: r.started_at.map(ms),
            finished_at: r.finished_at.map(ms),
        })
    }
}
