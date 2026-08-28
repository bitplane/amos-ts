/**
 * IntuiExtend 2.01b, the menu group.
 *
 * Seven table entries, six of them live, and every live one is four
 * instructions around a single intuition.library call. `Wb Kill Menu` is the
 * whole shape of the group:
 *
 *     $3644  move.l   a6,-(a7)
 *     $3646  movea.l  -$18a6(a5),a6    ; IntuitionBase
 *     $364a  movea.l  (a3)+,a0
 *     $364c  jsr      -$36(a6)         ; ClearMenuStrip
 *
 * There is no menu-BUILDING keyword anywhere in the extension. The program
 * lays out `struct Menu` and `struct MenuItem` itself with `Alloc Mem`,
 * `Doke` and `Loke`, hands the address to `Wb Menu To Window`, and these
 * keywords walk that memory by fixed offset. That is why the group reads its
 * chain out of the program's own address space rather than holding a parsed
 * copy: the memory is the structure, and a program is free to `Poke`
 * mi_Flags between two calls.
 *
 * ## The one entry that is broken, and the one that replaced it
 *
 * The table's entry at $086a is the only name in all 88 shipped token tables
 * this port reads that begins with a control character. It is
 * `"\0rwb get menu adr"`, with `instr` $ff00 and `func` $ffff, so there is no
 * routine at either field to call.
 *
 * The entry format is `instr.w`, `func.w`, the name with its last character's
 * top bit set, the spec, then $FF. `+Edit.s`:14491 walks it: `TkRNext` adds
 * the entry offset to the table base, `lea 5(a1),a1` steps past the four
 * header bytes and the first name character, and `move.b -1(a1),d0` reads
 * that first character back only to test it against "!" (14498) and " "
 * (14500). Every other name in every other table has a letter or one of
 * those two markers there.
 *
 * IntuiExtend 1.6 has the same entry intact: `"wb get menu adr"`, spec `"00"`,
 * `func` 114. And $0072 is 114. The two bytes now sitting at the front of
 * 2.01b's name ARE the old routine number, so the header was written two
 * bytes short and pushed its own func word into the name field.
 *
 * Routine 114 survives at $36f6 with nothing left pointing at it:
 *
 *     $36f6  movea.l  (a3)+,a0
 *     $36f8  move.l   $1c(a0),d3       ; wd_MenuStrip
 *     $36fc  moveq    #$0,d2
 *
 * and routine 289 at $5568 is those same four instructions again, under the
 * name `Wb Get Menu`. So the capability is not lost. What the guide documents
 * is the dead entry -- Index.guide:151 links "Wb Get Menu Adr" to Men1 -- and
 * the keyword that works is the one it never mentions.
 *
 * ## Evidence
 *
 * BINARY tier. Every LVO was read out of `intuition_lib.fd` under the GUI
 * 2.10 sources, and confirmed against the WB1.3 `intuition_lib.fd` in
 * fixtures for the argument registers: `SetMenuStrip(Window,Menu)(A0/A1)`.
 * Every struct offset comes from AMOS Professional's own
 * `includes/intuition/intuition.i`. Documented against
 * `IntuiExtend_2.0.Guide`'s Menu.guide, @Author CIERP Philippe.
 *
 * ## Two things the guide gets wrong about its own syntax
 *
 * Men2 gives `Wb Kill Menu To WINDOW`. The spec is `"I0"` with no `t`, so the
 * `To` will not parse and the keyword takes one argument.
 *
 * Men0, Men4 and Men5 all call the number "Adresse du menu" -- an ADDRESS --
 * where `Get Menu Code` returns a packed number, five bits of menu, six of
 * item, five of sub. Men9 repeats it. The three keywords take the number,
 * which is what intuition takes.
 *
 * ## What is not here
 *
 * DEVIATION: nothing draws the bar. A menu strip attached by
 * `Wb Menu To Window` is walked, enabled and disabled exactly as intuition
 * walks it, and `Wb Get Menu` reads back the pointer, but the right button
 * does not open a column and no MENUPICK is raised from one. Two other ports
 * in this tree already own a menu tree of their own --- gadtools' MenuStrip
 * in ../amiga/gadtools.ts and Intuition 1.3b's IextMenu in ./intuition.ts ---
 * and drawing an Intuition menu bar belongs with them rather than in a
 * seventh keyword's handler. It costs this group less than it looks: the
 * extension's own pick reporting is defective, and `Get Menu Msg` answers 0
 * whatever the user picked (see ./intuiextendmsg.ts).
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, int, type Value } from '../interp/values'
import { NOITEM, NOSUB, MENUNULL, itemNum, menuNum, subNum } from '../amiga/gadtools'
import { ieMem, ieWindowAt, type IeMem } from './intuiextendwin'

/**
 * `struct Menu`, the three fields this group follows.
 *
 * `intuition.i`:59, :64 and :66. mu_JazzX and the rest of the tail are
 * Intuition's own scratch and nothing here touches them.
 */
const MU = { NEXT: 0x00, FLAGS: 0x0c, FIRSTITEM: 0x12 } as const

/** `struct MenuItem`: `intuition.i`:87, :92 and :106 */
const MI = { NEXT: 0x00, FLAGS: 0x0c, SUBITEM: 0x1c } as const

/** MENUENABLED, `intuition.i`:77 --- "whether or not this menu is enabled" */
const MENUENABLED = 0x0001

/** ITEMENABLED, `intuition.i`:119 --- "set if this item is enabled" */
const ITEMENABLED = 0x0010

/** the nth link of a chain, or 0 when it is shorter than that */
function chase(m: IeMem, head: number, next: number, n: number): number {
  let a = head >>> 0
  for (let i = 0; i < n && a !== 0; i++) a = m.long(a + next) >>> 0
  return a
}

/**
 * ItemAddress(menuStrip, menuNumber) (-$90), walked over program memory.
 *
 * The number is positional and the walk is bounded by it: at most 31 menus,
 * 63 items and 31 sub-items, because that is all the three fields can name.
 * A chain shorter than the number asks for answers 0, which is intuition's
 * NULL and what ../amiga/gadtools.ts answers for the same question over its
 * own tree.
 *
 * A SUBNUM of NOSUB means the item itself was named, so the walk stops there
 * rather than following mi_SubItem.
 */
export function ieItemAddress(rt: Runtime, strip: number, number: number): number {
  const n = number & 0xffff
  if ((strip >>> 0) === 0 || n === MENUNULL) return 0
  const m = ieMem(rt)
  const menu = chase(m, strip, MU.NEXT, menuNum(n))
  if (menu === 0) return 0
  const item = chase(m, m.long(menu + MU.FIRSTITEM) >>> 0, MI.NEXT, itemNum(n))
  if (item === 0) return 0
  const s = subNum(n)
  if (s === NOSUB) return item
  return chase(m, m.long(item + MI.SUBITEM) >>> 0, MI.NEXT, s)
}

/**
 * OnMenu (-$c0) and OffMenu (-$b4): one bit, in the menu or in the item.
 *
 * A number whose ITEMNUM is NOITEM names the whole column, and the bit is
 * MENUENABLED in mu_Flags. Anything else names one item or sub-item, and the
 * bit is ITEMENABLED in mi_Flags. Both are written back into the program's
 * memory, because that is where intuition writes them and a program that
 * `Deek`s mi_Flags afterwards is entitled to see the change.
 */
function setEnabled(rt: Runtime, strip: number, number: number, on: boolean): void {
  if ((strip >>> 0) === 0) return
  const m = ieMem(rt)
  const n = number & 0xffff
  const flip = (addr: number, bit: number): void => {
    const was = m.word(addr) & 0xffff
    m.setWord(addr, on ? was | bit : was & ~bit)
  }
  if (itemNum(n) === NOITEM) {
    const menu = chase(m, strip, MU.NEXT, menuNum(n))
    if (menu !== 0) flip(menu + MU.FLAGS, MENUENABLED)
    return
  }
  const item = ieItemAddress(rt, strip, n)
  if (item !== 0) flip(item + MI.FLAGS, ITEMENABLED)
}

export function makeIntuiextendMenuInstructions(rt: Runtime): Record<string, Instr> {
  /** `WINDOW To NUMBER`, which both of the enable keywords take */
  const winTo = (it: Parameters<Instr>[0]): [number, number] => {
    const w = it.evalInt()
    it.expect('to')
    return [w, it.evalInt()]
  }

  const enable = (it: Parameters<Instr>[0], on: boolean): void => {
    const [win, num] = winTo(it)
    const w = ieWindowAt(rt, win >>> 0)
    if (w) setEnabled(rt, w.menuStrip, num, on)
  }

  return {
    /**
     * Wb Kill Menu WINDOW --- routine 107 ($3644), ClearMenuStrip (-$36).
     *
     * Men2 writes it `Wb Kill Menu To WINDOW`, which will not parse: the spec
     * is `"I0"` and carries no `t` token.
     *
     * ClearMenuStrip detaches the strip and leaves the program's own Menu
     * chain alone, so the memory stays allocated and can be attached again.
     */
    'wb kill menu': (it) => {
      const w = ieWindowAt(rt, it.evalInt() >>> 0)
      if (w) w.menuStrip = 0
    },

    /**
     * Wb Off Menu WINDOW To MENUNB --- routine 109 ($366a), OffMenu (-$b4).
     *
     *     $3670  move.l   (a3)+,d0     ; MENUNB, the LAST argument
     *     $3672  movea.l  (a3)+,a0     ; WINDOW
     *     $3674  jsr      -$b4(a6)
     *
     * Arguments are pushed left to right, so `(a3)+` pops the last of them
     * first and the register order here is the library's, not the keyword's.
     */
    'wb off menu': (it) => enable(it, false),

    /** Wb On Menu WINDOW To MENUNB --- routine 110 ($367c), OnMenu (-$c0) */
    'wb on menu': (it) => enable(it, true),
  }
}

export function makeIntuiextendMenuFunctions(rt: Runtime): Record<string, Func> {
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0

  return {
    /**
     * =Wb Find Menu Item(MENUADR,ITEMNB) --- routine 108 ($3654),
     * ItemAddress (-$90).
     *
     * MENUADR is the MENU CHAIN and not a window, which is worth saying
     * because the other four keywords in the group take a window: ItemAddress
     * is `(menuStrip, menuNumber)` and $365a pops ITEMNB into d0 before
     * $365c pops MENUADR into a0.
     */
    'wb find menu item': (_, a) => VI(ieItemAddress(rt, i0(a, 0) >>> 0, i0(a, 1)) | 0),

    /**
     * =Wb Menu To Window(WINDOW,MENUADR) --- routine 111 ($368e),
     * SetMenuStrip (-$108).
     *
     * $3694 pops MENUADR into a1 and $3696 pops WINDOW into a0, which is the
     * order the WB1.3 `intuition_lib.fd` declares:
     * `SetMenuStrip(Window,Menu)(A0/A1)`.
     *
     * DEVIATION: Men3 promises "SUCCES=True ou False (plus de memoire etc...)"
     * and the routine returns d0 as it stands after the call, but the .fd
     * declares argument registers only and no result, so nothing establishes
     * what intuition leaves there. The port answers AMOS true when the window
     * handle is live and false when it is stale, which is the contract the
     * guide describes.
     */
    'wb menu to window': (_, a) => {
      const w = ieWindowAt(rt, i0(a, 0) >>> 0)
      if (!w) return VI(0)
      w.menuStrip = i0(a, 1) >>> 0
      return VI(-1)
    },

    /**
     * =Wb Get Menu(WINDOW) --- routine 289 ($5568), and the guide has no node
     * for it. See the header: this is the working half of the pair whose
     * documented half, `Wb Get Menu Adr`, has a corrupted table entry.
     *
     * DEVIATION: the routine reads `$1c(a0)` with no check on a0 at all, so
     * on the machine a stale or invented pointer returns whatever lies 28
     * bytes into it. A `struct Window *` is a handle here and not memory, so
     * the only answer this port can give for one it does not know is 0.
     */
    'wb get menu': (_, a) => {
      const w = ieWindowAt(rt, i0(a, 0) >>> 0)
      return VI(w ? w.menuStrip | 0 : 0)
    },
  }
}
