mod db;
mod commands;
mod render;
pub mod ai;
pub mod clipper;
pub mod error;
pub mod binaries;
pub mod media;
pub mod segmentation;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::init_db(app).expect("Failed to initialize database");
            app.manage(db::AppState {
                db: std::sync::Mutex::new(conn),
            });
            render::init_background_worker(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::get_projects,
            commands::save_project,
            commands::get_quran_ayah,
            commands::save_quran_ayah,
            commands::fetch_quran_verses,
            commands::download_audio,
            commands::get_audio_cache_size,
            commands::clear_audio_cache,
            commands::save_app_setting,
            commands::get_app_setting,
            commands::search_stock_media,
            commands::download_background,
            commands::get_system_diagnostics,
            render::enqueue_render,
            ai::fetch_tafsir,
            ai::ai_summarize_tafsir,
            ai::ai_generate_image,
            ai::ai_generate_audio,
            clipper::check_ytdlp_status,
            clipper::fetch_yt_metadata,
            clipper::fetch_yt_transcript,
            clipper::ai_analyze_yt_hooks,
            clipper::download_and_cut_clip,
            media::get_media_info,
            media::cut_audio,
            segmentation::sidecar::run_alignment
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
