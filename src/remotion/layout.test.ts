import { describe, expect, it } from 'vitest'
import { fitBlocks, type Block } from './layout'

// Every character is half the font size wide, so line counts are easy to predict.
const measure = (text: string, font: string): number => text.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.5

const arabic = (words: number): Block => ({
  runs: Array.from({ length: words }, () => ({ text: 'aaaa', family: 'x' })),
  size: 100,
  lineHeight: 1.5,
  minLineHeight: 1.2,
  pad: 0,
  minScale: 0.5,
  order: 1
})
const translation = (words: number): Block => ({
  runs: Array.from({ length: words }, () => ({ text: 'bbbb', family: 'x' })),
  size: 40,
  lineHeight: 1.4,
  minLineHeight: 1.4,
  pad: 0,
  minScale: 0.7,
  order: 0
})

describe('fitBlocks', () => {
  it('keeps full size when everything fits', () => {
    const fit = fitBlocks([arabic(2), translation(4)], [0, 20], 1000, 600, measure)
    expect(fit.scales).toEqual([1, 1])
    expect(fit.overflow).toBe(false)
  })

  it('shrinks a long translation before the ayah', () => {
    // Arabic: 2 words of 200px on one line (150px tall). Translation at full size needs 3 lines (84px each...).
    const full = fitBlocks([arabic(2), translation(40)], [0, 20], 1000, 10_000, measure)
    const maxH = full.height - 60
    const fit = fitBlocks([arabic(2), translation(40)], [0, 20], 1000, maxH, measure)
    expect(fit.scales[0]).toBe(1)
    expect(fit.scales[1]).toBeLessThan(1)
    expect(fit.height).toBeLessThanOrEqual(maxH)
    expect(fit.overflow).toBe(false)
  })

  it('shrinks the ayah only after the translation reached its floor', () => {
    const fit = fitBlocks([arabic(30), translation(40)], [0, 20], 1000, 520, measure)
    expect(fit.scales[1]).toBe(0.7)
    expect(fit.scales[0]).toBeLessThan(1)
  })

  it('reports overflow instead of shrinking below the floors', () => {
    const fit = fitBlocks([arabic(60), translation(120)], [0, 20], 1000, 200, measure)
    expect(fit.overflow).toBe(true)
    expect(fit.scales[0]).toBe(0.5)
    expect(fit.scales[1]).toBe(0.7)
  })
})
