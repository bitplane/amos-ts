/**
 * The GUI extension by Pietro Ghizzoni, all three releases, 355 keywords.
 *
 * A GadToolsBox interface saved as an AMOS bank, opened as intuition windows
 * with gadtools gadgets in them, plus screens, requesters, AppIcons, a
 * clipboard, DOS notification, locale catalogs and a TCP group. See
 * ./guibank.ts for the format the designs arrive in and ./guistate.ts for
 * what a window is here.
 *
 * ## One port, three tables
 *
 * 48 keywords in the 1.5 beta, 103 in 1.61, 204 in 2.10, and they are one
 * extension rather than three: 45 of the beta's names survive into 1.61
 * unchanged and 85 of 1.61's into 2.10. So one body of code serves all three
 * and `GuiState.release` marks the places they part, the bank layout,
 * eight arities, `Gui Close`'s last code, `Gui Wait`'s idle answer, and the
 * three keywords whose meaning moved under their own name (`Gui Iconify`,
 * `Gui Uniconify`, `Tcp Open`). Everywhere else the releases agree and the
 * code says so by not asking.
 *
 * 1.62 is not a fourth. Its token table is byte-identical to 1.61's, which is
 * what makes them one library here, and it is the build whose guide and demos
 * survive.
 *
 * ## Evidence
 *
 * `GUI2.guide` for 2.10, which documents 202 of its 204 keywords, and
 * `GUI.guide`, shipped with 1.62, for the 1.6 line, which documents 72
 * nodes and not one of the twenty-one `Tcp` keywords. `AMOSPro_GUI.Doc` is
 * the beta's own, 18KB of it, and it names GUI ELLIPSE over a keyword the
 * token table calls `gui circle`. Then `AMOSPro_GUI.Lib` wherever those are
 * silent or wrong, which is often enough to matter: the guides put one
 * argument on `Gui Sx` where 2.10 takes two, and call `Gui Asl Font` a font
 * name where 1.61 returns a boolean.
 *
 * Three of the extension's own tools are shipped as AMOS programs and
 * detokenise, which puts the bank format at the top tier rather than the
 * bottom: `GuiConv.asc` is the 1.5 converter in plain text, `GuiConv.Amos`
 * the 1.64 and the 2.3, and `RTGBob.Amos` settles the format `Gui Remap`
 * reads. Every code these answer is quoted at the keyword that answers it.
 *
 * ## What is state and what is pixels
 *
 * Windows and screens carry a RastPort, so the pastes, the lines, the IFF
 * display and the screen copies all really draw. What
 * a program does NOT get is a window rendered by gadtools: the gadgets are
 * read, laid out and answered for, and nothing paints their frames.
 *
 * ## The three libraries that are not here
 *
 * `xfa.library` (the nine `Xfa` keywords and `Gui Save Iff`),
 * `amigaguide.library` (`Gui Guide`) and `bsdsocket.library` (2.10's eighteen
 * `Tcp` ones) are not modelled, and none of the three is in the corpus.
 * Every one of those keywords takes the branch the routine takes on a
 * machine without the library, which is a real path the extension carries
 * error strings for rather than a stub. A host capability for any of the
 * three would light its keywords up without changing them.
 *
 * 1.61's TCP group is not among them. It is AmigaDOS: `Tcp Open` prepends
 * `TCP:` to a name and hands it to dos Open, so the network is a HANDLER and
 * everything above it is file I/O, which this port has. Only the prefixed
 * open fails here, and it fails the way it fails on any machine with no stack
 * mounted.
 */
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { GUI_BANK_VERSIONS, readGuiBank } from './guibank'
import { GUI_CENTRE_X, GUI_CENTRE_Y, GUI_EVENT, GUI_MAX_ZONES, GUI_OS_VERSION, GUI_TITLE_MAX, GuiState, PAL_MONITOR_ID, PUB_SCREENS, TCP_CHANNELS, TOPAZ_SIZE, defaultPalette, depthForColours, expand12, guiScale, guiScaleRor, newScreenPort, newWindowPort, packMenuNumber } from './guistate'
import type { GuiScreen } from './guistate'
import type { RastPort } from '../amiga/graphics'
import { encode, rowBytesFor } from '../amiga/planar'
import { parseIlbm } from '../amiga/ilbm'
import type { ObjectBank } from './objects'
import { AMOS_KIND_INTEGER, AMOS_KIND_STRING } from './guikinds'
import type { GuiChannel, GuiEvent, GuiSocket, GuiWindow } from './guistate'
import type { Gui, GuiGadget, GuiRelease } from './guibank'
import { drawBevelBox, KIND, MENU_FLAG, PEN, type DrawInfo, type MenuStrip } from '../amiga/gadtools'
import { TITLE_HEIGHT, WB_DISPLAY_Y, WB_HEIGHT, WB_WIDTH, WBORBOTTOM, WBORLEFT, WBORRIGHT } from '../amiga/intuition'
import type { Interp } from '../interp/interp'
import { finishRequester, startRequester, type RequesterSpec } from './requester'
import { getCatalogStr, parseCatalog } from '../amiga/localelib'
import { VBL_HZ } from '../amiga/paula'

export function newGuiState(release: GuiRelease = '2.10'): GuiState {
  const g = new GuiState()
  g.release = release
  return g
}

/**
 * Which GUI the program bound, from the slot the loader identified.
 *
 * All three releases recommend slot 24 and nothing but the token table tells
 * them apart, so this reads the identity rather than the slot, the same
 * shape as jdprt.ts's `isPre14`, and for the same reason. Nothing bound is
 * 2.10, which is what a Runtime built without bindings gets and what every
 * test that does not say otherwise means.
 */
export function guiRelease(rt: Runtime): GuiRelease {
  for (const def of rt.extBindings?.values() ?? []) {
    if (def.id === 'gui-1.5b') return '1.5b'
    if (def.id === 'gui-1.61') return '1.6x'
  }
  return '2.10'
}

/**
 * The extension's own error messages, packed NUL-separated at $7952 and
 * indexed zero-based by d0 through `L_ErrorExt`. See
 * `./extimpl.ts`'s `errors` for how that call works.
 *
 * Thirty-five of them, and the list is the only place several of this
 * extension's rules are written down at all: the guide never says that
 * drawing before `Gui Gfx` is an error, or that a bank has to be NAMED "Gui",
 * or that `Gui Range` refuses a gadget that is not an integer or a string.
 * Every one of those is a message here and a branch in the code that raises
 * it.
 *
 * Spelling and punctuation are the author's. "This isn't a Integer/String
 * Gadget" is his article, and the three exclamation marks are his too.
 */
export const GUI_ERRORS = [
  'Program Interrupted',
  'Unable to open window',
  'Gadget not defined',
  'Gui not defined',
  'Gui already used',
  'Bank not reserved',
  'Not a Gui bank',
  'Gui not open',
  'Window already open',
  'Illegal gadget value',
  'Window not open',
  'Gfx output not defined',
  'Image not reserved',
  'Asl.library not found!',
  'Illegal screen parameter',
  'Screen already open',
  'Unable to open screen',
  'Screen not opened',
  'Wrong GUI bank version. Use the GUI converter 2.3',
  "This isn't a Integer/String Gadget",
  'Socket not opened!',
  'Unable to send packet',
  'Unable to open file',
  'Channel already used!',
  'Not enough memory!',
  'Unable to open AppIcon',
  'Unable to display picture',
  'xfa.library not available',
  'Unable to load xfa file',
  'Unable to allocate xfa frames',
  'Unable to play xfa anim',
  'Bobs bank not reserved',
  'Zone not reserved',
  'Illegal number of zones',
  'Illegal function call',
] as const

/**
 * 1.61's, which is 2.10's first twenty-four with two words changed.
 *
 * At $1f5c of `amospro_gui.lib`, packed the same way and indexed the same
 * way. The two that moved say what happened to the extension in between: the
 * bank version error names the converter that release wants, 1.63 against
 * 2.3, and 2.10's "Socket not opened!" is 1.61's "Channel not opened!"
 * because 1.61's TCP group is not sockets at all. Nothing after 23 exists,
 * so an error 24 or above cannot be raised on this release.
 */
export const GUI_ERRORS_161 = [
  ...GUI_ERRORS.slice(0, 18),
  'Wrong GUI bank version. Use the GUI converter 1.63',
  GUI_ERRORS[19],
  'Channel not opened!',
  ...GUI_ERRORS.slice(21, 24),
] as readonly string[]

/**
 * 1.5b's fourteen, at $1fc0 of its `AMOSPro_GUI.Lib`.
 *
 * Error 0 is `AMIGA RULEZ!`, where the two later releases say "Program
 * Interrupted", and 13 is `asl.library not found!` against their
 * "Asl.library not found!". Both are the author's and neither is tidied: the
 * placeholder is evidence that this release never raises 0, since a beta that
 * did would have shown the user that string.
 */
export const GUI_ERRORS_15B = [
  'AMIGA RULEZ!',
  ...GUI_ERRORS.slice(1, 13),
  'asl.library not found!',
] as readonly string[]

/** the table the bound release indexes, for the errors whose text moved */
function errorsFor(release: GuiRelease): readonly string[] {
  return release === '1.5b' ? GUI_ERRORS_15B : release === '1.6x' ? GUI_ERRORS_161 : GUI_ERRORS
}

/** the indices this file raises, named where a bare number would not read */
export const GUI_ERR = {
  BANK_NOT_RESERVED: 5,
  NOT_A_GUI_BANK: 6,
  ILLEGAL_GADGET_VALUE: 9,
  WINDOW_NOT_OPEN: 10,
  GFX_NOT_DEFINED: 11,
  NOT_AN_INPUT_GADGET: 19,
  GADGET_NOT_DEFINED: 2,
  SCREEN_NOT_OPENED: 17,
  ZONE_NOT_RESERVED: 32,
  ILLEGAL_NUMBER_OF_ZONES: 33,
  ILLEGAL_FUNCTION_CALL: 34,
  ILLEGAL_SCREEN_PARAMETER: 14,
  SCREEN_ALREADY_OPEN: 15,
  SOCKET_NOT_OPENED: 20,
  GUI_NOT_DEFINED: 3,
  GUI_NOT_OPEN: 7,
  UNABLE_TO_OPEN_FILE: 22,
  XFA_NOT_AVAILABLE: 27,
  IMAGE_NOT_RESERVED: 12,
  UNABLE_TO_DISPLAY: 26,
  BOBS_BANK_NOT_RESERVED: 31,
  WRONG_BANK_VERSION: 18,
  CHANNEL_NOT_OPENED: 20,
  UNABLE_TO_SEND_PACKET: 21,
  CHANNEL_ALREADY_USED: 23,
} as const

/** raise one, the way `L_ErrorExt` does: every extension error is trappable */
function guiError(n: number): never {
  throw new AmosError(GUI_ERRORS[n] ?? `GUI error ${n}`)
}

/** the same, where the bound release spells the message differently */
function guiErrorOn(g: GuiState, n: number): never {
  throw new AmosError(errorsFor(g.release)[n] ?? `GUI error ${n}`)
}

/**
 * Read the bank the state is pointed at, once.
 *
 * The guide has `Gui Bank` name it and `Gui Open`'s third argument switch it,
 * and neither is documented as loading anything: the program has already done
 * `Load "x.abk"` and the bank is simply there. So this looks it up when a
 * design is first wanted and again whenever the number changes.
 */
function designs(rt: Runtime, s: GuiState): void {
  const bank = rt.memBanks.get(s.bank)
  s.designs = bank === undefined ? [] : readGuiBank(bank.data, s.release)
}

/**
 * "Wrong GUI bank version", where the release has a version to be wrong.
 *
 * `cmpi.w #$28,$30(a4) / bne` at 2.10's $55a8, `#$13` at 1.61's $21a2. It sits
 * AFTER the arm that puts an already-open window to front and after the
 * already-used check, and before anything is allocated, so a program that
 * reopens a window never reaches it and a wrong version costs nothing. 1.5b
 * has no version word and makes no check, which is the null row.
 *
 * See GUI_BANK_VERSIONS for why the 1.6x row is a range.
 */
function checkBankVersion(g: GuiState, win: number, index: number): void {
  const allowed = GUI_BANK_VERSIONS[g.release]
  if (allowed === null || g.windows.has(win)) return
  const design = g.designs[index]
  if (design === undefined) return
  if (design.version < allowed.min || design.version > allowed.max) {
    guiErrorOn(g, GUI_ERR.WRONG_BANK_VERSION)
  }
}

/**
 * `Gui Uniconify window` on the two earlier releases puts a rolled-up window
 * back.
 *
 * Routine 52 makes the same height test `Gui Iconify` makes, the other way
 * round: `cmp.w $a(a2),d0 / bne` at $1688 does nothing unless the window IS
 * rolled up. Then MoveWindow to the saved LeftEdge and TopEdge and a resize to
 * the saved Width and Height, in that order.
 *
 * 2.10's `Gui Uniconify` takes an iconify ID and reopens a window it closed,
 * so the two share a name and nothing else.
 */
function uniconifyBeta(g: GuiState, n: number): void {
  const w = windowOf(g, n)
  if (w.height !== TITLE_HEIGHT) return
  const box = g.iconBoxes.get(w.gui)
  if (box === undefined) return
  w.left = box[0]
  w.top = box[1]
  resizeWindow(w, box[2], box[3])
}

/**
 * `Gui Screen Open number,width,height,depth,modes`. 1.5b's five-argument
 * form, and why 1.61 has no screen keywords at all.
 *
 * Routine 38 fills four words of a NewScreen at `$fc` of the state and calls
 * OpenScreen (-$c6). Nothing keeps the result: `movem.l (a7)+,a3-a6 / rts`
 * follows the call, d0 is dropped, and the beta has no `Gui Screen Close`, no
 * `Gui Screen Width` and no working `Gui Gfx 1,n`, its own doc says
 * "screen ( NO YET IMPLEMENTED! )" against that argument. So a screen this
 * opens cannot be reached again by any keyword the beta has.
 *
 * DEFECT: `bset.b d0,d1` at $c84 puts `1 << n` into ns_Depth, where the field
 * wants n. A program asking for 4 gets sixteen bitplanes and OpenScreen
 * refuses it; only 0, 1, 2 and 3 land on a legal depth, and they land on 1, 2,
 * 4 and 8 planes rather than on the 1, 2, 3 and 4 that were asked for. The
 * keyword is gone by 1.61 and back in 2.10 computing the depth from a COLOUR
 * count instead.
 */
function screenOpenBeta(g: GuiState, it: Interp): void {
  const n = it.evalInt()
  it.expect(',')
  const width = it.evalInt()
  it.expect(',')
  const height = it.evalInt()
  it.expect(',')
  const depth = (1 << (it.evalInt() & 31)) & 0xffff
  it.expect(',')
  const modeID = it.evalInt()
  // OpenScreen fails for a depth outside 1..8, and the failure is the whole of
  // what a program can see here: nothing is stored either way
  if (depth < 1 || depth > 8) return
  g.screens.set(n, {
    number: n,
    width,
    height,
    depth,
    modeID,
    name: '',
    fontName: '',
    fontSize: TOPAZ_SIZE,
    left: 0,
    top: 0,
    showTitle: true,
    isPublic: false,
    palette: defaultPalette(depth),
    rp: newScreenPort(width, height, depth),
    cloned: false,
  })
}

/**
 * Where 1.61's `Tcp Open` and `Tcp F Open` hand back their file handles.
 *
 * DEVIATION: the machine's answer is a BPTR out of dos Open, and nothing in
 * this port has one. GuiNet.Amos shows what a program does with it: `If
 * AMINET` and nothing else. So what has to survive is that a success is
 * non-zero, that a failure is zero, and that two channels do not collide. Four
 * apart, because a BPTR is a longword address shifted down by two.
 */
const TCP_HANDLE_ORIGIN = 0x7c80_0000

/** `moveq #$52,d2` in routine 83, ACTION_READ, dp_Type of an async read */
const ACTION_READ = 82
/** `moveq #$57,d2` in routines 79 and 80, ACTION_WRITE */
const ACTION_WRITE = 87

/**
 * One of the fifty channels, or "Channel not opened!".
 *
 * Routine 115 and the four that inline the same three instructions all load
 * `moveq #$14,d7` first and raise it on a zero entry. See TCP_CHANNELS for the
 * bounds check the machine does not make and this does.
 */
function channelOf(g: GuiState, n: number): GuiChannel {
  const c = n >= 0 && n < TCP_CHANNELS ? g.channels.get(n) : undefined
  return c ?? guiErrorOn(g, GUI_ERR.CHANNEL_NOT_OPENED)
}

/**
 * `Tcp Open` and `Tcp F Open`, which are one routine and one flag.
 *
 * Routine 116 builds the name, `move.l #$5443503a,(a0)+` writes "TCP:" when
 * d2 is set, and `Tcp F Open` passes zero, and calls dos Open with `move.l
 * #$3ec,d2`, MODE_OLDFILE. So neither can CREATE a file: GuiNet.Amos's
 * `Tcp F Open(2,"Ram:Recent.html")` returns 0 on a machine where that file is
 * not already there, and the demo's own banner says "the TCP commands are
 * under development! This is only a preview!"
 *
 * A channel that is already open is error 23, "Channel already used!", tested
 * before the name is even built.
 */
function tcpOpen(rt: Runtime, g: GuiState, n: number, name: string, prefix: boolean): number {
  if (n < 0 || n >= TCP_CHANNELS) return 0
  if (g.channels.has(n)) guiErrorOn(g, GUI_ERR.CHANNEL_ALREADY_USED)
  const path = prefix ? `TCP:${name}` : name
  // DEVIATION: `TCP:` is AmiTCP's handler and there is no network under this
  // port, so the prefixed form always fails here, which is what it does on
  // any machine without a stack mounted, and the branch the library carries
  // "Channel not opened!" for. `Tcp F Open` reaches the real file store.
  const data = rt.vfs?.readFile(path) ?? null
  if (data === null) return 0
  g.channels.set(n, { path, data, pos: 0, dirty: false })
  return TCP_HANDLE_ORIGIN + n * 4
}

/** dos Write on a channel: `Tcp Put`, `Tcp Put$` and the ACTION_WRITE packet */
function tcpWrite(rt: Runtime, g: GuiState, c: GuiChannel, addr: number, len: number): number {
  const m = rt.resolveAddr(addr)
  if (m === null || len <= 0) return 0
  const n = Math.min(len, m.data.length - m.off)
  const end = Math.max(c.data.length, c.pos + n)
  const out = new Uint8Array(end)
  out.set(c.data)
  out.set(m.data.subarray(m.off, m.off + n), c.pos)
  c.data = out
  c.pos += n
  c.dirty = true
  void g
  return n
}

/** dos Read on a channel, which is what both `Tcp Read` and `Tcp Get` end in */
function tcpRead(rt: Runtime, c: GuiChannel, addr: number, len: number): number {
  const m = rt.resolveWrite(addr)
  if (m === null || len <= 0) return 0
  const n = Math.min(len, c.data.length - c.pos, m.data.length - m.off)
  if (n <= 0) return 0
  m.data.set(c.data.subarray(c.pos, c.pos + n), m.off)
  c.pos += n
  return n
}

/**
 * `Tcp Close` is fifty dos Closes and fifty zeroes, with no argument at all.
 *
 * Routine 86 walks the whole table with `moveq #$31,d2 / dbra`, skipping the
 * empty entries, and the extension's own reset routine at $ab8 runs the same
 * loop. So a program cannot close ONE channel: `Tcp Close` in GuiNet.Amos
 * takes down the connection and the destination file together.
 */
function closeChannels(rt: Runtime, g: GuiState): void {
  for (const c of g.channels.values()) if (c.dirty) rt.vfs?.writeFile(c.path, c.data)
  g.channels.clear()
}

/** DateStamp's minute and second, which is what `Tcp Reset` and `Tcp Time` keep */
function amigaClock(rt: Runtime): [number, number] {
  const d = rt.host.clock.now()
  return [d.mins, Math.trunc(d.ticks / 50)]
}

/**
 * Post a DosPacket and queue its reply, which is routines 117 and 118.
 *
 * DEVIATION: the reply is queued at once. The machine PutMsgs the packet to
 * the handler's own port and comes back to it later through `Gui Wait`, and
 * the whole point of the group is that the wait is not blocking. ../amiga/vfs.ts
 * answers immediately, so the asynchrony a program can observe is preserved ---
 * the packet id comes back now and the -9 arrives on the next pump, while
 * the work itself is already done.
 */
function tcpPacket(g: GuiState, type: number, channel: number, buffer: number, res1: number): number {
  g.packetSerial += 1
  g.packets.push({ id: g.packetSerial, type, res1, res2: 0, channel, buffer })
  g.packetsOut += 1
  return g.packetSerial
}

/**
 * The clamp every line and bar endpoint goes through, routine at $2036.
 *
 *     cmp.w $1b8(a0),d0 / blt / move.w $1b8(a0),d0
 *     cmp.w $1ba(a0),d1 / blt / move.w $1ba(a0),d1
 *     tst.w d0 / bgt / moveq #0,d0
 *     tst.w d1 / bgt / moveq #0,d1
 *
 * `$1b8` and `$1ba` are the OUTPUT's width and height, filled from `$8`/`$a`
 * of the Window at $680e or `$c`/`$e` of the Screen at $6848, so it is the
 * whole window and not its interior. The bound is inclusive: a coordinate
 * equal to the width survives, and one above it becomes the width.
 *
 * This is a clamp and not a clip, and the difference is visible. A line from
 * (10,10) to (900,20) on a 300-wide output becomes a line to (300,20), which
 * has a different slope from the part of the original line that would have
 * been inside; drawing it clipped and drawing it clamped disagree at every
 * pixel but the first.
 */
function clampOut(w: { width: number; height: number }, x: number, y: number): [number, number] {
  const cx = x >= w.width ? w.width : x <= 0 ? 0 : x
  const cy = y >= w.height ? w.height : y <= 0 ? 0 : y
  return [cx, cy]
}

/**
 * Where the drawing keywords land: the window `Gui Gfx 0,n` named, or the
 * selected one before anything has.
 *
 * On the machine this is one longword, `$1bc` of the extension's state, and
 * it holds a RastPort rather than a window: `Gui Gfx 0,n` fills it from
 * `Window.RPort` at $6820 and `Gui Gfx 1,n` from the screen's, which is why
 * one variable serves both. Null here when neither has been set.
 */
function target(g: GuiState): GuiWindow | null {
  return g.windows.get(g.actual) ?? g.windows.get(g.selected) ?? null
}

/**
 * A gadget by number, or "Gadget not defined".
 *
 * Routine 246 at $6680 sets `moveq #$2,d7` twice: once before it tests for a
 * negative number and once after the window lookup, so a bad gadget answers 2
 * and a closed window answers the 10 routine 244 left behind. The order
 * matters, because a program that asks about gadget -1 of a window that is
 * not open gets 2 rather than 10.
 */
function gadgetOf(g: GuiState, win: number, id: number): { w: GuiWindow; gad: GuiGadget } {
  if (id < 0) guiError(GUI_ERR.GADGET_NOT_DEFINED)
  const w = windowOf(g, win)
  const gad = g.gadget(w, id)
  if (gad === null) guiError(GUI_ERR.GADGET_NOT_DEFINED)
  return { w, gad }
}

/**
 * The string array a LISTVIEW was given, through `Gui Set window,gadget,1,
 * Array(A$(0))`.
 *
 * "you MUST use Varptr(String) as value" for a string gadget and `Array()`
 * for a listview, and both are addresses on the machine. This port's
 * `Array()` hands back an opaque handle for a string array rather than an
 * address, registered in `rt.dialogArrays`, so the handle stored in attribute
 * 1 is looked up rather than dereferenced.
 *
 * Null when attribute 1 holds something that is not a live string array,
 * which is every listview a program never gave one to.
 */
function listArray(rt: Runtime, g: GuiState, w: GuiWindow, id: number): string[] | null {
  const arr = rt.dialogArrays.get(g.attrsOf(w, id)[1])
  if (arr === undefined || arr.type !== VAR_STRING) return null
  return arr.data.map((v) => (v.k === 'str' ? v.s : ''))
}

/**
 * Rotate a string array by one, which is what both `Gui Array` keywords do.
 *
 * $335a and $338c are the two loops, and each ends by writing the value it
 * saved at the far end -- so nothing is lost and neither is a shift. The
 * bounds are the binary's: a negative start does nothing and so does a start
 * past the last index, and neither raises.
 *
 * The machine reads the array's length from ONE WORD at `$2` of the
 * descriptor, which is the first dimension. This rotates the whole flat
 * array, which is the same thing for the one-dimensional arrays a listview
 * takes and the only kind the guide's examples show.
 */
function rotateArray(rt: Runtime, handle: number, start: number, up: boolean): void {
  const arr = rt.dialogArrays.get(handle)
  if (arr === undefined || arr.type !== VAR_STRING) return
  const last = arr.data.length - 1
  if (start < 0 || start > last - 1) return
  if (up) {
    const first = arr.data[start]!
    for (let i = start; i < last; i++) arr.data[i] = arr.data[i + 1]!
    arr.data[last] = first
  } else {
    const end = arr.data[last]!
    for (let i = last; i > start; i--) arr.data[i] = arr.data[i - 1]!
    arr.data[start] = end
  }
}

/**
 * `Gui Asl Colours`: one left ROTATE of a longword per plane.
 *
 * `moveq #$1,d3`, the depth zero-extended into d2, `subq.l #$1,d2`, then
 * `rol.l #$1,d3` in a `dbra`. Two things fall out of that. A depth of 0 makes
 * the counter -1 and the `dbra` reads only its low word, so the loop turns
 * 65,536 times -- a multiple of 32, which rotates the 1 all the way back to
 * where it started and answers 1. And a depth of 32 or more wraps instead of
 * overflowing, so 33 planes answer 2.
 */
function coloursForDepth(depth: number): number {
  const d = depth & 0xffff
  const turns = (d === 0 ? 0x1_0000 : d) % 32
  return (1 << turns) >>> 0
}

/**
 * Drawer and file, joined the way $762e joins them.
 *
 * One separator, and none at all when the drawer already ends in ':' or '/'.
 * The two `cmpi.b` at $762e and $7636 are the whole rule.
 */
function joinAsl(dir: string, file: string): string {
  if (dir === '') return file
  const last = dir[dir.length - 1]
  return last === ':' || last === '/' ? dir + file : `${dir}/${file}`
}

/**
 * Write one ColorMap entry, growing nothing.
 *
 * SetRGB32 on an index past the end of the map is graphics.library's problem
 * and it simply ignores it, so an entry that does not exist is not an error
 * here either. Neither `Gui Rgb` tests the screen's depth.
 */
function setColour(screen: GuiScreen, index: number, rgb: number): void {
  if (index < 0 || index >= screen.palette.length) return
  screen.palette[index] = rgb
}

/**
 * The pen `Gui Best` answers: the smallest sum of squared component
 * differences, first one wins.
 *
 * ObtainBestPenA's own default is OBP_Precision PRECISION_IMAGE, which
 * weights the three components for the eye rather than treating them alike.
 * This does not, because the weights are graphics.library's and are not
 * written down in anything this port can read.
 */
function nearestPen(palette: readonly number[], r: number, g: number, b: number): number {
  let best = 0
  let far = Infinity
  for (const [i, c] of palette.entries()) {
    const dr = ((c >> 16) & 0xff) - r
    const dg = ((c >> 8) & 0xff) - g
    const db = (c & 0xff) - b
    const d = dr * dr + dg * dg + db * db
    if (d < far) {
      far = d
      best = i
    }
  }
  return best
}

/**
 * Resize a window and give it a RastPort the new size.
 *
 * `Gui Resize` and `Gui Change` both end in routine 240, the gadget relayout,
 * and both keep the Gfx size in step when the window is the one `Gui Gfx`
 * named. Nothing here draws yet, so what that comes to is a new bitmap.
 */
function resizeWindow(w: GuiWindow, width: number, height: number): void {
  if (width === w.width && height === w.height) return
  w.width = width
  w.height = height
  w.rp = newWindowPort(width, height)
}

/**
 * What `Gui Sy` takes off before scaling: TEN, where the design used eleven.
 *
 * Named rather than written inline because it is the whole of a defect. See
 * the keyword.
 */
const SY_DESIGN_TOP = 10

/** `VarType` 2: a string array, which is the only kind these keywords take */
const VAR_STRING = 2

/**
 * What AMOS pushes for an argument a program left out, and what four of these
 * keywords test for by name.
 *
 * `cmpi.l #$80000000,d0` at $2882 in `Gui Len`, $2ede in `Gui Gad Tag`, $6406
 * in the window lookup. Each has its own meaning for it: the current window,
 * the current bank's design chain.
 */
const OMITTED = -0x8000_0000

/**
 * The scale `Gui Sx` and `Gui Sw` apply, skipped for a window that was laid
 * out in topaz/8: `tst.w $42(a1) / bne` at $28f0 jumps past the call.
 */
function sensitiveX(g: GuiState, win: number, v: number): number {
  return windowOf(g, win).topaz ? v : guiScale(v, g.fontWidth)
}

/** the same for `Gui Sy` and `Gui Sh`, testing the same word at $2920 */
function sensitiveY(g: GuiState, win: number, v: number): number {
  return windowOf(g, win).topaz ? v : guiScale(v, g.fontHeight)
}

/**
 * A GUI screen by its number, or "Screen not opened".
 *
 * Routine 259 at $7656 walks the list comparing `$c` of each record and
 * answers 0 for a number it cannot find AND for any negative one, which it
 * rejects at $765a before it looks. Every caller but two turns that 0 into
 * error 17.
 */
function screenOf(g: GuiState, n: number): GuiScreen {
  return g.screens.get(n) ?? guiError(GUI_ERR.SCREEN_NOT_OPENED)
}

/** the current screen, `$1d2`, or "Screen not opened" */
function currentScreen(g: GuiState): GuiScreen {
  return g.current ?? guiError(GUI_ERR.SCREEN_NOT_OPENED)
}

/**
 * The pointer in Workbench screen coordinates.
 *
 * `Gui Mouse X` reads `$12` of the Screen at `$1d2` and `Gui Mouse Y` reads
 * `$10`, which are `Screen.MouseX` and `Screen.MouseY` -- the two are stored
 * Y first, which is why the offsets look swapped.
 *
 * DEVIATION: there is no Screen under these windows here. The pointer this
 * port has is AMOS's, in hardware coordinates, so it is converted the way
 * `Screen.hardToScreenX` converts for a hires 640-wide Workbench: twice the
 * distance from the standard display origin at 128, and down from the
 * Workbench's own top edge at line 44. Clamped to the screen box, because
 * intuition does not let the pointer leave it and a program reading a
 * negative MouseX would be reading something the machine cannot produce.
 */
function screenMouse(it: Interp, g: GuiState): [number, number] {
  const x = (it.inp.mouseX - 128) * 2
  const y = it.inp.mouseY - WB_DISPLAY_Y
  const w = g.current?.width ?? WB_WIDTH
  const h = g.current?.height ?? WB_HEIGHT
  return [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))]
}

/**
 * One point of `Gui Line 3d`, projected: 128 over Z, offset by the eye.
 *
 * `asl.l #$7,d0 / divs.w d2,d0 / add.w d6,d0` at $3d16, twice per point.
 * `divs.w` divides a longword by a WORD and returns a word quotient, and on
 * overflow the 68000 sets V and writes nothing back — so a quotient outside
 * -32768..32767 leaves the register holding the shifted numerator's low word,
 * which is the shifted numerator itself. Modelled as the truncating divide
 * plus the overflow case, because the two differ for x=1000,z=1 and a program
 * can see the difference.
 *
 * DEFECT: the zero test in front of this is `tst.l`, longword, and the divide
 * is `divs.w`, word. So a Z of 65536 passes the guard with a divisor of zero
 * and takes the 68000's divide-by-zero trap. Answered as 0 here; a crash is
 * not a value this port can hand back.
 */
function project3d(x: number, y: number, z: number, g: GuiState): [number, number] {
  const axis = (v: number, eye: number): number => {
    const num = (v << 7) | 0
    const den = (z << 16) >> 16
    const q = den === 0 ? 0 : Math.trunc(num / den)
    // overflow: d0 keeps the shifted numerator, and `add.w` adds into its low
    // half. Signed words throughout, which is what `add.w` leaves behind.
    const kept = q >= -0x8000 && q <= 0x7fff ? q : num
    return ((kept + eye) << 16) >> 16
  }
  return [axis(x, g.eyeX), axis(y, g.eyeY)]
}

/**
 * Where `Gui Clip Read$` and `Gui Clip Write$` go: `CLIPS:0`, unit zero of
 * the clipboard handler.
 *
 * The string is at $1c06 of the library and the state holds a copy at `$3ac`,
 * which is the buffer both keywords pass to Open. No keyword changes it, so
 * the clipboard is one fixed path.
 */
const CLIPBOARD_PATH = 'CLIPS:0'

/** an AMOS string's bytes, which are latin-1 and may hold a zero */
function toBytes(s: string): Uint8Array {
  return Uint8Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) & 0xff)
}

/** and back */
function fromBytes(b: Uint8Array): string {
  let out = ''
  for (const c of b) out += String.fromCharCode(c)
  return out
}

/** the four bytes at `at` as a big-endian longword, which is how IFF reads */
function be32(b: Uint8Array, at: number): number {
  return (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0
}

/** ASCII to a chunk id, so the four-letter names read as themselves */
function fourcc(s: string): number {
  return be32(toBytes(s), 0)
}

/**
 * Does a filesystem event fall under a `Gui Notify` watch?
 *
 * AmigaDOS notifies on a file when that file is written, and on a directory
 * when anything in it changes. `AmigaFS.watch` reports `DH0:Games/x.amos`,
 * and the program named its path with whatever case and trailing slash it
 * liked, so both sides are folded before they are compared.
 */
function underNotify(watched: string, changed: string): boolean {
  const fold = (p: string): string => p.toLowerCase().replace(/\/+$/, '')
  const w = fold(watched)
  const c = fold(changed)
  if (w === c) return true
  if (w.endsWith(':')) return c.startsWith(w)
  return c.startsWith(`${w}/`)
}

/**
 * `Xfa Play`'s and `Xfa Rtg Play`'s six arguments, read and dropped.
 *
 * Named rather than repeated, because the two routines are the same one
 * twice: file name, four booleans for XFA_Play and the mode id that goes to
 * OpenPlayStuff instead.
 */
function xfaArgs(it: Interp): void {
  it.evalStr()
  for (let i = 0; i < 5; i++) {
    it.expect(',')
    it.evalInt()
  }
}

/**
 * `DrawImage` of an AMOS image into a RastPort, which is what routine 256 at
 * $746c builds a `struct Image` for.
 *
 * The header it reads is the AMOS one: a width word in SIXTEENS (`mulu.w
 * #$10`), a height word, a depth word, then four bytes it steps over --
 * the hot spot -- and the planes. The depth is clipped to the destination
 * BitMap's own at $74aa, and PlanePick at `$21e` is `$ff00 rol depth`, so a
 * pixel is masked to that many bits.
 *
 * DrawImage is opaque: colour 0 is drawn, not skipped, which is the one way
 * this differs from AMOS's own `Paste Bob`.
 */
function drawAmosImage(
  rp: RastPort,
  img: { width: number; height: number; depth: number; pixels: Uint8Array },
  x: number,
  y: number,
): void {
  const depth = Math.min(img.depth, rp.bitMap.depth)
  const mask = ((1 << depth) - 1) & 0xff
  for (let iy = 0; iy < img.height; iy++) {
    const ty = y + iy
    if (ty < 0 || ty >= rp.bitMap.height) continue
    for (let ix = 0; ix < img.width; ix++) {
      const tx = x + ix
      if (tx < 0 || tx >= rp.bitMap.width) continue
      rp.putPixel(tx, ty, img.pixels[iy * img.width + ix]! & mask)
    }
  }
}

/**
 * `ScrollRaster(rp, dx, dy, xMin, yMin, xMax, yMax)` -- graphics.library -396,
 * which is the whole of `Gui Scroll`.
 *
 * The vacated edge goes to the RastPort's BgPen, which is what the real call
 * does with a simple RastPort. Positive dx moves the picture LEFT, as
 * graphics.library defines it and as the guide's "scrolls the area... by numx
 * pixels" leaves open.
 */
function scrollRaster(rp: RastPort, dx: number, dy: number, x1: number, y1: number, x2: number, y2: number): void {
  const w = x2 - x1 + 1
  const h = y2 - y1 + 1
  if (w <= 0 || h <= 0) return
  const keep = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) keep[y * w + x] = rp.point(x1 + x, y1 + y)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + dx
      const sy = y + dy
      const v = sx < 0 || sx >= w || sy < 0 || sy >= h ? rp.bgPen : keep[sy * w + sx]!
      rp.putPixel(x1 + x, y1 + y, v)
    }
  }
}

/** `BltBitMapRastPort` with minterm $c0: a straight copy, clipped both ends */
function bltRect(
  src: RastPort,
  sx: number,
  sy: number,
  dst: RastPort,
  dx: number,
  dy: number,
  w: number,
  h: number,
): void {
  const keep = new Uint8Array(Math.max(0, w) * Math.max(0, h))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = sx + x
      const py = sy + y
      keep[y * w + x] = px < 0 || py < 0 || px >= src.bitMap.width || py >= src.bitMap.height ? 0 : src.point(px, py)
    }
  }
  for (let y = 0; y < h; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.bitMap.height) continue
    for (let x = 0; x < w; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.bitMap.width) continue
      dst.putPixel(tx, ty, keep[y * w + x]!)
    }
  }
}

/**
 * `Gui Paste Icon` and `Gui Paste Bob`: routine 257's bounds and the draw.
 *
 * $74fa refuses a number of zero or below, $7502 compares it against the
 * bank's own count word with `cmp.l d0,d1 / bgt`, and both answer error 12
 * "Image not reserved". The index is `(n - 1) * 8` into the bank's pointer
 * table, so the numbering is one-based.
 */
function pasteBankImage(rt: Runtime, it: Interp, bank: ObjectBank | null): void {
  const n = it.evalInt()
  it.expect(',')
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  const img = n <= 0 ? undefined : bank?.image(n)
  if (img === undefined) guiError(GUI_ERR.IMAGE_NOT_RESERVED)
  drawAmosImage(gfx(rt.gui).rp, img, x, y)
}

/**
 * One end of `Gui Screen Copy`, which $419e and $41d6 resolve the same way:
 * above zero a GUI screen, zero the current gfx output, below zero AMOS's own
 * screen at `-$18ca(a5)`.
 */
function copyEnd(rt: Runtime, g: GuiState, n: number): RastPort {
  if (n > 0) return screenOf(g, n).rp
  if (n === 0) return gfx(g).rp
  // AMOS's own current screen. Its RastPort here is the Screen's own, and a
  // program with none open reaches the same `beq` the library does.
  return rt.screen.rp
}

/**
 * `Gui Remap`'s two passes over an RTG Bob bank: the pens, then the planes.
 *
 * The pen table at `+$8c` is written back into the BANK, which is where the
 * image gadget code reads it from, so a program can see it with `Leek`. Bit
 * 31 marks a colour FindColor answered for rather than one ObtainBestPenA
 * reserved, exactly as $4ab0 sets it.
 *
 * The planes go into the state rather than into the bank, because on the
 * machine they go into an AllocVec at `$bc` and only the POINTER is written
 * back. There is no allocation to name here, so the table gets a handle from
 * the same origin `Gui Gad Adr` mints from.
 */
function remapRtgBobs(g: GuiState, data: Uint8Array): void {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 0x10c) guiError(GUI_ERR.BOBS_BANK_NOT_RESERVED)
  const images = dv.getUint32(0)
  const colours = dv.getUint32(4)
  if (images > 0x1000 || colours > 32 || 0x10c + images * 8 > data.length) {
    guiError(GUI_ERR.BOBS_BANK_NOT_RESERVED)
  }
  const palette = g.current?.palette ?? []
  const pens: number[] = []
  for (let i = 0; i < colours; i++) {
    const at = 0xc + i * 4
    const r = data[at + 1] ?? 0
    const gr = data[at + 2] ?? 0
    const b = data[at + 3] ?? 0
    const pen = nearestPen(palette, r, gr, b)
    pens.push(pen)
    // $4ab6 stores the longword whether it came from ObtainBestPenA or from
    // FindColor; only the second carries bit 31
    dv.setUint32(0x8c + i * 4, (pen | 0x8000_0000) >>> 0)
  }
  let chunky = 0x10c + images * 8
  g.rtgPlanes.length = 0
  for (let i = 0; i < images; i++) {
    const at = 0x10c + i * 8
    const w = dv.getUint16(at)
    const h = dv.getUint16(at + 2)
    const size = w * h
    const rowBytes = rowBytesFor(w)
    const planes = new Uint8Array(rowBytes * h * RTG_PLANES)
    const mapped = new Uint8Array(size)
    for (let k = 0; k < size; k++) mapped[k] = pens[data[chunky + k] ?? 0] ?? 0
    encode(mapped, planes, rowBytes * h, rowBytes, RTG_PLANES, w, h)
    g.rtgPlanes.push({ width: w, height: h, planes })
    dv.setUint32(at + 4, g.gadgetAddress(-1, g.rtgPlanes.length - 1))
    chunky += size
  }
}

/** the eight planes $4aea builds pointers for, one `move.l` and a seven-turn loop */
const RTG_PLANES = 8

/**
 * What `Tcp Open` and `Tcp Listen` answer when routine 227 cannot allocate:
 * `moveq #$ff,d3`, and the guide's "-1 = Unable to alocate a socket".
 *
 * The same number is `Tcp Accept`'s failure at $476c.
 */
const TCP_NO_SOCKET = -1

/**
 * A socket by its descriptor, or "Socket not opened!".
 *
 * Routine 226 at $4c88 walks the chain at `$2dc` comparing `$4` of each node
 * and sets `moveq #$14,d7` on the way in, so the seven keywords that call it
 * and test the result all raise 20 without naming it. `Tcp User` calls it and
 * does NOT test, which is why it is the one that answers 0 instead.
 */
function socketOf(g: GuiState, fd: number): GuiSocket {
  return g.sockets.get(fd) ?? guiError(GUI_ERR.SOCKET_NOT_OPENED)
}

/**
 * Where `OpenCatalogA(NULL, name, NULL)` looks.
 *
 * locale.library's own order is `PROGDIR:Catalogs/<language>/<name>` then
 * `LOCALE:Catalogs/<language>/<name>`, and the language comes from the
 * system's preferred list. `../amiga/language.ts`'s Language carries strings
 * and no NAME, so this port cannot build the language leg -- it probes the
 * bare name, which is what the guide's own worked example produces (`Cat
 * Ram:Hello` writes `Hello.catalog` beside the program), and the two roots
 * without it.
 */
const CATALOG_PATHS = (name: string): string[] => [name, `CATALOGS:${name}`, `LOCALE:Catalogs/${name}`]

/**
 * `Gui Help`'s side of a mouse move: write the array's string for whichever
 * gadget the pointer is over into the display gadget.
 *
 * $6e4e onwards. The pointer's position and the window go through the same
 * AMOS call `Gui Check` is, so the gadget is found the same way; `addq.l
 * #$1,d3` turns its -1 for "over nothing" into a zero that $6e9c tests, and
 * anything else indexes the array at `$42` from `+6` -- the AMOS array
 * descriptor's data. A move that stays over the same gadget as last time
 * costs nothing: $6e78 compares against `$40` and leaves.
 */
function helpMove(rt: Runtime, g: GuiState, w: GuiWindow, e: GuiEvent): void {
  // `$29c` and `$29e` are the IntuiMessage's MouseX and MouseY, which are
  // already the window's own coordinates -- the same pair `Gui Mouse Ex`
  // reads and the same frame `Gui Check` takes its arguments in
  const x = e.mouseX ?? 0
  const y = e.mouseY ?? 0
  let over = -1
  for (const d of w.design.gadgets) {
    if (x >= d.leftEdge && x < d.leftEdge + d.width && y >= d.topEdge && y < d.topEdge + d.height) {
      over = d.id
      break
    }
  }
  if (over + 1 === w.helpLast) return
  w.helpLast = over + 1
  const arr = rt.dialogArrays.get(w.helpArray)
  const cell = over < 0 || arr === undefined || arr.type !== VAR_STRING ? undefined : arr.data[over]
  // $6e96 loads the null string first, so a gadget with no entry blanks it
  w.strings.set(w.helpGadget, cell !== undefined && cell.k === 'str' ? cell.s : '')
  void g
}

/**
 * What `Gui Wait` and `Gui Event` answer: the next event, with the two things
 * the pump does on the way past.
 *
 * A timer that has come due is turned into its -13 first. A mouse move over a
 * window with `Gui Help` on runs the help and is then SWALLOWED unless `Gui
 * Mouse Report` is on as well -- $6eb6 tests the whole flags word for 3 and
 * $6ec0 branches back into the pump for the next message when it is not.
 */
function pumpEvent(rt: Runtime, g: GuiState): number {
  fireTimer(rt, g)
  for (;;) {
    const code = g.nextEvent()
    if (code !== GUI_EVENT.MOUSEMOVE) return code
    const e = g.last
    const w = e === null || e.window === undefined ? undefined : g.windows.get(e.window)
    if (e === null || w === undefined || !w.helpOn) return code
    helpMove(rt, g, w, e)
    if (w.reportMouse) return code
  }
}

/**
 * Turn an elapsed `Gui Timer` request into the event -13 that reports it.
 *
 * $6b92 is the pump's timer arm: `and.l` the received signal mask against the
 * request's bit, `bclr.b #$5,$85(a3)` so the next `Gui Timer` is allowed, and
 * `moveq #$f3,d4` — $f3 sign-extended is -13. No window is written to `$de`
 * on the way past, so `Gui Window` after a timer still names whichever window
 * spoke last.
 */
function fireTimer(rt: Runtime, g: GuiState): void {
  if (g.timerAt === null || rt.frames < g.timerAt) return
  g.timerAt = null
  g.post({ code: GUI_EVENT.TIMER, result: 0, text: '' })
}

/**
 * The same, but raising "Gfx output not defined" when there is none.
 *
 * Every drawing keyword tests `$1bc` and branches to the error with
 * `moveq #$b,d7` -- `Gui Ink` at $1f92, `Gui Cls` at $20a2, `Gui Writing` at
 * $261c, `Gui Text` at $25e2, `Gui Paint` at $2c20 and the rest. The guide
 * never mentions it; the error string and the branch are the whole evidence
 * that drawing before `Gui Gfx` is an error at all.
 */
function gfx(g: GuiState): GuiWindow {
  return target(g) ?? guiError(GUI_ERR.GFX_NOT_DEFINED)
}

/**
 * A window by its number, or "Window not open".
 *
 * The library's own lookup is routine 244 at $63ee. It walks the window list
 * comparing `$c(a0)`, and it sets `moveq #$a,d7` on the way in, so every
 * keyword that calls it and tests the result raises the same error 10 without
 * naming it. Sixteen of them do.
 */
function windowOf(g: GuiState, n: number): GuiWindow {
  return g.windows.get(n) ?? guiError(GUI_ERR.WINDOW_NOT_OPEN)
}

/**
 * The three kinds `Gui Read$` answers for, from the guide's own list.
 * Everything else gets an empty string.
 */
const READ_STRING_KINDS = new Set<number>([KIND.LISTVIEW, KIND.CYCLE, KIND.STRING])

/**
 * A DrawInfo for `Gui Bbox`, whose pens are the window's own ink and paper.
 *
 * DEVIATION: gadtools takes SHINEPEN and SHADOWPEN out of the screen's
 * DrawInfo, and these windows have no screen. Ink and paper are what a GUI
 * program can actually set through this extension, so a bevel drawn here is
 * in the two colours the program chose rather than in two it never named.
 */
function bevelPens(w: GuiWindow, g: GuiState): DrawInfo {
  const pens = new Array<number>(12).fill(w.ink)
  pens[PEN.SHINE] = w.ink
  pens[PEN.SHADOW] = g.paper
  return { numPens: pens.length, pens, depth: w.rp.depth }
}

export function makeGuiInstructions(rt: Runtime): Record<string, Instr> {
  const s = (): GuiState => rt.gui
  /** the two coordinates every drawing keyword starts with */
  const pair = (it: Parameters<Instr>[0]): [number, number] => {
    const x = it.evalInt()
    it.expect(',')
    return [x, it.evalInt()]
  }

  /**
   * The four arguments every menu keyword takes, in the order the library
   * pops them: window first, then menu, item and sub through the packer.
   *
   * Null when the window is not open or carries no strip, which is the
   * `tst.l d0 / Rbeq` at $423a and the `beq` at $42a0.
   */
  const menuArgs = (it: Parameters<Instr>[0]): { strip: MenuStrip; number: number } | null => {
    const win = it.evalInt()
    it.expect(',')
    const menu = it.evalInt()
    it.expect(',')
    const item = it.evalInt()
    it.expect(',')
    const sub = it.evalInt()
    const strip = s().windows.get(win)?.strip
    if (strip === undefined || strip === null) return null
    return { strip, number: packMenuNumber(menu, item, sub) }
  }

  const menuEnable = (it: Parameters<Instr>[0], on: boolean): void => {
    const a = menuArgs(it)
    if (a === null) return
    const gt = s().gt
    if (on) gt.onMenu(a.strip, a.number)
    else gt.offMenu(a.strip, a.number)
  }

  const menuCheck = (it: Parameters<Instr>[0], on: boolean): void => {
    const a = menuArgs(it)
    if (a === null) return
    const item = s().gt.itemAddress(a.strip, a.number)
    if (item === null) return
    // the binary works in Flags and nothing else: `ori.w #$100` to check,
    // `andi.w #$ff` to uncheck, which clears three more bits with it
    if (on) item.flags |= MENU_FLAG.CHECKED
    else item.flags &= 0xff
    item.checked = on
  }

  return {
    /**
     * `Gui Bank bank`.
     *
     * "Before you can begin opening GUI windows which have been turned into
     * banks, you will need to tell the system which AMOS bank the GUI info is
     * located in. The converter will place it in bank 20 by default."
     */
    'gui bank': (it) => {
      const g = s()
      g.bank = it.evalInt()
      designs(rt, g)
    },

    /**
     * `Gui Open window,gui[,bank[,x,y,width,height]]`.
     *
     * Three syntaxes, and the guide is explicit about each: the bank "will
     * then become the current GUI bank", and without the geometry the window
     * takes "the position and size as specified in the GadToolsBox editor".
     *
     * The gui number is one-based in a program and zero-based in the bank's
     * own chain, which is the usual AMOS offset and is why `- 1` appears here
     * rather than in ./guistate.ts.
     *
     * The third syntax is where the releases part, and the token tables say
     * so before any prose does. 1.5b has two entries, `I0,0` and `I0,0,0`, so
     * there is no geometry at all; 1.61 added `I0,0,0,0,0` and its guide reads
     * "GUI OPEN window,gui,bank,x,y", a POSITION; 2.10 takes the size as well.
     * A 1.61 program written to the five-argument form and parsed against
     * 2.10's would run off the end of its own arguments.
     */
    'gui open': (it) => {
      const g = s()
      const win = it.evalInt()
      it.expect(',')
      const gui = it.evalInt()
      if (it.accept(',')) {
        g.bank = it.evalInt()
        designs(rt, g)
      } else if (g.designs.length === 0) {
        designs(rt, g)
      }
      let box
      if (it.accept(',')) {
        const left = it.evalInt()
        it.expect(',')
        const top = it.evalInt()
        // 1.61 stops here. What it does with the pair is what 2.10 does with
        // the first two of four, so the design's own size stands
        let width = g.designs[gui - 1]?.width ?? 0
        let height = g.designs[gui - 1]?.height ?? 0
        if (g.release === '2.10') {
          it.expect(',')
          width = it.evalInt()
          it.expect(',')
          height = it.evalInt()
        }
        box = { left, top, width, height }
      }
      checkBankVersion(g, win, gui - 1)
      const opened = g.open(win, gui - 1, box)
      // `$66` of the state, the ITextFont every IntuiText this extension
      // builds carries. A RastPort with no font draws no glyphs, so without
      // this `Gui Text` and the gadget labels put down nothing at all
      if (opened !== null) opened.rp.font = rt.systemFont()
    },

    /** `Gui Reset` — close all the windows */
    'gui reset': () => {
      s().reset()
    },

    /**
     * `Gui Gfx type,number` — where the drawing keywords land.
     *
     * TWO arguments, and the first is not the window:
     *
     *     0 - Window
     *     1 - Screen
     *
     * "The Number parameter tells the system which window or screen to direct
     * the output to." `Gui Actual` reads back the window this set.
     *
     * The token table is what caught this. Its spec is `I0,0` and a first
     * reading of the guide's prose had it taking one argument, which would
     * have left every drawing keyword pointed at a screen number.
     */
    'gui gfx': (it) => {
      const g = s()
      const type = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      g.gfxToScreen = type !== 0
      if (type === 0) {
        // routine 251's window arm sets `moveq #$a,d7` at $67d8 before it
        // looks, so naming a closed window here is "Window not open"
        windowOf(g, n)
        g.actual = n
      } else {
        g.gfxScreen = n
      }
    },

    /**
     * `Gui Mouse Mode 0|1` — "Alter frequency of Mouse Click events".
     *
     * "by default you'll receive two -11 events, 1 when you click the button,
     * and another when you let go. If you set Gui Mouse Mode to 1, this will
     * change to just 1 event". $2ace stores the word and checks nothing; the
     * pump at $709a is where it means anything, and the event it keeps is the
     * RELEASE: $70a2 lets $e8, $e9 and $ea through, which are SELECTUP,
     * MENUUP and MIDDLEUP.
     */
    'gui mouse mode': (it) => {
      s().mouseMode = it.evalInt() & 0xffff
    },

    /**
     * `Gui Mouse Queue window,limit` — "Expand mouse queue limit".
     *
     * Straight to intuition's `SetMouseQueue` (-$1f2) at $3886 with the
     * window and the number. "Usually intuition queue a maximum of 5 mouse
     * movements, and discard all the other if you don't read them in time!"
     */
    'gui mouse queue': (it) => {
      const n = it.evalInt()
      it.expect(',')
      windowOf(s(), n).mouseQueue = it.evalInt()
    },

    /**
     * `Gui Mouse Report window,mode` — "Activate events reports on every
     * mouse movement", which is WFLG_REPORTMOUSE.
     *
     * The library sets and clears the bit in `Window.Flags` itself, `ori.l
     * #$200,$18(a0)` at $2dee and an AND at $2de8, rather than calling
     * intuition's ReportMouse. The word beside it at `$3e(a1)` looks like a
     * nesting count and is not one: only bit 0 is ever tested, so two
     * consecutive Trues leave it at one and a single False clears it.
     */
    'gui mouse report': (it) => {
      const n = it.evalInt()
      it.expect(',')
      windowOf(s(), n).reportMouse = it.evalInt() !== 0
    },

    /**
     * `Gui Rmb window,mode` — "Enable the use of the Right mouse button".
     *
     * INVERTED, and the guide says so in words while the binary says it in
     * bits: "Gui Rmb 1,True   The RMB will be detected as normal by
     * intuition" clears WFLG_RMBTRAP ($2c12), and False SETS it ($2c08) so
     * the program gets a -11 instead. Its own closing warning is the
     * consequence: "If YOU monitor the right mouse button, the menus aren't
     * displayed!"
     */
    'gui rmb': (it) => {
      const n = it.evalInt()
      it.expect(',')
      windowOf(s(), n).rmb = it.evalInt() !== 0
    },

    /**
     * `Gui Sensitive On` — "make your GUI windows use your Workbench font
     * settings for displaying". Bit 0 of `$85`, set at $2300.
     *
     * "This is the default setting", and $1678 sets the same bit during init,
     * so the two agree.
     */
    'gui sensitive on': () => {
      s().sensitive = true
    },

    /**
     * `Gui Sensitive Off` — "makes your windows use the topaz/8 font as used
     * when you create the GUI in GadToolsBox". $230c clears the bit.
     *
     * It takes effect at the next `Gui Open`: a window copies the flag into
     * its own `$42` at $5726 and never looks at the global again.
     */
    'gui sensitive off': () => {
      s().sensitive = false
    },

    /**
     * `Gui To Front window` — "moves the specified window to the frontmost of
     * the display".
     *
     * TWO calls, and the guide names one: WindowToFront (-$138) at $1ea6 and
     * then ActivateWindow (-$1c2) at $1eae. So raising a window also makes it
     * the active one, which `Gui Selected` reports.
     */
    'gui to front': (it) => {
      const g = s()
      g.toFront(windowOf(g, it.evalInt()))
    },

    /** `Gui To Back window` — WindowToBack (-$132) alone, and no activate */
    'gui to back': (it) => {
      const g = s()
      g.toBack(windowOf(g, it.evalInt()))
    },

    /**
     * `Gui Move window,x,y` — "move the specified window, to the new x and y
     * coordinates specified".
     *
     * Routine 247 at $66b0 compares the packed LeftEdge/TopEdge longword with
     * the pair asked for and returns without doing anything when they match.
     * Otherwise it calls MoveWindow (-$a8), which takes DELTAS rather than
     * coordinates, and then busy-waits at $66ee until intuition has actually
     * moved it -- the call is asynchronous and the keyword is not.
     */
    'gui move': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      w.left = x
      w.top = y
    },

    /**
     * `Gui Resize window,width,height`.
     *
     * The same shape as `Gui Move`: compare the packed Width/Height longword,
     * SizeWindow (-$120) with deltas, wait for it, then relay out the
     * gadgets. It also updates the Gfx size at $22b6 when the window being
     * resized is the one `Gui Gfx` named, and it records what was ASKED FOR
     * where `Gui Change` beside it records what the window actually got.
     */
    'gui resize': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      resizeWindow(w, width, height)
    },

    /**
     * `Gui Change window,x,y,width,height` — "Use it if you must quickly move
     * and resize your window, instead of Gui Move followed by Gui Resize".
     *
     * ChangeWindowBox (-$1e6) takes all four absolutely, so this one needs no
     * deltas and no wait loop.
     */
    'gui change': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      w.left = x
      w.top = y
      resizeWindow(w, width, height)
    },

    /**
     * `Gui Center x,y` — "Switch on/off the ability to centre widows on the
     * current screen", separately for each axis.
     *
     * Two bits at `$1a2`, and it takes effect at the next `Gui Open` rather
     * than moving anything now.
     */
    'gui center': (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      s().centre = (x !== 0 ? GUI_CENTRE_X : 0) | (y !== 0 ? GUI_CENTRE_Y : 0)
    },

    /** `Gui Remember On` — bit 2 of `$85`, set at $2572 */
    'gui remember on': () => {
      s().remember = true
    },

    /**
     * `Gui Remember Off` — "will simply set the window back to its original
     * settings each time it is closed, as set in the GadToolsBox editor".
     */
    'gui remember off': () => {
      s().remember = false
    },

    /**
     * `Gui Titles window,window title$,screen title$`.
     *
     * "If you pass a empty string in one of the title string th old one will
     * be left unchanged", and the binary does it by turning an empty string
     * into -1 at $26b0 and $26ba, which is what SetWindowTitles (-$114) reads
     * as "leave this one".
     *
     * Each title is copied into a 101-byte buffer at `$3a` of the window
     * record, the second one found with `lea $65(a3),a3`, so a hundred
     * characters is as much as either will hold.
     */
    'gui titles': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      it.expect(',')
      const title = str(it.evalExpr())
      it.expect(',')
      const screen = str(it.evalExpr())
      if (title !== '') w.title = title.slice(0, GUI_TITLE_MAX)
      if (screen !== '') w.screenTitle = screen.slice(0, GUI_TITLE_MAX)
    },

    /**
     * `Gui Rgb colour,value` or `Gui Rgb colour,red,green,blue` — set one
     * entry of the current screen's ColorMap.
     *
     * Two routines behind one name, which is what the `!` on the token
     * table's entry means: routine 130 at $2ff6 takes four arguments and
     * routine 142 at $32d6 takes two. Both branch on `cmpi.w #$27,$18a` and
     * both call SetRGB4 (-$120) below Kickstart 39 and SetRGB32 (-$354) at or
     * above it. `$18a` here says 40, so this port always takes the second.
     *
     * The two forms are not the same keyword with a packed argument. The
     * four-argument one clamps: negatives become 0 at $300c and the index is
     * held under 64 at $302c or under 256 at $304e. The two-argument one
     * clamps NOTHING, so `Gui Rgb -1,$ffffff` reaches SetRGB32 with -1.
     *
     * Nothing here scales. "So if you use a 32bit definition on a ECS
     * machine, it will be automatically scaled to 4bit" is not what the
     * `andi.l #$f` at $302e does: it MASKS. On a Kickstart 2 machine
     * `Gui Rgb 0,128,0,0` would be black, where scaling would give half red.
     * The claim is only true for the values whose low nibble happens to be
     * right, which is why the guide's own example uses 255.
     */
    'gui rgb': (it) => {
      const g = s()
      const screen = g.current
      const index = it.evalInt()
      it.expect(',')
      const first = it.evalInt()
      if (!it.accept(',')) {
        // routine 142: unpack $RRGGBB, and no clamp of any kind
        if (screen !== null) setColour(screen, index, first & 0xff_ffff)
        return
      }
      const green = it.evalInt()
      it.expect(',')
      const blue = it.evalInt()
      // routine 130, in its own order: the index first, then the three bytes
      if (screen === null) return
      const n = Math.min(0xff, Math.max(0, index))
      setColour(screen, n, ((first & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff))
    },

    /**
     * `Gui Asl Open number,name` or `Gui Asl Open number,name,font,size` —
     * open a screen from what the screenmode requester was left holding.
     *
     * Routine 124 is `Gui Screen Open` with the five geometry arguments taken
     * out of `$150` instead of off the stack: width from `$4`, height from
     * `$8`, DisplayID from `$0` and the colour count from the same rotate
     * `Gui Asl Colours` uses. Then routine 232, the shared open. "It's the
     * best way to open a user definable screen!"
     *
     * DEFECT: the `Rbeq routine 264` at $2e94 raises whatever d7 already
     * held. Routine 232 loads four different error numbers and then restores
     * d7 from the stack at $5198, and this keyword loads none of its own --
     * where `Gui Screen Open` at least has a `moveq #$e,d7` standing. Error
     * 14 is what this raises, because that is what the last screen keyword to
     * fail would have left.
     *
     * DEFECT: `$150` is dereferenced before anything is checked, the same
     * unguarded read the five field keywords make.
     */
    'gui asl open': (it) => {
      const g = s()
      const n = it.evalInt()
      it.expect(',')
      const name = str(it.evalExpr())
      let fontName = ''
      let fontSize = 0
      if (it.accept(',')) {
        fontName = str(it.evalExpr())
        it.expect(',')
        fontSize = it.evalInt()
      }
      const sm = g.aslScreen
      if (n === 0 || g.screens.has(n)) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
      const depth = depthForColours(coloursForDepth(sm.depth))
      g.screens.set(n, {
        number: n,
        width: sm.width,
        height: sm.height,
        depth,
        modeID: sm.displayID,
        name,
        fontName,
        fontSize,
        left: 0,
        top: 0,
        showTitle: true,
        isPublic: false,
        palette: defaultPalette(depth),
        rp: newScreenPort(sm.width, sm.height, depth),
        cloned: false,
      })
      g.current = g.screens.get(n)!
      g.pubLock = 0
      g.pubName = ''
    },

    /**
     * `Gui Uniconify iconifyID` — open the window `Gui Iconify` closed.
     *
     * Routine 54 at $2390, which does not call `Gui Open` so much as become
     * it: it walks the design block chain BACK from the record it kept,
     * counting as it goes, and hands routine 239 that count as the GUI number
     * and `$8` of the node as the window number. A record that is already
     * first counts 1. So the window comes back on the same number, from the
     * same design.
     *
     * The iconify gadget is forced on across the re-open -- `move.w #$1,$60`
     * at $23e0, with the old mode parked in `$10` of the node -- so a window
     * that was iconified can always be iconified again whatever `Gui Set
     * Mode` says now.
     *
     * "Be sure to pass the correct Iconify ID returned by a previous call to
     * Gui Iconify or a nice guru will visit you ;)". A handle that was
     * already used is caught by the `tst.l $a(a2)` at $2396; one that was
     * never issued is the guru.
     *
     * DEFECT: `Gui Uniconify` on a window that was NOT laid out in topaz/8
     * overwrites the extension's two flag bytes with half of a pointer. The
     * save at $23b2 copies `$84` into `$e` of the node only inside the topaz
     * branch, and the restore at $23fc copies `$e` back unconditionally -- so
     * on the ordinary path `$84` and `$85` are handed the high word of the
     * window record's address, which is whatever AllocVec returned. `Gui
     * Sensitive` and `Gui Remember` both live in those bits. Not reproduced:
     * the value is an address, and this port has none.
     *
     * DEFECT: the `Rbeq routine 264` at $239a raises whatever error number
     * d7 was already carrying, since nothing here loads it. After a
     * successful `Gui Iconify` that is routine 244's `moveq #$a,d7`, which is
     * error 10, and that is what this raises.
     */
    'gui uniconify': (it) => {
      const g = s()
      if (g.release !== '2.10') return uniconifyBeta(g, it.evalInt())
      const app = g.apps.get(it.evalInt())
      const from = app?.window
      if (app === undefined || from === undefined || from === null) guiError(GUI_ERR.WINDOW_NOT_OPEN)
      const sensitive = g.sensitive
      const mode = g.iconifyGadget
      if (from.topaz) g.sensitive = false
      g.iconifyGadget = 1
      app.window = null
      g.open(from.number, from.gui)
      g.iconifyGadget = mode
      g.sensitive = sensitive
      g.apps.delete(app.handle)
    },

    /**
     * `Gui App Icon number,name,icon path` — an AppIcon on the Workbench.
     *
     * AddAppIconA (-$3c) at $773e with `'AMOS'` as the userdata, the name
     * copied into the node at `$1a` and the DiskObject from GetDiskObject on
     * the path. "Please note that in the icon path you DON'T need to specify
     * the .info extension", which is icon.library's rule rather than this
     * extension's.
     *
     * DEVIATION: no icon is read and nothing appears. There is no Workbench
     * screen under these windows yet, so what the keyword leaves is the node:
     * a number, a name and a path that `Gui App Remove` can find again. The
     * `moveq #$19,d7` at $3c90 raises error 25, "Unable to open AppIcon",
     * when AllocVec or AddAppIconA fails, and neither can here.
     */
    'gui app icon': (it) => {
      const g = s()
      const id = it.evalInt()
      it.expect(',')
      const name = str(it.evalExpr())
      it.expect(',')
      const icon = str(it.evalExpr())
      g.addApp(id, name, icon, null)
    },

    /**
     * `Gui App Remove number` — take one down again.
     *
     * RemoveAppIcon (-$42), FreeDiskObject (-$5a) and FreeVec, in routine 261
     * at $779a. Removing the AppIcon an iconified window is hiding behind
     * leaves that window closed with its handle dangling, which is the guru
     * `Gui Uniconify` warns about reached from the other end.
     */
    'gui app remove': (it) => {
      s().removeAppById(it.evalInt())
    },

    /**
     * `Gui Set Mode mode` — "Enable or disable the presence of the iconify
     * (zoom) gagdet in the titlebar of your windows".
     *
     * One word at `$60`, and the guide's own note is the reason it is here
     * and not on a window: "this command doesn't modify the windows already
     * opened, but only those opened later!"
     */
    'gui set mode': (it) => {
      s().iconifyGadget = it.evalInt()
    },

    /**
     * `Gui Beep` — DisplayBeep (-$60) with a NULL screen at $2558.
     *
     * The guide says "it will flash your current screen"; NULL means EVERY
     * open screen, which is what intuition's own autodoc calls "beep all of
     * the screens".
     *
     * DEVIATION: nothing flashes. These windows raise no pixels yet and the
     * port has no Workbench screen to invert, so the call is counted instead.
     * What the user would get on the machine also depends on their own
     * Preferences, which the guide is careful to say: "or perform the playing
     * of a sample, depending on how you have your workbench preferences set".
     */
    'gui beep': () => {
      s().beeps++
    },

    /**
     * `Gui Pause vbls` — "pause the program for the specified number of vbl's
     * in a system friendly way, using 0% CPU time".
     *
     * dos.library's Delay (-$c6), which counts TICKS. A tick is a fiftieth of
     * a second and so is a PAL vertical blank, which is why the guide can
     * call them vbls and be right on the machine this was written for.
     */
    'gui pause': (it) => {
      const n = it.evalInt()
      if (n > 0) it.block({ type: 'wait', until: it.tick + n })
    },

    /**
     * `Gui Wait Vbl [vbls]` — WaitTOF (-$10e), once or in a `dbra` loop.
     *
     * Two forms, which is what the `!` on the token table's name means: the
     * bare one at $2314 waits once and routine 77 at $2754 waits the number
     * given. "Gui Wait Vbl is exactly like the AMOS Wait Vbl command, except
     * for intuition."
     */
    'gui wait vbl': (it) => {
      const n = it.atStmtEnd() ? 1 : it.evalInt()
      if (n > 0) it.block({ type: 'wait', until: it.tick + n })
    },

    /**
     * `Gui Reserve Zone window,number of zones`.
     *
     * The count is checked FIRST, before the window: $407c is `tst.l d2 /
     * Rble` and $4082 is `cmpi.l #$1388,d2 / Rbhi`, both raising "Illegal
     * number of zones", and routine 244 only runs after. So asking window 9
     * for zero zones complains about the zeros.
     *
     * Five thousand is the ceiling, which the guide denies: "There is no
     * limit to the number of zones, except the amount of free memory."
     *
     * The block is AllocVec'd MEMF_CLEAR, so every zone starts as the
     * rectangle 0,0 to 0,0 -- which contains the point 0,0. Reserving without
     * setting is not the same as having no zones.
     */
    'gui reserve zone': (it) => {
      const g = s()
      const win = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      if (count <= 0 || count > GUI_MAX_ZONES) guiError(GUI_ERR.ILLEGAL_NUMBER_OF_ZONES)
      windowOf(g, win)
      g.zones.set(win, Array.from({ length: count }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0 })))
    },

    /**
     * `Gui Free Zone window` — "Erase all the zones of the specified window".
     *
     * FreeVec at $40f2 and the pointer cleared at $40de, in that order, so
     * freeing a window that never reserved any is not an error.
     */
    'gui free zone': (it) => {
      const g = s()
      const win = it.evalInt()
      windowOf(g, win)
      g.zones.delete(win)
    },

    /**
     * `Gui Set Zone window,zone,x,y To x1,y1` — "used to define a rectangular
     * area wich can be tested by the different Zone functions".
     *
     * Four checks in the binary's order: the window (10), then a negative
     * zone number and a window with no block and a zone past the end, all
     * three "Zone not reserved" (32), and last the rectangle. $4138 is `cmp.w
     * d2,d4 / Rble`, so x1 must be STRICTLY greater than x and y1 than y --
     * a zone one pixel wide is legal and a zero-width one is "Illegal
     * function call". AMOS's own Set Zone checks neither.
     */
    'gui set zone': (it) => {
      const g = s()
      const win = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      windowOf(g, win)
      const list = g.zones.get(win)
      if (n < 0 || list === undefined || n >= list.length) guiError(GUI_ERR.ZONE_NOT_RESERVED)
      if (x2 <= x1 || y2 <= y1) guiError(GUI_ERR.ILLEGAL_FUNCTION_CALL)
      list[n] = { x1, y1, x2, y2 }
    },

    /**
     * `Gui Array Up array address,start position` — "cycle upwards the
     * contents of a string array, starting from the specified element".
     *
     * A ROTATION and not a shift: $335a saves the element at `start`, slides
     * the rest down one, and writes the saved one in at the far end. The
     * guide's worked example is the proof, and it is also the use it names:
     * blank an element, rotate from it, and the hole ends up past the data
     * where a listview will not show it.
     *
     * Nothing is checked but the bounds, and going out of them is silent: a
     * negative start returns at $3340 and a start past the last index at
     * $334c. The address is not checked at all.
     */
    'gui array up': (it) => {
      const handle = it.evalInt()
      it.expect(',')
      rotateArray(rt, handle, it.evalInt(), true)
    },

    /** `Gui Array Down array address,start position` — the same the other way, $3368 */
    'gui array down': (it) => {
      const handle = it.evalInt()
      it.expect(',')
      rotateArray(rt, handle, it.evalInt(), false)
    },

    /**
     * `Gui Pub Free` — "You MUST always free a public screen when you have
     * finished with it."
     *
     * UnlockPubScreen at $2b38, and $2b2a puts `$1d2` back from `$1ca`
     * first -- so freeing the lock also puts the screen `Gui Mouse X` reads
     * back to the one before it. Freeing when nothing is locked returns at
     * $2b1e without complaint.
     */
    'gui pub free': () => {
      const g = s()
      if (g.pubLock === 0) return
      g.pubLock = 0
      g.pubName = ''
      g.current = g.beforeLock
      g.beforeLock = null
    },

    /**
     * `Gui Pub List` — "obtain a list of all public screens currently opened
     * on your Amiga".
     *
     * LockPubScreenList locks INTUITION while it is held, which is why the
     * guide shouts: "ATTENTION: While you are reading the list of screens,
     * the system is locked. You must read all the names as soon as you can!"
     *
     * Calling it twice does nothing the second time: $2b44 tests `$1da` and
     * returns if a list is already held, so it cannot leak a second lock.
     */
    'gui pub list': () => {
      const g = s()
      if (g.pubListAt < 0) g.pubListAt = 0
    },

    /**
     * `Gui Pub List Free` — "You MUST use this command when you have finished
     * with the list."
     *
     * Clears the cursor and then unlocks, and does nothing when no list is
     * held. Note that `Gui Pub Name$` frees the list ITSELF once it walks off
     * the end, so the guide's own loop has already unlocked by the time this
     * runs.
     */
    'gui pub list free': () => {
      s().pubListAt = -1
    },

    /**
     * `Gui Pub To Front SCREEN` — ScreenToFront (-$fc), where SCREEN is the
     * lock `Gui Pub Screen` returned.
     *
     * A lock of zero or less is "Illegal screen parameter": `moveq #$e,d7`
     * then `Rble` at $2bc4, before anything else. So the failure `Gui Pub
     * Screen` reports with a 0 raises here rather than being ignored.
     */
    'gui pub to front': (it) => {
      if (it.evalInt() <= 0) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
    },

    /** `Gui Pub To Back SCREEN` — ScreenToBack (-$f6), with the same guard */
    'gui pub to back': (it) => {
      if (it.evalInt() <= 0) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
    },

    /**
     * `Gui Pub Mode screen number,mode` — "Change the public status of a
     * screen".
     *
     * PubScreenStatus, and the mode is INVERTED on the way: $3fc6 turns mode
     * 0 into the flag 1 and everything else into 0, because the flag is
     * PSNF_PRIVATE. "If you set the mode to 0, the screen became PRIVATE."
     *
     * The screen is one of this extension's own, looked up by number, so
     * with `Gui Screen Open` not built every number is "Screen not opened".
     */
    'gui pub mode': (it) => {
      const g = s()
      const screen = screenOf(g, it.evalInt())
      it.expect(',')
      screen.isPublic = it.evalInt() !== 0
    },

    /**
     * `Gui Screen Open number,width,height,colours,ModeID,name$[,font$,size]`
     * — "Opens an OS public screen, with the specified ModeID and name."
     *
     * The ModeID is fixed up on the way, and which way depends on the
     * Kickstart: $4f88 compares `Gui Os` with 39, and above that anything
     * below $10000 gets PAL_MONITOR_ID added at $4fa4 -- so passing $8000,
     * graphics.library's bare HIRES_KEY, opens a PAL hires screen. Below 39
     * the same test refuses a ModeID of $21000 or more outright.
     *
     * The colours become a depth by the rotate at $4faa, which is not a
     * logarithm: see `depthForColours`.
     *
     * "The opened screen became the current screen... if you've previously
     * locked a public screen, it will be automatically unlocked", which is
     * $5150. "By default the screen is set to private state."
     */
    'gui screen open': (it) => {
      const g = s()
      if (g.release === '1.5b') return screenOpenBeta(g, it)
      const n = it.evalInt()
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      it.expect(',')
      const colours = it.evalInt()
      it.expect(',')
      let modeID = it.evalInt()
      it.expect(',')
      const name = str(it.evalExpr())
      let fontName = ''
      let fontSize = 0
      if (it.accept(',')) {
        fontName = str(it.evalExpr())
        it.expect(',')
        fontSize = it.evalInt()
      }
      // $217e: the screen NUMBER is the only argument checked before the work
      if (n === 0) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
      if (GUI_OS_VERSION >= 39) {
        if (modeID < 0x1_0000) modeID += PAL_MONITOR_ID
      } else if (modeID >= PAL_MONITOR_ID) {
        guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
      }
      // $4fd2: routine 259 again, and finding one is a failure this time.
      // DEFECT: it is not error 15. Routine 232 sets `moveq #$f,d7` and then
      // branches to $5166, which falls into a `movem.l (a7)+,d1-d7` that puts
      // d7 back the way the caller left it. All four numbers the routine
      // loads -- 24 at $4f6c, 14 at $4f86, 15 here and 16 at $5060 -- go the
      // same way, so `Gui Screen Open` raises the `moveq #$e,d7` from its own
      // $217c for every reason it can fail. Three of the extension's own
      // messages are unreachable through this keyword.
      if (g.screens.has(n)) guiError(GUI_ERR.ILLEGAL_SCREEN_PARAMETER)
      const screen: GuiScreen = {
        number: n,
        width,
        height,
        depth: depthForColours(colours),
        modeID,
        name,
        fontName,
        fontSize,
        left: 0,
        top: 0,
        showTitle: true,
        isPublic: false,
        palette: defaultPalette(depthForColours(colours)),
        rp: newScreenPort(width, height, depthForColours(colours)),
        cloned: false,
      }
      g.screens.set(n, screen)
      g.current = screen
      g.pubLock = 0
      g.pubName = ''
    },

    /**
     * `Gui Screen Close number` — "If there are some windows opened on the
     * screen, they will be automatically closed."
     *
     * "Screen not opened" for a number that names none, which routine 233
     * raises with `moveq #$11,d7` before it does anything else.
     */
    'gui screen close': (it) => {
      const g = s()
      const screen = screenOf(g, it.evalInt())
      g.screens.delete(screen.number)
      if (g.current === screen) g.current = null
    },

    /**
     * `Gui Screen Move screen,x,y`.
     *
     * THREE arguments, and the last two are absolute. The guide says
     * `Gui Screen Move deltaX,deltaY` and "moves the screen by the specified
     * pixels increments"; the token table's spec is `I0,0,0` and $39cc
     * subtracts `Screen.LeftEdge` and `TopEdge` from what it was given before
     * handing the difference to MoveScreen, which is the call that takes
     * deltas. So this moves a screen TO a position, not BY one.
     *
     * "If the DeltaX and DeltaY variables you specify would move the screen
     * in a way that violates any system restriction, the screen will be moved
     * as far as possible" -- that clamp is intuition's and is not modelled,
     * because nothing here displays a screen to clamp against.
     */
    'gui screen move': (it) => {
      const g = s()
      const screen = screenOf(g, it.evalInt())
      it.expect(',')
      screen.left = it.evalInt()
      it.expect(',')
      screen.top = it.evalInt()
    },

    /**
     * `Gui Show Title screen,mode` — "Show/Hide the title bar of the
     * specified screen ... If you hide the title bar, you can't drag the
     * screen!"
     *
     * DEFECT: the wrong error. $3892 is `moveq #$f,d7` before the screen
     * lookup, and 15 is "Screen already open" -- the message for a number
     * that is taken, on a path that fails because the number is FREE. Every
     * other keyword that looks a screen up passes 17.
     */
    'gui show title': (it) => {
      const g = s()
      const n = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      const screen = g.screens.get(n)
      if (screen === undefined) guiError(GUI_ERR.SCREEN_ALREADY_OPEN)
      screen.showTitle = mode !== 0
    },

    /** `Gui Off window` — lock a GUI, so it stops answering events */
    'gui off': (it) => {
      windowOf(s(), it.evalInt()).locked = true
    },

    /** `Gui On window` — unlock one */
    'gui on': (it) => {
      windowOf(s(), it.evalInt()).locked = false
    },

    /**
     * `Gui Lock window` — lock everything EXCEPT that one.
     *
     * "Gui Lock will disable all the open windows except the specified
     * window", which is the opposite of what its name and its place beside
     * `Gui Unlock` suggest. Its spec is `I0`, one argument, and a lock-them-
     * all reading would have taken none.
     *
     * "It can also be used to force a user to make a selection in a specific
     * window", which is what the exception is for.
     */
    'gui lock': (it) => {
      const g = s()
      const keep = it.evalInt()
      windowOf(g, keep)
      for (const w of g.windows.values()) w.locked = w.number !== keep
    },

    /** `Gui Unlock` — unlock all of them */
    'gui unlock': () => {
      for (const w of s().windows.values()) w.locked = false
    },

    /**
     * `Gui Ink colour` — "set the ink colour for future gfx commands such as
     * Gui Draw and Gui Plot".
     */
    'gui ink': (it) => {
      const n = it.evalInt()
      gfx(s()).ink = n
    },

    /**
     * `Gui Pen colour` — the FrontPen `Gui Text` draws with.
     *
     * It is not a window's and not a RastPort's: $260a writes one byte to
     * `$290` of the extension's state and does nothing else. `Gui Text`
     * copies it into an IntuiText at $25cc. So changing the Gfx output does
     * not change the pen, which is the opposite of how `Gui Ink` behaves.
     */
    'gui pen': (it) => {
      s().pen = it.evalInt() & 0xff
    },

    /** `Gui Paper colour` — the BackPen of the same IntuiText, at `$28e` */
    'gui paper': (it) => {
      s().paper = it.evalInt() & 0xff
    },

    /**
     * `Gui Writing mode` — both a state byte and a RastPort mode.
     *
     * $2616 stores it at `$292` for `Gui Text` to read as the IntuiText
     * DrawMode, AND calls SetDrMd on the Gfx RastPort. So it is the one of
     * the three that needs an output open, and the only one that raises
     * "Gfx output not defined".
     */
    'gui writing': (it) => {
      const n = it.evalInt()
      const g = s()
      gfx(g).writing = n
      g.writing = n & 0xff
    },

    /**
     * `Gui Cls colour` — "clears all of the current graphics output".
     *
     * The guide warns what it is not: "Gui Cls will also clear all of the
     * window borders! To clear only graphics, you should use Gui Clw". Since
     * a window here has no border drawn into its own bitmap, the two differ
     * only in which window they take, which is where that difference lives
     * until borders are drawn.
     */
    'gui cls': (it) => {
      const c = it.evalInt()
      gfx(s()).rp.setRast(c)
    },

    /**
     * `Gui Clw window,colour` --- "clear all of the graphics from the specified
     * window... screen borders and titles will be left intact, unlike Gui
     * Cls".
     *
     * It is a RectFill of the INTERIOR and not a SetRast, which is exactly
     * the difference the guide names. $29be builds the box out of the
     * Window's own four border bytes --- BorderLeft `$36`, BorderTop `$37`,
     * BorderRight `$38`, BorderBottom `$39` --- as
     * `(left, top) To (width - right - 1, height - bottom - 1)`, and calls
     * RectFill (-$132) on the window's RPort.
     *
     * The colour is optional and the routine says so: `cmpi.l #$80000000,d1 /
     * beq` at $29a0 skips the SetAPen entirely, so `Gui Clw 1` fills with
     * whatever FgPen the last `Gui Ink` left. When a colour IS given, the old
     * FgPen is saved out of `$19` of the RastPort and put back at $29ec, so
     * this keyword does not disturb the ink.
     */
    'gui clw': (it) => {
      const n = it.evalInt()
      const c = it.accept(',') ? it.evalInt() : OMITTED
      // this one names its window, so it raises 10 rather than 11
      const w = windowOf(s(), n)
      const pen = c === OMITTED ? w.ink : c
      w.rp.rectFill(WBORLEFT, TITLE_HEIGHT, w.width - WBORRIGHT - 1, w.height - WBORBOTTOM - 1, pen)
    },

    /**
     * `Gui Plot x,y` --- WritePixel (-$144), and nothing else.
     *
     * Thirty-four bytes, no clamp and no cursor: WritePixel does not move
     * rp_cp, so `Gui Plot 10,10 : Gui Draw To 50,50` draws from wherever the
     * last line ended and not from the plot.
     */
    'gui plot': (it) => {
      const [x, y] = pair(it)
      const w = gfx(s())
      w.rp.plot(x, y, w.ink)
    },

    /**
     * `Gui Draw x,y To x2,y2` --- the `t` in its spec `I0,0t0,0` is the `To`.
     *
     * Move (-$f0) then Draw (-$f6), so AMOS's own Draw leaves the graphics
     * cursor at the far end and `Gui Draw To` continues from it.
     *
     * BOTH endpoints go through the clamp at $2036 first. See `clampOut`: a
     * line that runs off the output has its endpoint MOVED rather than
     * clipped, so its slope changes.
     */
    'gui draw': (it) => {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      const w = gfx(s())
      const [cx1, cy1] = clampOut(w, x1, y1)
      const [cx2, cy2] = clampOut(w, x2, y2)
      w.rp.draw(cx1, cy1, cx2, cy2, w.ink)
      w.grX = cx2
      w.grY = cy2
    },

    /** `Gui Draw To x,y` — on from wherever the cursor was left, clamped */
    'gui draw to': (it) => {
      const [rx, ry] = pair(it)
      const w = gfx(s())
      const [x, y] = clampOut(w, rx, ry)
      w.rp.draw(w.grX, w.grY, x, y, w.ink)
      w.grX = x
      w.grY = y
    },

    /**
     * `Gui Bar x,y To x2,y2` --- "a solid block... in exactly the same way as
     * the AMOS command BAR", which is RectFill (-$132) at $2090.
     *
     * Both corners take the same clamp `Gui Draw` takes, and nothing orders
     * them: RectFill wants xMin before xMax and this hands it what the
     * program wrote. ../amiga/graphics.ts normalises, which is where a
     * reversed pair stops being observable.
     */
    'gui bar': (it) => {
      const [rx1, ry1] = pair(it)
      it.expect('to')
      const [rx2, ry2] = pair(it)
      const w = gfx(s())
      const [x1, y1] = clampOut(w, rx1, ry1)
      const [x2, y2] = clampOut(w, rx2, ry2)
      // RectFill leaves rp_cp where it was, so no cursor is written here
      w.rp.rectFill(x1, y1, x2, y2, w.ink)
    },

    /**
     * `Gui Box x,y To x2,y2` — the outline of the same rectangle.
     *
     * DEFECT: it is the only drawing keyword that does NOT check the Gfx
     * output. $48f6 loads `$1bc(a1)` into a1 and writes `$24(a1)` and
     * `$26(a1)` without testing it, where `Gui Bar` beside it tests and
     * raises "Gfx output not defined". With no output open a1 is zero and
     * those two writes land at absolute $24 and $26, inside the 68000's
     * exception vectors. This port has no such address, so it draws nothing
     * instead; what is reproduced is that it does not raise.
     */
    'gui box': (it) => {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      const w = target(s())
      if (w === null) return
      const l = Math.min(x1, x2)
      const r = Math.max(x1, x2)
      const t = Math.min(y1, y2)
      const b = Math.max(y1, y2)
      w.rp.draw(l, t, r, t, w.ink)
      w.rp.draw(l, b, r, b, w.ink)
      w.rp.draw(l, t, l, b, w.ink)
      w.rp.draw(r, t, r, b, w.ink)
      w.grX = x1
      w.grY = y1
    },

    /**
     * `Gui Ellipse x,y,rx,ry` --- DrawEllipse (-$b4), and nothing else.
     *
     * No clamp and no range check: routine 34 tests `$1bc` for a Gfx output
     * and calls the library with what it was given. A zero radius reaches
     * DrawEllipse, which draws the degenerate case as a point, and that is
     * what `RastPort.ellipse` does with it too.
     */
    'gui ellipse': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const rx = it.evalInt()
      it.expect(',')
      const ry = it.evalInt()
      const w = gfx(s())
      w.rp.ellipse(x, y, rx, ry, w.ink)
    },

    /**
     * `Gui Paint x,y` --- "Works in exactly the same way as the Amos command
     * Paint. It will simply fill any section of the current gfx output with a
     * solid block of colour using the currently defined ink."
     *
     * It does not work the same way as AMOS's Paint. $2c80 is `moveq #$1,d2`
     * before Flood (-$14a), which is OUTLINE mode: it spreads over every
     * connected pixel that is NOT rp_AOlPen. Nothing in this extension sets
     * AOlPen --- there is no keyword for it --- so the boundary is always
     * colour 0 whatever the program drew its outline in, and a region cleared
     * to 0 cannot be filled at all. jd-int passes the same 1 for the same
     * reason and ./jdint.ts says so at `Jd Intfill`.
     *
     * The TmpRas around it is real: AllocRaster (-$1ec) of width*8 by height,
     * InitTmpRas (-$1d4) on the state's own `$256`, and FreeRaster (-$1f2)
     * after. ../amiga/graphics.ts keeps the visited set instead and says why.
     */
    'gui paint': (it) => {
      const [x, y] = pair(it)
      const w = gfx(s())
      w.rp.flood(1, x, y, w.ink)
    },

    /**
     * `Gui Bbox x,y,xx,yy,mode` — "If mode is set to anything other than 0,
     * then the box is drawn recessed."
     *
     * This is gadtools' own DrawBevelBoxA, and `../amiga/gadtools.ts` reads
     * that same sentence out of GUI2.guide when it explains what recessed
     * means. The two agree because they are the same call.
     */
    'gui bbox': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      const g = s()
      const w = gfx(g)
      drawBevelBox(w.rp, x, y, width, height, bevelPens(w, g), { recessed: mode !== 0 })
    },

    /**
     * `Gui Set window,gadget,attribute,value`.
     *
     * The guide's own table decides what each attribute means, and it depends
     * on the kind: attribute 0 is the value for every kind that has one,
     * attribute 1 is a LISTVIEW's array, a SCROLLER's total or a SLIDER's
     * MINIMUM, and attribute 2 is a LISTVIEW's top item, a SLIDER's MAXIMUM
     * or a SCROLLER's VISIBLE size. One number, three meanings, chosen by
     * what the gadget is.
     *
     * Attribute -1 is the odd one and is documented separately: "you just
     * need to use the attribute -1 and the value 0/1 to" ghost a gadget, and
     * the guide's examples read `Gui Set 1,5,-1,1 : Rem Gadget number 5 in
     * win 1 is turned OFF`.
     *
     * DEVIATION: STRING and TEXT. Their attribute 0 wants a pointer -- "you
     * MUST use Varptr(String) as value" -- and nothing here can dereference
     * one into the string a program meant. That path is ignored rather than
     * guessed at, and `Gui Set$` is the one that works, which is what the
     * guide points at anyway: "It's a shortcut of the Gui Set command."
     */
    'gui set': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const attr = it.evalInt()
      it.expect(',')
      const value = it.evalInt()
      const g = s()
      const w = windowOf(g, win)
      // routine 241's two checks, in its order: the attribute first
      // (`cmpi.l #$ffffffff,d3 / blt` at $603a), then the gadget
      if (attr < -1) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      if (g.gadget(w, id) === null) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      if (attr === -1) {
        if (value === 0) w.ghosted.delete(id)
        else w.ghosted.add(id)
        return
      }
      if (attr < 0 || attr > 2) return
      g.attrsOf(w, id)[attr as 0 | 1 | 2] = value
    },

    /**
     * `Gui Set$ window,gadget,string` — the shortcut for a string or text
     * gadget that does not need a Varptr.
     */
    'gui set$': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const text = str(it.evalExpr())
      const g = s()
      const w = windowOf(g, win)
      if (g.gadget(w, id) === null) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      w.strings.set(id, text)
    },

    /**
     * `Gui Range window,gadget,minvalue,maxvalue` — "All the values entered
     * by the user will be clipped in the specified range."
     *
     * The guide's example is worth keeping because it says which way the clip
     * goes at both ends: "if you have done Gui Range 1,1,10,20, and the user
     * inputs 5, it will automatically be set to 10. Similarly, if the user
     * inputs 2273226, it will be set to 20."
     */
    'gui range': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      it.expect(',')
      const lo = it.evalInt()
      it.expect(',')
      const hi = it.evalInt()
      const g = s()
      // $2524 compares the two before looking at anything else, and calls a
      // reversed range "Illegal gadget value" rather than an illegal range
      if (hi < lo) guiError(GUI_ERR.ILLEGAL_GADGET_VALUE)
      const w = windowOf(g, win)
      const gad = g.gadget(w, id)
      // "This isn't a Integer/String Gadget", though only INTEGER passes:
      // `cmpi.l #$3,d0 / Rbne` at $2532 tests one kind, where `Gui Activate`
      // beside it tests two
      if (gad === null || gad.kind !== AMOS_KIND_INTEGER) guiError(GUI_ERR.NOT_AN_INPUT_GADGET)
      w.ranges.set(id, [lo, hi])
    },

    /**
     * `Gui Menu On window,menu,item,sub` — "Activate a menu", which is
     * intuition's `OnMenu` (-$c0) at $4250 with nothing between it and the
     * three arguments but the packer at $4c10.
     *
     * The arguments are one-based and a zero means "none", so
     * `Gui Menu On 1,2,0,0` enables the whole of the second menu and
     * `Gui Menu On 1,2,3,0` enables its third item. See `packMenuNumber`.
     */
    'gui menu on': (it) => menuEnable(it, true),

    /** `Gui Menu Off window,menu,item,sub` — `OffMenu` (-$b4) at $427c */
    'gui menu off': (it) => menuEnable(it, false),

    /**
     * `Gui Menu Check window,menu,item,sub` — "Checkmark a menu item".
     *
     * $4284 does it by hand rather than through a library call: ItemAddress
     * for the MenuItem, `ori.w #$100,$c(a0)` to set CHECKED in its Flags, and
     * `ResetMenuStrip` to make intuition redraw the bar.
     *
     * It reads the strip out of `$16(a0)` first and gives up when it is zero,
     * so a window whose design carries no menus is a no-op rather than an
     * error.
     */
    'gui menu check': (it) => menuCheck(it, true),

    /**
     * `Gui Menu Uncheck window,menu,item,sub`.
     *
     * DEFECT: `andi.w #$ff,$c(a0)` at $4302 clears the WHOLE high byte of
     * Flags, not just CHECKED. ISDRAWN, HIGHITEM and MENUTOGGLED go with it.
     * Only MENUTOGGLED is a program-visible loss: an item the user had
     * toggled forgets that it was, so the next pick sets it rather than
     * clearing it. The other two intuition rebuilds on the next render. This
     * port clears the same four bits.
     */
    'gui menu uncheck': (it) => menuCheck(it, false),

    /**
     * `Gui Activate window,gadget` — "activate the specified input gadget
     * (wether it be a string/integer gadget) encouraging the user to type
     * something in".
     *
     * The two kinds are named by number at $2836 and $283e: 3 and $c, which
     * are INTEGER and STRING. Anything else is "This isn't a Integer/String
     * Gadget", and it is checked BEFORE the window is looked up -- routine
     * 237 answers 0 for a window that is not open, and 0 is not 3 or 12, so a
     * closed window reaches error 19 rather than error 10.
     */
    'gui activate': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      const g = s()
      const w = g.windows.get(win)
      const kind = w === undefined ? -1 : (g.gadget(w, id)?.kind ?? -1)
      if (kind !== AMOS_KIND_INTEGER && kind !== AMOS_KIND_STRING) guiError(GUI_ERR.NOT_AN_INPUT_GADGET)
      g.activeGadget = id
    },

    /**
     * `Gui Amiga Os` — "Hide AMOS to a certain degree".
     *
     * The guide's list is long: Amos To Back, Amos Lock, Comp Test Off, Break
     * Off, and the AMOS interrupt removed, so that "AMAL, Music, Samples and
     * VBL interrupts" all stop working. Then the line that governs the whole
     * keyword: *"Note that all this only takes effect when your program is
     * compiled!"*
     *
     * $1d90 is that sentence as a branch. `cmpi.w #$1,-$16(a5) / bne` sends
     * everything but a 1 down the long path at $1da4 — StopVBL through the
     * SyCall table, the vector patch at `$8c`/`$a` of `-$1c(a5)`, `-$90(a5)`
     * forced to $ffff, and ScreenToFront (-$fc) on the screen at `$1d2`. A 1
     * takes four instructions instead: `moveq #$0,d1` and one AMOS_WB, which
     * is `Amos To Back`.
     *
     * The word at `-$16(a5)` is the same one AMCAF guards every routine with,
     * `tst.w -$16(a5) / bmi` into its "Nicht kompilierbar!" requester — see
     * ./amcaf.ts's header. Negative there is the compiler; exactly 1 here is
     * the interpreter. Two extensions, read apart, agree with the guide.
     *
     * This port is an interpreter, so the short path is the one it takes and
     * `Amos To Back` is the whole keyword.
     */
    'gui amiga os': () => {
      rt.amosToBack()
    },

    /**
     * `Gui Eye 3d x,y` — "change the x,y position of the eye in the 3d
     * space".
     *
     * Two words at `$2a4` and `$2a6` and nothing else: $3d4e pops both, moves
     * them in word-wide, and returns. No screen is wanted, no window, no
     * range check, and there is no reader but `Gui Line 3d`.
     */
    'gui eye 3d': (it) => {
      const [x, y] = pair(it)
      const g = s()
      g.eyeX = (x << 16) >> 16
      g.eyeY = (y << 16) >> 16
    },

    /**
     * `Gui Line 3d x,y,z To x1,y1,z1` — "draw a line in a 3d space using the
     * x,y,z coords... It's the equivalent of the Turbo Plus extension".
     *
     * The projection is four instructions per point, at $3d16 and $3d34:
     *
     *     asl.l #$7,d0 / divs.w d2,d0 / add.w d6,d0
     *
     * so a coordinate is multiplied by 128, divided by its own Z, and offset
     * by the eye. 128 is the focal length and it is not settable. Then Move
     * (-$f0) and Draw (-$f6) on the RastPort at `$1bc`.
     *
     * `divs.w` is a WORD divide of a longword, so an X above 511 with a Z of
     * 1 overflows the quotient and the 68000 leaves the destination alone.
     * Reproduced: the point stays where the previous divide left it.
     *
     * DEFECT: a Z of zero raises error 20, which is "Socket not opened!".
     * $3d48 is `moveq #$14,d7` and the string at index $14 belongs to the TCP
     * group. The guide does not mention the error at all, and there is no
     * message in the table that would have been right — division by zero is
     * not one of the extension's thirty-five.
     *
     * DEFECT: `$1bc` is dereferenced unguarded at $3d24. Every other drawing
     * keyword tests it and raises 11; this one does not, so `Gui Line 3d`
     * before `Gui Gfx` hands Move a RastPort at address zero.
     *
     * DEVIATION: that is the one thing here not reproduced. This port raises
     * the 11 the rest of the group raises, because there is no address zero
     * to write through and answering nothing would hide the mistake instead
     * of reporting it.
     */
    'gui line 3d': (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const z = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const z2 = it.evalInt()
      // both Z tests come first, and the far one is tested before the near
      // one is even popped: $3cfc guards on d5 and $3d04 on d2
      if (z2 === 0 || z === 0) guiError(GUI_ERR.SOCKET_NOT_OPENED)
      const g = s()
      const w = gfx(g)
      const [px, py] = project3d(x, y, z, g)
      const [qx, qy] = project3d(x2, y2, z2, g)
      w.rp.draw(px, py, qx, qy, w.ink)
      w.grX = qx
      w.grY = qy
    },

    /**
     * `Gui Timer seconds,micro seconds` — "send a timer request and returns
     * immediately the control to your program... when the specified time
     * period is elapsed Gui Wait will inform you (event -13)".
     *
     * $4314 fills the IORequest at `$108`: `$20` tv_secs, `$24` tv_micro,
     * `$1c` io_Command = 9, which is TR_ADDREQUEST, then SendIO (-$1ce). Bit
     * 5 of `$85` is the guard, and it is tested BEFORE anything is written —
     * `btst.b #$5,$85(a0) / bne` at $431c returns without touching the
     * request. That is the guide's *"Before sending a new timer request,
     * you've to wait the end of the previous one otherwise it'll be
     * ignored!"*, and "ignored" is exact: no error, no reply, nothing.
     *
     * DEVIATION: there is no timer.device under these windows. The request
     * comes due on a frame count instead, at 50Hz, and `Gui Wait` and `Gui
     * Event` are where it is noticed — which is where the machine notices it
     * too, since the pump is what reads the reply port.
     */
    'gui timer': (it) => {
      const [secs, micros] = pair(it)
      const g = s()
      if (g.timerAt !== null) return
      g.timerAt = rt.frames + Math.round((secs + micros / 1_000_000) * VBL_HZ)
    },

    /**
     * `Gui Put file$,string$` — "Place a string into a file".
     *
     * Open (MODE_NEWFILE, $3ee), Write, Close, and the routine at $3130 is
     * nothing else. The length comes from the AMOS string's own word, so an
     * embedded zero is written like any other byte, and the FILENAME is
     * passed as a C string: `move.w (a0)+,d0` throws the length away and
     * hands Open the characters, which work only because routine 249 puts a
     * NUL after every string it builds.
     *
     * "Unable to open file" is the whole error handling. A Write that fails
     * partway is not noticed.
     */
    'gui put': (it) => {
      const name = it.evalStr()
      it.expect(',')
      const text = it.evalStr()
      if (rt.vfs?.writeFile(name, toBytes(text)) !== true) guiError(GUI_ERR.UNABLE_TO_OPEN_FILE)
    },

    /**
     * `Gui Output string` — "Send a line of text to the current output
     * stream, for the example the Shell used to run the program".
     *
     * $32bc: an empty string returns without doing anything, and everything
     * else is WriteChars (-$3ae), which writes to the process's own output
     * without asking for a handle.
     *
     * DEVIATION: this port has no shell, so on the machine there would be no
     * output stream and the text would be lost. It goes to the AMOS console
     * instead, for the reason ./amcaf.ts gives at `Write Cli`: the routine
     * does not test the handle, so there is no branch to take, and a program
     * that used this to report something has somewhere to report it. Where a
     * routine DOES test — craft's `Cli Print`, which is `beq` straight out —
     * this port takes the null branch and drops the text.
     */
    'gui output': (it) => {
      const text = it.evalStr()
      if (text === '') return
      it.write(text)
    },

    /**
     * `Gui Clip Write$ string` — "Put the specified string in the system
     * clipboard".
     *
     * $485e builds an IFF FORM FTXT by hand: FORM, the size, FTXT, CHRS, the
     * length, then the bytes, into an AllocVec of `len + $14` — twenty bytes
     * of header for exactly that much header. Then Write, Close, FreeVec.
     *
     * DEFECT: the write runs one byte past the allocation on every ODD
     * length. $48ae computes the FORM size as `(len + $d) & $fffe`, which
     * rounds an odd length up to include IFF's pad byte, and $48ba adds 8 for
     * the FORM header itself to get the byte count. For len 5 that is 26
     * bytes out of a 25-byte buffer. The FILE is correct IFF either way; what
     * the machine appends as the pad is whatever followed the allocation,
     * where this port appends a zero.
     *
     * A clipboard that will not open is not an error: $487c is `beq` to the
     * exit. With no CLIPS: handler mounted that is every call, which is what
     * an Amiga with no clipboard.device does too.
     */
    'gui clip write$': (it) => {
      const text = it.evalStr()
      const len = text.length & 0xffff
      const form = (len + 0xd) & 0xfffe
      const out = new Uint8Array(form + 8)
      out.set(toBytes('FORM'), 0)
      new DataView(out.buffer).setUint32(4, form)
      out.set(toBytes('FTXTCHRS'), 8)
      new DataView(out.buffer).setUint32(16, len)
      out.set(toBytes(text).subarray(0, len), 20)
      rt.vfs?.writeFile(CLIPBOARD_PATH, out)
    },

    /**
     * `Gui Rem Notify id` — stop one of `Gui Notify`'s watches.
     *
     * No guide node; the contents list links to one that was never written.
     * Routine 262 at $781c walks the chain from `$1a4` looking for the node
     * whose address is the id, unlinks it, EndNotify (-$37e), FreeVec. An id
     * it does not find is not an error and not anything else either — the
     * walk falls off the end and the routine returns.
     */
    'gui rem notify': (it) => {
      const id = it.evalInt()
      const g = s()
      const held = g.notifies.get(id)
      if (held === undefined) return
      held.stop()
      g.notifies.delete(id)
    },

    /**
     * `Gui Catalog Close catalog-ID` — "Close the specified catalog. The
     * memory allocated for the catalogs isn't deallocated automatically by
     * the extension, and so at the end of the program, you must use this
     * command."
     *
     * $3bde is CloseCatalog (-$24) and nothing else — no check that the id is
     * one, no check that locale.library is open, no unlinking of the pointer
     * the bank's designs still hold. The guide is blunt about the last of
     * those: "NEVER close a catalog when there are some GUI using its
     * strings!!!" and "some strange effects will appear if you use a
     * incorrect value".
     *
     * DEFECT: the bank goes on pointing at the freed catalog. `$34` of every
     * design still holds it, so a `Gui Catalog$` or a `Gui Open` after this
     * reads freed memory. Here the pointer is dropped with the catalog, which
     * is the behaviour the routine would have had if it had cleared the field
     * — the same rendering ./locale.ts's `Close Catalog` chose for the same
     * omission.
     */
    'gui catalog close': (it) => {
      const g = s()
      const id = it.evalInt()
      const cat = g.catalogs.get(id)
      if (cat === undefined) return
      g.catalogs.delete(id)
      if (g.catalog === cat) g.catalog = null
    },

    /**
     * `Gui Help window,display gadget,array address` — "When the user move
     * the mouse pointer over a gadget of your GUI, a message defined by you
     * will be automatically displayed into the specified display gadget."
     *
     * $38ca sets WFLG_REPORTMOUSE in the window and adds 2 to the flags word
     * at `$3e` of the Header Info block, then parks the array at `$42`, the
     * display gadget at `$46` and zeroes the "last gadget" at `$40`. The
     * guide's own way to turn it off is "call it again with the array address
     * set to 0", and $38ea takes that branch on anything NOT GREATER than
     * zero.
     *
     * Turning it off when it was never on returns without touching a thing:
     * $38ee tests the flags word against 1 and leaves. Turning it ON twice
     * adds the 2 only once, the same guard `Gui Mouse Report` has on bit 0.
     *
     * The guide's warning is not enforced anywhere: "Obviously the 'display
     * gadget' MUST! be a TEXT or STRING gadegt!!!" is nowhere in the routine,
     * and $6eb0 writes to whatever number it was given.
     */
    'gui help': (it) => {
      const win = it.evalInt()
      it.expect(',')
      const display = it.evalInt()
      it.expect(',')
      const array = it.evalInt()
      const w = windowOf(s(), win)
      if (array > 0) {
        if (!w.helpOn) w.helpOn = true
      } else {
        if (!w.helpOn) return
        w.helpOn = false
      }
      w.helpArray = array > 0 ? array : 0
      w.helpGadget = array > 0 ? display : 0
      w.helpLast = 0
    },

    /**
     * `Gui Guide document` — "This command allows you to display a AmigaGuide
     * document. Your program is freezed until the amigaguide doc will be
     * closed."
     *
     * $3930 opens amigaguide.library once and keeps the base at `$138`, then
     * AllocVecs a $34-byte NewAmigaGuide, fills in `$4` with the document
     * name and `$8` with the screen at `$1d2`, and calls -$36 and -$42 back
     * to back — open the guide, wait, close it. A library that will not open
     * is not an error: $395e takes the `beq` straight to the rts.
     *
     * DEVIATION: there is no amigaguide.library here, so this port takes the
     * branch a machine without one takes and the keyword does nothing. That
     * is a real path rather than a stub — the same shape as a clipboard with
     * no CLIPS: handler — and the document name is still evaluated, which is
     * all a program can observe.
     */
    'gui guide': (it) => {
      it.evalStr()
    },

    /**
     * `Xfa Play file name,loop,auto pause,wait start,slow,mode id` and `Xfa
     * Rtg Play`, its gfx-card twin — "Play the specified XFA animation file".
     *
     * XFA is Michele Puccini's delta-frame format for ClassX's X-DVE, and the
     * guide gives it a chapter of its own: *"you will obtain 256 colours
     * super-hires overscan 1472x566 50fps animations... if you believe in
     * miracles"*. All nine keywords are xfa.library and nothing else.
     *
     * $3d66 and $3e36 are the same routine twice over, and `Tools/FD/xfa_lib.fd`
     * in the GUI archive names every call in them:
     *
     *     XFA_LoadAnim  (-$8a)   header only with d0 = 0, then again with $ff
     *     XFA_HeadPtr   (-$c6)   the header the first load read
     *     XFA_AllocFrames (-$66) with the frame count out of `$a` of it
     *     XFA_OpenPlayStuff (-$ba) / XFA_OpenCyberPlayStuff (-$102)
     *     XFA_Play      (-$a8)   / XFA_CyberPlay             (-$fc)
     *     XFA_ClosePlayStuff (-$c0) / XFA_CloseCyberPlayStuff (-$108)
     *     XFA_FreeAnim  (-$6c)
     *
     * The five booleans go to XFA_Play in the order they are written; the
     * SIXTH argument, mode id, goes to OpenPlayStuff instead, which is why it
     * is popped first. Around the play, `-$8e(a5)` decides whether AMOS goes
     * to the back and comes forward again — the same AMOS_WB pair `Gui Amiga
     * Os` uses, with `-$90(a5)` set to $ffff and back to 0.
     *
     * Each stage loads its own error number into a3 before it tries: 27
     * "xfa.library not available", 28 "Unable to load xfa file", 29 "Unable
     * to allocate xfa frames", 30 "Unable to play xfa anim". $3e2e tests a3
     * and raises only if it is not zero.
     *
     * DEVIATION: xfa.library is not modelled and is not in the corpus — the
     * GUI archive ships its `.fd` and two tools, not the library, and there
     * is no `.xfa` file anywhere to read the format off either. So this port
     * takes the branch $3d80 takes on a machine that has not got it, which is
     * the first error and the one the extension has a string for.
     */
    'xfa play': (it) => {
      xfaArgs(it)
      guiError(GUI_ERR.XFA_NOT_AVAILABLE)
    },
    'xfa rtg play': (it) => {
      xfaArgs(it)
      guiError(GUI_ERR.XFA_NOT_AVAILABLE)
    },

    /**
     * `Gui Paste Block block,x,y`, `Gui Paste Icon icon,x,y` and `Gui Paste
     * Bob image,x,y` — the same routine three times over a different bank.
     *
     * $20e4 walks AMOS's own block list at `-$189e(a5)` comparing `$8` of
     * each node and takes `$14` for the image; $2118 and $2136 go through
     * `L_Bnk_GetIcons` and `L_Bnk_GetBobs` and let routine 257 index them.
     * All three then hand the image to routine 256, which builds a `struct
     * Image` and calls DrawImage (-$72).
     *
     * "The palette of the block will only turn out correct if the screen
     * palette has been set accordingly, using a command such as Gui Rgb" —
     * nothing here touches the palette, and the colour is the bank's index
     * masked to the destination's depth.
     *
     * Error 12 "Image not reserved" for a number no bank answers to, and 11
     * "Gfx output not defined" from routine 256 when `$1bc` is empty. The
     * gadget bound is `cmp.l d0,d1 / bgt` at $7502 against the bank's own
     * count, and $74fa refuses zero and below before that.
     */
    'gui paste block': (it) => {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      const b = rt.blocks.get(n)
      if (b === undefined) guiError(GUI_ERR.IMAGE_NOT_RESERVED)
      drawAmosImage(gfx(s()).rp, { width: b.w, height: b.h, depth: 8, pixels: b.pixels }, x, y)
    },
    'gui paste icon': (it) => {
      pasteBankImage(rt, it, rt.iconBank)
    },
    'gui paste bob': (it) => {
      pasteBankImage(rt, it, rt.spriteBank)
    },

    /**
     * `Gui Scroll x,y to xx,yy,numx,numy` — "scrolls the area x,y to xx,yy by
     * numx pixels horizontally, and numy pixels vertically".
     *
     * $2322 is six pops and one call: ScrollRaster (-$18c) on the RastPort at
     * `$1bc`, with the registers in graphics.library's own order —
     * `(rp,dx,dy,xMin,yMin,xMax,yMax)` in a1, d0/d1, d2/d3/d4/d5. So the
     * LAST two arguments are the distance and the first four are the box,
     * which is the opposite way round from how the guide's `Usage` line
     * reads.
     */
    'gui scroll': (it) => {
      const [x, y] = pair(it)
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      scrollRaster(gfx(s()).rp, dx, dy, x, y, x2, y2)
    },

    /**
     * `Gui Screen Copy src,x,y,width,height To dest,x2,y2`.
     *
     * No guide node. $418a resolves each end three ways, and the sign is what
     * chooses: ABOVE zero is a GUI screen by number, through routine 259 and
     * `lea $54`; ZERO is the current gfx output at `$1bc`; BELOW zero is
     * AMOS's own screen at `-$18ca(a5)`. Then BltBitMapRastPort (-$25e) with
     * minterm $c0 — the source end takes `$4` of its RastPort for the BitMap,
     * the destination end stays a RastPort.
     *
     * Which means the two middle arguments are a SIZE and not a second
     * corner: d4 and d5 land in BltBitMapRastPort's xSize and ySize.
     *
     * "Screen not opened" for a number that names no screen, and the same for
     * either end that resolves to nothing.
     */
    'gui screen copy': (it) => {
      const g = s()
      const src = it.evalInt()
      it.expect(',')
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      it.expect(',')
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      it.expect('to')
      const dst = it.evalInt()
      it.expect(',')
      const [dx, dy] = pair(it)
      bltRect(copyEnd(rt, g, src), sx, sy, copyEnd(rt, g, dst), dx, dy, w, h)
    },

    /**
     * `Gui Display bank To screen,mode` — "Display the IFF file loaded in the
     * bank, into the specified screen. If the screen already exist, it will
     * be closed and reopened."
     *
     * Routine 146 is four instructions over routine 147, which is 562 bytes
     * of hand-written ILBM reader: it walks the chunks at $351a, keeps BMHD's
     * width, height, depth, compression and mask in the scratch at `$2b8`,
     * remembers CMAP's address and CAMG's longword, and unpacks BODY. The
     * mode word decides between reopening the screen from the BMHD ($35de,
     * routine 233) and demanding that the picture FIT the one already open —
     * `cmp.w $c(a0),d0 / bhi` with `moveq #$1a,d7`, "Unable to display
     * picture".
     *
     * DEVIATION: `../amiga/ilbm.ts` does the reading here, and it is the
     * better reader — it knows HAM and EHB, which routine 147 does not — so a
     * picture this port draws may differ from what the extension's own
     * unpacker would have made of it. The chunk set is the same five.
     */
    'gui display iff': (it) => {
      const g = s()
      const bankNo = it.evalInt()
      it.expect('to')
      const n = it.evalInt()
      const mode = it.accept(',') ? it.evalInt() : 0
      const held = rt.memBanks.get(bankNo)
      if (held === undefined) guiError(GUI_ERR.BANK_NOT_RESERVED)
      const screen = screenOf(g, n)
      let img
      try {
        img = parseIlbm(Uint8Array.from(held.data))
      } catch {
        guiError(GUI_ERR.UNABLE_TO_DISPLAY)
      }
      if (mode !== 0) {
        // $35de reopens the screen at the picture's own size and depth
        screen.width = img.width
        screen.height = img.height
        screen.depth = img.depth
        screen.rp = newScreenPort(img.width, img.height, img.depth)
      } else if (img.width > screen.width || img.height > screen.height) {
        guiError(GUI_ERR.UNABLE_TO_DISPLAY)
      }
      for (const [i, c] of img.palette.entries()) setColour(screen, i, expand12(c))
      for (let y = 0; y < img.height && y < screen.rp.bitMap.height; y++) {
        for (let x = 0; x < img.width && x < screen.rp.bitMap.width; x++) {
          screen.rp.putPixel(x, y, img.pixels[y * img.width + x]!)
        }
      }
    },

    /**
     * `Gui Save Iff screen number,file name` — "It allows you to save the
     * specified screen as a IFF image."
     *
     * The guide is blunt about the catch and the binary agrees: *"IMPORTANT:
     * This command requires the xfa.libray!"* $3ff6 loads `moveq #$1b,d7`
     * before it looks at anything, tests `$140` and raises 27 if the library
     * is not open. Only then does it look the screen up (17) and call
     * XFA_SaveScreen (-$de).
     *
     * DEVIATION: no xfa.library here, so this is the first branch — the same
     * one the nine `Xfa` keywords take, and this port could write the IFF
     * perfectly well without it. See `Xfa Play`.
     */
    'gui save iff': (it) => {
      it.evalInt()
      it.expect(',')
      it.evalStr()
      guiError(GUI_ERR.XFA_NOT_AVAILABLE)
    },

    /**
     * `Gui Clone GUI Screen,mode` — "Display the current AMOS screen into the
     * GUI Screen... No copper hacks or bitplanes hacking.. it's a 100% OS
     * friendly system".
     *
     * True is AllocDBufInfo (-$3c6), ChangeVPBitMap (-$3ae) pointing the GUI
     * screen's ViewPort at AMOS's own BitMap, then WaitBlit, ScrollVPort,
     * MakeScreen and RethinkDisplay. False gives the screen its own BitMap
     * back and FreeDBufInfo (-$3cc). Under OS 39 there is no ChangeVPBitMap
     * and $34d4 pokes the BitMap pointer into the RasInfo instead, which is
     * the copper hack the guide says it does not do.
     *
     * Either way the palette is copied first, at $3442: the AMOS screen's
     * colour count at `$64` and its table at `$66`, one SetRGB4 (-$120) a
     * pen. Nothing puts them back, so `Gui Clone 1,False` restores the
     * picture and leaves the colours.
     *
     * "Actually the Double buffer and the rainbows aren't supported, and this
     * commands works only using the Amiga Chipset... with a Gfx Card it
     * doesn't works!!"
     */
    'gui clone': (it) => {
      const g = s()
      const n = it.evalInt()
      it.expect(',')
      const on = it.evalInt() !== 0
      const screen = screenOf(g, n)
      const from = rt.screen.palette
      for (let i = 0; i < screen.palette.length && i < from.length; i++) {
        setColour(screen, i, expand12(from[i]! & 0xfff))
      }
      screen.cloned = on
    },

    /**
     * `Gui Remap bank` — "adapt the colour map of the specified RTG Bob bank
     * with the colours of the current screen, so the images will looks
     * correctly".
     *
     * The RTG Bob format is not guesswork: `Accessories/RTGBob.Amos` is
     * shipped and detokenises, and it writes
     *
     *     +$00  LONG  images
     *     +$04  LONG  colours
     *     +$08  LONG  total chunky bytes
     *     +$0c  32 x (0, R, G, B), the bob bank's palette at 8 bits a gun
     *     +$8c  32 x LONG, empty -- where this keyword writes the pens
     *     +$10c images x (WORD width, WORD height, LONG data)
     *
     * and appends every image's chunky pixels after it. `HD=12+32*8+
     * Length(1)*8` is that header, and the bank is named "RTG Bobs".
     *
     * $4a5e resolves each colour with ObtainBestPenA (-$348) and falls back
     * to FindColor (-$3f0) with bit 31 SET as a marker, which is how routine
     * 223 later knows which pens it has to hand back. Then $4abe walks the
     * image table converting each image's chunky bytes through that table
     * into eight bitplanes and rewriting the table's pointer.
     *
     * DEFECT: one bank at a time, and the keyword does not say so. Routine
     * 222 opens with routine 223, which releases the pens and frees the
     * planes of whatever `$c0` still points at. So remapping a second bank
     * silently un-remaps the first, and the guide's warning is about erasing
     * a bank rather than about this.
     */
    'gui remap': (it) => {
      const g = s()
      const bank = rt.memBanks.get(it.evalInt())
      if (bank === undefined) guiError(GUI_ERR.BANK_NOT_RESERVED)
      remapRtgBobs(g, bank.data)
    },

    /**
     * `Tcp Close` and `Tcp Close socket` — "If you call it without
     * parameters, ALL the sockets will be closed and deallocated. Otherwise
     * you can specify the number of the socket to be closed."
     *
     * Two token arities under one name. Routine 199 at $43d8 loops on the
     * chain head at `$2dc` taking the FIRST node each time round, so it works
     * even though routine 229 unlinks as it goes; routine 198 at $43d0 passes
     * one number straight to the same unlink-and-CloseSocket.
     *
     * Neither raises. A socket number that names nothing walks off the end of
     * the chain at $4dc4 and returns.
     */
    'tcp close': (it) => {
      const g = s()
      if (g.release === '1.6x') return closeChannels(rt, g)
      if (it.atStmtEnd()) {
        g.sockets.clear()
        return
      }
      g.sockets.delete(it.evalInt())
    },

    /**
     * `Tcp Reset` parks a DateStamp for `Tcp Time` to measure against.
     *
     * Routine 94 DateStamps into `$10e` and keeps two of the three fields:
     * ds_Minute at `$4` straight into `$2b2`, and ds_Tick at `$8` over
     * `divu.w #$32`, fifty ticks a second, into `$2b4`. ds_Days is
     * dropped, and `Tcp Time` subtracts word-wide, so an elapsed time that
     * crosses midnight comes out as a large positive number.
     */
    'tcp reset': () => {
      const g = s()
      const [min, sec] = amigaClock(rt)
      g.stampMinute = min
      g.stampSecond = sec
    },

    /**
     * `Tcp Limit microseconds`. How long `Tcp Get` waits.
     *
     * Two instructions and no check at all: `move.l (a3)+,$2ba(a0)`. It is
     * WaitForChar's timeout, and the extension's own boot writes
     * `#$1312d00`, twenty seconds, into the same longword.
     */
    'tcp limit': (it) => {
      s().charLimit = it.evalInt()
    },

    /**
     * `Tcp Trash` GetMsgs the port dry, `tst.l d0 / bne` back to the top.
     *
     * It drops the replies and nothing else. `$2b6` is not touched, so `Tcp
     * Count` still reports every packet this threw away as outstanding, and
     * the only thing that ever brings that number down is the pump collecting
     * a reply this has already eaten.
     */
    'tcp trash': () => {
      s().packets.length = 0
    },

    /**
     * `Tcp Set socket,value` — "Set the user data of a socket."
     *
     * $4546 is the socket lookup and one `move.l d1,$24(a0)`. The lookup is
     * routine 226, which carries `moveq #$14,d7` — error 20, "Socket not
     * opened!" — so this is one of the seven keywords that raise it.
     */
    'tcp set': (it) => {
      const sock = socketOf(s(), it.evalInt())
      it.expect(',')
      sock.user = it.evalInt()
    },

    /**
     * `Tcp Download socket To file name,mode` — "allows you to automatically
     * download data from the specified socket and save them into a file...
     * All the operations are buffered & asynchronous and automatically
     * handled by the extension."
     *
     * $45e0 opens the file MODE_READWRITE ($3ee) or MODE_OLDFILE ($3ed)
     * depending on whether it already exists, Seeks to the end when the mode
     * asks to resume, and AllocVecs a $2800-byte buffer. Two errors of its
     * own: 22 "Unable to open file" and 24 "Not enough memory!". The mode is
     * forced to a mask — `tst.l d5 / beq / moveq #$ff,d5` — so any non-zero
     * value means resume.
     *
     * "mode = 0 The file will be overwritten with the new data. mode = 1 The
     * new data will be added to the end of the file."
     */
    'tcp download': (it) => {
      const g = s()
      const sock = socketOf(g, it.evalInt())
      it.expect('to')
      const file = it.evalStr()
      if (it.accept(',')) it.evalInt()
      sock.download = file
      g.tcpTotal = 0
      g.tcpRecvd = 0
    },

    /**
     * `Gui Text x,y,text$` --- PrintIText (-$d8) through an IntuiText the
     * keyword builds at `$242`.
     *
     * The three pens come from the extension's state and not from the
     * RastPort: FrontPen from `$290`, BackPen from `$28e` and DrawMode from
     * `$292`, which are `Gui Pen`, `Gui Paper` and `Gui Writing`. The font is
     * `$66`.
     *
     * An EMPTY string returns before any of that: `tst.w d2 / beq` at $25b4
     * on the string's own length word, so `Gui Text 0,0,""` does not even
     * check that a Gfx output is open.
     *
     * PrintIText places the text by its TOP, adding the font's baseline
     * itself, where `RastPort.text` here is given the baseline. The one
     * conversion is here rather than in the RastPort because that is the side
     * PrintIText is on.
     */
    'gui text': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const text = str(it.evalExpr())
      const g = s()
      if (text === '') return
      const w = gfx(g)
      if (w.rp.font === null) return
      w.rp.text(x, y + w.rp.font.baseline, text, g.pen)
    },

    /**
     * `Gui Amiga` (1.5b) and `Gui Amiga mode` (1.61), "hide AMOS".
     *
     * Three instructions do the whole of it on both releases, at 1.5b's $8e4
     * and the tail of 1.61's $fe2: `EcCall AMOS_WB` with d1 zero, which is
     * `Amos To Back`; `move.w #$ffff,-$90(a5)`, which is the T_NoFlip word
     * `Amos Lock` sets; and WBenchToFront (-$156). 1.5b's doc says exactly
     * that, "It's the equivalent of Amos to Back : Amos Lock", and
     * leaves the third out.
     *
     * 1.61 added the argument and a block in front, and the block is
     * unreachable here. `cmpi.w #$1,-$16(a5) / beq` at $fe8 sends the
     * interpreter straight past StopVBL and the vector patch, and `tst.l d0 /
     * beq` in front of THAT sends `Gui Amiga 0` past them too. So under an
     * interpreter both arguments do the same three things, which is the
     * guide's "note that this only takes effect when your program is
     * compiled".
     *
     * DEVIATION: WBenchToFront has nothing to raise. No public screen in this
     * port owns a display slot, so `amosToBack` has already put AMOS behind
     * everything there is.
     */
    'gui amiga': (it) => {
      // 1.61's `I0`; 1.5b's spec is a bare `I` and there is nothing to read
      if (s().release === '1.6x') it.evalInt()
      rt.amosToBack()
      rt.noFlip = true
    },

    /**
     * `Gui Amos`, which the guide calls "reverse Gui Amiga". Four
     * instructions, identical in both releases at $902 and $1038.
     *
     * `move.w #$0,-$90(a5)` is `Amos Unlock` and `AMOS_WB` with d1 one is
     * `Amos To Front`. In that order, which is the order the docs give:
     * "Amos Unlock and Amos To Front".
     */
    'gui amos': () => {
      rt.noFlip = false
      rt.amosToFront()
    },

    /**
     * `Gui Circle x,y,radius1,radius2`. 1.5b's name for `Gui Ellipse`.
     *
     * Four longwords popped into d3, d2, d1, d0 and straight into DrawEllipse
     * (-$b4) at $be4, so the arguments arrive as xCentre, yCentre, a, b. The
     * doc calls the keyword GUI ELLIPSE and prints that heading over it; the
     * token table says `gui circle`, and 1.61 renamed the token to match the
     * doc. The binary wins, so the name here is the table's.
     */
    'gui circle': (it) => {
      const [x, y] = pair(it)
      it.expect(',')
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const w = gfx(s())
      w.rp.ellipse(x, y, a, b, w.ink)
    },

    /**
     * `Gui Iconify window` rolls a window up to its title bar.
     *
     * A different keyword from 2.10's function of the same name, which closes
     * the window and puts an AppIcon up instead. Routine 51 reads BorderTop
     * out of the intuition Window (`$37`, byte), saves LeftEdge, TopEdge,
     * Width and Height into the design's Header Info block, and calls its own
     * `Gui Resize` with the width it already had and that border for a
     * height. "Reduce a window to a single title bar."
     *
     * 1.61 added the guard in front: `cmp.w $a(a2),d0 / beq` at $161c returns
     * at once when the height is already the border, which is the history's
     * "bug fixed that caused window to be trashed if iconified several
     * times". 1.5b has no such test and saves the rolled-up box over the real
     * one on the second call, losing it. That is reproduced.
     */
    'gui iconify': (it) => {
      const g = s()
      const w = windowOf(g, it.evalInt())
      if (g.release === '1.6x' && w.height === TITLE_HEIGHT) return
      g.iconBoxes.set(w.gui, [w.left, w.top, w.width, w.height])
      resizeWindow(w, w.width, TITLE_HEIGHT)
    },

    /**
     * `Gui Screen Open number,width,height,depth,modes`. 1.5b only, and it
     * is why 1.61 has no screen keywords at all.
     *
     * Routine 38 fills four words of a NewScreen at `$fc` of the state and
     * calls OpenScreen (-$c6). Nothing keeps the result: `movem.l (a7)+,a3-a6
     * / rts` follows the call, d0 is dropped, and the beta has no `Gui Screen
     * Close`, no `Gui Screen Width` and no working `Gui Gfx 1,n`, its own
     * doc says "screen ( NO YET IMPLEMENTED! )" against that argument. So a
     * screen this opens cannot be reached again by any keyword.
     *
     * DEFECT: `bset.b d0,d1` at $c84 puts `1 << n` into ns_Depth, where the
     * field wants n. A program asking for 4 gets sixteen bitplanes and
     * OpenScreen refuses it; only 0, 1, 2 and 3 land on a legal depth, and
     * they land on 1, 2, 4 and 8 planes rather than the 1, 2, 3 and 4 asked
     * for. The keyword is gone by 1.61 and back in 2.10 computing the depth
     * from a COLOUR count.
     */
  }
}

export function makeGuiFunctions(rt: Runtime): Record<string, Func> {
  const s = (): GuiState => rt.gui

  return {
    /**
     * `C=Gui Colour(colour number)` — read one entry back.
     *
     * "Return the colour's value of the specified colour number as the Amos
     * Colour command", which is true of the GetRGB4 (-$246) branch and not of
     * the other one: above Kickstart 39 this is GetRGB32 (-$384) into the
     * $400-byte buffer at `$2b8`, and the three fractions are packed into a
     * 24-bit $RRGGBB by the `rol.l #$8 / move.b` pair at $30be. AMOS's own
     * `Colour` answers twelve bits, so on the machine this port models the
     * two disagree.
     *
     * The pack reads the LOW byte of each fraction, `andi.l #$ff,d0`, where
     * the component is nominally the top one. graphics.library replicates an
     * 8-bit component through all four bytes of the fraction it hands back,
     * so the two are the same number.
     */
    'gui colour': (_, a): Value => {
      const g = s()
      if (g.current === null) return VI(0)
      return VI(g.current.palette[int(a[0]!)] ?? 0)
    },

    /**
     * `R=Gui Red(RGB colour)`, `Gui Green` and `Gui Blue` — pull one
     * component out of what `Gui Colour` answered.
     *
     * Three routines of about thirty bytes, and each is a rotate and a mask
     * chosen by the same `cmpi.w #$27,$18a` test. Above 39 the rotates take
     * the byte: 16 for red at $31f6, 8 for green at $3218 and none at all for
     * blue, which is why routine 138 has a `nop` in it. Below 39 they take a
     * nibble instead, at 8, 4 and 0.
     *
     * Nothing looks at a screen or a ColorMap. These are arithmetic on the
     * number they were given, so `Gui Red($ff0000)` is 255 whether or not any
     * screen is open.
     */
    'gui red': (_, a): Value => VI((int(a[0]!) >> 16) & 0xff),
    'gui green': (_, a): Value => VI((int(a[0]!) >> 8) & 0xff),
    'gui blue': (_, a): Value => VI(int(a[0]!) & 0xff),

    /**
     * `C=Gui Best(Red,Green,Blue)` — the nearest pen on the current screen.
     *
     * "This command require the OS3.x!!!!! othewise returns -1!", and the -1
     * is the `moveq #$ff,d0` at $3828 that the whole body is skipped over
     * below Kickstart 39.
     *
     * DEFECT: the pen is released before the keyword returns. $3854 is
     * ObtainBestPenA and $385c is ReleasePen on the same ColorMap, with the
     * result parked in d5 across the pair. So the guide's "a new one will be
     * allocated, if available" allocates a pen and then gives it straight
     * back: what the program is handed is a number that nothing is holding,
     * and the next caller can take the same entry and put another colour in
     * it. Not holding it is a choice rather than an oversight -- a keyword
     * that never released would leak a pen per call -- but the guide's own
     * example, `C=Gui Best(255,0,0) : Gui Ink C`, is exactly the use the
     * release makes unsafe.
     *
     * DEVIATION: no pen is allocated here at all, so the answer is always the
     * nearest entry already in the ColorMap. Nothing in this port allocates
     * or shares pens, and with nothing else drawing on the screen the two
     * only differ when the palette has a free entry to spend.
     */
    'gui best': (_, a): Value => {
      const g = s()
      if (GUI_OS_VERSION < 39 || g.current === null) return VI(-1)
      return VI(nearestPen(g.current.palette, int(a[0]!) & 0xff, int(a[1]!) & 0xff, int(a[2]!) & 0xff))
    },

    /**
     * `F=Gui Asl Screen` — the ASL screenmode requester, answering the
     * DisplayID or -1.
     *
     * Routine 55 builds a two-tag list, ASL_Window and the current window,
     * calls AslRequest (-$3c) and reads sm_DisplayID out of `$0` of the
     * requester. "If the value returned is -1 then the user hit Cancel", and
     * -1 is also what a missing asl.library or a missing requester answers:
     * the `moveq #$ff,d0` at $241c stands until one of the two tests passes.
     *
     * DEVIATION: no requester opens. There is no asl.library here and no
     * display database to fill one from -- nothing in this port names a
     * screen mode -- so this answers cancel and leaves the four fields as
     * they were. A program written the way the guide writes it, testing for
     * -1 and stopping, does the right thing; one that ignores the -1 reads
     * zeros out of the five readers below.
     */
    'gui asl screen': (): Value => VI(-1),

    /**
     * `A=Gui Asl Id`, `Gui Asl Width`, `Gui Asl Height`, `Gui Asl Depth` and
     * `Gui Asl Colours` — the four fields the screenmode requester left.
     *
     * Fourteen to twenty-eight bytes each, and every one of them starts
     * `movea.l $150(a0),a0` with no test at all. DEFECT: on a machine where
     * AllocAslRequest failed, `$150` is zero and all five read from low
     * memory. `Gui Asl Screen` tests it and these do not, which is the whole
     * difference between them.
     *
     * `Gui Asl Colours` is a longword ROTATE rather than a shift, which is
     * what makes a depth of 0 answer 1 after 65,536 turns and a depth of 33
     * answer 2. See `coloursForDepth`.
     */
    'gui asl id': (): Value => VI(s().aslScreen.displayID),
    'gui asl width': (): Value => VI(s().aslScreen.width),
    'gui asl height': (): Value => VI(s().aslScreen.height),
    'gui asl depth': (): Value => VI(s().aslScreen.depth),
    'gui asl colours': (): Value => VI(coloursForDepth(s().aslScreen.depth)),

    /**
     * `A$=Gui Asl Font` — the ASL font requester, "including the .font
     * extension".
     *
     * ta_Name out of `$8` of the FontRequester and ta_YSize out of `$c`,
     * which `Gui Font Size` then reads back. The size is zeroed at $24a2 on
     * every call that got as far as AslRequest, so a cancel leaves 0 beside
     * the empty string.
     *
     * DEFECT: with asl.library or the requester missing, the two `beq` at
     * $2474 and $247a jump to $24c2 — which is PAST the `move.l $662(a5),d1`
     * at $249e that loads AMOS's null string. d1 is whatever it was, and
     * `moveq #$2,d2` then tells the interpreter it is a string. Routine 258
     * makes the same two tests and gets both right, raising error 13 for the
     * library and answering the null string for the requester.
     *
     * DEVIATION: no requester opens, for the same reason as `Gui Asl Screen`.
     */
    'gui asl font': (): Value => {
      const g = s()
      g.aslFontSize = 0
      // 1.5b and 1.61 declare `0`, an INTEGER, and routine 54 returns
      // AslRequest's own answer with `moveq #$ff,d0` standing for a missing
      // library or requester. Their guide's "returns the selected font" is
      // wrong about the type: there is no string anywhere in those 46 bytes.
      // 2.10 rewrote it as `2` and hands back ta_Name.
      return g.release === '2.10' ? VS('') : VI(-1)
    },

    /**
     * `SIZE=Gui Font Size` — `$160`, five instructions and no test.
     *
     * A word, sign-extended, so it survives `Gui Asl Font` failing and reads
     * 0 until one succeeds.
     */
    'gui font size': (): Value => VI(s().aslFontSize),

    /**
     * `A=Gui Req(title$,message$,gadget$)` — EasyRequestArgs (-$24c) on the
     * current window, with the three strings dropped straight into an
     * EasyStruct at `$110`.
     *
     * Routine 22 is seven instructions: `move.w (a2)+,d0` three times to step
     * over each AMOS length word, then routine 250 fills es_Title at `$8`,
     * es_TextFormat at `$c` and es_GadgetFormat at `$10` and calls. So the
     * "|" between gadgets and the Chr$(10) between lines are intuition's own
     * separators, not this extension's.
     *
     * "If the right-most gadget is selected, then 0 will be returned" -- also
     * intuition's, and the same numbering the port's own requester already
     * answers in.
     *
     * APPROXIMATED: an Interface dialog stands in, as it does for BUtility's
     * `Binforeq`. The title is lost with it: an EasyStruct has one and
     * `AlertSpec` does not, because the AMOS dialog draws no window frame to
     * put it in.
     */
    'gui req': (it, a): Value => {
      const g = s()
      const spec: RequesterSpec = { kind: 'alert', body: str(a[1]!), gadgets: str(a[2]!).split('|') }
      if (g.req !== null) {
        const r = finishRequester(rt, g.req, spec)
        if (r === null) {
          it.block({ type: 'dialog', channel: g.req }, true)
          return VI(0)
        }
        g.req = null
        return VI(r.ret)
      }
      const chan = startRequester(rt, spec)
      if (chan === null) return VI(0)
      g.req = chan
      it.block({ type: 'dialog', channel: chan }, true)
      return VI(0)
    },

    /**
     * `A$=Gui Asl$(Title,directory,file,pattern)` — the ASL file requester.
     *
     * Routine 258 builds the tag list in the state block itself: ASL_Window
     * and the current window, ASLFR_InitialPattern with the fourth argument,
     * and ASLFR_Flags1 = 1 so the pattern gadget shows. The other three are
     * added only when non-empty -- ASLFR_TitleText at $757e, ASLFR_InitialDrawer
     * at $7590, ASLFR_InitialFile at $75a2 -- so an empty argument is not an
     * empty title, it is no tag at all and asl.library's own default.
     *
     * The joined path is built at $75ee rather than taken from asl: fr_Drawer,
     * then a '/' unless the drawer already ends in ':' or '/', then fr_File.
     * That is why `Gui Dir$` never has a trailing slash and `Gui Asl$` always
     * has exactly one separator.
     *
     * "Asl.library not found!" is error 13, the `moveq #$d,d7` at $7520.
     *
     * APPROXIMATED: AMOS's own file selector stands in, the way BUtility's
     * `Baslfilereq` uses it. What a program can observe -- modal, a path or
     * an empty string, and the two halves readable afterwards -- is the same;
     * the chrome and the pattern gadget are not.
     */
    'gui asl$': (it, a): Value => {
      const g = s()
      if (rt.fsel !== null) {
        if (!rt.fsel.done) {
          it.block({ type: 'fsel' }, true)
          return VS('')
        }
        const r = rt.fsel.result
        rt.fsel = null
        // $75b8 clears both before the request, so a cancel leaves them empty
        if (r === '') return VS('')
        const cut = Math.max(r.lastIndexOf('/'), r.lastIndexOf(':'))
        g.aslFile = r.slice(cut + 1)
        g.aslDir = cut < 0 ? '' : r[cut] === ':' ? r.slice(0, cut + 1) : r.slice(0, cut)
        return VS(joinAsl(g.aslDir, g.aslFile))
      }
      g.aslFile = ''
      g.aslDir = ''
      // 1.5b's spec is `22,2,2`: three arguments and no pattern. The history
      // dates the fourth, "Now Gui Asl$ allows pattern matching" in 1.6
      const [title, dir, file] = [str(a[0]!), str(a[1]!), str(a[2]!)]
      const pattern = a[3] === undefined ? '' : str(a[3])
      const start = pattern !== '' && /[#?*]/.test(pattern) ? (dir === '' ? pattern : `${dir}/${pattern}`) : dir
      if (!rt.startFsel(start, file, title, '')) return VS('')
      it.block({ type: 'fsel' }, true)
      return VS('')
    },

    /**
     * `A$=Gui File$` and `A$=Gui Dir$` — the two halves of the last request.
     *
     * Ten instructions each, and neither tests asl.library or the requester:
     * they read `$158` and `$15c` and answer AMOS's null string when either
     * is zero. So they are safe to call before anything has been selected,
     * which is not true of the five `Gui Asl` screen readers.
     */
    'gui file$': (): Value => VS(s().aslFile),
    'gui dir$': (): Value => VS(s().aslDir),

    /**
     * `IconifyID=Gui Iconify(window,icon Name,icon path)` — close a window
     * and leave an AppIcon in its place.
     *
     * Routine 53 at $234e closes the window through routine 245, the same
     * guts `Gui Close` uses, and then hands the record it kept to routine 260
     * with `moveq #$0,d0`. The zero never survives: routine 260 reads
     * `$c(a0)` over it, which is the window's own number, and that is the
     * guide's "if you iconify the Window number 5, the AppIcon number 5 will
     * be created."
     *
     * The window record is NOT freed by that close. It is a block in the GUI
     * bank, and keeping it is what lets `Gui Uniconify` find the design again
     * by walking `$2` backwards.
     *
     * "If you don't specify the icon to be used, the system default TOOL icon
     * will be used."
     */
    'gui iconify': (_, a): Value => {
      const g = s()
      const w = windowOf(g, int(a[0]!))
      const from = { number: w.number, gui: w.gui, topaz: w.topaz }
      g.closeWindow(w.number)
      return VI(g.addApp(from.number, str(a[1]!), str(a[2]!), from).handle)
    },

    /**
     * `I=Gui App Id` — which AppIcon the last event -16 named.
     *
     * `$90`, one longword, and the keyword is three instructions. "it returns
     * the number of the used one like Gui Window returns the number of the
     * used GUI."
     *
     * The number is the WORD the program gave `Gui App Icon`, sign-extended:
     * AddAppIconA was handed the node as its id, so the pump has to
     * dereference am_ID and read `$8` back out of it. See `GuiState.appId`.
     */
    'gui app id': (): Value => VI(s().appId),

    /**
     * `N$=Gui App Name$` — the next full path dropped on an AppIcon.
     *
     * "You've to call it as many time as the number of files dragged. In
     * order to know how many icons has been dragged, you've to use as usual
     * Gui Code". The guide's own example then tests for event -15 rather than
     * the -16 the AppIcons section documents, because the same queue serves
     * both: a drop on an AppWindow and a drop on an AppIcon arrive as the
     * same AppMessage.
     *
     * Empty when the queue is dry, and the queue empties itself: the last
     * name out replies the message and clears `$94`, `$98` and `$9c` at
     * $3b46.
     */
    'gui app name$': (): Value => VS(s().nextAppName()),

    /**
     * `A=Gui Close(window)`, answering one of four codes:
     *
     *     0 - Window Closed
     *     1 - First opened Window closed
     *     2 - Last opened window closed
     *     3 - Last window closed
     *
     * and the guide's own warning about what it is NOT: "Opened windows will
     * not close by themselves when the close gadget is clicked, you have to
     * monitor for it to happen".
     */
    'gui close': (_, a): Value => VI(s().closeWindow(int(a[0]!))),

    /**
     * `A=Gui Exist(window)`.
     *
     * "If it isn't, then FALSE is returned. If the window is open, it will
     * return with the window's structure address."
     *
     * DEVIATION: the address. Nothing here has a `struct Window` at an
     * address, and the guide's next line is "Dont fiddle with this structure
     * unless you really know what you're doing to it!!", so what a program
     * can legitimately do with the value is test it. This answers -1, which
     * is AMOS's TRUE and is truthy in every test a program can write, rather
     * than a number pretending to be a pointer.
     */
    'gui exist': (_, a): Value => VI(s().exists(int(a[0]!)) ? -1 : 0),

    /**
     * `A=Gui Wait` — "will wait until the user interacts with your program".
     *
     * DEVIATION: it does not block. On the machine the program freezes here
     * until Intuition delivers something; this port has one thread and a
     * frame loop that must keep turning, so this answers the next queued
     * event or -7. A program written as `Repeat : A=Gui Wait : Until A=-1`
     * therefore spins rather than sleeps, which costs frames and changes
     * nothing a program can observe about the events themselves.
     *
     * 1.5b answers -3 rather than -7 when no window is open, and it answers it
     * without looking at anything: routine 10 is `moveq #$fd,d0 / tst.l
     * $62(a1) / beq`, so the pump only runs when the window list has a head.
     * Its doc lists -3 as "no windows opened!" and lists no -7 at all. 1.61
     * kept the value and changed what it means, its pump returns -3 for a
     * Ctrl-C and `Gui Wait` turns that into error 0, "Program Interrupted",
     * which is the history's "now you can break the Gui Wait command", so
     * by then the guide can say "-3 Not used" of the value a program sees.
     */
    'gui wait': (): Value => {
      const g = s()
      if (g.release === '1.5b' && g.windows.size === 0) return VI(GUI_EVENT.UNUSED3)
      return VI(pumpEvent(rt, g))
    },

    /**
     * `A=Gui Event` — the same answers without waiting.
     *
     * "It returns the value -7 if nothing is happened..."
     */
    'gui event': (): Value => VI(pumpEvent(rt, s())),

    /**
     * `A=Gui Code` — the result code of the last event.
     *
     * "After Gui Code has been called, its value is automatically reset to -1
     * again, until the next call to Gui Wait loads it with a new value."
     */
    'gui code': (): Value => VI(s().readCode()),

    /** `A=Gui Code$` — the string half, for STRING gadgets */
    'gui code$': (): Value => VS(s().readCodeText()),

    /**
     * `A=Gui Menu(n)` — which menu item the last event -2 named.
     *
     * "A menu item has been selected. You've to use the Gui Menu function to
     * know which item has been chosen." The guide says no more, and routine
     * 14 at $1e82 is one `Rbsr` into routine 4, where the four arguments live:
     * 1 the menu, 2 the item, 3 the sub-item, 4 step to the next of a
     * multi-select. All three fields come back ONE-BASED.
     */
    'gui menu': (_, a): Value => VI(s().menuField(int(a[0]!))),

    /**
     * `A=Gui Mouse X` and `A=Gui Mouse Y` — "the screen coordinates of the
     * mouse". See `screenMouse` for what stands in for the screen here.
     */
    'gui mouse x': (it): Value => VI(screenMouse(it, s())[0]),
    'gui mouse y': (it): Value => VI(screenMouse(it, s())[1]),

    /**
     * `A=Gui Mouse Wx` and `Wy` — the same, less the window's own corner.
     * "The top-left coordinates of a window are 0,0."
     *
     * `Window.MouseX` and `MouseY`, at $e and $c of the Window intuition
     * keeps up to date. The window is the Gfx one rather than the selected
     * one: $2a0c reads `$1c2`, which `Gui Gfx` sets and `Gui Actual` reports
     * the number of. Error 10 when there is none, from the `moveq #$a,d7` at
     * $2a0a -- so this is the one pair that raises "Window not open" where
     * everything else drawing-shaped raises "Gfx output not defined".
     */
    'gui mouse wx': (it): Value => {
      const g = s()
      const w = target(g) ?? guiError(GUI_ERR.WINDOW_NOT_OPEN)
      return VI(screenMouse(it, g)[0] - w.left)
    },
    'gui mouse wy': (it): Value => {
      const g = s()
      const w = target(g) ?? guiError(GUI_ERR.WINDOW_NOT_OPEN)
      return VI(screenMouse(it, g)[1] - w.top)
    },

    /**
     * `A=Gui Mouse Ex` and `Ey` — where the pointer was when the last event
     * happened, rather than where it is now.
     *
     * "if the user click the mouse you'll receive the -11 event, but if you
     * try to get the mouse coords using Gui Mouse Wx you'll get the CURRENT
     * mouse coord wich may be different from the point where the user has
     * clicked." The guide lists three events that fill them in: -11 mouse
     * click, -12 mouse move and -15 icon drag'n'drop.
     *
     * Two words at `$29c` and `$29e`, copied out of the IntuiMessage at
     * $6d0a. They are never cleared, so after an event that carries no
     * position they still hold the last one that did.
     */
    'gui mouse ex': (): Value => VI(s().eventX),
    'gui mouse ey': (): Value => VI(s().eventY),

    /**
     * `A=Gui Width(window)` and `Gui Height(window)` — "the width of the
     * specified window in pixels", borders and all.
     *
     * `Window.Width` at $8 and `Height` at $a, and `Gui X` and `Gui Y` are
     * `LeftEdge` at $4 and `TopEdge` at $6 of the same struct.
     */
    'gui width': (_, a): Value => VI(windowOf(s(), int(a[0]!)).width),
    'gui height': (_, a): Value => VI(windowOf(s(), int(a[0]!)).height),
    'gui x': (_, a): Value => VI(windowOf(s(), int(a[0]!)).left),
    'gui y': (_, a): Value => VI(windowOf(s(), int(a[0]!)).top),

    /**
     * `A=Gui In Width(window)` and `Gui In Height(window)` — the same "
     * excluding the window borders".
     *
     * $2740 subtracts `$36(a0)` and `$38(a0)` from the width, which are
     * BorderLeft and BorderRight, and $2780 subtracts `$37` and `$39` from
     * the height, BorderTop and BorderBottom. The four bytes `Gui Border`
     * reports one at a time.
     */
    'gui in width': (_, a): Value => VI(windowOf(s(), int(a[0]!)).width - WBORLEFT - WBORRIGHT),
    'gui in height': (_, a): Value => VI(windowOf(s(), int(a[0]!)).height - TITLE_HEIGHT - WBORBOTTOM),

    /**
     * `A=Gui X Gad(window,gadget)` and its three siblings — the gadget's box
     * "relative to the top-left of the window".
     *
     * Four routines of twenty-six bytes each, and every one of them is the
     * gadget lookup and one word: `$4`, `$6`, `$8` and `$a` of the LAID-OUT
     * Gadget, which are its LeftEdge, TopEdge, Width and Height. Not the
     * bank's NewGadget. That is why the guide points at them from `Gui
     * Sensitive On`: the layout pass has already applied the font scale and
     * the border, and this is how a program finds out where things ended up.
     *
     * So the scale here has to be the one the layout used, which means the
     * same test `Gui Sx` makes --- a window laid out in topaz/8 was not
     * scaled and its gadgets report the design's own numbers.
     */
    'gui x gad': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      const { gad } = gadgetOf(g, win, int(a[1]!))
      return VI(sensitiveX(g, win, gad.leftEdge) + WBORLEFT)
    },
    'gui y gad': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      const { gad } = gadgetOf(g, win, int(a[1]!))
      return VI(sensitiveY(g, win, gad.topEdge) + TITLE_HEIGHT)
    },
    'gui gad width': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      const { gad } = gadgetOf(g, win, int(a[1]!))
      return VI(sensitiveX(g, win, gad.width))
    },
    'gui gad height': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      const { gad } = gadgetOf(g, win, int(a[1]!))
      return VI(sensitiveY(g, win, gad.height))
    },

    /**
     * `A=Gui Sx(window,x)` — "the new X position of a point, when scaled as
     * the gadgets are with Gui Sensitive On".
     *
     * TWO arguments, not one. The guide prints `A=Gui Sx(X)` and its worked
     * example reads `Gui Bar Gui Sx(10),Gui Sy(15) To Gui Sx(25),Gui Sy(30)`,
     * but the token table's spec is `00,0` and $28d8 pops a value AND a
     * window before calling the window lookup. All four of these take the
     * window first.
     *
     * The arithmetic is the layout pass run backwards then forwards: take off
     * the border the design was drawn with, scale, add the border the window
     * actually got. `subq.l #$4,d1` at $28dc is GuiConv's own `Deek(WORK)-4`.
     *
     * 1.61's four take ONE argument, and its guide's `=GUI SX(x)` is right for
     * that release. Routines 109 to 112 hold the same two constants, `subq.l
     * #$4,d0` at $1d36 and `subi.l #$a,d0` at $1d4c, and add back the
     * window borders the extension keeps at `$1d0` and `$1ce` instead of a
     * window's own, so there is no window to look up and nothing to raise. The
     * scale itself is 1.61's rotate rather than 2.10's divide; see
     * `guiScaleRor`.
     */
    'gui sx': (_, a): Value =>
      a[1] === undefined
        ? VI(guiScaleRor(int(a[0]!) - WBORLEFT, s().fontWidth) + WBORLEFT)
        : VI(sensitiveX(s(), int(a[0]!), int(a[1]!) - WBORLEFT) + WBORLEFT),

    /**
     * `A=Gui Sy(window,y)` — the same for a Y coordinate.
     *
     * DEFECT: it takes off TEN where the design used ELEVEN. $2908 is
     * `subi.l #$a,d1`, GuiConv writes `Doke _STRUCTS+2,Deek(WORK+6)-11`, and
     * the border added back at $292a is `$298`, which $568a builds as
     * WBorTop + the font's height + 1 -- 11 for a Workbench with topaz/8. So
     * with the default font `Gui Sy(w,y)` answers y+1 rather than y, where
     * `Gui Sx` beside it is exact. One pixel, and it grows with the font.
     */
    'gui sy': (_, a): Value =>
      a[1] === undefined
        ? VI(guiScaleRor(int(a[0]!) - SY_DESIGN_TOP, s().fontHeight) + TITLE_HEIGHT)
        : VI(sensitiveY(s(), int(a[0]!), int(a[1]!) - SY_DESIGN_TOP) + TITLE_HEIGHT),

    /**
     * `A=Gui Sw(window,width)` and `Gui Sh(window,height)` — "the pixel width
     * rescaled by the font sensitivity routine".
     *
     * A size rather than a position, so neither takes a border off nor adds
     * one back: $2934 and $295a are the scale alone.
     */
    'gui sw': (_, a): Value =>
      a[1] === undefined ? VI(guiScaleRor(int(a[0]!), s().fontWidth)) : VI(sensitiveX(s(), int(a[0]!), int(a[1]!))),
    'gui sh': (_, a): Value =>
      a[1] === undefined ? VI(guiScaleRor(int(a[0]!), s().fontHeight)) : VI(sensitiveY(s(), int(a[0]!), int(a[1]!))),

    /**
     * `A=Gui X Font` and `Gui Y Font` — the character cell everything above
     * is scaled by, `$294` and `$296`.
     *
     * They belong to the extension rather than to a window, and a window that
     * could not be scaled has already forced them back to 8.
     */
    'gui x font': (): Value => VI(s().fontWidth),
    'gui y font': (): Value => VI(s().fontHeight),

    /**
     * `T$=Gui Title$(window)` — "Returns the title of the specified window".
     *
     * A number of ZERO OR LESS names a SCREEN instead, which the guide does
     * not say: $402e branches on `tst.l d0 / bgt`, works out `$10000 - n` to
     * get the screen number, and reads the screen record's own title at $404c
     * with "Screen not opened" for its error. Above zero it reads
     * `Window.Title` at `$20`.
     */
    'gui title$': (_, a): Value => {
      const n = int(a[0]!)
      // no screens exist in this port yet, so every screen number is unopened
      if (n <= 0) guiError(GUI_ERR.SCREEN_NOT_OPENED)
      return VS(windowOf(s(), n).title)
    },

    /**
     * `A=Gui Mouse Zone(window,x,y)` — "Returns the number of zone at the
     * specified mouse coordinates. If no zone are present, the value -1 is
     * returned."
     *
     * A window that reserved nothing is "Zone not reserved" rather than -1:
     * $416c tests the pointer and raises before the hit test runs.
     */
    'gui mouse zone': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      windowOf(g, win)
      if (!g.zones.has(win)) guiError(GUI_ERR.ZONE_NOT_RESERVED)
      return VI(g.zoneAt(win, int(a[1]!), int(a[2]!)))
    },

    /**
     * `Z=Gui Zone` — "It works exactly like the Gui Gadget function, except
     * it detects the window zones instead of the gadgets!"
     *
     * A different word from `Gui Gadget`'s, `$a0` against `$102`, so the two
     * are read independently and one does not clear the other.
     */
    'gui zone': (): Value => VI(s().activeZone),

    /**
     * `A=Gui Array Read(window,listview,element)` — "the number of the array
     * associated to the specified element of the listview".
     *
     * A listview holds only the non-empty entries, so its numbering and the
     * array's diverge as soon as one element is blank. The guide's example:
     *
     *     A$(0)="Hello" A$(1)="" A$(2)="World!" A$(3)="" A$(4)="Amiga RULEZ!"
     *
     * "if the user click on 'World!' Gui Read() returns 1. But the array is
     * A$(2)". This answers 2.
     *
     * $3112 walks the node list the library built and reads `$e` of each,
     * where it kept the source index. -1 when the element is past the end,
     * from the `moveq #$ff,d3` at $30e6.
     */
    'gui array read': (_, a): Value => {
      const g = s()
      const w = windowOf(g, int(a[0]!))
      const items = listArray(rt, g, w, int(a[1]!))
      if (items === null) return VI(-1)
      return VI(g.listItems(items)[int(a[2]!)]?.index ?? -1)
    },

    /**
     * `A=Gui Array(element)` — "the equivalent of Gui Code, but returns the
     * correct array value associated to the listview element".
     *
     * One word at `$1a0`, filled in when a listview event is decoded. It
     * takes an argument the routine never reads: $3126 loads `$1a0` and
     * returns, so `Gui Array(0)` and `Gui Array(99)` answer the same thing.
     */
    'gui array': (): Value => VI(s().arrayIndex),

    /**
     * `LOCK=Gui Pub Screen(NAME$)` — "attempt to obtain access to the named
     * public screen ... or else the value returned in LOCK will be 0".
     *
     * It frees the previous lock first, at $2af6, which is the guide's "If
     * you try to lock another screen with Gui Pub Screen, the previous screen
     * will be freed automatically". The lock also becomes the current screen:
     * $2b0a writes it to `$1d2` as well as `$1ce`, and `$1d2` is what `Gui
     * Mouse X` reads its coordinates out of.
     */
    'gui pub screen': (_, a): Value => {
      const g = s()
      const name = str(a[0]!)
      g.pubLock = 0
      g.pubName = ''
      if (!PUB_SCREENS.includes(name)) return VI(0)
      g.pubName = name
      g.pubLock = PUB_SCREENS.indexOf(name) + 1
      // $2b0a stores the lock in `$1d2` as well, so the locked screen becomes
      // the one `Gui Screen Width` and `Gui Mouse X` answer about
      g.beforeLock = g.current
      g.current = g.workbench
      return VI(g.pubLock)
    },

    /**
     * `A$=Gui Pub Name$` — "the next public screen name from the Amiga's
     * list".
     *
     * The guide's own way of reading it, which is also the only safe one:
     *
     *     Gui Pub List
     *     For I=0 To 31 : PUB$(I)=Gui Pub Name$ : Exit If PUB$(I)="" : Next
     *     Gui Pub List Free
     *
     * Empty when no list is held, and empty at the end -- $2b7a finds the
     * node whose ln_Succ is zero, which is the List's own tail sentinel,
     * unlocks the list there and answers with AMOS's shared empty string. So
     * the loop above terminates by itself and the `Gui Pub List Free` after
     * it has nothing left to do.
     */
    'gui pub name$': (): Value => {
      const g = s()
      if (g.pubListAt < 0) return VS('')
      const name = PUB_SCREENS[g.pubListAt]
      if (name === undefined) {
        g.pubListAt = -1
        return VS('')
      }
      g.pubListAt++
      return VS(name)
    },

    /**
     * `C=Gui Pub Check(screen number)` — "Return the number of windows opened
     * on the specified Screen".
     *
     * DEFECT: it counts one less than that. Routine 221 at $49de starts at
     * `Screen.FirstWindow` and then counts NextWindow LINKS, so a screen with
     * one window answers 0 and a screen with three answers 2. It also reads
     * through a null FirstWindow, because the count begins by dereferencing
     * it without a test -- an empty screen walks whatever is at address 0.
     *
     * Zero for a screen that does not exist, which is not an error: routine
     * 259 answers 0 and $49ea takes the count with it.
     */
    'gui pub check': (_, a): Value => {
      const g = s()
      const screen = g.screens.get(int(a[0]!))
      if (screen === undefined) return VI(0)
      return VI(Math.max(0, [...g.windows.values()].filter((w) => w.screen === screen.number).length - 1))
    },

    /**
     * `A=Gui Screen Width` and `Gui Screen Height` — the CURRENT screen's,
     * with no argument.
     *
     * All four of these read `$1d2` rather than taking a number, which their
     * specs say too: a bare `0`. So they answer about whichever screen was
     * opened or locked last, and "Screen not opened" when there has been
     * neither. `Screen.Width` is at `$c` and `Height` at `$e`.
     */
    'gui screen width': (): Value => VI(currentScreen(s()).width),
    'gui screen height': (): Value => VI(currentScreen(s()).height),

    /**
     * `A=Gui Screen Depth` — the bitplane count, read out of the BitMap
     * rather than remembered: $2fe4 walks `Screen + $54` to the RastPort,
     * `$4` of that to the BitMap and `$5` of that to Depth.
     */
    'gui screen depth': (): Value => VI(currentScreen(s()).depth),

    /**
     * `A=Gui Screen Colours` — 1 shifted left by that same depth, built by
     * the `rol.l #$1` loop at $2d3c rather than by a table.
     */
    'gui screen colours': (): Value => VI(1 << currentScreen(s()).depth),

    /**
     * `V=Gui Screen Base(screen)` — "the start address in memory of the
     * screen structure, so you can access directly to its informations".
     *
     * This one DOES take a number, and it is the Screen pointer routine 259
     * found. DEVIATION: nothing here has an address, and the guide's own next
     * sentence says what a program is expected to do with it -- "Don't modify
     * it if you don't know what are you doing!" -- so this answers a number
     * that is non-zero and stable for a screen and nothing more.
     */
    'gui screen base': (_, a): Value => VI(0x10_0000 + screenOf(s(), int(a[0]!)).number),

    /**
     * `A=Gui Monitor(modeID)` — "checks the specified monitor ID for its
     * existence ... A=Gui Monitor($A9004)".
     *
     * graphics.library's ModeNotAvailable (-$31e), plus one. That call
     * answers 0 when the mode is there and a NEGATIVE error code when it is
     * not -- DI_AVAIL_NOMONITOR is -2 -- so the guide's "if the monitor is
     * available, then the result returned will be 1, else it will be 0" is
     * right about the 1 and wrong about the 0: an absent mode answers -1 or
     * lower.
     *
     * DEVIATION: this port has no display database. Every mode answers
     * available, which is the 1.
     */
    'gui monitor': (): Value => VI(1),

    /**
     * `A=Gui Aga(colour palette)` — "Convert an 8-bit palette value into AGA
     * 32-bit."
     *
     * Each nibble of an AMOS $RGB colour times $11, so $f becomes $ff, packed
     * back as $00RRGGBB by the three `move.b` and four rotates at $3a18.
     *
     * The top byte is never written. d5 goes into that sequence carrying
     * whatever the interpreter last left in it, its byte 3 comes out at bits
     * 24 to 31, and nothing clears it -- so on the machine the answer's high
     * byte is register litter. This port has no litter to reproduce and
     * answers with it zero.
     */
    'gui aga': (_, a): Value => {
      const c = int(a[0]!)
      const ch = (n: number): number => ((c >> n) & 0xf) * 0x11
      return VI((ch(8) << 16) | (ch(4) << 8) | ch(0))
    },

    /** `A=Gui Os` — "the operating system version number", `$18a` */
    'gui os': (): Value => VI(GUI_OS_VERSION),

    /** `A=Gui Window` — which window generated the last event */
    'gui window': (): Value => VI(s().eventWindow()),

    /** `A=Gui Selected` — the currently selected window */
    'gui selected': (): Value => VI(s().selected),

    /**
     * `A=Gui Actual` — "the window number set by the Gui Gfx command".
     *
     * -1 when no window is open at all: $2158 is `moveq #$ff,d3` and the
     * window-list test at $215a leaves it there. The guide does not say so.
     */
    'gui actual': (): Value => VI(s().windows.size === 0 ? -1 : s().actual),

    /**
     * `INK=Gui Point(X,Y)` — "Works in exactly the same way as the Amos
     * command Point. It will simply returns the colour of the point at the
     * specified X,Y coordinates."
     */
    'gui point': (_, a): Value => VI(gfx(s()).rp.point(int(a[0]!), int(a[1]!))),

    /**
     * `A=Gui Read(window,gadget)` — "the current status of the specified
     * gadget", which is its attribute 0.
     *
     * "Gui Read is similar to Gui Code except it doesnt need to be called
     * after the specified gadget is selected", so unlike `Gui Code` this does
     * not reset itself.
     */
    'gui read': (_, a): Value => {
      const g = s()
      const w = g.windows.get(int(a[0]!))
      const id = int(a[1]!)
      if (w === undefined || g.gadget(w, id) === null) return VI(0)
      return VI(g.attrsOf(w, id)[0])
    },

    /**
     * `A$=Gui Read$(window,gadget)` — "the string held in the specified
     * gadget", for three kinds:
     *
     *     LISTVIEW  Selected item
     *     CYCLE     Selected item
     *     STRING    Text entered
     *
     * "For all the other kind of gadgets a empty string will be returned."
     *
     * A CYCLE selects out of the item list the bank carries, indexed by its
     * attribute 0, which is what `Gui Code` reports when the user clicks it:
     * "CYCLE - Currently selected item (in order of list, 0 is first entry)".
     * Anything `Gui Set$` put there wins, since a program that set its own
     * text meant it.
     *
     * A LISTVIEW's items are not in the bank and cannot be: the converter
     * excludes GTLV_Labels from the tags that make a gadget carry a payload
     * and zeroes its data on the way past, because the list arrives at run
     * time from a program's own array through `Gui Set
     * window,gadget,1,Array(...)`. So this reads that array, skipping the
     * empty elements the way the listview itself does.
     */
    'gui read$': (_, a): Value => {
      const g = s()
      const w = windowOf(s(), int(a[0]!))
      const id = int(a[1]!)
      const gadget = g.gadget(w, id)
      if (gadget === null || !READ_STRING_KINDS.has(gadget.kind)) return VS('')
      const array = gadget.kind === KIND.LISTVIEW ? listArray(rt, g, w, id) : null
      if (array !== null) return VS(g.listItems(array)[g.attrsOf(w, id)[0]]?.text ?? '')
      const set = w.strings.get(id)
      if (set !== undefined) return VS(set)
      if (gadget.items.length > 0) return VS(gadget.items[g.attrsOf(w, id)[0]] ?? '')
      return VS(gadget.text)
    },

    /**
     * `A=Gui Kind(window,gadget)` — the gadget type.
     *
     * The guide's list opens "0 - BUTTON (with image)", which is GuiConv's
     * own kind 0 and gadtools' GENERIC, and is the fifth place this port has
     * seen that substitution stated.
     */
    'gui kind': (_, a): Value => {
      const g = s()
      const w = g.windows.get(int(a[0]!))
      if (w === undefined) return VI(-1)
      return VI(g.gadget(w, int(a[1]!))?.kind ?? -1)
    },

    /**
     * `A=Gui Check(window,x,y)` --- "Checks the window at the specified X and Y
     * coordinates to see if a gadget exists. If a gadget does exist, the
     * number of the gadget is returned, else -1 is reported."
     *
     * The walk at $2f8c reads the window's gadget pointer array forward from
     * `$46` and answers the FIRST box the point falls in, as `$26` of that
     * Gadget --- the GadgetID, not the index. A window with no gadgets is the
     * `move.w $22(a0),d1 / beq` at $2f7e and answers the `moveq #$ff,d0`
     * standing above it.
     *
     * The box test is INCLUSIVE on all four edges: `cmp.w d2,d4 / bgt` and
     * `cmp.w d2,d6 / blt` against LeftEdge and LeftEdge+Width, so a point
     * exactly on the far edge is inside. One pixel wider than the gadget is,
     * on each side.
     */
    'gui check': (_, a): Value => {
      const w = windowOf(s(), int(a[0]!))
      const x = int(a[1]!)
      const y = int(a[2]!)
      for (const d of w.design.gadgets) {
        if (x >= d.leftEdge && x <= d.leftEdge + d.width && y >= d.topEdge && y <= d.topEdge + d.height) {
          return VI(d.id)
        }
      }
      return VI(-1)
    },

    /** `GAD=Gui Gadget` — the gadget a mouse or drag event named */
    'gui gadget': (): Value => VI(s().activeGadget),

    /**
     * `A=Gui Key Shift` — "the status of the shift keys", the same bitmap
     * AMOS's own `Key Shift` answers with.
     *
     * One word at `$e4`, read and returned: $24d8 is four instructions. What
     * makes the keyword interesting is where the word comes from, which is
     * `GuiState.keyShift` and the mask the pump puts on it.
     *
     * DEFECT: bit 2, Caps Lock, is cleared before this can see it. See
     * KEY_SHIFT_MASK in ./guistate.ts.
     */
    'gui key shift': (): Value => VI(s().keyShift),

    /**
     * `A=Gui Len(string,mode)` — "the length (in pixels) of the string. It
     * works just like the AMOS command Text Length()".
     *
     * "mode" is a window number, and $2884 splits three ways on it. A
     * negative one measures against the CURRENT SCREEN's RastPort, `$1d2`
     * plus $54; an omitted one and a positive one both go through the window
     * lookup, and a window laid out in topaz/8 skips graphics.library
     * entirely — $28a2 is `move.w (a0)+,d0 / mulu.w #$8,d0`, the string's
     * length byte count times eight. Everything else reaches TextLength
     * (-$36) on the window's SCREEN, at `Window.WScreen` ($2e) plus $54,
     * which is not the window's own RastPort.
     *
     * DEVIATION: all three answer the same number here. The screen font is
     * `$294`, taken off the RastPort's TextFont at $56a6, and with no
     * Preferences font to read this port holds it at topaz/8's 8. So the
     * fixed and the measured path agree until a screen carries a real font.
     * The error does not: a window number that is not open raises 10, and a
     * negative one never looks.
     */
    'gui len': (_, a): Value => {
      const g = s()
      const text = str(a[0]!)
      // 1.61's spec is `02`, one argument. Routine 108 has no mode to split on
      // and no window to look up: it goes straight to TextLength on the font
      // at `$54` of the VisualInfo, so it cannot raise and it cannot take the
      // fixed-width arm either
      if (a[1] === undefined) return VI(text.length * g.fontWidth)
      const mode = int(a[1])
      if (mode !== OMITTED && mode < 0) return VI(text.length * g.fontWidth)
      const w = mode === OMITTED ? target(g) : (g.windows.get(mode) ?? null)
      if (w === null) guiError(GUI_ERR.WINDOW_NOT_OPEN)
      return VI(text.length * (w.topaz ? TOPAZ_SIZE : g.fontWidth))
    },

    /**
     * `A=Gui Text Base` — "the number of pixels from the top of a character,
     * and at the point from which it will be printed on the screen".
     *
     * `rp_TxBaseline`, the word at $3e of the RastPort at `$1bc`. Six for
     * topaz/8, which is what this port's windows carry until a font is set on
     * one.
     *
     * The error is the odd part. Every other `$1bc` reader loads `moveq
     * #$b,d7` for "Gfx output not defined"; $2cce loads `moveq #$7,d7`, which
     * is "Gui not open". One keyword out of a dozen, and the guide mentions
     * neither.
     */
    'gui text base': (): Value => {
      const w = target(s()) ?? guiError(GUI_ERR.GUI_NOT_OPEN)
      // tf_Baseline; topaz/8's is 6, as ./instr.ts's `Text Base` also reads
      return VI(w.rp.font?.baseline ?? 6)
    },

    /**
     * `A=Gui Gad Adr(window,gadget)` — "the structure address of the
     * specified gadget. Note: Its not a good idea to mess around with the
     * structure values in memory unless you know what you are doing!"
     *
     * Routine 85 is three instructions over routine 246, the same lookup
     * `Gui X Gad` and its three siblings use — and then it does not
     * dereference what comes back. So the two keywords differ only in what
     * happens when the lookup fails: $279e is `Rbeq routine 264` and raises
     * "Gadget not defined", $2828 is `move.l d0,d3` and answers 0. A closed
     * window, a negative gadget and a gadget past the end all answer 0 here
     * and all raise 2 there.
     *
     * See GUI_GADGET_ORIGIN in ./guistate.ts for where the number comes from.
     */
    'gui gad adr': (_, a): Value => {
      const g = s()
      const win = int(a[0]!)
      const id = int(a[1]!)
      const w = win === OMITTED ? target(g) : (g.windows.get(win) ?? null)
      if (w === null || id < 0) return VI(0)
      const index = w.design.gadgets.findIndex((gad) => gad.id === id)
      if (index < 0) return VI(0)
      return VI(g.gadgetAddress(w.number, index))
    },

    /**
     * `A=Gui Gad Tag(gui,gadget,bank,tag)` — the address of one gadget's tag
     * data in the bank.
     *
     * The one keyword of 204 the guide has no node for. Routine 126 walks the
     * bank the way ./guibank.ts does: the design chain by the word at +0, the
     * tag area by the word at $1c, the gadget count at $22, then one
     * terminated `(tag, data)` list per gadget. It answers the address of the
     * DATA longword — $2f54 reads the tag with `move.l (a1)+,d0` and returns
     * a1 after the post-increment — and 0 for a tag the gadget does not
     * carry.
     *
     * `bank` omitted takes the chain head cached at `$86`, which is the bank
     * `Gui Bank` or `Gui Open` last named.
     *
     * DEFECT: the last design in the chain cannot be reached. $2f18 reads the
     * chain word before the `dbra`, and a zero one — which is exactly what
     * ends a chain — branches to $2f26 with the counter still at or above
     * zero, where `tst.w d1 / bge` raises "Gui not defined". So a bank
     * holding one GUI, which is what the converter writes by default, has no
     * design this keyword will answer about at all, and a bank holding three
     * serves 1 and 2.
     *
     * DEFECT: the gadget bound is checked with `cmp.w` at $2f30 and walked
     * with `cmp.l` at $2f4e. `Gui Gad Tag(1,65536,...)` passes a bound of, say,
     * 12 on the low word and then counts 65,537 tag lists forward, off the end
     * of the bank. Reproduced as far as it can be: the bound is the word
     * compare, and running out of lists answers 0 rather than reading on.
     *
     * DEFECT: $2eee is `move.w a0,d0 / tst.l d0` on the
     * address `L_Bnk_GetAdr` returned, so a bank landing on a $xxxx0000
     * boundary reads as "Bank not reserved". On the machine that is one
     * address in 65,536, and it is NOT reproduced here: `Runtime.bankBase` is
     * `0x01000000 + n * 0x00100000` and every bank has a zero low word, so
     * reproducing it would refuse all of them — the port's address scheme
     * wearing the library's name.
     */
    'gui gad tag': (_, a): Value => {
      const g = s()
      const design = int(a[0]!)
      const gadget = int(a[1]!)
      const bank = int(a[2]!)
      const tag = int(a[3]!) >>> 0
      let list: Gui[]
      let base: number
      if (bank === OMITTED) {
        list = g.designs
        base = rt.bankBase(g.bank)
      } else {
        const held = rt.memBanks.get(bank)
        list = held === undefined ? [] : readGuiBank(held.data)
        base = rt.bankBase(bank)
      }
      if (list.length === 0) guiError(GUI_ERR.BANK_NOT_RESERVED)
      if (design <= 0) guiError(GUI_ERR.GUI_NOT_DEFINED)
      if (gadget < 0) guiError(GUI_ERR.GADGET_NOT_DEFINED)
      // the walk stops one short of the end; see the defect above
      if (design >= list.length) guiError(GUI_ERR.GUI_NOT_DEFINED)
      const gui = list[design - 1]!
      if (((gadget + 1) & 0xffff) > (gui.gadgets.length & 0xffff)) guiError(GUI_ERR.GADGET_NOT_DEFINED)
      const tags = gui.gadgetTags[gadget]
      if (tags === undefined) return VI(0)
      const found = tags.findIndex((t) => t.tag === tag)
      if (found < 0) return VI(0)
      // each list before this one is its pairs plus the terminator longword
      let at = 0
      for (let i = 0; i < gadget; i++) at += (gui.gadgetTags[i]?.length ?? 0) * 8 + 4
      return VI(base + gui.offset + gui.tagsAt + at + found * 8 + 4)
    },

    /**
     * `A$=Gui Get$(file name)` — "Loads the file into the specified string.
     * This command is good for config data and such. It does not require the
     * Open In...Line Input#...Close commands".
     *
     * $3174 is Open (MODE_OLDFILE, $3ed), then the size by two Seeks —
     * `Seek(f,0,1)` to the end and `Seek(f,0,-1)` back, whose return is the
     * position it left, which is the length — then one Read into a string
     * that routine 249 sized to it. "Unable to open file" for a file that is
     * not there, and again if the string will not allocate.
     *
     * DEFECT: an AMOS string's length is a WORD. The allocation is the file's
     * full size but routine 249 writes the length with `move.w d2,(a0)+` at
     * $677e, so a file of 70,000 bytes lands in the heap whole under a string
     * that reports 4,464 — the size AND $ffff. The bytes past that are
     * unreachable through the string, which is what the mask does here.
     */
    'gui get$': (_, a): Value => {
      const raw = rt.vfs?.readFile(str(a[0]!)) ?? rt.fs?.read(str(a[0]!)) ?? null
      if (raw === null) guiError(GUI_ERR.UNABLE_TO_OPEN_FILE)
      return VS(fromBytes(Uint8Array.from(raw).subarray(0, raw.length & 0xffff)))
    },

    /**
     * `A$=Gui Input$` — "reads a line (requires a RETURN) from the current
     * input, for example STDIN".
     *
     * $326e: Input() (-$36), FGets (-$150) into the state's own $400-byte
     * scratch at `$2b8`, then the newline is turned into a NUL — $32a0 scans
     * for $0a and writes the zero over it — and routine 249 measures what is
     * left. So the RETURN does not come back with the line.
     *
     * DEVIATION: no shell, so `Input()` answers zero and $327e takes the
     * `beq` to the null string at `$662(a5)`. That is the same branch a
     * Workbench-launched program takes on the machine, and it is the one
     * ./easylife.ts's `=Elin Exists` already reports a zero for.
     */
    'gui input$': (): Value => VS(''),

    /**
     * `C$=Gui Clip Read$` — "returns the current content of the system
     * clipboard. Obviously it works only if some characters are present..."
     *
     * $477e opens `CLIPS:0`, reads twelve bytes and demands FTXT at +8, then
     * walks the chunks. Every chunk's body is read into the SAME buffer and
     * only a CHRS advances the write pointer, so the answer is the CHRS
     * bodies run together and everything else is overwritten by whatever
     * follows it. A nested FORM ends the walk.
     *
     * DEFECT: chunk sizes are truncated to sixteen bits on the READ but not on
     * the pointer. $4818 is `andi.l #$fffe,d3` and the immediate is
     * $0000fffe, so a CHRS of 100,000 bytes reads 34,464 while $4812's
     * `adda.l d6,a3` moves the write pointer the full 100,000 — leaving
     * 65,536 bytes of never-written buffer inside the answer, and the file
     * position 65,536 bytes short of the next chunk. Reproduced, with zeroes
     * where the machine would have whatever AllocVec left.
     */
    'gui clip read$': (): Value => {
      const raw = rt.vfs?.readFile(CLIPBOARD_PATH) ?? null
      if (raw === null || raw.length < 12) return VS('')
      const b = Uint8Array.from(raw)
      if (be32(b, 8) !== fourcc('FTXT')) return VS('')
      const buf: number[] = []
      // a3, the write pointer, and the file position beside it
      let wp = 0
      let fp = 12
      // $47e6: eight bytes of header a chunk, and a short read ends the walk
      while (fp + 8 <= b.length) {
        const id = be32(b, fp)
        const size = be32(b, fp + 4)
        if (id === fourcc('FORM')) break
        fp += 8
        // $4818's `andi.l #$fffe` on the rounded-up size: a word-wide mask
        const step = (size + 1) & 0xfffe
        // $4808 captures the destination BEFORE $4812 advances the pointer
        const dst = wp
        if (id === fourcc('CHRS')) wp += size
        for (let i = 0; i < step; i++) buf[dst + i] = b[fp + i] ?? 0
        fp += step
      }
      let out = ''
      for (let i = 0; i < wp; i++) out += String.fromCharCode(buf[i] ?? 0)
      return VS(out)
    },

    /**
     * `A=Gui Notify(file)` — "Start DOS notification on the specified
     * file/dir... when something modify it you'll be informed (Gui Wait
     * return -14, and Gui Code the notify ID".
     *
     * $3a2c refuses two names without an error of any kind: an empty one, and
     * one longer than $50 characters — `cmpi.w #$50,d3 / bgt` — which is the
     * room the node has for it after the $30 the header takes. Both answer 0.
     * Then AllocVec, StartNotify (-$378) with nr_Flags 9, which is
     * NRF_SEND_MESSAGE and NRF_WAIT_REPLY, to the extension's own port at
     * `$c4`. A StartNotify that fails frees the node and answers 0 too.
     *
     * The id a program holds is the node's address, and $71ac reads it back
     * out of the NotifyMessage's nm_NReq at `$1a` into `$cc`, which is what
     * `Gui Code` answers. So the guide's "The Notify ID is the value returned
     * by the Gui Notify command" is exact.
     *
     * DEVIATION: `AmigaFS.watch` reports a file appearing or going away, and
     * a write over an existing file arrives as an `add`. That covers
     * AmigaDOS's NOTIFY_ON_WRITE, which is what nr_Flags asks for. Metadata
     * changes are not reported here and would be on the machine.
     */
    'gui notify': (_, a): Value => {
      const path = str(a[0]!)
      if (path === '' || path.length > 0x50) return VI(0)
      const fs = rt.vfs
      if (fs === null) return VI(0)
      const g = s()
      const id = g.notifyHandle()
      const stop = fs.watch((e) => {
        if (!underNotify(path, e.path)) return
        // $71ac: no window is written to `$de`, so `Gui Window` is untouched
        g.post({ code: GUI_EVENT.NOTIFY, result: id, text: '' })
      })
      g.notifies.set(id, { id, path, stop })
      return VI(id)
    },

    /**
     * `C=Gui Catalog Open(catalog file,gui bank number)` — "Open the
     * specified catalog file (if exist....) and automatically localize the
     * specified GUI bank. The process is automatic.... if the system is
     * localized in French, the command search the French catalog".
     *
     * $3b84 checks three things and answers 0 for any of them: the bank has
     * to exist, its NAME has to be `Gui ` — `cmpi.l #$47756920,-$8(a0)`, the
     * four bytes AMOS keeps in front of a bank — and locale.library has to be
     * open at `$13c`. Then OpenCatalogA(NULL, name, NULL), which is the
     * system's preferred language and no tags at all. The answer is the
     * catalog, and $3bce walks the design chain writing it into `$34` of
     * every one.
     *
     * "If the needed catalog is not available, the command return 0, and the
     * built-in strings of the GUI bank will be used", which is the same
     * branch.
     *
     * The guide's warning is worth keeping because it is a consequence of
     * where the localisation happens: "You must localize your bank BEFORE
     * open anyone of its GUI!!!" The strings are substituted while the window
     * is BUILT, at $5a2c, so a window already open keeps the labels it was
     * built with. See `GuiState.localise` for the numbering, which comes off
     * GuiConv's own `_LOCALE` procedure.
     */
    'gui catalog open': (_, a): Value => {
      const g = s()
      const name = str(a[0]!)
      const bank = int(a[1]!)
      const held = rt.memBanks.get(bank)
      if (held === undefined || held.name.trim() !== 'Gui') return VI(0)
      const fs = rt.vfs
      if (fs === null || name === '') return VI(0)
      for (const path of CATALOG_PATHS(name)) {
        const data = fs.readFile(path)
        if (data === null) continue
        const cat = parseCatalog(data)
        if (cat === null) continue
        const id = g.notifyHandle()
        g.catalogs.set(id, cat)
        g.catalog = cat
        return VI(id)
      }
      return VI(0)
    },

    /**
     * `A$=Gui Catalog$(number)` — "Returns the specified string held in the
     * current loaded catalog. A catalog is like a Amos resource bank."
     *
     * $3cc0 reads `$34` off the design chain HEAD at `$86` — not off the
     * design a window was opened from — and calls GetCatalogStr (-$48) with
     * the null string at `$662(a5)` for its default. So an id the catalog
     * does not carry answers empty rather than answering the bank's built-in
     * string, which is what the window builder would have used.
     *
     * With no bank read yet, or no catalog attached, $3cca and the
     * GetCatalogStr result both fall to the same empty answer.
     *
     * "The number of each string is indicated in the .ct (catalog translator)
     * file created by the GUI Converter... the string number is indicated
     * just after the MSG suffix."
     */
    'gui catalog$': (_, a): Value => VS(getCatalogStr(s().catalog, int(a[0]!), '')),

    /**
     * `C=Gui User Catalog` — "the number of the first user string defined in
     * the catalog".
     *
     * One word, at +68 of the bank's head design, which GuiConv's `LOCUSR`
     * fills in with `Doke WORK,USC` written to file offset 88 — the same
     * field once the twenty-byte AmBk block is off the front. USC is
     * `LOCSTR+1` at the moment the converter starts scanning the editor's
     * listing for `GUILOCALE:`, so it is the number the first `Data` line
     * after that marker got.
     *
     * Zero when the bank has no user strings, and zero when no bank has been
     * read: $4354 tests `$86` and leaves d3 at 0.
     */
    'gui user catalog': (): Value => VI(s().designs[0]?.userCatalog ?? 0),

    /**
     * `C=Xfa Check(file name)` — "return TRUE if the specified file is a XFA
     * anim, otherwise returns 0".
     *
     * $3f06 loads the header alone — XFA_LoadAnim with d0 = 0 — and copies
     * six fields out of XFA_HeadPtr's block into the state, where the six
     * reader keywords find them:
     *
     *     +$0  WORD  width in BYTES, and $3f38 shifts it left three
     *     +$2  WORD  height
     *     +$4  LONG  screen mode id
     *     +$8  BYTE  depth
     *     +$9  BYTE  pack mode
     *     +$a  LONG  frames
     *
     * Recorded because it is real evidence about a format nothing here can
     * read yet, and it is what a future xfa.library port would fill in.
     *
     * It does NOT free the anim it loaded, and it raises nothing: a missing
     * library and a file that is not an anim both leave d0 at zero. See `Xfa
     * Play` for why that is the answer here.
     */
    'xfa check': (_, a): Value => {
      void str(a[0]!)
      return VI(0)
    },

    /**
     * The six readers — `Xfa Width`, `Height`, `Mode Id`, `Depth`, `Pack` and
     * `Frames`. One `move` each out of `$2a8` to `$2b4`, no library, no
     * error, and zero until an `Xfa Check` has succeeded.
     *
     * "Returns the pixel width of the XFA animation file previously checked
     * using the Xfa Check command" — width is stored in bytes and multiplied
     * by eight on the way in, so what these answer is already pixels.
     */
    'xfa width': (): Value => VI(s().xfa.width),
    'xfa height': (): Value => VI(s().xfa.height),
    'xfa mode id': (): Value => VI(s().xfa.modeId),
    'xfa depth': (): Value => VI(s().xfa.depth),
    'xfa pack': (): Value => VI(s().xfa.pack),
    'xfa frames': (): Value => VI(s().xfa.frames),

    /**
     * `S=Tcp Open(URL$,port,user data)` — "establishes a connection with the
     * specified URL$ at the specified port... this command returns
     * immediately without waiting for the connection response".
     *
     * The whole group is bsdsocket.library and it is asynchronous: "Like all
     * the other events, Gui Wait handles the TCP/IP events too and returns
     * the value -9", with `Gui Code` carrying 1 to accept, 2 connected, 6
     * downloaded, 8 readable, 16 writeable, 32 error, 64 closed.
     *
     * $4362 is three steps and the guide documents all three failures:
     *
     *     routine 227  OpenLibrary + socket(AF_INET, SOCK_STREAM)   -1
     *     routine 230  gethostbyname (-$d2)                         -2
     *     connect (-$36), and EINPROGRESS ($24) is SUCCESS here     -3
     *
     * "This command may fail, in this case it returns a negative value. -1 =
     * Unable to alocate a socket, -2 = Unable to get host information, -3 =
     * Unable to open connection."
     *
     * DEVIATION: there is no TCP/IP stack under this port, and there is no
     * host capability that could supply one — `../amiga/host.ts` has files,
     * audio, a printer and serial ports, and nothing that opens a socket. So
     * routine 227's `jsr -$228(a6)` on "bsdsocket.library" answers zero, and
     * -1 is what every `Tcp Open` and `Tcp Listen` returns. Every other
     * keyword in the group then finds an empty socket chain, which is the
     * same state a machine with no Internet stack is in. A socket capability
     * would light all eighteen up without changing any of them.
     */
    'tcp open': (_, a): Value => {
      const g = s()
      // 1.61's spec is `00,2`: a channel and a name, and the name gets `TCP:`
      // in front of it. GuiNet.Amos passes "ftp.wustl.edu/80", which is
      // AmiTCP's handler syntax for host and port
      if (g.release === '1.6x') return VI(tcpOpen(rt, g, int(a[0]!), str(a[1]!), true))
      void str(a[0]!)
      void int(a[1]!)
      void int(a[2]!)
      return VI(TCP_NO_SOCKET)
    },

    /**
     * `H=Tcp F Open(channel,name$)`. The same open without the `TCP:`.
     *
     * Routine 78 is routine 77 with `moveq #$0,d2` where the other has a 1,
     * and that byte is the whole difference: the name goes to dos Open as it
     * stands. So the group's file half is a plain AmigaDOS channel, which is
     * how GuiNet.Amos saves what it downloads.
     */
    'tcp f open': (_, a): Value => VI(tcpOpen(rt, s(), int(a[0]!), str(a[1]!), false)),

    /**
     * `N=Tcp Put(channel,address,length)` and `N=Tcp Put$(channel,text$)` ---
     * a SYNCHRONOUS dos Write, and the answer is what it wrote.
     *
     * Routine 115 is eleven instructions: look the channel up, raise 20 if it
     * is zero, and `jsr -$30(a6)`. `Tcp Put$` reaches it with the string's
     * length word in d3 and the bytes after it in d2, so an AMOS string goes
     * out without its header.
     */
    'tcp put': (_, a): Value => {
      const g = s()
      const c = channelOf(g, int(a[0]!))
      return VI(tcpWrite(rt, g, c, int(a[1]!), int(a[2]!)))
    },
    'tcp put$': (_, a): Value => {
      const g = s()
      const c = channelOf(g, int(a[0]!))
      const bytes = toBytes(str(a[1]!))
      const end = Math.max(c.data.length, c.pos + bytes.length)
      const out = new Uint8Array(end)
      out.set(c.data)
      out.set(bytes, c.pos)
      c.data = out
      c.pos += bytes.length
      c.dirty = true
      return VI(bytes.length)
    },

    /**
     * `N=Tcp Get(channel,address,length)`. The only SYNCHRONOUS read.
     *
     * WaitForChar (-$cc) with `Tcp Limit`'s microseconds, and only then dos
     * Read (-$2a). A wait that comes back empty answers `moveq #$fe,d0`,
     * which is -2, and nothing is read.
     *
     * DEVIATION: WaitForChar here is "are there bytes left", which is the same
     * model ../runtime/instr.ts's `=Port` uses for the same call. On the
     * machine it is a property of the handler and not of the data, and
     * AmigaDOS documents it as meaningful only on an interactive stream.
     */
    'tcp get': (_, a): Value => {
      const g = s()
      const c = channelOf(g, int(a[0]!))
      if (c.pos >= c.data.length) return VI(-2)
      return VI(tcpRead(rt, c, int(a[1]!), int(a[2]!)))
    },

    /**
     * `SOCK=Tcp Listen(Port,user data)` — "creates a new socket, and puts it
     * in Listen mode using the specified port of your computer".
     *
     * $455c is `Tcp Open` with the ends swapped: allocate, gethostname
     * (-$11a) into the scratch, resolve THAT with gethostbyname, bind (-$24)
     * and listen (-$2a) with a backlog of 3. The three failure numbers are
     * the same -1, -2 and -3.
     *
     * "When someone tries to open a connection with the specified port, Gui
     * Wait will inform you (event -9, code 1)."
     */
    'tcp listen': (_, a): Value => {
      void int(a[0]!)
      void int(a[1]!)
      return VI(TCP_NO_SOCKET)
    },

    /**
     * `A=Tcp Send(socket number,address,length)` and `A=Tcp Send$(socket,
     * string)` — "Send the specified number of bytes... The value returned is
     * the number of bytes transferred."
     *
     * $43f0 and $441e are the same four instructions over `send` (-$42); the
     * string form takes the length out of the AMOS string's own word rather
     * than from an argument. Both look the socket up first, so both raise 20.
     */
    'tcp send': (_, a): Value => {
      const g = s()
      if (g.release === '1.6x') {
        const n = int(a[0]!)
        const c = channelOf(g, n)
        const buf = int(a[1]!)
        return VI(tcpPacket(g, ACTION_WRITE, n, buf, tcpWrite(rt, g, c, buf, int(a[2]!))))
      }
      void socketOf(g, int(a[0]!))
      return VI(0)
    },
    'tcp send$': (_, a): Value => {
      const g = s()
      if (g.release === '1.6x') {
        const n = int(a[0]!)
        const c = channelOf(g, n)
        const bytes = toBytes(str(a[1]!))
        const end = Math.max(c.data.length, c.pos + bytes.length)
        const out = new Uint8Array(end)
        out.set(c.data)
        out.set(bytes, c.pos)
        c.data = out
        c.pos += bytes.length
        c.dirty = true
        return VI(tcpPacket(g, ACTION_WRITE, n, 0, bytes.length))
      }
      void socketOf(g, int(a[0]!))
      return VI(0)
    },

    /**
     * `B=Tcp Read(socket,address,length)` — "Read the specified number of
     * bytes from the socket... The value returned is the REAL number of bytes
     * received. It returns -1 if no data is available."
     *
     * The guide is wrong about the -1. $4474 is `tst.l d0 / bge / moveq
     * #$0,d0`, so `recv`'s -1 is turned into ZERO before it is stored at
     * `$2c0` and returned. Nothing in the routine can answer -1.
     *
     * DEFECT: it writes `$2c0` on every call, which is what `Tcp Recvd`
     * reads. So a `Tcp Read` between a download event and the `Tcp Recvd`
     * that reports it overwrites the number the guide says to monitor.
     */
    'tcp read': (_, a): Value => {
      const g = s()
      // 1.61's is the ASYNCHRONOUS half: routine 83 is routine 79 with
      // ACTION_READ where the other has ACTION_WRITE, and both hand back the
      // packet id rather than a byte count. GuiNet.Amos's loop is the shape
      // this is for, `A=Tcp Read(1,S,2048)`, then `Gui Wait` for the -9,
      // then `Tcp Code` for how much arrived
      if (g.release === '1.6x') {
        const n = int(a[0]!)
        const c = channelOf(g, n)
        const buf = int(a[1]!)
        return VI(tcpPacket(g, ACTION_READ, n, buf, tcpRead(rt, c, buf, int(a[2]!))))
      }
      void socketOf(g, int(a[0]!))
      return VI(0)
    },

    /**
     * `T$=Tcp Line$(socket)` — the token is `tcp read$` — "Read a line of
     * text (CR+LF terminated) from the socket. The CR+LF chars are not
     * included in the string."
     *
     * $448a peeks 1,024 bytes with MSG_PEEK ($2 in d2 at $44c8), scans for a
     * CR with an LF behind it, and only then reads that many bytes for real.
     * A buffer with no CRLF in it answers the null string and takes nothing
     * off the socket. The terminator IS counted into the read length and then
     * written over with a NUL at $450e, which is how it stays out of the
     * answer.
     */
    'tcp read$': (_, a): Value => {
      void socketOf(s(), int(a[0]!))
      return VS('')
    },

    /**
     * `D=Tcp User(socket)` and `S=Tcp Accept(socket)`.
     *
     * `Tcp User` is the one socket-taking keyword that does NOT raise: $452e
     * is `beq` to the exit with d3 already zeroed. `Tcp Accept` does raise,
     * and answers -1 when accept (-$30) fails or the new node will not
     * allocate — "Tcp Accept creates and returns a new socket associated to
     * the remote client".
     */
    'tcp user': (_, a): Value => VI(s().sockets.get(int(a[0]!))?.user ?? 0),
    'tcp accept': (_, a): Value => {
      void socketOf(s(), int(a[0]!))
      return VI(TCP_NO_SOCKET)
    },

    /**
     * `T=Tcp Abort(socket)` — "doesn't close the network connection with the
     * remote server but simply disable the automatic download".
     *
     * $493a clears the file, the buffer and the counts at `$30`, `$34` and
     * `$38`, and answers what `$38` held — the download mode. "NOTE: Only on
     * the specified socket the download is aborted".
     *
     * DEFECT: a socket it cannot find returns without setting d3 OR d2.
     * $4942's `beq` jumps past both, so the answer is whatever the last
     * function left in the value register and the TYPE is whatever was in d2
     * — which for a string-returning caller means AMOS reads a string
     * pointer out of an integer. Answered as 0 here.
     */
    'tcp abort': (_, a): Value => {
      const sock = s().sockets.get(int(a[0]!))
      if (sock === undefined) return VI(0)
      sock.download = ''
      return VI(0)
    },

    /**
     * `S=Tcp Socket`, `BYTES=Tcp Total` and `BYTES=Tcp Recvd` — three words
     * of state, one `move.l` each.
     *
     * `Tcp Socket` is `$2e4`, "the socket number associated to the last
     * TCP/IP event". The other two are `$2e8` and `$2c0`, the running total
     * and the last chunk of an automatic download.
     */
    'tcp socket': (): Value => VI(s().tcpSocket),
    'tcp total': (): Value => VI(s().tcpTotal),
    'tcp recvd': (): Value => VI(s().tcpRecvd),

    /**
     * `R=Tcp Response` — "returns automatically the value of the response
     * code held in the string... Obviously you must use this command AFTER
     * the Tcp Line$ command".
     *
     * $46c8 does not parse the line it was given. It writes a NUL over the
     * FOURTH byte of the scratch buffer and hands the first three to
     * dos.library's StrToLong (-$330), so "200 HELLO mail.server.com" answers
     * 200 because the code happens to be three digits and a space.
     *
     * DEFECT: a response code that is not exactly three characters comes back
     * wrong, and there is nothing in the guide's example to warn about it. A
     * four-digit code answers its first three digits; a two-digit one answers
     * the two digits and whatever the separator is.
     */
    'tcp response': (): Value => {
      const line = s().tcpLine
      const n = Number.parseInt(line.slice(0, 3), 10)
      return VI(Number.isNaN(n) ? 0 : n)
    },

    /**
     * `HOST$=Tcp Host$` — "simply returns the host name assigned to your
     * computer", through gethostname (-$11a) into the $100-byte scratch.
     *
     * DEFECT: it does not test `$144`. $46f8 loads the socket base and calls
     * through it whether or not bsdsocket.library ever opened, so on a
     * machine with no Internet stack this jumps through address zero. `Tcp
     * Error` beside it DOES test. The empty string is what the routine would
     * have answered had it checked — $4708 loads the null string before the
     * call and only overwrites it on success.
     */
    'tcp host$': (): Value => VS(''),

    /**
     * `E=Tcp Error` — "the error code associated to the event", which is
     * bsdsocket.library's `Errno` (-$a2) and the guide prints the whole
     * errno table for.
     *
     * DEFECT: with no library open $4972 branches to the `rts` without
     * touching d3 OR d2, so the answer is the previous function's value AND
     * its type. The same shape as `Tcp Abort`'s miss, and the two are the
     * only places in the extension where a function can return a string
     * pointer as an integer. Zero here.
     */
    'tcp error': (): Value => {
      const g = s()
      // 1.61's reads dp_Res2 of the last reply, `$2a2`, where 2.10's is
      // bsdsocket's Errno
      return VI(g.release === '1.6x' ? g.reply.res2 : 0)
    },

    /**
     * The six readers 1.61's pump fills in from one reply, `$29e` through
     * `$2c2`, each of them four instructions and no test.
     *
     * $31f8 writes all six out of the DosPacket the port just collected ---
     * dp_Res1, dp_Res2, dp_Arg2, and the packet's own `$30` and `$34` that
     * routine 117 added past the end of the struct, and dp_Type. They stand
     * until the next reply, so a program may read them in any order after the
     * -9, which is what GuiNet.Amos does: `Tcp Channel` to see whose it was,
     * `Tcp Buffer` and `Tcp Code` to forward it.
     *
     * `Tcp Code` is dp_Res1, so after a read it is the byte count: -1 for an
     * error and 0 at the end of the data, which is the demo's `Until R=0`.
     */
    'tcp code': (): Value => VI(s().reply.res1),
    'tcp packet': (): Value => VI(s().reply.id),
    'tcp type': (): Value => VI(s().reply.type),
    'tcp channel': (): Value => VI(s().reply.channel),
    'tcp buffer': (): Value => VI(s().reply.buffer),

    /** `N=Tcp Count`, `$2b6`, one up per packet sent and one down per reply */
    'tcp count': (): Value => VI(s().packetsOut),

    /**
     * `A=Tcp Check`. Is a reply waiting?
     *
     * Seven instructions on the MsgPort at `$29a`: `lea $14(a0),a0 / cmpa.l
     * $8(a0),a0`, which is the list head against its own TailPred, the
     * standard empty-List test. -1 when something is queued and 0 when
     * nothing is, and it neither collects the message nor disturbs it.
     */
    'tcp check': (): Value => VI(s().packets.length > 0 ? -1 : 0),

    /**
     * `T=Tcp Time`. Seconds since `Tcp Reset`.
     *
     * `(minute - $2b2) * 60 + (tick / 50 - $2b4)`, and every step of that is
     * word-wide: `sub.w`, `mulu.w #$3c`, `sub.w`, `add.w`. GuiNet.Amos divides
     * a byte count by it to show a transfer rate, so the interesting case is
     * calling it in the same second as the reset, which answers 0.
     */
    'tcp time': (): Value => {
      const g = s()
      const [min, sec] = amigaClock(rt)
      const d = (((min - g.stampMinute) & 0xffff) * 60 + ((sec - g.stampSecond) & 0xffff)) & 0xffff
      return VI((d << 16) >> 16)
    },

    /**
     * `A=Gui Border(window,border)` — the size of one of a window's four
     * borders:
     *
     *     0 - Left Border    1 - Top Border
     *     2 - Right Border   3 - Bottom Border
     *
     * DEVIATION: these are Intuition's own border widths, which a window gets
     * from the screen it opened on and from which system gadgets it asked
     * for. These windows have no screen, so the numbers are the ones
     * `../amiga/intuition.ts` reads off `struct Screen`'s WBorLeft and
     * friends, with the title bar's height for the top. A GUI opened on a
     * screen with a taller font would differ.
     */
    'gui border': (_, a): Value => {
      const n = int(a[1]!)
      // 0 to 3 only, and $225e tests the range BEFORE looking the window up,
      // so `Gui Border(9,7)` answers 0 where `Gui Border(9,0)` raises
      if (n < 0 || n > 3) return VI(0)
      void windowOf(s(), int(a[0]!))
      // the four bytes at Window+$36: BorderLeft, Top, Right, Bottom
      return VI([WBORLEFT, TITLE_HEIGHT, WBORRIGHT, WBORBOTTOM][n] ?? 0)
    },
  }
}

/** the event codes, re-exported so the tests and later keyword groups share them */
export { GUI_EVENT }

/**
 * What a caller outside the extension needs to raise an event.
 *
 * `at` is where the pointer was, which the three events the guide lists for
 * `Gui Mouse Ex` carry: -11 mouse click, -12 mouse move and -15 icon
 * drag'n'drop. Omitting it leaves the two state words holding the last
 * position that was reported, which is what the library does.
 */
/**
 * Deliver an AppMessage: event -15, -16 or -17, and the names that came with
 * it.
 *
 * The pump's own arithmetic at $71f8 is one subtraction for all three:
 * `moveq #$f1,d4` is -15, and am_Type minus 7 comes off it. AMTYPE_APPWINDOW
 * is 7 and gives -15, AMTYPE_APPICON is 8 and gives -16, AMTYPE_APPMENUITEM
 * is 9 and gives -17.
 *
 * `Gui Code` answers am_NumArgs, which is zero for a double-click and the
 * count of dropped files otherwise, and those files are then read one at a
 * time by `Gui App Name$`.
 */
export function guiPostAppIcon(rt: Runtime, id: number, names: readonly string[], at?: [number, number]): void {
  const g = rt.gui
  // $720a reads the node's word back out and sign-extends it
  g.appId = ((id & 0xffff) << 16) >> 16
  g.appNames.push(...names)
  const e: GuiEvent = { code: GUI_EVENT.APPICON, result: names.length, text: '' }
  if (at !== undefined) {
    e.mouseX = at[0]
    e.mouseY = at[1]
  }
  g.post(e)
}

export function guiPost(
  rt: Runtime,
  window: number,
  code: number,
  result = 0,
  text = '',
  at?: [number, number],
  qualifier?: number,
): void {
  const e: GuiEvent = { code, result, text, window }
  if (qualifier !== undefined) e.qualifier = qualifier
  if (at !== undefined) {
    e.mouseX = at[0]
    e.mouseY = at[1]
  }
  rt.gui.post(e)
}

