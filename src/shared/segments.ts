import { ISTIADZAH_TEXT } from './subtitles'
import type { Segment, SegmentKind, Verse, WordTiming } from './types'

/** Below this aligner confidence a segment is flagged for review. */
export const REVIEW_CONFIDENCE = 0.8
/** Shortest segment the editing helpers produce. */
export const MIN_SEGMENT_MS = 100

export type Edge = 'start' | 'end'

export const newSegmentId = (): string => crypto.randomUUID()

/** By start time (a list is not guaranteed sorted after inserts). */
export function sortSegments(segments: ReadonlyArray<Segment>): Segment[] {
  return [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

/** The segment playing at `ms` (start inclusive, end exclusive). */
export function segmentAt(segments: ReadonlyArray<Segment>, ms: number): Segment | null {
  return segments.find((s) => ms >= s.startMs && ms < s.endMs) ?? null
}

/** Word under `ms` within a segment's own timings. */
export function wordAt(seg: Segment, ms: number): number | null {
  return seg.words.find((w) => ms >= w.startMs && ms < w.endMs)?.idx ?? null
}

/** Shows only part of its ayah or dua. `wordCount` unknown: only a late start counts. */
export function isPartial(seg: Pick<Segment, 'kind' | 'wordFrom' | 'wordTo'>, wordCount?: number): boolean {
  if (seg.kind !== 'ayah' && seg.kind !== 'dua') return false
  return seg.wordFrom > 1 || (wordCount != null && seg.wordTo < wordCount)
}

/** `2:255`, `2:255 (3–9)` for a partial ayah, `Doa` / `Doa (1–5)`, or Basmalah / Isti'adzah. */
export function segmentLabel(seg: Pick<Segment, 'kind' | 'surah' | 'ayah' | 'wordFrom' | 'wordTo'>, wordCount?: number): string {
  if (seg.kind === 'basmalah') return 'Basmalah'
  if (seg.kind === 'istiadzah') return "Isti'adzah"
  if (seg.kind === 'dua') return isPartial(seg, wordCount) ? `Doa (${seg.wordFrom}–${seg.wordTo})` : 'Doa'
  const code = `${seg.surah}:${seg.ayah}`
  return isPartial(seg, wordCount) ? `${code} (${seg.wordFrom}–${seg.wordTo})` : code
}

/** Low aligner confidence or no per-word timing. Manual and dua segments (no word highlight) are trusted. */
export function needsReview(seg: Segment): boolean {
  if (seg.kind === 'dua') return seg.confidence != null && seg.confidence < REVIEW_CONFIDENCE
  return (seg.confidence != null && seg.confidence < REVIEW_CONFIDENCE) || seg.words.length === 0
}

/**
 * The words a segment shows, with canonical numbers. Basmalah uses all of 1:1 (pass that verse); isti'adzah has its own
 * fixed text. Joined slots ('' in this script) stay, so numbering matches every script.
 */
export function segmentWordTexts(seg: Segment, verse?: Verse | null): { idx: number; text: string }[] {
  if (seg.kind === 'istiadzah') return ISTIADZAH_TEXT.split(' ').map((text, i) => ({ idx: i + 1, text }))
  if (seg.kind === 'basmalah') return (verse?.words ?? []).map((text, i) => ({ idx: i + 1, text }))
  const out: { idx: number; text: string }[] = []
  for (let i = Math.max(1, seg.wordFrom); i <= seg.wordTo; i++) out.push({ idx: i, text: verse?.words[i - 1] ?? '' })
  return out
}

/**
 * Word timings spread over the segment by letter count (marks excluded). Used when a segment has no timings or its
 * range changed by hand. Joined slots and unknown text weigh as one letter so they still get a sliver.
 */
export function proportionalWords(seg: Segment, verse?: Verse | null): WordTiming[] {
  const words = segmentWordTexts(seg, verse)
  if (words.length === 0) return []
  const weights = words.map((w) => Math.max(w.text.replace(/\p{M}/gu, '').length, 1))
  const total = weights.reduce((a, b) => a + b, 0)
  const span = seg.endMs - seg.startMs
  let acc = 0
  return words.map((w, i) => {
    const startMs = seg.startMs + Math.round((span * acc) / total)
    acc += weights[i]
    const endMs = i === words.length - 1 ? seg.endMs : seg.startMs + Math.round((span * acc) / total)
    return { idx: w.idx, startMs, endMs }
  })
}

/** Moves both edges; word timings map linearly onto the new span so none falls outside it. */
export function retime(seg: Segment, startMs: number, endMs: number): Segment {
  const oldStart = seg.startMs
  const oldSpan = seg.endMs - oldStart
  const newSpan = endMs - startMs
  const map = (ms: number): number => (oldSpan <= 0 ? startMs : Math.round(startMs + ((ms - oldStart) * newSpan) / oldSpan))
  return { ...seg, startMs, endMs, words: seg.words.map((w) => ({ ...w, startMs: map(w.startMs), endMs: map(w.endMs) })) }
}

/**
 * Moves word `idx`'s start, kept between the previous word's start and its own end. The previous word's end follows
 * when the two touched or overlapped, so a contiguous karaoke stays contiguous.
 */
export function setWordStart(seg: Segment, idx: number, ms: number): Segment {
  const words = [...seg.words].sort((a, b) => a.idx - b.idx)
  const i = words.findIndex((w) => w.idx === idx)
  if (i < 0) return seg
  const cur = words[i]
  const prev = i > 0 ? words[i - 1] : null
  const at = Math.round(Math.min(Math.max(ms, prev ? prev.startMs : seg.startMs), cur.endMs))
  words[i] = { ...cur, startMs: at }
  if (prev && prev.endMs >= cur.startMs) words[i - 1] = { ...prev, endMs: at }
  return { ...seg, words }
}

/**
 * Moves one edge of segment `id` to `ms`, clamped so it and its neighbor keep `minMs`. A neighbor that it would overlap,
 * or that shares the edge, moves with it, so segments never overlap and joined boundaries stay joined. Returns the sorted
 * list and the edge position used, or null when the segment is missing or has no room.
 */
export function setEdge(
  segments: ReadonlyArray<Segment>,
  id: string,
  edge: Edge,
  ms: number,
  maxMs: number,
  minMs = MIN_SEGMENT_MS
): { segments: Segment[]; ms: number } | null {
  const list = sortSegments(segments)
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  const seg = list[i]
  if (edge === 'start') {
    const prev = i > 0 ? list[i - 1] : null
    const lo = prev ? prev.startMs + minMs : 0
    const hi = seg.endMs - minMs
    if (lo > hi) return null
    const at = Math.round(Math.min(Math.max(ms, lo), hi))
    list[i] = retime(seg, at, seg.endMs)
    if (prev && (prev.endMs > at || prev.endMs === seg.startMs)) list[i - 1] = retime(prev, prev.startMs, at)
    return { segments: list, ms: at }
  }
  const next = i + 1 < list.length ? list[i + 1] : null
  const lo = seg.startMs + minMs
  const hi = next ? next.endMs - minMs : maxMs
  if (lo > hi) return null
  const at = Math.round(Math.min(Math.max(ms, lo), hi))
  list[i] = retime(seg, seg.startMs, at)
  if (next && (next.startMs < at || next.startMs === seg.endMs)) list[i + 1] = retime(next, at, next.endMs)
  return { segments: list, ms: at }
}

/** Nearest of `targets` within `tolMs` of `ms`, else `ms`. */
export function snapMs(ms: number, targets: ReadonlyArray<number>, tolMs: number): number {
  let best = ms
  let dist = tolMs
  for (const t of targets) {
    const d = Math.abs(t - ms)
    if (d <= dist) {
      dist = d
      best = t
    }
  }
  return best
}

/**
 * Splits an ayah or dua segment at `ms`. With word timings the cut moves to the start of the first word that is mostly
 * after `ms`, so no word is cut; without, the word range divides by time. Each half keeps at least one word and `minMs`.
 * Translations reset because both ranges changed. Null when the split is not possible.
 */
export function splitSegmentAt(seg: Segment, ms: number, verseWordCount?: number, minMs = MIN_SEGMENT_MS): [Segment, Segment] | null {
  if (seg.kind !== 'ayah' && seg.kind !== 'dua') return null
  const from = seg.wordFrom
  const to = verseWordCount ? Math.min(seg.wordTo, verseWordCount) : seg.wordTo
  if (to <= from) return null
  let k: number
  let at: number
  const timed = [...seg.words].filter((w) => w.idx > from && w.idx <= to).sort((a, b) => a.idx - b.idx)
  const pivot = timed.find((w) => (w.startMs + w.endMs) / 2 >= ms)
  if (seg.words.length > 0 && pivot) {
    k = pivot.idx
    at = pivot.startMs
  } else if (seg.words.length > 0) {
    return null
  } else {
    const frac = (ms - seg.startMs) / Math.max(1, seg.endMs - seg.startMs)
    k = Math.min(to, Math.max(from + 1, from + Math.round(frac * (to - from + 1))))
    at = Math.round(ms)
  }
  if (at - seg.startMs < minMs || seg.endMs - at < minMs) return null
  const head: Segment = {
    ...seg,
    endMs: at,
    wordTo: k - 1,
    words: seg.words.filter((w) => w.idx < k).map((w) => ({ ...w, endMs: Math.min(w.endMs, at) })),
    translations: []
  }
  const tail: Segment = {
    ...seg,
    id: newSegmentId(),
    startMs: at,
    wordFrom: k,
    wordTo: to,
    words: seg.words.filter((w) => w.idx >= k && w.idx <= to).map((w) => ({ ...w, startMs: Math.max(w.startMs, at) })),
    translations: []
  }
  return [head, tail]
}

/** Two halves of one ayah or dua (adjacent or overlapping word ranges), or two of the same special kind. */
export function canMerge(a: Segment, b: Segment): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'dua') {
    const [x, y] = a.startMs <= b.startMs ? [a, b] : [b, a]
    return x.duaId === y.duaId && y.wordFrom <= x.wordTo + 1 && y.wordTo >= x.wordFrom
  }
  if (a.kind !== 'ayah') return true
  const [x, y] = a.startMs <= b.startMs ? [a, b] : [b, a]
  return x.surah === y.surah && x.ayah === y.ayah && y.wordFrom <= x.wordTo + 1 && y.wordTo >= x.wordFrom
}

/** One segment spanning both (keeps the earlier id); null when `canMerge` is false. */
export function mergeSegments(a: Segment, b: Segment): Segment | null {
  if (!canMerge(a, b)) return null
  const [x, y] = a.startMs <= b.startMs ? [a, b] : [b, a]
  const words = [...x.words, ...y.words.filter((w) => !x.words.some((v) => v.idx === w.idx))].sort((p, q) => p.idx - q.idx)
  const conf = [x.confidence, y.confidence].filter((c): c is number => c != null)
  return {
    ...x,
    startMs: Math.min(x.startMs, y.startMs),
    endMs: Math.max(x.endMs, y.endMs),
    wordFrom: Math.min(x.wordFrom, y.wordFrom),
    wordTo: Math.max(x.wordTo, y.wordTo),
    confidence: conf.length ? Math.min(...conf) : null,
    words,
    translations: []
  }
}

/** A hand-made ayah segment; words spread proportionally when the verse is known. */
export function manualSegment(o: {
  surah: number
  ayah: number
  wordFrom: number
  wordTo: number
  startMs: number
  endMs: number
  verse?: Verse | null
}): Segment {
  const seg: Segment = {
    id: newSegmentId(),
    kind: 'ayah',
    surah: o.surah,
    ayah: o.ayah,
    wordFrom: o.wordFrom,
    wordTo: o.wordTo,
    startMs: o.startMs,
    endMs: o.endMs,
    confidence: null,
    source: 'manual',
    words: [],
    translations: []
  }
  return o.verse ? { ...seg, words: proportionalWords(seg, o.verse) } : seg
}

/** Basmalah (pass verse 1:1 for word timings) or isti'adzah. */
export function specialSegment(kind: Exclude<SegmentKind, 'ayah'>, startMs: number, endMs: number, basmalahVerse?: Verse | null): Segment {
  const seg: Segment = {
    id: newSegmentId(),
    kind,
    surah: 0,
    ayah: 0,
    wordFrom: 0,
    wordTo: 0,
    startMs,
    endMs,
    confidence: null,
    source: 'manual',
    words: [],
    translations: []
  }
  return { ...seg, words: proportionalWords(seg, basmalahVerse) }
}

/** Changes kind or ayah/word range in place; word timings are re-spread because the words changed (except dua, which has none). */
export function relabel(seg: Segment, label: Pick<Segment, 'kind' | 'surah' | 'ayah' | 'wordFrom' | 'wordTo'>, verse?: Verse | null): Segment {
  if (seg.kind === 'dua' && label.kind === 'dua') {
    return { ...seg, wordFrom: label.wordFrom, wordTo: label.wordTo, words: [], translations: [] }
  }
  const next: Segment =
    label.kind === 'ayah'
      ? { ...seg, ...label, translations: [] }
      : { ...seg, kind: label.kind, surah: 0, ayah: 0, wordFrom: 0, wordTo: 0, translations: [] }
  return { ...next, words: proportionalWords(next, verse) }
}
