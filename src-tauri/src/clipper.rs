use crate::ai::call_ai_completion;
use crate::db::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command as ProcessCommand;
use tauri::State;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolStatus {
    pub yt_dlp_installed: bool,
    pub yt_dlp_path: String,
    pub ffmpeg_installed: bool,
    pub ffmpeg_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct YtMetadata {
    pub id: String,
    pub title: String,
    pub duration: f64,
    pub thumbnail: String,
    pub uploader: String,
    pub view_count: Option<u64>,
    pub has_subtitles: bool,
    pub available_sub_langs: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TranscriptSegment {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HookRecommendation {
    pub id: String,
    pub title: String,
    pub start_time: f64,
    pub end_time: f64,
    pub duration: f64,
    pub hook_score: u8,
    pub reasoning: String,
    pub suggested_caption: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClipJobReq {
    pub source_type: String, // "youtube" or "local"
    pub source_url_or_path: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub layout_mode: String, // "vertical_9_16", "landscape_16_9", "square_1_1"
    pub output_path: String,
}

pub fn get_ytdlp_bin(state: Option<&State<'_, AppState>>) -> String {
    if let Some(st) = state {
        if let Ok(db) = st.db.lock() {
            let stmt = db.prepare("SELECT value FROM app_settings WHERE key = 'yt_dlp_path'").ok();
            if let Some(mut s) = stmt {
                if let Ok(mut rows) = s.query([]) {
                    if let Ok(Some(row)) = rows.next() {
                        let path: String = row.get(0).unwrap_or_default();
                        if !path.trim().is_empty() && Path::new(&path).exists() {
                            return path;
                        }
                    }
                }
            }
        }
    }

    let paths = ["yt-dlp", "/usr/local/bin/yt-dlp", "/opt/homebrew/bin/yt-dlp"];
    for p in paths {
        if ProcessCommand::new(p).arg("--version").output().is_ok() {
            return p.to_string();
        }
    }
    "yt-dlp".to_string()
}

pub fn get_ffmpeg_bin() -> String {
    let paths = ["ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"];
    for p in paths {
        if ProcessCommand::new(p).arg("-version").output().is_ok() {
            return p.to_string();
        }
    }
    "ffmpeg".to_string()
}

#[tauri::command]
pub fn check_ytdlp_status(state: State<'_, AppState>) -> Result<ToolStatus, String> {
    let ytdlp_path = get_ytdlp_bin(Some(&state));
    let ffmpeg_path = get_ffmpeg_bin();

    let yt_installed = ProcessCommand::new(&ytdlp_path).arg("--version").output().is_ok();
    let ff_installed = ProcessCommand::new(&ffmpeg_path).arg("-version").output().is_ok();

    Ok(ToolStatus {
        yt_dlp_installed: yt_installed,
        yt_dlp_path: ytdlp_path,
        ffmpeg_installed: ff_installed,
        ffmpeg_path: ffmpeg_path,
    })
}

#[tauri::command]
pub async fn fetch_yt_metadata(state: State<'_, AppState>, url: String) -> Result<YtMetadata, String> {
    let ytdlp = get_ytdlp_bin(Some(&state));
    
    let output = ProcessCommand::new(&ytdlp)
        .args(["--dump-json", "--no-playlist", "--skip-download", &url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", err_msg.trim()));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let v: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse metadata JSON: {}", e))?;

    let id = v["id"].as_str().unwrap_or("").to_string();
    let title = v["title"].as_str().unwrap_or("Untitled Video").to_string();
    let duration = v["duration"].as_f64().unwrap_or(0.0);
    let thumbnail = v["thumbnail"].as_str().unwrap_or("").to_string();
    let uploader = v["uploader"].as_str().or_else(|| v["channel"].as_str()).unwrap_or("Unknown").to_string();
    let view_count = v["view_count"].as_u64();

    let mut available_sub_langs = Vec::new();
    if let Some(subs) = v["subtitles"].as_object() {
        for lang in subs.keys() {
            available_sub_langs.push(lang.clone());
        }
    }
    if let Some(autos) = v["automatic_captions"].as_object() {
        for lang in autos.keys() {
            if !available_sub_langs.contains(lang) {
                available_sub_langs.push(lang.clone());
            }
        }
    }

    let has_subtitles = !available_sub_langs.is_empty();

    Ok(YtMetadata {
        id,
        title,
        duration,
        thumbnail,
        uploader,
        view_count,
        has_subtitles,
        available_sub_langs,
    })
}

#[tauri::command]
pub async fn fetch_yt_transcript(
    state: State<'_, AppState>,
    url: String,
    lang: Option<String>,
) -> Result<Vec<TranscriptSegment>, String> {
    let ytdlp = get_ytdlp_bin(Some(&state));
    let temp_dir = std::env::temp_dir();
    let file_prefix = format!("qr_sub_{}", std::process::id());
    let output_template = temp_dir.join(format!("{}.%(ext)s", file_prefix));

    let lang_str = lang.unwrap_or_else(|| "id,en,ar".to_string());

    let status = ProcessCommand::new(&ytdlp)
        .args([
            "--skip-download",
            "--write-sub",
            "--write-auto-sub",
            "--sub-lang",
            &lang_str,
            "--convert-subs",
            "vtt",
            "-o",
            &output_template.to_string_lossy(),
            &url,
        ])
        .status()
        .map_err(|e| format!("Failed to fetch subtitles: {}", e))?;

    if !status.success() {
        println!("yt-dlp subtitle download non-zero exit, searching for generated vtt files anyway...");
    }

    // Look for generated .vtt file in temp_dir matching file_prefix
    let mut vtt_path = None;
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&file_prefix) && name.ends_with(".vtt") {
                vtt_path = Some(entry.path());
                break;
            }
        }
    }

    let path = match vtt_path {
        Some(p) => p,
        None => return Err("Subtitle transcript file (.vtt) could not be generated for this video.".to_string()),
    };

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read VTT file: {}", e))?;
    let _ = fs::remove_file(path); // Clean up temp file

    let segments = parse_vtt_transcript(&content);
    Ok(segments)
}

fn parse_vtt_time(s: &str) -> f64 {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().unwrap_or(0.0);
        let m: f64 = parts[1].parse().unwrap_or(0.0);
        let sec_parts: Vec<&str> = parts[2].split('.').collect();
        let sec: f64 = sec_parts[0].parse().unwrap_or(0.0);
        let ms: f64 = if sec_parts.len() > 1 {
            format!("0.{}", sec_parts[1]).parse().unwrap_or(0.0)
        } else {
            0.0
        };
        h * 3600.0 + m * 60.0 + sec + ms
    } else if parts.len() == 2 {
        let m: f64 = parts[0].parse().unwrap_or(0.0);
        let sec_parts: Vec<&str> = parts[1].split('.').collect();
        let sec: f64 = sec_parts[0].parse().unwrap_or(0.0);
        let ms: f64 = if sec_parts.len() > 1 {
            format!("0.{}", sec_parts[1]).parse().unwrap_or(0.0)
        } else {
            0.0
        };
        m * 60.0 + sec + ms
    } else {
        0.0
    }
}

fn parse_vtt_transcript(vtt_text: &str) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();
    let lines: Vec<&str> = vtt_text.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.contains("-->") {
            let times: Vec<&str> = line.split("-->").collect();
            if times.len() == 2 {
                let start_sec = parse_vtt_time(times[0].trim().split_whitespace().next().unwrap_or(""));
                let end_sec = parse_vtt_time(times[1].trim().split_whitespace().next().unwrap_or(""));

                i += 1;
                let mut text_lines = Vec::new();
                while i < lines.len() && !lines[i].trim().is_empty() && !lines[i].contains("-->") {
                    let clean = strip_vtt_tags(lines[i].trim());
                    if !clean.is_empty() && !text_lines.contains(&clean) {
                        text_lines.push(clean);
                    }
                    i += 1;
                }

                let text = text_lines.join(" ");
                if !text.is_empty() && (end_sec - start_sec > 0.3) {
                    segments.push(TranscriptSegment {
                        start_sec,
                        end_sec,
                        text,
                    });
                }
                continue;
            }
        }
        i += 1;
    }

    // Deduplicate adjacent identical texts
    let mut deduped: Vec<TranscriptSegment> = Vec::new();
    for seg in segments {
        if let Some(last) = deduped.last_mut() {
            if last.text == seg.text {
                last.end_sec = seg.end_sec;
                continue;
            }
        }
        deduped.push(seg);
    }

    deduped
}

fn strip_vtt_tags(s: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(c);
        }
    }
    result.replace("&nbsp;", " ").replace("&gt;", ">").replace("&lt;", "<").trim().to_string()
}

#[tauri::command]
pub async fn ai_analyze_yt_hooks(
    state: State<'_, AppState>,
    transcript: Vec<TranscriptSegment>,
    video_title: String,
) -> Result<Vec<HookRecommendation>, String> {
    if transcript.is_empty() {
        return Err("Transkrip kosong, AI tidak dapat menganalisis hook.".to_string());
    }

    // Format transcript into timecoded text
    let mut formatted_text = String::new();
    for seg in transcript.iter().take(150) { // Limit to 150 segments to fit LLM token limit
        let min = (seg.start_sec / 60.0).floor() as u32;
        let sec = (seg.start_sec % 60.0).floor() as u32;
        formatted_text.push_str(&format!("[{:02}:{:02}] {}\n", min, sec, seg.text));
    }

    let system_prompt = r#"You are an expert Islamic Content Editor & Short-form Video Strategist (Shorts, Reels, TikTok).
Analyze the provided timecoded transcript of a video (Quran recitation, Islamic lecture, Imam recitation, or podcast).

Your goal is to identify 3 to 5 of the MOST ENGAGING clip segments (viral hooks, high emotional/spiritual resonance, inspiring advice, powerful Quran verses, or key takeaways).

CRITICAL CONSTRAINTS:
1. Clip duration MUST be between 15 seconds and 90 seconds.
2. Output ONLY a valid JSON array of objects, with NO Markdown syntax or formatting around it (do not wrap in ```json).
3. Each JSON object MUST have these exact fields:
   - "id": unique string ID (e.g. "hook_1")
   - "title": short catchy title for the clip (in Indonesian)
   - "start_time": number in seconds (e.g. 45.0)
   - "end_time": number in seconds (e.g. 95.0)
   - "duration": number in seconds (end_time - start_time)
   - "hook_score": integer rating from 80 to 99
   - "reasoning": 1 sentence explanation why this is a great clip (in Indonesian)
   - "suggested_caption": short viral social media caption with hashtags (in Indonesian)
"#;

    let user_prompt = format!(
        "Video Title: {}\n\nTimecoded Transcript:\n{}",
        video_title, formatted_text
    );

    let raw_response = call_ai_completion(&state, system_prompt, &user_prompt).await?;

    // Clean JSON response string
    let clean_json = raw_response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let recommendations: Vec<HookRecommendation> = serde_json::from_str(clean_json)
        .map_err(|e| format!("Gagal memproses rekomendasi AI: {} (Raw response: {})", e, raw_response))?;

    Ok(recommendations)
}

#[tauri::command]
pub async fn download_and_cut_clip(
    state: State<'_, AppState>,
    req: ClipJobReq,
) -> Result<String, String> {
    let ffmpeg = get_ffmpeg_bin();
    let temp_dir = std::env::temp_dir();

    let mut input_video_path = req.source_url_or_path.clone();

    // If source is YouTube, download the video section or video file first
    if req.source_type == "youtube" {
        let ytdlp = get_ytdlp_bin(Some(&state));
        let download_file = temp_dir.join(format!("yt_source_{}.mp4", std::process::id()));

        // Format start & end in seconds for yt-dlp section
        let section_arg = format!("*{:.2}-{:.2}", req.start_sec, req.end_sec);

        println!("Downloading YouTube clip section via yt-dlp: {}", section_arg);

        let dl_output = ProcessCommand::new(&ytdlp)
            .args([
                "--download-sections",
                &section_arg,
                "-f",
                "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--force-overwrites",
                "-o",
                &download_file.to_string_lossy(),
                &req.source_url_or_path,
            ])
            .output()
            .map_err(|e| format!("Gagal mendownload segmen YouTube: {}", e))?;

        if !dl_output.status.success() || !download_file.exists() {
            // Fallback: download full video or use ffmpeg direct stream
            println!("yt-dlp section download failed, falling back to full format download...");
            let dl_output_full = ProcessCommand::new(&ytdlp)
                .args([
                    "-f",
                    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                    "--force-overwrites",
                    "-o",
                    &download_file.to_string_lossy(),
                    &req.source_url_or_path,
                ])
                .output()
                .map_err(|e| format!("Gagal mendownload video YouTube: {}", e))?;

            if !dl_output_full.status.success() || !download_file.exists() {
                let err = String::from_utf8_lossy(&dl_output_full.stderr);
                return Err(format!("Download video gagal: {}", err.trim()));
            }
        }

        input_video_path = download_file.to_string_lossy().to_string();
    }

    // Now cut/re-encode video using FFmpeg according to requested layout
    let start_str = format!("{:.3}", req.start_sec);
    let duration_str = format!("{:.3}", (req.end_sec - req.start_sec).max(1.0));

    let mut ffmpeg_args = vec![
        "-y".to_string(),
        "-ss".to_string(), start_str,
        "-i".to_string(), input_video_path.clone(),
        "-t".to_string(), duration_str,
    ];

    match req.layout_mode.as_str() {
        "vertical_9_16" => {
            // 9:16 vertical layout with blurred background fill
            ffmpeg_args.extend(vec![
                "-filter_complex".to_string(),
                "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]".to_string(),
                "-map".to_string(), "[v]".to_string(),
                "-map".to_string(), "0:a?".to_string(),
                "-c:v".to_string(), "libx264".to_string(),
                "-preset".to_string(), "fast".to_string(),
                "-crf".to_string(), "22".to_string(),
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "192k".to_string(),
            ]);
        }
        "square_1_1" => {
            // 1:1 square crop
            ffmpeg_args.extend(vec![
                "-filter_complex".to_string(),
                "[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080[v]".to_string(),
                "-map".to_string(), "[v]".to_string(),
                "-map".to_string(), "0:a?".to_string(),
                "-c:v".to_string(), "libx264".to_string(),
                "-preset".to_string(), "fast".to_string(),
                "-crf".to_string(), "22".to_string(),
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "192k".to_string(),
            ]);
        }
        _ => {
            // 16:9 landscape or original ratio
            ffmpeg_args.extend(vec![
                "-c:v".to_string(), "libx264".to_string(),
                "-preset".to_string(), "fast".to_string(),
                "-crf".to_string(), "22".to_string(),
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "192k".to_string(),
            ]);
        }
    }

    ffmpeg_args.push(req.output_path.clone());

    println!("Running FFmpeg clip rendering: {} {:?}", ffmpeg, ffmpeg_args);

    let ff_output = ProcessCommand::new(&ffmpeg)
        .args(&ffmpeg_args)
        .output()
        .map_err(|e| format!("FFmpeg failed to execute: {}", e))?;

    if !ff_output.status.success() {
        let err_msg = String::from_utf8_lossy(&ff_output.stderr);
        return Err(format!("Pemotongan video FFmpeg gagal: {}", err_msg.trim()));
    }

    Ok(req.output_path)
}
