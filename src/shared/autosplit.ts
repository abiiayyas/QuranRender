import { splitSegmentAt } from './segments'
import type { Segment, Verse } from './types'

/** Largest number of screens one ayah is cut into; past that the text is still too long and the user is told. */
const MAX_PARTS = 12
/** Pause strength that makes a cut feel natural, in ms, and the bonus for a stop sign (waqf) at the end of a word. */
const WAQF_BONUS_MS = 400
const BALANCE_MS = 300
const WAQF = /[\u06D6-\u06DC]/

const endsWithWaqf = (text: string | undefined): boolean => !!text && [...text].slice(-2).some((c) => WAQF.test(c))

/** Best place to cut a segment in two: a pause between words, preferably after a waqf sign, near the middle. */
function candidates(seg: Segment, verse: Verse | null): { ms: number; score: number }[] {
  const from = seg.wordFrom
  const to = verse ? Math.min(seg.wordTo, verse.words.length) : seg.wordTo
  const n = to - from + 1
  if (n < 2) return []
  const timing = new Map(seg.words.map((w) => [w.idx, w]))
  const out: { ms: number; score: number }[] = []
  const lo = Math.max(1, Math.ceil(n * 0.3))
  const hi = Math.min(n - 1, Math.floor(n * 0.7))
  for (let head = lo; head <= hi; head++) {
    const k = from + head
    const a = timing.get(k - 1)
    const b = timing.get(k)
    const timed = !!a && !!b
    const ms = timed ? (a.endMs + b.startMs) / 2 : seg.startMs + ((seg.endMs - seg.startMs) * head) / n
    const gap = timed ? Math.max(0, b.startMs - a.endMs) : 0
    const bonus = endsWithWaqf(verse?.words[k - 2]) ? WAQF_BONUS_MS : 0
    out.push({ ms, score: gap + bonus - (Math.abs(head - n / 2) / n) * BALANCE_MS })
  }
  return out.sort((x, y) => y.score - x.score)
}

/**
 * Cuts an ayah segment into parts that each satisfy `fits`, at natural pauses. `fits` is given a candidate part (its own
 * words and times) and decides, so the caller can measure with real fonts and the part's own share of the translation.
 * Returns the segment itself when it already fits, is not an ayah, or cannot be cut any further.
 */
export function autoSplit(seg: Segment, verse: Verse | null, fits: (part: Segment) => boolean): Segment[] {
  const out: Segment[] = []
  const visit = (s: Segment): void => {
    if ((s.kind !== 'ayah' && s.kind !== 'dua') || fits(s) || out.length >= MAX_PARTS) {
      out.push(s)
      return
    }
    for (const c of candidates(s, verse)) {
      const halves = splitSegmentAt(s, c.ms, verse?.words.length)
      if (halves) {
        visit(halves[0])
        visit(halves[1])
        return
      }
    }
    out.push(s)
  }
  visit(seg)
  return out
}
