# Quran Render — Panduan Pengguna

Quran Render mengubah rekaman tilawah menjadi video berteks: ayat Arab, terjemahan, dan sorotan per kata yang sinkron
dengan suara qari. Panduan untuk menjalankan dari kode sumber ada di [`07_BUILD_DAN_TEST.md`](../engineering/07_BUILD_DAN_TEST.md).

## 1. Memulai

Di **Beranda**, pilih surah dan rentang ayat (boleh dikosongkan), nama qari, format video (9:16, 16:9, atau 1:1), dan jenis
teks Arab, lalu klik **Buat proyek**. Nama proyek boleh diisi, atau dikosongkan untuk memakai nama surah. Proyek tersimpan otomatis; semua langkah bisa dibuka kapan saja lewat deretan langkah di atas.

Ingin memulai paling cepat? Klik **Proyek kosong**: cukup isi nama dan surah, lalu rekaman, terjemahan, dan tampilan disiapkan di langkah-langkah berikutnya.

**Daftar proyek** memuat satu baris per proyek: judul, surah (nomor, nama Latin, nama Arab) beserta rentang ayatnya, qari, jumlah segmen, durasi, tahap pengerjaan, dan langkah berikutnya. Saring menurut tahap, cari menurut judul, surah, atau qari, dan urutkan menurut yang terbaru, surah, atau nama. Kartu **Lanjutkan** di sebelah formulir menyebut langkah berikutnya untuk proyek yang terakhir dikerjakan.

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
**AI trim ayat terpotong** memotong terjemahan agar sesuai bagian yang dibaca. Ini butuh AI yang diatur di **Pengaturan**,
dengan dua pilihan: **API** (layanan apa pun yang kompatibel dengan API OpenAI, termasuk Ollama lokal, dengan kunci milikmu)
atau **AI CLI di komputer** (Claude Code, Codex CLI, Antigravity, OpenCode, atau perintah sendiri) yang sudah terpasang dan
login, tanpa kunci API. CLI memulai sendiri tiap kali dipanggil, jadi satu kelompok bisa memakan sekitar satu menit; aplikasi
mengirim banyak segmen sekaligus agar tidak terlalu lama. Aplikasi tidak pernah meminta izin tambahan dari CLI. Teks Arab
tidak pernah diubah oleh AI.

**Ayat atau terjemahan yang terlalu panjang.** Video memuat teks Arab, terjemahan, dan rujukan di antara nama surah dan nama qari.
Bila tidak muat, terjemahan mengecil lebih dulu (sampai 70%), baru Arab ikut mengecil (sampai 50%); ukurannya tidak pernah
dikecilkan lebih jauh supaya tetap terbaca. Segmen yang masih tidak muat ditandai **Terlalu panjang untuk satu layar** di
langkah Teks, dan muncul sebagai catatan di dialog Ekspor. Ada dua penyebab dan dua obatnya:

- **Ayatnya panjang:** klik **Belah otomatis**. Ayat dibelah di jeda antarkata (lebih disukai setelah tanda waqaf, dekat
  bagian tengah) sampai tiap bagian muat, dan terjemahan tiap bagian dipotong otomatis. Hasilnya satu langkah yang bisa
  diurungkan. Terjemahan yang sudah kamu ketik di segmen itu dihitung ulang.
- **Terjemahannya yang panjang** (ayat terpotong tetapi terjemahannya masih utuh, berstatus *perlu dicek*): membelah tidak
  menolong. Pakai **AI trim** atau ketik potongannya sendiri. Hasil AI
ditandai; periksa sebelum ekspor, dan ketik langsung di kolom terjemahan untuk memperbaikinya.

## 5. Langkah 4: Editor

Pratinjau memakai mesin yang sama dengan ekspor, jadi hasilnya sama dengan videonya.

- **Gaya:** 12 preset, lalu ukuran, warna, sorotan kata, terjemahan, **pemisah** (garis hias dengan ornamen kecil di antara ayat dan terjemahan; ruangnya ikut dihitung, jadi tidak menimpa teks), kotak, bingkai, dan keterangan (nama surah, qari, rujukan).
- **Latar:** warna, gambar, video, video sumber, atau **Gerak** (cahaya lembut, geometri, partikel, berkas sinar, gelombang;
  atur dua warna dan kecepatannya); atur gelap dan buramnya. Video latar yang lebih pendek dari tilawah diulang: **Ulang**
  (kembali ke awal), **Bolak-balik** (maju lalu mundur tanpa loncatan), atau **Pudar** (memudar halus di sambungan).
  Tombol **Cari foto stok atau buat dengan AI** membuka pemilih latar (lihat di bawah).
- **Overlay:** teks atau gambar (logo, nama channel), **Nama qari** (lower third animasi dengan nama surah), **Kemajuan**
  (bilah tipis yang terisi selama tilawah), **Ajakan** (kalimat pendek seperti "Jangan lupa bagikan dan doakan"), **Gelombang suara** (batang atau gelombang yang
  bergerak mengikuti suara tilawah; perlu rekaman sumber), serta **Subscribe** dan **Follow** (tombol yang muncul di waktu Mulai, ditekan,
  lalu hilang dan muncul lagi sesuai jeda, misalnya tiap 60 detik selama 6 detik; nama akun boleh dicantumkan), dengan
  waktu tampil dan **letak**: pilih salah satu dari sembilan tempat di area aman (grid 3×3), atur **jarak dari tepi aman**, lalu geser halus dengan penggeser Mendatar dan Menegak. Teks di tepi kanan rata kanan, di tepi kiri rata kiri. Tombol Subscribe dan Follow di video selalu berbahasa Inggris. Geser overlay di linimasa untuk memindahkannya, geser tepinya untuk mengubah panjangnya.
  Linimasa bisa diperbesar (sampai 64×) dan di-scroll untuk rekaman panjang.
- **Audio:** **suara latar** alam yang mengiringi bacaan: hujan, hujan di jendela, hujan dan petir, aliran sungai, api unggun, jangkrik malam, angin pelan, ombak tenang, dan dengung malam. Berkasnya
  sudah ikut di aplikasi. Tingkat suaranya **relatif terhadap suara qari**: aplikasi mengukur kenyaringan rekamanmu, lalu menaruh suara latar sekian dB di bawahnya (bawaan 24 dB; makin ke kanan makin
  keras, dan di atas 18 dB di bawah suara qari muncul peringatan karena mulai bersaing dengan bacaan). Ada pudar masuk dan keluar. Tanpa musik, sengaja.
- **Format:** ganti 9:16, 16:9, 1:1, dan tampilkan garis area aman. Garisnya tidak ikut diekspor.

Urungkan dan Ulangi tersedia di atas pratinjau (Cmd+Z, Cmd+Shift+Z).

### Pemilih latar

- **Foto & video stok:** cari di Pexels, Unsplash, atau Pixabay (Pexels dan Pixabay juga punya video). Tiap layanan butuh kunci
  API gratis; pemilih menunjukkan tautan untuk membuatnya, dan kunci disimpan terenkripsi di komputermu. Kata kunci bahasa
  Indonesia umum (alam, langit malam, masjid, gurun, laut, hutan, gunung, hujan, senja) diterjemahkan otomatis karena
  layanan itu mengindeks dalam bahasa Inggris. Pencantuman fotografer ikut tersimpan dan masuk ke teks Publikasi; untuk
  Unsplash pencantuman itu diwajibkan. Hasil pencarian adalah milik layanan dan bisa memuat orang atau hewan.
- **Buat dengan AI:** pilih suasana (lofi kamar hujan, lofi atap kota malam, gurun berbintang, siluet masjid senja, hutan
  pinus berkabut, laut tenang, pola ubin geometris, dan lainnya) dan boleh menambah deskripsi singkat. Gambar selalu dibuat
  tanpa orang, hewan, tulisan, dan logo (kata makhluk bernyawa di deskripsi ditolak). Penyedia diatur di **Pengaturan >
  Pembuat gambar**: **Pollinations** (gratis tanpa kunci, satu gambar per 45 detik, ukuran sedang, dan layanan itu membubuhkan
  logo kecil di pojok kanan bawah yang dibuang aplikasi dengan memangkas sekitar 7% tepi gambar), **API kompatibel OpenAI** (memakai alamat dan kunci di atas ditambah nama model gambar),
  atau **AI CLI**.

## 6. Ekspor

Klik **Ekspor**. Pilih 720p, 1080p, atau 4K pada 15, 24, 30, atau 60 fps, berkas tambahan (SRT, VTT, chapter YouTube), dan folder
keluaran. Bingkai yang lebih sedikit membuat render lebih cepat, dengan sorotan kata yang kurang halus. Sebelum merender, aplikasi memeriksa amanah teks dan kelengkapan: ekspor ditolak bila ada segmen yang waktunya
tidak valid, rentang kata di luar ayat, atau terjemahan utama yang belum ada. Peringatan (terjemahan perlu dicek,
keyakinan rendah) tidak menghalangi. Waktu render sekitar 1,5 kali durasi video pada 1080p di satu mesin uji; hasilnya
bergantung mesinmu.

**Ekspor sebagian (untuk memotong video panjang jadi short).** Di dialog Ekspor, pilih **Hanya sebagian**, lalu tulis **Mulai** dan **Sampai** sebagai waktu di
rekaman (`10:00`, `1:23.5`, atau `83` untuk detik). Proyek tidak diubah dan sumbernya tidak dipotong, jadi kamu bisa mengekspor sebanyak apa pun potongan dari
proyek yang sama. Dialog menyebut panjang hasilnya dan ayat yang masuk, serta memperingatkan bila rentang memotong sebuah ayat di tengah; **Rapikan ke batas ayat**
menggeser kedua ujung ke tepi segmen. Waktu di video, subtitle (SRT, VTT), dan bab YouTube dimulai lagi dari nol. Overlay mengikuti linimasa proyek: yang diatur
sampai akhir video ikut sejak awal hasil (bilah kemajuan terisi sepanjang hasil, tombol Subscribe muncul dari awal), sedangkan yang waktunya jatuh di luar rentang
tidak tampil (dialog memberi tahu). Suara latar memudar masuk dan keluar di awal dan akhir hasil. Hanya segmen di dalam rentang yang diperiksa sebelum ekspor.
Nama berkasnya memuat rentangnya.

**Cara render.** *Otomatis* merender sekali jalan untuk video pendek dan **per potongan** (sekitar 10 menit) untuk video lebih dari 15 menit; *Langsung* dan
*Per potongan* memaksa salah satunya. Potongan dirender berurutan tanpa suara, suaranya dirender sekali, lalu semuanya digabung tanpa encode ulang,
jadi tidak ada penurunan mutu atau klik di sambungan. Total waktu hampir sama dengan render langsung. Keuntungannya: kalau ekspor terputus
(aplikasi ditutup, gagal, dibatalkan), potongan yang sudah jadi disimpan dan dialog Ekspor menawarkan melanjutkan dari sana; centang
*mulai dari awal* untuk membuangnya. Potongan hanya dipakai lagi bila proyek dan pengaturannya sama persis. Butuh ruang disk sementara sampai penggabungan
selesai: potongan sebesar videonya, ditambah suara sekitar 11 MB per menit (video 2 jam kira-kira 1,4 GB).

**Perkiraan waktu** ditampilkan di dialog. Awalnya perkiraan kasar dari pengukuran di satu komputer uji; setelah tiap ekspor, angkanya menyesuaikan
dengan kecepatan komputermu. Latar **Gerak** kira-kira 1,7 kali lebih lama dirender daripada latar polos.

**Setelah selesai:** *Tidak ada*, *Tidur* (Mac tidur), atau *Tutup aplikasi*. Dijalankan hanya bila ekspor berhasil dan tidak ada proses lain yang masih
berjalan, setelah hitung mundur 1 menit yang bisa dibatalkan. Selama ekspor berjalan, Mac tidak tidur sendiri.

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

## 8. Pengaturan

- **Umum:** bahasa aplikasi (Bahasa Indonesia atau English), tema, dan jenis teks Arab bawaan. Bahasa juga menentukan pesan dari aplikasi dan
  teks yang digambar ke dalam video (misalnya tombol Subscribe dan draf Publikasi); terjemahan ayat dipilih terpisah di langkah Teks.
- **Layanan AI** dan **Pembuat gambar:** lihat langkah Teks dan Editor.
- **Penyimpanan:** ukuran dan tombol **Bersihkan** untuk *berkas sementara* (sisa render dan unduhan), *potongan render* yang belum selesai,
  *data visualizer* (dibuat ulang otomatis), dan *font Uthmani/QPC* (perlu internet untuk mengunduh lagi). Sisa render yang lebih dari sehari dan
  potongan yang lebih dari seminggu dibersihkan otomatis saat aplikasi dibuka. Di bawahnya, **berkas proyek yang tidak terpakai** (misalnya rekaman
  sebelum dipotong) bisa dihapus per proyek; berkas yang masih dipakai (sumber audio, latar, overlay, thumbnail) hanya bisa dihapus satu per satu setelah
  peringatan, dan rujukannya di proyek dibersihkan. Berkas yang dihapus tidak bisa dikembalikan, termasuk lewat Urungkan. Rekaman dan hasil ekspormu
  tidak pernah dihapus tanpa kamu memilihnya.
- **Dukungan:** tautan donasi (PayPal dan Saweria). Donasi sukarela dan tidak membuka fitur apa pun.

## 9. Konten dan lisensi

- Teks dan terjemahan Kemenag: Lajnah Pentashihan Mushaf Al-Qur'an, Kementerian Agama RI.
- Teks Uthmani, QPC, dan terjemahan lain: Quran.com. Font KFGQPC tidak dibundel; diunduh dari CDN Quran.com.
- Tilawah: MP3Quran dan Quran.com. Periksa hak pakai rekaman sebelum mengunggah.
- Kode: GPL-3.0. Remotion gratis untuk individu dan organisasi sampai 3 karyawan.

## 10. Bantuan

Laporkan masalah lewat issue di repositori. Sertakan langkah, pesan galat, dan langkah mana yang bermasalah.
