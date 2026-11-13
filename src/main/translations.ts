import { t } from '@shared/i18n'
import Database from 'better-sqlite3'
import { cleanTranslation, KEMENAG } from '@shared/translation'
import type { Edition, Job } from '@shared/types'
import { cacheGet, cacheSet, getDb } from './db'
import { startJob } from './jobs'
import { getJob } from './repo'
import { quranDbPath } from './paths'

const API = 'https://api.quran.com/api/v4'
const DAY_MS = 86_400_000

let quranDb: Database.Database | null = null
function bundledDb(): Database.Database {
  quranDb ??= new Database(quranDbPath(), { readonly: true, fileMustExist: true })
  return quranDb
}

/** Quran.com gives language names; edition ids and the isti'adzah text need ISO codes. */
const LANGUAGE_CODES: Record<string, string> = {
  albanian: 'sq', amazigh: 'ber', amharic: 'am', assamese: 'as', azeri: 'az', bambara: 'bm', bengali: 'bn', bosnian: 'bs',
  bulgarian: 'bg', 'central khmer': 'km', chechen: 'ce', chinese: 'zh', czech: 'cs', dari: 'prs', divehi: 'dv', dutch: 'nl',
  english: 'en', finnish: 'fi', french: 'fr', ganda: 'lg', german: 'de', gujarati: 'gu', hausa: 'ha', hebrew: 'he', hindi: 'hi',
  indonesian: 'id', italian: 'it', japanese: 'ja', kannada: 'kn', kazakh: 'kk', kinyarwanda: 'rw', korean: 'ko', kurdish: 'ku',
  malay: 'ms', malayalam: 'ml', maranao: 'mrw', marathi: 'mr', nepali: 'ne', norwegian: 'no', oromo: 'om', pashto: 'ps',
  persian: 'fa', polish: 'pl', portuguese: 'pt', romanian: 'ro', russian: 'ru', sindhi: 'sd', sinhala: 'si', somali: 'so',
  spanish: 'es', swahili: 'sw', swedish: 'sv', tagalog: 'tl', tajik: 'tg', tamil: 'ta', tatar: 'tt', telugu: 'te', thai: 'th',
  turkish: 'tr', uighur: 'ug', ukrainian: 'uk', urdu: 'ur', uzbek: 'uz', vietnamese: 'vi', yoruba: 'yo'
}

function languageCode(name: string): string {
  // Some names list variants: "divehi, dhivehi, maldivian".
  const first = name.toLowerCase().split(',')[0].trim()
  return LANGUAGE_CODES[first] ?? (first.replace(/[^a-z]/g, '') || 'xx')
}

interface CatalogItem {
  id: number
  name: string
  author_name: string
  language_name: string
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } }).catch((e: Error) => {
    if (e.name === 'AbortError') throw e
    throw new Error(t('Quran.com tidak bisa dihubungi. Periksa koneksi internet lalu coba lagi.'))
  })
  if (!res.ok) throw new Error(t('Quran.com menolak permintaan ({status}). Silakan coba lagi nanti.', { status: res.status }))
  return (await res.json()) as T
}

/** The Quran.com catalog, cached for a day; a stale copy (or nothing) when offline. */
async function remoteCatalog(): Promise<Edition[]> {
  let items = cacheGet<CatalogItem[]>('qc:translations', DAY_MS)
  if (!items) {
    try {
      items = (await getJson<{ translations: CatalogItem[] }>(`${API}/resources/translations`)).translations
      cacheSet('qc:translations', items)
    } catch {
      items = cacheGet<CatalogItem[]>('qc:translations') ?? []
    }
  }
  return items.map((t) => {
    const language = languageCode(t.language_name)
    return { id: `${language}.qdc${t.id}`, language, name: t.name, author: t.author_name ?? '', installed: false, bundled: false }
  })
}

function kemenagEdition(): Edition {
  const row = bundledDb().prepare('SELECT language, name, translator FROM translation_edition WHERE key = ?').get(KEMENAG) as
    | { language: string; name: string; translator: string }
    | undefined
  return {
    id: KEMENAG,
    language: row?.language ?? 'id',
    name: row?.name ?? 'Terjemahan Kemenag RI',
    author: row?.translator ?? 'Kementerian Agama RI',
    installed: true,
    bundled: true
  }
}

function installedRows(): Edition[] {
  const rows = getDb().prepare('SELECT id, language, name, author FROM editions ORDER BY name').all() as Omit<Edition, 'installed' | 'bundled'>[]
  return rows.map((r) => ({ ...r, installed: true, bundled: false }))
}

/** Bundled Kemenag first, then installed editions, then the rest of the catalog. */
export async function listEditions(): Promise<Edition[]> {
  const installed = installedRows()
  const have = new Set(installed.map((e) => e.id))
  const remote = (await remoteCatalog()).filter((e) => !have.has(e.id))
  return [kemenagEdition(), ...installed, ...remote]
}

const installing = new Map<string, string>()

export function installEdition(editionId: string): Job {
  const running = installing.get(editionId)
  if (running) return getJob(running)
  const rid = Number(/\.qdc(\d+)$/.exec(editionId)?.[1] ?? NaN)
  if (editionId === KEMENAG || !Number.isInteger(rid)) throw new Error(t('Edisi ini tidak bisa dipasang dari Quran.com.'))
  const job = startJob(null, 'translate', 'net', async (ctx) => {
    try {
      const meta = (await remoteCatalog()).find((e) => e.id === editionId)
      if (!meta) throw new Error(t('Edisi ini tidak ada di katalog Quran.com.'))
      ctx.progress(0.05, `Mengunduh ${meta.name}`)
      const data = await getJson<{ translations: { verse_key?: string; text: string }[] }>(
        `${API}/quran/translations/${rid}?fields=verse_key`,
        ctx.signal
      )
      const verses = data.translations ?? []
      if (verses.length === 0) throw new Error(t('{name} belum menyediakan teks lengkap di Quran.com. Silakan pilih edisi lain.', { name: meta.name }))
      ctx.progress(0.7, t('Menyimpan teks'))
      const rows: [number, number, string][] = []
      for (const v of verses) {
        const m = /^(\d+):(\d+)$/.exec(v.verse_key ?? '')
        const text = cleanTranslation(v.text ?? '')
        if (m && text) rows.push([Number(m[1]), Number(m[2]), text])
      }
      if (rows.length < 6000) throw new Error(t('Teks {name} dari Quran.com tidak lengkap ({n} ayat). Silakan coba lagi nanti.', { name: meta.name, n: rows.length }))
      const db = getDb()
      const insert = db.prepare('INSERT INTO edition_text (edition, surah, ayah, text) VALUES (?, ?, ?, ?)')
      db.transaction(() => {
        db.prepare('DELETE FROM editions WHERE id = ?').run(editionId)
        db.prepare('INSERT INTO editions (id, language, name, author) VALUES (?, ?, ?, ?)').run(editionId, meta.language, meta.name, meta.author)
        for (const [s, a, t] of rows) insert.run(editionId, s, a, t)
      })()
      return `${meta.name} terpasang.`
    } finally {
      installing.delete(editionId)
    }
  })
  installing.set(editionId, job.id)
  return job
}

export function removeEdition(editionId: string): void {
  if (editionId === KEMENAG) throw new Error(t('Terjemahan Kemenag sudah bawaan aplikasi dan tidak bisa dihapus.'))
  getDb().prepare('DELETE FROM editions WHERE id = ?').run(editionId)
}

/** Whole-ayah texts keyed `${surah}:${ayah}`. */
export function editionVerses(editionId: string, surah: number, from: number, to: number): Record<string, string> {
  const out: Record<string, string> = {}
  if (editionId === KEMENAG) {
    const rows = bundledDb()
      .prepare(
        `SELECT a.number AS ayah, t.text AS text FROM translation_text t JOIN ayah a ON a.id = t.ayah_id
         WHERE t.edition_key = ? AND a.surah_id = ? AND a.number BETWEEN ? AND ?`
      )
      .all(KEMENAG, surah, from, to) as { ayah: number; text: string }[]
    for (const r of rows) out[`${surah}:${r.ayah}`] = cleanTranslation(r.text)
    return out
  }
  if (!getDb().prepare('SELECT 1 FROM editions WHERE id = ?').get(editionId))
    throw new Error(t('Edisi terjemahan ini belum terpasang. Silakan pasang dulu.'))
  const rows = getDb()
    .prepare('SELECT ayah, text FROM edition_text WHERE edition = ? AND surah = ? AND ayah BETWEEN ? AND ?')
    .all(editionId, surah, from, to) as { ayah: number; text: string }[]
  for (const r of rows) out[`${surah}:${r.ayah}`] = r.text
  return out
}
