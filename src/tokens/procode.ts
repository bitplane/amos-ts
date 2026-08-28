/**
 * ProCode — "Codage / Decodage procedure LOCKEE" (+Verif.s:5167), the cipher
 * that hides a LOCKED procedure's body.
 *
 * Locking is an AMOS 1.x feature: `Bset 14,P` on the Procedure line's flags
 * word marks the procedure closed for good, and the body's token content is
 * enciphered so that the editor cannot list it. AMOS Professional still reads
 * those programs, and the verifier deciphers each one in place, once, before
 * the program runs (+Verif.s:1553):
 *
 *     btst	#6,8(a6)		Decoder la procedure?
 *     beq.s	.Skip0
 *     btst	#5,8(a6)
 *     beq.s	.Skip0
 *     bsr	ProCode
 *
 * so a locked procedure is a listing restriction, never a runtime one. The
 * same routine is in the compiler three times over (+comp.s:4838,
 * +CLib.s:5357, +APComp.s:7113), all identical.
 *
 * ## The flags word, which this settles
 *
 * The word at offset 10 of the Procedure line, tested on its high byte:
 *
 *   bit 15  folded in the editor        `bchg #7,10(a2)`   +Edit.s:8862
 *   bit 14  locked / cannot be opened   `btst #6,10(a2)`   +Edit.s:8846
 *   bit 13  body is CURRENTLY enciphered — `bchg #5,8(a6)` below
 *   bit 12  machine language            +Edit.s:8759
 *
 * ProCode returns at once on bit 12, which is why an AMOS Pro machine-code
 * procedure is never run through it: its body is a 68k image, not tokens.
 *
 * The low byte of the same word is the key material. AMOS's own locker
 * (`Lock.AMOS` on APD076, by Francois Lionet) writes it as
 *
 *     P=(P and %1111111100000000)+Rnd(254)+1
 *
 * — a fresh random 1..255 per procedure, which is why two procedures in one
 * program decipher with different keys.
 *
 * ## The cipher
 *
 * A running 16-bit key eor'd word by word. Only CONTENT is enciphered: each
 * line's length/indent word and its FIRST content word are stepped over in
 * clear, which is why the line lengths still walk a locked body correctly and
 * why lines that begin with the same token look identical in the ciphertext.
 * The key state is not reset per line — it runs on from one line to the next.
 *
 * The walk ends one line PAST the End Proc line, so End Proc's own EOL word is
 * enciphered along with the body while its length, indent and End Proc token
 * stay in clear.
 *
 * Symmetric, so this one routine both locks and unlocks.
 */

const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!
const u32 = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
const rol32 = (v: number, n: number): number => ((v << n) | (v >>> (32 - n))) >>> 0
const ror32 = (v: number, n: number): number => ((v >>> n) | (v << (32 - n))) >>> 0

/**
 * Run the cipher over the procedure whose line starts at `line`, in place.
 *
 * Returns false if the walk would leave the buffer, which a wrong key or a
 * truncated file can cause; the caller is expected to have kept the original
 * bytes, because a false return can still have written some.
 */
export function procode(src: Uint8Array, line: number): boolean {
  // a6 --> the Procedure token, which is where V1_Procedure leaves it
  const a6 = line + 2
  if (a6 < 2 || a6 + 12 > src.length) return false

  const size = u32(src, a6 + 2)
  // lea 10+2+4(a6,d0.l),a2 — one line past End Proc, met at the check below
  const stop = a6 + size + 16

  //	move.l	2(a6),d5
  //	rol.l	#8,d5
  //	move.b	9(a6),d5		the flags word's low byte
  let d5 = ((rol32(size, 8) & 0xffffff00) | src[a6 + 9]!) >>> 0
  let d4 = 1
  const d3 = u16(src, a6 + 6)

  // a1 --> the line after the Procedure line, i.e. the start of the body
  let a1 = a6 - 2 + ((u16(src, a6 - 2) >> 8) << 1)

  for (;;) {
    // PrCo2: step over the length/indent word and the first content word.
    //
    // The walk reads the length of the line AFTER End Proc, and a procedure
    // that ends the program has no such line: the source block a .AMOS file
    // stores stops at the last line, where the editor's buffer had a
    // terminating zero word. Reading a zero there is what that word would
    // have held, and the stop below is then met exactly.
    let a0 = a1
    const lenWords = a0 + 2 <= src.length ? src[a0]! : 0
    a1 = a0 + lenWords * 2
    a0 += 4
    if (a0 === stop) return true
    if (a0 > stop || lenWords < 2 || a1 > src.length) return false

    // PrCo1: eor the rest of the line, one word at a time.
    //
    // The 68k tests at the BOTTOM of this loop, so a two-word line — length
    // word and EOL, nothing else — would run it away past the end of the
    // line. No line in any locked procedure in the archive is that short, and
    // an infinite loop is not a behaviour worth reproducing, so the test is
    // at the top here and such a line enciphers nothing.
    while (a0 !== a1) {
      const v = (u16(src, a0) ^ d5) & 0xffff
      src[a0] = v >> 8
      src[a0 + 1] = v & 0xff
      a0 += 2
      d5 = ((d5 & 0xffff0000) | ((d5 + d4) & 0xffff)) >>> 0 // add.w d4,d5
      d4 = (d4 + d3) & 0xffff
      d5 = ror32(d5, 1)
    }
  }
}
