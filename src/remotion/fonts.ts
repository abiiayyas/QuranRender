import { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender, getRemotionEnvironment } from 'remotion'
import type { ArabicScript, Verse } from '../shared/types'
import { resetMeasurements } from './layout'

/** Family names are prefixed so they never collide with the app's own @font-face rules for the same files. */
export const FAMILY = {
  lpmq: 'QV LPMQ',
  uthmani: 'QV Uthmani',
  amiri: 'QV Amiri',
  inter: 'QV Inter'
} as const

export const qpcFamily = (page: number): string => `QPC-p${page}`

export interface FontSpec {
  family: string
  /** Relative to `baseUrl.font`. */
  file: string
  weight?: string
}

/** Every face a video in `script` may draw with. */
export function fontSpecs(script: ArabicScript, verses: Record<string, Verse>): FontSpec[] {
  const specs: FontSpec[] = [
    { family: FAMILY.inter, file: 'Inter-Variable.ttf', weight: '100 900' },
    { family: FAMILY.amiri, file: 'Amiri-Regular.ttf', weight: '400' },
    { family: FAMILY.amiri, file: 'Amiri-Bold.ttf', weight: '700' },
    // Isti'adzah is plain Arabic text, so QPC videos still need a Unicode font for it.
    { family: FAMILY.lpmq, file: 'LPMQ.ttf' }
  ]
  if (script === 'uthmani') specs.push({ family: FAMILY.uthmani, file: 'qpc/uthmani.woff2' })
  if (script === 'qpc') {
    const pages = new Set<number>()
    for (const v of Object.values(verses)) if (v.page) pages.add(v.page)
    for (const p of [...pages].sort((a, b) => a - b)) specs.push({ family: qpcFamily(p), file: `qpc/p${p}.woff2` })
  }
  return specs
}

const faces = new Map<string, Promise<void>>()
const done = new Set<string>()
const batches = new Map<string, Promise<void>>()

function loadFace(base: string, s: FontSpec): Promise<void> {
  const url = base + s.file
  const key = `${s.family}|${s.weight ?? ''}|${url}`
  let p = faces.get(key)
  if (!p) {
    const face = new FontFace(s.family, `url("${url}")`, s.weight ? { weight: s.weight } : {})
    p = face.load().then(
      (f) => {
        document.fonts.add(f)
      },
      (e: unknown) => {
        faces.delete(key)
        throw new Error(`Font ${s.file} gagal dimuat: ${e instanceof Error ? e.message : String(e)}`)
      }
    )
    faces.set(key, p)
  }
  return p
}

/**
 * Loads the faces once per page. One delayRender handle per batch, held at module level (not per component), so the
 * app's StrictMode double render never leaks a handle that would stall an export until its timeout.
 */
function loadBatch(base: string, specs: FontSpec[], key: string): Promise<void> {
  let p = batches.get(key)
  if (p) return p
  const handle = delayRender('Memuat font')
  p = Promise.all(specs.map((s) => loadFace(base, s))).then(
    () => {
      resetMeasurements()
      done.add(key)
      continueRender(handle)
    },
    (e: unknown) => {
      // An export with a missing glyph font would be wrong on every frame: fail it. The preview draws with fallback
      // fonts instead of retrying on every frame.
      if (getRemotionEnvironment().isRendering) cancelRender(e)
      else {
        console.warn(e)
        done.add(key)
        continueRender(handle)
      }
    }
  )
  batches.set(key, p)
  return p
}

/** True once every face is ready; layouts measured before that would use fallback metrics. */
export function useFonts(base: string, specs: FontSpec[]): boolean {
  const key = base + '\n' + specs.map((s) => `${s.family}|${s.weight ?? ''}|${s.file}`).join('\n')
  const [readyKey, setReadyKey] = useState(done.has(key) ? key : '')
  // Starting inside render (not only in an effect) creates the handle before Remotion captures frame 0.
  if (!done.has(key)) void loadBatch(base, specs, key)
  useEffect(() => {
    if (done.has(key)) {
      setReadyKey(key)
      return
    }
    let live = true
    void loadBatch(base, specs, key).then(() => {
      if (live) setReadyKey(key)
    })
    return () => {
      live = false
    }
    // `key` captures base and specs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return readyKey === key || done.has(key)
}
