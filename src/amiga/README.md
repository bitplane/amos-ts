# `src/amiga` — the modelled machine

Everything in here is **AmigaOS, not AMOS**. It is what an Amiga program of
any language could have called: a filesystem, `locale.library`, the DateStamp
calendar. AMOS itself, its interpreter and the extension ports live in
`src/runtime`, and they are *callers* of this layer.

The split exists because the alternative was already happening. Before it,
`days since 1 January 1978 → civil date` had been written four separate times —
in the host clock, in JD, in LDos and inside locale.library's formatter — and
the locale back-end had exactly one importer while looking, from its own
documentation, like a shared subsystem. The next extension that wanted a date
would have written a fifth.

## What belongs here

A module belongs in `src/amiga` when **more than one caller could reasonably
need it and none of them owns it**. `locale.library` qualifies even though only
the Locale extension calls it today, because JD and LDos both do dates and both
have their own copies. The filesystem qualifies obviously.

A module does **not** belong here just because it models something Amiga-ish.
LDos's LZ codec is LDos's. The Music extension's speech keywords are the AMOS
side of `narrator.device`, not the device. If one extension owns it, it stays
in `src/runtime` next to that extension.

And "shared" is not enough on its own — it has to be shared *and* AmigaOS.
AMOS's device layer (`Dev.Open` and friends, +Lib.s:3068) is shared by every
port that drives a device, and it still does not belong here: those are
`Lib_Def` routines in AMOS's own main library, a wrapper AMOS wrote over
exec. It lives in `src/runtime/device.ts` — out of the IOPorts port that
happened to need it first, but on the AMOS side of the line.

`exec.ts` is now the layer that wrapper sits *on*, which sharpens the same
point rather than blunting it: exec owns the pool sizes and the arithmetic,
while what is *in* a pool stays with the Runtime, because a bank is chip only
because an AMOS bank flag says so. Mechanism here, accounting there.

The other half of exec is deliberately absent. There is one task in this port,
so Forbid and Permit have nothing to forbid and stay n/a; message ports and
signals have no second task to talk to. Modelling them now would be inventing
machinery to sit unused.

## The rule that matters: mechanism, not policy

This layer holds **shared mechanism**. It must never hold a caller's **policy**,
because a port's quirks are usually the point of the port.

Three live examples, all of which would have been easy to "clean up" wrongly:

- **`stampToYmd` does not clamp.** LDos's `Ldate` clamps below the epoch
  because its manual says "if the date is before 1 Jan 1978, 780101 will be
  returned". That is LDos's rule; it lives at the LDos call site. A shared
  function that clamped would silently impose it on everyone.
- **JD's day names stay in JD.** Its 5.3 source hardcodes English, so it must
  print English even when a locale is loaded. Routing it through
  `getLocaleStr` would be a faithfulness regression dressed as a cleanup.
- **`bobBltcon0` went the other way, OUT of this directory.** It reads the
  sign of `Set Bob`'s fourth argument to decide whether the value is a
  minterm, a whole control word or a request for the default — an AMOS
  calling convention the blitter knows nothing about. It had settled in
  `planar.ts` because that was convenient for its one caller, which is
  exactly how policy gets into a mechanism layer. It lives in
  `../runtime/objects.ts` now, beside the bobs it speaks for.

If a change here would make a port's documented behaviour *more consistent*
with something else, that is a warning sign, not a win. The library being
ported gets to be as inconsistent as it actually was.

The sharpest form of that rule is about bugs. A library that shipped wrong
gets reproduced wrong, and `../runtime/README.md` sets out the `DEFECT:`
marker those places carry — but a `DEFECT:` may never appear in this
directory, and `../coverage/quirks.test.ts` enforces it. A bug belonging to
one release of one library is the least shareable thing in the codebase; put
it in a subsystem and every other caller silently inherits behaviour it has no
source for. `DEVIATION:` *is* allowed here, because the modelled machine
really does differ from the real one and saying where is the whole job.

## Contents

| module | models |
|---|---|
| `exec.ts` | `AvailMem`'s pools and the library list — `OpenLibrary` |
| `graphics.ts` | `BitMap` and `RastPort` — bitplanes, pens, and the two pixel funnels |
| `planar.ts` | the chunky/planar bijection and the word-at-a-time span ops |
| `blitter.ts` | BLTCON0/1, the logic function, BLTSIZE and `BltBitMapRastPort` |
| `datestamp.ts` | the AmigaDOS `DateStamp` and its calendar arithmetic |
| `vfs.ts` | `AmigaFS` — volumes, assigns, paths, file metadata |
| `fs.ts` | `AmosFS`, the read interface a volume provider satisfies |
| `adf.ts` | an OFS/FFS floppy image — `AdfVolume` mounts one into `vfs.ts` |
| `localelib.ts` | `locale.library` — catalogs, `FormatDate`, collation, case |
| `localelib.gen.ts` | its data, generated from AROS by `src/cli/genlocale.ts` |
| `dospattern.ts` | `dos.library`'s `ParsePattern`/`MatchPattern` grammar |
| `hunk.ts` | the AmigaDOS object file format: `LoadSeg` and one-hunk reads |
| `diskfont.ts` | `diskfont.library` and the graphics.library `TextFont` |
| `powerpacker.ts` | `powerpacker.library`'s PP20 codec |
| `host.ts` | the boundary *beneath* this layer: what the outside world supplies |

`host.ts` is the odd one: it is not OS, it is what the OS sits on. It lives
here because everything in this directory is defined against it, and because
leaving it among the extension ports was worse.

## The boundary is enforced

`layer.test.ts` fails the build if anything here imports from `../runtime` or
`../interp`. Both had already happened by the time it was written — `vfs.ts`
and `host.ts` reached back for the two interfaces they are defined against,
and `powerpacker.ts` threw an `AmosError` carrying AMOS error number 23 from
inside a codec AMOS merely calls.

Type-only imports with no runtime cost, every one, which is exactly why they
survived: nothing failed and nothing got slower. A boundary nobody can cross
by accident is worth more than one everybody remembers not to.

Tests here may reach across — `vfs.test.ts` builds a Runtime to check a
mounted archive is readable from AMOS, which is the right way to test a
filesystem. The rule is about what ships.

One outward dependency is allowed and listed in that test: `../loader/binreader`,
a leaf byte-reader with no imports of its own, already shared by `src/tokens`
and `src/runtime`. It is plumbing, not AMOS.
