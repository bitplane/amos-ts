/**
 * reqtools.library, the requesters four AMOS extensions ask for and none of
 * them ships.
 *
 * ## What is sourced here
 *
 * The authority is `reqtools 38.1092 (21.9.93)`, the version string at `$3d`
 * of the copy the AMOS PD Library CD puts in `files/Library2.0`. Every string
 * below is read out of that binary and quoted as it is spelled there, with
 * the file offset and the catalog id that precedes it. reqtools stores each
 * message as a UWORD id followed by the NUL-terminated default, so `$2f18`
 * reads `00 02 5f 43 61 6e 63 65 6c 00`: id 2, `_Cancel`.
 *
 * The geometry is NOT modelled. `req.c` in the ReqTools sources computes the
 * whole EZRequest family in about eighty lines of integer arithmetic, and
 * that arithmetic is ported here statement for statement. The sources are the
 * AROS back port at `reqtools 38.1436 (20.2.97)`, which is four years and 344
 * revisions later than the binary, so where the two disagree the binary wins
 * and the disagreement is written down:
 *
 * - `MSG_OK`, `MSG_MIN_FMT`, `MSG_MAX_FMT` and `MSG_MIN_MAX_FMT` all carry a
 *   trailing space in 38.1092 and none in 38.1436.
 * - `MSG_WIDTH`, `MSG_HEIGHT` and `MSG_AUTOSCROLL` are padded to a column in
 *   38.1092 (`_Width   :`) and unpadded later (`_Width:`).
 * - ids `$134` to `$136`, the palette requester's `Copy to...`, `Swap
 *   with...` and `Spread to...`, are not in 38.1092 at all. Its palette
 *   requester runs those three off a plain title instead.
 *
 * Two of the AROS fixes cancel out on this port's screens. `req.c` adds
 * `scr->WBorTop` to a height the original wrote as a literal 15, and to
 * another the original wrote as 3; WBorTop is 2 here, so 2 + 13 and 2 + 1
 * give back the original numbers and both versions lay out identically.
 *
 * ## What calls it
 *
 * `intuition-1.3b`'s `request.s` is thirteen keywords over five of the seven
 * requesters. `butility-1.21` calls `rtEZRequestA` and `rtFileRequestA`,
 * `delta-1.6` calls `rtEZRequestA`, `rtGetLongA` and `rtPaletteRequestA`, and
 * `thegame-1.4` opens the library and never calls it.
 */
import { drawBevelBox, penOf, PEN, type DrawInfo } from './gadtools'
import type { RastPort } from './graphics'

/** the name every caller passes to OpenLibrary, at `$2c` */
export const REQTOOLS_NAME = 'reqtools.library'

/** the version string at `$3d`, and the two numbers in it */
export const REQTOOLS_VSTRING = 'reqtools 38.1092 (21.9.93)'
export const REQTOOLS_VERSION = 38
export const REQTOOLS_REVISION = 1092

/**
 * The library vector offsets, counted off `reqtools_lib.fd`: `##bias 30` and
 * six bytes a function. Read, never recalled.
 */
export const RT_LVO = {
  rtAllocRequestA: -30,
  rtFreeRequest: -36,
  rtFreeReqBuffer: -42,
  rtChangeReqAttrA: -48,
  rtFileRequestA: -54,
  rtFreeFileList: -60,
  rtEZRequestA: -66,
  rtGetStringA: -72,
  rtGetLongA: -78,
  rtInternalGetPasswordA: -84,
  rtInternalEnterPasswordA: -90,
  rtFontRequestA: -96,
  rtPaletteRequestA: -102,
  rtReqHandlerA: -108,
  rtSetWaitPointer: -114,
  rtGetVScreenSize: -120,
  rtSetReqPosition: -126,
  rtSpread: -132,
  rtScreenToFrontSafely: -138,
  rtScreenModeRequestA: -144,
  rtCloseWindowSafely: -150,
  rtLockWindow: -156,
  rtUnlockWindow: -162,
  rtLockPrefs: -168,
  rtUnlockPrefs: -174,
} as const

/** `rtAllocRequestA`'s type argument, `reqtools.i:134` */
export const RT_TYPE = { FILEREQ: 0, REQINFO: 1, FONTREQ: 2, SCREENMODEREQ: 3 } as const

/** `RT_TagBase equ TAG_USER`, so every tag below is `$8000_0000` plus its number */
export const RT_TAG_BASE = 0x8000_0000

/** every tag `reqtools.i` defines, at its own number */
export const RT_TAG = {
  Window: RT_TAG_BASE + 1,
  IDCMPFlags: RT_TAG_BASE + 2,
  ReqPos: RT_TAG_BASE + 3,
  LeftOffset: RT_TAG_BASE + 4,
  TopOffset: RT_TAG_BASE + 5,
  PubScrName: RT_TAG_BASE + 6,
  Screen: RT_TAG_BASE + 7,
  ReqHandler: RT_TAG_BASE + 8,
  DefaultFont: RT_TAG_BASE + 9,
  WaitPointer: RT_TAG_BASE + 10,
  Underscore: RT_TAG_BASE + 11,
  ShareIDCMP: RT_TAG_BASE + 12,
  LockWindow: RT_TAG_BASE + 13,
  ScreenToFront: RT_TAG_BASE + 14,
  TextAttr: RT_TAG_BASE + 15,
  IntuiMsgFunc: RT_TAG_BASE + 16,
  Locale: RT_TAG_BASE + 17,

  EZ_ReqTitle: RT_TAG_BASE + 20,
  EZ_Flags: RT_TAG_BASE + 22,
  EZ_DefaultResponse: RT_TAG_BASE + 23,

  GL_Min: RT_TAG_BASE + 30,
  GL_Max: RT_TAG_BASE + 31,
  GL_Width: RT_TAG_BASE + 32,
  GL_ShowDefault: RT_TAG_BASE + 33,
  GL_GadFmt: RT_TAG_BASE + 34,
  GL_GadFmtArgs: RT_TAG_BASE + 35,
  GL_Invisible: RT_TAG_BASE + 36,
  GL_BackFill: RT_TAG_BASE + 37,
  GL_TextFmt: RT_TAG_BASE + 38,
  GL_TextFmtArgs: RT_TAG_BASE + 39,
  GL_CenterText: RT_TAG_BASE + 100,
  GS_AllowEmpty: RT_TAG_BASE + 80,

  FI_Flags: RT_TAG_BASE + 40,
  FI_Height: RT_TAG_BASE + 41,
  FI_OkText: RT_TAG_BASE + 42,
  FI_VolumeRequest: RT_TAG_BASE + 43,
  FI_FilterFunc: RT_TAG_BASE + 44,
  FI_AllowEmpty: RT_TAG_BASE + 45,
  FI_Dir: RT_TAG_BASE + 50,
  FI_MatchPat: RT_TAG_BASE + 51,
  FI_AddEntry: RT_TAG_BASE + 52,
  FI_RemoveEntry: RT_TAG_BASE + 53,

  FO_SampleHeight: RT_TAG_BASE + 60,
  FO_MinHeight: RT_TAG_BASE + 61,
  FO_MaxHeight: RT_TAG_BASE + 62,
  FO_FontName: RT_TAG_BASE + 63,
  FO_FontHeight: RT_TAG_BASE + 64,
  FO_FontStyle: RT_TAG_BASE + 65,
  FO_FontFlags: RT_TAG_BASE + 66,

  SC_ModeFromScreen: RT_TAG_BASE + 80,
  SC_DisplayID: RT_TAG_BASE + 81,
  SC_DisplayWidth: RT_TAG_BASE + 82,
  SC_DisplayHeight: RT_TAG_BASE + 83,
  SC_DisplayDepth: RT_TAG_BASE + 84,
  SC_OverscanType: RT_TAG_BASE + 85,
  SC_AutoScroll: RT_TAG_BASE + 86,
  SC_PropertyFlags: RT_TAG_BASE + 90,
  SC_PropertyMask: RT_TAG_BASE + 91,
  SC_MinWidth: RT_TAG_BASE + 92,
  SC_MaxWidth: RT_TAG_BASE + 93,
  SC_MinHeight: RT_TAG_BASE + 94,
  SC_MaxHeight: RT_TAG_BASE + 95,
  SC_MinDepth: RT_TAG_BASE + 96,
  SC_MaxDepth: RT_TAG_BASE + 97,

  PA_Color: RT_TAG_BASE + 70,
  RH_EndRequest: RT_TAG_BASE + 60,
} as const

/** `RT_ReqPos`, `reqtools.i:505` */
export const REQPOS = {
  POINTER: 0,
  CENTERWIN: 1,
  CENTERSCR: 2,
  TOPLEFTWIN: 3,
  TOPLEFTSCR: 4,
  /** not a position: the value that means "use the user's preference" */
  DEFAULT: 5,
} as const

/** `RTRH_EndRequest`'s two codes */
export const REQ_CANCEL = 0
export const REQ_OK = 1

/** `RTFI_Flags` and `RTFO_Flags`, from the BITDEFs at `reqtools.i:519` */
export const FREQF = {
  MULTISELECT: 1 << 0,
  SAVE: 1 << 1,
  NOBUFFER: 1 << 2,
  NOFILES: 1 << 3,
  PATGAD: 1 << 4,
  FIXEDWIDTH: 1 << 5,
  COLORFONTS: 1 << 6,
  CHANGEPALETTE: 1 << 7,
  LEAVEPALETTE: 1 << 8,
  SCALE: 1 << 9,
  STYLE: 1 << 10,
  /** obsolete in V38, and the reason bit 11 is not reused */
  DOWILDFUNC: 1 << 11,
  SELECTDIRS: 1 << 12,
} as const

/** `RTSC_Flags`, V38 */
export const SCREQF = {
  SIZEGADS: 1 << 13,
  DEPTHGAD: 1 << 14,
  NONSTDMODES: 1 << 15,
  GUIMODES: 1 << 16,
  AUTOSCROLLGAD: 1 << 18,
  OVERSCANGAD: 1 << 19,
} as const

/**
 * `RTEZ_Flags`, and the two V38 names for bits in the same word.
 * `RTGS_Flags` and `RTGL_Flags` are `RTEZ_Flags`, which is why one field
 * carries all five.
 */
export const EZREQF = {
  NORETURNKEY: 1 << 0,
  LAMIGAQUAL: 1 << 1,
  CENTERTEXT: 1 << 2,
  /** GLREQF_HIGHLIGHTTEXT and GSREQF_HIGHLIGHTTEXT, the same bit */
  HIGHLIGHTTEXT: 1 << 3,
} as const

/** `RTFI_VolumeRequest`'s flags, V38 */
export const VREQF = { NOASSIGNS: 1 << 0, NODISKS: 1 << 1, ALLDISKS: 1 << 2 } as const

/**
 * Every word 38.1092 puts on a screen, at its file offset and catalog id.
 *
 * The leading and trailing spaces are the binary's. ` _Ok ` is padded on both
 * sides so a lone Ok button is wider than its four letters; `_Width   :` is
 * padded so the screenmode requester's three labels end in a column.
 */
export const RT_TEXT = {
  /** `$2d70`, id 1 */
  ok: ' _Ok ',
  /** `$2f1a`, id 2 */
  cancel: '_Cancel',
  /** `$1702`, id 3: the default when a caller passes no gadget format */
  okBarCancel: ' _Ok |_Cancel',
  /** `$1712`, id `$64` */
  lastBarCancel: '_Last|_Cancel',
  /** `$1722`, id `$65`: the window title when a requester has two or more gadgets */
  request: 'Request',
  /** `$172c`, id `$66`: the window title when it has one or none */
  information: 'Information',
  /** `$1760`, id `$c8` */
  minFmt: ' Min: %ld ',
  /** `$173a`, id `$c9` */
  maxFmt: ' Max: %ld ',
  /** `$1748`, id `$ca` */
  minMaxFmt: ' Min: %ld, Max: %ld ',
  /** `$177c`, id `$cb`: flashed in the title bar, not put in the body */
  tooSmall: 'Too small!',
  /** `$178a`, id `$cc` */
  tooBig: 'Too big!',

  /** `$8a8e`, id `$12c` */
  paletteColors: '_Palette Colors:',
  /** `$8a3e`, id `$12d` */
  red: '_Red:',
  /** `$8a46`, id `$12e` */
  green: '_Green:',
  /** `$8a50`, id `$12f` */
  blue: '_Blue:',
  /** `$8a5a`, id `$130` */
  copy: 'Cop_y',
  /** `$8a62`, id `$131` */
  swap: '_Swap',
  /** `$8a6a`, id `$132` */
  spread: 'Spr_ead',
  /** `$8a7c`, id `$133` */
  undo: '_Undo',

  /** `$2d78`, id `$190`, and the only two-line default in the library */
  createDrawer: "Drawer '%s' does\nnot exist. Create it?",
  /** `$2db2`, id `$191` */
  dirError: 'Directory error!',
  /** `$2dd0`, id `$192`: the title the Match window carries, not a gadget */
  matchWinTitle: 'Match...',
  /** `$2de0`, id `$193` */
  drawer: 'Drawer',
  /** `$2df0`, id `$194` */
  assign: 'Assign',
  /** `$2f30`, id `$195` */
  all: '_All',
  /** `$2f38`, id `$196` */
  match: '_Match..',
  /** `$2f44`, id `$197` */
  clear: 'C_lear',
  /** `$2f4e`, id `$198` */
  volumes: '_Volumes',
  /** `$2f5a`, id `$199` */
  parent: '_Parent',
  /** `$2faa`, id `$19a` */
  pattern: 'Pa_ttern:',
  /** `$2fc0`, id `$19b` */
  get: '_Get',
  /** `$2fb6`, id `$19c` */
  dotInfo: '._info',
  /** `$2f24`, id `$19d` */
  selected: 'Selected:',
  /** `$2dfa`, id `$19e` */
  full: '%ld%% full',

  /** `$2e52`, id `$1f4` */
  couldntOpenFont: "Couldn't open font!",
  /** `$2f64`, id `$1f5` */
  bold: '_Bold',
  /** `$2f6c`, id `$1f6` */
  italic: '_Italic',
  /** `$2f76`, id `$1f7` */
  underline: '_Underline',

  /** `$2ed0`, id `$258` */
  dashInterlaced: '-Interlaced',
  /** `$2ec0`, id `$259` */
  dashHam: '-HAM',
  /** `$2ec8`, id `$25a` */
  dashEhb: '-EHB',
  /** `$2ede`, id `$25b` */
  regularSize: 'Regular Size',
  /** `$2eee`, id `$25c` */
  textSize: 'Text Size',
  /** `$2efa`, id `$25d` */
  gfxSize: 'Graphics Size',
  /** `$2f0a`, id `$25e` */
  maxSize: 'Maximum Size',
  /** `$2f84`, id `$25f` */
  overscan: 'O_verscan:',
  /** `$2f92`, id `$260` */
  width: '_Width   :',
  /** `$2fc8`, id `$261` */
  height: '_Height  :',
  /** `$2fa0`, id `$262` */
  default: 'Default',
  /** `$2fd6`, id `$263` */
  colors: 'Co_lors:',
  /** `$2fe2`, id `$264` */
  max: 'Max:',
  /** `$2fea`, id `$265` */
  autoScroll: '_AutoScroll :',

  /**
   * Not catalog strings: these carry no id and cannot be translated. The
   * sample line is 57 characters at `$2e16`, nine shorter than asl's and
   * without its run of punctuation.
   */
  fontSample: '0123 aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ',
  /** `$2dc4`: the assign the font requester starts in */
  fontsAssign: 'FONTS',
  /** `$2dca`, six bytes after FONTS: the pattern a fresh file requester holds */
  anyPattern: '#?',
  /** `$2e06` and `$2e10`, the two halves of a line in the file list */
  nameFmt: '%-40s ',
  sizeFmt: '%4ld',
  /** `$2eb2`: how the screenmode requester names a mode */
  modeFmt: '%s%ld x %ld',
  /** `$8aa0`: the palette requester's three sliders */
  sliderFmt: '%3ld',
} as const

/**
 * Fill reqtools' `%ld`, `%-40s` and `%%`, which is all of RawDoFmt this port
 * needs. The library really does call `exec/RawDoFmt`, so a caller's own
 * format string reaches the same code, and `%d` prints a word there.
 */
export function rtFormat(fmt: string, ...args: Array<number | string>): string {
  let i = 0
  return fmt.replace(/%%|%(-?)(\d*)(ld|lu|s)/g, (m, minus: string, w: string, kind: string) => {
    if (m === '%%') return '%'
    const v = String(args[i++] ?? (kind === 's' ? '' : 0))
    const n = Number(w)
    if (w === '' || v.length >= n) return v
    return minus === '-' ? v.padEnd(n, ' ') : v.padStart(n, ' ')
  })
}

/**
 * `rtGetVScreenSize`'s answer, `general.c`'s `GetVScreenSize`: four for a
 * screen 400 rows or taller, two otherwise. Every vertical gap in the library
 * is a multiple of it, which is how one layout survives being interlaced.
 */
export function rtSpacing(visibleHeight: number): number {
  return visibleHeight >= 400 ? 4 : 2
}

/**
 * `rtSpread`, `rtfuncs.c:442`. Put `num` boxes of the given sizes between
 * `min` and `max` with an even gap: the first at `min`, the last ending at
 * `max`, the rest walked out in 16.16 fixed point.
 *
 * The fixed point is not decoration. Three buttons across 300 pixels want a
 * fractional gap, and truncating each one separately would drift the row left
 * by a pixel a button.
 */
export function rtSpread(sizes: readonly number[], total: number, min: number, max: number): number[] {
  const num = sizes.length
  const pos: number[] = new Array<number>(num).fill(min)
  if (num < 2) return pos
  const gap = Math.trunc(((max - min - total) * 0x1_0000) / (num - 1))
  let at = min * 0x1_0000
  for (let i = 1; i < num - 1; i++) {
    at += (sizes[i - 1] ?? 0) * 0x1_0000 + gap
    pos[i] = at >> 16
  }
  pos[num - 1] = max - (sizes[num - 1] ?? 0)
  return pos
}

/**
 * `myTextLength`, `boopsi.c:48`: the width of a label with its underscores
 * taken back out. Every occurrence is subtracted, not just the first, so a
 * label that means to print one has to double it and pays for both.
 */
export function rtLabelWidth(label: string, measure: (s: string) => number, underscore: string): number {
  let w = measure(label)
  if (underscore === '') return w
  const one = measure(underscore)
  for (const c of label) if (c === underscore) w -= one
  return w
}

/**
 * The key an underscore marks. `boopsi.c:105` writes the character after
 * every underscore it passes, so the LAST one wins and `C_lea_r` answers `r`.
 * Empty when the label has no underscore, or ends in one.
 */
export function rtLabelKey(label: string, underscore: string): string {
  if (underscore === '') return ''
  let key = ''
  for (let i = 0; i < label.length; i++) if (label[i] === underscore) key = label[i + 1] ?? ''
  return key
}

/** the label with its underscores taken out, which is what actually gets drawn */
export function rtLabelText(label: string, underscore: string): string {
  if (underscore === '') return label
  return label.split(underscore).join('')
}

/**
 * Split a gadget format on its bars, which is `FillBarTable`. An empty format
 * is no gadgets at all, and the doc is blunt about what that means: "Passing
 * a NULL opens an EZRequester with NO responses, just a body text. This
 * implies the user has no means of 'answering' this requester."
 */
export function rtSplitBars(gadfmt: string): string[] {
  return gadfmt === '' ? [] : gadfmt.split('|')
}

/* --------------------------------------------------------------------------
 * The EZRequest family
 *
 * One routine in `req.c` draws four requesters: rtEZRequestA, rtGetStringA,
 * rtGetLongA and the two password ones. They differ by a mode number and by
 * which of the three rows are there, so they lay out together.
 * ----------------------------------------------------------------------- */

/** `general.h:8`, and the order matters: the file tests `<=` and `>` on it */
export const REQ_MODE = {
  CHECK_PASSWORD: 0,
  ENTER_PASSWORD: 1,
  ENTER_STRING: 2,
  ENTER_NUMBER: 3,
  EZREQUEST: 4,
} as const

/** the two ends `req.c` starts RTGL_Min and RTGL_Max at */
export const RT_MININT = -0x8000_0000
export const RT_MAXINT = 0x7fff_ffff

export interface ReqBox {
  x: number
  y: number
  w: number
  h: number
}

/** what the screen the requester lands on tells the layout */
export interface ReqMetrics {
  /** `scr->Font->ta_YSize`, which sets the title bar */
  screenFontHeight: number
  /** `fontattr->ta_YSize`, the face the requester itself draws in */
  fontHeight: number
  wBorTop: number
  wBorLeft: number
  wBorRight: number
  wBorBottom: number
  /** `rtGetVScreenSize`'s two answers, the visible part of the screen */
  visibleWidth: number
  visibleHeight: number
  /** `IntuiTextLength` in the requester's font */
  measure: (s: string) => number
}

/** a caller's request, after its tag list and rtReqInfo have been read */
export interface ReqSetup {
  mode: number
  /** the body, already through RawDoFmt, newlines separating its lines */
  body: string
  /** the gadget format, bars separating the labels; empty means no gadgets */
  gadgets: string
  /**
   * RTEZ_ReqTitle, or the `title` argument of the other three. Null when the
   * tag is absent, which is the only thing that gets `Request` or
   * `Information` put there instead: `if (!title)` tests the POINTER, so a
   * tag carrying an empty string leaves the title bar blank.
   */
  title: string | null
  /** RTEZ_Flags, which is also RTGS_Flags and RTGL_Flags */
  flags: number
  /** RTGS_Width or RTGL_Width, 0 for the default */
  width: number
  /** RT_Underscore, `_` whenever the library picks the format itself */
  underscore: string
  /** RTEZ_DefaultResponse: which gadget RETURN presses, and prints in bold */
  defaultResponse: number
  /** RTGL_Min and RTGL_Max, and whether either was given */
  min: number
  max: number
  minmax: boolean
}

/** one button: where it goes, what it answers, and what key presses it */
export interface ReqButton {
  /** the label with its underscore taken out */
  text: string
  box: ReqBox
  /** `gadid - 1`: the leftmost answers 1 and the RIGHTMOST answers 0 */
  ret: number
  /** the shortcut the underscore marks, lower case as the message carries it */
  key: string
  /** the one RETURN presses, drawn in the bold face */
  bold: boolean
}

export interface ReqLayout {
  width: number
  height: number
  /**
   * The dithered face: `WBorLeft` in from the edge, starting under the title
   * bar and stopping above the bottom border. The window's own border is what
   * shows outside it.
   */
  backFill: ReqBox
  /** `Request` with two gadgets or more, `Information` with one or none */
  title: string
  /** the body, a line at a time, already positioned */
  lines: Array<{ text: string; x: number; y: number }>
  /** the recessed box behind the body, absent when there is no body */
  textBox: ReqBox | null
  buttons: ReqButton[]
  /** the string or integer gadget, absent from an EZRequest */
  stringBox: ReqBox | null
  /** the Min/Max readout, absent unless rtGetLongA was given one of them */
  minmaxBox: ReqBox | null
  minmaxText: string
  /** where REQPOS_POINTER hangs the window off the mouse */
  pointerLeft: number
  pointerTop: number
}

const box = (x: number, y: number, w: number, h: number): ReqBox => ({ x, y, w, h })

/**
 * `req.c`'s `GetString`, the arithmetic half.
 *
 * The order the width is decided in is the file's, and it is worth reading
 * once: a body text OVERWRITES the width a caller asked for with
 * `len + 70`, so RTGS_Width and RTGS_TextFmt together mean the tag is
 * ignored. Then Min/Max can widen it, then 180 is a floor, then the buttons
 * can widen it again.
 */
export function reqLayout(setup: ReqSetup, m: ReqMetrics): ReqLayout {
  const ez = setup.mode === REQ_MODE.EZREQUEST
  const spacing = rtSpacing(m.visibleHeight)
  const leftoff = m.wBorLeft + 4
  const rightoff = m.wBorRight + 4
  const val = m.fontHeight + 6

  let width = setup.width !== 0 ? setup.width : setup.mode === REQ_MODE.ENTER_STRING ? 350 : 180

  // for anything but an EZRequest the flags are cut down to the two that
  // apply and NORETURNKEY is forced on, so nothing there is ever bold
  const flags = ez
    ? setup.flags & (EZREQF.NORETURNKEY | EZREQF.LAMIGAQUAL | EZREQF.CENTERTEXT)
    : (setup.flags & (EZREQF.CENTERTEXT | EZREQF.HIGHLIGHTTEXT)) | EZREQF.NORETURNKEY

  // an EZRequest with no format of its own gets ` _Ok |_Cancel` and the
  // underscore is forced back to `_` with it
  let gadfmt = setup.gadgets
  let underscore = setup.underscore
  if (!ez && gadfmt === '') {
    gadfmt = RT_TEXT.okBarCancel
    underscore = '_'
  }

  const lines = setup.body === '' ? [] : setup.body.split('\n')
  const lineLens = lines.map((s) => m.measure(s))
  const longest = lineLens.reduce((a, b) => Math.max(a, b), 0)
  if (setup.body !== '') width = longest + 70

  const labels = rtSplitBars(gadfmt)
  const gadWidths = labels.map((s) => rtLabelWidth(s, m.measure, underscore) + 24)
  const gadTotal = gadWidths.reduce((a, b) => a + b, 0)

  const title =
    setup.title !== null ? setup.title : labels.length >= 2 ? RT_TEXT.request : RT_TEXT.information

  let top = m.wBorTop + m.screenFontHeight + 1 + spacing
  let height: number
  let textTop = 0
  let textHt = 0
  let stringTop = 0
  let minmaxLen = 0
  let minmaxText = ''

  if (!ez) {
    // the original wrote 15 where the AROS fix writes `WBorTop + 13`; both
    // give 15 on a screen whose WBorTop is 2, which is every screen here
    height = m.wBorTop + 13 + m.fontHeight * 2 + m.screenFontHeight + spacing * 3 + m.wBorBottom
    if (setup.body !== '') {
      textTop = top
      textHt = (m.fontHeight + 1) * lines.length + 15
      height += spacing + textHt
      top += spacing + textHt
    }
    if (setup.minmax) {
      height += m.fontHeight + spacing + 4
      minmaxText =
        setup.min === RT_MININT
          ? rtFormat(RT_TEXT.maxFmt, setup.max)
          : setup.max !== RT_MAXINT
            ? rtFormat(RT_TEXT.minMaxFmt, setup.min, setup.max)
            : rtFormat(RT_TEXT.minFmt, setup.min)
      minmaxLen = m.measure(minmaxText) + 8
      if (minmaxLen + 16 > width) width = minmaxLen + 16
    }
    if (width < 180) width = 180
    stringTop = top
  } else {
    textTop = top
    textHt = (m.fontHeight + 1) * lines.length + 15
    height = spacing * 2 + m.screenFontHeight + textHt + 1 + m.wBorTop + m.wBorBottom
    if (labels.length > 0) height += spacing + val
  }

  const spread = gadTotal + labels.length * 16
  if (spread > width) width = spread
  if (width > m.visibleWidth) width = m.visibleWidth
  if (height > m.visibleHeight) height = m.visibleHeight

  // the buttons. ng_GadgetID starts at 2 and climbs left to right, and the
  // LAST one is set back to 1, so `gadid - 1` numbers them 1, 2, 3 ... 0
  const buttonTop = height - spacing - val - m.wBorBottom
  let retnum = setup.defaultResponse + 1
  let gadPos: number[]
  let lastPos: number
  const lastLen = gadWidths[labels.length - 1] ?? 0
  if (labels.length > 1) {
    gadPos = rtSpread(gadWidths, gadTotal, leftoff, width - rightoff)
    lastPos = width - (lastLen + rightoff)
  } else if (labels.length === 1) {
    gadPos = [Math.trunc((width - lastLen) / 2)]
    lastPos = gadPos[0] ?? 0
    retnum = 1
  } else {
    gadPos = []
    lastPos = Math.trunc(width / 2)
  }

  const buttons: ReqButton[] = labels.map((label, i) => {
    const gadid = i === labels.length - 1 ? 1 : i + 2
    return {
      text: rtLabelText(label, underscore),
      box: box(gadPos[i] ?? 0, buttonTop, gadWidths[i] ?? 0, val),
      ret: gadid - 1,
      key: rtLabelKey(label, underscore),
      bold: gadid === retnum && (flags & EZREQF.NORETURNKEY) === 0,
    }
  })

  // the body, eight pixels down into its box, a line every fontHeight + 1
  const placed: Array<{ text: string; x: number; y: number }> = []
  let x = Math.trunc((width - longest) / 2)
  for (let i = 0; i < lines.length; i++) {
    if ((flags & EZREQF.CENTERTEXT) !== 0) x = Math.trunc((width - (lineLens[i] ?? 0)) / 2)
    if (x < 35) x = 35
    placed.push({ text: lines[i] ?? '', x, y: textTop + 8 + i * (m.fontHeight + 1) })
  }

  const minmaxTop = height - 2 * (m.fontHeight + spacing) - 10 - m.wBorBottom
  const faceTop = m.wBorTop + m.screenFontHeight + 1

  return {
    width,
    height,
    backFill: box(
      m.wBorLeft,
      faceTop,
      width - m.wBorLeft - m.wBorRight,
      height - faceTop - m.wBorBottom,
    ),
    title,
    lines: placed,
    textBox: setup.body === '' ? null : box(leftoff, textTop, width - (leftoff + rightoff), textHt),
    buttons,
    stringBox: ez ? null : box(leftoff, stringTop, width - (leftoff + rightoff), val),
    minmaxBox: setup.minmax && !ez ? box(Math.trunc((width - minmaxLen) / 2), minmaxTop, minmaxLen, m.fontHeight + 4) : null,
    minmaxText,
    pointerLeft: -lastPos - Math.trunc(lastLen / 2),
    pointerTop: -height + Math.trunc(m.fontHeight / 2) + 5 + spacing,
  }
}

/** what a click landed on */
export type ReqHit = { kind: 'button'; index: number } | { kind: 'string' } | null

const inBox = (b: ReqBox, x: number, y: number): boolean =>
  x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h

/** hit-test a click, window-relative */
export function reqHit(l: ReqLayout, x: number, y: number): ReqHit {
  for (let i = 0; i < l.buttons.length; i++) {
    const b = l.buttons[i]
    if (b && inBox(b.box, x, y)) return { kind: 'button', index: i }
  }
  if (l.stringBox && inBox(l.stringBox, x, y)) return { kind: 'string' }
  return null
}

/**
 * Draw one. The face is a `fillrectclass` image in SHINEPEN over the two-row
 * pattern at `req.c:126`, `static UWORD pattern[] = { 0xAAAA, 0x5555 }` with
 * `IA_APatSize` 1: half the pixels, on a checker, which is what a reqtools
 * requester looks like and why it never reads as flat. The three sunken areas
 * are the same class in BACKGROUNDPEN with no pattern, so they punch flat
 * holes back through the dither.
 */
export function reqRender(
  rp: RastPort,
  dri: DrawInfo,
  l: ReqLayout,
  stringText: string,
  ox: number,
  oy: number,
): void {
  const bg = penOf(dri, PEN.BACKGROUND)
  const shine = penOf(dri, PEN.SHINE)
  const text = penOf(dri, PEN.TEXT)
  const save = rp.snapshot()
  rp.drawMode = 0
  rp.areaPtrn = null
  rp.linePtrn = 0xffff
  rp.mask = 0xff

  const flood = (b: ReqBox, pen: number): void => {
    rp.rectFill(b.x + ox, b.y + oy, b.x + ox + b.w - 1, b.y + oy + b.h - 1, pen)
  }
  const bevel = (b: ReqBox, recessed: boolean): void => {
    drawBevelBox(rp, b.x + ox, b.y + oy, b.w, b.h, dri, { recessed })
  }
  const label = (s: string, lx: number, ly: number, pen: number): void => {
    if (rp.font) rp.text(lx + ox, ly + oy + rp.font.baseline, s, pen)
  }

  flood(box(0, 0, l.width, l.height), bg)
  // AreaFill takes its pattern origin from the RastPort, not from the image,
  // so the checker is in absolute coordinates and stays put when the window
  // moves by an odd number of pixels
  const face = l.backFill
  for (let y = 0; y < face.h; y++) {
    const ay = face.y + oy
    for (let x = (face.x + ox + ay + y) % 2 === 0 ? 0 : 1; x < face.w; x += 2) {
      rp.plot(face.x + ox + x, ay + y, shine)
    }
  }

  if (l.textBox) {
    flood(box(l.textBox.x + 1, l.textBox.y + 1, l.textBox.w - 2, l.textBox.h - 2), bg)
    bevel(l.textBox, true)
  }
  for (const line of l.lines) label(line.text, line.x, line.y, text)

  if (l.minmaxBox) {
    flood(l.minmaxBox, bg)
    bevel(l.minmaxBox, true)
    const w = rp.font ? rp.textLength(l.minmaxText) : l.minmaxText.length * 8
    label(l.minmaxText, l.minmaxBox.x + Math.max(0, Math.trunc((l.minmaxBox.w - w) / 2)), l.minmaxBox.y + 1, text)
  }

  if (l.stringBox) {
    flood(l.stringBox, bg)
    bevel(l.stringBox, true)
    label(stringText, l.stringBox.x + 3, l.stringBox.y + 3, text)
  }

  for (const b of l.buttons) {
    flood(b.box, bg)
    bevel(b.box, false)
    const w = rp.font ? rp.textLength(b.text) : b.text.length * 8
    label(b.text, b.box.x + Math.max(1, Math.trunc((b.box.w - w) / 2)), b.box.y + 3, text)
  }
  rp.restore(save)
}
