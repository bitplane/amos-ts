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
import type { Runtime } from './runtime'

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
  /** _MpP — how many planes the Mplot engine draws into */
  mpP: number
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
    mpP: 0,
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
