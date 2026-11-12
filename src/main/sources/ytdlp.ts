import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Job } from '@shared/types'
import { startJob } from '../jobs'
import { ffmpegPath, tmpDir, toolsDir } from '../paths'
import { getProject } from '../repo'
import { importSource } from './importFile'
import { downloadFile } from './net'

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']

const ytdlpPath = (): string => join(toolsDir(), 'yt-dlp')

let installing: Promise<void> | null = null

/**
 * Downloads yt-dlp once as its own 'ytdlp' job; concurrent callers share it. Waiting also ends when the caller's job
 * is canceled, since a 'ytdlp' job canceled while still queued never runs its task.
 */
async function ensureYtDlp(projectId: string, signal: AbortSignal): Promise<void> {
  if (existsSync(ytdlpPath())) return
  if (!installing) {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    installing = promise.finally(() => {
      installing = null
    })
    // Owned by the project that needed it, so its progress shows there.
    startJob(projectId, 'ytdlp', 'net', async (ctx) => {
      try {
        ctx.progress(0.02, 'Mengunduh yt-dlp…')
        const dest = ytdlpPath()
        await downloadFile(YTDLP_URL, dest, { signal: ctx.signal, onProgress: (f) => ctx.progress(f) })
        await chmod(dest, 0o755)
        resolve()
      } catch (e) {
        reject(ctx.signal.aborted ? new Error('Unduhan yt-dlp dibatalkan.') : e)
        throw e
      }
    })
  }
  const aborted = Promise.withResolvers<void>()
  const onAbort = (): void => aborted.reject(new Error('canceled'))
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await Promise.race([installing, aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function checkYoutubeUrl(url: unknown): string {
  let u: URL
  try {
    u = new URL(String(url).trim())
  } catch {
    throw new Error('Alamat YouTube tidak valid.')
  }
  if (u.protocol !== 'https:' || !YT_HOSTS.includes(u.hostname.toLowerCase())) {
    throw new Error('Silakan masukkan alamat https dari youtube.com atau youtu.be.')
  }
  return u.toString()
}

/** Runs yt-dlp; `onLine` gets every stdout/stderr line. Rejects with the last error line. */
function run(args: string[], signal: AbortSignal, onLine: (line: string) => void): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const child = spawn(ytdlpPath(), args, { signal })
  let lastError = ''
  let buf = ''
  const feed = (d: Buffer): void => {
    buf += d.toString()
    const lines = buf.split(/\r?\n|\r/)
    buf = lines.pop() ?? ''
    for (const l of lines) {
      if (/^ERROR:/.test(l)) lastError = l.replace(/^ERROR:\s*/, '')
      onLine(l)
    }
  }
  child.stdout.on('data', feed)
  child.stderr.on('data', feed)
  child.on('error', reject)
  child.on('close', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`Video YouTube tidak bisa diunduh. ${lastError}`.trim()))
  })
  return promise
}

export function startYoutube(projectId: string, rawUrl: string): Job {
  getProject(projectId)
  const url = checkYoutubeUrl(rawUrl)
  return startJob(projectId, 'youtube', 'net', async (ctx) => {
    await ensureYtDlp(projectId, ctx.signal)
    const dir = join(tmpDir(), `yt-${randomUUID()}`)
    await mkdir(dir, { recursive: true })
    try {
      let title = ''
      let file = ''
      ctx.progress(0.02, 'Menghubungi YouTube…')
      await run(
        [
          '--no-playlist',
          '--newline',
          '--progress',
          '--no-mtime',
          '-f',
          'bestaudio[ext=m4a]/bestaudio',
          '--ffmpeg-location',
          dirname(ffmpegPath()),
          '-o',
          join(dir, 'audio.%(ext)s'),
          '--print',
          'before_dl:QRTITLE %(title)s',
          '--print',
          'after_move:QRFILE %(filepath)s',
          url
        ],
        ctx.signal,
        (line) => {
          if (line.startsWith('QRTITLE ')) title = line.slice(8).trim()
          else if (line.startsWith('QRFILE ')) file = line.slice(7).trim()
          else {
            const m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line)
            if (m) ctx.progress(0.05 + (Number(m[1]) / 100) * 0.85, 'Mengunduh audio dari YouTube…')
          }
        }
      )
      if (!file || !existsSync(file)) file = join(dir, (await readdir(dir)).find((f) => f.startsWith('audio.')) ?? '')
      if (!existsSync(file)) throw new Error('Video YouTube tidak bisa diunduh.')
      ctx.progress(0.92, 'Menyimpan ke proyek…')
      await importSource(projectId, file, { source: 'youtube', name: title || 'Audio YouTube', move: true, signal: ctx.signal, meta: { url } })
      return 'Audio YouTube sudah masuk ke proyek.'
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
