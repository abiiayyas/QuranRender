import { describe, expect, it } from 'vitest'
import { assetUses, clearReferences, isIdle, isRemotionTemp } from './storageRules'
import type { Overlay, Project } from './types'

type P = Pick<Project, 'sourceAssetId' | 'background' | 'overlays' | 'thumbnail'>

const overlay = (id: string, kind: Overlay['kind'], assetId: string | null): Overlay =>
  ({ id, kind, text: '', assetId, x: 0.5, y: 0.5, size: 0.3, color: '#fff', opacity: 1, startMs: 0, endMs: null })

const base = (): P => ({
  sourceAssetId: 'src',
  background: { kind: 'color', color: '#000', assetId: null, dim: 0, blur: 0 },
  overlays: [],
  thumbnail: undefined
})

describe('isRemotionTemp', () => {
  it('matches only Remotion folders', () => {
    expect(isRemotionTemp('remotion-v4.0.1-abc')).toBe(true)
    expect(isRemotionTemp('remotion-webpack-bundle')).toBe(false)
    expect(isRemotionTemp('my-remotion-v4')).toBe(false)
  })
})

describe('isIdle', () => {
  it('compares age with the minimum', () => {
    expect(isIdle(0, 1000, 1000)).toBe(true)
    expect(isIdle(1, 1000, 1000)).toBe(false)
    expect(isIdle(2000, 1000, 10)).toBe(false)
  })
})

describe('assetUses', () => {
  it('finds each use', () => {
    const p: P = {
      sourceAssetId: 'a',
      background: { kind: 'image', color: '#000', assetId: 'a', dim: 0, blur: 0 },
      overlays: [overlay('o', 'image', 'a')],
      thumbnail: { title: '', subtitle: '', position: 'top', accent: '#fff', dim: 0, assetId: 'a' }
    }
    expect(assetUses(p, 'a')).toEqual(['source', 'background', 'overlay', 'thumbnail'])
  })

  it('gives nothing for an unreferenced asset', () => {
    const p = { ...base(), overlays: [overlay('o', 'image', 'x')] }
    expect(assetUses(p, 'a')).toEqual([])
  })

  it('counts two overlays separately', () => {
    const p = { ...base(), overlays: [overlay('1', 'image', 'a'), overlay('2', 'image', 'a')] }
    expect(assetUses(p, 'a')).toEqual(['overlay', 'overlay'])
  })
})

describe('clearReferences', () => {
  it('clears every reference to the asset', () => {
    const p: P = {
      sourceAssetId: 'a',
      background: { kind: 'video', color: '#123', assetId: 'a', dim: 0.2, blur: 3 },
      overlays: [overlay('1', 'image', 'a'), overlay('2', 'image', 'a'), overlay('3', 'image', 'b'), overlay('4', 'text', null)],
      thumbnail: { title: 'T', subtitle: 'S', position: 'top', accent: '#fff', dim: 0.4, assetId: 'a' }
    }
    const patch = clearReferences(p, 'a')
    expect(patch.sourceAssetId).toBeNull()
    expect(patch.background).toEqual({ kind: 'color', color: '#123', assetId: null, dim: 0.2, blur: 3 })
    expect(patch.overlays?.map((o) => o.id)).toEqual(['3', '4'])
    expect(patch.thumbnail).toMatchObject({ title: 'T', dim: 0.4, assetId: null })
  })

  it('leaves unrelated fields out of the patch', () => {
    const p: P = {
      sourceAssetId: 'src',
      background: { kind: 'image', color: '#000', assetId: 'bg', dim: 0, blur: 0 },
      overlays: [overlay('1', 'image', 'bg')],
      thumbnail: { title: '', subtitle: '', position: 'top', accent: '#fff', dim: 0, assetId: 'bg' }
    }
    expect(clearReferences(p, 'other')).toEqual({})
  })

  it('keeps the kind of a background that is not media', () => {
    const p = { ...base(), background: { kind: 'source' as const, color: '#000', assetId: 'a', dim: 0, blur: 0 } }
    expect(clearReferences(p, 'a').background?.kind).toBe('source')
  })
})
