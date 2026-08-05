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
 * Everything hangs off `$158(a5)`, the extension's data block. The fields,
 * all read out of the routines that write them:
 *
 *   $4   icon table base, and $8 the icon COUNT — both set by routine 70
 *   $a   map cursor x, $c map cursor y (words)
 *   $e   tile width as a LONG, $12 tile height as a LONG
 *   $10  and $14 are the LOW WORDS of those two longs, which the far-edge
 *        scrolls use directly as `divu.w` operands
 *   $16  map width in tiles, $18 map height in tiles (words, from the bank)
 *   $1a  the map bank number
 *   $20  $24 $28 $2c   view x1, y1, x2, y2 (longs)
 *   $48  one bit per tag slot, and $4a the Tile Tags flag that fills it
 *   $3c  Map Fall's replacement tile
 *   $68  $6a $6c   Map Update on, armed, and how many records are pending
 *   $70  Map Anim on, tested only at the head of Map Update
 *   $72  $76 $7a   the animation bank, and its two capacities
 *   $7e  a sub-block: Map Handle at $0-$8, Tiny Map at $24-$2c, the tile
 *        tags at $30/$38/$48
 *
 * ## The animation bank
 *
 * One bank holds two systems. A long at its head says where the animation
 * records begin -- `updates * 8 + 4`, which Map Anim Bank writes and Map Ab
 * Length computes -- so the update list runs from byte 4 at eight bytes a
 * record and the 64-byte animation records follow it. Map Plot, Map Fall, Map
 * Swap Tile and the animation stepper all append to the same list, and Map
 * Update drains it.
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
import { bltBitMap } from '../amiga/blitter'
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
  /**
   * $70 — Map Anim On/Off. Read in exactly one place: Map Update's first
   * instruction after loading the block, `tst.w $70(a0) / bne $154a`, which
   * runs the animation stepper and then falls back into the ordinary update
   * draw. So an animation is stepped BY Map Update and its new tiles are
   * drawn by the same call that stepped them.
   */
  animOn: number
  /** $3c — the tile Map Fall leaves behind, its only argument */
  fallEmpty: number
  /**
   * $7e+$0 .. $7e+$8 — Map Handle's own five fields, in the sub-block the
   * tile tags and Tiny Map also live in.
   *
   *   $0/$2  the map position this call was given
   *   $4/$6  the position the LAST call was given, which is what makes the
   *          keyword a scroll manager rather than a draw
   *   $8     the screen number, a long, handed to AMOS to resolve
   *
   * Map Handle Init writes $ffffffff over $4, so both halves read -1 and the
   * next call takes the full-redraw arm.
   */
  handleX: number
  handleY: number
  handleOldX: number
  handleOldY: number
  handleScreen: number
  /**
   * $4a — TILE TAGS on. Every map draw tests it and takes a slower path that
   * watches for tagged tiles; it is not an animation flag, whatever the
   * neighbouring fields suggest.
   */
  tagsOn: number
  /**
   * $48 — one bit per tag slot, set when a draw passed a tagged tile and
   * cleared by Tile Tag reading it. The map draws clear the whole word at
   * entry, so it reports on the LAST draw only.
   */
  tagSeen: number
  /** $7e+$30 eight tag values, $7e+$38 and $7e+$48 the map position of each */
  tagTile: number[]
  tagX: number[]
  tagY: number[]
  /** $4c — the zone bank number */
  zoneBank: number
  /** $7e+$24 — the OBJECT-bank slot Tiny Map takes its icons from */
  tinyBank: number
  /** $44 — Tiny Map's pixel step, and Map Scan's found-y scratch */
  tinyStep: number
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
  animOn: 0,
  fallEmpty: 0,
  handleX: 0,
  handleY: 0,
  handleOldX: 0,
  handleOldY: 0,
  handleScreen: 0,
  tagsOn: 0,
  tagSeen: 0,
  tagTile: [0, 0, 0, 0, 0, 0, 0, 0],
  tagX: [0, 0, 0, 0, 0, 0, 0, 0],
  tagY: [0, 0, 0, 0, 0, 0, 0, 0],
  zoneBank: 12,
  tinyBank: 0,
  tinyStep: 0,
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
 * The tile-tag check every map draw runs before it pastes, when $4a is set.
 *
 * `adda.l #$7e,a0` then `move.l #$7,d0` and a `dbra` down over eight byte
 * slots at $30: an EMPTY slot is skipped (`tst.b / beq`) and a slot matching
 * the RAW tile byte records the tile's map position into $38 and $48, sets
 * that slot's bit in the main block's $48, and falls through to paste the
 * tile anyway. So a tag never changes what is drawn -- it only tells the
 * caller "slot 3 went past, at map (12,7)" after the fact, which is how a
 * game finds its exits and pickups without scanning the map itself.
 *
 * The comparison is against the tile as READ, before the `addq.l #$1` that
 * makes it an icon number -- Map Update, whose d1 is already incremented,
 * does `subq.l #$1,d1` first and puts it back afterwards.
 */
function tagCheck(rt: Runtime, tile: number, mx: number, my: number): void {
  const s = rt.tome
  if (s.tagsOn === 0) return
  for (let slot = 7; slot >= 0; slot--) {
    if (s.tagTile[slot] === 0) continue
    if (s.tagTile[slot] !== tile) continue
    s.tagX[slot] = mx & 0xffff
    s.tagY[slot] = my & 0xffff
    s.tagSeen |= 1 << slot
    return
  }
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

/**
 * Shared preamble: take the cursor, resolve both banks, cache the header.
 *
 * Map Handle calls the five draws as SUBROUTINES rather than as keywords --
 * `bsr.w $1962` pushes its own x and y onto AMOS's argument stack and then
 * `Rbsr routine 15` (or 16, 17, 18, 19) enters the keyword at its first
 * instruction, which pops them straight back off. The argument stack is the
 * calling convention, so a draw cannot tell the difference; this split is
 * what lets the port make the same call.
 */
function beginAt(rt: Runtime, x: number, y: number): { m: ReturnType<typeof mapData>; count: number } {
  const st = rt.tome
  st.cursorX = (x << 16) >> 16 // move.w d4,$a(a0) — a WORD store
  st.cursorY = (y << 16) >> 16
  st.tagSeen = 0 // move.w #$0,$48(a0) — the tag mask reports on THIS draw
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

/**
 * Routine 71: the TINY icon bank, the second object bank Tiny Map draws from.
 *
 * `movea.l $816(a5),a0 / adda.l d0,a0` with `d0 = (n - 1) * 8` walks AMOS's
 * table of object-bank descriptors -- which is why routine 70, the main icon
 * lookup, is the same code with the index hardcoded to 8. So the argument to
 * Tiny Bank is a BANK NUMBER into that table: 1 is the sprite bank and 2 the
 * icon bank.
 *
 * The cookie check is the same literal `Icon`, so only the icon bank passes;
 * pointing Tiny Bank at the sprites is routine 81's error 23, not a second
 * source of images. NOTE: this port has one icon bank object rather than a
 * descriptor table, so the number selects between "the icon bank" and "not
 * an icon bank" and nothing finer.
 */
function tinyIcons(rt: Runtime): number {
  const s = rt.tome
  if (s.tinyBank !== 2 || !rt.iconBank) funcCall()
  return rt.iconBank!.images.length
}

/* ------------------------------------------------------------------ *
 * The animation bank
 * ------------------------------------------------------------------ */

/**
 * Word and long access into a bank, out of range included.
 *
 * The animation routines index their bank by numbers the CALLER chose --- the
 * animation number against a capacity the caller also chose, and a frame
 * count taken from the length of the caller's string. None of the three is
 * checked against the bank's actual size, so a program can and does address
 * past the end. On the Amiga that reads or writes whatever is next in chip
 * RAM; here a read answers 0 and a write is dropped.
 *
 * NOTE: that is the one place this slice cannot be faithful, and it is not a
 * defect being papered over --- the library's behaviour past the end of the
 * bank is not defined by the library, it is defined by what the program
 * happened to allocate next. See `map anim` on the frame count, which is the
 * reachable case and IS declared.
 */
const rdW = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)
const rdL = (b: Uint8Array, at: number): number => (rdW(b, at) * 0x10000 + rdW(b, at + 2)) >>> 0
const wrW = (b: Uint8Array, at: number, v: number): void => {
  if (at < 0 || at + 1 >= b.length) return
  b[at] = (v >> 8) & 0xff
  b[at + 1] = v & 0xff
}
const wrL = (b: Uint8Array, at: number, v: number): void => {
  wrW(b, at, (v >>> 16) & 0xffff)
  wrW(b, at + 2, v & 0xffff)
}
/** `ext.w` on a byte, and a word read as signed — both appear in routine 45. */
const sb = (v: number): number => (v << 24) >> 24
const sw = (v: number): number => (v << 16) >> 16

/** 64 bytes an animation: `asl.l #$6,d3` in every routine that indexes one. */
const ANIM = 64

/**
 * Where the animation records start.
 *
 * Routine 66 resolves $72 through Start(), and then every animation routine
 * does the same two instructions on the result: `move.l $0(a2),d0 / adda.l
 * d0,a2`. The long at the head is what Map Anim Bank wrote there --- the
 * update list's length plus its four-byte header --- so ONE bank holds both
 * systems, the update list first and the animations after it.
 */
function animBase(rt: Runtime): { list: Uint8Array; base: number } {
  const list = bankBytes(rt, rt.tome.animBank)
  return { list, base: rdL(list, 0) }
}

/**
 * One update record appended — the tail routine 45, Map Fall and Map Swap
 * Tile share, at $1778, $1bb2 and $1d1a.
 *
 * All three write through the bank's own base with the fields at $4/$6/$8,
 * which is the same place Map Plot writes with a base four bytes in and
 * fields at $0/$2/$4. The record is tile, map x, map y as words, and two
 * bytes spare.
 *
 * `$6a` is set BEFORE the capacity test in all three, so a full list still
 * arms Map Update; only the record is dropped.
 */
function record(rt: Runtime, list: Uint8Array, tile: number, mx: number, my: number): void {
  const s = rt.tome
  s.updArmed = 1
  if (s.updCount >= s.updCap) return
  const at = 4 + s.updCount * 8
  s.updCount++
  wrW(list, at, tile)
  wrW(list, at + 2, mx)
  wrW(list, at + 4, my)
}

/**
 * Routine 45 ($16d0), 304 bytes — the animation stepper. Not a keyword: Map
 * Update reaches it through `tst.w $70(a0) / bne $154a` and then falls back
 * into its own drawing loop, so a stepped animation is drawn by the very call
 * that stepped it.
 *
 * A 64-byte record, laid out by Map Anim and read here:
 *
 *   $0/$2   map x, map y
 *   $4      cycles left; 0 stops the animation and $ffff never runs out
 *   $6      the reload, and $8 the countdown that reaches zero to fire
 *   $a      how many frame bytes, $c which one is next
 *   $e      a LONG, y * mapWidth + x, the map cell to poke
 *   $12     the movement flag
 *   $14..   up to 44 frame bytes
 *
 * The step itself pokes a tile INTO THE MAP BANK and appends an update
 * record. It never draws: an animation is a map edit that Map Update happens
 * to redraw, which is why an animated tile survives a Map Do that scrolls
 * past it and why one that is off screen costs a byte store and nothing else.
 *
 * The movement flag turns the frame string from a list of tiles into a list
 * of TRIPLES -- signed dx, signed dy, then the tile -- so `Map Anim -n` walks
 * a tile across the map and `Map Anim n` cycles one in place. That is what
 * the negative animation number in Map Anim buys.
 *
 * Transcribed as a jump table on the 68k address rather than restructured,
 * because the movement arm falls THROUGH into the ordinary one and both of
 * them fall into the same poke; a structured rewrite has to duplicate the
 * poke or invert a loop, and either way stops being checkable against the
 * listing. The addresses are the labels.
 */
function stepAnims(rt: Runtime): void {
  const s = rt.tome
  const { list, base } = animBase(rt) // Rbsr routine 66
  const map = bankBytes(rt, s.mapBank) // Rbsr routine 67
  for (let n = 0; n < s.animCap; n++) {
    const r = base + n * ANIM
    if (rdW(list, r + 4) === 0) continue // $16fa — out of cycles
    let d1 = rdW(list, r + 0xa) // $1704 — the frame count
    if (d1 === 0) continue
    const tick = (rdW(list, r + 8) - 1) & 0xffff // $170e — subq.w #$1
    if (tick !== 0) {
      wrW(list, r + 8, tick)
      continue
    }
    // $1730 — it fires
    wrW(list, r + 8, rdW(list, r + 6))
    let d4 = rdW(list, r + 0)
    let d5 = rdW(list, r + 2)
    let d6 = rdW(list, r + 0xc)
    let d2 = list[r + 0x14 + d6] ?? 0
    let pc = rdW(list, r + 0x12) !== 0 ? 0x17a6 : 0x1756
    for (;;) {
      if (pc === 0x17a6) {
        // the movement arm: dx, dy, tile
        d4 = (d4 + sb(d2)) & 0xffff
        d6 = (d6 + 1) & 0xffff
        if (sw(d6) >= sw(d1)) {
          pc = 0x17e4
          continue
        }
        d5 = (d5 + sb(list[r + 0x14 + d6] ?? 0)) & 0xffff
        d2 = 0 // clr.l d2 — so a triple cut short here pokes tile 0
        d6 = (d6 + 1) & 0xffff
        if (sw(d6) >= sw(d1)) {
          pc = 0x17e4
          continue
        }
        d2 = list[r + 0x14 + d6] ?? 0
        wrW(list, r + 0, d4) // only NOW is the move committed
        wrW(list, r + 2, d5)
        wrL(list, r + 0xe, (d5 * (s.mapW & 0xffff) + d4) >>> 0)
        d1 = rdW(list, r + 0xa)
        pc = 0x1756
        continue
      }
      if (pc === 0x1756) {
        d6 = (d6 + 1) & 0xffff
        if (sw(d6) >= sw(d1)) {
          pc = 0x17e4
          continue
        }
        wrW(list, r + 0xc, d6)
        pc = 0x1762
        continue
      }
      if (pc === 0x17e4) {
        // the frame list ran out: back to frame 0, and one cycle gone
        wrW(list, r + 0xc, 0)
        const cycles = rdW(list, r + 4)
        if (cycles !== 0xffff) wrW(list, r + 4, (cycles - 1) & 0xffff)
        pc = 0x1762
        continue
      }
      // $1762 — poke the frame into the map, and tell Map Update about it
      const off = rdL(list, r + 0xe)
      if (4 + off < map.length) map[4 + off] = d2 & 0xff
      if (s.updOn !== 0) record(rt, list, d2, d4, d5)
      break
    }
  }
}

export function makeTomeInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TomeState => rt.tome

  /**
   * The five map draws, as the subroutines Map Handle calls them as.
   *
   * Each is the body of its keyword with the argument pop hoisted out; see
   * `beginAt`. Keeping one definition rather than two is the point --- Map
   * Handle's whole job is to pick which of these runs, and a second copy
   * would be a second thing to keep in step with the binary.
   */
  const draw = {
    /** routine 15 ($95c) — the whole view */
    do(x: number, y: number): void {
      const { m, count } = beginAt(rt, x, y)
      const s = st()
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        let mx = wrap(s.cursorX, m.w)
        let sx = s.viewX1
        do {
          const tile = m.data[4 + my * m.w + mx]!
          tagCheck(rt, tile, mx, my)
          pasteTile(rt, tile, sx, sy, count)
          mx = mx + 1 >= m.w ? 0 : mx + 1
          sx += s.tileW
        } while (sx < s.viewX2)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < s.viewY2)
    },
    /** routine 16 ($aa2) — the column at the view's left edge */
    left(x: number, y: number): void {
      const { m, count } = beginAt(rt, x, y)
      const s = st()
      const mx = wrap(s.cursorX, m.w)
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        tagCheck(rt, m.data[4 + my * m.w + mx]!, mx, my)
        pasteTile(rt, m.data[4 + my * m.w + mx]!, s.viewX1, sy, count)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < s.viewY2)
    },
    /** routine 17 ($bae) — the column at the far edge, found by division */
    right(x: number, y: number): void {
      const { m, count } = beginAt(rt, x, y)
      const s = st()
      const cols = s.tileW > 0 ? Math.floor((s.viewX2 - s.viewX1) / s.tileW) : 0
      const mx = wrap(s.cursorX + cols - 1, m.w)
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        tagCheck(rt, m.data[4 + my * m.w + mx]!, mx, my)
        pasteTile(rt, m.data[4 + my * m.w + mx]!, s.viewX2 - s.tileW, sy, count)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += s.tileH
      } while (sy < s.viewY2)
    },
    /** routine 18 ($cdc) — the row at the view's top edge */
    top(x: number, y: number): void {
      const { m, count } = beginAt(rt, x, y)
      const s = st()
      const my = wrap(s.cursorY, m.h)
      let mx = wrap(s.cursorX, m.w)
      let sx = s.viewX1
      do {
        tagCheck(rt, m.data[4 + my * m.w + mx]!, mx, my)
        pasteTile(rt, m.data[4 + my * m.w + mx]!, sx, s.viewY1, count)
        mx = mx + 1 >= m.w ? 0 : mx + 1
        sx += s.tileW
      } while (sx < s.viewX2)
    },
    /** routine 19 ($df2) — the row at the far edge */
    bottom(x: number, y: number): void {
      const { m, count } = beginAt(rt, x, y)
      const s = st()
      const rows = s.tileH > 0 ? Math.floor((s.viewY2 - s.viewY1) / s.tileH) : 0
      const my = wrap(s.cursorY + rows - 1, m.h)
      let mx = wrap(s.cursorX, m.w)
      let sx = s.viewX1
      do {
        tagCheck(rt, m.data[4 + my * m.w + mx]!, mx, my)
        pasteTile(rt, m.data[4 + my * m.w + mx]!, sx, s.viewY2 - s.tileH, count)
        mx = mx + 1 >= m.w ? 0 : mx + 1
        sx += s.tileW
      } while (sx < s.viewX2)
    },
  }

  /** `bsr.w $1962` — pop the two the keyword expects, then enter it. */
  const args2 = (it: Parameters<Instr>[0]): [number, number] => {
    const x = it.evalInt()
    it.expect(',')
    return [x, it.evalInt()]
  }

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
     * Tile Tags On — routine 57 ($1e7a) — and Tile Tags Off, routine 58
     * ($1e86). Twelve bytes each: `move.w #$1,$4a(a0)` and `move.w #$0`. The
     * flag every map draw tests before taking the slower tag path.
     */
    'tile tags on'() {
      st().tagsOn = 1
    },
    'tile tags off'() {
      st().tagsOn = 0
    },

    /**
     * Tile Tag Set tile,slot — routine 59 ($1e92), 50 bytes, and the value
     * comes FIRST again: the pops are d0 then d1, so d1 is the first argument
     * and it is the one masked to a byte and range-checked.
     *
     * Two things the routine does that a range check would not. The tile is
     * compared against the ICON COUNT at $8 (routine 70 runs first, so no
     * icon bank is error 23) and a tile at or above it is SILENTLY IGNORED --
     * `bge` to the rts, no error, no store. And the slot goes through
     * `subq.l #$1,d0 / andi.l #$7,d0`, a wrap into 0..7 rather than a check,
     * exactly like Tile Size's wrap into 1..32: slot 9 is slot 1 and slot 0
     * is slot 8.
     *
     * A slot holding 0 is "empty" -- the scan skips it with `tst.b / beq` --
     * so tile 0 can never be tagged.
     */
    'tile tag set'(it) {
      const tile = it.evalInt() & 0xff
      it.expect(',')
      const slot = it.evalInt()
      const count = iconCount(rt)
      if (tile >= count) return // `cmp.w $8(a0),d1 / bge` -- ignored, not an error
      st().tagTile[(slot - 1) & 7] = tile
    },

    /**
     * Map Zone Bank bank,count — routine 74 ($207a), 38 bytes. The bank
     * number goes to $4c, the count into the bank's own first word, and then
     * every one of the `count * 8` bytes that follow is filled with $FF --
     * `move.b #$ff,$2(a2,d4.l) / dbra`. So an unset zone is not zero, it is
     * -1 in all four corners, which no coordinate can be inside.
     */
    'map zone bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      const s = st()
      s.zoneBank = bank
      const z = bankBytes(rt, bank)
      const v = new DataView(z.buffer, z.byteOffset, z.byteLength)
      v.setUint16(0, count & 0xffff)
      z.fill(0xff, 2, 2 + count * 8)
    },

    /**
     * Map Set Zone n,x1,y1 To x2,y2 — routine 75 ($20a0), 54 bytes. Four
     * words at $2 + (n-1)*8, in the order x1, y1, x2, y2.
     *
     * Zone numbers are 1-based and out of range is IGNORED rather than an
     * error: `tst.l d1 / beq` for zero and `cmp.l $0(a2),d1 / bgt` for past
     * the count, both straight to the rts. The same silence as Tile Tag Set.
     */
    'map set zone'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const z = bankBytes(rt, st().zoneBank)
      const v = new DataView(z.buffer, z.byteOffset, z.byteLength)
      if (n === 0 || n > v.getUint16(0)) return
      const at = 2 + (n - 1) * 8
      v.setUint16(at, x1 & 0xffff)
      v.setUint16(at + 2, y1 & 0xffff)
      v.setUint16(at + 4, x2 & 0xffff)
      v.setUint16(at + 6, y2 & 0xffff)
    },

    /**
     * Tiny Bank n — routine 30 ($1272), eighteen bytes against $7e+$24. Which
     * object bank Tiny Map takes its sixteen icons from; see `tinyIcons`.
     */
    'tiny bank'(it) {
      st().tinyBank = it.evalInt()
    },

    /**
     * Tiny Map x,y,step — routine 29 ($1162), 272 bytes: Map Do drawn at a
     * different scale and out of a different lookup, for the overview map a
     * game shows beside the play area.
     *
     * Two substitutions in what is otherwise Map Do's code. The step is the
     * THIRD argument, stored at $44 and used where Map Do uses the tile size,
     * so the whole map can be squeezed to a pixel a tile. And the icon is not
     * the tile: routine 68 reads the tile's byte from table 0 of the TILE
     * TYPE bank and then `asr.l #$4,d0 / andi.l #$f,d1 / addq.w #$1,d1` takes
     * its HIGH NIBBLE plus one. So a tiny map has at most sixteen icons, and
     * the low nibble of the same byte is left for Tile Val to answer with.
     *
     * Running past the tiny bank's count is a plain `bhi` to a local label
     * that skips the paste -- no error, like List Tile and unlike everything
     * else. The map wrap, the do-while and the argument order are Map Do's.
     */
    'tiny map'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const step = it.evalInt()
      const s = st()
      s.tinyStep = step
      s.cursorX = (x << 16) >> 16
      s.cursorY = (y << 16) >> 16
      const m = mapData(rt)
      const count = tinyIcons(rt)
      s.mapW = m.w
      s.mapH = m.h
      const typ = bankBytes(rt, s.tileTypBank)
      let my = wrap(s.cursorY, m.h)
      let sy = s.viewY1
      do {
        let mx = wrap(s.cursorX, m.w)
        let sx = s.viewX1
        do {
          const icon = (((typ[m.data[4 + my * m.w + mx]!] ?? 0) >> 4) & 0xf) + 1
          if (icon <= count) {
            const img = rt.iconBank?.image(icon)
            if (img) rt.blit(rt.screen, img, sx, sy, true)
          }
          mx = mx + 1 >= m.w ? 0 : mx + 1
          sx += step
        } while (sx < s.viewX2)
        my = my + 1 >= m.h ? 0 : my + 1
        sy += step
      } while (sy < s.viewY2)
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
      draw.do(...args2(it))
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
     * Map Anim On / Off — routines 42 ($1626) and 43 ($1632), twelve bytes
     * each, a single `move.w` of 1 or 0 into $70.
     *
     * Neither touches the animation records, so switching off and on again
     * resumes every animation exactly where it stopped; the countdowns simply
     * stop being decremented in between. That is not the same as Map An
     * Freeze, which is per-animation and does move state around.
     */
    'map anim on'() {
      st().animOn = 1
    },
    'map anim off'() {
      st().animOn = 0
    },

    /**
     * Map Anim n,x,y,cycles,speed,f$ — routine 44 ($163e), 146 bytes.
     *
     * Defines one animation. `f$` is the frame list, one byte a frame, copied
     * into the record at $14 --- the only string argument anywhere in TOME.
     *
     * A NEGATIVE animation number is the movement mode, and this is the one
     * thing about the extension no table or name could have told us:
     *
     *     tst.l d3 / blt.w $16c8
     *     $16c8: neg.w d3 / moveq #$1,d0 / bra.w $1656
     *
     * so `Map Anim -3,...` defines animation 3 with $12 set, and routine 45
     * then reads the frame list in TRIPLES of dx, dy, tile instead of one
     * tile a frame. Same keyword, two engines, selected by a sign.
     *
     * `speed` is stored twice, at $6 as the reload and $8 as the live
     * countdown, so the first fire takes `speed` calls like every one after
     * it. `cycles` is how many times the frame list is played; $ffff (-1)
     * never runs out and 0 means the animation is off from the start.
     *
     * DEFECT: `neg.w` on a LONG register leaves the high word alone, so a
     * negative number reaches `cmp.l $76(a0),d3` still looking negative and
     * PASSES the capacity test whatever the capacity is. `Map Anim -900,...`
     * with room for ten writes 900 records in. Only the positive arm is
     * bounded. Reproduced -- `wrW` drops the out-of-range stores rather than
     * corrupting the next bank, which is the closest a typed array gets.
     *
     * NOTE: `$e` is built with `mulu.w $16(a0),d5`, and $16 is a CACHE that
     * only the drawing routines and Map Scan ever write. Before any of those
     * has run it still holds the shipped 200, so `Map Anim` called first
     * computes an offset for a 200-wide map whatever the bank says. Map Fall
     * and Map Swap Tile read the same two fields and never write them, so all
     * three want a draw to have happened. Not a defect -- the map size is
     * genuinely cached rather than looked up -- but it is the order a program
     * has to get right, and nothing warns it.
     *
     * DEFECT: the frame COUNT stored at $a is the string's own length, but
     * the copy loop stops at 44 (`cmp.l #$2c,d1 / bge`). A longer string
     * leaves $a claiming more frames than were copied and routine 45 reads
     * the difference out of the NEXT record's fields. Reproduced: the bank is
     * one flat array here too, so the same bytes get read.
     */
    'map anim'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const cycles = it.evalInt()
      it.expect(',')
      const speed = it.evalInt()
      it.expect(',')
      const frames = it.evalStr()
      const s = st()
      let d3 = n | 0
      let move = 0
      if (d3 < 0) {
        // neg.w — the low word only, which is what leaves the high word $ffff
        d3 = (d3 & ~0xffff) | (-(d3 & 0xffff) & 0xffff)
        move = 1
      }
      if (d3 >= s.animCap) return // cmp.l $76(a0),d3 / bge — silent
      const { list, base } = animBase(rt)
      const r = base + (d3 & 0xffff) * ANIM
      wrW(list, r + 0, x)
      wrW(list, r + 2, y)
      wrW(list, r + 4, cycles)
      wrW(list, r + 6, speed)
      wrW(list, r + 8, speed)
      wrW(list, r + 0xc, 0)
      wrW(list, r + 0x12, move)
      wrL(list, r + 0xe, ((y & 0xffff) * (s.mapW & 0xffff) + (x & 0xffff)) >>> 0)
      wrW(list, r + 0xa, frames.length & 0xffff)
      if (frames.length === 0) return
      for (let i = 0; i < frames.length && i < 0x2c; i++) {
        const at = r + 0x14 + i
        if (at >= 0 && at < list.length) list[at] = frames.charCodeAt(i) & 0xff
      }
    },

    /**
     * Map Handle screen,x,y — routine 47 ($1824), 662 bytes, a fifth of the
     * library and the reason the other four draws exist.
     *
     * It remembers where the map was last time and does the cheap thing:
     * BltBitMap the screen over itself by one tile in the direction moved,
     * then call Map Left, Map Right, Map Top or Map Bottom to fill the strip
     * that just became visible. A scroll costs one blit and one row or column
     * of tiles instead of a whole `Map Do`.
     *
     * The direction tests are `cmp.w` against the remembered position at
     * $7e+$4, and both axes are handled in the SAME blit -- a diagonal move
     * offsets source x and source y together -- then both edges are drawn.
     *
     * The blit is `BltBitMap` with minterm $cc and mask $ff, source and
     * destination the same bitmap. Its size arguments start as the view's FAR
     * corner rather than a width and height, and $1a28's `sub.w d0,d4` turns
     * them into one; the near corner never appears. So the scroll acts on the
     * screen from (0,0), not from the view rectangle Map View set.
     *
     * DEVIATION: the corner arrives as `$4c(a0)`/`$4e(a0)` off AMOS's screen
     * structure, clipped and clamped by $19c8-$1a50 before the blit. Our
     * `bltBitMap` clips against the bitmap itself, so the clamping is the
     * back-end's rather than transcribed; the reachable results agree because
     * both stop at the same edge.
     *
     * NOTE: `Rjsr <AMOS routine ...>` at $1990 is printed as `L_SaveBMHD` by
     * extdis and it is not that -- it takes a screen NUMBER in d1 and returns
     * that screen's plane table in d0 with its structure in a0. Same class of
     * wrong name as `bankBytes` documents.
     *
     * NOTE: the block ships $7e+$4 as ZERO, not -1. Without a Map Handle Init
     * first, the very first Map Handle compares against (0,0) and scrolls
     * rather than redrawing; only Map Handle Init arms the full-redraw arm.
     */
    'map handle'(it) {
      const screen = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = st()
      s.handleScreen = screen
      s.handleX = x & 0xffff // move.w d0,$0(a0)
      s.handleY = y & 0xffff
      const oldX = sw(s.handleOldX)
      const oldY = sw(s.handleOldY)
      const newX = sw(s.handleX)
      const newY = sw(s.handleY)
      const settle = (): void => {
        s.handleOldX = s.handleX // $18e8
        s.handleOldY = s.handleY
      }
      if (s.handleOldX === 0xffff) {
        // $1844 — Map Handle Init's marker: the whole view, no blit
        draw.do(x, y)
        settle()
        return
      }
      if (oldX === newX && oldY === newY) {
        settle() // $1974 — nothing moved
        return
      }
      // $1850-$1922 — which way, and so which corner the blit reads from
      const srcX = oldX < newX ? s.tileW : 0
      const dstX = oldX > newX ? s.tileW : 0
      const srcY = oldY < newY ? s.tileH : 0
      const dstY = oldY > newY ? s.tileH : 0
      const bm = rt.screens.get(screen)?.rp.bitMap
      if (bm) bltBitMap(bm, srcX, srcY, bm, dstX, dstY, s.viewX2 - srcX, s.viewY2 - srcY)
      if (oldX > newX) draw.left(x, y) // $1926
      else if (oldX < newX) draw.right(x, y) // $1932
      if (oldY > newY) draw.top(x, y) // $193e
      else if (oldY < newY) draw.bottom(x, y) // $194a
      settle()
    },

    /**
     * Map Handle Init — routine 48 ($1aba), twenty bytes:
     * `move.l #$ffffffff,$4(a0)` over the sub-block at $7e.
     *
     * One long across BOTH remembered words, so old x and old y read -1 and
     * the next Map Handle takes the full-redraw arm. The only way to arm it.
     */
    'map handle init'() {
      const s = st()
      s.handleOldX = 0xffff
      s.handleOldY = 0xffff
    },

    /**
     * Map Fall empty — routine 50 ($1ae2), 458 bytes. Boulder Dash, in one
     * keyword.
     *
     * Every column from 1 to width-2 is walked from the BOTTOM up. A tile
     * falls one cell if its type is 3 or more and the cell below is type 0;
     * if the cell below is type 2 or 4 -- a rounded top -- it rolls sideways
     * instead, but only where the side cell AND the one diagonally below are
     * both type 0. `empty` is the tile number left behind. Both the border
     * column and row 0 are excluded, which is why no bounds test is needed.
     *
     * The types come from the tile-type bank at `Rbsr routine 68` plus $100,
     * so Map Fall reads TABLE 2, never table 1. Table 1 stays free for
     * whatever Tile Val is being used for.
     *
     * DEFECT: after a tile falls, `movem.l (a7)+,d5-d6` restores the FALLING
     * tile's type and $1b38 copies it into the landing type, though the cell
     * it names now holds `empty`. So the scan believes the vacated cell is
     * still solid and the tile above it will not fall in the same call. A
     * column collapses one cell a call rather than all at once -- reproduced,
     * because the fall rate of a stack is the visible behaviour of the game.
     *
     * DEFECT: a sideways roll writes the update record with `d0`, the COLUMN
     * LOOP variable, so the record names the cell the tile came FROM and not
     * the one it went to. The vacated cell is recorded twice and the arrival
     * never. Under Map Update a rolling tile leaves a trail. Reproduced.
     *
     * NOTE: unlike routine 45 and Map Swap Tile, the recorder at $1bb2 never
     * tests $68 -- Map Fall appends to the update list whether or not Map
     * Update On was ever called, and arms it.
     */
    'map fall'(it) {
      const empty = it.evalInt()
      const s = st()
      s.fallEmpty = empty & 0xffff
      const { list } = animBase(rt) // routine 66, for the update records
      const map = bankBytes(rt, s.mapBank) // routine 67
      const typ = bankBytes(rt, s.tileTypBank) // routine 68
      const table = 0x100 // adda.l #$100,a2 — the SECOND table
      const w = s.mapW & 0xffff
      const h = s.mapH & 0xffff
      const typeAt = (cell: number): number => typ[table + (map[4 + cell] ?? 0)] ?? 0
      for (let x = 1; x < w - 1; x++) {
        // $1b1a — one column, bottom upwards
        let row = h - 1
        let below = row * w + x
        let belowType = typeAt(below)
        for (;;) {
          row -= 1
          const here = below - w
          if (row < 1) break // cmpi.l #$1,d1 / blt
          const tile = map[4 + here] ?? 0
          const type = typeAt(here)
          if (type < 3) {
            below = here // it is not a faller: it becomes the landing
            belowType = type
            continue
          }
          if (belowType === 0) {
            // $1b82 — straight down
            map[4 + below] = tile
            record(rt, list, tile, x, row + 1)
            map[4 + here] = s.fallEmpty & 0xff
            record(rt, list, s.fallEmpty, x, row)
            below = here
            belowType = type // DEFECT: the type of what LEFT, not of `empty`
            continue
          }
          if (belowType === 2 || belowType === 4) {
            // $1be2 — try to roll, left first
            const side = (dir: -1 | 1): boolean => {
              if (typeAt(here + dir) !== 0) return false
              if (typeAt(below + dir) !== 0) return false
              map[4 + here + dir] = tile
              record(rt, list, tile, x, row) // DEFECT: x, not x + dir
              map[4 + here] = s.fallEmpty & 0xff
              record(rt, list, s.fallEmpty, x, row)
              return true
            }
            if (!side(-1)) side(1) // $1be2 tries left, then $1c00 the right
          }
          below = here // $1b38 — either way, this cell is the next landing
          belowType = type
        }
      }
    },

    /**
     * Map Swap Tile a,b — routine 51 ($1cac), 210 bytes. Every `a` in the map
     * becomes `b` and every `b` becomes `a`, in one pass.
     *
     * The scan runs BACKWARDS from the last cell, which is what makes the
     * swap symmetric in a single pass: a cell is tested against both numbers
     * and rewritten once, so a rewritten cell is never revisited.
     *
     * Records each change into the update list, but only when Map Update On
     * is set (`tst.w $68(a0)`), where Map Fall records unconditionally.
     */
    'map swap tile'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = st()
      const { list } = animBase(rt)
      const map = bankBytes(rt, s.mapBank)
      const w = s.mapW & 0xffff
      const h = s.mapH & 0xffff
      for (let cell = w * h - 1; cell >= 0; cell--) {
        const x = cell % w
        const y = (cell - x) / w
        const tile = map[4 + cell] ?? 0
        // cmp.b — the low bytes, so 256 and 0 are the same tile here
        if (tile === (b & 0xff)) {
          map[4 + cell] = a & 0xff
          if (s.updOn !== 0) record(rt, list, a, x, y)
        } else if (tile === (a & 0xff)) {
          map[4 + cell] = b & 0xff
          if (s.updOn !== 0) record(rt, list, b, x, y)
        }
      }
    },

    /**
     * Map An Freeze n — routine 52 ($1d7e), 48 bytes.
     *
     * Stops one animation by moving its cycle count out of $4 and into $8,
     * the countdown, and zeroing $4 -- so routine 45's first test skips it.
     * $8 is safe to borrow because a stopped animation never reads it.
     *
     * Freezing an already-frozen animation does nothing (`tst.w $4(a2,d0.w) /
     * beq`), so the saved count cannot be overwritten with zero.
     */
    'map an freeze'(it) {
      const n = it.evalInt()
      const s = st()
      if (n >= s.animCap) return
      const { list, base } = animBase(rt)
      const r = base + n * ANIM
      const cycles = rdW(list, r + 4)
      if (cycles === 0) return
      wrW(list, r + 8, cycles)
      wrW(list, r + 4, 0)
    },

    /**
     * Map An Unfreeze n — routine 53 ($1dae), 48 bytes. Freeze reversed:
     * $4 comes back from $8, and $8 is reloaded from the speed at $6.
     *
     * So the animation restarts with a FULL countdown rather than the
     * fraction it had left when it stopped, and its frame index is untouched.
     * Refuses if $4 is not zero, which makes a stray Unfreeze harmless.
     */
    'map an unfreeze'(it) {
      const n = it.evalInt()
      const s = st()
      if (n >= s.animCap) return
      const { list, base } = animBase(rt)
      const r = base + n * ANIM
      if (rdW(list, r + 4) !== 0) return
      wrW(list, r + 4, rdW(list, r + 8))
      wrW(list, r + 8, rdW(list, r + 6))
    },

    /**
     * Map An Move n,x,y — routine 56 ($1e52), 40 bytes: two word stores into
     * $0 and $2, and nothing else.
     *
     * DEFECT: the map offset at $e is NOT recomputed. Routine 45's ordinary
     * arm pokes through $e, so a plain animation moved this way keeps drawing
     * at the cell it was defined at while Map An At and Map An Point report
     * the new position. Only a movement animation recovers, because its arm
     * rebuilds $e from x and y on its next fire. Reproduced -- a game built on
     * the real library either used it on movement animations or worked around
     * it, and either way needs the same behaviour here.
     */
    'map an move'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = st()
      if (n >= s.animCap) return
      const { list, base } = animBase(rt)
      const r = base + n * ANIM
      wrW(list, r + 0, x)
      wrW(list, r + 2, y)
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
     * `tst.w $70(a0) / bne $154a` runs the animation stepper (routine 45)
     * BEFORE the arguments are even popped, and `bra.w $1484` comes straight
     * back -- so with Map Anim On set this keyword steps every animation and
     * then draws what the stepping just recorded, in that order and in one
     * call. Nothing else calls routine 45; Map Update is the clock.
     *
     * NOTE: the other branch, `tst.w $4a(a0)`, is the tile-tag check and is
     * live too -- routine 40's arm at $1552 does `subq.l #$1,d1` first
     * because its d1 has already been incremented, which is how the raw tile
     * is what gets compared.
     */
    'map update'(it) {
      if (st().animOn !== 0) stepAnims(rt) // $147a, before the arguments
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
        tagCheck(rt, tile, mx, my)
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
      draw.left(...args2(it))
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
      draw.right(...args2(it))
    },

    /**
     * Map Top x,y — routine 18 ($cdc). One ROW at the view's top edge,
     * walking x: `addq.w #$1,d4 / add.l $e(a0),d6 / cmp.l $28(a0),d6 / blt`.
     */
    'map top'(it) {
      draw.top(...args2(it))
    },

    /**
     * Map Bottom x,y — routine 19 ($df2). Map Right's trick on the other
     * axis: `(y2 - y1) / tileHeight - 1` rows down from the cursor, drawn at
     * `y2 - tileHeight`, walking x. `$14(a0)` is the low word of the tile
     * height long at $12.
     */
    'map bottom'(it) {
      draw.bottom(...args2(it))
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

/** Routine 8's search, shared with routine 9 exactly as the binary shares it. */
function mapScan(rt: Runtime, a: Value[]): [number, number] {
  const want = int(a[0]!)
  const x0 = (int(a[1]!) << 16) >> 16
  const y0 = (int(a[2]!) << 16) >> 16
  const x2 = int(a[3]!)
  const y2 = int(a[4]!)
  const table = int(a[5]!)
  const s = rt.tome
  const m = mapData(rt)
  s.mapW = m.w
  s.mapH = m.h
  // the two broken bounds, as longs over the word pairs they really read
  const boundY = ((m.h << 16) | ((s.mapBank >>> 16) & 0xffff)) >>> 0
  const boundX = ((m.w << 16) | (m.h & 0xffff)) >>> 0
  const typ = table !== 0 ? bankBytes(rt, s.tileTypBank) : null
  for (let y = y0; y < y2 && y < boundY; y++) {
    for (let x = x0; x < x2 && x < boundX; x++) {
      const tile = m.data[4 + y * m.w + x] ?? 0
      const v = typ ? (typ[(table - 1) * 256 + tile] ?? 0) : tile
      if (v === want) return [x, y]
    }
  }
  return [-1, -1]
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
    /**
     * =Map An Point(n) — routine 54 ($1dde), 36 bytes: the animation's
     * current frame index, straight out of $c.
     *
     * DEVIATION: out of range it does not set d3 OR d2 -- it `rts` with the
     * result registers holding whatever the last extension function left
     * there, so the answer is the previous call's, with the previous call's
     * TYPE. A string function ahead of it would make `=Map An Point(999)`
     * evaluate to a string. That is not behaviour a program can rely on and
     * not something a typed port can produce; 0 is returned instead.
     */
    'map an point': (_, a): Value => {
      const n = int(a[0]!)
      const s = rt.tome
      if (n >= s.animCap) return VI(0)
      const { list, base } = animBase(rt)
      return VI(rdW(list, base + n * ANIM + 0xc))
    },

    /**
     * =Map An At(x,y) — routine 55 ($1e02), 80 bytes. Which animation is at a
     * map cell, or -1.
     *
     * Searches from the HIGHEST animation number DOWN (`move.l $76(a0),d0 /
     * subq.l #$1,d0` then `dbra`), so where two animations sit on one cell
     * the higher number wins -- the same rule Map Zone uses.
     *
     * Only counts animations that are RUNNING: both `tst.w $4(a2,d1.w)` and
     * `tst.w $a(a2,d1.w)` must be non-zero, so one that has used up its
     * cycles, or that Map An Freeze stopped, is invisible here even though
     * its x and y are still in the record.
     *
     * NOTE: with a capacity of zero the 68k's `dbra` runs 65,536 times over
     * memory before the record index, because the loop counter starts at -1
     * and dbra tests the low word. Not reproduced -- the loop simply does not
     * run -- and unreachable anyway, since a zero capacity means Map Anim
     * never wrote a record to find.
     */
    'map an at': (_, a): Value => {
      const x = int(a[0]!) & 0xffff
      const y = int(a[1]!) & 0xffff
      const s = rt.tome
      const { list, base } = animBase(rt)
      for (let n = s.animCap - 1; n >= 0; n--) {
        const r = base + n * ANIM
        if (rdW(list, r + 4) === 0) continue
        if (rdW(list, r + 0xa) === 0) continue
        if (rdW(list, r + 0) !== x) continue
        if (rdW(list, r + 2) !== y) continue
        return VI(n)
      }
      return VI(-1)
    },

    /**
     * =Map Ab Length(updates,anims) — routine 49 ($1ace), twenty bytes:
     * `asl.l #$3` on the first, `asl.l #$6` on the second, add, `addq #$4`.
     *
     * How big to Reserve the shared bank, and the three constants that fix
     * its layout: eight bytes an update record, 64 an animation record, and a
     * four-byte header holding the offset where the animations begin. Map
     * Anim Bank writes that same `updates * 8 + 4` into the head.
     */
    'map ab length': (_, a): Value => VI((((int(a[0]!) & 0xffff) << 3) + ((int(a[1]!) & 0xffff) << 6) + 4) | 0),

    /**
     * =Tile Tag — routine 60 ($1ec4), 24 bytes and no arguments: read the
     * byte at $48 and CLEAR it. One bit per slot, set by the last map draw
     * for every tagged tile it passed. Reading is destructive, so the answer
     * is "which tags went by since I last asked", and the draws clear it
     * again at entry, so in practice it means "on the last draw".
     */
    'tile tag': (): Value => {
      const s = st()
      const seen = s.tagSeen & 0xff
      s.tagSeen = 0
      return VI(seen)
    },

    /**
     * =Tile Tag X(slot) — routine 61 ($1edc) — and =Tile Tag Y(slot),
     * routine 62 ($1efa). Thirty bytes each: the same `subq.l #$1 / andi.l
     * #$7` wrap into 0..7 that Tile Tag Set uses, then a word out of the $38
     * or $48 table in the $7e block -- the MAP position where the tagged tile
     * was found, not a screen one.
     *
     * NOTE: neither table is initialised. Routine 0 clears the eight tag
     * VALUES at $30 and nothing else, so reading a slot that has never been
     * matched answers whatever the library was assembled with. Zero here.
     */
    'tile tag x': (_, a): Value => VI(st().tagX[(int(a[0]!) - 1) & 7]!),
    'tile tag y': (_, a): Value => VI(st().tagY[(int(a[0]!) - 1) & 7]!),

    /**
     * =Map Zb Length(n) — routine 73 ($206c), fourteen bytes: `asl.l #$3,d3 /
     * addq.l #$2,d3`. Eight bytes a zone plus the count word.
     */
    'map zb length': (_, a): Value => VI((((int(a[0]!) & 0xffff) << 3) + 2) | 0),

    /**
     * =Map Zone(x,y) — routine 76 ($20d6), 88 bytes. Which zone a point is
     * in, or 0.
     *
     * Two details that decide what a game does with it. Both corners are
     * INCLUSIVE -- `cmp.w d3,d1 / blt` and `cmp.w d4,d1 / bgt`, so a point
     * exactly on x2 is inside -- where every drawing loop in this extension
     * treats the far edge as exclusive. And the search runs from the HIGHEST
     * zone number DOWN (`move.w $0(a2),d0 / subq.l #$1 / dbra`), so where
     * zones overlap the highest-numbered one wins.
     *
     * The comparisons are `cmp.w`, so they see the low WORDS and they are
     * SIGNED. That is what makes Map Zone Bank's $FF fill work as "no zone":
     * an unset zone reads as -1 in all four corners, and only x = y = -1 is
     * inside it.
     */
    'map zone': (_, a): Value => {
      const x = (int(a[0]!) << 16) >> 16
      const y = (int(a[1]!) << 16) >> 16
      const z = bankBytes(rt, st().zoneBank)
      const v = new DataView(z.buffer, z.byteOffset, z.byteLength)
      for (let n = v.getUint16(0); n >= 1; n--) {
        const at = 2 + (n - 1) * 8
        if (x < v.getInt16(at) || x > v.getInt16(at + 4)) continue
        if (y < v.getInt16(at + 2) || y > v.getInt16(at + 6)) continue
        return VI(n)
      }
      return VI(0)
    },

    /**
     * =Map Scan X(v,x,y To x2,y2,table) — routine 8 ($840), 162 bytes — and
     * =Map Scan Y, routine 9 ($8e2), which is TEN bytes: `Rbsr routine 8`
     * then `move.l $44(a0),d3`. So asking for the y runs the whole scan
     * again and reads the other half of the answer out of the same scratch.
     *
     * Find the first cell holding `v`, walking rows from (x,y) and stopping
     * before x2 and y2. Not found is -1 in both, preloaded into $40 and $44
     * before the search starts.
     *
     * The sixth argument selects WHAT is compared. Zero scans the raw tile
     * byte; anything else goes through routine 68 and the tile-type bank,
     * `adda.l $38(a0),a2 / suba.l #$100,a2` where $38 is the argument shifted
     * left eight -- so the tables are 1-based here where Tile Val's are
     * 0-based, and `table` 1 is Tile Val's table 0.
     *
     * DEFECT: the map's own bounds do not work. `cmp.l $18(a0),d5` and
     * `cmp.l $16(a0),d4` read LONGS off two WORD fields, so the first picks
     * up the map height beside the top half of the bank number at $1a and the
     * second the width beside the height. Both come out around 65,536 times
     * too large, and the scan is bounded only by the x2/y2 the caller gave.
     * Reproduced, because a program asking for a range past the edge of its
     * map got tiles read past the edge of its map, and would have been
     * written around that.
     */
    'map scan x': (_, a): Value => VI(mapScan(rt, a)[0]),
    'map scan y': (_, a): Value => VI(mapScan(rt, a)[1]),

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
