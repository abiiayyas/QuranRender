import { ai } from './ai'
import { components } from './components'
import { dialogs } from './dialogs'
import { editor } from './editor'
import { home } from './home'
import { main } from './main'
import { remotion } from './remotion'
import { settings } from './settings'
import { shared } from './shared'
import { source } from './source'
import { storage } from './storage'
import { sync } from './sync'
import { text } from './text'
import type { Dict } from './types'

/** One file per area, so work on different screens never touches the same file. Duplicate keys must agree (tested). */
export const parts: Record<string, Dict> = { ai, components, dialogs, editor, home, main, remotion, settings, shared, source, storage, sync, text }

export const en: Dict = Object.assign({}, ...Object.values(parts))
