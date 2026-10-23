# Quran Render — Panduan Pengguna (Bahasa Indonesia)

> **Status: pra-alpha.** Panduan ini hanya memuat apa yang benar-benar berfungsi. Fitur yang belum ada
> ditandai **Belum tersedia**.

## 1. Memulai

Panduan build dan test lengkap: [`docs/engineering/07_BUILD_DAN_TEST.md`](../engineering/07_BUILD_DAN_TEST.md).

**Menjalankan dari sumber** (belum ada installer rilis):

```bash
pnpm install
pnpm --filter @quranrender/desktop tauri dev      # aplikasi desktop
cargo run -p qr-dataset -- build                   # membangun dataset Al-Qur'an (build/dataset)
```

Aplikasi membutuhkan `ffmpeg` dan `ffprobe` di `PATH` untuk impor dan ekspor video.
Bundel `.app` macOS dibuat dengan `pnpm tauri build --bundles app`. Installer Windows/Linux dan
panduan "buka pertama kali" (Gatekeeper/SmartScreen): **Belum tersedia**.

**Membuat proyek.** Di beranda pilih *Proyek baru*, isi nama, qari (opsional), dan rasio
(9:16, 16:9, 1:1, 4:5). Proyek disimpan sebagai folder `*.qrproj` di `~/QuranRender/Projects`.
Nama yang sama tidak menimpa proyek lain (`Nama-2.qrproj`).

## 2. Sinkron (segmen ayat dan waktu)

- Setiap **segmen** menampilkan satu ayat atau sebagian ayat, dengan waktu mulai dan selesai.
- Segmen berkeyakinan rendah (< 80%) ditandai *perlu ditinjau*. Tombol **Terima** menandainya sudah ditinjau.
- Ayat panjang yang tidak muat satu layar (mis. Al-Baqarah 2:282) harus **dibagi per rentang kata**.
  Pembagian hanya di batas kata; satu kata tidak boleh tampil di dua segmen. Pada segmen terbagi,
  terjemahan tidak ditampilkan.
- **Sinkron otomatis dari audio: Belum tersedia.** Modul deteksi suara yang ada hanya memberi perkiraan awal
  dan tidak mengenali ayat. Timing perlu diatur manual.
- **Pemutaran audio di Studio: Belum tersedia.**

## 3. Gaya dan template

- 12 template bawaan: `subuh`, `senja`, `hening`, `terang`, `madinah`, `naskh-klasik`, `besar`,
  `editorial-split`, `kartu-apung`, `siaran-lower-third`, `tadabbur-wbw`, `kajian-side-panel`.
  Tiap template hanya mendukung rasio tertentu (lihat `docs/design/05_VIDEO_TEMPLATES.md` §8).
- Teks ayat **selalu** diambil apa adanya dari dataset terverifikasi; aplikasi tidak pernah mengubahnya.
  Jika tanda tangan atau hash dataset tidak cocok, teks tidak ditampilkan.
- Teks dijaga di dalam **area aman** platform. Jika ayat tidak muat pada ukuran minimum, ekspor ditolak
  dengan kode `CNT-5-OVERFLOW` dan Anda diminta membagi segmen.
- Mengedit properti gaya per elemen dari antarmuka: **Belum tersedia** (template dipilih utuh).
- Impor/ekspor template `.qrtemplate` tersedia di tingkat pustaka; galeri di antarmuka: **Belum tersedia**.

## 4. Ekspor

**Subtitle** (SRT/VTT/ASS): dialog *Ekspor subtitle* di Studio membuat teks dari dataset (ayat dan/atau
terjemahan). Penyimpanan langsung ke berkas dari dialog: **Belum tersedia** (gunakan tombol salin).

**Video MP4** lewat baris perintah:

```bash
qurender render <folder.qrproj> <keluaran.mp4> [--audio berkas] [--width N] [--max-seconds S] [--threads N] [--overwrite]
```

- Keluaran: H.264 + AAC, warna BT.709. Encoder hardware dipakai bila ada; bila gagal, otomatis libx264.
- Berkas keluaran yang sudah ada **tidak ditimpa** kecuali `--overwrite`.
- Audio yang lebih pendek dari video diperpanjang dengan senyap; video tidak terpotong.
- Ekspor dari antarmuka Studio, ekspor transparan (ProRes/WebM), dan antrean batch di antarmuka:
  **Belum tersedia**.

## 5. Batch dan paket unggah

- Pemecahan proyek per N ayat/durasi/marker dan antrean job yang bertahan setelah aplikasi ditutup
  (job yang terhenti kembali antre saat dibuka) tersedia sebagai pustaka. Antarmuka batch/antrean:
  **Belum tersedia**.
- Arsip `.qrpack` (proyek + aset + sidik jari SHA-256, dapat dibuka di OS lain) tersedia lewat perintah
  aplikasi; tombol di antarmuka: **Belum tersedia**. Arsip yang rusak atau berbahaya ditolak.
- Pembuat berkas kredit (`*.credits.txt`) dan teks unggah (`*.upload.txt`) tersedia sebagai pustaka.
  Panel *Siap unggah*: **Belum tersedia**.

## 6. Konten dan lisensi

- Teks Al-Qur'an: Kemenag RI (Mushaf Standar Indonesia). Terjemahan bawaan: Kemenag. Terjemahan
  Saheeh International diunduh pengguna sendiri dan disimpan terpisah (`content.db`); unduhan dari dalam
  aplikasi: **Belum tersedia**.
- Konten tidak boleh memuat makhluk bernyawa atau musik; Quran Render tidak menyediakan keduanya.

## 7. Bantuan

Laporkan masalah di repositori proyek. Sertakan versi (`qurender --version`), sistem operasi, dan langkah
yang dilakukan. Jangan melampirkan kunci pribadi.
