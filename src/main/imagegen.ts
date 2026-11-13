import { randomInt, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cliImageToolName, openaiImageSize, parseRetryAfterMs, pollinationsUrl, sniffImage } from '@shared/aiTools'
import type { ImageRequest } from '@shared/imagegen'
import { buildImagePrompt, IMAGE_THEMES, livingBeingWord } from '@shared/imageThemes'
import type { Aspect, Job } from '@shared/types'
import { cliImage, missingBin } from './cli'
import { handle } from './ipc'
import { startJob } from './jobs'
import type { TaskCtx } from './jobs'
import { probe } from './media'
import { projectDir } from './paths'
import { getProject, insertAsset } from './repo'
import { getAiKey, getSettings, isLocalEndpoint } from './settings'

/** A picture can take a while: a free service under load, or an agent CLI drawing for a minute. */
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000
const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const RETRY_DELAY_MS = 5000
/** Pollinations' free tier allows one image per 45 seconds per IP address. */
const POLLINATIONS_GAP_MS = 46_000
const POLLINATIONS_MAX_WAIT_MS = 2 * 60 * 1000
const ASPECTS: Aspect[] = ['9:16', '16:9', '1:1']

interface Made {
  bytes: Uint8Array
  provider: string
  model: string | null
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  if (signal.aborted) {
    reject(abortError())
    return promise
  }
  const stop = (): void => {
    clearTimeout(timer)
    reject(abortError())
  }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', stop)
    resolve()
  }, ms)
  signal.addEventListener('abort', stop, { once: true })
  return promise
}

const abortError = (): Error => Object.assign(new Error('Dibatalkan'), { name: 'AbortError' })

/** fetch with the 3-minute limit; the user's cancel stays an AbortError, a timeout becomes a readable error. */
async function fetchLimited(service: string, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
  } catch (e) {
    if (signal.aborted) throw e
    if ((e as Error).name === 'TimeoutError') throw new Error(`${service} terlalu lama merespons (lebih dari 3 menit). Silakan coba lagi nanti.`)
    throw new Error(`${service} tidak bisa dihubungi. Periksa koneksi internet, lalu coba lagi.`)
  }
}

/** The service's own explanation of a refusal, when it sent one as JSON. */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const e = (JSON.parse(text) as { error?: { message?: string } | string }).error
    const msg = typeof e === 'string' ? e : e?.message
    if (msg) return msg.slice(0, 200)
  } catch {
    // not JSON
  }
  return /^\s*</.test(text) ? '' : text.slice(0, 200)
}

async function readBytes(res: Response, service: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`Berkas gambar dari ${service} tidak wajar (${bytes.length} byte).`)
  if (!sniffImage(bytes)) throw new Error(`Balasan ${service} bukan gambar. Silakan coba lagi, atau ganti deskripsinya.`)
  return bytes
}

// ---------- Pollinations (free, no key) ----------

/** One anonymous request at a time and 45 s apart, shared by every job, so queued pictures wait instead of failing. */
let pollinationsTurn: Promise<unknown> = Promise.resolve()
let pollinationsFreeAt = 0

async function pollinationsOnce(prompt: string, aspect: Aspect, model: string, ctx: TaskCtx): Promise<Uint8Array> {
  const service = 'Pollinations'
  let rate = 0
  let server = 0
  for (;;) {
    const wait = pollinationsFreeAt - Date.now()
    if (wait > 0) {
      ctx.progress(0.05, `Menunggu giliran layanan gratis Pollinations (sekitar ${Math.ceil(wait / 1000)} detik)…`)
      await sleep(wait, ctx.signal)
    }
    ctx.progress(0.15, 'Pollinations sedang menggambar…')
    pollinationsFreeAt = Date.now() + POLLINATIONS_GAP_MS
    const res = await fetchLimited(service, pollinationsUrl(prompt, aspect, model, randomInt(1, 2 ** 31)), {}, ctx.signal)
    if (res.ok) return readBytes(res, service)

    if (res.status === 402 || res.status === 429) {
      // 402 FREE_LIMIT carries the seconds until the next free slot.
      const after = parseRetryAfterMs(res.headers.get('retry-after')) ?? POLLINATIONS_GAP_MS
      if (after > POLLINATIONS_MAX_WAIT_MS || ++rate > 2) {
        throw new Error('Batas layanan gratis Pollinations sedang tercapai (satu gambar per 45 detik, dan ini dipakai bersama pengguna lain). Silakan coba lagi beberapa menit lagi, atau pilih pembuat gambar lain di Pengaturan.')
      }
      pollinationsFreeAt = Date.now() + after + 1000
      continue
    }
    if (res.status >= 500 && ++server === 1) {
      ctx.progress(0.1, 'Pollinations sedang sibuk. Mencoba sekali lagi…')
      pollinationsFreeAt = Date.now() + RETRY_DELAY_MS
      continue
    }
    const detail = await errorDetail(res)
    throw new Error(
      res.status >= 500
        ? `Pollinations sedang bermasalah (${res.status}). Silakan coba lagi nanti, atau pilih pembuat gambar lain di Pengaturan.`
        : `Pollinations menolak permintaan (${res.status}).${detail ? ` ${detail}` : ''} Silakan ganti deskripsinya, atau coba lagi.`
    )
  }
}

async function pollinations(prompt: string, aspect: Aspect, model: string, ctx: TaskCtx): Promise<Made> {
  const turn = pollinationsTurn.then(() => pollinationsOnce(prompt, aspect, model, ctx))
  pollinationsTurn = turn.catch(() => undefined)
  return { bytes: await turn, provider: 'pollinations', model: model || null }
}

// ---------- OpenAI-compatible /images/generations ----------

async function openaiImage(prompt: string, aspect: Aspect, model: string, ctx: TaskCtx): Promise<Made> {
  const { aiBaseUrl } = getSettings()
  const key = getAiKey()
  if (!key && !isLocalEndpoint(aiBaseUrl)) throw new Error('Kunci AI belum diatur. Buka Pengaturan untuk menambahkannya.')
  const name = model || 'gpt-image-1'
  const service = 'Layanan gambar'
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: name, prompt, n: 1, size: openaiImageSize(name, aspect) })
  }
  let retried = false
  for (;;) {
    ctx.progress(0.15, 'Meminta gambar dari layanan AI…')
    const res = await fetchLimited(service, `${aiBaseUrl.replace(/\/+$/, '')}/images/generations`, init, ctx.signal)
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { data?: { b64_json?: string; url?: string }[] } | null
      const item = data?.data?.[0]
      if (item?.b64_json) return { bytes: await readBytes(new Response(Buffer.from(item.b64_json, 'base64')), service), provider: 'openai', model: name }
      if (item?.url) {
        if (!/^https?:\/\//i.test(item.url)) throw new Error('Layanan gambar mengirim alamat gambar yang tidak dikenal.')
        const img = await fetchLimited(service, item.url, {}, ctx.signal)
        if (!img.ok) throw new Error(`Gambar dari layanan tidak bisa diunduh (${img.status}).`)
        return { bytes: await readBytes(img, service), provider: 'openai', model: name }
      }
      throw new Error('Balasan layanan gambar tidak berisi gambar. Periksa nama modelnya di Pengaturan.')
    }
    if ((res.status >= 500 || res.status === 429) && !retried) {
      retried = true
      ctx.progress(0.1, 'Layanan gambar sedang sibuk. Mencoba sekali lagi…')
      await sleep(RETRY_DELAY_MS, ctx.signal)
      continue
    }
    const detail = await errorDetail(res)
    if (res.status === 401 || res.status === 403) throw new Error('Layanan gambar menolak kunci API. Periksa kuncinya di Pengaturan.')
    throw new Error(`Layanan gambar menolak permintaan (${res.status}).${detail ? ` ${detail}` : ''} Periksa nama model gambar di Pengaturan.`)
  }
}

// ---------- AI CLI ----------

async function cliMade(prompt: string, aspect: Aspect, ctx: TaskCtx): Promise<Made> {
  const { imageCliTool, imageCliCommand } = getSettings()
  const name = cliImageToolName(imageCliTool)
  ctx.progress(0.1, `${name} sedang menggambar. Ini bisa memakan waktu sekitar satu menit…`)
  const img = await cliImage({ tool: imageCliTool, command: imageCliCommand, prompt, aspect, signal: ctx.signal })
  return { bytes: img.bytes, provider: `cli:${imageCliTool}`, model: null }
}

// ---------- saving ----------

function label(request: ImageRequest): string {
  const theme = IMAGE_THEMES.find((t) => t.id === request.themeId)
  const text = request.prompt.replace(/\s+/g, ' ').trim()
  const base = text && !theme ? text : (theme?.label ?? 'Gambar')
  return `AI: ${base.length > 48 ? `${base.slice(0, 47)}…` : base}`
}

function clean(raw: ImageRequest): ImageRequest {
  // The renderer's types are not trusted at the IPC boundary.
  const request: Partial<ImageRequest> = raw ?? {}
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
  const word = livingBeingWord(prompt)
  if (word) throw new Error(`Gambar latar tidak memuat makhluk bernyawa, jadi kata "${word}" tidak bisa dipakai. Silakan ganti deskripsinya.`)
  const themeId = IMAGE_THEMES.find((t) => t.id === request.themeId)?.id ?? null
  const aspect = ASPECTS.find((a) => a === request.aspect)
  if (!aspect) throw new Error('Bentuk gambar tidak dikenal.')
  return { prompt, themeId, aspect }
}

/** Problems the user can fix in Settings are reported at once, not after a job was queued. */
async function preflight(): Promise<void> {
  const s = getSettings()
  if (s.imageProvider === 'openai' && !getAiKey() && !isLocalEndpoint(s.aiBaseUrl)) throw new Error('Kunci AI belum diatur. Buka Pengaturan untuk menambahkannya.')
  if (s.imageProvider === 'cli') {
    if (s.imageCliTool === 'custom') {
      if (!s.imageCliCommand.trim()) throw new Error('Perintah gambar belum diisi. Buka Pengaturan untuk menambahkannya.')
    } else {
      const missing = await missingBin(s.imageCliTool)
      if (missing) throw new Error(`CLI ${missing} tidak ditemukan di komputer ini. Pasang dan login dulu, atau pilih pembuat gambar lain di Pengaturan.`)
    }
  }
}

async function startImageJob(projectId: string, raw: ImageRequest): Promise<Job> {
  getProject(projectId)
  const request = clean(raw)
  await preflight()
  return startJob(projectId, 'imagegen', 'net', async (ctx) => {
    const s = getSettings()
    const prompt = buildImagePrompt(request)
    const made =
      s.imageProvider === 'openai'
        ? await openaiImage(prompt, request.aspect, s.imageModel, ctx)
        : s.imageProvider === 'cli'
          ? await cliMade(prompt, request.aspect, ctx)
          : await pollinations(prompt, request.aspect, s.imageModel, ctx)

    ctx.progress(0.9, 'Menyimpan gambar…')
    const kind = sniffImage(made.bytes)
    if (!kind) throw new Error('Balasan bukan gambar.')
    const rel = `media/${randomUUID()}.${kind.ext}`
    const out = join(projectDir(projectId), rel)
    await mkdir(join(projectDir(projectId), 'media'), { recursive: true })
    try {
      await writeFile(out, made.bytes)
      const { width, height } = await probe(out)
      const asset = insertAsset({
        projectId,
        kind: 'image',
        path: rel,
        name: label(request),
        durationMs: null,
        width,
        height,
        source: 'ai',
        meta: { prompt, provider: made.provider, themeId: request.themeId, model: made.model, aspect: request.aspect }
      })
      return asset.id
    } catch (e) {
      await rm(out, { force: true })
      throw e
    }
  })
}

export function registerImageIpc(): void {
  handle('ai', 'generateImage', (projectId, request) => startImageJob(projectId, request))
}
