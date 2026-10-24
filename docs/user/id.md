# Quran Render — Panduan Pengguna (Bahasa Indonesia)

> **Status: pra-alpha.** Panduan ini hanya memuat apa yang benar-benar berfungsi. Fitur yang belum ada
> ditandai **Belum tersedia**.

## 1. Memulai

Panduan build dan test lengkap: [`docs/engineering/07_BUILD_DAN_TEST.md`](../engineering/07_BUILD_DAN_TEST.md).

**Dari sumber** (belum ada installer rilis resmi):

```bash
pnpm install
cargo run -p qr-dataset -- build   # sekali: membangun dataset Al-Qur'an (build/dataset)
pnpm app                           # menjalankan aplikasi untuk dicoba
pnpm dmg                           # membuat installer: target/release/bundle/dmg/Quran Render_<versi>_<arsitektur>.dmg
```

Aplikasi membutuhkan `ffmpeg` dan `ffprobe` (macOS: `brew install ffmpeg`) untuk impor dan ekspor video.
`.dmg` belum ditandatangani dengan sertifikat Apple: di Mac lain, buka pertama kali lewat klik kanan › *Buka*.
Installer Windows/Linux: **Belum tersedia**.

**Membuat proyek.** Seret berkas tilawah dari Finder/File Explorer ke jendela Beranda, atau pilih
*Buat proyek*. Di lembar *Proyek baru*, berkas bisa diseret ke area lepas atau dipilih lewat
*Pilih berkas…*; nama proyek diisi otomatis dari nama berkas. Berkas bersifat opsional dan langsung
diimpor saat Studio terbuka. Proyek disimpan sebagai folder `*.qrproj` di `~/QuranRender/Projects`.
Nama yang sama tidak menimpa proyek lain (`Nama-2.qrproj`). Berkas `.qrpack` yang diseret ke Beranda
membuka lembar *Impor paket*.

**Mengimpor audio.** Di Studio langkah *Sumber*, seret berkas audio dan lepaskan di mana saja di jendela,
atau klik *Pilih berkas…*. Format: mp3, m4a, aac, wav, flac, ogg, opus, atau video mp4, mov, mkv, webm
(suaranya yang dipakai). Satu proyek memakai satu audio; berkas baru menggantikan yang lama.

**Latar (gambar/video).** Di langkah *Sumber*, bagian *Latar (gambar/video)*: seret gambar (png, jpg, jpeg, webp, bmp)
atau video (mp4, mov, mkv, webm) ke zona latar, atau klik *Pilih latar…*. Video latar dibisukan, dipotong
memenuhi kanvas, diulang bila lebih pendek dari audio, dan dipotong bila lebih panjang. Geser *Redup latar*
(bawaan 35%) agar teks tetap terbaca; disarankan minimal 20%. *Ganti* atau ikon hapus mengubah latar. Pelepasan
otomatis dialihkan: gambar selalu menjadi latar, audio murni menjadi audio, video yang dilepas di zona audio
dipakai sebagai audio, di tempat lain menjadi latar.

**Rentang ayat.** Surah dipilih dari daftar bernama (mis. "67. Al-Mulk"); *Dari ayat* dan *Sampai ayat* dibatasi
jumlah ayat surah itu.

Isian lokasi lain (berkas `.mp4` ekspor, berkas `.qrpack`, folder keluaran batch) punya tombol *Pilih…*
yang membuka dialog bawaan sistem; path juga tetap bisa ditempel langsung.

## 2. Sinkron (segmen ayat dan waktu)

- Setiap **segmen** menampilkan satu ayat atau sebagian ayat, dengan waktu mulai dan selesai.
- Segmen berkeyakinan rendah (< 80%) ditandai *perlu ditinjau*. Tombol **Terima** menandainya sudah ditinjau.
- Ayat panjang yang tidak muat satu layar (mis. Al-Baqarah 2:282) harus **dibagi per rentang kata**.
  Pembagian hanya di batas kata; satu kata tidak boleh tampil di dua segmen. Segmen terbagi menampilkan
  terjemahan ayat utuh berstatus *perlu ditinjau* sampai terjemahannya dipotong (otomatis, dengan AI, atau
  disunting). Potongan otomatis/AI tetap perlu ditinjau; ekspor memberi peringatan `TRN-REVIEW` (tidak
  memblokir) untuk segmen yang terjemahan edisi utamanya belum ditinjau.
- Basmalah pembuka dan isti'adzah dapat menjadi segmen khusus: teks Arab basmalah dari dataset (1:1),
  isti'adzah dari teks bawaan aplikasi (bukan ayat), tanpa label surah/ayat; terjemahan bawaan tersedia
  untuk bahasa Indonesia dan Inggris.
- **Sinkron otomatis (AI):** di langkah Sinkron tekan *Sinkronkan otomatis (AI)*. Ayat dikenali dari audio
  (rentang ayat tidak perlu diisi) lengkap dengan waktu per kata, basmalah, dan isti'adzah. Memakai layanan
  publik Hugging Face Space `hetchyy/quranic-universal-aligner` (sama dengan mesin bawaan Quran Caption), jadi
  **audio diunggah ke layanan itu** dan butuh internet; pemakaian pertama meminta persetujuan Anda. Segmen
  berkeyakinan rendah atau dengan kata terlewat ditandai *perlu ditinjau*.
- **Sinkron offline (perkiraan):** deteksi suara lokal + pembagian waktu proporsional, perlu rentang ayat.
- **Sinkron manual (papan ketik):** mode *Manual* di langkah Sinkron. Putar audio, pilih kata ayat (↑/↓, V =
  satu ayat), tekan **Enter** di akhir bacaan untuk membuat segmen, **Backspace** menghapus segmen terakhir,
  **B**/**A** menyisipkan basmalah/isti'adzah, **N**/**M** memindahkan awal/akhir segmen ke posisi
  putar, **S** menandai jeda. Tepi segmen juga bisa diseret di timeline.
- **Terjemahan:** pilih edisi di langkah Tampilan; edisi lain dipasang dari Pengaturan › Edisi terjemahan
  (Quran.com). Pemotongan AI memakai layanan yang kompatibel dengan OpenAI dengan kunci milik Anda
  (Pengaturan › Layanan AI, disimpan di keychain sistem).
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

- Teks Al-Qur'an: Kemenag RI (Mushaf Standar Indonesia). Terjemahan bawaan: Kemenag. Edisi terjemahan
  lain (mis. Saheeh International) diunduh dari Quran.com (api.quran.com) dan disimpan terpisah di
  `~/QuranRender/content.db`; daftar edisi tetap tampil saat offline setelah pernah diambil. Proyek dapat
  menampilkan beberapa edisi sekaligus (urutan edisi proyek; yang pertama adalah utama).
- Pemotongan terjemahan dengan AI memakai layanan OpenAI-compatible milik Anda (pengaturan
  `ai.endpoint`, bawaan `https://api.openai.com/v1`, dan `ai.model`). Kunci API disimpan di keychain
  sistem, tidak di berkas pengaturan. Hanya teks Arab dan terjemahan segmen yang dikirim.
- Konten tidak boleh memuat makhluk bernyawa atau musik; Quran Render tidak menyediakan keduanya.

## 7. Bantuan

Laporkan masalah di repositori proyek. Sertakan versi (`qurender --version`), sistem operasi, dan langkah
yang dilakukan. Jangan melampirkan kunci pribadi.
