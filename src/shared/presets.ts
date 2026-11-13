import { msg } from './i18n'
import { DEFAULT_STYLE, type StyleSettings } from './style'
import type { Background } from './types'

/**
 * Built-in looks, converted from the old renderer's twelve templates (crates/qr-render/templates). Layout-only ideas
 * the composition does not have (split panels, side panels, word cards, gradient dimmers) became the nearest box or
 * position; colours that were tuned for a dimmed photo were pre-mixed so the plain colour background reads the same.
 */
export interface Preset {
  id: string
  name: string
  description: string
  style: StyleSettings
  /** `kind` and `assetId` are kept from the project when a preset is applied; colour, dim and blur come from here. */
  background: Background
}

const bg = (color: string, dim = 0.35): Background => ({ kind: 'color', color, assetId: null, dim, blur: 0 })
const style = (id: string, s: Partial<StyleSettings>): StyleSettings => ({ ...DEFAULT_STYLE, ...s, presetId: id })

export const PRESETS: Preset[] = [
  {
    id: 'hening',
    name: msg('Hening Grafit'),
    description: msg('Latar polos grafit pekat tanpa distraksi, untuk tilawah khusyuk.'),
    style: style('hening', {}),
    background: bg('#101114')
  },
  {
    id: 'besar',
    name: msg('Besar (Hafalan)'),
    description: msg('Teks ayat sangat besar di tengah layar tanpa terjemahan, untuk hafalan.'),
    style: style('besar', { arabicSize: 0.12, arabicColor: '#F4F5F7', inactiveOpacity: 0.5, showTranslation: false }),
    background: bg('#101114')
  },
  {
    id: 'subuh',
    name: msg('Subuh'),
    description: msg('Nada fajar yang lembut dengan terjemahan di bawah ayat.'),
    style: style('subuh', { arabicColor: '#F4F5F7', shadow: true, translationColor: '#E5E7EB' }),
    background: bg('#2A1F26', 0.55)
  },
  {
    id: 'senja',
    name: msg('Senja'),
    description: msg('Nada jingga temaram dengan sorotan kotak lembut pada kata yang dibaca.'),
    style: style('senja', {
      arabicColor: '#F4F5F7',
      highlight: 'box',
      highlightColor: '#101114',
      shadow: true,
      translationColor: '#E5E7EB',
      showReciter: true
    }),
    background: bg('#5A2A14', 0.65)
  },
  {
    id: 'madinah',
    name: msg('Madinah Hijau'),
    description: msg('Hijau zaitun malam dengan bingkai garis ganda keemasan.'),
    style: style('madinah', {
      arabicColor: '#E6C687',
      highlightColor: '#FFE9B0',
      shadow: true,
      translationColor: '#F4EFE0',
      maxWidth: 0.76,
      frame: true,
      frameColor: '#E6C687'
    }),
    background: bg('#1F2B1A')
  },
  {
    id: 'naskh-klasik',
    name: msg('Naskh Klasik'),
    description: msg('Kertas krem seperti halaman mushaf, teks gelap dan terjemahan berhuruf serif.'),
    style: style('naskh-klasik', {
      arabicSize: 0.082,
      arabicColor: '#1A1C20',
      highlightColor: '#000000',
      translationFont: 'Amiri',
      translationColor: '#2B2F36'
    }),
    background: bg('#EFEBDD', 0.2)
  },
  {
    id: 'terang',
    name: msg('Kertas Terang'),
    description: msg('Kertas gading, teks hitam pekat, sorotan garis bawah nila.'),
    style: style('terang', {
      arabicColor: '#1A1C20',
      highlight: 'underline',
      highlightColor: '#5B5FD6',
      translationColor: '#374151'
    }),
    background: bg('#F7F6F2', 0.2)
  },
  {
    id: 'kartu-apung',
    name: msg('Kartu Apung'),
    description: msg('Ayat dan terjemahan di dalam kartu translusen bersudut membulat.'),
    style: style('kartu-apung', {
      arabicSize: 0.082,
      arabicColor: '#F4F5F7',
      highlight: 'underline',
      highlightColor: '#FFFFFF',
      translationColor: '#E5E7EB',
      maxWidth: 0.72,
      boxColor: '#121418',
      boxOpacity: 0.62
    }),
    background: bg('#202329')
  },
  {
    id: 'editorial-split',
    name: msg('Editorial'),
    description: msg('Kartu grafit solid yang tegas dengan sorotan kotak pada kata yang dibaca.'),
    style: style('editorial-split', {
      arabicSize: 0.085,
      arabicColor: '#F4F5F7',
      highlight: 'box',
      highlightColor: '#FFFFFF',
      shadow: true,
      translationColor: '#E5E7EB',
      maxWidth: 0.7,
      boxColor: '#17191E',
      boxOpacity: 1
    }),
    background: bg('#1B1E26')
  },
  {
    id: 'kajian-side-panel',
    name: msg('Kajian'),
    description: msg('Teks ringkas di dalam panel gelap, cocok di atas video kajian. Nama surah tampil di atas.'),
    style: style('kajian-side-panel', {
      arabicSize: 0.07,
      arabicColor: '#F4F5F7',
      translationSize: 0.032,
      translationColor: '#E5E7EB',
      maxWidth: 0.6,
      boxColor: '#15171C',
      boxOpacity: 0.9,
      showSurahName: true
    }),
    background: bg('#0B0C0E', 0.2)
  },
  {
    id: 'siaran-lower-third',
    name: msg('Papan Siaran'),
    description: msg('Ayat dan terjemahan di sepertiga bawah pada pita gelap selebar layar; latar tetap terlihat di atasnya.'),
    style: style('siaran-lower-third', {
      arabicSize: 0.07,
      arabicColor: '#F4F5F7',
      translationSize: 0.032,
      translationColor: '#E5E7EB',
      position: 'bottom',
      maxWidth: 0.84,
      boxColor: '#060709',
      boxOpacity: 0.78,
      boxStyle: 'band'
    }),
    background: bg('#0B0C0E', 0)
  },
  {
    id: 'tadabbur-wbw',
    name: msg('Tadabbur Kosakata'),
    description: msg('Ayat di bagian atas dengan terjemahan di bawahnya dan sorotan kotak pada kata yang dibaca.'),
    style: style('tadabbur-wbw', {
      arabicSize: 0.085,
      arabicColor: '#F4F5F7',
      highlight: 'box',
      highlightColor: '#FFFFFF',
      shadow: true,
      translationColor: '#E5E7EB',
      position: 'top'
    }),
    background: bg('#0B0F19')
  }
]

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id)
