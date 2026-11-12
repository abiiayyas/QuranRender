# ADR-0006: Spike S5 — Arsitektur Timeline Berperforma Tinggi

- **Status:** Digantikan oleh [ADR-0007](0007-pindah-ke-electron.md)
- **Tanggal koreksi:** 2026-10-23
- **Terkait:** PRD TML-1..5, §9.1 (S5), `01_TECHNICAL_HANDOFF.md` §3, plan §3.2

> **Koreksi audit (Fase 0–2):** ADR versi sebelumnya memuat angka pengukuran dan keputusan yang **tidak pernah diukur**
> (tidak ada prototipe yang dijalankan). Isi tersebut dicabut. Lihat `docs/engineering/05_AUDIT_FASE_0_2.md`.

## Pertanyaan
Timeline canvas vs virtualisasi DOM dengan 2.000 klip. Lulus bila 60 fps stabil saat scroll/zoom/drag.

## Status aktual
- Spike **tidak dijalankan** (tidak ada pengukuran fps pada 2.000 klip).
- UI studio yang ada memakai komponen DOM sederhana; performanya pada 2.000 klip **belum diuji**.

## Yang harus dilakukan
Buat prototipe kedua opsi, ukur fps/respons drag, lalu tulis ADR dengan angka.
