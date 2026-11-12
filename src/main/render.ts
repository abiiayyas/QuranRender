import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import type * as Renderer from '@remotion/renderer'
import { app } from 'electron'
import { COMPOSITION_ID, type VideoProps } from '@shared/video'

/**
 * The video is drawn by Remotion: src/remotion is bundled into a static site, @remotion/renderer opens it in Chrome
 * Headless Shell and captures every frame. The preview Player runs the same composition with the same props.
 * Loaded lazily: a broken native compositor must only break export, never app start.
 */
const loadRenderer = (): Promise<typeof Renderer> => import('@remotion/renderer')

interface RenderAssets {
  serveUrl: string
  /** Undefined in development, where Remotion finds the browser it downloaded into node_modules itself. */
  browserExecutable?: string
  /** Undefined in development. Installed, the binaries must come from the unpacked asar: Remotion chmods them. */
  binariesDirectory?: string
}

function newestMtime(path: string): number {
  if (!existsSync(path)) return 0
  const st = statSync(path)
  if (!st.isDirectory()) return st.mtimeMs
  return readdirSync(path).reduce((m, name) => Math.max(m, newestMtime(join(path, name))), st.mtimeMs)
}

/** Chrome Headless Shell sits a few folders deep (platform / versioned folder) under the shipped `remotion/chrome`. */
function findChrome(dir: string, depth = 0): string | null {
  if (depth > 4 || !existsSync(dir)) return null
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (/^chrome-headless-shell(\.exe)?$/.test(name) && statSync(full).isFile()) return full
    if (statSync(full).isDirectory()) {
      const hit = findChrome(full, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/** Runs scripts/prepare-remotion.mjs with Electron's own Node, so development needs no separate Node setup. */
function buildBundle(root: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const child = spawn(process.execPath, [join(root, 'scripts', 'prepare-remotion.mjs'), '--bundle'], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true
  })
  let log = ''
  child.stdout.on('data', (d: Buffer) => (log += d.toString()))
  child.stderr.on('data', (d: Buffer) => (log += d.toString()))
  child.on('error', reject)
  child.on('close', (code) =>
    code === 0 ? resolve() : reject(new Error(`Gagal menyiapkan mesin render:\n${log.trim().split('\n').slice(-6).join('\n')}`))
  )
  return promise
}

async function prepareAssets(): Promise<RenderAssets> {
  if (app.isPackaged) {
    const base = join(process.resourcesPath, 'remotion')
    const browserExecutable = findChrome(join(base, 'chrome'))
    if (!existsSync(join(base, 'bundle', 'index.html')) || !browserExecutable) {
      throw new Error('Mesin render tidak ikut terpasang di aplikasi ini. Silakan pasang ulang dari installer terbaru.')
    }
    const remotionModules = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@remotion')
    const compositor = existsSync(remotionModules) ? readdirSync(remotionModules).find((n) => n.startsWith('compositor-')) : undefined
    if (!compositor) throw new Error('Mesin render tidak ikut terpasang di aplikasi ini. Silakan pasang ulang dari installer terbaru.')
    return { serveUrl: join(base, 'bundle'), browserExecutable, binariesDirectory: join(remotionModules, compositor) }
  }
  const root = app.getAppPath()
  const out = join(root, 'resources-gen', 'remotion-bundle')
  const index = join(out, 'index.html')
  const sources = [join(root, 'src', 'remotion'), join(root, 'src', 'shared')]
  if (!existsSync(index) || newestMtime(index) < Math.max(...sources.map(newestMtime))) await buildBundle(root)
  await (await loadRenderer()).ensureBrowser()
  return { serveUrl: out }
}

let assetsReady: Promise<RenderAssets> | null = null

/** Prepared once per run; a failure is not kept, so fixing the cause and retrying works without a restart. */
function renderAssets(): Promise<RenderAssets> {
  assetsReady ??= prepareAssets().catch((e) => {
    assetsReady = null
    throw e
  })
  return assetsReady
}

/**
 * A port nobody listens on, on IPv4 and IPv6. Remotion only tests IPv4 when it picks its own, so a dev server on [::]:3000
 * looks free to it, and Chrome, opening localhost, then reaches that server instead of Remotion's.
 */
async function freePort(): Promise<number> {
  for (const host of ['::', '127.0.0.1']) {
    const { promise, resolve, reject } = Promise.withResolvers<number>()
    const server = createServer()
    server.once('error', reject)
    server.listen({ port: 0, host }, () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
    try {
      return await promise
    } catch {
      // No IPv6 on this machine: the IPv4 attempt is enough there.
    }
  }
  throw new Error('Tidak ada port kosong untuk mesin render.')
}

export async function renderVideo(o: {
  props: VideoProps
  outPath: string
  signal: AbortSignal
  onProgress: (p: number, renderedFrames: number, totalFrames: number) => void
}): Promise<void> {
  const { serveUrl, browserExecutable, binariesDirectory } = await renderAssets()
  const { makeCancelSignal, renderMedia, selectComposition } = await loadRenderer()
  // Remotion's own input-props type is a plain record.
  const inputProps = o.props as unknown as Record<string, unknown>
  const selected = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, port: await freePort(), browserExecutable, binariesDirectory, logLevel: 'error' })
  const { width, height, fps, durationMs } = o.props
  // The props decide the canvas and length, whatever defaults the composition registers.
  const composition = { ...selected, width, height, fps, durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * fps)) }
  const { cancel, cancelSignal } = makeCancelSignal()
  if (o.signal.aborted) throw new Error('canceled')
  o.signal.addEventListener('abort', cancel, { once: true })
  try {
    await renderMedia({
      port: await freePort(),
      composition,
      serveUrl,
      codec: 'h264',
      crf: 18,
      audioCodec: 'aac',
      // Thin Arabic strokes and harakat show JPEG artifacts at the default quality.
      jpegQuality: 95,
      outputLocation: o.outPath,
      inputProps,
      browserExecutable,
      binariesDirectory,
      cancelSignal,
      logLevel: 'error',
      onProgress: ({ progress, renderedFrames }) => o.onProgress(progress, renderedFrames, composition.durationInFrames)
    })
  } finally {
    o.signal.removeEventListener('abort', cancel)
  }
}
