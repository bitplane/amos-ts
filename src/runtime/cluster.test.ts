import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { DEFAULT_MOUSE_BANK } from './mousebank.gen'
import { amosErrorCode, type AmosError } from '../interp/values'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): { rt: Runtime; out: string } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return { rt, out }
}

/** fixtures/ is gitignored, so the three corpus-file tests below skip in a
 *  fresh clone and in CI rather than failing. */
const corpus = (rel: string): string => join(__dirname, '../../fixtures/official-amos', rel)
const have = (rel: string): boolean => existsSync(corpus(rel))

describe('language cluster', () => {
  it('sorts arrays and finds entries with Match', () => {
    const prog = [
      'Dim A(4)',
      'A(0)=5 : A(1)=1 : A(2)=9 : A(3)=3 : A(4)=7',
      'Sort A(0)',
      'Print A(0);A(1);A(2);A(3);A(4)',
      'Print Match(A(0),7)',
      'Print Match(A(0),8)<0',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe(' 1 3 5 7 9\n 3\n-1\n')
    expect(run('Dim A$(2)\nA$(0)="c" : A$(1)="a" : A$(2)="b"\nSort A$(0)\nPrint A$(0);A$(1);A$(2)').out).toBe('abc\n')
  })

  it('rotates and tests bits (Rol/Ror/Bset/Bclr/Bchg/Btst)', () => {
    expect(run('A=1 : Rol.b 1,A : Print A').out).toBe(' 2\n')
    expect(run('A=1 : Ror.b 1,A : Print A').out).toBe(' 128\n')
    expect(run('A=$80000000 : Rol.l 1,A : Print A').out).toBe(' 1\n')
    expect(run('A=0 : Bset 3,A : Print A;Btst(3,A);Btst(2,A)').out).toBe(' 8-1 0\n')
    expect(run('A=8 : Bchg 3,A : Print A').out).toBe(' 0\n')
  })

  it('converts text and graphic coordinates against the current window', () => {
    /*
     * CXyWi (+W.s:10828) answers EntNul for a coordinate outside the window,
     * at CXyw0 and CXyw3, where WiXGr and WiYGr (+W.s:15272) answer -1 at
     * WiXYo. Two sentinels for the two directions, and the port returned -1
     * for all four.
     */
    expect(run('Print X Text(80);Y Text(16);X Text(999)').out).toBe(' 10 2-2147483648\n')
    expect(run('Print X Graphic(10);Y Graphic(2)').out).toBe(' 80 16\n')
    // FnXGraphic (+Lib.s:10872) opens Rbmi L_FonCall, which is 23
    const code = (src: string): number => {
      try {
        run(src)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    expect(code('A=X Graphic(-1)')).toBe(23)
    expect(code('A=Y Graphic(-1)')).toBe(23)
    // past the window edge is -1, and the default window is 40 by 25
    expect(run('Print X Graphic(40);Y Graphic(25)').out).toBe('-1-1\n')
    /*
     * A window away from the origin proves the offsets are real. WiAdr
     * (+W.s:13763) writes WiDxI and WiDyI from the window's own position, so
     * column 0 of window 1 is not column 0 of the screen, and the two
     * directions have to invert each other. They did not: X Graphic ignored
     * the window entirely and X Text measured against the whole screen.
     */
    const w = 'Screen Open 0,320,200,16,Lowres\nWind Open 1,40,32,10,5\n'
    expect(run(`${w}Print X Text(X Graphic(3));Y Text(Y Graphic(2))`).out).toBe(' 3 2\n')
    // and the window's own column 0 is not the screen's
    expect(run(`${w}Print X Graphic(0)>0;Y Graphic(0)>0`).out).toBe('-1-1\n')
  })

  it('interprets escape strings from At/Pen$/Paper$ when printed', () => {
    const { rt } = run('Print At(5,3)+Pen$(7)+"X";')
    expect(rt.screen.curWin.pen).toBe(7)
    // "X" was drawn at text cell (5,3) in pen 7
    let found = false
    for (let y = 24; y < 32; y++) for (let x = 40; x < 48; x++) if (rt.screen.point(x, y) === 7) found = true
    expect(found).toBe(true)
  })

  it('console styles: Inverse/Under On; Set Text only styles graphic Text (+Lib.s:9908)', () => {
    const inv = run('Cls 0 : Inverse On : Pen 5 : Paper 0 : Locate 0,0 : Print "A"').rt
    // inverse: background cells get the pen colour
    expect(inv.screen.point(0, 0)).toBe(5)
    const und = run('Cls 0 : Under On : Pen 5 : Paper 0 : Locate 0,0 : Print "A"').rt
    for (let x = 0; x < 8; x++) expect(und.screen.point(x, 7)).toBe(5) // underline row
    // Set Text is the rastport SoftStyle: Print is NOT underlined...
    const st = run('Cls 0 : Set Text 1 : Pen 5 : Paper 0 : Locate 0,0 : Print "."').rt
    expect(st.screen.point(0, 7)).toBe(0)
    // ...but Text is
    const tx = run('Cls 0 : Set Text 1 : Ink 5 : Text 0,13,"." : X=1').rt
    for (let x = 0; x < 8; x++) expect(tx.screen.point(x, 14)).toBe(5)
    expect(run('Set Text 5\nPrint Text Styles').out.trim()).toBe('5')
  })

  it('Scroll Off wraps printing to the window top', () => {
    const prog = ['Ink 6 : Plot 300,190', 'Scroll Off', 'For I=1 To 30 : Print "L" : Next'].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(300, 190)).toBe(6) // nothing scrolled
    expect(rt.screen.curY).toBeLessThan(25)
  })
})

describe('faithfulness pass: Inc/Dec/Add/Hunt/Wait (vs +ILib.s:4382 / +Lib.s:2073/2672)', () => {
  it('Inc/Dec/Add wrap integers at 32 bits (addq.l/add.l on the long)', () => {
    // $80000000 rather than -2147483648: `declong` ($271AE) answers zero on
    // overflow and 2147483648 is one past the top, so the decimal spelling
    // tokenises as a minus in front of a nothing
    const { out } = run(['X=2147483647', 'Inc X', 'Print X', 'Y=$80000000', 'Dec Y', 'Print Y', 'Z=2147483647', 'Add Z,2', 'Print Z'].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['-2147483648', '2147483647', '-2147483647'])
  })

  it('Add with base To top wraps both directions (InAdd4)', () => {
    const { out } = run(['M=12', 'Add M,1,1 To 12', 'Print M', 'Add M,-1,1 To 12', 'Print M'].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '12'])
  })

  it('Inc and Dec take an INTEGER variable and nothing else', () => {
    // `VerInc` (+Verif.s:1206) is `bsr VerVEnt / bsr VerGV`, and VerVEnt
    // (:1460) ends `bsr VarA0 / tst.b d0 / bne VerType` -- d0 is the
    // variable's kind and only kind 0 passes. So a float or a string is a
    // Type mismatch before the program runs, and `Add` (:1213) opens with the
    // same two calls. No corpus program increments a float.
    expect(() => run('F#=1.5\nInc F#')).toThrow(/type mismatch/i)
    expect(() => run('A$="x"\nInc A$')).toThrow(/type mismatch/i)
    expect(() => run('F#=1.5\nAdd F#,1')).toThrow(/type mismatch/i)
    expect(run('X=1\nInc X\nPrint X').out.trim()).toBe('2')
  })

  it('Wait errors on negative counts (InWait: Rbmi FonCall)', () => {
    expect(() => run('Wait -1')).toThrow(/illegal function call/i)
  })

  it('Wait 0 waits forever (Wait_Event +Lib.s:2086)', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    const rt = new Runtime(tokenize('Wait 0\nPrint "never"', table), table, { maxSteps: 100_000, fs, onText: () => {} })
    const r = rt.runHeadless(50)
    expect(r.status).toBe('blocked')
  })

  it('Hunt accepts a bank number as start and allows overhanging matches (FnHunt)', () => {
    const prog = [
      'Reserve As Work 10,32',
      'Poke Start(10)+4,65 : Poke Start(10)+5,66 : Poke Start(10)+6,67',
      'Print Hunt(10 To Start(10)+32,"ABC")-Start(10)',
      // the candidate start is before finish, the tail extends past it
      'Print Hunt(Start(10) To Start(10)+5,"ABC")-Start(10)',
      'Print Hunt(Start(10) To Start(10)+4,"ABC")',
      'Print Hunt(10 To Start(10)+32,"")',
    ].join('\n')
    const { out } = run(prog)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['4', '4', '0', '0'])
  })
})

describe('faithfulness pass: text & fonts (vs +W.s / +Lib.s)', () => {
  it('Locate errors outside the window (Loca +W.s:15335, error 60)', () => {
    expect(() => run('Locate 200,0')).toThrow(/illegal text window parameter/i)
    expect(() => run('Locate 0,200')).toThrow(/illegal text window parameter/i)
  })

  it('Pen/Paper error at the screen colour count (+W.s:14879/14893)', () => {
    expect(() => run('Pen 16')).toThrow(/illegal text window parameter/i) // default screen: 16 colours
    expect(() => run('Paper 99')).toThrow(/illegal text window parameter/i)
    expect(run('Pen 15 : Print "ok"').out).toContain('ok')
  })

  it('At validates coordinates above 207 (FnAt +Lib.s:14017)', () => {
    // the branch is `cmp.l #255-48,d2 / Rbhi L_WFonCall`, and WFonCall is
    // `moveq #16,d0 / Rbra L_EcWiErr` — error 60, not the 23 this test used
    // to assert. Pen and Paper just above reach 60 for the same reason.
    expect(() => run('X$=At(208,0)')).toThrow(/illegal text window parameter/i)
    expect(run('Print At(2,3)="X"+Chr$(50)+"Y"+Chr$(51)').out.trim()).toBe('-1')
  })

  it('Border$ wraps text in the Encadre escapes and the box is drawn (FnBorderD/Encadre)', () => {
    expect(() => run('X$=Border$("hi",0)')).toThrow(/illegal function call/i)
    expect(() => run('X$=Border$("hi",16)')).toThrow(/illegal function call/i)
    // Curs Off first: the cursor is drawn INTO the bitmap now (AffCur), so it
    // would sit in the last cell this checks and clear its bottom two rows
    const { rt } = run('Curs Off : Cls 0 : Pen 5 : Locate 2,2 : Print Border$("HELLO",2);')
    // style 2 is TEncadre row 2: codes 128,129,130,132,135,134,133,131 —
    // AMOS's own glyphs, poked over the ROM font from bin/+WFont.bin
    // (+W.s:9640), so the drawn cells are those bitmaps byte for byte
    const cell = (cx: number, cy: number): number[] => {
      const rows: number[] = []
      for (let y = 0; y < 8; y++) {
        let b = 0
        for (let x = 0; x < 8; x++) if (rt.screen.point(cx * 8 + x, cy * 8 + y) === 5) b |= 0x80 >> x
        rows.push(b)
      }
      return rows
    }
    // top-left corner (128), top edge (129), top-right (130)
    expect(cell(1, 1)).toEqual([0xff, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0])
    expect(cell(2, 1)).toEqual([0xff, 0, 0, 0, 0, 0, 0, 0])
    expect(cell(7, 1)).toEqual([0xff, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03])
    // left and right uprights (131, 132) beside the text
    expect(cell(1, 2)).toEqual([0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0])
    expect(cell(7, 2)).toEqual([0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03])
    // bottom-left (133), bottom edge (134), bottom-right (135)
    expect(cell(1, 3)).toEqual([0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xff])
    expect(cell(2, 3)).toEqual([0, 0, 0, 0, 0, 0, 0, 0xff])
    expect(cell(7, 3)).toEqual([0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0xff])
  })

  it('Font$ needs Get Fonts, formats 38 chars, "" past the list (FnFont +Lib.s:9757)', () => {
    expect(() => run('Print Font$(1)')).toThrow(/fonts not examined/i)
    const { out } = run('Get Fonts\nPrint Len(Font$(1))\nPrint Font$(999)="";Font$(0)=""')
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['38', '-1-1'])
    const { out: o2 } = run('Get Fonts\nPrint Font$(1)')
    expect(o2).toContain('topaz.font')
    expect(o2).toContain('Rom')
  })

  it('Set Font: 0 is a no-op, unknown numbers error (TSFont +W.s:4922)', () => {
    expect(run('Get Fonts\nSet Font 0\nPrint "ok"').out).toContain('ok')
    expect(() => run('Set Font 1')).toThrow(/fonts not examined/i)
    expect(() => run('Get Fonts\nSet Font 999')).toThrow(/font not available/i)
  })
})

describe('faithfulness pass: graphics odds (vs +Lib.s / +W.s)', () => {
  it('Bar errors on non-increasing coordinates (InBar +Lib.s:9946)', () => {
    expect(() => run('Bar 10,10 To 10,20')).toThrow(/illegal function call/i)
    expect(() => run('Bar 10,10 To 20,10')).toThrow(/illegal function call/i)
    expect(() => run('Bar 20,20 To 10,30')).toThrow(/illegal function call/i)
  })

  it('Box runs one continuous dash pattern around the edges (InBox +Lib.s:9673)', () => {
    // an alternating 1-pixel dash: with a continuous phase, the pixel
    // count around the whole box is ~half the perimeter; with a
    // restarting phase the corners would double up
    const { rt } = run('Cls 0 : Ink 5 : Set Line %1010101010101010 : Box 10,10 To 41,41')
    let lit = 0
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (rt.screen.point(x, y) === 5) lit++
    // perimeter ~124 pixels, half lit, small corner variance allowed
    expect(lit).toBeGreaterThan(54)
    expect(lit).toBeLessThan(70)
  })

  it('Scanshift is captured with Inkey$ and read-clears (FnScanshift +Lib.s:13611)', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const rt = new Runtime(tokenize('K$=Inkey$\nPrint Scanshift\nPrint Scanshift', table), table, { maxSteps: 100_000, fs, onText: (t) => (out += t) })
    rt.input.keys.add(0x60) // left shift held while the key goes in
    rt.pressKey('A', 0x20)
    rt.input.keys.delete(0x60) // released before the program reads
    rt.runHeadless(20)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '0'])
  })

  it('Hrev/Vrev Block mirror pixels and error on missing blocks (RevBloc +W.s:12591)', () => {
    // the mirror is across the STORED width, and `Get Block ...,8,8` stores
    // one word: `add.w #15,d4 / lsr.w #4,d4` in GetBob (+W.s:620). So the
    // lit column lands at 15 from the left, not 7.
    const prog = [
      'Cls 0 : Ink 5 : Plot 0,0', // a single lit pixel top-left
      'Get Block 1,0,0,8,8',
      'Hrev Block 1',
      'Put Block 1,100,100',
      'Print Point(115,100)',
      'Vrev Block 1',
      'Put Block 1,100,120',
      'Print Point(115,127)',
    ].join('\n')
    const { out } = run(prog)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['5', '5'])
    expect(() => run('Hrev Block 9')).toThrow(/block not defined/i)
    expect(() => run('Vrev Block 9')).toThrow(/block not defined/i)
  })

  it('Mouse Zone maps into the current screen and is 0 outside (SyZoHd +W.s:11121)', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const rt = new Runtime(
      tokenize('Reserve Zone 4\nSet Zone 2,10,10 To 50,50\nWait 2\nPrint Mouse Zone\nWait 2\nPrint Mouse Zone', table),
      table,
      { maxSteps: 100_000, fs, onText: (t) => (out += t) },
    )
    rt.input.mouseX = 128 + 20
    rt.input.mouseY = 50 + 20
    for (let i = 0; i < 4; i++) rt.frame()
    rt.input.mouseX = 1000
    rt.input.mouseY = 300
    rt.runHeadless(20)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['2', '0'])
  })
})

describe('integration: Varptr / =Array arena (FnVarPtr +ILib.s:4058)', () => {
  it('integer cells read and write through the arena', () => {
    const { out } = run(['A=123456', 'P=Varptr(A)', 'Print Leek(P)', 'Loke P,-42', 'Print A', 'Print Varptr(A)=P'].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['123456', '-42', '-1'])
  })

  it('string Varptr points at the chars with the length word at -2', () => {
    const prog = [
      'A$="HELLO"',
      'P=Varptr(A$)',
      'Print Deek(P-2)',
      'Print Chr$(Peek(P))+Chr$(Peek(P+4))',
      'Poke P,Asc("J")',
      'Print A$',
    ].join('\n')
    const { out } = run(prog)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['5', 'HO', 'JELLO'])
  })

  it('float cells expose the FFP representation', () => {
    // 1.5 = mantissa $C00000, exponent $41 -> $C0000041
    const { out } = run('A#=1.5\nPrint Hex$(Leek(Varptr(A#)))')
    expect(out.trim()).toBe('$C0000041')
  })

  it('array elements get distinct stable slots; =Array maps the block', () => {
    // =Array hands out the block ADDRESS, and an AMOS array block starts with
    // a header: a byte of dimension count, a byte of element-size shift, then
    // a size word and a stride word per dimension (GetTablo +ILib.s:4013). So
    // element 0 is at +6 and element 2 at +14 — this port used to map the
    // elements at +0 with no header, which put every read one element out.
    const prog = [
      'Dim A(3)',
      'A(2)=7',
      'Print Varptr(A(1))<>Varptr(A(2))',
      'B=Array(A(0))',
      'Print Peek(B);",";Peek(B+1);",";Deek(B+2)', // dims, shift, the DIM value
      'Print Leek(B+14)',
      'Loke B+14,55',
      'Print A(2)',
    ].join('\n')
    const { out } = run(prog)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['-1', '1, 2, 3', '7', '55'])
  })
})

describe('integration: Sprite Base / Icon Base (Sb/AdBob +Lib.s:12792)', () => {
  it('walks the synthesized bank: record header, planar data, palette', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 15,7', // a solid 16x8 image
      'Get Bob 1,0,0 To 16,8',
      'Hot Spot 1,3,4',
      'B=Sprite Base(1)',
      'Print Deek(B)', // width in words
      'Print Deek(B+2)', // height
      'Print Deek(B+6);Deek(B+8)', // hot spot
      'Print Peek(B+10)', // first planar byte of plane 0: solid row = $FF
      'Print Sprite Base(-1)', // mask pointer stays 0
    ].join('\n')
    const { out } = run(prog)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '8', '3 4', '255', '0'])
  })

  it('errors: 0 illegal, missing bank, out of range says Icon not defined (AdBErr shared)', () => {
    expect(() => run('X=Sprite Base(0)')).toThrow(/illegal function call/i)
    expect(() => run('X=Sprite Base(1)')).toThrow(/bank not reserved/i)
    const prog = ['Cls 0 : Ink 5 : Bar 0,0 To 7,7', 'Get Bob 1,0,0 To 8,8', 'X=Sprite Base(9)'].join('\n')
    expect(() => run(prog)).toThrow(/icon not defined/i)
  })
})

describe('integration: Run and the environment cluster', () => {
  it('the program swap keeps screens and resets variables (RunII +ILib.s:1497)', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const rt = new Runtime(tokenize('Ink 5 : Plot 100,100\nA=42\nPrint "PARENT"', table), table, {
      maxSteps: 100_000,
      fs,
      onText: (t) => (out += t),
    })
    rt.runHeadless(5)
    expect(out).toContain('PARENT')
    rt.runLines(tokenize('Print "CHILD"\nPrint Point(100,100)\nPrint A', table))
    const r = rt.runHeadless(10)
    expect(r.status).toBe('ended')
    expect(out).toContain('CHILD')
    const lines = out.trim().split('\n').map((s) => s.trim())
    expect(lines[2]).toBe('5') // the screen survived the chain
    expect(lines[3]).toBe('0') // variables reset
  })

  it.skipIf(!have('Examples/Examples/H-0/Help_1.AMOS'))('Run "file" loads and chains a real corpus program (InRun1 +ILib.s:1446)', () => {
    const child = new Uint8Array(readFileSync(corpus('Examples/Examples/H-0/Help_1.AMOS')))
    const fs = new AmigaFS()
    const vol = fs.mountMemory('DH0')
    vol.write(['child.amos'], child)
    let out = ''
    const rt = new Runtime(tokenize('Run "child.amos"\nPrint "NEVER"', table), table, {
      maxSteps: 200_000,
      fs,
      onText: (t) => (out += t),
    })
    rt.runHeadless(20)
    expect(out).not.toContain('NEVER')
    expect(rt.interp.program.lines.length).toBeGreaterThan(2) // the child is in charge
  })

  it('bare Run is a syntax error in a program; missing files error (Rn_NoF)', () => {
    expect(() => run('Run')).toThrow(/syntax error/i)
    expect(() => run('Run "nothere.amos"')).toThrow(/file not found/i)
  })

  it('a missing Load/Load Iff/Pload is error 81, even under the skip policy', () => {
    // Chopper II line 24 loads a 32-colour OPTIONS.IFF and line 25 does
    // `Pen 31`. Skipping the load left the 16-colour CREDITS screen in place
    // and the Pen was blamed, so the browser reported a text window fault two
    // statements away from the file that was actually missing.
    for (const src of ['Load "gone.abk"', 'Load Iff "gone.iff",0', 'Pload "gone.bin",5']) {
      const fs = new AmigaFS()
      fs.mountMemory('DH0')
      const rt = new Runtime(tokenize(src, table), table, { maxSteps: 10_000, fs, onUnimplemented: 'skip', onText: () => {} })
      let code = 0
      try {
        rt.runHeadless(10)
      } catch (e) {
        code = amosErrorCode(e as AmosError)
      }
      expect(code).toBe(81)
    }
  })

  it('the environment cluster: Amos Here, Set Buffer, Close Workbench are quiet', () => {
    const { out } = run(['Amos To Front', 'Amos To Back', 'Amos Lock', 'Amos Unlock', 'Close Workbench', 'Close Editor', 'Set Buffer 20', 'Print Amos Here'].join('\n'))
    expect(out.trim()).toBe('-1')
  })

  it('System ends the program like Edit/Direct (run-error 1002)', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const rt = new Runtime(tokenize('Print "A"\nSystem\nPrint "B"', table), table, { maxSteps: 100_000, fs, onText: (t) => (out += t) })
    const r = rt.runHeadless(10)
    expect(r.status).toBe('ended')
    expect(out).toContain('A')
    expect(out).not.toContain('B')
  })

  it('Exec runs the command DETACHED — both handles are the NIL: it opens', () => {
    // InExec +Lib.s:3392: `move.l d5,d2 / move.l d5,d3`, the same handle for
    // input and output, which is why nothing a command prints is ever seen
    let seen = ''
    let detached = false
    const rt = new Runtime(tokenize('Exec "c:list df0:"', table), table, {
      maxSteps: 100_000,
      host: {
        process: {
          execute(req) {
            seen = req.command
            detached = req.io.input === null && req.io.output === null
            return true
          },
        },
      },
    })
    expect(rt.runHeadless(10).status).toBe('ended')
    expect(seen).toBe('c:list df0:')
    expect(detached).toBe(true)
  })

  it('an empty command is error 23, before anything is opened', () => {
    // `move.w (a2)+,d2 / Rbeq L_FonCall`
    const rt = new Runtime(tokenize('Exec ""', table), table, { maxSteps: 100_000 })
    expect(() => rt.runHeadless(10)).toThrow(/Illegal function call/)
  })

  it('a DOSFALSE from Execute is error 87, "Disc error"', () => {
    // `tst.l d3 / Rbeq L_DiskError`. With no host process capability nothing
    // can run, so every command takes the branch the routine takes for a
    // command that does not exist
    const rt = new Runtime(tokenize('Exec "c:list"', table), table, { maxSteps: 100_000 })
    expect(() => rt.runHeadless(10)).toThrow(/Disc error/)
  })

  it('the command line is truncated at 510 characters, as ChVerBuf does', () => {
    // +Lib.s:3683 `cmp.w #510,d0 / bcs.s Chv1 / move.w #509,d0` -- at most
    // 510 bytes are copied before the NUL
    let seen = ''
    const rt = new Runtime(tokenize('Exec String$("x",600)', table), table, {
      maxSteps: 100_000,
      host: { process: { execute: (r) => ((seen = r.command), true) } },
    })
    rt.runHeadless(10)
    expect(seen.length).toBe(510)
  })

  it('Dev/Prg First$/Next$ enumerate the device list (FnPrgFirst=FnDevFirst +Lib.s:5510)', () => {
    const prog = ['Print Dev First$("*")', 'Print Dev Next$', 'Print Prg First$("*")'].join('\n')
    const { out } = run(prog)
    // FnFillNext format (+Lib.s:5554): a marker space, the name padded to
    // the Set Dir width (30), then an 8-char size field — spaces for
    // devices (FillDev pokes size -1)
    const lines = out.split('\n')
    expect(lines[0]).toBe(' DH0:'.padEnd(30) + ' '.repeat(8))
    expect(lines[2]).toBe(' DH0:'.padEnd(30) + ' '.repeat(8))
  })

  it('Dir First$ entries carry marker + padded name + size; dirs sort first (FillFPoke/FillSort)', () => {
    const prog = [
      'Mkdir "DH0:sub"',
      'Open Out 1,"DH0:zz.dat" : Print #1,"12345" : Close 1',
      'Open Out 1,"DH0:aa.dat" : Print #1,"x" : Close 1',
      // "" is how AMOS asks for everything: the filter is skipped outright
      // (FillNxt +Lib.s:6186 `tst.b (a0) / beq`). "*" would NOT do it --
      // Joker's star stops at a dot, so it matches neither .dat file
      'A$=Dir First$("")',
      'While A$<>"" : Print "[";A$;"]" : A$=Dir Next$ : Wend',
      'Set Dir 10',
      'Print "[";Dir First$("*.dat");"]"',
    ].join('\n')
    const { out } = run(prog)
    const lines = out.split('\n').filter((l) => l.startsWith('['))
    // '*' maps to byte 1 in FillSort, so the directory leads the list
    expect(lines[0]).toBe('[' + '*sub'.padEnd(30) + ' '.repeat(8) + ']')
    // file sizes are left-aligned decimals in the 8-char field
    expect(lines[1]!.length).toBe(2 + 30 + 8)
    const m = /^\[ aa\.dat\s+(\d+)\s*\]$/.exec(lines[1]!)
    expect(m).not.toBeNull()
    // Set Dir 10 narrows the name column (InSetDir1 +Lib.s:5496); dirs
    // list even against "*.dat" — filters only apply to files (FillNxt)
    expect(lines[3]).toBe('[' + '*sub'.padEnd(10) + ' '.repeat(8) + ']')
  })

  it('Disc Info$ returns "VOLUME:" + 10-char free-byte field (FnDiscInfo +Lib.s:4995)', () => {
    const { out } = run('A$=Disc Info$("DH0:")\nPrint Left$(A$,Len(A$)-10)\nPrint Val(Right$(A$,10))')
    const lines = out.split('\n')
    expect(lines[0]).toBe('DH0:')
    expect(Number(lines[1])).toBeGreaterThan(0)
  })
})

describe('integration: random-access records (InField/InGet/InPut +ILib.s:4740+Lib.s:5291)', () => {
  it('Field defines records; Put pads/truncates; Get reads them back', () => {
    const prog = [
      'Open Random 1,"DH0:db.dat"',
      'Field 1,8 As N$,4 As A$',
      'N$="ALICE" : A$="30" : Put 1,1',
      'N$="BOBBYLONGNAME" : A$="7" : Put 1,2',
      'N$="" : A$=""',
      'Get 1,1',
      'Print "[";N$;"][";A$;"]"',
      'Get 1,2',
      'Print "[";N$;"][";A$;"]"',
      'Close 1',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toContain('[ALICE   ][30  ]')
    expect(out).toContain('[BOBBYLON][7   ]') // truncated to the field
  })

  it('records survive Close and reopen through the VFS', () => {
    const prog = [
      'Open Random 1,"DH0:db.dat"',
      'Field 1,8 As N$',
      'N$="FIRST" : Put 1,1',
      'Close 1',
      'Open Random 1,"DH0:db.dat"',
      'Field 1,8 As N$',
      'Get 1,1',
      'Print N$',
      'Close 1',
    ].join('\n')
    expect(run(prog).out).toContain('FIRST')
  })

  it('EOF rules: Get past the end errors, Put may append exactly one record', () => {
    const base = ['Open Random 1,"DH0:db.dat"', 'Field 1,8 As N$']
    expect(() => run([...base, 'Get 1,1'].join('\n'))).toThrow(/end of file/i)
    expect(() => run([...base, 'N$="X" : Put 1,2'].join('\n'))).toThrow(/end of file/i)
    expect(() => run([...base, 'N$="X" : Put 1,1', 'Put 1,2', 'Get 1,2', 'Print "ok"'].join('\n'))).not.toThrow()
  })

  it('validation: record range, channel type, zero-length fields', () => {
    expect(() => run(['Open Random 1,"DH0:x"', 'Field 1,8 As N$', 'Get 1,0'].join('\n'))).toThrow(/illegal function call/i)
    expect(() => run(['Open Out 1,"DH0:x"', 'Field 1,8 As N$', 'N$="A" : Put 1,1'].join('\n'))).toThrow(/file type mismatch/i)
    expect(() => run(['Open Random 1,"DH0:x"', 'Field 1,0 As N$'].join('\n'))).toThrow(/illegal function call/i)
  })
})

describe.skipIf(!have('Tutorial/Iff_Anim/AMOS.Anim'))('integration: IFF ANIM frames (IffForm* +Lib.s:6861-7500)', () => {
  // lazy: a skipped describe still runs its body
  const animBytes = have('Tutorial/Iff_Anim/AMOS.Anim')
    ? new Uint8Array(readFileSync(corpus('Tutorial/Iff_Anim/AMOS.Anim')))
    : new Uint8Array()

  function animRt(src: string): { rt: Runtime; out: string } {
    const fs = new AmigaFS()
    const vol = fs.mountMemory('DH0')
    vol.write(['AMOS.Anim'], animBytes)
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 500_000, fs, onText: (t) => (out += t) })
    rt.runHeadless(400)
    return { rt, out }
  }

  it('Frame Length measures and Frame Load banks frames from a channel', () => {
    const { out } = animRt(
      ['Open In 1,"AMOS.Anim"', 'L=Frame Length(1)', 'Print L>0', 'N=Frame Load(1 To 10,3)', 'Print N', 'Print Length(10)>0', 'Close 1'].join('\n'),
    )
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['-1', '3', '-1'])
  })

  it('Frame Play draws the first frame into a created screen; Frame Skip advances', () => {
    const prog = [
      'Open In 1,"AMOS.Anim"',
      'N=Frame Load(1 To 10,2)',
      'Close 1',
      'A=Frame Play(10,1,0)', // create screen 0 from the BMHD
      'Print Screen Width;Screen Height',
      'B=Frame Skip(10)',
      'Print A=B', // skip walks the same single frame
      'Print A>Start(10)',
    ].join('\n')
    const { rt, out } = animRt(prog)
    const lines = out.trim().split('\n').map((s) => s.trim())
    expect(lines[0]).toBe('320 256')
    expect(lines[1]).toBe('-1')
    expect(lines[2]).toBe('-1')
    // the frame drew something: some pixel is nonzero
    let lit = 0
    const px = rt.screens.get(0)!.pixels
    for (let i = 0; i < px.length; i += 31) if (px[i] !== 0) lit++
    expect(lit).toBeGreaterThan(10)
  })

  it('Iff Anim plays the file with double-buffered swaps (InIffAnim +Lib.s:4538)', () => {
    const { rt } = animRt('Iff Anim "AMOS.Anim" To 0\nPrint "done"')
    expect(rt.screens.get(0)!.doubleBuffered).toBe(true)
    expect(rt.iffAnim).toBeNull() // playback completed
  })

  it('Frame Param carries the ANHD wait time after a DLTA', () => {
    const prog = ['Open In 1,"AMOS.Anim"', 'N=Frame Load(1 To 10,2)', 'Close 1', 'A=Frame Play(10,2,0)', 'Print Frame Param>=0'].join('\n')
    expect(animRt(prog).out.trim().split('\n').pop()!.trim()).toBe('-1')
  })
})

describe('objects: collision and bank editing (vs +W.s ColRout / Bnk.*)', () => {
  it('Bob Col is rectangle-gated pixel-perfect and fills the Col set', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7', // an 8x8 solid image
      'Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1 : Bob 2,54,54,1 : Bob 3,100,100,1', // 1 & 2 overlap, 3 far
      'Wait Vbl',
      'C=Bob Col(1)',
      'Print C;Col(2);Col(3)',
    ].join('\n')
    expect(run(prog).out).toBe('-1-1 0\n') // hits 2, not 3
  })

  it('non-overlapping solid pixels do not collide (exclusive edges + mask AND)', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7',
      'Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1 : Bob 2,58,50,1', // touching at x=58 (50+8), exclusive → no hit
      'Wait Vbl',
      'Print Bob Col(1)',
    ].join('\n')
    expect(run(prog).out).toBe(' 0\n')
  })

  it('Col(negative) returns the first colliding object number', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7',
      'Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1 : Bob 5,52,52,1',
      'Wait Vbl',
      'C=Bob Col(1) : Print Col(-1)',
    ].join('\n')
    expect(run(prog).out).toBe(' 5\n')
  })

  it('Del Bob compacts the bank (splice); Ins Bob shifts images up', () => {
    const prog = [
      'Cls 0',
      'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
      'Ink 6 : Bar 0,0 To 7,7 : Get Bob 2,0,0 To 8,8',
      'Ink 7 : Bar 0,0 To 7,7 : Get Bob 3,0,0 To 8,8',
      'Del Bob 2', // 3 renumbers down to 2
      'Print Length(1)', // image count via the bank
      'Ins Bob 1', // blank slot at 1, others shift up
      'Print Length(1)',
    ].join('\n')
    // sprite bank Length = image count: 3 images -> del -> 2 -> ins -> 3
    expect(run(prog).out).toBe(' 2\n 3\n')
  })

  it('Put Key appends to the keyboard buffer (InPutKey)', () => {
    const prog = ['Put Key "AB"', 'Print Inkey$;Inkey$'].join('\n')
    expect(run(prog).out).toBe('AB\n')
  })

  it('collision ignores the flip flags (ColRout strips them, +W.s:179)', () => {
    // an asymmetric image with the hot spot to one side; two bobs overlap.
    // whether bob 2 is flipped or not, the collision result is identical
    // because collision uses the raw un-flipped box.
    const base = [
      'Cls 0 : Ink 5 : Bar 0,0 To 3,7', // left half of a 16-wide image
      'Get Bob 1,0,0 To 16,8',
      'Hot Spot 1,12,4', // hot spot off-centre
    ]
    const unflipped = run([...base, 'Bob 1,60,60,1 : Bob 2,64,60,1', 'Wait Vbl', 'Print Bob Col(1)'].join('\n')).out
    const flipped = run([...base, 'Bob 1,60,60,1 : Bob 2,64,60,Hrev(1)', 'Wait Vbl', 'Print Bob Col(1)'].join('\n')).out
    expect(flipped).toBe(unflipped) // flip must not shift the collision box
  })

  it('Hot Spot code form uses the full width/height, not width-1 (SpotH +W.s:571)', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 15,9',
      'Get Bob 1,0,0 To 16,10', // 16x10
      'Hot Spot 1,$22', // bottom-right = full width/height
      'Bob 1,100,100,1', // drawn top-left at 100-16, 100-10 = 84,90
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(84, 90)).toBe(5) // top-left corner of the image
    expect(rt.screen.point(99, 99)).toBe(5) // bottom-right at the hot spot
  })

  it('Bobsprite Col maps the bob into hardware space and hits the sprite', () => {
    // lowres bob at screen 50,50 maps to hw x=50+128=178, y=50+50=100
    // (CXyS: X halved only in hires, so lowres X is unchanged)
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1',
      'Sprite 8,178,100,1',
      'Wait Vbl',
      'Print Bobsprite Col(1)',
    ].join('\n')
    expect(run(prog).out).toBe('-1\n')
  })

  it('X/Y/I Sprite read back the raw stored hardware coords (HsXY)', () => {
    expect(run('Sprite 5,200,120,3 : Print X Sprite(5);Y Sprite(5);I Sprite(5)').out).toBe(' 200 120 3\n')
    // omitted args keep the previous value
    expect(run('Sprite 5,200,120,3 : Sprite 5,,140, : Print X Sprite(5);Y Sprite(5)').out).toBe(' 200 140\n')
  })

  it('Sprite number is limited to 0..63; Sprite Priority to 0..4', () => {
    expect(() => run('Sprite 64,100,100,1')).toThrow(/sprite number/)
    expect(() => run('Sprite Priority 5')).toThrow()
  })

  it('Sprite Priority 0 puts sprites behind the playfield; 4 (default) in front (HsPri PF2P)', () => {
    // BPLCON2 PF2P semantics: sprite PAIRS below the value are in front of
    // the playfield. EcCon2 initialises to %100100 = 4, all pairs in front.
    const mk = (priority: string): Uint8ClampedArray => {
      const prog = [
        'Cls 5', // opaque colour-5 playfield everywhere
        'Ink 7 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16',
        'Sprite 2,160,100,1', // hardware channel 2 = pair 1
        priority,
        'Wait Vbl',
      ].join('\n')
      return run(prog).rt.composite().data
    }
    const px = (160 - 128) * 2
    const py = (100 - 26) * 2 // composite rows start at hardware line 26
    const o = (py * 640 + px) * 4
    const behind = mk('Sprite Priority 0')
    // priority 0: the playfield (colour 5 = $A0A default? read from data) wins
    const front = mk('Sprite Priority 4')
    const mid = mk('Sprite Priority 1') // pair 1 >= 1: still behind
    expect([front[o], front[o + 1], front[o + 2]]).not.toEqual([behind[o], behind[o + 1], behind[o + 2]])
    expect([mid[o], mid[o + 1], mid[o + 2]]).toEqual([behind[o], behind[o + 1], behind[o + 2]])
    const two = mk('Sprite Priority 2') // pair 1 < 2: in front
    expect([two[o], two[o + 1], two[o + 2]]).toEqual([front[o], front[o + 1], front[o + 2]])
  })

  it('manual Sprite Update applies buffered moves while frozen', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
      'Sprite 8,200,100,1',
      'Wait Vbl',
      'Sprite Update Off',
      'Sprite 8,240,100,1', // buffered, not yet shown
      'Print X Sprite(8)', // the table still reflects the write
      'Sprite Update', // apply now
    ].join('\n')
    const { rt, out } = run(prog)
    expect(out).toBe(' 240\n')
    expect(rt.frozenSprites!.find((s) => s.n === 8)!.x).toBe(240) // snapshot updated
  })
})

describe('stragglers (palette shift, wind size, key shift)', () => {
  const shiftAfterOneStep = (setup: string): number[] => {
    const rt = new Runtime(tokenize(setup + '\nDo : Wait Vbl : Loop', table), table, { maxSteps: 300_000 })
    rt.frame() // frame 1: interp sets up the shift (applyShifts already ran)
    rt.frame() // frame 2: exactly one shift applied
    const p = rt.screens.get(0)!.palette
    return [p[1]!, p[2]!, p[3]!]
  }

  // Flash Off first: colour 3 carries the system flash out of the box
  // (Screen Open runs Flash 3, +Lib.s:8989), which would fight the shifted
  // value here exactly as it does on a real Amiga
  it('Shift Up cycles a palette range with the exact rotation (Shifter +W.s:5435)', () => {
    // start [1,2,3]=$100,$200,$300; one up-shift → pal[1]<-pal[3] wrap.
    // The flag is not optional: $0d62's spec is "I0,0,0,0" with no $FE
    // variant behind it, and every corpus use writes all four
    // (`Shift Up 5,23,31,1` in BOTSS/Autoexec.AMOS:20)
    expect(shiftAfterOneStep('Flash Off : Colour 1,$100 : Colour 2,$200 : Colour 3,$300\nShift Up 1,1,3,1')).toEqual([0x300, 0x100, 0x200])
  })

  it('Shift with flag 0 smears instead of wrapping (Shf8a)', () => {
    // no wrap: pal[1] stays, pal[2]<-pal[1], pal[3]<-pal[2]
    expect(shiftAfterOneStep('Flash Off : Colour 1,$100 : Colour 2,$200 : Colour 3,$300\nShift Up 1,1,3,0')).toEqual([0x100, 0x100, 0x200])
  })

  it('Wind Size clears the window interior (Clw)', () => {
    const prog = [
      'Cls 0',
      'Wind Open 1,0,0,20,10',
      'Ink 5 : Bar 0,0 To 100,60', // draw ink 5 into the window area
      'Wind Size 8,4', // resize → the interior is blanked to the window paper
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(20, 20)).not.toBe(5) // the ink-5 fill was cleared
  })

  it('Key Shift includes the Amiga-key bits (6/7)', () => {
    let out = ''
    const ks = new Runtime(tokenize('Print Key Shift', table), table, { maxSteps: 1000, onText: (t) => (out += t) })
    ks.input.keys.add(0x66) // Left Amiga → bit 6 = 64
    ks.runHeadless(50)
    expect(out).toBe(' 64\n')
  })
})

describe('text/console (vs +W.s / +ILib.s)', () => {
  it('Cls with no arg clears the current window; Cls c does not home the cursor', () => {
    // colour-form Cls must leave the cursor where it was
    const prog = ['Locate 5,3', 'Cls 2', 'Print "X";', 'X=X Curs : Y=Y Curs'].join('\n')
    const { rt } = run(prog)
    // the "X" printed at the un-homed cursor (col 5,6 after the print)
    expect(rt.screen.curX).toBe(6)
    expect(rt.screen.curY).toBe(3)
  })

  it('Print Using: overflow drops high digits, bare # loses the sign', () => {
    expect(run('Print Using "###";-12').out).toBe(' 12\n') // sign consumed as space
    expect(run('Print Using "##";123').out).toBe('23\n') // overflow digit dropped
    expect(run('Print Using "+##";5').out).toBe('+ 5\n') // sign slot
    expect(run('Print Using "##.##";3.5').out).toBe(' 3.50\n')
  })

  it('Zone$ wraps text in the ESC-Z text-zone codes (FnZoneD)', () => {
    expect(run('A$=Zone$("HI",1) : Print Len(A$)').out).toBe(' 8\n') // ESC Z 1 + HI + ESC Z 1
    expect(() => run('A$=Zone$("x",0)')).toThrow()
  })

  it('Display Height is the machine, not the screen (TMaxRaw +W.s:2578)', () => {
    /*
     * Two instructions: `move.w T_EcYMax(a5),d1 / sub.w #EcYBase,d1`, and
     * T_EcYMax is written once at startup as `#311+EcYBase` for PAL or
     * `#261+EcYBase` for NTSC (+W.s:2447, :2451). It never reads a screen.
     *
     * This used to answer the screen's own height capped at 283, which is
     * where Knights broke: it asks `If Display Height<270 or Ntsc` to spot a
     * short display, got 256 off an ordinary screen, took the NTSC branch on
     * a PAL machine and put its screen at raster 24 with a 240-line window.
     * The game ran perfectly and drew to a display it was almost entirely
     * outside of.
     */
    expect(run('Print Display Height').out).toBe(' 311\n')
    expect(run('Screen Open 1,320,400,4,$4\nPrint Display Height').out).toBe(' 311\n')
    expect(run('Screen Open 1,320,200,4,0\nPrint Display Height').out).toBe(' 311\n')
    // and the machine is PAL, which is what picks 311 over NTSC's 261
    expect(run('Print Ntsc').out).toBe(' 0\n')
  })
})

describe('procedures: Param typed slots (FnEProc +ILib.s:2672)', () => {
  it('End Proc[x] writes only the slot matching x type; others stay stale', () => {
    const prog = [
      '_A[0] : _B[0]',
      'Print Param;Param#;Param$',
      'Procedure _A[N]',
      '  Pop Proc[7]', // sets the int slot
      'End Proc',
      'Procedure _B[N]',
      '  Pop Proc[2.5]', // sets the float slot only
      'End Proc',
    ].join('\n')
    // int slot = 7 (from _A, never overwritten by _B's float), float = 2.5, str = ""
    // (Print gives each positive number a leading space)
    expect(run(prog).out).toBe(' 7 2.5\n')
  })
})

describe('screens (vs the 68k Ec* routines)', () => {
  it('Screen Open masks the width down to a multiple of 16 (EcCree +W.s:2881)', () => {
    expect(run('Screen Open 1,330,200,16,0 : Print Screen Width(1)').out).toBe(' 320\n')
    expect(run('Screen Open 1,336,200,16,0 : Print Screen Width(1);Screen Height(1)').out).toBe(' 336 200\n')
  })

  it('Screen Width/Height error on an explicit unopened screen (FnScreenWidth1)', () => {
    expect(() => run('Print Screen Width(5)')).toThrow(/not opened/)
    expect(run('Print Screen Width;Screen Height').out).toBe(' 320 200\n') // no-arg = current
  })

  it('Screen To Front reorders without changing the current screen (EcFirst)', () => {
    const prog = ['Screen Open 1,320,200,4,0', 'Screen 0', 'Screen To Front 1', 'Print Screen'].join('\n')
    const { rt, out } = run(prog)
    expect(out).toBe(' 0\n') // current is still 0
    expect(rt.order[rt.order.length - 1]).toBe(1) // but 1 composites on top
  })

  it('Screen Display sets the visible-window size and does not un-hide (EcView)', () => {
    const prog = [
      'Screen Open 0,320,200,4,0 : Cls 1', // fill with colour 1
      'Screen Display 0,,,160,100', // window shrunk to 160x100
    ].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    expect([s.displayW, s.displayH]).toEqual([160, 100])
    const { data } = rt.composite()
    // inside the window (device 100,100) is drawn; beyond it (device 400,300) is not
    const inside = data[(100 * 640 + 100) * 4] || data[(100 * 640 + 100) * 4 + 2]
    const outside = data[(300 * 640 + 400) * 4] || data[(300 * 640 + 400) * 4 + 2]
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBe(0)
    // Screen Display does not re-show a hidden screen
    const hidden = run('Screen Open 0,320,200,4,0 : Screen Hide 0 : Screen Display 0,200,60,,').rt
    expect(hidden.screens.get(0)!.visible).toBe(false)
  })

  it('Dual Priority raises PF2 without reassigning the pair (DualP +W.s:2841)', () => {
    const prog = [
      'Screen Open 0,320,200,8,0 : Screen Open 1,320,200,8,0',
      'Dual Playfield 0,1',
      'Dual Priority 1,0', // back screen named first: PFBA set, PF2 in front
    ].join('\n')
    const { rt } = run(prog)
    // pairing lives on the screens (EcDual), so several pairs can coexist
    expect(rt.screens.get(0)!.dualPartner).toBe(1)
    expect(rt.screens.get(1)!.dualPartner).toBe(0)
    expect(rt.screens.get(1)!.dualIsBack).toBe(true)
    expect(rt.screens.get(0)!.pf2Front).toBe(true)
    // Dual Priority on a non-dual pair errors (EcE27)
    expect(() => run('Screen Open 0,320,200,8,0 : Screen Open 2,320,200,8,0 : Dual Priority 0,2')).toThrow(/dual playfield/)
  })

  it('Dual Playfield validates like SetDual (+W.s:2810)', () => {
    // resolution mismatch, too many planes, and bad plane combos all error
    expect(() => run('Screen Open 0,320,200,8,0 : Screen Open 1,640,200,8,$8000 : Dual Playfield 0,1')).toThrow(/impossible/)
    expect(() => run('Screen Open 0,320,200,16,0 : Screen Open 1,320,200,16,0 : Dual Playfield 0,1')).toThrow(/impossible/)
    expect(() => run('Screen Open 0,320,200,4,0 : Screen Open 1,320,200,8,0 : Dual Playfield 0,1')).toThrow(/impossible/)
    // (n, n-1) is legal, and the back screen hides (BitHide)
    const { rt } = run('Screen Open 0,320,200,8,0 : Screen Open 1,320,200,4,0 : Dual Playfield 0,1')
    expect(rt.screens.get(1)!.visible).toBe(false)
  })
})

describe('input subsystem (vs the 68k read routines)', () => {
  const table2 = new TokenTable(CORE_TOKENS)
  const boot = (src: string): { rt: Runtime; out: () => string } => {
    let out = ''
    const rt = new Runtime(tokenize(src, table2), table2, { maxSteps: 300_000, onText: (t) => (out += t) })
    return { rt, out: () => out }
  }

  it('Mouse Click is an edge-detected bitmask, not a count (MRout +W.s:10598)', () => {
    const { rt, out } = boot(['Do', ' C=Mouse Click', ' If C>0 Then Print C;Mouse Click : End', ' Wait Vbl', 'Loop'].join('\n'))
    for (let i = 0; i < 2; i++) rt.frame() // no buttons: reads 0
    rt.input.mouseK = 1 | 2 // both pressed together
    for (let i = 0; i < 4 && rt.frame().status !== 'ended'; i++);
    // first read = 3 (both newly pressed), the second (same statement) = 0
    expect(out()).toBe(' 3 0\n')
  })

  it('Scancode clears after a read (FnScancode +Lib.s:13602)', () => {
    const { rt, out } = boot(['A$=Inkey$', 'Do', ' A$=Inkey$', ' If A$<>"" Then Print Scancode;Scancode : End', ' Wait Vbl', 'Loop'].join('\n'))
    for (let i = 0; i < 2; i++) rt.frame()
    rt.pressKey('a', 0x20)
    for (let i = 0; i < 4 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 32 0\n') // first read = $20, second = 0 (cleared)
  })

  it('Key$(n) is the function-key definition, set by Key$(n)= (FnKeyD)', () => {
    const { rt, out } = boot('Key$(3)="HELLO"\nPrint Key$(3)\nPrint Key$(1)=""')
    rt.runHeadless(100)
    expect(out()).toBe('HELLO\n-1\n') // slot 3 = HELLO, slot 1 = empty ("" = "" is true)
  })

  it('Key State masks to $7F and errors past 128 (FnKeyState +Lib.s:13620)', () => {
    const { rt, out } = boot(['Do', ' If Key State($40) Then Print "hit" : End', ' Wait Vbl', 'Loop'].join('\n'))
    for (let i = 0; i < 2; i++) rt.frame()
    rt.input.keys.add(0x40)
    for (let i = 0; i < 3 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('hit\n')
    const bad = new Runtime(tokenize('Print Key State(200)', table2), table2, { maxSteps: 1000 })
    expect(() => bad.runHeadless(50)).toThrow()
  })
})

describe('drawing primitives (graphics cursor + shapes)', () => {
  const countPixels = (s: { height: number; width: number; point(x: number, y: number): number }, c: number): number => {
    let n = 0
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (s.point(x, y) === c) n++
    return n
  }

  it('every primitive leaves the graphics cursor where the 68k does', () => {
    const cur = (src: string): [number, number] => {
      const s = run(src).rt.screen
      return [s.grX, s.grY]
    }
    expect(cur('Plot 10,20')).toEqual([10, 20]) // Plot -> x,y
    expect(cur('Draw 0,0 To 30,15')).toEqual([30, 15]) // Draw -> end
    expect(cur('Gr Locate 0,0 : Draw To 25,5')).toEqual([25, 5])
    expect(cur('Bar 5,5 To 40,40')).toEqual([5, 5]) // Bar -> top-left
    expect(cur('Circle 100,60,20')).toEqual([100, 60]) // Circle -> centre
    expect(cur('Ellipse 80,40,30,10')).toEqual([80, 40])
    expect(cur('A=Point(50,25)')).toEqual([50, 25]) // Point() moves the cursor
    expect(cur('Text 16,50,"AB"')).toEqual([32, 50]) // advanced by the width
  })

  it('Text fills its character cell, because JAM2 is the default draw mode', () => {
    // Screen creation is `move.b #1,EcMode(a4)` then SetDrMd with it
    // (+W.s:3080-3091), and one is JAM2. `Gr Writing` (+Lib.s:10090) passes
    // its argument straight to SetDrMd. Mexican Massacre bounces its title
    // down 70 rows with no erase of its own; the cell fill is the erase.
    const under = ['Ink 7 : Bar 0,0 To 100,40', 'Ink 4,0']
    const { rt } = run([...under, 'Text 8,20,"H"'].join('\n'))
    const s = rt.screens.get(0)!
    // the blank half of the glyph cell is the PAPER now, not what was under it
    let paper = 0
    for (let y = 14; y < 22; y++) for (let x = 8; x < 16; x++) if (s.point(x, y) === 0) paper++
    expect(paper).toBeGreaterThan(20)
    expect(s.point(8, 30)).toBe(7) // and only the cell, not the whole line
    // Gr Writing 0 is JAM1, and leaves what was underneath alone
    const jam1 = run([...under, 'Gr Writing 0', 'Text 8,20,"H"'].join('\n')).rt.screens.get(0)!
    let kept = 0
    for (let y = 14; y < 22; y++) for (let x = 8; x < 16; x++) if (jam1.point(x, y) === 7) kept++
    expect(kept).toBeGreaterThan(20)
  })

  it('Polygon fills its interior (InitArea/AreaEnd), Polyline strokes', () => {
    const filled = run('Ink 5 : Polygon 10,10 To 50,10 To 30,40').rt.screens.get(0)!
    const stroked = run('Ink 5 : Polyline 10,10 To 50,10 To 30,40').rt.screens.get(0)!
    expect(countPixels(filled, 5)).toBeGreaterThan(400) // interior filled
    expect(countPixels(stroked, 5)).toBeLessThan(120) // just the two edges
    expect(stroked.point(30, 10)).toBe(5) // the top edge is drawn
  })

  it('Circle doubles the x-radius on a hires screen (round on 2:1 pixels)', () => {
    const prog = ['Screen Open 1,640,200,16,$8000', 'Cls 0 : Ink 5', 'Circle 100,50,20'].join('\n')
    const s = run(prog).rt.screens.get(1)!
    // x-radius doubled to 40 → the horizontal extent is ~80, not ~40
    let leftmost = 999
    let rightmost = 0
    for (let y = 48; y <= 52; y++) for (let x = 0; x < 640; x++) if (s.point(x, y) === 5) { leftmost = Math.min(leftmost, x); rightmost = Math.max(rightmost, x) }
    expect(rightmost - leftmost).toBeGreaterThan(60)
  })

  it('Circle/Ellipse error on a radius of zero, and only zero', () => {
    // InCircle (+Lib.s:9603) is `move.l d3,d2 / Rbls L_FonCall` and InEllipse
    // (+Lib.s:9617) is `tst.l d3 / Rbls` then `move.l (a3)+,d2 / Rbls`. A move
    // and a tst both CLEAR the carry, so every one of those `bls` branches can
    // only fire on Z. Zero is the error; a negative radius runs.
    expect(() => run('Circle 10,10,0')).toThrow()
    expect(() => run('Ellipse 10,10,5,0')).toThrow()
    expect(() => run('Ellipse 10,10,0,5')).toThrow()
    expect(() => run('Circle 10,10,-5')).not.toThrow()
    expect(() => run('Ellipse 10,10,-5,-5')).not.toThrow()
  })

  it('a blank coordinate leaves that axis alone (GrXY +Lib.s:11225)', () => {
    // `cmp.l #EntNul,d1 / beq.s GrXy1` — AMOS compiles an empty numeric slot
    // to EntNul and GrXY skips the write, so one axis moves and the other
    // stays. Every keyword that reaches GrXY behaves this way.
    const cur = (src: string): [number, number] => {
      const s = run(src).rt.screen
      return [s.grX, s.grY]
    }
    expect(cur('Gr Locate 30,40 : Gr Locate ,100')).toEqual([30, 100])
    expect(cur('Gr Locate 30,40 : Gr Locate 70,')).toEqual([70, 40])
    expect(cur('Gr Locate 30,40 : Gr Locate ,')).toEqual([30, 40])
    expect(cur('Gr Locate 30,40 : Plot ,90')).toEqual([30, 90])
    expect(cur('Gr Locate 30,40 : Circle ,90,10')).toEqual([30, 90])
  })

  it('Plot sets the pen for good, refuses a negative one, and keeps a blank one', () => {
    /*
     * InPlot3 (+Lib.s:9535): `move.l d3,d0 / Rbmi L_FonCall`, then
     * `cmp.l #EntNul,d0 / beq.s .Skip / GfxCa5 SetAPen`. The pen is the
     * RastPort's, so it outlives the statement.
     */
    expect(() => run('Plot 10,10,-1')).toThrow()
    // the colour given to one Plot is still in force for the next
    const s = run('Ink 2 : Plot 10,10,5 : Plot 20,20').rt.screens.get(0)!
    expect(s.point(20, 20)).toBe(5)
    // a blank colour slot leaves the ink where it was
    const kept = run('Ink 3 : Plot 10,10,').rt.screens.get(0)!
    expect(kept.point(10, 10)).toBe(3)
  })
})

describe('sliders', () => {
  it('draws track and knob rects with the Set Slider colours (SliHor +W.s:5022)', () => {
    const prog = [
      'Cls 0',
      'Set Slider 4,4,4,0,5,5,5,0', // solid frame ink 4, solid knob ink 5
      'Hslider 10,10 To 110,20,100,25,25',
    ].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    // span 100: knob at off=25 len=25 → knob covers x 35..60, tracks around it
    expect(s.point(20, 15)).toBe(4) // before-track
    expect(s.point(45, 15)).toBe(5) // knob
    expect(s.point(80, 15)).toBe(4) // after-track
  })

  it('snaps the knob to the far end when pos+size >= total (SliPour full flag)', () => {
    const prog = ['Cls 0', 'Set Slider 4,4,4,0,5,5,5,0', 'Vslider 10,10 To 20,110,100,75,25'].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    expect(s.point(15, 109)).toBe(5) // knob reaches the bottom end
    expect(s.point(15, 30)).toBe(4) // top is track
  })

  it('errors on negative arguments and pos > total (GetSli)', () => {
    expect(() => run('Hslider 10,10 To 5,20,100,0,10')).toThrow() // x2 <= x1
    expect(() => run('Hslider 0,0 To 100,10,50,60,10')).toThrow() // pos > total
    expect(() => run('Vslider 0,0 To 10,100,-1,0,10')).toThrow()
  })

  it('enforces the 4px minimum knob (SliPour SlPo1)', () => {
    const prog = ['Cls 0', 'Set Slider 0,0,0,0,5,5,5,0', 'Hslider 0,0 To 200,10,1000,0,1'].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    let knob = 0
    for (let x = 0; x <= 200; x++) if (s.point(x, 5) === 5) knob++
    expect(knob).toBeGreaterThanOrEqual(4)
  })
})

describe('blocks, clones, flips', () => {
  it('grabs and puts blocks, remembering the origin', () => {
    const prog = [
      'Ink 5 : Bar 10,10 To 19,19',
      'Get Block 1,10,10,10,10',
      'Cls 0',
      'Put Block 1', // back at origin
      'Put Block 1,100,50',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(15, 15)).toBe(5)
    expect(rt.screen.point(105, 55)).toBe(5)
  })

  it('flips bob images with the faithful width-hotX hot spot (BobCalc +W.s:1408)', () => {
    const prog = [
      'Cls 0 : Ink 5 : Plot 0,0 : Rem a single marked corner',
      'Get Bob 1,0,0 To 8,8', // 8x8, hot spot 0,0
      'Cls 0',
      'Bob 1,50,50,1',
      'Bob 2,100,50,Hrev(1)',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(50, 50)).toBe(5) // normal: marked pixel at the hot spot
    // flipped: effective hotX = width-0 = 8, drawn top-left at 92; the marked
    // pixel (image column 0) mirrors to column 7 → screen 99 (not 100)
    expect(rt.screen.point(99, 50)).toBe(5)
    expect(rt.screen.point(100, 50)).toBe(0)
  })

  it('a bob given no image has image 0, which draws nothing (CreBb7 / ResBOB)', () => {
    // `Bob n,x,y,` with the image omitted leaves BbI alone — `cmp.l d7,d4 /
    // beq.s CreBb8` — and ResBOB never sets BbI when it makes the bob, so a
    // brand new one is image 0. There is no image 0, so it does not draw.
    //
    // Defaulting to image 1 instead put a copy of image 1 wherever such a bob
    // sat. AMOSPro_Examples Help_70 steps `For N=1 To 21` while only ever
    // creating bobs 8 to 21, so bobs 1-7 stayed at 0,0 and stamped the "T" of
    // THEOUTERLIMITS into the corner of its starfield.
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 15,7',
      'Get Bob 1,0,0 To 16,8',
      'Cls 0',
      'Bob 1,40,40,', // never given an image
      'Bob 2,80,40,1', // given one, for contrast
      'Wait Vbl',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.bobs.get(1)!.image).toBe(0)
    expect(rt.screen.point(44, 44)).toBe(0) // nothing drawn
    expect(rt.screen.point(84, 44)).toBe(5) // and the one with an image did
  })

  it('Paste Bob with Hrev mirrors the bank image and leaves it mirrored (Retourne)', () => {
    // The idiom out of AMOSPro_Examples Help_68, which builds six left-facing
    // walk frames from six right-facing ones:
    //
    //   Get Bob N+6,12,0 To 28,21
    //   Hot Spot N+6,%10010 : Paste Bob 500,500,Hrev(N+6)
    //
    // The paste goes to 500,500 — off a 320-wide screen — purely for the side
    // effect. TPatch (+W.s:819) opens with `bsr Retourne`, which mirrors the
    // image IN THE BANK and records the new state in the top two bits of its
    // hot spot word. Ronnio is then drawn as a plain hardware sprite, and
    // `Sprite` never calls Retourne, so images 7-12 stay mirrored.
    //
    // A transient flipped copy draws the same off-screen paste and changes
    // nothing, so the sprite walks left facing right.
    const prog = [
      'Cls 0 : Ink 5 : Plot 0,0',
      'Get Bob 1,0,0 To 16,8', // one marked pixel at column 0
      'Paste Bob 500,500,Hrev(1)', // off screen: only the flip matters
    ].join('\n')
    const { rt } = run(prog)
    const img = rt.spriteBank!.image(1)!
    expect(img.pixels[15]).toBe(5) // column 0 is now column 15, in the BANK
    expect(img.pixels[0]).toBe(0)
    expect(img.hotX).toBe(16) // width - hotX, as RBobX recomputes it
    // and a Sprite drawn from it later gets the mirrored pixels, because the
    // hardware sprite path never calls Retourne to put them back
  })

  it('Retourne is an EOR, so asking for the state it is already in does nothing', () => {
    // `move.w 6(a1),d1 / and.w #$C000,d1 / eor.w d0,d1 / beq.s RetBobX`
    // (+W.s:1680). Two Hrev pastes leave the image mirrored once, not twice.
    const prog = [
      'Cls 0 : Ink 5 : Plot 0,0',
      'Get Bob 1,0,0 To 16,8',
      'Paste Bob 500,500,Hrev(1)',
      'Paste Bob 500,500,Hrev(1)',
      'Cls 0',
      'Paste Bob 100,100,Hrev(1)',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(115, 100)).toBe(5)
  })

  it('Hrev/Vrev Block mirror the stored block (RevBloc +W.s:12591)', () => {
    // a 4x4 request with a single marked pixel at its top-left corner. It is
    // STORED 16 wide, one whole word, because MakeBloc grabs it with GetBob
    // and GetBob keeps a word count (+W.s:12389 and 620).
    const base = ['Cls 0', 'Ink 5 : Plot 10,10', 'Get Block 1,10,10,4,4']
    // horizontal mirror moves column 0 to the last column of that word
    let rt = run([...base, 'Hrev Block 1', 'Cls 0', 'Put Block 1,0,0'].join('\n')).rt
    expect(rt.screen.point(15, 0)).toBe(5)
    expect(rt.screen.point(0, 0)).toBe(0)
    // vertical mirror moves row 0 to the last row, and the height is exact
    rt = run([...base, 'Vrev Block 1', 'Cls 0', 'Put Block 1,0,0'].join('\n')).rt
    expect(rt.screen.point(0, 3)).toBe(5)
    expect(rt.screen.point(0, 0)).toBe(0)
    // a missing block raises the FindBloc "Block not defined" error
    expect(() => run('Hrev Block 9')).toThrow(/block not defined/)
  })

  it('Ins Bob needs a bank rather than making one', () => {
    // InInsSprite +Lib.s:2334 and InInsIcon +Lib.s:2347: `Rbsr L_Bnk.GetBobs /
    // Rbeq L_BkNoRes / move.l d3,d0 / Rble L_FonCall`, bank first then number
    const code = (...lines: string[]): number => {
      try {
        run(['Screen Open 0,320,200,16,0', 'Cls 0', 'Ink 5 : Bar 0,0 To 7,7', ...lines].join('\n'))
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    for (const kw of ['Ins Bob', 'Ins Sprite', 'Ins Icon']) {
      expect([kw, code(`${kw} 1`)]).toEqual([kw, 36])
    }
    expect(code('Get Bob 1,0,0 To 8,8', 'Ins Bob 0')).toBe(23)
    expect(code('Get Bob 1,0,0 To 8,8', 'Ins Bob -1')).toBe(23)
    expect(code('Get Bob 1,0,0 To 8,8', 'Ins Bob 1')).toBe(0)
  })

  it('No Mask with no argument clears every bob, not bob 1', () => {
    // InNoMask0 (+Lib.s:12509) and InMakeMask0 (+Lib.s:12484) both do
    // `moveq #1,d1 / Rbsr L_AdBob / Rbne L_GoError / subq.w #1,d5`, and AdBob
    // left the bank COUNT in d5 (`move.w d1,d5`, +Lib.s:12800, d1 being
    // Bnk.AdBob's "Max de bobs"). So `dbra d5,.Loop` walks the lot. The
    // one-argument forms set `moveq #0,d5` and walk one.
    const grab = ['Screen Open 0,320,200,16,0', 'Cls 0', 'Ink 5 : Bar 0,0 To 7,7']
    const three = [...grab, 'Get Bob 1,0,0 To 8,8', 'Get Bob 2,0,0 To 8,8', 'Get Bob 3,0,0 To 8,8']
    const opaque = (...lines: string[]): boolean[] => {
      const { rt } = run([...three, ...lines].join('\n'))
      return rt.spriteBank!.images.map((im) => im.opaque)
    }
    expect(opaque('Make Mask', 'No Mask')).toEqual([true, true, true])
    expect(opaque('No Mask', 'Make Mask')).toEqual([false, false, false])
    // and with a number, only that one moves
    expect(opaque('Make Mask', 'No Mask 2')).toEqual([false, true, false])
    expect(opaque('No Mask', 'Make Mask 3')).toEqual([true, true, false])
    // AdBob still guards the number: no bank is 36, past the end is 74, and
    // $4000 masks to nothing so it is Illegal function call like 0
    const code = (...lines: string[]): number => {
      try {
        run([...grab, ...lines].join('\n'))
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    expect(code('No Mask')).toBe(36)
    expect(code('Get Bob 1,0,0 To 8,8', 'Make Mask 9')).toBe(74)
    expect(code('Get Bob 1,0,0 To 8,8', 'No Mask 16384')).toBe(23)
  })

  it('Paste Bob tells apart no bank, a number past the end, and a bad number', () => {
    const code = (...lines: string[]): number => {
      try {
        run(['Screen Open 0,320,200,16,0', 'Cls 0', ...lines].join('\n'))
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    const grab = 'Ink 5 : Bar 0,0 To 7,7'
    // `move.l d3,d1 / Rbmi L_FonCall` (+Lib.s:12726), then AdBob's
    // `and.l #$3FFF,d1 / Rbeq L_FonCall` (+Lib.s:12794) — 16384 is $4000, all
    // flag bits and no number, so it masks to zero like 0 does
    for (const n of [-1, 0, 16384]) {
      expect([n, code(grab, 'Get Bob 1,0,0 To 8,8', `Paste Bob 0,0,${n}`)]).toEqual([n, 23])
    }
    // Bnk.AdBob leaves `moveq #0,d1` standing when there is no bank at all,
    // and AdBErr reads that as BkNoRes, error 36 (+Lib.s:12816, +Lib.s:12934)
    expect(code('Paste Bob 0,0,1')).toBe(36)
    // past `move.w (a1),d1 / cmp.w d1,d0 / bhi.s .Rien` d1 is set, so AdBErr
    // takes the other branch: `moveq #EcEBase+30-1,d0`, error 74
    expect(code(grab, 'Get Bob 1,0,0 To 8,8', 'Paste Bob 0,0,5')).toBe(74)
    expect(code(grab, 'Get Icon 1,0,0 To 8,8', 'Paste Icon 0,0,5')).toBe(74)
    // and a real one still pastes
    expect(code(grab, 'Get Bob 1,0,0 To 8,8', 'Paste Bob 0,0,1')).toBe(0)
  })

  it('Get Bob, Get Sprite and Get Icon refuse a negative corner and image 0', () => {
    // Ritoune (+Lib.s:12668) reads all four coordinates through `Rbmi
    // L_FonCall` before it measures anything, and GS/GI then open `move.l
    // (a3),d0 / Rble L_FonCall` (+Lib.s:12590, 12638)
    const bad = (src: string): boolean => {
      try {
        run(['Screen Open 0,320,200,16,0', 'Cls 0', src].join('\n'))
        return false
      } catch (e) {
        return amosErrorCode(e as AmosError) === 23
      }
    }
    for (const kw of ['Get Bob', 'Get Sprite', 'Get Icon']) {
      // a negative corner still satisfies x2 > x1, so it passed the size check
      expect([kw, bad(`${kw} 1,-5,-5 To 10,10`)]).toEqual([kw, true])
      expect([kw, bad(`${kw} 1,-1,0 To 10,10`)]).toEqual([kw, true])
      expect([kw, bad(`${kw} 1,0,-1 To 10,10`)]).toEqual([kw, true])
      expect([kw, bad(`${kw} 0,0,0 To 10,10`)]).toEqual([kw, true])
      expect([kw, bad(`${kw} -1,0,0 To 10,10`)]).toEqual([kw, true])
      // and the legal one still works
      expect([kw, bad(`${kw} 1,0,0 To 10,10`)]).toEqual([kw, false])
    }
  })

  it('a block number outside 1..65535 is error 66, and bare Del Block still clears the lot', () => {
    // all six block keywords open with the same guard: `Rbeq L_BFonCall /
    // cmp.l #65536,d5 / Rbcc L_BFonCall` (+Lib.s:11069, 11091, 11109, 11133,
    // 11176, 11195). BFonCall is `moveq #22,d0 / Rbra L_EcWiErr` (+Lib.s:12998)
    // and EcWiErr adds EcEBase-1 = 44, so a program sees 66, not 22
    const code = (src: string): number => {
      try {
        run(['Screen Open 0,320,200,16,0', 'Cls 0', src].join('\n'))
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    for (const src of [
      'Get Block 0,0,0,8,8',
      'Get Block 65536,0,0,8,8',
      'Get Cblock 0,0,0,8,8',
      'Del Block 0',
      'Del Cblock 65536',
      'Put Block 0',
    ]) {
      expect([src, code(src)]).toEqual([src, 66])
    }
    // Rbcc is unsigned, so a negative number is above the limit too
    expect(code('Get Block -1,0,0,8,8')).toBe(66)
    // InDelBlock0 is `EcCall BlRaz / rts` with no guard at all
    const { rt } = run(['Screen Open 0,320,200,16,0', 'Get Block 1,0,0,8,8', 'Del Block'].join('\n'))
    expect(rt.blocks.size).toBe(0)
  })

  it('Get Block rounds its width UP to a word and Get Cblock truncates to a byte', () => {
    /*
     * Two keywords, two routines, two rules. MakeBloc grabs through GetBob,
     * which keeps a word count (`add.w #15,d4 / lsr.w #4,d4`, +W.s:620), so
     * 220 is stored as 224. CBloc (+W.s:12065) opens `lsr.w #3,d1 / lsr.w
     * #3,d3` and works in whole bytes, so 220 becomes 216 and the x starts
     * at the byte it fell in.
     *
     * Crystal Caverns' `Get Block 1,50,0,220,120,1` / `Put Block 1,50,34`
     * came out as diagonal stripes while the block carried the requested
     * width beside a wider buffer.
     */
    const draw = ['Cls 0', 'For I=0 To 219', '   Ink (I mod 15)+1 : Draw I+50,0 To I+50,29', 'Next I']
    const { rt } = run([...draw, 'Get Block 1,50,0,220,30', 'Cls 0', 'Put Block 1,50,34'].join('\n'))
    expect(rt.blocks.get(1)!.w).toBe(224)
    for (const [i, y] of [[0, 0], [7, 15], [219, 29]] as const) {
      expect(rt.screen.point(50 + i, 34 + y)).toBe((i % 15) + 1)
    }
    const { rt: rt2 } = run([...draw, 'Get Cblock 1,52,0,220,30'].join('\n'))
    expect(rt2.cblocks.get(1)!.w).toBe(216)
    expect(rt2.cblocks.get(1)!.x).toBe(48)
  })

  it('Bob Draw draws without erasing (InBobDraw is ActBob + AffBob)', () => {
    // +Lib.s:11505 is `SyCall ActBob / SyCall AffBob` and stops. EffBob is
    // Bob Clear's (:11499). Dizzy Clone repaints its whole background with
    // `Screen Copy 2 To 0` and then says `Set Bob 15,1,,`, so its bobs fill
    // colour 0 on erase instead of restoring: an erase inside Bob Draw put a
    // black box under Charlie and every bird.
    const base = [
      'Screen Open 0,320,200,16,0 : Flash Off : Bob Update Off',
      'Ink 7 : Bar 0,0 To 100,100', // something to draw over
      'Get Bob 1,0,0 To 16,16 : Cls 0',
      'Ink 7 : Bar 0,0 To 100,100',
      'Set Bob 1,1,, : Bob 1,40,40,1', // back=1: erase fills colour 0
      'Bob Draw',
      'Bob 1,60,40,1',
    ]
    // draw again: nothing should have been blanked where the bob used to be
    const drawn = run([...base, 'Bob Draw'].join('\n')).rt.screens.get(0)!
    expect(drawn.point(45, 45)).not.toBe(0)
    // and Bob Clear on its own is what fills it
    const cleared = run([...base, 'Bob Clear'].join('\n')).rt.screens.get(0)!
    expect(cleared.point(45, 45)).toBe(0)
  })

  it('a bob does not survive its screen (EcDel -> BbEcOff)', () => {
    // BbEc is written once, in ResBOB at creation (+W.s:966), and BobSet
    // never touches it — so AMOS gets rid of the bob instead: EcDel
    // (+W.s:3319) ends `move.l a4,a0 / bsr BbEcOff`, and BbEcOff (+W.s:1100)
    // DelBobs every bob on that screen.
    //
    // Renegades scrolls its intro logo as bob 1 on screen 0, reopens screen
    // 0, then draws both players on the map screen as bobs 0 and 1. Player
    // two stayed behind on the display screen at map coordinates.
    const { rt } = run(
      [
        'Screen Open 0,320,200,16,0 : Bob 1,10,10,1',
        'Screen Open 1,320,200,16,0 : Screen 1',
        'Bob 1,20,20,1',
      ].join('\n'),
    )
    expect(rt.bobs.get(1)!.screen).toBe(0) // still screen 0: BbEc is set once
    const { rt: rt2 } = run(
      [
        'Screen Open 0,320,200,16,0 : Bob 1,10,10,1',
        'Screen Close 0',
        'Screen Open 1,320,200,16,0 : Screen 1',
        'Bob 1,20,20,1',
      ].join('\n'),
    )
    expect(rt2.bobs.get(1)!.screen).toBe(1) // the close took it, so this is a new bob
    // reopening a number closes what was there, which is the case the game hits
    const { rt: rt3 } = run(
      [
        'Screen Open 0,320,200,16,0 : Bob 1,10,10,1',
        'Screen Open 0,320,200,16,0',
        'Screen Open 1,320,200,16,0 : Screen 1',
        'Bob 1,20,20,1',
      ].join('\n'),
    )
    expect(rt3.bobs.get(1)!.screen).toBe(1)
  })

  it('clones screens sharing the bitmap but not the palette', () => {
    const prog = ['Screen Clone 3', 'Ink 5 : Plot 10,10'].join('\n')
    const { rt } = run(prog)
    expect(rt.screens.get(3)!.pixels).toBe(rt.screens.get(0)!.pixels)
    expect(rt.screens.get(3)!.point(10, 10)).toBe(5)
    // EcCClo byte-copies the screen structure, and the colours are in it, so
    // blacking the original leaves the clone's copy to fade back up from
    const { rt: rt2 } = run(['Colour 1,$FFF', 'Screen Clone 3', 'Colour 1,0'].join('\n'))
    expect(rt2.screens.get(0)!.palette[1]).toBe(0)
    expect(rt2.screens.get(3)!.palette[1]).toBe(0xfff)
  })
})

describe('memory model', () => {
  it('List Bank prints the Bnk.List line format (+Lib.s:8616)', () => {
    const { out } = run('Reserve As Data 6,100\nReserve As Chip Work 12,50\nList Bank')
    expect(out).toBe(' 6 - Data     S: $01600000 L: 100\n12 - Work     S: $01C00000 L: 50\n')
  })

  it('Reserve validates the number and length (RsBqX)', () => {
    expect(() => run('Reserve As Data 0,10')).toThrow(/illegal function call/i)
    expect(() => run('Reserve As Data 65536,10')).toThrow(/illegal function call/i)
    expect(() => run('Reserve As Work 5,0')).toThrow(/illegal function call/i)
  })

  it.skipIf(!have('Tutorial/Objects/Bobs.Abk'))('Load overwrites sprites by default and appends only for a number (LB_Sprites)', () => {
    // `tst.w d5` (+Lib.s:4124) looks at the LOW WORD, and the no-number form
    // passes EntNul = $80000000 (+Equ.s:39, InLoad1 +Lib.s:3991) whose low
    // word is zero. So a bare Load replaces the bank, `,0` replaces it, and
    // `,1` is what appends.
    const abk = new Uint8Array(readFileSync(corpus('Tutorial/Objects/Bobs.Abk')))
    const fs = new AmigaFS()
    const vol = fs.mountMemory('DH0')
    vol.write(['bobs.abk'], abk)
    let out = ''
    const src = [
      'Load "bobs.abk"',
      'N=Length(1)',
      'Load "bobs.abk"',
      'Print Length(1)/N',
      'Load "bobs.abk",0',
      'Print Length(1)/N',
      'Load "bobs.abk",1',
      'Print Length(1)/N',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    rt.runHeadless(50)
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '1', '2'])
  })

  it('reserves banks, peeks and pokes through fake addresses', () => {
    const prog = [
      'Reserve As Data 6,100',
      'Poke Start(6),42',
      'Doke Start(6)+2,$1234',
      'Loke Start(6)+4,$DEADBEEF',
      'Print Peek(Start(6));Deek(Start(6)+2)',
      'Print Leek(Start(6)+4)=$DEADBEEF',
      'Print Length(6)',
    ].join('\n')
    expect(run(prog).out).toBe(' 42 4660\n-1\n 100\n')
  })

  it('fills, copies, hunts and Peek$s', () => {
    const prog = [
      'Reserve As Work 6,64',
      'Fill Start(6) To Start(6)+16,$41424344',
      'Print Peek$(Start(6),4)',
      'Poke$ Start(6)+20,"NEEDLE"',
      'Print Hunt(Start(6) To Start(6)+64,"NEEDLE")-Start(6)',
      'Reserve As Data 7,32',
      'Copy Start(6),Start(6)+8 To Start(7)',
      'Print Peek$(Start(7),4)',
    ].join('\n')
    expect(run(prog).out).toBe('ABCD\n 20\nABCD\n')
  })

  it('Bsave/Bload round-trip through the VFS', () => {
    const prog = [
      'Reserve As Data 6,8',
      'Poke$ Start(6),"SAVEDATA"',
      'Bsave "DH0:mem.bin",Start(6) To Start(6)+8',
      'Reserve As Data 7,8',
      'Bload "DH0:mem.bin",Start(7)',
      'Print Peek$(Start(7),8)',
      'Reserve As Data 9,8',
      'Bload "DH0:mem.bin",9', // Bnk.OrAdr: a bare number names a reserved bank
      'Print Peek$(Start(9),8)',
    ].join('\n')
    expect(run(prog).out).toBe('SAVEDATA\nSAVEDATA\n')
    // InBload: an unreserved bank number errors (Bnk.OrAdr)
    expect(() => run('Bsave "DH0:x.bin",1024 To 1032')).toThrow()
    const bad = ['Reserve As Data 6,8', 'Bsave "DH0:m.bin",Start(6) To Start(6)+8', 'Bload "DH0:m.bin",42'].join('\n')
    expect(() => run(bad)).toThrow(/bank not reserved/i)
    // InBSave: end before start is a function call error (+Lib.s:4340)
    const rng = ['Reserve As Data 6,8', 'Bsave "DH0:m.bin",Start(6) To Start(6)'].join('\n')
    expect(() => run(rng)).toThrow(/illegal function call/i)
  })

  it('Erase and Bank Swap manage banks', () => {
    const prog = [
      'Reserve As Data 6,10 : Reserve As Work 7,20',
      'Bank Swap 6,7',
      'Print Length(6);Length(7)',
      'Erase 6',
      'Print Length(6)',
    ].join('\n')
    expect(run(prog).out).toBe(' 20 10\n 0\n')
  })

  it('Deek/Doke/Leek/Loke are big-endian at any alignment (FnDeek +Lib.s:2776)', () => {
    const prog = [
      'Reserve As Data 6,32',
      'Doke Start(6),$1234 : Doke Start(6)+3,$5678', // even and odd
      'Print Peek(Start(6));Peek(Start(6)+1);Deek(Start(6)+3)',
      'Loke Start(6)+8,$DEADBEEF',
      'Print Leek(Start(6)+8)=$DEADBEEF',
    ].join('\n')
    expect(run(prog).out).toBe(' 18 52 22136\n-1\n') // $12,$34; $5678
  })

  it('Fill writes the whole range including the trailing bytes (FillBis +Lib.s:2619)', () => {
    const prog = [
      'Reserve As Data 6,16',
      'Fill Start(6) To Start(6)+6,$41424344',
      'Print Peek(Start(6)+4);Peek(Start(6)+5)', // the tail continues the pattern
    ].join('\n')
    expect(run(prog).out).toBe(' 65 66\n') // $41,$42 — not left as 0
  })

  it('Copy handles overlapping moves within a bank (TransMem +Lib.s:2506)', () => {
    const prog = [
      'Reserve As Data 6,32',
      'Poke$ Start(6),"ABCDEF"',
      'Copy Start(6),Start(6)+6 To Start(6)+2', // forward overlap
      'Print Peek$(Start(6),8)',
    ].join('\n')
    expect(run(prog).out).toBe('ABABCDEF\n')
  })

  it('Length is 0 for a missing bank; Bank Swap renumbers a lone bank (no error)', () => {
    expect(run('Print Length(99)').out).toBe(' 0\n')
    const prog = [
      'Reserve As Work 5,40',
      'Bank Swap 5,7', // 7 unreserved: 5 renumbers to 7, no error
      'Print Length(5);Length(7)',
    ].join('\n')
    expect(run(prog).out).toBe(' 0 40\n')
  })

  it('Bank Shrink only shrinks — a larger length errors (Bnk.Schrink +Lib.s:8265)', () => {
    expect(run('Reserve As Data 6,100 : Bank Shrink 6 To 40 : Print Length(6)').out).toBe(' 40\n')
    expect(() => run('Reserve As Data 6,100 : Bank Shrink 6 To 999')).toThrow()
  })

  it('Erase Temp removes Work banks by the Data flag, keeps Data banks', () => {
    const prog = [
      'Reserve As Data 6,10 : Reserve As Work 7,20 : Reserve As Work 8,30',
      'Erase Temp',
      'Print Length(6);Length(7);Length(8)',
    ].join('\n')
    expect(run(prog).out).toBe(' 10 0 0\n')
  })
})

describe('display control (Update/View/Default/Dual Playfield)', () => {
  it('Update Off freezes both pipelines; Update runs one manual round', () => {
    const prog = [
      'Update Off',
      'Ink 5 : Bar 0,0 To 15,15',
      'Get Bob 1,0,0 To 16,16',
      'Cls 0',
      'Bob 1,50,50,1',
      'Wait Vbl : Wait Vbl',
      'Rem nothing drew yet',
      'X=Point(50,50)',
      'Update',
      'Y=Point(50,50)',
      'Print X;Y',
    ].join('\n')
    expect(run(prog).out).toBe(' 0 5\n')
  })

  it('Default Palette seeds newly opened screens', () => {
    const prog = ['Default Palette $F00,,$0F0', 'Screen Open 1,320,200,16,0'].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(1)!
    expect(s.palette[0]).toBe(0xf00)
    expect(s.palette[2]).toBe(0x0f0)
  })

  it('Auto View Off defers visibility until View — or until Auto View On', () => {
    const prog = ['Auto View Off', 'Screen Open 1,320,200,4,0'].join('\n')
    const { rt } = run(prog)
    expect(rt.screens.get(1)!.visible).toBe(false)
    const prog2 = ['Auto View Off', 'Screen Open 1,320,200,4,0', 'View'].join('\n')
    expect(run(prog2).rt.screens.get(1)!.visible).toBe(true)
    // BitEcrans is still set in T_Actualise; putting the mask bit back
    // (+Lib.s:9065) lets the next VBL reach CopMake (+ILib.s:1011)
    const prog3 = ['Auto View Off', 'Screen Open 1,320,200,4,0', 'Auto View On'].join('\n')
    expect(run(prog3).rt.screens.get(1)!.visible).toBe(true)
  })

  it('a Fade belongs to one screen and dies when that screen is reopened', () => {
    // FadeTOn (+W.s:5510) points T_FadePal at EcPal of the CURRENT screen,
    // and there is one set of those task globals. Renegades faded screen 0
    // out, opened a new screen 0 and printed its credits on it; the fade
    // followed the number and took the new palette to black.
    const { rt } = run(
      [
        'Screen Open 0,320,200,16,0 : Colour 1,$FFF',
        'Fade 1',
        'Wait 2',
        'Screen Open 0,320,200,16,0 : Colour 1,$FFF',
        'Wait 20',
      ].join('\n'),
    )
    expect(rt.screens.get(0)!.palette[1]).toBe(0xfff)
    expect(rt.fade).toBeNull()
    // and a second Fade replaces the first outright, rather than running beside it
    const { rt: rt2 } = run(['Screen Open 1,320,200,16,0', 'Screen 0 : Fade 1', 'Screen 1 : Fade 1'].join('\n'))
    expect(rt2.fade!.scr.index).toBe(1)
  })

  it('Dual Playfield: PF2 shows through front colour 0 via FRONT palette 8-15', () => {
    const prog = [
      'Screen Open 0,320,200,8,0',
      'Cls 0', // front all colour 0
      'Screen Open 1,320,200,8,0',
      'Screen Display 1,128,50,,',
      'Cls 1', // back all colour 1
      'Screen 0 : Screen To Front 0',
      'Colour 9,$00F', // PF2 pixel value 1 resolves through FRONT colour 9
      'Dual Playfield 0,1',
    ].join('\n')
    const { rt } = run(prog)
    const { data } = rt.composite()
    const o = 48 * 640 * 4 // top of the screen band (hardware line 50)
    expect([data[o], data[o + 1], data[o + 2]]).toEqual([0, 0, 255])
  })

  it('reports Screen Mode, Ntsc and Font$ formats', () => {
    const prog = [
      'Screen Open 2,640,200,4,$8000',
      'Print Screen Mode;Ntsc',
      'Get Fonts',
      'Print Font$(1)',
      'F=1 : Set Font F',
    ].join('\n')
    const { out } = run(prog)
    const lines = out.split('\n')
    expect(lines[0]).toBe(' 32768 0')
    expect(lines[1]).toMatch(/^topaz\.font\s+8\s+Rom\s*$/)
  })

  it('Logbase/Phybase are faithful plane pointers (FnLogBase +Lib.s:8822)', () => {
    // planes are planeSize apart; single-buffered Logbase == Phybase (EcLogic ==
    // EcPhysic at open, +W.s:3001); Double Buffer splits them
    const prog = [
      'Screen Open 0,320,200,16,0', // 320 wide, 16 col => 4 planes, rowBytes 40
      'Print Logbase(1)-Logbase(0)', // one plane = 40*200 = 8000 bytes
      'Print Logbase(0)=Phybase(0)', // single-buffered: identical
      'Double Buffer',
      'Print Logbase(0)<>Phybase(0)', // now distinct
    ].join('\n')
    expect(run(prog).out).toBe(' 8000\n-1\n-1\n')
    // a plane index past the depth is a function-call error (4 col => 2 planes)
    expect(() => run('Screen Open 0,320,200,4,0\nPrint Logbase(2)')).toThrow()
  })

  it('a second Double Buffer is error 69, but Anim re-buffering is silent', () => {
    // EcDouble +W.s:2742 `btst #BitDble,EcFlags(a4) / bne EcE25`, EcE25 is
    // `moveq #25,d0` (+W.s:3132) and EcWiErr adds EcEBase-1 = 44 (+Lib.s:12917,
    // +Equ.s:771) for AMOS error 69. The first call still works.
    let code = 0
    try {
      run(['Screen Open 0,320,200,16,0', 'Double Buffer', 'Double Buffer'].join('\n'))
    } catch (e) {
      code = amosErrorCode(e as AmosError)
    }
    expect(code).toBe(69)
    // and only the keyword raises: InDoubleBuffer +Lib.s:8853 follows the call
    // with `Rbne L_EcWiErr`, the IFF ANIM player at +Lib.s:4556 does not
    expect(run(['Screen Open 0,320,200,16,0', 'Double Buffer'].join('\n')).out).toBe('')
  })

  it('plane pokes and chunky drawing round-trip through the same bitmap', () => {
    // row 50 is well below the console text area, so Print does not disturb it.
    // chunky -> planar: Plot then read the plane bit back via Peek
    const a = run(
      [
        'Screen Open 0,320,200,4,0', // 2 planes, rowBytes 40
        'Cls 0 : Plot 8,50,3', // colour 3 = planes 0 and 1 set at x=8,y=50
        'Print Peek(Logbase(0)+50*40+1);Peek(Logbase(1)+50*40+1)',
      ].join('\n'),
    ).out
    expect(a).toBe(' 128 128\n') // x=8 => bit 7 set in both planes
    // planar -> chunky: Poke a plane then read it as a pixel
    const b = run(
      [
        'Screen Open 0,320,200,4,0',
        'Cls 0',
        'Poke Logbase(0)+50*40+0,64', // plane0 row50 byte0 bit6 => x=1
        'Poke Logbase(1)+50*40+0,64', // plane1 same => colour 3
        'Print Point(1,50);Point(0,50)',
      ].join('\n'),
    ).out
    expect(b).toBe(' 3 0\n')
  })
})

describe('menus', () => {
  it('defines a tree, selects with the right button, fires Choice', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const src = [
      'Menu$(1)="File" : Menu$(1,1)="Load" : Menu$(1,2)="Save"',
      'Menu$(2)="Edit" : Menu$(2,1)="Copy"',
      'Menu On',
      'Do',
      ' If Choice Then Print Choice(1);Choice(2)',
      ' Wait Vbl',
      'Loop',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    for (let i = 0; i < 5; i++) rt.frame()
    // press RMB over the "File" title (title bar at the top of screen 0)
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 4
    rt.input.mouseY = 50 + 3
    rt.frame()
    expect(rt.menuOpen).not.toBeNull()
    expect(rt.menuOpen!.levels).toHaveLength(2) // the dropdown opened below
    // move onto the second item ("Save") using its computed geometry
    const save = rt.menuOpen!.levels[1]!.lvl.list[1]!
    rt.input.mouseX = 128 + save.xx + 2
    rt.input.mouseY = 50 + save.yy + 2
    rt.frame()
    expect(rt.menuOpen!.active).toBe(save)
    // release commits the selection and restores the screen
    rt.input.mouseK = 0
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out).toContain(' 1 2')
    expect(rt.menuOpen).toBeNull()
  })

  it('On Menu Goto jumps and does not come back (GoMGo _TkGto)', () => {
    // V1_OnMenu (+Verif.s:1061) takes Goto, Gosub or Proc, and GoMGo
    // (+ILib.s:1063) sends _TkGto to LGoto with no return address pushed.
    // Darts' menu is `On Menu Goto SELECT,SELECT,GAM,SETU,OPER`.
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const src = [
      'Menu$(1)="F" : Menu$(1,1)="X"',
      'Menu On : On Menu Goto PICKED : On Menu On',
      'Do : Wait Vbl : Loop',
      'PICKED: Print "JUMPED" : End',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    const item = rt.menuOpen!.levels[1]!.lvl.list[0]!
    rt.input.mouseX = 128 + item.xx + 2
    rt.input.mouseY = 50 + item.yy + 2
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 5; i++) rt.frame()
    expect(out).toContain('JUMPED')
    expect(rt.interp.gosubs.length).toBe(0) // a Goto leaves nothing to return to
  })

  it('dispatches On Menu Gosub on selection', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const src = [
      'Menu$(1)="F" : Menu$(1,1)="X"',
      'Menu On : On Menu Gosub HANDLER : On Menu On',
      'Do : Wait Vbl : Loop',
      'HANDLER: Print "PICKED";Choice(2) : On Menu On : Return',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    const item = rt.menuOpen!.levels[1]!.lvl.list[0]!
    rt.input.mouseX = 128 + item.xx + 2
    rt.input.mouseY = 50 + item.yy + 2
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 5; i++) rt.frame()
    expect(out).toContain('PICKED 1')
  })
})

describe('Hscroll/Vscroll: window escape codes (InHScroll/InVScroll +Lib.s:13515)', () => {
  // the keywords print control chars 16-19/20-23; the scrolls are the
  // window escape handlers ScG*/ScD*/ScBas*/ScHaut* (+W.s:14539-14760)
  it('Hscroll 1 shifts only the cursor line one character left, paper-filling the edge', () => {
    const prog = [
      'Flash Off',
      'Plot 8,2,5', // text line 0 (cell rows 0-7)
      'Plot 8,10,6', // text line 1
      'Locate 0,0 : Hscroll 1',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(0, 2)).toBe(5) // moved 8px left
    expect(rt.screen.point(8, 2)).toBe(1) // old spot now background
    expect(rt.screen.point(8, 10)).toBe(6) // other lines untouched
    expect(rt.screen.point(312, 2)).toBe(1) // vacated right column = paper
  })

  it('Hscroll 4 shifts the whole window right; Print Chr$(19) is identical', () => {
    const a = run('Flash Off\nPlot 8,2,5 : Plot 8,50,6\nHscroll 4').rt
    const b = run('Flash Off\nPlot 8,2,5 : Plot 8,50,6\nPrint Chr$(19);').rt
    for (const rt of [a, b]) {
      expect(rt.screen.point(16, 2)).toBe(5)
      expect(rt.screen.point(16, 50)).toBe(6)
      expect(rt.screen.point(0, 2)).toBe(1) // vacated left column = paper
    }
  })

  it('Vscroll 1 moves the cursor line and below DOWN, clearing the cursor line (ScBas)', () => {
    const prog = ['Flash Off', 'Plot 4,4,5 : Plot 4,12,6 : Plot 4,20,7', 'Locate 0,1 : Vscroll 1'].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(4, 4)).toBe(5) // line 0 untouched
    expect(rt.screen.point(4, 12)).toBe(1) // cursor line cleared to paper
    expect(rt.screen.point(4, 20)).toBe(6) // old line 1 moved down to line 2
  })

  it('Vscroll 4 moves the lines below the cursor UP, clearing the bottom (ScHautBas)', () => {
    const prog = ['Flash Off', 'Plot 4,12,6 : Plot 4,20,7', 'Locate 0,0 : Vscroll 4'].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(4, 4)).toBe(6) // old line 1 now at line 0 (cursor)
    expect(rt.screen.point(4, 12)).toBe(7) // old line 2 at line 1
    expect(rt.screen.point(4, 192)).toBe(1) // bottom line cleared
  })

  it('rejects arguments outside 1..4 (HVSc +Lib.s:13531)', () => {
    expect(() => run('Hscroll 0')).toThrow(/function call/)
    expect(() => run('Vscroll 5')).toThrow(/function call/)
  })
})

describe('Limit Mouse (InLimitMouse +Lib.s / LimitMEc)', () => {
  it('clamps the pointer to a hardware rectangle each vbl', () => {
    const { rt } = run('Limit Mouse 200,100 To 260,140')
    rt.input.mouseX = 500
    rt.input.mouseY = 20
    rt.frame()
    expect(rt.input.mouseX).toBe(260)
    expect(rt.input.mouseY).toBe(100)
  })

  it('takes MLimA\'s ceilings, its swap and its omitted coordinates', () => {
    // Arcadia line 118 is `Limit Mouse 166,To 328,`. Every slot of the
    // `"I0,0t0,0"` spec may be empty, and an empty one compiles to EntNul,
    // whose low word is zero — MLimA (+W.s:10977) reads words.
    const { rt } = run('Limit Mouse 166,To 328,')
    expect(rt.mouseLimit).toEqual({ x1: 166, y1: 0, x2: 328, y2: 0 })
    // a min above its max is exchanged with it
    expect(run('Limit Mouse 400,50 To 100,20').rt.mouseLimit).toEqual({ x1: 100, y1: 20, x2: 400, y2: 50 })
    // negative minimums clear, and the maximums stop at 458 and 312
    expect(run('Limit Mouse -20,-9 To 900,900').rt.mouseLimit).toEqual({ x1: 0, y1: 0, x2: 458, y2: 312 })
  })

  it('with no arguments limits to the current screen display area', () => {
    const { rt } = run('Screen Open 0,160,50,16,Lowres : Screen Display 0,140,60,,\nLimit Mouse')
    rt.input.mouseX = 20
    rt.input.mouseY = 250
    rt.frame()
    expect(rt.input.mouseX).toBe(140)
    expect(rt.input.mouseY).toBe(60 + 50 - 1)
  })
})

describe('Appear and Screen Base (InAppear +Lib.s:10466, FnScreenBase 8798)', () => {
  it('Appear copies through the shared planes with the gcd dissolve pattern', () => {
    // e sharing a factor with the pixel total leaves pixels uncopied
    const prog = [
      'Screen Open 1,320,32,16,Lowres : Flash Off : Cls 6', // source: all colour 6
      'Screen Open 0,320,32,16,Lowres : Flash Off : Cls 0',
      'Appear 1 To 0,2', // gcd(2, 320*32) = 2: exactly half the pixels
    ].join('\n')
    const { rt } = run(prog)
    const d = rt.screens.get(0)!
    let copied = 0
    for (let i = 0; i < d.pixels.length; i++) if (d.pixels[i] === 6) copied++
    expect(copied).toBe((320 * 32) / 2)
    // a coprime step copies every pixel
    const full = run(prog.replace('Appear 1 To 0,2', 'Appear 1 To 0,7')).rt.screens.get(0)!
    expect(full.pixels.every((v) => v === 6)).toBe(true)
  })

  it('Appear p argument bounds the number of pixels copied', () => {
    const prog = [
      'Screen Open 1,320,32,16,Lowres : Flash Off : Cls 6',
      'Screen Open 0,320,32,16,Lowres : Flash Off : Cls 0',
      'Appear 1 To 0,7,100',
    ].join('\n')
    const { rt } = run(prog)
    const d = rt.screens.get(0)!
    let copied = 0
    for (let i = 0; i < d.pixels.length; i++) if (d.pixels[i] === 6) copied++
    expect(copied).toBe(100)
    expect(() => run('Appear 0 To 0,0')).toThrow(/function call/)
  })

  it('Screen Base maps the Ec control block: geometry, colours, plane pointers', () => {
    const prog = [
      'Screen Open 0,320,200,16,Lowres : Flash Off : Colour 1,$123',
      'A=Screen Base',
      'Print Deek(A+76) : Print Deek(A+78)', // EcTx/EcTy
      'Print Deek(A+80) : Print Deek(A+96)', // EcNPlan/EcNbCol
      'Print Deek(A+178)', // EcTLigne
      'Print Deek(A+98+2)', // EcPal colour 1
      'Print Leek(A)=Logbase(0)', // EcLogic[0]
    ].join('\n')
    expect(run(prog).out).toBe(' 320\n 200\n 4\n 16\n 40\n 291\n-1\n')
  })
})

describe('the pseudo raster beam (FnRnd +Lib.s:1947, VPOSR/VHPOSR)', () => {
  it('Rnd(-n) is the pure generator; Rnd(n) mixes the beam word', () => {
    // the negative form masks out the VHPOSR term (and.w with 0) — the
    // sequence is exactly the seeded LCG and reproduces run to run
    const a = run('Randomize 7 : For I=1 To 5 : Print Rnd(-100) : Next').out
    const b = run('Randomize 7 : For I=1 To 5 : Print Rnd(-100) : Next').out
    expect(a).toBe(b)
    const { out } = run('Randomize 7 : For I=1 To 50 : R=Rnd(10) : If R<0 Or R>10 Then Print "BAD"\nNext : Print "OK"')
    expect(out).toBe('OK\n')
    // Rnd(0) returns the previous result
    expect(run('Randomize 7 : A=Rnd(-1000) : Print Rnd(0)=A').out).toBe('-1\n')
  })

  it('reads of $DFF006 return the advancing beam position', () => {
    const { out } = run(['A=Deek($DFF006)', 'For I=1 To 200 : Next I', 'B=Deek($DFF006)', 'Print A<>B'].join('\n'))
    expect(out).toBe('-1\n')
  })
})

describe('STOS Anim / Move X / Move Y (AniStos +W.s:7454, AmMvtX/AmAnim executors)', () => {
  const frames = (rt: Runtime, n: number): void => {
    for (let i = 0; i < n; i++) rt.frame()
  }

  it('Move X steps by (speed,step,count) groups after Move On', () => {
    const prog = ['Sprite 5,200,120,1', 'Move X 5,"(2,3,4)"', 'Move On'].join('\n')
    const { rt } = run(prog)
    // speed 2: a step every 2 vbls, +3 each, 4 times, then done
    frames(rt, 2)
    expect(rt.hwSprites.get(5)!.x).toBe(203)
    frames(rt, 6)
    expect(rt.hwSprites.get(5)!.x).toBe(212)
    frames(rt, 10)
    expect(rt.hwSprites.get(5)!.x).toBe(212) // finished, stays put
  })

  it('a leading number re-positions, L loops and re-applies it (StML)', () => {
    const prog = ['Sprite 5,10,120,1', 'Move X 5,"100(1,10,3)L"', 'Move On'].join('\n')
    const { rt } = run(prog)
    // the loop's final step and the start re-position land in the SAME
    // vbl (StML writes the position immediately), so the visible cycle
    // is 110, 120, 100 — the nominal 130 never appears on screen
    const seen = new Set<number>()
    for (let i = 0; i < 9; i++) {
      rt.frame()
      seen.add(rt.hwSprites.get(5)!.x)
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([100, 110, 120])
  })

  it('the E position stops the movement on equality; Movon reports it', () => {
    const prog = ['Sprite 5,100,120,1', 'Move X 5,"(1,1,200)E105"', 'Move On', 'Print Movon(5)'].join('\n')
    const { rt, out } = run(prog)
    expect(out).toBe('-1\n')
    frames(rt, 20)
    expect(rt.hwSprites.get(5)!.x).toBe(105) // froze at the trigger
    const src2 = 'Print Movon(3)'
    expect(run(src2).out).toBe(' 0\n')
  })

  it('Anim cycles (image,delay) pairs; L loops, otherwise it parks on the last', () => {
    const prog = ['Sprite 5,100,120,1', 'Anim 5,"(2,3)(7,3)"', 'Anim On'].join('\n')
    const { rt } = run(prog)
    rt.frame()
    expect(rt.hwSprites.get(5)!.image).toBe(2)
    frames(rt, 3)
    expect(rt.hwSprites.get(5)!.image).toBe(7)
    frames(rt, 10)
    expect(rt.hwSprites.get(5)!.image).toBe(7) // no L: stops on the last
  })

  it('Move Off halts and Move On resumes; channels cap at 16 (MvA +Lib.s:11694)', () => {
    const prog = ['Sprite 5,100,120,1', 'Move X 5,"(1,2,50)L"', 'Move On', 'Wait Vbl : Wait Vbl', 'Move Off'].join('\n')
    const { rt } = run(prog)
    const x = rt.hwSprites.get(5)!.x
    frames(rt, 5)
    expect(rt.hwSprites.get(5)!.x).toBe(x) // off: no motion
    expect(() => run('Move X 16,"(1,1,1)"')).toThrow(/function call/)
  })
})

const MOUSE_ABK = join(__dirname, '..', '..', 'fixtures', 'machine', 'AMOSPro_Mouse.abk')

describe.skipIf(!existsSync(MOUSE_ABK))('the mouse pointer (MChange +W.s:10640, HiSho +W.s:10722)', () => {
  const bank = (): Uint8Array => readFileSync(MOUSE_ABK)

  function boot(src: string): { rt: Runtime; out: string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    rt.loadMouseBank(bank())
    const r = rt.runHeadless(1_000)
    mustFinish(r)
    return { rt, out }
  }

  it('the bank is already there at boot — the interpreter carries it (+W.s:16795)', () => {
    // no loadMouseBank call: a bare Runtime has the machine's pointer
    // shapes and system patterns, because a real interpreter binary does
    let out = ''
    const rt = new Runtime(tokenize('Wait Vbl', table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    rt.runHeadless(1_000)
    expect(Buffer.from(DEFAULT_MOUSE_BANK).equals(Buffer.from(bank()))).toBe(true)
    expect(rt.mouseObjects!.image(1)!.width).toBe(16)
    expect(rt.screens.get(0)!.palette[17]! & 0xfff).toBe(0xec8)
    // Set Pattern 1 is image 5 of that bank, not a dither stand-in
    const img = rt.mouseObjects!.image(5)!
    let want = 0
    for (let x = 0; x < 16; x++) if (img.pixels[x] !== 0) want |= 1 << (15 - x)
    rt.screen.pattern = rt.systemPattern(1)
    expect(rt.screen.pattern![0]).toBe(want)
  })

  it('loads the bank shapes and installs its colours 16-31 as the default sprite palette (+W.s:9316)', () => {
    const { rt } = boot('Wait Vbl')
    expect(rt.mouseObjects!.images.length).toBeGreaterThanOrEqual(4)
    const arrow = rt.mouseObjects!.image(1)!
    expect([arrow.width, arrow.height, arrow.depth]).toEqual([16, 11, 2])
    // the pointer colours of a real AMOS Pro boot screen
    expect(rt.screens.get(0)!.palette[17]! & 0xfff).toBe(0xec8)
    expect(rt.screens.get(0)!.palette[18]! & 0xfff).toBe(0xc60)
    expect(rt.screens.get(0)!.palette[19]! & 0xfff).toBe(0xea0)
  })

  it('Change Mouse: 1-3 from the mouse bank, hot spots applied; 0 errors (InChangeMouse)', () => {
    const { rt } = boot('Change Mouse 2')
    expect(rt.mouseShapeNo).toBe(2)
    expect(rt.mouseShape!.hotX).toBe(7) // the crosshair centres on the tip
    expect(() => boot('Change Mouse 0')).toThrow(/function call/)
  })

  it('a sprite-bank shape must be 16px wide with 2 planes, else silently the arrow (MCh3/MChE)', () => {
    // Get Bob makes a 4-plane image on the 16-colour screen — invalid
    const src = ['Ink 2 : Bar 0,0 To 15,15', 'Get Bob 1,0,0 To 16,16', 'Change Mouse 4'].join('\n')
    const { rt } = boot(src)
    expect(rt.mouseShapeNo).toBe(1) // fell back, no error
  })

  it('a 15-wide Get Bob still installs, because the bank stores it as one word', () => {
    // AMOSPro_Examples Help_49 draws its pointers on a 4-colour screen and
    // grabs them with `Get Bob 1,0,0 To 15,63`. Ritoune makes that 15 pixels
    // wide and GetBob rounds it up to one word, which is exactly what MChange
    // demands (`cmp.w #1,(a0)`). Reading the 15 as a pixel width instead
    // rejected every one of the demo's 30 shapes.
    const src = ['Screen Open 1,320,100,4,Lowres', 'Ink 2 : Bar 0,0 To 14,62', 'Get Bob 1,0,0 To 15,63', 'Change Mouse 4'].join('\n')
    const { rt } = boot(src)
    expect(rt.mouseShapeNo).toBe(4)
    expect([rt.mouseShape!.width, rt.mouseShape!.height]).toEqual([16, 63])
  })

  it('draws as hardware sprite 0 at the pointer position, hidden by Hide and Copper Off', () => {
    const { rt } = boot('Wait Vbl')
    rt.input.mouseX = 200
    rt.input.mouseY = 120
    const px = (): number => {
      const { data } = rt.composite()
      // the arrow's hot spot is 0,0 — sample a pixel just inside the shape
      const x = (200 - 128) * 2 + 2
      const y = (120 - 26) * 2 + 2
      const o = (y * 640 + x) * 4
      return (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!
    }
    const shown = px()
    expect(shown).not.toBe(0) // pointer pixels over the black default screen
    rt.mouseShow = -1 // Hide
    const hidden = px()
    expect(hidden).not.toBe(shown)
  })

  it('Hide/Show step the T_MouShow counter; the On forms force it (MHide/MShow)', () => {
    const { rt } = boot(['Hide', 'Hide'].join('\n'))
    expect(rt.mouseShow).toBe(-2)
    const { rt: rt2 } = boot(['Hide', 'Hide', 'Show'].join('\n'))
    expect(rt2.mouseShow).toBe(-1) // still hidden — Show only steps once
    const { rt: rt3 } = boot(['Hide', 'Hide', 'Show On'].join('\n'))
    expect(rt3.mouseShow).toBe(0)
    // the documented quirk: Show past zero counts up, so one Hide later
    // the pointer is STILL visible (HiSho stores the raw counter)
    const { rt: rt4 } = boot(['Show', 'Hide'].join('\n'))
    expect(rt4.mouseShow).toBe(0)
  })

  it('Set Pattern n>0 pulls the real system pattern from the bank (SPat +W.s:4701)', () => {
    const { rt } = boot('Set Pattern 1\nWait Vbl')
    const pat = rt.screens.get(0)!.pattern
    expect(pat).not.toBeNull()
    // a genuine bank pattern, not the 2-row dither stand-in
    expect(pat!.length).toBe(16)
  })
})

describe('long-tail: Rev/Scan$/Parent/Dir/W and the previous-program banks', () => {
  it('Rev sets both flip bits at once (FnRev +Lib.s:12715)', () => {
    const { out } = run('Print Rev(5)-$C000')
    expect(out).toBe(' 5\n')
  })

  it('Scan$ builds the 4-byte Put Key injection string (FnScan1/2 +Lib.s:13770)', () => {
    const { out } = run('A$=Scan$(69) : Print Len(A$);Asc(Mid$(A$,1,1));Asc(Mid$(A$,2,1))')
    expect(out).toBe(' 4 1 69\n')
    const { out: out2 } = run('A$=Scan$(69,3) : Print Asc(Mid$(A$,3,1))')
    expect(out2).toBe(' 3\n')
    expect(() => run('A$=Scan$(256)')).toThrow(/function call/)
  })

  it('Exist is a Lock, so a volume and a drawer answer it (RExist +Lib.s:5704)', () => {
    // RExist is `move.l Name1(a5),d1 / DosCall _LVOLock / beq FExF / UnLock /
    // moveq #-1,d3`, and Lock() takes a volume, an assign or a drawer as
    // happily as a file. Boing 3.0 spins in `Repeat ... Until Exist("boing:")`
    // until this says yes, which is how a game waits for its own disk.
    const prog = [
      'Mkdir "DH0:sub"',
      'Open Out 1,"DH0:f.dat" : Print #1,"x" : Close 1',
      'Print Exist("DH0:")',
      'Print Exist("dh0:")',
      'Print Exist("DH0:sub")',
      'Print Exist("DH0:f.dat")',
      'Print Exist("DH0:nope")',
      'Print Exist("NOSUCH:")',
      'Print Exist("")',
    ].join('\n')
    expect(run(prog).out).toBe('-1\n-1\n-1\n-1\n 0\n 0\n 0\n')
    // NomDisc refuses 108 characters or more before the Lock is ever reached
    // (`cmp.w #108,d2 / Rbcc L_FonCall`, +Lib.s:6574), so a name too long to
    // exist raises where a name that merely does not exist answers 0
    expect(() => run(`Print Exist("DH0:${'x'.repeat(104)}")`)).toThrow(/function call/)
  })

  it('Parent strips the last component of the current dir (InParent +Lib.s:4849)', () => {
    const prog = ['Mkdir "DH0:a"', 'Mkdir "DH0:a/b"', 'Dir$="DH0:a/b"', 'Parent', 'Print Dir$', 'Parent', 'Print Dir$'].join('\n')
    const { out } = run(prog)
    expect(out).toBe('DH0:a\nDH0:\n')
  })

  it('Dir/W lists two columns at half the window width (DirW2 +Lib.s:5798)', () => {
    const prog = ['Mkdir "DH0:sub"', 'Open Out 1,"DH0:f.dat" : Print #1,"x" : Close 1', 'Dir/W'].join('\n')
    const { out } = run(prog)
    const line = out.split('\n')[0]!
    expect(line).toContain('*sub')
    expect(line).toContain(' f.dat') // both entries on one two-column row
  })

  it('Ldir and Ldir/W are the same listings sent to the printer (ImpFlg +Lib.s:5842)', () => {
    // InLDir is InDir with ImpFlg set, and ImpChaine tests ImpFlg before
    // anything else (+Lib.s:5415) — so nothing reaches the window
    const setup = ['Mkdir "DH0:sub"', 'Open Out 1,"DH0:f.dat" : Print #1,"x" : Close 1']
    expect(run([...setup, 'Ldir'].join('\n')).out).toBe('')
    expect(run([...setup, 'Ldir/W'].join('\n')).out).toBe('')
    // the non-L forms of the very same code still print
    expect(run([...setup, 'Dir'].join('\n')).out).not.toBe('')
    // and a bad path still errors, so the listing really did run
    expect(() => run('Ldir "NOSUCH:"')).toThrow(/directory not found/)
  })

  it('Set Accessory is a real no-op, not a stub (L_InNull +Lib.s:1474 / +ILib.s:3748)', () => {
    // the accessory flag belongs to the editor; the interpreter's routine
    // is one rts, so the statement must run and change nothing. $2578's spec
    // is a bare "I", so there is no argument to give it either --- the same
    // shape `Set Double Precision` has, and for the same reason
    expect(run('Set Accessory : Print "ran"').out).toBe('ran\n')
    expect(() => run('Set Accessory -1')).toThrow(/syntax error/i)
  })

  it('the previous-program bank exchange fails standalone (Bnk.PrevProgram, FnBStart +Lib.s:2242)', () => {
    // no editor/parent program exists in the port: BStart errors, BLength
    // is 0, Bgrab erases the destination then errors, Bsend errors
    expect(() => run('Print Bstart(1)')).toThrow(/bank not reserved/)
    expect(run('Print Blength(1)').out).toBe(' 0\n')
    const prog = ['Reserve As Work 5,64', 'Trap Bgrab 5', 'Print Errtrap;Length(5)'].join('\n')
    expect(run(prog).out).toBe(' 36 0\n') // destination erased, error 36
    expect(() => run('Bsend 5')).toThrow(/function call/)
  })
})

describe('long-tail: Freeze/Unfreeze, On Break Proc, Set Tempras, Drive, rts no-ops', () => {
  it('Freeze parks the whole AMAL chain; Unfreeze restores only onto an empty chain (FrzAMAL +W.s:9970)', () => {
    const src = [
      'Ink 2 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16',
      'Sprite 8,200,100,1',
      'Amal 8,"L: Move 10,0,5 ; Jump L" : Amal On',
      'Wait 3', // let it move
      'Freeze',
      'X1=X Sprite(8) : Wait 3 : X2=X Sprite(8)',
      'Print X2-X1',
      'Unfreeze',
      'Wait 3 : Print Sgn(X Sprite(8)-X2)',
    ].join('\n')
    const { out } = run(src)
    expect(out).toBe(' 0\n 1\n') // frozen: no motion; unfrozen: moving again
    // channels made while frozen live on a fresh chain; Unfreeze then
    // DISCARDS the frozen one (UFrzAMAL tst.l T_AmChaine)
    const src2 = [
      'Ink 2 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16',
      'Sprite 8,200,100,1 : Sprite 10,10,10,1',
      'Amal 8,"L: Move 10,0,5 ; Jump L" : Amal On',
      'Freeze',
      'Amal 10,"L: Move 10,0,5 ; Jump L" : Amal On : Wait 2',
      'Unfreeze', // live chain non-empty: frozen channel 0 is dropped
      'X1=X Sprite(8) : Wait 3',
      'Print X Sprite(8)-X1',
    ].join('\n')
    expect(run(src2).out).toBe(' 0\n') // channel 0 never came back
  })

  /** run a few frames, press Ctrl-C, run a few more */
  const breakAfter = (src: string): { done: boolean; out: string } => {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    for (let i = 0; i < 5; i++) rt.frame()
    rt.interp.requestBreak()
    for (let i = 0; i < 5; i++) rt.frame()
    return { done: rt.interp.done, out }
  }

  it('On Break Proc runs the handler on a host break; without one the program stops (InOnBreak +ILib.s:1861)', () => {
    const src = ['On Break Proc HANDLER', 'Do : Wait Vbl : Loop', 'Procedure HANDLER', ' Print "BROKE" : End', 'End Proc'].join('\n')
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    for (let i = 0; i < 5; i++) rt.frame()
    rt.interp.requestBreak()
    for (let i = 0; i < 5; i++) rt.frame()
    expect(out).toBe('BROKE\n')
    const rt2 = new Runtime(tokenize('Do : Wait Vbl : Loop', table), table, { maxSteps: 300_000 })
    for (let i = 0; i < 3; i++) rt2.frame()
    rt2.interp.requestBreak()
    rt2.frame()
    expect(rt2.interp.done).toBe(true)
  })

  it('Break Off swallows Ctrl-C, and Break On takes the handler back off', () => {
    /*
     * `Tst00` (+ILib.s:961) reads the ENABLE bit before it looks for a
     * handler: `btst #BitControl,d4 / beq.s Tst01`, set meaning stop with
     * error 9, "Program interrupted". `Break Off` clears it (+ILib.s:1855)
     * and `Break On` sets it while also doing `clr.l OnBreak(a5)`, which is
     * the only way to forget an On Break Proc.
     */
    const spin = (src: string): ReturnType<typeof breakAfter> => breakAfter(src)
    // Break Off, no handler: the key does nothing and the loop runs on
    expect(spin('Break Off\nDo : Wait Vbl : Loop').done).toBe(false)
    // the default is to stop, and Break On puts it back
    expect(spin('Do : Wait Vbl : Loop').done).toBe(true)
    expect(spin('Break Off : Break On\nDo : Wait Vbl : Loop').done).toBe(true)
    // Break On after On Break Proc forgets the handler, so Ctrl-C stops
    const withProc = 'On Break Proc H\nBreak On\nDo : Wait Vbl : Loop\nProcedure H\n Print "BROKE" : End\nEnd Proc'
    const r = spin(withProc)
    expect(r.done).toBe(true)
    expect(r.out).toBe('')
  })

  it('Set Tempras validates 256..65535; Set Stack/Set Equate Bank are rts (+Lib.s:9997/1683/1689)', () => {
    expect(run('Set Tempras 1024').rt.tempRas).toEqual({ addr: 0, size: 1024 })
    expect(run('Set Tempras $10000,2048').rt.tempRas).toEqual({ addr: 0x10000, size: 2048 })
    expect(() => run('Set Tempras 128')).toThrow(/function call/)
    expect(() => run('Set Tempras 0,65536')).toThrow(/function call/)
    expect(run('Set Stack 8000\nSet Equate Bank 5\nPrint "OK"').out).toBe('OK\n')
  })

  it('Drive requires a trailing ":" and a mounted device/assign (FnDrive +Lib.s:4922)', () => {
    const src = ['Assign "Res:" To "DH0:"', 'Print Drive("DH0:");Drive("res:");Drive("DH0");Drive("nope:")'].join('\n')
    expect(run(src).out).toBe('-1-1 0 0\n')
  })
})

describe('function-argument To ranges (the "0,0T0" token specs)', () => {
  it('Bob Col(n,first To last) parses and bounds the test (FnBobCol +Lib.s:12374)', () => {
    const src = [
      'Ink 2 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16',
      'Bob 1,50,50,1 : Bob 2,50,50,1 : Bob 3,200,100,1',
      'Update : Wait Vbl',
      'Print Bob Col(1,2 To 2);Bob Col(1,3 To 3)',
    ].join('\n')
    // bob 2 overlaps, bob 3 does not — the range limits which are tested
    expect(run(src).out).toBe('-1 0\n')
  })
})

describe('the autoback bob bracket (TAbk1/TAbk4, +W.s:3548 and +W.s:3613)', () => {
  /** the bar's 666 pixels, less whatever the bob's stale save painted back */
  const barPixels = (rt: Runtime): number => {
    const s = rt.screens.get(0)!
    let n = 0
    for (let y = 110; y <= 115; y++) for (let x = 90; x <= 200; x++) if (s.point(x, y) === 5) n++
    return n
  }

  const prog = (autoback: string): string =>
    [
      'Screen Open 0,320,200,16,Lowres : Curs Off : Cls 0',
      'Ink 7 : Bar 0,0 To 31,31 : Get Bob 1,0,0 To 32,32 : Cls 0',
      'Double Buffer',
      autoback,
      'Bob 1,100,100,1',
      'Wait Vbl : Wait Vbl : Wait Vbl',
      // straight through the bob, then move it clear so its old rectangle is
      // restored somewhere it no longer covers
      'Ink 5 : Bar 90,110 To 200,115',
      'Bob 1,240,100,1',
      'Wait Vbl : Wait Vbl',
    ].join('\n')

  it('Autoback 2 erases the bobs first, so drawing under one survives', () => {
    // Double Buffer writes EcAuto=2 (+W.s:2798) and TAbk1 then runs BobEff
    // before the Bar reaches the screen, so the save the bob takes afterwards
    // already has the bar in it
    expect(barPixels(run(prog('Rem default')).rt)).toBe(666)
  })

  it('Autoback 1 does not, and the bob eats what was drawn under it', () => {
    // `subq.w #1,d0 / ble.s TAbk1X` needs EcAuto at 2. The tutorial says so in
    // as many words: Autoback 1 "ignores all bob operations" and "does not
    // wait for the next vertical blank and is therfore much faster"
    // (Tutorials/Autoback_&_Update.AMOS). 32 columns of six rows go back to
    // what was under the bob when it moved there.
    expect(barPixels(run(prog('Autoback 1')).rt)).toBe(666 - 32 * 6)
  })
})

describe('Bob Off is a countdown, not a delete (BbDel +W.s:1272)', () => {
  const off = (extra: string): string =>
    [
      'Screen Open 0,320,200,16,Lowres : Curs Off : Cls 0',
      'Ink 7 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16 : Cls 0',
      extra,
      'Bob 1,100,100,1',
      'Wait Vbl : Screen Swap : Wait Vbl',
      'Wait Vbl : Screen Swap : Wait Vbl',
      'Bob Off',
      'Wait Vbl : Screen Swap : Wait Vbl',
      'Print Point(100,100)',
      'Screen Swap : Wait Vbl : Print Point(100,100)',
      'Screen Swap : Wait Vbl : Print Point(100,100)',
    ].join('\n')

  it('takes two passes on a double buffered screen, and cleans both buffers', () => {
    // BbDecor is 2 there (ResBOB +W.s:975), and the erase runs before the
    // count moves, so each pass puts one buffer's background back. Dropping
    // the bob at Bob Off left it painted in the other buffer for good, and
    // it came back on every swap.
    expect(run(off('Double Buffer')).out).toBe(' 0\n 0\n 0\n')
  })

  it('takes one pass when the screen is single buffered', () => {
    expect(run(off('Rem single')).out).toBe(' 0\n 0\n 0\n')
  })

  it('does not draw the bob while it is counting down', () => {
    // BbDel branches to BbSort, which skips the BbSN that fills the priority
    // table, so the passes erase and never redraw. One Wait Vbl after Bob Off
    // the bob is off the buffer under the pen even though it is still listed.
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off : Cls 0',
        'Ink 7 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16 : Cls 0',
        'Double Buffer',
        'Bob 1,100,100,1',
        'Wait Vbl : Wait Vbl',
        'Bob Off',
        'Wait Vbl',
        'Print Point(100,100)',
      ].join('\n'),
    )
    expect(out).toBe(' 0\n')
  })
})
