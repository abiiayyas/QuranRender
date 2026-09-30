use crate::binaries::resolve_binary;
use crate::error::AppError;
use super::{SegmentRequest, SegmentationResult};
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn check_and_init_venv(app_handle: &AppHandle) -> Result<PathBuf, AppError> {
    let python_path = resolve_binary(app_handle, "python3")
        .or_else(|| resolve_binary(app_handle, "python"))
        .ok_or_else(|| AppError::new("MISSING_BINARY", "Python 3 is not installed or not in PATH"))?;

    let app_dir = app_handle.path().app_data_dir().map_err(|e| AppError::new("APP_DIR_ERROR", &e.to_string()))?;
    let venv_dir = app_dir.join("ai_env");

    if !venv_dir.exists() {
        // Create venv
        let status = Command::new(&python_path)
            .args(["-m", "venv", venv_dir.to_str().unwrap()])
            .status()?;
        
        if !status.success() {
            return Err(AppError::new("VENV_INIT_FAILED", "Failed to create Python virtual environment"));
        }

        // Install requirements
        let pip_path = if cfg!(target_os = "windows") {
            venv_dir.join("Scripts").join("pip.exe")
        } else {
            venv_dir.join("bin").join("pip")
        };

        let resource_dir = app_handle.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
        let req_path = resource_dir.join("python").join("requirements.txt");
        
        if req_path.exists() {
            let req_status = Command::new(&pip_path)
                .args(["install", "-r", req_path.to_str().unwrap()])
                .status()?;
            
            if !req_status.success() {
                return Err(AppError::new("PIP_INSTALL_FAILED", "Failed to install Python requirements"));
            }
        } else {
            // Fallback direct install for MVP
            let req_status = Command::new(&pip_path)
                .args(["install", "whisper-timestamped", "torch", "torchaudio"])
                .status()?;
            
            if !req_status.success() {
                return Err(AppError::new("PIP_INSTALL_FAILED", "Failed to install fallback requirements"));
            }
        }
    }

    let venv_python = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };

    Ok(venv_python)
}

#[tauri::command]
pub async fn run_alignment(app_handle: AppHandle, req: SegmentRequest) -> Result<SegmentationResult, AppError> {
    let python_path = check_and_init_venv(&app_handle)?;

    let resource_dir = app_handle.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
    let script_path = resource_dir.join("python").join("aligner.py");

    if !script_path.exists() {
        return Err(AppError::new("SCRIPT_NOT_FOUND", "aligner.py not found in resources"));
    }

    let temp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let req_file_path = temp_dir.join(format!("align_req_{}.json", timestamp));
    let req_json = serde_json::to_string(&req)?;
    std::fs::write(&req_file_path, req_json)?;

    let output = Command::new(&python_path)
        .arg(&script_path)
        .arg(&req_file_path)
        .output()?;

    let _ = std::fs::remove_file(&req_file_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::new("ALIGNMENT_FAILED", &stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Find the last line that starts with `{` to avoid pip warnings or python prints
    let json_line = stdout.lines().filter(|l| l.trim().starts_with('{')).last().unwrap_or("");
    
    let result: super::SegmentationResult = serde_json::from_str(json_line)
        .map_err(|e| AppError::new("JSON_PARSE_ERROR", &format!("Failed to parse Python output: {}\nOutput: {}", e, stdout)))?;

    Ok(result)
}
