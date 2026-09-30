# Quran Caption — PRD & Panduan Penulisan Ulang (Tauri)

> Dokumen ini adalah rekapitulasi menyeluruh dari codebase **Quran Caption v3.6.73**.
> Tujuannya: menjadi panduan/PRD untuk **menulis ulang** aplikasi dengan framework
> **Tauri**, membuat **UI yang lebih praktis**, atau **menggabungkan** dengan project lain.
>
> Semua teknologi, dependensi, arsitektur, dan alur data dicatat secara presisi agar
> implementasi ulang tidak kehilangan perilaku penting.

---

## 1. Ringkasan Eksekutif

**Quran Caption** adalah editor video desktop untuk **resitasi Al-Qur'an**. Pengguna memasukkan
file audio/video, AI menghasilkan subtitle ber-waktu per ayat, pengguna memilih terjemahan,
mengatur tampilan, lalu mengekspor video siap untuk YouTube, TikTok, atau Instagram.

Aplikasi saat ini sudah dibangun di atas **Tauri 2** + **Svelte 5** + **Rust** + **Python
sidecar**. Penulisan ulang yang diminta bukan migrasi dari nol, melainkan penyusunan ulang
arsitektur yang lebih bersih dan UI yang lebih praktis, sambil tetap mempertahankan perilaku
intinya.

**Lisensi kode**: CC BY-NC 4.0 (non-komersial). **Nama, logo, dan branding** Quran Caption
tidak ikut dilisensikan — fork/modifikasi wajib menyatakan sebagai project independen.

---

## 2. Gambaran Fitur

### 2.1 Fitur Inti

| Area | Deskripsi |
| --- | --- |
| **AI Subtitle Generation** | Segmentasi audio → subtitle Arab per ayat (deteksi basmala, isti'adha, potongan tengah ayat, deteksi keheningan). |
| **AI Translation Trimmer** | Memotong/menyejajarkan terjemahan agar cocok dengan ayat yang terpotong. |
| **100+ Terjemahan / 40+ Bahasa** | Library terjemahan tersinkron otomatis; semua bisa diedit. |
| **Full Visual Customization** | Font, ukuran, warna, outline, shadow, overlay, penempatan, branding, nama qari, nama surah, nomor ayat, gambar/video overlay. |
| **Export-Ready** | Output untuk YouTube, Reels, TikTok. |
| **Batch (Workspace)** | Import batch, segmentasi batch, review batch, export batch. |
| **AI Video Creation (POC)** | Generate project dari prompt teks (branch `prompt-v2`). |
| **Undo/Redo** | Seluruh mutasi state proyek dibungkus `ProjectHistoryManager`. |

### 2.2 Integrasi Eksternal

- **Cloud Segmentation API (Multi-Aligner)**: segmentasi audio → subtitle Arab (cloud, GPU).
- **Local Segmentation (Python)**: alternatif offline dengan beberapa engine.
- **MP3Quran API**: daftar qari, URL audio, timing per ayat.
- **OpenAI API (atau kompatibel)**: trim terjemahan, bold, split subtitle, WBW mapping, AI plan.
- **YouTube API**: upload video (OAuth).
- **Pexels / Pixabay**: pencarian stock media.
- **Discord Rich Presence**: status aktivitas.
- **PostHog**: analytics.
- **Hugging Face**: download model local segmentation.

---

## 3. Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (WebView)                     │
│  Svelte 5 + SvelteKit (static adapter) + TypeScript + Runes  │
│  Tailwind CSS v4 · typesafe-i18n · class-transformer          │
│  UI: Home / ProjectEditor / Batch / AI Video / Exporter       │
│  State: GlobalState (Runes) + Class-based reactive models     │
└───────────────────────────┬─────────────────────────────────┘
                            │  Tauri IPC (`invoke`)
┌───────────────────────────▼─────────────────────────────────┐
│                     Backend (Tauri 2 / Rust)                 │
│  commands/  : files, media, auth, downloads, youtube, etc.   │
│  exporter/  : FFmpeg orchestration, codec, preprocess, TGA   │
│  segmentation/ : cloud API + local Python sidecar manager    │
│  binaries/  : resolve ffmpeg/ffprobe/yt-dlp                   │
│  plugins    : fs, dialog, store, notification, deep-link,    │
│               opener, updater, single-instance, process, log │
└───────┬─────────────────────────────────────────────┬───────┘
        │ spawn sidecar                                │ spawn/exec
┌───────▼──────────────────┐              ┌────────────▼──────────┐
│  Python sidecar (AI)     │              │  FFmpeg / FFprobe      │
│  torch, transformers,    │              │  yt-dlp                │
│  whisperx, sherpa-onnx,  │              │  (binary eksternal)    │
│  librosa, etc.           │              └───────────────────────┘
└──────────────────────────┘
```

**Prinsip kunci**: frontend menangani UI dan timeline; Rust menangani file system, window, dan
orchestrasi proses; Python menangani AI berat; FFmpeg menangani media.

---

## 4. Tech Stack Lengkap

| Lapisan | Teknologi | Versi (dipakai) | Keterangan |
| --- | --- | --- | --- |
| Frontend framework | Svelte + SvelteKit | Svelte 5, Kit 2.16 | Static adapter (`adapter-static`) |
| Bahasa frontend | TypeScript | 5.x | strict, decorators |
| Styling | Tailwind CSS | v4 | via `@tailwindcss/vite` |
| State | Svelte Runes | `$state`, `$derived`, `$effect` | Bukan `writable` stores |
| Desktop | Tauri | 2.6 | Rust backend |
| Bahasa backend | Rust | edition 2021, MSRV 1.77.2 | |
| AI/ML | Python | 3.10+ | sidecar, bukan embedded |
| Build tool | Vite | 6.x | |
| Testing | Vitest | 3.x | project `server` + `client` (Playwright) |
| Lint/Format | ESLint 9 + Prettier 3 | | |
| i18n | typesafe-i18n | 5.x | 6 bahasa: en, fr, es, de, id, zh |
| Media | FFmpeg / FFprobe / yt-dlp | binary eksternal | |

---

## 5. Dependensi Lengkap

### 5.1 npm (frontend)

**Dependencies**:

```
@sveltejs/adapter-static
@tauri-apps/api
@tauri-apps/plugin-deep-link
@tauri-apps/plugin-dialog
@tauri-apps/plugin-fs
@tauri-apps/plugin-notification
@tauri-apps/plugin-opener
@tauri-apps/plugin-process
@tauri-apps/plugin-store
@tauri-apps/plugin-updater
@types/dom-to-image
@types/howler
class-transformer
dom-to-image
dompurify
harfbuzzjs
howler
markdown-it (+ anchor, deflist, footnote, task-lists)
material-icons
modern-screenshot
plyr
posthog-js
qrcode
reflect-metadata
sharp
svelte-5-french-toast
wavesurfer.js
```

**DevDependencies**:

```
@eslint/compat, @eslint/js
@sveltejs/adapter-auto
@sveltejs/kit
@sveltejs/vite-plugin-svelte
@tailwindcss/forms, @tailwindcss/typography, @tailwindcss/vite
@tauri-apps/cli
@types/qrcode
@vitest/browser
eslint, eslint-config-prettier, eslint-plugin-svelte
globals
playwright
prettier, prettier-plugin-svelte, prettier-plugin-tailwindcss
svelte, svelte-check, svelte-contextmenu
tailwindcss
typesafe-i18n
typescript, typescript-eslint
vite, vitest, vitest-browser-svelte
```

### 5.2 Rust crates (`src-tauri/Cargo.toml`)

**Build dependencies**: `tauri-build` 2.3.

**Runtime dependencies utama**:

```
tauri 2.6 (features: protocol-asset, devtools)
tauri-plugin-log, opener, fs, store, deep-link, notification,
  single-instance, dialog, process, updater
serde, serde_json
log
dirs
font-kit
tokio (process, io-util, rt-multi-thread, fs, net, time)
reqwest (rustls-tls, json, multipart, stream)
base64, rand, sha2, regex, lazy_static, md5
image, rayon
rodio (symphonia-all)
pitch_shift
discord-rich-presence
fix-path-env
bytes, futures-util
keyring (apple-native, windows-native, sync-secret-service, crypto-rust)
screenshots
sysinfo
```

### 5.3 Python (sidecar local segmentation)

Ada **3 environment** terpisah, masing-masing dengan requirements sendiri:

**1. Local segmenter** (`src-tauri/python/requirements.txt`, ~2–3 GB):

```
torch>=2.0.0
torchaudio>=2.0.0
transformers>=4.40.0,<5.0.0
librosa>=0.10.0,<0.11.0
numpy>=1.24.0,<2.0.0
soundfile>=0.12.0,<0.13.0
recitations_segmenter>=1.0.0,<2.0.0
accelerate>=0.26.0,<1.0.0
```

**2. Surah splitter** (`surah_splitter_requirements.txt`):

```
cyclopts>=3.17.0
loguru>=0.7.3
pydub>=0.25.1
rich>=14.0.0
whisperx>=3.4.2
huggingface_hub>=0.30.0
numpy>=2.0.0,<3.0.0
```

**3. Word timing** (`word_timing_requirements.txt`):

```
numpy
librosa
pyloudnorm
onnxruntime
kaldi-native-fbank
sherpa-onnx>=1.10.32
requests
qua_sdk-0.5.9 (via URL .whl)
```

> Model-model didownload saat pertama kali dijalankan (via Hugging Face).

### 5.4 Binary eksternal (`src-tauri/binaries/`)

| Binary | Fungsi | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| `ffmpeg` | encode/decode media, export | `.exe` | tanpa ekstensi (brew) | tanpa ekstensi |
| `ffprobe` | probe durasi/format/dimensi | `.exe` | brew | tanpa ekstensi |
| `yt-dlp` | download video/audio | `.exe` | `yt-dlp_macos` | tanpa ekstensi |

---

## 6. Struktur Proyek

```text
src/
  lib/
    classes/          # Model domain reaktif (.svelte.ts): Project, Clip, Track,
                      #   Timeline, VideoStyle, Settings, Exportation, Exporter,
                      #   Batch, Quran, Reciter, Translation, VerseRange, dst.
    components/       # UI: home, projectEditor, batch, aiVideo, modals,
                      #   settings, reflection, tour, TitleBar, dst.
    services/         # Business logic: ExportService, AutoSegmentation,
                      #   BatchService, ProjectService, MigrationService,
                      #   WbwHelper, FontProvider, dst.
    constants/        # donation, export, projectEditor
    i18n/             # typesafe-i18n: en, fr, es, de, id, zh + formatters
    runes/            # main.svelte.ts → GlobalState (Runes)
    types/            # common, project, projectType, quranAuth, settings
  routes/
    +layout.svelte / +layout.ts / +page.svelte
    exporter/+page.svelte   # window export (capture PNG + panggil Tauri)
src-tauri/
  src/
    lib.rs / main.rs / path_utils.rs
    app/              # run(), invoke.rs (registrasi semua command IPC)
    binaries/         # resolver ffmpeg/ffprobe/yt-dlp + diagnostics
    commands/         # auth, diagnostics, discord, downloads, files, media,
                      #   preview_audio, screenshot, segmentation, stock_media,
                      #   waveform, youtube, ai_translation/
    exporter/         # batching, codec, commands, concat, constants,
                      #   ffmpeg_runner, ffmpeg_utils, filter_graph, memory,
                      #   preprocess, types
    segmentation/     # audio_merge, cloud, data_files, hifz, install, local,
                      #   python_env, requirements, status, types
    utils/            # path, process, temp_file
  python/             # sidecar: local_segmenter, surah_splitter, word_timing,
                      #   multi_aligner, dst. + requirements-*.txt
  binaries/           # ffmpeg, ffprobe, yt-dlp
  capabilities/       # default.json (izin IPC)
  resources/          # notifications
  icons/
  tauri.conf.json / Cargo.toml / build.rs
static/
  styles/             # styles.json, globalStyles.json, customText/Image,
                      #   compositeStyles.json (Sumber kebenaran style editor)
  quran/ QPC1/ QPC2/ ayah-container/ minimal-quran/ qua/ riwayat/
  translations/ reciters/ prompts/ tutorial/
  font: Hafs.ttf, IndoPak.ttf, Basmalah-1-to-122.ttf, Surahs.ttf, dst.
scripts/              # download data, SVG processing, reciter management,
                      #   sync quran/riwayat, prepare.cjs, git hooks
documentations/       # video-export, rendering, style-json, ai-video-creation,
                      #   system-font-export
tests/                # server (node) + client (browser)
```

---

## 7. Model Domain (Frontend)

State proyek disimpan sebagai **JSON** dan di-rehydrate menjadi class reaktif via
`class-transformer`.

- **Project** → `ProjectDetail` + `ProjectContent`
- **ProjectContent** → berisi `Timeline`, track, clip, style, translation
- **Timeline** → kumpulan `Track` (Video, Audio, Subtitle, Custom, dst.)
- **Clip** → base class untuk `SubtitleClip`, `PredefinedSubtitleClip`, `CustomTextClip`,
  `CustomImageClip`, dst.
- **VideoStyle** → hierarki `global`, `arabic`, `<edition>`; sumber default dari
  `static/styles/*.json`
- **Exportation / Exporter** → status dan progress export
- **Settings** → preferensi pengguna (persistent UI state, AI settings)
- **Quran / Reciter / Translation** → data referensi

**Aturan penting**: semua mutasi state proyek harus lewat `ProjectHistoryManager`
(`.track()`, `.begin()/.commit()`, `.trackAsync()`) agar undo/redo tetap berfungsi.

---

## 8. Backend Rust — Command IPC

Semua command didaftarkan di `src-tauri/src/app/invoke.rs`. Total ada ~50 command. Grup utama:

| Grup | Command (contoh) | Fungsi |
| --- | --- | --- |
| `files` | `save_file`, `save_binary_file`, `copy_file`, `download_file`, `delete_file`, `move_file`, `send_http_get/text` | Operasi file & HTTP proxy |
| `media` | `get_duration`, `get_video_dimensions`, `is_constant_bitrate`, `convert_audio_to_cbr`, `cut_audio`, `cut_video`, `concat_audio`, `get_system_fonts` | Media via FFmpeg/FFprobe |
| `exporter` | `export_video`, `cancel_export`, `concat_videos` | Pipeline export |
| `segmentation` | `segment_quran_audio`, `segment_quran_audio_local*`, `generate_hifz_audio`, `preload_*`, `install_local_segmentation_deps` | Segmentasi cloud + local |
| `ai_translation` | `run_advanced_ai_*_batch_streaming` | Streaming AI (trim, bold, split, WBW) |
| `auth` | `quran_auth_secure_set/get/delete` | Keyring auth Quran.com |
| `downloads` | `download_from_youtube` | yt-dlp |
| `youtube` | `youtube_auth_status/connect/disconnect/upload_video` | OAuth YouTube |
| `preview_audio` | `control_preview_audio` | Audio player native (rodio) |
| `waveform` | `get_audio_waveform` | Bentuk gelombang |
| `screenshot` | `capture_window_screenshot` | Screenshot window |
| `discord` | `init/update/clear/close_discord_rpc` | Rich Presence |
| `stock_media` | `search_stock_media` | Pexels/Pixabay |
| `diagnostics` | `diagnose_media_binaries` | Cek binary |

**Konvensi**: parameter Tauri otomatis dikonversi `camelCase` → `snake_case`.

---

## 9. Pipeline AI / Segmentasi

### 9.1 Cloud

`AutoSegmentation` service berkomunikasi dengan **Multi-Aligner API** (cloud). Mendukung:
segmentasi ayat, timestamps MFA (word-by-word), preload recitations/segments. Ada fallback
CPU ketika kuota GPU habis.

### 9.2 Local (Python sidecar)

Empat engine lokal:

| Engine | Script Python | Kebutuhan |
| --- | --- | --- |
| Local segmenter | `local_segmenter.py` | `requirements.txt` (torch + transformers) |
| Local multi-aligner | `local_multi_aligner_segmenter.py` | `quran-multi-aligner/` |
| Surah splitter | `local_surah_splitter_segmenter.py` | `surah_splitter_requirements.txt` |
| Word timing | `local_word_timing_segmenter.py` | `word_timing_requirements.txt` (sherpa-onnx) |

**Manajemen environment** (`segmentation/python_env.rs`):
- Python minimum 3.10.
- Setiap engine punya venv sendiri di `<app_data>/python_envs/seg-<engine>`.
- Deteksi Python sistem (Windows/macOS/Linux), buat venv, cek import module.
- Dukungan token Hugging Face via env `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN`.

---

## 10. Pipeline Export Video

Pipeline cepat default (`src-tauri/src/exporter/commands.rs`):

```
Frontend capture PNG bertimestamp (0.png, 280.png, 1000.png, ...)
        → Rust scan PNG + bangun timeline overlay TGA
        → FFmpeg mux audio/video → file final
```

**Poin penting**:
- Frontend **tidak** capture tiap frame; hanya capture state visual penting overlay.
- PNG dinamai dengan timestamp timeline terkompensasi (untuk fade).
- Rust menghitung fade antar frame, optimasi tile 16x16 untuk area berubah.
- **Chemin direct** dipakai jika: bukan transparan, tanpa video background, frame opaque,
  tanpa fade global, audio sederhana.
- **Audio stream-copy** untuk audio tunggal yang kompatibel (hindari re-encode MP3).
- **Background video**: dinormalisasi (scale+pad contain, fps, setsar, blur opsional),
  cache di `%TEMP%/qurancaption-preproc`.
- **Codec selection** (`codec.rs`): deteksi NVENC/QSV/AMF/VideoToolbox, fallback libx264.
  Profil performa: `Fastest`, `Balanced`, `LowCpu`.
- **Export transparan**: MOV (`argb`) atau WebM (`yuva420p`).

**Subsetting font sistem** (Windows/Linux): sebelum `modern-screenshot`, font sistem berat
direduksi memakai **HarfBuzz** ke subset karakter yang terlihat (mis. `msjh.ttc` dari 21 MB →
8 KB). macOS memakai jalur canvas terpisah.

---

## 11. Sistem Style & UI Editor

- Sumber kebenaran: `static/styles/styles.json` + `static/styles/globalStyles.json`
  (+ `customText.json`, `customImage.json`, `compositeStyles.json`).
- Editor `StyleEditor` diturunkan dari metadata `ui.panel`, `ui.groups`, `ui.headerStyle`
  pada JSON — jangan hardcode mapping di Svelte.
- Setiap style punya `id` stabil, `valueType`, `valueMin/Max/step`, `options`, `css`
  (dengan placeholder `{value}`), `tailwind`, `icon`.
- Undo/redo wajib untuk perubahan nilai.
- Perubahan identitas style lama butuh `MigrationService`.

---

## 12. Rendering Preview (8 Lapisan)

Lihat `documentations/rendering.md`. Struktur overlay:

1. Grid alignment
2. Image terkait subtitle
3. Overlay efek (blur, warna, gradasi — 14 mode fade)
4. Background subtitle (selalu terlihat)
5. Subtitle Arab (3 mode: polos, decorative brackets, word-by-word WBW)
6. Terjemahan (per edition, styles inline per kata)
7. Dekorasi tetap (SurahName, ReciterName, VerseNumber)
8. Clips custom (CustomText, CustomImage)

Fitur rendering: reactive font size (max-height), anti-collision, fade in/out, visual merge.

---

## 13. Konfigurasi Tauri

`src-tauri/tauri.conf.json`:

- **Window**: 1024x768 (min), resizable, `decorations: false` (custom titlebar).
- **Asset protocol**: scope `**` + semua `$APP*`, `$AUDIO`, `$CACHE`, `$CONFIG`, `$DATA`,
  `$DESKTOP`, `$DOCUMENT`, `$DOWNLOAD`, `$FONT`, `$HOME`, `$PICTURE`, `$VIDEO`, `$TEMP`, dst.
- **Bundle**: target `deb`, `appimage`, `app`, `dmg`, `nsis`. Resources: `binaries/**`,
  `resources/notifications/**`, `python/**`.
- **Updater**: public key + endpoint GitHub release `latest.json`.
- **Deep link**: scheme `qurancaption`.
- **macOS**: hardened runtime, min OS 10.13.
- **Linux deb**: depends `libc6`, `libgtk-3-0`, `libwebkit2gtk-4.1-0`.

`src-tauri/capabilities/default.json` mengaktifkan izin: `core:default`, `fs` (scope `**`),
`opener`, `dialog`, `deep-link`, `notification`, `store`, `webview`, window controls,
`updater`, `process:allow-restart`.

---

## 14. Build, Setup & Testing

### 14.1 Prasyarat

- Node.js 18+ (LTS)
- Rust stable (rustup), MSRV 1.77.2
- Python 3.10+
- FFmpeg/FFprobe/yt-dlp di `src-tauri/binaries/`

### 14.2 Perintah

```bash
npm install
npm run tauri dev       # dev server + window Tauri
npm run dev             # hanya Vite
npm run build           # vite build (frontendDist: ../build)
npm run tauri build     # produksi
npm run check           # svelte-check
npm run lint            # prettier + eslint
npm run test:unit       # vitest (server/node)
npm run test:browser    # vitest (client/playwright)
npm run verify          # check + test
cargo check --manifest-path src-tauri/Cargo.toml   # cek Rust
```

### 14.3 Testing

- **Unit (server)**: `tests/server/**` → Vitest, environment `node`.
- **Browser (client)**: `tests/client/**` → Vitest browser + Playwright Chromium.

---

## 15. Rencana Penulisan Ulang / Merge

### 15.1 Strategi Rekomendasi

Karena aplikasi sudah Tauri, **jangan tulis ulang dari nol**. Prioritaskan refactor bertahap:

1. **Pertahankan kontrak backend (IPC)**: `src-tauri/src/app/invoke.rs` dan command signature
   adalah kontrak stabil yang dipakai frontend.
2. **Refactor UI secara inkremental**: ganti komponen per halaman (Home → ProjectEditor →
   Batch → Exporter) tanpa mengubah service/state.
3. **Pisahkan domain logic dari UI**: pindahkan logika murni ke `services/` (sudah banyak
   dilakukan) agar mudah diuji dan di-merge.
4. **Standardisasi state**: pertahankan Svelte Runes + `GlobalState` (`runes/main.svelte.ts`)
   sebagai satu pintu state.

### 15.2 Jika Menggabungkan dengan Project Lain

- **Frontend lain (React/Vue)**: Tauri hanya peduli ke `frontendDist` (folder build statis).
  Ganti frontend bisa tanpa menyentuh Rust, asal memanggil command IPC yang sama dan
  memetakan model domain (`Project`, `Clip`, `VideoStyle`, dst.).
- **Backend lain (Go/Node sidecar)**: ganti Python sidecar boleh selama menerima input yang
  sama (audio path + opsi) dan mengembalikan JSON timestamp yang sama.
- **UI lebih praktis**: pertimbangkan mengganti beberapa modal/panel menjadi satu workspace
  terpadu, memanfaatkan `StyleDefinitionCatalog` + JSON metadata agar editor tetap
  data-driven.

### 15.3 Checklist Migrasi

- [ ] Pastikan `frontendDist` diarahkan ke output build frontend baru.
- [ ] Petakan ulang semua `invoke('command', args)` frontend → command Rust.
- [ ] Pertahankan `class-transformer` (atau buat mapper) untuk load proyek JSON lama.
- [ ] Implementasi ulang `ProjectHistoryManager` (undo/redo) untuk semua mutasi state.
- [ ] Implementasi ulang `VideoStyle.generateCSS()` + JSON metadata style.
- [ ] Pertahankan pipeline export: capture PNG → TGA → FFmpeg (jangan ganti dengan encode
      realtime per frame).
- [ ] Pertahankan subset font HarfBuzz di Windows/Linux saat capture.
- [ ] Pertahankan manajemen venv Python + 3 requirements terpisah.
- [ ] Lokalkan semua teks baru di 6 bahasa (en, fr, es, de, id, zh) via `LL`/`get(LL)`.

---

## 16. Risiko & Pertimbangan

| Risiko | Mitigasi |
| --- | --- |
| Ukuran sidecar Python besar (~2–3 GB torch + model) | Pertahankan sebagai install opsional; simpan di app_data; gunakan cloud sebagai default. |
| Kompatibilitas proyek JSON lama | Gunakan `MigrationService` + `ensureStylesSchemaUpToDate()`. |
| Perbedaan renderer screenshot antar OS | macOS canvas path vs Windows/Linux `domToBlob()` + HarfBuzz subset; jangan disamakan. |
| Undo/redo terlewat | Wajibkan `ProjectHistoryManager` untuk semua mutasi. |
| Keamanan `fs:scope **` | Untuk rewrite, sebaiknya persempit scope sesuai kebutuhan riil. |
| Deep-link & updater | Jangan hapus konfigurasi jika distribusi publik tetap dipakai. |

---

## 17. Kesimpulan

Penulisan ulang **Quran Caption** harus tetap mempertahankan tiga pilar:

1. **Tauri 2 + Rust** sebagai backend desktop (file, media, proses, window).
2. **Svelte 5 + Runes + Tailwind v4** sebagai frontend reaktif dengan state terpusat.
3. **Python sidecar + FFmpeg** sebagai mesin AI dan media yang bisa dijalankan lokal/cloud.

Target refactor adalah **UI lebih praktis dan kode lebih terstruktur**, bukan mengganti
fondasi teknologi yang sudah bekerja. Gunakan dokumen ini sebagai checklist presisi agar
perilaku inti (segmentasi, subtitle, style, export, undo/redo, i18n) tidak hilang.
