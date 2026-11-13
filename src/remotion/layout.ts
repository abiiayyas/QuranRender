/**
 * Text fitting, ported from the old renderer's `fit_text`: lay the words out at the base size, and step the size down
 * until the blocks fit the height. Widths come from canvas measureText, which shapes with the same engine as the DOM,
 * and lines are drawn exactly as broken here so preview and export agree.
 *
 * Blocks shrink in groups: lower `order` first (a long translation gives way before the ayah does), each down to its own
 * `minScale` so nothing becomes unreadable. When even that does not fit, the result says so (`overflow`) and the caller
 * warns instead of letting the text silently cover the surah name or the reciter.
 */

const STEPS = [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.5, 0.43, 0.36, 0.3]

export type Measure = (text: string, font: string) => number

let ctx: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()

/** Advance width of `text` in a CSS font shorthand. Cached: the same words are measured on every frame. */
export function measure(text: string, font: string): number {
  const key = `${font}\n${text}`
  let w = widths.get(key)
  if (w === undefined) {
    ctx ??= document.createElement('canvas').getContext('2d')
    if (!ctx) return 0
    ctx.font = font
    w = ctx.measureText(text).width
    widths.set(key, w)
  }
  return w
}

/** Forget measurements taken before fonts finished loading. */
export const resetMeasurements = (): void => widths.clear()

export interface Run {
  text: string
  /** CSS font-family value, quoted. */
  family: string
  weight?: number
}

/** Greedy line breaking of runs (each run is unbreakable), `pad` added on both sides of every run. */
function breakLines(runWidths: number[], pad: number, maxW: number): { lines: number[][]; widest: number } {
  const lines: number[][] = []
  let cur: number[] = []
  let curW = 0
  let widest = 0
  runWidths.forEach((w, i) => {
    const ww = w + pad * 2
    if (cur.length > 0 && curW + ww > maxW) {
      lines.push(cur)
      widest = Math.max(widest, curW)
      cur = []
      curW = 0
    }
    cur.push(i)
    curW += ww
  })
  if (cur.length > 0) {
    lines.push(cur)
    widest = Math.max(widest, curW)
  }
  return { lines, widest }
}

export interface Block {
  runs: Run[]
  /** Base font size, px. */
  size: number
  lineHeight: number
  /** Line height used on the last, tightest fit step. */
  minLineHeight: number
  /** Padding either side of each run, as a fraction of the font size. */
  pad: number
  /** Smallest share of `size` this block may shrink to; default 0.3. */
  minScale?: number
  /** Blocks shrink in rising `order`; default 0. */
  order?: number
}

export interface BlockLayout {
  size: number
  lineHeight: number
  pad: number
  /** Indices into `runs` per line. */
  lines: number[][]
  height: number
  /** Widest line, px. */
  widest: number
}

/** Splits text into words; a word wider than the line is split into pieces that fit (scripts without spaces). */
export function splitWords(text: string, family: string, weight: number, size: number, maxW: number): string[] {
  const out: string[] = []
  const font = `${weight} ${size}px ${family}`
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (measure(word, font) <= maxW) {
      out.push(word)
      continue
    }
    let piece = ''
    for (const ch of Array.from(word)) {
      if (piece && measure(piece + ch, font) > maxW) {
        out.push(piece)
        piece = ''
      }
      piece += ch
    }
    if (piece) out.push(piece)
  }
  return out
}

function layoutAt(b: Block, scale: number, tight: boolean, maxW: number, measureFn: Measure): BlockLayout {
  const size = b.size * scale
  const lineHeight = tight ? Math.min(b.minLineHeight, b.lineHeight) : b.lineHeight
  const ws = b.runs.map((r) => measureFn(r.text, `${r.weight ?? 400} ${size}px ${r.family}`))
  const pad = b.pad * size
  const { lines, widest } = breakLines(ws, pad, maxW)
  return { size, lineHeight, pad, lines, widest, height: lines.length * size * lineHeight }
}

export interface Fit {
  layouts: BlockLayout[]
  height: number
  /** Scale each block ended at. */
  scales: number[]
  /** True when the blocks still do not fit at their smallest allowed sizes. */
  overflow: boolean
}

/** Fits blocks stacked vertically (with `gaps[i]` px before block i, scaled with block i) into `maxW` x `maxH`. */
export function fitBlocks(blocks: Block[], gaps: number[], maxW: number, maxH: number, measureFn: Measure = measure): Fit {
  const scales = blocks.map(() => 1)
  const tight = blocks.map(() => false)
  const attempt = (): Fit => {
    const layouts = blocks.map((b, i) => layoutAt(b, scales[i], tight[i], maxW, measureFn))
    const height = layouts.reduce((h, l, j) => h + l.height + (l.lines.length > 0 && j > 0 ? gaps[j] * scales[j] : 0), 0)
    return { layouts, height, scales: [...scales], overflow: !(height <= maxH && layouts.every((l) => l.widest <= maxW + 0.5)) }
  }
  let result = attempt()
  if (!result.overflow) return result
  const minOf = (i: number): number => blocks[i].minScale ?? 0.3
  for (const order of [...new Set(blocks.map((b) => b.order ?? 0))].sort((a, b) => a - b)) {
    const group = blocks.map((_, i) => i).filter((i) => (blocks[i].order ?? 0) === order)
    for (const step of STEPS.slice(1)) {
      for (const i of group) {
        scales[i] = Math.max(step, minOf(i))
        tight[i] = scales[i] <= minOf(i)
      }
      result = attempt()
      if (!result.overflow) return result
      if (group.every((i) => scales[i] <= minOf(i))) break
    }
  }
  return result
}
