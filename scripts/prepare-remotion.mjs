// Builds what export needs: the Remotion bundle (src/remotion as a static site) and the Chrome Headless Shell it renders with.
// `npm run dist:mac` runs this first so both ship in the app. In development the main process runs it with --bundle when
// src/remotion changed.
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { bundle } from '@remotion/bundler'
import { ensureBrowser } from '@remotion/renderer'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'resources-gen/remotion-bundle')

rmSync(out, { recursive: true, force: true })
await bundle({ entryPoint: resolve(root, 'src/remotion/index.ts'), outDir: out })
console.log(`[remotion] bundle: ${out}`)

if (!process.argv.includes('--bundle')) {
  await ensureBrowser()
  console.log('[remotion] Chrome Headless Shell siap')
}
