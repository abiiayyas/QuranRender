import { describe, expect, it } from 'vitest'
import { draftFor, hashtagOf, kitAsText, pastedText, sanitizeKit, type PublishFacts } from './publish'
import { defaultThumbnail, gridBands, splitAccent } from './thumbnail'

const facts: PublishFacts = { surahName: 'Al-Fatihah', ayahLabel: '1–7', reciter: 'Mishary Alafasy', translationName: 'Kemenag RI', audioSource: 'Quran.com' }

describe('publish drafts', () => {
  it('builds hashtags without punctuation', () => {
    expect(hashtagOf('Al-Fatihah')).toBe('#AlFatihah')
    expect(hashtagOf("An-Nisa'")).toBe('#AnNisa')
    expect(hashtagOf('  ')).toBe('')
  })

  it('writes attribution and only gives a title to platforms that have one', () => {
    const shorts = draftFor('shorts', facts)
    expect(shorts.title).toBe('QS Al-Fatihah ayat 1–7 oleh Mishary Alafasy')
    expect(shorts.body).toContain('Terjemahan: Kemenag RI.')
    expect(shorts.body).toContain('Sumber audio: Quran.com.')
    expect(shorts.hashtags).toBe('#Quran #Tilawah #AlFatihah #MisharyAlafasy')
    expect(draftFor('tiktok', facts).title).toBe('')
  })

  it('adds #Shorts once and chapters only to YouTube with at least three', () => {
    const d = { title: 't', body: 'isi', hashtags: '#Quran #shorts' }
    expect(pastedText('shorts', d)).toBe('isi\n\n#Quran #shorts')
    expect(pastedText('shorts', { ...d, hashtags: '#Quran' })).toBe('isi\n\n#Quran #Shorts')
    const ch = ['0:00 QS 1:1', '0:16 QS 1:3', '0:32 QS 1:5']
    expect(pastedText('youtube', d, ch)).toContain('Bab:\n0:00 QS 1:1')
    expect(pastedText('youtube', d, ch.slice(0, 2))).not.toContain('Bab:')
    expect(pastedText('reels', d, ch)).not.toContain('Bab:')
  })

  it('exports every drafted platform in form order', () => {
    const txt = kitAsText({ youtube: draftFor('youtube', facts), tiktok: draftFor('tiktok', facts) }, () => [])
    expect(txt.indexOf('=== TikTok ===')).toBeLessThan(txt.indexOf('=== YouTube ==='))
    expect(txt).toContain('Judul:\nQS Al-Fatihah')
  })
})

describe('sanitizeKit', () => {
  const fb = (id: Parameters<typeof draftFor>[0]) => draftFor(id, facts)
  it('keeps clean replies, trimmed to the limits', () => {
    const kit = sanitizeKit({ shorts: { title: 'x'.repeat(150), body: 'Tilawah indah.', hashtags: '#Quran #Tilawah tanpa' } }, ['shorts'], fb)
    expect(kit.shorts!.title).toHaveLength(100)
    expect(kit.shorts!.hashtags).toBe('#Quran #Tilawah')
  })
  it('drops a platform whose reply contains Arabic, and one that is missing or empty', () => {
    const kit = sanitizeKit({ shorts: { title: 'Judul', body: 'بِسْمِ ٱللَّهِ', hashtags: '#a' }, tiktok: { title: '', body: ' ', hashtags: '' } }, ['shorts', 'tiktok', 'reels'], fb)
    expect(kit.shorts).toEqual(fb('shorts'))
    expect(kit.tiktok).toEqual(fb('tiktok'))
    expect(kit.reels).toEqual(fb('reels'))
  })
  it('survives a reply that is not an object', () => {
    expect(sanitizeKit('oops', ['reels'], fb).reels).toEqual(fb('reels'))
  })
})

describe('thumbnail', () => {
  it('colours the last word', () => {
    expect(splitAccent('Surah Al-Mulk')).toEqual({ head: 'Surah', last: 'Al-Mulk' })
    expect(splitAccent('Satu')).toEqual({ head: '', last: 'Satu' })
  })
  it('defaults to the surah, the reciter, and an image background when there is one', () => {
    const base = { surah: 67, ayahFrom: 1, ayahTo: 10, reciter: '', background: { kind: 'image' as const, color: '#000', assetId: 'a1', dim: 0, blur: 0 } }
    expect(defaultThumbnail(base, 'Al-Mulk')).toMatchObject({ title: 'Surah Al-Mulk', subtitle: 'Ayat 1–10', assetId: 'a1' })
    expect(defaultThumbnail({ ...base, background: { ...base.background, kind: 'color' } }, null).assetId).toBeNull()
  })
  it('marks the Instagram grid crop only on 9:16', () => {
    expect(gridBands('9:16')).toEqual({ top: 0.125, bottom: 0.125 })
    expect(gridBands('16:9')).toBeNull()
  })
})
