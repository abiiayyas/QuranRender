# Quran Render

Aplikasi desktop untuk mengubah rekaman tilawah menjadi video berteks: ayat Arab, terjemahan, dan sorotan per kata yang
sinkron dengan suara qari. Hasilnya MP4 (dan SRT/VTT) yang siap diunggah ke YouTube, Shorts, Reels, atau TikTok.

Semua proyek dan berkas disimpan di komputermu. Internet hanya dipakai untuk mengunduh tilawah, teks Uthmani/QPC,
terjemahan, sinkron AI (HF Space publik), dan AI trim (kunci API milikmu).

## Alur

Beranda → **1 Sumber** → **2 Sinkron** → **3 Teks** → **4 Editor** → Ekspor. Semua langkah bisa dibuka kapan saja,
dan proyek tersimpan otomatis.

| Langkah | Isi |
|---|---|
| Beranda | Pilih surah dan rentang ayat, qari, format (9:16, 16:9, 1:1), dan jenis teks Arab |
| 1 Sumber | Impor berkas audio/video, unduh tilawah qari (MP3Quran, QDC), atau unduh dari YouTube; potong awal dan akhir |
| 2 Sinkron | Sinkron AI (Quranic Universal Aligner) atau timestamp bawaan QDC/MP3Quran; periksa dan rapikan segmen |
| 3 Teks | Pasang terjemahan (Kemenag bawaan, edisi lain dari Quran.com), isi otomatis, AI trim untuk ayat yang terpotong |
| 4 Editor | Preset gaya, latar, overlay, timeline, pratinjau langsung dengan sorotan per kata |
| Ekspor | MP4 720p/1080p/4K pada 30/60 fps, SRT/VTT, chapter YouTube; diperiksa dulu oleh aturan amanah teks |
| Thumbnail | Cover JPG di bawah 2 MB dari gambar atau bingkai video proyek, teks digambar aplikasi |
| Publikasi | Judul, deskripsi, hashtag, dan bab per platform (Shorts, TikTok, Reels, YouTube), draf awal dari data proyek, AI opsional |

## Menjalankan dari kode sumber

Butuh macOS dan Node.js 22 atau lebih baru.

```bash
npm install
npm run dev          # aplikasi dengan hot reload
npm run typecheck    # TypeScript strict (main + renderer)
npm test             # Vitest untuk src/shared
npm run build        # build ke out/
npm run dist:mac     # DMG ke dist/ (arsitektur mesin build)
```

## Teknologi

| Bagian | Teknologi |
|---|---|
| Aplikasi | Electron, electron-vite, Vite |
| Tampilan | React 19, Zustand, design system CSS di `design/system/` |
| Data | SQLite (better-sqlite3): `studio.db` milik pengguna, `resources/quran.db` bawaan (read-only) |
| Video | Remotion (pratinjau dan ekspor memakai komposisi yang sama), FFmpeg (`ffmpeg-static`, `ffprobe-static`) |

```
src/
  main/       proses utama: database, berkas proyek, unduhan, sinkron AI, terjemahan, render
  preload/    jembatan window.api (dibangun dari CHANNELS di src/shared/api.ts)
  shared/     tipe, kontrak IPC, dan aturan murni yang dipakai main, renderer, dan Remotion
  renderer/   tampilan React
  remotion/   komposisi video (pratinjau dan ekspor)
resources/    quran.db
assets/fonts  font Arab dan UI
design/       token, komponen CSS, merek
docs/         dokumentasi produk, desain, dan teknik
```

Dokumentasi teknis: [docs/engineering/01_TECHNICAL_HANDOFF.md](docs/engineering/01_TECHNICAL_HANDOFF.md). Panduan untuk
agen AI dan kontributor: [AGENTS.md](AGENTS.md).

## Lisensi dan sumber

Quran Render berlisensi GPL-3.0-or-later. Teks Arab dan terjemahan Kemenag dari Lajnah Pentashihan Mushaf Al-Qur'an
(Kementerian Agama RI). Teks Uthmani, QPC, dan terjemahan lain dari Quran.com. Tilawah dari MP3Quran dan QDC.

| Komponen | Lisensi |
|---|---|
| [Remotion](https://www.remotion.dev/license) | Remotion License: gratis untuk individu, nirlaba, dan perusahaan sampai 3 karyawan |
| FFmpeg (ffmpeg-static) | GPL v3 |
| yt-dlp (diunduh saat dipakai) | Unlicense |
| Font LPMQ, Amiri, Inter | Lihat `assets/fonts/` |
