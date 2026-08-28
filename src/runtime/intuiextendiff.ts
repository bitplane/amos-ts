/**
 * IntuiExtend 2.01b, the IFF group.
 *
 * Twenty keywords, and not one of them does any IFF work itself. Every one
 * begins `Rbsr routine 196`, which is
 *
 *     $43e4  movea.l  $258(a5),a2
 *     $43e8  adda.w   #$14,a2
 *     $43ec  tst.l    (a2)
 *     $43ee  bne.b    $43fe
 *     $43f4  lea.l    $4400(pc),a1     ; "iff.library"
 *     $43f8  jsr      -$198(a6)        ; OpenLibrary, any version
 *
 * so the group is a veneer over a THIRD-PARTY library, opened on demand and
 * kept at workspace+$14. There is no `Iff Lib Open` keyword; routine 196 is
 * the open, and it runs before every call.
 *
 * ## The library
 *
 * `iff.library`, and the copy to read is the one IntuiExtend ships itself:
 * `IntuiExtend20b/distribution/libs/iff.library` in the corpus, 3,160 bytes,
 * dated 24.5.93. Its version string is
 * "IFF 23.2 (24.5.93) (-: by Christian A. Weber :-)".
 *
 * No `.fd` for it exists on this machine, so the LVOs were read out of the
 * binary. Its resident at $2e carries RTF_AUTOINIT, rt_Init at $94 gives a
 * function table at $a4, and the table is WORD-relative --- its first word is
 * $ffff. Twenty-five entries, ending at -$96:
 *
 *     -$1e $252   -$24 $3a8   -$2a $410   -$30 $440   -$36 $46c
 *     -$3c $4b4   -$42 $5a4   -$48 $5bc   -$4e $808   -$54 $824
 *     -$5a $24a   -$60 $87c   -$78 $1e0   -$7e $9e0   -$84 $a54
 *     -$8a $ae0   -$90 $b14   -$96 $bb0
 *
 * with -$66, -$6c and -$72 all pointing at the same stub as -$18. What each
 * one does is named where it is used below, from its own code.
 *
 * ## Two shapes of handle, told apart by a magic
 *
 * `Iff Open Read` and `Iff Open Write` both answer through -$78, chosen by d0,
 * and they hand back completely different things.
 *
 * A READ handle is the whole file in memory. `Iff Find Chunk` walks it as an
 * IFF stream, so a program may `Leek` its way around one. Its allocation size
 * sits in the long BEFORE it, which is how -$24 frees it:
 *
 *     $3ba  move.l   -(a1),d0
 *     $3c0  jsr      -$d2(a6)        ; exec FreeMem
 *
 * A WRITE handle is 80 bytes whose first long is $00496648, the characters
 * `\0IfH`. -$24 tests that long first and takes the dos path when it matches:
 * Close the file at +4, then FreeMem 80. So `Iff Close` serves both, and what
 * tells them apart is four bytes of magic at the front of one of them.
 *
 * ## What Iff Open Read does with a file that is not IFF
 *
 * It opens `xpkmaster.library` (the name is at $394) and decrunches through
 * it, then re-checks for FORM. So a crunched picture loads without the
 * program knowing. That is modelled with ../amiga/xpkmaster.ts, which this
 * tree already carries for `butility-1.21`.
 *
 * ## The error codes are the library's, not the extension's
 *
 * $7f8 stores d0 into the per-task node at +$12 and answers FALSE; $7ec
 * clears it and answers TRUE. `Iff Get Error` (-$4e) reads that long and
 * CLEARS it, so the second read of one error is 0. IffB lists them and every
 * one below was matched to the `moveq` that raises it: 16 at $222 and $276,
 * 18 at $200, 20 at $23c, 24 at $4cc, 25 at $452 and $4d8, 26 at $504, 28 at
 * $528. The -1 IffB puts at the top of its list is $820, which is what -$4e
 * answers when the library cannot find its per-task node at all.
 *
 * ## Evidence
 *
 * BINARY tier, and two binaries: IntuiExtend's own hunk for the keywords, and
 * iff.library 23.2 for everything they call. Documented against
 * `IntuiExtend_2.0.Guide`'s Iff.guide and IffNotion.guide, @Author CIERP
 * Philippe. The guide covers the READ side only --- `Iff Open Write`,
 * `Iff Write Chunk`, `Iff Save Bitmap`, `Iff Save Clip`, `Iff Display`,
 * `Iff Get Bitmap Header` and the two block keywords have no node anywhere.
 *
 * ## Three defects
 *
 * `Iff Save Bitmap` and `Iff Save Clip` both take the library base out of one
 * of their own arguments:
 *
 *     $56fa  move.l   (a3)+,d7      ; an integer argument
 *     $5702  movea.l  d7,a2         ; over the workspace pointer just set up
 *     $5706  movea.l  (a2),a6       ; a6 = *argument
 *     $570c  jsr      -$2a(a6)
 *
 * so the `jsr` goes wherever the long at that address points, minus the LVO.
 * `Iff Save Bitmap` also has the wrong LVO: -$2a is FindChunk and SaveBitMap
 * is -$42. Both are marked where they are defined.
 *
 * The five BMHD getters never test what -$30 gave them:
 *
 *     $582c  jsr      -$30(a6)
 *     $5830  movea.l  d0,a0
 *     $5834  move.w   (a0),d3
 *
 * A file with no BMHD chunk answers 0 from -$30, and the `move.w` then reads
 * address 0. `Iff Get Bitmap Header` is the one that DOES hand the 0 back.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, int, str, type Value } from '../interp/values'
import { parseIlbm } from '../amiga/ilbm'
import { xpkUnpack } from '../amiga/xpkmaster'
import { ieMem } from './intuiextendwin'
import { ieRastPortAt } from './intuiextendgfx'
import type { IntuiextendState } from './intuiextend'

/** the base handle routine 196 parks at workspace+$14 */
export const IE_IFF_BASE = 0x4c00_0000

/** `move.l #$496648,(a2)` at $206 --- the write handle's first long */
export const IFF_WRITE_MAGIC = 0x0049_6648

/**
 * Every error IffB lists, at the `moveq` in iff.library that raises it.
 *
 * NO_NODE is the -1 at $820, which is not raised by anything: it is what
 * -$4e answers when it cannot find the per-task node to read the error from.
 */
export const IE_IFF_ERR = {
  OPEN: 16,
  READ: 17,
  MEMORY: 18,
  NOT_IFF: 19,
  WRITE: 20,
  NOT_ILBM: 24,
  NO_BMHD: 25,
  NO_BODY: 26,
  COMPRESSION: 28,
  NO_ANHD: 29,
  NO_DLTA: 30,
  NO_NODE: -1,
} as const

/** one `Iff Open Write` handle: the dos file it will become, and what it holds */
interface IeIffWrite {
  path: string
  bytes: number[]
}

export interface IeIffState {
  /** workspace+$14, 0 until routine 196 has run once */
  base: number
  /** the per-task error at node+$12, which reading clears */
  error: number
  /** the write handles, by the address `Iff Open Write` handed out */
  writes: Map<number, IeIffWrite>
}

export function newIeIffState(): IeIffState {
  return { base: 0, error: 0, writes: new Map() }
}

/** 'BMHD', 'CMAP', 'CAMG', 'BODY' as the longs iff.library compares */
const ID = { BMHD: 0x424d4844, CMAP: 0x434d4150, CAMG: 0x43414d47, FORM: 0x464f524d, ILBM: 0x494c424d } as const

/**
 * FindChunk (-$2a at $410), walked over the program's own memory.
 *
 *     $410  movea.l  $4(a1),a0    ; the FORM length
 *     $416  adda.l   a1,a0        ; ... plus 8, so a0 is the end
 *     $418  addq.l   #$4,a1       ; a1 is the first chunk, past FORM/len/type
 *     $426  move.l   $4(a1),d1
 *     $42a  addq.l   #$1,d1
 *     $42c  bclr.b   #$0,d1       ; chunk lengths round up to even
 *
 * The answer is the address of the chunk's ID, not of its data, which is why
 * -$30 adds 8 to it at $45a. Iff0's "CHKLEN=Leek(CHK-4)" reads four bytes
 * BEFORE the id; the length is at CHK+4 and the data starts at CHK+8.
 *
 * A d0 of zero answers the end of the file rather than searching, which is
 * the `tst.l d0 / bne` at $41a.
 */
export function ieIffFindChunk(rt: Runtime, buf: number, id: number): number {
  const m = ieMem(rt)
  const start = buf >>> 0
  if (start === 0) return 0
  const end = (start + 8 + (m.long(start + 4) >>> 0)) >>> 0
  let p = (start + 12) >>> 0
  if (id === 0) return end
  while (p < end) {
    if ((m.long(p) >>> 0) === (id >>> 0)) return p
    const len = ((m.long(p + 4) >>> 0) + 1) & ~1
    p = (p + 8 + len) >>> 0
  }
  return 0
}

/** the whole file back out of the heap, for the ILBM decoder to read */
function iffBytes(rt: Runtime, buf: number): Uint8Array | null {
  const m = ieMem(rt)
  const start = buf >>> 0
  if (start === 0) return null
  const total = 8 + (m.long(start + 4) >>> 0)
  if (total <= 8 || total > 0x40_0000) return null
  const out = new Uint8Array(total)
  for (let i = 0; i < total; i++) out[i] = m.byte(start + i)
  return out
}

export function makeIntuiextendIffInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IeIffState => rt.intuiextend.iff
  const ext = (): IntuiextendState => rt.intuiextend

  /** routine 196: open iff.library if it is not open, before anything else */
  const open196 = (): void => {
    if (st().base === 0) st().base = IE_IFF_BASE
  }

  return {
    /**
     * Iff Close _IFF --- routine 267 ($4e9e), -$24 at $3a8.
     *
     * One keyword for both handles. `$3b2 cmpi.l #$496648,(a1)` picks the
     * write path, where the dos file at +4 is closed and 80 bytes freed;
     * anything else is a read buffer and `$3ba move.l -(a1),d0` takes its
     * length from the long in front of it.
     *
     * `$3ae move.l a1,d0 / beq` makes a close of 0 a no-op.
     */
    'iff close': (it) => {
      open196()
      const addr = it.evalInt() >>> 0
      if (addr === 0) return
      const m = ieMem(rt)
      const w = st().writes.get(addr)
      if (w !== undefined) {
        rt.vfs?.writeFile(w.path, new Uint8Array(w.bytes))
        st().writes.delete(addr)
        ext().heap.freeMem(addr)
        return
      }
      // a read buffer: the allocation starts four bytes in front of it
      ext().heap.freeMem((addr - 4) >>> 0)
      void m
    },

    /**
     * Iff Display BITMAP,IFF,CTABLE --- routine 296 ($561e).
     *
     * Two library calls in a row, and the argument stack is read twice:
     * `$5634 movea.l (a3),a1` peeks IFF without popping so that `$563c
     * movea.l (a3)+,a1` can take the same value again for the second call.
     * The first is GetColorTable into CTABLE, the second DecodePic into
     * BITMAP.
     *
     * `move.l d0,d3` at $563a stores GetColorTable's count in the result
     * register of a keyword the table declares as an instruction, so nothing
     * can read it.
     *
     * DEVIATION: BITMAP is a `struct BitMap *` on the machine, where
     * `Iff Decode Picture` takes a RastPort and follows rp_BitMap itself.
     * Nothing in this port hands a program a BitMap pointer, so this takes
     * the RastPort address that `Wb Screen Rastport` gives and follows the
     * same field.
     */
    'iff display': (it) => {
      open196()
      const bitmap = it.evalInt() >>> 0
      it.expect(',')
      const buf = it.evalInt() >>> 0
      it.expect(',')
      const ctable = it.evalInt() >>> 0
      getCtable(rt, buf, ctable)
      ieIffDecodePicture(rt, bitmap, buf)
    },

    /**
     * Iff Write Chunk DATA,LEN To _IFF --- routine 307 ($576a), -$8a at $ae0.
     *
     * The library writes the block straight through dos Write and adds the
     * length to the running total at handle+8; a short write is error 20.
     * Nothing here builds a chunk header, so the name and the length are the
     * caller's to write.
     *
     * DEVIATION: the bytes are accumulated and the file appears at
     * `Iff Close`, because this port's filesystem writes whole files. A
     * program that crashes between the two gets no file where the machine
     * would leave a partial one.
     */
    'iff write chunk': (it) => {
      open196()
      const data = it.evalInt() >>> 0
      it.expect(',')
      const len = it.evalInt() | 0
      it.expect('to')
      const handle = it.evalInt() >>> 0
      const w = st().writes.get(handle)
      if (w === undefined || len < 0) {
        st().error = IE_IFF_ERR.WRITE
        return
      }
      const m = ieMem(rt)
      for (let i = 0; i < len; i++) w.bytes.push(m.byte(data + i))
      const total = ieMem(rt).long(handle + 8) + len
      m.setLong(handle + 8, total)
      st().error = 0
    },

    /**
     * Iff Save Bitmap A,B To C$,D --- routine 304 ($56e8).
     *
     * DEFECT: wrong twice over. `$5702 movea.l d7,a2` puts the SECOND argument over
     * the workspace pointer set up four instructions earlier, and `$5706
     * movea.l (a2),a6` then takes the library base from the long at that
     * address. And the LVO is wrong: -$2a is FindChunk, while SaveBitMap is
     * -$42 ($5a4), four entries away.
     *
     * So a real call jumps to `*B - $2a`. There is nothing to be faithful to
     * there, and the port does nothing. The arguments are still consumed.
     */
    'iff save bitmap': (it) => {
      open196()
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect('to')
      str(it.evalExpr())
      it.expect(',')
      it.evalInt()
    },

    /**
     * Iff Save Clip A,B,C,D,E,F To G$,H --- routine 305 ($5714).
     *
     * DEFECT: the same `movea.l d7,a2 / movea.l (a2),a6` as `Iff Save Bitmap`
     * at $5736 and $573a. This one at least names the right function --- -$48
     * ($5bc) IS SaveClip, and the bitmap, the four rectangle words and the
     * filename all reach it in the right registers --- but the base does not,
     * and `$573c move.l $2(a0),d0` re-reads d0 from two bytes into the
     * filename after the last argument had already been popped into it.
     */
    'iff save clip': (it) => {
      open196()
      for (let i = 0; i < 6; i++) {
        if (i > 0) it.expect(',')
        it.evalInt()
      }
      it.expect('to')
      str(it.evalExpr())
      it.expect(',')
      it.evalInt()
    },
  }
}

/**
 * GetColorTable (-$36 at $46c): CMAP into 12-bit Amiga words.
 *
 *     $484  divs.w   #$3,d4       ; colours = chunk length / 3
 *     $48c  moveq    #$10,d5
 *     $48e  neg.b    d5           ; $f0, so each gun keeps its top four bits
 *     $4a6  move.w   d1,(a2)+
 *
 * DEFECT: `dbra d4` with d4 holding the COUNT runs count+1 times, and the
 * count was already saved as the return value at $48a. So it writes one word
 * more than it reports, reading the three bytes after the chunk to build it.
 * Iff9's warning that "CMAX peut tres bien retourner un nombre de couleurs
 * superieure" is about a padded CMAP and not about this.
 */
function getCtable(rt: Runtime, buf: number, dest: number): number {
  const m = ieMem(rt)
  const chunk = ieIffFindChunk(rt, buf, ID.CMAP)
  if (chunk === 0) return 0
  const len = m.long(chunk + 4) >>> 0
  const count = Math.trunc(len / 3)
  let src = (chunk + 8) >>> 0
  let out = dest >>> 0
  // count + 1 iterations, exactly as the dbra runs them
  for (let i = 0; i <= count; i++) {
    const r = m.byte(src) & 0xf0
    const g = m.byte(src + 1) & 0xf0
    const b = m.byte(src + 2) & 0xf0
    src += 3
    m.setWord(out, ((r << 4) | g | (b >> 4)) & 0xffff)
    out += 2
  }
  return count
}

export function makeIntuiextendIffFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IeIffState => rt.intuiextend.iff
  const ext = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => (a[n] === undefined ? '' : str(a[n]))

  const open196 = (): void => {
    if (st().base === 0) st().base = IE_IFF_BASE
  }

  /**
   * GetBMHD (-$30 at $440): FindChunk('BMHD') plus 8, or error 25.
   *
   * `$45a addq.l #$8,d0` is what turns FindChunk's chunk-header address into
   * the pointer at the BitMapHeader's own first field.
   */
  const bmhd = (buf: number): number => {
    const c = ieIffFindChunk(rt, buf, ID.BMHD)
    if (c === 0) {
      st().error = IE_IFF_ERR.NO_BMHD
      return 0
    }
    st().error = 0
    return (c + 8) >>> 0
  }

  /**
   * The five getters, which share everything but the field they read.
   *
   * DEFECT: none of them tests -$30's answer before dereferencing it, so a
   * buffer with no BMHD reads from address 0. Reproduced: `ieMem` answers 0
   * for anything unmapped, which is what a read of low memory gives on a
   * machine whose exec base is not a picture.
   */
  const field = (a: Value[], off: number, byteWide = false): Value => {
    open196()
    const m = ieMem(rt)
    const p = bmhd(i0(a, 0) >>> 0)
    return VI(byteWide ? m.byte(p + off) & 0xff : m.word(p + off) & 0xffff)
  }

  return {
    /**
     * =Iff Open Read(FILENAME$) --- routine 159 ($3b5e), -$78 at $1e0 with
     * `moveq #$0,d0`.
     *
     * The library opens the file MODE_OLDFILE ($3ed), reads twelve bytes and
     * seeks back, and takes the plain path when they start with FORM. When
     * they do not it opens xpkmaster.library and decrunches. The whole file
     * ends up in one AllocMem block whose length sits in the long in front of
     * it, and THAT address is the answer.
     *
     * Failure is 0, not -1: the error exits go through $7f8, which answers
     * FALSE. The `moveq #$ff,d3` at the top of routine 159 survives only when
     * iff.library itself cannot be opened.
     */
    'iff open read': (_, a) => {
      open196()
      const path = s0(a, 0)
      const raw = rt.vfs?.readFile(path) ?? null
      if (raw === null) {
        st().error = IE_IFF_ERR.OPEN
        return VI(0)
      }
      let bytes = raw
      const isForm = (b: Uint8Array): boolean =>
        b.length >= 12 && b[0] === 0x46 && b[1] === 0x4f && b[2] === 0x52 && b[3] === 0x4d
      if (!isForm(bytes)) {
        try {
          bytes = xpkUnpack(raw)
        } catch {
          st().error = IE_IFF_ERR.NOT_IFF
          return VI(0)
        }
        if (!isForm(bytes)) {
          st().error = IE_IFF_ERR.NOT_IFF
          return VI(0)
        }
      }
      const block = ext().heap.alloc(bytes.length + 4, { clear: true })
      if (block === 0) {
        st().error = IE_IFF_ERR.MEMORY
        return VI(0)
      }
      const m = ieMem(rt)
      m.setLong(block, bytes.length + 4)
      for (let i = 0; i < bytes.length; i++) m.setByte(block + 4 + i, bytes[i]!)
      st().error = 0
      return VI((block + 4) | 0)
    },

    /**
     * =Iff Open Write(FILENAME$) --- routine 160 ($3b86), -$78 with
     * `moveq #$1,d0`.
     *
     * 80 bytes of MEMF_CLEAR, `$00496648` written over the first long, dos
     * Open with MODE_NEWFILE ($3ee) into +4, and then eight bytes written at
     * once: `FORM` and a zero length, the constant at $38c. The length is a
     * placeholder and nothing in the library ever goes back to fix it.
     */
    'iff open write': (_, a) => {
      open196()
      const path = s0(a, 0)
      const block = ext().heap.alloc(0x50, { clear: true })
      if (block === 0) {
        st().error = IE_IFF_ERR.MEMORY
        return VI(0)
      }
      const m = ieMem(rt)
      m.setLong(block, IFF_WRITE_MAGIC)
      m.setLong(block + 4, block)
      m.setLong(block + 8, 8)
      st().writes.set(block >>> 0, { path, bytes: [0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 0] })
      st().error = 0
      return VI(block | 0)
    },

    /**
     * =Iff Find Chunk(CHKNAME$,BUFF) --- routine 303 ($56be), -$2a.
     *
     * Iff0 documents THREE arguments, `(CHKNAME$,BUFF,LEN)`, and the token
     * spec is `"02,0"` --- two. LEN would have been redundant anyway: $410
     * takes the end of the stream from the FORM length at BUFF+4.
     *
     * `$56d8 move.l $2(a0),d0` is the four characters of the name, read as a
     * long straight out of the AMOS string's text.
     */
    'iff find chunk': (_, a) => {
      open196()
      const name = s0(a, 0)
      const buf = i0(a, 1) >>> 0
      let id = 0
      for (let i = 0; i < 4; i++) id = ((id << 8) | (name.charCodeAt(i) & 0xff)) >>> 0
      return VI(ieIffFindChunk(rt, buf, id) | 0)
    },

    /** =Iff Get Bitmap Header(_IFF) --- routine 266 ($4e7a), -$30 */
    'iff get bitmap header': (_, a) => {
      open196()
      return VI(bmhd(i0(a, 0) >>> 0) | 0)
    },

    /** =Iff Get Width(_IFF) --- routine 311 ($5814), bmh_Width at BMHD+0 */
    'iff get width': (_, a) => field(a, 0),

    /** =Iff Get Height(_IFF) --- routine 312 ($583c), bmh_Height at +2 */
    'iff get height': (_, a) => field(a, 2),

    /** =Iff Get Xpos(_IFF) --- routine 313 ($5866), bmh_Left at +4 */
    'iff get xpos': (_, a) => field(a, 4),

    /** =Iff Get Ypos(_IFF) --- routine 314 ($5890), bmh_Top at +6 */
    'iff get ypos': (_, a) => field(a, 6),

    /** =Iff Get Depth(_IFF) --- routine 315 ($58ba), bmh_Depth at +8, a BYTE */
    'iff get depth': (_, a) => field(a, 8, true),

    /** =Iff Get Ctable(_IFF,BUFFER) --- routine 317 ($58f6), -$36 */
    'iff get ctable': (_, a) => {
      open196()
      return VI(getCtable(rt, i0(a, 0) >>> 0, i0(a, 1) >>> 0) | 0)
    },

    /**
     * =Iff Get Vmode(_IFF) --- routine 228 ($49c0), -$54 at $824.
     *
     * CAMG first. `$83a tst.w $8(a0)` looks at the LOW word of the value and,
     * when it is zero, masks the whole long with $ffff9efd --- old writers
     * that stored junk in the bits Commodore later claimed.
     *
     * With no CAMG at all it guesses from the BMHD at $858: HIRES ($8000)
     * when bmh_Depth is 4 or less AND the width is over $190 (400), and LACE
     * ($4) when the height is $140 (320) or more. Both tests, not either.
     */
    'iff get vmode': (_, a) => {
      open196()
      const m = ieMem(rt)
      const buf = i0(a, 0) >>> 0
      const camg = ieIffFindChunk(rt, buf, ID.CAMG)
      if (camg !== 0) {
        let v = m.long(camg + 8) >>> 0
        if ((v & 0xffff) === 0) v = (v & 0xffff9efd) >>> 0
        return VI(v | 0)
      }
      const p = bmhd(buf)
      if (p === 0) return VI(0)
      let mode = 0
      if ((m.byte(p + 8) & 0xff) <= 4 && (m.word(p) & 0xffff) > 0x190) mode |= 0x8000
      if ((m.word(p + 2) & 0xffff) >= 0x140) mode |= 0x4
      return VI(mode)
    },

    /**
     * =Iff Get Error --- routine 306 ($5748), -$4e at $808.
     *
     * `$812 move.l $12(a0),d0 / $816 clr.l $12(a0)` --- reading the error is
     * what clears it, so the same error never answers twice.
     */
    'iff get error': () => {
      open196()
      const e = st().error
      st().error = 0
      return VI(e | 0)
    },

    /**
     * =Iff Decode Picture(_IFF,RASTPORT) --- routine 310 ($57e0), -$3c.
     *
     * `$57f6 movea.l $4(a0),a0` is rp_BitMap, so the library never sees the
     * RastPort itself. Iff3's answer is "0 Si tout est Ok, ou -1 si une
     * erreur", and the routine bears that out in an unusual way: it returns
     * `moveq #$0,d3` on the path that CALLED the library, whatever the
     * library answered, and -1 only when iff.library is missing.
     *
     * DEFECT: -$3c's own result is dropped at $5800, so a picture that failed
     * to decode --- not ILBM, no BMHD, no BODY, an unknown compression ---
     * still answers 0. `Iff Get Error` is the only way to tell.
     */
    'iff decode picture': (_, a) => {
      open196()
      // the answer is 0 whether or not the decode worked; see the DEFECT above
      ieIffDecodePicture(rt, i0(a, 1) >>> 0, i0(a, 0) >>> 0)
      return VI(0)
    },

    /**
     * =Iff Compress Block(SRC,LEN To DST,METHOD) --- routine 308 ($578c),
     * -$90 at $b14.
     *
     * METHOD is `subq.l #$1,d1` at the top: 1 is ByteRun1, 0 falls to $b2c
     * and exec CopyMemQuick (-$270), and anything else is error 28. The
     * ByteRun1 packer answers the packed length in d3; the copy answers the
     * length it was given, because d0 is saved and restored around it.
     */
    'iff compress block': (_, a) => {
      open196()
      const src = i0(a, 0) >>> 0
      const len = i0(a, 1) | 0
      const dst = i0(a, 2) >>> 0
      const method = i0(a, 3) | 0
      return VI(packBlock(rt, src, len, dst, method, true))
    },

    /**
     * =Iff Decompress Block(SRC,LEN To DST,METHOD) --- routine 309 ($57b6),
     * -$96 at $bb0.
     *
     * The same method selector. LEN is the OUTPUT length and the unpacker
     * counts it down, so the caller has to know the unpacked size already;
     * d0 is preserved across the call, which means the answer is the length
     * that went in rather than anything measured.
     *
     * `$bde neg.b d1 / bmi.b $bec` is the rule that a run byte of $80 is
     * skipped: negating $80 leaves it negative.
     */
    'iff decompress block': (_, a) => {
      open196()
      const src = i0(a, 0) >>> 0
      const len = i0(a, 1) | 0
      const dst = i0(a, 2) >>> 0
      const method = i0(a, 3) | 0
      return VI(packBlock(rt, src, len, dst, method, false))
    },
  }
}

/**
 * DecodePic (-$3c at $4b4), which both `Iff Decode Picture` and
 * `Iff Display` end at.
 *
 * `$4c2 cmpi.l #$494c424d,$8(a4)` is the ILBM test, then GetBMHD, then the
 * BODY chunk, then a row loop that picks its unpacker from bmh_Compression
 * at BMHD+$a: 0 is the copier at $59e, 1 the ByteRun1 unpacker at $bca, and
 * anything else is error 28.
 *
 * `$55e cmp.b $5(a3),d3 / bcc` sends any source plane at or past the
 * destination's bm_Depth to a scratch buffer instead of a real one, so a
 * deeper picture than the screen loses its top planes rather than writing
 * past the bitmap.
 */
export function ieIffDecodePicture(rt: Runtime, rpAddr: number, buf: number): boolean {
  const st = rt.intuiextend.iff
  const rp = ieRastPortAt(rt, rpAddr >>> 0)
  const bytes = iffBytes(rt, buf)
  if (!rp || !bytes) {
    st.error = IE_IFF_ERR.NOT_ILBM
    return false
  }
  let img
  try {
    img = parseIlbm(bytes)
  } catch {
    st.error = IE_IFF_ERR.NOT_ILBM
    return false
  }
  const bm = rp.bitMap
  const mask = (1 << bm.depth) - 1
  const h = Math.min(img.height, bm.height)
  const w = Math.min(img.width, bm.width)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rp.putPixel(x, y, (img.pixels[y * img.width + x] ?? 0) & mask)
  }
  st.error = 0
  return true
}

/**
 * -$90 and -$96, which are one routine each side of the same method word.
 *
 * ByteRun1 as `$b96` measures it: a run is counted while the next byte
 * matches, up to $80, and a run of three or more is worth encoding. The
 * literal run is capped at $7f by `$b64 addq.b #$1,d2 / bmi.b $b78`.
 */
function packBlock(rt: Runtime, src: number, len: number, dst: number, method: number, pack: boolean): number {
  const st = rt.intuiextend.iff
  const m = ieMem(rt)
  if (len < 0) return 0
  if (method === 0) {
    for (let i = 0; i < len; i++) m.setByte(dst + i, m.byte(src + i))
    st.error = 0
    return len
  }
  if (method !== 1) {
    st.error = IE_IFF_ERR.COMPRESSION
    return 0
  }
  st.error = 0
  if (!pack) {
    let s = src >>> 0
    let d = dst >>> 0
    let left = len
    while (left > 0) {
      const n = m.byte(s++) & 0xff
      if (n < 0x80) {
        for (let i = 0; i <= n && left > 0; i++, left--) m.setByte(d++, m.byte(s++))
      } else if (n > 0x80) {
        const b = m.byte(s++)
        for (let i = 0; i <= 0x100 - n && left > 0; i++, left--) m.setByte(d++, b)
      }
      // $80 is skipped outright, which is what `neg.b d1 / bmi` does
    }
    return len
  }
  let s = src >>> 0
  const end = (src + len) >>> 0
  let d = dst >>> 0
  let out = 0
  const runAt = (p: number): number => {
    let n = 1
    while (p + n < end && n < 0x80 && m.byte(p + n) === m.byte(p)) n++
    return n
  }
  while (s < end) {
    const run = runAt(s)
    if (run >= 3) {
      m.setByte(d++, (0x100 - (run - 1)) & 0xff)
      m.setByte(d++, m.byte(s))
      s += run
      out += 2
      continue
    }
    let lit = 0
    let p = s
    while (p < end && lit < 0x80 && runAt(p) < 3) {
      p++
      lit++
    }
    m.setByte(d++, lit - 1)
    for (let i = 0; i < lit; i++) m.setByte(d++, m.byte(s + i))
    s += lit
    out += lit + 1
  }
  return out
}
