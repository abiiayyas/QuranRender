import { useId, useMemo } from 'react'
import { fixed, mix, mod, rgbaOf, rnd, type MotionProps } from './util'

const COUNT = 64

/** Dust of light rising slowly; depth sets size, speed and brightness. */
export function Particles({ a, b, width, height, t }: MotionProps) {
  const uid = useId().replace(/:/g, '')
  const unit = Math.min(width, height)
  const dots = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const depth = 0.25 + 0.75 * rnd('pt', i, 'd')
        return {
          x: rnd('pt', i, 'x'),
          y: rnd('pt', i, 'y'),
          depth,
          sway: 0.008 + 0.02 * rnd('pt', i, 's'),
          freq: 0.3 + 0.7 * rnd('pt', i, 'f'),
          phase: rnd('pt', i, 'p') * Math.PI * 2,
          twinkle: 0.6 + 1.4 * rnd('pt', i, 't')
        }
      }),
    []
  )
  const margin = unit * 0.06
  const lane = height + 2 * margin
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(a, '#000000', 0.5)} />
          <stop offset="0.7" stopColor={a} />
          <stop offset="1" stopColor={mix(a, b, 0.22)} />
        </linearGradient>
        <radialGradient id={`${uid}-dot`}>
          <stop offset="0" stopColor={rgbaOf(mix(b, '#FFFFFF', 0.55), 1)} />
          <stop offset="0.35" stopColor={rgbaOf(b, 0.55)} />
          <stop offset="1" stopColor={rgbaOf(b, 0)} />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${uid}-base)`} />
      {dots.map((d, i) => {
        const rise = unit * (0.012 + 0.032 * d.depth)
        const y = mod(d.y * lane - t * rise, lane) - margin
        const x = d.x * width + Math.sin(t * d.freq + d.phase) * unit * d.sway * 2
        const r = unit * (0.006 + 0.02 * d.depth * d.depth)
        const alpha = (0.3 + 0.6 * d.depth) * (0.75 + 0.25 * Math.sin(t * d.twinkle + d.phase))
        return <circle key={i} cx={fixed(x)} cy={fixed(y)} r={fixed(r)} fill={`url(#${uid}-dot)`} opacity={alpha.toFixed(3)} />
      })}
    </svg>
  )
}
