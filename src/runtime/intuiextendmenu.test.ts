import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!

function run(src: string): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ie.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

/** a window, which four of the six keywords need before a menu matters */
const OPEN = 'Wb Screen Open 0,0,320,200,3,0\nS=Wb Screen Base\nWb Wind Open S To 10,20,200,100,0\nW=Wb Wind Base\n'

/**
 * Two menus, two items under the first and one sub-item under its second,
 * built the only way an IntuiExtend program can build one: by hand.
 *
 * `struct Menu` is 30 bytes and `struct MenuItem` 34 (`intuition.i`:74 and
 * :112). mu_NextMenu and mi_NextItem are both at 0, mu_Flags and mi_Flags
 * both at 12, mu_FirstItem at 18 and mi_SubItem at 28.
 */
const BUILD =
  'M=Alloc Mem(30,$10001) : M2=Alloc Mem(30,$10001)\n' +
  'I=Alloc Mem(34,$10001) : I2=Alloc Mem(34,$10001) : SB=Alloc Mem(34,$10001)\n' +
  'Loke M,M2 : Doke M+12,1 : Loke M+18,I\n' +
  'Doke M2+12,1\n' +
  'Loke I,I2 : Doke I+12,$10\n' +
  'Doke I2+12,$10 : Loke I2+28,SB\n' +
  'Doke SB+12,$10\n'

/** FULLMENUNUM, spelled out so the test does not lean on `Get Menu Code` */
const code = (menu: number, item: number, sub: number): number =>
  (menu & 0x1f) | ((item & 0x3f) << 5) | ((sub & 0x1f) << 11)

/** NOITEM and NOSUB, the "this field names nothing" values */
const NOITEM = 0x3f
const NOSUB = 0x1f

describe('IntuiExtend 2.01b — attaching a menu strip', () => {
  /**
   * Routine 111 ($368e) is SetMenuStrip (-$108) and routine 289 ($5568) is
   * `move.l $1c(a0),d3`, wd_MenuStrip. So what goes in comes back out.
   */
  it('Wb Menu To Window answers AMOS true and Wb Get Menu reads the pointer back', () => {
    const out = lines(OPEN + BUILD + 'Print Wb Menu To Window(W,M)\nPrint Wb Get Menu(W)=M\n')
    expect(out).toEqual(['-1', '-1'])
  })

  /** ClearMenuStrip (-$36), and wd_MenuStrip is NULL afterwards */
  it('Wb Kill Menu detaches the strip', () => {
    const out = lines(OPEN + BUILD + 'R=Wb Menu To Window(W,M)\nWb Kill Menu W\nPrint Wb Get Menu(W)\n')
    expect(out).toEqual(['0'])
  })

  /**
   * The chain itself is the program's, so detaching must not disturb it:
   * ClearMenuStrip takes the strip away from the window and frees nothing.
   */
  it('leaves the program its chain after Wb Kill Menu', () => {
    const out = lines(
      OPEN + BUILD + 'R=Wb Menu To Window(W,M)\nWb Kill Menu W\nR=Wb Menu To Window(W,M)\nPrint Wb Get Menu(W)=M\n',
    )
    expect(out).toEqual(['-1'])
  })

  /** a `struct Window *` is a handle here, and one nothing minted is not a window */
  it('answers 0 for a window it never opened', () => {
    expect(lines(OPEN + 'Print Wb Get Menu($4A000FF0)\n')).toEqual(['0'])
    expect(lines(OPEN + BUILD + 'Print Wb Menu To Window($4A000FF0,M)\n')).toEqual(['0'])
  })

  /**
   * Men2 gives "Wb Kill Menu To WINDOW". The spec is `"I0"`, which carries no
   * `t` token, so the `To` the guide writes is a syntax error.
   */
  it('refuses the To the guide writes for Wb Kill Menu', () => {
    expect(ie.tokens.find((t) => t.name === 'wb kill menu')!.spec).toBe('I0')
    expect(() => run(OPEN + 'Wb Kill Menu To W\n')).toThrow()
  })
})

describe('IntuiExtend 2.01b — Wb Find Menu Item', () => {
  /**
   * ItemAddress (-$90) walks mu_NextMenu, then mi_NextItem from mu_FirstItem,
   * then mi_NextItem from mi_SubItem. A NOSUB stops at the item.
   */
  it('walks the three chains the number names', () => {
    const src =
      BUILD +
      `Print Wb Find Menu Item(M,${code(0, 0, NOSUB)})=I\n` +
      `Print Wb Find Menu Item(M,${code(0, 1, NOSUB)})=I2\n` +
      `Print Wb Find Menu Item(M,${code(0, 1, 0)})=SB\n`
    expect(lines(src)).toEqual(['-1', '-1', '-1'])
  })

  /** a chain shorter than the number asks for is intuition's NULL */
  it('answers 0 when the chain runs out', () => {
    const src =
      BUILD +
      `Print Wb Find Menu Item(M,${code(0, 5, NOSUB)})\n` +
      `Print Wb Find Menu Item(M,${code(2, 0, NOSUB)})\n` +
      `Print Wb Find Menu Item(M,${code(0, 0, 0)})\n`
    expect(lines(src)).toEqual(['0', '0', '0'])
  })

  /** MENUNULL, the value a MENUPICK carries when nothing was picked */
  it('answers 0 for MENUNULL and for a null strip', () => {
    expect(lines(BUILD + 'Print Wb Find Menu Item(M,$FFFF)\n')).toEqual(['0'])
    expect(lines(BUILD + 'Print Wb Find Menu Item(0,0)\n')).toEqual(['0'])
  })

  /**
   * Men0 is "MENUPTR=Wb Find Menu Item(MENUADR,ITEMNB)" and MENUADR is the
   * CHAIN, not the window: $365a pops ITEMNB into d0 and $365c pops MENUADR
   * into a0, which is ItemAddress(menuStrip, menuNumber).
   */
  it('takes the chain rather than the window', () => {
    expect(lines(OPEN + BUILD + 'R=Wb Menu To Window(W,M)\nPrint Wb Find Menu Item(W,0)\n')).toEqual(['0'])
  })
})

describe('IntuiExtend 2.01b — Wb On Menu and Wb Off Menu', () => {
  /**
   * A number whose ITEMNUM is NOITEM names the whole column, and the bit is
   * MENUENABLED ($0001, `intuition.i`:77) in mu_Flags.
   */
  it('clears and sets MENUENABLED in the program memory', () => {
    const whole = code(0, NOITEM, NOSUB)
    const src = OPEN + BUILD + `R=Wb Menu To Window(W,M)\nWb Off Menu W To ${whole}\nPrint Deek(M+12)\n`
    expect(lines(src)).toEqual(['0'])
    const back = OPEN + BUILD + `R=Wb Menu To Window(W,M)\nWb Off Menu W To ${whole}\nWb On Menu W To ${whole}\nPrint Deek(M+12)\n`
    expect(lines(back)).toEqual(['1'])
  })

  /** the second menu of the chain, so the walk is doing something */
  it('reaches the menu the number names and not the first', () => {
    const second = code(1, NOITEM, NOSUB)
    const src = OPEN + BUILD + `R=Wb Menu To Window(W,M)\nWb Off Menu W To ${second}\nPrint Deek(M+12);Deek(M2+12)\n`
    expect(lines(src)).toEqual(['1 0'])
  })

  /** anything else names one item, and the bit is ITEMENABLED ($0010, :119) */
  it('clears and sets ITEMENABLED on an item', () => {
    const one = code(0, 1, NOSUB)
    const off = OPEN + BUILD + `R=Wb Menu To Window(W,M)\nWb Off Menu W To ${one}\nPrint Deek(I+12);Deek(I2+12)\n`
    expect(lines(off)).toEqual(['16 0'])
    const on = OPEN + BUILD + `R=Wb Menu To Window(W,M)\nWb Off Menu W To ${one}\nWb On Menu W To ${one}\nPrint Deek(I2+12)\n`
    expect(lines(on)).toEqual(['16'])
  })

  /** and on a sub-item, which is the third chain */
  it('reaches a sub-item', () => {
    const sub = code(0, 1, 0)
    const src = OPEN + BUILD + `R=Wb Menu To Window(W,M)\nWb Off Menu W To ${sub}\nPrint Deek(SB+12);Deek(I2+12)\n`
    expect(lines(src)).toEqual(['0 16'])
  })

  /** OffMenu goes through wd_MenuStrip, so with none attached there is nothing to reach */
  it('does nothing when no strip is attached', () => {
    const src = OPEN + BUILD + `Wb Off Menu W To ${code(0, NOITEM, NOSUB)}\nPrint Deek(M+12)\n`
    expect(lines(src)).toEqual(['1'])
  })
})

describe('IntuiExtend 2.01b — the corrupted Wb Get Menu Adr entry', () => {
  /**
   * One name in the 88 shipped tables begins with a control character, and
   * both of its routine fields are unusable: `instr` $ff00 is not a routine
   * number and `func` $ffff is the "no routine" marker.
   */
  it('is the only table entry whose name is not typable', () => {
    const bad = ie.tokens.filter((t) => /[\x00-\x1f]/.test(t.name))
    expect(bad.map((t) => t.name)).toEqual(['\x00rwb get menu adr'])
    expect(bad[0]!.instr).toBe(0xff00)
    expect(bad[0]!.func).toBe(0xffff)
  })

  /**
   * IntuiExtend 1.6 has the entry intact, and its func word is 114. $0072 is
   * 114, which is exactly the two bytes now sitting at the front of 2.01b's
   * name: the header was written two bytes short and its own func word ended
   * up in the name field.
   */
  it('carries the 1.6 routine number as the first two bytes of its name', () => {
    const name = ie.tokens.find((t) => /[\x00-\x1f]/.test(t.name))!.name
    const head = (name.charCodeAt(0) << 8) | name.charCodeAt(1)
    expect(head).toBe(114)

    const old = extensionById('intuiextend-1.6')!.tokens.find((t) => t.name === 'wb get menu adr')!
    expect(old.func).toBe(114)
    expect(old.spec).toBe('00')
    expect(name.slice(2)).toBe('wb get menu adr')
  })

  /**
   * And the capability is not lost: `Wb Get Menu` (routine 289) is the same
   * four instructions under a name the guide never mentions, while
   * Index.guide still links the dead one.
   */
  it('is replaced by Wb Get Menu, which the guide has no node for', () => {
    const live = ie.tokens.find((t) => t.name === 'wb get menu')!
    expect(live.func).toBe(289)
    expect(live.spec).toBe('00')
  })
})
