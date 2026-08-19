import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { NA } from '../coverage/status'

const table = new TokenTable(CORE_TOKENS)
/** slot 20, from the source's own `ExtNb equ 20-1` */
const col = extensionById('jd-colour-2.0')!
const exts = new Map([[20, col.table]])

function run(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[20, col]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  mustFinish(r)
  return out
}
const val = (expr: string): string => run(`Print ${expr}`).trim()
/** the same without the trim, for the keywords where padding is the point */
const sval = (expr: string): string => run(`Print ${expr}`).replace(/\n$/, '')

describe('JD Colour: the nibble arithmetic (+|col.s:214-640)', () => {
  it('splits and rebuilds a 12-bit colour', () => {
    expect(val('Jd Red Value($F80)')).toBe('15')
    expect(val('Jd Green Value($F80)')).toBe('8')
    expect(val('Jd Blue Value($F80)')).toBe('0')
    expect(val('Hex$(Jd Rgb Value(15,8,0))')).toBe('$F80')
  })

  it('Grey Colour averages the three into all three', () => {
    // (15+8+0)/3 = 7 in each
    expect(val('Hex$(Jd Grey Colour($F80))')).toBe('$777')
  })

  it('Antique Colour divides the sum by three, four and five', () => {
    // sum 15+8+0 = 23 -> 7, 5, 4: red keeps most, blue least, hence brown
    expect(val('Hex$(Jd Antique Colour($F80))')).toBe('$754')
  })

  it('False Colour ROTATES the components rather than inverting them', () => {
    // exg d1,d3 then exg d2,d3: red<-blue, green<-red, blue<-green
    expect(val('Jd False Colour($F80)')).toBe(String(0x0f8))
  })

  it('Negative and Complement subtract each nibble from 15', () => {
    expect(val('Jd Negative Colour($F80)')).toBe(String(0x07f))
    expect(val('Hex$(Jd Complement Colour($000))')).toBe('$FFF')
  })

  it('Mix Colours adds and clamps at 15', () => {
    expect(val('Hex$(Jd Mix Colours($123,$321))')).toBe('$444')
    expect(val('Hex$(Jd Mix Colours($F00,$F00))')).toBe('$F00')
  })

  it('the separations are the printing operation the library is named for', () => {
    // cyan averages the other two into green with a +1 rounding and forces $F
    expect(val('Hex$(Jd Separate Cyan($F80))')).toBe('$F8F')
    expect(val('Hex$(Jd Separate Red($F80))')).toBe('$F00')
    expect(val('Jd Separate Blue($F80)')).toBe('0')
    // black bands the total: 23 is the top band
    expect(val('Hex$(Jd Separate Black($F80))')).toBe('$FFF')
    expect(val('Jd Separate Black($000)')).toBe('0')
  })

  it('each swap is one size smaller than its name suggests', () => {
    // routines 63/64/65 in the 2.0 binary, which has no source: Bswap is the
    // two NIBBLES of a byte, Wswap the two bytes of a word, Lswap the halves
    // of the longword
    expect(val('Hex$(Jd Bswap($1234))')).toBe('$43')
    expect(val('Hex$(Jd Bswap($AB))')).toBe('$BA')
    expect(val('Hex$(Jd Wswap($1234))')).toBe('$3412')
    expect(val('Hex$(Jd Lswap($12345678))')).toBe('$56781234')
  })

  it('Fit answers 1 rather than AMOS true', () => {
    // routine 55 is `move.l #1,d3` on the true path (+|col.s:1862), so a
    // program comparing it against True gets the wrong answer
    expect(val('Jd Fit(10,5)')).toBe('1')
    expect(val('Jd Fit(10,3)')).toBe('0')
    expect(val('Jd Fit(10,0)')).toBe('0')
  })

  it('Cut Off$ SPREADS the string out; it does not cut anything off', () => {
    // routine 56 (+|col.s:1876) writes each character then a space, then
    // backs over the last one: 2n-1 characters
    expect(sval('Jd Cut Off$("Test")')).toBe('T e s t')
    expect(sval('Jd Cut Off$("a")')).toBe('a')
  })

  it('Cut Off$ raises error 23 on an empty string and at 128 characters', () => {
    expect(() => run('Print Jd Cut Off$("")')).toThrow(/illegal function call/)
    expect(() => run('Print Jd Cut Off$(String$("x",128))')).toThrow(/illegal function call/)
    expect(sval('Jd Cut Off$(String$("x",127))').length).toBe(253)
  })
})

describe('JD Colour: the palette instructions', () => {
  it('Swap Colours and Copy Colour change the PALETTE', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$F00 : Colour 2,$00F',
      'Jd Swap Colours 1,2',
      'Print Colour(1);",";Colour(2)',
      'Jd Copy Colour 1 To 3',
      'Print Colour(3)',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual([`${0x00f}, ${0xf00}`, String(0x00f)])
  })

  it('Tone Colour brightens and darkens, clamped', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$777 : Jd Tone Colour 1,3 : Print Hex$(Colour(1))',
      'Colour 2,$222 : Jd Tone Colour 2,-5 : Print Colour(2)',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['$AAA', '0'])
  })

  it('Spread Palette ramps between two entries, ends untouched', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$000 : Colour 5,$FFF',
      'Jd Spread Palette 1 To 5',
      'Print Hex$(Colour(3));",";Hex$(Colour(1));",";Hex$(Colour(5))',
    ].join('\n'))
    // (15-0)/4 = 3.75 accumulated and truncated by SPFix at each entry:
    // 3.75 -> 3, 7.5 -> 7, 11.25 -> 11. Hex$ does not zero-pad, hence "$0"
    expect(out.trim()).toBe('$777,$0,$FFF')
  })

  it('Spread Palette rejects colour 0 outright — `cmp.l #0,d2 / ble _err`', () => {
    const head = 'Screen Open 0,320,200,16,Lowres\n'
    expect(() => run(head + 'Jd Spread Palette 0 To 4')).toThrow(/illegal function call/)
    expect(() => run(head + 'Jd Spread Palette 1 To 32')).toThrow(/illegal function call/)
  })

  it('a reversed pair is swapped, and a gap under two does nothing', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$000 : Colour 5,$FFF',
      'Jd Spread Palette 5 To 1',
      'Print Hex$(Colour(3))',
      'Colour 7,$F00 : Colour 8,$00F : Jd Spread Palette 7 To 8',
      'Print Hex$(Colour(7));",";Hex$(Colour(8))',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['$777', '$F00,$F'])
  })

  it('Pseudo Palette copies the fixed table, it does not generate a ramp', () => {
    // `ppal` (+|col.s:185): 32 words, blue through green and yellow to red
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Jd Pseudo Palette',
      'Print Hex$(Colour(0));",";Hex$(Colour(1));",";Hex$(Colour(15));",";Hex$(Colour(9))',
    ].join('\n'))
    expect(out.trim()).toBe('$0,$F,$4F0,$FE')
  })

  it('Lightest and Darkest Colour scan the palette', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'For I=0 To 15 : Colour I,0 : Next I',
      'Colour 5,$FFF : Colour 9,$111 : Colour 0,$222',
      'Print Jd Lightest Colour;",";Jd Darkest Colour',
    ].join('\n'))
    // 5 is the brightest. The darkest is a tie among every all-zero entry,
    // and routines 52/53 answer with the HIGHEST index of a tie -- the table
    // they build is filled backwards and searched forwards
    expect(out.trim()).toBe('5, 15')
  })

  it("the scan stops at the SCREEN's colour count, not the palette's", () => {
    // `move.w $60(a0),d0 / sub.l #1,d0` off ScOnAd: a 4-colour screen looks
    // at entries 0 to 3 and cannot answer with 5 however bright it is
    const out = run([
      'Screen Open 0,320,200,4,Lowres',
      'For I=0 To 15 : Colour I,0 : Next I',
      'Colour 2,$F00 : Colour 5,$FFF',
      'Print Jd Lightest Colour',
    ].join('\n'))
    expect(out.trim()).toBe('2')
  })

  it('no JD Colour keyword is n/a any more', () => {
    // the whole table is implemented; the import stays because this is the
    // check that says so
    const mine = [...NA].filter((k) => k.startsWith('jd ') && /colour|slide|con$|palette|raster|rastport/.test(k))
    expect(mine).toEqual([])
  })
})

/**
 * The Colour keywords the faithfulness gate found classified FAITHFUL with
 * nothing dispatching them.
 */
describe('JD Colour: the separations the gate caught (+|col.s:519-640)', () => {
  it('Magenta and Yellow follow Cyan\'s shape with a different channel forced', () => {
    // Cyan (:617) is the model: the other two components average into green
    // with a +1 rounding and the remaining channel is forced to $F. Magenta
    // forces RED, Yellow forces BLUE, each keeping the channel Cyan drops.
    // $F80 is r=15 g=8 b=0, so the average is (8+15+0+1)/3 = 8.
    expect(val('Hex$(Jd Separate Cyan($F80))')).toBe('$F8F')
    expect(val('Hex$(Jd Separate Magenta($F80))')).toBe('$F80')
    expect(val('Hex$(Jd Separate Yellow($F80))')).toBe('$FF8')
  })

  it('the rounding is a real +1, not a truncation', () => {
    // $111: (1+1+1+1)/3 = 1 where a plain average would also give 1, so use
    // $222 where (2+2+2+1)/3 = 2 and $F00 where (0+15+0+1)/3 = 5
    expect(val('Hex$(Jd Separate Magenta($F00))')).toBe('$F50')
    expect(val('Hex$(Jd Separate Yellow($F00))')).toBe('$FF5')
  })

  it('Green keeps only its own channel, as Red and Blue do', () => {
    // Hex$ does not pad, so the leading nibbles simply vanish from the text
    expect(val('Hex$(Jd Separate Green($F80))')).toBe('$80')
    expect(val('Hex$(Jd Separate Red($F80))')).toBe('$F00')
    expect(val('Hex$(Jd Separate Blue($F8C))')).toBe('$C')
  })

  it('Key To Asc answers 0 — the pair of tables is not carried', () => {
    // The manual's own example is Jd Key To Asc(253) -> 49, and 253 is not an
    // Amiga rawkey, so the tables are AMOS's own rather than the keyboard's.
    // Inventing a mapping to satisfy one example would be worse than what the
    // routine answers for a code it cannot find. See the DEVIATION and NOTES.
    expect(val('Jd Key To Asc(253)')).toBe('0')
    expect(val('Jd Key To Asc(65)')).toBe('0')
  })
})

/**
 * Four keywords that were n/a because of the list they were written into
 * rather than because of what they do. None of them needs a window, a
 * requester or a device.
 */
describe('JD Colour: the path helpers and the mouse counter', () => {
  it('Jd Mouse reads the Show/Hide nesting counter', () => {
    // routine 48 (+|col.s:1652) is `move.w -$1584(a5),d3 / ext.l d3` and
    // nothing else -- the counter AMOS's own Hide/Show stack keeps
    expect(run('Show On : Print Jd Mouse').trim()).toBe('0')
    expect(run('Show On : Hide : Print Jd Mouse').trim()).toBe('-1')
    expect(run('Show On : Hide : Hide : Print Jd Mouse').trim()).toBe('-2')
    // and a matching Show brings it back, which is the point of the keyword
    expect(run('Show On : Hide : Hide : Show : Print Jd Mouse').trim()).toBe('-1')
  })

  it('Jd Path$ keeps everything up to the last / or :', () => {
    // routine 62's backward scan stops at either separator
    expect(val('Jd Path$("DH0:Work/thing.txt")')).toBe('DH0:Work/')
    expect(val('Jd Path$("DH0:thing.txt")')).toBe('DH0:')
    expect(val('"["+Jd Path$("thing.txt")+"]"')).toBe('[]')
    expect(val('"["+Jd Path$("")+"]"')).toBe('[]')
  })

  it('Jd Drive$ stops at the colon alone', () => {
    // routine 79 carries its OWN copy of the scanner, testing only for ':'
    expect(val('Jd Drive$("DH0:Work/thing.txt")')).toBe('DH0:')
    expect(val('Jd Drive$("Work/thing.txt")')).toBe('')
    expect(val('Jd Drive$("DH0:")')).toBe('DH0:')
  })

  it('Jd File$ takes the tail past the separator', () => {
    expect(val('Jd File$("DH0:Work/thing.txt")')).toBe('thing.txt')
    expect(val('Jd File$("DH0:thing.txt")')).toBe('thing.txt')
    expect(val('"["+Jd File$("")+"]"')).toBe('[]')
  })

  it('DEFECT: with no separator Jd File$ drops the first character', () => {
    // d0 comes back 0 from the scanner, so the `addq.w #$1,a1` meant to step
    // over the separator steps over character zero instead. On the machine
    // the dbra then also reads one byte past the string; there is no
    // workspace here to read past, so the answer is that byte short
    expect(val('Jd File$("readme")')).toBe('eadme')
    expect(val('Jd File$("a")')).toBe('')
  })
})

describe('JD Colour: Jd Request, which is AutoRequest and not a file requester', () => {
  /** a Runtime parked on the requester, so the test can answer it */
  function park(src: string): { rt: Runtime; out: () => string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 2_000_000,
      onText: (t) => (out += t),
    })
    rt.frame() // runHeadless would answer the block itself
    return { rt, out: () => out }
  }

  it('answers -1 for the Ja gadget and 0 for the Nein one', () => {
    // routine 71's tail is `move.l d0,d3 / beq / moveq #$ff,d3`, and the
    // manual's "Ergebnis: -1/0 = ja/nein"
    const yes = park('A=Jd Request("Quit?","","","","","Yes","No") : Print A')
    const d = yes.rt.dialogs.get(yes.rt.jdColour.requestChan!)!
    yes.rt.finishDialogRun(d, 1) // gadget 1 is the leftmost, which is Ja
    mustFinish(yes.rt.runHeadless(500))
    expect(yes.out().trim()).toBe('-1')

    const no = park('A=Jd Request("Quit?","","","","","Yes","No") : Print A')
    no.rt.finishDialogRun(no.rt.dialogs.get(no.rt.jdColour.requestChan!)!, 2)
    mustFinish(no.rt.runHeadless(500))
    expect(no.out().trim()).toBe('0')
  })

  it('lays the five lines out in the order they are written', () => {
    // d4 counts DOWN as the arguments pop right to left, so argument one is
    // the top line
    const b = park('A=Jd Request("one","two","three","","","Y","N")')
    const d = b.rt.dialogs.get(b.rt.jdColour.requestChan!)!
    // variable 0 is the title bar, which AutoRequest has nothing to put in
    expect(d.vars[0]).toBe('')
    expect(d.vars[1]).toBe('one')
    expect(d.vars[2]).toBe('two')
    expect(d.vars[3]).toBe('three')
  })

  it('drops empty body lines rather than drawing them blank', () => {
    // each of the five is scanned with NO default, so an empty one is skipped
    const b = park('A=Jd Request("one","","three","","","Y","N")')
    const d = b.rt.dialogs.get(b.rt.jdColour.requestChan!)!
    expect(d.vars[1]).toBe('one')
    expect(d.vars[2]).toBe('three')
  })

  it('defaults to Retry/Cancel only when Nein was left empty', () => {
    // the conditional the `move.l a0,d0 / beq $2798` makes: JA$ gets its
    // default only if the NEIN$ pop fell back to one
    const both = park('A=Jd Request("x","","","","","","")')
    const d1 = both.rt.dialogs.get(both.rt.jdColour.requestChan!)!
    // one body line, so the labels start at 2
    expect(d1.vars[2]).toBe('Retry')
    expect(d1.vars[3]).toBe('Cancel')

    // supply a Nein and leave Ja empty: the Ja gadget gets NO text at all
    const one = park('A=Jd Request("x","","","","","","Stop")')
    const d2 = one.rt.dialogs.get(one.rt.jdColour.requestChan!)!
    expect(d2.vars[2]).toBe('')
    expect(d2.vars[3]).toBe('Stop')
  })

  it('raises when every body line is empty', () => {
    expect(() => run('A=Jd Request("","","","","","Y","N")')).toThrow(/llegal function call/)
  })
})

describe('JD Colour: Jd Rprint, Jd Setoutput and Jd Guru', () => {
  /** a Runtime that has run `src`, for the checks that read the bitmap */
  function ran(src: string): Runtime {
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 200_000,
      onText: () => {},
    })
    mustFinish(rt.runHeadless(500))
    return rt
  }

  /** lit pixels in a band of the top text row */
  function lit(rt: Runtime, x1: number, x2: number): number {
    let n = 0
    for (let y = 0; y < 8; y++) for (let x = x1; x <= x2; x++) if (rt.screen.point(x, y) !== 0) n++
    return n
  }

  it('Jd Rprint right-justifies on the current row', () => {
    // routine 54: (screen width in pixels / 8) - length gives the column, so
    // on a 320-wide screen "abc" starts at column 37 -- x 296 to 319
    const rt = ran('Screen Open 0,320,200,4,0 : Cls 0 : Jd Rprint "abc"')
    expect(lit(rt, 296, 319)).toBeGreaterThan(0)
    expect(lit(rt, 0, 295)).toBe(0)
  })

  it('and prints nothing at all for an empty string', () => {
    // `move.w (a0)+,d1 / beq leer`
    const rt = ran('Screen Open 0,320,200,4,0 : Cls 0 : Jd Rprint ""')
    expect(lit(rt, 0, 319)).toBe(0)
  })

  it('NOTE: an over-long string is not clamped, so it prints where it stood', () => {
    // `sub.w d1,d0 / ext.l d0` goes negative and a negative column means
    // "leave it where it is". AMOS's own Centre clamps at zero; this does not,
    // so the text starts after the "xy" already on the row rather than at 0
    const rt = ran('Screen Open 0,320,200,4,0 : Cls 0 : Print "xy"; : Jd Rprint String$("z",60)')
    expect(lit(rt, 0, 15)).toBeGreaterThan(0) // the "xy"
    expect(lit(rt, 16, 31)).toBeGreaterThan(0) // and the z's carry straight on
  })

  it('Jd Setoutput Amiga switches the line ending, and Amos puts it back', () => {
    // the dos.library Write patch turns a trailing CR+LF into a bare LF
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.currentDir = 'RAM:'
    const go = (src: string): string => {
      const rt = new Runtime(tokenize(src, table, exts), table, {
        extensions: exts,
        extBindings: new Map([[20, col]]),
        maxSteps: 200_000,
        fs,
        onText: () => {},
      })
      mustFinish(rt.runHeadless(500))
      const b = rt.fs?.read('RAM:out.txt')
      return b ? String.fromCharCode(...b) : ''
    }
    expect(go('Open Out 1,"RAM:out.txt" : Print #1,"hi" : Close 1')).toBe('hi\r\n')
    expect(go('Jd Setoutput Amiga : Open Out 1,"RAM:out.txt" : Print #1,"hi" : Close 1')).toBe('hi\n')
    expect(
      go('Jd Setoutput Amiga : Jd Setoutput Amos : Open Out 1,"RAM:out.txt" : Print #1,"hi" : Close 1'),
    ).toBe('hi\r\n')
  })

  it('and each is idempotent, which is what the guards are for', () => {
    // `cmp.l #1,d0 / bne setami / rts` -- asking for the convention already in
    // force returns without touching the vector
    const rt = new Runtime(tokenize('Jd Setoutput Amiga : Jd Setoutput Amiga', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 200_000,
      onText: () => {},
    })
    mustFinish(rt.runHeadless(500))
    expect(rt.amigaLineEnds).toBe(true)
  })

  it('Jd Guru opens its own 640x32 two-colour screen and blocks', () => {
    const rt = new Runtime(tokenize('Screen Open 0,320,200,4,0 : A=Jd Guru("Software Failure","Click a button")', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 200_000,
      onText: () => {},
    })
    rt.frame()
    const g = rt.screens.get(11)!
    expect([g.width, g.height, g.nColors]).toEqual([640, 32, 2])
    expect(g.palette[0]).toBe(0x000)
    expect(g.palette[1]).toBe(0xd00)
    // the border is drawn, so something is lit on the top row
    expect(g.point(320, 1)).toBe(1)
    // and it is still waiting
    expect(rt.currentIndex).toBe(11)
  })

  it('answers 1 for the left button and 2 for the right, then restores', () => {
    const go = (mouse: number): { a: string; rt: Runtime } => {
      let out = ''
      const rt = new Runtime(
        tokenize('Screen Open 0,320,200,4,0 : A=Jd Guru("Guru","Meditation") : Print A', table, exts),
        table,
        { extensions: exts, extBindings: new Map([[20, col]]), maxSteps: 200_000, onText: (t) => (out += t) },
      )
      rt.frame()
      rt.input.mouseK = mouse
      mustFinish(rt.runHeadless(500))
      return { a: out.trim(), rt }
    }
    const left = go(1)
    // the two guru lines were written to its screen and land in the same
    // text stream, so the answer is what follows them
    expect(left.a.endsWith('1')).toBe(true)
    // screen 11 is deleted and the program's own screen is current again
    expect(left.rt.screens.has(11)).toBe(false)
    expect(left.rt.currentIndex).toBe(0)
    expect(go(2).a.endsWith('2')).toBe(true)
  })

  it('skips an empty line rather than printing it blank', () => {
    // `cmp.w #0,(a1)+ / beq` on each of the two
    const rt = new Runtime(tokenize('A=Jd Guru("only one","")', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 200_000,
      onText: () => {},
    })
    rt.frame()
    expect(rt.jdColour.guru).not.toBeNull()
  })
})

describe('JD Colour: the CON: window, on AMOS\'s own console', () => {
  function boot(src: string): { rt: Runtime; out: () => string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 200_000,
      onText: (t) => (out += t),
    })
    return { rt, out: () => out }
  }

  it('Open Con answers a non-zero handle and Close Con takes it back', () => {
    const b = boot('C=Jd Open Con("0/0/640/100/Test") : Print C<>0 : Jd Close Con C : Print 1')
    mustFinish(b.rt.runHeadless(200))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([-1, 1])
  })

  it('the caller writes only x/y/w/h/title and the CON: is the extension\'s', () => {
    // "CON:" is four literal bytes at data+$214 and the string is copied to
    // +$218, which is why Open is handed a pointer four bytes before the copy
    const b = boot('C=Jd Open Con("0/0/640/100/Test")')
    mustFinish(b.rt.runHeadless(200))
    const opened = [...b.rt.jdColour.consoles.values()]
    expect(opened).toEqual(['CON:0/0/640/100/Test'])
  })

  it('Print Con writes the string with no line ending of its own', () => {
    const b = boot('C=Jd Open Con("") : Jd Print Con C,"one" : Jd Print Con C,"two"')
    mustFinish(b.rt.runHeadless(200))
    expect(b.out()).toBe('onetwo')
  })

  it('and both of its guards do nothing rather than erroring', () => {
    // `cmp.l #$0,d1 / beq` on the handle and `cmp.w #$0,d3 / beq` on the text
    const b = boot('C=Jd Open Con("") : Jd Print Con 0,"nope" : Jd Print Con C,"" : Jd Close Con 0 : Print 9')
    mustFinish(b.rt.runHeadless(200))
    expect(b.out().trim()).toBe('9')
  })

  it('Input Con reads a line and strips the newline', () => {
    const b = boot('C=Jd Open Con("") : A$=Jd Input Con(C) : Print "["+A$+"]"')
    b.rt.frame() // parks on the input block
    b.rt.submitLine('typed')
    mustFinish(b.rt.runHeadless(200))
    expect(b.out()).toContain('[typed]')
  })

  it('NOTE: a zero handle answers an uninitialised register pair', () => {
    // `beq.w $2a0e` goes straight to the rts without setting d3 or d2, so the
    // machine hands back whatever the last keyword left. The empty string is
    // the only safe reading of that
    const b = boot('Print "["+Jd Input Con(0)+"]"')
    mustFinish(b.rt.runHeadless(200))
    expect(b.out().trim()).toBe('[]')
  })
})

describe('JD Colour: the whole-screen group', () => {
  function ran(src: string): Runtime {
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 2_000_000,
      onText: () => {},
    })
    mustFinish(rt.runHeadless(500))
    return rt
  }

  const OPEN = 'Screen Open 0,64,32,16,0 : Cls 0 : '

  it('Screen Border paints everything OUTSIDE the rectangle', () => {
    // four filled strips -- left, right, top, bottom -- not an outline
    const rt = ran(`${OPEN}Jd Screen Border 3,10,8 To 40,24`)
    expect(rt.screen.point(0, 0)).toBe(3) // outside
    expect(rt.screen.point(5, 16)).toBe(3) // left strip
    expect(rt.screen.point(50, 16)).toBe(3) // right strip
    expect(rt.screen.point(20, 2)).toBe(3) // top strip
    expect(rt.screen.point(20, 28)).toBe(3) // bottom strip
    expect(rt.screen.point(20, 16)).toBe(0) // inside is untouched
  })

  it('Change Colours swaps the two, and Fill Colour replaces one', () => {
    // anchored at the origin, where x1 and y1 are both 0, so the row-restart
    // defect cannot show
    const swap = ran(`${OPEN}Ink 1 : Bar 0,0 To 9,4 : Ink 2 : Bar 10,0 To 19,4 : Jd Change Colours 1,2,0,0 To 19,4`)
    expect(swap.screen.point(5, 2)).toBe(2)
    expect(swap.screen.point(15, 2)).toBe(1)

    const fill = ran(`${OPEN}Ink 2 : Bar 0,0 To 19,4 : Jd Fill Colour 5 To 2,0,0 To 19,4`)
    expect(fill.screen.point(5, 2)).toBe(5)
  })

  it('DEFECT: every row after the first starts at y1, not x1', () => {
    // `Dmove mousek,d0` reloads X from the saved y1. With x1=10 and y1=0 the
    // second row onwards sweeps from column 0, so a pixel at (2,1) that the
    // caller placed OUTSIDE the region is changed anyway
    const rt = ran(`${OPEN}Ink 1 : Bar 0,0 To 30,4 : Jd Fill Colour 5 To 1,10,0 To 30,4`)
    // row 0 really did start at x1 = 10
    expect(rt.screen.point(2, 0)).toBe(1)
    // row 1 started at y1 = 0 instead, so a pixel left of x1 was swept
    expect(rt.screen.point(2, 1)).toBe(5)
  })

  it('a slide leaves the destination holding the source', () => {
    const rt = ran(
      'Screen Open 0,64,32,16,0 : Cls 0 : Ink 3 : Bar 0,0 To 31,15 : ' +
        'Screen Open 1,64,32,16,0 : Cls 0 : Jd Slide X 0 To 1',
    )
    const dst = rt.screens.get(1)!
    expect(dst.point(5, 5)).toBe(3)
    expect(dst.point(50, 25)).toBe(0)
  })

  it('all six slides do it, differing only in an animation nothing paces', () => {
    for (const kw of ['Jd Slide X', 'Jd Slide Y', 'Jd Slide Left', 'Jd Slide Right', 'Jd Slide Up', 'Jd Slide Down']) {
      const rt = ran(
        'Screen Open 0,64,32,16,0 : Cls 0 : Ink 2 : Bar 0,0 To 63,31 : ' +
          `Screen Open 1,64,32,16,0 : Cls 0 : ${kw} 0 To 1`,
      )
      expect(rt.screens.get(1)!.point(10, 10), kw).toBe(2)
    }
  })

  it('Save Palette writes APal and 32 words, and Load Palette reads them back', () => {
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.currentDir = 'RAM:'
    const go = (src: string): Runtime => {
      const rt = new Runtime(tokenize(src, table, exts), table, {
        extensions: exts,
        extBindings: new Map([[20, col]]),
        maxSteps: 500_000,
        fs,
        onText: () => {},
      })
      mustFinish(rt.runHeadless(500))
      return rt
    }
    go(`${OPEN}Colour 1,$F00 : Colour 2,$0F0 : Jd Save Palette "RAM:p.pal"`)
    const raw = new AmigaFS() // read it back through the same volume
    void raw
    const saved = go('Rem').fs?.read('RAM:p.pal')
    expect(saved).toBeDefined()
    expect(String.fromCharCode(...saved!.subarray(0, 4))).toBe('APal')
    expect(saved!.length).toBe(68)

    const back = go(`${OPEN}Colour 1,$00F : Jd Load Palette "RAM:p.pal"`)
    expect(back.screen.palette[1]).toBe(0xf00)
    expect(back.screen.palette[2]).toBe(0x0f0)
  })

  it('and a file without the magic leaves the palette alone', () => {
    // `cmp.l #'APal',(a0)+ / bne kmissing`, checked AFTER the read and close
    const fs = new AmigaFS()
    const ram = fs.mountMemory('RAM')
    ram.write(['bad.pal'], new Uint8Array(68))
    fs.currentDir = 'RAM:'
    const rt = new Runtime(tokenize(`${OPEN}Colour 1,$00F : Jd Load Palette "RAM:bad.pal"`, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 500_000,
      fs,
      onText: () => {},
    })
    mustFinish(rt.runHeadless(500))
    expect(rt.screen.palette[1]).toBe(0x00f)
  })

  it('Screen Convert scales, and identical resolutions do nothing', () => {
    // `cmp.l d6,d7 / bne do_it` -- the same resolution both sides returns
    const same = ran(
      'Screen Open 0,64,32,16,0 : Cls 0 : Ink 3 : Bar 0,0 To 63,31 : ' +
        'Screen Open 1,64,32,16,0 : Cls 0 : Jd Screen Convert 0,0 To 1,0',
    )
    expect(same.screens.get(1)!.point(10, 10)).toBe(0)

    const wide = ran(
      'Screen Open 0,32,32,16,0 : Cls 0 : Ink 3 : Bar 0,0 To 15,31 : ' +
        'Screen Open 1,64,32,16,$8000 : Cls 0 : Jd Screen Convert 0,0 To 1,$8000',
    )
    // low to hires doubles across, so source column 15 lands at 30 and 31
    expect(wide.screens.get(1)!.point(30, 10)).toBe(3)
    expect(wide.screens.get(1)!.point(34, 10)).toBe(0)
  })

  it('Wait Raster folds its line and waits a frame', () => {
    // `bpl rapo / neg.l d0` then repeated -256; there is no beam, so the wait
    // is a frame, which is what a raster line comes round on
    const rt = new Runtime(tokenize('Jd Wait Raster -300 : Print 1', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[20, col]]),
      maxSteps: 500_000,
      onText: () => {},
    })
    const before = rt.interp.tick
    mustFinish(rt.runHeadless(500))
    expect(rt.interp.tick).toBeGreaterThan(before)
  })
})
