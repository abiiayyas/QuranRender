import { segmentVerseKey } from '../shared/dua'
import type { Segment, Verse, WordTiming } from '../shared/types'

export const ISTIADZAH = 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ'

/** One drawn word: its text plus every canonical word it stands for (joined slots ride along with the word before). */
export interface DisplayWord {
  text: string
  idxs: number[]
}

/** The segment on screen at `t`; the later one wins where two overlap. Gaps return null. */
export function activeSegment(segments: ReadonlyArray<Segment>, t: number): Segment | null {
  let best: Segment | null = null
  for (const s of segments) if (s.startMs <= t && t < s.endMs && (!best || s.startMs >= best.startMs)) best = s
  return best
}

/** Words a segment shows, plus the verse they came from (for QPC page fonts). */
export function segmentWords(seg: Segment, verses: Record<string, Verse>): { words: DisplayWord[]; verse: Verse | null } {
  if (seg.kind === 'istiadzah') return { words: ISTIADZAH.split(' ').map((text, i) => ({ text, idxs: [i + 1] })), verse: null }
  const verse = verses[segmentVerseKey(seg)]
  if (!verse) return { words: [], verse: null }
  const all = seg.kind === 'basmalah' || seg.wordFrom < 1
  const from = all ? 1 : seg.wordFrom
  const to = all ? verse.words.length : Math.min(seg.wordTo, verse.words.length)
  const words: DisplayWord[] = []
  for (let i = from; i <= to; i++) {
    const text = verse.words[i - 1] ?? ''
    if (text === '' && words.length > 0) words[words.length - 1].idxs.push(i)
    else if (text !== '') words.push({ text, idxs: [i] })
  }
  return { words, verse }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** How long a word takes to light up or go out, ms. */
export const WORD_RAMP_MS = 80

/**
 * Karaoke strength 0..1 per display word at `t`. A word stays lit from its start until the next word starts (gaps
 * hold the previous word), and the last one until the segment ends. Null when the segment has no word timing.
 */
export function wordWeights(words: DisplayWord[], timings: ReadonlyArray<WordTiming>, t: number, segEnd: number): number[] | null {
  if (timings.length === 0) return null
  const startOf = new Map<number, number>()
  for (const w of timings) startOf.set(w.idx, Math.min(w.startMs, startOf.get(w.idx) ?? Infinity))
  const starts = words.map((w) => Math.min(...w.idxs.map((i) => startOf.get(i) ?? Infinity)))
  const order = starts.map((s, i) => [s, i] as const).filter(([s]) => Number.isFinite(s)).sort((a, b) => a[0] - b[0])
  const out = words.map(() => 0)
  order.forEach(([s, i], k) => {
    const e = k + 1 < order.length ? order[k + 1][0] : segEnd
    out[i] = clamp01((t - s) / WORD_RAMP_MS) * (1 - clamp01((t - e) / WORD_RAMP_MS))
  })
  return out
}

/** Fade in at the start and out at the end of a window. */
export function fadeAt(t: number, start: number, end: number, fadeMs: number): number {
  if (fadeMs <= 0) return 1
  return Math.min(clamp01((t - start) / fadeMs), clamp01((end - t) / fadeMs))
}
