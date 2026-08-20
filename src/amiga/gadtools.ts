/**
 * `gadtools.library` — the gadget kinds, their tags, and the gadget list.
 *
 * Nineteen public functions over `intuition.ts`'s Window and `graphics.ts`'s
 * RastPort. What it adds to Intuition is the part everyone rewrote by hand
 * before Kickstart 2.0: a gadget that knows what KIND it is, so that a
 * checkbox toggles and a slider slides without the program drawing either.
 *
 * ## Why it is here and not beside a port
 *
 * Two callers, neither of which owns it. `AMOSPro_GUI.Lib` 2.1 and
 * `amospro_gui.lib` 1.61 both open it, and between them they are 307
 * keywords. That is the rule in README.md, met before the file was written
 * rather than after.
 *
 * ## The library itself is NOT held, and that matters
 *
 * gadtools is a ROM library from Kickstart 2.0 onward. No Kickstart image, no
 * source and no `gadtools.h` is in the corpus or in fixtures, and every
 * decode below therefore comes from the library's INTERFACE and from what its
 * callers do across it, never from its implementation. That is a weaker
 * footing than `lh.ts`, which was read instruction by instruction out of a
 * binary, and this header is the place to say so.
 *
 * Three sources, and they agree everywhere they overlap:
 *
 * 1. **`fixtures/amigaos/FD-GUI210/gadtools_lib.fd`**, Commodore's own
 *    function definitions, taken from GUI 2.10's own `Tools/FD/` directory in
 *    the corpus (`sources/ultimate-amiga-amos-factory/files/gui210/GUI2/`).
 *    `##bias 30`, so `CreateGadgetA` is -30 and each function is six lower.
 *    It is the version GUI 2.10 was built against, which is why it was taken
 *    from there rather than from an NDK.
 *
 * 2. **The two GUI binaries**, disassembled. They give the struct layouts,
 *    which are otherwise exactly the thing a header would have to be trusted
 *    for. `gui-1.61` at $23c6 does `moveq #$1e,d0` into `CopyMem` to copy a
 *    caller's NewGadget, which fixes `sizeof(struct NewGadget)` at 30 without
 *    anyone's word for it. At $246c it writes the result of CreateGadgetA at
 *    `$12(a0)` and `$16(a0)` and sets bit 2 of `$c(a0)`, which are Gadget's
 *    GadgetRender, SelectRender and Flags.
 *
 * 3. **`fixtures/extensions/os-devkit-1.61/docs/os_guides/os_gadtools_l.guide`**,
 *    Fromentin Brice and Jens Vang Petersen's documentation for OS DevKit
 *    1.61's own gadtools keywords. It prints every tag as a name AND a hex
 *    value AND groups them under a kind: "The TAGs of gadgets : 'CYCLE'
 *    TYPE=$7". That is where the numbers below come from.
 *
 * The third confirms the second twice over. `gui-1.61` at $24d6 recognises
 * kind 7 and searches the caller's tag list for `$8008000E`; the guide's
 * CYCLE section is TYPE=$7 and names `$8008000E` as GTCY_Labels. At $24c8 it
 * recognises kind $c and searches for `$8008002D`; the guide's STRING section
 * is TYPE=$C and names `$8008002D` as GTST_String. Two numbers each read off
 * a binary that never saw the guide, and off a guide whose author never saw
 * that binary.
 *
 * ## What the callers reach
 *
 * Fourteen of the nineteen, which is the whole reason this file is a
 * reasonable size. Traced by finding `movea.l d16(aN),a6` for the slot each
 * binary keeps GadToolsBase in, then walking forward to each `jsr d16(a6)` in
 * the same straight-line run, so the base and the call are never guessed at
 * across a branch:
 *
 *     LVO   function              1.61 at        2.10 at
 *      -30  CreateGadgetA         $244c          $5956
 *      -36  FreeGadgets           $2eb0          $6618
 *      -42  GT_SetGadgetAttrsA    $2a06          $6110
 *      -48  CreateMenusA          $25b8          $5af8
 *      -54  FreeMenus             $2df4          $6518
 *      -66  LayoutMenusA          $25e2          $5b22
 *      -72  GT_GetIMsg            $2d34 $3282    —
 *      -78  GT_ReplyIMsg          $2d3e          —
 *      -84  GT_RefreshWindow      $291c          $5f9c
 *     -102  GT_FilterIMsg         —              $3c26 $6c6c
 *     -114  CreateContext         $2300          $5780
 *     -120  DrawBevelBoxA         $2880          $2abe $5f02
 *     -126  GetVisualInfoA        $220e          $5660
 *     -132  FreeVisualInfo        $2ec4          $56fc $6630
 *
 * The base is `$d8` of the block at `$268(a5)` in 1.61 and `$124` in 2.10,
 * both confirmed by the OpenLibrary that filled them: 1.61 at $980 and 2.10
 * at $1344, each with the library name a fixed distance into the same block
 * as `gadtools.library` is into the code hunk.
 *
 * Five functions are called by nothing here and are declared but not
 * modelled: `LayoutMenuItemsA` (-60), `GT_BeginRefresh` (-90),
 * `GT_EndRefresh` (-96), `GT_PostFilterIMsg` (-108) and
 * `GT_GetGadgetAttrsA` (-174). They are in `LVO` because the table is the
 * .fd's and truncating it would misrepresent the library.
 *
 * The two callers split on messages, which is worth recording because it is a
 * real difference and not a version bump: 1.61 uses GT_GetIMsg and
 * GT_ReplyIMsg, 2.10 pulls messages off the port itself and passes them
 * through GT_FilterIMsg. Both are documented ways to run a gadtools message
 * loop.
 *
 * ## The tag base is NOT gadtools' alone
 *
 * `asl.library` numbers its tags from the same $80080000, and the overlap is
 * total rather than incidental: $80080028 is `GTSL_Level` to gadtools and
 * `ASLFR_Screen` to asl, $8008002D is `GTST_String` and `ASLFR_DoMultiSelect`,
 * $80080030 is `GTIN_MaxChars` and `ASLFO_FixedWidthOnly`. Both are in
 * `os_misc1.guide` and `os_gadtools_l.guide` with those values.
 *
 * A longword in a binary therefore cannot be attributed to a library by its
 * value. It has to be attributed by the call it travels to, and both GUI
 * extensions open asl as well as gadtools, so both carry a mix. `gui-1.61`
 * builds a tag list at $ec8 of $8008006D, $6E, $6F and $70 all set to 1 and
 * hands it to `AllocAslRequest` with d0 = 2 at $95e; the guide names those
 * four `ASLSM_DoWidth`, `ASLSM_DoHeight`, `ASLSM_DoDepth` and
 * `ASLSM_DoOverscanType`, which is a screen-mode requester and nothing to do
 * with a gadget. It also writes $80080001 at $37e2, which is
 * `ASLFR_TitleText`.
 *
 * This was found by a test that assumed the opposite, and the assumption is
 * worth naming because it is the obvious one to make twice.
 *
 * DEVIATION: gadgets and VisualInfos carry synthetic addresses from a high
 * range, for the reason `boopsi.ts` gives at length: a caller receives one as
 * a number and hands it back later, and `GTLV_ShowSelected` takes "a pointeur
 * of one Gadtools 'STRING' gadget already created", so a gadget address
 * really does travel inside a tag value. Addresses are never reused.
 */
import type { RastPort } from './graphics'
import { IDCMP_GADGETUP, type IntuiMessage } from './intuition'
/**
 * The jump table, from `gadtools_lib.fd`.
 *
 * `##bias 30` and six bytes a vector, so entry N is at -(30 + 6N). The six
 * `gadtoolsPrivate` slots between FreeVisualInfo and GT_GetGadgetAttrsA are
 * why -138 to -168 are absent: they are in the .fd, under `##private`, and
 * they are the reason GT_GetGadgetAttrsA lands at -174 rather than -138.
 */
export const LVO = {
  CreateGadgetA: -30,
  FreeGadgets: -36,
  GT_SetGadgetAttrsA: -42,
  CreateMenusA: -48,
  FreeMenus: -54,
  LayoutMenuItemsA: -60,
  LayoutMenusA: -66,
  GT_GetIMsg: -72,
  GT_ReplyIMsg: -78,
  GT_RefreshWindow: -84,
  GT_BeginRefresh: -90,
  GT_EndRefresh: -96,
  GT_FilterIMsg: -102,
  GT_PostFilterIMsg: -108,
  CreateContext: -114,
  DrawBevelBoxA: -120,
  GetVisualInfoA: -126,
  FreeVisualInfo: -132,
  GT_GetGadgetAttrsA: -174,
} as const

/**
 * `GT_TagBase`, which is `TAG_USER` ($80000000) plus $80000.
 *
 * Not asserted from a header. Every gadtools tag the two GUI binaries carry
 * lies in $80080001..$80080070, and the guide prints the same values for the
 * same names, so the base is where both put it.
 */
export const GT_TAG_BASE = 0x8008_0000

/**
 * The gadget kinds, from the guide's section headings, which state the number
 * with the name: "The TAGs of gadgets : 'BUTTON' TYPE=$1".
 *
 * $A is missing from the guide and from this table because gadtools reserves
 * it; SLIDER is $B. GENERIC is 0 and the guide has no section for it, since
 * a generic gadget has no kind-specific tags to document. `gui-1.61` uses 0
 * as its OWN marker rather than as a kind: at $232c a zero read out of the
 * caller's gadget table sets bit 3 of `$82(a3)` and rewrites the kind to 1,
 * so an "image button" is a BUTTON with GadgetRender and SelectRender filled
 * in afterwards and GADGIMAGE set in Flags.
 */
export const KIND = {
  GENERIC: 0x0,
  BUTTON: 0x1,
  CHECKBOX: 0x2,
  INTEGER: 0x3,
  LISTVIEW: 0x4,
  MX: 0x5,
  NUMBER: 0x6,
  CYCLE: 0x7,
  PALETTE: 0x8,
  SCROLLER: 0x9,
  SLIDER: 0xb,
  STRING: 0xc,
  TEXT: 0xd,
} as const

export type GadgetKind = (typeof KIND)[keyof typeof KIND]

/** every kind the guide documents, in its own order, for iteration and tests */
export const KINDS: readonly GadgetKind[] = [
  KIND.GENERIC,
  KIND.BUTTON,
  KIND.CHECKBOX,
  KIND.INTEGER,
  KIND.LISTVIEW,
  KIND.MX,
  KIND.NUMBER,
  KIND.CYCLE,
  KIND.PALETTE,
  KIND.SCROLLER,
  KIND.SLIDER,
  KIND.STRING,
  KIND.TEXT,
]

/**
 * The tags, with the guide's own hex beside each so a reader can check one
 * without opening the file.
 *
 * Only gadtools' own are here. The guide also documents `GA_Disabled`
 * ($8003000E), `GA_Immediate` ($80030015), `GA_RelVerify` ($80030016),
 * `GA_TabCycle` ($80030024), `PGA_Freedom` ($80031001), `STRINGA_*`
 * ($8003200D, $80032010, $80032013) and `LAYOUTA_Spacing` ($80038002), which
 * are intuition's gadgetclass and strgclass tags passed straight through.
 * Those belong with BOOPSI, not here.
 */
export const TAG = {
  /** $80080004, CHECKBOX: the initial state, default FALSE */
  GTCB_Checked: GT_TAG_BASE + 0x04,
  /** $80080005, LISTVIEW: the topmost visible item, default 0 */
  GTLV_Top: GT_TAG_BASE + 0x05,
  /** $80080006, LISTVIEW: the list of nodes whose names are shown */
  GTLV_Labels: GT_TAG_BASE + 0x06,
  /** $80080007, LISTVIEW: read only, default FALSE */
  GTLV_ReadOnly: GT_TAG_BASE + 0x07,
  /** $80080008, LISTVIEW: scroller width, must be above 0, default 16 */
  GTLV_ScrollWidth: GT_TAG_BASE + 0x08,
  /** $80080009, MX: the NULL-terminated array of labels. Mandatory. */
  GTMX_Labels: GT_TAG_BASE + 0x09,
  /** $8008000A, MX: which choice is active, from 0, default 0 */
  GTMX_Active: GT_TAG_BASE + 0x0a,
  /** $8008000B, TEXT: the string to display, default 0 meaning empty */
  GTTX_Text: GT_TAG_BASE + 0x0b,
  /** $8008000C, TEXT: copy the text rather than hold the pointer (V37) */
  GTTX_CopyText: GT_TAG_BASE + 0x0c,
  /** $8008000D, NUMBER: the number to display, default 0 */
  GTNM_Number: GT_TAG_BASE + 0x0d,
  /** $8008000E, CYCLE: the NULL-terminated array of labels. Mandatory. */
  GTCY_Labels: GT_TAG_BASE + 0x0e,
  /** $8008000F, CYCLE: which choice is active, from 0, default 0 */
  GTCY_Active: GT_TAG_BASE + 0x0f,
  /** $80080010, PALETTE: bitplanes in the palette, default 1 */
  GTPA_Depth: GT_TAG_BASE + 0x10,
  /** $80080011, PALETTE: the pen initially selected, default 1 */
  GTPA_Color: GT_TAG_BASE + 0x11,
  /** $80080012, PALETTE: the first colour used, default 0 */
  GTPA_ColorOffset: GT_TAG_BASE + 0x12,
  /** $80080013, PALETTE: width of the selected-colour indicator */
  GTPA_IndicatorWidth: GT_TAG_BASE + 0x13,
  /** $80080014, PALETTE: height of the selected-colour indicator */
  GTPA_IndicatorHeight: GT_TAG_BASE + 0x14,
  /** $80080015, SCROLLER: the top visible edge, default 0 */
  GTSC_Top: GT_TAG_BASE + 0x15,
  /** $80080016, SCROLLER: the total represented, default 0 */
  GTSC_Total: GT_TAG_BASE + 0x16,
  /** $80080017, SCROLLER: how many are visible, default 2 */
  GTSC_Visible: GT_TAG_BASE + 0x17,
  /** $80080026, SLIDER: the minimum level, default 0 */
  GTSL_Min: GT_TAG_BASE + 0x26,
  /** $80080027, SLIDER: the maximum level, default 15 */
  GTSL_Max: GT_TAG_BASE + 0x27,
  /** $80080028, SLIDER: the current level, default 0 */
  GTSL_Level: GT_TAG_BASE + 0x28,
  /** $80080029, SLIDER: level width in characters, default 2 */
  GTSL_MaxLevelLen: GT_TAG_BASE + 0x29,
  /** $8008002A, SLIDER: a C format string for the level, default "%ld" */
  GTSL_LevelFormat: GT_TAG_BASE + 0x2a,
  /** $8008002B, SLIDER: where the level is drawn, a PLACETEXT_ value */
  GTSL_LevelPlace: GT_TAG_BASE + 0x2b,
  /** $8008002D, STRING: the initial content, default 0 meaning empty */
  GTST_String: GT_TAG_BASE + 0x2d,
  /** $8008002E, STRING: the maximum character count */
  GTST_MaxChars: GT_TAG_BASE + 0x2e,
  /** $8008002F, INTEGER: the initial content, default 0 */
  GTIN_Number: GT_TAG_BASE + 0x2f,
  /** $80080030, INTEGER: the maximum character count, default 10 */
  GTIN_MaxChars: GT_TAG_BASE + 0x30,
  /**
   * $80080034, common: the VisualInfo, which DrawBevelBoxA needs and no
   * gadget kind does.
   *
   * The NUMBER and the ROLE are read off `gui-1.61` at $2866, which walks the
   * caller's tag list for $80080034 and, on a hit at $288c, overwrites its
   * data with the extension's own VisualInfo at `$5c(a2)` before passing the
   * list to DrawBevelBoxA at $2880. Nothing gets a pointer substituted into
   * it unless it is meant to hold one.
   *
   * The NAME is not from any document held here: neither guide lists it, and
   * `GT_VisualInfo` is what the rest of the world calls it. A reader who
   * needs the name to be sourced should treat it as unsourced and the number
   * as solid.
   */
  GT_VisualInfo: GT_TAG_BASE + 0x34,
  /** $80080035, LISTVIEW: where the selected item is shown */
  GTLV_ShowSelected: GT_TAG_BASE + 0x35,
  /** $80080036, LISTVIEW: which string is selected, from 0, default 0 */
  GTLV_Selected: GT_TAG_BASE + 0x36,
  /** $80080039, TEXT: draw a recessed border, default FALSE */
  GTTX_Border: GT_TAG_BASE + 0x39,
  /** $8008003A, NUMBER: draw a recessed border, default FALSE */
  GTNM_Border: GT_TAG_BASE + 0x3a,
  /** $8008003B, SCROLLER: arrow size, 0 for none */
  GTSC_Arrows: GT_TAG_BASE + 0x3b,
  /**
   * $8000803D, MX: spacing between the lines, default 1.
   *
   * The guide prints it with a 0 where every other gadtools tag it lists has
   * an 8, and it is left as written rather than corrected to $8008003D. The
   * guide is the source for these numbers, and tidying one because it looks
   * wrong would put the other fifty in doubt by the same reasoning. Neither
   * GUI binary carries either value, so nothing here can settle it and
   * nothing here depends on it.
   */
  GTMX_Spacing: 0x8000_803d,
  /** $80080040, common: the character marking the letter to underline (V37) */
  GT_Underscore: GT_TAG_BASE + 0x40,
  /** $80080044, CHECKBOX and MX: use the given size rather than the standard one (V39) */
  GTCB_Scaled: GT_TAG_BASE + 0x44,
  /** $80080046, PALETTE: colour count, overriding GTPA_Depth, default 2 (V39) */
  GTPA_NumColors: GT_TAG_BASE + 0x46,
  /** $80080047, MX: where the title is placed, a PLACETEXT_ value (V39) */
  GTMX_TitlePlace: GT_TAG_BASE + 0x47,
  /** $80080048, NUMBER and TEXT: the pen the text is drawn in (V39) */
  GTNM_FrontPen: GT_TAG_BASE + 0x48,
  /** $80080049, NUMBER and TEXT: the pen the background is drawn in (V39) */
  GTNM_BackPen: GT_TAG_BASE + 0x49,
  /** $8008004A, NUMBER and TEXT: a GTJ_ justification (V39) */
  GTNM_Justification: GT_TAG_BASE + 0x4a,
  /** $8008004B, NUMBER: a C format string for the number, default "%ld" (V39) */
  GTNM_Format: GT_TAG_BASE + 0x4b,
  /** $8008004C, NUMBER: the formatted length in characters, default 10 (V39) */
  GTNM_MaxNumberLen: GT_TAG_BASE + 0x4c,
  /** $8008004E, LISTVIEW: an item to bring into view, overriding GTLV_Top (V39) */
  GTLV_MakeVisible: GT_TAG_BASE + 0x4e,
  /** $80080050, SLIDER: the level's width in pixels (V39) */
  GTSL_MaxPixelLen: GT_TAG_BASE + 0x50,
  /** $80080051, SLIDER: a GTJ_ justification for the level (V39) */
  GTSL_Justification: GT_TAG_BASE + 0x51,
  /** $80080052, PALETTE: a table of pens to edit, one per colour (V39) */
  GTPA_ColorTable: GT_TAG_BASE + 0x52,
  /** $80080055, NUMBER and TEXT: clip the text to the gadget (V39) */
  GTNM_Clipped: GT_TAG_BASE + 0x55,

  /*
   * The menu tags, from the guide's own `_men_tags` node rather than its
   * gadget one. They go to CreateMenusA and LayoutMenusA, so they are here
   * ahead of the menu commit that will use them.
   */
  /** $80080031, menus: the TextAttr for items and sub-items, else the screen's */
  GTMN_TextAttr: GT_TAG_BASE + 0x31,
  /** $80080032, menus: the pen the item text is drawn in, default 0 */
  GTMN_FrontPen: GT_TAG_BASE + 0x32,
  /** $80080041, menus: your own checkmark image, matching WA_Checkmark (V39) */
  GTMN_Checkmark: GT_TAG_BASE + 0x41,
  /** $80080042, menus: your own Amiga-key image, matching WA_AmigaKey (V39) */
  GTMN_AmigaKey: GT_TAG_BASE + 0x42,
  /**
   * $80080043, menus: ask for this whenever the window asked for
   * WA_NewLookMenus (V39). `gui-1.61` carries it at $25d6, six words before
   * the LayoutMenusA at $25e2.
   */
  GTMN_NewLookMenus: GT_TAG_BASE + 0x43,
} as const

/** the GTJ_ justifications, from the guide's GTNM_Justification and GTTX_Justification */
export const GTJ_LEFT = 0
export const GTJ_RIGHT = 1
export const GTJ_CENTER = 2

/** the PLACETEXT_ positions, from the guide's GTMX_TitlePlace and GTSL_LevelPlace */
export const PLACETEXT_ABOVE = 0x4
export const PLACETEXT_BELOW = 0x8

/**
 * $80080033, bevel boxes: draw it recessed rather than raised.
 *
 * Three call sites, and they agree. `gui-2.10` at $2a9c builds a tag list of
 * GT_VisualInfo and then, only when the value is non-zero, this tag with the
 * last argument its keyword popped; GUI2.guide's `Gui Bbox x,y,xx,yy,mode`
 * says "If mode is set to anything other than 0, then the box is drawn
 * recessed". OS DevKit at $16aca does the same from the other end, patching
 * this tag's data from `(a3)` and rewriting the tag itself to $80000000,
 * TAG_IGNORE, when that data is zero. Its keyword is
 * `_gt Bevel Box TYPE,X,Y,W,H,REC`, six arguments, and `(a3)` is the last of
 * them, which is REC. And at $11a94 it passes a hardcoded 1.
 *
 * The name is not from a held document. The number and the meaning are.
 */
export const GTBB_RECESSED = GT_TAG_BASE + 0x33

/**
 * $8008004D, bevel boxes: which design to draw.
 *
 * The other half of the same template. OS DevKit's three-tag block at $16b04
 * reads $80080033, $8008004D, $80080034, TAG_DONE, and the routine fills the
 * second from `$14(a3)`, five longwords below the top of the argument stack
 * and therefore the FIRST of the six, which is TYPE. The guide says only
 * "TYPE = Type of the box (the design)..".
 *
 * No document held here gives the values. `drawBevelBox` therefore records
 * the number it was handed and draws the one design, which is stated at the
 * call rather than hidden.
 */
export const GTBB_FRAMETYPE = GT_TAG_BASE + 0x4d

/**
 * `TAG_IGNORE`, which OS DevKit writes over a tag whose data turned out to be
 * zero rather than shuffling the list up. Worth naming because a caller doing
 * the same thing is building a valid list, not a broken one.
 */
export const TAG_IGNORE = 0x8000_0000

/**
 * The DrawInfo pen array, from `os_refs.guide`'s `screenpen_str` node, which
 * prints each pen with its byte offset in the array. Index is offset / 2,
 * every entry being a word.
 *
 * The same document states the order a second time and independently, as the
 * argument list of `_scr Id Def Dri Pens V1`: DETAILPEN, BLOCKPEN, TEXTPEN,
 * SHINEPEN, SHADOWPEN, FILLPEN, FILLTEXTPEN, BACKGROUNDPEN,
 * HIGHLIGHTTEXTPEN, with `V2` adding BARDETAILPEN, BARBLOCKPEN and
 * BARTRIMPEN. Nine plus three is the twelve the offset table ends at.
 */
export const PEN = {
  DETAIL: 0,
  BLOCK: 1,
  TEXT: 2,
  SHINE: 3,
  SHADOW: 4,
  FILL: 5,
  FILLTEXT: 6,
  BACKGROUND: 7,
  HIGHLIGHTTEXT: 8,
  BARDETAIL: 9,
  BARBLOCK: 10,
  BARTRIM: 11,
} as const

/** how many pens the V2 array holds, which is where `screenpen_str` stops */
export const NUMDRIPENS = 12

/**
 * `struct DrawInfo`, from `os_refs.guide`'s `drawinfo_str` node: 50 bytes,
 * dri_Version at 0, dri_NumPens at 2, dri_Pens at 4, dri_Font at 8,
 * dri_Depth at 12.
 *
 * Only the fields anything here reads. The pens are the whole reason this
 * type exists: gadtools draws in the screen's colours and has no opinion
 * about what they are.
 */
export interface DrawInfo {
  /** dri_NumPens, which bounds every index below */
  numPens: number
  /** dri_Pens, in PEN order */
  pens: readonly number[]
  /** dri_Depth */
  depth: number
}

/**
 * There is deliberately no default pen array here.
 *
 * A pen array is the SCREEN's, and which colour plays SHINEPEN on a
 * four-colour screen is a decision the screen's owner makes. README.md's rule
 * is that this layer holds mechanism and the caller holds policy, and a
 * default set of pens invented to make the module convenient would be policy
 * wearing a constant's name. `getVisualInfo` takes the DrawInfo it is given.
 */

/** `struct TagItem`, the same pair `boopsi.ts` names. */
export interface TagItem {
  tag: number
  data: number
}

/** TAG_DONE, which ends a list */
export const TAG_DONE = 0

/** the first `data` for `tag`, or `fallback` when the list does not carry it */
export function findTag(tags: readonly TagItem[], tag: number, fallback: number): number {
  for (const t of tags) {
    if (t.tag === TAG_DONE) break
    if (t.tag === tag) return t.data
  }
  return fallback
}

/**
 * `sizeof(struct NewGadget)` is 30, and that is read rather than looked up:
 * `gui-1.61` at $23c6 loads `moveq #$1e,d0` and calls exec's CopyMem (-624)
 * to take a caller's NewGadget into its own `$194(a3)` before editing the
 * copy's geometry.
 *
 * The field offsets follow from the type widths and are confirmed by what
 * that routine then writes: `(a1)` and `$2(a1)` take LeftEdge and TopEdge
 * after adding the window origin at `$1d0(a3)` and `$1ce(a3)`, and `$4(a1)`
 * and `$6(a1)` take Width and Height. Four words, then four longwords and a
 * word in between, is 30.
 */
export const NEWGADGET_SIZEOF = 30

/** `struct NewGadget`, the description a caller fills in for CreateGadgetA */
export interface NewGadget {
  /** ng_LeftEdge, +0 */
  leftEdge: number
  /** ng_TopEdge, +2 */
  topEdge: number
  /** ng_Width, +4 */
  width: number
  /** ng_Height, +6 */
  height: number
  /** ng_GadgetText, +8 */
  gadgetText: string
  /** ng_GadgetID, +16 — what comes back in an IDCMP message */
  gadgetID: number
  /** ng_Flags, +18 */
  flags: number
  /** ng_VisualInfo, +22 — the address GetVisualInfoA handed out */
  visualInfo: number
  /** ng_UserData, +26 */
  userData?: number
}

/**
 * The Gadget offsets this port has evidence for.
 *
 * From `gui-1.61` $246c-$2482, which is the only place in either binary that
 * writes into a Gadget gadtools returned: `move.l a1,$12(a0)` is
 * GadgetRender, `move.l a1,$16(a0)` is SelectRender and `ori.w #$4,$c(a0)`
 * is Flags with GADGIMAGE. The rest of the struct is not written by anything
 * here and is therefore not asserted.
 */
export const GADGET = {
  /** gg_Flags, +12 */
  Flags: 0x0c,
  /** gg_GadgetRender, +18 */
  GadgetRender: 0x12,
  /** gg_SelectRender, +22 */
  SelectRender: 0x16,
  /** gg_SpecialInfo, +34: `movea.l $22(a1),a0` at $33a6, a STRING's StringInfo */
  SpecialInfo: 0x22,
  /** gg_GadgetID, +38: `move.w $26(a1),d4` at $3356, straight off IAddress */
  GadgetID: 0x26,
  /** gg_UserData, +40: `movea.l $28(a1),a2` at $33c0, a LISTVIEW's own record */
  UserData: 0x28,
} as const

/** GADGIMAGE, bit 2 of gg_Flags — `ori.w #$4,$c(a0)` at gui-1.61 $2482 */
export const GADGIMAGE = 0x4

/**
 * GFLG_SELECTED, bit 7 of gg_Flags, which is where a CHECKBOX keeps its state.
 *
 * `gui-1.61` at $343a reads a checkbox by taking `$c(a1)`, the Flags, then
 * `rol.b #$1,d1 / andi.b #$1,d1`. Rotating the low byte left by one and
 * keeping bit 0 is bit 7 of that byte, which is $80. It reads the flag rather
 * than the message's Code, so a checkbox's truth is in the gadget.
 */
export const GFLG_SELECTED = 0x80

/**
 * `struct IntuiMessage`, the five fields `gui-1.61` copies out at $32a4
 * before replying:
 *
 *     move.l $14(a1),...   Class
 *     move.w $18(a1),...   Code
 *     move.w $1a(a1),...   Qualifier
 *     move.l $1c(a1),...   IAddress
 *     move.l $2c(a1),...   IDCMPWindow
 *
 * Twenty bytes of `struct Message` come first, which is what puts Class at
 * 20. The port's own fields between IAddress and IDCMPWindow are MouseX,
 * MouseY, Seconds and Micros, and nothing here reads them from a message, so
 * they are placed by arithmetic rather than confirmed.
 */
export const INTUIMESSAGE = {
  Class: 0x14,
  Code: 0x18,
  Qualifier: 0x1a,
  IAddress: 0x1c,
  MouseX: 0x20,
  MouseY: 0x22,
  Seconds: 0x24,
  Micros: 0x28,
  IDCMPWindow: 0x2c,
} as const

/**
 * Synthetic addresses, high and clear of the others in this port:
 * `0x7f10_0000` is exec's library bases and `0x7e00_0000` is BOOPSI's
 * objects. Eight apart, since a Gadget pointer is longword aligned and
 * consecutive addresses would read as suspiciously dense.
 */
const GADGET_ORIGIN = 0x7d00_0000
const VISUAL_ORIGIN = 0x7d80_0000
const STRIP_ORIGIN = 0x7dc0_0000
const STRIDE = 8

/**
 * `struct VisualInfo`, which is opaque on the machine: GetVisualInfoA returns
 * a pointer a caller may only pass back to gadtools and to
 * `ng_VisualInfo`. Held here as what gadtools would have had to look up, so
 * that rendering has the screen's pens without reaching for a screen.
 */
export interface VisualInfo {
  /** the caller-visible handle */
  readonly address: number
  /** which screen it was taken from */
  readonly screenSlot: number
  /** the screen's DrawInfo, which is what rendering actually wants */
  readonly drawInfo: DrawInfo
  /** freed by FreeVisualInfo, so a stale handle can be told apart */
  freed: boolean
}

/**
 * One gadtools gadget: the kind, the geometry, and whatever state that kind
 * carries.
 *
 * A single record with optional fields rather than a class per kind. gadtools
 * itself does the same thing from the other end, with one `struct Gadget` and
 * a SpecialInfo union, and a kind that carries no state at all (BUTTON) then
 * costs nothing.
 */
export interface Gadget {
  /** the caller-visible handle */
  readonly address: number
  readonly kind: GadgetKind
  leftEdge: number
  topEdge: number
  width: number
  height: number
  /** ng_GadgetText, which the guide's GT_Underscore marks a letter of */
  text: string
  /** ng_GadgetID, what an IDCMP GADGETUP carries back */
  id: number
  flags: number
  userData: number
  /** the VisualInfo the NewGadget named */
  visualInfo: number
  /** the next in the list CreateGadgetA chains, as CreateContext started it */
  next: Gadget | null
  /** disabled by GA_Disabled, which is intuition's tag rather than gadtools' */
  disabled: boolean
  /** freed by FreeGadgets */
  freed: boolean
  /** CHECKBOX: GTCB_Checked */
  checked?: boolean
  /** CYCLE and MX: GTCY_Labels / GTMX_Labels */
  labels?: readonly string[]
  /** CYCLE and MX: GTCY_Active / GTMX_Active */
  active?: number
  /** NUMBER and INTEGER: GTNM_Number / GTIN_Number */
  number?: number
  /** STRING: GTST_String */
  string?: string
  /** STRING and INTEGER: GTST_MaxChars / GTIN_MaxChars */
  maxChars?: number
  /** TEXT: GTTX_Text */
  displayText?: string
  /** SLIDER: GTSL_Min, GTSL_Max, GTSL_Level */
  min?: number
  max?: number
  level?: number
  /** SCROLLER: GTSC_Top, GTSC_Total, GTSC_Visible */
  top?: number
  total?: number
  visible?: number
  /** LISTVIEW: GTLV_Labels, GTLV_Top, GTLV_Selected */
  listLabels?: readonly string[]
  selected?: number
  /** PALETTE: GTPA_Depth, GTPA_Color, GTPA_ColorOffset */
  paletteDepth?: number
  color?: number
  colorOffset?: number
}

/**
 * The defaults each kind starts with, every one of them the guide's own
 * word: "Default to FALSE", "Default to 15", "Default to 2".
 *
 * Applied before the caller's tags, so a tag list that omits GTSL_Max leaves
 * a slider running 0 to 15 exactly as the guide says it does. Kinds with no
 * state of their own (GENERIC, BUTTON) are absent rather than empty.
 */
function kindDefaults(kind: GadgetKind): Partial<Gadget> {
  switch (kind) {
    case KIND.CHECKBOX:
      return { checked: false }
    case KIND.INTEGER:
      // "Specify the initial content. Default to 0." and "Default to 10."
      return { number: 0, maxChars: 10 }
    case KIND.LISTVIEW:
      return { listLabels: [], top: 0, selected: 0 }
    case KIND.MX:
      return { labels: [], active: 0 }
    case KIND.NUMBER:
      return { number: 0 }
    case KIND.CYCLE:
      return { labels: [], active: 0 }
    case KIND.PALETTE:
      // "Number of BitPlanes in the palette. Default to 1." and "Pen
      // initially selected. Default to 1."
      return { paletteDepth: 1, color: 1, colorOffset: 0 }
    case KIND.SCROLLER:
      // GTSC_Visible is the odd one: "Number visible in the 'SCROLLER'.
      // Default to 2." where Top and Total both default to 0
      return { top: 0, total: 0, visible: 2 }
    case KIND.SLIDER:
      // "Maximum level for 'SLIDER'. Default to 15."
      return { min: 0, max: 15, level: 0 }
    case KIND.STRING:
      return { string: '' }
    case KIND.TEXT:
      return { displayText: '' }
    default:
      return {}
  }
}

/**
 * Which tags each kind reads.
 *
 * gadtools ignores a tag that is not this kind's, which is what makes one tag
 * list usable across a row of different gadgets. The guide's sections are the
 * grouping, so a tag appears here under exactly the kinds it is printed
 * under: GTNM_Justification and GTNM_Clipped are documented for both NUMBER
 * and TEXT and so belong to both.
 */
function applyTag(g: Gadget, tag: number, data: number, strings: Map<number, string>, lists: Map<number, readonly string[]>): boolean {
  const str = (): string => strings.get(data) ?? ''
  const list = (): readonly string[] => lists.get(data) ?? []
  switch (g.kind) {
    case KIND.CHECKBOX:
      if (tag === TAG.GTCB_Checked) return ((g.checked = data !== 0), true)
      break
    case KIND.INTEGER:
      if (tag === TAG.GTIN_Number) return ((g.number = data), true)
      if (tag === TAG.GTIN_MaxChars) return ((g.maxChars = data), true)
      break
    case KIND.LISTVIEW:
      if (tag === TAG.GTLV_Labels) return ((g.listLabels = list()), true)
      if (tag === TAG.GTLV_Top) return ((g.top = data), true)
      if (tag === TAG.GTLV_Selected) return ((g.selected = data), true)
      break
    case KIND.MX:
      if (tag === TAG.GTMX_Labels) return ((g.labels = list()), true)
      if (tag === TAG.GTMX_Active) return ((g.active = data), true)
      break
    case KIND.NUMBER:
      if (tag === TAG.GTNM_Number) return ((g.number = data), true)
      break
    case KIND.CYCLE:
      if (tag === TAG.GTCY_Labels) return ((g.labels = list()), true)
      if (tag === TAG.GTCY_Active) return ((g.active = data), true)
      break
    case KIND.PALETTE:
      if (tag === TAG.GTPA_Depth) return ((g.paletteDepth = data), true)
      if (tag === TAG.GTPA_Color) return ((g.color = data), true)
      if (tag === TAG.GTPA_ColorOffset) return ((g.colorOffset = data), true)
      break
    case KIND.SCROLLER:
      if (tag === TAG.GTSC_Top) return ((g.top = data), true)
      if (tag === TAG.GTSC_Total) return ((g.total = data), true)
      if (tag === TAG.GTSC_Visible) return ((g.visible = data), true)
      break
    case KIND.SLIDER:
      if (tag === TAG.GTSL_Min) return ((g.min = data), true)
      if (tag === TAG.GTSL_Max) return ((g.max = data), true)
      if (tag === TAG.GTSL_Level) return ((g.level = data), true)
      break
    case KIND.STRING:
      if (tag === TAG.GTST_String) return ((g.string = str()), true)
      if (tag === TAG.GTST_MaxChars) return ((g.maxChars = data), true)
      break
    case KIND.TEXT:
      if (tag === TAG.GTTX_Text) return ((g.displayText = str()), true)
      break
    default:
      break
  }
  return false
}

/**
 * `struct NewMenu`, the flat array a caller builds a whole menu strip from.
 *
 * TWENTY BYTES, read off `gui-1.61`. Its walk at $257c sets a0 to entry+2,
 * reads nm_Type through `move.b -$2(a0)`, nm_Label at `(a0)`, nm_CommKey at
 * `$4(a0)`, and steps with `lea $14(a0),a0`. Twenty from nm_Label lands on
 * the next entry's nm_Label, so the entry is twenty and the fields sit at 0,
 * 2 and 6.
 *
 * The guide states the rest of the order from the other side, as the argument
 * list of its own wrapper: `_gmn Set NEWMENU,TYPE,PTXT,COMKEY,FLAGS,MUTEXCL,
 * USER`. Type, Label, CommKey, Flags, MutualExclude, UserData is 1+1 pad, 4,
 * 4, 2, 4, 4, which is the same twenty.
 */
export const NEWMENU_SIZEOF = 20

/** the field offsets that arithmetic gives */
export const NEWMENU = {
  Type: 0,
  Label: 2,
  CommKey: 6,
  Flags: 10,
  MutualExclude: 12,
  UserData: 16,
} as const

/**
 * `nm_Type`, from the guide's `_gmn Set`, which prints the numbers:
 * "NM_TITLE = $1, NM_ITEM = $2, NM_SUB = $3, MENU_IMAGE = $80,
 * IM_ITEM = $82, IM_SUB = $83".
 *
 * END is 0 and the guide does not name it, but `gui-1.61` does: its walk at
 * $2584 is `tst.b d0 / beq`, so a zero type is what stops the array.
 */
export const NM = {
  END: 0,
  TITLE: 0x1,
  ITEM: 0x2,
  SUB: 0x3,
  /** the bit that makes a type's label an Image rather than a string */
  IMAGE: 0x80,
  IM_ITEM: 0x82,
  IM_SUB: 0x83,
} as const

/**
 * `BARLABEL`, the separator: nm_Label of -1 rather than a string.
 *
 * Both sources say it. The guide's `_gmn Set` has "PTXT -> Pointer of text
 * string or -1 for BARLABEL", and `gui-1.61` at $258a compares nm_Label with
 * `#$ffffffff` and jumps past its string fixups when it matches.
 */
export const BARLABEL = -1

/**
 * `nm_Flags`, from the same `_gmn Set` list.
 *
 * NOTE THE COLLISION, which is the guide's and not a transcription slip: it
 * prints NM_MENUDISABLED = $1 and CHECKIT = $1 in one list. They are the same
 * bit read against different types. A TITLE's $1 disables the menu, an ITEM's
 * $1 makes it checkable, and nothing but nm_Type tells them apart. Kept as
 * two names because that is what a caller writes.
 */
export const MENU_FLAG = {
  /** on a TITLE */
  NM_MENUDISABLED: 0x1,
  /** on an ITEM or SUB */
  NM_ITEMDISABLED: 0x10,
  /** on an ITEM or SUB: it carries a checkmark */
  CHECKIT: 0x1,
  /** on an ITEM or SUB: selecting it toggles rather than only setting */
  MENUTOGGLE: 0x8,
  /** on an ITEM or SUB: it starts checked */
  CHECKED: 0x100,
} as const

/**
 * MENUNULL, which an IDCMP MENUPICK carries when nothing was picked and which
 * ends a NextSelect chain.
 *
 * `gui-1.61` at $fca reads `$20(a0)` out of the MenuItem ItemAddress returned
 * and compares it with `#$ffff`. Offset 32 is MenuItem's NextSelect, the last
 * field of the struct, so this is both the sentinel AND a confirmation of
 * where NextSelect sits.
 */
export const MENUNULL = 0xffff

/**
 * How a menu number packs, read out of `gui-1.61` $f64-$f80. It takes the
 * stored number apart three ways in a row:
 *
 *     move.w $ae(a1),d3
 *     move.w d3,d1 / andi.w #$1f,d1              -> d4, the menu
 *     move.w d3,d1 / ror.w #$5,d1  / andi.w #$3f,d1  -> d5, the item
 *     move.w d3,d1 / ror.w #$8,d1  / ror.w #$3,d1 / andi.w #$1f,d1  -> d6, the sub
 *
 * Five bits of menu, six of item, five of sub, in that order from the bottom.
 * `ror` rather than `lsr` puts the low bits round at the top, and the mask
 * then drops them, so the two are the same here.
 */
export const MENU_SHIFT = 0
export const MENU_MASK = 0x1f
export const ITEM_SHIFT = 5
export const ITEM_MASK = 0x3f
export const SUB_SHIFT = 11
export const SUB_MASK = 0x1f

/** the "none" value of each field, which is its mask: all bits set */
export const NOMENU = MENU_MASK
export const NOITEM = ITEM_MASK
export const NOSUB = SUB_MASK

/** MENUNUM(n) */
export function menuNum(n: number): number {
  return n & MENU_MASK
}

/** ITEMNUM(n) */
export function itemNum(n: number): number {
  return (n >> ITEM_SHIFT) & ITEM_MASK
}

/** SUBNUM(n) */
export function subNum(n: number): number {
  return (n >> SUB_SHIFT) & SUB_MASK
}

/** FULLMENUNUM(menu, item, sub), the three packed back into one word */
export function fullMenuNum(menu: number, item: number, sub: number): number {
  return ((menu & MENU_MASK) | ((item & ITEM_MASK) << ITEM_SHIFT) | ((sub & SUB_MASK) << SUB_SHIFT)) & 0xffff
}

/** one entry of the array a caller hands CreateMenusA */
export interface NewMenu {
  /** nm_Type: one of NM.* */
  type: number
  /** nm_Label: the text, or BARLABEL for a separator */
  label: string | typeof BARLABEL
  /** nm_CommKey: the right-Amiga shortcut, one character */
  commKey?: string
  /** nm_Flags */
  flags?: number
  /** nm_MutualExclude */
  mutualExclude?: number
  /** nm_UserData */
  userData?: number
}

/**
 * `struct MenuItem`, as much of it as this port fills in.
 *
 * The geometry is what LayoutMenusA computes and what a hit test reads back.
 * `nextSelect` is offset 32 and is the field `gui-1.61` checks against
 * MENUNULL.
 */
export interface MenuItem {
  label: string | typeof BARLABEL
  commKey: string
  flags: number
  mutualExclude: number
  userData: number
  /** its own number within its parent, counting BARLABELs */
  index: number
  leftEdge: number
  topEdge: number
  width: number
  height: number
  /** CHECKIT items only; CHECKED sets it */
  checked: boolean
  disabled: boolean
  /**
   * The next number in a multi-select chain, MENUNULL when there is none.
   *
   * Intuition fills it in when the user picks several items before letting go
   * of the menu button, and a program walks it rather than waiting for more
   * messages. `gui-2.10` reads it at $1d74 and stops on MENUNULL at $1d78,
   * which is `Gui Menu(4)`.
   */
  nextSelect: number
  subItems: MenuItem[]
}

/** `struct Menu`: one title on the bar, and the items under it */
export interface Menu {
  label: string
  flags: number
  index: number
  leftEdge: number
  topEdge: number
  width: number
  height: number
  disabled: boolean
  items: MenuItem[]
}

/** what CreateMenusA returns: the whole strip, plus whether it has been laid out */
export interface MenuStrip {
  readonly address: number
  menus: Menu[]
  laidOut: boolean
  freed: boolean
}

/**
 * The bar and item geometry LayoutMenusA computes.
 *
 * MODELLED, all of it. `_gmn Layout` is documented only as "initializes the
 * necessary Menus structures for its trace", and nothing held here measures
 * a real menu. What is reproduced is the SHAPE every Amiga menu has: titles
 * laid left to right along a bar, each item column dropping from its title,
 * every column as wide as its widest label. The numbers below are the
 * defaults a caller can override rather than claims about Intuition.
 */
export interface MenuLayout {
  /** the font cell, which everything else is counted in */
  charWidth: number
  charHeight: number
  /** the bar's height */
  barHeight: number
  /** the gap either side of a title on the bar */
  titlePad: number
  /** room at the left of an item for its checkmark */
  checkWidth: number
  /** room at the right of an item for its command key */
  commandWidth: number
  /** a BARLABEL's height, which is not a text row */
  barLabelHeight: number
}

/** topaz metrics, which is what every screen in this port is set in */
export const DEFAULT_MENU_LAYOUT: MenuLayout = {
  charWidth: 8,
  charHeight: 8,
  barHeight: 10,
  titlePad: 8,
  checkWidth: 24,
  commandWidth: 24,
  barLabelHeight: 2,
}

/**
 * `gadtools.library` as a caller sees it.
 *
 * One instance per opened library, so that FreeGadgets on one caller's
 * context cannot reach another's. gadtools on the machine keeps no such
 * separation, because a Gadget list IS the separation: everything below takes
 * the head of a list and walks it.
 */
export class GadTools {
  private nextGadget = GADGET_ORIGIN
  private nextVisual = VISUAL_ORIGIN
  private nextStrip = STRIP_ORIGIN
  private readonly gadgets = new Map<number, Gadget>()
  private readonly visuals = new Map<number, VisualInfo>()
  private readonly strips = new Map<number, MenuStrip>()
  private outstanding = 0

  /**
   * Strings and label arrays a caller wants to reach by address.
   *
   * A tag's `data` is a longword, so `GTST_String` and `GTCY_Labels` arrive
   * as pointers on the machine. Nothing in this port has a byte array to
   * point into, so a caller registers the value and passes back the token it
   * gets. The alternative was a `string | number` union on every tag, which
   * would have made the tag list stop looking like a tag list.
   */
  private readonly strings = new Map<number, string>()
  private readonly lists = new Map<number, readonly string[]>()
  private nextDatum = 1

  /** register a string and get the number to put in a tag's `data` */
  stringRef(s: string): number {
    const at = this.nextDatum++
    this.strings.set(at, s)
    return at
  }

  /** register a NULL-terminated label array and get the number for its tag */
  listRef(items: readonly string[]): number {
    const at = this.nextDatum++
    this.lists.set(at, items)
    return at
  }

  /**
   * `GetVisualInfoA(screen, taglist)` (-126).
   *
   * The tag list is `GTVI_NewWindow` and `GTVI_NWTags` on the machine, and
   * neither GUI binary passes either: both call it with a screen and nothing
   * else. Accepted and ignored rather than rejected, which is what gadtools
   * does with a tag it has no use for.
   */
  getVisualInfo(screenSlot: number, drawInfo: DrawInfo): VisualInfo {
    const vi: VisualInfo = {
      address: this.nextVisual,
      screenSlot,
      drawInfo,
      freed: false,
    }
    this.nextVisual += STRIDE
    this.visuals.set(vi.address, vi)
    return vi
  }

  /** the VisualInfo behind an address, or null once freed or if never issued */
  visualInfo(address: number): VisualInfo | null {
    const vi = this.visuals.get(address)
    return vi === undefined || vi.freed ? null : vi
  }

  /** `FreeVisualInfo(vi)` (-132). Freeing an unknown address does nothing. */
  freeVisualInfo(address: number): void {
    const vi = this.visuals.get(address)
    if (vi !== undefined) vi.freed = true
  }

  /**
   * `CreateContext(glistptr)` (-114).
   *
   * Returns the gadget a caller then passes as `previous` to its first
   * CreateGadgetA. On the machine this is a real Gadget of no kind, which is
   * why AddGList is given the context and not the first real gadget, and why
   * FreeGadgets takes the context too.
   */
  createContext(): Gadget {
    return this.newGadget(KIND.GENERIC, {
      leftEdge: 0,
      topEdge: 0,
      width: 0,
      height: 0,
      gadgetText: '',
      gadgetID: 0,
      flags: 0,
      visualInfo: 0,
    })
  }

  /**
   * `CreateGadgetA(kind, gad, ng, taglist)` (-30).
   *
   * Null when `previous` is already freed or when the NewGadget names a
   * VisualInfo this never issued, which is gadtools' documented failure: it
   * returns NULL and a caller is expected to stop building. `gui-1.61` at
   * $245e does exactly that, `tst.l d0 / beq` straight out of the loop.
   */
  createGadget(kind: GadgetKind, previous: Gadget | null, ng: NewGadget, tags: readonly TagItem[] = []): Gadget | null {
    if (previous !== null && previous.freed) return null
    if (ng.visualInfo !== 0 && this.visualInfo(ng.visualInfo) === null) return null
    const g = this.newGadget(kind, ng)
    for (const t of tags) {
      if (t.tag === TAG_DONE) break
      applyTag(g, t.tag, t.data, this.strings, this.lists)
    }
    if (previous !== null) previous.next = g
    return g
  }

  /**
   * `GT_SetGadgetAttrsA(gad, win, req, taglist)` (-42).
   *
   * Returns how many tags were this kind's, which is a convenience this port
   * adds: gadtools returns void. The count is what makes "a tag list shared
   * across a row of gadgets" testable, and nothing can mistake it for the
   * library's own answer because the library has none.
   */
  setGadgetAttrs(g: Gadget, tags: readonly TagItem[]): number {
    if (g.freed) return 0
    let taken = 0
    for (const t of tags) {
      if (t.tag === TAG_DONE) break
      if (applyTag(g, t.tag, t.data, this.strings, this.lists)) taken++
    }
    return taken
  }

  /**
   * `FreeGadgets(gad)` (-36). Walks the chain from the context down, so a
   * caller frees the whole interface with the one pointer it kept.
   */
  freeGadgets(head: Gadget | null): number {
    let n = 0
    for (let g = head; g !== null; g = g.next) {
      if (g.freed) continue
      g.freed = true
      n++
    }
    return n
  }

  /** the Gadget behind an address, or null once freed or if never issued */
  gadget(address: number): Gadget | null {
    const g = this.gadgets.get(address)
    return g === undefined || g.freed ? null : g
  }

  /** every gadget in a chain, context first, for a caller that wants to walk it */
  chain(head: Gadget | null): Gadget[] {
    const out: Gadget[] = []
    for (let g = head; g !== null; g = g.next) out.push(g)
    return out
  }

  private newGadget(kind: GadgetKind, ng: NewGadget): Gadget {
    const g: Gadget = {
      address: this.nextGadget,
      kind,
      leftEdge: ng.leftEdge,
      topEdge: ng.topEdge,
      width: ng.width,
      height: ng.height,
      text: ng.gadgetText,
      id: ng.gadgetID,
      flags: ng.flags,
      userData: ng.userData ?? 0,
      visualInfo: ng.visualInfo,
      next: null,
      disabled: false,
      freed: false,
      ...kindDefaults(kind),
    }
    this.nextGadget += STRIDE
    this.gadgets.set(g.address, g)
    return g
  }

  /**
   * `CreateMenusA(newmenu, taglist)` (-48).
   *
   * Walks the flat array into the tree Intuition wants: a TITLE opens a menu,
   * an ITEM hangs off the open one, a SUB off the open item. The array ends
   * at the first NM.END, which is what `gui-1.61` at $2584 tests for with
   * `tst.b d0 / beq` rather than reading a count.
   *
   * Null when the array is malformed, which gadtools also answers with NULL:
   * an ITEM before any TITLE, or a SUB before any ITEM, has nowhere to go.
   *
   * The tag list is GTMN_TextAttr, GTMN_FrontPen and the two V39 imagery
   * tags. None changes the tree, so it is accepted and kept for LayoutMenusA
   * rather than acted on here.
   */
  createMenus(entries: readonly NewMenu[], tags: readonly TagItem[] = []): MenuStrip | null {
    void tags
    const menus: Menu[] = []
    let menu: Menu | null = null
    let item: MenuItem | null = null
    for (const e of entries) {
      if (e.type === NM.END) break
      // MENU_IMAGE only says the label is an Image rather than a string, so
      // IM_ITEM and NM_ITEM build the same node
      const kind = e.type & ~NM.IMAGE
      if (kind === NM.TITLE) {
        menu = {
          label: e.label === BARLABEL ? '' : e.label,
          flags: e.flags ?? 0,
          index: menus.length,
          leftEdge: 0,
          topEdge: 0,
          width: 0,
          height: 0,
          disabled: ((e.flags ?? 0) & MENU_FLAG.NM_MENUDISABLED) !== 0,
          items: [],
        }
        menus.push(menu)
        item = null
        continue
      }
      if (kind === NM.ITEM) {
        if (menu === null) return null
        item = this.newMenuItem(e, menu.items.length)
        menu.items.push(item)
        continue
      }
      if (kind === NM.SUB) {
        if (item === null) return null
        item.subItems.push(this.newMenuItem(e, item.subItems.length))
        continue
      }
      return null
    }
    const strip: MenuStrip = { address: this.nextStrip, menus, laidOut: false, freed: false }
    this.nextStrip += STRIDE
    this.strips.set(strip.address, strip)
    return strip
  }

  /**
   * `LayoutMenusA(firstmenu, vi, taglist)` (-66).
   *
   * False when the strip or the VisualInfo is gone, which is the 0 the
   * guide's `_gmn Layout` promises "(0 if Failure)". `gui-1.61` at $25e2
   * calls it with a0 still holding CreateMenusA's result, a1 the VisualInfo
   * and a2 a list of GTMN_NewLookMenus set to -1, which is the .fd's
   * `(a0/a1/a2)` exactly.
   *
   * See `MenuLayout` for how much of the geometry is modelled. All of it.
   */
  layoutMenus(strip: MenuStrip, visualInfo: number, layout: MenuLayout = DEFAULT_MENU_LAYOUT): boolean {
    if (strip.freed || this.visualInfo(visualInfo) === null) return false
    let x = 0
    for (const menu of strip.menus) {
      menu.leftEdge = x
      menu.topEdge = 0
      menu.width = menu.label.length * layout.charWidth + layout.titlePad
      menu.height = layout.barHeight
      x += menu.width

      // the column drops from the title and is as wide as its widest row
      let widest = 0
      for (const it of menu.items) widest = Math.max(widest, this.itemWidth(it, layout))
      let y = layout.barHeight
      for (const it of menu.items) {
        it.leftEdge = menu.leftEdge
        it.topEdge = y
        it.width = widest
        it.height = it.label === BARLABEL ? layout.barLabelHeight : layout.charHeight
        y += it.height
        let subWidest = 0
        for (const s of it.subItems) subWidest = Math.max(subWidest, this.itemWidth(s, layout))
        let sy = it.topEdge
        for (const s of it.subItems) {
          s.leftEdge = it.leftEdge + widest
          s.topEdge = sy
          s.width = subWidest
          s.height = s.label === BARLABEL ? layout.barLabelHeight : layout.charHeight
          sy += s.height
        }
      }
    }
    strip.laidOut = true
    return true
  }

  /** `FreeMenus(menu)` (-54) */
  freeMenus(strip: MenuStrip): boolean {
    if (strip.freed) return false
    strip.freed = true
    return true
  }

  /** the strip behind an address, or null once freed or if never issued */
  menuStrip(address: number): MenuStrip | null {
    const s = this.strips.get(address)
    return s === undefined || s.freed ? null : s
  }

  /**
   * `ItemAddress(menustrip, menunumber)`, which is intuition's (-$90) rather
   * than gadtools'. It is here because the menu tree is here and nothing else
   * can walk it.
   *
   * Null for MENUNULL and for any field that names something absent, which is
   * what `gui-1.61` guards against at $fca before reading NextSelect.
   */
  itemAddress(strip: MenuStrip, number: number): MenuItem | null {
    if (strip.freed || number === MENUNULL) return null
    const m = strip.menus[menuNum(number)]
    if (m === undefined) return null
    const i = m.items[itemNum(number)]
    if (i === undefined) return null
    const s = subNum(number)
    if (s === NOSUB) return i
    return i.subItems[s] ?? null
  }

  /**
   * `OnMenu(window, menunumber)` (-$c0) and `OffMenu` (-$b4), intuition's
   * pair, here for the same reason `itemAddress` is: the tree is here.
   *
   * A number whose ITEMNUM is NOITEM names the MENU, and the whole column
   * goes with it. Otherwise it names one item or sub-item.
   *
   * `gui-2.10` calls them straight off its own packer at $4246 and $4272,
   * with nothing between the AMOS arguments and the library, so what the
   * keyword can reach is exactly what intuition can.
   */
  onMenu(strip: MenuStrip, number: number): boolean {
    return this.setMenuEnabled(strip, number, true)
  }

  /** `OffMenu(window, menunumber)` (-$b4) */
  offMenu(strip: MenuStrip, number: number): boolean {
    return this.setMenuEnabled(strip, number, false)
  }

  private setMenuEnabled(strip: MenuStrip, number: number, on: boolean): boolean {
    if (strip.freed) return false
    const menu = strip.menus[menuNum(number)]
    if (menu === undefined) return false
    if (itemNum(number) === NOITEM) {
      menu.disabled = !on
      return true
    }
    const it = this.itemAddress(strip, number)
    if (it === null) return false
    it.disabled = !on
    return true
  }

  /**
   * Selecting an item, with the mutual exclusion the guide describes.
   *
   * "you go to specify which items will be put in state no 'CHECKED' when
   * this item will be selected", by a bit per item number in nm_MutualExclude,
   * and its closing note is the one that catches people: "The 'BARLABEL'
   * makes parties of Items count". A separator occupies a number, so the bits
   * above it shift.
   *
   * Only CHECKIT items have anything to toggle. MENUTOGGLE decides whether
   * picking an already-checked item clears it or leaves it set.
   */
  selectItem(strip: MenuStrip, number: number): MenuItem | null {
    const it = this.itemAddress(strip, number)
    if (it === null) return null
    if ((it.flags & MENU_FLAG.CHECKIT) === 0) return it
    it.checked = (it.flags & MENU_FLAG.MENUTOGGLE) !== 0 ? !it.checked : true
    for (const other of this.siblingsOf(strip, number)) {
      if (other === it) continue
      if ((it.mutualExclude & (1 << other.index)) !== 0) other.checked = false
    }
    return it
  }

  /**
   * The list an item's MutualExclude bits index into: its own list and not
   * its parent's. A sub-item's mask names other sub-items, which is why a
   * checked parent survives its child's exclusion.
   */
  private siblingsOf(strip: MenuStrip, number: number): readonly MenuItem[] {
    if (subNum(number) === NOSUB) return strip.menus[menuNum(number)]?.items ?? []
    const parent = this.itemAddress(strip, fullMenuNum(menuNum(number), itemNum(number), NOSUB))
    return parent?.subItems ?? []
  }

  /**
   * `GT_FilterIMsg(imsg)` (-102), the cooking every other message call is
   * built on.
   *
   * A message whose IAddress names a gadget this instance issued is a
   * gadtools gadget, and gadtools is what makes it mean something: it moves
   * the gadget's state on and puts the new value in Code. A message naming
   * anything else passes through untouched, which is what lets a program mix
   * gadtools gadgets with its own.
   *
   * SOURCED: that IAddress is the Gadget, from `gui-1.61` $3352, which loads
   * it and immediately reads GadgetID out of `$26(a1)`. That a CHECKBOX's
   * state lives in GFLG_SELECTED rather than in Code, from $343a. That Code
   * carries the menu number on MENUPICK, from $347a comparing it with
   * MENUNULL.
   *
   * MODELLED: which kinds move on a click and by how much. A CHECKBOX
   * toggles and a CYCLE advances, wrapping, because that is what those two
   * controls are. gadtools' own rules for a mid-drag SLIDER, where it decides
   * whether a MOUSEMOVE is worth a message at all, are not held here and are
   * not invented: a SLIDER reports whatever level it currently has.
   *
   * Returns null when the message is gadtools' own business and the caller
   * should not see it, which is the NULL a real GT_FilterIMsg returns.
   */
  filterIMsg(msg: IntuiMessage): IntuiMessage | null {
    const g = this.gadget(msg.iaddress)
    if (g === null) return msg
    if (g.disabled) return null
    switch (g.kind) {
      case KIND.CHECKBOX:
        if (msg.class === IDCMP_GADGETUP) g.checked = g.checked !== true
        return { ...msg, code: g.checked === true ? 1 : 0 }
      case KIND.CYCLE: {
        const n = g.labels?.length ?? 0
        if (msg.class === IDCMP_GADGETUP && n > 0) g.active = ((g.active ?? 0) + 1) % n
        return { ...msg, code: g.active ?? 0 }
      }
      case KIND.MX:
        return { ...msg, code: g.active ?? 0 }
      case KIND.LISTVIEW:
        return { ...msg, code: g.selected ?? 0 }
      case KIND.SLIDER:
        return { ...msg, code: g.level ?? 0 }
      case KIND.SCROLLER:
        return { ...msg, code: g.top ?? 0 }
      default:
        return msg
    }
  }

  /**
   * `GT_GetIMsg(iport)` (-72).
   *
   * Pops from the window's port and filters, and keeps going when the filter
   * swallows one, so a caller only ever sees messages that mean something.
   * Null when the port runs dry, which is what `gui-1.61` tests for twice:
   * at $3288 in its event loop, and at $2d3a in the loop that empties a port
   * before closing a window.
   *
   * `port` is anything with GetMsg, so this takes an `intuition.ts` Window
   * without gadtools having to know what a window is.
   */
  getIMsg(port: { getMsg(): IntuiMessage | null }): IntuiMessage | null {
    for (;;) {
      const raw = port.getMsg()
      if (raw === null) return null
      const cooked = this.filterIMsg(raw)
      if (cooked !== null) {
        this.outstanding++
        return cooked
      }
    }
  }

  /**
   * `GT_ReplyIMsg(imsg)` (-78).
   *
   * Nothing here holds the message afterwards, so this exists to be COUNTED.
   * A program that never replies leaks Intuition's free list on the machine
   * and costs nothing here, and the same difference is already written down
   * on `Window.getMsg`. Counting turns "did the caller reply" from invisible
   * into testable, and both of gui-1.61's loops do reply.
   */
  replyIMsg(): void {
    if (this.outstanding > 0) this.outstanding--
  }

  /** `GT_PostFilterIMsg(imsg)` (-108), the partner GT_FilterIMsg's caller owes */
  postFilterIMsg(): void {
    this.replyIMsg()
  }

  /** how many messages have been handed out and not replied to */
  get unreplied(): number {
    return this.outstanding
  }

  /**
   * `GT_RefreshWindow(win, req)` (-84): redraw every gadtools gadget in a
   * window, which is what a caller does after IDCMP_REFRESHWINDOW.
   *
   * Takes the chain rather than a window, because a window here has no idea
   * which of its gadgets came from gadtools and the chain is what the caller
   * kept from CreateContext.
   */
  refreshWindow(rp: RastPort, head: Gadget | null, dri: DrawInfo): number {
    let n = 0
    for (const g of this.chain(head)) {
      if (g.freed || g.kind === KIND.GENERIC) continue
      renderGadget(rp, g, dri)
      n++
    }
    return n
  }

  private itemWidth(it: MenuItem, layout: MenuLayout): number {
    if (it.label === BARLABEL) return layout.checkWidth
    const text = it.label.length * layout.charWidth
    return layout.checkWidth + text + (it.commKey === '' ? 0 : layout.commandWidth)
  }

  private newMenuItem(e: NewMenu, index: number): MenuItem {
    const flags = e.flags ?? 0
    return {
      label: e.label,
      commKey: e.commKey ?? '',
      flags,
      mutualExclude: e.mutualExclude ?? 0,
      userData: e.userData ?? 0,
      index,
      leftEdge: 0,
      topEdge: 0,
      width: 0,
      height: 0,
      checked: (flags & MENU_FLAG.CHECKIT) !== 0 && (flags & MENU_FLAG.CHECKED) !== 0,
      disabled: (flags & MENU_FLAG.NM_ITEMDISABLED) !== 0,
      nextSelect: MENUNULL,
      subItems: [],
    }
  }

  /**
   * `DrawBevelBoxA(rport, left, top, width, height, taglist)` (-120).
   *
   * See `drawBevelBox` for what is and is not evidence about the pixels. This
   * method exists so a caller can pass the tag list it already has, with the
   * GT_VisualInfo resolved through the addresses this instance issued, which
   * is exactly what both GUI extensions substitute into a caller's list
   * before making the call.
   */
  drawBevelBoxA(rp: RastPort, left: number, top: number, width: number, height: number, tags: readonly TagItem[]): boolean {
    const vi = this.visualInfo(findTag(tags, TAG.GT_VisualInfo, 0))
    if (vi === null) return false
    drawBevelBox(rp, left, top, width, height, vi.drawInfo, {
      recessed: findTag(tags, GTBB_RECESSED, 0) !== 0,
      frameType: findTag(tags, GTBB_FRAMETYPE, 0),
    })
    return true
  }
}

/** what `drawBevelBox` reads out of a tag list, once the tags are resolved */
export interface BevelOptions {
  /** GTBB_Recessed: the colours swap, "like a pushed button" */
  recessed?: boolean
  /**
   * GTBB_FrameType: accepted and not acted on.
   *
   * No document held here gives its values, so drawing a second design would
   * mean inventing one and attributing it to gadtools. It is taken rather
   * than rejected because a caller passing it is doing nothing wrong, and
   * `gadtools.test.ts` asserts that two frame types produce identical pixels
   * so the omission is a measured fact rather than a comment.
   */
  frameType?: number
}

/**
 * `DrawBevelBoxA`, the one thing gadtools draws that is not a gadget.
 *
 * ## The evidence, and where it stops
 *
 * SOURCED: that recessed swaps the two colours. OS DevKit's guide says of its
 * REC argument "If 'True' the colours are 'swaped' like a pushed button", and
 * GUI 2.10's says of its `mode` "If mode is set to anything other than 0,
 * then the box is drawn recessed". Two manuals, two extensions, same word.
 *
 * SOURCED: that the two colours are SHINEPEN and SHADOWPEN, in the sense that
 * those are the two pens the DrawInfo array carries for exactly this purpose
 * and no other pen pair could be meant. `os_refs.guide` gives them as indices
 * 3 and 4.
 *
 * MODELLED: WHICH EDGES GET WHICH. Nothing held here states it. Workbench
 * lights its interface from the top left, so raised takes shine along the top
 * and left and shadow along the bottom and right, and recessed is that
 * swapped. It is the convention every Amiga interface of the era used, and it
 * is still a convention rather than something read off a binary or a page.
 * This sentence is here so a reader knows which half to distrust.
 *
 * MODELLED: the box is one pixel thick. gadtools' own is two on a hires
 * screen, and no measurement of it exists here.
 */
export function drawBevelBox(
  rp: RastPort,
  left: number,
  top: number,
  width: number,
  height: number,
  dri: DrawInfo,
  opts: BevelOptions = {},
): void {
  if (width <= 0 || height <= 0) return
  const shine = penOf(dri, PEN.SHINE)
  const shadow = penOf(dri, PEN.SHADOW)
  const upper = opts.recessed === true ? shadow : shine
  const lower = opts.recessed === true ? shine : shadow
  const right = left + width - 1
  const bottom = top + height - 1
  rp.draw(left, top, right, top, upper)
  rp.draw(left, top, left, bottom, upper)
  rp.draw(left, bottom, right, bottom, lower)
  rp.draw(right, top, right, bottom, lower)
}

/**
 * One pen out of a DrawInfo, clamped to what the array actually holds.
 *
 * dri_NumPens is a real field and a real limit: a V1 DrawInfo carries nine
 * pens and BARTRIMPEN is not one of them. Asking for a pen past the end
 * answers pen 0 rather than undefined, since a caller that reads off the end
 * of a struct on the machine gets whatever is there and not a crash.
 */
export function penOf(dri: DrawInfo, index: number): number {
  if (index >= dri.numPens) return dri.pens[0] ?? 0
  return dri.pens[index] ?? 0
}

/**
 * A gadget's frame: the bevel every kind sits in, and the direction it faces.
 *
 * SOURCED, and it is the only per-kind appearance any document held here
 * states: the guide says of both GTNM_Border and GTTX_Border that "a
 * 'RECESSED' rectancle will be poster about of gadget", so a NUMBER or TEXT
 * gadget is recessed when it asks for a border and has no frame at all when
 * it does not. STRING and INTEGER take typing, and gadtools draws a typing
 * field recessed on every screenshot of the era.
 *
 * MODELLED: everything else. A BUTTON stands out, so it is raised, which is
 * what "swaped like a pushed button" implies about which way a button faces
 * when it is not pushed. The rest take a raised frame because they are
 * controls rather than fields.
 *
 * Returns null for a kind that draws no frame, which is a real answer rather
 * than a missing one: a bordered NUMBER and an unbordered NUMBER differ, and
 * this is where that difference lives.
 */
export function frameOf(g: Gadget, bordered = false): 'raised' | 'recessed' | null {
  switch (g.kind) {
    case KIND.GENERIC:
      return null
    case KIND.NUMBER:
    case KIND.TEXT:
      return bordered ? 'recessed' : null
    case KIND.STRING:
    case KIND.INTEGER:
    case KIND.LISTVIEW:
      return 'recessed'
    default:
      return 'raised'
  }
}

/**
 * What a gadget shows: the string its kind puts inside its own box.
 *
 * Not the same as `Gadget.text`, which is ng_GadgetText and is the LABEL
 * beside or above the gadget. A CYCLE's box shows whichever of its labels is
 * active; a STRING's shows what has been typed into it; a NUMBER's shows its
 * number. Splitting them is what lets a caller draw the label once and the
 * contents on every change, which is the whole point of GT_SetGadgetAttrsA.
 *
 * Empty for the kinds whose interior is imagery rather than text.
 */
export function contentOf(g: Gadget): string {
  switch (g.kind) {
    case KIND.STRING:
      return g.string ?? ''
    case KIND.NUMBER:
    case KIND.INTEGER:
      return String(g.number ?? 0)
    case KIND.TEXT:
      return g.displayText ?? ''
    case KIND.CYCLE:
      return g.labels?.[g.active ?? 0] ?? ''
    case KIND.LISTVIEW:
      return g.listLabels?.[g.selected ?? 0] ?? ''
    case KIND.BUTTON:
      return g.text
    default:
      return ''
  }
}

/**
 * Render one gadget into a RastPort: its frame, then its contents.
 *
 * The interior is filled with BACKGROUNDPEN before anything is drawn on it,
 * because a gadget redrawn after GT_SetGadgetAttrsA has to cover what the
 * last value left behind, and a shorter number over a longer one is the case
 * that shows it.
 *
 * See `frameOf` for which half of this is sourced. The contents are centred
 * vertically on the box and inset one character from its left edge, which is
 * MODELLED: nothing held here measures gadtools' text placement.
 */
export function renderGadget(rp: RastPort, g: Gadget, dri: DrawInfo, bordered = false): void {
  if (g.freed || g.width <= 0 || g.height <= 0) return
  const right = g.leftEdge + g.width - 1
  const bottom = g.topEdge + g.height - 1
  rp.rectFill(g.leftEdge, g.topEdge, right, bottom, penOf(dri, PEN.BACKGROUND))

  const frame = frameOf(g, bordered)
  if (frame !== null) {
    drawBevelBox(rp, g.leftEdge, g.topEdge, g.width, g.height, dri, { recessed: frame === 'recessed' })
  }

  const body = contentOf(g)
  if (body === '' || rp.font === null) return
  const pen = penOf(dri, g.disabled ? PEN.SHADOW : PEN.TEXT)
  const inset = frame === null ? 1 : 2
  const baseline = g.topEdge + Math.floor((g.height - rp.font.ySize) / 2) + rp.font.baseline
  rp.text(g.leftEdge + inset, baseline, body, pen)
}
