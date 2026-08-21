/**
 * reqtools' EZRequest, GetString and GetLong, driven a frame at a time.
 *
 * ../amiga/reqtools.ts holds the arithmetic and the words; this is the loop
 * around them. Same shape as ./aslreq.ts and ./fsel.ts: the keyword blocks,
 * this steps once a frame, and the keyword reads the answer when `done` goes
 * up. `rtEZRequestA` does not return until the user has finished, and the
 * frame loop IS its event loop.
 *
 * Three of `req.c`'s five modes are here. The two password ones,
 * `rtInternalGetPasswordA` and `rtInternalEnterPasswordA`, are marked
 * `##private` in the FD and no AMOS extension calls either.
 */
import {
  EZREQF,
  FREQF,
  REQ_MODE,
  RT_ENTRY,
  RT_FILEREQ_PREFS,
  RT_FONTREQ_PREFS,
  RT_MAXINT,
  RT_MININT,
  REQPOS,
  RT_SCREENMODEREQ_PREFS,
  RT_TEXT,
  fileReqHit,
  fileReqLayout,
  fileReqRender,
  fontReqHit,
  fontReqLayout,
  fontReqRender,
  reqHit,
  reqLayout,
  reqRender,
  paletteReqHit,
  paletteReqLayout,
  paletteReqRender,
  rtMakeColVal,
  screenReqHit,
  screenReqLayout,
  screenReqRender,
  type FileReqLayout,
  type FileReqSetup,
  type FontReqLayout,
  type FontReqSetup,
  type FontRow,
  type ReqEntry,
  type ReqLayout,
  type ReqMetrics,
  type ReqSetup,
  type PaletteReqLayout,
  type PaletteReqSetup,
  type ScreenReqLayout,
  type ScreenReqSetup,
  type ScreenRow,
} from '../amiga/reqtools'
import { amigaMatch } from '../amiga/dospattern'
import { joinAmigaPath, parentAmigaPath } from '../amiga/vfs'
import {
  IDCMP_CLOSEWINDOW,
  IDCMP_MOUSEBUTTONS,
  SELECTDOWN,
  SYSFONT_YSIZE,
  WB_SLOT,
  WBORBOTTOM,
  WBORLEFT,
  WBORRIGHT,
  WBORTOP,
  type Window,
} from '../amiga/intuition'
import { RastPort } from '../amiga/graphics'
import { DISPLAY_MODES, type DisplayMode } from '../amiga/displayinfo'
import { screenPens } from './aslreq'
import { availFonts, openDiskFont } from './fontlist'
import type { Runtime } from './runtime'

/** what the call itself passes, as opposed to what its tag list says */
export interface RtReqArgs {
  setup: ReqSetup
  /** `rtGetStringA`'s buffer on the way in, and its `maxchars` */
  buffer: string
  maxLen: number
  /** `rtGetLongA`'s `*longptr` on the way in */
  value: number
  /** RTGL_ShowDefault: false empties the gadget instead of printing `value` */
  showDefault: boolean
  /** RTGS_AllowEmpty: an empty string still answers 1 */
  allowEmpty: boolean
  /** RTGS_Invisible: the gadget is edited but its pens are cleared to nothing */
  invisible: boolean
}

export interface RtReqState {
  args: RtReqArgs
  window: Window
  slot: number
  rp: RastPort
  layout: ReqLayout
  /** the string or integer gadget's contents */
  buffer: string
  done: boolean
  /** what the library call answers */
  result: number
  /** the buffer as it is handed back, empty unless the call copied it */
  text: string
  /** `*longptr` on the way out */
  value: number
  /**
   * `Too small!` or `Too big!` while one is up. `SetWinTitleFlash` puts it in
   * the title bar for a moment and puts the real title back; here it stays
   * until the next keystroke, because there is no timer in the frame loop to
   * take it down and a title that flickers for two frames is worse than one
   * that waits to be read.
   */
  flash: string
}

/**
 * The screen a requester lands on, measured.
 *
 * `GetReqScreen` follows RT_Screen, then RT_Window's screen, then the default
 * public screen. This port's Workbench is the last of those, and every AMOS
 * caller either passes a window of its own or gets it.
 */
function metricsFor(rt: Runtime, slot: number): ReqMetrics | null {
  const scr = rt.screens.get(slot)
  if (!scr) return null
  const font = rt.systemFont()
  return {
    screenFontHeight: SYSFONT_YSIZE,
    fontHeight: font.ySize,
    wBorTop: WBORTOP,
    wBorLeft: WBORLEFT,
    wBorRight: WBORRIGHT,
    wBorBottom: WBORBOTTOM,
    visibleWidth: scr.width,
    visibleHeight: scr.height,
    measure: (s) => s.length * font.xSize,
  }
}

/**
 * How many characters an integer gadget takes.
 *
 * `req.c`:591 is `my_CreateIntegerGadget (gad, &ng, 16, *value,
 * GACT_STRINGCENTER)`, a flat 16 with no tag to move it. rtGetLongA has no
 * `maxchars` argument at all --- that belongs to rtGetStringA, one entry
 * earlier in the FD, which is what `delta-1.6` copied its `move.l #$64,d0`
 * from.
 */
export const RT_LONG_MAXCHARS = 16

/** the digits an integer gadget starts with, or nothing when ShowDefault is off */
function initialBuffer(a: RtReqArgs): string {
  if (a.setup.mode === REQ_MODE.ENTER_NUMBER) return a.showDefault ? String(a.value) : ''
  return a.buffer
}

/**
 * Open one. Null when there is no screen to put it on, which is what a failed
 * `GetReqScreen` amounts to.
 *
 * `left` and `top` are `newreqwin.LeftEdge/TopEdge` after `rtSetReqPosition`.
 * REQPOS_CENTERSCR is what this port places every requester at: the pointer
 * position REQPOS_POINTER wants is the user's mouse, and a requester that
 * lands under the pointer in a headless test is a requester nobody can find.
 */
export function startRtReq(rt: Runtime, args: RtReqArgs, slot: number | null): RtReqState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const m = metricsFor(rt, on)
  const scr = rt.screens.get(on)
  if (!m || !scr) return null
  const layout = reqLayout(args.setup, m)
  const window = rt.intuition.openWindow({
    leftEdge: Math.max(0, Math.trunc((scr.width - layout.width) / 2)),
    topEdge: Math.max(0, Math.trunc((scr.height - layout.height) / 2)),
    width: layout.width,
    height: layout.height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_MOUSEBUTTONS,
    // WFLG_DEPTHGADGET | WFLG_DRAGBAR | WFLG_ACTIVATE, which is what
    // `glob->newreqwin.Flags` is set to. No close gadget: a reqtools
    // requester is answered, not dismissed
    flags: 0x4 | 0x2 | 0x1000,
    title: layout.title,
    type: on === WB_SLOT ? 1 : 15,
    ...(on === WB_SLOT ? {} : { screenSlot: on }),
  })
  if (!window) return null
  const rp = new RastPort(scr.rp.bitMap)
  rp.font = rt.systemFont()
  return {
    args,
    window,
    slot: on,
    rp,
    layout,
    buffer: initialBuffer(args),
    done: false,
    result: 0,
    text: '',
    value: args.value,
    flash: '',
  }
}

/**
 * Press one of the buttons, which is `myReqHandler`'s IDCMP_GADGETUP arm.
 *
 * `gadid` is 2 for the leftmost and climbs, except that the LAST is set back
 * to 1, so `gadid - 1` gives the leftmost 1 and the rightmost 0. Anything
 * that is not the rightmost falls through to the mode's own arm, which is why
 * Cancel can answer without touching the buffer and Ok cannot.
 */
function pressGadget(st: RtReqState, index: number): void {
  const mode = st.args.setup.mode
  const last = st.layout.buttons.length - 1
  const gadid = index === last ? 1 : index + 2
  if (gadid === 1 || mode === REQ_MODE.EZREQUEST) {
    st.result = gadid - 1
    st.done = true
    return
  }
  commit(st, gadid)
}

/**
 * What Ok, RETURN in the gadget, and any middle gadget all do.
 *
 * `gadid` is 32 for the string gadget itself, which is `STRINGGADID`, and
 * `gadid > 2 && gadid < 32` is the test that lets an RTGS_GadFmt with three
 * or more labels answer its own number instead of a plain 1.
 */
function commit(st: RtReqState, gadid: number): void {
  const a = st.args
  const filled = st.buffer !== ''
  if (a.setup.mode === REQ_MODE.ENTER_STRING) {
    let copy = filled
    st.result = copy ? 1 : 0
    if (a.allowEmpty) {
      copy = true
      st.result = 1
    }
    if (gadid > 2 && gadid < 32) st.result = gadid - 1
    st.text = copy ? st.buffer : ''
    st.done = true
    return
  }
  // ENTER_NUMBER: the range is checked before anything is answered, and a
  // number outside it flashes the title and leaves the requester up
  if (filled) {
    const val = Number.parseInt(st.buffer, 10)
    const n = Number.isNaN(val) ? 0 : val
    if (n < a.setup.min) {
      st.flash = RT_TEXT.tooSmall
      return
    }
    if (n > a.setup.max) {
      st.flash = RT_TEXT.tooBig
      return
    }
    st.value = n
  }
  st.result = filled ? 1 : 0
  if (gadid > 2 && gadid < 32) st.result = gadid - 1
  st.done = true
}

/** the gadget a shortcut key presses, or -1 */
function keyGadget(st: RtReqState, ch: string, lAmiga: boolean): number {
  const key = ch.toUpperCase()
  const buttons = st.layout.buttons
  const last = buttons.length - 1
  // the underscored letters first: `my_GetKeyGadget` walks the list in order
  // and takes the first match, so a format that underscores the same letter
  // twice only ever reaches the leftmost of them
  for (let i = 0; i < buttons.length; i++) {
    const k = buttons[i]?.key ?? ''
    if (k !== '' && k.toUpperCase() === key) return i
  }
  if (buttons.length === 0) return -1
  // RETURN presses the bold gadget, ESC presses the last one, and neither
  // can be turned off: "The ESC key cannot be disabled"
  if (ch === '\r' || ch === '\n') {
    const bold = buttons.findIndex((b) => b.bold)
    return bold
  }
  if (ch === '\x1b') return last
  // and the four letters. EZREQF_LAMIGAQUAL cuts them down to the two that
  // need the Amiga key held, which is what a destructive requester asks for
  const qual = (st.args.setup.flags & EZREQF.LAMIGAQUAL) === 0 || lAmiga
  if (!qual) return -1
  if (key === 'V' && lAmiga) return 0
  if (key === 'Y') return 0
  if (key === 'B' && lAmiga) return last
  if (key === 'N' || key === 'R') return last
  return -1
}

/** true for a character an integer gadget will take */
function digitOk(buffer: string, ch: string): boolean {
  if (ch >= '0' && ch <= '9') return true
  return ch === '-' && buffer === ''
}

/** one frame: drain the messages, act on them, redraw */
export function stepRtReq(rt: Runtime, st: RtReqState): void {
  if (st.done) return
  for (;;) {
    const msg = st.window.getMsg()
    if (!msg) break
    if (msg.class !== IDCMP_MOUSEBUTTONS || msg.code !== SELECTDOWN) continue
    const hit = reqHit(st.layout, msg.mouseX, msg.mouseY)
    if (!hit) continue
    if (hit.kind === 'button') {
      pressGadget(st, hit.index)
      if (st.done) return
    }
  }

  const editable = st.args.setup.mode !== REQ_MODE.EZREQUEST
  while (rt.input.keyQueue.length > 0) {
    const k = rt.input.keyQueue.shift()
    if (!k) break
    st.flash = ''
    const lAmiga = ((k.shift ?? 0) & 0x40) !== 0
    if (editable) {
      // The string gadget is ACTIVE, and Intuition hands an active string
      // gadget every printable key itself. The window never sees a RAWKEY for
      // one, so `CheckGadgetKey` is only ever offered the keys the gadget
      // refused --- which is why a `_Get` or a `_Cancel` shortcut cannot fire
      // while you are typing a filename, and why an `o` in `#?.doc` types an
      // `o` instead of pressing Ok.
      //
      // RETURN inside the gadget is gadget 32, not a shortcut: the mode
      // forces NORETURNKEY, so nothing is bold and no gadget claims it.
      if (k.ch === '\r' || k.ch === '\n') {
        commit(st, 32)
        if (st.done) return
        continue
      }
      if (k.ch === '\x1b') {
        pressGadget(st, st.layout.buttons.length - 1)
        if (st.done) return
        continue
      }
      if (k.ch === '\b' || k.scan === 0x41) {
        st.buffer = st.buffer.slice(0, -1)
        continue
      }
      if (k.ch < ' ') continue
      // an integer gadget has no `maxchars` argument: `req.c`:591 creates it
      // with a flat 16, and RTGS_MaxChars only reaches the string one
      const cap = st.args.setup.mode === REQ_MODE.ENTER_NUMBER ? RT_LONG_MAXCHARS : st.args.maxLen
      if (st.buffer.length >= cap) continue
      if (st.args.setup.mode === REQ_MODE.ENTER_NUMBER && !digitOk(st.buffer, k.ch)) continue
      st.buffer += k.ch
      continue
    }
    const gad = keyGadget(st, k.ch, lAmiga)
    if (gad >= 0) {
      pressGadget(st, gad)
      if (st.done) return
    }
  }

  const scr = rt.screens.get(st.slot)
  if (!scr) {
    st.done = true
    return
  }
  const w = st.window
  if (st.flash !== '' && w.title !== st.flash) w.title = st.flash
  else if (st.flash === '' && w.title !== st.layout.title) w.title = st.layout.title
  st.rp.clip = { x1: w.leftEdge, y1: w.topEdge, x2: w.leftEdge + w.width - 1, y2: w.topEdge + w.height - 1 }
  // RTGS_Invisible clears the gadget's pens rather than the buffer, so the
  // typing is taken and nothing of it is drawn
  const shown = st.args.invisible ? '' : st.buffer
  reqRender(st.rp, screenPens(scr.depth), st.layout, shown, w.leftEdge, w.topEdge)
}

/** close the window and let the keyword have its answer */
export function finishRtReq(rt: Runtime, st: RtReqState): void {
  rt.intuition.closeWindow(st.window)
}

/* --------------------------------------------------------------------------
 * The file requester
 * ----------------------------------------------------------------------- */

export interface RtFileState {
  setup: FileReqSetup
  window: Window
  slot: number
  rp: RastPort
  layout: FileReqLayout
  /** the rows the list shows, hidden ones already dropped */
  rows: ReqEntry[]
  /** `buff->pos`, the first row on screen */
  first: number
  /** the three string gadgets */
  dir: string
  file: string
  pattern: string
  /** the `._info` toggle, SELECTED when `.info` files are shown */
  showInfo: boolean
  /** the Volumes list is up in place of a directory */
  volumes: boolean
  done: boolean
  /** what `rtFileRequestA` answers: false is Cancel and the close gadget */
  ok: boolean
  /** the File gadget as OK left it */
  result: string
  /** the selected entries, in display order, which is `AllocSelectedFiles` */
  list: ReqEntry[]
  clickFrame: number
  clickRow: number
  /** the `Match...` string requester while one is up, `filereqmain.c`:1166 */
  sub: RtReqState | null
}

/**
 * The double-click window, in frames.
 *
 * The library asks `DoubleClick (glob->sec, glob->mic, im.Seconds,
 * im.Micros)`, which measures against the user's Preferences interval. There
 * is no Preferences here, so this is the Workbench default of half a second
 * counted in PAL frames.
 */
const DOUBLE_CLICK_FRAMES = 25

/** `EndsInDotInfo`: the pattern is matched against the name with `.info` off */
const dotInfo = (name: string): boolean => name.toLowerCase().endsWith('.info')

/**
 * One directory, read and filtered.
 *
 * The order is the library's default and it is the opposite of asl's. With no
 * `ReqTools.prefs` the whole prefs block is zeroed by the clear loop at
 * `$176`, so neither RTPRF_DIRSFIRST nor RTPRF_DIRSMIXED is set, and
 * `SetFileDirMode` then gives files `file_id` 0 and directories
 * `directory_id` 1. `FindEntry` sorts on that number first, so FILES COME
 * FIRST. The prefs guide says the same thing in as many words: "If none of
 * the 'Display Drawers First' or 'Mix Files And Drawers' is checked files
 * will be displayed before drawers."
 *
 * The pattern hides files and never directories, and a `.info` file is
 * matched with its five trailing characters cut off, so `#?.iff` keeps
 * `picture.iff.info`.
 */
export function rtFileEntries(rt: Runtime, dir: string, pattern: string, showInfo: boolean): ReqEntry[] {
  const all = rt.vfs?.listDir(dir) ?? []
  const rows: ReqEntry[] = []
  for (const e of all) {
    if (!e.isDir) {
      const info = dotInfo(e.name)
      if (info && !showInfo) continue
      if (pattern !== '') {
        const probe = info ? e.name.slice(0, -5) : e.name
        if (!amigaMatch(probe, pattern, false, true)) continue
      }
    }
    rows.push({ name: e.name, type: e.isDir ? RT_ENTRY.DIRECTORY : RT_ENTRY.FILE, size: e.size, selected: false })
  }
  const key = (r: ReqEntry): string => `${r.type}${r.name.toLowerCase()}`
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  return rows
}

/** the volume and assign names, which is what `_Volumes` shows */
function rtVolumeEntries(rt: Runtime): ReqEntry[] {
  const vols = (rt.vfs?.volumeNames() ?? []).map((n) => ({
    name: `${n.replace(/:$/, '')}:`,
    type: RT_ENTRY.VOLUME as number,
    size: 0,
    selected: false,
  }))
  const assigns = (rt.vfs?.assignNames() ?? []).map((n) => ({
    name: `${n.replace(/:$/, '')}:`,
    type: RT_ENTRY.ASSIGN as number,
    size: 0,
    selected: false,
  }))
  return [...vols, ...assigns]
}

/** re-read the drawer named in the Drawer gadget, which is `NewDir` */
function rtNewDir(rt: Runtime, st: RtFileState): void {
  st.volumes = false
  st.rows = rtFileEntries(rt, st.dir, st.pattern, st.showInfo)
  st.first = 0
  st.list = []
  st.clickRow = -1
  st.clickFrame = -99
}

/**
 * Open the file requester. Null when there is no screen for it.
 *
 * The window is REQPOS_TOPLEFTSCR at (25, 18) here, which is what the prefs
 * `$14c` builds when there is no `ReqTools.prefs` to replace them.
 */
/**
 * `rtSetReqPosition`, as far as this port needs it.
 *
 * CENTERSCR centres; everything else lands on the prefs' TOPLEFTSCR corner,
 * which is what a requester with no RT_ReqPos tag gets. REQPOS_POINTER is not
 * one of the answers here, and `startRtReq` says why: a requester that opens
 * under the mouse is a requester a headless run cannot find.
 */
function reqPosition(
  reqPos: number,
  prefs: { leftOffset: number; topOffset: number },
  scrW: number,
  scrH: number,
  w: number,
  h: number,
): { left: number; top: number } {
  if (reqPos === REQPOS.CENTERSCR) {
    return { left: Math.max(0, Math.trunc((scrW - w) / 2)), top: Math.max(0, Math.trunc((scrH - h) / 2)) }
  }
  return {
    left: Math.min(prefs.leftOffset, Math.max(0, scrW - w)),
    top: Math.min(prefs.topOffset, Math.max(0, scrH - h)),
  }
}

export function startRtFile(rt: Runtime, setup: FileReqSetup, slot: number | null): RtFileState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const m = metricsFor(rt, on)
  const scr = rt.screens.get(on)
  if (!m || !scr) return null
  const layout = fileReqLayout(setup, m)
  const at = reqPosition(setup.reqPos, RT_FILEREQ_PREFS, scr.width, scr.height, layout.width, layout.height)
  const window = rt.intuition.openWindow({
    leftEdge: at.left,
    topEdge: at.top,
    width: layout.width,
    height: layout.height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW,
    // WFLG_CLOSEGADGET | WFLG_DRAGBAR | WFLG_DEPTHGADGET | WFLG_ACTIVATE.
    // DEVIATION: the machine adds WFLG_SIZEGADGET | WFLG_SIZEBBOTTOM and
    // rebuilds the whole gadget list on IDCMP_NEWSIZE; there is no resize here
    flags: 0x8 | 0x2 | 0x4 | 0x1000,
    title: layout.title,
    type: on === WB_SLOT ? 1 : 15,
    ...(on === WB_SLOT ? {} : { screenSlot: on }),
  })
  if (!window) return null
  const rp = new RastPort(scr.rp.bitMap)
  rp.font = rt.systemFont()
  const st: RtFileState = {
    setup,
    window,
    slot: on,
    rp,
    layout,
    rows: [],
    first: 0,
    dir: setup.dir,
    file: setup.file,
    pattern: setup.pattern,
    showInfo: !setup.hideInfo,
    volumes: false,
    done: false,
    ok: false,
    result: '',
    list: [],
    clickFrame: -99,
    clickRow: -1,
    sub: null,
  }
  rtNewDir(rt, st)
  return st
}

/** `SelectAll`, `filereqextra.c`:614: every unhidden FILE the pattern matches */
function rtSelectAll(st: RtFileState, pattern: string): void {
  for (const e of st.rows) {
    if (e.type !== RT_ENTRY.FILE) continue
    if (amigaMatch(e.name, pattern, false, true)) e.selected = true
  }
  st.file = ''
}

/** `CountAllDeselect`, which `C_lear` and a plain click both reach */
function rtDeselectAll(st: RtFileState): void {
  for (const e of st.rows) e.selected = false
}

/**
 * `LeaveReq`, `filereq.c`:821.
 *
 * Single select answers TRUE only when the File gadget has something in it,
 * so pressing Ok on an empty one is a cancel unless RTFI_AllowEmpty is set.
 * Multiselect answers the list `AllocSelectedFiles` builds, and that routine
 * has a rule of its own: if the name in the File gadget is not among the
 * selected entries, the whole list is thrown away and replaced by that one
 * name. Nico's comment on it is "This is the most intuitive behaviour!"
 */
function rtLeaveFile(st: RtFileState): void {
  st.result = st.file
  if ((st.setup.flags & FREQF.MULTISELECT) !== 0) {
    const picked = st.rows.filter((e) => e.selected && e.type === RT_ENTRY.FILE)
    const named = picked.some((e) => e.name.toLowerCase() === st.file.toLowerCase())
    st.list =
      named || st.file === ''
        ? picked
        : [{ name: st.file, type: RT_ENTRY.FILE, size: 0, selected: true }]
    st.ok = st.list.length > 0
  } else st.ok = st.file !== ''
  st.done = true
}

/**
 * `ClickDown`, `filereq.c`:670, and the GADGETUP arm that follows it.
 *
 * A plain click clears the rest of the selection and toggles this row; a
 * SHIFT click under FREQF_MULTISELECT leaves the others alone, which is how
 * more than one file gets picked. A file's name goes into the File gadget. A
 * DRAWER is entered on the button coming back up, single click, no
 * double-click needed, which is `AddPart (fdir, str) / NewDir (glob)`.
 */
function rtClickRow(rt: Runtime, st: RtFileState, index: number, shift: boolean, frame: number): void {
  const e = st.rows[st.first + index]
  if (!e) return
  const multi = (st.setup.flags & FREQF.MULTISELECT) !== 0
  const dbl = st.clickRow === st.first + index && frame - st.clickFrame <= DOUBLE_CLICK_FRAMES
  st.clickRow = st.first + index
  st.clickFrame = frame

  if (e.type === RT_ENTRY.DIRECTORY) {
    st.dir = joinAmigaPath(st.dir, e.name)
    st.file = ''
    rtNewDir(rt, st)
    return
  }
  if (e.type === RT_ENTRY.VOLUME || e.type === RT_ENTRY.ASSIGN) {
    st.dir = e.name
    st.file = ''
    rtNewDir(rt, st)
    return
  }
  if (dbl) {
    e.selected = true
    st.file = e.name
    rtLeaveFile(st)
    return
  }
  if (!(multi && shift)) {
    rtDeselectAll(st)
    st.file = e.name
  }
  e.selected = !e.selected
  if (multi && shift && e.selected) st.file = e.name
}

/** `_Match..`: `rtGetStringA` on the requester's own window, titled `Match...` */
function rtStartMatch(rt: Runtime, st: RtFileState): void {
  const m = metricsFor(rt, st.slot)
  if (!m) return
  const setup: ReqSetup = {
    mode: REQ_MODE.ENTER_STRING,
    body: '',
    gadgets: '',
    title: RT_TEXT.matchWinTitle,
    flags: 0,
    width: 0,
    underscore: '',
    defaultResponse: 1,
    min: RT_MININT,
    max: RT_MAXINT,
    minmax: false,
  }
  const args: RtReqArgs = {
    setup,
    buffer: '',
    maxLen: 123,
    value: 0,
    showDefault: true,
    allowEmpty: false,
    invisible: false,
  }
  st.sub = startRtReq(rt, args, st.slot)
}

/** one frame of the file requester */
export function stepRtFile(rt: Runtime, st: RtFileState, frame: number): void {
  if (st.done) return
  if (st.sub) {
    stepRtReq(rt, st.sub)
    if (!st.sub.done) return
    finishRtReq(rt, st.sub)
    if (st.sub.result !== 0 && st.sub.text !== '') rtSelectAll(st, st.sub.text)
    st.sub = null
  }

  for (;;) {
    const msg = st.window.getMsg()
    if (!msg) break
    if (msg.class === IDCMP_CLOSEWINDOW) {
      // `case IDCMP_CLOSEWINDOW: FreeAllCheckBuffer (glob); return (FALSE);`
      st.ok = false
      st.result = ''
      st.done = true
      return
    }
    if (msg.class !== IDCMP_MOUSEBUTTONS || msg.code !== SELECTDOWN) continue
    const hit = fileReqHit(st.layout, msg.mouseX, msg.mouseY)
    if (!hit) continue
    const shift = rt.input.keys.has(0x60) || rt.input.keys.has(0x61)
    if (hit.kind === 'row') {
      rtClickRow(rt, st, hit.index, shift, frame)
      if (st.done) return
      continue
    }
    if (hit.kind === 'scroll') {
      const max = Math.max(0, st.rows.length - st.layout.entries)
      st.first = Math.min(max, Math.max(0, st.first + hit.delta))
      continue
    }
    if (hit.kind === 'get') {
      rtNewDir(rt, st)
      continue
    }
    if (hit.kind === 'info') {
      st.showInfo = !st.showInfo
      rtNewDir(rt, st)
      continue
    }
    if (hit.kind === 'top') {
      if (hit.index === 1) rtSelectAll(st, '#?')
      if (hit.index === 2) rtStartMatch(rt, st)
      if (hit.index === 3) {
        rtDeselectAll(st)
        st.file = ''
      }
      if (st.sub) return
      continue
    }
    if (hit.kind === 'button') {
      if (hit.index === 0) {
        rtLeaveFile(st)
        return
      }
      if (hit.index === 1) {
        st.volumes = true
        st.rows = rtVolumeEntries(rt)
        st.first = 0
        st.list = []
        st.clickRow = -1
        continue
      }
      if (hit.index === 2) {
        const up = st.volumes ? null : parentAmigaPath(st.dir)
        if (up !== null && up !== st.dir) {
          st.dir = up
          st.file = ''
          rtNewDir(rt, st)
        }
        continue
      }
      st.ok = false
      st.result = ''
      st.done = true
      return
    }
  }

  const scr = rt.screens.get(st.slot)
  if (!scr) {
    st.done = true
    return
  }
  const w = st.window
  st.rp.clip = { x1: w.leftEdge, y1: w.topEdge, x2: w.leftEdge + w.width - 1, y2: w.topEdge + w.height - 1 }
  fileReqRender(
    st.rp,
    screenPens(scr.depth),
    st.layout,
    st.rows,
    st.first,
    {
      dir: st.dir,
      file: st.file,
      pattern: st.pattern,
      selected: st.rows.filter((e) => e.selected).length,
      info: st.showInfo,
      led: false,
    },
    w.leftEdge,
    w.topEdge,
  )
}

/** close the window and let the keyword have its answer */
export function finishRtFile(rt: Runtime, st: RtFileState): void {
  if (st.sub) {
    finishRtReq(rt, st.sub)
    st.sub = null
  }
  rt.intuition.closeWindow(st.window)
}

/* --------------------------------------------------------------------------
 * The font requester
 * ----------------------------------------------------------------------- */

export interface RtFontState {
  setup: FontReqSetup
  window: Window
  slot: number
  rp: RastPort
  layout: FontReqLayout
  /** every face `AvailFonts` finds, sorted the way `FindEntry` files them */
  rows: FontRow[]
  /** `buff->pos`, the first row on screen */
  first: number
  /** the name gadget, which carries `.font` where a list row does not */
  name: string
  /** `rtfo_Attr.ta_YSize`, and the integer gadget shows the same number */
  size: number
  /** the highlighted row, -1 for none */
  selected: number
  done: boolean
  ok: boolean
  /** `rtfo_Attr.ta_Name` and `ta_YSize` as OK left them */
  result: string
  resultSize: number
  clickFrame: number
  clickRow: number
}

/**
 * The list `AvailFonts` fills, filtered and sorted.
 *
 * `filereqmain.c`:418 cuts the last five characters off every name before
 * `AddEntry`, so the rows read `topaz` and not `topaz.font`; the `.font` goes
 * back on only when a click copies the name into the string gadget.
 * `FindEntry` orders on the name case-insensitively and then on the SIZE
 * ascending, which is why one face's sizes come out in a run.
 *
 * The size filter is `re_Size < minsize || re_Size > maxsize`, and an
 * `AFF_MEMORY` entry without FPF_ROMFONT is skipped outright --- a face some
 * other program happens to have open is not a face this requester offers.
 */
function rtFontRows(rt: Runtime, setup: FontReqSetup): FontRow[] {
  const rows: FontRow[] = []
  for (const f of availFonts(rt)) {
    if (f.height < setup.minSize || f.height > setup.maxSize) continue
    rows.push({ name: f.name.replace(/\.font$/i, ''), size: f.height })
  }
  rows.sort((a, b) => {
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    return an < bn ? -1 : an > bn ? 1 : a.size - b.size
  })
  return rows
}

/**
 * Open the font requester. Null when there is no screen for it.
 *
 * `FindCurrentPos` puts the list on the face the requester already holds, so
 * a second call comes up where the first one left off. The FIRST call comes
 * up on nothing at all: the extension's `rtAllocRequestA` at `$96d8` clears
 * the struct, which leaves the name empty and `ta_YSize` at zero, and the
 * sample box therefore opens saying `Couldn't open font!`.
 */
export function startRtFont(
  rt: Runtime,
  setup: FontReqSetup,
  name: string,
  size: number,
  slot: number | null,
): RtFontState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const m = metricsFor(rt, on)
  const scr = rt.screens.get(on)
  if (!m || !scr) return null
  const layout = fontReqLayout(setup, m)
  const window = rt.intuition.openWindow({
    leftEdge: Math.min(RT_FONTREQ_PREFS.leftOffset, Math.max(0, scr.width - layout.width)),
    topEdge: Math.min(RT_FONTREQ_PREFS.topOffset, Math.max(0, scr.height - layout.height)),
    width: layout.width,
    height: layout.height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW,
    // as the file requester, and with the same DEVIATION: no size gadget,
    // because nothing here rebuilds the gadget list on IDCMP_NEWSIZE
    flags: 0x8 | 0x2 | 0x4 | 0x1000,
    title: layout.title,
    type: on === WB_SLOT ? 1 : 15,
    ...(on === WB_SLOT ? {} : { screenSlot: on }),
  })
  if (!window) return null
  const rp = new RastPort(scr.rp.bitMap)
  rp.font = rt.systemFont()
  const rows = rtFontRows(rt, setup)
  const leaf = name.replace(/\.font$/i, '').toLowerCase()
  return {
    setup,
    window,
    slot: on,
    rp,
    layout,
    rows,
    first: 0,
    name,
    size,
    selected: rows.findIndex((r) => r.name.toLowerCase() === leaf && r.size === size),
    done: false,
    ok: false,
    result: '',
    resultSize: 0,
    clickFrame: -99,
    clickRow: -1,
  }
}

/**
 * `LeaveReq`, the font arm: `selfile = (APTR)(filename[0] != 0)`.
 *
 * So an empty name gadget answers FALSE even though the user pressed Ok, the
 * same rule the single-file requester applies to its own File gadget.
 */
function rtLeaveFont(st: RtFontState): void {
  st.result = st.name
  st.resultSize = st.size
  st.ok = st.name !== ''
  st.done = true
}

/** one frame of the font requester */
export function stepRtFont(rt: Runtime, st: RtFontState, frame: number): void {
  if (st.done) return

  for (;;) {
    const msg = st.window.getMsg()
    if (!msg) break
    if (msg.class === IDCMP_CLOSEWINDOW) {
      st.ok = false
      st.done = true
      return
    }
    if (msg.class !== IDCMP_MOUSEBUTTONS || msg.code !== SELECTDOWN) continue
    const hit = fontReqHit(st.layout, msg.mouseX, msg.mouseY)
    if (!hit) continue
    if (hit.kind === 'row') {
      const index = st.first + hit.index
      const row = st.rows[index]
      if (!row) continue
      // `case FONT:` --- the name gadget takes `str` with DOTFONTSTR back on
      // the end, and ta_YSize, ta_Flags and ta_Style all come off the entry
      const double = st.clickRow === index && frame - st.clickFrame <= DOUBLE_CLICK_FRAMES
      st.name = `${row.name}.font`
      st.size = row.size
      st.selected = index
      if (double) {
        rtLeaveFont(st)
        return
      }
      st.clickRow = index
      st.clickFrame = frame
      continue
    }
    if (hit.kind === 'scroll') {
      const max = Math.max(0, st.rows.length - st.layout.entries)
      st.first = Math.min(max, Math.max(0, st.first + hit.delta))
      continue
    }
    if (hit.kind === 'button') {
      if (hit.index === 0) {
        rtLeaveFont(st)
        return
      }
      st.ok = false
      st.done = true
      return
    }
  }

  const scr = rt.screens.get(st.slot)
  if (!scr) {
    st.done = true
    return
  }
  const w = st.window
  st.rp.clip = { x1: w.leftEdge, y1: w.topEdge, x2: w.leftEdge + w.width - 1, y2: w.topEdge + w.height - 1 }
  // `ShowFontSample`: OpenDiskFont, and its failure is what puts the message
  // there instead of the line. The face has to be one AvailFonts listed, so
  // an empty name gadget or a size nothing has fails here
  const exists = st.name !== '' && availFonts(rt).some((f) => f.name === st.name && f.height === st.size)
  fontReqRender(
    st.rp,
    screenPens(scr.depth),
    st.layout,
    st.rows,
    st.first,
    {
      name: st.name,
      size: st.size,
      selected: st.selected,
      sampleText: exists ? RT_TEXT.fontSample : RT_TEXT.couldntOpenFont,
      sampleFont: exists ? openDiskFont(rt, st.name, st.size) : null,
    },
    w.leftEdge,
    w.topEdge,
  )
}

/** close the window and let the keyword have its answer */
export function finishRtFont(rt: Runtime, st: RtFontState): void {
  rt.intuition.closeWindow(st.window)
}

/* --------------------------------------------------------------------------
 * The screenmode requester
 * ----------------------------------------------------------------------- */

/**
 * The deepest screen this port opens, which is what stands in for
 * `diminfo.MaxDepth`.
 *
 * DEVIATION: `DisplayModeAttrs` reads a per-mode maximum out of the
 * DimensionInfo the monitor driver computes at run time, and
 * ../amiga/displayinfo.ts says plainly that it cannot read one: `pal 39.3`
 * builds its rectangles in code rather than storing them. Eight is this
 * machine's AA ceiling, the same number ./aslreq.ts uses for the same reason,
 * so every mode in the list offers 2 to 256 colours.
 */
const RT_MAX_DEPTH = 8

export interface RtScreenState {
  setup: ScreenReqSetup
  window: Window
  slot: number
  rp: RastPort
  layout: ScreenReqLayout
  /** every mode the database walk kept, sorted the way `FindEntry` files it */
  rows: ScreenRow[]
  /** `buff->pos`, the first row on screen */
  first: number
  selected: number
  /** `glob->modeid`, and -1 is INVALID_ID */
  modeId: number
  /** `glob->width` and `glob->height`, which are NOT the mode's own size */
  width: number
  height: number
  /** `glob->defwidth` and `glob->defheight`, from the Nominal rectangle */
  defWidth: number
  defHeight: number
  useDefWidth: boolean
  useDefHeight: boolean
  depth: number
  minDepth: number
  maxDepth: number
  done: boolean
  ok: boolean
  clickFrame: number
  clickRow: number
}

/** `rtScreenModeRequestA`'s answer, cached in the extension's `ScreenData` */
export interface RtScreenResult {
  displayId: number
  width: number
  height: number
  depth: number
}

/**
 * The mode list, `filereqmain.c`:436.
 *
 * `NextDisplayInfo` walks the whole database and four tests thin it: a
 * DUALPF id, an id on the default monitor, one `GetModeData` cannot answer
 * for, and one whose DisplayInfo says NotAvailable. What survives goes
 * through `AddEntry` with the id as its `re_Size`, and `FindEntry` files it
 * on the NAME, case-insensitively --- so the driver's own walk order, lores
 * then hires then super then the three laced ones, comes out alphabetical.
 *
 * The name is the driver's. `GetModeData` builds one itself only when
 * DTAG_NAME FAILS, and every row in ../amiga/displayinfo.ts is read out of
 * `Devs/Monitors/PAL`'s own table, so the `%s%ld x %ld` path at `$2eb2` and
 * its `-HAM`, `-EHB` and `-Interlaced` suffixes are never taken here.
 */
function rtScreenRows(): ScreenRow[] {
  const rows: ScreenRow[] = DISPLAY_MODES.filter((m: DisplayMode) => (m.id & 0xffff_0000) !== 0).map((m: DisplayMode) => ({
    name: m.name,
    id: m.id,
  }))
  rows.sort((a, b) => {
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    return an < bn ? -1 : an > bn ? 1 : 0
  })
  return rows
}

/** `GetModeDimensions`: the Nominal rectangle, which is overscan type 0 */
function rtModeSize(id: number): { width: number; height: number } {
  const m = DISPLAY_MODES.find((d) => d.id === id)
  return m ? { width: m.width, height: m.height } : { width: 0, height: 0 }
}

/**
 * `DisplayModeAttrs` plus `SetSizeGads`, run whenever the mode changes.
 *
 * The depth clamp is the source's, in its order: HAM lifts the minimum to 7
 * and pushes a 6 up to 7, EHB pins the minimum to the maximum, then the
 * RTSC_MinDepth and RTSC_MaxDepth tags clamp both ends and the level after
 * them. `SetSizeGads` then replaces the width and the height only where the
 * matching Default box is ticked.
 */
function rtScreenAttrs(st: RtScreenState): void {
  if (st.modeId === -1) return
  let maxDepth = RT_MAX_DEPTH
  let minDepth = 1
  if ((st.modeId & 0x0080) !== 0) minDepth = maxDepth
  if ((st.modeId & 0x0800) !== 0) {
    minDepth = 7
    if (maxDepth === 6) maxDepth = 7
  }
  st.maxDepth = maxDepth
  st.minDepth = minDepth
  if (st.depth > st.maxDepth) st.depth = st.maxDepth
  if (st.depth < st.minDepth) st.depth = st.minDepth
  if (st.useDefWidth) st.width = st.defWidth
  if (st.useDefHeight) st.height = st.defHeight
}

/**
 * Open the screenmode requester. Null when there is no screen for it.
 *
 * The first call opens on nothing, and on a zero. `rtAllocRequestA
 * (RT_SCREENMODEREQ)` at `$96e8` clears the struct, so `rtsc_DisplayID` is 0
 * rather than INVALID_ID and `filereq.c`:275 takes the ELSE arm: the mode,
 * the depth, the width and the height all come off the cleared struct.
 * DisplayID 0 is on the default monitor and the list walk drops it, so
 * `FindCurrentPos` misses and the FIRST entry is selected instead --- but
 * `usedefwidth = (glob->width == glob->defwidth)` was already decided against
 * a `defwidth` of zero, so it is FALSE, and `SetSizeGads` leaves the Width
 * and Height fields reading 0 under an unticked Default. Ticking either box
 * is what fills them in.
 */
export function startRtScreen(rt: Runtime, setup: ScreenReqSetup, prev: RtScreenResult, slot: number | null): RtScreenState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const m = metricsFor(rt, on)
  const scr = rt.screens.get(on)
  if (!m || !scr) return null
  const layout = screenReqLayout(setup, m)
  const window = rt.intuition.openWindow({
    leftEdge: Math.min(RT_SCREENMODEREQ_PREFS.leftOffset, Math.max(0, scr.width - layout.width)),
    topEdge: Math.min(RT_SCREENMODEREQ_PREFS.topOffset, Math.max(0, scr.height - layout.height)),
    width: layout.width,
    height: layout.height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW,
    flags: 0x8 | 0x2 | 0x4 | 0x1000,
    title: layout.title,
    type: on === WB_SLOT ? 1 : 15,
    ...(on === WB_SLOT ? {} : { screenSlot: on }),
  })
  if (!window) return null
  const rp = new RastPort(scr.rp.bitMap)
  rp.font = rt.systemFont()
  const rows = rtScreenRows()
  const known = rows.findIndex((r) => r.id === prev.displayId)
  const size = rtModeSize(prev.displayId)
  const st: RtScreenState = {
    setup,
    window,
    slot: on,
    rp,
    layout,
    rows,
    first: 0,
    selected: known,
    modeId: known === -1 ? -1 : prev.displayId,
    width: prev.width,
    height: prev.height,
    defWidth: size.width,
    defHeight: size.height,
    useDefWidth: known !== -1 && prev.width === size.width,
    useDefHeight: known !== -1 && prev.height === size.height,
    depth: prev.depth,
    minDepth: 1,
    maxDepth: RT_MAX_DEPTH,
    done: false,
    ok: false,
    clickFrame: -99,
    clickRow: -1,
  }
  // `if (!FindCurrentPos (...)) { modeid = firstentry->re_Next->re_Size; ... }`
  if (st.modeId === -1 && rows[0]) {
    st.selected = 0
    st.modeId = rows[0].id
    const first = rtModeSize(st.modeId)
    st.defWidth = first.width
    st.defHeight = first.height
  }
  rtScreenAttrs(st)
  return st
}

/**
 * `LeaveReq`, the screenmode arm.
 *
 * `if (glob->modeid == INVALID_ID) selfile = FALSE` --- Ok with no mode
 * chosen answers a cancel. The HAM fix-up on the way out is the source's:
 * `glob->depth = (glob->depth == 7 ? 6 : 8)`, which turns the slider's
 * 7-and-8 back into the 6-and-8 a HAM screen is actually opened with, and is
 * exactly the pair the extension's `cmp.w #$6,d1` at `$5bc2` tests.
 */
function rtLeaveScreen(st: RtScreenState): void {
  st.ok = st.modeId !== -1
  if (st.ok && (st.modeId & 0x0800) !== 0) st.depth = st.depth === 7 ? 6 : 8
  st.done = true
}

/** what the keyword reads once `done` goes up */
export function rtScreenResult(st: RtScreenState): RtScreenResult {
  return { displayId: st.modeId, width: st.width, height: st.height, depth: st.depth }
}

/** one frame of the screenmode requester */
export function stepRtScreen(rt: Runtime, st: RtScreenState, frame: number): void {
  if (st.done) return

  for (;;) {
    const msg = st.window.getMsg()
    if (!msg) break
    if (msg.class === IDCMP_CLOSEWINDOW) {
      st.ok = false
      st.done = true
      return
    }
    if (msg.class !== IDCMP_MOUSEBUTTONS || msg.code !== SELECTDOWN) continue
    const hit = screenReqHit(st.layout, msg.mouseX, msg.mouseY, st.minDepth, st.maxDepth)
    if (!hit) continue
    if (hit.kind === 'row') {
      const index = st.first + hit.index
      const row = st.rows[index]
      if (!row) continue
      // `case SCRMODE:` --- the name box takes the row's name, `modeid` takes
      // its `re_Size`, and GetModeDimensions and DisplayModeAttrs follow
      const double = st.clickRow === index && frame - st.clickFrame <= DOUBLE_CLICK_FRAMES
      st.selected = index
      st.modeId = row.id
      const size = rtModeSize(row.id)
      st.defWidth = size.width
      st.defHeight = size.height
      rtScreenAttrs(st)
      if (double) {
        rtLeaveScreen(st)
        return
      }
      st.clickRow = index
      st.clickFrame = frame
      continue
    }
    if (hit.kind === 'scroll') {
      const max = Math.max(0, st.rows.length - st.layout.entries)
      st.first = Math.min(max, Math.max(0, st.first + hit.delta))
      continue
    }
    if (hit.kind === 'button') {
      if (hit.index === 0) {
        rtLeaveScreen(st)
        return
      }
      st.ok = false
      st.done = true
      return
    }
    // `case DEFWIDTH: glob->usedefwidth = !glob->usedefwidth; SetSizeGads()`
    if (hit.kind === 'defWidth') {
      st.useDefWidth = !st.useDefWidth
      rtScreenAttrs(st)
      continue
    }
    if (hit.kind === 'defHeight') {
      st.useDefHeight = !st.useDefHeight
      rtScreenAttrs(st)
      continue
    }
    // `case DEPTH: UpdateDepthDisplay (glob, code, glob->modeid); glob->depth
    // = code`, so the readout follows the knob and the level follows with it
    if (hit.kind === 'depth') {
      st.depth = hit.at
      continue
    }
  }

  const scr = rt.screens.get(st.slot)
  if (!scr) {
    st.done = true
    return
  }
  const w = st.window
  st.rp.clip = { x1: w.leftEdge, y1: w.topEdge, x2: w.leftEdge + w.width - 1, y2: w.topEdge + w.height - 1 }
  screenReqRender(
    st.rp,
    screenPens(scr.depth),
    st.layout,
    st.rows,
    st.first,
    {
      selected: st.selected,
      modeName: st.rows[st.selected]?.name ?? '',
      displayWidth: st.width,
      displayHeight: st.height,
      useDefWidth: st.useDefWidth,
      useDefHeight: st.useDefHeight,
      depth: st.depth,
      minDepth: st.minDepth,
      maxDepth: st.maxDepth,
      modeId: st.modeId === -1 ? 0 : st.modeId,
      overscan: 0,
      autoScroll: false,
    },
    w.leftEdge,
    w.topEdge,
  )
}

/** close the window and let the keyword have its answer */
export function finishRtScreen(rt: Runtime, st: RtScreenState): void {
  rt.intuition.closeWindow(st.window)
}

/* --------------------------------------------------------------------------
 * The palette requester
 * ----------------------------------------------------------------------- */

/**
 * How many bits a gun has, which decides the sliders' range.
 *
 * `PaletteRequestA` sets four and then asks `GetDisplayInfoData (DTAG_DISP)`
 * for RedBits, GreenBits and BlueBits, keeping the four when the query
 * answers nothing. ../amiga/displayinfo.ts has no DisplayInfo record to
 * answer with --- `pal 39.3` computes its geometry in code rather than
 * storing it --- so the four stands, and it is also exactly what this port's
 * colour registers hold: `../runtime/screen.ts`'s palette is a Uint16Array of
 * 12-bit RGB4. DEVIATION: a real AA machine answers eight here and its
 * sliders run 0 to 255.
 */
const RT_GUN_BITS = 4

export interface RtPaletteState {
  setup: PaletteReqSetup
  window: Window
  slot: number
  rp: RastPort
  layout: PaletteReqLayout
  /** `glob->color`, the pen the sliders are editing */
  color: number
  /** `glob->cols`, the three gun values of that pen */
  levels: number[]
  /** `(1 << bits) - 1` a gun, which is `glob->maxcolval` */
  maxLevels: number[]
  /** `glob->mode`: 0, or the Copy, Swap or Spread waiting for its second click */
  mode: number
  /** `glob->colormap`, restored by Cancel and by the close gadget */
  entry: Uint16Array
  /** `glob->undomap`, re-taken on every palette click and restored by Undo */
  undo: Uint16Array
  done: boolean
  /** the pen Ok answers, or -1 for a cancel */
  result: number
}

/** the three modes, `palettereq.c`:62 */
const PAL_COPY = 0
const PAL_SWAP = 1
const PAL_SPREAD = 2

/** `SelectColor`: read a pen's guns back out of the colour map into the sliders */
function palSelect(rt: Runtime, st: RtPaletteState, pen: number): void {
  const scr = rt.screens.get(st.slot)
  const rgb = scr?.palette[pen] ?? 0
  st.levels = [(rgb >> 8) & 0xf, (rgb >> 4) & 0xf, rgb & 0xf]
  st.color = pen
}

/**
 * `SetColor`: write one pen from three gun values.
 *
 * The os30 arm is `SetRGB32 (vp, col, MakeColVal (rgb[0], redbits), ...)`.
 * With four bits `rtMakeColVal` repeats the nibble eight times, and a 12-bit
 * register keeps the top nibble of each --- which is the nibble that went in.
 * So the pre-3.0 `SetRGB4` arm and the 3.0 one write the same thing here, and
 * this does the shorter of the two.
 */
function palSet(rt: Runtime, st: RtPaletteState, pen: number, rgb: readonly number[]): void {
  const scr = rt.screens.get(st.slot)
  if (!scr || pen < 0 || pen >= scr.palette.length) return
  const gun = (v: number, i: number): number => rtMakeColVal(v, st.setup.bits[i] ?? RT_GUN_BITS) >>> 28
  scr.palette[pen] = (gun(rgb[0] ?? 0, 0) << 8) | (gun(rgb[1] ?? 0, 1) << 4) | gun(rgb[2] ?? 0, 2)
}

/**
 * `SpreadColors`, `palettereq.c`:218.
 *
 * A 16.16 walk from the selected pen's guns to the clicked pen's, one step a
 * pen, rounded with `+ 0x8000` on the way out. The loop stops BEFORE `to`, so
 * the pen that was clicked keeps the colour it already had and only the run
 * between the two is rewritten.
 */
function palSpread(rt: Runtime, st: RtPaletteState, from: number, to: number, target: readonly number[]): void {
  let steps = to - from
  if (steps === 0) return
  let colstep = 1
  if (steps < 0) {
    steps = -steps
    colstep = -1
  }
  const step: number[] = []
  const rgb: number[] = []
  for (let g = 0; g < 3; g++) {
    const diff = (target[g] ?? 0) - (st.levels[g] ?? 0)
    step.push(Math.trunc((diff * 0x1_0000) / steps))
    rgb.push((st.levels[g] ?? 0) * 0x1_0000)
  }
  for (let pen = from; pen !== to; pen += colstep) {
    palSet(rt, st, pen, [(rgb[0]! + 0x8000) >> 16, (rgb[1]! + 0x8000) >> 16, (rgb[2]! + 0x8000) >> 16])
    for (let g = 0; g < 3; g++) rgb[g] = rgb[g]! + step[g]!
  }
}

/**
 * Open the palette requester. Null when there is no screen for it.
 *
 * It lands on the screen `GetReqScreen` picks, and with no RT_Window and no
 * RT_Screen in the tag list that is the default public screen --- the
 * WORKBENCH. So `Delta Reqtools Palette` edits the Workbench's four colours
 * and not the AMOS screen the program is drawing on, which is faithful and
 * surprising in equal measure.
 */
export function startRtPalette(rt: Runtime, setup: PaletteReqSetup, slot: number | null): RtPaletteState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const m = metricsFor(rt, on)
  const scr = rt.screens.get(on)
  if (!m || !scr) return null
  const full: PaletteReqSetup = { ...setup, depth: scr.depth }
  const layout = paletteReqLayout(full, m)
  const at = reqPosition(REQPOS.CENTERSCR, RT_FILEREQ_PREFS, scr.width, scr.height, layout.width, layout.height)
  const window = rt.intuition.openWindow({
    leftEdge: at.left,
    topEdge: at.top,
    width: layout.width,
    height: layout.height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW,
    // WFLG_DEPTHGADGET|WFLG_DRAGBAR|WFLG_ACTIVATE|WFLG_CLOSEGADGET, and the
    // close gadget is real here: `case IDCMP_CLOSEWINDOW:` is
    // RestorePaletteFreeAll, the same answer Cancel gives
    flags: 0x8 | 0x2 | 0x4 | 0x1000,
    title: layout.title,
    type: on === WB_SLOT ? 1 : 15,
    ...(on === WB_SLOT ? {} : { screenSlot: on }),
  })
  if (!window) return null
  const rp = new RastPort(scr.rp.bitMap)
  rp.font = rt.systemFont()
  const st: RtPaletteState = {
    setup: full,
    window,
    slot: on,
    rp,
    layout,
    color: setup.color,
    levels: [0, 0, 0],
    maxLevels: [0, 1, 2].map((i) => (1 << (setup.bits[i] ?? RT_GUN_BITS)) - 1),
    mode: -1,
    // GetVpCM twice: one copy to put back on a cancel and one to undo to
    entry: Uint16Array.from(scr.palette),
    undo: Uint16Array.from(scr.palette),
    done: false,
    result: -1,
  }
  palSelect(rt, st, setup.color)
  return st
}

/** one frame of the palette requester */
export function stepRtPalette(rt: Runtime, st: RtPaletteState): void {
  if (st.done) return
  const scr = rt.screens.get(st.slot)
  if (!scr) {
    st.done = true
    return
  }

  for (;;) {
    const msg = st.window.getMsg()
    if (!msg) break
    if (msg.class === IDCMP_CLOSEWINDOW) {
      scr.palette.set(st.entry)
      st.result = -1
      st.done = true
      return
    }
    if (msg.class !== IDCMP_MOUSEBUTTONS || msg.code !== SELECTDOWN) continue
    const hit = paletteReqHit(st.layout, msg.mouseX, msg.mouseY, st.maxLevels)
    if (!hit) continue
    if (hit.kind === 'slider') {
      // `IDCMP_GADGETDOWN` on a gun: the level goes straight into the pen
      st.levels[hit.gun] = hit.at
      palSet(rt, st, st.color, st.levels)
      continue
    }
    if (hit.kind === 'mode') {
      st.mode = hit.index
      continue
    }
    if (hit.kind === 'cell') {
      const pen = hit.index
      // `RefreshVpCM (vp, undomap)` comes FIRST, so Undo goes back to the
      // palette as it stood before this click and not to the one the
      // requester opened on
      st.undo.set(scr.palette)
      const rgb = scr.palette[pen] ?? 0
      const target = [(rgb >> 8) & 0xf, (rgb >> 4) & 0xf, rgb & 0xf]
      if (st.mode === PAL_SWAP) palSet(rt, st, st.color, target)
      if (st.mode === PAL_SWAP || st.mode === PAL_COPY) palSet(rt, st, pen, st.levels)
      if (st.mode === PAL_SPREAD) palSpread(rt, st, st.color, pen, target)
      palSelect(rt, st, pen)
      st.mode = -1
      continue
    }
    // Ok, Undo, Cancel
    if (hit.index === 0) {
      st.result = st.color
      st.done = true
      return
    }
    if (hit.index === 1) {
      scr.palette.set(st.undo)
      palSelect(rt, st, st.color)
      continue
    }
    scr.palette.set(st.entry)
    st.result = -1
    st.done = true
    return
  }

  const w = st.window
  st.rp.clip = { x1: w.leftEdge, y1: w.topEdge, x2: w.leftEdge + w.width - 1, y2: w.topEdge + w.height - 1 }
  paletteReqRender(
    st.rp,
    screenPens(scr.depth),
    st.layout,
    { color: st.color, levels: st.levels, maxLevels: st.maxLevels },
    w.leftEdge,
    w.topEdge,
  )
}

/** close the window and let the keyword have its answer */
export function finishRtPalette(rt: Runtime, st: RtPaletteState): void {
  rt.intuition.closeWindow(st.window)
}
