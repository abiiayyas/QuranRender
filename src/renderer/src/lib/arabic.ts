import { useEffect, useState, type CSSProperties } from 'react'
import { FAMILY } from '@video/fonts'
import type { ArabicScript } from '@shared/types'

const faces = new Map<string, Promise<void>>()

/**
 * Font-family for Arabic text in `script` (undefined = the page's LPMQ default, which is right for Kemenag text only).
 * Uthmani text uses stop signs and alef wasla that LPMQ does not draw, so it needs the KFGQPC face main downloads
 * when the verses are first fetched; `ready` says that has happened (the file exists), so the load is not tried early.
 */
export function useArabicFont(script: ArabicScript, ready: boolean): CSSProperties['fontFamily'] {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (script !== 'uthmani' || !ready) return
    let p = faces.get(script)
    if (!p) {
      const face = new FontFace(FAMILY.uthmani, 'url("studio://fonts/qpc/uthmani.woff2")')
      p = face.load().then((f) => void document.fonts.add(f))
      p.catch(() => faces.delete(script))
      faces.set(script, p)
    }
    let live = true
    void p.then(() => live && setLoaded(true), () => undefined)
    return () => {
      live = false
    }
  }, [script, ready])
  return script === 'uthmani' && loaded ? `"${FAMILY.uthmani}", "Amiri", serif` : undefined
}
