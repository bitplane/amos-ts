/**
 * asl.library's requesters — the file one, and the shells of the other two.
 *
 * ## What is sourced here, and what is not
 *
 * `asl.library` itself is in the corpus in seven files spanning three distinct
 * releases. The highest, WB 3.0's 39.4 (18.8.92), is an ordinary hunk binary.
 * Every
 * STRING below is read out of it and quoted as it is spelled there: the
 * default titles at $5b82, $5b24 and $5966, the field labels at $5b9e, $5ba6
 * and $5bac, and the buttons at $5b8e, $5b96, $5ca0 and $5ca6. The library
 * opens `topaz.font` ($188), which is why every measurement here is in eights.
 *
 * The tag numbers are the header's, from `MUI.Equates` in EasyLife 1.10's
 * archive, which is the only file in the corpus that spells them out.
 *
 * **THE PIXEL LAYOUT IS MODELLED.** asl.library computes it at run time from
 * the font and the requester's size across some forty kilobytes, and none of
 * that is ported. What is here puts the same widgets in the same order at the
 * same edges, sized to the same font, and it will not be pixel-exact against
 * a real 39.4. This is the sentence that says so, and it is the same
 * admission ./intuition.ts makes about its two window gadgets.
 */
import { drawBevelBox, penOf, PEN, type DrawInfo } from './gadtools'
import { MODE_KEY } from './displayinfo'
import type { RastPort } from './graphics'

/** the three `AllocAslRequest` types, `MUI.Equates`: ASL_FileRequest and friends */
export const ASL_TYPE = { FILE: 0, FONT: 1, SCREENMODE: 2 } as const

/**
 * The tags Int 1.0 passes, at their header numbers.
 *
 * Int's own list is fourteen of them at `$c12(a4)`, built from a template in
 * its code hunk at file offset `0x12fc` — `extdis int-1.0 "wb asl req"` fills
 * in the values and never the tags.
 */
export const ASL_TAG = {
  HAIL: 0x8008_0001,
  WINDOW: 0x8008_0002,
  LEFTEDGE: 0x8008_0003,
  TOPEDGE: 0x8008_0004,
  WIDTH: 0x8008_0005,
  HEIGHT: 0x8008_0006,
  FILE: 0x8008_0008,
  DIR: 0x8008_0009,
  PATTERN: 0x8008_000a,
  OKTEXT: 0x8008_0012,
  CANCELTEXT: 0x8008_0013,
  FUNCFLAGS: 0x8008_0014,
  FR_SCREEN: 0x8008_0028,
  FR_DOPATTERNS: 0x8008_002e,
  FR_REJECTICONS: 0x8008_003c,
} as const

/**
 * Every word the requester puts on the screen, spelled as asl 39.4 spells it.
 *
 * `Select File` is the title when nothing passes ASL_Hail, and the two button
 * texts are the defaults ASL_OKText and ASL_CancelText replace.
 */
export const ASL_TEXT = {
  fileTitle: 'Select File',
  fontTitle: 'Select Font',
  modeTitle: 'Select Screen Mode',
  volumes: 'Volumes',
  parent: 'Parent',
  drawer: 'Drawer',
  file: 'File',
  pattern: 'Pattern',
  ok: 'OK',
  cancel: 'Cancel',
  /**
   * The preview line, 66 characters at $2fc and quoted as it is spelled
   * there. This is what the real requester draws in the face you have picked,
   * and it is the whole reason the font one is worth having: a list of names
   * tells you nothing a directory does not.
   */
  fontSample: '123 AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz!@#$%^&*()',
  name: 'Name',
  /**
   * The screen-mode requester's own vocabulary, all of it between $5966 and
   * $5a14 and spelled as asl 39.4 spells it --- `Colors:` with the American
   * spelling, two spaces before the colon in the size line, and a real
   * multiplication sign rather than an x.
   */
  modeProperties: 'Mode Properties',
  visibleSize: 'Visible Size  : %5lu \u00d7 %5lu',
  maximumColors: 'Maximum Colors: %lu',
  interlaced: 'Interlaced',
  holdAndModify: 'Hold & Modify',
  extraHalfBright: 'Extra-HalfBright',
  width: 'Width:',
  height: 'Height:',
  colors: 'Colors:',
} as const

/** fill one of asl's `%lu` formats, which is all this port needs of printf */
export function aslFormat(fmt: string, ...args: number[]): string {
  let i = 0
  return fmt.replace(/%(\d*)lu/g, (_m, w: string) => {
    const v = String(args[i++] ?? 0)
    return w === '' ? v : v.padStart(Number(w), ' ')
  })
}

/** one line of the list: a name, and whether it is a drawer */
export interface AslRow {
  name: string
  dir: boolean
  size: number
}

/** what a caller asks for, after the tag list has been read */
export interface AslFileSetup {
  hail: string
  okText: string
  cancelText: string
  left: number
  top: number
  width: number
  height: number
  dir: string
  file: string
  pattern: string
  /** ASLFR_REJECTICONS: Int's `Wb Asl Info`, "1= Dont Show Info Files" */
  rejectIcons: boolean
  /** ASLFR_DOPATTERNS: whether the Pattern field is there at all */
  doPatterns: boolean
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface AslLayout {
  /** the whole inner area, window-relative */
  inner: Box
  list: Box
  /** how many names fit in `list` */
  visible: number
  scrollUp: Box
  scrollDown: Box
  scrollTrack: Box
  drawer: Box
  file: Box
  pattern: Box | null
  ok: Box
  volumes: Box
  parent: Box
  cancel: Box
}

/** topaz 8, which is the face asl.library opens */
export const ASL_FONT_HEIGHT = 8
const ROW = ASL_FONT_HEIGHT + 4
const GAP = 2
/** "Pattern" is the widest of the three labels, at seven characters */
const LABEL_W = 8 * 8
/** the bevel around the list is one pixel, and a glyph must not sit on it */
const LIST_INSET = 2

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

/**
 * Where everything goes inside a requester of this size.
 *
 * MODELLED, see the file header. The order down the window is the real one:
 * the list, then Drawer, then File, then Pattern when it is asked for, then
 * the four buttons along the bottom.
 */
export function aslLayout(setup: AslFileSetup, borderLeft: number, borderTop: number, borderRight: number, borderBottom: number): AslLayout {
  const iw = Math.max(80, setup.width - borderLeft - borderRight)
  const ih = Math.max(60, setup.height - borderTop - borderBottom)
  const inner = box(borderLeft, borderTop, iw, ih)
  const fields = setup.doPatterns ? 3 : 2
  const bottom = fields * (ROW + GAP) + ROW + GAP * 2
  const listH = Math.max(ROW, ih - bottom)
  const barW = 14
  const list = box(inner.x + GAP, inner.y + GAP, iw - GAP * 3 - barW, listH - GAP)
  const arrow = 10
  const trackH = Math.max(arrow, list.h - arrow * 2)
  const barX = list.x + list.w + GAP
  const scrollTrack = box(barX, list.y, barW, trackH)
  const scrollUp = box(barX, list.y + trackH, barW, arrow)
  const scrollDown = box(barX, list.y + trackH + arrow, barW, arrow)

  let y = inner.y + listH + GAP
  const fieldW = iw - LABEL_W - GAP * 2
  const drawer = box(inner.x + LABEL_W, y, fieldW, ROW)
  y += ROW + GAP
  const file = box(inner.x + LABEL_W, y, fieldW, ROW)
  y += ROW + GAP
  let pattern: Box | null = null
  if (setup.doPatterns) {
    pattern = box(inner.x + LABEL_W, y, fieldW, ROW)
    y += ROW + GAP
  }
  // four buttons across the bottom, evenly and with the gaps taken off first
  const bw = Math.floor((iw - GAP * 5) / 4)
  const by = inner.y + ih - ROW - GAP
  const bx = (n: number): number => inner.x + GAP + n * (bw + GAP)
  return {
    inner,
    list,
    visible: Math.max(1, Math.floor((list.h - LIST_INSET * 2) / ASL_FONT_HEIGHT)),
    scrollUp,
    scrollDown,
    scrollTrack,
    drawer,
    file,
    pattern,
    ok: box(bx(0), by, bw, ROW),
    volumes: box(bx(1), by, bw, ROW),
    parent: box(bx(2), by, bw, ROW),
    cancel: box(bx(3), by, bw, ROW),
  }
}

/** what a click landed on */
export type AslAction =
  | { kind: 'row'; index: number }
  | { kind: 'scroll'; delta: number }
  | { kind: 'ok' }
  | { kind: 'cancel' }
  | { kind: 'parent' }
  | { kind: 'volumes' }
  | null

const inBox = (b: Box, x: number, y: number): boolean => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h

/** which widget a window-relative point is over */
export function aslHit(l: AslLayout, x: number, y: number): AslAction {
  if (inBox(l.list, x, y)) return { kind: 'row', index: Math.floor((y - l.list.y - LIST_INSET) / ASL_FONT_HEIGHT) }
  if (inBox(l.scrollUp, x, y)) return { kind: 'scroll', delta: -1 }
  if (inBox(l.scrollDown, x, y)) return { kind: 'scroll', delta: 1 }
  if (inBox(l.ok, x, y)) return { kind: 'ok' }
  if (inBox(l.cancel, x, y)) return { kind: 'cancel' }
  if (inBox(l.parent, x, y)) return { kind: 'parent' }
  if (inBox(l.volumes, x, y)) return { kind: 'volumes' }
  return null
}

/**
 * Draw the whole requester into a window's RastPort.
 *
 * `ox`/`oy` are the window's origin on the screen, which is what a real
 * RPort's Layer would apply.
 */
export function aslRender(
  rp: RastPort,
  dri: DrawInfo,
  setup: AslFileSetup,
  l: AslLayout,
  rows: readonly AslRow[],
  top: number,
  selected: number,
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

  const at = (b: Box): Box => box(b.x + ox, b.y + oy, b.w, b.h)
  const flood = (b: Box, pen: number): void => {
    const r = at(b)
    rp.rectFill(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, pen)
  }
  const bevel = (b: Box, recessed: boolean): void => {
    const r = at(b)
    drawBevelBox(rp, r.x, r.y, r.w, r.h, dri, { recessed })
  }
  const label = (s: string, x: number, y: number, pen: number): void => {
    if (rp.font) rp.text(x + ox, y + oy + rp.font.baseline, s, pen)
  }

  flood(l.inner, bg)

  // the list, recessed, with the selected line in FILLPEN
  flood(l.list, bg)
  bevel(l.list, true)
  for (let i = 0; i < l.visible; i++) {
    const r = rows[top + i]
    if (!r) break
    const ry = l.list.y + LIST_INSET + i * ASL_FONT_HEIGHT
    if (top + i === selected) {
      flood(box(l.list.x + 1, ry, l.list.w - 2, ASL_FONT_HEIGHT), fill)
    }
    // a drawer is named in brackets, which is how every Amiga lister has
    // marked one since the Workbench did
    const name = r.dir ? `(${r.name})` : r.name
    label(name, l.list.x + LIST_INSET, ry, top + i === selected ? fillText : text)
  }
  bevel(l.scrollTrack, true)
  bevel(l.scrollUp, false)
  bevel(l.scrollDown, false)

  const field = (b: Box, name: string, value: string): void => {
    label(name, l.inner.x + 2, b.y + 2, text)
    flood(b, bg)
    bevel(b, true)
    label(value, b.x + 3, b.y + 2, text)
  }
  field(l.drawer, ASL_TEXT.drawer, setup.dir)
  field(l.file, ASL_TEXT.file, setup.file)
  if (l.pattern) field(l.pattern, ASL_TEXT.pattern, setup.pattern)

  const button = (b: Box, s: string): void => {
    flood(b, bg)
    bevel(b, false)
    const w = rp.font ? rp.textLength(s) : s.length * 8
    label(s, b.x + Math.max(1, Math.floor((b.w - w) / 2)), b.y + 2, text)
  }
  button(l.ok, setup.okText === '' ? ASL_TEXT.ok : setup.okText)
  button(l.volumes, ASL_TEXT.volumes)
  button(l.parent, ASL_TEXT.parent)
  button(l.cancel, setup.cancelText === '' ? ASL_TEXT.cancel : setup.cancelText)
  rp.restore(save)
}


/* --------------------------------------------------------------------------
 * The font requester
 *
 * A second layout on the same frame. asl.library opens `diskfont.library`
 * ($346) and scans `FONTS:` ($2f0) for it, and GUI 2.10 asks for it with a
 * ONE-tag list -- routine 56 writes `move.l #$80080002,(a1)`, ASL_Window, and
 * a TAG_DONE after it -- so there are no pen, style or draw-mode gadgets to
 * put on this one. A name list, a size list, the two fields under them, the
 * sample line, and the two buttons.
 * ----------------------------------------------------------------------- */

/** what a font request asks for, after its tag list has been read */
export interface AslFontSetup {
  hail: string
  okText: string
  cancelText: string
  left: number
  top: number
  width: number
  height: number
  name: string
  size: number
}

export interface AslFontLayout {
  inner: Box
  names: Box
  sizes: Box
  visible: number
  nameUp: Box
  nameDown: Box
  sizeUp: Box
  sizeDown: Box
  nameField: Box
  sizeField: Box
  sample: Box
  ok: Box
  cancel: Box
}

/** the size column, wide enough for three digits and its own bevel */
const SIZE_W = 8 * 5

export function aslFontLayout(
  setup: AslFontSetup,
  borderLeft: number,
  borderTop: number,
  borderRight: number,
  borderBottom: number,
): AslFontLayout {
  const iw = Math.max(120, setup.width - borderLeft - borderRight)
  const ih = Math.max(80, setup.height - borderTop - borderBottom)
  const inner = box(borderLeft, borderTop, iw, ih)
  // from the bottom: buttons, sample, then the two fields on one row
  const bottom = ROW * 3 + GAP * 4
  const listH = Math.max(ROW, ih - bottom)
  const arrow = 10
  const barW = 14
  const namesW = iw - SIZE_W - barW * 2 - GAP * 5
  const names = box(inner.x + GAP, inner.y + GAP, namesW, listH - GAP)
  const nameBar = names.x + names.w + GAP
  const sizes = box(nameBar + barW + GAP, names.y, SIZE_W, names.h)
  const sizeBar = sizes.x + sizes.w + GAP
  let y = inner.y + listH + GAP
  const fieldW = Math.max(8 * 6, namesW - 8 * 5)
  const nameField = box(inner.x + GAP + 8 * 5, y, fieldW, ROW)
  const sizeField = box(sizes.x, y, SIZE_W + barW, ROW)
  y += ROW + GAP
  const sample = box(inner.x + GAP, y, iw - GAP * 2, ROW)
  y += ROW + GAP
  const bw = Math.floor((iw - GAP * 3) / 2)
  return {
    inner,
    names,
    sizes,
    visible: Math.max(1, Math.floor((names.h - LIST_INSET * 2) / ASL_FONT_HEIGHT)),
    nameUp: box(nameBar, names.y + names.h - arrow * 2, barW, arrow),
    nameDown: box(nameBar, names.y + names.h - arrow, barW, arrow),
    sizeUp: box(sizeBar, names.y + names.h - arrow * 2, barW, arrow),
    sizeDown: box(sizeBar, names.y + names.h - arrow, barW, arrow),
    nameField,
    sizeField,
    sample,
    ok: box(inner.x + GAP, y, bw, ROW),
    cancel: box(inner.x + GAP * 2 + bw, y, bw, ROW),
  }
}

export type AslFontAction =
  | { kind: 'name'; index: number }
  | { kind: 'size'; index: number }
  | { kind: 'scrollNames'; delta: number }
  | { kind: 'scrollSizes'; delta: number }
  | { kind: 'ok' }
  | { kind: 'cancel' }
  | null

export function aslFontHit(l: AslFontLayout, x: number, y: number): AslFontAction {
  if (inBox(l.names, x, y)) return { kind: 'name', index: Math.floor((y - l.names.y - LIST_INSET) / ASL_FONT_HEIGHT) }
  if (inBox(l.sizes, x, y)) return { kind: 'size', index: Math.floor((y - l.sizes.y - LIST_INSET) / ASL_FONT_HEIGHT) }
  if (inBox(l.nameUp, x, y)) return { kind: 'scrollNames', delta: -1 }
  if (inBox(l.nameDown, x, y)) return { kind: 'scrollNames', delta: 1 }
  if (inBox(l.sizeUp, x, y)) return { kind: 'scrollSizes', delta: -1 }
  if (inBox(l.sizeDown, x, y)) return { kind: 'scrollSizes', delta: 1 }
  if (inBox(l.ok, x, y)) return { kind: 'ok' }
  if (inBox(l.cancel, x, y)) return { kind: 'cancel' }
  return null
}

/**
 * Draw the font requester. `sampleFont` is the face the preview line is drawn
 * in, which is the one thing here that has to be a real font rather than a
 * string --- null falls back to the RastPort's own, which is what a face this
 * port cannot open leaves it as.
 */
export function aslFontRender(
  rp: RastPort,
  dri: DrawInfo,
  setup: AslFontSetup,
  l: AslFontLayout,
  names: readonly string[],
  sizes: readonly number[],
  nameTop: number,
  sizeTop: number,
  nameSel: number,
  sizeSel: number,
  sampleFont: RastPort['font'],
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

  const at = (b: Box): Box => box(b.x + ox, b.y + oy, b.w, b.h)
  const flood = (b: Box, pen: number): void => {
    const r = at(b)
    rp.rectFill(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, pen)
  }
  const bevel = (b: Box, recessed: boolean): void => {
    const r = at(b)
    drawBevelBox(rp, r.x, r.y, r.w, r.h, dri, { recessed })
  }
  const label = (s: string, x: number, y: number, pen: number): void => {
    if (rp.font) rp.text(x + ox, y + oy + rp.font.baseline, s, pen)
  }

  flood(l.inner, bg)
  const column = (b: Box, rows: readonly string[], top: number, sel: number): void => {
    flood(b, bg)
    bevel(b, true)
    for (let i = 0; i < l.visible; i++) {
      const r = rows[top + i]
      if (r === undefined) break
      const ry = b.y + LIST_INSET + i * ASL_FONT_HEIGHT
      if (top + i === sel) flood(box(b.x + 1, ry, b.w - 2, ASL_FONT_HEIGHT), fill)
      label(r, b.x + LIST_INSET, ry, top + i === sel ? fillText : text)
    }
  }
  column(l.names, names, nameTop, nameSel)
  column(l.sizes, sizes.map(String), sizeTop, sizeSel)
  bevel(l.nameUp, false)
  bevel(l.nameDown, false)
  bevel(l.sizeUp, false)
  bevel(l.sizeDown, false)

  label(ASL_TEXT.name, l.inner.x + 2, l.nameField.y + 2, text)
  flood(l.nameField, bg)
  bevel(l.nameField, true)
  label(setup.name, l.nameField.x + 3, l.nameField.y + 2, text)
  flood(l.sizeField, bg)
  bevel(l.sizeField, true)
  label(String(setup.size), l.sizeField.x + 3, l.sizeField.y + 2, text)

  // the preview, in the chosen face. The clip has to go back afterwards: a
  // sample narrowed to its own box and left there clips everything drawn
  // after it, which is where the two buttons went the first time.
  flood(l.sample, bg)
  bevel(l.sample, true)
  const oldFont = rp.font
  const oldClip = rp.clip
  if (sampleFont) rp.font = sampleFont
  if (rp.font) {
    const r = at(l.sample)
    rp.clip = { x1: r.x + 1, y1: r.y + 1, x2: r.x + r.w - 2, y2: r.y + r.h - 2 }
    rp.text(r.x + 2, r.y + 2 + rp.font.baseline, ASL_TEXT.fontSample, text)
  }
  rp.font = oldFont
  rp.clip = oldClip

  const button = (b: Box, s: string): void => {
    flood(b, bg)
    bevel(b, false)
    const w = rp.font ? rp.textLength(s) : s.length * 8
    label(s, b.x + Math.max(1, Math.floor((b.w - w) / 2)), b.y + 2, text)
  }
  button(l.ok, setup.okText === '' ? ASL_TEXT.ok : setup.okText)
  button(l.cancel, setup.cancelText === '' ? ASL_TEXT.cancel : setup.cancelText)
  rp.restore(save)
}


/* --------------------------------------------------------------------------
 * The screen-mode requester
 *
 * The third layout, and the last of asl's three. GUI 2.10 asks for it the
 * same way it asks for the font one: routine 55 writes ASL_Window and a
 * TAG_DONE and nothing else, then reads four fields off the
 * ScreenModeRequester -- sm_DisplayID at +0, sm_DisplayWidth at +4,
 * sm_DisplayHeight at +8 and sm_DisplayDepth at +$c, which is exactly what
 * routines 119, 120, 121 and 123 do with `movea.l $150(a0),a0`.
 * ----------------------------------------------------------------------- */

export interface AslModeSetup {
  hail: string
  okText: string
  cancelText: string
  left: number
  top: number
  width: number
  height: number
  /** the DisplayID showing when it opens, and the one OK answers */
  id: number
  displayWidth: number
  displayHeight: number
  depth: number
}

export interface AslModeLayout {
  inner: Box
  modes: Box
  visible: number
  modeUp: Box
  modeDown: Box
  properties: Box
  depthDown: Box
  depthUp: Box
  ok: Box
  cancel: Box
}

export function aslModeLayout(
  setup: AslModeSetup,
  borderLeft: number,
  borderTop: number,
  borderRight: number,
  borderBottom: number,
): AslModeLayout {
  const iw = Math.max(180, setup.width - borderLeft - borderRight)
  const ih = Math.max(90, setup.height - borderTop - borderBottom)
  const inner = box(borderLeft, borderTop, iw, ih)
  // from the bottom: buttons, the Colors row, then the properties box
  const propH = ROW * 3 + GAP * 2
  const bottom = propH + ROW * 2 + GAP * 4
  const listH = Math.max(ROW, ih - bottom)
  const barW = 14
  const arrow = 10
  const modes = box(inner.x + GAP, inner.y + GAP, iw - GAP * 3 - barW, listH - GAP)
  const bar = modes.x + modes.w + GAP
  let y = inner.y + listH + GAP
  const properties = box(inner.x + GAP, y, iw - GAP * 2, propH)
  y += propH + GAP
  const depthDown = box(inner.x + GAP + 8 * 8, y, ROW, ROW)
  const depthUp = box(depthDown.x + ROW * 2, y, ROW, ROW)
  y += ROW + GAP
  const bw = Math.floor((iw - GAP * 3) / 2)
  return {
    inner,
    modes,
    visible: Math.max(1, Math.floor((modes.h - LIST_INSET * 2) / ASL_FONT_HEIGHT)),
    modeUp: box(bar, modes.y + modes.h - arrow * 2, barW, arrow),
    modeDown: box(bar, modes.y + modes.h - arrow, barW, arrow),
    properties,
    depthDown,
    depthUp,
    ok: box(inner.x + GAP, y, bw, ROW),
    cancel: box(inner.x + GAP * 2 + bw, y, bw, ROW),
  }
}

export type AslModeAction =
  | { kind: 'mode'; index: number }
  | { kind: 'scroll'; delta: number }
  | { kind: 'depth'; delta: number }
  | { kind: 'ok' }
  | { kind: 'cancel' }
  | null

export function aslModeHit(l: AslModeLayout, x: number, y: number): AslModeAction {
  if (inBox(l.modes, x, y)) return { kind: 'mode', index: Math.floor((y - l.modes.y - LIST_INSET) / ASL_FONT_HEIGHT) }
  if (inBox(l.modeUp, x, y)) return { kind: 'scroll', delta: -1 }
  if (inBox(l.modeDown, x, y)) return { kind: 'scroll', delta: 1 }
  if (inBox(l.depthDown, x, y)) return { kind: 'depth', delta: -1 }
  if (inBox(l.depthUp, x, y)) return { kind: 'depth', delta: 1 }
  if (inBox(l.ok, x, y)) return { kind: 'ok' }
  if (inBox(l.cancel, x, y)) return { kind: 'cancel' }
  return null
}

/**
 * Draw the screen-mode requester.
 *
 * The properties box shows THREE of the lines the real one shows and not
 * five. `Maximum Size` and `Minimum Size` come from a DimensionInfo the
 * monitor driver computes at run time --- `pal 39.3` stores no rectangles for
 * ../amiga/displayinfo.ts to read --- and two lines of numbers this port
 * cannot justify would be worse than two lines it does not draw.
 */
export function aslModeRender(
  rp: RastPort,
  dri: DrawInfo,
  setup: AslModeSetup,
  l: AslModeLayout,
  modes: ReadonlyArray<{ name: string; width: number; height: number; id: number }>,
  top: number,
  selected: number,
  maxColours: number,
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

  const at = (b: Box): Box => box(b.x + ox, b.y + oy, b.w, b.h)
  const flood = (b: Box, pen: number): void => {
    const r = at(b)
    rp.rectFill(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, pen)
  }
  const bevel = (b: Box, recessed: boolean): void => {
    const r = at(b)
    drawBevelBox(rp, r.x, r.y, r.w, r.h, dri, { recessed })
  }
  const label = (s: string, x: number, y: number, pen: number): void => {
    if (rp.font) rp.text(x + ox, y + oy + rp.font.baseline, s, pen)
  }

  flood(l.inner, bg)
  flood(l.modes, bg)
  bevel(l.modes, true)
  for (let i = 0; i < l.visible; i++) {
    const m = modes[top + i]
    if (!m) break
    const ry = l.modes.y + LIST_INSET + i * ASL_FONT_HEIGHT
    if (top + i === selected) flood(box(l.modes.x + 1, ry, l.modes.w - 2, ASL_FONT_HEIGHT), fill)
    label(m.name, l.modes.x + LIST_INSET, ry, top + i === selected ? fillText : text)
  }
  bevel(l.modeUp, false)
  bevel(l.modeDown, false)

  flood(l.properties, bg)
  bevel(l.properties, true)
  label(ASL_TEXT.modeProperties, l.properties.x + 3, l.properties.y + 1, text)
  label(
    aslFormat(ASL_TEXT.visibleSize, setup.displayWidth, setup.displayHeight),
    l.properties.x + 3,
    l.properties.y + 1 + ROW,
    text,
  )
  const flags = (setup.id & MODE_KEY.LACE) !== 0 ? ` ${ASL_TEXT.interlaced}` : ''
  label(
    aslFormat(ASL_TEXT.maximumColors, maxColours) + flags,
    l.properties.x + 3,
    l.properties.y + 1 + ROW * 2,
    text,
  )

  label(ASL_TEXT.colors, l.inner.x + 3, l.depthDown.y + 2, text)
  bevel(l.depthDown, false)
  bevel(l.depthUp, false)
  label('-', l.depthDown.x + 4, l.depthDown.y + 2, text)
  label('+', l.depthUp.x + 4, l.depthUp.y + 2, text)
  label(String(1 << setup.depth), l.depthDown.x + ROW + 3, l.depthDown.y + 2, text)

  const button = (b: Box, s: string): void => {
    flood(b, bg)
    bevel(b, false)
    const w = rp.font ? rp.textLength(s) : s.length * 8
    label(s, b.x + Math.max(1, Math.floor((b.w - w) / 2)), b.y + 2, text)
  }
  button(l.ok, setup.okText === '' ? ASL_TEXT.ok : setup.okText)
  button(l.cancel, setup.cancelText === '' ? ASL_TEXT.cancel : setup.cancelText)
  rp.restore(save)
}
