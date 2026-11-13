import type { Aspect, Asset } from '../shared/types'

/** Margins kept clear of platform UI (captions, buttons), as fractions of the canvas. The editor draws the same guide. */
export const SAFE_AREA: Record<Aspect, { top: number; bottom: number; side: number }> = {
  '9:16': { top: 0.08, bottom: 0.14, side: 0.1 },
  '16:9': { top: 0.08, bottom: 0.08, side: 0.08 },
  '1:1': { top: 0.06, bottom: 0.06, side: 0.06 }
}

export const AR_LINE = 1.9
export const AR_LINE_MIN = 1.6
export const TR_LINE = 1.4

/** A font-family value for a family name that may contain spaces. */
export const q = (family: string): string => `"${family}"`

export const assetSrc = (base: string, projectId: string, a: Asset): string =>
  `${base}${encodeURIComponent(projectId)}/${a.path.split(/[\\/]/).map(encodeURIComponent).join('/')}`

export const textShadow = (unit: number): string => `0 ${unit * 0.003}px ${unit * 0.012}px rgba(0, 0, 0, 0.55)`

export const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
