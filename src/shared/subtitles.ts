import type { Project, Segment, Verse } from './types'
import { verseKey } from './video'

export type SubtitleMode = 'arabic' | 'translation' | 'both'

/** Isti'adzah is not part of the mushaf, so no `Verse` carries it. */
export const ISTIADZAH_TEXT = 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ'

interface Cue {
  startMs: number
  endMs: number
  text: string
}

/** The Arabic a segment shows: its canonical word range, joined words ('' slots) skipped. Basmalah = all of 1:1. */
export function segmentArabic(seg: Segment, verses: Record<string, Verse>): string {
  if (seg.kind === 'istiadzah') return ISTIADZAH_TEXT
  const v = seg.kind === 'basmalah' ? verses[verseKey(1, 1)] : verses[verseKey(seg.surah, seg.ayah)]
  if (!v) return ''
  const words = seg.kind === 'basmalah' ? v.words : v.words.slice(Math.max(0, seg.wordFrom - 1), seg.wordTo)
  return words.filter((w) => w !== '').join(' ')
}

export function segmentTranslation(project: Project, seg: Segment): string {
  const primary = project.editions[0]
  return (seg.translations.find((t) => t.edition === primary)?.text ?? '').trim()
}

function cues(project: Project, verses: Record<string, Verse>, mode: SubtitleMode): Cue[] {
  return [...project.segments]
    .sort((a, b) => a.startMs - b.startMs)
    .map((seg) => {
      const ar = mode === 'translation' ? '' : segmentArabic(seg, verses)
      const tr = mode === 'arabic' ? '' : segmentTranslation(project, seg)
      return { startMs: seg.startMs, endMs: seg.endMs, text: [ar, tr].filter(Boolean).join('\n') }
    })
    .filter((c) => c.text !== '' && c.endMs > c.startMs)
}

function timecode(ms: number, sep: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3_600_000)
  const m = Math.floor(t / 60_000) % 60
  const s = Math.floor(t / 1000) % 60
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`
}

export function toSrt(project: Project, verses: Record<string, Verse>, mode: SubtitleMode): string {
  return cues(project, verses, mode)
    .map((c, i) => `${i + 1}\n${timecode(c.startMs, ',')} --> ${timecode(c.endMs, ',')}\n${c.text}\n`)
    .join('\n')
}

export function toVtt(project: Project, verses: Record<string, Verse>, mode: SubtitleMode): string {
  const body = cues(project, verses, mode)
    .map((c) => `${timecode(c.startMs, '.')} --> ${timecode(c.endMs, '.')}\n${c.text}\n`)
    .join('\n')
  return `WEBVTT\n\n${body}`
}

/** m:ss, or h:mm:ss from one hour on (the form YouTube reads from a description). */
export function chapterTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor(sec / 60) % 60
  const s = String(sec % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** YouTube ignores chapters shorter than this. */
const MIN_CHAPTER_S = 10

interface Unit {
  kind: Segment['kind']
  surah: number
  ayah: number
}

interface Chapter {
  sec: number
  units: Unit[]
}

function unitLabel(u: Unit, surahName: string): string {
  if (u.kind === 'basmalah') return 'Basmalah'
  if (u.kind === 'istiadzah') return "Isti'adzah"
  return `QS ${surahName ? `${surahName} ` : ''}${u.surah}:${u.ayah}`
}

function chapterLabel(c: Chapter, surahName: string): string {
  const first = c.units[0]
  const last = c.units[c.units.length - 1]
  if (first === last) return unitLabel(first, surahName)
  if (first.kind === 'ayah' && last.kind === 'ayah' && first.surah === last.surah) return `${unitLabel(first, surahName)}–${last.ayah}`
  return `${unitLabel(first, surahName)} – ${unitLabel(last, surahName)}`
}

/**
 * YouTube chapter lines (`0:00 QS Al-Baqarah 2:255`), one per ayah. YouTube needs the first at 0:00 and every chapter at
 * least 10 s long, so shorter ones are merged into the chapter before them (the label becomes a range).
 * `durationMs`, when known, also keeps the last chapter from being too short.
 */
export function youtubeChapters(project: Project, surahName: string, durationMs?: number): string[] {
  const chapters: Chapter[] = []
  for (const seg of [...project.segments].sort((a, b) => a.startMs - b.startMs)) {
    const unit: Unit = { kind: seg.kind, surah: seg.surah, ayah: seg.ayah }
    const prev = chapters[chapters.length - 1]?.units.at(-1)
    // Several segments of one ayah (split ayah) are one chapter.
    if (prev && prev.kind === unit.kind && prev.surah === unit.surah && prev.ayah === unit.ayah) continue
    chapters.push({ sec: Math.floor(seg.startMs / 1000), units: [unit] })
  }
  if (chapters.length === 0) return []
  chapters[0].sec = 0

  const merged: Chapter[] = [chapters[0]]
  for (const c of chapters.slice(1)) {
    const cur = merged[merged.length - 1]
    if (c.sec - cur.sec < MIN_CHAPTER_S) cur.units.push(...c.units)
    else merged.push(c)
  }
  if (durationMs !== undefined && merged.length > 1) {
    const last = merged[merged.length - 1]
    if (Math.floor(durationMs / 1000) - last.sec < MIN_CHAPTER_S) merged[merged.length - 2].units.push(...merged.pop()!.units)
  }
  return merged.map((c) => `${chapterTime(c.sec)} ${chapterLabel(c, surahName)}`)
}
