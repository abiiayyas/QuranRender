import { ALIGNER_MAP, WORD_MAP, type WordMapEntry } from './wordMap'

const index = (map: readonly WordMapEntry[]): Map<string, WordMapEntry> => new Map(map.map((e) => [`${e[0]}:${e[1]}`, e]))
const datasetMap = index(WORD_MAP)
const alignerMap = index(ALIGNER_MAP)

/** Canonical word count of an ayah given its Kemenag dataset word count. */
export function canonicalCount(surah: number, ayah: number, datasetCount: number): number {
  return datasetMap.get(`${surah}:${ayah}`)?.[2] ?? datasetCount
}

/**
 * Canonical word number (1-based) of a cloud aligner (Digital Khatt) word number. Aligner words that share
 * one canonical word map to the same number; for a canonical word split in the aligner, the first one wins.
 */
export function alignerToCanonical(surah: number, ayah: number, alignerWord: number): number {
  const entry = alignerMap.get(`${surah}:${ayah}`)
  if (!entry) return alignerWord
  let shift = 0
  for (const [cFirst, cCount, aFirst, aCount] of entry[4]) {
    if (alignerWord < aFirst) break
    if (alignerWord < aFirst + aCount) return cFirst + Math.min(alignerWord - aFirst, cCount - 1)
    shift = cFirst + cCount - (aFirst + aCount)
  }
  return alignerWord + shift
}

/**
 * Spreads Kemenag dataset words over canonical word slots. Several dataset words in one slot are joined
 * with a space; one dataset word over several slots fills the first and leaves '' (joined) in the rest.
 */
export function toCanonicalSlots(surah: number, ayah: number, datasetWords: string[]): string[] {
  const entry = datasetMap.get(`${surah}:${ayah}`)
  if (!entry) return datasetWords.slice()
  const [, , canonical, dataset, groups] = entry
  if (datasetWords.length !== dataset) {
    throw new Error(`Jumlah kata ayat ${surah}:${ayah} tidak sesuai peta kata (${datasetWords.length}, seharusnya ${dataset}).`)
  }
  const slots: string[] = []
  let d = 0
  for (const [cFirst, cCount, dFirst, dCount] of groups) {
    while (slots.length < cFirst - 1) slots.push(datasetWords[d++])
    if (d !== dFirst - 1) throw new Error(`Peta kata ayat ${surah}:${ayah} tidak konsisten.`)
    slots.push(datasetWords.slice(d, d + dCount).join(' '))
    for (let i = 1; i < cCount; i++) slots.push('')
    d += dCount
  }
  while (d < datasetWords.length) slots.push(datasetWords[d++])
  if (slots.length !== canonical) throw new Error(`Peta kata ayat ${surah}:${ayah} tidak konsisten.`)
  return slots
}
