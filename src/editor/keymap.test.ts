import { describe, expect, it } from 'vitest'
import { ED_KFONC, ED_ROUTINES, FLAG_FONC } from './keymap.gen'
import { COMMAND_COUNT, QUAL, funcToKey, keyToFunc, keysFor } from './keymap'

/** the scancodes the table uses, so a test reads as a key and not as a number */
const SCAN = { UP: 0x4c, DOWN: 0x4d, RIGHT: 0x4e, LEFT: 0x4f, RETURN: 0x44, DEL: 0x46, HELP: 0x5f, F1: 0x50 }

describe('the tables as they were assembled', () => {
  it('holds 184 commands three ways', () => {
    expect(COMMAND_COUNT).toBe(184)
    expect(ED_ROUTINES.length).toBe(184)
    expect(FLAG_FONC.length).toBe(184)
    // 184 records of {key, shifts, terminator} and the table's own $FF,0
    expect(ED_KFONC.length).toBe(184 * 3 + 2)
    expect(Array.from(ED_KFONC.slice(-2))).toEqual([0xff, 0])
  })

  it('names the routine each number branches to', () => {
    expect(ED_ROUTINES[0]).toBe('Ed_CHaut')
    expect(ED_ROUTINES[18]).toBe('Ed_Return')
    expect(ED_ROUTINES[64]).toBe('Ed_Undo')
    expect(ED_ROUTINES[144]).toBe('Ed_GoMonitor')
  })
})

describe('a keystroke to a command', () => {
  it('finds a bare cursor key by its scancode', () => {
    // `dc.b $80+$4C,$00,0` -- bit 7 says scancode, and the ASCII is not looked at
    expect(keyToFunc({ scan: SCAN.UP })).toBe(1)
    expect(keyToFunc({ scan: SCAN.DOWN })).toBe(2)
    expect(keyToFunc({ scan: SCAN.LEFT })).toBe(3)
    expect(keyToFunc({ scan: SCAN.RIGHT })).toBe(4)
  })

  it('sends the same key to four commands by its qualifiers', () => {
    // Up on its own, with Shift, with Ctrl, with both: 1, 5, 9, 17
    expect(keyToFunc({ scan: SCAN.UP })).toBe(1)
    expect(keyToFunc({ scan: SCAN.UP, shift: QUAL.SHIFT })).toBe(5)
    expect(keyToFunc({ scan: SCAN.UP, shift: QUAL.CTRL })).toBe(9)
    expect(keyToFunc({ scan: SCAN.UP, shift: QUAL.SHIFT | QUAL.CTRL })).toBe(17)
    expect(keyToFunc({ scan: SCAN.UP, shift: QUAL.ALT })).toBe(31)
  })

  it('takes either key of a qualifier pair', () => {
    // Shf is %11 and Ami is %11000000, so a record asking for one is happy
    // with the left key, the right key or both: `and.b d3,d0 / beq .EdL9`
    for (const bit of [0b01, 0b10, 0b11]) expect(keyToFunc({ scan: SCAN.UP, shift: bit })).toBe(5)
    for (const bit of [0x40, 0x80, 0xc0]) expect(keyToFunc({ ch: 'l', shift: bit })).toBe(33)
  })

  it('upper-cases the letter, so Ctrl-u and Ctrl-U are one shortcut', () => {
    // `.EdL5`: `sub.b #"a"-"A",d7` before anything is compared
    expect(keyToFunc({ ch: 'u', shift: QUAL.CTRL })).toBe(65)
    expect(keyToFunc({ ch: 'U', shift: QUAL.CTRL })).toBe(65)
  })

  it('throws Caps Lock away before it searches', () => {
    // `and.b #%11111011,d1`, so Caps Lock cannot be half of a shortcut
    expect(keyToFunc({ scan: SCAN.UP, shift: QUAL.CAPS })).toBe(1)
    expect(keyToFunc({ scan: SCAN.UP, shift: QUAL.CAPS | QUAL.SHIFT })).toBe(5)
  })

  it('will not let a qualifier the record did not ask for through', () => {
    // `.EdLG: or.b d4,d3 / bne .EdL9`. Return is `dc.b 13,$00`, so Ctrl-Return
    // is not Return and falls through to Ed_PKey
    expect(keyToFunc({ ch: '\r', scan: SCAN.RETURN })).toBe(19)
    expect(keyToFunc({ ch: '\r', scan: SCAN.RETURN, shift: QUAL.CTRL })).toBe(0)
  })

  it('answers 0 for a key nobody claimed, which is how typing gets through', () => {
    expect(keyToFunc({ ch: 'a', scan: 0x20 })).toBe(0)
    expect(keyToFunc({ ch: ' ', scan: 0x40 })).toBe(0)
  })

  it('leaves the 1 of an unassigned row reachable, just not from a keyboard', () => {
    // `1,0,0` is how the format says "no shortcut": it keeps the list from
    // being empty, which two of the three walks cannot survive. It is not
    // unmatchable though. The only key that produces ASCII 1 is Ctrl-A, and
    // that carries Ctrl, so it misses the record's empty qualifier byte --
    // but a bare SOH from Put Key or a macro hits the FIRST row holding a 1
    expect(keysFor(82)).toEqual([{ key: 1, shift: 0 }]) // 82 Quit, unassigned
    expect(keyToFunc({ ch: String.fromCharCode(1), shift: QUAL.CTRL })).toBe(0)
    expect(keyToFunc({ ch: String.fromCharCode(1) })).toBe(39) // Set Mark 0
  })

  it('takes the lower command number when two claim one key', () => {
    // first match wins, in table order, and nothing warns
    const table = Uint8Array.from([0x80 | SCAN.F1, 0, 0, 0x80 | SCAN.F1, 0, 0, 0xff, 0])
    expect(keyToFunc({ scan: SCAN.F1 }, table)).toBe(1)
  })
})

describe('a command to its keystroke', () => {
  it('answers what the table holds', () => {
    expect(funcToKey(1)).toEqual({ key: 0x80 | SCAN.UP, shift: 0 })
    expect(funcToKey(21)).toEqual({ key: 0x80 | SCAN.DEL, shift: 0 })
    expect(funcToKey(27)).toEqual({ key: 0x80 | SCAN.HELP, shift: 0 })
    expect(funcToKey(77)).toEqual({ key: 0x80 | SCAN.F1, shift: 0 }) // Run
    expect(funcToKey(65)).toEqual({ key: 'U'.charCodeAt(0), shift: QUAL.CTRL })
  })

  it('round-trips every command that has a real key', () => {
    for (let cmd = 1; cmd <= COMMAND_COUNT; cmd++) {
      const k = funcToKey(cmd)
      if (k === null || k.key === 1) continue
      const key = (k.key & 0x80) !== 0 ? { scan: k.key & 0x7f, shift: k.shift } : { ch: String.fromCharCode(k.key), shift: k.shift }
      expect(keyToFunc(key), `command ${cmd} (${ED_ROUTINES[cmd - 1]})`).toBe(cmd)
    }
  })

  it('reads every list, so the two walks agree on where each one starts', () => {
    for (let cmd = 1; cmd <= COMMAND_COUNT; cmd++) {
      expect(keysFor(cmd).length, `command ${cmd}`).toBe(1)
      expect(keysFor(cmd)[0]).toEqual(funcToKey(cmd))
    }
  })

  it('walks a list of more than one, which Set Key Shortcut can make', () => {
    // command 1 on two keys, command 2 on one
    const table = Uint8Array.from([0x80 | SCAN.UP, 0, 0x80 | SCAN.F1, 0, 0, 0x80 | SCAN.DOWN, 0, 0, 0xff, 0])
    expect(keysFor(1, table).length).toBe(2)
    expect(keyToFunc({ scan: SCAN.F1 }, table)).toBe(1)
    expect(keyToFunc({ scan: SCAN.DOWN }, table)).toBe(2)
    // `.Loop4` steps two bytes before it tests, so it counts the same lists
    expect(funcToKey(2, table)).toEqual({ key: 0x80 | SCAN.DOWN, shift: 0 })
  })

  it('answers null past the end of the table', () => {
    expect(funcToKey(COMMAND_COUNT + 1)).toBeNull()
    expect(keysFor(COMMAND_COUNT + 1)).toEqual([])
  })
})
