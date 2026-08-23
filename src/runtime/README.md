# `src/runtime`: AMOS, and the ports

This is the AMOS side: the interpreter's runtime, the core keyword
implementations, and one module per ported extension. It calls `src/amiga`,
which models the machine underneath. That directory's README says what may
cross the line.

Most of what is here is ordinary. This document is about the part that is not,
the places where the code is knowingly wrong, and the two very different
reasons it can be.

## The two markers

A port is a claim about how something behaved. Where our behaviour and the
original's part company, the comment says so with one of exactly two words:

```
DEVIATION: <how we differ from the original, and why>
DEFECT: <the original's bug, which we reproduce>
```

They are opposites and they are easy to confuse, so `../coverage/quirks.test.ts`
insists on the exact spelling, `DEVIATION:` and `DEFECT:` followed by a space,
inside a comment. The prose after the colon carries the argument. The marker
exists so the set can be enumerated with a grep instead of a reading.

Citations below name a file and a keyword rather than a line number. Line
numbers in this file rotted to uselessness once already: thirteen of them, none
still pointing at what it claimed, because every one of them moves whenever
anything above it is edited. `grep -n "DEFECT: " src/runtime/turbo.ts` is the
reliable index.

### `DEVIATION:` means we are the ones who differ

The original does something this port does not, nearly always because the
something is not a behaviour at all.

- **It reads or writes memory it does not own.** JD's `Ror$` on an empty string
  reads the high byte of the length word as an index and then runs a `dbra`
  from -2, over 65,535 bytes of whatever follows. TURBO's `String Hunt` with an
  empty needle never checks the length word either, and walks 65,536 bytes.
  Neither is a result to reproduce, so both return the sane answer and say so
  (`jd.ts`, `turbo.ts`).
- **The hardware is not here.** `Serial Send` completes instantly because there
  is no port behind it, and the printer rasterises and stops (`device.ts`,
  `ioports.ts`).
- **The host owns the mechanism.** JD's number input is its own line editor
  reading `$bfec01`. Ours goes through the core's, so a program gets the same
  string back while a person sees different editing (`jd.ts`).

A `DEVIATION:` is a debt. It records what a program could observe that would
come out differently on a real Amiga, which is the only honest way to describe
a port that cannot be bit-exact everywhere.

### `DEFECT:` means the original is wrong and we keep it

The library shipped with a bug, and reproducing the bug is the port working
correctly. These are not debts and must never be "fixed".

- JVP's `Jvp Bin Sort` never emits the root when element 0 is the list's
  maximum, so the last row of a sorted listing quietly shows the first record
  (`jvp.ts`).
- TURBO 2.15 moved some arithmetic for speed and left `y1` unconverted, so the
  whole `Scene View` family puts its top edge at line `y1 / rowBytes`
  (`turbo.ts`).
- `Blit Speed` tests bits 0 and 15 of the stored word masks, and a `Blit Store
  Left` zone with a shift below 8 matches neither, so the keyword returns
  having changed nothing at all (`turbo.ts`).
- JD's leap-year table stops at 4800, and `Jd Array Swap` rejects an index
  `Jd Array Clear` accepts (`jd.ts`). Personnal's `Allow Plane Col` computes
  `n<<6` modulo 32, which is 0 for every `n` in range (`personnal.ts`).
  Locale's `Close Catalog` never clears the pointer, so `Catalog Active` goes
  on reporting one (`locale.ts`). TFT's return register `d4` is never
  initialised (`tft.ts`).

The evidence bar is higher than for a deviation, because "the original was
wrong" is a strong claim and the alternative explanation, that we misread it,
is always available. A `DEFECT:` cites the routine, and where the manual
disagrees it says so, because the binary wins over the manual.

#### The keyword that cannot be typed

One family is common enough to name. The routine is written, the manual
documents it, and the library's own TOKEN TABLE puts it out of reach, so the
whole keyword is dead in the shipped release. Four ways it happens, all found
by running the Test pass over every test in this directory:

- **The variant is behind a $FF.** `VerC4` (+Verif.s:3158) is `cmp.b #-2,d1 /
  bne VerSynt`, so an argument-count variant reached by anything but a $FE is
  never tried, and the variant entry has no name of its own for `TkKt` to
  find. AMOS Pro's own `!sam loop on` (`instr.ts`) and EasyLife's `!elzb multi
  add` (`easylife.test.ts`) both lose their second form this way.
- **The spec does not describe the routine.** JD Colour's `jd wait raster`
  asks for five arguments where routine 59 pops one and the library's manual
  writes `Jd Wait Raster Z` (`jdcolour.test.ts`). SymBase's `db append from`
  ends `"I0,"`, a separator where a type belongs, and matches no argument list
  at all (`symbase.test.ts`).
- **The spec has no terminator.** Range's `splot` runs on into the entry
  behind it, which costs two keywords: `Splot` matches nothing and `float
  planes` is read four bytes late as `t planes` (`range.test.ts`,
  `../tokens/libtok.ts`).
- **Two entries share a name.** `TkKt` (+Edit.s:14521) keeps the longest match
  and, at `cmp.w d3,d0 / bls.s TkRe4`, the first of two the same length. So
  Personnal's `copper base` loses its writer and its `set color` loses its
  reader, one pair each way round (`personnal.ts`).

The port keeps the routine, refuses the source line, and reaches the routine in
its test through `tokenizeUnchecked`, which documents all four.

### Both at once

A defect the port declines to reproduce is a `DEVIATION:`, not a `DEFECT:`. The
marker answers one question, *does our behaviour differ from the original's?*,
and for these the answer is yes whatever the reason. The prose then explains
that the thing not reproduced was a bug. JD's two-argument `Jd Exval$` is the
model: on the real library it inherits a stale global left by the last
three-argument call, and this port uses the initial state instead (`jd.ts`).

## Why they may not move to `src/amiga`

`src/amiga` holds shared mechanism. A `DEFECT:` is the opposite of shared. It
belongs to one library, one version of it, and usually one routine. The moment
a reproduced bug lands in a subsystem, every other caller inherits it, and the
next port to touch that subsystem gets behaviour it has no source for.

The test enforces this directly: no `DEFECT:` may appear under `src/amiga`.
That is the same rule as the `stampToYmd` clamp staying at the LDos call site,
stated in the form a machine can check.

`DEVIATION:` *is* allowed there, because the modelled machine genuinely differs
from the real one, and saying where is the point.

## Related

- `../amiga/README.md` says what may cross into the shared layer, and states
  the mechanism-not-policy rule these markers are the code-level form of.
- `../coverage/status.ts` holds `NOTES`, the user-facing version. Every marker
  here that a program can observe should have a note there too, because that is
  what reaches `KEYWORDS.md`. The marker is for whoever is reading the code.
