import { en } from './i18n/en'

/**
 * UI language. Indonesian is the source language: the key of every message is its Indonesian text, so the code reads as it
 * always did and a missing English entry falls back to Indonesian instead of showing an id. English lives in
 * `src/shared/i18n/en/*.ts`; the test in `src/shared/i18n.test.ts` fails when a translated message has no entry there.
 */
export type Lang = 'id' | 'en'

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'en', label: 'English' }
]

let current: Lang = 'id'

export const isLang = (v: unknown): v is Lang => v === 'id' || v === 'en'
export const getLang = (): Lang => current
export function setLang(lang: Lang): void {
  current = lang
}

/** BCP 47 tag for dates, number formats and sorting in the current language. */
export const locale = (): string => (current === 'en' ? 'en-US' : 'id-ID')

export type Vars = Record<string, string | number>

/**
 * Translates `key`, an Indonesian message. `{name}` placeholders are filled from `vars`. An English entry may hold two
 * forms split by `|` ("{n} segment|{n} segments"): the first when `vars.n` is 1, else the second.
 *
 * Call it where the text is shown, never at module load: the language can change while the app runs.
 */
export function t(key: string, vars?: Vars): string {
  let text = key
  if (current === 'en') {
    const hit = en[key]
    if (hit !== undefined) {
      const forms = hit.split('|')
      text = forms.length > 1 && typeof vars?.n === 'number' ? (vars.n === 1 ? forms[0] : forms[1]) : hit
    }
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text
}

/**
 * Marks a message that is shown later (a label in a constant table, say) and returns it unchanged. The extractor in the
 * tests counts it like `t`; the table's reader calls `t(label)` when rendering.
 */
export function msg<T extends string>(key: T): T {
  return key
}
