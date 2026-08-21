/**
 * The Intuition Extension 1.3b, against Andrew Church's own source.
 *
 * `fixtures/extensions/intuition-1.3b/src` is 26 assembler files with his
 * comments and his symbols, and the binary beside it agrees with them
 * instruction for instruction --- `Iscreen Open`'s five-argument form is
 * `clr.l -(a3) / bra` in both. So every expectation here cites the source,
 * and where the source calls into the compiled blob it says so and cites the
 * binary or the guide instead.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { E, IEXT_ERRORS } from './intuition'

const table = new TokenTable(CORE_TOKENS)
/** slot 14 --- his guide says "enter Intuition.Lib in extension slot number 14" */
const ext = extensionById('intuition-1.3b')!
const exts = new Map([[14, ext.table]])

function boot(src: string): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[14, ext]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  return { rt, out: () => out }
}

function run(src: string): Runtime {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(2_000))
  return b.rt
}

function vals(src: string): number[] {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(2_000))
  return b.out().trim().split(/\s+/).filter(Boolean).map(Number)
}

describe('Intuition 1.3b: the display constants', () => {
  /**
   * `screens.s` opens with three routines that are a `move.l #x,d3` each, and
   * `defs.i`:165-167 gives the values: `HAM equ $0800`, `EHB equ $0080`,
   * `SUPERHIRES equ $0020`.
   *
   * SUPERHIRES is the bare bit. The system header composes it with the hires
   * one as SUPER_KEY $8020, and Church's is the $20 alone -- which is why a
   * program adds `Hires+Superhires` rather than `Superhires` on its own.
   */
  it('Ham, Ehb and Superhires are the three mode bits defs.i names', () => {
    expect(vals('Print Ham;" ";Ehb;" ";Superhires')).toEqual([0x800, 0x80, 0x20])
  })

  /**
   * `move.b $20(a4),d3 / ext.w / ext.l` and the same at `$21` -- `IsAGA` and
   * `IsECS` of `data.i`. Neither is computed in the shipped assembler; both
   * are set by the compiled blob, and the author's comment is what says what
   * they test: "Currently checks SysBase->lib_Version >= 39."
   *
   * This port answers from a machine settled elsewhere: ./jd.ts's A1200 and
   * ./guistate.ts's Kickstart 40.
   */
  it('Aga and Ecs are both true on the machine this port models', () => {
    expect(vals('Print Aga;" ";Ecs')).toEqual([-1, -1])
  })

  /** `movea.l $5e(a4),a0 / move.w $e(a0),d3` -- ViewLord's v_DxOffset */
  it('X and Y Hard Min are the View offset, which nothing here moves', () => {
    expect(vals('Print X Hard Min;" ";Y Hard Min')).toEqual([0, 0])
  })
})

describe('Intuition 1.3b: screens', () => {
  /**
   * The guide: "The screen number n can be any integer, so you are not
   * limited to 8 screens as with standard AMOS screens."
   */
  it('Iscreen Open numbers a screen and makes it current', () => {
    const rt = run('Iscreen Open 0,320,256,16,0\nIscreen Open 5,640,256,4,Hires')
    expect([...rt.iext.screens.keys()]).toEqual([0, 5])
    expect(rt.iext.current).toBe(5)
    expect(rt.iext.screens.get(5)!.depth).toBe(2)
  })

  /**
   * `=Iscreen Width` reads `se_Width` off the extension's own block hanging
   * from `sc_UserData` -- what the OPEN was given. `sc_Width` is right there
   * and `L_GetIscrWidth` does not read it.
   */
  it('the readers answer for the current screen, or for the one named', () => {
    const src = `Iscreen Open 0,320,256,16,0
Iscreen Open 5,640,256,4,Hires
Print Iscreen;" ";Iscreen Width;" ";Iscreen Height;" ";Iscreen Colour;" ";Iscreen Mode
Print Iscreen Width(0);" ";Iscreen Colour(0);" ";Iscreen Mode(0)`
    expect(vals(src)).toEqual([5, 640, 256, 4, 0x8000, 320, 16, 0])
  })

  /**
   * `L_GetIscrCols` asks `=Iscreen Mode` first and tests `and.w #HAM,d3`.
   * Without HAM it is `1 << sc_Depth`; with it, `cmp.b #8,sc_Depth / bne
   * .ham6` picks between two literals. So HAM8 answers 262144 -- the colours
   * it can show -- and not the 2^24 its registers hold.
   */
  it('a HAM screen counts its colours rather than computing them', () => {
    expect(vals('Iscreen Open 1,320,256,4096,Ham\nPrint Iscreen Colour;" ";Iscreen Mode')).toEqual([4096, 0x800])
    expect(vals('Iscreen Open 2,320,256,262144,Ham\nPrint Iscreen Colour')).toEqual([262144])
  })

  /** `and.w #MODES,d3` -- only the five bits `defs.i`:168 names survive */
  it('Iscreen Mode keeps only the five bits MODES names', () => {
    // $21000 is PAL_MONITOR_ID and none of its bits are in MODES
    expect(vals('Iscreen Open 0,320,256,16,Hires+Laced\nPrint Iscreen Mode')).toEqual([0x8004])
  })

  /**
   * `L_IscreenSet` writes the outgoing screen's current window into
   * `se_LastActive` and then `dclr.l CurIwindow`, so selecting a screen
   * leaves NO window current until something selects one.
   */
  it('Set Iscreen changes the current screen and clears the current window', () => {
    const rt = run('Iscreen Open 0,320,256,16,0\nIscreen Open 5,640,256,4,Hires\nSet Iscreen 0')
    expect(rt.iext.current).toBe(0)
    expect(rt.iext.currentWindow).toBe(-1)
  })

  /**
   * `L_IscreenClose` is `FindIscr / beq L_NoScr` then `CloseIscr`, and it
   * does NOT touch `CurIscreen`. So closing the current screen leaves the
   * number naming one that is gone, and every current-form keyword after it
   * answers error 16.
   */
  it('closing the current screen leaves the current number dangling', () => {
    const rt = run('Iscreen Open 3,320,256,16,0\nIscreen Close 3')
    expect([...rt.iext.screens.keys()]).toEqual([])
    expect(rt.iext.current).toBe(3)
    expect(() => run('Iscreen Open 3,320,256,16,0\nIscreen Close 3\nPrint Iscreen')).toThrow(IEXT_ERRORS[E.SNO])
  })

  /** the guide states it: reopening a number is "Screen not closed" */
  it('reopening a number is Screen not closed', () => {
    expect(() => run('Iscreen Open 0,320,256,16,0\nIscreen Open 0,320,256,16,0')).toThrow(IEXT_ERRORS[E.SNC])
  })

  /** `FindIscr / beq L_NoScr` is every reader's first two instructions */
  it('a number nothing opened is Screen not opened', () => {
    expect(() => run('Print Iscreen Width(9)')).toThrow(IEXT_ERRORS[E.SNO])
    expect(() => run('Print Iscreen')).toThrow(IEXT_ERRORS[E.SNO])
  })

  /**
   * `L_IscrOpenBack` is `tmove.b #-1,ScrOpenBehind` with no clear of its own,
   * so it stays set until `Iscreen Open Front` does `dclr.b`.
   */
  it('Iscreen Open Back is a mode, not a one-shot', () => {
    const rt = run('Iscreen Open Back\nIscreen Open 0,320,256,16,0\nIscreen Open 1,320,256,16,0')
    expect(rt.iext.openBehind).toBe(true)
    expect(run('Iscreen Open Back\nIscreen Open Front').iext.openBehind).toBe(false)
  })

  /** `dmove.l CurIscreen,d3` --- the `struct Screen *`, and 0 for none */
  it('Iscreen Base is the screen pointer, and 0 before one is open', () => {
    expect(vals('Print Iscreen Base')).toEqual([0])
    const rt = run('Iscreen Open 0,320,256,16,0')
    expect(rt.iext.screens.get(0)!.address).not.toBe(0)
  })
})

describe('Intuition 1.3b: screen depth arrangement', () => {
  /**
   * `L_IscrFront` is `FindIscr / beq L_NoScr / intcall ScreenToFront`, and
   * `L_CurIscrFront` beside it is `GetCurIscr` and the same call. So the two
   * spellings are one keyword with and without its argument, which is the
   * shape every reader in `screens.s` has.
   */
  it('Iscreen To Front and To Back take a number or the current screen', () => {
    const rt = run(`Iscreen Open 0,320,256,16,0
Iscreen Open 1,320,256,16,0
Iscreen To Back 1
Iscreen To Front 0
Iscreen To Back`)
    // both screens are still open: depth arrangement moves them, it does not
    // close them, and `CurIscreen` is untouched by either
    expect([...rt.iext.screens.keys()]).toEqual([0, 1])
    expect(rt.iext.current).toBe(1)
  })

  /** `FindIscr / beq L_NoScr` guards the numbered form of both */
  it('a number nothing opened is Screen not opened', () => {
    expect(() => run('Iscreen To Front 4')).toThrow(IEXT_ERRORS[E.SNO])
    expect(() => run('Iscreen To Back 4')).toThrow(IEXT_ERRORS[E.SNO])
  })

  /**
   * `L_IscrOpenPublic` is `L_IscreenOpen` with `tmove.b #-1,NextPublic` in
   * front of it, so it opens the same screen and spends the flag.
   *
   * DEVIATION: nothing here can tell a public screen from a private one. A
   * public screen is one another PROGRAM can open a window on, and there is
   * no second program in this port.
   */
  it('Iscreen Open Public opens the screen and spends the flag', () => {
    const rt = run('Iscreen Open Public 2,320,256,16,0')
    expect(rt.iext.screens.get(2)!.width).toBe(320)
    expect(rt.iext.nextPublic).toBe(false)
    expect(rt.iext.current).toBe(2)
  })
})
