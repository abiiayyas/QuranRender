//! Allowlist domain jaringan untuk membatasi akses outbound (PRD §8.4, SET-2, B2-15).
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §8.4.

use serde::{Deserialize, Serialize};

/// Daftar domain resmi yang diizinkan untuk komunikasi outbound aplikasi.
pub const DEFAULT_ALLOWED_DOMAINS: &[&str] = &[
    "api.quran.com",
    "quranrender.app",
    "github.com",
    "raw.githubusercontent.com",
    "huggingface.co",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkPolicy {
    pub custom_allowed_domains: Vec<String>,
}

impl NetworkPolicy {
    pub fn new() -> Self {
        Self::default()
    }

    /// Memeriksa apakah URL atau host diizinkan oleh kebijakan jaringan.
    pub fn is_url_allowed(&self, url_or_host: &str) -> bool {
        let host = extract_host(url_or_host);
        if host.is_empty() {
            return false;
        }

        // 1. Cek allowlist bawaan
        for &allowed in DEFAULT_ALLOWED_DOMAINS {
            if host == allowed || host.ends_with(&format!(".{}", allowed)) {
                return true;
            }
        }

        // 2. Cek endpoint kustom pengguna (misal localhost, server LLM sendiri)
        for custom in &self.custom_allowed_domains {
            if &host == custom || host.ends_with(&format!(".{}", custom)) {
                return true;
            }
        }

        false
    }

    /// Memvalidasi URL sebelum pengiriman HTTP. Mengembalikan Err jika ditolak.
    pub fn validate_outbound_url(&self, url: &str) -> Result<(), String> {
        if self.is_url_allowed(url) {
            Ok(())
        } else {
            let host = extract_host(url);
            Err(format!(
                "Akses jaringan ke host '{}' ditolak oleh kebijakan keamanan allowlist.",
                host
            ))
        }
    }
}

fn extract_host(input: &str) -> String {
    let clean = input.trim();
    let without_scheme = if let Some(stripped) = clean.strip_prefix("https://") {
        stripped
    } else if let Some(stripped) = clean.strip_prefix("http://") {
        stripped
    } else {
        clean
    };

    // Ambil bagian sebelum slash atau port
    without_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_allowlist_permits_official_domains() {
        let policy = NetworkPolicy::new();

        assert!(policy.is_url_allowed("https://api.quran.com/api/v4/quran/translations/20"));
        assert!(policy.is_url_allowed("https://quranrender.app/updates/stable.json"));
        assert!(policy.is_url_allowed("https://huggingface.co/models/alignment"));
        assert!(policy.is_url_allowed("https://raw.githubusercontent.com/QuranRender/data/main"));
    }

    #[test]
    fn test_allowlist_blocks_unauthorized_domains() {
        let policy = NetworkPolicy::new();

        assert!(!policy.is_url_allowed("https://google-analytics.com/collect"));
        assert!(!policy.is_url_allowed("https://adservice.google.com/ads"));
        assert!(!policy.is_url_allowed("https://malicious-telemetry.com"));
        assert!(policy
            .validate_outbound_url("https://unauthorized.tracker.org")
            .is_err());
    }

    #[test]
    fn test_custom_user_endpoints_permitted() {
        let mut policy = NetworkPolicy::new();
        policy.custom_allowed_domains.push("localhost".into());
        policy.custom_allowed_domains.push("my-llm.internal".into());

        assert!(policy.is_url_allowed("http://localhost:11434/api/generate"));
        assert!(policy.is_url_allowed("https://my-llm.internal/v1/chat/completions"));
    }
}
