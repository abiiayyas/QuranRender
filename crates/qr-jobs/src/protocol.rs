//! Protokol komunikasi IPC antara supervisor qr-jobs dan worker qurender (PRD EXP-7, BAT-2, A1-09).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.4.

use serde::{Deserialize, Serialize};

/// Perintah dari supervisor ke worker lewat stdin (JSON per baris).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum WorkerCommand {
    Start {
        job_id: String,
        kind: String,
        payload: serde_json::Value,
    },
    Cancel {
        job_id: String,
    },
    Pause {
        job_id: String,
    },
    Resume {
        job_id: String,
    },
}

/// Event kemajuan atau status dari worker ke supervisor lewat stdout (NDJSON).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum WorkerEvent {
    Started {
        job_id: String,
        total_steps: u64,
    },
    Progress {
        job_id: String,
        step: u64,
        total_steps: u64,
        progress_fraction: f64,
        message: String,
    },
    Succeeded {
        job_id: String,
        output_path: Option<String>,
    },
    Failed {
        job_id: String,
        error_code: String,
        message: String,
    },
}
