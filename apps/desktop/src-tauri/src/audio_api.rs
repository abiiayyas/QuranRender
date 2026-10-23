//! Impor audio proyek (probe + hash + waveform) dan penjajaran otomatis. Logika murni agar bisa diuji
//! tanpa Tauri; perintah di `main.rs` hanya membungkusnya.

use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

use qr_align::{align_recitation, AlignmentConfig, AlignmentError};
use qr_core::project::{AssetKind, AssetRef, AyahSegment, Clip, Project, Track, TrackKind};
use qr_media::probe::MediaError;
use qr_media::{compute_waveform_peaks, decode_audio_mono_f32, probe_media_with};
use qr_render::VerseSource;
use qr_store::AppDb;
use serde::Serialize;
use sha2::{Digest, Sha256};
use specta::Type;

use crate::project_io::{load_registered, save_registered};

/// Jumlah titik waveform yang dikembalikan ke UI.
pub const PEAK_TARGET: usize = 1000;
/// Waveform dihitung dari audio yang didekode pada 8 kHz: 1 jam audio ≈ 115 MB, bukan ≈ 690 MB pada 48 kHz.
/// Puncak sedikit lebih rendah daripada pada 48 kHz (low-pass 4 kHz); cukup untuk visualisasi.
const PEAK_DECODE_RATE: u32 = 8_000;

/// Biner media yang dipakai (jalur absolut bila ditemukan).
#[derive(Debug, Clone)]
pub struct MediaTools {
    pub ffmpeg: String,
    pub ffprobe: String,
}

impl MediaTools {
    pub fn discover() -> Self {
        Self {
            ffmpeg: crate::tools::media_tool("ffmpeg"),
            ffprobe: crate::tools::media_tool("ffprobe"),
        }
    }
}

/// Hasil impor audio. `peaks` berisi amplitudo puncak 0..1 (nilai mutlak maksimum per ember waktu), ≈1000 titik
/// merata di seluruh durasi.
#[derive(Serialize, Type, Debug, Clone, PartialEq)]
pub struct AudioInfo {
    pub asset_id: String,
    pub duration_sec: f64,
    /// Durasi dalam tick 48 kHz.
    pub duration_ticks: f64,
    /// Sample rate berkas sumber.
    pub sample_rate: u32,
    pub channels: u32,
    pub peaks: Vec<f32>,
}

fn media_error(path: &Path, e: MediaError) -> String {
    match e {
        MediaError::FileNotFound(_) => format!("Berkas audio tidak ditemukan: {}", path.display()),
        MediaError::UnsupportedFormat(ext) => format!(
            "Format '{ext}' bukan audio yang didukung (mp3, m4a, aac, wav, flac, ogg, opus, mp4, mov, mkv, webm): {}",
            path.display()
        ),
        MediaError::ProbeFailed(msg) => format!(
            "Berkas tidak dapat dibaca sebagai audio ({}): {msg}",
            path.display()
        ),
        MediaError::Io(e) => format!("Gagal membaca berkas {}: {e}", path.display()),
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f =
        std::fs::File::open(path).map_err(|e| format!("Gagal membuka {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("Gagal membaca {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Mereduksi puncak (min/max per ember) menjadi `target` amplitudo 0..1 (ember digabung dengan maksimum).
pub fn reduce_peaks(bins: &[qr_media::WaveformPeak], target: usize) -> Vec<f32> {
    let amp = |p: &qr_media::WaveformPeak| p.max.max(-p.min).clamp(0.0, 1.0);
    let n = bins.len();
    if n <= target || target == 0 {
        return bins.iter().map(amp).collect();
    }
    (0..target)
        .map(|i| {
            let a = i * n / target;
            let b = ((i + 1) * n / target).max(a + 1).min(n);
            bins[a..b].iter().map(amp).fold(0.0, f32::max)
        })
        .collect()
}

/// Puncak waveform ≈`target` titik dari sampel mono pada `sample_rate`.
pub fn peaks_from_samples(samples: &[f32], sample_rate: u32, target: usize) -> Vec<f32> {
    if samples.is_empty() || sample_rate == 0 || target == 0 {
        return Vec::new();
    }
    let duration = samples.len() as f64 / f64::from(sample_rate);
    let bins_per_second =
        ((target as f64 / duration).ceil() as usize).clamp(1, sample_rate as usize);
    let bins = compute_waveform_peaks(samples, 1, sample_rate, bins_per_second);
    reduce_peaks(&bins, target)
}

/// Mendaftarkan `asset` sebagai audio utama: menggantikan audio sebelumnya (model satu audio per proyek,
/// sesuai jalur ekspor yang memakai satu berkas audio) dan menaruh satu klip di trek audio.
pub fn set_primary_audio(project: &mut Project, asset: AssetRef, label: &str) {
    project.assets.retain(|_, a| a.kind != AssetKind::Audio);
    let clip = Clip {
        id: format!("clip_{}", asset.id),
        asset_id: Some(asset.id.clone()),
        start_tick: 0,
        end_tick: asset.duration_ticks,
        trim_in_tick: 0,
        trim_out_tick: asset.duration_ticks,
        label: label.to_string(),
    };
    let track = match project
        .tracks
        .iter()
        .position(|t| t.kind == TrackKind::Audio)
    {
        Some(i) => &mut project.tracks[i],
        None => {
            project.tracks.push(Track {
                id: "track_audio".to_string(),
                name: "Audio".to_string(),
                kind: TrackKind::Audio,
                clips: Vec::new(),
                visible: true,
                locked: false,
                muted: false,
            });
            let last = project.tracks.len() - 1;
            &mut project.tracks[last]
        }
    };
    track.clips = vec![clip];
    project.assets.insert(asset.id.clone(), asset);
}

/// Impor audio ke proyek terdaftar: probe (menolak non-audio/hilang), hash SHA-256, daftarkan aset
/// (jalur absolut), simpan atomik, kembalikan waveform. Audio lama proyek digantikan.
pub fn audio_import_impl(
    db: &Mutex<AppDb>,
    project_id: &str,
    path: &Path,
    tools: &MediaTools,
) -> Result<AudioInfo, String> {
    let (dir, mut project) = load_registered(db, project_id)?;
    if !path.exists() {
        return Err(format!("Berkas audio tidak ditemukan: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Bukan berkas: {}", path.display()));
    }
    let abs = std::fs::canonicalize(path)
        .map_err(|e| format!("Jalur audio tidak valid ({}): {e}", path.display()))?;
    let meta = probe_media_with(&tools.ffprobe, &abs).map_err(|e| media_error(&abs, e))?;
    if meta.sample_rate == 0 || meta.channels == 0 {
        return Err(format!(
            "Berkas tidak memuat stream audio (hanya video/gambar): {}",
            abs.display()
        ));
    }
    let sha256 = sha256_file(&abs)?;
    let samples = decode_audio_mono_f32(&tools.ffmpeg, &abs, PEAK_DECODE_RATE)
        .map_err(|e| media_error(&abs, e))?;
    let peaks = peaks_from_samples(&samples, PEAK_DECODE_RATE, PEAK_TARGET);
    drop(samples);

    let asset_id = format!(
        "audio_{}",
        ulid::Ulid::generate().to_string().to_lowercase()
    );
    let asset = AssetRef {
        id: asset_id.clone(),
        path: abs.to_string_lossy().to_string(),
        sha256,
        kind: AssetKind::Audio,
        duration_ticks: meta.duration_ticks,
        size_bytes: meta.file_size_bytes,
    };
    let label = abs
        .file_name()
        .map_or_else(|| "audio".to_string(), |n| n.to_string_lossy().to_string());
    set_primary_audio(&mut project, asset, &label);
    save_registered(db, &dir, &mut project, Some(meta.duration_ticks))?;

    Ok(AudioInfo {
        asset_id,
        duration_sec: meta.duration_sec,
        duration_ticks: meta.duration_ticks as f64,
        sample_rate: meta.sample_rate,
        channels: u32::from(meta.channels),
        peaks,
    })
}

/// Hasil penjajaran otomatis; belum disimpan ke proyek (UI meninjau lalu menyimpan lewat `project_save`).
///
/// **Bukan forced alignment akustik.** Segmentasi memakai deteksi suara berbasis energi (VAD) dan memetakan
/// wilayah suara ke-i ke ayat ke-i secara berurutan; timing per kata proporsional terhadap panjang kata, dan
/// `confidence` berasal dari heuristik (kewajaran durasi + kontras energi), bukan dari model akustik.
/// Bila `speech_regions != verses_expected`, pemetaan tidak dapat dipercaya: `warnings` memuat peringatan
/// aligner apa adanya dan semua segmen wajib ditinjau.
#[derive(Serialize, Type, Debug, Clone)]
pub struct AlignOutcomeDto {
    pub segments: Vec<AyahSegment>,
    pub speech_regions: u32,
    pub verses_expected: u32,
    pub warnings: Vec<String>,
}

fn align_error(e: &AlignmentError) -> String {
    match e {
        AlignmentError::AudioTooShort => {
            "Audio kosong atau terlalu pendek untuk disegmentasi".to_string()
        }
        AlignmentError::NoSpeechDetected => {
            "Tidak ada suara terdeteksi di audio (periksa berkas atau volume rekaman)".to_string()
        }
    }
}

/// Teks ayat `surah:from..=to` dari sumber terverifikasi. Gagal keras bila rentang tidak valid atau ada ayat
/// yang tidak ditemukan (tidak pernah teks kosong/tebakan).
pub fn load_verse_texts(
    verses: &dyn VerseSource,
    surah_id: u32,
    from_ayah: u32,
    to_ayah: u32,
) -> Result<Vec<(u32, u32, String)>, String> {
    if surah_id == 0 || from_ayah == 0 || from_ayah > to_ayah {
        return Err(format!(
            "Rentang ayat tidak valid: surah {surah_id}, ayat {from_ayah}–{to_ayah} (mulai ≥ 1 dan mulai ≤ akhir)"
        ));
    }
    if to_ayah - from_ayah >= 300 {
        return Err("Rentang ayat terlalu besar (maksimum 300 ayat sekali jalan)".to_string());
    }
    (from_ayah..=to_ayah)
        .map(|a| {
            verses
                .verse(surah_id, a)
                .map(|v| (surah_id, a, v.ayah_text))
                .ok_or_else(|| format!("Ayat {surah_id}:{a} tidak ada di dataset"))
        })
        .collect()
}

/// Penjajaran dari sampel mono pada `config.sample_rate` (bagian murni; tanpa I/O).
pub fn align_samples(
    samples: &[f32],
    verses: &[(u32, u32, String)],
    config: &AlignmentConfig,
) -> Result<AlignOutcomeDto, String> {
    let out = align_recitation(samples, verses, config).map_err(|e| align_error(&e))?;
    Ok(AlignOutcomeDto {
        segments: out.segments,
        speech_regions: u32::try_from(out.speech_regions).unwrap_or(u32::MAX),
        verses_expected: u32::try_from(out.verses_expected).unwrap_or(u32::MAX),
        warnings: out.warnings,
    })
}

/// Penjajaran otomatis untuk audio proyek terhadap `texts` (dari [`load_verse_texts`]). Tidak menyimpan apa pun.
/// Teks dimuat terpisah agar kunci dataset tidak ditahan selama dekode audio.
pub fn align_auto_impl(
    project: &Project,
    texts: &[(u32, u32, String)],
    tools: &MediaTools,
) -> Result<AlignOutcomeDto, String> {
    let audio = crate::project_io::require_project_audio(project)?;
    let config = AlignmentConfig::default();
    let samples = decode_audio_mono_f32(&tools.ffmpeg, &audio, config.sample_rate)
        .map_err(|e| media_error(&audio, e))?;
    align_samples(&samples, texts, &config)
}

/// Mengimpor audio ke proyek terdaftar (probe, hash, daftarkan aset, simpan atomik) dan mengembalikan
/// waveform ≈1000 titik. Proyek di memori UI harus dimuat ulang (`project_open`) karena aset/klip berubah.
#[tauri::command]
#[specta::specta]
pub async fn audio_import(
    project_id: String,
    path: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<AudioInfo, String> {
    audio_import_impl(
        &state.db,
        &project_id,
        Path::new(&path),
        &MediaTools::discover(),
    )
}

/// Penjajaran otomatis audio proyek terhadap ayat `surah_id:from_ayah..=to_ayah` dari dataset terverifikasi.
/// Tidak menyimpan; UI meninjau hasilnya lalu menyimpan lewat `project_save`. Lihat [`AlignOutcomeDto`]:
/// ini VAD + timing proporsional, bukan forced alignment akustik.
#[tauri::command]
#[specta::specta]
pub async fn align_auto(
    project_id: String,
    surah_id: u32,
    from_ayah: u32,
    to_ayah: u32,
    state: tauri::State<'_, crate::AppState>,
) -> Result<AlignOutcomeDto, String> {
    let (_, project) = load_registered(&state.db, &project_id)?;
    let texts = state.with_dataset(|db| {
        let verses = qr_render::QuranDbVerses {
            db,
            edition_key: None,
        };
        load_verse_texts(&verses, surah_id, from_ayah, to_ayah)
    })?;
    align_auto_impl(&project, &texts, &MediaTools::discover())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::project_io::test_support::{make_sine_wav, register_project, TempDir};
    use qr_align::{arabic_base_letters, REFERENCE_SECONDS_PER_LETTER};
    use qr_core::load_project;
    use qr_media::WaveformPeak;
    use qr_render::VerseContent;
    use std::collections::HashMap;

    fn verses() -> HashMap<(u32, u32), VerseContent> {
        let mk = |t: &str| VerseContent {
            ayah_text: t.into(),
            translation: None,
            surah_name_ar: "الفاتحة".into(),
            surah_name_latin: "Al-Fatihah".into(),
        };
        let mut m = HashMap::new();
        m.insert((1, 1), mk("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"));
        m.insert((1, 2), mk("الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"));
        m.insert((1, 3), mk("الرَّحْمَٰنِ الرَّحِيمِ"));
        m
    }

    fn burst(audio: &mut [f32], start: usize, len: usize) {
        for (i, s) in audio.iter_mut().enumerate().skip(start).take(len) {
            *s = (i as f32 * 0.1).sin() * 0.4;
        }
    }

    fn tools() -> MediaTools {
        MediaTools::discover()
    }

    #[test]
    fn peaks_have_about_target_points_for_short_and_long_audio() {
        // 2 dtk @ 8 kHz → tepat ≈ target, bukan 200 (100 ember/dtk).
        let short = vec![0.5f32; 16_000];
        let p = peaks_from_samples(&short, 8_000, 1000);
        assert!((990..=1000).contains(&p.len()), "{}", p.len());
        // 600 dtk → direduksi ke persis 1000.
        let long: Vec<f32> = (0..8_000 * 600)
            .map(|i| ((i % 100) as f32) / 100.0)
            .collect();
        let p = peaks_from_samples(&long, 8_000, 1000);
        assert_eq!(p.len(), 1000);
        assert!(p.iter().all(|v| (0.0..=1.0).contains(v)));
    }

    #[test]
    fn reduce_keeps_the_loudest_peak_in_each_group() {
        let bins: Vec<WaveformPeak> = (0..10)
            .map(|i| WaveformPeak {
                min: if i == 7 { -0.9 } else { -0.1 },
                max: 0.2,
            })
            .collect();
        let r = reduce_peaks(&bins, 2);
        assert_eq!(r.len(), 2);
        assert!((r[0] - 0.2).abs() < 1e-6);
        assert!((r[1] - 0.9).abs() < 1e-6, "{r:?}");
        assert!(peaks_from_samples(&[], 8_000, 1000).is_empty());
    }

    #[test]
    fn primary_audio_replaces_the_previous_one_and_fills_the_audio_track() {
        let mut p = Project::new("Uji");
        let mk = |id: &str, ticks: i64| AssetRef {
            id: id.into(),
            path: format!("/x/{id}.wav"),
            sha256: "ab".into(),
            kind: AssetKind::Audio,
            duration_ticks: ticks,
            size_bytes: 1,
        };
        set_primary_audio(&mut p, mk("a1", 100), "a1.wav");
        set_primary_audio(&mut p, mk("a2", 200), "a2.wav");
        assert_eq!(p.assets.len(), 1);
        assert!(p.assets.contains_key("a2"));
        let audio_track = p
            .tracks
            .iter()
            .find(|t| t.kind == TrackKind::Audio)
            .unwrap();
        assert_eq!(audio_track.clips.len(), 1);
        assert_eq!(audio_track.clips[0].asset_id.as_deref(), Some("a2"));
        assert_eq!(audio_track.clips[0].end_tick, 200);
        assert_eq!(
            crate::project_io::project_audio_path(&p).unwrap(),
            std::path::PathBuf::from("/x/a2.wav")
        );

        // Proyek tanpa trek audio mendapat satu.
        let mut q = Project::new("Tanpa trek");
        q.tracks.clear();
        set_primary_audio(&mut q, mk("a3", 5), "a3.wav");
        assert_eq!(q.tracks.len(), 1);
        assert_eq!(q.tracks[0].kind, TrackKind::Audio);
    }

    #[test]
    fn audio_import_registers_asset_saves_and_returns_peaks() {
        let tmp = TempDir::new("imp");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Impor");
        register_project(&db, tmp.path(), &mut p);
        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, 3.0, 440);

        let info = audio_import_impl(&db, &p.id, &wav, &tools()).unwrap();
        assert!(
            (info.duration_sec - 3.0).abs() < 0.1,
            "{}",
            info.duration_sec
        );
        assert!((info.duration_ticks - 144_000.0).abs() < 4_800.0);
        assert_eq!(info.sample_rate, 44_100);
        assert_eq!(info.channels, 2);
        assert!(
            (990..=1000).contains(&info.peaks.len()),
            "{}",
            info.peaks.len()
        );
        assert!(
            info.peaks.iter().cloned().fold(0.0, f32::max) > 0.1,
            "sine harus terdengar"
        );

        let dir = crate::project_io::project_dir_for(&db, &p.id).unwrap();
        let saved = load_project(&dir).unwrap();
        let asset = saved.assets.get(&info.asset_id).expect("aset terdaftar");
        assert_eq!(asset.kind, AssetKind::Audio);
        assert!(std::path::Path::new(&asset.path).is_absolute());
        assert_eq!(asset.sha256.len(), 64);
        assert_eq!(asset.size_bytes, std::fs::metadata(&wav).unwrap().len());
        assert_eq!(
            saved.revision,
            p.revision + 1,
            "tersimpan atomik: revisi naik"
        );
        let hash_again = sha256_file(&wav).unwrap();
        assert_eq!(asset.sha256, hash_again);

        // Impor kedua menggantikan, tidak menumpuk.
        let wav2 = tmp.path().join("qari2.wav");
        make_sine_wav(&wav2, 1.0, 880);
        let info2 = audio_import_impl(&db, &p.id, &wav2, &tools()).unwrap();
        let saved2 = load_project(&dir).unwrap();
        assert_eq!(saved2.assets.len(), 1);
        assert!(saved2.assets.contains_key(&info2.asset_id));
        // Indeks ikut segar.
        let entry = db
            .lock()
            .unwrap()
            .get_project_index(&p.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            entry.duration_ticks,
            saved2.assets[&info2.asset_id].duration_ticks
        );
    }

    #[test]
    fn audio_import_rejects_missing_non_audio_and_unknown_project() {
        let tmp = TempDir::new("imp_bad");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Impor Buruk");
        let dir = register_project(&db, tmp.path(), &mut p);
        let before = std::fs::read(dir.join("project.json")).unwrap();

        let err =
            audio_import_impl(&db, &p.id, &tmp.path().join("tidak-ada.mp3"), &tools()).unwrap_err();
        assert!(err.contains("tidak ditemukan"), "{err}");

        let txt = tmp.path().join("catatan.txt");
        std::fs::write(&txt, "bukan audio").unwrap();
        let err = audio_import_impl(&db, &p.id, &txt, &tools()).unwrap_err();
        assert!(
            err.contains("bukan audio") || err.contains("Format"),
            "{err}"
        );

        // Ekstensi audio tetapi isinya sampah.
        let fake = tmp.path().join("palsu.mp3");
        std::fs::write(&fake, vec![0x41u8; 2048]).unwrap();
        let err = audio_import_impl(&db, &p.id, &fake, &tools()).unwrap_err();
        assert!(err.contains("tidak dapat dibaca sebagai audio"), "{err}");

        // Video tanpa audio.
        let silent = tmp.path().join("bisu.mp4");
        let st = std::process::Command::new(crate::tools::media_tool("ffmpeg"))
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=1",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&silent)
            .status()
            .unwrap();
        assert!(st.success());
        let err = audio_import_impl(&db, &p.id, &silent, &tools()).unwrap_err();
        assert!(err.contains("tidak memuat stream audio"), "{err}");

        let err = audio_import_impl(&db, "tidak-ada", &silent, &tools()).unwrap_err();
        assert!(err.contains("tidak ditemukan"), "{err}");

        assert_eq!(
            std::fs::read(dir.join("project.json")).unwrap(),
            before,
            "proyek tidak berubah"
        );
    }

    #[test]
    fn load_verse_texts_validates_range_and_missing_verses() {
        let v = verses();
        let t = load_verse_texts(&v, 1, 1, 3).unwrap();
        assert_eq!(t.len(), 3);
        assert_eq!(t[1].1, 2);
        assert_eq!(t[1].2, "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ");
        assert!(load_verse_texts(&v, 1, 0, 3).is_err());
        assert!(load_verse_texts(&v, 1, 3, 1).is_err());
        assert!(load_verse_texts(&v, 0, 1, 1).is_err());
        let err = load_verse_texts(&v, 1, 1, 4).unwrap_err();
        assert!(err.contains("1:4"), "{err}");
        assert!(load_verse_texts(&v, 1, 1, 400).is_err());
    }

    #[test]
    fn align_samples_maps_regions_to_verses_and_surfaces_warnings_verbatim() {
        let v = load_verse_texts(&verses(), 1, 1, 3).unwrap();
        let dur = |i: usize| {
            (arabic_base_letters(&v[i].2) as f64 * REFERENCE_SECONDS_PER_LETTER * 48000.0) as usize
        };
        let cfg = AlignmentConfig {
            sample_rate: 48000,
            review_threshold: 0.8,
            vad: qr_align::VadConfig {
                sample_rate: 48000,
                frame_size_ms: 20,
                energy_threshold: 0.02,
                min_speech_ms: 100,
                min_silence_ms: 100,
            },
        };
        let mut audio = vec![0.0f32; 48000 * 14];
        burst(&mut audio, 48000, dur(0));
        burst(&mut audio, 48000 * 5, dur(1));
        burst(&mut audio, 48000 * 10, dur(2));
        let ok = align_samples(&audio, &v, &cfg).unwrap();
        assert_eq!((ok.speech_regions, ok.verses_expected), (3, 3));
        assert!(ok.warnings.is_empty(), "{:?}", ok.warnings);
        assert_eq!(ok.segments.len(), 3);
        assert_eq!(ok.segments[1].ayah_number, 2);
        assert!(
            ok.segments[1].start_tick >= 48_000 * 5 - 960
                && ok.segments[1].start_tick <= 48_000 * 5 + 960
        );

        // Dua wilayah untuk tiga ayat: peringatan aligner muncul persis seperti dari qr-align.
        let mut audio2 = vec![0.0f32; 48000 * 8];
        burst(&mut audio2, 48000, dur(0));
        burst(&mut audio2, 48000 * 5, dur(1));
        let direct = align_recitation(&audio2, &v, &cfg).unwrap();
        let bad = align_samples(&audio2, &v, &cfg).unwrap();
        assert_eq!((bad.speech_regions, bad.verses_expected), (2, 3));
        assert_eq!(
            bad.warnings, direct.warnings,
            "peringatan tidak boleh diubah"
        );
        assert!(bad.warnings.iter().any(|w| w.contains("tidak sama")));

        let silence = vec![0.0f32; 48000 * 2];
        assert!(align_samples(&silence, &v, &cfg)
            .unwrap_err()
            .contains("Tidak ada suara"));
        assert!(align_samples(&[], &v, &cfg).unwrap_err().contains("kosong"));
    }

    #[test]
    fn align_auto_decodes_the_project_audio_and_does_not_save() {
        let tmp = TempDir::new("align");
        let db = Mutex::new(AppDb::open_in_memory().unwrap());
        let mut p = Project::new("Jajar");
        let dir = register_project(&db, tmp.path(), &mut p);

        // Tanpa audio: galat jelas.
        let texts = load_verse_texts(&verses(), 1, 1, 2).unwrap();
        let err = align_auto_impl(&p, &texts, &tools()).unwrap_err();
        assert!(err.contains("belum memiliki audio"), "{err}");

        // Audio sine 3 dtk terus-menerus = 1 wilayah suara untuk 2 ayat → peringatan.
        let wav = tmp.path().join("qari.wav");
        make_sine_wav(&wav, 3.0, 440);
        audio_import_impl(&db, &p.id, &wav, &tools()).unwrap();
        let saved = load_project(&dir).unwrap();
        let before = std::fs::read(dir.join("project.json")).unwrap();
        let out = align_auto_impl(&saved, &texts, &tools()).unwrap();
        assert_eq!(out.verses_expected, 2);
        assert_eq!(out.speech_regions, 1);
        assert!(!out.warnings.is_empty());
        assert_eq!(out.segments.len(), 1);
        assert_eq!(
            std::fs::read(dir.join("project.json")).unwrap(),
            before,
            "align_auto tidak menyimpan"
        );

        // Berkas audio hilang: galat jelas.
        std::fs::remove_file(&wav).unwrap();
        let err = align_auto_impl(&saved, &texts, &tools()).unwrap_err();
        assert!(err.contains("tidak ditemukan"), "{err}");
        // Ayat tidak ada.
        assert!(load_verse_texts(&verses(), 1, 1, 9)
            .unwrap_err()
            .contains("1:4"));
    }
}
