# ADR-0003: Spike S2 — Shaping Teks Arab Dataset Kemenag dengan LPMQ

- **Status:** Digantikan oleh [ADR-0007](0007-pindah-ke-electron.md)
- **Tanggal koreksi:** 2026-10-23
- **Terkait:** PRD QRN-1, CNT-5, §9.1 (S2), `03_DATASET_PIPELINE.md` §5.8, plan §3.2

> **Koreksi audit (Fase 0–2):** ADR versi sebelumnya memuat angka pengukuran dan keputusan yang **tidak pernah diukur**
> (tidak ada prototipe yang dijalankan). Isi tersebut dicabut. Lihat `docs/engineering/05_AUDIT_FASE_0_2.md`.

## Pertanyaan
Backend `TextShaper`: HarfBuzz C (`harfbuzz-sys`) atau Rust murni (`harfrust`)? Lulus bila 100% ayat tanpa `.notdef` dan posisi identik dengan `hb-shape` atau selisih ≤ 1 unit font.

## Metode (dijalankan)
Prototipe terbuang (`/tmp/s2/proto`): seluruh 6.236 ayat `data/surah/*.json` di-shape dengan `harfrust 0.15` (font `assets/fonts/quran/LPMQ.ttf`, RTL, script `Arab`, bahasa `ar`) dan dibandingkan dengan `hb-shape` HarfBuzz C 14.5.0 (`--output-format=json`) pada teks yang sama.

## Hasil terukur
| Pengukuran | Hasil |
|---|---|
| Ayat dibandingkan | 6.236 |
| Ayat identik (ID glyph, advance, offset) | **6.236 / 6.236** |
| Selisih posisi maksimum | **0** unit font |
| Glyph `.notdef` (ID 0) | **0** |
| Codepoint unik pada dataset | 75, semuanya dipetakan oleh cmap LPMQ (tidak ada `.notdef`) |
| Waktu shaping harfrust (build release, seluruh dataset) | 1,43 detik |
| Satu-satunya perbedaan | satuan `cluster`: harfrust = offset byte UTF-8, `hb-shape` CLI = indeks codepoint |

Klaim ADR sebelumnya bahwa pustaka Rust murni "memiliki anomali ligatur waqaf" **tidak terbukti dan keliru**.

## Keputusan
Memakai **`harfrust`** (Rust murni, `#![forbid(unsafe_code)]`) di belakang `qr_render::FontFace`, **bukan** `harfbuzz-sys`. Alasan: hasil identik pada seluruh dataset, tanpa FFI C, sejalan dengan kebijakan workspace `unsafe` dilarang dan `cargo deny`.
Doc 05 §6.1 yang menyebut HarfBuzz C diperbarui.

## Penjaga regresi (permanen)
`crates/qr-render/tests/shaping_regression.rs`:
- seluruh 6.236 ayat tanpa glyph ID 0;
- 45 ayat dibandingkan dengan fixture referensi `tests/fixtures/hb_shape_ref.json` hasil `hb-shape` C;
- tokenizer tidak pernah menghasilkan kata tanpa huruf yang berdiri sendiri.

## Catatan
Rendering tetap mempertahankan aturan tokenizer v1 (U+06D4 dicatat sebagai metadata, bukan teks tampil). Keputusan pemilik soal Q5 masih terbuka.
