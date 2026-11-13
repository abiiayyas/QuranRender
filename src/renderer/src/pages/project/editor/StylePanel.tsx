import { msg, t } from '@shared/i18n'
import { PRESETS, type Preset } from '@shared/presets'
import { TRANSLATION_FONTS, type StyleSettings } from '@shared/style'
import { LookThumb } from '../../../components/LookThumb'
import { Segmented } from '../../../components/ui'
import { useProject } from '../../../store/project'
import { ColorRow, Section, SelectRow, setStyle, Slider, SwitchRow } from './controls'

const HIGHLIGHTS: { value: StyleSettings['highlight']; label: string }[] = [
  { value: 'none', label: msg('Tanpa sorotan') },
  { value: 'color', label: msg('Warna') },
  { value: 'glow', label: msg('Cahaya') },
  { value: 'underline', label: msg('Garis bawah') },
  { value: 'box', label: msg('Kotak') }
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
      <Section title={t('Preset')}>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === style.presetId ? 'preset-card is-selected' : 'preset-card'}
              aria-pressed={p.id === style.presetId}
              title={t(p.description)}
              onClick={() => applyPreset(p)}
            >
              <LookThumb style={p.style} color={p.background.color} />
              <span className="preset-card__name">{t(p.name)}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('Teks Arab')}>
        <Slider label={t('Ukuran')} value={style.arabicSize} min={0.03} max={0.16} step={0.002} format={(v) => (v * 1000).toFixed(0)} onChange={(v) => setStyle({ arabicSize: v }, 'arabicSize')} />
        <ColorRow label={t('Warna')} value={style.arabicColor} onChange={(v) => setStyle({ arabicColor: v }, 'arabicColor')} />
        <Slider label={t('Lebar maks.')} value={style.maxWidth} min={0.4} max={1} step={0.01} onChange={(v) => setStyle({ maxWidth: v }, 'maxWidth')} />
        <SwitchRow label={t('Bayangan')} checked={style.shadow} onChange={(v) => setStyle({ shadow: v })} />
        <div className="ed-row ed-row--wide">
          <span className="ed-row__lbl" id="ed-pos">
            {t('Posisi')}
          </span>
          <Segmented
            labelledBy="ed-pos"
            value={style.position}
            onChange={(v) => setStyle({ position: v })}
            options={[
              { value: 'top', label: t('Atas') },
              { value: 'center', label: t('Tengah') },
              { value: 'bottom', label: t('Bawah') }
            ]}
          />
        </div>
      </Section>

      <Section title={t('Sorotan kata')}>
        <SelectRow label={t('Gaya')} value={style.highlight} options={HIGHLIGHTS.map((h) => ({ ...h, label: t(h.label) }))} onChange={(v) => setStyle({ highlight: v })} />
        <ColorRow label={t('Warna sorotan')} value={style.highlightColor} onChange={(v) => setStyle({ highlightColor: v }, 'highlightColor')} />
        <Slider label={t('Kata lain')} value={style.inactiveOpacity} min={0.2} max={1} step={0.01} onChange={(v) => setStyle({ inactiveOpacity: v }, 'inactiveOpacity')} />
        <p className="pn-note">{t('Sorotan muncul pada segmen yang memiliki waktu per kata.')}</p>
      </Section>

      <Section title={t('Terjemahan')}>
        <SwitchRow label={t('Tampilkan')} checked={style.showTranslation} onChange={(v) => setStyle({ showTranslation: v })} />
        <SelectRow
          label={t('Huruf')}
          value={style.translationFont}
          options={TRANSLATION_FONTS.map((f) => ({ value: f, label: f === 'Inter' ? 'Inter (sans)' : 'Amiri (serif)' }))}
          onChange={(v) => setStyle({ translationFont: v })}
        />
        <Slider label={t('Ukuran')} value={style.translationSize} min={0.015} max={0.07} step={0.001} format={(v) => (v * 1000).toFixed(0)} onChange={(v) => setStyle({ translationSize: v }, 'translationSize')} />
        <ColorRow label={t('Warna')} value={style.translationColor} onChange={(v) => setStyle({ translationColor: v }, 'translationColor')} />
      </Section>

      <Section title={t('Kotak dan bingkai')}>
        <Slider label={t('Kotak')} value={style.boxOpacity} min={0} max={1} step={0.01} format={(v) => (v === 0 ? t('Tidak ada') : `${Math.round(v * 100)}%`)} onChange={(v) => setStyle({ boxOpacity: v }, 'boxOpacity')} />
        <ColorRow label={t('Warna kotak')} value={style.boxColor} onChange={(v) => setStyle({ boxColor: v }, 'boxColor')} />
        <div className="ed-row ed-row--wide">
          <span className="ed-row__lbl" id="ed-box">
            {t('Bentuk')}
          </span>
          <Segmented
            labelledBy="ed-box"
            value={style.boxStyle}
            onChange={(v) => setStyle({ boxStyle: v })}
            options={[
              { value: 'card', label: t('Kartu') },
              { value: 'band', label: t('Pita') }
            ]}
          />
        </div>
        <SwitchRow label={t('Bingkai')} checked={style.frame} onChange={(v) => setStyle({ frame: v })} />
        <ColorRow label={t('Warna bingkai')} value={style.frameColor} onChange={(v) => setStyle({ frameColor: v }, 'frameColor')} />
      </Section>

      <Section title={t('Keterangan')}>
        <SwitchRow label={t('Nama surah')} checked={style.showSurahName} onChange={(v) => setStyle({ showSurahName: v })} />
        <SwitchRow label={t('Nomor ayat')} checked={style.showReference} onChange={(v) => setStyle({ showReference: v })} />
        <SwitchRow label={t('Nama qari')} checked={style.showReciter} onChange={(v) => setStyle({ showReciter: v })} />
      </Section>

      <Section title={t('Transisi')}>
        <Slider label={t('Pudar')} value={style.fadeMs} min={0} max={1000} step={10} format={(v) => `${v} ${t('md')}`} onChange={(v) => setStyle({ fadeMs: v }, 'fadeMs')} />
      </Section>
    </div>
  )
}
