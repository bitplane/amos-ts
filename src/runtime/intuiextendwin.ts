/**
 * IntuiExtend 2.01b, the screen and window group.
 *
 * Forty-three keywords, and almost every one is four instructions around a
 * single intuition.library call. What makes the group worth reading is not
 * the calls but the two structures they call through, because both are STATIC
 * DATA inside the code hunk rather than anything the extension allocates.
 * Routine 0 is six instructions:
 *
 *     $1d14  movem.l a3-a6,-(a7)
 *     $1d18  lea.l   $1d28(pc),a3
 *     $1d1c  move.l  a3,$258(a5)
 *
 * so the workspace is the 1,874 bytes at $1d28 and every default in it can be
 * read straight out of the file. At +$1c is one NewWindow and at +$90 one
 * NewScreen, shipped filled in:
 *
 *     +$1c  32 00 32 00 fa 00 64  01 00  004c0678  0000320f  ...
 *     +$90  0000 0000 0280 0100 0002 00 01 8000 000f
 *
 * A NewScreen of 640x256x2, HIRES, CUSTOMSCREEN. A NewWindow at (50,50) of
 * 250x100 with IDCMPFlags $004C0678 and Flags $0000320F, limits of 50/50 and
 * 639/255, and Type WBENCHSCREEN.
 *
 * ONE of each, reused. `Wb Wind Open` writes six of the NewWindow's eighteen
 * fields and calls OpenWindow, so IDCMPFlags, the title pointer and the four
 * limits are whatever the LAST call left there. That is the group's real
 * shape: these keywords are not independent, they are a conversation with two
 * structures that persist.
 *
 * ## Two numbers the guide rounds
 *
 * Wind6 says "Par defaut les limite de la fenetre sont de: MinX = 50 MinY = 50
 * MaxX = 640 MaxY = 256". The bytes at +$1c+38 are `0032 0032 027f 00ff`, so
 * the maxima are 639 and 255. The guide rounded up to the screen size; the
 * file did not.
 *
 * ## Where the addresses come from
 *
 * A screen address is `SCREEN_CTRL_BASE + slot * SCREEN_CTRL_SLOT`, which is
 * what ../amiga/intuition.ts hands out and what ./intuiextendgfx.ts already
 * turns back into a RastPort by subtracting $54. Windows have no such scheme
 * because nothing else in this port hands a `struct Window *` to a program, so
 * this file mints them: IE_WINDOW_BASE plus a slot, with the RastPort a fixed
 * offset inside the same slot. They are handles and nothing may read them as
 * memory, which is honest -- there is no `struct Window` in this address
 * space, and `X Wind(WINDOW)` reaching `$e(a0)` is a table lookup here.
 *
 * ## Evidence
 *
 * BINARY tier. Every LVO below was read out of the corpus `.fd` files under
 * GUI 2.10 (`intuition_lib.fd`, `exec_lib.fd`), and every struct offset out
 * of the AMOS Pro `includes/intuition` copies of screens.i, intuition.i and
 * intuitionbase.i. Documented against `IntuiExtend_2.0.Guide`'s Screen.guide
 * and Window.guide, both @Author CIERP Philippe.
 *
 * ## Not in this file
 *
 * `Wb Open Screen Taglist` (routine 265, $4e54) is the one keyword of the
 * group left out, and the reason is evidence rather than effort. The routine
 * itself is eight instructions -- `suba.l a0,a0` for a NULL NewScreen, the
 * string's bytes plus two as the tag list, OpenScreenTagList at -$264, and
 * the result stored at +$8c only if it is non-zero -- but a tag list is
 * useless without the SA_* numbers, and nothing on this machine defines them.
 * The AMOS Pro `includes/intuition/screens.i` is the 1.3 set and predates
 * OpenScreenTagList; Intuition-41.95's own screens.s WRITES `dc.l SA_DisplayID`
 * and `dc.l SA_Pens` without shipping the include that gives them values. A
 * port that guessed them would open screens of the wrong size and look right.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'
import type { RastPort as RastPortT } from '../amiga/graphics'
import { RastPort } from '../amiga/graphics'
import { Runtime as RT } from './runtime'
import { CUSTOMSCREEN, WBENCHSCREEN, WB_SLOT, type Window } from '../amiga/intuition'
import type { IntuiextendState } from './intuiextend'

/**
 * Where a `struct Window *` lives, and how far apart two of them are.
 *
 * Above SCREEN_CTRL_BASE's own range and outside every memory region, so a
 * program that pokes one gets nothing rather than a plausible word. $40 a
 * window is the same stride ./jdint.ts picked for the same reason.
 */
export const IE_WINDOW_BASE = 0x4a00_0000
export const IE_WINDOW_STEP = 0x40
/** what `Wb Wind Rastport` hands back: `$32(a0)` is wd_RPort, a pointer field */
export const IE_WINDOW_RP = 0x20

/** `move.l #$ffffffff,(a0)` at $2572 and $2646 — what a close writes back */
export const IE_NO_BASE = -1

/**
 * The NewScreen at workspace+$90, as the file ships it.
 *
 * `Wb Screen Open` writes ViewModes, Depth, Height, Width, TopEdge and
 * LeftEdge and touches nothing else, so DetailPen 0, BlockPen 1 and Type
 * CUSTOMSCREEN are fixed for every screen this extension opens.
 */
export interface IeNewScreen {
  leftEdge: number
  topEdge: number
  width: number
  height: number
  depth: number
  viewModes: number
}

export function newIeNewScreen(): IeNewScreen {
  return { leftEdge: 0, topEdge: 0, width: 640, height: 256, depth: 2, viewModes: 0x8000 }
}

/**
 * The NewWindow at workspace+$1c, as the file ships it.
 *
 * `Wb Wind Open` writes Flags, Height, Width, TopEdge, LeftEdge and Screen;
 * `Wb Easy Wind Open` writes the four geometry fields and its own Screen and
 * Type. Nothing else in the extension writes IDCMPFlags except `Wb New Idcmp`,
 * which belongs to the message group, so the shipped $004C0678 is what a
 * window opened before that keyword runs asks for.
 */
export interface IeNewWindow {
  leftEdge: number
  topEdge: number
  width: number
  height: number
  detailPen: number
  blockPen: number
  idcmpFlags: number
  flags: number
  screen: number
  type: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export function newIeNewWindow(): IeNewWindow {
  return {
    leftEdge: 50,
    topEdge: 50,
    width: 250,
    height: 100,
    detailPen: 1,
    blockPen: 0,
    // MOUSEBUTTONS|MOUSEMOVE|GADGETDOWN|GADGETUP|CLOSEWINDOW|RAWKEY
    // |ACTIVEWINDOW|INACTIVEWINDOW|INTUITICKS, every value confirmed in
    // includes/intuition/intuition.i:629-648
    idcmpFlags: 0x004c_0678,
    // SIZEGADGET|DRAGBAR|DEPTHGADGET|CLOSEGADGET|REPORTMOUSE|ACTIVATE
    // |WINDOWACTIVE
    flags: 0x0000_320f,
    screen: 0,
    type: WBENCHSCREEN,
    minWidth: 50,
    minHeight: 50,
    maxWidth: 639,
    maxHeight: 255,
  }
}

/** one open window, and the four limits `Wb Wind Limit` last set on it */
export interface IeWindow {
  addr: number
  win: Window
  rp?: RastPortT
  /** nw_IDCMPFlags as opened, and what `Wb New Idcmp`'s ModifyIDCMP replaces */
  idcmpFlags: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  /**
   * wd_MenuStrip (`intuition.i`:700 puts it at $1c), the address SetMenuStrip
   * was given and 0 when there is none.
   *
   * It is a field rather than a map because `Wb Get Menu` (routine 289) IS
   * `move.l $1c(a0),d3` and nothing else --- the keyword is that one read.
   * The chain it points at is real program memory; only the window holding
   * the pointer is a handle. See ./intuiextendmenu.ts.
   */
  menuStrip: number
}

/** what `Wb Wind Open` and `Wb Easy Wind Open` share once the fields are set */
export interface IeWindowState {
  windows: Map<number, IeWindow>
  next: number
}

export function newIeWindowState(): IeWindowState {
  return { windows: new Map(), next: 0 }
}

/** the low word, signed: every coordinate reaches intuition through a `move.w` */
const lo = (v: number): number => (v << 16) >> 16

/**
 * The screen slot a `struct RastPort *` belongs to, or null.
 *
 * A screen's RastPort is its address plus $54, so the arithmetic runs
 * backwards; ./intuiextendgfx.ts does the same thing to reach the RastPort
 * object itself. `Wb Bitplane` needs the SLOT rather than the RastPort,
 * because a bitplane address comes from the screen's chip base.
 */
export function screenSlotOfRastPort(rt: Runtime, addr: number): number | null {
  const off = (addr >>> 0) - 0x54 - RT.SCREEN_CTRL_BASE
  if (off < 0 || off % RT.SCREEN_CTRL_SLOT !== 0) return null
  const slot = off / RT.SCREEN_CTRL_SLOT
  return rt.screens.has(slot) ? slot : null
}

/** the open window a `struct Window *` names, or null for a stale handle */
export function ieWindowAt(rt: Runtime, addr: number): IeWindow | null {
  return rt.intuiextend.windowState.windows.get(addr >>> 0) ?? null
}

/** the six byte-level accessors the structure groups reach `rt`'s memory through */
export interface IeMem {
  byte: (a: number) => number
  word: (a: number) => number
  long: (a: number) => number
  setByte: (a: number, v: number) => void
  setWord: (a: number, v: number) => void
  setLong: (a: number, v: number) => void
}

/**
 * Read and write the program's own memory at a byte address.
 *
 * The gadget blocks and the menu chain are structures the PROGRAM owns, laid
 * out the way `intuition.i` lays them out, so both groups walk them by fixed
 * offset the way the library does. An address outside anything mapped reads
 * as zero and swallows a write, which is what `rt.resolveAddr` already does
 * for `Peek` and `Poke`.
 */
export function ieMem(rt: Runtime): IeMem {
  return {
    byte: (a) => {
      const r = rt.resolveAddr(a >>> 0)
      return r ? (r.data[r.off] ?? 0) : 0
    },
    word: (a) => {
      const r = rt.resolveAddr(a >>> 0)
      return r ? (((r.data[r.off] ?? 0) << 8) | (r.data[r.off + 1] ?? 0)) : 0
    },
    long: (a) => {
      const l = rt.longsAt(a >>> 0, false)
      return l ? l.get(0) : 0
    },
    setByte: (a, v) => {
      const r = rt.resolveWrite(a >>> 0)
      if (r) r.data[r.off] = v & 0xff
    },
    setWord: (a, v) => {
      const r = rt.resolveWrite(a >>> 0)
      if (!r) return
      r.data[r.off] = (v >>> 8) & 0xff
      r.data[r.off + 1] = v & 0xff
    },
    setLong: (a, v) => {
      const l = rt.longsAt(a >>> 0, true)
      if (l) l.set(0, v)
    },
  }
}

export function makeIntuiextendWinInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IntuiextendState => rt.intuiextend

  const screenAddr = (slot: number): number =>
    (RT.SCREEN_CTRL_BASE + slot * RT.SCREEN_CTRL_SLOT) >>> 0

  /**
   * The slot a `struct Screen *` names, Workbench included.
   *
   * `rt.intuition.slotOf` walks the CUSTOM slots only, because that is the
   * range its own OpenScreen allocates from; the Workbench sits at WB_SLOT and
   * a program that got its address from `Wb Lock Pubscreen` will pass it here.
   */
  const slotOfAny = (addr: number): number | null => {
    const a = addr >>> 0
    if (a === 0) return null
    if (rt.intuition.workBenchOpen() && a === screenAddr(WB_SLOT)) return WB_SLOT
    return rt.intuition.slotOf(a)
  }

  const windowAt = (addr: number): IeWindow | null => ieWindowAt(rt, addr)

  /** `RPORT To a,b,...` — the shape `t` in a token spec makes */
  const toArgs = (it: Parameters<Instr>[0], n: number): number[] => {
    const out = [it.evalInt()]
    it.expect('to')
    for (let i = 0; i < n; i++) {
      if (i > 0) it.expect(',')
      out.push(it.evalInt())
    }
    return out
  }

  /** `a,b,c,...` — a plain comma list */
  const listArgs = (it: Parameters<Instr>[0], n: number): number[] => {
    const out = [it.evalInt()]
    for (let i = 1; i < n; i++) {
      it.expect(',')
      out.push(it.evalInt())
    }
    return out
  }

  /** NUL-terminated bytes at an address, which is what SetWindowTitles takes */
  const cstring = (addr: number): string => {
    const m = rt.resolveAddr(addr >>> 0)
    if (!m) return ''
    let s = ''
    for (let i = m.off; i < m.data.length && m.data[i] !== 0 && s.length < 4096; i++) {
      s += String.fromCharCode(m.data[i]!)
    }
    return s
  }

  /** OpenWindow with whatever the NewWindow at +$1c now holds */
  const openWindow = (): void => {
    const nw = st().newWindow
    const slot = nw.type === WBENCHSCREEN ? WB_SLOT : slotOfAny(nw.screen)
    const w =
      slot === null
        ? null
        : rt.intuition.openWindow({
            leftEdge: nw.leftEdge,
            topEdge: nw.topEdge,
            width: nw.width,
            height: nw.height,
            detailPen: nw.detailPen,
            blockPen: nw.blockPen,
            idcmpFlags: nw.idcmpFlags,
            flags: nw.flags,
            title: '',
            type: nw.type,
            ...(nw.type === WBENCHSCREEN ? {} : { screenSlot: slot }),
          })
    if (!w) {
      // `move.l d0,(a0)` at $262c is unconditional: a failed OpenWindow stores
      // zero and `Wb Wind Base` reports it, which is how the guide's own "ATTENTION
      // au Gourou" advice for the screen side comes about
      st().windBase = 0
      return
    }
    const ws = st().windowState
    const addr = (IE_WINDOW_BASE + ws.next++ * IE_WINDOW_STEP) >>> 0
    ws.windows.set(addr, {
      addr,
      win: w,
      idcmpFlags: nw.idcmpFlags,
      minWidth: nw.minWidth,
      minHeight: nw.minHeight,
      maxWidth: nw.maxWidth,
      maxHeight: nw.maxHeight,
      menuStrip: 0,
    })
    st().windBase = addr
  }

  return {
    /**
     * Wb Screen Open X,Y,W,H,PLAN,VMODE — routine 7 ($24f2).
     *
     * Six `move.l (a3)+,d0 / move.w d0,<field>` pairs into the NewScreen at
     * +$90, then OpenScreen (-$c6) and `move.l d0,(a0)` into +$8c. The pops
     * run last argument first, which is why the field order in the listing is
     * ViewModes, Depth, Height, Width, TopEdge, LeftEdge and the keyword's
     * order is the guide's: "X,Y=Coordonnées supérieures gauches".
     *
     * VMODE is the raw hardware word -- the guide says "Voir Shires, Lowres,
     * Hires, Laced..." and those are AMOS's own constants -- so bit 15 is
     * HIRES and bit 2 is LACE.
     *
     * DEVIATION: LeftEdge is written into the NewScreen and the modelled
     * machine has nowhere to put it. A screen here is positioned by the copper
     * band its slot owns and `displayX` is what moves it, so X is applied
     * through the same field `Screen Display` writes rather than through
     * OpenScreen.
     *
     * DEFECT: `move.l d0,(a0)` at $2536 does not test d0. A screen that could
     * not be opened stores 0 in +$8c and `Wb Screen Base` answers 0, which the
     * next `Wb Screen Close` then passes to CloseScreen.
     */
    'wb screen open'(it) {
      const [x, y, w, h, depth, mode] = listArgs(it, 6)
      const ns = st().newScreen
      ns.leftEdge = lo(x!)
      ns.topEdge = lo(y!)
      ns.width = lo(w!)
      ns.height = lo(h!)
      ns.depth = lo(depth!)
      ns.viewModes = lo(mode!) & 0xffff
      const addr = rt.intuition.openScreen({
        width: ns.width,
        height: ns.height,
        depth: ns.depth,
        hires: (ns.viewModes & 0x8000) !== 0,
        laced: (ns.viewModes & 0x4) !== 0,
        palette: [],
        displayY: ns.topEdge,
        title: '',
      })
      st().screenBase = addr
      const slot = addr === 0 ? null : rt.intuition.slotOf(addr)
      const s = slot === null ? null : rt.screens.get(slot)
      if (s) s.displayX = ns.leftEdge
    },

    /**
     * Wb Screen Move SCREEN To DELTX,DELTY — routine 9 ($254a).
     *
     * MoveScreen (-$a2) with d0 the X delta and d1 the Y delta, both RELATIVE:
     * "DELTX,DELTY=Nombre de pixel pour le déplacement".
     */
    'wb screen move'(it) {
      const [screen, dx, dy] = toArgs(it, 2)
      const slot = slotOfAny(screen!)
      const s = slot === null ? null : rt.screens.get(slot)
      if (!s) return
      s.displayX += lo(dx!)
      s.displayY += lo(dy!)
    },

    /**
     * Wb Screen Close SCREEN — routine 10 ($255e).
     *
     * CloseScreen (-$42) and then `move.l #$ffffffff,(a0)` into +$8c. The -1
     * is written whatever was closed and whether or not it worked, so closing
     * a screen the program held separately still clears `Wb Screen Base`.
     *
     * The guide's warning is the author's own: "ATTENTION au Gourou si l'écran
     * n'éxiste pas !!!"
     */
    'wb screen close'(it) {
      const addr = it.evalInt()
      rt.intuition.closeScreen(addr >>> 0)
      st().screenBase = IE_NO_BASE
    },

    /** Wb Screen Back SCREEN — routine 11 ($257c), ScreenToBack at -$f6 */
    'wb screen back'(it) {
      rt.intuition.screenToBack(it.evalInt() >>> 0)
    },

    /** Wb Screen Front SCREEN — routine 12 ($258c), ScreenToFront at -$fc */
    'wb screen front'(it) {
      rt.intuition.screenToFront(it.evalInt() >>> 0)
    },

    /**
     * Wb Screen Palette PAL,CNB To SCR — routine 268 ($4ebc).
     *
     * Walks the screen to its colour table -- `adda.w #$30,a0` is sc_ViewPort
     * ($2c) plus vp_ColorMap (+4), then `$4(a0)` is cm_ColorTable -- and
     * copies CNB words into it with a `dbra`, then RemakeDisplay (-$180).
     *
     * The guide's own example builds the source with Doke, one word a colour:
     * "les couleurs de la palette sont une suite de valeur sur un mot".
     *
     * DEFECT: `subq.w #$1,d7` at $4eca with no test first. A CNB of 0 makes
     * the counter -1 and the `dbra` runs 65,536 times, copying 128K over the
     * colour table and everything after it.
     */
    'wb screen palette'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      it.expect('to')
      const screen = it.evalInt()
      const slot = slotOfAny(screen)
      const s = slot === null ? null : rt.screens.get(slot)
      if (!s) return
      const n = (lo(count) - 1) & 0xffff
      let at = addr >>> 0
      for (let i = 0; i <= n; i++) {
        const m = rt.resolveAddr(at)
        if (!m) break
        if (i >= s.palette.length) break
        s.palette[i] = ((m.data[m.off]! << 8) | m.data[m.off + 1]!) & 0xfff
        at = (at + 2) >>> 0
      }
    },

    /**
     * Wb Screen Colour COUL,CNB To SCR — routine 269 ($4ee2).
     *
     * The value FIRST and the index second, which is the guide's order and
     * the reverse of the AMOS keyword it names: "Identique a la commande Amos
     * 'Colour NB,COUL', mais pour les ecran intuition."
     *
     * `asl.w #$1,d7` turns the index into a byte offset and `move.w d3,(a0,d7.w)`
     * writes it, with no bound of any kind: an index past the screen's colour
     * count writes past the table.
     */
    'wb screen colour'(it) {
      const colour = it.evalInt()
      it.expect(',')
      const index = it.evalInt()
      it.expect('to')
      const screen = it.evalInt()
      const slot = slotOfAny(screen)
      const s = slot === null ? null : rt.screens.get(slot)
      if (!s) return
      const i = lo(index)
      if (i < 0 || i >= s.palette.length) return
      s.palette[i] = colour & 0xfff
    },

    /**
     * Wb Wind Open SCREEN To X,Y,W,H,F — routine 18 ($25e2).
     *
     * Fills the NewWindow at +$1c and calls OpenWindow (-$cc). Type is decided
     * by the screen and not by the caller:
     *
     *     $2608  move.w  #$f,$2e(a0)      ; CUSTOMSCREEN
     *     $260e  tst.l   $1e(a0)          ; nw_Screen
     *     $2612  bne.b   $261a
     *     $2614  move.w  #$1,$2e(a0)      ; WBENCHSCREEN
     *
     * so SCREEN=0 opens on the Workbench, exactly as the guide says: "si
     * SCREEN=0 la fenetre sera ouverte dans le Workbench".
     *
     * F is the raw WFLG mask and the guide lists thirty of them by name. Note
     * what the routine does NOT write: IDCMPFlags, the title, the gadget list
     * and the four size limits all keep whatever the last call left.
     */
    'wb wind open'(it) {
      const [screen, x, y, w, h, flags] = toArgs(it, 5)
      const nw = st().newWindow
      nw.screen = screen! >>> 0
      nw.leftEdge = lo(x!)
      nw.topEdge = lo(y!)
      nw.width = lo(w!)
      nw.height = lo(h!)
      nw.flags = flags! | 0
      nw.type = nw.screen !== 0 ? CUSTOMSCREEN : WBENCHSCREEN
      openWindow()
    },

    /**
     * Wb Easy Wind Open X,Y,W,H — routine 279 ($510a).
     *
     * The same NewWindow with the screen chosen for you:
     *
     *     $512e  move.l  $38(a6),$1e(a0)   ; IntuitionBase->ActiveScreen
     *     $5134  move.w  #$f,$2e(a0)       ; CUSTOMSCREEN
     *
     * The guide says the window opens "dans l'écran en 1er plan" and the code
     * disagrees with it: $38 is ib_ActiveScreen, and the frontmost screen is
     * ib_FirstScreen at $3c. The author's own `First Screen` node draws
     * exactly that distinction -- "en premier plan (mais pas forcément
     * sélectionné)" -- so this takes the SELECTED screen, not the front one,
     * and the port follows the code.
     *
     * With no active screen the Screen pointer is 0 and Type is still
     * CUSTOMSCREEN, which is a combination OpenWindow refuses.
     */
    'wb easy wind open'(it) {
      const [x, y, w, h] = listArgs(it, 4)
      const nw = st().newWindow
      nw.leftEdge = lo(x!)
      nw.topEdge = lo(y!)
      nw.width = lo(w!)
      nw.height = lo(h!)
      nw.screen = activeScreenAddr(rt)
      nw.type = CUSTOMSCREEN
      openWindow()
    },

    /**
     * Wb Wind Close WINDOW — routine 19 ($2632).
     *
     * CloseWindow (-$48) and `move.l #$ffffffff,(a0)` into +$18, the same
     * unconditional -1 the screen side writes.
     */
    'wb wind close'(it) {
      const addr = it.evalInt()
      const w = windowAt(addr)
      if (w) {
        rt.intuition.closeWindow(w.win)
        st().windowState.windows.delete(addr >>> 0)
      }
      st().windBase = IE_NO_BASE
    },

    /**
     * Wb Wind Move WINDOW To DELTAX,DELTAY — routine 26 ($2bcc), MoveWindow
     * at -$a8. Relative: "ACTUELLE+DELTA=NOUVELLES COORDs".
     */
    'wb wind move'(it) {
      const [addr, dx, dy] = toArgs(it, 2)
      const w = windowAt(addr!)
      if (w) rt.intuition.moveWindow(w.win, lo(dx!), lo(dy!))
    },

    /**
     * Wb Wind Size WINDOW To DELTX,DELTY — routine 28 ($2bea), SizeWindow at
     * -$120, and relative like the move.
     *
     * The limits `Wb Wind Limit` set apply here, which is what WindowLimits
     * is for. They do NOT apply to a drag of the size gadget: that is
     * Intuition's own code on the machine and this port's layer chain here,
     * and neither consults them.
     */
    'wb wind size'(it) {
      const [addr, dx, dy] = toArgs(it, 2)
      const w = windowAt(addr!)
      if (!w) return
      const width = Math.max(w.minWidth, Math.min(w.maxWidth, w.win.width + lo(dx!)))
      const height = Math.max(w.minHeight, Math.min(w.maxHeight, w.win.height + lo(dy!)))
      rt.intuition.sizeWindow(w.win, width - w.win.width, height - w.win.height)
    },

    /**
     * Wb Wind Limit WINDOW To MINX,MINY,MAXX,MAXY — routine 29 ($2bfe),
     * WindowLimits at -$13e with d0..d3 in that order.
     *
     * The defaults are the NewWindow's own, and the guide rounds them: it says
     * MaxX 640 and MaxY 256 where +$1c+42 reads `027f 00ff`, 639 and 255.
     */
    'wb wind limit'(it) {
      const [addr, minW, minH, maxW, maxH] = toArgs(it, 4)
      const w = windowAt(addr!)
      if (!w) return
      w.minWidth = lo(minW!)
      w.minHeight = lo(minH!)
      w.maxWidth = lo(maxW!)
      w.maxHeight = lo(maxH!)
    },

    /** Wb Wind Back WINDOW — routine 30 ($2c16), WindowToBack at -$132 */
    'wb wind back'(it) {
      const w = windowAt(it.evalInt())
      if (w) rt.intuition.windowToBack(w.win)
    },

    /** Wb Wind Front WINDOW — routine 31 ($2c26), WindowToFront at -$138 */
    'wb wind front'(it) {
      const w = windowAt(it.evalInt())
      if (w) rt.intuition.windowToFront(w.win)
    },

    /**
     * Wb Display Beep SCREEN — routine 32 ($2c36), DisplayBeep at -$60.
     *
     * The argument goes straight to a0, so a SCREEN of 0 beeps every screen,
     * which is what the call means with a NULL.
     *
     * DEVIATION: nothing flashes. DisplayBeep inverts colour zero for a few
     * frames and this port's screens are redrawn from their palettes; the same
     * treatment ./int.ts's `Wb Flash Screen` gets, and for the same reason.
     */
    'wb display beep'(it) {
      it.evalInt()
    },

    /**
     * Wb Wind Title WIND To WINDT,SCREENT — routine 66 ($305a).
     *
     *     $305a  movea.l (a3)+,a2     ; SCREENT
     *     $305c  movea.l (a3)+,a1     ; WINDT
     *     $305e  movea.l (a3)+,a0     ; WIND
     *     $3066  jsr     -$114(a6)    ; SetWindowTitles
     *
     * Both titles are ADDRESSES rather than strings -- the guide's example is
     * `Wb Wind Title WIND To Varptr(A$),Varptr(B$)` -- so they are read as
     * NUL-terminated bytes, which is what `Str Store` (routine 246) produces:
     * it allocates length+3 and writes the length word, the text and a NUL.
     *
     * SetWindowTitles takes -1 for "leave this one alone" and 0 for "no
     * title", and the routine passes both through untouched.
     */
    'wb wind title'(it) {
      const [addr, windT, screenT] = toArgs(it, 2)
      const w = windowAt(addr!)
      if (!w) return
      if (windT !== -1) w.win.title = windT === 0 ? '' : cstring(windT!)
      if (screenT !== -1) w.win.screenTitle = screenT === 0 ? '' : cstring(screenT!)
      rt.intuition.invalidate()
    },

    /**
     * Wb Change Window Box WIND To X,Y,WIDTH,HEIGHT — routine 132 ($3866),
     * ChangeWindowBox at -$1e6.
     *
     * ABSOLUTE where `Wb Wind Move` and `Wb Wind Size` are relative: this is
     * the one keyword that puts a window somewhere rather than nudging it.
     */
    'wb change window box'(it) {
      const [addr, x, y, width, height] = toArgs(it, 4)
      const w = windowAt(addr!)
      if (!w) return
      rt.intuition.moveWindow(w.win, lo(x!) - w.win.leftEdge, lo(y!) - w.win.topEdge)
      rt.intuition.sizeWindow(w.win, lo(width!) - w.win.width, lo(height!) - w.win.height)
    },

    /**
     * Wb Zip Window WIND — routine 133 ($387e), ZipWindow at -$1f8.
     *
     * Swaps a window between its current box and its zoom box, which is what
     * the zoom gadget does. There is no separate zoom box here, so the window
     * toggles between where it is and the NewWindow's own 250x100 at (50,50).
     *
     * The routine ends `move.l d0,d3 / moveq #$0,d2` and sets up a function
     * result, but its token entry has no function routine: the table says
     * instruction only, so those two instructions are dead.
     */
    'wb zip window'(it) {
      const w = windowAt(it.evalInt())
      if (!w) return
      const nw = st().newWindow
      const zoomed =
        w.win.leftEdge === nw.leftEdge &&
        w.win.topEdge === nw.topEdge &&
        w.win.width === nw.width &&
        w.win.height === nw.height
      const zoom = zoomed ? { x: 0, y: 0, w: w.maxWidth, h: w.maxHeight } : { x: nw.leftEdge, y: nw.topEdge, w: nw.width, h: nw.height }
      rt.intuition.moveWindow(w.win, zoom.x - w.win.leftEdge, zoom.y - w.win.topEdge)
      rt.intuition.sizeWindow(w.win, zoom.w - w.win.width, zoom.h - w.win.height)
    },

    /**
     * Wb Window WIND — routine 283 ($5450), two instructions:
     *
     *     movea.l (a3)+,a0
     *     move.l  $32(a0),-$18ca(a5)
     *
     * wd_RPort into AMOS's own T_RastPort, so every AMOS drawing keyword
     * afterwards goes to that window. The window twin of `Wb Screen` (routine
     * 190), which does the same with a screen address plus $54.
     *
     * DEVIATION: what moves here is the SCREEN AMOS draws on, not the clip.
     * AMOS's keywords in this port take a screen's RastPort and there is no
     * way to hand them a window's, so drawing lands on the window's screen at
     * screen coordinates rather than inside the window's box. `Amos Rastport`
     * still reports the window's RastPort address, because that is the
     * longword the routine wrote.
     */
    'wb window'(it) {
      const addr = it.evalInt()
      const w = windowAt(addr)
      if (!w) return
      st().amosRp = (addr >>> 0) + IE_WINDOW_RP
      if (rt.screens.has(w.win.screenSlot)) rt.currentIndex = w.win.screenSlot
    },

    /**
     * Wb Kill Aga — routine 261 ($4da4).
     *
     * Forbid, Disable, clear bits 1, 2 and 3 of `$ec(GfxBase)`, RemakeDisplay,
     * Enable, Permit -- but ALL of it is behind one test:
     *
     *     $4daa  adda.w  #$701,a0        ; workspace+$701
     *     $4dae  tst.b   (a0)
     *     $4db0  beq.b   $4dea           ; straight to the exit
     *
     * DEFECT: nothing in the 23,084-byte file ever WRITES workspace+$701. It
     * is read at $4d92 and $4dae and nowhere else, and the byte the file ships
     * at $2429 is zero. So the branch is always taken and `Wb Kill Aga` is a
     * no-op on every machine, AGA or not. See `Wb Check Aga` for the other
     * half of the same missing write.
     */
    'wb kill aga'() {},

    /**
     * Wb Mouse On — routine 262 ($4df0), one instruction:
     *
     *     move.w  #$8020,$dff096
     *
     * DMACON with SET and bit 5, which is sprite DMA. The pointer is sprite 0,
     * so turning sprite DMA on is what makes it visible again.
     */
    'wb mouse on'() {
      rt.spriteDma = true
    },

    /** Wb Mouse Off — routine 263 ($4dfa), `move.w #$20,$dff096`: the same bit, cleared */
    'wb mouse off'() {
      rt.spriteDma = false
    },
  }
}

/**
 * IntuitionBase->ActiveScreen ($38), or 0.
 *
 * The active screen is the one the active window is on; with no active window
 * Intuition leaves the last one it activated, and the frontmost is the closest
 * this port can get to that.
 */
function activeScreenAddr(rt: Runtime): number {
  const w = rt.intuition.activeWindow
  if (w) return (RT.SCREEN_CTRL_BASE + w.screenSlot * RT.SCREEN_CTRL_SLOT) >>> 0
  return frontScreenAddr(rt)
}

/**
 * IntuitionBase->FirstScreen ($3c): the frontmost screen Intuition opened.
 *
 * `rt.order` holds every screen on the display with the frontmost last, and
 * AMOS's own screens are in it too -- but they are not Intuition screens on
 * the machine, where AMOS runs its own copper list and Intuition knows nothing
 * about them. Only the Workbench and the custom slots count.
 */
function frontScreenAddr(rt: Runtime): number {
  for (let i = rt.order.length - 1; i >= 0; i--) {
    const slot = rt.order[i]!
    if (slot !== WB_SLOT && rt.intuition.slotOf((RT.SCREEN_CTRL_BASE + slot * RT.SCREEN_CTRL_SLOT) >>> 0) === null) {
      continue
    }
    return (RT.SCREEN_CTRL_BASE + slot * RT.SCREEN_CTRL_SLOT) >>> 0
  }
  return 0
}

export function makeIntuiextendWinFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))

  const windowAt = (addr: number): IeWindow | null => st().windowState.windows.get(addr >>> 0) ?? null

  return {
    /** =Wb Screen Base — routine 8 ($253c), the longword at workspace+$8c */
    'wb screen base': () => VI(st().screenBase),

    /**
     * =Wb Screen Rastport(SCREEN) — routine 13 ($259c), ten bytes:
     *
     *     move.l  (a3)+,d3
     *     addi.w  #$54,d3
     *
     * sc_RastPort's offset, and sc_RastPort is at $2c + vp_SIZEOF: the
     * ViewPort is 40 bytes (six longs, five words, two bytes, one pointer)
     * and $2c + $28 is $54. No check of any kind, so any number plus $54
     * comes back.
     *
     * DEFECT: `addi.w`, so the carry stops at the word. A screen at $xxxxFFD0
     * answers $xxxx0024, 64K below itself.
     */
    'wb screen rastport': (_, a) => {
      const v = i0(a, 0)
      return VI(((v & ~0xffff) | ((v + 0x54) & 0xffff)) | 0)
    },

    /**
     * =First Screen — routine 16 ($25ce), `move.l $3c(a0),d3` on
     * IntuitionBase: ib_FirstScreen, verified against
     * includes/intuition/intuitionbase.i where LIB_SIZE is 34 and v_SIZEOF 18,
     * so ActiveWindow is $34, ActiveScreen $38 and FirstScreen $3c.
     *
     * The guide: "Adresse de l'écran en premier plan (mais pas forcément
     * sélectionné)."
     */
    'first screen': () => VI(frontScreenAddr(rt)),

    /** =Wb Current Screen — routine 96 ($33ac), ib_ActiveScreen at $38 */
    'wb current screen': () => VI(activeScreenAddr(rt)),

    /** =Wb Current Window — routine 95 ($33a0), ib_ActiveWindow at $34 */
    'wb current window': () => {
      const active = rt.intuition.activeWindow
      if (!active) return VI(0)
      for (const w of st().windowState.windows.values()) if (w.win === active) return VI(w.addr)
      return VI(0)
    },

    /** =Wb Wind Base — routine 20 ($2650), the longword at workspace+$18 */
    'wb wind base': () => VI(st().windBase),

    /**
     * =Wb Wind Rastport(WINDOW) — routine 34 ($2cd8), `move.l $32(a0),d3`.
     *
     * wd_RPort. $32 and not $30: ReqCount is a WORD at $2c, so WScreen lands
     * at $2e and RPort at $32.
     *
     * The guide's own warning is worth keeping -- "Ne pas inverser les
     * pointeurs WINDOW et SCREEN" -- because `Wb Screen Rastport` adds $54 to
     * whatever it is given and a window passed to it answers a number that
     * looks like a RastPort and is not one.
     *
     * The keyword the guide documents is `Wb Wind Rport`; the token table
     * spells it `Wb Wind Rastport`, and the table is what a program must type.
     */
    'wb wind rastport': (_, a) => {
      const w = windowAt(i0(a, 0))
      return VI(w ? (w.addr + IE_WINDOW_RP) >>> 0 : 0)
    },

    /**
     * =Amos Rastport — routine 39 ($2d38), `move.l -$18ca(a5),d3`.
     *
     * T_RastPort itself, which is the longword `Wb Screen` and `Wb Window`
     * write. With neither called it is the RastPort of AMOS's current screen,
     * a screen address plus $54.
     */
    'amos rastport': () => {
      const over = st().amosRp
      if (over !== 0) return VI(over)
      return VI((RT.SCREEN_CTRL_BASE + rt.currentIndex * RT.SCREEN_CTRL_SLOT + 0x54) >>> 0)
    },

    /**
     * =X Wind(WINDOW) — routine 60 ($2fae), `move.w $e(a0),d3` after a
     * `moveq #$0,d3`, so wd_MouseX zero-extended.
     *
     * $e is MouseX and $c is MouseY, which is the order struct Window declares
     * them in: "WORD wd_MouseY" then "WORD wd_MouseX". The pointer position
     * RELATIVE TO THE WINDOW, which is why the guide points at 'X Mouse'.
     */
    'x wind': (_, a) => {
      const w = windowAt(i0(a, 0))
      return VI(w ? w.win.mouseX & 0xffff : 0)
    },

    /** =Y Wind(WINDOW) — routine 61 ($2fba), `move.w $c(a0),d3`: wd_MouseY */
    'y wind': (_, a) => {
      const w = windowAt(i0(a, 0))
      return VI(w ? w.win.mouseY & 0xffff : 0)
    },

    /**
     * =Wb Display Alert(HEIGHT,TEXT$) — routine 115 ($3700).
     *
     *     movea.l (a3)+,a0     ; TEXT$
     *     addq.w  #$2,a0       ; past the AMOS length word
     *     move.l  (a3)+,d1     ; HEIGHT
     *     moveq   #$0,d0       ; RECOVERY_ALERT
     *     jsr     -$5a(a6)     ; DisplayAlert
     *
     * RECOVERY_ALERT is 0 (intuition.i:965), so the alert is one the machine
     * can come back from and DisplayAlert answers TRUE if the user pressed the
     * right mouse button to dismiss it.
     *
     * DEVIATION: an alert takes over the whole display in the ROM's own
     * bitmap, above every screen, and nothing in this port can do that. The
     * text and height are evaluated and the answer is FALSE, which is the
     * answer a user who pressed the LEFT button gives.
     */
    'wb display alert': (_, a) => {
      i0(a, 0)
      s0(a, 1)
      return VI(0)
    },

    /**
     * =Wb Bitplane(RPORT,N) — routine 274 ($5076).
     *
     *     move.l  (a3)+,d0        ; N
     *     movea.l (a3)+,a0        ; RPORT
     *     movea.l $4(a0),a0       ; rp_BitMap
     *     asl.w   #$2,d0
     *     move.l  $8(a0,d0.w),d3  ; bm_Planes[N]
     *
     * The plane pointer, for a program that wants to poke a bitplane itself.
     * The same address `Logbase(N)` answers for AMOS's own screen, reached
     * through a RastPort rather than through the current screen: the screen's
     * chip base plus `N * planeSize`, which resolves to the planar mirror and
     * can be peeked and poked.
     *
     * No bound on N. `asl.w #$2,d0` and an index off the end of bm_Planes
     * reads whatever follows the BitMap, so the arithmetic is done and a
     * plane past the screen's depth answers an address nothing backs.
     */
    'wb bitplane': (_, a) => {
      const slot = screenSlotOfRastPort(rt, i0(a, 0))
      if (slot === null) return VI(0)
      const s = rt.screens.get(slot)
      if (!s) return VI(0)
      return VI((rt.screenChipBase(slot) + i0(a, 1) * s.planeSize) >>> 0)
    },

    /**
     * =Wb Check Aga — routine 260 ($4d8e).
     *
     *     adda.w  #$701,a0
     *     moveq   #$0,d3
     *     move.b  (a0),d3
     *     tst.b   d3
     *     beq.b   $4da2
     *     moveq   #$ff,d3          ; $ffffffff, AMOS true
     *
     * DEFECT: it always answers 0. workspace+$701 is READ here and at $4dae in
     * `Wb Kill Aga` and written nowhere in the file, and the byte the library
     * ships at $2429 is zero. The guide says "RESULT=True(-1) ou False(0) si
     * le chipset AGA existe"; the keyword cannot say True on any machine.
     */
    'wb check aga': () => VI(0),

    /**
     * =Wb Lock Pubscreen(NAME$) — routine 134 ($3892), LockPubScreen at -$1fe.
     *
     * `move.w (a0)+,d0` steps over the AMOS length word and the name goes to
     * a0. A NULL or empty name means the default public screen.
     *
     * There is one public screen here and it is the Workbench, so a name that
     * matches it or is empty locks it and anything else answers 0 -- which is
     * what LockPubScreen does for a screen that is not there.
     */
    'wb lock pubscreen': (_, a) => {
      const name = s0(a, 0)
      if (name !== '' && name.toLowerCase() !== 'workbench') return VI(0)
      const addr = rt.intuition.openWorkBench()
      if (addr !== 0) rt.intuition.addVisitor()
      return VI(addr)
    },

    /**
     * =Wb Unlock Pubscreen(NAME$,SCREEN) — routine 135 ($38a8),
     * UnlockPubScreen at -$204 with a0 the name and a1 the screen.
     *
     * The guide promises "SCRPOS=Position de l'écran déverrouillée".
     * UnlockPubScreen returns nothing, so `move.l d0,d3` at $38ba copies
     * whatever the library left in d0 and the caller reads a number that means
     * nothing. Zero here.
     */
    'wb unlock pubscreen': (_, a) => {
      s0(a, 0)
      i0(a, 1)
      rt.intuition.removeVisitor()
      return VI(0)
    },

    /**
     * =Wb Next Pubscreen(SCREEN) — routine 136 ($38c0), NextPubScreen at
     * -$216 with a1 pointing at workspace+$e6.
     *
     * It walks the public screen list and copies the next name into that
     * buffer, which is the buffer `Wb Pubscreen Name` then reads. Returns the
     * buffer or NULL at the end of the list.
     *
     * One public screen here, so a call from the Workbench ends the list and a
     * call from anything else names the Workbench.
     */
    'wb next pubscreen': (_, a) => {
      const from = i0(a, 0)
      const wb = rt.intuition.workBenchOpen()
        ? (RT.SCREEN_CTRL_BASE + WB_SLOT * RT.SCREEN_CTRL_SLOT) >>> 0
        : 0
      if (wb === 0 || (from >>> 0) === wb) {
        st().pubName = ''
        return VI(0)
      }
      st().pubName = 'Workbench'
      return VI(1)
    },

    /**
     * =Wb Set Default Pubscreen(NAME$) — routine 137 ($38dc),
     * SetDefaultPubScreen at -$21c.
     *
     * Another void call whose d0 the routine copies into d3, the same shape as
     * `Wb Unlock Pubscreen`. The name is recorded; there is one public screen
     * and naming a different default cannot change which.
     */
    'wb set default pubscreen': (_, a) => {
      s0(a, 0)
      return VI(0)
    },

    /**
     * =Wb Set Pubscreen Mode(MODE) — routine 138 ($38f4), SetPubScreenModes at
     * -$222, and this one really does return the PREVIOUS modes.
     *
     * The guide names the two bits: "MODE=1 > Shangai", 2 > PopPubScreen.
     */
    'wb set pubscreen mode': (_, a) => {
      const was = st().pubModes
      st().pubModes = i0(a, 0) & 0xffff
      return VI(was)
    },

    /**
     * =Wb Pubscreen Statut(SCREEN,STATUS) — routine 139 ($3908),
     * PubScreenStatus at -$228, which answers the previous status word.
     *
     * The guide's Synoptique writes `Wb Pubscreen Status`; the token table
     * spells it Statut, and the table decides what a program can type.
     */
    'wb pubscreen statut': (_, a) => {
      i0(a, 0)
      const was = st().pubStatus
      st().pubStatus = i0(a, 1) & 0xffff
      return VI(was)
    },

    /**
     * =Wb Pubscreen Name — routine 140 ($391e), and it is broken.
     *
     *     $391e  move.l  #$8b,d7        ; 139 bytes of string
     *     $3924  Rbsr    routine 46
     *     $3928  move.w  (a0)+,d7       ; read the length back, step past it
     *     $392a  movea.l $258(a5),a1
     *     $392e  adda.w  #$e6,a1        ; the NextPubScreen buffer
     *     $3932  moveq   #$0,d6         ; stop at NUL
     *     $3934  Rbsr    routine 144    ; copy, counting
     *     $3938  move.l  a2,d3
     *     $393a  moveq   #$2,d2         ; a string result
     *
     * DEFECT: routine 46 is the wrong routine. Routine 143 ($395c) is the
     * string allocator every other string-returning keyword in the library
     * calls -- `wb fast hex`, `wb encrypt`, `wb decrypt`, `rt get flist$`,
     * `rt string req` and `app get arglist`, six callers -- and it is what
     * leaves a0 pointing at a fresh string with its length word written, which
     * is exactly what `move.w (a0)+,d7` expects. Routine 46 ($2dec) opens
     * powerpacker.library and its other three callers are `pp decrunch`,
     * `pp crunch` and `pp write`. It never touches a0.
     *
     * The bytes at $3924 are `fe 31 00 2e` where they should be `fe 31 00 8f`:
     * one byte, $2e for $8f. So the keyword copies the pubscreen name over
     * whatever a0 happened to hold and returns a pointer into it.
     *
     * Finding it needs the AMOS escape decoder. `$FE31` is `Rbsr`
     * (+CEqu.s:39-150) and a 68000 disassembler renders it as a coprocessor
     * opcode, swallows the operand, and shows two garbage instructions.
     *
     * DEVIATION: a string is a value here and there is no a0 to scribble
     * through, so what a program gets is the name `Wb Next Pubscreen` last
     * put in the buffer. That is the answer the author meant; it is not the
     * answer the shipped library gives.
     */
    'wb pubscreen name': () => VS(st().pubName),
  }
}

/** exported for ./intuiextendgfx.ts, which has to resolve a window's RastPort */
export function ieWindowRastPort(rt: Runtime, addr: number): RastPortT | null {
  const a = addr >>> 0
  const off = a - IE_WINDOW_BASE
  if (off < 0 || off % IE_WINDOW_STEP !== IE_WINDOW_RP) return null
  const w = rt.intuiextend.windowState.windows.get(a - IE_WINDOW_RP)
  if (!w) return null
  const bm = rt.screens.get(w.win.screenSlot)?.rp.bitMap
  if (!bm) return null
  if (!w.rp) {
    w.rp = new RastPort(bm)
    w.rp.font = rt.systemFont()
    w.rp.fgPen = 1
    w.rp.bgPen = 0
  }
  w.rp.clip = {
    x1: w.win.leftEdge,
    y1: w.win.topEdge,
    x2: w.win.leftEdge + w.win.width - 1,
    y2: w.win.topEdge + w.win.height - 1,
  }
  return w.rp
}
