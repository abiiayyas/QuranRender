import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { segmentLabel, snapMs, type Edge } from '@shared/segments'
import type { Segment, Verse } from '@shared/types'
import { verseKey } from '@shared/video'
import { Icon } from '../../../components/ui'
import { Waveform } from '../../../components/Waveform'
import { formatMs } from '../../../lib/format'

const ZOOMS = [1, 2, 4, 8, 16, 32]
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
/** Edge snapping distance on screen. */
const SNAP_PX = 8

/**
 * The whole audio as a waveform with the segments above it. Click a block to select it, click elsewhere to seek, drag a
 * block edge to retime it (snaps to neighbors and the playhead).
 */
export function SyncTimeline({
  segments,
  verses,
  durationMs,
  peaks,
  peaksError,
  t,
  playing,
  selectedId,
  onSelect,
  onSeek,
  onEdge
}: {
  segments: ReadonlyArray<Segment>
  verses: Record<string, Verse>
  durationMs: number
  peaks: ReadonlyArray<number>
  peaksError: boolean
  t: number
  playing: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onSeek: (ms: number) => void
  onEdge: (id: string, edge: Edge, ms: number) => void
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; edge: Edge } | null>(null)
  const scrub = useRef(false)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the playhead in view while playing on a zoomed strip.
  useEffect(() => {
    const el = outer.current
    if (!el || !playing || zoom === 1 || durationMs <= 0) return
    const x = (t / durationMs) * el.scrollWidth
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1)
  }, [t, playing, zoom, durationMs])

  useEffect(() => {
    if (!selectedId) return
    inner.current?.querySelector(`[data-seg="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [selectedId, zoom])

  const pct = (ms: number) => `${durationMs > 0 ? (ms / durationMs) * 100 : 0}%`
  const msAt = (clientX: number): number => {
    const r = inner.current!.getBoundingClientRect()
    return Math.min(durationMs, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * durationMs))
  }
  const msPerPx = durationMs / Math.max(1, width * zoom)

  const pxPerSec = (width * zoom) / Math.max(1, durationMs / 1000)
  const step = TICK_STEPS.find((s) => s * pxPerSec >= 72) ?? 600
  const ticks: number[] = []
  for (let s = 0; s * 1000 <= durationMs && ticks.length < 2000; s += step) ticks.push(s * 1000)

  const selected = segments.find((s) => s.id === selectedId) ?? null

  return (
    <div className="sync-tl">
      <div className="sync-tl__bar">
        <span className="qr-tc">{formatMs(t)}</span>
        <span className="qr-tc qr-tc--dim">/ {formatMs(durationMs)}</span>
        <span className="spacer" />
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
          aria-label="Perkecil tampilan"
          disabled={zoom === ZOOMS[0]}
          onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
        >
          <Icon name="zoom-out" size="sm" />
        </button>
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
          aria-label="Perbesar tampilan"
          disabled={zoom === ZOOMS[ZOOMS.length - 1]}
          onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
        >
          <Icon name="zoom-in" size="sm" />
        </button>
      </div>
      <div className="sync-tl__scroll" ref={outer}>
        <div
          className="sync-tl__inner"
          ref={inner}
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as Element).closest('.qr-clip')) return
            scrub.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            onSeek(msAt(e.clientX))
          }}
          onPointerMove={(e) => {
            if (scrub.current) onSeek(msAt(e.clientX))
          }}
          onPointerUp={() => {
            scrub.current = false
          }}
          onPointerCancel={() => {
            scrub.current = false
          }}
        >
          <div className="sync-tl__ruler" aria-hidden="true">
            {ticks.map((ms) => (
              <span key={ms} style={{ left: pct(ms) }}>
                {formatMs(ms).replace(/,\d$/, '')}
              </span>
            ))}
          </div>
          <div className="sync-tl__clips">
            {segments.map((s) => {
              const label = segmentLabel(s, verses[verseKey(s.surah, s.ayah)]?.words.length)
              const cls = ['qr-clip', s.kind !== 'ayah' && 'is-special', s.id === selectedId && 'is-selected'].filter(Boolean).join(' ')
              const edge = (which: Edge) => (
                <span
                  className={`seg-edge ${which === 'start' ? 'is-start' : 'is-end'}`}
                  aria-hidden="true"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    drag.current = { id: s.id, edge: which }
                    onSelect(s.id)
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.id !== s.id) return
                    const targets = segments.filter((o) => o.id !== s.id).flatMap((o) => [o.startMs, o.endMs])
                    targets.push(t)
                    onEdge(s.id, which, snapMs(msAt(e.clientX), targets, SNAP_PX * msPerPx))
                  }}
                  onPointerUp={() => {
                    drag.current = null
                  }}
                  onPointerCancel={() => {
                    drag.current = null
                  }}
                />
              )
              return (
                <button
                  key={s.id}
                  type="button"
                  data-seg={s.id}
                  className={cls}
                  style={{ left: pct(s.startMs), width: pct(s.endMs - s.startMs) }}
                  title={`${label} · ${formatMs(s.startMs)}–${formatMs(s.endMs)}`}
                  aria-label={`Segmen ${label}, ${formatMs(s.startMs)} sampai ${formatMs(s.endMs)}`}
                  aria-pressed={s.id === selectedId}
                  onClick={() => onSelect(s.id)}
                >
                  {edge('start')}
                  <span className="qr-clip__label">{label}</span>
                  {edge('end')}
                </button>
              )
            })}
          </div>
          <div className="sync-tl__wave">
            {selected && <div className="sync-tl__band" style={{ left: pct(selected.startMs), width: pct(selected.endMs - selected.startMs) }} />}
            {peaks.length > 0 ? (
              <Waveform peaks={peaks} label="Gelombang suara seluruh audio" />
            ) : (
              <span className="lane-note">{peaksError ? 'Gelombang suara tidak bisa dimuat.' : 'Memuat gelombang suara…'}</span>
            )}
          </div>
          <div className="qr-playhead" style={{ left: pct(t) }} />
        </div>
      </div>
    </div>
  )
}
