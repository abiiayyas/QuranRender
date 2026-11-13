import type { Dict } from './types'

export const sync: Dict = {
  // SyncStep
  'Belum ada audio': 'No audio yet',
  'Sinkron membutuhkan rekaman tilawah. Silakan tambahkan sumber audio atau video terlebih dahulu.':
    'Sync needs a recording of the recitation. Add an audio or video source first.',
  'Ke langkah Sumber': 'Go to the Source step',
  'Posisi pemutar ada di dalam segmen {label}. Silakan pindahkan pemutar ke bagian yang belum bersegmen.':
    'The playhead is inside segment {label}. Move it to a part that has no segment yet.',
  'Ruang kosong di posisi pemutar terlalu sempit untuk segmen baru.': 'The gap at the playhead is too small for a new segment.',
  'Segmen': 'Segment',
  '{n} segmen': '{n} segment|{n} segments',
  '{n} perlu dicek': '{n} to check',
  'Berikutnya yang perlu dicek': 'Next one to check',
  'Lanjut ke Teks': 'Continue to Text',
  'Memuat teks ayat…': 'Loading verse text…',
  'Pilih segmen untuk melihat teksnya.': 'Select a segment to see its text.',
  'Mundur 2 detik': 'Back 2 seconds',
  'Jeda': 'Pause',
  'Putar': 'Play',
  'Putar/jeda (Spasi)': 'Play/pause (Space)',
  'Maju 2 detik': 'Forward 2 seconds',
  'Putar segmen': 'Play segment',
  'Spasi: putar/jeda · ←/→: segmen sebelum/berikutnya': 'Space: play/pause · ←/→: previous/next segment',
  'Detail segmen': 'Segment details',
  'Belum ada segmen yang dipilih.': 'No segment selected.',
  'Tambah segmen di pemutar': 'Add segment at playhead',

  // AlignPanel
  'Ganti segmen yang ada?': 'Replace the existing segments?',
  'Proyek ini sudah punya {n} segmen. Sinkron otomatis akan menggantinya dengan hasil baru, termasuk suntingan waktu dan terjemahan per segmen. Anda masih bisa membatalkannya dengan Urungkan.':
    'This project already has {n} segment. Auto sync will replace it with a new result, including its timing edits and translation. You can still reverse this with Undo.|This project already has {n} segments. Auto sync will replace them with new results, including their timing edits and per-segment translations. You can still reverse this with Undo.',
  'Ganti segmen': 'Replace segments',
  'Sinkron otomatis (AI)': 'Auto sync (AI)',
  'Model penyelaras': 'Aligner model',
  'Lebih cepat, cukup untuk tilawah yang jelas': 'Faster, good enough for clear recitation',
  'Lebih teliti, lebih lama': 'More accurate, slower',
  'Audio dikirim ke layanan publik Hugging Face Space (Quranic Universal Aligner) untuk dikenali ayat dan waktu katanya.':
    'The audio is sent to a public Hugging Face Space (Quranic Universal Aligner) to recognize the verses and word timings.',
  'Mulai sinkron otomatis': 'Start auto sync',
  'Menyinkronkan': 'Syncing',
  'Sinkron otomatis gagal': 'Auto sync failed',
  'Terjadi kesalahan.': 'Something went wrong.',
  'Tutup': 'Close',

  // SegmentList
  'Manual': 'Manual',
  'Belum ada segmen. Jalankan sinkron otomatis, atau tambahkan segmen secara manual di posisi pemutar.':
    'No segments yet. Run auto sync, or add segments manually at the playhead.',
  'Daftar segmen': 'Segment list',
  'Perlu dicek': 'Needs review',

  // SegmentInspector
  'Ayat': 'Verse',
  'Nomor ayat tidak ada di surah ini.': 'That verse number doesn’t exist in this surah.',
  'Segmen {label}': 'Segment {label}',
  'Segmen ini belum punya waktu per kata. Silakan periksa batasnya, lalu ratakan waktu kata.':
    'This segment has no word timings yet. Check its boundaries, then even out the word timings.',
  'Keyakinan penyelaras rendah, atau ada kata yang terlewat atau terulang. Silakan dengarkan dan periksa batasnya.':
    'The aligner’s confidence is low, or a word was skipped or repeated. Listen and check the boundaries.',
  'Tandai sudah dicek': 'Mark as checked',
  'Mulai': 'Start',
  'Waktu mulai': 'Start time',
  'Mulai dari pemutar': 'Start from playhead',
  'Dari pemutar': 'From playhead',
  'Akhir': 'End',
  'Waktu selesai': 'End time',
  'Selesai dari pemutar': 'End from playhead',
  'Durasi {time}. Tepi segmen juga bisa diseret di gelombang suara.': 'Duration {time}. You can also drag the segment edges on the sound wave.',
  'Isi segmen': 'Segment content',
  'Jenis segmen': 'Segment type',
  'Surah': 'Surah',
  'Pilih surah': 'Choose a surah',
  'Dari kata': 'From word',
  'Sampai kata': 'To word',
  'Ayat ini terdiri dari {n} kata.': 'This verse has {n} word.|This verse has {n} words.',
  'Terapkan': 'Apply',
  'Letakkan pemutar di dalam segmen ayat, di antara dua kata': 'Place the playhead inside a verse segment, between two words',
  'Belah di pemutar': 'Split at playhead',
  'Hanya bagian dari ayat yang sama yang bisa digabung': 'Only parts of the same verse can be merged',
  'Gabung dengan berikutnya': 'Merge with next',
  'Tambah di pemutar': 'Add at playhead',
  'Hapus': 'Delete',
  'Waktu per kata': 'Word timings',
  'Ratakan waktu kata': 'Even out word timings',
  'Teks ayat belum dimuat.': 'Verse text isn’t loaded yet.',
  'Mulai kata {n}': 'Start of word {n}',
  'Putar kata {n}': 'Play word {n}',
  'tanpa waktu': 'no timing',

  // SyncTimeline
  'Perkecil tampilan': 'Zoom out',
  'Perbesar tampilan': 'Zoom in',
  'Segmen {label}, {from} sampai {to}': 'Segment {label}, {from} to {to}',
  'Gelombang suara seluruh audio': 'Sound wave of the whole audio',
  'Gelombang suara tidak bisa dimuat.': 'Couldn’t load the sound wave.',
  'Memuat gelombang suara…': 'Loading sound wave…'
}
