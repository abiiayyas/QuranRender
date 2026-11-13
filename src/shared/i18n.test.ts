import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getLang, msg, setLang, t } from './i18n'
import { en, parts } from './i18n/en'

/** Every `t('…')` and `msg('…')` with a plain string literal in the app sources. */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name !== 'i18n') walk(path)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.ts$/.test(name)) continue
      const src = readFileSync(path, 'utf8')
      const re = /(?<![\w.$])(?:t|msg)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$]*)`)/g
      for (const m of src.matchAll(re)) {
        const raw = m[1] ?? m[2] ?? m[3]
        const key = raw.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')
        if (!found.has(key)) found.set(key, path)
      }
    }
  }
  walk('src')
  return found
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('t', () => {
  afterEach(() => setLang('id'))

  it('returns the Indonesian key as is, with placeholders filled', () => {
    expect(t('Halo {name}', { name: 'Ayu' })).toBe('Halo Ayu')
  })

  it('falls back to Indonesian when English has no entry', () => {
    setLang('en')
    expect(t('kalimat yang belum diterjemahkan')).toBe('kalimat yang belum diterjemahkan')
  })

  it('picks the plural form from n in English', () => {
    setLang('en')
    const key = Object.keys(en).find((k) => en[k].includes('|'))
    if (!key) return
    expect(t(key, { n: 1 })).not.toContain('|')
    expect(t(key, { n: 2 })).not.toContain('|')
    expect(t(key, { n: 1 })).not.toBe(t(key, { n: 2 }))
  })

  it('marks messages without changing them', () => {
    expect(msg('Simpan')).toBe('Simpan')
    expect(getLang()).toBe('id')
  })
})

describe('English dictionary', () => {
  const used = usedKeys()

  it('has an entry for every message in the code', () => {
    const missing = [...used].filter(([k]) => !(k in en)).map(([k, f]) => `${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('has no entry that the code no longer uses', () => {
    expect(Object.keys(en).filter((k) => !used.has(k))).toEqual([])
  })

  it('agrees with itself where a key appears in two areas', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const dict of Object.values(parts)) {
      for (const [k, v] of Object.entries(dict)) {
        if (seen.has(k) && seen.get(k) !== v) clashes.push(k)
        seen.set(k, v)
      }
    }
    expect(clashes).toEqual([])
  })

  it('keeps the same placeholders as the Indonesian key, in every plural form', () => {
    const bad: string[] = []
    for (const [k, v] of Object.entries(en)) {
      for (const form of v.split('|')) if (placeholders(form).join() !== placeholders(k).join()) bad.push(k)
    }
    expect(bad).toEqual([])
  })
})
