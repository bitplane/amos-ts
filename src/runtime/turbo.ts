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
import { AmosError, VI, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import type { Runtime } from './runtime'

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
const funcCall = (): never => {
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

export interface TurboState {
  /**
   * Check zones, TURBO's replacement for AMOS's Zone commands. "These
   * commands are not compatible with the normal Zone commands!"
   */
  checks: CheckZone[]
  /** vector objects — `Object Limit` through `Object Load` */
  objects: TurboObjects
  /**
   * The task priority Multi No / Multi Yes / Amos Pri set. There is no
   * scheduler here to apply it to; it is kept so a program that reads it
   * back sees what it wrote.
   */
  priority: number
}

export const newTurboState = (): TurboState => ({
  checks: [],
  objects: { limit: 0, els: [], counts: [] },
  priority: 0,
})

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
    'hit spr check'(_, a) {
      // x=Hit Spr Check(start To end,dx,dy,n) — as above, for a sprite, and
      // the manual gives the displacement the other way round
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const spr = rt.hwSprites.get(n!)
      if (!spr) return VI(0)
      return VI(checkHit(rt, s!, e!, spr.x + dx!, spr.y + dy!))
    },
  } as Record<string, Func>
}

export type { Value }
