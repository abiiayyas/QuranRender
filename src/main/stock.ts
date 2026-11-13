import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { STOCK_PROVIDERS, type StockItem, type StockPage, type StockProvider, type StockQuery } from '@shared/stock'
import { expandQuery, parseStockPage, providerLabel, stockCredit, stockHttpError, stockRequest } from '@shared/stockParse'
import type { Asset } from '@shared/types'
import { cacheGet, cacheSet, getDb } from './db'
import { handle } from './ipc'
import { probe } from './media'
import { assetAbsPath, projectDir, tmpDir } from './paths'
import { getAssetOrNull, getProject, insertAsset } from './repo'
import { store } from './sources/importFile'
import { allStockKeyStatus, checkProvider, clearStockKey, getStockKey, setStockKey, stockKeyStatus } from './stockKeys'

const MAX_BYTES = 100 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
/** Pixabay's terms ask for cached results (and its thumbnail URLs live 24 h); the others are cached to spare small quotas. */
const CACHE_MS: Record<StockProvider, number> = { pexels: 60 * 60_000, unsplash: 60 * 60_000, pixabay: 12 * 60 * 60_000 }

function needKey(p: StockProvider): string {
  const key = getStockKey(p)
  if (!key) throw new Error(t('Kunci {name} belum disimpan. Silakan masukkan kuncinya dulu.', { name: providerLabel(p) }))
  return key
}

/** Network failures read the same everywhere: a person only needs to know it is the connection, not the stack. */
async function call(provider: StockProvider, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new Error(t('Tidak bisa terhubung ke {name}. Silakan periksa koneksi internet Anda.', { name: providerLabel(provider) }))
  }
}

function checkQuery(q: StockQuery): StockQuery {
  const provider = checkProvider(q.provider)
  const info = STOCK_PROVIDERS.find((p) => p.id === provider)!
  if (!info.kinds.includes(q.kind)) throw new Error(q.kind === 'video' ? t('{name} hanya menyediakan foto.', { name: info.label }) : t('{name} hanya menyediakan video.', { name: info.label }))
  if (!['portrait', 'landscape', 'square'].includes(q.orientation)) throw new Error(t('Orientasi tidak dikenal.'))
  const query = typeof q.query === 'string' ? q.query.trim() : ''
  if (!query) throw new Error(t('Silakan ketik kata kunci dulu.'))
  return { provider, kind: q.kind, query, orientation: q.orientation, page: Math.max(1, Math.floor(Number(q.page)) || 1) }
}

async function search(raw: StockQuery): Promise<StockPage> {
  const q = checkQuery(raw)
  const key = needKey(q.provider)
  const cacheKey = `stock:${q.provider}:${q.kind}:${q.orientation}:${q.page}:${expandQuery(q.query)}`
  const hit = cacheGet<StockPage>(cacheKey, CACHE_MS[q.provider])
  if (hit) return hit
  const req = stockRequest(q, key)
  const res = await call(q.provider, req.url, { headers: req.headers, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(stockHttpError(q.provider, res.status, (await res.text().catch(() => '')).slice(0, 300)))
  const json: unknown = await res.json().catch(() => {
    throw new Error(t('Jawaban dari {name} tidak terbaca. Silakan coba lagi.', { name: providerLabel(q.provider) }))
  })
  const page = parseStockPage(q, json)
  cacheSet(cacheKey, page)
  return page
}

/** The same item picked twice reuses the file already in the project. */
function existingAsset(projectId: string, item: StockItem): Asset | null {
  const rows = getDb().prepare(`SELECT id, meta_json FROM assets WHERE project_id = ? AND source = 'stock'`).all(projectId) as { id: string; meta_json: string }[]
  for (const r of rows) {
    const meta = JSON.parse(r.meta_json) as { provider?: string; itemId?: string }
    if (meta.provider === item.provider && meta.itemId === item.id) return getAssetOrNull(r.id)
  }
  return null
}

/** Streams into a temp file, refusing anything over the size cap, and returns the response's content type. */
async function fetchToFile(provider: StockProvider, url: string, dest: string): Promise<string> {
  const res = await call(provider, url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) })
  if (!res.ok || !res.body) throw new Error(t('Berkas dari {name} tidak bisa diunduh (kode {status}). Silakan coba yang lain.', { name: providerLabel(provider), status: res.status }))
  const tooBig = new Error(t('Berkas ini lebih dari 100 MB. Silakan pilih yang lain.'))
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw tooBig
  let size = 0
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      done(size > MAX_BYTES ? tooBig : null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), cap, createWriteStream(dest))
  return (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
}

/** Unsplash's guidelines: every use of a photo is reported to its download endpoint. Best effort; the picture is already saved. */
async function pingUnsplash(item: StockItem): Promise<void> {
  if (item.provider !== 'unsplash' || !item.downloadPing?.startsWith('https://api.unsplash.com/')) return
  const key = getStockKey('unsplash')
  if (!key) return
  await fetch(item.downloadPing, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
}

/** The renderer picks the item, so its file URL is checked here: https, and a host the provider really serves files from. */
const HOSTS: Record<StockProvider, RegExp> = {
  pexels: /(^|\.)(pexels\.com|vimeo\.com|vimeocdn\.com)$/i,
  unsplash: /(^|\.)unsplash\.com$/i,
  pixabay: /(^|\.)pixabay\.com$/i
}

function assertProviderHost(provider: StockProvider, url: unknown): void {
  let host = ''
  try {
    const u = new URL(String(url))
    if (u.protocol === 'https:') host = u.hostname
  } catch {
    // falls through to the error below
  }
  if (!host || !HOSTS[provider].test(host)) throw new Error(t('Alamat berkas tidak valid.'))
}

const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')

async function download(projectId: string, raw: StockItem): Promise<Asset> {
  getProject(projectId)
  const provider = checkProvider(raw.provider)
  if (raw.kind !== 'photo' && raw.kind !== 'video') throw new Error(t('Jenis berkas tidak dikenal.'))
  assertProviderHost(provider, raw.downloadUrl)
  const item: StockItem = {
    ...raw,
    provider,
    id: text(raw.id, 60),
    author: text(raw.author),
    authorUrl: text(raw.authorUrl, 500),
    sourceUrl: text(raw.sourceUrl, 500),
    downloadPing: typeof raw.downloadPing === 'string' ? raw.downloadPing : null
  }
  const known = existingAsset(projectId, item)
  if (known) return known

  const tmp = join(tmpDir(), `${randomUUID()}.part`)
  const mp4 = `${tmp}.mp4`
  try {
    const type = await fetchToFile(provider, item.downloadUrl, tmp)
    let asset: Asset
    const meta = { provider, itemId: item.id, author: item.author, authorUrl: item.authorUrl, sourceUrl: item.sourceUrl, credit: stockCredit(item) }
    const name = `${providerLabel(provider)} ${item.id}`
    if (item.kind === 'photo') {
      const ext = IMAGE_TYPES[type]
      if (!ext) throw new Error(t('Format gambar ini belum didukung. Silakan pilih yang lain.'))
      const p = await probe(tmp)
      if (!p.hasVideo || !p.width || !p.height) throw new Error(t('Berkas ini tidak bisa dibaca sebagai gambar. Silakan pilih yang lain.'))
      const rel = `media/${randomUUID()}.${ext}`
      await mkdir(join(projectDir(projectId), 'media'), { recursive: true })
      const dest = assetAbsPath(projectId, rel)
      await rename(tmp, dest).catch(() => copyFile(tmp, dest))
      asset = insertAsset({ projectId, kind: 'image', path: rel, name: `${name}.${ext}`, durationMs: null, width: p.width, height: p.height, source: 'stock', meta })
    } else {
      // store() moves the file in and converts it when Chromium could not play it.
      await rename(tmp, mp4)
      const pre = await probe(mp4)
      if (!pre.hasVideo) throw new Error(t('Berkas ini tidak berisi gambar video. Silakan pilih yang lain.'))
      const stored = await store(projectId, mp4, pre, { folder: 'media', move: true })
      asset = insertAsset({ projectId, kind: 'video', path: stored.path, name: `${name}.mp4`, durationMs: stored.probe.durationMs, width: stored.probe.width, height: stored.probe.height, source: 'stock', meta })
    }
    void pingUnsplash(item)
    return asset
  } finally {
    await Promise.all([rm(tmp, { force: true }), rm(mp4, { force: true })])
  }
}

export function registerStockIpc(): void {
  handle('stock', 'keys', () => allStockKeyStatus())
  handle('stock', 'setKey', (provider, key) => {
    const p = checkProvider(provider)
    const value = typeof key === 'string' ? key.trim() : ''
    if (!value) throw new Error(t('Kunci kosong. Silakan tempel kunci dari situs penyedia.'))
    setStockKey(p, value)
    return stockKeyStatus(p)
  })
  handle('stock', 'clearKey', (provider) => {
    const p = checkProvider(provider)
    clearStockKey(p)
    return stockKeyStatus(p)
  })
  handle('stock', 'search', (q) => search(q))
  handle('stock', 'download', (projectId, item) => download(projectId, item))
}
