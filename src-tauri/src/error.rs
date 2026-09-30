use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(ref details) = self.details {
            write!(f, "[{}]: {} - {}", self.code, self.message, details)
        } else {
            write!(f, "[{}]: {}", self.code, self.message)
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError {
            code: "IO_ERROR".to_string(),
            message: err.to_string(),
            details: None,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError {
            code: "DB_ERROR".to_string(),
            message: err.to_string(),
            details: None,
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError {
            code: "JSON_ERROR".to_string(),
            message: err.to_string(),
            details: None,
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError {
            code: "NETWORK_ERROR".to_string(),
            message: err.to_string(),
            details: None,
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError {
            code: "TAURI_ERROR".to_string(),
            message: err.to_string(),
            details: None,
        }
    }
}

impl From<String> for AppError {
    fn from(err: String) -> Self {
        AppError {
            code: "UNKNOWN_ERROR".to_string(),
            message: err,
            details: None,
        }
    }
}

impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        AppError {
            code: code.to_string(),
            message: message.to_string(),
            details: None,
        }
    }
    
    pub fn with_details(mut self, details: &str) -> Self {
        self.details = Some(details.to_string());
        self
    }
}
