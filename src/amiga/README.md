# `src/amiga`: the modelled machine

Everything in here is **AmigaOS, not AMOS**. It is what an Amiga program of
any language could have called: a filesystem, `locale.library`, the DateStamp
calendar. AMOS itself, its interpreter and the extension ports live in
`src/runtime`, and they are *callers* of this layer.

The split exists because the alternative was already happening. Before it,
`days since 1 January 1978 -> civil date` had been written four separate
times: in the host clock, in JD, in LDos and inside locale.library's
formatter. The locale back-end had exactly one importer while looking, from
its own documentation, like a shared subsystem. The next extension that wanted a date
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

And "shared" is not enough on its own. It has to be shared *and* AmigaOS.
AMOS's device layer (`Dev.Open` and friends, +Lib.s:3068) is shared by every
port that drives a device, and it still does not belong here: those are
`Lib_Def` routines in AMOS's own main library, a wrapper AMOS wrote over
exec. It lives in `src/runtime/device.ts`, out of the IOPorts port that
happened to need it first, but on the AMOS side of the line.

`exec.ts` is now the layer that wrapper sits *on*, which sharpens the same
point rather than blunting it: exec owns the pool sizes and the arithmetic,
while what is *in* a pool stays with the Runtime, because a bank is chip only
because an AMOS bank flag says so. Mechanism here, accounting there.

`MemPool`, first-fit `AllocMem` and `FreeMem` over one mapped buffer, arrived
there the long way and is the rule working. It was written inside `sln.ts`
with a note saying it would move if a second extension ever wanted `AllocMem`;
Make 1.30, whose whole first half is `Ma Malloc` and exec lists, is that
second extension. Where the pool is MAPPED still belongs to the caller: the
base and the size come from the caller's own memory region, because that
region is the caller's declaration and not exec's.

The other half of exec is deliberately absent. There is one task in this port,
so Forbid and Permit have nothing to forbid and stay n/a; message ports and
signals have no second task to talk to. Modelling them now would be inventing
machinery to sit unused.

**The gameport is the case that split in two**, and it is the best example
here because the rule was applied twice and gave different answers.

What is shared between AMOS's `Joy()`, Sticks' `Multi Joy`, the web player's
two keyboard presets and its gamepad reader is the packing `1` up, `2` down,
`4` left, `8` right, `16` fire. That is AMOS's surface rather than the
machine's, so it went to `../interp/gameport.ts`. None of the hardware's
numbers appear in it.

The AmigaOS half was then not written, on the grounds that it had no caller:
`input.joy` already arrives in AMOS's packing from the host, so nothing needed
the quadrature counters decoded. It has callers now. GameSupport's
`Gsmousedx`/`Gsmousedy` difference JOY1DAT's two bytes frame to frame, and
Ercole's `Pad Fire` reads bit 9 and bit 1 of each register, so the register
itself is shared and unambiguously hardware. `gameport.ts` exists, and
`gameport.ts`'s own header opens by explaining why it did not.

Both decisions were right when they were made. A module belongs here when a
second caller appears, not before, and this document said the file would never
exist for as long as that was true.

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
  minterm, a whole control word or a request for the default, which is an AMOS
  calling convention the blitter knows nothing about. It had settled in
  `planar.ts` because that was convenient for its one caller, which is
  exactly how policy gets into a mechanism layer. It lives in
  `../runtime/objects.ts` now, beside the bobs it speaks for.

If a change here would make a port's documented behaviour *more consistent*
with something else, that is a warning sign, not a win. The library being
ported gets to be as inconsistent as it actually was.

The sharpest form of that rule is about bugs. A library that shipped wrong
gets reproduced wrong, and `../runtime/README.md` sets out the `DEFECT:`
marker those places carry. But a `DEFECT:` may never appear in this directory,
and `../coverage/quirks.test.ts` enforces it. A bug belonging to
one release of one library is the least shareable thing in the codebase; put
it in a subsystem and every other caller silently inherits behaviour it has no
source for. `DEVIATION:` *is* allowed here, because the modelled machine
really does differ from the real one and saying where is the whole job.

## Contents

| module | models |
|---|---|
| `exec.ts` | `AvailMem`'s pools, the library list (`OpenLibrary`) and `AllocMem` |
| `graphics.ts` | `BitMap` and `RastPort`: bitplanes, pens, and the two pixel funnels |
| `planar.ts` | the chunky/planar bijection and the word-at-a-time span ops |
| `blitter.ts` | BLTCON0/1, the logic function, BLTSIZE and `BltBitMapRastPort` |
| `layers.ts` | `layers.library`: the layer chain, `Region`, and the damage list |
| `intuition.ts` | the Workbench screen, `OpenWindow`, the system gadgets, IDCMP |
| `boopsi.ts` | intuition's object system: classes, dispatchers and the `OM_` methods |
| `muimaster.ts` | MUI's class factory: 64 classes, attributes, the object tree, notification |
| `muimaster.gen.ts` | its constants, generated from MUI 3.8's header by `src/cli/genmui.ts` |
| `paula.ts` | the four voices: clock, AUDxPER, AUDxVOL, and the sink boundary |
| `mixer.ts` | the four voices summed into stereo PCM, and the clock that dates a register write |
| `notes.ts` | the tables every replayer shipped: periods, finetune, the vibrato sine |
| `protracker.ts` | the four-channel ProTracker replay, off Player 6.1A's source |
| `p61.ts` | the Player 6.1A packed module format, onto that replay |
| `soundfx.ts` | the SoundFX 1.3 format and replay, off `DME_SoundFX1.3.library` |
| `fc14.ts` | FutureComposer 1.4: the sequences, the envelopes and the wavetable |
| `fc13.ts` | FutureComposer 1.0-1.3: the same machine one revision earlier, over waveforms it does not carry |
| `digi.ts` | the DigiBooster 1.x module format: the packed patterns and the chained samples |
| `digimix.ts` | DigiBooster's mixer: two channels into one Paula voice, at the first one's rate |
| `digiplay.ts` | the DigiBooster replay: ProTracker's effects over eight channels and four pairs |
| `soundmon.ts` | the BP SoundMon 2.0 module format: one record layout for samples and synths |
| `soundmonplay.ts` | its replay: three modulators, and one that rewrites the playing waveform |
| `s3m.ts` | the ScreamTracker 3 module format: little-endian, and paragraph pointers |
| `s3mmix.ts` | its 28 kHz mixer: unsigned bytes throughout, and a byte-swapped 16.16 position |
| `s3mplay.ts` | its replay: two dispatch tables, and a vibrato that reads the command byte |
| `tfmx.ts` | the TFMX container and mdat: two files in one bank, and a subsong walk that miscounts |
| `tfmxplay.ts` | its replay: three dispatch tables, a CIA-B clock, and a tempo that means two things |
| `mmd2.ts` | OctaMED Pro's 5-8 channel format, where a block sets its own track count |
| `mmd2mix.ts` | octaplayer's mixer: eight tracks into four voices, and a tempo that is a buffer length |
| `fc13waves.ts` | FutureComposer 1.0-1.3's 47 built-in waveforms, generated rather than shipped |
| `thx.ts` | the THX synth-tracker module format, off its replayer's `InitModule` |
| `thxplay.ts` | the THX replay: the song, the envelopes, the playlists, the voices |
| `thxwaves.ts` | the 6,520-byte THX waveform set and its 63 filtered copies |
| `device.ts` | what a slot is, what a device is, and the tree a hardware page draws |
| `cia.ts` | CIA-A port A: the LED and filter bit, two fire buttons, four floppy lines |
| `keyboard.ts` | the byte the keyboard clocks into CIA-A's SDR, and its decode |
| `mouse.ts` | the three mouse buttons, which are pins on CIA-A and POTGOR |
| `gameport.ts` | JOY0DAT and JOY1DAT, the quadrature counter registers |
| `controller.ts` | what is plugged into a gameport |
| `lowlevel.ts` | `lowlevel.library`, the joyport half |
| `datestamp.ts` | the AmigaDOS `DateStamp` and its calendar arithmetic |
| `battclock.ts` | the battery clock at $DC0000: sixteen BCD nibbles, and nothing reads it after boot |
| `vfs.ts` | `AmigaFS`: volumes, assigns, paths, file metadata |
| `fs.ts` | `AmosFS`, the read interface a volume provider satisfies |
| `adf.ts` | an OFS/FFS floppy image, which `AdfVolume` mounts into `vfs.ts` |
| `localelib.ts` | `locale.library`: catalogs, `FormatDate`, collation, case |
| `localelib.gen.ts` | its data, generated from AROS by `src/cli/genlocale.ts` |
| `dos.ts` | `dos.library`'s FileInfoBlock: entry types, protection bits, offsets |
| `dospattern.ts` | `dos.library`'s `ParsePattern`/`MatchPattern` grammar |
| `speak.ts` | `SPEAK:`, the speech handler. MODELLED, see its own header |
| `hunk.ts` | the AmigaDOS object file format: `LoadSeg` and one-hunk reads |
| `diskfont.ts` | `diskfont.library` and the graphics.library `TextFont` |
| `powerpacker.ts` | `powerpacker.library`'s PP20 codec |
| `patternlib.ts` | `pattern.library` 5.00, a THIRD pattern grammar and not `dospattern`'s |
| `xpkmaster.ts` | `xpkmaster.library` 2.2: the XPK container, and one compressor |
| `process.ts` | `Execute()` and LoadSeg with CreateProc: starting a program that is not this one |
| `icon.ts` | `icon.library`'s `.info` file: the DiskObject and its imagery |
| `imploder.ts` | the Imploder's IMP! codec |
| `bytekiller.ts` | ByteKiller, decrunch only |
| `stonecracker.ts` | StoneCracker 4.04 (`S404`), decrunch and crunch |
| `lh.ts` | `lh.library` 1.8, LhDecode and LhEncode |
| `solaris.ts` | `\SOLARIS/`, the packer on the CRAFT installer disk |
| `decrunchlib.ts` | `decrunch.library` 35.237, the format identification walk |
| `decrunchlib.gen.ts` | its tables, generated from the library by `src/cli/gendecrunch.ts` |
| `jpeg.ts` | baseline JPEG, ISO/IEC 10918-1, Huffman and 8-bit tables |
| `opalvision.ts` | OpalVision, Opal Technology's 24-bit framebuffer, and `opal.library` |
| `gms.ts` | the Games Master System's module registry and jump tables |
| `rexx.ts` | ARexx public message ports |
| `language.ts` | the language names and codes `locale.library` and Workbench share |
| `memmap.ts` | the synthesized address space, as a registry of regions |
| `machine.ts` | power state and reset kinds, the layer *beneath* one running environment |
| `host.ts` | the boundary *beneath* this layer: what the outside world supplies |

`host.ts` is the odd one: it is not OS, it is what the OS sits on. It lives
here because everything in this directory is defined against it, and because
leaving it among the extension ports was worse.

`speak.ts` is the other odd one, and for the opposite reason: everything else
here is ported from something readable, whether AmigaOS source, AROS data or a
shipped binary, and `SPEAK:` is not. No Speak-Handler binary or source is held, so
its two decisions (when an utterance is released, and what the `OPT` letters
mean) are MODELLED from the AmigaDOS description of the handler rather than
read off anything. Its header says so at length, and it is the one file in
this directory a reader should distrust first. It is here rather than in
`src/runtime` because it is an AmigaOS device and not an AMOS one, and because keeping it
pure, with the caller supplying the synthesis, is what lets the release rule be
tested without a voice.

## The boundary is enforced

`layer.test.ts` fails the build if anything here imports from `../runtime` or
`../interp`. Both had already happened by the time it was written. `vfs.ts`
and `host.ts` reached back for the two interfaces they are defined against,
and `powerpacker.ts` threw an `AmosError` carrying AMOS error number 23 from
inside a codec AMOS merely calls.

Type-only imports with no runtime cost, every one, which is exactly why they
survived: nothing failed and nothing got slower. A boundary nobody can cross
by accident is worth more than one everybody remembers not to.

Tests here may reach across. `vfs.test.ts` builds a Runtime to check a mounted
archive is readable from AMOS, which is the right way to test a filesystem. The rule is about what ships.

One outward dependency is allowed and listed in that test: `../loader/binreader`,
a leaf byte-reader with no imports of its own, already shared by `src/tokens`
and `src/runtime`. It is plumbing, not AMOS.
