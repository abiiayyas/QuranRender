import { msg } from './i18n'

/**
 * Background nature sounds bundled with the app (assets/ambient/<id>.m4a, 120 s seamless loops: see its SOURCES.md).
 * No music on purpose: some listeners avoid it with recitation, and nature sound is the safe choice for everyone.
 */
export type AmbientId = 'rain' | 'rain-thunder' | 'rain-window' | 'stream' | 'campfire' | 'crickets' | 'wind' | 'ocean' | 'night-hum'

export interface AmbientSound {
  id: AmbientId
  label: string
  note: string
}

export const AMBIENT_SOUNDS: AmbientSound[] = [
  { id: 'rain', label: msg('Hujan'), note: msg('Hujan sedang yang merata.') },
  { id: 'rain-window', label: msg('Hujan di jendela'), note: msg('Lebih lembut, dengan tetesan satu per satu.') },
  { id: 'rain-thunder', label: msg('Hujan dan petir'), note: msg('Hujan dengan guruh jauh yang datang sesekali.') },
  { id: 'stream', label: msg('Aliran sungai'), note: msg('Air yang mengalir pelan.') },
  { id: 'campfire', label: msg('Api unggun'), note: msg('Api yang berderak hangat.') },
  { id: 'crickets', label: msg('Jangkrik malam'), note: msg('Serangga malam yang bersahutan.') },
  { id: 'wind', label: msg('Angin pelan'), note: msg('Embusan angin yang naik dan turun perlahan.') },
  { id: 'ocean', label: msg('Ombak tenang'), note: msg('Ombak kecil yang datang dan pergi.') },
  { id: 'night-hum', label: msg('Dengung malam'), note: msg('Suara ruangan yang tenang, hampir tanpa warna.') }
]

export const isAmbientId = (v: unknown): v is AmbientId => AMBIENT_SOUNDS.some((s) => s.id === v)

export interface AmbientSettings {
  id: AmbientId
  /** How far under the reciter's voice the sound sits, in dB (negative). */
  levelDb: number
  /** Fade in at the start and out at the end, ms. */
  fadeMs: number
}

/** 24 dB under the voice: present when you listen for it, never in the way. */
export const AMBIENT_DEFAULT_LEVEL_DB = -24
export const AMBIENT_MIN_LEVEL_DB = -40
/** Louder than this makes it compete with the reciter; the panel warns above it. */
export const AMBIENT_SUGGESTED_MAX_DB = -18
/** Hard ceiling of the slider. */
export const AMBIENT_MAX_LEVEL_DB = -12
export const AMBIENT_DEFAULT_FADE_MS = 2000

export const defaultAmbient = (id: AmbientId): AmbientSettings => ({ id, levelDb: AMBIENT_DEFAULT_LEVEL_DB, fadeMs: AMBIENT_DEFAULT_FADE_MS })

/**
 * Linear volume for the sound: bring its own level (`soundDb`) to the voice's (`voiceDb`), then `levelDb` under it.
 * Capped at 1: the file cannot be made louder than it is, and a very loud voice just gets the loudest the file allows.
 */
export function ambientGain(voiceDb: number, soundDb: number, levelDb: number): number {
  return Math.min(1, 10 ** ((voiceDb - soundDb + levelDb) / 20))
}

/** 0..1 fade for the time `ms` in a video of `durationMs`: in at the start, out at the end, never longer than half the video each. */
export function ambientFade(ms: number, durationMs: number, fadeMs: number): number {
  const f = Math.min(Math.max(0, fadeMs), durationMs / 2)
  if (f === 0) return 1
  return Math.min(1, Math.max(0, ms / f), Math.max(0, (durationMs - ms) / f))
}
