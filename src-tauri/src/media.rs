use crate::binaries::resolve_binary;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::AppHandle;

#[derive(Serialize, Deserialize)]
pub struct MediaInfo {
    pub duration: f32,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeStream {
    width: Option<u32>,
    height: Option<u32>,
}

#[tauri::command]
pub fn get_media_info(app_handle: AppHandle, path: String) -> Result<MediaInfo, AppError> {
    let ffprobe_path = resolve_binary(&app_handle, "ffprobe")
        .ok_or_else(|| AppError::new("MISSING_BINARY", "ffprobe not found"))?;

    let output = Command::new(&ffprobe_path)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| AppError::new("IO_ERROR", &format!("Failed to run ffprobe: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::new("FFPROBE_ERROR", "ffprobe failed to probe file"));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)?;

    let duration_str = parsed.format.and_then(|f| f.duration).unwrap_or_default();
    let duration: f32 = duration_str.parse().unwrap_or(0.0);

    let mut width = None;
    let mut height = None;
    if let Some(streams) = parsed.streams {
        for s in streams {
            if s.width.is_some() && s.height.is_some() {
                width = s.width;
                height = s.height;
                break;
            }
        }
    }

    Ok(MediaInfo {
        duration,
        width,
        height,
    })
}

#[tauri::command]
pub fn cut_audio(
    app_handle: AppHandle,
    input: String,
    output: String,
    start: f32,
    end: f32,
) -> Result<(), AppError> {
    let ffmpeg_path = resolve_binary(&app_handle, "ffmpeg")
        .ok_or_else(|| AppError::new("MISSING_BINARY", "ffmpeg not found"))?;

    let out = Command::new(&ffmpeg_path)
        .args([
            "-y",
            "-i",
            &input,
            "-ss",
            &start.to_string(),
            "-to",
            &end.to_string(),
            "-c",
            "copy",
            &output,
        ])
        .output()
        .map_err(|e| AppError::new("IO_ERROR", &format!("Failed to run ffmpeg: {}", e)))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::new("FFMPEG_ERROR", &stderr));
    }
    Ok(())
}
