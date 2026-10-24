//! Klien HTTP tunggal untuk adapter jaringan (01_TECHNICAL_HANDOFF §8.4): setiap permintaan diperiksa
//! terhadap allowlist domain sebelum dikirim, redirect tidak diikuti (agar tidak bisa keluar dari
//! allowlist), dan galat dipetakan ke pesan awam berbahasa Indonesia.
//!
//! Transport dibuat sebagai trait agar adapter (Quran.com, AI trim) dapat diuji tanpa jaringan.

use crate::allowlist::NetworkPolicy;
use std::time::Duration;

/// Batas ukuran badan respons (edisi terjemahan lengkap ±1–5 MB; beberapa edisi bertafsir lebih besar).
const MAX_BODY_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    /// Tidak ada koneksi / host tidak dapat dihubungi / waktu habis.
    Offline(String),
    /// URL ditolak allowlist atau tidak aman.
    Blocked(String),
    /// Server membalas status selain 2xx.
    Status { code: u16, body: String },
    /// Galat lain (protokol, TLS, badan respons).
    Other(String),
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NetError::Offline(host) => write!(
                f,
                "Tidak dapat terhubung ke {host}. Periksa koneksi internet lalu coba lagi."
            ),
            NetError::Blocked(msg) => write!(f, "{msg}"),
            NetError::Status { code, .. } => match code {
                401 | 403 => write!(
                    f,
                    "Server menolak akses (kode {code}). Periksa kunci API atau izin akun."
                ),
                404 => write!(f, "Data tidak ditemukan di server (kode 404)."),
                429 => write!(
                    f,
                    "Server sedang membatasi permintaan (kode 429). Tunggu sebentar lalu coba lagi."
                ),
                500..=599 => write!(
                    f,
                    "Server sedang bermasalah (kode {code}). Coba lagi nanti."
                ),
                _ => write!(f, "Server membalas dengan kode {code}."),
            },
            NetError::Other(msg) => write!(f, "Gagal berkomunikasi dengan server: {msg}"),
        }
    }
}

impl std::error::Error for NetError {}

/// Transport HTTP minimal yang dipakai adapter.
pub trait HttpTransport: Send + Sync {
    /// GET dan kembalikan badan respons sebagai teks (hanya status 2xx).
    fn get_text(&self, url: &str) -> Result<String, NetError>;
    /// POST JSON (opsional `Authorization: Bearer`) dan kembalikan badan respons (hanya status 2xx).
    fn post_json(
        &self,
        url: &str,
        bearer: Option<&str>,
        body: &serde_json::Value,
    ) -> Result<String, NetError>;
}

/// Transport nyata berbasis `ureq` (rustls) dengan allowlist.
#[derive(Debug)]
pub struct UreqTransport {
    policy: NetworkPolicy,
    agent: ureq::Agent,
}

impl UreqTransport {
    pub fn new(policy: NetworkPolicy, timeout: Duration) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .timeout_connect(Some(Duration::from_secs(15)))
            .http_status_as_error(false)
            .max_redirects(0)
            .user_agent(concat!("QuranRender/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        Self { policy, agent }
    }

    fn check(&self, url: &str) -> Result<(), NetError> {
        let lower = url.trim().to_ascii_lowercase();
        if !lower.starts_with("https://") && !lower.starts_with("http://") {
            return Err(NetError::Blocked(format!(
                "Alamat '{url}' tidak valid (harus diawali https://)."
            )));
        }
        self.policy
            .validate_outbound_url(url)
            .map_err(NetError::Blocked)
    }

    fn finish(
        url: &str,
        result: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<String, NetError> {
        let mut resp = result.map_err(|e| map_ureq_error(url, e))?;
        let code = resp.status().as_u16();
        let body = resp
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES)
            .read_to_string()
            .map_err(|e| map_ureq_error(url, e))?;
        if (200..300).contains(&code) {
            Ok(body)
        } else {
            Err(NetError::Status { code, body })
        }
    }
}

impl HttpTransport for UreqTransport {
    fn get_text(&self, url: &str) -> Result<String, NetError> {
        self.check(url)?;
        Self::finish(url, self.agent.get(url).call())
    }

    fn post_json(
        &self,
        url: &str,
        bearer: Option<&str>,
        body: &serde_json::Value,
    ) -> Result<String, NetError> {
        self.check(url)?;
        let mut req = self.agent.post(url).header("Accept", "application/json");
        if let Some(token) = bearer {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        Self::finish(url, req.send_json(body))
    }
}

fn map_ureq_error(url: &str, e: ureq::Error) -> NetError {
    let host = crate::allowlist::host_of(url);
    match e {
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed | ureq::Error::Timeout(_) => {
            NetError::Offline(host)
        }
        ureq::Error::Io(io) => match io.kind() {
            std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::TimedOut
            | std::io::ErrorKind::AddrNotAvailable => NetError::Offline(host),
            _ => NetError::Other(io.to_string()),
        },
        ureq::Error::StatusCode(code) => NetError::Status {
            code,
            body: String::new(),
        },
        ureq::Error::TooManyRedirects | ureq::Error::RedirectFailed => NetError::Blocked(format!(
            "Server {host} mengalihkan permintaan ke alamat lain; pengalihan tidak diizinkan demi keamanan."
        )),
        other => NetError::Other(other.to_string()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Server HTTP satu-permintaan di 127.0.0.1 yang membalas `status` + `body`.
    fn one_shot_server(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 64 * 1024];
            let mut req = Vec::new();
            // Baca header + badan (Content-Length) secukupnya.
            loop {
                let n = s.read(&mut buf).unwrap();
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req).to_string();
                if let Some(pos) = text.find("\r\n\r\n") {
                    let len = text
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if req.len() >= pos + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let resp = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(resp.as_bytes()).unwrap();
            String::from_utf8_lossy(&req).to_string()
        });
        (format!("http://127.0.0.1:{}", addr.port()), handle)
    }

    fn local_policy() -> NetworkPolicy {
        let mut p = NetworkPolicy::new();
        p.custom_allowed_domains.push("127.0.0.1".into());
        p
    }

    #[test]
    fn post_json_sends_bearer_and_returns_body() {
        let (base, h) = one_shot_server("200 OK", r#"{"ok":true}"#);
        let t = UreqTransport::new(local_policy(), Duration::from_secs(10));
        let body = t
            .post_json(
                &format!("{base}/v1/chat/completions"),
                Some("sk-uji"),
                &serde_json::json!({"a": 1}),
            )
            .unwrap();
        assert_eq!(body, r#"{"ok":true}"#);
        let req = h.join().unwrap();
        assert!(req.starts_with("POST /v1/chat/completions"), "{req}");
        assert!(req.contains("authorization: Bearer sk-uji"), "{req}");
        let body_sent = &req[req.find("\r\n\r\n").unwrap() + 4..];
        let sent: serde_json::Value = serde_json::from_str(body_sent).unwrap();
        assert_eq!(sent, serde_json::json!({"a": 1}));
    }

    #[test]
    fn non_2xx_status_is_an_error_with_plain_message() {
        let (base, h) = one_shot_server("401 Unauthorized", r#"{"error":"bad key"}"#);
        let t = UreqTransport::new(local_policy(), Duration::from_secs(10));
        let err = t.get_text(&format!("{base}/x")).unwrap_err();
        h.join().unwrap();
        assert!(matches!(err, NetError::Status { code: 401, .. }), "{err:?}");
        assert!(err.to_string().contains("kunci API"), "{err}");
    }

    #[test]
    fn hosts_outside_allowlist_are_rejected_before_sending() {
        let t = UreqTransport::new(NetworkPolicy::new(), Duration::from_secs(1));
        let err = t
            .get_text("https://tracker.example.org/collect")
            .unwrap_err();
        assert!(matches!(err, NetError::Blocked(_)), "{err:?}");
        let err = t.get_text("ftp://api.quran.com/x").unwrap_err();
        assert!(matches!(err, NetError::Blocked(_)), "{err:?}");
    }

    #[test]
    fn unreachable_host_maps_to_offline() {
        // Port 1 di loopback hampir pasti tertutup → koneksi ditolak.
        let t = UreqTransport::new(local_policy(), Duration::from_secs(5));
        let err = t.get_text("http://127.0.0.1:1/x").unwrap_err();
        assert!(matches!(err, NetError::Offline(_)), "{err:?}");
        assert!(err.to_string().contains("koneksi internet"), "{err}");
    }
}
