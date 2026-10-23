# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Aplikasi desktop (macOS, Windows, Linux) dengan UI web di dalam Tauri 2. Kanvas video dirender native
oleh Rust, bukan oleh DOM. Mobile (Android/iOS) direncanakan di fase 3.

## Stack

React + TypeScript (Vite) di dalam Tauri 2, core Rust. Diputuskan di PRD (D5). Detail teknis ada di
`docs/engineering/01_TECHNICAL_HANDOFF.md`.

## Users

- **Admin channel dakwah (primer):** mengelola channel YouTube/IG masjid atau kajian, rutin mengunggah
  tilawah imam/qari. Butuh hasil cepat, tampilan konsisten dengan identitas channel, batch, serta
  deskripsi dan atribusi siap salin.
- **Kreator konten pendek:** membuat Reels/TikTok 30–90 detik dari potongan tilawah.
- **Qari / santri:** membagikan rekaman tilawah sendiri dengan teks. Mengutamakan akurasi teks dan
  sinkron otomatis.
- **Lembaga pendidikan Qur'an:** materi untuk ditonton ulang, terjemahan resmi Kemenag, export
  subtitle.

Pasar awal Indonesia. UI dalam Bahasa Indonesia dan Inggris, siap untuk lokal RTL.

## Product Purpose

Mengubah rekaman tilawah menjadi video berteks (ayat Arab, terjemahan, sorotan per kata yang sinkron
dengan suara qari) yang siap diunggah. Sukses berarti pengguna baru menghasilkan video sinkron pertama
dalam ≤ 10 menit sejak instalasi, tanpa dependensi tambahan.

## Positioning

- Satu mesin render untuk preview dan export: yang terlihat sama dengan yang diekspor, termasuk
  animasi karaoke per kata.
- AI sinkronisasi berjalan lokal tanpa Python; cloud hanya opsional dan milik pengguna.
- Produksi massal: satu tilawah panjang menjadi banyak klip dalam satu antrean.
- Amanah teks ditegakkan sistem: export ditolak bila teks Arab terpotong, dataset tidak terverifikasi,
  glyph hilang, atau terjemahan tanpa atribusi.
- Gratis dan open source (GPL-3.0).

## Operating Context

- Sesi edit panjang di laptop/desktop, sering offline.
- Input berupa file audio/video tilawah (studio, masjid, tarawih).
- Output berupa MP4/MOV/WebM/PNG dan subtitle. Pengguna mengunggah manual ke YouTube, Shorts, Reels,
  dan TikTok memakai paket unggah (judul, deskripsi, atribusi).
- Alur utama empat langkah: Sumber → Sinkron → Tampilan → Ekspor, dengan studio lengkap untuk pengguna
  mahir.

## Capabilities and Constraints

- Sumber kebutuhan: `docs/product/PRD.md` (baseline v1.0, terkunci).
- **Clean-room:** desain tidak boleh mirip Quran Caption (editor gelap dengan tab terpisah). Kode, aset,
  dan string UI-nya tidak boleh dipakai.
- **Teks Arab:** dataset Kemenag (Mushaf Standar Indonesia). Ayat dirender dengan font LPMQ, nama surah
  dengan Amiri. Teks ditampilkan verbatim.
- Konten video (kanvas preview) dirender oleh renderer Rust. UI web hanya untuk kontrol.
- Tanpa integrasi publikasi platform dan tanpa code signing OS di rilis 1.
- Fitur dan peran yang belum diputuskan tercatat di PRD §15.2 (Q5, Q8, Q9).

## Brand Commitments

- **Nama:** QuranRender. **Logo:** konsep Playhead (dipilih pemilik produk 2026-10-23): mangkuk huruf q dengan playhead editor sebagai batangnya. Aset di `design/brand/logo/` dan `design/brand/icons/`.
- **Arah visual (dipilih pemilik produk):** tenang dan editorial. Tema terang dan gelap setara dan
  mengikuti sistem.
- **Preferensi tetap (2026-10-22):** pemilik produk memilih *standar kategori* editor video
  profesional, dikerjakan dengan kerapian setara Final Cut Pro, DaVinci Resolve, CapCut Desktop, dan
  Adobe Premiere Pro. Konvensi editor (preview tengah, inspector, timeline multi-track) menjadi
  komitmen, dengan tetap tenang, terang/gelap setara, dan tanpa tab editor terpisah ala Quran Caption.
- **Suara:** hangat dan sopan, bahasa baku ringan. Contoh: "Ayat sudah tersinkron. Silakan periksa
  bagian yang ditandai."
- **Kepekaan konten (mengikat):**
  - Tanpa gambar makhluk bernyawa di ilustrasi, ikon, dan template bawaan: hanya geometri, alam, dan
    arsitektur.
  - Tanpa ikonografi musik. Waveform tetap boleh sebagai alat edit.
  - Teks Arab, termasuk ayat, tidak pernah dipakai sebagai ornamen, tekstur, pola, atau hiasan logo.

## Evidence on Hand

- Dataset `data/` (114 surah, 6.236 ayat, terjemahan Kemenag) dan font di `assets/fonts/quran/`.
- Logo Playhead dan set ikon aplikasi (`design/brand/`).
- Belum ada pengguna, testimoni, atau metrik. Jangan mengarang hal-hal itu.

## Product Principles

1. **Amanah terhadap teks:** AI menentukan *kapan*, tidak pernah *apa*.
2. **Yang terlihat adalah yang diekspor.**
3. **Offline-first, cloud opsional.**
4. **Alur terpandu, kontrol penuh.**
5. **Tidak ada data yang hilang;** privasi secara default.

## Accessibility & Inclusion

- WCAG 2.1 AA (kontras), navigasi keyboard penuh, label aksesibilitas, skala UI (PRD SET-4).
- UI siap RTL. Teks Arab selalu memakai arah RTL yang benar.
