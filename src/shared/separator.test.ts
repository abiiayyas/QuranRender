import { describe, expect, it } from 'vitest'
import { ornamentShapes, separatorMetrics } from './separator'

const xs = (poly: string): number[] => poly.split(' ').map((p) => Number(p.split(',')[0]))
const ys = (poly: string): number[] => poly.split(' ').map((p) => Number(p.split(',')[1]))

describe('ornamentShapes', () => {
  it('stays inside its box at any width, including narrower than the ornament', () => {
    for (const width of [900, 300, 120, 40]) {
      const { polygons, lines, thickness, y } = ornamentShapes(width, 24)
      for (const poly of polygons) {
        expect(Math.min(...xs(poly))).toBeGreaterThanOrEqual(-1e-6)
        expect(Math.max(...xs(poly))).toBeLessThanOrEqual(width + 1e-6)
        expect(Math.min(...ys(poly))).toBeGreaterThanOrEqual(-1e-6)
        expect(Math.max(...ys(poly))).toBeLessThanOrEqual(24 + 1e-6)
      }
      for (const [a, b] of lines) {
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThanOrEqual(width)
      }
      expect(y - thickness / 2).toBeGreaterThanOrEqual(0)
      expect(y + thickness / 2).toBeLessThanOrEqual(24)
    }
  })

  it('keeps the leaves and the diamonds apart, so no shape sits on another', () => {
    const [leftLeaf, rightLeaf, d1, d2, d3] = ornamentShapes(900, 24).polygons
    const right = (p: string): number => Math.max(...xs(p))
    const left = (p: string): number => Math.min(...xs(p))
    expect(right(leftLeaf)).toBeLessThan(left(d1))
    expect(right(d1)).toBeLessThan(left(d2))
    expect(right(d2)).toBeLessThan(left(d3))
    expect(right(d3)).toBeLessThan(left(rightLeaf))
  })

  it('lets the hairline meet the tip of each leaf and run to the edges', () => {
    const { lines, polygons } = ornamentShapes(900, 24)
    expect(lines[0][0]).toBe(0)
    expect(lines[1][1]).toBe(900)
    expect(lines[0][1]).toBeCloseTo(Math.min(...xs(polygons[0])), 5)
    expect(lines[1][0]).toBeCloseTo(Math.max(...xs(polygons[1])), 5)
  })

  it('shrinks the ornament rather than overflow when the line is short', () => {
    const wide = ornamentShapes(900, 24).polygons.flatMap(xs)
    const narrow = ornamentShapes(120, 24).polygons.flatMap(xs)
    expect(Math.max(...narrow) - Math.min(...narrow)).toBeLessThan(Math.max(...wide) - Math.min(...wide))
  })
})

describe('separatorMetrics', () => {
  it('reserves the ornament plus clear space above and below it', () => {
    const { height, gap } = separatorMetrics(1080, 41)
    expect(gap).toBeGreaterThan(height + 2 * 20)
  })
})
