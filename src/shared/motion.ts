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
  { id: 'aurora', label: 'Cahaya lembut', hint: 'Warna yang mengalir pelan.' },
  { id: 'geometry', label: 'Geometri', hint: 'Pola garis geometris yang bergerak pelan.' },
  { id: 'particles', label: 'Partikel', hint: 'Debu cahaya yang melayang.' },
  { id: 'rays', label: 'Berkas sinar', hint: 'Sinar yang bergeser perlahan.' },
  { id: 'waves', label: 'Gelombang', hint: 'Lapisan gelombang yang bergerak.' }
]

export const DEFAULT_MOTION: MotionSpec = { type: 'aurora', colorA: '#0F3D2E', colorB: '#D4A017', speed: 1 }

/** What a video background does when it is shorter than the recitation. */
export type LoopMode = 'repeat' | 'bounce' | 'fade'

export const LOOP_MODES: { id: LoopMode; label: string; hint: string }[] = [
  { id: 'repeat', label: 'Ulang', hint: 'Kembali ke awal klip.' },
  { id: 'bounce', label: 'Bolak-balik', hint: 'Maju lalu mundur, tanpa loncatan.' },
  { id: 'fade', label: 'Pudar', hint: 'Memudar halus di sambungan.' }
]
