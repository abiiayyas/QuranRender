import { PRESETS, type Preset } from '@shared/presets'
import { TRANSLATION_FONTS, type StyleSettings } from '@shared/style'
import { LookThumb } from '../../../components/LookThumb'
import { Segmented } from '../../../components/ui'
import { useProject } from '../../../store/project'
import { ColorRow, Section, SelectRow, setStyle, Slider, SwitchRow } from './controls'

const HIGHLIGHTS: { value: StyleSettings['highlight']; label: string }[] = [
  { value: 'none', label: 'Tanpa sorotan' },
  { value: 'color', label: 'Warna' },
  { value: 'glow', label: 'Cahaya' },
  { value: 'underline', label: 'Garis bawah' },
  { value: 'box', label: 'Kotak' }
]

function applyPreset(p: Preset): void {
  const cur = useProject.getState().project
  if (!cur) return
  // The user's chosen image/video stays; only the look comes from the preset.
  const { color, dim, blur } = p.background
  useProject.getState().update({ style: { ...p.style }, background: { ...cur.background, color, dim, blur } })
}

export function StylePanel() {
  const style = useProject((s) => s.project!.style)
  return (
    <div className="ed-panel-body">
      <Section title="Preset">
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === style.presetId ? 'preset-card is-selected' : 'preset-card'}
              aria-pressed={p.id === style.presetId}
              title={p.description}
              onClick={() => applyPreset(p)}
            >
              <LookThumb style={p.style} color={p.background.color} />
              <span className="preset-card__name">{p.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Teks Arab">
        <Slider label="Ukuran" value={style.arabicSize} min={0.03} max={0.16} step={0.002} format={(v) => (v * 1000).toFixed(0)} onChange={(v) => setStyle({ arabicSize: v }, 'arabicSize')} />
        <ColorRow label="Warna" value={style.arabicColor} onChange={(v) => setStyle({ arabicColor: v }, 'arabicColor')} />
        <Slider label="Lebar maks." value={style.maxWidth} min={0.4} max={1} step={0.01} onChange={(v) => setStyle({ maxWidth: v }, 'maxWidth')} />
        <SwitchRow label="Bayangan" checked={style.shadow} onChange={(v) => setStyle({ shadow: v })} />
        <div className="ed-row ed-row--wide">
          <span className="ed-row__lbl" id="ed-pos">
            Posisi
          </span>
          <Segmented
            labelledBy="ed-pos"
            value={style.position}
            onChange={(v) => setStyle({ position: v })}
            options={[
              { value: 'top', label: 'Atas' },
              { value: 'center', label: 'Tengah' },
              { value: 'bottom', label: 'Bawah' }
            ]}
          />
        </div>
      </Section>

      <Section title="Sorotan kata">
        <SelectRow label="Gaya" value={style.highlight} options={HIGHLIGHTS} onChange={(v) => setStyle({ highlight: v })} />
        <ColorRow label="Warna sorotan" value={style.highlightColor} onChange={(v) => setStyle({ highlightColor: v }, 'highlightColor')} />
        <Slider label="Kata lain" value={style.inactiveOpacity} min={0.2} max={1} step={0.01} onChange={(v) => setStyle({ inactiveOpacity: v }, 'inactiveOpacity')} />
        <p className="pn-note">Sorotan muncul pada segmen yang memiliki waktu per kata.</p>
      </Section>

      <Section title="Terjemahan">
        <SwitchRow label="Tampilkan" checked={style.showTranslation} onChange={(v) => setStyle({ showTranslation: v })} />
        <SelectRow
          label="Huruf"
          value={style.translationFont}
          options={TRANSLATION_FONTS.map((f) => ({ value: f, label: f === 'Inter' ? 'Inter (sans)' : 'Amiri (serif)' }))}
          onChange={(v) => setStyle({ translationFont: v })}
        />
        <Slider label="Ukuran" value={style.translationSize} min={0.015} max={0.07} step={0.001} format={(v) => (v * 1000).toFixed(0)} onChange={(v) => setStyle({ translationSize: v }, 'translationSize')} />
        <ColorRow label="Warna" value={style.translationColor} onChange={(v) => setStyle({ translationColor: v }, 'translationColor')} />
      </Section>

      <Section title="Kotak dan bingkai">
        <Slider label="Kotak" value={style.boxOpacity} min={0} max={1} step={0.01} format={(v) => (v === 0 ? 'Tidak ada' : `${Math.round(v * 100)}%`)} onChange={(v) => setStyle({ boxOpacity: v }, 'boxOpacity')} />
        <ColorRow label="Warna kotak" value={style.boxColor} onChange={(v) => setStyle({ boxColor: v }, 'boxColor')} />
        <div className="ed-row ed-row--wide">
          <span className="ed-row__lbl" id="ed-box">
            Bentuk
          </span>
          <Segmented
            labelledBy="ed-box"
            value={style.boxStyle}
            onChange={(v) => setStyle({ boxStyle: v })}
            options={[
              { value: 'card', label: 'Kartu' },
              { value: 'band', label: 'Pita' }
            ]}
          />
        </div>
        <SwitchRow label="Bingkai" checked={style.frame} onChange={(v) => setStyle({ frame: v })} />
        <ColorRow label="Warna bingkai" value={style.frameColor} onChange={(v) => setStyle({ frameColor: v }, 'frameColor')} />
      </Section>

      <Section title="Keterangan">
        <SwitchRow label="Nama surah" checked={style.showSurahName} onChange={(v) => setStyle({ showSurahName: v })} />
        <SwitchRow label="Nomor ayat" checked={style.showReference} onChange={(v) => setStyle({ showReference: v })} />
        <SwitchRow label="Nama qari" checked={style.showReciter} onChange={(v) => setStyle({ showReciter: v })} />
      </Section>

      <Section title="Transisi">
        <Slider label="Pudar" value={style.fadeMs} min={0} max={1000} step={10} format={(v) => `${v} md`} onChange={(v) => setStyle({ fadeMs: v }, 'fadeMs')} />
      </Section>
    </div>
  )
}
