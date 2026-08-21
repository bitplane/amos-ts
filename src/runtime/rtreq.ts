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
  REQ_MODE,
  RT_TEXT,
  reqHit,
  reqLayout,
  reqRender,
  type ReqLayout,
  type ReqMetrics,
  type ReqSetup,
} from '../amiga/reqtools'
import {
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
    // RETURN inside the string gadget is gadget 32, not a shortcut: the mode
    // forces NORETURNKEY, so no button is bold and `keyGadget` finds none
    if (editable && (k.ch === '\r' || k.ch === '\n')) {
      commit(st, 32)
      if (st.done) return
      continue
    }
    const gad = keyGadget(st, k.ch, lAmiga)
    if (gad >= 0) {
      pressGadget(st, gad)
      if (st.done) return
      continue
    }
    if (!editable) continue
    if (k.ch === '\b' || k.scan === 0x41) {
      st.buffer = st.buffer.slice(0, -1)
      continue
    }
    if (k.ch < ' ') continue
    if (st.buffer.length >= st.args.maxLen) continue
    if (st.args.setup.mode === REQ_MODE.ENTER_NUMBER && !digitOk(st.buffer, k.ch)) continue
    st.buffer += k.ch
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
