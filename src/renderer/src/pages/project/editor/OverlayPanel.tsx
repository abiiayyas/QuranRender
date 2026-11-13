import { useId } from 'react'
import { msg, t } from '@shared/i18n'
import { CTA_DEFAULT_TEXT, ctaDefaultText } from '@shared/overlay'
import { PROMPT_DEFAULTS, PROMPT_MIN_SHOW_MS } from '@shared/subscribe'
import type { Aspect, Overlay } from '@shared/types'
import { SAFE_AREA } from '@video/common'
import { Icon, Segmented } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { toast } from '../../../store/app'
import { useProject } from '../../../store/project'
import { ColorRow, overlayName, Section, setOverlay, Slider, SwitchRow } from './controls'
import { PlacementControl } from './PlacementControl'

const secs = (ms: number): string => (ms / 1000).toFixed(1)

/** Slider range and label for `Overlay.size`, which means something different per kind. */
const SIZE_CONTROL: Record<Overlay['kind'], { label: string; min: number; max: number; step: number; format?: (v: number) => string }> = {
  text: { label: msg('Ukuran'), min: 0.02, max: 0.3, step: 0.005 },
  image: { label: msg('Lebar'), min: 0.02, max: 1, step: 0.005 },
  qari: { label: msg('Ukuran'), min: 0.02, max: 0.08, step: 0.002 },
  cta: { label: msg('Ukuran'), min: 0.015, max: 0.07, step: 0.002 },
  progress: { label: msg('Tebal'), min: 0.002, max: 0.02, step: 0.001, format: (v) => `${(v * 100).toFixed(1)}%` },
  visualizer: { label: msg('Tinggi'), min: 0.02, max: 0.25, step: 0.005 },
  prompt: { label: msg('Ukuran'), min: 0.02, max: 0.07, step: 0.002 }
}

const COLOR_LABEL: Partial<Record<Overlay['kind'], string>> = {
  qari: msg('Warna aksen'),
  cta: msg('Warna latar'),
  text: msg('Warna'),
  progress: msg('Warna'),
  visualizer: msg('Warna'),
  prompt: msg('Warna tombol')
}

/** Button colours of the subscribe and follow prompts: plain red and blue, not a platform's brand colours. */
const PROMPT_COLOR = { subscribe: '#D93025', follow: '#2D6CDF' } as const

/**
 * Type size (fraction of canvas width) and distance above the bottom safe edge, per aspect: the same width fraction reads
 * very differently on a 1920 px wide frame, and a wide frame is short, so its two bottom labels need more room apart.
 */
const LABEL_LAYOUT: Record<Aspect, { qari: { size: number; up: number }; cta: { size: number; up: number } }> = {
  '9:16': { qari: { size: 0.04, up: 0.07 }, cta: { size: 0.036, up: 0.17 } },
  '1:1': { qari: { size: 0.034, up: 0.08 }, cta: { size: 0.03, up: 0.2 } },
  '16:9': { qari: { size: 0.02, up: 0.085 }, cta: { size: 0.02, up: 0.2 } }
}

function OverlayForm({ o, durationMs }: { o: Overlay; durationMs: number }) {
  const startId = useId()
  const endId = useId()
  const textId = useId()
  const reciter = useProject((s) => s.project!.reciter)
  const size = SIZE_CONTROL[o.kind]
  const hasText = o.kind === 'text' || o.kind === 'cta' || o.kind === 'prompt'
  const cycle = o.cycle ?? PROMPT_DEFAULTS
  return (
    <>
      {hasText && (
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={textId}>
            {o.kind === 'prompt' ? t('Nama akun (opsional)') : t('Teks')}
          </label>
          <span className="qr-field">
            <input
              id={textId}
              value={o.text}
              maxLength={o.kind === 'cta' ? 60 : undefined}
              placeholder={o.kind === 'cta' ? ctaDefaultText() : o.kind === 'prompt' ? '@namakanal' : undefined}
              onChange={(e) => setOverlay(o.id, { text: e.target.value }, `ovText${o.id}`)}
            />
          </span>
        </div>
      )}
      {o.kind === 'qari' && (
        <p className="pn-note">{reciter.trim() ? t('Nama qari dan surah diambil dari proyek ini.') : t('Nama qari belum diisi, jadi overlay ini belum tampil. Silakan isi di langkah 1 Sumber.')}</p>
      )}
      {o.kind === 'visualizer' && (
        <>
          <div className="qr-fieldset">
            <span className="qr-label" id={`${startId}-var`}>
              {t('Gaya')}
            </span>
            <Segmented
              labelledBy={`${startId}-var`}
              value={o.variant ?? 'bars'}
              onChange={(variant) => setOverlay(o.id, { variant })}
              options={[
                { value: 'bars', label: t('Batang') },
                { value: 'wave', label: t('Gelombang') }
              ]}
            />
          </div>
          <p className="pn-note">{t('Bergerak mengikuti suara tilawah. Dihitung sekali dari audio sumber, jadi pratinjau dan ekspor sama.')}</p>
        </>
      )}
      {o.kind === 'prompt' && (
        <>
          <div className="qr-fieldset">
            <span className="qr-label" id={`${startId}-prompt`}>
              {t('Jenis')}
            </span>
            <Segmented
              labelledBy={`${startId}-prompt`}
              value={o.variant === 'follow' ? 'follow' : 'subscribe'}
              onChange={(variant) => {
                // Follow the default colour along, but keep a colour the user chose themselves.
                const wasDefault = o.color === PROMPT_COLOR[o.variant === 'follow' ? 'follow' : 'subscribe']
                setOverlay(o.id, wasDefault ? { variant, color: PROMPT_COLOR[variant] } : { variant })
              }}
              options={[
                { value: 'subscribe', label: 'Subscribe' },
                { value: 'follow', label: 'Follow' }
              ]}
            />
          </div>
          <Slider label={t('Muncul tiap')} value={cycle.everyMs / 1000} min={10} max={300} step={5} format={(v) => `${v} ${t('dtk')}`} onChange={(v) => setOverlay(o.id, { cycle: { ...cycle, everyMs: v * 1000 } }, `ovEvery${o.id}`)} />
          <Slider label={t('Lama tampil')} value={cycle.showMs / 1000} min={PROMPT_MIN_SHOW_MS / 1000} max={20} step={0.5} format={(v) => `${v} ${t('dtk')}`} onChange={(v) => setOverlay(o.id, { cycle: { ...cycle, showMs: v * 1000 } }, `ovShow${o.id}`)} />
          <p className="pn-note">{t('Tombol muncul pada waktu Mulai, ditekan, lalu hilang, dan muncul lagi sesuai jeda. Berhenti di waktu Selesai.')}</p>
        </>
      )}
      {o.kind === 'progress' && <p className="pn-note">{t('Bilah terisi sepanjang masa tayang overlay ini. Atur Mulai dan Selesai untuk menentukannya.')}</p>}
      <Slider label={t(size.label)} value={o.size} min={size.min} max={size.max} step={size.step} format={size.format} onChange={(v) => setOverlay(o.id, { size: v }, `ovSize${o.id}`)} />
      {o.kind !== 'image' && <ColorRow label={t(COLOR_LABEL[o.kind] ?? 'Warna')} value={o.color} onChange={(color) => setOverlay(o.id, { color }, `ovColor${o.id}`)} />}
      <Slider label={t('Kejelasan')} value={o.opacity} min={0.1} max={1} step={0.01} onChange={(opacity) => setOverlay(o.id, { opacity }, `ovOp${o.id}`)} />
      {o.kind !== 'progress' && <PlacementControl o={o} />}
      {o.kind !== 'progress' && <Slider label={t('Mendatar')} value={o.x} min={0} max={1} step={0.005} onChange={(x) => setOverlay(o.id, { x }, `ovX${o.id}`)} />}
      <Slider label={t('Menegak')} value={o.y} min={0} max={1} step={0.005} onChange={(y) => setOverlay(o.id, { y }, `ovY${o.id}`)} />
      <div className="ed-row">
        <label className="ed-row__lbl" htmlFor={startId}>
          {t('Mulai (dtk)')}
        </label>
        <span className="qr-field">
          <input id={startId} type="number" min={0} step={0.1} value={secs(o.startMs)} onChange={(e) => setOverlay(o.id, { startMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) }, `ovStart${o.id}`)} />
        </span>
      </div>
      <SwitchRow label={t('Sampai akhir video')} checked={o.endMs === null} onChange={(v) => setOverlay(o.id, { endMs: v ? null : Math.min(durationMs, o.startMs + 5000) })} />
      {o.endMs !== null && (
        <div className="ed-row">
          <label className="ed-row__lbl" htmlFor={endId}>
            {t('Selesai (dtk)')}
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

  const safe = SAFE_AREA[project.aspect]
  const layout = LABEL_LAYOUT[project.aspect]
  const add = (o: Omit<Overlay, 'id' | 'startMs' | 'endMs'>, window: { startMs: number; endMs: number | null } = { startMs: 0, endMs: null }) => {
    const full: Overlay = { ...o, id: crypto.randomUUID(), ...window }
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
  // The placements sit just inside the safe area, so platform buttons do not cover them.
  const addQari = () => {
    const startMs = Math.min(500, Math.max(0, durationMs - 1000))
    const endMs = startMs + 6000
    add(
      { kind: 'qari', text: '', assetId: null, x: 0.5, y: 1 - safe.bottom - layout.qari.up, size: layout.qari.size, color: '#D4A017', opacity: 1 },
      { startMs, endMs: endMs >= durationMs ? null : endMs }
    )
  }
  const addProgress = () => add({ kind: 'progress', text: '', assetId: null, x: 0.5, y: 1 - safe.bottom, size: 0.006, color: '#D4A017', opacity: 0.9 })
  const addCta = () =>
    add(
      { kind: 'cta', text: CTA_DEFAULT_TEXT, assetId: null, x: 0.5, y: 1 - safe.bottom - layout.cta.up, size: layout.cta.size, color: '#D4A017', opacity: 1 },
      { startMs: Math.max(0, durationMs - 6000), endMs: null }
    )
  // Low in the frame, clear of the text block, inside the safe area.
  const addVisualizer = () =>
    add({ kind: 'visualizer', variant: 'bars', text: '', assetId: null, x: 0.5, y: 1 - safe.bottom - (project.aspect === '16:9' ? 0.12 : 0.1), size: 0.08, color: '#FFFFFF', opacity: 0.9 })
  const addPrompt = (variant: 'subscribe' | 'follow') =>
    add(
      { kind: 'prompt', variant, text: '', assetId: null, x: 0.5, y: safe.top + 0.07, size: layout.cta.size, color: PROMPT_COLOR[variant], opacity: 1, cycle: { ...PROMPT_DEFAULTS } },
      { startMs: Math.min(8000, Math.max(0, durationMs - PROMPT_DEFAULTS.showMs)), endMs: null }
    )
  const remove = (id: string) => {
    useProject.getState().update({ overlays: project.overlays.filter((o) => o.id !== id) })
    if (id === selectedId) onSelect(null)
  }

  return (
    <div className="ed-panel-body">
      <Section title={t('Overlay')}>
        <div className="card-actions">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => add({ kind: 'text', text: 'Teks', assetId: null, x: 0.5, y: 0.12, size: 0.05, color: '#FFFFFF', opacity: 1 })}>
            <Icon name="type" size="sm" />
            {t('Tambah teks')}
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void addImage()}>
            <Icon name="image" size="sm" />
            {t('Tambah gambar')}
          </button>
        </div>
        <div className="card-actions">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={addQari}>
            <Icon name="layout-template" size="sm" />
            {t('Nama qari')}
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={addProgress}>
            <Icon name="step-forward" size="sm" />
            {t('Kemajuan')}
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={addCta}>
            <Icon name="star" size="sm" />
            {t('Ajakan')}
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={addVisualizer}>
            <Icon name="audio-waveform" size="sm" />
            {t('Gelombang suara')}
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => addPrompt('subscribe')}>
            <Icon name="bell" size="sm" />
            Subscribe
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => addPrompt('follow')}>
            <Icon name="plus" size="sm" />
            Follow
          </button>
        </div>
        {project.overlays.length === 0 && <p className="pn-note">{t('Belum ada overlay. Gunakan untuk logo, nama channel, atau tulisan singkat.')}</p>}
        <ul className="ed-order">
          {project.overlays.map((o) => (
            <li key={o.id} className="ed-row">
              <button type="button" className={o.id === selectedId ? 'qr-btn qr-btn--secondary qr-btn--sm ed-row__name' : 'qr-btn qr-btn--ghost qr-btn--sm ed-row__name'} aria-pressed={o.id === selectedId} onClick={() => onSelect(o.id)}>
                {overlayName(o, o.assetId ? assets[o.assetId]?.name : undefined)}
              </button>
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label={t('Hapus overlay {name}', { name: overlayName(o, o.assetId ? assets[o.assetId]?.name : undefined) })} onClick={() => remove(o.id)}>
                <Icon name="trash-2" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {sel && (
        <Section title={t('Properti')}>
          <OverlayForm key={sel.id} o={sel} durationMs={durationMs} />
        </Section>
      )}
    </div>
  )
}
