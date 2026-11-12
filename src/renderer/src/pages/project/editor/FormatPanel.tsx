import type { Aspect } from '@shared/types'
import { Segmented } from '../../../components/ui'
import { useProject } from '../../../store/project'
import { Section } from './controls'

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '9:16', label: '9:16 Shorts/Reels' },
  { value: '16:9', label: '16:9 YouTube' },
  { value: '1:1', label: '1:1 Feed' }
]

export function FormatPanel({ guides, onGuides }: { guides: boolean; onGuides: (v: boolean) => void }) {
  const aspect = useProject((s) => s.project!.aspect)
  return (
    <div className="ed-panel-body">
      <Section title="Format video">
        <Segmented<Aspect> ariaLabel="Format video" value={aspect} onChange={(a) => useProject.getState().update({ aspect: a })} options={ASPECTS} />
        <p className="pn-note">Ukuran teks mengikuti sisi pendek bingkai, jadi tampilannya tetap seimbang di semua format.</p>
      </Section>
      <Section title="Bantuan">
        <label className="ed-row ed-row--switch">
          <span className="ed-row__lbl">Tampilkan area aman</span>
          <input type="checkbox" role="switch" className="qr-switch" checked={guides} onChange={(e) => onGuides(e.target.checked)} />
        </label>
        <p className="pn-note">Garis putus-putus menandai bagian yang bisa tertutup tombol dan keterangan aplikasi tempat video diputar. Tidak ikut diekspor.</p>
      </Section>
    </div>
  )
}
