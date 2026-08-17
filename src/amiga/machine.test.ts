import { describe, expect, it } from 'vitest'
import { CIAF_GAMEPORT0, CIAF_GAMEPORT1, CIAF_PRTRSEL } from './cia'
import { BTN_RED, CTRL_GAMEPAD, CTRL_MOUSE, CTRL_NONE, Controller } from './controller'
import { fitted } from './device'
import { Keyboard, keyboardSdr } from './keyboard'
import { M68020, M68030 } from './cpu'
import { Machine } from './machine'
import { MOUSE_LEFT } from './mouse'
import { FourPlayerAdaptor } from './parallel'
import { SerialCable } from './serialport'

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
  it('lists every connector, and an empty one is an empty slot', () => {
    const m = new Machine()
    const ids = m.hardware().map((s) => s.id)
    expect(ids).toEqual([
      'cpu', 'audio', 'clock', 'keyboard', 'mouse',
      'port0', 'port1', 'par', 'ser', 'df0', 'df1', 'df2', 'df3',
    ])
    // the two cables have nothing on them, which is what CIA-A PRB reading
    // $ff and CIA-B PRA reading $ff mean. The four drives ARE fitted, empty:
    // a drive is a slot and the disk is what goes in it.
    expect(m.hardware().filter((s) => !fitted(s)).map((s) => s.id)).toEqual(['par', 'ser'])
    expect(m.drives.every((d) => d?.empty)).toBe(true)
    // a port autosenses to a one-button stick, so both come up occupied
    expect(m.hardware().filter(fitted).map((s) => s.device!.name)).toEqual([
      '68000',
      'Paula',
      'A501 battery clock',
      'keyboard',
      'mouse',
      'joystick',
      'joystick',
      'floppy drive',
      'floppy drive',
      'floppy drive',
      'floppy drive',
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

describe('the machine: attaching and detaching', () => {
  it('puts a controller in a gameport and takes it out again', () => {
    const m = new Machine()
    const pad = new Controller(CTRL_GAMEPAD)
    expect(m.attach('port1', pad)).toBe(true)
    expect(m.ports[1]).toBe(pad)
    expect(m.slot('port1')!.device!.name).toBe('CD32 pad')
    expect(m.detach('port1')).toBe(pad)
    // an empty gameport still has to answer the pins, and CTRL_NONE is what
    // an unconnected port reports
    expect(m.ports[1].type).toBe(CTRL_NONE)
    expect(m.slot('port1')!.device).toBeNull()
  })

  it('puts a four-player adaptor on the parallel port, and its fires reach CIA-B', () => {
    const m = new Machine()
    const adaptor = new FourPlayerAdaptor()
    expect(m.attach('par', adaptor)).toBe(true)
    adaptor.sticks[0]!.buttons = BTN_RED
    expect(m.ciab.pra() & CIAF_PRTRSEL).toBe(0)
    expect(m.detach('par')).toBe(adaptor)
    expect(m.ciab.pra() & CIAF_PRTRSEL).toBe(CIAF_PRTRSEL)
  })

  it('unfits a drive, which is a different thing from ejecting its disk', () => {
    const m = new Machine()
    const drive = m.drives[1]!
    expect(m.detach('df1')).toBe(drive)
    expect(m.drives[1]).toBeNull()
    // the /SELn line is still there with nothing on it, so the slot stays
    expect(m.slot('df1')!.device).toBeNull()
    expect(m.attach('df1', drive)).toBe(true)
    expect(m.drives[1]).toBe(drive)
  })

  it('refuses a device that does not fit the connector', () => {
    const m = new Machine()
    expect(m.attach('df0', new Controller())).toBe(false)
    expect(m.attach('port0', new FourPlayerAdaptor())).toBe(false)
    expect(m.attach('nosuchthing', new Controller())).toBe(false)
    expect(m.slot('nosuchthing')).toBeNull()
  })

  it('refuses the two that are fixed, and says so before being asked', () => {
    const m = new Machine()
    // fixed means "this machine does not run without one", so the chip rows
    // are on the list and the keyboard, which is on a ribbon, is not
    expect(m.hardware().filter((s) => s.fixed).map((s) => s.id)).toEqual(['cpu', 'audio', 'clock', 'mouse'])
    expect(m.detach('mouse')).toBeNull()
    expect(m.detach('clock')).toBeNull()
  })

  it('unplugs the keyboard, and a machine with no keyboard holds no keys', () => {
    // an A500's keyboard is a separate assembly on a ribbon and every other
    // model's is on a cable, so this is a thing people did
    const m = new Machine()
    m.keyboard!.press(0x40)
    expect(m.keyboard!.held.has(0x40)).toBe(true)
    const was = m.detach('keyboard')
    expect(was).toBeInstanceOf(Keyboard)
    expect(m.keyboard).toBeNull()
    expect(m.slot('keyboard')!.device).toBeNull()

    // the one that was taken out must stop clocking bytes into the machine it
    // is no longer plugged into
    const sdr = m.cia.sdr
    ;(was as Keyboard).press(0x20)
    expect(m.cia.sdr).toBe(sdr)

    const fresh = new Keyboard()
    expect(m.attach('keyboard', fresh)).toBe(true)
    fresh.press(0x20)
    expect(m.cia.sdr).toBe(keyboardSdr(0x20, true))
  })

  it('replaces what is already in a socket, because a swap is one action', () => {
    const m = new Machine()
    const first = new SerialCable('one')
    const second = new SerialCable('two')
    m.attach('ser', first)
    expect(m.attach('ser', second)).toBe(true)
    expect(m.serial).toBe(second)
  })

  it('answers null when detaching a socket that was already empty', () => {
    const m = new Machine()
    expect(m.detach('par')).toBeNull()
  })
})

describe('the machine: the keyboard clocks into CIA-A', () => {
  it('puts the byte in SDR on the way down and again on the way up', () => {
    const m = new Machine()
    m.keyboard!.press(0x40)
    expect(m.keyboard!.held.has(0x40)).toBe(true)
    expect(m.cia.sdr).toBe(keyboardSdr(0x40, true))
    m.keyboard!.release(0x40)
    expect(m.keyboard!.held.has(0x40)).toBe(false)
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

describe('the machine: the two chip rows', () => {
  it('swaps the processor without ever emptying the socket', () => {
    // an accelerator is this slot with something else in it. `fixed` here
    // means the machine does not run without one, not that it cannot change.
    const m = new Machine()
    expect(m.cpu.name).toBe('68000')
    expect(m.attach('cpu', new M68020())).toBe(true)
    expect(m.cpu.name).toBe('68020')
    expect(m.detach('cpu')).toBeNull()
    expect(m.cpu.name).toBe('68020')
  })

  it('carries the ignore-clock mode across a swap', () => {
    // the mode belongs to the host's frame loop rather than to the chip, so
    // changing chips must not quietly start pacing again
    const m = new Machine()
    m.cpu.ignoreClock = true
    m.attach('cpu', new M68030())
    expect(m.cpu.ignoreClock).toBe(true)
  })

  it('comes up as an A500 output stage, which is what AMOS was heard on', () => {
    const m = new Machine()
    expect(m.audio.model).toBe('a500')
    expect(m.slot('audio')!.fixed).toBe(true)
  })
})
