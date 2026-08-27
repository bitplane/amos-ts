import { describe, expect, it } from 'vitest'
import { isAmosProgram, isQualifier, keyRoute, pickProgram, KB_ARROWS, KB_WASD, SCAN } from './player'
import { keyToFunc, QUAL } from '../editor/keymap'

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

  it('fires on a key the keystroke path throws away', () => {
    // The wasd preset's fire is ShiftLeft, scancode $60, which `Cla_Event`
    // holds as a qualifier and never stores as a keystroke. So the two
    // questions a keydown answers -- what character is this, and what is the
    // stick doing -- disagree about this key, and the gameport has to be fed
    // before the character routing gets to drop it.
    //
    // It was not, for a while: the qualifier branch returned first and Shift
    // never reached the joystick map, so the default port 1 preset had no
    // fire button. Nothing else in the suite can see that, because the
    // handler is a closure inside `createPlayer` and there is no DOM here.
    // This pins the collision that makes the ordering matter.
    expect(KB_WASD.ShiftLeft).toBe(16)
    expect(isQualifier(SCAN.ShiftLeft!)).toBe(true)
    // and the arrows preset does NOT collide, which is why the bug looked
    // like "port 1 is broken" rather than "the keyboard stick is broken"
    expect(isQualifier(SCAN.Space!)).toBe(false)
  })
})

/**
 * Escape, and what it flips between.
 *
 * On the machine it is one key going both ways: `Ed_Escape` (+Edit.s:8876)
 * from the editor down to the escape screen, `Esc_Esc` (:9125) back up. There
 * is no editor here, so the other side is the program's display with nothing
 * over it.
 */
describe('where a keystroke goes', () => {
  it('gives every key to the line editor while the escape screen is up', () => {
    expect(keyRoute(true, true, 'Escape', 0x45)).toBe('line')
    expect(keyRoute(true, true, 'KeyA', 0x20)).toBe('line')
    // even mid-run, which is the state a typed line that has not finished
    // leaves behind
    expect(keyRoute(true, false, 'KeyA', 0x20)).toBe('line')
  })

  it('brings the escape screen back with Escape once the program has stopped', () => {
    expect(keyRoute(false, true, 'Escape', 0x45)).toBe('escape')
    expect(keyRoute(false, true, 'KeyA', 0x20)).toBe('program')
  })

  it('gives every key to the editor while the editor is up', () => {
    // `Ed_Loop` (+Edit.s:915) owns the keyboard: every key is `Ed_Key` and
    // Escape among them, which is entry 28 and flips to the escape screen.
    // So there is no key the editor does not want.
    expect(keyRoute(false, true, 'KeyA', 0x20, true)).toBe('editor')
    expect(keyRoute(false, true, 'Escape', 0x45, true)).toBe('editor')
    expect(keyRoute(false, true, 'F1', 0x50, true)).toBe('editor')
  })

  it('gives the escape screen the key even when the editor is behind it', () => {
    // `Esc_L1` (:8917) is the escape screen's own loop, and it is in FRONT of
    // the editor rather than instead of it. Both flags are set while a typed
    // line is being typed.
    expect(keyRoute(true, true, 'KeyA', 0x20, true)).toBe('line')
    expect(keyRoute(true, true, 'Escape', 0x45, true)).toBe('line')
  })

  /**
   * The one that matters. A game reads Escape like any other key, `Esc_Appear`
   * is reached from `Ed_Loop` and `Esc_Loop` and from nowhere the interpreter
   * runs, and no AMOS interrupts a program with it. Ctrl-C does that.
   */
  it('leaves Escape to a running program', () => {
    expect(keyRoute(false, false, 'Escape', 0x45)).toBe('program')
  })
})

/**
 * The four keys an Amiga keyboard does not have.
 *
 * `.Ed_KFonc` has no Page Up record because there was no Page Up key. What it
 * has is Ctrl with the cursors, so the browser key is sent as that
 * combination and `keyToFunc` finds the command the configuration binds --
 * which keeps Set Key Shortcut in charge of what Page Up does.
 */
describe('keys the Amiga keyboard is missing', () => {
  const cmd = (scan: number, shift: number): number => keyToFunc({ ch: '', scan, shift })

  it('reach the commands the editor already binds', () => {
    expect(cmd(0x4c, QUAL.CTRL)).toBe(9) // Ed_PHaut, Page Up
    expect(cmd(0x4d, QUAL.CTRL)).toBe(10) // Ed_PBas, Page Down
    expect(cmd(0x4f, QUAL.CTRL)).toBe(11) // Ed_DLigne, Line Start -- Home
    expect(cmd(0x4e, QUAL.CTRL)).toBe(12) // Ed_FLigne, Line End -- End
    expect(cmd(0x4c, QUAL.SHIFT | QUAL.CTRL)).toBe(17) // Ed_HTexte, Ctrl+Home
    expect(cmd(0x4d, QUAL.SHIFT | QUAL.CTRL)).toBe(18) // Ed_BTexte, Ctrl+End
  })

  it('are not in SCAN, because the machine has no code for them', () => {
    // `Cla_Special` (+W.s:12912) is the whole of what the CIA can deliver and
    // Page Up is not in it. The stand-in is a qualifier pair, not a scancode.
    expect(SCAN.PageUp).toBeUndefined()
    expect(SCAN.PageDown).toBeUndefined()
    expect(SCAN.Home).toBeUndefined()
    expect(SCAN.End).toBeUndefined()
  })
})

