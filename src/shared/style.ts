/**
 * Look of the video. Presets fill every field; the user then edits any of them in the Editor.
 * Sizes are fractions of the canvas short side, so 16:9, 9:16 and 1:1 keep the same text size at any resolution.
 */
export interface StyleSettings {
  presetId: string
  arabicSize: number
  arabicColor: string
  /** Karaoke: how the word being recited stands out. box: a soft rounded patch behind the word. */
  highlight: 'none' | 'color' | 'glow' | 'underline' | 'box'
  highlightColor: string
  /** Opacity of words not being recited (1 = no dimming). */
  inactiveOpacity: number
  translationFont: TranslationFont
  translationSize: number
  translationColor: string
  /** Vertical anchor of the text block. */
  position: 'top' | 'center' | 'bottom'
  /** Fraction of canvas width the text may use. */
  maxWidth: number
  shadow: boolean
  /** Box behind the text block (`#rrggbb`); `boxOpacity` 0 = no box. */
  boxColor: string
  boxOpacity: number
  /** card: rounded box around the text; band: full-width strip. */
  boxStyle: 'card' | 'band'
  /** Thin double-line frame inset from the canvas edge. */
  frame: boolean
  frameColor: string
  /** A hairline with a small ornament between the ayah and its translation (only while a translation is shown). */
  separator: boolean
  separatorColor: string
  /** Share of the text width the line spans. */
  separatorWidth: number
  showTranslation: boolean
  showSurahName: boolean
  showReciter: boolean
  showReference: boolean
  /** Fade between segments, ms. */
  fadeMs: number
}

export type TranslationFont = 'Inter' | 'Amiri'
export const TRANSLATION_FONTS: TranslationFont[] = ['Inter', 'Amiri']

/** Same values as the 'hening' preset. */
export const DEFAULT_STYLE: StyleSettings = {
  presetId: 'hening',
  arabicSize: 0.09,
  arabicColor: '#E5E7EB',
  highlight: 'color',
  highlightColor: '#FFFFFF',
  inactiveOpacity: 0.7,
  translationFont: 'Inter',
  translationSize: 0.038,
  translationColor: '#9CA3AF',
  position: 'center',
  maxWidth: 0.8,
  shadow: false,
  boxColor: '#000000',
  boxOpacity: 0,
  boxStyle: 'card',
  frame: false,
  frameColor: '#E6C687',
  separator: false,
  separatorColor: '#E6C687',
  separatorWidth: 0.6,
  showTranslation: true,
  showSurahName: false,
  showReciter: false,
  showReference: true,
  fadeMs: 300
}
