# 06 — v1.0 Hardening: status dan bukti

| Item | Nilai |
|---|---|
| Tanggal | 2026-10-23 |
| Dasar | `04_IMPLEMENTATION_PLAN.md` §6 (H-01..H-05) |
| Kesimpulan | **Gerbang v1.0 belum terpenuhi.** Pekerjaan hardening yang dapat dibuktikan di satu mesin macOS sudah dikerjakan; syarat gerbang (semua P0, 3 OS, mesin referensi, model alignment) belum. |

## H-01 Profiling dan target PRD §8.2 — ⚠️ sebagian

Hanya diukur di **satu** mesin pengembang (macOS x86_64, 16 thread logis), bukan R-Mac/R-Win/R-Low.

| Skenario (build release) | Sebelum | Sesudah |
|---|---|---|
| Ekspor 1080×1920, 30 fps, 10 dtk, ayat 1:5, VideoToolbox | 6,5 dtk (1,5×) | **3,4 dtk (≈2,9× real-time)** |
| Lantai ffmpeg+VideoToolbox (frame kosong, YUV420) | — | 2,2 dtk |

Perubahan yang menghasilkan percepatan (masing-masing terukur):
1. Gradien dimmer vertikal dihitung per baris (34 ms → <3 ms per frame 1080×1920).
2. Render frame paralel dengan thread produsen + kanal berbatas (render tumpang tindih dengan penulisan).
3. Konversi RGBA→YUV420 BT.709 di thread render (3 MB/frame ke FFmpeg, bukan 8 MB; tanpa swscale). Konversi
   dibandingkan dengan filter FFmpeg: selisih rata-rata < 1/255, maksimum ≤ 6.
4. Keluaran 1 thread dan 4 thread identik per frame (hash frame hasil dekode sama).

Target ≥ 3× **belum terbukti**: 2,9× satu kali ukur, ayat pendek. Ayat panjang lebih berat (raster ±35–42 ms/frame
di satu thread). Target lain PRD §8.2 (alignment, waveform file 60 menit, preview 30 fps, cold start) belum diukur.

## H-02 Fuzzing — ⚠️ sebagian

Fuzzing mutasi deterministik (tanpa dependensi baru; PRNG xorshift + `catch_unwind`), dijalankan sebagai tes biasa:

| Target | Iterasi | Hasil |
|---|---|---|
| `load_project` (`project.json`) | 3.000 | tanpa panic; galat tidak kosong |
| `TemplateDoc::load` | 2.000 | tanpa panic |
| `import_qrtemplate` (zip berbahaya: zip-slip, path absolut, drive Windows, tanpa `template.json`, JSON rusak, id berbahaya, entri 40 MB, zip palsu/kosong) | 7 kasus + 2 | semua ditolak; tidak ada tulisan di luar folder tujuan; tidak ada sisa impor gagal |
| respons Quran.com | 4.000 | tanpa panic |
| tokenizer/pembersih teks | 20.000 teks Unicode acak | tanpa panic |
| keluaran `ffprobe` | 5.000 | tanpa panic |

**Celah nyata ditemukan dan ditutup:** entri arsip `C:\evil.txt` lolos sebagai nama berkas. Di Windows itu path di luar
folder tujuan. `safe_relative` kini menolak `\`, `:`, NUL, dan `..` di semua OS.

Belum: fuzzing **migrasi skema** (belum ada migrasi; hanya penolakan versi tidak didukung) dan impor `.qrpack`
(format belum ada). Bukan fuzzing berbasis cakupan (cargo-fuzz/libFuzzer).

## H-03 Dokumentasi pengguna — ✅ (sesuai kondisi nyata)

`docs/user/id.md` dan `docs/user/en.md`: memulai, sinkron, gaya, ekspor, batch, paket unggah, konten. Fitur yang belum
ada ditandai eksplisit "Belum tersedia / Not available". Belum "dipublikasikan" (tidak ada situs rilis).

## H-04 Paket model Kecil/Akurat — ❌

Tidak ada model alignment (S3). Item ini P1 dan boleh menyusul.

## H-05 Bug bash — ⚠️ hanya macOS

Dijalankan: CLI (kasus tepi), aplikasi desktop sungguhan (debug dan bundel `.app` rilis). Windows/Linux **tidak** diuji.

| # | Bug | Perbaikan | Regresi |
|---|---|---|---|
| 1 | Berkas keluaran yang ada **ditimpa diam-diam** | `OUTPUT_EXISTS` kecuali `overwrite` | `bug_bash_regressions_*` |
| 2 | Audio lebih pendek dari video **memotong video** (300 frame dirender, keluaran 3,0 dtk) | audio di-pad senyap, durasi dikunci ke jumlah frame | `shorter_audio_is_padded_*`, CLI |
| 3 | Audio hilang → galat mentah ffmpeg, salah kode `ENCODER_FAILED`, encoder dicoba dua kali | `AUDIO_MISSING` sebelum ffmpeg | CLI |
| 4 | Folder keluaran tidak ada → galat mentah | dibuat otomatis (`OUTPUT_DIR` bila gagal) | CLI |
| 5 | Lebar 0 diam-diam menjadi 2×2 | `INVALID_PAYLOAD` untuk lebar di luar 64..7680 | CLI |
| 6 | Zip arsip template dengan nama `C:\…` diterima | `safe_relative` diperketat | fuzz |
| 7 | `project_delete` menghapus path apa pun dari indeks DB | hanya `*.qrproj` berisi `project.json` | `remove_project_folder_refuses_*` |
| 8 | Aplikasi terpaket mencari font/template/dataset di path repositori (compile-time) | resource dibundel (`tauri.conf.json`), diselesaikan saat runtime; self-check start-up | bundel `.app` dijalankan dari luar repo: "sumber daya OK … dataset terverifikasi" |
| 9 | Build rilis: impor `Typescript` tak terpakai | `cfg(any(debug_assertions, test))` | build rilis |

Bukti positif: encoder hardware VideoToolbox gagal pada 100×176 dan fallback ke libx264 **bekerja** pada kegagalan nyata
(sebelumnya hanya jalur galat yang teruji).

## Gerbang v1.0 (PRD §14): tidak terpenuhi

Masih terbuka (rincian di `05_AUDIT_FASE_0_2.md` §5): CI 3 OS belum pernah dijalankan; S1/S3/S4/S5; alignment nyata;
audio engine `cpal`; preview tersinkron; kesetaraan preview–ekspor (SSIM); wizard UI penuh; B2-07/08/12/14..20; isi
catatan kaki Quran.com; Q5/Q8 (keputusan pemilik); kunci minisign harus dibuat ulang.
