import '../../../design/system/tokens.css'
import '../../../design/system/components.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setLang } from '@shared/i18n'
import { App } from './App'
import { applyLanguage } from './lib/language'
import { applyTheme } from './lib/theme'
import { useApp } from './store/app'

// A file dropped outside a drop target must never open in place of the app.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

/** The key remounts everything on a language change: text is translated while rendering, so a fresh tree is the whole job. */
function Root() {
  const lang = useApp((s) => s.lang)
  return <App key={lang} />
}

// Render only once the language is known, or the first paint would flash in the wrong one.
void window.api.settings.get().then((s) => {
  applyTheme(s.theme)
  setLang(s.language)
  applyLanguage(s.language)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>
  )
})
