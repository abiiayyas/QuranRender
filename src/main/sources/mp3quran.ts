import { parseMp3Quran, type Mp3QuranAyahTiming, type ProviderTiming } from '@shared/timedSegments'
import type { Reciter } from '@shared/types'
import { cacheGet, cacheSet } from '../db'
import { getJson } from './net'

// mp3quran.net answers 301 to www; going there directly saves a round trip.
const API = 'https://www.mp3quran.net/api/v3'
const DAY = 86_400_000

interface Moshaf {
  id: number
  name: string
  rewaya_id: number
  server: string
  surah_list: string
}

interface ApiReciter {
  id: number
  name: string
  moshaf: Moshaf[]
}

/** Reciter plus the folder its `NNN.mp3` files live in. */
export interface Mp3QuranReciter extends Reciter {
  server: string
  moshafId: number
}

/** Hafs 'an 'Asim, the only riwayah whose text the app has. */
const HAFS = 1

export async function mp3quranReciters(): Promise<Mp3QuranReciter[]> {
  const key = 'mp3quran:reciters'
  const cached = cacheGet<Mp3QuranReciter[]>(key, DAY)
  if (cached) return cached
  const [list, reads] = await Promise.all([
    getJson<{ reciters: ApiReciter[] }>(`${API}/reciters?language=eng`),
    getJson<{ id: number }[]>(`${API}/ayat_timing/reads`)
  ])
  // A timing "read" id is the moshaf id.
  const timed = new Set(reads.map((r) => r.id))
  const out: Mp3QuranReciter[] = []
  for (const r of list.reciters) {
    for (const m of r.moshaf) {
      if (m.rewaya_id !== HAFS) continue
      out.push({
        id: `mp3quran:${r.id}:${m.id}`,
        provider: 'mp3quran',
        name: r.name.trim(),
        style: m.name.replace(/^.*? - /, '').trim(),
        surahs: m.surah_list.split(',').map(Number).filter((n) => n >= 1 && n <= 114),
        timed: timed.has(m.id),
        server: m.server.replace(/^http:/, 'https:').replace(/\/?$/, '/'),
        moshafId: m.id
      })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  cacheSet(key, out)
  return out
}

export const mp3quranAudioUrl = (r: Mp3QuranReciter, surah: number): string => `${r.server}${String(surah).padStart(3, '0')}.mp3`

export async function mp3quranTiming(r: Mp3QuranReciter, surah: number, signal: AbortSignal): Promise<ProviderTiming> {
  const list = await getJson<Mp3QuranAyahTiming[]>(`${API}/ayat_timing?surah=${surah}&read=${r.moshafId}`, signal)
  return parseMp3Quran(Array.isArray(list) ? list : [])
}
