import { describe, expect, it } from 'vitest'
import { bounceFrame, bounceLeg, fadeFrames, fadeLayers } from './loop'

describe('bounceFrame', () => {
  it('goes forward then backward without repeating the turning frames', () => {
    const seq = Array.from({ length: 13 }, (_, f) => bounceFrame(f, 5))
    expect(seq).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4])
  })
  it('stays on frame 0 for a one-frame clip', () => {
    expect(bounceFrame(7, 1)).toBe(0)
  })
})

describe('bounceLeg', () => {
  it('agrees with bounceFrame on every frame', () => {
    for (const length of [2, 3, 5, 9]) {
      for (let f = 0; f < 6 * length; f++) expect(bounceLeg(f, length).frame).toBe(bounceFrame(f, length))
    }
  })
  it('flags odd legs as reverse', () => {
    expect(bounceLeg(3, 5)).toMatchObject({ leg: 0, reverse: false })
    expect(bounceLeg(4, 5)).toMatchObject({ leg: 1, reverse: true, start: 4, frame: 4 })
  })
})

describe('fadeLayers', () => {
  const length = 10
  const fade = 4
  it('plays the first copy alone, at full opacity', () => {
    expect(fadeLayers(0, length, fade)).toEqual([{ cycle: 0, start: 0, opacity: 1 }])
    expect(fadeLayers(5, length, fade)).toEqual([{ cycle: 0, start: 0, opacity: 1 }])
  })
  it('starts the next copy invisible and ends fully blended over the older one', () => {
    // period = 6: copy 1 starts at frame 6, while copy 0 is on its frames 6..9
    const open = fadeLayers(6, length, fade)
    expect(open).toEqual([
      { cycle: 0, start: 0, opacity: 1 },
      { cycle: 1, start: 6, opacity: 0 }
    ])
    const mid = fadeLayers(8, length, fade)
    expect(mid[1].opacity).toBeCloseTo(0.5)
    expect(fadeLayers(10, length, fade)).toEqual([{ cycle: 1, start: 6, opacity: 1 }])
  })
  it('never needs a third layer and never shows a frame beyond the clip', () => {
    for (let f = 0; f < 200; f++) {
      const layers = fadeLayers(f, length, fade)
      expect(layers.length).toBeLessThanOrEqual(2)
      for (const l of layers) {
        expect(f - l.start).toBeGreaterThanOrEqual(0)
        expect(f - l.start).toBeLessThan(length)
      }
    }
  })
})

describe('fadeFrames', () => {
  it('is 0.8 s for a long clip and a third of a short one', () => {
    expect(fadeFrames(30, 300)).toBe(24)
    expect(fadeFrames(30, 30)).toBe(10)
    expect(fadeFrames(30, 2)).toBe(0)
  })
})
