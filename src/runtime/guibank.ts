/**
 * The GUI bank: what `Gui Open` opens.
 *
 * GUI 2.10 does not build an interface from keywords. You paint one in
 * GadToolsBox, save a `.gui` file, and run the GuiConv accessory to turn it
 * into an AMOS bank, which a program `Load`s as bank 20. Every one of the
 * extension's 204 keywords works on what is in that bank, so this file is the
 * bottom of the whole port: without it `Gui Open` has nothing to open.
 *
 * ## Evidence
 *
 * SOURCE tier, and unusually direct. The converter is
 * `GUI2/Accessories/GuiConv.Amos`, "GUI Converter 2.3 (30-09-2000), Phoenix
 * Version, © Copyright 1995-2000 Pietro Ghizzoni - Dairymen Soft, FreeWare",
 * and it is an AMOS PROGRAM. Detokenised it is 1,099 lines, and it names
 * every field of this format in its own comments as it writes them:
 *
 *     Doke WORK+26,HSIZE+_DATAS            Rem  Gui Kind
 *     Doke WORK+28,Deek(WORK+26)+NGAD*2    Rem  Gui Tags
 *     Doke WORK+34,NGAD                    Rem  # of Gadgets
 *     Doke WORK+48,VERS                    Rem  Gui Converter Version
 *
 * `HSIZE=70` and `VERS=40` are the program's own constants. Everything below
 * was then checked against a real bank: `GUI2/Examples/BootSelector.Amos` by
 * Marco Vettorello ships 926 bytes of it as bank 20, and every offset lands
 * where the comments say.
 *
 * ## What is in a bank and what is only in memory
 *
 * Several fields are ADDRESSES on the machine that saved the file, and the
 * example bank still carries them: $6842c754, $68232594 and friends. They are
 * a saved program's stale pointers, not data, and nothing here reads them.
 * The Window, Gadget and Menu pointers at 4..25, the VisualInfo and TextAttr
 * in every NewGadget, and the whole Gost Requester block are all of that
 * kind. What survives a save and reload is the GEOMETRY, the kinds, the ids,
 * the tags and the labels, which is exactly what is needed to rebuild the
 * interface.
 */
import { AMOS_KIND_IMAGE, AMOS_KIND_NUM } from './guikinds'

/** `HSIZE=70`, the per-GUI header GuiConv writes */
export const GUI_HEADER_SIZE = 70

/** the header GuiConv writes for the window itself, `Ssave WORK To WORK+74` */
export const GUI_INFO_SIZE = 74

/** `Add _STRUCTS,30`, which is gadtools' NewGadget and the same 30 bytes */
export const NEWGADGET_SIZE = 30

/** `VERS=40`, written at +48 and the only version this reader has seen */
export const GUI_CONVERTER_VERSION = 40

/** `Doke LABEL,768` ends the label chain */
const LABEL_END = 0x0300
/** `If A$=Chr$(0) Then A$=Chr$(2)+Chr$(0)`, an empty label */
const LABEL_EMPTY = 0x02

/** one gadget, as the bank describes it */
export interface GuiGadget {
  /** the gadtools kind, out of the Gui Kind array */
  kind: number
  /** ng_LeftEdge, already less the 4 GuiConv subtracts for the window border */
  leftEdge: number
  /** ng_TopEdge, less the 11 GuiConv subtracts for the title bar */
  topEdge: number
  width: number
  height: number
  /** ng_GadgetID, which GuiConv numbers from 0 */
  id: number
  /** ng_Flags */
  flags: number
  /**
   * ng_UserData.
   *
   * For an image gadget this is the BOB NUMBER, which is GuiConv's own use of
   * a field gadtools leaves to the caller: `Loke _STRUCTS+26,B0B`. The guide
   * says the next bob after it is the selected state.
   */
  userData: number
}

/** one GUI in the bank; a bank may chain several */
export interface Gui {
  /** where this GUI starts in the bank */
  offset: number
  /** the window's box, from the Header Info block */
  left: number
  top: number
  width: number
  height: number
  /** IDCMP flags the converter worked out from the gadgets present */
  idcmp: number
  gadgets: GuiGadget[]
  /** the label chain, in the order GuiConv wrote it */
  labels: string[]
  /** how many image gadgets, which is how many Images Structs were reserved */
  imageGadgets: number
  /** does this GUI carry menus? `Doke WORK+40,Sgn(MEN)` */
  hasMenus: boolean
  /** the converter version at +48 */
  version: number
  /** the raw tag area, which the keywords read per gadget */
  tags: Uint8Array
}

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!
const s16 = (b: Uint8Array, at: number): number => {
  const v = u16(b, at)
  return v >= 0x8000 ? v - 0x10000 : v
}
const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

/**
 * The label chain: NUL-terminated strings, each padded to an even length,
 * ending at a word of 768.
 *
 * `_ADDLAB` writes an absent label as `Chr$(2)+Chr$(0)`, so a lone $02 is an
 * empty string rather than a control character, and the count of labels is
 * what ties them to the gadgets that have them.
 */
function readLabels(b: Uint8Array, at: number): string[] {
  const out: string[] = []
  let p = at
  while (p + 2 <= b.length) {
    if (u16(b, p) === LABEL_END) break
    if (b[p] === LABEL_EMPTY && b[p + 1] === 0) {
      out.push('')
      p += 2
      continue
    }
    let end = p
    while (end < b.length && b[end] !== 0) end++
    out.push(String.fromCharCode(...b.subarray(p, end)))
    // past the NUL, then up to an even boundary as EVEN[] left it
    p = end + 1
    if ((p - at) % 2 === 1) p++
  }
  return out
}

/**
 * Read one GUI at `offset`.
 *
 * Null when the header does not hold together, which is what a bank that is
 * not a GUI bank looks like: every section offset has to point inside the
 * bank and after the header, and the gadget count has to fit the space the
 * kind array claims.
 */
export function readGui(b: Uint8Array, offset = 0): Gui | null {
  if (offset + GUI_HEADER_SIZE > b.length) return null
  const kindAt = u16(b, offset + 26)
  const tagsAt = u16(b, offset + 28)
  const structsAt = u16(b, offset + 30)
  const labelsAt = u16(b, offset + 32)
  const count = u16(b, offset + 34)
  const infoAt = u16(b, offset + 42)
  const version = u16(b, offset + 48)

  // the four sections run in this order and none may start before the header
  if (kindAt < GUI_HEADER_SIZE) return null
  if (!(kindAt <= tagsAt && tagsAt <= structsAt && structsAt <= labelsAt)) return null
  if (offset + labelsAt > b.length) return null
  // the kind array is one word a gadget and sits exactly between its own
  // offset and the tags, which is the cheapest check that `count` is real
  if (kindAt + count * 2 !== tagsAt) return null
  if (offset + structsAt + count * NEWGADGET_SIZE > b.length) return null

  const gadgets: GuiGadget[] = []
  for (let i = 0; i < count; i++) {
    const s = offset + structsAt + i * NEWGADGET_SIZE
    gadgets.push({
      kind: s16(b, offset + kindAt + i * 2),
      leftEdge: s16(b, s),
      topEdge: s16(b, s + 2),
      width: u16(b, s + 4),
      height: u16(b, s + 6),
      id: u16(b, s + 16),
      flags: u32(b, s + 18),
      userData: u32(b, s + 26),
    })
  }

  let left = 0
  let top = 0
  let width = 0
  let height = 0
  let idcmp = 0
  let imageGadgets = 0
  if (infoAt > 0 && offset + infoAt + GUI_INFO_SIZE <= b.length) {
    const h = offset + infoAt
    left = s16(b, h)
    top = s16(b, h + 2)
    width = u16(b, h + 4)
    height = u16(b, h + 6)
    idcmp = u32(b, h + 52)
    imageGadgets = u16(b, h + 56)
  }

  return {
    offset,
    left,
    top,
    width,
    height,
    idcmp,
    gadgets,
    labels: readLabels(b, offset + labelsAt),
    imageGadgets,
    hasMenus: u16(b, offset + 40) !== 0,
    version,
    tags: b.subarray(offset + tagsAt, offset + structsAt),
  }
}

/**
 * Every GUI in a bank.
 *
 * "A gui bank can held as many gui as you want", and they are chained by the
 * word at +0: `Doke WORK,CGO-PGO` writes the DISTANCE from the previous GUI
 * to this one, into the previous one's Next field. So the chain is walked by
 * adding, and a Next of zero ends it.
 */
export function readGuiBank(b: Uint8Array): Gui[] {
  const out: Gui[] = []
  let at = 0
  const seen = new Set<number>()
  for (;;) {
    if (seen.has(at)) break
    seen.add(at)
    const gui = readGui(b, at)
    if (gui === null) break
    out.push(gui)
    const next = u16(b, at + 0)
    if (next === 0) break
    at += next
  }
  return out
}

/**
 * Is this gadget one of GuiConv's own inventions rather than a gadtools kind?
 *
 * Two are. An IMAGE gadget is a BUTTON the editor was given no text for, and
 * the converter writes kind 0 for it where gadtools' 0 is GENERIC. A NUM
 * gadget is kind 14, which gadtools does not define at all.
 */
export function isConverterKind(kind: number): boolean {
  return kind === AMOS_KIND_IMAGE || kind === AMOS_KIND_NUM
}
