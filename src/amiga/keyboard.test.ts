import { describe, expect, it } from 'vitest'
import { keyboardSdr, sdrIsPress, sdrKeycode } from './keyboard'

describe('the keyboard serial byte in CIA-A', () => {
  it('round-trips every keycode, both directions', () => {
    for (let code = 0; code < 0x80; code++) {
      expect(sdrKeycode(keyboardSdr(code, true))).toBe(code)
      expect(sdrKeycode(keyboardSdr(code, false))).toBe(code | 0x80)
      expect(sdrIsPress(keyboardSdr(code, true))).toBe(true)
      expect(sdrIsPress(keyboardSdr(code, false))).toBe(false)
    }
  })

  it('stays inside a byte', () => {
    for (let code = 0; code < 0x80; code++) {
      expect(keyboardSdr(code, true)).toBeGreaterThanOrEqual(0)
      expect(keyboardSdr(code, true)).toBeLessThan(0x100)
      expect(keyboardSdr(code, false)).toBeLessThan(0x100)
    }
  })

  it('puts the press/release marker in bit 0, which is what Range tests', () => {
    // Range's routine 75 uses `btst.b #$0` as its "is there a key" test. It
    // works because rotating left moves the keycode's bit 7 — the release
    // marker — down into bit 0, and the invert flips it: press -> 1.
    for (let code = 0; code < 0x80; code++) {
      expect(keyboardSdr(code, true) & 1).toBe(1)
      expect(keyboardSdr(code, false) & 1).toBe(0)
    }
  })

  it('gives Range 127 - scancode, because routine 75 never inverts', () => {
    // `btst.b #$0,d3 / beq .none / lsr.w #$1,d3` — the `not.b` the decode
    // needs is simply absent, so the answer is the complement.
    for (const code of [0, 1, 32, 69, 0x40, 0x7f]) {
      expect(keyboardSdr(code, true) >> 1).toBe(127 - code)
    }
  })

  it('gives TURBO the scancode with the release bit, as its manual warns', () => {
    // "Beware! It gives different values if the key is pressed or released."
    expect(sdrKeycode(keyboardSdr(69, true))).toBe(69) // ESC down
    expect(sdrKeycode(keyboardSdr(69, false))).toBe(69 | 0x80) // ESC up, 197
  })

  it('not and ror commute, so the two orderings really are the same', () => {
    // worth pinning rather than assuming: a rotation is a permutation of bits
    // and a complement is bitwise, so they pass through each other. Sources
    // in the wild write the pair both ways round and both are correct.
    const otherWayRound = (sdr: number): number => {
      const r = ((sdr >> 1) | ((sdr & 1) << 7)) & 0xff
      return ~r & 0xff
    }
    for (let sdr = 0; sdr < 0x100; sdr++) expect(otherWayRound(sdr)).toBe(sdrKeycode(sdr))
  })
})
