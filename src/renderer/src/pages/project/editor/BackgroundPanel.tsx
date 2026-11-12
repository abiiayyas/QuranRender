import { useProject } from '../../../store/project'
import { toast } from '../../../store/app'
import { errorText } from '../../../lib/format'
import { Icon, Segmented } from '../../../components/ui'
import { ColorRow, Section, setBackground, Slider } from './controls'

type Kind = 'color' | 'image' | 'video' | 'source'

export function BackgroundPanel() {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const bg = project.background
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const media = bg.assetId ? assets[bg.assetId] : undefined

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
          onChange={(kind) => setBackground({ kind })}
          options={[
            { value: 'color', label: 'Warna' },
            { value: 'image', label: 'Gambar', disabled: !media && bg.kind !== 'image' },
            { value: 'video', label: 'Video', disabled: !media && bg.kind !== 'video' },
            { value: 'source', label: 'Sumber', disabled: source?.kind !== 'video', title: source?.kind !== 'video' ? 'Sumber proyek ini bukan video' : undefined }
          ]}
        />
        <ColorRow label="Warna" value={bg.color} onChange={(color) => setBackground({ color }, 'bgColor')} />
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
        {media && <p className="pn-note">Berkas: {media.name}</p>}
      </Section>
      <Section title="Penyesuaian">
        <Slider label="Gelapkan" value={bg.dim} min={0} max={0.9} step={0.01} onChange={(dim) => setBackground({ dim }, 'bgDim')} />
        <Slider label="Buramkan" value={bg.blur} min={0} max={40} step={1} format={(v) => `${v}`} onChange={(blur) => setBackground({ blur }, 'bgBlur')} />
        <p className="pn-note">Video latar diputar tanpa suara dan diulang sampai tilawah selesai.</p>
      </Section>
    </div>
  )
}
