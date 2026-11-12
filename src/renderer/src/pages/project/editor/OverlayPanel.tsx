import { useId } from 'react'
import type { Overlay } from '@shared/types'
import { Icon } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { toast } from '../../../store/app'
import { useProject } from '../../../store/project'
import { ColorRow, Section, setOverlay, Slider, SwitchRow } from './controls'

const secs = (ms: number): string => (ms / 1000).toFixed(1)

function OverlayForm({ o, durationMs }: { o: Overlay; durationMs: number }) {
  const startId = useId()
  const endId = useId()
  const textId = useId()
  return (
    <>
      {o.kind === 'text' && (
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={textId}>
            Teks
          </label>
          <span className="qr-field">
            <input id={textId} value={o.text} onChange={(e) => setOverlay(o.id, { text: e.target.value }, `ovText${o.id}`)} />
          </span>
        </div>
      )}
      <Slider label={o.kind === 'text' ? 'Ukuran' : 'Lebar'} value={o.size} min={0.02} max={o.kind === 'text' ? 0.3 : 1} step={0.005} onChange={(size) => setOverlay(o.id, { size }, `ovSize${o.id}`)} />
      {o.kind === 'text' && <ColorRow label="Warna" value={o.color} onChange={(color) => setOverlay(o.id, { color }, `ovColor${o.id}`)} />}
      <Slider label="Kejelasan" value={o.opacity} min={0.1} max={1} step={0.01} onChange={(opacity) => setOverlay(o.id, { opacity }, `ovOp${o.id}`)} />
      <Slider label="Mendatar" value={o.x} min={0} max={1} step={0.005} onChange={(x) => setOverlay(o.id, { x }, `ovX${o.id}`)} />
      <Slider label="Menegak" value={o.y} min={0} max={1} step={0.005} onChange={(y) => setOverlay(o.id, { y }, `ovY${o.id}`)} />
      <div className="ed-row">
        <label className="ed-row__lbl" htmlFor={startId}>
          Mulai (dtk)
        </label>
        <span className="qr-field">
          <input id={startId} type="number" min={0} step={0.1} value={secs(o.startMs)} onChange={(e) => setOverlay(o.id, { startMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) }, `ovStart${o.id}`)} />
        </span>
      </div>
      <SwitchRow label="Sampai akhir video" checked={o.endMs === null} onChange={(v) => setOverlay(o.id, { endMs: v ? null : Math.min(durationMs, o.startMs + 5000) })} />
      {o.endMs !== null && (
        <div className="ed-row">
          <label className="ed-row__lbl" htmlFor={endId}>
            Selesai (dtk)
          </label>
          <span className="qr-field">
            <input id={endId} type="number" min={0} step={0.1} value={secs(o.endMs)} onChange={(e) => setOverlay(o.id, { endMs: Math.max(o.startMs + 100, Math.round(Number(e.target.value) * 1000)) }, `ovEnd${o.id}`)} />
          </span>
        </div>
      )}
    </>
  )
}

export function OverlayPanel({ selectedId, onSelect, durationMs }: { selectedId: string | null; onSelect: (id: string | null) => void; durationMs: number }) {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const sel = project.overlays.find((o) => o.id === selectedId) ?? null

  const add = (o: Omit<Overlay, 'id' | 'startMs' | 'endMs'>) => {
    const full: Overlay = { ...o, id: crypto.randomUUID(), startMs: 0, endMs: null }
    useProject.getState().update({ overlays: [...project.overlays, full] })
    onSelect(full.id)
  }
  const addImage = async () => {
    try {
      const a = await window.api.sources.importMedia(project.id, 'image')
      if (a) add({ kind: 'image', text: '', assetId: a.id, x: 0.5, y: 0.12, size: 0.2, color: '#FFFFFF', opacity: 1 })
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  const remove = (id: string) => {
    useProject.getState().update({ overlays: project.overlays.filter((o) => o.id !== id) })
    if (id === selectedId) onSelect(null)
  }

  return (
    <div className="ed-panel-body">
      <Section title="Overlay">
        <div className="card-actions">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => add({ kind: 'text', text: 'Teks', assetId: null, x: 0.5, y: 0.12, size: 0.05, color: '#FFFFFF', opacity: 1 })}>
            <Icon name="type" size="sm" />
            Tambah teks
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void addImage()}>
            <Icon name="image" size="sm" />
            Tambah gambar
          </button>
        </div>
        {project.overlays.length === 0 && <p className="pn-note">Belum ada overlay. Gunakan untuk logo, nama channel, atau tulisan singkat.</p>}
        <ul className="ed-order">
          {project.overlays.map((o) => (
            <li key={o.id} className="ed-row">
              <button type="button" className={o.id === selectedId ? 'qr-btn qr-btn--secondary qr-btn--sm ed-row__name' : 'qr-btn qr-btn--ghost qr-btn--sm ed-row__name'} aria-pressed={o.id === selectedId} onClick={() => onSelect(o.id)}>
                {o.kind === 'text' ? o.text || '(kosong)' : (o.assetId && assets[o.assetId]?.name) || 'Gambar'}
              </button>
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label={`Hapus overlay ${o.kind === 'text' ? o.text : 'gambar'}`} onClick={() => remove(o.id)}>
                <Icon name="trash-2" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {sel && (
        <Section title="Properti">
          <OverlayForm key={sel.id} o={sel} durationMs={durationMs} />
        </Section>
      )}
    </div>
  )
}
