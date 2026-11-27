import type { Dict } from './types'

export const source: Dict = {
  // SourceStep
  'Berkas': 'File',
  'Qari': 'Reciter',
  'Doa': 'Dua',
  'Mengunduh tilawah': 'Downloading recitation',
  'Mengunduh doa': 'Downloading dua',
  'Menyiapkan yt-dlp': 'Preparing yt-dlp',
  'Mengunduh dari YouTube': 'Downloading from YouTube',
  'Memotong sumber': 'Trimming source',
  'Pilihan sumber': 'Source options',
  'Ambil rekaman dari': 'Get a recording from',
  'Asal rekaman': 'Recording origin',
  'Sumber proyek': 'Project source',
  'Belum ada rekaman': 'No recording yet',
  'Silakan impor berkas audio atau video, unduh tilawah qari, ambil dari YouTube, atau pilih doa OpenDua melalui panel di kiri.':
    'Import an audio or video file, download a reciter’s recitation, get one from YouTube, or pick an OpenDua supplication using the panel on the left.',
  'Tambahkan rekaman terlebih dahulu.': 'Add a recording first.',
  '{n} segmen doa siap. Silakan periksa di langkah Sinkron.':
    '{n} dua segment is ready. Check it in the Sync step.|{n} dua segments are ready. Check them in the Sync step.',
  '{n} segmen sudah siap dari waktu bawaan qari. Silakan periksa di langkah Sinkron.':
    '{n} segment is ready from the reciter’s built-in timing. Check it in the Sync step.|{n} segments are ready from the reciter’s built-in timing. Check them in the Sync step.',
  'Rekaman siap disinkronkan dengan ayat.': 'The recording is ready to sync with the verses.',
  'Lanjut ke Sinkron': 'Continue to Sync',
  'Detail proyek': 'Project details',
  'Bab': 'Chapter',
  'Teks Arab dan terjemahan Inggris diambil langsung dari OpenDua (Hisn al-Muslim).':
    'Arabic text and English translation are taken directly from OpenDua (Hisn al-Muslim).',
  'Rentang ayat': 'Verse range',
  'Rentang dipakai saat mengunduh tilawah qari dan saat sinkronisasi. Mengubahnya tidak memotong rekaman.':
    'The range is used when downloading a reciter’s recitation and when syncing. Changing it does not trim the recording.',
  'Nama qari': 'Reciter name',
  'Contoh: Mishary Rashid Alafasy': 'Example: Mishary Rashid Alafasy',
  'Ditampilkan di video bila gaya memakai nama qari.': 'Shown in the video when the style uses the reciter name.',
  'Rekaman': 'Recording',
  'Jenis': 'Type',
  'Video': 'Video',
  'Audio': 'Audio',
  'Durasi': 'Duration',
  'Asal': 'Origin',
  'Ukuran': 'Size',
  'Segmen': 'Segment',

  // LocalPanel
  '{name} sudah menjadi sumber proyek.': '{name} is now the project source.',
  'Silakan seret satu berkas saja.': 'Drag just one file.',
  'Berkas ini tidak bisa dibaca. Silakan pilih lewat tombol.': 'This file can’t be read. Choose it with the button instead.',
  'Format .{ext} belum didukung. Silakan pakai {formats}.': 'The .{ext} format isn’t supported yet. Use {formats}.',
  'Berkas di komputer': 'File on this computer',
  'Impor gagal': 'Import failed',
  'Sedang mengimpor…': 'Importing…',
  'Lepaskan untuk mengimpor': 'Drop to import',
  'Seret rekaman ke sini': 'Drag a recording here',
  'Audio (mp3, m4a, wav, flac, ogg, opus) atau video (mp4, mov, mkv, webm).': 'Audio (mp3, m4a, wav, flac, ogg, opus) or video (mp4, mov, mkv, webm).',
  'Pilih berkas': 'Choose file',
  'Video dipakai suaranya sebagai sumber, dan gambarnya bisa dijadikan latar di Editor.':
    'A video’s sound becomes the source, and its picture can be used as the background in the Editor.',

  // ReciterPanel
  'Tilawah qari': 'Reciter recitation',
  'Penyedia tilawah': 'Recitation provider',
  'Silakan pilih surah dan rentang ayat terlebih dahulu.': 'Choose a surah and verse range first.',
  'Yang diunduh: {range}.': 'Will download: {range}.',
  'Cari qari': 'Search reciters',
  'Daftar qari tidak bisa dimuat': 'Couldn’t load the reciter list',
  'Memuat daftar qari…': 'Loading reciters…',
  'Daftar qari': 'Reciter list',
  'Tidak ada qari yang cocok.': 'No matching reciters.',
  'tersinkron otomatis': 'auto-synced',
  'Unduh tilawah': 'Download recitation',
  'Waktu tiap ayat ikut diunduh, jadi rekaman langsung tersinkron.': 'Verse timings are downloaded too, so the recording is synced right away.',
  'Qari ini belum punya data waktu ayat. Satu surah penuh akan diunduh, lalu disinkronkan di langkah berikutnya.':
    'This reciter has no verse timing data. The full surah will be downloaded, then synced in the next step.',

  // YoutubePanel
  'Unduhan gagal': 'Download failed',

  // DuaPanel
  'Doa (OpenDua)': 'Dua (OpenDua)',
  'Cari doa': 'Search duas',
  'Cari judul atau bab doa': 'Search dua title or chapter',
  'Daftar doa tidak bisa dimuat': 'Couldn’t load the dua list',
  'Memuat daftar doa…': 'Loading duas…',
  'Daftar doa': 'Dua list',
  'Tidak ada doa yang cocok.': 'No matching duas.',
  'Unduh doa': 'Download dua',
  'Data & audio Hisn al-Muslim dari OpenDua (CC BY 4.0) oleh Muhammad Jumah.':
    'Hisn al-Muslim data & audio from OpenDua (CC BY 4.0) by Muhammad Jumah.',
  'Alamat video': 'Video link',
  'Silakan masukkan alamat https dari youtube.com atau youtu.be.': 'Please enter an https address from youtube.com or youtu.be.',
  'Unduh audio': 'Download audio',
  'Hanya suaranya yang diunduh. Pada pemakaian pertama, aplikasi mengunduh alat yt-dlp terlebih dahulu.':
    'Only the audio is downloaded. The first time, the app downloads the yt-dlp tool first.',
  'Pastikan Anda berhak memakai rekaman tersebut.': 'Make sure you have the right to use that recording.',

  // replace.ts
  'Ganti rekaman?': 'Replace the recording?',
  'Proyek ini sudah memiliki {n} segmen. Waktunya mengikuti rekaman lama, jadi segmen akan dihapus dan perlu disinkronkan ulang.':
    'This project already has {n} segment. Its timing follows the old recording, so it will be deleted and must be synced again.|This project already has {n} segments. Their timing follows the old recording, so they will be deleted and must be synced again.',
  'Ganti rekaman': 'Replace recording',

  // SourceCard
  'Hasil potongan': 'Trimmed result',
  'Bingkai video': 'Video frame',
  'Foto/video stok': 'Stock photo/video',
  'Dibuat dengan AI': 'Made with AI',
  'Tulis waktu seperti 1:05,2 atau 65,2.': 'Enter a time like 1:05.2 or 65.2.',
  'Titik masuk': 'In point',
  'Titik keluar': 'Out point',
  'Potong rekaman?': 'Trim the recording?',
  'Waktu segmen akan digeser mengikuti potongan, dan {n} segmen di luar potongan akan dihapus.':
    'Segment timings will shift to match the trim, and {n} segment outside the trim will be deleted.|Segment timings will shift to match the trim, and {n} segments outside the trim will be deleted.',
  'Waktu segmen akan digeser mengikuti potongan.': 'Segment timings will shift to match the trim.',
  'Potong': 'Trim',
  'Klik untuk memindahkan posisi pemutar': 'Click to move the playhead',
  'Bentuk gelombang {name}': 'Waveform of {name}',
  'Menyiapkan bentuk gelombang…': 'Preparing waveform…',
  'Jeda': 'Pause',
  'Putar': 'Play',
  'Kembali ke awal': 'Back to start',
  'Potong awal dan akhir': 'Trim the start and end',
  'Masuk di posisi pemutar': 'In at playhead',
  'Keluar di posisi pemutar': 'Out at playhead',
  'Geser pegangan pada gelombang, atau tulis waktunya. Bagian yang diarsir akan dibuang.':
    'Drag the handles on the waveform, or type the times. The shaded part will be removed.',
  'Putar potongan': 'Play trimmed part',
  'Atur ulang': 'Reset'
}
