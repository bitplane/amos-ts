/**
 * What keywords cost, in 68000 cycles.
 *
 * The frame budget is one PAL vertical blank of cycles (`FRAME_CYCLES`) and a
 * plain statement spends `CYCLES_PER_STATEMENT` of it, both in
 * `../amiga/paula.ts` with the measurements they came from. A keyword that
 * costs more than a plain statement says so by calling `Interp.charge` with
 * the difference, and this file is where those numbers should live.
 *
 * ## The rule for adding one
 *
 * A cost is measured, derived from the routine, or absent. Never guessed.
 * Absent means the keyword charges nothing extra and is therefore modelled as
 * a plain statement, which is wrong but is wrong in a way anyone can see;
 * a number invented to make one game look right is wrong in a way nobody can.
 *
 * Express a cost as a MULTIPLE of `statementCost` rather than as a literal
 * cycle count wherever it plausibly scales with the processor, so that a
 * machine with a different clock keeps the same shape. `NEXT_EXTRA_STATEMENTS`
 * is the worked example.
 *
 * ## What is measured so far
 *
 * `Speed_Tests.AMOS` (APD563, AMOS 1.34, 640x200x2) and Philippe Cierp's
 * IntuiExtend examples, both in the corpus, between them give:
 *
 *     Next                    681 cycles   modelled, see NEXT_EXTRA_STATEMENTS
 *     Plot                   ~635          not modelled
 *     Point                 4,255          not modelled
 *     Paste Bob             4,710          not modelled
 *     Paste Icon            4,696          not modelled
 *     Put Block             4,554          not modelled
 *     Cls / Bar, full     ~27,000          not modelled; blitter-bound, and
 *                                          computable from ../amiga/blitter.ts
 *                                          rather than needing a table entry
 *
 * Only `Next` is wired up. The rest wait on the graphics pass, and on one
 * measurement this port cannot make for itself: nothing here explains how Man
 * Dog's ten `Bob` calls and a `Screen Offset` came to two frames an iteration
 * in 1994, and inventing a `Bob` cost that closes that gap is exactly what the
 * rule above forbids.
 */
import { CYCLES_PER_DISPATCH, CYCLES_PER_DISPATCH_NET } from '../amiga/paula'
import { TOKEN_CYCLES } from './cycles.gen'
import type { Tok } from '../tokens/stream'

/**
 * The old area-based blitter guess, carried over unchanged.
 *
 * `(pixels >> 4)` was a charge in STATEMENTS against a 1,612-statement frame.
 * The budget is cycles now, so multiplying by `CYCLES_PER_DISPATCH` keeps each
 * of these ops at exactly the fraction of a frame it had before: 88 is
 * 141,876/1,612, the conversion between the two budgets.
 *
 * NOT a measurement, and it does not agree with one. A full-screen `Cls` on
 * 640x200x2 was timed at about 27,000 cycles, and this formula asks about
 * 450,000 for the same area --- sixteen times too much. It is preserved
 * rather than corrected because correcting it is the graphics pass, which
 * wants the blitter model rather than a better guess: the blitter's cost is a
 * formula, and the measurement above already agrees with that formula to
 * within 15%.
 */
export function pixelGuessCycles(pixels: number): number {
  return (Math.max(0, pixels) >> 4) * CYCLES_PER_DISPATCH
}

/**
 * What one bob costs the machine per frame, in bus cycles.
 *
 * This is NOT a keyword cost. `Bob x,y,img` is a short list walk, three word
 * stores and `bset #BitBobs,T_Actualise(a5)` (BobSet, +W.s:890) --- a few
 * hundred cycles, and it draws nothing. The drawing happens in the vertical
 * blank, once a frame however many times the program moved the bob, and it
 * is the bob POPULATION rather than the `Bob` calls that costs.
 *
 * A pass is EffBob, ActBob, AffBob (+ILib.s:1017), which is three blits per
 * bob per plane:
 *
 *     restore the saved background   A -> D          2 channels
 *     save the new background        A -> D          2 channels
 *     draw the bob through its mask  A,B,C -> D      4 channels
 *
 * The blitter takes one bus cycle per active channel per word, and every one
 * of those is a cycle the 68000 does not get, so eight per word per plane.
 * `+1` word per row is the barrel shifter: a bob at an unaligned x spills
 * into one more word than its width needs.
 *
 * DEVIATION: the blitter and the CPU share the bus rather than taking turns
 * cleanly, and the CPU still gets the cycles the blitter leaves. Charging
 * every blitter cycle against BASIC is therefore the pessimistic end of the
 * range, which is why the caller caps the total (see `VBL_BUDGET_CAP`).
 */
export function bobBlitCycles(width: number, height: number, depth: number): number {
  if (width <= 0 || height <= 0 || depth <= 0) return 0
  const words = Math.ceil(width / 16) + 1
  return words * height * depth * 8
}

/**
 * The most of a frame the vertical blank may take from BASIC: 85%.
 *
 * A program whose bobs cost more than a frame still runs, because on the
 * machine it still ran --- the CPU is never starved outright, it just crawls,
 * and a hard 100% here would deadlock a program instead of slowing it down.
 * The number is a floor under the simulation rather than a measurement, and
 * it is the one figure in this file that is neither.
 */
export const VBL_BUDGET_CAP = 0.85

/**
 * The whole calibration of the timing model, and it is 1.21.
 *
 * That is the point of the number rather than an aside. Everything else in the
 * cost model is now counted off the assembler by `../cli/gencycles.ts`, and
 * uncalibrated, at 1.00, it already puts 18th Hole's power bar at 1.12 frames
 * a step against the 1.35 measured. The 21% is what is left over, and it is
 * fitted to that one row and nothing else.
 *
 * Two errors it absorbs, pulling opposite ways:
 *
 * The cycle counts assume an idle bus and an A500 has not got one. All of AMOS
 * lives in chip RAM and its inner loop is almost pure memory traffic, so
 * bitplane DMA takes slots the 68000 then waits for. That makes the machine
 * slower than the count, which is the direction 1.21 goes.
 *
 * Against it, a statement is charged over its whole token SPAN and AMOS does
 * not dispatch every token in one. `Next J` is the clear case: on the looping
 * path `InNext` does `move.l 6(a3),a6 / rts` (+ILib.s:2135) and never reads
 * the `J`, yet the span charges it a dispatch and `L_FnVar`'s 260 cycles.
 *
 * The row it is fitted to is `For A=1 To 10000: Next A` at 48 ticks, 681
 * cycles an iteration, from `Speed_Tests.AMOS`. It is the one row this port
 * has corroborated by playing the game: that loop IS 18th Hole's power-bar
 * delay, and the bar now stops where a player expects instead of blurring
 * past. The file's other three rows are not used and do not agree with it,
 * wanting 0.46, 0.58 and 0.46 of the walk's prediction. One effect does not
 * have four sizes; that is the doubt the ADDITION group was already discarded
 * for, carried one step further.
 *
 * DEVIATION: contention is not a constant. It depends on the screen, since
 * more bitplanes fetch more and a hires screen fetches twice, and it is zero
 * outside the display window. Splitting the two errors apart wants the
 * graphics pass; one number is what the evidence currently supports.
 */
export const TOKEN_COST_SCALE = 1.21

/**
 * The token ids AMOS gives the things that are not keywords.
 *
 * A variable, a label and a constant each have an entry in the library token
 * table like any keyword does, right at the front of it (+Lib.s:48-70), and
 * each has a routine: `L_FnVar` reads a variable, `L_FnCEntier` pushes an
 * integer constant. The token stream stores these by kind rather than by id,
 * so this puts the id back.
 */
const KIND_TOKEN_ID: Record<string, number> = {
  var: 0x06,
  label: 0x0c,
  procCall: 0x12,
  labelRef: 0x18,
  int: 0x1e,
  bin: 0x1e,
  hex: 0x1e,
  float: 0x46,
  str: 0x26,
}

/**
 * Cycles for one token: the ChrGet dispatch that reaches it, plus its routine.
 *
 * `first` picks the column. A token at the head of a statement runs its
 * INSTRUCTION routine and one inside an expression runs its FUNCTION routine.
 * That is the `dc.w L_InBob,L_Nul` pair in the token table, and the reason
 * every entry carries two numbers.
 *
 * An extension token is charged the dispatch and nothing else. Extensions have
 * their own libraries and their own routine numbers and none is costed yet, so
 * an extension-heavy program still runs too fast: visibly, and in one
 * direction, rather than by a number invented to hide it.
 */
export function tokenCycles(tok: Tok, first: boolean): number {
  const id = tok.kind === 'core' || tok.kind === 'op' ? tok.id : KIND_TOKEN_ID[tok.kind]
  if (id === undefined) return CYCLES_PER_DISPATCH_NET
  const c = TOKEN_CYCLES[id]
  if (!c) return CYCLES_PER_DISPATCH_NET
  const body = first ? (c.instr ?? c.func ?? 0) : (c.func ?? c.instr ?? 0)
  return CYCLES_PER_DISPATCH_NET + body
}

/** `tokenCycles` calibrated, which is what BASIC actually pays. */
export function tokenCost(tok: Tok, first: boolean): number {
  return tokenCycles(tok, first) * TOKEN_COST_SCALE
}
