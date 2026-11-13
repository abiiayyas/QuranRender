import { describe, expect, it } from 'vitest'
import { overlayLabel, overlayPhase, readableOn } from './overlay'

describe('overlayPhase', () => {
  it('enters, holds, exits', () => {
    expect(overlayPhase(0, 0, 6000)).toMatchObject({ enter: 0, exit: 0, progress: 0 })
    expect(overlayPhase(3000, 0, 6000)).toMatchObject({ enter: 1, exit: 0, progress: 0.5 })
    expect(overlayPhase(6000, 0, 6000)).toMatchObject({ enter: 1, exit: 1, progress: 1 })
  })
  it('leaves a hold in a short overlay', () => {
    // 1 s: 400 ms in, 400 ms out at most
    expect(overlayPhase(500, 0, 1000)).toMatchObject({ enter: 1, exit: 0 })
    expect(overlayPhase(800, 0, 1000).exit).toBe(0.5)
  })
})

describe('readableOn', () => {
  it('picks dark text on gold and white on deep green', () => {
    expect(readableOn('#D4A017')).toBe('#101114')
    expect(readableOn('#0F3D2E')).toBe('#FFFFFF')
  })
})

describe('overlayLabel', () => {
  it('names the new kinds', () => {
    expect(overlayLabel({ kind: 'qari', text: '' })).toBe('Nama qari')
    expect(overlayLabel({ kind: 'progress', text: '' })).toBe('Kemajuan')
    expect(overlayLabel({ kind: 'cta', text: 'Bagikan' })).toBe('Bagikan')
    expect(overlayLabel({ kind: 'cta', text: ' ' })).toBe('Jangan lupa bagikan dan doakan')
  })
})
