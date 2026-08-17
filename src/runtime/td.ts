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
 * The 111-page user guide (`AMOS_3D_User_Guide.ocr.txt`) is a scan whose OCR
 * renders "3D" as "30" throughout and confuses l/I/1, so it is quoted for
 * intent and never for numbers. The two-page QuickCard
 * (`AMOS_3D_QuickCard.txt`) is clean and is where the keyword shapes come
 * from.
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
import { RastPort } from '../amiga/graphics'
import { parseStosMove } from './instr'
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
  /**
   * One dither pair per block, the array the loader allocates at $2109c0 and
   * hangs off the object record's +$10. Empty for templates and surfaces.
   */
  colours: TdDither[]
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
  /**
   * The last bearing worked out, at a4+$149c/$149e/$14a0 with its prescale
   * shift at a4+$14a4. It survives between calls on purpose: the no-argument
   * forms read it, and the core's two bail-outs leave it alone.
   */
  bearing: TdBearing
  /** the last `Td World X/Y/Z`, at a4+$1c/$20/$24, read by the no-argument form */
  world: [number, number, number]
  /** the last `Td View X/Y/Z`, at a4+$28/$2c/$30 */
  view: [number, number, number]
  /**
   * The last `Td Screen X/Y`, in sixteenths of a pixel, and whether it was in
   * front of the viewpoint at all. The engine keeps the view-space triple at
   * a4+$c/$10/$14 and divides again on every read — $21263c re-checks the
   * near limit and re-divides for the no-argument form — so what is cached is
   * the projection, not the pixel.
   */
  screen: { x: number; y: number; ok: boolean }
  /** `Td Surface Points`, the four bytes at a4+$486f and the flag at a4+$4873 */
  surfacePoints: [number, number, number, number] | null
}

export const newTdState = (): TdState => ({
  dir: '',
  keep: true,
  objects: new Map(),
  screenHeight: 0,
  instances: new Map(),
  viewpoint: { pos: [0, 0, 0], angle: [0, 0, 0] },
  frame: 0,
  bearing: { a: 0, b: 0, r: 0, shift: 0 },
  world: [0, 0, 0],
  view: [0, 0, 0],
  screen: { x: 0, y: 0, ok: false },
  surfacePoints: null,
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
 * DEVIATION: the engine gates the ".3DO" suffix on a flag at a4+$b1a
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
  const file = parseTdFile(bytes, bad)
  const obj: TdObject = { name: key, file, linked: new Map(), colours: ext === '.3DO' ? tdBlockColours(file) : [] }
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
    /**
     * Td Dir path$ — $211614, and the bound is the library's own:
     *
     *     move.l  $14(a7), d7        the string's LENGTH
     *     movea.l $18(a7), a3        ...and its bytes
     *     moveq   #$44, d0
     *     cmp.l   d0, d7
     *     bls.b   .ok                68 characters is the most it will take
     *     clr.l   -(a7) / pea $f.w / pea $1.w / jsr $21322c
     *
     * so a longer path is `error(1, $f, 0)` -- error 15 -- rather than a
     * truncation, and the copy into the buffer at $9f6(a4) only happens after
     * the check. `tdSetDir` has had that bound all along; this is the reading
     * behind it.
     */
    'td dir'(it) {
      tdSetDir(st(), it.evalStr())
    },
    'td load'(it) {
      const name = it.evalStr()
      tdLoad(st(), (p) => rt.fs?.read(p) ?? null, name)
    },
    /**
     * Td Clear All — $21167a, four instructions: `clr.l -(a7) / jsr $213244 /
     * addq.w #$4, a7`. It calls the shared teardown with a zero argument,
     * which is the "everything" case; Td Kill reaches the same helper with an
     * object number.
     *
     * "Removes all objects from memory" — the whole table goes, templates and
     * surfaces with it, since nothing else holds a reference.
     */
    'td clear all'() {
      st().objects.clear()
      st().instances.clear()
    },
    /**
     * Td Keep On / Td Keep Off — ONE engine routine, $211684, six instructions
     * that store the low byte of their argument into a flag:
     *
     *     move.l $8(a7), d7
     *     move.l d7, d0
     *     move.b d0, $486c(a4)
     *
     * The two keywords are separate thunks in the `3d.lib` stub differing in a
     * single instruction -- routine 74 is `moveq #$1,d2` and routine 75
     * `moveq #$0,d2` -- and both then `jmp -$226(a2)` into the same engine
     * entry. So On and Off are one setter called with 1 and 0.
     *
     * "Td Keep Off tells 3D not to keep objects in memory, but to load them
     * each time" — a caching switch, so with no cache to speak of here it
     * records the setting and Td Load consults it.
     */
    'td keep on'() {
      st().keep = true
    },
    'td keep off'() {
      st().keep = false
    },
    /**
     * `cmp.l #1 / bcs` then `cmpi.l #$100 / bls` at $211526: 1..256. Then
     * `tst.l $4814(a4) / beq` — and $4814 is the head of the live instance
     * list, not the loaded-object table: Td Kill writes it when unlinking
     * the first frame. So it is instances that block a resize, and every
     * demo relies on that, loading its objects first and setting the height
     * only just before the Td Object that uses it.
     */
    'td screen height'(it) {
      const n = it.evalInt()
      if (n < 1 || n > 256) tdError(9)
      if (st().instances.size !== 0) tdError(10)
      st().screenHeight = n
    },
    /**
     * Td Object n,name$,x,y,z,a,b,c — $211694. The number must be 1..20,
     * the slot must be free, and the name must already be loaded; the three
     * errors are "Invalid object number", "Object already exists" and
     * "Object not loaded", in that order.
     */
    'td object'(it) {
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
    /**
     * Td Set Colour n,block,colour — $212f66. The object goes through
     * $212fd0, so object zero is not allowed; a block past the count at
     * +$20 of its object is "Block does not exist"; and a colour outside
     * 0..15 is masked rather than refused, `cmp.l #$10 : bcs : and.l #$f`,
     * which makes -1 white and 16 black.
     *
     * The 31/10/1992 manual update on the Object Modeller coverdisk says
     * "valid colour numbers range from 0 to 16" and that an out-of-range
     * code "will be truncated to the nearest valid code without causing an
     * error". Both are loose: there are sixteen combinations, not
     * seventeen, and $212faa masks rather than clamps, so 16 lands on 0
     * rather than staying at the top. The binary is what runs.
     */
    'td set colour'(it) {
      const n = it.evalInt()
      it.expect(',')
      const block = it.evalInt()
      it.expect(',')
      const colour = it.evalInt()
      const obj = tdInstance(st(), n).object
      if (block < 0 || block >= obj.colours.length) tdError(24)
      obj.colours[block] = [...TD_DITHER[(colour >>> 0) < 16 ? colour : colour & 15]!] as TdDither
    },
    ...Object.fromEntries(
      ([['td anim', false], ['td anim rel', true]] as const).map(([name, relative]) => [
        name,
        ((it) => {
          // Td Anim [Rel] n, point, x, y, z, transform — $211e42, the two
          // forms one routine and a selector. The object goes through
          // $212fd0, so object zero is out of range: the viewpoint has no
          // geometry to deform.
          const t = st()
          const n = it.evalInt()
          const nums: number[] = []
          for (let i = 0; i < 5; i++) {
            it.expect(',')
            nums.push(it.evalInt())
          }
          const [index, x, y, z] = nums as [number, number, number, number]
          const p = tdAnimPoint(tdInstance(t, n), index)
          const w = (v: number): number => (v << 16) >> 16
          p.x = w(relative ? p.x + x : x)
          p.y = w(relative ? p.y + y : y)
          p.z = w(relative ? p.z + z : z)
          // the last argument asks for the point list to be re-transformed
          // there and then ($211ea8 into $21085c); here every redraw
          // transforms from scratch, so there is nothing to force
        }) as Instr,
      ]),
    ),
    /**
     * Td Background screen, sx, sy, w, h To dx, dy — $210c54, and the
     * demos write it exactly so: `Td Background 1,0,0,320,180 To 0,0`.
     *
     * It puts a picture *underneath* the 3D, which is the other half of the
     * reason a pen only ever touches the bottom two bitplanes: the picture
     * goes down at full depth and the objects then change two bits of it.
     * A source deeper than the destination is "Too many planes for 3d
     * background", and handing it the screen it is drawing on is "3d
     * background source screen is current screen".
     */
    'td background'(it) {
      const t = st()
      const from = it.evalInt()
      it.expect(',')
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      it.expect(',')
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      it.expect('to')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()

      const dest = rt.screen
      const src = rt.screens.get(from)
      if (!src || src === dest) tdError(26)
      if (dest.height < t.screenHeight || dest.depth < 4 || dest.width !== TD_SCREEN_WIDTH) tdError(11)
      if (src.depth + TD_BACKGROUND_PLANE > dest.depth) tdError(27)
      // $210cdc onwards: nothing to do for a destination off the right or
      // below the 3D area, or for a rectangle with no width or height
      if (dx > TD_SCREEN_WIDTH - 1 || dy >= t.screenHeight - 1 || w < 1 || h < 1) return
      // the source replaces the planes it covers and leaves any above it
      const mask = ((1 << src.depth) - 1) << TD_BACKGROUND_PLANE
      const keep = ~mask
      for (let y = 0; y < h; y++) {
        const ty = dy + y
        if (ty < 0 || ty >= Math.min(t.screenHeight, dest.height)) continue
        for (let x = 0; x < w; x++) {
          const tx = dx + x
          if (tx < 0 || tx >= dest.width) continue
          const p = src.point(sx + x, sy + y)
          // outside the source is left alone rather than read as zero
          if (p < 0) continue
          dest.plot(tx, ty, (dest.point(tx, ty) & keep) | ((p << TD_BACKGROUND_PLANE) & mask))
        }
      }
    },
    /**
     * Td Surface name$, srcBlock, srcFace To n, dstBlock, dstFace, k —
     * $212c28, and the demos write it exactly like that:
     * `Td Surface "3d2",1,3 To 1,0,5,0`.
     * It lifts the surface off a face of a *loaded* object and puts it on a
     * face of a *live* one, which is how the demos repaint a die or swap
     * the picture on a monitor without reloading anything.
     */
    'td surface'(it) {
      const t = st()
      const name = it.evalStr()
      it.expect(',')
      const srcBlock = it.evalInt()
      it.expect(',')
      const srcFace = it.evalInt()
      it.expect('to')
      const n = it.evalInt()
      it.expect(',')
      const dstBlock = it.evalInt()
      it.expect(',')
      const dstFace = it.evalInt()
      it.expect(',')
      // the sixth number is $24(a5), which nothing on the path traced from
      // here reads; the demos pass 0 and 2
      it.evalInt()
      const src = t.objects.get(name.toLowerCase())
      if (!src) tdError(5)
      const dst = tdInstance(t, n).object
      // the block index is bounded by the count at +$20 and the face index by
      // the block's template at +$1a — "Block does not exist" then "Face does
      // not exist", in that order for the source and then for the destination
      const faceAt = (obj: TdObject, block: number, face: number): number => {
        const blocks = parseTdBlocks(obj.file)
        if (block < 0 || block >= blocks.length) tdError(24)
        const b = blocks[block]!
        const template = obj.linked.get(b.at + 0x0a)
        if (face < 0 || face >= (template ? parseTdTemplate(template.file).faces : 0)) tdError(25)
        return parseTdGeometry(obj.file).facesAt + (b.baseFace + face) * TD_FACE_SIZE
      }
      const from = faceAt(src, srcBlock, srcFace)
      const to = faceAt(dst, dstBlock, dstFace)
      const surface = src.linked.get(from)
      if (surface) dst.linked.set(to, surface)
      else dst.linked.delete(to)
    },
    'td surface points'(it) {
      // $212bde keeps four anchor bytes at a4+$486f..$4872 and sets the flag
      // at a4+$4873. NOTES: they are recorded and nothing maps a surface
      // through them — a surface's slots 1 to 4 are still the face's own four
      // corners, as $217424 fills them. The engine only reads the anchors to
      // validate them ($212d42), and what consumes them has not been found.
      const t = st()
      const n: number[] = [it.evalInt()]
      for (let i = 0; i < 3; i++) {
        it.expect(',')
        n.push(it.evalInt())
      }
      t.surfacePoints = n.map((v) => v & 0xff) as [number, number, number, number]
    },
    /**
     * Td Surface Points Off — the same routine as Td Surface Points, $212bde,
     * selected by the first pushed argument:
     *
     *     tst.l d7 / beq .off
     *     ...four `move.b` into $486f..$4872...
     *     move.b #$1, $4873(a4) / bra .out
     *  .off: clr.b $4873(a4)
     *
     * so Off clears the ACTIVE flag at $4873 and leaves the four parameter
     * bytes at $486f..$4872 exactly as they were.
     *
     * Storing null here therefore loses something the machine keeps -- but
     * nothing can see the difference: the flag gates every read of those four
     * bytes, and the On form takes all four afresh (`args(sel 1, long, long,
     * long, long)`), so there is no path that observes a stale anchor.
     */
    'td surface points off'() {
      st().surfacePoints = null
    },
    /**
     * Td Forward n, d — $2118ee moves the object d units along its own
     * facing. It builds sin and cos of the two angles and combines them by
     * hand, with a shorter path when the roll is zero, but the products are
     * the attitude matrix's third column taken in the same order with the
     * same two shifts — so this is the local point (0, 0, d) put into the
     * world, which is Td World's arithmetic exactly.
     */
    'td forward'(it) {
      const t = st()
      const n = it.evalInt()
      it.expect(',')
      const d = it.evalInt()
      const frame = tdFrame(t, n)
      frame.pos = tdWorldPoint(frame, [0, 0, d])
    },
    /**
     * $212f30 writes the word into the object's render record at +$42, and
     * that is all it does — no relinking, no sort here. The sort is at
     * $218cc4 and runs every Td Redraw; see tdSortInstances.
     */
    'td priority'(it) {
      const t = st()
      const n = it.evalInt()
      it.expect(',')
      tdInstance(t, n).priority = (it.evalInt() << 16) >> 16
    },
    /**
     * $2114b6 is `link a5,#0 : unlk : rts` — the keyword survived into the
     * shipped engine with its body removed, so it does nothing at all
     */
    'td debug'(it) {
      it.evalInt()
    },
    /** $212f5e, likewise a bare link/unlk/rts */
    'td pragma'(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
    },
    /**
     * Td Set Zone n, zone, x, y, z, r — $211f98. The object goes through
     * $21301c so zero counts; a centre over $4000 on any axis, a radius
     * over $80000 or a negative zone number is "Zone parameter(s) out of
     * range". Setting a number that is already there replaces it, because
     * the list walk at $212020 looks before it allocates.
     */
    'td set zone'(it) {
      const t = st()
      const n = it.evalInt()
      const nums: number[] = []
      for (let i = 0; i < 5; i++) {
        it.expect(',')
        nums.push(it.evalInt())
      }
      const [zone, x, y, z, r] = nums as [number, number, number, number, number]
      if (zone < 0 || r < 0 || r > TD_ZONE_RADIUS_LIMIT) tdError(12)
      for (const v of [x, y, z]) if (Math.abs(v) > TD_ZONE_LIMIT) tdError(12)
      const frame = tdFrame(t, n)
      if (!frame.zones) frame.zones = []
      // the number is kept as a byte, so 256 is zone 0 all over again
      const key = zone & 0xff
      const reach = (Math.floor(Math.sqrt(x * x + y * y + z * z)) + r) | 0
      const made: TdZone = { n: key, pos: [x, y, z], r, reach }
      const at = frame.zones.findIndex((q) => q.n === key)
      if (at < 0) frame.zones.push(made)
      else frame.zones[at] = made
    },
    /** $2120e8 — unlinks it; a number that is not there is not an error */
    'td delete zone'(it) {
      const t = st()
      const n = it.evalInt()
      it.expect(',')
      const zone = it.evalInt() & 0xff
      const frame = tdFrame(t, n)
      if (frame.zones) frame.zones = frame.zones.filter((q) => q.n !== zone)
    },
    /**
     * $211c24, selector 8 into the same routine Td Bearing uses — "points
     * object n1 at n2" is the bearing written back into the attitude. Only
     * A and B move; C, the roll, is left alone.
     */
    'td face'(it) {
      const t = st()
      const n1 = it.evalInt()
      it.expect(',')
      const nums: number[] = [it.evalInt()]
      while (it.accept(',')) nums.push(it.evalInt())
      const frame = tdFrame(t, n1)
      const to = nums.length >= 3 ? nums.slice(0, 3) : tdFrame(t, nums[0]!).pos
      t.bearing = tdBearingFor(t.bearing, frame, to)
      frame.angle[0] = t.bearing.a
      frame.angle[1] = t.bearing.b
    },
    /** $2117d2 unlinks the frame from the live list and frees it */
    'td kill'(it) {
      const t = st()
      t.instances.delete(tdInstance(t, it.evalInt()).n)
    },
    /**
     * Td Move / Td Move Rel / Td Angle / Td Angle Rel — $21188a and $2118bc for
     * the position pair, $211b34 and $211b66 for the attitude pair, all four
     * built by `tdVector` below, where the reading is written out.
     */
    'td move': tdVector(rt, 'pos', false),
    'td move rel': tdVector(rt, 'pos', true),
    'td angle': tdVector(rt, 'angle', false),
    'td angle rel': tdVector(rt, 'angle', true),
    /**
     * The six animation-string forms: Td Move X/Y/Z through $211822 and Td
     * Angle A/B/C through $211a5c, each a single routine taking the axis as a
     * selector (`sel 0`, `sel 1`, `sel 2`) ahead of the string. See
     * `tdSetAnim` for what the strings mean.
     */
    ...Object.fromEntries(
      // the six string forms: axis 0/1/2 on the position or the attitude
      (['x', 'y', 'z'] as const).flatMap((ax, i) => [
        [`td move ${ax}`, ((it) => {
          const n = it.evalInt()
          it.expect(',')
          tdSetAnim(tdFrame(st(), n), 'pos', i, it.evalStr())
        }) as Instr],
        [`td angle ${'abc'[i]}`, ((it) => {
          const n = it.evalInt()
          it.expect(',')
          tdSetAnim(tdFrame(st(), n), 'angle', i, it.evalStr())
        }) as Instr],
      ]),
    ),
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
      // $211394 steps both animation lists of every live instance before it
      // builds that instance's matrix, so an animation set this frame moves
      // the object this frame
      tdStepAnims(t)
      // tdRedrawFaces hands back the engine's order, front-most first; a
      // painter has to go the other way for the front-most to end up on top
      const rp = tdRastPort(s2)
      for (const inst of tdRedrawFaces(t).reverse()) {
        for (const f of inst.faces) tdDrawFace(rp, t.screenHeight, f)
      }
    },
    /**
     * Td Quit — "unload the 3D extensions along with all objects and release
     * all 3D memory".
     *
     * The only keyword in the set whose stub does NOT reach a numbered engine
     * routine: routine 77 ($f72) is two instructions, `movea.l $128(a5),a2 /
     * jmp -$88(a2)`, into a different vector than every other keyword uses --
     * they go through -$226 and -$228, this one through -$88. That is the
     * engine teardown entry rather than a keyword handler, which is why the
     * dispatch walker lists 62 routines and not 63.
     *
     * NOTE: there is no LoadSeg'd engine here to unload, so it is the clear.
     */
    'td quit'() {
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
  /** the collision spheres in the list off the frame's +$0, in the order added */
  zones?: TdZone[]
  /**
   * The two animation lists a frame carries: `$1e(frame)` drives the position
   * and `$22(frame)` the attitude, and Td Redraw steps both. Keyed by axis,
   * because `$21303e` looks for a node whose mask matches before it links a
   * new one — so setting the same axis twice replaces rather than stacks.
   */
  anims?: Map<string, TdAnim>
}

/**
 * One animation node. The engine's is 24 bytes with the countdown at +$10 and
 * the reload at +$4, which is a (speed, step, count) group being stepped —
 * the same shape as a sprite's Move X.
 */
export interface TdAnim {
  field: 'pos' | 'angle'
  axis: number
  start: number | null
  groups: Array<[number, number, number]>
  loop: boolean
  endPos: number | null
  gi: number
  speedLeft: number
  countLeft: number
  started: boolean
  done: boolean
}

export interface TdInstance extends TdFrame {
  n: number
  object: TdObject
  /** `Td Priority`, the word at +$42 of the object's render record */
  priority?: number
  /** whether the last `Td Redraw` put any of this object on the screen */
  drawn?: boolean
  /**
   * The instance's own copy of the model points, once `Td Anim` has touched
   * one. $2149ce copies the point list into the instance when the object is
   * created, so animating one `Td Object` does not deform another of the same
   * name; the copy is made here on first use instead of on creation, which
   * comes to the same thing and costs nothing for an object nobody animates.
   */
  points?: TdPoint[]
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

/**
 * `Td Range(n1,n2)` — "returns the range between two objects n1 and n2, that
 * is the distance between them" — routine $211d8c.
 *
 * Equal numbers return zero without validating either, so `Td Range(99,99)`
 * is 0 rather than an error. Otherwise both frames come through $21301c, so
 * the viewpoint counts as an object here.
 *
 * The interesting part is the prescale at $21235a, which is what keeps the
 * sum of squares inside a long. It takes the absolute values, ORs them
 * together, and if the result is under $4000 does nothing. Above that it
 * normalises — `moveq #$12,d5` then shift left until bit 31 is set,
 * decrementing — which leaves a shift of `p - 13` where p is the position of
 * the highest set bit. Every delta is then arithmetic-shifted down by that,
 * so each squares to at most 2^28 and the three sum without overflowing, and
 * the root is shifted back up at the end.
 *
 * The cost is precision, and it is the engine's: two objects 100000 apart are
 * measured in units of 8.
 */
export function tdRange(a: TdFrame, b: TdFrame): number {
  const d = [0, 1, 2].map((i) => (a.pos[i]! - b.pos[i]!) | 0)
  let acc = 0
  for (const v of d) acc |= Math.abs(v)
  let shift = 0
  if ((acc & 0xffff_c000) !== 0) {
    let n = acc & 0xffff_c000
    shift = 18
    while ((n & 0x8000_0000) === 0) {
      shift--
      n = (n << 1) | 0
    }
  }
  const scaled = d.map((v) => v >> shift)
  const sum = scaled.reduce((t, v) => t + v * v, 0) | 0
  return (Math.floor(Math.sqrt(sum >>> 0)) << shift) | 0
}

// ---- zones and collision ----

/** `Td Set Zone` refuses a centre outside this, on any axis ($211fce) */
export const TD_ZONE_LIMIT = 0x4000

/** ...and a radius above this, tested unsigned ($211ffe) */
export const TD_ZONE_RADIUS_LIMIT = 0x80000

/**
 * A collision sphere hung on a frame. The engine keeps them in a linked list
 * off the frame's +$0, each thirty-eight bytes: the number as a byte at +$0,
 * the reach at +$2, the centre at +$6/$a/$e, a world-space copy of the centre
 * at +$12/$16/$1a, the radius at +$1e and the next one at +$22.
 */
export interface TdZone {
  /** the zone's number, stored as a byte, so it wraps at 256 */
  n: number
  /** the centre, in the object's own frame */
  pos: [number, number, number]
  r: number
  /**
   * How far the zone reaches from the object's origin — `sqrt(x^2+y^2+z^2) +
   * r`, worked out at $2120a6 and kept at +$2. The largest of them is the
   * frame's own bounding radius, which is what the broad phase compares.
   */
  reach: number
}

/** the frame's bounding radius: the furthest any of its zones reaches */
export function tdFrameReach(frame: TdFrame): number {
  let reach = 0
  for (const z of frame.zones ?? []) if (z.reach > reach) reach = z.reach
  return reach
}

/** a zone's centre in world coordinates — its local centre turned and moved */
export function tdZoneWorld(frame: TdFrame, z: TdZone): [number, number, number] {
  return tdWorldPoint(frame, z.pos)
}

/**
 * Whether two frames' zones touch — $212200, and the predicate at $2122ec.
 *
 * Two passes. The broad one compares the distance between the frames with the
 * sum of their bounding radii, so a pair that cannot possibly touch costs one
 * test. The narrow one is every zone of the first against every zone of the
 * second, in world coordinates.
 *
 * Both use the same comparison and it is strict: `slt` at $21234e, so the
 * squared distance has to be *less than* the squared sum. Spheres that touch
 * exactly do not collide.
 *
 * NOTES: the engine prescales the three differences and the radius together
 * before squaring them, so that the products fit in a long; the port squares
 * them as they are. Double arithmetic carries about as many significant
 * digits as the engine has left after its shift, so the two agree except
 * possibly on the exact boundary between objects millions of units apart.
 */
export function tdFramesCollide(a: TdFrame, b: TdFrame): boolean {
  const near = (p: readonly number[], q: readonly number[], sum: number): boolean => {
    const d = [0, 1, 2].map((i) => p[i]! - q[i]!)
    return d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]! < sum * sum
  }
  if (!near(a.pos, b.pos, tdFrameReach(a) + tdFrameReach(b))) return false
  for (const za of a.zones ?? []) {
    for (const zb of b.zones ?? []) {
      if (near(tdZoneWorld(a, za), tdZoneWorld(b, zb), za.r + zb.r)) return true
    }
  }
  return false
}

// ---- bearings ----

/** the arctangent table covers a ratio of 0 to 1 in thirty-two steps */
export const TD_ARCTAN_STEPS = 32

/**
 * The arctangent table at a4+$672, thirty-three words — one per thirty-second
 * of a ratio from zero to one, so the last is $2000, forty-five degrees.
 *
 * It sits immediately after the sine table (a4+$270, 513 words), and like it
 * the entries are truncated rather than rounded: `floor(atan(i/32) * 65536 /
 * 2pi)`. The tests check the generated table against the library's own copy.
 */
function buildArctan(): Int16Array {
  const t = new Int16Array(TD_ARCTAN_STEPS + 1)
  for (let i = 0; i <= TD_ARCTAN_STEPS; i++) {
    t[i] = Math.floor((Math.atan(i / TD_ARCTAN_STEPS) * TD_REVOLUTION) / (2 * Math.PI))
  }
  return t
}
export const TD_ARCTAN = buildArctan()

/**
 * The angle whose tangent is `ratio/4096`, for a ratio in 0..4096 — $21942e.
 *
 * `lsr.w #7` picks the entry and the remainder interpolates linearly into the
 * next one, `(remainder * (next - this)) >> 7`. A ratio of exactly 4096 lands
 * on the last entry with nothing left over, so the table is never read past.
 */
export function tdArctan(ratio: number): number {
  const r = ratio & 0xffff
  const i = r >>> 7
  const base = TD_ARCTAN[i]!
  const rest = r - (i << 7)
  if (rest === 0) return base
  return (base + (((rest * (TD_ARCTAN[i + 1]! - base)) | 0) >> 7)) | 0
}

/**
 * `atan2(p, q)` in the engine's 65536ths of a revolution — $21939e.
 *
 * Both arguments are made positive and their signs remembered, the smaller is
 * divided by the larger to keep the ratio inside the table, and the octant is
 * put back afterwards: a ratio taken the other way up is reflected about
 * $4000, a negative `q` about $8000, and a negative `p` is negated outright.
 * Zero for both never reaches here — every caller checks first.
 */
export function tdAtan2(p: number, q: number): number {
  const negQ = q < 0
  const negP = p < 0
  const a = Math.abs(q)
  const b = Math.abs(p)
  let angle = a > b ? tdArctan(((b * TD_ONE) / a) | 0) : 0x4000 - tdArctan(b === 0 ? 0 : ((a * TD_ONE) / b) | 0)
  if (negQ) angle = 0x8000 - angle
  if (negP) angle = -angle
  return (angle << 16) >> 16
}

/** what the bearing core leaves behind, and what the no-argument forms read */
export interface TdBearing {
  /** `Td Bearing A`, the engine's a4+$149e */
  a: number
  /** `Td Bearing B`, a4+$149c */
  b: number
  /** `Td Bearing R`, a4+$14a0, before the prescale shift is put back */
  r: number
  /** the prescale shift, a4+$14a4 — `Td Bearing R` shifts left by it */
  shift: number
}

/**
 * The bearing core — $21324a, a veneer on to $219200.
 *
 * It answers "which way is that, and how far": the two angles that point the
 * first frame at the second, and the distance between them.
 *
 * The prescale is Td Range's, one bit wider: the three differences are OR'd
 * together and, if anything lands above eighteen bits, all three are shifted
 * down by the same amount so the arithmetic that follows cannot overflow. The
 * shift is remembered because `Td Bearing R` puts it back.
 *
 * Then, twice, the same move: take the angle to a pair of components with
 * `atan2`, build its sine and cosine, and use them to fold the problem down a
 * dimension. The heading comes from x against z; rotating by minus it gives
 * the distance to the target in the plane the heading points along; the
 * elevation comes from y against that. The range is the last division,
 * against whichever of the sine and cosine is the larger — over a half in
 * 4096ths — because dividing by the smaller of the two loses precision.
 *
 * Both bail-outs are the engine's: if x and z are both zero, or if y and the
 * folded distance are both zero, it returns without touching anything and the
 * previous answer stands. That is the same mechanism that lets a program read
 * A, B or R after `Td Face` as if it had just called `Td Bearing`.
 */
export function tdBearingCore(prev: TdBearing, from: readonly number[], to: readonly number[]): TdBearing {
  const d = [0, 1, 2].map((i) => (to[i]! - from[i]!) | 0)
  let acc = 0
  for (const v of d) acc |= Math.abs(v)
  let shift = 0
  if ((acc & 0xfffc_0000) !== 0) {
    let n = acc
    shift = 14
    while ((n & 0x8000_0000) === 0) {
      shift--
      n = (n << 1) | 0
    }
  }
  const [dx, dy, dz] = d.map((v) => v >> shift) as [number, number, number]
  if (dx === 0 && dz === 0) return { ...prev, shift }

  const b = tdAtan2(-dx, dz)
  // sin and cos of minus the heading, the pair the engine leaves at a4+$bd0
  // and a4+$bde, fold x and z into one distance along it
  const folded = ((dz * tdCos(-b) + dx * tdSin(-b)) | 0) >> 12
  if (dy === 0 && folded === 0) return { ...prev, b, shift }

  const a = tdAtan2(-dy, folded)
  const sin = tdSin(a)
  const cos = tdCos(a)
  const r = Math.abs(Math.abs(sin) > 0x800 ? ((dy * TD_ONE) / sin) | 0 : ((folded * TD_ONE) / cos) | 0) | 0
  return { a, b, r, shift }
}

/**
 * `Td Bearing A/B(n1, ...)` and `Td Face` — the tail of $211c6e.
 *
 * The core's two angles are negated, and then the engine does something worth
 * keeping: there are two attitudes that face the same way — (a, b) and its
 * mirror ($8000 - a, b + $8000) — and it picks whichever is nearer the
 * object's *present* attitude, by the sum of the squared differences on the
 * two axes. So turning to face something takes the shorter way round, and
 * which of the two you get depends on where the object was already pointing.
 */
export function tdBearingFor(prev: TdBearing, frame: TdFrame, to: readonly number[]): TdBearing {
  const c = tdBearingCore(prev, frame.pos, to)
  const w = (n: number): number => (n << 16) >> 16
  let a = w(-c.a)
  let b = w(-c.b)
  const altA = w(0x8000 - a)
  const altB = w(b + 0x8000)
  const cost = (x: number, y: number): number =>
    w(x - frame.angle[0]!) * w(x - frame.angle[0]!) + w(y - frame.angle[1]!) * w(y - frame.angle[1]!)
  if (cost(altA, altB) < cost(a, b)) {
    a = altA
    b = altB
  }
  return { ...c, a, b }
}

/**
 * `Td World X/Y/Z(n, x, y, z)` — $2126c8.
 *
 * "Where in the world is this point on that object": takes a coordinate in an
 * object's own frame and gives it back in the world's.
 *
 * The engine folds the local vector through the object's attitude matrix with
 * the vertex loop's own arithmetic, keeps the three long products, and only
 * then brings them down and adds the object's position ($2128e8):
 *
 *     world = position + ((rotate(attitude, local) >> 12) << prescale)
 *
 * The prescale is $21235a's, on the input vector, so a distant point cannot
 * overflow the products; it is shifted straight back out afterwards.
 *
 * Object zero takes the other path at $212822, and it is worth being clear
 * about what that fork is and is not. It reads a4+$bba instead of a4+$bcc —
 * the viewpoint's cached matrix rather than the one just built for the object
 * — but the fold is identical: $bc6 against z and $bc2 against y are indices
 * 6 and 4, the same two the object branch takes as $bd8 and $bd4. Both blocks
 * hold the same nine numbers from the same builder, so here there is one
 * case, not two. What the transpose distinguishes is Td World from Td View,
 * not object zero from the rest.
 *
 * All three coordinates are worked out together and left at a4+$1c/$20/$24;
 * the no-argument form ($21291c) reads one back without recomputing, the same
 * arrangement Td Bearing has.
 */
export function tdWorldPoint(frame: TdFrame, local: readonly number[]): [number, number, number] {
  const m = tdMatrix(frame.angle[0]!, frame.angle[1]!, frame.angle[2]!)
  const [x, y, z] = [local[0]!, local[1]!, local[2]!]
  return [
    (frame.pos[0]! + ((((m[0]! * x - m[4]! * y + m[6]! * z) | 0) >> 12) | 0)) | 0,
    (frame.pos[1]! + ((((m[1]! * x + m[3]! * y + m[7]! * z) | 0) >> 12) | 0)) | 0,
    (frame.pos[2]! + ((((-m[2]! * x - m[5]! * y + m[8]! * z) | 0) >> 12) | 0)) | 0,
  ]
}

/**
 * `Td View X/Y/Z(n, x, y, z)` — $21294c, and the exact inverse of Td World:
 * it takes a point in the world and gives it back in an object's own frame.
 *
 * The object's position is subtracted first ($21298c), then the same matrix
 * is folded the other way round — $2129f8 opens with index 2 against z where
 * Td World opens with index 6, which is the difference between `tdRotate` and
 * `tdViewRotate`. Nothing is added back afterwards, because the result is
 * already relative. Results at a4+$28/$2c/$30.
 */
export function tdViewPoint(frame: TdFrame, world: readonly number[]): [number, number, number] {
  const m = tdMatrix(frame.angle[0]!, frame.angle[1]!, frame.angle[2]!)
  const r = tdViewRotate(m, {
    x: (world[0]! - frame.pos[0]!) | 0,
    y: (world[1]! - frame.pos[1]!) | 0,
    z: (world[2]! - frame.pos[2]!) | 0,
  })
  return [r.x, r.y, r.z]
}

/**
 * An instance's model points, copied on first use — `Td Anim` deforms the
 * object it is given and not every other object loaded from the same file.
 */
export function tdInstancePoints(inst: TdInstance): TdPoint[] {
  if (!inst.points) inst.points = parseTdGeometry(inst.object.file).points.map((p) => ({ ...p }))
  return inst.points
}

/**
 * One model point of a live object, for `Td Anim` — the walk at $211f2a.
 *
 * The index counts from zero, and the walk stops at the 30000 terminator
 * rather than at a count, so asking for a point past the end of the list is
 * "Point does not exist" rather than a read into whatever follows.
 */
export function tdAnimPoint(inst: TdInstance, index: number): TdPoint {
  const points = tdInstancePoints(inst)
  if (index < 0 || index >= points.length) tdError(20)
  return points[index]!
}

/** `Td Position X/Y/Z(n)` and `Td Attitude A/B/C(n)`, one routine and a selector */
export function makeTdFunctions(rt: Runtime): Record<string, Func> {
  /**
   * The six readers: Td Position X/Y/Z through $2119ec and Td Attitude A/B/C
   * through $211bf8, each ONE engine routine taking the axis as a selector
   * ahead of the object number, exactly as the setters do. They read the
   * frame's vector back without transforming it, so what Td Move wrote is what
   * Td Position gives.
   */
  const read = (field: 'pos' | 'angle', axis: number): Func => (_, a) =>
    VI(tdFrame(rt.td, int(a[0] ?? VI(0)))[field][axis]!)
  return {
    'td position x': read('pos', 0),
    'td position y': read('pos', 1),
    'td position z': read('pos', 2),
    'td attitude a': read('angle', 0),
    'td attitude b': read('angle', 1),
    'td attitude c': read('angle', 2),
    ...Object.fromEntries(
      (['a', 'b', 'r'] as const).map((which) => [
        `td bearing ${which}`,
        ((_, a) => {
          // $211c6e reads its argument flags out of d7: bit 3 clear is the
          // no-argument form, which recomputes nothing, and bit 2 chooses
          // between a second object number and a literal (x,y,z).
          const t = rt.td
          if (a.length !== 0) {
            const n1 = int(a[0] ?? VI(0))
            const to =
              a.length >= 4
                ? [int(a[1] ?? VI(0)), int(a[2] ?? VI(0)), int(a[3] ?? VI(0))]
                : tdFrame(t, int(a[1] ?? VI(0))).pos
            t.bearing = tdBearingFor(t.bearing, tdFrame(t, n1), to)
          }
          // $211d4a puts the prescale shift back into the range, exactly as
          // Td Range does; the two angles are already whole
          if (which === 'r') return VI((t.bearing.r << t.bearing.shift) | 0)
          return VI(which === 'a' ? t.bearing.a : t.bearing.b)
        }) as Func,
      ]),
    ),
    ...Object.fromEntries(
      (['x', 'y', 'z'] as const).map((axis, i) => [
        `td world ${axis}`,
        ((_, a) => {
          // bit 2 of the flags word says a vector came with it; without one
          // $21291c hands back the coordinate worked out last time
          const t = rt.td
          if (a.length >= 4) {
            const n = int(a[0] ?? VI(0))
            t.world = tdWorldPoint(tdFrame(t, n), [int(a[1] ?? VI(0)), int(a[2] ?? VI(0)), int(a[3] ?? VI(0))])
          }
          return VI(t.world[i]!)
        }) as Func,
      ]),
    ),
    ...Object.fromEntries(
      (['x', 'y', 'z'] as const).map((axis, i) => [
        `td view ${axis}`,
        ((_, a) => {
          const t = rt.td
          if (a.length >= 4) {
            t.view = tdViewPoint(tdFrame(t, int(a[0] ?? VI(0))), [
              int(a[1] ?? VI(0)),
              int(a[2] ?? VI(0)),
              int(a[3] ?? VI(0)),
            ])
          }
          return VI(t.view[i]!)
        }) as Func,
      ]),
    ),
    ...Object.fromEntries(
      (['x', 'y'] as const).map((axis) => [
        `td screen ${axis}`,
        ((_, a) => {
          // Td Screen X/Y(x, y, z) takes a world coordinate — there is no
          // object number, because the frame it is measured against is always
          // the viewpoint, whose position $212540 subtracts from a4+$1474.
          const t = rt.td
          if (a.length >= 3) {
            const world: [number, number, number] = [int(a[0] ?? VI(0)), int(a[1] ?? VI(0)), int(a[2] ?? VI(0))]
            const p = tdProject(tdViewFor(t.viewpoint, { pos: world, angle: [0, 0, 0] }), { x: 0, y: 0, z: 0 })
            t.screen = { x: p.x, y: p.y, ok: p.status === 0 }
          }
          // out of range is -1, `moveq #$ff,d0` at $2126b2 and $212648
          if (!t.screen.ok) return VI(-1)
          if (axis === 'x') {
            return VI(tdClipCode(t.screen.x) === 0 ? tdScreenX(t.screen.x) : -1)
          }
          // the vertical bounds are a4+$4868 and a4+$4864 - 1, both in whole
          // rows and both shifted up four to meet the coordinate ($21266c)
          const centre = tdCentreRow(t.screenHeight)
          const top = centre - (t.screenHeight - 1)
          if (t.screen.y < top * 16 || t.screen.y > (centre - 1) * 16) return VI(-1)
          return VI(tdScreenY(t.screenHeight, t.screen.y))
        }) as Func,
      ]),
    ),
    ...Object.fromEntries(
      (['x', 'y', 'z', 'r'] as const).map((axis, i) => [
        `td zone ${axis}`,
        ((_, a) => {
          // $212438 answers -1 for a zone the object has not got
          const z = (tdFrame(rt.td, int(a[0] ?? VI(0))).zones ?? []).find((q) => q.n === (int(a[1] ?? VI(0)) & 0xff))
          if (!z) return VI(-1)
          return VI(i === 3 ? z.r : z.pos[i]!)
        }) as Func,
      ]),
    ),
    ...Object.fromEntries(
      (['x', 'y', 'z'] as const).map((axis) => [
        `td anim point ${axis}`,
        ((_, a) => {
          const p = tdAnimPoint(tdInstance(rt.td, int(a[0] ?? VI(0))), int(a[1] ?? VI(0)))
          return VI(axis === 'x' ? p.x : axis === 'y' ? p.y : p.z)
        }) as Func,
      ]),
    ),
    'td visible': (_, a) => {
      // $211d64 answers 0 when the byte at $f8 of the instance is set and the
      // one at $cb is clear. $f8 is a "culled this frame" flag: $219038
      // clears it at the top of each object's pass and $2190c8 sets it when
      // the object fails the distance test, `d6 + a4+$b34 < d7`.
      //
      // NOTES: that test is a bounding-sphere check made before any face is
      // looked at, and the pass it lives in has not been read. This answers
      // the same question a different way — whether the last Td Redraw put
      // any of the object on the screen — so an object rejected wholly by the
      // near limit agrees with the engine, while one the engine culls early
      // for being too far and this one drops face by face may disagree at the
      // margin. An object that has never been redrawn reads as visible, which
      // is what the cleared byte gives.
      return VI(tdInstance(rt.td, int(a[0] ?? VI(0))).drawn === false ? 0 : 1)
    },
    /**
     * =Td Pragma Status(a,b) — $212f54, and it is four instructions:
     * `link.w a5,#$0 / moveq #$2a,d0 / unlk a5 / rts`.
     *
     * It answers 42 unconditionally and reads neither argument. The routine
     * that follows it at $212f5e is an empty `link/unlk/rts` too, so this
     * corner of the engine is placeholders the author never filled in.
     */
    'td pragma status': () => VI(42),
    'td advanced': (_, a) => {
      // $212f0c hands back an address: a4 itself for object zero, otherwise
      // the instance pointer. NOTES: there is no address space here for one
      // to mean anything in, so this answers zero — the same reason peek and
      // poke are approximated.
      int(a[0] ?? VI(0))
      return VI(0)
    },
    /**
     * =Td Collide(n[,m]) — $21218e. With a second object it tests that one;
     * without, it walks the twenty slots at a4+$47c0 and stops at the first
     * hit, skipping itself and any empty slot — but never skipping zero, the
     * viewpoint, which has no slot to be empty. -1 when nothing touches.
     */
    'td collide': (_, a) => {
      const t = rt.td
      const n = int(a[0] ?? VI(0))
      const frame = tdFrame(t, n)
      if (a.length >= 2) {
        const m = int(a[1] ?? VI(0))
        return VI(tdFramesCollide(frame, tdFrame(t, m)) ? m : -1)
      }
      for (let m = 0; m <= TD_MAX_OBJECTS; m++) {
        if (m === n) continue
        if (m !== 0 && !t.instances.has(m)) continue
        if (tdFramesCollide(frame, tdFrame(t, m))) return VI(m)
      }
      return VI(-1)
    },
    'td range': (_, a) => {
      const n1 = int(a[0] ?? VI(0))
      const n2 = int(a[1] ?? VI(0))
      // $211d9c compares the two numbers before it validates either
      if (n1 === n2) return VI(0)
      return VI(tdRange(tdFrame(rt.td, n1), tdFrame(rt.td, n2)))
    },
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
  /**
   * How many faces a block built on this template has — the byte at +$1a,
   * which is what bounds `Td Surface`'s face arguments at $212cac and $212d06.
   */
  faces: number
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
  return { block: b, sections, records, delta, faces: b[0x1a] ?? 0 }
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

// ---- blocks and colour ----

/**
 * The engine calls a sub-object a *block* — "Block does not exist" is error
 * 24, and it is what `Td Set Colour` and `Td Surface` index. A block record is
 * forty-six bytes in the section the loader reaches through +$38.
 */
export const TD_BLOCK_SIZE = 46

/** two pens from the bottom four, dithered together to make one colour */
export type TdDither = [number, number]

/**
 * The sixteen colours, as the pairs of pens they are really drawn in — the
 * table at a4+$54, which `Td Set Colour` indexes by colour*2 ($212fb4).
 *
 * Four solids and twelve ordered dithers of two pens, which is how a screen
 * with four usable pens offers sixteen colours. Note that 1 and 10 are the
 * same two pens the other way round: the order is the dither's phase, so they
 * are different colours on screen.
 */
export const TD_DITHER: readonly TdDither[] = [
  [0, 0], [0, 1], [0, 2], [0, 3],
  [1, 2], [2, 1], [1, 3], [3, 1],
  [2, 3], [3, 2], [1, 0], [1, 1],
  [2, 0], [2, 2], [3, 0], [3, 3],
]

export interface TdBlock {
  /** offset of the record in the object's block */
  at: number
  /** the stored template pointer; the type-4 link record names `at + $a` */
  template: number
  /** index of the first working vertex the block owns ($214dd6, byte * $20) */
  firstVertex: number
  /** index of the block's first face in the object's face list ($214f56) */
  baseFace: number
}

/**
 * The blocks of an object, out of the section at +$38 with the count at +$20.
 *
 * $214f22 is the reader: it walks the records forty-six bytes at a time,
 * taking +$16 as the index of the block's first face — it multiplies by
 * sixteen and adds the face pointer — and +$12 as the index of its first
 * working vertex, multiplied by the $20 vertex stride. +$a is the template
 * pointer, which is exactly where the object's type-4 link record puts its
 * resolved address.
 */
export function parseTdBlocks(file: TdFile): TdBlock[] {
  const b = file.block
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const at0 = v.getUint16(0x38, false)
  const count = b[0x20] ?? 0
  const out: TdBlock[] = []
  for (let i = 0; i < count; i++) {
    const at = at0 + i * TD_BLOCK_SIZE
    if (at + TD_BLOCK_SIZE > b.length) break
    out.push({
      at,
      template: v.getUint32(at + 0x0a, false),
      firstVertex: b[at + 0x12]!,
      baseFace: v.getUint16(at + 0x16, false),
    })
  }
  return out
}

/**
 * An object's starting colours, one dither pair per block.
 *
 * This is the section at +$3a, and it is the last of the five to be read for
 * what it is. $2109c0 allocates two bytes per block — the count at +$20,
 * doubled — hangs the array off the object record's +$10 and copies the
 * section straight into it; $214df6 then gives each block struct a pointer
 * into it, advancing by two, and that pointer is the one `Td Set Colour`
 * writes through. So the file's own bytes are the object's colours until a
 * program changes them.
 *
 * The evidence is the release: every one of the thirty-five objects has
 * exactly two bytes per block between this section and its point list, and
 * every one of those bytes is a pen in 0 to 3.
 *
 * Because the array belongs to the *loaded object* and not to an instance,
 * two `Td Object`s of the same name share it — recolouring one recolours the
 * other. That is reproduced.
 */
export function tdBlockColours(file: TdFile): TdDither[] {
  const b = file.block
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const at = v.getUint16(0x3a, false)
  const count = b[0x20] ?? 0
  const out: TdDither[] = []
  for (let i = 0; i < count; i++) out.push([b[at + i * 2] ?? 0, b[at + i * 2 + 1] ?? 0])
  return out
}

/**
 * Which block a face belongs to: the last one whose first face is not past it.
 *
 * The engine reads the count out of the block's template ($1a of it, bounding
 * Td Surface's face argument at $212cac) rather than working it out this way,
 * but the two agree — the blocks' faces are consecutive and in order — and
 * this needs no template, which matters because p8.3DT is missing from the
 * archive that thirty of the demo objects want.
 */
export function tdBlockForFace(blocks: TdBlock[], face: number): number {
  let n = 0
  for (let i = 0; i < blocks.length; i++) if (blocks[i]!.baseFace <= face) n = i
  return n
}

// ---- surfaces ----

/**
 * A surface point slot is ten bytes: a long x, a long y and a word of clip
 * flags — the first ten bytes of a working vertex, which is what $217424
 * copies into the first four slots.
 */
export const TD_SLOT_STRIDE = 10

/** a construction record: three slot pointers, destination first */
export const TD_BUILD_SIZE = 12

/** a fill record: a slot pointer and a pen byte, with one byte spare */
export const TD_FILL_SIZE = 6

/** dest = midpoint(a, b), with every operand a slot index */
export interface TdBuild {
  dest: number
  a: number
  b: number
}

/** one corner of a filled polygon: a slot index and the pen for its edge */
export interface TdFillPoint {
  slot: number
  pen: number
}

export interface TdSurface {
  /** the editor's base address, stored at +$12 and subtracted off every pointer */
  base: number
  /** the midpoint constructions, in the order they must be evaluated */
  build: TdBuild[]
  /** the edge list at +$0e, as pairs of slot indices */
  edges: Array<[number, number]>
  /** the filled polygons at +$10, one array of corners each */
  fills: TdFillPoint[][]
  /** one past the highest slot the surface mentions */
  slots: number
}

/**
 * Parse a `.3DS`.
 *
 * The load-time fix-up is at $219b30 and is the object's, one section shorter:
 *
 *     +$0e -> +$00    +$10 -> +$04    +$0c -> +$08
 *
 * What makes the file readable is the long at +$12. It is the address the
 * surface editor's own point array sat at, and the loader turns every pointer
 * in the file into an offset from it:
 *
 *     lea $bf2(a4),a0 : move.l a0,d1 : sub.l $12(block),d1 : move.l d1,d7
 *
 * then adds d7 to each. So a stored pointer is `base + 10*slot`, and dividing
 * out the ten recovers a slot index that means the same thing in every file.
 * The two loops that follow are what say where each section ends: the one at
 * +$08 is a flat run of longs stopped by a zero, and the one at +$04 is a run
 * of six-byte records where a zero record ends a polygon and a second zero
 * record ends the list.
 *
 * The three sections are, in the order the renderer uses them:
 *
 * - **+$08, the constructions.** Twelve bytes each: a destination slot and two
 *   sources. $2174d2 evaluates them in file order — `dest.x = (a.x + b.x) >> 1`
 *   and the same for y — so a surface is nothing but repeated bisection, and
 *   every source is a slot an earlier record already defined. That is why the
 *   file carries no coordinates at all: slots 1 to 4 are the face's own
 *   projected corners and everything else is halfway between two points that
 *   are already known.
 * - **+$04, the fills.** A slot pointer and a pen byte per corner. $2103ac
 *   reads a corner, copies its pen byte to the pen global at $21d3d8, reads
 *   the next corner and emits the edge between them, so the pen belongs to the
 *   edge leaving a corner rather than to the polygon.
 * - **+$00, the edges.** Pairs of slot pointers describing the same outline the
 *   fills do. The fix-up does not relocate this section and no path traced from
 *   Td Redraw reads it, so the port carries it as slot indices and nothing
 *   more. Every surface on the dice has an empty one.
 *
 * `Bad Surface file` is not raised from here: the engine validates only the
 * leading `(N)`, exactly as it does for an object.
 */
export function parseTdSurface(file: TdFile): TdSurface {
  const b = file.block
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const buildAt = v.getUint16(0x0c, false)
  const edgesAt = v.getUint16(0x0e, false)
  const fillsAt = v.getUint16(0x10, false)
  const base = v.getUint32(0x12, false)

  let slots = 0
  /** a stored pointer as a slot index, or -1 if it is not one */
  const slot = (p: number): number => {
    const d = p - base
    if (d < 0 || d % TD_SLOT_STRIDE !== 0) return -1
    const n = d / TD_SLOT_STRIDE
    if (n + 1 > slots) slots = n + 1
    return n
  }

  const build: TdBuild[] = []
  for (let o = buildAt; o + TD_BUILD_SIZE <= b.length; o += TD_BUILD_SIZE) {
    const dest = v.getUint32(o, false)
    if (dest === 0) break
    const r = [dest, v.getUint32(o + 4, false), v.getUint32(o + 8, false)].map(slot)
    if (r.some((n) => n < 0)) break
    build.push({ dest: r[0]!, a: r[1]!, b: r[2]! })
  }

  const edges: Array<[number, number]> = []
  for (let o = edgesAt; o + 8 <= b.length; o += 8) {
    const a = v.getUint32(o, false)
    if (a === 0) break
    const c = v.getUint32(o + 4, false)
    const [x, y] = [slot(a), slot(c)]
    if (x < 0 || y < 0) break
    edges.push([x, y])
  }

  const fills: TdFillPoint[][] = []
  let cur: TdFillPoint[] = []
  for (let o = fillsAt; o + TD_FILL_SIZE <= b.length; o += TD_FILL_SIZE) {
    const p = v.getUint32(o, false)
    if (p === 0) {
      // a zero record closes a polygon; one with nothing open ends the list
      if (!cur.length) break
      fills.push(cur)
      cur = []
      continue
    }
    const n = slot(p)
    if (n < 0) break
    cur.push({ slot: n, pen: b[o + 4]! })
  }
  if (cur.length) fills.push(cur)

  return { base, build, edges, fills, slots }
}

/**
 * Evaluate a surface's slots against the four projected corners of the face
 * it is stuck to — the pass at $217424 followed by the one at $2174d2.
 *
 * Slots 1 to 4 are the corners, in the order the face record names them;
 * $217424 copies ten bytes out of each working vertex, so a slot holds a
 * screen coordinate in sixteenths of a pixel like every other one. Slot 0 is
 * never referenced by any of the release's surfaces and is left undefined
 * here, because the engine leaves whatever was in it alone.
 *
 * NOTES: the constructor writes only the words at +$2 and +$6, so on the Amiga
 * a constructed slot keeps the high halves of the previous face's x and y. It
 * does not matter — nothing downstream reads more than the word — but it means
 * a slot is a 16-bit quantity in practice and the port stores it as one.
 */
export function tdSurfaceSlots(s: TdSurface, corners: Array<{ x: number; y: number }>): Array<{ x: number; y: number } | undefined> {
  const w = (n: number): number => (n << 16) >> 16
  const out: Array<{ x: number; y: number } | undefined> = new Array(Math.max(s.slots, 5)).fill(undefined)
  for (let i = 0; i < 4; i++) {
    const c = corners[i]
    if (c) out[i + 1] = { x: w(c.x), y: w(c.y) }
  }
  for (const r of s.build) {
    const a = out[r.a]
    const b = out[r.b]
    if (!a || !b) continue
    out[r.dest] = { x: w((a.x + b.x) >> 1), y: w((a.y + b.y) >> 1) }
  }
  return out
}

/** a surface polygon in screen coordinates, with the pen the engine fills it in */
export interface TdSurfaceFill {
  pen: number
  points: Array<{ x: number; y: number }>
}

/**
 * A surface's filled polygons, in screen coordinates.
 *
 * The pen is the byte the fill records carry, and it is a bitplane mask, not a
 * palette index: $21042a and $210438 test bit 0 and bit 1 of the pen global
 * and EOR into plane 0 and plane 1, the second reached by adding the plane
 * size at $21b2b2 twice over. So a surface draws in one of the bottom four
 * pens — which is the same four the object faces dither between, per the
 * sixteen pairs at a4+$54.
 *
 * The pen is taken from the first corner because that is the one whose byte is
 * live when the first edge is emitted. Every surface in the release writes the
 * same pen on all of a polygon's corners bar, sometimes, the closing repeat.
 */
export function tdSurfaceFills(s: TdSurface, corners: Array<{ x: number; y: number }>): TdSurfaceFill[] {
  const slots = tdSurfaceSlots(s, corners)
  const out: TdSurfaceFill[] = []
  for (const poly of s.fills) {
    const points: Array<{ x: number; y: number }> = []
    let ok = true
    for (const c of poly) {
      const p = slots[c.slot]
      if (!p) { ok = false; break }
      points.push(p)
    }
    if (ok && points.length >= 3) out.push({ pen: poly[0]!.pen, points })
  }
  return out
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
 * a4+$b32 and $2101c8 applies it to each row's sum. It does not come from the
 * file at all — $218de8 recomputes it every frame from how far the object is
 * from the viewpoint (`tdViewShift`), so it is a range scale, not a model
 * property.
 *
 * $215e54 copies a per-object origin out of the object's +$c0..+$c8 into
 * a4+$b34, and $2101c8 adds it after the view rotation rather than before —
 * so it is the object's position already expressed in the camera's frame,
 * `V * (objectWorld - viewpointWorld)`. That is the only composition
 * consistent with the data flow and with the transform being applied to
 * points that have already been rotated into the object's own attitude.
 */
/**
 * The per-object range shift, from $218de8.
 *
 * The three world deltas are OR'd together by magnitude, exactly as
 * `tdBearingCore` does. Under $4000 the shift is zero ($218f58 takes the
 * short path and stores zero into +$40). At or above it, the count starts at
 * $12 and comes down one for every position the accumulator has to be shifted
 * left before bit 31 is set — so a bigger separation buys a bigger shift, and
 * the products downstream stay inside a long.
 *
 * `andi.w #$c000,d0` masks only the low word and the `tst.l` that follows
 * looks at all 32 bits, so the test is "is the magnitude $4000 or more", not
 * anything about those two bits on their own.
 */
export function tdViewShift(viewpoint: TdFrame, frame: TdFrame): number {
  let acc = 0
  for (let i = 0; i < 3; i++) acc |= Math.abs((frame.pos[i]! - viewpoint.pos[i]!) | 0)
  if ((acc & 0xffff_c000) === 0) return 0
  let shift = 0x12
  let n = acc
  while ((n & 0x8000_0000) === 0) {
    shift--
    n = (n << 1) | 0
  }
  return shift
}

export function tdViewFor(viewpoint: TdFrame, frame: TdFrame, shift = tdViewShift(viewpoint, frame)): TdView {
  const matrix = tdMatrix(viewpoint.angle[0], viewpoint.angle[1], viewpoint.angle[2])
  const rel = {
    x: ((frame.pos[0] - viewpoint.pos[0]) | 0) >> shift,
    y: ((frame.pos[1] - viewpoint.pos[1]) | 0) >> shift,
    z: ((frame.pos[2] - viewpoint.pos[2]) | 0) >> shift,
  }
  const o = tdViewRotate(matrix, rel, 0)
  return { matrix, origin: [o.x, o.y, o.z], shift }
}

/** a face ready to fill: screen corners in sixteenths of a pixel */
export interface TdScreenFace {
  face: TdFace
  /** one entry per vertex, in winding order */
  points: Array<{ x: number; y: number }>
  /** the polygons the face's `.3DS` puts on top of it, if it has one */
  fills: TdSurfaceFill[]
  /** the two pens the face's block is dithered in */
  colour: TdDither
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
 *
 * Pass `obj` and each face's surface is evaluated too. A type-2 link record
 * names the byte offset its resolved pointer belongs at, and that offset is
 * the face record's own — a face's surface pointer is its first long — so
 * `linked` is keyed by exactly `face.at`.
 */
export function tdInstanceFaces(g: TdGeometry, attitude: TdMatrix, view: TdView, obj?: TdObject): TdScreenFace[] {
  const projected = g.points.map((p) => tdProject(view, tdRotate(attitude, p)))
  const blocks = obj ? parseTdBlocks(obj.file) : []
  const out: TdScreenFace[] = []
  for (const [i, face] of g.faces.entries()) {
    if (face.surface === 0) continue
    const projectedFace = face.vertices.map((n) => projected[n]!)
    if (projectedFace.some((p) => p.status !== 0)) continue
    const points = projectedFace.map((p) => ({ x: p.x, y: p.y }))
    const surface = obj?.linked.get(face.at)
    out.push({
      face,
      points,
      fills: surface ? tdSurfaceFills(parseTdSurface(surface.file), points) : [],
      colour: obj?.colours[tdBlockForFace(blocks, i)] ?? [0, 0],
    })
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
 * Every face arrives with its surface's polygons already evaluated, so what is
 * left is the scanline fill itself.
 *
 * NOTES: the port stops one step short of pixels. A face's own colour is a
 * dither pair rather than a pen — `Td Set Colour` writes two bytes through
 * $38(part) out of the sixteen pairs at a4+$54, each naming two of the bottom
 * four pens — and where a part's pair points before any Td Set Colour has not
 * been located, so the faces themselves have no colour to be filled with yet.
 * The surfaces on top of them do: their pens come out of the `.3DS`.
 */
/**
 * The draw order, from the bubble sort at $218cc4.
 *
 * The engine copies the live object list into a scratch array at a4+$32d4 and
 * bubbles adjacent pairs until a pass makes no swap. The comparison is two
 * rules in one, and which applies depends on the pair:
 *
 *     move.w $42(a0),d6      ; A's Td Priority
 *     move.w $42(a1),d5      ; B's
 *     move.l d6,d0 : or.w d5,d0 : bne $218d08
 *     move.l $1c(a0),d0 : cmp.l $1c(a1),d0 : bgt $218d0c   ; both zero: depth
 *     cmp.w d5,d6 : bge $218d14                            ; else: priority
 *
 * So a pair of zero-priority objects sorts on +$1c ascending, and any pair
 * with a priority between them sorts on priority descending. +$1c is written
 * at $21902e from what $218de8 returns, which is the object origin's Z in the
 * camera's frame — its depth into the screen — so nearest comes first.
 *
 * That is the rule the manual update on the Object Modeller coverdisk states
 * from the other side ("Undocumented Td Commands", Voodoo/Europress,
 * 31/10/1992): 0 draws by depth, above zero draws in front of everything
 * lower, below zero behind everything higher, and "if two objects have
 * non-zero priority the one with the highest priority will be drawn first (in
 * front)".
 *
 * The comparison is not a total order — a priority pair and a depth pair can
 * disagree about the same three objects — so which arrangement a list settles
 * into depends on the algorithm, and the bubble sort is reproduced rather than
 * handed to `Array.sort`.
 *
 * NOTES: first in this list is the front-most, and the port paints in reverse
 * so the front-most lands on top. The engine gets there the other way round,
 * drawing front to back; with a blitter mask that is the same picture, but it
 * is not the same mechanism, which is already noted against `td redraw`.
 */
export function tdSortInstances(st: TdState): Array<[number, TdInstance]> {
  const list = [...st.instances].sort((a, b) => a[0] - b[0])
  const depth = new Map<number, number>()
  for (const [n, inst] of list) depth.set(n, tdViewFor(st.viewpoint, inst).origin[2])
  for (let swapped = true; swapped; ) {
    swapped = false
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!
      const b = list[i + 1]!
      const pa = a[1].priority ?? 0
      const pb = b[1].priority ?? 0
      const swap = pa === 0 && pb === 0 ? depth.get(a[0])! > depth.get(b[0])! : pa < pb
      if (!swap) continue
      list[i] = b
      list[i + 1] = a
      swapped = true
    }
  }
  return list
}

export function tdRedrawFaces(st: TdState): Array<{ n: number; faces: TdScreenFace[] }> {
  const out: Array<{ n: number; faces: TdScreenFace[] }> = []
  for (const [n, inst] of tdSortInstances(st)) {
    const g = parseTdGeometry(inst.object.file)
    // Td Anim deforms this instance's own copy of the points
    if (inst.points) g.points = inst.points
    const attitude = tdMatrix(inst.angle[0], inst.angle[1], inst.angle[2])
    const faces = tdInstanceFaces(g, attitude, tdViewFor(st.viewpoint, inst), inst.object)
    inst.drawn = faces.length > 0
    out.push({ n, faces })
  }
  return out
}

// ---- the rasteriser ----

/**
 * The plane a background starts at.
 *
 * $210cc6 refuses a source when `srcPlanes + $28(a5) > destPlanes`, and
 * $28(a5) is not one of the seven numbers the keyword takes — the stub
 * supplies it. Every call in the demos behaves as though it is zero: Dice_Spin
 * copies a sixteen-colour picture on to a sixteen-colour screen, which only
 * fits with nothing to spare.
 *
 * Zero is also the reading that makes sense of the rasteriser. The background
 * is a full-depth picture and the 3D draws *over* it, changing only the
 * bottom two bits of each pixel, which is why a pen is a two-bit plane mask.
 * The picture keeps its upper planes and the objects appear in front of it.
 */
export const TD_BACKGROUND_PLANE = 0

/** the only width the engine will draw on, checked at $211418 */
export const TD_SCREEN_WIDTH = 320

/**
 * A projected x, in sixteenths of a pixel, as a column.
 *
 * `Td Screen X` is the same arithmetic in a keyword ($2126b6): the bounds are
 * `tdClipCode`'s, then `asr.l #4` and `moveq #$50,d1 : add.l d1,d1` — a
 * hundred and sixty, the middle of the only width 3D accepts.
 */
export function tdScreenX(x: number): number {
  return (x >> 4) + TD_SCREEN_WIDTH / 2
}

/**
 * The row a projected y lands on, and the row the horizon sits at.
 *
 * `Td Screen Height h` ($211570) keeps `h - 1` at a4+$4860 and `(h - 1) >> 1`
 * at a4+$4864, and $212688 turns a y into a row by subtracting: the screen's
 * y grows downwards and the model's grows up, so the centre row minus the
 * height is the answer. The bounds either side of it ($21266c) work out as
 * rows 1 to h-1 — row zero is never drawn on, which is where the engine keeps
 * the slack its edge lists need.
 */
export function tdCentreRow(height: number): number {
  return (height - 1) >> 1
}
export function tdScreenY(height: number, y: number): number {
  return tdCentreRow(height) - (y >> 4)
}

/**
 * Fill a polygon by scanlines, even-odd, calling `span` with an inclusive
 * pair of columns.
 *
 * NOTES: this is ours, and it is the one place in AMOS 3D where the port
 * stops copying the original. The engine draws each edge with the blitter in
 * line mode, EORing one bit per scanline into a mask ($210456 sets the octant
 * in d7 and shortens the run by one, $2104ea onwards drives $dff000), waits
 * ($2135cc polls DMACONR bit 14) and then runs a blitter area fill over it.
 * Reproducing that means emulating the blitter, so instead the same shape is
 * computed directly: an edge contributes a crossing to every row it spans
 * except its last, which is what shortening the line by one does, and the
 * crossings pair off left to right, which is what an inclusive area fill
 * does to an EOR mask. Horizontal edges contribute nothing, as at $2103f8.
 *
 * The vertices are already whole pixels when they arrive, because the engine
 * rounds them before it builds any edge — `andi.w #$fff0` on both ends at
 * $2103e6 and then `asr.w #4`. What is not reproduced is the sub-pixel path a
 * Bresenham line takes between two of them; a crossing here is interpolated,
 * so a long, shallow edge can sit one column either side of the original.
 */
export function tdScanFill(points: Array<{ x: number; y: number }>, span: (y: number, x0: number, x1: number) => void): void {
  if (points.length < 3) return
  let top = points[0]!.y
  let bottom = top
  for (const p of points) {
    if (p.y < top) top = p.y
    if (p.y > bottom) bottom = p.y
  }
  for (let y = top; y < bottom; y++) {
    const xs: number[] = []
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      if (a.y === b.y) continue
      const [lo, hi] = a.y < b.y ? [a, b] : [b, a]
      if (y < lo.y || y >= hi.y) continue
      xs.push(lo.x + Math.floor(((y - lo.y) * (hi.x - lo.x)) / (hi.y - lo.y)))
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) span(y, xs[i]!, xs[i + 1]!)
  }
}

/**
 * The rasteriser's own RastPort, over the screen's bitmap.
 *
 * A 3D pen is a two-bit plane mask — $21042a and $210438 btst bit 0 and bit 1
 * and EOR into plane 0 and plane 1 — so only the bottom two planes of a pixel
 * are touched and whatever the upper ones hold, a `Td Background` for
 * instance, survives underneath. That is `rp_Mask = %11`, and it used to be
 * written out longhand as a read-merge-write in a `tdPen` helper over a
 * hand-rolled two-method `TdRaster` interface.
 *
 * Its OWN RastPort rather than the screen's, and that is the substantive part.
 * The engine writes bitplanes directly — which is exactly why `Td Redraw`
 * ($211418) has to check the screen's depth and width itself instead of
 * letting a draw fail — so AMOS's drawing state never applied to it. Borrowing
 * `screen.rp` would newly subject the 3D area to `Gr Writing 2` and to
 * TURBO's `Set Planes`, neither of which the engine consults.
 *
 * Built per redraw, not cached: `Screen Swap` swaps `rp.bitMap` under a
 * double-buffered screen, and a kept RastPort would go on drawing into the
 * buffer that is now on the display.
 */
function tdRastPort(s: { rp: RastPort }): RastPort {
  const rp = new RastPort(s.rp.bitMap)
  rp.mask = 0b11
  rp.drawMode = 0 // JAM1: opaque, and never the caller's COMPLEMENT
  return rp
}

/**
 * Draw one face: the polygon in its block's dither, then whatever its surface
 * puts on top, in file order.
 *
 * NOTES: the dither pattern is a checkerboard on the sum of the coordinates,
 * with the first of the two pens on the even squares. That the two pens
 * alternate per pixel is not in doubt — it is why a4+$54 holds sixteen pairs
 * of four pens, and why [0,1] and [1,0] are listed as different colours when
 * as a set they are the same two pens. Which square each pen starts on is not
 * pinned down, because it is decided inside the blitter fill this does not
 * reproduce; getting it backwards swaps colour 1 with colour 10.
 */
export function tdDrawFace(t: RastPort, height: number, f: TdScreenFace): void {
  const rows = Math.min(height, t.height)
  const px = (p: { x: number; y: number }) => ({ x: tdScreenX(p.x), y: tdScreenY(height, p.y) })
  const paint = (poly: Array<{ x: number; y: number }>, pen: (x: number, y: number) => number): void => {
    tdScanFill(poly.map(px), (y, x0, x1) => {
      // row zero is outside the engine's own bounds, and so is anything past
      // the 3D area or either side of the 320 columns
      if (y < 1 || y >= rows) return
      // rp_Mask does the plane merge: the write lands in planes 0 and 1 and
      // leaves the rest of the pixel alone
      for (let x = Math.max(0, x0); x <= Math.min(TD_SCREEN_WIDTH - 1, x1); x++) t.plot(x, y, pen(x, y))
    })
  }
  const [a, b] = f.colour
  paint(f.points, (x, y) => ((x + y) & 1 ? b : a))
  for (const fill of f.fills) paint(fill.points, () => fill.pen)
}

// ---- animation ----

/**
 * `Td Move X/Y/Z n,spec$` and `Td Angle A/B/C n,spec$` — routines $211822 and
 * $211a14, one each with the axis in d2.
 *
 * "The movement string follows the same rules as those for sprites. Much of
 * the AMAL animation language is inappropriate and only a subset applies."
 * So the spec is AMOS's own STOS-compatible movement language and the parser
 * is shared with `Move X` rather than written twice — `(speed,step,count)`
 * groups, an optional leading start position, `L` to loop and `E` to stop.
 *
 * The engine's shape backs that up. $211822 takes the axis as `1 << d7`, gets
 * the frame through $21301c — so object zero, the viewpoint, can be animated
 * — and hands $21303e the list head at `$1e(frame)` for a position or
 * `$22(frame)` for an attitude. $21303e walks that list looking for a node
 * whose mask matches before it links a new one, which is why setting the same
 * axis twice replaces the animation instead of stacking a second one on it.
 * The node it builds is 24 bytes with a countdown at +$10 reloaded from +$4
 * and a delta at +$8: a (speed, step, count) group being stepped.
 *
 * NOTES: the step happens once per `Td Redraw`, not once per vertical blank.
 * That is where the engine does it — $21137e walks both lists per instance
 * and calls the stepper at $21321a — so a program that redraws every frame
 * sees the original speed, and one that redraws every other frame sees its
 * animations run at half pace. A sprite's Move X is not like this; it is
 * driven by the interrupt.
 */
export function tdSetAnim(frame: TdFrame, field: 'pos' | 'angle', axis: number, spec: string): void {
  const p = parseStosMove(spec)
  if (!frame.anims) frame.anims = new Map()
  frame.anims.set(`${field}${axis}`, {
    ...p,
    field,
    axis,
    gi: 0,
    speedLeft: 1,
    countLeft: p.groups[0]?.[2] || 0x10000,
    started: false,
    done: false,
  })
}

/** one step of one animation, the stepper at $213ad4 */
export function tdStepAnim(frame: TdFrame, a: TdAnim): void {
  if (a.done) return
  const v = frame[a.field]
  if (!a.started) {
    a.started = true
    if (a.start !== null) v[a.axis] = a.start | 0
  }
  if (--a.speedLeft > 0) return
  const g = a.groups[a.gi]
  if (!g) {
    a.done = true
    return
  }
  a.speedLeft = g[0]
  // 32 bits, not 16: a 3D coordinate is a long, and an angle relies on
  // wrapping at 32 rather than at 16 — see the note on tdVector
  const next = (v[a.axis]! + g[1]) | 0
  v[a.axis] = next
  if (a.endPos !== null && next === a.endPos) {
    tdRestartAnim(frame, a)
    return
  }
  if (--a.countLeft <= 0) {
    a.gi++
    const ng = a.groups[a.gi]
    if (!ng) tdRestartAnim(frame, a)
    else a.countLeft = ng[2] || 0x10000
  }
}

function tdRestartAnim(frame: TdFrame, a: TdAnim): void {
  if (!a.loop) {
    a.done = true
    return
  }
  if (a.start !== null) frame[a.field][a.axis] = a.start | 0
  a.gi = 0
  a.countLeft = a.groups[0]?.[2] || 0x10000
  a.speedLeft = a.groups[0]?.[0] ?? 1
}

/** every live frame's animations, one step — the loop at $211394 */
export function tdStepAnims(st: TdState): void {
  for (const frame of [st.viewpoint, ...st.instances.values()]) {
    if (!frame.anims) continue
    for (const a of frame.anims.values()) tdStepAnim(frame, a)
  }
}
