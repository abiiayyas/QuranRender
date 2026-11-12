import { describe, expect, it } from 'vitest'
import type { Segment } from './types'
import { acceptFragment, autoTrim, cleanTranslation, fillTranslations, isPartial } from './translation'

const seg = (p: Partial<Segment>): Segment => ({
  id: 's',
  kind: 'ayah',
  surah: 2,
  ayah: 282,
  wordFrom: 1,
  wordTo: 20,
  startMs: 0,
  endMs: 1000,
  confidence: 1,
  source: 'manual',
  words: [],
  translations: [],
  ...p
})

const DEBT =
  'O you who have believed, when you contract a debt for a specified term, write it down. And let a scribe write [it] between you in justice.'

describe('cleanTranslation', () => {
  it('drops footnote markers and keeps text', () => {
    expect(
      cleanTranslation('In the name of Allāh,<sup foot_note=195932>1</sup> the Entirely Merciful, the Especially Merciful.<sup foot_note=195931>2</sup>')
    ).toBe('In the name of Allāh, the Entirely Merciful, the Especially Merciful.')
  })
  it('collapses a marker nested inside another and glued footnote digits (King Fahad 1:2)', () => {
    expect(cleanTranslation('Segala puji<sup foot_note=682<sup foot_note=209772>2</sup>2>1</sup> bagi Allah, Tuhan3 semesta alam.')).toBe(
      'Segala puji bagi Allah, Tuhan semesta alam.'
    )
  })
  it('keeps text of other tags and treats tags as word breaks', () => {
    expect(cleanTranslation('<span class="h">Master<sup foot_note="79577" class="qiraat">1</sup> </span>of the Day.')).toBe('Master of the Day.')
    expect(cleanTranslation('sent down to you<a class="sup"><sup>sg </sup></a>and what')).toBe('sent down to you and what')
    expect(cleanTranslation('do you kill<sup foot_note="79617">1</sup>Allah’s prophets')).toBe('do you kill Allah’s prophets')
    expect(cleanTranslation('For<span class="h">He has</span>, and<i class="s">(those) </i>whom')).toBe('For He has, and (those) whom')
    expect(cleanTranslation('<p>Tom &amp; Jerry &quot;x&quot;</p>')).toBe('Tom & Jerry "x"')
  })
})

describe('isPartial', () => {
  it('detects partial ayah segments only', () => {
    expect(isPartial(seg({ wordFrom: 1, wordTo: 20 }), 20)).toBe(false)
    expect(isPartial(seg({ wordFrom: 1, wordTo: 4 }), 20)).toBe(true)
    expect(isPartial(seg({ wordFrom: 5, wordTo: 20 }), 20)).toBe(true)
    expect(isPartial(seg({ kind: 'basmalah', wordFrom: 0, wordTo: 0 }), 4)).toBe(false)
  })
})

describe('autoTrim', () => {
  it('snaps to punctuation and joins without gaps', () => {
    const first = autoTrim(DEBT, 1, 4, 20)
    const second = autoTrim(DEBT, 5, 12, 20)
    const third = autoTrim(DEBT, 13, 20, 20)
    expect(first).toEqual({ text: 'O you who have believed,', confident: true })
    expect(second.text.endsWith('write it down.')).toBe(true)
    expect([first.text, second.text, third.text].join(' ')).toBe(DEBT)
  })
  it('is not confident without punctuation nearby', () => {
    const r = autoTrim('alpha beta gamma delta epsilon zeta eta theta', 1, 2, 4)
    expect(r).toEqual({ text: 'alpha beta gamma delta', confident: false })
    expect(autoTrim('dua kata', 5, 5, 9)).toEqual({ text: 'dua', confident: false })
  })
})

describe('fillTranslations', () => {
  const texts = { '2:282': DEBT, '1:1': 'In the name of Allah, the Entirely Merciful, the Especially Merciful.' }
  const counts = { '2:282': 20 }

  it('uses the whole text for a full ayah', () => {
    const [s] = fillTranslations([seg({})], 'en.qdc20', texts, counts)
    expect(s.translations).toEqual([{ edition: 'en.qdc20', text: DEBT, status: 'full' }])
  })

  it('cuts partial ayahs by rule, or marks them for review', () => {
    const [a, b] = fillTranslations([seg({ wordTo: 4 }), seg({ id: 'b', wordFrom: 1, wordTo: 7 })], 'en.qdc20', texts, counts)
    expect(a.translations[0]).toEqual({ edition: 'en.qdc20', text: 'O you who have believed,', status: 'auto' })
    expect(b.translations[0]).toEqual({ edition: 'en.qdc20', text: DEBT, status: 'review' })
  })

  it('keeps manual edits and AI cuts, recomputes review entries', () => {
    const manual = seg({ translations: [{ edition: 'en.qdc20', text: 'Mine', status: 'manual' }] })
    const ai = seg({ wordTo: 4, translations: [{ edition: 'en.qdc20', text: 'O you who have believed', status: 'ai' }] })
    const review = seg({ wordTo: 4, translations: [{ edition: 'en.qdc20', text: DEBT, status: 'review' }] })
    const out = fillTranslations([manual, ai, review], 'en.qdc20', texts, counts)
    expect(out[0]).toBe(manual)
    expect(out[1]).toBe(ai)
    expect(out[2].translations[0].status).toBe('auto')
  })

  it('leaves other editions alone and skips ayahs without text', () => {
    const other = { edition: 'id.kemenag', text: 'Wahai orang-orang yang beriman', status: 'full' as const }
    const [s, missing] = fillTranslations([seg({ translations: [other] }), seg({ surah: 3, ayah: 1 })], 'en.qdc20', texts, counts)
    expect(s.translations).toEqual([other, { edition: 'en.qdc20', text: DEBT, status: 'full' }])
    expect(missing.translations).toEqual([])
  })

  it("uses the edition's 1:1 for basmalah and a fixed text for isti'adzah", () => {
    const special = [seg({ kind: 'basmalah', surah: 0, ayah: 0, wordFrom: 0, wordTo: 0 }), seg({ kind: 'istiadzah', surah: 0, ayah: 0, wordFrom: 0, wordTo: 0 })]
    const [b, i] = fillTranslations(special, 'en.qdc20', texts, counts)
    expect(b.translations[0]).toEqual({ edition: 'en.qdc20', text: texts['1:1'], status: 'full' })
    expect(i.translations[0]).toEqual({ edition: 'en.qdc20', text: 'I seek refuge with Allah from the accursed Satan.', status: 'full' })
    const [, id] = fillTranslations(special, 'id.kemenag', {}, {})
    expect(id.translations[0]).toEqual({ edition: 'id.kemenag', text: 'Aku berlindung kepada Allah dari setan yang terkutuk.', status: 'full' })
    const [, fr] = fillTranslations(special, 'fr.qdc31', {}, {})
    expect(fr.translations[0].status).toBe('review')
  })
})

describe('acceptFragment', () => {
  it('accepts pieces of the full text, tolerating punctuation and diacritics', () => {
    expect(acceptFragment(' O you who have  believed ', DEBT)).toBe('O you who have believed')
    expect(acceptFragment('in the name of Allah', 'In the name of Allāh, the Merciful')).toBe('in the name of Allah')
  })
  it('rejects paraphrases, partial words and non-strings', () => {
    expect(acceptFragment('O believers', DEBT)).toBeNull()
    expect(acceptFragment('you who have belie', DEBT)).toBeNull()
    expect(acceptFragment('', DEBT)).toBeNull()
    expect(acceptFragment(3, DEBT)).toBeNull()
  })
})
