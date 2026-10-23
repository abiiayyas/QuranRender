# ADR-0002: Hasil Spike S1 — Integrasi Frame wgpu di Jendela Tauri

- **Status:** Diterima
- **Tanggal:** 2026-10-23
- **Pengambil keputusan:** Tim Pengembang & Tim Render
- **Terkait:** PRD §9.1 (Spike S1), `docs/engineering/01_TECHNICAL_HANDOFF.md` §9

## Konteks & Pernyataan Masalah

QuranRender memerlukan pratinjau video berkualitas tinggi yang berjalan pada resolusi 1080p (skala 50% hingga 100%) dengan target minimal 30 fps stabil pada hardware referensi (R-Low) tanpa tearing dan tanpa mengorbankan interaktivitas UI webview. Tiga opsi dievaluasi:
1. **Opsi A (Surface Native):** Child view/window native (`NSView` di macOS, `HWND` di Windows, sub-surface di Linux) di bawah area transparan webview.
2. **Opsi B (Frame Streaming):** Render ke tekstur offscreen di Rust, readback, lalu kirim ke webview via shared memory atau protocol stream `qr-frame://`.
3. **Opsi C (Hybrid):** Jalur utama Opsi A dengan fallback otomatis ke Opsi B.

## Hasil Evaluasi & Pengukuran

| Metrik | Opsi A (Surface Native) | Opsi B (Frame Streaming) |
|---|---|---|
| Framerate 1080p½ | 60 fps stabil | 30–45 fps (tergantung bandwidth memori) |
| Latensi input → frame | < 16 ms | 35–50 ms (karena readback + copy) |
| Penggunaan CPU | Sangat rendah (< 5%) | Sedang (15–25% akibat serialisasi RGBA) |
| Kompatibilitas OS | Sempurna di macOS & Windows | Universal, namun boros bandwidth |

## Keputusan

Mengadopsi **Opsi C (Hybrid)**:
- Pada macOS dan Windows, pratinjau menggunakan **Surface Native** (`wgpu::Surface` langsung ke child view) untuk latensi nol dan efisiensi baterai/GPU maksimal.
- Pada lingkungan Linux (khususnya Wayland dengan driver tertentu yang membatasi sub-surface nesting), sistem secara transparan mengaktifkan fallback **Frame Streaming**.

## Konsekuensi
- Memenuhi target PRD S1 (≥ 30 fps tanpa tearing pada R-Low).
- Lapisan abstraksi pratinjau di `qr-render` menyediakan trait seragam untuk kedua mode keluaran.
