import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Asset } from '@shared/types'
import { msg, t } from '@shared/i18n'
import { Icon } from '../../../components/ui'
import { Waveform } from '../../../components/Waveform'
import { errorText, formatMs } from '../../../lib/format'
import { useAudio } from '../../../lib/useAudio'
import { confirmDialog, toast } from '../../../store/app'
import { useProject } from '../../../store/project'

export const SOURCE_LABEL: Record<Asset['source'], string> = {
  local: msg('Berkas di komputer'),
  mp3quran: 'MP3Quran',
  qdc: 'Quran.com (QDC)',
  opendua: 'OpenDua',
  youtube: 'YouTube',
  trim: msg('Hasil potongan'),
  frame: msg('Bingkai video'),
  stock: msg('Foto/video stok'),
  ai: msg('Dibuat dengan AI')
}

const MIN_PEAKS = 1600
const MAX_PEAKS = 20_000
const MIN_CUT_MS = 500
const ZOOMS = [1, 2, 4, 8, 16, 32, 64]
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/** "1:02,5", "62.5" or "1:01:02" → ms; null when unreadable. */
function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':')
  if (parts.length > 3 || parts.some((p) => p === '' || !/^\d*\.?\d*$/.test(p))) return null
  const s = parts.reduce((acc, p) => acc * 60 + Number(p), 0)
  return Number.isFinite(s) ? Math.round(s * 1000) : null
}

function TimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (ms: number) => void }) {
  const id = useId()
  const [text, setText] = useState(formatMs(value))
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(formatMs(value))
    setBad(false)
  }, [value])
  const commit = () => {
    const ms = parseTime(text)
    setBad(ms == null)
    if (ms != null) onCommit(ms)
  }
  return (
    <div className="qr-fieldset">
      <label className="qr-label" htmlFor={id}>
        {label}
      </label>
      <span className={bad ? 'qr-field is-invalid' : 'qr-field'}>
        <input
          id={id}
          value={text}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={bad}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </span>
      {bad && <span className="qr-error">{t('Tulis waktu seperti 1:05,2 atau 65,2.')}</span>}
    </div>
  )
}

/** Current source: waveform with playback, plus in/out points (handles or fields) to cut it. */
export function SourceCard({ asset, busy }: { asset: Asset; busy: boolean }) {
  const projectId = useProject((s) => s.project!.id)
  const audio = useAudio(asset.url)
  const dur = asset.durationMs ?? audio.durationMs
  const [peaks, setPeaks] = useState<number[]>([])
  const [cut, setCut] = useState({ inMs: 0, outMs: dur })
  const wave = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const keepCenter = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)

  // Enough detail to place a cut by eye even at full zoom: about 8 peaks per second, within what the main process allows.
  const peakCount = Math.min(MAX_PEAKS, Math.max(MIN_PEAKS, Math.round((dur / 1000) * 8)))

  useEffect(() => {
    let live = true
    setPeaks([])
    window.api.sources.waveform(projectId, asset.id, peakCount).then(
      (p) => live && setPeaks(p),
      () => live && setPeaks([])
    )
    return () => {
      live = false
    }
  }, [projectId, asset.id, peakCount])

  useEffect(() => setCut({ inMs: 0, outMs: dur }), [asset.id, dur])

  useLayoutEffect(() => {
    const el = scroll.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pct = (ms: number) => `${dur > 0 ? (Math.min(Math.max(ms, 0), dur) / dur) * 100 : 0}%`
  const msAt = (clientX: number) => {
    const r = wave.current!.getBoundingClientRect()
    return Math.round((Math.min(Math.max(clientX - r.left, 0), r.width) / Math.max(r.width, 1)) * dur)
  }
  const setIn = (ms: number) => setCut((c) => ({ ...c, inMs: Math.min(Math.max(0, ms), c.outMs - MIN_CUT_MS) }))
  const setOut = (ms: number) => setCut((c) => ({ ...c, outMs: Math.max(Math.min(dur, ms), c.inMs + MIN_CUT_MS) }))
  const trimmed = cut.inMs > 0 || cut.outMs < dur

  // Zoom keeps the middle of the view where it was, so the spot being trimmed does not jump away.
  const zoomTo = (next: number) => {
    const el = scroll.current
    if (el && dur > 0) keepCenter.current = ((el.scrollLeft + el.clientWidth / 2) / el.scrollWidth) * dur
    setZoom(next)
  }
  useLayoutEffect(() => {
    const el = scroll.current
    if (!el || keepCenter.current === null || dur <= 0) return
    el.scrollLeft = (keepCenter.current / dur) * el.scrollWidth - el.clientWidth / 2
    keepCenter.current = null
  }, [zoom, dur])

  // While playing on a zoomed strip, scroll so the playhead stays in view.
  useEffect(() => {
    const el = scroll.current
    if (!el || !audio.playing || zoom === 1 || dur <= 0) return
    const x = (audio.t / dur) * el.scrollWidth
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1)
  }, [audio.t, audio.playing, zoom, dur])

  const pxPerSec = (width * zoom) / Math.max(1, dur / 1000)
  const tickStep = TICK_STEPS.find((s) => s * pxPerSec >= 72) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const ticks: number[] = []
  for (let s = 0; s * 1000 <= dur && ticks.length < 2000; s += tickStep) ticks.push(s * 1000)

  const handle = (which: 'in' | 'out') => {
    const set = which === 'in' ? setIn : setOut
    const value = which === 'in' ? cut.inMs : cut.outMs
    return {
      role: 'slider',
      tabIndex: 0,
      'aria-label': which === 'in' ? t('Titik masuk') : t('Titik keluar'),
      'aria-valuemin': 0,
      'aria-valuemax': Math.round(dur),
      'aria-valuenow': Math.round(value),
      'aria-valuetext': formatMs(value),
      className: `src-handle is-${which}`,
      style: { left: pct(value) },
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) set(msAt(e.clientX))
      },
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 1000 : 100
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - step)
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + step)
        else if (e.key === 'Home') set(0)
        else if (e.key === 'End') set(dur)
        else return
        e.preventDefault()
      }
    }
  }

  const trim = async () => {
    const { project, flush } = useProject.getState()
    if (!project) return
    const lost = project.segments.filter((s) => s.endMs <= cut.inMs || s.startMs >= cut.outMs).length
    if (project.segments.length > 0) {
      const ok = await confirmDialog({
        title: t('Potong rekaman?'),
        body:
          lost > 0
            ? t('Waktu segmen akan digeser mengikuti potongan, dan {n} segmen di luar potongan akan dihapus.', { n: lost })
            : t('Waktu segmen akan digeser mengikuti potongan.'),
        confirmLabel: t('Potong')
      })
      if (!ok) return
    }
    audio.pause()
    await flush()
    try {
      await window.api.sources.trim(project.id, cut.inMs, cut.outMs)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="qr-panel">
      <div className="qr-panel__head">
        <Icon name={asset.kind === 'video' ? 'film' : 'audio-waveform'} />
        <span className="qr-panel__title src-title" title={asset.name}>
          {asset.name}
        </span>
        <span className="qr-panel__actions muted">
          {asset.kind === 'video' ? t('Video') : t('Audio')} · {formatMs(dur)} · {t(SOURCE_LABEL[asset.source])}
        </span>
      </div>
      <div className="insp-pad">
        <div className="src-zoom">
          <span className="qr-tc qr-tc--dim" aria-live="polite">
            {zoom}×
          </span>
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label={t('Perkecil tampilan')} disabled={zoom === ZOOMS[0]} onClick={() => zoomTo(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
            <Icon name="zoom-out" size="sm" />
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label={t('Perbesar tampilan')}
            disabled={zoom === ZOOMS[ZOOMS.length - 1]}
            onClick={() => zoomTo(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
          >
            <Icon name="zoom-in" size="sm" />
          </button>
        </div>
        <div className="src-scroll" ref={scroll}>
          <div className="src-track" style={{ width: `${zoom * 100}%` }}>
            <div className="src-ruler" aria-hidden="true">
              {ticks.map((ms) => (
                <span key={ms} style={{ left: pct(ms) }}>
                  {formatMs(ms).replace(/[,.]\d$/, '')}
                </span>
              ))}
            </div>
            <div
              ref={wave}
              className="src-wave"
              onPointerDown={(e) => dur > 0 && audio.seek(msAt(e.clientX))}
              title={t('Klik untuk memindahkan posisi pemutar')}
            >
              {peaks.length > 0 ? (
                <Waveform peaks={peaks} label={t('Bentuk gelombang {name}', { name: asset.name })} />
              ) : (
                <span className="lane-note">{t('Menyiapkan bentuk gelombang…')}</span>
              )}
              <div className="src-mask" style={{ left: 0, width: pct(cut.inMs) }} />
              <div className="src-mask" style={{ left: pct(cut.outMs), right: 0 }} />
              {dur > 0 && (
                <>
                  <div {...handle('in')} />
                  <div {...handle('out')} />
                  <div className="qr-playhead" style={{ left: pct(audio.t) }} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="src-transport">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--icon" aria-label={audio.playing ? t('Jeda') : t('Putar')} onClick={audio.toggle}>
            <Icon name={audio.playing ? 'pause' : 'play'} />
          </button>
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon" aria-label={t('Kembali ke awal')} onClick={() => audio.seek(0)}>
            <Icon name="skip-back" />
          </button>
          <span className="qr-tc">
            {formatMs(audio.t)} <span className="qr-tc--dim">/ {formatMs(dur)}</span>
          </span>
        </div>

        <div className="src-trim">
          <p className="pn-h">{t('Potong awal dan akhir')}</p>
          <div className="grid-2">
            <TimeInput label={t('Titik masuk')} value={cut.inMs} onCommit={setIn} />
            <TimeInput label={t('Titik keluar')} value={cut.outMs} onCommit={setOut} />
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setIn(audio.t)}>
              {t('Masuk di posisi pemutar')}
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setOut(audio.t)}>
              {t('Keluar di posisi pemutar')}
            </button>
          </div>
          <span className="qr-help">{t('Geser pegangan pada gelombang, atau tulis waktunya. Bagian yang diarsir akan dibuang.')}</span>
          <div className="src-actions">
            <button type="button" className="qr-btn qr-btn--secondary" disabled={!trimmed} onClick={() => audio.playRange(cut.inMs, cut.outMs)}>
              <Icon name="play" />
              {t('Putar potongan')}
            </button>
            <button type="button" className="qr-btn qr-btn--ghost" disabled={!trimmed} onClick={() => setCut({ inMs: 0, outMs: dur })}>
              <Icon name="rotate-ccw" />
              {t('Atur ulang')}
            </button>
            <button type="button" className="qr-btn qr-btn--primary" disabled={!trimmed || busy} onClick={() => void trim()}>
              <Icon name="scissors" />
              {t('Potong')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
