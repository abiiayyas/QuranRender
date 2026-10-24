//! Latar proyek (gambar/video): impor, hapus. Logika murni agar bisa diuji tanpa Tauri; perintah di
//! bawah hanya membungkusnya. Rendering latar ada di `qr_cli::background` (preview + ekspor).

use std::path::Path;
use std::sync::Mutex;

use qr_cli::background::timeline_end_ticks;
use qr_core::project::{AssetKind, AssetRef, Clip, Project, Track, TrackKind};
use qr_media::probe::MediaError;
use qr_media::{
    background_kind_for, probe_image_with, probe_media_with, BackgroundKind,
    BACKGROUND_IMAGE_EXTENSIONS, BACKGROUND_VIDEO_EXTENSIONS,
};
use qr_store::AppDb;
use serde::Serialize;
use specta::Type;

use crate::audio_api::{sha256_file, MediaTools};
use crate::project_io::{load_registered, save_registered};

/// Dimmer bawaan saat latar pertama diimpor (CNT-5 mensyaratkan ≥ 0,20 agar teks ayat tetap terbaca).
/// Ditulis sebagai string seperti nilai override lain yang ditulis UI (tipe bindings `{[k]: string}`).
const DEFAULT_DIMMER: &str = "0.35";
/// Panjang minimum klip latar (1 dtk @48 kHz) pada proyek yang belum punya audio/segmen.
const MIN_CLIP_TICKS: i64 = 48_000;

/// Hasil impor latar.
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct BackgroundInfo {
    pub asset_id: String,
    /// `Image` atau `Video`.
    pub kind: AssetKind,
    pub width: u32,
    pub height: u32,
    /// Durasi video (detik); `None` untuk gambar.
    pub duration_sec: Option<f64>,
}

fn unsupported_message(path: &Path) -> String {
    let shown = path.extension().map_or_else(
        || "tanpa ekstensi".to_string(),
        |e| format!(".{}", e.to_string_lossy()),
    );
    format!(
        "Format latar '{shown}' tidak didukung. Gunakan gambar ({}) atau video ({}): {}",
        BACKGROUND_IMAGE_EXTENSIONS.join(", "),
        BACKGROUND_VIDEO_EXTENSIONS.join(", "),
        path.display()
    )
}

fn media_error(path: &Path, what: &str, e: MediaError) -> String {
    match e {
        MediaError::FileNotFound(_) => format!("Berkas latar tidak ditemukan: {}", path.display()),
        MediaError::UnsupportedFormat(_) => unsupported_message(path),
        MediaError::ProbeFailed(msg) => format!(
            "Berkas tidak dapat dibaca sebagai {what} ({}): {msg}",
            path.display()
        ),
        MediaError::Io(e) => format!("Gagal membaca berkas {}: {e}", path.display()),
    }
}

/// Trek latar; dibuat (di depan, paling bawah) bila proyek lama tidak punya.
fn background_track_mut(project: &mut Project) -> &mut Track {
    let idx = match project
        .tracks
        .iter()
        .position(|t| t.kind == TrackKind::Background)
    {
        Some(i) => i,
        None => {
            project.tracks.insert(
                0,
                Track {
                    id: "track_bg".to_string(),
                    name: "Latar".to_string(),
                    kind: TrackKind::Background,
                    clips: Vec::new(),
                    visible: true,
                    locked: false,
                    muted: false,
                },
            );
            0
        }
    };
    &mut project.tracks[idx]
}

/// Mengosongkan klip trek latar dan membuang aset yang dirujuknya bila tidak dipakai klip lain.
/// Mengembalikan `true` bila ada yang berubah.
fn clear_background(project: &mut Project) -> bool {
    let mut old_ids: Vec<String> = Vec::new();
    let mut changed = false;
    for t in project
        .tracks
        .iter_mut()
        .filter(|t| t.kind == TrackKind::Background)
    {
        changed |= !t.clips.is_empty();
        old_ids.extend(t.clips.drain(..).filter_map(|c| c.asset_id));
    }
    for id in old_ids {
        let still_used = project
            .tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .any(|c| c.asset_id.as_deref() == Some(id.as_str()));
        if !still_used && project.assets.remove(&id).is_some() {
            changed = true;
        }
    }
    changed
}

/// Impor latar ke proyek terdaftar: probe (gambar/video; menolak format lain, berkas hilang/rusak),
/// hash SHA-256, daftarkan aset (jalur absolut), GANTI klip trek latar dengan satu klip yang menutupi
/// seluruh timeline (0 .. maks(durasi audio, akhir segmen terakhir, 1 dtk)), set dimmer 0,35 bila belum
/// ada, lalu simpan atomik. UI memuat ulang proyek lewat `project_open`.
pub fn background_import_impl(
    db: &Mutex<AppDb>,
    project_id: &str,
    path: &Path,
    tools: &MediaTools,
) -> Result<BackgroundInfo, String> {
    let (dir, mut project) = load_registered(db, project_id)?;
    if !path.exists() {
        return Err(format!("Berkas latar tidak ditemukan: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Bukan berkas: {}", path.display()));
    }
    let kind = background_kind_for(path).ok_or_else(|| unsupported_message(path))?;
    let abs = std::fs::canonicalize(path)
        .map_err(|e| format!("Jalur latar tidak valid ({}): {e}", path.display()))?;

    let (width, height, duration_sec, duration_ticks, size_bytes) = match kind {
        BackgroundKind::Image => {
            let (w, h) = probe_image_with(&tools.ffprobe, &abs)
                .map_err(|e| media_error(&abs, "gambar", e))?;
            let size = std::fs::metadata(&abs)
                .map_err(|e| format!("Gagal membaca berkas {}: {e}", abs.display()))?
                .len();
            (w, h, None, 0, size)
        }
        BackgroundKind::Video => {
            let meta = probe_media_with(&tools.ffprobe, &abs)
                .map_err(|e| media_error(&abs, "video", e))?;
            let dims = meta
                .video_width
                .zip(meta.video_height)
                .filter(|_| meta.has_video);
            let Some((w, h)) = dims else {
                return Err(format!(
                    "Berkas tidak memuat stream video: {}",
                    abs.display()
                ));
            };
            (
                w,
                h,
                Some(meta.duration_sec),
                meta.duration_ticks,
                meta.file_size_bytes,
            )
        }
    };
    let sha256 = sha256_file(&abs)?;

    let asset_id = format!("bg_{}", ulid::Ulid::generate().to_string().to_lowercase());
    let asset_kind = match kind {
        BackgroundKind::Image => AssetKind::Image,
        BackgroundKind::Video => AssetKind::Video,
    };
    let end = timeline_end_ticks(&project).max(MIN_CLIP_TICKS);
    let label = abs
        .file_name()
        .map_or_else(|| "latar".to_string(), |n| n.to_string_lossy().to_string());

    clear_background(&mut project);
    project.assets.insert(
        asset_id.clone(),
        AssetRef {
            id: asset_id.clone(),
            path: abs.to_string_lossy().to_string(),
            sha256,
            kind: asset_kind.clone(),
            duration_ticks,
            size_bytes,
        },
    );
    // Video: `trim_out` = durasi sumber (dasar perulangan/pemotongan); gambar statis: selebar klip.
    let trim_out = if kind == BackgroundKind::Video {
        duration_ticks
    } else {
        end
    };
    background_track_mut(&mut project).clips = vec![Clip {
        id: format!("clip_{asset_id}"),
        asset_id: Some(asset_id.clone()),
        start_tick: 0,
        end_tick: end,
        trim_in_tick: 0,
        trim_out_tick: trim_out,
        label,
    }];
    if project.background_dimmer().is_none() {
        project.style_overrides.insert(
            Project::BACKGROUND_DIMMER_KEY.to_string(),
            serde_json::Value::String(DEFAULT_DIMMER.to_string()),
        );
    }
    save_registered(db, &dir, &mut project, None)?;

    Ok(BackgroundInfo {
        asset_id,
        kind: asset_kind,
        width,
        height,
        duration_sec,
    })
}

/// Menghapus latar: klip trek latar dikosongkan dan aset yang tak terpakai dibuang. Nilai dimmer tetap
/// (dipakai lagi bila latar baru diimpor).
pub fn background_remove_impl(db: &Mutex<AppDb>, project_id: &str) -> Result<(), String> {
    let (dir, mut project) = load_registered(db, project_id)?;
    if clear_background(&mut project) {
        save_registered(db, &dir, &mut project, None)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn background_import(
    project_id: String,
    path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BackgroundInfo, String> {
    background_import_impl(
        &state.db,
        &project_id,
        Path::new(&path),
        &MediaTools::discover(),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn background_remove(
    project_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    background_remove_impl(&state.db, &project_id)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::project_io::test_support::{make_sine_wav, register_project, TempDir};
    use qr_core::load_project;
    use qr_core::project::AyahSegment;

    fn tools() -> MediaTools {
        MediaTools::discover()
    }

    fn ffmpeg(args: &[&str], out: &Path) {
        let st = std::process::Command::new(crate::tools::media_tool("ffmpeg"))
            .args(["-v", "error", "-y"])
            .args(args)
            .arg(out)
            .status()
            .unwrap();
        assert!(st.success(), "ffmpeg gagal membuat media uji");
    }

    fn make_png(path: &Path, size: &str) {
        ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                &format!("color=c=blue:s={size}"),
                "-frames:v",
                "1",
            ],
            path,
        );
    }

    fn make_mp4(path: &Path, secs: u32) {
        ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                &format!("testsrc=s=128x72:r=10:d={secs}"),
                "-pix_fmt",
                "yuv420p",
            ],
            path,
        );
    }

    fn bg_clips(p: &Project) -> Vec<&Clip> {
        p.tracks
            .iter()
            .filter(|t| t.kind == TrackKind::Background)
            .flat_map(|t| t.clips.iter())
            .collect()
    }

    #[test]
    fn import_image_registers_asset_clip_dimmer_and_replaces_previous() {
        let tmp = TempDir::new("bg_img");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Latar Gambar");
        p.segments.push(AyahSegment {
            id: "s1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48_000 * 7,
            ..Default::default()
        });
        let dir = register_project(&db, tmp.path(), &mut p);
        let png = tmp.path().join("latar.png");
        make_png(&png, "160x90");

        let info = background_import_impl(&db, &p.id, &png, &tools()).unwrap();
        assert_eq!(info.kind, AssetKind::Image);
        assert_eq!((info.width, info.height), (160, 90));
        assert_eq!(info.duration_sec, None);

        let saved = load_project(&dir).unwrap();
        let asset = &saved.assets[&info.asset_id];
        assert_eq!(asset.kind, AssetKind::Image);
        assert!(Path::new(&asset.path).is_absolute());
        assert_eq!(asset.sha256.len(), 64);
        assert_eq!(asset.size_bytes, std::fs::metadata(&png).unwrap().len());
        let clips = bg_clips(&saved);
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].asset_id.as_deref(), Some(info.asset_id.as_str()));
        assert_eq!((clips[0].start_tick, clips[0].end_tick), (0, 48_000 * 7));
        assert_eq!(saved.background_dimmer(), Some(0.35));
        assert_eq!(saved.revision, p.revision + 1);

        // Dimmer yang sudah diatur pengguna tidak ditimpa; impor kedua mengganti (tidak menumpuk).
        let mut edited = saved.clone();
        edited
            .style_overrides
            .insert("background_dimmer".into(), serde_json::json!("0.6"));
        qr_core::save_project_atomic(&dir, &mut edited).unwrap();
        let png2 = tmp.path().join("latar2.png");
        make_png(&png2, "90x160");
        let info2 = background_import_impl(&db, &p.id, &png2, &tools()).unwrap();
        let saved2 = load_project(&dir).unwrap();
        assert_eq!(bg_clips(&saved2).len(), 1);
        assert_eq!(
            bg_clips(&saved2)[0].asset_id.as_deref(),
            Some(info2.asset_id.as_str())
        );
        assert!(
            !saved2.assets.contains_key(&info.asset_id),
            "aset lama dibuang"
        );
        assert!(saved2.assets.contains_key(&info2.asset_id));
        assert_eq!(saved2.background_dimmer(), Some(0.6));
    }

    #[test]
    fn import_video_uses_audio_duration_for_clip_and_keeps_audio_asset() {
        let tmp = TempDir::new("bg_vid");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Latar Video");
        let dir = register_project(&db, tmp.path(), &mut p);
        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, 5.0, 440);
        crate::audio_api::audio_import_impl(&db, &p.id, &wav, &tools()).unwrap();
        let mp4 = tmp.path().join("latar.mp4");
        make_mp4(&mp4, 2);

        let info = background_import_impl(&db, &p.id, &mp4, &tools()).unwrap();
        assert_eq!(info.kind, AssetKind::Video);
        assert_eq!((info.width, info.height), (128, 72));
        assert!((info.duration_sec.unwrap() - 2.0).abs() < 0.2);

        let saved = load_project(&dir).unwrap();
        let audio_ticks = saved
            .assets
            .values()
            .find(|a| a.kind == AssetKind::Audio)
            .unwrap()
            .duration_ticks;
        let clips = bg_clips(&saved);
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].end_tick, audio_ticks, "klip = durasi audio");
        let video = &saved.assets[&info.asset_id];
        assert_eq!(video.kind, AssetKind::Video);
        assert_eq!(clips[0].trim_out_tick, video.duration_ticks);
        assert!(
            clips[0].end_tick > clips[0].trim_out_tick,
            "video diputar berulang"
        );
        assert_eq!(saved.assets.len(), 2, "audio tidak ikut terhapus");
    }

    #[test]
    fn empty_project_gets_one_second_clip() {
        let tmp = TempDir::new("bg_min");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Latar Kosong");
        let dir = register_project(&db, tmp.path(), &mut p);
        let png = tmp.path().join("latar.jpg");
        ffmpeg(
            &["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"],
            &png,
        );
        background_import_impl(&db, &p.id, &png, &tools()).unwrap();
        let saved = load_project(&dir).unwrap();
        assert_eq!(bg_clips(&saved)[0].end_tick, MIN_CLIP_TICKS);
    }

    #[test]
    fn remove_clears_clip_and_unused_asset_but_keeps_dimmer() {
        let tmp = TempDir::new("bg_rm");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Latar Hapus");
        let dir = register_project(&db, tmp.path(), &mut p);
        let png = tmp.path().join("latar.png");
        make_png(&png, "64x64");
        let info = background_import_impl(&db, &p.id, &png, &tools()).unwrap();

        background_remove_impl(&db, &p.id).unwrap();
        let saved = load_project(&dir).unwrap();
        assert!(bg_clips(&saved).is_empty());
        assert!(!saved.assets.contains_key(&info.asset_id));
        assert_eq!(saved.background_dimmer(), Some(0.35));
        assert!(png.is_file(), "berkas pengguna tidak dihapus dari disk");

        // Hapus saat tidak ada latar = tanpa galat dan tanpa menulis ulang proyek.
        let rev = saved.revision;
        background_remove_impl(&db, &p.id).unwrap();
        assert_eq!(load_project(&dir).unwrap().revision, rev);
        assert!(background_remove_impl(&db, "tidak-ada").is_err());
    }

    #[test]
    fn import_rejects_missing_unsupported_and_corrupt_files_without_touching_project() {
        let tmp = TempDir::new("bg_bad");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Latar Buruk");
        let dir = register_project(&db, tmp.path(), &mut p);
        let before = std::fs::read(dir.join("project.json")).unwrap();

        let err = background_import_impl(&db, &p.id, &tmp.path().join("tidak-ada.png"), &tools())
            .unwrap_err();
        assert!(err.contains("tidak ditemukan"), "{err}");

        let txt = tmp.path().join("catatan.txt");
        std::fs::write(&txt, "bukan gambar").unwrap();
        let err = background_import_impl(&db, &p.id, &txt, &tools()).unwrap_err();
        assert!(
            err.contains("tidak didukung") && err.contains("png"),
            "{err}"
        );

        let mp3 = tmp.path().join("qari.mp3");
        std::fs::write(&mp3, vec![0u8; 64]).unwrap();
        let err = background_import_impl(&db, &p.id, &mp3, &tools()).unwrap_err();
        assert!(err.contains("tidak didukung"), "{err}");

        let fake_png = tmp.path().join("palsu.png");
        std::fs::write(&fake_png, vec![0x41u8; 2048]).unwrap();
        let err = background_import_impl(&db, &p.id, &fake_png, &tools()).unwrap_err();
        assert!(err.contains("tidak dapat dibaca sebagai gambar"), "{err}");

        let fake_mp4 = tmp.path().join("palsu.mp4");
        std::fs::write(&fake_mp4, vec![0x41u8; 2048]).unwrap();
        let err = background_import_impl(&db, &p.id, &fake_mp4, &tools()).unwrap_err();
        assert!(err.contains("tidak dapat dibaca sebagai video"), "{err}");

        // Video tanpa stream video (hanya audio dalam wadah mp4).
        let audio_only = tmp.path().join("audio.mp4");
        ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:a",
                "aac",
            ],
            &audio_only,
        );
        let err = background_import_impl(&db, &p.id, &audio_only, &tools()).unwrap_err();
        assert!(err.contains("tidak memuat stream video"), "{err}");

        let err = background_import_impl(&db, "tidak-ada", &txt, &tools()).unwrap_err();
        assert!(err.contains("tidak ditemukan"), "{err}");

        assert_eq!(
            std::fs::read(dir.join("project.json")).unwrap(),
            before,
            "proyek tidak berubah"
        );
    }
}
