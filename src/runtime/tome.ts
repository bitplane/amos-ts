/**
 * TOME 4.23 / 3.1 — Aaron Fothergill's map-and-tile engine, at slot 7.
 *
 * The runtime half of The Map Editor: a program draws a scrolling tile map by
 * pointing the extension at a bank of map data and an AMOS icon bank, setting
 * a view rectangle, and calling `Map Do`. It is one of the best-known
 * third-party AMOS extensions and the only one in the registry whose
 * real-world demand is not self-referential — sixteen programs in the corpus
 * archive bind slot 7, among them W_W_O, Magic Forest II, Greenflag, Dungeon
 * and Driving Game.
 *
 * ## Evidence
 *
 * `TOME.Lib`, 8,548-byte code hunk, 77 routines, and NOTHING ELSE. No manual
 * ships with either fixture, so every line below is read off the binary; there
 * is no prose to check it against and none to be misled by.
 *
 * The version is the binary's own. Routine 27 is `Tme Ver$`, whose only job is
 * to report it, and the data block it reads holds `AMOS TOME Series IV`,
 * `TOME V4.23` and `TOME V4.23 Installed`, beside `(c) Shadow Software 1990`
 * and `by Aaron Fothergill`. This was registered as 4.0 (guessed from the
 * archive directory name) and then "corrected" to 4.24 from a secondary list.
 * Both were wrong. See the manifest.
 *
 * 3.1 IS A STRICT PREFIX. Its 35 table entries are identical to 4.23's first
 * 35 — id, name, spec and routine number — with one rename, `tile val bank`
 * to `tile typ bank` at id $1ba. So one port serves both and citations here
 * hold for either.
 *
 * ## The state block
 *
 * Everything hangs off `$158(a5)`, the extension's data block. The fields this
 * slice touches, all read out of the routines that write them:
 *
 *   $4   icon table base, and $8 the icon COUNT — both set by routine 70
 *   $a   map cursor x, $c map cursor y (words)
 *   $e   tile width as a LONG, $12 tile height as a LONG
 *   $10  and $14 are the LOW WORDS of those two longs, which the far-edge
 *        scrolls use directly as `divu.w` operands
 *   $16  map width in tiles, $18 map height in tiles (words, from the bank)
 *   $1a  the map bank number
 *   $20  $24 $28 $2c   view x1, y1, x2, y2 (longs)
 *   $4a  non-zero diverts the tile fetch into 4.23's animation path
 *
 * ## The map bank
 *
 * Two header words then a byte per tile, row-major: `move.w $0(a1)` is the
 * width in tiles, `move.w $2(a1)` the height, and the data is indexed
 * `$4(a1, d0.l)` where `d0 = y * width + x`. A tile byte is 0-based and the
 * icon it draws is `tile + 1` — `addq.l #$1,d1` in every drawing routine — so
 * tile 0 is icon 1, which is AMOS's own 1-based icon numbering.
 *
 * ## Errors
 *
 * Two, both raised through `L_ScCopy`:
 *
 *   routine 81  error $17 (23), "Illegal function call" — no icon bank, or
 *               its first longword is not the cookie `Icon`
 *   routine 82  error $4a (74), "Icon not defined" — the tile's icon number
 *               is above the bank's count. The test is `cmp.w $8(a0),d1`
 *               followed by `Rbhi`, which is UNSIGNED strictly-greater, so a
 *               tile whose icon number equals the count is legal.
 */
import { AmosError } from '../interp/values'
import type { Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/** The extension data block at `$158(a5)`, as far as this slice reads it. */
export interface TomeState {
  /** $1a — the map bank number, resolved at each use rather than held */
  mapBank: number
  /** $30 — the brik bank number, read by the Brik and Paste Brik family */
  brikBank: number
  /** $34 — the tile-type bank number, read by Tile Val */
  tileTypBank: number
  /** $a / $c — the map cursor the last draw was given */
  cursorX: number
  cursorY: number
  /** $e / $12 — tile size in pixels */
  tileW: number
  tileH: number
  /** $20 $24 $28 $2c — the view rectangle in screen pixels */
  viewX1: number
  viewY1: number
  viewX2: number
  viewY2: number
  /** $16 / $18 — cached from the bank header by every drawing routine */
  mapW: number
  mapH: number
}

export const newTomeState = (): TomeState => ({
  mapBank: 0,
  brikBank: 0,
  tileTypBank: 0,
  cursorX: 0,
  cursorY: 0,
  tileW: 16,
  tileH: 16,
  viewX1: 0,
  viewY1: 0,
  viewX2: 0,
  viewY2: 0,
  mapW: 0,
  mapH: 0,
})

/** AMOS error 23, routine 81's `moveq #$17,d0 / Rjmp L_ScCopy`. */
const funcCall = (): never => {
  throw new AmosError('Illegal function call', 23)
}
/** AMOS error 74, routine 82's `moveq #$4a,d0`. */
const iconUndef = (): never => {
  throw new AmosError('Icon not defined', 74)
}

/**
 * The map bank's header and data.
 *
 * Routine 67 pushes `$1a(a0)` and calls into AMOS to turn the bank number
 * into an address, so the bank is resolved at every use rather than cached —
 * which is why erasing the map bank between draws is an error here rather
 * than a read of freed memory.
 */
function mapData(rt: Runtime): { data: Uint8Array; w: number; h: number } {
  const bank = rt.memBanks.get(rt.tome.mapBank)
  if (!bank || bank.data.length < 4) funcCall()
  const data = bank!.data
  const w = (data[0]! << 8) | data[1]!
  const h = (data[2]! << 8) | data[3]!
  return { data, w, h }
}

/**
 * Routine 70: the icon bank, and the count that bounds every tile.
 *
 * `movea.l $816(a5),a0 / move.l $8(a0),d0` is AMOS's icon bank; a null one is
 * routine 81. The long at its head must read `Icon` — `cmp.l $200c(pc),d0`
 * against the literal — and then `addq.l #$8,a2 / move.w (a2),d7` takes the
 * COUNT from a word eight bytes in. Both the base and the count are cached
 * into $4 and $8 for the drawing loop.
 */
function iconCount(rt: Runtime): number {
  const bank = rt.iconBank
  if (!bank) funcCall()
  return bank!.images.length
}

/**
 * One tile pasted, with the two checks the drawing routines share.
 *
 * The paste itself is `jsr $11c(a0)` through `-$4(a5)` — AMOS's own icon
 * paste, the same one `Paste Icon` reaches, so the tile inherits the icon's
 * mask and the screen's clip rather than getting a private blitter path.
 */
function pasteTile(rt: Runtime, tile: number, x: number, y: number, count: number): void {
  const icon = tile + 1 // addq.l #$1,d1 — tile 0 is icon 1
  if (icon > count) iconUndef() // Rbhi: unsigned, so icon === count passes
  const img = rt.iconBank?.image(icon)
  if (img) rt.blit(rt.screen, img, x, y, true)
}

/**
 * Normalise a map coordinate the way the routines do — by repeated add and
 * subtract of the map size, not by a modulo.
 *
 * `tst.w d5 / blt` branches to `add.w $18(a0),d5` and then jumps BACK to the
 * test, so it loops until the value is in range. A cursor far outside the map
 * still lands correctly; it just takes more passes on the real machine.
 */
const wrap = (v: number, n: number): number => {
  if (n <= 0) return v
  let x = v
  while (x < 0) x += n
  while (x >= n) x -= n
  return x
}

/** Shared preamble: pop the cursor, resolve both banks, cache the header. */
function begin(rt: Runtime, it: Parameters<Instr>[0]): { m: ReturnType<typeof mapData>; count: number } {
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  const st = rt.tome
  st.cursorX = (x << 16) >> 16 // move.w d4,$a(a0) — a WORD store
  st.cursorY = (y << 16) >> 16
  const m = mapData(rt)
  const count = iconCount(rt)
  st.mapW = m.w
  st.mapH = m.h
  return { m, count }
}

export function makeTomeInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TomeState => rt.tome

  return {
    /**
     * Map Bank n — routine 11 ($91a), twelve bytes and a single store:
     * `movea.l $158(a5),a0 / move.l (a3)+,d1 / move.l d1,$1a(a0)`. Nothing is
     * validated and nothing is resolved; the number is looked up at each draw.
     */
    'map bank'(it) {
      st().mapBank = it.evalInt()
    },

    /**
     * Brik Bank n — routine 12 ($926), and Tile Typ Bank n — routine 13
     * ($932). The same twelve bytes as Map Bank against $30 and $34: store the
     * number, validate nothing, resolve it at each use. 3.1 spells the second
     * one `Tile Val Bank`, its only naming difference from 4.23, and the two
     * share an id and a routine number.
     *
     * NOTE: the readers are not in this slice. Nothing consumes $30 or $34
     * yet, so these two are stores whose effect is only visible in the state
     * block — which is exactly what the routines do; the keywords that read
     * them (Brik X/Y, Map Brik, Paste Brik, Briks, Tile Val) come later.
     */
    'brik bank'(it) {
      st().brikBank = it.evalInt()
    },
    'tile typ bank'(it) {
      st().tileTypBank = it.evalInt()
    },

    /**
     * Tile Size w,h — routine 10 ($8ec).
     *
     * Each argument goes through `subq.l #$1 / andi.l #$1f / addq.l #$1`,
     * which is `((n - 1) & 31) + 1`. That is a WRAP into 1..32, not a range
     * check: 33 becomes 1 and 0 becomes 32, with no error either way. Both
     * are stored twice, as a long at $e/$12 and as a word at $64/$66.
     */
    'tile size'(it) {
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      st().tileW = (((w - 1) & 0x1f) + 1) | 0
      st().tileH = (((h - 1) & 0x1f) + 1) | 0
    },

    /**
     * Map View x1,y1 To x2,y2 — routine 14 ($93e), four longs stored at
     * $20/$24/$28/$2c and nothing else. No clip against the screen and no
     * ordering check. A reversed or empty rectangle still draws exactly one
     * tile, at (x1,y1): every drawing loop tests AFTER the paste (see
     * `map do`), so the first tile is unconditional.
     */
    'map view'(it) {
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const s = st()
      s.viewX1 = x1
      s.viewY1 = y1
      s.viewX2 = x2
      s.viewY2 = y2
    },

    /**
     * Map Do x,y — routine 15 ($95c), the engine.
     *
     * Draws the map into the view rectangle with map tile (x,y) at its
     * top-left, wrapping the map in both axes.
     *
     * Both loops are DO-WHILE — the paste at $9c2 is entered unconditionally
     * and the edge test is the tail, `add.l $e(a0),d6 / cmp.l $28(a0),d6 /
     * blt.b $9ba`. Two consequences, and neither is what a range check would
     * give: a tile is drawn whenever its START is before x2, so the last
     * column can overhang the far edge; and an empty or reversed rectangle
     * still draws one tile at (x1,y1).
     *
     * The x cursor is reset from $a(a0) at the end of each row ($a18) while
     * the y cursor keeps advancing, so the map scrolls diagonally only if the
     * caller moves it.
     */
    'map do'(it) {
      const { m, count } = begin(rt, it)
      const s = st()
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        let mx = wrap(s.cursorX, m.w)
        let sx = s.viewX1
        do {
          pasteTile(rt, m.data[4 + my * m.w + mx]!, sx, sy, count)
          mx = mx + 1 >= m.w ? 0 : mx + 1
          sx += s.tileW
        } while (sx < s.viewX2)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < s.viewY2)
    },

    /**
     * Map Left x,y — routine 16 ($aa2).
     *
     * Map Do with the row loop deleted: one COLUMN at the view's left edge,
     * walking y. The whole 268 bytes are Map Do's bytes with the x advance and
     * its `cmp.l $28(a0)` test removed, which is the copy-and-edit shape the
     * whole family has. Used after scrolling the screen right by a tile.
     *
     * Do-while like the rest: `addq.w #$1,d5 / add.l $12(a0),d7 / cmp.l
     * $2c(a0),d7 / blt.b $af0`.
     */
    'map left'(it) {
      const { m, count } = begin(rt, it)
      const s = st()
      const mx = wrap(s.cursorX, m.w)
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        pasteTile(rt, m.data[4 + my * m.w + mx]!, s.viewX1, sy, count)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < s.viewY2)
    },

    /**
     * Map Right x,y — routine 17 ($bae).
     *
     * NOT the mirror of Map Left, and this is the thing a manual would have
     * got wrong if there were one. It takes the SAME top-left map cursor and
     * works out the last column itself:
     *
     *   move.l $28(a0),d0 / sub.l d6,d0      the view's width in pixels
     *   move.w $10(a0),d1 / divu.w d1,d0     divided by the tile width
     *   add.w d0,d4 / subq.w #$1,d4          columns across, less one
     *   move.l $28(a0),d6 / sub.l $e(a0),d6  drawn at x2 - tileWidth
     *
     * `$10(a0)` is the LOW WORD of the tile-width long at $e — the routine
     * reuses half of its own field as the `divu.w` operand.
     *
     * NOTE: `divu.w` by a zero tile width would trap on the real machine.
     * Tile Size cannot produce zero (its wrap yields 1..32), so this is only
     * reachable before any Tile Size call, on whatever the block was
     * initialised with. Not reproduced as a trap.
     */
    'map right'(it) {
      const { m, count } = begin(rt, it)
      const s = st()
      const cols = s.tileW > 0 ? Math.floor((s.viewX2 - s.viewX1) / s.tileW) : 0
      const mx = wrap(s.cursorX + cols - 1, m.w)
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        pasteTile(rt, m.data[4 + my * m.w + mx]!, s.viewX2 - s.tileW, sy, count)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < s.viewY2)
    },

    /**
     * Map Top x,y — routine 18 ($cdc). One ROW at the view's top edge,
     * walking x: `addq.w #$1,d4 / add.l $e(a0),d6 / cmp.l $28(a0),d6 / blt`.
     */
    'map top'(it) {
      const { m, count } = begin(rt, it)
      const s = st()
      const my = wrap(s.cursorY, m.h)
      let mx = wrap(s.cursorX, m.w)
      let sx = s.viewX1
      do {
        pasteTile(rt, m.data[4 + my * m.w + mx]!, sx, s.viewY1, count)
        mx = mx + 1 >= m.w ? 0 : mx + 1
        sx += s.tileW
      } while (sx < s.viewX2)
    },

    /**
     * Map Bottom x,y — routine 19 ($df2). Map Right's trick on the other
     * axis: `(y2 - y1) / tileHeight - 1` rows down from the cursor, drawn at
     * `y2 - tileHeight`, walking x. `$14(a0)` is the low word of the tile
     * height long at $12.
     */
    'map bottom'(it) {
      const { m, count } = begin(rt, it)
      const s = st()
      const rows = s.tileH > 0 ? Math.floor((s.viewY2 - s.viewY1) / s.tileH) : 0
      const my = wrap(s.cursorY + rows - 1, m.h)
      let mx = wrap(s.cursorX, m.w)
      let sx = s.viewX1
      do {
        pasteTile(rt, m.data[4 + my * m.w + mx]!, sx, s.viewY2 - s.tileH, count)
        mx = mx + 1 >= m.w ? 0 : mx + 1
        sx += s.tileW
      } while (sx < s.viewX2)
    },
  }
}
