import { describe, expect, it } from 'vitest'
import { bandBins, bandsAt, computeSpectrum, SPECTRUM_BANDS, SPECTRUM_FPS, SPECTRUM_RATE } from './spectrum'

/** A tone that is on for 0.4 s and off for 0.4 s, like speech: a band needs level changes to be scaled to. */
const tone = (hz: number, seconds: number, amp = 8000): Int16Array =>
  Int16Array.from({ length: Math.round(seconds * SPECTRUM_RATE) }, (_, i) => {
    const on = Math.floor(i / (0.4 * SPECTRUM_RATE)) % 2 === 0
    return on ? Math.round(amp * Math.sin((2 * Math.PI * hz * i) / SPECTRUM_RATE)) : 0
  })

const bandOf = (hz: number): number => {
  const bin = (hz * 1024) / SPECTRUM_RATE
  return bandBins().findIndex(([from, to]) => bin >= from && bin < to)
}

const loudest = (frame: Uint8Array): number => frame.indexOf(Math.max(...frame))

describe('computeSpectrum', () => {
  it('gives one row of bands per 1/30 s', () => {
    const t = computeSpectrum(tone(500, 2))
    expect(t.length).toBe(2 * SPECTRUM_FPS * SPECTRUM_BANDS)
  })

  it('puts a tone in the band that holds its frequency', () => {
    const t = computeSpectrum(tone(1000, 1.6))
    const mid = bandsAt(t, 200)!
    expect(loudest(mid)).toBe(bandOf(1000))
    expect(mid[bandOf(1000)]).toBeGreaterThan(200)
  })

  it('tells low from high tones', () => {
    const low = bandsAt(computeSpectrum(tone(200, 1.6)), 200)!
    const high = bandsAt(computeSpectrum(tone(3000, 1.6)), 200)!
    expect(loudest(low)).toBeLessThan(loudest(high))
  })

  it('stays at rest for silence and for a steady hum, where there is nothing to scale to', () => {
    expect(Math.max(...computeSpectrum(new Int16Array(SPECTRUM_RATE)))).toBe(0)
    // 20 s with smooth 0.3 s fades at both ends: no clicks (an abrupt start or stop moves every band), and edge frames
    // well under the 5% the scaling ignores.
    const fade = 0.3 * SPECTRUM_RATE
    const n = SPECTRUM_RATE * 20
    const hum = Int16Array.from({ length: n }, (_, i) => {
      const d = Math.min(i, n - 1 - i)
      const g = d < fade ? 0.5 - 0.5 * Math.cos((Math.PI * d) / fade) : 1
      return Math.round(g * 8000 * Math.sin((2 * Math.PI * 500 * i) / SPECTRUM_RATE))
    })
    const t = computeSpectrum(hum)
    // The fades may move bars; the steady middle stays near rest (quantization noise wobbles it a few percent).
    const middle = t.subarray(2 * SPECTRUM_FPS * SPECTRUM_BANDS, 18 * SPECTRUM_FPS * SPECTRUM_BANDS)
    expect(Math.max(...middle)).toBeLessThan(40)
  })

  it('moves bands up the spectrum too, not just the loud low ones', () => {
    const lo = tone(300, 2, 20000)
    const hi = tone(3000, 2, 400)
    const mix = Int16Array.from(lo, (v, i) => v + hi[i])
    const t = computeSpectrum(mix)
    // The weak 3 kHz tone is 34 dB under the 300 Hz one but its own band still reaches the top of its range.
    expect(bandsAt(t, 200)![bandOf(3000)]).toBeGreaterThan(150)
  })

  it('falls back to rest after a loud part, more slowly than it rose', () => {
    const loud = tone(800, 0.5)
    const samples = new Int16Array(SPECTRUM_RATE * 1.5)
    samples.set(loud)
    const t = computeSpectrum(samples)
    const band = bandOf(800)
    const at = (ms: number): number => bandsAt(t, ms)![band]
    expect(at(250)).toBeGreaterThan(200)
    expect(at(1400)).toBeLessThan(20)
    // One frame after the tone stops the bar is still partly up (release), not cut to zero.
    const stop = Math.round(0.5 * SPECTRUM_FPS)
    expect(t[(stop + 1) * SPECTRUM_BANDS + band]).toBeGreaterThan(0)
  })
})

describe('bandsAt', () => {
  it('is null outside the table', () => {
    const t = computeSpectrum(tone(500, 1))
    expect(bandsAt(t, -1)).toBeNull()
    expect(bandsAt(t, 5000)).toBeNull()
  })
})
