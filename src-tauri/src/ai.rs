use crate::db::AppState;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiSettings {
    pub provider: String,
    pub api_key: String,
    pub image_provider: String,
    pub image_api_key: String,
    pub tts_provider: String,
    pub tts_api_key: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TafsirResponse {
    pub id: u32,
    pub surah: u32,
    pub ayah: u32,
    pub text: String,
}

fn get_ai_settings(state: &State<'_, AppState>) -> Result<AiSettings, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT key, value FROM app_settings").map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    }).map_err(|e| e.to_string())?;

    let mut settings = AiSettings {
        provider: "openai".to_string(),
        api_key: "".to_string(),
        image_provider: "openai".to_string(),
        image_api_key: "".to_string(),
        tts_provider: "openai".to_string(),
        tts_api_key: "".to_string(),
    };

    for row in rows {
        if let Ok((key, value)) = row {
            match key.as_str() {
                "ai_provider" => settings.provider = value,
                "ai_api_key" => settings.api_key = value,
                "ai_image_provider" => settings.image_provider = value,
                "ai_image_api_key" => settings.image_api_key = value,
                "ai_tts_provider" => settings.tts_provider = value,
                "ai_tts_api_key" => settings.tts_api_key = value,
                _ => {}
            }
        }
    }

    Ok(settings)
}

#[tauri::command]
pub async fn fetch_tafsir(state: State<'_, AppState>, surah: u32, ayah: u32, tafsir_id: u32) -> Result<String, String> {
    // Check cache
    {
        let db = state.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT raw_text FROM tafsir_cache WHERE surah = ?1 AND ayah = ?2 AND tafsir_id = ?3").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([surah, ayah, tafsir_id]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(row.get(0).map_err(|e| e.to_string())?);
        }
    }

    let url = format!("https://api.quran.com/api/v4/tafsirs/{}/by_ayah/{}:{}", tafsir_id, surah, ayah);
    let client = Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err(format!("Failed to fetch tafsir: {}", res.status()));
    }

    let json_data: Value = res.json().await.map_err(|e| e.to_string())?;
    let text = json_data["tafsir"]["text"].as_str().unwrap_or("").to_string();

    // Remove HTML tags for cleaner raw text
    let clean_text = text.replace("<p>", "").replace("</p>", "\n").replace("<h2>", "").replace("</h2>", "\n").replace("<br>", "\n").replace("<b>", "").replace("</b>", "").replace("<i>", "").replace("</i>", "");

    // Save to cache
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "INSERT OR REPLACE INTO tafsir_cache (surah, ayah, tafsir_id, raw_text) VALUES (?1, ?2, ?3, ?4)",
            (surah, ayah, tafsir_id, &clean_text),
        );
    }

    Ok(clean_text)
}

#[tauri::command]
pub async fn ai_summarize_tafsir(state: State<'_, AppState>, raw_text: String, language: String) -> Result<String, String> {
    let settings = get_ai_settings(&state)?;
    
    if settings.api_key.is_empty() {
        return Err("AI API Key is not set in settings".to_string());
    }

    let hash = md5::compute(&raw_text);
    let cache_key_str = format!("summary_{}_{}_{:x}", settings.provider, language, hash);

    // Check cache
    {
        let db = state.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT result_text FROM ai_cache WHERE cache_key = ?1").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([&cache_key_str]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(row.get(0).map_err(|e| e.to_string())?);
        }
    }

    let lang_str = if language == "id" { "Bahasa Indonesia" } else { "English" };
    let system_prompt = format!("You are a helpful assistant for a Quran app. Summarize the following tafsir (interpretation) text into a concise 1-2 sentences maximum, suitable for a short video infographic text overlay. Output the result in {}. Do not mention the name of the tafsir book or author, just the essence of the meaning. Keep it engaging and easy to understand for general audience.", lang_str);
    
    let result = call_ai_completion(&state, &system_prompt, &raw_text).await?;

    // Save to cache
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "INSERT OR REPLACE INTO ai_cache (cache_key, result_text, provider) VALUES (?1, ?2, ?3)",
            (&cache_key_str, &result, &settings.provider),
        );
    }

    Ok(result)
}

pub async fn call_ai_completion(state: &State<'_, AppState>, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    let settings = get_ai_settings(state)?;
    if settings.api_key.is_empty() {
        return Err("AI API Key is not set in settings".to_string());
    }

    match settings.provider.as_str() {
        "openai" => call_openai_chat(&settings.api_key, system_prompt, user_prompt).await,
        "gemini" => call_gemini_chat(&settings.api_key, system_prompt, user_prompt).await,
        "claude" => call_claude_chat(&settings.api_key, system_prompt, user_prompt).await,
        "deepseek" => call_deepseek_chat(&settings.api_key, system_prompt, user_prompt).await,
        _ => Err("Unsupported AI provider".to_string()),
    }
}

#[tauri::command]
pub async fn ai_generate_image(app: AppHandle, state: State<'_, AppState>, context_text: String) -> Result<String, String> {
    let settings = get_ai_settings(&state)?;
    
    if settings.image_api_key.is_empty() && (settings.image_provider != "openai" || settings.api_key.is_empty()) {
        return Err("AI Image API Key is not set".to_string());
    }

    let hash = md5::compute(&context_text);
    let cache_key_str = format!("img_{}_{:x}", settings.image_provider, hash);

    // Check cache
    {
        let db = state.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT image_path FROM ai_image_cache WHERE cache_key = ?1").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([&cache_key_str]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let path: String = row.get(0).map_err(|e| e.to_string())?;
            if std::path::Path::new(&path).exists() {
                return Ok(path);
            }
        }
    }

    // Step 1: Generate prompt using Text AI
    let prompt_system = "You are an assistant for a Quran visualization app. Based on the following verse interpretation, create ONE concise English prompt for an AI image generator (like DALL-E). The image should be cinematic, atmospheric, and suitable as a video background. RULES: Only describe nature, cosmos, abstract concepts, cinematic lighting, environments, or inanimate objects. NEVER depict humans, animals with faces, prophets, angels, or any religious figures. Style: photorealistic, 16:9 aspect ratio, moody cinematic lighting. Return ONLY the prompt string.";
    
    // Fallback to text provider if image provider is not for text
    let text_api_key = if settings.api_key.is_empty() { &settings.image_api_key } else { &settings.api_key };
    let text_provider: &str = if settings.api_key.is_empty() { "openai" } else { &settings.provider }; // Default to openai if text not set
    
    let generated_prompt = match text_provider {
        "gemini" => call_gemini_chat(text_api_key, prompt_system, &context_text).await?,
        "claude" => call_claude_chat(text_api_key, prompt_system, &context_text).await?,
        "deepseek" => call_deepseek_chat(text_api_key, prompt_system, &context_text).await?,
        _ => call_openai_chat(text_api_key, prompt_system, &context_text).await?,
    };

    println!("Generated image prompt: {}", generated_prompt);

    // Step 2: Generate Image
    let api_key_to_use = if settings.image_api_key.is_empty() { &settings.api_key } else { &settings.image_api_key };
    
    let image_url = match settings.image_provider.as_str() {
        "stability" => call_stability_image(api_key_to_use, &generated_prompt).await?,
        _ => call_dalle_image(api_key_to_use, &generated_prompt).await?,
    };

    // Step 3: Download and save
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_dir.join("image_cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    
    let file_name = format!("{}.png", cache_key_str);
    let file_path = cache_dir.join(&file_name);
    
    // For stability which returns base64 directly (we'll adapt it in the function to return base64 if needed, or save directly)
    if image_url.starts_with("data:image") || !image_url.starts_with("http") {
         // It's base64 (Stability returns base64)
         let b64 = if image_url.starts_with("data:") {
             image_url.split(',').nth(1).unwrap_or("")
         } else {
             &image_url
         };
         let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).map_err(|e| e.to_string())?;
         fs::write(&file_path, decoded).map_err(|e| e.to_string())?;
    } else {
        // Download from URL (DALL-E)
        let client = Client::new();
        let resp = client.get(&image_url).send().await.map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&file_path, bytes).map_err(|e| e.to_string())?;
    }

    let path_str = file_path.to_string_lossy().to_string();

    // Save to cache db
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "INSERT OR REPLACE INTO ai_image_cache (cache_key, image_path, prompt_used, provider) VALUES (?1, ?2, ?3, ?4)",
            (&cache_key_str, &path_str, &generated_prompt, &settings.image_provider),
        );
    }

    Ok(path_str)
}

#[tauri::command]
pub async fn ai_generate_audio(app: AppHandle, state: State<'_, AppState>, text: String) -> Result<String, String> {
    let settings = get_ai_settings(&state)?;
    
    if settings.tts_api_key.is_empty() && (settings.tts_provider != "openai" || settings.api_key.is_empty()) {
        return Err("AI TTS API Key is not set".to_string());
    }

    let hash = md5::compute(&text);
    let cache_key_str = format!("tts_{}_{:x}", settings.tts_provider, hash);

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_dir.join("audio_cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    
    let file_name = format!("{}.mp3", cache_key_str);
    let file_path = cache_dir.join(&file_name);
    
    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }

    let api_key_to_use = if settings.tts_api_key.is_empty() { &settings.api_key } else { &settings.tts_api_key };
    
    let audio_bytes = match settings.tts_provider.as_str() {
        "elevenlabs" => call_elevenlabs_tts(api_key_to_use, &text).await?,
        _ => call_openai_tts(api_key_to_use, &text).await?,
    };

    fs::write(&file_path, audio_bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

// --- API Implementation Helpers ---

async fn call_openai_chat(api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let client = Client::new();
    let res = client.post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&json!({
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        }))
        .send().await.map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err) = data.get("error") {
        return Err(err["message"].as_str().unwrap_or("OpenAI API error").to_string());
    }

    Ok(data["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
}

async fn call_gemini_chat(api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let client = Client::new();
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}", api_key);
    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&json!({
            "systemInstruction": {
                "parts": [{"text": system}]
            },
            "contents": [{
                "parts": [{"text": user}]
            }]
        }))
        .send().await.map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err) = data.get("error") {
        return Err(err["message"].as_str().unwrap_or("Gemini API error").to_string());
    }

    Ok(data["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap_or("").to_string())
}

async fn call_claude_chat(api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let client = Client::new();
    let res = client.post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 1024,
            "system": system,
            "messages": [
                {"role": "user", "content": user}
            ]
        }))
        .send().await.map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err) = data.get("error") {
        return Err(err["message"].as_str().unwrap_or("Claude API error").to_string());
    }

    Ok(data["content"][0]["text"].as_str().unwrap_or("").to_string())
}

async fn call_deepseek_chat(api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let client = Client::new();
    let res = client.post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&json!({
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        }))
        .send().await.map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err) = data.get("error") {
        return Err(err["message"].as_str().unwrap_or("DeepSeek API error").to_string());
    }

    Ok(data["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
}

async fn call_dalle_image(api_key: &str, prompt: &str) -> Result<String, String> {
    let client = Client::new();
    let res = client.post("https://api.openai.com/v1/images/generations")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&json!({
            "model": "dall-e-3",
            "prompt": prompt,
            "n": 1,
            "size": "1024x1792" // Vertical-ish or we can do 1792x1024 for landscape
        }))
        .send().await.map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err) = data.get("error") {
        return Err(err["message"].as_str().unwrap_or("DALL-E API error").to_string());
    }

    Ok(data["data"][0]["url"].as_str().unwrap_or("").to_string())
}

async fn call_stability_image(api_key: &str, prompt: &str) -> Result<String, String> {
    let client = Client::new();
    let res = client.post("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&json!({
            "text_prompts": [{"text": prompt}],
            "cfg_scale": 7,
            "height": 1024,
            "width": 1024,
            "samples": 1,
            "steps": 30
        }))
        .send().await.map_err(|e| e.to_string())?;

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(msg) = data.get("message") {
        return Err(msg.as_str().unwrap_or("Stability API error").to_string());
    }

    Ok(data["artifacts"][0]["base64"].as_str().unwrap_or("").to_string())
}

async fn call_openai_tts(api_key: &str, text: &str) -> Result<Vec<u8>, String> {
    let client = Client::new();
    let res = client.post("https://api.openai.com/v1/audio/speech")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&json!({
            "model": "tts-1",
            "input": text,
            "voice": "onyx" // Deep cinematic voice
        }))
        .send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("OpenAI TTS Error: {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

async fn call_elevenlabs_tts(api_key: &str, text: &str) -> Result<Vec<u8>, String> {
    let client = Client::new();
    // Default to a known voice ID if not specified, let's use a standard one (e.g., Marcus)
    let voice_id = "pNInz6obpgDQGcFmaJgB"; 
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{}", voice_id);
    let res = client.post(&url)
        .header("xi-api-key", api_key)
        .json(&json!({
            "text": text,
            "model_id": "eleven_multilingual_v2"
        }))
        .send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("ElevenLabs TTS Error: {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}
