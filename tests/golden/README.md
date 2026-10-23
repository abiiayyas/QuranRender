# Golden Test Outputs

Direktori untuk artefak golden:
- Golden tokenisasi: `tests/golden/tokenization.tsv` (F0-08).
- Golden render 13 kombinasi (template × rasio yang didukung): `tests/golden/render/*.png` + `manifest.json` (A1-06, A1-15).

## Golden Render Frames

| Template | Rasio | Resolusi | File |
|---|---|---|---|
| `subuh` | 9:16 | 1080 × 1920 | `subuh_9x16.png` |
| `subuh` | 16:9 | 1920 × 1080 | `subuh_16x9.png` |
| `subuh` | 1:1 | 1080 × 1080 | `subuh_1x1.png` |
| `subuh` | 4:5 | 1080 × 1350 | `subuh_4x5.png` |
| `hening` | 9:16 | 1080 × 1920 | `hening_9x16.png` |
| `hening` | 16:9 | 1920 × 1080 | `hening_16x9.png` |
| `hening` | 1:1 | 1080 × 1080 | `hening_1x1.png` |
| `hening` | 4:5 | 1080 × 1350 | `hening_4x5.png` |
| `terang` | 9:16 | 1080 × 1920 | `terang_9x16.png` |
| `terang` | 16:9 | 1920 × 1080 | `terang_16x9.png` |
| `terang` | 1:1 | 1080 × 1080 | `terang_1x1.png` |
| `besar` | 9:16 | 1080 × 1920 | `besar_9x16.png` |
| `besar` | 1:1 | 1080 × 1080 | `besar_1x1.png` |

## Mekanisme

- Ayat uji: Al-Fatihah 1:5, tick 4 dtk (kata ke-2 sedang disorot), teks nyata dari `data/surah/*.json`.
- `manifest.json` memuat SHA-256 piksel tiap frame (setelah premultiplied RGBA). `cargo test -p qr-render --test render_golden` **membandingkan** hash dan gagal bila ada selisih atau set frame berubah.
- Perbarui sengaja (setelah memeriksa PNG secara visual): `QR_UPDATE_GOLDEN=1 cargo test -p qr-render --test render_golden golden_frames`.
- Hash identik pada build debug dan release (macOS x86_64). **Identik di Windows/Linux belum terbukti** (CI belum pernah dijalankan).
- Doc 05 §9 menyebut 16 frame; matriks katalog §8 hanya mendukung 13 kombinasi, sehingga 13 inilah yang dirender.

Toleransi render untuk kesetaraan preview–ekspor (A1-11, **belum diuji**):
- SSIM ≥ 0,995
- Selisih per kanal ≤ 2/255 di luar antialiasing tepi font.
