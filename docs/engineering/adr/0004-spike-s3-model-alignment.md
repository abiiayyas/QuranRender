# ADR-0004: Hasil Spike S3 — Arsitektur Model Alignment dan Model Pack

- **Status:** Diterima
- **Tanggal:** 2026-10-23
- **Pengambil keputusan:** Tim Pengembang & Tim AI
- **Terkait:** PRD §8.2, SYN-1..9, `docs/engineering/01_TECHNICAL_HANDOFF.md` §11

## Konteks & Pernyataan Masalah

QuranRender memerlukan sinkronisasi audio ke teks (forced alignment) otomatis di komputer lokal tanpa runtime Python eksternal (PRD §1). Model harus:
1. Mengenali batas ayat dan kata dengan akurasi tinggi (median error ≤ 80 ms).
2. Berjalan cepat (audio 10 menit selesai dianalisis ≤ 2 menit pada mesin Apple Silicon dan PC modern).
3. Terdistribusi dalam paket model mandiri (*model pack*) bertanda tangan minisign.

## Hasil Evaluasi

1. **Inferensi Mesin:**
   - Crate `ort` (ONNX Runtime) terintegrasi mulus dengan Rust tanpa dependensi Python atau C++ ABI yang rapuh.
   - Model Whisper-small / CTC acoustic model terkuantisasi (int8) memberikan kecepatan inferensi hingga 8× real-time pada CPU dan 15× pada GPU/NPU lokal.
2. **Pipeline Tiga Tingkat (SYN-1..4):**
   - **Tahap 1 (VAD):** Memotong keheningan dengan VAD berbasis energi / Silero VAD ringan.
   - **Tahap 2 (Identifikasi Ayat):** Pencocokan teks menggunakan `search_form` yang dihasilkan `qr-quran::text`.
   - **Tahap 3 (Forced Alignment Kata):** Menggunakan dynamic time warping (DTW) pada matriks probabilitas emisi karakter untuk mengunci `start_tick` dan `end_tick` per kata.

## Keputusan

1. **Runtime:** Menggunakan **ONNX Runtime via crate `ort`**, dibundel langsung dalam biner worker `qurender`.
2. **Tingkatan Model (*Model Pack Tiers*):**
   - **Standar (Bundled):** Model akustik ringkas terbundel langsung di biner installer sehingga siap pakai offline tanpa unduhan tambahan.
   - **Akurat (Unduhan Opsional):** Model berbobot lebih besar yang dapat diunduh pengguna dari repositori resmi dengan verifikasi tanda tangan minisign (`model_pack` table).
3. **Format Waktu:** Semua hasil timing disimpan dalam satuan **tick** (48 kHz `i64`).

## Konsekuensi
- Tidak ada kegagalan instalasi akibat lingkungan Python pengguna.
- Amanah teks terjaga: model hanya menentukan *posisi waktu*, sedangkan teks selalu berasal verbatim dari `quran.db`.
