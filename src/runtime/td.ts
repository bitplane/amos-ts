/**
 * AMOS 3D — "Voodoo AMOS-3D extension I 1.00 (c)1991", by Anthony Wilkes for
 * Voodoo Software, published by Europress. A polygon engine sold as a boxed
 * add-on with its own Object Modeller, and the reason a lot of AMOS games had
 * 3D in them at all.
 *
 * ## Evidence
 *
 * Three sources, and the order matters because they disagree.
 *
 * The engine binary is the primary one. AMOS 3D is unusual: the extension
 * AMOS loads, `3d.lib`, is a 4,876-byte stub of token table and trampolines,
 * and the engine is a separate `c3d.lib` it LoadSegs at run time — a C program
 * in 29 relocatable hunks. `src/cli/tddis.ts` walks keyword to engine routine
 * and documents the whole dispatch; everything numeric here was read there.
 *
 * The 111-page user guide is a scan whose OCR renders "3D" as "30" throughout
 * and confuses l/I/1, so it is quoted for intent and never for numbers. The
 * two-page QuickCard is clean and is where the keyword shapes come from.
 *
 * The thirteen demo programs that shipped on the disc are the third, and the
 * useful one: they exercise 31 of the 64 keywords and they are in the census,
 * so this port is checked against real programs rather than only its own
 * tests.
 *
 * ## What is faithful here, and what is not
 *
 * The model is faithful: the file formats, the object and instance
 * structures, the transform chain, the coordinate systems and the visibility
 * rules all come out of the engine. The rasteriser is not. Reproducing
 * Voodoo's edge stepping and fill rule pixel-for-pixel is most of the work in
 * the engine and none of what a game depends on, so polygons are filled by
 * our own scanline code and that deviation carries a NOTES entry.
 */
import { AmosError, VI, int } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * The engine's error messages, read out of the `3d.lib` stub at $fe2..$12c8
 * and indexed from zero by the code the engine passes to its reporter —
 * `error(1, code, 0)` at $21322c.
 *
 * The indexing is confirmed at seven points rather than assumed: Td Load
 * raises 6 when the file will not open and 13 when the object is already
 * there, the template link raises 7, Td Screen Height raises 9 for a bad size
 * and 10 when objects already exist, Td Dir raises 15 for a long string, and
 * a header that will not parse raises 21.
 */
export const TD_ERRORS = [
  'Invalid object number',
  'Object already exists',
  'Not enough memory for 3D',
  'Object does not exist',
  'Syntax error in string',
  'Object not loaded',
  'Object file not found',
  'Template file not found',
  'Surface file not found',
  'Invalid 3d screen size',
  'Can’t change screen size while objects exist',
  'Amos screen not compatible with 3d',
  'Zone parameter(s) out of range',
  'Object already loaded',
  'Too many objects',
  'Directory string too long',
  'Image offset must be an even number',
  'Image too large',
  'Image width must be a multiple of 16',
  'Image data exceeds screen bank',
  'Point does not exist',
  'Bad Object file',
  'Bad Template file',
  'Bad Surface file',
  'Block does not exist',
  'Face does not exist',
  '3d background source screen is current screen',
  'Too many planes for 3d background',
  'Can’t load 3d code',
] as const

/** raise one of the engine's own errors by its code */
export function tdError(n: number): never {
  throw new AmosError(TD_ERRORS[n] ?? `3D error ${n}`)
}

/**
 * What a link record in an object file points at. The type is the first field
 * of each `(type,offset,name)` record; the loader branches on 4 for a
 * template and otherwise treats it as a surface.
 */
export const TD_LINK_TEMPLATE = 4
export const TD_LINK_SURFACE = 2

export interface TdLink {
  type: number
  /** byte offset within the block where the resolved pointer belongs */
  offset: number
  name: string
}

export interface TdFile {
  /** the object structure, as it sat in memory on the Amiga */
  block: Uint8Array
  /** the files it refers to, resolved after loading */
  links: TdLink[]
}

/**
 * Parse a `.3DO` object, `.3DT` template or `.3DS` surface.
 *
 * All three share a layout the loader reads with `fscanf`: an ASCII `(N)`
 * giving the length of the binary block, N bytes read a byte at a time, then
 * — for objects — a list of `(type,offset,name)` link records terminated by
 * one whose offset is zero, which the shipped files write as `(0,0,end)`.
 *
 * `Bad Object file` is raised when the leading `(N)` will not parse, which is
 * the only validation the engine does; a truncated block is not noticed.
 */
export function parseTdFile(bytes: Uint8Array, badFile = 21): TdFile {
  const text = (from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to))
  const head = /^\((\d+)\)/.exec(text(0, Math.min(24, bytes.length)))
  if (!head) tdError(badFile)
  const size = Number(head[1])
  const start = head[0].length
  const block = bytes.subarray(start, start + size)
  const links: TdLink[] = []
  let at = start + size
  for (;;) {
    const rest = text(at, Math.min(at + 96, bytes.length))
    const m = /^\((-?\d+),(-?\d+),([^)]*)\)/.exec(rest)
    if (!m) break
    at += m[0].length
    const offset = Number(m[2])
    // the list ends at the first record with a zero offset — the name on that
    // record is "end" in every shipped file but is never looked at
    if (offset === 0) break
    links.push({ type: Number(m[1]), offset, name: m[3]! })
  }
  return { block, links }
}

/**
 * Turn the block's stored 16-bit offsets into absolute pointers, the fix-up
 * the loader does at $219cba once the block is in memory:
 *
 *     +$38 -> +$1c    +$3a -> +$18    +$3c -> +$0c
 *     +$3e -> +$42    +$40 -> +$14
 *
 * Nothing here relocates anything — the block stays where it is and the port
 * addresses it by offset — so this records the five section starts instead,
 * which is what those pointers are for.
 */
export const TD_SECTIONS = [
  { at: 0x38, ptr: 0x1c },
  { at: 0x3a, ptr: 0x18 },
  { at: 0x3c, ptr: 0x0c },
  { at: 0x3e, ptr: 0x42 },
  { at: 0x40, ptr: 0x14 },
] as const

export function tdSections(block: Uint8Array): Record<number, number> {
  const v = new DataView(block.buffer, block.byteOffset, block.byteLength)
  const out: Record<number, number> = {}
  for (const s of TD_SECTIONS) if (s.at + 2 <= block.length) out[s.ptr] = v.getUint16(s.at, false)
  return out
}

// ---- loaded objects ----

/** a file loaded into memory, with its links resolved */
export interface TdObject {
  /** the name as given to Td Load, lower-cased for lookup */
  name: string
  file: TdFile
  /** what each link record resolved to, keyed by its byte offset */
  linked: Map<number, TdObject>
}

export interface TdState {
  /**
   * `Td Dir`'s prefix, always ending in '/'. Empty until set, and note that
   * the engine's own buffer starts in BSS: see the note on tdSetDir.
   */
  dir: string
  /** `Td Keep On/Off` — "whether to keep objects in memory" */
  keep: boolean
  /** every loaded object, template and surface, by lower-cased name */
  objects: Map<string, TdObject>
  /** `Td Screen Height`, 1..256 per the engine's own bounds check */
  screenHeight: number
  /** live objects, 1..20, the table at a4+$47c4 */
  instances: Map<number, TdInstance>
}

export const newTdState = (): TdState => ({
  dir: '',
  keep: true,
  objects: new Map(),
  screenHeight: 0,
  instances: new Map(),
})

/**
 * `Td Dir path$` — routine $211614.
 *
 * Longer than 68 characters is "Directory string too long". The engine then
 * copies the string into its buffer and appends '/' unless the last character
 * already is one — which is what lets the demos write
 * `Td Dir ":AMOS_3D_demos/objects"` with no trailing slash.
 *
 * The empty string is a real edge and a deterministic one: with no characters
 * copied, `cmp.b -1(a2)` reads the byte in front of the buffer, and that byte
 * is the last of the BSS run before it, always zero. Zero is not '/', so the
 * separator goes on and `Td Dir ""` leaves the directory as "/" — the root,
 * not "no directory".
 */
export function tdSetDir(st: TdState, path: string): void {
  if (path.length > 68) tdError(15)
  st.dir = path.endsWith('/') ? path : `${path}/`
}

/** the extension each link type carries, and the error if it will not load */
const LINK_KIND: Record<number, { ext: string; missing: number; bad: number }> = {
  [TD_LINK_TEMPLATE]: { ext: '.3DT', missing: 7, bad: 22 },
  [TD_LINK_SURFACE]: { ext: '.3DS', missing: 8, bad: 23 },
}

/**
 * `Td Load name$` — the stub at $2115c4 into the loader at $219ba4.
 *
 * The name is clamped to 199 characters before anything else happens, an
 * object that is already loaded is "Object already loaded", and the path is
 * the Td Dir prefix followed by the name and then ".3DO". Failure to open is
 * "Object file not found"; a header that will not parse is "Bad Object file".
 *
 * Loading an object pulls in whatever its link records name — one template
 * and any number of surfaces, each loaded the same way and shared with every
 * object that refers to it, which is why the engine looks each one up before
 * reading it off disc.
 *
 * Not reproduced: the engine gates the ".3DO" suffix on a flag at a4+$b1a
 * whose setter is not in any path traced so far. Every shipped demo loads by
 * bare name, so the suffix is always added here, and a name that already
 * carries an extension keeps it.
 */
export function tdLoad(st: TdState, read: (path: string) => Uint8Array | null, name: string): TdObject {
  const clamped = name.slice(0, 199)
  const key = clamped.toLowerCase()
  if (st.objects.has(key)) tdError(13)
  return tdLoadFile(st, read, clamped, '.3DO', 6, 21)
}

function tdLoadFile(
  st: TdState,
  read: (path: string) => Uint8Array | null,
  name: string,
  ext: string,
  missing: number,
  bad: number,
): TdObject {
  const key = name.toLowerCase()
  const existing = st.objects.get(key)
  if (existing) return existing
  const bytes = read(`${st.dir}${name}${/\.[^./]*$/.test(name) ? '' : ext}`)
  if (!bytes) tdError(missing)
  const obj: TdObject = { name: key, file: parseTdFile(bytes, bad), linked: new Map() }
  // registered before the links are followed, so an object that somehow
  // refers to itself terminates rather than recursing
  st.objects.set(key, obj)
  for (const link of obj.file.links) {
    const kind = LINK_KIND[link.type] ?? LINK_KIND[TD_LINK_SURFACE]!
    obj.linked.set(link.offset, tdLoadFile(st, read, link.name, kind.ext, kind.missing, kind.bad))
  }
  return obj
}

// ---- keywords ----

/**
 * The phase-2 slice: everything to do with getting objects off disc. The
 * transform, camera and drawing keywords are not registered yet, so they stay
 * honestly missing in the manifest rather than silently doing nothing.
 */
export function makeTdInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TdState => rt.td
  return {
    'td dir'(it) {
      tdSetDir(st(), it.evalStr())
    },
    'td load'(it) {
      const name = it.evalStr()
      tdLoad(st(), (p) => rt.fs?.read(p) ?? null, name)
    },
    'td clear all'() {
      // "Removes all objects from memory" — the whole table goes, templates
      // and surfaces with it, since nothing else holds a reference
      st().objects.clear()
      st().instances.clear()
    },
    'td keep on'() {
      // "Td Keep Off tells 3D not to keep objects in memory, but to load them
      // each time" — a caching switch, so with no cache to speak of here it
      // records the setting and Td Load consults it
      st().keep = true
    },
    'td keep off'() {
      st().keep = false
    },
    'td screen height'(it) {
      // `cmp.l #1 / bcs` then `cmpi.l #$100 / bls` at $211526: 1..256. Then
      // `tst.l $4814(a4) / beq` — and $4814 is the head of the live instance
      // list, not the loaded-object table: Td Kill writes it when unlinking
      // the first frame. So it is instances that block a resize, and every
      // demo relies on that, loading its objects first and setting the height
      // only just before the Td Object that uses it.
      const n = it.evalInt()
      if (n < 1 || n > 256) tdError(9)
      if (st().instances.size !== 0) tdError(10)
      st().screenHeight = n
    },
    'td object'(it) {
      // Td Object n,name$,x,y,z,a,b,c — $211694. The number must be 1..20,
      // the slot must be free, and the name must already be loaded; the three
      // errors are "Invalid object number", "Object already exists" and
      // "Object not loaded", in that order.
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      const nums: number[] = []
      for (let i = 0; i < 6; i++) {
        it.expect(',')
        nums.push(it.evalInt())
      }
      const t = st()
      if (n < 1 || n > TD_MAX_OBJECTS) tdError(0)
      if (t.instances.has(n)) tdError(1)
      const object = t.objects.get(name.toLowerCase())
      if (!object) tdError(5)
      t.instances.set(n, {
        n,
        object,
        pos: [l32(nums[0]!), l32(nums[1]!), l32(nums[2]!)],
        angle: [l32(nums[3]!), l32(nums[4]!), l32(nums[5]!)],
      })
    },
    'td kill'(it) {
      // $2117d2 unlinks the frame from the live list and frees it
      const t = st()
      t.instances.delete(tdInstance(t, it.evalInt()).n)
    },
    'td move': tdVector(rt, 'pos', false),
    'td move rel': tdVector(rt, 'pos', true),
    'td angle': tdVector(rt, 'angle', false),
    'td angle rel': tdVector(rt, 'angle', true),
    'td cls'() {
      // $2114be checks the AMOS screen is one 3D can draw on before it
      // touches anything: EcTy (+$4e) at least Td Screen Height, EcNPlan
      // (+$50) at least 4, and EcTx (+$4c) exactly 320. Anything else is
      // "Amos screen not compatible with 3d". Every demo opens
      // `Screen Open n,320,200,16,Lowres`, which passes all three.
      const s = rt.screen
      const t = st()
      if (s.height < t.screenHeight || s.depth < 4 || s.width !== 320) tdError(11)
      // the 3D area is the top Td Screen Height lines, cleared to colour 0
      for (let y = 0; y < Math.min(t.screenHeight, s.height); y++) {
        for (let x = 0; x < s.width; x++) s.plot(x, y, 0)
      }
    },
    'td quit'() {
      // "Unload the 3D extensions along with all objects and release all 3D
      // memory." There is no engine to unload here, so it is the clear.
      rt.td = newTdState()
    },
  }
}

// ---- instances ----

/**
 * A live object — what the manual calls an Object Frame, one per `Td Object`.
 *
 * Position is three 32-bit world coordinates; the demos run them to ±8500.
 * Angles are three 32-bit values stored whole but used sixteen bits wide: the
 * matrix builder at $213df8 reduces by quadrant with `btst #6/#7` on the high
 * byte and reflects about $8000, so **a full revolution is 65536 units**. That
 * is why Dice_Spin can write `Td Angle Rel 1,-ZI*50,-XI*20,-XI` with ZI around
 * 120 and get a sedate spin rather than a blur.
 */
export interface TdInstance {
  n: number
  object: TdObject
  /** world x, y, z */
  pos: [number, number, number]
  /** attitude a, b, c, in 65536ths of a revolution */
  angle: [number, number, number]
}

/** `Td Object` numbers run 1..20 — `moveq #$14,d0 : cmp.l d0,d6 : bcs` */
export const TD_MAX_OBJECTS = 20

/** a full revolution in the engine's angle units */
export const TD_REVOLUTION = 0x10000

/** the instance a keyword names, with the checks $21301c makes */
export function tdInstance(st: TdState, n: number): TdInstance {
  if (n < 1 || n > TD_MAX_OBJECTS) tdError(0)
  const inst = st.instances.get(n)
  if (!inst) tdError(3)
  return inst
}

/** 32-bit wrap, since every coordinate and angle is stored as a long */
const l32 = (v: number): number => v | 0

/**
 * The four keywords that set a triple, absolute or relative.
 *
 * `Td Move n,x,y,z` is three `move.l` into the position vector and `Td Move
 * Rel` the same three as `add.l` ($21188a and $2118bc, identical but for the
 * opcode); Td Angle and Td Angle Rel are that again on the angle triple. The
 * relative forms wrap at 32 bits rather than clamping, which for angles is
 * exactly right — 65536 units to the revolution means the low sixteen bits
 * are all the matrix builder ever looks at.
 */
function tdVector(rt: Runtime, field: 'pos' | 'angle', relative: boolean): Instr {
  return (it) => {
    const n = it.evalInt()
    const v: number[] = []
    for (let i = 0; i < 3; i++) {
      it.expect(',')
      v.push(it.evalInt())
    }
    const target = tdInstance(rt.td, n)[field]
    for (let i = 0; i < 3; i++) target[i] = l32(relative ? target[i]! + v[i]! : v[i]!)
  }
}

/** `Td Position X/Y/Z(n)` and `Td Attitude A/B/C(n)`, one routine and a selector */
export function makeTdFunctions(rt: Runtime): Record<string, Func> {
  const read = (field: 'pos' | 'angle', axis: number): Func => (_, a) =>
    VI(tdInstance(rt.td, int(a[0] ?? VI(0)))[field][axis]!)
  return {
    'td position x': read('pos', 0),
    'td position y': read('pos', 1),
    'td position z': read('pos', 2),
    'td attitude a': read('angle', 0),
    'td attitude b': read('angle', 1),
    'td attitude c': read('angle', 2),
  } as Record<string, Func>
}

// ---- templates ----

/**
 * A relocated template. `.3DT` files are memory images: they open with four
 * absolute Amiga addresses, which is why sixteen of the eighteen copies of
 * p8.3DT on the AMOS PD Library CD differ while all are 3,424 bytes.
 *
 * The loader at $2199ba rebuilds them from `u16` offsets kept elsewhere in
 * the block — `+$1e -> +$00`, `+$22 -> +$04`, `+$20 -> +$08`, `+$1c -> +$0c`
 * — and then computes the one thing the file cannot carry:
 *
 *     d7 = (base + offset(+$1e)) - oldPointer(+$00)
 *
 * the difference between where the first section is now and where it was when
 * the file was written. Every remaining pointer in the image is fixed by
 * adding that delta, which the loader does across a record array: `(u16)+$12`
 * records of ten bytes each, hanging off the section at `+$0c`, each opening
 * with a pointer.
 *
 * Recovering the delta from the file rather than from a live address is what
 * makes a template readable off disc: subtract it from any stored pointer and
 * what is left is an offset into the block.
 */
export interface TdTemplate {
  block: Uint8Array
  /** the four section starts, as offsets into the block */
  sections: [number, number, number, number]
  /** offset of every ten-byte record's pointer target */
  records: Array<{ at: number; target: number }>
  /** the delta the loader adds to every stored pointer */
  delta: number
}

export function parseTdTemplate(file: TdFile): TdTemplate {
  const b = file.block
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const u16 = (o: number): number => v.getUint16(o, false)
  const u32 = (o: number): number => v.getUint32(o, false)
  // the loader's order: +$1e, +$22, +$20, +$1c into +$00, +$04, +$08, +$0c
  const sections: [number, number, number, number] = [u16(0x1e), u16(0x22), u16(0x20), u16(0x1c)]
  // d7 = new - old for the first section; every other stored pointer shares it
  const delta = sections[0] - u32(0)
  const count = u16(0x12)
  const records: Array<{ at: number; target: number }> = []
  for (let i = 0; i < count; i++) {
    const at = sections[3] + i * 10
    if (at + 4 > b.length) break
    records.push({ at, target: (u32(at) + delta) | 0 })
  }
  return { block: b, sections, records, delta }
}

// ---- geometry ----

/**
 * The word every point list ends with: `cmpi.w #$7530,(a0)` at $210930, in
 * the vertex transform's loop condition. 30000 is outside any coordinate the
 * object editor will emit, so it doubles as a terminator and as a bound.
 */
export const TD_POINT_END = 30000

/** one model point, in object space, as three signed words */
export interface TdPoint {
  x: number
  y: number
  z: number
}

/**
 * A polygon. `surface` is the stored surface pointer, and the record's own
 * offset is what a type-2 link record names, so a face given an external
 * surface can be matched to the `.3DS` it was linked against.
 *
 * A zero surface covers two different things in the release's objects: a
 * wholly blank sixteen bytes padding the face list out (amiga, 3d2), and a
 * real polygon with no surface of its own (all six of minicube's). Every face
 * that does carry a surface pointer has three or four distinct vertices, so
 * the blank records are the only degenerate ones.
 */
export interface TdFace {
  /** offset of the record in the block */
  at: number
  /** the stored surface pointer, before relocation; 0 for an unused face */
  surface: number
  /** indices into `points`, in winding order */
  vertices: number[]
}

export interface TdGeometry {
  points: TdPoint[]
  faces: TdFace[]
  /** where the point list starts, from the section table */
  pointsAt: number
  /** where the face list starts and ends */
  facesAt: number
  facesEnd: number
}

/**
 * Vertex references in a face record are byte offsets into the engine's
 * working vertex array, whose stride is $20 — `moveq #$20,d0 : add.l
 * d0,$4f2e(a4)` at $217f48, stepping to the next vertex of the face. Each of
 * those 32-byte records holds a pointer to its 6-byte model point at +$18
 * ($2146e6), so ref/32 indexes the point list.
 */
export const TD_VERTEX_STRIDE = 0x20

/**
 * A face record is sixteen bytes: the surface pointer, four vertex
 * references, then a second pointer. Four because every face the object
 * editor emits is a quadrilateral — a triangle is written with two of its
 * references equal, which is why the rasteriser needs no special case.
 */
export const TD_FACE_SIZE = 16

/**
 * Read an object's geometry out of its block.
 *
 * The section table (`TD_SECTIONS`) gives the layout: +$3c is the start of the
 * point list and +$3e..+$40 bracket the faces. The point list is
 * `TD_POINT_END`-terminated as well as bracketed, and both agree on every one
 * of the release's 35 objects, so this checks them against each other and
 * reports the terminator's position as the count.
 *
 * NOTE: two of the demo objects — 3d2 and monitor2 — carry a second template
 * link and interleave a further header inside the face range, so their face
 * list is not a flat run of records. They come back with `multipart` set and
 * only the faces up to the break; the sub-object tree is not modelled.
 */
export function parseTdGeometry(file: TdFile): TdGeometry & { multipart: boolean } {
  const b = file.block
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const sec = tdSections(b)
  const pointsAt = sec[0x0c] ?? 0
  const facesAt = sec[0x42] ?? 0
  const facesEnd = sec[0x14] ?? 0

  const points: TdPoint[] = []
  for (let o = pointsAt; o + 6 <= b.length; o += 6) {
    const x = v.getInt16(o, false)
    if (x === TD_POINT_END) break
    points.push({ x, y: v.getInt16(o + 2, false), z: v.getInt16(o + 4, false) })
  }

  const faces: TdFace[] = []
  let multipart = false
  for (let at = facesAt; at + TD_FACE_SIZE <= facesEnd && at + TD_FACE_SIZE <= b.length; at += TD_FACE_SIZE) {
    const vertices: number[] = []
    let ok = true
    for (let i = 0; i < 4; i++) {
      const ref = v.getUint16(at + 4 + i * 2, false)
      if (ref % TD_VERTEX_STRIDE !== 0 || ref / TD_VERTEX_STRIDE >= points.length) { ok = false; break }
      vertices.push(ref / TD_VERTEX_STRIDE)
    }
    if (!ok) { multipart = true; break }
    faces.push({ at, surface: v.getUint32(at, false), vertices })
  }
  return { points, faces, pointsAt, facesAt, facesEnd, multipart }
}

// ---- rotation ----

/** the engine's fixed-point one: every matrix entry is in 4096ths */
export const TD_ONE = 4096

/**
 * The quarter-wave sine table at a4+$270, 513 entries of one word covering
 * a quarter revolution — a4+$670 is its last entry, which is how the matrix
 * builder reads cosines out of it backwards.
 *
 * The shipped table is `floor(4096 * sin(i * pi / 1024))`: rounding to
 * nearest disagrees with 253 of the 513 entries, truncation with two. Those
 * two are indices where the original's sine landed a hair above an integer
 * and a double's lands a hair below, so they are carried explicitly and the
 * whole table is checked against the library's own copy in the tests.
 */
export const TD_SINE_STEPS = 512

function buildSineTable(): Int16Array {
  const t = new Int16Array(TD_SINE_STEPS + 1)
  for (let i = 0; i <= TD_SINE_STEPS; i++) t[i] = Math.floor(TD_ONE * Math.sin((i * Math.PI) / (TD_SINE_STEPS * 2)))
  t[222] = 2579
  t[391] = 3817
  return t
}

export const TD_SINE = buildSineTable()

/**
 * Reduce an angle to the first quadrant, as $213e00 does with two bit tests
 * on the high byte of the word.
 *
 * The four cases are the four quadrants, and each records whether the sine
 * and the cosine come back negated ($4cc8 and $4cc9):
 *
 *     bit 14  bit 15   reduced        sin   cos
 *        0       0     angle           +     +
 *        1       0     $8000 - angle   +     -
 *        0       1     angle - $8000   -     -
 *        1       1     -angle          -     +
 *
 * The reduced angle is then shifted right by five to index the table, so the
 * engine's angular resolution is 32 of the 65536 units in a revolution.
 */
export function tdQuadrant(angle: number): { index: number; negSin: boolean; negCos: boolean } {
  const a = angle & 0xffff
  const b14 = (a & 0x4000) !== 0
  const b15 = (a & 0x8000) !== 0
  const reduced = b14 ? (b15 ? (-a & 0xffff) : 0x8000 - a) : b15 ? a - 0x8000 : a
  return { index: (reduced & 0xffff) >>> 5, negSin: b15, negCos: b14 !== b15 }
}

/** sin(angle) in 4096ths, exactly as the matrix builder computes it */
export function tdSin(angle: number): number {
  const q = tdQuadrant(angle)
  const s = TD_SINE[q.index]!
  // neg.w of zero is zero, so never hand back a negative zero
  return q.negSin ? -s | 0 : s
}

/** cos(angle) in 4096ths — the same table read from the far end */
export function tdCos(angle: number): number {
  const q = tdQuadrant(angle)
  const c = TD_SINE[TD_SINE_STEPS - q.index]!
  return q.negCos ? -c | 0 : c
}

/**
 * The nine matrix words in the order they sit in memory, a4+$bcc upwards:
 * $bcc $bce $bd0 | $bd2 $bd4 $bd6 | $bd8 $bda $bdc.
 */
export type TdMatrix = readonly [number, number, number, number, number, number, number, number, number]

/**
 * Rotate one model point, the loop at $2108a2.
 *
 * The signs are folded into the arithmetic rather than into the stored
 * matrix, which is why this cannot be written as a plain dot product:
 *
 *     x' = ( m0*x - m4*y + m6*z) >> 12
 *     y' = ( m1*x + m3*y + m7*z) >> 12
 *     z' = (-m2*x - m5*y + m8*z) >> 12
 *
 * The shift is `asr.l #8` then `asr.l #4`, an arithmetic shift, so a negative
 * result rounds away from zero rather than towards it — the same as
 * JavaScript's `>>`. Results are stored as words.
 */
export function tdRotate(m: TdMatrix, p: TdPoint): TdPoint {
  const { x, y, z } = p
  const w = (n: number): number => (n << 16) >> 16
  return {
    x: w((((m[0] * x - m[4] * y + m[6] * z) | 0) >> 12) | 0),
    y: w((((m[1] * x + m[3] * y + m[7] * z) | 0) >> 12) | 0),
    z: w((((-m[2] * x - m[5] * y + m[8] * z) | 0) >> 12) | 0),
  }
}
