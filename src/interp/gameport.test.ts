import { describe, expect, it } from 'vitest'
import {
  JOY_DIRECTIONS,
  JOY_DOWN,
  JOY_FIRE,
  JOY_LEFT,
  JOY_RIGHT,
  JOY_UP,
  MAX_PORT,
  PORT_JOYSTICK,
  PORT_MOUSE,
  joyDirections,
  joyFire,
} from './gameport'

describe('the digital port bits', () => {
  it('are the values Joy() returns', () => {
    // spelled out as bare literals in five places before this file existed
    expect([JOY_UP, JOY_DOWN, JOY_LEFT, JOY_RIGHT, JOY_FIRE]).toEqual([1, 2, 4, 8, 16])
  })

  it('the direction nibble is the four directions and nothing else', () => {
    expect(JOY_DIRECTIONS).toBe(0x0f)
    expect(JOY_DIRECTIONS & JOY_FIRE).toBe(0)
    expect(joyDirections(JOY_UP | JOY_FIRE)).toBe(JOY_UP)
    expect(joyDirections(0xff)).toBe(0x0f)
  })

  it('reads fire independently of the directions', () => {
    expect(joyFire(JOY_FIRE)).toBe(true)
    expect(joyFire(JOY_UP | JOY_LEFT)).toBe(false)
    expect(joyFire(0)).toBe(false)
  })

  it('opposite directions can be held at once, as they can on the hardware', () => {
    // a real stick can short both contacts, and nothing here prevents it
    const both = JOY_LEFT | JOY_RIGHT
    expect(joyDirections(both)).toBe(both)
  })
})

describe('the two ports', () => {
  it('port 0 is the mouse port and 1 the joystick port', () => {
    expect(PORT_MOUSE).toBe(0)
    expect(PORT_JOYSTICK).toBe(1)
    expect(MAX_PORT).toBe(PORT_JOYSTICK)
  })
})

describe('the Sticks remap', () => {
  /**
   * Multi Joy keeps the direction nibble and moves the button: AMOS's single
   * fire is $10, which in Sticks' packing is button D, and the port has to
   * put it at $80 (button A). Naming the nibble is what makes that one line
   * instead of two magic masks.
   */
  it('keeps the directions and moves fire from $10 to $80', () => {
    const amos = JOY_UP | JOY_RIGHT | JOY_FIRE
    let v = joyDirections(amos)
    if (joyFire(amos)) v |= 0x80
    expect(v).toBe(JOY_UP | JOY_RIGHT | 0x80)
    expect(v & JOY_FIRE).toBe(0) // NOT left where AMOS had it
  })
})
