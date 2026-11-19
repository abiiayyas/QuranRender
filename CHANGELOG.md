# Changelog

## 0.12.1

- **Dokumentasi bahasa Inggris di repositori:** menambahkan [`README.en.md`](README.en.md) dan [`docs/engineering/README.en.md`](docs/engineering/README.en.md), pemilih bahasa di `README.md`, serta memperbarui `docs/user/README.md`, `docs/user/en.md`, dan `CONTRIBUTING.md`.

## 0.12.0

- **Popup ajakan donasi (`SupportDialog`):** muncul otomatis maksimal setiap 3 hari sekali setelah ekspor video selesai, serta bisa dibuka kapan saja lewat tombol **Dukung** di header Beranda. Menampilkan tautan donasi sukarela (PayPal dan Saweria) yang sama dengan Pengaturan > Dukungan.
- **Tangkapan layar di `README.md`:** menambahkan gambar pratinjau teroptimasi di `docs/screenshots/` (tampilan Editor utama, grid 4 langkah alur kerja, dan blok lipat untuk Suara Latar Alam, Thumbnail, serta Publikasi), sambil mengabaikan folder mentah `screenshoots/` di `.gitignore`.

## 0.11.4

- **Repositori dirapikan untuk rilis publik:** berkas internal, arsip dokumen Tauri/Rust, dataset mentah, dan artefak prototipe dikeluarkan dari tracking Git lewat `.gitignore` (tetap tersimpan di lokal), folder ikon aplikasi dipindahkan ke `design/brand/icons/`, dan tautan di `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`, serta dokumentasi teknis diperbarui.
- **`README.md` ditulis ulang** dengan tata letak ringkas untuk pengguna macOS dan Windows (termasuk ruang tangkapan layar, panduan instalasi awal, dan daftar fitur terbaru).
- **Rilis otomatis di GitHub Actions:** workflow `build.yml` kini melampirkan installer macOS (`.dmg`) dan Windows (`.exe`) langsung ke halaman GitHub Releases saat tag versi (`v*`) di-push.

## 0.11.3

- **Lisensi kode diubah ke MIT** (dari GPL-3.0-or-later) untuk menghilangkan konflik copyleft dengan lisensi Remotion (ROADMAP K1). Berkas `LICENSE` kini MIT, dan `THIRD_PARTY_NOTICES.md` merangkum sumber serta lisensi teks, audio, font, gambar, FFmpeg, dan Remotion.
- Repositori disiapkan untuk publik: `SECURITY.md`, `CONTRIBUTING.md`, templat issue (laporan bug dan permintaan fitur), dan `.commandcode/` ditambahkan ke `.gitignore`.

## 0.11.2

- **Antigravity dihapus:** CLI Antigravity (`agy`) tidak lagi menjadi pilihan AI CLI untuk teks maupun CLI gambar, beserta pembaca event, prompt gambar, dan terjemahan Inggrisnya.
  Pengaturan lama yang masih menyimpan Antigravity otomatis kembali ke Claude Code (teks) atau Codex (gambar). CLI gambar bawaan kini Codex.

## 0.11.1

- **Zoom di tab Sumber:** gelombang suara punya tombol perbesar dan perkecil (1× sampai 64×) dan penggaris waktu, sehingga titik masuk dan keluar bisa ditaruh tepat pada rekaman
  panjang. Gelombang digulir ke samping, tengah tampilan tidak bergeser saat zoom, dan tampilan mengikuti pemutar saat diputar. Detail gelombang kini sekitar 8 titik
  per detik (sampai 20.000 titik) supaya tetap tajam saat diperbesar.
- **Notifikasi ekspor selesai:** saat ekspor berhasil, macOS menampilkan notifikasi "Ekspor selesai"; mengkliknya menunjukkan berkas di Finder.

## 0.11.0

- **Ekspor sebagian:** dialog Ekspor punya **Hanya sebagian** dengan kolom Mulai dan Sampai (`10:00`, `1:23.5`, atau detik), untuk memotong rekaman panjang jadi short tanpa
  memotong sumber dan tanpa mengubah proyek. Hanya bingkai dan suara di rentang yang dirender (Remotion `frameRange`), baik langsung maupun per potongan; waktu di
  gambar tetap waktu proyek, jadi teks, sorotan kata, dan visualizer tidak bergeser. Dialog menyebut panjang hasil dan ayat yang masuk, memperingatkan rentang yang
  memotong ayat di tengah, dan **Rapikan ke batas ayat** menggeser ujungnya ke tepi segmen (tepat sampai milidetik). Subtitle SRT dan VTT serta bab YouTube dimulai
  lagi dari nol. Overlay dipotong ke rentang (bilah kemajuan dan Subscribe mulai dan berakhir bersama hasil), suara latar memudar di ujung hasil, dan hanya segmen di
  rentang yang diperiksa sebelum ekspor. Potongan render yang bisa dilanjutkan hanya dipakai untuk rentang yang sama. Nama berkas memuat rentang.
  Diuji pada rekaman asli 118 menit, rentang 15:00 sampai 16:00: durasi 60,000 dtk, suara sejajar 0 ms dengan sumber, mode per potongan identik dengan langsung
  (900 bingkai, PSNR minimum 46 dB).

## 0.10.0

- **Suara latar:** tab **Audio** baru di editor dengan sembilan suara alam yang ikut terpasang di aplikasi (hujan, hujan di jendela, hujan dan petir, aliran sungai,
  api unggun, jangkrik malam, angin pelan, ombak tenang, dengung malam), loop mulus 2 menit, tanpa musik. Tingkatnya **relatif terhadap suara qari**: kenyaringan
  rekaman diukur sekali (bagian aktif, tanpa jeda dan napas) lalu dihitung ke dB di bawahnya; bawaan 24 dB di bawah, geser sampai 12 dB, dengan peringatan di atas
  18 dB. Pudar masuk dan keluar. Dimainkan komposisi Remotion yang sama untuk pratinjau dan ekspor; di render per potongan ikut dirender di tahap suara. Asal tiap
  berkas dan lisensinya ada di `assets/ambient/SOURCES.md`.
- **Perbaikan (sudah ada di 0.9.0): render per potongan menunda suara 43 ms** terhadap gambar. Suara AAC mentah dari Remotion membawa jeda encoder tanpa daftar potong, dan
  disalin begitu saja ke MP4 hingga terputar terlambat; render langsung tidak terkena. Kini suara dirender sebagai WAV lalu di-encode ke AAC sekali saat penggabungan
  (selisih terhadap rekaman sumber 0 ms, diukur dengan korelasi silang). Konsekuensi: butuh ruang sementara tambahan sekitar 11 MB per menit video. Ekspor per potongan
  dari 0.9.0 sebaiknya diulang bila sinkron bibir-suara (sorotan kata) penting.
- Perbaikan saat menguji suara latar: fade `loop` Remotion mengulang di tiap putaran (`loopVolumeCurveBehavior="extend"`); sambungan loop di render nyata kini mulus
  (langkah level terbesar 2,85 dB di seluruh berkas, 2,3 dB di dekat titik loop).
- Sidebar editor: label "Background" tidak lagi terpotong (rel diperlebar, label panjang dipotong dengan …).
- Dokumentasi: rancangan mode **Hafalan** (ulang ayat N kali, jeda, ekspor audio saja) dicatat di `docs/product/ROADMAP.md` §5.2; belum dikerjakan.

## 0.9.0

- **Render per potongan:** video panjang (lebih dari 15 menit, atau dipaksa lewat Cara render) dirender dalam potongan sekitar 10 menit tanpa suara, suaranya
  dirender sekali, lalu digabung dengan ffmpeg tanpa encode ulang. Ekspor yang terputus bisa **dilanjutkan** dari potongan yang sudah jadi (dikenali lewat
  sidik jari proyek dan pengaturan); hasil gabungan diperiksa panjangnya. Diuji pada video 40 detik dalam 5 potongan: 962 bingkai sama dengan render
  langsung (PSNR minimum 48 dB, sambungan tidak lebih buruk), suara tanpa lubang dan tanpa klik.
- **Pilihan fps 15, 24, 30, 60** dan **perkiraan lama render** di dialog Ekspor, dari pengukuran nyata (sekitar 5 detik biaya tetap, 16 ms per megapiksel per
  bingkai, latar Gerak 1,7×) yang menyesuaikan dengan kecepatan komputermu setelah tiap ekspor.
- **Mac tidak tidur selama ekspor.** Pilihan **Setelah selesai**: tidak ada, tidur, atau tutup aplikasi; hanya bila ekspor berhasil dan tidak ada proses lain,
  dengan hitung mundur 1 menit yang bisa dibatalkan.
- **Penyimpanan** di Pengaturan: bersihkan berkas sementara, potongan render, data visualizer, dan font Quran dengan ukuran masing-masing; sisa render
  lama dibersihkan otomatis saat aplikasi dibuka. **Berkas proyek yang tidak terpakai** bisa dihapus per proyek; berkas yang masih dipakai hanya dengan
  peringatan satu per satu, dan rujukannya dibersihkan agar proyek tidak rusak.

## 0.8.0

- **Pemisah ayat dan terjemahan:** garis hias dengan ornamen kecil (dua daun runcing dan tiga belah ketupat) digambar dengan SVG, jadi tajam di semua
  resolusi. Diaktifkan di panel Gaya > Pemisah (warna dan panjang bisa diatur). Tingginya dipesan di tata letak teks, sama seperti jarak antarblok, jadi
  tidak menimpa ayat maupun terjemahan: bila ruang kurang, terjemahan lalu ayat mengecil lebih dulu. Proyek lama tidak berubah (bawaannya mati).
- **Letak overlay:** grid 3×3 di panel Overlay menempelkan overlay ke salah satu dari sembilan tempat di area aman, dengan penggeser **jarak dari tepi
  aman**. Tempat yang dipilih menentukan tepi mana yang menempel (kiri, tengah, atau kanan; atas, tengah, atau bawah), jadi overlay selebar apa pun tidak
  keluar dari bingkai. Teks rata kanan di tepi kanan dan rata kiri di tepi kiri. Overlay lama tetap di tempatnya (jangkarnya di tengah).
- Tombol **Subscribe** dan **Follow** di video kini selalu berbahasa Inggris (Subscribe → Subscribed, Follow → Following), apa pun bahasa aplikasinya.
- Dokumentasi: `docs/product/ROADMAP.md` mencatat rencana distribusi (halaman unduh, CI rilis, tanda tangan, analitik opt-in, pembaruan), keputusan yang
  menunggu pemilik produk, hal yang belum diuji, dan utang dokumentasi. Tanpa perubahan pada aplikasi.

## 0.7.0

- **English:** the whole interface, messages from the app, the text drawn into videos (lower third, Subscribe/Follow) and the Publish
  drafts now come in Bahasa Indonesia and English. Choose in Pengaturan > Umum > Bahasa; a fresh install follows the system
  language, and an existing install stays Indonesian. Terjemahan ayat tetap dipilih terpisah di langkah Teks. Panduan: `docs/user/en.md`.
- **Pengaturan** didesain ulang: navigasi bagian di kiri (Umum, Layanan AI, Pembuat gambar, Dukungan, Tentang) yang mengikuti
  gulir, dengan pilihan Bahasa, dan bagian **Dukungan** berisi tautan donasi PayPal dan Saweria.
- **Beranda:** daftar proyek kini satu baris per proyek, memuat nomor, nama Latin dan Arab surah serta rentang ayat, qari, jumlah
  segmen, durasi, tahap, dan langkah berikutnya; bisa disaring, dicari menurut surah, dan diurutkan menurut surah. Panel statis
  "Cara kerja" diganti kartu **Lanjutkan** yang menyebut langkah berikutnya untuk proyek terakhir; panduan lima langkah hanya
  tampil selama belum ada proyek. Tombol **Proyek kosong** pindah ke formulir.
- **Overlay Subscribe dan Follow:** tombol animasi yang muncul di waktu Mulai, ditekan, lalu hilang dan muncul lagi sesuai jeda
  (bawaan 6 detik tiap 60 detik), dengan nama akun opsional. Dihitung murni dari waktu, jadi pratinjau dan ekspor sama.
- Prompt Publikasi AI mengikuti bahasa aplikasi.

## 0.6.0

- **Gelombang suara (visualizer):** overlay baru yang bergerak mengikuti suara tilawah, bergaya Batang atau Gelombang. Tinggi,
  warna, kejelasan, posisi, dan waktu tampil bisa diatur seperti overlay lain. Spektrum 32 pita dihitung sekali dari audio
  sumber (sekitar 3 detik untuk 33 menit), disimpan di folder proyek, dan dipakai sama oleh pratinjau dan ekspor. Tiap pita
  diskalakan pada rentangnya sendiri, jadi bar di sisi nada tinggi ikut bergerak. Ini mengubah catatan produk lama yang
  membatasi waveform sebagai alat edit; ikon musik tetap tidak dipakai.
- **Proyek kosong:** kartu baru di Beranda untuk memulai hanya dengan nama proyek dan surah; rekaman, terjemahan, dan tampilan
  menyusul di langkah berikutnya. Formulir utama Beranda kini punya kolom **Nama proyek** (opsional).
- Gambar AI dari Pollinations kembali dipangkas untuk membuang logo di sudut kanan bawah (dengan izin pemilik produk).

## 0.5.0

- Latar: **Gerak** (cahaya lembut, geometri, partikel, berkas sinar, gelombang), dan video latar yang lebih pendek dari tilawah
  kini bisa diulang dengan tiga cara: ulang, bolak-balik, atau pudar.
- Pemilih latar baru: foto dan video stok dari Pexels, Unsplash, dan Pixabay (kunci gratis milik pengguna; kredit fotografer
  tersimpan dan ikut ke teks Publikasi), serta gambar latar buatan AI dengan 12 suasana (lofi kamar hujan, lofi atap kota
  malam, dan lainnya). Gambar AI selalu tanpa orang, hewan, dan tulisan. Penyedia: Pollinations (gratis), API kompatibel
  OpenAI, atau AI CLI.
- AI CLI (Claude Code, Codex, Antigravity, OpenCode, atau perintah sendiri) bisa menjadi penyedia AI untuk AI trim terjemahan
  dan teks Publikasi, tanpa kunci API. Pengaturan memuat pemilih penyedia dan deteksi CLI yang terpasang.
- Overlay baru: nama qari (lower third animasi), bilah kemajuan, dan ajakan. Overlay bisa digeser dan diubah panjangnya di
  linimasa, dan linimasa bisa dizoom (sampai 64×) dan di-scroll.
- Teks yang terlalu panjang: terjemahan kini mengecil lebih dulu (batas 70%), baru Arab (batas 50%), tidak lagi sampai 30%.
  Segmen yang tetap tidak muat ditandai di langkah Teks dan dicatat di dialog Ekspor. **Belah otomatis** membelah ayat panjang
  di jeda antarkata (lebih disukai setelah tanda waqaf) dan memotong terjemahan tiap bagian; bila penyebabnya terjemahan yang
  belum dipotong, aplikasi menyarankan AI trim.
- Beranda: sapaan sesuai waktu. Editor: panel samping tidak lagi meluap.

## 0.4.0

- Thumbnail: dialog baru dari header proyek untuk membuat cover Shorts, Reels, dan TikTok. Gambar latar dari gambar proyek, bingkai
  video (video latar atau sumber), atau warna polos; teks utama dengan kata terakhir berwarna, teks kecil, posisi, warna aksen,
  dan lapisan gelap. Disimpan sebagai JPG di bawah 2 MB, digambar oleh komposisi Remotion yang sama dengan pratinjau. Garis
  bantu grid profil Instagram pada format 9:16.
- Publikasi: dialog baru untuk judul, deskripsi, hashtag, dan bab YouTube per platform (Shorts, TikTok, Reels, YouTube), dengan
  hitungan karakter, tombol salin, dan simpan semua ke .txt. Draf awal ditulis dari data proyek (tanpa AI); AI opsional merapikan
  kalimat dan tidak pernah menulis teks Arab (balasan berisi Arab ditolak).
- Beranda: kartu "Lanjutkan" tidak lagi tertutup miniatur yang melebar.

## 0.3.0

- Beranda baru: formulir "Buat video tilawah" yang lebih jelas, kartu "Lanjutkan" untuk proyek terakhir, panduan cara kerja lima langkah,
  saringan status dengan jumlah, pencarian, dan urutan proyek. Kartu proyek menampilkan miniatur tampilan video (warna dan format)
  serta kemajuan tahap.
- Sinkron: kata-kata Arab kini dipisah spasi, sehingga huruf di akhir satu kata tidak lagi tersambung ke kata berikutnya.

## 0.2.1

- Sinkron: teks Uthmani Hafs kini digambar dengan font KFGQPC, bukan LPMQ, sehingga sukun, tanwin, dan jarak kata benar.
- Ekspor: server berkas lokal tidak lagi mengirim header CORS ganda yang membuat font gagal dimuat saat render.
- Sumber: daftar qari tidak lagi saling menimpa.

## 0.2.0

- Aplikasi ditulis ulang di atas Electron. Tauri dan semua crate Rust dihapus.
- Alur baru: Beranda, lalu Sumber, Sinkron, Teks, dan Editor, lalu Ekspor. Semua langkah bisa dibuka kapan saja dan proyek
  tersimpan otomatis (SQLite).
- Sumber: impor berkas, unduh tilawah qari dari MP3Quran dan QDC, unduh dari YouTube (yt-dlp), potong awal dan akhir.
- Sinkron: aligner AI cloud (Quranic Universal Aligner) dan timestamp bawaan QDC/MP3Quran, dengan editor segmen dan waktu
  per kata.
- Teks: Kemenag bawaan, Uthmani Hafs, dan QPC; terjemahan dari Quran.com; AI trim untuk ayat yang terpotong.
- Editor dan ekspor memakai Remotion: pratinjau dan hasil MP4 digambar oleh komposisi yang sama.
- UI hanya berbahasa Indonesia.
