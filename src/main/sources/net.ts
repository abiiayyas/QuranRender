import { t } from '@shared/i18n'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

const netError = (): string => t('Tidak bisa menghubungi server. Silakan periksa koneksi internet, lalu coba lagi.')

async function request(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal, redirect: 'follow' }).catch((e: unknown) => {
    if (signal?.aborted) throw e
    throw new Error(netError())
  })
  if (!res.ok) throw new Error(t('Server menolak permintaan (HTTP {status}). Silakan coba lagi nanti.', { status: res.status }))
  return res
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await request(url, signal ?? AbortSignal.timeout(30_000))
  return (await res.json().catch(() => {
    throw new Error(t('Jawaban server tidak bisa dibaca. Silakan coba lagi nanti.'))
  })) as T
}

/** Streams `url` to `dest` through `${dest}.part`, so a canceled or broken download never leaves a partial file. */
export async function downloadFile(url: string, dest: string, o: { signal: AbortSignal; onProgress?: (p: number) => void }): Promise<void> {
  const res = await request(url, o.signal)
  if (!res.body) throw new Error(netError())
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const count = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      got += chunk.length
      if (total) o.onProgress?.(got / total)
      cb(null, chunk)
    }
  })
  const part = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(part), { signal: o.signal })
    await rename(part, dest)
  } catch (e) {
    await rm(part, { force: true })
    if (o.signal.aborted) throw e
    throw new Error(t('Unduhan terputus. Silakan coba lagi.'))
  }
}
