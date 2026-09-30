use crate::db::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub settings: String,
    pub created_at: String,
}

#[tauri::command]
pub fn get_projects(state: State<'_, AppState>) -> Result<Vec<Project>, crate::error::AppError> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT id, name, settings, created_at FROM projects ORDER BY created_at DESC")?;
    
    let projects_iter = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            settings: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    let mut projects = Vec::new();
    for p in projects_iter {
        projects.push(p?);
    }
    
    Ok(projects)
}

#[tauri::command]
pub fn save_project(state: State<'_, AppState>, id: String, name: String, settings: String) -> Result<(), crate::error::AppError> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO projects (id, name, settings) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, settings=excluded.settings",
        (&id, &name, &settings),
    )?;
    Ok(())
}

#[tauri::command]
pub fn save_app_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), crate::error::AppError> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        (&key, &value),
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_app_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, crate::error::AppError> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QuranWord {
    pub position: u32,
    pub arabic: String,
    pub start_ms: Option<u32>,
    pub end_ms: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QuranAyah {
    pub surah: u32,
    pub ayah: u32,
    pub arabic: String,
    pub translation: String,
    pub translation_en: Option<String>,
    pub words: Vec<QuranWord>,
}

#[tauri::command]
pub fn get_quran_ayah(state: State<'_, AppState>, surah: u32, ayah: u32) -> Result<Option<QuranAyah>, crate::error::AppError> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT arabic, translation, words_json, translation_en FROM quran_cache WHERE surah = ?1 AND ayah = ?2")?;
    let mut rows = stmt.query([surah, ayah])?;

    if let Some(row) = rows.next()? {
        let words_str: Option<String> = row.get(2).unwrap_or(None);
        let words = if let Some(s) = words_str {
            serde_json::from_str(&s).unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(Some(QuranAyah {
            surah,
            ayah,
            arabic: row.get(0)?,
            translation: row.get(1)?,
            translation_en: row.get(3).unwrap_or(None),
            words,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_quran_ayah(state: State<'_, AppState>, ayah: QuranAyah) -> Result<(), crate::error::AppError> {
    let db = state.db.lock().unwrap();
    let words_json = serde_json::to_string(&ayah.words).unwrap_or_default();
    db.execute(
        "INSERT OR REPLACE INTO quran_cache (surah, ayah, arabic, translation, words_json, translation_en) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (ayah.surah, ayah.ayah, &ayah.arabic, &ayah.translation, &words_json, &ayah.translation_en),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn fetch_quran_verses(state: State<'_, AppState>, surah: u32, ayat_start: u32, ayat_end: u32, reciter_id: u32) -> Result<Vec<QuranAyah>, crate::error::AppError> {
    // Check cache first (skipping cache for now to ensure we get words)
    // We can re-enable cache later if words_json is populated

    #[derive(Deserialize)]
    struct TranslationObj {
        resource_id: u32,
        text: String,
    }
    #[derive(Deserialize)]
    struct AudioSegment {
        segments: Option<Vec<Vec<u32>>>, // [word_index, something, start_ms, end_ms]
    }
    #[derive(Deserialize)]
    struct WordObj {
        position: u32,
        code_v1: Option<String>, 
        text: Option<String>,
        text_uthmani: Option<String>,
    }
    #[derive(Deserialize)]
    struct VerseObj {
        verse_number: u32,
        text_uthmani: String,
        translations: Vec<TranslationObj>,
        words: Vec<WordObj>,
        audio: Option<AudioSegment>,
    }
    #[derive(Deserialize)]
    struct ApiResponse {
        verses: Vec<VerseObj>,
    }

    let mut fetched_results: Vec<QuranAyah> = Vec::new();
    
    // Attempt to add words_json column if missing (ignore error)
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute("ALTER TABLE quran_cache ADD COLUMN words_json TEXT", []);
        let _ = db.execute("ALTER TABLE quran_cache ADD COLUMN translation_en TEXT", []);
    }

    let start_page = (ayat_start.saturating_sub(1)) / 50 + 1;
    let end_page = (ayat_end.saturating_sub(1)) / 50 + 1;

    for page in start_page..=end_page {
        let url = format!("https://api.quran.com/api/v4/verses/by_chapter/{}?language=id&words=true&word_fields=text_uthmani&audio={}&translations=33,20&fields=text_uthmani&page={}&per_page=50", surah, reciter_id, page);
        let response = reqwest::get(&url).await?;
        
        let api_data: ApiResponse = response.json().await?;

        for v in api_data.verses {
        if v.verse_number < ayat_start || v.verse_number > ayat_end {
            continue;
        }

        let mut translation_id = String::new();
        let mut translation_en = String::new();

        for t in &v.translations {
            let mut clean_text = t.text.clone();
            while let Some(start) = clean_text.find("<sup") {
                if let Some(end_offset) = clean_text[start..].find("</sup") {
                    let end = start + end_offset;
                    if let Some(close_offset) = clean_text[end..].find('>') {
                        clean_text.replace_range(start..end + close_offset + 1, "");
                        continue;
                    }
                }
                if let Some(close_offset) = clean_text[start..].find('>') {
                    clean_text.replace_range(start..start + close_offset + 1, "");
                    continue;
                }
                clean_text.truncate(start);
                break;
            }

            if t.resource_id == 33 {
                translation_id = clean_text;
            } else if t.resource_id == 20 {
                translation_en = clean_text;
            }
        }

        let mut words = Vec::new();
        let segments = v.audio.and_then(|a| a.segments).unwrap_or_default();

        for (i, w) in v.words.iter().enumerate() {
            let mut start_ms = None;
            let mut end_ms = None;
            
            // Segments are usually matched by index
            if i < segments.len() {
                let seg = &segments[i];
                if seg.len() >= 4 {
                    start_ms = Some(seg[2]);
                    end_ms = Some(seg[3]);
                }
            }

            let arabic_text = w.text_uthmani.clone()
                .or_else(|| w.text.clone())
                .or_else(|| w.code_v1.clone())
                .unwrap_or_default();

            words.push(QuranWord {
                position: w.position,
                arabic: arabic_text,
                start_ms,
                end_ms,
            });
        }

        let words_json = serde_json::to_string(&words).unwrap_or_default();

        // Save to cache
        {
            let db = state.db.lock().unwrap();
            let _ = db.execute(
                "INSERT OR REPLACE INTO quran_cache (surah, ayah, arabic, translation, words_json, translation_en) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (surah, v.verse_number, &v.text_uthmani, &translation_id, &words_json, &translation_en),
            );
        }
        
            fetched_results.push(QuranAyah {
                surah,
                ayah: v.verse_number,
                arabic: v.text_uthmani.clone(),
                translation: translation_id.clone(),
                translation_en: Some(translation_en),
                words,
            });
        }
    }

    Ok(fetched_results)
}

#[tauri::command]
pub async fn download_audio(app_handle: tauri::AppHandle, url: String, filename: String) -> Result<String, crate::error::AppError> {
    use tauri::Manager;
    let app_dir = app_handle.path().app_data_dir()?;
    let cache_dir = app_dir.join("audio_cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir)?;
    }
    let file_path = cache_dir.join(filename);
    
    // Check if it already exists (persistent cache)
    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }

    let response = reqwest::get(&url).await?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to download audio. Status: {}", response.status()).into());
    }
    
    let bytes = response.bytes().await?;
    std::fs::write(&file_path, bytes)?;
    
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_audio_cache_size(app_handle: tauri::AppHandle) -> Result<String, crate::error::AppError> {
    use tauri::Manager;
    let app_dir = app_handle.path().app_data_dir()?;
    let cache_dir = app_dir.join("audio_cache");
    if !cache_dir.exists() {
        return Ok("0 B".to_string());
    }
    
    let mut total_size = 0;
    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                total_size += metadata.len();
            }
        }
    }
    
    let size_mb = total_size as f64 / 1_048_576.0;
    if size_mb < 1.0 {
        let size_kb = total_size as f64 / 1024.0;
        return Ok(format!("{:.2} KB", size_kb));
    }
    Ok(format!("{:.2} MB", size_mb))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StockMedia {
    pub id: String,
    pub provider: String,
    pub media_type: String, // "image" | "video"
    pub preview_url: String,
    pub download_url: String,
    pub width: u32,
    pub height: u32,
    pub duration: Option<u32>, // seconds, videos only
    pub author: String,
}

fn get_setting(state: &State<'_, AppState>, key: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT value FROM app_settings WHERE key = ?1").ok()?;
    let mut rows = stmt.query([key]).ok()?;
    if let Ok(Some(row)) = rows.next() {
        return row.get::<_, String>(0).ok();
    }
    None
}

async fn search_pixabay(key: &str, query: &str, media_type: &str, per_page: u32) -> Result<Vec<StockMedia>, crate::error::AppError> {
    let client = reqwest::Client::new();
    if media_type == "video" {
        #[derive(Deserialize)]
        struct PixabayVideoFile { url: String, width: u32, height: u32 }
        #[derive(Deserialize)]
        struct PixabayVideo {
            id: i64,
            user: String,
            duration: u32,
            #[serde(default)]
            picture_id: Option<String>,
            videos: std::collections::HashMap<String, PixabayVideoFile>,
        }
        #[derive(Deserialize)]
        struct PixabayVideoResponse { hits: Vec<PixabayVideo> }

        let url = format!(
            "https://pixabay.com/api/videos/?key={}&q={}&per_page={}&safesearch=true",
            key,
            urlencode(query),
            per_page
        );
        let resp: PixabayVideoResponse = client.get(&url).send().await?
            .error_for_status().map_err(|e| format!("Pixabay API error: {}", e))?
            .json().await?;

        Ok(resp.hits.into_iter().map(|v| {
            // Prefer large, then medium, then any available quality.
            let file = v.videos.get("large")
                .or_else(|| v.videos.get("medium"))
                .or_else(|| v.videos.values().next());
            let (dl, w, h) = match file {
                Some(f) => (f.url.clone(), f.width, f.height),
                None => (String::new(), 0, 0),
            };
            let preview = v.picture_id
                .map(|pid| format!("https://i.vimeocdn.com/video/{}_640.jpg", pid))
                .unwrap_or_default();
            StockMedia {
                id: v.id.to_string(),
                provider: "pixabay".to_string(),
                media_type: "video".to_string(),
                preview_url: preview,
                download_url: dl,
                width: w,
                height: h,
                duration: Some(v.duration),
                author: v.user,
            }
        }).collect())
    } else {
        #[derive(Deserialize)]
        struct PixabayImage {
            id: i64,
            user: String,
            webformat_url: String,
            large_image_url: String,
            image_width: u32,
            image_height: u32,
        }
        #[derive(Deserialize)]
        struct PixabayImageResponse { hits: Vec<PixabayImage> }

        let url = format!(
            "https://pixabay.com/api/?key={}&q={}&image_type=photo&per_page={}&safesearch=true",
            key,
            urlencode(query),
            per_page
        );
        let resp: PixabayImageResponse = client.get(&url).send().await?
            .error_for_status().map_err(|e| format!("Pixabay API error: {}", e))?
            .json().await?;

        Ok(resp.hits.into_iter().map(|img| StockMedia {
            id: img.id.to_string(),
            provider: "pixabay".to_string(),
            media_type: "image".to_string(),
            preview_url: img.webformat_url,
            download_url: img.large_image_url,
            width: img.image_width,
            height: img.image_height,
            duration: None,
            author: img.user,
        }).collect())
    }
}

async fn search_pexels(key: &str, query: &str, media_type: &str, per_page: u32) -> Result<Vec<StockMedia>, crate::error::AppError> {
    let client = reqwest::Client::new();
    if media_type == "video" {
        #[derive(Deserialize)]
        struct PexelsVideoFile { link: String, width: Option<u32>, height: Option<u32> }
        #[derive(Deserialize)]
        struct PexelsVideoUser { name: Option<String> }
        #[derive(Deserialize)]
        struct PexelsVideo {
            id: i64,
            image: String,
            duration: u32,
            user: PexelsVideoUser,
            video_files: Vec<PexelsVideoFile>,
        }
        #[derive(Deserialize)]
        struct PexelsVideoResponse { videos: Vec<PexelsVideo> }

        let url = format!(
            "https://api.pexels.com/videos/search?query={}&per_page={}",
            urlencode(query),
            per_page
        );
        let resp: PexelsVideoResponse = client.get(&url)
            .header("Authorization", key)
            .send().await?
            .error_for_status().map_err(|e| format!("Pexels API error: {}", e))?
            .json().await?;

        Ok(resp.videos.into_iter().map(|v| {
            // Pick the highest-resolution file with both dimensions set.
            let file = v.video_files.iter().filter(|f| f.width.unwrap_or(0) >= 1280)
                .max_by_key(|f| f.width.unwrap_or(0));
            let file = file.or_else(|| v.video_files.first());
            let (dl, w, h) = match file {
                Some(f) => (f.link.clone(), f.width.unwrap_or(0), f.height.unwrap_or(0)),
                None => (String::new(), 0, 0),
            };
            StockMedia {
                id: v.id.to_string(),
                provider: "pexels".to_string(),
                media_type: "video".to_string(),
                preview_url: v.image,
                download_url: dl,
                width: w,
                height: h,
                duration: Some(v.duration),
                author: v.user.name.unwrap_or_default(),
            }
        }).collect())
    } else {
        #[derive(Deserialize)]
        struct PexelsSrc { large2x: String, large: String }
        #[derive(Deserialize)]
        struct PexelsPhoto {
            id: i64,
            photographer: String,
            src: PexelsSrc,
            width: u32,
            height: u32,
        }
        #[derive(Deserialize)]
        struct PexelsPhotoResponse { photos: Vec<PexelsPhoto> }

        let url = format!(
            "https://api.pexels.com/v1/search?query={}&per_page={}",
            urlencode(query),
            per_page
        );
        let resp: PexelsPhotoResponse = client.get(&url)
            .header("Authorization", key)
            .send().await?
            .error_for_status().map_err(|e| format!("Pexels API error: {}", e))?
            .json().await?;

        Ok(resp.photos.into_iter().map(|p| StockMedia {
            id: p.id.to_string(),
            provider: "pexels".to_string(),
            media_type: "image".to_string(),
            preview_url: p.src.large,
            download_url: p.src.large2x,
            width: p.width,
            height: p.height,
            duration: None,
            author: p.photographer,
        }).collect())
    }
}

// Minimal percent-encoding for query strings.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

#[tauri::command]
pub async fn search_stock_media(
    state: State<'_, AppState>,
    provider: String,
    query: String,
    media_type: String,
    per_page: Option<u32>,
) -> Result<Vec<StockMedia>, crate::error::AppError> {
    if query.trim().is_empty() {
        return Err("Query cannot be empty.".to_string().into());
    }
    let key_setting = format!("{}_api_key", provider);
    let key = get_setting(&state, &key_setting)
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| format!("Missing API key for {}. Please add it in Settings.", provider))?;

    let per_page = per_page.unwrap_or(24).min(80);
    match provider.as_str() {
        "pixabay" => search_pixabay(&key, query.trim(), media_type.trim(), per_page).await,
        "pexels" => search_pexels(&key, query.trim(), media_type.trim(), per_page).await,
        _ => Err(format!("Unknown provider: {}", provider).into()),
    }
}

#[tauri::command]
pub async fn download_background(app_handle: tauri::AppHandle, url: String, filename: String) -> Result<String, crate::error::AppError> {
    use tauri::Manager;
    let app_dir = app_handle.path().app_data_dir()?;
    let cache_dir = app_dir.join("backgrounds_cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir)?;
    }

    // Prevent path traversal via the filename argument.
    let safe_name = filename.replace(['/', '\\'], "_");
    let file_path = cache_dir.join(safe_name);

    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }

    let response = reqwest::get(&url).await?;
    if !response.status().is_success() {
        return Err(format!("Failed to download background. Status: {}", response.status()).into());
    }

    let bytes = response.bytes().await?;
    std::fs::write(&file_path, bytes)?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_audio_cache(app_handle: tauri::AppHandle) -> Result<(), crate::error::AppError> {
    use tauri::Manager;
    let app_dir = app_handle.path().app_data_dir()?;
    let cache_dir = app_dir.join("audio_cache");
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir)?;
        std::fs::create_dir_all(&cache_dir)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_system_diagnostics(app_handle: tauri::AppHandle) -> Result<crate::binaries::SystemDiagnostics, crate::error::AppError> {
    Ok(crate::binaries::get_diagnostics(&app_handle))
}
