/**
 * The Games Master System's module registry, and the jump tables The Game
 * Extension reaches through it.
 *
 * GMS is Paul Manias / DreamWorld Productions and `dpkernel.library` is its
 * core: a program opens dpkernel, dpkernel loads MODULES, and each module
 * hands back a jump table of its own. TGE opens four by number and one by
 * name, so every GMS keyword in ../runtime/thegame.ts is a call through one
 * of the tables below.
 *
 * ## Where this comes from, and why it is a table rather than a comment
 *
 * The system is vendored at `fixtures/gms/` -- Aminet `dev/misc/gms_user.lha`,
 * the V2.1 user package of October 1998, carrying `dpkernel.library` V2.1
 * (July 1998), which is the version 2 that `G Init Gms` demands. `fixtures/`
 * is gitignored, so the tables are RECORDED here and `./gms.test.ts`
 * re-derives them from the binaries wherever those are present.
 *
 * A module's header points at a list of {code, name} pairs and the names
 * carry their own register signatures, so what follows is each module's own
 * account of itself rather than anybody's reading of it. The walk is checked
 * where it can be: `dev/misc/gms_colours.lha` publishes `colours.mod`'s
 * source, and the extraction matches its function list entry for entry, in
 * order. `screens.mod` and `blitter.mod` have no published source and are the
 * two TGE leans on hardest, which is what makes a self-describing table worth
 * this much trouble.
 *
 * None of DreamWorld's source is copied here -- it is read for semantics and
 * offsets only, as ../amiga/intuition.ts treats AROS.
 *
 * ## Numbering
 *
 * A module's number is its 1-based position in `GMS_MODULES`, which is one
 * run of twenty NUL-terminated names in dpkernel's data hunk. Ten of the
 * twenty are confirmed independently by the `.ref` files under
 * `System/References/`, each of which states its own `ModNumber`, and all ten
 * agree. An entry's LVO is likewise 1-based: entry `i` sits at `-6 * (i + 1)`.
 */

/** dpkernel's own module table; a module's number is its index plus one */
export const GMS_MODULES: readonly string[] = [
  'blitter', 'sound', 'screens', 'vectors', 'cactus', 'anim', 'cards', 'text',
  'objects', 'network', 'test', 'joyports', 'files', 'keyboard', 'pictures',
  'music', 'colours', 'collision', 'strings', 'config',
]

/** the four module numbers `G Init Gms` asks for */
export const GMS_MOD_BLITTER = 1
export const GMS_MOD_SOUND = 2
export const GMS_MOD_SCREENS = 3
export const GMS_MOD_COLOURS = 17

/** an entry's LVO: the table is 1-based and six bytes apart */
export const gmsLvo = (index: number): number => -6 * (index + 1)

/** the entry a negative LVO names, or undefined where the table has no slot */
export function gmsEntry(table: readonly string[], lvo: number): string | undefined {
  return lvo < 0 && lvo % 6 === 0 ? table[-lvo / 6 - 1] : undefined
}

/**
 * `screens.mod` -- the display: palettes, buffers, offsets, the vertical
 * blank. TGE holds its base at data-block +$ea.
 */
export const GMS_SCREENS_LVO: readonly string[] =   [
    'AllocVideoMem',
    'BlankColours',
    'BlankOn',
    'BlankOff',
    'ChangeColours',
    'ColourMorph',
    'ColourToPalette',
    'FreeVideoMem',
    'ReadySwitch',
    'WaitAVBL',
    'SetBmpOffsets',
    'MoveBitmap',
    'SetScrOffsets',
    'SetScrDimensions',
    'PaletteMorph',
    'PaletteToColour',
    'RefreshScreen',
    'RemakeScreen',
    'SwitchScreen',
    'ReturnDisplay',
    'SwapBuffers',
    'TakeDisplay',
    'UpdateColour',
    'UpdatePalette',
    'WaitRastLine',
    'WaitVBL',
    'WaitSwitch',
  ]

/**
 * `blitter.mod` -- everything that draws. TGE holds its base at +$e6, and
 * this is the table behind the drawing and bob batches.
 */
export const GMS_BLITTER_LVO: readonly string[] =   [
    'AllocBlitMem(d0l,d1l)',
    'DrawRGBPixel(a0l,d1w,d2,d3l)',
    'SortBobList(a0l,d0l)',
    'SortMBob(a0l,d0l)',
    'CopyBuffer()',
    'CreateMasks()',
    'DrawBob()',
    'DrawBobList()',
    'DrawLine(a0l,d0w,d1w,d2w,d3w,d4l)',
    'DrawPixel(a0l,d1w,d2w,d3l)',
    'DrawPixelList(a0l,a1l)',
    'DrawUCLine(a0l,d0w,d1w,d2w,d3w,d4l)',
    'DrawUCPixelList(a0l,a1l)',
    'DrawUCPixel(a0l,d1w,d2w,d3l)',
    'FreeBlitMem(d0l)',
    'DrawUCRGBPixel(a0l,d1w,d2w,d3l)',
    'ReadPixel(a0l,d1w,d2w)',
    'ReadPixelList(a0l,a1l)',
    'SetBobDimensions()',
    'SetBobDrawMode()',
    'SetBobFrames()',
    'TakeOSBlitter()',
    'GiveOSBlitter()',
    'ReadRGBPixel(a0l,d1w,d2w)',
    'DrawRGBLine(a0l,d0w,d1w,d2w,d3w,d4l)',
    'DrawUCRGBLine(a0l,d0w,d1w,d2w,d3w,d4l)',
    'DrawRGBPixelList()',
    'GetBmpType()',
    'PenRect(a0l,d0w,d1w,d2w,d3w,d5w)',
    'CopyLine()',
    'BlitArea(a0l,a1l,d0w,d1w,d2w,d3w,d4w,d5w,d6w)',
    'SetRGBPen(a0l,d0l)',
    'PenPixel(a0l,d0w,d1w)',
    'PenLine(a0l,d0w,d1w,d2w,d3w,d4l)',
    'GetRGBPen(a0l)',
    'PenUCLine(a0l,d0w,d1w,d2w,d3w,d4l)',
    'PenCircle(a0l,d0w,d1w,d2w)',
    'PenEllipse(a0l,d0w,d1w,d2w,d3)',
    'Flood(a0l,d0w,d1w,d2l)',
    'FlipHBitmap(a0l)',
    'FlipVBitmap(a0l)',
    'SetPenShape(a0l,d1w,d2w)',
    'PenLinePxl(a0l,d0w,d1w,d2w,d3w,d4l)',
    'DrawPen(a0l,d1w,d2w)',
  ]

/**
 * `colours.mod` -- palette arithmetic and the shading effects, at +$ee. This
 * is the module with published source, and the one that validates the walk.
 */
export const GMS_COLOURS_LVO: readonly string[] =   [
    'BlurArea(a0l,d0w,d1w,d2w,d3w,d4w)',
    'ClosestColour(d0l,a0l)',
    'ConvertHSVToRGB(a0l)',
    'ConvertRGBToHSV(d0l,a0l)',
    'CopyPalette(a0l,a1l,d0l,d1l,d2l)',
    'DarkenArea(a0l,d0w,d1w,d2w,d3w,d4w)',
    'LightenArea(a0l,d0w,d1w,d2w,d3w,d4w)',
    'RemapBitmap(a0l,a1l,d0w)',
    'DarkenPixel(a0l,d0w,d1w,d2w)',
    'LightenPixel(a0l,d0w,d1w,d2w)',
    'CalcBrightness(d0l)',
  ]

/**
 * `struct RGBPalette` is a longword array: `[1]` is how many colours it holds
 * and the colours start at `[2]`, each an `$00RRGGBB`. Read off `CopyPalette`
 * in the published `colours.mod` source, which range-checks against
 * `DestPalette[1]` and then adds 2 to both indices before copying; TGE's own
 * `G Def Palette` agrees from the other side, stepping `adda.l #$8,a0` past
 * the two before it writes.
 *
 * `ChangeColours` (screens.mod $cd4) does NOT take one of these. It takes a
 * bare array of `$00RRGGBB` longs -- `move.l (a1)+,d0` on the first iteration
 * reads the caller's word one -- packs each into the copper's 12-bit `$0RGB`
 * as it goes, and then copies the full longs into the screen's own palette.
 */
export const GMS_PALETTE_HEADER_LONGS = 2
