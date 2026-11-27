import { describe, expect, it } from 'vitest'
import { autoSplit } from './autosplit'
import {
  OPENDUA_CREDIT,
  OPENDUA_EDITION,
  buildDuaSegments,
  duaTexts,
  duaVerses,
  parseOpenDuaCatalogue,
  type DuaInfo
} from './dua'
import { checkExport } from './policy'
import { draftFor, withDuaCredit, type PublishFacts } from './publish'
import { canMerge, mergeSegments, needsReview, relabel, segmentLabel, splitSegmentAt } from './segments'
import { segmentArabic, toSrt, toVtt, youtubeChapters } from './subtitles'
import { defaultThumbnail } from './thumbnail'
import { fillTranslations } from './translation'
import { DEFAULT_STYLE } from './style'
import type { Project } from './types'

const SAMPLE_CATALOGUE = {
  defaultReciterId: 'reciter-0001',
  chapters: [
    { id: 'ch-1', number: 1, title: 'When you wake up' },
    { id: 'ch-2', number: 2, title: 'When sneezing' }
  ],
  reciters: [{ id: 'reciter-0001', name: 'Muhammad Jumah' }],
  entries: [
    {
      id: 'entry-no-audio',
      title: 'Entry without audio',
      chapterId: 'ch-1',
      variations: [
        {
          id: 'standard',
          steps: [{ type: 'recitation', items: [{ dua: { id: 'd-0', arabic: 'بِسْمِ اللَّهِ', translation: 'In the name of Allah.' } }], recordings: [] }]
        }
      ]
    },
    {
      id: 'entry-bad-host',
      title: 'Entry with untrusted audio URL',
      chapterId: 'ch-1',
      variations: [
        {
          id: 'standard',
          steps: [
            {
              type: 'recitation',
              items: [{ dua: { id: 'd-bad', arabic: 'الْحَمْدُ لِلَّهِ', translation: 'Praise be to Allah.' } }],
              recordings: [{ reciterId: 'reciter-0001', url: 'https://example.com/a.mp3', durationSeconds: 5 }]
            }
          ]
        }
      ]
    },
    {
      id: 'entry-2',
      title: 'When sneezing',
      chapterId: 'ch-2',
      variations: [
        {
          id: 'standard',
          steps: [
            { type: 'instruction', text: 'Say this:' },
            {
              type: 'recitation',
              items: [{ dua: { id: 'd-2a', arabic: 'الْحَمْدُ لِلَّهِ', translation: 'All praise is for Allah.' } }],
              recordings: [{ reciterId: 'reciter-0001', url: 'https://audio.opendua.org/hisn/v0.0.2/OD-188-1.mp3', durationSeconds: 2 }]
            },
            {
              type: 'recitation',
              items: [{ dua: { id: 'd-2b', arabic: 'يَرْحَمُكَ اللَّهُ', translation: 'May Allah have mercy upon you.' } }],
              recordings: [{ reciterId: 'reciter-0001', url: 'https://audio.opendua.org/hisn/v0.0.2/OD-188-2.mp3', durationSeconds: 3 }]
            }
          ]
        }
      ]
    },
    {
      id: 'entry-1',
      title: 'Waking up',
      chapterId: 'ch-1',
      variations: [
        {
          id: 'standard',
          steps: [
            {
              type: 'recitation',
              items: [
                { dua: { id: 'd-1', arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا', translation: 'All praise is for Allah who gave us life after taking it.' } }
              ],
              recordings: [{ reciterId: 'reciter-0001', url: 'https://audio.opendua.org/hisn/v0.0.2/OD-001.mp3', durationSeconds: 10 }]
            }
          ]
        }
      ]
    }
  ]
}

function makeProject(dua: DuaInfo): Project {
  const segments = buildDuaSegments(
    dua.items.map((it) => ({ itemId: it.id, wordCount: it.words.length, translation: it.translation, durationMs: 12_000 })),
    (() => {
      let n = 0
      return () => `seg-${++n}`
    })()
  )
  return {
    id: 'p1',
    title: dua.title,
    step: 2,
    status: 'synced',
    aspect: '9:16',
    surah: null,
    ayahFrom: null,
    ayahTo: null,
    reciter: dua.reciter,
    script: 'kemenag',
    editions: [OPENDUA_EDITION],
    sourceAssetId: 'a1',
    segments,
    dua,
    style: { ...DEFAULT_STYLE },
    background: { kind: 'color', color: '#101114', assetId: null, dim: 0.35, blur: 0 },
    overlays: [],
    createdAt: 1,
    updatedAt: 1
  }
}

describe('parseOpenDuaCatalogue', () => {
  it('filters out entries without valid OpenDua audio and sorts by chapter number', () => {
    const entries = parseOpenDuaCatalogue(SAMPLE_CATALOGUE)
    expect(entries.map((e) => e.id)).toEqual(['entry-1', 'entry-2'])
    expect(entries[0].clips[0].words).toEqual(['الْحَمْدُ', 'لِلَّهِ', 'الَّذِي', 'أَحْيَانَا', 'بَعْدَ', 'مَا', 'أَمَاتَنَا'])
    expect(entries[1].clips).toHaveLength(2)
    expect(entries[1].durationSeconds).toBe(5)
  })
})

describe('dua segments & workflow integration', () => {
  const dua: DuaInfo = {
    entryId: 'entry-1',
    title: 'Waking up',
    chapterTitle: 'When you wake up',
    reciter: 'Muhammad Jumah',
    items: [
      {
        id: 'd-1',
        words: ['الْحَمْدُ', 'لِلَّهِ', 'الَّذِي', 'أَحْيَانَا', 'بَعْدَ', 'مَا', 'أَمَاتَنَا'],
        translation: 'All praise is for Allah, who gave us life after taking it.'
      }
    ]
  }

  it('builds contiguous dua segments with no word timings and passes export check', () => {
    const project = makeProject(dua)
    const verses = duaVerses(dua)
    expect(project.segments).toHaveLength(1)
    expect(project.segments[0].words).toEqual([])
    expect(needsReview(project.segments[0])).toBe(false)
    expect(segmentLabel(project.segments[0], 7)).toBe('Doa')
    expect(checkExport(project, { sourceOk: true, verses })).toEqual([])
  })

  it('splits, merges, relabels, auto-splits, and fills translations for long duas', () => {
    const project = makeProject(dua)
    const verses = duaVerses(dua)
    const orig = project.segments[0]

    const halves = splitSegmentAt(orig, 6000, 7)
    expect(halves).not.toBeNull()
    const [head, tail] = halves!
    expect(head.kind).toBe('dua')
    expect(head.duaId).toBe('d-1')
    expect(head.wordFrom).toBe(1)
    expect(tail.wordFrom).toBe(head.wordTo + 1)
    expect(segmentLabel(head, 7)).toBe(`Doa (1–${head.wordTo})`)
    expect(canMerge(head, tail)).toBe(true)

    const merged = mergeSegments(head, tail)
    expect(merged?.wordFrom).toBe(1)
    expect(merged?.wordTo).toBe(7)

    const relabeled = relabel(head, { kind: 'dua', surah: 0, ayah: 0, wordFrom: 1, wordTo: 4 }, verses['dua:d-1'])
    expect(relabeled.words).toEqual([])
    expect(relabeled.wordTo).toBe(4)

    const filled = fillTranslations([head, tail], OPENDUA_EDITION, duaTexts(dua), { 'dua:d-1': 7 })
    expect(filled.every((s) => s.translations[0]?.edition === OPENDUA_EDITION)).toBe(true)

    const splitParts = autoSplit(orig, verses['dua:d-1'], (p) => p.wordTo - p.wordFrom + 1 <= 4)
    expect(splitParts.length).toBeGreaterThan(1)
    expect(splitParts.every((p) => p.kind === 'dua' && p.words.length === 0)).toBe(true)

    expect(segmentArabic(head, verses)).toBe(dua.items[0].words.slice(0, head.wordTo).join(' '))
  })

  it('produces SRT, VTT, chapters, thumbnail, and CC BY 4.0 publish copy for dua projects', () => {
    const project = makeProject(dua)
    const verses = duaVerses(dua)
    expect(toSrt(project, verses, 'both')).toContain('All praise is for Allah')
    expect(toVtt(project, verses, 'arabic')).toContain('الْحَمْدُ لِلَّهِ')
    expect(youtubeChapters(project, dua.title, 12_000)).toEqual(['0:00 Waking up'])

    const thumb = defaultThumbnail(project, null)
    expect(thumb.title).toBe('Waking up')
    expect(thumb.subtitle).toBe('Muhammad Jumah')

    const facts: PublishFacts = {
      surahName: dua.title,
      ayahLabel: '',
      duaTitle: dua.title,
      duaCredit: OPENDUA_CREDIT,
      reciter: dua.reciter,
      translationName: 'OpenDua English',
      audioSource: 'OpenDua (CC BY 4.0)'
    }
    const draft = draftFor('youtube', facts)
    expect(draft.body).toContain(OPENDUA_CREDIT)
    expect(draft.hashtags).toContain('#Doa')
    expect(withDuaCredit({ title: 'T', body: 'Custom copy', hashtags: '#Doa' }, OPENDUA_CREDIT).body).toContain(OPENDUA_CREDIT)
  })
})
