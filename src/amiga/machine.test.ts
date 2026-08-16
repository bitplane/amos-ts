import { describe, expect, it } from 'vitest'
import { CIAF_GAMEPORT0, CIAF_GAMEPORT1 } from './cia'
import { BTN_RED, CTRL_GAMEPAD, CTRL_MOUSE, CTRL_NONE } from './controller'
import { fitted } from './device'
import { keyboardSdr } from './keyboard'
import { Machine } from './machine'
import { MOUSE_LEFT } from './mouse'

describe('the machine: power and reset', () => {
  it('starts on, with nothing pending', () => {
    const m = new Machine()
    expect(m.power).toBe('on')
    expect(m.pendingReset).toBeNull()
  })

  it('records who asked, so a host can say why the screen went black', () => {
    const m = new Machine()
    m.requestReset('cold', 'reset computer')
    expect(m.pendingReset).toEqual({ kind: 'cold', by: 'reset computer' })
  })

  it('the FIRST request wins — a warm one cannot downgrade a cold one', () => {
    const m = new Machine()
    m.requestReset('cold', 'reset computer')
    m.requestReset('warm', 'warm reset')
    expect(m.pendingReset).toEqual({ kind: 'cold', by: 'reset computer' })
  })

  it('taking the reset clears it, so a loop cannot perform one twice', () => {
    const m = new Machine()
    m.requestReset('warm', 'host')
    expect(m.takeReset()).toEqual({ kind: 'warm', by: 'host' })
    expect(m.takeReset()).toBeNull()
    expect(m.pendingReset).toBeNull()
  })

  it('powering off asks for a cold reset and stays off until told otherwise', () => {
    const m = new Machine()
    m.powerOff('host')
    expect(m.power).toBe('off')
    expect(m.pendingReset?.kind).toBe('cold')
    m.powerOn()
    expect(m.power).toBe('on')
    expect(m.pendingReset).toBeNull()
  })
})

describe('the machine: what is plugged in', () => {
  it('lists five slots, and an empty gameport is an empty slot', () => {
    const m = new Machine()
    const ids = m.hardware().map((s) => s.id)
    expect(ids).toEqual(['clock', 'keyboard', 'mouse', 'port0', 'port1'])
    // a port autosenses to a one-button stick, so both come up occupied
    expect(m.hardware().filter(fitted).map((s) => s.device!.name)).toEqual([
      'A501 battery clock',
      'keyboard',
      'mouse',
      'joystick',
      'joystick',
    ])
    m.ports[1].type = CTRL_NONE
    expect(m.hardware().find((s) => s.id === 'port1')!.device).toBeNull()
  })

  it('names what a port has, in lowlevel.library vocabulary', () => {
    const m = new Machine()
    m.ports[0].type = CTRL_GAMEPAD
    expect(m.hardware().find((s) => s.id === 'port0')!.device!.name).toBe('CD32 pad')
  })

  it('is a view, not a registry: the tree follows the typed field', () => {
    // the devices live on the fields, so a caller that reaches ports[1]
    // directly cannot leave the tree describing a machine that is not there
    const m = new Machine()
    m.ports[1].type = CTRL_MOUSE
    expect(m.hardware().find((s) => s.id === 'port1')!.device!.name).toBe('mouse')
  })
})

describe('the machine: the keyboard clocks into CIA-A', () => {
  it('puts the byte in SDR on the way down and again on the way up', () => {
    const m = new Machine()
    m.keyboard.press(0x40)
    expect(m.keyboard.held.has(0x40)).toBe(true)
    expect(m.cia.sdr).toBe(keyboardSdr(0x40, true))
    m.keyboard.release(0x40)
    expect(m.keyboard.held.has(0x40)).toBe(false)
    expect(m.cia.sdr).toBe(keyboardSdr(0x40, false))
    // a release and a press of one key are different bytes, which is what
    // TURBO's manual warns about
    expect(keyboardSdr(0x40, true)).not.toBe(keyboardSdr(0x40, false))
  })
})

describe('the machine: FIR0 is one pin with two devices on it', () => {
  it('answers to the mouse button', () => {
    const m = new Machine()
    m.mouse.buttons = MOUSE_LEFT
    expect(m.cia.pra() & CIAF_GAMEPORT0).toBe(0)
  })

  it('answers to a stick in the same port, which is the DEVIATION', () => {
    // a real port has one connector; this machine holds a mouse and ports[0]
    // at once, so FIR0 is the OR of the two. See ./mouse.ts.
    const m = new Machine()
    m.ports[0].buttons = BTN_RED
    expect(m.cia.pra() & CIAF_GAMEPORT0).toBe(0)
  })

  it('keeps port 1 to itself', () => {
    const m = new Machine()
    m.ports[1].buttons = BTN_RED
    expect(m.cia.pra() & CIAF_GAMEPORT0).toBe(CIAF_GAMEPORT0)
    expect(m.cia.pra() & CIAF_GAMEPORT1).toBe(0)
  })
})
