/**
 * lowlevel.library's joyport half, against lowlevel 40.35 and AROS.
 *
 * The reference is `arch/m68k-amiga/lowlevel/readjoyport.c` and
 * `compiler/include/libraries/lowlevel.h`. What is checked here is the
 * ENCODING — the bitfield a caller gets — because that is the whole of what
 * this port implements; the nine clock pulses that produce it on real
 * hardware have no counterpart, and `lowlevel.ts` says so.
 */
import { describe, expect, it } from 'vitest'
import {
  BTN_BLUE,
  BTN_GREEN,
  BTN_PLAY,
  BTN_RED,
  BTN_YELLOW,
  CTRL_GAMEPAD,
  CTRL_JOYSTICK,
  CTRL_MOUSE,
  CTRL_NONE,
  CTRL_UNKNOWN,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  newController,
  type Controller,
} from './controller'
import {
  JPF_BUTTON_BLUE,
  JPF_BUTTON_GREEN,
  JPF_BUTTON_PLAY,
  JPF_BUTTON_RED,
  JPF_BUTTON_YELLOW,
  JPF_JOY_DOWN,
  JPF_JOY_LEFT,
  JPF_JOY_RIGHT,
  JPF_JOY_UP,
  JP_TYPE_GAMECTLR,
  JP_TYPE_JOYSTK,
  JP_TYPE_MASK,
  JP_TYPE_MOUSE,
  JP_TYPE_NOTAVAIL,
  JP_TYPE_UNKNOWN,
  SJA_TYPE_AUTOSENSE,
  SJA_TYPE_GAMECTLR,
  SJA_TYPE_MOUSE,
  readJoyPort,
  setJoyPortType,
} from './lowlevel'

const ports = (): [Controller, Controller] => [newController(), newController()]

describe('the constants agree with libraries/lowlevel.h', () => {
  it('puts the port types in the top nibble', () => {
    expect(JP_TYPE_NOTAVAIL).toBe(0 << 28)
    expect(JP_TYPE_GAMECTLR).toBe(1 << 28)
    expect(JP_TYPE_MOUSE).toBe(2 << 28)
    expect(JP_TYPE_JOYSTK).toBe(3 << 28)
    expect(JP_TYPE_UNKNOWN).toBe(4 << 28)
  })

  it('puts the seven buttons at bits 17 to 23', () => {
    expect(JPF_BUTTON_PLAY).toBe(1 << 17)
    expect(JPF_BUTTON_RED).toBe(1 << 22)
    expect(JPF_BUTTON_BLUE).toBe(1 << 23)
  })

  /**
   * The identity `lowlevel.ts` leans on when it masks `c.dirs` through
   * untranslated. If the controller's numbering ever moves, this fails here
   * rather than silently reporting left as right.
   */
  it('numbers directions the same way the controller does', () => {
    expect(JPF_JOY_RIGHT).toBe(DIR_RIGHT)
    expect(JPF_JOY_LEFT).toBe(DIR_LEFT)
    expect(JPF_JOY_DOWN).toBe(DIR_DOWN)
    expect(JPF_JOY_UP).toBe(DIR_UP)
  })
})

describe('ReadJoyPort', () => {
  it('answers NOTAVAIL outside the binary\'s four-entry port table', () => {
    const p = ports()
    expect(readJoyPort(p, 4)).toBe(JP_TYPE_NOTAVAIL)
    expect(readJoyPort(p, -1)).toBe(JP_TYPE_NOTAVAIL)
  })

  it('accepts adaptor ports 2 and 3 when the host supplies them', () => {
    // lowlevel 40.35 bounds with `cmp.l #3,d2` and uses four port records.
    const p = [newController(), newController(), newController(), newController()]
    p[2]!.dirs = DIR_DOWN
    p[3]!.buttons = BTN_RED
    expect(readJoyPort(p, 2)).toBe(JP_TYPE_JOYSTK | JPF_JOY_DOWN)
    expect(readJoyPort(p, 3)).toBe(JP_TYPE_JOYSTK | JPF_BUTTON_RED)
  })

  it('reports absent adaptor ports as unavailable on a two-port machine', () => {
    expect(readJoyPort(ports(), 2)).toBe(JP_TYPE_NOTAVAIL)
    expect(readJoyPort(ports(), 3)).toBe(JP_TYPE_NOTAVAIL)
  })

  it('answers NOTAVAIL for an empty port', () => {
    const p = ports()
    p[1].type = CTRL_NONE
    expect(readJoyPort(p, 1)).toBe(JP_TYPE_NOTAVAIL)
  })

  /** autosense settles on a joystick when the pad poll fails — llPortOpen */
  it('starts as a joystick, which is where autosense lands', () => {
    expect(readJoyPort(ports(), 1) & JP_TYPE_MASK).toBe(JP_TYPE_JOYSTK)
  })

  it('reports a joystick’s directions and fire', () => {
    const p = ports()
    p[1].dirs = DIR_UP | DIR_LEFT
    p[1].buttons = BTN_RED
    expect(readJoyPort(p, 1)).toBe(JP_TYPE_JOYSTK | JPF_JOY_UP | JPF_JOY_LEFT | JPF_BUTTON_RED)
  })

  /**
   * A stick's connector carries /FIRn and POTINP pin 9 and nothing else, so
   * red and blue are all it can report however many buttons the host claims.
   */
  it('holds a joystick to red and blue', () => {
    const p = ports()
    p[1].buttons = BTN_RED | BTN_BLUE | BTN_YELLOW | BTN_GREEN | BTN_PLAY
    expect(readJoyPort(p, 1)).toBe(JP_TYPE_JOYSTK | JPF_BUTTON_RED | JPF_BUTTON_BLUE)
  })

  it('gives a game controller all seven', () => {
    const p = ports()
    p[1].type = CTRL_GAMEPAD
    p[1].buttons = BTN_YELLOW | BTN_GREEN | BTN_PLAY
    expect(readJoyPort(p, 1)).toBe(JP_TYPE_GAMECTLR | JPF_BUTTON_YELLOW | JPF_BUTTON_GREEN | JPF_BUTTON_PLAY)
  })

  it('reads the two ports independently', () => {
    const p = ports()
    p[0].dirs = DIR_RIGHT
    p[1].dirs = DIR_LEFT
    expect(readJoyPort(p, 0)).toBe(JP_TYPE_JOYSTK | JPF_JOY_RIGHT)
    expect(readJoyPort(p, 1)).toBe(JP_TYPE_JOYSTK | JPF_JOY_LEFT)
  })

  it('reports a mouse’s buttons and no direction', () => {
    const p = ports()
    p[0].type = CTRL_MOUSE
    p[0].dirs = DIR_UP
    p[0].buttons = BTN_RED | BTN_BLUE
    expect(readJoyPort(p, 0)).toBe(JP_TYPE_MOUSE | JPF_BUTTON_RED | JPF_BUTTON_BLUE)
  })

  it('answers UNKNOWN for a device the host cannot describe', () => {
    const p = ports()
    p[1].type = CTRL_UNKNOWN
    expect(readJoyPort(p, 1)).toBe(JP_TYPE_UNKNOWN)
  })

  it('stays inside 32 unsigned bits', () => {
    const p = ports()
    p[1].type = CTRL_GAMEPAD
    p[1].buttons = BTN_BLUE
    expect(readJoyPort(p, 1)).toBeGreaterThan(0)
  })
})

describe('SetJoyPortAttrs SJA_Type', () => {
  it('forces the type a port reports', () => {
    const p = ports()
    expect(setJoyPortType(p, 1, SJA_TYPE_GAMECTLR)).toBe(true)
    expect(readJoyPort(p, 1) & JP_TYPE_MASK).toBe(JP_TYPE_GAMECTLR)
    expect(setJoyPortType(p, 1, SJA_TYPE_MOUSE)).toBe(true)
    expect(readJoyPort(p, 1) & JP_TYPE_MASK).toBe(JP_TYPE_MOUSE)
  })

  it('autosense puts back the joystick', () => {
    const p = ports()
    p[1].type = CTRL_GAMEPAD
    expect(setJoyPortType(p, 1, SJA_TYPE_AUTOSENSE)).toBe(true)
    expect(p[1].type).toBe(CTRL_JOYSTICK)
  })

  it('refuses a port it does not have', () => {
    expect(setJoyPortType(ports(), 5, SJA_TYPE_MOUSE)).toBe(false)
  })
})
