/**
 * JOY0DAT/JOY1DAT, against the Hardware Reference Manual's decode.
 *
 * The HRM gives the READ direction — `right = bit 1`, `left = bit 9`,
 * `down = bit 0 ^ bit 1`, `up = bit 8 ^ bit 9` — and `joyDatOf` is the write
 * direction, so every test here round-trips: encode a direction set, decode it
 * back with the manual's own expressions, and require the two to agree. That
 * is the only check that can catch the encoding being self-consistently wrong.
 */
import { describe, expect, it } from 'vitest'
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, newController, type Controller } from './controller'
import { counterDelta, joyDatOf, joyDatX, joyDatY, mouseDat } from './gameport'

/** the HRM's decode, written out as the manual writes it */
const decode = (w: number): number => {
  const right = (w >> 1) & 1
  const left = (w >> 9) & 1
  const down = ((w >> 1) ^ w) & 1
  const up = ((w >> 9) ^ (w >> 8)) & 1
  return (right ? DIR_RIGHT : 0) | (left ? DIR_LEFT : 0) | (down ? DIR_DOWN : 0) | (up ? DIR_UP : 0)
}

const stick = (dirs: number): Controller => ({ ...newController(), dirs })

describe('a digital joystick on JOYnDAT', () => {
  it('round-trips every one of the sixteen direction combinations', () => {
    for (let d = 0; d < 16; d++) {
      const w = joyDatOf(stick(d))
      expect(decode(w), `dirs ${d} -> ${w.toString(2)}`).toBe(d)
    }
  })

  it('puts right and down in the low byte, left and up in the high', () => {
    // which is why Gsmousedx(1) sees right/down and Gsmousedy(1) left/up
    expect(joyDatY(joyDatOf(stick(DIR_RIGHT | DIR_DOWN)))).toBe(0)
    expect(joyDatX(joyDatOf(stick(DIR_LEFT | DIR_UP)))).toBe(0)
  })

  it('sets TWO bits for right alone, because bit 0 is right XOR down', () => {
    // the quirk that makes a stick look like a jittery mouse to a counter
    // reader: pushing right moves the byte from 0 to 3, not to 1
    expect(joyDatX(joyDatOf(stick(DIR_RIGHT)))).toBe(3)
    expect(joyDatX(joyDatOf(stick(DIR_DOWN)))).toBe(1)
    expect(joyDatY(joyDatOf(stick(DIR_LEFT)))).toBe(3)
    expect(joyDatY(joyDatOf(stick(DIR_UP)))).toBe(1)
  })

  it('drives no bit a stick has no wire for', () => {
    // four lines and no more: everything above bit 9 stays low whatever the
    // controller says, because a pad's extra buttons are POTINP and CIA-A
    for (let d = 0; d < 16; d++) expect(joyDatOf(stick(d)) & ~0x303).toBe(0)
  })

  it('a centred stick reads zero', () => {
    expect(joyDatOf(newController())).toBe(0)
  })
})

describe('a mouse on JOYnDAT', () => {
  it('is two 8-bit counters, X low and Y high', () => {
    expect(mouseDat(0x34, 0x12)).toBe(0x1234)
    expect(joyDatX(mouseDat(200, 120))).toBe(200)
    expect(joyDatY(mouseDat(200, 120))).toBe(120)
  })

  it('wraps rather than saturating, because the counter is free-running', () => {
    expect(mouseDat(256, 256)).toBe(0)
    expect(joyDatX(mouseDat(-1, 0))).toBe(255)
  })
})

describe('counterDelta', () => {
  it('is a plain difference inside half a counter', () => {
    expect(counterDelta(10, 3)).toBe(7)
    expect(counterDelta(3, 10)).toBe(-7)
    expect(counterDelta(0, 0)).toBe(0)
  })

  it('reads a wrap as movement the short way round', () => {
    // 250 -> 5 is five counts forward, not 245 back
    expect(counterDelta(5, 250)).toBe(11)
    expect(counterDelta(250, 5)).toBe(-11)
  })

  it('misreports movement of more than 127 counts, exactly as hardware does', () => {
    // GameSupport's manual warns about this: call less often than once a
    // vblank and "very fast mouse movements will be misinterpreted"
    expect(counterDelta(200, 0)).toBe(-56)
  })

  it('leaves -128 alone, because the test is `bge #$ffffff80`', () => {
    // the boundary the binary picks: -128 is NOT wrapped, +128 becomes -128
    expect(counterDelta(0, 128)).toBe(-128)
    expect(counterDelta(128, 0)).toBe(-128)
  })
})
