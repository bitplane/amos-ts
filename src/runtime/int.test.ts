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
import { BARLABEL, NM } from '../amiga/gadtools'
import { IDCMP_CLOSEWINDOW, WB_SLOT } from '../amiga/intuition'

const table = new TokenTable(CORE_TOKENS)
/** slot 25 — "alter extension number 25 to :APSystem/AMOSPro_Int.Lib" */
const ext = extensionById('int-1.0')!
const exts = new Map([[25, ext.table]])

function boot(src: string): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[25, ext]]),
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

  it('opening the same number twice is This Window Is Already Opened', () => {
    expect(() => run(`${open} : Wb Open Window 0,0,10,320,120,100,50,640,240`)).toThrow(
      INT_ERRORS[INT_ERR.WINDOW_ALREADY_OPENED],
    )
  })

  it('Wb Close Window takes it away again', () => {
    expect(run(`${open} : Wb Close Window 0`).int.windows.size).toBe(0)
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
   */
  it('the three menu readers start at 0 and are one-based after a pick', () => {
    const rt = run(open)
    const st = rt.int
    expect([st.menu, st.item, st.sub]).toEqual([-1, -1, -1])
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
