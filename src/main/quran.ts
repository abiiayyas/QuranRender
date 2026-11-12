import { existsSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { ArabicScript, SurahInfo, Verse } from '@shared/types'
import { canonicalCount, toCanonicalSlots } from '@shared/verses'
import { cacheGet, cacheSet } from './db'
import { handle } from './ipc'
import { qpcFontsDir, quranDbPath } from './paths'

const OFFLINE = 'Teks Uthmani/QPC perlu internet saat pertama dipakai.'
const FONT_HOSTS = ['https://verses.quran.foundation', 'https://static.qurancdn.com']

let quranDb: Database.Database | null = null
const db = (): Database.Database =>
  (quranDb ??= new Database(quranDbPath(), { readonly: true, fileMustExist: true }))

let surahs: SurahInfo[] | null = null

/** Index = surah id - 1. */
export function surahList(): SurahInfo[] {
  surahs ??= db()
    .prepare(
      'SELECT id, name_latin AS nameLatin, name_ar AS nameArabic, meaning_id AS meaning, ayah_count AS ayahCount FROM surah ORDER BY id'
    )
    .all() as SurahInfo[]
  return surahs
}

export function surahInfo(id: number): SurahInfo {
  const info = surahList()[id - 1]
  if (!info) throw new Error(`Surah ${id} tidak ditemukan.`)
  return info
}

/** Canonical (Quran.com/QPC) word count of an ayah, offline. */
export function canonicalWordCount(surah: number, ayah: number): number {
  const row = db().prepare('SELECT word_count AS n FROM ayah WHERE surah_id = ? AND number = ?').get(surah, ayah) as
    | { n: number }
    | undefined
  if (!row) throw new Error(`Ayat ${surah}:${ayah} tidak ditemukan.`)
  return canonicalCount(surah, ayah, row.n)
}

/** Full Kemenag ayah text from the bundled dataset. */
export function kemenagAyahText(surah: number, ayah: number): string {
  const row = db().prepare('SELECT text FROM ayah WHERE surah_id = ? AND number = ?').get(surah, ayah) as
    | { text: string }
    | undefined
  if (!row) throw new Error(`Ayat ${surah}:${ayah} tidak ditemukan.`)
  return row.text
}

function kemenagVerses(surah: number, from: number, to: number): Verse[] {
  const rows = db()
    .prepare(
      'SELECT a.number AS ayah, w.text AS text FROM word w JOIN ayah a ON a.id = w.ayah_id WHERE a.surah_id = ? AND a.number BETWEEN ? AND ? ORDER BY a.number, w.idx'
    )
    .all(surah, from, to) as { ayah: number; text: string }[]
  const byAyah = new Map<number, string[]>()
  for (const r of rows) {
    const words = byAyah.get(r.ayah)
    if (words) words.push(r.text)
    else byAyah.set(r.ayah, [r.text])
  }
  return [...byAyah].map(([ayah, words]) => ({ surah, ayah, words: toCanonicalSlots(surah, ayah, words) }))
}

/** One cached Quran.com chapter: both scripts come from the same response. */
interface QdcAyah {
  ayah: number
  page: number
  uthmani: string[]
  qpc: string[]
  end: string
}

interface QdcWord {
  char_type_name: string
  text_uthmani: string
  code_v2: string
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new Error(OFFLINE)
  }
  if (!res.ok) throw new Error(`${OFFLINE} (HTTP ${res.status})`)
  return (await res.json()) as T
}

async function chapter(surah: number): Promise<QdcAyah[]> {
  const key = `qurancom:v4:chapter:${surah}`
  const cached = cacheGet<QdcAyah[]>(key)
  if (cached) return cached
  const url = `https://api.quran.com/api/v4/verses/by_chapter/${surah}?words=true&word_fields=text_uthmani,code_v2&fields=page_number&per_page=300`
  const data = await fetchJson<{ verses: { verse_number: number; page_number: number; words: QdcWord[] }[] }>(url)
  const ayahs = data.verses.map((v) => {
    const words = v.words.filter((w) => w.char_type_name === 'word')
    return {
      ayah: v.verse_number,
      page: v.page_number,
      uthmani: words.map((w) => w.text_uthmani),
      qpc: words.map((w) => w.code_v2),
      end: v.words.find((w) => w.char_type_name === 'end')?.code_v2 ?? ''
    }
  })
  if (ayahs.length !== surahInfo(surah).ayahCount) throw new Error(`Data Quran.com untuk surah ${surah} tidak lengkap.`)
  cacheSet(key, ayahs)
  return ayahs
}

const pendingFonts = new Map<string, Promise<void>>()

/** Downloads a font into qpcFontsDir() once; concurrent callers share the download. */
function ensureFont(file: string, path: string): Promise<void> {
  const dest = join(qpcFontsDir(), file)
  if (existsSync(dest)) return Promise.resolve()
  let pending = pendingFonts.get(file)
  if (!pending) {
    pending = downloadFont(dest, path).finally(() => pendingFonts.delete(file))
    pendingFonts.set(file, pending)
  }
  return pending
}

async function downloadFont(dest: string, path: string): Promise<void> {
  let lastError: unknown
  for (const host of FONT_HOSTS) {
    const tmp = `${dest}.${process.pid}.tmp`
    try {
      const res = await fetch(host + path, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await writeFile(tmp, Buffer.from(await res.arrayBuffer()))
      await rename(tmp, dest)
      return
    } catch (e) {
      lastError = e
      await rm(tmp, { force: true })
    }
  }
  throw new Error(`${OFFLINE} (${lastError instanceof Error ? lastError.message : String(lastError)})`)
}

export async function getVerses(surah: number, from: number, to: number, script: ArabicScript): Promise<Verse[]> {
  if (script === 'kemenag') return kemenagVerses(surah, from, to)
  const ayahs = (await chapter(surah)).filter((a) => a.ayah >= from && a.ayah <= to)
  if (script === 'uthmani') {
    await ensureFont('uthmani.woff2', '/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2')
    return ayahs.map((a) => ({ surah, ayah: a.ayah, words: a.uthmani }))
  }
  const pages = [...new Set(ayahs.map((a) => a.page))]
  await Promise.all(pages.map((p) => ensureFont(`p${p}.woff2`, `/fonts/quran/hafs/v2/woff2/p${p}.woff2`)))
  return ayahs.map((a) => ({ surah, ayah: a.ayah, words: a.qpc, page: a.page, end: a.end }))
}

export function registerQuranIpc(): void {
  handle('quran', 'surahs', () => surahList())
  handle('quran', 'verses', (surah, from, to, script) => getVerses(surah, from, to, script))
}
