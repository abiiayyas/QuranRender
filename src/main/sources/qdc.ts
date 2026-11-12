import { parseQdc, type ProviderTiming, type QdcVerseTiming } from '@shared/timedSegments'
import type { Reciter } from '@shared/types'
import { cacheGet, cacheSet } from '../db'
import { getJson } from './net'

const API = 'https://api.qurancdn.com/api/qdc/audio/reciters'
const DAY = 86_400_000
const ALL_SURAHS = Array.from({ length: 114 }, (_, i) => i + 1)

interface ApiReciter {
  id: number
  name: string
  translated_name?: { name?: string }
  style?: { name?: string }
  qirat?: { name?: string }
}

export async function qdcReciters(): Promise<Reciter[]> {
  const key = 'qdc:reciters'
  const cached = cacheGet<Reciter[]>(key, DAY)
  if (cached) return cached
  const { reciters } = await getJson<{ reciters: ApiReciter[] }>(`${API}?locale=en`)
  const out = reciters
    .filter((r) => !r.qirat?.name || r.qirat.name === 'Hafs')
    .map(
      (r): Reciter => ({
        id: `qdc:${r.id}`,
        provider: 'qdc',
        name: (r.translated_name?.name ?? r.name).trim(),
        style: r.style?.name ?? '',
        // Every QDC recitation covers the whole mushaf, with word timings.
        surahs: ALL_SURAHS,
        timed: true
      })
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.style.localeCompare(b.style))
  cacheSet(key, out)
  return out
}

export async function qdcChapter(id: number, surah: number, signal: AbortSignal): Promise<{ url: string; timing: ProviderTiming }> {
  const { audio_files } = await getJson<{ audio_files: { audio_url: string; verse_timings?: QdcVerseTiming[] }[] }>(
    `${API}/${id}/audio_files?chapter=${surah}&segments=true`,
    signal
  )
  const f = audio_files?.[0]
  if (!f?.audio_url) throw new Error('Rekaman surah ini tidak tersedia untuk qari tersebut.')
  return { url: f.audio_url, timing: parseQdc(f.verse_timings ?? []) }
}
