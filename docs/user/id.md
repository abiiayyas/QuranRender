# Quran Render — Panduan Pengguna

Quran Render mengubah rekaman tilawah menjadi video berteks: ayat Arab, terjemahan, dan sorotan per kata yang sinkron
dengan suara qari. Panduan untuk menjalankan dari kode sumber ada di [`07_BUILD_DAN_TEST.md`](../engineering/07_BUILD_DAN_TEST.md).

## 1. Memulai

Di **Beranda**, pilih surah dan rentang ayat (boleh dikosongkan), nama qari, format video (9:16, 16:9, atau 1:1), dan jenis
teks Arab, lalu klik **Mulai**. Proyek tersimpan otomatis; semua langkah bisa dibuka kapan saja lewat deretan langkah di atas.

| Teks Arab | Isi |
|---|---|
| Kemenag (LPMQ) | Mushaf Standar Indonesia, bawaan aplikasi, dipakai tanpa internet |
| Uthmani Hafs | Dari Quran.com; font diunduh saat pertama dipakai |
| QPC Madinah | Tulisan mushaf Madinah per halaman, dari Quran.com; font diunduh saat dipakai |

## 2. Langkah 1: Sumber

Pilih salah satu:

- **Berkas:** seret berkas audio atau video ke kotak, atau klik **Pilih berkas**. Video dipakai suaranya, dan gambarnya bisa
  dijadikan latar di Editor.
- **Qari:** unduh tilawah surah dari MP3Quran atau Quran.com. Qari berlabel *tersinkron otomatis* membawa waktu ayat, jadi
  langkah Sinkron bisa dilewati.
- **YouTube:** tempel alamat video. Pertama kali dipakai, aplikasi mengunduh yt-dlp. Pastikan kamu berhak memakai rekamannya.

Di bawah gelombang suara, atur titik mulai dan akhir lalu klik **Potong** untuk membuang bagian yang tidak dipakai.

## 3. Langkah 2: Sinkron

Klik **Mulai sinkron otomatis** untuk mengenali ayat dan waktu tiap kata. Rekaman dikirim ke layanan publik Hugging Face
Space (*Quranic Universal Aligner*), jadi butuh internet. Pilih model **Base** (lebih cepat) atau **Large** (lebih teliti).

Hasilnya daftar segmen. Segmen yang keyakinannya rendah ditandai; gunakan **Berikutnya yang perlu dicek**. Untuk tiap segmen
kamu bisa:

- menggeser tepinya di gelombang suara atau mengetik waktunya;
- membelah di posisi pemutar, menggabung dengan berikutnya, menambah, atau menghapus;
- mengubah jenis (Ayat, Basmalah, Isti'adzah), surah, ayat, dan rentang kata untuk ayat yang terpotong;
- mengatur waktu tiap kata, atau **Ratakan waktu kata** bila waktunya belum ada.

Pintasan: Spasi memutar/menjeda, panah kiri/kanan memilih segmen.

## 4. Langkah 3: Teks

Terjemahan Kemenag sudah bawaan. Klik **Tambah terjemahan** untuk memasang edisi lain dari Quran.com; edisi paling atas
menjadi terjemahan utama di video. **Isi terjemahan** mengisi semua segmen. Untuk ayat yang hanya dibaca sebagian,
**AI trim ayat terpotong** memotong terjemahan agar sesuai bagian yang dibaca. Ini butuh kunci API di **Pengaturan**
(layanan apa pun yang kompatibel dengan API OpenAI, termasuk Ollama lokal). Teks Arab tidak pernah diubah oleh AI. Hasil AI
ditandai; periksa sebelum ekspor, dan ketik langsung di kolom terjemahan untuk memperbaikinya.

## 5. Langkah 4: Editor

Pratinjau memakai mesin yang sama dengan ekspor, jadi hasilnya sama dengan videonya.

- **Gaya:** 12 preset, lalu ukuran, warna, sorotan kata, terjemahan, kotak, bingkai, dan keterangan (nama surah, qari, rujukan).
- **Latar:** warna, gambar, video, atau video sumber; atur gelap dan buramnya.
- **Overlay:** teks atau gambar (logo, nama channel) dengan posisi dan waktu tampil.
- **Format:** ganti 9:16, 16:9, 1:1, dan tampilkan garis area aman. Garisnya tidak ikut diekspor.

Urungkan dan Ulangi tersedia di atas pratinjau (Cmd+Z, Cmd+Shift+Z).

## 6. Ekspor

Klik **Ekspor**. Pilih 720p, 1080p, atau 4K pada 30 atau 60 fps, berkas tambahan (SRT, VTT, chapter YouTube), dan folder
keluaran. Sebelum merender, aplikasi memeriksa amanah teks dan kelengkapan: ekspor ditolak bila ada segmen yang waktunya
tidak valid, rentang kata di luar ayat, atau terjemahan utama yang belum ada. Peringatan (terjemahan perlu dicek,
keyakinan rendah) tidak menghalangi. Waktu render sekitar 1,5 kali durasi video pada 1080p di satu mesin uji; hasilnya
bergantung mesinmu.

## 7. Thumbnail dan Publikasi

Keduanya dibuka dari tombol di header proyek.

**Thumbnail** membuat cover JPG (di bawah 2 MB) untuk Shorts, Reels, dan TikTok. Gambar latarnya diambil dari proyekmu: gambar
yang sudah diimpor, **bingkai dari video** (video latar atau video sumber, pilih posisinya dengan penggeser), atau warna polos.
Tulisan digambar oleh aplikasi, jadi hurufnya selalu benar. Atur teks utama (kata terakhir diberi warna), teks kecil, posisi,
warna aksen, dan seberapa gelap lapisan di belakang teks. Pada format 9:16, garis putus-putus menandai bagian yang tampil di
grid profil Instagram; garis itu tidak ikut tersimpan. **Simpan thumbnail** menyimpan ke folder ekspor, **Simpan salinan…**
ke lokasi pilihanmu.

**Publikasi** menyiapkan teks unggahan untuk YouTube Shorts, TikTok, Reels, dan YouTube: judul, isi deskripsi, hashtag, dan
(YouTube) bab dari segmenmu. Draf awal ditulis dari data proyek (surah, ayat, qari, nama terjemahan, sumber audio), jadi
atribusi selalu ada dan tidak butuh internet. Hitungan karakter mengikuti batas tiap platform. **Tulis dengan AI** merapikan
kalimatnya (butuh kunci API di Pengaturan); AI tidak menulis atau mengutip teks Arab, dan balasan yang berisi huruf Arab
ditolak. Setiap kolom punya tombol Salin, dan **Simpan semua (.txt)** menulis semua platform dalam satu berkas. Periksa hak
pakai rekaman sebelum mengunggah.

## 8. Konten dan lisensi

- Teks dan terjemahan Kemenag: Lajnah Pentashihan Mushaf Al-Qur'an, Kementerian Agama RI.
- Teks Uthmani, QPC, dan terjemahan lain: Quran.com. Font KFGQPC tidak dibundel; diunduh dari CDN Quran.com.
- Tilawah: MP3Quran dan Quran.com. Periksa hak pakai rekaman sebelum mengunggah.
- Kode: GPL-3.0. Remotion gratis untuk individu dan organisasi sampai 3 karyawan.

## 9. Bantuan

Laporkan masalah lewat issue di repositori. Sertakan langkah, pesan galat, dan langkah mana yang bermasalah.
