import { describe, expect, it } from 'vitest'
import { buildCliPrompt, checkModel, extractJson, fillCommand, openaiImageSize, parseRetryAfterMs, pollinationsSize, pollinationsUrl, resetDelayMs, sniffImage } from './aiTools'

describe('extractJson', () => {
  it('reads plain, fenced and noisy replies', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('Here you go:\n```json\n{"a": [1, 2]}\n```\nHope that helps!')).toEqual({ a: [1, 2] })
    expect(extractJson('<think>maybe {x}</think>Sure. {"fragments":[{"id":"1","fragment":"x"}]} Done.')).toEqual({ fragments: [{ id: '1', fragment: 'x' }] })
  })

  it('throws when there is no JSON', () => {
    expect(() => extractJson('I cannot do that.')).toThrow()
    expect(() => extractJson('{broken')).toThrow()
  })
})

describe('buildCliPrompt', () => {
  it('merges system and user messages and asks for JSON only when needed', () => {
    const p = buildCliPrompt(
      [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hello' }
      ],
      true
    )
    expect(p.indexOf('You are terse.')).toBeLessThan(p.indexOf('Hello'))
    expect(p).toContain('Reply with JSON only')
    expect(buildCliPrompt([{ role: 'user', content: 'Hello' }], false)).not.toContain('JSON')
  })

  it('keeps the roles of a longer conversation', () => {
    const p = buildCliPrompt(
      [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' }
      ],
      false
    )
    expect(p).toContain('[assistant]\ntwo')
  })
})

describe('resetDelayMs', () => {
  it('reads hours and minutes', () => {
    expect(resetDelayMs('resets after approximately 2 hours and 42 minutes')).toBe((2 * 60 + 42) * 60_000)
    expect(resetDelayMs('try again in 5 min')).toBe(5 * 60_000)
    expect(resetDelayMs('quota exhausted')).toBeNull()
  })
})

describe('command and model checks', () => {
  it('rejects model names that need shell quoting', () => {
    expect(() => checkModel('anthropic/claude-3.5:sonnet')).not.toThrow()
    expect(() => checkModel('x; rm -rf ~')).toThrow()
  })

  it('fills {model} and refuses a dangling one', () => {
    expect(fillCommand('mycli --model {model}', 'm1')).toBe('mycli --model m1')
    expect(() => fillCommand('mycli --model {model}', '')).toThrow()
    expect(fillCommand('mycli', '')).toBe('mycli')
    expect(() => fillCommand('  ', '')).toThrow()
  })
})

describe('image sizes', () => {
  it('keeps Pollinations within its 768 x 768 area', () => {
    for (const a of ['9:16', '16:9', '1:1'] as const) {
      const { width, height } = pollinationsSize(a)
      expect(width * height).toBeLessThanOrEqual(768 * 768)
    }
    expect(pollinationsSize('9:16').height).toBeGreaterThan(pollinationsSize('9:16').width)
    expect(pollinationsSize('16:9').width).toBeGreaterThan(pollinationsSize('16:9').height)
  })

  it('picks sizes the OpenAI-style models accept', () => {
    expect(openaiImageSize('dall-e-3', '9:16')).toBe('1024x1792')
    expect(openaiImageSize('gpt-image-1', '9:16')).toBe('1024x1536')
    expect(openaiImageSize('gpt-image-1', '16:9')).toBe('1536x1024')
    expect(openaiImageSize('anything', '1:1')).toBe('1024x1024')
  })
})

describe('sniffImage', () => {
  const pad = (b: number[]): Uint8Array => Uint8Array.from([...b, ...new Array(16).fill(0)])
  it('recognises PNG, JPEG and WebP by magic bytes', () => {
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47]))?.ext).toBe('png')
    expect(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg')
    expect(sniffImage(Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), 0, 0]))?.ext).toBe('webp')
  })

  it('rejects anything else, such as an HTML error page', () => {
    expect(sniffImage(Buffer.from('<html><body>Rate limited</body></html>'))).toBeNull()
  })
})

describe('Pollinations request', () => {
  it('puts the encoded prompt in the path and the size in the query', () => {
    const u = new URL(pollinationsUrl('calm sea / no people?', '9:16', '', 7))
    expect(decodeURIComponent(u.pathname.replace('/prompt/', ''))).toBe('calm sea / no people?')
    expect(u.searchParams.get('width')).toBe('576')
    expect(u.searchParams.get('height')).toBe('1024')
    expect(u.searchParams.get('seed')).toBe('7')
    expect(u.searchParams.has('model')).toBe(false)
  })

  it('sends a model only when one is chosen', () => {
    expect(new URL(pollinationsUrl('x', '1:1', ' flux ', 1)).searchParams.get('model')).toBe('flux')
  })

  it('reads Retry-After seconds', () => {
    expect(parseRetryAfterMs('37')).toBe(37_000)
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull()
  })
})
