# ADR-0001: Pilihan Stack Teknologi Inti QuranRender

- **Status:** Diterima
- **Tanggal:** 2026-10-23
- **Pengambil keputusan:** Tim Pengembang & Pemilik Produk
- **Terkait:** PRD baseline v1.0 (§10, §14), `docs/engineering/01_TECHNICAL_HANDOFF.md` §3

## Konteks & Pernyataan Masalah

QuranRender adalah aplikasi desktop open-source (GPL-3.0) untuk menghasilkan video tilawah Al-Qur'an ber-caption secara lokal, aman, dan berkinerja tinggi. Aplikasi memerlukan:
1. Shell desktop lintas platform (macOS, Windows, Linux) yang ringan dan aman.
2. Mesin render video deterministik berbasis GPU dengan teks Arab berkualitas tinggi (LPMQ, tanda waqaf).
3. Pemrosesan audio dan inferensi model AI (alignment) lokal tanpa runtime Python eksternal.
4. UI yang modern, responsif, dan aksesibel.

## Pilihan yang Dipertimbangkan

1. **Electron + Node.js + Python sidecar (seperti Quran Caption):**
   - *Masalah:* Ukuran biner besar, konsumsi RAM tinggi, dependensi Python rentan gagal instalasi di mesin pengguna, performa render terbatas oleh DOM/Chromium.
2. **Flutter Desktop:**
   - *Masalah:* Ekosistem pustaka audio/video pro dan shaping Arab tingkat rendah di Rust/C++ kurang terintegrasi secara ergonomis.
3. **Tauri 2 + Core Rust + wgpu + React UI:**
   - *Keunggulan:* Biner ramping, memori rendah, performa native Rust untuk seluruh logika komputasi berat (render, audio, data Al-Qur'an, AI), UI web standar dengan `tauri-specta` untuk komunikasi tipe-aman (zero-overhead type safety).

## Keputusan

Mengadopsi **Tauri 2 + Rust (edisi 2021) + React/Vite/TypeScript** dengan rincian:
- **Shell & IPC:** Tauri 2 dengan `tauri-specta` (binding TypeScript otomatis).
- **Core & Data:** Rust workspace modular (`qr-core`, `qr-quran`, `qr-store`, `qr-jobs`).
- **Render Engine:** `wgpu` + `vello` (fallback CPU: `tiny-skia` / `vello_cpu`).
- **Tipografi Arab:** Trait `TextShaper` diuji lewat Spike S2 (kandidat: `parley`+`harfrust` vs `harfbuzz-sys`).
- **Media:** FFmpeg libav dibangun dari sumber dengan opsi GPL-3.0; `cpal` untuk audio output.
- **AI/Alignment:** ONNX Runtime via `ort` tanpa runtime Python.
- **Penyimpanan:** SQLite (`rusqlite` bundled) untuk data dan pengaturan.
- **UI:** React + TypeScript strict + Zustand + React Aria Components.

## Konsekuensi

### Positif
- Tidak ada runtime Python di komputer pengguna; distribusi mandiri (self-contained).
- Render deterministik dan akurat secara tipografi melalui HarfBuzz/wgpu.
- Penggunaan memori minimal (< 200 MB saat diam).
- Lisensi GPL-3.0 ditaati sepenuhnya pada seluruh dependensi dan binary build.

### Negatif / Risiko & Mitigasi
- Kompilasi FFmpeg mandiri lintas OS memerlukan konfigurasi CI yang cermat (dimitigasi di F0-03 dan F0-04).
- Pilihan implementasi `TextShaper` perlu dibuktikan melalui Spike S2 sebelum implementasi penuh render engine.

## Kepatuhan & Validasi
- Struktur crate dan batasan dependensi dipatok di `Cargo.toml` dan divalidasi oleh `cargo deny check` dan lint CI.
