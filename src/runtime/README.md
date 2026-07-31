# `src/runtime` — AMOS, and the ports

This is the AMOS side: the interpreter's runtime, the core keyword
implementations, and one module per ported extension. It is the *caller* of
`src/amiga`, which models the machine underneath (see that directory's README
for what may cross the line).

Most of what is here is ordinary. This document is about the part that is not:
the places where the code is knowingly wrong, and the two very different
reasons it can be.

## The two markers

A port is a claim about how something behaved. Where our behaviour and the
original's part company, the comment says so with one of exactly two words:

```
DEVIATION: <how we differ from the original, and why>
DEFECT: <the original's bug, which we reproduce>
```

They are opposites and they are easy to confuse, so the test in
`../coverage/quirks.test.ts` insists on the exact spelling — `DEVIATION:` and
`DEFECT:`, followed by a space, inside a comment. The prose after the colon
carries the argument; the marker exists so the set can be enumerated with a
grep instead of a reading.

### `DEVIATION:` — we are the ones who differ

The original does something this port does not. Nearly always because the
something is not a behaviour at all:

- **It reads or writes memory it does not own.** JD's `Ror$` on an empty
  string runs a `dbra` from −2 over 65,535 bytes of whatever follows; TURBO's
  `Blit Clear` with a negative low word walks 65,536 plane pointers. There is
  no answer to reproduce, only a crash, so these return the sane result and
  say so (`jd.ts:465`, `turbo.ts:2127`).
- **The hardware is not here.** `Serial Send` completes instantly because
  there is no port behind it; the printer rasterises and stops
  (`device.ts:112`, `ioports.ts:522`).
- **The host owns the mechanism.** JD's number input is its own line editor
  reading `$bfec01`; ours goes through the core's, so a program gets the same
  string back and a person sees different editing (`jd.ts:979`).

A `DEVIATION:` is a debt. It says what a program could observe that would come
out differently on a real Amiga, which is the only honest way to describe a
port that cannot be bit-exact everywhere.

### `DEFECT:` — the original is wrong, and we keep it

The library shipped with a bug, and reproducing the bug is the port working
correctly. These are not debts and must never be "fixed":

- JVP's `Jvp Bin Sort` never emits the root when element 0 is the list's
  maximum, so the last row of a sorted listing quietly shows the first record
  (`jvp.ts`).
- TURBO 2.15 moved some arithmetic for speed and left `y1` unconverted, so the
  whole `Scene View` family puts its top edge at line `y1 / rowBytes`
  (`turbo.ts:1171`).
- `Blit Speed` tests bits 0 and 15 of the stored word masks, which a
  `Blit Store Left` zone with a shift below 8 matches neither of — so it
  returns having changed nothing at all (`turbo.ts:2063`).
- JD's leap-year table stops at 4800 (`jd.ts:148`); `Jd Array Swap` rejects an
  index `Jd Array Clear` accepts (`jd.ts:1780`); Personnal's `Allow Plane Col`
  computes `n<<6` modulo 32, which is 0 for every `n` in range
  (`personnal.ts:1111`); Locale's `Close Catalog` never clears the pointer, so
  `Catalog Active` goes on reporting one (`locale.ts:172`); TFT's return
  register `d4` is never initialised (`tft.ts:373`).

The evidence bar is higher than for a deviation, because "the original was
wrong" is a strong claim and the alternative explanation — that we misread it —
is always available. A `DEFECT:` cites the routine and, where the manual
disagrees, says so: the binary wins over the manual.

### Both at once

A defect the port declines to reproduce is a `DEVIATION:`, not a `DEFECT:`.
The marker answers one question — *does our behaviour differ from the
original's?* — and for these the answer is yes, whatever the reason. The prose
then explains that the thing not reproduced was a bug. `jd.ts:442` is the
model: the two-argument `Jd Exval$` inherits a stale global on the real
library, and this port uses the initial state instead.

## Why they may not move to `src/amiga`

`src/amiga` holds shared mechanism. A `DEFECT:` is the opposite of shared: it
belongs to one library, one version of it, and usually one routine. The moment
a reproduced bug lands in a subsystem, every other caller inherits it, and the
next port to touch that subsystem gets behaviour it has no source for.

The test enforces this directly — no `DEFECT:` may appear under `src/amiga`.
That is the same rule as the `stampToYmd` clamp staying at the LDos call site,
stated in the form a machine can check.

`DEVIATION:` *is* allowed there, because the modelled machine genuinely differs
from the real one, and saying where is the point.

## Related

- `../amiga/README.md` — what may cross into the shared layer, and the
  mechanism-not-policy rule these markers are the code-level form of.
- `../coverage/status.ts` — `NOTES`, the user-facing version. Every marker here
  that a program can observe should have a note there too, because that is what
  reaches `KEYWORDS.md`; the marker is for whoever is reading the code.
