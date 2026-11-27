import type { Segment, Verse } from './types'
import { verseKey } from './video'

export const OPENDUA_EDITION = 'en.opendua'
export const OPENDUA_CATALOGUE_URL = 'https://opendua.org/v0.0.4/catalogue.json'
export const OPENDUA_AUDIO_HOST = 'https://audio.opendua.org/'
export const OPENDUA_CREDIT = 'OpenDua (opendua.org) · Recitation by Muhammad Jumah (CC BY 4.0)'

export interface DuaItem {
  id: string
  /** Verbatim Arabic words (1-based indexing in segments matches this array). */
  words: string[]
  /** Full English translation of this item. */
  translation: string
}

export interface DuaInfo {
  entryId: string
  title: string
  chapterTitle: string
  reciter: string
  items: DuaItem[]
}

export interface OpenDuaClip {
  id: string
  arabic: string
  words: string[]
  translation: string
  audioUrl: string
  durationSeconds: number
}

export interface OpenDuaEntry {
  id: string
  title: string
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  reciter: string
  durationSeconds: number
  clips: OpenDuaClip[]
}

export const duaVerseKey = (duaId: string): string => `dua:${duaId}`

/** Key in `verses` / `texts` maps for any segment kind. */
export function segmentVerseKey(seg: Pick<Segment, 'kind' | 'surah' | 'ayah' | 'duaId'>): string {
  if (seg.kind === 'dua') return duaVerseKey(seg.duaId ?? '')
  if (seg.kind === 'basmalah') return verseKey(1, 1)
  return verseKey(seg.surah, seg.ayah)
}

export function duaVerses(dua: DuaInfo | null | undefined): Record<string, Verse> {
  if (!dua) return {}
  const out: Record<string, Verse> = {}
  for (const item of dua.items) out[duaVerseKey(item.id)] = { surah: 0, ayah: 0, words: item.words }
  return out
}

export function duaTexts(dua: DuaInfo | null | undefined): Record<string, string> {
  if (!dua) return {}
  const out: Record<string, string> = {}
  for (const item of dua.items) out[duaVerseKey(item.id)] = item.translation
  return out
}

/** Splits verbatim Arabic text into word tokens for rendering and range slicing (never alters Arabic characters). */
export const splitArabicWords = (arabic: string): string[] => arabic.trim().split(/\s+/).filter(Boolean)

interface RawChapter {
  id?: unknown
  number?: unknown
  title?: unknown
}

interface RawReciter {
  id?: unknown
  name?: unknown
}

interface RawDua {
  id?: unknown
  arabic?: unknown
  translation?: unknown
}

interface RawRecording {
  reciterId?: unknown
  url?: unknown
  durationSeconds?: unknown
}

interface RawStep {
  type?: unknown
  items?: unknown
  recordings?: unknown
}

interface RawEntry {
  id?: unknown
  title?: unknown
  chapterId?: unknown
  variations?: unknown
}

interface RawCatalogue {
  defaultReciterId?: unknown
  chapters?: unknown
  reciters?: unknown
  entries?: unknown
}

/**
 * Parses OpenDua v2 `catalogue.json`, keeping only entries that have at least one playable recitation recording.
 * Entries without audio are skipped intentionally.
 */
export function parseOpenDuaCatalogue(raw: unknown): OpenDuaEntry[] {
  if (!raw || typeof raw !== 'object') return []
  const cat = raw as RawCatalogue
  const defaultReciterId = typeof cat.defaultReciterId === 'string' ? cat.defaultReciterId : ''
  const chapters = new Map<string, { number: number; title: string }>()
  if (Array.isArray(cat.chapters)) {
    for (const c of cat.chapters as RawChapter[]) {
      if (typeof c?.id === 'string') {
        chapters.set(c.id, {
          number: typeof c.number === 'number' ? c.number : 0,
          title: typeof c.title === 'string' ? c.title.trim() : ''
        })
      }
    }
  }
  const reciters = new Map<string, string>()
  if (Array.isArray(cat.reciters)) {
    for (const r of cat.reciters as RawReciter[]) {
      if (typeof r?.id === 'string' && typeof r.name === 'string') reciters.set(r.id, r.name.trim())
    }
  }

  const out: OpenDuaEntry[] = []
  if (!Array.isArray(cat.entries)) return out

  for (const e of cat.entries as RawEntry[]) {
    if (typeof e?.id !== 'string' || typeof e.title !== 'string') continue
    const vars = Array.isArray(e.variations) ? e.variations : []
    const steps = vars[0] && typeof vars[0] === 'object' && Array.isArray((vars[0] as { steps?: unknown }).steps)
      ? ((vars[0] as { steps: RawStep[] }).steps)
      : []

    const clips: OpenDuaClip[] = []
    const usedIds = new Set<string>()
    let reciterName = reciters.get(defaultReciterId) ?? ''

    steps.forEach((step, idx) => {
      if (step?.type !== 'recitation') return
      const recs = Array.isArray(step.recordings) ? (step.recordings as RawRecording[]) : []
      const items = Array.isArray(step.items) ? (step.items as { dua?: RawDua }[]) : []
      if (recs.length === 0 || items.length === 0) return

      const picked = recs.find((r) => r.reciterId === defaultReciterId) ?? recs[0]
      const url = typeof picked?.url === 'string' ? picked.url : ''
      if (!url.startsWith(OPENDUA_AUDIO_HOST)) return

      if (!reciterName && typeof picked.reciterId === 'string') reciterName = reciters.get(picked.reciterId) ?? ''

      const arabics: string[] = []
      const translations: string[] = []
      let firstDuaId = ''
      for (const it of items) {
        const d = it?.dua
        if (!d) continue
        if (!firstDuaId && typeof d.id === 'string') firstDuaId = d.id
        if (typeof d.arabic === 'string' && d.arabic.trim()) arabics.push(d.arabic.trim())
        if (typeof d.translation === 'string' && d.translation.trim()) translations.push(d.translation.trim())
      }
      const arabic = arabics.join(' ')
      const words = splitArabicWords(arabic)
      if (words.length === 0) return

      let clipId = firstDuaId || `${e.id}-step-${idx + 1}`
      if (usedIds.has(clipId)) clipId = `${clipId}-${idx + 1}`
      usedIds.add(clipId)

      clips.push({
        id: clipId,
        arabic,
        words,
        translation: translations.join(' '),
        audioUrl: url,
        durationSeconds: typeof picked.durationSeconds === 'number' && picked.durationSeconds > 0 ? picked.durationSeconds : 0
      })
    })

    if (clips.length === 0) continue

    const chapterId = typeof e.chapterId === 'string' ? e.chapterId : ''
    const ch = chapters.get(chapterId)
    out.push({
      id: e.id,
      title: e.title.trim(),
      chapterId,
      chapterNumber: ch?.number ?? 0,
      chapterTitle: ch?.title ?? '',
      reciter: reciterName || 'Muhammad Jumah',
      durationSeconds: clips.reduce((sum, c) => sum + c.durationSeconds, 0),
      clips
    })
  }

  return out.sort((a, b) => a.chapterNumber - b.chapterNumber)
}

/** Builds contiguous dua segments starting at 0 ms, with no per-word highlight timings. */
export function buildDuaSegments(
  clips: ReadonlyArray<{ itemId: string; wordCount: number; translation: string; durationMs: number }>,
  newId: () => string
): Segment[] {
  let cursor = 0
  return clips.map((c) => {
    const startMs = cursor
    const endMs = cursor + Math.max(1, Math.round(c.durationMs))
    cursor = endMs
    return {
      id: newId(),
      kind: 'dua',
      duaId: c.itemId,
      surah: 0,
      ayah: 0,
      wordFrom: 1,
      wordTo: Math.max(1, c.wordCount),
      startMs,
      endMs,
      confidence: null,
      source: 'opendua',
      words: [],
      translations: c.translation.trim() ? [{ edition: OPENDUA_EDITION, text: c.translation.trim(), status: 'full' }] : []
    }
  })
}
