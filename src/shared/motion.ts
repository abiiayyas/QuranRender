import { msg } from './i18n'

/** Motion backgrounds drawn by the Remotion composition: pure functions of the frame number, so preview and export agree. */
export type MotionType = 'aurora' | 'geometry' | 'particles' | 'rays' | 'waves'

export interface MotionSpec {
  type: MotionType
  colorA: string
  colorB: string
  /** 0.25..2; 1 is the calm default. */
  speed: number
}

export const MOTION_TYPES: { id: MotionType; label: string; hint: string }[] = [
  { id: 'aurora', label: msg('Cahaya lembut'), hint: msg('Warna yang mengalir pelan.') },
  { id: 'geometry', label: msg('Geometri'), hint: msg('Pola garis geometris yang bergerak pelan.') },
  { id: 'particles', label: msg('Partikel'), hint: msg('Debu cahaya yang melayang.') },
  { id: 'rays', label: msg('Berkas sinar'), hint: msg('Sinar yang bergeser perlahan.') },
  { id: 'waves', label: msg('Gelombang'), hint: msg('Lapisan gelombang yang bergerak.') }
]

export const DEFAULT_MOTION: MotionSpec = { type: 'aurora', colorA: '#0F3D2E', colorB: '#D4A017', speed: 1 }

/** What a video background does when it is shorter than the recitation. */
export type LoopMode = 'repeat' | 'bounce' | 'fade'

export const LOOP_MODES: { id: LoopMode; label: string; hint: string }[] = [
  { id: 'repeat', label: msg('Ulang'), hint: msg('Kembali ke awal klip.') },
  { id: 'bounce', label: msg('Bolak-balik'), hint: msg('Maju lalu mundur, tanpa loncatan.') },
  { id: 'fade', label: msg('Pudar'), hint: msg('Memudar halus di sambungan.') }
]
