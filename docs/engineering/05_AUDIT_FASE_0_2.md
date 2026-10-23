# 05 — Audit Fase 0, Spike, Fase 1, Fase 2, dan Desain 05

| Item | Nilai |
|---|---|
| Tanggal | 2026-10-23 |
| Cakupan | `04_IMPLEMENTATION_PLAN.md` §3 (Fase 0 + spike S1–S5), §4 (Fase 1), §5 (Fase 2); `docs/design/05_VIDEO_TEMPLATES.md` |
| Hasil | Laporan "Fase 0, 1, 2 selesai 100%" sebelumnya **tidak benar**. Dokumen ini menggantikannya. |

## 1. Ringkasan

Audit membaca kode dan menjalankannya, bukan hanya membaca laporan. Temuan utama:

1. **Pengukuran spike dikarang.** ADR-0002..0006 memuat angka ("60 fps", "0 `.notdef`", "anomali ligatur di Rust murni") yang tidak pernah diukur. Hanya S2 yang sekarang dijalankan sungguhan.
2. **Renderer tidak menggambar teks.** Versi lama hanya menggambar kotak, memakai teks basmalah yang di-hardcode, dan "golden test" hanya menulis berkas tanpa membandingkan apa pun.
3. **Beberapa fungsi inti berupa simulasi:** `probe_media` (durasi tetap 60 dtk), konfidensi alignment (berdasarkan nomor ayat), worker `render` (hanya mencetak progres), ekspor MP4 (hanya menyusun argumen), `subtitle_export` (teks kosong), isi catatan kaki (teks karangan).
4. **Gerbang keluar ditandai selesai tanpa bukti.** Sudah dikembalikan ke status sebenarnya di rencana implementasi.
5. **Template dan UI tidak sesuai desain.** Template tidak memakai id/skema doc 05; UI memakai kelas CSS dan token yang tidak ada di sistem desain, dan preview berupa tiruan DOM.

Sebagian besar temuan **sudah diperbaiki di sesi ini dengan bukti uji** (bagian 4). Sisanya tidak dapat diselesaikan tanpa perangkat/model/akses yang tidak tersedia (bagian 5).

## 2. Status per tugas

Legenda: ✅ terbukti dengan uji/pengukuran nyata · ⚠️ sebagian (rincian di kolom catatan) · ❌ belum ada.

### Fase 0 dan spike

| ID | Status | Catatan |
|---|---|---|
| F0-01 workspace, lint, deny | ⚠️ | Lokal lulus (`fmt`, `clippy -D warnings`, `cargo deny`). "CI hijau di 3 OS" belum terbukti: workflow belum pernah dijalankan di GitHub. |
| F0-02 shell Tauri + specta | ⚠️ | Binding tergenerate dan dicek di CI-job (belum pernah dijalankan). Dibuka di 3 OS: ❌ belum diuji. |
| F0-03 matriks CI 3 OS | ❌ | Workflow ada, belum pernah dijalankan; artefak NSIS/AppImage/.deb/.app universal belum pernah terbentuk. |
| F0-04 FFmpeg dari sumber + `linkage-check` | ❌ | Hanya skrip build dan skrip `check-linkage.sh`; tidak ada build FFmpeg terbundel. Skrip hanya dijalankan pada `target/debug`. |
| F0-05 kunci minisign | ⚠️ | Verifikasi tanda tangan teruji. **Kunci yang ada dibuat tanpa kata sandi dan kunci rahasianya berada di `/tmp`**: wajib dibuat ulang (bagian 6). |
| F0-06 `content-manifest.json` | ⚠️ | `verify-sources` lulus (153 entri, SHA-256 cocok). 4 entri masih `PERLU DIISI` (Q8, menunggu pemilik). |
| F0-07 `qr-quran::text` | ✅ | Statistik tokenisasi sesuai 03 §5.4. |
| F0-08 `qr-dataset build` | ✅ | Diverifikasi ulang: dua build → SHA-256 identik `f06b7c28…8b79a`; golden tokenisasi tidak berubah. |
| F0-09 `project.json` atomik | ⚠️ | Uji fault-injection ada (hook sebelum rename). Belum ada uji kill proses sungguhan. |
| F0-10 `app.db` | ✅ | Migrasi dari kosong dan penolakan rahasia teruji. |
| F0-11 ADR | ✅ | ADR-0001 ok; ADR-0002..0006 dikoreksi (lihat S1–S5). |
| S1 wgpu di Tauri | ❌ | Tidak dikerjakan (butuh GUI 3 OS, Wayland/X11, R-Low). ADR dicabut. |
| **S2 shaping Arab** | ✅ | Dijalankan: 6.236/6.236 identik dengan `hb-shape` C 14.5.0, 0 `.notdef`. **Keputusan: `harfrust`, bukan `harfbuzz-sys`** (ADR-0003). Regresi permanen di `shaping_regression.rs`. |
| S3 model alignment | ❌ | Tidak dikerjakan (tidak ada model/set uji). ADR dicabut. |
| S4 pipeline ekspor | ⚠️ | Hanya pengukuran awal pipeline CPU→ffmpeg: **1,5× real-time** (target ≥ 3×). GPU tidak dicoba. ADR-0005 berisi angka ini. |
| S5 timeline 2.000 klip | ❌ | Tidak dikerjakan. ADR dicabut. |

### Fase 1

| ID | Status | Catatan |
|---|---|---|
| A1-01 `qr-quran` runtime | ✅ | Verifikasi tanda tangan + hash; teks 2:255 dari dataset byte-identik dengan `data/surah/2.json`. Test dataset kini `#[ignore]` bernama (sebelumnya lulus diam-diam bila dataset tak ada). |
| A1-02 model domain | ⚠️ | Undo/redo 10.000 operasi ✅. Cascade gaya STY-1 baru ditambahkan (`qr-core::style`). `AyahSegment.word_range` baru ditambahkan. |
| A1-03 indeks + beranda | ⚠️ | Create/list/open/duplicate/delete ada. Dua cacat diperbaiki: nama sama menimpa proyek; rasio tidak mengatur ukuran kanvas. |
| A1-04 impor media | ⚠️ | `probe_media` (sebelumnya palsu) kini memakai `ffprobe`; `decode_audio_mono_f32` baru. Target "waveform awal ≤ 2 dtk untuk file 60 menit" belum diukur pada file nyata (benchmark lama memakai sampel sintetis). |
| A1-05 audio engine `cpal` | ⚠️ | `AudioEngine` (cpal) + jam master: tes 60 menit audio ekuivalen (173 juta frame, buffer 441/480/1021/…, seek dan pause) → **drift 0 tick persis**; smoke perangkat nyata di Mac ini lulus 5× (jam maju 1,003–1,013 dtk untuk 1,005–1,009 dtk dinding). Belum dipasang ke Tauri/Studio; `cpal::Stream` belum diperiksa `Send`. Windows/Linux belum diuji. |
| A1-06 scene builder + teks | ✅ | Ditulis ulang: teks ayat/terjemahan nyata dari dataset, shaping `harfrust`, auto-fit, karaoke, 13 golden dengan perbandingan hash. Backend wgpu/vello ❌ (CPU `tiny-skia`). |
| A1-07 panel preview | ⚠️ | `preview_frame` merender frame dengan renderer yang sama. UI kini mengikuti tick playback (didebounce saat diam, di-throttle ±300 ms saat memutar); belum diukur 30 fps. |
| A1-08 alignment | ⚠️ | VAD + timing proporsional + konfidensi heuristik (tidak lagi hardcode). Tidak ada model akustik, identifikasi ayat, atau forced alignment. Target PRD §8.2 tidak tercapai. |
| A1-09 worker + supervisor | ✅ | Worker render nyata dengan pembatalan. Antrean kini **persisten di `app.db`**, job yatim kembali `queued`, `QueueRunner` menjalankan `qurender worker` sungguhan, kegagalan satu job tidak menghentikan antrean. Jeda job yang sedang berjalan ditolak jujur (worker belum mendukung). |
| A1-10 export MP4 | ⚠️ | Nyata: MP4 H.264+AAC, BT.709, jumlah frame tepat (diverifikasi `ffprobe`), fallback HW→libx264 (jalur error teruji, kegagalan HW nyata belum dipicu). **1,5× real-time, target 3× belum tercapai.** |
| A1-11 kesetaraan preview–export | ⚠️ | SSIM implementasi sendiri + 50 tick diuji: **SSIM min 0,99906 (VideoToolbox), 0,99929 (libx264)**; selisih kanal ≤ 2/255 di area datar hanya pada varian lossless (lossy 3–6/255). Tes mutasi (geser 1 frame) turun ke 0,9489. **Menemukan bug produk:** seluruh video lebih gelap ~5/255 (frame BT.709 tanpa tag warna masuk ke ffmpeg) — diperbaiki. Cakupan: satu proyek 4 dtk, satu template, 360 px; belum 60 dtk/tick acak/template lain/Windows/Linux. |
| A1-12 SRT/VTT | ⚠️ | Format teruji. Perintah desktop kini mengisi teks dari dataset (sebelumnya kosong) dan gagal keras bila ayat tidak ada. Validator format SRT/VTT eksternal ❌. |
| A1-13 UI studio | ⚠️ | Di atas sistem desain, preview dari renderer Rust; timeline punya jalur audio dengan waveform (`peaks`) dan playhead. Seluruh alur dapat dijalankan dengan papan ketik (tab `role="tab"` berpanah, pintasan Enter/N/[ ]/Spasi/⌘S, isian waktu ↑/↓); diverifikasi di Chromium dengan IPC Tauri tiruan, **belum di jendela Tauri nyata**. Timeline hasil S5 ❌ (2.000 klip belum diukur). |
| A1-14 wizard | ⚠️ | Sumber (impor audio lewat path teks, waveform, rentang surah/ayat) → Sinkron (`align_auto` dengan peringatan apa adanya, tinjau/terima, sunting waktu, bagi per rentang kata untuk segmen yang meluber) → Tampilan (12 templat + rasio sesuai doc 05 §8, preview) → Ekspor (path, lebar, timpa, progres lewat event, batal, kode galat). Pemilih berkas bawaan ❌ (plugin dialog bukan dependensi: path diketik); sinkron tetap VAD + timing proporsional, bukan penjajaran akustik. Diverifikasi dengan IPC tiruan; belum dengan Tauri nyata. |
| A1-15 4 template | ✅ | 12 template sesuai id/skema doc 05; golden 13 frame. Identik di 3 OS belum terbukti. |
| A1-16 validator `qr-policy` | ✅ | CNT-1 diperluas (rentang kata), CNT-5 (overflow) diterapkan di job render sebelum ffmpeg. CNT-2 efektif di job: ayat tidak ada di dataset ⇒ `MISSING_VERSE`. |

### Fase 2

| ID | Status | Catatan |
|---|---|---|
| B2-01 gaya lengkap | ⚠️ | Cascade segmen > proyek > template ✅. Bayangan/blur teks dan backdrop blur ❌. |
| B2-02 safe area | ✅ | Matriks doc §3.1 persis (sebelumnya varian karangan). |
| B2-03 galeri ≥ 12, `.qrtemplate` | ✅ | 12 template; ekspor/impor zip dengan batas zip-slip/ukuran, tidak menimpa. Galeri UI ❌. |
| B2-04 font + cakupan glyph | ✅ | Pemeriksaan cakupan + laporan font hilang; test tidak lagi lolos diam-diam. |
| B2-05 animasi + karaoke | ⚠️ | Karaoke dan transisi di renderer. Konsistensi 24/30/60 fps belum diuji. |
| B2-06 anti-collision | ⚠️ | Fungsi dan uji ada; keterkaitan ke tata letak template terbatas pada tumpukan ayat/terjemahan/referensi (overflow terdeteksi). |
| B2-07 overlay/PiP | ❌ | Tidak ada. |
| B2-08 latar video | ❌ | Hanya fungsi pemetaan tick (loop/reverse/speed). Tidak ada dekode/penggambaran video latar. |
| B2-09 transparan + ASS | ⚠️ | Penyusun argumen ffmpeg + ASS teruji; ekspor transparan belum dijalankan. |
| B2-10 validasi pra-ekspor | ⚠️ | Validator + nama anti-timpa ✅. "Semua masalah dilaporkan sebelum job" sebagian. |
| B2-11 kredit/unggah | ⚠️ | Pembuat `*.credits.txt`/`*.upload.txt` ✅; panel "Siap unggah" ❌. |
| B2-12 batch | ⚠️ | Pemecahan ✅. Antrean persisten, prioritas, pause/resume (hanya job antre), cancel, isolasi kegagalan ✅; uji 50 klip: 49 sukses + 1 gagal disengaja, **44,8 dtk (release)**. UI antrean (daftar, batal, jeda/lanjut) dan lembar pecah klip (dua mode, pratinjau, antre) ✅ di UI, diverifikasi dengan IPC tiruan. |
| B2-13 Quran.com | ⚠️ | Parser kini memvalidasi 03 §6.2 (sebelumnya default diam-diam ke 1:1 dan angka catatan kaki bocor ke teks). Isi catatan kaki tidak diambil; UI catatan kaki dan penguncian edisi ❌. Pengunduhan nyata ❌ (allowlist tidak tersambung ke HTTP client). |
| B2-14 snapshot UI + `.qrpack` | ⚠️ | `.qrpack` (zip + manifest SHA-256, aset, path relatif, hardening setara impor template, fuzz) ✅ dan perintah desktop ekspor/impor ✅. UI ekspor/impor `.qrpack` dari Beranda ✅ (path diketik; diverifikasi dengan IPC tiruan). UI pemulihan snapshot ❌. Uji buka lintas OS ❌ (hanya macOS). |
| B2-15 keychain + allowlist | ⚠️ | Penolakan rahasia di `app.db` ✅, allowlist sebagai fungsi ✅. Integrasi keychain OS ❌. |
| B2-16 i18n/a11y | ⚠️ | i18n ID/EN bertipe (`i18n/messages/*.{id,en}.ts`, `t(key, params)`; paritas kunci dicek `tsc` dan `lint:i18n`), bahasa di `settings_set` dengan cadangan localStorage. a11y: landmark, label, `aria-live`, dialog dengan jebakan fokus + Esc, tab wizard berpanah, `prefers-reduced-motion`, kontras token AA dicek statis (`lint:a11y`). Belum: audit pembaca layar nyata (VoiceOver/NVDA), pengujian bahasa selain ID/EN. |
| B2-17 updater/backup | ⚠️ | Backup otomatis saat migrasi skema ✅ (mekanisme diuji dengan migrasi sintetis; daftar migrasi produksi kosong karena skema masih v1). Auto-update bertanda tangan ❌. |
| B2-18 uji instalasi + Flatpak | ❌ | Tidak ada. |
| B2-19 panduan buka pertama | ❌ | Tidak ada. |
| B2-20 telemetri/crash log | ⚠️ | Crash log lokal (pesan dibersihkan, tanpa teks Arab/path pengguna), opt-in default mati, pratinjau data ✅. Layar Pengaturan menampilkan teks pratinjau persis dan menyatakan tidak ada yang dikirim. Pengiriman telemetri tidak ada (tidak ada kode jaringan). |

### Doc 05 (desain video)

| Bagian | Status |
|---|---|
| §2.1 skema template (`layers`, `animations`) | ✅ diterapkan dan divalidasi |
| §3.1 matriks safe area | ✅ |
| §4 cascade gaya | ✅ (`qr-core::style`) |
| §6.1 shaping | ✅ memakai `harfrust` (doc dikoreksi) |
| §6.2 auto-fit | ✅ 5 iterasi; ayat yang tetap tidak muat ditandai `text_overflow` |
| §8 katalog 12 template + id | ✅ |
| §9 golden | ⚠️ 13 frame, bukan 16 (doc dikoreksi: kombinasi tak didukung tidak dirender). Kesetaraan 3 OS belum terbukti. |
| §5/§6 efek bayangan teks, blur, backdrop | ❌ |
| Tadabbur WBW (arti per kata) | ❌ tidak ada data arti per kata |

## 3. Cacat kode yang ditemukan

| # | Cacat | Perbaikan |
|---|---|---|
| 1 | Renderer tidak menggambar teks; basmalah hardcode | Ditulis ulang (`text.rs`, `scene.rs`, `template.rs`) |
| 2 | Golden test hanya menulis berkas | Perbandingan SHA-256 ke `tests/golden/render/manifest.json` + uji teks berbeda tiap ayat |
| 3 | `qr-align` konfidensi berdasarkan nomor ayat | Heuristik durasi/energi; peringatan jumlah wilayah ≠ jumlah ayat |
| 4 | `subtitle_export` teks kosong | Teks dari dataset terverifikasi, galat keras |
| 5 | `probe_media` durasi tetap 60 dtk | `ffprobe` |
| 6 | Worker `render` hanya simulasi; tidak bisa dibatalkan | Render + ffmpeg sungguhan, thread job, batal nyata |
| 7 | Ekspor tanpa audio dan tanpa BT.709 | Audio AAC dimux; matriks BT.709 + metadata |
| 8 | Deteksi encoder = daftar asumsi per-OS | Parse `ffmpeg -encoders` |
| 9 | Catatan kaki: teks karangan; angka bocor ke terjemahan; default ke 1:1 | Diperbaiki + validasi 03 §6.2 |
| 10 | Template tidak sesuai doc 05 | 12 template baru |
| 11 | Ayat panjang (2:282) meluber keluar layar, tanpa deteksi | `word_range` pada segmen, `text_overflow`, saran pembagian, gerbang CNT-5 |
| 12 | Terjemahan terpotong di dasar layar (Ayat Kursi di 9:16) | Terdeteksi sebagai overflow; job ditolak dengan `CNT-5-OVERFLOW` |
| 13 | CNT-1 hanya cek tick | Cek rentang kata antar-segmen |
| 14 | `project_create` menimpa proyek bernama sama; rasio tidak mengatur kanvas | Folder unik; `CanvasConfig::set_aspect` |
| 15 | UI memakai kelas/token yang tidak ada; preview tiruan DOM | UI ditulis ulang; `scripts/check-design-classes.mjs` (masuk CI) |
| 16 | Test font dan dataset lolos diam-diam | Gagal keras atau `#[ignore]` bernama |
| 17 | `zip 7` kena 3 advisory RUSTSEC | Naik ke `zip 9` (`cargo deny` bersih) |

## 4. Bukti verifikasi (dijalankan)

- `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --all-targets`, `cargo deny check` (lihat bagian akhir ringkasan commit).
- Dataset: `cargo test -p qr-quran -- --ignored` dan `cargo test -p quranrender -- --ignored` lulus dengan dataset bertanda tangan.
- `qurender render` pada proyek 1:5, 10 dtk, 1080×1920 menghasilkan MP4 dengan `ffprobe`: h264, 1080×1920, 300 frame, `color_space=bt709`, audio aac.
- Frame golden dan frame ekspor diperiksa secara visual (teks Arab benar, sorotan karaoke, referensi, terjemahan).

## 5. Yang masih terbuka (tidak boleh dianggap selesai)

Urut prioritas untuk menutup gerbang Fase 1/2 sebelum v1.0:

1. **Jalankan CI sungguhan** di GitHub (3 OS). Banyak klaim lintas-OS bergantung padanya.
2. **S1, S3, S4, S5** (butuh perangkat, model, set uji): tulis ulang ADR dengan angka.
3. **Performa ekspor**: 1,5× → ≥ 3× (cache bitmap teks statis per kata, multi-thread, atau GPU).
4. **Alignment nyata**: model akustik, identifikasi ayat, forced alignment (S3), set uji internal.
5. **Audio engine `cpal` nyata** (A1-05) dan preview tersinkron dengan jam audio (A1-07).
6. **Kesetaraan preview–export** (A1-11) dengan SSIM pada frame hasil dekode MP4.
7. **Wizard UI penuh** (A1-14): impor audio → sinkron → ekspor dari UI.
8. **B2-07, B2-08, B2-12 (persisten), B2-14, B2-15 (keychain), B2-16..B2-20.**
9. **Isi catatan kaki** Quran.com (butuh `foot_notes` API) dan UI penguncian edisi; pemotongan terjemahan untuk ayat yang dibagi per rentang kata (P1).
10. **Bayangan/blur teks, backdrop blur, arti per kata (Tadabbur).**
11. Bundel sumber daya (font, template, dataset) ke dalam installer: saat ini aplikasi mencari di akar repositori (`QR_RESOURCES_DIR`/`QR_DATASET_DIR`).

## 6. Tindakan yang hanya dapat dilakukan pemilik

1. **Buat ulang kunci minisign** dengan kata sandi (dataset + updater). Kunci lama berkata sandi kosong dan rahasianya pernah berada di `/tmp/qr-minisign-keys`. Setelah itu tanda tangani ulang dataset dan perbarui `assets/keys/*.pub`.
2. **Putuskan Q5** (U+0608, U+0609, U+06D4 terhadap mushaf resmi) dan **Q8** (sumber/lisensi 4 entri `PERLU DIISI`).
3. Sediakan perangkat/akses untuk S1/S4 (R-Mac, R-Win, R-Low, Wayland/X11) dan set uji tilawah berlisensi untuk S3.
