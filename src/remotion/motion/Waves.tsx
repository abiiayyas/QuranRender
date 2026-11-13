import { useId } from 'react'
import { fixed, mix, rgbaOf, type MotionProps } from './util'

const LAYERS = 5
const STEP = 36

/** Stacked sine layers, farthest dark and slow, nearest light and quicker. */
export function Waves({ a, b, width, height, t }: MotionProps) {
  const uid = useId().replace(/:/g, '')
  const columns = Math.ceil(width / STEP) + 1
  const stroke = Math.max(1.5, Math.min(width, height) * 0.0018)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(a, '#000000', 0.5)} />
          <stop offset="0.6" stopColor={a} />
          <stop offset="1" stopColor={mix(a, b, 0.15)} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0" stopColor={rgbaOf(b, 0.3)} />
          <stop offset="1" stopColor={rgbaOf(b, 0)} />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${uid}-base)`} />
      <ellipse cx={width / 2} cy={height * 0.42} rx={width * 0.7} ry={height * 0.2} fill={`url(#${uid}-glow)`} />
      {Array.from({ length: LAYERS }, (_, i) => {
        const baseline = height * (0.46 + 0.1 * i)
        const amp = height * (0.014 + 0.007 * i)
        const k = (Math.PI * 2) / (width * (1.05 - 0.12 * i))
        const dir = i % 2 === 0 ? 1 : -1
        const flow = t * (0.5 + 0.18 * i) * dir
        const pts: string[] = []
        for (let c = 0; c < columns; c++) {
          const x = Math.min(width, c * STEP)
          const y = baseline + amp * Math.sin(x * k + flow + i * 1.7) + amp * 0.4 * Math.sin(x * k * 2.3 - flow * 1.4 + i)
          pts.push(`${fixed(x)},${fixed(y)}`)
        }
        const crest = `M${pts.join(' L')}`
        return (
          <g key={i}>
            <path d={`${crest} L${width},${height} L0,${height} Z`} fill={rgbaOf(mix(a, b, 0.08 + 0.11 * i), 0.82)} />
            <path d={crest} fill="none" stroke={rgbaOf(b, 0.18 + 0.05 * i)} strokeWidth={stroke} strokeLinejoin="round" />
          </g>
        )
      })}
    </svg>
  )
}
