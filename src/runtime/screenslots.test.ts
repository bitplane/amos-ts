/**
 * The screen slot table and who owns each slot.
 *
 * The machine has one copper list, so every display anything opens has to be
 * a band in it and a slot in one table — see `Runtime.SCREEN_SLOTS`. These
 * check the partition, the allocator both intuition.library and GMS will
 * reach for, and the three keywords that were no-ops while AMOS was the only
 * owner there could be.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime, type ScreenOwner } from './runtime'
import { Screen } from './screen'

const table = new TokenTable(CORE_TOKENS)

function boot(src = 'Rem'): Runtime {
  return new Runtime(tokenize(src, table), table, { maxSteps: 200_000 })
}

function out(src: string): string {
  let text = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000, onText: (t) => (text += t) })
  mustFinish(rt.runHeadless(2000))
  return text.trim()
}

/** open a screen directly at `slot`, the way a system screen is opened */
function openAt(rt: Runtime, slot: number): void {
  const s = new Screen(slot, 320, 200, 2, 0)
  rt.screens.set(slot, s)
  rt.order = rt.order.filter((i) => i !== slot)
  rt.order.push(slot)
}

describe('the slot partition', () => {
  it('runs user, amos, game, os and covers every slot exactly once', () => {
    const seen: ScreenOwner[] = []
    for (let i = 0; i < Runtime.SCREEN_SLOTS; i++) {
      const o = Runtime.screenOwner(i)
      expect(o, `slot ${i}`).not.toBeNull()
      seen.push(o!)
    }
    expect(seen.slice(0, 8).every((o) => o === 'user')).toBe(true)
    expect(seen.slice(8, 12).every((o) => o === 'amos')).toBe(true)
    expect(seen.slice(12, 20).every((o) => o === 'game')).toBe(true)
    expect(seen.slice(20, 32).every((o) => o === 'os')).toBe(true)
  })

  it('owns nothing outside the table', () => {
    expect(Runtime.screenOwner(-1)).toBeNull()
    expect(Runtime.screenOwner(Runtime.SCREEN_SLOTS)).toBeNull()
  })

  /** the user's screens and AMOS's own move together; nothing else does */
  it('counts the user range and the AMOS system range together', () => {
    expect(Runtime.amosOwned(0)).toBe(true)
    expect(Runtime.amosOwned(Runtime.EC_FSEL)).toBe(true)
    expect(Runtime.amosOwned(12)).toBe(false)
    expect(Runtime.amosOwned(20)).toBe(false)
  })

  /**
   * `Screen Open` names 0-7 and nothing else, which is the only thing that
   * makes a slot above them a system one.
   */
  it('Screen Open still refuses everything above the user range', () => {
    const rt = boot()
    expect(() => rt.openScreen(8, 320, 200, 2, 0)).toThrow(/Valid screen numbers/i)
    expect(() => rt.openScreen(12, 320, 200, 2, 0)).toThrow(/Valid screen numbers/i)
  })
})

describe('the slot allocator', () => {
  it('hands out the lowest free slot of the owner asked for', () => {
    const rt = boot()
    // screen 0 is open from the boot default, so the user range starts at 1
    expect(rt.freeScreenSlot('user')).toBe(1)
    expect(rt.freeScreenSlot('amos')).toBe(8)
    expect(rt.freeScreenSlot('game')).toBe(12)
    expect(rt.freeScreenSlot('os')).toBe(20)
  })

  it('skips a slot that is taken', () => {
    const rt = boot()
    openAt(rt, 12)
    openAt(rt, 13)
    expect(rt.freeScreenSlot('game')).toBe(14)
  })

  it('answers -1 when an owner has no free slot left', () => {
    const rt = boot()
    for (let i = 12; i < 20; i++) openAt(rt, i)
    expect(rt.freeScreenSlot('game')).toBe(-1)
    // and the neighbours are untouched
    expect(rt.freeScreenSlot('os')).toBe(20)
  })
})

describe('Amos To Front, Amos To Back and =Amos Here', () => {
  /**
   * The case every existing program is in: nothing but AMOS screens, so both
   * keywords are the identity and AMOS is trivially in front. This is what
   * they did as no-ops and it must not have changed.
   */
  it('are the identity with nothing but AMOS screens open', () => {
    const rt = boot('Screen Open 1,320,200,2,0 : Amos To Back : Amos To Front')
    mustFinish(rt.runHeadless(2000))
    expect(rt.order).toEqual([0, 1])
    expect(rt.amosInFront()).toBe(true)
    expect(out('Print Amos Here')).toBe('-1')
  })

  it('move AMOS as one block against a screen it does not own', () => {
    const rt = boot()
    openAt(rt, 1) // a user screen, AMOS's
    openAt(rt, 20) // an OS screen, not
    expect(rt.order).toEqual([0, 1, 20])

    rt.amosToFront()
    expect(rt.order).toEqual([20, 0, 1])
    expect(rt.amosInFront()).toBe(true)

    rt.amosToBack()
    expect(rt.order).toEqual([0, 1, 20])
    expect(rt.amosInFront()).toBe(false)
  })

  it('keep the order within each side while moving the block', () => {
    const rt = boot()
    openAt(rt, 12)
    openAt(rt, 1)
    openAt(rt, 13)
    openAt(rt, 2)
    // back to front: 0, 12, 1, 13, 2
    rt.amosToFront()
    expect(rt.order).toEqual([12, 13, 0, 1, 2])
    rt.amosToBack()
    expect(rt.order).toEqual([0, 1, 2, 12, 13])
  })

  it('=Amos Here answers 0 when somebody else is in front', () => {
    const rt = new Runtime(tokenize('Print Amos Here', table), table, {
      maxSteps: 200_000,
      onText: (t) => (text += t),
    })
    let text = ''
    openAt(rt, 20)
    rt.amosToBack()
    mustFinish(rt.runHeadless(2000))
    expect(text.trim()).toBe('0')
  })

  /** an empty display is AMOS's: there is nothing in front of it */
  it('=Amos Here is true with no screens at all', () => {
    const rt = boot()
    rt.closeScreen(0)
    expect(rt.order).toEqual([])
    expect(rt.amosInFront()).toBe(true)
  })

  /** InAmosLock is to-front plus T_NoFlip, and now it can do both halves */
  it('Amos Lock brings AMOS to the front as well as locking it', () => {
    const rt = boot('Amos Lock')
    openAt(rt, 20)
    mustFinish(rt.runHeadless(2000))
    expect(rt.noFlip).toBe(true)
    expect(rt.order[rt.order.length - 1]).toBe(0)
  })
})

describe('the address space follows the table', () => {
  it('gives every slot a bitplane and a control-block stride', () => {
    const rt = boot()
    const last = Runtime.SCREEN_SLOTS - 1
    expect(rt.screenCtrlAddr(last)).toBe(Runtime.SCREEN_CTRL_BASE + last * Runtime.SCREEN_CTRL_SLOT)
    // and the whole run stays below the next region's base
    expect(Runtime.SCREEN_CHIP_BASE + Runtime.SCREEN_SLOTS * Runtime.SCREEN_CHIP_SLOT).toBeLessThanOrEqual(
      Runtime.SLN_HEAP_BASE,
    )
    expect(Runtime.SCREEN_CTRL_BASE + Runtime.SCREEN_SLOTS * Runtime.SCREEN_CTRL_SLOT).toBeLessThanOrEqual(
      Runtime.MAKE_HEAP_BASE,
    )
  })

  /** a screen in the new range is a screen in every respect, EC_FSEL's rule */
  it('composites a screen in the OS range like any other', () => {
    const rt = boot()
    openAt(rt, 20)
    const s = rt.screens.get(20)!
    expect(rt.resolveAddr(rt.screenChipBase(20))).not.toBeNull()
    expect(s.width).toBe(320)
  })
})
