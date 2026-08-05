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
import { AmosError, VI, VS, int } from '../interp/values'
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
  /**
   * $72 / $7a / $76 — the ANIMATION bank and the two capacities Map Anim Bank
   * writes into it. The update list shares this bank: routine 46 stores the
   * number at $72 and the update capacity at $7a, and Map Plot appends its
   * records four bytes in.
   */
  animBank: number
  updCap: number
  animCap: number
  /** $68 — Map Update On/Off; $6a — armed, set by the first recorded plot */
  updOn: number
  updArmed: number
  /** $6c — how many records the list holds */
  updCount: number
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
  animBank: 9,
  updCap: 0,
  animCap: 0,
  updOn: 0,
  updArmed: 0,
  updCount: 0,
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

/**
 * A brik record, out of the brik bank.
 *
 * The bank is a word count at $0, then a LONG per brik at $2 -- `asl.l #$2,d6
 * / addq.l #$2,d6 / move.l (a2,d6.w),d5` -- holding that brik's offset from
 * the bank's own base. The record is a width word, a height word, then a byte
 * a cell row-major, the same shape as a map without the map's header names.
 *
 * Numbering is 1-BASED and both ends are checked: `subi.l #$1,d6 / Rbmi` for
 * zero or negative and `cmp.w $0(a2),d6 / Rbge` for past the end, each to
 * routine 81's error 23.
 */
function brik(rt: Runtime, n: number): { data: Uint8Array; at: number; w: number; h: number } {
  const data = bankBytes(rt, rt.tome.brikBank)
  const i = (n - 1) | 0
  if (i < 0) funcCall()
  const count = ((data[0] ?? 0) << 8) | (data[1] ?? 0)
  if (i >= count) funcCall()
  const o = 2 + i * 4
  const at =
    (((data[o] ?? 0) << 24) | ((data[o + 1] ?? 0) << 16) | ((data[o + 2] ?? 0) << 8) | (data[o + 3] ?? 0)) >>> 0
  return { data, at, w: ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0), h: ((data[at + 2] ?? 0) << 8) | (data[at + 3] ?? 0) }
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
     * Map Brik brik,x,y — routine 23 ($fbc). Stamps a brik's cells into the
     * MAP at (x,y), the map-editing counterpart of Paste Brik's drawing.
     *
     * The arguments pop in reverse, as everywhere here, so d6 is the brik
     * number, d4 the map x and d5 the map y. Clipping is by falling out of
     * the loops: `cmp.w $16(a0),d4 / bge` ends the row early and picks up at
     * the next one, `cmp.w $18(a0),d5 / bge` returns outright -- so a brik
     * hanging off the right edge is truncated per row and one hanging off the
     * bottom simply stops.
     *
     * DEVIATION: only the far edges are checked. A negative x or y passes the
     * signed `bge` and then indexes with `mulu.w`, unsigned, so the real
     * routine writes somewhere before the map. Clamped away here; there is no
     * memory before a bank to scribble on.
     */
    'map brik'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x0 = it.evalInt()
      it.expect(',')
      const y0 = it.evalInt()
      const s = st()
      s.cursorX = (x0 << 16) >> 16 // move.w d4,$a(a0), reloaded at each row
      const m = mapData(rt)
      s.mapW = m.w
      s.mapH = m.h
      const b = brik(rt, n)
      for (let by = 0, my = y0; by < b.h; by++, my++) {
        if (my >= m.h) return
        for (let bx = 0, mx = x0; bx < b.w; bx++, mx++) {
          if (mx >= m.w) break
          if (mx < 0 || my < 0) continue // see the DEVIATION above
          m.data[4 + my * m.w + mx] = b.data[b.at + 4 + by * b.w + bx]!
        }
      }
    },

    /**
     * Paste Brik brik,x,y — routine 24 ($1048). The same brik drawn to the
     * SCREEN instead of into the map: cell by cell as icons, stepping x by
     * the tile width and y by the tile height, through the same icon paste
     * and the same `Rbhi routine 82` count check the map draws use.
     *
     * DEFECT: x and y are taken UNSIGNED. They are stored as words at $a/$c
     * and read back with `clr.l d2 / move.w $a(a0),d2`, which zero-extends,
     * so `Paste Brik 1,-1,0` starts at x = 65535 rather than one pixel left
     * of the screen. Reproduced; a program that scrolled a brik off the left
     * edge on the real machine saw it vanish rather than slide.
     *
     * There is no view here at all -- Map View bounds the map draws and not
     * this one, so a brik is pasted wherever it is asked for.
     */
    'paste brik'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x0 = it.evalInt() & 0xffff
      it.expect(',')
      const y0 = it.evalInt() & 0xffff
      const s = st()
      s.cursorX = (x0 << 16) >> 16
      s.cursorY = (y0 << 16) >> 16
      const b = brik(rt, n)
      const count = iconCount(rt)
      for (let by = 0, sy = y0; by < b.h; by++, sy += s.tileH) {
        for (let bx = 0, sx = x0; bx < b.w; bx++, sx += s.tileW) {
          pasteTile(rt, b.data[b.at + 4 + by * b.w + bx]!, sx, sy, count)
        }
      }
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
     * Map Plot tile,x,y — routine 20 ($f20), 120 bytes, and the argument
     * order is the surprise: the pops are d5, d4, d6, and d5 is tested
     * against $18 (the map height) and d4 against $16, so d6 -- the FIRST
     * argument -- is the tile. `Map Plot t,x,y`, not `Map Plot x,y,t`.
     *
     * One tile byte written into the map bank, `andi.l #$ff,d6` first so only
     * the low byte lands. Then, if Map Update On has been called, the plot is
     * APPENDED to the update list so Map Update can redraw just this tile
     * instead of the whole view -- that is the whole point of the pair.
     *
     * DEVIATION: only the far edges are checked, `cmp.w $18(a0),d5 / Rbge`
     * and the same for x, with no test for a negative one. A negative y then
     * goes through `mulu.w`, unsigned, and the write lands before the map.
     * Not reproduced, for the same reason as Map Brik's.
     */
    'map plot'(it) {
      const tile = it.evalInt() & 0xff
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const m = mapData(rt)
      const s = st()
      s.mapW = m.w
      s.mapH = m.h
      if (y >= m.h || x >= m.w) funcCall()
      if (x < 0 || y < 0) return // see the DEVIATION above
      m.data[4 + y * m.w + x] = tile
      if (s.updOn === 0) return
      // `move.w #$1,$6a(a0)` -- armed by the first recorded plot, which is
      // what Map Update tests before it bothers to resolve the bank
      s.updArmed = 1
      const list = bankBytes(rt, s.animBank)
      if (s.updCount >= s.updCap) return // `cmp.l $7a(a0),d0 / bge`
      const at = 4 + s.updCount * 8 // `adda.l #$4,a2 / asl.l #$3,d1`
      const v = new DataView(list.buffer, list.byteOffset, list.byteLength)
      v.setUint16(at, tile)
      v.setUint16(at + 2, x & 0xffff)
      v.setUint16(at + 4, y & 0xffff)
      s.updCount++
    },

    /**
     * Map Update On — routine 37 ($1440) — and Map Update Off, routine 38
     * ($145a). Twenty-six bytes and twelve: On sets $68 and clears both $6a
     * and the record count at $6c, Off clears $68 alone. So switching
     * recording off does NOT discard a list already collected; only switching
     * it on again does.
     */
    'map update on'() {
      const s = st()
      s.updOn = 1
      s.updArmed = 0
      s.updCount = 0
    },
    'map update off'() {
      st().updOn = 0
    },

    /**
     * Map Anim Bank bank,updates,anims — routine 46 ($1800), 36 bytes.
     *
     * ONE bank serves two systems. The number goes to $72, the update
     * capacity to $7a and the animation capacity to $76, and then the routine
     * writes `updates * 8 + 4` into the bank's own first longword -- the
     * offset at which the animation records begin, past the header and the
     * update list. Which is exactly what Map Ab Length computes.
     *
     * NOTE: the shipped block has $72 = 9 and $7a = 0, so a program that
     * turns recording on without calling this first fails in two different
     * ways. If bank 9 does not exist, Map Plot's `Rbsr routine 66` resolves
     * it through Start() and raises "bank not reserved" -- the resolve comes
     * BEFORE the capacity test. If it does exist, the zero capacity means
     * `cmp.l $7a(a0),d0 / bge` refuses every record, silently.
     */
    'map anim bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const updates = it.evalInt()
      it.expect(',')
      const anims = it.evalInt()
      const s = st()
      s.animBank = bank
      const list = bankBytes(rt, bank)
      s.animCap = anims
      s.updCap = updates
      const v = new DataView(list.buffer, list.byteOffset, list.byteLength)
      v.setUint32(0, ((updates << 3) + 4) | 0)
    },

    /**
     * Map Update x,y — routine 40 ($1476), 298 bytes. Redraws only the tiles
     * Map Plot recorded, at the map cursor given, and then empties the list.
     *
     * Each eight-byte record is tile, map x, map y as words. The record's map
     * position is turned into a screen one relative to the cursor -- `sub.l
     * d4,d2 / mulu.w d6,d2 / add.l $20(a0),d2` -- and DROPPED if it lands
     * before the view's near edge or at or past its far one. So a plot
     * outside the visible window costs nothing to record and nothing to draw.
     *
     * Two early-outs, and both still clear the list: $6a zero (nothing was
     * ever recorded since Map Update On) and $6c zero (nothing pending).
     *
     * NOTE: $54 is the loop index here and Map Paste's x1 there. The two
     * keywords share the field, which is harmless only because Map Paste
     * rewrites all four of $54-$60 every call.
     *
     * NOTE: `tst.w $70(a0) / bne` runs the animation stepper (routine 45)
     * first when Map Anim On has been called, and `tst.w $4a(a0)` diverts the
     * tile fetch into 4.23's animation path. Neither flag can be set yet --
     * the keywords that set them are not in this slice -- so both arms are
     * unreachable rather than unimplemented.
     */
    'map update'(it) {
      const cx = it.evalInt()
      it.expect(',')
      const cy = it.evalInt()
      const s = st()
      if (s.updArmed === 0 || s.updCount === 0) {
        s.updCount = 0
        return
      }
      const list = bankBytes(rt, s.animBank)
      const v = new DataView(list.buffer, list.byteOffset, list.byteLength)
      const count = iconCount(rt)
      for (let i = 0; i < s.updCount; i++) {
        const at = 4 + i * 8
        const tile = v.getUint16(at)
        const mx = v.getUint16(at + 2)
        const my = v.getUint16(at + 4)
        const dx = (mx - cx) | 0
        if (dx < 0) continue
        const sx = (dx * s.tileW + s.viewX1) | 0
        if (sx >= s.viewX2) continue
        const dy = (my - cy) | 0
        if (dy < 0) continue
        const sy = (dy * s.tileH + s.viewY1) | 0
        if (sy >= s.viewY2) continue
        pasteTile(rt, tile, sx, sy, count)
      }
      s.updCount = 0
    },

    /**
     * Map Paste mx,my,x1,y1 To x2,y2 — routine 36 ($1334), 268 bytes.
     *
     * Map Do into a rectangle the call names, without disturbing Map View.
     * The four corners are stashed at $54-$60 and the loops compare against
     * $5c/$60 where Map Do compares against $28/$2c; everything else --- the
     * wrap, the do-while, the icon paste, the error 74 --- is Map Do's code
     * copied with two operands changed.
     *
     * The six arguments pop in two groups, which is why the map cursor is
     * LAST in register order but first in the source: `Map Paste x,y,x1,y1 To
     * x2,y2`.
     */
    'map paste'(it) {
      const cx = it.evalInt()
      it.expect(',')
      const cy = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const s = st()
      s.cursorX = (cx << 16) >> 16
      s.cursorY = (cy << 16) >> 16
      const m = mapData(rt)
      const count = iconCount(rt)
      s.mapW = m.w
      s.mapH = m.h
      let my = wrap(s.cursorY, m.h)
      let sy = y1
      do {
        let mx = wrap(s.cursorX, m.w)
        let sx = x1
        do {
          pasteTile(rt, m.data[4 + my * m.w + mx]!, sx, sy, count)
          mx = mx + 1 >= m.w ? 0 : mx + 1
          sx += s.tileW
        } while (sx < x2)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < y2)
    },

    /**
     * List Tile — routine 41 ($15a0), 134 bytes and no arguments. Lays every
     * icon in the bank out across the view, left to right and top to bottom,
     * one per cell, starting at icon 1.
     *
     * Two things only the binary says. The step is the tile size PLUS ONE --
     * `addi.l #$1,d6 / add.l $e(a0),d6` and the same on y -- so the icons are
     * laid out with a one-pixel gutter rather than butted together. And this
     * is the ONE place in the extension where running past the icon count is
     * not an error: the check is a plain `bhi` to a local label that loads
     * 9999 into the y register as a sentinel and falls into the loop tail,
     * where `cmp.l #$270f,d3 / beq` ends the routine. Everywhere else the
     * same comparison is `Rbhi routine 82`.
     */
    'list tile'() {
      const s = st()
      const count = iconCount(rt)
      let icon = 1
      let x = s.viewX1
      let y = s.viewY1
      for (;;) {
        if (icon > count) return // the 9999 sentinel arm at $161c
        const img = rt.iconBank?.image(icon)
        if (img) rt.blit(rt.screen, img, x, y, true)
        icon++
        x += 1 + s.tileW
        if (x < s.viewX2) continue
        y += 1 + s.tileH
        x = s.viewX1
        if (y >= s.viewY2) return
      }
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
     * =Brik X(n) — routine 5 ($7b2) — and =Brik Y(n), routine 6 ($7e0).
     *
     * A brik's size in TILES, out of its record's first two words. Routine 6
     * is ten bytes: `Rbsr routine 5` then `move.w $2(a2,d5.l),d3`, reusing the
     * pointer routine 5 left behind rather than resolving the bank again --
     * so Brik Y is literally Brik X plus one instruction.
     */
    'brik x': (_, a): Value => VI(brik(rt, int(a[0]!)).w),
    'brik y': (_, a): Value => VI(brik(rt, int(a[0]!)).h),

    /**
     * =Briks — routine 25 ($10f2), eighteen bytes: resolve the brik bank
     * through routine 69 and read the count word at its head. How many briks
     * the bank holds, which with 1-based numbering is also the highest legal
     * argument to Brik X, Map Brik and Paste Brik.
     */
    briks: (): Value => {
      const data = bankBytes(rt, st().brikBank)
      return VI(((data[0] ?? 0) << 8) | (data[1] ?? 0))
    },

    /**
     * =Tile Val(x,y,table) — routine 7 ($7ea), 86 bytes, and 3.1 spells it
     * the same. Two lookups, not one:
     *
     *   the MAP at (x,y) gives a tile byte, with all four bounds checked
     *   against routine 81 exactly as Map Tile does -- so this errors where
     *   the draws would wrap;
     *
     *   then `Rbsr routine 68 / asl.l #$8,d6 / adda.l d6,a2 / move.b
     *   (a2,d4.l),d3` reads the TILE-TYPE bank, which is a stack of 256-byte
     *   tables: the third argument picks the table and the tile byte indexes
     *   into it.
     *
     * That is what the bank is for -- a game asks "is the tile under the
     * player solid" by giving tile 0..255 a property byte per table, and gets
     * one lookup instead of a Data statement.
     */
    'tile val': (_, a): Value => {
      const x = int(a[0]!)
      const y = int(a[1]!)
      const table = int(a[2]!)
      const m = mapData(rt)
      const s = st()
      s.mapW = m.w
      s.mapH = m.h
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) funcCall()
      const tile = m.data[4 + y * m.w + x]!
      const typ = bankBytes(rt, s.tileTypBank)
      return VI(typ[(table << 8) + tile] ?? 0)
    },

    /**
     * =Tme Ver$ — routine 27 ($112e) — and =Tme Credit$, routine 26 ($1104).
     *
     * Forty-two bytes each and identical but for one offset: take a
     * length-prefixed string out of the data block, $130(a0) for the version
     * and $d6(a0) for the credit, and copy it into AMOS string space a byte
     * at a time. The block is the static area at $5f2, so these are literals
     * in the library and this port transcribes them rather than composing
     * them from the manifest.
     *
     * The credit is a whole SCREEN of output, escape codes and all: `esc X 9`
     * / `esc Y :` position it, `esc P 3` and `esc P 2` change pen. That is why
     * it is 88 bytes for three lines of text -- it is meant to be printed, and
     * it carries the attribution this port's identity was settled from.
     *
     * Tme Ver$ is where the version came from: not the archive's directory
     * name, and not a secondary list.
     */
    'tme ver$': (): Value => VS('TOME V4.23 \r\n\0'),
    'tme credit$': (): Value =>
      VS(
        '\x1bX9\x1bY:\x1bP3AMOS TOME Series IV\x1bP2\x1bX8\x1bY;(c) Shadow Software 1990' +
          '\x1bX6\x1bY<by Aaron Fothergill\r\n',
      ),

    /**
     * =Map Ab Length(updates,anims) — routine 49 ($1ace), twenty bytes:
     * `asl.l #$3,d1 / asl.l #$6,d3 / add.l d1,d3 / addq.l #$4,d3`. So an
     * update record is EIGHT bytes and an animation record SIXTY-FOUR, plus
     * a four-byte header -- the sizing companion to Map Anim Bank, and the
     * two agree exactly on where the animation records start.
     */
    'map ab length': (_, a): Value => VI((((int(a[0]!) & 0xffff) << 3) + ((int(a[1]!) & 0xffff) << 6) + 4) | 0),

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
