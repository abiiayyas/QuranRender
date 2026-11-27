import { describe, expect, it } from 'vitest'
import {
  activeBackgroundLayers,
  appendBackgroundClip,
  backgroundAssetIds,
  distributeClips,
  removeBackgroundClip,
  reorderBackgroundClip,
  type BackgroundClip
} from './background'
import { assetUses, clearReferences } from './storageRules'
import type { Background } from './types'

const baseBg: Background = { kind: 'color', color: '#101114', assetId: null, dim: 0.35, blur: 0 }

describe('multi-background helpers', () => {
  it('promotes single media to multi when a second is added, and keeps single mode on first add', () => {
    let n = 0
    const nextId = () => `c${++n}`

    const single = appendBackgroundClip(baseBg, { id: 'a1', kind: 'image' }, 10_000, nextId)
    expect(single.kind).toBe('image')
    expect(single.assetId).toBe('a1')

    const multi = appendBackgroundClip(single, { id: 'a2', kind: 'video' }, 10_000, nextId)
    expect(multi.kind).toBe('multi')
    expect(multi.assetId).toBeNull()
    expect(multi.clips).toEqual([
      { id: 'c1', kind: 'image', assetId: 'a1', startMs: 0, endMs: 5000 },
      { id: 'c2', kind: 'video', assetId: 'a2', startMs: 5000, endMs: 10_000 }
    ])
    expect(backgroundAssetIds(multi)).toEqual(['a1', 'a2'])
  })

  it('reorders and removes clips, dropping back to single or color cleanly', () => {
    const clips: BackgroundClip[] = [
      { id: 'c1', kind: 'image', assetId: 'a1', startMs: 0, endMs: 5000 },
      { id: 'c2', kind: 'video', assetId: 'a2', startMs: 5000, endMs: 10_000 }
    ]
    const reordered = reorderBackgroundClip(clips, 0, 1, 10_000)
    expect(reordered.map((c) => c.assetId)).toEqual(['a2', 'a1'])
    expect(reordered[0]).toMatchObject({ startMs: 0, endMs: 5000 })

    const backToSingle = removeBackgroundClip({ ...baseBg, kind: 'multi', clips }, 'c1', 10_000)
    expect(backToSingle.kind).toBe('video')
    expect(backToSingle.assetId).toBe('a2')
    expect(backToSingle.clips).toEqual([])

    const backToColor = removeBackgroundClip({ ...baseBg, kind: 'multi', clips: [clips[0]] }, 'c1', 10_000)
    expect(backToColor.kind).toBe('color')
    expect(backToColor.assetId).toBeNull()
  })

  it('computes crossfade layers deterministically around boundaries', () => {
    const clips = distributeClips(
      [
        { id: 'c1', kind: 'image', assetId: 'a1', startMs: 0, endMs: 0 },
        { id: 'c2', kind: 'image', assetId: 'a2', startMs: 0, endMs: 0 }
      ],
      10_000
    )
    expect(activeBackgroundLayers(clips, 2000, 1000)).toEqual([{ clip: clips[0], opacity: 1 }])
    const mid = activeBackgroundLayers(clips, 5000, 1000)
    expect(mid).toHaveLength(2)
    expect(mid[0].clip.id).toBe('c1')
    expect(mid[0].opacity).toBe(1)
    expect(mid[1].clip.id).toBe('c2')
    expect(mid[1].opacity).toBeCloseTo(0.5)
    expect(activeBackgroundLayers(clips, 8000, 1000)).toEqual([{ clip: clips[1], opacity: 1 }])
  })

  it('tracks and clears multi-background references in storageRules', () => {
    const project = {
      sourceAssetId: null,
      background: {
        ...baseBg,
        kind: 'multi' as const,
        clips: [
          { id: 'c1', kind: 'image' as const, assetId: 'a1', startMs: 0, endMs: 5000 },
          { id: 'c2', kind: 'video' as const, assetId: 'a2', startMs: 5000, endMs: 10_000 }
        ]
      },
      overlays: [],
      thumbnail: undefined
    }
    expect(assetUses(project, 'a2')).toEqual(['background'])
    const patch = clearReferences(project, 'a1')
    expect(patch.background?.kind).toBe('video')
    expect(patch.background?.assetId).toBe('a2')
  })
})
