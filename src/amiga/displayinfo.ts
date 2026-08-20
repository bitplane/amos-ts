/**
 * graphics.library's display database, as far as one monitor driver fills it.
 *
 * ## Where every number here comes from
 *
 * `Devs/Monitors/PAL` in the corpus is an ordinary hunk binary carrying
 * `$VER: pal 39.3 (27.8.92)`, and at file offset `0x12d8` it holds a table of
 * six eight-byte records: a DisplayID and a pointer to its name. The pointers
 * are hunk-relative and the hunk's data begins `0x24` into the file, so
 * `0x2ba` is `0x2de` is `PAL:Low Res`. Both halves of every row below are
 * read out of that table.
 *
 * The MONITOR and KEY constants that compose those ids are the header's, from
 * `MUI.Equates` in EasyLife 1.10's archive --- `PAL_MONITOR_ID $21000`,
 * `HIRES_KEY $8000`, `SUPER_KEY $8020`, `LORESLACE_KEY $4` --- and the six
 * ids in the file are exactly those crossed, which is the check that the two
 * sources agree.
 *
 * ## Why PAL and only PAL
 *
 * A machine reports the monitors whose drivers are installed, and on the
 * Workbench 3.0 install in the corpus `Devs/Monitors` holds ONE file, PAL.
 * The other nine sit uninstalled in `Storage/Monitors`. So this is what that
 * machine's database holds, and it is also the display this port already
 * models: PAL, 256 lines, `Display.COMPOSITE_LINES`.
 *
 * A 1995 letter to Andrew Church, kept as `screenmodes.txt` in the
 * Intuition-41.95 archive, is the corroboration from a machine with more of
 * them installed: *"Screen modes reported as follows: NTSC - 00011000,
 * Multiscan - 00031000, Euro 72 - 00061000, Euro 36 - 00071000, DBLNTSC -
 * 00091000"*. Those are the monitor ids of the drivers that machine had.
 *
 * ## What is NOT here
 *
 * The SIZES are derived, not read. `pal 39.3` computes its DimensionInfo at
 * run time rather than storing the rectangles as literals --- searching the
 * file for `{0,0,319,255}` and its five siblings finds none of them --- so
 * the widths and heights below come from the key bits instead: the hires bit
 * doubles the width, the super bit doubles it again, and the lace bit doubles
 * the height. That keeps them consistent with the screens this port actually
 * opens, which matters more than matching a structure it cannot read.
 *
 * The same goes for a per-mode maximum depth. There is one on the machine and
 * it lives in that DimensionInfo; nothing here claims to know it.
 */

/** `MUI.Equates`: the monitor half of a DisplayID */
export const MONITOR = {
  DEFAULT: 0x0000_0000,
  NTSC: 0x0001_1000,
  PAL: 0x0002_1000,
  VGA: 0x0003_1000,
} as const

/** `MUI.Equates`: the mode half, which ORs onto a monitor id */
export const MODE_KEY = {
  LORES: 0x0000,
  HIRES: 0x8000,
  SUPER: 0x8020,
  LACE: 0x0004,
  HAM: 0x0800,
  EXTRAHALFBRITE: 0x0080,
} as const

/** one row of the database, which is what `NextDisplayInfo` walks */
export interface DisplayMode {
  /** the DisplayID a program passes to OpenScreen and reads back */
  id: number
  /** the driver's own name for it, from the table at `0x12d8` */
  name: string
  width: number
  height: number
}

/** PAL's nominal geometry, which is the display this port models */
const PAL_WIDTH = 320
const PAL_HEIGHT = 256

/** the width and height a key implies: hires doubles, super doubles again */
function sizeOfKey(key: number): { width: number; height: number } {
  const width = (key & MODE_KEY.SUPER) === MODE_KEY.SUPER ? PAL_WIDTH * 4 : (key & MODE_KEY.HIRES) !== 0 ? PAL_WIDTH * 2 : PAL_WIDTH
  return { width, height: (key & MODE_KEY.LACE) !== 0 ? PAL_HEIGHT * 2 : PAL_HEIGHT }
}

/**
 * The six modes `pal 39.3` registers, in the order its own table has them.
 *
 * Not sorted: the requester lists what the database walk gives it, and the
 * driver's order is lores, hires, super, then the three laced ones.
 */
export const DISPLAY_MODES: readonly DisplayMode[] = (
  [
    [MODE_KEY.LORES, 'PAL:Low Res'],
    [MODE_KEY.HIRES, 'PAL:High Res'],
    [MODE_KEY.SUPER, 'PAL:Super-High Res'],
    [MODE_KEY.LORES | MODE_KEY.LACE, 'PAL:Low Res Laced'],
    [MODE_KEY.HIRES | MODE_KEY.LACE, 'PAL:High Res Laced'],
    [MODE_KEY.SUPER | MODE_KEY.LACE, 'PAL:Super-High Res Laced'],
  ] as Array<[number, string]>
).map(([key, name]) => ({ id: MONITOR.PAL | key, name, ...sizeOfKey(key) }))

/** the row a DisplayID names, or null for one no installed driver claims */
export function displayModeOf(id: number): DisplayMode | null {
  return DISPLAY_MODES.find((m) => m.id === id) ?? null
}
