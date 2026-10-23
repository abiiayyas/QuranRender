# Golden Test Outputs

Direktori untuk artefak golden:
- Golden tokenisasi: `tests/golden/tokenization.tsv` (F0-08).
- Golden render 4 rasio × 4 template primer: `tests/golden/render/*.png` (A1-06, A1-15).

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

Toleransi render:
- SSIM ≥ 0,995
- Selisih per kanal ≤ 2/255 di luar antialiasing tepi font.
