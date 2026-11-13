import { t } from '@shared/i18n'
import { useEffect, useState } from 'react'
import type { ArabicScript, Segment, SurahInfo, Verse } from '@shared/types'

let surahs: Promise<SurahInfo[]> | null = null

/** The 114 surahs, fetched once per session. */
export function loadSurahs(): Promise<SurahInfo[]> {
  surahs ??= window.api.quran.surahs().catch((e) => {
    surahs = null
    throw e
  })
  return surahs
}

export function useSurahs(): SurahInfo[] {
  const [list, setList] = useState<SurahInfo[]>([])
  useEffect(() => {
    void loadSurahs().then(setList, () => setList([]))
  }, [])
  return list
}

export function rangeLabel(list: SurahInfo[], surah: number | null, from: number | null, to: number | null): string {
  if (!surah) return t('Surah belum dipilih')
  const name = list.find((s) => s.id === surah)?.nameLatin ?? t('Surah {n}', { n: surah })
  if (!from) return name
  return from === to || !to ? `${name} ${from}` : `${name} ${from}–${to}`
}

const verseCache = new Map<string, Promise<Verse[]>>()

/**
 * Verses (in `script`) for every ayah the segments show, plus the project range when there are no segments yet,
 * keyed `${surah}:${ayah}`. One request per surah span, cached for the session.
 */
export function useVerses(
  segments: ReadonlyArray<Pick<Segment, 'kind' | 'surah' | 'ayah'>>,
  script: ArabicScript,
  range?: { surah: number | null; from: number | null; to: number | null }
): Record<string, Verse> {
  const spans = new Map<number, [number, number]>()
  const add = (s: number, a: number) => {
    const cur = spans.get(s)
    spans.set(s, cur ? [Math.min(cur[0], a), Math.max(cur[1], a)] : [a, a])
  }
  for (const s of segments) if (s.kind === 'ayah') add(s.surah, s.ayah)
  if (range?.surah && range.from && range.to) {
    add(range.surah, range.from)
    add(range.surah, range.to)
  }
  const key = [script, ...[...spans].map(([s, [f, t]]) => `${s}:${f}-${t}`)].join('|')
  const [verses, setVerses] = useState<Record<string, Verse>>({})
  useEffect(() => {
    let live = true
    const jobs = [...spans].map(([s, [f, t]]) => {
      const k = `${script}|${s}:${f}-${t}`
      let p = verseCache.get(k)
      if (!p) {
        p = window.api.quran.verses(s, f, t, script)
        p.catch(() => verseCache.delete(k))
        verseCache.set(k, p)
      }
      return p
    })
    void Promise.all(jobs).then(
      (lists) => live && setVerses(Object.fromEntries(lists.flat().map((v) => [`${v.surah}:${v.ayah}`, v]))),
      () => live && setVerses({})
    )
    return () => {
      live = false
    }
    // `key` captures spans and script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return verses
}

/** Non-hook form of `useVerses`: verses for every ayah the segments show (plus 1:1 for a basmalah), same cache. */
export async function fetchVerses(segments: ReadonlyArray<Pick<Segment, 'kind' | 'surah' | 'ayah'>>, script: ArabicScript): Promise<Record<string, Verse>> {
  const spans = new Map<number, [number, number]>()
  const add = (s: number, a: number): void => {
    const cur = spans.get(s)
    spans.set(s, cur ? [Math.min(cur[0], a), Math.max(cur[1], a)] : [a, a])
  }
  for (const s of segments) {
    if (s.kind === 'ayah') add(s.surah, s.ayah)
    else if (s.kind === 'basmalah') add(1, 1)
  }
  const lists = await Promise.all(
    [...spans].map(([s, [f, t]]) => {
      const k = `${script}|${s}:${f}-${t}`
      let p = verseCache.get(k)
      if (!p) {
        p = window.api.quran.verses(s, f, t, script)
        p.catch(() => verseCache.delete(k))
        verseCache.set(k, p)
      }
      return p
    })
  )
  return Object.fromEntries(lists.flat().map((v) => [`${v.surah}:${v.ayah}`, v]))
}
