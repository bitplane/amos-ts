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
    expect(vals(`${W}\nIcolour 1,$F00\nPrint Hex$(Icolour(1))`)).toEqual([NaN])
    expect(() => run(`${W}\nIcolour 99,0`)).toThrow(IEXT_ERRORS[E.IFC])
    expect(() => run(`${W}\nPrint Icolour(99)`)).toThrow(IEXT_ERRORS[E.IFC])
  })

  /**
   * `Ipalette` does nothing at all. `color.s` carries the real one behind
   * `ifne 0` with the author's reason above it -- "Ipalette disabled because
   * it's unstable" -- and what shipped is `L_Ipalette0`, "just a stub".
   * Routine 52 in the binary is two bytes long and they are an `rts`.
   */
  it('Ipalette is a stub that shipped as one', () => {
    expect(vals(`${W}\nIcolour 1,$F00\nIpalette 3\nPrint Hex$(Icolour(1))`)).toEqual([NaN])
    const rt = run(`${W}\nIcolour 1,$F00\nIpalette $0F0`)
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
   * `L_IwaitEvent` pumps the port and answers the CLASS, storing the
   * message's other half in `EventData` before it tests anything.
   */
  it('Iwait Event answers the IDCMP class and keeps the data', () => {
    const b = boot(`${W}\nE=Iwait Event\nPrint E;" ";Ievent Data`)
    b.rt.runHeadless(1)
    const w = b.rt.iext.screens.get(0)!.windows.get(1)!
    expect(w.window.post(0x200 /* IDCMP_CLOSEWINDOW */, 7)).toBe(true)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([0x200, 7])
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

  /** `L_IwaitMouse` is `.lp` around `GetMouse`, the mirror of `Iwait Key` */
  it('Iwait Mouse waits for a button', () => {
    const b = boot(`${W}\nIwait Mouse\nPrint Imouse Key`)
    b.rt.frame()
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(1)
  })

  /** `=Imouse Key` pumps GetMouse and then reads `MouseState` */
  it('Imouse Key is the button state', () => {
    const b = boot(`${W}\nPrint Imouse Key`)
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(500))
    expect(Number(b.out().trim())).toBe(1)
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
   * DEVIATION: `dtst.l ReqToolsBase / sne d3`, and this port has no reqtools
   * -- so 0, which is the answer a machine without the library gives and the
   * one the guide tells a program to branch on.
   */
  it('Reqtools Here is 0, which is a real answer', () => {
    expect(vals('Print Reqtools Here')).toEqual([0])
  })

  /**
   * `I Flush` drops the rotating cache of `rsc_sizeof` blocks the extension
   * hands strings back out of. Nothing here holds a string that way.
   */
  it('I Flush is a no-op with a reason', () => {
    expect(() => run(`${W}\nI Flush`)).not.toThrow()
  })
})
