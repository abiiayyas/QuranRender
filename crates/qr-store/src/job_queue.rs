//! Antrean job persisten pada tabel `job` di app.db (A1-09, B2-12).
//! Skema ada di `0001_initial.sql` (02_DATABASE_SPECIFICATION.md §5). Modul ini hanya berisi SQL;
//! aturan transisi status dan eksekusi worker ada di crate `qr-jobs`.

use rusqlite::{params, OptionalExtension, Row};

use crate::{AppDb, StoreError};

/// Kolom `job` apa adanya. `kind` dan `state` berupa teks agar crate ini tidak bergantung pada `qr-jobs`;
/// batasan nilainya dijaga oleh `CHECK` di skema. Waktu dalam unix ms UTC.
#[derive(Debug, Clone, PartialEq)]
pub struct JobRow {
    pub id: String,
    pub kind: String,
    pub project_id: Option<String>,
    pub batch_id: Option<String>,
    pub payload: String,
    pub state: String,
    pub priority: i32,
    pub position: i64,
    pub attempts: u32,
    pub progress: f64,
    pub progress_label: Option<String>,
    pub output_path: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub worker_pid: Option<u32>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

/// Job baru yang akan dimasukkan ke antrean (status awal selalu `queued`).
#[derive(Debug, Clone, PartialEq)]
pub struct NewJobRow {
    pub id: String,
    pub kind: String,
    pub project_id: Option<String>,
    pub batch_id: Option<String>,
    /// JSON yang sudah diserialisasi.
    pub payload: String,
    pub priority: i32,
}

const COLUMNS: &str =
    "id, kind, project_id, batch_id, payload, state, priority, position, attempts, \
     progress, progress_label, output_path, error_code, error_detail, worker_pid, \
     created_at, started_at, finished_at";

fn row_to_job(r: &Row<'_>) -> rusqlite::Result<JobRow> {
    Ok(JobRow {
        id: r.get(0)?,
        kind: r.get(1)?,
        project_id: r.get(2)?,
        batch_id: r.get(3)?,
        payload: r.get(4)?,
        state: r.get(5)?,
        priority: r.get(6)?,
        position: r.get(7)?,
        attempts: r.get(8)?,
        progress: r.get(9)?,
        progress_label: r.get(10)?,
        output_path: r.get(11)?,
        error_code: r.get(12)?,
        error_detail: r.get(13)?,
        worker_pid: r.get(14)?,
        created_at: r.get(15)?,
        started_at: r.get(16)?,
        finished_at: r.get(17)?,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

fn is_terminal(state: &str) -> bool {
    matches!(state, "succeeded" | "failed" | "canceled")
}

impl AppDb {
    /// Memasukkan job `queued` di akhir antrean (posisi = maks + 1).
    /// `project_id` yang belum terdaftar di `project_index` disimpan `NULL` (FK skema); lokasi proyek tetap
    /// ada di payload.
    pub fn job_insert(&self, new: &NewJobRow) -> Result<JobRow, StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM job WHERE id = ?1)",
            [&new.id],
            |r| r.get(0),
        )?;
        if exists {
            return Err(StoreError::JobExists(new.id.clone()));
        }
        let project_id = match &new.project_id {
            Some(p) => {
                let indexed: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM project_index WHERE id = ?1)",
                    [p],
                    |r| r.get(0),
                )?;
                indexed.then(|| p.clone())
            }
            None => None,
        };
        let position: i64 =
            tx.query_row("SELECT COALESCE(MAX(position) + 1, 0) FROM job", [], |r| {
                r.get(0)
            })?;
        tx.execute(
            "INSERT INTO job (id, kind, project_id, batch_id, payload, state, priority, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8)",
            params![
                new.id,
                new.kind,
                project_id,
                new.batch_id,
                new.payload,
                new.priority,
                position,
                now_ms()
            ],
        )?;
        let row = tx.query_row(
            &format!("SELECT {COLUMNS} FROM job WHERE id = ?1"),
            [&new.id],
            row_to_job,
        )?;
        tx.commit()?;
        Ok(row)
    }

    pub fn job_get(&self, id: &str) -> Result<Option<JobRow>, StoreError> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM job WHERE id = ?1"),
                [id],
                row_to_job,
            )
            .optional()?)
    }

    /// Semua job, urut prioritas turun lalu posisi naik (urutan eksekusi untuk yang `queued`).
    pub fn job_list(&self) -> Result<Vec<JobRow>, StoreError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM job ORDER BY priority DESC, position ASC"
        ))?;
        let rows = stmt.query_map([], row_to_job)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Mengambil job `queued` terdepan dan menandainya `running` dalam satu transaksi.
    pub fn job_claim_next(&self) -> Result<Option<JobRow>, StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let id: Option<String> = tx
            .query_row(
                "SELECT id FROM job WHERE state = 'queued' ORDER BY priority DESC, position ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let Some(id) = id else {
            return Ok(None);
        };
        tx.execute(
            "UPDATE job SET state = 'running', attempts = attempts + 1, progress = 0, progress_label = NULL,
                 error_code = NULL, error_detail = NULL, output_path = NULL, worker_pid = NULL,
                 started_at = ?2, finished_at = NULL
             WHERE id = ?1",
            params![id, now_ms()],
        )?;
        let row = tx.query_row(
            &format!("SELECT {COLUMNS} FROM job WHERE id = ?1"),
            [&id],
            row_to_job,
        )?;
        tx.commit()?;
        Ok(Some(row))
    }

    /// Job yang tertinggal `running` (aplikasi/pengawas mati mendadak) kembali `queued` (A1-09).
    /// Hanya boleh dipanggil oleh pemilik antrean saat start. Mengembalikan jumlah job yang dipulihkan.
    pub fn job_recover_orphans(&self) -> Result<usize, StoreError> {
        Ok(self.conn.execute(
            "UPDATE job SET state = 'queued', progress = 0, progress_label = NULL, worker_pid = NULL,
                 started_at = NULL
             WHERE state = 'running'",
            [],
        )?)
    }

    /// Mengubah status bila status sekarang termasuk `from`. `false` bila tidak cocok (tidak ada perubahan).
    /// Status akhir mengisi `finished_at`; `running` mengisi `started_at` bila masih kosong.
    pub fn job_transition(&self, id: &str, from: &[&str], to: &str) -> Result<bool, StoreError> {
        let finished = is_terminal(to).then(now_ms);
        let placeholders = (0..from.len())
            .map(|i| format!("?{}", i + 5))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "UPDATE job SET state = ?2, finished_at = COALESCE(?3, finished_at),
                 started_at = CASE WHEN ?2 = 'running' THEN COALESCE(started_at, ?4) ELSE started_at END,
                 worker_pid = CASE WHEN ?3 IS NULL THEN worker_pid ELSE NULL END
             WHERE id = ?1 AND state IN ({placeholders})"
        );
        use rusqlite::types::Value;
        let mut args: Vec<Value> = vec![
            Value::Text(id.into()),
            Value::Text(to.into()),
            finished.map_or(Value::Null, Value::Integer),
            Value::Integer(now_ms()),
        ];
        args.extend(from.iter().map(|s| Value::Text((*s).into())));
        Ok(self.conn.execute(&sql, rusqlite::params_from_iter(args))? > 0)
    }

    /// Mencatat kemajuan; hanya berlaku untuk job `running`.
    pub fn job_set_progress(
        &self,
        id: &str,
        fraction: f64,
        label: Option<&str>,
    ) -> Result<bool, StoreError> {
        Ok(self.conn.execute(
            "UPDATE job SET progress = ?2, progress_label = ?3 WHERE id = ?1 AND state = 'running'",
            params![id, fraction.clamp(0.0, 1.0), label],
        )? > 0)
    }

    pub fn job_set_worker_pid(&self, id: &str, pid: Option<u32>) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE job SET worker_pid = ?2 WHERE id = ?1",
            params![id, pid],
        )?;
        Ok(())
    }

    /// Menyelesaikan job `running` sebagai `succeeded` atau `failed`. `false` bila job tidak `running`.
    pub fn job_finish(
        &self,
        id: &str,
        succeeded: bool,
        output_path: Option<&str>,
        error: Option<(&str, &str)>,
    ) -> Result<bool, StoreError> {
        let (code, detail) = error.unzip();
        Ok(self.conn.execute(
            "UPDATE job SET state = ?2, progress = CASE WHEN ?2 = 'succeeded' THEN 1 ELSE progress END,
                 output_path = ?3, error_code = ?4, error_detail = ?5, finished_at = ?6, worker_pid = NULL
             WHERE id = ?1 AND state = 'running'",
            params![
                id,
                if succeeded { "succeeded" } else { "failed" },
                output_path,
                code,
                detail,
                now_ms()
            ],
        )? > 0)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn new_job(id: &str, priority: i32) -> NewJobRow {
        NewJobRow {
            id: id.into(),
            kind: "render".into(),
            project_id: None,
            batch_id: None,
            payload: "{}".into(),
            priority,
        }
    }

    #[test]
    fn claim_orders_by_priority_then_position_and_marks_running() {
        let db = AppDb::open_in_memory().unwrap();
        db.job_insert(&new_job("a", 0)).unwrap();
        db.job_insert(&new_job("b", 9)).unwrap();
        db.job_insert(&new_job("c", 9)).unwrap();
        let order: Vec<String> = std::iter::from_fn(|| db.job_claim_next().unwrap())
            .map(|j| {
                assert_eq!(j.state, "running");
                assert_eq!(j.attempts, 1);
                j.id
            })
            .collect();
        assert_eq!(order, ["b", "c", "a"]);
    }

    #[test]
    fn unindexed_project_id_is_stored_null_and_duplicate_id_rejected() {
        let db = AppDb::open_in_memory().unwrap();
        let mut j = new_job("x", 0);
        j.project_id = Some("tidak-terindeks".into());
        assert_eq!(db.job_insert(&j).unwrap().project_id, None);
        assert!(matches!(db.job_insert(&j), Err(StoreError::JobExists(_))));
    }

    #[test]
    fn transitions_are_conditional_on_current_state() {
        let db = AppDb::open_in_memory().unwrap();
        db.job_insert(&new_job("a", 0)).unwrap();
        assert!(!db.job_transition("a", &["running"], "canceled").unwrap());
        assert!(db
            .job_transition("a", &["queued", "paused"], "paused")
            .unwrap());
        assert!(db.job_transition("a", &["paused"], "canceled").unwrap());
        let a = db.job_get("a").unwrap().unwrap();
        assert_eq!(a.state, "canceled");
        assert!(a.finished_at.is_some());
        assert!(!db.job_finish("a", true, None, None).unwrap());
    }

    #[test]
    fn orphans_return_to_queued_and_other_states_untouched() {
        let db = AppDb::open_in_memory().unwrap();
        for id in ["r", "p", "s"] {
            db.job_insert(&new_job(id, 0)).unwrap();
        }
        db.job_claim_next().unwrap(); // r
        db.job_set_worker_pid("r", Some(4242)).unwrap();
        db.job_transition("p", &["queued"], "paused").unwrap();
        db.job_claim_next().unwrap(); // s (p dijeda)
        db.job_finish("s", true, Some("/o.mp4"), None).unwrap();
        assert_eq!(db.job_recover_orphans().unwrap(), 1);
        let r = db.job_get("r").unwrap().unwrap();
        assert_eq!(
            (r.state.as_str(), r.worker_pid, r.started_at),
            ("queued", None, None)
        );
        assert_eq!(db.job_get("p").unwrap().unwrap().state, "paused");
        assert_eq!(db.job_get("s").unwrap().unwrap().state, "succeeded");
    }
}
