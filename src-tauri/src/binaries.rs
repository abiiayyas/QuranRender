use std::path::PathBuf;
use tauri::AppHandle;

#[derive(serde::Serialize)]
pub struct SystemDiagnostics {
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub ytdlp_path: Option<String>,
    pub python_path: Option<String>,
}

pub fn resolve_binary(_app_handle: &AppHandle, name: &str) -> Option<PathBuf> {
    // Priority 1: Check Tauri sidecar bundled with the app
    // Currently, we'll implement sidecar lookup when we actually bundle them.
    // For now, we skip to system PATH.

    // Priority 2: System PATH using `which`
    if let Ok(path) = which::which(name) {
        return Some(path);
    }

    // Priority 3: Hardcoded common locations
    #[cfg(target_os = "windows")]
    let common_paths = vec![
        format!("C:\\Program Files\\{name}\\{name}.exe"),
        format!("C:\\Program Files (x86)\\{name}\\{name}.exe"),
    ];

    #[cfg(not(target_os = "windows"))]
    let common_paths = vec![
        format!("/usr/local/bin/{}", name),
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/bin/{}", name),
    ];

    for path_str in common_paths {
        let p = PathBuf::from(&path_str);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

pub fn get_diagnostics(app_handle: &AppHandle) -> SystemDiagnostics {
    SystemDiagnostics {
        ffmpeg_path: resolve_binary(app_handle, "ffmpeg").map(|p| p.to_string_lossy().to_string()),
        ffprobe_path: resolve_binary(app_handle, "ffprobe").map(|p| p.to_string_lossy().to_string()),
        ytdlp_path: resolve_binary(app_handle, "yt-dlp").map(|p| p.to_string_lossy().to_string()),
        python_path: resolve_binary(app_handle, "python3").or_else(|| resolve_binary(app_handle, "python")).map(|p| p.to_string_lossy().to_string()),
    }
}
