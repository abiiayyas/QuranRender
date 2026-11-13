import { useId, useState } from 'react'
import { DEFAULT_MOTION, LOOP_MODES, MOTION_TYPES, type LoopMode, type MotionSpec, type MotionType } from '@shared/motion'
import { useProject } from '../../../store/project'
import { toast } from '../../../store/app'
import { errorText } from '../../../lib/format'
import { Icon, Segmented } from '../../../components/ui'
import { BackgroundPicker } from './BackgroundPicker'
import { ColorRow, SelectRow, Section, setBackground, Slider } from './controls'

type Kind = 'color' | 'image' | 'video' | 'source' | 'motion'

export function BackgroundPanel() {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const bg = project.background
  const [picker, setPicker] = useState(false)
  const loopLabel = useId()
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const media = bg.assetId ? assets[bg.assetId] : undefined
  const motion = bg.motion ?? DEFAULT_MOTION
  const setMotion = (patch: Partial<MotionSpec>, key?: string) => setBackground({ motion: { ...motion, ...patch } }, key)

  const pick = async (kind: 'image' | 'video') => {
    try {
      const a = await window.api.sources.importMedia(project.id, kind)
      if (a) setBackground({ kind: a.kind === 'image' ? 'image' : 'video', assetId: a.id })
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="ed-panel-body">
      <Section title="Latar">
        <Segmented<Kind>
          ariaLabel="Jenis latar"
          value={bg.kind}
          onChange={(kind) => setBackground(kind === 'motion' && !bg.motion ? { kind, motion: DEFAULT_MOTION } : { kind })}
          options={[
            { value: 'color', label: 'Warna' },
            { value: 'image', label: 'Gambar', disabled: !media && bg.kind !== 'image' },
            { value: 'video', label: 'Video', disabled: !media && bg.kind !== 'video' },
            { value: 'source', label: 'Sumber', disabled: source?.kind !== 'video', title: source?.kind !== 'video' ? 'Sumber proyek ini bukan video' : undefined },
            { value: 'motion', label: 'Gerak' }
          ]}
        />
        {bg.kind === 'motion' ? (
          <>
            <SelectRow<MotionType> label="Jenis gerak" value={motion.type} options={MOTION_TYPES.map((m) => ({ value: m.id, label: m.label }))} onChange={(type) => setMotion({ type })} />
            <p className="pn-note">{MOTION_TYPES.find((m) => m.id === motion.type)?.hint}</p>
            <ColorRow label="Warna 1" value={motion.colorA} onChange={(colorA) => setMotion({ colorA }, 'motionA')} />
            <ColorRow label="Warna 2" value={motion.colorB} onChange={(colorB) => setMotion({ colorB }, 'motionB')} />
            <Slider label="Kecepatan" value={motion.speed} min={0.25} max={2} step={0.05} format={(v) => `${v.toFixed(2).replace(/0$/, '')}×`} onChange={(speed) => setMotion({ speed }, 'motionSpeed')} />
          </>
        ) : (
          <ColorRow label="Warna" value={bg.color} onChange={(color) => setBackground({ color }, 'bgColor')} />
        )}
        <div className="card-actions">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick('image')}>
            <Icon name="image" size="sm" />
            Pilih gambar
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void pick('video')}>
            <Icon name="film" size="sm" />
            Pilih video
          </button>
        </div>
        <div>
          <button type="button" className="qr-btn qr-btn--primary qr-btn--sm" onClick={() => setPicker(true)}>
            <Icon name="search" size="sm" />
            Cari foto stok atau buat dengan AI
          </button>
        </div>
        {media && <p className="pn-note">Berkas: {media.name}</p>}
      </Section>
      <Section title="Penyesuaian">
        <Slider label="Gelapkan" value={bg.dim} min={0} max={0.9} step={0.01} onChange={(dim) => setBackground({ dim }, 'bgDim')} />
        {bg.kind !== 'motion' && <Slider label="Buramkan" value={bg.blur} min={0} max={40} step={1} format={(v) => `${v}`} onChange={(blur) => setBackground({ blur }, 'bgBlur')} />}
        {bg.kind === 'video' && (
          <>
            <span className="qr-label" id={loopLabel}>
              Jika video lebih pendek
            </span>
            <Segmented<LoopMode> labelledBy={loopLabel} value={bg.loop ?? 'repeat'} onChange={(loop) => setBackground({ loop })} options={LOOP_MODES.map((m) => ({ value: m.id, label: m.label, title: m.hint }))} />
            <p className="pn-note">{LOOP_MODES.find((m) => m.id === (bg.loop ?? 'repeat'))?.hint} Video latar diputar tanpa suara sampai tilawah selesai.</p>
          </>
        )}
      </Section>
      {picker && <BackgroundPicker onClose={() => setPicker(false)} />}
    </div>
  )
}
