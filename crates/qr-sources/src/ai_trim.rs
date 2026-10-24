//! Pemotongan terjemahan dengan AI lewat endpoint OpenAI-compatible (`POST {endpoint}/chat/completions`).
//! Model menerima kata Arab segmen, teks Arab ayat utuh, dan terjemahan ayat utuh, lalu diminta
//! mengembalikan JSON `{"fragment": "..."}` berisi potongan terjemahan untuk bagian itu saja.
//! Hasilnya selalu berstatus "dipotong AI" (perlu ditinjau pengguna); tidak pernah dianggap final.

use crate::http::HttpTransport;
use serde_json::{json, Value};

/// Endpoint bawaan bila pengguna belum mengatur `ai.endpoint`.
pub const DEFAULT_AI_ENDPOINT: &str = "https://api.openai.com/v1";
/// Model bawaan bila pengguna belum mengatur `ai.model`.
pub const DEFAULT_AI_MODEL: &str = "gpt-4o-mini";

#[derive(Debug, Clone)]
pub struct AiConfig {
    pub endpoint: String,
    pub model: String,
    /// `None` hanya untuk server lokal tanpa autentikasi (mis. `http://localhost`).
    pub api_key: Option<String>,
}

/// Bahan prompt untuk satu segmen.
#[derive(Debug, Clone)]
pub struct AiTrimInput<'a> {
    pub surah: u32,
    pub ayah: u32,
    /// Rentang kata segmen (1-based inklusif) dan jumlah kata ayat.
    pub word_range: (u32, u32),
    pub total_words: u32,
    pub arabic_segment: &'a str,
    pub arabic_full: &'a str,
    pub translation_full: &'a str,
    /// Kode bahasa terjemahan (mis. `id`, `en`).
    pub language: &'a str,
}

/// URL `chat/completions` dari endpoint dasar (boleh sudah berakhiran `/chat/completions`).
pub fn chat_completions_url(endpoint: &str) -> String {
    let base = endpoint.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

const SYSTEM_PROMPT: &str = "You align Quran translations to partial recitation segments. \
You receive the Arabic words of ONE segment of an ayah, the full Arabic ayah, and the full translation \
of that ayah. Return ONLY a JSON object {\"fragment\": \"...\"} whose value is the part of the given \
translation that corresponds to the segment's Arabic words. Copy wording verbatim from the given \
translation (keep its language, spelling and punctuation); do not paraphrase, add commentary, or \
translate yourself. Prefer cutting at natural phrase boundaries. Never return an empty fragment.";

/// Badan permintaan chat completions (deterministik: `temperature` 0, keluaran JSON).
pub fn build_request_body(model: &str, input: &AiTrimInput<'_>) -> Value {
    let user = json!({
        "verse": format!("{}:{}", input.surah, input.ayah),
        "segment_words": format!("{}-{} of {}", input.word_range.0, input.word_range.1, input.total_words),
        "segment_arabic": input.arabic_segment,
        "full_ayah_arabic": input.arabic_full,
        "full_translation": input.translation_full,
        "translation_language": input.language,
    });
    json!({
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user.to_string()},
        ],
    })
}

/// Mengambil `fragment` dari respons chat completions. Konten boleh dibungkus pagar kode Markdown.
pub fn parse_ai_response(body: &str, translation_full: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|_| "Respons layanan AI tidak dapat dibaca (bukan JSON).".to_string())?;
    if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
        return Err(format!("Layanan AI menolak permintaan: {msg}"));
    }
    let content = v
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "Respons layanan AI tidak berisi jawaban.".to_string())?;
    let (start, end) = (content.find('{'), content.rfind('}'));
    let obj: Value = match (start, end) {
        (Some(s), Some(e)) if e > s => serde_json::from_str(&content[s..=e])
            .map_err(|_| "Jawaban AI bukan JSON yang valid.".to_string())?,
        _ => return Err("Jawaban AI bukan JSON yang valid.".to_string()),
    };
    let fragment = obj
        .get("fragment")
        .and_then(Value::as_str)
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    if fragment.is_empty() {
        return Err("Jawaban AI tidak memuat potongan terjemahan.".to_string());
    }
    // Pengaman: potongan yang jauh lebih panjang dari terjemahan utuh pasti bukan potongan.
    if fragment.chars().count() > translation_full.chars().count() + 40 {
        return Err("Jawaban AI lebih panjang dari terjemahan ayat; hasil diabaikan.".to_string());
    }
    Ok(fragment)
}

/// Memanggil layanan AI untuk satu segmen dan mengembalikan potongan terjemahan.
pub fn ai_trim(
    http: &dyn HttpTransport,
    cfg: &AiConfig,
    input: &AiTrimInput<'_>,
) -> Result<String, String> {
    let url = chat_completions_url(&cfg.endpoint);
    let body = build_request_body(&cfg.model, input);
    let resp = http
        .post_json(&url, cfg.api_key.as_deref(), &body)
        .map_err(|e| e.to_string())?;
    parse_ai_response(&resp, input.translation_full)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::http::NetError;
    use std::sync::Mutex;

    struct FakeAi {
        reply: Result<String, NetError>,
        seen: Mutex<Vec<(String, Option<String>, Value)>>,
    }

    impl HttpTransport for FakeAi {
        fn get_text(&self, _: &str) -> Result<String, NetError> {
            unreachable!()
        }
        fn post_json(
            &self,
            url: &str,
            bearer: Option<&str>,
            body: &Value,
        ) -> Result<String, NetError> {
            self.seen
                .lock()
                .unwrap()
                .push((url.into(), bearer.map(str::to_string), body.clone()));
            self.reply.clone()
        }
    }

    fn input() -> AiTrimInput<'static> {
        AiTrimInput {
            surah: 67,
            ayah: 2,
            word_range: (1, 4),
            total_words: 13,
            arabic_segment: "ٱلَّذِى خَلَقَ ٱلْمَوْتَ وَٱلْحَيَوٰةَ",
            arabic_full: "ٱلَّذِى خَلَقَ ٱلْمَوْتَ وَٱلْحَيَوٰةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا ۚ وَهُوَ ٱلْعَزِيزُ ٱلْغَفُورُ",
            translation_full: "[He] who created death and life to test you [as to] which of you is best in deed - and He is the Exalted in Might, the Forgiving -",
            language: "en",
        }
    }

    fn completion(content: &str) -> String {
        json!({"choices":[{"index":0,"message":{"role":"assistant","content":content}}]})
            .to_string()
    }

    #[test]
    fn url_is_built_from_base_endpoint() {
        assert_eq!(
            chat_completions_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://localhost:11434/v1/chat/completions"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn request_carries_model_key_and_all_prompt_parts() {
        let fake = FakeAi {
            reply: Ok(completion(
                r#"{"fragment":"[He] who created death and life"}"#,
            )),
            seen: Mutex::new(vec![]),
        };
        let cfg = AiConfig {
            endpoint: "https://llm.example.net/v1".into(),
            model: "model-uji".into(),
            api_key: Some("sk-uji".into()),
        };
        let out = ai_trim(&fake, &cfg, &input()).unwrap();
        assert_eq!(out, "[He] who created death and life");
        let seen = fake.seen.lock().unwrap();
        let (url, bearer, body) = &seen[0];
        assert_eq!(url, "https://llm.example.net/v1/chat/completions");
        assert_eq!(bearer.as_deref(), Some("sk-uji"));
        assert_eq!(body["model"], "model-uji");
        assert_eq!(body["response_format"]["type"], "json_object");
        let user = body["messages"][1]["content"].as_str().unwrap();
        for part in [
            "67:2",
            "1-4 of 13",
            input().arabic_segment,
            "which of you is best",
            "\"en\"",
        ] {
            assert!(user.contains(part), "prompt tanpa '{part}': {user}");
        }
    }

    #[test]
    fn fenced_json_content_is_accepted_and_whitespace_normalized() {
        let body =
            completion("```json\n{\"fragment\": \"  [He] who created\\n death and life \"}\n```");
        assert_eq!(
            parse_ai_response(&body, input().translation_full).unwrap(),
            "[He] who created death and life"
        );
    }

    #[test]
    fn malformed_or_empty_answers_are_plain_errors() {
        let full = input().translation_full;
        let cases = [
            ("bukan json".to_string(), "bukan JSON"),
            (json!({"choices": []}).to_string(), "tidak berisi jawaban"),
            (completion("maaf, saya tidak bisa"), "bukan JSON"),
            (completion(r#"{"fragment":"   "}"#), "tidak memuat"),
            (completion(r#"{"other":"x"}"#), "tidak memuat"),
            (
                json!({"error": {"message": "model not found"}}).to_string(),
                "model not found",
            ),
            (
                completion(&json!({"fragment": full.repeat(3)}).to_string()),
                "lebih panjang",
            ),
        ];
        for (body, needle) in cases {
            let err = parse_ai_response(&body, full).unwrap_err();
            assert!(err.contains(needle), "{needle}: {err}");
        }
    }

    #[test]
    fn rejected_key_surfaces_plain_message() {
        let fake = FakeAi {
            reply: Err(NetError::Status {
                code: 401,
                body: "{}".into(),
            }),
            seen: Mutex::new(vec![]),
        };
        let cfg = AiConfig {
            endpoint: DEFAULT_AI_ENDPOINT.into(),
            model: DEFAULT_AI_MODEL.into(),
            api_key: Some("salah".into()),
        };
        let err = ai_trim(&fake, &cfg, &input()).unwrap_err();
        assert!(err.contains("kunci API"), "{err}");
    }
}
