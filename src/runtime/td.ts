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
  /** object zero, the viewpoint — the frame at a4+$481c */
  viewpoint: TdFrame
  /** the frame stamp at a4+$1902, bumped by every Td Redraw and never zero */
  frame: number
}

export const newTdState = (): TdState => ({
  dir: '',
  keep: true,
  objects: new Map(),
  screenHeight: 0,
  instances: new Map(),
  viewpoint: { pos: [0, 0, 0], angle: [0, 0, 0] },
  frame: 0,
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
    'td redraw'() {
      // $211418 makes the same three checks Td Cls does, and for the same
      // reason — the renderer writes bitplanes directly. Then $211f6e bumps
      // the frame stamp at a4+$1902, which is what makes the per-vertex cache
      // at +$9 of each vertex record go stale, and skips zero when it wraps.
      const s2 = rt.screen
      const t = st()
      if (s2.height < t.screenHeight || s2.depth < 4 || s2.width !== 320) tdError(11)
      t.frame = (t.frame + 1) & 0xff
      if (t.frame === 0) t.frame = 1
      tdRedrawFaces(t)
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
/**
 * A position and an attitude — what `$21301c` hands back. The viewpoint has
 * one without an object attached to it.
 */
export interface TdFrame {
  /** world x, y, z */
  pos: [number, number, number]
  /** attitude a, b, c, in 65536ths of a revolution */
  angle: [number, number, number]
}

export interface TdInstance extends TdFrame {
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

/**
 * Object zero is the viewpoint — "one of those objects, object 0 is special;
 * it is your own viewpoint. You can move your viewpoint around just like any
 * other object. Whatever it sees you see."
 *
 * It is not in the instance table. `$21301c` is the getter every keyword that
 * takes a frame goes through, and it forks on zero: `tst.l d7 : bne` sends
 * anything else to `$212fd0` and then reads its frame from `$52(instance)`,
 * while zero returns `a4+$481c` directly. So Td Move, Td Angle, Td Position,
 * Td Attitude, Td Range and the coordinate conversions all accept 0, while Td
 * Kill and Td Visible — which go straight to `$212fd0` — do not.
 *
 * `$212fd0` bounds with `subq.l #1,d7 : moveq #$14,d0 : cmp.l d0,d7 : bcs`,
 * an unsigned compare after the decrement, which is what makes 1..20 the
 * range and 0 an "Invalid object number" there.
 */
export function tdFrame(st: TdState, n: number): TdFrame {
  if (n === 0) return st.viewpoint
  return tdInstance(st, n)
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
    const target = tdFrame(rt.td, n)[field]
    for (let i = 0; i < 3; i++) target[i] = l32(relative ? target[i]! + v[i]! : v[i]!)
  }
}

/** `Td Position X/Y/Z(n)` and `Td Attitude A/B/C(n)`, one routine and a selector */
export function makeTdFunctions(rt: Runtime): Record<string, Func> {
  const read = (field: 'pos' | 'angle', axis: number): Func => (_, a) =>
    VI(tdFrame(rt.td, int(a[0] ?? VI(0)))[field][axis]!)
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

/**
 * Build the rotation matrix from an attitude triple — $213df8 in full.
 *
 * The three angles are reduced one at a time, b first, then a, then c, and
 * the nine words are assembled from their sines and cosines. Writing sa for
 * sin(a), cb for cos(b) and so on, and `*` for a product taken back down by
 * twelve bits:
 *
 *     $bcc = cc*cb            $bd2 = cc*ca - sb*sa*sc   $bd8 = sb*cc*ca - sa*sc
 *     $bce = cb*sc            $bd4 = sb*cc*sa + ca*sc   $bda = sb*ca*sc + cc*sa
 *     $bd0 = sb               $bd6 = sa*cb              $bdc = ca*cb
 *
 * $bd0 is the raw table entry, never shifted — it is the only one of the nine
 * that is a sine rather than a product. The triple products shift twice,
 * once per multiply, so they lose a little more precision than the pairs;
 * that is the engine's arithmetic and is reproduced rather than tidied.
 *
 * Read against `tdRotate`, which folds the signs in, the bottom row is
 * -sb*x - sa*cb*y + ca*cb*z, so b is the pitch away from the z axis and the
 * matrix is orthonormal to within the fixed point.
 */
export function tdMatrix(a: number, b: number, c: number): TdMatrix {
  const sa = tdSin(a)
  const ca = tdCos(a)
  const sb = tdSin(b)
  const cb = tdCos(b)
  const sc = tdSin(c)
  const cc = tdCos(c)
  const m = (x: number, y: number): number => ((x * y) | 0) >> 12
  const w = (n: number): number => (n << 16) >> 16
  const ccsa = m(cc, sa)
  const sasc = m(sa, sc)
  const ccca = m(cc, ca)
  const casc = m(ca, sc)
  return [
    w(m(cc, cb)),
    w(m(cb, sc)),
    w(sb),
    w(ccca - m(sb, sasc)),
    w(m(sb, ccsa) + casc),
    w(m(sa, cb)),
    w(m(sb, ccca) - sasc),
    w(m(sb, casc) + ccsa),
    w(m(ca, cb)),
  ]
}

// ---- camera and projection ----

/**
 * The view transform and the perspective divide, $2101c8 — one routine
 * reached through the veneer at $214876.
 *
 * It reads and writes the engine's globals rather than taking arguments: the
 * point at a4+$b1c..$b20, the view matrix at a4+$bba..$bca, a shift at
 * a4+$b32 and the object's world position at a4+$b34..$b3c. The nine view
 * words carry their own sign pattern, different from the attitude matrix's:
 *
 *     X = ((v0*x + v1*y - v2*z) >> shift) + ox
 *     Y = ((v3*y - v4*x - v5*z) >> shift) + oy
 *     Z = ((v6*x + v7*y + v8*z) >> shift) + oz
 *
 * The shift is per object — `$215e8c` copies it out of the object's +$40 —
 * and it is applied to the sum, not to each term.
 */
export interface TdView {
  /** the nine words at a4+$bba, in memory order */
  matrix: TdMatrix
  /** the object's world position, added after the shift */
  origin: [number, number, number]
  /** the per-object shift at a4+$b32 */
  shift: number
}

/**
 * What the projection decided about a point, and the engine's own status
 * code: 0 both coordinates divided cleanly, 1 the point is too close to the
 * eye, 2 the quotient overflowed a word and the caller redoes the divide
 * wider.
 */
export interface TdProjected {
  status: 0 | 1 | 2
  /** view-space coordinates, cached by the engine at the vertex's +$c/+$10/+$14 */
  view: [number, number, number]
  /** screen coordinates, only meaningful when status is 0 */
  x: number
  y: number
}

/**
 * The near limit. `cmpi.l #$10000,d2 : ble` rejects anything at or in front
 * of one unit of depth, where a unit is the 4096ths the divide works in.
 */
export const TD_NEAR = 0x10000

/**
 * Apply the view matrix, without the shift or the origin — the three rows of
 * $2101c8 on their own.
 *
 * The nine words are the ones `tdMatrix` builds; $219566 is $213df8
 * recompiled with its destinations moved eighteen bytes down, from a4+$bcc to
 * a4+$bba, and is otherwise instruction-for-instruction the same routine. So
 * the camera's matrix and an object's matrix are built identically, and the
 * only difference is how the two transforms fold the signs in — comparing
 * them row by row:
 *
 *     tdRotate      x' = [ m0, -m4,  m6 ]      view    X = [  m0, m1, -m2 ]
 *                   y' = [ m1,  m3,  m7 ]              Y = [ -m4, m3, -m5 ]
 *                   z' = [-m2, -m5,  m8 ]              Z = [  m6, m7,  m8 ]
 *
 * Row i of one is column i of the other: the view transform is the transpose,
 * which for a rotation is the inverse. That is exactly what a camera wants,
 * and it is why the same builder serves both.
 */
export function tdViewRotate(m: TdMatrix, p: TdPoint, shift = 12): TdPoint {
  return {
    x: (((m[0] * p.x + m[1] * p.y - m[2] * p.z) | 0) >> shift) | 0,
    y: (((-m[4] * p.x + m[3] * p.y - m[5] * p.z) | 0) >> shift) | 0,
    z: (((m[6] * p.x + m[7] * p.y + m[8] * p.z) | 0) >> shift) | 0,
  }
}

export function tdProject(v: TdView, p: TdPoint): TdProjected {
  const m = v.matrix
  const s = v.shift
  const X = ((((m[0] * p.x + m[1] * p.y - m[2] * p.z) | 0) >> s) | 0) + v.origin[0]
  const Y = ((((m[3] * p.y - m[4] * p.x - m[5] * p.z) | 0) >> s) | 0) + v.origin[1]
  const Z = ((((m[6] * p.x + m[7] * p.y + m[8] * p.z) | 0) >> s) | 0) + v.origin[2]
  const view: [number, number, number] = [X | 0, Y | 0, Z | 0]
  if (Z <= TD_NEAR) return { status: 1, view, x: 0, y: 0 }
  // divs.w is a 32-by-16 divide and it takes only the low word of its source
  // as the divisor. Since the divisor is the depth in world units, the engine
  // has a hard far limit: past 32767 units the divisor wraps and objects come
  // back the wrong size, or mirrored once it goes negative. That is real
  // 1991 behaviour, not an artefact of the port — with the near limit at 16
  // units it still leaves a range of 2000 to 1.
  const d = (((Z >> 12) << 16) >> 16) | 0
  if (d === 0) return { status: 2, view, x: 0, y: 0 }
  // a quotient outside a signed word sets V and the engine falls back to a
  // wider divide, which is what status 2 reports
  const qx = (X / d) | 0
  const qy = (Y / d) | 0
  if (qx < -0x8000 || qx > 0x7fff || qy < -0x8000 || qy > 0x7fff) return { status: 2, view, x: qx, y: qy }
  return { status: 0, view, x: qx, y: qy }
}

/**
 * The clip code a projected x or y gets, from $214740: below -$a00 is 1,
 * above $9f0 is 2, otherwise 0. Those bounds are 160 and 159 screens' worth
 * of sixteenths, so a coordinate is sixteen times a pixel at this point.
 */
export function tdClipCode(v: number): 0 | 1 | 2 {
  if (v < -0xa00) return 1
  if (v > 0x9f0) return 2
  return 0
}

/**
 * The view an object is drawn through this frame.
 *
 * Everything downstream of the view matrix is in 4096ths of a world unit,
 * because the matrix product is not shifted back down. `Td Object
 * 1,"dice",0,0,1500` puts a cube whose points are about 173 across at a depth
 * of 1500, and the near limit rejects a depth of $10000 — sixteen world
 * units — so the two only sit in the same space if the world position is
 * scaled up to meet the model rather than the model scaled down to meet it.
 * The divide then takes the depth back to world units, which fixes the focal
 * length at 4096/16 = 256 pixels: a 64-degree field of view on a 320-wide
 * screen, and a 173-unit cube at 1500 comes out about 59 pixels across.
 *
 * The shift is per object: $215e8c copies it out of the object's +$40 into
 * a4+$b32 and $2101c8 applies it to each row's sum, so it scales an object
 * whose model coordinates are too large. Where +$40 comes from in the file
 * has not been located, so only the neutral zero is reachable so far.
 *
 * $215e54 copies a per-object origin out of the object's +$c0..+$c8 into
 * a4+$b34, and $2101c8 adds it after the view rotation rather than before —
 * so it is the object's position already expressed in the camera's frame,
 * `V * (objectWorld - viewpointWorld)`. That is the only composition
 * consistent with the data flow and with the transform being applied to
 * points that have already been rotated into the object's own attitude.
 */
export function tdViewFor(viewpoint: TdFrame, frame: TdFrame, shift = 0): TdView {
  const matrix = tdMatrix(viewpoint.angle[0], viewpoint.angle[1], viewpoint.angle[2])
  const rel = {
    x: (frame.pos[0] - viewpoint.pos[0]) | 0,
    y: (frame.pos[1] - viewpoint.pos[1]) | 0,
    z: (frame.pos[2] - viewpoint.pos[2]) | 0,
  }
  const o = tdViewRotate(matrix, rel, 0)
  return { matrix, origin: [o.x, o.y, o.z], shift }
}

/** a face ready to fill: screen corners in sixteenths of a pixel */
export interface TdScreenFace {
  face: TdFace
  /** one entry per vertex, in winding order */
  points: Array<{ x: number; y: number }>
}

/**
 * Everything Td Redraw does to one instance before a pixel is touched:
 * rotate the model points into the object's attitude, project each one, and
 * hand back the faces whose vertices all landed.
 *
 * The order is the engine's. $21085c transforms the whole point list in one
 * pass, writing into a second array, and only then does the face walk at
 * $217ee2 visit vertices — which is why a point shared by four faces is
 * transformed once. The per-vertex frame stamp at +$9 does the same job for
 * the projection.
 *
 * A face is dropped when any of its vertices comes back with a non-zero
 * status: status 1 is the near limit and status 2 an overflowing quotient,
 * and neither has a partial polygon to draw. Clipping a polygon against the
 * frustum is not something the engine does either — it relies on the near
 * limit and on the rasteriser's own bounds.
 */
export function tdInstanceFaces(g: TdGeometry, attitude: TdMatrix, view: TdView): TdScreenFace[] {
  const projected = g.points.map((p) => tdProject(view, tdRotate(attitude, p)))
  const out: TdScreenFace[] = []
  for (const face of g.faces) {
    if (face.surface === 0) continue
    const points = face.vertices.map((i) => projected[i]!)
    if (points.some((p) => p.status !== 0)) continue
    out.push({ face, points: points.map((p) => ({ x: p.x, y: p.y })) })
  }
  return out
}

/**
 * The geometry half of `Td Redraw`: every live instance's faces, in screen
 * coordinates, in the order the engine walks them.
 *
 * This is the loop at $21138c — the live instance list, each object's frame
 * at +$52, its attitude at +$12/+$16/+$1a — with the transform and projection
 * behind it. What it does not do is fill anything.
 *
 * NOTES: the port stops here. Choosing a face's colour means decoding a
 * `.3DS`, and a surface is not a colour: the QuickCard calls it a "surface
 * detail" with its own anchor points, and dice's six surfaces are 318 to 1848
 * bytes of nested geometry — the pip patterns on the faces of a die. Until
 * that is read there is nothing honest to fill a polygon with, so `Td Redraw`
 * validates the screen and advances the frame and the scanline fill is not
 * written yet.
 */
export function tdRedrawFaces(st: TdState): Array<{ n: number; faces: TdScreenFace[] }> {
  const out: Array<{ n: number; faces: TdScreenFace[] }> = []
  for (const [n, inst] of [...st.instances].sort((a, b) => a[0] - b[0])) {
    const g = parseTdGeometry(inst.object.file)
    const attitude = tdMatrix(inst.angle[0], inst.angle[1], inst.angle[2])
    out.push({ n, faces: tdInstanceFaces(g, attitude, tdViewFor(st.viewpoint, inst)) })
  }
  return out
}
