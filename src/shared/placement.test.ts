import { describe, expect, it } from 'vitest'
import { anchorTranslate, marginOf, placeAt, roomFor } from './placement'

const safe = { top: 0.08, bottom: 0.14, side: 0.1 }
const portrait = { width: 1080, height: 1920 }
const wide = { width: 1920, height: 1080 }

describe('placeAt', () => {
  it('pins to the safe-area edge plus the margin, measured in the same pixels on both axes', () => {
    const p = placeAt(0, 0, 0.05, safe, portrait)
    // 5% of the short side (1080) = 54 px on both axes.
    expect(p.x * portrait.width).toBeCloseTo(0.1 * 1080 + 54, 5)
    expect(p.y * portrait.height).toBeCloseTo(0.08 * 1920 + 54, 5)
    const q = placeAt(1, 1, 0.05, safe, wide)
    expect(wide.width - q.x * wide.width).toBeCloseTo(0.1 * 1920 + 54, 5)
    expect(wide.height - q.y * wide.height).toBeCloseTo(0.14 * 1080 + 54, 5)
  })

  it('centers on an axis whose anchor is the middle, whatever the margin', () => {
    expect(placeAt(0.5, 1, 0.1, safe, portrait).x).toBe(0.5)
    expect(placeAt(0, 0.5, 0.1, safe, portrait).y).toBe(0.5)
  })

  it('keeps the whole overlay inside the safe area: left edge at x, right edge at x for a right anchor', () => {
    // With the anchor on its own edge, an element of any width stays on the inner side of the point.
    const left = placeAt(0, 0.5, 0, safe, portrait)
    const right = placeAt(1, 0.5, 0, safe, portrait)
    expect(left.x).toBeCloseTo(0.1, 10)
    expect(right.x).toBeCloseTo(0.9, 10)
  })
})

describe('marginOf', () => {
  it('reads back the margin placeAt wrote, on every edge and aspect', () => {
    for (const size of [portrait, wide]) {
      for (const ax of [0, 1] as const) {
        for (const ay of [0, 1] as const) {
          const p = placeAt(ax, ay, 0.04, safe, size)
          expect(marginOf(p, safe, size)).toBeCloseTo(0.04, 10)
        }
      }
      expect(marginOf(placeAt(0.5, 0, 0.07, safe, size), safe, size)).toBeCloseTo(0.07, 10)
    }
  })

  it('is 0 for a centered overlay and never negative', () => {
    expect(marginOf({ x: 0.5, y: 0.5 }, safe, portrait)).toBe(0)
    expect(marginOf({ x: 0.02, y: 0.5, anchorX: 0 }, safe, portrait)).toBe(0)
  })
})

describe('anchors', () => {
  it('defaults to the middle, so overlays saved before anchors existed do not move', () => {
    expect(anchorTranslate({})).toBe('-50%, -50%')
    expect(anchorTranslate({ anchorX: 0, anchorY: 1 })).toBe('0%, -100%')
  })

  it('limits width to the room left inside the safe area on the pinned side', () => {
    expect(roomFor({ x: 0.2, y: 0.5, anchorX: 0 }, 1000, 0.1)).toBeCloseTo(700, 10)
    expect(roomFor({ x: 0.8, y: 0.5, anchorX: 1 }, 1000, 0.1)).toBeCloseTo(700, 10)
    expect(roomFor({ x: 0.5, y: 0.5 }, 1000, 0.1)).toBe(900)
  })
})
