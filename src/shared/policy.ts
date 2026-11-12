import type { PolicyIssue, Project, Segment, Verse } from './types'
import { verseKey } from './video'

export interface PolicyContext {
  /** The source asset row exists and its file is on disk. */
  sourceOk: boolean
  /** Verses of the ayahs the segments show (`${surah}:${ayah}`), for word counts. Missing ones skip the range check. */
  verses: Record<string, Verse>
}

/** Below this the aligner's placement is worth a listen before publishing. */
export const LOW_CONFIDENCE = 0.8

export function segmentCode(seg: Segment): string {
  if (seg.kind === 'basmalah') return 'Basmalah'
  if (seg.kind === 'istiadzah') return "Isti'adzah"
  return verseKey(seg.surah, seg.ayah)
}

/**
 * Export gates. Errors block the export; warnings are shown but do not. Arabic cannot be cut mid-word: segments hold
 * whole canonical word ranges by construction.
 */
export function checkExport(project: Project, ctx: PolicyContext): PolicyIssue[] {
  const issues: PolicyIssue[] = []
  const add = (severity: PolicyIssue['severity'], seg: Segment | null, message: string): void =>
    void issues.push({ segmentId: seg?.id ?? null, severity, message })

  if (!project.sourceAssetId) add('error', null, 'Proyek belum memiliki sumber audio. Silakan tambahkan tilawah di langkah Sumber.')
  else if (!ctx.sourceOk) add('error', null, 'Berkas sumber audio tidak ditemukan. Silakan impor ulang tilawahnya di langkah Sumber.')
  if (project.segments.length === 0) {
    add('error', null, 'Belum ada segmen ayat. Silakan jalankan sinkronisasi di langkah Sinkron.')
    return issues
  }

  const primary = project.editions[0] as string | undefined
  const sorted = [...project.segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  sorted.forEach((seg, i) => {
    const code = segmentCode(seg)
    if (seg.endMs <= seg.startMs) add('error', seg, `Segmen ${code}: waktu selesai harus setelah waktu mulai. Mohon geser batasnya.`)
    const prev = sorted[i - 1]
    if (prev && seg.startMs < prev.endMs) {
      add('error', seg, `Segmen ${code} bertumpuk dengan segmen ${segmentCode(prev)}. Mohon rapikan batas waktunya agar tidak saling menimpa.`)
    }
    if (seg.confidence !== null && seg.confidence < LOW_CONFIDENCE) {
      add('warning', seg, `Segmen ${code} memiliki tingkat keyakinan rendah (${Math.round(seg.confidence * 100)}%). Sebaiknya didengarkan ulang.`)
    }
    if (seg.kind !== 'ayah') return

    const count = ctx.verses[verseKey(seg.surah, seg.ayah)]?.words.length
    if (seg.wordFrom < 1 || seg.wordFrom > seg.wordTo || (count !== undefined && seg.wordTo > count)) {
      const of = count !== undefined ? ` dari ${count} kata` : ''
      add('error', seg, `Segmen ${code}: rentang kata ${seg.wordFrom}–${seg.wordTo}${of} tidak sah. Mohon perbaiki rentang katanya.`)
    }
    if (!primary) return
    const tr = seg.translations.find((t) => t.edition === primary)
    if (!tr?.text.trim()) {
      add('error', seg, `Segmen ${code} belum memiliki terjemahan utama. Silakan lengkapi di langkah Teks.`)
      return
    }
    if (tr.status === 'review') add('warning', seg, `Terjemahan segmen ${code} masih ditandai perlu ditinjau.`)
    const partial = seg.wordFrom > 1 || (count !== undefined && seg.wordTo < count)
    if (partial && tr.status === 'full') {
      add('warning', seg, `Segmen ${code} hanya memuat sebagian ayat, tetapi terjemahannya masih untuk ayat utuh. Silakan potong terjemahannya di langkah Teks.`)
    }
  })
  return issues
}
