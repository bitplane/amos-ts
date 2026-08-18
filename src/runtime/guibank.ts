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
import { BARLABEL, NEWMENU_SIZEOF, NM, type NewMenu } from '../amiga/gadtools'
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
   * ng_UserData, which GuiConv gives THREE meanings depending on the kind.
   *
   * gadtools leaves the field to the caller and Ghizzoni took it up for all
   * three, in three different branches of `_ADDGAD`:
   *
   *   IMAGE            the BOB NUMBER, `Loke _STRUCTS+26,B0B`, and the guide
   *                    says the next bob after it is the selected state
   *   LISTVIEW, MX,    the ITEM COUNT LESS ONE, `Loke USER,N-1` in the LIST
   *   CYCLE            branch, so eight items store seven
   *   TEXT             1 when the gadget is a PROGRESS BAR, from the STRING
   *                    branch's `If Upper$(S$)-Chr$(0)="PBAR" and
   *                    LTYPE=_TEXT: S$=Chr$(0): Loke USER,1`
   *
   * The fields below carry each of those already read out, so a caller does
   * not have to know which meaning is in force.
   */
  userData: number
  /**
   * The label beside the gadget, out of the label chain.
   *
   * `_ADDGAD` writes one name label per gadget before any payload, so the
   * chain is names and payloads interleaved in gadget order and this walks it
   * that way. The walk is checkable end to end because the chain does not
   * stop at the gadgets: menu labels follow, then the window's title and its
   * screen name. A walk that consumed one label too many or too few would
   * land the title on the wrong string, and across the 23 GUIs in the corpus
   * it lands on "Information window", "BookShelf", "HotKeys" and twenty more
   * that read like titles. GuiDemo's names come out "Clic_k Me!",
   * "_Palette", "_CheckBox", with the underscores GadToolsBox writes for the
   * keyboard shortcut.
   */
  name: string
  /** LISTVIEW, MX and CYCLE: the items, which `Gui Read$` selects from */
  items: string[]
  /** STRING and TEXT: the default text the editor was given */
  text: string
  /**
   * A TEXT gadget the editor was given the default string "PBAR".
   *
   * The guide describes it as the extension's own invention: "The
   * gadtools.library don't allows you to create a progress bar gadget, but
   * this kind of gadget is very usefull, and so i've created this for you!"
   * The converter recognises the string, empties the label and sets UserData.
   */
  progressBar: boolean
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
  /** the raw tag area, kept so a caller can re-split it */
  tags: Uint8Array
  /** one tag list per gadget, in gadget order */
  gadgetTags: TagPair[][]
  /** the window's own OpenWindowTagList, which follows the gadgets' */
  windowTags: TagPair[]
  /**
   * The NewMenu array, flat and ready for `CreateMenusA`, empty when the
   * header's Menus Check is zero.
   *
   * Labels and command keys are already filled in from the chain; what the
   * bank holds in nm_Label and nm_CommKey are the stale pointers -1, 0 and 1.
   */
  menus: NewMenu[]
  /** the window's title, `_ADDLAB [WN$]` in `_WIND` */
  title: string
  /**
   * The public screen the editor named.
   *
   * GadToolsBox writes its own banner there when the user named nothing, and
   * GuiConv replaces exactly that string with an empty label:
   * `If A$="GadToolsBox V2.0b © 1991-1993"+Chr$(0) Then A$=Chr$(2)`.
   */
  screenName: string
}

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!
const s16 = (b: Uint8Array, at: number): number => {
  const v = u16(b, at)
  return v >= 0x8000 ? v - 0x10000 : v
}
const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

/**
 * The four tags that make a gadget carry a label payload at all.
 *
 * `_ADDGAD` sets its `TX` flag on exactly these, subtracting the tag base
 * first: `If T=%1110 or T=%101101 or T=%1001 or T=%1011: TX=True`, which is
 * $0e GTCY_Labels, $2d GTST_String, $09 GTMX_Labels and $0b GTTX_Text. If TX
 * is still false the procedure returns before writing anything.
 *
 * GTLV_Labels ($06) IS NOT ON THAT LIST, and its absence is the whole reason
 * a LISTVIEW has no items in the bank: its list comes from a program's own
 * array at run time, through `Gui Set window,gadget,1,Array(...)`. The
 * converter even zeroes the tag's data on the way past, `Leek(TG+4) and
 * (T><...0110)`. Keying the payload off the KIND instead of off these tags
 * gives a listview one phantom item stolen from the next gadget's name.
 */
const PAYLOAD_TAGS = new Set([0x8008_000e, 0x8008_002d, 0x8008_0009, 0x8008_000b])
/** GTCY_Labels and GTMX_Labels: the payload is a list of items */
const LIST_TAGS = new Set([0x8008_000e, 0x8008_0009])
/** `S$=S$+Chr$(1)+Chr$(0)` closes a list payload */
const LIST_END = 0x01

/**
 * A reader over the label chain.
 *
 * `_ADDLAB` writes each label as a NUL-terminated string padded to an even
 * length, an absent one as `Chr$(2)+Chr$(0)`, and `Doke LABEL,768` ends the
 * whole chain. So a lone $02 is an empty string rather than a control
 * character.
 */
class Labels {
  private p: number
  constructor(
    private readonly b: Uint8Array,
    private readonly start: number,
  ) {
    this.p = start
  }

  atEnd(): boolean {
    return this.p + 2 > this.b.length || u16(this.b, this.p) === LABEL_END
  }

  /** the byte a `next()` would start on, for the callers that peek */
  peekByte(): number {
    return this.b[this.p] ?? 0
  }

  next(): string {
    if (this.atEnd()) return ''
    if (this.b[this.p] === LABEL_EMPTY && this.b[this.p + 1] === 0) {
      this.p += 2
      return ''
    }
    let end = this.p
    while (end < this.b.length && this.b[end] !== 0) end++
    const s = String.fromCharCode(...this.b.subarray(this.p, end))
    this.p = end + 1
    if ((this.p - this.start) % 2 === 1) this.p++
    return s
  }

  /** every label from here on, which is what a caller wanting the raw chain gets */
  rest(): string[] {
    const out: string[] = []
    while (!this.atEnd()) out.push(this.next())
    return out
  }
}

/**
 * Read the NewMenu array, which starts where the gadgets' NewGadgets end.
 *
 * The order inside the structures block is stated outright by the two lines
 * of GuiConv that fill it:
 *
 *     CREATE ["GADA",3,GP]: CREATE ["MEDA",4,MP]: _WIND
 *     CREATE ["BBOX",1,BP]: TXTSTR=LOCSTR+1: CREATE ["ITXT",2,IP]
 *
 * so gadgets, then menus, then bevel boxes, then IntuiTexts. The library
 * reads it back in the same order with one moving cursor at `$3c(a3)`, which
 * is why nothing carries an offset.
 *
 * `CREATE` appends a twenty-byte run of zeros after the last menu
 * (`If MEN and T=4: Add _STRUCTS,20`) and the library's walk at $5ac0 stops
 * on it: `move.b -$2(a0),d0 / tst.b d0 / beq`. A zero nm_Type is the end,
 * which is NM_END.
 */
function readMenus(b: Uint8Array, at: number, limit: number): { menus: NewMenu[]; end: number } {
  const menus: NewMenu[] = []
  let p = at
  while (p + NEWMENU_SIZEOF <= limit && b[p] !== NM.END) {
    const m: NewMenu = {
      type: b[p]!,
      // -1 is BARLABEL. Anything else is a stale pointer, and the label
      // itself comes out of the chain
      label: (u32(b, p + 2) | 0) === BARLABEL ? BARLABEL : '',
      flags: u16(b, p + 10),
      mutualExclude: u32(b, p + 12) | 0,
      userData: u32(b, p + 16),
    }
    // the field is 1 or 0 in a saved bank: present, not the character
    if (u32(b, p + 6) !== 0) m.commKey = ''
    menus.push(m)
    p += NEWMENU_SIZEOF
  }
  // the NM_END record itself, which the library steps over the same way
  return { menus, end: Math.min(limit, p + NEWMENU_SIZEOF) }
}

/**
 * Walk the whole label chain in the order the converter wrote it.
 *
 * `_ADDGAD` writes each gadget's NAME, then its payload if its TAGS asked for
 * one. A list payload is `N` strings closed by `Chr$(1)+Chr$(0)`, and N is
 * `userData + 1` because the converter stored `N-1`. A string payload is one
 * string. Everything else contributes only its name, which is why this walks
 * rather than indexes: the chain has no per-gadget marker, only order.
 *
 * The terminator is what the count is checked against rather than trusted
 * from: a list stops at the `Chr$(1)` whether or not `userData` agreed, so a
 * bank whose count is wrong loses one gadget's labels instead of every
 * gadget's after it.
 *
 * `_ADDMENU` follows, taking one label per menu unless nm_Label is BARLABEL
 * and one more when nm_CommKey is set. That is the same pair of tests the
 * library's fixup makes at $5ac8 and $5ad6 before calling the chain reader at
 * $5a00, so a separator consumes nothing and a shortcut consumes two.
 *
 * `_WIND` runs last of the three and adds the window's title and its public
 * screen name, in that order.
 */
function readLabels(
  b: Uint8Array,
  at: number,
  gadgets: GuiGadget[],
  tags: TagPair[][],
  menus: NewMenu[],
): { title: string; screenName: string } {
  const chain = new Labels(b, at)
  for (const [i, g] of gadgets.entries()) {
    g.name = chain.next()
    const payload = (tags[i] ?? []).find((t) => PAYLOAD_TAGS.has(t.tag))
    if (payload === undefined) continue
    if (LIST_TAGS.has(payload.tag)) {
      const count = g.userData + 1
      for (let n = 0; n < count && !chain.atEnd(); n++) {
        if (chain.peekByte() === LIST_END) break
        g.items.push(chain.next())
      }
      if (chain.peekByte() === LIST_END) chain.next()
    } else {
      g.text = chain.next()
    }
  }
  for (const m of menus) {
    if (m.label !== BARLABEL) m.label = chain.next()
    if (m.commKey !== undefined) m.commKey = chain.next()
  }
  return { title: chain.next(), screenName: chain.next() }
}

/** one tag and its data, as GuiConv writes them: two longwords */
export interface TagPair {
  tag: number
  data: number
}

/**
 * Split the tag area into one list per gadget, and whatever follows.
 *
 * `_ADDGAD` writes each gadget's tags as (tag, data) longword pairs and
 * closes the list with a single zero LONGWORD rather than a pair:
 * `Loke _TAG,0: Add _TAG,4`. What is left after the last gadget's list is the
 * WINDOW's own tag list, which is why a walk that stopped at the gadget count
 * would leave 400-odd bytes unexplained. Its first tag is $80000064, which is
 * Intuition's WA_Left.
 */
export function readTags(area: Uint8Array, count: number): { gadgets: TagPair[][]; window: TagPair[] } {
  const dv = new DataView(area.buffer, area.byteOffset, area.byteLength)
  let at = 0
  const read = (): TagPair[] => {
    const out: TagPair[] = []
    for (;;) {
      if (at + 4 > area.length) return out
      const tag = dv.getUint32(at)
      if (tag === 0) {
        at += 4
        return out
      }
      if (at + 8 > area.length) return out
      out.push({ tag, data: dv.getUint32(at + 4) })
      at += 8
    }
  }
  const gadgets: TagPair[][] = []
  for (let i = 0; i < count; i++) gadgets.push(read())
  return { gadgets, window: read() }
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
      name: '',
      items: [],
      text: '',
      progressBar: false,
    })
  }

  // a TEXT gadget the converter turned into a progress bar carries UserData 1
  for (const g of gadgets) if (g.kind === 13 && g.userData === 1) g.progressBar = true
  const tagArea = b.subarray(offset + tagsAt, offset + structsAt)
  const split = readTags(tagArea, count)
  const hasMenus = u16(b, offset + 40) !== 0
  const menus = hasMenus
    ? readMenus(b, offset + structsAt + count * NEWGADGET_SIZE, offset + labelsAt).menus
    : []
  const { title, screenName } = readLabels(b, offset + labelsAt, gadgets, split.gadgets, menus)

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
    labels: new Labels(b, offset + labelsAt).rest(),
    imageGadgets,
    hasMenus,
    version,
    tags: tagArea,
    gadgetTags: split.gadgets,
    windowTags: split.window,
    menus,
    title,
    screenName,
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
