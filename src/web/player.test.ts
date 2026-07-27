import { describe, expect, it } from 'vitest'
import { isAmosProgram, pickProgram, KB_ARROWS, KB_WASD, SCAN } from './player'

describe('picking the program out of an archive', () => {
  // The zip a host ships is a drawer: the program beside the data it loads.
  // Getting this wrong is silent — the wrong program runs, or none does — so
  // the rule is deliberately dull and an ambiguity is reported rather than
  // guessed at.

  it('runs the only program there is', () => {
    expect(pickProgram(['eggit2.amos']).path).toBe('eggit2.amos')
  })

  it('prefers the shallowest, because a game sits beside its data', () => {
    expect(pickProgram(['game.amos', 'extras/demo.amos', 'data/old/thing.amos']).path).toBe('game.amos')
  })

  it('reports a tie instead of picking one', () => {
    // eggit's own drawer holds two: shipping it without naming one should say
    // so, not start whichever happened to be listed first
    const r = pickProgram(['eggit2.amos', 'oldeggit.AMOS'])
    expect(r.path).toBeUndefined()
    expect(r.ambiguous).toEqual(['eggit2.amos', 'oldeggit.AMOS'])
  })

  it('an explicit choice wins, by bare name or full path', () => {
    const both = ['eggit2.amos', 'oldeggit.AMOS']
    expect(pickProgram(both, 'oldeggit.AMOS').path).toBe('oldeggit.AMOS')
    expect(pickProgram(['game/main.amos'], 'main.amos').path).toBe('game/main.amos')
    expect(pickProgram(['game/main.amos'], 'game/main.amos').path).toBe('game/main.amos')
  })

  it('matches the name whatever case it was stored in', () => {
    // AMOS filenames are case-insensitive and the corpus is inconsistent
    // about it — mother.3do sits beside manual.3DO in one shipped drawer
    expect(pickProgram(['Eggit2.AMOS'], 'eggit2.amos').path).toBe('Eggit2.AMOS')
  })

  it('says so when the name given is not there', () => {
    expect(pickProgram(['a.amos'], 'nope.amos').path).toBeUndefined()
  })

  it('finds nothing in an archive with no program', () => {
    expect(pickProgram([]).path).toBeUndefined()
    expect(pickProgram([]).ambiguous).toBeUndefined()
  })
})

describe('recognising an AMOS program', () => {
  const header = (s: string): Uint8Array => new TextEncoder().encode(s.padEnd(20, ' '))

  it('goes by the header, not the extension', () => {
    // plenty of shipped programs are extensionless: APD085's Snakes is
    // "AMOS Basic V1.00" from 1990, and the corpus is full of AutoExec files
    expect(isAmosProgram(header('AMOS Basic V1.00'))).toBe(true)
    expect(isAmosProgram(header('AMOS Pro V1.00 '))).toBe(true)
    expect(isAmosProgram(header('AmBk'))).toBe(false)
    expect(isAmosProgram(header('FORM....ILBM'))).toBe(false)
  })

  it('is safe on nothing and on a runt', () => {
    expect(isAmosProgram(null)).toBe(false)
    expect(isAmosProgram(new Uint8Array(4))).toBe(false)
  })
})

describe('keyboard to joystick', () => {
  // bits 1 up, 2 down, 4 left, 8 right, 16 fire — the hardware order the
  // Joy() reader returns
  it('maps both presets to the same bits', () => {
    for (const m of [KB_ARROWS, KB_WASD]) {
      expect(new Set(Object.values(m))).toEqual(new Set([1, 2, 4, 8, 16]))
    }
  })

  it('gives every mapped key a scancode too', () => {
    // a game reading Joy(1) AND Key State on the same key must see both
    for (const code of [...Object.keys(KB_ARROWS), ...Object.keys(KB_WASD)]) {
      expect(SCAN[code], code).toBeDefined()
    }
  })
})
