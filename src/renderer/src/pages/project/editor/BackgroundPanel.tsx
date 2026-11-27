import { useId, useState } from 'react'
import {
  DEFAULT_BG_TRANSITION_MS,
  MAX_BG_TRANSITION_MS,
  appendBackgroundClip,
  distributeClips,
  removeBackgroundClip,
  reorderBackgroundClip,
  type BackgroundClip
} from '@shared/background'
import { t } from '@shared/i18n'
import { DEFAULT_MOTION, LOOP_MODES, MOTION_TYPES, type LoopMode, type MotionSpec, type MotionType } from '@shared/motion'
import type { Asset } from '@shared/types'
import { useProject } from '../../../store/project'
import { toast } from '../../../store/app'
import { errorText } from '../../../lib/format'
import { Icon, Segmented } from '../../../components/ui'
import { BackgroundPicker } from './BackgroundPicker'
import { ColorRow, SelectRow, Section, setBackground, Slider } from './controls'

type Kind = 'color' | 'image' | 'video' | 'multi' | 'source' | 'motion'

export function BackgroundPanel({ durationMs }: { durationMs: number }) {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const bg = project.background
  const [pickerMode, setPickerMode] = useState<'single' | 'append' | null>(null)
  const loopLabel = useId()
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const media = bg.assetId ? assets[bg.assetId] : undefined
  const clips = bg.clips ?? []
  const motion = bg.motion ?? DEFAULT_MOTION
  const setMotion = (patch: Partial<MotionSpec>, key?: string) => setBackground({ motion: { ...motion, ...patch } }, key)

  const pick = async (kind: 'image' | 'video', append: boolean) => {
    try {
      const a = await window.api.sources.importMedia(project.id, kind)
      if (!a) return
      const mediaKind = a.kind === 'image' ? 'image' : 'video'
      if (append) {
        setBackground(appendBackgroundClip(bg, { id: a.id, kind: mediaKind }, durationMs, () => crypto.randomUUID()))
      } else {
        setBackground({ kind: mediaKind, assetId: a.id, clips: [] })
      }
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const onPickerPick = (asset: Asset) => {
    const mediaKind = asset.kind === 'image' ? 'image' : 'video'
    if (pickerMode === 'append') {
      setBackground(appendBackgroundClip(bg, { id: asset.id, kind: mediaKind }, durationMs, () => crypto.randomUUID()))
      toast('success', t('Latar ditambahkan.'))
    } else {
      setBackground({ kind: mediaKind, assetId: asset.id, clips: [] })
      toast('success', t('Latar sudah diganti.'))
    }
  }

  const switchKind = (kind: Kind) => {
    if (kind === 'motion' && !bg.motion) {
      setBackground({ kind, motion: DEFAULT_MOTION })
    } else if (kind === 'multi' && clips.length === 0 && (bg.kind === 'image' || bg.kind === 'video') && bg.assetId) {
      const seeded: BackgroundClip = { id: crypto.randomUUID(), kind: bg.kind, assetId: bg.assetId, startMs: 0, endMs: Math.max(1000, Math.round(durationMs)) }
      setBackground({ kind: 'multi', assetId: null, clips: [seeded], transitionMs: bg.transitionMs ?? DEFAULT_BG_TRANSITION_MS })
    } else {
      setBackground({ kind })
    }
  }

  const setClipTime = (id: string, edge: 'startMs' | 'endMs', sec: number) => {
    if (!Number.isFinite(sec)) return
    const ms = Math.max(0, Math.min(Math.round(durationMs), Math.round(sec * 1000)))
    const next = clips.map((c) => {
      if (c.id !== id) return c
      if (edge === 'startMs') return { ...c, startMs: Math.min(ms, Math.max(0, c.endMs - 200)) }
      return { ...c, endMs: Math.max(ms, c.startMs + 200) }
    })
    setBackground({ clips: next }, `bgClip:${id}:${edge}`)
  }

  const hasVideo = bg.kind === 'video' || (bg.kind === 'multi' && clips.some((c) => c.kind === 'video'))

  return (
    <div className="ed-panel-body">
      <Section title={t('Latar')}>
        <Segmented<Kind>
          ariaLabel={t('Jenis latar')}
          value={bg.kind}
          onChange={switchKind}
          options={[
            { value: 'color', label: t('Warna') },
            { value: 'image', label: t('Gambar'), disabled: !media && bg.kind !== 'image' },
            { value: 'video', label: t('Video'), disabled: !media && bg.kind !== 'video' },
            { value: 'multi', label: t('Multi') },
            { value: 'source', label: t('Sumber'), disabled: source?.kind !== 'video', title: source?.kind !== 'video' ? t('Sumber proyek ini bukan video') : undefined },
            { value: 'motion', label: t('Gerak') }
          ]}
        />
        {bg.kind === 'motion' ? (
          <>
            <SelectRow<MotionType> label={t('Jenis gerak')} value={motion.type} options={MOTION_TYPES.map((m) => ({ value: m.id, label: t(m.label) }))} onChange={(type) => setMotion({ type })} />
            <p className="pn-note">{t(MOTION_TYPES.find((m) => m.id === motion.type)?.hint ?? '')}</p>
            <ColorRow label={t('Warna 1')} value={motion.colorA} onChange={(colorA) => setMotion({ colorA }, 'motionA')} />
            <ColorRow label={t('Warna 2')} value={motion.colorB} onChange={(colorB) => setMotion({ colorB }, 'motionB')} />
            <Slider label={t('Kecepatan')} value={motion.speed} min={0.25} max={2} step={0.05} format={(v) => `${v.toFixed(2).replace(/0$/, '')}×`} onChange={(speed) => setMotion({ speed }, 'motionSpeed')} />
          </>
        ) : (
          <ColorRow label={t('Warna')} value={bg.color} onChange={(color) => setBackground({ color }, 'bgColor')} />
        )}

        {bg.kind === 'multi' ? (
          <div className="stack">
            <div className="card-actions">
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick('image', true)}>
                <Icon name="image" size="sm" />
                {t('Tambah gambar')}
              </button>
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick('video', true)}>
                <Icon name="film" size="sm" />
                {t('Tambah video')}
              </button>
              <button type="button" className="qr-btn qr-btn--primary qr-btn--sm" onClick={() => setPickerMode('append')}>
                <Icon name="search" size="sm" />
                {t('Stok / AI')}
              </button>
            </div>
            {clips.length === 0 ? (
              <p className="pn-note">{t('Tambahkan beberapa gambar atau video agar latar berganti otomatis sepanjang video.')}</p>
            ) : (
              <>
                <ol className="bg-clips">
                  {clips.map((c, i) => {
                    const a = assets[c.assetId]
                    return (
                      <li key={c.id} className="bg-clip">
                        <div className="bg-clip__top">
                          <span className="bg-clip__thumb">
                            {a?.kind === 'image' ? (
                              <img src={a.url} alt="" aria-hidden="true" />
                            ) : a?.kind === 'video' ? (
                              <video src={`${a.url}#t=0.1`} muted preload="metadata" tabIndex={-1} aria-hidden="true" />
                            ) : (
                              <Icon name="image" size="sm" />
                            )}
                          </span>
                          <span className="bg-clip__name" title={a?.name}>
                            <b>{`${i + 1}. ${a?.name ?? t('Berkas hilang')}`}</b>
                            <small className="muted">{c.kind === 'video' ? t('Video') : t('Gambar')}</small>
                          </span>
                          <span className="bg-clip__actions">
                            <button
                              type="button"
                              className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                              aria-label={t('Naikkan latar {n}', { n: i + 1 })}
                              disabled={i === 0}
                              onClick={() => setBackground({ clips: reorderBackgroundClip(clips, i, i - 1, durationMs) })}
                            >
                              <Icon name="chevron-up" size="sm" />
                            </button>
                            <button
                              type="button"
                              className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                              aria-label={t('Turunkan latar {n}', { n: i + 1 })}
                              disabled={i === clips.length - 1}
                              onClick={() => setBackground({ clips: reorderBackgroundClip(clips, i, i + 1, durationMs) })}
                            >
                              <Icon name="chevron-down" size="sm" />
                            </button>
                            <button
                              type="button"
                              className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                              aria-label={t('Hapus latar {n}', { n: i + 1 })}
                              onClick={() => setBackground(removeBackgroundClip(bg, c.id, durationMs))}
                            >
                              <Icon name="trash-2" size="sm" />
                            </button>
                          </span>
                        </div>
                        <div className="bg-clip__times">
                          <label className="qr-fieldset">
                            <span className="qr-label">{t('Mulai (dtk)')}</span>
                            <span className="qr-field">
                              <input
                                type="number"
                                min={0}
                                max={Math.ceil(durationMs / 1000)}
                                step={0.5}
                                value={Number((c.startMs / 1000).toFixed(1))}
                                onChange={(e) => setClipTime(c.id, 'startMs', Number(e.target.value))}
                              />
                            </span>
                          </label>
                          <label className="qr-fieldset">
                            <span className="qr-label">{t('Selesai (dtk)')}</span>
                            <span className="qr-field">
                              <input
                                type="number"
                                min={0}
                                max={Math.ceil(durationMs / 1000)}
                                step={0.5}
                                value={Number((c.endMs / 1000).toFixed(1))}
                                onChange={(e) => setClipTime(c.id, 'endMs', Number(e.target.value))}
                              />
                            </span>
                          </label>
                        </div>
                      </li>
                    )
                  })}
                </ol>
                <div className="card-actions">
                  <button
                    type="button"
                    className="qr-btn qr-btn--secondary qr-btn--sm"
                    onClick={() => setBackground({ clips: distributeClips(clips, durationMs) })}
                  >
                    {t('Bagi rata durasi')}
                  </button>
                </div>
                <Slider
                  label={t('Pudar antar latar')}
                  value={bg.transitionMs ?? DEFAULT_BG_TRANSITION_MS}
                  min={0}
                  max={MAX_BG_TRANSITION_MS}
                  step={100}
                  format={(v) => `${v} ${t('md')}`}
                  onChange={(transitionMs) => setBackground({ transitionMs }, 'bgTransition')}
                />
              </>
            )}
          </div>
        ) : (
          <>
            <div className="card-actions">
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick('image', false)}>
                <Icon name="image" size="sm" />
                {t('Pilih gambar')}
              </button>
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick('video', false)}>
                <Icon name="film" size="sm" />
                {t('Pilih video')}
              </button>
            </div>
            <div className="card-actions">
              <button type="button" className="qr-btn qr-btn--primary qr-btn--sm" onClick={() => setPickerMode('single')}>
                <Icon name="search" size="sm" />
                {t('Cari foto stok atau buat dengan AI')}
              </button>
            </div>
            {media && (bg.kind === 'image' || bg.kind === 'video') && (
              <div className="bg-card">
                <div className="bg-card__row">
                  <span className="bg-clip__thumb">
                    {media.kind === 'image' ? (
                      <img src={media.url} alt="" aria-hidden="true" />
                    ) : (
                      <video src={`${media.url}#t=0.1`} muted preload="metadata" tabIndex={-1} aria-hidden="true" />
                    )}
                  </span>
                  <span className="bg-card__name" title={media.name}>
                    {media.name}
                  </span>
                </div>
                <div className="card-actions">
                  <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick(media.kind === 'video' ? 'video' : 'image', false)}>
                    {t('Ganti')}
                  </button>
                  <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => setPickerMode('append')}>
                    <Icon name="plus" size="sm" />
                    {t('Tambah latar')}
                  </button>
                  <button
                    type="button"
                    className="qr-btn qr-btn--danger qr-btn--sm"
                    onClick={() => setBackground({ kind: 'color', assetId: null, clips: [] })}
                  >
                    <Icon name="trash-2" size="sm" />
                    {t('Hapus latar')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Section>
      <Section title={t('Penyesuaian')}>
        <Slider label={t('Gelapkan')} value={bg.dim} min={0} max={0.9} step={0.01} onChange={(dim) => setBackground({ dim }, 'bgDim')} />
        {bg.kind !== 'motion' && <Slider label={t('Buramkan')} value={bg.blur} min={0} max={40} step={1} format={(v) => `${v}`} onChange={(blur) => setBackground({ blur }, 'bgBlur')} />}
        {hasVideo && (
          <>
            <span className="qr-label" id={loopLabel}>
              {t('Jika video lebih pendek')}
            </span>
            <Segmented<LoopMode> labelledBy={loopLabel} value={bg.loop ?? 'repeat'} onChange={(loop) => setBackground({ loop })} options={LOOP_MODES.map((m) => ({ value: m.id, label: t(m.label), title: t(m.hint) }))} />
            <p className="pn-note">
              {t(LOOP_MODES.find((m) => m.id === (bg.loop ?? 'repeat'))?.hint ?? '')} {t('Video latar diputar tanpa suara sampai tilawah selesai.')}
            </p>
          </>
        )}
      </Section>
      {pickerMode && <BackgroundPicker onClose={() => setPickerMode(null)} onPick={onPickerPick} />}
    </div>
  )
}
