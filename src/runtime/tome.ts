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
 * Two, both raised by jumping to AMOS routine 1024 with the error number in
 * d0 (see `bankBytes` on why the label file's name for it is not evidence):
 *
 *   routine 81  error $17 (23), "Illegal function call" — no icon bank, or
 *               its first longword is not the cookie `Icon`
 *   routine 82  error $4a (74), "Icon not defined" — the tile's icon number
 *               is above the bank's count. The test is `cmp.w $8(a0),d1`
 *               followed by `Rbhi`, which is UNSIGNED strictly-greater, so a
 *               tile whose icon number equals the count is legal.
 */
import { AmosError, VI, int } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
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
  /** $e / $12 — tile size in pixels, as LONGS */
  tileW: number
  tileH: number
  /**
   * $64 / $66 — Tile Size's WORD copies of the same two numbers.
   *
   * Not redundant, because the block does not ship them agreeing: the static
   * block at $5f2 starts with $e/$12 = 32 and $64/$66 = 5. Map Hx/Hy divide
   * by these while Map Fx/Fy mask with those, so before any Tile Size call
   * the two halves of that pair answer for different tile sizes. After one
   * they agree forever.
   */
  tileWordW: number
  tileWordH: number
  /** $20 $24 $28 $2c — the view rectangle in screen pixels */
  viewX1: number
  viewY1: number
  viewX2: number
  viewY2: number
  /** $16 / $18 — cached from the bank header by every drawing routine */
  mapW: number
  mapH: number
}

/**
 * The block as the library SHIPS it, not as a zeroed struct.
 *
 * Routine 0 does not build this: it points $158(a5) at a static area inside
 * the code hunk at $5f2 and then clears only four things -- $68, $6c, $4a and
 * eight bytes of the animation table. Everything else is whatever the author
 * assembled, so these are Aaron Fothergill's own defaults, read straight out
 * of the bytes at $5f2 rather than guessed:
 *
 *   tile 32 x 32, map 200 x 50 tiles, view 0,0 to 320,192, and banks
 *   6 (map), 7 (brik), 8 (tile types), 9 (update list)
 *
 * The $64/$66 pair does NOT agree with $e/$12 in the shipped block -- 5
 * against 32 -- so a program that reads Map Hx before setting a tile size
 * gets an answer for a five-pixel tile. Kept, because it is what the library
 * does; see `tileWordW`.
 */
export const newTomeState = (): TomeState => ({
  mapBank: 6,
  brikBank: 7,
  tileTypBank: 8,
  cursorX: 0,
  cursorY: 0,
  tileW: 32,
  tileH: 32,
  tileWordW: 5,
  tileWordH: 5,
  viewX1: 0,
  viewY1: 0,
  viewX2: 320,
  viewY2: 192,
  mapW: 200,
  mapH: 50,
})

/** AMOS error 23, routine 81's `moveq #$17,d0 / Rjmp <AMOS 1024>`. */
const funcCall = (): never => {
  throw new AmosError('Illegal function call', 23)
}
/** AMOS error 74, routine 82's `moveq #$4a,d0`. */
const iconUndef = (): never => {
  throw new AmosError('Icon not defined', 74)
}

/**
 * A bank number to its bytes, the way routines 66-69 do it.
 *
 * All four are the same twenty-six bytes against a different field -- $1a the
 * map (67), $30 the briks (69), $34 the tile types (68), $72 the update list
 * (66). Each pushes its bank NUMBER onto AMOS's argument stack, calls back
 * into AMOS, and takes an address out of d3:
 *
 *     move.l $1a(a0),-(a3)
 *     Rjsr   <AMOS routine 431>
 *     movea.l d3,a1
 *
 * d3 is AMOS's function-result register, so this is `=Start(n)` -- which is
 * why a bank is resolved at EVERY use rather than cached, and why erasing the
 * map bank between two draws is an error rather than a read of freed memory.
 * The error is AMOS's own, "bank not reserved", and not one of TOME's two.
 *
 * NOTE: `+lib_Labels.s` names AMOS routine 431 `L_InSetPaint`, which cannot be
 * what this is -- Set Paint takes a flag and returns nothing. The label file
 * is a 1993 listing of the interpreter's own labels and its numbering is not
 * the one extensions were assembled against, so the NAMES extdis prints for
 * cross-library calls are not evidence. The behaviour above is, and it is what
 * this follows. Same caution applies to the `L_ScCopy` in the error helpers.
 */
function bankBytes(rt: Runtime, n: number): Uint8Array {
  const mem = rt.memBanks.get(n)
  // FnStart +Lib.s:2481 is `Rbsr L_Bnk.GetAdr / Rbeq L_BkNoRes`
  if (!mem) {
    // NOTE: Start() answers for the sprite and icon banks too, and TOME would
    // then read an object bank's bytes as map data. Those banks are objects
    // here rather than a flat image, so that reading cannot be reproduced;
    // it takes the not-reserved arm instead.
    throw new AmosError('bank not reserved')
  }
  return mem.data
}

/** The map bank's header and data — `move.w $0(a1)` / `move.w $2(a1)`. */
function mapData(rt: Runtime): { data: Uint8Array; w: number; h: number } {
  const data = bankBytes(rt, rt.tome.mapBank)
  const w = ((data[0] ?? 0) << 8) | (data[1] ?? 0)
  const h = ((data[2] ?? 0) << 8) | (data[3] ?? 0)
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
     * check: 33 becomes 1 and 0 becomes 32, with no error either way.
     *
     * Both are stored TWICE, as a long at $e/$12 and as a word at $64/$66,
     * and different keywords read different copies -- Map Right takes the low
     * word of $e, Map Hx takes $64, Map Fx masks with $e. The two copies only
     * differ before the first call, because the shipped block has 32 in one
     * and 5 in the other; see `newTomeState`.
     */
    'tile size'(it) {
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      st().tileW = (((w - 1) & 0x1f) + 1) | 0
      st().tileH = (((h - 1) & 0x1f) + 1) | 0
      st().tileWordW = st().tileW // move.w d1,$64(a0)
      st().tileWordH = st().tileH // move.w d2,$66(a0)
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

/**
 * `divu.w` as the 68000 does it, which two of these functions depend on.
 *
 * The dividend is a LONG read as UNSIGNED and the divisor a WORD. If the
 * quotient will not fit in sixteen bits the instruction OVERFLOWS: it sets V
 * and leaves the destination register untouched. Every one of these routines
 * follows its `divu.w` with `andi.l #$ffff`, so an overflow does not raise
 * anything -- it silently answers the low word of the DIVIDEND instead.
 *
 * That is reachable from BASIC. `=Xtile(x)` for an x to the left of the view
 * computes a negative difference, reads it as a huge unsigned one, overflows,
 * and hands back `(x - viewX1) & $ffff`. Reproduced rather than corrected:
 * a program written against the real library got these numbers.
 */
function divuw(dividend: number, divisor: number): number {
  const u = dividend >>> 0
  const d = divisor & 0xffff
  if (d === 0) return u & 0xffff // a real divide-by-zero trap; see the callers
  const q = Math.floor(u / d)
  return (q > 0xffff ? u : q) & 0xffff
}

export function makeTomeFunctions(rt: Runtime): Record<string, Func> {
  const st = (): TomeState => rt.tome

  /**
   * =Xtile(x) — routine 3 ($74c) — and =Ytile(y), routine 2 ($732). Twenty-six
   * bytes each: subtract the view's near edge and divide by the tile size,
   * `sub.l $20(a0),d3 / move.l $e(a0),d1 / divu.w d1,d3 / andi.l #$ffff,d3`.
   * The screen pixel to a map column, relative to the view rather than to the
   * map, so this answers "which column of the VIEW" and the caller adds the
   * cursor. Overflow behaviour is `divuw`'s.
   */
  const tileOf = (v: number, near: number, size: number): Value => VI(divuw((v - near) | 0, size))

  return {
    xtile: (_, a): Value => tileOf(int(a[0]!), st().viewX1, st().tileW),
    ytile: (_, a): Value => tileOf(int(a[0]!), st().viewY1, st().tileH),

    /**
     * =Map Pos X(x) — routine 63 ($1f18) — and =Map Pos Y(y), routine 64
     * ($1f32).
     *
     * These are Xtile and Ytile AGAIN. Routine 63 is routine 3 instruction for
     * instruction but for the scratch register (`d0` where 3 uses `d1`) and
     * the order of the first two instructions; 64 is likewise 2. Two names for
     * one calculation, four routines in the hunk. Nothing in the binary
     * distinguishes them, so nothing here does either.
     */
    'map pos x': (_, a): Value => tileOf(int(a[0]!), st().viewX1, st().tileW),
    'map pos y': (_, a): Value => tileOf(int(a[0]!), st().viewY1, st().tileH),

    /**
     * =Map Hx(x) — routine 32 ($12e8) — and =Map Hy(y), routine 33 ($12fc).
     *
     * `divu.w $64(a0),d3`: the tile size again, but this time straight off the
     * WORD copies Tile Size leaves at $64/$66, with no view subtraction. So
     * these are the absolute pixel-to-tile divide where Xtile is the relative
     * one -- the "H" pair and the "F" pair below are a whole-and-fraction
     * split of a pixel coordinate.
     *
     * NOTE: $64/$66, not $e/$12, and in the shipped block those hold 5 where
     * $e/$12 hold 32. Before any Tile Size call this pair therefore answers
     * for a different tile size than Map Fx/Fy does.
     */
    'map hx': (_, a): Value => VI(divuw(int(a[0]!), st().tileWordW)),
    'map hy': (_, a): Value => VI(divuw(int(a[0]!), st().tileWordH)),

    /**
     * =Map Fx(x) — routine 34 ($1310) — and =Map Fy(y), routine 35 ($1322).
     *
     * The remainder half, done with a MASK and not a modulo: `move.l $e(a0),d2
     * / subq.w #$1,d2 / and.l d2,d3`.
     *
     * DEFECT: that is only the remainder when the tile size is a power of two.
     * Tile Size accepts any 1..32 (it wraps rather than checking), so a
     * 24-pixel tile gives `x AND 23`, which is not `x MOD 24` and does not
     * even count up monotonically. Reproduced -- a program with a 24-wide tile
     * got these numbers from the real library, and the pairing with Map Hx
     * (a true divide) is exactly where the two disagree.
     *
     * `subq.w` on a long register touches the low word only, so the mask is
     * built from the low word of the tile-size long, as it is in Map Right.
     */
    'map fx': (_, a): Value => VI(int(a[0]!) & (((st().tileW - 1) & 0xffff) | 0)),
    'map fy': (_, a): Value => VI(int(a[0]!) & (((st().tileH - 1) & 0xffff) | 0)),

    /**
     * =Map X — routine 21 ($f98) — and =Map Y, routine 22 ($faa). Eighteen
     * bytes: resolve the map bank through routine 67 and read the header,
     * `move.w $0(a1),d3` and `move.w $2(a1),d3`. The map's size in TILES,
     * taken from the bank each call rather than from the $16/$18 cache, so
     * these answer for the current Map Bank whether or not anything has drawn.
     */
    'map x': (): Value => VI(mapData(rt).w),
    'map y': (): Value => VI(mapData(rt).h),

    /**
     * =Map Tile(x,y) — routine 4 ($766).
     *
     * The tile byte at a map position, RAW: no `addq.l #$1`, so this is the
     * 0-based value the bank holds and not the icon number the draws paste.
     *
     * And unlike every drawing routine, it does not wrap -- it ERRORS. All
     * four bounds are checked (`tst.w / Rblt` on each and `cmp.w / Rbge`
     * against $16 and $18) and every failure goes to routine 81, AMOS error
     * 23. So the same coordinate that Map Do would happily wrap is an illegal
     * function call here.
     */
    'map tile': (_, a): Value => {
      const x = int(a[0]!)
      const y = int(a[1]!)
      const m = mapData(rt)
      const s = st()
      s.mapW = m.w
      s.mapH = m.h
      if (y < 0 || x < 0 || y >= m.h || x >= m.w) funcCall()
      return VI(m.data[4 + y * m.w + x]!)
    },

    /**
     * =Map Length(w,h) — routine 39 ($1466), sixteen bytes and no state at
     * all: `mulu.w d0,d3 / addq.l #$4,d3`. How big a Reserve has to be for a
     * w-by-h map -- one byte a tile plus the four-byte header. It never looks
     * at the bank, so it can be called before there is one.
     */
    'map length': (_, a): Value => VI(((int(a[0]!) & 0xffff) * (int(a[1]!) & 0xffff) + 4) | 0),

    /**
     * =Tile Count(t) — routine 65 ($1f4c), forty-six bytes.
     *
     * How many times tile `t` appears in the whole map: `mulu.w d2,d1 / subq.l
     * #$1,d1` for the last index, then `cmp.b $4(a1,d1.l),d4 / dbra`. A BYTE
     * compare, so only the low eight bits of the argument are looked at.
     *
     * NOTE: an empty map (either dimension zero) leaves `d1 = -1` and the
     * `dbra` then runs 65,536 times over memory before the bank -- a scan off
     * the end of the map rather than a loop that does nothing. Not reproduced;
     * there is no memory before the bank here to read, and the count answered
     * is 0.
     */
    'tile count': (_, a): Value => {
      const t = int(a[0]!) & 0xff
      const m = mapData(rt)
      let n = 0
      for (let i = 0; i < m.w * m.h; i++) if (m.data[4 + i] === t) n++
      return VI(n)
    },

    /**
     * =Map Check — routine 31 ($1284), a hundred bytes, and it is not a
     * predicate: it REPAIRS the map and answers how much repairing it did.
     *
     * It walks every tile and compares against the icon COUNT cached at
     * $8(a0), `cmp.l d7,d2 / bge`. A tile at or above the count is one whose
     * icon number (tile + 1) is past the end of the bank -- exactly what would
     * raise routine 82's error 74 mid-draw -- and it is overwritten with
     * `move.b #$0` and counted. So this is the tool for making a map safe to
     * draw after the icon bank has been replaced with a smaller one.
     *
     * Both banks are required: routine 70 first, then 67, so a missing icon
     * bank is error 23 before the map is even resolved.
     */
    'map check': (): Value => {
      const count = iconCount(rt)
      const m = mapData(rt)
      let fixed = 0
      for (let i = 0; i < m.w * m.h; i++) {
        if (m.data[4 + i]! >= count) {
          m.data[4 + i] = 0
          fixed++
        }
      }
      return VI(fixed)
    },

    /**
     * =Map Base — routine 28 ($1158), ten bytes: `movea.l $158(a5),a0 /
     * move.l a0,d3`. The address of TOME's own data block, for a program that
     * wants to poke the state fields directly.
     *
     * NOTE: the block is an object here and not bytes at an address, so there
     * is no pointer to give that would mean anything. Answering a plausible
     * one would invite exactly the poking it is for, into memory whose layout
     * is not the machine's; this answers 0, which a program checking before
     * use reads as "not available". APPROXIMATED in the value. Same decision
     * as AMCAF's Screen Rastport family, for the same reason.
     */
    'map base': (): Value => VI(0),
  }
}
