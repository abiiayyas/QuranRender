import { describe, expect, it } from 'vitest'
import { autoSplit } from './autosplit'
import type { Segment, Verse } from './types'

const seg = (words: number, timed = true, gapAfter?: number): Segment => ({
  id: 's',
  kind: 'ayah',
  surah: 2,
  ayah: 282,
  wordFrom: 1,
  wordTo: words,
  startMs: 0,
  endMs: words * 1000,
  confidence: 1,
  source: 'manual',
  // One second per word; `gapAfter` leaves a pause after that word by pushing the following words later.
  words: timed
    ? Array.from({ length: words }, (_, i) => {
        const shift = gapAfter !== undefined && i + 1 > gapAfter ? 500 : 0
        return { idx: i + 1, startMs: i * 1000 + shift, endMs: i * 1000 + 900 + shift }
      })
    : [],
  translations: []
})
const verse = (n: number, waqfAfter?: number): Verse => ({
  surah: 2,
  ayah: 282,
  words: Array.from({ length: n }, (_, i) => (i + 1 === waqfAfter ? 'كلمةۚ' : 'كلمة'))
})
const size = (s: Segment): number => s.wordTo - s.wordFrom + 1

describe('autoSplit', () => {
  it('leaves a segment that already fits', () => {
    expect(autoSplit(seg(8), verse(8), () => true)).toHaveLength(1)
  })

  it('cuts until every part fits, with contiguous word ranges and times', () => {
    const parts = autoSplit(seg(12), verse(12), (s) => size(s) <= 4)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts.every((p) => size(p) <= 4)).toBe(true)
    expect(parts[0].wordFrom).toBe(1)
    expect(parts.at(-1)!.wordTo).toBe(12)
    parts.slice(1).forEach((p, i) => {
      expect(p.wordFrom).toBe(parts[i].wordTo + 1)
      expect(p.startMs).toBeGreaterThanOrEqual(parts[i].endMs)
    })
  })

  it('prefers the longest pause near the middle', () => {
    const [head] = autoSplit(seg(10, true, 6), verse(10), (s) => size(s) <= 6)
    expect(head.wordTo).toBe(6)
  })

  it('prefers a stop sign over an equal pause', () => {
    const [head] = autoSplit(seg(10), verse(10, 4), (s) => size(s) <= 6)
    expect(head.wordTo).toBe(4)
  })

  it('splits an untimed segment around the middle', () => {
    const parts = autoSplit(seg(10, false), verse(10), (s) => size(s) <= 5)
    expect(parts.map(size)).toEqual([5, 5])
  })

  it('gives up on a single word and ignores other kinds', () => {
    expect(autoSplit(seg(1), verse(1), () => false)).toHaveLength(1)
    const basmalah: Segment = { ...seg(4), kind: 'basmalah' }
    expect(autoSplit(basmalah, null, () => false)).toEqual([basmalah])
  })
})
