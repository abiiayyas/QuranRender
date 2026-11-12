import { useEffect, useState, type MouseEvent, type RefObject } from 'react'
import type { PlayerRef } from '@remotion/player'
import { segmentLabel } from '@shared/segments'
import type { Asset, Project, Verse } from '@shared/types'
import { verseKey } from '@shared/video'
import { Waveform } from '../../../components/Waveform'
import { formatMs } from '../../../lib/format'

/** Segments, overlays and the waveform on one shared time axis; click anywhere to seek. Edit segment times in step 2. */
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
  const [frame, setFrame] = useState(0)
  const [peaks, setPeaks] = useState<number[]>([])

  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame)
    p.addEventListener('frameupdate', on)
    return () => p.removeEventListener('frameupdate', on)
  }, [playerRef])

  useEffect(() => {
    if (!source) return setPeaks([])
    let live = true
    void window.api.sources.waveform(project.id, source.id, 800).then(
      (p) => live && setPeaks(p),
      () => live && setPeaks([])
    )
    return () => {
      live = false
    }
  }, [project.id, source])

  const pct = (ms: number): string => `${(Math.min(Math.max(ms, 0), durationMs) / durationMs) * 100}%`
  const t = (frame / fps) * 1000
  const seek = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    playerRef.current?.seekTo(Math.round((((e.clientX - r.left) / r.width) * durationMs * fps) / 1000))
  }
  const marks = Array.from({ length: 5 }, (_, i) => (durationMs * i) / 4)

  return (
    <div className="qr-tl ed-tl">
      <div className="qr-tl__ruler" aria-hidden="true">
        {marks.map((m) => (
          <span key={m}>{formatMs(m)}</span>
        ))}
      </div>
      <div className="ed-tl__tracks">
        <div className="qr-track">
          <div className="qr-track__head">
            <span>Segmen</span>
          </div>
          <div className="qr-lane" onPointerDown={seek}>
            {project.segments.map((s) => (
              <button
                key={s.id}
                type="button"
                className="qr-clip"
                style={{ left: pct(s.startMs), width: `calc(${pct(s.endMs)} - ${pct(s.startMs)})` }}
                onClick={(e) => {
                  e.stopPropagation()
                  playerRef.current?.seekTo(Math.round((s.startMs * fps) / 1000))
                }}
              >
                <span className="qr-clip__label">{segmentLabel(s, verses[verseKey(s.surah, s.ayah)]?.words.length)}</span>
              </button>
            ))}
          </div>
        </div>
        {project.overlays.length > 0 && (
          <div className="qr-track">
            <div className="qr-track__head">
              <span>Overlay</span>
            </div>
            <div className="qr-lane" onPointerDown={seek}>
              {project.overlays.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={o.id === selectedOverlay ? 'qr-clip is-selected' : 'qr-clip'}
                  style={{ left: pct(o.startMs), width: `calc(${pct(o.endMs ?? durationMs)} - ${pct(o.startMs)})` }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectOverlay(o.id)
                  }}
                >
                  <span className="qr-clip__label">{o.kind === 'text' ? o.text : 'Gambar'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="qr-track">
          <div className="qr-track__head">
            <span>Audio</span>
          </div>
          <div className="qr-lane ed-wave" onPointerDown={seek}>
            {peaks.length > 0 && <Waveform peaks={peaks} label="Gelombang audio" />}
          </div>
        </div>
        <div className="ed-playhead" style={{ left: `calc(var(--track-label-w) + (100% - var(--track-label-w) - 10px) * ${t / durationMs})` }} aria-hidden="true" />
      </div>
    </div>
  )
}
