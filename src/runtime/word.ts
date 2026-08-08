/**
 * Reading a 68000 word as a signed quantity.
 *
 * `(v << 16) >> 16` is how a `move.w` into a longword context behaves — the
 * low word kept, bit 15 smeared upward. Ports need it constantly, because an
 * extension's state is full of WORD fields that hold negative coordinates and
 * deltas, and JavaScript has no width to lose them from.
 *
 * It lives here rather than in `src/amiga` because that directory's rule is
 * shared *and* AmigaOS, and this is neither library nor device — it is the
 * CPU. `device.ts` is the precedent: shared by every port that needs it, on
 * the AMOS side of the line.
 *
 * Written out five times before this existed, under five names — `w16` in
 * AMAL and the dialog code, `sw` in TOME, `extW` in AMCAF and `w` in TURBO.
 * The names were the argument: `w` means this in TURBO and the UNSIGNED low
 * word in EasyLife, so two files spelled opposite operations the same way.
 */
export const sw16 = (v: number): number => (v << 16) >> 16
