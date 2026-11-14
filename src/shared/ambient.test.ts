import { describe, expect, it } from 'vitest'
import { AMBIENT_SOUNDS, ambientFade, ambientGain, isAmbientId } from './ambient'

describe('ambientGain', () => {
  it('puts the sound the asked number of dB under the voice, whatever level the file and the voice have', () => {
    for (const [voice, sound] of [[-12, -30], [-25, -30], [-14, -20]] as const) {
      const g = ambientGain(voice, sound, -24)
      // Resulting level of the sound = its own level + 20 log10(gain) must be voice - 24.
      expect(sound + 20 * Math.log10(g)).toBeCloseTo(voice - 24, 6)
    }
  })

  it('is quieter for a lower level and never above full volume', () => {
    expect(ambientGain(-12, -30, -30)).toBeLessThan(ambientGain(-12, -30, -20))
    expect(ambientGain(-5, -40, -12)).toBe(1)
  })
})

describe('ambientFade', () => {
  it('ramps in, holds, and ramps out', () => {
    expect(ambientFade(0, 60_000, 2000)).toBe(0)
    expect(ambientFade(1000, 60_000, 2000)).toBeCloseTo(0.5, 10)
    expect(ambientFade(30_000, 60_000, 2000)).toBe(1)
    expect(ambientFade(59_000, 60_000, 2000)).toBeCloseTo(0.5, 10)
    expect(ambientFade(60_000, 60_000, 2000)).toBe(0)
  })

  it('has no fade when set to 0, and does not let the two fades cross on a short video', () => {
    expect(ambientFade(0, 60_000, 0)).toBe(1)
    expect(ambientFade(1000, 2000, 5000)).toBeCloseTo(1, 10)
    expect(ambientFade(500, 2000, 5000)).toBeCloseTo(0.5, 10)
  })
})

describe('sounds', () => {
  it('has unique ids and recognizes only them', () => {
    expect(new Set(AMBIENT_SOUNDS.map((s) => s.id)).size).toBe(AMBIENT_SOUNDS.length)
    expect(isAmbientId('rain')).toBe(true)
    expect(isAmbientId('../etc/passwd')).toBe(false)
  })
})
