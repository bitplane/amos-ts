/**
 * TURBO Plus — a large graphics and system extension by Manuel Andre.
 *
 * The most used unimplemented extension in the corpus: 136 programs across
 * its three builds. Those builds are one lineage rather than three
 * extensions — 1.0's 134 keywords are a strict subset of 2.15's, and 1.9
 * shares 83 of its 87 with 1.0 — and the 2.15 manual says as much, calling
 * itself "a patched-up version of TURBO V1.0". So one set of handlers serves
 * all three, while the coverage manifest keeps them separate because 1.9 has
 * four keywords the others lack.
 *
 * ## Evidence
 *
 * `TURBO_DocsV2.15.Asc`, the extension's own manual, documents 128 of its
 * 152 keywords — and, measured against the corpus, 62 of the 63 keywords
 * programs actually call. Where the manual is thin the routine is read out
 * of the binary with `extdis`; those cases say so individually.
 *
 * ## What TURBO was for
 *
 * Speed, on a machine where AMOS's own drawing was too slow for a game. Many
 * keywords are faster replacements for core ones (`F Plot` for `Plot`), and
 * several exist purely to work around AMOS 1.3's `Multi No`, which disabled
 * the keyboard and mouse outright — `Left Click` and `Raw Key` are there so
 * a program could still read input with multitasking off. Under AMOS Pro
 * that stopped being necessary, and the manual says so, but programs kept
 * using them for compatibility.
 */
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import type { BankImage, ObjectBank } from './objects'
import type { Runtime } from './runtime'
import type { Screen } from './screen'

/**
 * TURBO's own error messages, read out of the 2.15 binary at $6e44 — the
 * table routine 338 indexes with the code the failing routine leaves in d0.
 * The whole extension shares it, so every phase can raise the message the
 * real library would have raised rather than an invented one. The author's
 * spelling is preserved, "allready" and all.
 *
 * Errors 19 upwards belong to phases not yet ported; they are listed because
 * the table is one artifact and splitting it would invite drift.
 */
export const TURBO_ERRORS = [
  'Check allready reserved',
  'Check not reserved',
  'Object is allready defined',
  'Object is not defined',
  'Too many draws in object',
  'Too many moves in object',
  'Too many attributes in object',
  'This is not an object file',
  'Stars allready reserved',
  'Stars not reserved',
  'Stars int allready on',
  'Blit store allready defined',
  'Blit store not defined',
  'Blit int allready on',
  'Limit allready set',
  'Limit allready cleared',
  'Limit should be max : 32000',
  'Some objects still defined, Erase them',
  'Object count exceeds object limit',
  'Scene Area is not defined',
  'View not defined for this screen',
  'Scene definition not defined for this screen',
  'Scene Bank not defined',
  'Blit int not on',
  'FontInfo Bank not defined ',
  'Sprite or Icon bank not defined ',
  'Only Sprite or Icon banks can be used ',
  "This isn't a FontInfo bank ",
  "This isn't a Scene bank ",
  'Jump out of range.',
  'Incorrect switch value. Range is 1 to 32',
  'Incorrect program value. Range is 1 to 32',
  'Frame program allready reserved',
  'Program nr. exceeds nr. of programs for frame',
  'Until found without matching Repeat',
] as const

/** raise a TURBO error by the code the routine puts in d0 */
function turboError(n: number): never {
  throw new AmosError(TURBO_ERRORS[n] ?? `TURBO error ${n}`)
}

/** `Rbra routine 62` / `Rbra routine 64`: TURBO's two exits into AMOS's own errors */
// annotated rather than inferred so a call counts as an exit for the
// compiler's control-flow analysis
const funcCall: () => never = () => {
  throw new AmosError('Illegal function call', 23)
}

/**
 * A TURBO Check zone: its own rectangle system, not AMOS's.
 *
 * Five words in the library, laid down by `movem.w d0-d4,(a0)` in routine 335
 * — the zone's own number, then x1, x2, y1, y2 — and read back by routine 16
 * in that order. The leading word is a value, not a flag: `Reset Check` writes
 * -1 into it and `Check` skips any entry whose word is negative (`bmi`), while
 * a hit returns the word itself. So `value` is what the keyword answers with,
 * and a freshly reserved zone that has never been Set carries 0.
 */
export interface CheckZone {
  x1: number
  y1: number
  x2: number
  y2: number
  /** the leading word: the zone number for a Set zone, -1 for a Reset one */
  value: number
}

/**
 * The vector-object table, laid out as the library lays it out: a limit, an
 * array of per-object vector lists, and — separately — an array of counts.
 *
 * Keeping the counts in their own array rather than on the object is not
 * bookkeeping pedantry. `Object Erase` clears the pointer and leaves the
 * count behind (routine 328 never touches the count array), so a `Define
 * Draw` against an erased object is checked against a stale count and
 * reports "Too many draws in object" before it ever reaches the
 * "Object is not defined" test. Two arrays reproduce that; one would not.
 */
export interface TurboObjects {
  /** `Object Limit`; 0 means the structure does not exist */
  limit: number
  /**
   * Per object, its vector list: three words per element — type, then two
   * operands. Type 0 draws, -1 moves, 1 stops, anything else sets attributes.
   * `null` is an object that is not defined.
   */
  els: Array<Int16Array | null>
  /** per object, the element count `Reserve Object` was given */
  counts: number[]
}

/**
 * The starfield, laid out as routine 323 lays it out.
 *
 * A star is four words — X, Y, X SPEED, Y SPEED — which is the "COUNT*8" the
 * manual tells you to budget for. The other half of its formula, "Heigth of
 * screen*2", is a table of row offsets the reserve computes up front: "It
 * also computes in advance the address of the start of every line. This is
 * done for more speed when displaying the 'STARS'." Row offsets are implicit
 * here, but the consequence the manual shouts about is not — the table
 * belongs to the screen the stars were reserved on, and drawing them
 * anywhere else scribbles over whatever is there.
 */
export interface TurboStars {
  /** four words per star: X, Y, X SPEED, Y SPEED */
  data: Int16Array
  /** 0 when nothing is reserved; capped at 4000 by the routine */
  count: number
  /** the clip rectangle at +$206, which Reserve Stars fills with the screen */
  clip: { x1: number; y1: number; x2: number; y2: number }
  /** the screen Reserve Stars ran on — where the interrupt draws */
  screen: number
  /** Stars Int On: the VBL server is installed */
  int: boolean
  /** its CLEAR argument — the "AUTOMATIC CLEAR MODE" */
  intClear: boolean
}

/**
 * A stored scrolling zone — one of the 96 `Blit Store Left` / `Blit Store Up`
 * definitions, held here as what the blit does rather than as the blitter
 * registers the routine precomputes (a 20+depth*8 byte record of BLTCON0/1,
 * the modulos, the size word and a source and destination address per plane).
 *
 * `masks` is the exception, kept because it is observable: `Blit Speed`
 * decides which way a zone scrolls by testing bits of it, and gets it wrong.
 */
export interface BlitDef {
  /** the screen the zone was defined on; Multi Blit scrolls that one */
  screen: number
  /** the region, with x chopped to a 16-pixel boundary as the routine chops it */
  x0: number
  y0: number
  x1: number
  y1: number
  /** the shift, 1-15 — the magnitude; `left` carries the sign */
  shift: number
  /** the blitter's DESC bit: scrolling left rather than right */
  left: boolean
  /** a Blit Store Up definition: a vertical move, not a barrel-shift */
  vertical: boolean
  /** vertical only: the row delta after the routine's clamp to the screen */
  dy: number
  /** BLTAFWM/BLTALWM as the routine computes them — see Blit Speed */
  masks: number
}

export interface TurboState {
  /**
   * Check zones, TURBO's replacement for AMOS's Zone commands. "These
   * commands are not compatible with the normal Zone commands!"
   */
  checks: CheckZone[]
  /** vector objects — `Object Limit` through `Object Load` */
  objects: TurboObjects
  /** the starfield — `Reserve Stars` through `Stars Int Off` */
  stars: TurboStars
  /** the 96 scrolling zones, 1-based in BASIC and 0-based here */
  blits: Array<BlitDef | null>
  /**
   * The `Eye 3d` point of view, at +$74/$76 of the structure. "If not
   * initialised when using the Line 3d instruction X will have a value of
   * 160 and Y a value of 100" — the centre of a standard screen.
   */
  eye: { x: number; y: number }
  /**
   * `Plane Offset`'s table: per screen, a byte offset for each of six
   * planes. It is separate from what the screen displays because the
   * routine keeps it separate — the offsets sit here until Plane Update
   * folds them into the pointers the copper reads, which is why the manual
   * says "you should use Plane Update instead of the AMOS View command".
   */
  planeOffsets: Map<number, Int32Array>
  /**
   * `Reserve Static Block`'s table: the count reserved, and the block
   * numbers `Build Static Block` found in AMOS's list.
   */
  staticBlocks: { size: number; built: Set<number> } | null
  /** `Blit Int On start To end`, or null when no server is installed */
  blitInt: { from: number; to: number } | null
  /**
   * The word `Blit Int Wait` writes. Its sense is inverted from its name:
   * `Blit Int Wait False` stores 1 and the interrupt runs, `Blit Int Wait
   * True` stores 0 and it does not. Zero at the start of a program, so
   * "Blit Int On ... Up to this point nothing will happen."
   */
  blitGo: number
  /**
   * The task priority Multi No / Multi Yes / Amos Pri set. There is no
   * scheduler here to apply it to; it is kept so a program that reads it
   * back sees what it wrote.
   */
  priority: number
  /** the icon tile-map engine — `Scene Bank` through `Scene 32 Right` */
  scene: TurboScene
  /**
   * `Multi Bload`'s error word: 0 for none, -1 for out of memory (the
   * routine sets the high byte with `sf.b`), otherwise a DOS error code.
   */
  blError: number
}

/**
 * A viewport, as `Scene 16/32 View` leaves it in the structure at $398 (the
 * 16 set) and $3a8 (the 32 set). The fields are stored in exactly the units
 * the library stores them in, because one of them is wrong — see `yb`.
 */
export interface SceneView {
  /** the screen the view was declared on; drawing on another is error 20 */
  screen: number
  /** tiles across, `(x2-x1)>>4` — the whole-tile count, nothing partial */
  cols: number
  /** tiles down, `(y2-y1)>>4` */
  rows: number
  /** `x1>>3`: the left edge as a byte offset into a bitplane row */
  xb: number
  /**
   * `y1`, in pixels, and used by the drawing core as a byte offset — the
   * regression described on `sceneViewCore`.
   */
  yb: number
  /** `(x2-16)>>3`, the left edge of the last column, for `Scene Right` */
  right: number
  /** `y2-16`, the top of the last row, for `Scene Bottom` */
  bottom: number
}

/**
 * A `Scene 16 Def` definition: the 78-byte record the library fills in and
 * `Scene 16 Restore` replays. It captures the scene and icon banks as
 * pointers, so a definition outlives the `Scene Bank` setting that made it
 * and keeps drawing from wherever it was pointed.
 */
export interface SceneDef {
  screen: number
  /** the icon bank pointer captured at Def time ($42) */
  icons: ObjectBank
  /** the scene bank's tile data captured at Def time ($46) */
  scene: Uint8Array
  /** scene bytes per row, width*2 ($26) */
  sceneRowBytes: number
  /** `scenex*2` ($1a) */
  sx2: number
  /** `sceney*width*2` ($2a) */
  sceneRowOff: number
  /** tiles across and down, after both clips ($1c/$1e, less their -1) */
  cols: number
  rows: number
  /** `xscreen>>3` ($20) and `yscreen*rowBytes` ($36) */
  destX: number
  destY: number
  /** `rowBytes*16` ($3e) */
  rowStep: number
}

/** the whole Scene subsystem's state */
export interface TurboScene {
  /** `Scene Bank n`; 0 = none set */
  bank: number
  /** `Scene Icon Bank n`, "set to 2 (default setting, normal icon bank)" */
  iconBank: number
  /** `Scene Mask Palette`, "set to -1 (all bits set) if you do a RUN" */
  maskPalette: number
  view16: SceneView | null
  view32: SceneView | null
  /** `Scene 16 Limit`'s array of definitions; empty until it is called */
  defs: Array<SceneDef | null>
}

export const newTurboState = (): TurboState => ({
  checks: [],
  objects: { limit: 0, els: [], counts: [] },
  stars: {
    data: new Int16Array(0),
    count: 0,
    clip: { x1: 0, y1: 0, x2: 0, y2: 0 },
    screen: 0,
    int: false,
    intClear: false,
  },
  blits: Array.from({ length: 96 }, () => null),
  eye: { x: 160, y: 100 },
  planeOffsets: new Map(),
  staticBlocks: null,
  blitInt: null,
  blitGo: 0,
  priority: 0,
  scene: { bank: 0, iconBank: 2, maskPalette: -1, view16: null, view32: null, defs: [] },
  blError: 0,
})

/**
 * The two settings the extension re-initialises from its Default hook, and
 * the interpreter re-initialises at Run: "Scene Icon Bank is set to 2
 * (default setting, normal icon bank) when you run a program, when you call
 * Default. This is done for compatibility with the 'older' TURBO_PLUS libs",
 * and the mask is "set to -1 (all bits set) if you do a RUN or a DEFAULT".
 */
export function turboDefault(rt: Runtime): void {
  rt.turbo.scene.iconBank = 2
  rt.turbo.scene.maskPalette = -1
}

/** 68k word truncation: the vector list stores words and Draw takes D0:16 */
const w = (v: number): number => (v << 16) >> 16

/**
 * The object a drawing keyword names, with the three checks the four draw
 * routines share and in their order (routine 34, $126a): `Rble` into AMOS's
 * own error, then the limit, then the pointer.
 */
function drawTarget(rt: Runtime, n: number): Int16Array {
  const t = rt.turbo.objects
  if (n <= 0) funcCall()
  if (n > t.limit) turboError(18)
  const p = t.els[n - 1]
  if (!p) turboError(3)
  return p
}

/**
 * The element a `Define` keyword names. `tooMany` is the error each routine
 * raises when the element is past the reserved count — they differ, and
 * `Define Stop` shares `Define Move`'s "Too many moves in object" (routine
 * 330 branches to the same `moveq #$5`).
 */
function defineAt(rt: Runtime, obj: number, el: number, tooMany: number): { p: Int16Array; at: number } {
  const t = rt.turbo.objects
  if (el <= 0) funcCall()
  if (obj > t.limit) turboError(18)
  // an object number of 0 reports "not defined" here, where Reserve Object
  // reports an illegal function call for the same input
  if (obj < 1) turboError(3)
  if (el > (t.counts[obj - 1] ?? 0)) turboError(tooMany)
  const p = t.els[obj - 1]
  if (!p) turboError(3)
  return { p, at: (el - 1) * 3 }
}

/** walk an object's vector list, mapping each coordinate pair through `xf` */
function objectWalk(rt: Runtime, n: number, xf: (x: number, y: number) => [number, number]): void {
  const p = drawTarget(rt, n)
  const count = rt.turbo.objects.counts[n - 1] ?? 0
  const s = rt.screen
  for (let i = 0; i < count; i++) {
    const type = p[i * 3]!
    const a = p[i * 3 + 1]!
    const b = p[i * 3 + 2]!
    if (type === 0) {
      // graphics.library Draw, from the cursor to the point, cursor follows
      const [x, y] = xf(a, b)
      s.line(s.grX, s.grY, x, y)
    } else if (type < 0) {
      // a Move writes both words straight into rp_cp_x/cp_y at +$24
      const [x, y] = xf(a, b)
      s.grX = x
      s.grY = y
    } else if (type === 1) {
      return
    } else {
      // SetAPen then SetDrMd, on the screen's own RastPort — so the colour
      // and writing mode outlive the Object Draw that changed them
      s.ink = a
      s.grMode = b & 7
    }
  }
  // Falling off the end without a Stop is where the original misbehaves: the
  // attribute branch drops through into the Move code and reads four bytes
  // past the vector list. The manual is emphatic about it — "Make sure that
  // the last ELEMENT of an OBJECT definition is a Stop instruction. And
  // nothing unpredictable will happen." — so this stops instead.
}

/**
 * `Check` (routine 16, $1000), `Hit Bob Check` (136, $472a) and `Hit Spr
 * Check` (21, $10ce) all end in the same twenty-two instructions, and they
 * are byte-for-byte the same scan three times over.
 *
 * Zone numbers are 1-based, as they are for core AMOS `Set Zone` — the TURBO
 * manual says Set Check "does the same thing as the Set Zone command" — so
 * `Reserve Check 650` numbers them 1..650 and the array is indexed one lower.
 *
 * Three things the manual does not say, all of them in the twenty-two
 * instructions:
 *
 *   - nothing reserved is TURBO's own error 1, "Check not reserved", not a
 *     quiet zero (`cmpi.w #$0,$8(a1) / beq` into routine 338)
 *   - an end past the count, a start below 1, or an end below the start are
 *     each an illegal function call, not a clamp
 *   - the ANSWER is the zone's leading word, which Set Check filled with the
 *     zone's own number. The manual's "Returns 1 is the result is true" is
 *     true of zone 1 and of nothing else: Check(1 To 10,x,y) hitting zone 7
 *     answers 7.
 *
 * The scan stops at the first zone that contains the point, so a zone that
 * has been reserved and never Set — leading word 0, rectangle 0,0 to 0,0 —
 * swallows the point (0,0) and answers 0, which is indistinguishable from a
 * miss and hides any later zone that would have matched it.
 */
function checkHit(rt: Runtime, from: number, to: number, x: number, y: number): number {
  const zones = rt.turbo.checks
  if (zones.length === 0) turboError(1)
  if (to > zones.length || from < 1 || to < from) funcCall()
  for (let i = from - 1; i <= to - 1; i++) {
    const z = zones[i]!
    if (z.value < 0) continue
    // all four edges inclusive: bgt/blt out, so equality stays in
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return z.value
  }
  return 0
}

/**
 * `divs.w`, which two TURBO keywords are visibly built on and neither of them
 * expects: a 32-bit dividend over the LOW WORD of the divisor, truncated
 * towards zero rather than floored — and on overflow the 68000 leaves the
 * destination register completely alone.
 *
 * So the caller gets the dividend back untouched when the quotient will not
 * fit in sixteen bits, which is exactly what `T Clip` (routine 149) and
 * `Line 3d` (routine 41) then feed to their word-sized `muls.w`/`add.w`.
 * Both callers take the low word of what comes back, so returning the
 * dividend is the whole of the reproduction.
 */
function divsw(dividend: number, divisor: number): number {
  const d = (divisor << 16) >> 16
  // a divisor whose low word is zero takes the 68k divide-by-zero exception;
  // there is no trap here, so it raises what the keyword's own guard would
  if (d === 0) funcCall()
  const q = Math.trunc(dividend / d)
  return q < -0x8000 || q > 0x7fff ? dividend : q
}

/** `Reserve Object OBJECT,COUNT` — routine 333 ($6ce6), shared by 1.9's two names */
function reserveObject(rt: Runtime, it: Interp): void {
  const obj = it.evalInt()
  it.expect(',')
  const count = it.evalInt()
  const t = rt.turbo.objects
  if (count <= 0) funcCall()
  // with no limit set the comparison is against 0, so any object number is
  // "over the limit" — which is how reserving before Object Limit fails
  if (obj > t.limit) turboError(18)
  if (obj < 1) funcCall()
  if (t.els[obj - 1]) turboError(2)
  // AllocMem(COUNT*6, MEMF_PUBLIC|MEMF_CLEAR): "reserves COUNT*6 bytes".
  // The out-of-memory exit (routine 64) cannot be reached here.
  t.els[obj - 1] = new Int16Array(count * 3)
  t.counts[obj - 1] = count
}

/** OBJECT,ELEMENT To A,B — the argument shape Define Draw/Move/Attr share */
function defineArgs(it: Interp): [number, number, number, number] {
  const obj = it.evalInt()
  it.expect(',')
  const el = it.evalInt()
  it.expect('to')
  const a = it.evalInt()
  it.expect(',')
  const b = it.evalInt()
  return [obj, el, a, b]
}

/**
 * The filename Object Save and Object Load take. Both copy it into an 80-byte
 * buffer and raise AMOS error 21 above that, where the manual claims "If
 * "NAME" > 80 chars nothing will happen" — the routine's `moveq #$15` says
 * otherwise.
 */
function objectFileName(it: Interp): string {
  const name = it.evalStr()
  if (name.length > 80) throw new AmosError('String too long', 21)
  return name
}

/**
 * `Object Load "NAME",START` — routine 326 ($68ca). The file is "OBJE", a
 * word holding END-START, then per object a word count and count*6 bytes.
 */
function objectLoad(rt: Runtime, it: Interp): void {
  const name = objectFileName(it)
  it.expect(',')
  const start = it.evalInt()
  const t = rt.turbo.objects
  const bytes = rt.fs?.read(name)
  // Open failing, and the header read coming up short, both return silently
  if (!bytes || bytes.length < 8) return
  const u = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'OBJE') turboError(7)
  let idx = start - 1
  const last = u.getInt16(4, false) + idx
  if (t.limit === 0 || last > t.limit - 1) turboError(18)
  // DEVIATION: START below 1 indexes behind the pointer array on the real
  // machine, which is memory corruption rather than behaviour to reproduce
  if (idx < 0) return
  let count = u.getInt16(6, false)
  let off = 8
  for (;;) {
    // "Object Load "DF1:OBJECT1_TO_4",2 will not work. First you must
    // discard objects 2 to 5!" — and it just stops, with no error
    if (t.els[idx]) return
    if (off + count * 6 > bytes.length) return
    const p = new Int16Array(count * 3)
    for (let k = 0; k < count * 3; k++) p[k] = u.getInt16(off + k * 2, false)
    off += count * 6
    t.els[idx] = p
    t.counts[idx] = count
    idx++
    if (idx > last) return
    if (off + 2 > bytes.length) return
    count = u.getInt16(off, false)
    off += 2
  }
}

/**
 * One pass over stars `from`..`to`: move each by its speed, wrap it at the
 * clip rectangle, and — for the drawing forms — plot where it was before the
 * move. "Displays the 'STARS' onto the screen and computes the next position
 * of the 'STARS' depending on the X- and Y SPEEDS", in that order.
 *
 * `xOnly` is the interrupt server, which skips the Y half: "Only the X-speed
 * is changed (for more speed)."
 *
 * The clip edges are deliberately local and mutable. The wrap-left path is
 * `adda.w d5,a3` — it adds the overshoot into the register holding the right
 * edge and never puts it back, so every later star in the same pass wraps to
 * a slightly different column. The author knew: "This instruction works fine
 * now as it is, but is not really finished yet...somethimes you don't get
 * what you want!". Reloaded from the structure at each call, so the drift
 * lasts one pass and no longer.
 */
function starsStep(
  st: TurboStars,
  from: number,
  to: number,
  plot: ((x: number, y: number) => void) | null,
  xOnly = false,
): void {
  let { x1, y1, x2, y2 } = st.clip
  for (let i = from; i <= to && i < st.count; i++) {
    const o = i * 4
    const x = st.data[o]!
    const y = st.data[o + 1]!
    const dx = st.data[o + 2]!
    const dy = st.data[o + 3]!
    if (dx !== 0) {
      const nx = w(x + dx)
      if (nx >= x2) st.data[o] = w(nx - x2)
      else if (nx < x1) st.data[o] = x2 = w(x2 + nx)
      else st.data[o] = nx
    }
    if (dy !== 0 && !xOnly) {
      const ny = w(y + dy)
      if (ny < y1) st.data[o + 1] = y2 = w(y2 + ny)
      else if (ny >= y2) st.data[o + 1] = w(ny - y2)
      else st.data[o + 1] = ny
    }
    plot?.(x, y)
  }
}

/**
 * `bset` into the first bitplane: "I use only 1 bitplane (the first one), so
 * only 1 coloured 'STARS' are possible... But you can change the colour of
 * them with the Palette or Colour instructions!"
 *
 * The routine computes its byte address from the row table and does not check
 * anything, so a star outside the screen writes outside the bitmap. That is
 * the crash the manual warns about; here it is skipped.
 */
function starsPlotter(rt: Runtime, screen: number): (x: number, y: number) => void {
  const s = rt.screens.get(screen) ?? rt.screen
  const px = s.pixelsW()
  return (x, y) => {
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
    px[y * s.width + x]! |= 1
  }
}

// ---- the fast drawing keywords, and 3D ----

/**
 * The F keywords reach past the RastPort and poke the bitplanes themselves,
 * which is where their speed comes from and what they give up for it: the
 * manual lists F Draw, F Plot, F Point and F Circle among the "TURBO
 * commands where the mask is not recognized", and admits of F Draw that "The
 * Set Line MASK command has no effect... this will be corrected in a future
 * update".
 */
function rawDraw(s: Screen, body: () => void): void {
  // bypass the RastPort, which is exactly what the F keywords do: neutralise
  // rp_Mask and rp_LinePtrn for the duration, then put the whole state back
  const saved = s.rp.snapshot()
  s.rp.mask = 0xff
  s.rp.linePtrn = 0xffff
  try {
    body()
  } finally {
    s.rp.restore(saved)
  }
}

/**
 * The digit-by-digit integer square root routine 65 is, with the rounding
 * step it ends on: if what is left over reaches the root, round up.
 *
 * `bits` is 32 for `F Sqr` and 16 for the copy inside `F Circle` — and that
 * difference is the whole of the circle's documented bug, because the word
 * version can only see the low half of r*r - x*x.
 */
function turboSqrt(v: number, bits: 16 | 32): number {
  const trunc = bits === 16 ? (x: number): number => (x << 16) >> 16 : (x: number): number => x | 0
  let rest = trunc(v)
  let root = 0
  let step = bits === 16 ? 0x4000 : 0x40000000
  do {
    const guess = trunc(root + step)
    root = bits === 16 ? (root & 0xffff) >>> 1 : root >>> 1
    if (rest > guess) {
      rest = trunc(rest - guess)
      root |= step
    }
    step = (bits === 16 ? step & 0xffff : step >>> 0) >>> 2
  } while (step !== 0)
  if (rest >= root) root++
  return root
}

// ---- the machine-level tail ----

/**
 * One 68k shift instruction. A `.b` or `.w` shift touches only that much of
 * the register, so the bits above it come back unchanged — `Lsl.b($1234,4)`
 * is $1240, not $12340. The count is taken mod 64, as a register shift is.
 */
function shiftOp(a: Value[], width: 8 | 16 | 32, right: boolean): number {
  const v = int(a[0] ?? VI(0))
  const n = int(a[1] ?? VI(0)) & 63
  const mask = width === 32 ? -1 : (1 << width) - 1
  const part = v & mask
  const shifted = n >= width ? 0 : right ? (part & mask) >>> n : (part << n) & mask
  return width === 32 ? shifted | 0 : (v & ~mask) | shifted
}

/**
 * `Byte Hunt` (routine 137, $47a2) and `Word Hunt` (routine 159, $4e36).
 * "If ACTION=0 the Byte Hunt command behaves just like the normal Hunt
 * command. Only VAL1 is checked for. If ACTION=-1 ... any value lying
 * outside the values VAL1 to VAL2, inclusive. If ACTION=1 ... any value
 * lying inside".
 *
 * The two are the same ninety-odd bytes with the operand size changed, and
 * three things follow from that which the manual does not say:
 *
 *   - the tests are `cmp.b`/`cmp.w`, so memory AND both bounds are read
 *     SIGNED at that width. `Byte Hunt(...,1,200,250)` looks for a byte
 *     between -56 and -6, which is an empty range, and finds nothing.
 *   - VAL1 and VAL2 are never compared with each other, so passing them the
 *     wrong way round makes the inside test match nothing and the outside
 *     test match everything.
 *   - the loop bounds differ. Byte Hunt decrements the count after the test
 *     and carries on while it is not negative, so it covers [start, end]
 *     inclusive; Word Hunt carries on only while it is positive, so it stops
 *     one word short of the end. Both read at least once, whatever the span.
 */
function memHunt(rt: Runtime, a: Value[], unit: 1 | 2): number {
  let from = int(a[0] ?? VI(0))
  let to = int(a[1] ?? VI(0))
  const action = int(a[2] ?? VI(0))
  const sw = unit === 1 ? (v: number): number => (v << 24) >> 24 : (v: number): number => (v << 16) >> 16
  const v1 = sw(int(a[3] ?? VI(0)))
  const v2 = sw(int(a[4] ?? VI(0)))
  // "START and END adress are made automatically even" — `bclr #0` on both,
  // before the comparison that may swap them
  if (unit === 2) {
    from &= ~1
    to &= ~1
  }
  // "If START is greater than END the addresses are swapped so that the
  // command still works"
  if (from > to) [from, to] = [to, from]
  const m = rt.resolveAddr(from)
  if (!m) return 0
  const span = to - from
  const last = unit === 1 ? span : Math.max(0, span - 2)
  for (let i = 0; i <= last; i += unit) {
    const at = m.off + i
    if (at + unit > m.data.length) break
    const val = sw(unit === 1 ? m.data[at]! : (m.data[at]! << 8) | m.data[at + 1]!)
    const hit = action === 0 ? val === v1 : action > 0 ? val >= v1 && val <= v2 : val < v1 || val > v2
    if (hit) return from + i
  }
  return 0
}

/**
 * `Parse$`, which is undocumented and does not return a string despite its
 * name: routine 180 leaves an integer in d3.
 *
 * `Parse$(source$, n, alternatives$, notfound)` takes word `n` of the source
 * — words being separated by space, comma or full stop, the three literals
 * `move.b #$20/#$2c/#$2e` at $544a — and matches it against a list of
 * alternatives separated by `|`, returning which one matched, counting from
 * one, or `notfound`. A command parser for text adventures, in one keyword.
 * A word number of zero or less is `Rble routine 62`.
 *
 * DEFECT: an alternative is only accepted if a `|` follows it. Having
 * matched every byte of the word, $54be checks `cmp.b (a0),d1` for the
 * separator and falls to the not-found tail when it is missing — so the LAST
 * alternative in the list can never be returned unless the list ends with a
 * trailing `|`. `Parse$(a$,1,"north|south|east",0)` answers 1 and 2 and
 * never 3.
 *
 * An empty alternative — two bars together — is stepped over at $54ca with
 * the counter incremented and no comparison made, so it takes a number and
 * matches nothing.
 *
 * One departure: the two early exits for an empty source or an empty
 * alternatives list jump to the routine's common tail, which pops a long
 * that was never pushed and returns into it. That is a crash; here it is
 * the not-found value.
 */
function parseWord(source: string, n: number, alternatives: string, notfound: number): number {
  if (n <= 0) throw new AmosError('Illegal function call', 23)
  if (source === '' || alternatives === '') return notfound
  const sep = (c: string): boolean => c === ' ' || c === ',' || c === '.'
  // skip to word n
  let i = 0
  let word = 1
  while (word < n && i < source.length) {
    while (i < source.length && !sep(source[i]!)) i++
    if (i >= source.length) return notfound
    // a comma or full stop swallows one following space with it
    if (source[i] !== ' ' && source[i + 1] === ' ') i++
    i++
    word++
  }
  let end = i
  while (end < source.length && !sep(source[end]!)) end++
  const got = source.slice(i, end)
  const alts = alternatives.split('|')
  // `alts.length - 1`: only the alternatives a bar follows are reachable
  for (let k = 0; k < alts.length - 1; k++) {
    if (alts[k] !== '' && alts[k] === got) return k + 1
  }
  return notfound
}

/**
 * The header word `X Icon`, `Y Icon` and `Planes Icon` want, and the three
 * errors they raise on the way to it.
 *
 * Routines 87-89 walk the bank list themselves rather than asking AMOS, and
 * they look for type 2 — the icon bank, unconditionally. That is worth
 * saying out loud because `Icon Check` next door reads its bank number out of
 * the Scene Icon Bank setting instead, so the two disagree about which bank
 * "the icons" means.
 */
function iconField(rt: Runtime, n: number, pick: (img: BankImage) => number): number {
  if (n <= 0) funcCall() // Rble routine 62
  const bank = rt.iconBank
  if (!bank) throw new AmosError('Bank not reserved', 36) // Rbeq routine 130 -> $24
  const img = bank.image(n)
  if (!img) throw new AmosError('Icon not defined', 74) // Rbhi/Rbeq routine 131 -> $4a
  return pick(img)
}

/** `Hzone`'s mapping: hardware coordinates into the current screen */
function hardZoneAt(rt: Runtime, x: number, y: number): number {
  const s = rt.screen
  return rt.zoneAt(s.hardToScreenX(x), s.hardToScreenY(y))
}

// ---- bitplanes and blocks ----

/** the six-long offset table `Plane Offset` keeps for a screen */
function planeTable(rt: Runtime, nr: number): Int32Array {
  let t = rt.turbo.planeOffsets.get(nr)
  if (!t) {
    t = new Int32Array(6)
    rt.turbo.planeOffsets.set(nr, t)
  }
  return t
}

/** the checks Plane Swap and the two Plane Shifts share */
function screenForPlanes(rt: Runtime, nr: number, planes: number[]): Screen {
  const s = rt.screens.get(nr)
  if (!s) funcCall()
  // a one-plane screen has nothing to rearrange, and says so
  if (s.depth === 1) funcCall()
  for (const p of planes) if (p <= 0 || p > s.depth) funcCall()
  return s
}

function shiftArgs(rt: Runtime, it: Interp): { s: Screen; from: number; to: number } {
  const nr = it.evalInt()
  it.expect(',')
  const from = it.evalInt()
  it.expect('to')
  const to = it.evalInt()
  // `cmp.w d6,d7 / Rble routine 62` in routines 79 and 80: the range has to
  // be at least two planes wide. Shifting one plane onto itself is an error,
  // not a no-op, which is where this port used to differ.
  if (to <= from) funcCall()
  return { s: screenForPlanes(rt, nr, [from, to]), from: from - 1, to: to - 1 }
}

/**
 * Rearranging plane pointers, in a buffer that has no pointers.
 *
 * Swapping two of a screen's plane pointers means each plane now reads and
 * writes the other's memory, so every pixel's two bits change places — and
 * they change places for the physical buffer too, because the routine
 * rewrites all three of the structure's pointer tables.
 *
 * `src(p)` gives the plane whose old bit ends up in plane p.
 */
function permutePlanes(s: Screen, src: (p: number) => number): void {
  const from = Array.from({ length: s.depth }, (_, p) => src(p))
  for (const buf of [s.pixels, s.back]) {
    if (!buf) continue
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]!
      let out = v
      for (let p = 0; p < from.length; p++) {
        const bit = (v >> from[p]!) & 1
        out = (out & ~(1 << p)) | (bit << p)
      }
      buf[i] = out
    }
  }
}

/**
 * The five F icon keywords. They differ in what they refuse to do rather
 * than in what they draw: the width-specialised ones skip the 16-pixel chop
 * ("I've disgarded all testing for best speed possible!"), and the two
 * processor ones draw through the CPU instead of the blitter, which costs
 * them the mask. There is no blitter here and no CPU to be faster than it,
 * so what is left is the chopping and the masking.
 */
function fIcon(rt: Runtime, it: Interp, chop: 'none' | 'x' | 'xy', opts: { bounded?: boolean; noMask?: boolean } = {}): void {
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect(',')
  const n = it.evalInt()
  const s = rt.screen
  // every one of the five opens `Rble routine 62` on the icon number and
  // walks the bank list itself, routine 130 when there is no icon bank
  if (n <= 0) funcCall()
  const bank = rt.iconBank
  if (!bank) throw new AmosError('Bank not reserved', 36)
  const img = bank.image(n)
  // and only F Paste Icon then bounds it — `cmp.w (a2),d1 / Rbhi routine 131`
  // and a null slot test the four width-specialised routines simply do not
  // make, reading whatever the table holds instead
  if (!img) {
    if (opts.bounded) throw new AmosError('Icon not defined', 74)
    return
  }
  const px = chop === 'none' ? x : x & 0xfff0
  const py = chop === 'xy' ? y & 0xfff0 : y
  // "If X < 0 no Icon is displayed... If X > width of screen, no Icon is
  // displayed" — true of F Paste Icon and of the two processor ones, which
  // test the coordinate and branch straight out. F 16 Icon and F 32 Icon do
  // not: they subtract the overlap off the icon's own height and width and
  // draw what is left, which is the near-edge clipping the others lack.
  if (chop !== 'none' && (px < 0 || py < 0)) return
  if (px >= s.width || py >= s.height) return
  rt.blit(s, img, px, py, opts.noMask || img.opaque)
}

/** `F Put Block` and `F Put Static Block`, which differ only in the lookup */
function fPutBlock(rt: Runtime, it: Interp, viaStatic: boolean): void {
  const n = it.evalInt()
  it.expect(',')
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  const s = rt.screen
  const b = rt.blocks.get(n)
  // The static table is not cleared when it is allocated, so a block that
  // was not in AMOS's list when Build Static Block ran is an uninitialised
  // pointer — a crash there, nothing here.
  if (!b || (viaStatic && !rt.turbo.staticBlocks?.built.has(n))) return
  // "If X < 0 no Block is displayed... If X > width of screen, no Block is
  // displayed", and the X is chopped to a 16-pixel boundary
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
  rt.blit(s, { width: b.w, height: b.h, pixels: b.pixels }, x & 0xfff0, y, !b.mask)
}

// ---- scrolling zones: Blit Store Left / Up, Multi Blit and the interrupt ----

/**
 * Read the arguments both the stored and the immediate scroll keywords take,
 * apply the routine's checks, and work out the region.
 *
 * The checks, in the order routine 325 makes them: the shift may not be zero;
 * y1 may not exceed the screen height; x and x1 are chopped to a 16-pixel
 * boundary ("Ex.: 198 will become 196 , 307 will become 304"); y and x may
 * not be negative; x must be below x1 and y below y1; and x1 is clamped to
 * the width of the bitplane, which is rowBytes*8 rather than the screen
 * width.
 */
function blitArgs(rt: Runtime, it: Interp, screen: number, vertical: boolean): BlitDef {
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect('to')
  const x1raw = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect(',')
  const shift = it.evalInt()
  const s = rt.screens.get(screen)
  if (!s) throw new AmosError('Illegal function call', 23)
  if (vertical ? shift === 0 : (shift & 0xf) === 0) funcCall()
  if (y1 > s.height) funcCall()
  const x0 = x & 0xfff0
  let x1 = x1raw & 0xfff0
  if (y < 0 || x < 0) funcCall()
  if (x0 >= x1 || y >= y1) funcCall()
  const wide = s.rowBytes * 8
  if (x1 > wide) x1 = wide
  // Blit Store Up: "Y = Y + SCROLL : If Y < 0 then Y = 0 Else if Y > Screen
  // Height then Y = Screen Height" — the manual writes the clamp out in
  // BASIC, which is why a shift of -50 from y=5 only scrolls five pixels
  const dest = vertical ? Math.max(0, Math.min(s.height, y + shift)) : y
  return {
    screen,
    x0,
    y0: y,
    x1,
    y1,
    // BLTCON0 carries the barrel shift for both kinds; a vertical store
    // leaves it at zero, so the copy is straight down until Blit Speed
    // writes a shift into it
    shift: vertical ? 0 : Math.abs(shift) & 0xf,
    left: !vertical && shift < 0,
    vertical,
    dy: dest - y,
    // moveq #$ff,d6 then lsl.l for a right scroll, lsr.l and swap for a left
    // one; Blit Store Up leaves it at $ff
    masks: vertical ? 0xff : shift < 0 ? (0xff >>> (-shift & 0xf)) << 16 : (0xff << (shift & 0xf)) >>> 0,
  }
}

/**
 * Run one zone. A horizontal scroll is a barrel-shift of the region through
 * the A channel back into D — "TURBO Blit uses the A and D blitter channels,
 * AMOS Scroll uses the B,C and D channels" — which is why the pixels shifted
 * out of one row appear at the start of the next: the shifter carries across
 * the modulo. A vertical scroll is a plain copy to the clamped row.
 *
 * The plane mask is the RastPort's, read from the CURRENT screen rather than
 * the one being scrolled, exactly as `btst.l d0,$18(a4)` reads it.
 */
function runBlit(rt: Runtime, d: BlitDef): void {
  const s = rt.screens.get(d.screen)
  if (!s) return // "a crash will be certain" — nothing here
  const mask = rt.screen.planeMask
  const px = s.pixelsW()
  const sw = s.width
  const w0 = Math.min(d.x1, sw) - d.x0
  const h = Math.min(d.y1, s.height) - d.y0
  if (w0 <= 0 || h <= 0) return
  for (let p = 0; p < s.depth; p++) {
    if (!(mask & (1 << p))) continue
    const bit = 1 << p
    // channel A: the region as one stream, rows joined end to end, which is
    // what the modulo does and why the shifter carries between them
    const src = new Uint8Array(w0 * h)
    for (let r = 0; r < h; r++) {
      const row = (d.y0 + r) * sw + d.x0
      for (let c = 0; c < w0; c++) src[r * w0 + c] = (px[row + c]! >> p) & 1
    }
    // channel D: the same region, moved down by dy for a vertical scroll
    for (let i = 0; i < src.length; i++) {
      const j = d.left ? i + d.shift : i - d.shift
      const v = j >= 0 && j < src.length ? src[j]! : 0
      const y = d.y0 + d.dy + ((i / w0) | 0)
      if (y < 0 || y >= s.height) continue // off the screen: the real one writes anyway
      const at = y * sw + d.x0 + (i % w0)
      px[at] = (px[at]! & ~bit) | (v << p)
    }
  }
}

/** `Multi Blit`, `Blit Int On` and `Blit Int Change` all take this range */
function blitRange(it: Interp): { from: number; to: number } {
  // the same eight instructions open Multi Blit (44, $15cc), Blit Int On's
  // worker (317, $61f6) and Blit Int Change (141, $4846): `cmp.w d6,d7 /
  // Rblt` for an inverted range, `subq.w #$1,d6 / Rbmi` for a start below
  // one, and `subq.w #$1,d7 / cmp.w #$60,d7 / Rbcc` for an end past 96
  const from = it.evalInt()
  it.expect('to')
  const to = it.evalInt()
  if (to < from || from - 1 < 0 || to - 1 >= 96) funcCall()
  return { from: from - 1, to: to - 1 }
}

/** define a zone, or refuse because one is already there */
function blitStore(rt: Runtime, it: Interp, vertical: boolean): void {
  // the routine reads blitnr and screen off the argument stack before it
  // pops anything, so "1 to 96" and "allready defined" are checked first
  const screen = it.evalInt()
  it.expect(',')
  const nr = it.evalInt()
  it.expect(',')
  if (nr <= 0 || nr > 96) funcCall()
  if (rt.turbo.blits[nr - 1]) turboError(11)
  rt.turbo.blits[nr - 1] = blitArgs(rt, it, screen, vertical)
}

/**
 * The VBL server `Blit Int On` installs, at priority 9. It does what Multi
 * Blit does over the stored range, once a frame, but only once `Blit Int
 * Wait False` has cleared the wait.
 */
export function blitVbl(rt: Runtime): void {
  const t = rt.turbo
  if (!t.blitInt || t.blitGo === 0) return
  for (let i = t.blitInt.from; i <= t.blitInt.to; i++) {
    const d = t.blits[i]
    if (d) runBlit(rt, d)
  }
}

/** `Stars Draw` in 2.15, `F Stars` in 1.9 — routine 57, plot without moving */
function starsDraw(rt: Runtime): void {
  const st = starfield(rt)
  const plot = starsPlotter(rt, rt.currentIndex)
  for (let i = 0; i < st.count; i++) plot(st.data[i * 4]!, st.data[i * 4 + 1]!)
}

/**
 * The VBL server `Stars Int On` installs, run once a frame from the
 * runtime's own vertical blank. It draws on the screen the stars were
 * reserved on — the routine keeps that address at +$210 and the manual is
 * blunt about the consequence: "Allways be sure that the SCREEN where you
 * have reserved the 'STARS' remains open when the 'STARS INTERRUPT' is on.
 * Otherwise a crash will be certain".
 */
export function starsVbl(rt: Runtime): void {
  const st = rt.turbo.stars
  if (!st.int || st.count === 0) return
  const s = rt.screens.get(st.screen)
  if (!s) return // the screen is closed: on the Amiga, the crash
  if (st.intClear) {
    // the blitter clears the first bitplane and only that one
    const px = s.pixelsW()
    for (let i = 0; i < px.length; i++) px[i]! &= ~1
  }
  starsStep(st, 0, st.count - 1, starsPlotter(rt, st.screen), true)
}

/** the stars, checked as the drawing keywords check them */
function starfield(rt: Runtime): TurboStars {
  // Display Stars and Stars Draw both go through `Rbeq routine 62` on a zero
  // count — an illegal function call, not "Stars not reserved"
  if (rt.turbo.stars.count === 0) funcCall()
  return rt.turbo.stars
}

// ---- scenes: the icon tile-map engine ----

/**
 * A scene bank, whose layout the manual gives outright because by 2.15 "the
 * docs are now only diskbased":
 *
 *     Start+0  WORD X_WIDTH
 *     Start+2  WORD Y_HEIGHT
 *     Start+4,6,8,...  WORD ICONIMAGE_TO_DISPLAY-1   (width*height of them)
 *
 * V1.0 stored the tiles as bytes, "limiting the maximum amount of different
 * Icons of a Scene to 256"; 2.15 widened them to words and left `Scene
 * Convert` behind to bring the old banks forward. This port implements 2.15
 * throughout, as every other TURBO phase does.
 */
function sceneData(rt: Runtime): Uint8Array {
  const n = rt.turbo.scene.bank
  const b = n === 0 ? undefined : rt.memBanks.get(n)
  // The library holds a pointer, not a number, so an erased bank leaves it
  // dangling and the next draw reads freed memory. Holding the number means
  // that case reports "Scene Bank not defined" instead.
  if (!b) turboError(22)
  return b.data
}

const sceneW = (d: Uint8Array): number => ((d[0]! << 8) | d[1]!) & 0xffff
const sceneH = (d: Uint8Array): number => ((d[2]! << 8) | d[3]!) & 0xffff

/** tile at a word offset from the start of the bank, header included */
function tileAt(d: Uint8Array, off: number): number {
  return off + 1 < d.length ? ((d[off]! << 8) | d[off + 1]!) & 0xffff : 0
}

function setTileAt(d: Uint8Array, off: number, v: number): void {
  if (off + 1 >= d.length) return
  d[off] = (v >> 8) & 0xff
  d[off + 1] = v & 0xff
}

/**
 * The icon bank the Scene commands draw from. Two of them check the bank's
 * four-character type: 'Icon' or 'Spri' passes, anything else is "Only
 * Sprite or Icon banks can be used", and a bank that is not there at all is
 * AMOS's own "bank not reserved" — the two errors the manual's "Icon/Bob
 * banks are legal, but any other type of bank gives an illegal function
 * call" runs together.
 */
function sceneIcons(rt: Runtime, n: number): ObjectBank {
  const b = n === 1 ? rt.spriteBank : n === 2 ? rt.iconBank : null
  if (b) return b
  if (n === 1 || n === 2 || !rt.memBanks.get(n)) throw new AmosError('bank not reserved', 36)
  // a numbered memory bank is reserved but is not one of the two object
  // banks this port keeps typed, so it can only fail the cookie test
  turboError(26)
}

/**
 * Paste one tile. `off` is a byte offset into a bitplane, which is the unit
 * the library works in throughout: it loads the screen's plane pointers and
 * adds a single offset built from `x>>3` and `y*rowBytes`. Splitting it back
 * into a pixel position is what makes the `Scene View` regression visible
 * rather than merely arithmetic.
 *
 * "AMOS does not let you use icon 0 so you must add 1 to get the correct
 * icon number" — the tile stored is the image number minus one.
 */
function pasteTile(rt: Runtime, s: Screen, off: number, tile: number, icons: ObjectBank): void {
  const img = icons.image((tile + 1) & 0xffff)
  if (!img) return
  rt.blit(s, img, (off % s.rowBytes) * 8, Math.floor(off / s.rowBytes), img.opaque)
}

/** the six arguments `Scene 16/32 Draw` and the tail of `Scene 16 Def` share */
interface DrawArgs {
  sx: number
  sy: number
  xamt: number
  yamt: number
  xdest: number
  ydest: number
}

function drawArgs(it: Interp): DrawArgs {
  const sx = it.evalInt()
  it.expect(',')
  const sy = it.evalInt()
  it.expect(',')
  const xamt = it.evalInt()
  it.expect(',')
  const yamt = it.evalInt()
  it.expect(',')
  const xdest = it.evalInt()
  it.expect(',')
  const ydest = it.evalInt()
  return { sx, sy, xamt, yamt, xdest, ydest }
}

/**
 * The clipping `Scene 16/32 Draw` and `Scene 16 Def` both do, in the order
 * the routine does it — the arguments are popped last-first, so `yscreen` is
 * refused before `xscreen` and the scene coordinates are checked last of all.
 *
 * Two details of the 32 version are not what the manual says. "XSCREEN and
 * YSCREEN are chopped to lie on a 16/32 bit boundary": only XSCREEN is
 * chopped, and `Scene 32 Draw` chops it with the same `andi.w #$fff0` the 16
 * version uses, so a 32-pixel scene can start on a 16-pixel boundary.
 */
function sceneClip(a: DrawArgs, s: Screen, d: Uint8Array, big: boolean): {
  xb: number
  yoff: number
  cols: number
  rows: number
} {
  if (a.ydest < 0 || a.xdest < 0) funcCall()
  const xdest = a.xdest & 0xfff0
  if (a.ydest >= s.height) funcCall()
  const xb = xdest >> 3
  if (xb >= s.rowBytes) funcCall()
  // the columns left in the bitplane row: 2 bytes a tile at 16, 4 at 32
  const fit = (s.rowBytes - xb) >> (big ? 2 : 1)
  if (a.yamt <= 0 || a.xamt <= 0) funcCall()
  let cols = Math.min(a.xamt, fit)
  const down = (s.height - a.ydest) >> (big ? 5 : 4)
  if (down === 0) funcCall()
  let rows = Math.min(a.yamt, down)
  if (a.sy < 0 || a.sx < 0) funcCall()
  cols = Math.min(cols, sceneW(d) - a.sx)
  if (cols <= 0) funcCall()
  rows = Math.min(rows, sceneH(d) - a.sy)
  if (rows <= 0) funcCall()
  return { xb, yoff: a.ydest * s.rowBytes, cols, rows }
}

/** `Scene 16 Draw` / `Scene 32 Draw`, which draw on the current screen */
function sceneDraw(rt: Runtime, it: Interp, big: boolean): void {
  const a = drawArgs(it)
  const d = sceneData(rt)
  const s = rt.screen
  const icons = sceneIcons(rt, rt.turbo.scene.iconBank)
  const { xb, yoff, cols, rows } = sceneClip(a, s, d, big)
  const srb = sceneW(d) * 2
  const step = big ? 4 : 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = tileAt(d, 4 + (a.sy + r) * srb + (a.sx + c) * 2)
      pasteTile(rt, s, xb + c * step + yoff + r * s.rowBytes * (big ? 32 : 16), tile, icons)
    }
  }
}

/**
 * The shared viewport core, routine 121 for the 16 set and 122 for the 32
 * set: `Scene Do`, `Top`, `Bottom`, `Left` and `Right` all reach it with the
 * rectangle already chosen and only the scene coordinates left to pop.
 *
 * ## The wrap
 *
 * Undocumented and the reason the view commands exist: the scene coordinates
 * are folded into the map before drawing (repeated add/subtract of the width
 * or height, so a coordinate a whole map away still terminates), and each
 * tile that runs off the right edge of a row comes back at the left, while
 * one that runs off the end of the map restarts at the top — the row base is
 * zeroed and keeps advancing from there. A scrolling game can therefore let
 * its scene coordinates run without bounding them.
 *
 * ## The regression
 *
 * `yb` is the viewport's y1 in pixels and is used here as a byte offset. In
 * V1.0 `Scene 16 Do` did the multiply itself (`mulu.w d4,d2` against
 * EcTLigne at $5178, saving the product for the core to read); 2.15 moved
 * the arithmetic into `Scene 16/32 View` for speed, converted x1 to bytes
 * with `lsr.w #3`, and left y1 alone. `Scene Draw` and `Scene 16 Def`, which
 * compute their own destination, both still multiply — so the whole
 * viewport family, and only the viewport family, puts its top edge at line
 * `y1 / rowBytes` instead of line `y1`.
 *
 * DEFECT: reproduced rather than corrected, because a program written against
 * the real 2.15 is drawing where this puts it. `Scene 16/32 View scr,x1,0 To
 * x2,y2` is unaffected.
 */
function sceneViewCore(
  rt: Runtime,
  it: Interp,
  big: boolean,
  v: SceneView,
  rect: { cols: number; rows: number; xb: number; yb: number; c0: number; r0: number },
): void {
  const xsc = it.evalInt()
  it.expect(',')
  const ysc = it.evalInt()
  const s = rt.screen
  if (rt.currentIndex !== v.screen) turboError(20)
  const d = sceneData(rt)
  const icons = sceneIcons(rt, rt.turbo.scene.iconBank)
  const width = sceneW(d)
  const height = sceneH(d)
  if (width === 0 || height === 0) return
  let y = rect.r0 + ysc
  while (y < 0) y += height
  while (y >= height) y -= height
  let x = rect.c0 + xsc
  while (x < 0) x += width
  while (x >= width) x -= width
  const srb = width * 2
  const total = srb * height
  const x0 = x * 2
  let base = y * srb
  let dy = rect.yb
  for (let r = 0; r < rect.rows; r++) {
    for (let c = 0; c < rect.cols; c++) {
      let off = x0 + c * 2
      if (off >= srb) off -= srb
      off += base
      if (off >= total) {
        off = 0
        // the row base is reset for good, not just for this tile: the rest
        // of the row and every row after it come from the top of the map
        base = 0
      }
      // the destination advances one tile-width in bytes a column and one
      // tile-height of scanlines a row; the scene advances one word either way
      pasteTile(rt, s, rect.xb + c * (big ? 4 : 2) + dy, tileAt(d, 4 + off), icons)
    }
    dy += s.rowBytes * (big ? 32 : 16)
    base += srb
  }
}

/** the five viewport keywords, which differ only in the rectangle they pick */
function sceneViewEdge(rt: Runtime, it: Interp, big: boolean, edge: '' | 't' | 'b' | 'l' | 'r'): void {
  const v = big ? rt.turbo.scene.view32 : rt.turbo.scene.view16
  if (!v) turboError(20)
  const rect = { cols: v.cols, rows: v.rows, xb: v.xb, yb: v.yb, c0: 0, r0: 0 }
  if (edge === 't') rect.rows = 1
  if (edge === 'b') {
    rect.rows = 1
    rect.yb = v.bottom
    rect.r0 = v.rows - 1
  }
  if (edge === 'l') rect.cols = 1
  if (edge === 'r') {
    rect.cols = 1
    rect.xb = v.right
    rect.c0 = v.cols - 1
  }
  sceneViewCore(rt, it, big, v, rect)
}

/** `Scene 16/32 View scrnr,x1,y1 To x2,y2` */
function sceneView(rt: Runtime, it: Interp, big: boolean): void {
  const nr = it.evalInt()
  it.expect(',')
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  const s = rt.screens.get(nr)
  if (!s) throw new AmosError(`screen not opened: ${nr}`)
  // the pointer check comes before the arguments are popped, so a program
  // with no Scene Bank set gets error 22 whatever else is wrong
  sceneData(rt)
  if (y2 <= 0 || x2 <= 0 || y1 < 0 || x1 < 0) funcCall()
  if (x1 >= x2 || y1 >= y2) funcCall()
  if (x2 > s.width || y2 > s.height) funcCall()
  const shift = big ? 5 : 4
  const cols = (x2 - x1) >> shift
  const rows = (y2 - y1) >> shift
  if (cols === 0 || rows === 0) funcCall()
  const v: SceneView = {
    screen: nr,
    cols,
    rows,
    xb: x1 >> 3,
    yb: y1,
    right: (x2 - (big ? 32 : 16)) >> 3,
    bottom: y2 - (big ? 32 : 16),
  }
  if (big) rt.turbo.scene.view32 = v
  else rt.turbo.scene.view16 = v
}

/** the definition `Scene 16 Restore` replays, with the checks Def makes */
function sceneDef(rt: Runtime, it: Interp): void {
  const nr = it.evalInt()
  it.expect(',')
  const n = it.evalInt()
  it.expect(',')
  const a = drawArgs(it)
  const defs = rt.turbo.scene.defs
  if (n <= 0 || n > defs.length) funcCall()
  const s = rt.screens.get(nr)
  if (!s) throw new AmosError(`screen not opened: ${nr}`)
  const d = sceneData(rt)
  const icons = sceneIcons(rt, rt.turbo.scene.iconBank)
  const { xb, yoff, cols, rows } = sceneClip(a, s, d, false)
  const srb = sceneW(d) * 2
  defs[n - 1] = {
    screen: nr,
    icons,
    scene: d,
    sceneRowBytes: srb,
    sx2: a.sx * 2,
    sceneRowOff: a.sy * srb,
    cols,
    rows,
    destX: xb,
    destY: yoff,
    rowStep: s.rowBytes * 16,
  }
}

/**
 * `Scene 16 Restore nr` — the record replayed. There is no wrap here and no
 * re-clip: everything was decided at Def time, including which banks to draw
 * from, so a Restore is a straight rectangle out of a possibly stale bank.
 */
function sceneRestore(rt: Runtime, it: Interp): void {
  const n = it.evalInt()
  const defs = rt.turbo.scene.defs
  if (n <= 0 || n > defs.length) funcCall()
  const def = defs[n - 1]
  // "Scene Area is not defined" — the record's flag word, still zero
  if (!def) turboError(19)
  const s = rt.screen
  if (rt.currentIndex !== def.screen) turboError(21)
  for (let r = 0; r < def.rows; r++) {
    for (let c = 0; c < def.cols; c++) {
      const tile = tileAt(def.scene, 4 + def.sceneRowOff + r * def.sceneRowBytes + def.sx2 + c * 2)
      pasteTile(rt, s, def.destX + c * 2 + def.destY + r * def.rowStep, tile, def.icons)
    }
  }
}

/**
 * The bounds `Scene Check`, `Scene Change` and their screen-coordinate
 * cousins share. `cmp.w`/`Rbhi` is a strictly-greater test, so a coordinate
 * *equal* to the width or height passes and indexes one tile beyond the row
 * or the map — on the Amiga that reads whatever follows the bank, here it
 * reads zero past the end of the array.
 */
function sceneIndex(d: Uint8Array, x: number, y: number): number {
  if (x < 0 || y < 0) funcCall()
  if ((x & 0xffff) > sceneW(d) || (y & 0xffff) > sceneH(d)) funcCall()
  return 4 + ((y & 0xffff) * sceneW(d) + (x & 0xffff)) * 2
}

/**
 * `Scene 16/32 Check(x,y)` — "Returns Icon number is in the scene according
 * to the X and Y screen coordinates". The conversion is a bare shift by 4 or
 * 5 with no viewport offset applied, so it answers for the screen only while
 * the view starts at 0,0.
 */
function sceneCheckScreen(rt: Runtime, a: Value[], shift: number): number {
  const x = int(a[0] ?? VI(0))
  const y = int(a[1] ?? VI(0))
  if (x < 0 || y < 0) funcCall()
  const d = sceneData(rt)
  return tileAt(d, sceneIndex(d, (x & 0xffff) >>> shift, (y & 0xffff) >>> shift))
}

/** the four bulk operations, which share their clipping */
function sceneRegion(
  d: Uint8Array,
  x: number,
  y: number,
  aw: number,
  ah: number,
): { off: number; cols: number; rows: number } {
  if (x < 0 || y < 0) funcCall()
  const left = sceneW(d) - x
  if (left <= 0) funcCall()
  const down = sceneH(d) - y
  if (down <= 0) funcCall()
  return { off: 4 + (y * sceneW(d) + x) * 2, cols: Math.min(aw, left), rows: Math.min(ah, down) }
}

/**
 * `Scene Scan X/Y(x,y,step,value)`, undocumented in either manual. Walks the
 * scene from x,y in steps of `step` tiles and returns how many steps it took
 * to reach `value`, or -1 if it left the map first — a step of zero is an
 * illegal function call, and a negative step walks backwards.
 *
 * `Scene Scan X` treats a negative value as "scan until the tile is *not*
 * this" (`neg.l d5` then a `beq` loop at $4c30). `Scene Scan Y` has the same
 * branch but closes it with `bne`, so its negative form searches for the
 * positive value and behaves exactly like the positive form. Its mode test
 * is on d3 rather than d5 as well — a register that happens to hold the last
 * argument evaluated, which is the value, so that half of the slip is
 * invisible.
 */
function sceneScan(rt: Runtime, a: Value[], vertical: boolean): number {
  const [x, y, step, value] = [0, 1, 2, 3].map((i) => int(a[i] ?? VI(0))) as [number, number, number, number]
  const d = sceneData(rt)
  if (step === 0) funcCall()
  if (x < 0 || y < 0) funcCall()
  const width = sceneW(d)
  const height = sceneH(d)
  if ((x & 0xffff) > width) funcCall()
  if ((y & 0xffff) > height) funcCall()
  const inverse = vertical ? false : value < 0
  const want = value < 0 ? -value : value
  let n = 0
  let i = vertical ? y : x
  const limit = vertical ? height : width
  for (;;) {
    if (i < 0 || i >= limit) return -1
    const tile = vertical ? tileAt(d, 4 + (i * width + x) * 2) : tileAt(d, 4 + (y * width + i) * 2)
    if (inverse ? tile !== want : tile === want) return n
    i += step
    n++
  }
}

export function makeTurboInstructions(rt: Runtime): Record<string, Instr> {
  return {
    'multi yes'() {
      // "Sets the priority to normal (0). Normal multitasking takes place."
      // Routine 2 ($f52) is SetTaskPri(FindTask(NULL), 0) and nothing else.
      rt.turbo.priority = 0
    },
    'multi no'() {
      // Routine 3 ($f6a) is the same twenty-four bytes with `moveq #$14,d0` —
      // exec FindTask (-$126) then SetTaskPri (-$12c) — which is what the
      // manual describes: "Under AMOS Pro, Multi No sets the priority of AMOS
      // Pro to 20, blocking most tasks, but not blocking the VITAL task."
      rt.turbo.priority = 20
    },
    'amos pri'(it) {
      // "Set the priority of AMOS. Value ranges from -128 to 20". Routine 125
      // ($4600) tests both bounds and branches to its own `rts` when either
      // fails, so a value outside the range is IGNORED rather than clamped
      // and rather than raising anything.
      const p = it.evalInt()
      if (p < -128 || p > 20) return
      rt.turbo.priority = p
    },
    'workbench open'() {
      // Routine 138 ($47fc) is fourteen bytes: `jsr -$d2(a6)` on the
      // intuition base AMOS keeps at -$18a6(a5), which is OpenWorkBench. The
      // counterpart to AMOS's Close Workbench, which this port already treats
      // as faithful because there is no Workbench memory to free. Reopening
      // it is the same nothing in reverse.
    },
    'vbl wait'(it) {
      // Vbl Wait x — "Wait until the raster beam has reached a given value".
      // Routine 13 ($fe6) is a four-instruction busy-wait on the low byte of
      // VHPOSR: move.b $dff006,d1 / cmp.b d0,d1 / bne. Sub-frame beam racing
      // has no meaning against a compositor that draws once per frame, so
      // this waits a frame like Wait Vbl does; see the NOTES entry.
      const line = it.evalInt()
      void line
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },
    'object limit'(it) {
      // Object Limit X — routine 315 ($60e6). "You MUST set the limit before
      // you can reserve and define the objects. When X is set to zero, the
      // OBJECT structure is erased from memory."
      const t = rt.turbo.objects
      const n = it.evalInt()
      if (n < 0) funcCall()
      if (n > 32000) turboError(16) // cmp.l #$7d00 — "You can define upto 32.000 objects"
      if (n === 0) {
        if (t.limit === 0) turboError(15)
        // it walks the pointer array first and refuses while anything is
        // still allocated, rather than leaking it
        if (t.els.some((p) => p !== null)) turboError(17)
        t.limit = 0
        t.els = []
        t.counts = []
        return
      }
      if (t.limit !== 0) turboError(14)
      t.limit = n
      t.els = Array.from({ length: n }, () => null)
      t.counts = Array.from({ length: n }, () => 0)
    },
    'reserve object'(it) {
      // routine 28 ($124c), a six-byte trampoline into routine 333
      reserveObject(rt, it)
    },
    'reserve object chip'(it) {
      // 1.9 splits the keyword in two by memory type — MEMF_CHIP ($10002)
      // against MEMF_FAST ($10004) in otherwise identical routines 28 and
      // 29, sharing one object table. There is no chip/fast distinction
      // here, so both are the same handler; see the NOTES entry.
      reserveObject(rt, it)
    },
    'reserve object fast'(it) {
      // 1.9's routine 29, MEMF_FAST where 28 asks for MEMF_CHIP; same worker
      reserveObject(rt, it)
    },
    'define draw'(it) {
      // Define Draw OBJECT,ELEMENT To X,Y — routine 332. "In opposite to
      // older versions, negative coordinates are now allowed!"
      const [obj, el, x, y] = defineArgs(it)
      const { p, at } = defineAt(rt, obj, el, 4)
      p[at] = 0
      p[at + 1] = x
      p[at + 2] = y
    },
    'define move'(it) {
      // routine 331: the same shape, with -1 as the element type
      const [obj, el, x, y] = defineArgs(it)
      const { p, at } = defineAt(rt, obj, el, 5)
      p[at] = -1
      p[at + 1] = x
      p[at + 2] = y
    },
    'define attr'(it) {
      // Define Attr OBJECT,ELEMENT To COLOUR,DRAWMODE — routine 329, element
      // type 2. "Now you can change the Colour and the Drawing-mode in an
      // Object definition."
      const [obj, el, colour, mode] = defineArgs(it)
      const { p, at } = defineAt(rt, obj, el, 6)
      p[at] = 2
      p[at + 1] = colour
      p[at + 2] = mode
    },
    'define stop'(it) {
      // routine 330 writes the type word and nothing else, leaving whatever
      // coordinates the element held
      const obj = it.evalInt()
      it.expect(',')
      const el = it.evalInt()
      const { p, at } = defineAt(rt, obj, el, 5)
      p[at] = 1
    },
    'object draw'(it) {
      // Object Draw OBJECT — routine 34, the vector list walked as it stands
      objectWalk(rt, it.evalInt(), (x, y) => [x, y])
    },
    'r object draw'(it) {
      // R Object Draw OBJECT,X,Y — routine 35: add.w, so the sum wraps as a
      // word before it reaches the RastPort
      const n = it.evalInt()
      it.expect(',')
      const ox = it.evalInt()
      it.expect(',')
      const oy = it.evalInt()
      objectWalk(rt, n, (x, y) => [w(x + ox), w(y + oy)])
    },
    'object mag draw'(it) {
      // Object Mag Draw OBJECT,MUL — routine 36. muls.w when MUL is
      // positive; a negative MUL is negated and divides (divs.w), which is
      // how the manual's "divided by factor MUL" is implemented. MUL of 0
      // takes the multiply path and collapses the object onto the origin.
      const n = it.evalInt()
      it.expect(',')
      const mul = w(it.evalInt())
      objectWalk(rt, n, (x, y) => (mul < 0 ? [w(divsw(x, -mul)), w(divsw(y, -mul))] : [w(x * mul), w(y * mul)]))
    },
    'r object mag draw'(it) {
      // R Object Mag Draw OBJECT,X,Y,MUL — routine 37 scales first and adds
      // the offset second (muls.w then add.w)
      const n = it.evalInt()
      it.expect(',')
      const ox = it.evalInt()
      it.expect(',')
      const oy = it.evalInt()
      it.expect(',')
      const mul = w(it.evalInt())
      const scale = (v: number): number => (mul < 0 ? divsw(v, -mul) : v * mul)
      objectWalk(rt, n, (x, y) => [w(scale(x) + ox), w(scale(y) + oy)])
    },
    'object erase'(it) {
      // Object Erase OBJECT — routine 328. "If OBJECT is negative, ALL
      // object definitions are erased!" — and that path reports nothing,
      // even with no objects defined at all.
      const t = rt.turbo.objects
      const n = it.evalInt()
      if (n < 0) {
        t.els = t.els.map(() => null)
        return
      }
      if (n > 32000) funcCall()
      if (n > t.limit) turboError(18)
      if (n < 1) funcCall()
      if (!t.els[n - 1]) turboError(3)
      t.els[n - 1] = null
    },
    'object save'(it) {
      // Object Save "NAME",START To END — routine 327
      const name = objectFileName(it)
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      const t = rt.turbo.objects
      const parts: number[] = [...'OBJE'].map((c) => c.charCodeAt(0))
      // the header's count is END-START, one less than the number of objects
      parts.push((w(end - start) >> 8) & 0xff, w(end - start) & 0xff)
      for (let i = start - 1; i <= end - 1; i++) {
        const p = t.els[i]
        // "If an object is not defined, it will skip to the next object
        // until END is reached" — and the header count is not adjusted, so
        // a gap leaves a file Object Load will read short
        if (!p) continue
        const count = t.counts[i] ?? 0
        parts.push((count >> 8) & 0xff, count & 0xff)
        for (let k = 0; k < count * 3; k++) parts.push((p[k]! >> 8) & 0xff, p[k]! & 0xff)
      }
      // Open failing is silent in the original: it branches straight to the
      // close-and-return tail without an error
      rt.vfs?.writeFile(name, Uint8Array.from(parts))
    },
    'object load'(it) {
      // routine 40 ($1558), a six-byte trampoline into routine 326
      objectLoad(rt, it)
    },
    'object load chip'(it) {
      // 1.9's name for routine 40, the same routine
      objectLoad(rt, it)
    },
    'reserve stars'(it) {
      // Reserve Stars COUNT — routine 323 ($65c8). "At this point you can
      // reserve memory for 4000 'STARS'": cmp.w #$fa1 and out.
      const st = rt.turbo.stars
      const n = it.evalInt()
      if (n <= 0 || n >= 4001) funcCall()
      if (st.count !== 0) turboError(8)
      st.count = n
      st.data = new Int16Array(n * 4)
      // the row table, and the clip rectangle, both come from the screen
      // this ran on — which is why the manual insists you display them there
      st.screen = rt.currentIndex
      const s = rt.screen
      st.clip = { x1: 0, y1: 0, x2: s.width - 1, y2: s.height - 1 }
    },
    'define star'(it) {
      // Define Star NR,X,Y,X SPEED,Y SPEED — routine 322, four words stored
      // with one movem. Negative coordinates are refused; negative speeds
      // are not, which is how "your 'STARS' can fly in any direction".
      const st = rt.turbo.stars
      const nr = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      if (nr <= 0 || y < 0 || x < 0) funcCall()
      if (st.count === 0) turboError(9)
      if (nr - 1 >= st.count) funcCall()
      st.data.set([x, y, dx, dy], (nr - 1) * 4)
    },
    'display stars'() {
      // Routine 54 ($1a70): "Displays the 'STARS' onto the screen and computes
      // the next position". `move.w $1fc(a2),d7 / Rbeq routine 62` first, so
      // no stars reserved is an illegal function call rather than TURBO's own
      // "Stars not reserved"
      const st = starfield(rt)
      starsStep(st, 0, st.count - 1, starsPlotter(rt, rt.currentIndex))
    },
    'stars draw'() {
      // Routine 57 ($1b98), the same `Rbeq routine 62` guard and then one
      // `bset.b` per star into the FIRST plane only — which is why the stars
      // are always colour 1 and no keyword offers to change it
      starsDraw(rt)
    },
    'f stars'() {
      // 1.9's name for routine 57. "Displays the 'STARS' onto the screen
      // without computing the next 'STAR' position. So your 'STARS' can be
      // freezed without changing the SPEED of them!"
      starsDraw(rt)
    },
    'stars compute'(it) {
      // Stars Compute START To END — routine 56, the same walk with no plot
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      const st = rt.turbo.stars
      if (to === 0 || to - 1 >= st.count) funcCall()
      if (from === 0) funcCall()
      // the loop runs at least once whatever START and END are, and START is
      // never checked against the count — past the end it would read on into
      // whatever follows the allocation
      starsStep(st, from - 1, Math.max(from - 1, to - 1), null)
    },
    'stars speed'(it) {
      // Stars Speed START To END,X SPEED,Y SPEED — routine 58. END must be
      // strictly greater than START (`cmp.w d1,d2 : Rble`), so a range of
      // one star is an illegal function call.
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      const st = rt.turbo.stars
      if (from === 0 || to <= from || to - 1 >= st.count) funcCall()
      for (let i = from - 1; i <= to - 1; i++) {
        st.data[i * 4 + 2] = dx
        st.data[i * 4 + 3] = dy
      }
    },
    'stars clip'(it) {
      // Stars Clip X,Y,X1,Y1 — routine 320. The right and bottom edges are
      // clamped to the screen rather than refused; the left and top are
      // refused. The width it compares against is the bitplane's, rowBytes*8,
      // which is the screen width rounded up to a word.
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      if (y < 0 || x < 0 || x2 <= x || y2 <= y) funcCall()
      const s = rt.screen
      const wide = s.rowBytes * 8
      if (x >= wide || y >= s.height) funcCall()
      rt.turbo.stars.clip = {
        x1: x,
        y1: y,
        x2: x2 >= wide ? wide - 1 : x2,
        y2: y2 >= s.height ? s.height - 1 : y2,
      }
    },
    'stars erase'() {
      // routine 321 frees both allocations and zeroes the count. With
      // nothing reserved it returns without a word.
      const st = rt.turbo.stars
      if (st.count === 0) return
      st.count = 0
      st.data = new Int16Array(0)
    },
    'stars int on'(it) {
      // Stars Int On CLEAR — routine 319 builds an Interrupt of priority -40
      // and AddIntServer()s it on INTB_VERTB. "If CLEAR <> 0 the display will
      // be cleared before displaying the 'STARS'."
      const st = rt.turbo.stars
      if (st.count === 0) turboError(9)
      if (st.int) turboError(10)
      st.int = true
      // the CLEAR argument is read after the checks, and only ever sets the
      // flag — Stars Int On 0 leaves an earlier setting alone, but there
      // cannot be one, because the flag is cleared by Stars Int Off
      if (it.evalInt() !== 0) st.intClear = true
    },
    'stars int off'() {
      // routine 318: RemIntServer and free, silent when it is not on
      const st = rt.turbo.stars
      if (!st.int) return
      st.intClear = false
      st.int = false
    },
    'r move'(it) {
      // "Does the same thing as: Gr Locate Xgr+dx,Ygr+dy but is shorter and
      // faster" — routine 23 ($1192) is eighteen bytes: two `add.w` straight
      // into rp_cp_x/rp_cp_y at $24/$26 of the RastPort
      const s = rt.screen
      const dx = it.evalInt()
      it.expect(',')
      s.grX = w(s.grX + dx)
      s.grY = w(s.grY + it.evalInt())
    },
    'r home'(it) {
      // Undocumented, and not relative at all: routine 26 ($1210) writes both
      // words of the graphics cursor, so it is Gr Locate under another name
      const s = rt.screen
      s.grX = w(it.evalInt())
      it.expect(',')
      s.grY = w(it.evalInt())
    },
    'r draw'(it) {
      // "draw a line relative to the graphics cursor... At the completion of
      // the command, the graphics cursor will be located at the end" —
      // routine 24 ($11a4) adds the pair to rp_cp and calls graphics.library
      // Draw (`jsr -$f6(a6)`), which is what leaves the cursor there
      const s = rt.screen
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      s.line(s.grX, s.grY, w(s.grX + dx), w(s.grY + dy))
    },
    'r box'(it) {
      // Routine 25 ($11c6): four Draws round the rectangle — right, down,
      // left, up — ending back where it started, which is why "the position
      // of the graphics cursor remains unchanged". Unlike R Bar below it does
      // not check either delta, so a negative one simply draws backwards
      const s = rt.screen
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      const x = s.grX
      const y = s.grY
      s.line(x, y, w(x + dx), y)
      s.line(w(x + dx), y, w(x + dx), w(y + dy))
      s.line(w(x + dx), w(y + dy), x, w(y + dy))
      s.line(x, w(y + dy), x, y)
    },
    'r bar'(it) {
      // Routine 27 ($1222): RectFill (`jsr -$132(a6)`) from the cursor to the
      // cursor plus the pair, which does not move it. Both deltas are checked
      // — `Rbmi` on each, the height first — so a negative one is an error
      // where R Box next door takes it happily.
      const s = rt.screen
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      if (dx < 0 || dy < 0) funcCall()
      const x = s.grX
      const y = s.grY
      s.bar(x, y, w(x + dx), w(y + dy))
      s.grX = x
      s.grY = y
    },
    'f draw'(it) {
      // F Draw x,y To x1,y1 — the token spec is I0,0t0,0 in every build, so
      // the manual's shorter "F Draw X,Y" form does not exist; see NOTES.
      // Routine 70 ($1f5a) pops the four and drops into routine 75 ($1fca),
      // the blitter line: it opens `movem.w d2-d3,$24(a1)`, so the graphics
      // cursor ends at the FAR end, clips both endpoints against the screen's
      // clip window at $ee, and drives the planes from rp_FgPen at $19(a1)
      // rather than through rp_Mask — which is what rawDraw stands for here.
      // It never loads BLTBDAT either, so the line pattern is whatever the
      // last blit left; neutralising rp_LinePtrn is the closest honest answer
      const s = rt.screen
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect('to')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      rawDraw(s, () => s.line(x, y, x1, y1))
    },
    'f plot'(it) {
      // F Plot x,y,colour — "you must give the COLOUR parameter". Routine 49
      // ($1960) pokes the planes through routine 50 ($19ea), which bsets or
      // bclrs each plane from the colour's bits, so it obeys neither the write
      // mask nor Clip. A point off the screen is dropped without a word, and
      // a negative colour is `Rbmi routine 62`. Note it bounds x against
      // `$b2(a0)` times eight — bytes per row, so the padding at the end of a
      // row counts as on-screen — where F Circle next door uses the width word
      // at $4c. The double-buffer arm at $199e is read: with `$be(a0)` set it
      // writes through AMOS's own logical/physical helpers instead, which is
      // the same Autoback the core Plot honours here.
      const s = rt.screen
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      if (c < 0) funcCall()
      if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
      s.putPixel(x, y, c & ((1 << s.depth) - 1))
    },
    'f circle'(it) {
      // F Circle x,y,radius,colour — routine 61 ($1c2c). Eight-way symmetry, x
      // running from r/root2 down to zero, and y from an integer square
      // root that is computed in WORDS. That is the whole of the documented
      // bug: "keep the radius of the circle below 180", because r*r-x*x
      // stops fitting in sixteen bits at 182.
      const s = rt.screen
      const cx = it.evalInt()
      it.expect(',')
      const cy = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      if (c < 0 || r <= 0) funcCall()
      const col = c & ((1 << s.depth) - 1)
      const px = s.pixelsW()
      const put = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
        px[y * s.width + x] = col
      }
      // (r*256)/362 is r/root2, the 45 degree point, plus one
      const q = Math.floor((r * 256) / 362)
      const rr = r * r
      for (let x = q === 0 ? 0 : q + 1; x >= 0; x--) {
        const y = turboSqrt(rr - x * x, 16)
        put(cx + x, cy + y)
        put(cx + x, cy - y)
        put(cx - x, cy + y)
        put(cx - x, cy - y)
        put(cx + y, cy + x)
        put(cx + y, cy - x)
        put(cx - y, cy + x)
        put(cx - y, cy - x)
      }
    },
    'eye 3d'(it) {
      // "This instruction changes the point of view in opposite to the
      // picture plane." Routine 42 ($15b4) writes the pair as two words at
      // $74 and $76 of the extension data block, where Line 3d reads them.
      const x = it.evalInt()
      it.expect(',')
      rt.turbo.eye = { x: w(x), y: w(it.evalInt()) }
    },
    'line 3d'(it) {
      // Line 3D x,y,z To x1,y1,z1 — routine 41 ($155e). "Our perspective
      // calculations can be simplified to : X=X*D/Z and Y=Y*D/Z... The value
      // I use for D=128", which in the routine is `asl.l #$7` then `divs.w`,
      // then `add.w` of the Eye 3d origin the extension keeps at $74/$76 of
      // its data block. A zero Z is a division by zero, AMOS error 20, and
      // the routine tests both of them itself ($1560 and $1568) before it
      // reads anything else.
      //
      // DEFECT: the divide is `divs.w`, sixteen bits of quotient for a
      // dividend that has just been shifted up seven places. A coordinate
      // over 255 at z = 1 overflows it, the 68000 leaves the register alone,
      // and the `add.w` that follows works on the low word of x*128 instead.
      const s = rt.screen
      const v: number[] = []
      for (const sep of [',', ',', 'to', ',', ','] as const) {
        v.push(it.evalInt())
        it.expect(sep)
      }
      v.push(it.evalInt())
      const [x, y, z, x1, y1, z1] = v as [number, number, number, number, number, number]
      if (z === 0 || z1 === 0) throw new AmosError('Division by zero', 20)
      const e = rt.turbo.eye
      const px = (a: number, d: number): number => w(divsw((a << 7) | 0, d) + e.x)
      const py = (a: number, d: number): number => w(divsw((a << 7) | 0, d) + e.y)
      // Move then Draw, so the graphics cursor is left at the far end
      s.grX = px(x, z)
      s.grY = py(y, z)
      s.line(s.grX, s.grY, px(x1, z1), py(y1, z1))
    },
    'memory fill'(it) {
      // Memory Fill start To end,a$ — routine 140 ($4810). "Fill the memory
      // between START and END address with the data held in 'string
      // variable'... If START is greater than END the addresses are swapped
      // so that the command still works."
      //
      // An empty string is `Rbeq routine 62`, not a quiet nothing: the
      // routine reads the length word off the string and errors on zero
      // before it has looked at either address.
      //
      // DEFECT: both fill loops — the one-character one at $483c and the
      // repeating one at $482a — decrement the count AFTER writing and carry
      // on while it is still not negative, so they write end-start+1 bytes.
      // The manual's own example, `Memory Fill Start(6) to Bank End (6),A$`,
      // therefore puts one byte past the end of the bank, because Bank End
      // is already one past the last byte.
      let start = it.evalInt()
      it.expect('to')
      let end = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      if (s.length === 0) funcCall()
      if (start > end) [start, end] = [end, start]
      const m = rt.resolveWrite(start)
      if (!m) return
      const len = Math.min(end - start + 1, m.data.length - m.off)
      for (let i = 0; i < len; i++) m.data[m.off + i] = s.charCodeAt(i % s.length) & 0xff
    },
    'move mem'(it) {
      // Move Mem start,end To dest — routine 181 ($54f2), a memmove that
      // picks its direction from the addresses so an overlapping move stays
      // right, and unrolls eight moves at a time (longwords when source and
      // destination are both even, bytes otherwise). The count is `end -
      // start` with no +1, so unlike Memory Fill above it stops short of the
      // end address. An end at or below the start is an illegal function
      // call — `Rbls`, so the test is unsigned.
      const start = it.evalInt()
      it.expect(',')
      const end = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      if (end - start <= 0) funcCall()
      const src = rt.resolveAddr(start)
      const dst = rt.resolveWrite(dest)
      if (!src || !dst) return
      const len = Math.min(end - start, src.data.length - src.off, dst.data.length - dst.off)
      if (len <= 0) return
      if (src.data === dst.data) dst.data.copyWithin(dst.off, src.off, src.off + len)
      else dst.data.set(src.data.subarray(src.off, src.off + len), dst.off)
    },
    'f paste icon'(it) {
      // F Paste Icon x,y,icon — routine 82 ($244a). "The X coordinate is
      // chopped to ly on a 16 bit boundary, and only partial clipping is
      // supported... Masks are now supported!" It is also the ONLY one of the
      // five that bounds the icon number against the bank's count and refuses
      // an empty slot; the four below index the table and take what is there.
      fIcon(rt, it, 'x', { bounded: true })
    },
    'f 16 icon'(it) {
      // "This routine can only be used to display Icons that are 16 pixels
      // wide... The X and Y coordinates are no longer chopped to ly on a 16
      // bit boundary." Routine 84 ($2c94), and neither is the icon: a
      // negative coordinate is subtracted off the icon's own height or width
      // and the remainder is drawn from the screen edge, where F Paste Icon
      // and the two processor ones branch straight out.
      fIcon(rt, it, 'none')
    },
    'f 32 icon'(it) {
      // routine 83 ($258a), the same 1800 bytes at four bytes a row
      fIcon(rt, it, 'none')
    },
    'f 16proc icon'(it) {
      // Routine 85 ($3156). The processor versions chop X again — and Y with
      // it: `andi.w #$fff0` is applied to BOTH coordinates, so the icon lands
      // on a sixteen-line boundary as well as a sixteen-pixel one, which no
      // other member of the family does and the manual never mentions.
      // "Masking is not supported!"
      fIcon(rt, it, 'xy', { noMask: true })
    },
    'f 32proc icon'(it) {
      // routine 86 ($320e), the same pair of `andi.w #$fff0` masks at four
      // bytes a row
      fIcon(rt, it, 'xy', { noMask: true })
    },
    'plane offset'(it) {
      // Plane Offset scrnr,planenr,xoffset,yoffset — routine 77. The stored
      // value is a byte offset, y*rowBytes+x, and it ADDS to what is there
      // unless the new offset works out to zero, which resets that plane:
      // "To reset the offset of a particular plane, set the X and YOFFSET
      // parameters to zero."
      const nr = it.evalInt()
      it.expect(',')
      const plane = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = rt.screens.get(nr)
      if (!s) funcCall()
      const table = planeTable(rt, nr)
      if (plane === 0) funcCall()
      if (plane < 0) {
        // "To set all offsets for all planes to zero, you should use the
        // Plane Offset command with a negative PLANENR parameter"
        table.fill(0)
        return
      }
      if (plane > s.depth) funcCall()
      const off = y * s.rowBytes + x
      table[plane - 1] = off === 0 ? 0 : (table[plane - 1] ?? 0) + off
    },
    'plane swap'(it) {
      // Plane Swap scrnr,plane1,plane2 — routine 78 ($2272). The pointers are
      // exchanged in all THREE plane tables of the screen structure, at (a0),
      // $18(a0) and $30(a0), so what swaps is which memory each plane reads
      // and writes: in a chunky buffer, the two bits
      const nr = it.evalInt()
      it.expect(',')
      const p1 = it.evalInt()
      it.expect(',')
      const p2 = it.evalInt()
      const s = screenForPlanes(rt, nr, [p1, p2])
      permutePlanes(s, (p) => (p === p1 - 1 ? p2 - 1 : p === p2 - 1 ? p1 - 1 : p))
    },
    'plane shift up'(it) {
      // Plane Shift Up scrnr,start To end — routine 79 ($22ea). "Shifts the
      // planes up by 1": plane 1 takes plane 3's data, plane 2 takes plane
      // 1's, and so on. One saved pointer and a `dbra` that walks the three
      // tables downwards together, which is a rotate by one.
      const { s, from, to } = shiftArgs(rt, it)
      const n = to - from + 1
      permutePlanes(s, (p) => (p < from || p > to ? p : from + (((p - from - 1) % n) + n) % n))
    },
    'plane shift down'(it) {
      // "Does the opposite thing of Plane Shift Up..." — routine 80 ($235e),
      // the same 116 bytes walking the other way
      const { s, from, to } = shiftArgs(rt, it)
      const n = to - from + 1
      permutePlanes(s, (p) => (p < from || p > to ? p : from + ((p - from + 1) % n)))
    },
    'plane update'(it) {
      // "This command is used to reflect the changes made with the Plane
      // commands." Routine 81 ($23d2) CopyMems the screen's $48-byte header
      // aside, adds the six-long offset table at $248 + screen*$18 into all
      // three plane tables, asks AMOS to rebuild the display (`jsr $20(a0)`),
      // and CopyMems the header straight back.
      //
      // DEFECT: `move.w $50(a2),d0` loads the depth and the `dbra` that
      // follows runs depth+1 times, where F Point's identical loop does the
      // `subq.w #$1` first. So it reads a seventh offset — past the end of a
      // table that is six longs — and adds it to a seventh plane pointer.
      // Not reproducible here: this port carries the offsets on the screen
      // rather than biasing pointers in a shared array, so there is no
      // neighbouring table to run into.
      const nr = it.evalInt()
      const s = rt.screens.get(nr)
      if (!s) funcCall()
      const table = rt.turbo.planeOffsets.get(nr)
      s.planeOffsets = table && table.some((v) => v !== 0) ? Int32Array.from(table) : null
    },
    'f put block'(it) {
      // F Put Block block,x,y — routine 92 ($343a). "The X coordinate is
      // chopped to ly on a 16 bit boundary, and only partial clipping is
      // supported." It walks AMOS's own block list at -$189e(a5) for an entry
      // whose number matches and returns quietly when there is none; the
      // block number itself is `Rble routine 62`.
      fPutBlock(rt, it, false)
    },
    'reserve static block'(it) {
      // "Reserves X*8 bytes of memory for converting the linked block-list
      // into a static block-list. (4 bytes for address block data and 4
      // bytes for it's mask)" — routine 93 ($3578), and all three of its
      // guards are here: already reserved, a count at or below zero, and
      // `cmp.l #$7d00 / Rbhi` for a count over 32000. The memory is chip and
      // cleared ($10002).
      const n = it.evalInt()
      if (rt.turbo.staticBlocks) funcCall()
      if (n <= 0 || n > 32000) funcCall()
      rt.turbo.staticBlocks = { size: n, built: new Set() }
    },
    'static block erase'() {
      // "Returns the memory back to the system" — routine 94 ($35bc), which
      // refuses with `Rbeq routine 62` when there is none to return
      if (!rt.turbo.staticBlocks) funcCall()
      rt.turbo.staticBlocks = null
    },
    'build static block'() {
      // "Converts the linked block-list into a static block-list." Routine 95
      // ($35e8) walks AMOS's own block list at -$189e(a5), takes each entry's
      // number from $8 and copies its data and mask pointers ($14 and $18)
      // into slot number-1 of the table, eight bytes apiece. There is no
      // bounds check at all — "Be sure that you have reserved enough memory
      // for all entries!" — and no check that a table was ever reserved
      // either, so with none it writes through a null pointer. This returns
      // instead.
      const t = rt.turbo.staticBlocks
      if (!t) return
      t.built = new Set(rt.blocks.keys())
    },
    'f put static block'(it) {
      // Routine 96 ($3616) is the same 286 bytes with the linked-list walk
      // replaced by `movem.l (a2,d3.l),a2-a3` off the table Reserve Static
      // Block allocated — which is the whole point of it, and also why it
      // checks nothing: no bounds, and no test that a table exists at all.
      fPutBlock(rt, it, true)
    },
    'blit store left'(it) {
      // Blit Store Left screen,blitnr,x,y To x1,y1,shift — routine 325.
      // "allows you to predefine up to 96 different horizontal scrolling
      // zones... If SHIFT is positive the zone will be shifted to the right."
      blitStore(rt, it, false)
    },
    'blit store up'(it) {
      // "Identical to the Blit Store Left command, except it defines a
      // vertical scroll" — routine 313
      blitStore(rt, it, true)
    },
    'blit left'(it) {
      // Blit Left screen,x,y To x1,y1,shift — routine 47, the same scroll
      // with no stored definition: "Immediately executes the scroll"
      const screen = it.evalInt()
      it.expect(',')
      runBlit(rt, blitArgs(rt, it, screen, false))
    },
    'blit up'(it) {
      // routine 145, the vertical counterpart — the one blit keyword the
      // manual never got round to describing
      const screen = it.evalInt()
      it.expect(',')
      runBlit(rt, blitArgs(rt, it, screen, true))
    },
    'multi blit'(it) {
      // Multi Blit start To end — routine 44 ($15cc). "With this command you
      // can scroll up to 96 zones in one go". It waits on the interrupt's own
      // busy byte at $228 and then on BLTBUSY before it starts, and an
      // undefined zone in the range is a null pointer it steps over.
      const { from, to } = blitRange(it)
      for (let i = from; i <= to; i++) {
        const d = rt.turbo.blits[i]
        if (d) runBlit(rt, d)
      }
    },
    'blit speed'(it) {
      // Blit Speed blitnr,shift — routine 46. "Only use positive values, it
      // determines itself if the defined scrolling zone is scrolling to the
      // left or to the right." It determines it by testing bits 0 and 15 of
      // the stored first/last word masks, and only a Blit Store Up zone
      // (mask $ff) or a right scroll of 8 or more (mask $ff<<8 and up) ever
      // matches — see the NOTES entry.
      const nr = it.evalInt()
      it.expect(',')
      const shift = it.evalInt() & 0xf
      if (shift === 0) funcCall()
      if (nr <= 0 || nr > 96) funcCall()
      const d = rt.turbo.blits[nr - 1]
      if (!d) turboError(12)
      // DEFECT: `btst #0` then `btst #15` on the stored masks — a Blit Store
      // Left zone with a shift below 8 matches neither, so the routine
      // returns having changed nothing at all. Reproduced.
      if ((d.masks & 1) === 0 && (d.masks & 0x8000) === 0) return
      d.shift = shift
    },
    'blit erase'(it) {
      // "Erases and frees the memory used by a particular scrolling zone. If
      // blitnr is negative, ALL blit definitions are erased from memory."
      // Routine 45 ($16b2) into routine 324 ($6678): `bmi` to the erase-all
      // arm, `Rbeq routine 62` for zero, and the same 1..96 bound as the rest.
      // The freed size is the zone's own row count times eight plus $14.
      const nr = it.evalInt()
      if (nr < 0) {
        rt.turbo.blits = rt.turbo.blits.map(() => null)
        return
      }
      if (nr === 0 || nr > 96) funcCall()
      rt.turbo.blits[nr - 1] = null
    },
    'blit clear'(it) {
      // Blit Clear x — "If x <0, all bitplanes of a screen will be erased.
      // If x >0, clear bitplane x. An 8 colour screen has 3 bitplanes,
      // numbered 1 -> 3." The all-planes form is the one that honours the
      // Set Planes mask; naming a plane clears it whatever the mask says.
      //
      // Routine 48 ($18b0), and it does not agree with its own manual. The
      // plane count comes from `move.w $50(a0),d7` on the screen structure at
      // $52c(a5), and that field is depth MINUS ONE: both this routine's
      // all-planes loop and Blit Left's (routine 47, $1726) use it as a `dbra`
      // bound, which runs d7+1 times. The named-plane guard is then
      // `subq.w #1,d0 : cmp.w d7,d0 : bge <error>` — so a named plane must be
      // strictly below d7, and **the top bitplane cannot be cleared by name**.
      // On an 8-colour screen the manual's own example, Blit Clear 3, errors.
      // The binary wins over the manual, as it did for LDos's crypt routines.
      //
      // The argument is read as a long and its SIGN tested (`move.l (a3)+,d0 :
      // bmi`), but the range check and the plane index are WORD-width, so only
      // the low sixteen bits choose the plane.
      const s = rt.screen
      const arg = it.evalInt() | 0
      const px = s.pixelsW()
      if (arg < 0) {
        for (let p = 0; p < s.depth; p++) {
          if (!(s.planeMask & (1 << p))) continue
          const bit = ~(1 << p)
          for (let i = 0; i < px.length; i++) px[i]! &= bit
        }
        return
      }
      if (arg === 0) funcCall()
      // the low word, signed, is what `subq.w`/`cmp.w` operate on
      const n = ((arg & 0xffff) << 16) >> 16
      // DEVIATION: the routine errors for n-1 >= d7 and otherwise walks
      // (n-1)+1 plane pointers, so a low word of 0 or below leaves it walking
      // memory with d0 negative rather than erroring. That is unreproducible
      // corruption, so it is reported as the error the in-range failure gives.
      if (n < 1 || n - 1 >= s.depth - 1) funcCall()
      const bit = ~(1 << (n - 1))
      for (let i = 0; i < px.length; i++) px[i]! &= bit
    },
    'blit int on'(it) {
      // "adds a new interrupt server to the VBLANK server chain which will
      // do the same thing as the Multi Blit command... The scrolling does
      // not begin until Blit Int Wait is set False!" Routine 68 ($1f4e) into
      // routine 317 ($61f6), which AllocMems a $16-byte Interrupt structure,
      // fills it in at priority 9, and refuses when $224 says one is already
      // running.
      const range = blitRange(it)
      if (rt.turbo.blitInt) turboError(13)
      rt.turbo.blitInt = range
    },
    'blit int off'() {
      // "This command does not change the Blit Int Wait status." Routine 69
      // ($1f54) into routine 316 ($61a6), which returns quietly when $224 is
      // zero and otherwise RemIntServers and frees between Forbid and Permit.
      rt.turbo.blitInt = null
    },
    'blit int change'(it) {
      // "Allows you to change the blits that are executed within the
      // interrupt scrolling system... exactly the same as Blit Int On start
      // to End, except it works while the interrupt is being executed."
      // Routine 141 ($4846) shares Blit Int On's three range checks, refuses
      // with TURBO error 23 when $224 says nothing is running, and waits out
      // the busy byte at $228 before it rewrites the pair.
      const range = blitRange(it)
      if (!rt.turbo.blitInt) turboError(23)
      rt.turbo.blitInt = range
    },
    'blit int wait'(it) {
      // Blit Int Wait True/False — routine 142 ($4880), twenty-two bytes that
      // store the OPPOSITE of the argument: `bne` to `clr.w $226(a2)` for
      // anything non-zero, and `addq.w #$1,d0` to store 1 for zero. So the
      // flag the interrupt tests is "go", and the keyword's name is "wait".
      rt.turbo.blitGo = it.evalInt() !== 0 ? 0 : 1
    },
    'set planes'(it) {
      // Set Planes mask — "Restricts most drawing operations to a number of
      // bitplanes, defined by the MASK parameter. Each bit represents a
      // bitplane. Ex.: Set Planes %101, enables planes 1 and 3." Routine 76
      // ($21f4) is twenty-six bytes: `andi.l #$ff` and then `move.b d0,$18(a0)`
      // on the RastPort, which is rp_Mask, plus a copy at $43c of the
      // extension's own block for the blit keywords to read. So it belongs to
      // the screen rather than to TURBO -- and now literally is the RastPort's
      // field rather than a Screen one named after it.
      rt.screen.rp.mask = it.evalInt() & 0xff
    },
    'reserve check'(it) {
      // "Reserves x check ZONES for TURBO zone (CHECK) routines. Execute
      // this command before Setting any Check zones." Routine 14 ($ff4) is a
      // trampoline into routine 337 ($6dee): bound the count, refuse to
      // reserve twice, then AllocMem ten bytes a zone, cleared.
      const n = it.evalInt()
      // `cmp.l #$7d01,d0 / Rbge` — 32000 zones is the documented ceiling,
      // and it is checked BEFORE the already-reserved test
      if (n >= 32001) funcCall()
      if (rt.turbo.checks.length !== 0) turboError(0) // "Check allready reserved"
      rt.turbo.checks = Array.from({ length: Math.max(0, n) }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, value: 0 }))
    },
    'check erase'() {
      // "releases the memory used by Reserve Check and erases all
      // definitions. You must Reserve more Check zones before Setting any
      // after this command." Routine 15 ($ffa) into routine 336 ($6dc2),
      // which reports error 1 rather than doing nothing when there is
      // nothing to free.
      if (rt.turbo.checks.length === 0) turboError(1)
      rt.turbo.checks = []
    },
    'reset check'(it) {
      // "Erases a Check zone's definition. You must give the zone number."
      // Routine 18 ($106e) into routine 334 ($6d4c), which writes $ffff into
      // the zone's leading word — that is what Check's `bmi` skips on.
      //
      // DEFECT: the bound is `subq.w #$1,d0 / cmp.w $8(a1),d0 / Rbhi`, so it
      // is the zone number LESS ONE that is compared against the count. Set
      // Check next door compares the number itself. Reset Check therefore
      // accepts one zone past the end and writes ten bytes outside the
      // allocation. Here that lands one past the array, which is harmless.
      const n = it.evalInt()
      const zones = rt.turbo.checks
      if (zones.length === 0) turboError(1)
      if (n < 1 || n - 1 > zones.length) funcCall()
      const z = zones[n - 1]
      if (z) z.value = -1
      else zones[n - 1] = { x1: 0, y1: 0, x2: 0, y2: 0, value: -1 }
    },
    'set check'(it) {
      // Set Check z,x1,y1 To x2,y2 — "Does the same thing as the Set Zone
      // command." Routine 17 ($1068) into routine 335 ($6d80).
      //
      // Every coordinate is `Rbmi`-checked, so a negative one is an error,
      // and the zone number is `Rble` then `Rbhi` against the count. Then
      // `movem.w d0-d4,(a0)` writes the number and the four coordinates AS
      // GIVEN — there is no ordering pass, so a rectangle handed over
      // backwards is stored backwards and can never contain anything.
      const n = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) funcCall()
      // 1-based, like Set Zone — Reserve Check 650 numbers them 1..650
      if (n < 1 || n > rt.turbo.checks.length) funcCall()
      rt.turbo.checks[n - 1] = { x1, y1, x2, y2, value: n }
    },

    // ---- scenes ----

    'reserve scene'(it) {
      // Reserve Scene BANKNR,WIDTH,HEIGHT — routine 158. WIDTH*HEIGHT words
      // and a four-byte header, reserved under the name "Scenery " so that
      // "the Listbank command will display the type of the bank as Scenery".
      const n = it.evalInt()
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      // the height is checked first: the routine reads the arguments back
      // off the stack top-down before popping any of them
      if (height <= 0 || width <= 0 || n <= 0 || n >= 0x10000) funcCall()
      rt.reserveBank(n, 4 + ((width * height) & 0xffff) * 2, 'Scenery ')
      const d = rt.memBanks.get(n)!.data
      setTileAt(d, 0, width)
      setTileAt(d, 2, height)
    },
    'scene bank'(it) {
      // "Make sure you have both a scene bank and icon bank in memory or
      // this command will return a Bank Not Reserved error" — it resolves
      // the icon bank as well as the scene bank, so the icon bank's absence
      // is reported here rather than at the first draw. The scene bank's own
      // type is never checked.
      const n = it.evalInt()
      if (!rt.memBanks.get(n)) throw new AmosError('bank not reserved', 36)
      sceneIcons(rt, rt.turbo.scene.iconBank)
      rt.turbo.scene.bank = n
    },
    'scene icon bank'(it) {
      // The number is stored before it is validated, so a rejected bank
      // still replaces the setting and the next Scene Bank fails too.
      const n = it.evalInt()
      rt.turbo.scene.iconBank = n
      sceneIcons(rt, n)
    },
    'scene load'(it) {
      // Scene Load "file",bank — routine 314. It reserves a bank the size of
      // the file and reads the lot: no header is parsed and nothing is
      // converted, so "this command is able to cope with both 'BYTE' and
      // 'WORD' Sceneformats" only in the sense that it will load either.
      // "The Scene Bank is not set by this command."
      const name = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n >= 0x10000) funcCall()
      if (name.length < 1 || name.length > 128) funcCall()
      const bytes = rt.fs?.read(name)
      if (!bytes) throw new AmosError('file not found', 94)
      rt.reserveBank(n, bytes.length, 'Scenery ')
      rt.memBanks.get(n)!.data.set(bytes)
    },
    'scene convert'(it) {
      // Scene Convert BANK_FROM To BANK_TO — routine 160, the V1.0 byte
      // format widened to words. It reserves BANK_TO itself at the source's
      // dimensions and copies width*height bytes across.
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      const src = rt.memBanks.get(from)
      // the source is fetched without a check and read straight away, which
      // on the Amiga reads address zero
      if (!src) throw new AmosError('bank not reserved', 36)
      const width = sceneW(src.data)
      const height = sceneH(src.data)
      if (to <= 0 || to >= 0x10000 || width <= 0 || height <= 0) funcCall()
      rt.reserveBank(to, 4 + ((width * height) & 0xffff) * 2, 'Scenery ')
      const d = rt.memBanks.get(to)!.data
      setTileAt(d, 0, width)
      setTileAt(d, 2, height)
      for (let i = 0; i < width * height; i++) setTileAt(d, 4 + i * 2, src.data[4 + i] ?? 0)
    },
    'scene change'(it) {
      // Scene Change x,y,v — scene coordinates straight into the bank
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      setTileAt(sceneData(rt), sceneIndex(sceneData(rt), x, y), v)
    },
    'scene 16 change': sceneChange(rt, 4),
    'scene 32 change': sceneChange(rt, 5),
    'scene 16 draw'(it) {
      sceneDraw(rt, it, false)
    },
    'scene 32 draw'(it) {
      sceneDraw(rt, it, true)
    },
    'scene 16 view'(it) {
      sceneView(rt, it, false)
    },
    'scene 32 view'(it) {
      sceneView(rt, it, true)
    },
    'scene 16 do'(it) {
      sceneViewEdge(rt, it, false, '')
    },
    'scene 32 do'(it) {
      sceneViewEdge(rt, it, true, '')
    },
    'scene 16 top'(it) {
      sceneViewEdge(rt, it, false, 't')
    },
    'scene 32 top'(it) {
      sceneViewEdge(rt, it, true, 't')
    },
    'scene 16 bottom'(it) {
      sceneViewEdge(rt, it, false, 'b')
    },
    'scene 32 bottom'(it) {
      sceneViewEdge(rt, it, true, 'b')
    },
    'scene 16 left'(it) {
      sceneViewEdge(rt, it, false, 'l')
    },
    'scene 32 left'(it) {
      sceneViewEdge(rt, it, true, 'l')
    },
    'scene 16 right'(it) {
      sceneViewEdge(rt, it, false, 'r')
    },
    'scene 32 right'(it) {
      sceneViewEdge(rt, it, true, 'r')
    },
    'scene 16 limit'(it) {
      // "X is the amount of definitions. When X is set to zero, the memory
      // is given back to the system." 78 bytes each, AllocMem'd cleared.
      const n = it.evalInt()
      const sc = rt.turbo.scene
      if (n < 0) funcCall()
      if (n > 32000) turboError(16)
      if (n === 0) {
        if (sc.defs.length === 0) turboError(15)
        sc.defs = []
        return
      }
      if (sc.defs.length !== 0) turboError(14)
      sc.defs = Array.from({ length: n }, () => null)
    },
    'scene 16 def'(it) {
      sceneDef(rt, it)
    },
    'scene 16 restore'(it) {
      sceneRestore(rt, it)
    },
    'scene replace'(it) {
      // Scene Replace SC_BNK,XSTART,YSTART,XAMOUNT,YAMOUNT,IC_SEARCH,
      // IC_REPLACE — "a SUPERFAST search and replace" over a rectangle,
      // on a named bank rather than the Scene Bank one.
      const bank = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const aw = it.evalInt()
      it.expect(',')
      const ah = it.evalInt()
      it.expect(',')
      const find = it.evalInt()
      it.expect(',')
      const put = it.evalInt()
      if (put < 0 || find < 0 || ah <= 0 || aw <= 0) funcCall()
      const b = rt.memBanks.get(bank)
      if (!b) throw new AmosError('bank not reserved', 36)
      const { off, cols, rows } = sceneRegion(b.data, x, y, aw, ah)
      const srb = sceneW(b.data) * 2
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const at = off + r * srb + c * 2
          if (tileAt(b.data, at) === (find & 0xffff)) setTileAt(b.data, at, put)
        }
      }
    },
    'scene fill'(it) {
      // Scene Fill BANK,SCENEX,SCENEY,AMOUNTX,AMOUNTY,VALUE
      const bank = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const aw = it.evalInt()
      it.expect(',')
      const ah = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      if (v < 0 || ah <= 0 || aw <= 0) funcCall()
      const b = rt.memBanks.get(bank)
      if (!b) throw new AmosError('bank not reserved', 36)
      const { off, cols, rows } = sceneRegion(b.data, x, y, aw, ah)
      const srb = sceneW(b.data) * 2
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) setTileAt(b.data, off + r * srb + c * 2, v)
    },
    'scene copy'(it) {
      // Scene Copy BANK_FROM,SCENEX,SCENEY,AMOUNTX,AMOUNTY To BANK_TO,
      // SCENEX,SCENEY. "The Scene Banks may have different width and
      // height, everything is checked for" — the rectangle is clipped
      // against the source first and then against the destination, so the
      // smaller of the two wins. "Beware! When Scene Copy is used on the
      // SAME bank, be sure that the areas do NOT overlap": it copies
      // forwards with no overlap test, and this does the same.
      const from = it.evalInt()
      it.expect(',')
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      it.expect(',')
      const aw = it.evalInt()
      it.expect(',')
      const ah = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      if (dy < 0 || dx < 0) funcCall()
      const a = rt.memBanks.get(from)
      if (!a) throw new AmosError('bank not reserved', 36)
      const src = sceneRegion(a.data, sx, sy, aw, ah)
      const b = rt.memBanks.get(to)
      if (!b) throw new AmosError('bank not reserved', 36)
      const dst = sceneRegion(b.data, dx, dy, src.cols, src.rows)
      const srb = sceneW(a.data) * 2
      const drb = sceneW(b.data) * 2
      for (let r = 0; r < dst.rows; r++) {
        for (let c = 0; c < dst.cols; c++) {
          setTileAt(b.data, dst.off + r * drb + c * 2, tileAt(a.data, src.off + r * srb + c * 2))
        }
      }
    },
    'scene mask palette'(it) {
      // "Each BIT represents a colour. If a bit is set, the screen color
      // will be replaced by the Scene Icon Bank color upon execution of the
      // Scene Palette command."
      rt.turbo.scene.maskPalette = it.evalInt()
    },
    'scene palette'(it) {
      // Scene Palette X — routine 151. It builds all 32 entries, writing
      // $FFFF (AMOS's "leave this one alone") wherever the mask bit is
      // clear, and hands the lot to the palette-setting routine. Created
      // "because Get Icon Palette will not get the palette from any bank
      // besides the default icon bank (2)".
      const n = it.evalInt()
      if (n <= 0) funcCall()
      const icons = sceneIcons(rt, n)
      const mask = rt.turbo.scene.maskPalette
      const s = rt.screen
      // Every sprite and icon bank carries 32 palette words (Bnk.Ric2's
      // `.CPal`, +Lib.s:8228), so all 32 are considered and the mask alone
      // decides which reach the screen.
      for (let i = 0; i < Math.min(32, s.palette.length); i++) {
        if (mask & (1 << i)) s.palette[i] = (icons.palette[i] ?? 0) & 0xfff
      }
    },

    // ---- the background loader ----

    'multi bload'(it) {
      // Multi Bload "file","bankname",bank — undocumented, and the only
      // keyword in the extension that is genuinely concurrent: it CreateProc()s
      // an AmigaDOS process (up to five at once) which opens the file,
      // reserves a bank the size of it under the eight-character name given,
      // reads it and exits. The parent checks the file exists first, with
      // pr_WindowPtr set to -1 so a missing volume does not put a requester
      // up, and returns immediately.
      //
      // There is no second thread here, so the load happens now. Every
      // program that uses it waits on Multi Bl Ended before touching the
      // bank, and Multi Bl Ended is true the moment the count reaches zero —
      // so a load that has already finished is indistinguishable from one
      // that finished while BASIC was busy. What is not reproduced is the
      // overlap itself: a program drawing a progress bar during the load
      // sees it complete in one frame.
      const name = it.evalStr()
      it.expect(',')
      const label = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n - 1 >= 0x10000 || n - 1 < 0) funcCall()
      const bytes = rt.fs?.read(name)
      if (!bytes) {
        // the parent's Lock() failing is the one error it reports itself
        rt.turbo.blError = 94
        return
      }
      rt.reserveBank(n, bytes.length, (label.slice(0, 8) + '        ').slice(0, 8))
      rt.memBanks.get(n)!.data.set(bytes)
    },
    'multi bl error'() {
      // routine 173: the high byte of the error word marks out of memory,
      // the word itself carries a DOS error, and zero means nothing went
      // wrong. Reading it clears it either way.
      const e = rt.turbo.blError
      rt.turbo.blError = 0
      if (e === -1) throw new AmosError('Out of memory', 24)
      if (e !== 0) throw new AmosError('file not found', e)
    },
  }
}

/** `Scene 16/32 Change x,y,v` — screen coordinates, shifted down to tiles */
function sceneChange(rt: Runtime, shift: number): Instr {
  return (it) => {
    const x = it.evalInt()
    it.expect(',')
    const y = it.evalInt()
    it.expect(',')
    const v = it.evalInt()
    // "The change made on screen and in the Scene bank" — the routine ends
    // at the bank write. Nothing is redrawn.
    if (x < 0 || y < 0) funcCall()
    const d = sceneData(rt)
    setTileAt(d, sceneIndex(d, (x & 0xffff) >>> shift, (y & 0xffff) >>> shift), v)
  }
}

export function makeTurboFunctions(rt: Runtime): Record<string, Func> {
  return {
    'left click'(_) {
      // Routine 60 ($1c16), eight instructions: btst.b #6,$bfe001 — CIA-A
      // port A bit 6, the left mouse button — then -1 if clear (pressed) and
      // 0 if set. "Returns TRUE if left mouse is pressed."
      return VI(rt.input.mouseK & 1 ? -1 : 0)
    },
    'right click'(_) {
      // "See Left Click function, but then for right mousebutton." Routine
      // 170 ($505c) is the same shape off a different register: btst #10 of
      // POTGOR, $dff016, which is where the right button lands.
      return VI(rt.input.mouseK & 2 ? -1 : 0)
    },
    'raw key'(_, a) {
      // x=Raw Key(n) — "Does the same thing as the Key State function but
      // works even if multitasking is disabled. Returns true (-1) if key N
      // is being pressed. N is the Scancode."
      //
      // Routine 22 ($1150) reads CIA-A's keyboard serial register directly
      // and hand-shakes it — set the handshake bit, `dbra d7` a hundred times
      // for the 85µs the keyboard needs, clear it — which is how it survives
      // Multi No. It then `not.b`/`ror.b #1`s the byte into a scancode and
      // compares. Note `addi.w #$100,d1 / ext.w d1`: the ext throws the added
      // $100 straight back away and sign-extends the byte, so the comparison
      // is against a SIGNED scancode and a key-up code (bit 7 set) reads
      // negative.
      //
      // Here the key state is the same state Key State reads, and there is
      // no multitasking to survive; see the NOTES entry.
      return VI(rt.input.keys.has(int(a[0] ?? VI(0)) & 0xff) ? -1 : 0)
    },
    'is raw key'(_) {
      // "Returns the last key press in raw format. Beware! It gives
      // different values if the key is pressed or released." Routine 171
      // ($5072) is the same `not.b`/`ror.b #1` on $bfec01 with no handshake
      // and no sign extension, so it answers 0..255 with the release bit
      // still in place.
      return VI(rt.input.lastScan)
    },
    check(_, a) {
      // x=Check(start To end,x,y) — routine 16 ($1000). "Returns 1 is the
      // result is true, 0 if not", which is true of zone 1 only; checkHit
      // above has the reading.
      return VI(checkHit(rt, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)), int(a[2] ?? VI(0)), int(a[3] ?? VI(0))))
    },
    'hit bob check'(_, a) {
      // x=Hit Bob Check(start To end,dx,dy,n) — routine 136 ($472a). "dx and
      // dy are optional and give a displacement in opposite to the bob's hot
      // spot", but the routine is `add.l (a3)+,d2 / add.l (a3)+,d1` on the
      // position AMOS hands back: the displacement is ADDED, in the same
      // direction Hit Bob Zone next door adds it. The binary wins.
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const bob = rt.bobs.get(n!)
      if (!bob) return VI(0)
      return VI(checkHit(rt, s!, e!, bob.x + dx!, bob.y + dy!))
    },
    // Lsl.b, Lsl.w, Lsl.l, Lsr.b, Lsr.w and Lsr.l — routines 4 to 9 ($f82,
    // $f8c, $f96, $fa0, $faa, $fb4) — are ten bytes each and identical but for
    // the instruction: pop the count into d0, pop the value into d3, one
    // `lsl`/`lsr` of the stated size, and return d3. The shift is on a register the routine does not otherwise
    // touch, so a byte shift leaves the top 24 bits of the value exactly as
    // they were. "A=Lsl.b(5,1) gives A=10".
    'lsl.b': (_, a) => VI(shiftOp(a, 8, false)),
    'lsl.w': (_, a) => VI(shiftOp(a, 16, false)),
    'lsl.l': (_, a) => VI(shiftOp(a, 32, false)),
    'lsr.b': (_, a) => VI(shiftOp(a, 8, true)),
    'lsr.w': (_, a) => VI(shiftOp(a, 16, true)),
    'lsr.l': (_, a) => VI(shiftOp(a, 32, true)),
    'l swap'(_, a) {
      // "Swap the lower half of the longword with the upper half." Routine 10
      // ($fbe) is eight bytes: pop, `swap d3`, return.
      const v = int(a[0] ?? VI(0))
      return VI(((v << 16) | ((v >>> 16) & 0xffff)) | 0)
    },
    'test.b'(_, a) {
      // "Compares the lower 8 bits of a variable with a given value.
      // Returns 0 if false, -1 if true." Routine 11 ($fc6): `cmp.b d0,d1`
      // and `moveq #$ff,d3`, which is -1 sign-extended, not 255.
      return VI((int(a[0] ?? VI(0)) & 0xff) === (int(a[1] ?? VI(0)) & 0xff) ? -1 : 0)
    },
    'test.w'(_, a) {
      // routine 12 ($fd6), the same sixteen bytes with `cmp.w`
      return VI((int(a[0] ?? VI(0)) & 0xffff) === (int(a[1] ?? VI(0)) & 0xffff) ? -1 : 0)
    },
    'cpu info'(_) {
      // Routine 90 ($33d2) reads AttnFlags at ExecBase+$128 and tests bits 3,
      // 2, 1 and 0 in that order for 40, 30, 20 and 10, answering 0 if none
      // is set. The machine this port models has 2MB of chip and a fast
      // board — an A1200 — so it answers 20; see the NOTES entry.
      return VI(20)
    },
    'math info'(_) {
      // Routine 91 ($340c), the same flags word: bit 4 first for 881 ($371),
      // then bit 5 for 882 ($372), else 0. A stock A1200 has no FPU.
      return VI(0)
    },
    'bit field ext'(_, a) {
      // x=Bit Field Ext(var,startbit,width) — routine 135 ($46ec). "Both the
      // STARTBIT and the WIDTH are interpreted mod 31", which in the routine
      // is `andi.l #$1f` on each. The mask itself comes out of a table the
      // extension keeps at +$3bc, indexed by the width.
      //
      // The two sign checks are NOT made together. Width is popped and
      // `Rbmi`-checked first; a width that masks to zero then takes the
      // `movem.l (a3)+,d2-d3` early exit at $4722, which returns the variable
      // having never looked at the start bit. So a negative start with a zero
      // width is not an error.
      const v = int(a[0] ?? VI(0))
      const start = int(a[1] ?? VI(0))
      const width = int(a[2] ?? VI(0))
      if (width < 0) funcCall()
      const wd = width & 31
      if (wd === 0) return VI(v)
      if (start < 0) funcCall()
      // no start+width bound here — Bit Field Ins has one and this does not,
      // so a field running off the top simply loses the bits `asl.l` shifts out
      return VI((v >>> (start & 31)) & (((1 << wd) - 1) | 0))
    },
    'bit field ins'(_, a) {
      // x=Bit Field Ins(var,startbit,width,value) — routine 134 ($4698), the
      // same shape one argument longer, and the same zero-width early exit at
      // $46e4 that never checks the start bit.
      const v = int(a[0] ?? VI(0))
      const start = int(a[1] ?? VI(0))
      const width = int(a[2] ?? VI(0))
      const val = int(a[3] ?? VI(0))
      if (width < 0) funcCall()
      const wd = width & 31
      if (wd === 0) return VI(v)
      if (start < 0) funcCall()
      const st = start & 31
      // `cmp.w #$20,d4 / Rbhi` — a field running off the end is refused here
      if (st + wd > 32) funcCall()
      const mask = ((((1 << wd) - 1) | 0) << st) | 0
      return VI(((v & ~mask) | ((val << st) & mask)) | 0)
    },
    'byte hunt'(_, a) {
      // routine 137 ($47a2); memHunt above has the reading
      return VI(memHunt(rt, a, 1))
    },
    'word hunt'(_, a) {
      // "See Byte Hunt(params) but now for word hunting... START and END
      // adress are made automatically even." Routine 159 ($4e36) — the same
      // code at word size, and it stops one word short of the end where
      // Byte Hunt covers its last byte.
      return VI(memHunt(rt, a, 2))
    },
    'string hunt'(_, a) {
      // x=String Hunt(start To end,action,step,string) — routine 169 ($4f84).
      // "The step parameter is used to skip a certain amount of bytes for
      // each comparison. When step is negative, this routine will search from
      // end to start!"
      //
      // Four copies of one loop, picked by the signs of ACTION and STEP, and
      // the ACTION test is not what the name suggests. Action zero is the
      // `bne`-out compare — every byte must match. Any NON-zero action is the
      // `beq`-out compare at $5010, which reports the first position where NO
      // byte of the string matches memory, rather than the first where the
      // string is merely absent. There is no ACTION=1/ACTION=-1 distinction
      // at all: `tst.l d1 / bne` is the only test made on it.
      //
      // A step of zero and an end at or below the start are both `routine 62`.
      // Neither the range nor the step accounts for the string's length, so a
      // hit found near the end reads past it, and the backward arm starts at
      // the end address itself rather than a string's length short of it.
      const from = int(a[0] ?? VI(0))
      const to = int(a[1] ?? VI(0))
      const action = int(a[2] ?? VI(0))
      const step = int(a[3] ?? VI(0))
      const needle = str(a[4] ?? VS(''))
      if (step === 0) funcCall()
      if (to <= from) funcCall()
      // the length word is read and never checked: an empty string leaves
      // `dbra` a counter of -1 and it walks 65536 bytes. There is nothing
      // useful in reproducing that, so this answers not-found.
      if (needle.length === 0) return VI(0)
      const m = rt.resolveAddr(from)
      if (!m) return VI(0)
      let at = step < 0 ? to : from
      let left = to - from
      for (;;) {
        let allEqual = true
        let anyEqual = false
        for (let k = 0; k < needle.length; k++) {
          const off = m.off + (at - from) + k
          const b = off >= 0 && off < m.data.length ? m.data[off]! : 0
          if (b === (needle.charCodeAt(k) & 0xff)) anyEqual = true
          else allEqual = false
        }
        if (action === 0 ? allEqual : !anyEqual) return VI(at)
        at += step
        left -= Math.abs(step)
        if (left < 0) return VI(0)
      }
    },
    range(_, a) {
      // x=Range(var, lowvalue To highvalue) — routine 143 ($4896), twenty-
      // eight bytes. "It is important to make sure lowvalue is less than
      // highvalue or this function returns erroneous values", which is true:
      // it tests against the high bound first, then the low, and never
      // compares the two with each other. Both compares are signed longs.
      const v = int(a[0] ?? VI(0))
      const lo = int(a[1] ?? VI(0))
      const hi = int(a[2] ?? VI(0))
      if (v > hi) return VI(hi)
      if (v < lo) return VI(lo)
      return VI(v)
    },
    texp(_, a) {
      // x=Texp(ex, true val, false val) — routine 144 ($48b2). The test is
      // the flags left by popping the expression itself, so it is against
      // zero: any non-zero expression counts as true, not only -1.
      return VI(int(a[0] ?? VI(0)) !== 0 ? int(a[1] ?? VI(0)) : int(a[2] ?? VI(0)))
    },
    't clip'(_, a) {
      // "T Clip(var,32) will make var a multiple of 32... Print T Clip
      // (50,15) returns 45". Routine 149 ($4b0c) is sixteen bytes: `Rble`
      // on the divisor, then `divs.w d0,d3` and `muls.w d0,d3`, so it
      // truncates towards zero rather than flooring — T Clip(-50,15) is -45.
      //
      // DEFECT: both halves are WORD operations on a longword variable, and
      // the guard in front of them is a longword test. A divisor above 65535
      // passes `Rble` and then divides by its low word; a quotient that will
      // not fit in sixteen bits overflows `divs.w`, which leaves d3 untouched
      // and hands the variable's own low word to the multiply. T Clip(100000,2)
      // is -62144 on the machine, not 100000.
      const v = int(a[0] ?? VI(0))
      const at = int(a[1] ?? VI(0))
      if (at <= 0) funcCall()
      // divs.w then muls.w, both on low words; divsw has the overflow
      return VI((w(divsw(v, at)) * w(at)) | 0)
    },
    between(_, a) {
      // x=Between(low,value,high) — routine 150 ($4b1c). "If high is smaller
      // than low, then these values are exchanged so the function still
      // works" — `cmp.l d6,d4 / bgt` keeps the order only when high is
      // strictly greater, so an equal pair is exchanged too, harmlessly. The
      // comparisons are then strict: ((low<value) and (value<high)).
      let lo = int(a[0] ?? VI(0))
      const v = int(a[1] ?? VI(0))
      let hi = int(a[2] ?? VI(0))
      if (hi <= lo) [lo, hi] = [hi, lo]
      return VI(v < hi && v > lo ? -1 : 0)
    },
    'bank end'(_, a) {
      // "If you ask for the Bank End of a Sprite or Icon bank the result
      // will be NEGATIVE. It gives the negative amount of Sprite/Icon
      // definitions stored in the bank." Routine 153 ($4bb2) is a six-byte
      // trampoline into routine 312 ($5dc4), which asks AMOS for the bank
      // address and then compares the longword at a0-8 — the first half of
      // the eight-character bank name — with 'Icon' and 'Spri'. On a match
      // it returns the word at (a0) sign-extended and negated, which is the
      // image count; otherwise the length longword at a0-$14, less $10,
      // plus the address. Bank numbers 1 and 2 are the only banks that can
      // carry those names in this port's model, which is what it keys on.
      const n = int(a[0] ?? VI(0))
      if (n === 1 && rt.spriteBank) return VI(-rt.spriteBank.images.length)
      if (n === 2 && rt.iconBank) return VI(-rt.iconBank.images.length)
      const b = rt.memBanks.get(n)
      // "If you ask TURBO PLUS to return the Bank End of a bank that is not
      // reserved you will get useless information - you will not get an
      // error"
      if (!b) return VI(0)
      return VI(rt.bankBase(n) + b.data.length)
    },
    'chip largest'(_) {
      // routine 167 ($4f54): AvailMem (`jsr -$d8(a6)`) with d1 = $20002,
      // MEMF_CHIP|MEMF_LARGEST
      return VI(rt.chipFree())
    },
    'fast largest'(_) {
      // routine 168 ($4f6c), the same call with $20004, MEMF_FAST|MEMF_LARGEST
      return VI(rt.fastFree())
    },
    'parse$'(_, a) {
      // routine 180 ($5430); parseWord above has the reading
      return VI(parseWord(str(a[0] ?? VS('')), int(a[1] ?? VI(0)), str(a[2] ?? VS('')), int(a[3] ?? VI(0))))
    },
    'hit spr zone'(_, a) {
      // "This command does the same thing as: A=Hzone(X Sprite(n)+dx,
      // Y Sprite(n)+dy)" — hardware coordinates, so a hardware zone lookup.
      //
      // Routine 19 ($1074) bounds the sprite number itself before it indexes:
      // `Rbmi` for a negative one and `cmp.w #$40,d1 / Rbhi` for anything over
      // 64. Inside that range it reads the sprite table at -$17fe(a5) whether
      // the sprite is defined or not, so an undefined one is at 0,0 rather
      // than an error or a refusal.
      const [dx, dy, n] = [0, 1, 2].map((i) => int(a[i] ?? VI(0)))
      if (n! < 0 || n! > 64) funcCall()
      const spr = rt.hwSprites.get(n!)
      return VI(hardZoneAt(rt, (spr?.x ?? 0) + dx!, (spr?.y ?? 0) + dy!))
    },
    'hit bob zone'(_, a) {
      // "the same as: A=Zone(X Bob(n)+dx,Y Bob(n)+dy)" — screen coordinates
      const [dx, dy, n] = [0, 1, 2].map((i) => int(a[i] ?? VI(0)))
      const bob = rt.bobs.get(n!)
      if (!bob) return VI(0)
      return VI(rt.zoneAt(bob.x + dx!, bob.y + dy!))
    },
    // Routines 87, 88 and 89 ($330e, $334e, $3390) are sixty-odd bytes each
    // and identical but for the last instruction: walk the bank list for the
    // one whose type longword is 2 — the icon bank, always, never Scene Icon
    // Bank's choice — index it, and read word 0, word 2 or word 4 of the
    // image header. Width comes back in WORDS because that is how the header
    // stores it. Every step raises: `Rble routine 62` for a number at or
    // below zero, routine 130 for no icon bank, routine 131 for a number past
    // the count or a hole in the table.
    'x icon'(_, a) {
      // "returns the width (in words) of a particular Icon"
      return VI(iconField(rt, int(a[0] ?? VI(0)), (img) => img.width >> 4)) // move.w (a2),d3
    },
    'y icon'(_, a) {
      // "returns the height (in lines)"
      return VI(iconField(rt, int(a[0] ?? VI(0)), (img) => img.height)) // move.w $2(a2),d3
    },
    'planes icon'(_, a) {
      // "how many planes the Icon is made of"
      return VI(iconField(rt, int(a[0] ?? VI(0)), (img) => img.depth)) // move.w $4(a2),d3
    },
    'icon check'(_, a) {
      // "-1 indicates that the Icon is defined, and it has NO MASK. 1
      // indicates that the Icon is defined, and it has a MASK. 0 indicates
      // that the Icon is NOT defined" — and with no bank at all, "in AMOSPro
      // you don't get an error, 0 is returned instead"
      //
      // Routine 147 reads the bank number from $3b8 — the Scene Icon Bank
      // setting — rather than always asking the icon bank: "It is also
      // possible to check other Icon banks with it. See the Scene Icon Bank
      // command for more clarification. It can even check BOB/SPRITE banks,
      // as the bank has the same format." It never checks the lookup
      // succeeded, so a missing bank reads address zero on the Amiga; here
      // it takes the documented answer of 0.
      const n = int(a[0] ?? VI(0))
      if (n <= 0) funcCall()
      const nb = rt.turbo.scene.iconBank
      const bank = nb === 1 ? rt.spriteBank : nb === 2 ? rt.iconBank : null
      const img = bank?.image(n)
      if (!img) return VI(0)
      return VI(img.opaque ? -1 : 1)
    },
    'f sqr'(_, a) {
      // Undocumented; routine 65 ($1f18) is a digit-by-digit integer square
      // root over a long, rounding up when the remainder reaches the root.
      //
      // DEFECT: it finishes with `ext.l d1` before returning, which
      // sign-extends the low WORD of a root that can legitimately reach
      // 46341. So F Sqr answers correctly up to 32767*32767 and then wraps
      // negative: F Sqr(1073741824) is -32768, not 32768.
      return VI(((turboSqrt(int(a[0] ?? VI(0)), 32) << 16) >> 16) | 0)
    },
    'f point'(_, a) {
      // "returns the colour register of the pixel located on screen at
      // coordinates X,Y" — and, like AMOS's own Point, -1 off the screen.
      // Routine 51 ($1a12) loads -1 first and only clears it once both
      // coordinates are inside, then walks the planes with `btst`/`bset`
      // building the colour a bit at a time.
      return VI(rt.screen.point(int(a[0] ?? VI(0)), int(a[1] ?? VI(0))))
    },
    'hit spr check'(_, a) {
      // x=Hit Spr Check(start To end,dx,dy,n) — routine 21 ($10ce), the same
      // scan for a sprite. The one instruction that separates it from Hit Bob
      // Check is the extra `jsr $30(a0)` after the displacement is added:
      // Check zones are screen rectangles ("Define a rectangular screen
      // area") and a sprite's position is in hardware coordinates, so the
      // pair is converted before the scan — the same conversion Hzone makes
      // for Hit Spr Zone.
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const spr = rt.hwSprites.get(n!)
      if (!spr) return VI(0)
      const sc = rt.screen
      return VI(checkHit(rt, s!, e!, sc.hardToScreenX(spr.x + dx!), sc.hardToScreenY(spr.y + dy!)))
    },

    // ---- scenes ----

    'scene x'(_) {
      // width and height straight out of the bank header. Neither checks
      // that a Scene Bank was ever set — with the pointer still zero they
      // read low memory; here they say so.
      return VI(sceneW(sceneData(rt)))
    },
    'scene y'(_) {
      return VI(sceneH(sceneData(rt)))
    },
    'scene check'(_, a) {
      // "Returns Icon number in the scene at scene coordinates X,Y, minus 1"
      const d = sceneData(rt)
      return VI(tileAt(d, sceneIndex(d, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)))))
    },
    'scene 16 check'(_, a) {
      return VI(sceneCheckScreen(rt, a, 4))
    },
    'scene 32 check'(_, a) {
      return VI(sceneCheckScreen(rt, a, 5))
    },
    'scene scan x'(_, a) {
      return VI(sceneScan(rt, a, false))
    },
    'scene scan y'(_, a) {
      return VI(sceneScan(rt, a, true))
    },
    'multi bl ended'(_) {
      // Routine 174 ($541a) is twenty-two bytes: -1 while the pending-load
      // count word at $6d4 of the extension data block is zero, 0 otherwise.
      // With the loads done synchronously the count is never anything else.
      return VI(-1)
    },
  } as Record<string, Func>
}

export type { Value }
