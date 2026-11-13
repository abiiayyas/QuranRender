/**
 * Where an overlay sits. `x`/`y` are a point on the canvas (fractions); `anchorX`/`anchorY` say which part of the overlay
 * stands on that point: 0 = its left/top edge, 0.5 = its middle (the original behavior, so older overlays are unchanged),
 * 1 = its right/bottom edge. Pinning an edge is what makes a margin possible: a centered element has no edge to keep apart.
 */
export type Edge = 0 | 0.5 | 1

export interface Anchored {
  x: number
  y: number
  anchorX?: Edge
  anchorY?: Edge
}

export interface Safe {
  top: number
  bottom: number
  side: number
}

export interface Size {
  width: number
  height: number
}

export const DEFAULT_MARGIN = 0.03
export const MAX_MARGIN = 0.2

export const anchorOf = (o: Pick<Anchored, 'anchorX' | 'anchorY'>): { x: Edge; y: Edge } => ({ x: o.anchorX ?? 0.5, y: o.anchorY ?? 0.5 })

/**
 * Puts an overlay against the chosen edges of the safe area, `margin` away (a share of the canvas short side, so the gap
 * looks the same on every edge). A middle anchor ignores the margin on that axis.
 */
export function placeAt(anchorX: Edge, anchorY: Edge, margin: number, safe: Safe, size: Size): Required<Anchored> {
  const unit = Math.min(size.width, size.height)
  const mx = (margin * unit) / size.width
  const my = (margin * unit) / size.height
  const x = anchorX === 0 ? safe.side + mx : anchorX === 1 ? 1 - safe.side - mx : 0.5
  const y = anchorY === 0 ? safe.top + my : anchorY === 1 ? 1 - safe.bottom - my : 0.5
  return { x, y, anchorX, anchorY }
}

/** The margin an overlay currently keeps from the safe area, read from the edge it is pinned to (0 when it is centered). */
export function marginOf(o: Anchored, safe: Safe, size: Size): number {
  const { x: ax, y: ay } = anchorOf(o)
  const unit = Math.min(size.width, size.height)
  let px: number | null = null
  if (ax === 0) px = (o.x - safe.side) * size.width
  else if (ax === 1) px = (1 - safe.side - o.x) * size.width
  else if (ay === 0) px = (o.y - safe.top) * size.height
  else if (ay === 1) px = (1 - safe.bottom - o.y) * size.height
  return px === null ? 0 : Math.min(MAX_MARGIN, Math.max(0, px / unit))
}

/** CSS `translate` that puts the anchored point of the element on its `left`/`top`. */
export const anchorTranslate = (o: Pick<Anchored, 'anchorX' | 'anchorY'>): string => {
  const a = anchorOf(o)
  return `${-a.x * 100}%, ${-a.y * 100}%`
}

/** Widest an overlay may grow before it would cross the safe area on the side it is pinned to (`side`: the safe margin, a share of the width). */
export function roomFor(o: Anchored, width: number, side: number): number {
  const { x: ax } = anchorOf(o)
  if (ax === 0) return Math.max(0, (1 - side - o.x) * width)
  if (ax === 1) return Math.max(0, (o.x - side) * width)
  return width * 0.9
}
