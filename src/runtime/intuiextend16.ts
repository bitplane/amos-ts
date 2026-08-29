/**
 * IntuiExtend 1.6, and what it does not share with 2.01b.
 *
 * The same author, the same slot and very nearly the same library: 398
 * routines in 22,508 bytes against 2.01b's 400 in 23,084. 294 of the 1.6
 * table's entries carry a name and 284 of those names are in 2.01b's table
 * too, so this file is not a second port. It is the difference.
 *
 * ## How the difference was measured
 *
 * Both code hunks come out of `../amiga/hunk.ts`'s `firstCodeHunk` and both
 * jump tables out of `../ext/routines.ts`'s `routineAddresses`. For each of
 * the 284 shared names, the routine its own table points at was disassembled
 * in both builds and compared instruction by instruction, with branch targets
 * rewritten to the index of the instruction they land on so that a routine
 * shifted by a byte does not read as a rewrite.
 *
 * 233 of the 284 come out the same. 213 of those are identical byte for byte;
 * the other 20 differ only in encoding, and every one of those is one of four
 * things: `$4.w` against `$4.l` for ExecBase, a bit number capstone prints
 * unreduced (`bclr.b #$9` and `bclr.b #$1` are the same bit of a byte), a long
 * read as two words, or the workspace moving. 1.6's workspace is at $1cb4 and
 * 2.01b's at $1d28, and 2.01b inserted $1e bytes near its front, so
 * `adda.w #$5c8,a0` and `adda.w #$5aa,a0` reach the same field.
 *
 * That leaves 51 routines that really did change, and ten names 2.01b does
 * not have at all.
 *
 * ## The ten
 *
 * Six are spellings the author fixed. `shearch` became `search`,
 * `wb turtleplot` gained its space, `wb set pubscreen modes` lost its s,
 * `wb pubscreen status` became `wb pubscreen statut`, `wb remove all gedget`
 * became `wb remove all gadget`, and `wb get menu adr` is the entry 2.01b's
 * token table corrupted. All six point at the same routine number in both
 * builds and every one of those routines is byte-for-byte identical, so they
 * are bound here as names and nothing else.
 *
 * The other four are keywords 2.01b dropped: `Wb Scroll`, `Iff Make Palette`,
 * `Wb Menu Text` and `Wb 3d Sort`. Only the first is a keyword in good
 * standing. `Iff Make Palette` passes a colour count where the library wants
 * a write address, `Wb Menu Text` is a name pointing at another keyword's
 * routine, and `Wb 3d Sort` is six bytes that pop two arguments and return.
 *
 * ## The object format changed
 *
 * A 3D object in 2.01b opens with the four characters `IE3D`. A 1.6 one does
 * not, and that one difference runs through all eight object keywords:
 *
 *     1.6            2.01b
 *     +$0  points    +$0  'IE3D'
 *     +$2  point 0   +$4  points
 *                    +$6  point 1
 *
 * so 1.6 counts its points from ZERO and 2.01b from one, and the shapes sit
 * four bytes further on in 2.01b than the arithmetic alone would put them.
 * `Wb 3d Make Object` allocates `12p + 8s + 4` here against 2.01b's
 * `12p + 8s + 8`.
 *
 * The two `To` arguments swapped as well, and the token table did not: the
 * spec of `Wb 3d Edge` is `I0,0,0t0,0` in both builds, so `Wb 3d Edge X,Y,Z
 * To A,B` compiles either way and means `A=OBJECT, B=NB` in 1.6 and
 * `A=NB, B=OBJECT` in 2.01b. Same for `Wb 3d Shape` and `Wb 3d Move Edge`.
 * There is no version check anywhere and no stamp in a 1.6 object to fail
 * one, so a program moved between the builds writes its points into its
 * polygon table without a word of complaint.
 *
 * Two of the eight are the same code reading different data. `Wb 3d Move
 * Object` is byte-identical in both builds, and correct here: `move.w (a0)+`
 * at $4f0e reads 1.6's point count where in 2.01b it reads the high word of
 * the magic and walks 18,757 points off the end. `Wb 3d Erase Object`
 * recomputes the size it frees from the counts, and finds them at +$0 and
 * +$2+12p rather than +$4 and +$6+12p.
 *
 * And `Wb 3d Clear Object` is a keyword in 1.6 and an alias in 2.01b. Routine
 * 293 ($558e) writes `12p + 8s` bytes of zero over the object's body; 2.01b
 * deleted it and pointed the name at routine 292, which FREES the object. A
 * program that clears an object every frame leaks nothing in 1.6 and frees
 * the same block over and over in 2.01b.
 *
 * ## The 51, and why most of them are not here
 *
 * A routine can change without this port being able to tell. Fifteen of the
 * 51 differ only in which AMOS helper allocates the answer string, which
 * register holds ExecBase, or where in the workspace a field sits, and this
 * port has neither a workspace nor an argument stack to notice. Two more,
 * `Wb Icon Image` and `Wb Bob Image`, replace 1.6's own bank walk at routine
 * 280 --- `$5ea(a5)`, then `$10(a0)` against the four characters `Icon`, then
 * `adda.l #$18` --- with a direct call to AMOS's `L_Bnk_GetIcons`, which
 * finds the same bank.
 *
 * Four more are worth stating even though nothing here can show them.
 *
 * `Sys Cpu` tests three AttnFlags bits in 1.6 that 2.01b deleted, and answers
 * the coprocessor in preference to the processor: bit 6 gives 41, bit 5 gives
 * 82 and bit 4 gives 81, ahead of the 40/30/20/10 both builds share. The
 * modelled machine has no FPU --- ./intuiextendsys.ts's `IE_SYS_CPU` is 20
 * for the reason given there --- so all three miss and both builds answer 20.
 *
 * `Wb Spline` reaches graphics Draw at -$f6 with the coordinates as it found
 * them; 2.01b masks each with `andi.l #$ffff` first. Draw takes x and y as
 * words, so the mask changes the register and not the pixel.
 *
 * `Wb Td Open` reloads the workspace pointer into a0 after the OpenDevice at
 * $3c96. 2.01b puts those same two instructions into a1, then dereferences
 * the a0 that OpenDevice left behind and overwrites a1 on the next line. The
 * defect is 2.01b's, and it is in a register this port does not have.
 *
 * `Wb Get Deficon` clears do_ToolTypes at $34 of the DiskObject it just got,
 * two instructions 2.01b deleted, and does it without testing that
 * GetDefDiskObject answered anything. icon.library is not in
 * ../amiga/exec.ts's map, so neither build gets that far.
 *
 * Two leave nothing to model at all. `Wb Slide Swap Look` is
 * `movea.l (a3),a0` in 1.6 and `movea.l (a3)+,a0` in 2.01b, so 1.6 never pops
 * its argument and leaves four bytes of AMOS's argument stack behind; the
 * five `Wb Free *` keywords reach FreeMem with no test that the pointer is
 * non-zero. Arguments here are evaluated by the interpreter rather than
 * pushed, and ../amiga/exec.ts's pool ignores a free of address zero.
 *
 * What is left is in this file.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, type Value } from '../interp/values'
import type { IntuiextendState } from './intuiextend'
import { ieMem } from './intuiextendwin'
import { ieIffDecodePicture, ieIffGetColorTable } from './intuiextendiff'
import { ieRastPortAt } from './intuiextendgfx'
import { scrollRaster } from '../amiga/graphics'
import { NO_BATTCLOCK } from '../amiga/battclock'

/** the registry identity this file answers for */
export const IE16_ID = 'intuiextend-1.6'

/**
 * The keyword that tells the two tables apart.
 *
 * The author's own misspelling of `Search`, which he fixed for 2.01b. Nine of
 * the ten names 1.6 has and 2.01b does not are unique across all 88 tables in
 * the registry, and this is the one no other extension could plausibly grow:
 * the tenth, `Wb Scroll`, is also in D.J.Software's Int 1.0 and would read as
 * 1.6 for a program that had both loaded.
 *
 * It has to be a name and not a routine number. The two builds share most of
 * their jump table, and where they do not, 1.6's routine 53 is `Wb Scroll`
 * and 2.01b's is `Get Msg Scancode`.
 */
const IE16_MARKER = 'shearch'

/**
 * Which build filled the slot.
 *
 * An explicit binding says so outright. Without one the answer is in the
 * token table the program was tokenised against, because a program that can
 * name `Shearch` at all was tokenised against 1.6's. Resolved on the first
 * call rather than at init: ./runtime.ts runs every port's `init` before
 * `interp` exists.
 */
export function ieIs16(rt: Runtime): boolean {
  const st = rt.intuiextend
  if (st.is16 !== null) return st.is16
  let found = false
  for (const ext of rt.extBindings?.values() ?? []) if (ext.id === IE16_ID) found = true
  if (!found) {
    for (const t of rt.interp?.names?.extensions?.values() ?? []) {
      if (t.entries.some((e) => e.name === IE16_MARKER)) {
        found = true
        break
      }
    }
  }
  st.is16 = found
  return found
}

/**
 * =Pal Negativ(COLOUR) in 1.6 --- routine 71 ($3096), five instructions.
 *
 *     $3096  move.w   #$fff,d3
 *     $309a  sub.w    (a3)+,d3
 *     $309c  addq.w   #$2,a3
 *
 * DEFECT: `sub.w (a3)+` takes the HIGH word. AMOS pushes an integer as a long
 * with `-(a3)`, so a3 points at its most significant byte, and the
 * `addq.w #$2,a3` on the next line is the author stepping over the half he
 * wanted. Every colour a program has is under $1000, so the high word is zero
 * and `Pal Negativ` answers 4095 for black, for white and for everything
 * between.
 *
 * The two builds are broken differently in the same four lines. 2.01b never
 * loads the argument into d3 at all and complements the wrong way round; see
 * `iePalNegativ` in ./intuiextendsys.ts. This one loads the wrong half of it.
 */
export function iePalNegativ16(c: number): number {
  return (0xfff - ((c >>> 16) & 0xffff)) & 0xffff
}

/**
 * The decimal divisors at workspace+$198, which 1.6 reads and 2.01b misses.
 *
 * Ten longs, shipped in the code hunk at $1e4c, one per power of ten from a
 * milliard down to ten and then a zero to stop on:
 *
 *     3b9aca00 05f5e100 00989680 000f4240
 *     000186a0 00002710 000003e8 00000064
 *     0000000a 00000000
 *
 * 2.01b's `Wb Swatch` points its conversion at workspace+$1c6 instead, 46
 * bytes further on and inside the buffer the routine writes its answer into.
 * That is the defect ./intuiextendsys.ts records. 1.6 points at the list, so
 * here the loop is live.
 */
export const IE16_DIVISORS = [
  1_000_000_000, 100_000_000, 10_000_000, 1_000_000, 100_000, 10_000, 1_000, 100, 10,
] as const

/**
 * One battery-clock nibble, through the conversion at $3f14, which reaches the list with `adda.w #$198,a1` at $3f26.
 *
 * `andi.w #$f,d0` caps the value at fifteen and then the divisor loop runs.
 * Nine and below clear every divisor in one step and fall through to
 * `neg.b d0 / addi.b #$30,d0`, a single character. Ten to fifteen do not: the
 * last divisor is ten, the loop subtracts it once, and the routine emits a
 * '1' and then the remainder. Two characters where the caller left room for
 * one.
 *
 * 2.01b cannot reach that. Its list is the ASCII of an old result and every
 * long in it is larger than fifteen, so the loop always falls through and a
 * nibble of fifteen leaves as '?'. Same six registers, same conversion, two
 * different answers.
 */
export function ie16Digits(nibble: number): string {
  let rest = nibble & 0xf
  let out = ''
  for (const d of IE16_DIVISORS) {
    if (d > rest) continue
    const n = Math.trunc(rest / d)
    out += String.fromCharCode(0x30 + n)
    rest -= n * d
  }
  return out + String.fromCharCode(0x30 + rest)
}

/**
 * =Wb Swatch in 1.6 --- routine 180 ($3eaa), 188 bytes.
 *
 * The six time registers are converted into a scratch area at workspace+$1c0
 * and then moved into the answer at workspace+$1c6, one byte at a time:
 *
 *     $3eec  move.b  $5(a0),$2(a1)
 *     $3ef2  move.b  $4(a0),$3(a1)
 *     $3ef8  move.b  $3(a0),$5(a1)
 *     $3efe  move.b  $2(a0),$6(a1)
 *
 * The two colons and the length word are never written. They are shipped:
 * $1e7a holds `00 08 00 00 3a 00 00 3a 00 00`, a length of eight with a ':'
 * at +4 and +7 and the digit slots left as NULs. 2.01b writes the whole
 * string itself, `move.w #$8,(a1)+` and then eight `move.b`s, which is why
 * its copy of that buffer carries "00:00:1978" and this one does not.
 *
 * The scratch and the answer are six bytes apart, which is exactly one
 * character per register. A nibble above nine converts to two characters and
 * the sixth one then runs off the end of the scratch into the length word of
 * the string being built.
 */
export function ieSwatch16(regs: readonly number[]): string {
  // the scratch at +$1c0 and the answer six bytes on at +$1c6, as one run
  const buf = new Uint8Array(16)
  const ANS = 6
  buf[ANS + 1] = 8
  buf[ANS + 4] = 0x3a
  buf[ANS + 7] = 0x3a
  let at = 0
  // S1 comes off the chip first, so the registers convert in the order they lie
  for (let i = 0; i < 6; i++) {
    for (const ch of ie16Digits(regs[i] ?? 0)) buf[at++] = ch.charCodeAt(0)
  }
  // $5(a0) to $2(a1) and so on down: the scratch is read back to front
  for (const [from, to] of [
    [5, 2],
    [4, 3],
    [3, 5],
    [2, 6],
    [1, 8],
    [0, 9],
  ] as const) {
    buf[ANS + to] = buf[from] ?? 0
  }
  const len = ((buf[ANS] ?? 0) << 8) | (buf[ANS + 1] ?? 0)
  let out = ''
  for (let i = 0; i < len; i++) out += String.fromCharCode(buf[ANS + 2 + i] ?? 0)
  return out
}

/** a word, sign-extended, which is how every index in the 3D group is built */
const w = (v: number): number => (v << 16) >> 16

/**
 * Where point `nb` of a 1.6 object begins.
 *
 * `mulu.w #$3 / asl.w #$2 / addq.w #$2` at $55b8, so twelve bytes a point
 * after the single count word. Zero-based: there is no `subq.w #$1` in 1.6,
 * where 2.01b's `Wb 3d Edge` has one at $5600.
 */
export function ie16PointAt(obj: number, nb: number): number {
  return (obj + 2 + w(w(nb * 3) * 4)) >>> 0
}

/**
 * Where shape `nb` begins, given the object's point count.
 *
 * `Wb 3d Shape` steps a0 past the count word first and then adds
 * `12 * points + 8 * nb + 2`, the last two bytes being the shape count.
 */
export function ie16ShapeAt(obj: number, points: number, nb: number): number {
  return (obj + 2 + w(w(points * 3) * 4) + 2 + w(nb * 8)) >>> 0
}

export function makeIntuiextend16Instructions(
  rt: Runtime,
  base: Readonly<Record<string, Instr>>,
): Record<string, Instr> {
  /** run the 1.6 body only when 1.6 is the build in the slot */
  const only16 =
    (name: string, body: Instr): Instr =>
    (it, tok, addr) =>
      ieIs16(rt) ? body(it, tok, addr) : base[name]!(it, tok, addr)

  return {
    /* two of the six the author respelled; the routine behind each is the same */
    'wb turtleplot': base['wb turtle plot']!,
    'wb remove all gedget': base['wb remove all gadget']!,

    /**
     * Iff Display BUFFER To BITMAP in 1.6 --- routine 296 ($55f2), 32 bytes.
     *
     * One library call where 2.01b makes two. 1.6 pops both arguments and
     * goes straight to DecodePic at -$3c; the GetColorTable at -$36 that
     * 2.01b does first is its own keyword here, `Iff Make Palette`, so the
     * 1.6 form takes two arguments and never touches a colour table.
     *
     * `movea.l (a3)+,a0` takes the last argument and `movea.l (a3)+,a1` the
     * first, and DecodePic is (a0=bitmap, a1=buffer), so the buffer is what
     * the statement decodes and the bitmap is what it decodes To.
     */
    'iff display': only16('iff display', (it) => {
      const buf = it.evalInt() >>> 0
      it.expect('to')
      const bitmap = it.evalInt() >>> 0
      ieIffDecodePicture(rt, bitmap, buf)
    }),

    /**
     * Wb Scroll RPORT To X,Y,W,H,XSTEP,YSTEP --- routine 53 ($2e92), twelve
     * instructions and one library call.
     *
     * Six `move.l (a3)+` then `movea.l (a3),a1`, and the registers land where
     * `graphics_lib.fd`'s 62nd entry wants them:
     * `ScrollRaster(rp,dx,dy,xMin,yMin,xMax,yMax)(a1,d0/d1/d2/d3/d4/d5)` at
     * bias 30, which is -$18c. So the guide's W and H are the vector's xMax
     * and yMax, not a width and a height: Gfxj calls them "longueur (Width)
     * et Largeur (Height)" and the archive's own `examples/ScrollWind.asc`
     * writes `Wb Scroll A To 50,100,150,550,0,100`, a region from 50,100 to
     * 150,550 moved down a hundred pixels.
     *
     * DEFECT: `movea.l (a3),a1` at $2ea4 does not pop. Six of the seven
     * arguments come off the stack and the RastPort stays on it, four bytes
     * AMOS never gets back. Nothing here has an argument stack for that to
     * show on. `Wb Slide Swap Look` is the author's other one.
     */
    'wb scroll': (it) => {
      const rpAddr = it.evalInt() >>> 0
      it.expect('to')
      const xMin = it.evalInt() | 0
      it.expect(',')
      const yMin = it.evalInt() | 0
      it.expect(',')
      const xMax = it.evalInt() | 0
      it.expect(',')
      const yMax = it.evalInt() | 0
      it.expect(',')
      const dx = it.evalInt() | 0
      it.expect(',')
      const dy = it.evalInt() | 0
      const rp = ieRastPortAt(rt, rpAddr)
      if (!rp) return
      scrollRaster(rp, dx, dy, xMin, yMin, xMax, yMax)
    },

    /**
     * Wb Menu Text A,B,C,TEXT$,D --- routine 306 ($5704).
     *
     * DEFECT: the name is on somebody else's routine. 1.6's table has two
     * entries pointing at 306 and the other one is `Iff Get Error`, whose
     * thirteen instructions this is: open iff.library, call -$4e, put the
     * answer in d3. There is no menu and no text anywhere in it.
     *
     * The table calls it an instruction with five arguments and the routine
     * pops none, so on the machine every call leaves twenty bytes on AMOS's
     * argument stack. The one thing it does do is reach GetError, and
     * `$812 move.l $12(a0),d0 / $816 clr.l $12(a0)` means reading the error
     * CLEARS it. So `Wb Menu Text` throws away a pending IFF error and
     * discards the answer, because an instruction has nowhere to put one.
     *
     * The 1.4 guide has no node for it and neither has any other. 2.01b
     * dropped the name.
     */
    'wb menu text': (it) => {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect(',')
      it.evalStr()
      it.expect(',')
      it.evalInt()
      rt.intuiextend.iff.error = 0
    },

    /**
     * Wb 3d Sort A To B --- routine 279 ($50d2), six bytes.
     *
     *     $50d2  movea.l  (a3)+,a0
     *     $50d4  move.l   (a3)+,d7
     *     $50d6  rts
     *
     * Both arguments popped, neither used, nothing written. The author never
     * wrote the body, and his own `examples/3dSort.asc` is the proof: the
     * file named after this keyword does not call it, it averages the Z of
     * each face by hand and draws the far one first. 2.01b dropped the name.
     */
    'wb 3d sort': (it) => {
      it.evalInt()
      it.expect('to')
      it.evalInt()
    },

    /**
     * Wb 3d Edge X,Y,Z To OBJECT,NB in 1.6 --- routine 294 ($55b4).
     *
     * The two `To` arguments are the other way round from 2.01b's and the
     * count is zero-based. No `IE3D` test either: 2.01b's `cmp.l #$49453344`
     * at $55f0 has no counterpart here, so any address at all is written to.
     */
    'wb 3d edge': only16('wb 3d edge', (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const z = it.evalInt()
      it.expect('to')
      const obj = it.evalInt() >>> 0
      it.expect(',')
      const nb = it.evalInt()
      const m = ieMem(rt)
      const at = ie16PointAt(obj, nb)
      m.setLong(at, x)
      m.setLong((at + 4) >>> 0, y)
      m.setLong((at + 8) >>> 0, z)
    }),

    /**
     * Wb 3d Shape S0,S1,S2,S3 To OBJECT,NB in 1.6 --- routine 270 ($4ed8).
     *
     * The four point numbers go in as words at +0, +2, +4 and +6 of shape NB,
     * zero-based, and the shape table starts after the point count word, the
     * points and the shape count word.
     */
    'wb 3d shape': only16('wb 3d shape', (it) => {
      const s0 = it.evalInt()
      it.expect(',')
      const s1 = it.evalInt()
      it.expect(',')
      const s2 = it.evalInt()
      it.expect(',')
      const s3 = it.evalInt()
      it.expect('to')
      const obj = it.evalInt() >>> 0
      it.expect(',')
      const nb = it.evalInt()
      const m = ieMem(rt)
      const at = ie16ShapeAt(obj, m.word(obj) & 0xffff, nb)
      m.setWord(at, s0 & 0xffff)
      m.setWord((at + 2) >>> 0, s1 & 0xffff)
      m.setWord((at + 4) >>> 0, s2 & 0xffff)
      m.setWord((at + 6) >>> 0, s3 & 0xffff)
    }),

    /**
     * Wb 3d Move Edge X,Y,Z To OBJECT,NB in 1.6 --- routine 284 ($540a).
     *
     * DEFECT: all three adds land on the same longword.
     *
     *     $541a  add.l  d5,$2(a0,d0.w)
     *     $541e  add.l  d6,$2(a0,d0.w)
     *     $5422  add.l  d7,$2(a0,d0.w)
     *
     * The point's X gets X, then Y, then Z added to it, and its Y and Z are
     * never touched. 2.01b writes $0, $4 and $8 off a base six bytes on, so
     * the keyword works there. Both builds count from zero, which in 2.01b's
     * case is its own separate defect because `Wb 3d Edge` counts from one.
     */
    'wb 3d move edge': only16('wb 3d move edge', (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const z = it.evalInt()
      it.expect('to')
      const obj = it.evalInt() >>> 0
      it.expect(',')
      const nb = it.evalInt()
      const m = ieMem(rt)
      const at = ie16PointAt(obj, nb)
      m.setLong(at, (m.long(at) + x) | 0)
      m.setLong(at, (m.long(at) + y) | 0)
      m.setLong(at, (m.long(at) + z) | 0)
    }),

    /**
     * Wb 3d Move Object X,Y,Z To OBJECT in 1.6 --- routine 271 ($4f06).
     *
     * Byte for byte the routine 2.01b ships, and here it is correct.
     * `move.w (a0)+,d0` at $4f0e reads the point count, because in 1.6 that
     * word is the point count. In 2.01b the same instruction reads the high
     * word of `IE3D`, which is 18,757, and the loop walks 225,084 bytes off
     * the end of the object. See ./intuiextend.ts.
     */
    'wb 3d move object': only16('wb 3d move object', (it) => {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const z = it.evalInt()
      it.expect('to')
      const obj = it.evalInt() >>> 0
      const m = ieMem(rt)
      const count = m.word(obj) & 0xffff
      let at = (obj + 2) >>> 0
      for (let i = 0; i < count; i++) {
        m.setLong(at, (m.long(at) + x) | 0)
        m.setLong((at + 4) >>> 0, (m.long((at + 4) >>> 0) + y) | 0)
        m.setLong((at + 8) >>> 0, (m.long((at + 8) >>> 0) + z) | 0)
        at = (at + 12) >>> 0
      }
    }),

    /**
     * Wb 3d Clear Object OBJECT in 1.6 --- routine 293 ($558e), a keyword of
     * its own and not the alias 2.01b made of the name.
     *
     * Two `dbra` loops of `move.l #$0,(a0)+`: `points * 3` longs over the
     * point table, then `shapes * 2` over the shapes. The counts are read
     * with `move.w (a0)+` as it goes, so they survive and the object stays
     * allocated and usable.
     *
     * 2.01b points this name at routine 292, which frees the block. The same
     * line of BASIC keeps the object in 1.6 and destroys it in 2.01b.
     */
    'wb 3d clear object': only16('wb 3d clear object', (it) => {
      const obj = it.evalInt() >>> 0
      const m = ieMem(rt)
      const points = m.word(obj) & 0xffff
      let at = (obj + 2) >>> 0
      for (let i = 0; i < points * 3; i++, at = (at + 4) >>> 0) m.setLong(at, 0)
      const shapes = m.word(at) & 0xffff
      at = (at + 2) >>> 0
      for (let i = 0; i < shapes * 2; i++, at = (at + 4) >>> 0) m.setLong(at, 0)
    }),
  }
}

export function makeIntuiextend16Functions(
  rt: Runtime,
  base: Readonly<Record<string, Func>>,
): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const only16 =
    (name: string, body: Func): Func =>
    (it, a) =>
      ieIs16(rt) ? body(it, a) : base[name]!(it, a)

  return {
    /* three more respellings, and the same routine behind each */
    shearch: base['search']!,
    'wb set pubscreen modes': base['wb set pubscreen mode']!,
    'wb pubscreen status': base['wb pubscreen statut']!,

    /**
     * =Wb Get Menu Adr(WINDOW) --- routine 114 ($369c), four instructions
     * reading wd_MenuStrip at window+$1c.
     *
     * This is the entry 2.01b's token table corrupted, and the ten bytes are
     * identical in both builds. In 1.6 it has its name, so a program can type
     * it: `A=Wb Get Menu Adr(W)` is the whole of the archive's own
     * `examples/GetMenuAdr.asc`. 2.01b keeps the same routine reachable under
     * `Wb Get Menu`, which this port already answers, so the two names are
     * one behaviour and this is the one the author wrote first.
     */
    'wb get menu adr': base['wb get menu']!,

    /** =Pal Negativ(COLOUR) --- routine 71, and see `iePalNegativ16` */
    'pal negativ': only16('pal negativ', (_, a) => VI(iePalNegativ16(i0(a, 0)))),

    /**
     * =Hard Mouse Key in 1.6 --- routine 63 ($2f8a), three buttons.
     *
     *     $2f8c  btst.b  #$6,$bfe001    -> bit 0    port 0 left
     *     $2f9a  btst.b  #$a,$dff016    -> bit 1    port 0 right
     *     $2faa  btst.b  #$8,$dff016    -> bit 4    port 0 middle
     *
     * Port 0 only, where 2.01b reads both ports. The POTGOR tests are the two
     * bits 2.01b uses, DATLY at 10 and DATLX at 8, reached as a byte read of
     * the high half; all three are active low and each `bne` skips its set.
     *
     * DEFECT: the middle button lands on bit 4. `bset.b #$4,d3` gives 16
     * where the third button of a three-button set wants 4, and 2.01b's
     * six-button reading puts 4 on the middle button and 16 on port 1's
     * right. A 1.6 program testing `Hard Mouse Key and 4` never sees the
     * middle button at all.
     */
    'hard mouse key': only16('hard mouse key', () => {
      const cia = rt.resolveAddr(0xbf_e001)
      const pot = rt.resolveAddr(0xdf_f016)
      const pra = cia ? (cia.data[cia.off] ?? 0xff) : 0xff
      const potw = pot ? (((pot.data[pot.off] ?? 0xff) << 8) | (pot.data[pot.off + 1] ?? 0xff)) : 0xffff
      let d3 = 0
      if ((pra & 0x40) === 0) d3 |= 1
      if ((potw & (1 << 10)) === 0) d3 |= 2
      if ((potw & (1 << 8)) === 0) d3 |= 16
      return VI(d3)
    }),

    /** =Wb Swatch --- routine 180, and see `ieSwatch16` for the two buffers */
    'wb swatch': only16('wb swatch', () => {
      const bc = rt.machine.battclock
      const regs = bc ? bc.read(rt.host.clock.now()) : NO_BATTCLOCK
      return VS(ieSwatch16([...regs].slice(0, 6)))
    }),

    /**
     * =Wb Get Msg(MSGPORT) in 1.6 --- routine 252 ($4c0c), 42 bytes.
     *
     * DEFECT: no test of the port and no default in d3. 2.01b opens
     * `moveq #$ff,d3` and skips the whole body when the port is zero; 1.6
     * goes straight to WaitPort, and on the way out does
     *
     *     $4c20  movea.l  d0,a1
     *     $4c22  move.l   $14(a1),d3
     *
     * on whatever GetMsg answered. A null message reads absolute $14, which
     * on an Amiga is the illegal-instruction vector.
     *
     * DEVIATION: the same one ./intuiextendmsg.ts records for 2.01b. Nothing
     * in this port puts a message on one of these ports, so there is nothing
     * to wait for; an empty port reads $14 through the modelled memory rather
     * than blocking, which is the read the routine makes and not the wait.
     */
    'wb get msg': only16('wb get msg', (_, a) => {
      const addr = i0(a, 0)
      const p = st().portState.ports.get(addr >>> 0)
      const msg = p && p.queue.length > 0 ? p.queue.shift()! : 0
      if (msg !== 0) st().portState.lastMsg = msg
      return VI(ieMem(rt).long((msg + 0x14) >>> 0) | 0)
    }),

    /**
     * =Wb 3d Make Object(POINTS,SHAPES) in 1.6 --- routine 291 ($552a).
     *
     * `2 + points*12 + 2 + shapes*8`, four bytes smaller than 2.01b's because
     * there is no `IE3D` to stamp. The point count goes in at +$0 and the
     * shape count at +$2 + 12*points, and MEMF_PUBLIC|MEMF_CLEAR is the same
     * `move.l #$10001,-(a3)`. -1 on a failed allocation, the sign-extended
     * `moveq #$ff,d3` at $556a.
     *
     * The multiply and the shift are the other way round from 2.01b's:
     * `mulu.w #$3` then `asl.w #$2`, so the product lands in a word before it
     * is shifted rather than after.
     */
    'wb 3d make object': only16('wb 3d make object', (_, a) => {
      const points = i0(a, 0)
      const shapes = i0(a, 1)
      // `move.w d0,d2 / mulu.w #$3,d2 / asl.w #$2,d2`, then `addq.w #$2`
      const pointBytes = w(w(points * 3) * 4)
      // `move.w d1,d5 / asl.w #$3,d5`, then `addq.w #$2`
      const shapeBytes = w(shapes * 8)
      const size = w(pointBytes + 2 + shapeBytes + 2)
      const addr = st().heap.alloc(size, { clear: true })
      if (addr === 0) return VI(-1)
      const m = ieMem(rt)
      m.setWord(addr >>> 0, points & 0xffff)
      m.setWord((addr + 2 + pointBytes) >>> 0, shapes & 0xffff)
      return VI(addr | 0)
    }),

    /**
     * =Iff Make Palette(CMAP,CNB) --- routine 295 ($55ce), the -$36 call that
     * 2.01b folded into `Iff Display`.
     *
     * DEFECT: the second argument is the write destination and the guide says
     * it is a count. GetColorTable's body opens `movea.l a0,a2` at $470 and
     * every colour goes out through `move.w d1,(a2)+` at $4a6, so a0 is where
     * the palette is written; the chunk search at $410 walks a1. The routine
     * pops a0 from the LAST argument and a1 from the first, so `CNB` reaches
     * the library as the address to fill and `CMAP` as the buffer to search.
     *
     * Iff1 has it as "CNB=Nombre de couleur de la palette
     * (CNB=Leek(CMAP-4)/3)", a count. Following that writes the colour words
     * to low memory, one for each colour and one more (see
     * `ieIffGetColorTable`'s own defect note). The node is wrong twice over:
     * its "CMAP=Adresse retourne par 'Iff Find Chunk()'" is a chunk address
     * where the library wants the whole IFF buffer, and its "PAL=Adresse de
     * la palette" is a count, the `move.l d4,d0` at $48a.
     */
    'iff make palette': (_, a) => {
      const cmap = i0(a, 0) >>> 0
      const dest = i0(a, 1) >>> 0
      return VI(ieIffGetColorTable(rt, cmap, dest) | 0)
    },
  }
}
