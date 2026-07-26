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
import type { ObjectBank } from './objects'
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

/** a TURBO Check zone: its own rectangle system, not AMOS's */
export interface CheckZone {
  x1: number
  y1: number
  x2: number
  y2: number
  set: boolean
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

/** `Check`, `Hit Bob Check` and `Hit Spr Check` all share this scan */
function checkHit(rt: Runtime, from: number, to: number, x: number, y: number): number {
  const zones = rt.turbo.checks
  const lo = Math.max(0, Math.min(from, to))
  const hi = Math.min(zones.length - 1, Math.max(from, to))
  for (let i = lo; i <= hi; i++) {
    const z = zones[i]
    if (!z?.set) continue
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return 1
  }
  return 0
}

/** 68k divs.w: division truncated towards zero, not floored */
const divs = (a: number, b: number): number => Math.trunc(a / b)

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
  // START below 1 indexes behind the pointer array on the real machine,
  // which is memory corruption rather than behaviour worth reproducing
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
  const px = s.pixels
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
  const mask = s.planeMask
  const pattern = s.linePattern
  s.planeMask = 0xff
  s.linePattern = 0xffff
  try {
    body()
  } finally {
    s.planeMask = mask
    s.linePattern = pattern
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
 * `Byte Hunt` and `Word Hunt`. "If ACTION=0 the Byte Hunt command behaves
 * just like the normal Hunt command. Only VAL1 is checked for. If ACTION=-1
 * ... any value lying outside the values VAL1 to VAL2, inclusive. If
 * ACTION=1 ... any value lying inside".
 */
function memHunt(rt: Runtime, a: Value[], unit: 1 | 2): number {
  let from = int(a[0] ?? VI(0))
  let to = int(a[1] ?? VI(0))
  const action = int(a[2] ?? VI(0))
  const v1 = int(a[3] ?? VI(0))
  const v2 = int(a[4] ?? VI(0))
  // "If START is greater than END the addresses are swapped so that the
  // command still works"
  if (from > to) [from, to] = [to, from]
  // "START and END adress are made automatically even"
  if (unit === 2) {
    from &= ~1
    to &= ~1
  }
  const m = rt.resolveAddr(from)
  if (!m) return 0
  const n = Math.min(to - from, m.data.length - m.off)
  const lo = Math.min(v1, v2)
  const hi = Math.max(v1, v2)
  for (let i = 0; i + unit <= n; i += unit) {
    const at = m.off + i
    const val = unit === 1 ? m.data[at]! : (m.data[at]! << 8) | m.data[at + 1]!
    const hit = action === 0 ? val === (unit === 1 ? v1 & 0xff : v1 & 0xffff) : action > 0 ? val >= lo && val <= hi : val < lo || val > hi
    if (hit) return from + i
  }
  return 0
}

/**
 * `Parse$`, which is undocumented and does not return a string despite its
 * name: routine 180 leaves an integer in d3.
 *
 * `Parse$(source$, n, alternatives$, notfound)` takes word `n` of the source
 * — words being separated by space, comma or full stop — and matches it
 * against a list of alternatives separated by `|`, returning which one
 * matched, counting from one, or `notfound`. A command parser for text
 * adventures, in one keyword.
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
  let k = 1
  for (const alt of alternatives.split('|')) {
    if (alt === got) return k
    k++
  }
  return notfound
}

/** `Hzone`'s mapping: hardware coordinates into the current screen */
function hardZoneAt(rt: Runtime, x: number, y: number): number {
  const s = rt.screen
  return rt.zoneAt((x - s.displayX) * (s.hires ? 2 : 1) + s.offsetX, y - s.displayY + s.offsetY)
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
  const s = screenForPlanes(rt, nr, [from, to])
  if (to < from) funcCall()
  return { s, from: from - 1, to: to - 1 }
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
function fIcon(rt: Runtime, it: Interp, chop: boolean, noMask = false): void {
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect(',')
  const n = it.evalInt()
  const s = rt.screen
  const img = rt.iconBank?.image(n)
  if (!img) return
  // "If X < 0 no Icon is displayed... If X > width of screen, no Icon is
  // displayed" — off the near edge it is dropped whole, off the far edge it
  // is clipped
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
  rt.blit(s, img, chop ? x & 0xfff0 : x, y, noMask || img.opaque)
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
  const px = s.pixels
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
    const px = s.pixels
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
 * `y1 / rowBytes` instead of line `y1`. It is reproduced rather than
 * corrected: a program written against the real 2.15 is drawing where this
 * puts it. `Scene 16/32 View scr,x1,0 To x2,y2` is unaffected.
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
      // SetTaskPri(FindTask(NULL), 0) in the binary.
      rt.turbo.priority = 0
    },
    'multi no'() {
      // The routine is exactly SetTaskPri(FindTask(NULL), 20) — exec
      // FindTask (-$126) then SetTaskPri (-$12c), with 20 in d0 — which is
      // what the manual describes: "Under AMOS Pro, Multi No sets the
      // priority of AMOS Pro to 20, blocking most tasks, but not blocking
      // the VITAL task."
      rt.turbo.priority = 20
    },
    'amos pri'(it) {
      // "Set the priority of AMOS. Value ranges from -128 to 20"
      rt.turbo.priority = Math.max(-128, Math.min(20, it.evalInt()))
    },
    'workbench open'() {
      // The counterpart to AMOS's Close Workbench, which this port already
      // treats as faithful because there is no Workbench memory to free.
      // Reopening it is the same nothing in reverse.
    },
    'vbl wait'(it) {
      // Vbl Wait x — "Wait until the raster beam has reached a given value".
      // The routine is a four-instruction busy-wait on the low byte of
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
      objectWalk(rt, n, (x, y) => (mul < 0 ? [w(divs(x, -mul)), w(divs(y, -mul))] : [w(x * mul), w(y * mul)]))
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
      const scale = (v: number): number => (mul < 0 ? divs(v, -mul) : v * mul)
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
      // "Displays the 'STARS' onto the screen and computes the next position"
      const st = starfield(rt)
      starsStep(st, 0, st.count - 1, starsPlotter(rt, rt.currentIndex))
    },
    'stars draw'() {
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
      // faster" — two add.w straight into rp_cp_x/cp_y
      const s = rt.screen
      const dx = it.evalInt()
      it.expect(',')
      s.grX = w(s.grX + dx)
      s.grY = w(s.grY + it.evalInt())
    },
    'r home'(it) {
      // Undocumented, and not relative at all: routine 26 writes both words
      // of the graphics cursor, so it is Gr Locate under another name
      const s = rt.screen
      s.grX = w(it.evalInt())
      it.expect(',')
      s.grY = w(it.evalInt())
    },
    'r draw'(it) {
      // "draw a line relative to the graphics cursor... At the completion of
      // the command, the graphics cursor will be located at the end"
      const s = rt.screen
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      s.line(s.grX, s.grY, w(s.grX + dx), w(s.grY + dy))
    },
    'r box'(it) {
      // Four Draws round the rectangle, ending back where it started, which
      // is why "the position of the graphics cursor remains unchanged"
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
      // RectFill from the cursor, which does not move it. Both deltas must
      // be positive — two Rbmi before the call.
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
      // the manual's shorter "F Draw X,Y" form does not exist; see NOTES
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
      // F Plot x,y,colour — "you must give the COLOUR parameter". The
      // routine pokes the planes, so it obeys neither the write mask nor
      // Clip, and a point off the screen is dropped without a word.
      const s = rt.screen
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      if (c < 0) funcCall()
      if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
      s.pixels[y * s.width + x] = c & ((1 << s.depth) - 1)
    },
    'f circle'(it) {
      // F Circle x,y,radius,colour — routine 61. Eight-way symmetry, x
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
      const px = s.pixels
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
      // picture plane."
      const x = it.evalInt()
      it.expect(',')
      rt.turbo.eye = { x: w(x), y: w(it.evalInt()) }
    },
    'line 3d'(it) {
      // Line 3D x,y,z To x1,y1,z1 — "our perspective calculations can be
      // simplified to : X=X*D/Z and Y=Y*D/Z... The value I use for D=128",
      // which in the routine is asl.l #7 then divs.w. A zero Z is a
      // division by zero, AMOS error 20, and the routine says so itself.
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
      const px = (a: number, d: number): number => w(divs(a * 128, d) + e.x)
      const py = (a: number, d: number): number => w(divs(a * 128, d) + e.y)
      // Move then Draw, so the graphics cursor is left at the far end
      s.grX = px(x, z)
      s.grY = py(y, z)
      s.line(s.grX, s.grY, px(x1, z1), py(y1, z1))
    },
    'memory fill'(it) {
      // Memory Fill start To end,a$ — "Fill the memory between START and END
      // address with the data held in 'string variable'... If START is
      // greater than END the addresses are swapped so that the command still
      // works."
      let start = it.evalInt()
      it.expect('to')
      let end = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      if (start > end) [start, end] = [end, start]
      if (s.length === 0) return
      const m = rt.resolveWrite(start)
      if (!m) return
      const len = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i < len; i++) m.data[m.off + i] = s.charCodeAt(i % s.length) & 0xff
    },
    'move mem'(it) {
      // Move Mem start,end To dest — routine 181, a memmove that picks its
      // direction from the addresses so an overlapping move stays right.
      // An end at or below the start is an illegal function call (Rbls).
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
      // F Paste Icon x,y,icon — "The X coordinate is chopped to ly on a 16
      // bit boundary, and only partial clipping is supported... Masks are
      // now supported!"
      fIcon(rt, it, true)
    },
    'f 16 icon'(it) {
      // "This routine can only be used to display Icons that are 16 pixels
      // wide... The X and Y coordinates are no longer chopped to ly on a 16
      // bit boundary."
      fIcon(rt, it, false)
    },
    'f 32 icon'(it) {
      fIcon(rt, it, false)
    },
    'f 16proc icon'(it) {
      // the processor versions chop X again, and "Masking is not supported!"
      fIcon(rt, it, true, true)
    },
    'f 32proc icon'(it) {
      fIcon(rt, it, true, true)
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
      // Plane Swap scrnr,plane1,plane2 — the pointers are exchanged in all
      // three tables of the screen structure, so what swaps is which memory
      // each plane reads and writes: in a chunky buffer, the two bits
      const nr = it.evalInt()
      it.expect(',')
      const p1 = it.evalInt()
      it.expect(',')
      const p2 = it.evalInt()
      const s = screenForPlanes(rt, nr, [p1, p2])
      permutePlanes(s, (p) => (p === p1 - 1 ? p2 - 1 : p === p2 - 1 ? p1 - 1 : p))
    },
    'plane shift up'(it) {
      // Plane Shift Up scrnr,start To end — "Shifts the planes up by 1":
      // plane 1 takes plane 3's data, plane 2 takes plane 1's, and so on
      const { s, from, to } = shiftArgs(rt, it)
      const n = to - from + 1
      permutePlanes(s, (p) => (p < from || p > to ? p : from + (((p - from - 1) % n) + n) % n))
    },
    'plane shift down'(it) {
      // "Does the opposite thing of Plane Shift Up..."
      const { s, from, to } = shiftArgs(rt, it)
      const n = to - from + 1
      permutePlanes(s, (p) => (p < from || p > to ? p : from + ((p - from + 1) % n)))
    },
    'plane update'(it) {
      // "This command is used to reflect the changes made with the Plane
      // commands." The routine biases the plane pointers by the offset
      // table, rebuilds the display, and puts the pointers straight back.
      const nr = it.evalInt()
      const s = rt.screens.get(nr)
      if (!s) funcCall()
      const table = rt.turbo.planeOffsets.get(nr)
      s.planeOffsets = table && table.some((v) => v !== 0) ? Int32Array.from(table) : null
    },
    'f put block'(it) {
      // F Put Block block,x,y — "The X coordinate is chopped to ly on a 16
      // bit boundary, and only partial clipping is supported."
      fPutBlock(rt, it, false)
    },
    'reserve static block'(it) {
      // "Reserves X*8 bytes of memory for converting the linked block-list
      // into a static block-list. (4 bytes for address block data and 4
      // bytes for it's mask)"
      const n = it.evalInt()
      if (rt.turbo.staticBlocks) funcCall()
      if (n <= 0 || n > 32000) funcCall()
      rt.turbo.staticBlocks = { size: n, built: new Set() }
    },
    'static block erase'() {
      // "Returns the memory back to the system" — and refuses when there is
      // none to return
      if (!rt.turbo.staticBlocks) funcCall()
      rt.turbo.staticBlocks = null
    },
    'build static block'() {
      // "Converts the linked block-list into a static block-list." It walks
      // AMOS's own list and indexes each block by its number, with no bounds
      // check at all — "Be sure that you have reserved enough memory for all
      // entries!"
      const t = rt.turbo.staticBlocks
      if (!t) return
      t.built = new Set(rt.blocks.keys())
    },
    'f put static block'(it) {
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
      // Multi Blit start To end — "With this command you can scroll up to 96
      // zones in one go". An undefined zone in the range is skipped.
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
      // `btst #0` then `btst #15` on the stored masks: a Blit Store Left
      // zone with a shift below 8 matches neither, and the routine returns
      // having changed nothing at all
      if ((d.masks & 1) === 0 && (d.masks & 0x8000) === 0) return
      d.shift = shift
    },
    'blit erase'(it) {
      // "Erases and frees the memory used by a particular scrolling zone. If
      // blitnr is negative, ALL blit definitions are erased from memory."
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
      const s = rt.screen
      const n = it.evalInt()
      const px = s.pixels
      if (n < 0) {
        for (let p = 0; p < s.depth; p++) {
          if (!(s.planeMask & (1 << p))) continue
          const bit = ~(1 << p)
          for (let i = 0; i < px.length; i++) px[i]! &= bit
        }
        return
      }
      if (n === 0 || n - 1 >= s.depth) funcCall()
      const bit = ~(1 << (n - 1))
      for (let i = 0; i < px.length; i++) px[i]! &= bit
    },
    'blit int on'(it) {
      // "adds a new interrupt server to the VBLANK server chain which will
      // do the same thing as the Multi Blit command... The scrolling does
      // not begin until Blit Int Wait is set False!"
      const range = blitRange(it)
      if (rt.turbo.blitInt) turboError(13)
      rt.turbo.blitInt = range
    },
    'blit int off'() {
      // "This command does not change the Blit Int Wait status."
      rt.turbo.blitInt = null
    },
    'blit int change'(it) {
      // "Allows you to change the blits that are executed within the
      // interrupt scrolling system... exactly the same as Blit Int On start
      // to End, except it works while the interrupt is being executed."
      const range = blitRange(it)
      if (!rt.turbo.blitInt) turboError(23)
      rt.turbo.blitInt = range
    },
    'blit int wait'(it) {
      // Blit Int Wait True/False. The routine stores the opposite of its
      // argument: anything non-zero clears the flag, zero sets it to 1.
      rt.turbo.blitGo = it.evalInt() !== 0 ? 0 : 1
    },
    'set planes'(it) {
      // Set Planes mask — "Restricts most drawing operations to a number of
      // bitplanes, defined by the MASK parameter. Each bit represents a
      // bitplane. Ex.: Set Planes %101, enables planes 1 and 3." It writes
      // rp_Mask, so it belongs to the screen rather than to TURBO.
      rt.screen.planeMask = it.evalInt() & 0xff
    },
    'reserve check'(it) {
      // "Reserves x check ZONES for TURBO zone (CHECK) routines. Execute
      // this command before Setting any Check zones."
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call')
      rt.turbo.checks = Array.from({ length: n }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, set: false }))
    },
    'check erase'() {
      // "releases the memory used by Reserve Check and erases all
      // definitions. You must Reserve more Check zones before Setting any
      // after this command."
      rt.turbo.checks = []
    },
    'reset check'(it) {
      // "Erases a Check zone's definition. You must give the zone number."
      const z = rt.turbo.checks[it.evalInt()]
      if (z) z.set = false
    },
    'set check'(it) {
      // Set Check z,x1,y1 To x2,y2 — "Does the same thing as the Set Zone
      // command."
      const n = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const z = rt.turbo.checks[n]
      if (!z) throw new AmosError('Illegal function call')
      z.x1 = Math.min(x1, x2)
      z.y1 = Math.min(y1, y2)
      z.x2 = Math.max(x1, x2)
      z.y2 = Math.max(y1, y2)
      z.set = true
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
      // On the Amiga a sprite or icon bank always carries 32 palette words
      // and the routine copies all 32. Here a bank built by Get Icon has no
      // recorded palette at all, so — as Get Icon Palette already does — an
      // entry the bank does not have is left alone rather than zeroed.
      for (let i = 0; i < Math.min(32, icons.palette.length, s.palette.length); i++) {
        if (mask & (1 << i)) s.palette[i] = icons.palette[i]! & 0xfff
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
      // Eight instructions in the binary: btst.b #6,$bfe001 — CIA-A port A
      // bit 6, the left mouse button — then -1 if clear (pressed) and 0 if
      // set. "Returns TRUE if left mouse is pressed."
      return VI(rt.input.mouseK & 1 ? -1 : 0)
    },
    'right click'(_) {
      // "See Left Click function, but then for right mousebutton."
      return VI(rt.input.mouseK & 2 ? -1 : 0)
    },
    'raw key'(_, a) {
      // x=Raw Key(n) — "Does the same thing as the Key State function but
      // works even if multitasking is disabled. Returns true (-1) if key N
      // is being pressed. N is the Scancode." The real routine reads CIA-A's
      // keyboard serial register directly, which is how it survives Multi
      // No; here the key state is the same state Key State reads, and there
      // is no multitasking to survive.
      return VI(rt.input.keys.has(int(a[0] ?? VI(0)) & 0xff) ? -1 : 0)
    },
    'is raw key'(_) {
      // "Returns the last key press in raw format. Beware! It gives
      // different values if the key is pressed or released." The raw code
      // differs by the release bit, bit 7, which a key-up sets.
      return VI(rt.input.lastScan)
    },
    check(_, a) {
      // x=Check(start To end,x,y) — "Returns 1 is the result is true, 0 if
      // not." Note 1, not AMOS's -1.
      return VI(checkHit(rt, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)), int(a[2] ?? VI(0)), int(a[3] ?? VI(0))))
    },
    'hit bob check'(_, a) {
      // x=Hit Bob Check(start To end,dx,dy,n) — "dx and dy are optional and
      // give a displacement in opposite to the bob's hot spot"
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const bob = rt.bobs.get(n!)
      if (!bob) return VI(0)
      return VI(checkHit(rt, s!, e!, bob.x - dx!, bob.y - dy!))
    },
    // The shift group is one 68k instruction each, on a register the routine
    // does not otherwise touch — so a byte shift leaves the top 24 bits of
    // the value exactly as they were. "A=Lsl.b(5,1) gives A=10".
    'lsl.b': (_, a) => VI(shiftOp(a, 8, false)),
    'lsl.w': (_, a) => VI(shiftOp(a, 16, false)),
    'lsl.l': (_, a) => VI(shiftOp(a, 32, false)),
    'lsr.b': (_, a) => VI(shiftOp(a, 8, true)),
    'lsr.w': (_, a) => VI(shiftOp(a, 16, true)),
    'lsr.l': (_, a) => VI(shiftOp(a, 32, true)),
    'l swap'(_, a) {
      // "Swap the lower half of the longword with the upper half."
      const v = int(a[0] ?? VI(0))
      return VI(((v << 16) | ((v >>> 16) & 0xffff)) | 0)
    },
    'test.b'(_, a) {
      // "Compares the lower 8 bits of a variable with a given value.
      // Returns 0 if false, -1 if true."
      return VI((int(a[0] ?? VI(0)) & 0xff) === (int(a[1] ?? VI(0)) & 0xff) ? -1 : 0)
    },
    'test.w'(_, a) {
      return VI((int(a[0] ?? VI(0)) & 0xffff) === (int(a[1] ?? VI(0)) & 0xffff) ? -1 : 0)
    },
    'cpu info'(_) {
      // Reads AttnFlags at ExecBase+$128 and reports 0, 10, 20, 30 or 40.
      // The machine this port models has 2MB of chip and a fast board — an
      // A1200 — so it answers 20; see the NOTES entry.
      return VI(20)
    },
    'math info'(_) {
      // 0, 881 or 882 from the same flags. A stock A1200 has no FPU.
      return VI(0)
    },
    'bit field ext'(_, a) {
      // x=Bit Field Ext(var,startbit,width) — "Both the STARTBIT and the
      // WIDTH are interpreted mod 31", which in the routine is `andi.l #$1f`
      const v = int(a[0] ?? VI(0))
      const start = int(a[1] ?? VI(0))
      const width = int(a[2] ?? VI(0))
      if (start < 0 || width < 0) funcCall()
      const wd = width & 31
      // a width of zero pops the remaining arguments and hands back the
      // variable untouched
      if (wd === 0) return VI(v)
      return VI((v >>> (start & 31)) & (wd === 32 ? -1 : (1 << wd) - 1))
    },
    'bit field ins'(_, a) {
      // x=Bit Field Ins(var,startbit,width,value)
      const v = int(a[0] ?? VI(0))
      const start = int(a[1] ?? VI(0))
      const width = int(a[2] ?? VI(0))
      const val = int(a[3] ?? VI(0))
      if (start < 0 || width < 0) funcCall()
      const wd = width & 31
      if (wd === 0) return VI(v)
      const st = start & 31
      // a field running off the end of the longword is refused outright
      if (st + wd > 32) funcCall()
      const mask = ((wd === 32 ? -1 : (1 << wd) - 1) << st) | 0
      return VI(((v & ~mask) | ((val << st) & mask)) | 0)
    },
    'byte hunt'(_, a) {
      return VI(memHunt(rt, a, 1))
    },
    'word hunt'(_, a) {
      // "See Byte Hunt(params) but now for word hunting... START and END
      // adress are made automatically even."
      return VI(memHunt(rt, a, 2))
    },
    'string hunt'(_, a) {
      // x=String Hunt(start To end,action,step,string) — "The step parameter
      // is used to skip a certain amount of bytes for each comparison. When
      // step is negative, this routine will search from end to start!"
      let from = int(a[0] ?? VI(0))
      let to = int(a[1] ?? VI(0))
      const action = int(a[2] ?? VI(0))
      const step = int(a[3] ?? VI(0))
      const needle = str(a[4] ?? VS(''))
      if (from > to) [from, to] = [to, from]
      if (needle.length === 0 || step === 0) return VI(0)
      const m = rt.resolveAddr(from)
      if (!m) return VI(0)
      const n = Math.min(to - from, m.data.length - m.off)
      const at = (i: number): boolean => {
        for (let k = 0; k < needle.length; k++) {
          if (m.data[m.off + i + k] !== (needle.charCodeAt(k) & 0xff)) return false
        }
        return true
      }
      const inside = (i: number): boolean => (action === 0 || action === 1 ? at(i) : !at(i))
      if (step > 0) {
        for (let i = 0; i + needle.length <= n; i += step) if (inside(i)) return VI(from + i)
      } else {
        for (let i = n - needle.length; i >= 0; i += step) if (inside(i)) return VI(from + i)
      }
      return VI(0)
    },
    range(_, a) {
      // x=Range(var, lowvalue To highvalue) — "It is important to make sure
      // lowvalue is less than highvalue or this function returns erroneous
      // values", which is true: the two tests are made in order and never
      // compared with each other
      const v = int(a[0] ?? VI(0))
      const lo = int(a[1] ?? VI(0))
      const hi = int(a[2] ?? VI(0))
      if (v > hi) return VI(hi)
      if (v < lo) return VI(lo)
      return VI(v)
    },
    texp(_, a) {
      // x=Texp(ex, true val, false val). The test is against zero, so any
      // non-zero expression counts as true, not only -1.
      return VI(int(a[0] ?? VI(0)) !== 0 ? int(a[1] ?? VI(0)) : int(a[2] ?? VI(0)))
    },
    't clip'(_, a) {
      // "T Clip(var,32) will make var a multiple of 32... Print T Clip
      // (50,15) returns 45". divs.w then muls.w, so it truncates towards
      // zero rather than flooring: T Clip(-50,15) is -45.
      const v = int(a[0] ?? VI(0))
      const at = int(a[1] ?? VI(0))
      if (at <= 0) funcCall()
      return VI(Math.trunc(v / at) * at)
    },
    between(_, a) {
      // x=Between(low,value,high) — "If high is smaller than low, then these
      // values are exchanged so the function still works", and the
      // comparisons are strict: ((low<value) and (value<high))
      let lo = int(a[0] ?? VI(0))
      const v = int(a[1] ?? VI(0))
      let hi = int(a[2] ?? VI(0))
      if (hi <= lo) [lo, hi] = [hi, lo]
      return VI(v < hi && v > lo ? -1 : 0)
    },
    'bank end'(_, a) {
      // "If you ask for the Bank End of a Sprite or Icon bank the result
      // will be NEGATIVE. It gives the negative amount of Sprite/Icon
      // definitions stored in the bank." The routine tells them apart by
      // the four-character name in the bank header.
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
      // AvailMem(MEMF_CHIP|MEMF_LARGEST)
      return VI(rt.chipFree())
    },
    'fast largest'(_) {
      return VI(rt.fastFree())
    },
    'parse$'(_, a) {
      return VI(parseWord(str(a[0] ?? VS('')), int(a[1] ?? VI(0)), str(a[2] ?? VS('')), int(a[3] ?? VI(0))))
    },
    'hit spr zone'(_, a) {
      // "This command does the same thing as: A=Hzone(X Sprite(n)+dx,
      // Y Sprite(n)+dy)" — hardware coordinates, so a hardware zone lookup
      const [dx, dy, n] = [0, 1, 2].map((i) => int(a[i] ?? VI(0)))
      const spr = rt.hwSprites.get(n!)
      if (!spr) return VI(0)
      return VI(hardZoneAt(rt, spr.x + dx!, spr.y + dy!))
    },
    'hit bob zone'(_, a) {
      // "the same as: A=Zone(X Bob(n)+dx,Y Bob(n)+dy)" — screen coordinates
      const [dx, dy, n] = [0, 1, 2].map((i) => int(a[i] ?? VI(0)))
      const bob = rt.bobs.get(n!)
      if (!bob) return VI(0)
      return VI(rt.zoneAt(bob.x + dx!, bob.y + dy!))
    },
    'x icon'(_, a) {
      // "returns the width (in words) of a particular Icon" — words, not
      // pixels, because that is how the bank stores it
      const img = rt.iconBank?.image(int(a[0] ?? VI(0)))
      return VI(img ? img.width >> 4 : 0)
    },
    'y icon'(_, a) {
      // "returns the height (in lines)"
      return VI(rt.iconBank?.image(int(a[0] ?? VI(0)))?.height ?? 0)
    },
    'planes icon'(_, a) {
      // "how many planes the Icon is made of"
      return VI(rt.iconBank?.image(int(a[0] ?? VI(0)))?.depth ?? 0)
    },
    'icon check'(_, a) {
      // "-1 indicates that the Icon is defined, and it has NO MASK. 1
      // indicates that the Icon is defined, and it has a MASK. 0 indicates
      // that the Icon is NOT defined" — and with no bank at all, "in AMOSPro
      // you don't get an error, 0 is returned instead"
      const n = int(a[0] ?? VI(0))
      if (n <= 0) funcCall()
      const img = rt.iconBank?.image(n)
      if (!img) return VI(0)
      return VI(img.opaque ? -1 : 1)
    },
    'f sqr'(_, a) {
      // Undocumented; routine 65 is a digit-by-digit integer square root
      // over a long, rounding up when the remainder reaches the root
      return VI(turboSqrt(int(a[0] ?? VI(0)), 32))
    },
    'f point'(_, a) {
      // "returns the colour register of the pixel located on screen at
      // coordinates X,Y" — and, like AMOS's own Point, -1 off the screen
      return VI(rt.screen.point(int(a[0] ?? VI(0)), int(a[1] ?? VI(0))))
    },
    'hit spr check'(_, a) {
      // x=Hit Spr Check(start To end,dx,dy,n) — as above, for a sprite, and
      // the manual gives the displacement the other way round
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const spr = rt.hwSprites.get(n!)
      if (!spr) return VI(0)
      return VI(checkHit(rt, s!, e!, spr.x + dx!, spr.y + dy!))
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
      // -1 while the pending-load count is zero. With the loads done
      // synchronously the count is never anything else.
      return VI(-1)
    },
  } as Record<string, Func>
}

export type { Value }
