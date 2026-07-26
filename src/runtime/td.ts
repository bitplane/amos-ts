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
