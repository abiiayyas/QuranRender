import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Asset } from '@shared/types'
import { Icon } from '../../../components/ui'
import { Waveform } from '../../../components/Waveform'
import { errorText, formatMs } from '../../../lib/format'
import { useAudio } from '../../../lib/useAudio'
import { confirmDialog, toast } from '../../../store/app'
import { useProject } from '../../../store/project'

export const SOURCE_LABEL: Record<Asset['source'], string> = {
  local: 'Berkas di komputer',
  mp3quran: 'MP3Quran',
  qdc: 'Quran.com (QDC)',
  youtube: 'YouTube',
  trim: 'Hasil potongan',
  frame: 'Bingkai video'
}

const PEAKS = 1600
const MIN_CUT_MS = 500

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
      {bad && <span className="qr-error">Tulis waktu seperti 1:05,2 atau 65,2.</span>}
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

  useEffect(() => {
    let live = true
    setPeaks([])
    window.api.sources.waveform(projectId, asset.id, PEAKS).then(
      (p) => live && setPeaks(p),
      () => live && setPeaks([])
    )
    return () => {
      live = false
    }
  }, [projectId, asset.id])

  useEffect(() => setCut({ inMs: 0, outMs: dur }), [asset.id, dur])

  const pct = (ms: number) => `${dur > 0 ? (Math.min(Math.max(ms, 0), dur) / dur) * 100 : 0}%`
  const msAt = (clientX: number) => {
    const r = wave.current!.getBoundingClientRect()
    return Math.round((Math.min(Math.max(clientX - r.left, 0), r.width) / Math.max(r.width, 1)) * dur)
  }
  const setIn = (ms: number) => setCut((c) => ({ ...c, inMs: Math.min(Math.max(0, ms), c.outMs - MIN_CUT_MS) }))
  const setOut = (ms: number) => setCut((c) => ({ ...c, outMs: Math.max(Math.min(dur, ms), c.inMs + MIN_CUT_MS) }))
  const trimmed = cut.inMs > 0 || cut.outMs < dur

  const handle = (which: 'in' | 'out') => {
    const set = which === 'in' ? setIn : setOut
    const value = which === 'in' ? cut.inMs : cut.outMs
    return {
      role: 'slider',
      tabIndex: 0,
      'aria-label': which === 'in' ? 'Titik masuk' : 'Titik keluar',
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
        title: 'Potong rekaman?',
        body:
          lost > 0
            ? `Waktu segmen akan digeser mengikuti potongan, dan ${lost} segmen di luar potongan akan dihapus.`
            : 'Waktu segmen akan digeser mengikuti potongan.',
        confirmLabel: 'Potong'
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
          {asset.kind === 'video' ? 'Video' : 'Audio'} · {formatMs(dur)} · {SOURCE_LABEL[asset.source]}
        </span>
      </div>
      <div className="insp-pad">
        <div
          ref={wave}
          className="src-wave"
          onPointerDown={(e) => dur > 0 && audio.seek(msAt(e.clientX))}
          title="Klik untuk memindahkan posisi pemutar"
        >
          {peaks.length > 0 ? <Waveform peaks={peaks} label={`Bentuk gelombang ${asset.name}`} /> : <span className="lane-note">Menyiapkan bentuk gelombang…</span>}
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

        <div className="src-transport">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--icon" aria-label={audio.playing ? 'Jeda' : 'Putar'} onClick={audio.toggle}>
            <Icon name={audio.playing ? 'pause' : 'play'} />
          </button>
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Kembali ke awal" onClick={() => audio.seek(0)}>
            <Icon name="skip-back" />
          </button>
          <span className="qr-tc">
            {formatMs(audio.t)} <span className="qr-tc--dim">/ {formatMs(dur)}</span>
          </span>
        </div>

        <div className="src-trim">
          <p className="pn-h">Potong awal dan akhir</p>
          <div className="grid-2">
            <TimeInput label="Titik masuk" value={cut.inMs} onCommit={setIn} />
            <TimeInput label="Titik keluar" value={cut.outMs} onCommit={setOut} />
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setIn(audio.t)}>
              Masuk di posisi pemutar
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setOut(audio.t)}>
              Keluar di posisi pemutar
            </button>
          </div>
          <span className="qr-help">Geser pegangan pada gelombang, atau tulis waktunya. Bagian yang diarsir akan dibuang.</span>
          <div className="src-actions">
            <button type="button" className="qr-btn qr-btn--secondary" disabled={!trimmed} onClick={() => audio.playRange(cut.inMs, cut.outMs)}>
              <Icon name="play" />
              Putar potongan
            </button>
            <button type="button" className="qr-btn qr-btn--ghost" disabled={!trimmed} onClick={() => setCut({ inMs: 0, outMs: dur })}>
              <Icon name="rotate-ccw" />
              Atur ulang
            </button>
            <button type="button" className="qr-btn qr-btn--primary" disabled={!trimmed || busy} onClick={() => void trim()}>
              <Icon name="scissors" />
              Potong
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
