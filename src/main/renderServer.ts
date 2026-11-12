import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { fileResponse, resolveFile } from './protocol'

export interface FileServer {
  /** `http://127.0.0.1:<port>/`; files are at `asset/<project>/<path>` and `fonts/<file>`. */
  origin: string
  close(): Promise<void>
}

/**
 * Chrome Headless renders the composition from Remotion's http page, which cannot read studio:// or file://, so for the
 * length of a render the same files are served over http on loopback (CORS open: the page has another origin).
 */
export async function startFileServer(): Promise<FileServer> {
  const server: Server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range' }
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, cors).end()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const [, host, ...rest] = url.pathname.split('/')
    const abs = resolveFile(host, `/${rest.join('/')}`)
    const r = abs ? fileResponse(abs, req.headers.range ?? null) : new Response('Not found', { status: 404 })
    // Headers (not two object spreads): `access-control-allow-origin` twice, in different case, is "*, *" to Chrome and fails CORS.
    const headers = new Headers(r.headers)
    for (const [k, v] of Object.entries(cors)) headers.set(k, v)
    res.writeHead(r.status, Object.fromEntries(headers))
    if (req.method === 'HEAD' || !r.body) {
      void r.body?.cancel()
      return void res.end()
    }
    const body = Readable.fromWeb(r.body as NodeReadableStream)
    // Chrome drops media connections mid-file on seeks; that is not an error worth logging.
    body.on('error', () => res.destroy())
    res.on('close', () => body.destroy())
    body.pipe(res)
  })
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve())
  await promise
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}/`,
    close: () => {
      server.closeAllConnections()
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      return closed.promise
    }
  }
}
