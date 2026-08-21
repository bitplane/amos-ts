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
  /**
   * `$2de8`: a file's size at the right of its row, and the leading space is
   * the gap from the name.
   */
  entrySizeFmt: ' %ld',
  /** `$2e10`: the count in the `Selected:` box, `filereqextra.c`:1161 */
  selectedFmt: '%4ld',
  /**
   * `$2e06`, and nothing in the 38.1436 sources formats with it. Kept
   * because it is in 38.1092 and a later reading may find the caller.
   */
  nameFmt: '%-40s ',
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
 *
 * The library has a second answer to the same question. See `rtStrWidth`.
 */
export function rtLabelWidth(label: string, measure: (s: string) => number, underscore: string): number {
  let w = measure(label)
  if (underscore === '') return w
  const one = measure(underscore)
  for (const c of label) if (c === underscore) w -= one
  return w
}

/**
 * `StrWidth_noloc`, `general.c`: the width with the FIRST underscore removed
 * and any others left in.
 *
 * `req.c` measures its buttons with `myTextLength`, which takes out every
 * underscore, and `filereqsetup.c` measures its buttons with this, which
 * takes out one. The two requesters would size a label like `C_lea_r`
 * differently by one character, and neither is a rounding of the other.
 */
export function rtStrWidth(label: string, measure: (s: string) => number): number {
  const i = label.indexOf('_')
  return measure(i < 0 ? label : label.slice(0, i) + label.slice(i + 1))
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

/* --------------------------------------------------------------------------
 * The file requester
 *
 * `filereqsetup.c`'s `SetupReqWindow` builds the file, font and screenmode
 * requesters from one routine, the same way `req.c` builds the other four.
 * Only the file arm is here.
 *
 * It is a RESIZABLE window on the machine: WFLG_SIZEGADGET | WFLG_SIZEBBOTTOM,
 * and IDCMP_NEWSIZE tears the gadget list down and runs this again with the
 * new height. DEVIATION: this port opens it at one size and leaves it there,
 * because ../amiga/intuition.ts has no resize.
 * ----------------------------------------------------------------------- */

/** `filereq.h`:161, the entry types a row can be */
export const RT_ENTRY = { FILE: 0, DIRECTORY: 1, FONT: 2, VOLUME: 3, ASSIGN: 4 } as const

/**
 * `BottomBorderHeight`, `general.c`:720: the height of the size gadget, which
 * it asks sysiclass for at SYSISIZE_MEDRES and falls back to 10 when the
 * class will not answer. Ten is what this port uses, since it draws no size
 * gadget of its own to measure.
 */
export const RT_BOTTOM_BORDER = 10

/**
 * The prefs a fresh reqtools makes for itself, `$14c` to `$1ac` of 38.1092.
 *
 * `$19c moveq #$4b,d1` is the file requester's 75, and the four `bsr.b $14c`
 * after it fill the font, palette, screenmode and volume ones from `$41`, 65.
 * The shared tail is `moveq #$4,d0` for REQPOS_TOPLEFTSCR, then 25, 18, 6 and
 * 10; the file requester overwrites the last two with `move.w #$a,-$4(a0)`
 * and `move.w #$32,-$2(a0)`. ReqTools.prefs would replace all of it and there
 * is none here.
 */
export const RT_FILEREQ_PREFS = {
  /** per cent of the visible screen height */
  size: 75,
  reqPos: REQPOS.TOPLEFTSCR,
  leftOffset: 25,
  topOffset: 18,
  minEntries: 10,
  maxEntries: 50,
} as const

/** one row of the list */
export interface ReqEntry {
  name: string
  /** RT_ENTRY */
  type: number
  /** bytes for a file, per cent full for a volume, ignored otherwise */
  size: number
  selected: boolean
}

/** what a file request asks for, after its tag list has been read */
export interface FileReqSetup {
  /** `glob->title`, straight off `rtFileRequestA`'s a3; empty is untitled */
  title: string
  /** RTFI_OkText, or ` _Ok ` when the tag is absent */
  okText: string
  /** RT_Underscore, which reaches the OK gadget only; the rest are always `_` */
  underscore: string
  /** `rtfi_Dir` */
  dir: string
  /** `rtfi_MatchPat` */
  pattern: string
  /** the File gadget's contents */
  file: string
  /** RTFI_Flags */
  flags: number
  /** RTFI_Height, 0 for the prefs default */
  height: number
  /** `freq->hideinfo`: the `._info` toggle comes up SELECTED when this is false */
  hideInfo: boolean
  /**
   * RT_ReqPos, or the prefs' own when the tag is absent.
   *
   * `intuition-1.3b` leaves it out and gets REQPOS_TOPLEFTSCR at 25, 18;
   * `butility-1.21` asks for REQPOS_CENTERSCR outright, `$5de` of its
   * BUtility.Lib being `80000003 00000002`.
   */
  reqPos: number
}

/** a labelled box in one of the two gadget rows */
export interface ReqGadget {
  text: string
  box: ReqBox
  key: string
}

export interface FileReqLayout {
  width: number
  height: number
  title: string
  /** how many rows fit, after the Min and Max clamps */
  entries: number
  entryHeight: number
  /** the sunken frame around the list */
  listFrame: ReqBox
  /** where a row is drawn: `boxleft` to `boxright`, `boxtop` down */
  boxLeft: number
  boxTop: number
  boxRight: number
  scroller: ReqBox
  /** the Pa_ttern: field and its label, absent without FREQF_PATGAD */
  pattern: ReqBox | null
  patternLabel: ReqBox | null
  /** the disk-activity light, `do_led` */
  led: ReqBox
  drawer: ReqBox
  get: ReqGadget
  /** the File field, absent with FREQF_NOFILES */
  file: ReqBox | null
  info: ReqGadget | null
  /** `Selected:`, `_All`, `_Match..`, `C_lear`; empty without MULTISELECT */
  top: ReqGadget[]
  /** the OK, `_Volumes`, `_Parent` and `_Cancel` row */
  buttons: ReqGadget[]
}

/**
 * `CheckGadgetsSize`, `filereqsetup.c`:20. When a row will not fit, take the
 * same amount off every gadget in it, rounded UP so the row certainly fits
 * rather than probably.
 */
function checkGadgetsSize(lens: number[], width: number, avail: number): number {
  if (avail >= width) return width
  const overlap = ((((width - avail) * 0x1_0000) / lens.length + 0xffff) | 0) >>> 16
  for (let i = 0; i < lens.length; i++) lens[i] = (lens[i] ?? 0) - overlap
  return width - overlap * lens.length
}

/** `filereqsetup.c`'s `SetupReqWindow`, the file arm */
export function fileReqLayout(setup: FileReqSetup, m: ReqMetrics): FileReqLayout {
  const spacing = rtSpacing(m.visibleHeight)
  const stdGad = m.fontHeight + 6
  const entryHeight = m.fontHeight + 1
  const leftoff = m.wBorLeft + 5
  const rightoff = m.wBorRight + 5
  const totaloff = leftoff + rightoff
  const startTop = m.wBorTop + m.screenFontHeight + 1 + spacing
  const multi = (setup.flags & FREQF.MULTISELECT) !== 0
  const noFiles = (setup.flags & FREQF.NOFILES) !== 0
  const patGad = (setup.flags & FREQF.PATGAD) !== 0 && !noFiles
  const width = (s: string): number => rtStrWidth(s, m.measure)

  const defaultHeight = setup.height === 0
  let reqHeight = defaultHeight
    ? Math.trunc((RT_FILEREQ_PREFS.size * m.visibleHeight) / 100)
    : Math.min(setup.height, m.visibleHeight)

  // the space every row below the list needs, so what is left is the list
  let below = (stdGad + spacing) * 4 + 4
  if (patGad) below += stdGad + Math.trunc(spacing / 2)
  if (noFiles) below -= stdGad + spacing
  if (!multi) below -= stdGad + spacing

  let entries = Math.trunc((reqHeight - below - startTop - RT_BOTTOM_BORDER) / entryHeight)
  const floor = defaultHeight ? RT_FILEREQ_PREFS.minEntries : 3
  if (entries < floor) entries = floor
  const ceiling = defaultHeight ? RT_FILEREQ_PREFS.maxEntries : 50
  if (entries > ceiling) entries = ceiling

  // the top row, and the button row. gadtxt[4] is the OK text and gadtxt[7]
  // is Cancel, so the two ends of the button row are the caller's and the
  // library's respectively
  const topText = [RT_TEXT.selected, RT_TEXT.all, RT_TEXT.match, RT_TEXT.clear]
  const buttonText = [setup.okText, RT_TEXT.volumes, RT_TEXT.parent, RT_TEXT.cancel]
  // gadlen[0] is the width of four digits BEFORE its label is added, which is
  // what leaves room for the count beside the word
  const topLens = topText.map((s, i) => (i === 0 ? m.measure('0000') : 0) + width(s) + 16)
  let width1 = multi ? topLens.reduce((a, b) => a + b, 0) : 0
  let width2 = buttonText.reduce((w, s) => Math.max(w, width(s) + 16), 0)
  const buttonLens = buttonText.map(() => width2)
  width2 *= 4

  let winWidth = width1 + 3 * 8 + totaloff
  if (winWidth < 300) winWidth = 300
  const byButtons = width2 + 3 * 8 + totaloff
  if (byButtons > winWidth) winWidth = byButtons
  if (winWidth > m.visibleWidth) winWidth = m.visibleWidth

  let topPos: number[] = [0, 0, 0, 0]
  if (multi) {
    width1 = checkGadgetsSize(topLens, width1, winWidth - totaloff)
    topPos = rtSpread(topLens, width1, leftoff, winWidth - rightoff)
  }
  width2 = checkGadgetsSize(buttonLens, width2, winWidth - totaloff)
  const buttonPos = rtSpread(buttonLens, width2, leftoff, winWidth - rightoff)

  // when the button row is the wider of the two, the top row is packed left
  // instead of spread, so `Selected:` keeps its place under the list
  if (multi && width2 > width1) {
    for (let i = 1; i < 4; i++) {
      const at = (topPos[i - 1] ?? 0) + (topLens[i - 1] ?? 0) + 8
      topLens[i] = (topLens[i] ?? 0) + ((topPos[i] ?? 0) - at)
      topPos[i] = at
    }
  }

  let top = startTop
  const boxHeight = entries * entryHeight
  const listFrame = box(leftoff, top, winWidth - 18 - totaloff, boxHeight + 4)
  const boxLeft = leftoff + 2
  const boxTop = top + 2
  const boxRight = winWidth - 21 - rightoff
  const scroller = box(winWidth - 18 - rightoff, top, 18, boxHeight + 4)
  top += boxHeight + 4 + Math.trunc(spacing / 2)

  let pattern: ReqBox | null = null
  let patternLabel: ReqBox | null = null
  if (patGad) {
    const val = width(RT_TEXT.pattern) + 8
    pattern = box(leftoff + 2 + val, top, winWidth - 2 - val - totaloff, stdGad)
    patternLabel = box(leftoff + 2, top + 3, val, m.fontHeight)
    top += stdGad + Math.trunc(spacing / 2)
  }

  const infoWidth = Math.max(width(RT_TEXT.dotInfo), width(RT_TEXT.get)) + 8
  const get: ReqGadget = {
    text: RT_TEXT.get,
    box: box(winWidth - rightoff - infoWidth, top, infoWidth, stdGad),
    key: rtLabelKey(RT_TEXT.get, '_'),
  }
  const ledH = Math.max(m.fontHeight - 4, 7)
  const ledW = 15 + (ledH - 7) * 2
  const ledOff = ledW + 6
  const drawer = box(leftoff + ledOff, top, winWidth - totaloff - infoWidth - ledOff, stdGad)
  const led = box(leftoff, top + Math.trunc((stdGad - ledH - 1) / 2), ledW, ledH)
  top += stdGad + Math.trunc(spacing / 2)

  let file: ReqBox | null = null
  let info: ReqGadget | null = null
  if (!noFiles) {
    file = box(leftoff, top, winWidth - totaloff - infoWidth, stdGad)
    info = {
      text: RT_TEXT.dotInfo,
      box: box(winWidth - rightoff - infoWidth, top, infoWidth, stdGad),
      key: rtLabelKey(RT_TEXT.dotInfo, '_'),
    }
    top += stdGad + spacing
  } else top += Math.trunc(spacing / 2)

  const buttonHeight = m.fontHeight + 6
  const topRow: ReqGadget[] = multi
    ? topText.map((s, i) => ({
        text: rtLabelText(s, '_'),
        box: box(topPos[i] ?? 0, top, topLens[i] ?? 0, buttonHeight),
        key: rtLabelKey(s, '_'),
      }))
    : []
  if (multi) top += buttonHeight + spacing

  const buttons: ReqGadget[] = buttonText.map((s, i) => {
    const under = i === 0 ? setup.underscore : '_'
    return {
      text: rtLabelText(s, under),
      box: box(buttonPos[i] ?? 0, top, buttonLens[i] ?? 0, buttonHeight),
      key: rtLabelKey(s, under),
    }
  })

  const height = top + buttonHeight + spacing + RT_BOTTOM_BORDER
  reqHeight = height

  return {
    width: winWidth,
    height,
    title: setup.title,
    entries,
    entryHeight,
    listFrame,
    boxLeft,
    boxTop,
    boxRight,
    scroller,
    pattern,
    patternLabel,
    led,
    drawer,
    get,
    file,
    info,
    top: topRow,
    buttons,
  }
}

/** what a click on the file requester landed on */
export type FileReqHit =
  | { kind: 'row'; index: number }
  | { kind: 'scroll'; delta: number }
  | { kind: 'top'; index: number }
  | { kind: 'button'; index: number }
  | { kind: 'get' }
  | { kind: 'info' }
  | { kind: 'drawer' }
  | { kind: 'file' }
  | { kind: 'pattern' }
  | null

/**
 * Hit-test a click, window-relative.
 *
 * `CalcClicked` is `(im->MouseY - glob->boxtop) / glob->entryheight`, with no
 * upper test of its own: the FILES gadget's own rectangle is what bounds it,
 * so a row number can only come out of a click inside the list.
 */
export function fileReqHit(l: FileReqLayout, x: number, y: number): FileReqHit {
  if (x >= l.boxLeft && x <= l.boxRight && y >= l.boxTop && y < l.boxTop + l.entries * l.entryHeight) {
    return { kind: 'row', index: Math.trunc((y - l.boxTop) / l.entryHeight) }
  }
  if (inBox(l.scroller, x, y)) {
    // the arrows are at the bottom, `GTSC_Arrows` of fontheight + 1 each
    const arrow = l.entryHeight
    const upTop = l.scroller.y + l.scroller.h - 2 * arrow
    if (y >= upTop && y < upTop + arrow) return { kind: 'scroll', delta: -1 }
    if (y >= upTop + arrow) return { kind: 'scroll', delta: 1 }
    return { kind: 'scroll', delta: y < l.scroller.y + l.scroller.h / 2 ? -l.entries : l.entries }
  }
  for (let i = 0; i < l.top.length; i++) {
    const g = l.top[i]
    if (g && inBox(g.box, x, y)) return { kind: 'top', index: i }
  }
  for (let i = 0; i < l.buttons.length; i++) {
    const g = l.buttons[i]
    if (g && inBox(g.box, x, y)) return { kind: 'button', index: i }
  }
  if (inBox(l.get.box, x, y)) return { kind: 'get' }
  if (l.info && inBox(l.info.box, x, y)) return { kind: 'info' }
  if (l.file && inBox(l.file, x, y)) return { kind: 'file' }
  if (inBox(l.drawer, x, y)) return { kind: 'drawer' }
  if (l.pattern && inBox(l.pattern, x, y)) return { kind: 'pattern' }
  return null
}

/**
 * Draw one.
 *
 * `PrintEntry` (`filereqextra.c`) is the row: the name at `boxleft + 2`, and
 * a right-aligned size string ending at `boxright - 1`. A drawer says
 * `Drawer` there and an assign says `Assign`, both in HIGHLIGHTTEXTPEN; a
 * file says ` %ld`; a volume says `%ld%% full`. Selecting a file puts
 * FILLTEXTPEN on FILLPEN and selecting a drawer puts BACKGROUNDPEN on
 * HIGHLIGHTTEXTPEN, so the two kinds of selection do not look alike.
 */
export function fileReqRender(
  rp: RastPort,
  dri: DrawInfo,
  l: FileReqLayout,
  rows: readonly ReqEntry[],
  first: number,
  fields: { dir: string; file: string; pattern: string; selected: number; info: boolean; led: boolean },
  ox: number,
  oy: number,
): void {
  const bg = penOf(dri, PEN.BACKGROUND)
  const text = penOf(dri, PEN.TEXT)
  const fill = penOf(dri, PEN.FILL)
  const fillText = penOf(dri, PEN.FILLTEXT)
  const high = penOf(dri, PEN.HIGHLIGHTTEXT)
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
  const measure = (s: string): number => (rp.font ? rp.textLength(s) : s.length * 8)
  const button = (g: ReqGadget, down = false): void => {
    flood(g.box, bg)
    bevel(g.box, down)
    label(g.text, g.box.x + Math.max(1, Math.trunc((g.box.w - measure(g.text)) / 2)), g.box.y + 3, text)
  }
  const field = (b: ReqBox, value: string): void => {
    flood(b, bg)
    bevel(b, true)
    label(value, b.x + 3, b.y + 3, text)
  }

  flood(box(0, 0, l.width, l.height), bg)

  bevel(l.listFrame, true)
  for (let i = 0; i < l.entries; i++) {
    const e = rows[first + i]
    const y = l.boxTop + i * l.entryHeight
    const ground = e?.selected ? (e.type === RT_ENTRY.FILE || e.type === RT_ENTRY.VOLUME ? fill : high) : bg
    rp.rectFill(l.boxLeft + ox, y + oy, l.boxRight + ox, y + l.entryHeight - 1 + oy, ground)
    if (!e) continue
    const pen = e.selected
      ? e.type === RT_ENTRY.FILE || e.type === RT_ENTRY.VOLUME
        ? fillText
        : bg
      : e.type === RT_ENTRY.DIRECTORY || e.type === RT_ENTRY.ASSIGN
        ? high
        : text
    const size =
      e.type === RT_ENTRY.DIRECTORY
        ? RT_TEXT.drawer
        : e.type === RT_ENTRY.ASSIGN
          ? RT_TEXT.assign
          : e.type === RT_ENTRY.VOLUME
            ? rtFormat(RT_TEXT.full, e.size)
            : rtFormat(RT_TEXT.entrySizeFmt, e.size)
    label(e.name, l.boxLeft + 2, y, pen)
    label(size, l.boxRight - measure(size) - 1, y, pen)
  }
  bevel(l.scroller, true)

  if (l.pattern && l.patternLabel) {
    label(rtLabelText(RT_TEXT.pattern, '_'), l.patternLabel.x, l.patternLabel.y, text)
    field(l.pattern, fields.pattern)
  }
  field(l.drawer, fields.dir)
  button(l.get)
  flood(l.led, bg)
  bevel(l.led, true)
  if (fields.led) flood(box(l.led.x + 2, l.led.y + 1, l.led.w - 4, l.led.h - 2), fill)
  if (l.file) field(l.file, fields.file)
  if (l.info) button(l.info, fields.info)

  for (let i = 0; i < l.top.length; i++) {
    const g = l.top[i]
    if (!g) continue
    if (i === 0) {
      // `Selected:` is a TEXT_KIND box with a border, not a button, and the
      // count is an IntuiText hung off the label at `LeftEdge + 8`
      flood(g.box, bg)
      bevel(g.box, true)
      label(g.text, g.box.x + 8, g.box.y + 3, text)
      const n = rtFormat(RT_TEXT.selectedFmt, fields.selected)
      label(n, g.box.x + 8 + measure(g.text), g.box.y + 3, text)
    } else button(g)
  }
  for (const g of l.buttons) button(g)
  rp.restore(save)
}

/* --------------------------------------------------------------------------
 * The font requester
 *
 * `rtFontRequestA` is four lines: it calls `FileRequestA` with a null
 * filename, so the font requester IS the file requester with a different arm
 * of `SetupReqWindow` and a different arm of the click handler. What follows
 * is that arm, kept apart from `fileReqLayout` because the two share no
 * gadget: there is no Drawer, no Pattern, no `._info`, no LED, and the button
 * row is two wide rather than four.
 * ----------------------------------------------------------------------- */

/**
 * `CHECKBOX_WIDTH`, and 38.1092 has it folded in as a constant rather than
 * asking sysiclass the way 38.1436's `ObjectWidth` does.
 *
 * Read out of the binary twice over. `$7642` is `moveq #$12,d0` added to each
 * of the three style gadget lengths, which is `checkw + 8 - 16`, and `$7652
 * moveq #$36,d0` adds the same 18 three times to `width1`. The screenmode
 * arm's `$7630 moveq #$54,d1` is `12 + 8 + 8 + checkw + 8 + 4 + totaloff`,
 * 84, which needs the same 26.
 */
export const RT_CHECKBOX_WIDTH = 26
/** `CHECKBOX_HEIGHT`, the height the same two calls fall back to */
export const RT_CHECKBOX_HEIGHT = 11

/**
 * The font requester's own prefs, `$1ac` of 38.1092.
 *
 * The build loop at `$14c` fills the font, palette, screenmode and volume
 * requesters from `moveq #$41,d1`, 65, and leaves the shared tail alone: the
 * file requester is the only one that overwrites the last two words with 10
 * and 50. So the font list is at most TEN rows however tall the screen is.
 */
export const RT_FONTREQ_PREFS = {
  size: 65,
  reqPos: REQPOS.TOPLEFTSCR,
  leftOffset: 25,
  topOffset: 18,
  minEntries: 6,
  maxEntries: 10,
} as const

/** what a font request asks for, after its tag list has been read */
export interface FontReqSetup {
  /** `glob->title`, straight off `rtFontRequestA`'s a3 */
  title: string
  /** RTFO_OkText, or ` _Ok ` when the tag is absent */
  okText: string
  /** RT_Underscore, which reaches the OK gadget only */
  underscore: string
  /** RTFO_Flags */
  flags: number
  /** RTFO_Height, 0 for the prefs default */
  height: number
  /** RTFO_SampleHeight, `filereq.c`:104 sets 24 before the tags are read */
  sampleHeight: number
  /** RTFO_MinHeight and RTFO_MaxHeight, the sizes the list will show */
  minSize: number
  maxSize: number
}

/** one row of the font list: the name with `.font` already off it */
export interface FontRow {
  name: string
  size: number
}

export interface FontReqLayout {
  width: number
  height: number
  title: string
  entries: number
  entryHeight: number
  listFrame: ReqBox
  boxLeft: number
  boxTop: number
  boxRight: number
  scroller: ReqBox
  /** the font name, a 107-character string gadget */
  name: ReqBox
  /** the size, a 4-digit integer gadget 57 pixels wide */
  size: ReqBox
  /** the bordered box the sample line is drawn inside */
  sample: ReqBox
  /** RTFO_SampleHeight, which is `sample.h` less its four pixels of border */
  sampleHeight: number
  sampleLeft: number
  sampleRight: number
  sampleTop: number
  /** Ok and Cancel, in that order */
  buttons: ReqGadget[]
}

/**
 * `filereqsetup.c`'s `SetupReqWindow`, the font arm.
 *
 * Two things in here look like mistakes and are not. The window's width is
 * decided by the widths of `_Bold`, `_Italic` and `_Underline` whether or not
 * FREQF_STYLE asked for those three gadgets, because `gadtxt[0..2]` and
 * `width1` are filled before the flag is ever tested. And `rtSpread` runs on
 * the three of them either way, so a requester without style gadgets still
 * pays for their spacing. On topaz 8 the sum comes to 254, which plus
 * `(3-1)*8 + 18 + 12` is exactly 300, the floor below it -- so the arithmetic
 * and the floor agree to the pixel and neither can be told from the other.
 */
export function fontReqLayout(setup: FontReqSetup, m: ReqMetrics): FontReqLayout {
  const spacing = rtSpacing(m.visibleHeight)
  const stdGad = m.fontHeight + 6
  const entryHeight = m.fontHeight + 1
  const leftoff = m.wBorLeft + 5
  const rightoff = m.wBorRight + 5
  const totaloff = leftoff + rightoff
  const startTop = m.wBorTop + m.screenFontHeight + 1 + spacing
  const style = (setup.flags & FREQF.STYLE) !== 0
  const width = (s: string): number => rtStrWidth(s, m.measure)
  const checkSkip = Math.max(RT_CHECKBOX_HEIGHT, m.fontHeight)

  const defaultHeight = setup.height === 0
  const reqHeight = defaultHeight
    ? Math.trunc((RT_FONTREQ_PREFS.size * m.visibleHeight) / 100)
    : Math.min(setup.height, m.visibleHeight)

  // everything under the list: the name/size row, the sample, and the buttons
  let below = stdGad * 2 + spacing * 3 + Math.trunc(spacing / 2) + 8 + setup.sampleHeight
  if (style) below += checkSkip + 4 + spacing

  let entries = Math.trunc((reqHeight - below - startTop - RT_BOTTOM_BORDER) / entryHeight)
  const floor = defaultHeight ? RT_FONTREQ_PREFS.minEntries : 3
  if (entries < floor) entries = floor
  const ceiling = defaultHeight ? RT_FONTREQ_PREFS.maxEntries : 50
  if (entries > ceiling) entries = ceiling

  // `gadlen[i] = checkw + 8 - 16` before the label is added, which is the room
  // the checkbox itself would take beside the word
  const styleText = [RT_TEXT.bold, RT_TEXT.italic, RT_TEXT.underline]
  const styleLens = styleText.map((s) => RT_CHECKBOX_WIDTH + 8 - 16 + width(s) + 16)
  let width1 = styleLens.reduce((a, b) => a + b, 0)

  // `num2` is 2 here, and `gadtxt[5] = gadtxt[7]` puts Cancel in the second
  // slot before the row is measured, so the pair sizes off Ok and Cancel
  const buttonText = [setup.okText, RT_TEXT.cancel]
  let width2 = buttonText.reduce((w, s) => Math.max(w, width(s) + 16), 0)
  const buttonLens = buttonText.map(() => width2)
  width2 *= 2

  let winWidth = width1 + 2 * 8 + totaloff + 12
  if (winWidth < 300) winWidth = 300
  const byButtons = width2 + 8 + totaloff
  if (byButtons > winWidth) winWidth = byButtons
  if (winWidth > m.visibleWidth) winWidth = m.visibleWidth

  width1 = checkGadgetsSize(styleLens, width1, winWidth - totaloff)
  rtSpread(styleLens, width1, leftoff, winWidth - rightoff)
  width2 = checkGadgetsSize(buttonLens, width2, winWidth - totaloff)
  const buttonPos = rtSpread(buttonLens, width2, leftoff, winWidth - rightoff)

  let top = startTop
  const boxHeight = entries * entryHeight
  const listFrame = box(leftoff, top, winWidth - 18 - totaloff, boxHeight + 4)
  const boxLeft = leftoff + 2
  const boxTop = top + 2
  const boxRight = winWidth - 21 - rightoff
  const scroller = box(winWidth - 18 - rightoff, top, 18, boxHeight + 4)
  top += boxHeight + 4 + Math.trunc(spacing / 2)

  // 65 is the size gadget's 57 plus the 8 between the two
  const name = box(leftoff, top, winWidth - 65 - totaloff, stdGad)
  const size = box(winWidth - 57 - rightoff, top, 57, stdGad)
  top += stdGad + spacing

  const sample = box(leftoff, top, winWidth - totaloff, setup.sampleHeight + 4)
  const sampleLeft = leftoff + 4
  const sampleRight = winWidth - rightoff - 5
  const sampleTop = top + 2
  top += setup.sampleHeight + 4 + spacing

  // `buttonheight = createstyle ? (checkskip + 4) : (fontheight + 6)`, and the
  // style row is what the `i == num1` bump makes room for. Without
  // FREQF_STYLE neither happens, so Ok and Cancel sit straight under the
  // sample
  if (style) top += checkSkip + 4 + spacing
  const buttonHeight = m.fontHeight + 6

  const buttons: ReqGadget[] = buttonText.map((s, i) => {
    const under = i === 0 ? setup.underscore : '_'
    return {
      text: rtLabelText(s, under),
      box: box(buttonPos[i] ?? 0, top, buttonLens[i] ?? 0, buttonHeight),
      key: rtLabelKey(s, under),
    }
  })

  return {
    width: winWidth,
    height: top + buttonHeight + spacing + RT_BOTTOM_BORDER,
    title: setup.title,
    entries,
    entryHeight,
    listFrame,
    boxLeft,
    boxTop,
    boxRight,
    scroller,
    name,
    size,
    sample,
    sampleHeight: setup.sampleHeight,
    sampleLeft,
    sampleRight,
    sampleTop,
    buttons,
  }
}

/** what a click on the font requester landed on */
export type FontReqHit =
  | { kind: 'row'; index: number }
  | { kind: 'scroll'; delta: number }
  | { kind: 'button'; index: number }
  | { kind: 'name' }
  | { kind: 'size' }
  | null

/** hit-test a click, window-relative */
export function fontReqHit(l: FontReqLayout, x: number, y: number): FontReqHit {
  if (x >= l.boxLeft && x <= l.boxRight && y >= l.boxTop && y < l.boxTop + l.entries * l.entryHeight) {
    return { kind: 'row', index: Math.trunc((y - l.boxTop) / l.entryHeight) }
  }
  if (inBox(l.scroller, x, y)) {
    const arrow = l.entryHeight
    const upTop = l.scroller.y + l.scroller.h - 2 * arrow
    if (y >= upTop && y < upTop + arrow) return { kind: 'scroll', delta: -1 }
    if (y >= upTop + arrow) return { kind: 'scroll', delta: 1 }
    return { kind: 'scroll', delta: y < l.scroller.y + l.scroller.h / 2 ? -l.entries : l.entries }
  }
  for (let i = 0; i < l.buttons.length; i++) {
    const g = l.buttons[i]
    if (g && inBox(g.box, x, y)) return { kind: 'button', index: i }
  }
  if (inBox(l.name, x, y)) return { kind: 'name' }
  if (inBox(l.size, x, y)) return { kind: 'size' }
  return null
}

/**
 * Draw one.
 *
 * A font row is not laid out the way a file row is. `PrintEntry` builds the
 * size string with the same ` %ld` and then, for a FONT and only for a FONT,
 * does `StrCat (tempstr, sizestr)` and clears it -- so the size is glued to
 * the end of the name at the LEFT of the row instead of being right-aligned
 * at `boxright`. A selected font takes FILLTEXTPEN on FILLPEN, the same as a
 * file.
 *
 * `sampleText` is what the caller has already resolved: the sample line when
 * the face opened, and `Couldn't open font!` when it did not.
 */
export function fontReqRender(
  rp: RastPort,
  dri: DrawInfo,
  l: FontReqLayout,
  rows: readonly FontRow[],
  first: number,
  fields: { name: string; size: number; selected: number; sampleText: string; sampleFont: RastPort['font'] },
  ox: number,
  oy: number,
): void {
  const bg = penOf(dri, PEN.BACKGROUND)
  const text = penOf(dri, PEN.TEXT)
  const fill = penOf(dri, PEN.FILL)
  const fillText = penOf(dri, PEN.FILLTEXT)
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
  const measure = (s: string): number => (rp.font ? rp.textLength(s) : s.length * 8)

  flood(box(0, 0, l.width, l.height), bg)

  bevel(l.listFrame, true)
  for (let i = 0; i < l.entries; i++) {
    const e = rows[first + i]
    const y = l.boxTop + i * l.entryHeight
    const chosen = first + i === fields.selected
    rp.rectFill(l.boxLeft + ox, y + oy, l.boxRight + ox, y + l.entryHeight - 1 + oy, chosen ? fill : bg)
    if (!e) continue
    label(e.name + rtFormat(RT_TEXT.entrySizeFmt, e.size), l.boxLeft + 2, y, chosen ? fillText : text)
  }
  bevel(l.scroller, true)

  flood(l.name, bg)
  bevel(l.name, true)
  label(fields.name, l.name.x + 3, l.name.y + 3, text)
  flood(l.size, bg)
  bevel(l.size, true)
  label(String(fields.size), l.size.x + 3, l.size.y + 3, text)

  flood(l.sample, bg)
  bevel(l.sample, true)
  // `MyInstallRegion` clips the sample to `fontdisplayleft..right` and to
  // `sampleheight` rows, which is what stops a 24-point face from writing
  // over the buttons; the baseline is `(sampleheight - tf_YSize) / 2 +
  // tf_Baseline` down from `fontdisplaytop`
  const shown = rp.font
  rp.font = fields.sampleFont ?? shown
  if (rp.font) {
    const outer = rp.clip
    const region = {
      x1: l.sampleLeft + ox,
      y1: l.sampleTop + oy,
      x2: l.sampleRight + ox,
      y2: l.sampleTop + l.sampleHeight - 1 + oy,
    }
    rp.clip = outer
      ? {
          x1: Math.max(outer.x1, region.x1),
          y1: Math.max(outer.y1, region.y1),
          x2: Math.min(outer.x2, region.x2),
          y2: Math.min(outer.y2, region.y2),
        }
      : region
    rp.text(
      l.sampleLeft + ox,
      l.sampleTop + oy + Math.trunc((l.sampleHeight - rp.font.ySize) / 2) + rp.font.baseline,
      fields.sampleText,
      text,
    )
    rp.clip = outer
  }
  rp.font = shown

  for (const g of l.buttons) {
    flood(g.box, bg)
    bevel(g.box, false)
    label(g.text, g.box.x + Math.max(1, Math.trunc((g.box.w - measure(g.text)) / 2)), g.box.y + 3, text)
  }
  rp.restore(save)
}

/* --------------------------------------------------------------------------
 * The screenmode requester
 *
 * `rtScreenModeRequestA` is the same four lines as `rtFontRequestA`: it calls
 * `FileRequestA` with a null filename, so this is the THIRD arm of one
 * window. The list is the same list, the scroller is the same scroller, and
 * everything under them is different.
 *
 * Four flags decide what that is, and `intuition-1.3b` sets two of them ---
 * `request.s`:537 is `dc.l RTSC_Flags,SCREQF_SIZEGADS|SCREQF_DEPTHGAD`, and
 * the tag list at `$5bfa` really does read `80 00 00 28 00 00 60 00`. So the
 * requester it opens has a Width and a Height field with a Default box beside
 * each, and a colour slider between two readouts; it has no overscan cycle
 * and no autoscroll box. Both of those are laid out here anyway, because the
 * WINDOW WIDTH is a maximum over the two arms and getting one wrong moves the
 * other.
 *
 * ## Where 38.1092 differs from the sources
 *
 * `_Width   :` and `_Height  :` are padded to ten characters in 38.1092 and
 * unpadded in 38.1436, which the header already records. This arm is why.
 * 38.1436 measures both labels and takes the larger; 38.1092 measures only
 * the width one --- `$7554 lea.l $2f68(pc),a1` is MSG_WIDTH inside the width
 * calculation and MSG_HEIGHT is not fetched until `$7de2`, long after the
 * window has been sized. The padding makes the two the same length so that
 * measuring one is measuring both, and it is what keeps the labels in a
 * column. Unpadding them without also measuring both would have moved the
 * Height field left by one character.
 * ----------------------------------------------------------------------- */

/**
 * The screenmode requester's prefs, from the same `$14c` build loop.
 *
 * `moveq #$41,d1` is 65 and the four `bsr.b $14c` after `$19c` fill the font,
 * palette, screenmode and volume requesters from it. Only the file requester
 * overwrites the shared tail, so ten modes is the most this list ever shows.
 */
export const RT_SCREENMODEREQ_PREFS = {
  size: 65,
  reqPos: REQPOS.TOPLEFTSCR,
  leftOffset: 25,
  topOffset: 18,
  minEntries: 6,
  maxEntries: 10,
} as const

/** what a screenmode request asks for, after its tag list has been read */
export interface ScreenReqSetup {
  /** `glob->title`, straight off `rtScreenModeRequestA`'s a3 */
  title: string
  /** RTSC_OkText, or ` _Ok ` when the tag is absent */
  okText: string
  /** RT_Underscore, which reaches the OK gadget only */
  underscore: string
  /** RTSC_Flags */
  flags: number
  /** RTSC_Height, 0 for the prefs default */
  height: number
}

/** one row of the mode list: what the driver calls it, and its DisplayID */
export interface ScreenRow {
  name: string
  id: number
}

/** a word drawn beside a gadget, already placed */
export interface ReqLabel {
  text: string
  x: number
  y: number
}

export interface ScreenReqLayout {
  width: number
  height: number
  title: string
  entries: number
  entryHeight: number
  listFrame: ReqBox
  boxLeft: number
  boxTop: number
  boxRight: number
  scroller: ReqBox
  /**
   * The bordered box naming the chosen mode. The comment above it in
   * `filereqsetup.c`:540 is the author's own: "Remove this one please. ;)"
   */
  modeName: ReqBox
  /** the overscan cycle gadget, absent without SCREQF_OVERSCANGAD */
  overscan: ReqBox | null
  overscanLabel: ReqLabel | null
  /** the Width and Height fields, absent without SCREQF_SIZEGADS */
  widthGad: ReqBox | null
  heightGad: ReqBox | null
  widthLabel: ReqLabel | null
  heightLabel: ReqLabel | null
  /** the two `Default` checkboxes that go with them */
  defWidth: ReqBox | null
  defHeight: ReqBox | null
  defWidthLabel: ReqLabel | null
  defHeightLabel: ReqLabel | null
  /** the colour readout, the slider and the `Max:` readout */
  colors: ReqBox | null
  colorsLabel: ReqLabel | null
  depth: ReqBox | null
  maxColors: ReqBox | null
  maxLabel: ReqLabel | null
  /** the autoscroll checkbox, absent without SCREQF_AUTOSCROLLGAD */
  autoScroll: ReqBox | null
  autoScrollLabel: ReqLabel | null
  /** Ok and Cancel, in that order */
  buttons: ReqGadget[]
}

/** the four labels the overscan cycle gadget rotates through */
export const RT_OSCAN_LABELS: readonly string[] = [RT_TEXT.regularSize, RT_TEXT.textSize, RT_TEXT.gfxSize, RT_TEXT.maxSize]

/** `graphics/view.i`: HAMF, and `defs.i`:165 spells the same bit `HAM` */
export const RT_MODE_HAM = 0x0800
/** EXTRA_HALFBRITE, `defs.i`:166 */
export const RT_MODE_EHB = 0x0080

/**
 * `BuildColStr`, `filereqextra.c`:1444.
 *
 * Not `1 << depth` in the general case: a HAM mode reads 4096 at depth 7 and
 * 16,777,216 at anything else, an EHB mode reads 64 whatever its depth, and
 * anything over four digits is divided down and suffixed. So the readout and
 * the number `=Ireq Scr Colour` answers are computed by two different rules
 * --- the extension does its own `moveq #$1,d0 / lsl.l d1,d0` at `$5bb8` and
 * never asks the library.
 */
export function rtBuildColStr(depth: number, id: number): string {
  let colors = 1 << depth
  if ((id & RT_MODE_HAM) !== 0) colors = colors === 128 ? 4096 : 16_777_216
  if ((id & RT_MODE_EHB) !== 0) colors = 64
  if (colors <= 9999) return String(colors)
  colors = Math.trunc(colors / 1024)
  if (colors <= 999) return `${colors}K`
  return `${Math.trunc(colors / 1024)}M`
}

/**
 * `filereqsetup.c`'s `SetupReqWindow`, the screenmode arm.
 *
 * The window width starts at a flat 276 --- `$7578 move.l #$114,$11c(a7)` ---
 * and only the gadget rows can widen it. Two things follow that are easy to
 * miss. The button row CANNOT widen it, because `val` is the screenmode
 * block's own working variable and the `width2 + (num2-1) * 8 + totaloff`
 * that the file and font arms compute lives in the branch this one skips; a
 * long RTSC_OkText therefore gets shrunk by `CheckGadgetsSize` rather than
 * given room. And the SIZEGADS row's demand is `widthheightlen +
 * StrWidth(Default) + dimgadwidth + 8 + 8 + checkw + 8 + 4 + totaloff`, whose
 * constant half the compiler folded into `$7608 moveq #$54,d1`: 12 + 8 + 8 +
 * 26 + 8 + 4 + 18 is 84, which is the third independent reading that puts
 * CHECKBOX_WIDTH at 26 and `totaloff` at 18. On topaz 8 the row asks for 260
 * and the flat 276 wins, so the extension's requester is 276 wide.
 */
export function screenReqLayout(setup: ScreenReqSetup, m: ReqMetrics): ScreenReqLayout {
  const spacing = rtSpacing(m.visibleHeight)
  const stdGad = m.fontHeight + 6
  const entryHeight = m.fontHeight + 1
  const leftoff = m.wBorLeft + 5
  const rightoff = m.wBorRight + 5
  const totaloff = leftoff + rightoff
  const startTop = m.wBorTop + m.screenFontHeight + 1 + spacing
  const width = (s: string): number => rtStrWidth(s, m.measure)
  const checkSkip = Math.max(RT_CHECKBOX_HEIGHT, m.fontHeight)
  const sizeGads = (setup.flags & SCREQF.SIZEGADS) !== 0
  const depthGad = (setup.flags & SCREQF.DEPTHGAD) !== 0
  const overscanGad = (setup.flags & SCREQF.OVERSCANGAD) !== 0
  const autoScrollGad = (setup.flags & SCREQF.AUTOSCROLLGAD) !== 0

  const defaultHeight = setup.height === 0
  const reqHeight = defaultHeight
    ? Math.trunc((RT_SCREENMODEREQ_PREFS.size * m.visibleHeight) / 100)
    : Math.min(setup.height, m.visibleHeight)

  // everything under the list, a flag at a time
  let below = stdGad + m.fontHeight + spacing * 2 + 8
  if (sizeGads) below += spacing + stdGad * 2 + Math.trunc(spacing / 2)
  if (depthGad) below += m.fontHeight + 3 + spacing
  if (overscanGad) below += stdGad + spacing
  if (autoScrollGad) below += checkSkip + spacing

  let entries = Math.trunc((reqHeight - below - startTop - RT_BOTTOM_BORDER) / entryHeight)
  const floor = defaultHeight ? RT_SCREENMODEREQ_PREFS.minEntries : 3
  if (entries < floor) entries = floor
  const ceiling = defaultHeight ? RT_SCREENMODEREQ_PREFS.maxEntries : 50
  if (entries > ceiling) entries = ceiling

  // `num1 = 4; num2 = 2; width1 = 0`, and `gadtxt[5] = gadtxt[7]` puts Cancel
  // in the second slot before the pair is measured
  const buttonText = [setup.okText, RT_TEXT.cancel]
  let width2 = buttonText.reduce((w, s) => Math.max(w, width(s) + 16), 0)
  const buttonLens = buttonText.map(() => width2)
  width2 *= 2

  // 38.1092 measures MSG_WIDTH alone; the two labels are padded to the same
  // ten characters so that is also MSG_HEIGHT's width
  const widthHeightLen = Math.max(width(RT_TEXT.width), overscanGad ? width(RT_TEXT.overscan) : 0)
  const dimGadWidth = width('000000') + 12
  let winWidth = 276
  let want = 0
  if (overscanGad) {
    const longest = RT_OSCAN_LABELS.reduce((w, s) => Math.max(w, width(s)), 0)
    want = longest + width(RT_TEXT.overscan) + 36 + 8 + totaloff + 2
  }
  if (sizeGads) {
    const bySize = widthHeightLen + width(RT_TEXT.default) + dimGadWidth + 8 + 8 + RT_CHECKBOX_WIDTH + 8 + 4 + totaloff
    if (bySize > want) want = bySize
  }
  if (want > winWidth) winWidth = want
  if (winWidth > m.visibleWidth) winWidth = m.visibleWidth

  width2 = checkGadgetsSize(buttonLens, width2, winWidth - totaloff)
  const buttonPos = rtSpread(buttonLens, width2, leftoff, winWidth - rightoff)

  let top = startTop
  const boxHeight = entries * entryHeight
  const listFrame = box(leftoff, top, winWidth - 18 - totaloff, boxHeight + 4)
  const boxLeft = leftoff + 2
  const boxTop = top + 2
  const boxRight = winWidth - 21 - rightoff
  const scroller = box(winWidth - 18 - rightoff, top, 18, boxHeight + 4)
  top += boxHeight + 4 + Math.trunc(spacing / 2)

  // `top -= spacing / 2` takes back the half-gap the shared code just added,
  // so the mode name sits straight under the list
  top -= Math.trunc(spacing / 2)
  const modeName = box(leftoff, top, winWidth - totaloff, m.fontHeight + 4)
  top += m.fontHeight + 4 + spacing

  let overscan: ReqBox | null = null
  let overscanLabel: ReqLabel | null = null
  if (overscanGad) {
    const at = width(RT_TEXT.overscan) + 8
    overscan = box(leftoff + 2 + at, top, winWidth - rightoff - leftoff - 2 - at, stdGad)
    overscanLabel = { text: rtLabelText(RT_TEXT.overscan, '_'), x: leftoff + 2, y: top + 3 }
    top += stdGad + spacing
  }

  let widthGad: ReqBox | null = null
  let heightGad: ReqBox | null = null
  let widthLabel: ReqLabel | null = null
  let heightLabel: ReqLabel | null = null
  let defWidth: ReqBox | null = null
  let defHeight: ReqBox | null = null
  let defWidthLabel: ReqLabel | null = null
  let defHeightLabel: ReqLabel | null = null
  if (sizeGads) {
    const at = widthHeightLen + 8 + leftoff + 2
    // `checktopoff` only applies on os30 and up, which this port is; the
    // pre-3.0 arm puts the checkbox one pixel down instead
    const checkTopOff = 3 - Math.trunc((RT_CHECKBOX_HEIGHT - m.fontHeight + 1) / 2)
    widthGad = box(at, top, dimGadWidth, stdGad)
    widthLabel = { text: rtLabelText(RT_TEXT.width, '_'), x: at - 8 - width(RT_TEXT.width), y: top + 3 }
    defWidth = box(at + dimGadWidth + 8, top + checkTopOff, RT_CHECKBOX_WIDTH, RT_CHECKBOX_HEIGHT)
    top += stdGad + Math.trunc(spacing / 2)
    defHeight = box(defWidth.x, top + checkTopOff, RT_CHECKBOX_WIDTH, RT_CHECKBOX_HEIGHT)
    heightGad = box(at, top, dimGadWidth, stdGad)
    heightLabel = { text: rtLabelText(RT_TEXT.height, '_'), x: at - 8 - width(RT_TEXT.height), y: top + 3 }
    // PLACETEXT_RIGHT: GadTools hangs the label off the box's right edge and
    // centres it on the box, which for an 11-pixel checkbox and topaz 8 is
    // one pixel down
    const labelY = (b: ReqBox): number => b.y + Math.trunc((b.h - m.fontHeight) / 2)
    defWidthLabel = { text: RT_TEXT.default, x: defWidth.x + RT_CHECKBOX_WIDTH + 4, y: labelY(defWidth) }
    defHeightLabel = { text: RT_TEXT.default, x: defHeight.x + RT_CHECKBOX_WIDTH + 4, y: labelY(defHeight) }
    top += stdGad + spacing
  }

  let colors: ReqBox | null = null
  let colorsLabel: ReqLabel | null = null
  let depth: ReqBox | null = null
  let maxColors: ReqBox | null = null
  let maxLabel: ReqLabel | null = null
  if (depthGad) {
    const gap = width(RT_TEXT.colors) + 8
    const maxLen = width(RT_TEXT.max)
    const readout = width('0000 ')
    colors = box(leftoff + 2 + gap, top, readout, m.fontHeight + 3)
    colorsLabel = { text: rtLabelText(RT_TEXT.colors, '_'), x: leftoff + 2, y: top + 2 }
    const sliderX = colors.x + readout + 8
    depth = box(sliderX, top, winWidth - 22 - rightoff - sliderX - readout - maxLen, m.fontHeight + 3)
    maxColors = box(depth.x + depth.w + maxLen + 20, top, readout, m.fontHeight + 3)
    maxLabel = { text: RT_TEXT.max, x: maxColors.x - 4 - maxLen, y: top + 2 }
    top += m.fontHeight + 3 + spacing
  }

  let autoScroll: ReqBox | null = null
  let autoScrollLabel: ReqLabel | null = null
  if (autoScrollGad) {
    const gap = width(RT_TEXT.autoScroll) + 8
    autoScroll = box(
      leftoff + 2 + gap,
      top + Math.trunc((checkSkip - RT_CHECKBOX_HEIGHT + 1) / 2),
      RT_CHECKBOX_WIDTH,
      RT_CHECKBOX_HEIGHT,
    )
    autoScrollLabel = {
      text: rtLabelText(RT_TEXT.autoScroll, '_'),
      x: leftoff + 2,
      y: top + Math.trunc((checkSkip - m.fontHeight + 1) / 2),
    }
    top += checkSkip + spacing
  }

  // the `i == num1` bump is guarded by `createstyle || (isfilereq &&
  // MULTISELECT)`, and neither holds here, so the buttons sit where the last
  // row left `top`
  const buttonHeight = m.fontHeight + 6
  const buttons: ReqGadget[] = buttonText.map((s, i) => {
    const under = i === 0 ? setup.underscore : '_'
    return {
      text: rtLabelText(s, under),
      box: box(buttonPos[i] ?? 0, top, buttonLens[i] ?? 0, buttonHeight),
      key: rtLabelKey(s, under),
    }
  })

  return {
    width: winWidth,
    height: top + buttonHeight + spacing + RT_BOTTOM_BORDER,
    title: setup.title,
    entries,
    entryHeight,
    listFrame,
    boxLeft,
    boxTop,
    boxRight,
    scroller,
    modeName,
    overscan,
    overscanLabel,
    widthGad,
    heightGad,
    widthLabel,
    heightLabel,
    defWidth,
    defHeight,
    defWidthLabel,
    defHeightLabel,
    colors,
    colorsLabel,
    depth,
    maxColors,
    maxLabel,
    autoScroll,
    autoScrollLabel,
    buttons,
  }
}

/** what a click on the screenmode requester landed on */
export type ScreenReqHit =
  | { kind: 'row'; index: number }
  | { kind: 'scroll'; delta: number }
  | { kind: 'button'; index: number }
  | { kind: 'defWidth' }
  | { kind: 'defHeight' }
  | { kind: 'overscan' }
  | { kind: 'autoScroll' }
  | { kind: 'depth'; at: number }
  | null

/**
 * Hit-test a click, window-relative.
 *
 * DEVIATION: the slider. GadTools drags the knob and pages a whole
 * `GTSL_Level` when a click misses it; this port has no drag, so a click on
 * the slider sets the level its x position names --- `min + (x - left) * (max
 * - min + 1) / w`, the inverse of where GadTools draws the knob. Every level
 * is therefore reachable in one click rather than in several.
 */
export function screenReqHit(l: ScreenReqLayout, x: number, y: number, min: number, max: number): ScreenReqHit {
  if (x >= l.boxLeft && x <= l.boxRight && y >= l.boxTop && y < l.boxTop + l.entries * l.entryHeight) {
    return { kind: 'row', index: Math.trunc((y - l.boxTop) / l.entryHeight) }
  }
  if (inBox(l.scroller, x, y)) {
    const arrow = l.entryHeight
    const upTop = l.scroller.y + l.scroller.h - 2 * arrow
    if (y >= upTop && y < upTop + arrow) return { kind: 'scroll', delta: -1 }
    if (y >= upTop + arrow) return { kind: 'scroll', delta: 1 }
    return { kind: 'scroll', delta: y < l.scroller.y + l.scroller.h / 2 ? -l.entries : l.entries }
  }
  for (let i = 0; i < l.buttons.length; i++) {
    const g = l.buttons[i]
    if (g && inBox(g.box, x, y)) return { kind: 'button', index: i }
  }
  if (l.defWidth && inBox(l.defWidth, x, y)) return { kind: 'defWidth' }
  if (l.defHeight && inBox(l.defHeight, x, y)) return { kind: 'defHeight' }
  if (l.overscan && inBox(l.overscan, x, y)) return { kind: 'overscan' }
  if (l.autoScroll && inBox(l.autoScroll, x, y)) return { kind: 'autoScroll' }
  if (l.depth && inBox(l.depth, x, y)) {
    const step = Math.trunc(((x - l.depth.x) * (max - min + 1)) / l.depth.w)
    return { kind: 'depth', at: Math.min(max, Math.max(min, min + step)) }
  }
  return null
}

/** the fields the renderer reads off the driver */
export interface ScreenReqFields {
  /** the highlighted row, -1 for none */
  selected: number
  /** what the mode box says, empty when nothing is chosen */
  modeName: string
  displayWidth: number
  displayHeight: number
  useDefWidth: boolean
  useDefHeight: boolean
  depth: number
  minDepth: number
  maxDepth: number
  /** the DisplayID, which is what decides whether the readout counts HAM */
  modeId: number
  overscan: number
  autoScroll: boolean
}

/**
 * Draw one.
 *
 * A SCRMODE row is a bare name: `PrintEntry` fills `sizestr` for a directory,
 * a file, a font, an assign and a volume, and a mode is none of those, so
 * nothing is appended and nothing is right-aligned at `boxright`.
 */
export function screenReqRender(
  rp: RastPort,
  dri: DrawInfo,
  l: ScreenReqLayout,
  rows: readonly ScreenRow[],
  first: number,
  f: ScreenReqFields,
  ox: number,
  oy: number,
): void {
  const bg = penOf(dri, PEN.BACKGROUND)
  const text = penOf(dri, PEN.TEXT)
  const fill = penOf(dri, PEN.FILL)
  const fillText = penOf(dri, PEN.FILLTEXT)
  const shine = penOf(dri, PEN.SHINE)
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
  const put = (t: ReqLabel | null): void => {
    if (t) label(t.text, t.x, t.y, text)
  }
  const measure = (s: string): number => (rp.font ? rp.textLength(s) : s.length * 8)
  const readout = (b: ReqBox | null, s: string): void => {
    if (!b) return
    flood(b, bg)
    bevel(b, true)
    label(s, b.x + Math.max(1, b.w - 3 - measure(s)), b.y + 2, text)
  }
  const check = (b: ReqBox | null, on: boolean): void => {
    if (!b) return
    flood(b, bg)
    bevel(b, true)
    if (!on) return
    // the tick GadTools draws inside a checked box, which this port renders
    // as the filled square the 2.0 look uses at this size
    rp.rectFill(b.x + ox + 3, b.y + oy + 2, b.x + ox + b.w - 4, b.y + oy + b.h - 3, fillText)
  }

  flood(box(0, 0, l.width, l.height), bg)

  bevel(l.listFrame, true)
  for (let i = 0; i < l.entries; i++) {
    const e = rows[first + i]
    const y = l.boxTop + i * l.entryHeight
    const chosen = first + i === f.selected
    rp.rectFill(l.boxLeft + ox, y + oy, l.boxRight + ox, y + l.entryHeight - 1 + oy, chosen ? fill : bg)
    if (!e) continue
    label(e.name, l.boxLeft + 2, y, chosen ? fillText : text)
  }
  bevel(l.scroller, true)

  flood(l.modeName, bg)
  bevel(l.modeName, true)
  label(f.modeName, l.modeName.x + 3, l.modeName.y + 2, text)

  if (l.overscan) {
    flood(l.overscan, bg)
    bevel(l.overscan, false)
    label(RT_OSCAN_LABELS[f.overscan] ?? '', l.overscan.x + 4, l.overscan.y + 3, text)
    put(l.overscanLabel)
  }

  if (l.widthGad && l.heightGad) {
    readout(l.widthGad, String(f.displayWidth))
    readout(l.heightGad, String(f.displayHeight))
    put(l.widthLabel)
    put(l.heightLabel)
    check(l.defWidth, f.useDefWidth)
    check(l.defHeight, f.useDefHeight)
    put(l.defWidthLabel)
    put(l.defHeightLabel)
  }

  if (l.depth) {
    readout(l.colors, rtBuildColStr(f.depth, f.modeId))
    put(l.colorsLabel)
    flood(l.depth, bg)
    bevel(l.depth, true)
    // the knob: `GTSL_Max - GTSL_Min + 1` positions across the inside of the
    // container, which is how GadTools sizes a proportional gadget's body
    const steps = Math.max(1, f.maxDepth - f.minDepth + 1)
    const knob = Math.max(4, Math.trunc((l.depth.w - 4) / steps))
    const at = Math.trunc(((f.depth - f.minDepth) * (l.depth.w - 4 - knob)) / Math.max(1, steps - 1))
    rp.rectFill(
      l.depth.x + 2 + at + ox,
      l.depth.y + 2 + oy,
      l.depth.x + 2 + at + knob - 1 + ox,
      l.depth.y + l.depth.h - 3 + oy,
      shine,
    )
    put(l.maxLabel)
    readout(l.maxColors, rtBuildColStr(f.maxDepth, f.modeId))
  }

  if (l.autoScroll) {
    check(l.autoScroll, f.autoScroll)
    put(l.autoScrollLabel)
  }

  for (const g of l.buttons) {
    flood(g.box, bg)
    bevel(g.box, false)
    label(g.text, g.box.x + Math.max(1, Math.trunc((g.box.w - measure(g.text)) / 2)), g.box.y + 3, text)
  }
  rp.restore(save)
}

/* --------------------------------------------------------------------------
 * The palette requester
 *
 * `rtPaletteRequestA` is the one requester in this library with a window of
 * its own: `palettereq.c`'s `SetupPalWindow` shares nothing with
 * `SetupReqWindow`. It is a GadTools PALETTE_KIND over three sliders, with
 * Copy, Swap and Spread above and Ok, Undo and Cancel below.
 *
 * 38.1092 is a version BEHIND the sources here in one visible way. Catalog
 * ids `$134` to `$136` --- `Copy to...`, `Swap with...` and `Spread to...`,
 * the titles the later build flashes while it waits for the second click ---
 * are not in the binary at all, so nothing here changes the title bar when a
 * mode is armed. The mode is still armed; it is just not announced.
 * ----------------------------------------------------------------------- */

/**
 * `MakeColVal`, `palettereq.c`:201: spread an n-bit gun value up a 32-bit
 * word by repeating it.
 *
 * SetRGB32 wants 32 bits a gun, and a 4-bit `$f` has to become `$ffffffff`
 * rather than `$f0000000` or white comes out nearly black. The loop shifts a
 * copy down by `bits` each time and ORs, so 4 bits are repeated eight times
 * and 8 bits four times.
 */
export function rtMakeColVal(val: number, bits: number): number {
  let out = (val << (32 - bits)) >>> 0
  let rest = out
  for (;;) {
    rest = rest >>> bits
    if (rest === 0) break
    out = (out | rest) >>> 0
  }
  return out >>> 0
}

/** GTPA_IndicatorWidth, and `SetupPalWindow` passes a flat 38 */
export const RT_PALETTE_INDICATOR = 38

/** what a palette request asks for, after its tag list has been read */
export interface PaletteReqSetup {
  /** `rtPaletteRequestA`'s a2 */
  title: string
  /** RTPA_Color, and `PaletteRequestA` sets 1 before it reads the tags */
  color: number
  /** `GetVpCM`'s answer: the screen's colour depth, so `1 << depth` swatches */
  depth: number
  /** DisplayInfo's RedBits, GreenBits and BlueBits */
  bits: readonly [number, number, number]
}

export interface PaletteReqLayout {
  width: number
  height: number
  title: string
  /** `_Palette Colors:`, centred over the palette gadget */
  colorsLabel: ReqLabel
  /** the whole PALETTE_KIND gadget, indicator and grid together */
  palette: ReqBox
  /** GTPA_IndicatorWidth 38: the block showing the colour now selected */
  indicator: ReqBox
  /** the swatch grid, and how it is divided */
  grid: ReqBox
  rows: number
  cols: number
  /** Copy, Swap and Spread */
  modes: ReqGadget[]
  /** the Red, Green and Blue sliders, their labels and their readouts */
  sliders: ReqBox[]
  sliderLabels: ReqLabel[]
  levels: ReqBox[]
  /** Ok, Undo and Cancel */
  buttons: ReqGadget[]
}

/**
 * `SetupPalWindow`, `palettereq.c`:921.
 *
 * The 25 pixels the palette gadget and the top button row are indented by are
 * the colour wheel's old seat: `wheeloff` is added on top of them when a
 * wheel is built, and 38.1092 has no wheel to build, so the 25 stands alone
 * and nothing fills it. 256 is the floor under the window width, and on topaz
 * 8 the arithmetic asks for 251, so the floor is what decides it.
 *
 * The palette gadget's height is `fontheight * 2 + 4`, DOUBLED at 64 colours
 * and doubled again at 128. Those two multipliers are the row count: a
 * four-row grid needs four times the height of a one-row grid, which is how
 * the swatch layout can be read off a height calculation.
 */
export function paletteReqLayout(setup: PaletteReqSetup, m: ReqMetrics): PaletteReqLayout {
  const spacing = rtSpacing(m.visibleHeight)
  const leftoff = m.wBorLeft + 5
  const rightoff = m.wBorRight + 5
  const width = (s: string): number => rtStrWidth(s, m.measure)
  let top = m.wBorTop + m.screenFontHeight + 1 + Math.trunc(spacing / 2) + 1

  const modeText = [RT_TEXT.copy, RT_TEXT.swap, RT_TEXT.spread]
  const buttonText = [RT_TEXT.ok, RT_TEXT.undo, RT_TEXT.cancel]
  let width1 = modeText.reduce((w, s) => Math.max(w, width(s) + 16), 0)
  let width2 = buttonText.reduce((w, s) => Math.max(w, width(s) + 16), 0)
  const modeLens = modeText.map(() => width1)
  const buttonLens = buttonText.map(() => width2)
  width1 *= 3
  width2 *= 3

  let winWidth = leftoff + rightoff + 25 + width1 + 2 * 8
  const byButtons = leftoff + rightoff + width2 + 2 * 8
  if (byButtons > winWidth) winWidth = byButtons
  if (winWidth < 256) winWidth = 256

  const colCount = 1 << setup.depth
  let palHeight = m.fontHeight * 2 + 4
  if (colCount >= 64) palHeight *= 2
  if (colCount >= 128) palHeight *= 2
  const rows = colCount >= 128 ? 4 : colCount >= 64 ? 2 : 1
  const cols = Math.max(1, Math.trunc(colCount / rows))

  const modePos = rtSpread(modeLens, width1, leftoff + 25, winWidth - rightoff)
  const buttonPos = rtSpread(buttonLens, width2, leftoff, winWidth - rightoff)

  // the label is centred in what is left of the window once the 25-pixel
  // indent is taken off the left
  const colorsText = RT_TEXT.paletteColors
  const colorsLabel: ReqLabel = {
    text: rtLabelText(colorsText, '_'),
    x: leftoff + 25 + Math.trunc((winWidth - (leftoff + rightoff + 25) - width(colorsText)) / 2),
    y: top,
  }
  top += m.fontHeight + 1 + Math.trunc(spacing / 2)

  const palette = box(leftoff + 25, top, winWidth - (leftoff + rightoff + 25), palHeight)
  const indicator = box(palette.x, palette.y, RT_PALETTE_INDICATOR, palHeight)
  const grid = box(palette.x + RT_PALETTE_INDICATOR, palette.y, palette.w - RT_PALETTE_INDICATOR, palHeight)
  top += palHeight + spacing

  const buttonHeight = m.fontHeight + 6
  const modes: ReqGadget[] = modeText.map((s, i) => ({
    text: rtLabelText(s, '_'),
    box: box(modePos[i] ?? 0, top, modeLens[i] ?? 0, buttonHeight),
    key: rtLabelKey(s, '_'),
  }))
  top += buttonHeight + spacing

  const gunText = [RT_TEXT.red, RT_TEXT.green, RT_TEXT.blue]
  const levelWidth = width('000 ')
  const gunWidth = gunText.reduce((w, s) => Math.max(w, width(s)), 0) + levelWidth
  const sliderX = leftoff + 2 + gunWidth + 8
  const sliders: ReqBox[] = []
  const sliderLabels: ReqLabel[] = []
  const levels: ReqBox[] = []
  for (let i = 0; i < 3; i++) {
    sliders.push(box(sliderX, top, winWidth - sliderX - rightoff, m.fontHeight + 6))
    sliderLabels.push({ text: rtLabelText(gunText[i]!, '_'), x: leftoff + 2, y: top + 2 })
    // GTSL_LevelPlace PLACETEXT_LEFT with GTSL_MaxPixelLen `levelwidth`: the
    // number sits in its own box immediately left of the slider
    levels.push(box(sliderX - levelWidth, top, levelWidth, m.fontHeight + 6))
    top += m.fontHeight + 6 + Math.trunc(spacing / 2)
  }
  top += Math.trunc(spacing / 2)

  const buttons: ReqGadget[] = buttonText.map((s, i) => ({
    text: rtLabelText(s, '_'),
    box: box(buttonPos[i] ?? 0, top, buttonLens[i] ?? 0, buttonHeight),
    key: rtLabelKey(s, '_'),
  }))
  top += buttonHeight + spacing

  return {
    width: winWidth,
    height: top + m.wBorBottom,
    title: setup.title,
    colorsLabel,
    palette,
    indicator,
    grid,
    rows,
    cols,
    modes,
    sliders,
    sliderLabels,
    levels,
    buttons,
  }
}

/** what a click on the palette requester landed on */
export type PaletteReqHit =
  | { kind: 'cell'; index: number }
  | { kind: 'mode'; index: number }
  | { kind: 'slider'; gun: number; at: number }
  | { kind: 'button'; index: number }
  | null

/**
 * Hit-test a click, window-relative.
 *
 * The same DEVIATION the screenmode slider carries: a click sets the level
 * its x position names rather than dragging a knob, because nothing in this
 * port tracks a drag. `max` is the gun's own `maxcolval`, which is
 * `(1 << bits) - 1`.
 */
export function paletteReqHit(l: PaletteReqLayout, x: number, y: number, maxLevel: readonly number[]): PaletteReqHit {
  if (inBox(l.grid, x, y)) {
    const cw = l.grid.w / l.cols
    const ch = l.grid.h / l.rows
    const col = Math.min(l.cols - 1, Math.trunc((x - l.grid.x) / cw))
    const row = Math.min(l.rows - 1, Math.trunc((y - l.grid.y) / ch))
    return { kind: 'cell', index: row * l.cols + col }
  }
  for (let i = 0; i < l.modes.length; i++) {
    const g = l.modes[i]
    if (g && inBox(g.box, x, y)) return { kind: 'mode', index: i }
  }
  for (let i = 0; i < l.buttons.length; i++) {
    const g = l.buttons[i]
    if (g && inBox(g.box, x, y)) return { kind: 'button', index: i }
  }
  for (let i = 0; i < l.sliders.length; i++) {
    const b = l.sliders[i]
    if (!b || !inBox(b, x, y)) continue
    const max = maxLevel[i] ?? 15
    const at = Math.trunc(((x - b.x) * (max + 1)) / b.w)
    return { kind: 'slider', gun: i, at: Math.min(max, Math.max(0, at)) }
  }
  return null
}

/**
 * Draw one.
 *
 * The swatches are drawn in the screen's OWN pens, which is the point of the
 * requester: `SetColor` writes the viewport as the slider moves, so what the
 * grid shows is the live palette and not a copy of it.
 *
 * An armed Copy, Swap or Spread is drawn no differently from an unarmed one.
 * The later build flashes `Copy to...` in the title bar while it waits for
 * the second click; 38.1092 does not carry those three strings, so there is
 * nothing to put there and the mode is invisible until it fires.
 */
export function paletteReqRender(
  rp: RastPort,
  dri: DrawInfo,
  l: PaletteReqLayout,
  fields: { color: number; levels: readonly number[]; maxLevels: readonly number[] },
  ox: number,
  oy: number,
): void {
  const bg = penOf(dri, PEN.BACKGROUND)
  const text = penOf(dri, PEN.TEXT)
  const shine = penOf(dri, PEN.SHINE)
  const highlight = penOf(dri, PEN.HIGHLIGHTTEXT)
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
  const measure = (s: string): number => (rp.font ? rp.textLength(s) : s.length * 8)

  flood(box(0, 0, l.width, l.height), bg)
  label(l.colorsLabel.text, l.colorsLabel.x, l.colorsLabel.y, highlight)

  // the indicator carries the selected pen, the grid carries all of them
  flood(l.indicator, fields.color)
  bevel(l.indicator, true)
  const cw = l.grid.w / l.cols
  const ch = l.grid.h / l.rows
  for (let i = 0; i < l.rows * l.cols; i++) {
    const cx = l.grid.x + Math.trunc((i % l.cols) * cw)
    const cy = l.grid.y + Math.trunc(Math.trunc(i / l.cols) * ch)
    const cx2 = l.grid.x + Math.trunc(((i % l.cols) + 1) * cw) - 1
    const cy2 = l.grid.y + Math.trunc((Math.trunc(i / l.cols) + 1) * ch) - 1
    rp.rectFill(cx + ox, cy + oy, cx2 + ox, cy2 + oy, i)
  }
  bevel(l.grid, true)

  for (const g of l.modes) {
    flood(g.box, bg)
    bevel(g.box, false)
    label(g.text, g.box.x + Math.max(1, Math.trunc((g.box.w - measure(g.text)) / 2)), g.box.y + 3, text)
  }

  for (let i = 0; i < 3; i++) {
    const s = l.sliders[i]!
    const lv = l.levels[i]!
    label(l.sliderLabels[i]!.text, l.sliderLabels[i]!.x, l.sliderLabels[i]!.y, highlight)
    // `GTSL_LevelFormat "%3ld"` with GTJ_RIGHT: three columns, right-aligned
    const shown = rtFormat(RT_TEXT.sliderFmt, fields.levels[i] ?? 0)
    label(shown, lv.x + Math.max(0, lv.w - 4 - measure(shown)), lv.y + 3, text)
    flood(s, bg)
    bevel(s, true)
    const knob = 8
    const span = Math.max(1, s.w - 4 - knob)
    const at = Math.trunc(((fields.levels[i] ?? 0) * span) / Math.max(1, fields.maxLevels[i] ?? 15))
    rp.rectFill(s.x + 2 + at + ox, s.y + 2 + oy, s.x + 2 + at + knob - 1 + ox, s.y + s.h - 3 + oy, shine)
  }

  for (const g of l.buttons) {
    flood(g.box, bg)
    bevel(g.box, false)
    label(g.text, g.box.x + Math.max(1, Math.trunc((g.box.w - measure(g.text)) / 2)), g.box.y + 3, text)
  }
  rp.restore(save)
}
