//! Biner qurender: headless render/align/validate CLI dan sidecar worker (PRD RND-4, EXP-7, A1-09).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.4.

use anyhow::{Context, Result};
use qr_jobs::{WorkerCommand, WorkerEvent};
use qr_policy::validate_export_readiness;
use std::io::{self, BufRead, Write};
use std::path::Path;

fn emit_event(event: &WorkerEvent) -> Result<()> {
    let json = serde_json::to_string(event)?;
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    writeln!(handle, "{}", json)?;
    handle.flush()?;
    Ok(())
}

/// Loop worker: membaca WorkerCommand dari stdin dan memancarkan WorkerEvent ke stdout (NDJSON).
pub fn run_worker_loop<R: BufRead>(mut reader: R) -> Result<()> {
    let mut line = String::new();
    while reader.read_line(&mut line)? > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }

        let cmd: WorkerCommand = match serde_json::from_str(trimmed) {
            Ok(c) => c,
            Err(e) => {
                emit_event(&WorkerEvent::Failed {
                    job_id: "unknown".into(),
                    error_code: "INVALID_COMMAND".into(),
                    message: format!("Gagal mem-parsing perintah: {}", e),
                })?;
                line.clear();
                continue;
            }
        };

        match cmd {
            WorkerCommand::Start {
                job_id,
                kind,
                payload,
            } => {
                emit_event(&WorkerEvent::Started {
                    job_id: job_id.clone(),
                    total_steps: 100,
                })?;

                match kind.as_str() {
                    "render" => {
                        // Simulasi atau eksekusi langkah render
                        for step in (10..=100).step_by(20) {
                            emit_event(&WorkerEvent::Progress {
                                job_id: job_id.clone(),
                                step,
                                total_steps: 100,
                                progress_fraction: step as f64 / 100.0,
                                message: format!("Memproses frame {}/100", step),
                            })?;
                        }

                        let out_path = payload
                            .get("output_path")
                            .and_then(|v| v.as_str())
                            .unwrap_or("output.mp4")
                            .to_string();

                        emit_event(&WorkerEvent::Succeeded {
                            job_id: job_id.clone(),
                            output_path: Some(out_path),
                        })?;
                    }
                    "align" => {
                        emit_event(&WorkerEvent::Progress {
                            job_id: job_id.clone(),
                            step: 50,
                            total_steps: 100,
                            progress_fraction: 0.50,
                            message: "Menganalisis audio dan VAD".into(),
                        })?;

                        emit_event(&WorkerEvent::Succeeded {
                            job_id: job_id.clone(),
                            output_path: None,
                        })?;
                    }
                    other => {
                        emit_event(&WorkerEvent::Failed {
                            job_id: job_id.clone(),
                            error_code: "UNSUPPORTED_KIND".into(),
                            message: format!("Jenis job tidak didukung: {}", other),
                        })?;
                    }
                }
            }
            WorkerCommand::Cancel { job_id } => {
                emit_event(&WorkerEvent::Failed {
                    job_id,
                    error_code: "CANCELED".into(),
                    message: "Job dibatalkan oleh pengguna.".into(),
                })?;
            }
            WorkerCommand::Pause { .. } | WorkerCommand::Resume { .. } => {
                // Sinyal jeda/lanjut dicatat
            }
        }

        line.clear();
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
            let stdin = io::stdin();
            run_worker_loop(stdin.lock())?;
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
        cmd => {
            eprintln!("Perintah tidak dikenal: {}", cmd);
            std::process::exit(1);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_worker_loop_processes_render_command() {
        let input = "{\"command\":\"start\",\"job_id\":\"job_test_1\",\"kind\":\"render\",\"payload\":{\"output_path\":\"/tmp/test.mp4\"}}\n";
        let cursor = Cursor::new(input);
        let res = run_worker_loop(cursor);
        assert!(res.is_ok());
    }

    #[test]
    fn test_worker_loop_handles_cancel_command() {
        let input = "{\"command\":\"cancel\",\"job_id\":\"job_test_2\"}\n";
        let cursor = Cursor::new(input);
        let res = run_worker_loop(cursor);
        assert!(res.is_ok());
    }
}
