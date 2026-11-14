import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { ambientDir, fontsDir, projectsRoot, qpcFontsDir, uiFontPath } from './paths'

export const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
}

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

/**
 * Resolves `asset/<project>/<path>`, `ambient/<id>.m4a` and `fonts/<file>` (QPC pages under `fonts/qpc/`) to a file on disk, refusing paths
 * that climb out of their root. Shared by the studio:// protocol and the http server the export render reads from.
 */
export function resolveFile(host: string, pathname: string): string | null {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  if (host === 'fonts' && rel === 'Inter-Variable.ttf') return uiFontPath()
  const [root, sub] =
    host === 'asset' ? [projectsRoot(), rel] : host === 'ambient' ? [ambientDir(), rel] : host === 'fonts' && rel.startsWith('qpc/') ? [qpcFontsDir(), rel.slice(4)] : host === 'fonts' ? [fontsDir(), rel] : [null, '']
  if (!root) return null
  const abs = normalize(join(root, sub))
  return abs.startsWith(normalize(root) + sep) ? abs : null
}

/** Serves a file with HTTP Range support, so audio and video can seek. */
export function fileResponse(abs: string, range: string | null): Response {
  let size: number
  try {
    size = statSync(abs).size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const type = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10))
    const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
  })
}

export function handleStudioProtocol(): void {
  protocol.handle('studio', (req) => {
    const url = new URL(req.url)
    const abs = resolveFile(url.hostname, url.pathname)
    return abs ? fileResponse(abs, req.headers.get('range')) : new Response('Not found', { status: 404 })
  })
}
