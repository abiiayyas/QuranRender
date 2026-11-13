import { setLang, type Lang } from '@shared/i18n'
import { useApp } from '../store/app'

/** Makes `lang` the language of the whole renderer: message lookups, the document, and a fresh render of every screen. */
export function applyLanguage(lang: Lang): void {
  setLang(lang)
  document.documentElement.lang = lang
  useApp.setState({ lang })
}
