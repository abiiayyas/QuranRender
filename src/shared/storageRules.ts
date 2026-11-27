import { backgroundAssetIds } from './background'
import type { AssetUse } from './storage'
import type { Project } from './types'

/** Remotion makes `remotion-v*` folders in the system temp dir for every render; nothing else is ours to touch. */
export const isRemotionTemp = (name: string): boolean => /^remotion-v/.test(name)

/** True when the newest change is at least `minIdleMs` old; a clock that runs backwards counts as not idle. */
export const isIdle = (mtimeMs: number, now: number, minIdleMs: number): boolean => now - mtimeMs >= minIdleMs

/** Every place a project points at the asset. Several entries of one kind (two overlays) give one use each. */
export function assetUses(project: Pick<Project, 'sourceAssetId' | 'background' | 'overlays' | 'thumbnail'>, assetId: string): AssetUse[] {
  const uses: AssetUse[] = []
  if (project.sourceAssetId === assetId) uses.push('source')
  if (backgroundAssetIds(project.background).includes(assetId)) uses.push('background')
  for (const o of project.overlays) if (o.assetId === assetId) uses.push('overlay')
  if (project.thumbnail?.assetId === assetId) uses.push('thumbnail')
  return uses
}

/**
 * The project fields that stop pointing at the asset, as one patch so nothing is left dangling: a background that
 * showed the file falls back to its colour, overlays that exist only to show it go away.
 */
export function clearReferences(project: Pick<Project, 'sourceAssetId' | 'background' | 'overlays' | 'thumbnail'>, assetId: string): Partial<Project> {
  const patch: Partial<Project> = {}
  if (project.sourceAssetId === assetId) patch.sourceAssetId = null
  const bg = project.background
  const hasClip = !!bg.clips?.some((c) => c.assetId === assetId)
  if (bg.assetId === assetId || hasClip) {
    let next = { ...bg, ...(bg.assetId === assetId ? { assetId: null, kind: bg.kind === 'image' || bg.kind === 'video' ? ('color' as const) : bg.kind } : {}) }
    if (hasClip) {
      const rest = (bg.clips ?? []).filter((c) => c.assetId !== assetId)
      if (bg.kind === 'multi') {
        if (rest.length === 0) next = { ...next, kind: 'color', assetId: null, clips: [] }
        else if (rest.length === 1) next = { ...next, kind: rest[0].kind, assetId: rest[0].assetId, clips: [] }
        else next = { ...next, clips: rest }
      } else {
        next = { ...next, clips: rest }
      }
    }
    patch.background = next
  }
  if (project.overlays.some((o) => o.assetId === assetId)) patch.overlays = project.overlays.filter((o) => o.assetId !== assetId)
  if (project.thumbnail?.assetId === assetId) patch.thumbnail = { ...project.thumbnail, assetId: null }
  return patch
}
