import { describe, expect, it } from 'vitest'
import { checkExport } from './policy'
import { DEFAULT_STYLE } from './style'
import type { Project, Segment, Verse } from './types'

const verse = (surah: number, ayah: number, n: number): Verse => ({ surah, ayah, words: Array.from({ length: n }, (_, i) => `w${i + 1}`) })
const verses = { '2:255': verse(2, 255, 50), '2:256': verse(2, 256, 23) }

function seg(o: Partial<Segment>): Segment {
  return {
    id: 's1',
    kind: 'ayah',
    surah: 2,
    ayah: 255,
    wordFrom: 1,
    wordTo: 50,
    startMs: 0,
    endMs: 5000,
    confidence: 0.95,
    source: 'aligner',
    words: [],
    translations: [{ edition: 'id.kemenag', text: 'Allah, tidak ada tuhan selain Dia.', status: 'full' }],
    ...o
  }
}

function project(segments: Segment[], o: Partial<Project> = {}): Project {
  return {
    id: 'p',
    title: 'T',
    step: 4,
    status: 'editing',
    aspect: '16:9',
    surah: 2,
    ayahFrom: 255,
    ayahTo: 256,
    reciter: '',
    script: 'kemenag',
    editions: ['id.kemenag'],
    sourceAssetId: 'a',
    segments,
    style: DEFAULT_STYLE,
    background: { kind: 'color', color: '#000', assetId: null, dim: 0, blur: 0 },
    overlays: [],
    createdAt: 0,
    updatedAt: 0,
    ...o
  }
}

const check = (p: Project, sourceOk = true) => checkExport(p, { sourceOk, verses })
const errors = (p: Project) => check(p).filter((i) => i.severity === 'error')
const warnings = (p: Project) => check(p).filter((i) => i.severity === 'warning')

describe('checkExport', () => {
  it('passes a clean project', () => {
    expect(check(project([seg({}), seg({ id: 's2', ayah: 256, wordTo: 23, startMs: 5000, endMs: 9000 })]))).toEqual([])
  })

  it('blocks without source or segments', () => {
    expect(errors(project([], { sourceAssetId: null })).map((i) => i.segmentId)).toEqual([null, null])
    expect(check(project([seg({})]), false)[0].message).toMatch(/tidak ditemukan/)
  })

  it('blocks bad times and overlaps, naming the segment', () => {
    const e = errors(project([seg({ endMs: 0 }), seg({ id: 's2', ayah: 256, wordTo: 23, startMs: 3000, endMs: 6000 })]))
    expect(e.map((i) => i.segmentId)).toEqual(['s1'])
    const o = errors(project([seg({}), seg({ id: 's2', ayah: 256, wordTo: 23, startMs: 4000, endMs: 6000 })]))
    expect(o).toHaveLength(1)
    expect(o[0].segmentId).toBe('s2')
    expect(o[0].message).toContain('2:256')
  })

  it('blocks word ranges outside the verse', () => {
    expect(errors(project([seg({ wordTo: 51 })]))[0].message).toContain('dari 50 kata')
    expect(errors(project([seg({ wordFrom: 0 })]))).toHaveLength(1)
    expect(errors(project([seg({ wordFrom: 5, wordTo: 4 })]))).toHaveLength(1)
  })

  it('blocks an ayah segment without primary translation, not basmalah', () => {
    expect(errors(project([seg({ translations: [] })]))[0].message).toContain('terjemahan utama')
    expect(errors(project([seg({ kind: 'basmalah', surah: 0, ayah: 0, wordFrom: 0, wordTo: 0, translations: [] })]))).toEqual([])
    expect(errors(project([seg({ translations: [] })], { editions: [] }))).toEqual([])
  })

  it('warns on review, low confidence and partial ayah with full translation', () => {
    const tr = (status: 'review' | 'full' | 'ai') => [{ edition: 'id.kemenag', text: 'x', status }]
    expect(warnings(project([seg({ translations: tr('review') })]))).toHaveLength(1)
    expect(warnings(project([seg({ confidence: 0.5 })]))[0].message).toContain('50%')
    expect(warnings(project([seg({ confidence: null })]))).toEqual([])
    expect(warnings(project([seg({ wordTo: 20, translations: tr('full') })]))[0].message).toContain('sebagian ayat')
    expect(warnings(project([seg({ wordTo: 20, translations: tr('ai') })]))).toEqual([])
  })
})
