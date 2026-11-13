# Changelog

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
