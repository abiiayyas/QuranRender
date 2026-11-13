import { useId } from 'react'
import { fixed, mix, mod, rgbaOf, type MotionProps } from './util'

const RINGS = 9

const polygon = (sides: number, r: number, cx: number, cy: number): string =>
  Array.from({ length: sides }, (_, k) => {
    const ang = (k / sides) * Math.PI * 2 - Math.PI / 2
    return `${fixed(cx + r * Math.cos(ang))},${fixed(cy + r * Math.sin(ang))}`
  }).join(' ')

/** A triangular line lattice drifting under counter-rotating nested polygons. Abstract lines only. */
export function Geometry({ a, b, width, height, t }: MotionProps) {
  const uid = useId().replace(/:/g, '')
  const unit = Math.min(width, height)
  const cx = width / 2
  const cy = height / 2
  const reach = Math.hypot(width, height) / 2
  const spacing = unit * 0.1
  const drift = mod(t * unit * 0.012, spacing)
  const lines = Math.ceil((2 * reach) / spacing) + 2
  const stroke = Math.max(1, unit * 0.0014)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0" stopColor={rgbaOf(b, 0.22)} />
          <stop offset="1" stopColor={rgbaOf(b, 0)} />
        </radialGradient>
        <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(a, '#000000', 0.4)} />
          <stop offset="1" stopColor={a} />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${uid}-base)`} />
      <circle cx={cx} cy={cy} r={reach * 0.7} fill={`url(#${uid}-glow)`} />
      <g transform={`rotate(${fixed(t * 1.2)} ${fixed(cx)} ${fixed(cy)})`} stroke={rgbaOf(b, 0.26)} strokeWidth={stroke}>
        {[0, 60, 120].map((deg) => (
          <g key={deg} transform={`rotate(${deg} ${fixed(cx)} ${fixed(cy)})`}>
            {Array.from({ length: lines }, (_, n) => {
              const y = cy - reach + n * spacing + drift - spacing
              return <line key={n} x1={cx - reach} x2={cx + reach} y1={fixed(y)} y2={fixed(y)} />
            })}
          </g>
        ))}
      </g>
      <g fill="none" strokeLinejoin="round">
        {Array.from({ length: RINGS }, (_, i) => {
          const r = unit * (0.1 + 0.105 * i)
          const spin = (i % 2 === 0 ? 1 : -1) * t * (2.5 + i * 0.7) + i * 11
          return (
            <polygon
              key={i}
              points={polygon(i % 3 === 2 ? 3 : 6, r, cx, cy)}
              transform={`rotate(${fixed(spin)} ${fixed(cx)} ${fixed(cy)})`}
              stroke={rgbaOf(b, 0.6 * (1 - i / (RINGS + 1)))}
              strokeWidth={stroke * 2}
            />
          )
        })}
      </g>
    </svg>
  )
}
