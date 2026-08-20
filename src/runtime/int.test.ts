/**
 * Int 1.0, against `AMOSPRO_Int.Lib` disassembled with `extdis int-1.0`.
 *
 * The extension ships two documents and neither says what a keyword does, so
 * every expectation here comes from the code or from one of the eighteen
 * example programs in the archive. Where an example is the source it is
 * quoted at the test.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { INT_ERR, INT_ERRORS } from './int'
import { BARLABEL, NM, NOSUB, fullMenuNum } from '../amiga/gadtools'
import { IDCMP_CLOSEWINDOW, IDCMP_MENUPICK, WB_SLOT } from '../amiga/intuition'
import { keyboardSdr } from '../amiga/keyboard'
import { encodeIlbm, parseIlbm } from '../amiga/ilbm'
import { AmigaFS } from '../amiga/vfs'
import { BTN_RED, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from '../amiga/controller'

const table = new TokenTable(CORE_TOKENS)
/** slot 25 — "alter extension number 25 to :APSystem/AMOSPro_Int.Lib" */
const ext = extensionById('int-1.0')!
const exts = new Map([[25, ext.table]])

function boot(src: string, files?: Record<string, Uint8Array>): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[25, ext]]),
    maxSteps: 3_000_000,
    onText: (t) => (out += t),
    ...(files ? { fs: { read: (p: string) => files[p] ?? null } } : {}),
  })
  return { rt, out: () => out }
}

function run(src: string): Runtime {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(2_000))
  return b.rt
}

function val(expr: string, before = 'Rem'): number {
  const b = boot(`${before} : Print ${expr}`)
  mustFinish(b.rt.runHeadless(2_000))
  return Number(b.out().trim())
}

/** what bool_gadgets.AMOS opens with: a sizeable, draggable, closeable window */
const FLAGS = 'Wb Window Flags $1,$2,$4,$8,$1400,0,0,0,0'
const IDS = 'Wb Window Ids $200,$40,$8,0,0,0,0,0,0'

describe('Int 1.0: the two masks', () => {
  /**
   * Nine arguments, added. The examples say why: "If Using More Than 9 Flags
   * Just Add Flags Together / Eg $400+$1000=$1400", so one flag per argument
   * is the intended shape and the sum is the mechanism.
   */
  it('Wb Window Flags and Wb Window Ids each sum nine arguments', () => {
    const rt = run(`${FLAGS} : ${IDS}`)
    expect(rt.int.winFlags).toBe(0x1 + 0x2 + 0x4 + 0x8 + 0x1400)
    expect(rt.int.idcmp).toBe(0x200 + 0x40 + 0x8)
  })

  /** eight, and the sum is NewScreen.Type rather than a flag set */
  it('Wb Screen Flags sums eight, and %1111 is CUSTOMSCREEN', () => {
    expect(run('Wb Screen Flags %1111,0,0,0,0,0,0,0').int.screenType).toBe(0xf)
  })
})

describe('Int 1.0: windows', () => {
  const open = `${FLAGS} : ${IDS} : Wb Open Window 0,0,10,320,120,100,50,640,240`

  it('Wb Open Window puts one on the Workbench and renders its title bar', () => {
    const rt = run(`${open} : Wb Window Num 0 : Wb Titles "My Window","Workbench Screen"`)
    const w = rt.int.windows.get(0)!
    expect([w.leftEdge, w.topEdge, w.width, w.height]).toEqual([0, 10, 320, 120])
    expect(w.title).toBe('My Window')
    expect(w.screenSlot).toBe(WB_SLOT)
    // the frame is painted by the frame loop, and an active window's bars are
    // BlockPen, which `Wb Open Window` hardcodes to 1
    rt.frame()
    expect(rt.screens.get(WB_SLOT)!.rp.point(160, 12)).toBe(1)
  })

  /** `$e02` is written by the open and read back by `Wb Current Window` */
  it('Wb Current Window is the one the open left behind', () => {
    expect(val('Wb Current Window', open)).toBe(0)
  })

  /** `cmpi.l #$64,d1 / bgt` — and it is checked AFTER OpenWindow succeeded */
  it('a window number above 100 is Number Needs To Be 0-100', () => {
    expect(() => run(`${FLAGS} : ${IDS} : Wb Open Window 101,0,10,320,120,100,50,640,240`)).toThrow(
      INT_ERRORS[INT_ERR.NUMBER_0_100],
    )
  })

  /**
   * The error table carries "This Window Is Already Opened" at index 2 and
   * NOTHING in the library loads a 2 -- routine 2's whole error surface is
   * the 30 at $2366 and the 4 at $2374. So reopening a number opens a second
   * window and writes it over the table entry, and the first stays on the
   * screen with no keyword able to name it.
   */
  it('opening the same number twice leaks the first window', () => {
    const rt = run(`${open} : Wb Open Window 0,40,60,100,80,10,10,320,200`)
    expect(rt.int.windows.get(0)!.leftEdge).toBe(40)
    // two are open on the Workbench; only the second can be reached
    expect(rt.intuition.windows.filter((w) => w.screenSlot === WB_SLOT)).toHaveLength(2)
  })

  it('Wb Close Window takes it away again', () => {
    expect(run(`${open} : Wb Close Window 0`).int.windows.size).toBe(0)
  })

  /** routine 94: `clr.l (a3)+ / moveq #$1,d0` into the error dispatcher */
  it('closing a window that is not open is This Window Can t Be Closed', () => {
    expect(() => run('Wb Close Window 3')).toThrow(INT_ERRORS[1])
  })

  /**
   * MoveWindow takes a DELTA, whatever `Wb Move Window [X,Y]` in the syntax
   * list reads like: routine 7 pops the two arguments straight into d0 and d1
   * and calls -$a8 with them.
   */
  it('Wb Move Window moves by a delta, not to a position', () => {
    const rt = run(`${open} : Wb Window Num 0 : Wb Move Window 30,5`)
    const w = rt.int.windows.get(0)!
    expect([w.leftEdge, w.topEdge]).toEqual([30, 15])
  })

  /** `moveq #$a,d7` here where every other lookup loads 11 */
  it('moving a window that is not open is Cannot Move This Window', () => {
    expect(() => run('Wb Window Num 4 : Wb Move Window 1,1')).toThrow(INT_ERRORS[INT_ERR.CANNOT_MOVE_THIS_WINDOW])
  })

  /** `cmpi.l #$15,d0 / bgt`, where the open took 0 to 100 */
  it('Wb Window Base reads 0 to 21 and answers 0 for a closed one', () => {
    expect(val('Wb Window Base(0)', open)).toBeGreaterThan(0)
    expect(val('Wb Window Base(3)', open)).toBe(0)
    expect(() => run(`${open} : A=Wb Window Base(22)`)).toThrow(INT_ERRORS[INT_ERR.NUMBER_IS_TO_HIGH])
  })
})

describe('Int 1.0: screens', () => {
  const screen = 'Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 0,0,0,320,200,3,0,0,0'

  /** `move.w $de4(a4),d0 / beq` is the FIRST thing routine 40 does */
  it('opening a screen before Wb Screen Flags is Screen Flag Error', () => {
    expect(() => run('Wb Open Screen 0,0,0,320,200,3,0,0,0')).toThrow(INT_ERRORS[INT_ERR.SCREEN_FLAG_ERROR])
  })

  it('Wb Open Screen opens one and Wb Screen Base hands its address back', () => {
    const rt = run(screen)
    expect(rt.int.screens.get(0)).toBeGreaterThan(0)
    expect(val('Wb Screen Base(0)', screen)).toBe(rt.int.screens.get(0))
    expect(rt.intuition.slotOf(rt.int.screens.get(0)!)).not.toBeNull()
  })

  /** a window opened after it lands on that screen rather than the Workbench */
  it('a window then opens on the screen, not on the Workbench', () => {
    const rt = run(`${screen} : ${FLAGS} : ${IDS} : Wb Open Window 0,0,10,300,100,10,10,320,200`)
    const slot = rt.intuition.slotOf(rt.int.screens.get(0)!)!
    expect(rt.int.windows.get(0)!.screenSlot).toBe(slot)
    expect(slot).not.toBe(WB_SLOT)
  })

  /** three limits on one table: 99 to open, 20 to close or select, 99 to read */
  it('the screen number limits disagree with each other', () => {
    expect(() => run('Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 100,0,0,320,200,3,0,0,0')).toThrow(
      INT_ERRORS[INT_ERR.SCREEN_NUMBER_TO_HIGH],
    )
    // 30 opens...
    const rt = run('Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 30,0,0,320,200,3,0,0,0')
    expect(rt.int.screens.get(30)).toBeGreaterThan(0)
    // ...and neither of the two readers will touch it again
    expect(() => run('Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 30,0,0,320,200,3,0,0,0 : Wb Close Screen 30')).toThrow(
      INT_ERRORS[INT_ERR.SCREEN_NUMBER_TO_HIGH],
    )
    expect(() => run('Wb Screen Num 30')).toThrow(INT_ERRORS[INT_ERR.SCREEN_NUMBER_TO_HIGH])
  })

  /**
   * `Wb Screen Offset` NEGATES both arguments -- `clr.l d2 / sub.l d0,d2` on
   * each -- into the ViewPort's DxOffset and DyOffset before ScrollVPort, so
   * the display moves the other way from what the argument reads like.
   * `Wb Move Screen` is MoveScreen, whose arguments are deltas, on both axes.
   */
  it('Wb Screen Offset negates, and Wb Move Screen moves by a delta', () => {
    const rt = run(`${screen} : Wb Screen Offset 10,4`)
    const s0 = rt.screens.get(rt.intuition.slotOf(rt.int.screens.get(0)!)!)!
    expect([s0.offsetX, s0.offsetY]).toEqual([-10, -4])

    const moved = run(`${screen} : Wb Move Screen 8,6`)
    const s1 = moved.screens.get(moved.intuition.slotOf(moved.int.screens.get(0)!)!)!
    const fresh = run(screen)
    const s2 = fresh.screens.get(fresh.intuition.slotOf(fresh.int.screens.get(0)!)!)!
    expect([s1.displayX - s2.displayX, s1.displayY - s2.displayY]).toEqual([8, 6])
  })

  it('Wb Close Screen closes it, and Wb Screen Num -1 goes back to the Workbench', () => {
    expect(run(`${screen} : Wb Close Screen 0`).int.screens.size).toBe(0)
    expect(run(`${screen} : Wb Screen Num -1`).int.screen).toBe(-1)
  })
})

describe('Int 1.0: menus', () => {
  /** window+menus.AMOS, cut to two titles and the items it hangs on them */
  const build = [
    `${FLAGS} : ${IDS} : Wb Open Window 0,0,10,640,240,100,50,640,240`,
    'Wb Window Num 0',
    'Wb Menu Title "Project"',
    'Wb Menu Item "New","N",$1,$8,$100,0',
    'Wb Menu Item "Quit","Q",0,0,0,0',
    'Wb Menu Title "Prefs"',
    'Wb Menu Item "Save Prefs","",0,0,0,0',
    'Wb Menu Item "","",0,0,0,0',
    'Wb Menu Sub Item "Sub Item 1","S",0,0,0,0',
  ].join(' : ')

  it('the three builders make one NewMenu each, in the order they were called', () => {
    const list = run(build).int.menuList.get(0)!.map((e) => e.nm)
    expect(list.map((n) => n.type)).toEqual([NM.TITLE, NM.ITEM, NM.ITEM, NM.TITLE, NM.ITEM, NM.ITEM, NM.SUB])
    expect(list[1]!.label).toBe('New')
    // "$1=Checkit  $8=MenuToggle  $100=Checked", the example's own comment
    expect(list[1]!.flags).toBe(0x1 + 0x8 + 0x100)
  })

  /** an empty text is `moveq #$ff,d6`, which becomes NM_BARLABEL */
  it('an item with no text is a separator bar', () => {
    expect(run(build).int.menuList.get(0)!.map((e) => e.nm)[5]!.label).toBe(BARLABEL)
  })

  /** `move.b (a2)+,(a1)+` copies ONE byte whatever the program passed */
  it('the command key keeps only its first character', () => {
    const list = run(`${build} : Wb Menu Item "Long","ABCD",0,0,0,0`).int.menuList.get(0)!
    expect(list[list.length - 1]!.nm.commKey).toBe('A')
  })

  /** CreateMenusA then LayoutMenusA, both on gadtools */
  it('Wb Menu On builds the strip gadtools lays out', () => {
    const rt = run(`${build} : Wb Menu On 0`)
    const strip = rt.int.strips.get(0)!
    expect(strip.menus.map((m) => m.label)).toEqual(['Project', 'Prefs'])
    expect(strip.menus[0]!.items).toHaveLength(2)
    expect(strip.menus[1]!.items[1]!.subItems).toHaveLength(1)
  })
})

describe('Int 1.0: the event loop', () => {
  const open = `${FLAGS} : ${IDS} : Wb Open Window 0,0,10,320,120,100,50,640,240 : Wb Window Num 0`

  /** GetMsg answering nothing is `moveq #$0,d0` and the three fields cleared */
  it('Wb Event answers 0 when nothing is queued', () => {
    expect(val('Wb Event', open)).toBe(0)
  })

  it('and raises Window Is Not Open when the current window is not', () => {
    expect(() => run('Wb Window Num 7 : A=Wb Event')).toThrow(INT_ERRORS[INT_ERR.WINDOW_IS_NOT_OPEN])
  })

  /**
   * The class, not a code of the extension's own: bool_gadgets.AMOS loops
   * `Until EV=%1000000000`, which is $200, IDCMP_CLOSEWINDOW.
   *
   * Clicked for real, through the pointer and the frame loop, because that is
   * the path a program takes: `Runtime.stepIntuition` hands AMOS's mouse to
   * Intuition, Intuition posts the message on the window whose close gadget
   * was pressed and released, and `Wb Event` GetMsgs it.
   */
  it('Wb Event answers the IDCMP class, from a real click', () => {
    const b = boot([open, 'Repeat', 'EV=Wb Event', 'Until EV<>0', 'Print EV'].join('\n'))
    b.rt.runHeadless(1)
    const s = b.rt.screens.get(WB_SLOT)!
    // the close gadget sits at the window's top-left, its own width by the
    // title bar's height
    const press = (buttons: number): void => {
      b.rt.input.mouseX = s.screenToHardX(6)
      b.rt.input.mouseY = 15 + s.displayY - s.offsetY
      b.rt.input.mouseK = buttons
      b.rt.frame()
    }
    press(1)
    press(0)
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(IDCMP_CLOSEWINDOW)
  })

  /**
   * `Wb Menu` is one-based and `Wb Item` and `Wb Sub Item` answer 0 for -1,
   * which is what the examples test: `If ITEM>0`.
   *
   * The pump writes ONE of the item and the sub-item and never both: the arm
   * at $30b6 stores the item and returns, the arm at $30d0 stores the
   * sub-item and returns. So after a sub-item pick `Wb Item` still reports
   * whatever the last item pick left there.
   */
  it('the three menu readers decode a pick, one-based, and 0 for none', () => {
    // the window has to have ASKED for MENUPICK, which `Wb Window Ids` is for
    const menuOpen = `${FLAGS} : Wb Window Ids $100,$200,0,0,0,0,0,0,0 : Wb Open Window 0,0,10,320,120,100,50,640,240 : Wb Window Num 0`
    const pick = (code: number): number[] => {
      const b = boot(
        [menuOpen, 'Repeat', 'EV=Wb Event', 'Until EV<>0', 'Print Wb Menu;Wb Item;Wb Sub Item'].join('\n'),
      )
      b.rt.runHeadless(1)
      expect(b.rt.int.windows.get(0)!.post(IDCMP_MENUPICK, code)).toBe(true)
      mustFinish(b.rt.runHeadless(2_000))
      return b.out().trim().split(/\s+/).map(Number)
    }
    // menu 0, item 1, no sub-item
    expect(pick(fullMenuNum(0, 1, NOSUB))).toEqual([1, 2, 0])
    // menu 1, item 0, sub-item 2: the item arm is not taken, so it stays -1
    expect(pick(fullMenuNum(1, 0, 2))).toEqual([2, 0, 3])
  })
})

describe('Int 1.0: boolean gadgets', () => {
  const open = `${FLAGS} : ${IDS} : Wb Open Window 0,0,10,320,120,100,50,640,240`

  /** "Wb Bool Gadget X,Y,Width,Height,Type,X_Text_Pos,Y_Text_Pos,Text,Window" */
  const four = [1, 2, 3, 4]
    .map((n) => `Wb Bool Gadget 20,${n * 20},66,8,1,0,0,"Button ${n}",0`)
    .join(' : ')

  /** they are made BEFORE the window and attach to it when it opens */
  it('gadgets built before the window arrive on it', () => {
    const rt = run(`${four} : ${open}`)
    expect(rt.int.windows.get(0)!.gadgets).toHaveLength(4)
  })

  /** `cmpi.l #$1,$10(a3)`, the fifth argument, before anything else happens */
  it('a type other than 1 is Only Type 1 Is Allowed', () => {
    expect(() => run('Wb Bool Gadget 20,20,66,8,2,0,0,"x",0')).toThrow(INT_ERRORS[INT_ERR.ONLY_TYPE_1])
  })

  /**
   * DEFECT: `$26` of the Gadget is never written, so every one of them has
   * GadgetID 0 and `Wb Event` cannot tell four buttons apart. The author's own
   * example makes four and tests only the close gadget.
   */
  it('every gadget has id 0, because nothing writes GadgetID', () => {
    expect(run(`${four} : ${open}`).int.windows.get(0)!.gadgets.map((g) => g.id)).toEqual([0, 0, 0, 0])
  })

  /**
   * DEFECT: `move.b #$ff,$2c(a0)` writes the HIGH byte of a WORD field, so
   * Border.LeftEdge and TopEdge read -256 rather than the -1 they were meant
   * to. The outline draws a quarter of a screen up and to the left of the
   * gadget and what a program sees is a label with no box.
   */
  it('the border offset is -256, so the outline misses the gadget', () => {
    const g = run(`${four} : ${open}`).int.windows.get(0)!.gadgets[0]!
    expect([g.border!.leftEdge, g.border!.topEdge]).toEqual([-256, -256])
    expect(g.text!.text).toBe('Button 1')
  })

  /** the label is an IntuiText and IS drawn, at the gadget plus its own offset */
  it('the label renders where the gadget is', () => {
    const rt = run(`Wb Bool Gadget 20,20,66,8,1,4,0,"Go",0 : ${open}`)
    rt.frame()
    const rp = rt.screens.get(WB_SLOT)!.rp
    let ink = 0
    for (let x = 20; x < 90; x++) for (let y = 30; y < 44; y++) if (rp.point(x, y) === 2) ink++
    expect(ink).toBeGreaterThan(0)
  })
})

describe('Int 1.0: gadtools gadgets', () => {
  const open = `${FLAGS} : ${IDS} : Wb Open Window 0,0,10,320,120,100,50,640,240 : Wb Window Num 0`
  /** "Wb Gt Gadget [X,Y,Width,Height,Text$,IdNum,TextPos,Type,WindowNum]" */
  const two = `${open} : Wb Gt Gadget 10,20,80,12,"Go",7,1,1,0 : Wb Gt Gadget 10,40,120,12,"Name",8,1,12,0`

  it('makes a BUTTON and a STRING on the window s own context', () => {
    const chain = run(two).int.gtGadgets.get(0)!
    expect(chain.map((g) => g.kind)).toEqual([1, 12])
    expect(chain.map((g) => g.id)).toEqual([7, 8])
    expect(chain[0]!.text).toBe('Go')
  })

  /** the three refusals are a ladder, and each has its own message */
  it('refuses kind 10, kind 15 and up, and anything that is not 1 or 12', () => {
    const bad = (kind: number): string => `${open} : Wb Gt Gadget 10,20,80,12,"x",1,1,${kind},0`
    expect(() => run(bad(10))).toThrow(INT_ERRORS[25])
    expect(() => run(bad(15))).toThrow(INT_ERRORS[26])
    expect(() => run(bad(4))).toThrow(INT_ERRORS[28])
  })

  /**
   * DEFECT: the message names type 2 and the code tests type 1. So a program
   * that reads "Only Number Type 2 And 12 Allowed" and passes 2 is refused
   * with the same sentence.
   */
  it('and the message for that one names the wrong type', () => {
    expect(INT_ERRORS[28]).toBe('Only Number Type 2 And 12 Allowed')
    expect(() => run(`${open} : Wb Gt Gadget 10,20,80,12,"x",1,1,2,0`)).toThrow(INT_ERRORS[28])
    expect(() => run(`${open} : Wb Gt Gadget 10,20,80,12,"x",1,1,1,0`)).not.toThrow()
  })

  /** PLACETEXT_, exactly one of six */
  it('a text position that is not a single PLACETEXT bit is Wrong Type Of Flag', () => {
    expect(() => run(`${open} : Wb Gt Gadget 10,20,80,12,"x",1,3,1,0`)).toThrow(INT_ERRORS[27])
  })

  /** the buffer is twenty bytes, `moveq #$14,d1`, and the copy does not ask */
  it('Wb Set Gt String writes the buffer and cuts it at twenty', () => {
    const rt = run(`${two} : Wb Set Gt String 1,"Hello",0`)
    expect(rt.int.gtGadgets.get(0)![1]!.string).toBe('Hello')
    const long = run(`${two} : Wb Set Gt String 1,"012345678901234567890123",0`)
    expect(long.int.gtGadgets.get(0)![1]!.string).toHaveLength(20)
  })

  it('Wb Gt String reads it back', () => {
    const b = boot(`${two} : Wb Set Gt String 1,"Hello",0 : Print Wb Gt String(1)`)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('Hello')
  })

  /**
   * DEFECT: gadget 0 is refused, and reported as the window not being open.
   * `move.l (a3)+,d0 / beq` jumps to the arm that loads `moveq #$b,d0`.
   */
  it('and refuses gadget 0 with the wrong message', () => {
    expect(() => run(`${two} : A$=Wb Gt String(0)`)).toThrow(INT_ERRORS[INT_ERR.WINDOW_IS_NOT_OPEN])
  })

  /** the walk runs off the end into error 17 */
  it('Wb Activate Gt raises Gadget Not Found past the end of the chain', () => {
    expect(() => run(`${two} : Wb Activate Gt 9`)).toThrow(INT_ERRORS[17])
    expect(run(`${two} : Wb Activate Gt 1`).int.activeGadget).toBe(1)
  })

  /**
   * DEVIATION: nothing paints them. The hit region is on the window so a
   * click still reports the id through `Wb Event`, which is what this checks;
   * the frame gadtools would have drawn is not there, exactly as GUI 2.10's
   * gadgets are not.
   */
  it('a click on one reports its id through Wb Event', () => {
    const b = boot([two, 'Repeat', 'EV=Wb Event', 'Until EV<>0', 'Print EV'].join('\n'))
    b.rt.runHeadless(1)
    const s = b.rt.screens.get(WB_SLOT)!
    const press = (buttons: number): void => {
      b.rt.input.mouseX = s.screenToHardX(40)
      b.rt.input.mouseY = 36 + s.displayY - s.offsetY
      b.rt.input.mouseK = buttons
      b.rt.frame()
    }
    press(1)
    press(0)
    mustFinish(b.rt.runHeadless(2_000))
    expect(Number(b.out().trim())).toBe(7)
  })
})

/**
 * The drawing group: graphics.library through wd_RPort.
 *
 * Argument ORDER is the thing to get right, and the token table settles it
 * rather than the disassembly does. `(a3)+` walks the parameter block from
 * the LAST argument upwards, which is provable from the three keywords whose
 * spec puts a string first --- `Wb Text` is `I2,0,0` and routine 19 pops the
 * string LAST ($2a9a) --- and the author's own examples then confirm every
 * one of these: `Wb Text "Press Any Key",0,10`, `Wb Ellipse X,Y,X2,Y2` and
 * two `Wb Palette` groups followed by `Wb Load Rgb 16` are ellipse1.AMOS
 * verbatim.
 */
describe('Int 1.0: the drawing group', () => {
  /** a 320x256 four-plane custom screen with one window filling it */
  const SCREEN = 'Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 0,0,0,320,256,4,0,1,%0'
  const WIN = `${SCREEN} : ${FLAGS} : ${IDS} : Wb Open Window 0,0,0,320,256,10,10,320,256 : Wb Window Num 0`
  /** eight primaries, so a pen number and a colour can be told apart */
  const PENS = 'Wb Palette 0,$0,$F00,$0F0,$00F,$FF0,$F0F,$0FF,$FFF : Wb Load Rgb 8'

  /** the custom screen the window opened on */
  function surface(rt: Runtime): { point: (x: number, y: number) => number; palette: Uint16Array } {
    const slot = rt.int.windows.get(0)!.screenSlot
    const scr = rt.screens.get(slot)!
    return { point: (x, y) => scr.rp.point(x, y), palette: scr.palette }
  }

  /**
   * `Wb Palette n,c0..c7` fills sixteen bytes at `$884 + n*16` and
   * `Wb Load Rgb n` reads the same table FLAT from the start, which is what
   * makes group n colours n*8 to n*8+7.
   *
   * ellipse1.AMOS is where the two-groups-then-sixteen shape comes from: it
   * writes group 0 and group 1 and then asks for 16.
   */
  it('Wb Palette groups eight and Wb Load Rgb reads them flat', () => {
    const rt = run(`${WIN} : Wb Palette 0,$0,$F00,$0F0,$00F,$FF0,$F0F,$0FF,$FFF
Wb Palette 1,$111,$222,$333,$444,$555,$666,$777,$888
Wb Load Rgb 16`)
    expect([...rt.int.colours.slice(0, 16)]).toEqual([
      0x000, 0xf00, 0x0f0, 0x00f, 0xff0, 0xf0f, 0x0ff, 0xfff, 0x111, 0x222, 0x333, 0x444, 0x555, 0x666, 0x777, 0x888,
    ])
    expect([...surface(rt).palette.slice(0, 16)]).toEqual([
      0x000, 0xf00, 0x0f0, 0x00f, 0xff0, 0xf0f, 0x0ff, 0xfff, 0x111, 0x222, 0x333, 0x444, 0x555, 0x666, 0x777, 0x888,
    ])
  })

  /**
   * `Wb Load Rgb` takes only what it was asked for. LoadRGB4's count is d0
   * and the routine passes the argument straight into it ($3718).
   */
  it('Wb Load Rgb loads only the first n', () => {
    const rt = run(`${WIN} : Wb Palette 0,$111,$222,$333,$444,$555,$666,$777,$888 : Wb Load Rgb 3`)
    const pal = surface(rt).palette
    expect([pal[0], pal[1], pal[2]]).toEqual([0x111, 0x222, 0x333])
    expect(pal[3]).not.toBe(0x444)
  })

  /**
   * SetAPen (-$156) writes the RastPort and nothing else, so the pen is a
   * MODE that later keywords read. ellipse1.AMOS depends on exactly that:
   * `Wb Front Pen Rnd(14)+1` then `Wb Ellipse X,Y,X2,Y2`, three hundred
   * times, with no colour on the ellipse.
   */
  it('Wb Front Pen persists into the next drawing keyword', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 5 : Wb Fill Box 10,10 To 20,20 : Wb Fill Box 40,10 To 50,20`)
    expect(surface(rt).point(15, 15)).toBe(5)
    expect(surface(rt).point(45, 15)).toBe(5)
  })

  /** `Wb Ellipse x,y,a,b` --- DrawEllipse (-$b4), centre then the two radii */
  it('Wb Ellipse is an outline about the centre, a horizontal and b vertical', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 2 : Wb Ellipse 160,120,40,20`)
    const s = surface(rt)
    // the four extremes are on it and the middle is not: DrawEllipse draws no
    // interior, which is AreaEllipse's job and not this call's
    expect(s.point(200, 120)).toBe(2)
    expect(s.point(120, 120)).toBe(2)
    expect(s.point(160, 100)).toBe(2)
    expect(s.point(160, 140)).toBe(2)
    expect(s.point(160, 120)).toBe(0)
  })

  /** `Wb Fill Box x1,y1 To x2,y2` --- RectFill (-$132), corners inclusive */
  it('Wb Fill Box fills to both corners', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 4 : Wb Fill Box 100,50 To 120,60`)
    const s = surface(rt)
    expect(s.point(100, 50)).toBe(4)
    expect(s.point(120, 60)).toBe(4)
    expect(s.point(110, 55)).toBe(4)
    expect(s.point(121, 60)).toBe(0)
  })

  /**
   * `Wb Box x1,y1 To x2,y2` --- Move (-$f0) then PolyDraw (-$150) of five
   * points, so it is four sides and no interior.
   */
  it('Wb Box draws the four sides and nothing inside', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 6 : Wb Box 100,50 To 140,80`)
    const s = surface(rt)
    expect(s.point(120, 50)).toBe(6)
    expect(s.point(120, 80)).toBe(6)
    expect(s.point(100, 65)).toBe(6)
    expect(s.point(140, 65)).toBe(6)
    expect(s.point(120, 65)).toBe(0)
  })

  /** `Wb Draw x1,y1 To x2,y2` --- Move (-$f0) then Draw (-$f6) */
  it('Wb Draw joins the two points', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 7 : Wb Draw 10,100 To 200,100`)
    const s = surface(rt)
    expect(s.point(10, 100)).toBe(7)
    expect(s.point(105, 100)).toBe(7)
    expect(s.point(200, 100)).toBe(7)
    expect(s.point(201, 100)).toBe(0)
  })

  /**
   * `Wb Text a$,x,y` --- the STRING first, and `y` is the BASELINE.
   *
   * This is graphics.library's Text (-$3c) after a Move (-$f0), not AMOS's,
   * and the two disagree about y by the font's ascent. The glyphs therefore
   * land ABOVE the coordinate given.
   */
  it('Wb Text takes the string first and puts the baseline on y', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 7 : Wb Text "H",0,100`)
    const s = surface(rt)
    let above = 0
    let below = 0
    for (let y = 90; y < 100; y++) for (let x = 0; x < 8; x++) if (s.point(x, y) === 7) above++
    for (let y = 101; y < 110; y++) for (let x = 0; x < 8; x++) if (s.point(x, y) === 7) below++
    expect(above).toBeGreaterThan(0)
    expect(below).toBe(0)
  })

  /**
   * `Wb Draw Mode n` --- SetDrMd (-$162), and it is graphics.library's
   * numbering: 1 is JAM2, which fills the character cell with the background
   * pen before the glyph goes down.
   */
  it('Wb Draw Mode 1 is JAM2, and Wb Back Pen is what it fills with', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Draw Mode 1 : Wb Front Pen 7 : Wb Back Pen 3 : Wb Text " ",50,100`)
    const s = surface(rt)
    // a space has no set bits, so every pixel of its cell is the back pen
    expect(s.point(52, 95)).toBe(3)
  })

  /** JAM1 is 0 and leaves the ground alone, which is the same call with a 0 */
  it('Wb Draw Mode 0 is JAM1 and paints no cell', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Draw Mode 0 : Wb Front Pen 7 : Wb Back Pen 3 : Wb Text " ",50,100`)
    expect(surface(rt).point(52, 95)).toBe(0)
  })

  /**
   * `Wb Intuitext a$,left,top,mode,frontPen,backPen,xOffset,yOffset` ---
   * eight arguments into an IntuiText at `$c8a(a4)`, then PrintIText (-$d8).
   *
   * The last two are PrintIText's own leftOffset and topOffset, so the text
   * lands at left+xOffset, top+yOffset --- and `top` is the TOP of the
   * glyphs, unlike `Wb Text`'s baseline, because Intuition adds the
   * baseline itself.
   */
  it('Wb Intuitext offsets the IntuiText and uses its own two pens', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 1 : Wb Intuitext " ",10,50,1,7,4,30,20`)
    const s = surface(rt)
    // cell at (10+30, 50+20), filled with the BACK pen the keyword was given
    // rather than the RastPort's, and the front pen 1 set before it is unused
    expect(s.point(42, 75)).toBe(4)
  })

  /**
   * `Wb Scroll win,dx,dy,x1,y1,x2,y2` --- ScrollRaster (-$18c), and the ONLY
   * keyword in the group that names its window instead of reading `$d94`:
   * routine 51 pops seven and hands the last of them ($3e4e) to routine 44.
   *
   * The register roles come from the other side. AMOS's own Intuition
   * extension scrolls its text window with `moveq #0,d0 / move.w
   * rp_TxHeight(a2),d1 / call ScrollRaster` after loading d2..d5 from the
   * window's four border insets (Intuition-41.95 `src/output.s:176-191`), so
   * d0 is dx, d1 dy and d2..d5 the rectangle. A positive dy scrolls UP.
   */
  it('Wb Scroll moves the rectangle up and backfills with the back pen', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 5 : Wb Fill Box 100,80 To 120,90
Wb Back Pen 2
Wb Scroll 0,0,20,90,50,140,100`)
    const s = surface(rt)
    // the block was at y 80..90 and dy is 20, so it is at 60..70 now
    expect(s.point(110, 65)).toBe(5)
    // where it WAS is whatever was twenty rows below it, which was nothing
    expect(s.point(110, 75)).toBe(0)
    // the last twenty rows had nothing inside the rectangle to scroll into
    // them, and the fill is the BACK pen rather than the front one
    expect(s.point(110, 85)).toBe(2)
    expect(s.point(110, 100)).toBe(2)
    // and nothing outside the rectangle moved
    expect(s.point(110, 45)).toBe(0)
    expect(s.point(110, 101)).toBe(0)
  })

  /** a negative dy is the other way, and the block survives inside the box */
  it('Wb Scroll with a negative dy moves the contents down', () => {
    const rt = run(`${WIN} : ${PENS} : Wb Front Pen 5 : Wb Fill Box 100,60 To 120,70
Wb Scroll 0,0,-20,90,50,140,120`)
    const s = surface(rt)
    expect(s.point(110, 85)).toBe(5)
    expect(s.point(110, 65)).toBe(0)
  })

  /**
   * `Wb Put Chr$ a$,address` --- no library call at all. Routine 69 reads the
   * string's length word and copies that many bytes (`subq.l #$1,d2 /
   * move.b (a1)+,(a0)+ / dbra`), writing NO terminator.
   */
  it('Wb Put Chr$ copies the string into memory and terminates nothing', () => {
    const b = boot(`Reserve As Work 10,16 : Loke Start(10),$FFFFFFFF
Wb Put Chr$ "AB",Start(10)
Print Peek(Start(10));",";Peek(Start(10)+1);",";Peek(Start(10)+2)`)
    mustFinish(b.rt.runHeadless(2_000))
    // two bytes written and the third left as it was: the copy is the length
    // word's count and it appends no NUL
    expect(b.out().replace(/\s+/g, '')).toBe('65,66,255')
  })

  /**
   * Every keyword in the group is `Rbsr routine 44 / tst.l d0 / beq`, and the
   * arm is `moveq #$b,d0` --- "Window Is Not Open".
   */
  it('drawing with no window open is Window Is Not Open', () => {
    expect(() => run(`${SCREEN} : Wb Window Num 3 : Wb Fill Box 0,0 To 10,10`)).toThrow(
      INT_ERRORS[INT_ERR.WINDOW_IS_NOT_OPEN],
    )
  })

  /**
   * The pens live in wd_RPort, so two windows do not share them.
   */
  it('each window carries its own pens', () => {
    const rt = run(`${SCREEN} : ${FLAGS} : ${IDS}
Wb Open Window 0,0,0,160,256,10,10,320,256
Wb Open Window 1,160,0,160,256,10,10,320,256
${PENS}
Wb Window Num 0 : Wb Front Pen 5
Wb Window Num 1 : Wb Front Pen 6
Wb Window Num 0 : Wb Fill Box 10,10 To 20,20
Wb Window Num 1 : Wb Fill Box 10,10 To 20,20`)
    const slot = rt.int.windows.get(0)!.screenSlot
    const scr = rt.screens.get(slot)!
    // both boxes are at 10,10 in their OWN window, and window 1 starts at 160
    expect(scr.rp.point(15, 15)).toBe(5)
    expect(scr.rp.point(175, 15)).toBe(6)
  })

  /**
   * A window's RPort is clipped to the window, which is what its Layer does,
   * so a coordinate past the right edge does not reach the next window.
   */
  it('drawing is clipped to the window', () => {
    const rt = run(`${SCREEN} : ${FLAGS} : ${IDS}
Wb Open Window 0,0,0,160,256,10,10,320,256 : Wb Window Num 0
${PENS}
Wb Front Pen 5 : Wb Fill Box 10,10 To 300,20`)
    const slot = rt.int.windows.get(0)!.screenSlot
    const scr = rt.screens.get(slot)!
    expect(scr.rp.point(150, 15)).toBe(5)
    expect(scr.rp.point(200, 15)).toBe(0)
  })
})

/**
 * The author's examples leave flag slots empty, and an empty integer slot
 * compiles to EntNul ($80000000, +Equ.s:39) rather than to nothing.
 */
describe('Int 1.0: empty flag slots', () => {
  /**
   * `Wb Screen Flags %1111,,,,,,,` is scroll.AMOS verbatim. Seven EntNuls go
   * into the sum and routine 42 stores a WORD (`move.w d1,$de4`), so they
   * are truncated away and CUSTOMSCREEN survives.
   */
  it('Wb Screen Flags keeps a word, so seven EntNuls vanish', () => {
    expect(run('Wb Screen Flags %1111,,,,,,,').int.screenType).toBe(0xf)
  })

  /**
   * `Wb Window Flags %100000000000,%1000000000000,,,,,,,` is ellipse1.AMOS
   * and ellipse2.AMOS. Routine 9 stores the LONG (`move.l d1,$190`), so the
   * seven EntNuls DO survive: an odd count leaves bit 31 set in
   * NewWindow.Flags. Intuition defines nothing there, which is why the
   * examples work anyway.
   */
  it('Wb Window Flags keeps the long, so an odd count of them sets bit 31', () => {
    expect(run('Wb Window Flags %100000000000,%1000000000000,,,,,,,').int.winFlags).toBe((0x800 + 0x1000 + 0x8000_0000) >>> 0)
  })

  /** an even count cancels, because two EntNuls are 2^32 and carry away */
  it('two empty slots cancel each other', () => {
    expect(run('Wb Window Ids $200,,,0,0,0,0,0,0').int.idcmp).toBe(0x200)
  })
})

/**
 * The input group: six keywords, not one of which opens a library.
 *
 * Two read the window struct, two read CIA-A's serial register at `$bfec01`,
 * one reads CIA-A's PRA at `$bfe001` and one reads the gameport counters.
 */
describe('Int 1.0: the input group', () => {
  const WIN = `${FLAGS} : ${IDS} : Wb Open Window 0,40,20,160,100,10,10,320,200 : Wb Window Num 0`

  /**
   * `before` goes on its own LINE and not after a colon: `Rem` comments to
   * the end of its line, so `Rem : Print X` prints nothing at all.
   */
  function ask(expr: string, prep?: (rt: Runtime) => void, before = 'Rem'): number {
    const b = boot(`${before}\nPrint ${expr}`)
    prep?.(b.rt)
    mustFinish(b.rt.runHeadless(2_000))
    return Number(b.out().trim())
  }

  /**
   * The same, but with the pointer moved for real through the frame loop
   * after the window is open --- which is the path that fills wd_MouseX and
   * wd_MouseY, in `Intuition.pointerMoved`.
   */
  function askAtPointer(expr: string, sx: number, sy: number): number {
    // the program has to WAIT, or it prints before the pointer has moved: a
    // headless run does not stop at `Wait Vbl` and the whole thing is over
    // inside the first budget. `Wb Mouse Key` is the gate, so this exercises
    // that one too.
    const b = boot(`${WIN}\nRepeat\nUntil Wb Mouse Key=1\nPrint ${expr}`)
    b.rt.runHeadless(1)
    const scr = b.rt.screens.get(WB_SLOT)!
    b.rt.input.mouseX = scr.screenToHardX(sx)
    b.rt.input.mouseY = sy + scr.displayY - scr.offsetY
    // one frame with the pointer moved and the button still up. The order
    // inside a frame is interpreter first and `stepIntuition` after it, so a
    // press in the SAME frame prints the position from the frame before.
    b.rt.frame()
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(2_000))
    return Number(b.out().trim())
  }

  /**
   * `move.w $e(a1),d3` and `move.w $c(a1),d3`. wd_NextWindow is a pointer at
   * 0 and four words of geometry follow it, so `intuition.i:690` puts
   * wd_MouseY at 12 and wd_MouseX at 14 --- Y first, which is the order the
   * header has them in.
   */
  it('Wb Mousex and Wb Mousey are window-relative', () => {
    // the window is at 40,20, so a pointer at 60,35 on the screen is 20,15 in
    // it -- and the pointer is moved through the frame loop rather than the
    // field being written, so this exercises the path that fills the struct
    expect(askAtPointer('Wb Mousex', 60, 35)).toBe(20)
    expect(askAtPointer('Wb Mousey', 60, 35)).toBe(15)
  })

  /**
   * `moveq #$0,d3` and then `move.w`, so the word is ZERO-extended. wd_MouseX
   * is signed and goes negative with the pointer left of the window, and this
   * reports 65535 for it rather than -1.
   */
  it('a negative window coordinate comes back unsigned', () => {
    // four pixels left of the window's left edge, which wd_MouseX records as
    // -4. An EVEN offset because the Workbench screen is hires and the round
    // trip through hardware coordinates halves and doubles.
    expect(askAtPointer('Wb Mousex', 36, 35)).toBe(0xfffc)
  })

  /**
   * Routines 17 and 18 are `movea.l d0,a1 / beq` into a `moveq #$0,d3`. Every
   * other keyword that looks a window up raises 11; these two answer 0.
   */
  it('with no window open they answer 0 rather than raising', () => {
    expect(ask('Wb Mousex')).toBe(0)
    expect(ask('Wb Mousey')).toBe(0)
  })

  /**
   * `eori.b #$ff / ror.b #$1` is the canonical undo of the keyboard's
   * encoding (../amiga/keyboard.ts) and leaves the scancode with bit 7 set on
   * a release. `subi.b #$80` on a byte then flips that bit, so a PRESS
   * answers the scancode plus 128 and a RELEASE answers it plain.
   */
  it('Wb Keycode flips bit 7: a press is scancode+128 and a release is the scancode', () => {
    const ESC = 0x45
    expect(ask('Wb Keycode', (rt) => (rt.input.sdr = keyboardSdr(ESC, true)))).toBe(ESC + 0x80)
    expect(ask('Wb Keycode', (rt) => (rt.input.sdr = keyboardSdr(ESC, false)))).toBe(ESC)
  })

  /** `tst.b d0 / beq -> moveq #$ff,d3`, which is -1 and not 255 */
  it('an empty register is -1', () => {
    expect(ask('Wb Keycode', (rt) => (rt.input.sdr = 0))).toBe(-1)
  })

  /**
   * Routine 31 is `clr.b $bfec01.l` and then a read-back loop, because the
   * keyboard can clock the next byte in between. Nothing here is clocking
   * one, so the loop runs once.
   */
  it('Wb Clear Key empties the register the next Wb Keycode reads', () => {
    expect(ask('Wb Keycode', (rt) => (rt.input.sdr = keyboardSdr(0x45, true)), 'Wb Clear Key')).toBe(-1)
  })

  /**
   * `btst.b #$6,$bfe001.l` on CIA-A's PRA, /FIR0 active low, so the `beq` arm
   * is the pressed one and it loads `moveq #$1,d3`.
   *
   * The polarity is this keyword's own: TURBO's `Left Click` and The Game's
   * `G Left Click` read the same bit and answer -1 for PRESSED. This answers
   * 1 for pressed and -1 for not, and never 0.
   */
  it('Wb Mouse Key is 1 down and -1 up, which is nobody else here', () => {
    expect(ask('Wb Mouse Key')).toBe(-1)
    expect(ask('Wb Mouse Key', (rt) => (rt.input.mouseK = 1))).toBe(1)
  })

  /**
   * One direction, not a mask. Routine 53 tests four things in order and lets
   * each overwrite the last, and the bit meanings are the register's: a
   * digital stick puts `left` on 9, `right` on 1, `right^down` on 0 and
   * `left^up` on 8 (../amiga/gameport.ts `joyDatOf`, off `custom.i`).
   */
  it('Wb Joy answers one direction: 1 left, 2 right, 3 down, 4 up', () => {
    const push = (d: number) => (rt: Runtime) => {
      rt.input.ports[1].dirs = d
    }
    expect(ask('Wb Joy(1)', push(DIR_LEFT))).toBe(1)
    expect(ask('Wb Joy(1)', push(DIR_RIGHT))).toBe(2)
    expect(ask('Wb Joy(1)', push(DIR_DOWN))).toBe(3)
    expect(ask('Wb Joy(1)', push(DIR_UP))).toBe(4)
    expect(ask('Wb Joy(1)')).toBe(0)
  })

  /** the last test to match wins, so a diagonal loses one of its directions */
  it('a diagonal answers only the higher-numbered direction', () => {
    expect(
      ask('Wb Joy(1)', (rt) => {
        rt.input.ports[1].dirs = DIR_UP | DIR_LEFT
      }),
    ).toBe(4)
  })

  /** `moveq #$64,d6` and `add.l d6,d3` --- a hundred, added to the direction */
  it('a fire adds 100', () => {
    expect(
      ask('Wb Joy(1)', (rt) => {
        rt.input.ports[1].dirs = DIR_UP
        rt.input.ports[1].buttons = BTN_RED
      }),
    ).toBe(104)
  })

  /**
   * DEFECT: `btst.b #$7,$bfe001.l` is /FIR1, and it is read at $3e8a BEFORE
   * the argument is popped at $3e9e. So the fire bonus is port 1's whichever
   * port the argument names, and `Wb Joy(0)` reports a button nobody on port
   * 0 pressed.
   */
  it('the fire bonus is always port 1s, even for Wb Joy(0)', () => {
    expect(
      ask('Wb Joy(0)', (rt) => {
        rt.input.ports[1].buttons = BTN_RED
      }),
    ).toBe(100)
    // and port 0's own button is not the one it reads
    expect(
      ask('Wb Joy(0)', (rt) => {
        rt.input.ports[0].dirs = DIR_UP
      }),
    ).toBe(4)
  })

  /** `cmpi.l #$1,d0 / bne` --- exactly 1 is JOY1DAT and everything else JOY0DAT */
  it('only the argument 1 reads the second port', () => {
    const push = (rt: Runtime): void => {
      rt.input.ports[0].dirs = DIR_UP
    }
    expect(ask('Wb Joy(0)', push)).toBe(4)
    expect(ask('Wb Joy(2)', push)).toBe(4)
    expect(ask('Wb Joy(1)', push)).toBe(0)
  })
})

/**
 * The requester's settings, and the two readers nothing calls.
 *
 * `Wb Asl Req` is the only keyword in this group that opens a library. The
 * three setters just fill in what it will ask for, and iff_to_bank.AMOS is
 * the shape they are used in.
 */
describe('Int 1.0: the requester settings', () => {
  /** what the buffer reads as, which is up to the first NUL */
  const upTo = (b: Uint8Array): string => {
    let out = ''
    for (const c of b) {
      if (c === 0) break
      out += String.fromCharCode(c)
    }
    return out
  }

  /** iff_to_bank.AMOS's first two lines, with the author's own comments */
  it('the three settings are stored for the next request', () => {
    const rt = run('Wb Asl Info 1 : Wb Asl Dir "SYS:" : Wb Asl Pattern "#?.iff"')
    expect(rt.int.aslHideInfo).toBe(1)
    expect(upTo(rt.int.aslDir)).toBe('SYS:')
    expect(upTo(rt.int.aslPattern)).toBe('#?.iff')
  })

  /**
   * DEFECT: routine 58 writes no terminator on either exit, so a shorter
   * pattern only overwrites its own length and the old tail survives. A
   * pattern can never get shorter for the life of the program.
   */
  it('a shorter pattern cannot replace a longer one', () => {
    const rt = run('Wb Asl Pattern "#?.iff" : Wb Asl Pattern "#?"')
    expect(upTo(rt.int.aslPattern)).toBe('#?.iff')
  })

  /**
   * `Wb Asl Dir` does not have that problem, and not because it is careful:
   * routine 72 copies `length + 1` bytes, so it takes the byte PAST the
   * string as well, and for a terminated one that byte is the NUL.
   */
  it('a shorter directory does replace a longer one, by luck', () => {
    const rt = run('Wb Asl Dir "Work:Pictures" : Wb Asl Dir "SYS:"')
    expect(upTo(rt.int.aslDir)).toBe('SYS:')
  })

  /** `cmpi.w #$100,d0 / bgt` --- the whole call is dropped, not truncated */
  it('a pattern longer than 256 is ignored entirely', () => {
    const rt = run(`Wb Asl Pattern "ab" : Wb Asl Pattern String$("x",257)`)
    expect(upTo(rt.int.aslPattern)).toBe('ab')
  })

  /**
   * `=Wb File` reads `fr_File` out of the requester at `$a96`. Nothing has
   * allocated one, so `tst.l (a0) / beq` gives the empty string.
   *
   * No `$` on the name: the token entry is `wb file` with spec `2`.
   */
  it('Wb File is empty until a request has answered', () => {
    const b = boot('Print "["+Wb File+"]"')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[]')
  })
})

/**
 * `=Wb Find String(a$, start To end, fold)`, which does not work.
 *
 * Reproduced rather than repaired, and checked against the library rather
 * than read off a listing: the bytes at file offset `0x46f4` are `B5 C9 6C`,
 * `cmpa.l a1,a2` and then `bge`. Nothing in the eighteen example programs
 * calls this keyword, which is consistent with it never having worked.
 */
describe('Int 1.0: Wb Find String', () => {
  const WORK = 'Reserve As Work 10,64'

  function find(setup: string, expr: string): number {
    const b = boot(`${WORK} : ${setup}\nPrint ${expr}`)
    mustFinish(b.rt.runHeadless(2_000))
    return Number(b.out().trim())
  }

  /**
   * DEFECT: `cmpa.l a1,a2` computes `end - scan`, and `bge` gives up while
   * that is positive --- which it is on the very first mismatched byte. So a
   * string four bytes in is not found at all.
   */
  it('finds nothing that does not start exactly at the start address', () => {
    expect(find('Poke$ Start(10)+4,"HELLO"', 'Wb Find String("HELLO",Start(10) To Start(10)+63,0)')).toBe(0)
  })

  /**
   * DEFECT: and a match answers one ABOVE where it began. The success arm is
   * `move.l a1,d3 / sub.l d4,d3 / addq.l #$1,d3`, with `a1` one past the
   * matched bytes and `d4` the pattern's length.
   */
  it('a match at the start address answers start plus one', () => {
    expect(find('Poke$ Start(10),"HELLO"', 'Wb Find String("HELLO",Start(10) To Start(10)+63,0)-Start(10)')).toBe(1)
  })

  /**
   * The fold path compares the pattern against the memory byte plus 32 and
   * then minus 32. It does that by writing to the memory and putting it back
   * on every path, so nothing here can see it happen --- on the machine it is
   * what makes the keyword unusable on ROM.
   */
  it('a non-zero third argument folds case', () => {
    expect(find('Poke$ Start(10),"hello"', 'Wb Find String("HELLO",Start(10) To Start(10)+63,1)-Start(10)')).toBe(1)
    expect(find('Poke$ Start(10),"hello"', 'Wb Find String("HELLO",Start(10) To Start(10)+63,0)')).toBe(0)
  })
})

/**
 * `Wb Paste Icon x,y,n` --- one icon out of AMOS's bank 2, through
 * intuition's DrawImage.
 */
describe('Int 1.0: Wb Paste Icon', () => {
  const SCREEN = 'Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 0,0,0,320,256,4,0,1,%0'
  const WIN = `${SCREEN} : ${FLAGS} : ${IDS} : Wb Open Window 0,0,0,320,256,10,10,320,256 : Wb Window Num 0`
  /** a 16x16 block of pen 3, grabbed into the icon bank */
  const ICON = 'Screen Open 1,64,64,16,Lowres : Cls 0 : Ink 3 : Bar 0,0 To 15,15 : Get Icon 1,0,0 To 16,16'

  function paste(src: string): { rt: Runtime; point: (x: number, y: number) => number } {
    const rt = run(src)
    const scr = rt.screens.get(rt.int.windows.get(0)!.screenSlot)!
    return { rt, point: (x, y) => scr.rp.point(x, y) }
  }

  /**
   * The bank number is a literal in the code (`moveq #$2,d3` walking AMOS's
   * own list at `$5ea(a5)`), not an argument, and the eight bytes it checks
   * are `$49636f6e` and `$73202020` --- "Icons   ".
   */
  it('draws icon n of bank 2 at x,y in the window', () => {
    const p = paste(`${ICON}\n${WIN}\nWb Paste Icon 40,30,1`)
    expect(p.point(40, 30)).toBe(3)
    expect(p.point(55, 45)).toBe(3)
    expect(p.point(56, 46)).toBe(0)
    expect(p.point(39, 30)).toBe(0)
  })

  /**
   * DrawImage is a blitter copy through PlanePick and not a drawn primitive,
   * so colour 0 in the icon is a colour and paints.
   */
  it('colour 0 in the icon is a colour, not a hole', () => {
    const p = paste(
      `Screen Open 1,64,64,16,Lowres : Cls 0 : Ink 3 : Bar 0,0 To 15,15 : Get Icon 1,0,0 To 16,32
${WIN}
Wb Front Pen 5 : Wb Fill Box 40,30 To 60,70
Wb Paste Icon 40,30,1`,
    )
    // the bar covers the icon's top half; its bottom half is colour 0 and it
    // overwrites the pen-5 fill rather than leaving it showing through
    expect(p.point(45, 35)).toBe(3)
    expect(p.point(45, 55)).toBe(0)
  })

  /** `cmp.w d0,d7 / blt` --- an index above the count returns quietly */
  it('an index above the count draws nothing and raises nothing', () => {
    const p = paste(`${ICON}\n${WIN}\nWb Paste Icon 40,30,9`)
    expect(p.point(45, 35)).toBe(0)
  })

  /** neither "Icons   " nor a bank at all is error 20 */
  it('no icon bank is No Icons In Bank', () => {
    expect(() => run(`${WIN}\nWb Paste Icon 40,30,1`)).toThrow(INT_ERRORS[INT_ERR.NO_ICONS_IN_BANK])
  })

  /** and the window lookup is the same `moveq #$b,d0` as the drawing group */
  it('no window open is Window Is Not Open', () => {
    expect(() => run(`${ICON}\n${SCREEN}\nWb Window Num 4 : Wb Paste Icon 0,0,1`)).toThrow(
      INT_ERRORS[INT_ERR.WINDOW_IS_NOT_OPEN],
    )
  })
})

/**
 * The IFF group: a bank holding the file whole, and the two keywords that
 * read it back.
 *
 * iff_to_bank.AMOS is the shape all three are used in, and where the bank's
 * layout is stated from the other side: `BASE=Start(1)` then `Deek(BASE)`,
 * `Deek(BASE+2)`, `Deek(BASE+4)` and `Deek(BASE+6)` for width, height, mode
 * and depth.
 */
describe('Int 1.0: the IFF group', () => {
  const SCREEN = 'Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 0,0,0,320,256,4,0,1,%0'
  const WIN = `${SCREEN} : ${FLAGS} : ${IDS} : Wb Open Window 0,0,0,320,256,10,10,320,256 : Wb Window Num 0`

  /** a picture whose pixel at (x,y) is (x+y) & 3, so a blit's offset shows */
  function picture(width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = (x + y) & 3
    return encodeIlbm({ width, height, depth: 2, mode: 0x8004, palette: [0x000, 0xf00, 0x0f0, 0x00f], pixels })
  }

  function withPic(src: string, w = 32, h = 32): { rt: Runtime; out: string } {
    const b = boot(src, { 'pic.iff': picture(w, h), 'notiff.txt': new Uint8Array([1, 2, 3, 4]) })
    mustFinish(b.rt.runHeadless(3_000))
    return { rt: b.rt, out: b.out().trim() }
  }

  /**
   * Routine 49 reserves `size + 16` under the name at `$e6c`, which is the
   * string "IFF.Pic." at code $1536, reads the file in whole and only then
   * walks it for BMHD and CAMG. On the machine the bank's eight-byte name
   * sits in front of the four words and `Start` answers past it; the name is
   * a field of the bank here, so the reserve is still `size + 16` and the
   * last eight bytes go unused.
   */
  it('Wb Iff To Bank stores the file whole behind four words', () => {
    const r = withPic(`Wb Iff To Bank "pic.iff",1
BASE=Start(1)
Print Deek(BASE);",";Deek(BASE+2);",";Hex$(Deek(BASE+4));",";Deek(BASE+6)`)
    expect(r.out.replace(/\s+/g, '')).toBe('32,32,$8004,2')
    const mem = r.rt.memBanks.get(1)!
    expect(mem.name).toBe('IFF.Pic.')
    // the FORM begins eight bytes in, which is what `Wb Image To Window` and
    // `Wb Get Iff Palette` both walk from
    expect(String.fromCharCode(...mem.data.subarray(8, 12))).toBe('FORM')
    expect(mem.data.length).toBe(picture(32, 32).length + 16)
  })

  /** the bank number is checked before anything is opened */
  it('bank 0 is Bank Number Is To Low', () => {
    expect(() => withPic('Wb Iff To Bank "pic.iff",0')).toThrow(INT_ERRORS[22])
  })

  /** `move.w (a0)+,d1 / beq` --- an empty name never reaches Open */
  it('an empty or missing file is File Not Found', () => {
    expect(() => withPic('Wb Iff To Bank "",1')).toThrow(INT_ERRORS[14])
    expect(() => withPic('Wb Iff To Bank "nope.iff",1')).toThrow(INT_ERRORS[14])
  })

  /**
   * The FORM check happens AFTER the whole file is in the bank, so a file
   * that is not a picture is read in full before it is refused.
   */
  it('a file that is not FORM....ILBM is Not An IFF File, after it is read', () => {
    expect(() => withPic('Wb Iff To Bank "notiff.txt",1')).toThrow(INT_ERRORS[15])
  })

  /**
   * `move.l (a0)+,d0 / divu.w #$3,d0` for the count, then four instructions
   * of packing with no rounding: each 8-bit component keeps its top nibble.
   */
  it('Wb Get Iff Palette walks the FORM for CMAP and loads the screen', () => {
    const r = withPic(`Wb Iff To Bank "pic.iff",1
${SCREEN}
Wb Get Iff Palette 1,0`)
    const slot = r.rt.intuition.slotOf(r.rt.int.screens.get(0)!)!
    expect([...r.rt.screens.get(slot)!.palette.slice(0, 4)]).toEqual([0x000, 0xf00, 0x0f0, 0x00f])
    // and it goes through the same `$884` table `Wb Palette` writes
    expect([...r.rt.int.colours.slice(0, 4)]).toEqual([0x000, 0xf00, 0x0f0, 0x00f])
  })

  /** a bank whose eight bytes are neither name is error 16 */
  it('a bank that is not an IFF bank is No IFF In Bank', () => {
    expect(() => withPic(`${SCREEN}\nReserve As Work 3,64 : Wb Get Iff Palette 3,0`)).toThrow(INT_ERRORS[16])
    expect(() => withPic(`${SCREEN}\nWb Get Iff Palette 5,0`)).toThrow(INT_ERRORS[16])
  })

  /** and a screen number with nothing in the `$6d4` table is error 36 */
  it('a screen number nothing opened is Cannot Find Screen', () => {
    expect(() => withPic(`Wb Iff To Bank "pic.iff",1\nWb Get Iff Palette 1,4`)).toThrow(INT_ERRORS[36])
  })

  /**
   * DrawImage at 0,0 in wd_RPort, so the picture lands at the window's
   * top-left INCLUDING its border --- the title bar is drawn over the top of
   * it by the frame loop, exactly as Intuition draws over a window that
   * renders under its own decoration.
   *
   * Window first and bank second, which is the reverse of
   * `Wb Get Iff Palette`: routine 50 pops the bank into d3 and the window
   * into d7.
   */
  it('Wb Image To Window draws at the window origin and brings its palette', () => {
    const r = withPic(`Wb Iff To Bank "pic.iff",1
${WIN}
Wb Image To Window 0,1`)
    const scr = r.rt.screens.get(r.rt.int.windows.get(0)!.screenSlot)!
    // the window is at 0,0 and its title bar covers the first rows, so read
    // one well below it; the picture's pixel at (x,y) is (x+y) & 3
    for (let x = 8; x < 16; x++) expect(scr.rp.point(x, 20)).toBe((x + 20) & 3)
    expect([...scr.palette.slice(0, 4)]).toEqual([0x000, 0xf00, 0x0f0, 0x00f])
  })

  /** the same `moveq #$b,d0` window lookup as everything else here */
  it('Wb Image To Window with no such window is Window Is Not Open', () => {
    expect(() => withPic(`Wb Iff To Bank "pic.iff",1\n${SCREEN}\nWb Image To Window 6,1`)).toThrow(
      INT_ERRORS[INT_ERR.WINDOW_IS_NOT_OPEN],
    )
  })
})

/**
 * `Wb Default` --- the teardown, with no arguments at all.
 */
describe('Int 1.0: Wb Default', () => {
  const SCREEN = 'Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 0,0,0,320,256,4,0,1,%0'

  /**
   * It counts DOWN from `$b66` to zero and closes every window, then does the
   * same over the screen table, then `move.l #$ffffffff,$de6` so the next
   * window opens on the Workbench again.
   */
  it('closes every window and screen and sends new windows back to the Workbench', () => {
    const rt = run(`${SCREEN} : ${FLAGS} : ${IDS}
Wb Open Window 0,0,0,160,100,10,10,320,256
Wb Open Window 3,20,20,160,100,10,10,320,256
Wb Default`)
    expect([...rt.int.windows.keys()]).toEqual([])
    expect([...rt.int.screens.keys()]).toEqual([])
    expect(rt.int.screen).toBe(-1)
    expect(rt.intuition.windows).toHaveLength(0)
  })

  /** and a window opened after it lands on the Workbench, not on nothing */
  it('a window opened afterwards is a Workbench window', () => {
    const rt = run(`${SCREEN} : ${FLAGS} : ${IDS}
Wb Open Window 0,0,0,160,100,10,10,320,256
Wb Default
Wb Open Window 0,0,10,320,120,100,50,640,240`)
    expect(rt.int.windows.get(0)!.screenSlot).toBe(WB_SLOT)
  })

  /**
   * Three things routine 39 never touches, and each is visible afterwards:
   * `$d94`, the colour table at `$884`, and the three requester settings.
   */
  it('leaves the current window number, the colours and the settings alone', () => {
    const rt = run(`${SCREEN} : ${FLAGS} : ${IDS}
Wb Open Window 2,0,0,160,100,10,10,320,256
Wb Window Num 2
Wb Palette 0,$111,$222,$333,$444,$555,$666,$777,$888
Wb Asl Info 1 : Wb Asl Dir "SYS:"
Wb Default`)
    expect(rt.int.window).toBe(2)
    expect(rt.int.colours[1]).toBe(0x222)
    expect(rt.int.aslHideInfo).toBe(1)
    expect(String.fromCharCode(...rt.int.aslDir.subarray(0, 4))).toBe('SYS:')
  })

  /** nothing open is not an error: the descent simply finds empty entries */
  it('with nothing open it does nothing and raises nothing', () => {
    expect(() => run('Wb Default')).not.toThrow()
  })
})

/**
 * `Wb Save Iff file$,screen` --- a screen out to an ILBM through iffparse.
 *
 * The second argument is a `Wb Open Screen` number and not a bank: routine 89
 * indexes `$6d4(a4)` with it, and -1 goes through routine 88, which
 * LockPubScreens the Workbench.
 */
describe('Int 1.0: Wb Save Iff', () => {
  const SCREEN = 'Wb Screen Flags %1111,0,0,0,0,0,0,0 : Wb Open Screen 0,0,0,64,32,2,0,1,%0'

  function save(src: string): { rt: Runtime; file: Uint8Array | null } {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[25, ext]]),
      maxSteps: 3_000_000,
      fs,
      onText: (t) => (out += t),
    })
    mustFinish(rt.runHeadless(3_000))
    return { rt, file: fs.read('DH0:out.iff') }
  }

  /**
   * The BODY IS NOT COMPRESSED, unlike AMOS's own `Save Iff`. Routine 89
   * builds its BMHD in zone memory that starts zeroed and writes only Width,
   * Height, nPlanes, PageWidth and PageHeight into it, so the compression
   * byte at +10 stays 0 -- and there is no ByteRun1 packer in its 2,166 bytes
   * to put a 1 there.
   */
  it('writes an uncompressed ILBM with a zero aspect', () => {
    const r = save(`${SCREEN}\nWb Save Iff "DH0:out.iff",0`)
    const f = r.file!
    expect(f).not.toBeNull()
    expect(String.fromCharCode(...f.subarray(0, 4))).toBe('FORM')
    expect(String.fromCharCode(...f.subarray(8, 12))).toBe('ILBM')
    expect(String.fromCharCode(...f.subarray(12, 16))).toBe('BMHD')
    // BMHD is at 20: width, height, x, y, nPlanes, masking, compression
    expect((f[20]! << 8) | f[21]!).toBe(64)
    expect((f[22]! << 8) | f[23]!).toBe(32)
    expect(f[28]).toBe(2) // nPlanes
    expect(f[30]).toBe(0) // compression, where AMOS's own Save Iff writes 1
    expect(f[34]).toBe(0) // xAspect
    expect(f[35]).toBe(0) // yAspect
  })

  /** and what it wrote reads back as the picture it was given */
  it('the file it writes decodes to the screen it was given', () => {
    const r = save(`${SCREEN}\nWb Save Iff "DH0:out.iff",0`)
    const back = parseIlbm(r.file!)
    expect([back.width, back.height, back.depth]).toEqual([64, 32, 2])
  })

  /** a screen number with nothing in the `$6d4` table is error 36 */
  it('a screen nothing opened is Cannot Find Screen', () => {
    expect(() => save('Wb Save Iff "DH0:out.iff",7')).toThrow(INT_ERRORS[INT_ERR.CANNOT_FIND_SCREEN])
  })

  /** -1 is routine 88, which locks the public screen: the Workbench */
  it('screen -1 is the Workbench', () => {
    const r = save('Wb Save Iff "DH0:out.iff",-1')
    const back = parseIlbm(r.file!)
    expect(back.width).toBe(640)
  })
})
