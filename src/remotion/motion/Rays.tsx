import { useId, useMemo } from 'react'
import { fixed, mix, rgbaOf, rnd, type MotionProps } from './util'

const RAYS = 9

/** Beams fanning out from a point above the frame, swaying a few degrees. */
export function Rays({ a, b, width, height, t }: MotionProps) {
  const uid = useId().replace(/:/g, '')
  const rays = useMemo(
    () =>
      Array.from({ length: RAYS }, (_, i) => ({
        base: -44 + (88 * i) / (RAYS - 1) + (rnd('ry', i, 'j') - 0.5) * 6,
        half: 2 + 4.5 * rnd('ry', i, 'w'),
        sway: 1.5 + 2.5 * rnd('ry', i, 's'),
        freq: 0.15 + 0.25 * rnd('ry', i, 'f'),
        phase: rnd('ry', i, 'p') * Math.PI * 2,
        pulse: 0.3 + 0.4 * rnd('ry', i, 'u')
      })),
    []
  )
  const reach = Math.max(width, height) * 1.7
  const px = width / 2
  const py = -height * 0.1
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(a, b, 0.18)} />
          <stop offset="0.6" stopColor={a} />
          <stop offset="1" stopColor={mix(a, '#000000', 0.55)} />
        </linearGradient>
        <linearGradient id={`${uid}-ray`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={reach}>
          <stop offset="0" stopColor={rgbaOf(b, 0.34)} />
          <stop offset="0.5" stopColor={rgbaOf(b, 0.12)} />
          <stop offset="1" stopColor={rgbaOf(b, 0)} />
        </linearGradient>
        <radialGradient id={`${uid}-src`}>
          <stop offset="0" stopColor={rgbaOf(b, 0.5)} />
          <stop offset="1" stopColor={rgbaOf(b, 0)} />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${uid}-base)`} />
      <circle cx={px} cy={Math.max(0, py)} r={Math.max(width, height) * 0.55} fill={`url(#${uid}-src)`} />
      {rays.map((r, i) => {
        const angle = r.base + Math.sin(t * r.freq + r.phase) * r.sway
        const spread = reach * Math.tan((r.half * Math.PI) / 180)
        return (
          <polygon
            key={i}
            points={`0,0 ${fixed(-spread)},${fixed(reach)} ${fixed(spread)},${fixed(reach)}`}
            transform={`translate(${fixed(px)} ${fixed(py)}) rotate(${fixed(angle)})`}
            fill={`url(#${uid}-ray)`}
            opacity={(0.65 + 0.35 * Math.sin(t * r.pulse + r.phase)).toFixed(3)}
          />
        )
      })}
    </svg>
  )
}
