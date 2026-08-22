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
import { NOSUB, fullMenuNum } from '../amiga/gadtools'
import type { UserGadget } from '../amiga/intuition'

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

/**
 * Windows.
 *
 * `windows.s` writes almost every one three times --- `n`, `Wb n`, and bare
 * for the current --- as three routines sharing a body. WINDOW 0 IS THE
 * SCREEN: `se_BaseWin`, a backdrop opened with it, and the three modifiers
 * refuse it BY NUMBER before they look anything up.
 */
describe('Intuition 1.3b: windows', () => {
  const S = 'Iscreen Open 0,320,256,16,0'

  it('Iwindow Open puts one on the current screen and makes it current', () => {
    const rt = run(`${S}\nIwindow Open 1,10,20,160,100,"Hello"`)
    const w = rt.iext.screens.get(0)!.windows.get(1)!
    expect([w.window.leftEdge, w.window.topEdge, w.window.width, w.window.height]).toEqual([10, 20, 160, 100])
    expect(w.title).toBe('Hello')
    expect([rt.iext.currentWindow, rt.iext.currentIsWB]).toEqual([1, false])
  })

  /**
   * `=Iwindow Actual Width` is `wd_Width` less `wd_BorderLeft` and
   * `wd_BorderRight` -- the client area. Only the CURRENT form exists: there
   * is no `(n)` and no `Wb` spelling of either, which is the one place in
   * `windows.s` the three-way pattern does not hold.
   */
  it('the readers answer for the current window, or the one named', () => {
    const src = `${S}
Iwindow Open 1,10,20,160,100,"Hello"
Print Iwindow;" ";Iwindow X;" ";Iwindow Y;" ";Iwindow Width;" ";Iwindow Height
Print Iwindow X(1);" ";Iwindow On Wb`
    const v = vals(src)
    expect(v.slice(0, 5)).toEqual([1, 10, 20, 160, 100])
    expect(v.slice(5)).toEqual([10, 0])
    // the borders come off both ways round
    const rt = run(`${S}\nIwindow Open 1,10,20,160,100,"Hello"`)
    const w = rt.iext.screens.get(0)!.windows.get(1)!.window
    expect(vals(`${src}\nPrint Iwindow Actual Width;" ";Iwindow Actual Height`).slice(7)).toEqual([
      160 - w.borderLeft - w.borderRight,
      100 - w.borderTop - w.borderBottom,
    ])
  })

  /**
   * `move.l (a3)+,d0 / beq .scrwin` takes window 0 out of the list walk
   * entirely: the arm wants a screen and then answers 0, so window 0 reports
   * the screen's own origin and nothing else.
   */
  it('window 0 is the screen, and its origin is 0,0', () => {
    expect(vals(`${S}\nIwindow Open 1,10,20,160,100\nPrint Iwindow X(0);" ";Iwindow Y(0)`)).toEqual([0, 0])
  })

  /**
   * `L_WinMove`'s two `cmp.l #Null,d2 / bne .gotx` are the omitted-argument
   * test, and `defs.i`:40 says what Null is: "what AMOS passes if a parameter
   * is omitted". So an omitted coordinate keeps `wd_LeftEdge`.
   */
  it('Iwindow Move takes either coordinate, or leaves it', () => {
    expect(vals(`${S}
Iwindow Open 1,10,20,160,100
Iwindow Move 1,40,50
Print Iwindow X;" ";Iwindow Y
Iwindow Move 1,,80
Print Iwindow X;" ";Iwindow Y`)).toEqual([40, 50, 40, 80])
  })

  /** the guide: "at least 80 x 48 pixels", and the code is `cmp.l #80,d2` */
  it('Iwindow Size has a floor of 80 by 48', () => {
    expect(vals(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Size 1,200,120\nPrint Iwindow Width;" ";Iwindow Height`)).toEqual([200, 120])
    expect(() => run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Size 1,40,50`)).toThrow(IEXT_ERRORS[E.WTS])
    expect(() => run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Size 1,400,50`)).toThrow(IEXT_ERRORS[E.WTL])
  })

  /**
   * `bhi` is UNSIGNED, so a coordinate past the screen and a negative one
   * fail the same comparison -- and the arm is `L_IllFunc`, error 13, rather
   * than one of the window errors.
   */
  it('a move off the screen is Illegal function call', () => {
    expect(() => run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Move 1,300,0`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Move 1,-1,0`)).toThrow(IEXT_ERRORS[E.IFC])
  })

  /**
   * `Set Iwindow 0` is `beq .bkwin` into `dclr.l CurIwindow` -- it selects NO
   * window, which `=Iwindow` then answers 0 for. That is a different thing
   * from `Iwindow Activate 0`, which activates the base window.
   */
  it('Set Iwindow 0 selects no window at all', () => {
    const rt = run(`${S}\nIwindow Open 1,0,0,160,100\nSet Iwindow 0`)
    expect(rt.iext.currentWindow).toBe(-1)
    expect(vals(`${S}\nIwindow Open 1,0,0,160,100\nSet Iwindow 0\nPrint Iwindow`)).toEqual([0])
  })

  /**
   * `=Iwindow Active` follows `wd_UserData` and checks
   * `cmp.l #WE_MAGIC,we_MagicID(a0)`, `$BEADF00D`. So it asks "is the active
   * window one of MINE", and answers 0 rather than raising for a foreign one.
   */
  it('Iwindow Active knows its own windows by their magic', () => {
    expect(vals(`${S}\nIwindow Open 1,0,0,160,100\nPrint Iwindow Active;" ";Iwindow Active Num`)).toEqual([-1, 1])
  })

  /** the guide states both: 0 cannot be closed, and a repeat is not closed */
  it('window 0 cannot be closed and a number cannot be opened twice', () => {
    expect(() => run(`${S}\nIwindow Close 0`)).toThrow(IEXT_ERRORS[E.CW0])
    expect(() => run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Open 1,0,0,160,100`)).toThrow(IEXT_ERRORS[E.WNC])
  })

  /** `beq L_NoModWin0` opens To Front, Move and Size alike */
  it('window 0 cannot be moved, sized or raised', () => {
    for (const src of ['Iwindow To Front 0', 'Iwindow Move 0,1,1', 'Iwindow Size 0,100,100']) {
      expect(() => run(`${S}\n${src}`), src).toThrow(IEXT_ERRORS[E.MW0])
    }
  })

  /** `FindIwin / beq L_NoWin` guards every numbered form */
  it('a number nothing opened is Window not opened', () => {
    expect(() => run(`${S}\nPrint Iwindow X(7)`)).toThrow(IEXT_ERRORS[E.WNO])
    expect(() => run(`${S}\nIwindow Close 7`)).toThrow(IEXT_ERRORS[E.WNO])
  })

  /**
   * The guide: "Only one window with a particular number may be open on a
   * screen at a time, but different screens may have same-numbered windows."
   * `FindIwin` walks the CURRENT screen's `se_FirstIwindow`, which is what
   * makes that true.
   */
  it('two screens may each have a window 1', () => {
    const rt = run(`${S}
Iwindow Open 1,0,0,320,200
Iscreen Open 1,320,256,16,0
Iwindow Open 1,20,20,200,80`)
    expect(rt.iext.screens.get(0)!.windows.get(1)!.window.leftEdge).toBe(0)
    expect(rt.iext.screens.get(1)!.windows.get(1)!.window.leftEdge).toBe(20)
  })

  /**
   * `jtcall DoEvent` runs before the flags are read, with the comment "If
   * close gadget clicked, catch it" -- so ASKING for the status is what
   * notices the close gadget, and `and.l #WEF_CLOSED|WEF_MENUACTIVE` is what
   * the source calls "Legal flags to return".
   */
  it('Iwindow Status catches the close gadget when it is asked', () => {
    // the guide's own idiom for ending a program, and it only works because
    // asking for the status is what pumps the port
    const b = boot(`${S}
Iwindow Open 1,0,0,160,100
Repeat
Until Iwindow Status and 2
Print Iwindow Status`)
    b.rt.runHeadless(1)
    const w = b.rt.iext.screens.get(0)!.windows.get(1)!
    expect(w.flags).toBe(0)
    expect(w.window.post(0x200 /* IDCMP_CLOSEWINDOW */, 0)).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    // 2 is WEF_CLOSED, and it stays set once caught
    expect(Number(b.out().trim())).toBe(2)
  })
})

/**
 * The `Wb` forms: the same keywords over a second list.
 *
 * `FindWBIwin` walks a Workbench list that no screen owns, which is why
 * `L_IwindowCloseWB` has no window-0 check where `L_IwindowClose` does --- a
 * Workbench window 0 is just a window.
 */
describe('Intuition 1.3b: Workbench windows', () => {
  const S = 'Iscreen Open 0,320,256,16,0'
  const W = `${S}\nIwindow Open Wb 1,10,20,160,100,"Wb"`

  it('Iwindow Open Wb puts one on the Workbench, not on the screen', () => {
    const rt = run(W)
    expect(rt.iext.screens.get(0)!.windows.has(1)).toBe(false)
    const w = rt.iext.wbWindows.get(1)!
    expect([w.window.leftEdge, w.window.topEdge, w.number, w.screen]).toEqual([10, 20, 1, null])
    // `moveq #0,d0` rather than `moveq #1,d0` is the whole difference
    expect([rt.iext.currentWindow, rt.iext.currentIsWB]).toEqual([1, true])
  })

  it('the Wb readers answer off the Workbench list', () => {
    expect(vals(`${W}\nPrint Iwindow X Wb(1);" ";Iwindow Y Wb(1);" ";Iwindow Width Wb(1);" ";Iwindow Height Wb(1)`)).toEqual([
      10, 20, 160, 100,
    ])
    expect(vals(`${W}\nPrint Iwindow On Wb;" ";Iwindow Status Wb(1)`)).toEqual([-1, 0])
  })

  /**
   * `L_IwindowSetWB` saves the outgoing window into the SCREEN's
   * `se_LastActive` rather than into `LastActiveWB`, which is the mirror of
   * what `L_IwindowSet` does going the other way.
   */
  it('Set Iwindow Wb swaps the current list and remembers the old one', () => {
    const rt = run(`${S}
Iwindow Open 1,0,0,160,100
Iwindow Open Wb 2,0,0,160,100
Set Iwindow 1
Set Iwindow Wb 2`)
    expect([rt.iext.currentWindow, rt.iext.currentIsWB]).toEqual([2, true])
    expect(rt.iext.screens.get(0)!.lastActive).toBe(1)
  })

  /** `L_IwindowCloseWB` goes straight to `FindWBIwin`, with no 0 to refuse */
  it('a Workbench window 0 is just a window, and closes', () => {
    const rt = run(`${S}\nIwindow Open Wb 0,0,0,160,100\nIwindow Close Wb 0`)
    expect(rt.iext.wbWindows.size).toBe(0)
  })

  it('the Wb modifiers move, size and raise it', () => {
    expect(vals(`${W}
Iwindow Move Wb 1,40,50
Iwindow Size Wb 1,200,120
Iwindow To Front Wb 1
Iwindow To Back Wb 1
Print Iwindow X Wb(1);" ";Iwindow Width Wb(1)`)).toEqual([40, 200])
  })

  /**
   * `L_IwindowActivateWB` sets `CurIwindow` and `CurIwindowIsWB` together
   * and then calls ActivateWindow, so it selects as well as activating.
   */
  it('Iwindow Activate Wb selects it as well as activating it', () => {
    const rt = run(`${W}\nSet Iwindow 0\nIwindow Activate Wb 1`)
    expect([rt.iext.currentWindow, rt.iext.currentIsWB]).toEqual([1, true])
    expect(vals(`${W}\nPrint Iwindow Active Base<>0`)).toEqual([-1])
  })

  /**
   * `Iwindow Activate 0` is `beq .bkwin` into the screen's `se_BaseWin`, so
   * it activates the backdrop --- a different thing from `Set Iwindow 0`,
   * which selects no window at all.
   */
  it('Iwindow Activate 0 activates the base window rather than clearing', () => {
    const rt = run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Activate 0`)
    expect(rt.iext.currentWindow).toBe(0)
    expect(vals(`${S}\nIwindow Open 1,0,0,160,100\nIwindow Activate 0\nPrint Iwindow Base<>0`)).toEqual([-1])
  })

  /** `L_CurIwinToBack` is `GetCurIwin` and the shared `L_WinToBack` body */
  it('To Back takes the current window when it is given no number', () => {
    const rt = run(`${S}\nIwindow Open 1,0,0,160,100\nIwindow To Back`)
    expect(rt.iext.screens.get(0)!.windows.has(1)).toBe(true)
  })
})

/**
 * Drawing, text and colour --- `graphics.s` and `text.s`.
 *
 * `output.s` defines five of these too and IS NOT BUILT: the makefile's
 * INTSRC0 lists `text.s` and `graphics.s` and never it, and `graphics.s` has
 * `Ipaste Bob` and `=Ipoint` that `output.s` has never heard of.
 *
 * Every one opens with `jtcall GetCurRP`, so the pens and the graphics cursor
 * are the current WINDOW's and persist between keywords.
 */
describe('Intuition 1.3b: drawing', () => {
  const W = 'Iscreen Open 0,320,256,16,0\nIwindow Open 1,0,0,320,200,"W"'

  /** `Iink fg` is SetAPen, and it is a mode the next keyword reads */
  it('Iink sets a pen the next drawing keyword uses', () => {
    expect(vals(`${W}\nIink 5\nIbar 20,20 To 60,60\nPrint Ipoint(40,40);" ";Ipoint(10,10)`)).toEqual([5, 0])
  })

  /** `Ibox` is four sides and `Ibar` is RectFill */
  it('Ibox is an outline and Ibar is filled', () => {
    expect(vals(`${W}\nIink 7\nIbox 30,30 To 90,70\nPrint Ipoint(60,30);" ";Ipoint(60,50);" ";Ipoint(30,50)`)).toEqual([
      7, 0, 7,
    ])
    expect(vals(`${W}\nIink 7\nIbar 30,30 To 90,70\nPrint Ipoint(60,50)`)).toEqual([7])
  })

  /** `L_Icircle` falls into `L_Iellipse` with the radius twice */
  it('Icircle is an ellipse with one radius', () => {
    expect(vals(`${W}\nIink 7\nIcircle 150,100,20\nPrint Ipoint(170,100);" ";Ipoint(150,100)`)).toEqual([7, 0])
  })

  /**
   * `Idraw To x,y` starts where the cursor is, which is what makes
   * `Ilocate Gr` and a run of `Idraw To` a polyline. Both forms leave the
   * cursor at the far end.
   */
  it('Idraw leaves the cursor where it finished', () => {
    expect(vals(`${W}\nIink 3\nIdraw 10,150 To 200,150\nPrint Ipoint(100,150);" ";Ixgr;" ";Iygr`)).toEqual([3, 200, 150])
    expect(vals(`${W}\nIink 3\nIlocate Gr 10,20\nIdraw To 60,20\nPrint Ipoint(30,20);" ";Ixgr`)).toEqual([3, 60])
  })

  /**
   * `Itext [x],[y],s$` puts the coordinates through `L_IlocateGr`, so they
   * are GRAPHICS ones and either may be left out -- the y is a baseline, not
   * a top.
   */
  it('Itext takes graphics coordinates, either of which may be omitted', () => {
    expect(vals(`${W}\nIink 2\nIlocate Gr 5,60\nItext ,,"HI"\nPrint Ixgr;" ";Iygr`)).toEqual([5 + 2 * 16, 60])
  })

  /**
   * `Icentre` measures with TextLength and centres across `wd_Width` -- the
   * whole window, borders included -- and passes `#Null` for the y, so the
   * line the cursor is already on is the one it lands on.
   */
  it('Icentre centres across the whole window width', () => {
    expect(vals(`${W}\nIcentre "MID"\nPrint Ixgr`)).toEqual([((320 - 3 * 8) >> 1) + 3 * 8])
  })

  /**
   * `Icls` is SetRast on the SCREEN's base window and `Iclw` is the current
   * WINDOW's interior -- `wd_BorderLeft` and `wd_BorderTop` for the corner.
   */
  it('Icls clears the screen and Iclw the window interior', () => {
    expect(vals(`${W}\nIink 5\nIbar 20,20 To 60,60\nIcls\nPrint Ipoint(40,40)`)).toEqual([0])
    expect(vals(`${W}\nIink 5\nIbar 20,20 To 60,60\nIclw 2\nPrint Ipoint(40,40)`)).toEqual([2])
  })

  /**
   * `Iplot x,y` and `Iplot x,y,c` are one keyword with two specs. The
   * three-argument one is `gfxcall SetAPen` and then the same body, so the
   * colour STAYS set for whatever draws next.
   */
  it('Iplot takes a colour, and leaves it set', () => {
    expect(vals(`${W}\nIplot 100,100,3\nPrint Ipoint(100,100)`)).toEqual([3])
    expect(vals(`${W}\nIplot 100,100,3\nIbar 20,20 To 40,40\nPrint Ipoint(30,30)`)).toEqual([3])
  })

  /** `Iellipse cx,cy,rx,ry` --- DrawEllipse, so an outline and no interior */
  it('Iellipse is an outline about its centre', () => {
    expect(vals(`${W}\nIink 6\nIellipse 150,100,40,20\nPrint Ipoint(190,100);" ";Ipoint(150,80);" ";Ipoint(150,100)`)).toEqual([
      6, 6, 0,
    ])
  })

  /**
   * `Igr Writing n` is `jtcall GetCurRP` and `gfxcall SetDrMd` --- one
   * instruction of its own, so the mode is graphics.library's numbering and
   * it stays set. 2 is COMPLEMENT, which inverts and ignores the pen.
   */
  it('Igr Writing is SetDrMd and stays set', () => {
    expect(vals(`${W}\nIink 5\nIbar 20,20 To 60,60\nIgr Writing 2\nIbar 20,20 To 60,60\nPrint Ipoint(40,40)`)).toEqual([
      5 ^ 15,
    ])
  })

  /** `cmp.l d4,d2 / blt L_MixedCoords` --- checked before anything is drawn */
  it('backward coordinates are error 25', () => {
    expect(() => run(`${W}\nIbar 60,60 To 20,20`)).toThrow(IEXT_ERRORS[E.BWC])
    expect(() => run(`${W}\nIbox 60,60 To 20,20`)).toThrow(IEXT_ERRORS[E.BWC])
  })

  /**
   * `=Ipoint` is bounded by the WINDOW, `move.w wd_Width(a0),d2`, and both
   * comparisons are `bcc` -- unsigned, so a negative is a very large one.
   */
  it('Ipoint is bounded by the window, unsigned', () => {
    expect(() => run(`${W}\nPrint Ipoint(400,10)`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nPrint Ipoint(-1,10)`)).toThrow(IEXT_ERRORS[E.IFC])
  })

  /**
   * `Ilocate` is TEXT positioning and IS range checked, unconditionally --
   * `bm_Rows / tf_YSize` and `bm_BytesPerRow * 8 / tf_XSize`. `Ilocate Gr`
   * is not: its four checks are behind `ifd SAFE_GRPOS`, `defs.i`:46 has the
   * `equ` commented out, and routine 184 in the binary goes from
   * `move.l (a3)+,d0` straight to SetCoords.
   */
  it('Ilocate is bounded and Ilocate Gr is not', () => {
    expect(() => run(`${W}\nIlocate 999,0`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(vals(`${W}\nIlocate Gr 9999,9999\nPrint Ixgr;" ";Iygr`)).toEqual([9999, 9999])
  })

  /**
   * `cmp.w cm_Count(a1),d0 / bcc L_IllFunc` on the way in, and `bmi` on
   * GetRGB4's -1 on the way out. The map is the one OpenScreen allocated for
   * the screen's depth, so a sixteen-colour screen has sixteen entries.
   */
  it('Icolour reads and writes the map, and is bounded by it', () => {
    expect(vals(`${W}\nSet Icolour 1,$F00\nPrint Hex$(Icolour(1))`)).toEqual([NaN])
    expect(() => run(`${W}\nSet Icolour 99,0`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nPrint Icolour(99)`)).toThrow(IEXT_ERRORS[E.IFC])
  })

  /**
   * `Ipalette` does nothing at all. `color.s` carries the real one behind
   * `ifne 0` with the author's reason above it -- "Ipalette disabled because
   * it's unstable" -- and what shipped is `L_Ipalette0`, "just a stub".
   * Routine 52 in the binary is two bytes long and they are an `rts`.
   */
  it('Ipalette is a stub that shipped as one', () => {
    expect(vals(`${W}\nSet Icolour 1,$F00\nIpalette 3\nPrint Hex$(Icolour(1))`)).toEqual([NaN])
    const rt = run(`${W}\nSet Icolour 1,$F00\nIpalette $0F0`)
    expect(rt.screens.get(rt.iext.screens.get(0)!.slot)!.palette[1]).toBe(0xf00)
  })
})

/**
 * Input --- `input.s`.
 *
 * The extension keeps its own key and menu buffers, `KeyBufPtr` and
 * `MenuBufPtr` with a `Next` pointer each, and `Iclear` resets a pointer
 * rather than draining anything.
 */
describe('Intuition 1.3b: input', () => {
  const W = 'Iscreen Open 0,320,256,16,0\nIwindow Open 1,0,0,320,200,"W"'

  /**
   * Six constants, three instructions each, and they are IDCMP classes ---
   * which is what makes `E=Iwait Event : If E=Ievent Close` the idiom.
   * `Ievent Vbl` is `$80000000` because no IDCMP class could collide with it.
   */
  it('the six Ievent constants are IDCMP classes', () => {
    expect(vals('Print Ievent Mouse;" ";Ievent Gadget;" ";Ievent Menu;" ";Ievent Close;" ";Ievent Key')).toEqual([
      0x8, 0x40, 0x100, 0x200, 0x400,
    ])
    expect(vals('Print Ievent Vbl')).toEqual([-0x8000_0000])
  })

  /**
   * `L_IbufResetMouse` is ONE instruction, an `rts`, and Andrew Church
   * labelled it himself: "Iclear Mouse - now a no-op". There was a mouse
   * buffer once and there is not any more.
   */
  it('Iclear Mouse does nothing, and says so in the source', () => {
    expect(() => run(`${W}\nIclear All\nIclear Key\nIclear Menu\nIclear Mouse`)).not.toThrow()
  })

  /**
   * `Iwait Key` is `.lp` around `GetKey`, and GetKey CONSUMES: the key is
   * gone by the time the wait returns, so `=Iget$` after it finds nothing.
   * `LastCode` is written by whatever took the key, which is why `=Iscan`
   * still knows what it was.
   */
  it('Iwait Key consumes the key it waited for, and Iscan remembers it', () => {
    const b = boot(`${W}\nIwait Key\nPrint "["+Iget$+"] ";Iscan`)
    b.rt.frame()
    b.rt.pressKey('A', 0x20)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe('[] 32')
  })

  /**
   * `=Iget$` never waits: `jtcall GetKey / beq .nokey` and `.nokey` is
   * `dlea NullStr,a0`. That is the whole difference between it and
   * `=Iread Char$`.
   */
  it('Iget$ answers the empty string rather than waiting', () => {
    const b = boot(`${W}\nPrint "["+Iget$+"]"`)
    mustFinish(b.rt.runHeadless(500))
    expect(b.out().trim()).toBe('[]')
  })

  /**
   * `L_IwaitEvent` pumps the port and answers the CLASS, keeping in
   * `EventData` whatever DoEvent's arm for that class left in d0.
   *
   * For CLOSEWINDOW that is `WEF_CLOSED`, 2, and not the message's code:
   * `moveq #WEF_CLOSED,d0 / move.l d0,d1 / bsr SetSomeWinFlags`, and
   * SetSomeWinFlags opens `and.l d1,d0`, which hands the same 2 back.
   */
  it('Iwait Event answers the IDCMP class, and the data is the arm leftover', () => {
    const b = boot(`${W}\nE=Iwait Event\nPrint E;" ";Ievent Data`)
    b.rt.runHeadless(1)
    const w = b.rt.iext.screens.get(0)!.windows.get(1)!
    expect(w.window.post(0x200 /* IDCMP_CLOSEWINDOW */, 7)).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([0x200, 2])
  })

  /**
   * `L_IwaitEventVbl` adds `VBLSignal` to the mask and answers `$80000000`
   * when that is what woke it --- so a program can drive an animation off the
   * same loop that reads its gadgets, which is what the `.vbl` arm is for.
   */
  it('Iwait Event Vbl gives the frame back when nothing else happened', () => {
    expect(vals(`${W}\nPrint Iwait Event Vbl`)).toEqual([-0x8000_0000])
  })

  /**
   * `move.w wd_MouseX(a0),d3` and then `sub.w wd_BorderLeft(a0)`, so the
   * answer is CLIENT-relative: 0,0 is the first drawable pixel. Nothing
   * clamps it, so a pointer over the border reads NEGATIVE, which is what a
   * window at the screen's corner with the pointer at 0,0 gives.
   */
  it('Imouse X and Y are client-relative, and go negative over the border', () => {
    const rt = run(`${W}`)
    const w = rt.iext.screens.get(0)!.windows.get(1)!.window
    expect(vals(`${W}\nPrint Imouse X;" ";Imouse Y`)).toEqual([-w.borderLeft, -w.borderTop])
  })

  /**
   * `=Ishift` is `LastQual`, the qualifier that came with the last key TAKEN
   * -- so like `=Iscan` it describes what was consumed rather than what is
   * held down now.
   */
  it('Ishift is the qualifier of the last key taken', () => {
    const b = boot(`${W}\nIwait Key\nPrint Iscan;" ";Ishift`)
    b.rt.frame()
    // the shift byte is captured WITH the keystroke, from the scancodes
    // $60-$67 that are held; $60 is the left shift
    b.rt.input.keys.add(0x60)
    b.rt.pressKey('A', 0x20)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([0x20, 0x1])
  })

  /**
   * `L_IwaitMouse` is `.lp` around `GetMouse`, the mirror of `Iwait Key`.
   *
   * It waits on the Z flag DoEvent returns, not on `MouseState`, so it is the
   * one mouse keyword the `bclr` defect leaves alone.
   */
  it('Iwait Mouse waits for a button', () => {
    const b = boot(`${W}\nIwait Mouse\nPrint "done"`)
    b.rt.frame()
    expect(b.out()).toBe('')
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('done')
  })

  /** and `=Imouse Key` answers 0 with the button held, because nothing sets
   * a bit of `MouseState` --- both arms of DoEvent's MOUSEBUTTONS case are
   * `bclr d0,d1` */
  it('Imouse Key is 0 whatever the buttons are doing', () => {
    const b = boot(`${W}\nPrint Imouse Key`)
    b.rt.input.mouseK = 3
    mustFinish(b.rt.runHeadless(500))
    expect(Number(b.out().trim())).toBe(0)
  })
})

/**
 * `menus.s` --- Intuition's own Menu and MenuItem structures, built by hand.
 */
describe('Intuition 1.3b: menus', () => {
  const W = 'Iscreen Open 0,320,256,16,0\nIwindow Open 1,0,0,320,200,"W"'

  function win(rt: Runtime) {
    return rt.iext.screens.get(0)!.windows.get(1)!
  }

  /**
   * A menu is `(len << 3) + 8` wide and 10 tall, and each one starts 8 pixels
   * right of the previous one's right edge. The first has no previous, so
   * `beq .munext` leaves its LeftEdge at the zero AllocMemClear gave it.
   */
  it('Set Imenu lays the bar out left to right', () => {
    const rt = run(`${W}\nSet Imenu "Project",1\nSet Imenu "Edit",2`)
    const m = win(rt).menus
    expect(m.map((x) => [x.number, x.name, x.leftEdge, x.width, x.height])).toEqual([
      [1, 'Project', 0, 7 * 8 + 8, 10],
      [2, 'Edit', 0 + 64 + 8, 4 * 8 + 8, 10],
    ])
  })

  /**
   * The list is kept ascending because `FindImenu` stops walking at the first
   * number above the one it wants. Defining them out of order still sorts
   * them --- and leaves the geometry wrong, because a LeftEdge is computed
   * once from whatever was in front at the time.
   */
  it('menus sort by number, and the geometry does not catch up', () => {
    const rt = run(`${W}\nSet Imenu "Second",3\nSet Imenu "First",1`)
    const m = win(rt).menus
    expect(m.map((x) => x.number)).toEqual([1, 3])
    // "Second" was the first one defined, so it is at 0, and "First" landed
    // in front of it at 0 as well
    expect(m.map((x) => x.leftEdge)).toEqual([0, 0])
  })

  /**
   * An item is `2 + rp_TxHeight` tall, which is 10 in topaz 8, and stacks
   * under the previous one. A subitem starts 8 pixels inside its parent's
   * right edge. The pens come off the RastPort swapped.
   */
  it('items stack downwards and subitems hang off the right', () => {
    const rt = run(`${W}\nSet Imenu "P",1\nSet Imenu "Open",1,1\nSet Imenu "Save",1,2\nSet Imenu "As",1,2,1`)
    const items = win(rt).menus[0]!.items
    expect(items.map((i) => [i.number, i.text, i.topEdge, i.width, i.height])).toEqual([
      [1, 'Open', 0, 4 * 8 + 4, 10],
      [2, 'Save', 10, 4 * 8 + 4, 10],
    ])
    const sub = items[1]!.subItems[0]!
    expect(sub.isSub).toBe(true)
    expect(sub.leftEdge).toBe(items[1]!.leftEdge + items[1]!.width - 8)
    // `move.b rp_BgPen(a0),it_FrontPen(a5)` and `rp_FgPen` into it_BackPen
    expect([sub.frontPen, sub.backPen]).toEqual([0, 1])
  })

  /** `tst.w (a5) / beq .exit` --- an empty string frees rather than defines */
  it('an empty string deletes, and a menu takes its items with it', () => {
    const rt = run(`${W}\nSet Imenu "P",1\nSet Imenu "Open",1,1\nSet Imenu "",1`)
    expect(win(rt).menus).toEqual([])
  })

  /** deleting one item of several relinks through `mi_NextItem` correctly */
  it('deleting a middle item leaves the rest', () => {
    const rt = run(`${W}\nSet Imenu "P",1\nSet Imenu "A",1,1\nSet Imenu "B",1,2\nSet Imenu "",1,2`)
    expect(win(rt).menus[0]!.items.map((i) => i.text)).toEqual(['A'])
  })

  /**
   * DEFECT: `.isitm2` writes `mu_FirstItem` of the MENU whichever list the
   * node came from, so deleting the FIRST subitem of an item drops the whole
   * menu's item list and puts that subitem's siblings there instead.
   */
  it('deleting the first subitem wipes the menu it hangs under', () => {
    const rt = run(
      `${W}\nSet Imenu "P",1\nSet Imenu "A",1,1\nSet Imenu "B",1,2\n` +
        `Set Imenu "S1",1,2,1\nSet Imenu "S2",1,2,2\nSet Imenu "",1,2,1`,
    )
    const menu = win(rt).menus[0]!
    // the menu's items are now item 2's remaining SUBITEMS
    expect(menu.items.map((i) => i.text)).toEqual(['S2'])
    // and nothing unhooked the deleted subitem from its parent
    expect(menu.items[0]!.subItems).toEqual([])
  })

  /** the four range checks, all unsigned, and menu 0 refused outright */
  it('menu 0, and anything over the limits, is error 13', () => {
    expect(() => run(`${W}\nSet Imenu "x",0`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nSet Imenu "x",32`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nSet Imenu "x",1,64`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nSet Imenu "x",1,1,32`)).toThrow(IEXT_ERRORS[E.IFC])
  })

  /** an item or subitem under a level that does not exist is refused */
  it('a number below a level that is not there is error 13', () => {
    expect(() => run(`${W}\nSet Imenu "x",1,1`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nSet Imenu "P",1\nSet Imenu "x",1,1,1`)).toThrow(IEXT_ERRORS[E.IFC])
  })

  /** `btst #WEB_MENUACTIVE,d0 / bne L_MenuActive`, before anything is popped */
  it('Set Imenu while the strip is up is error 26', () => {
    expect(() => run(`${W}\nSet Imenu "P",1\nImenu On\nSet Imenu "E",2`)).toThrow(IEXT_ERRORS[E.MAA])
  })

  /**
   * `=Iwindow Status` hands back WEF_MENUACTIVE, which is bit 3, so a program
   * can see whether its own strip is up.
   */
  it('Imenu On and Off move the MENUACTIVE flag', () => {
    expect(vals(`${W}\nSet Imenu "P",1\nImenu On\nPrint Iwindow Status\nImenu Off\nPrint Iwindow Status`)).toEqual([8, 0])
  })

  /** with nothing defined, `beq .nomenu` makes Imenu On turn menus OFF */
  it('Imenu On with no menus clears the strip instead of setting one', () => {
    expect(vals(`${W}\nImenu On\nPrint Iwindow Status`)).toEqual([0])
  })

  /**
   * A MENUPICK carries Intuition's POSITIONAL number and `=Ichoice` answers
   * in the program's own, because `GetMenu` reads `mu_MenuNum` and
   * `mi_ItemNum` back out of the structure `ItemAddress` found.
   */
  it('Ichoice answers the numbers Set Imenu was given, not the positions', () => {
    const b = boot(
      `${W}\nSet Imenu "P",7\nSet Imenu "A",7,5\nImenu On\nR=0\nRepeat\nR=R+1\nWait Vbl\nUntil R>1\n` +
        `Print Ichoice(1);" ";Ichoice(2);" ";Ichoice(3)`,
    )
    b.rt.frame()
    expect(win(b.rt).window.post(0x100 /* IDCMP_MENUPICK */, fullMenuNum(0, 0, NOSUB))).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([7, 5, 0])
  })

  /** a subitem fills all three, walking `mi_Parent` up twice */
  it('a subitem pick fills the menu, the item and the subitem', () => {
    const b = boot(
      `${W}\nSet Imenu "P",2\nSet Imenu "A",2,3\nSet Imenu "S",2,3,4\nImenu On\n` +
        `R=0\nRepeat\nR=R+1\nWait Vbl\nUntil R>1\nPrint Ichoice(1);" ";Ichoice(2);" ";Ichoice(3)`,
    )
    b.rt.frame()
    expect(win(b.rt).window.post(0x100, fullMenuNum(0, 0, 0))).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([2, 3, 4])
  })

  /** each level is read and cleared, so a second ask answers 0 */
  it('Ichoice consumes what it reads', () => {
    const b = boot(
      `${W}\nSet Imenu "P",7\nSet Imenu "A",7,5\nImenu On\nR=0\nRepeat\nR=R+1\nWait Vbl\nUntil R>1\n` +
        `Print Ichoice(1);" ";Ichoice(1)`,
    )
    b.rt.frame()
    expect(win(b.rt).window.post(0x100, fullMenuNum(0, 0, NOSUB))).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([7, 0])
  })

  /** `cmp.w #MENUNULL,d2 / beq .portok` --- an empty pick is pumped past */
  it('MENUNULL is not a choice', () => {
    const b = boot(
      `${W}\nSet Imenu "P",7\nSet Imenu "A",7,5\nImenu On\nR=0\nRepeat\nR=R+1\nWait Vbl\nUntil R>1\n` +
        `Print Ichoice(1)`,
    )
    b.rt.frame()
    expect(win(b.rt).window.post(0x100, 0xffff)).toBe(true)
    expect(win(b.rt).window.post(0x100, fullMenuNum(0, 0, NOSUB))).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(7)
  })

  /** `subq.l #1,d0` three times, then `bne L_IllFunc` */
  it('Ichoice takes 1, 2 or 3 and nothing else', () => {
    expect(() => run(`${W}\nPrint Ichoice(0)`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nPrint Ichoice(4)`)).toThrow(IEXT_ERRORS[E.IFC])
  })
})

/**
 * `fonts.s` --- five readers over `rp_Font` and one setter that opens a face.
 */
describe('Intuition 1.3b: fonts', () => {
  const W = 'Iscreen Open 0,320,256,16,0\nIwindow Open 1,0,0,320,200,"W"'

  /**
   * A fresh RastPort draws in the system font, which is topaz 8: `tf_Baseline`
   * 6, `tf_YSize` 8, and the name off the TextFont's own exec Node at
   * `10(a0)`, extension included.
   */
  it('the readers answer for topaz 8, the face a window opens with', () => {
    expect(vals(`${W}\nPrint Itext Base;" ";Ifont Height`)).toEqual([6, 8])
    const b = boot(`${W}\nPrint Ifont$`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('topaz.font')
  })

  /** `=Itext Length` is graphics.library's TextLength, so 8 a character here */
  it('Itext Length measures in the current font', () => {
    expect(vals(`${W}\nPrint Itext Length("");" ";Itext Length("hello")`)).toEqual([0, 40])
  })

  /** `=Ifont Base` is `move.l rp_Font(a0),d3`, a pointer; ours is synthetic
   * and has only to be stable */
  it('Ifont Base is one number for one face', () => {
    const [a, b] = vals(`${W}\nPrint Ifont Base;" ";Ifont Base`)
    expect(a).toBeGreaterThan(0)
    expect(b).toBe(a)
  })

  /** OpenFont finds topaz 8 without a volume, with or without the extension */
  it('Set Ifont takes topaz with or without the .font', () => {
    expect(vals(`${W}\nSet Ifont "topaz",8\nPrint Ifont Height`)).toEqual([8])
    expect(vals(`${W}\nSet Ifont "topaz.font",8\nPrint Ifont Height`)).toEqual([8])
  })

  /**
   * The suffix test is five `cmp.b` in a row, so it is case sensitive, and the
   * guide's error node says what that costs: *"If you included the \".font\"
   * extension to the font name, make sure it is all lower case - something
   * like Set Ifont \"fontname.Font\" won't work."* An upper-case one is not
   * recognised, `.font` is appended to it, and nothing opens.
   */
  it('Set Ifont "topaz.Font" is not topaz', () => {
    expect(() => run(`${W}\nSet Ifont "topaz.Font",8`)).toThrow(IEXT_ERRORS[E.FNA])
  })

  /** neither OpenFont nor OpenDiskFont answers, so `L_NoFont` */
  it('a face that is not there is error 15', () => {
    expect(() => run(`${W}\nSet Ifont "nosuchface",8`)).toThrow(IEXT_ERRORS[E.FNA])
  })

  /**
   * `Set Ifont namesize$` cannot work. Routine 110 saves a1 across GetRetStr
   * believing the new string is in it; StrAlloc left `$a4(a4)` there, so
   * routine 109 is handed the address of `FirstString` and reads a font name
   * out of the data zone. See the DEFECT note on the keyword.
   */
  it('Set Ifont "topaz/8" raises 15 rather than setting topaz 8', () => {
    expect(() => run(`${W}\nSet Ifont "topaz/8"`)).toThrow(IEXT_ERRORS[E.FNA])
  })

  /** the two checks that run BEFORE the bug still decide their own error */
  it('a name with no slash, or a size that is not digits, is error 13', () => {
    expect(() => run(`${W}\nSet Ifont "topaz8"`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nSet Ifont "topaz/x"`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nSet Ifont "topaz/"`)).toThrow(IEXT_ERRORS[E.IFC])
  })
})

/**
 * `other.s` --- waits, and the error machinery everything else raises into.
 */
describe('Intuition 1.3b: errors and waits', () => {
  const W = 'Iscreen Open 0,320,256,16,0\nIwindow Open 1,0,0,320,200,"W"'

  /** without trapping an error stops the program, as any AMOS error does */
  it('an error is fatal until Itrap On', () => {
    expect(() => run(`${W}\nIwindow Close 7`)).toThrow(IEXT_ERRORS[E.WNO])
  })

  /**
   * `errors.s`'s `.trap` arm does not raise: it sets `ErrorTrapped`, puts the
   * stack back to `A7StackEnd-4` -- Church's comment is "Quit from offending
   * routine" -- and returns as though the keyword had finished. So the
   * program carries on and asks afterwards.
   *
   * `L_CustomError` records the number and the message BEFORE it tests the
   * trap, which is why `=Ierr` and `=Ierr$` answer for a trapped error.
   */
  it('Itrap On abandons the keyword and lets the program ask afterwards', () => {
    const out = boot(`${W}
Itrap On
Iwindow Close 7
Print Ierrtrap;" ";Ierr;" [";Ierr$;"]"`)
    mustFinish(out.rt.runHeadless(2_000))
    expect(out.out().trim().replace(/\s+/g, ' ')).toBe(`-1 ${E.WNO} [${IEXT_ERRORS[E.WNO]}]`)
  })

  /**
   * `dmove.b ErrorTrapped,d3` then `dclr.b ErrorTrapped` --- a read and a
   * clear, so asking twice answers -1 and then 0.
   */
  it('Ierrtrap forgets what it reports', () => {
    expect(vals(`${W}\nItrap On\nIwindow Close 7\nPrint Ierrtrap;" ";Ierrtrap`)).toEqual([-1, 0])
  })

  /**
   * `tmove.b #-1,TrapErrors` and then `dclr.b ErrorTrapped`: turning trapping
   * on forgets anything trapped before it.
   */
  it('Itrap On forgets an error trapped before it', () => {
    expect(vals(`${W}\nItrap On\nIwindow Close 7\nItrap On\nPrint Ierrtrap`)).toEqual([0])
  })

  /**
   * `Ierror n` is `move.l (a3)+,d0 / bra L_CustomError`, so it goes through
   * exactly the path an internal error does -- trappable, and it fills in
   * both readers.
   */
  it('Ierror raises one of the extension own errors by number', () => {
    const b = boot(`${W}\nItrap On\nIerror ${E.OOM}\nPrint Ierr;" [";Ierr$;"]"`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe(`${E.OOM} [${IEXT_ERRORS[E.OOM]}]`)
    expect(() => run(`${W}\nIerror ${E.OOM}`)).toThrow(IEXT_ERRORS[E.OOM])
  })

  /**
   * `dclr.b TrapErrors` sits inside `=Ierr$`, between the empty test and the
   * return: asking what went wrong STOPS the next thing going wrong being
   * caught.
   */
  it('reading Ierr$ turns trapping off', () => {
    const rt = run(`${W}\nItrap On\nIerror ${E.OOM}\nA$=Ierr$`)
    expect(rt.iext.trapErrors).toBe(false)
    // so the next error is fatal again
    expect(() => run(`${W}\nItrap On\nIerror ${E.OOM}\nA$=Ierr$\nIwindow Close 7`)).toThrow(IEXT_ERRORS[E.WNO])
  })

  /**
   * `Itrap Off` is `dclr.b TrapErrors` and nothing else --- it leaves
   * `ErrorTrapped` standing, so a program can turn trapping off and still ask
   * what was caught while it was on.
   */
  it('Itrap Off stops trapping and leaves what was already trapped', () => {
    expect(vals(`${W}\nItrap On\nIwindow Close 7\nItrap Off\nPrint Ierrtrap`)).toEqual([-1])
    expect(() => run(`${W}\nItrap On\nItrap Off\nIwindow Close 7`)).toThrow(IEXT_ERRORS[E.WNO])
  })

  /** nothing has gone wrong yet, so there is no message to hand back */
  it('Ierr$ is empty before anything has failed', () => {
    const b = boot(`${W}\nPrint "["+Ierr$+"]"`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[]')
  })

  /**
   * `L_IwaitVbl` is `move.l #1,-(a3) / bra L_Iwait`, so it is the same
   * routine with a count of one -- and `.lp` pumps `DoEvent` before each
   * `WaitTOF`, which is where a close gadget gets noticed during a wait.
   */
  it('Iwait and Iwait Vbl are one routine, and they pump the port', () => {
    expect(() => run(`${W}\nIwait Vbl\nIwait 2`)).not.toThrow()
    const b = boot(`${W}\nIwait 3\nPrint Iwindow Status`)
    b.rt.runHeadless(1)
    b.rt.iext.screens.get(0)!.windows.get(1)!.window.post(0x200, 0)
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(2)
  })

  /**
   * Routine 282: `tst.l $5a(a4) / sne.b d3 / ext.w d3 / ext.l d3`, so a
   * non-zero ReqToolsBase is -1 and nothing else is. ../amiga/reqtools.ts is
   * the library and ../amiga/exec.ts lists it, so the OpenLibrary in
   * `startup.s` succeeds. The same longword decides `rtcall`'s `dtst.l
   * ReqToolsBase / beq L_NoReqTools`, which is why this answer and error 29
   * can never disagree.
   */
  it('Reqtools Here is -1, because the library is here', () => {
    expect(vals('Print Reqtools Here')).toEqual([-1])
  })

  /**
   * `I Flush` drops the rotating cache of `rsc_sizeof` blocks the extension
   * hands strings back out of. Nothing here holds a string that way.
   */
  it('I Flush is a no-op with a reason', () => {
    expect(() => run(`${W}\nI Flush`)).not.toThrow()
  })
})

/* --------------------------------------------------------------------------
 * `gadgets.s`
 * ----------------------------------------------------------------------- */

/** open a screen and a window, which is what every gadget keyword needs */
const SCR = 'Iscreen Open 0,320,200,4,0\nSet Ipens 2,1\n'

/** put the pointer on a window-relative point of window 0 */
function gpoint(rt: Runtime, x: number, y: number): void {
  const w = rt.iext.screens.get(0)!.windows.get(0)!.window
  const scr = rt.screens.get(rt.iext.screens.get(0)!.slot)!
  rt.input.mouseX = scr.screenToHardX(w.leftEdge + x)
  rt.input.mouseY = w.topEdge + y + scr.displayY - scr.offsetY
}

/** press and release the left button over a window-relative point */
function gclick(rt: Runtime, x: number, y: number, hold = false): void {
  gpoint(rt, x, y)
  rt.input.mouseK = 1
  rt.frame()
  if (hold) return
  rt.input.mouseK = 0
  rt.frame()
}

/** the live gadget behind slot `n` of window 0 */
function gad(rt: Runtime, n: number): UserGadget {
  return rt.iext.screens.get(0)!.windows.get(0)!.gadgets[n - 1]!.gad
}

describe('Intuition 1.3b: Reserve Igadget', () => {
  it('allocates n slots and none of them is defined yet', () => {
    const rt = run(`${SCR}Reserve Igadget 4`)
    const w = rt.iext.screens.get(0)!.windows.get(0)!
    expect(w.gadgets.length).toBe(4)
    expect(w.gadgets.every((g) => g === null)).toBe(true)
  })

  it('reserving again throws the first lot away', () => {
    // both forms `bsr L_ReserveIgadget0` first, which frees we_Gadgets
    const rt = run(`${SCR}Reserve Igadget 4 : Set Igadget Hit 1,10,10,20,20 : Reserve Igadget 2`)
    const w = rt.iext.screens.get(0)!.windows.get(0)!
    expect(w.gadgets.length).toBe(2)
    expect(w.window.gadgets.length).toBe(0)
  })

  it('the bare form is the free on its own', () => {
    const rt = run(`${SCR}Reserve Igadget 4 : Reserve Igadget`)
    expect(rt.iext.screens.get(0)!.windows.get(0)!.gadgets.length).toBe(0)
  })

  it('refuses more than 65535, which is error 30', () => {
    // `cmp.l #$10000,d2 / bcc L_TooManyGads`
    const b = boot(`${SCR}Reserve Igadget 65536`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.TMG])
    expect(IEXT_ERRORS[E.TMG]).toBe('Only 65535 gadgets allowed')
  })

  it('a gadget number past the reservation is error 34', () => {
    const b = boot(`${SCR}Reserve Igadget 2 : Set Igadget Hit 3,10,10,20,20`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.GNR])
    expect(IEXT_ERRORS[E.GNR]).toBe('Gadget not reserved')
  })

  it('a reserved but undefined gadget is error 33', () => {
    const b = boot(`${SCR}Reserve Igadget 2 : Igadget On 1`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.GND])
    expect(IEXT_ERRORS[E.GND]).toBe('Gadget not defined')
  })
})

describe('Intuition 1.3b: the boolean gadgets', () => {
  const HIT = `${SCR}Reserve Igadget 2 : Set Igadget Hit 1,10,10,20,20 : Igadget On 1\n`

  it('sits inside the window border, which the keyword adds for you', () => {
    // `move.b wd_BorderLeft(a1),d0 / add.w d0,d6` and the same for the top
    const rt = run(HIT)
    const w = rt.iext.screens.get(0)!.windows.get(0)!
    const g = gad(rt, 1)
    expect(g.leftEdge).toBe(10 + w.window.borderLeft)
    expect(g.topEdge).toBe(10 + w.window.borderTop)
    expect([g.width, g.height]).toEqual([20, 20])
    expect(g.id).toBe(1)
  })

  it('carries the two-border bevel Set Ipens named, and a swapped pair for SELECTED', () => {
    const rt = run(HIT)
    const g = gad(rt, 1)
    // `(w-1,0) - (0,0) - (0,h-1)` in the hilite pen, `(w-1,0) - (w-1,h-1) -
    // (0,h-1)` in the shadow pen, and gg_SelectRender is the two swapped
    expect(g.borders!.map((b) => b.pen)).toEqual([2, 1])
    expect(g.selectBorders!.map((b) => b.pen)).toEqual([1, 2])
    expect(g.borders![0]!.xy).toEqual([19, 0, 0, 0, 0, 19])
    expect(g.borders![1]!.xy).toEqual([19, 0, 19, 19, 0, 19])
  })

  it('a size under 4x4 is error 13', () => {
    const b = boot(`${SCR}Reserve Igadget 1 : Set Igadget Hit 1,10,10,3,20`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })

  it('a gadget that will not fit inside the window is error 13', () => {
    const b = boot(`${SCR}Reserve Igadget 1 : Set Igadget Hit 1,10,10,400,20`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })

  it('Igadget On adds it to the window and Igadget Off takes it away', () => {
    const rt = run(HIT)
    const w = rt.iext.screens.get(0)!.windows.get(0)!
    expect(w.window.gadgets.length).toBe(1)
    run(`${HIT}Igadget Off 1`)
    const off = run(`${HIT}Igadget Off 1`)
    expect(off.iext.screens.get(0)!.windows.get(0)!.window.gadgets.length).toBe(0)
  })

  it('=Igadget Read counts a hit-select press and gives it back once', () => {
    // `ge_HitCount` is filled by DoEvent's GADGETDOWN arm and taken down one
    // at a time, so a program that misses a frame still sees every click
    const b = boot(`${HIT}Repeat : Iwait Vbl : A=Igadget Read(1) : Until A<>0\nB=Igadget Read(1) : Print A;" ";B`)
    b.rt.frame()
    const g = gad(b.rt, 1)
    gclick(b.rt, g.leftEdge + 5, g.topEdge + 5)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([-1, 0])
  })

  it('a toggle flips on the press and stays flipped', () => {
    const b = boot(
      `${SCR}Reserve Igadget 1 : Set Igadget Toggle 1,10,10,20,20 : Igadget On 1\n` +
        `Repeat : Iwait Vbl : A=Igadget Read(1) : Until A<>0\nPrint A`,
    )
    b.rt.frame()
    const g = gad(b.rt, 1)
    gclick(b.rt, g.leftEdge + 5, g.topEdge + 5)
    expect((gad(b.rt, 1).flags! & 0x80) !== 0).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-1')
  })

  it('Set Igadget Toggle takes an initial state', () => {
    const rt = run(`${SCR}Reserve Igadget 1 : Set Igadget Toggle 1,10,10,20,20,-1`)
    expect((gad(rt, 1).flags! & 0x80) !== 0).toBe(true)
  })

  it('=Igadget Down is true only between a press and its release', () => {
    // GEF_GADGETDOWN is the extension's own flag, set by DoEvent's GADGETDOWN
    // arm and cleared by its GADGETUP one, so it reads true only while the
    // button is held AND only once the program has pumped the port
    const b = boot(`${HIT}Repeat : Iwait Vbl : D=Igadget Down(1) : Until D<>0\nPrint D`)
    b.rt.frame()
    const g = gad(b.rt, 1)
    gclick(b.rt, g.leftEdge + 5, g.topEdge + 5, true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-1')
  })

  it('Igadget Inactive ghosts it and Igadget Active brings it back', () => {
    const rt = run(`${HIT}Igadget Inactive 1`)
    expect((gad(rt, 1).flags! & 0x100) !== 0).toBe(true)
    const back = run(`${HIT}Igadget Inactive 1 : Igadget Active 1`)
    expect((gad(back, 1).flags! & 0x100) !== 0).toBe(false)
  })

  it('a disabled gadget refuses the click outright', () => {
    const b = boot(`${HIT}Igadget Inactive 1\nA=Igadget Read(1) : Print A`)
    b.rt.frame()
    const g = gad(b.rt, 1)
    gclick(b.rt, g.leftEdge + 5, g.topEdge + 5)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('0')
  })
})

describe('Intuition 1.3b: Set Ipens', () => {
  it('is read when a gadget is MADE, so changing it later changes nothing', () => {
    const rt = run(
      `${SCR}Reserve Igadget 2 : Set Igadget Hit 1,10,10,20,20 : Set Ipens 3,0 : Set Igadget Hit 2,40,10,20,20`,
    )
    expect(gad(rt, 1).borders!.map((b) => b.pen)).toEqual([2, 1])
    expect(gad(rt, 2).borders!.map((b) => b.pen)).toEqual([3, 0])
  })

  it('takes either pen on its own and refuses one over 255', () => {
    const rt = run(`${SCR}Set Ipens 5`)
    const w = rt.iext.screens.get(0)!.windows.get(0)!
    expect([w.hilitePen, w.shadowPen]).toEqual([5, 1])
    const b = boot(`${SCR}Set Ipens 256`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })
})

describe('Intuition 1.3b: the sliders', () => {
  const SL = `${SCR}Reserve Igadget 2 : Set Igadget Hslider 1,10,100,200,10,256,0,40,8 : Igadget On 1\n`

  it('turns units, size and overlap into a Body and a Pot', () => {
    // Church's own comment: `Body = ((visible - overlap) * MAXBODY) / (total
    // - overlap)` and `Pot = (position * MAXPOT) / hidden`
    const rt = run(SL)
    const p = gad(rt, 1).prop!
    expect(p.horizBody).toBe(Math.trunc(((40 - 8) * 0xffff) / (256 - 8)))
    expect(p.horizPot).toBe(0)
    expect(p.flags).toBe(0x1 | 0x2)
  })

  it('a slider whose size covers its units gets a full Body and no Pot', () => {
    const rt = run(`${SCR}Reserve Igadget 1 : Set Igadget Hslider 1,10,100,200,10,16,0,16,0`)
    const p = gad(rt, 1).prop!
    expect(p.horizBody).toBe(0xffff)
    expect(p.horizPot).toBe(0)
  })

  it('a vertical one fills the vertical fields and takes FREEVERT', () => {
    // DEVIATION: `$68ca` writes pi_HorizBody and pi_HorizPot in the VERTICAL
    // arm of the nothing-hidden case, and the direction flag is read off the
    // high word of a saved a4. Both are recorded in status.ts and neither is
    // reproduced
    const rt = run(`${SCR}Reserve Igadget 1 : Set Igadget Vslider 1,10,60,10,80,1000,321,25,1`)
    const p = gad(rt, 1).prop!
    expect(p.flags).toBe(0x1 | 0x4)
    expect(p.vertBody).toBe(Math.trunc(((25 - 1) * 0xffff) / (1000 - 1)))
    expect(p.vertPot).toBe(Math.trunc((321 * 0xffff) / (1000 - 25)))
    expect(p.horizBody).toBe(0)
  })

  it('carries the four-border groove L_MakeSlider draws', () => {
    const rt = run(SL)
    const g = gad(rt, 1)
    expect(g.borders!.length).toBe(4)
    expect(g.borders!.map((b) => b.pen)).toEqual([2, 2, 1, 1])
    expect(g.borders![0]!.xy).toEqual([1, 1, 1, 8])
  })

  it('=Igadget Read turns the Pot back into units', () => {
    const rt = run(`${SL}Set Igadget Value 1,64`)
    const p = gad(rt, 1).prop!
    expect(p.horizPot).toBe(Math.trunc((64 * 0xffff) / (256 - 40)))
    const b = boot(`${SL}Set Igadget Value 1,64\nPrint Igadget Read(1)`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('64')
  })

  it('Set Igadget Value clamps to units less the knob', () => {
    const b = boot(`${SL}Set Igadget Value 1,9999\nPrint Igadget Read(1)`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('216')
  })

  it('dragging the knob moves the position', () => {
    const b = boot(SL)
    b.rt.frame()
    const g = gad(b.rt, 1)
    // press on the knob, then drag to the far right of the container
    gpoint(b.rt, g.leftEdge + 2, g.topEdge + 5)
    b.rt.input.mouseK = 1
    b.rt.frame()
    gpoint(b.rt, g.leftEdge + g.width + 40, g.topEdge + 5)
    b.rt.frame()
    expect(gad(b.rt, 1).prop!.horizPot).toBe(0xffff)
    b.rt.input.mouseK = 0
    b.rt.frame()
  })
})

describe('Intuition 1.3b: the string and integer gadgets', () => {
  const ST = `${SCR}Reserve Igadget 2 : Set Igadget String 1,30,10,240,,30,"SillyFilename",1 : Igadget On 1\n`

  it('shrinks the box to sit inside its own border', () => {
    // `addq.w #4,d6 / addq.w #2,d5 / subq.w #8,d4 / subq.w #4,d3`
    const rt = run(ST)
    const w = rt.iext.screens.get(0)!.windows.get(0)!
    const g = gad(rt, 1)
    expect(g.leftEdge).toBe(30 + w.window.borderLeft + 4)
    expect(g.topEdge).toBe(10 + w.window.borderTop + 2)
    expect(g.width).toBe(240 - 8)
  })

  it('takes its height from the font when the argument is left out', () => {
    // `cmp.l #Null,d3 / beq` then `rp_TxHeight + 4`
    const rt = run(ST)
    expect(gad(rt, 1).height).toBe(8 + 4 - 4)
  })

  it('si_MaxChars counts the NUL, so the field is one shorter than the size', () => {
    const rt = run(`${SCR}Reserve Igadget 1 : Set Igadget String 1,30,10,240,,4,"abcdef"`)
    const si = gad(rt, 1).strInfo!
    expect(si.maxChars).toBe(5)
    expect(si.buffer).toBe('abcd')
  })

  it('strpos 1 centres and 2 right-justifies, and 3 is error 13', () => {
    expect(gad(run(ST), 1).activation! & 0x200).toBe(0x200)
    const right = run(`${SCR}Reserve Igadget 1 : Set Igadget String 1,30,10,240,,30,"x",2`)
    expect(gad(right, 1).activation! & 0x400).toBe(0x400)
    const b = boot(`${SCR}Reserve Igadget 1 : Set Igadget String 1,30,10,240,,30,"x",3`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })

  it('a width under 32 is error 13', () => {
    const b = boot(`${SCR}Reserve Igadget 1 : Set Igadget String 1,30,10,31,,30`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })

  it('=Igadget Read$ hands the buffer back, and =Igadget Read is error 32', () => {
    const b = boot(`${ST}Print "[";Igadget Read$(1);"]"`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[SillyFilename]')
    const bad = boot(`${ST}Print Igadget Read(1)`)
    expect(() => mustFinish(bad.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.WGT])
  })

  it('Set Igadget Value$ replaces the buffer and cuts it to size', () => {
    const b = boot(`${ST}Set Igadget Value$ 1,"Another"\nPrint "[";Igadget Read$(1);"]"`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[Another]')
  })

  it('typing into an active string gadget edits its buffer', () => {
    const b = boot(ST)
    b.rt.frame()
    const g = gad(b.rt, 1)
    gclick(b.rt, g.leftEdge + 1, g.topEdge + 2)
    b.rt.pressKey('Z', 0)
    b.rt.frame()
    expect(gad(b.rt, 1).strInfo!.buffer).toBe('ZSillyFilename')
  })

  it('an integer gadget is a string gadget with LONGINT and a twelve-byte buffer', () => {
    // "-1234567890 plus trailing null" is the author's own comment
    const rt = run(`${SCR}Reserve Igadget 1 : Set Igadget Int 1,30,24,100,,-1234567890,2`)
    const g = gad(rt, 1)
    expect(g.activation! & 0x800).toBe(0x800)
    expect(g.strInfo!.maxChars).toBe(12)
    expect(g.strInfo!.buffer).toBe('-1234567890')
  })

  it('=Igadget Read gives the long back, and =Igadget Read$ is error 32', () => {
    const b = boot(`${SCR}Reserve Igadget 1 : Set Igadget Int 1,30,24,100,,-42\nPrint Igadget Read(1)`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-42')
    const bad = boot(`${SCR}Reserve Igadget 1 : Set Igadget Int 1,30,24,100,,-42\nPrint Igadget Read$(1)`)
    expect(() => mustFinish(bad.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.WGT])
  })

  it('Set Igadget Value reformats an integer gadget and refuses a hit-select', () => {
    const b = boot(
      `${SCR}Reserve Igadget 2 : Set Igadget Int 1,30,24,100,,1 : Set Igadget Value 1,-2147483648\n` +
        `Print "[";Igadget Read(1);"]"`,
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[-2147483648]')
    const hit = boot(`${SCR}Reserve Igadget 1 : Set Igadget Hit 1,10,10,20,20 : Set Igadget Value 1,1`)
    expect(() => mustFinish(hit.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })
})

/**
 * `screens.s`'s copy family, the two keywords that move a screen, and the
 * four coordinate converters.
 *
 * Six routines end in the same `move.b #$c0,d6 / moveq #-1,d7 / WaitBlit /
 * BltBitMap` and differ only in where each end of the blit comes from. Each
 * keyword is two routines --- the token table names one and hangs an unnamed
 * `I0,0,0,0,0t0,0,0` continuation beside it pointing at the routine below ---
 * so `Iscreen Copy` is 37 for `a To b` and 36 for the rectangle.
 */
describe('Intuition 1.3b: moving screens and their pixels', () => {
  /** the ./screen.ts Screen behind an Iscreen number */
  const sc = (rt: Runtime, n: number) => rt.screens.get(rt.iext.screens.get(n)!.slot)!

  /**
   * `sub.w sc_LeftEdge(a2),d5` makes a delta and MoveScreen applies it, so
   * the argument is an absolute position in the Intuition display. Zero is
   * the display's top-left corner, which is 128,44 in this port's hardware
   * coordinates.
   */
  it('Iscreen Display positions a screen off the display corner', () => {
    const rt = run('Iscreen Open 0,320,200,16,0\nIscreen Display 0,40,60,,')
    expect([sc(rt, 0).displayX, sc(rt, 0).displayY]).toEqual([168, 104])
  })

  /** `tst.w d5 / bpl .xpos / moveq #0,d5` on each axis */
  it('a negative position is floored at zero', () => {
    const rt = run('Iscreen Open 0,320,200,16,0\nIscreen Display 0,-40,-60,,')
    expect([sc(rt, 0).displayX, sc(rt, 0).displayY]).toEqual([128, 44])
  })

  /** an omitted coordinate is `moveq #0,d5`, a zero DELTA rather than a zero */
  it('an omitted coordinate leaves that axis where it was', () => {
    const rt = run('Iscreen Open 0,320,200,16,0\nIscreen Display 0,40,60,,\nIscreen Display 0,,90,,')
    expect([sc(rt, 0).displayX, sc(rt, 0).displayY]).toEqual([168, 134])
  })

  /** `move.w d3,sc_Width(a2)` and `move.w d3,sc_ViewPort+vp_DWidth(a2)` */
  it('the width goes into sc_Width and vp_DWidth together', () => {
    const rt = run('Iscreen Open 0,320,200,16,0\nIscreen Display 0,,,200,')
    expect(rt.iext.screens.get(0)!.scWidth).toBe(200)
    expect(sc(rt, 0).displayW).toBe(200)
  })

  /**
   * DEFECT: `move.w d3,$46(a2)` at $2004 writes the WIDTH into `vp_DHeight`.
   * With no width given d3 still holds AMOS's `Null`, $80000000, so what
   * reaches the display height is that value's low word --- zero.
   */
  it('DEFECT: a height on its own sets sc_Height and blanks vp_DHeight', () => {
    const rt = run('Iscreen Open 0,320,200,16,0\nIscreen Display 0,,,,100')
    expect(rt.iext.screens.get(0)!.scHeight).toBe(100)
    expect(sc(rt, 0).displayH).toBe(0)
  })

  /** the same instruction with a width to carry: 200 lines of a screen 100 high */
  it('DEFECT: with both given vp_DHeight takes the width', () => {
    const rt = run('Iscreen Open 0,320,200,16,0\nIscreen Display 0,,,200,100')
    expect(rt.iext.screens.get(0)!.scHeight).toBe(100)
    expect(sc(rt, 0).displayH).toBe(200)
  })

  /** `cmp.w se_Width(a0),d3 / bhi L_IllFunc` --- routine 140, error 13 */
  it('a width over se_Width is error 13', () => {
    const b = boot('Iscreen Open 0,320,200,16,0\nIscreen Display 0,,,321,')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })

  /**
   * DEFECT: `cmp.w $12(a0),d3` at $1ff8 is the height ceiling reading the
   * WIDTH register. A width of 320 on a screen 100 high fails a test the
   * height never took part in, and it fails AFTER `sc_Width` has been
   * written --- the arms run in order.
   */
  it('DEFECT: the height ceiling compares the width against se_Height', () => {
    const b = boot('Iscreen Open 0,320,100,16,0\nIscreen Display 0,,,320,50')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
    expect(b.rt.iext.screens.get(0)!.scWidth).toBe(320)
    expect(b.rt.iext.screens.get(0)!.scHeight).toBe(100)
  })

  /** `move.w d3,ri_RxOffset(a1)` behind `cmp.l #Null,d3 / beq` */
  it('Iscreen Offset writes the RasInfo offsets and keeps an omitted one', () => {
    const rt = run('Iscreen Open 0,640,400,16,0\nIscreen Offset 0,32,64\nIscreen Offset 0,,80')
    expect([sc(rt, 0).offsetX, sc(rt, 0).offsetY]).toEqual([32, 80])
  })

  const TWO = 'Iscreen Open 0,320,200,16,0\nIscreen Open 1,320,200,16,0\n'

  it('Iscreen Copy a To b moves the whole source screen', () => {
    expect(
      vals(
        `${TWO}Set Iscreen 0 : Iplot 10,10,5 : Iplot 300,190,7\n` +
          'Iscreen Copy 0 To 1\nSet Iscreen 1\nPrint Ipoint(10,10);" ";Ipoint(300,190)',
      ),
    ).toEqual([5, 7])
  })

  /** `sub.w d1,d5 / addq.w #1,d5` --- the rectangle is inclusive at both ends */
  it('the rectangle form copies x1,y1-x2,y2 to x,y', () => {
    expect(
      vals(
        `${TWO}Set Iscreen 0 : Iplot 10,10,5 : Iplot 19,19,6\n` +
          'Iscreen Copy 0,10,10,19,19 To 1,100,100\nSet Iscreen 1\n' +
          'Print Ipoint(100,100);" ";Ipoint(109,109);" ";Ipoint(99,99)',
      ),
    ).toEqual([5, 6, 0])
  })

  /**
   * The short form's size is `move.w sc_Width(a0),d4 / move.w sc_Height(a0),d5`
   * at $23c0 --- the DISPLAYED size, so narrowing the source with `Iscreen
   * Display` narrows what copying it whole moves.
   */
  it('Iscreen Copy a To b takes its size from sc_Width', () => {
    expect(
      vals(
        `${TWO}Set Iscreen 0 : Iplot 10,10,5 : Iplot 150,10,6\n` +
          'Iscreen Display 0,,,100,\nIscreen Copy 0 To 1\nSet Iscreen 1\n' +
          'Print Ipoint(10,10);" ";Ipoint(150,10)',
      ),
    ).toEqual([5, 0])
  })

  /**
   * `moveq #-1,d7` asks for every plane, so the DEPTHS bound the blit:
   * `min(srcDepth, dstDepth)` planes move and the destination keeps whatever
   * it had above them (AROS `rom/graphics/bltbitmap.c`:137-140). Four planes
   * into two drops pen 5 to 1; one plane over a pen 12 leaves 13.
   */
  it('BltBitMap moves min(srcDepth, dstDepth) planes', () => {
    expect(
      vals(
        'Iscreen Open 0,320,200,16,0\nIscreen Open 1,320,200,4,0\n' +
          'Set Iscreen 0 : Iplot 10,10,5\nIscreen Copy 0 To 1\nSet Iscreen 1\nPrint Ipoint(10,10)',
      ),
    ).toEqual([1])
    expect(
      vals(
        'Iscreen Open 0,320,200,4,0\nIscreen Open 1,320,200,16,0\n' +
          'Set Iscreen 1 : Iplot 10,10,12\nSet Iscreen 0 : Iplot 10,10,1\n' +
          'Iscreen Copy 0 To 1\nSet Iscreen 1\nPrint Ipoint(10,10)',
      ),
    ).toEqual([13])
  })

  /**
   * `Amos Iscreen Copy` builds a `struct BitMap` at $224(a4) from the AMOS
   * screen --- six plane pointers out of `EcCurrent`, `EcTx` shifted right
   * three for the row length, `EcTy` for the rows, and `move.b d6,$5(a0)`
   * for the depth.
   */
  it('Amos Iscreen Copy brings an AMOS screen over', () => {
    expect(
      vals(
        'Screen Open 0,320,200,16,0 : Ink 5 : Plot 10,10\n' +
          'Iscreen Open 1,320,200,16,0\nAmos Iscreen Copy 0 To 1\nSet Iscreen 1\nPrint Ipoint(10,10)',
      ),
    ).toEqual([5])
    expect(
      vals(
        'Screen Open 0,320,200,16,0 : Ink 5 : Plot 10,10\n' +
          'Iscreen Open 1,320,200,16,0\nAmos Iscreen Copy 0,10,10,19,19 To 1,40,40\n' +
          'Set Iscreen 1\nPrint Ipoint(40,40);" ";Ipoint(10,10)',
      ),
    ).toEqual([5, 0])
  })

  /**
   * DEFECT: $270a and $27ba are `move.w $50(a0),$5(a1)` --- EcNPlan written
   * as a word to a byte field at an ODD address. This machine is a 68020 and
   * allows it, and big-endian order then puts the plane count's high byte,
   * zero, into `bm_Depth`. BltBitMap is handed a destination of no planes
   * and moves nothing. On a 68000 the same instruction is an address error.
   */
  it('DEFECT: Iscreen Amos Copy writes a zero depth and copies nothing', () => {
    expect(
      vals(
        'Screen Open 0,320,200,16,0 : Ink 3 : Plot 10,10\n' +
          'Iscreen Open 1,320,200,16,0\nSet Iscreen 1 : Iplot 10,10,7\n' +
          'Iscreen Amos Copy 1 To 0\nPrint Point(10,10)',
      ),
    ).toEqual([3])
  })

  /**
   * `FindAscr` is `cmp.l #7,d0 / bhi Ascr0to7`, error 35, and a number in
   * range with no screen open falls out as the caller's `beq L_NoScr`, 16.
   * The destination is the first argument popped, so it is checked first:
   * `Iscreen Amos Copy 99 To 8` answers for the 8 and never looks at the 99.
   */
  it('an AMOS screen number is checked for range, for open, and first', () => {
    const over = boot('Iscreen Open 0,320,200,16,0\nAmos Iscreen Copy 8 To 0')
    expect(() => mustFinish(over.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.ASN])
    const shut = boot('Iscreen Open 0,320,200,16,0\nAmos Iscreen Copy 6 To 0')
    expect(() => mustFinish(shut.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.SNO])
    const order = boot('Iscreen Amos Copy 99 To 8')
    expect(() => mustFinish(order.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.ASN])
  })

  /**
   * `moveq #SUPERHIRES,d2 / and.w d1,d2` then `move.w #HIRES,d2`, and the Y
   * pair test LACED on its own. The offset added afterwards is the
   * ViewLord's, which is zero on this machine.
   */
  it('the coordinate pairs shift by resolution and nothing else', () => {
    expect(
      vals('Iscreen Open 0,320,200,16,0\nPrint X Ihard(100);" ";X Iscreen(100);" ";Y Ihard(100);" ";Y Iscreen(100)'),
    ).toEqual([100, 100, 100, 100])
    expect(vals('Iscreen Open 0,640,200,16,Hires\nPrint X Ihard(100);" ";X Iscreen(50)')).toEqual([50, 100])
    expect(vals('Iscreen Open 0,1280,200,16,Hires+Superhires\nPrint X Ihard(100);" ";X Iscreen(25)')).toEqual([
      25, 100,
    ])
    expect(vals('Iscreen Open 0,320,400,16,Laced\nPrint Y Ihard(100);" ";Y Iscreen(50)')).toEqual([50, 100])
  })

  /** `sc_LeftEdge` is not in any of the four, so moving the screen changes nothing */
  it('a moved screen still converts as though it sat at the display corner', () => {
    expect(vals('Iscreen Open 0,640,200,16,Hires\nIscreen Display 0,100,20,,\nPrint X Ihard(100)')).toEqual([50])
  })

  /** `lsr.w #1,d3` on a register the argument arrived in as a longword */
  it('the shift is a word one under a high word that rides through', () => {
    expect(vals('Iscreen Open 0,640,200,16,Hires\nPrint X Ihard(-2);" ";X Ihard(65536)')).toEqual([-32769, 65536])
  })

  /** all four open with `jtcall GetCurIscr`, so they need a screen */
  it('the converters need a current screen', () => {
    const b = boot('Print X Ihard(0)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.SNO])
  })
})

/**
 * `color.s`'s two palette getters and the two icon keywords, which between
 * them carry five defects and one keyword that cannot be used at all.
 *
 * The banks are AMOS's own --- bank 1 for objects, bank 2 for icons --- so
 * every one of these reaches across to the AMOS side for its data and writes
 * to the Intuition side.
 */
describe('Intuition 1.3b: icons and bank palettes', () => {
  /** an icon bank with a known palette: Get Icon snapshots the live screen */
  const BANK = 'Screen Open 0,320,200,32,Lowres\nColour 0,$100 : Colour 31,$FFF\nGet Icon 1,0,0 To 16,8\n'
  const ISCR = 'Iscreen Open 0,320,200,32,0\n'

  /**
   * `moveq #$0,d0 / move.w (a0)+,d0 / lsl.l #$3,d0 / adda.l d0,a0` walks the
   * count and its pointer pairs, so the palette is `bank + 2 + count * 8`,
   * and the plain form is one `LoadRGB4(vp, that, 32)`.
   */
  it('Iget Icon Palette loads the bank palette in order', () => {
    expect(vals(`${BANK}${ISCR}Iget Icon Palette\nPrint Icolour(0);" ";Icolour(31)`)).toEqual([0x100, 0xfff])
  })

  /**
   * DEFECT: the masked form counts `moveq #$1f,d5` DOWN while `move.w
   * (a5)+,d1` reads UP, and uses d5 for both the mask bit and the
   * destination colour. Entry 0 lands on colour 31. So the two forms of one
   * keyword disagree about every colour but the middle pair.
   */
  it('DEFECT: giving a mask loads the same palette backwards', () => {
    expect(vals(`${BANK}${ISCR}Iget Icon Palette 0\nPrint Icolour(0);" ";Icolour(31)`)).toEqual([0xfff, 0x100])
  })

  /**
   * DEFECT: `btst d5,d4 / bne .next` skips a colour whose bit is SET. The
   * guide says the opposite -- "if you just wanted to get colours 1, 2, 6,
   * and 8, and leave the other colours alone, you could use: Iget Icon
   * Palette %101000110" -- and AMOS's own Get Icon Palette agrees with the
   * guide. So bit 0 here means "leave colour 0 alone".
   */
  it('DEFECT: a set mask bit skips its colour instead of copying it', () => {
    expect(vals(`${BANK}${ISCR}Set Icolour 0,$777\nIget Icon Palette 1\nPrint Icolour(0);" ";Icolour(31)`)).toEqual([
      0x777, 0x100,
    ])
  })

  /** bank 1 and `btst #$2,d0` for objects, bank 2 and `btst #$3,d0` for icons */
  it('Iget Sprite Palette reads bank 1 and answers 24 without one', () => {
    expect(
      vals(
        'Screen Open 0,320,200,32,Lowres\nColour 7,$0F0\nGet Sprite 1,0,0 To 16,8\n' +
          `${ISCR}Iget Sprite Palette\nPrint Icolour(7)`,
      ),
    ).toEqual([0x0f0])
    const noObj = boot(`${ISCR}Iget Sprite Palette`)
    expect(() => mustFinish(noObj.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.NOB])
    const noIcon = boot(`${ISCR}Iget Icon Palette`)
    expect(() => mustFinish(noIcon.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.NIB])
  })

  const ICON = 'Screen Open 0,320,200,16,Lowres\nInk 5 : Bar 0,0 To 15,7 : Get Icon 1,0,0 To 16,8\n'

  /**
   * Routine 204 builds a BitMap from the icon header and blits it with
   * minterm $c0. `Rbsr routine 184` is Ilocate Gr, which is the guide's
   * "The graphics pointer is left at the top left corner of the icon image."
   */
  it('Ipaste Icon stamps the icon and leaves the cursor on its corner', () => {
    expect(
      vals(`${ICON}Iscreen Open 0,320,200,16,0\nIpaste Icon 20,20,1\nPrint Ipoint(22,22);" ";Ixgr;" ";Iygr`),
    ).toEqual([5, 20, 20])
  })

  /** `jtcall FindIcon / beq L_NoIcon` runs BEFORE the Ilocate Gr */
  it('a missing icon is error 20 and never moves the cursor', () => {
    const b = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIpaste Icon 20,20,4`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IND])
  })

  /**
   * `move.l a2,d7 / bne .mask` picks BltMaskBitMapRastPort with minterm $e0
   * over the plain $c0, and colour 0 is what the mask covers. `Make Icon
   * Mask` is what gives an icon one.
   */
  it('Make Icon Mask makes colour 0 transparent to Ipaste Icon', () => {
    // half a 16x8 icon: pen 5 on the left, colour 0 on the right
    const HALF = 'Screen Open 0,320,200,16,Lowres : Cls 0\nInk 5 : Bar 0,0 To 7,7 : Get Icon 1,0,0 To 16,8\n'
    const over = 'Iscreen Open 0,320,200,16,0\nIink 3 : Ibar 0,0 To 40,40\nIpaste Icon 20,20,1\n'
    expect(vals(`${HALF}${over}Print Ipoint(21,22);" ";Ipoint(30,22)`)).toEqual([5, 0])
    expect(vals(`${HALF}Make Icon Mask 1\n${over}Print Ipoint(21,22);" ";Ipoint(30,22)`)).toEqual([5, 3])
  })

  /** the paste is relative to the current WINDOW, not the screen */
  it('Ipaste Icon draws through the current window origin', () => {
    const rt = run(`${ICON}Iscreen Open 0,320,200,16,0\nIwindow Open 1,40,30,200,100,""\nIpaste Icon 10,20,1`)
    const sc = rt.screens.get(rt.iext.screens.get(0)!.slot)!
    expect(sc.rp.bitMap.pixelAt(50, 50)).toBe(5)
    expect(sc.rp.bitMap.pixelAt(49, 50)).toBe(0)
  })

  /**
   * DEFECT: `Iget Icon` cannot grab anything. Each coordinate goes through
   * `cmp.l #$7fff,dN / bgt.b +4 / <Rble routine 140>`, and AMOS's loader
   * pokes the marker's own condition into the branch (`+B.s`:2611 GRouB
   * takes the opcode word from `GRout + kind*8 + 4`, and kind 12's is `ble
   * GRout`). What runs is `bgt.b over / ble.w L_IllFunc`, so anything NOT
   * above 32767 answers error 13 -- every coordinate a program would write.
   * The guide's own example, `Iget Icon 1,0,0 To 15,11`, is one of them.
   */
  it('DEFECT: Iget Icon answers error 13 to any usable coordinate', () => {
    const b = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIget Icon 1,0,0 To 15,11`)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
  })

  /** the bank and the icon number are checked before the gate */
  it('the icon bank and the number are checked first', () => {
    const noBank = boot('Iscreen Open 0,320,200,16,0\nIget Icon 1,0,0 To 15,11')
    expect(() => mustFinish(noBank.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.NIB])
    for (const n of [0, 70000]) {
      const bad = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIget Icon ${n},0,0 To 15,11`)
      expect(() => mustFinish(bad.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IFC])
    }
  })

  /**
   * DEFECT: past the gate, `$7d4e cmp.w d3,d5 / Rbcs routine 164` raises
   * "Backward coordinates" when y1 is BELOW y2 -- the normal order. Only a
   * coordinate over 32767 gets far enough to show it, which is the only
   * reason this is visible at all.
   */
  it('DEFECT: the backward-coordinates test fires on the forward order', () => {
    const fwd = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIget Icon 1,65536,65536 To 65545,65545`)
    expect(() => mustFinish(fwd.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.BWC])
    const back = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIget Icon 1,65545,65545 To 65536,65536`)
    expect(() => mustFinish(back.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.IND])
  })

  /**
   * The longer forms name a source: routine 284 takes the screen's BASE
   * window off `se_BaseWin`, 285 walks the list with FindIwin2. Both PEEK at
   * their extra arguments -- `move.l 20(a3),d0` with no pop -- and drop them
   * after the shared body has taken the last five.
   */
  it('the screen and window forms are resolved before anything else', () => {
    const noScr = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIget Icon 9,1,0,0 To 15,11`)
    expect(() => mustFinish(noScr.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.SNO])
    const noWin = boot(`${ICON}Iscreen Open 0,320,200,16,0\nIget Icon 0,7,1,0,0 To 15,11`)
    expect(() => mustFinish(noWin.rt.runHeadless(2_000))).toThrow(IEXT_ERRORS[E.WNO])
  })
})
