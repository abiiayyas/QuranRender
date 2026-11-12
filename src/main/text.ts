import { startAiTrim } from './aiTrim'
import { handle } from './ipc'
import { editionVerses, installEdition, listEditions, removeEdition } from './translations'

export function registerTextIpc(): void {
  handle('text', 'editions', () => listEditions())
  handle('text', 'install', (editionId) => installEdition(editionId))
  handle('text', 'remove', (editionId) => removeEdition(editionId))
  handle('text', 'verses', (editionId, surah, from, to) => editionVerses(editionId, surah, from, to))
  handle('text', 'aiTrim', (projectId, editionId, segmentIds) => startAiTrim(projectId, editionId, segmentIds))
}
