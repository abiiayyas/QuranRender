import type { Dict } from './types'

export const text: Dict = {
  // TextStep
  'Terjemahan {n} segmen sudah diisi.': 'Filled translations for {n} segment.|Filled translations for {n} segments.',
  'Semua terjemahan sudah terisi.': 'All translations are already filled.',
  'AI belum siap.': 'AI is not ready.',
  '{n} segmen terlalu panjang karena terjemahannya belum dipotong sesuai kata yang dibaca. Silakan pakai AI trim, atau ketik potongannya.':
    '{n} segment is too long because its translation is not yet trimmed to the words recited. Use AI trim, or type the trimmed text yourself.|{n} segments are too long because their translations are not yet trimmed to the words recited. Use AI trim, or type the trimmed text yourself.',
  'Segmen ini tidak bisa dibelah lagi tanpa memotong di tengah kata. Silakan kecilkan ukuran Arab di Editor.':
    'This segment cannot be split further without cutting a word in half. Reduce the Arabic size in the Editor.',
  'Dibelah menjadi {n} bagian tambahan. Terjemahan tiap bagian dipotong otomatis; gunakan AI trim untuk hasil yang lebih halus.':
    'Split into {n} extra part. Each part’s translation was trimmed automatically; use AI trim for a smoother result.|Split into {n} extra parts. Each part’s translation was trimmed automatically; use AI trim for a smoother result.',
  "Isti'adzah": "Isti'adha",
  'Surah {id}': 'Surah {id}',
  '{name} {ayah} · kata {from}–{to} dari {total}': '{name} {ayah} · words {from}–{to} of {total}',
  'Teks dan terjemahan': 'Text and translation',
  '{n} segmen': '{n} segment|{n} segments',
  '{n} perlu dicek': '{n} to check',
  'Semua sudah siap': 'All ready',
  'Hanya yang perlu dicek': 'Only those needing review',
  'Isi terjemahan': 'Fill translations',
  'Tidak ada ayat yang terpotong.': 'No verses are partial.',
  'AI trim ayat terpotong': 'AI trim partial verses',
  '{n} segmen terlalu panjang untuk satu layar': '{n} segment is too long for one screen|{n} segments are too long for one screen',
  'Tulisannya akan mengecil sampai sulit dibaca, atau menutupi nama surah dan qari.':
    'The text will shrink until it is hard to read, or cover the surah and reciter names.',
  'Ayat yang panjang bisa dibelah di jeda yang wajar; terjemahan tiap bagian ikut dipotong.':
    'Long verses can be split at natural pauses; each part’s translation is trimmed too.',
  '{n} segmen panjang karena terjemahannya belum dipotong sesuai kata yang dibaca: pakai AI trim.':
    '{n} segment is long because its translation is not yet trimmed to the words recited: use AI trim.|{n} segments are long because their translations are not yet trimmed to the words recited: use AI trim.',
  'Belah otomatis': 'Split automatically',
  'AI trim': 'AI trim',
  'AI belum siap': 'AI is not ready',
  '{hint} Silakan atur kunci layanan atau AI CLI di Pengaturan agar ayat yang terpotong bisa dipotong terjemahannya secara otomatis.':
    '{hint} Set up a service key or AI CLI in Settings so partial verses can have their translations trimmed automatically.',
  'Buka Pengaturan': 'Open Settings',
  'Tutup': 'Close',
  'Terjemahan utama belum terpasang di perangkat ini. Silakan pasang dari panel kiri.':
    'The primary translation is not installed on this device. Install it from the left panel.',
  'Belum ada segmen': 'No segments yet',
  'Silakan sinkronkan audio di langkah Sinkron dulu, lalu terjemahan bisa diisi di sini.':
    'Sync the audio in the Sync step first, then translations can be filled in here.',
  'Tidak ada segmen yang perlu dicek. Terima kasih sudah memeriksa.': 'No segments need review. Thanks for checking.',
  'Masih ada {n} segmen yang perlu dicek sebelum ekspor.':
    '{n} segment still needs review before export.|{n} segments still need review before export.',
  'Lanjut ke Editor': 'Continue to Editor',

  // SegmentRow
  'Utuh': 'Whole',
  'Dipotong otomatis': 'Auto-trimmed',
  'Dipotong AI': 'AI-trimmed',
  'Diedit': 'Edited',
  'Perlu dicek': 'Needs review',
  'Belum ada': 'None yet',
  'Jeda {label}': 'Pause {label}',
  'Putar {label}': 'Play {label}',
  'Tulisan akan terlalu kecil atau menutupi bagian lain. Silakan belah segmen ini.':
    'The text will be too small or cover other parts. Split this segment.',
  'Terlalu panjang untuk satu layar': 'Too long for one screen',
  'Terjemahan ayat utuh:': 'Whole-verse translation:',
  'Terjemahan {label}': 'Translation for {label}',
  'Terjemahan belum diisi.': 'Translation not filled in yet.',
  'Sudah benar': 'Looks right',
  'Potong dengan AI': 'Trim with AI',
  'Belum diisi.': 'Not filled in yet.',

  // EditionsPanel
  'Terjemahan proyek': 'Project translations',
  'Belum ada terjemahan. Video hanya akan menampilkan teks Arab.': 'No translations yet. The video will show only the Arabic text.',
  'Utama': 'Primary',
  'Naikkan {name}': 'Move {name} up',
  'Turunkan {name}': 'Move {name} down',
  'Lepas {name} dari proyek': 'Remove {name} from the project',
  'Memasang {name}': 'Installing {name}',
  'Pasang {name}': 'Install {name}',
  'Belum terpasang, pasang sekarang': 'Not installed, install now',
  'Daftar terjemahan belum bisa dimuat.': 'The translation list could not be loaded.',
  'Coba lagi': 'Try again',
  'Terjemahan teratas menjadi terjemahan utama di video dan subtitle.': 'The top translation is the primary one in the video and subtitles.',
  'Tambah terjemahan': 'Add translation',

  // EditionPicker
  'Hapus {name} dari perangkat?': 'Delete {name} from this device?',
  'Teks terjemahan ini akan dihapus dari komputer. Terjemahan yang sudah tersimpan di proyek tetap ada, dan edisi ini bisa dipasang lagi kapan saja.':
    'This translation text will be deleted from your computer. Translations already saved in projects stay, and you can install this edition again any time.',
  'Hapus': 'Delete',
  'Selesai': 'Done',
  'Cari terjemahan': 'Search translations',
  'Cari nama, penerjemah, atau bahasa': 'Search by name, translator or language',
  'Bahasa': 'Language',
  'Semua bahasa': 'All languages',
  'Katalog Quran.com belum bisa dimuat: {error}': 'The Quran.com catalog could not be loaded: {error}',
  'Memuat katalog terjemahan…': 'Loading the translation catalog…',
  'Tidak ada terjemahan yang cocok dengan pencarian ini.': 'No translations match this search.',
  'Bawaan': 'Built in',
  'Terpasang': 'Installed',
  'Memasang {percent}%': 'Installing {percent}%',
  'Hapus {name} dari perangkat': 'Delete {name} from this device',
  'Hapus dari perangkat': 'Delete from this device',
  '{name} sudah dipakai': '{name} is already in use',
  'Tambahkan {name}': 'Add {name}',
  'Dipakai': 'In use',
  'Tambah': 'Add',
  'Pasang': 'Install',
  'Terjemahan selain Kemenag diunduh dari Quran.com sekali, lalu bisa dipakai tanpa internet.':
    'Translations other than Kemenag are downloaded from Quran.com once, then work without internet.'
}
