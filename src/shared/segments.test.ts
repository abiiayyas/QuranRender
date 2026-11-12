import { describe, expect, it } from 'vitest'
import {
  canMerge,
  mergeSegments,
  needsReview,
  proportionalWords,
  retime,
  segmentAt,
  segmentLabel,
  setEdge,
  setWordStart,
  snapMs,
  sortSegments,
  specialSegment,
  splitSegmentAt
} from './segments'
import type { Segment, Verse } from './types'

const seg = (o: Partial<Segment> = {}): Segment => ({
  id: 'a',
  kind: 'ayah',
  surah: 67,
  ayah: 1,
  wordFrom: 1,
  wordTo: 4,
  startMs: 1000,
  endMs: 5000,
  confidence: 0.95,
  source: 'aligner',
  words: [
    { idx: 1, startMs: 1000, endMs: 2000 },
    { idx: 2, startMs: 2000, endMs: 3000 },
    { idx: 3, startMs: 3000, endMs: 4000 },
    { idx: 4, startMs: 4000, endMs: 5000 }
  ],
  translations: [{ edition: 'id.kemenag', text: 'x', status: 'full' }],
  ...o
})

const verse: Verse = { surah: 67, ayah: 1, words: ['تَبَارَكَ', 'الَّذِي', 'بِيَدِهِ', 'الْمُلْكُ'] }

describe('lookup', () => {
  it('sorts and finds by time', () => {
    const b = seg({ id: 'b', startMs: 0, endMs: 1000 })
    const list = sortSegments([seg(), b])
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
    expect(segmentAt(list, 999)?.id).toBe('b')
    expect(segmentAt(list, 1000)?.id).toBe('a')
    expect(segmentAt(list, 5000)).toBeNull()
  })

  it('labels partial ayahs and specials', () => {
    expect(segmentLabel(seg(), 4)).toBe('67:1')
    expect(segmentLabel(seg({ wordFrom: 2 }), 4)).toBe('67:1 (2–4)')
    expect(segmentLabel(seg({ wordTo: 3 }), 4)).toBe('67:1 (1–3)')
    expect(segmentLabel(seg({ kind: 'basmalah' }))).toBe('Basmalah')
  })

  it('flags low confidence and missing word timings', () => {
    expect(needsReview(seg())).toBe(false)
    expect(needsReview(seg({ confidence: 0.5 }))).toBe(true)
    expect(needsReview(seg({ words: [] }))).toBe(true)
    expect(needsReview(seg({ confidence: null }))).toBe(false)
  })
})

describe('splitSegmentAt', () => {
  it('cuts at the start of the first word past the point', () => {
    const r = splitSegmentAt(seg(), 2600)
    expect(r).not.toBeNull()
    const [head, tail] = r!
    expect(head).toMatchObject({ id: 'a', startMs: 1000, endMs: 3000, wordFrom: 1, wordTo: 2, translations: [] })
    expect(tail).toMatchObject({ startMs: 3000, endMs: 5000, wordFrom: 3, wordTo: 4, translations: [] })
    expect(tail.id).not.toBe('a')
    expect(head.words.map((w) => w.idx)).toEqual([1, 2])
    expect(tail.words.map((w) => w.idx)).toEqual([3, 4])
  })

  it('divides the word range by time when there are no timings', () => {
    const [head, tail] = splitSegmentAt(seg({ words: [] }), 3000)!
    expect([head.wordFrom, head.wordTo, head.endMs]).toEqual([1, 2, 3000])
    expect([tail.wordFrom, tail.wordTo, tail.startMs]).toEqual([3, 4, 3000])
  })

  it('refuses single words, specials and points at the edges', () => {
    expect(splitSegmentAt(seg({ wordFrom: 2, wordTo: 2 }), 3000)).toBeNull()
    expect(splitSegmentAt(seg({ kind: 'basmalah' }), 3000)).toBeNull()
    expect(splitSegmentAt(seg(), 4900)).toBeNull()
    expect(splitSegmentAt(seg({ words: [] }), 1050)).toBeNull()
  })
})

describe('mergeSegments', () => {
  it('joins two halves of one ayah', () => {
    const [head, tail] = splitSegmentAt(seg(), 3000)!
    const m = mergeSegments(tail, head)!
    expect(m).toMatchObject({ id: 'a', startMs: 1000, endMs: 5000, wordFrom: 1, wordTo: 4 })
    expect(m.words.map((w) => w.idx)).toEqual([1, 2, 3, 4])
  })

  it('keeps the lower confidence', () => {
    const m = mergeSegments(seg({ wordTo: 2, endMs: 3000, confidence: 0.9 }), seg({ id: 'b', wordFrom: 3, startMs: 3000, confidence: 0.6 }))
    expect(m?.confidence).toBe(0.6)
  })

  it('refuses different ayahs or a word gap', () => {
    expect(canMerge(seg(), seg({ id: 'b', ayah: 2, startMs: 5000, endMs: 6000 }))).toBe(false)
    expect(mergeSegments(seg({ wordTo: 1 }), seg({ id: 'b', wordFrom: 3, startMs: 5000 }))).toBeNull()
  })
})

describe('setEdge', () => {
  const a = seg({ id: 'a', startMs: 0, endMs: 1000, words: [] })
  const b = seg({ id: 'b', ayah: 2, startMs: 1000, endMs: 2000, words: [{ idx: 1, startMs: 1000, endMs: 2000 }] })
  const c = seg({ id: 'c', ayah: 3, startMs: 2500, endMs: 3000, words: [] })

  it('moves a joined neighbor with the edge', () => {
    const r = setEdge([a, b, c], 'b', 'start', 800, 10_000)!
    expect(r.ms).toBe(800)
    expect(r.segments.find((s) => s.id === 'a')!.endMs).toBe(800)
    const nb = r.segments.find((s) => s.id === 'b')!
    expect(nb.startMs).toBe(800)
    expect(nb.words[0]).toEqual({ idx: 1, startMs: 800, endMs: 2000 })
  })

  it('leaves a gap alone and pushes an overlapped neighbor', () => {
    const r = setEdge([a, b, c], 'b', 'end', 2200, 10_000)!
    expect(r.segments.find((s) => s.id === 'c')!.startMs).toBe(2500)
    const r2 = setEdge([a, b, c], 'b', 'end', 2700, 10_000)!
    expect(r2.segments.find((s) => s.id === 'c')!.startMs).toBe(2700)
  })

  it('clamps to keep the minimum length of both', () => {
    expect(setEdge([a, b, c], 'b', 'start', -500, 10_000)!.ms).toBe(100)
    expect(setEdge([a, b, c], 'b', 'end', 9000, 10_000)!.ms).toBe(2900)
    expect(setEdge([a, b, c], 'c', 'end', 20_000, 10_000)!.ms).toBe(10_000)
    expect(setEdge([a, b, c], 'x', 'end', 1, 10)).toBeNull()
  })

  it('snaps to nearby targets only', () => {
    expect(snapMs(1040, [1000, 2000], 50)).toBe(1000)
    expect(snapMs(1100, [1000, 2000], 50)).toBe(1100)
  })

  it('retime maps word timings linearly', () => {
    const r = retime(seg(), 1000, 9000)
    expect(r.words.map((w) => [w.startMs, w.endMs])).toEqual([
      [1000, 3000],
      [3000, 5000],
      [5000, 7000],
      [7000, 9000]
    ])
  })

  it('moves a word start with the previous word end, clamped', () => {
    const r = setWordStart(seg(), 3, 2500)
    expect(r.words[1]).toEqual({ idx: 2, startMs: 2000, endMs: 2500 })
    expect(r.words[2]).toEqual({ idx: 3, startMs: 2500, endMs: 4000 })
    expect(setWordStart(seg(), 3, 100).words[2].startMs).toBe(2000)
    expect(setWordStart(seg(), 1, 9000).words[0].startMs).toBe(2000)
  })
})

describe('proportionalWords', () => {
  it('spreads the range by letter count and fills the segment', () => {
    const w = proportionalWords(seg({ wordFrom: 2, wordTo: 4, startMs: 0, endMs: 1800, words: [] }), verse)
    expect(w.map((x) => x.idx)).toEqual([2, 3, 4])
    expect(w[0].startMs).toBe(0)
    expect(w[2].endMs).toBe(1800)
    for (let i = 1; i < w.length; i++) expect(w[i].startMs).toBe(w[i - 1].endMs)
    // الذي (5 letters) is shorter than الملك (6 letters) once marks are dropped.
    expect(w[0].endMs - w[0].startMs).toBeLessThan(w[2].endMs - w[2].startMs)
  })

  it('gives joined and unknown words a share', () => {
    const w = proportionalWords(seg({ startMs: 0, endMs: 400, words: [] }), { ...verse, words: ['a', '', 'a', 'a'] })
    expect(w.map((x) => x.endMs - x.startMs)).toEqual([100, 100, 100, 100])
    expect(proportionalWords(seg({ words: [] })).length).toBe(4)
  })

  it('times basmalah over verse 1:1 and isti\'adzah over its own text', () => {
    const one: Verse = { surah: 1, ayah: 1, words: ['بِسْمِ', 'اللَّهِ', 'الرَّحْمَٰنِ', 'الرَّحِيمِ'] }
    expect(specialSegment('basmalah', 0, 1000, one).words.map((w) => w.idx)).toEqual([1, 2, 3, 4])
    expect(specialSegment('istiadzah', 0, 1000).words.length).toBe(5)
  })
})
