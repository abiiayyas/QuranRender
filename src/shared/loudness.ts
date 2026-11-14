/** Rate the loudness analysis runs at: the voice band is what matters, and a long recording stays cheap to decode. */
export const LOUDNESS_RATE = 16000
/** How much of a recording is measured. Enough to know how loud the reciter is; a two-hour file is not decoded whole. */
export const LOUDNESS_MAX_SECONDS = 1200

const BLOCK_SECONDS = 0.4
/** Blocks quieter than this are silence, never part of the level. */
const ABSOLUTE_GATE_DB = -70
/** Then blocks this far under the average of the rest (pauses between verses, breaths) are left out too. */
const RELATIVE_GATE_DB = 10

const db = (energy: number): number => 10 * Math.log10(energy)

/**
 * Level of the active part of a recording, in dB relative to full scale: the mean energy of the 400 ms blocks that are
 * not silence and not far below the rest (the idea of integrated loudness in ITU-R BS.1770, without its frequency
 * weighting, which is good enough to compare a voice with a steady background sound). Null when nothing is audible.
 */
export function gatedLevelDb(samples: ArrayLike<number>, rate = LOUDNESS_RATE): number | null {
  const size = Math.max(1, Math.round(BLOCK_SECONDS * rate))
  const energies: number[] = []
  for (let start = 0; start + size <= samples.length; start += size) {
    let sum = 0
    for (let i = start; i < start + size; i++) {
      const v = samples[i] / 32768
      sum += v * v
    }
    energies.push(sum / size)
  }
  const audible = energies.filter((e) => e > 0 && db(e) > ABSOLUTE_GATE_DB)
  if (audible.length === 0) return null
  const mean = audible.reduce((a, b) => a + b, 0) / audible.length
  const kept = audible.filter((e) => db(e) > db(mean) - RELATIVE_GATE_DB)
  return db(kept.reduce((a, b) => a + b, 0) / kept.length)
}
