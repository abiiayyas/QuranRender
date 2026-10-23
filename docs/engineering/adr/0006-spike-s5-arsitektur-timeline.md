# ADR-0006: Hasil Spike S5 — Arsitektur Komponen Timeline Berperforma Tinggi

- **Status:** Diterima
- **Tanggal:** 2026-10-23
- **Pengambil keputusan:** Tim Pengembang & Tim UI
- **Terkait:** PRD TML-1..5, PRD §9.1 (Spike S5), `docs/engineering/01_TECHNICAL_HANDOFF.md` §3

## Konteks & Pernyataan Masalah

Timeline video editor multi-trek dapat memuat hingga ribuan klip ayat, gelombang audio 60 menit, dan marker. Rendering timeline berbasis elemen DOM murni rentan mengalami *frame drop* (di bawah 60 fps) saat pengguna melakukan zoom in/out dan scrubbing cepat.
Dua pendekatan dievaluasi:
1. Virtualisasi DOM murni (React Virtualized / TanStack Virtual).
2. Canvas 2D terakselerasi hardware dengan lapisan overlay interaksi DOM tipis.

## Hasil Evaluasi & Pengukuran

| Skenario (2.000 klip + audio 45 menit) | Virtualisasi DOM | Canvas 2D + DOM Overlay |
|---|---|---|
| Scrubbing playhead cepat | 25–40 fps (lag layout reflow) | **60 fps konstan** |
| Zoom in/out mulus | 30 fps (DOM churn) | **60 fps konstan** |
| Waktu muat awal waveform | 1,2 detik | 0,3 detik |
| Aksesibilitas screen-reader & keyboard | Langsung didukung | Didukung via DOM overlay |

## Keputusan

Mengadopsi arsitektur **Canvas 2D + Lapisan Aksesibilitas DOM**:
- Trek audio waveform, thumbnail latar, klip ayat, dan playhead digambar langsung pada elemen `<canvas>` 2D performa tinggi dengan *dirty rectangle clipping*.
- Lapisan tipis elemen HTML transparan diposisikan di atas klip aktif untuk menangani event drag & drop, resize handle, dan navigasi fokus keyboard (Tab, N, Enter, Spasi) serta screen-reader accessibility (`role="slider"`, `aria-label`).
- Komunikasi posisi playhead menggunakan throttling 30–60 fps yang disinkronkan ke audio master clock.

## Konsekuensi
- Menjamin timeline berjalan mulus pada 60 fps bahkan untuk tilawah Juz 30 penuh (ratusan ayat).
- Mempertahankan standar aksesibilitas keyboard dan navigasi cepat peninjauan ayat (Pintasan N dan Enter).
