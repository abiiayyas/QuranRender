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

## 3. Menjalankan aplikasi (mode pengembangan)

```bash
pnpm --filter @quranrender/desktop tauri dev
```

Mode dev mencari font, template, dan dataset di akar repositori. Folder proyek disimpan di `~/QuranRender/Projects`
dan indeks di `~/QuranRender/app.db`.

Variabel lingkungan:

| Variabel | Fungsi |
|---|---|
| `QR_RESOURCES_DIR` | akar sumber daya (berisi `assets/fonts`, `crates/qr-render/templates`, `build/dataset`) |
| `QR_DATASET_DIR` | folder dataset (default: `<resources>/build/dataset`) |
| `QR_WORKER_BIN` | biner worker `qurender` untuk ekspor/antrean. Urutan pencarian: variabel ini → saudara executable aplikasi (`Contents/MacOS/qurender` di bundel; `target/<profil>/qurender` saat dev, setelah `cargo build -p qr-cli`) → `qurender` di `PATH` → galat yang menyebut semua tempat yang dicari. Bila diset tetapi salah, galat (tidak jatuh diam-diam ke kandidat lain). |
| `QR_FFMPEG_BIN`, `QR_FFPROBE_BIN` | jalur `ffmpeg`/`ffprobe`. Default: `PATH`, lalu `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` (aplikasi macOS yang dibuka dari Finder tidak mewarisi `PATH` Homebrew). |

## 4. Build bundel aplikasi

macOS (menghasilkan `Quran Render.app`, ±25 MiB):

```bash
cd apps/desktop
pnpm tauri build --bundles app
# hasil: target/release/bundle/macos/Quran Render.app
```

Bundel membawa font, template, dan dataset (lihat `bundle.resources` di `apps/desktop/src-tauri/tauri.conf.json`),
sehingga **`build/dataset` harus sudah ada sebelum build bundel**. Saat start, aplikasi mencetak ringkasan
pemeriksaan sumber daya ke stderr (`[Quran Render] sumber daya OK ...`).

Menjalankan biner di dalam bundel dari terminal untuk melihat log:

```bash
"target/release/bundle/macos/Quran Render.app/Contents/MacOS/quranrender"
```

Installer Windows (NSIS) dan Linux (AppImage/.deb): didefinisikan di CI, **belum pernah dibangun**. FFmpeg belum
dibundel; aplikasi memakai `ffmpeg`/`ffprobe` dari `PATH` (atau lokasi umum di atas).

### Worker ekspor sebagai sidecar (macOS, terverifikasi)

Ekspor video berjalan lewat proses `qurender worker`. Agar bundel membawanya, bangun sidecar lalu bundel dengan
konfigurasi tambahan (config terpisah agar `cargo test -p quranrender` tidak mensyaratkan biner sidecar):

```bash
scripts/prepare-worker-sidecar.sh          # build rilis qr-cli → apps/desktop/src-tauri/binaries/qurender-<triple>
cd apps/desktop
pnpm tauri build --bundles app --config src-tauri/tauri.sidecar.conf.json
ls "../../target/release/bundle/macos/Quran Render.app/Contents/MacOS"   # quranrender  qurender
```

Tanpa `--config src-tauri/tauri.sidecar.conf.json`, bundel **tidak** membawa worker dan ekspor hanya jalan bila
`QR_WORKER_BIN`/`PATH` menyediakannya. Hanya macOS x86_64 yang diuji; Windows/Linux belum.

## 5. Build dan pakai CLI/worker (`qurender`)

```bash
cargo build --release -p qr-cli
./target/release/qurender --version

# Ekspor MP4 dari folder proyek
./target/release/qurender render <folder.qrproj> <keluaran.mp4> \
    [--audio berkas] [--width N] [--max-seconds S] [--threads N] [--overwrite] [--encoder libx264 --crf N]

# Validasi proyek terhadap kebijakan konten
./target/release/qurender validate <path/project.json>

# Worker NDJSON (stdin/stdout), dipakai oleh antrean job
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
| `bundled_app_worker_is_found_next_to_the_executable_*` | bundel `.app` dengan sidecar (lihat §4); worker dan sumber daya diambil dari bundel dengan `PATH` minimal |
| `real_engine_plays_a_sine_at_volume_zero_through_the_service` | perangkat audio keluaran (volume 0) |

Varian tanpa dataset/perangkat (jalan di `cargo test` biasa): worker palsu berbasis skrip `sh` (Unix) yang berbicara
protokol NDJSON membuktikan alur `export_start` → event `export-progress` → `export-finished`, pembatalan,
jeda/lanjut antrean, dan antrean batch; controller playback diuji dengan engine palsu.

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
| Command desktop (subtitle, preview, pack, crash log, impor audio, align_auto, ekspor/antrean/batch, playback, settings) | `cargo test -p quranrender` |

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
