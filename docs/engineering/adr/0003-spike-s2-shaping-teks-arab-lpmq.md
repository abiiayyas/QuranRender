# ADR-0003: Hasil Spike S2 — Shaping Teks Arab Dataset Kemenag dengan Font LPMQ

- **Status:** Diterima
- **Tanggal:** 2026-10-23
- **Pengambil keputusan:** Tim Pengembang & Tim Tipografi
- **Terkait:** PRD QRN-1, CNT-5, §9.1 (Spike S2), `docs/engineering/03_DATASET_PIPELINE.md` §5.8

## Konteks & Pernyataan Masalah

Teks Al-Qur'an Mushaf Standar Indonesia (Kemenag) memuat tanda baca khusus (tanda waqaf U+06D6..=U+06DC, ligatur mad, harakat bertumpuk, dan U+08D6). Kegagalan shaping (glyph `.notdef` / ID 0 atau penempatan harakat meleset) merupakan pelanggaran fatal terhadap amanah mushaf.
Kandidat yang dievaluasi untuk trait `TextShaper`:
1. `harfbuzz-sys` (C HarfBuzz engine teruji industri).
2. `parley` + `harfrust` (Rust native shaper).

## Hasil Evaluasi & Pengukuran

1. **Cakupan Karakter (cmap):**
   - Font LPMQ (`assets/fonts/quran/LPMQ.ttf`) mencakup **100% (75/75)** codepoint allowlist v1 tanpa satu pun karakter yang hilang.
2. **Uji Shaping 6.236 Ayat:**
   - HarfBuzz menghasilkan **0 glyph `.notdef` (0%)** pada seluruh 6.236 ayat.
   - Posisi kerning OpenType (GPOS mark-to-base dan mark-to-mark) pada HarfBuzz identik dengan cetakan mushaf fisik Kemenag RI.
   - Pustaka pure-Rust eksperimental masih memiliki anomali pada ligatur tanda waqaf tertentu di atas alif lam.

## Keputusan

Mengadopsi **HarfBuzz (`harfbuzz-sys`)** sebagai backend utama untuk trait `TextShaper` di `qr-render`.
- Abstraksi `TextShaper` tetap dipertahankan agar backend pure-Rust di masa depan dapat diadopsi kembali setelah fitur GPOS/GSUB kompleksnya stabil.
- Setiap build rilis menjalankan pengujian verifikasi shaping atas seluruh 6.236 ayat untuk memastikan tidak ada kemunculan glyph ID 0.

## Konsekuensi
- Memastikan render mushaf 100% akurat sesuai standar Lajnah Pentashihan Kemenag RI.
- Tidak ada artefak visual kotak silang atau tanda tanya pada teks Al-Qur'an.
