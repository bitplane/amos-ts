/**
 * Personnal — an ECS/AGA display extension by Frederic Cordler (FireWorks),
 * 1995-96. Slot 13 (`ExtNb Equ 13-1`).
 *
 * ## Evidence
 *
 * `AMOSPro_Personnal.Lib.s`, 4534 lines of assembler, ships with the 1.0b
 * shareware binary and covers all 108 of its keyword names. Line numbers
 * below are into that file. The 18 keywords 1.1a adds have no source and are
 * read from the extension's own AmigaGuide instead; those say so
 * individually.
 *
 * ## What it does, and why it needs the copper interpreter
 *
 * Personnal does not use AMOS's screen system. It builds a copper list of its
 * own at an address the program hands it, and every display keyword after
 * that is a patch to one word of that list — `Set Resolution` is bit 15 of
 * BPLCON0, `Set Lace` is bit 2, `Set Screen Sizes` writes the two modulos.
 * The extension's whole state is a handful of pointers into the list it
 * built.
 *
 * So the keywords here write real copper words into the program's memory,
 * and what appears on screen is whatever Runtime's list interpreter makes of
 * them once the program points the hardware at it (`Active Copper`, batch 4).
 * Building a list does not display it, here or on the Amiga.
 */
import { AmosError, VI, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import { Runtime } from './runtime'

/**
 * The extension's own error table (ErrMess, +AMOSPro_Personnal.Lib.s:4485).
 * Routine 122 raises one of these by index, so a program gets the message the
 * real library would have given it, in the French the author wrote.
 */
export const PERSONNAL_ERRORS = [
  'Adresse pour copper list INVALIDE.',
  'Copper list non reservee.',
  'Registre de couleur invalide.',
  'BMHD non trouve.',
  'Une ou plusieurs bases ecran INVALIDE(S).',
  'Banque memoire trop petite.',
  'CMAP non trouve.Fichier IFF/ILBM corrompu.',
  '2e Ecran copper non cree.',
  "Pas assez de memoire pour l'allocation!!!",
  'Aga Icon bank non reservee.',
  "Fichier d'un format inconnu.",
  'Multi Plot bank non reservee.',
  'Multi Plot bank deja reservee.',
  'Point demande HORS limite de reservation.',
  'Valeur permise de 1 a 8 seulement.',
  'Aga Icon bank deja reservee.',
] as const

const err = (n: number): never => {
  throw new AmosError(PERSONNAL_ERRORS[n] ?? PERSONNAL_ERRORS[0])
}

/**
 * The extension's memory registers, named as the source names them
 * (+AMOSPro_Personnal.Lib.s:385-450). Addresses point into the copper list
 * the program asked it to build, which is why they are plain numbers: a later
 * keyword reaches them with the same arithmetic the 68k does.
 */
export interface PersonnalState {
  /** _CopperBase — the list itself */
  copperBase: number
  /** _SprPtBase — the eight sprite pointer moves */
  sprPtBase: number
  /** _ColorBase — the colour block (8 banks of 32 under Create Aga) */
  colorBase: number
  /** _BplPtBase — BPL1PTH..BPL8PTL */
  bplPtBase: number
  /** _Others — DIWSTRT, DIWSTOP, DDFSTRT, DDFSTOP, BPL1MOD, BPL2MOD, CLXCON */
  others: number
  /** _BplConBase — BPLCON0..BPLCON3 */
  bplConBase: number
  /** _CurrentLine */
  currentLine: number
  /** _Line — the display start line, $32 after either builder */
  line: number
  /** _Aga — 0 for a Create Standard list, non-zero for Create Aga */
  aga: number
  /** _2nd — the second playfield's list, batch 6 */
  second: number
  /** _XY — screen size, defaulting to 320x192 ($140,$C0) */
  xy: [number, number]
  /** _XYOff — X1,Y1,X2,Y2 scroll offsets */
  xyOff: [number, number, number, number]
  /** _D4 — the last Screen Position type */
  d4: number
  /** _BitsPlanes (:383) — the eight displayed plane addresses */
  planes: number[]
  /** _BitsPlanesD (:447) — the back set Swap Planes exchanges with */
  planesD: number[]
  /** _MpP (:397) — how many planes the Mplot engine draws into; defaults to 8 */
  mpP: number
  /** _Mplots (:394) — how many points the bank holds, 0 when unreserved */
  mplots: number
  /** _Origin (:396) — the x,y the Mplot coordinates are measured from */
  origin: [number, number]
  /** _MpBase (:395) — the point bank's address, 0 when unreserved */
  mpBase: number
  /** _DoubleCopper — non-zero while a second list is being assembled */
  doubleCopper: number
  /** _CurrentPal — the AGA colour bank the appended moves are in */
  currentPal: number
  /** _AgaPalette — the 256-entry shadow Set Color(n) reads back from */
  agaPalette: number[]
}

/**
 * _PlanesMask (:399), indexed by plane count 0..8. Seven counts live in
 * BPLCON0's BPU field at bits 12-14; the eighth is bit 4, BPU3, because AGA
 * ran out of room in the original field.
 */
const PLANES_MASK = [0x0, 0x1000, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000, 0x7000, 0x10] as const

export function newPersonnalState(): PersonnalState {
  return {
    copperBase: 0,
    sprPtBase: 0,
    colorBase: 0,
    bplPtBase: 0,
    others: 0,
    bplConBase: 0,
    currentLine: 0,
    line: 0x32,
    aga: 0,
    second: 0,
    // _XY Dc.l $140,$C0
    xy: [320, 192],
    xyOff: [0, 0, 0, 0],
    d4: 0,
    planes: new Array(8).fill(0),
    planesD: new Array(8).fill(0),
    mpP: 8,
    mplots: 0,
    origin: [0, 0],
    mpBase: 0,
    doubleCopper: 0,
    currentPal: 0,
    agaPalette: new Array(256).fill(0),
  }
}

/** Longword into the fake address space, as the 68k's `Move.l dn,(a0)+` does. */
function putL(rt: Runtime, addr: number, v: number): void {
  const m = rt.resolveWrite(addr)
  if (!m || m.off + 3 >= m.data.length) return
  m.data[m.off] = (v >>> 24) & 0xff
  m.data[m.off + 1] = (v >>> 16) & 0xff
  m.data[m.off + 2] = (v >>> 8) & 0xff
  m.data[m.off + 3] = v & 0xff
}

/** Word at addr, for the read-modify-write patches. */
function getW(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  if (!m || m.off + 1 >= m.data.length) return 0
  return ((m.data[m.off]! << 8) | m.data[m.off + 1]!) & 0xffff
}

function putW(rt: Runtime, addr: number, v: number): void {
  const m = rt.resolveWrite(addr)
  if (!m || m.off + 1 >= m.data.length) return
  m.data[m.off] = (v >> 8) & 0xff
  m.data[m.off + 1] = v & 0xff
}

/**
 * Create Standard addr (L26, :1008) and Create Aga addr (L10, :566).
 *
 * The two builders are the same list except for the colour block: Standard
 * writes one bank of 32 COLOR moves, Aga writes eight, each preceded by a
 * BPLCON3 bank select ($0106, +$2000 a bank) — which is how AGA addresses
 * 256 colours through 32 registers.
 */
function buildList(rt: Runtime, addr: number, aga: boolean): void {
  if (addr === 0) err(0)
  const s = rt.personnal
  s.copperBase = addr
  let p = addr
  const put = (v: number): void => {
    putL(rt, p, v)
    p += 4
  }

  put(0x1003fffe) // WAIT line $10
  put(0x01fc0000) // FMODE 0 — "Anti Double Scanning"

  s.sprPtBase = p
  for (let d = 0x01200000; d !== 0x01400000; d += 0x20000) put(d) // SPR0PTH..SPR7PTL

  put(0x1803fffe) // WAIT line $18
  s.colorBase = p
  if (aga) {
    // eight banks: BPLCON3 selects, then 32 COLOR moves
    for (let bank = 0x01060000; bank !== 0x01070000; bank += 0x2000) {
      put(bank)
      for (let c = 0x01800000; c !== 0x01c00000; c += 0x20000) put(c)
    }
  } else {
    for (let c = 0x01800000; c !== 0x01c00000; c += 0x20000) put(c)
  }

  put(0x3103fffe) // WAIT line $31
  put(0x00960100) // DMACON: bitplane DMA off while the pointers are set
  s.bplPtBase = p
  for (let d = 0x00e00000; d !== 0x01000000; d += 0x20000) put(d) // BPL1PTH..BPL8PTL

  s.others = p
  put(0x008e0181) // DIWSTRT
  put(0x009037c1) // DIWSTOP
  put(0x00920038) // DDFSTRT — $38 unscrolled, $30 scrolled
  put(0x009400d0) // DDFSTOP
  put(0x01080000) // BPL1MOD
  put(0x010a0000) // BPL2MOD
  put(0x0098ffc0) // CLXCON

  s.bplConBase = p
  put(0x01001000) // BPLCON0 — one plane
  put(0x01020000) // BPLCON1
  put(0x01040024) // BPLCON2
  put(0x01060c00) // BPLCON3 — $c00 for the PAL second field

  put(0x3203fffe) // WAIT line $32
  put(0x00968300) // DMACON: bitplane DMA back on
  s.currentLine = p
  put(0xf203fffe) // WAIT line $F2
  put(0x00960100) // off again below the display
  put(0xf303fffe) // WAIT line $F3
  put(0x01060000) // BPLCON3 back to AMOS's default
  put(0xfffffffe) // end

  s.line = 0x32
  s.aga = aga ? 1 : 0
  s.second = 0
}

/**
 * Copy the plane addresses into the list's BPLxPT moves (_spb, :779, and
 * again in Swap Planes at _nbb, :3357).
 *
 * The 68k copies WORDS out of _BitsPlanes: a longword address read as two
 * words is its own high half then low half, which is exactly the PTH then PTL
 * a pointer pair wants. Twelve words for six planes, sixteen for eight — the
 * loop counts are 11 and 15 with a Bpl, so one more than they look.
 */
function writePlanePointers(rt: Runtime, s: PersonnalState): void {
  const words = s.aga ? 16 : 12
  for (let i = 0; i < words; i++) {
    const addr = s.planes[i >> 1] ?? 0
    const w = i & 1 ? addr & 0xffff : (addr >>> 16) & 0xffff
    putW(rt, s.bplPtBase + i * 4 + 2, w)
  }
}

function getB(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  return m && m.off < m.data.length ? m.data[m.off]! : 0
}

function putB(rt: Runtime, addr: number, v: number): void {
  const m = rt.resolveWrite(addr)
  if (m && m.off < m.data.length) m.data[m.off] = v & 0xff
}

/**
 * The wrapping add the three single-field defines share (L105-L107,
 * :4142/:4171/:4201). Past the bound it wraps to 0, below zero to bound-1 —
 * which is what makes a starfield loop without the program checking.
 *
 * Note the read is UNSIGNED here, where X Mplot sign-extends the same word.
 * A point holding a negative coordinate therefore steps from 65536-odd rather
 * than from where X Mplot says it is, and lands on 0 the first time. Kept as
 * found; it is the difference between reading a point and stepping one.
 */
function defineAdd(rt: Runtime, n: number, field: number, add: number, bound: number): void {
  const s = rt.personnal
  if (s.mpBase === 0) err(11)
  const at = s.mpBase + 8 + (n - 1) * 6 + field
  let v = getW(rt, at) + add
  if (v >= bound) v = 0
  else if (v < 0) v = bound - 1
  putW(rt, at, v & 0xffff)
}

/**
 * Append a WAIT to the list and re-terminate after it (_lw :846 and
 * :1294). Both line keywords share this: they overwrite the tail the last
 * append left, write the wait, remember where the list now ends, and put a
 * fresh tail back. `hb` is the second byte of the wait — $01 for Copper Next
 * Line, $03 for Copper Wait Line.
 *
 * The tail differs for the second playfield's list: an ordinary one shuts the
 * display down at lines $F2/$F3, a second one stops at $14.
 */
function appendWait(rt: Runtime, s: PersonnalState, line: number, hb: number): void {
  let p = s.currentLine
  putW(rt, p, ((line & 0xff) << 8) | hb)
  putW(rt, p + 2, 0xfffe)
  p += 4
  s.currentLine = p
  s.line = line
  if (s.second === 1) {
    putL(rt, p, 0x1403fffe)
    putL(rt, p + 4, 0x01000000)
    putL(rt, p + 8, 0x00960100)
    putL(rt, p + 12, 0xfffffffe)
  } else {
    putL(rt, p, 0xf201fffe)
    putL(rt, p + 4, 0x01000000)
    putL(rt, p + 8, 0x00960100)
    putL(rt, p + 12, 0xf301fffe)
    putL(rt, p + 16, 0xfffffffe)
  }
}

/** One sign-extended word of a point, shared by X/Y/C Mplot. */
function mplotWord(rt: Runtime, n: number, field: number): number {
  const s = rt.personnal
  if (s.mpBase === 0) err(11)
  const w = getW(rt, s.mpBase + 8 + (n - 1) * 6 + field)
  return w & 0x8000 ? w | ~0xffff : w
}

export function makePersonnalInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /** Create Standard addr (L26, :1008) */
    'create standard'(it) {
      buildList(rt, it.evalInt(), false)
    },
    /** Create Aga addr (L10, :566) */
    'create aga'(it) {
      buildList(rt, it.evalInt(), true)
    },

    /**
     * Set Screen Sizes x,y (L23, :961). X floors at 320 and Y at 192 — the
     * routine compares and substitutes rather than clamping upward, so a
     * smaller request simply becomes the minimum. The size then goes into the
     * list as the two modulos, (X-320)>>3 at _Others+18 and +22.
     */
    'set screen sizes'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = rt.personnal
      s.xy = [Math.max(x, 320), Math.max(y, 192)]
      if (s.others === 0) err(1)
      const mod = (s.xy[0] - 320) >> 3
      putW(rt, s.others + 18, mod)
      putW(rt, s.others + 22, mod)
    },

    /** Set Resolution n (L29, :1246) — BPLCON0 bit 15, HIRES */
    'set resolution'(it) {
      const hi = it.evalInt() !== 0
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      const a = s.bplConBase + 2
      putW(rt, a, hi ? getW(rt, a) | 0x8000 : getW(rt, a) & ~0x8000)
    },

    /** Set Lace n (L30, :1264) — BPLCON0 bit 2, LACE */
    'set lace'(it) {
      const on = it.evalInt() !== 0
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      const a = s.bplConBase + 2
      putW(rt, a, on ? getW(rt, a) | 0x0004 : getW(rt, a) & ~0x0004)
    },

    /**
     * Set Plane n,address (L16, :758). Records the address and rewrites every
     * pointer in the list, not just this one. A plane number outside 1-8 is
     * ignored in silence — the routine branches straight to its RTS — where
     * no list at all is the error.
     */
    'set plane'(it) {
      const n = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      const s = rt.personnal
      if (s.copperBase === 0) err(1)
      if (n < 1 || n > 8) return
      s.planes[n - 1] = addr >>> 0
      writePlanePointers(rt, s)
    },

    /**
     * Set D Plane n,address (L85, :3325). The back set. It only records —
     * nothing reaches the list until Swap Planes, and it raises nothing at
     * all, not even for a missing list.
     */
    'set d plane'(it) {
      const n = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      if (n < 1 || n > 8) return
      rt.personnal.planesD[n - 1] = addr >>> 0
    },

    /**
     * Swap Planes (L86, :3339). Exchanges all eight addresses with the back
     * set and rewrites the pointers — the double buffer flip. Guarded on the
     * first plane rather than on the list: an unset _BitsPlanes[0] is what
     * raises "Copper list non reservee.", so swapping before any Set Plane
     * is the error even if a list exists.
     */
    'swap planes'() {
      const s = rt.personnal
      if ((s.planes[0] ?? 0) === 0) err(1)
      for (let i = 0; i < 8; i++) {
        const t = s.planes[i]!
        s.planes[i] = s.planesD[i]!
        s.planesD[i] = t
      }
      writePlanePointers(rt, s)
    },

    /**
     * Set View Planes n (L21, :872). How many planes the display fetches,
     * through BPLCON0's BPU. Above six is ignored unless the list was built
     * by Create Aga. The mask comes from _PlanesMask, and the routine clears
     * bit 4 along with 12-14 before OR-ing it in, because eight planes is
     * BPU3 at bit 4 rather than a fourth bit up top.
     */
    'set view planes'(it) {
      const n = it.evalInt()
      const s = rt.personnal
      if (s.aga === 0 && n > 6) return
      if (s.copperBase === 0) err(1)
      if (n < 0 || n > 8) return
      const a = s.bplConBase + 2
      const kept = getW(rt, a) & ~0x7010
      putW(rt, a, kept | PLANES_MASK[n]!)
    },

    /**
     * Mplot Planes n (L109, :4236). How many planes the point engine draws
     * into. Unlike the plane setters this one refuses a bad count out loud,
     * with ErrMess 14.
     */
    'mplot planes'(it) {
      const n = it.evalInt()
      if (n < 1 || n > 8) err(14)
      rt.personnal.mpP = n
    },

    /**
     * Screen Position type,x,y (L27, :1097). Scrolls the display by moving
     * the bitplane pointers, which is how you scroll when there is no screen
     * object to ask.
     *
     * type 1 positions the first playfield, 2 the second, anything else
     * both. The offsets live in _XYOff as X1,Y1,X2,Y2 — the source's own
     * register comments at _S3 mislabel which register holds which, so the
     * store order above is what settles it.
     *
     * A pixel X splits in two: (X>>4)*2 bytes of whole-word step added to the
     * pointer, and 16-(X and 15) of BPLCON1 scroll for the remainder, zeroed
     * when there is no remainder. The two playfields' scrolls pack as
     * (scroll2<<4)|scroll1, and even-indexed planes take offset 1 while odd
     * ones take offset 2 — the dual-playfield split.
     *
     * Scrolling also moves DDFSTRT a word earlier ($30 rather than $38) and
     * takes 2 off both modulos to pay for the extra fetch, which overrides
     * what Set Screen Sizes wrote there.
     */
    'screen position'(it) {
      const type = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const s = rt.personnal
      s.d4 = type
      if (type === 1) {
        s.xyOff[0] = x
        s.xyOff[1] = y
      } else if (type === 2) {
        s.xyOff[2] = x
        s.xyOff[3] = y
      } else {
        s.xyOff = [x, y, x, y]
      }

      const [x1, y1, x2, y2] = s.xyOff
      const rowBytes = s.xy[0] >> 3
      // whole-word step plus the row, per playfield
      let off1 = y1 * rowBytes + (x1 >> 4) * 2
      let off2 = y2 * rowBytes + (x2 >> 4) * 2
      // and the leftover pixels become BPLCON1 delay
      const rem = (v: number): number => {
        const r = 16 - (v - (v >> 4) * 16)
        return r === 16 ? 0 : r
      }
      const scroll1 = rem(x1)
      const scroll2 = rem(x2)
      const bplcon1 = (scroll2 << 4) + scroll1

      if ((s.planes[0] ?? 0) === 0) err(1)
      // a playfield with no sub-word scroll steps back a word when the other
      // one has some (Cmp.b #0,d4 / #0,d6 against _D4, :1170)
      if (scroll1 === 0 && s.d4 !== 0) off1 -= 2
      if (scroll2 === 0 && s.d4 !== 0) off2 -= 2

      const shifted: number[] = []
      for (let i = 0; i < 8; i++) shifted.push(((s.planes[i] ?? 0) + (i & 1 ? off2 : off1)) >>> 0)

      // always sixteen words here, where Set Plane writes twelve unless the
      // list is an Aga one (_S3d :1185 counts 15 unconditionally)
      for (let i = 0; i < 16; i++) {
        const a = shifted[i >> 1]!
        putW(rt, s.bplPtBase + i * 4 + 2, i & 1 ? a & 0xffff : (a >>> 16) & 0xffff)
      }
      putW(rt, s.bplConBase + 6, bplcon1)

      const mod = (s.xy[0] - 320) >> 3
      if (bplcon1 !== 0) {
        putW(rt, s.others + 10, 0x30) // DDFSTRT one word earlier
        putW(rt, s.others + 18, mod - 2)
        putW(rt, s.others + 22, mod - 2)
      } else {
        putW(rt, s.others + 10, 0x38)
        putW(rt, s.others + 18, mod)
        putW(rt, s.others + 22, mod)
      }
    },

    /**
     * Mplot Reserve n (L94, :3694). Allocates the point bank itself with
     * AllocMem rather than reserving an AMOS bank — n*6+8 bytes of cleared
     * chip memory, headed by the cookie "F.C2" and the point count, then six
     * bytes a point: X word, Y word, ink word.
     *
     * Reserving twice is an error, and so is running out of memory; here only
     * the first can happen.
     */
    'mplot reserve'(it) {
      const n = it.evalInt()
      const s = rt.personnal
      if (s.mplots !== 0) err(12)
      s.mplots = n
      const mem = new Uint8Array(n * 6 + 8)
      mem.set([0x46, 0x2e, 0x43, 0x32]) // "F.C2"
      mem[4] = (n >>> 24) & 0xff
      mem[5] = (n >>> 16) & 0xff
      mem[6] = (n >>> 8) & 0xff
      mem[7] = n & 0xff
      rt.personnalMem = mem
      s.mpBase = Runtime.PERSONNAL_BASE
    },

    /** Mplot Erase (L95, :3729). Frees the bank; erasing an unreserved one is quiet. */
    'mplot erase'() {
      const s = rt.personnal
      if (s.mplots === 0) return
      s.mplots = 0
      s.mpBase = 0
      rt.personnalMem = null
    },

    /**
     * Mplot Define n,x,y,c (L98, :3904). Six bytes at base+8+(n-1)*6.
     * A missing bank and an out-of-range point are different errors — 11 and
     * 13 — and the count is checked against the header rather than the
     * register, so it reads back what was actually allocated.
     */
    'mplot define'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      const s = rt.personnal
      if (s.mpBase === 0) err(11)
      if (n < 1 || n > s.mplots) err(13)
      const at = s.mpBase + 8 + (n - 1) * 6
      putW(rt, at, x & 0xffff)
      putW(rt, at + 2, y & 0xffff)
      putW(rt, at + 4, c & 0xffff)
    },

    /**
     * Mplot Draw first To last (L100, :3937). The engine, and the reason the
     * bank exists — a starfield redraws by walking the whole range every
     * frame.
     *
     * Per point: read X and Y sign-extended, add the origin, reject anything
     * outside 0..X-1 and 0..Y-1, then split the position into a byte offset
     * of `y*(width>>3) + (x>>3)` and a bit of `7-(x and 7)`, MSB leftmost.
     * The ink is written a plane at a time — bit d4 of the colour decides
     * whether plane d4 is set or cleared — for _MpP planes.
     *
     * A plane address of zero abandons the whole POINT, not just that plane
     * (_Mpp1's Beq goes to _xxl, :4006), so a gap in the middle of the plane
     * list truncates the pixel rather than skipping a layer.
     *
     * These are direct planar writes into the addresses Set Plane recorded.
     * resolveWrite hands back the screen's planar mirror and flips its
     * authority, so the chunky side re-decodes on the next read — the port
     * keeps both faithfully (screen.ts:127-392) and nothing extra is needed
     * here.
     */
    'mplot draw'(it) {
      const first = it.evalInt()
      it.expect('to')
      const last = it.evalInt()
      const s = rt.personnal
      if (s.mpBase === 0) err(11)
      const [width, height] = s.xy
      const rowBytes = width >> 3
      const xMax = width - 1
      const yMax = height - 1
      // The range excludes `last`. The loop tests after the pointer has
      // stepped a whole point (Cmp.l a0,a1 / Bgt at _xxl, :4027), so a range
      // ending at the address of `last` stops just short of it. The guide
      // says the opposite — "jusqu'au point LAST" — and every demo writes
      // `Mplot Draw 1 To NUM` after reserving NUM, so the last point silently
      // never draws. Source beats manual, and this is what the library does.
      for (let n = first; n < Math.max(first + 1, last); n++) {
        const at = s.mpBase + 8 + (n - 1) * 6
        const sx = (w: number): number => (w & 0x8000 ? w | ~0xffff : w)
        const x = sx(getW(rt, at)) + s.origin[0]
        const y = sx(getW(rt, at + 2)) + s.origin[1]
        const ink = getW(rt, at + 4)
        if (x < 0 || x > xMax || y < 0 || y > yMax) continue
        const off = y * rowBytes + (x >> 3)
        const bit = 7 - (x & 7)
        for (let p = 0; p < s.mpP; p++) {
          const plane = s.planes[p] ?? 0
          if (plane === 0) break // the point is abandoned, not the plane
          const a = plane + off
          const b = getB(rt, a)
          putB(rt, a, ink & (1 << p) ? b | (1 << bit) : b & ~(1 << bit))
        }
      }
    },

    /**
     * Mplot X/Y/C Define n,add (L105/L106/L107). One field of one point,
     * stepped and wrapped — X against the screen width, Y against its height,
     * C against 256.
     */
    'mplot x define'(it) {
      const n = it.evalInt()
      it.expect(',')
      defineAdd(rt, n, 0, it.evalInt(), rt.personnal.xy[0])
    },
    'mplot y define'(it) {
      const n = it.evalInt()
      it.expect(',')
      defineAdd(rt, n, 2, it.evalInt(), rt.personnal.xy[1])
    },
    'mplot c define'(it) {
      const n = it.evalInt()
      it.expect(',')
      defineAdd(rt, n, 4, it.evalInt(), 256)
    },

    /**
     * Mplot Modify first To last,xadd,yadd (L104, :4090). The bulk form of
     * the field defines: steps X and Y of every point in the range, wrapping
     * each against its own screen dimension. Same exclusive upper bound as
     * Mplot Draw, and for the same reason.
     */
    'mplot modify'(it) {
      const first = it.evalInt()
      it.expect('to')
      const last = it.evalInt()
      it.expect(',')
      const xadd = it.evalInt()
      it.expect(',')
      const yadd = it.evalInt()
      const s = rt.personnal
      if (s.mpBase === 0) err(11)
      for (let n = first; n < Math.max(first + 1, last); n++) {
        defineAdd(rt, n, 0, xadd, s.xy[0])
        defineAdd(rt, n, 2, yadd, s.xy[1])
      }
    },

    /**
     * Mplot Load name$ (L96, :3751). The file is the bank: "F.C2", the point
     * count, then the points.
     *
     * The original reads back `count * 260` bytes into a buffer sized
     * `count * 6 + 8` — 260 is the icon stride, left in from the icon loader
     * this was copied from, and Mplot Save writes with 6. It only fails to
     * overrun because the file ends first. We read what the points actually
     * occupy.
     */
    'mplot load'(it) {
      const name = it.evalStr()
      const data = rt.vfs?.readFile(name) ?? null
      if (!data || data.length < 8) err(10)
      const d = data!
      const cookie = String.fromCharCode(d[0]!, d[1]!, d[2]!, d[3]!)
      if (cookie !== 'F.C2') err(10)
      const count = ((d[4]! << 24) | (d[5]! << 16) | (d[6]! << 8) | d[7]!) >>> 0
      const mem = new Uint8Array(count * 6 + 8)
      mem.set(d.subarray(0, Math.min(d.length, mem.length)))
      rt.personnalMem = mem
      const s = rt.personnal
      s.mplots = count
      s.mpBase = Runtime.PERSONNAL_BASE
    },

    /** Mplot Save name$ (L97, :3847) — the header then count*6 bytes */
    'mplot save'(it) {
      const name = it.evalStr()
      const s = rt.personnal
      if (s.mplots === 0 || rt.personnalMem === null) err(11)
      rt.vfs?.writeFile(name, rt.personnalMem!.subarray(0, s.mplots * 6 + 8))
    },

    /**
     * Lsr Zone source To target (L110, :4248). Moves a block of memory four
     * bytes forward, walking backwards from the top so an overlapping move
     * does not eat itself. Both addresses are forced even first
     * (And #$fffffffe) because the 68k cannot read a longword at an odd one.
     *
     * The longword at `source` itself is not moved — the walk stops as soon
     * as it is reached.
     */
    'lsr zone'(it) {
      const source = it.evalInt() & 0xfffffffe
      it.expect('to')
      const target = it.evalInt() & 0xfffffffe
      let a1 = target - 4
      let a2 = target
      // a do-while: the first longword moves before anything is checked
      for (;;) {
        const m = rt.resolveAddr(a1)
        if (m && m.off + 3 < m.data.length) {
          const v = (m.data[m.off]! << 24) | (m.data[m.off + 1]! << 16) | (m.data[m.off + 2]! << 8) | m.data[m.off + 3]!
          putL(rt, a2, v >>> 0)
        }
        a1 -= 4
        a2 -= 4
        if (a1 <= source) break
      }
    },

    /** Mplot Origin x,y (L108, :4229) — where the coordinates are measured from */
    'mplot origin'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      rt.personnal.origin = [x, y]
    },

    /**
     * Active Copper (L37, :1660) — `Move.l d0,$dff080`, COP1LC. The single
     * instruction that makes everything the other keywords built visible.
     *
     * It does not turn AMOS's own copper off; the programs do that themselves
     * (EcsCopper/Rainbows.AMOS is `Copper Off` then `Active Copper`), and on
     * the real machine AMOS's vbl rebuild would otherwise take the display
     * straight back.
     */
    'active copper'() {
      const s = rt.personnal
      if (s.copperBase === 0) err(1)
      rt.copList1Addr = s.copperBase
    },

    /** Copper Base addr (L15, :751) — point the extension at an existing list */
    'copper base'(it) {
      rt.personnal.copperBase = it.evalInt()
    },

    /**
     * Copper Next Line (L19, :830) and Copper Wait Line n (L31, :1282).
     * Both append a WAIT and re-terminate. Next Line waits for the line after
     * the last one, wrapping past $100; Wait Line takes the line outright.
     * The second byte of the wait differs, $01 against $03, which is the
     * horizontal position each stops at.
     */
    'copper next line'() {
      const s = rt.personnal
      if (s.copperBase === 0) err(1)
      let line = s.line + 1
      if (line >= 0x100) line -= 0x100
      appendWait(rt, s, line, 0x01)
    },
    'copper wait line'(it) {
      const line = it.evalInt()
      const s = rt.personnal
      // a no-op while a second list is being built (the _DoubleCopper guard)
      if (s.doubleCopper !== 0) return
      if (s.currentLine === 0) err(1)
      appendWait(rt, s, line, 0x03)
    },

    /**
     * Vb Line Wait n (L74, :2961) spins on VPOSR until the beam reaches the
     * line, clamping past 381 to 383. There is no beam here and nothing to
     * spin on, so this yields the frame instead — the effect a program wants
     * from it, without the wait it actually performs.
     */
    'vb line wait'(it) {
      void it.evalInt()
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },

    /**
     * Set Color reg,r,g,b (L12, :671). Writes one entry of the colour block
     * the builder laid down, packed as 12-bit RGB4.
     *
     * Finding entry `reg` is a walk rather than an index, because an Aga list
     * has a BPLCON3 bank select every 33rd longword: the loop steps over any
     * entry whose register word is $0106 before counting (_sc2, :690). One
     * routine therefore addresses both list shapes.
     */
    'set color'(it) {
      const reg = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const g = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = rt.personnal
      if (s.colorBase === 0) err(1)
      const rgb = ((r << 8) | (g << 4) | b) & 0xffff
      let a = s.colorBase
      for (let seen = 0; seen <= reg; seen++) {
        if (getW(rt, a) === 0x0106) a += 4 // step over a bank select
        if (seen === reg) break
        a += 4
      }
      putW(rt, a + 2, rgb)
    },

    /**
     * New Color Value reg,r,g,b (L22, :906). A colour change at the line the
     * list has reached — the rainbow primitive. Appends over the tail, as the
     * line keywords do.
     *
     * reg is 0..255 across eight banks of 32. When the bank differs from the
     * last one used, a BPLCON3 select goes in first and _CurrentPal
     * remembers it, so a run of colours in one bank costs one select rather
     * than one each.
     */
    'new color value'(it) {
      const reg = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const g = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = rt.personnal
      if (s.doubleCopper !== 0) return
      if (s.copperBase === 0) err(1)
      if (reg < 0 || reg > 255) err(2)
      const rgb = ((r << 8) | (g << 4) | b) & 0xffff
      const bank = reg >> 5
      let p = s.currentLine
      if (bank !== s.currentPal) {
        s.currentPal = bank
        putL(rt, p, (0x01060000 + bank * 0x2000) >>> 0)
        p += 4
      }
      putW(rt, p, 0x0180 + (reg - (bank << 5)) * 2)
      putW(rt, p + 2, rgb)
      p += 4
      s.currentLine = p
      putL(rt, p, 0xf201fffe)
      putL(rt, p + 4, 0x01000000)
      putL(rt, p + 8, 0x00960100)
      putL(rt, p + 12, 0xf301fffe)
      putL(rt, p + 16, 0xfffffffe)
    },

    /**
     * X Fade (L13, :701). One step of a fade to black over the WHOLE list:
     * every COLOR00..COLOR31 move in it loses one from each non-zero RGB
     * nibble. Programs call it in a loop with a Wait between — the Rainbows
     * demo runs `For I=1 To 16 : X Fade : Wait 4 : Next`.
     *
     * It walks to the $FFFFFFFE terminator, so it fades the per-line colours
     * New Color Value appended as readily as the block ones.
     */
    'x fade'() {
      const s = rt.personnal
      if (s.copperBase === 0) err(1)
      let a = s.copperBase
      for (let guard = 0; guard < 0x4000; guard++) {
        const reg = getW(rt, a)
        const val = getW(rt, a + 2)
        if (reg >= 0x0180 && reg <= 0x01be) {
          let red = val & 0xf00
          let green = val & 0x0f0
          const blue = val & 0x00f
          if (red !== 0) red -= 0x100
          if (green !== 0) green -= 0x10
          putW(rt, a + 2, red + green + (blue !== 0 ? blue - 1 : 0))
        }
        a += 4
        if (((getW(rt, a) << 16) | getW(rt, a + 2)) >>> 0 === 0xfffffffe) break
      }
    },

    /** Set Ntsc (L3, :524) — BEAMCON0 $DFF1DC = 0 */
    'set ntsc'() {
      rt.beamcon0 = 0x0000
    },
    /** Set Pal (L4, :528) — BEAMCON0 = $0020, PAL */
    'set pal'() {
      rt.beamcon0 = 0x0020
    },

    /**
     * Aga Off (L61, :2672). Two direct register writes, not a list patch:
     * FMODE $DFF1FC = 0 turns double scanning off, BPLCON3 $DFF106 = 0 puts
     * the colour bank back to 0-31 so AMOS's own palette means what it says
     * again.
     */
    'aga off'() {
      rt.fmode = 0
      rt.bplcon3Direct = 0
    },
  }
}

export function makePersonnalFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * Screen X Size (L24, :989) and Screen Y Size (L25, :998).
     *
     * Both re-apply the floor when they read rather than trusting what was
     * stored, so they answer 320/192 even if _XY somehow holds less.
     */
    'screen x size'(): Value {
      return VI(Math.max(rt.personnal.xy[0], 320))
    },
    'screen y size'(): Value {
      return VI(Math.max(rt.personnal.xy[1], 192))
    },

    /**
     * Set Color(n) (L18, :810). Reads the _AgaPalette shadow, not the list,
     * and answers -1 for a register out of range — 0..255 on an Aga list,
     * 0..31 otherwise.
     *
     * Note the asymmetry: the shadow is filled by the AGA colour keywords in
     * this batch's second half, NOT by `Set Color reg,r,g,b`, which writes
     * only the copper list. Reading back a colour set that way answers 0.
     * That is the library's behaviour, not an omission here.
     */
    'set color'(_, a): Value {
      const n = int(a[0]!)
      const s = rt.personnal
      if (n < 0 || n > 255) return VI(-1)
      if (s.aga === 0 && n > 31) return VI(-1)
      return VI(s.agaPalette[n] ?? 0)
    },

    /** Copper Base (L14, :744) and Copper Line (L20, :866) — plain readers */
    'copper base'(): Value {
      return VI(rt.personnal.copperBase)
    },
    'copper line'(): Value {
      return VI(rt.personnal.line)
    },

    /** Mplot Base (L99, :3931) — the bank address, or 0 */
    'mplot base'(): Value {
      return VI(rt.personnal.mpBase)
    },

    /**
     * X Mplot(n) / Y Mplot(n) / C Mplot(n) (L101-L103, :4033-:4073).
     *
     * Each reads its word out of the point and sign-extends it (Btst #15 then
     * Or #$ffff0000), so a point placed off the left of the origin reads back
     * negative. Only the missing bank is an error — the point number is not
     * range-checked at all here, unlike Mplot Define.
     */
    'x mplot'(_, a): Value {
      return VI(mplotWord(rt, int(a[0]!), 0))
    },
    'y mplot'(_, a): Value {
      return VI(mplotWord(rt, int(a[0]!), 2))
    },
    'c mplot'(_, a): Value {
      return VI(mplotWord(rt, int(a[0]!), 4))
    },

    /**
     * Plane Base(n) (L17, :794). The address Set Plane recorded, or 0 for a
     * plane outside 1-8 — the routine zeroes d3 before it validates, so an
     * out-of-range ask is answered rather than refused.
     */
    'plane base'(_, a): Value {
      const n = int(a[0]!)
      if (n < 1 || n > 8) return VI(0)
      return VI(rt.personnal.planes[n - 1] ?? 0)
    },
  }
}

/** Reset between programs, as the extension's data section starts. */
export function personnalDefault(rt: Runtime): void {
  rt.personnal = newPersonnalState()
}
