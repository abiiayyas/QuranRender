import { describe, expect, it } from 'vitest'
import { promptPhase } from './subscribe'

describe('promptPhase', () => {
  it('shows from the overlay start, hides after showMs, and returns every everyMs', () => {
    const at = (t: number): boolean => promptPhase(t, 10_000, 60_000, 6000) !== null
    expect(at(9_999)).toBe(false)
    expect(at(10_000)).toBe(true)
    expect(at(15_999)).toBe(true)
    expect(at(16_000)).toBe(false)
    expect(at(69_999)).toBe(false)
    expect(at(70_000)).toBe(true)
    expect(at(130_000)).toBe(true)
  })

  it('enters, is tapped, then leaves, in that order within one appearance', () => {
    const p = (ms: number) => promptPhase(5000 + ms, 5000, 60_000, 6000)!
    expect(p(0).enter).toBe(0)
    expect(p(500).enter).toBe(1)
    expect(p(500).tap).toBe(0)
    expect(p(2400 + 400).tap).toBe(1)
    expect(p(2000).exit).toBe(0)
    expect(p(5999).exit).toBeGreaterThan(0.99)
  })

  it('stays on when it is asked to show longer than the gap between appearances', () => {
    for (const t of [0, 3000, 9_999, 25_000]) expect(promptPhase(t, 0, 5000, 20_000)).not.toBeNull()
  })

  it('still leaves enough time to be read when asked for a very short appearance', () => {
    expect(promptPhase(2400, 0, 60_000, 500)).not.toBeNull()
  })
})
