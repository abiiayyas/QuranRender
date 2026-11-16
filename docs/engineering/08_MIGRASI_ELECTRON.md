# 08 — Rencana Migrasi ke Electron

| Item | Nilai |
|---|---|
| Status | Dikerjakan di 0.2.0. Catatan hasil di §9 |
| Cakupan | Mengganti Tauri + 11 crate Rust dengan satu aplikasi Electron. Fitur mengikuti Quran Caption 3.6.73 (ditulis ulang secara clean-room), alur kerja mengikuti Storyset |
| Menggantikan | `01_TECHNICAL_HANDOFF.md` (stack), `04_IMPLEMENTATION_PLAN.md` (urutan kerja), ADR 0001–0006 |

## 1. Keputusan (hasil wawancara)

| # | Keputusan |
|---|---|
| D1 | **Electron saja.** Semua crate Rust, `apps/desktop/src-tauri`, Cargo, dan CI Rust dihapus |
| D2 | **Fitur setara Quran Caption, tetapi clean-room.** Kode, aset, string UI, dan desain Quran Caption (CC BY-NC 4.0) tidak disalin. Lisensi QuranRender tetap MIT. API publik yang juga dipakai Quran Caption (MP3Quran, Quran.com, HF aligner) boleh dipakai, karena yang dipakai adalah layanannya, bukan kodenya |
| D3 | **Alur Storyset:** Beranda → stepper 4 langkah yang bisa diklik bebas → dialog Ekspor. Proyek disimpan otomatis |
| D4 | **Render dengan Remotion.** Komposisi React yang sama dipakai untuk pratinjau (`@remotion/player`) dan ekspor (`@remotion/renderer`) |
| D5 | **Hanya macOS** dulu, DMG x64 + arm64, tanpa tanda tangan (seperti Storyset) |
| D6 | **UI memakai design system QuranRender** (graphite + nila, terang/gelap setara). Struktur layar mengikuti Storyset |
| D7 | **UI hanya berbahasa Indonesia.** i18n en dihapus |
| D8 | **Teks Arab:** Kemenag + LPMQ (bawaan), Uthmani Hafs, QPC per halaman (font diunduh saat dibutuhkan) |

### Fitur rilis pertama

- Impor audio/video lokal (dialog atau drag-drop)
- Unduh tilawah: MP3Quran dan QDC (Quran.com)
- Unduh dari YouTube (yt-dlp)
- Segmentasi AI cloud (HF Quranic Universal Aligner): batas ayat, waktu per kata, basmalah, isti'adzah
- Terjemahan banyak bahasa (Quran.com v4) + AI trim untuk ayat yang terpotong
- Karaoke per kata + terjemahan per kata
- Style editor + preset: nama surah, nama qari, nomor ayat, overlay gambar/teks, latar
- Ekspor MP4, SRT/VTT, chapter YouTube

**Backlog (tidak dikerjakan sekarang):** segmentasi lokal Python, Pexels/Pixabay, batch CSV, audio hafalan, unggah ke
YouTube, IndoPak, riwayat non-Hafs, Windows/Linux, auto-update, analitik.

## 2. Stack target (sama dengan Storyset)

| Bagian | Pilihan |
|---|---|
| Shell | Electron + electron-vite + Vite |
| UI | React 19, Tailwind 4 (token dari `design/system/tokens.css` dipindah ke `@theme`), Zustand |
| Data | SQLite lewat better-sqlite3: `studio.db` untuk proyek, job, pengaturan, kunci; `quran.db` bawaan dibuka read-only |
| Media | `ffmpeg-static` + `ffprobe-static` untuk probe, potong, waveform, konversi; yt-dlp diunduh saat pertama dipakai |
| Render | Remotion (`src/remotion`), dibundel lewat `scripts/prepare-remotion.mjs` ala Storyset |
| Kunci API | `safeStorage` (Keychain) di tabel `secrets` |
| Uji | Vitest khusus `src/shared/*.test.ts`, ditambah typecheck dan build |

```
src/
  main/       ipc.ts, jobs.ts, events.ts, protocol.ts (studio://), db/, quran.ts, sources/ (mp3quran, qdc, quranCom,
              ytdlp), aligner.ts, aiTrim.ts, media.ts (ffmpeg), render.ts (Remotion), exporter.ts
  preload/    window.api: call()/listen()
  shared/     api.ts (tipe IPC), project.ts (model), timing.ts, tokenize.ts, subtitles.ts (SRT/VTT/chapter),
              style.ts (preset → props), policy.ts (validasi teks sebelum ekspor)
  renderer/   pages/Home, pages/project/{ProjectPage, SourceStep, SyncStep, TextStep, EditorStep, ExportDialog},
              pages/Settings, components/ui.tsx
  remotion/   QuranVideo.tsx (latar, audio, ayat, terjemahan, karaoke, overlay)
resources/    fonts (LPMQ, Amiri, Uthmani Hafs), quran.db, templates
```

## 3. Yang dipertahankan, dipindah, dihapus

| Aset sekarang | Nasib |
|---|---|
| `data/`, `build/dataset/quran.db`, `content-manifest.json`, `data-anomalies.toml` | Dipertahankan. `quran.db` di-commit sebagai artefak bawaan, karena builder Rust (`qr-dataset`) ikut dihapus |
| `assets/fonts/` (LPMQ, Amiri, Inter) | Pindah ke `resources/fonts` |
| `crates/qr-render/templates/*/template.json` (12 templat) | Jadi preset bawaan di `resources/templates`, dibaca `shared/style.ts` |
| `design/`, `.impeccable/`, `docs/design/` | Dipertahankan. Spesifikasi layar diperbarui untuk alur baru |
| Logika Rust: tokenizer v1, allowlist Arab, klien cloud aligner + word map, AI trim, generator SRT/VTT, validator CNT | **Ditulis ulang ke TypeScript** di `src/shared` atau `src/main` (kode kita sendiri, aman diport) |
| `tests/golden/tokenization.tsv` | Dipakai uji Vitest untuk tokenizer TS |
| `crates/`, `apps/desktop/`, `Cargo.*`, `deny.toml`, `rust-toolchain.toml`, `.rustfmt.toml`, `target/`, `tests/golden/render/`, `third_party/ffmpeg/`, `assets/keys` + minisign, `.github/workflows/ci.yml` | Dihapus |
| `scripts/check-*.mjs` | Path diarahkan ke `src/renderer`. `gen-cloud-aligner-word-map.mjs` menulis `.ts`, bukan `.rs` |

## 4. Alur kerja

`Project.step` bernilai 1–4. `Project.status` hanya maju: `draft → source → synced → editing → exported`. Tiap pil
stepper diberi tanda centang bila syaratnya terpenuhi, tetapi semua pil tetap bisa diklik.

| Layar | Isi | Tanda selesai |
|---|---|---|
| **Beranda** | Kolom "Mulai": surah + rentang ayat (opsional, bisa dideteksi otomatis), qari, format 16:9/9:16. Grid proyek: Buka, Duplikat, Hapus | – |
| **1 Sumber** | Impor file / unduh qari (MP3Quran, QDC) / URL YouTube. Hasilnya di-probe, waveform tampil, titik masuk/keluar bisa dipotong. Latar video yang diimpor dipakai juga sebagai latar | Ada audio |
| **2 Sinkron** | Job aligner cloud. Bila sumbernya QDC atau MP3Quran yang punya waktu ayat/kata, waktu itu dipakai tanpa aligner. Daftar segmen per ayat dengan tingkat keyakinan, dengan aksi: geser batas, belah, gabung, tandai basmalah/isti'adzah, edit waktu kata. Pemutar ±2 detik | Semua segmen punya waktu |
| **3 Teks** | Teks Arab (Kemenag / Uthmani / QPC). Pilih dan pasang edisi terjemahan, jalankan AI trim untuk ayat yang terpotong, edit manual, terjemahan per kata | Tiap segmen punya terjemahan berstatus bukan "perlu dicek" |
| **4 Editor** | Player Remotion di tengah, Inspector kanan (tab Gaya, Latar, Overlay, Audio), timeline bawah (segmen, kata, audio, latar, overlay). Preset gaya, karaoke, undo/redo | – |
| **Ekspor** (dialog) | MP4 720p/1080p/4K pada 30/60 fps, SRT/VTT, chapter YouTube. Validasi teks (`policy.ts`) dijalankan dulu; ekspor ditolak bila teks Arab terpotong di tengah kata atau terjemahan tanpa atribusi | status `exported` |

Pengaturan: kunci AI (OpenAI-compatible: OpenAI, Gemini, OpenRouter, Groq, custom), unduhan yt-dlp, teks Arab
bawaan, preset.

## 5. Model data (inti)

```ts
Project { id, title, step, status, aspect, fps, surah, ayahFrom, ayahTo, reciter, script: 'kemenag'|'uthmani'|'qpc',
          translationEditions: string[], styleId, style: StyleOverrides, background, overlays[] }
Asset   { id, projectId, kind: 'audio'|'video'|'image', path (relatif folder proyek), durationMs, source, meta }
Segment { id, projectId, kind: 'ayah'|'basmalah'|'istiadzah', surah, ayah, wordFrom, wordTo, startMs, endMs,
          confidence, source: 'aligner'|'qdc'|'mp3quran'|'manual',
          words: { idx, startMs, endMs }[], translations: { edition, text, status }[] }
```

Waktu disimpan dalam milidetik dari awal audio yang sudah dipotong (model tick 48 kHz ikut dihapus). Pola snapshot
dan autosave mengikuti Storyset: renderer menyimpan proyek dan segmen, main memiliki kolom aset.

## 6. Fase

Setiap fase berakhir dengan aplikasi yang bisa dijalankan. Pemeriksaan per fase: `npm run typecheck`, `npm run build`,
Vitest untuk `src/shared`, dan uji manual di aplikasi.

| Fase | Isi | Bukti selesai |
|---|---|---|
| **F0 Kerangka** | Hapus Rust/Tauri. Scaffold electron-vite (main/preload/shared/renderer/remotion), SQLite + migrasi, protokol `studio://`, Beranda, CRUD proyek, stepper, autosave, Pengaturan + `safeStorage`, token design system | Proyek bisa dibuat, dibuka, diganti nama, dan dihapus; data tetap ada setelah aplikasi dibuka ulang |
| **F1 Data Qur'an** | `main/quran.ts` membaca `quran.db`. Tokenizer TS lulus `tokenization.tsv`. Teks Uthmani dan kode QPC diambil dari Quran.com v4 lalu dicache; font QPC diunduh per halaman | Uji golden tokenizer hijau; tiga jenis teks tampil untuk Al-Fatihah |
| **F2 Sumber** | Impor + probe + waveform (ffmpeg), unduh MP3Quran/QDC, yt-dlp (unduh biner, jalankan sebagai job), potong masuk/keluar | Satu tilawah dari tiap sumber masuk ke proyek dan bisa diputar |
| **F3 Sinkron** | Port klien aligner (unggah Gradio → SSE → peta kata) dan peta kata ke TS. Ambil timestamp QDC. UI review segmen | Al-Mulk 1–10 dari file lokal tersegmentasi; QDC tersinkron tanpa aligner |
| **F4 Teks** | Pasang edisi dari Quran.com v4, AI trim (OpenAI-compatible, streaming), edit manual, per kata | Ayat yang terpotong mendapat terjemahan terpotong dengan status "AI trim" |
| **F5 Editor** | Komposisi `QuranVideo` (latar, ayat, terjemahan, karaoke, overlay, nama surah/qari/nomor ayat), 12 preset, Inspector, timeline, undo/redo | Pratinjau 9:16 dan 16:9 berjalan mulus dengan sorotan per kata |
| **F6 Ekspor** | Job `renderMedia`, SRT/VTT/chapter dari `shared/subtitles.ts`, validasi `policy.ts`, `electron-builder` DMG | Video 1 menit diekspor; frame hasil ekspor sama dengan pratinjau; DMG bisa diinstal dan dibuka |
| **F7 Rapikan** | Tulis ulang README, `docs/engineering/01`, `07_BUILD_DAN_TEST`, panduan pengguna; tambah `AGENTS.md`, CHANGELOG | Dokumen cocok dengan kode |

## 7. Remotion vs FFmpeg

Kedua mesin tetap dipakai. Remotion menggambar frame. FFmpeg mengurus media mentah (probe, potong, waveform, encode
akhir di dalam Remotion).

| | Remotion | FFmpeg + ASS (jalur utama Storyset) |
|---|---|---|
| Pratinjau = ekspor | Ya, karena komponen React yang sama | Tidak: pratinjau CSS, ekspor libass. Dua implementasi bisa berbeda |
| Shaping Arab, harakat, font QPC per halaman | Chromium + HarfBuzz, sama seperti browser | libass bisa shaping, tetapi ganti font per kata/halaman dan tata letak multi-baris sulit |
| Karaoke per kata, animasi, latar kotak, bayangan | Bebas, cukup CSS | Terbatas pada tag ASS (`\k`, `\t`) |
| Kecepatan | Lebih lambat; kira-kira 1–3× durasi video di Mac [perkiraan, belum diukur] | Cepat, mendekati real-time atau lebih |
| Biaya | Lisensi Remotion: gratis untuk individu/≤3 karyawan | Gratis (GPL) |

Remotion dipilih karena produk ini isinya teks Arab dengan gaya kaya, dan aturan "yang terlihat adalah yang
diekspor". Kecepatan ekspor dibuktikan di F6. Bila terlalu lambat, Remotion hanya merender lapisan teks transparan
dan FFmpeg menumpuknya di atas latar.

## 8. Risiko

| Risiko | Mitigasi |
|---|---|
| HF Space aligner bisa berubah atau mati (layanan pihak ketiga, tanpa SLA) | Sumber QDC/MP3Quran punya timestamp sendiri; sinkron manual selalu tersedia |
| Lisensi font QPC (KFGQPC) dan teks Uthmani | Tidak dibundel; diunduh pengguna dari Quran.com. Cek syarat sebelum rilis |
| Logika Rust yang diklaim selesai ternyata tidak ada (`05_AUDIT_FASE_0_2.md`) | Port hanya kode yang benar-benar ada dan teruji; sisanya dibangun baru |
| Ukuran DMG (Electron + Chrome Headless Remotion + ffmpeg) bisa sekitar 300 MB; DMG Storyset 291 MB | Diterima untuk rilis pertama |
| Remotion tidak boleh dipakai gratis oleh organisasi dengan >3 karyawan | Dicatat di README dan halaman Tentang |

## 9. Hasil dan penyimpangan dari rencana

| Hal | Hasil |
|---|---|
| Penomoran kata kanonis | Memakai penomoran **Quran.com**, bukan Digital Khatt. Keduanya sama di semua ayat kecuali 2:181, 8:6, 13:37, dan 37:130; kata dari aligner dipetakan lewat `alignerToCanonical` (`src/shared/verses.ts`) |
| Peta kata | `src/shared/wordMap.ts`, dibangkitkan `scripts/gen-cloud-aligner-word-map.mjs` (136 ayat Kemenag→kanonis, 4 ayat aligner→kanonis) |
| Font | `Uthmanic.ttf` (me_quran, non-komersial) dan `IndoPak.ttf` (lisensi tidak diketahui) dihapus dari repo. Uthmani Hafs (KFGQPC) dan font QPC per halaman diunduh saat dipakai, tidak dibundel |
| Kecepatan render | Terukur 1,64 detik render per detik video (1080×1920, 30 fps, satu mesin Mac Intel, 6 detik uji). Ekspor 78 detik pada 720p selesai tanpa jalur render cadangan |
| Pengujian | Vitest 59 tes pada `src/shared`; unduhan QDC, sinkron, terjemahan, editor, dan ekspor MP4/SRT/VTT/chapter dijalankan di aplikasi Electron yang berjalan |
| Sinkron AI cloud | Klien `src/main/aligner.ts` diuji langsung ke HF Space dengan klip 1 ayat (unggah, antre, hasil, parse: 7 detik). Space mengenali klip pendek yang ambigu (Al-Fatihah 1:2 = bagian akhir 39:75) sebagai ayat lain; pakai rekaman yang lebih panjang atau koreksi manual di langkah Sinkron. Belum dijalankan dari tombol di UI |
| Belum diuji dalam aplikasi | AI trim dengan kunci nyata, unduh MP3Quran dan YouTube, skrip QPC, impor berkas lewat dialog |
| Belum dikerjakan | Pengatur drag overlay di timeline (waktu diatur lewat kolom angka), pemilihan segmen dari daftar masalah ekspor (hanya pindah ke langkah Sinkron) |
