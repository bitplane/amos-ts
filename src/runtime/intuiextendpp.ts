/**
 * IntuiExtend 2.01b, the PowerPacker group.
 *
 * Six keywords, and every one of them is a thin wrapper over Nico François'
 * powerpacker.library. IntuiExtend contributes the argument shuffling, three
 * longs of workspace and nothing else. There is no compression code in this
 * binary at all.
 *
 * ## The library
 *
 * Routine 46 ($2dec) is the opener the other five call first. It looks at the
 * long at workspace+$0, and if it is zero it does OpenLibrary (-$198) on the
 * name at $2e08, which reads "powerpacker.library" once the disassembler
 * stops trying to decode it as code. The base goes back into workspace+$0.
 *
 * Every offset below comes out of `includes/pp/powerpacker_lib.i`, which AMOS
 * Professional ships. It is a LIBINIT with no argument, so the chain starts at
 * LIB_USERDEF, and `exec/libraries.i`:20-23 makes that LIB_BASE minus
 * LIB_RESERVED * LIB_VECTSIZE, or -$1e:
 *
 *     -$1e  ppLoadData         -$24  ppDecrunchBuffer
 *     -$60  ppAllocCrunchInfo  -$66  ppFreeCrunchInfo
 *     -$6c  ppCrunchBuffer     -$72  ppWriteDataHeader
 *
 * The last four are the only ones that file gives numerically rather than by
 * LIBDEF, and they are also the four with no autodoc anywhere on this machine.
 *
 * The register conventions are not guesswork either. Two pieces of shipped
 * assembler call the same entries with the arguments named:
 *
 *     +CompExt.s:449-455    ppLoadData: A0 name, D0 colour, D1 memory type,
 *                           A1 &buffer, A2 &length, A3 passkey
 *     AMOSPro_Explode_Lib.s:3981-3988   ppAllocCrunchInfo: D0 "ppEffizienz
 *                           (0-4)", D1 "pp.Speedup", A0 and A1 cleared
 *     +CompExt.s:712-718    ppWriteDataHeader: D0 handle, D1 efficiency,
 *                           D2 and D3 zero
 *
 * ## The three longs
 *
 *     workspace+$0   PPBase
 *     workspace+$4c  the file handle `Pp Write` opens
 *     workspace+$50  the buffer ppLoadData filled, which is `Pp Start`
 *     workspace+$54  its length, which is `Pp Len`
 *
 * Routines 131 ($3858) and 141 ($393e) are four instructions each: read the
 * long, `moveq #$0,d2`, rts. Nothing else in the library touches either.
 *
 * ## Pp Crunch does not check that it got a CrunchInfo
 *
 * DEFECT: routine 155 ($3a70) calls ppAllocCrunchInfo and moves the answer
 * into d7 with no test.
 *
 *     $3a8c  jsr      -$60(a6)      ; ppAllocCrunchInfo
 *     $3a90  move.l   d0,d7
 *     $3a92  move.l   (a3)+,d0      ; LENGTH
 *     $3a94  movea.l  (a3)+,a1      ; START
 *     $3a96  movea.l  d7,a0
 *     $3a98  jsr      -$6c(a6)      ; ppCrunchBuffer
 *
 * Both AMOS's own compiler (+CompExt.s:851 `Rbeq L_OOMem`) and Explode
 * (AMOSPro_Explode_Lib.s:3992 `beq.s .1`, which retries with a smaller buffer)
 * test it. IntuiExtend hands the zero to ppCrunchBuffer as its CrunchInfo
 * pointer and then to ppFreeCrunchInfo at $3aa0.
 *
 * ## The failure exit of Pp Crunch and Pp Decrunch returns nothing at all
 *
 * DEFECT: both routines branch past their own `moveq #$0,d2` when the library
 * is missing. Routine 130's `beq.b $3854` skips $3852, and routine 155's
 * `beq.b $3aa6` skips $3aa4. d2 is the type tag AMOS reads to decide what d3
 * holds and d3 is the value, so with neither written the keyword answers
 * whatever the last interpreter operation left in the pair, of whatever type
 * that operation left behind. Pp1 knows the case exists but describes it only
 * for the other two keywords: "si ce n'est pas le cas ou si un problème se
 * présente la fonction 'Pp Len' et 'Pp Start' retourneront un 0." Those two do
 * set d2.
 *
 * ## Pp Write ignores the header it just failed to write
 *
 * DEFECT: routine 156 ($3aaa) tests dos Open and answers -1 when it fails, but
 * the ppWriteDataHeader at $3af6 is followed straight by `movea.l $2b8(a5),a6`
 * and the body write. +CompExt.s:720 does `tst.l d0 / beq.s .Errdisc` in the
 * same place. A header that did not go down leaves a file eight bytes short
 * that starts in the middle of the crunched stream.
 *
 * The -1 cannot be read in any case. `Pp Write` has no function form, the
 * token table giving instr $9c and func $ffff, so the d2 and d3 the routine
 * sets at $3b1e and $3b24 are dead. Pp5 offers no output value.
 *
 * ## What this port does instead
 *
 * The codec is ../amiga/powerpacker.ts, a from-the-format reimplementation
 * checked three ways, one of them Teemu Suutari's `ancient` reading what it
 * writes. powerpacker.library is therefore never absent here and neither
 * undefined-return path above can be reached.
 *
 * NOTE: EFF and LARG are accepted and change nothing. EFF 0 to 4 becomes the
 * four-byte offset-width table a PP20 file carries at byte 4, and LARG is
 * ppAllocCrunchInfo's D1, the match-search buffer size. Both mappings live
 * inside powerpacker.library, a separate file this binary only calls, so there
 * is nothing here to read them out of. This port crunches at [9,10,12,13], the
 * table every PP20 file in the corpus carries.
 *
 * DEVIATION: because of that, `Pp Write` writes [9,10,12,13] whatever EFF it
 * was given. On the machine a mismatch matters, which is why Pp5 says "EFF=
 * Reporter l'efficacité de 'Pp Crunch'." The header describes the body, and
 * the wrong number in it makes a file no decruncher can read. Here the two
 * always agree.
 *
 * DEVIATION: ppLoadData's crypted answers, PP_CRYPTED and PP_PASSERR, are
 * never returned. The codec does not implement PowerPacker's encrypted files,
 * so an encrypted one takes the same path as any other non-PP20 file and loads
 * verbatim, which is what Pp1 promises for uncrunched data: "Si un fichier
 * n'est pas compacté, il sera tout de même chargé en mémoire."
 *
 * Documented against `IntuiExtend_2.0.Guide`'s PowerPacker.guide, @Author
 * CIERP Philippe, nodes Pp0 to Pp5. The error numbers are
 * `includes/pp/ppbase.i`:38-43, which is Nico François' own file and agrees
 * with the six the guide lists.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, int, str, type Value } from '../interp/values'
import { DEFAULT_EFFICIENCY, pp20Crunch, pp20Decrunch } from '../amiga/powerpacker'
import { ieMem } from './intuiextendwin'
import type { IntuiextendState } from './intuiextend'

/** `ppbase.i`:38-43, and Pp1's list of six in the same order */
export const IE_PP_ERR = {
  OPENERR: -1,
  READERR: -2,
  NOMEMORY: -3,
  CRYPTED: -4,
  PASSERR: -5,
  UNKNOWNPP: -6,
} as const

/** "PP20" and four efficiency bytes, which +CompExt.s:4007 calls pp.Header */
export const IE_PP_HEADER = 8

/** the four bytes ppWriteDataHeader puts in front of everything */
const PP20_ID = [0x50, 0x50, 0x32, 0x30] as const

/** a block ppLoadData would decrunch rather than copy */
function isPp20(b: Uint8Array): boolean {
  return b.length >= 4 && PP20_ID.every((c, i) => b[i] === c)
}

export interface IePpState {
  /** workspace+$50, ppLoadData's buffer and the answer `Pp Start` gives */
  start: number
  /** workspace+$54, its length and the answer `Pp Len` gives */
  length: number
}

export function newIePpState(): IePpState {
  return { start: 0, length: 0 }
}

export function makeIntuiextendPpInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IePpState => rt.intuiextend.pp
  const ext = (): IntuiextendState => rt.intuiextend

  return {
    /**
     * Pp Free, routine 147 ($39c4), which is two pushes and a branch.
     *
     *     $39c4  movea.l  $258(a5),a2
     *     $39c8  adda.w   #$50,a2
     *     $39cc  move.l   (a2),-(a3)      ; START
     *     $39ce  move.l   #$0,(a2)
     *     $39d4  move.l   $4(a2),-(a3)    ; LEN
     *     $39d8  move.l   #$0,$4(a2)
     *     $39e0  Rbra     routine 5 (free mem)
     *
     * The pushes are pre-decrements and `Free Mem` pops with `(a3)+`, so LEN
     * comes off first and START second, which is `Free Mem START,LEN` in
     * source order. Pp2: "Libère la mémoire occupée par le fichier
     * décompacté."
     *
     * Both longs are cleared before the branch, and a second `Pp Decrunch`
     * with no `Pp Free` between them is worse than a leak: routine 130 clears
     * the same pair at $3832 and $3840 on its way in, so the address of the
     * old buffer is gone before ppLoadData is even called.
     */
    'pp free'() {
      const s = st()
      const start = s.start
      s.start = 0
      s.length = 0
      if (start !== 0) ext().heap.freeMem(start >>> 0)
    },

    /**
     * Pp Write NAME$,START To LENGTH,EFF, routine 156 ($3aaa).
     *
     *     $3ac0  move.l   (a3)+,d7      ; EFF, the last argument pushed
     *     $3ac2  move.l   (a3)+,d6      ; LENGTH
     *     $3ac4  move.l   (a3)+,d5      ; START
     *     $3ac6  movea.l  (a3)+,a2      ; NAME$
     *     $3ac8  move.w   (a2)+,d1      ; the length word, and dead
     *     $3aca  move.l   a2,d1
     *     $3acc  move.l   #$3ee,d2      ; MODE_NEWFILE, 1006
     *     $3ad2  jsr      -$1e(a6)      ; dos Open
     *
     * `move.w (a2)+,d1` exists only for its side effect on a2, d1 being
     * overwritten on the next instruction. dos Open, Write and Close are -$1e,
     * -$30 and -$24 in `dos_lib.fd`, whose bias is 30.
     *
     * The file is the eight-byte header ppWriteDataHeader lays down followed
     * by LENGTH bytes copied straight out of START, so `Pp Crunch` writing
     * back over its own buffer and `Pp Write` reading that buffer are two
     * halves of one operation. Pp5 is explicit that the caller keeps them in
     * step: "LENGTH=Taille du fichier compacté."
     */
    'pp write'(it) {
      const path = it.evalStr()
      it.expect(',')
      const start = it.evalInt() >>> 0
      it.expect('to')
      const length = it.evalInt() | 0
      it.expect(',')
      // EFF, which reaches ppWriteDataHeader as D1 and picks the header table
      it.evalInt()
      const n = Math.max(0, length)
      const m = ieMem(rt)
      const out = new Uint8Array(IE_PP_HEADER + n)
      out.set(PP20_ID, 0)
      for (let i = 0; i < 4; i++) out[4 + i] = DEFAULT_EFFICIENCY[i]!
      for (let i = 0; i < n; i++) out[IE_PP_HEADER + i] = m.byte((start + i) >>> 0)
      rt.vfs?.writeFile(path, out)
    },
  }
}

export function makeIntuiextendPpFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IePpState => rt.intuiextend.pp
  const ext = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => (a[n] === undefined ? '' : str(a[n]))

  return {
    /**
     * =Pp Decrunch(FILENAME$,COL,CRYPTED), routine 130 ($380a).
     *
     *     $381e  move.l   (a3)+,d7      ; CRYPTED
     *     $3820  move.l   (a3)+,d0      ; COL
     *     $3822  movea.l  (a3)+,a0      ; FILENAME$
     *     $3824  adda.w   #$2,a0        ; past the AMOS length word
     *     $3828  moveq    #$1,d1        ; MEMF_PUBLIC, and not an argument
     *     $382a  movea.l  $258(a5),a1   ; +$50, cleared
     *     $3838  movea.l  $258(a5),a2   ; +$54, cleared
     *     $3848  movea.l  d7,a3         ; the passkey
     *     $384a  jsr      -$1e(a6)      ; ppLoadData
     *
     * a3 is the argument stack, so the routine saves it at $3846 and puts it
     * back at $3850 around the one call that wants the register.
     *
     * COL is ppbase.i's DECR_COL0 to DECR_NONE, 0 to 4, and it picks what the
     * library flashes while it works: colour 0, colour 1, the mouse pointer, a
     * screen shake, or nothing. Nothing is drawn on this side, and the
     * decrunch is not interruptible here anyway.
     *
     * CRYPTED reaches ppLoadData as A3, which +CompExt.s:454 passes as
     * `move.l #-1,a3`. Pp1 calls it a flag; it is the passkey.
     */
    'pp decrunch': (_, a) => {
      const path = s0(a, 0)
      // COL, the flash effect, and CRYPTED, the passkey
      i0(a, 1)
      i0(a, 2)
      const s = st()
      // routine 130 clears both before it calls, so a failure leaves zeroes
      s.start = 0
      s.length = 0
      const raw = rt.vfs?.readFile(path) ?? null
      if (raw === null) return VI(IE_PP_ERR.OPENERR)
      let bytes = raw
      if (isPp20(raw)) {
        try {
          bytes = pp20Decrunch(raw)
        } catch {
          return VI(IE_PP_ERR.UNKNOWNPP)
        }
      }
      const block = ext().heap.alloc(bytes.length, { clear: true })
      if (block === 0) return VI(IE_PP_ERR.NOMEMORY)
      const m = ieMem(rt)
      for (let i = 0; i < bytes.length; i++) m.setByte((block + i) >>> 0, bytes[i]!)
      s.start = block >>> 0
      s.length = bytes.length
      return VI(0)
    },

    /** =Pp Len, routine 131 ($3858): the long at workspace+$54 */
    'pp len': () => VI(st().length | 0),

    /** =Pp Start, routine 141 ($393e): the long at workspace+$50 */
    'pp start': () => VI(st().start | 0),

    /**
     * =Pp Crunch(START,LENGTH,LARG,EFF), routine 155 ($3a70).
     *
     * ppCrunchBuffer works in place. It is given one buffer and a length and
     * it leaves the crunched stream where the plaintext was, which is why
     * +CompExt.s writes the file out of the buffer it crunched (:724-727) and
     * why Pp5's START is the same address that went into `Pp Crunch`.
     *
     * The answer excludes the eight header bytes. +CompExt.s:4007 adds them
     * back by hand, `addq.l #8,d2 ;pp.Len + 8 (pp.Header)`, before reserving
     * the bank that will hold both.
     *
     * Pp0 gives three answers and two of them survive the port. -1 is
     * "Overflow, la taille compactée du fichier est supérieure au fichier lui-
     * même", the case a cruncher can do nothing with. 0 is "Le compactage a
     * été stoppé pour une raison quelquonque", the abort: ppAllocCrunchInfo's
     * A0 is the Control-C callback that raises it, and $3a88 clears A0, so no
     * program can ever stop this one. What is left of the zero is out of
     * memory, which here is a block longer than the 24-bit length the PP20
     * trailer can hold.
     */
    'pp crunch': (_, a) => {
      const start = i0(a, 0) >>> 0
      const length = i0(a, 1)
      // LARG, ppAllocCrunchInfo's D1, and EFF, its D0
      i0(a, 2)
      i0(a, 3)
      if (start === 0 || length <= 0) return VI(0)
      const m = ieMem(rt)
      const src = new Uint8Array(length)
      for (let i = 0; i < length; i++) src[i] = m.byte((start + i) >>> 0)
      let file: Uint8Array
      try {
        file = pp20Crunch(src)
      } catch {
        return VI(0)
      }
      const body = file.subarray(IE_PP_HEADER)
      if (body.length > length) return VI(-1)
      for (let i = 0; i < body.length; i++) m.setByte((start + i) >>> 0, body[i]!)
      return VI(body.length)
    },
  }
}
