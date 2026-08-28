/**
 * IntuiExtend 2.01b, by CIERP Philippe, slot 23 — the 3D block.
 *
 * 301 keywords in one 23,084-byte code hunk, and the whole of it readable:
 * there is no source, but there is no need for any. Routine 0 is the
 * extension's init and it is six instructions long:
 *
 *     $1d14  movem.l  a3-a6, -(a7)
 *     $1d18  lea.l    $1d28(pc), a3
 *     $1d1c  move.l   a3, $258(a5)
 *     $1d20  movem.l  (a7)+, a3-a6
 *     $1d24  moveq    #$16, d0
 *
 * So the workspace every keyword reaches through `$258(a5)` is not allocated
 * at run time. It is static data at $1d28 inside the code hunk, 1,888 bytes
 * of it, and the file itself holds every table the library owns. The single
 * HUNK_CODE and the absence of any HUNK_DATA or HUNK_BSS are what make that
 * safe to rely on.
 *
 * ## The transform
 *
 * `Wb 3d Point` (routine 183, $4108) is three 2D rotations in 8-bit fixed
 * point, an eye translation and a perspective divide, in that order. Its
 * state sits at workspace+$5aa:
 *
 *     $00 $02 $04   the three cosines
 *     $06 $08 $0a   the three sines
 *     $0c $10 $14   the last projected X, Y, Z
 *     $18 $1c $20   eye X, Y, Z
 *     $24 $28       centre X, Y
 *
 * Every multiply is `muls.w`, so a coordinate is used sixteen bits at a time
 * however large the long the program supplied. Every scale-down is `asr.l #8`,
 * which floors rather than truncating. The projection is
 * `centre + (coord * 2 * centre) / z`, computed with `divs.w`, so the focal
 * length is not a setting: it is twice whatever `Wb 3d Centre` was given.
 *
 * ## The trig table
 *
 * `Wb 3d Angle` (routine 188, $41f6) indexes workspace+$216 by `angle * 2`
 * for the cosine and the same index into workspace+$216+$b4 for the sine, so
 * one table serves both and the sine is the cosine ninety entries on. It is
 * 458 words and it ends at $5aa, exactly where the transform state starts,
 * which is the whole of it.
 *
 * Index 0 holds 255 and index 359 holds 256, so the curve peaks one entry
 * BEFORE the start: the table is `floor(256 * cos((i + 1) degrees))`. That
 * reproduces 456 of the 458 words. See `IE_COS_ARTEFACTS` for the two it
 * does not.
 *
 * Because the sine is read at index+90 and the table is 458 long, an angle
 * above 367 reads the transform state as trig data. `Wb 3d Angle` checks
 * nothing.
 *
 * ## Objects
 *
 * `Wb 3d Make Object` (routine 291, $557c) allocates and stamps `IE3D`. The
 * author documents the layout himself: `IntuiExtend_2.0.Guide` indexes the
 * extension by group and the 3D group's nodes are in its
 * `documentation/TreeD.guide`, which gives the structure the routine builds:
 *
 *     Struct OBJ:
 *             LStr    'IE3D'
 *     Liste des edges:
 *             Word    Nombre de edge
 *             Long    Edge X
 *             Long    Edge Y
 *             Long    Edge Z
 *     Liste des shapes:
 *             Word    Nombre de shape
 *             Word    Point 1
 *
 * An "edge" is a point and a "shape" is a four-cornered polygon, which is the
 * author's naming throughout and is kept here so the keywords read as he
 * documented them.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, int, type Value } from '../interp/values'
import { MemPool } from '../amiga/exec'
import { ieAntiqTable } from './intuiextendsys'
import { newIePrintState, type IePrintState } from './intuiextendgfx'
import {
  IE_NO_BASE,
  newIeNewScreen,
  newIeNewWindow,
  newIeWindowState,
  type IeNewScreen,
  type IeNewWindow,
  type IeWindowState,
} from './intuiextendwin'
import { newIeMsgBlock, newIePortState, type IeMsgBlock, type IePortState } from './intuiextendmsg'

/** `cmp.l #$49453344` at $4f0a, $55f0 and $5920 — 'IE3D' */
export const IE3D_MAGIC = 0x49453344

/** words in the trig table: $216 to $5aa is $394 bytes */
export const IE_COS_ENTRIES = 458

/** `adda.w #$b4, a2` at $4200 — the sine is the cosine ninety entries on */
export const IE_SIN_OFFSET = 90

/**
 * The two words `floor(256 * cos((i + 1) degrees))` does not reproduce.
 *
 * At 240 and 300 degrees the cosine is exactly -0.5 and +0.5, so 256 times it
 * is exactly -128 and +128 and no rounding rule can land anywhere else. The
 * shipped table holds -129 and 127, each one below. At 60 and 120 degrees,
 * where the arithmetic is the same, it holds the exact values.
 *
 * That asymmetry is not a rule, it is the author's own floating point coming
 * out a fraction low on two of the four exact halves. The table is generated
 * here and these two are put back, which is two words of correction rather
 * than 458 of shipped data.
 */
export const IE_COS_ARTEFACTS: ReadonlyArray<readonly [number, number]> = [
  [239, -129],
  [299, 127],
]

/** the table at workspace+$216, as the library ships it */
export function ieCosTable(): Int16Array {
  const t = new Int16Array(IE_COS_ENTRIES)
  for (let i = 0; i < IE_COS_ENTRIES; i++) {
    t[i] = Math.floor(256 * Math.cos(((i + 1) * Math.PI) / 180) + 1e-9)
  }
  for (const [i, v] of IE_COS_ARTEFACTS) t[i] = v
  return t
}

/**
 * IntuiExtend's heap.
 *
 * `Alloc Mem` (routine 35, $2ce2) is `jsr -$c6(ExecBase)`, AllocMem, and hands
 * the address straight back to the program; `Wb 3d Make Object` is one of its
 * callers. So the blocks have to sit at real, ordered addresses that `Peek`
 * can reach, which is what MemPool is for.
 *
 * 0x30000000 because nothing below D-Sam's heap at 0x34000000 is claimed.
 */
const HEAP_BASE = 0x3000_0000
const HEAP_RESERVED = 0x0400_0000

export interface IntuiextendState {
  /** workspace+$216, generated rather than shipped */
  readonly cos: Int16Array
  /**
   * workspace+$5aa..$5b5 — the three cosines then the three sines, in the
   * order the library stores them, so `Wb 3d Angle`'s odd argument mapping
   * stays visible rather than being tidied into a vector.
   */
  trig: Int16Array
  /** workspace+$5b6, $5ba, $5be — what `Wb 3d X`, `Y` and `Z` return */
  out: Int32Array
  /** workspace+$5c2, $5c6, $5ca */
  eye: Int32Array
  /** workspace+$5ce, $5d2 */
  centre: Int32Array
  heap: MemPool
  /** workspace+$58, the sixteen-word sepia ramp `Pal Antiq` indexes */
  readonly antiq: Int16Array
  /** workspace+$84, what `Load Seg` fills and `Segment Base` reports */
  segment: number
  /** -$90(a5), the word `Wb Locker` writes and nothing in the library reads */
  locker: number
  /** -$1c(a5), the task pointer `My Task` hands back */
  task: number
  /** tc_Node.ln_Name, which `Task Name` points at a string rather than copying */
  taskName: string
  /** what `Set Taskpri` last recorded; there is one task and no scheduler */
  taskPri: number
  /** what `Wb Setchip Rev` last asked graphics for; the machine is already AGA */
  chipRev: number
  /** workspace+$88, the mode `Wb Paint` hands to graphics `Flood` */
  paintMode: number
  /** workspace+$b0, the IntuiText the whole `Wb Print` family writes */
  print: IePrintState
  /** rp_TxSpacing, which `Wb Text Spacing` writes and no RastPort here models */
  textSpacing: number
  /** workspace+$90, the one NewScreen every `Wb Screen Open` fills and reuses */
  newScreen: IeNewScreen
  /** workspace+$1c, the one NewWindow, and the reason two opens are not independent */
  newWindow: IeNewWindow
  /** workspace+$8c, `Wb Screen Base`; -1 after a close, 0 after a failed open */
  screenBase: number
  /** workspace+$18, `Wb Wind Base` */
  windBase: number
  /** the open windows, by the handle `Wb Wind Base` hands out */
  windowState: IeWindowState
  /** workspace+$e6, what `Wb Next Pubscreen` fills and `Wb Pubscreen Name` reads */
  pubName: string
  /** what SetPubScreenModes last took, so the next call can answer the previous */
  pubModes: number
  /** the same, for PubScreenStatus */
  pubStatus: number
  /**
   * -$18ca(a5) when `Wb Window` has pointed it at a window's RastPort.
   *
   * Zero means AMOS's own current screen, which is what the longword holds
   * until something writes it. `Wb Screen` moves the screen instead and leaves
   * this at zero, because a screen's RastPort address is derivable.
   */
  amosRp: number
  /** workspace+$78 and +$6e0, the copy `Get Msg` takes before it replies */
  msg: IeMsgBlock
  /** the MsgPorts `Wb Create Msgport` and `Wb Create Port` made */
  portState: IePortState
}

export function newIntuiextendState(): IntuiextendState {
  return {
    cos: ieCosTable(),
    trig: new Int16Array(6),
    out: new Int32Array(3),
    eye: new Int32Array(3),
    centre: new Int32Array(2),
    heap: new MemPool(HEAP_BASE, HEAP_RESERVED),
    antiq: ieAntiqTable(),
    // routine 23 writes -1 here when LoadSeg fails, and nothing has loaded yet
    segment: -1,
    locker: 0,
    // one modelled task; the pointer only has to be stable and non-zero
    task: IE_TASK,
    taskName: '',
    taskPri: 0,
    chipRev: 0,
    paintMode: 0,
    print: newIePrintState(),
    textSpacing: 0,
    newScreen: newIeNewScreen(),
    newWindow: newIeNewWindow(),
    // `dc.l -1` in the shipped workspace at +$8c and +$18, which is also what
    // a close writes back
    screenBase: IE_NO_BASE,
    windBase: IE_NO_BASE,
    windowState: newIeWindowState(),
    pubName: '',
    pubModes: 0,
    pubStatus: 0,
    amosRp: 0,
    msg: newIeMsgBlock(),
    portState: newIePortState(),
  }
}

/**
 * What `My Task` answers.
 *
 * AMOS keeps its own task pointer at `-$1c(a5)` and routine 17 is three
 * instructions that hand it straight back. Nothing in the extension
 * dereferences it; `Task Name` and `Set Taskpri` take a task from the caller
 * and are the only things that would. A fixed non-zero value is therefore the
 * whole of the observable behaviour.
 */
export const IE_TASK = 0x0100_0000

/** the low word of a long, signed — every operand of a `muls.w` */
const w = (v: number): number => (v << 16) >> 16

/** `muls.w`: the 32-bit product of two low words, which always fits */
const mulsw = (a: number, b: number): number => Math.imul(w(a), w(b))

/**
 * `divs.w` followed by `ext.l`, which is how every divide here is spelled.
 *
 * A 68000 that cannot fit the quotient in sixteen bits leaves the destination
 * UNCHANGED and sets V, so the `ext.l` that follows sign-extends the low word
 * of the dividend instead of a quotient. Reproduced because the projection
 * divides by Z, and a small enough Z overflows for any interesting X.
 */
const divswExt = (num: number, den: number): number => {
  const d = w(den)
  if (d === 0) return num // the 68000 traps; see `project`
  const q = Math.trunc(num / d)
  if (q < -0x8000 || q > 0x7fff) return w(num)
  return q
}

export function makeIntuiextendInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IntuiextendState => rt.intuiextend

  /**
   * Routine 183 ($4108), the whole of the 3D maths.
   *
   * Arguments reach a routine last-first, so `Wb 3d Point X,Y,Z` pops Z into
   * d5, Y into d6 and X into d7, which is the register assignment the rest of
   * the routine is written around.
   */
  const project = (x: number, y: number, z: number): void => {
    const s = st()
    const t = s.trig
    let d7 = x | 0
    let d6 = y | 0
    let d5 = z | 0

    // $4116: (Y, Z) about the third angle argument
    let d4 = ((mulsw(d6, t[0]!) + mulsw(d5, t[3]!)) | 0) >> 8
    d5 = ((mulsw(d5, t[0]!) - mulsw(d6, t[3]!)) | 0) >> 8
    d6 = d4

    // $4132: (X, Z) about the second
    const d3 = ((mulsw(d7, t[1]!) + mulsw(d5, t[4]!)) | 0) >> 8
    d5 = ((mulsw(d5, t[1]!) - mulsw(d7, t[4]!)) | 0) >> 8
    d7 = d3

    // $4152: (Y, X) about the first
    d4 = ((mulsw(d6, t[2]!) + mulsw(d7, t[5]!)) | 0) >> 8
    d7 = ((mulsw(d7, t[2]!) - mulsw(d6, t[5]!)) | 0) >> 8
    d6 = d4

    // $4172
    d7 = (d7 + s.eye[0]!) | 0
    d6 = (d6 + s.eye[1]!) | 0
    d5 = (d5 + s.eye[2]!) | 0

    /*
     * $417e. `add.w d4,d4` doubles only the low word, and `muls.w` reads only
     * the low word, so the focal length is `(centre * 2) & $ffff` signed.
     *
     * DEVIATION: a zero Z divides by zero, which on the Amiga is a processor
     * exception and here is a quotient of the dividend. The `beq` above the
     * divide spares the one case where the product is zero, and nothing else
     * in the routine checks.
     */
    let px = mulsw(d7, s.centre[0]! + s.centre[0]!)
    if (px !== 0) px = divswExt(px, d5)
    d7 = (px + s.centre[0]!) | 0

    let py = mulsw(d6, s.centre[1]! + s.centre[1]!)
    if (py !== 0) py = divswExt(py, d5)
    d6 = (py + s.centre[1]!) | 0

    // $41a2
    s.out[0] = d7
    s.out[1] = d6
    s.out[2] = d5
  }

  /** the object's point count, at base+4 (`move.w $4(a0),d0` at $55c8) */
  const pointCount = (addr: number): number => {
    const m = rt.resolveAddr((addr + 4) >>> 0)
    return m ? (((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)) : 0
  }

  const readLong = (addr: number): number => {
    const l = rt.longsAt(addr >>> 0, false)
    return l ? l.get(0) : 0
  }

  const writeLong = (addr: number, v: number): void => {
    const l = rt.longsAt(addr >>> 0, true)
    if (l) l.set(0, v)
  }

  const writeWord = (addr: number, v: number): void => {
    const m = rt.resolveWrite(addr >>> 0)
    if (!m) return
    m.data[m.off] = (v >>> 8) & 0xff
    m.data[m.off + 1] = v & 0xff
  }

  const readWord = (addr: number): number => {
    const m = rt.resolveAddr(addr >>> 0)
    if (!m) return 0
    return (((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)) << 16 >> 16
  }

  const isObject = (addr: number): boolean => (readLong(addr) >>> 0) === IE3D_MAGIC

  /** three integers separated by commas, the shape of most of this group */
  const xyz = (it: Parameters<Instr>[0]): [number, number, number] => {
    const a = it.evalInt()
    it.expect(',')
    const b = it.evalInt()
    it.expect(',')
    const c = it.evalInt()
    return [a, b, c]
  }

  return {
    /**
     * Wb 3d Point X,Y,Z — routine 183 ($4108). Projects and stores; the
     * result comes back through `Wb 3d X`, `Y` and `Z` and nothing is drawn.
     */
    'wb 3d point'(it) {
      const [x, y, z] = xyz(it)
      project(x, y, z)
    },

    /**
     * Wb 3d Eye X,Y,Z — routine 186 ($41ce). Three longs into workspace+$5c2,
     * added to the rotated coordinates before the divide.
     */
    'wb 3d eye'(it) {
      const [x, y, z] = xyz(it)
      const s = st()
      s.eye[0] = x | 0
      s.eye[1] = y | 0
      s.eye[2] = z | 0
    },

    /**
     * Wb 3d Centre X,Y — routine 187 ($41e4). Both the screen origin the
     * projection is measured from and, doubled, its focal length.
     */
    'wb 3d centre'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = st()
      s.centre[0] = x | 0
      s.centre[1] = y | 0
    },

    /**
     * Wb 3d Angle A,B,C — routine 188 ($41f6).
     *
     * The first argument is stored at $4/$a, the second at $2/$8 and the
     * third at $0/$6, and `Wb 3d Point` applies them in the opposite order:
     * the third argument rotates first. Not tidied, because a program written
     * against the library depends on which pair moves which axis.
     *
     * The index is `angle * 2` with no mask and no bounds check, so a
     * negative angle or one above 367 reads outside the table.
     */
    'wb 3d angle'(it) {
      const [a, b, c] = xyz(it)
      const s = st()
      const cosAt = (n: number): number => s.cos[n] ?? 0
      s.trig[2] = cosAt(a)
      s.trig[5] = cosAt(a + IE_SIN_OFFSET)
      s.trig[1] = cosAt(b)
      s.trig[4] = cosAt(b + IE_SIN_OFFSET)
      s.trig[0] = cosAt(c)
      s.trig[3] = cosAt(c + IE_SIN_OFFSET)
    },

    /**
     * Wb 3d Plot X,Y,Z — routine 194 ($43bc). `Rbsr` into routine 183, then
     * `exg.l d7,d6` and routine 200, which writes one pixel in the current
     * AMOS RastPort's colour (`move.b $19(a2),d4` is rp_FgPen).
     */
    'wb 3d plot'(it) {
      const [x, y, z] = xyz(it)
      project(x, y, z)
      const s = st()
      const scr = rt.screen
      if (!scr) return
      scr.rp.cpX = w(s.out[0]!)
      scr.rp.cpY = w(s.out[1]!)
      scr.rp.plot(scr.rp.cpX, scr.rp.cpY, scr.rp.fgPen)
    },

    /**
     * Wb 3d Locate X,Y,Z — routine 195 ($43d2). Projects and moves the
     * graphics cursor, writing rp_cp_x and rp_cp_y as words and drawing
     * nothing. It does not call graphics `Move`.
     */
    'wb 3d locate'(it) {
      const [x, y, z] = xyz(it)
      project(x, y, z)
      const s = st()
      const scr = rt.screen
      if (!scr) return
      scr.rp.cpX = w(s.out[0]!)
      scr.rp.cpY = w(s.out[1]!)
    },

    /**
     * Wb 3d Draw X,Y,Z — routine 197 ($440c). Projects, then
     * `jsr -$f6(GfxBase)`, which the GUI 2.10 `graphics_lib.fd` gives as
     * `Draw`. Both coordinates go through `move.w`, so the line is drawn to
     * the low words of the projection.
     */
    'wb 3d draw'(it) {
      const [x, y, z] = xyz(it)
      project(x, y, z)
      const s = st()
      const scr = rt.screen
      if (!scr) return
      const nx = w(s.out[0]!)
      const ny = w(s.out[1]!)
      scr.rp.draw(scr.rp.cpX, scr.rp.cpY, nx, ny, scr.rp.fgPen)
      scr.rp.cpX = nx
      scr.rp.cpY = ny
    },

    /**
     * Wb 3d Ink N — routine 199 ($445c).
     *
     * Two bytes: `rts`. The keyword parses its argument and does nothing at
     * all, so the 3D group draws in whatever colour `Ink` last set. Not an
     * omission here — that is the whole routine.
     */
    'wb 3d ink'(it) {
      it.evalInt()
    },

    /**
     * Wb 3d Edge X,Y,Z To NB,OBJECT — routine 294 ($55ec). Sets point NB's
     * coordinates. The count is one-based: `subq.w #$1,d0` at $5600.
     *
     * A block without the `IE3D` stamp is not an error. `bne.b $5616` skips
     * to `adda.l #$10,a3`, which drops the four remaining arguments and
     * returns.
     */
    'wb 3d edge'(it) {
      const [x, y, z] = xyz(it)
      it.expect('to')
      const nb = it.evalInt()
      it.expect(',')
      const obj = it.evalInt()
      if (!isObject(obj)) return
      const at = (obj + 6 + w((nb - 1) * 12)) >>> 0
      writeLong(at, x)
      writeLong((at + 4) >>> 0, y)
      writeLong((at + 8) >>> 0, z)
    },

    /**
     * Wb 3d Shape S0,S1,S2,S3 To NB,OBJECT — routine 270 ($4f06). Four point
     * numbers into polygon NB, also one-based.
     */
    'wb 3d shape'(it) {
      const s0 = it.evalInt()
      it.expect(',')
      const s1 = it.evalInt()
      it.expect(',')
      const s2 = it.evalInt()
      it.expect(',')
      const s3 = it.evalInt()
      it.expect('to')
      const nb = it.evalInt()
      it.expect(',')
      const obj = it.evalInt()
      if (!isObject(obj)) return
      const at = (obj + 8 + pointCount(obj) * 12 + w((nb - 1) * 8)) >>> 0
      writeWord(at, s0)
      writeWord((at + 2) >>> 0, s1)
      writeWord((at + 4) >>> 0, s2)
      writeWord((at + 6) >>> 0, s3)
    },

    /**
     * Wb 3d Move Edge X,Y,Z To NB,OBJECT — routine 284 ($545a). Adds to one
     * point rather than replacing it.
     *
     * DEFECT: NB is ZERO-based here where `Wb 3d Edge`'s is one-based. There
     * is no `subq.w #$1` at $5464, only `asl.w #$2 / mulu.w #$3 / addq.l #$6`,
     * so `Wb 3d Move Edge ... To 1,O` moves the point `Wb 3d Edge ... To 2,O`
     * set. The guide gives no hint of it: this one's argument is
     * "NB=Numéros d'un point de l'objet 3d." and the other's is
     * "NB=Numero du point affecté pour X, Y et Z", one point number either way.
     */
    'wb 3d move edge'(it) {
      const [x, y, z] = xyz(it)
      it.expect('to')
      const nb = it.evalInt()
      it.expect(',')
      const obj = it.evalInt()
      const at = (obj + 6 + w(nb * 12)) >>> 0
      writeLong(at, (readLong(at) + x) | 0)
      writeLong((at + 4) >>> 0, (readLong((at + 4) >>> 0) + y) | 0)
      writeLong((at + 8) >>> 0, (readLong((at + 8) >>> 0) + z) | 0)
    },

    /**
     * Wb 3d Move Object X,Y,Z To OBJECT — routine 271 ($4f48).
     *
     * DEFECT: it reads the point count from the wrong offset and walks off
     * the end of the object. Every other object keyword steps over the four
     * magic bytes first; this one does not, and `move.w (a0)+,d0` at $4f50
     * therefore takes the HIGH WORD OF THE MAGIC as its loop count. $4945 is
     * 18,757, so the `dbra` at $4f5a adds the offsets to 18,757 points --
     * 225,084 bytes -- starting at the magic itself rather than at the first
     * point.
     *
     * The guide leaves no room for the argument being anything else. Its
     * synopsis is "Wb 3d Move Object X,Y,Z To OBJECT" and its entry for that
     * argument is "OBJECT=Adresse du block de mémoire reservé pour l'objet.",
     * the same wording every other object keyword's node uses.
     *
     * Reproduced, bounded by what the heap maps: writes past the end land
     * nowhere, as they would on an Amiga with nothing mapped there.
     */
    'wb 3d move object'(it) {
      const [x, y, z] = xyz(it)
      it.expect('to')
      const obj = it.evalInt()
      const count = readWord(obj) // the magic's high word, not the count
      let at = (obj + 2) >>> 0
      for (let i = 0; i <= (count - 1 & 0xffff); i++) {
        if (!rt.resolveAddr(at)) break
        writeLong(at, (readLong(at) + x) | 0)
        writeLong((at + 4) >>> 0, (readLong((at + 4) >>> 0) + y) | 0)
        writeLong((at + 8) >>> 0, (readLong((at + 8) >>> 0) + z) | 0)
        at = (at + 12) >>> 0
      }
    },

    /**
     * Wb 3d Erase Object OBJECT / Wb 3d Clear Object OBJECT — routine 292
     * ($55c4), which both names share. It recomputes the object's size from
     * its two counts and tail-calls `Free Mem`, so a corrupted count frees
     * the wrong length.
     */
    'wb 3d erase object': eraseObject,
    'wb 3d clear object': eraseObject,

    /**
     * Wb 3d Draw Object OBJECT — routine 318 ($591c).
     *
     * An edge record is four vertex indices, so each one is a quadrilateral.
     * The routine locates to the first corner, draws to the other three, and
     * closes: `move.w d7,(a6)+ / move.w d6,(a6)` at $5970 parks the first
     * corner's PROJECTED position in the four bytes at $59d8, and the
     * `Rbsr routine 277` at $59c8 pushes them back and draws to them. Routine
     * 277 ($50d4) is nothing but `Draw` on AMOS's own RastPort.
     *
     * Reading that closing call takes the AMOS escape decoder. $59c8 is
     * `$fe31 $0115`, and a 68000 disassembler renders the $F-line word as a
     * coprocessor opcode and swallows the operand, which loses the call and
     * leaves the polygon looking open.
     *
     * The guide gives this one as `Wb 3d Draw Object OBJECT To RPORT` and is
     * dated 08/12/98 where the rest of the 3D nodes are 13/08/95. This build
     * takes one argument -- its token spec is `I0` and $591c pops a single
     * long -- so the second is a later addition the binary does not have.
     */
    'wb 3d draw object'(it) {
      const obj = it.evalInt()
      if (!isObject(obj)) return
      const points = pointCount(obj)
      const shapesAt = (obj + 6 + points * 12) >>> 0
      const shapes = readWord(shapesAt) & 0xffff
      const scr = rt.screen
      // `subq.w #$1 / asl.w #$2 / mulu.w #$3` — the first two keep the low
      // word, the third reads only the low word and writes all 32 bits
      const pointAt = (n: number): [number, number, number] => {
        const p = (obj + 6 + ((((n - 1) << 2) & 0xffff) >>> 0) * 3) >>> 0
        return [readLong(p), readLong((p + 4) >>> 0), readLong((p + 8) >>> 0)]
      }
      const lineTo = (nx: number, ny: number): void => {
        if (!scr) return
        scr.rp.draw(scr.rp.cpX, scr.rp.cpY, nx, ny, scr.rp.fgPen)
        scr.rp.cpX = nx
        scr.rp.cpY = ny
      }
      for (let sIdx = 1; sIdx <= shapes; sIdx++) {
        const rec = (shapesAt + 2 + (sIdx - 1) * 8) >>> 0
        const first = readWord(rec) & 0xffff
        let [x, y, z] = pointAt(first)
        project(x, y, z)
        // the four bytes at $59d8, written before the inner loop runs
        const closeX = w(st().out[0]!)
        const closeY = w(st().out[1]!)
        if (scr) {
          scr.rp.cpX = closeX
          scr.rp.cpY = closeY
        }
        for (let c = 1; c <= 3; c++) {
          const n = readWord((rec + c * 2) >>> 0) & 0xffff
          ;[x, y, z] = pointAt(n)
          project(x, y, z)
          lineTo(w(st().out[0]!), w(st().out[1]!))
        }
        lineTo(closeX, closeY)
      }
    },
  }

  function eraseObject(it: Parameters<Instr>[0]): void {
    const obj = it.evalInt()
    st().heap.freeMem(obj >>> 0)
  }
}

export function makeIntuiextendFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0

  return {
    /** =Wb 3d X — routine 184 ($41b0), workspace+$5b6 */
    'wb 3d x': () => VI(st().out[0]!),
    /** =Wb 3d Y — routine 185 ($41be), workspace+$5ba */
    'wb 3d y': () => VI(st().out[1]!),
    /** =Wb 3d Z — routine 191 ($425c), workspace+$5be */
    'wb 3d z': () => VI(st().out[2]!),

    /**
     * =Wb 3d Position(X1,Y1,X2,Y2,X3,Y3) — routine 192 ($426c).
     *
     * Twice the signed area of the triangle, which is what a caller uses to
     * decide whether a polygon faces the viewer.
     *
     * DEFECT: only the first of the three subtractions is done in 32 bits.
     * $4282 and `$428a` are `move.w d3,d7` and `move.w d5,d7`, which leave d7
     * carrying the HIGH WORD OF Y1 from the `move.l d1,d7` at $427a. So the
     * second and third terms subtract a value built from one argument's low
     * word and another's high word. Harmless while every coordinate fits in
     * sixteen bits, which is every coordinate the projection can produce.
     */
    'wb 3d position': (_, a) => {
      const y1 = i0(a, 1)
      const x2 = i0(a, 2)
      const y2 = i0(a, 3)
      const x3 = i0(a, 4)
      const y3 = i0(a, 5)
      const x1 = i0(a, 0)
      // $4278: d7 = y1, full long
      let d7 = y1
      const t1 = mulsw((y2 - d7) | 0, x3)
      // $4284: only d7's low word is replaced
      d7 = ((d7 & ~0xffff) | (y2 & 0xffff)) | 0
      const t2 = mulsw((y3 - d7) | 0, x1)
      // $428c: and again
      d7 = ((d7 & ~0xffff) | (y3 & 0xffff)) | 0
      const t3 = mulsw((y1 - d7) | 0, x2)
      return VI(((t1 + t2) | 0) + t3 | 0)
    },

    /**
     * =Wb 3d Make Object(PEDGENB,PSHAPNB) — routine 291 ($557c).
     *
     * `4 + 2 + points*12 + 2 + shapes*8`, allocated MEMF_PUBLIC|MEMF_CLEAR
     * (`move.l #$10001,-(a3)` at $559a), then the magic and the two counts.
     * Returns -1 when the allocation fails: `moveq #$ff,d3` at $55c0 is a
     * sign-extended byte, not 255.
     */
    'wb 3d make object': (_, a) => {
      const points = i0(a, 0)
      const shapes = i0(a, 1)
      const s = st()
      const pointBytes = w(points * 4) * 3
      const shapeBytes = w(shapes * 2) * 4
      const size = w(pointBytes + shapeBytes + 8)
      const addr = s.heap.alloc(size, { clear: true })
      if (addr === 0) return VI(-1)
      const l = rt.longsAt(addr, true)
      if (l) l.set(0, IE3D_MAGIC | 0)
      const put = (at: number, v: number): void => {
        const m = rt.resolveWrite(at >>> 0)
        if (!m) return
        m.data[m.off] = (v >>> 8) & 0xff
        m.data[m.off + 1] = v & 0xff
      }
      put(addr + 4, points)
      put(addr + 6 + pointBytes, shapes)
      return VI(addr | 0)
    },
  }
}
