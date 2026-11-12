import '../../../design/system/tokens.css'
import '../../../design/system/components.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme } from './lib/theme'

void window.api.settings.get().then((s) => applyTheme(s.theme))

// A file dropped outside a drop target must never open in place of the app.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
