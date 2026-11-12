/**
 * Text fitting, ported from the old renderer's `fit_text`: lay the words out at the base size, and step the size down
 * until the block fits the height (the last step also tightens the line height). Widths come from canvas measureText,
 * which shapes with the same engine as the DOM, and lines are drawn exactly as broken here so preview and export agree.
 */

const SCALES = [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.5, 0.43, 0.36, 0.3]

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

function layoutAt(b: Block, scale: number, last: boolean, maxW: number): BlockLayout {
  const size = b.size * scale
  const lineHeight = last ? Math.min(b.minLineHeight, b.lineHeight) : b.lineHeight
  const ws = b.runs.map((r) => measure(r.text, `${r.weight ?? 400} ${size}px ${r.family}`))
  const pad = b.pad * size
  const { lines, widest } = breakLines(ws, pad, maxW)
  return { size, lineHeight, pad, lines, widest, height: lines.length * size * lineHeight }
}

/**
 * Fits blocks stacked vertically (with `gaps[i]` px before block i, scaled too) into `maxW` × `maxH`. All blocks
 * shrink together so their proportions stay. Returns the smallest step when nothing fits.
 */
export function fitBlocks(blocks: Block[], gaps: number[], maxW: number, maxH: number): { layouts: BlockLayout[]; height: number; scale: number } {
  let result: { layouts: BlockLayout[]; height: number; scale: number } = { layouts: [], height: 0, scale: 1 }
  for (let i = 0; i < SCALES.length; i++) {
    const s = SCALES[i]
    const last = i === SCALES.length - 1
    const ls = blocks.map((b) => layoutAt(b, s, last, maxW))
    const height = ls.reduce((h, l, j) => h + l.height + (l.lines.length > 0 && j > 0 ? gaps[j] * s : 0), 0)
    result = { layouts: ls, height, scale: s }
    if (height <= maxH && ls.every((l) => l.widest <= maxW + 0.5)) break
  }
  return result
}
