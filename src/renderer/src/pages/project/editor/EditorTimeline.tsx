import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { PlayerRef } from '@remotion/player'
import { segmentVerseKey } from '@shared/dua'
import { t } from '@shared/i18n'
import { overlayLabel } from '@shared/overlay'
import { segmentLabel, snapMs } from '@shared/segments'
import type { Asset, Overlay, Project, Verse } from '@shared/types'
import { Icon } from '../../../components/ui'
import { Waveform } from '../../../components/Waveform'
import { formatMs } from '../../../lib/format'
import { setOverlay } from './controls'

const ZOOMS = [1, 2, 4, 8, 16, 32, 64]
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]
/** Edge snapping distance on screen. */
const SNAP_PX = 8
/** An overlay never gets shorter than this when an edge is dragged. */
const MIN_OVERLAY_MS = 300
/**
 * shortcut: one fixed set of peaks stretched over the zoomed width, so deep zoom on a long recording looks blocky;
 * upgrade by asking main for peaks of just the visible range.
 */
const PEAKS = 4000

type Drag = { id: string; mode: 'move' | 'start' | 'end'; grabMs: number; start: number; end: number | null }

/**
 * Segments, overlays and the waveform on one time axis. Zoom and scroll sideways for long recordings; click or drag the
 * ruler to seek; drag an overlay to move it or its edges to resize it. Segment times are edited in step 2, which owns them.
 */
export function EditorTimeline({
  project,
  source,
  verses,
  durationMs,
  fps,
  playerRef,
  selectedOverlay,
  onSelectOverlay
}: {
  project: Project
  source: Asset | undefined
  verses: Record<string, Verse>
  durationMs: number
  fps: number
  playerRef: RefObject<PlayerRef | null>
  selectedOverlay: string | null
  onSelectOverlay: (id: string) => void
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const scrub = useRef(false)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [peaks, setPeaks] = useState<number[]>([])
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    p.addEventListener('frameupdate', onFrame)
    p.addEventListener('play', onPlay)
    p.addEventListener('pause', onPause)
    p.addEventListener('ended', onPause)
    return () => {
      p.removeEventListener('frameupdate', onFrame)
      p.removeEventListener('play', onPlay)
      p.removeEventListener('pause', onPause)
      p.removeEventListener('ended', onPause)
    }
  }, [playerRef])

  useEffect(() => {
    if (!source) return setPeaks([])
    let live = true
    void window.api.sources.waveform(project.id, source.id, PEAKS).then(
      (p) => live && setPeaks(p),
      () => live && setPeaks([])
    )
    return () => {
      live = false
    }
  }, [project.id, source])

  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const now = (frame / fps) * 1000
  const pct = (ms: number): string => `${(Math.min(Math.max(ms, 0), durationMs) / durationMs) * 100}%`
  const msPerPx = durationMs / Math.max(1, width * zoom)

  // While playing on a zoomed axis, scroll so the playhead stays in view.
  useEffect(() => {
    const el = outer.current
    if (!el || !playing || zoom === 1) return
    const x = (now / durationMs) * el.scrollWidth
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1)
  }, [now, playing, zoom, durationMs])

  const msAt = (clientX: number): number => {
    const r = inner.current!.getBoundingClientRect()
    return Math.min(durationMs, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * durationMs))
  }
  const seekMs = (ms: number): void => playerRef.current?.seekTo(Math.round((Math.min(Math.max(ms, 0), durationMs) * fps) / 1000))

  // Zoom around the playhead so what the user is looking at does not jump away.
  const zoomTo = (next: number): void => {
    const el = outer.current
    const keep = el ? (now / durationMs) * el.scrollWidth - el.scrollLeft : 0
    setZoom(next)
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = Math.max(0, (now / durationMs) * el.scrollWidth - keep)
    })
  }

  const pxPerSec = (width * zoom) / Math.max(1, durationMs / 1000)
  const step = TICK_STEPS.find((s) => s * pxPerSec >= 80) ?? 3600
  const ticks: number[] = []
  for (let s = 0; s * 1000 <= durationMs && ticks.length < 2000; s += step) ticks.push(s * 1000)

  const snapTargets = (exceptId: string): number[] => [
    now,
    ...project.segments.flatMap((s) => [s.startMs, s.endMs]),
    ...project.overlays.filter((o) => o.id !== exceptId).flatMap((o) => [o.startMs, o.endMs ?? durationMs])
  ]

  const begin = (e: React.PointerEvent<HTMLElement>, o: Overlay, mode: Drag['mode']): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: o.id, mode, grabMs: msAt(e.clientX) - o.startMs, start: o.startMs, end: o.endMs }
    onSelectOverlay(o.id)
  }

  const move = (e: React.PointerEvent<HTMLElement>, id: string): void => {
    const d = drag.current
    if (!d || d.id !== id) return
    const targets = snapTargets(id)
    const tol = SNAP_PX * msPerPx
    const key = `ovDrag${id}`
    const end = d.end ?? durationMs
    if (d.mode === 'start') {
      const start = Math.min(snapMs(msAt(e.clientX), targets, tol), end - MIN_OVERLAY_MS)
      setOverlay(id, { startMs: Math.round(Math.max(0, start)) }, key)
    } else if (d.mode === 'end') {
      const next = Math.max(snapMs(msAt(e.clientX), targets, tol), d.start + MIN_OVERLAY_MS)
      // Dragged to the very end: "until the end of the video" again.
      setOverlay(id, { endMs: next >= durationMs ? null : Math.round(next) }, key)
    } else {
      const len = end - d.start
      let start = msAt(e.clientX) - d.grabMs
      // Snap whichever edge, start or end, is closer to a target.
      const a = snapMs(start, targets, tol)
      const b = snapMs(start + len, targets, tol) - len
      start = a !== start ? a : b
      start = Math.min(Math.max(0, start), durationMs - (d.end === null ? MIN_OVERLAY_MS : len))
      setOverlay(id, { startMs: Math.round(start), ...(d.end === null ? {} : { endMs: Math.round(start + len) }) }, key)
    }
  }

  const stopDrag = (): void => {
    drag.current = null
  }

  const handle = (o: Overlay, which: 'start' | 'end') => (
    <span
      className={`seg-edge ${which === 'start' ? 'is-start' : 'is-end'}`}
      aria-hidden="true"
      onPointerDown={(e) => begin(e, o, which)}
      onPointerMove={(e) => move(e, o.id)}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    />
  )

  return (
    <div className="qr-tl ed-tl">
      <div className="ed-tl__bar">
        <span className="qr-tc">{formatMs(now)}</span>
        <span className="qr-tc qr-tc--dim">/ {formatMs(durationMs)}</span>
        <span className="spacer" />
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label={t('Perkecil linimasa')} disabled={zoom === ZOOMS[0]} onClick={() => zoomTo(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
          <Icon name="zoom-out" size="sm" />
        </button>
        <span className="qr-tc qr-tc--dim ed-tl__zoom">{zoom}×</span>
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label={t('Perbesar linimasa')} disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => zoomTo(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>
          <Icon name="zoom-in" size="sm" />
        </button>
      </div>
      <div className="ed-tl__grid">
        <div className="ed-tl__heads" aria-hidden="true">
          <div className="ed-tl__ruler-head" />
          <div className="ed-tl__head">{t('Segmen')}</div>
          {project.overlays.length > 0 && <div className="ed-tl__head">{t('Overlay')}</div>}
          <div className="ed-tl__head">{t('Audio')}</div>
        </div>
        <div className="ed-tl__scroll" ref={outer}>
          <div
            className="ed-tl__inner"
            ref={inner}
            style={{ width: `${zoom * 100}%` }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              scrub.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              seekMs(msAt(e.clientX))
            }}
            onPointerMove={(e) => {
              if (scrub.current) seekMs(msAt(e.clientX))
            }}
            onPointerUp={() => {
              scrub.current = false
            }}
            onPointerCancel={() => {
              scrub.current = false
            }}
          >
            <div className="ed-tl__ruler" aria-hidden="true">
              {ticks.map((ms) => (
                <span key={ms} style={{ left: pct(ms) }}>
                  {formatMs(ms).replace(/,\d$/, '')}
                </span>
              ))}
            </div>
            <div className="ed-tl__row">
              <div className="qr-lane">
                {project.segments.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="qr-clip"
                    style={{ left: pct(s.startMs), width: pct(s.endMs - s.startMs) }}
                    title={`${segmentLabel(s, verses[segmentVerseKey(s)]?.words.length)} · ${formatMs(s.startMs)}–${formatMs(s.endMs)}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => seekMs(s.startMs)}
                  >
                    <span className="qr-clip__label">{segmentLabel(s, verses[segmentVerseKey(s)]?.words.length)}</span>
                  </button>
                ))}
              </div>
            </div>
            {project.overlays.length > 0 && (
              <div className="ed-tl__row">
                <div className="qr-lane">
                  {project.overlays.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={o.id === selectedOverlay ? 'qr-clip ed-tl__ov is-selected' : 'qr-clip ed-tl__ov'}
                      style={{ left: pct(o.startMs), width: pct((o.endMs ?? durationMs) - o.startMs) }}
                      title={`${overlayLabel(o)} · ${formatMs(o.startMs)}–${formatMs(o.endMs ?? durationMs)}`}
                      onPointerDown={(e) => begin(e, o, 'move')}
                      onPointerMove={(e) => move(e, o.id)}
                      onPointerUp={stopDrag}
                      onPointerCancel={stopDrag}
                      onClick={() => onSelectOverlay(o.id)}
                    >
                      {handle(o, 'start')}
                      <span className="qr-clip__label">{overlayLabel(o)}</span>
                      {handle(o, 'end')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="ed-tl__row ed-tl__row--wave">{peaks.length > 0 && <Waveform peaks={peaks} label={t('Gelombang audio')} />}</div>
            <div className="ed-playhead" style={{ left: pct(now) }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}
