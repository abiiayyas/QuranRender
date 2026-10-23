//! Biner qurender: headless render/align/validate CLI dan sidecar worker (PRD RND-4, EXP-7, A1-09).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.4.

use anyhow::{Context, Result};
use qr_jobs::{WorkerCommand, WorkerEvent};
use qr_policy::validate_export_readiness;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

mod render_job;

use render_job::{run_render_job, RenderPayload};

/// Sumber ayat dari dataset terverifikasi; `Mutex` karena koneksi SQLite tidak `Sync`.
struct DbVerses(Mutex<qr_quran::QuranDatabase>);

impl qr_render::VerseSource for DbVerses {
    fn verse(&self, surah: u32, ayah: u32) -> Option<qr_render::VerseContent> {
        let guard = self.0.lock().ok()?;
        qr_render::QuranDbVerses {
            db: &guard,
            edition_key: Some("id.kemenag"),
        }
        .verse(surah, ayah)
    }
}

type Emitter = Arc<dyn Fn(&WorkerEvent) + Send + Sync>;

fn stdout_emitter() -> Emitter {
    Arc::new(|event: &WorkerEvent| {
        if let Ok(json) = serde_json::to_string(event) {
            let stdout = io::stdout();
            let mut handle = stdout.lock();
            let _ = writeln!(handle, "{json}");
            let _ = handle.flush();
        }
    })
}

/// Membuka dataset terverifikasi (CNT-2) untuk job render.
fn open_verses() -> Result<qr_quran::QuranDatabase, String> {
    let dir = std::env::var("QR_DATASET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| render_job::default_resources_dir().join("build/dataset"));
    qr_quran::QuranDatabase::open_with_verification(
        &dir.join("quran.db"),
        &dir.join("dataset-manifest.json"),
        &dir.join("dataset-manifest.json.minisig"),
        include_str!("../../../assets/keys/dataset.pub"),
    )
    .map_err(|e| format!("Dataset tidak dapat dibuka ({}): {e}", dir.display()))
}

/// Menjalankan satu job render dan memancarkan event; mengembalikan setelah job selesai.
fn execute_render(
    job_id: &str,
    payload: &RenderPayload,
    cancel: &AtomicBool,
    emit: &dyn Fn(&WorkerEvent),
    verses: &(dyn qr_render::VerseSource + Sync),
) {
    let fail = |code: &str, message: String| {
        emit(&WorkerEvent::Failed {
            job_id: job_id.to_string(),
            error_code: code.to_string(),
            message,
        });
    };
    emit(&WorkerEvent::Started {
        job_id: job_id.to_string(),
        total_steps: 100,
    });
    let mut last_pct = 0u64;
    let result = run_render_job(payload, verses, cancel, |done, total| {
        let pct = done * 100 / total.max(1);
        if pct > last_pct || done == total {
            last_pct = pct;
            emit(&WorkerEvent::Progress {
                job_id: job_id.to_string(),
                step: pct,
                total_steps: 100,
                progress_fraction: done as f64 / total.max(1) as f64,
                message: format!("Frame {done}/{total}"),
            });
        }
    });
    match result {
        Ok(summary) => emit(&WorkerEvent::Succeeded {
            job_id: job_id.to_string(),
            output_path: Some(summary.output_path.to_string_lossy().to_string()),
        }),
        Err(e) => fail(e.code, e.message),
    }
}

/// Loop worker (A1-09): membaca `WorkerCommand` NDJSON dari `reader`; satu job aktif pada satu waktu,
/// berjalan di thread sendiri sehingga `cancel` tetap terbaca saat render berlangsung.
/// Pembatalan menghentikan FFmpeg dan menghapus berkas parsial.
pub fn run_worker_loop<R: BufRead>(
    mut reader: R,
    emit: Emitter,
    verses: Arc<dyn qr_render::VerseSource + Send + Sync>,
) -> Result<()> {
    let mut active: Option<(String, Arc<AtomicBool>, std::thread::JoinHandle<()>)> = None;
    let mut line = String::new();
    while reader.read_line(&mut line)? > 0 {
        let trimmed = line.trim().to_string();
        line.clear();
        if trimmed.is_empty() {
            continue;
        }
        if active.as_ref().is_some_and(|(_, _, h)| h.is_finished()) {
            if let Some((_, _, h)) = active.take() {
                let _ = h.join();
            }
        }
        let cmd: WorkerCommand = match serde_json::from_str(&trimmed) {
            Ok(c) => c,
            Err(e) => {
                emit(&WorkerEvent::Failed {
                    job_id: "unknown".into(),
                    error_code: "INVALID_COMMAND".into(),
                    message: format!("Gagal mem-parsing perintah: {e}"),
                });
                continue;
            }
        };
        match cmd {
            WorkerCommand::Start {
                job_id,
                kind,
                payload,
            } => {
                if kind != "render" {
                    emit(&WorkerEvent::Failed {
                        job_id,
                        error_code: "UNSUPPORTED_KIND".into(),
                        message: format!("Jenis job tidak didukung: {kind} (hanya 'render'; alignment belum tersedia sebagai job)"),
                    });
                    continue;
                }
                let payload: RenderPayload = match serde_json::from_value(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        emit(&WorkerEvent::Failed {
                            job_id,
                            error_code: "INVALID_PAYLOAD".into(),
                            message: format!("Payload render tidak valid: {e}"),
                        });
                        continue;
                    }
                };
                if active.is_some() {
                    emit(&WorkerEvent::Failed {
                        job_id,
                        error_code: "BUSY".into(),
                        message: "Worker sedang menjalankan job lain.".into(),
                    });
                    continue;
                }
                let cancel = Arc::new(AtomicBool::new(false));
                let (c2, e2, v2, id2) =
                    (cancel.clone(), emit.clone(), verses.clone(), job_id.clone());
                let handle = std::thread::spawn(move || {
                    execute_render(&id2, &payload, &c2, e2.as_ref(), v2.as_ref());
                });
                active = Some((job_id, cancel, handle));
            }
            WorkerCommand::Cancel { job_id } => match &active {
                Some((id, flag, _)) if *id == job_id => flag.store(true, Ordering::Relaxed),
                _ => emit(&WorkerEvent::Failed {
                    job_id,
                    error_code: "NOT_RUNNING".into(),
                    message: "Tidak ada job dengan id tersebut yang sedang berjalan.".into(),
                }),
            },
            WorkerCommand::Pause { job_id } | WorkerCommand::Resume { job_id } => {
                emit(&WorkerEvent::Failed {
                    job_id,
                    error_code: "UNSUPPORTED".into(),
                    message: "Jeda/lanjut belum didukung oleh worker render.".into(),
                });
            }
        }
    }
    if let Some((_, _, h)) = active.take() {
        let _ = h.join();
    }
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        println!(
            "qurender v{} — QuranRender headless CLI & worker",
            env!("CARGO_PKG_VERSION")
        );
        println!("Penggunaan: qurender <worker|validate|render> [argumen]");
        return Ok(());
    }

    match args[1].as_str() {
        "--version" | "-v" => {
            println!("qurender v{}", env!("CARGO_PKG_VERSION"));
        }
        "worker" => {
            let db = open_verses().map_err(anyhow::Error::msg)?;
            let stdin = io::stdin();
            run_worker_loop(
                stdin.lock(),
                stdout_emitter(),
                Arc::new(DbVerses(Mutex::new(db))),
            )?;
        }
        "validate" => {
            if args.len() < 3 {
                eprintln!("Penggunaan: qurender validate <path_proyek.json>");
                std::process::exit(1);
            }
            let path = Path::new(&args[2]);
            let content = std::fs::read_to_string(path)
                .with_context(|| format!("Gagal membaca file proyek: {:?}", path))?;
            let project: qr_core::project::Project = serde_json::from_str(&content)
                .context("Format file proyek tidak valid (JSON salah)")?;

            let report = validate_export_readiness(&project);
            if report.is_ready {
                println!("v Proyek valid dan siap diekspor.");
            } else {
                eprintln!(
                    "X Proyek diblokir oleh kebijakan konten ({} masalah):",
                    report.blocking_count
                );
                for v in &report.violations {
                    eprintln!("  [{}] {}: {}", v.code, v.title, v.description);
                }
                std::process::exit(1);
            }
        }
        "render" => {
            // qurender render <folder_proyek.qrproj> <keluaran.mp4> [--audio f] [--width N] [--max-seconds S] [--threads N] [--overwrite]
            if args.len() < 4 {
                eprintln!("Penggunaan: qurender render <folder_proyek> <keluaran.mp4> [--audio f] [--width N] [--max-seconds S]");
                std::process::exit(1);
            }
            let opt = |name: &str| {
                args.iter()
                    .position(|a| a == name)
                    .and_then(|i| args.get(i + 1))
            };
            let payload = RenderPayload {
                project_dir: PathBuf::from(&args[2]),
                output_path: PathBuf::from(&args[3]),
                audio_path: opt("--audio").map(PathBuf::from),
                resources_dir: None,
                width: opt("--width").and_then(|v| v.parse().ok()),
                max_seconds: opt("--max-seconds").and_then(|v| v.parse().ok()),
                ffmpeg_bin: None,
                overwrite: args.iter().any(|a| a == "--overwrite"),
                threads: opt("--threads").and_then(|v| v.parse().ok()),
            };
            let db = open_verses().map_err(anyhow::Error::msg)?;
            let verses = DbVerses(Mutex::new(db));
            let cancel = AtomicBool::new(false);
            let started = std::time::Instant::now();
            match run_render_job(&payload, &verses, &cancel, |d, t| {
                eprint!("\rFrame {d}/{t}");
            }) {
                Ok(sum) => println!(
                    "\nSelesai: {} ({} frame, encoder {}{}) dalam {:.1} dtk",
                    sum.output_path.display(),
                    sum.frames,
                    sum.encoder,
                    if sum.fell_back_to_software {
                        ", fallback software"
                    } else {
                        ""
                    },
                    started.elapsed().as_secs_f64()
                ),
                Err(e) => {
                    eprintln!("\nGagal [{}]: {}", e.code, e.message);
                    std::process::exit(1);
                }
            }
        }
        cmd => {
            eprintln!("Perintah tidak dikenal: {}", cmd);
            std::process::exit(1);
        }
    }

    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::render_job::default_resources_dir;
    use qr_core::project::{AyahSegment, Project};
    use qr_render::VerseContent;
    use std::collections::HashMap;
    use std::io::{BufReader, Cursor, Read};
    use std::sync::atomic::AtomicUsize;

    type Events = Arc<Mutex<Vec<WorkerEvent>>>;

    fn collector() -> (Emitter, Events) {
        let ev: Events = Arc::new(Mutex::new(Vec::new()));
        let e2 = ev.clone();
        (
            Arc::new(move |e: &WorkerEvent| e2.lock().unwrap().push(e.clone())),
            ev,
        )
    }

    fn fatiha_1() -> Arc<HashMap<(u32, u32), VerseContent>> {
        let root = default_resources_dir();
        let src: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("data/surah/1.json")).unwrap())
                .unwrap();
        let a = &src["data"][0];
        let mut m = HashMap::new();
        m.insert(
            (1, 1),
            VerseContent {
                ayah_text: a["aya_text"].as_str().unwrap().trim().to_string(),
                translation: Some(
                    qr_quran::clean_translation(a["translation_aya_text"].as_str().unwrap())
                        .unwrap(),
                ),
                surah_name_ar: "الفاتحة".into(),
                surah_name_latin: "Al-Fatihah".into(),
            },
        );
        Arc::new(m)
    }

    fn make_project(seconds: i64) -> PathBuf {
        static NONCE: AtomicUsize = AtomicUsize::new(0);
        let n = NONCE.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "qr_cli_{}_{seconds}_{n}.qrproj",
            std::process::id()
        ));
        let mut p = Project::new("Uji Worker");
        p.template_id = "subuh".into();
        p.segments.push(AyahSegment {
            id: "s1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: seconds * 48_000,
            word_timings: vec![],
            confidence: 1.0,
            manual_override: false,
            word_range: None,
        });
        qr_core::save_project_atomic(&dir, &mut p).unwrap();
        dir
    }

    fn start_line(id: &str, project: &Path, out: &Path, extra: serde_json::Value) -> String {
        let mut payload =
            serde_json::json!({"project_dir": project, "output_path": out, "width": 270});
        if let (Some(m), Some(e)) = (payload.as_object_mut(), extra.as_object()) {
            m.extend(e.clone());
        }
        let cmd = WorkerCommand::Start {
            job_id: id.into(),
            kind: "render".into(),
            payload,
        };
        serde_json::to_string(&cmd).unwrap() + "\n"
    }

    fn probe(path: &Path, entries: &str) -> String {
        let o = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                entries,
                "-of",
                "default=nw=1",
                &path.to_string_lossy(),
            ])
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout).to_string()
    }

    #[test]
    fn worker_renders_a_real_mp4_from_project_and_verse_text() {
        let proj = make_project(2);
        let out = std::env::temp_dir().join(format!("qr_cli_out_{}.mp4", std::process::id()));
        let (emit, events) = collector();
        run_worker_loop(
            Cursor::new(start_line("j1", &proj, &out, serde_json::json!({}))),
            emit,
            fatiha_1(),
        )
        .unwrap();
        let ev = events.lock().unwrap().clone();
        assert!(ev.iter().any(|e| matches!(e, WorkerEvent::Started { .. })));
        assert!(ev.iter().any(|e| matches!(e, WorkerEvent::Progress { progress_fraction, .. } if *progress_fraction >= 1.0)), "{ev:?}");
        assert!(
            matches!(
                ev.last(),
                Some(WorkerEvent::Succeeded {
                    output_path: Some(_),
                    ..
                })
            ),
            "{ev:?}"
        );
        let v = probe(&out, "stream=codec_name,width,height,nb_frames,color_space");
        assert!(
            v.contains("codec_name=h264") && v.contains("width=270") && v.contains("height=480"),
            "{v}"
        );
        assert!(
            v.contains("nb_frames=60") && v.contains("color_space=bt709"),
            "{v}"
        );
        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_dir_all(&proj);
    }

    /// Pembaca terskrip: kirim Start, tunggu progres pertama, lalu kirim Cancel, lalu EOF.
    struct Scripted {
        stage: u8,
        buf: Vec<u8>,
        events: Events,
        start: String,
        id: String,
    }

    impl Read for Scripted {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            if self.buf.is_empty() {
                match self.stage {
                    0 => {
                        self.buf = self.start.clone().into_bytes();
                        self.stage = 1;
                    }
                    1 => {
                        let t0 = std::time::Instant::now();
                        while !self
                            .events
                            .lock()
                            .unwrap()
                            .iter()
                            .any(|e| matches!(e, WorkerEvent::Progress { .. }))
                        {
                            assert!(t0.elapsed().as_secs() < 60, "tidak ada progres");
                            std::thread::sleep(std::time::Duration::from_millis(20));
                        }
                        let c = WorkerCommand::Cancel {
                            job_id: self.id.clone(),
                        };
                        self.buf = (serde_json::to_string(&c).unwrap() + "\n").into_bytes();
                        self.stage = 2;
                    }
                    _ => return Ok(0),
                }
            }
            let n = out.len().min(self.buf.len());
            out[..n].copy_from_slice(&self.buf[..n]);
            self.buf.drain(..n);
            Ok(n)
        }
    }

    #[test]
    fn cancel_during_render_kills_job_and_removes_partial_output() {
        let proj = make_project(120); // 120 dtk = 3.600 frame: tidak mungkin selesai sebelum cancel
        let out = std::env::temp_dir().join(format!("qr_cli_cancel_{}.mp4", std::process::id()));
        let (emit, events) = collector();
        let reader = BufReader::new(Scripted {
            stage: 0,
            buf: vec![],
            events: events.clone(),
            start: start_line("j2", &proj, &out, serde_json::json!({})),
            id: "j2".into(),
        });
        run_worker_loop(reader, emit, fatiha_1()).unwrap();
        let ev = events.lock().unwrap().clone();
        assert!(
            matches!(ev.last(), Some(WorkerEvent::Failed { error_code, .. }) if error_code == "CANCELED"),
            "{:?}",
            ev.last()
        );
        assert!(!out.exists(), "berkas parsial harus dihapus");
        let _ = std::fs::remove_dir_all(&proj);
    }

    #[test]
    fn invalid_payload_unknown_kind_and_missing_verse_report_precise_errors() {
        let proj = make_project(1);
        let out = std::env::temp_dir().join("qr_cli_never.mp4");
        let (emit, events) = collector();
        let bad_payload = serde_json::to_string(&WorkerCommand::Start {
            job_id: "a".into(),
            kind: "render".into(),
            payload: serde_json::json!({"x": 1}),
        })
        .unwrap();
        let bad_kind = serde_json::to_string(&WorkerCommand::Start {
            job_id: "b".into(),
            kind: "align".into(),
            payload: serde_json::json!({}),
        })
        .unwrap();
        let input = format!("{bad_payload}\n{bad_kind}\nbukan json\n");
        run_worker_loop(Cursor::new(input), emit, fatiha_1()).unwrap();
        let codes: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                WorkerEvent::Failed { error_code, .. } => Some(error_code.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            codes,
            ["INVALID_PAYLOAD", "UNSUPPORTED_KIND", "INVALID_COMMAND"]
        );

        // Ayat tidak ada di sumber: gagal sebelum FFmpeg dijalankan, tanpa berkas keluaran.
        let (emit2, events2) = collector();
        let empty: Arc<HashMap<(u32, u32), VerseContent>> = Arc::new(HashMap::new());
        run_worker_loop(
            Cursor::new(start_line("c", &proj, &out, serde_json::json!({}))),
            emit2,
            empty,
        )
        .unwrap();
        assert!(
            matches!(events2.lock().unwrap().last(), Some(WorkerEvent::Failed { error_code, .. }) if error_code == "MISSING_VERSE")
        );
        assert!(!out.exists());
        let _ = std::fs::remove_dir_all(&proj);
    }

    #[test]
    fn ayah_too_long_for_one_screen_is_blocked_with_cnt5_before_ffmpeg() {
        let root = default_resources_dir();
        let src: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("data/surah/2.json")).unwrap())
                .unwrap();
        let a = src["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["aya_number"].as_u64() == Some(282))
            .unwrap();
        let mut verses = HashMap::new();
        verses.insert(
            (2, 282),
            VerseContent {
                ayah_text: a["aya_text"].as_str().unwrap().trim().to_string(),
                translation: None,
                surah_name_ar: "البقرة".into(),
                surah_name_latin: "Al-Baqarah".into(),
            },
        );
        let dir = std::env::temp_dir().join(format!("qr_cli_long_{}.qrproj", std::process::id()));
        let mut p = Project::new("Panjang");
        p.template_id = "hening".into();
        p.segments.push(AyahSegment {
            id: "s".into(),
            surah_id: 2,
            ayah_number: 282,
            start_tick: 0,
            end_tick: 48_000 * 5,
            word_timings: vec![],
            confidence: 1.0,
            manual_override: false,
            word_range: None,
        });
        qr_core::save_project_atomic(&dir, &mut p).unwrap();
        let out = std::env::temp_dir().join("qr_cli_long.mp4");
        let (emit, events) = collector();
        run_worker_loop(
            Cursor::new(start_line("L", &dir, &out, serde_json::json!({}))),
            emit,
            Arc::new(verses),
        )
        .unwrap();
        let last = events.lock().unwrap().last().cloned();
        assert!(
            matches!(&last, Some(WorkerEvent::Failed { error_code, message, .. }) if error_code == "CNT-5-OVERFLOW" && message.contains("2:282")),
            "{last:?}"
        );
        assert!(!out.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn frame_hashes(path: &Path) -> String {
        let o = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(path)
            .args(["-f", "framemd5", "-"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter(|l| !l.starts_with('#'))
            .map(|l| l.rsplit(',').next().unwrap_or("").trim().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn parallel_render_produces_same_frames_in_same_order_as_serial() {
        let proj = make_project(2);
        let mut hashes = Vec::new();
        for threads in [1, 4] {
            let out = std::env::temp_dir()
                .join(format!("qr_cli_par_{}_{threads}.mp4", std::process::id()));
            let (emit, events) = collector();
            run_worker_loop(
                Cursor::new(start_line(
                    "p",
                    &proj,
                    &out,
                    serde_json::json!({"threads": threads}),
                )),
                emit,
                fatiha_1(),
            )
            .unwrap();
            let last = events.lock().unwrap().last().cloned();
            assert!(
                matches!(last, Some(WorkerEvent::Succeeded { .. })),
                "{last:?}"
            );
            hashes.push(frame_hashes(&out));
            let _ = std::fs::remove_file(&out);
        }
        assert_eq!(hashes[0].lines().count(), 60);
        assert_eq!(
            hashes[0], hashes[1],
            "urutan/isi frame berbeda antara 1 dan 4 thread"
        );
        let _ = std::fs::remove_dir_all(&proj);
    }

    fn run_one(proj: &Path, out: &Path, extra: serde_json::Value) -> Option<WorkerEvent> {
        let (emit, events) = collector();
        run_worker_loop(
            Cursor::new(start_line("x", proj, out, extra)),
            emit,
            fatiha_1(),
        )
        .unwrap();
        let last = events.lock().unwrap().last().cloned();
        last
    }

    fn code(e: &Option<WorkerEvent>) -> String {
        match e {
            Some(WorkerEvent::Failed { error_code, .. }) => error_code.clone(),
            Some(WorkerEvent::Succeeded { .. }) => "OK".into(),
            other => format!("{other:?}"),
        }
    }

    #[test]
    fn bug_bash_regressions_output_exists_audio_missing_width_and_missing_dirs() {
        let proj = make_project(2);
        let base = std::env::temp_dir().join(format!("qr_cli_bb_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);

        // Folder keluaran yang belum ada dibuat otomatis.
        let out = base.join("a/b/hasil.mp4");
        assert_eq!(code(&run_one(&proj, &out, serde_json::json!({}))), "OK");
        assert!(out.exists());

        // Tidak menimpa berkas yang ada, kecuali diizinkan eksplisit.
        let before = std::fs::metadata(&out).unwrap().modified().unwrap();
        assert_eq!(
            code(&run_one(&proj, &out, serde_json::json!({}))),
            "OUTPUT_EXISTS"
        );
        assert_eq!(std::fs::metadata(&out).unwrap().modified().unwrap(), before);
        assert_eq!(
            code(&run_one(
                &proj,
                &out,
                serde_json::json!({"overwrite": true})
            )),
            "OK"
        );

        // Audio hilang: galat jelas, bukan galat mentah encoder; tidak ada keluaran.
        let out2 = base.join("noaudio.mp4");
        let e = run_one(
            &proj,
            &out2,
            serde_json::json!({"audio_path": base.join("tidak-ada.wav")}),
        );
        assert_eq!(code(&e), "AUDIO_MISSING");
        assert!(!out2.exists());

        // Lebar di luar rentang ditolak (sebelumnya 0 → 2×2 diam-diam).
        for w in [0, 63, 100_000] {
            assert_eq!(
                code(&run_one(
                    &proj,
                    &base.join("w.mp4"),
                    serde_json::json!({"width": w})
                )),
                "INVALID_PAYLOAD",
                "w={w}"
            );
        }

        // Audio lebih pendek dari video tidak memotong video (2 dtk video, 0,5 dtk audio).
        let wav = base.join("short.wav");
        let st = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.5",
                "-ar",
                "48000",
            ])
            .arg(&wav)
            .status()
            .unwrap();
        assert!(st.success());
        let out3 = base.join("padded.mp4");
        assert_eq!(
            code(&run_one(
                &proj,
                &out3,
                serde_json::json!({"audio_path": wav})
            )),
            "OK"
        );
        let d: f64 = probe(&out3, "format=duration")
            .trim()
            .trim_start_matches("duration=")
            .parse()
            .unwrap();
        assert!((d - 2.0).abs() < 0.1, "durasi {d}");
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&proj);
    }
}
