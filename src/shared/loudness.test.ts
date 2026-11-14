import { describe, expect, it } from 'vitest'
import { gatedLevelDb, LOUDNESS_RATE } from './loudness'

const tone = (amp: number, seconds: number): Int16Array => Int16Array.from({ length: Math.round(seconds * LOUDNESS_RATE) }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / LOUDNESS_RATE)))
const concat = (...parts: Int16Array[]): Int16Array => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('gatedLevelDb', () => {
  it('reads a steady sine as its RMS level', () => {
    // Amplitude 0.5 of full scale: RMS 0.354 = -9.03 dBFS.
    expect(gatedLevelDb(tone(16384, 4))!).toBeCloseTo(-9.03, 1)
  })

  it('is 6 dB lower for half the amplitude', () => {
    const loud = gatedLevelDb(tone(16384, 4))!
    const soft = gatedLevelDb(tone(8192, 4))!
    expect(loud - soft).toBeCloseTo(6.02, 1)
  })

  it('leaves out silence and the pauses between phrases, so a recitation with gaps reads as its speaking level', () => {
    const speech = tone(16384, 2)
    const gap = new Int16Array(2 * LOUDNESS_RATE)
    const spoken = gatedLevelDb(speech)!
    expect(gatedLevelDb(concat(speech, gap, speech, gap, speech))!).toBeCloseTo(spoken, 1)
  })

  it('leaves out a much quieter tail too (breath, room noise between verses)', () => {
    const speech = tone(16384, 4)
    const hush = tone(300, 2)
    expect(gatedLevelDb(concat(speech, hush))!).toBeCloseTo(gatedLevelDb(speech)!, 1)
  })

  it('is null for silence and for too little audio', () => {
    expect(gatedLevelDb(new Int16Array(4 * LOUDNESS_RATE))).toBeNull()
    expect(gatedLevelDb(new Int16Array(100))).toBeNull()
  })
})
