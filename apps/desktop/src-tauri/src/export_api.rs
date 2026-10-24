//! Ekspor video dan antrean job lewat `JobSupervisor` + `QueueRunner` (crates/qr-jobs) yang menjalankan
//! worker `qurender worker`. Event ke UI dipancarkan lewat [`EventSink`] agar uji memakai penampung, bukan jendela.
//!
//! Alur: `start_export` memvalidasi → memasukkan job `render` ke antrean persisten → satu thread antrean
//! menjalankan `QueueRunner::run_until_idle` → thread yang sama mencuplik status job di app.db dan
//! memancarkan `export-progress` (perubahan kemajuan) serta `export-finished` (sekali per job, terminal).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, UNIX_EPOCH};

use qr_jobs::{
    JobError, JobKind, JobRecord, JobState, JobSupervisor, NewJob, QueueRunner, WorkerSpec,
};
use serde::Serialize;
use specta::Type;

/// Nama event Tauri untuk kemajuan ekspor.
pub const EVENT_PROGRESS: &str = "export-progress";
/// Nama event Tauri untuk hasil akhir ekspor.
pub const EVENT_FINISHED: &str = "export-finished";

/// Prioritas job ekspor tunggal; di atas job batch (5) agar ekspor interaktif tidak menunggu antrean batch.
const EXPORT_PRIORITY: i32 = 10;

/// Payload event `export-progress`.
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct ExportProgressEvent {
    pub job_id: String,
    /// 0.0..=1.0.
    pub fraction: f64,
    pub message: String,
}

/// Payload event `export-finished` (sekali per job; `ok=false` untuk gagal maupun dibatalkan).
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct ExportFinishedEvent {
    pub job_id: String,
    pub ok: bool,
    /// Berkas hasil; hanya terisi bila `ok`.
    pub output_path: Option<String>,
    /// Kode galat worker (mis. `OUTPUT_EXISTS`, `CNT-5-OVERFLOW`, `CANCELED`); `None` bila `ok`.
    pub error_code: Option<String>,
    pub message: String,
}

/// Tujuan event; implementasi nyata membungkus `AppHandle`, uji memakai penampung.
pub trait EventSink: Send + Sync {
    fn export_progress(&self, event: &ExportProgressEvent);
    fn export_finished(&self, event: &ExportFinishedEvent);
}

/// Sink kosong (sebelum jendela siap).
#[derive(Debug, Default)]
pub struct NullSink;

impl EventSink for NullSink {
    fn export_progress(&self, _: &ExportProgressEvent) {}
    fn export_finished(&self, _: &ExportFinishedEvent) {}
}

/// Memancarkan event ke semua jendela Tauri.
pub struct TauriSink(pub tauri::AppHandle);

impl std::fmt::Debug for TauriSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TauriSink").finish_non_exhaustive()
    }
}

impl EventSink for TauriSink {
    fn export_progress(&self, event: &ExportProgressEvent) {
        use tauri::Emitter;
        if let Err(e) = self.0.emit(EVENT_PROGRESS, event) {
            tracing::warn!(%e, "gagal memancarkan {EVENT_PROGRESS}");
        }
    }
    fn export_finished(&self, event: &ExportFinishedEvent) {
        use tauri::Emitter;
        if let Err(e) = self.0.emit(EVENT_FINISHED, event) {
            tracing::warn!(%e, "gagal memancarkan {EVENT_FINISHED}");
        }
    }
}

/// Satu baris antrean untuk UI.
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct JobDto {
    pub id: String,
    /// `render`, `align`, `batch_split`, `download_edition`, `download_model`.
    pub kind: String,
    pub project_id: Option<String>,
    pub batch_id: Option<String>,
    /// Judul tampilan (judul klip batch atau nama berkas keluaran).
    pub title: Option<String>,
    /// `queued`, `running`, `paused`, `succeeded`, `failed`, `canceled`.
    pub state: String,
    pub priority: i32,
    /// 0.0..=1.0.
    pub progress: f64,
    pub progress_label: Option<String>,
    pub output_path: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub attempts: u32,
    /// Unix ms.
    pub created_at: f64,
    pub started_at: Option<f64>,
    pub finished_at: Option<f64>,
}

pub fn job_dto(j: &JobRecord) -> JobDto {
    let title = j
        .payload
        .get("title")
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .or_else(|| {
            j.payload
                .get("output_path")
                .and_then(|p| p.as_str())
                .and_then(|p| Path::new(p).file_name())
                .map(|n| n.to_string_lossy().to_string())
        });
    JobDto {
        id: j.id.clone(),
        kind: j.kind.as_str().to_string(),
        project_id: j.project_id.clone(),
        batch_id: j.batch_id.clone(),
        title,
        state: j.state.as_str().to_string(),
        priority: j.priority,
        progress: j.progress,
        progress_label: j.progress_label.clone(),
        output_path: j.output_path.clone(),
        error_code: j.error_code.clone(),
        error_detail: j.error_detail.clone(),
        attempts: j.attempts,
        created_at: j.created_at as f64,
        started_at: j.started_at.map(|v| v as f64),
        finished_at: j.finished_at.map(|v| v as f64),
    }
}

/// Cara menjalankan worker + lingkungan render yang diteruskan lewat payload.
#[derive(Debug, Clone)]
pub struct WorkerSetup {
    pub spec: WorkerSpec,
    pub resources_dir: Option<PathBuf>,
    pub ffmpeg_bin: Option<String>,
}

pub type WorkerResolver = Arc<dyn Fn() -> Result<WorkerSetup, String> + Send + Sync>;

/// Satu job render yang akan dimasukkan ke antrean.
#[derive(Debug, Clone)]
pub struct RenderJobSpec {
    pub project_id: String,
    pub project_dir: PathBuf,
    pub output_path: PathBuf,
    pub audio_path: Option<PathBuf>,
    pub width: Option<u32>,
    pub overwrite: bool,
}

/// Info batch untuk job: id batch dan metadata klip tambahan pada payload.
#[derive(Debug, Clone)]
pub struct BatchInfo {
    pub batch_id: String,
    pub extra: serde_json::Value,
}

struct Tracked {
    last_fraction: f64,
    last_message: String,
    output_path: PathBuf,
}

struct Inner {
    supervisor: JobSupervisor,
    resolver: WorkerResolver,
    sink: RwLock<Arc<dyn EventSink>>,
    tracked: Mutex<HashMap<String, Tracked>>,
    runner_active: Mutex<bool>,
    /// Menserialkan pencuplikan+emisi agar urutan event per job tidak tertukar antar thread.
    poll_lock: Mutex<()>,
    poll_interval: Duration,
    cancel_grace: Duration,
}

/// Layanan ekspor/antrean; murah di-`clone` (pegangan ke state bersama).
#[derive(Clone)]
pub struct ExportService(Arc<Inner>);

impl std::fmt::Debug for ExportService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExportService").finish_non_exhaustive()
    }
}

fn lock<T>(m: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| {
        "Status internal rusak (panic di thread lain). Mulai ulang aplikasi.".to_string()
    })
}

fn job_err(id: &str, action: &str, e: JobError) -> String {
    match e {
        JobError::NotFound(_) => format!("Job '{id}' tidak ditemukan"),
        JobError::InvalidStateTransition(from, _) => format!(
            "Job '{id}' berstatus '{}' sehingga tidak dapat {action}",
            from.as_str()
        ),
        other => other.to_string(),
    }
}

/// Menghapus keluaran parsial milik job yang dibatalkan: hanya bila berkas diubah setelah job mulai
/// (tidak pernah menyentuh berkas lama pengguna yang tidak sempat ditimpa).
fn remove_partial_output(path: &Path, started_at_ms: Option<u64>) {
    let Some(started) = started_at_ms else { return };
    let Ok(modified) = std::fs::metadata(path).and_then(|m| m.modified()) else {
        return;
    };
    let modified_ms = modified
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    if modified_ms + 2_000 >= started {
        let _ = std::fs::remove_file(path);
    }
}

impl ExportService {
    pub fn new(supervisor: JobSupervisor, resolver: WorkerResolver) -> Self {
        Self(Arc::new(Inner {
            supervisor,
            resolver,
            sink: RwLock::new(Arc::new(NullSink)),
            tracked: Mutex::new(HashMap::new()),
            runner_active: Mutex::new(false),
            poll_lock: Mutex::new(()),
            poll_interval: Duration::from_millis(100),
            cancel_grace: Duration::from_secs(10),
        }))
    }

    /// Mengganti tujuan event (dipanggil saat jendela siap).
    pub fn set_sink(&self, sink: Arc<dyn EventSink>) {
        if let Ok(mut s) = self.0.sink.write() {
            *s = sink;
        }
    }

    fn sink(&self) -> Arc<dyn EventSink> {
        self.0.sink.read().map_or_else(
            |_| Arc::new(NullSink) as Arc<dyn EventSink>,
            |s| Arc::clone(&s),
        )
    }

    pub fn supervisor(&self) -> &JobSupervisor {
        &self.0.supervisor
    }

    /// Payload `RenderPayload` (qr-cli) untuk worker.
    pub fn render_payload(
        spec: &RenderJobSpec,
        setup: &WorkerSetup,
        extra: Option<&serde_json::Value>,
    ) -> serde_json::Value {
        let mut payload = serde_json::json!({
            "project_dir": spec.project_dir,
            "output_path": spec.output_path,
            "overwrite": spec.overwrite,
        });
        if let Some(obj) = payload.as_object_mut() {
            if let Some(a) = &spec.audio_path {
                obj.insert("audio_path".into(), serde_json::json!(a));
            }
            if let Some(w) = spec.width {
                obj.insert("width".into(), serde_json::json!(w));
            }
            if let Some(r) = &setup.resources_dir {
                obj.insert("resources_dir".into(), serde_json::json!(r));
            }
            if let Some(f) = &setup.ffmpeg_bin {
                obj.insert("ffmpeg_bin".into(), serde_json::json!(f));
            }
            if let Some(serde_json::Value::Object(more)) = extra {
                for (k, v) in more {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        payload
    }

    /// Validasi ekspor tunggal tanpa efek samping.
    pub fn validate_export(&self, spec: &RenderJobSpec) -> Result<(), String> {
        if !spec.output_path.is_absolute() {
            return Err(format!(
                "Jalur keluaran harus absolut: {}",
                spec.output_path.display()
            ));
        }
        let is_mp4 = spec
            .output_path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("mp4"));
        if !is_mp4 {
            return Err(format!(
                "Berkas keluaran harus berekstensi .mp4: {}",
                spec.output_path.display()
            ));
        }
        if spec.output_path.is_dir() {
            return Err(format!(
                "Jalur keluaran adalah folder, bukan berkas: {}",
                spec.output_path.display()
            ));
        }
        if let Some(w) = spec.width {
            if !(64..=7680).contains(&w) {
                return Err(format!("Lebar keluaran {w} di luar rentang 64..7680"));
            }
        }
        if spec.output_path.exists() && !spec.overwrite {
            return Err(format!(
                "Berkas keluaran sudah ada: {} (pilih nama lain atau izinkan menimpa)",
                spec.output_path.display()
            ));
        }
        // Dua ekspor aktif ke berkas yang sama akan saling merusak.
        let jobs = self.0.supervisor.list_jobs().map_err(|e| e.to_string())?;
        let want = spec.output_path.to_string_lossy();
        let clash = jobs.iter().any(|j| {
            !j.state.is_terminal()
                && j.payload.get("output_path").and_then(|p| p.as_str()) == Some(want.as_ref())
        });
        if clash {
            return Err(format!(
                "Sudah ada ekspor aktif ke berkas yang sama: {}",
                spec.output_path.display()
            ));
        }
        Ok(())
    }

    /// Memasukkan satu job render ke antrean (tanpa menjalankan).
    fn enqueue_render(
        &self,
        id: String,
        spec: &RenderJobSpec,
        setup: &WorkerSetup,
        batch: Option<&BatchInfo>,
        priority: i32,
        track: bool,
    ) -> Result<JobRecord, String> {
        let payload = Self::render_payload(spec, setup, batch.map(|b| &b.extra));
        let job = self
            .0
            .supervisor
            .enqueue_job(NewJob {
                id: id.clone(),
                kind: JobKind::Render,
                project_id: Some(spec.project_id.clone()),
                batch_id: batch.map(|b| b.batch_id.clone()),
                payload,
                priority,
            })
            .map_err(|e| e.to_string())?;
        if track {
            lock(&self.0.tracked)?.insert(
                id,
                Tracked {
                    last_fraction: -1.0,
                    last_message: String::new(),
                    output_path: spec.output_path.clone(),
                },
            );
        }
        Ok(job)
    }

    /// Ekspor tunggal: validasi, masuk antrean, jalankan. Mengembalikan id job.
    pub fn start_export(&self, spec: &RenderJobSpec) -> Result<String, String> {
        self.validate_export(spec)?;
        let setup = (self.0.resolver)()?;
        let id = format!(
            "export_{}",
            ulid::Ulid::generate().to_string().to_lowercase()
        );
        self.enqueue_render(id.clone(), spec, &setup, None, EXPORT_PRIORITY, true)?;
        self.kick(setup)?;
        Ok(id)
    }

    /// Memasukkan beberapa job batch secara atomik (gagal di tengah → yang sudah masuk dibatalkan) lalu
    /// menjalankan antrean. `jobs`: (id, spec, info).
    pub fn enqueue_batch(
        &self,
        jobs: &[(String, RenderJobSpec, BatchInfo)],
    ) -> Result<Vec<JobRecord>, String> {
        let setup = (self.0.resolver)()?;
        let mut done: Vec<JobRecord> = Vec::new();
        for (id, spec, info) in jobs {
            match self.enqueue_render(id.clone(), spec, &setup, Some(info), 5, false) {
                Ok(j) => done.push(j),
                Err(e) => {
                    for j in &done {
                        let _ = self.0.supervisor.cancel_job(&j.id);
                    }
                    return Err(e);
                }
            }
        }
        self.kick(setup)?;
        Ok(done)
    }

    /// Menjamin tepat satu thread antrean berjalan selama ada job `queued`.
    fn kick(&self, setup: WorkerSetup) -> Result<(), String> {
        let mut active = lock(&self.0.runner_active)?;
        if *active {
            return Ok(());
        }
        let this = self.clone();
        std::thread::Builder::new()
            .name("qr-export-queue".into())
            .spawn(move || this.run_loop(setup.spec))
            .map_err(|e| format!("Thread antrean ekspor tidak dapat dibuat: {e}"))?;
        *active = true;
        Ok(())
    }

    fn has_queued(&self) -> bool {
        self.0
            .supervisor
            .list_jobs()
            .map(|jobs| jobs.iter().any(|j| j.state == JobState::Queued))
            .unwrap_or(false)
    }

    fn run_loop(&self, spec: WorkerSpec) {
        let mut runner = QueueRunner::new(self.0.supervisor.clone(), spec);
        runner.cancel_grace = self.0.cancel_grace;
        loop {
            let r = runner.clone();
            let handle = std::thread::spawn(move || r.run_until_idle());
            while !handle.is_finished() {
                self.poll_tracked();
                std::thread::sleep(self.0.poll_interval);
            }
            let failure = match handle.join() {
                Ok(Ok(_)) => None,
                Ok(Err(e)) => Some(e.to_string()),
                Err(_) => Some("thread pelari antrean berhenti tak terduga".to_string()),
            };
            if let Some(msg) = &failure {
                tracing::error!(%msg, "pelari antrean gagal");
                let ids: Vec<String> = lock(&self.0.tracked)
                    .map(|t| t.keys().cloned().collect())
                    .unwrap_or_default();
                for id in ids {
                    // Hanya job yang masih `running` yang bisa digagalkan; sisanya biarkan.
                    let _ = self.0.supervisor.fail_job(&id, "QUEUE_ERROR", msg);
                }
            }
            self.poll_tracked();
            let Ok(mut active) = lock(&self.0.runner_active) else {
                return;
            };
            if failure.is_none() && self.has_queued() {
                continue; // job baru masuk saat putaran terakhir selesai
            }
            *active = false;
            return;
        }
    }

    /// Mencuplik status job terlacak dan memancarkan event: progres saat berubah, `finished` sekali.
    pub fn poll_tracked(&self) {
        let Ok(_serial) = lock(&self.0.poll_lock) else {
            return;
        };
        let ids: Vec<String> = match lock(&self.0.tracked) {
            Ok(t) => t.keys().cloned().collect(),
            Err(_) => return,
        };
        let sink = self.sink();
        for id in ids {
            let Ok(Some(job)) = self.0.supervisor.get_job(&id) else {
                continue;
            };
            let mut progress: Vec<ExportProgressEvent> = Vec::new();
            let mut finished: Option<ExportFinishedEvent> = None;
            {
                let Ok(mut tracked) = lock(&self.0.tracked) else {
                    return;
                };
                let Some(t) = tracked.get_mut(&id) else {
                    continue;
                };
                let message = job
                    .progress_label
                    .clone()
                    .unwrap_or_else(|| "Memproses".to_string());
                match job.state {
                    JobState::Running => {
                        let fraction = job.progress.clamp(0.0, 1.0);
                        if t.last_fraction < 0.0
                            || (fraction - t.last_fraction).abs() > 1e-9
                            || message != t.last_message
                        {
                            t.last_fraction = fraction;
                            t.last_message = message.clone();
                            progress.push(ExportProgressEvent {
                                job_id: id.clone(),
                                fraction,
                                message,
                            });
                        }
                    }
                    JobState::Succeeded => {
                        if t.last_fraction < 1.0 {
                            progress.push(ExportProgressEvent {
                                job_id: id.clone(),
                                fraction: 1.0,
                                message: "Selesai".to_string(),
                            });
                        }
                        finished = Some(ExportFinishedEvent {
                            job_id: id.clone(),
                            ok: true,
                            output_path: job
                                .output_path
                                .clone()
                                .or_else(|| Some(t.output_path.to_string_lossy().to_string())),
                            error_code: None,
                            message: "Ekspor selesai".to_string(),
                        });
                    }
                    JobState::Failed => {
                        finished = Some(ExportFinishedEvent {
                            job_id: id.clone(),
                            ok: false,
                            output_path: None,
                            error_code: job.error_code.clone(),
                            message: job
                                .error_detail
                                .clone()
                                .unwrap_or_else(|| "Ekspor gagal".to_string()),
                        });
                    }
                    JobState::Canceled => {
                        remove_partial_output(&t.output_path, job.started_at);
                        finished = Some(ExportFinishedEvent {
                            job_id: id.clone(),
                            ok: false,
                            output_path: None,
                            error_code: Some("CANCELED".to_string()),
                            message: "Ekspor dibatalkan".to_string(),
                        });
                    }
                    JobState::Queued | JobState::Paused => {}
                }
                if finished.is_some() {
                    tracked.remove(&id);
                }
            }
            for p in &progress {
                sink.export_progress(p);
            }
            if let Some(f) = &finished {
                sink.export_finished(f);
            }
        }
    }

    pub fn status(&self, id: &str) -> Result<JobDto, String> {
        self.0
            .supervisor
            .get_job(id)
            .map_err(|e| e.to_string())?
            .map(|j| job_dto(&j))
            .ok_or_else(|| format!("Job '{id}' tidak ditemukan"))
    }

    pub fn list(&self) -> Result<Vec<JobDto>, String> {
        Ok(self
            .0
            .supervisor
            .list_jobs()
            .map_err(|e| e.to_string())?
            .iter()
            .map(job_dto)
            .collect())
    }

    /// Membatalkan job (antre/jeda/berjalan). Worker yang sedang berjalan dihentikan oleh pelari antrean
    /// dan keluaran parsial dibersihkan.
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        self.0
            .supervisor
            .cancel_job(id)
            .map_err(|e| job_err(id, "dibatalkan", e))?;
        // Job yang belum pernah berjalan tidak punya pelari yang melaporkannya: pancarkan hasilnya sekarang.
        self.poll_tracked();
        Ok(())
    }

    /// Menjeda job `queued`. Job `running` ditolak (worker belum mendukung jeda).
    pub fn pause(&self, id: &str) -> Result<(), String> {
        self.0
            .supervisor
            .pause_job(id)
            .map_err(|e| job_err(id, "dijeda", e))
    }

    /// Melanjutkan job `paused` dan memastikan antrean berjalan.
    pub fn resume(&self, id: &str) -> Result<(), String> {
        self.0
            .supervisor
            .resume_job(id)
            .map_err(|e| job_err(id, "dilanjutkan", e))?;
        let setup = (self.0.resolver)()?;
        self.kick(setup)
    }
}

/// Setelan worker untuk biner `program`: env worker dan payload membawa lokasi sumber daya/dataset serta
/// `ffmpeg` yang sudah diselesaikan (PATH aplikasi GUI macOS minimal). `QR_CONTENT_DB` menunjuk ke
/// content.db aplikasi agar worker membaca edisi terjemahan unduhan yang sama dengan preview.
pub fn worker_setup_for(program: PathBuf) -> WorkerSetup {
    let resources = crate::render_api::resources_root();
    let dataset = crate::render_api::dataset_dir();
    let spec = WorkerSpec::qurender(program)
        .with_env("QR_RESOURCES_DIR", resources.to_string_lossy().to_string())
        .with_env("QR_DATASET_DIR", dataset.to_string_lossy().to_string())
        .with_env(
            qr_cli::CONTENT_DB_ENV,
            crate::translation_api::content_db_path()
                .to_string_lossy()
                .to_string(),
        );
    WorkerSetup {
        spec,
        resources_dir: Some(resources),
        ffmpeg_bin: Some(crate::tools::media_tool("ffmpeg")),
    }
}

/// Pemecah worker produksi: `QR_WORKER_BIN`, selain itu executable aplikasi ini (lihat `tools::resolve_worker`).
pub fn default_resolver() -> WorkerResolver {
    Arc::new(|| Ok(worker_setup_for(crate::tools::resolve_worker()?)))
}

/// Spesifikasi ekspor dari proyek terdaftar. Worker membaca proyek dari disk: simpan dulu (`project_save`)
/// perubahan yang ingin ikut diekspor.
pub fn export_spec_for(
    db: &Mutex<qr_store::AppDb>,
    project_id: &str,
    output_path: &str,
    width: Option<u32>,
    overwrite: bool,
) -> Result<RenderJobSpec, String> {
    let (dir, project) = crate::project_io::load_registered(db, project_id)?;
    if project.segments.is_empty() {
        return Err(
            "Proyek belum memiliki segmen ayat; jalankan sinkron (penjajaran) sebelum ekspor"
                .to_string(),
        );
    }
    let audio_path = match crate::project_io::project_audio_path(&project) {
        Some(p) if p.is_file() => Some(p),
        Some(p) => {
            return Err(format!(
                "Berkas audio proyek tidak ditemukan: {} (dipindahkan atau dihapus?). Impor ulang audionya.",
                p.display()
            ))
        }
        None => None,
    };
    Ok(RenderJobSpec {
        project_id: project_id.to_string(),
        project_dir: dir,
        output_path: PathBuf::from(output_path),
        audio_path,
        width,
        overwrite,
    })
}

/// Memulai ekspor MP4 lewat antrean job persisten dan worker `qurender`. Mengembalikan `job_id`.
/// Kemajuan: event `export-progress` {job_id, fraction, message}; hasil: `export-finished`
/// {job_id, ok, output_path, error_code, message}.
#[tauri::command]
#[specta::specta]
pub fn export_start(
    project_id: String,
    output_path: String,
    width: Option<u32>,
    overwrite: bool,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let spec = export_spec_for(&state.db, &project_id, &output_path, width, overwrite)?;
    state.jobs.start_export(&spec)
}

/// Membatalkan ekspor (juga job antrean). Keluaran parsial dibersihkan; `export-finished` dengan
/// `error_code = "CANCELED"` menyusul.
#[tauri::command]
#[specta::specta]
pub fn export_cancel(
    job_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.jobs.cancel(&job_id)
}

/// Status satu job (ekspor atau batch).
#[tauri::command]
#[specta::specta]
pub fn export_status(
    job_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<JobDto, String> {
    state.jobs.status(&job_id)
}

/// Seluruh job antrean (prioritas turun, lalu urutan masuk).
#[tauri::command]
#[specta::specta]
pub fn queue_list(state: tauri::State<'_, crate::AppState>) -> Result<Vec<JobDto>, String> {
    state.jobs.list()
}

/// Membatalkan job antrean/berjalan/dijeda.
#[tauri::command]
#[specta::specta]
pub fn queue_cancel(
    job_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.jobs.cancel(&job_id)
}

/// Menjeda job yang masih antre. Job yang sedang berjalan ditolak (worker belum mendukung jeda).
#[tauri::command]
#[specta::specta]
pub fn queue_pause(job_id: String, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    state.jobs.pause(&job_id)
}

/// Melanjutkan job yang dijeda dan memastikan antrean berjalan.
#[tauri::command]
#[specta::specta]
pub fn queue_resume(
    job_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.jobs.resume(&job_id)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
pub(crate) mod tests {
    use super::*;
    use crate::project_io::test_support::TempDir;

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64)
    }

    /// Penampung event untuk uji.
    #[derive(Default, Debug)]
    pub struct CollectingSink {
        pub progress: Mutex<Vec<ExportProgressEvent>>,
        pub finished: Mutex<Vec<ExportFinishedEvent>>,
    }

    impl EventSink for CollectingSink {
        fn export_progress(&self, e: &ExportProgressEvent) {
            self.progress.lock().unwrap().push(e.clone());
        }
        fn export_finished(&self, e: &ExportFinishedEvent) {
            self.finished.lock().unwrap().push(e.clone());
        }
    }

    impl CollectingSink {
        pub fn wait_finished(&self, id: &str, timeout: Duration) -> Option<ExportFinishedEvent> {
            let end = std::time::Instant::now() + timeout;
            while std::time::Instant::now() < end {
                if let Some(f) = self
                    .finished
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|f| f.job_id == id)
                {
                    return Some(f.clone());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            None
        }

        pub fn wait_progress(&self, id: &str, timeout: Duration) -> bool {
            let end = std::time::Instant::now() + timeout;
            while std::time::Instant::now() < end {
                if self
                    .progress
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|p| p.job_id == id && p.fraction > 0.0)
                {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            false
        }
    }

    pub fn service_with(
        worker: impl Fn() -> Result<WorkerSetup, String> + Send + Sync + 'static,
    ) -> (ExportService, Arc<CollectingSink>) {
        let svc = ExportService::new(JobSupervisor::in_memory().unwrap(), Arc::new(worker));
        let sink = Arc::new(CollectingSink::default());
        svc.set_sink(sink.clone());
        (svc, sink)
    }

    pub fn setup_for(program: &Path) -> WorkerSetup {
        WorkerSetup {
            spec: WorkerSpec::qurender(program),
            resources_dir: None,
            ffmpeg_bin: None,
        }
    }

    fn spec_for(dir: &Path, out: &str) -> RenderJobSpec {
        RenderJobSpec {
            project_id: "p1".into(),
            project_dir: dir.join("p.qrproj"),
            output_path: dir.join(out),
            audio_path: None,
            width: None,
            overwrite: false,
        }
    }

    /// Worker palsu (skrip sh) yang berbicara protokol NDJSON: menulis berkas parsial, lapor 10 langkah,
    /// menyelesaikan; pada `cancel` menghapus berkas dan melapor CANCELED. Hanya Unix.
    #[cfg(unix)]
    pub fn write_fake_worker(dir: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let script = r#"#!/bin/sh
emit() { printf '%s\n' "$1"; }
job=""; out=""; pid=""
while IFS= read -r line; do
  case "$line" in
    *'"command":"start"'*)
      job=$(printf '%s' "$line" | sed -n 's/.*"job_id":"\([^"]*\)".*/\1/p')
      out=$(printf '%s' "$line" | sed -n 's/.*"output_path":"\([^"]*\)".*/\1/p')
      (
        emit "{\"event\":\"started\",\"job_id\":\"$job\",\"total_steps\":100}"
        printf 'parsial' > "$out"
        i=1
        while [ $i -le 10 ]; do
          sleep 0.15
          frac="0.$i"; [ $i -eq 10 ] && frac="1.0"
          emit "{\"event\":\"progress\",\"job_id\":\"$job\",\"step\":$i,\"total_steps\":10,\"progress_fraction\":$frac,\"message\":\"Frame $i/10\"}"
          i=$((i+1))
        done
        printf 'selesai' > "$out"
        emit "{\"event\":\"succeeded\",\"job_id\":\"$job\",\"output_path\":\"$out\"}"
      ) &
      pid=$!
      ;;
    *'"command":"cancel"'*)
      [ -n "$pid" ] && kill "$pid" 2>/dev/null
      rm -f "$out"
      emit "{\"event\":\"failed\",\"job_id\":\"$job\",\"error_code\":\"CANCELED\",\"message\":\"dibatalkan\"}"
      exit 0
      ;;
  esac
done
wait
"#;
        let p = dir.join("fake-qurender.sh");
        std::fs::write(&p, script).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[test]
    fn validate_export_rejects_bad_requests_before_touching_the_queue() {
        let tmp = TempDir::new("exp_val");
        let (svc, _sink) = service_with(|| Err("tidak dipanggil".into()));
        let ok = spec_for(tmp.path(), "a.mp4");
        svc.validate_export(&ok).unwrap();

        let mut s = ok.clone();
        s.output_path = PathBuf::from("relatif.mp4");
        assert!(svc.validate_export(&s).unwrap_err().contains("absolut"));
        let mut s = ok.clone();
        s.output_path = tmp.path().join("a.mov");
        assert!(svc.validate_export(&s).unwrap_err().contains(".mp4"));
        let mut s = ok.clone();
        s.width = Some(10);
        assert!(svc.validate_export(&s).unwrap_err().contains("64..7680"));
        s.width = Some(9000);
        assert!(svc.validate_export(&s).is_err());
        let mut s = ok.clone();
        s.output_path = tmp.path().join("folder.mp4");
        std::fs::create_dir(&s.output_path).unwrap();
        assert!(svc.validate_export(&s).unwrap_err().contains("folder"));

        let existing = tmp.path().join("ada.mp4");
        std::fs::write(&existing, "x").unwrap();
        let mut s = ok.clone();
        s.output_path = existing.clone();
        assert!(svc.validate_export(&s).unwrap_err().contains("sudah ada"));
        s.overwrite = true;
        svc.validate_export(&s).unwrap();
        assert!(
            svc.list().unwrap().is_empty(),
            "validasi tidak boleh mengantre apa pun"
        );
    }

    #[test]
    fn missing_worker_is_a_clear_error_and_enqueues_nothing() {
        let tmp = TempDir::new("exp_noworker");
        let (svc, _sink) = service_with(|| Err("Worker ekspor (qurender) tidak ditemukan.".into()));
        let err = svc
            .start_export(&spec_for(tmp.path(), "a.mp4"))
            .unwrap_err();
        assert!(err.contains("Worker ekspor"), "{err}");
        assert!(svc.list().unwrap().is_empty());
    }

    #[test]
    fn render_payload_matches_the_worker_contract() {
        let tmp = TempDir::new("exp_payload");
        let mut spec = spec_for(tmp.path(), "a.mp4");
        spec.audio_path = Some(tmp.path().join("a.wav"));
        spec.width = Some(540);
        spec.overwrite = true;
        let setup = WorkerSetup {
            spec: WorkerSpec::qurender("/x/qurender"),
            resources_dir: Some(PathBuf::from("/res")),
            ffmpeg_bin: Some("/usr/local/bin/ffmpeg".into()),
        };
        let extra = serde_json::json!({"title": "Klip 1", "clip_index": 1});
        let p = ExportService::render_payload(&spec, &setup, Some(&extra));
        assert_eq!(p["width"], 540);
        assert_eq!(p["overwrite"], true);
        assert_eq!(p["resources_dir"], "/res");
        assert_eq!(p["ffmpeg_bin"], "/usr/local/bin/ffmpeg");
        assert_eq!(p["title"], "Klip 1");
        assert!(p["output_path"].as_str().unwrap().ends_with("a.mp4"));
        assert!(p["audio_path"].as_str().unwrap().ends_with("a.wav"));
        // Tanpa opsional: kunci tidak ada (bukan null) agar serde default worker berlaku.
        let bare = ExportService::render_payload(
            &spec_for(tmp.path(), "b.mp4"),
            &setup_for(Path::new("/x")),
            None,
        );
        assert!(bare.get("width").is_none() && bare.get("audio_path").is_none());
    }

    #[test]
    fn job_dto_has_title_and_plain_numbers() {
        let (svc, _s) = service_with(|| Err("x".into()));
        let tmp = TempDir::new("exp_dto");
        let spec = spec_for(tmp.path(), "hasil.mp4");
        let setup = setup_for(Path::new("/x"));
        svc.enqueue_render("j1".into(), &spec, &setup, None, 3, false)
            .unwrap();
        svc.enqueue_render(
            "j2".into(),
            &spec_for(tmp.path(), "b.mp4"),
            &setup,
            Some(&BatchInfo {
                batch_id: "b1".into(),
                extra: serde_json::json!({"title": "Judul Klip"}),
            }),
            5,
            false,
        )
        .unwrap();
        let list = svc.list().unwrap();
        assert_eq!(list.len(), 2);
        let j1 = svc.status("j1").unwrap();
        assert_eq!(j1.title.as_deref(), Some("hasil.mp4"));
        assert_eq!(
            (j1.kind.as_str(), j1.state.as_str(), j1.priority),
            ("render", "queued", 3)
        );
        let j2 = svc.status("j2").unwrap();
        assert_eq!(j2.title.as_deref(), Some("Judul Klip"));
        assert_eq!(j2.batch_id.as_deref(), Some("b1"));
        // Prioritas turun: j2 (5) mendahului j1 (3).
        assert_eq!(list[0].id, "j2");
        assert!(svc
            .status("tidak-ada")
            .unwrap_err()
            .contains("tidak ditemukan"));
    }

    #[test]
    fn pause_resume_cancel_follow_supervisor_rules_with_clear_messages() {
        let tmp = TempDir::new("exp_ctl");
        let (svc, _s) = service_with(|| Err("tanpa worker".into()));
        let setup = setup_for(Path::new("/x"));
        svc.enqueue_render(
            "q1".into(),
            &spec_for(tmp.path(), "a.mp4"),
            &setup,
            None,
            0,
            false,
        )
        .unwrap();

        svc.pause("q1").unwrap();
        assert_eq!(svc.status("q1").unwrap().state, "paused");
        assert!(svc.pause("q1").unwrap_err().contains("tidak dapat dijeda"));
        // Lanjutkan gagal memulai pelari karena worker tidak ada, tetapi job sudah kembali ke antrean.
        let err = svc.resume("q1").unwrap_err();
        assert!(err.contains("tanpa worker"), "{err}");
        assert_eq!(svc.status("q1").unwrap().state, "queued");

        svc.cancel("q1").unwrap();
        assert_eq!(svc.status("q1").unwrap().state, "canceled");
        assert!(svc.cancel("q1").unwrap_err().contains("canceled"));
        assert!(svc.cancel("nope").unwrap_err().contains("tidak ditemukan"));
        assert!(svc.pause("nope").unwrap_err().contains("tidak ditemukan"));

        // Job yang sedang berjalan tidak bisa dijeda (pesan pustaka disampaikan).
        svc.enqueue_render(
            "r1".into(),
            &spec_for(tmp.path(), "r.mp4"),
            &setup,
            None,
            0,
            false,
        )
        .unwrap();
        svc.supervisor().claim_next().unwrap().unwrap();
        let err = svc.pause("r1").unwrap_err();
        assert!(err.contains("belum didukung"), "{err}");
    }

    #[test]
    fn duplicate_active_output_is_rejected() {
        let tmp = TempDir::new("exp_dup");
        let (svc, _s) = service_with(|| Err("x".into()));
        let setup = setup_for(Path::new("/x"));
        let spec = spec_for(tmp.path(), "sama.mp4");
        svc.enqueue_render("a".into(), &spec, &setup, None, 0, false)
            .unwrap();
        let err = svc.validate_export(&spec).unwrap_err();
        assert!(err.contains("ekspor aktif"), "{err}");
        svc.cancel("a").unwrap();
        svc.validate_export(&spec).unwrap();
    }

    #[test]
    fn partial_output_cleanup_only_touches_files_written_after_the_job_started() {
        let tmp = TempDir::new("exp_partial");
        let f = tmp.path().join("x.mp4");
        std::fs::write(&f, "lama").unwrap();
        // Job belum pernah mulai: berkas lama pengguna aman.
        remove_partial_output(&f, None);
        assert!(f.exists());
        // Job mulai jauh setelah berkas terakhir diubah: berkas lama aman.
        remove_partial_output(&f, Some(now_ms() + 60_000));
        assert!(f.exists());
        // Berkas ditulis setelah job mulai: parsial → dihapus.
        remove_partial_output(&f, Some(now_ms().saturating_sub(1_000)));
        assert!(!f.exists());
    }

    #[cfg(unix)]
    #[test]
    fn export_runs_through_queue_emits_progress_then_finished_and_leaves_the_file() {
        let tmp = TempDir::new("exp_e2e");
        let worker = write_fake_worker(tmp.path());
        let (svc, sink) = service_with({
            let w = worker.clone();
            move || Ok(setup_for(&w))
        });
        let spec = spec_for(tmp.path(), "hasil.mp4");
        let id = svc.start_export(&spec).unwrap();
        assert!(id.starts_with("export_"));

        let fin = sink
            .wait_finished(&id, Duration::from_secs(30))
            .expect("event export-finished");
        assert!(fin.ok, "{fin:?}");
        assert_eq!(fin.error_code, None);
        assert_eq!(
            fin.output_path.as_deref(),
            Some(spec.output_path.to_str().unwrap())
        );
        assert_eq!(
            std::fs::read_to_string(&spec.output_path).unwrap(),
            "selesai"
        );

        let progress = sink.progress.lock().unwrap().clone();
        assert!(
            progress.len() >= 2,
            "harus ada beberapa event progres: {progress:?}"
        );
        assert!(progress
            .iter()
            .all(|p| p.job_id == id && (0.0..=1.0).contains(&p.fraction)));
        let fr: Vec<f64> = progress.iter().map(|p| p.fraction).collect();
        assert!(
            fr.windows(2).all(|w| w[0] <= w[1]),
            "progres tidak boleh mundur: {fr:?}"
        );
        assert_eq!(*fr.last().unwrap(), 1.0);
        assert!(
            progress.iter().any(|p| p.message.starts_with("Frame ")),
            "{progress:?}"
        );
        assert_eq!(
            sink.finished.lock().unwrap().len(),
            1,
            "finished tepat sekali"
        );
        let st = svc.status(&id).unwrap();
        assert_eq!((st.state.as_str(), st.progress), ("succeeded", 1.0));

        // Ekspor kedua ke berkas yang sama ditolak sampai overwrite diizinkan.
        assert!(svc.start_export(&spec).unwrap_err().contains("sudah ada"));
    }

    #[cfg(unix)]
    #[test]
    fn cancel_mid_export_stops_the_worker_leaves_no_file_and_reports_canceled() {
        let tmp = TempDir::new("exp_cancel");
        let worker = write_fake_worker(tmp.path());
        let (svc, sink) = service_with({
            let w = worker.clone();
            move || Ok(setup_for(&w))
        });
        let spec = spec_for(tmp.path(), "batal.mp4");
        let id = svc.start_export(&spec).unwrap();
        assert!(
            sink.wait_progress(&id, Duration::from_secs(20)),
            "progres pertama harus datang"
        );
        assert!(
            spec.output_path.exists(),
            "worker sudah menulis keluaran parsial"
        );

        svc.cancel(&id).unwrap();
        let fin = sink
            .wait_finished(&id, Duration::from_secs(30))
            .expect("event export-finished");
        assert!(!fin.ok);
        assert_eq!(fin.error_code.as_deref(), Some("CANCELED"));
        assert_eq!(fin.output_path, None);
        // Beri pelari waktu menutup worker; tidak boleh ada berkas tersisa.
        let end = std::time::Instant::now() + Duration::from_secs(10);
        while spec.output_path.exists() && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            !spec.output_path.exists(),
            "pembatalan tidak boleh meninggalkan berkas"
        );
        assert_eq!(svc.status(&id).unwrap().state, "canceled");
        assert_eq!(sink.finished.lock().unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn queued_job_runs_after_the_active_one_and_a_paused_one_waits_for_resume() {
        let tmp = TempDir::new("exp_queue");
        let worker = write_fake_worker(tmp.path());
        let (svc, sink) = service_with({
            let w = worker.clone();
            move || Ok(setup_for(&w))
        });
        let a = svc.start_export(&spec_for(tmp.path(), "a.mp4")).unwrap();
        let b = svc.start_export(&spec_for(tmp.path(), "b.mp4")).unwrap();
        svc.pause(&b).unwrap();
        assert!(sink.wait_finished(&a, Duration::from_secs(30)).unwrap().ok);
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(
            svc.status(&b).unwrap().state,
            "paused",
            "job yang dijeda tidak boleh jalan"
        );
        assert!(!tmp.path().join("b.mp4").exists());
        svc.resume(&b).unwrap();
        assert!(sink.wait_finished(&b, Duration::from_secs(30)).unwrap().ok);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("b.mp4")).unwrap(),
            "selesai"
        );
    }

    #[cfg(unix)]
    #[test]
    fn cancel_of_a_paused_export_still_emits_finished_without_a_runner() {
        let tmp = TempDir::new("exp_cancel_paused");
        let (svc, sink) = service_with(|| Err("tidak ada worker".into()));
        let setup = setup_for(Path::new("/x"));
        let spec = spec_for(tmp.path(), "p.mp4");
        svc.enqueue_render("pj".into(), &spec, &setup, None, 0, true)
            .unwrap();
        svc.pause("pj").unwrap();
        svc.cancel("pj").unwrap();
        let f = sink.finished.lock().unwrap().clone();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].error_code.as_deref(), Some("CANCELED"));
    }

    // ---- export_spec_for ----

    fn segment(surah: u32, ayah: u32, seconds: i64) -> qr_core::project::AyahSegment {
        qr_core::project::AyahSegment {
            id: format!("s_{surah}_{ayah}"),
            surah_id: surah,
            ayah_number: ayah,
            start_tick: 0,
            end_tick: seconds * 48_000,
            word_timings: vec![],
            confidence: 1.0,
            manual_override: false,
            word_range: None,
            ..Default::default()
        }
    }

    #[test]
    fn export_spec_requires_segments_and_an_existing_audio_file() {
        use crate::audio_api::{audio_import_impl, MediaTools};
        use crate::project_io::test_support::{make_sine_wav, register_project};
        let tmp = TempDir::new("exp_spec");
        let db = Mutex::new(qr_store::AppDb::open_in_memory().unwrap());
        let out = tmp.path().join("hasil.mp4");
        let out_s = out.to_str().unwrap();

        let mut empty = qr_core::project::Project::new("Kosong");
        register_project(&db, tmp.path(), &mut empty);
        let err = export_spec_for(&db, &empty.id, out_s, None, false).unwrap_err();
        assert!(err.contains("segmen"), "{err}");
        assert!(export_spec_for(&db, "tidak-ada", out_s, None, false)
            .unwrap_err()
            .contains("tidak ditemukan"));

        // Tanpa audio: diizinkan (video senyap), audio_path None.
        let mut p = qr_core::project::Project::new("Berisi");
        p.segments.push(segment(1, 2, 2));
        let dir = register_project(&db, tmp.path(), &mut p);
        let spec = export_spec_for(&db, &p.id, out_s, Some(270), true).unwrap();
        assert_eq!(spec.project_dir, dir);
        assert_eq!(
            (spec.audio_path.clone(), spec.width, spec.overwrite),
            (None, Some(270), true)
        );

        // Dengan audio terimpor: jalurnya diteruskan; audio hilang → galat jelas.
        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, 2.0, 440);
        audio_import_impl(&db, &p.id, &wav, &MediaTools::discover()).unwrap();
        let spec = export_spec_for(&db, &p.id, out_s, None, false).unwrap();
        assert_eq!(
            spec.audio_path
                .as_deref()
                .map(|p| p.file_name().unwrap().to_owned()),
            Some(std::ffi::OsString::from("qari.wav"))
        );
        std::fs::remove_file(&wav).unwrap();
        let err = export_spec_for(&db, &p.id, out_s, None, false).unwrap_err();
        assert!(err.contains("audio proyek tidak ditemukan"), "{err}");
    }

    // ---- Worker `qurender` asli + dataset bertanda tangan ----

    /// Membangun `qurender` lewat cargo (profil yang sama dengan biner uji) dan mengembalikan lokasinya.
    fn build_real_worker() -> PathBuf {
        let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
        let mut cmd = std::process::Command::new(cargo);
        cmd.args(["build", "-p", "qr-cli", "--bin", "qurender"]);
        if !cfg!(debug_assertions) {
            cmd.arg("--release");
        }
        let st = cmd
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .status()
            .unwrap();
        assert!(st.success(), "cargo build -p qr-cli gagal");
        let exe = std::env::current_exe().unwrap();
        let profile_dir = exe.parent().unwrap().parent().unwrap();
        let bin = profile_dir.join(format!("qurender{}", std::env::consts::EXE_SUFFIX));
        assert!(
            bin.is_file(),
            "qurender tidak ditemukan di {}",
            bin.display()
        );
        bin
    }

    fn ffprobe_json(path: &Path) -> serde_json::Value {
        let o = std::process::Command::new(crate::tools::media_tool("ffprobe"))
            .args([
                "-v",
                "error",
                "-count_frames",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
            ])
            .arg(path)
            .output()
            .unwrap();
        assert!(
            o.status.success(),
            "ffprobe gagal: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        serde_json::from_slice(&o.stdout).unwrap()
    }

    struct RealFixture {
        _tmp: TempDir,
        db: Mutex<qr_store::AppDb>,
        project_id: String,
        out_dir: PathBuf,
    }

    fn real_fixture(seconds: i64) -> RealFixture {
        use crate::audio_api::{audio_import_impl, MediaTools};
        use crate::project_io::test_support::{make_sine_wav, register_project};
        let tmp = TempDir::new("exp_real");
        let db = Mutex::new(qr_store::AppDb::open_in_memory().unwrap());
        let mut p = qr_core::project::Project::new("Ekspor Nyata");
        p.segments.push(segment(1, 2, seconds));
        register_project(&db, tmp.path(), &mut p);
        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, seconds as f64, 440);
        audio_import_impl(&db, &p.id, &wav, &MediaTools::discover()).unwrap();
        let out_dir = tmp.path().join("Keluaran");
        RealFixture {
            project_id: p.id,
            _tmp: tmp,
            db,
            out_dir,
        }
    }

    #[test]
    #[ignore = "butuh build/dataset bertanda tangan + biner qurender (dibangun lewat cargo build -p qr-cli); jalankan: cargo test -p quranrender -- --ignored"]
    fn real_worker_exports_a_valid_mp4_with_progress_then_finished_events() {
        let fx = real_fixture(2);
        let worker = build_real_worker();
        let (svc, sink) = service_with(move || Ok(worker_setup_for(worker.clone())));
        let out = fx.out_dir.join("nyata.mp4");
        let spec = export_spec_for(
            &fx.db,
            &fx.project_id,
            out.to_str().unwrap(),
            Some(270),
            false,
        )
        .unwrap();
        let id = svc.start_export(&spec).unwrap();

        let fin = sink
            .wait_finished(&id, Duration::from_secs(180))
            .expect("event export-finished");
        assert!(fin.ok, "{fin:?}");
        assert_eq!(fin.output_path.as_deref(), Some(out.to_str().unwrap()));
        let progress = sink.progress.lock().unwrap().clone();
        assert!(
            !progress.is_empty() && progress.iter().all(|p| p.job_id == id),
            "{progress:?}"
        );
        assert_eq!(progress.last().unwrap().fraction, 1.0);

        let probe = ffprobe_json(&out);
        let streams = probe["streams"].as_array().unwrap();
        let video = streams
            .iter()
            .find(|s| s["codec_type"] == "video")
            .expect("stream video");
        let audio = streams
            .iter()
            .find(|s| s["codec_type"] == "audio")
            .expect("stream audio");
        assert_eq!(video["codec_name"], "h264");
        assert_eq!(
            (video["width"].as_u64(), video["height"].as_u64()),
            (Some(270), Some(480))
        );
        assert_eq!(video["nb_read_frames"], "60", "2 dtk × 30 fps");
        assert_eq!(audio["codec_name"], "aac");
        let dur: f64 = probe["format"]["duration"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!((dur - 2.0).abs() < 0.2, "durasi {dur}");
        assert_eq!(svc.status(&id).unwrap().state, "succeeded");

        // Ekspor kedua tanpa overwrite ditolak sebelum menyentuh antrean; dengan overwrite berhasil.
        assert!(export_spec_for(
            &fx.db,
            &fx.project_id,
            out.to_str().unwrap(),
            Some(270),
            false
        )
        .and_then(|s| svc.start_export(&s))
        .unwrap_err()
        .contains("sudah ada"));
    }

    #[test]
    #[ignore = "butuh build/dataset bertanda tangan + biner qurender (dibangun lewat cargo build -p qr-cli); jalankan: cargo test -p quranrender -- --ignored"]
    fn real_worker_cancel_mid_export_leaves_no_file_and_failed_export_reports_the_code() {
        let fx = real_fixture(60);
        let worker = build_real_worker();
        let (svc, sink) = service_with(move || Ok(worker_setup_for(worker.clone())));
        let out = fx.out_dir.join("batal.mp4");
        let spec = export_spec_for(
            &fx.db,
            &fx.project_id,
            out.to_str().unwrap(),
            Some(540),
            false,
        )
        .unwrap();
        let id = svc.start_export(&spec).unwrap();
        assert!(
            sink.wait_progress(&id, Duration::from_secs(120)),
            "progres pertama harus datang"
        );
        assert!(out.exists(), "ffmpeg sudah menulis keluaran parsial");

        svc.cancel(&id).unwrap();
        let fin = sink
            .wait_finished(&id, Duration::from_secs(60))
            .expect("event export-finished");
        assert!(!fin.ok);
        assert_eq!(fin.error_code.as_deref(), Some("CANCELED"));
        let end = std::time::Instant::now() + Duration::from_secs(30);
        while out.exists() && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(!out.exists(), "pembatalan tidak boleh meninggalkan berkas");
        assert_eq!(svc.status(&id).unwrap().state, "canceled");

        // Kegagalan nyata dari worker (audio hilang setelah diantre) membawa kode galat aslinya.
        let spec2 = RenderJobSpec {
            output_path: fx.out_dir.join("gagal.mp4"),
            audio_path: Some(fx.out_dir.join("tidak-ada.wav")),
            ..spec
        };
        let id2 = svc.start_export(&spec2).unwrap();
        let fin2 = sink
            .wait_finished(&id2, Duration::from_secs(60))
            .expect("event export-finished");
        assert!(!fin2.ok);
        assert_eq!(
            fin2.error_code.as_deref(),
            Some("AUDIO_MISSING"),
            "{fin2:?}"
        );
        assert!(!fx.out_dir.join("gagal.mp4").exists());
    }

    #[test]
    #[ignore = "butuh bundel .app: `pnpm dmg` (atau `pnpm --filter @quranrender/desktop tauri build --bundles app`)"]
    fn bundled_app_runs_itself_as_the_worker_and_exports_with_bundled_resources() {
        let contents = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/release/bundle/macos/Quran Render.app/Contents");
        let app_exe = contents.join("MacOS/quranrender");
        assert!(
            app_exe.is_file(),
            "bundel belum dibangun: {}",
            app_exe.display()
        );
        let macos_dir: Vec<_> = std::fs::read_dir(contents.join("MacOS"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(macos_dir, ["quranrender"], "bundel hanya berisi satu biner");

        // Urutan resolusi produksi tanpa env: executable aplikasi itu sendiri, dijalankan `<app> worker`.
        let worker = crate::tools::resolve_worker_with(None, Some(&app_exe)).unwrap();
        assert_eq!(worker, app_exe);

        // Lingkungan mirip aplikasi yang dibuka dari Finder: PATH minimal, sumber daya dari bundel.
        let resources = contents.join("Resources");
        let setup = WorkerSetup {
            spec: WorkerSpec::qurender(&worker)
                .with_env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
                .with_env("QR_RESOURCES_DIR", resources.to_string_lossy().to_string())
                .with_env(
                    "QR_DATASET_DIR",
                    resources
                        .join("build/dataset")
                        .to_string_lossy()
                        .to_string(),
                ),
            resources_dir: Some(resources),
            ffmpeg_bin: Some(crate::tools::media_tool("ffmpeg")),
        };
        let fx = real_fixture(2);
        let (svc, sink) = service_with(move || Ok(setup.clone()));
        let out = fx.out_dir.join("bundel.mp4");
        let spec = export_spec_for(
            &fx.db,
            &fx.project_id,
            out.to_str().unwrap(),
            Some(270),
            false,
        )
        .unwrap();
        let id = svc.start_export(&spec).unwrap();
        let fin = sink
            .wait_finished(&id, Duration::from_secs(180))
            .expect("event export-finished");
        assert!(fin.ok, "{fin:?}");
        let probe = ffprobe_json(&out);
        let video = probe["streams"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["codec_type"] == "video")
            .unwrap()
            .clone();
        assert_eq!(video["codec_name"], "h264");
        assert_eq!(video["nb_read_frames"], "60");
    }
}
