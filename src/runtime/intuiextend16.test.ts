import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { ie16Digits, iePalNegativ16, ieSwatch16 } from './intuiextend16'
import { iePalNegativ } from './intuiextendsys'

const table = new TokenTable(CORE_TOKENS)
const ie16 = extensionById('intuiextend-1.6')!
const ie20 = extensionById('intuiextend-2.01b')!

/** the extension in the slot decides which build's behaviour answers */
function run(src: string, ext = ie16): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ext.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ext]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const out = (src: string, ext = ie16): string => run(src, ext).out().trim().replace(/\s+/g, ' ')

describe('IntuiExtend 1.6 — the table', () => {
  it('carries 294 named keywords', () => {
    expect(ie16.tokens.filter((t) => t.name.trim() !== '').length).toBe(294)
  })

  /** 2.01b rebuilt the table, so a name is at a different id in each build */
  it('shares 284 names with 2.01b and 45 of their ids', () => {
    const named = (e: typeof ie16) => e.tokens.filter((t) => t.name.trim() !== '')
    const by20 = new Map(named(ie20).map((t) => [t.name, t]))
    const shared = named(ie16).filter((t) => by20.has(t.name))
    expect(shared.length).toBe(284)
    expect(shared.filter((t) => by20.get(t.name)!.id === t.id).length).toBe(45)
  })

  /** the four 2.01b dropped, and the six it respelled */
  it('has ten names 2.01b does not', () => {
    const in20 = new Set(ie20.tokens.map((t) => t.name))
    const only = ie16.tokens.filter((t) => t.name.trim() !== '' && !in20.has(t.name)).map((t) => t.name)
    expect(only.sort()).toEqual([
      'iff make palette',
      'shearch',
      'wb 3d sort',
      'wb get menu adr',
      'wb menu text',
      'wb pubscreen status',
      'wb remove all gedget',
      'wb scroll',
      'wb set pubscreen modes',
      'wb turtleplot',
    ])
  })
})

describe('IntuiExtend 1.6 — the six respellings', () => {
  /** `shearch` is `search`: the same routine 21, byte for byte */
  it('Shearch is Search', () => {
    expect(out('Print Shearch(0,0,65)')).toBe('-1')
  })

  it('Wb Turtleplot takes the same four arguments', () => {
    expect(ie16.tokens.find((t) => t.name === 'wb turtleplot')!.spec).toBe('I0t0,0')
  })

  it('Wb Pubscreen Status answers', () => {
    expect(out('Print Wb Pubscreen Status(0,0)')).toBe('0')
  })

  it('Wb Set Pubscreen Modes answers', () => {
    expect(out('Print Wb Set Pubscreen Modes(0)')).toBe('0')
  })

  /**
   * The name 2.01b's table lost. Routine 114 is the same ten bytes in both
   * builds and 2.01b reaches it as `Wb Get Menu`, so both answer wd_MenuStrip.
   */
  it('Wb Get Menu Adr is Wb Get Menu', () => {
    const src = 'Wb Wind Open 0 To 0,0,100,50,0\nW=Wb Wind Base\nPrint Wb Get Menu Adr(W)'
    const same = 'Wb Wind Open 0 To 0,0,100,50,0\nW=Wb Wind Base\nPrint Wb Get Menu(W)'
    expect(out(src)).toBe(out(same, ie20))
  })

  /** and 2.01b cannot type it, because its own entry begins with a NUL */
  it('is not a name 2.01b has', () => {
    expect(ie20.tokens.some((t) => t.name === 'wb get menu adr')).toBe(false)
  })
})

describe('IntuiExtend 1.6 — Pal Negativ', () => {
  /** `sub.w (a3)+,d3` takes the high word, which every colour leaves at zero */
  it('answers 4095 whatever the colour', () => {
    expect(iePalNegativ16(0)).toBe(4095)
    expect(iePalNegativ16(0x123)).toBe(4095)
    expect(iePalNegativ16(0xfff)).toBe(4095)
  })

  /** the high word is the half it does read */
  it('the high word is what it subtracts', () => {
    expect(iePalNegativ16(0x0003_0000)).toBe(4092)
  })

  it('the keyword answers the same', () => {
    expect(out('Print Pal Negativ($123)')).toBe('4095')
  })

  /** 2.01b is broken in the same four lines and not in the same way */
  it('2.01b does something else entirely', () => {
    expect(iePalNegativ(0x123)).not.toBe(4095)
    expect(out('Print Pal Negativ($123)', ie20)).toBe(String(iePalNegativ(0x123)))
  })
})

describe('IntuiExtend 1.6 — Hard Mouse Key', () => {
  /**
   * Both builds go to the silicon: CIA-A port A bit 6 for the left button and
   * POTGOR bits 10 and 8 for the right and the middle, all three active low.
   * ../amiga/gameport.ts composes those two registers from the held buttons,
   * so a test presses them the way ./craft.ts's `Hw Mouse Key` test does.
   */
  const press = (mouseK: number, ext = ie16): string => {
    const exts = new Map([[23, ext.table]])
    let printed = ''
    const rt = new Runtime(tokenize('Print Hard Mouse Key', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[23, ext]]),
      maxSteps: 100_000,
      onText: (t) => (printed += t),
    })
    rt.input.mouseK = mouseK
    mustFinish(rt.runHeadless(5000))
    return printed.trim()
  }

  it('answers zero with nothing pressed', () => {
    expect(press(0)).toBe('0')
  })

  it('the left button is bit 0 in both builds', () => {
    expect(press(1)).toBe('1')
    expect(press(1, ie20)).toBe('1')
  })

  it('the right button is bit 1 in both builds', () => {
    expect(press(2)).toBe('2')
    expect(press(2, ie20)).toBe('2')
  })

  /**
   * DEFECT: `bset.b #$4,d3` puts the middle button on 16. 2.01b reads the
   * same POTGOR bit and puts it on 4, keeping 16 for port 1's right button,
   * so a program moved between the builds tests the wrong bit.
   */
  it('the middle button is 16 here and 4 in 2.01b', () => {
    expect(press(4)).toBe('16')
    expect(press(4, ie20)).toBe('4')
  })

  /** and the two disagree as soon as the middle button is in the answer */
  it('all three together', () => {
    expect(press(1 | 2 | 4)).toBe('19')
    expect(press(1 | 2 | 4, ie20)).toBe('7')
  })

  /** 1.6 tests three lines where 2.01b tests six, so 8 and 32 are unreachable */
  it('never sets the three bits port 1 would', () => {
    for (const k of [0, 1, 2, 4, 3, 5, 6, 7]) {
      expect(Number(press(k)) & (8 | 32)).toBe(0)
    }
  })
})

describe('IntuiExtend 1.6 — Wb Swatch', () => {
  /** put a time in the six registers, S1 first, and read the string back */
  const at = (h10: number, h1: number, m10: number, m1: number, s10: number, s1: number): string => {
    const exts = new Map([[23, ie16.table]])
    let printed = ''
    const rt = new Runtime(tokenize('Print Wb Swatch', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[23, ie16]]),
      maxSteps: 100_000,
      onText: (t) => (printed += t),
    })
    const bc = rt.machine.battclock!
    const now = rt.host.clock.now()
    bc.read(now)
    const digits = [s1, s10, m1, m10, h1, h10]
    for (let i = 0; i < 6; i++) bc.write(i, digits[i]!, now)
    mustFinish(rt.runHeadless(5000))
    return printed.trim()
  }

  it('reads the six time registers as HH:MM:SS', () => {
    expect(at(1, 4, 2, 5, 3, 6)).toBe('14:25:36')
  })

  it('midnight is all zeroes', () => {
    expect(at(0, 0, 0, 0, 0, 0)).toBe('00:00:00')
  })

  /** the colons and the length word are shipped data, not something written */
  it('the separators are in place without being written', () => {
    expect(at(2, 3, 5, 9, 0, 1)).toBe('23:59:01')
  })

  /**
   * The divisor list at workspace+$198 is real here, so a nibble above nine
   * converts to two characters where 2.01b's dead loop emits one '?'.
   */
  it('a nibble past nine converts to two digits', () => {
    expect(ie16Digits(15)).toBe('15')
    expect(ie16Digits(10)).toBe('10')
    expect(ie16Digits(9)).toBe('9')
    expect(ie16Digits(0)).toBe('0')
  })

  /** and the sixth of those overruns the six-byte scratch into the length word */
  it('a two-character digit shifts everything after it', () => {
    expect(ieSwatch16([15, 0, 0, 0, 0, 0])).not.toBe('00:00:00')
  })
})

describe('IntuiExtend 1.6 — Wb Get Msg', () => {
  /**
   * DEFECT: no `moveq #$ff,d3` and no test of the port, so a null message is
   * dereferenced. 2.01b answers -1 for both.
   */
  it('does not answer -1 for a port with nothing on it', () => {
    expect(out('P=Wb Create Port("x",0)\nPrint Wb Get Msg(P)')).toBe('0')
  })

  it('2.01b answers -1 for the same port', () => {
    expect(out('P=Wb Create Port("x",0)\nPrint Wb Get Msg(P)', ie20)).toBe('-1')
  })

  it('a null port is not special-cased either', () => {
    expect(out('Print Wb Get Msg(0)')).toBe('0')
  })
})
