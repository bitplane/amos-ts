/**
 * JD Intuition 1.3, against `AMOSPro_JDInt.Lib` disassembled with `extdis
 * jd-int-1.3` and against `AMOSPro_JDInt.Lib.MANUAL`.
 *
 * Two of the assertions here are the manual being WRONG, and they are the
 * reason this file leans on the binary: `Jd Open Intscreen` takes a depth and
 * a view mode where the manual promises an X and a Y, and `Jd Intcolour` takes
 * two arguments where the manual gives one. A suite written from the German
 * page would have pinned both mistakes as the contract.
 *
 * Most of the drawing keywords are exercised through routine 30's THIRD
 * fallback — no Intuition window, no Intuition screen, so the pixels land on
 * AMOS's own RastPort. That is not a shortcut around opening a screen; it is
 * what the routine does, and it is the path a program that only wants
 * graphics.library's argument order actually takes.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 18 — routine 0's `moveq #$11,d0`, and `$208(a5)` is `$f8 + 17*16` */
const jd = extensionById('jd-int-1.3')!
const exts = new Map([[18, jd.table]])

function boot(src: string): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[18, jd]]),
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

/** run a program, then print an expression: `Print` binds tighter than `:` */
const val = (expr: string, setup = ''): string => {
  const b = boot(`${setup === '' ? '' : `${setup}\n`}Print ${expr}`)
  mustFinish(b.rt.runHeadless(2_000))
  return b.out().trim()
}

/** the pixel under a point of AMOS's current screen, which is where the fallback draws */
const px = (rt: Runtime, x: number, y: number): number => rt.screen.rp.point(x, y)

describe('JD Intuition: drawing without a window, which routine 30 allows', () => {
  it('Jd Intplot and Jd Intpoint go to AMOS\'s own RastPort', () => {
    // routine 30 falls all the way through to -$18ca(a5) when neither an
    // Intuition window nor screen is current
    const rt = run('Jd Intpen 3 : Jd Intplot 10,10')
    expect(px(rt, 10, 10)).toBe(3)
    expect(val('Jd Intpoint(4,4)', 'Jd Intpen 5 : Jd Intplot 4,4')).toBe('5')
  })

  it('Jd Intbar fills, Jd Intbox only outlines', () => {
    const rt = run('Jd Intpen 2 : Jd Intbar 0,0 To 4,4 : Jd Intpen 1 : Jd Intbox 10,10 To 14,14')
    expect(px(rt, 2, 2)).toBe(2) // filled through the middle
    expect(px(rt, 10, 10)).toBe(1) // a corner of the outline
    expect(px(rt, 14, 14)).toBe(1)
    expect(px(rt, 12, 12)).toBe(1) // and nothing inside it: AMOS boots its screen to paper 1
  })

  it('Jd Intline draws between the two points and leaves the cursor at the far end', () => {
    const rt = run('Jd Intpen 4 : Jd Intline 0,0 To 6,0')
    expect(px(rt, 3, 0)).toBe(4)
    expect(val('Jd Intcurs(x)', 'Jd Intline 0,0 To 6,3')).toBe('6')
    expect(val('Jd Intcurs(y)', 'Jd Intline 0,0 To 6,3')).toBe('3')
  })

  it('Jd Intellipse takes RADII, not a second corner', () => {
    // DrawEllipse(rp,xCenter,yCenter,a,b) -- the manual agrees here
    const rt = run('Jd Intpen 6 : Jd Intellipse 50,50,20,10')
    expect(px(rt, 70, 50)).toBe(6) // +a on the x axis
    expect(px(rt, 50, 40)).toBe(6) // -b on the y axis
    expect(px(rt, 50, 50)).toBe(1) // hollow, so still the boot paper
  })

  it('Jd Intmove sets the graphics cursor and Jd Intlocate the TEXT one', () => {
    // routine 7 is `asl.l #3` on each with +2 on the x and +$10 on the y: an
    // 8x8 cell, offset past the window border and title bar
    expect(val('Jd Intcurs(x)', 'Jd Intmove 12,34')).toBe('12')
    expect(val('Jd Intcurs(y)', 'Jd Intmove 12,34')).toBe('34')
    expect(val('Jd Intcurs(x)', 'Jd Intlocate 3,2')).toBe('26') // 3*8+2
    expect(val('Jd Intcurs(y)', 'Jd Intlocate 3,2')).toBe('32') // 2*8+16
  })

  it('Jd Intcls with no argument clears to the paper, with one to that colour', () => {
    // two token ids and two routines: id 496 is ClearScreen (-48), id 512 is
    // SetRast (-234). The author wrote both rather than tripping over arity.
    const cleared = run('Jd Intpen 7 : Jd Intbar 0,0 To 9,9 : Jd Intcls')
    expect(px(cleared, 5, 5)).toBe(0)
    const filled = run('Jd Intcls 3')
    expect(px(filled, 5, 5)).toBe(3)
  })

  it('Jd Intdrawmode reaches the RastPort, so COMPLEMENT inverts', () => {
    // drawMode 2 is COMPLEMENT; plotting pen 3 twice returns to the ground
    const rt = run('Jd Intcls 0 : Jd Intdrawmode 2 : Jd Intpen 3 : Jd Intplot 8,8 : Jd Intplot 8,8')
    expect(px(rt, 8, 8)).toBe(0)
  })
})

describe('JD Intuition: the screen, where the manual is wrong', () => {
  /**
   * Routine 5 writes `move.w #$0` into NewScreen.LeftEdge and TopEdge and puts
   * the four arguments in Width, Height, Depth and ViewModes. The manual says
   * "X, Y, Breite und Hoehe".
   */
  it('Jd Open Intscreen takes W,H,DEPTH,VIEWMODES and not X,Y,W,H', () => {
    const rt = run('S=Jd Open Intscreen(320,200,3,0)')
    const addr = rt.jdint.screen
    expect(addr).not.toBe(0)
    const slot = rt.intuition.slotOf(addr)!
    const s = rt.screens.get(slot)!
    expect(s.width).toBe(320)
    expect(s.height).toBe(200)
    expect(s.nColors).toBe(8) // depth 3
  })

  it('bit 15 of the view mode is HIRES', () => {
    const rt = run('S=Jd Open Intscreen(640,256,2,$8000)')
    const s = rt.screens.get(rt.intuition.slotOf(rt.jdint.screen)!)!
    expect(s.hires).toBe(true)
  })

  it('a depth the display cannot do answers 0', () => {
    expect(val('Jd Open Intscreen(320,200,9,0)')).toBe('0')
    expect(val('Jd Open Intscreen(0,200,3,0)')).toBe('0')
  })

  /**
   * DEFECT: routine 39 reads `$a(screen)` and routine 40 reads `$c(screen)`.
   * In `struct Screen` those are TopEdge and Width, where Width is `$c` and
   * Height is `$e`. The same binary confirms the layout by taking the ViewPort
   * at `$2c` and the RastPort at `$54`.
   */
  it('Jd Intscreen Width answers TopEdge and Height answers the WIDTH', () => {
    expect(val('Jd Intscreen Width', 'S=Jd Open Intscreen(320,200,3,0)')).toBe('0')
    expect(val('Jd Intscreen Height', 'S=Jd Open Intscreen(320,200,3,0)')).toBe('320')
  })

  it('Jd Intcolour takes an index AND a $RGB, and writes the palette', () => {
    // the manual says one parameter and calls it the drawing colour; routine
    // 18 pops two and divides the second by $100 then $10
    const rt = run('S=Jd Open Intscreen(320,200,3,0) : Jd Intcolour 2,$F80')
    const s = rt.screens.get(rt.intuition.slotOf(rt.jdint.screen)!)!
    expect(s.palette[2]).toBe(0xf80)
  })

  it('Jd Use Intscreen only accepts a screen this extension opened', () => {
    const rt = run('S=Jd Open Intscreen(320,200,3,0) : Jd Use Intscreen 12345 : Jd Use Intscreen S')
    expect(rt.jdint.screen).not.toBe(0)
    expect(rt.jdint.screen).not.toBe(12345)
  })

  it('Jd Close Intscreen takes it back out of the list', () => {
    const rt = run('S=Jd Open Intscreen(320,200,3,0) : Jd Close Intscreen S')
    expect(rt.jdint.screens).toEqual([])
    expect(rt.jdint.screen).toBe(0)
  })
})

describe('JD Intuition: windows', () => {
  it('a window opens on the current Intuition screen and answers its address', () => {
    const rt = run('S=Jd Open Intscreen(320,200,3,0) : W=Jd Open Intwindow(10,10,100,50,"Hi")')
    expect(rt.jdint.win).not.toBeNull()
    expect(rt.jdint.win!.w.leftEdge).toBe(10)
    expect(rt.jdint.win!.w.width).toBe(100)
    expect(rt.jdint.windows.length).toBe(1)
  })

  /**
   * Routine 3 tests the title's LENGTH and, when it is zero, nulls the pointer
   * and rewrites Flags from `$21000` to `$21800` — WFLG_BORDERLESS. A window
   * with no name has no frame.
   */
  it('an empty title makes the window BORDERLESS', () => {
    const named = run('S=Jd Open Intscreen(320,200,3,0) : W=Jd Open Intwindow(0,0,100,50,"T")')
    expect(named.jdint.win!.w.borderless).toBe(false)
    const bare = run('S=Jd Open Intscreen(320,200,3,0) : W=Jd Open Intwindow(0,0,100,50,"")')
    expect(bare.jdint.win!.w.borderless).toBe(true)
  })

  it('a window that will not fit answers 0 and leaves nothing current', () => {
    const rt = run('S=Jd Open Intscreen(320,200,3,0) : W=Jd Open Intwindow(300,0,100,50,"T")')
    expect(rt.jdint.win).toBeNull()
    expect(rt.jdint.windows).toEqual([])
  })

  it('Jd Use Intwindow and Jd Close Intwindow work by the returned address', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'A=Jd Open Intwindow(0,0,100,50,"a")',
        'B=Jd Open Intwindow(0,60,100,50,"b")',
        'Jd Use Intwindow A',
      ].join('\n'),
    )
    expect(rt.jdint.win!.addr).toBe(rt.jdint.windows[0]!.addr)
    const closed = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'A=Jd Open Intwindow(0,0,100,50,"a")',
        'Jd Close Intwindow A',
      ].join('\n'),
    )
    expect(closed.jdint.windows).toEqual([])
    // routine 4 leaves the current window pointing at what it just closed
    expect(closed.jdint.win).toBeNull()
  })

  it('drawing goes into the window, offset by its top-left and clipped to it', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(20,30,100,50,"t")',
        'Jd Intpen 5',
        'Jd Intplot 0,0',
        'Jd Intplot 500,0',
      ].join('\n'),
    )
    const s = rt.screens.get(rt.intuition.slotOf(rt.jdint.screen)!)!
    expect(s.rp.point(20, 30)).toBe(5) // window-relative 0,0
    expect(s.rp.point(0, 0)).toBe(0) // and not the screen's own origin
  })

  it('Jd Intmouse reads the window-relative pointer, 0 with no window', () => {
    expect(val('Jd Intmouse(x)')).toBe('0')
    expect(val('Jd Intmouse(y)')).toBe('0')
  })
})

describe('JD Intuition: gadgets and events', () => {
  it('Jd Intzone turns a corner pair into a width and a height', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"t")',
        'Jd Intzone 1,10,20 To 40,60',
      ].join('\n'),
    )
    expect(rt.jdint.win!.w.gadgets).toEqual([{ leftEdge: 10, topEdge: 20, width: 30, height: 40, id: 1 }])
  })

  it('Jd Rem Intzones empties the list', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"t")',
        'Jd Intzone 1,0,0 To 10,10',
        'Jd Intzone 2,20,0 To 30,10',
        'Jd Rem Intzones',
      ].join('\n'),
    )
    expect(rt.jdint.win!.w.gadgets).toEqual([])
  })

  it('Jd Intclass is -1 until something has been read, and Jd Intevent answers -1 with no window', () => {
    expect(val('Jd Intclass')).toBe('-1')
    expect(val('Jd Intevent')).toBe('-1')
    expect(val('Jd Intclass', 'E=Jd Intevent')).toBe('-1')
  })

  /**
   * The manual's own table: -1 nothing, 0 disk removed, 1 disk inserted,
   * 2 menu, 3 gadget, 4 key. Routine 10 dispatches on the IDCMP class and
   * leaves the number at zone+$60 for `Jd Intclass`.
   */
  it('a key is class 4 and its code', () => {
    const b = boot(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"t")',
        'E=Jd Intevent',
        'Print E;",";Jd Intclass',
      ].join('\n'),
    )
    b.rt.pressKey('A', 0x20)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('65, 4')
  })

  /**
   * A boolean gadget with GA_RelVerify fires on the RELEASE and only if the
   * pointer is still inside it, so a press you drag off is a press you
   * cancelled. Asserted on the message queue rather than through the blocking
   * `Jd Intevent`, because what is being tested is which IDCMP message
   * Intuition raises; `Jd Intevent`'s own classification is tested above.
   */
  it('a click inside a gadget raises GADGETUP carrying its id', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"")',
        'Jd Intzone 7,10,10 To 50,30',
      ].join('\n'),
    )
    const slot = rt.intuition.slotOf(rt.jdint.screen)!
    const w = rt.jdint.win!.w
    rt.intuition.handleInput(slot, 20, 20, 1)
    rt.intuition.handleInput(slot, 20, 20, 0)
    const msgs = []
    for (let m = w.getMsg(); m; m = w.getMsg()) msgs.push(m)
    const up = msgs.find((m) => m.class === 0x40)
    expect(up).toBeDefined()
    expect(up!.iaddress).toBe(7)
  })

  it('a press dragged OFF the gadget raises no GADGETUP', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"")',
        'Jd Intzone 7,10,10 To 50,30',
      ].join('\n'),
    )
    const slot = rt.intuition.slotOf(rt.jdint.screen)!
    const w = rt.jdint.win!.w
    rt.intuition.handleInput(slot, 20, 20, 1)
    rt.intuition.handleInput(slot, 150, 90, 0)
    const msgs = []
    for (let m = w.getMsg(); m; m = w.getMsg()) msgs.push(m)
    expect(msgs.some((m) => m.class === 0x40)).toBe(false)
  })
})

describe('JD Intuition: Jd Intfill', () => {
  /**
   * Undocumented — the manual has no page for it — and `graphics_lib.fd` gives
   * `Flood(rp,mode,x,y)(a1,d2,d0/d1)` at -330, which is the `jsr -$14a(a6)`
   * routine 26 makes with `moveq #$1,d2`.
   */
  /**
   * `moveq #$1,d2` is Flood's OUTLINE mode: it spreads over every connected
   * pixel that is NOT rp_AOlPen. And nothing in this extension sets AOlPen —
   * there is no keyword for it — so the boundary is always colour 0, whatever
   * the program drew its outline in.
   *
   * So an outline in pen 1 does not bound anything, and a region cleared to 0
   * is not fillable at all. The one shape that works is the one below: an
   * outline drawn in pen 0 on a non-zero ground.
   */
  it('spreads until it meets colour 0, which is the AOlPen nothing sets', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"")',
        'Jd Intcls 3',
        'Jd Intpen 0',
        'Jd Intbox 10,10 To 30,30',
        'Jd Intpen 2',
        'Jd Intfill 20,20',
      ].join('\n'),
    )
    const s = rt.screens.get(rt.intuition.slotOf(rt.jdint.screen)!)!
    expect(s.rp.point(20, 20)).toBe(2) // inside, filled
    expect(s.rp.point(10, 10)).toBe(0) // the pen-0 outline is the boundary
    expect(s.rp.point(40, 40)).toBe(3) // and nothing escaped it
  })

  it('an outline in any other pen does not bound it', () => {
    const rt = run(
      [
        'S=Jd Open Intscreen(320,200,3,0)',
        'W=Jd Open Intwindow(0,0,200,100,"")',
        'Jd Intcls 3',
        'Jd Intpen 1',
        'Jd Intbox 10,10 To 30,30',
        'Jd Intpen 2',
        'Jd Intfill 20,20',
      ].join('\n'),
    )
    const s = rt.screens.get(rt.intuition.slotOf(rt.jdint.screen)!)!
    expect(s.rp.point(20, 20)).toBe(2)
    expect(s.rp.point(40, 40)).toBe(2) // straight over the pen-1 outline
  })

  /**
   * DEFECT: routine 26 takes the RastPort from `$32` of the current window
   * with no null check, where every other drawing keyword goes through routine
   * 30's fallback. With nothing open the machine reads address `$32`.
   */
  it('does nothing at all without a window, where every other drawing keyword still draws', () => {
    const rt = run('Jd Intpen 3 : Jd Intplot 5,5 : Jd Intfill 50,50')
    expect(px(rt, 5, 5)).toBe(3) // Jd Intplot took the AMOS fallback
    expect(px(rt, 50, 50)).toBe(1) // Jd Intfill did not: still the boot paper
  })
})
