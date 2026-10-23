use serde::Serialize;
use specta::Type;
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

#[derive(Serialize, Type, Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub status: String,
}

#[tauri::command]
#[specta::specta]
fn greet(name: String) -> String {
    format!("Salam, {}!", name)
}

#[tauri::command]
#[specta::specta]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "QuranRender".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: "Fase 0 — Fondasi".to_string(),
    }
}

fn create_specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![greet, get_app_info])
}

fn main() {
    let builder = create_specta_builder();

    #[cfg(debug_assertions)]
    builder
        .export(Typescript::default(), "../src/bindings.ts")
        .expect("gagal mengekspor binding typescript");

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("galat saat menjalankan aplikasi tauri");
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        assert_eq!(greet("Dunia".to_string()), "Salam, Dunia!");
    }

    #[test]
    fn test_get_app_info() {
        let info = get_app_info();
        assert_eq!(info.name, "QuranRender");
        assert_eq!(info.status, "Fase 0 — Fondasi");
    }

    #[test]
    fn test_export_bindings() {
        let builder = create_specta_builder();
        builder
            .export(Typescript::default(), "../src/bindings.ts")
            .expect("gagal mengekspor binding typescript dalam test");
    }
}
