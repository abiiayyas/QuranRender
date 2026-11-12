import { describe, expect, it } from 'vitest'
import { alignerToCanonical, canonicalCount, toCanonicalSlots } from './verses'

const words = (n: number): string[] => Array.from({ length: n }, (_, i) => `d${i + 1}`)

describe('toCanonicalSlots', () => {
  it('keeps an unmapped ayah 1:1', () => {
    expect(toCanonicalSlots(1, 1, words(4))).toEqual(words(4))
    expect(canonicalCount(1, 1, 4)).toBe(4)
  })

  it('joins 2 dataset words into 1 slot (1:7)', () => {
    const slots = toCanonicalSlots(1, 7, words(10))
    expect(slots).toHaveLength(9)
    expect(slots.slice(0, 5)).toEqual(['d1', 'd2', 'd3', 'd4 d5', 'd6'])
    expect(slots[8]).toBe('d10')
    expect(canonicalCount(1, 7, 10)).toBe(9)
  })

  it('spreads 1 dataset word over 2 slots (2:71)', () => {
    const slots = toCanonicalSlots(2, 71, words(23))
    expect(slots).toHaveLength(24)
    expect(slots.slice(12, 17)).toEqual(['d13', 'd14', '', 'd15', 'd16'])
    expect(slots[23]).toBe('d23')
  })

  it('handles two groups in one ayah (2:260)', () => {
    const slots = toCanonicalSlots(2, 260, words(37))
    expect(slots).toHaveLength(39)
    expect(slots.slice(19, 23)).toEqual(['d20', 'd21', '', 'd22'])
    expect(slots.slice(36)).toEqual(['d36', 'd37', ''])
  })

  it('rejects a word count that does not match the map', () => {
    expect(() => toCanonicalSlots(1, 7, words(9))).toThrow()
  })
})

describe('alignerToCanonical', () => {
  it('is the identity for an unmapped ayah', () => {
    expect(alignerToCanonical(1, 7, 9)).toBe(9)
  })

  it('folds the split "بعد ما" of 2:181 into one canonical word', () => {
    expect([1, 2, 3, 4, 5, 14].map((w) => alignerToCanonical(2, 181, w))).toEqual([1, 2, 3, 3, 4, 13])
  })
})
