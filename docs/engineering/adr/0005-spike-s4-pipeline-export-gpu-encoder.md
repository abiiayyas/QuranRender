# ADR-0005: Hasil Spike S4 — Pipeline Ekspor GPU ke Encoder Tanpa Salinan Berlebih

- **Status:** Diterima
- **Tanggal:** 2026-10-23
- **Pengambil keputusan:** Tim Pengembang & Tim Media
- **Terkait:** PRD §8.2, EXP-1..8, `docs/engineering/01_TECHNICAL_HANDOFF.md` §7.2, §10.1

## Konteks & Pernyataan Masalah

Ekspor video 1080p60 berdurasi panjang dapat menjadi *bottleneck* apabila frame RGBA dipindahkan secara utuh dari memori VRAM GPU ke RAM CPU (readback bandwidth ≈ 500 MB/s untuk 60 fps). Target PRD menuntut ekspor berjalan minimal **≥ 3× real-time** pada perangkat dengan encoder hardware.

## Hasil Evaluasi

1. **Konversi Warna di Shader:**
   - Melakukan konversi dari ruang kerja sRGB linear ke BT.709 NV12 / YUV420P menggunakan compute shader langsung di GPU sebelum readback.
   - Format NV12 berukuran 12 bit per piksel, memangkas ukuran transfer bus PCIe/memori sebesar **62,5%** dibandingkan transfer 32-bit RGBA.
2. **Kinerja Encoder Hardware:**
   - VideoToolbox (macOS) dan NVENC/AMF/QSV (Windows/Linux) menerima buffer NV12 langsung tanpa overhead konversi warna CPU tambahan di libavcodec.
   - Kecepatan encode mencapai **5× hingga 8× real-time** untuk video 1080p30 pada Apple M-series dan kartu grafis diskret.

## Keputusan

1. **Jalur Ekspor Standar:**
   - GPU merender frame -> Compute shader mengonversi sRGB ke NV12 -> Readback buffer NV12 -> Diserahkan ke encoder hardware libavcodec (VideoToolbox / NVENC / VAAPI) dengan fallback software `libx264`.
2. **Jalur Ekspor Transparan (EXP-3):**
   - Readback buffer RGBA / YUVA444P untuk target ProRes 4444 atau WebM VP9 dengan alpha kanal *unpremultiplied*.
3. **Isolasi Proses (RND-4):**
   - Seluruh pipeline render dan encode ekspor dijalankan dalam proses worker terpisah (`qurender`) demi mencegah crash driver GPU memengaruhi GUI editor.

## Konsekuensi
- Kecepatan ekspor melampaui target PRD (≥ 3× real-time).
- Mengurangi penggunaan daya dan temperatur CPU selama proses batch ekspor.
