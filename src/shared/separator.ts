/**
 * The line between the ayah and its translation: a hairline that runs the width of the text, with a small ornament of two
 * pointed leaves and three diamonds in the middle. It is plain geometry, drawn with SVG, so it is sharp at any resolution
 * and has no font or image to ship.
 *
 * The segment layout reserves its height (`separatorMetrics`) between the two blocks, so it cannot overlap either of them.
 */

/** Height of the ornament as a share of the canvas short side. */
export const SEPARATOR_HEIGHT = 0.022
export const SEPARATOR_DEFAULT_WIDTH = 0.6
export const SEPARATOR_MIN_WIDTH = 0.2

/** Clear space kept above and below the ornament, as a share of the translation size. */
const CLEAR = 0.55

/** Vertical room the separator takes between the blocks (at scale 1), and the ornament's own height inside it. */
export function separatorMetrics(unit: number, translationSize: number): { height: number; gap: number } {
  const height = unit * SEPARATOR_HEIGHT
  return { height, gap: height + translationSize * CLEAR * 2 }
}

/** Half the ornament's width in units of its height `s`: the outer tip of a leaf. */
const HALF = 4.4
/** The ornament needs this much more than its own width to look right; narrower lines shrink it. */
const BREATHING = 1.15

export interface OrnamentShapes {
  /** Hairline stretches [x0, x1], on either side of the ornament. */
  lines: [number, number][]
  thickness: number
  /** Vertical middle of the line. */
  y: number
  /** SVG `points` strings. */
  polygons: string[]
}

const pts = (list: [number, number][]): string => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

/** Shapes for a `width` x `height` box. The ornament keeps its proportions and shrinks when the line is too short for it. */
export function ornamentShapes(width: number, height: number): OrnamentShapes {
  const s = Math.min(height, width / (2 * HALF * BREATHING))
  const cx = width / 2
  const cy = height / 2
  const polygons: string[] = []
  for (const side of [-1, 1]) {
    // A long leaf: a point on the line, widening toward the diamonds.
    polygons.push(
      pts([
        [cx + side * HALF * s, cy],
        [cx + side * 1.7 * s, cy - 0.5 * s],
        [cx + side * 1.35 * s, cy],
        [cx + side * 1.7 * s, cy + 0.5 * s]
      ])
    )
  }
  for (const k of [-1, 0, 1]) {
    const d = cx + k * 0.78 * s
    polygons.push(
      pts([
        [d - 0.3 * s, cy],
        [d, cy - 0.3 * s],
        [d + 0.3 * s, cy],
        [d, cy + 0.3 * s]
      ])
    )
  }
  return {
    lines: [
      [0, cx - HALF * s],
      [cx + HALF * s, width]
    ],
    thickness: Math.max(2, s * 0.1),
    y: cy,
    polygons
  }
}
