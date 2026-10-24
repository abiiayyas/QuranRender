# 07 — Build dan Test (lokal)

Panduan membangun dan menguji **Quran Render** di mesin lokal. Semua perintah di bagian macOS sudah dijalankan
pada macOS (x86_64). Bagian Linux/Windows diambil dari workflow CI dan **belum pernah diuji**.

## 1. Prasyarat

| Kebutuhan | Versi / catatan |
|---|---|
| Rust | toolchain stabil terbaru (`rustup`), komponen `rustfmt` dan `clippy` |
| Node.js | 22 |
| pnpm | 9 atau lebih baru (`corepack enable`) |
| `ffmpeg` dan `ffprobe` | harus ada di `PATH`, dengan `libx264` dan `aac`. macOS: `brew install ffmpeg`. Dipakai oleh ekspor video dan beberapa tes. |
| `cargo-deny` | `cargo install cargo-deny` (hanya untuk pemeriksaan lisensi/advisori) |
| Linux saja (belum diuji) | `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libasound2-dev ffmpeg` |

Opsional: `hb-shape` (HarfBuzz) hanya diperlukan bila ingin membuat ulang fixture referensi shaping; fixture-nya sudah
dikomit (`crates/qr-render/tests/fixtures/hb_shape_ref.json`).

## 2. Menyiapkan repositori

```bash
git clone git@github.com:abiiayyas/QuranRender.git
cd QuranRender
pnpm install
```

### Dataset Al-Qur'an (`build/dataset`)

Dataset **tidak** dikomit (di-gitignore). Bangun dari sumber di `data/`:

```bash
cargo run -p qr-dataset -- verify-sources      # periksa manifest dan struktur sumber
cargo run -p qr-dataset -- build               # menulis build/dataset/{quran.db, dataset-manifest.json, ...}
```

Build bersifat reproducible: dua kali build menghasilkan SHA-256 `quran.db` yang sama.

`build/dataset/dataset-manifest.json.minisig` adalah tanda tangan manifest. Berkas ini dibuat dengan kunci rahasia
dataset yang **tidak ada di repositori**. Tanpa kunci rahasia Anda sendiri, dataset hasil build lokal tidak lolos
verifikasi aplikasi. Lihat bagian 7 (kunci tanda tangan).

## 3. Perintah utama

Dua perintah dari akar repositori, tanpa langkah lain:

| Tujuan | Perintah | Hasil |
|---|---|---|
| Menjalankan aplikasi untuk dicoba (mode pengembangan, muat ulang otomatis) | `pnpm app` | jendela Quran Render |
| Membuat installer macOS | `pnpm dmg` | `target/release/bundle/dmg/Quran Render_<versi>_<arsitektur>.dmg` |

Ekspor video berjalan di proses terpisah, tetapi proses itu adalah **executable aplikasi yang sama** yang
dijalankan ulang dengan argumen `worker`. Tidak ada biner kedua yang perlu dibangun atau dibundel: `pnpm app`
langsung bisa mengekspor, dan `.app` di dalam `.dmg` hanya berisi `Contents/MacOS/quranrender`.

Mode dev mencari font, template, dan dataset di akar repositori. Folder proyek disimpan di `~/QuranRender/Projects`
dan indeks di `~/QuranRender/app.db`.

Variabel lingkungan:

| Variabel | Fungsi |
|---|---|
| `QR_RESOURCES_DIR` | akar sumber daya (berisi `assets/fonts`, `crates/qr-render/templates`, `build/dataset`) |
| `QR_DATASET_DIR` | folder dataset (default: `<resources>/build/dataset`) |
| `QR_CONTENT_DB` | `content.db` edisi terjemahan unduhan (default aplikasi: `~/QuranRender/content.db`). Aplikasi meneruskannya ke worker ekspor; worker meng-ATTACH berkas ini read-only ke `quran.db`, jadi preview, ekspor, dan subtitle membaca edisi yang sama tanpa teks terjemahan di payload job. |
| `QR_WORKER_BIN` | menimpa worker ekspor (mis. biner `qurender` atau worker palsu saat uji). Default: executable aplikasi itu sendiri (`<app> worker`). Bila diset tetapi berkasnya tidak ada, galat (tidak jatuh diam-diam ke aplikasi). |
| `QR_FFMPEG_BIN`, `QR_FFPROBE_BIN` | jalur `ffmpeg`/`ffprobe`. Default: `PATH`, lalu `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` (aplikasi macOS yang dibuka dari Finder tidak mewarisi `PATH` Homebrew). |

## 4. Installer `.dmg` (macOS)

```bash
pnpm dmg
# hasil: target/release/bundle/dmg/Quran Render_0.1.0_x64.dmg
```

Prasyarat: `build/dataset` sudah ada (lihat §2), karena bundel membawa font, template, dan dataset
(`bundle.resources` di `apps/desktop/src-tauri/tauri.conf.json`). Tanpa dataset, build berhenti dengan galat yang
menyebut berkas yang hilang.

- Aplikasi ditandatangani **ad-hoc** (`bundle.macOS.signingIdentity: "-"`), belum dengan sertifikat Developer ID dan
  belum dinotarisasi. Di Mac lain, buka pertama kali lewat klik kanan › *Buka* (Gatekeeper).
- Arsitektur mengikuti mesin yang membangun (`x64` di Mac Intel, `aarch64` di Apple Silicon). Universal binary
  belum dibuat.
- FFmpeg belum dibundel: `ffmpeg`/`ffprobe` tetap diambil dari `PATH` atau lokasi Homebrew umum.

Hanya `.app` tanpa `.dmg`: `pnpm --filter @quranrender/desktop tauri build --bundles app`
(`target/release/bundle/macos/Quran Render.app`). Log saat start (`[Quran Render] sumber daya OK ...`) terlihat bila
biner di dalam bundel dijalankan dari terminal:

```bash
"target/release/bundle/macos/Quran Render.app/Contents/MacOS/quranrender"
```

Installer Windows (NSIS) dan Linux (AppImage/.deb): didefinisikan di CI, **belum pernah dibangun**.

## 5. CLI pengembang `qurender` (opsional)

Tidak diperlukan untuk aplikasi maupun installer. Berguna untuk render tanpa UI (PRD RND-4) dan uji regresi:

```bash
cargo build --release -p qr-cli
./target/release/qurender --version

# Ekspor MP4 dari folder proyek
./target/release/qurender render <folder.qrproj> <keluaran.mp4> \
    [--audio berkas] [--width N] [--max-seconds S] [--threads N] [--overwrite] [--encoder libx264 --crf N]

# Validasi proyek terhadap kebijakan konten
./target/release/qurender validate <path/project.json>

# Worker NDJSON (stdin/stdout); protokol yang sama dengan `<app> worker`
./target/release/qurender worker
```

Kode galat penting: `OUTPUT_EXISTS`, `AUDIO_MISSING`, `INVALID_PAYLOAD`, `CNT-5-OVERFLOW` (ayat tidak muat satu layar;
bagi segmen per rentang kata), `MISSING_VERSE`, `EXPORT_BLOCKED`, `CANCELED`.

## 6. Test

### 6.1 Rangkaian standar (tidak butuh dataset bertanda tangan)

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo deny check
pnpm -r build
pnpm --filter @quranrender/desktop lint:design
pnpm --filter @quranrender/desktop lint:a11y
pnpm --filter @quranrender/desktop lint:i18n
```

Catatan:
- `cargo test --workspace` butuh `ffmpeg`/`ffprobe` di `PATH`. Tes yang membandingkan preview dan ekspor (SSIM) lambat
  pada build debug (±170 dtk); gunakan `--release` bila ingin cepat: `cargo test --release --workspace --all-targets`.
- Gunakan `--no-fail-fast` agar semua crate tetap dijalankan walau satu gagal.
- `cargo test -p quranrender` meregenerasi `apps/desktop/src/bindings.ts`. Setelah mengubah command Tauri, jalankan
  lalu komit hasilnya.
- Tes golden render membandingkan hash piksel dengan `tests/golden/render/manifest.json`. Perbarui **sengaja** (setelah
  memeriksa PNG secara visual): `QR_UPDATE_GOLDEN=1 cargo test -p qr-render --test render_golden golden_frames`.

### 6.2 Tes yang di-`#[ignore]` (butuh dataset bertanda tangan atau perangkat audio)

```bash
cargo test --workspace --no-fail-fast -- --ignored
```

Mencakup: verifikasi dataset (`qr-quran`), subtitle/preview dari dataset (`quranrender`), antrean 50 klip dan
pembatalan worker (`qr-cli`), dan smoke perangkat audio nyata (`qr-media`, memutar sine pada volume 0).

Di `quranrender` (`cargo test -p quranrender -- --ignored`):

| Tes | Syarat |
|---|---|
| `real_worker_exports_a_valid_mp4_*`, `real_worker_cancel_mid_export_*` | dataset bertanda tangan; `cargo build -p qr-cli` dijalankan otomatis oleh tes. Ekspor 2 dtk diverifikasi `ffprobe` (h264, 270×480, 60 frame, aac); pembatalan di tengah ekspor tidak meninggalkan berkas |
| `bundled_app_runs_itself_as_the_worker_*` | bundel `.app` (lihat §4); bundel hanya berisi satu biner, worker = executable aplikasi, sumber daya diambil dari bundel dengan `PATH` minimal |
| `real_engine_plays_a_sine_at_volume_zero_through_the_service` | perangkat audio keluaran (volume 0) |

Varian tanpa dataset/perangkat (jalan di `cargo test` biasa): worker palsu berbasis skrip `sh` (Unix) yang berbicara
protokol NDJSON membuktikan alur `export_start` → event `export-progress` → `export-finished`, pembatalan,
jeda/lanjut antrean, dan antrean batch; controller playback diuji dengan engine palsu.

Aligner cloud (`qr-sources`, butuh internet dan klip audio; jangan komit audionya):

```bash
ffmpeg -i surah.mp3 -t 40 -ac 1 -ar 16000 -c:a flac /tmp/klip.flac
QR_CLOUD_ALIGNER_CLIP=/tmp/klip.flac cargo test -p qr-sources live_space -- --ignored --nocapture
```

Tabel pemetaan kata aligner → dataset dibangkitkan ulang dengan `node scripts/gen-cloud-aligner-word-map.mjs`
(petunjuk unduhan `digital_khatt_v2_script.json` ada di kepala skrip).

Pemasangan edisi Quran.com nyata (butuh internet + `build/dataset/quran.db`):

```bash
cargo test -p qr-sources --test live_quran_com -- --ignored --nocapture
```

### 6.3 Per area

| Area | Perintah |
|---|---|
| Shaping Arab (6.236 ayat + fixture HarfBuzz) | `cargo test -p qr-render --test shaping_regression` |
| Golden render 13 frame | `cargo test -p qr-render --test render_golden` |
| Fuzzing input rusak | `cargo test -p qr-core -p qr-render -p qr-sources -p qr-quran -p qr-media fuzz` |
| Ekspor MP4, probe, decode, audio engine | `cargo test -p qr-media` |
| Worker render, antrean, kesetaraan preview–ekspor | `cargo test --release -p qr-cli` |
| Antrean job persisten | `cargo test -p qr-store -p qr-jobs` |
| `.qrpack`, migrasi skema | `cargo test -p qr-core` |
| Command desktop (subtitle, preview, pack, crash log, impor audio, align_auto, align_cloud, ekspor/antrean/batch, playback, settings) | `cargo test -p quranrender` |
| Aligner cloud: SSE, pemetaan fixture → segmen, tabel kata 138 ayat | `cargo test -p qr-sources cloud_aligner` |

## 7. Kunci tanda tangan (dataset dan updater)

Kunci publik ada di `assets/keys/dataset.pub` dan `assets/keys/updater.pub`. Kunci rahasia **tidak** boleh dikomit.

Kunci yang saat ini ada dibuat tanpa kata sandi untuk pengembangan dan **harus dibuat ulang** sebelum rilis:

```bash
minisign -G -p assets/keys/dataset.pub -s ~/.minisign/dataset.key    # isi kata sandi saat diminta
```

Lalu tanda tangani ulang manifest dataset dan perbarui kunci publik. Tes verifikasi di `qr-sources` memakai kunci
publik repositori.

## 8. Pemecahan masalah

| Gejala | Penyebab / solusi |
|---|---|
| `Dataset Quran tidak dapat dibuka` | `build/dataset` belum dibuat atau tanda tangan tidak cocok dengan `assets/keys/dataset.pub` |
| `FFMPEG_MISSING` / tes ekspor gagal | `ffmpeg`/`ffprobe` tidak ada di `PATH` |
| Tes desktop gagal pada build `--release` | pastikan `QR_RESOURCES_DIR` tidak diset sembarangan; tes memakai akar repositori |
| `cargo deny` menolak dependensi | lihat advisori/lisensi; `ttf-parser` sengaja dilarang |
| Ekspor `CNT-5-OVERFLOW` | ayat terlalu panjang untuk satu layar; bagi segmen per rentang kata |
| Encoder hardware gagal | otomatis jatuh ke `libx264`; hasilnya tercatat di ringkasan ekspor |

## 9. CI

Workflow `.github/workflows/ci.yml` ada tetapi **dinonaktifkan** di GitHub dan belum pernah selesai dijalankan.
Aktifkan kembali dengan `gh workflow enable ci.yml`. Prioritas saat ini adalah build dan test lokal.
