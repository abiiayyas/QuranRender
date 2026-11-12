# ADR-0007: Pindah ke Electron + Remotion

- **Status:** Diterima
- **Tanggal:** 2026-11-12
- **Pengambil keputusan:** Pemilik produk
- **Terkait:** PRD CR-1, `docs/engineering/08_MIGRASI_ELECTRON.md`, menggantikan ADR-0001 sampai ADR-0006

## Konteks & Pernyataan Masalah

Stack Tauri + 11 crate Rust belum pernah menghasilkan renderer GPU, model alignment lokal, atau CI yang berjalan
(`05_AUDIT_FASE_0_2.md`). Pemilik produk ingin fitur setara Quran Caption dengan alur kerja seperti Storyset, yang
sudah terbukti di Electron.

## Pilihan yang Dipertimbangkan

1. **Tetap Tauri + Rust:** renderer, alignment, dan ekspor masih harus dibangun.
2. **Electron + Remotion:** satu bahasa (TypeScript), pola Storyset bisa dipakai ulang, teks Arab digambar Chromium.
3. **Electron + FFmpeg/ASS:** ekspor cepat, tetapi pratinjau (CSS) dan ekspor (libass) dua implementasi berbeda.

## Keputusan

Pilihan 2. Remotion dipakai untuk pratinjau dan ekspor dengan komposisi yang sama; FFmpeg tetap dipakai untuk probe,
potong, waveform, dan encode di dalam Remotion. Sinkron AI memakai HF Space publik, bukan model lokal.

## Konsekuensi

### Positif
- Prinsip "yang terlihat adalah yang diekspor" terpenuhi tanpa renderer kedua.
- Shaping Arab, harakat, dan font QPC per halaman ditangani Chromium.

### Negatif / Risiko
- Ekspor lebih lambat dari FFmpeg murni; dipantau di rilis berikutnya.
- Lisensi Remotion: gratis untuk individu dan organisasi sampai 3 karyawan.
- Sinkron AI bergantung pada layanan pihak ketiga tanpa SLA; sinkron manual dan timestamp QDC/MP3Quran tetap tersedia.

## Kepatuhan & Validasi

`npm run typecheck`, `npm test`, dan ekspor uji dari aplikasi (`07_BUILD_DAN_TEST.md`).
