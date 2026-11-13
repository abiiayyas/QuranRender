import { useId, useMemo } from 'react'
import { mix, rgbaOf, rnd, type MotionProps } from './util'

const BLOBS = 5

/** Soft colour pools drifting on slow orbits. Radial gradients only: no blur filter, so frames stay cheap. */
export function Aurora({ a, b, width, height, t }: MotionProps) {
  const uid = useId().replace(/:/g, '')
  const seeds = useMemo(
    () =>
      Array.from({ length: BLOBS }, (_, i) => ({
        x: 0.15 + 0.7 * rnd('au', i, 'x'),
        y: 0.1 + 0.8 * rnd('au', i, 'y'),
        ax: 0.12 + 0.14 * rnd('au', i, 'ax'),
        ay: 0.08 + 0.1 * rnd('au', i, 'ay'),
        fx: 0.22 + 0.3 * rnd('au', i, 'fx'),
        fy: 0.18 + 0.3 * rnd('au', i, 'fy'),
        px: rnd('au', i, 'px') * Math.PI * 2,
        py: rnd('au', i, 'py') * Math.PI * 2,
        size: 0.5 + 0.25 * rnd('au', i, 'size')
      })),
    []
  )
  const reach = Math.max(width, height)
  const tints = [b, mix(a, '#FFFFFF', 0.3), mix(a, b, 0.5), mix(a, '#FFFFFF', 0.2), b]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(a, '#000000', 0.45)} />
          <stop offset="0.55" stopColor={a} />
          <stop offset="1" stopColor={mix(a, '#000000', 0.6)} />
        </linearGradient>
        {tints.map((c, i) => (
          <radialGradient key={i} id={`${uid}-b${i}`}>
            <stop offset="0" stopColor={rgbaOf(c, i % 2 === 0 ? 0.34 : 0.5)} />
            <stop offset="0.5" stopColor={rgbaOf(c, i % 2 === 0 ? 0.12 : 0.18)} />
            <stop offset="1" stopColor={rgbaOf(c, 0)} />
          </radialGradient>
        ))}
      </defs>
      <rect width={width} height={height} fill={`url(#${uid}-base)`} />
      {seeds.map((s, i) => {
        const cx = width * (s.x + s.ax * Math.sin(t * s.fx + s.px))
        const cy = height * (s.y + s.ay * Math.cos(t * s.fy + s.py))
        const r = reach * s.size
        return <ellipse key={i} cx={cx} cy={cy} rx={r} ry={r * (0.8 + 0.2 * Math.sin(t * 0.3 + i))} fill={`url(#${uid}-b${i})`} />
      })}
    </svg>
  )
}
