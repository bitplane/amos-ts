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
  type FileReqLayout,
  type FileReqSetup,
  type FontReqLayout,
  type FontReqSetup,
  type FontRow,
  type ReqEntry,
  type ReqLayout,
  type ReqMetrics,
  type ReqSetup,
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
      if (st.buffer.length >= st.args.maxLen) continue
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
export function startRtFile(rt: Runtime, setup: FileReqSetup, slot: number | null): RtFileState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const m = metricsFor(rt, on)
  const scr = rt.screens.get(on)
  if (!m || !scr) return null
  const layout = fileReqLayout(setup, m)
  const window = rt.intuition.openWindow({
    leftEdge: Math.min(RT_FILEREQ_PREFS.leftOffset, Math.max(0, scr.width - layout.width)),
    topEdge: Math.min(RT_FILEREQ_PREFS.topOffset, Math.max(0, scr.height - layout.height)),
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
