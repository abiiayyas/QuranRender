import { OPENDUA_EDITION, duaTexts, duaVerses } from '@shared/dua'
import { fillTranslations } from '@shared/translation'
import type { Segment } from '@shared/types'
import { useProject } from '../../../store/project'

/** `[surah, [fromAyah, toAyah]]` */
export type AyahSpan = [number, [number, number]]

/** Ayah span per surah the segments show, plus 1:1 when a basmalah segment exists. */
export function spansOf(segments: ReadonlyArray<Segment>): AyahSpan[] {
  const spans = new Map<number, [number, number]>()
  const add = (s: number, a: number): void => {
    const cur = spans.get(s)
    spans.set(s, cur ? [Math.min(cur[0], a), Math.max(cur[1], a)] : [a, a])
  }
  for (const s of segments) {
    if (s.kind === 'ayah') add(s.surah, s.ayah)
    else if (s.kind === 'basmalah') add(1, 1)
  }
  return [...spans]
}

const textCache = new Map<string, Promise<Record<string, string>>>()

/** Whole-ayah texts of an edition over the spans, cached for the session (installed texts do not change). */
export async function editionTexts(editionId: string, spans: AyahSpan[]): Promise<Record<string, string>> {
  const parts = spans.map(([s, [f, t]]) => {
    const key = `${editionId}|${s}:${f}-${t}`
    let p = textCache.get(key)
    if (!p) {
      p = window.api.text.verses(editionId, s, f, t)
      p.catch(() => textCache.delete(key))
      textCache.set(key, p)
    }
    return p
  })
  return Object.assign({}, ...(await Promise.all(parts))) as Record<string, string>
}

/**
 * Fills translation entries of `editionIds` for every segment (see `fillTranslations`) as one undoable edit.
 * Returns how many segments changed.
 */
export async function fillProject(editionIds: string[]): Promise<number> {
  const before = useProject.getState().project
  if (!before || editionIds.length === 0 || before.segments.length === 0) return 0
  const spans = spansOf(before.segments)

  const counts: Record<string, number> = {}
  for (const [key, verse] of Object.entries(duaVerses(before.dua))) counts[key] = verse.words.length
  for (const [s, [f, t]] of spans)
    for (const v of await window.api.quran.verses(s, f, t, 'kemenag')) counts[`${v.surah}:${v.ayah}`] = v.words.length
  const dTexts = duaTexts(before.dua)
  const texts = await Promise.all(
    editionIds.map((ed) => (ed === OPENDUA_EDITION ? Promise.resolve(dTexts) : editionTexts(ed, spans)))
  )

  // The user may have edited while the texts loaded: fill the current segments.
  const project = useProject.getState().project
  if (!project || project.id !== before.id) return 0
  let segments = project.segments
  editionIds.forEach((ed, i) => (segments = fillTranslations(segments, ed, texts[i], counts)))
  const changed = segments.filter((s, i) => s !== project.segments[i]).length
  if (changed > 0) useProject.getState().update({ segments })
  return changed
}
