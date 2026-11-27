import type { Dict } from './types'

export const shared: Dict = {
  'Proyek belum memiliki sumber audio. Silakan tambahkan tilawah di langkah Sumber.': 'This project has no audio source yet. Add a recitation in the Source step.',
  'Berkas sumber audio tidak ditemukan. Silakan impor ulang tilawahnya di langkah Sumber.': 'The audio source file was not found. Import the recitation again in the Source step.',
  'Belum ada segmen ayat. Silakan jalankan sinkronisasi di langkah Sinkron.': 'There are no verse segments yet. Run sync in the Sync step.',
  'Segmen {code}: waktu selesai harus setelah waktu mulai. Mohon geser batasnya.': 'Segment {code}: the end time must come after the start time. Move the boundary.',
  'Segmen {code} bertumpuk dengan segmen {other}. Mohon rapikan batas waktunya agar tidak saling menimpa.': 'Segment {code} overlaps segment {other}. Tidy up the boundaries so they do not overlap.',
  'Segmen {code} memiliki tingkat keyakinan rendah ({pct}%). Sebaiknya didengarkan ulang.': 'Segment {code} has low confidence ({pct}%). Listen to it again.',
  'Segmen {code}: rentang kata {from}–{to} dari {count} kata tidak sah. Mohon perbaiki rentang katanya.': 'Segment {code}: the word range {from}–{to} of {count} words is not valid. Fix the word range.',
  'Segmen {code}: rentang kata {from}–{to} tidak sah. Mohon perbaiki rentang katanya.': 'Segment {code}: the word range {from}–{to} is not valid. Fix the word range.',
  'Segmen {code} belum memiliki terjemahan utama. Silakan lengkapi di langkah Teks.': 'Segment {code} has no primary translation yet. Add it in the Text step.',
  'Terjemahan segmen {code} masih ditandai perlu ditinjau.': 'The translation of segment {code} is still marked as needing review.',
  'Segmen {code} hanya memuat sebagian ayat, tetapi terjemahannya masih untuk ayat utuh. Silakan potong terjemahannya di langkah Teks.':
    'Segment {code} holds only part of the verse, but its translation is still for the whole verse. Trim the translation in the Text step.',
  'Segmen {code} hanya memuat sebagian teks, tetapi terjemahannya masih utuh. Silakan potong terjemahannya di langkah Teks.':
    'Segment {code} holds only part of the text, but its translation is still whole. Trim the translation in the Text step.',
  'Jumlah kata ayat {surah}:{ayah} tidak sesuai peta kata ({found}, seharusnya {expected}).': 'The word count of verse {surah}:{ayah} does not match the word map ({found}, expected {expected}).',
  'Peta kata ayat {surah}:{ayah} tidak konsisten.': 'The word map of verse {surah}:{ayah} is inconsistent.',
  'Waktu ayat dari penyedia tidak lengkap untuk rentang ini.': 'The provider’s verse timings are incomplete for this range.',
  'Utuh': 'Whole',
  'Dipotong otomatis': 'Auto-trimmed',
  'Dipotong AI': 'AI-trimmed',
  'Diedit': 'Edited',
  'Perlu dicek': 'Needs review',
  'Jangan lupa bagikan dan doakan': 'Don’t forget to share and pray for us',
  'Nama qari': 'Reciter name',
  'Kemajuan': 'Progress',
  'Gelombang suara': 'Sound wave',
  'Gambar': 'Image',
  'Doa {what} oleh {reciter}.': 'Dua {what} by {reciter}.',
  'Doa {what}.': 'Dua {what}.',
  'Teks Arab ditampilkan apa adanya, lengkap dengan terjemahan.': 'Arabic text is shown verbatim with its translation.',
  'Sumber audio & teks: {credit}.': 'Audio & text source: {credit}.',
  '#Doa': '#Dua',
  '#Dzikir': '#Dhikr'
}
