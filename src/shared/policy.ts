import { t } from './i18n'
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

  if (!project.sourceAssetId) add('error', null, t('Proyek belum memiliki sumber audio. Silakan tambahkan tilawah di langkah Sumber.'))
  else if (!ctx.sourceOk) add('error', null, t('Berkas sumber audio tidak ditemukan. Silakan impor ulang tilawahnya di langkah Sumber.'))
  if (project.segments.length === 0) {
    add('error', null, t('Belum ada segmen ayat. Silakan jalankan sinkronisasi di langkah Sinkron.'))
    return issues
  }

  const primary = project.editions[0] as string | undefined
  const sorted = [...project.segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  sorted.forEach((seg, i) => {
    const code = segmentCode(seg)
    if (seg.endMs <= seg.startMs) add('error', seg, t('Segmen {code}: waktu selesai harus setelah waktu mulai. Mohon geser batasnya.', { code }))
    const prev = sorted[i - 1]
    if (prev && seg.startMs < prev.endMs) {
      add('error', seg, t('Segmen {code} bertumpuk dengan segmen {other}. Mohon rapikan batas waktunya agar tidak saling menimpa.', { code, other: segmentCode(prev) }))
    }
    if (seg.confidence !== null && seg.confidence < LOW_CONFIDENCE) {
      add('warning', seg, t('Segmen {code} memiliki tingkat keyakinan rendah ({pct}%). Sebaiknya didengarkan ulang.', { code, pct: Math.round(seg.confidence * 100) }))
    }
    if (seg.kind !== 'ayah') return

    const count = ctx.verses[verseKey(seg.surah, seg.ayah)]?.words.length
    if (seg.wordFrom < 1 || seg.wordFrom > seg.wordTo || (count !== undefined && seg.wordTo > count)) {
      const range = { code, from: seg.wordFrom, to: seg.wordTo, count: count ?? 0 }
      add('error', seg, count !== undefined ? t('Segmen {code}: rentang kata {from}–{to} dari {count} kata tidak sah. Mohon perbaiki rentang katanya.', range) : t('Segmen {code}: rentang kata {from}–{to} tidak sah. Mohon perbaiki rentang katanya.', range))
    }
    if (!primary) return
    const tr = seg.translations.find((t) => t.edition === primary)
    if (!tr?.text.trim()) {
      add('error', seg, t('Segmen {code} belum memiliki terjemahan utama. Silakan lengkapi di langkah Teks.', { code }))
      return
    }
    if (tr.status === 'review') add('warning', seg, t('Terjemahan segmen {code} masih ditandai perlu ditinjau.', { code }))
    const partial = seg.wordFrom > 1 || (count !== undefined && seg.wordTo < count)
    if (partial && tr.status === 'full') {
      add('warning', seg, t('Segmen {code} hanya memuat sebagian ayat, tetapi terjemahannya masih untuk ayat utuh. Silakan potong terjemahannya di langkah Teks.', { code }))
    }
  })
  return issues
}
