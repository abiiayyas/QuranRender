import { useMemo, useState } from 'react'
import type { Asset } from '@shared/types'
import { Segmented, Sheet } from '../../../components/ui'
import { toast } from '../../../store/app'
import { useProject } from '../../../store/project'
import { AiTab } from './BackgroundPickerAi'
import { StockTab } from './BackgroundPickerStock'

type Tab = 'stock' | 'ai'

/** Stock and AI pictures already in the project, so nothing is downloaded or generated twice. */
function ProjectPictures({ onUse }: { onUse: (asset: Asset) => void }) {
  const assets = useProject((s) => s.assets)
  const current = useProject((s) => s.project!.background.assetId)
  const list = useMemo(
    () =>
      Object.values(assets)
        .filter((a) => (a.source === 'stock' || a.source === 'ai') && (a.kind === 'image' || a.kind === 'video'))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12),
    [assets]
  )
  if (list.length === 0) return null
  return (
    <section className="bp-existing" aria-labelledby="bp-existing-title">
      <h3 className="qr-label" id="bp-existing-title">
        Sudah ada di proyek
      </h3>
      <ul className="bp-strip">
        {list.map((a) => {
          const credit = typeof a.meta.credit === 'string' ? a.meta.credit : a.source === 'ai' ? 'Gambar AI' : a.name
          return (
            <li key={a.id}>
              <button type="button" className="bp-strip__item" aria-pressed={a.id === current} aria-label={`Pakai ${credit} sebagai latar`} title={credit} onClick={() => onUse(a)}>
                {a.kind === 'image' ? <img src={a.url} alt="" aria-hidden="true" loading="lazy" decoding="async" /> : <video src={`${a.url}#t=0.1`} muted preload="metadata" tabIndex={-1} aria-hidden="true" />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Pick a background from stock photos and videos, or make one with AI. */
export function BackgroundPicker({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('stock')

  const use = (asset: Asset) => {
    const cur = useProject.getState().project
    if (!cur) return
    useProject.getState().update({ background: { ...cur.background, kind: asset.kind === 'image' ? 'image' : 'video', assetId: asset.id } })
    toast('success', 'Latar sudah diganti.')
    onClose()
  }

  return (
    <Sheet
      title="Cari latar"
      size="lg"
      onClose={onClose}
      footer={
        <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <div className="bp">
        <Segmented<Tab>
          ariaLabel="Sumber latar"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'stock', label: 'Foto & video stok' },
            { value: 'ai', label: 'Buat dengan AI' }
          ]}
        />
        {/* Both stay mounted: switching tabs must not lose a search or a job being followed. */}
        <div hidden={tab !== 'stock'}>
          <StockTab onUse={use} />
        </div>
        <div hidden={tab !== 'ai'}>
          <AiTab onUse={use} />
        </div>
        <ProjectPictures onUse={use} />
      </div>
    </Sheet>
  )
}
