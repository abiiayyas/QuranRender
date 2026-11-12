# ADR-0002: Spike S1 — Integrasi Frame Render di Jendela Tauri

- **Status:** Digantikan oleh [ADR-0007](0007-pindah-ke-electron.md)
- **Tanggal koreksi:** 2026-10-23
- **Terkait:** PRD §9.1 (S1), `01_TECHNICAL_HANDOFF.md` §9, plan §3.2

> **Koreksi audit (Fase 0–2):** ADR versi sebelumnya memuat angka pengukuran dan keputusan yang **tidak pernah diukur**
> (tidak ada prototipe yang dijalankan). Isi tersebut dicabut. Lihat `docs/engineering/05_AUDIT_FASE_0_2.md`.

## Pertanyaan
Opsi A (surface native di bawah webview), B (frame streaming ke webview), atau C (hibrida)?
Lulus bila ≥ 30 fps pada 1080p½ di R-Low, tanpa tearing (PRD §9.1).

## Status aktual
- Spike **tidak dijalankan**: butuh prototipe GUI di 3 OS (termasuk Wayland dan X11) dan perangkat R-Low yang tidak tersedia pada sesi pengembangan.
- Keadaan kode saat ini: `preview_frame` (Tauri command) merender satu frame PNG dengan renderer CPU yang sama dengan ekspor lalu mengirimnya sebagai `data:` URL. Ini **bukan** keputusan S1; ini jalur sementara yang memenuhi prinsip "satu jalur render" tetapi **belum diukur** terhadap target 30 fps. Tidak ada backend wgpu/vello.

## Yang harus dilakukan
Jalankan prototipe A dan B sesuai plan §3.2, ukur fps/latensi/tearing/CPU, lalu tulis ulang ADR ini dengan angka hasil ukur.
