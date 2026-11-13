import { random } from 'remotion'

/** What every motion type draws from. `t` is seconds already scaled by the spec's speed. */
export interface MotionProps {
  a: string
  b: string
  width: number
  height: number
  t: number
}

const channels = (hex: string): [number, number, number] => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x101114
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbaOf = (hex: string, alpha: number): string => {
  const [r, g, b] = channels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Linear mix of two hex colours; k = 0 gives `x`, 1 gives `y`. */
export function mix(x: string, y: string, k: number): string {
  const [r1, g1, b1] = channels(x)
  const [r2, g2, b2] = channels(y)
  const c = (p: number, q: number): string => Math.round(p + (q - p) * k).toString(16).padStart(2, '0')
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`
}

/** Seeded 0..1 values, stable per (name, index): the same frame always draws the same picture. */
export const rnd = (name: string, i: number, salt = ''): number => random(`${name}-${i}-${salt}`)

export const mod = (v: number, m: number): number => ((v % m) + m) % m

export const fixed = (v: number): string => v.toFixed(1)
