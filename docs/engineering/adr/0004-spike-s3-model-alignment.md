# ADR-0004: Spike S3 — Model Alignment dan Model Pack

- **Status:** Digantikan oleh [ADR-0007](0007-pindah-ke-electron.md)
- **Tanggal koreksi:** 2026-10-23
- **Terkait:** PRD §8.2, SYN-1..9, `01_TECHNICAL_HANDOFF.md` §11, plan §3.2

> **Koreksi audit (Fase 0–2):** ADR versi sebelumnya memuat angka pengukuran dan keputusan yang **tidak pernah diukur**
> (tidak ada prototipe yang dijalankan). Isi tersebut dicabut. Lihat `docs/engineering/05_AUDIT_FASE_0_2.md`.

## Pertanyaan
Model open-weight apa (ONNX) yang memenuhi: identifikasi ayat ≥ 98%, galat batas kata median ≤ 80 ms, 10 menit audio ≤ 2 menit proses?

## Status aktual
- Spike **tidak dijalankan**: tidak ada model, tidak ada set uji tilawah berlisensi, tidak ada harness `qurender align --eval`.
- `crates/qr-align` saat ini hanya: VAD berbasis energi, pemetaan berurutan wilayah-suara → ayat (hanya valid bila jumlah sama), timing kata proporsional panjang kata, dan skor keyakinan **heuristik** (kewajaran durasi vs jumlah huruf dasar + kontras energi). Ini bukan model akustik, bukan identifikasi ayat, bukan forced alignment.
- Target PRD §8.2 untuk segmentasi **belum tercapai dan belum diukur**.
- Konstanta `REFERENCE_SECONDS_PER_LETTER = 0.14` adalah nilai awal yang belum dikalibrasi.

## Yang harus dilakukan
Kumpulkan kandidat model + set uji berlisensi, bangun harness evaluasi, ukur, lalu tulis ADR dengan angka.
