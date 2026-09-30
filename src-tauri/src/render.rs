use std::process::Command as ProcessCommand;
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Sender, Receiver};
use std::sync::OnceLock;
use std::thread;
use tauri::Emitter;
use std::fs;
use base64::Engine;

#[derive(Serialize, Deserialize, Clone)]
pub struct OverlayFrame {
    pub base64: String,
    pub start_ms: u32,
    pub end_ms: u32,
    pub fade_in: Option<bool>,
    pub fade_out: Option<bool>,
    pub fade_duration: Option<f32>,
}

#[derive(Serialize, Clone)]
pub struct RenderStatusEvent {
    pub job_id: String,
    pub status: String,
    pub progress: u8,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RenderJob {
    pub id: String,
    pub title: String,
    pub audio_paths: Vec<String>,
    pub bg_path: String,
    pub output_path: String,
    pub overlay_base64: Option<String>,
    pub overlay_sequence: Option<Vec<OverlayFrame>>,
    pub thumbnail_path: Option<String>,
    pub animation_style: Option<String>,
    pub orientation: Option<String>,
    pub duration: Option<u32>,
    pub fade_duration: Option<f32>,
}

// Thread-safe channel using OnceLock instead of unsafe static mut.
static WORKER_TX: OnceLock<Sender<RenderJob>> = OnceLock::new();

pub fn init_background_worker(app: &mut tauri::App) {
    let (tx, rx): (Sender<RenderJob>, Receiver<RenderJob>) = mpsc::channel();

    WORKER_TX.set(tx).expect("Worker already initialised");

    let app_handle = app.handle().clone();

    thread::spawn(move || {
        loop {
            if let Ok(job) = rx.recv() {
                let _ = app_handle.emit("render-status", RenderStatusEvent {
                    job_id: job.id.clone(),
                    status: "processing".to_string(),
                    progress: 0,
                    error: None,
                });
                match execute_ffmpeg(&job, &app_handle) {
                    Ok(_) => {
                        let _ = app_handle.emit("render-status", RenderStatusEvent {
                            job_id: job.id.clone(),
                            status: "done".to_string(),
                            progress: 100,
                            error: None,
                        });
                    },
                    Err(e) => {
                        let _ = app_handle.emit("render-status", RenderStatusEvent {
                            job_id: job.id.clone(),
                            status: "error".to_string(),
                            progress: 0,
                            error: Some(e.to_string()),
                        });
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub fn enqueue_render(app_handle: tauri::AppHandle, job: RenderJob) -> Result<String, crate::error::AppError> {
    let tx = WORKER_TX.get().ok_or("Worker not initialized".to_string())?;
    tx.send(job.clone()).map_err(|e| format!("Failed to enqueue job: {}", e))?;

    let _ = app_handle.emit("render-status", RenderStatusEvent {
        job_id: job.id.clone(),
        status: "pending".to_string(),
        progress: 0,
        error: None,
    });

    Ok(format!("Job {} added to queue", job.id))
}

fn get_ffmpeg_path() -> String {
    let paths = ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
    for path in paths {
        if let Ok(_) = ProcessCommand::new(path).arg("-version").output() {
            return path.to_string();
        }
    }
    "ffmpeg".to_string()
}

fn get_ffprobe_path() -> String {
    let paths = ["ffprobe", "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"];
    for path in paths {
        if let Ok(_) = ProcessCommand::new(path).arg("-version").output() {
            return path.to_string();
        }
    }
    "ffprobe".to_string()
}

// Shared progress state — a single AtomicU8 used by both getter and setter.
static PROGRESS_STATE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

fn progress_state() -> u8 {
    PROGRESS_STATE.load(std::sync::atomic::Ordering::Relaxed)
}
fn set_progress_state(v: u8) {
    PROGRESS_STATE.store(v, std::sync::atomic::Ordering::Relaxed);
}
fn reset_progress_state() {
    PROGRESS_STATE.store(0, std::sync::atomic::Ordering::Relaxed);
}

// Run ffmpeg with a hard timeout so a stuck filtergraph can never hang the
// render thread forever. Reads `-progress` key/value output from stdout and
// calls `on_progress` with a 0-100 percentage. Returns (success, stderr-tails).
fn run_ffmpeg_with_timeout(
    bin: &str,
    args: &[String],
    total_ms: u64,
    on_progress: std::sync::Arc<dyn Fn(u8) + Send + Sync>,
) -> Result<(bool, String), crate::error::AppError> {
    let max_secs = 2 * 60 * 60; // 2h — long renders run single-threaded (see -filter_threads 1), so be generous.
    let sleep = std::time::Duration::from_millis(500);

    // Redirect ffmpeg stderr to a temp file instead of a pipe. Long renders
    // write enough stderr to fill the OS pipe buffer (64KB); if nothing drains
    // it, ffmpeg blocks forever mid-render and the job stalls/looks hung.
    // Writing to a file never blocks. Read it back only at the end for errors.
    let stderr_file_path = std::env::temp_dir()
        .join(format!("qr_stderr_{}.log", std::process::id()));
    let stderr_file = std::fs::File::create(&stderr_file_path)
        .map_err(|e| format!("Failed to create stderr temp file: {}", e))?;

    let mut child = ProcessCommand::new(bin)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::from(stderr_file))
        .spawn()
        .map_err(|e| format!("FFmpeg spawn error: {}", e))?;

    // Pump stdout (`-progress pipe:1`) while ffmpeg runs.
    let stdout = std::mem::take(&mut child.stdout);
    let total_ms = total_ms.max(1);
    let filter_thread = thread::spawn(move || {
        use std::io::BufRead;
        if let Some(mut s) = stdout {
            let mut reader = std::io::BufReader::new(&mut s);
            let mut buf = String::new();
            while reader.read_line(&mut buf).is_ok() {
                if buf.is_empty() { break; }
                let kvs: Vec<&str> = buf.split('=').collect();
                if kvs.len() == 2 && kvs[0] == "out_time_us" {
                    if let Ok(us) = kvs[1].trim().parse::<u64>() {
                        let ms = us / 1000;
                        let pct = ((ms as f64 / total_ms as f64) * 100.0).min(99.0) as u8;
                        if pct > progress_state() {
                            set_progress_state(pct);
                            on_progress(pct);
                        }
                    }
                }
                buf.clear();
            }
        }
    });

    let wait_until = std::time::Instant::now() + std::time::Duration::from_secs(max_secs);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("wait error: {}", e))? {
            let _ = filter_thread.join();
            let stderr = std::fs::read_to_string(&stderr_file_path).unwrap_or_default();
            let _ = std::fs::remove_file(&stderr_file_path);
            return Ok((status.success(), stderr));
        }
        if std::time::Instant::now() > wait_until {
            let _ = child.kill();
            let _ = child.wait();
            let _ = filter_thread.join();
            let stderr = std::fs::read_to_string(&stderr_file_path).unwrap_or_default();
            let _ = std::fs::remove_file(&stderr_file_path);
            return Err(format!("FFmpeg timed out after 30 minutes (filtergraph likely stalled): {}", stderr.trim()).into());
        }
        std::thread::sleep(sleep);
    }
}

// Total duration of an audio file in ms, parsed from ffprobe. Falls back to 0
// (contributes nothing) on any failure.
fn probe_audio_duration_ms(path: &str) -> u64 {
    let ffprobe = get_ffprobe_path();
    println!("[probe] Using ffprobe: {} for path: {}", ffprobe, path);
    let out = match ProcessCommand::new(&ffprobe)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
        .output()
    {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            println!("[probe] ffprobe failed for {}: exit={:?} stderr={}", path, o.status.code(), String::from_utf8_lossy(&o.stderr));
            return 0;
        }
        Err(e) => {
            println!("[probe] ffprobe spawn error for {}: {}", path, e);
            return 0;
        }
    };
    let raw = String::from_utf8_lossy(&out.stdout);
    let duration_ms = raw
        .trim()
        .parse::<f64>()
        .map(|s| (s * 1000.0) as u64)
        .unwrap_or(0);
    println!("[probe] {} => {} ms", path, duration_ms);
    duration_ms
}

fn execute_ffmpeg(job: &RenderJob, app_handle: &tauri::AppHandle) -> Result<(), crate::error::AppError> {
    println!("Starting render job: {}", job.id);

    // Reset progress for this new job.
    reset_progress_state();

    let temp_dir = std::env::temp_dir();

    let is_image = job.bg_path.to_lowercase().ends_with(".png")
                || job.bg_path.to_lowercase().ends_with(".jpg")
                || job.bg_path.to_lowercase().ends_with(".jpeg");
    let is_video = job.bg_path.to_lowercase().ends_with(".mp4")
                || job.bg_path.to_lowercase().ends_with(".mov")
                || job.bg_path.to_lowercase().ends_with(".webm");

    // Compute total audio length early — needed for -t and progress tracking.
    let mut total_ms: u64 = 0;
    for p in &job.audio_paths {
        if p.starts_with("SILENCE_SECONDS:") {
            if let Some(secs_str) = p.split(':').nth(1) {
                if let Ok(secs) = secs_str.parse::<u64>() {
                    total_ms += secs * 1000;
                }
            }
        } else {
            total_ms += probe_audio_duration_ms(p);
        }
    }
    let total_duration_secs = job.duration.unwrap_or((total_ms as f32 / 1000.0).ceil().max(1.0) as u32);
    println!("[render] audio_paths count={}, total_ms={}, total_duration_secs={}", job.audio_paths.len(), total_ms, total_duration_secs);

    // Global fade duration from job or default 0.5s.
    let default_fade_dur: f32 = job.fade_duration.unwrap_or(0.5);

    let mut args = vec![
        "-y".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        // Force a single-threaded filtergraph. Every slide is fed as its own
        // ffmpeg input (96 ayat → ~190 inputs for a full surah), and ffmpeg
        // otherwise spawns multi-threaded slices per CPU/core. On macOS the
        // process/thread count quickly blows past `ulimit -u` and we get
        // "pthread_create failed: Resource temporarily unavailable" +
        // swscaler init failures, which is exactly this long-render crash.
        // One slice/thread avoids that; rendering is slower but completes.
        "-filter_threads".to_string(),
        "1".to_string(),
        "-filter_complex_threads".to_string(),
        "1".to_string(),
    ];

    if is_image {
        args.push("-loop".to_string());
        args.push("1".to_string());
    } else if is_video {
        args.push("-stream_loop".to_string());
        args.push("-1".to_string());
    }

    // Single decode thread for the background input too. Otherwise its default
    // multi-threaded decode pool adds to the thread pressure of this already
    // huge input set (every slide is its own ffmpeg input).
    args.push("-threads".to_string());
    args.push("1".to_string());
    args.push("-i".to_string());
    args.push(job.bg_path.clone());

    let mut audio_input_indices = Vec::new();
    let mut current_input_index = 1; // 0 is bg

    // We will extract custom backgrounds from overlay_sequence and add them as inputs
    if let Some(seq) = &job.overlay_sequence {
        for _frame in seq {
            // We'll pass custom bg in base64? No, it's a file path in the frontend.
            // Wait, OverlayFrame doesn't have custom_bg_path yet. Let's handle it later or modify OverlayFrame.
        }
    }

    for audio_path in &job.audio_paths {
        if audio_path.starts_with("SILENCE_SECONDS:") {
            if let Some(secs_str) = audio_path.split(':').nth(1) {
                args.push("-threads".to_string());
                args.push("1".to_string());
                args.push("-f".to_string());
                args.push("lavfi".to_string());
                args.push("-t".to_string());
                args.push(secs_str.to_string());
                args.push("-i".to_string());
                args.push("anullsrc=channel_layout=stereo:sample_rate=44100".to_string());
                audio_input_indices.push(current_input_index);
                current_input_index += 1;
            }
        } else {
            args.push("-threads".to_string());
            args.push("1".to_string());
            args.push("-i".to_string());
            args.push(audio_path.clone());
            audio_input_indices.push(current_input_index);
            current_input_index += 1;
        }
    }

    let mut filter_complex = String::new();
    // Audio inputs start at index 1
    let has_audio = !job.audio_paths.is_empty();
    let audio_map = if job.audio_paths.len() > 1 {
        for i in &audio_input_indices {
            filter_complex.push_str(&format!("[{}:a]", i));
        }
        let fade_out_st = total_duration_secs.saturating_sub(1);
        filter_complex.push_str(&format!("concat=n={}:v=0:a=1,afade=t=in:st=0:d=1,afade=t=out:st={}:d=1[outa];", job.audio_paths.len(), fade_out_st));
        "[outa]".to_string()
    } else if has_audio {
        let fade_out_st = total_duration_secs.saturating_sub(1);
        filter_complex.push_str(&format!("[1:a]afade=t=in:st=0:d=1,afade=t=out:st={}:d=1[outa];", fade_out_st));
        "[outa]".to_string()
    } else {
        // No audio at all.
        String::new()
    };

    // Background scaling — use pad as safety net to guarantee exact output size.
    if job.orientation.as_deref() == Some("landscape") {
        filter_complex.push_str(
            "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,\
             crop=1920:1080,\
             pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,\
             fps=25,setsar=1,format=yuv420p[bg];"
        );
    } else {
        filter_complex.push_str(
            "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,\
             crop=1080:1920,\
             pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,\
             fps=25,setsar=1,format=yuv420p[bg];"
        );
    }
    let mut current_bg = "bg".to_string();
    let mut temp_paths = Vec::new();

    if let Some(ref seq) = job.overlay_sequence {
        for (i, frame) in seq.iter().enumerate() {
            let temp_overlay_path = temp_dir.join(format!("{}_overlay_{}.png", job.id, i));
            let decoded = base64::engine::general_purpose::STANDARD.decode(&frame.base64).map_err(|e| format!("Base64 decode error: {}", e))?;
            fs::write(&temp_overlay_path, decoded).map_err(|e| format!("Failed to write temp overlay: {}", e))?;
            temp_paths.push(temp_overlay_path.clone());

            let start_sec = frame.start_ms as f64 / 1000.0;
            let end_sec = frame.end_ms as f64 / 1000.0;
            let overlay_dur = (end_sec - start_sec).max(0.04); // at least 1 frame at 25fps

            let do_fade_in = job.animation_style.as_deref() == Some("fade") && frame.fade_in.unwrap_or(false);
            let do_fade_out = job.animation_style.as_deref() == Some("fade") && frame.fade_out.unwrap_or(false);

            // Per-frame fade duration, falling back to global default.
            let fade_dur = frame.fade_duration.unwrap_or(default_fade_dur) as f64;

            let input_index = 1 + job.audio_paths.len() + i;
            args.push("-threads".to_string());
            args.push("1".to_string());
            args.push("-i".to_string());
            args.push(temp_overlay_path.to_str().unwrap().to_string());

            let out_node = format!("v{}", i);

            // Strategy: generate exactly the needed duration from a single
            // PNG frame, apply fade with *relative* (0-based) timestamps,
            // then shift the PTS so the overlay lands at the correct
            // absolute position in the timeline.
            //
            // 1. loop the single frame to fill `overlay_dur` seconds
            // 2. trim to exactly `overlay_dur`
            // 3. set PTS starting at 0 (relative timeline)
            // 4. convert to yuva420p for alpha-aware overlay
            // 5. apply fade-in/out using relative st values (0-based)
            // 6. shift PTS to absolute position with setpts=PTS+start_sec
            //
            // The overlay filter uses enable='between(t,start,end)' for
            // safety, but because the PTS is already shifted the overlay
            // frames naturally fall into the right window.

            let loop_frames = ((overlay_dur * 25.0).ceil() as u64).max(1);

            let mut filter = format!(
                "[{}:v]loop={}:1:0,trim=duration={:.4},setpts=PTS-STARTPTS,format=yuva420p",
                input_index, loop_frames, overlay_dur
            );

            if do_fade_in || do_fade_out {
                if do_fade_in {
                    let fd = fade_dur.min(overlay_dur);
                    filter.push_str(&format!(",fade=t=in:st=0:d={:.3}:alpha=1", fd));
                }
                if do_fade_out {
                    let fd = fade_dur.min(overlay_dur);
                    let fade_out_start = (overlay_dur - fd).max(0.0);
                    filter.push_str(&format!(",fade=t=out:st={:.4}:d={:.3}:alpha=1", fade_out_start, fd));
                }
            }

            // Shift PTS to the absolute start position.
            filter.push_str(&format!(",setpts=PTS+{:.4}/TB", start_sec));

            filter.push_str(&format!("[v{}_processed];", i));

            filter_complex.push_str(&filter);
            filter_complex.push_str(&format!(
                "[{}][v{}_processed]overlay=0:0:enable='between(t,{:.4},{:.4})'[{}]",
                current_bg, i, start_sec, end_sec, out_node
            ));

            if i < seq.len() - 1 {
                filter_complex.push_str(";");
            }
            current_bg = out_node;
        }
    } else if let Some(ref b64) = job.overlay_base64 {
        let temp_overlay_path = temp_dir.join(format!("{}_overlay.png", job.id));
        let decoded = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| format!("Base64 decode error: {}", e))?;
        fs::write(&temp_overlay_path, decoded).map_err(|e| format!("Failed to write temp overlay: {}", e))?;
        temp_paths.push(temp_overlay_path.clone());

        args.push("-threads".to_string());
        args.push("1".to_string());
        args.push("-i".to_string());
        args.push(temp_overlay_path.to_str().unwrap().to_string());

        let overlay_idx = 1 + job.audio_paths.len();
        // For single overlay, generate enough frames for total duration then trim.
        let loop_frames = ((total_duration_secs as u64 + 1) * 25).max(1);
        filter_complex.push_str(&format!(
            "[{}:v]loop={}:1:0,trim=duration={},setpts=PTS-STARTPTS,format=yuva420p[v_overlay];",
            overlay_idx, loop_frames, total_duration_secs
        ));
        filter_complex.push_str(&format!("[{}][v_overlay]overlay=0:0[vfinal]", current_bg));
        current_bg = "vfinal".to_string();
    } else {
        return Err("No overlay provided".to_string().into());
    }

    args.push("-filter_complex".to_string());
    args.push(filter_complex);
    args.push("-map".to_string());
    args.push(format!("[{}]", current_bg));
    if has_audio {
        args.push("-map".to_string());
        args.push(audio_map);
    }
    args.push("-threads".to_string());
    args.push("1".to_string());
    args.push("-c:v".to_string());
    #[cfg(target_os = "macos")]
    {
        args.push("h264_videotoolbox".to_string());
        args.push("-b:v".to_string());
        args.push("5M".to_string()); // Default 5 Mbps to preserve quality for HW encoder
    }
    #[cfg(not(target_os = "macos"))]
    {
        args.push("libx264".to_string());
    }
    if has_audio {
        args.push("-c:a".to_string());
        args.push("aac".to_string());
    }
    // Always cut with -t (never -shortest). With infinite video sources
    // (looped bg + looped overlays), -shortest is unreliable at flushing the
    // muxer and the render hangs near the end. Compute total audio length.
    args.push("-t".to_string());
    args.push(total_duration_secs.to_string());

    args.push("-progress".to_string());
    args.push("pipe:1".to_string());

    let temp_output = temp_dir.join(format!("{}_temp.mp4", job.id));
    if job.thumbnail_path.is_some() {
        args.push(temp_output.to_str().unwrap().to_string());
    } else {
        args.push(job.output_path.clone());
    }

    let job_id = job.id.clone();
    let app = app_handle.clone();
    let prog_cb: std::sync::Arc<dyn Fn(u8) + Send + Sync> = std::sync::Arc::new(move |pct| {
        let _ = app.emit("render-status", RenderStatusEvent {
            job_id: job_id.clone(),
            status: "processing".to_string(),
            progress: pct,
            error: None,
        });
    });
    let render_total_ms = (total_duration_secs as u64) * 1000;
    let status = run_ffmpeg_with_timeout(&get_ffmpeg_path(), &args, render_total_ms, prog_cb);

    if let Some(ref thumb) = job.thumbnail_path {
        if status.as_ref().map(|s| s.0).unwrap_or(false) {
            println!("Embedding thumbnail: {}", thumb);
            let thumb_status = ProcessCommand::new(get_ffmpeg_path())
                .args([
                    "-y",
                    "-i", temp_output.to_str().unwrap(),
                    "-i", thumb,
                    "-map", "0",
                    "-map", "1",
                    "-c", "copy",
                    "-disposition:v:1", "attached_pic",
                    &job.output_path
                ])
                .status();
            let _ = fs::remove_file(&temp_output);
            if !thumb_status.as_ref().map(|s| s.success()).unwrap_or(false) {
                println!("Thumbnail embedding failed");
            }
        }
    }

    for path in temp_paths {
        let _ = fs::remove_file(&path);
    }

    match status {
        Ok(s) if s.0 => Ok(()),
        Ok(s) => Err(format!("Render failed: {}", s.1.trim()).into()),
        Err(e) => Err(format!("Failed to start FFmpeg: {}", e).into()),
    }
}
