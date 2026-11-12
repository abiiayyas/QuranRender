import type { Settings } from '@shared/types'

/** "system" removes the attribute so tokens.css follows prefers-color-scheme. */
export function applyTheme(t: Settings['theme']): void {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}
