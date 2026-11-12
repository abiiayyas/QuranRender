import { useMemo } from 'react'

/** Peaks (0..1) as one SVG polygon in `currentColor`, stretched to its box. */
export function Waveform({ peaks, label }: { peaks: ReadonlyArray<number>; label: string }) {
  const path = useMemo(() => {
    if (peaks.length === 0) return ''
    const amp = (v: number) => Math.min(Math.max(v, 0), 1) * 46 + 0.5
    const top = peaks.map((v, i) => `${i === 0 ? 'M' : 'L'}${i + 0.5} ${(50 - amp(v)).toFixed(2)}`)
    const bottom = peaks.map((v, i) => `L${i + 0.5} ${(50 + amp(v)).toFixed(2)}`).reverse()
    return `${top.join('')}${bottom.join('')}Z`
  }, [peaks])
  return (
    <svg className="wave-svg" viewBox={`0 0 ${Math.max(peaks.length, 1)} 100`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={path} />
    </svg>
  )
}
