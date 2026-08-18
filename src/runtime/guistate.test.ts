/**
 * GUI 2.10's state, against what GUI2.guide says each keyword answers.
 *
 * Every number here is the guide's. The event codes are its own list and the
 * four close codes are its own four lines; where it leaves an order
 * undecided, the test says which one this port chose and why, so a later
 * reading of the binary can disagree with something specific.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_GUI_BANK, GUI_CLOSE, GUI_EVENT, GUI_MENU_NEXT, GuiState, packMenuNumber } from './guistate'
import { BARLABEL, MENUNULL, NM, NOITEM, NOMENU, NOSUB, itemNum, menuNum, subNum } from '../amiga/gadtools'
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
    tagsAt: 0,
    gadgetTags: [],
    windowTags: [],
    menus: [],
    title: '',
    screenName: '',
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

/** a two-title bar with a separator, a shortcut and two sub-items */
function withMenus(): Gui {
  const g = design(1)
  g.menus = [
    { type: NM.TITLE, label: 'Project' },
    { type: NM.ITEM, label: 'Open', commKey: 'O' },
    { type: NM.ITEM, label: BARLABEL },
    { type: NM.ITEM, label: 'Quit', commKey: 'Q' },
    { type: NM.TITLE, label: 'View' },
    { type: NM.ITEM, label: 'Browse' },
    { type: NM.SUB, label: 'By name' },
    { type: NM.SUB, label: 'By date' },
  ]
  return g
}

/**
 * Routine 224 at $4c10, which every menu keyword's arguments go through.
 *
 * The interesting half is what a zero does: `subq.l #1` then a clamp to -1,
 * so nothing a program can write reaches a field as a positive number it did
 * not mean. -1 is intuition's NOMENU, NOITEM and NOSUB.
 */
describe('the menu number the keywords pack', () => {
  it('is one-based, and a zero means the field is absent', () => {
    const n = packMenuNumber(1, 1, 1)
    expect([menuNum(n), itemNum(n), subNum(n)]).toEqual([0, 0, 0])
    const noSub = packMenuNumber(2, 3, 0)
    expect([menuNum(noSub), itemNum(noSub), subNum(noSub)]).toEqual([1, 2, NOSUB])
    const whole = packMenuNumber(3, 0, 0)
    expect([menuNum(whole), itemNum(whole), subNum(whole)]).toEqual([2, NOITEM, NOSUB])
  })

  /** all three absent is MENUNULL, which is what an empty MENUPICK carries */
  it('packs three absent fields into MENUNULL', () => {
    expect(packMenuNumber(0, 0, 0)).toBe(MENUNULL)
    expect([menuNum(MENUNULL), itemNum(MENUNULL), subNum(MENUNULL)]).toEqual([NOMENU, NOITEM, NOSUB])
  })

  /**
   * The rotates in the binary spill the sign of a -1 field above bit 15 and
   * intuition's own macros mask it off. Sixteen bits here is the same answer,
   * which this states as arithmetic rather than as prose.
   */
  it('never needs more than sixteen bits', () => {
    for (let m = 0; m <= 4; m++) {
      for (let i = 0; i <= 4; i++) {
        for (let sub = 0; sub <= 4; sub++) {
          const n = packMenuNumber(m, i, sub)
          expect(n, `${m},${i},${sub}`).toBe(n & 0xffff)
        }
      }
    }
  })
})

describe('menus', () => {
  it('builds a strip when the design carries one, and none when it does not', () => {
    const s = stateWith(withMenus(), design(1))
    expect(s.open(1, 0)!.strip?.menus).toHaveLength(2)
    expect(s.open(2, 1)!.strip).toBeNull()
  })

  /**
   * `Gui Menu(1..3)` answers one-based, which is the `addq.l #$1,d3` at
   * $1d4e. A pick of the first item of the first menu with no sub-item
   * therefore reads 1, 1, 32: the sub field held NOSUB, and 31 plus one is
   * 32 rather than 0.
   */
  it('takes the pending pick apart one-based, NOSUB included', () => {
    const s = stateWith(withMenus())
    s.open(1, 0)
    s.postMenu(1, packMenuNumber(1, 1, 0))
    expect(s.nextEvent()).toBe(GUI_EVENT.MENU)
    expect([s.menuField(1), s.menuField(2), s.menuField(3)]).toEqual([1, 1, NOSUB + 1])
  })

  it('reads a sub-item back as the third field', () => {
    const s = stateWith(withMenus())
    s.open(1, 0)
    s.postMenu(1, packMenuNumber(2, 1, 2))
    expect([s.menuField(1), s.menuField(2), s.menuField(3)]).toEqual([2, 1, 2])
  })

  /**
   * With no event pending the `moveq #$ff,d3` at $1cfa falls straight through
   * to the exit, and an argument the chain at $1d36 does not recognise
   * reaches the addq as -2. Both are -1.
   */
  it('answers -1 with nothing pending and for an argument it does not know', () => {
    const s = stateWith(withMenus())
    s.open(1, 0)
    expect(s.menuField(1)).toBe(-1)
    s.postMenu(1, packMenuNumber(1, 1, 0))
    expect(s.menuField(9)).toBe(-1)
  })

  /** `Gui Menu(4)` walks NextSelect and stops on MENUNULL */
  it('steps a multi-select and stops at the end of the chain', () => {
    const s = stateWith(withMenus())
    const w = s.open(1, 0)!
    const first = s.gt.itemAddress(w.strip!, packMenuNumber(1, 1, 0))!
    first.nextSelect = packMenuNumber(1, 3, 0)
    s.postMenu(1, packMenuNumber(1, 1, 0))
    expect(s.menuField(GUI_MENU_NEXT)).toBe(1)
    expect([s.menuField(1), s.menuField(2)]).toEqual([1, 3])
    expect(s.menuField(GUI_MENU_NEXT)).toBe(0)
  })

  it('forgets the pending pick when Gui Reset closes everything', () => {
    const s = stateWith(withMenus())
    s.open(1, 0)
    s.postMenu(1, packMenuNumber(1, 1, 0))
    s.reset()
    expect(s.menuField(1)).toBe(-1)
    expect(s.menuField(GUI_MENU_NEXT)).toBe(0)
  })
})
