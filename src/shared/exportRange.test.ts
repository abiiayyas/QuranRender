import { describe, expect, it } from 'vitest'
import { clampRange, formatTime, overlaysOutside, overlayWindow, parseTime, rangeContents, rangeFrames, rangeLengthMs, rangeProblem, resolveRangeInput, snapToSegments } from './exportRange'
import type { Segment } from './types'

const seg = (startMs: number, endMs: number, ayah = 1): Segment => ({ id: `s${startMs}`, kind: 'ayah', surah: 2, ayah, wordFrom: 1, wordTo: 3, startMs, endMs, words: [], translations: [], source: 'manual', confidence: null }) as unknown as Segment

describe('parseTime and formatTime', () => {
  it('reads seconds, m:ss and h:mm:ss, with a comma or a dot', () => {
    expect(parseTime('83')).toBe(83_000)
    expect(parseTime('83,5')).toBe(83_500)
    expect(parseTime('1:23')).toBe(83_000)
    expect(parseTime('1:23.5')).toBe(83_500)
    expect(parseTime('1:02:03')).toBe(3_723_000)
    expect(parseTime(' 10:00 ')).toBe(600_000)
  })

  it('rejects what is not a time, and minutes or seconds of 60 after a colon', () => {
    for (const bad of ['', 'abc', '1:60', '1:2:3:4', '-5', '1::2', '1:75:00']) expect(parseTime(bad), bad).toBeNull()
  })

  it('keeps the milliseconds when asked, so a snapped time lands exactly on the segment edge', () => {
    for (const ms of [971_840, 883_270, 600_005, 83_500, 83_000]) expect(parseTime(formatTime(ms, true))).toBe(ms)
    expect(formatTime(971_840, true)).toBe('16:11.84')
    expect(formatTime(971_840)).toBe('16:11.8')
  })

  it('formats back to what it parses', () => {
    for (const ms of [0, 83_000, 83_500, 600_000, 3_723_000, 7_079_000]) expect(parseTime(formatTime(ms))).toBe(ms)
    expect(formatTime(59_000)).toBe('0:59')
    expect(formatTime(3_600_000)).toBe('1:00:00')
  })
})

describe('rangeProblem', () => {
  it('accepts a range inside the recording and one that runs past its end (clamped)', () => {
    expect(rangeProblem({ fromMs: 60_000, toMs: 120_000 }, 7_000_000)).toBeNull()
    expect(rangeProblem({ fromMs: 6_990_000, toMs: 9_000_000 }, 7_000_000)).toBeNull()
    expect(clampRange({ fromMs: 6_990_000, toMs: 9_000_000 }, 7_000_000)).toEqual({ fromMs: 6_990_000, toMs: 7_000_000 })
  })

  it('names what is wrong', () => {
    expect(rangeProblem({ fromMs: 120_000, toMs: 60_000 }, 7_000_000)).toBe('order')
    expect(rangeProblem({ fromMs: 7_000_000, toMs: 7_100_000 }, 7_000_000)).toBe('beyond')
    expect(rangeProblem({ fromMs: -1, toMs: 5000 }, 7_000_000)).toBe('beyond')
    expect(rangeProblem({ fromMs: 1000, toMs: 1500 }, 7_000_000)).toBe('short')
    expect(rangeProblem({ fromMs: 6_999_500, toMs: 9_000_000 }, 7_000_000)).toBe('short')
  })
})

describe('rangeFrames', () => {
  it('is the whole video without a range', () => {
    expect(rangeFrames(null, 10_000, 30)).toEqual({ from: 0, to: 299, count: 300 })
  })

  it('counts the frames of the range, inclusive of the last, and stays inside the video', () => {
    expect(rangeFrames({ fromMs: 2000, toMs: 4000 }, 10_000, 30)).toEqual({ from: 60, to: 119, count: 60 })
    expect(rangeFrames({ fromMs: 9000, toMs: 99_000 }, 10_000, 30)).toEqual({ from: 270, to: 299, count: 30 })
    expect(rangeFrames({ fromMs: 5000, toMs: 5001 }, 10_000, 30).count).toBe(1)
  })

  it('has the length of the range in ms, to a frame', () => {
    expect(rangeLengthMs({ fromMs: 60_000, toMs: 120_000 }, 7_000_000, 24)).toBe(60_000)
    expect(rangeLengthMs(null, 10_000, 30)).toBe(10_000)
  })
})

describe('rangeContents and snapToSegments', () => {
  const segments = [seg(0, 10_000, 1), seg(10_000, 25_000, 2), seg(25_000, 40_000, 3), seg(60_000, 70_000, 4)]

  it('lists the segments the range touches and the ones it cuts through', () => {
    const c = rangeContents(segments, { fromMs: 12_000, toMs: 30_000 })
    expect(c.segments.map((s) => s.ayah)).toEqual([2, 3])
    expect(c.cutStart?.ayah).toBe(2)
    expect(c.cutEnd?.ayah).toBe(3)
  })

  it('has no cut where the range sits on segment edges or in a gap', () => {
    const c = rangeContents(segments, { fromMs: 10_000, toMs: 40_000 })
    expect(c.segments.map((s) => s.ayah)).toEqual([2, 3])
    expect(c.cutStart).toBeNull()
    expect(c.cutEnd).toBeNull()
    expect(rangeContents(segments, { fromMs: 45_000, toMs: 55_000 }).segments).toEqual([])
  })

  it('snaps both ends outward to whole segments and leaves the others alone', () => {
    expect(snapToSegments(segments, { fromMs: 12_000, toMs: 30_000 })).toEqual({ fromMs: 10_000, toMs: 40_000 })
    expect(snapToSegments(segments, { fromMs: 10_000, toMs: 40_000 })).toEqual({ fromMs: 10_000, toMs: 40_000 })
    expect(snapToSegments(segments, { fromMs: 45_000, toMs: 55_000 })).toEqual({ fromMs: 45_000, toMs: 55_000 })
  })
})

describe('overlayWindow', () => {
  const range = { fromMs: 600_000, toMs: 660_000 }

  it('covers the whole short for an overlay that runs until the end of the video', () => {
    expect(overlayWindow({ startMs: 0, endMs: null }, 7_000_000, range)).toEqual({ startMs: 600_000, endMs: 660_000 })
  })

  it('keeps an overlay that starts inside the range as it is, cut at the range end', () => {
    expect(overlayWindow({ startMs: 610_000, endMs: 616_000 }, 7_000_000, range)).toEqual({ startMs: 610_000, endMs: 616_000 })
    expect(overlayWindow({ startMs: 650_000, endMs: 700_000 }, 7_000_000, range)).toEqual({ startMs: 650_000, endMs: 660_000 })
  })

  it('is null for an overlay that never reaches the range, and the plain window without a range', () => {
    expect(overlayWindow({ startMs: 500, endMs: 6500 }, 7_000_000, range)).toBeNull()
    expect(overlayWindow({ startMs: 500, endMs: 6500 }, 7_000_000, null)).toEqual({ startMs: 500, endMs: 6500 })
  })

  it('reports the overlays that fall outside', () => {
    const list = [{ startMs: 500, endMs: 6500 }, { startMs: 0, endMs: null }]
    expect(overlaysOutside(list, 7_000_000, range)).toEqual([list[0]])
  })
})

describe('resolveRangeInput', () => {
  it('turns two typed times into a clamped range', () => {
    expect(resolveRangeInput('10:00', '11:00', 7_079_000)).toEqual({ range: { fromMs: 600_000, toMs: 660_000 }, problem: null })
    expect(resolveRangeInput('1:57:00', '2:30:00', 7_079_000).range).toEqual({ fromMs: 7_020_000, toMs: 7_079_000 })
  })

  it('names the problem and gives no range', () => {
    expect(resolveRangeInput('abc', '11:00', 7_079_000)).toEqual({ range: null, problem: 'format' })
    expect(resolveRangeInput('11:00', '10:00', 7_079_000)).toEqual({ range: null, problem: 'order' })
    expect(resolveRangeInput('3:00:00', '3:01:00', 7_079_000)).toEqual({ range: null, problem: 'beyond' })
  })
})
