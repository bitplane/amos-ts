import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { IE_RASTPORT_OFFSET } from './intuiextendgfx'
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

describe('IntuiExtend 1.6 — the 3D object format', () => {
  /** the header is one count word, where 2.01b's is 'IE3D' and a count */
  it('Wb 3d Make Object stamps no magic', () => {
    expect(out('O=Wb 3d Make Object(4,2)\nPrint Deek(O)')).toBe('4')
    expect(out('O=Wb 3d Make Object(4,2)\nPrint Deek(O)', ie20)).toBe('18757')
  })

  /** 12p + 8s + 4 here, and 12p + 8s + 8 there */
  it('the shape count sits four bytes earlier than in 2.01b', () => {
    expect(out('O=Wb 3d Make Object(4,2)\nPrint Deek(O+2+4*12)')).toBe('2')
    expect(out('O=Wb 3d Make Object(4,2)\nPrint Deek(O+6+4*12)', ie20)).toBe('2')
  })

  /** the block is cleared, so an untouched point reads zero */
  it('allocates a cleared block', () => {
    expect(out('O=Wb 3d Make Object(4,2)\nPrint Leek(O+2);Leek(O+6)')).toBe('0 0')
  })

  /**
   * The token spec is `I0,0,0t0,0` in both builds and the two `To` arguments
   * mean opposite things, so the same line writes to a different place.
   */
  it('Wb 3d Edge takes the object first and counts points from zero', () => {
    const src = 'O=Wb 3d Make Object(4,2)\nWb 3d Edge 11,22,33 To O,0\nPrint Leek(O+2);Leek(O+6);Leek(O+10)'
    expect(out(src)).toBe('11 22 33')
  })

  it('and point 1 is the second, not the first', () => {
    const src = 'O=Wb 3d Make Object(4,2)\nWb 3d Edge 7,8,9 To O,1\nPrint Leek(O+2);Leek(O+14)'
    expect(out(src)).toBe('0 7')
  })

  /** the shapes follow the points and the count word after them */
  it('Wb 3d Shape writes four words into shape zero', () => {
    const src =
      'O=Wb 3d Make Object(4,2)\nWb 3d Shape 1,2,3,4 To O,0\n' +
      'B=O+2+4*12+2\nPrint Deek(B);Deek(B+2);Deek(B+4);Deek(B+6)'
    expect(out(src)).toBe('1 2 3 4')
  })

  it('and shape one is eight bytes on', () => {
    const src = 'O=Wb 3d Make Object(4,2)\nWb 3d Shape 5,6,7,8 To O,1\nB=O+2+4*12+2\nPrint Deek(B);Deek(B+8)'
    expect(out(src)).toBe('0 5')
  })

  /**
   * DEFECT: `add.l dN,$2(a0,d0.w)` three times over. X, Y and Z all land on
   * the point's X and the other two coordinates are never written.
   */
  it('Wb 3d Move Edge adds all three to the X coordinate', () => {
    const src =
      'O=Wb 3d Make Object(4,2)\nWb 3d Edge 100,200,300 To O,0\n' +
      'Wb 3d Move Edge 1,2,4 To O,0\nPrint Leek(O+2);Leek(O+6);Leek(O+10)'
    expect(out(src)).toBe('107 200 300')
  })

  /**
   * The same routine in both builds. Here `move.w (a0)+` reads the point
   * count; in 2.01b it reads the high word of the magic.
   */
  it('Wb 3d Move Object moves every point', () => {
    const src =
      'O=Wb 3d Make Object(2,1)\nWb 3d Edge 10,20,30 To O,0\nWb 3d Edge 40,50,60 To O,1\n' +
      'Wb 3d Move Object 1,2,3 To O\nPrint Leek(O+2);Leek(O+6);Leek(O+10);Leek(O+14);Leek(O+18);Leek(O+22)'
    expect(out(src)).toBe('11 22 33 41 52 63')
  })

  /**
   * A keyword here and an alias for the free in 2.01b, so this is the one
   * line of BASIC that keeps the object in one build and destroys it in the
   * other.
   */
  it('Wb 3d Clear Object zeroes the body and keeps the counts', () => {
    const src =
      'O=Wb 3d Make Object(2,1)\nWb 3d Edge 10,20,30 To O,0\nWb 3d Shape 1,2,3,4 To O,0\n' +
      'Wb 3d Clear Object O\nB=O+2+2*12+2\nPrint Deek(O);Leek(O+2);Deek(O+2+2*12);Deek(B)'
    expect(out(src)).toBe('2 0 1 0')
  })

  /** and the object is still there afterwards, which is the whole difference */
  it('the object survives a clear', () => {
    const src =
      'O=Wb 3d Make Object(2,1)\nWb 3d Clear Object O\nWb 3d Edge 5,6,7 To O,0\nPrint Leek(O+2)'
    expect(out(src)).toBe('5')
  })
})

describe('IntuiExtend 1.6 — Wb Scroll', () => {
  /** a screen's RastPort is its Screen address plus $54, as elsewhere here */
  const RP = (Runtime.SCREEN_CTRL_BASE + IE_RASTPORT_OFFSET) >>> 0

  /**
   * `Wb Scroll A To 50,100,150,550,0,100` is the archive's own
   * examples/ScrollWind.asc, so X,Y,W,H are ScrollRaster's xMin, yMin, xMax
   * and yMax and the last pair is the step. The guide calls the middle two a
   * width and a height; the vector takes them as the far corner.
   */
  const scroll = (args: string): string =>
    out(
      'Screen Open 0,320,200,4,Lowres\nCls 0\nPlot 10,100,3\n' +
        `Wb Scroll ${RP} To ${args}\nPrint Point(10,100);Point(10,95)`,
    )

  it('takes six arguments after the To', () => {
    expect(ie16.tokens.find((t) => t.name === 'wb scroll')!.spec).toBe('I0t0,0,0,0,0,0')
  })

  it('a zero step leaves the raster alone', () => {
    expect(scroll('0,0,100,100,0,0')).toBe('3 0')
  })

  /**
   * Positive dy moves the contents UP, so the pixel at 10,100 lands at 10,95
   * and the row it left is refilled with the RastPort's background pen. That
   * fill is this port's stand-in for the damage a layered ScrollRaster would
   * leave for the window's owner to refresh; ../amiga/graphics.ts says so.
   */
  it('a positive Y step moves the contents up and backfills', () => {
    expect(scroll('0,0,100,100,0,5')).toBe('1 3')
  })

  /** the four middle arguments are the corners: a pixel outside them stays */
  it('nothing outside the rectangle moves', () => {
    expect(scroll('50,50,100,100,0,5')).toBe('3 0')
  })

  /** an address that is not a RastPort this port knows does nothing */
  it('does nothing for a RastPort it does not know', () => {
    expect(
      out('Screen Open 0,320,200,4,Lowres\nCls 0\nPlot 10,100,3\nWb Scroll 12345 To 0,0,100,100,0,5\nPrint Point(10,100)'),
    ).toBe('3')
  })
})

describe('IntuiExtend 1.6 — the two 2.01b was right to drop', () => {
  /**
   * Six bytes: both arguments popped, nothing written. The author's own
   * examples/3dSort.asc sorts its faces in BASIC and never calls it.
   */
  it('Wb 3d Sort does nothing at all', () => {
    const src = 'O=Wb 3d Make Object(2,1)\nWb 3d Edge 1,2,3 To O,0\nWb 3d Sort O To 1\nPrint Leek(O+2)'
    expect(out(src)).toBe('1')
  })

  it('and it takes two arguments across a To', () => {
    expect(ie16.tokens.find((t) => t.name === 'wb 3d sort')!.spec).toBe('I0t0')
  })

  /**
   * DEFECT: the name sits on `Iff Get Error`'s routine 306, so the one thing
   * it does is clear a pending IFF error and throw the answer away.
   */
  it('Wb Menu Text clears the IFF error it never asked for', () => {
    const src = 'A=Iff Open Read("nosuch")\nWb Menu Text 1,2,3,"x",4\nPrint Iff Get Error'
    expect(out(src)).toBe('0')
  })

  it('where without it the error is still there to read', () => {
    const src = 'A=Iff Open Read("nosuch")\nPrint Iff Get Error<>0'
    expect(out(src)).toBe('-1')
  })

  it('and it is an instruction with five arguments', () => {
    expect(ie16.tokens.find((t) => t.name === 'wb menu text')!.spec).toBe('I0,0,0,2,0')
  })
})

describe('IntuiExtend 1.6, reached through AMOS', () => {
  const SCREEN = 'Screen Open 0,320,256,16,Lowres\nCls 0\n'
  const RP = (Runtime.SCREEN_CTRL_BASE + IE_RASTPORT_OFFSET) >>> 0

  it('Wb Turtleplot draws at the cursor plus the offset and leaves it (routine 49, $2e54)', () => {
    // the `add.w` at $2e60 is into d0 and d1, not into the RastPort, so the
    // cursor is where it was
    const b = run(`${SCREEN}Wb Gfx Ink ${RP} To 5,0\nWb Turtleplot ${RP} To 10,10`)
    const rp = b.rt.screen!.rp
    expect(rp.point(10, 10)).toBe(5)
    expect([rp.cpX, rp.cpY]).toEqual([0, 0])
  })

  it('=Iff Make Palette writes to its second argument (routine 295, $55ce)', () => {
    // the guide calls that argument a colour count. GetColorTable takes a0 as
    // the buffer to fill and the routine pops a0 from the LAST argument, so a
    // program following the guide writes its palette to low memory.
    const src =
      'Reserve As Work 10,64\nC=Start(10)\n' +
      'Reserve As Work 11,64\nD=Start(11)\n' +
      // FORM <len> ILBM CMAP <3> $f0,$00,$00
      'Loke C,$464F524D\nLoke C+4,20\nLoke C+8,$494C424D\n' +
      'Loke C+12,$434D4150\nLoke C+16,3\nLoke C+20,$F0000000\n' +
      'N=Iff Make Palette(C,D)\nPrint N\nPrint Deek(D)\n'
    // one colour reported, $f00 written, and each gun keeps its top four bits
    expect(out(src)).toBe('1 3840')
  })
})
