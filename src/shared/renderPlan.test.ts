import { describe, expect, it } from 'vitest'
import { AUTO_CHUNK_AFTER_MS, blendSpeed, estimateRenderMs, measuredMsPerMpFrame, MOTION_FACTOR, planChunks, RENDER_OVERHEAD_MS, useChunks } from './renderPlan'

describe('planChunks', () => {
  it('covers every frame exactly once, in order, with no gap at the joins', () => {
    for (const [frames, fps, secs] of [[212_400, 30, 600], [1000, 30, 20], [901, 24, 10], [59, 30, 600], [600, 30, 20]] as const) {
      const chunks = planChunks(frames, fps, secs)
      expect(chunks[0].from).toBe(0)
      expect(chunks[chunks.length - 1].to).toBe(frames - 1)
      chunks.forEach((c, i) => {
        expect(c.index).toBe(i)
        expect(c.to).toBeGreaterThanOrEqual(c.from)
        if (i > 0) expect(c.from).toBe(chunks[i - 1].to + 1)
      })
    }
  })

  it('makes pieces of the asked length and a shorter last one', () => {
    const chunks = planChunks(2100, 30, 20)
    expect(chunks.map((c) => c.to - c.from + 1)).toEqual([600, 600, 600, 300])
  })

  it('starts at the offset for an export of part of the video, still without gaps', () => {
    const chunks = planChunks(2100, 30, 20, 9000)
    expect(chunks[0].from).toBe(9000)
    expect(chunks[chunks.length - 1].to).toBe(9000 + 2100 - 1)
    chunks.forEach((c, i) => i > 0 && expect(c.from).toBe(chunks[i - 1].to + 1))
  })

  it('is one piece for a video shorter than a piece, and never empty', () => {
    expect(planChunks(100, 30)).toEqual([{ index: 0, from: 0, to: 99 }])
    expect(planChunks(0, 30)).toHaveLength(1)
  })
})

describe('useChunks', () => {
  it('follows the mode, and in auto only from the threshold', () => {
    expect(useChunks('direct', 10 * 60 * 60_000)).toBe(false)
    expect(useChunks('chunked', 5_000)).toBe(true)
    expect(useChunks('auto', AUTO_CHUNK_AFTER_MS - 1)).toBe(false)
    expect(useChunks('auto', AUTO_CHUNK_AFTER_MS)).toBe(true)
  })
})

describe('render time estimate', () => {
  const base = { durationMs: 60_000, fps: 30, width: 1080, height: 1920, motion: false, msPerMpFrame: 16 }

  it('scales the drawing work with frames and pixels, on top of a fixed start-up cost, and costs more with a moving background', () => {
    const work = (o: Parameters<typeof estimateRenderMs>[0]): number => estimateRenderMs(o) - RENDER_OVERHEAD_MS
    const w1 = work(base)
    expect(work({ ...base, fps: 15 })).toBeCloseTo(w1 / 2, 5)
    expect(work({ ...base, durationMs: 120_000 })).toBeCloseTo(w1 * 2, 5)
    expect(work({ ...base, width: 720, height: 1280 })).toBeCloseTo((w1 * (720 * 1280)) / (1080 * 1920), 5)
    expect(work({ ...base, motion: true })).toBeCloseTo(w1 * MOTION_FACTOR, 5)
  })

  it('matches what was measured on the first machine: 40 s at 1080x1920, 30 fps takes about 43 s on a still background', () => {
    const est = estimateRenderMs({ durationMs: 40_084, fps: 30, width: 1080, height: 1920, motion: false, msPerMpFrame: null })
    expect(est / 1000).toBeGreaterThan(38)
    expect(est / 1000).toBeLessThan(48)
  })

  it('reproduces itself: an estimate made from a measurement predicts that same render', () => {
    const elapsed = 190_000
    const speed = measuredMsPerMpFrame({ elapsedMs: elapsed, frames: 1800, width: 1080, height: 1920, motion: true })!
    expect(estimateRenderMs({ ...base, motion: true, msPerMpFrame: speed })).toBeCloseTo(elapsed, 3)
  })

  it('does not measure from a handful of frames', () => {
    expect(measuredMsPerMpFrame({ elapsedMs: 9_000, frames: 10, width: 1080, height: 1920, motion: false })).toBeNull()
  })

  it('blends a new measurement into the old one', () => {
    expect(blendSpeed(null, 30)).toBe(30)
    expect(blendSpeed(20, 40)).toBe(30)
  })
})
