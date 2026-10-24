//! Aligner akustik cloud: HF Space publik `hetchyy/quranic-universal-aligner` (MIT), sama dengan yang dipakai
//! Quran Caption. Space mengenali ayat secara otomatis (tanpa rentang), memberi timing per kata, dan menandai
//! segmen khusus (basmalah, isti'adzah).
//!
//! Protokol Gradio: unggah berkas (`/gradio_api/upload`), panggil `/gradio_api/call/process_audio_session`
//! (mengembalikan `event_id`), lalu baca SSE `/gradio_api/call/process_audio_session/{event_id}` sampai
//! `event: complete` atau `event: error`. Penomoran kata aligner mengikuti Digital Khatt v2; pemetaan ke kata
//! dataset ada di [`map_alignment`] (1:1, kecuali 138 ayat di tabel `cloud_aligner_word_map`).

use std::collections::{BTreeSet, HashMap};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::rc::Rc;
use std::time::{Duration, Instant};

use qr_core::project::{AyahSegment, SegmentKind, SegmentSource, WordTiming};
use serde::{Deserialize, Serialize};
use specta::Type;
use thiserror::Error;

use crate::allowlist::NetworkPolicy;
use crate::cloud_aligner_word_map::{WordGroup, WORD_MAP};

/// Alamat HF Space aligner.
pub const SPACE_URL: &str = "https://hetchyy-quranic-universal-aligner.hf.space";
const API_NAME: &str = "process_audio_session";
/// Tick proyek per detik (qr-core).
const TICKS_PER_SECOND: f64 = 48_000.0;
/// Batas tunggu total hasil (surah panjang bisa beberapa menit, ditambah antrean GPU bersama).
const MAX_WAIT: Duration = Duration::from_secs(60 * 60);
/// Batas diam per baca: server mengirim `heartbeat` berkala selama memproses.
const READ_TIMEOUT: Duration = Duration::from_secs(180);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Batas kirim berkas (FLAC mono 16 kHz ≈ 1 MB per menit audio).
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Model pengenal di Space.
#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CloudModel {
    #[default]
    Base,
    Large,
}

impl CloudModel {
    fn as_api(self) -> &'static str {
        match self {
            CloudModel::Base => "Base",
            CloudModel::Large => "Large",
        }
    }
}

/// Opsi sinkron cloud (nilai bawaan sama dengan Quran Caption).
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct CloudAlignOptions {
    pub model: CloudModel,
    /// Jeda minimum (ms) yang memisahkan segmen.
    pub min_silence_ms: u32,
    /// Durasi suara minimum (ms) sebuah segmen.
    pub min_speech_ms: u32,
    /// Bantalan (ms) di kedua sisi segmen.
    pub pad_ms: u32,
    /// Perpanjang akhir setiap segmen sampai awal segmen berikutnya (subtitle tetap tampil saat jeda).
    pub fill_silence: bool,
}

impl Default for CloudAlignOptions {
    fn default() -> Self {
        Self {
            model: CloudModel::Base,
            min_silence_ms: 200,
            min_speech_ms: 1000,
            pad_ms: 100,
            fill_silence: true,
        }
    }
}

/// Rentang ayat berurutan yang dikenali dalam satu surah.
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct DetectedRange {
    pub surah: u32,
    pub from_ayah: u32,
    pub to_ayah: u32,
}

/// Hasil sinkron cloud; belum disimpan ke proyek.
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq)]
pub struct CloudAlignOutcome {
    pub segments: Vec<AyahSegment>,
    pub detected: Vec<DetectedRange>,
    pub warnings: Vec<String>,
}

/// Tahap proses untuk event `align-progress`.
#[derive(Serialize, Deserialize, Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AlignStage {
    Preparing,
    Uploading,
    Queued,
    Processing,
    Mapping,
    Done,
}

/// Payload event Tauri `align-progress`.
#[derive(Serialize, Deserialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct AlignProgressEvent {
    pub stage: AlignStage,
    pub message: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CloudError {
    /// Tidak ada koneksi ke server (DNS, sambungan ditolak, TLS gagal tersambung).
    #[error("Tidak dapat terhubung ke layanan penyelaras online. Periksa koneksi internet lalu coba lagi.")]
    Offline,
    #[error(
        "Layanan penyelaras tidak menanggapi dalam batas waktu. Coba lagi beberapa saat lagi."
    )]
    Timeout,
    #[error("{0}")]
    Server(String),
    #[error("Jawaban layanan penyelaras tidak dapat dibaca: {0}")]
    Protocol(String),
    #[error("Gagal membaca berkas audio sementara: {0}")]
    Io(String),
    #[error("{0}")]
    Blocked(String),
}

// ---------------------------------------------------------------------------------------------------------
// Bentuk jawaban Space (lihat tests/fixtures/cloud_aligner). Field yang tidak dikenal diabaikan.

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct AlignerResult {
    #[serde(default)]
    pub audio_id: Option<String>,
    #[serde(default)]
    pub segments: Vec<AlignerSegment>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct AlignerSegment {
    #[serde(default)]
    pub segment: u32,
    /// Detik, absolut terhadap awal audio.
    pub time_from: f64,
    pub time_to: f64,
    /// "s:a:w"; kosong untuk segmen khusus.
    #[serde(default)]
    pub ref_from: String,
    #[serde(default)]
    pub ref_to: String,
    #[serde(default)]
    pub matched_text: String,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub has_missing_words: bool,
    #[serde(default)]
    pub has_repeated_words: bool,
    /// "quran" | "special".
    #[serde(default)]
    pub kind: String,
    /// "Basmala" | "Isti'adha" untuk segmen khusus.
    #[serde(default)]
    pub special_type: Option<String>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
    #[serde(default)]
    pub words: Vec<AlignerWord>,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct AlignerWord {
    /// "s:a:w" (Digital Khatt v2, 1-based); segmen khusus "0:0:n".
    pub location: String,
    /// Detik, relatif terhadap `time_from` segmen.
    pub start: f64,
    pub end: f64,
}

/// Mengurai `data` dari event `complete` (larik keluaran Gradio dengan satu elemen hasil).
pub fn parse_complete_data(data: &str) -> Result<AlignerResult, CloudError> {
    let value: serde_json::Value =
        serde_json::from_str(data).map_err(|e| CloudError::Protocol(e.to_string()))?;
    let result = match value {
        serde_json::Value::Array(mut items) if !items.is_empty() => items.swap_remove(0),
        other @ serde_json::Value::Object(_) => other,
        _ => {
            return Err(CloudError::Protocol(
                "hasil kosong atau bukan objek".to_string(),
            ))
        }
    };
    let parsed: AlignerResult =
        serde_json::from_value(result).map_err(|e| CloudError::Protocol(e.to_string()))?;
    if let Some(err) = parsed.error.as_ref().and_then(error_text) {
        if parsed.segments.is_empty() {
            return Err(CloudError::Server(format!(
                "Layanan penyelaras gagal memproses audio: {err}"
            )));
        }
    }
    Ok(parsed)
}

fn error_text(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) if s.trim().is_empty() => None,
        serde_json::Value::String(s) => Some(s.trim().to_string()),
        other => Some(other.to_string()),
    }
}

// ---------------------------------------------------------------------------------------------------------
// Klien Gradio

/// Klien HTTP blocking untuk Space aligner.
pub struct CloudAlignerClient {
    agent: ureq::Agent,
    base: String,
}

impl std::fmt::Debug for CloudAlignerClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudAlignerClient")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

fn map_ureq_error(e: ureq::Error) -> CloudError {
    match e {
        ureq::Error::Timeout(ureq::Timeout::Connect | ureq::Timeout::Resolve)
        | ureq::Error::HostNotFound
        | ureq::Error::ConnectionFailed => CloudError::Offline,
        ureq::Error::Timeout(_) => CloudError::Timeout,
        ureq::Error::Io(io) => match io.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => CloudError::Timeout,
            std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::NetworkUnreachable
            | std::io::ErrorKind::HostUnreachable
            | std::io::ErrorKind::BrokenPipe => CloudError::Offline,
            _ => CloudError::Server(format!("Koneksi ke layanan penyelaras terputus: {io}")),
        },
        other => CloudError::Server(format!("Koneksi ke layanan penyelaras gagal: {other}")),
    }
}

/// Pesan awam untuk status HTTP gagal.
fn status_error(status: u16, body: &str) -> CloudError {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .or_else(|| v.get("detail"))
                .and_then(error_text)
        })
        .unwrap_or_default();
    let base = match status {
        404 => "Layanan penyelaras tidak ditemukan (Space mungkin dipindahkan atau dimatikan)".to_string(),
        413 => "Berkas audio terlalu besar untuk layanan penyelaras".to_string(),
        429 => "Layanan penyelaras sedang membatasi permintaan (kuota habis). Coba lagi nanti".to_string(),
        502..=504 => {
            "Layanan penyelaras sedang tidak tersedia atau baru dinyalakan. Tunggu 1–2 menit lalu coba lagi"
                .to_string()
        }
        _ => format!("Layanan penyelaras menolak permintaan (HTTP {status})"),
    };
    if detail.is_empty() {
        CloudError::Server(format!("{base}."))
    } else {
        CloudError::Server(format!("{base}: {detail}"))
    }
}

/// Isi multipart `files` berisi satu berkas.
fn multipart_body(boundary: &str, file_name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(bytes.len() + 256);
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"files\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Satu event SSE.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// Pembaca SSE sederhana (baris `event:` / `data:`, dipisah baris kosong).
#[derive(Debug)]
pub struct SseReader<R: BufRead> {
    inner: R,
}

impl<R: BufRead> SseReader<R> {
    pub fn new(inner: R) -> Self {
        Self { inner }
    }

    /// Event berikutnya; `None` bila aliran berakhir.
    pub fn next_event(&mut self) -> std::io::Result<Option<SseEvent>> {
        let mut event = String::new();
        let mut data: Vec<String> = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            if self.inner.read_line(&mut line)? == 0 {
                if event.is_empty() && data.is_empty() {
                    return Ok(None);
                }
                break;
            }
            let l = line.trim_end_matches(['\r', '\n']);
            if l.is_empty() {
                if event.is_empty() && data.is_empty() {
                    continue;
                }
                break;
            }
            if let Some(v) = l.strip_prefix("event:") {
                event = v.trim().to_string();
            } else if let Some(v) = l.strip_prefix("data:") {
                data.push(v.strip_prefix(' ').unwrap_or(v).to_string());
            }
        }
        Ok(Some(SseEvent {
            event,
            data: data.join("\n"),
        }))
    }
}

fn minutes_seconds(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 60 {
        format!("{} mnt {} dtk", s / 60, s % 60)
    } else {
        format!("{s} dtk")
    }
}

impl CloudAlignerClient {
    /// Klien ke [`SPACE_URL`].
    pub fn new() -> Result<Self, CloudError> {
        Self::with_base_url(SPACE_URL)
    }

    /// Klien ke alamat lain (harus lolos allowlist jaringan).
    pub fn with_base_url(base: &str) -> Result<Self, CloudError> {
        NetworkPolicy::new()
            .validate_outbound_url(base)
            .map_err(CloudError::Blocked)?;
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_per_read(Some(READ_TIMEOUT))
            .timeout_send_body(Some(UPLOAD_TIMEOUT))
            .user_agent(concat!("QuranRender/", env!("CARGO_PKG_VERSION")))
            .build();
        Ok(Self {
            agent: ureq::Agent::new_with_config(config),
            base: base.trim_end_matches('/').to_string(),
        })
    }

    fn read_body(resp: ureq::http::Response<ureq::Body>) -> Result<(u16, String), CloudError> {
        let status = resp.status().as_u16();
        let body = resp
            .into_body()
            .with_config()
            .limit(64 * 1024 * 1024)
            .lossy_utf8(true)
            .read_to_string()
            .map_err(map_ureq_error)?;
        Ok((status, body))
    }

    /// Mengunggah `audio`; mengembalikan jalur berkas di server.
    pub fn upload(&self, audio: &Path) -> Result<String, CloudError> {
        let bytes = std::fs::read(audio).map_err(|e| CloudError::Io(e.to_string()))?;
        let file_name = audio
            .file_name()
            .map_or_else(
                || "audio.flac".to_string(),
                |n| n.to_string_lossy().to_string(),
            )
            .replace('"', "");
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let boundary = format!("----QuranRenderBoundary{nonce:x}{:x}", bytes.len());
        let resp = self
            .agent
            .post(&format!("{}/gradio_api/upload", self.base))
            .content_type(format!("multipart/form-data; boundary={boundary}"))
            .send(multipart_body(&boundary, &file_name, &bytes))
            .map_err(map_ureq_error)?;
        let (status, body) = Self::read_body(resp)?;
        if !(200..300).contains(&status) {
            return Err(status_error(status, &body));
        }
        let paths: Vec<String> = serde_json::from_str(&body)
            .map_err(|e| CloudError::Protocol(format!("unggahan: {e}")))?;
        paths
            .into_iter()
            .next()
            .ok_or_else(|| CloudError::Protocol("unggahan tidak mengembalikan jalur".to_string()))
    }

    /// Memulai pemrosesan; mengembalikan `event_id`.
    pub fn start(&self, server_path: &str, opts: &CloudAlignOptions) -> Result<String, CloudError> {
        let body = serde_json::json!({
            "data": [
                {"path": server_path, "meta": {"_type": "gradio.FileData"}},
                opts.min_silence_ms,
                opts.min_speech_ms,
                opts.pad_ms,
                opts.model.as_api(),
                "GPU"
            ]
        });
        let resp = self
            .agent
            .post(&format!("{}/gradio_api/call/{API_NAME}", self.base))
            .send_json(&body)
            .map_err(map_ureq_error)?;
        let (status, body) = Self::read_body(resp)?;
        if !(200..300).contains(&status) {
            return Err(status_error(status, &body));
        }
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| CloudError::Protocol(format!("panggilan: {e}")))?;
        v.get("event_id")
            .and_then(|e| e.as_str())
            .map(str::to_string)
            .ok_or_else(|| {
                CloudError::Protocol("panggilan tidak mengembalikan event_id".to_string())
            })
    }

    /// Membaca SSE hasil sampai `complete`/`error`.
    pub fn wait_result(
        &self,
        event_id: &str,
        progress: &mut dyn FnMut(AlignStage, String),
    ) -> Result<AlignerResult, CloudError> {
        let resp = self
            .agent
            .get(&format!(
                "{}/gradio_api/call/{API_NAME}/{event_id}",
                self.base
            ))
            .header("Accept", "text/event-stream")
            .call()
            .map_err(map_ureq_error)?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let (_, body) = Self::read_body(resp)?;
            return Err(status_error(status, &body));
        }
        let started = Instant::now();
        let mut reader = SseReader::new(BufReader::new(resp.into_body().into_reader()));
        loop {
            if started.elapsed() > MAX_WAIT {
                return Err(CloudError::Timeout);
            }
            let ev = reader.next_event().map_err(|e| match e.kind() {
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
                    CloudError::Timeout
                }
                _ => CloudError::Server(format!(
                    "Koneksi ke layanan penyelaras terputus saat menunggu hasil: {e}"
                )),
            })?;
            let Some(ev) = ev else {
                return Err(CloudError::Server(
                    "Koneksi ke layanan penyelaras berakhir sebelum hasil tersedia. Coba lagi."
                        .to_string(),
                ));
            };
            match ev.event.as_str() {
                "complete" => return parse_complete_data(&ev.data),
                "error" => {
                    let msg = serde_json::from_str::<serde_json::Value>(&ev.data)
                        .ok()
                        .and_then(|v| error_text(&v))
                        .or_else(|| {
                            let t = ev.data.trim();
                            (!t.is_empty() && t != "null").then(|| t.to_string())
                        });
                    return Err(CloudError::Server(match msg {
                        Some(m) => format!("Layanan penyelaras gagal memproses audio: {m}"),
                        None => "Layanan penyelaras gagal memproses audio (tanpa keterangan; kuota GPU bersama mungkin habis). Coba lagi nanti atau pakai sinkron lokal.".to_string(),
                    }));
                }
                _ => progress(
                    AlignStage::Processing,
                    format!(
                        "Server sedang memproses audio… {}",
                        minutes_seconds(started.elapsed())
                    ),
                ),
            }
        }
    }

    /// Unggah → proses → hasil mentah. `audio` sebaiknya sudah ringkas (mono 16 kHz).
    pub fn align_file(
        &self,
        audio: &Path,
        opts: &CloudAlignOptions,
        progress: &mut dyn FnMut(AlignStage, String),
    ) -> Result<AlignerResult, CloudError> {
        let size = std::fs::metadata(audio)
            .map_err(|e| CloudError::Io(e.to_string()))?
            .len();
        progress(
            AlignStage::Uploading,
            format!("Mengunggah audio ({:.1} MB)…", size as f64 / 1_048_576.0),
        );
        let server_path = self.upload(audio)?;
        progress(
            AlignStage::Queued,
            "Menunggu giliran di server penyelaras…".to_string(),
        );
        let event_id = self.start(&server_path, opts)?;
        self.wait_result(&event_id, progress)
    }
}

// ---------------------------------------------------------------------------------------------------------
// Pemetaan kata aligner → kata dataset

/// Pemetaan kata satu ayat.
#[derive(Debug, Clone, Copy)]
struct AyahWordMap {
    dataset_count: u32,
    /// Kelompok non-1:1 (kata_aligner_pertama, jumlah, kata_dataset_pertama, jumlah), 1-based.
    groups: &'static [WordGroup],
}

impl AyahWordMap {
    fn new(surah: u32, ayah: u32, dataset_count: u32, warnings: &mut Vec<String>) -> Self {
        let key = (surah, ayah);
        let entry = WORD_MAP
            .binary_search_by(|e| (u32::from(e.0), u32::from(e.1)).cmp(&key))
            .ok()
            .map(|i| WORD_MAP[i]);
        match entry {
            Some((_, _, _, expected, groups)) if u32::from(expected) == dataset_count => Self {
                dataset_count,
                groups,
            },
            Some((_, _, _, expected, _)) => {
                warnings.push(format!(
                    "Ayat {surah}:{ayah}: tabel pemetaan kata mengharapkan {expected} kata, dataset memuat {dataset_count}; posisi kata mungkin bergeser."
                ));
                Self {
                    dataset_count,
                    groups: &[],
                }
            }
            None => Self {
                dataset_count,
                groups: &[],
            },
        }
    }

    /// Jumlah kata aligner (tanpa penanda ayat).
    fn aligner_count(&self) -> u32 {
        let delta: i64 = self
            .groups
            .iter()
            .map(|g| i64::from(g.1) - i64::from(g.3))
            .sum();
        u32::try_from(i64::from(self.dataset_count) + delta).unwrap_or(0)
    }

    /// Rentang kata dataset (1-based, inklusif) milik kata aligner `w`. `None`: kata aligner ini berbagi kata
    /// dataset dengan kata aligner sesudahnya (kata dataset dimiliki kata aligner terakhir dalam kelompok).
    fn span(&self, w: u32) -> Option<(u32, u32)> {
        let mut offset: i64 = 0;
        for &(a, ac, d, dc) in self.groups {
            let (a, ac, d, dc) = (u32::from(a), u32::from(ac), u32::from(d), u32::from(dc));
            if w < a {
                break;
            }
            if w < a + ac {
                let k = w - a;
                let lo = d + k * dc / ac;
                let hi = (d + (k + 1) * dc / ac).checked_sub(1)?;
                return (hi >= lo).then_some((lo, hi));
            }
            offset += i64::from(dc) - i64::from(ac);
        }
        let d = u32::try_from(i64::from(w) + offset).ok()?;
        (1..=self.dataset_count).contains(&d).then_some((d, d))
    }

    /// Rentang kata dataset seluruh kelompok yang memuat `w` (cadangan bila bagian segmen kosong).
    fn group_span(&self, w: u32) -> Option<(u32, u32)> {
        for &(a, ac, d, dc) in self.groups {
            let (a, ac, d, dc) = (u32::from(a), u32::from(ac), u32::from(d), u32::from(dc));
            if (a..a + ac).contains(&w) {
                return Some((d, d + dc - 1));
            }
        }
        self.span(w)
    }
}

fn parse_location(s: &str) -> Option<(u32, u32, u32)> {
    let mut it = s.trim().split(':').map(|p| p.trim().parse::<u32>().ok());
    let r = (it.next()??, it.next()??, it.next()??);
    it.next().is_none().then_some(r)
}

fn ticks(sec: f64) -> i64 {
    (sec.max(0.0) * TICKS_PER_SECOND).round() as i64
}

/// Kata aligner dengan waktu absolut (tick).
#[derive(Debug, Clone, Copy)]
struct TimedWord {
    w: u32,
    start: i64,
    end: i64,
}

/// Bagian satu segmen aligner yang jatuh di satu ayat.
#[derive(Debug, Clone)]
struct Part {
    surah: u32,
    ayah: u32,
    /// Rentang kata aligner (1-based, inklusif).
    a_from: u32,
    a_to: u32,
    start: i64,
    end: i64,
    words: Vec<TimedWord>,
    confidence: f32,
    has_missing_words: bool,
}

/// Kata dataset per ayat (teks per kata, urut). `None` bila ayat tidak ada di dataset.
pub type DatasetWords<'a> = dyn Fn(u32, u32) -> Option<Vec<String>> + 'a;

/// Pemetaan + teks kata dataset satu ayat; `None` bila ayat tidak ada di dataset.
type CachedAyah = Option<(AyahWordMap, Rc<[String]>)>;

struct Mapper<'a> {
    words: &'a DatasetWords<'a>,
    cache: HashMap<(u32, u32), CachedAyah>,
    warnings: Vec<String>,
}

impl Mapper<'_> {
    fn ayah(&mut self, s: u32, a: u32) -> CachedAyah {
        if let Some(v) = self.cache.get(&(s, a)) {
            return v.clone();
        }
        let v = (self.words)(s, a).filter(|w| !w.is_empty()).map(|texts| {
            let count = u32::try_from(texts.len()).unwrap_or(u32::MAX);
            (
                AyahWordMap::new(s, a, count, &mut self.warnings),
                Rc::from(texts),
            )
        });
        if v.is_none() {
            self.warnings.push(format!(
                "Ayat {s}:{a} dari penyelaras tidak ada di dataset; segmennya dilewati."
            ));
        }
        self.cache.insert((s, a), v.clone());
        v
    }
}

/// Memecah segmen Qur'an aligner menjadi bagian per ayat.
fn quran_parts(seg: &AlignerSegment, mapper: &mut Mapper<'_>) -> Vec<Part> {
    let seg_start = ticks(seg.time_from);
    let seg_end = ticks(seg.time_to).max(seg_start);
    let confidence = seg.confidence.clamp(0.0, 1.0) as f32;
    let missing = seg.has_missing_words || seg.has_repeated_words;
    let mut parts: Vec<Part> = Vec::new();
    let new_part = |s, a, w| Part {
        surah: s,
        ayah: a,
        a_from: w,
        a_to: w,
        start: seg_start,
        end: seg_end,
        words: Vec::new(),
        confidence,
        has_missing_words: missing,
    };

    if seg.words.is_empty() {
        // Tanpa timing kata: rentang dari ref_from/ref_to, waktu dibagi menurut jumlah kata.
        let (Some((s1, a1, w1)), Some((s2, a2, w2))) =
            (parse_location(&seg.ref_from), parse_location(&seg.ref_to))
        else {
            return parts;
        };
        if s1 != s2 || a2 < a1 {
            return parts;
        }
        for a in a1..=a2 {
            let Some((map, _)) = mapper.ayah(s1, a) else {
                continue;
            };
            let from = if a == a1 { w1 } else { 1 };
            let to = if a == a2 { w2 } else { map.aligner_count() };
            let mut p = new_part(s1, a, from);
            p.a_to = to.max(from);
            parts.push(p);
        }
        let total: i64 = parts
            .iter()
            .map(|p| i64::from(p.a_to - p.a_from + 1))
            .sum::<i64>()
            .max(1);
        let mut acc = 0i64;
        let n = parts.len();
        for (i, p) in parts.iter_mut().enumerate() {
            p.start = seg_start + (seg_end - seg_start) * acc / total;
            acc += i64::from(p.a_to - p.a_from + 1);
            p.end = if i + 1 == n {
                seg_end
            } else {
                seg_start + (seg_end - seg_start) * acc / total
            };
        }
        return parts;
    }

    for w in &seg.words {
        let Some((s, a, idx)) = parse_location(&w.location) else {
            continue;
        };
        let start = (seg_start + ticks(w.start)).clamp(seg_start, seg_end);
        let end = (seg_start + ticks(w.end)).clamp(start, seg_end);
        let tw = TimedWord { w: idx, start, end };
        match parts.last_mut() {
            Some(p) if p.surah == s && p.ayah == a => {
                p.a_from = p.a_from.min(idx);
                p.a_to = p.a_to.max(idx);
                p.words.push(tw);
            }
            _ => {
                let mut p = new_part(s, a, idx);
                p.words.push(tw);
                parts.push(p);
            }
        }
    }
    // Batas waktu antarbagian = awal kata pertama bagian berikutnya.
    let n = parts.len();
    for i in 0..n {
        if i > 0 {
            parts[i].start = parts[i].words.first().map_or(seg_start, |w| w.start);
        }
        if i + 1 < n {
            parts[i].end = parts[i + 1].words.first().map_or(seg_end, |w| w.start);
        }
    }
    parts
}

/// Bagian dengan rentang kata dataset, siap dijadikan segmen.
struct Mapped {
    part: Part,
    range: Option<(u32, u32)>,
}

fn dataset_range(map: &AyahWordMap, a_from: u32, a_to: u32) -> Option<(u32, u32)> {
    let mut lo = u32::MAX;
    let mut hi = 0;
    for w in a_from..=a_to {
        if let Some((l, h)) = map.span(w) {
            lo = lo.min(l);
            hi = hi.max(h);
        }
    }
    (lo <= hi).then_some((lo, hi))
}

/// Timing kata dataset dari timing kata aligner. Kata aligner tanpa kata dataset sendiri (`span` None)
/// menggabungkan waktunya ke kata pemiliknya; satu kata aligner untuk beberapa kata dataset dibagi rata.
fn dataset_timings(
    map: &AyahWordMap,
    texts: &[String],
    words: &[TimedWord],
    range: (u32, u32),
    confidence: f32,
) -> Vec<WordTiming> {
    let mut out: Vec<WordTiming> = Vec::new();
    let mut pending: Option<i64> = None;
    for tw in words {
        match map.span(tw.w) {
            None => pending = Some(pending.map_or(tw.start, |p| p.min(tw.start))),
            Some((lo, hi)) => {
                let lo = lo.max(range.0);
                let hi = hi.min(range.1);
                if lo > hi {
                    continue;
                }
                let start = pending.take().map_or(tw.start, |p| p.min(tw.start));
                let n = i64::from(hi - lo + 1);
                let dur = (tw.end - start).max(0);
                for (k, d) in (lo..=hi).enumerate() {
                    let k = k as i64;
                    out.push(WordTiming {
                        word_idx: d,
                        start_tick: start + dur * k / n,
                        end_tick: start + dur * (k + 1) / n,
                        text: texts.get((d - 1) as usize).cloned().unwrap_or_default(),
                        confidence,
                    });
                }
            }
        }
    }
    if pending.is_some() {
        if let (Some(last), Some(tw)) = (out.last_mut(), words.last()) {
            last.end_tick = last.end_tick.max(tw.end);
        }
    }
    out.sort_by_key(|t| (t.word_idx, t.start_tick));
    out.dedup_by_key(|t| t.word_idx);
    out
}

fn special_segment(seg: &AlignerSegment, kind: SegmentKind) -> AyahSegment {
    let start = ticks(seg.time_from);
    let end = ticks(seg.time_to).max(start);
    let confidence = seg.confidence.clamp(0.0, 1.0) as f32;
    let texts: Vec<&str> = seg.matched_text.split_whitespace().collect();
    let word_timings = seg
        .words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let idx = parse_location(&w.location)
                .map(|l| l.2)
                .filter(|&n| n > 0)
                .unwrap_or(i as u32 + 1);
            let ws = (start + ticks(w.start)).clamp(start, end);
            WordTiming {
                word_idx: idx,
                start_tick: ws,
                end_tick: (start + ticks(w.end)).clamp(ws, end),
                text: texts
                    .get((idx - 1) as usize)
                    .map(|t| t.to_string())
                    .unwrap_or_default(),
                confidence,
            }
        })
        .collect();
    AyahSegment {
        id: match kind {
            SegmentKind::Istiadha => "seg_istiadha".to_string(),
            _ => "seg_basmala".to_string(),
        },
        surah_id: 0,
        ayah_number: 0,
        start_tick: start,
        end_tick: end,
        word_timings,
        confidence,
        manual_override: false,
        word_range: None,
        kind,
        source: SegmentSource::Cloud,
        has_missing_words: seg.has_missing_words || seg.has_repeated_words,
        translations: Default::default(),
    }
}

fn special_kind(t: Option<&str>) -> Option<SegmentKind> {
    let norm: String = t?
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    match norm.as_str() {
        "basmala" | "basmalah" | "bismillah" => Some(SegmentKind::Basmala),
        "istiadha" | "istiadhah" | "istiaza" | "istiadzah" | "taawwudh" => {
            Some(SegmentKind::Istiadha)
        }
        _ => None,
    }
}

fn fmt_sec(t: f64) -> String {
    format!("{t:.1}")
}

/// Rentang ayat berurutan per surah dari segmen ayat yang sudah terurut waktu.
pub fn detected_ranges(segments: &[AyahSegment]) -> Vec<DetectedRange> {
    let mut out: Vec<DetectedRange> = Vec::new();
    for s in segments.iter().filter(|s| s.kind == SegmentKind::Ayah) {
        match out.last_mut() {
            Some(r)
                if r.surah == s.surah_id
                    && (r.from_ayah..=r.to_ayah + 1).contains(&s.ayah_number) =>
            {
                r.to_ayah = r.to_ayah.max(s.ayah_number);
            }
            _ => out.push(DetectedRange {
                surah: s.surah_id,
                from_ayah: s.ayah_number,
                to_ayah: s.ayah_number,
            }),
        }
    }
    out
}

/// Memperpanjang akhir setiap segmen sampai awal segmen berikutnya.
pub fn fill_silence(segments: &mut [AyahSegment]) {
    for i in 1..segments.len() {
        let next_start = segments[i].start_tick;
        let prev = &mut segments[i - 1];
        if next_start > prev.end_tick {
            prev.end_tick = next_start;
        }
    }
}

/// Memetakan hasil aligner ke segmen proyek. `words(s, a)` mengembalikan kata dataset ayat (urut, 1 kata per
/// elemen, sama dengan tokenisasi `words_of_ayah`).
pub fn map_alignment(
    result: &AlignerResult,
    words: &DatasetWords<'_>,
    fill: bool,
) -> CloudAlignOutcome {
    let mut mapper = Mapper {
        words,
        cache: HashMap::new(),
        warnings: Vec::new(),
    };
    let mut ordered: Vec<&AlignerSegment> = result.segments.iter().collect();
    ordered.sort_by(|a, b| a.time_from.total_cmp(&b.time_from));

    // 1. Bagian per ayat dan segmen khusus, dalam urutan waktu.
    enum Item {
        Special(AyahSegment),
        Quran(Part),
    }
    let mut items: Vec<Item> = Vec::new();
    for seg in ordered {
        if let Some(err) = seg.error.as_ref().and_then(error_text) {
            mapper.warnings.push(format!(
                "Bagian {}–{} dtk tidak dikenali penyelaras ({err}); sinkronkan manual.",
                fmt_sec(seg.time_from),
                fmt_sec(seg.time_to)
            ));
            continue;
        }
        if seg.kind == "special" {
            match special_kind(seg.special_type.as_deref()) {
                Some(kind) => items.push(Item::Special(special_segment(seg, kind))),
                None => mapper.warnings.push(format!(
                    "Bagian {}–{} dtk berisi bacaan khusus '{}' yang belum didukung; dilewati.",
                    fmt_sec(seg.time_from),
                    fmt_sec(seg.time_to),
                    seg.special_type.as_deref().unwrap_or("?")
                )),
            }
            continue;
        }
        let parts = quran_parts(seg, &mut mapper);
        if parts.is_empty() {
            mapper.warnings.push(format!(
                "Bagian {}–{} dtk tidak memuat rujukan ayat; dilewati.",
                fmt_sec(seg.time_from),
                fmt_sec(seg.time_to)
            ));
        }
        items.extend(parts.into_iter().map(Item::Quran));
    }

    // 2. Rentang kata dataset; bagian tanpa kata dataset sendiri digabung ke bagian berikut di ayat sama.
    let mut mapped: Vec<Result<AyahSegment, Mapped>> = Vec::new();
    let mut carry: Option<Part> = None;
    for item in items {
        let mut part = match item {
            Item::Special(s) => {
                mapped.push(Ok(s));
                continue;
            }
            Item::Quran(p) => p,
        };
        let Some((map, _)) = mapper.ayah(part.surah, part.ayah) else {
            continue;
        };
        if let Some(c) = carry.take() {
            if c.surah == part.surah && c.ayah == part.ayah {
                part.a_from = part.a_from.min(c.a_from);
                part.start = part.start.min(c.start);
                part.has_missing_words |= c.has_missing_words;
                part.confidence = part.confidence.min(c.confidence);
                let mut w = c.words;
                w.extend(part.words);
                part.words = w;
            } else {
                let range = map_group_fallback(&mut mapper, &c);
                mapped.push(Err(Mapped { part: c, range }));
            }
        }
        match dataset_range(&map, part.a_from, part.a_to) {
            Some(r) => mapped.push(Err(Mapped {
                part,
                range: Some(r),
            })),
            None => carry = Some(part),
        }
    }
    if let Some(c) = carry {
        let range = map_group_fallback(&mut mapper, &c);
        mapped.push(Err(Mapped { part: c, range }));
    }

    // 3. Segmen proyek.
    let mut segments: Vec<AyahSegment> = Vec::new();
    for m in mapped {
        let m = match m {
            Ok(s) => {
                segments.push(s);
                continue;
            }
            Err(m) => m,
        };
        let Some(range) = m.range else {
            continue;
        };
        let Some((map, texts)) = mapper.ayah(m.part.surah, m.part.ayah) else {
            continue;
        };
        let p = &m.part;
        let word_range = (range != (1, map.dataset_count)).then_some(range);
        let end = p.end.max(p.start);
        let mut word_timings = dataset_timings(&map, &texts, &p.words, range, p.confidence);
        for w in &mut word_timings {
            w.start_tick = w.start_tick.clamp(p.start, end);
            w.end_tick = w.end_tick.clamp(w.start_tick, end);
        }
        segments.push(AyahSegment {
            id: match word_range {
                None => format!("seg_{}_{}", p.surah, p.ayah),
                Some((lo, _)) => format!("seg_{}_{}_w{lo}", p.surah, p.ayah),
            },
            surah_id: p.surah,
            ayah_number: p.ayah,
            start_tick: p.start,
            end_tick: end,
            word_timings,
            confidence: p.confidence,
            manual_override: false,
            word_range,
            kind: SegmentKind::Ayah,
            source: SegmentSource::Cloud,
            has_missing_words: p.has_missing_words,
            translations: Default::default(),
        });
    }
    segments.sort_by_key(|s| s.start_tick);

    // ID unik (ayat yang dibaca ulang menghasilkan id sama).
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for s in &mut segments {
        if !seen.insert(s.id.clone()) {
            let mut n = 2;
            while seen.contains(&format!("{}_{n}", s.id)) {
                n += 1;
            }
            s.id = format!("{}_{n}", s.id);
            seen.insert(s.id.clone());
        }
    }
    if fill {
        fill_silence(&mut segments);
    }

    let mut warnings = mapper.warnings;
    let missing = segments.iter().filter(|s| s.has_missing_words).count();
    if missing > 0 {
        warnings.push(format!(
            "{missing} segmen ditandai ada kata terlewat atau berulang; tinjau sebelum ekspor."
        ));
    }
    let low = segments.iter().filter(|s| s.confidence < 0.80).count();
    if low > 0 {
        warnings.push(format!(
            "{low} segmen memiliki keyakinan di bawah 80%; tinjau sebelum ekspor."
        ));
    }
    if segments.is_empty() {
        warnings.push("Penyelaras tidak menemukan bacaan ayat di audio ini.".to_string());
    }
    CloudAlignOutcome {
        detected: detected_ranges(&segments),
        segments,
        warnings,
    }
}

/// Bagian tanpa kata dataset sendiri dan tanpa bagian lanjutan (mis. audio terpotong di tengah kelompok):
/// tampilkan seluruh kata dataset kelompoknya.
fn map_group_fallback(mapper: &mut Mapper<'_>, p: &Part) -> Option<(u32, u32)> {
    let (map, _) = mapper.ayah(p.surah, p.ayah)?;
    let mut lo = u32::MAX;
    let mut hi = 0;
    for w in p.a_from..=p.a_to {
        if let Some((l, h)) = map.group_span(w) {
            lo = lo.min(l);
            hi = hi.max(h);
        }
    }
    (lo <= hi).then_some((lo, hi))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const FIXTURE_JSON: &str =
        include_str!("../tests/fixtures/cloud_aligner/process_audio_session_mulk_0_45s.json");
    const FIXTURE_SSE: &str =
        include_str!("../tests/fixtures/cloud_aligner/process_audio_session_mulk_0_45s.sse");

    /// Kata dataset sintetis: `n` kata per ayat bernama "s:a:i".
    fn counts(table: &[((u32, u32), u32)]) -> impl Fn(u32, u32) -> Option<Vec<String>> + '_ {
        move |s, a| {
            table
                .iter()
                .find(|(k, _)| *k == (s, a))
                .map(|(_, n)| (1..=*n).map(|i| format!("{s}:{a}:{i}")).collect())
        }
    }

    const MULK: &[((u32, u32), u32)] = &[((67, 1), 9), ((67, 2), 11), ((67, 3), 18), ((67, 4), 13)];

    fn fixture() -> AlignerResult {
        let mut r = SseReader::new(Cursor::new(FIXTURE_SSE.as_bytes()));
        let ev = r.next_event().unwrap().unwrap();
        assert_eq!(ev.event, "complete");
        parse_complete_data(&ev.data).unwrap()
    }

    fn t(sec: f64) -> i64 {
        ticks(sec)
    }

    #[test]
    fn sse_fixture_and_json_fixture_parse_identically() {
        let from_sse = fixture();
        let from_json = parse_complete_data(FIXTURE_JSON).unwrap();
        assert_eq!(from_sse, from_json);
        assert_eq!(from_sse.segments.len(), 9);
        assert_eq!(
            from_sse.segments[0].special_type.as_deref(),
            Some("Basmala")
        );
    }

    #[test]
    fn sse_reader_handles_heartbeats_multiline_data_and_crlf() {
        let raw = "event: heartbeat\r\ndata: null\r\n\r\nevent: complete\ndata: [1,\ndata: 2]\n\n";
        let mut r = SseReader::new(Cursor::new(raw.as_bytes()));
        assert_eq!(
            r.next_event().unwrap().unwrap(),
            SseEvent {
                event: "heartbeat".into(),
                data: "null".into()
            }
        );
        assert_eq!(r.next_event().unwrap().unwrap().data, "[1,\n2]");
        assert_eq!(r.next_event().unwrap(), None);
    }

    #[test]
    fn complete_data_tolerates_unknown_fields_and_reports_server_error() {
        let r = parse_complete_data(
            r#"[{"segments":[{"time_from":1,"time_to":2,"kind":"quran","ref_from":"1:1:1","ref_to":"1:1:4","new_field":5,"words":[]}],"extra":{}}]"#,
        )
        .unwrap();
        assert_eq!(r.segments[0].ref_to, "1:1:4");
        let e =
            parse_complete_data(r#"[{"error":"Audio terlalu pendek","segments":[]}]"#).unwrap_err();
        assert!(matches!(e, CloudError::Server(m) if m.contains("Audio terlalu pendek")));
        assert!(matches!(
            parse_complete_data("[]"),
            Err(CloudError::Protocol(_))
        ));
    }

    #[test]
    fn fixture_maps_to_segments() {
        let out = map_alignment(&fixture(), &counts(MULK), false);
        let s = &out.segments;
        assert_eq!(s.len(), 9);

        // Basmalah pembuka.
        assert_eq!(s[0].kind, SegmentKind::Basmala);
        assert_eq!((s[0].surah_id, s[0].ayah_number), (0, 0));
        assert_eq!(s[0].start_tick, t(0.24));
        assert_eq!(s[0].word_timings.len(), 4);
        assert_eq!(s[0].word_timings[0].text, "بِسْمِ");
        assert_eq!(s[0].word_timings[0].start_tick, t(0.24) + t(0.1));
        assert_eq!(s[0].source, SegmentSource::Cloud);

        // 67:1 utuh.
        assert_eq!((s[1].surah_id, s[1].ayah_number), (67, 1));
        assert_eq!(s[1].kind, SegmentKind::Ayah);
        assert_eq!(s[1].word_range, None);
        assert_eq!(s[1].confidence, 1.0);
        assert_eq!(s[1].word_timings.len(), 9);

        // 67:2 dibagi (1,8) dan (9,11) dengan tick kata absolut.
        assert_eq!(s[2].word_range, Some((1, 8)));
        assert_eq!(s[3].word_range, Some((9, 11)));
        assert_eq!(s[2].start_tick, t(10.845));
        assert_eq!(s[2].end_tick, t(18.135));
        let w1 = &s[2].word_timings[0];
        assert_eq!((w1.word_idx, w1.text.as_str()), (1, "67:2:1"));
        assert_eq!(w1.start_tick, t(10.845) + t(0.05));
        assert_eq!(w1.end_tick, t(10.845) + t(0.84));
        let w9 = &s[3].word_timings[0];
        assert_eq!(w9.word_idx, 9);
        assert_eq!(w9.start_tick, t(18.165) + t(0.08));
        assert_eq!(w9.end_tick, t(18.165) + t(0.66));
        assert_eq!(
            s[3].word_timings
                .iter()
                .map(|w| w.word_idx)
                .collect::<Vec<_>>(),
            vec![9, 10, 11]
        );

        // 67:4 sebagian dengan kata terlewat.
        let last = &s[8];
        assert_eq!((last.surah_id, last.ayah_number), (67, 4));
        assert_eq!(last.word_range, Some((5, 6)));
        assert!(last.has_missing_words);
        assert!(!s[7].has_missing_words);

        // Semua segmen: sumber cloud, id unik, timing kata di dalam segmen.
        let ids: BTreeSet<_> = s.iter().map(|x| x.id.clone()).collect();
        assert_eq!(ids.len(), s.len());
        for seg in s {
            assert_eq!(seg.source, SegmentSource::Cloud);
            for w in &seg.word_timings {
                assert!(seg.start_tick <= w.start_tick && w.end_tick <= seg.end_tick);
            }
        }
        assert_eq!(
            out.detected,
            vec![DetectedRange {
                surah: 67,
                from_ayah: 1,
                to_ayah: 4
            }]
        );
        assert!(out.warnings.iter().any(|w| w.contains("kata terlewat")));
    }

    #[test]
    fn fill_silence_extends_each_segment_to_the_next_start() {
        let out = map_alignment(&fixture(), &counts(MULK), true);
        let s = &out.segments;
        for pair in s.windows(2) {
            assert_eq!(pair[0].end_tick, pair[1].start_tick);
        }
        assert_eq!(s[0].end_tick, t(3.42), "basmalah diperpanjang ke awal 67:1");
        assert_eq!(s[8].end_tick, t(45.0), "segmen terakhir tidak berubah");
    }

    /// Seperti [`seg`], tetapi waktu kata diberikan absolut (diubah ke relatif terhadap `from`).
    fn seg_abs(from: f64, to: f64, words: &[(&str, f64, f64)]) -> AlignerSegment {
        let rel: Vec<(&str, f64, f64)> = words
            .iter()
            .map(|(l, s, e)| (*l, s - from, e - from))
            .collect();
        seg(from, to, &rel)
    }

    fn seg(from: f64, to: f64, words: &[(&str, f64, f64)]) -> AlignerSegment {
        AlignerSegment {
            segment: 1,
            time_from: from,
            time_to: to,
            ref_from: words.first().map(|w| w.0.to_string()).unwrap_or_default(),
            ref_to: words.last().map(|w| w.0.to_string()).unwrap_or_default(),
            matched_text: String::new(),
            confidence: 0.9,
            has_missing_words: false,
            has_repeated_words: false,
            kind: "quran".into(),
            special_type: None,
            error: None,
            words: words
                .iter()
                .map(|(l, s, e)| AlignerWord {
                    location: l.to_string(),
                    start: *s,
                    end: *e,
                })
                .collect(),
        }
    }

    #[test]
    fn segment_crossing_ayah_boundary_is_split_per_ayah() {
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![seg(
                10.0,
                16.0,
                &[
                    ("112:1:3", 0.1, 1.0),
                    ("112:1:4", 1.0, 2.0),
                    ("112:2:1", 2.5, 3.5),
                    ("112:2:2", 3.5, 5.5),
                ],
            )],
        };
        let out = map_alignment(&r, &counts(&[((112, 1), 4), ((112, 2), 2)]), false);
        let s = &out.segments;
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].ayah_number, s[0].word_range), (1, Some((3, 4))));
        assert_eq!((s[1].ayah_number, s[1].word_range), (2, None));
        assert_eq!(s[0].start_tick, t(10.0));
        assert_eq!(s[0].end_tick, t(12.5));
        assert_eq!(s[1].start_tick, t(12.5));
        assert_eq!(s[1].end_tick, t(16.0));
        assert_eq!(s[1].word_timings[1].end_tick, t(15.5));
        assert_eq!(
            out.detected,
            vec![DetectedRange {
                surah: 112,
                from_ayah: 1,
                to_ayah: 2
            }]
        );
    }

    #[test]
    fn segment_without_word_timings_uses_refs() {
        let mut s = seg(0.0, 6.0, &[]);
        s.ref_from = "112:1:1".into();
        s.ref_to = "112:2:2".into();
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![s],
        };
        let out = map_alignment(&r, &counts(&[((112, 1), 4), ((112, 2), 2)]), false);
        assert_eq!(out.segments.len(), 2);
        assert_eq!(out.segments[0].word_range, None);
        assert_eq!(out.segments[0].end_tick, t(4.0));
        assert!(out.segments[0].word_timings.is_empty());
    }

    #[test]
    fn mismatched_ayah_1_7_maps_pause_mark_to_previous_word() {
        // Aligner 9 kata; dataset 10 kata dengan tanda waqaf "ەۙ" berdiri sendiri sebagai kata ke-5.
        let words = |s: u32, a: u32| {
            ((s, a) == (1, 7)).then(|| (1..=10).map(|i| format!("d{i}")).collect::<Vec<_>>())
        };
        let aw: Vec<(String, f64, f64)> = (1..=9)
            .map(|i| (format!("1:7:{i}"), f64::from(i - 1), f64::from(i)))
            .collect();
        let refs: Vec<(&str, f64, f64)> = aw.iter().map(|(l, s, e)| (l.as_str(), *s, *e)).collect();
        // Dua segmen: kata aligner 1..4 dan 5..9.
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![seg_abs(0.0, 4.0, &refs[..4]), seg_abs(4.0, 9.0, &refs[4..])],
        };
        let out = map_alignment(&r, &words, false);
        let s = &out.segments;
        assert_eq!(s[0].word_range, Some((1, 5)));
        assert_eq!(s[1].word_range, Some((6, 10)));
        // Kata aligner 4 (عليهم) dibagi ke kata dataset 4 dan 5.
        let w4 = &s[0].word_timings[3];
        let w5 = &s[0].word_timings[4];
        assert_eq!((w4.word_idx, w5.word_idx), (4, 5));
        assert_eq!(w4.start_tick, t(3.0));
        assert_eq!(w5.end_tick, t(4.0));
        assert_eq!(w4.end_tick, w5.start_tick);
        // Kata aligner 5 → kata dataset 6.
        assert_eq!(s[1].word_timings[0].word_idx, 6);
        assert_eq!(s[1].word_timings[0].start_tick, t(4.0));
        assert_eq!(s[1].word_timings.last().unwrap().word_idx, 10);
    }

    #[test]
    fn mismatched_ayah_2_260_merges_joined_words() {
        // Aligner 39 kata; dataset 37: (21,22)→21 "الطَّيْرِفَصُرْهُنَّ" dan (38,39)→37 "عَزِيْزٌحَكِيْمٌ".
        let words = |s: u32, a: u32| {
            ((s, a) == (2, 260)).then(|| (1..=37).map(|i| format!("d{i}")).collect::<Vec<_>>())
        };
        let map = AyahWordMap::new(2, 260, 37, &mut Vec::new());
        assert_eq!(map.aligner_count(), 39);
        assert_eq!(map.span(20), Some((20, 20)));
        assert_eq!(map.span(21), None);
        assert_eq!(map.span(22), Some((21, 21)));
        assert_eq!(map.span(23), Some((22, 22)));
        assert_eq!(map.span(37), Some((36, 36)));
        assert_eq!(map.span(38), None);
        assert_eq!(map.span(39), Some((37, 37)));

        let aw: Vec<(String, f64, f64)> = (1..=39)
            .map(|i| (format!("2:260:{i}"), f64::from(i - 1), f64::from(i)))
            .collect();
        let refs: Vec<(&str, f64, f64)> = aw.iter().map(|(l, s, e)| (l.as_str(), *s, *e)).collect();
        // Aligner memotong di antara kata 21 dan 22 (tengah satu kata dataset): kata dataset 21 tetap utuh di
        // satu segmen.
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![
                seg_abs(0.0, 21.0, &refs[..21]),
                seg_abs(21.0, 39.0, &refs[21..]),
            ],
        };
        let out = map_alignment(&r, &words, false);
        let s = &out.segments;
        assert_eq!(s[0].word_range, Some((1, 20)));
        assert_eq!(s[1].word_range, Some((21, 37)));
        assert_eq!(s[1].word_timings[0].word_idx, 21);
        assert_eq!(s[1].word_timings[0].start_tick, t(21.0));
        let last = s[1].word_timings.last().unwrap();
        assert_eq!(
            (last.word_idx, last.start_tick, last.end_tick),
            (37, t(37.0), t(39.0))
        );
    }

    #[test]
    fn whole_ayah_in_one_segment_with_mismatched_count_has_no_range() {
        let words = |s: u32, a: u32| {
            ((s, a) == (2, 260)).then(|| (1..=37).map(|i| format!("d{i}")).collect::<Vec<_>>())
        };
        let aw: Vec<(String, f64, f64)> = (1..=39)
            .map(|i| (format!("2:260:{i}"), f64::from(i - 1), f64::from(i)))
            .collect();
        let refs: Vec<(&str, f64, f64)> = aw.iter().map(|(l, s, e)| (l.as_str(), *s, *e)).collect();
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![seg(0.0, 39.0, &refs)],
        };
        let out = map_alignment(&r, &words, false);
        assert_eq!(out.segments.len(), 1);
        assert_eq!(out.segments[0].word_range, None);
        assert_eq!(out.segments[0].word_timings.len(), 37);
    }

    #[test]
    fn word_map_table_is_sorted_and_consistent() {
        assert_eq!(WORD_MAP.len(), 138);
        for pair in WORD_MAP.windows(2) {
            assert!((pair[0].0, pair[0].1) < (pair[1].0, pair[1].1));
        }
        for &(s, a, ac, dc, groups) in WORD_MAP {
            let map = AyahWordMap::new(u32::from(s), u32::from(a), u32::from(dc), &mut Vec::new());
            assert_eq!(map.aligner_count(), u32::from(ac), "{s}:{a}");
            assert!(!groups.is_empty());
            // Setiap kata dataset dimiliki tepat satu kata aligner.
            let mut owned = Vec::new();
            for w in 1..=u32::from(ac) {
                if let Some((lo, hi)) = map.span(w) {
                    owned.extend(lo..=hi);
                }
            }
            assert_eq!(owned, (1..=u32::from(dc)).collect::<Vec<_>>(), "{s}:{a}");
        }
    }

    #[test]
    fn special_types_and_errors() {
        assert_eq!(special_kind(Some("Isti'adha")), Some(SegmentKind::Istiadha));
        assert_eq!(special_kind(Some("Basmala")), Some(SegmentKind::Basmala));
        assert_eq!(special_kind(Some("Takbir")), None);
        let mut ist = seg(0.0, 3.0, &[("0:0:1", 0.1, 1.0)]);
        ist.kind = "special".into();
        ist.special_type = Some("Isti'adha".into());
        ist.matched_text = "أَعُوذُ بِٱللَّهِ".into();
        let mut bad = seg(3.0, 4.0, &[]);
        bad.error = Some(serde_json::Value::String("no match".into()));
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![ist, bad],
        };
        let out = map_alignment(&r, &counts(&[]), false);
        assert_eq!(out.segments.len(), 1);
        assert_eq!(out.segments[0].kind, SegmentKind::Istiadha);
        assert_eq!(out.segments[0].id, "seg_istiadha");
        assert_eq!(out.segments[0].word_timings[0].text, "أَعُوذُ");
        assert!(out.detected.is_empty());
        assert!(out.warnings.iter().any(|w| w.contains("no match")));
    }

    #[test]
    fn repeated_ayah_gets_unique_ids_and_new_detected_range() {
        let r = AlignerResult {
            audio_id: None,
            error: None,
            segments: vec![
                seg(0.0, 2.0, &[("112:1:1", 0.0, 1.0), ("112:1:2", 1.0, 2.0)]),
                seg(2.0, 4.0, &[("112:1:1", 0.0, 1.0), ("112:1:2", 1.0, 2.0)]),
            ],
        };
        let out = map_alignment(&r, &counts(&[((112, 1), 2)]), false);
        assert_eq!(out.segments[0].id, "seg_112_1");
        assert_eq!(out.segments[1].id, "seg_112_1_2");
        assert_eq!(out.detected.len(), 1);
    }

    #[test]
    fn http_status_messages_are_plain() {
        let e = status_error(503, "");
        assert!(e.to_string().contains("tidak tersedia"));
        let e = status_error(400, r#"{"error":"bad file"}"#);
        assert!(e.to_string().contains("bad file"));
        assert_eq!(
            map_ureq_error(ureq::Error::HostNotFound),
            CloudError::Offline
        );
    }

    #[test]
    fn multipart_body_wraps_file_bytes() {
        let b = multipart_body("XYZ", "a.flac", b"DATA");
        let s = String::from_utf8(b).unwrap();
        assert!(s.starts_with("--XYZ\r\n"));
        assert!(s.contains("name=\"files\"; filename=\"a.flac\""));
        assert!(s.ends_with("\r\nDATA\r\n--XYZ--\r\n"));
    }

    /// Uji langsung ke Space. Butuh internet dan klip audio: set `QR_CLOUD_ALIGNER_CLIP` ke berkas audio
    /// ringkas (mis. FLAC mono 16 kHz, 20–45 dtk Al-Mulk).
    #[test]
    #[ignore = "jaringan: memanggil HF Space publik; set QR_CLOUD_ALIGNER_CLIP"]
    fn live_space_aligns_clip() {
        let clip = std::env::var("QR_CLOUD_ALIGNER_CLIP").expect("set QR_CLOUD_ALIGNER_CLIP");
        let client = CloudAlignerClient::new().unwrap();
        let started = Instant::now();
        let result = client
            .align_file(
                Path::new(&clip),
                &CloudAlignOptions::default(),
                &mut |stage, msg| eprintln!("[{:?}] {msg}", stage),
            )
            .unwrap();
        eprintln!(
            "selesai dalam {:.1} dtk, {} segmen",
            started.elapsed().as_secs_f64(),
            result.segments.len()
        );
        for s in &result.segments {
            eprintln!(
                "  {:>7.2}–{:>7.2} {} {}..{} conf={:.3} missing={}",
                s.time_from,
                s.time_to,
                s.special_type.as_deref().unwrap_or(&s.kind),
                s.ref_from,
                s.ref_to,
                s.confidence,
                s.has_missing_words
            );
        }
        assert!(!result.segments.is_empty());
    }
}
