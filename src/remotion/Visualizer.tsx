import { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender, getRemotionEnvironment } from 'remotion'
import { bandsAt, SPECTRUM_BANDS } from '../shared/spectrum'
import type { Overlay } from '../shared/types'
import type { VideoProps } from '../shared/video'

const tables = new Map<string, Uint8Array>()
const loading = new Map<string, Promise<void>>()

/**
 * Loads the loudness table once per URL, holding the render (delayRender) until it is in. Started during render, not in an
 * effect, so the handle exists before Remotion captures the first frame.
 */
function useTable(url: string | null | undefined): Uint8Array | null {
  const [, bump] = useState(0)
  if (url && !tables.has(url) && !loading.has(url)) {
    const handle = delayRender('Memuat gelombang suara')
    loading.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`Tabel gelombang suara tidak bisa dimuat (${r.status}).`)
          return r.arrayBuffer()
        })
        .then((buf) => void tables.set(url, new Uint8Array(buf)))
        .catch((e: unknown) => {
          // An export without its visualizer would be wrong on every frame: fail it. The preview just draws nothing.
          if (getRemotionEnvironment().isRendering) cancelRender(e)
          else console.warn(e)
        })
        .finally(() => continueRender(handle))
    )
  }
  useEffect(() => {
    if (url && !tables.has(url)) void loading.get(url)?.then(() => bump((n) => n + 1))
  }, [url])
  return url ? (tables.get(url) ?? null) : null
}

const BAR_SHARE = 0.62

/**
 * Audio-reactive bars (mirrored around a centre line) or a smooth mirrored wave, drawn from the source audio's loudness
 * table. A pure function of time, so the preview and the export match. `o.size` is the height as a fraction of the canvas.
 */
export function VisualizerOverlay({ o, t, props }: { o: Overlay; t: number; props: VideoProps }) {
  const { width, height } = props
  const table = useTable(props.spectrumUrl)
  const bands = table ? bandsAt(table, t) : null
  if (!bands) return null

  const w = width * 0.78
  const h = Math.max(4, o.size * height)
  const step = w / SPECTRUM_BANDS
  const level = (i: number): number => bands[i] / 255
  const style = { position: 'absolute' as const, left: o.x * width - w / 2, top: o.y * height - h / 2, opacity: o.opacity }

  if (o.variant === 'wave') {
    const pts = Array.from({ length: SPECTRUM_BANDS }, (_, i) => [step * (i + 0.5), Math.max(0.02, level(i)) * (h / 2)] as const)
    const top = pts.map(([x, a], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(h / 2 - a).toFixed(1)}`).join(' ')
    const bottom = [...pts].reverse().map(([x, a]) => `L${x.toFixed(1)} ${(h / 2 + a).toFixed(1)}`).join(' ')
    return (
      <svg width={w} height={h} style={style}>
        <path d={`${top} ${bottom} Z`} fill={o.color} strokeLinejoin="round" stroke={o.color} strokeWidth={Math.max(2, h * 0.04)} />
      </svg>
    )
  }

  const barW = step * BAR_SHARE
  return (
    <svg width={w} height={h} style={style}>
      {Array.from({ length: SPECTRUM_BANDS }, (_, i) => {
        // Even a quiet bar keeps a little height, so the line of bars never disappears.
        const bh = Math.max(barW, level(i) * h)
        return <rect key={i} x={step * i + (step - barW) / 2} y={(h - bh) / 2} width={barW} height={bh} rx={barW / 2} fill={o.color} />
      })}
    </svg>
  )
}
