import { describe, expect, it } from 'vitest'
import { PRESETS, presetById } from './presets'
import { DEFAULT_STYLE } from './style'

const HEX = /^#[0-9A-F]{6}$/i

describe('presets', () => {
  it('has twelve presets with unique ids', () => {
    expect(PRESETS).toHaveLength(12)
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
  })

  it('contains the default preset, and the default style equals it', () => {
    expect(presetById(DEFAULT_STYLE.presetId)?.style).toEqual(DEFAULT_STYLE)
  })

  it('fills every style field with a valid value', () => {
    const keys = Object.keys(DEFAULT_STYLE).sort()
    for (const p of PRESETS) {
      expect(p.name.length, p.id).toBeGreaterThan(0)
      expect(p.description.length, p.id).toBeGreaterThan(0)
      expect(Object.keys(p.style).sort(), p.id).toEqual(keys)
      expect(p.style.presetId).toBe(p.id)
      for (const [k, v] of Object.entries(p.style)) {
        expect(v, `${p.id}.${k}`).not.toBeUndefined()
        if (k.endsWith('Color')) expect(v, `${p.id}.${k}`).toMatch(HEX)
      }
      expect(p.style.arabicSize).toBeGreaterThan(0)
      expect(p.style.maxWidth).toBeGreaterThan(0)
      expect(p.style.maxWidth).toBeLessThanOrEqual(1)
      for (const k of ['inactiveOpacity', 'boxOpacity'] as const) {
        expect(p.style[k]).toBeGreaterThanOrEqual(0)
        expect(p.style[k]).toBeLessThanOrEqual(1)
      }
      expect(p.background.kind).toBe('color')
      expect(p.background.color).toMatch(HEX)
      expect(p.background.assetId).toBeNull()
    }
  })
})
