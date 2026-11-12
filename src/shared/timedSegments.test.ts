import { describe, expect, it } from 'vitest'
import { buildTimedSegments, parseMp3Quran, parseQdc, shiftSegments } from './timedSegments'

let n = 0
const newId = () => `s${++n}`

// Shapes copied from real responses (QDC reciter 7 chapter 1, MP3Quran read 1 surah 67), trimmed.
const qdcFatihah = [
  { verse_key: '1:1', timestamp_from: 0, timestamp_to: 6090, segments: [[1, 0, 580], [2, 580, 1409], [3, 1409, 2502], [4, 2502, 5840]] },
  { verse_key: '1:2', timestamp_from: 6090, timestamp_to: 11680, segments: [[1, 6025, 7025], [2, 7025, 7885], [3, 7885, 8515], [4, 8515, 11550]] },
  { verse_key: '1:3', timestamp_from: 11680, timestamp_to: 15000, segments: [[1, 11700, 13000], [2, 13000]] }
]

describe('parseQdc', () => {
  it('clamps words into the verse and fills a missing end', () => {
    const t = parseQdc(qdcFatihah)
    expect(t.ayahs[1].words[0]).toEqual({ idx: 1, startMs: 6090, endMs: 7025 })
    expect(t.ayahs[2].words[1]).toEqual({ idx: 2, startMs: 13000, endMs: 15000 })
    expect(t.intro).toBeNull()
  })
})

describe('buildTimedSegments', () => {
  it('maps QDC word positions to canonical word timings for a whole surah', () => {
    const cut = buildTimedSegments(parseQdc(qdcFatihah), { surah: 1, from: 1, to: 3, source: 'qdc', wordCount: () => 4, newId })
    expect(cut.startMs).toBe(0)
    expect(cut.endMs).toBeNull()
    expect(cut.segments.map((s) => [s.ayah, s.wordFrom, s.wordTo, s.startMs, s.endMs])).toEqual([
      [1, 1, 4, 0, 6090],
      [2, 1, 4, 6090, 11680],
      [3, 1, 4, 11680, 15000]
    ])
    expect(cut.segments[0].words.map((w) => w.idx)).toEqual([1, 2, 3, 4])
    expect(cut.segments.every((s) => s.kind === 'ayah' && s.source === 'qdc' && s.confidence === 1)).toBe(true)
  })

  it('shifts a partial range to the cut start', () => {
    const cut = buildTimedSegments(parseQdc(qdcFatihah), { surah: 1, from: 2, to: 2, source: 'qdc', wordCount: () => 4, newId })
    expect(cut.startMs).toBe(6090)
    expect(cut.endMs).toBe(11680)
    expect(cut.segments).toHaveLength(1)
    expect(cut.segments[0]).toMatchObject({ startMs: 0, endMs: 5590 })
    expect(cut.segments[0].words[0]).toEqual({ idx: 1, startMs: 0, endMs: 935 })
  })

  it('splits a repeated stretch into runs', () => {
    const t = parseQdc([{ verse_key: '2:22', timestamp_from: 0, timestamp_to: 1000, segments: [[1, 0, 100], [2, 100, 200], [3, 200, 300], [2, 300, 400], [3, 400, 500], [4, 500, 1000]] }])
    const cut = buildTimedSegments(t, { surah: 2, from: 22, to: 22, source: 'qdc', wordCount: () => 4, newId })
    expect(cut.segments.map((s) => [s.wordFrom, s.wordTo, s.startMs, s.endMs])).toEqual([
      [1, 3, 0, 300],
      [2, 4, 300, 1000]
    ])
  })

  it('adds a basmalah segment for a QDC lead-in before ayah 1', () => {
    const t = parseQdc([
      { verse_key: '67:1', timestamp_from: 7390, timestamp_to: 9000, segments: [[1, 7390, 9000]] },
      { verse_key: '67:2', timestamp_from: 9000, timestamp_to: 10000, segments: [] }
    ])
    const cut = buildTimedSegments(t, { surah: 67, from: 1, to: 1, source: 'qdc', wordCount: () => 1, newId })
    expect(cut.segments.map((s) => [s.kind, s.startMs, s.endMs])).toEqual([
      ['basmalah', 0, 7390],
      ['ayah', 7390, 9000]
    ])
    expect(cut.endMs).toBe(9000)
  })

  it('uses MP3Quran ayah 0 as basmalah and whole-ayah word ranges', () => {
    const t = parseMp3Quran([
      { ayah: 0, start_time: 0, end_time: 5957 },
      { ayah: 1, start_time: 5957, end_time: 14616 },
      { ayah: 2, start_time: 14616, end_time: 26427 }
    ])
    const cut = buildTimedSegments(t, { surah: 67, from: 1, to: 2, source: 'mp3quran', wordCount: (a) => (a === 1 ? 10 : 15), newId })
    expect(cut.segments.map((s) => [s.kind, s.ayah, s.wordFrom, s.wordTo, s.startMs, s.endMs, s.words.length])).toEqual([
      ['basmalah', 0, 0, 0, 0, 5957, 0],
      ['ayah', 1, 1, 10, 5957, 14616, 0],
      ['ayah', 2, 1, 15, 14616, 26427, 0]
    ])
  })

  it('refuses a range the provider did not time', () => {
    expect(() => buildTimedSegments(parseQdc(qdcFatihah), { surah: 1, from: 2, to: 7, source: 'qdc', wordCount: () => 4, newId })).toThrow()
  })
})

describe('shiftSegments', () => {
  it('drops, clamps and shifts', () => {
    const cut = buildTimedSegments(parseQdc(qdcFatihah), { surah: 1, from: 1, to: 3, source: 'qdc', wordCount: () => 4, newId })
    const out = shiftSegments(cut.segments, 7000, 12000)
    expect(out.map((s) => [s.ayah, s.startMs, s.endMs])).toEqual([
      [2, 0, 4680],
      [3, 4680, 5000]
    ])
    expect(out[0].words[0]).toEqual({ idx: 1, startMs: 0, endMs: 25 })
    expect(out[1].words).toEqual([{ idx: 1, startMs: 4700, endMs: 5000 }])
  })
})
