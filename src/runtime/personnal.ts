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
import { P_COS, P_SIN, P_TAN } from './personnal-trig.gen'
import { bltSize, mintermWord } from '../amiga/blitter'

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
  "Pas assez de memoire pour l'allocation.",
  'Aga Icon bank non reservee.',
  "Fichier d'un format inconnu.",
  'Multi Plot bank non reservee.',
  'Multi Plot bank deja reservee.',
  'Point demande HORS limite de reservation.',
  'Valeurs permises de 1 a 8 seulement.',
  'Aga Icon bank deja reservee.',
  // 16 onwards exist only in the larger 1.1 build, alongside the keywords
  // that raise them. Read out of that binary at $6a98; the 1.1a source's
  // table stops at 15, and its wording of 8 and 14 differs by a full stop
  // and a plural. This is the 1.1 wording throughout.
  'Valeurs permises de 1 a 16 seulement.',
  'Player61.library non trouvee.',
  'Player61 ne peut pas jouer ce module.',
  'Player61 ne joue pas de module.',
  'Les valeurs de volume vont de 0 a 63.',
  'OctaPlayer.library non trouvee.',
  'Impossible de charger ce fichier.',
  'Module MMDx 5-8 voix deja en memoire.',
  "Impossible d'utiliser les CANAUX SONORES!.",
  'Aucun module MMDx 5-8 voix en memoire.',
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
  /**
   * _MpStartPlane (1.1's data bank +$6c) — which plane Mplot Draw starts at.
   * See the `mplot start plane` keyword for why this defaults to 1 here and
   * to 0 in the shipped 1.1 library.
   */
  mpStartPlane: number
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
  /** _ColorBase2 — the LOCT block Set Aga Color puts low nibbles in */
  colorBase2: number
  /** _2pal — the second screen's own 32 colours */
  pal2: number
  /** _2bpl — the second screen's bitplane pointers */
  bpl2: number
  /** _2bplcon — the second screen's BPLCON0 */
  bplcon2nd: number
  /** _BPlanesMask — which planes Allow/Forbid Plane Col have enabled */
  bplanesMask: number
  /** the sixteen slots Set Deform Value writes (1.1 data bank +$70) */
  deform: number[]
  /** the module P61/OMD state machine believes is loaded, and whether it plays */
  p61Playing: boolean
  omdModule: number
  omdPlaying: boolean
  /** _Icons (+$50) — how many icons the AGA icon bank holds, 0 when unreserved */
  icons: number
  /** _IcBase (+$54) — its address, 0 when unreserved */
  icBase: number
  /** _SpriteBase (data bank +$12e) — the buffer F Set Sprite Buffer was given */
  spriteBase: number
  /** _SpriteLength (+$132) — its size, which must be at least 8K */
  spriteLength: number
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
    mpStartPlane: 1,
    mplots: 0,
    origin: [0, 0],
    mpBase: 0,
    doubleCopper: 0,
    currentPal: 0,
    colorBase2: 0,
    pal2: 0,
    bpl2: 0,
    bplcon2nd: 0,
    bplanesMask: 0,
    deform: new Array(16).fill(0),
    p61Playing: false,
    omdModule: 0,
    omdPlaying: false,
    icons: 0,
    icBase: 0,
    spriteBase: 0,
    spriteLength: 0,
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

/** Longword at addr, unsigned — the counterpart of putL. */
function getL(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  if (!m || m.off + 3 >= m.data.length) return 0
  return ((m.data[m.off]! << 24) | (m.data[m.off + 1]! << 16) | (m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) >>> 0
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
 * Create Standard addr (L26, +AMOSPro_Personnal.Lib.s:1008) and Create Aga
 * addr (L10, +AMOSPro_Personnal.Lib.s:566).
 *
 * The colour block is the difference the name advertises: Standard writes one
 * bank of 32 COLOR moves, Aga writes eight, each preceded by a BPLCON3 bank
 * select ($0106, +$2000 a bank) — which is how AGA addresses 256 colours
 * through 32 registers — and then eight more behind LOCT.
 *
 * It is not the only difference, though, and the rest are easy to miss because
 * the two routines are otherwise line-for-line the same. The four BPLCON
 * defaults differ, and so does the tail:
 *
 *              Create Standard (:1065)   Create Aga (:640)
 *   BPLCON0    $1000  BPU=1              $0010  BPU3 — eight planes
 *   BPLCON1    $0000                     $0000
 *   BPLCON2    $0024                     $0224  KILLEHB
 *   BPLCON3    $0c00                     $1000
 *
 * and after the WAIT $32 / DMACON pair, Aga emits one more WAIT — for line
 * $31, which is BEHIND the $32 just waited for (:647) — before _CurrentLine,
 * and ends without the `BPLCON3 = 0` that Standard writes back "for AMOS"
 * (:1077). So a program that builds an Aga list gets eight planes and a
 * killed EHB before it sets anything, where a Standard list starts at one.
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
    // then the same eight again behind LOCT — BPLCON3 bit 9, $0200 (_cd2,
    // :606). These hold the LOW nibble of each channel, which is how AGA
    // reaches 24 bits through registers that only carry 12: the same COLOR
    // register is written twice and LOCT says which half. Set Aga Color
    // writes the pair, one into each block.
    s.colorBase2 = p
    for (let bank = 0x01060200; bank !== 0x01070200; bank += 0x2000) {
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
  if (aga) {
    put(0x01000010) // BPLCON0 — BPU3, eight planes
    put(0x01020000) // BPLCON1
    put(0x01040224) // BPLCON2 — KILLEHB
    put(0x01061000) // BPLCON3 — $1000 for the second playfield's palette
  } else {
    put(0x01001000) // BPLCON0 — one plane
    put(0x01020000) // BPLCON1
    put(0x01040024) // BPLCON2
    put(0x01060c00) // BPLCON3 — $c00 for the PAL second field
  }

  put(0x3203fffe) // WAIT line $32
  put(0x00968300) // DMACON: bitplane DMA back on
  if (aga) put(0x3103fffe) // and a WAIT for $31, already behind us (:647)
  s.currentLine = p
  put(0xf203fffe) // WAIT line $F2
  put(0x00960100) // off again below the display
  put(0xf303fffe) // WAIT line $F3
  if (!aga) put(0x01060000) // BPLCON3 back to AMOS's default — Standard only
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

/**
 * The Mplot plotting engine (L100, +AMOSPro_Personnal.Lib.s:3937), shared with the two dual-playfield
 * forms. `start` and `stride` choose which of _BitsPlanes it walks.
 */
function mplotDraw(rt: Runtime, it: { evalInt(): number; expect(t: string): void }, start: number, stride: number): void {
  const first = it.evalInt()
  it.expect('to')
  const last = it.evalInt()
  const s = rt.personnal
  if (s.mpBase === 0) err(11)
  const [width, height] = s.xy
  const rowBytes = width >> 3
  const xMax = width - 1
  const yMax = height - 1
  // The range excludes `last` — see the note on the loop bound in the tests.
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
      const plane = s.planes[start + p * stride] ?? 0
      if (plane === 0) break // the point is abandoned, not the plane
      const a = plane + off
      const b = getB(rt, a)
      putB(rt, a, ink & (1 << p) ? b | (1 << bit) : b & ~(1 << bit))
    }
  }
}

/**
 * The pixel-replication masks the five mosaics start from (_m3 :1352,
 * _mb3 :1407, _mc3 :1479, _md3 :1553, _me3 :1627). Each keeps the leftmost
 * pixel of every n-pixel group — bit 31 of a longword is the leftmost pixel,
 * so the mask has a bit every n places down from 31.
 */
const MOSAIC_MASK: Record<number, number> = {
  2: 0xaaaaaaaa,
  4: 0x88888888,
  8: 0x80808080,
  16: 0x80008000,
  32: 0x80000000,
}

/**
 * Mosaic X2/X4/X8/X16/X32 base (L32-L36, +AMOSPro_Personnal.Lib.s:1316/:1373/:1444/:1516/:1588).
 * Five copies of one routine at five scales, pixellating a screen in place.
 *
 * The argument is a screen control block — the demos pass `Screen Base`. The
 * routine copies its first six longwords (EcLogic, the LOGICAL planes, so a
 * double-buffered program follows with Screen Copy) into _MosaicPlanes, and
 * reads EcTx/EcTy at +76/+78 for the size. Bytes per row is taken as the
 * pixel width shifted right three, not EcTLigne.
 *
 * Per plane, per n rows, per longword: keep one pixel in n and smear it right
 * across the group with `Lsr.l #1 / Or.l` repeated n-1 times, then write that
 * longword to all n rows of the block. The plane loop stops dead at the first
 * zero pointer (`Beq _mend`), so it never touches a plane past a gap.
 *
 * Two guards the original does not have, both against it running off the end
 * of the bitmap rather than against anything a normal screen does:
 *
 *   - The height is rounded down to a multiple of n by an `Lsr/Lsl` pair, and
 *     the row loop is a do-while (`Add.l #n,d1 / Cmp.l d1,d7 / Bne`). A screen
 *     shorter than one block rounds to zero, so the compare never matches and
 *     the 68k walks memory forever. Here that case does nothing.
 *   - The column loop runs `Cmp.l a1,a3 / Bne` with a1 stepping four bytes, so
 *     a row whose byte width is not a multiple of four steps straight past the
 *     end marker. Here it stops at the last whole longword. Screen widths are
 *     multiples of 16 pixels, so this bites only below 32 pixels wide.
 */
function mosaic(rt: Runtime, base: number, n: number): void {
  const width = getW(rt, base + 76)
  const height = getW(rt, base + 78)
  const rowBytes = width >>> 3
  const rows = height - (height % n)
  const longs = rowBytes >>> 2
  const mask = MOSAIC_MASK[n]!
  for (let p = 0; p < 6; p++) {
    const plane = getL(rt, base + p * 4)
    if (plane === 0) return
    for (let y = 0; y < rows; y += n) {
      for (let i = 0; i < longs; i++) {
        const off = y * rowBytes + i * 4
        let d2 = getL(rt, plane + off) & mask
        let d0 = d2
        for (let k = 1; k < n; k++) {
          d2 >>>= 1
          d0 |= d2
        }
        d0 >>>= 0
        for (let r = 0; r < n; r++) putL(rt, plane + off + r * rowBytes, d0)
      }
    }
  }
}

/**
 * The blitter's logic function unit, applied a word at a time. LF is the low
 * byte of BLTCON0: bit (A<<2 | B<<1 | C) of it says what D is for that
 * combination of source bits. There is no blitter here, so the batch-8
 * keywords that set one up compute their minterm directly instead of driving
 * $DFF040-$DFF058. Every one of them uses zero modulos and full first/last
 * word masks, which is what makes a plain word loop equivalent.
 */
/**
 * A contiguous window of the fake address space, resolved once and handed back
 * as a view rather than a copy. The blitter keywords touch tens of thousands
 * of words per call, and a per-element `resolveAddr` costs more than the work
 * does. Null when the span does not lie inside one region, and the callers
 * fall back to the plain per-element path so nothing changes but the speed.
 */
function bytesAt(rt: Runtime, addr: number, bytes: number, write: boolean): Uint8Array | null {
  const m = write ? rt.resolveWrite(addr) : rt.resolveAddr(addr)
  if (!m || bytes <= 0 || m.off + bytes > m.data.length) return null
  return m.data.subarray(m.off, m.off + bytes)
}

const rdW = (v: Uint8Array, i: number): number => (v[i]! << 8) | v[i + 1]!
const wrW = (v: Uint8Array, i: number, x: number): void => {
  v[i] = (x >> 8) & 0xff
  v[i + 1] = x & 0xff
}
const rdL = (v: Uint8Array, i: number): number => ((v[i]! << 24) | (v[i + 1]! << 16) | (v[i + 2]! << 8) | v[i + 3]!) >>> 0
const wrL = (v: Uint8Array, i: number, x: number): void => {
  v[i] = (x >>> 24) & 0xff
  v[i + 1] = (x >>> 16) & 0xff
  v[i + 2] = (x >>> 8) & 0xff
  v[i + 3] = x & 0xff
}

/**
 * BLTSIZE as the hardware reads it: bits 15-6 are rows, bits 5-0 words, and a
 * zero in either field means its maximum. All four blitter keywords build the
 * value the same way, `rows<<6 + words` truncated to a word, so decoding it
 * back keeps whatever their arithmetic overflowed into.
 */

/**
 * Double Mask mask To s1,s2 (L53, +AMOSPro_Personnal.Lib.s:2180) and its Y-limited form (L54, +AMOSPro_Personnal.Lib.s:2264).
 *
 * The CPU half of the pair: `(mask AND s1) OR (NOT mask AND s2)` a longword at
 * a time, written back over s2. Geometry comes from the MASK screen's control
 * block, and plane 0 of the mask is used against every plane of the two
 * screens — the mask is one bitplane, not a screen's worth.
 *
 * The plane walk stops at the first zero pointer in either screen. It can do
 * that safely because the routine zeroes eight _BitsPlanes entries and fills
 * only six, so a full-depth screen still terminates on entry six.
 */
function doubleMask(rt: Runtime, mask: number, s1: number, s2: number, yStart: number, yEnd: number | null): void {
  if (mask === 0 || s1 === 0 || s2 === 0) err(4)
  const rowBytes = getW(rt, mask + 76) >> 3
  // the plain form takes the whole screen; L Double Mask takes (yEnd-yStart)
  // rows, and Move.w truncates that difference to a word before the multiply
  const rows = yEnd === null ? getW(rt, mask + 78) : (yEnd - yStart) & 0xffff
  const off = yStart * rowBytes
  const mLen = rowBytes * rows
  const maskPlane = getL(rt, mask) + off
  // the inner loop is a do-while against (mLen>>2)-1, so an empty plane still
  // copies one longword — kept rather than tidied
  const longs = Math.max(1, mLen >>> 2)
  for (let p = 0; p < 8; p++) {
    const p1 = p < 6 ? getL(rt, s1 + p * 4) : 0
    const p2 = p < 6 ? getL(rt, s2 + p * 4) : 0
    if (p1 === 0 || p2 === 0) return
    const a = p1 + off
    const b = p2 + off
    const bytes = longs * 4
    const M = bytesAt(rt, maskPlane, bytes, false)
    const A = bytesAt(rt, a, bytes, false)
    const B = bytesAt(rt, b, bytes, true)
    if (M && A && B) {
      for (let i = 0; i < bytes; i += 4) {
        const m = rdL(M, i)
        wrL(B, i, ((m & rdL(A, i)) | (~m & rdL(B, i))) >>> 0)
      }
    } else {
      for (let i = 0; i < bytes; i += 4) {
        const m = getL(rt, maskPlane + i)
        putL(rt, b + i, ((m & getL(rt, a + i)) | (~m & getL(rt, b + i))) >>> 0)
      }
    }
  }
}

/**
 * Blit Mask fore,mask,back To target (L59, +AMOSPro_Personnal.Lib.s:2480) and L Blit Mask (L60, +AMOSPro_Personnal.Lib.s:2571).
 *
 * The blitter half. A is the first screen, B the mask, C the third and D the
 * target, with BLTCON0 = $0F98 — all four channels on, minterm $98. That
 * minterm is `(B AND C) OR (A AND NOT B AND NOT C)`, which is NOT the
 * mask-select function the keyword's name implies ($E2 would be `B ? A : C`).
 * It is what both the source and the shipped binary contain, so it is what
 * this does.
 *
 * Geometry, and the number of planes to walk, come from the THIRD screen's
 * control block — EcTx/EcTy at +76/+78 and EcNPlan at +80. The mask pointer
 * alone is not stepped between planes, so plane 0 of the mask applies to all
 * of them, exactly as in Double Mask.
 *
 * `yEnd` marks the L form, and it carries that form's bug: the plain one
 * blits EcTy rows, and the L one blits yEnd rows starting at yStart rather
 * than the yEnd-yStart the name promises. L Double Mask, doing the same job on
 * the CPU, subtracts properly. The demos pass 64,128 to both on a 192-row
 * screen, where the L blitter form covers rows 64..191 and the L CPU form
 * covers 64..127.
 */
function blitMask(
  rt: Runtime,
  fore: number,
  mask: number,
  back: number,
  target: number,
  yStart: number,
  yEnd: number | null,
): void {
  if (fore === 0 || mask === 0 || back === 0 || target === 0) err(4)
  const width = getW(rt, back + 76)
  const height = getW(rt, back + 78)
  const off = yStart * (width >> 3)
  const planes = getW(rt, back + 80)
  const { rows, words } = bltSize((((yEnd === null ? height : yEnd) << 6) + (width >> 4)) & 0xffff)
  const total = rows * words
  for (let p = 0; p < planes; p++) {
    const a = getL(rt, fore + p * 4) + off
    const b = getL(rt, mask) + off // never stepped
    const c = getL(rt, back + p * 4) + off
    const d = getL(rt, target + p * 4) + off
    const bytes = total * 2
    const A = bytesAt(rt, a, bytes, false)
    const B = bytesAt(rt, b, bytes, false)
    const C = bytesAt(rt, c, bytes, false)
    const D = bytesAt(rt, d, bytes, true)
    if (A && B && C && D) {
      for (let i = 0; i < bytes; i += 2) wrW(D, i, mintermWord(0x98, rdW(A, i), rdW(B, i), rdW(C, i)))
    } else {
      for (let i = 0; i < bytes; i += 2) {
        putW(rt, d + i, mintermWord(0x98, getW(rt, a + i), getW(rt, b + i), getW(rt, c + i)))
      }
    }
  }
}

/**
 * S32 Block To Screen (L83, +AMOSPro_Personnal.Lib.s:3237) and S32 Vertice To Screen (L84, +AMOSPro_Personnal.Lib.s:3281).
 *
 * Both walk up to six planes in place, and both do the same thing to a row:
 * take its leftmost longword and repeat it across the whole row, so 32 pixels
 * become the width of the screen. They differ only in where the source
 * pointer sits at the top of each 32-row band. Block resets it to the plane
 * base every band (`_z2`'s `Move.l (a0),a1`), so the top 32 rows are tiled
 * down the screen — a 32x32 block blown up to fill it. Vertice loads it once
 * (`_z3b`), so the source keeps pace with the destination and every row gets
 * its own leftmost longword — a 32-pixel vertical strip stretched sideways.
 *
 * Reading the row before writing it is what makes the in-place version work,
 * and repeating the leftmost longword is what makes Block's reset harmless:
 * the value it re-reads on the second band is the one it already wrote.
 *
 * The height is rounded down to whole 32-row bands, the width to whole
 * longwords. A screen under 32 pixels wide gives the innermost do-while a
 * count of zero and the 68k never leaves it; that case does nothing here.
 */
function s32Expand(rt: Runtime, base: number, tile: boolean): void {
  const longs = getW(rt, base + 76) >>> 5
  const bands = getW(rt, base + 78) >>> 5
  if (longs === 0 || bands === 0) return
  // the row step is longs*4, taken from `Lsl.l #2,d6`, not the screen's real
  // byte width — a width that is not a whole number of longwords drifts
  const rowBytes = longs * 4
  for (let p = 0; p < 6; p++) {
    const plane = getL(rt, base + p * 4)
    if (plane === 0) return
    const v = bytesAt(rt, plane, bands * 32 * rowBytes, true)
    let src = 0
    let dst = 0
    for (let band = 0; band < bands; band++) {
      if (tile) src = 0
      for (let row = 0; row < 32; row++) {
        const w = v ? rdL(v, src) : getL(rt, plane + src)
        for (let x = 0; x < longs; x++) {
          if (v) wrL(v, dst, w)
          else putL(rt, plane + dst, w)
          dst += 4
        }
        src += rowBytes
      }
    }
  }
}

/**
 * Blitter Clear base (routine 113) and Blitter Copy source To target
 * (L82, +AMOSPro_Personnal.Lib.s:3183). Both walk up to six planes of a screen with the blitter and
 * both take their size from EcTx/EcTy of the screen they are handed.
 *
 * Clear sets BLTCON0 to $0100 — D alone, minterm 0 — which writes zeros; it is
 * a Cls that ignores the current window and clears the whole plane. Copy uses
 * $09F0, A and D with minterm $F0, a straight A-to-D move.
 *
 * They differ in where the zero-pointer test sits. Clear tests at the top, so
 * a screen with no planes does nothing. Copy blits the first plane before any
 * test and only then looks at the NEXT pair, so a source whose plane 0 is null
 * blits from address zero — the up-front check is on the control block, not
 * the plane.
 *
 * Blitter Clear is one of the two keywords in this batch that the published
 * 1.1a source leaves as an empty label; it exists only in the shipped binary,
 * so this is read off the disassembly rather than the source.
 */
function blitPlanes(rt: Runtime, src: number, dst: number, geom: number, copy: boolean): void {
  const size = ((getW(rt, geom + 78) << 6) + (getW(rt, geom + 76) >> 4)) & 0xffff
  const { rows, words } = bltSize(size)
  const bytes = rows * words * 2
  for (let p = 0; p < 6; p++) {
    const d = getL(rt, dst + p * 4)
    const a = copy ? getL(rt, src + p * 4) : 0
    if (!copy && d === 0) return
    const D = bytesAt(rt, d, bytes, true)
    if (copy) {
      const A = bytesAt(rt, a, bytes, false)
      if (A && D) D.set(A)
      else for (let i = 0; i < bytes; i += 2) putW(rt, d + i, mintermWord(0xf0, getW(rt, a + i), 0, 0))
      // the next pair decides whether there is another plane, not this one
      if (getL(rt, src + (p + 1) * 4) === 0 || getL(rt, dst + (p + 1) * 4) === 0) return
    } else if (D) D.fill(0)
    else for (let i = 0; i < bytes; i += 2) putW(rt, d + i, 0)
  }
}

/**
 * Low Filter.b/.w/.l value To start,end (L62/L63/L64, +AMOSPro_Personnal.Lib.s:2677/:2690/:2703).
 * A ceiling: anything that compares greater than or equal to `value` is
 * replaced by it, signed, element by element.
 *
 * Only the byte form has a loop. The word and longword forms end theirs with
 * `Cmp.l a0,a1 / Blt`, which branches while the END pointer is below the
 * CURRENT one — false on the first pass of any sane range — so they filter one
 * element and return. The byte form uses `Bne` and walks the range properly.
 * Both the source and the shipped binary say so; kept, and tested.
 *
 * A range whose end is below its start does nothing here; the byte form's
 * `Bne` would step past it and keep going, as Octets Fill's does.
 */
function lowFilter(rt: Runtime, value: number, start: number, end: number, size: 1 | 2 | 4): void {
  const get = (a: number): number =>
    size === 1 ? (getB(rt, a) << 24) >> 24 : size === 2 ? (getW(rt, a) << 16) >> 16 : getL(rt, a) | 0
  const put = (a: number, v: number): void => {
    if (size === 1) putB(rt, a, v)
    else if (size === 2) putW(rt, a, v & 0xffff)
    else putL(rt, a, v >>> 0)
  }
  const cap = size === 1 ? (value << 24) >> 24 : size === 2 ? (value << 16) >> 16 : value | 0
  for (let p = start; p < end; p += size) {
    if (get(p) >= cap) put(p, cap)
    if (size !== 1) break // the Blt that never loops
  }
}

/**
 * Get Even Sprite / Get Odd Sprite base,n,x,y To lines (L56/L57, +AMOSPro_Personnal.Lib.s:2375/:2413).
 * Cut a 16-pixel-wide, two-plane sprite out of a screen: Even takes planes 0
 * and 1, Odd takes 2 and 3, and the two planes interleave a longword at a time
 * behind a four-byte header of `$0000, lines, $00`.
 *
 * It does not go where it should. The destination is computed as
 * `DLea _SpriteBase,a0 / Move.l a0,d1 / Move.l d1,a0` — the address OF the
 * variable, round-tripped through a data register and never dereferenced. So
 * the sprite is written over the extension's own variables starting at
 * _SpriteBase, and the buffer F Set Sprite Buffer was given is never touched.
 * F Sprite then reads that buffer, which is still empty. Confirmed in the
 * shipped binary at $4592 (`movea.l $1b8(a5),a0 / adda.w #$12e,a0`), not just
 * in the source, and it is why no demo in the archive uses these three.
 *
 * Modelled by writing where the library writes: _SpriteBase takes the header
 * and _SpriteLength the first plane-0 longword. Past those two the writes land
 * on library variables this port does not keep as memory — what matters, and
 * what is tested, is that nothing reaches the reserved buffer.
 */
function getSprite(rt: Runtime, base: number, n: number, x: number, y: number, lines: number, odd: boolean): void {
  const s = rt.personnal
  const rowBytes = getW(rt, base + 76) >> 3
  const p1 = getL(rt, base + (odd ? 8 : 0))
  const p2 = getL(rt, base + (odd ? 12 : 4))
  const off = y * rowBytes + (x >> 3)
  const put = (at: number, v: number): void => {
    if (at === 0) s.spriteBase = v >>> 0
    else if (at === 4) s.spriteLength = v >>> 0
  }
  let at = n * 520
  put(at, ((lines & 0xff) << 8) >>> 0)
  at += 4
  // Sub.l #1,d6 / Bpl runs one more row than `lines` says
  for (let i = 0; i <= lines; i++) {
    put(at, getL(rt, p1 + off + i * rowBytes))
    put(at + 4, getL(rt, p2 + off + i * rowBytes))
    at += 8
  }
}

/**
 * Aga Get Icon / Aga Paste Icon icon,x,y (L89/L90, +AMOSPro_Personnal.Lib.s:3426/:3479). One routine
 * run in two directions.
 *
 * An icon is 16 pixels wide and 16 lines tall over EIGHT planes: sixteen
 * words a plane, 256 bytes, in a 260-byte slot. That stride is four bytes
 * longer than the data and is the same 260 Mplot Load reads by (:4479) for
 * six-byte points, which is where that copy-paste came from.
 *
 * The bank is `"F.C1"`, the icon count, then the slots. Both keywords index
 * it as `_IcBase + 8 + (icon-1)*260`, walk _BitsPlanes -- the plane list Set
 * Plane fills, not a screen's -- and step a row of `_XY[0] >> 3` bytes
 * between lines. An icon out of 1..IconMax returns in silence; a bank that
 * was never reserved is error 9.
 *
 * The plane walk stops at the first null entry, so an icon taken from a
 * four-plane screen keeps the top four planes of whatever the slot held
 * before. The slot is only fully written when all eight planes are set.
 */
function icon(rt: Runtime, n: number, x: number, y: number, paste: boolean): void {
  const s = rt.personnal
  if (n < 1 || n > s.icons) return
  if (s.icBase === 0) err(9)
  let at = s.icBase + 8 + (n - 1) * 260
  const rowBytes = s.xy[0] >> 3
  const off = y * rowBytes + (x >> 3)
  for (let p = 0; p < 8; p++) {
    const plane = s.planes[p] ?? 0
    if (plane === 0) return
    let a = plane + off
    for (let line = 0; line < 16; line++) {
      if (paste) putW(rt, a, getW(rt, at))
      else putW(rt, at, getW(rt, a))
      at += 2
      a += rowBytes
    }
  }
}

/**
 * Fc Cos / Fc Sin / Fc Tan (L47/L48/L49, +AMOSPro_Personnal.Lib.s:2036/:2062/:2088). Three copies of
 * one routine: normalise the angle to whole degrees, index a 360-entry table
 * of the function scaled by 1000, return it.
 *
 * The normalisation only works upwards. For an angle above 359 it is a plain
 * `d0 mod 360`, spelt out as Divu/Mulu/Sub. For a NEGATIVE angle the same
 * code runs first and it does not survive: `Divu` is unsigned, so a negative
 * dividend is a huge number whose quotient overflows sixteen bits, which
 * leaves the destination untouched and sets V. The following `Mulu` then
 * multiplies the low word of the ORIGINAL angle by 360, and the subtraction
 * produces a number that has nothing to do with the input. The `Not.w` and
 * `Add.l #1` after it were meant to negate a small negative angle -- and
 * would, on their own -- but they are applied to that wreckage.
 *
 * So a negative angle indexes far outside the table. On the Amiga that reads
 * whatever memory follows it; here it answers 0, which is as close to
 * "nothing meaningful" as this port can get without inventing the contents of
 * someone else's RAM.
 */
function fcTrig(table: readonly number[], angle: number): number {
  let d0 = angle | 0
  if (d0 < 0) {
    // Divu overflows and leaves d1 alone; Mulu then takes its low word
    const d1 = Math.imul(d0 & 0xffff, 360)
    d0 = (d0 - d1) | 0
    d0 = ((d0 & ~0xffff) | (~d0 & 0xffff)) + 1 // Not.w, then Add.l #1
  } else if (d0 > 359) {
    d0 = d0 % 360
  }
  return table[d0] ?? 0
}

/**
 * The chunk scan all four IFF keywords share. It does not walk the chunk
 * chain — it steps two bytes at a time from the address it was given looking
 * for the four ASCII bytes, which finds the tag wherever it sits as long as
 * it is word-aligned. `tries` is the step budget: 32768 for the three header
 * readers (L50-L52), 16384 for Iff Convert (L39). Returns the offset of the
 * tag, or -1.
 */
function findIffChunk(rt: Runtime, addr: number, tag: string, tries: number): number {
  const want = ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0
  let a = addr
  for (let i = 0; i < tries; i++) {
    if (getL(rt, a) === want) return a
    a += 2
  }
  return -1
}

/**
 * Iff X Size / Iff Y Size / Iff Planes (L50/L51/L52, +AMOSPro_Personnal.Lib.s:2114/:2136/:2158).
 * Find BMHD and read one field out of it — width at +8 from the tag, height
 * at +10, and the plane count as a BYTE at +16. No BMHD in 32768 steps is
 * error 3, "BMHD non trouve".
 */
function iffHeader(rt: Runtime, addr: number, field: 'w' | 'h' | 'd'): number {
  const at = findIffChunk(rt, addr, 'BMHD', 32768)
  if (at < 0) err(3)
  if (field === 'd') return getB(rt, at + 16)
  return getW(rt, at + (field === 'w' ? 8 : 10))
}

/**
 * Iff Convert addr (L39, +AMOSPro_Personnal.Lib.s:1688). Decompresses an ILBM BODY straight into the
 * plane list Set Plane built, row-interleaved: for each of the height rows,
 * for each of the depth planes, width/8 bytes.
 *
 * It locates BMHD, CMAP and BODY independently, each by its own scan from the
 * start, and gives up in SILENCE if any of the three is missing or if the
 * plane list has no entry for the last plane the header asks for. Only the
 * three header readers raise error 3; this one just returns.
 *
 * Two things about the decoder, both kept:
 *
 *   - It never looks at BMHD's compression byte. Everything is decoded as
 *     ByteRun1, so an uncompressed ILBM comes out as noise.
 *   - The literal/run split is `Cmp.l #$80,d3 / Bgt`, so a control byte of
 *     exactly 128 takes the LITERAL path and copies 129 bytes. The format
 *     reserves 128 as a no-op. Encoders do not emit it, which is why this
 *     has never bitten.
 *
 * A run longer than one row's worth of bytes abandons the whole conversion
 * (`_COMPRESSED`'s `Bgt _END`), leaving everything decoded so far in place.
 */
function iffConvert(rt: Runtime, addr: number): void {
  const s = rt.personnal
  const bmhd = findIffChunk(rt, addr, 'BMHD', 16384)
  if (bmhd < 0) return
  if (findIffChunk(rt, addr, 'CMAP', 16384) < 0) return
  const body = findIffChunk(rt, addr, 'BODY', 16384)
  if (body < 0) return

  const width = getW(rt, bmhd + 8)
  const height = getW(rt, bmhd + 10)
  const depth = getB(rt, bmhd + 16)
  if ((s.planes[depth - 1] ?? 0) === 0) return

  // _BitsPlanes3 holds the write cursors, one per plane, advanced as it goes
  const cur = s.planes.slice(0, 8)
  const rowBytes = width >> 3
  let a = body + 4
  for (let row = 0; row < height; row++) {
    for (let p = 0; p < depth; p++) {
      let done = 0
      while (done < rowBytes) {
        const ctrl = getB(rt, a)
        a += 1
        const next = getB(rt, a)
        a += 1
        if (ctrl > 0x80) {
          const n = 257 - ctrl
          if (n > rowBytes) return // the run does not fit a row: abandon
          for (let i = 0; i < n; i++) putB(rt, cur[p]!++, next)
          done += n
        } else {
          a -= 1 // the second byte was a look-ahead; step back over it
          for (let i = 0; i <= ctrl; i++) putB(rt, cur[p]!++, getB(rt, a++))
          done += ctrl + 1
        }
      }
    }
  }
}

/**
 * The picture cruncher's format, pinned from both ends — Pic Unpack decodes it
 * (routine 115, $642a) and Pic Pack builds it (routine 114, $62be).
 *
 * A sixteen-byte header, of which two longwords are used: +4 is the packed
 * length INCLUDING the header, +8 the number of bytes in one bitplane. The
 * stream follows at +16, one plane's worth after another, and the destination
 * is a plane-pointer list, not a screen.
 *
 * Control bytes: `n` up to $7F repeats the byte after it n times; anything
 * above $7F copies `256 - n` literal bytes. Pic Pack reaches that by counting
 * runs first and then walking its own output a second time, folding strings of
 * one-byte runs into a literal block.
 *
 * Two edges of the decoder, both kept. A control byte of zero never satisfies
 * `d3 == 0` after its first decrement, so it fills the rest of the PLANE with
 * one byte rather than emitting nothing. And every read is guarded against the
 * end of the packed block, so a truncated stream stops the whole keyword
 * rather than running on.
 *
 * That guard is `>=` here where the 68k tests `Cmpa.l a2,a4 / Beq` for exact
 * equality. A header whose length field points behind the data would step the
 * cursor straight past the end and never match it — which is what a bad frame
 * offset into Anim Unpack produces, and it hangs rather than stopping.
 */
function picUnpack(rt: Runtime, src: number, planeList: number): void {
  const total = getL(rt, src + 4) - 16
  const perPlane = getL(rt, src + 8)
  let a2 = src + 16
  const end = src + total
  let list = planeList
  for (;;) {
    let a3 = getL(rt, list)
    list += 4
    let left = perPlane
    for (;;) {
      if (a2 >= end) return
      const ctrl = getB(rt, a2)
      if (ctrl > 0x7f) {
        a2 += 1
        if (a2 >= end) return
        let d3 = ctrl
        for (;;) {
          putB(rt, a3++, getB(rt, a2++))
          if (a2 >= end) return
          d3 += 1
          left -= 1
          if (left === 0) break
          if (d3 >= 0x100) break
        }
        if (left === 0) break
      } else {
        a2 += 1
        if (a2 >= end) return
        const v = getB(rt, a2)
        a2 += 1
        if (a2 >= end) return
        let d3 = ctrl
        for (;;) {
          putB(rt, a3++, v)
          d3 -= 1
          left -= 1
          if (left === 0) break
          if (d3 === 0) break
        }
        if (left === 0) break
      }
    }
  }
}

/**
 * Pic Pack src To dst (routine 114, $62be). Packs a SCREEN, taking its
 * geometry from the control block at +76 and its planes from the longwords
 * at its start, into the format above.
 *
 * The library builds it in two passes: run-length first, capping runs at $7F,
 * then a second walk over its own output that folds consecutive one-byte runs
 * into a literal block of up to 128. This does the same two passes in the same
 * order, so the boundaries fall where the library's do.
 */
function picPack(rt: Runtime, screen: number, dst: number): number {
  const width = getW(rt, screen + 76)
  const height = getW(rt, screen + 78)
  const depth = getW(rt, screen + 80)
  const perPlane = (width >> 3) * height
  const pass1: number[] = []
  for (let p = 0; p < depth; p++) {
    let a = getL(rt, screen + p * 4)
    let left = perPlane
    while (left > 0) {
      const v = getB(rt, a)
      let n = 0
      while (left > 0 && n < 0x7f && getB(rt, a) === v) {
        n += 1
        a += 1
        left -= 1
      }
      pass1.push(n, v)
    }
  }
  // second pass: runs of one become a literal block, counted down from zero
  const out: number[] = []
  for (let i = 0; i < pass1.length; ) {
    if (pass1[i] !== 1) {
      out.push(pass1[i]!, pass1[i + 1]!)
      i += 2
      continue
    }
    const lit: number[] = []
    while (i < pass1.length && pass1[i] === 1 && lit.length < 0x80) {
      lit.push(pass1[i + 1]!)
      i += 2
    }
    out.push((256 - lit.length) & 0xff, ...lit)
  }
  const length = out.length + 16
  putL(rt, dst + 4, length)
  putL(rt, dst + 8, perPlane)
  out.forEach((b, i) => putB(rt, dst + 16 + i, b))
  return length
}

/** Allow/Forbid Plane Col (L40/L41). See the keyword comment for the Bset. */
function planeCol(rt: Runtime, n: number, allow: boolean): void {
  const s = rt.personnal
  if (s.others === 0) err(1)
  if (n < 1 || n > 6) return
  s.bplanesMask = allow ? s.bplanesMask | (1 << n) : s.bplanesMask & ~(1 << n)
  // DEFECT: n<<6 taken modulo 32 is 0 for every n in range, so the Bset
  // always lands on bit 0 whichever plane was named. Reproduced.
  const a = s.others + 26
  putW(rt, a, allow ? getW(rt, a) | 1 : getW(rt, a) & ~1)
}

/**
 * The three collision readers (L44/L45/L46, +AMOSPro_Personnal.Lib.s:1958/:1992/:2000) all end the
 * same way: pick a CLXDAT bit, read $DFF00E, and answer -1 when that bit is
 * CLEAR — Btst sets Z on a zero bit and the Bne skips the -1 when it is set.
 * That is the opposite of what the names suggest and is kept as found.
 *
 * There is no collision hardware here and nothing writes CLXDAT, so it reads
 * 0 and every one of them answers -1. That is the deviation that matters, far
 * more than the polarity. NOTES entry at closeout.
 */
function clxBit(rt: Runtime, bit: number | null): number {
  void rt
  if (bit === null) return 0
  const clxdat = 0
  return clxdat & (1 << bit) ? 0 : -1
}

/** Shared by the two palette-to-copper keywords (_bi1 :2936, _bj1 :2980). */
function cmapToCopper(rt: Runtime, n: number, src: number, eightBit: boolean): void {
  const s = rt.personnal
  // no _ColorBase check here either — see Change Palette
  let a = s.colorBase
  let p = src
  for (let i = 0; i < n; i++) {
    if (getW(rt, a) === 0x0106) a += 4
    const shift = eightBit ? 4 : 0
    const r = getB(rt, p) >> shift
    const g = getB(rt, p + 1) >> shift
    const b = getB(rt, p + 2) >> shift
    p += 3
    putW(rt, a + 2, ((r << 8) + (g << 4) + b) & 0xffff)
    a += 4
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
    /** Create Standard addr (L26, +AMOSPro_Personnal.Lib.s:1008) */
    'create standard'(it) {
      buildList(rt, it.evalInt(), false)
    },
    /** Create Aga addr (L10, +AMOSPro_Personnal.Lib.s:566) */
    'create aga'(it) {
      buildList(rt, it.evalInt(), true)
    },

    /**
     * Set Screen Sizes x,y (L23, +AMOSPro_Personnal.Lib.s:961). X floors at 320 and Y at 192 — the
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

    /** Set Resolution n (L29, +AMOSPro_Personnal.Lib.s:1246) — BPLCON0 bit 15, HIRES */
    'set resolution'(it) {
      const hi = it.evalInt() !== 0
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      const a = s.bplConBase + 2
      putW(rt, a, hi ? getW(rt, a) | 0x8000 : getW(rt, a) & ~0x8000)
    },

    /** Set Lace n (L30, +AMOSPro_Personnal.Lib.s:1264) — BPLCON0 bit 2, LACE */
    'set lace'(it) {
      const on = it.evalInt() !== 0
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      const a = s.bplConBase + 2
      putW(rt, a, on ? getW(rt, a) | 0x0004 : getW(rt, a) & ~0x0004)
    },

    /**
     * Set Plane n,address (L16, +AMOSPro_Personnal.Lib.s:758). Records the address and rewrites every
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
     * Set D Plane n,address (L85, +AMOSPro_Personnal.Lib.s:3325). The back set. It only records —
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
     * Swap Planes (L86, +AMOSPro_Personnal.Lib.s:3339). Exchanges all eight addresses with the back
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
     * Set View Planes n (L21, +AMOSPro_Personnal.Lib.s:872). How many planes the display fetches,
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
     * Mplot Planes n (L109, +AMOSPro_Personnal.Lib.s:4236). How many planes the point engine draws
     * into. Unlike the plane setters this one refuses a bad count out loud,
     * with ErrMess 14.
     */
    'mplot planes'(it) {
      const n = it.evalInt()
      if (n < 1 || n > 8) err(14)
      rt.personnal.mpP = n
    },

    /**
     * Screen Position type,x,y (L27, +AMOSPro_Personnal.Lib.s:1097). Scrolls the display by moving
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
     * Mplot Reserve n (L94, +AMOSPro_Personnal.Lib.s:3694). Allocates the point bank itself with
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

    /** Mplot Erase (L95, +AMOSPro_Personnal.Lib.s:3729). Frees the bank; erasing an unreserved one is quiet. */
    'mplot erase'() {
      const s = rt.personnal
      if (s.mplots === 0) return
      s.mplots = 0
      s.mpBase = 0
      rt.personnalMem = null
    },

    /**
     * Mplot Define n,x,y,c (L98, +AMOSPro_Personnal.Lib.s:3904). Six bytes at base+8+(n-1)*6.
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
     * Mplot Draw first To last (L100, +AMOSPro_Personnal.Lib.s:3937). The engine, and the reason the
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
      mplotDraw(rt, it, rt.personnal.mpStartPlane - 1, 1)
    },

    /**
     * Mplot Dpf1 Draw / Mplot Dpf2 Draw (L111/L112, +AMOSPro_Personnal.Lib.s:4264/:4360). The same
     * engine over half the plane list: Dpf1 walks _BitsPlanes from the start
     * and Dpf2 from its second entry, both striding two (a_Mpp :4330,
     * b_Mpp :4426). That splits the planes into the two playfields — the
     * guide calls Dpf1's "les bits plans impairs (1,3,5(&7 if AGA))".
     *
     * _MpP still counts planes drawn, not entries stepped, so four planes
     * consumes the whole eight-entry list.
     */
    'mplot dpf1 draw'(it) {
      mplotDraw(rt, it, 0, 2)
    },
    'mplot dpf2 draw'(it) {
      mplotDraw(rt, it, 1, 2)
    },

    /**
     * Set Dual Mode n (L28, +AMOSPro_Personnal.Lib.s:1228) — BPLCON0 bit 10, DBLPF. Splits the
     * planes into two independent playfields.
     */
    'set dual mode'(it) {
      const on = it.evalInt() !== 0
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      const a = s.bplConBase + 2
      putW(rt, a, on ? getW(rt, a) | 0x0400 : getW(rt, a) & ~0x0400)
    },

    /**
     * Inverse Playfields / Normal Playfields (L42/L43, +AMOSPro_Personnal.Lib.s:1932/:1945) —
     * BPLCON2 bit 6, PF2PRI, which of the two is in front.
     */
    'inverse playfields'() {
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      putW(rt, s.bplConBase + 10, getW(rt, s.bplConBase + 10) | 0x40)
    },
    'normal playfields'() {
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      putW(rt, s.bplConBase + 10, getW(rt, s.bplConBase + 10) & ~0x40)
    },

    /**
     * Set Dual Palette n (L65, +AMOSPro_Personnal.Lib.s:2716) — n<<10 into BPLCON3, the PF2OF field,
     * which picks the 16-colour bank the second playfield reads.
     *
     * It writes the whole register rather than the field, so it also clears
     * the $c00 the builder put there for the PAL second field, and any bank
     * select left in it. Kept: the source is a plain Move.w.
     */
    'set dual palette'(it) {
      const n = it.evalInt()
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      putW(rt, s.bplConBase + 14, (n * 0x400) & 0xffff)
    },

    /**
     * Mplot X/Y/C Define n,add (L105/L106/L107, +AMOSPro_Personnal.Lib.s:4142/:4171/:4201). One field of one point,
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
     * Mplot Modify first To last,xadd,yadd (L104, +AMOSPro_Personnal.Lib.s:4090). The bulk form of
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
     * Mplot Load name$ (L96, +AMOSPro_Personnal.Lib.s:3751). The file is the bank: "F.C2", the point
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

    /** Mplot Save name$ (L97, +AMOSPro_Personnal.Lib.s:3847) — the header then count*6 bytes */
    'mplot save'(it) {
      const name = it.evalStr()
      const s = rt.personnal
      if (s.mplots === 0 || rt.personnalMem === null) err(11)
      rt.vfs?.writeFile(name, rt.personnalMem!.subarray(0, s.mplots * 6 + 8))
    },

    /**
     * Lsr Zone source To target (L110, +AMOSPro_Personnal.Lib.s:4248). Moves a block of memory four
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

    /** Mplot Origin x,y (L108, +AMOSPro_Personnal.Lib.s:4229) — where the coordinates are measured from */
    'mplot origin'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      rt.personnal.origin = [x, y]
    },

    /**
     * Active Copper (L37, +AMOSPro_Personnal.Lib.s:1660) — `Move.l d0,$dff080`, COP1LC. The single
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

    /** Copper Base addr (L15, +AMOSPro_Personnal.Lib.s:751) — point the extension at an existing list */
    'copper base'(it) {
      rt.personnal.copperBase = it.evalInt()
    },

    /**
     * Copper Next Line (L19, +AMOSPro_Personnal.Lib.s:830) and Copper Wait Line n (L31, +AMOSPro_Personnal.Lib.s:1282).
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
     * Vb Line Wait n (L74, +AMOSPro_Personnal.Lib.s:2961) spins on VPOSR until the beam reaches the
     * line, clamping past 381 to 383. There is no beam here and nothing to
     * spin on, so this yields the frame instead — the effect a program wants
     * from it, without the wait it actually performs.
     */
    'vb line wait'(it) {
      void it.evalInt()
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },

    /**
     * Set Color reg,r,g,b (L12, +AMOSPro_Personnal.Lib.s:671). Writes one entry of the colour block
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
     * New Color Value reg,r,g,b (L22, +AMOSPro_Personnal.Lib.s:906). A colour change at the line the
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
      // ADD, where Set Color ORs (:927 against :678) — a channel above 15
      // therefore carries into the one above it rather than overlaying it
      const rgb = ((r << 8) + (g << 4) + b) & 0xffff
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
     * X Fade (L13, +AMOSPro_Personnal.Lib.s:701). One step of a fade to black over the WHOLE list:
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
          // d2 is (value>>8)<<8, so the top nibble rides along with red rather
          // than being masked off (:717) — it only shows on a value word a
          // program poked above $0fff, but that is what the routine does
          let red = val & 0xff00
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

    /**
     * Set Aga Color reg,r,g,b (L80, +AMOSPro_Personnal.Lib.s:3124). AGA's 24-bit colour is two
     * writes to the same register: the high nibble of each channel in the
     * ordinary block, the low nibble in a second one selected by BPLCON3's
     * LOCT bit. The routine computes both — d7 is (r>>4,g>>4,b>>4) and d4 the
     * remainders — and stores them at the same offset into _ColorBase and
     * _ColorBase2.
     *
     * Two things it does NOT share with Set Color. Its register is 1-based:
     * `Set Aga Color 1` writes the entry `Set Color 0` writes. And its loop
     * decrements before testing for zero (_80a, :3156), so a register of 0
     * counts down past it and never terminates — we stop instead of hanging,
     * which is the one place here that cannot be faithful.
     *
     * The low-nibble half is written but not displayed: the interpreter reads
     * COLOR moves as 12-bit and does not honour LOCT, so the visible result
     * is the high nibbles alone. NOTES entry at closeout.
     */
    'set aga color'(it) {
      const reg = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const g = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = rt.personnal
      if (s.colorBase === 0) err(1)
      if (reg < 1) return // the source would spin; see above
      // no masking on the way in, only the Move.w at the end (:3161): the
      // channels are shifted into place and OR-ed, so a channel above 255
      // spills upward before the word truncates it
      const hi = (((((r >> 4) << 4) | (g >> 4)) << 4) | (b >> 4)) & 0xffff
      const lo = ((((r & 15) << 4) | (g & 15)) << 4) | (b & 15)
      let a = s.colorBase
      for (let n = reg; ; ) {
        if (getW(rt, a) === 0x0106) a += 4
        a += 2
        if (--n === 0) break
        a += 2
      }
      putW(rt, a, hi)
      if (s.colorBase2 !== 0) putW(rt, s.colorBase2 + (a - s.colorBase), lo)
    },

    /**
     * Change Palette n,addr (L72, +AMOSPro_Personnal.Lib.s:2916). Copies n
     * ready-made RGB4 words straight into the colour block, stepping over
     * bank selects as the colour keywords do.
     *
     * The three palette-block keywords — this, and the two Palette To Copper
     * forms — read _ColorBase without checking it, unlike every keyword that
     * patches the list by name. With no list built they write from address 0
     * onward, which on the Amiga walks over the exception vectors. Here that
     * lands outside any mapped region and is dropped; nothing is raised,
     * because the library raises nothing.
     */
    'change palette'(it) {
      const n = it.evalInt()
      it.expect(',')
      let src = it.evalInt()
      const s = rt.personnal
      let a = s.colorBase
      for (let i = 0; i < n; i++) {
        if (getW(rt, a) === 0x0106) a += 4
        putW(rt, a + 2, getW(rt, src))
        src += 2
        a += 4
      }
    },

    /**
     * Iff8bits / Iff4bits Palette To Copper n,addr (L73/L75, +AMOSPro_Personnal.Lib.s:2932/:2973).
     * The same loop over an IFF CMAP, differing only in what a byte means:
     * an 8-bit CMAP is shifted down four bits a channel, a 4-bit one is used
     * as it stands. Neither masks, so a 4-bit CMAP holding a byte above 15
     * bleeds into the next channel, as it does on the Amiga.
     */
    'iff8bits palette to copper'(it) {
      const n = it.evalInt()
      it.expect(',')
      cmapToCopper(rt, n, it.evalInt(), true)
    },
    'iff4bits palette to copper'(it) {
      const n = it.evalInt()
      it.expect(',')
      cmapToCopper(rt, n, it.evalInt(), false)
    },

    /**
     * Fade Palette n,adr0,adr1 (L76, +AMOSPro_Personnal.Lib.s:2999). One step of a fade from the
     * palette at adr0 towards the one at adr1, byte by byte: each channel
     * moves one closer, or stays if it has arrived. Both are plain RGB byte
     * triples, and the result is written back over adr0, so calling it in a
     * loop walks the whole way.
     *
     * Unlike X Fade, which only ever heads for black, this reaches any
     * palette from any other and stops there.
     */
    'fade palette'(it) {
      const n = it.evalInt()
      it.expect(',')
      let src = it.evalInt()
      it.expect(',')
      let dst = it.evalInt()
      // Cmp.b / Blt (:3018) — a SIGNED byte compare, so a channel of 128 or
      // more reads as negative and steps the wrong way. Invisible on the
      // 0..15 palettes the neighbouring keywords produce, which is presumably
      // why it survived.
      const sb = (v: number): number => (v << 24) >> 24
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          const from = getB(rt, src + c)
          const to = sb(getB(rt, dst + c))
          putB(rt, src + c, sb(from) < to ? from + 1 : sb(from) > to ? from - 1 : from)
        }
        src += 3
        dst += 3
      }
    },

    /**
     * Attribute Palette n,r,g,b,source To dest (L77, +AMOSPro_Personnal.Lib.s:3049). Adds a signed
     * amount to each channel of n RGB triples, clamping to 0..15, and writes
     * the result somewhere else — brightening or darkening a palette without
     * touching the original.
     *
     * The clamp is per channel and one-sided in each direction: below zero
     * becomes 0, sixteen or more becomes 15.
     */
    'attribute palette'(it) {
      const n = it.evalInt()
      it.expect(',')
      const dr = it.evalInt()
      it.expect(',')
      const dg = it.evalInt()
      it.expect(',')
      const db = it.evalInt()
      it.expect(',')
      let src = it.evalInt()
      it.expect('to')
      let dst = it.evalInt()
      const clamp = (v: number): number => (v < 0 ? 0 : v >= 16 ? 15 : v)
      for (let i = 0; i < n; i++) {
        putB(rt, dst, clamp(getB(rt, src) + dr))
        putB(rt, dst + 1, clamp(getB(rt, src + 1) + dg))
        putB(rt, dst + 2, clamp(getB(rt, src + 2) + db))
        src += 3
        dst += 3
      }
    },

    /**
     * Active Second Screen (L67, +AMOSPro_Personnal.Lib.s:2763). Appends a whole second display to
     * the list: its own 32 colours (_2pal), its own eight bitplane pointers
     * (_2bpl), window and fetch, then BPLCON0 alone in _2bplcon.
     *
     * It runs past the bottom of the first — WAIT $f3, DMA back on, then the
     * $FFD9 line-255 crossing and a WAIT for line 1 — so the second screen
     * occupies the next field. _Line becomes $14 and _CurrentLine is wound
     * back 12 bytes to sit on that tail, which is what makes the line
     * keywords append into the second screen from here on, with the shorter
     * tail appendWait() already knew to write.
     */
    'active second screen'() {
      const s = rt.personnal
      if (s.currentLine === 0) err(1)
      let p = s.currentLine
      const put = (v: number): void => {
        putL(rt, p, v)
        p += 4
      }
      put(0xf203fffe)
      put(0x00960100)
      s.pal2 = p
      for (let c = 0x01800000; c !== 0x01c00000; c += 0x20000) put(c)
      s.bpl2 = p
      for (let d = 0x00e00000; d !== 0x01000000; d += 0x20000) put(d)
      put(0x008e0181) // DIWSTRT
      put(0x009037c1) // DIWSTOP
      put(0x00920038) // DDFSTRT
      put(0x009400d0) // DDFSTOP
      put(0x01020000) // BPLCON1
      put(0x01040000) // BPLCON2
      put(0x01060000) // BPLCON3
      put(0x01080000) // BPL1MOD
      put(0x010a0000) // BPL2MOD
      s.bplcon2nd = p
      put(0x01000000) // BPLCON0
      put(0xf303fffe)
      put(0x00968300)
      put(0xffd9fffe) // the line-255 crossing
      put(0x0103fffe) // and on into the next field
      putL(rt, p, 0x1403fffe)
      putL(rt, p + 4, 0x01000000)
      putL(rt, p + 8, 0x00960100)
      putL(rt, p + 12, 0xfffffffe)
      s.line = 0x14
      // the source writes the last of the four tail longwords WITHOUT
      // advancing, so its Sub.l #12,a0 lands back on the first — _CurrentLine
      // sits on the $1403fffe, ready to be overwritten by the next append
      s.currentLine = p
      s.second = 1
    },

    /**
     * Set Second Planes n,addr (L68, +AMOSPro_Personnal.Lib.s:2827). One of the second screen's five
     * addressable pointers — the range check is 1..5, not 1..8. ErrMess 7
     * when there is no second screen.
     */
    'set second planes'(it) {
      const n = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      const s = rt.personnal
      if (n < 1 || n > 5) return
      if (s.bpl2 === 0) err(7)
      const a = s.bpl2 + (n - 1) * 8 + 2
      putW(rt, a, (addr >>> 16) & 0xffff)
      putW(rt, a + 4, addr & 0xffff)
    },

    /**
     * Set Second View n (L69, +AMOSPro_Personnal.Lib.s:2852) — the second screen's BPLCON0 plane
     * count, through the same _PlanesMask. Unlike Set View Planes this one
     * does not range-check n at all, so a wild value indexes past the table.
     * We clamp to the table rather than read whatever follows it.
     */
    'set second view'(it) {
      const n = it.evalInt()
      const s = rt.personnal
      if (s.bplcon2nd === 0) err(7)
      putW(rt, s.bplcon2nd + 2, PLANES_MASK[Math.max(0, Math.min(8, n))]!)
    },

    /** Set Second Color reg,r,g,b (L70, +AMOSPro_Personnal.Lib.s:2868) — Set Color, on _2pal */
    'set second color'(it) {
      const reg = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const g = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const s = rt.personnal
      if (s.pal2 === 0) err(7)
      let a = s.pal2
      for (let seen = 0; seen <= reg; seen++) {
        if (getW(rt, a) === 0x0106) a += 4
        if (seen === reg) break
        a += 4
      }
      putW(rt, a + 2, ((r << 8) | (g << 4) | b) & 0xffff)
    },

    /**
     * Second Y Size n (L78, +AMOSPro_Personnal.Lib.s:3091). Moves where the second screen starts, by
     * rewriting the line byte of the WAIT _CurrentLine is sitting on — but
     * only if that byte is still $14, so it does nothing once anything else
     * has been appended. n has $d taken off it and a negative result is
     * dropped.
     */
    'second y size'(it) {
      const n = it.evalInt()
      const s = rt.personnal
      if (s.currentLine === 0) return
      const w = getW(rt, s.currentLine)
      if ((w >> 8) !== 0x14) return
      const line = n - 0xd
      if (line < 0) return
      putW(rt, s.currentLine, ((line & 0xff) << 8) | (w & 0xff))
    },

    /**
     * Ham Mode n (L38, +AMOSPro_Personnal.Lib.s:1670) — BPLCON0 bit 11. The list interpreter honours
     * it since b219d4b, so this genuinely turns HAM on for a screen that was
     * not opened as one.
     */
    'ham mode'(it) {
      const on = it.evalInt() !== 0
      const s = rt.personnal
      if (s.bplConBase === 0) err(1)
      const a = s.bplConBase + 2
      putW(rt, a, on ? getW(rt, a) | 0x0800 : getW(rt, a) & ~0x0800)
    },

    /**
     * Set Deform Value n,v (routine 121, $666a). Sixteen slots at the 1.1
     * data bank +$70, indexed 1..16 or error 16. Nothing else in the library
     * reads them — the only two instructions that touch +$70 are this write
     * and its own bounds check — so whatever the deformation was going to be,
     * it did not ship.
     */
    'set deform value'(it) {
      const n = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      if (n < 1 || n > 16) err(16)
      rt.personnal.deform[n - 1] = v
    },

    /** Pic Unpack src To planeList (routine 115) — see `picUnpack`. */
    'pic unpack'(it) {
      const src = it.evalInt()
      it.expect('to')
      picUnpack(rt, src, it.evalInt())
    },

    /**
     * Anim Unpack bank,frame To planeList (routine 116, $650c). Pic Unpack
     * with a frame table in front of it: the longword at `bank + 8 + frame*4`
     * is the offset of that frame's packed block from the start of the bank.
     */
    'anim unpack'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const frame = it.evalInt()
      it.expect('to')
      const list = it.evalInt()
      picUnpack(rt, bank + getL(rt, bank + 8 + frame * 4), list)
    },

    /**
     * The Player 6.1 and OctaMED keywords (routines 124-131). Both groups are
     * thin wrappers over libraries that are not part of AMOS and are not in
     * the source tree — `player61.library` and `octaplayer.library` — reached
     * by LVO through a base the extension opens and caches. Nothing here can
     * decode a P61 module or an MMD2, so nothing sounds.
     *
     * What IS reproduced is the state machine around them, because it is
     * visible to the program: stopping a player that is not playing is error
     * 19, an out-of-range volume is error 20, freeing an OMD module that was
     * never loaded is error 25. Those are the extension's own checks, made
     * before it ever calls the library.
     *
     * They deliberately do NOT raise the library-not-found errors 17 and 21.
     * A machine without those libraries would, but ours is missing a decoder,
     * not a library, and dressing one up as the other would put a stop where
     * the program expects music. NOTES entry at closeout; the closable path
     * is a real P61 decoder, which `med play` already sets the precedent for.
     */
    /**
     * P61 Play has TWO table entries: id $09CC with spec `I0` and id $09DC
     * with `I0,0` and no name of its own — an arity variant, which
     * TokenTable.name resolves back to the named one. Routine 124 is byte for
     * byte routine 123 with an extra `move.l (a3)+,d0` at the front, so the
     * second argument is popped and then ignored. Both forms have to parse or
     * the second argument is left dangling at the comma.
     */
    'p61 play'(it) {
      it.evalInt()
      if (it.accept(',')) it.evalInt()
      rt.personnal.p61Playing = true
    },
    /**
     * P61 Stop (routine 125, $6788 in the 1.1 binary). No library is error
     * 17, no module error 19; then P61_End at $24(a6) and the module pointer
     * at the data block's +$de is cleared. Only that pointer is modelled.
     */
    'p61 stop'() {
      if (!rt.personnal.p61Playing) err(19)
      rt.personnal.p61Playing = false
    },
    /**
     * P61 Mvolume n (routine 126, $67e4) and P61 Mpos n (routine 127, $6860)
     * are the same routine twice over: the SAME 0..63 range check raising the
     * same error 20 — whose message is "Les valeurs de volume vont de 0 a
     * 63.", about volume, in both — then the library and module checks, then
     * $30(a6) or $2a(a6). Mpos had neither check here.
     */
    'p61 mvolume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 63) err(20)
      if (!rt.personnal.p61Playing) err(19)
    },
    'p61 mpos'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 63) err(20)
      if (!rt.personnal.p61Playing) err(19)
    },
    /**
     * Omd Load name$ (routine 128, $68d2). The name is copied into the data
     * block at +$75e and NUL-terminated, then: no octaplayer.library is
     * error 21, a module already loaded at +$102 is error 23, and a zero from
     * LoadModule (-$3c) is error 22.
     */
    'omd load'(it) {
      const name = it.evalStr()
      const s = rt.personnal
      if (s.omdModule !== 0) err(23)
      if ((rt.vfs?.readFile(name) ?? null) === null) err(22)
      s.omdModule = 1
    },
    /**
     * Omd Play (routine 129, $696e). No library is error 21; a non-zero from
     * the channel grab at -$1e(a6) is error 24; no module at +$102 releases
     * the channels again (-$24) and raises 25. Success sets the playing flag
     * at +$fe to -1.
     */
    'omd play'() {
      const s = rt.personnal
      if (s.omdModule === 0) err(25)
      s.omdPlaying = true
    },
    /**
     * Omd Stop (routine 130, $69e8) and Omd Free (routine 131, $6a30). Both
     * raise error 21 for a missing library and NOTHING ELSE: Stop tests the
     * playing flag and simply returns when it is not -1, Free tests the
     * module pointer and simply returns when it is zero. This port raised
     * error 25 in both places, which the library raises only from Omd Play.
     *
     * Free unloads through -$42(a6) and clears the module pointer; it does
     * not touch the playing flag, so a module freed while playing leaves the
     * flag set and a later Omd Stop still calls -$36/-$24. Kept.
     */
    'omd stop'() {
      const s = rt.personnal
      if (!s.omdPlaying) return
      s.omdPlaying = false
    },
    'omd free'() {
      const s = rt.personnal
      if (s.omdModule === 0) return
      s.omdModule = 0
    },

    /** Iff Convert addr (L39, +AMOSPro_Personnal.Lib.s:1688) — see `iffConvert`. */
    'iff convert'(it) {
      iffConvert(rt, it.evalInt())
    },

    /**
     * Iff8bits To Iff4bits src,count To dst (L79, +AMOSPro_Personnal.Lib.s:3103). Shifts `count`
     * RGB triples down four bits each — a 24-bit CMAP into the 12-bit form
     * a COLOR register takes. Source and destination may be the same block;
     * it walks forward a byte at a time either way.
     */
    'iff8bits to iff4bits'(it) {
      let src = it.evalInt()
      it.expect(',')
      const count = it.evalInt()
      it.expect('to')
      let dst = it.evalInt()
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < 3; c++) putB(rt, dst++, getB(rt, src++) >> 4)
      }
    },

    /**
     * Aga Reserve Icon n (L87, +AMOSPro_Personnal.Lib.s:3369). AllocMem's a chip block of
     * `n*260 + 8` and stamps it `"F.C1"` followed by the count. Reserving
     * over a live bank is error 15; a failed AllocMem is error 8, which
     * cannot happen here because the allocation is a Uint8Array.
     *
     * _Icons is written BEFORE the allocation, so on a real machine the
     * error-8 path leaves the count set against a bank that does not exist.
     */
    'aga reserve icon'(it) {
      const n = it.evalInt()
      const s = rt.personnal
      if (s.icons !== 0) err(15)
      s.icons = n
      const mem = new Uint8Array(n * 260 + 8)
      mem.set([0x46, 0x2e, 0x43, 0x31]) // "F.C1"
      mem[4] = (n >>> 24) & 0xff
      mem[5] = (n >>> 16) & 0xff
      mem[6] = (n >>> 8) & 0xff
      mem[7] = n & 0xff
      rt.personnalIcons = mem
      s.icBase = Runtime.PERSONNAL_ICON_BASE
    },

    /**
     * Aga Erase Icon (L88, +AMOSPro_Personnal.Lib.s:3403). Frees the bank. With no bank at all it
     * returns in silence, but a count with no base is error 9 — and note the
     * count is cleared before that test, so the error leaves both registers
     * zero either way.
     */
    'aga erase icon'() {
      const s = rt.personnal
      if (s.icons === 0) return
      s.icons = 0
      if (s.icBase === 0) err(9)
      s.icBase = 0
      rt.personnalIcons = null
    },

    /** Aga Get Icon / Aga Paste Icon icon,x,y (L89/L90, +AMOSPro_Personnal.Lib.s:3426/:3479) — see `icon`. */
    'aga get icon'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      icon(rt, n, x, it.evalInt(), false)
    },
    'aga paste icon'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      icon(rt, n, x, it.evalInt(), true)
    },

    /**
     * Aga Icon Save name$ (L92, +AMOSPro_Personnal.Lib.s:3541). Writes the whole bank, header and
     * all, so the file is exactly what Aga Icon Load expects back. No bank
     * is error 9; a name outside 1..95 characters returns in silence,
     * because that is the length the routine's own _IcN buffer holds.
     */
    'aga icon save'(it) {
      const name = it.evalStr()
      const s = rt.personnal
      if (s.icBase === 0) err(9)
      if (name.length < 1 || name.length > 95) return
      rt.vfs?.writeFile(name, rt.personnalIcons!.subarray(0, s.icons * 260 + 8))
    },

    /**
     * Aga Icon Load name$ (L93, +AMOSPro_Personnal.Lib.s:3598). Reads the eight-byte header, checks
     * the `"F.C1"` cookie, allocates from the count it carries and reads the
     * rest in behind a freshly written header.
     *
     * A file that is not an icon bank is error 10, and the routine clears
     * both registers on the way out — so a failed load discards whatever
     * bank was already there.
     */
    'aga icon load'(it) {
      const name = it.evalStr()
      const s = rt.personnal
      if (name.length < 1 || name.length > 95) return
      const d = rt.vfs?.readFile(name) ?? null
      const cookie = d && d.length >= 8 ? String.fromCharCode(d[0]!, d[1]!, d[2]!, d[3]!) : ''
      if (cookie !== 'F.C1') {
        s.icons = 0
        s.icBase = 0
        rt.personnalIcons = null
        err(10)
      }
      const count = ((d![4]! << 24) | (d![5]! << 16) | (d![6]! << 8) | d![7]!) >>> 0
      const mem = new Uint8Array(count * 260 + 8)
      mem.set(d!.subarray(0, Math.min(d!.length, mem.length)))
      rt.personnalIcons = mem
      s.icons = count
      s.icBase = Runtime.PERSONNAL_ICON_BASE
    },

    /**
     * Mplot Start Plane n (routine 120, $6644). Which entry of _BitsPlanes
     * Mplot Draw begins at: 1 to 8, or error 14. 1.1 only — the published
     * 1.1a source compiles to the smaller binary, where the keyword does not
     * exist and Mplot Draw always starts at plane 0.
     *
     * The 1.1 build reads it at $5bfc as `(_MpStartPlane - 1) * 4` added to
     * _BitsPlanes, and only two instructions in the whole library touch the
     * variable: that read and this write. Nothing initialises it, and its
     * declared default is ZERO — so on a real 1.1, `Mplot Draw` without a
     * preceding `Mplot Start Plane` indexes _BitsPlanes[-1], which is the
     * longword at the base of the data bank: the ASCII "Fred", the author's
     * own signature, taken as a bitplane address. None of the 69 shipped
     * demos calls this keyword, so all of them hit that path on 1.1 and work
     * only on 1.0b.
     *
     * DEVIATION: this port defaults it to 1, not 0. One handler serves both
     * versions, 1.0b is what every demo is written against, and starting at
     * plane 0 is what 1.0b does. Calling the keyword gives the 1.1 behaviour
     * from then on.
     */
    'mplot start plane'(it) {
      const n = it.evalInt()
      if (n < 1 || n > 8) err(14)
      rt.personnal.mpStartPlane = n
    },

    /**
     * Full View (routine 122, $66a2). 1.1 only, and read off the binary for
     * the same reason. Appends five longwords at _CurrentLine:
     *
     *   $FFBCFFFE / $0003FFFE   the pair that gets a copper past line 255,
     *                           since its vertical compare is eight bits
     *   $3103FFFE               wait for line $31
     *   $00960100               DMACON, set bit 8
     *   $FFFFFFFE               the end of the list
     *
     * Error 1 when there is no list. It does NOT advance _CurrentLine after
     * writing, unlike every other appending keyword, so the next Copper Line
     * lays itself over the top of this tail.
     */
    'full view'() {
      const s = rt.personnal
      if (s.currentLine === 0) err(1)
      const tail = [0xffbcfffe, 0x0003fffe, 0x3103fffe, 0x00960100, 0xfffffffe]
      tail.forEach((v, i) => putL(rt, s.currentLine + i * 4, v))
    },

    /**
     * The five mosaics (L32-L36, +AMOSPro_Personnal.Lib.s:1316/:1373/:1444/:1516/:1588). See
     * `mosaic` for the routine they share.
     */
    'mosaic x2'(it) {
      mosaic(rt, it.evalInt(), 2)
    },
    /** Mosaic X4 (L33, +AMOSPro_Personnal.Lib.s:1373) */
    'mosaic x4'(it) {
      mosaic(rt, it.evalInt(), 4)
    },
    /** Mosaic X8 (L34, +AMOSPro_Personnal.Lib.s:1444) */
    'mosaic x8'(it) {
      mosaic(rt, it.evalInt(), 8)
    },
    /** Mosaic X16 (L35, +AMOSPro_Personnal.Lib.s:1516) */
    'mosaic x16'(it) {
      mosaic(rt, it.evalInt(), 16)
    },
    /** Mosaic X32 (L36, +AMOSPro_Personnal.Lib.s:1588) */
    'mosaic x32'(it) {
      mosaic(rt, it.evalInt(), 32)
    },

    /**
     * Double Mask mask To s1,s2 (L53, +AMOSPro_Personnal.Lib.s:2180) and
     * L Double Mask mask,ystart,yend To s1,s2 (L54, +AMOSPro_Personnal.Lib.s:2264).
     * See `doubleMask`. The result is written back over s2.
     */
    'double mask'(it) {
      const mask = it.evalInt()
      it.expect('to')
      const s1 = it.evalInt()
      it.expect(',')
      doubleMask(rt, mask, s1, it.evalInt(), 0, null)
    },
    'l double mask'(it) {
      const mask = it.evalInt()
      it.expect(',')
      const y0 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const s1 = it.evalInt()
      it.expect(',')
      doubleMask(rt, mask, s1, it.evalInt(), y0, y1)
    },

    /**
     * Blit Mask a,mask,c To target (L59, +AMOSPro_Personnal.Lib.s:2480) and
     * L Blit Mask a,mask,c To target,ystart,yend (L60, +AMOSPro_Personnal.Lib.s:2571). See `blitMask`
     * for the minterm and for the L form's row count.
     */
    'blit mask'(it) {
      const a = it.evalInt()
      it.expect(',')
      const mask = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      it.expect('to')
      blitMask(rt, a, mask, c, it.evalInt(), 0, null)
    },
    'l blit mask'(it) {
      const a = it.evalInt()
      it.expect(',')
      const mask = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      it.expect('to')
      const target = it.evalInt()
      it.expect(',')
      const y0 = it.evalInt()
      it.expect(',')
      blitMask(rt, a, mask, c, target, y0, it.evalInt())
    },

    /** Blitter Clear base (routine 113) — see `blitPlanes`. */
    'blitter clear'(it) {
      const b = it.evalInt()
      blitPlanes(rt, 0, b, b, false)
    },
    /** Blitter Copy source To target (L82, +AMOSPro_Personnal.Lib.s:3183) — see `blitPlanes`. */
    'blitter copy'(it) {
      const src = it.evalInt()
      it.expect('to')
      const dst = it.evalInt()
      if (src === 0 || dst === 0) err(4)
      blitPlanes(rt, src, dst, src, true)
    },

    /** S32 Block To Screen / S32 Vertice To Screen (L83/L84, +AMOSPro_Personnal.Lib.s:3237/:3281) — see `s32Expand`. */
    's32 block to screen'(it) {
      s32Expand(rt, it.evalInt(), true)
    },
    's32 vertice to screen'(it) {
      s32Expand(rt, it.evalInt(), false)
    },

    /**
     * Octets Fill value,start To end (L81, +AMOSPro_Personnal.Lib.s:3171). A byte memset over
     * [start,end), skipped entirely when end is below start.
     *
     * `end` equal to `start` passes the `Bmi` and then never satisfies the
     * do-while's `Cmp.l a0,a1 / Bne`, so the 68k fills memory until it faults.
     * Here it writes nothing.
     */
    'octets fill'(it) {
      const v = it.evalInt()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      if (end < start) return
      const w = bytesAt(rt, start, end - start, true)
      if (w) w.fill(v & 0xff)
      else for (let p = start; p < end; p++) putB(rt, p, v)
    },

    /** Low Filter.b/.w/.l value To start,end (L62/L63/L64, +AMOSPro_Personnal.Lib.s:2677/:2690/:2703) — see `lowFilter`. */
    'low filter.b'(it) {
      const v = it.evalInt()
      it.expect('to')
      const start = it.evalInt()
      it.expect(',')
      lowFilter(rt, v, start, it.evalInt(), 1)
    },
    /** Low Filter.w (L63, +AMOSPro_Personnal.Lib.s:2690) */
    'low filter.w'(it) {
      const v = it.evalInt()
      it.expect('to')
      const start = it.evalInt()
      it.expect(',')
      lowFilter(rt, v, start, it.evalInt(), 2)
    },
    /** Low Filter.l (L64, +AMOSPro_Personnal.Lib.s:2703) */
    'low filter.l'(it) {
      const v = it.evalInt()
      it.expect('to')
      const start = it.evalInt()
      it.expect(',')
      lowFilter(rt, v, start, it.evalInt(), 4)
    },

    /**
     * Word Switch start To end (routine 119, $661c). Byte-swaps every word in
     * the range — the endianness flip you need after reading a little-endian
     * file. The loop is a do-while whose test is `a1 < end` with a1 one byte
     * past the current word, so it swaps at least one word and stops when the
     * NEXT word would begin at or past end.
     *
     * Read off the shipped binary: the published 1.1a source has L119 as an
     * empty label, like L113.
     *
     * A range that ends at or below its start swaps that one word here and
     * stops; the 68k keeps stepping until the pointer wraps.
     */
    'word switch'(it) {
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      for (let p = start; ; p += 2) {
        const lo = getB(rt, p)
        putB(rt, p, getB(rt, p + 1))
        putB(rt, p + 1, lo)
        if (p + 3 >= end) return
      }
    },

    /**
     * F Set Sprite Buffer base,length (L55, +AMOSPro_Personnal.Lib.s:2362). Records where the hardware
     * sprites live; the buffer has to be at least 8K or it raises error 5,
     * "Banque memoire trop petite".
     */
    'f set sprite buffer'(it) {
      const base = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      if (len < 8192) err(5)
      rt.personnal.spriteBase = base
      rt.personnal.spriteLength = len
    },

    /** Get Even/Odd Sprite base,n,x,y To lines (L56/L57, +AMOSPro_Personnal.Lib.s:2375/:2413) — see `getSprite`. */
    'get even sprite'(it) {
      const base = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect('to')
      getSprite(rt, base, n, x, y, it.evalInt(), false)
    },
    'get odd sprite'(it) {
      const base = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect('to')
      getSprite(rt, base, n, x, y, it.evalInt(), true)
    },

    /**
     * F Sprite n To x,y,ysize,bank (L58, +AMOSPro_Personnal.Lib.s:2452). Points hardware sprite n at
     * entry `bank` of the sprite buffer and fills in that sprite's four
     * control bytes: VSTART, HSTART as x/2, VSTOP as y+ysize, then zero.
     *
     * It patches the copper list at `_SprPtBase + n*4 + 2`, but the eight
     * sprite pointers are two MOVEs each and so eight bytes apart — the shift
     * should be `Lsl.l #3`, not `#2`. Sprite 0 lands right; sprite 1 writes
     * its high word into SPR0PTL and its low word into SPR1PTH, and so on.
     * Kept, and tested.
     *
     * The buffer it points at is the one Get Even/Odd Sprite never fills.
     */
    'f sprite'(it) {
      const n = it.evalInt()
      it.expect('to')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const ysize = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      const s = rt.personnal
      const at = s.sprPtBase + n * 4 + 2
      const sprite = s.spriteBase + bank * 520
      putW(rt, at, sprite >>> 16)
      putW(rt, at + 4, sprite & 0xffff)
      putB(rt, sprite, y)
      putB(rt, sprite + 1, x >> 1)
      putB(rt, sprite + 2, y + ysize)
      putB(rt, sprite + 3, 0)
    },

    /**
     * Allow Plane Col n / Forbid Plane Col n (L40/L41, +AMOSPro_Personnal.Lib.s:1890/:1911). Which
     * bitplanes take part in collision detection: a bit in the extension's
     * own _BPlanesMask, and a bit of CLXCON at _Others+26.
     *
     * The CLXCON half does not work. The routine shifts the plane number left
     * six before `Bset d0,d1`, and Bset on a DATA register takes its bit
     * number modulo 32 — so n*64 is bit 0 whatever n was. Every plane
     * therefore sets and clears the same CLXCON bit. _BPlanesMask gets the
     * right bit, because that Bset is on memory and takes modulo 8.
     *
     * Kept, because it is what the library does, and named here because it
     * looks like a typo someone would otherwise fix.
     */
    'allow plane col'(it) {
      planeCol(rt, it.evalInt(), true)
    },
    'forbid plane col'(it) {
      planeCol(rt, it.evalInt(), false)
    },

    /** Set Ntsc (L3, +AMOSPro_Personnal.Lib.s:524) — BEAMCON0 $DFF1DC = 0 */
    'set ntsc'() {
      rt.beamcon0 = 0x0000
    },
    /** Set Pal (L4, +AMOSPro_Personnal.Lib.s:528) — BEAMCON0 = $0020, PAL */
    'set pal'() {
      rt.beamcon0 = 0x0020
    },

    /**
     * Aga Off (L61, +AMOSPro_Personnal.Lib.s:2672). Two direct register writes, not a list patch:
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
     * Screen X Size (L24, +AMOSPro_Personnal.Lib.s:989) and Screen Y Size (L25, +AMOSPro_Personnal.Lib.s:998).
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
     * Set Color(n) — the FUNCTION form, and it does not read a colour.
     *
     * The palette reader the author wrote is at L18
     * (+AMOSPro_Personnal.Lib.s:810): it indexes the _AgaPalette shadow,
     * bounds the register at 255, or at 31 when the list is not an Aga one,
     * and answers -1 outside that. Nothing reaches it. Its label says
     *
     *     L_COLORREAD		Equ	1
     *
     * where every other label in the file names the routine it sits above,
     * so the token table's function field for `set color` is 1, not 18 —
     * and routine 1 is `L1`, a bare label that falls through `L2` into L3,
     * `Move.w #$0000,$DFF1DC / Rts`. That is Set Ntsc's body. Both shipped
     * binaries agree, 1.0b and 1.1 alike (`{"name":"set color","spec":"00",
     * "func":1}` in each), so this is what the library does, not what one
     * listing says.
     *
     * DEFECT: reading a colour back switches the display to NTSC and answers
     * nothing in particular. The routine never touches d3, so the value AMOS
     * takes as the result is whatever the previous call left there; 0 stands
     * in for it here because an emulator has to answer something. It also
     * never pops its parameter, which on the Amiga leaves AMOS's expression
     * stack four bytes high — that has no analogue here, where arguments
     * arrive already evaluated.
     */
    'set color'(): Value {
      rt.beamcon0 = 0x0000
      return VI(0)
    },

    /**
     * Cmap Base(addr) (L71, +AMOSPro_Personnal.Lib.s:2897). Scans forward for the "CMAP" tag in
     * TWO-byte steps, up to 16384 of them, and answers the address just past
     * the tag — which is the chunk's length field, not its data. Callers add
     * the 4 themselves. ErrMess 6 when there is no CMAP.
     */
    'cmap base'(_, a): Value {
      let p = int(a[0]!)
      for (let i = 0; i < 16384; i++) {
        const hi = getW(rt, p)
        const lo = getW(rt, p + 2)
        if (hi === 0x434d && lo === 0x4150) return VI(p + 4) // "CMAP"
        p += 2
      }
      return err(6)
    },

    /**
     * Iff Color(base, n) (L66, +AMOSPro_Personnal.Lib.s:2729). Colour n of a loaded IFF's CMAP,
     * packed to RGB4 from the 8-bit bytes.
     *
     * It scans for the tag itself rather than calling Cmap Base, and the two
     * do not agree: this one steps +8 to the DATA and gives up after 65536
     * tries, where Cmap Base steps +4 to the LENGTH and gives up after 16384.
     * Both are kept as they are — a program using one and then the other is
     * relying on that difference.
     */
    'iff color'(_, a): Value {
      let p = int(a[0]!)
      const n = int(a[1]!)
      for (let i = 0; i < 65536; i++) {
        if (getW(rt, p) === 0x434d && getW(rt, p + 2) === 0x4150) {
          const at = p + 8 + n * 3
          const r = getB(rt, at) >> 4
          const g = getB(rt, at + 1) >> 4
          const b = getB(rt, at + 2) >> 4
          return VI((r << 8) + (g << 4) + b)
        }
        p += 2
      }
      return err(6)
    },

    /**
     * Ham (L8, +AMOSPro_Personnal.Lib.s:556) and Ehb (L9, +AMOSPro_Personnal.Lib.s:561) are named constants, not tests —
     * $1000 and $40, the screen-mode flags a program passes to Screen Open.
     */
    ham(): Value {
      return VI(4096)
    },
    ehb(): Value {
      return VI(64)
    },

    // Sprite Col is NOT registered here, and must not be. Core AMOS has its
    // own Sprite Col (instr.ts:4136) with different arguments, and this
    // dispatch table is keyed by NAME — an extension handler spread after the
    // core one silently replaces it, which is what happened when this was
    // added: two core sprite tests broke and the census lost two programs.
    //
    // On a real machine the two are different tokens, core against ext13, and
    // both exist. Here core wins, because core programs are the many and
    // Personnal's collision readers answer a constant anyway (see clxBit).
    // NOTES entry at closeout; the general problem is its own task.

    /** Playfields Col (L45, +AMOSPro_Personnal.Lib.s:1992) — CLXDAT bit 0, playfield against playfield */
    'playfields col'(): Value {
      return VI(clxBit(rt, 0))
    },

    /**
     * Pf Sprites Col(pf,spr) (L46, +AMOSPro_Personnal.Lib.s:2000) — playfield against sprite pair,
     * CLXDAT bits 1-4 for playfield 1 and 5-8 for playfield 2.
     */
    'pf sprites col'(_, a): Value {
      const key = (int(a[0]!) << 4) | int(a[1]!)
      const bit = { 0x10: 1, 0x12: 2, 0x14: 3, 0x16: 4, 0x20: 5, 0x22: 6, 0x24: 7, 0x26: 8 }[key]
      return VI(clxBit(rt, bit ?? null))
    },

    /** Copper Base (L14, +AMOSPro_Personnal.Lib.s:744) and Copper Line (L20, +AMOSPro_Personnal.Lib.s:866) — plain readers */
    'copper base'(): Value {
      return VI(rt.personnal.copperBase)
    },
    'copper line'(): Value {
      return VI(rt.personnal.line)
    },

    /** Mplot Base (L99, +AMOSPro_Personnal.Lib.s:3931) — the bank address, or 0 */
    'mplot base'(): Value {
      return VI(rt.personnal.mpBase)
    },

    /**
     * Sprite Col(s1,s2) (L44, +AMOSPro_Personnal.Lib.s:1958), registered under Personnal's own slot
     * because core owns the plain name and asks a different question of
     * different arguments — core's is `Sprite Col(n[,first[,last]])`, a real
     * sprite-against-sprites check. A Personnal program calling this used to
     * get that instead, which is not a harmless substitution: it answers with
     * a colliding sprite number where this answers -1.
     *
     * Personnal maps the PAIR of sprite numbers onto one CLXDAT bit through a
     * ladder of Cmp/Move (:1958-:1998) and answers -1 when that bit is CLEAR
     * — the same inverted test as Playfields Col, and the same always--1
     * result, because nothing writes CLXDAT here.
     *
     * Declared under its plain name and registered slot-qualified: the
     * contract in ./extimpl.ts lists it in `qualified`, and the slots come
     * from wherever a Personnal identity was actually bound. The library
     * expects 13 (`ExtNb Equ 13-1`, and 68 of the 69 shipped demos agree) but
     * a slot is a per-machine config entry, so it is never spelled here.
     * Where Personnal is absent the name stays core's, as it must.
     */
    'sprite col'(_: unknown, a: Value[]): Value {
      void a
      return VI(clxBit(rt, 0))
    },

    /**
     * Right Click (L5, $29aa) — POTGOR bit 10, DATLY, port 0 pin 9, answering
     * -1 when the bit is clear. TURBO Plus owns the plain name and reads the
     * same button to the same answer, so nothing was lost while this was
     * unregistered; but relying on another extension happening to agree is
     * not the same as implementing it. Registered under Personnal's own slot
     * so the agreement is a fact about the two libraries rather than a
     * dependency.
     */
    'right click': (): Value => VI(rt.input.mouseK & 2 ? -1 : 0),

    /** =Aga Icon Base (L91, +AMOSPro_Personnal.Lib.s:3535) — _IcBase, zero when unreserved. */
    'aga icon base'(): Value {
      return VI(rt.personnal.icBase)
    },

    /** Pic Pack(src To dst) (routine 114) — see `picPack`; answers the size. */
    'pic pack'(_, a): Value {
      return VI(picPack(rt, int(a[0]!), int(a[1]!)))
    },

    /**
     * Fpeek(addr) and Speek(addr) (routines 117/118, $6600/$660c). The two
     * nibbles of a byte, high and low — the pair you need to read back what
     * Iff8bits To Iff4bits packed.
     */
    fpeek(_, a): Value {
      return VI(getB(rt, int(a[0]!)) >> 4)
    },
    speek(_, a): Value {
      return VI(getB(rt, int(a[0]!)) & 0xf)
    },

    /** Fc Cos/Sin/Tan(angle) (L47/L48/L49, +AMOSPro_Personnal.Lib.s:2036/:2062/:2088) — see `fcTrig`. */
    'fc cos'(_, a): Value {
      return VI(fcTrig(P_COS, int(a[0]!)))
    },
    'fc sin'(_, a): Value {
      return VI(fcTrig(P_SIN, int(a[0]!)))
    },
    'fc tan'(_, a): Value {
      return VI(fcTrig(P_TAN, int(a[0]!)))
    },

    /** Iff X Size/Y Size/Planes(addr) (L50/L51/L52, +AMOSPro_Personnal.Lib.s:2114/:2136/:2158) — see `iffHeader`. */
    'iff x size'(_, a): Value {
      return VI(iffHeader(rt, int(a[0]!), 'w'))
    },
    'iff y size'(_, a): Value {
      return VI(iffHeader(rt, int(a[0]!), 'h'))
    },
    'iff planes'(_, a): Value {
      return VI(iffHeader(rt, int(a[0]!), 'd'))
    },

    /**
     * Fire(1,2) and Fire(1,3) (L6/L7, +AMOSPro_Personnal.Lib.s:541/:549). The second and third fire
     * buttons of joystick port 1, read as POTGOR bits — `Btst` on a memory
     * operand is byte-sized, so `#6` and `#4` of the byte at $DFF016 are bits
     * 14 and 12 of the word, DATRY and DATRX, port 1 pins 9 and 5. Answer -1
     * when the bit is CLEAR, which is what a pressed button pulls it to.
     *
     * Nothing here models a second or third button, so both read as the idle
     * port does on real hardware, where the lines are pulled high: 0.
     */
    'fire(1,2)'(): Value {
      return VI(0)
    },
    'fire(1,3)'(): Value {
      return VI(0)
    },

    /**
     * Test (L11, +AMOSPro_Personnal.Lib.s:666). Despite the name it is a probe: it returns _MpP,
     * the plane count Mplot Planes set. Nothing else, no argument.
     */
    test(): Value {
      return VI(rt.personnal.mpP)
    },

    /**
     * X Mplot(n) / Y Mplot(n) / C Mplot(n) (L101-L103, +AMOSPro_Personnal.Lib.s:4033-:4073).
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
     * Plane Base(n) (L17, +AMOSPro_Personnal.Lib.s:794). The address Set Plane recorded, or 0 for a
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
