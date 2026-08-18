/**
 * GUI 2.10's state, against what GUI2.guide says each keyword answers.
 *
 * Every number here is the guide's. The event codes are its own list and the
 * four close codes are its own four lines; where it leaves an order
 * undecided, the test says which one this port chose and why, so a later
 * reading of the binary can disagree with something specific.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_GUI_BANK, GUI_CLOSE, GUI_EVENT, GuiState } from './guistate'
import type { Gui } from './guibank'

/** a design with `n` button gadgets, which is all these tests need of one */
function design(n: number, box = { left: 10, top: 20, width: 200, height: 100 }): Gui {
  return {
    offset: 0,
    ...box,
    idcmp: 0,
    gadgets: Array.from({ length: n }, (_, i) => ({
      kind: 1,
      leftEdge: i * 20,
      topEdge: 0,
      width: 18,
      height: 12,
      id: i,
      flags: 0,
      userData: 0,
      name: '',
      items: [],
      text: '',
      progressBar: false,
    })),
    labels: [],
    imageGadgets: 0,
    hasMenus: false,
    version: 40,
    tags: new Uint8Array(0),
    gadgetTags: [],
    windowTags: [],
  }
}

function stateWith(...designs: Gui[]): GuiState {
  const s = new GuiState()
  s.designs = designs
  return s
}

describe('the event codes', () => {
  /**
   * "If the value returned by Gui Wait is more than or equal to 0 it is the
   * number of the gadget selected", so every non-gadget event must be
   * negative, and the guide lists eighteen of them.
   */
  it('are the guide s own list, all negative', () => {
    expect(GUI_EVENT.CLOSE).toBe(-1)
    expect(GUI_EVENT.MENU).toBe(-2)
    expect(GUI_EVENT.RAWKEY).toBe(-4)
    expect(GUI_EVENT.KEY).toBe(-5)
    expect(GUI_EVENT.ICONIFY).toBe(-6)
    expect(GUI_EVENT.NOTHING).toBe(-7)
    expect(GUI_EVENT.RESIZE).toBe(-8)
    expect(GUI_EVENT.MOUSECLICK).toBe(-11)
    expect(GUI_EVENT.TIMER).toBe(-13)
    expect(GUI_EVENT.WINDOWACTIVE).toBe(-18)
    for (const [name, v] of Object.entries(GUI_EVENT)) expect(v, name).toBeLessThan(0)
    expect(Object.keys(GUI_EVENT)).toHaveLength(18)
  })

  /** the guide marks -3 and -17 "Not used"; a hole would read as a loss */
  it('keeps the two the guide marks unused', () => {
    expect(GUI_EVENT.UNUSED3).toBe(-3)
    expect(GUI_EVENT.UNUSED17).toBe(-17)
  })
})

describe('opening and closing', () => {
  it('starts on the bank the converter writes', () => {
    expect(new GuiState().bank).toBe(DEFAULT_GUI_BANK)
    expect(DEFAULT_GUI_BANK).toBe(20)
  })

  it('takes the geometry from the editor unless told otherwise', () => {
    const s = stateWith(design(2))
    const w = s.open(1, 0)!
    expect([w.left, w.top, w.width, w.height]).toEqual([10, 20, 200, 100])
    const s2 = stateWith(design(2))
    const w2 = s2.open(1, 0, { left: 1, top: 2, width: 3, height: 4 })!
    expect([w2.left, w2.top, w2.width, w2.height]).toEqual([1, 2, 3, 4])
  })

  /** "If the window you specify is already open, it will be selected and pop
      to front... no error will occur" */
  it('re-opening an open window selects it rather than failing', () => {
    const s = stateWith(design(1), design(1))
    const first = s.open(1, 0)!
    s.open(2, 1)
    expect(s.selected).toBe(2)
    expect(s.open(1, 0)).toBe(first)
    expect(s.selected).toBe(1)
    expect(s.windows.size).toBe(2)
  })

  it('refuses a gui the bank does not hold', () => {
    expect(stateWith(design(1)).open(1, 9)).toBeNull()
  })

  it('makes the first window the graphics output too', () => {
    const s = stateWith(design(1), design(1))
    s.open(1, 0)
    expect(s.actual).toBe(1)
    s.open(2, 1)
    // Gui Gfx moves it; opening a second window does not
    expect(s.actual).toBe(1)
  })

  /**
   * The guide's four codes. It does not say which wins when a window is both
   * first and last, so this port takes "the only one" first, then first-
   * opened, then last-opened, and this test is where that choice is written
   * down rather than left to be inferred.
   */
  it('answers the guide s four close codes', () => {
    const s = stateWith(design(1), design(1), design(1))
    expect(s.closeWindow(9)).toBe(GUI_CLOSE.CLOSED)

    s.open(1, 0)
    expect(s.closeWindow(1)).toBe(GUI_CLOSE.LAST)

    s.open(1, 0)
    s.open(2, 1)
    s.open(3, 2)
    expect(s.closeWindow(1)).toBe(GUI_CLOSE.FIRST)
    expect(s.closeWindow(3)).toBe(GUI_CLOSE.LAST_OPENED)
    expect(s.closeWindow(2)).toBe(GUI_CLOSE.LAST)
  })

  it('Gui Exist is false once closed', () => {
    const s = stateWith(design(1))
    expect(s.exists(1)).toBe(false)
    s.open(1, 0)
    expect(s.exists(1)).toBe(true)
    s.closeWindow(1)
    expect(s.exists(1)).toBe(false)
  })

  it('Gui Reset closes everything and forgets the last event', () => {
    const s = stateWith(design(1), design(1))
    s.open(1, 0)
    s.open(2, 1)
    s.post({ code: 0, result: 1, text: 'x', window: 1 })
    s.nextEvent()
    s.reset()
    expect(s.windows.size).toBe(0)
    expect(s.selected).toBe(0)
    expect(s.nextEvent()).toBe(GUI_EVENT.NOTHING)
  })
})

describe('the event loop', () => {
  it('answers -7 when nothing has happened', () => {
    expect(new GuiState().nextEvent()).toBe(GUI_EVENT.NOTHING)
  })

  it('hands out a gadget number and remembers which window', () => {
    const s = stateWith(design(3))
    s.open(1, 0)
    s.post({ code: 2, result: 0, text: '', window: 1 })
    expect(s.nextEvent()).toBe(2)
    expect(s.eventWindow()).toBe(1)
  })

  /**
   * "After Gui Code has been called, its value is automatically reset to -1
   * again, until the next call to Gui Wait loads it with a new value."
   */
  it('resets Gui Code to -1 once read', () => {
    const s = stateWith(design(1))
    s.open(1, 0)
    s.post({ code: 0, result: 42, text: 'hi', window: 1 })
    s.nextEvent()
    expect(s.readCode()).toBe(42)
    expect(s.readCode()).toBe(-1)
    // Gui Code$ is not documented as resetting, and does not
    expect(s.readCodeText()).toBe('hi')
    expect(s.readCodeText()).toBe('hi')
  })

  it('answers -1 for Gui Code before anything has happened', () => {
    expect(new GuiState().readCode()).toBe(-1)
    expect(new GuiState().eventWindow()).toBe(0)
  })

  /**
   * `Gui Off` locks a GUI. Its events are dropped rather than held, because a
   * program that unlocks later should not be handed a backlog of clicks
   * nobody made while it was watching.
   */
  it('drops events for a locked window and keeps the rest', () => {
    const s = stateWith(design(1), design(1))
    const a = s.open(1, 0)!
    s.open(2, 1)
    a.locked = true
    s.post({ code: 0, result: 0, text: '', window: 1 })
    s.post({ code: 1, result: 0, text: '', window: 2 })
    expect(s.nextEvent()).toBe(1)
    expect(s.eventWindow()).toBe(2)
    expect(s.nextEvent()).toBe(GUI_EVENT.NOTHING)
  })

  it('reports events in the order they happened', () => {
    const s = stateWith(design(3))
    s.open(1, 0)
    for (const code of [0, 2, GUI_EVENT.CLOSE]) s.post({ code, result: 0, text: '', window: 1 })
    expect([s.nextEvent(), s.nextEvent(), s.nextEvent(), s.nextEvent()]).toEqual([0, 2, GUI_EVENT.CLOSE, GUI_EVENT.NOTHING])
  })

  it('finds a gadget by the id the bank gave it', () => {
    const s = stateWith(design(3))
    const w = s.open(1, 0)!
    expect(s.gadget(w, 2)?.leftEdge).toBe(40)
    expect(s.gadget(w, 9)).toBeNull()
  })
})
