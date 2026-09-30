# Quran Render — Rencana Eksekusi Adopsi QuranCaption

Dokumen ini menerjemahkan [Modifiy.md](./Modifiy.md) menjadi rencana implementasi untuk
repository QuranRender. QuranCaption hanya menjadi referensi kebutuhan dan perilaku tingkat
produk; tidak ada kode atau asetnya yang menjadi dependency produk ini.

## Keputusan awal

- **Strategi:** clean-room reimplementation. Jangan menyalin, mem-port, atau menggabungkan kode,
  aset, model, data, test fixture, atau struktur internal QuranCaption.
- **Frontend:** pertahankan React 19 + TypeScript + Vite + Zustand. PRD sumber memakai Svelte,
  tetapi porting framework akan menambah risiko tanpa memberi nilai produk langsung.
- **Backend:** pertahankan Tauri 2 + Rust. Modul lokal (`commands`, `render`, `ai`, `clipper`)
  menjadi titik integrasi dan akan dipecah setelah kontrak stabil.
- **Referensi:** dokumentasi publik boleh dipakai untuk menyusun requirement dan menguji perilaku
  umum; implementasi ditulis independen berdasarkan spesifikasi kita sendiri.
- **Lisensi produk:** kode baru dapat dirilis proprietary/commercial. Setiap dependency harus
  lolos audit lisensi dan memiliki NOTICE/SBOM bila diperlukan.
- **Urutan:** data/domain → IPC dan media → segmentasi → editor/style → export → batch/integrasi.

## Kondisi baseline

Yang sudah ada dan dipertahankan: halaman Home, Editor, Clipper, Queue, Settings; store QuranAyah
dan Slide; cache SQLite; fetch Quran.com; worker render FFmpeg; AI tafsir/gambar/audio; dan alur
yt-dlp. Yang belum setara PRD: project schema versioning, history undo/redo, style metadata,
waveform/timeline yang formal, cloud/local segmentation, sidecar Python, binary bundling,
export pipeline berlapis, i18n, auth, dan test harness.

## Arsitektur target

```text
React UI → domain services + Zustand project store → typed IPC client
                                      ↓
                         Tauri commands (Rust)
                    ↙           ↓             ↘
              SQLite/cache   FFmpeg        Python sidecar
```

Satu `ProjectDocument` JSON menjadi sumber kebenaran editor. SQLite menyimpan metadata/cache,
bukan salinan state yang berbeda. Semua perubahan proyek melalui `ProjectHistoryManager`.

## Fase dan deliverable

### Fase 0 — Audit, legal, dan baseline (2–4 hari)

1. Catat QuranCaption sebagai **referensi eksternal saja**, bukan dependency atau source yang
   di-derive. CC BY-NC 4.0 melarang penggunaan material untuk tujuan komersial
   ([teks lisensi resmi](https://creativecommons.org/licenses/by-nc/4.0/)).
2. Buat `THIRD_PARTY.md` dan `LICENSE_POLICY.md` yang melarang masuknya kode/aset NC ke build.
3. Inventaris lisensi seluruh dependency npm/Rust/Python, font, data terjemahan, model AI,
   FFmpeg/yt-dlp, dan stock media. Tandai `allowed-commercial`, `review`, atau `blocked`.
4. Jalankan `npm run build` dan `cargo check`; catat kegagalan baseline.
5. Buat matriks command saat ini vs requirement PRD dan fixture milik sendiri.

**Gate:** build baseline hijau atau semua kegagalan terdokumentasi; keputusan lisensi disetujui.

### Fase 1 — Domain model dan persistence (3–5 hari)

1. Ganti `currentProject: any` dengan tipe `ProjectDocument` berversi: project, timeline,
   tracks, clips/slides, translations, styles, export settings, dan assets.
2. Buat mapper dari shape store lama (`verses`/`slides`/`customization`) ke schema baru.
3. Implementasikan `loadProject`, `saveProject`, migration version, autosave, dan asset paths.
4. Implementasikan history transaction (`track`, `begin/commit`, `undo`, `redo`) dan uji setiap
   action store yang mengubah project.

**Gate:** round-trip JSON tidak kehilangan data; undo/redo bekerja untuk split, delete, style,
translation, dan durasi.

### Fase 2 — Kontrak IPC dan media foundation (3–5 hari)

1. Buat `src/lib/ipc.ts` typed wrapper untuk command Tauri; hilangkan pemanggilan `invoke`
   langsung dari komponen.
2. Stabilkan command files, media, settings, cache, waveform, dan render queue dengan error
   code terstruktur (bukan hanya `String`).
3. Tambahkan resolver binary bundled → system fallback untuk FFmpeg/FFprobe/yt-dlp; command
   diagnostics harus menjelaskan binary yang dipakai.
4. Tambahkan get duration/dimensions, convert/cut/concat audio, cancellation, dan event progress.

**Gate:** fixture audio dapat diprobe, dipotong, dan dibatalkan lintas macOS/Linux/Windows CI.

### Fase 3 — Segmentasi AI (5–10 hari)

1. Definisikan `SegmentRequest`, `AyahSegment`, `WordTiming`, `SegmentationResult` milik kita
   sendiri dan gunakan untuk cloud maupun local.
2. Port adapter cloud Multi-Aligner terlebih dahulu dengan retry, timeout, quota, dan fallback
   CPU; simpan hasil/cancel/progress secara streaming.
3. Tambahkan Python sidecar per engine (venv di app data, Python >=3.10, requirements terpisah,
   validasi import, HF token); mulai dari satu engine MVP lalu engine lain.
4. Normalisasi basmala, isti'adha, silence, mid-ayah split, dan word timing dalam Rust/domain
   service, bukan di UI.
5. Tambahkan AI translation trim sebagai service terpisah dengan manual override.

**Gate:** input yang sama menghasilkan schema identik cloud/local; kegagalan engine dapat
   dipulihkan tanpa kehilangan project.

### Fase 4 — Editor praktis dan style system (5–8 hari)

1. Pecah `Editor.tsx` menjadi workspace: source/timeline, preview, inspector, translation,
   export; gunakan selector Zustand agar panel tidak rerender seluruh editor.
2. Jadikan style data-driven dari `styles/*.json`: metadata value type, min/max/step/options,
   CSS template, group, dan icon. Buat `StyleCatalog` + `StyleEditor` generik.
3. Implementasikan renderer preview berlapis: grid, subtitle image/overlay, background,
   Arabic, translation, decoration, custom clips; dukung vertical/landscape.
4. Tambahkan waveform, seek/playhead, per-word karaoke, split/merge, tafsir slide, dan custom
   image/text dengan keyboard accessibility.
5. Tambahkan i18n minimal id/en dahulu; siapkan extraction sehingga 6 bahasa PRD bisa ditambah
   tanpa mengubah komponen.

**Gate:** semua kontrol editor dapat di-undo; preview deterministik terhadap `ProjectDocument`.

### Fase 5 — Export production pipeline (5–8 hari)

1. Pisahkan capture overlay dari encoding: capture PNG bertimestamp → Rust timeline/TGA → FFmpeg.
2. Implementasikan direct path, audio stream-copy, background video normalization/cache,
   fade/tile optimization, transparent MOV/WebM, dan thumbnail.
3. Deteksi codec hardware (NVENC/QSV/AMF/VideoToolbox) dengan fallback libx264 dan profil
   Fastest/Balanced/LowCpu.
4. Port font subsetting HarfBuzz untuk Windows/Linux; gunakan jalur canvas macOS.
5. Queue: pause/cancel/retry, persisted jobs, log per job, dan output validation.

**Gate:** golden-video test untuk 9:16, 16:9, audio-only, background video, fade, karaoke, dan
   transparent output; hasil dapat diputar di ffprobe dan media player umum.

### Fase 6 — Batch, integrasi, dan hardening (5–10 hari)

1. Batch workspace: import → segment → review → export dengan concurrency limit.
2. MP3Quran/translation provider abstraction; key storage aman; jangan simpan API key di JSON.
3. YouTube OAuth/upload, stock media, updater/deep-link, notification, dan optional analytics.
4. Persempit filesystem scope Tauri; audit CSP, command authorization, temp-file cleanup, dan
   secret redaction.
5. Dokumentasi setup sidecar/binary dan troubleshooting per OS.

**Gate:** release candidate dapat dipasang dari bundle bersih dan menyelesaikan smoke workflow.

## Pemetaan pekerjaan ke file saat ini

| Area | Saat ini | Tujuan | Aksi |
| --- | --- | --- | --- |
| State | `src/store/index.ts` | typed document + history | refactor bertahap, adapter kompatibilitas |
| Editor | `src/pages/Editor.tsx` | workspace modular | pecah setelah schema stabil |
| Preview | `src/components/PreviewCanvas.tsx` | 8-layer renderer | ekstrak pure render model |
| IPC | `src-tauri/src/lib.rs`, `commands.rs` | typed command registry | wrapper TS + error schema |
| Render | `src-tauri/src/render.rs` | exporter pipeline PRD | implement per capability, golden tests |
| AI | `src-tauri/src/ai.rs` | segmentation adapters | tambah cloud/sidecar, jangan campur UI |
| Data | `src-tauri/src/db.rs` | cache + project metadata | schema migration/versioning |
| Clipper | `src/pages/Clipper.tsx`, `clipper.rs` | optional integration | harden setelah MVP editor/export |

## Prioritas backlog

**P0:** schema + migration, history, typed IPC, binary diagnostics, one cloud segmentation path,
preview Quran/translation, basic FFmpeg export, cancellation, fixture tests.

**P1:** local sidecar, style catalog, waveform/karaoke, batch queue, font subsetting, background
video, i18n id/en.

**P2:** 100+ translation sync, YouTube, stock media, AI video creation, updater, analytics,
additional languages and codec optimizations.

## Definition of Done

- `npm run build`, `cargo check`, unit tests, and smoke E2E pass.
- Tidak ada `any` pada domain/IPC baru dan tidak ada invoke mentah di halaman.
- Project lama dapat dibuka, dimigrasikan, disimpan, di-undo/redo, dan diekspor.
- Cloud unavailable menghasilkan pesan/fallback yang jelas; local engine dapat dihapus tanpa
  merusak instalasi inti.
- Export tervalidasi dengan ffprobe, progress/cancel benar, dan tidak meninggalkan temp file.
- Tidak ada material berlisensi NC/ND/SA yang tidak disetujui dalam source atau artifact build;
  SBOM/NOTICE tersedia; branding QuranCaption tidak digunakan.

## Sprint pertama yang disarankan

1. Baseline build + fixture + `THIRD_PARTY.md` + `LICENSE_POLICY.md`.
2. Tipe `ProjectDocument` dan mapper dari Zustand saat ini.
3. `ProjectHistoryManager` untuk lima mutasi editor.
4. Typed IPC wrapper dan error envelope.
5. Satu integration test: fetch ayat → buat slide → save/load → undo → enqueue render.

Estimasi total MVP (P0) adalah 3–5 minggu untuk satu engineer berpengalaman; P1/P2 sebaiknya
dijalankan sebagai milestone terpisah karena ukuran model Python, kompatibilitas FFmpeg, dan
integrasi OAuth memiliki risiko operasional berbeda.
