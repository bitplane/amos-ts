/**
 * EasyLife — Paul Hickman's "Computer Programmers" extension, at slot 16.
 *
 * The largest third-party extension in the registry after IntuiExtend: 160
 * table entries in the reference build, spread over zones, string searching,
 * bit twiddling, PowerPacker, XPK, pattern matching, Workbench, taglists,
 * structured variables and MUI. Slice 0 (see the manifests) settled the four
 * builds; this file is what implements them.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, with an unusually good manual beside it.
 * `AMOSPro_EasyLife.Lib` (a 16,436-byte code hunk, 302 routines) plus
 * `Docs/extensions/EasyLife.guide`, `EasyLifeSTRUCT.guide` and
 * `EasyLifeMUI.guide`, all three vendored under the 1.10 fixture. Where the
 * two disagree the binary wins, and over the zone block alone they disagree
 * five times — see the notes on `elznsx`, `elzn shift`, `elzb add`,
 * `elmz set` and `elmzney`.
 *
 * The 1.0 fixture ships `EasyLife.doc` instead, and it is NOT evidence for
 * this port: it installs at extension 16 and documents an earlier and smaller
 * command set, with no Elxpk and no Elst* at all. It is kept because it is
 * what that release shipped, not because anything here was read against it.
 *
 * Quotes from the guides are verbatim, typos and all — `arbitarily`,
 * `occuring`, `equivilent`, `to not obey`. A tidied quote cannot be checked
 * against the file it came from, and citations.test.ts checks every one.
 *
 * ## Four identities, one port
 *
 * `easylife-1.0` renamed nothing in common with the later three (`znsx`
 * became `elznsx`), so it is served through `aliases` rather than by a second
 * implementation. 1.09 and 1.10 differ by one keyword each way. 1.44 dropped
 * everything that needed `easylife.library` or `muimaster.library` and is
 * therefore the subset that stands alone.
 *
 * ## What is not here, and why
 *
 * Twenty-one of the 233 names. Twenty are MUI and wait on a `muimaster` of
 * V8 or better; the archive's is 7.973 and routine 233 demands V8.
 *
 * The twenty-first is `Eltest`, and it is the author's own scaffolding.
 *
 * It exists in **1.09 alone** — 1.0 does not have it, 1.44 does not, and
 * 1.10 does not either. In 1.09 it is the LAST entry of a 220-entry table,
 * at id $e4e, spec `V00,0`: a V-form with two integer arguments, so
 * `=Eltest(a,b)` reads and `Eltest(a,b)=v` writes. Both routines are eight
 * bytes and neither does anything:
 *
 *     255 (the instruction)  moveq #$1,d0 / lea $c(a3),a3 / rts
 *     256 (the function)     moveq #$0,d0 / lea $c(a3),a3 / rts
 *
 * The one register they set is the one that tells the two apart, which is
 * what the name says it is: a probe for checking that AMOS's V-form dispatch
 * reaches the slot it should. `lea $c(a3),a3` pops three longwords, which is
 * right for the assignment form (two arguments and a value) and one too many
 * for the function, and neither sets d3 or d2, so `=Eltest(a,b)` answers
 * whatever d3 held with an undefined type. It is in none of the three guides.
 *
 * 1.10 dropped it and put `Stv` at the same id $e4e — also a V-form, also
 * undocumented. The scaffolding slot became a real keyword, and the four
 * bytes in front of `Stv`'s instruction bodies are recorded on that keyword.
 *
 * So: nothing to implement, and nothing missing. Read, and left out.
 *
 * ## The companion library
 *
 * `$1e8(a5)` is `easylife.library`'s own base, opened by routine 0 (`lea
 * $11a2(pc),a1 / moveq #$1,d0 / jsr -$228(a6)`), and the extension keeps its
 * per-slot data in the library's struct rather than in a block of its own.
 * `El Overlap`'s result rectangle lives there at $a2..$ae, which is why the
 * four `El Lap*` readers are `movea.l $1e8(a5),a0 / move.l $XX(a0),d3` and
 * nothing else. Modelled here as ordinary port state.
 *
 * ## Errors
 *
 * Two tables, and routine 299 ($3aca) is the fork:
 *
 *     tst.l d0 / bmi.b .own / Rjmp L_Error      non-negative: AMOS's number
 *     .own: neg.l d0 / Rbra routine 300         negative: this table, negated
 *
 * Routine 300 is `lea $3aea(pc),a0 / moveq #0,d1 / moveq #$f,d2 / moveq #0,d3
 * / Rjmp L_ErrorExt` over the block below, and its d0 is a ZERO-BASED index
 * into it — pinned by three call sites that name their message: routine 81
 * passes 12 for "No Multi Zones Reserved" (the thirteenth), routine 87 passes
 * 11 for "Multi Zone Not Defined" and routine 83 passes 10 for "Multi Zone
 * Table Full". Routine 3 ($138c) is the shared catch-all, `moveq #$17,d0 /
 * Rjmp L_Error` — AMOS 23. Routine 2 ($1384) is `moveq #$2f,d0`, error 47,
 * and routine 159 ($279c) `moveq #$24,d0`, error 36; those are AMOS's own
 * numbers, so the AMOS-zone block raises nothing from the private table.
 */
import { AMOS_ERRORS, AmosError, ERR, VI, VS, funcCall, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import { Runtime } from './runtime'
import type { Screen } from './screen'
import type { MultiZoneTable, Zone } from './objects'
import { pp20Crunch, pp20Decrunch } from '../amiga/powerpacker'
import { openDiskFont, type DiskFont } from '../amiga/diskfont'
import {
  IDCMP_CLOSEWINDOW,
  IDCMP_MOUSEBUTTONS,
  MENUDOWN,
  MENUUP,
  WBENCHSCREEN,
  WFLG_CLOSEGADGET,
  WFLG_DEPTHGADGET,
  WFLG_DRAGBAR,
  WFLG_RMBTRAP,
  type Window,
} from '../amiga/intuition'
import { execute } from '../amiga/process'
import {
  PatternError,
  type ParsedPattern,
  matchPattern,
  parsePattern,
  patternEscape,
  patternHasSpecials,
  patternRemove,
} from '../amiga/patternlib'
import { XPK_MARGIN, XpkError, xpkExamine, xpkPack, xpkUnpack } from '../amiga/xpkmaster'
import {
  ELST_BANK,
  ELST_ERR_OPEN,
  ElstError,
  type ElstPool,
  type Resolved,
  elstReadWord,
  eraseTree,
  freeBlocks,
  freeInstance,
  getElement,
  getString,
  instanceBytes,
  loadTree,
  lookup,
  newElstPool,
  newInstance,
  putInstanceBytes,
  resolve,
  saveTree,
  setElement,
  setString,
  strCmp,
  structDef,
  typeTable,
} from './elstruct'
import {
  muiAdopt,
  muiAttach,
  muiDetach,
  muiFind,
  muiFree,
  newMuiRegistry,
  type MuiRegistry,
} from './elmui'
import { MUI, MUIC } from '../amiga/muimaster.gen'
import type { BoopsiObject } from '../amiga/boopsi'
import type { MuiNode } from './elmui'

/**
 * The extension's own error messages, in block order, and the index is
 * literally the d0 routine 300 is handed — zero-based, see `elError`.
 *
 * Four slots are empty, and the block partitions exactly as the guide's
 * sections do: nine PowerPacker, one message bank, three multi-zone, one
 * protection, two diskfont, two standard handles, two pattern.library, two
 * XPK, one unmatched tag, three MUI, then twelve for structured variables.
 * Two of the PowerPacker entries carry the same text, so there are 42 slots
 * and 37 distinct messages.
 */
export const EASYLIFE_ERRORS = [
  'Unable To Open Powerpacker Library V35+',
  "You can't PPLoad an empty file",
  'Illegal powerpacker header',
  "File encrypted - Can't decrunch",
  "File encrypted - Can't decrunch",
  'Out of memory while loading / decrunching file',
  'Error reading file',
  'Unable to open file',
  'Crunched File LONGER than source - Aborted',
  'Not a message bank',
  'Multi Zone Table Full - No space to set new zone',
  'Multi Zone Not Defined',
  'No Multi Zones Reserved',
  'Set Protection bits failed',
  "Can't open diskfont.library",
  'Unable to lock font',
  'No STDOUT file handle exists',
  'No STDIN file handle exists',
  "Can't open pattern.library",
  'No Default Pattern Defined',
  'An Xpk Error Has Occured',
  'Could Not Open XPK Master Library',
  'Unmatched tag',
  'Could Not Open MUI Master Library V8+ (MUI V2.1+)',
  'Illegal MUI Object Address',
  'Missing Elmui Begin Instruction',
  '',
  '',
  '',
  '',
  'Array index value is too high',
  'Array index value is negative',
  'Value assigned is beyond lower limit of ranged integer',
  'Value assigned is beyond upper limit of ranged integer',
  'Value assigned points to wrong type of strucuture/no structure',
  'String assigned is longer than maximum length of this element',
  'Substructure addresses cannot be changed',
  'No structures are allocated',
  'Element/Structure not recognised',
  'Cannot copy between structures of different types',
  'Input string is of wrong length',
  'Input string is of wrong type',
]

export interface EasyLifeState {
  /**
   * `El Overlap`'s result rectangle — $a2/$a6/$aa/$ae of the companion
   * library's struct, in that order sx/sy/ex/ey.
   *
   * NOTE: nothing initialises these. They are fields of an `easylife.library`
   * base the extension merely opened, and the four readers do no
   * has-it-been-computed test at all, so `El Lapsx` before the first `El
   * Overlap` reads whatever the library left there. Zero here.
   */
  lapsx: number
  lapsy: number
  lapex: number
  lapey: number
  /**
   * `Elmzone`'s saved query — $6e/$70/$74/$72/$76 of the same struct, in the
   * order x, y, group filter, scan cursor, last group found.
   *
   * They live in the LIBRARY and not on the screen, which is what lets
   * `Elmzonen` carry on where `Elmzone` left off across anything that does
   * not touch the zone table. The cursor is a record offset on the machine
   * and always a multiple of eight; it is a slot index here.
   */
  mzX: number
  mzY: number
  mzFilter: number
  mzCursor: number
  mzGroup: number
  /**
   * $a0 of the same struct — what a FAILED forward search answers.
   *
   * `Elf Fail Start` (routine 151) writes 0 and `Elf Fail End` (routine 152)
   * writes $ffff, and the five forward searches read it with `tst.w $a0(a1)`
   * on their not-found path: zero means 0, anything else means the string's
   * length plus one. Boot state is `Elf Fail Start`, which is also what the
   * Default hook puts back.
   */
  elfFailEnd: boolean
  /**
   * $78 of the same struct — the `powerpacker.library` base `Elpp Keep On`
   * holds open. "The library is loaded into memory when you first use either
   * of these commands, but may sometimes be removed again by the exec memory
   * manger afterwards. To make sure the library stays in memory these two
   * commands are provided."
   *
   * NOTE: the codec is `src/amiga/powerpacker.ts` here and is always
   * present, so the flag is bookkeeping — nothing can fail to open, and
   * nothing can be flushed out from under a program.
   */
  ppKeep: boolean
  /**
   * The open-font list at $7c of the companion struct — a singly linked
   * chain, each node `next` then the TextFont, which is why "You can access
   * the AmigaOS 'TextFont' structure of the opened font with F=Open
   * Font(...) : TF=Leek(F+4)".
   *
   * Keyed here by the FONTID the extension hands back, which is the node
   * address: "The value returned is a pointer, not a consecutive integer
   * like AMOS font numbers", and "If you open the same font twice, you are
   * returned the original pointer the second time".
   */
  fonts: Map<number, DiskFont>
  fontOrder: number[]
  /**
   * `$e0` and `$e4` of the companion struct — the bank numbers routine 203
   * and routine 245 read. Routine 0 writes 13 and 14 (`move.l #$d,$e0(a2)`
   * / `move.l #$e,$e4(a2)`), matching the guide's "Bank 13 of your program
   * must be a 'Tag' bank". Nothing in the keyword set writes them again, so
   * they are constants in practice; they are fields here because the binary
   * makes them fields.
   */
  tagBank: number
  tagListBank: number
  /**
   * `$ca` — the `Tag Keep` flag (routine 216 stores the argument whole).
   * Routine 240 reads it only on the no-OBJECT path: nonzero keeps the
   * string with the next object created, zero puts it in the temporary
   * buffer.
   */
  tagKeep: number
  /**
   * `$ba` — the pool block size, `$2000` at init. `Tag Block Size` (routine
   * 226) refuses anything below $1000 or above $40000, and refuses outright
   * once `$be` (the pool head) is non-null.
   */
  tagBlockSize: number
  /**
   * `$be` — the head of the pool chain routine 239 allocates from, modelled
   * as the ext-data blocks handed out so far. Empty means "no pool yet",
   * which is what `Tag Block Size` tests.
   */
  tagPool: Array<{ base: number; block: Uint8Array; next: number }>
  /** every stored string, keyed by the address `Tag Str` answers */
  tagStrings: Map<number, string>
  /**
   * `$98` of the companion struct --- the pattern `Elpat Set Case` and
   * `Elpat Set Nocase` compiled, which `Elpat Def` matches against and
   * `Elpat Free` throws away. Set-once state: routine 136 calls routine 139
   * before parsing, so setting a new one frees the old without the program
   * having to, which is the guide's "You can call El Pat Set Case / El Pat
   * Set Nocase again to change the pattern ... without calling ElPat Free
   * first".
   */
  patDefault: ParsedPattern | null
  /**
   * `$b6` --- the last XPK result, which `Elxpk Error` reads back.
   *
   * Every one of the five XPK keywords ends the same way: `movea.l $1e8(a5),a1
   * / move.l d0,$b6(a1) / bne` the error, so the field is written on success
   * too and a program can check it after a call that did not raise.
   */
  xpkError: number
  /**
   * `$f4` and `$f8` of the same base --- `easylife.library`'s live instance
   * count and the chain of pool blocks it allocates them from. See
   * `elstruct.ts`, which is the library.
   */
  structs: ElstPool
  /**
   * `$88` of the companion struct --- the iconify window, which is a
   * `struct Window *` on the machine and is what makes `Eliconify Begin`
   * refuse to run twice (`tst.l $88(a2) / Rbne routine 3`) and `Eliconify
   * Test` and `End` refuse to run at all before it (`Rbeq routine 3`).
   */
  iconWindow: Window | null
  /**
   * `$8c` --- a word, and it is a LATCH rather than a flag: `Eliconify Test`
   * sets it on a MENUDOWN inside the window and only accepts the matching
   * MENUUP if it is set. So the button has to go down and come up in the
   * window, and a MENUUP left over from a press somewhere else is ignored.
   */
  iconMenuDown: boolean
  /**
   * `$8e` --- the window's width, `len(TITLE$) * 8 + 80`, saved because
   * `Eliconify Test` bounds-checks the pointer against it (`cmp.w $8e(a2),d0
   * / bcc`) rather than reading it back out of the window.
   */
  iconWidth: number
  /** Eliconify Amos is a loop; true while it is going round it */
  iconAmos: boolean
  /**
   * `$c2`, `$c6`, `$e8` and `$cc` --- routine 238's object registry, the
   * `Mui Begin` counter, the application object and the signal mask. See
   * `elmui.ts`, which is the half of MUI that belongs to the extension.
   */
  mui: MuiRegistry
}

export const newEasyLifeState = (): EasyLifeState => ({
  lapsx: 0,
  lapsy: 0,
  lapex: 0,
  lapey: 0,
  mzX: 0,
  mzY: 0,
  mzFilter: 0,
  mzCursor: 0,
  mzGroup: 0,
  elfFailEnd: false,
  ppKeep: false,
  fonts: new Map(),
  fontOrder: [],
  tagBank: 13,
  tagListBank: 14,
  tagKeep: 0,
  tagBlockSize: 0x2000,
  tagPool: [],
  tagStrings: new Map(),
  patDefault: null,
  xpkError: 0,
  structs: newElstPool(),
  iconWindow: null,
  iconMenuDown: false,
  iconWidth: 0,
  iconAmos: false,
  mui: newMuiRegistry(),
})

/** the unsigned view of an AMOS 32-bit integer, which is how routine 153 compares */
const u32 = (n: number): number => n >>> 0

// ---- the iconify family (routines 123-126) --------------------------------

/**
 * `=Eliconify Begin(X, Y, TITLE$)` — routine 124 ($21ee), 182 bytes, and the
 * whole of the iconify window is in it.
 *
 *     movea.l $1e8(a5),a2 / tst.l $88(a2) / Rbne routine 3
 *     jsr -$d2(a6)                    OpenWorkBench
 *     tst.l d0 / bne                  0 -> moveq #1,d3 / lea $c(a3),a3
 *     jsr -$156(a6)                   WBenchToFront
 *     Rbsr routine 1                  NUL-terminate the title
 *     movea.l (a3)+,a1 / move.w (a1)+,d0
 *     asl.w #$3,d0 / addi.w #$50,d0   WIDTH = len * 8 + 80
 *     move.w d0,$8e(a2)
 *     lea $2274(pc),a0                the NewWindow
 *     move.l a1,$1a(a0)               nw_Title
 *     move.w d0,$4(a0)                nw_Width
 *     move.l (a3)+,d0 / move.w d0,$2(a0)      nw_TopEdge
 *     move.l (a3)+,d0 / move.w d0,(a0)        nw_LeftEdge
 *     jsr -$cc(a6)                    OpenWindow
 *     moveq #$2,d3 / tst.l d0 / beq
 *     move.l d0,$88(a2) / move.w #$0,$8c(a2) / moveq #$0,d3
 *
 * The forty-eight bytes at $2274 are a `struct NewWindow` and they decode
 * field for field: LeftEdge 0, TopEdge 0, Width 0, Height 11, DetailPen 0,
 * BlockPen 1, IDCMPFlags $208, Flags $1000E, no gadgets, no CheckMark, Title
 * patched in, no Screen, no BitMap, no size limits, Type 1 — WBENCHSCREEN.
 * $208 is CLOSEWINDOW | MOUSEBUTTONS and $1000E is RMBTRAP | DRAGBAR |
 * DEPTHGADGET | CLOSEGADGET.
 *
 * The height of 11 is the number that ties the two halves of this port
 * together: it is what `BorderTop = WBorTop + tf_YSize + 1` comes to for
 * topaz 8, so the window is a title bar and nothing else, which is why
 * `Eliconify Test` rejects anything at row 10 or below.
 *
 * NOTE: no WFLG_ACTIVATE. The window opens unactivated and the guide is
 * explicit about the consequence — "If you activate the window, then press
 * the right mouse button" — so the right button does not reach it until the
 * user has clicked on it. That is not an oversight to fix; it is what makes
 * the click-then-right-click sequence the documented one.
 *
 * The three return codes are the routine's own: 1 for a Workbench that would
 * not open, 2 for a window that would not, 0 for success.
 */
function elIconifyBegin(rt: Runtime, x: number, y: number, title: string): number {
  const st = rt.easylife
  if (st.iconWindow) funcCall() // tst.l $88(a2) / Rbne routine 3
  const int = rt.intuition
  if (int.openWorkBench() === 0) return 1
  int.wBenchToFront()
  st.iconWidth = title.length * 8 + 80
  const win = int.openWindow({
    leftEdge: x,
    topEdge: y,
    width: st.iconWidth,
    height: 11,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_CLOSEWINDOW | IDCMP_MOUSEBUTTONS,
    flags: WFLG_RMBTRAP | WFLG_DRAGBAR | WFLG_DEPTHGADGET | WFLG_CLOSEGADGET,
    title,
    type: WBENCHSCREEN,
  })
  if (!win) return 2
  st.iconWindow = win
  st.iconMenuDown = false
  return 0
}

/**
 * `=Eliconify Test` — routine 125 ($22a4), 120 bytes: GetMsg on the window's
 * UserPort in a loop, and the first message that survives four filters ends
 * it.
 *
 *     movea.l $56(a0),a0              Window->UserPort
 *  L: jsr -$174(a6)                   exec GetMsg
 *     moveq #$0,d3 / tst.l d0 / beq   empty -> 0
 *     move.w $18(a1),d2               IntuiMessage->Code
 *     cmp.w #$e9,d2 / bne             MENUUP?
 *     tst.l $8c(a2) / beq L           ... the latch
 *     move.w #$0,$8c(a2)
 *     move.w $20(a1),d0 / bmi L       MouseX < 0
 *     cmp.w $8e(a2),d0 / bcc L        MouseX >= width
 *     move.w $22(a1),d0 / bmi L       MouseY < 0
 *     cmp.w #$a,d0 / bcc L            MouseY >= 10
 *     cmp.w #$69,d2 / bne             MENUDOWN?
 *     move.w #$1,$8c(a2) / bra L      ... set the latch
 *     move.l $14(a1),d6 / moveq #$ff,d3
 *     cmp.w #$8,d6 / beq              Class == MOUSEBUTTONS -> -1
 *     moveq #$1,d3                    else (CLOSEWINDOW) -> 1
 *
 * So -1 is the right button used inside the window and 1 is the close gadget,
 * which is what the guide says of THIS keyword. What it says of `Eliconify
 * Amos` has the two the other way round; see there.
 *
 * DEFECT: the latch is dead. `move.w` writes $8c and `tst.l` reads $8c-$8f,
 * and $8e is the window width — never zero after `Eliconify Begin`, so the
 * test never fails and the `beq` is never taken. The author meant "only
 * accept a MENUUP whose MENUDOWN was in this window"; what the code does is
 * accept every MENUUP whose coordinates are in the window, including the
 * release of a press that started somewhere else entirely. Reproduced,
 * because a program that presses the right button outside the window and
 * lets go inside it de-iconifies on the machine.
 *
 * NOTE: no ReplyMsg, anywhere. On the machine every message this consumes is
 * leaked and Intuition's supply drains; here the queue simply shortens, so
 * the defect has no observable effect and is not reproduced.
 */
function elIconifyTest(rt: Runtime): number {
  const st = rt.easylife
  const win = st.iconWindow
  if (!win) funcCall() // Rbeq routine 3
  for (;;) {
    const m = win.getMsg()
    if (!m) return 0
    if (m.code === MENUUP) {
      // the dead latch, per the block above: `tst.l $8c(a2)` covers the
      // width word too, so this arm is always taken and `st.iconMenuDown`
      // is written and never read

      st.iconMenuDown = false
    }
    if (m.mouseX < 0 || m.mouseX >= st.iconWidth) continue
    if (m.mouseY < 0 || m.mouseY >= 10) continue
    if (m.code === MENUDOWN) {
      st.iconMenuDown = true
      continue
    }
    return (m.class & 0xffff) === IDCMP_MOUSEBUTTONS ? -1 : 1
  }
}

/**
 * `Eliconify End` — routine 126 ($231c), forty bytes:
 *
 *     movea.l $1e8(a5),a2 / move.l $88(a2),d0 / movea.l d0,a0
 *     Rbeq routine 3                  no window -> Illegal Function Call
 *     move.l #$0,$88(a2)
 *     jsr -$48(a6)                    CloseWindow
 *
 * The field is cleared BEFORE the close, so a failure inside CloseWindow
 * cannot leave a stale pointer behind. It does not close the Workbench: the
 * guide's procedure has the program bring AMOS back to front itself.
 */
function elIconifyEnd(rt: Runtime): void {
  const st = rt.easylife
  const win = st.iconWindow
  if (!win) funcCall()
  st.iconWindow = null
  rt.intuition.closeWindow(win)
}

/** `move.w` into a cleared register: the low word, unsigned */
const w = (n: number): number => n & 0xffff
/** `move.w` then `ext.l`: the low word, signed */
const sw = (n: number): number => ((n & 0xffff) << 16) >> 16

/**
 * Routine 300 ($3ada) — raise one of the extension's own messages.
 *
 * `lea $3aea(pc),a0 / moveq #0,d1 / moveq #$f,d2 / moveq #0,d3 / Rjmp
 * L_ErrorExt`, and d0 arrives as a ZERO-BASED index into the block: routine
 * 81 passes 12 for "No Multi Zones Reserved", which is the thirteenth
 * message, routine 87 passes 11 for "Multi Zone Not Defined" and routine 83
 * passes 10 for "Multi Zone Table Full". Routine 299 is the other way in and
 * merely negates, so an AMOS-style code of -12 lands on the same message.
 */
const elError: (n: number) => never = (n) => {
  lastElError = n
  throw new AmosError(EASYLIFE_ERRORS[n] ?? `EasyLife error ${n}`)
}

/**
 * `$44` of the library base, the field 1.0's `=El Error` reads back.
 *
 * MODULE state, not `EasyLifeState`, and that is a deliberate and narrow
 * exception. 1.0's error thrower is routine 166 ($192e), which opens with
 * `movea.l $1e8(a5),a2 / adda.w #$44,a2 / move.l d0,(a2)` before it reaches
 * `L_ErrorExt` — the number is recorded on the way past, from twenty-two
 * places, and threading a Runtime through every one of them to reach a field
 * only 1.0 can read would cost more than it is worth.
 *
 * What it costs instead: two Runtimes alive in the same process share it. The
 * field is read-and-cleared and only 1.0 has the reader, so the sharing is
 * observable only by a program that raises in one Runtime and reads in
 * another, which is not a thing an AMOS program can do.
 */
let lastElError = 0

/**
 * Routines 4 and 5 ($1394, $13a4) — which screen the zone readers ask.
 *
 * Routine 4 is the one-argument form and takes the CURRENT screen straight
 * out of `$52c(a5)` (T_EcCourant), raising routine 2 (error 47) when there is
 * none rather than going through L_GetEc. Routine 5 is the two-argument form
 * and does `move.l (a3)+,d1 / Rjsr L_GetEc`, so the screen number is checked
 * by AMOS itself.
 */
function elScreen(rt: Runtime, a: Value[], full: number): Screen {
  if (a.length < full) return rt.screen
  const n = int(a[0]!)
  const s = rt.screens.get(n)
  if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
  return s
}

/**
 * Routine 6 ($13b2) — the zone the readers index, shared by all eight forms.
 *
 *     movea.l $d2(a0),a1        EcAZones
 *     moveq   #$0,d2 / move.w $d6(a0),d2    EcNZones
 *     tst.l   d5 / Rbeq routine 3           zone 0 is AMOS 23
 *     cmp.l   d5,d2 / Rbcs routine 3        past the count is AMOS 23
 *     asl.w   #$3,d5 / moveq #$0,d3
 *
 * There is NO null check on EcAZones: a screen with no zones reserved has
 * count 0, so `cmp.l d5,d2` catches every zone number and the table is never
 * reached. `null` here is a reserved-but-unset zone, which reads as four
 * zeroes exactly as the guide says.
 */
function elZone(s: Screen, n: number): Zone | null {
  if (n === 0) funcCall()
  if (u32(n) > s.zones.length) funcCall()
  return s.zones[n - 1] ?? null
}

/**
 * The reader's own two instructions: `move.w -$N(a1,d5.w),d3` into a d3 that
 * routine 6 cleared, so the answer is the stored word ZERO-EXTENDED.
 *
 * NOTE: the guide's C_Elznsx says "These commands return signed integers.
 * (-32768 to 32767)" and it is wrong — nothing sign-extends. Its own
 * C_ElznShift note contradicts it and agrees with the binary: "if you shift a
 * zone with co-ordinates 10,10 to 50,20 by 20 pixels to the left, the new
 * co-ordinates will be 65526,10 to 30,20". 65526, not -10.
 */
const elCoord = (z: Zone | null, k: 'x1' | 'y1' | 'x2' | 'y2'): Value => VI(w(z?.[k] ?? 0))

// ---- character searching ---------------------------------------------------

/**
 * Routine 34 ($153a) — the setup every FORWARD search shares.
 *
 *     movea.l (a3)+,a0 / move.w (a0)+,d1        the string, then its length
 *     move.l d1,d6 / add.l a0,d1                d6 keeps it, d1 becomes the end
 *     movea.l a0,a1 / tst.l d3 / Rbmi routine 3     a negative start is AMOS 23
 *     adda.l d3,a0                              start scanning at index d3
 *     move.l d0,d4 / andi.l #$ffffff00,d4 / Rbne routine 3
 *
 * NOTE: the guide says of the start argument "Any value of P is accepted, but
 * is taken to be unsigned, so negative numbers are treated as very high
 * positive numbers". `tst.l d3 / Rbmi` says otherwise — a negative P is an
 * Illegal Function Call, in both this and the backward setup. What IS accepted
 * is a P past the end, which simply finds nothing.
 *
 * Returns the search window as indices into `s`, or raises.
 */
function fwdStart(start: number, ch: number): number {
  if (start < 0) funcCall()
  if ((ch & ~0xff) !== 0) funcCall()
  return start
}

/** routine 37 ($15ac) — the same for the BACKWARD searches, where P is 1-based */
function backStart(s: string, start: number, ch: number): number {
  if (start < 0) funcCall()
  // `beq.s` on zero and `cmp.l d3,d1 / bcs` on a start past the length both
  // land on `adda.l d1,a0`, the end of the string; otherwise `subq.l #$1,d3`
  if ((ch & ~0xff) !== 0) funcCall()
  return start === 0 || u32(s.length) < u32(start) ? s.length : start - 1
}

/**
 * The not-found answer of the five FORWARD searches — routines 35, 36, 40, 41
 * and 45 all end with the same six instructions:
 *
 *     moveq #$0,d3 / movea.l $1e8(a5),a1
 *     tst.w $a0(a1) / beq.s .out / move.l d6,d3 / addq.l #$1,d3
 *
 * The four BACKWARD ones (routines 38, 39, 42, 43) do not consult it and
 * always answer 0, and neither does `Elf Num`. That asymmetry is the
 * routines' and is kept.
 */
const elfMiss = (rt: Runtime, len: number): number => (rt.easylife.elfFailEnd ? len + 1 : 0)

/** true when `c` is one of the characters of `set` — routines 40-43's inner dbra */
const inSet = (set: string, c: string): boolean => set.includes(c)

/** what makes two `Elopen Font` calls the same font — the TextAttr pair */
const fontKey = (f: DiskFont): string => `${f.name.toLowerCase()}/${f.ySize}`

// ---- PowerPacker buffers ---------------------------------------------------

/**
 * The eight-slot table at `$2e` of the companion struct, two longwords a
 * buffer. `strict` is the `cmp.w #$8,d0` the two READERS use where the three
 * keywords that create a buffer use `cmp.l`.
 */
function ppSlot(rt: Runtime, n: number, wordCheck: boolean): Uint8Array | null {
  if ((wordCheck ? w(n) : u32(n)) >= 8) funcCall()
  return rt.ppBuffers[w(n) & 7] ?? null
}

/** where `Elpp Buf` says the buffer is, so `Elmem$(ElPp Buf(0)+POS,...)` works */
const ppAddr = (n: number): number => (Runtime.PP_BUFFER_BASE + (w(n) & 7) * Runtime.PP_BUFFER_SLOT) | 0

// ---- bits, memory and message banks ----------------------------------------

/** `cmp.l #$10,d0 / Rbcc routine 3`, unsigned, so a negative bit goes too */
function bitArgs(a: Value[], width: number): number {
  if (u32(int(a[0] ?? VI(0))) >= width) funcCall()
  return int(a[1] ?? VI(0))
}

/** the six modifying keywords: pop ADDR then BIT, read, change, write back */
function bitOp(rt: Runtime, it: Interp, width: number, f: (v: number, b: number) => number): void {
  const bit = it.evalInt()
  it.expect(',')
  const addr = it.evalInt()
  if (u32(bit) >= width) funcCall()
  if (width === 16) pokeWord(rt, addr, f(peekWord(rt, addr), bit))
  else pokeLong(rt, addr, f(peekLong(rt, addr), bit))
}

const peekWord = (rt: Runtime, a: number): number => (peekByte(rt, a) << 8) | peekByte(rt, a + 1)
const peekLong = (rt: Runtime, a: number): number => ((peekWord(rt, a) << 16) | peekWord(rt, a + 2)) >>> 0
function pokeWord(rt: Runtime, a: number, v: number): void {
  writeBytes(rt, a, String.fromCharCode((v >>> 8) & 0xff, v & 0xff))
}
function pokeLong(rt: Runtime, a: number, v: number): void {
  writeBytes(rt, a, String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
}

// ---- XPK ------------------------------------------------------------------

/**
 * The 24 bytes AMOS keeps in FRONT of every memory bank, which is what
 * `Elxpk Save` writes to the file and `Elxpk Load` reads back.
 *
 * `Bnk.Reserve` (+Lib.s:8470) asks `Lst.Cree` for `length + 16` and the list
 * node adds its own eight on top --- "Gestion de liste simple NEXT.l LONG.l"
 * (+B.s:1219). So `Start(n) - 24` is:
 *
 *     +$0   long   NEXT, the link to the next bank
 *     +$4   long   LONG, the size Lst.Cree was asked for = length + 16
 *     +$8   long   the bank number          `move.l d4,(a1)+`
 *     +$c   word   the flags, bit 0 Data / bit 1 Chip   `move.w d5,(a1)+`
 *     +$e   word   zero                     `clr.w (a1)+`
 *     +$10  8 chars  the name
 *     +$18  the data
 *
 * Routine 180 saves from `a0 - $18` for `-$14(a0) + 8` bytes, which is
 * `(length + 16) + 8` --- the node, the header and the data exactly. And
 * `Elxpk Lof`'s `move.l $32(a0),d7` reads offset 8 of the stream header's
 * `xsh_Initial`, which is offset 8 of the original data: the bank number.
 * That is how `Elxpk Load` with no `To` knows where the bank came from.
 *
 * NOTE: there is no such node in this port --- a bank is a `MemBank` record
 * and `bankBase(n)` addresses its data directly, with nothing mappable in
 * front. So the twenty-four bytes are synthesised on save and read back on
 * load rather than copied out of and into live memory. NEXT is written zero
 * because a link into one session's heap means nothing in another, which is
 * the same reason routine 176 has to put the old one back.
 */
const BANK_NODE = 24

function bankHeaderBytes(num: number, flags: number, name: string, length: number): Uint8Array {
  const h = new Uint8Array(BANK_NODE)
  const put = (o: number, v: number): void => {
    h[o] = (v >>> 24) & 0xff
    h[o + 1] = (v >>> 16) & 0xff
    h[o + 2] = (v >>> 8) & 0xff
    h[o + 3] = v & 0xff
  }
  put(0, 0) // NEXT
  put(4, length + 16) // LONG, as Bnk.Reserve computes it
  put(8, num)
  h[12] = (flags >>> 8) & 0xff
  h[13] = flags & 0xff
  const padded = (name + '        ').slice(0, 8)
  for (let i = 0; i < 8; i++) h[16 + i] = padded.charCodeAt(i)
  return h
}

/**
 * Read one file for the XPK keywords, then run `fn` with XPK failures turned
 * into the extension's own error 20.
 *
 * Routine 186 ($2bb0) opens xpkmaster.library once and caches the base at
 * `$b2`, raising message 21 "Could Not Open XPK Master Library" if it cannot
 * --- unreachable here, the master is ported. Every caller then does
 * `move.l d0,$b6(a1) / bne` message 20, so the code is recorded whether or
 * not it is zero.
 */
function xpkGuard<T>(rt: Runtime, fn: () => T): T {
  try {
    const out = fn()
    rt.easylife.xpkError = 0
    return out
  } catch (e) {
    if (e instanceof XpkError) {
      rt.easylife.xpkError = e.code
      elError(20) // 'An Xpk Error Has Occured'
    }
    throw e
  }
}

/** the bytes of a file, or routine 176's "Unable to open file" */
function xpkRead(rt: Runtime, path: string): Uint8Array {
  const raw = rt.fs?.read(path)
  if (!raw) elError(7)
  return Uint8Array.from(raw)
}

// ---- memory and message banks ----------------------------------------------

/** one byte of AMOS's address space, 0 where nothing is mapped */
function peekByte(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  return m ? (m.data[m.off] ?? 0) : 0
}

/**
 * Routine 69 ($1af4): the string's own bytes, nothing before and nothing
 * after. Through `resolveWrite`, not `resolveAddr` — a screen's chunky cache
 * has to be invalidated when its bitplanes are written to, and
 * screen.planar.test.ts is the guard that says so.
 */
function writeBytes(rt: Runtime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    const m = rt.resolveWrite(addr + i)
    if (m) m.data[m.off] = s.charCodeAt(i) & 0xff
  }
}

/**
 * Routine 147 ($262c) — locate a message, and the only description of the
 * message-bank format that exists.
 *
 * The bank is identified by its NAME, the eight bytes before the data
 * compared against the inline `"Message "` at $26a2 with two `cmpm.l`; a
 * mismatch is message 9, "Not a message bank". Then, with `base` the data
 * start:
 *
 *     (base)          a longword; `move.l (a0),d7 / subi.l #$10,d7` is
 *                     compared against GROUP*4, so the group table runs out
 *                     at (base)-16
 *     base+8+g*4      the group's entry-table offset, and +$c its end, so a
 *                     group's entries are the gap between consecutive slots
 *     a1 = base + (base)
 *     a1+off+n*6      the entry: a longword offset then a word length
 *                     (`asl.l #$1,d0 / asl.l #$2,d7 / add.l d7,d0` is n*6)
 *     base + (base+4) + that offset      the text
 *
 * Out of range in either direction answers 0 rather than raising, which is
 * what makes `Elmessage Exists` a test rather than a trap.
 *
 * NOTE: no message bank exists anywhere in the archive. They come from "the
 * Message Bank Compiler PratchED extension program", which the guide admits
 * was never released — "For more information, read the message bank compiler
 * documentation. (Which one day, I might even release!)". So this layout is
 * routine 147's alone, and the test that exercises it builds a bank to match,
 * which proves the reader agrees with the reading and nothing more.
 */
function message(rt: Runtime, a: Value[]): { data: Uint8Array; at: number; len: number } | null {
  const n = int(a[0] ?? VI(0))
  const group = int(a[1] ?? VI(0))
  const num = int(a[2] ?? VI(0))
  // `move.l (a3)+,d7 / Rbmi routine 3` twice, on NUMBER then GROUP
  if (num < 0) funcCall()
  if (group < 0) funcCall()
  // L_Bnk_OrAdr: a legal bank number is a bank, anything else an address
  const b = rt.memBanks.get(n)
  const data = b?.data ?? rt.resolveAddr(n)?.data
  const base = b ? 0 : (rt.resolveAddr(n)?.off ?? 0)
  if (!data) throw new AmosError('Bank not reserved', 36)
  // $26a2 compares the field's eight bytes, so the comparison is made on the
  // padded form. Names are held trimmed here, and a bank called 'Message'
  // has the same eight bytes on the machine as one called 'Message '.
  if ((b?.name ?? '').padEnd(8, ' ') !== 'Message ') elError(9)
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const rd = (o: number): number => (o + 4 <= data.length ? v.getUint32(base + o, false) : 0)
  if (u32(rd(0) - 0x10) < u32(group * 4)) return null
  const from = rd(8 + group * 4)
  const span = rd(0xc + group * 4) - from
  const at = num * 6
  if (u32(at) >= u32(span)) return null
  const entry = base + rd(0) + from + at
  const off = v.getUint32(entry, false)
  const len = v.getUint16(entry + 4, false)
  return { data, at: base + rd(4) + off, len }
}

// ---- patterns -------------------------------------------------------------

/**
 * The shape routines 133, 134, 137, 138 and 135 all share: call
 * pattern.library, and turn any negative answer into AMOS 23.
 *
 * `Rbmi routine 3` is the whole of the error handling on the EasyLife side,
 * so the five codes pattern.library separates --- -100 out of memory, -101 a
 * stray `)`, -103 a stray `]`, -105 a malformed pattern, -107 bad flags ---
 * all arrive as one "Illegal function call".
 */
function patParse(p: string, noCase: boolean): ParsedPattern {
  try {
    return parsePattern(p, noCase)
  } catch (e) {
    if (e instanceof PatternError) funcCall()
    throw e
  }
}

/** routines 133/134 over the composite entry points $21ae and $21e6 */
function patMatch(rt: Runtime, a: Value[], noCase: boolean): number {
  void rt
  const pattern = str(a[0] ?? VS(''))
  const subject = str(a[1] ?? VS(''))
  return matchPattern(patParse(pattern, noCase), subject) ? -1 : 0
}

// ---- taglists --------------------------------------------------------------

/**
 * Routine 204 ($2d56) — the search both tag banks share. The bank is a binary
 * search tree of ten-byte-headed nodes:
 *
 *     +$0  word   the offset of the "node greater" child, 0 for none
 *     +$2  word   the offset of the "node less" child, 0 for none
 *     +$4  long   the value
 *     +$8  word   the name length
 *     +$a         the name bytes
 *
 * Both child links are offsets from the BANK start (`move.l a0,d5` on entry,
 * then `movea.l d5,a0 / adda.l d0,a0`), not from the node.
 *
 * The comparison is `cmpm.b (a1)+,(a2)+`, which computes node minus query, so
 * `blt` — node sorts before query — takes the +$2 link and anything else
 * takes +$0. Running out of query bytes first (`cmp.w d0,d1 / beq`) is a hit
 * only if the node ends there too; otherwise the query is a proper prefix of
 * the node and the walk goes to +$0. Running out of node bytes first goes to
 * +$2. A zero link on either path is the miss.
 *
 * The reading is checked against Tag_Editor.AMOS's own 21,936-byte bank
 * rather than one built to match: TAG_DONE is 0, TAG_IGNORE 1, TAG_USER
 * $80000000 and MUIA_Window_Title $8042ad3d, which are the real values.
 */
function tagFind(data: Uint8Array, base: number, name: string): number | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let at = base
  for (;;) {
    if (at + 10 > data.length) return null
    const gt = v.getUint16(at, false)
    const lt = v.getUint16(at + 2, false)
    const len = v.getUint16(at + 8, false)
    let i = 0
    let go = -1 // -1 undecided, 0 the +$0 link, 2 the +$2 link
    for (;;) {
      if (i === name.length) {
        if (i === len) return v.getUint32(at + 4, false)
        go = 0
        break
      }
      if (i === len) {
        go = 2
        break
      }
      const c = (data[at + 10 + i] ?? 0) - (name.charCodeAt(i) & 0xff)
      if (c === 0) {
        i++
        continue
      }
      go = c < 0 ? 2 : 0
      break
    }
    const link = go === 2 ? lt : gt
    if (link === 0) return null
    at = base + link
  }
}

/**
 * Routine 203 ($2d00) — fetch bank `$e0` (13), insist its name is `"Tags    "`,
 * and look the popped string up in it. Three distinct failures, in the order
 * the routine tests them: no such bank raises routine 159's error 36 ("Bank
 * not reserved"), a bank under any other name raises AMOS 23, and a name the
 * tree does not hold raises the private message 22 ("Unmatched tag").
 */
function tagValue(rt: Runtime, name: string): number {
  const b = rt.memBanks.get(rt.easylife.tagBank)
  if (!b?.data) throw new AmosError('Bank not reserved', 36)
  if (pad(b.name, 32, 8) !== 'Tags    ') funcCall()
  const v = tagFind(b.data, 0, name)
  if (v === null) elError(22)
  return v | 0
}

/**
 * Routine 239 ($33ee) — the pool. `$be` heads a chain of blocks, each
 * allocated `$ba` bytes long with an $18-byte header, and a request is served
 * by bumping the block's high-water mark; when no block has room a fresh one
 * is allocated and chained. The blocks are ext-data slots here, so the
 * addresses a program stores are real addresses in this runtime's map.
 *
 * DEVIATION: EXT_DATA_SLOT is 64K, so a `Tag Block Size` above that would
 * have a block running into its neighbour's address space. Blocks are capped
 * at the slot size; a program that asked for $40000 gets more, smaller blocks
 * than the real extension would, which is observable only by measuring the
 * gap between two stored strings.
 */
function tagAlloc(rt: Runtime, bytes: number): number {
  const st = rt.easylife
  const size = Math.min(st.tagBlockSize, Runtime.EXT_DATA_SLOT)
  for (const p of st.tagPool) {
    if (p.next + bytes <= p.block.length) {
      const at = p.base + p.next
      p.next += bytes
      return at | 0
    }
  }
  const block = new Uint8Array(size)
  const base = rt.extBlockBase(`easylife-tagpool-${st.tagPool.length}`, block)
  // the $18-byte block header the real allocator keeps out of reach
  st.tagPool.push({ base, block, next: 0x18 + bytes })
  return (base + 0x18) | 0
}

/**
 * Routine 240 ($3494) — store a string and answer the address of the text.
 *
 * The node is `(len+14)&~7` bytes (`addi.l #$e,d0 / andi.w #$fff8,d0`): a
 * four-byte chain link, the AMOS length word, the bytes, and the NUL the
 * guide promises ("Chr$(0) is automatically appended to the string when it
 * is stored, because MUI expects NULL terminated strings"), rounded up to a
 * multiple of eight. The returned address skips the link AND the length word
 * (`move.l a1,d3` then `addq.l #$2,d3`), so it points at the first character.
 *
 * An empty string is not stored at all — `tst.w (a1) / beq` answers 0, which
 * is the null pointer MUI wants for "no string".
 *
 * `explicit` is routine 190 versus 191: without a `To OBJECT` the object is
 * `$c6`, the one `Mui New` is about to create, and `Tag Keep False` clears it
 * so the string goes in the temporary buffer instead.
 *
 * The key the string is filed under is routine 240's three-way choice at
 * $34a0: an explicit OBJECT if one was given, else the pending `$c6` handle,
 * and 0 — the temporary node, emptied after every `Mui New` — when `Tag Keep`
 * is off. Routine 238 then refuses an explicit object it does not know, which
 * is message 24.
 */
function tagStore(rt: Runtime, s: string, obj: number, explicit: boolean): number {
  if (s.length === 0) return 0
  const reg = rt.easylife.mui
  const key = explicit ? obj : rt.easylife.tagKeep === 0 ? 0 : reg.pending
  const node = muiFind(reg, key)
  if (!node) elError(24)
  const at = tagAlloc(rt, (s.length + 14) & ~7)
  node.strings.push(at)
  writeBytes(rt, at, s)
  const m = rt.resolveWrite(at + s.length)
  if (m) m.data[m.off] = 0
  rt.easylife.tagStrings.set(at, s)
  return at
}

/**
 * Routines 246 to 254 ($3634) — `Tag List$(NAME$ [,A1..A8])`, a taglist
 * template expanded out of bank 14.
 *
 * The bank is a longword bias then the same tree routine 204 walks, so a
 * node's value is an offset from `bank+4` once the bias is added:
 *
 *     addq.l #$4,a0 / Rbsr routine 204 / add.l -$4(a2),d0 / adda.l d0,a2
 *
 * A template is five longwords of header then the body:
 *
 *     +$0  the body length in bytes
 *     +$4  the head of the pointer-patch chain
 *     +$8  the head of the argument-patch chain
 *     +$c  the head of the bank-number chain
 *     +$10 the declared argument count IN BYTES, which must equal the arity
 *          called times four. Routine 245 opens with `asl.l #$2,d4 /
 *          adda.l d4,a3` to step the parameter stack over the arguments and
 *          never restores d4, so the `cmp.l (a2)+,d4` at $36a0 is against the
 *          SHIFTED count. The template's own argument chain is the check on
 *          that reading: MAKE_Menuitem declares $8 and its chain names
 *          arguments 1 and 2 and no others.
 *     +$14 the body
 *
 * Each chain threads through the body itself: at the site, the high word is
 * the next site's offset (0 ends the chain) and the low word is the operand.
 * The three do different things with it:
 *
 *   pointers  the site becomes `a2 + operand`, where a2 is just past the
 *             body — so these are the strings and sub-lists appended after
 *             the template
 *   arguments the site becomes the operand'th argument, one-based, read back
 *             down the parameter stack as `-$4(a3,-N*4)`; operand 0 takes
 *             `$e8` instead, the default object, which is 0 from routine 0
 *   banks     the operand is a bank number and the site becomes its address,
 *             or error 36 if there is no such bank
 *
 * Checked against Tag_Editor.AMOS's own bank 14. MAKE_Menuitem declares $8 --
 * TWO arguments -- a 20-byte body, and an argument chain 12 -> 4: the site at
 * 12 carries $0004 next and $0002 index, the site at 4 carries $0000 and
 * $0001.
 *
 * NOTE: the copy loop moves `(bodyLen>>2)+1` longwords into a buffer asked
 * for as `bodyLen+2`, so the real extension writes up to four bytes past what
 * it allocated. Nothing observable comes of it — the string's length word
 * says bodyLen either way — so this port copies bodyLen bytes and does not
 * reproduce the overrun.
 */
function tagList(rt: Runtime, name: string, args: number[]): Value {
  const st = rt.easylife
  const b = rt.memBanks.get(st.tagListBank)
  if (!b?.data) throw new AmosError('Bank not reserved', 36)
  if (pad(b.name, 32, 8) !== 'TagLists') funcCall()
  const d = b.data
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const found = tagFind(d, 4, name)
  if (found === null) elError(22)
  const at = 4 + ((found + v.getUint32(0, false)) | 0)
  const len = v.getUint32(at, false)
  const chains = [v.getUint32(at + 4, false), v.getUint32(at + 8, false), v.getUint32(at + 12, false)]
  if (v.getUint32(at + 16, false) !== args.length * 4) funcCall()
  /*
   * A COPY, and it has to be one the caller cannot alias: `patch` writes the
   * expanded template in place, and writing into bank 14 would corrupt the
   * template for every later call. `new Uint8Array(subarray)` copies whatever
   * the argument is; `.slice()` does not, when the bank came from a Node
   * Buffer -- see the note on `parseAmosFile`.
   */
  const body = new Uint8Array(d.subarray(at + 20, at + 20 + len))
  const bv = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const past = rt.bankBase(st.tagListBank) + at + 20 + len
  const patch = (head: number, value: (operand: number) => number): void => {
    for (let o = head & 0xffff; o !== 0; ) {
      const next = bv.getUint16(o, false)
      bv.setUint32(o, value(bv.getUint16(o + 2, false)) >>> 0, false)
      o = next
    }
  }
  patch(chains[0]!, (op) => past + op)
  patch(chains[1]!, (op) => (op === 0 ? 0 : (args[op - 1] ?? 0)))
  patch(chains[2]!, (op) => {
    if (!rt.memBanks.get(op)) throw new AmosError('Bank not reserved', 36)
    return rt.bankBase(op)
  })
  return VS(String.fromCharCode(...body))
}

/** the twelve- and eight-byte strings the Tag$ family builds, big-endian */
const tagLongs = (vals: number[]): Value =>
  VS(vals.map((v) => String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)).join(''))

/** and the way back: an AMOS string read as a run of big-endian longwords */
const longsOf = (s: string): number[] => {
  const out: number[] = []
  for (let i = 0; i + 4 <= s.length; i += 4) {
    out.push(
      (((s.charCodeAt(i) & 0xff) << 24) |
        ((s.charCodeAt(i + 1) & 0xff) << 16) |
        ((s.charCodeAt(i + 2) & 0xff) << 8) |
        (s.charCodeAt(i + 3) & 0xff)) >>>
        0,
    )
  }
  return out
}

// ---- MUI (routines 205-243) ------------------------------------------------

/**
 * Routine 231 ($3192) — an AMOS number to the object it names.
 *
 * Three refusals, in the routine's order: zero is never an object; a NEGATIVE
 * handle at or above the `Mui Begin` counter is one of the pending keys and
 * not a real object yet; and anything routine 238 cannot find is message 24.
 *
 * A positive key goes straight to 238, which is where an address MUI never
 * handed out is caught.
 */
function muiObj(rt: Runtime, key: number): { obj: BoopsiObject; node: MuiNode } {
  const reg = rt.easylife.mui
  if (key === 0) elError(24)
  if (key < 0 && key >= reg.pending) elError(24)
  const node = muiFind(reg, key)
  if (!node) elError(24)
  const obj = rt.boopsi.objectAt(key)
  if (!obj) elError(24)
  return { obj, node }
}

/** free a node's subtree, and drop the strings it owned out of the pool record */
function muiFlushNode(rt: Runtime, key: number): void {
  for (const at of muiFree(rt.easylife.mui, key)) rt.easylife.tagStrings.delete(at)
}

/**
 * Routines 219 and 220 ($2fa0, $2fc0) — create an object and adopt it.
 *
 * The library call, then routine 241 on the temporary node (which is what
 * throws away the strings `Tag Keep False` stored), then routine 232, which
 * gives the object the pending node and its strings.
 *
 * Message 25 when there was no `Mui Begin`: routine 232's `tst.l d6 / beq`.
 * The guide spends a whole section on why that error can surface a long way
 * from the missing instruction, because the counter is global rather than
 * per-procedure.
 */
function muiCreate(rt: Runtime, cls: string, tags: string): number {
  // muimaster needs to read a label to measure it, and cannot resolve an
  // address itself -- see `MuiMaster.readString`
  rt.mui.readString = (at) => muiStrAt(rt, at)
  const made = rt.mui.newObjectA(cls, muiTags(rt, tags))
  muiFlushNode(rt, 0)
  if (!made) return 0
  const keep = muiAdopt(rt.easylife.mui, made.address)
  if (keep === null) elError(25)
  rt.easylife.tagKeep = keep
  return made.address
}

/**
 * A `TAGLIST$` as MUI's taglist.
 *
 * The string is longword pairs — `Tag$` and `Tag Str$` built it that way —
 * and TAG_DONE ends it. EasyLife hands MUI the string body directly, so the
 * pairing is the program's responsibility and an odd trailing longword is
 * simply ignored, which is what MUI's own tag walker does with it.
 */
function muiTags(_rt: Runtime, s: string): Array<{ tag: number; data: number }> {
  const l = longsOf(s)
  const out: Array<{ tag: number; data: number }> = []
  for (let i = 0; i + 1 < l.length; i += 2) {
    if (l[i] === 0) break
    out.push({ tag: l[i]!, data: l[i + 1]! })
  }
  return out
}

/**
 * The `,TAG$` and `To TAG` forms every setter and getter takes.
 *
 * Routine 234's shape: the comma form resolves the name through bank 13
 * (routine 203) and the `To` form is the number already. The guide's own
 * reason for having both is `Tag`: "You may use the Tag function for MUIV
 * values".
 */
function muiTagArg(rt: Runtime, it: Interp): number {
  if (it.accept('to')) return it.evalInt() | 0
  it.expect(',')
  const v = it.evalExpr()
  return v.k === 'str' ? tagValue(rt, str(v)) : int(v) | 0
}

/** routines 207-210 — GetAttr, for both the comma and the `To` forms */
function muiGet(rt: Runtime, a: Value[]): number | null {
  const obj = muiObj(rt, int(a[0] ?? VI(0))).obj
  const t = a[1] ?? VI(0)
  return rt.mui.get(obj, t.k === 'str' ? tagValue(rt, str(t)) : int(t) | 0)
}

/**
 * A `STRPTR` answer read back as an AMOS string.
 *
 * Two places a MUI string can live, and both are real addresses in this
 * runtime's map. `Tag Str` put most of them in the tag pool and the pool
 * keeps its own record, which is exact. The rest were appended after a
 * `Tag List$` template in bank 14 and reached by the template's pointer
 * chain, so they are only readable by walking the address space to the NUL —
 * which is what routine 210's `Rbsr routine 68` does to whatever GetAttr
 * answered, without caring where it came from.
 *
 * An address that resolves to nothing answers empty, as routine 210 does
 * with a NULL.
 */
function muiStrAt(rt: Runtime, at: number): string {
  if (at === 0) return ''
  const pooled = rt.easylife.tagStrings.get(at)
  if (pooled !== undefined) return pooled
  let out = ''
  for (let i = 0; i < 4096; i++) {
    const m = rt.resolveAddr(at + i)
    if (!m) break
    const c = m.data[m.off]
    if (c === undefined || c === 0) break
    out += String.fromCharCode(c)
  }
  return out
}

/** routine 242 ($3582) — unlink one pooled string from an object's chain */
function muiDropString(rt: Runtime, key: number, at: number): void {
  const n = rt.easylife.mui.nodes.get(key)
  if (n) {
    const i = n.strings.indexOf(at)
    if (i >= 0) n.strings.splice(i, 1)
  }
  rt.easylife.tagStrings.delete(at)
}

/** routines 223 and 224 — MUI_MakeObjectA, registered with `d4 = $ff` */
function muiMake(rt: Runtime, type: number, param: string | number): number {
  const p = typeof param === 'string' ? tagStore(rt, param, 0, false) : param
  const made = rt.mui.makeObjectA(type, [p])
  if (!made) return 0
  muiFind(rt.easylife.mui, made.address, true)
  return made.address
}

/** routine 213 — the taglist string dispatched as a method, then the flush */
function muiDoMethod(rt: Runtime, obj: BoopsiObject, tags: string): number {
  const l = longsOf(tags)
  const r = rt.mui.doMui(obj, l[0] ?? 0, l.slice(1))
  muiFlushNode(rt, 0)
  return r
}

/**
 * Routine 228 ($312a) — a `struct Hook` in the tag pool.
 *
 * Twenty-four bytes, of which `h_Entry` at `$8` is the extension's own
 * trampoline (`$d0` of the companion struct), `h_SubEntry` at `$c` is the
 * program's ADDRESS and `h_Data` at `$10` is its DATA. Only the address is
 * observable from AMOS, so the fields are written into the pool where a
 * program that Peeks at them finds what it put there.
 */
function muiHook(rt: Runtime, addr: number, data: number): number {
  const at = tagAlloc(rt, 0x18)
  const put = (off: number, v: number): void => {
    const m = rt.resolveWrite(at + off)
    if (!m) return
    m.data[m.off] = (v >>> 24) & 0xff
    m.data[m.off + 1] = (v >>> 16) & 0xff
    m.data[m.off + 2] = (v >>> 8) & 0xff
    m.data[m.off + 3] = v & 0xff
  }
  put(0xc, addr)
  put(0x10, data)
  return at
}

// ---- structured variables --------------------------------------------------

/**
 * Routine 299 ($3aca) — the fork every `St ...` keyword ends on.
 *
 *     tst.l d0 / bmi.b .own / Rjmp L_Error       non-negative: AMOS's number
 *     .own: neg.l d0 / Rbra routine 300          negative: EasyLife's, negated
 *
 * `elstruct.ts` throws that d0 verbatim, so this is the whole translation and
 * it lives in exactly one place, as it does in the 68k.
 */
function stCall<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (!(e instanceof ElstError)) throw e
    if (e.d0 < 0) elError(-e.d0)
    throw new AmosError(AMOS_ERRORS[e.d0] ?? `AMOS error ${e.d0}`, e.d0)
  }
}

/**
 * Routine 260 ($375e), the shared body under `St Get` and `Stv`, and routine
 * 289 ($3a56) under `St Cmp`.
 *
 * Both take the subscripts as a run of longwords on AMOS's parameter stack
 * and a count in d3 that the four arity trampolines set to 0, 4, 8 or 12
 * BYTES — routines 273-276 for the integer form, 277-280 for the string form,
 * 290-293 for the comparison. `lsr.l #$2,d3` turns it back into a count.
 *
 * They arrive REVERSED, because a3 is read upwards from the last thing pushed;
 * `resolve` documents why that makes the pairing with the descriptor's
 * dimension words right by construction.
 */
const stIdx = (a: readonly Value[], from: number, to: number): number[] =>
  a.slice(from, to).map((v) => int(v) | 0).reverse()

/** the resolver behind every element access, with the two arguments in AMOS order */
const stResolve = (rt: Runtime, a: readonly Value[], idx: number[]): Resolved =>
  resolve(rt, int(a[1] ?? VI(0)) | 0, int(a[0] ?? VI(0)) | 0, idx)

/**
 * `St Set` and `St Set Str`'s four arities, routines 282/284/286/288
 * ($39aa, $39d6, $3a02, $3a2e).
 *
 * Each is the same forty bytes with a different d3: the value is popped
 * first, the element and instance are read at fixed displacements above the
 * subscripts, and the stack is stepped past all of them at the end.
 */
function stSet(rt: Runtime, it: Interp, string: boolean): void {
  const inst = it.evalInt() | 0
  it.expect(',')
  const elem = it.evalInt() | 0
  const idx: number[] = []
  while (it.accept(',')) idx.push(it.evalInt() | 0)
  it.expect('to')
  const value = string ? it.evalStr() : it.evalInt()
  stCall(() => {
    const r = resolve(rt, elem, inst, idx.slice().reverse())
    if (string) setString(rt, r, value as string)
    else setElement(rt, r, (value as number) | 0)
  })
}

// ---- multi-zones -----------------------------------------------------------

/**
 * Routine 81 ($1c38) — reach the multi-zone table of the current screen.
 *
 *     move.l $52c(a5),d5 / Rbeq routine 2        no screen open is error 47
 *     movea.l d5,a0 / move.l $d2(a0),d5 / beq .no
 *     movea.l d5,a1 / move.w $d6(a0),d7 / asl.l #$3,d7
 *     move.l -$4(a1,d7.w),d5 / cmp.l #$fefd,d5 / bne .no
 *     move.w -$8(a1,d7.w),d6                    n, out of the trailer
 *     ... a2 = a1 + n*8, d5 = n*4
 *  .no: moveq #$c,d0 / Rbra routine 300          "No Multi Zones Reserved"
 *
 * The magic longword in the LAST record is the whole test, which is why
 * anything that reallocates EcAZones takes the multi-zones with it — see
 * Screen.reserveZones.
 */
function multiZones(rt: Runtime): { s: Screen; m: MultiZoneTable } {
  const s = rt.screen
  const m = s.multiZones
  if (!m) elError(12)
  return { s, m }
}

/**
 * Routine 82 ($1c76) — the linear search every multi-zone keyword starts
 * with, from slot `from`.
 *
 *     cmp.l d5,d2 / bcc .none      past n*4 bytes of index and it is done
 *     move.w (a2,d2.w),d4 / cmp.w d0,d4 / bne .next        the GROUP
 *     move.w $2(a2,d2.w),d4 / beq .next                    id 0 = free slot
 *     tst.w d1 / beq .hit          a zero ID argument matches ANY
 *     cmp.w d1,d4 / beq .hit
 *  .none: moveq #$ff,d2           and note that is -1, not $ffff
 */
function findSlot(m: MultiZoneTable, group: number, id: number, from = 0): number {
  for (let i = from; i < m.slots.length; i++) {
    const sl = m.slots[i]!
    if (sl.group !== group) continue
    if (sl.id === 0) continue
    if (id === 0 || sl.id === id) return i
  }
  return -1
}

/**
 * Routine 83 ($1c9e) — take the head off the free list.
 *
 *     move.w -$6(a1,d7.w),d0            the head, in the trailer
 *     cmp.w #$ffff,d0 / beq -> message 10, "Multi Zone Table Full"
 *     move.w (a2,d0.w),d1               the free entry's own link
 *     move.w d1,-$6(a1,d7.w)
 */
function allocSlot(m: MultiZoneTable): number {
  if (m.free < 0) elError(10)
  const i = m.free
  m.free = m.slots[i]!.next
  return i
}

/**
 * Routine 84 ($1cb8) — push a slot back, LIFO.
 *
 *     move.w -$6(a1,d7.w),d1 / move.w d1,(a2,d0)      link to the old head
 *     move.w #$0,$2(a2,d0)                            id 0 marks it free
 *     move.w d0,-$6(a1,d7.w)                          and it becomes the head
 *
 * The RECTANGLE is left alone, so a freed zone's coordinates survive in the
 * screen's zone table — `Elmzonen` steps over it on the id test, not on the
 * geometry, and AMOS's own `Zone()` has no id test to make.
 */
/**
 * Routine 80 ($1bd6)'s body, split out because routine 103 calls it with a
 * total it worked out rather than with a popped argument.
 */
function mzReserve(rt: Runtime, n: number): void {
  if (n <= 0) funcCall() // DEVIATION: see `elmz reserve`
  const count = (n + 1) & ~1
  const total = (count * 3) / 2 + 1
  if (u32(total) >= 0x2000) funcCall()
  const s = rt.screen
  s.reserveZones(0)
  if (total * 8 > rt.fastFree()) throw new AmosError('Out of memory', ERR.OUT_OF_MEMORY)
  s.reserveZones(total)
  s.multiZones = {
    slots: Array.from({ length: count }, (_, i) => ({ group: 0, id: 0, next: i === count - 1 ? -1 : i + 1 })),
    free: 0,
  }
}

/**
 * Routine 85 ($1ccc)'s six-argument body, split out for the same reason:
 * routine 102 pushes GROUP, an ID it counts itself and four coordinates and
 * `Rbsr`s straight into it, once per zone in the bank.
 */
function mzSet(rt: Runtime, group: number, id: number, x1: number, y1: number, x2: number, y2: number): void {
  // routine 85 is the other way round from routine 86: `move.l $40(a3),d0 /
  // Rbeq routine 3` reads the GROUP first, and both come after routine 81
  const { s, m } = multiZones(rt)
  if (group === 0) funcCall()
  if (id === 0) funcCall()
  let i = findSlot(m, w(group), w(id))
  if (i < 0) {
    i = allocSlot(m)
    m.slots[i] = { group: w(group), id: w(id), next: 0 }
  }
  const lo = (a: number, b: number): number => (u32(a) <= u32(b) ? a : b)
  const hi = (a: number, b: number): number => (u32(a) <= u32(b) ? b : a)
  s.zones[i] = { x1: w(lo(x1, x2)), y1: w(lo(y1, y2)), x2: w(hi(x1, x2)), y2: w(hi(y1, y2)) }
}

function freeSlot(m: MultiZoneTable, i: number): void {
  const sl = m.slots[i]!
  sl.next = m.free
  sl.id = 0
  m.free = i
}

export function makeEasyLifeFunctions(rt: Runtime): Record<string, Func> {
  const st = (): EasyLifeState => rt.easylife
  const corner =
    (k: 'x1' | 'y1' | 'x2' | 'y2'): Func =>
    (_, a): Value =>
      elCoord(elZone(elScreen(rt, a, 2), int(a[a.length - 1]!)), k)

  return {
    /**
     * =Elznsx(ZONE) / =Elznsx(SCREEN,ZONE) — routines 7 ($13ce) and 8 ($13da).
     * Four words a zone at EcAZones + (n-1)*8, and these read the first of
     * them: `Rbsr routine 4 / move.w -$8(a1,d5.w),d3 / moveq #$0,d2 / rts`.
     *
     * The whole point of the extension's name: `Set Zone` writes the corners
     * and AMOS gives a program no way to read them back.
     */
    elznsx: corner('x1'),
    /** =Elznsy — routines 9 ($13e6) and 10, `-$6(a1,d5.w)` */
    elznsy: corner('y1'),
    /** =Elznex — routines 11 ($13fe) and 12, `-$4(a1,d5.w)` */
    elznex: corner('x2'),
    /** =Elzney — routines 13 ($1416) and 14, `-$2(a1,d5.w)` */
    elzney: corner('y2'),

    /**
     * =El Overlap(x1,y1,x2,y2 To x3,y3,x4,y4) — routine 153 ($26e0).
     *
     * Computes the intersection rectangle into the companion library's
     * struct and answers -1 when it is non-empty. The four corners are
     * stored, not returned, which is what `El Lapsx` and its three siblings
     * are for.
     *
     * Every comparison is UNSIGNED (`bcc`/`bcs` on `cmp.l`), so a negative
     * coordinate is a very large one and the min/max come out the other way
     * round. That is the routine's own arithmetic and it is kept; nothing in
     * the guide says the arguments may be negative.
     *
     * The emptiness test is `lapex >= lapsx` and `lapey >= lapsy`, both
     * inclusive, so two rectangles that share a single edge pixel overlap.
     */
    'el overlap'(_, a): Value {
      const p = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => int(a[i] ?? VI(0)))
      const maxU = (x: number, y: number): number => (u32(x) >= u32(y) ? x : y)
      const minU = (x: number, y: number): number => (u32(x) <= u32(y) ? x : y)
      const s = st()
      s.lapsx = maxU(p[0]!, p[4]!)
      s.lapsy = maxU(p[1]!, p[5]!)
      s.lapex = minU(p[2]!, p[6]!)
      s.lapey = minU(p[3]!, p[7]!)
      return VI(u32(s.lapex) >= u32(s.lapsx) && u32(s.lapey) >= u32(s.lapsy) ? -1 : 0)
    },
    /** =El Lapsx — routine 154 ($2758), `movea.l $1e8(a5),a0 / move.l $a2(a0),d3` */
    'el lapsx': (): Value => VI(st().lapsx),
    /** =El Lapsy — routine 155 ($2764), $a6 */
    'el lapsy': (): Value => VI(st().lapsy),
    /** =El Lapex — routine 156 ($2770), $aa */
    'el lapex': (): Value => VI(st().lapex),
    /** =El Lapey — routine 157 ($277c), $ae */
    'el lapey': (): Value => VI(st().lapey),

    /**
     * =Elmznsx(GROUP,ID) — routines 88-91 ($1d94-$1dbe) over the shared
     * prologue at routine 87 ($1d6c), which pops ID then GROUP, refuses
     * either as zero with AMOS 23, and raises message 11, "Multi Zone Not
     * Defined", when the pair is not in the index.
     *
     * Each reader is `Rbsr routine 87 / move.w $N(a1,d2.w),d3 / ext.l d3`,
     * so unlike the AMOS-zone readers these are SIGNED — the guide says so
     * and here it is right: "The values returned are signed (-32768 to
     * 32767)".
     */
    elmznsx: mzCorner(rt, 'x1'),
    /** =Elmznsy — routine 89 ($1da2), `$2(a1,d2.w)` */
    elmznsy: mzCorner(rt, 'y1'),
    /** =Elmznex — routine 90 ($1db0), `$4(a1,d2.w)` */
    elmznex: mzCorner(rt, 'x2'),
    /**
     * =Elmzney — routine 91 ($1dbe), and the odd one out.
     *
     * DEFECT: its two instructions are in the wrong order.
     *
     *     routine 90:  move.w $4(a1,d2.w),d3 / ext.l d3
     *     routine 91:  ext.l d3 / move.w $6(a1,d2.w),d3
     *
     * so the sign-extension runs on the d3 routine 87 has just cleared and
     * the load lands afterwards, leaving the high word zero. `Elmzney`
     * therefore answers 0..65535 where its three siblings answer -32768..32767
     * — a zone whose y2 is negative reads back as 65536 plus it. The guide's
     * "The values returned are signed" covers all four and is right about
     * three. Reproduced.
     */
    elmzney: (_, a): Value => VI(w(mzZone(rt, a)?.y2 ?? 0)),

    /**
     * =Elmzone(X,Y) / =Elmzone(X,Y,GROUP) — routines 95 ($1e08) and 94.
     *
     * Stores the query in the companion library's struct ($6e/$70/$74),
     * resets the scan cursor at $72 and falls straight into `Elmzonen`. The
     * two-argument form is routine 94, six bytes that push a literal zero for
     * the group and branch in — so "no filter" and "group 0" are the same
     * thing, which is why group 0 cannot be a real group.
     *
     * The coordinates are stored with `move.w`, so they truncate to sixteen
     * bits, and the scan compares them SIGNED.
     */
    elmzone: mzone(rt),

    /**
     * =Elmzonen — routine 96 ($1e28), which is both the keyword and the tail
     * of `Elmzone`.
     *
     * Walks the rectangles from the cursor, taking the FIRST that contains
     * the point, and the four tests are `x1 > x`, `y1 > y`, `x2 < x`, `y2 < y`
     * as signed words — so the far corner is inclusive, unlike `Set Zone`'s.
     * The cursor is advanced past a geometric hit BEFORE the group filter and
     * the id are checked, so a rejected zone is never revisited. Out of
     * zones, it parks the cursor at the end, clears the saved group and
     * answers 0 — which is also what "no more" looks like, exactly as the
     * guide says: "All of these commands return 0 if there is no remaining
     * zone which contains the point specified."
     */
    elmzonen: (): Value => VI(mzNext(rt)),

    /**
     * =Elmzoneg — routine 93 ($1df0), `moveq #$0,d3 / move.w $76(a0),d3`.
     *
     * The group of whatever the last `Elmzone`/`Elmzonen` found, zeroed when
     * the scan came up empty. It does NOT go through routine 81, so it
     * answers even with no multi zones reserved — the only keyword in the
     * block that does not raise.
     */
    elmzoneg: (): Value => VI(w(st().mzGroup)),

    // ---- character searching, routines 18-53 and 144-146 ----
    //
    // "If you want to find the first occurance of a character in a string,
    // you can use the AMOS functinon =instr$, but as this is designed to find
    // substrings, it is in-efficient for single characters." Sixteen entry
    // points over ten workers, and the asc/char pairs differ only in whether
    // the thing being looked for arrives as a code or as a set of characters.

    /**
     * =Elf Asc(S$,A) / =Elf Asc(S$,A,P) — routines 18 and 19 into 35 ($1560).
     *
     *     cmpa.l d1,a0 / bcc .miss / cmp.b (a0)+,d0 / bne .loop
     *     dbra d5,.loop            d5 is the Nth counter, 0 here
     *     move.l a0,d3 / sub.l a1,d3
     *
     * so the answer is 1-based, and the three-argument form "begins searching
     * a position P+1" because routine 34 does `adda.l d3,a0` with P as a plain
     * index — "to find the next occurance, you simply put the position of the
     * last occurance as the P parameter of the next search".
     */
    'elf asc': elfFwd(rt, (s, from, ch) => s.indexOf(String.fromCharCode(ch), from)),
    /**
     * =Elf Char(S$,A$[,P]) — routines 26/27 into 40 ($160a), which walks A$
     * per source character instead of comparing one code.
     *
     * NOTE: the guide lists under Illegal Function Call: "Either A$ is an
     * empty string, or A is not between 0 and 255." That is half right. The empty set is NOT an
     * error here: `move.w (a2),d7` loads 0 and the `dbra d7` falls straight
     * through to the next source character, so the search simply never
     * matches and returns the miss value. Only `Elf Num Char` and `Elpad
     * Char$` actually test the length (`Rbeq routine 3`).
     */
    'elf char': elfFwdSet(rt, (set, c) => inSet(set, c)),
    /** =Elf Not Asc — routines 20/21 into 36 ($1588), `beq` where 35 has `bne` */
    'elf not asc': elfFwd(rt, (s, from, ch) => {
      for (let i = from; i < s.length; i++) if (s.charCodeAt(i) !== ch) return i
      return -1
    }),
    /** =Elf Not Char — routines 28/29 into 41 ($1640) */
    'elf not char': elfFwdSet(rt, (set, c) => !inSet(set, c)),

    /**
     * =Elf Last Asc(S$,A[,P]) — routines 22/23 into 38 ($15da).
     *
     *     cmpa.l a0,a1 / bcc .miss / cmp.b -(a0),d0 / bne .loop
     *     move.l a0,d3 / sub.l a1,d3 / addq.l #$1,d3
     *
     * The predecrement is why "the search begins at position P-1": routine 37
     * puts a0 at index P-1, so the first character examined is P-1 in 1-based
     * terms. P of 0, or past the length, starts at the end. Unlike the forward
     * searches these never consult the fail flag: a miss is always 0.
     */
    'elf last asc': elfBack(rt, (s, from, ch) => {
      for (let i = from - 1; i >= 0; i--) if (s.charCodeAt(i) === ch) return i
      return -1
    }),
    /** =Elf Last Char — routines 30/31 into 42 ($1670) */
    'elf last char': elfBackSet(rt, (set, c) => inSet(set, c)),
    /**
     * =Elf Last Not Asc — routines 24/25 into 39 ($15f2). "very useful for
     * removing the padding from padded strings, or for removing trailing
     * spaces", which is what pairs it with `Elpad Asc$`.
     */
    'elf last not asc': elfBack(rt, (s, from, ch) => {
      for (let i = from - 1; i >= 0; i--) if (s.charCodeAt(i) !== ch) return i
      return -1
    }),
    /** =Elf Last Not Char — routines 32/33 into 43 ($1696) */
    'elf last not char': elfBackSet(rt, (set, c) => !inSet(set, c)),

    /**
     * =Elf Control(S$[,P]) — routines 44 and 45 ($16ba, $16c4).
     *
     * Routine 44 is ten bytes that push a literal zero for P. The test is
     * `cmp.b #$20,d0 / bcc` and UNSIGNED, so only 0..31 count — a byte at 128
     * or above is 'not a control character', which is what makes the guide's
     * use of it work: "This can be used to determine if a string is
     * printable. A string which contains control characters may invoke any of
     * the AMOS text formatting functions ... such as At(X,Y), Pen$(C)".
     */
    'elf control'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const from = fwdStart(int(a[1] ?? VI(0)), 0)
      for (let i = from; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return VI(i + 1)
      return VI(elfMiss(rt, s.length))
    },

    /**
     * =Elf Nth Asc(S$,A,N) — routine 53 ($1790), which is routine 35 with the
     * Nth counter loaded: `move.l (a3)+,d5 / subq.l #$1,d5 / Rbmi routine 3`.
     */
    'elf nth asc'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const ch = int(a[1] ?? VI(0))
      const n = int(a[2] ?? VI(0))
      if (n - 1 < 0) funcCall()
      fwdStart(0, ch)
      return VI(nth(s, (c) => c.charCodeAt(0) === ch, n, rt))
    },
    /**
     * =Elf Nth Char(S$,A$,N) — routine 52 ($1782), the same twelve bytes into
     * routine 40 but WITHOUT the sign check: `move.l (a3)+,d5 / movea.l
     * (a3)+,a2 / moveq #$0,d0 / subq.l #$1,d5`.
     *
     * NOTE: so `Elf Nth Asc(s$,a,0)` is AMOS 23 and `Elf Nth Char(s$,a$,0)` is
     * not. N-1 becomes -1, the `dbra d5` after a match decrements the low word
     * to $fffe and branches, and the search needs 65536 matches — which is to
     * say it finds nothing and answers the miss value.
     */
    'elf nth char'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const set = str(a[1] ?? VS(''))
      const n = int(a[2] ?? VI(0))
      if (n <= 0) return VI(elfMiss(rt, s.length))
      return VI(nth(s, (c) => inSet(set, c), n, rt))
    },

    /**
     * =Elf Num Asc(S$,A) — routine 51 ($175e), a plain count with its own
     * loop rather than a call into the search workers, and no fail flag.
     * `cmp.l #$100,d0 / Rbcc routine 3` is unsigned, so a negative code is a
     * very large one and refused.
     */
    'elf num asc'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const ch = int(a[1] ?? VI(0))
      if (u32(ch) >= 0x100) funcCall()
      let n = 0
      for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === ch) n++
      return VI(n)
    },
    /**
     * =Elf Num Char(S$,A$) — routine 50 ($174c), and DEVIATION-worthy in the
     * other direction: it does not count a SET at all.
     *
     *     movea.l (a3)+,a0 / move.w (a0)+,d0 / Rbeq routine 3
     *     moveq #$0,d0 / move.b (a0),d0 / move.l d0,-(a3)
     *     Rbra routine 51
     *
     * Eighteen bytes that take the FIRST character of A$, push its code and
     * fall into `Elf Num Asc`. The guide says "occurances of any character
     * from A$ are counted" and adds a note rationalising it — "If the string
     * A$ contains more than one occurance of the same character it is still
     * only counted once" — and neither describes this routine. The empty
     * string IS an error here, which is the one thing the guide gets right
     * about it.
     */
    'elf num char'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const set = str(a[1] ?? VS(''))
      if (set.length === 0) funcCall()
      const ch = set.charCodeAt(0)
      let n = 0
      for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === ch) n++
      return VI(n)
    },

    // ---- integers as strings, memory, banks and messages ----

    /**
     * =Ellong$(NUM) — routine 46 ($16f4): `moveq #$6,d3 / Rjsr L_Demande /
     * move.w #$4,(a0)+ / move.l (a3)+,(a0)+`. Four raw bytes, most
     * significant first, "so that it may be output to a file compactly with a
     * fixed length" — the pair AMOS lacks.
     */
    'ellong$': (_, a): Value => {
      const n = int(a[0] ?? VI(0)) | 0
      return VS(String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff))
    },
    /** =Ellong(NUM$) — routine 47 ($170c), `cmp.w #$4,d0 / Rbcs routine 3` */
    ellong: (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      if (s.length < 4) funcCall()
      return VI(((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) | 0)
    },
    /**
     * =Elword$(NUM) — routine 48 ($171e), which pops the argument as two
     * words and keeps the LOW one: `move.w (a3)+,d0 / move.w (a3)+,(a0)+`.
     * "ElWord$ does not give error messages if the value is out of range, it
     * simply stores the lower 2 bytes."
     */
    'elword$': (_, a): Value => {
      const n = int(a[0] ?? VI(0))
      return VS(String.fromCharCode((n >>> 8) & 0xff, n & 0xff))
    },
    /** =Elword(NUM$) — routine 49 ($1738), `cmp.w #$2,d0 / Rbcs` then `ext.l` */
    elword: (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      if (s.length < 2) funcCall()
      return VI(sw((s.charCodeAt(0) << 8) | s.charCodeAt(1)))
    },

    /**
     * =Elwtst(BIT,ADDR) / =Elltst(BIT,ADDR) — routines 70 and 71 ($1b08,
     * $1b24), twenty-eight bytes each and identical but for the width.
     *
     * "The AMOS =Btst function allows you to detect if a bit is set in a
     * given byte of memory, or in an integer variable. EasyLife provides
     * these two functions to test if a bit is set in words/longwords." The
     * arguments really are BIT first: `movea.l (a3)+,a0` takes the LAST one
     * as the address. `cmp.l #$10,d0 / Rbcc routine 3` is unsigned, so a
     * negative bit number is refused with the too-large ones.
     */
    elwtst: (_, a): Value => VI((peekWord(rt, bitArgs(a, 16)) >>> (int(a[0] ?? VI(0)) & 15)) & 1 ? -1 : 0),
    elltst: (_, a): Value => VI((peekLong(rt, bitArgs(a, 32)) >>> (int(a[0] ?? VI(0)) & 31)) & 1 ? -1 : 0),

    /**
     * =Elpp Buf(NUM) / =Elpp Len(NUM) — routines 56 and 57 ($1842, $185e),
     * twenty-eight bytes each over the eight-slot table at $2e.
     *
     * "ElPp Buf returns the address of the start of the buffer. It is similar
     * to the start() function for banks ... If the buffer is not allocated,
     * both functions return 0", and "ElPp Buf & ElPp Len do not require the
     * powerpacker library" — neither goes near routine 62.
     *
     * NOTE: the bound is `cmp.w #$8,d0` here where `Elpp Load` and `Elpp
     * Allocate` use `cmp.l`. So a buffer number whose LOW WORD is 0..7 gets
     * through these two — 65536 reads buffer 0 — and is refused by the
     * keywords that create one. Reproduced.
     */
    'elpp buf': (_, a): Value => VI(ppSlot(rt, int(a[0] ?? VI(0)), true) === null ? 0 : ppAddr(int(a[0] ?? VI(0)))),
    'elpp len': (_, a): Value => VI(ppSlot(rt, int(a[0] ?? VI(0)), true)?.length ?? 0),

    /**
     * =Elpp Crunch(FILE$,START,LENGTH,EFFICIENCY,BUFFER) — routine 59
     * ($18b0), 260 bytes and the only keyword here that compresses.
     *
     * The three range checks come first and are unsigned: `cmp.l #$3,d0 /
     * Rbcc` on the speed-up BUFFER (0..2), `cmp.l #$5,d0 / Rbcc` on
     * EFFICIENCY (0..4), and LENGTH is `Rbeq` then `Rbmi`, so zero and
     * negative are both refused. Then ppAllocCrunchInfo, ppCrunchBuffer,
     * dos.library Open/Write/Close, and the length of the crunched file
     * comes back plus eight — the PP20 header the routine writes itself.
     *
     * "IMPORTANT: The crunched data overwrites the uncrunched data before it
     * is saved - If you need to keep the original, make a copy before
     * crunching", and if it grows the routine raises "Crunched File LONGER
     * than source - Aborted" for exactly that reason.
     *
     * DEVIATION: `src/amiga/powerpacker.ts` crunches to a fresh buffer, so
     * the source is NOT overwritten here. A program that relied on the
     * corruption would be relying on the thing the guide warns against.
     */
    'elpp crunch': (_, a): Value => {
      const file = str(a[0] ?? VS(''))
      const start = int(a[1] ?? VI(0))
      const len = int(a[2] ?? VI(0))
      const eff = int(a[3] ?? VI(0))
      const buf = int(a[4] ?? VI(0))
      if (u32(buf) >= 3) funcCall()
      if (u32(eff) >= 5) funcCall()
      if (len === 0 || len < 0) funcCall()
      const src = new Uint8Array(len)
      for (let i = 0; i < len; i++) src[i] = peekByte(rt, start + i)
      const out = pp20Crunch(src)
      // routine 59's own check, and the reason the guide tells you to wrap
      // this in On Error
      if (out.length > len) elError(8)
      if (!rt.vfs?.writeFile(file, out)) throw new AmosError('disc is write protected', 84)
      return VI(out.length)
    },

    // ---- system, AmigaDOS and fonts, routines 105-163 ----

    /**
     * =El Base(NUM) — routine 117 ($2110).
     *
     *     bmi .zero / beq .amos
     *     cmp.l #$1a,d0 / Rbcc routine 3       1..25, the extension slots
     *     subq.l #$1,d0 / asl.l #$4,d0 / addi.l #$f8,d0 / move.l (a5,d0.l),d3
     *
     * $f8 is ExtAdr and sixteen bytes is one slot (+Equ.s:1148-1155), so this
     * is the BASE pointer of extension NUM. Zero answers a5 itself, negative
     * answers 0.
     *
     * NOTE: an unoccupied slot reads back whatever is in that longword, which
     * is 0 for a slot no extension took. `El Base(0)` has no answer here —
     * a5 is AMOS's own system base and this port has no address for it — so
     * it answers 0 and is the one value of the three that is not modelled.
     */
    'el base': (_, a): Value => {
      const n = int(a[0] ?? VI(0))
      if (n < 0) return VI(0)
      if (n === 0) return VI(0) // a5, which has no modelled address
      if (u32(n) >= 26) funcCall()
      return VI(rt.extSlotImpls().has(n) ? (Runtime.EXT_DATA_BASE + (n - 1) * Runtime.EXT_DATA_SLOT) | 0 : 0)
    },

    /**
     * =ElPro — routine 148 ($26aa), and it is SIX BYTES: `moveq #$ff,d3 /
     * moveq #$0,d2 / rts`. Unconditionally true.
     *
     * "=ElPro returns true when your program is being run from AMOS Pro, or
     * if it was compiled from the AMOS Pro compiler. It returns False if it
     * was run from AMOS Creator." So it is a BUILD-TIME constant, not a
     * runtime test — this is the AMOS Pro build of the library, and an AMOS
     * Creator build of it would carry `moveq #$0,d3`. Nothing here can make
     * it false, and nothing on the machine could either.
     */
    elpro: (): Value => VI(-1),
    /**
     * =ElCompiled — routine 149 ($26b0), and DEFECT: it answers -1 under the
     * interpreter, which is the opposite of what it is for.
     *
     *     41 fa 00 d6   lea $2788(pc),a0
     *     74 00 76 00   moveq #$0,d2 / moveq #$0,d3
     *     0c 90 43706c44  cmpi.l #"CplD",(a0)
     *     67 02         beq .out            equal -> 0, "not compiled"
     *     76 ff         moveq #$ff,d3       differ -> -1, "compiled"
     *
     * $26b2 + $d6 is $2788, and $2788 holds `20 1b 76 00` — the first
     * instruction of routine 158, `Elbnk Here`. It is not "CplD" and nothing
     * in the library ever writes it, so the compare can only fail and the
     * answer can only be -1. The guide says "=ElCompiled returns true if
     * your program is running as a stand-alone program, and false when it is
     * being run under AMOS", so under AMOS it is wrong every time.
     *
     * Whatever marker was meant to live at that address, it is not there in
     * this build. Reproduced, because the bytes are unambiguous.
     */
    elcompiled: (): Value => VI(-1),

    /**
     * =Elexists(FILENAME$) — routines 105 ($1f9c) and 106 ($1fb8).
     *
     * Routine 106 is Lock/Examine/UnLock over a 264-byte FileInfoBlock, and
     * 105 returns `$4(a1)`, fib_DirEntryType. "If it returns 0, the file did
     * not exist. If it returns a negative number, the file did exist. If it
     * returns a positive number, then this is the name of an existing
     * directory, not a file." A failed Lock is d0 = $51 (error 81) rather
     * than 0 — but 105 tests d0 and answers 0, so only Examine failing
     * (error 23) escapes as an error.
     */
    elexists: (_, a): Value => {
      const what = rt.vfs?.exists(str(a[0] ?? VS('')))
      return VI(what === 'dir' ? 2 : what === 'file' ? -3 : 0)
    },
    /**
     * =ElProtect(FILENAME$) — routine 109 ($206a), routine 106 again and
     * then `$74(a1)`, fib_Protection. Unlike Elexists a failed Lock IS
     * raised here (`Rjmp L_Error` on d0).
     *
     * "For the lower 4 bits, a value of 0 means on, and 1 off, but for the
     * upper 4 bits, 0 is off, and 1 is not. This means that the default
     * flags '----rwed' have a value of 0" — which is AmigaDOS's own
     * inversion, and what src/amiga/vfs.ts stores.
     */
    elprotect: (_, a): Value => {
      const path = str(a[0] ?? VS(''))
      if (!rt.vfs || rt.vfs.exists(path) === null) throw new AmosError('file not found: ' + path)
      return VI(rt.vfs.meta(path).protection)
    },

    /**
     * =Elexec(FILENAME$) — routine 143 ($25a6): `movem.l d0-d7/a0-a7,-(a7)`
     * around a plain dos.library Execute (-$de) with both the input and
     * output handles zero, then routine 114 turns the result into a boolean.
     *
     * NOTE: saving a7 in a movem and restoring it from that same movem is
     * what the routine does; it is a no-op, not a stack switch.
     */
    elexec: (_, a): Value =>
      VI(execute(rt.host.process, { command: str(a[0] ?? VS('')), io: { input: null, output: null } }) ? -1 : 0),

    /**
     * =Elout Exists / =Elin Exists — routines 121 ($218e) and 127 ($2344),
     * sixteen bytes each: the handles routine 0 stored at $94 and $90 from
     * `Output()` and `Input()`, as a boolean.
     *
     * NOTE: this port has no CLI attached, so both handles are zero — which
     * is exactly what they are on the machine when AMOS was started from
     * Workbench. `absent` rather than `impossible`, in src/amiga/host.ts's
     * vocabulary: a host could supply them, and none does.
     */
    'elout exists': (): Value => VI(0),
    'elin exists': (): Value => VI(0),
    /**
     * =Elin$(LEN) / =Elin Get$ — routines 129 ($2392) and 128 ($2354) over
     * the shared reader at 130 ($23b8). `Elin Get$` is FGets with a
     * ten-byte limit and `Elin$` a Read of LEN bytes, LEN bounded by
     * `cmp.l #$10000,d3 / Rbcc routine 3`; both raise the extension's own
     * "No STDIN file handle exists" first if $90 is zero, which here it
     * always is.
     */
    'elin$': (): Value => elError(17),
    'elin get$': (): Value => elError(17),

    /**
     * =Elopen Font(NAME$,SIZE) — routine 160 ($27a4), 220 bytes: fill the
     * TextAttr at $80, try graphics.library OpenFont first (`jsr -$48(a6)`),
     * and only on a miss open diskfont.library (message 14 if that fails)
     * and OpenDiskFont (message 15 if THAT fails). Then walk the chain at
     * $7c looking for a node already holding this TextFont — "If you open
     * the same font twice, you are returned the original pointer the second
     * time, and the font is only actually opened once. Therefore you should
     * only close it once."
     *
     * "You do not need to use any of the AMOS 'Get Fonts' commands - Elopen
     * Font is a replacement for these", which is the point of the block: the
     * core's `Set Font` needs `Get Fonts` first and answers error 37 without
     * it.
     */
    'elopen font': (_, a): Value => {
      const name = str(a[0] ?? VS(''))
      const size = int(a[1] ?? VI(0))
      const st = rt.easylife
      const key = `${name.toLowerCase()}/${size}`
      for (const id of st.fontOrder) if (fontKey(st.fonts.get(id)!) === key) return VI(id)
      const f = openDiskFont((p) => rt.vfs?.read(p) ?? null, name, size)
      if (!f) elError(15) // 'Unable to lock font'
      const id = (Runtime.EXT_DATA_BASE + 25 * Runtime.EXT_DATA_SLOT + st.fontOrder.length * 16) | 0
      st.fonts.set(id, f)
      st.fontOrder.push(id)
      return VI(id)
    },

    /**
     * =Elwb Open / =Elwb Close / =Elwb Test — routines 118, 119 and 120
     * ($213a, $214e, $217a), twenty to forty-four bytes each on
     * intuition.library (`-$18a6(a5)`): OpenWorkBench (-$d2), WBenchToFront
     * (-$156) and CloseWorkBench (-$4e).
     *
     * "AMOS provides a close workbench command, but it does not tell you
     * whether the workbench did actually close or not." Close is
     * WBenchToFront first and CloseWorkBench only if that says a screen is
     * there, else `moveq #$ff,d0` — which is why "Elwb close returns true if
     * the workbench is closed when the function has finished executing, even
     * if it didn't close it because it was already closed".
     *
     * All three end at routine 114 ($20c0), which is six instructions —
     * `moveq #$0,d2 / moveq #$0,d3 / tst.l d0 / beq / moveq #-$1,d3` — so
     * whatever the library returned becomes an AMOS boolean.
     *
     * These answered the ABSENT case until there was an Intuition: a screen
     * that could not be opened, a WBenchToFront that found nothing, and a
     * Close that therefore took its already-closed arm. They are on the real
     * one now (`src/amiga/intuition.ts`), including the documented side
     * effect — "Elwb Close and Elwb Test have the side effect of bringing the
     * workbench screen to the front" — which is not a side effect at all but
     * the WBenchToFront both of them open with.
     */
    /**
     * =Eliconify Begin(X, Y, TITLE$) / =Eliconify Test — see the two
     * functions above, which are where the routines are read.
     */
    'eliconify begin': (_, a): Value => VI(elIconifyBegin(rt, int(a[0]!), int(a[1]!), str(a[2]!))),
    'eliconify test': (): Value => VI(elIconifyTest(rt)),

    /**
     * =Eliconify Amos(X, Y, TITLE$) — routine 123 ($21d4), TWENTY-SIX bytes,
     * and every one of them is the other three:
     *
     *     Rbsr routine 124            Eliconify Begin
     *     tst.l d3 / bne              1 or 2 -> that code, and no window
     *  L: Rbsr routine 125            Eliconify Test
     *     tst.l d3 / beq L            0 -> keep looking
     *     bmi                         -1 -> keep it
     *     moveq #$0,d3                1 -> becomes 0
     *     Rbsr routine 126            Eliconify End
     *
     * DEVIATION: the loop is AMOS's frame loop rather than a `bra`. The 68k
     * routine spins on GetMsg with the program suspended — "ElIconify AMOS
     * suspends your AMOS program until the user de-iconifies it" — and there
     * is nothing to spin on here until the frame that delivers the click has
     * run. The block is what makes a frame go by; the polling, the message
     * order and the answer are the routine's.
     *
     * NOTE: the guide's table for THIS keyword has -1 and 0 swapped. It says
     * "-1 = The close window gadget was pressed. 0 = Then right mouse button
     * was pressed", and the code says the opposite: `Eliconify Test` answers
     * 1 for the close gadget and routine 123 turns that 1 into 0, while its
     * -1 for the right button passes straight through. The guide's table for
     * `Eliconify Test` two paragraphs later is correct and contradicts it.
     * The binary wins.
     */
    'eliconify amos'(it, a): Value {
      const st = rt.easylife
      if (st.iconAmos) {
        const r = elIconifyTest(rt)
        if (r === 0) {
          it.block({ type: 'iconify' }, true)
          return VI(0) // unreachable: block(..., true) throws
        }
        st.iconAmos = false
        elIconifyEnd(rt)
        return VI(r < 0 ? -1 : 0)
      }
      const code = elIconifyBegin(rt, int(a[0]!), int(a[1]!), str(a[2]!))
      if (code !== 0) return VI(code)
      st.iconAmos = true
      it.block({ type: 'iconify' }, true)
      return VI(0)
    },

    'elwb open': (): Value => VI(rt.intuition.openWorkBench() !== 0 ? -1 : 0),
    'elwb test': (): Value => VI(rt.intuition.wBenchToFront() ? -1 : 0),
    'elwb close': (): Value => {
      if (!rt.intuition.wBenchToFront()) return VI(-1)
      return VI(rt.intuition.closeWorkBench() ? -1 : 0)
    },

    /**
     * =Elxpk Error — routine 177 ($2a74), twelve bytes: the longword at $b6
     * of the companion struct, which every XPK keyword stores its
     * XpkUnpack/XpkPack result in. "When an error occurs with any of the XPK
     * functions ... the error message 'An XPK Error Has Occured' is
     * displayed. When this happens, you should call Elxpk Error to return
     * the error number", and 0 is "No error has occured".
     *
     * The five keywords that write $b6 all go through
     * `src/amiga/xpkmaster.ts`, and its `XpkError` codes ARE this number:
     * -5 check sum failure, -13 password required, -15 required library
     * missing, and so on down the guide's own table.
     */
    'elxpk error': (): Value => VI(rt.easylife.xpkError),

    /**
     * =Elxpk Lof(FILENAME$) — routine 185 ($2b66).
     *
     *     Rbsr routine 1              NUL-terminate the filename
     *     moveq #$5e,d3 / L_Demande   ninety-four bytes: an XpkFib
     *     lea $2ba4(pc),a1            [XPK_InName][TAG_DONE]
     *     move.l (a3)+,d0 / addq.l #$2,d0 / move.l d0,$4(a1)
     *     moveq #$dc,d7 / Rbsr routine 186     XpkExamineTags, LVO -36
     *     move.l d0,$b6(a1) / bne -> message 20
     *     move.l $4(a0),d3            the fib's unpacked length
     *
     * "This function will return the length of the file FILENAME$, just like
     * the normal AMOS Lof function ... However, if the file has been
     * compresed with XPK, or Powerpacker the length of the file once it has
     * been uncompressed is returned", and "Elxpk Lof does not actually need
     * to decrunch the file to find its length" — the master reads the
     * 36-byte header for XPK and the 24-bit trailer for PP20, and neither
     * touches the body.
     */
    'elxpk lof': (_, a): Value => {
      const file = str(a[0] ?? VS(''))
      const data = xpkRead(rt, file)
      return VI(xpkGuard(rt, () => xpkExamine(data).uLen))
    },

    /** =Elextb(N) — routine 78 ($1bc4), `ext.w d3 / ext.l d3` from the low BYTE */
    elextb: (_, a): Value => VI(((int(a[0] ?? VI(0)) & 0xff) << 24) >> 24),
    /** =Elextw(N) — routine 79 ($1bce), `ext.l d3` from the low word */
    elextw: (_, a): Value => VI(sw(int(a[0] ?? VI(0)))),

    /**
     * =Elmem$(ADDR,SLENGTH) / =Elmem$(ADDR,SLENGTH,DELIMITER) — routines 67
     * ($1a98) and 68 ($1ad4). "AMOS already has peek,deek & leek - thing of
     * this as 'Seek' (!)"
     *
     * Routine 68 scans up to SLENGTH+1 bytes for DELIMITER, works out how far
     * it got and falls into routine 67 with that as the length, so "if the
     * memory reading is terminated by reading a DELIMETER character, that
     * character is not returned". SLENGTH of 0 is `Rbeq routine 3`.
     *
     * NOTE: the length bound is routine 67's `addq.l #$2,d3 / cmp.l
     * #$10000,d3 / Rbcc routine 3`, so it is the length PLUS TWO that must
     * stay under 65536 and the real maximum is 65533, not the guide's 65535.
     */
    'elmem$': (_, a): Value => {
      const addr = int(a[0] ?? VI(0))
      let len = int(a[1] ?? VI(0))
      if (a.length >= 3) {
        if (len === 0) funcCall()
        const delim = int(a[2] ?? VI(0)) & 0xff
        let k = 0
        while (k <= len && peekByte(rt, addr + k) !== delim) k++
        len = Math.min(k, len)
      }
      if (u32(len + 2) >= 0x10000) funcCall()
      let out = ''
      for (let i = 0; i < len; i++) out += String.fromCharCode(peekByte(rt, addr + i))
      return VS(out)
    },
    /**
     * =Elmem Inc(ADDR,S$) — routine 111 ($20b6), `Rbsr routine 69 / move.l
     * a1,d3`: the write, then the address just past it, "allowing many
     * strings to be copied into consecutive memory addresses easily".
     */
    'elmem inc': (_, a): Value => {
      const addr = int(a[0] ?? VI(0))
      const s = str(a[1] ?? VS(''))
      writeBytes(rt, addr, s)
      return VI(addr + s.length)
    },

    /**
     * =Elbank Name$(BANK) — routine 65 ($1a46). `L_Bnk_GetAdr`, then the
     * eight bytes at `-$8(a2)` and `-$4(a2)` — the name sits immediately
     * before the data. "The string returned is always 8 characters long, and
     * is padded with trailing spaces".
     */
    'elbank name$': (_, a): Value => {
      const b = rt.memBanks.get(int(a[0] ?? VI(0)))
      if (!b) throw new AmosError('Bank not reserved', 36)
      return VS((b.name + '        ').slice(0, 8))
    },
    /**
     * =Elbnk Here(BNKNO) — routine 158 ($2788). "This function will return
     * True (-1) if the specified bank has been reserved for the current
     * program, or False (0) if it has not."
     *
     * DEVIATION: the routine pops the parameter stack TWICE for a keyword
     * whose spec declares one argument —
     *
     *     20 1b   move.l (a3)+,d0        the argument, into d0
     *     76 00   moveq  #$0,d3
     *     74 00   moveq  #$0,d2
     *     20 1b   move.l (a3)+,d0        ...and again, overwriting it
     *     Rjsr    L_Bnk_GetAdr
     *
     * so the number it actually looks up is the long BELOW the argument on
     * AMOS's expression stack, and a3 is left four bytes high afterwards.
     * Every one-argument sibling (`Elextb`, `Elbank Name$`) pops once, so this
     * is not a convention. There is no shared parameter stack here to
     * under-run, so what the routine INTENDED is what runs: the argument is
     * looked up and the answer is -1 or 0.
     */
    'elbnk here': (_, a): Value => VI(rt.memBanks.has(int(a[0] ?? VI(0))) ? -1 : 0),

    /**
     * =Elmessage$(BANK,GROUP,NUMBER) — routine 64 ($1a34), which is routine
     * 147 followed by `tst.l d3 / Rbeq routine 3` and a fall into Elmem$ with
     * the address and length routine 147 left behind.
     */
    'elmessage$': (_, a): Value => {
      const m = message(rt, a)
      if (!m) funcCall()
      let out = ''
      for (let i = 0; i < m.len; i++) out += String.fromCharCode(m.data[m.at + i] ?? 0)
      return VS(out)
    },
    /**
     * =Elmessage Exists(BANK,GROUP,NUMBER) — routine 147 ($262c), and the
     * guide's own argument names for it (NAME, START) do not match its
     * siblings' or the routine's; the spec is three integers and the routine
     * is shared with Elmessage$.
     */
    'elmessage exists': (_, a): Value => VI(message(rt, a) ? -1 : 0),

    /**
     * =Elpad Asc$(S$,A,L) — routines 145 and 146 ($25da, $25f0).
     *
     *     move.w (a2)+,d6 / cmp.l d4,d6 / Rbhi routine 3
     *     ... move.w d4,(a1)+ / sub.l d6,d4
     *     copy d6 bytes, then write d4 copies of d5
     *
     * NOTE: the guide says "If the length of the string S$ is greater than or
     * equal to L, these two functions return S$". Equal does return S$; longer
     * is `Rbhi routine 3`, an Illegal Function Call. Only half the sentence is
     * true, and it is the half a program would rely on that is not.
     */
    'elpad asc$'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const ch = int(a[1] ?? VI(0))
      if (ch < 0 || u32(ch) >= 0x100) funcCall()
      return VS(pad(s, ch, int(a[2] ?? VI(0))))
    },
    /**
     * =Elpad Char$(S$,A$,L) — routine 144 ($25c6), which takes the first
     * character of A$ and joins routine 146. "If A$ contains more than one
     * character, the second and subsequent characters are ignored. In the
     * future I intend to change this to repeatedly use the whole of A$ to pad
     * S$" — 1.44 still does not.
     */
    'elpad char$'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const set = str(a[1] ?? VS(''))
      if (set.length === 0) funcCall()
      return VS(pad(s, set.charCodeAt(0), int(a[2] ?? VI(0))))
    },

    /**
     * =Elpat Case(P$,S$) / =Elpat Nocase(P$,S$) — routines 133 ($2456) and
     * 134 ($2466), each `Rbsr routine 132` then one library call.
     *
     * Routine 132 pops the SUBJECT first and the PATTERN second, because
     * `(a3)+` takes the last argument pushed, so a0 ends up on P$ and a1 on
     * S$ --- the order pattern.library's own $21ae wants. "These commands
     * return True (-1) if the string S$ matches the pattern P$, or false (0)
     * if it doesn't."
     *
     * `Rbmi routine 3`: every library failure is negative and every one of
     * them becomes the same AMOS 23, so the five codes pattern.library
     * distinguishes are not observable from AMOS.
     */
    'elpat case': (_, a): Value => VI(patMatch(rt, a, false)),
    'elpat nocase': (_, a): Value => VI(patMatch(rt, a, true)),
    /**
     * =Elpat Def(S$) — routine 135 ($2476). Reads `$98` and refuses when it
     * is null: "You have called = ElPat Def, without first defining a
     * default pattern ... This also occurs if you try to use a default
     * pattern after freeing it", which is `moveq #$13,d0` at $24a0.
     */
    'elpat def'(_, a): Value {
      const pat = rt.easylife.patDefault
      if (!pat) elError(19)
      return VI(matchPattern(pat, str(a[0] ?? VS(''))) ? -1 : 0)
    },
    /**
     * =Elpat Test(S$) — routine 140 ($250c), which is $19f6 with a null
     * output buffer. "Returns True if the string S$ contains any special
     * pattern matching control characters ... It can be used to decide
     * whether to compare that pattern with pattern matching, or with the
     * much faster AMOS string comparison."
     */
    'elpat test': (_, a): Value => VI(patternHasSpecials(str(a[0] ?? VS(''))) ? -1 : 0),
    /**
     * =Elpat Remove(P$) — routine 141 ($2528): allocate LEN bytes, call
     * $19f6 with them, and read back the NUL-terminated result.
     *
     * DEFECT: the library drops an escape and copies what it was protecting
     * raw, so `Elpat Remove("a'*")` answers `a*` --- a literal asterisk
     * turned into a wildcard. The guide's own idiom
     * `P$=Elpat Remove(P$) : If Elpat Test(P$)` is what walks into it.
     * Reproduced in `patternRemove`; see the note there.
     *
     * NOTE: routine 141's own stack juggling has a second, harmless slip.
     * It reserves a slot with `suba.w #$4,a3` and never writes it, so the
     * byte count routine 68 searches within is whatever was left on the
     * parameter stack. The search stops at the first NUL regardless, which
     * the library always writes, so the count never decides anything.
     */
    'elpat remove$': (_, a): Value => VS(patternRemove(str(a[0] ?? VS('')))),
    /**
     * =Elpat Escape(S$) — routine 142 ($2566), which allocates TWICE the
     * length because $1a82 can double every character. "Chr$(39) is added
     * before each control character", so the answer matches S$ literally.
     */
    'elpat escape$': (_, a): Value => VS(patternEscape(str(a[0] ?? VS('')))),

    /**
     * =Tag(TAG$) — routine 199 ($2c82). "Using a tag is similar to an AMOSPro
     * equate, but more powerful, as the tag string is converted at runtime,
     * not at test time, so it may be a variable, or a string expression."
     */
    tag: (_, a): Value => VI(tagValue(rt, str(a[0] ?? VS('')))),
    /**
     * =Tag$(...) — five forms sharing one entry: routine 196 (one tag), 197
     * (two), 198 (three), 200 (one tag `To VALUE`) and 201 (two `To VALUE`).
     * Each is the same shape — look every tag up, append the literal VALUE
     * where there is one, and answer the longwords packed into a string, so
     * that `Tag$("A","B")` is `Ellong$(Tag("A"))+Ellong$(Tag("B"))`.
     *
     * Routine 201 pops VALUE first and stores it LAST (`move.l d5,(a0)+`
     * then d6 then d7), which is the left-to-right order the guide's worked
     * example needs: TAG_NO_1's $80001000, then TAG_NO_2's $30, then
     * $11223344.
     */
    tag$(_, a): Value {
      // the `To VALUE` forms are the ones whose last argument is an integer
      const last = a[a.length - 1]
      const to = last !== undefined && last.k !== 'str' ? [int(last)] : []
      const tags = a.slice(0, a.length - to.length).map((v) => tagValue(rt, str(v)))
      return tagLongs([...tags, ...to])
    },
    /**
     * =Tag Str(S$) / =Tag Str(S$ To OBJECT) — routines 190 ($2c0a) and 191
     * ($2c18), which differ only in where the object comes from and both end
     * in routine 240. "The first 2 forms return the address of the stored
     * string. This address will not change, even if no OBJECT was specified."
     */
    'tag str': (_, a): Value =>
      VI(
        a.length > 1
          ? tagStore(rt, str(a[0] ?? VS('')), int(a[1] ?? VI(0)), true)
          : tagStore(rt, str(a[0] ?? VS('')), 0, false),
      ),
    /**
     * =Tag Str$(...) — routines 192 to 195, the same store with the address
     * packed into a string. "The next 2 forms return the longword address of
     * the stored string in a 4 character string. The last 2 forms return a 8
     * character string, the first 4 characters are the longword value of the
     * TAG$ and the last 4 characters are that address of the string."
     *
     * Routine 195 is the common one, and the guide's own example is
     * `A$=Tag Str$("MUIA_String_Contents","Fred" To STR_OBJ)`.
     */
    'tag str$'(_, a): Value {
      // TAG$,S$[,OBJ] versus S$[,OBJ]: the tag form has two strings
      const two = a.length > 1 && a[1]?.k === 'str'
      const s = str(a[two ? 1 : 0] ?? VS(''))
      const objArg = a[two ? 2 : 1]
      const at = tagStore(rt, s, objArg === undefined ? 0 : int(objArg), objArg !== undefined)
      return tagLongs(two ? [tagValue(rt, str(a[0] ?? VS(''))), at] : [at])
    },
    /**
     * =Tag Attach$(CHILD_OBJECT,TAG$) / =Tag Attach$(CHILD_OBJECT To TAG) —
     * routines 234 ($3240) and 235 ($324a). The string it builds is an
     * ordinary two-longword tag pair, but before returning it registers
     * CHILD_OBJECT as a child of the pending object, which is what the guide
     * means by "easylife needs to know when an object is being made a child
     * of another".
     *
     * THE OBJECT COMES FIRST, and both the guide and the binary say so. The
     * guide's own worked example is
     * `A$=Tag Attach(WIN_OBJ,"MUIA_Application_Window")`, "exactly the same
     * as `A$=Tag$("MUIA_Application_Window" To WIN_OBJ)`" but with EasyLife
     * told about the parentage. Routine 235 pops the tag longword FIRST and
     * writes it as the first longword, then pops the object; `(a3)+` takes
     * the LAST argument, so the last argument is the tag. Routine 234 is the
     * comma form and only differs in resolving that last argument through
     * routine 203's bank-13 name lookup first.
     *
     * The registration is routine 238's list: the PENDING object's node is
     * fetched first (`$c6`, `d4 = 0`), then CHILD_OBJECT's, and the child is
     * front-inserted into the parent's chain with `$1c` set. An object that
     * is already someone's child is Illegal Function Call
     * (`move.l $1c(a2),d2 / Rbne routine 3`), which is the guide's "You can
     * only dispose of an OBJECT if it is NOT the child of another object."
     * from the other end.
     */
    'tag attach$'(_, a): Value {
      const obj = int(a[0] ?? VI(0))
      const t = a[1] ?? VI(0)
      const tag = t.k === 'str' ? tagValue(rt, str(t)) : int(t)
      const reg = rt.easylife.mui
      const parent = muiFind(reg, reg.pending)!
      const child = muiFind(reg, obj)
      if (!child) elError(24)
      if (!muiAttach(parent, child)) funcCall()
      return tagLongs([tag, obj])
    },

    // ---- MUI, routines 205-237 ---------------------------------------------

    /**
     * =Mui New(CLASS$ [,TAGLIST$]) — routines 218 and 219 ($2f92, $2fa0).
     *
     * `MUI_NewObjectA(class, tags)` at LVO -30, then the adoption. Routine
     * 218 is the one-argument form and differs only in pushing the empty
     * taglist at $2f9a.
     *
     * "The address of the newly created object is returned, or 0 if the
     * object could not be created (Normally due to an error in the taglist)."
     */
    'mui new': (_, a): Value => VI(muiCreate(rt, str(a[0] ?? VS('')), a.length > 1 ? str(a[1]!) : '')),
    /**
     * =Mui Application(TAGLIST$) — routine 220 ($2fc0).
     *
     * `Mui New` with the class name wired to "Application.mui" (the literal
     * at $2ffa) and two extra jobs: it refuses when one already exists
     * (`tst.l (a1) / Rbne routine 3`, the guide's "You may only create one
     * application object at a time"), and it clears the signal mask at `$cc`.
     */
    'mui application'(_, a): Value {
      const reg = rt.easylife.mui
      if (reg.app) funcCall()
      const at = muiCreate(rt, MUIC.MUIC_Application, str(a[0] ?? VS('')))
      reg.app = at === 0 ? null : rt.boopsi.objectAt(at)
      reg.signals = 0
      return VI(at)
    },
    /** =Mui App — routine 221 ($300a), `$e8` read back, 0 when there is none */
    'mui app': (): Value => VI(rt.easylife.mui.app?.address ?? 0),
    /**
     * =Mui Make Button(LABEL$) / =Mui Make Popbutton(IMAGE) — routines 223
     * and 224 ($3048, $3062), `MUI_MakeObjectA` at LVO -120 with MUIO_Button
     * (2) and MUIO_PopButton (8).
     *
     * Both end `moveq #$ff,d4 / Rbra routine 238`, which registers the new
     * object unconditionally rather than adopting a pending node — so, as the
     * guide says, "You do not need to call Mui Begin before this function,
     * and stored strings are not assigned to this object".
     */
    'mui make button': (_, a): Value => VI(muiMake(rt, MUI.MUIO_Button, str(a[0] ?? VS('')))),
    'mui make popbutton': (_, a): Value => VI(muiMake(rt, MUI.MUIO_PopButton, int(a[0] ?? VI(0)))),
    /**
     * =Mui Get(OBJECT,TAG$) / (OBJECT To TAG) — routine 207 ($2de6), which
     * resolves the name and tails into routine 208 ($2df0).
     *
     * `GetAttr` at intuition.library -654, which is the ONE Intuition call in
     * the whole MUI block. "The attribute you attempt to get must be
     * readable ... the 'G' flag must be present" — an attribute without it
     * answers 0 here because GetAttr answered FALSE and routine 208 reads its
     * storage longword back regardless.
     */
    'mui get': (_, a): Value => VI(muiGet(rt, a) ?? 0),
    /**
     * =Mui Get$(OBJECT,TAG$) — routines 209 and 210 ($2e1c, $2e26).
     *
     * The same GetAttr, then the answer read as a C string. "If the string
     * attribute is NULL, Mui Get$ returns an empty string" is routine 210's
     * `tst.l d3 / bne` past the empty literal at $2e48.
     */
    'mui get$': (_, a): Value => VS(muiStrAt(rt, muiGet(rt, a) ?? 0)),
    'mui fn': (_, a): Value => {
      const obj = muiObj(rt, int(a[0] ?? VI(0))).obj
      return VI(muiDoMethod(rt, obj, str(a[1] ?? VS(''))))
    },
    /**
     * =Mui Hook(ADDRESS,DATA) — routine 228 ($312a).
     *
     * Twenty-four bytes: `struct Hook`'s MinNode, then `h_Entry` from the
     * extension's own trampoline at `$d0`, then `h_SubEntry` = ADDRESS and
     * `h_Data` = DATA. "DATA is a longword that will be in register A4 when
     * the hook code is called by MUI."
     *
     * NOTE: the hook is built and its address answered, so a taglist that
     * carries one is well formed and every keyword around it behaves. What
     * cannot happen is the call: ADDRESS is 68k machine code, and there is no
     * 68k here to run it. A MUI class reaching this hook would find an entry
     * point that does nothing, which is the same boundary `Amos Call` and
     * `Jd Exec` sit on.
     */
    'mui hook': (_, a): Value => VI(muiHook(rt, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)))),
    /**
     * =Mui Input — routine 225 ($3078).
     *
     * The guide sets out the whole routine: abort if the AMOS screen is in
     * front, else lock it; Wait() on the signals the last call handed back;
     * MUIM_Application_Input; store the new signals; restore the lock; answer
     * the method's result.
     *
     * DEVIATION: there is no Wait. exec's Wait blocks the task until a signal
     * arrives, and this port has one thread that must return to the frame
     * loop — so the signal mask is kept and honoured as state, and the input
     * method is asked what happened since last time. A program spinning on
     * `Mui Input` sees the same sequence of return ids; what it does not see
     * is the CPU going idle between them.
     */
    'mui input': (): Value => {
      const reg = rt.easylife.mui
      if (!reg.app) elError(24)
      return VI(rt.mui.doMui(reg.app, MUI.MUIM_Application_Input, [0]))
    },
    /**
     * =Mui Request(WIN,TITLE$,GAD$,TEXT$[,PAR$]) — routines 229 and 230
     * ($314e, $3158), `MUI_RequestA` at LVO -42. The five-argument form
     * passes PAR$ as the `params` array; routine 229 is the four-argument one
     * and pushes -2 for it.
     *
     * "The result is the number of the button pressed. Buttons are numbered
     * left to right, beginning with 1, except that the rightmost button is
     * button 0. (Commodores fault, not mine)".
     */
    'mui request': (_, a): Value =>
      VI(
        rt.mui.requestA(
          rt.easylife.mui.app,
          int(a[0] ?? VI(0)) === 0 ? null : muiObj(rt, int(a[0]!)).obj,
          str(a[1] ?? VS('')),
          str(a[2] ?? VS('')),
          str(a[3] ?? VS('')),
        ),
      ),
    /**
     * =Tag List$(NAME$ [,A1..A8]) — routines 246 to 254, nine arities of one
     * entry, all reaching routine 245 with the count in d4.
     */
    'tag list$': (_, a): Value =>
      tagList(
        rt,
        str(a[0] ?? VS('')),
        a.slice(1).map((x) => int(x) | 0),
      ),

    // ---- structured variables, routines 262-295 ----------------------------

    /**
     * =St New(STRUCTURE) — routine 263 ($37d0), `ELST_New` with
     * `move.l #$10000,d1`, which is MEMF_CLEAR.
     *
     * The clear is the guide's whole initialisation table: strings become "",
     * reals 0.0, booleans false, pointers nil, and a ranged integer its
     * LOWEST legal value, because a ranged integer is stored biased by its
     * minimum and all-bits-zero therefore IS the minimum.
     */
    'st new': (_, a): Value =>
      VI(stCall(() => newInstance(rt, rt.easylife.structs, int(a[0] ?? VI(0)) | 0, true))),
    /**
     * =St Load(FILENAME$) — routine 264 ($37f2), `ELST_LoadTree`.
     *
     * Answers the new address of the instance that was passed to `St Save`,
     * with every pointer in the graph relocated onto the new addresses.
     */
    'st load': (_, a): Value =>
      VI(
        stCall(() => {
          const raw = rt.fs?.read(str(a[0] ?? VS('')))
          if (!raw) throw new ElstError(ELST_ERR_OPEN)
          return loadTree(rt, rt.easylife.structs, Uint8Array.from(raw))
        }),
      ),
    /**
     * =St Dup(INSTANCE) — routine 267 ($384c).
     *
     * `ELST_New` with d1 = 0, so NO clear, then `move.l (a2)+,(a1)+` over
     * `size/4` longwords — the whole instance, type word included. The guide
     * says it is "equivilent to (But faster than): S2=St New(St Type(S1)) :
     * St Copy S1 To S2", and the difference is exactly that: `St Copy` skips
     * the four-byte header and this does not.
     */
    'st dup': (_, a): Value =>
      VI(
        stCall(() => {
          const src = int(a[0] ?? VI(0)) | 0
          const bank = typeTable(rt)
          const type = elstReadWord(rt, src)
          const size = structDef(bank, lookup(bank, type, 0)).size
          const dst = newInstance(rt, rt.easylife.structs, type, false)
          for (let i = 0; i < size; i++) {
            const m = rt.resolveWrite(dst + i)
            if (m) m.data[m.off] = peekByte(rt, src + i)
          }
          return dst
        }),
      ),
    /**
     * =St Output$(INSTANCE) — routine 270 ($38f8).
     *
     * The instance's bytes as an AMOS string, so a program can `Print#` it.
     * Two defects sit in the sixty-six bytes that produce it and neither is
     * reproducible; `instanceBytes` in elstruct.ts is where they are recorded
     * and why this implements the guide instead.
     */
    'st output$': (_, a): Value =>
      VS(
        stCall(() => {
          const inst = int(a[0] ?? VI(0)) | 0
          const bank = typeTable(rt)
          const size = structDef(bank, lookup(bank, elstReadWord(rt, inst), 0)).size
          return instanceBytes(rt, inst, size)
        }),
      ),
    /**
     * =St Type(INSTANCE) — routine 271 ($393a).
     *
     * The instance's own type word, straight out of its first two bytes. The
     * `ELST_Lookup` under it is there to validate: `Rbeq routine 299` on a
     * type bank 12 does not hold, and d3 — the result — was loaded before the
     * call and is never touched by it.
     */
    'st type': (_, a): Value =>
      VI(
        stCall(() => {
          const bank = typeTable(rt)
          const type = elstReadWord(rt, int(a[0] ?? VI(0)) | 0)
          lookup(bank, type, 0)
          return type
        }),
      ),
    /**
     * =St Len(INSTANCE) — routine 272 ($395c), ten bytes: `Rbsr routine 271`
     * for the validated lookup, then `movea.l d0,a0 / move.l (a0),d3` — the
     * definition's first longword, which is the allocation size.
     */
    'st len': (_, a): Value =>
      VI(
        stCall(() => {
          const bank = typeTable(rt)
          return structDef(bank, lookup(bank, elstReadWord(rt, int(a[0] ?? VI(0)) | 0), 0)).size
        }),
      ),
    /**
     * =St Get(INSTANCE, ELEMENT [,I1[,I2[,I3]]]) — routines 273-276 into the
     * shared body 260 ($375e), which is `ELST_GetElement` and then
     * `move.l d0,d3 / moveq #$0,d2`.
     *
     * That last pair is why the answer is always an AMOS INTEGER, whatever
     * the element's type: a Real element gives back its raw longword and a
     * string element gives back the ADDRESS of its characters, which the
     * guide says outright is the point — "it can be used for any system
     * library calls that require a pointer to a string, or in MUI taglists".
     */
    'st get': (_, a): Value =>
      VI(stCall(() => getElement(rt, stResolve(rt, a, stIdx(a, 2, a.length))))),
    /**
     * =St Get$(INSTANCE, ELEMENT [,I1[,I2[,I3]]]) — routines 277-280 into
     * routine 261 ($3782), which calls 260 and then copies the string out of
     * the instance into fresh AMOS string space. "St Get$ returns a copy."
     */
    'st get$': (_, a): Value =>
      VS(stCall(() => getString(rt, stResolve(rt, a, stIdx(a, 2, a.length))))),
    /**
     * =St Cmp(INSTANCE, ELEMENT [,I1[,I2[,I3]]] To STRING$) — routines
     * 290-293 into routine 289 ($3a56), `ELST_StrCmp`.
     *
     * The sign is the library's, not the guide's — see `strCmp`, which
     * explains why they are opposites and which one this follows.
     */
    'st cmp': (_, a): Value =>
      VI(
        stCall(() =>
          strCmp(
            rt,
            stResolve(rt, a, stIdx(a, 2, a.length - 1)),
            str(a[a.length - 1] ?? VS('')),
          ),
        ),
      ),
    /**
     * =St Lookup(ID, SCOPE) — routine 294 ($3a94), `ELST_Lookup` unwrapped.
     *
     * Returns the ADDRESS of the definition in bank 12, not an offset:
     * `adda.l d2,a1 / move.l a1,d0` adds the entry's offset to the bank base.
     * SCOPE 0 asks for a structure name; any other scope is the id of the
     * structure whose element is wanted.
     */
    'st lookup': (_, a): Value =>
      VI(
        stCall(
          () =>
            (rt.bankBase(ELST_BANK) +
              lookup(typeTable(rt), int(a[0] ?? VI(0)) | 0, int(a[1] ?? VI(0)) | 0)) |
            0,
        ),
      ),
    /**
     * =Stv(INSTANCE, ELEMENT [,I1[,I2[,I3]]]) — the read half of the V-form,
     * and it is `St Get`: the four token entries name routines 273-276, the
     * very same trampolines.
     *
     * Undocumented — `stv` appears in no guide, and 1.09 does not have it at
     * all. See the instruction half for the four bytes 1.10 added in front of
     * each `St Set` body to give it a write half.
     */
    stv: (_, a): Value => VI(stCall(() => getElement(rt, stResolve(rt, a, stIdx(a, 2, a.length))))),

    /**
     * =El Error — 1.0's alone, and the only 1.0 name with no later keyword to
     * be an alias of. 1.0's routine 165 ($191a) is twenty bytes:
     *
     *     movea.l $1e8(a5),a2 / adda.w #$44,a2
     *     move.l (a2),d3 / move.l #$0,(a2) / moveq #$0,d2
     *
     * so it reads the field 1.0's error thrower writes and CLEARS it, which
     * is what the doc is describing: "The El Error value is cleared ... when
     * it is read. This means that if other extensions produce an error, El
     * Error will not contain the number of an EasyLife error you've already
     * handled."
     *
     * DEVIATION: the doc says cleared to -1 and the instruction is
     * `move.l #$0,(a2)`. Zero, and zero is also what a program sees before
     * any EasyLife error has been raised, so the doc's -1 would have been the
     * more useful of the two. The binary wins.
     *
     * 1.09 dropped both the field and the keyword; the later error thrower
     * (routine 300) goes straight to `L_ErrorExt` without recording anything.
     */
    'el error': (): Value => {
      const n = lastElError
      lastElError = 0
      return VI(n)
    },

    /**
     * =Eltest(A,B) — 1.09 only: 1.09's routine 256 ($3732), EIGHT BYTES.
     *
     *     moveq #$0,d0 / lea $c(a3),a3 / rts
     *
     * The author's own probe, and the read half of it. See the header for
     * what the pair is for; the write half is in the instructions map.
     *
     * DEVIATION: it sets d0 and never d3 or d2, where every other function
     * in this extension returns its value in d3 with a type code in d2. So
     * on the machine `=Eltest(a,b)` answers whatever d3 held from the last
     * thing that set it, with an undefined type — not a value a caller can
     * predict and not one this port can reproduce. Zero is answered instead,
     * and typed as an integer, which is what the spec's leading `0` asks for.
     */
    eltest: (): Value => VI(0),
  }
}

/** routine 146's tail: copy, then pad to `len`, refusing a string already longer */
function pad(s: string, ch: number, len: number): string {
  if (u32(s.length) > u32(len)) funcCall()
  return s + String.fromCharCode(ch).repeat(len - s.length)
}

/** the `dbra d5` in routines 35 and 40: skip N-1 matches, then take the next */
function nth(s: string, hit: (c: string) => boolean, n: number, rt: Runtime): number {
  let left = n
  for (let i = 0; i < s.length; i++) {
    if (hit(s[i]!) && --left === 0) return i + 1
  }
  return elfMiss(rt, s.length)
}

/** the four `asc` forward searches: (S$, A[, P]) */
function elfFwd(rt: Runtime, find: (s: string, from: number, ch: number) => number): Func {
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const ch = int(a[1] ?? VI(0))
    const from = fwdStart(int(a[2] ?? VI(0)), ch)
    const at = from >= s.length ? -1 : find(s, from, ch)
    return VI(at < 0 ? elfMiss(rt, s.length) : at + 1)
  }
}

/** the four `char` forward searches: (S$, A$[, P]) */
function elfFwdSet(rt: Runtime, hit: (set: string, c: string) => boolean): Func {
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const set = str(a[1] ?? VS(''))
    const from = fwdStart(int(a[2] ?? VI(0)), 0)
    for (let i = from; i < s.length; i++) if (hit(set, s[i]!)) return VI(i + 1)
    return VI(elfMiss(rt, s.length))
  }
}

/** the two `asc` backward searches: (S$, A[, P]) */
function elfBack(rt: Runtime, find: (s: string, from: number, ch: number) => number): Func {
  void rt
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const ch = int(a[1] ?? VI(0))
    const at = find(s, backStart(s, int(a[2] ?? VI(0)), ch), ch)
    return VI(at + 1)
  }
}

/** the two `char` backward searches: (S$, A$[, P]) */
function elfBackSet(rt: Runtime, hit: (set: string, c: string) => boolean): Func {
  void rt
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const set = str(a[1] ?? VS(''))
    for (let i = backStart(s, int(a[2] ?? VI(0)), 0) - 1; i >= 0; i--) {
      if (hit(set, s[i]!)) return VI(i + 1)
    }
    return VI(0)
  }
}

/** the four `Elmzn*` readers, which differ only in the field they load */
function mzCorner(rt: Runtime, k: 'x1' | 'y1' | 'x2' | 'y2'): Func {
  return (_, a): Value => VI(sw(mzZone(rt, a)?.[k] ?? 0))
}

/** routine 87 ($1d6c): (GROUP, ID) to the rectangle, or message 11 */
function mzZone(rt: Runtime, a: Value[]): Zone | null {
  // routine 87 calls routine 81 BEFORE it looks at either argument, so a
  // screen with no multi zones says so even when the pair is (0,0); then
  // `move.l (a3)+,d1 / Rbeq routine 3` pops the LAST argument first, so the
  // id is the one refused before the group is even read
  const { s, m } = multiZones(rt)
  const id = int(a[1] ?? VI(0))
  if (id === 0) funcCall()
  const group = int(a[0] ?? VI(0))
  if (group === 0) funcCall()
  const i = findSlot(m, w(group), w(id))
  if (i < 0) elError(11)
  return s.zones[i] ?? null
}

function mzone(rt: Runtime): Func {
  return (_, a): Value => {
    const st = rt.easylife
    st.mzX = sw(int(a[0] ?? VI(0)))
    st.mzY = sw(int(a[1] ?? VI(0)))
    st.mzFilter = w(int(a[2] ?? VI(0)))
    st.mzCursor = 0
    return VI(mzNext(rt))
  }
}

/** routine 96's scan, shared by `Elmzone` and `Elmzonen` */
function mzNext(rt: Runtime): number {
  const st = rt.easylife
  const { s, m } = multiZones(rt)
  for (let i = st.mzCursor; i < m.slots.length; i++) {
    const z = s.zones[i]
    // an untouched record is eight zero bytes here; on the machine it is
    // whatever AllocMem handed back, but no slot referring to it is in use
    const x1 = sw(z?.x1 ?? 0)
    const y1 = sw(z?.y1 ?? 0)
    const x2 = sw(z?.x2 ?? 0)
    const y2 = sw(z?.y2 ?? 0)
    if (x1 > st.mzX || y1 > st.mzY || x2 < st.mzX || y2 < st.mzY) continue
    st.mzCursor = i + 1
    const sl = m.slots[i]!
    if (st.mzFilter !== 0 && sl.group !== st.mzFilter) continue
    if (sl.id === 0) continue
    st.mzGroup = sl.group
    return sl.id
  }
  st.mzCursor = m.slots.length
  st.mzGroup = 0
  return 0
}

export function makeEasyLifeInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /** Eliconify End — routine 126 ($231c); see `elIconifyEnd` */
    'eliconify end'(): void {
      elIconifyEnd(rt)
    },

    /**
     * Elzn Shift SCREEN,DX,DY [,START To FINISH] — routines 15 ($142e), 16
     * ($1436) and the shared body 17 ($1458).
     *
     * Routine 15 is `moveq #$ff,d4 / moveq #$ff,d5 / Rbra routine 17`: -1 in
     * both is the flag routine 17 tests with `tst.l d4 / bpl`, and the
     * negative arm rewrites the pair as 1..EcNZones. Routine 16 is the range
     * form and checks the two bounds BEFORE handing over — `cmp.l #$10000,d4
     * / Rbcc` and the same for d5, so a bound of 65536 or more is AMOS 23,
     * and `tst.l d4 / Rbeq` makes START zero one too. Then routine 17 adds
     * `cmp.w d4,d5 / Rbcs` (FINISH below START) and `cmp.w d5,d2 / Rbcs`
     * (FINISH past the count).
     *
     * The four adds are `add.w`, so the arithmetic is modulo 65536 and a zone
     * shifted off the left edge comes back as a coordinate near 65535. The
     * guide says so and warns that AMOS's own `=Zone(x,y)` is confused by it
     * while these readers are not.
     *
     * DEVIATION: the all-zones form on a screen with NO zones reserved is a
     * hang on the real machine. Routine 17 takes `d4 = 1, d5 = 0`, shifts
     * both left three to 8 and 0, and then loops `cmp.l d4,d5 / beq` — which
     * can never be equal — writing four words through a null EcAZones and
     * stepping eight bytes at a time forever. The guide documents "Illegal
     * function call ... No zones are reserved on the given screen" for this
     * case and no such check exists; that error is raised here instead, since
     * reproducing an unbounded write over the whole address space is not a
     * behaviour a caller can observe as anything but a crash.
     */
    'elzn shift'(it) {
      const scr = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      let start = -1
      let finish = -1
      if (it.accept(',')) {
        start = it.evalInt()
        it.expect('to')
        finish = it.evalInt()
        // routine 16's three guards, in its order
        if (u32(start) >= 0x10000) funcCall()
        if (start === 0) funcCall()
        if (u32(finish) >= 0x10000) funcCall()
      }
      const s = rt.screens.get(scr)
      if (!s) throw new AmosError(`screen not opened: ${scr}`, 47)
      const count = s.zones.length
      if (start < 0) {
        if (count === 0) funcCall() // DEVIATION: see above
        start = 1
        finish = count
      } else {
        if ((finish & 0xffff) < (start & 0xffff)) funcCall()
        if (count < (finish & 0xffff)) funcCall()
      }
      for (let n = start; n <= finish; n++) {
        const z = s.zones[n - 1]
        if (!z) {
          // the 68k adds into the record whether or not it was ever set, and
          // an all-zero record shifted by (dx,dy) stops being all-zero — so
          // an unset zone BECOMES set, at (dx,dy) to (dx,dy)
          s.zones[n - 1] = { x1: dx & 0xffff, y1: dy & 0xffff, x2: dx & 0xffff, y2: dy & 0xffff }
          continue
        }
        z.x1 = (z.x1 + dx) & 0xffff
        z.y1 = (z.y1 + dy) & 0xffff
        z.x2 = (z.x2 + dx) & 0xffff
        z.y2 = (z.y2 + dy) & 0xffff
      }
    },

    /**
     * Elzb Add SCREEN,BANK,GROUP — routines 100 ($1ea6), 101 ($1ec8) and 104
     * ($1f6a).
     *
     * Installs one group of a zone bank as that screen's AMOS zones. Routine
     * 101 locates the group and routine 104 replaces the table:
     *
     *     d0 = d5<<3 / Rbsr routine 116        AllocMem, or error 24
     *     movea.l $d2(a0),a1 / Rbsr routine 115    free the old table
     *     move.l d7,$d2(a0) / move.w d5,$d6(a0)
     *
     * so `Reserve Zone` is implied and whatever was there is gone, which is
     * the guide's "Any previously reserved zones or multi zones are removed".
     * The copy itself is `asl.l #$2,d5 / move.w (a2)+,(a1)+` — four words a
     * zone, straight out of the bank.
     */
    'elzb add'(it) {
      const scr = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      it.expect(',')
      const group = it.evalInt()
      const s = rt.screens.get(scr)
      if (!s) throw new AmosError(`screen not opened: ${scr}`, 47)
      const zones = zoneBankGroup(rt, bank, group)
      s.reserveZones(zones.length)
      for (let i = 0; i < zones.length; i++) s.zones[i] = zones[i]!
    },

    /**
     * ElMz Reserve NUM — routine 80 ($1bd6).
     *
     *     move.l (a3)+,d6 / addq.l #$1,d6 / andi.l #$fffffffe,d6   round UP
     *     move.l d6,d7 / asr.l #$1,d7 / add.l d6,d7 / addq.l #$1,d7
     *     cmp.l #$2000,d5 / Rbcc routine 3        n*3/2+1 must stay under 8192
     *     Rbsr routine 104                        replace EcAZones outright
     *
     * so `NUM` is rounded up to even and the table costs one and a half
     * records a zone plus a trailer, which is where the guide's "A maximum of
     * 5460 multi zones can be defined. (There is a good reason for that
     * number!)" comes from: 5460*3/2+1 = 8191, and 5462 would be 8194.
     *
     * The rest of the routine builds the free list — entry i links to i+1,
     * the last to $ffff, the head is 0 — and writes n, that head and the
     * $0000fefd magic into the trailer record.
     *
     * DEVIATION: `NUM` of zero or less scribbles memory on the machine.
     * `(0+1) & ~1` is 0, so it allocates one record and then runs
     * `moveq #$4,d1 / subq.l #$2,d2 / ... dbra d2` with d2 = -2, and dbra
     * counts the LOW WORD down from $fffe — 65535 iterations writing four
     * bytes each, a quarter of a megabyte past an eight-byte allocation. The
     * guide documents no error for it; AMOS 23 is raised here.
     */
    'elmz reserve'(it) {
      mzReserve(rt, it.evalInt())
    },

    /**
     * Elzb Multi Add BANK,GROUP — routine 102 ($1f02) — and Elzb Multi Add
     * BANK, the one-argument continuation at id $45a on routine 103 ($1f30),
     * which is 1.0's `Zb Install` under a name of its own.
     *
     * Routine 102 is routine 101's group lookup (the same one `Elzb Add`
     * uses) and then, per zone, four words pushed with the group and an ID it
     * counts from ONE and a `Rbsr routine 85` — so every zone of the group
     * becomes a multi-zone under that group, numbered in bank order. `tst.l
     * d5 / beq` makes an empty group do nothing at all rather than fail.
     *
     * Routine 103 is the same over the whole bank, and its shape is worth
     * keeping: it PEEKS its argument (`move.l (a3),d0`, no post-increment),
     * walks every group counting zones, calls routine 80 once with the total,
     * and only then adds them — so one reserve covers the lot, which is the
     * whole point of the keyword. The walk runs the groups DOWNWARD, from the
     * count at bank+0 to 1, and that order decides which zone lands in which
     * slot, so it is reproduced rather than tidied. The argument is finally
     * popped by the second of the two `move.l (a3)+` at $1f58, which is why
     * a3 balances.
     */
    'elzb multi add'(it) {
      const bank = it.evalInt()
      if (it.accept(',')) {
        // routine 102: one group
        const group = it.evalInt()
        for (const [i, z] of zoneBankGroup(rt, bank, group).entries()) {
          if (z) mzSet(rt, group, i + 1, z.x1, z.y1, z.x2, z.y2)
        }
        return
      }
      // routine 103: every group, one reserve, descending
      const b = rt.memBanks.get(bank)
      if (!b) throw new AmosError('Bank not reserved', 36)
      const groups = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength).getUint32(0, false)
      let total = 0
      for (let g = groups; g >= 1; g--) total += zoneBankGroup(rt, bank, g).length
      mzReserve(rt, total)
      for (let g = groups; g >= 1; g--) {
        for (const [i, z] of zoneBankGroup(rt, bank, g).entries()) {
          if (z) mzSet(rt, g, i + 1, z.x1, z.y1, z.x2, z.y2)
        }
      }
    },

    /**
     * ElMz Set GROUP,ID,X1,Y1 To X2,Y2 — routine 85 ($1ccc); the two-argument
     * `ElMz Set GROUP,ID` ERASES that zone and is routine 86 ($1d46).
     *
     * The handler key carries a DOUBLE SPACE because the table entry does:
     * the raw bytes at $60f are `21 65 6c 6d 7a 20 20 73 65 f4`, `!elmz  se`
     * plus a high-bit `t`, where its neighbours `elmz reserve` and `elmz
     * erase` have one space each and not one of AMOS's own 778 core names has
     * an internal double space. So it is a typo in the author's source — and
     * a harmless one, because the editor's tokeniser throws spaces away
     * before it matches (`TkOtre: cmp.b #" ",d0 / beq TokLoop`, +Edit.s:14387,
     * "Saute les 32"). A table name's spacing is for DISPLAY, and `ElmzSet`,
     * `Elmz Set` and `Elmz  Set` all reach this same token. Dispatch here is
     * by the table's name, so the key has to match it exactly.
     *
     * Both refuse a zero GROUP or ID with AMOS 23 — zero is what marks a slot
     * free, so neither can be a real number, and the guide agrees: "Neither
     * GROUP or ID can be 0". A pair already in the index is overwritten in
     * place; otherwise routine 83 takes a slot off the free list.
     *
     * The corners are sorted rather than refused, which is the opposite of
     * `Set Zone`:
     *
     *     cmp.l d1,d5 / bcc.b .keep / move.w d1,$6(a1,d2.w) / move.w d5,d1
     *
     * NOTE: those compares are `cmp.l` and UNSIGNED, while the stores are
     * `move.w` and the readers sign-extend. So the guide's "X1,Y1 and X2,Y2
     * are automatically sorted so X1 <= X2, and Y1 <= Y2" holds for the
     * 0..32767 half of the range it also promises (-32768 to 32767) and
     * inverts for the other: a negative coordinate is $ffffxxxx, above every
     * positive one, so it sorts to the far corner and `Elmznsx` comes back
     * larger than `Elmznex`.
     */
    'elmz  set'(it) {
      const group = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      if (it.atStmtEnd()) {
        // routine 86 reaches routine 81 first, then pops the ID and refuses
        // it before the GROUP
        const { m } = multiZones(rt)
        if (id === 0) funcCall()
        if (group === 0) funcCall()
        const i = findSlot(m, w(group), w(id))
        // DEVIATION: routine 86 tests `cmp.l #$ffff,d2` where routines 85, 87
        // and 92 all test `cmp.w`. Routine 82 signals "not found" with
        // `moveq #$ff,d2`, which is -1 and NOT $0000ffff, so the long compare
        // never matches and the routine goes on to free slot -1 — an odd
        // address two bytes before the index. Erasing a zone that is not
        // there is a no-op here, which is plainly what was meant.
        if (i >= 0) freeSlot(m, i)
        return
      }
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      mzSet(rt, group, id, x1, y1, x2, y2)
    },

    /**
     * ElMz Erase GROUP — routine 92 ($1dcc).
     *
     * Calls routine 82 with `moveq #$0,d1`, the wildcard id, and loops:
     * every slot in the group is freed, walking forward from the last hit.
     * "This command does not deallocated any memory" — only the index entries
     * go back on the free list, and the rectangles they pointed at are left
     * in the zone table untouched.
     *
     * There is no check that GROUP is non-zero, and none is needed: routine
     * 82 skips any slot whose id is 0, and every slot in a real group has a
     * real id, so `ElMz Erase 0` matches nothing.
     */
    /**
     * Elf Fail Start / Elf Fail End — routines 151 ($26c8) and 152 ($26d4),
     * twelve bytes each: `movea.l $1e8(a5),a0 / move.w #$0,$a0(a0)` and the
     * same with $ffff.
     *
     * NOTE: these two are the extension's only UNDOCUMENTED keywords. The
     * guide's index lists both and links them to `C_ElfFailStart`, and no such
     * node exists in any of the three guides — a broken link, so what the
     * setting means has to come from the readers. It is the not-found answer
     * of the five forward searches, 0 or the string's length plus one, and
     * `Elf Fail Start` is both the boot state and what the Default hook
     * restores (the guide's CommandEffects node says so).
     */
    'elf fail start': () => {
      rt.easylife.elfFailEnd = false
    },
    'elf fail end': () => {
      rt.easylife.elfFailEnd = true
    },

    /**
     * Elwset / Elwclr / Elwchg BIT,ADDR — routines 72, 74 and 76 ($1b40,
     * $1b6c, $1b98), twenty-two bytes each: pop the address, pop and bound
     * the bit, `move.w (a0),d1 / bXXX d0,d1 / move.w d1,(a0)`. "These
     * commands are equivilent to AMOS Bset,Bclr and Bchg instructions, but
     * they allow you to modify the bits of words & longwords of memory."
     */
    'elwset'(it) {
      bitOp(rt, it, 16, (v, b) => v | (1 << b))
    },
    'elwclr'(it) {
      bitOp(rt, it, 16, (v, b) => v & ~(1 << b))
    },
    'elwchg'(it) {
      bitOp(rt, it, 16, (v, b) => v ^ (1 << b))
    },
    /** Ellset — routine 73 ($1b56), the word routine with `.l` throughout */
    'ellset'(it) {
      bitOp(rt, it, 32, (v, b) => v | (1 << b))
    },
    /**
     * Ellclr BIT,ADDR — routine 75 ($1b82), and DEVIATION: it is broken by
     * one bit of one instruction.
     *
     *     routine 74:  32 10  move.w (a0),d1 / 01 81 bclr d0,d1 / 30 81
     *     routine 75:  20 10  move.l (a0),d0 / 01 81 bclr d0,d1 / 20 81
     *
     * `20 10` is `move.l (a0),d0` where `22 10` would be `move.l (a0),d1` —
     * so the memory lands in d0, destroying the bit number, and `bclr d0,d1`
     * then clears bit (memory mod 32) of a d1 nothing in the routine ever
     * loaded. Whatever the interpreter happened to leave in d1 is what gets
     * stored back. Its word sibling is correct, and so are the other five of
     * the six. There is no defined value for d1 on entry, so the defect is
     * not reproducible even in principle; the intent — clear the bit — is
     * what runs here.
     */
    'ellclr'(it) {
      bitOp(rt, it, 32, (v, b) => v & ~(1 << b))
    },
    /**
     * Ellchg BIT,ADDR — routine 77 ($1bae), and DEFECT, reproduced: it SETS
     * the bit.
     *
     *     routine 76:  22 10 move.l (a0),d1 / 01 41 bchg d0,d1 / 20 81
     *     routine 77:  22 10 move.l (a0),d1 / 01 c1 bset d0,d1 / 20 81
     *
     * `01 c1` is `bset` where `01 41` would be `bchg`, so `Ellchg` is
     * `Ellset` with a different name — one bit of one opcode, in the long
     * member of a pair whose word member (routine 76) has the right one.
     * This one IS reproducible exactly, so it is.
     */
    'ellchg'(it) {
      bitOp(rt, it, 32, (v, b) => v | (1 << b))
    },

    /**
     * ElPp Load BUF,FILE$,DECRUNCH — routine 55 ($17a0), 162 bytes.
     *
     * `cmp.l #$8,d0 / Rbcc routine 3` on the buffer, then `Rbsr routine 58`
     * frees whatever was there ("If the chosen buffer already contained data,
     * it is freed first"), then routine 62 opens the library — a failure
     * there is message 0 before the file is even looked at, which is the
     * guide's "The Powerpacker Library is required to be in LIBS: even if the
     * file your are loading in not crunched". Routine 1 makes a
     * null-terminated copy of FILE$ and an EMPTY name is AMOS 23 (`cmp.w
     * #$1,d1`, the copy being one longer than the original).
     *
     * ppLoadData's failure code is turned into a message by `addq.l #$8,d0`,
     * so its -1..-7 land on messages 7..1: 'Unable to open file', 'Error
     * reading file', 'Out of memory while loading / decrunching file', the
     * two encrypted ones, 'Illegal powerpacker header' and "You can't PPLoad
     * an empty file". That arithmetic is what pins the block's order.
     *
     * DECRUNCH picks the flash effect (0..4, "2 : Flash colour 17 (Mouse
     * Pointer - Recomended)") and is passed straight to the library with no
     * range check of the extension's own. There is no flashing here and no
     * library to refuse, so it is recorded and ignored.
     *
     * "Pp Load will load uncrunched data without any problems, so you don't
     * have to worry about whether the file you are loading is crunched or
     * not" — the PP20 magic decides, exactly as ppLoadData does.
     */
    'elpp load'(it) {
      const n = it.evalInt()
      if (u32(n) >= 8) funcCall()
      it.expect(',')
      const file = it.evalStr()
      it.expect(',')
      it.evalInt() // the flash mode, recorded by the library and not by us
      rt.ppBuffers[n] = null
      if (file === '') funcCall()
      const raw = rt.fs?.read(file)
      if (!raw) elError(7) // 'Unable to open file'
      let data = raw
      if (raw.length >= 4 && String.fromCharCode(...raw.subarray(0, 3)) === 'PP2') {
        try {
          data = pp20Decrunch(raw)
        } catch {
          elError(2) // 'Illegal powerpacker header'
        }
      }
      rt.ppBuffers[n] = data
    },

    /**
     * ElPp Free NUM — routine 58 ($187a). "Freeing a buffer which is not
     * allocated does not cause an error, it does nothing." The guide's second
     * form, `ElPp Free All`, is not a keyword: the token table has one entry
     * with one argument, and what it points at is the Default hook, which
     * walks all eight slots itself (routine 0's cleanup at $1222).
     */
    'elpp free'(it) {
      const n = it.evalInt()
      if (u32(n) >= 8) funcCall()
      rt.ppBuffers[n] = null
    },

    /**
     * ElPp Allocate NO,LENGTH — routine 63 ($1a1c), twenty-four bytes:
     * `Rbsr routine 58` to free the old one, then routine 116 (AllocMem, or
     * error 24) and the address and length into the slot.
     */
    'elpp allocate'(it) {
      const n = it.evalInt()
      if (u32(n) >= 8) funcCall()
      it.expect(',')
      const len = it.evalInt()
      rt.ppBuffers[n] = null
      if (len < 0 || len > rt.fastFree()) throw new AmosError('Out of memory', ERR.OUT_OF_MEMORY)
      rt.ppBuffers[n] = new Uint8Array(len)
    },

    /**
     * ElPp Keep On / ElPp Keep Off — routines 60 and 61 ($19b4, $19d0).
     * OpenLibrary into $78 and CloseLibrary out of it, each guarded so a
     * second call does nothing. "Pp Keep Off does not always removed the
     * library from memory - other processes may also be using it, but it
     * informs the memory manager that EasyLife has no objection."
     *
     * NOTE: the codec is built in here and cannot fail to open or be flushed
     * out, so the pair is bookkeeping. The state is kept because the Default
     * hook is documented to call `Elpp Keep Off`, and a later slice will.
     */
    'elpp keep on': () => {
      rt.easylife.ppKeep = true
    },
    'elpp keep off': () => {
      rt.easylife.ppKeep = false
    },

    /**
     * Elxpk Load FILENAME$ [,PASSWORD$] [To BNKNO] — routines 170-173
     * ($2928, $2936, $2944, $295a), four entries into routine 176 ($2998).
     *
     * Each variant only sets up registers: `d2` and `d5` say which shape it
     * is and `d3` selects the fourth tag slot's id.
     *
     *     170  d2=0   d3=$8000587e  d5=0          Load f$
     *     171  d2=0   d3=$8000587e  d5=(a3)+      Load f$ To n
     *     172  d2=0   d3=$80005874  d5=0          Load f$,p$
     *     173  d2=0   d3=$80005874  d5=(a3)+      Load f$,p$ To n
     *
     * $80005874 is XPK_Password and $8000587e is the harmless tag used to
     * blank that slot when there is no password — the tag list is fixed and
     * only its fourth entry's ID moves. The rest of it, at $2a40, is
     * [$5871 OutBufLen][$5862 OutBuf][$5877 ...][id data][$5851 InName][0],
     * and the six that matter pair up as name/buf/len:
     *
     *     $5851 InName   $5853 InBuf    $5870 InLen
     *     $5860 OutName  $5862 OutBuf   $5871 OutBufLen
     *     $5874 Password $587a PackMethod
     *
     * NOTE: $5877 is the one tag whose meaning is not settled here. It is
     * given 0 by the four Load forms and -1 by the two Bload forms, and its
     * default in the table is -1. Nothing observable through these keywords
     * changes with it.
     *
     * Routine 176 then calls `Elxpk Lof` for the length, reserves a bank
     * called "XPKWork " of `ULen + 256 - 24` bytes and unpacks into
     * `Start(n) - 24` — the saved 24-byte node and header land back on top
     * of the fresh one, which is how the name and flags come back. With no
     * `To`, `d5` is 0 and the bank number comes from the fib instead: the
     * longword at offset 8 of `xsh_Initial`, which is offset 8 of the
     * original data, which is the saved header's bank number.
     *
     * "If no bank number is specified, the bank is loaded back to the number
     * from which it was saved."
     *
     * DEFECT: the bank is left `ULen + 232` bytes long instead of the
     * `ULen - 24` it holds. $2a06 tries to shrink it —
     * Forbid/FreeMem/AllocMem/Permit, the usual free-and-immediately-retake
     * trick — but `movem.l d0-d2/d4-d7/a1-a6,-(a7)` leaves d0 holding
     * XpkUnpackTags' RESULT, so `FreeMem(a1, d0)` is `FreeMem(node, 0)` and
     * frees nothing, and the `AllocMem` that follows returns into d0, which
     * the closing `movem.l (a7)+` immediately overwrites. So the block frees
     * nothing, leaks ULen bytes and the bank keeps every byte of its
     * reservation. Reproduced: the bank really is that long here too, and
     * `Length(n)` will say so.
     *
     * DEFECT: $2a2c is `move.l d7,(a1)`, writing $ffffffd0 — the LVO offset
     * -48 left in d7 by `moveq #$d0,d7` at $29fc — over the bank list node's
     * NEXT link. Two instructions earlier, at $29f2, `move.l (a1),d6` saves
     * that very link, and d6 is never read again; `move.l d6,(a1)` is $2286
     * against the $2287 that is there. NOT reproducible: this port has no
     * list node in front of a bank for it to corrupt.
     */
    'elxpk load'(it) {
      const file = it.evalStr()
      const pw = it.accept(',') ? it.evalStr() : undefined
      const asked = it.accept('to') ? it.evalInt() : 0
      const data = xpkRead(rt, file)
      const out = xpkGuard(rt, () => xpkUnpack(data, pw))
      // Bnk.Reserve's own check, reached with ULen + 256 - 24
      if (out.length + XPK_MARGIN - BANK_NODE <= 0) funcCall()
      const hdr = new DataView(out.buffer, out.byteOffset, out.byteLength)
      const num = asked !== 0 ? asked : out.length >= 12 ? hdr.getUint32(8) : 0
      const flags = out.length >= 14 ? hdr.getUint16(12) : 0
      let name = ''
      for (let i = 16; i < 24 && i < out.length; i++) name += String.fromCharCode(out[i]!)
      rt.reserveBank(num, out.length + XPK_MARGIN - BANK_NODE, name, (flags & 1) !== 0, (flags & 2) !== 0)
      rt.memBanks.get(num)?.data.set(out.subarray(BANK_NODE))
    },

    /**
     * Elxpk Bload FILENAME$ [,PASSWORD$] To ADDR — routines 174 and 175
     * ($2970, $2980), the two shapes that hand routine 176 `d2 = d5 = -1`
     * and an address in a0 instead of a bank number.
     *
     * `tst.l d5 / bmi` at $29ce is what that -1 buys: no Bnk_Reserve, no
     * bank header fixups, just the unpack straight into ADDR.
     *
     * "You must have allocated enough memory for the uncompressed file, plus
     * 256 bytes decompression space", and "Elxpk Bload will transparently
     * load uncrunched data & powerpacked data, but you must still allocate
     * the 256 bytes" — the three stream kinds of the master's probe, all
     * three of which `src/amiga/xpkmaster.ts` handles.
     *
     * NOTE: the 256 bytes are XPK_MARGIN and only the real master needs
     * them, as workspace it decodes through. Nothing here writes past the
     * unpacked length, so a program that under-allocated gets away with it.
     */
    'elxpk bload'(it) {
      const file = it.evalStr()
      const pw = it.accept(',') ? it.evalStr() : undefined
      it.expect('to')
      const addr = it.evalInt()
      const data = xpkRead(rt, file)
      const out = xpkGuard(rt, () => xpkUnpack(data, pw))
      for (let i = 0; i < out.length; i++) {
        const m = rt.resolveWrite(addr + i)
        if (m) m.data[m.off] = out[i]!
      }
    },

    /**
     * Elxpk Save BNKNO To FILENAME$, METHOD$ [,PASSWORD$] — routines 178 and
     * 179 ($2a80, $2a92) into routine 180 ($2a9c).
     *
     *     179  move.l #$8000587e,d7          no password
     *     178  Rbsr routine 1 / d4=(a3)+ +2 / move.l #$80005874,d7
     *     180: d6 = METHOD$, d5 = FILENAME$, d0 = BNKNO
     *          L_Bnk_GetAdr / Rbeq routine 159      bank not reserved
     *          d2 = -$14(a0) + 8                    (length + 16) + 8
     *          d1 = a0 - $18                        the node
     *
     * so it saves the node, the header and the data in one block — see
     * `bankHeaderBytes` for why that is 24 bytes and what is in them.
     *
     * METHOD$ is "the 7 character string. The first 4 letters are then name
     * of the compressor library to use. These are followed by a '.' and a
     * two digit decimal number to indicate the depth of compression". Only
     * NONE is installed, so anything else answers XPKERR_MISSINGLIB (-15)
     * through `Elxpk Error` — which is what a real Amiga with an empty
     * LIBS:Compressors/ does.
     *
     * "You may not save sprite or icon banks with this command" — and they
     * are not in `memBanks` at all, so they read as not reserved.
     *
     * NOTE: "Unlike Elpp Crunch, Elxpk save does not destroy the original
     * copy of the data that your are crunching & saving", which is free
     * here: the packer takes a source and returns a stream.
     */
    'elxpk save'(it) {
      const num = it.evalInt()
      it.expect('to')
      const file = it.evalStr()
      it.expect(',')
      const method = it.evalStr()
      const pw = it.accept(',') ? it.evalStr() : undefined
      const bank = rt.memBanks.get(num)
      if (!bank) throw new AmosError('Bank not reserved', 36)
      const flags = bank.flags | (bank.memType === 1 ? 2 : 0)
      const body = new Uint8Array(BANK_NODE + bank.data.length)
      body.set(bankHeaderBytes(num, flags, bank.name, bank.data.length))
      body.set(bank.data, BANK_NODE)
      const out = xpkGuard(rt, () => xpkPack(body, method, pw))
      if (!rt.vfs?.writeFile(file, out)) throw new AmosError('disc is write protected', 84)
    },

    /**
     * Elxpk Bsave START, LENGTH To FILENAME$, METHOD$ [,PASSWORD$] —
     * routines 181 and 182 ($2ad0, $2ae2) into routine 183 ($2aec), the same
     * password/no-password pair as Save and then four plain pops:
     * METHOD$ into a1, FILENAME$ into a2, LENGTH into d2, START into d1.
     *
     * "The byte at address START is saved. The byte at address END is not,
     * as with the normal AMOS Bsave command" — the guide says END where its
     * own syntax line says LENGTH, and the routine takes a length.
     */
    'elxpk bsave'(it) {
      const start = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect('to')
      const file = it.evalStr()
      it.expect(',')
      const method = it.evalStr()
      const pw = it.accept(',') ? it.evalStr() : undefined
      if (len <= 0) funcCall()
      const src = new Uint8Array(len)
      for (let i = 0; i < len; i++) src[i] = peekByte(rt, start + i)
      const out = xpkGuard(rt, () => xpkPack(src, method, pw))
      if (!rt.vfs?.writeFile(file, out)) throw new AmosError('disc is write protected', 84)
    },

    /**
     * Els Protect FILENAME$,BITS — routine 110 ($208a): routine 1 to
     * null-terminate the name, `cmp.w #$1,d0 / Rbeq routine 3` on an empty
     * one, then dos.library SetProtection (-$ba). A failure is the
     * extension's own message 13, "Set Protection bits failed".
     *
     * "You should not set any of the upper 24 bits of the integer passed to
     * Elsprotect" — and nothing checks, so they go through as given.
     */
    'els protect'(it) {
      const path = it.evalStr()
      if (path === '') funcCall()
      it.expect(',')
      const bits = it.evalInt()
      if (!rt.vfs?.setMeta(path, { protection: bits })) elError(13)
    },

    /**
     * Elreset NUM — routine 108 ($203e). 1..25 (`Rbmi`, `Rbeq`, then
     * `cmp.l #$1a,d0 / Rbcc`), then `$fc + (NUM-1)*16` off a5 — ExtAdr plus
     * FOUR, which is the slot's DEFAULT routine pointer — and `jmp (a0)` if
     * it is not null.
     *
     * "This command will make extension number NUM think that the AMOS
     * 'Default' command has been called, and the extension will reset
     * itself. However the default command is not called, so the screen etc.
     * is not reset." AMCAF's `Extdefault` is the same pointer reached the
     * same way, so this goes through the same `defaults` hook.
     */
    'elreset'(it) {
      const n = it.evalInt()
      if (n <= 0) funcCall()
      if (u32(n) >= 26) funcCall()
      rt.extSlotImpls().get(n)?.defaults?.(rt)
    },

    /**
     * Elraster Wait LINE — routine 107 ($2016), forty bytes and a busy-wait:
     *
     *     move.l (a3)+,d0 / Rbmi routine 3 / cmp.l #$100,d0 / Rbcc routine 3
     *   .a move.b $dff005,d1 / btst #$0,d1 / bne .a     wait out this line
     *   .b move.b $dff006,d1 / cmp.b d1,d0 / bne .b     then wait for LINE
     *
     * so LINE is 0..255 and it spins on VPOSR's low bit and VHPOSR's line
     * byte. DEVIATION: the modelled beam only advances between statements
     * here, so there is nothing to spin on inside a keyword and this waits
     * one frame — the same limit AMCAF's `Raster Wait` carries, and the
     * reason that name is slot-qualified.
     */
    'elraster wait'(it) {
      const line = it.evalInt()
      if (line < 0 || u32(line) >= 0x100) funcCall()
      it.block({ type: 'wait', until: it.tick + 1 })
    },

    /**
     * Elout S$ — routine 122 ($219e): the handle at $94 or message 16, then
     * dos.library Write (-$30) of the string's own bytes, and an io error of
     * -1 is AMOS error 94.
     */
    'elout'(it) {
      it.evalStr()
      elError(16) // 'No STDOUT file handle exists' -- see `elout exists`
    },

    /**
     * Elclose Font FONTID — routine 161 ($2880): walk the chain at $7c for a
     * node whose address is FONTID, unlink it, CloseFont and free. An empty
     * chain, or a FONTID not in it, is AMOS 23 — which is also `Elset
     * Font`'s error, "The parameter you supplied is not a FONTID returned
     * from Elopen Font (Or it has been closed again)".
     */
    'elclose font'(it) {
      const id = it.evalInt()
      const st = rt.easylife
      if (!st.fonts.has(id)) funcCall()
      st.fonts.delete(id)
      st.fontOrder = st.fontOrder.filter((x) => x !== id)
    },
    /**
     * Elclose Fonts — routine 163 ($28e8), the whole chain, and one of the
     * six things the Default command does to EasyLife ("All fonts are
     * unlocked", CommandEffects).
     */
    'elclose fonts': () => {
      rt.easylife.fonts.clear()
      rt.easylife.fontOrder = []
    },
    /**
     * Elset Font FONTID — routine 162 ($28b8): the same chain walk, then the
     * TextFont onto AMOS's own current font. "This command behaves the same
     * as the AMOS 'Set Font' command, except it take a FONTID returned from
     * Elopen Font as a parameter instead of an AMOS font number."
     */
    'elset font'(it) {
      const id = it.evalInt()
      const f = rt.easylife.fonts.get(id)
      if (!f) funcCall()
      rt.screen.rp.font = f
    },

    /**
     * Elmem ADDR,S$ — routine 69 ($1af4). "Only the actual characters in the
     * string are copied - the length does not preceed it as with AMOS strings
     * within the variable buffer, and it is not automatically null terminated
     * like C strings." An empty string writes nothing (`beq.b` on the length).
     */
    'elmem'(it) {
      const addr = it.evalInt()
      it.expect(',')
      writeBytes(rt, addr, it.evalStr())
    },

    /**
     * Els Bank Name BANK,NAME$ — routine 66 ($1a72), the write side of the
     * core's `Bank Name$`. `move.w (a2)+,d0 / cmp.w #$8,d0 / Rbne routine 3`,
     * so the name must be EXACTLY eight characters — "shorter strings should
     * be padded with spaces E.g. Els Bank Name BANK,ElPad Asc(NAME$,32,8)",
     * which is the guide pointing at the keyword slice 3 added. The string is
     * checked BEFORE the bank is looked up, so a bad length beats a missing
     * bank. "Some AMOS commands / programs use the bank name to detect the
     * bank type, so you should be careful"; EasyLife itself does, for message
     * banks and for the Tags bank.
     */
    'els bank name'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      if (name.length !== 8) funcCall()
      const b = rt.memBanks.get(n)
      if (!b) throw new AmosError('Bank not reserved', 36)
      // the eight-character demand above is EasyLife's, and it stays. What is
      // stored is trimmed, like every other bank name here; `Bank Name$` pads
      // it back to the eight this keyword insisted on.
      b.name = name.replace(/\s+$/, '')
    },

    'elmz erase'(it) {
      const group = it.evalInt()
      const { m } = multiZones(rt)
      // freed in ascending slot order, which is the order the 68k finds them
      // — and it decides the free list, so it decides which slot the next
      // `ElMz Set` takes and therefore where `Elmzonen` meets it
      for (let i = 0; i < m.slots.length; i++) {
        const sl = m.slots[i]!
        if (sl.id !== 0 && sl.group === w(group)) freeSlot(m, i)
      }
    },

    /**
     * Elpat Set Case P$ / Elpat Set Nocase P$ — routines 137 ($24be) and 138
     * ($24d4), both over the shared setup at routine 136 ($24a6).
     *
     * Routine 136 opens with `Rbsr routine 139`, so setting a pattern frees
     * whatever was set before without the program asking --- the guide's
     * "You can call El Pat Set Case / El Pat Set Nocase again to change the
     * pattern to match against without calling ElPat Free first".
     *
     * "These commands check the validity of the pattern, and compile it to
     * the internal format", which is why an unparseable pattern raises here
     * rather than at the first `Elpat Def`.
     */
    'elpat set case'(it) {
      rt.easylife.patDefault = null
      rt.easylife.patDefault = patParse(it.evalStr(), false)
    },
    'elpat set nocase'(it) {
      rt.easylife.patDefault = null
      rt.easylife.patDefault = patParse(it.evalStr(), true)
    },
    /**
     * Elpat Free — routine 139 ($24ea). Clears `$98` before freeing, so a
     * second call is harmless and `Elpat Def` afterwards is message 19.
     *
     * "ElPat Free is also Called Implicilty by other AMOS commands": routine
     * 0's Default hook at $124c calls it, which is why the state does not
     * survive into the next program.
     */
    'elpat free'() {
      rt.easylife.patDefault = null
    },

    /**
     * Elzqzqzq and Elqqzqzqq — 1.44 only: 1.44's routine 133 ($1bda) and
     * 1.44's routine 132 ($1bd8). Each is TWO BYTES: `rts`.
     *
     * They are not junk table entries of the kind #117 removed. Those had no
     * routine behind them; these have a name, a parameter spec, an
     * instruction index and a jump-table slot pointing at real code that
     * happens to do nothing. `Elzqzqzq` is `I0,0t0,0` — four numeric
     * arguments with a `To` in the middle — and `Elqqzqzqq` is
     * `I0,0,0,0t0,0`, six. They sit on the ids 1.10 gave `Tag Str$` and its
     * neighbour, so the table was rebuilt around them, and the names read
     * like a keyboard mash because that is what an author types into a slot
     * being held open.
     *
     * So the faithful implementation is the faithful one: take the
     * arguments, do nothing with them, return. Not n/a — an n/a keyword has
     * no handler, and this one has a routine that can be read.
     *
     * NOTE: `rts` does not pop the parameter stack the way every other
     * routine here does, so on the real machine a3 is left four (or six)
     * longwords deep. Nothing in this port has a parameter stack to leak.
     */
    elzqzqzq(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect('to')
      it.evalInt()
      it.expect(',')
      it.evalInt()
    },
    elqqzqzqq(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect('to')
      it.evalInt()
      it.expect(',')
      it.evalInt()
    },
    /**
     * Tag Keep True / Tag Keep False — routine 216 ($2f64), which stores the
     * whole longword into `$ca` without narrowing it, so anything non-zero is
     * True. It picks where `Tag Str$` puts its string: with the object (only
     * disposed of when the object is), or "in a temporary buffer, which is
     * erased the next time any command, or function which accepts a taglist
     * as an argument is used".
     */
    'tag keep'(it) {
      rt.easylife.tagKeep = it.evalInt() | 0
    },
    /**
     * Tag Block Size N — routine 226 ($30f4). Three refusals, all AMOS 23:
     * once a pool block exists (`move.l $be(a0),d0 / Rbeq routine 3` — note
     * the sense, it is the ALREADY-ALLOCATED case that passes the test and
     * falls into the error), below $1000, and at or above $40001. Only then
     * does it write `$ba`.
     */
    'tag block size'(it) {
      const n = it.evalInt() | 0
      if (rt.easylife.tagPool.length !== 0) funcCall()
      if (n < 0x1000) funcCall()
      if (n >= 0x40001) funcCall()
      rt.easylife.tagBlockSize = n
    },


    // ---- MUI, routines 205-237 ---------------------------------------------

    /**
     * Mui Begin TRUE/FALSE — routine 217 ($2f70).
     *
     * Takes the node keyed by the counter, saves the current `Tag Keep` in
     * its `$18`, sets the new one, and counts the counter DOWN. So every
     * `Tag Str` between here and the next `Mui New` files its string under a
     * key that does not exist yet, and routine 232 hands the whole lot to the
     * object once it does. "Calls to Mui Begin can be nested arbitrarily
     * deep" is that counter and nothing else.
     */
    'mui begin'(it): void {
      const reg = rt.easylife.mui
      muiFind(reg, reg.pending, true)!.savedKeep = rt.easylife.tagKeep
      rt.easylife.tagKeep = it.evalInt() | 0
      reg.pending--
    },
    /**
     * Mui Dispose OBJECT — routine 222 ($3016).
     *
     * Refuses a child (`move.l $1c(a2),d1 / Rbne routine 3`) because MUI
     * disposes those with their parent; forgets the application object if
     * that is what this was; `MUI_DisposeObject` at LVO -36; then routine 241
     * over the node, which frees the subtree's strings.
     */
    'mui dispose'(it): void {
      const { obj, node } = muiObj(rt, it.evalInt() | 0)
      if (node.attached) funcCall()
      const reg = rt.easylife.mui
      if (reg.app === obj) reg.app = null
      rt.mui.disposeObject(obj)
      muiFlushNode(rt, obj.address)
    },
    /**
     * Mui Set OBJECT,TAG$,VALUE — routines 205 and 206 ($2da6, $2db4).
     *
     * MUIM_Set ($8042549a) rather than OM_SET, which is why routine 206's
     * inline message at $2dda is three longwords — method, attribute, value —
     * instead of a taglist.
     */
    'mui set'(it): void {
      const obj = muiObj(rt, it.evalInt() | 0).obj
      const tag = muiTagArg(rt, it)
      it.expect(',')
      rt.mui.set(obj, tag, it.evalInt() | 0)
    },
    /**
     * Mui Set Str OBJECT,TAG$,STRING$ — routines 211 and 212 ($2e4c, $2e5a).
     *
     * The string has to outlive the statement, so it goes into the tag pool
     * exactly as `Tag Str` puts it there and the attribute is set to its
     * address. With `Tag Keep` on, the old value is read back with GetAttr
     * first and freed if it was one of ours (routine 242) — "if the old
     * setting of the tag that is being changed is recognised as a stored
     * string, it is deallocated first".
     */
    'mui set str'(it): void {
      const key = it.evalInt() | 0
      const obj = muiObj(rt, key).obj
      const tag = muiTagArg(rt, it)
      it.expect(',')
      const s = str(it.evalExpr())
      if (rt.easylife.tagKeep !== 0) {
        const old = rt.mui.get(obj, tag) ?? 0
        if (old !== 0 && rt.easylife.tagStrings.has(old)) muiDropString(rt, key, old)
      }
      rt.mui.set(obj, tag, tagStore(rt, s, key, true))
    },
    /**
     * Mui Do OBJECT,TAGLIST$ / =Mui Fn(OBJECT,TAGLIST$) — routine 213 ($2eca),
     * one routine for both.
     *
     * The taglist string IS the message: its first longword is the MUIM_ id
     * and the rest are that method's parameters, which is why the guide warns
     * "these taglists to not obey the rule of tags occuring in pairs, and
     * order is usually important" --- its typos, kept, because a quote that
     * has been tidied cannot be checked against the file it came from. Routine 241 on the temporary node
     * afterwards, so a `Tag Str$` built for the call is freed by it.
     */
    'mui do'(it): void {
      const obj = muiObj(rt, it.evalInt() | 0).obj
      it.expect(',')
      muiDoMethod(rt, obj, str(it.evalExpr()))
    },
    /**
     * Mui Notify OBJECT,TAG$,VALUE To DEST,TAGLIST$ — routines 214 and 215
     * ($2ef2, $2f04).
     *
     * A specialised `Mui Do`: routine 215 builds MUIP_Notify by hand, and the
     * order it writes the fields in is what confirms the struct —
     * FollowParams count at `$10`, DestObj at `$c`, TrigVal at `$8`, TrigAttr
     * at `$4`, MUIM_Notify at `$0`. "Unlike when creating MUIM_Notify
     * taglists by hand, you do not have to include the length of the TAGLIST$
     * anywhere in the arguments" is that count, which EasyLife computes.
     */
    'mui notify'(it): void {
      const obj = muiObj(rt, it.evalInt() | 0).obj
      const tag = muiTagArg(rt, it)
      it.expect(',')
      const value = it.evalInt() | 0
      it.expect('to')
      const dest = it.evalInt() | 0
      it.expect(',')
      const params = longsOf(str(it.evalExpr()))
      rt.mui.doMui(obj, MUI.MUIM_Notify, [tag, value, dest, ...params])
      muiFlushNode(rt, 0)
    },
    /**
     * Mui Flush OBJECT — routine 227 ($311c).
     *
     * "Erases from memory all strings attached to an OBJECT, without
     * disposing of the OBJECT", then re-registers the object so it can own
     * strings again — the `moveq #$ff,d4 / Rbra routine 238` tail.
     *
     * NOTE: the routine pops the object into d6 and then calls routine 241,
     * which selects its node by d0 — a register nothing on this path writes.
     * So the machine frees whatever node d0 happened to name and leaves the
     * object's strings alone, which is not what the guide describes. It
     * cannot be reproduced either: there are no 68k registers here, so
     * whatever d0 held has no value to stand in for it. The documented
     * behaviour is implemented and the discrepancy recorded, rather than a
     * guess at what a stale register would have selected.
     */
    'mui flush'(it): void {
      const key = it.evalInt() | 0
      muiObj(rt, key)
      muiFlushNode(rt, key)
      muiFind(rt.easylife.mui, key, true)
    },
    /**
     * Mui Add CHILD To PARENT / Mui Remove CHILD To PARENT — routines 236 and
     * 237 ($329a, $32e0), OM_ADDMEMBER ($109) and OM_REMMEMBER ($10a) with
     * EasyLife's own chain kept alongside.
     *
     * Both resolve CHILD first and PARENT second. Add refuses an object that
     * is already in the tree, and Remove refuses one that is not a child of
     * the parent named — both Illegal Function Call.
     */
    'mui add'(it): void {
      const child = muiObj(rt, it.evalInt() | 0)
      it.expect('to')
      const parent = muiObj(rt, it.evalInt() | 0)
      if (!muiAttach(parent.node, child.node)) funcCall()
      rt.mui.addMember(parent.obj, child.obj)
    },
    'mui remove'(it): void {
      const child = muiObj(rt, it.evalInt() | 0)
      it.expect('to')
      const parent = muiObj(rt, it.evalInt() | 0)
      if (!muiDetach(parent.node, child.node)) funcCall()
      rt.mui.remMember(parent.obj, child.obj)
    },

    // ---- structured variables, routines 262-295 ----------------------------

    /**
     * St Free INSTANCE — routine 262 ($37b8), `ELST_Free`.
     *
     * Returns the memory to the pool, not to the system: "This command does
     * not return any memory to the system - it simply frees it for use by
     * other structured variable instances." The reuse that follows is
     * modelled, because the guide's warning about dangling pointers is only
     * meaningful if it is.
     */
    'st free'(it) {
      const inst = it.evalInt() | 0
      stCall(() => freeInstance(rt, rt.easylife.structs, inst))
    },
    /**
     * St Save FILENAME$, INSTANCE — routine 265 ($3814), `ELST_SaveTree`.
     *
     * Saves the instance and then everything reachable from it by following
     * pointer elements, cycles included. The file is `"ElSt"`, a count, a
     * reserved longword, and then per instance its address at save time
     * followed by its bytes.
     */
    'st save'(it) {
      const file = it.evalStr()
      it.expect(',')
      const inst = it.evalInt() | 0
      const out = stCall(() => saveTree(rt, inst))
      if (!rt.vfs?.writeFile(file, out)) throw new AmosError('disc is write protected', 84)
    },
    /**
     * St Free All — routine 266 ($3834), `ELST_FreeBlocks(0)`.
     *
     * The one keyword that does give the memory back: it walks the block
     * chain FreeMem-ing each and zeroes the count, the chain and the cached
     * table pointer.
     */
    'st free all'() {
      freeBlocks(rt.easylife.structs)
    },
    /**
     * St Copy INSTANCE1 To INSTANCE2 — routine 268 ($387a).
     *
     * Both must already exist and both must be the same type: the
     * destination's type word is looked up for the size and then compared
     * with the source's, `cmp.w (a1),d3 / Rbne routine 3`.
     *
     * NOTE: routine 3 is `moveq #$17,d0 / Rjmp L_Error`, AMOS 23 "Illegal
     * function call". Message 39, "Cannot copy between structures of
     * different types", is in the extension's own table and nothing raises
     * it — one of four dead entries, with 30, 37 and 38.
     *
     * `addq.l #$4,a0 / addq.l #$4,a1 / subq.l #$2,d0` skips the four-byte
     * header on both sides and moves `size - 4` bytes, so the destination
     * keeps its own type and flags words.
     */
    'st copy'(it) {
      const src = it.evalInt() | 0
      it.expect('to')
      const dst = it.evalInt() | 0
      stCall(() => {
        const bank = typeTable(rt)
        const type = elstReadWord(rt, dst)
        const size = structDef(bank, lookup(bank, type, 0)).size
        if (elstReadWord(rt, src) !== type) funcCall()
        for (let i = 4; i < size; i++) {
          const m = rt.resolveWrite(dst + i)
          if (m) m.data[m.off] = peekByte(rt, src + i)
        }
      })
    },
    /**
     * St Input INSTANCE, STRING$ — routine 269 ($38b4), the inverse of
     * `St Output$`.
     *
     * Its two checks are real and are implemented: the string's first word
     * must equal the instance's type (message 41, "Input string is of wrong
     * type") and its length must equal the definition's size (message 40,
     * "Input string is of wrong length"). They are the only two places in the
     * whole ST block that raise a message the extension owns.
     *
     * DEFECT: `$38ba` is `305b`, `movea.w (a3)+,a0` — the instance address is
     * taken as a sign-extended WORD, so the high half of the pushed longword
     * becomes the whole pointer and AMOS's parameter stack is left two bytes
     * out of step for the rest of the statement. Routine 270 pops the same
     * argument with `205b`, `movea.l`. 1.09 has the identical byte, so it is
     * not a 1.10 regression. Not reproducible: the port has no a3 to desync
     * and a truncated address addresses nothing.
     */
    'st input'(it) {
      const inst = it.evalInt() | 0
      it.expect(',')
      const s = it.evalStr()
      stCall(() => {
        const bank = typeTable(rt)
        const type = elstReadWord(rt, inst)
        if (((s.charCodeAt(0) & 0xff) << 8) + (s.charCodeAt(1) & 0xff) !== type) elError(41)
        const size = structDef(bank, lookup(bank, type, 0)).size
        if (s.length !== size) elError(40)
        putInstanceBytes(rt, inst, s)
      })
    },
    /**
     * St Set INSTANCE, ELEMENT [,I1[,I2[,I3]]] To VALUE — routines
     * 282/284/286/288, `ELST_SetElement`.
     */
    'st set'(it) {
      stSet(rt, it, false)
    },
    /**
     * St Set Str INSTANCE, ELEMENT [,I1[,I2[,I3]]] To STRING$ — the same four
     * routines, reached through the token entries whose value slot is a
     * string rather than an integer. One body, and the type code in the
     * descriptor decides which arm runs, so `St Set Str` on a non-string
     * element and `St Set` on a string one both land where the other's arm
     * would have.
     */
    'st set str'(it) {
      stSet(rt, it, true)
    },
    /**
     * Stv(INSTANCE, ELEMENT [,I1[,I2[,I3]]]) = VALUE — the write half of the
     * V-form, and the one place in this extension where the binary says
     * something the port cannot carry over.
     *
     * 1.10 gives `stv` four instruction slots of its own, 281/283/285/287,
     * and each is FOUR BYTES sitting immediately in front of the `St Set`
     * body of the matching arity, which it then falls into. All four hold the
     * same instruction:
     *
     *     $39a6  4eac 3e2c     jsr $3e2c(a4)
     *
     * NOTE: that cannot be what it looks like. a4 has no value at a keyword's
     * entry — the only three routines in the whole 16KB that load it (0, 184
     * and 225) do so locally — and $3e2c is inside routine 300's inline
     * message block, not code. 1.09 has neither `stv` nor the four extra
     * routines: its set family is 281-284 with no prologue, byte for byte the
     * same forty-byte bodies. So the keyword was added in 1.10, is in no
     * guide, and its write path begins with a call through an undefined
     * register.
     *
     * What is NOT in doubt is where control goes next: the four bytes fall
     * straight into `St Set`'s body, and the read half is `St Get`'s
     * trampolines verbatim. Implemented as that pair.
     */
    stv(it) {
      it.expect('(')
      const inst = it.evalInt() | 0
      it.expect(',')
      const elem = it.evalInt() | 0
      const idx: number[] = []
      while (it.accept(',')) idx.push(it.evalInt() | 0)
      it.expect(')')
      it.expectOp('=')
      const value = it.evalInt() | 0
      stCall(() => setElement(rt, resolve(rt, elem, inst, idx.slice().reverse()), value))
    },
    /**
     * St Erase INSTANCE — routine 295 ($3ab2), the library's LVO -108
     * ($97a): `ELST_TreeScan`, `ELST_Free` over every instance the scan
     * found, `ELST_TreeScanFree`. The autodoc lists the LVO without naming
     * it, and this keyword is what it is for.
     */
    'st erase'(it) {
      const inst = it.evalInt() | 0
      stCall(() => eraseTree(rt, rt.easylife.structs, inst))
    },

    /**
     * Eltest(A,B)=V — 1.09 only: 1.09's routine 255 ($372a), EIGHT BYTES.
     *
     *     moveq #$1,d0 / lea $c(a3),a3 / rts
     *
     * The write half of the author's probe. `lea $c(a3),a3` pops three
     * longwords, which is exactly right for the assignment form — two
     * arguments and a value — so unlike its function half this one leaves
     * AMOS's parameter stack where it found it. `moveq #$1,d0` is the only
     * thing that distinguishes it from routine 256's `moveq #$0,d0`, and
     * nothing reads d0 back from an instruction.
     *
     * So the faithful implementation is the faithful one, as it was for
     * 1.44's Elzqzqzq: take the arguments, do nothing, return. Not n/a — an
     * n/a keyword has no handler, and this has a routine that can be read.
     */
    eltest(it) {
      it.expect('(')
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect(')')
      it.expectOp('=')
      it.evalInt()
    },
  }
}

/**
 * Routine 101 ($1ec8) — find a group inside a zone bank.
 *
 *     move.l d7,d4 / Rbeq routine 3            group 0 is AMOS 23
 *     move.l d6,d0 / Rjsr L_Bnk_GetAdr
 *     Rbeq routine 159                         no such bank is error 36
 *     cmp.l (a0),d4 / beq / Rbcc routine 3     group past the count is 23
 *     asl.w #$2,d4 / adda.l (a0,d4.l),a0
 *     move.w (a0)+,d5                          the group's zone count
 *
 * so the bank is a longword group count, a longword offset per group, and at
 * each offset a word count followed by that many eight-byte records.
 *
 * NOTE: the guide documents a "Not a Zone Bank" error — "Zone banks are
 * identified by them having the name 'Zones   '" — and the routine never
 * looks at the name. `L_Bnk_GetAdr` is called with the bank number alone and
 * nothing else is checked, so any bank whose first longword is a plausible
 * group count is accepted. The message is not in the extension's own error
 * table either. Compare routine 203, which DOES check a bank name ("Tags    ")
 * for the taglist keywords, so the omission here is not the author's habit.
 */
function zoneBankGroup(rt: Runtime, bank: number, group: number): Array<Zone | null> {
  if (group === 0) funcCall()
  const b = rt.memBanks.get(bank)
  if (!b) throw new AmosError('Bank not reserved', 36)
  const v = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength)
  const groups = v.getUint32(0, false)
  if (u32(group) > groups) funcCall()
  const off = v.getUint32(group * 4, false)
  const count = v.getUint16(off, false)
  const zones: Array<Zone | null> = []
  for (let i = 0; i < count; i++) {
    const at = off + 2 + i * 8
    zones.push({
      x1: v.getUint16(at, false),
      y1: v.getUint16(at + 2, false),
      x2: v.getUint16(at + 4, false),
      y2: v.getUint16(at + 6, false),
    })
  }
  return zones
}
