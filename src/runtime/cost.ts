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
import { CYCLES_PER_DISPATCH } from '../amiga/paula'

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
