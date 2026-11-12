# Changelog

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
