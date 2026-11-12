# ADR-0005: Spike S4 — Pipeline Ekspor GPU ke Encoder

- **Status:** Digantikan oleh [ADR-0007](0007-pindah-ke-electron.md)
- **Tanggal koreksi:** 2026-10-23
- **Terkait:** PRD §8.2, EXP-1..8, `01_TECHNICAL_HANDOFF.md` §7.2, §10.1, plan §3.2

> **Koreksi audit (Fase 0–2):** ADR versi sebelumnya memuat angka pengukuran dan keputusan yang **tidak pernah diukur**
> (tidak ada prototipe yang dijalankan). Isi tersebut dicabut. Lihat `docs/engineering/05_AUDIT_FASE_0_2.md`.

## Pertanyaan
Render 1080p30 60 dtk → konversi BT.709 → readback NV12 → encoder HW/software. Lulus bila ≥ 3× real-time dengan encoder HW di R-Mac/R-Win.

## Status aktual
- Spike **tidak dijalankan**: tidak ada GPU renderer (wgpu), tidak ada pengukuran encoder HW.
- Ekspor yang ada (nyata, bukan simulasi): `qurender render` / worker `render` merender frame RGBA di CPU (`tiny-skia`, glyph path di-cache, gradien dimmer per baris) dan mengalirkannya ke proses `ffmpeg` (rawvideo → H.264, konversi BT.709 rentang TV, audio AAC dimux). Encoder dideteksi dari `ffmpeg -encoders`; kegagalan encoder HW memicu ulang dengan `libx264` (logika ada dan diuji untuk jalur error, tetapi kegagalan HW sungguhan belum pernah dipicu).
- Pengukuran awal (satu kali, mesin pengembang macOS x86_64 — bukan mesin referensi R-Mac; build release):

| Skenario | Hasil |
|---|---|
| 1080×1920, 30 fps, 10 dtk, ayat pendek (1:5), VideoToolbox | 6,5 dtk = **1,5× real-time** |
| Biaya per frame, ayat panjang (2:255) | build scene ≈ 13 ms + raster ≈ 35–42 ms |

- **Target ≥ 3× real-time belum tercapai.** Bottleneck terukur: rasterisasi CPU ±700 glyph per frame, bukan encoder. Belum dilakukan: cache bitmap teks statis per kata, multi-thread frame, GPU (wgpu/vello), readback NV12.
- Ekspor ProRes/WebM alpha: hanya penyusun argumen `ffmpeg` (tidak dijalankan).

## Yang harus dilakukan
Ukur pipeline CPU saat ini (fps, memori, CPU%) lalu putuskan perlu tidaknya jalur GPU (wgpu/vello) dan readback NV12.
