import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE } from './style'
import { ISTIADZAH_TEXT, toSrt, toVtt, youtubeChapters } from './subtitles'
import type { Project, Segment, Verse } from './types'

const verses: Record<string, Verse> = {
  '1:1': { surah: 1, ayah: 1, words: ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَٰنِ', 'ٱلرَّحِيمِ'] },
  '1:2': { surah: 1, ayah: 2, words: ['ٱلْحَمْدُ', 'لِلَّهِ', '', 'ٱلْعَٰلَمِينَ'] }
}

function seg(id: string, o: Partial<Segment>): Segment {
  return {
    id,
    kind: 'ayah',
    surah: 1,
    ayah: 2,
    wordFrom: 1,
    wordTo: 4,
    startMs: 0,
    endMs: 1000,
    confidence: 1,
    source: 'manual',
    words: [],
    translations: [],
    ...o
  }
}

function project(segments: Segment[]): Project {
  return {
    id: 'p',
    title: 'T',
    step: 4,
    status: 'editing',
    aspect: '16:9',
    surah: 1,
    ayahFrom: 1,
    ayahTo: 7,
    reciter: '',
    script: 'kemenag',
    editions: ['id.kemenag', 'en.sahih'],
    sourceAssetId: 'a',
    segments,
    style: DEFAULT_STYLE,
    background: { kind: 'color', color: '#000', assetId: null, dim: 0, blur: 0 },
    overlays: [],
    createdAt: 0,
    updatedAt: 0
  }
}

const tr = (text: string) => [
  { edition: 'en.sahih', text: 'other', status: 'full' as const },
  { edition: 'id.kemenag', text, status: 'full' as const }
]

const p = project([
  seg('b', { kind: 'ayah', ayah: 2, wordFrom: 3, wordTo: 4, startMs: 7_500, endMs: 3_723_004, translations: tr('Tuhan seluruh alam.') }),
  seg('a', { kind: 'basmalah', surah: 0, ayah: 0, wordFrom: 0, wordTo: 0, startMs: 0, endMs: 5_000, translations: tr('Dengan nama Allah') })
])

describe('subtitles', () => {
  it('writes SRT in time order with Arabic word ranges and the primary translation', () => {
    expect(toSrt(p, verses, 'both')).toBe(
      '1\n00:00:00,000 --> 00:00:05,000\nبِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\nDengan nama Allah\n\n' +
        '2\n00:00:07,500 --> 01:02:03,004\nٱلْعَٰلَمِينَ\nTuhan seluruh alam.\n'
    )
  })

  it('writes VTT and skips cues with no text', () => {
    const vtt = toVtt(project([...p.segments, seg('c', { kind: 'istiadzah', startMs: 10, endMs: 20 }), seg('d', { startMs: 30, endMs: 40 })]), verses, 'translation')
    expect(vtt).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nDengan nama Allah\n\n00:00:07.500 --> 01:02:03.004\nTuhan seluruh alam.\n')
    expect(toVtt(project([seg('c', { kind: 'istiadzah', startMs: 0, endMs: 900 })]), verses, 'arabic')).toContain(ISTIADZAH_TEXT)
  })
})

describe('youtubeChapters', () => {
  const ayah = (n: number, startMs: number) => seg(`s${n}`, { surah: 2, ayah: n, startMs, endMs: startMs + 1000 })

  it('starts at 0:00, groups split ayahs and merges chapters under 10 s', () => {
    const segs = [
      seg('i', { kind: 'istiadzah', surah: 0, ayah: 0, startMs: 2_000, endMs: 4_000 }),
      ayah(1, 15_000),
      seg('s1b', { surah: 2, ayah: 1, startMs: 20_000, endMs: 24_000 }),
      ayah(2, 30_000),
      ayah(3, 35_000),
      ayah(4, 38_000),
      ayah(5, 3_700_000)
    ]
    expect(youtubeChapters(project(segs), 'Al-Baqarah')).toEqual([
      "0:00 Isti'adzah",
      '0:15 QS Al-Baqarah 2:1',
      '0:30 QS Al-Baqarah 2:2–4',
      '1:01:40 QS Al-Baqarah 2:5'
    ])
  })

  it('folds a too-short last chapter when the duration is known', () => {
    const segs = [ayah(1, 0), ayah(2, 20_000)]
    expect(youtubeChapters(project(segs), '', 25_000)).toEqual(['0:00 QS 2:1–2'])
    expect(youtubeChapters(project([]), 'x')).toEqual([])
  })
})
