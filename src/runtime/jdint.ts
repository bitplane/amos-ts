/**
 * JD Intuition 1.3 — Joerg Dommermuth, thirty-four keywords at slot 18.
 *
 * An Intuition screen, a window on it, graphics.library primitives to draw
 * into it, boolean gadgets to click and an IDCMP loop to read. It is the
 * smallest complete Intuition surface in the registry, and every keyword is a
 * thin wrapper: parse the arguments, fetch a RastPort, make one library call.
 *
 * ## Evidence
 *
 * BINARY tier — `AMOSPro_JDInt.Lib`, a 5,344-byte code hunk with 43 jump-table
 * entries, 34 of them keywords; `extdis jd-int-1.3` disassembles it. Beside it
 * is `AMOSPro_JDInt.Lib.MANUAL`, a German page per keyword giving the syntax
 * and the return value. Where the two disagree the code is what is written
 * down here and the disagreement is said — and they disagree twice, once
 * about how many arguments a keyword takes.
 *
 * The slot is the binary's twice over. Routine 0 ends `moveq #$11,d0`, the
 * extension number 18-1, and every routine reaches its data zone through
 * `$208(a5)`, which is `$f8 + 17*16`. Routine 0 also publishes the zone —
 * `lea $3b0(pc),a3 / move.l a3,$208(a5)` — so `$3b8` absolute and `$8(zone)`
 * are the same field, and the code uses both spellings for it.
 *
 * The library keeps its two library bases in the zone, taken from AMOS's own:
 * `-$18a6(a5)` is IntuitionBase and goes to zone+$14, `-$18ae(a5)` is GfxBase
 * and goes to zone+$18. Every LVO below was checked against the FD files
 * shipped in GUI 2.10's `Tools/FD` directory rather than recalled.
 *
 * ## The data zone, as the routines use it
 *
 *     +$00  current window            +$60  class of the last event
 *     +$04  current screen            +$64  newest gadget
 *     +$08  window list head          +$68  first gadget
 *     +$10  screen list head          +$6c  previous gadget
 *     +$14  IntuitionBase             +$70  a 48-byte Gadget template
 *     +$18  GfxBase                   +$96  ...whose GadgetID is here
 *     +$4c  last window opened        +$9c  the Flood raster
 *     +$54  last screen opened        +$a0  its TmpRas
 *     +$c8  a NewWindow               +$fe  a NewScreen
 *
 * The two lists are 8-byte nodes — `next` then the window or screen pointer —
 * AllocMem'd one per open and FreeMem'd on close.
 *
 * ## Where drawing goes, and it is not always Intuition
 *
 * Routine 30 is the one every drawing keyword calls first, and it answers the
 * question "which RastPort" in three steps: the current WINDOW's RPort
 * (`$32(window)`), else the current SCREEN's RastPort (`$54(screen)`), else
 * `-$18ca(a5)` — **AMOS's own RastPort**. So a program that has opened nothing
 * still draws, straight onto the AMOS screen it was already using, and
 * `Jd Intbar` becomes a second `Bar` with graphics.library's argument order.
 * That fallback is modelled here; it is the reason these keywords can be
 * tested without an Intuition screen existing at all.
 *
 * ## What the manual gets wrong
 *
 * - **`Jd Open Intscreen` does not take X and Y.** The manual says *"X, Y,
 *   Breite und Hoehe"*, and routine 5 writes `#$0` into NewScreen.LeftEdge and
 *   TopEdge and puts the four arguments in Width, Height, **Depth** and
 *   **ViewModes**. A program following the manual opens a screen of its
 *   intended width and height at depth `W` and view mode `H`.
 * - **`Jd Intcolour` takes two arguments, and sets a palette entry.** The
 *   manual gives one — *"Parameter: Farb-Nr."* — and calls it *"setzt
 *   Zeichenfarbe"*, the drawing colour, which is `Jd Intpen`. Routine 18 pops
 *   two, splits the second into three nibbles and calls SetRGB4 on the current
 *   screen's ViewPort.
 * - **`Jd Intfill` is not in the manual at all**, nor is the argument form of
 *   `Jd Intcls`. Both are in the token table and both have bodies.
 *
 * ## Defects
 *
 * - **`Jd Intscreen Width` and `Jd Intscreen Height` are off by one field.**
 *   Routine 39 reads `$a(screen)` and routine 40 reads `$c(screen)`, which in
 *   `struct Screen` are TopEdge and Width. Width should be `$c` and Height
 *   `$e`. The screen is opened with TopEdge 0, so `Jd Intscreen Width` answers
 *   0 and `Jd Intscreen Height` answers the width. The layout is confirmed
 *   from the same binary: routine 18 takes the ViewPort at `$2c(screen)` and
 *   routine 30 the RastPort at `$54(screen)`, which are 44 and 84, exactly
 *   where the standard struct puts them.
 * - **`Jd Intfill` has no null check.** Every other drawing keyword goes
 *   through routine 30's three-way fallback; routine 26 dereferences the
 *   current window directly, so with none open it reads `$32` as an address.
 * - **The TmpRas is declared twice the size of the raster behind it.**
 *   Routine 31 calls `AllocRaster(width,height)` and then `InitTmpRas` with a
 *   flat `#$a000` — 40,960 bytes — where a 640x256 window's raster is 20,480.
 * - **And it is freed with the wrong dimensions.** Routine 32 keeps the raster
 *   POINTER at zone+$9c and then reads `$8` and `$a` OFF THAT POINTER as the
 *   width and height to pass to `FreeRaster` — two words of the raster's own
 *   pixels, not the window's size.
 * - **A failed OpenWindow is not noticed.** Routine 3 stores the result and
 *   carries on, so the list node is allocated and linked with a null window in
 *   it. The keyword does answer 0, which is what a program can test.
 *
 * NONE of the four memory defects is reproduced: there is no TmpRas here to
 * size wrongly and no raster to free, because `RastPort.flood` needs neither.
 * The two behavioural ones — the off-by-one geometry and the missing null
 * check — are.
 */
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { VI, int, str } from '../interp/values'
import { RastPort } from '../amiga/graphics'
import {
  CUSTOMSCREEN,
  IDCMP_DISKINSERTED,
  IDCMP_DISKREMOVED,
  IDCMP_GADGETUP,
  IDCMP_MENUPICK,
  IDCMP_VANILLAKEY,
  WBENCHSCREEN,
  WFLG_ACTIVATE,
  WFLG_BACKDROP,
  WFLG_BORDERLESS,
  type Window,
} from '../amiga/intuition'

/**
 * `NewWindow.IDCMPFlags` is `$218160` and `Flags` is `$21000`, both assembled
 * into routine 3 as literals. The IDCMP set is exactly the five classes
 * `Jd Intclass` can report plus GADGETDOWN, which routine 10 receives and
 * throws away.
 */
const JD_IDCMP =
  IDCMP_VANILLAKEY | IDCMP_DISKREMOVED | IDCMP_DISKINSERTED | IDCMP_MENUPICK | IDCMP_GADGETUP | 0x20
/** WFLG_NOCAREREFRESH | WFLG_ACTIVATE — no drag bar, no close gadget, no sizing */
const JD_WFLAGS = 0x2_0000 | WFLG_ACTIVATE

/** one entry of the window list at zone+$8, plus the RastPort the window draws through */
interface JdWindow {
  /** the `struct Window *` a program holds */
  addr: number
  w: Window
  rp: RastPort
}

export interface JdIntState {
  /** zone+$00 */
  win: JdWindow | null
  /** zone+$04 — the `struct Screen *`, 0 for none */
  screen: number
  /** zone+$08, oldest first */
  windows: JdWindow[]
  /** zone+$10 */
  screens: number[]
  /** zone+$60 — -1 until something has been read */
  lastClass: number
  /** zone+$96 — the id the next Jd Intzone will carry */
  gadgetCount: number
}

export const newJdIntState = (): JdIntState => ({
  win: null,
  screen: 0,
  windows: [],
  screens: [],
  lastClass: -1,
  gadgetCount: 0,
})

/**
 * Addresses for the windows this port hands back.
 *
 * A program keeps whatever `Jd Open Intwindow` returned and passes it to
 * `Jd Use Intwindow`, so the number only has to be stable, non-zero and
 * distinct — the same contract `ScreenHost.screenAddr` states for screens.
 * Well clear of the screen control blocks and of any bank.
 */
const WINDOW_ADDR_BASE = 0x00f0_0000
let nextWindowAddr = WINDOW_ADDR_BASE

/** where a keyword's pixels go, and the origin they are relative to */
interface Target {
  rp: RastPort
  ox: number
  oy: number
}

export function makeJdIntInstructions(rt: Runtime): Record<string, Instr> {
  /**
   * Routine 30, the three-way fallback: current window, else current screen,
   * else AMOS's own RastPort.
   *
   * A window's RPort has its origin at the window's top-left and is clipped to
   * it, which is why this carries an offset rather than only a RastPort: the
   * port applies what a real RPort's Layer would.
   */
  const target = (): Target => {
    const st = rt.jdint
    if (st.win) return { rp: st.win.rp, ox: st.win.w.leftEdge, oy: st.win.w.topEdge }
    const slot = rt.intuition.slotOf(st.screen)
    const s = slot === null ? undefined : rt.screens.get(slot)
    if (s) return { rp: s.rp, ox: 0, oy: 0 }
    return { rp: rt.screen.rp, ox: 0, oy: 0 }
  }

  /** the drawing keywords all pop plain integers; this is just the shape */
  const four = (it: Parameters<Instr>[0], to: boolean): [number, number, number, number] => {
    const x1 = it.evalInt()
    it.expect(',')
    const y1 = it.evalInt()
    it.expect(to ? 'to' : ',')
    const x2 = it.evalInt()
    it.expect(',')
    const y2 = it.evalInt()
    return [x1, y1, x2, y2]
  }

  return {
    /** Routine 4 ($804) — `Jd Close Intwindow WIN`; see the function table */
    'jd close intwindow'(it) {
      const st = rt.jdint
      const addr = it.evalInt() >>> 0
      const i = st.windows.findIndex((jw) => jw.addr === addr)
      if (i < 0) return
      const jw = st.windows[i]!
      st.windows.splice(i, 1)
      // routine 4 sets the CURRENT window to the closed one's pointer before
      // calling CloseWindow, so the current window is left dangling
      st.win = null
      rt.intuition.closeWindow(jw.w)
    },

    /** Routine 6 ($9d2) — `Jd Close Intscreen SCR` */
    'jd close intscreen'(it) {
      const st = rt.jdint
      const addr = it.evalInt() >>> 0
      const i = st.screens.indexOf(addr)
      if (i < 0) return
      st.screens.splice(i, 1)
      st.screen = 0
      rt.intuition.closeScreen(addr)
    },

    /**
     * Routine 7 ($a60) — `Jd Intlocate X,Y`, the TEXT cursor.
     *
     * `asl.l #3` on each, then `+2` on the x and `+$10` on the y: a character
     * cell is 8x8 and the origin is two pixels in and sixteen down, which
     * clears the window's border and title bar. Then Move (-240).
     */
    'jd intlocate'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const t = target()
      t.rp.cpX = x * 8 + 2
      t.rp.cpY = y * 8 + 0x10
    },

    /** Routine 8 ($a9e) — `Jd Intprint TEXT$`: graphics Text (-60) at the cursor */
    'jd intprint'(it) {
      const s = it.evalStr()
      const t = target()
      t.rp.text(t.rp.cpX + t.ox, t.rp.cpY + t.oy, s)
      t.rp.cpX -= t.ox
      t.rp.cpY -= t.oy
    },

    /** Routine 11 ($c28) — `Jd Intpen C`: SetAPen (-342) */
    'jd intpen'(it) {
      target().rp.fgPen = it.evalInt() & 0xff
    },

    /** Routine 12 ($c54) — `Jd Intpaper C`: SetBPen (-348) */
    'jd intpaper'(it) {
      target().rp.bgPen = it.evalInt() & 0xff
    },

    /** Routine 13 ($c80) — `Jd Intdrawmode M`: SetDrMd (-354) */
    'jd intdrawmode'(it) {
      target().rp.drawMode = it.evalInt() & 0xff
    },

    /** Routine 14 ($cac) — `Jd Intbar X,Y To X2,Y2`: RectFill (-306) */
    'jd intbar'(it) {
      const [x1, y1, x2, y2] = four(it, true)
      const t = target()
      t.rp.rectFill(x1 + t.ox, y1 + t.oy, x2 + t.ox, y2 + t.oy)
    },

    /**
     * Routine 18 ($d44) — `Jd Intcolour INDEX,RGB`.
     *
     * The second argument is split by division rather than by shifting —
     * `divu #$100` for the red, then the remainder `divu #$10` for the green,
     * and what is left is the blue — so it is a three-nibble `$RGB` value.
     * SetRGB4 (-288) on `$2c(screen)`, the ViewPort. Nothing happens without a
     * current screen, and the AMOS fallback does NOT apply: routine 18 is one
     * of the two drawing keywords that never calls routine 30.
     */
    'jd intcolour'(it) {
      const index = it.evalInt()
      it.expect(',')
      const rgb = it.evalInt() & 0xffff
      const st = rt.jdint
      const slot = rt.intuition.slotOf(st.screen)
      const s = slot === null ? undefined : rt.screens.get(slot)
      if (!s || index < 0 || index >= s.palette.length) return
      const r = Math.floor(rgb / 0x100)
      const g = Math.floor((rgb - r * 0x100) / 0x10)
      const b = rgb - (g * 0x10 + r * 0x100)
      s.palette[index] = ((r & 0xf) << 8) | ((g & 0xf) << 4) | (b & 0xf)
    },

    /**
     * Routine 21 ($dfc) — `Jd Intzone NR,X,Y To X2,Y2`, a boolean Gadget.
     *
     * X2 and Y2 are turned into a WIDTH and HEIGHT by subtraction, the five
     * values are written into a 48-byte template at zone+$70 whose GadgetID
     * lands at zone+$96, and the template is CopyMem'd into a fresh AllocMem
     * before AddGadget (-42) and RefreshGList (-432).
     *
     * NOTE: `NR` is written into the template and used as the gadget's id, but
     * it is ALSO used as the count RefreshGList is given, and as the flag that
     * decides whether this gadget becomes the head of the list — `cmp.w #$1`.
     * So the numbers are expected to run 1, 2, 3; a program that numbers them
     * any other way still gets working gadgets, because AddGadget appends and
     * the id is carried through to the message either way.
     *
     * Nothing happens without a current window, which routine 21 does check.
     */
    'jd intzone'(it) {
      const id = it.evalInt()
      it.expect(',')
      const [x1, y1, x2, y2] = four(it, true)
      const st = rt.jdint
      if (!st.win) return
      st.win.w.gadgets.push({ leftEdge: x1, topEdge: y1, width: x2 - x1, height: y2 - y1, id })
      st.gadgetCount = id
    },

    /** Routine 22 ($fde) — `Jd Rem Intzones`: RemoveGList (-444) then FreeMem each */
    'jd rem intzones'() {
      const st = rt.jdint
      if (st.win) st.win.w.gadgets.length = 0
      st.gadgetCount = 0
    },

    /**
     * Routine 23 ($1090) — `Jd Intbox X,Y To X2,Y2`.
     *
     * Move then four Draws, closing the rectangle back onto its first corner.
     * Not RectFill with the outline pen: the four lines go through Draw, so
     * the line pattern and the draw mode apply to them.
     */
    'jd intbox'(it) {
      const [x1, y1, x2, y2] = four(it, true)
      const t = target()
      const [ax, ay, bx, by] = [x1 + t.ox, y1 + t.oy, x2 + t.ox, y2 + t.oy]
      t.rp.draw(ax, ay, bx, ay)
      t.rp.draw(bx, ay, bx, by)
      t.rp.draw(bx, by, ax, by)
      t.rp.draw(ax, by, ax, ay)
      t.rp.cpX = x1
      t.rp.cpY = y1
    },

    /** Routine 24 ($10ea) — `Jd Intline X,Y To X2,Y2`: Move then Draw */
    'jd intline'(it) {
      const [x1, y1, x2, y2] = four(it, true)
      const t = target()
      t.rp.draw(x1 + t.ox, y1 + t.oy, x2 + t.ox, y2 + t.oy)
      t.rp.cpX = x2
      t.rp.cpY = y2
    },

    /** Routine 25 ($112c) — `Jd Intellipse X,Y,XR,YR`: DrawEllipse (-180) */
    'jd intellipse'(it) {
      const [cx, cy, rx, ry] = four(it, false)
      const t = target()
      t.rp.ellipse(cx + t.ox, cy + t.oy, rx, ry)
    },

    /**
     * Routine 26 ($115e) — `Jd Intfill X,Y`: Flood (-330) in mode 1.
     *
     * DEFECT: the RastPort comes from `$32` of the current window with no null
     * check, where every other drawing keyword goes through routine 30. With
     * no window open the machine reads address `$32`. Reproduced as far as it
     * can be: the keyword does nothing rather than drawing on the AMOS screen,
     * because falling back would be a kindness the code does not do.
     */
    'jd intfill'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const st = rt.jdint
      if (!st.win) return
      st.win.rp.flood(1, x + st.win.w.leftEdge, y + st.win.w.topEdge)
    },

    /** Routine 29 ($11e8) — `Jd Intplot X,Y`: WritePixel (-324) */
    'jd intplot'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const t = target()
      t.rp.plot(x + t.ox, y + t.oy)
    },

    /** Routine 33 ($1334) — `Jd Use Intscreen SCR`, if it is one we opened */
    'jd use intscreen'(it) {
      const st = rt.jdint
      const addr = it.evalInt() >>> 0
      if (st.screens.includes(addr)) st.screen = addr
    },

    /** Routine 34 ($1368) — `Jd Use Intwindow WIN` */
    'jd use intwindow'(it) {
      const st = rt.jdint
      const addr = it.evalInt() >>> 0
      const jw = st.windows.find((w) => w.addr === addr)
      if (jw) st.win = jw
    },

    /** Routine 35 ($139c) — `Jd Show Intscreen SCR`: ScreenToFront (-252) */
    'jd show intscreen'(it) {
      const st = rt.jdint
      const addr = it.evalInt() >>> 0
      if (st.screens.includes(addr)) rt.intuition.screenToFront(addr)
    },

    /** Routine 36 ($13e0) — `Jd Show Intwindow WIN`: WindowToFront (-312) */
    'jd show intwindow'(it) {
      const st = rt.jdint
      const addr = it.evalInt() >>> 0
      const jw = st.windows.find((w) => w.addr === addr)
      if (jw) rt.intuition.windowToFront(jw.w)
    },

    /**
     * `Jd Intcls` — TWO token entries and TWO routines, which is the author
     * being careful rather than the usual arity accident. Id 496 has spec `I`
     * and runs routine 27 ($1198), ClearScreen (-48), which clears from the
     * cursor to the end of the RastPort using the BACKGROUND pen. Id 512 has
     * spec `I0` and runs routine 37 ($1422), SetRast (-234), which floods the
     * whole thing with the pen it is given.
     */
    'jd intcls'(it) {
      const t = target()
      if (it.atStmtEnd()) {
        t.rp.setRast(t.rp.bgPen)
        return
      }
      t.rp.setRast(it.evalInt() & 0xff)
    },

    /** Routine 38 ($1448) — `Jd Intmove X,Y`, the GRAPHICS cursor: Move (-240) */
    'jd intmove'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const t = target()
      t.rp.cpX = x
      t.rp.cpY = y
    },
  }
}

export function makeJdIntFunctions(rt: Runtime): Record<string, Func> {
  const screenOf = (addr: number): { width: number; height: number } | null => {
    const slot = rt.intuition.slotOf(addr)
    const s = slot === null ? undefined : rt.screens.get(slot)
    return s ? { width: s.width, height: s.height } : null
  }

  return {
    /** Routine 3 ($662) — the instruction table carries the reading */
    'jd open intwindow': (_it, a) => {
      const st = rt.jdint
      const x = int(a[0]!)
      const y = int(a[1]!)
      const w = int(a[2]!)
      const h = int(a[3]!)
      const title = str(a[4]!)
      const onCustom = st.screen !== 0 && rt.intuition.slotOf(st.screen) !== null
      const slot = onCustom ? rt.intuition.slotOf(st.screen)! : -1
      const win = rt.intuition.openWindow({
        leftEdge: x,
        topEdge: y,
        width: w,
        height: h,
        detailPen: 0,
        blockPen: 1,
        idcmpFlags: JD_IDCMP,
        flags: JD_WFLAGS | (title === '' ? WFLG_BORDERLESS : 0) | (onCustom ? WFLG_BACKDROP : 0),
        title,
        type: onCustom ? CUSTOMSCREEN : WBENCHSCREEN,
        ...(onCustom ? { screenSlot: slot } : {}),
      })
      if (!win) {
        // routine 3 does not check, and answers whatever OpenWindow left --
        // which is 0. The list node it allocates around the failure is a leak
        // this port has nothing to leak.
        st.win = null
        return VI(0)
      }
      const bitMap = rt.screens.get(win.screenSlot)?.rp.bitMap
      const rp = new RastPort(bitMap ?? rt.screen.rp.bitMap)
      rp.clip = {
        x1: win.leftEdge,
        y1: win.topEdge,
        x2: win.leftEdge + win.width - 1,
        y2: win.topEdge + win.height - 1,
      }
      const addr = (nextWindowAddr += 0x40)
      const jw: JdWindow = { addr, w: win, rp }
      st.windows.push(jw)
      st.win = jw
      return VI(addr)
    },

    /**
     * Routine 5 ($892) — `=Jd Open Intscreen(W,H,DEPTH,VIEWMODES)`.
     *
     * NOT `(X,Y,W,H)`, whatever the manual says: LeftEdge and TopEdge are
     * `move.w #$0` literals and the four arguments go to Width, Height, Depth
     * and ViewModes. `Type` is `$10f` — CUSTOMSCREEN plus SCREENQUIET, so
     * Intuition draws no title bar on it.
     *
     * ViewModes is the raw hardware word: bit 15 HIRES, bit 2 LACE.
     */
    'jd open intscreen': (_it, a) => {
      const st = rt.jdint
      const width = int(a[0]!)
      const height = int(a[1]!)
      const depth = int(a[2]!)
      const modes = int(a[3]!)
      const addr = rt.intuition.openScreen({
        width,
        height,
        depth,
        hires: (modes & 0x8000) !== 0,
        laced: (modes & 4) !== 0,
        palette: [0x000, 0xfff, 0x00f, 0xf00],
        displayY: 0x2c,
        title: '',
      })
      if (addr === 0) return VI(0)
      st.screens.push(addr)
      st.screen = addr
      return VI(addr)
    },

    /**
     * Routine 10 ($b12) — `=Jd Intevent`, and it BLOCKS.
     *
     * Routine 9 is `Wait(1 << UserPort->mp_SigBit)` then GetMsg then ReplyMsg,
     * and routine 10 loops on it until a class it recognises arrives. So the
     * program stops until the user does something; an unrecognised class —
     * GADGETDOWN is the one it asks for and ignores — goes back to the Wait.
     *
     * Returns the key code, the menu number or the gadget id depending on
     * which arrived, and leaves the class in zone+$60 for `Jd Intclass`.
     * Without a current window it does not wait at all: class -1, answer -1.
     */
    'jd intevent': (it) => {
      const st = rt.jdint
      if (!st.win) {
        st.lastClass = -1
        return VI(-1)
      }
      for (;;) {
        const m = st.win.w.getMsg()
        if (!m) {
          // a key that has not been turned into a VANILLAKEY yet IS one: see
          // the DEVIATION on this keyword
          const k = rt.input.keyQueue.shift()
          if (k) {
            st.lastClass = 4
            return VI(k.ch.charCodeAt(0) & 0xff)
          }
          it.block({ type: 'waitInput', mouse: true, key: true }, true)
          // the statement re-runs on resume, so this answer is discarded --
          // the same shape delta.ts's requesters use
          return VI(0)
        }
        if (m.class === IDCMP_DISKREMOVED) {
          st.lastClass = 0
          return VI(0)
        }
        if (m.class === IDCMP_DISKINSERTED) {
          st.lastClass = 1
          return VI(1)
        }
        if (m.class === IDCMP_MENUPICK) {
          // MENUNULL is not an event; routine 10 goes back to the Wait
          if ((m.code & 0xffff) === 0xffff) continue
          st.lastClass = 2
          return VI(m.code)
        }
        if (m.class === IDCMP_GADGETUP) {
          st.lastClass = 3
          return VI(m.iaddress)
        }
        if (m.class === IDCMP_VANILLAKEY) {
          st.lastClass = 4
          return VI((m.code << 24) >> 24)
        }
      }
    },

    /** Routine 15 ($cde) — `=Jd Intmouse(x)`: Window->MouseX, 0 with no window */
    'jd intmouse(x)': () => VI(rt.jdint.win?.w.mouseX ?? 0),
    /** Routine 16 ($d06) — `=Jd Intmouse(y)`: Window->MouseY */
    'jd intmouse(y)': () => VI(rt.jdint.win?.w.mouseY ?? 0),

    /** Routine 17 ($d2e) — `=Jd Intclass`: whatever the last event left at zone+$60 */
    'jd intclass': () => VI(rt.jdint.lastClass),

    /** Routine 19 ($dd0) — `=Jd Intcurs(x)`: rp_cp_x at `$24` of the RastPort */
    'jd intcurs(x)': () => VI(currentRast(rt).cpX),
    /** Routine 20 ($de6) — `=Jd Intcurs(y)`: rp_cp_y at `$26` */
    'jd intcurs(y)': () => VI(currentRast(rt).cpY),

    /** Routine 28 ($11bc) — `=Jd Intpoint(X,Y)`: ReadPixel (-318) */
    'jd intpoint': (_it, a) => {
      const t = currentTarget(rt)
      return VI(t.rp.point(int(a[0]!) + t.ox, int(a[1]!) + t.oy))
    },

    /**
     * Routine 39 ($1470) — `=Jd Intscreen Width`.
     *
     * DEFECT: `move.w $a(a0),d3` is Screen->TopEdge, not Width. The screen is
     * opened with TopEdge 0, so this answers 0 for every screen it opens.
     * Reproduced.
     */
    'jd intscreen width': () => VI(0),

    /**
     * Routine 40 ($148e) — `=Jd Intscreen Height`.
     *
     * DEFECT: `move.w $c(a0),d3` is Screen->Width. So this answers the WIDTH,
     * and the pair is off by one field each. Reproduced.
     */
    'jd intscreen height': () => VI(screenOf(rt.jdint.screen)?.width ?? 0),
  }
}

/** routine 30's answer, for the two keywords that only want to read it */
function currentRast(rt: Runtime): RastPort {
  return currentTarget(rt).rp
}

function currentTarget(rt: Runtime): Target {
  const st = rt.jdint
  if (st.win) return { rp: st.win.rp, ox: st.win.w.leftEdge, oy: st.win.w.topEdge }
  const slot = rt.intuition.slotOf(st.screen)
  const s = slot === null ? undefined : rt.screens.get(slot)
  if (s) return { rp: s.rp, ox: 0, oy: 0 }
  return { rp: rt.screen.rp, ox: 0, oy: 0 }
}
