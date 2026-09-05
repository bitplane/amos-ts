# medplayer.library

`src/runtime/med.ts` implements the `Med *` keywords of the stock Music
extension. Its replay was once written from the published MMD0/MMD1 format, on
the stated grounds that the player itself "is NOT part of the AMOS source".
That is true and it was never the question. The library is in the corpus, in
sixteen places, this is what it says, and the port now follows it.

## What is held

Three builds of `medplayer.library`, all of which call themselves
`Version 1.0` in `RT_IDSTRING` and none of which is the same code:

| sha256 | bytes | where | notes |
|---|---|---|---|
| `d408da50` | 7,832 | `Library1.3`, `Library3.0`, `WB-1.3`, `WB-2.1`, `WB-3.0` | no BPM mode |
| `1f2ca57f` | 12,608 | APD452/493/499/563/593/600/614/615, `Library2.0`, EMEDEMO, EME 3.0 demo, MMPlay\_CLI | **the AMOS Professional pairing**, 17 LVOs |
| `a93c8e42` | 19,928 | `MEDExt71/Libs`, in two archives | ships with the MED 7.1 extension, 21 LVOs |

Plus `octaplayer.library` (5 to 8 channels, MMD2) and `octamixplayer.library`
(0 to 64 channels, MMD3), both from MEDExt71. They are now implemented by the
same sequencer in `src/runtime/med.ts`, over the distinct mixers in
`src/amiga/mmd2mix.ts` and `src/amiga/omixmix.ts`.

Everything below is `1f2ca57f`, because that is the build sitting in
`Library2.0` next to the AMOS Professional system files, and `+Music.s` is what
calls it. Addresses are as `src/amiga/hunk.ts` loads it, hunk 0 at `$210000`.

## Getting from a keyword to the code

AMOS declares the whole LVO table itself, in `+Music.s:2281-2293`:

    _MEDGetPlayer  -30   _MEDSetTempo         -66   _MEDResetMIDI    -90
    _MEDFreePlayer -36   _MEDLoadModule       -72   _MEDSetModnum    -96
    _MEDPlayModule -42   _MEDUnLoadModule     -78   _MEDRelocModule -102
    _MEDContModule -48   _MEDGetCurrentModule -84
    _MEDStopPlayer -54   _MEDDimOffPlayer     -60

The library resolves them the ordinary way: `RTC_MATCHWORD` `$4afc` at `$210004`
with `RT_MATCHTAG` pointing at itself, `RTF_AUTOINIT` set, and an init table
whose second long is the function table (`exec/resident.i`, held in the corpus
at `AMOSPro Sources/includes/`). It reads 17 absolute entries, `-6` through
`-102`, which is AMOS's thirteen plus the four standard ones. The `a93c8e42`
build has 21, so MEDExt71 extends the API to `-126` with four calls AMOS never
knew about.

`-42` through `-90` are six bytes apart and do nothing but set a flag. The
player is an interrupt server on a CIA timer, and all of the work is there.

## Tempo, which is exact and is not frames

`MEDSetTempo` is `$2111a4`, nineteen instructions, and it decides everything
about MED timing.

**Primary tempo 1 to 10 is a lookup table**, at `$2111e0`, not a formula:

| tempo | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| timer | 2417 | 4833 | 7250 | 9666 | 12083 | 14500 | 16916 | 19332 | **21436** | 24163 |

The line is `tempo * 14500/6`, which makes each tempo that many times the rate
of tempo 1, and nine of the ten sit within four counts of it. The ninth is 314
below it and cannot be derived from anything. That is the reason to read the
binary rather than reimplement the documented behaviour.

`MEDSetTempo` is reached through the stub at `$21020e`, which is what LVO `-66`
points at: it pushes `a6`, `bsr`s to `$2111a4` and returns.

**Above 10 the timer is `470000 / tempo`.** The constant lives at `$c2` of the
player's state block and is initialised to 470000; `$2116ce` compares
`ExecBase+$212` against 50 and, when it is not 50, overwrites it with 474326
(`move.l #$73cd6,$c2(a4)`). So 470000 is PAL and 474326 is NTSC.

**In BPM mode the timer is `1773447 / (tempo * lines-per-beat)`.** Mode comes
from `flags2` bit 5 of the song (`$300(a0)`), and lines-per-beat is the low
five bits of the same byte, plus one. The BPM constant is `$53a`, 1773447 for
PAL and 1789772 for NTSC. `d408da50` contains neither constant, so BPM mode
arrived after that build.

**BPM mode then divides the interrupt by four**, which is what makes the
numbers mean beats. `$211638` reads `flags2` at play time and `seq`s the result
into `$538(a6)`, so that byte is `$ff` outside BPM mode and 0 inside it. The
tick entry at `$2108a2` starts

    tst.b   $538(a6)
    bmi.b   $2108b8         ; $ff: every interrupt is a tick
    subq.b  #$1, $538(a6)
    ble.b   $2108b2
    bra.w   $2110ea         ; three interrupts in four do nothing
    move.b  #$4, $538(a6)

Without that four, 125 beats over 4 lines would tick at 200 Hz. With it the
rate is 50.01 Hz, which is a PAL frame, and the secondary tempo still divides
it into lines the same way it does outside BPM mode (`$2108de`, `cmp.b
$301(a4),d3`). Nothing forces the secondary tempo in either mode: `F` with data
1 to `$f0` writes `song->deftempo` at `$210a4e` and calls `MEDSetTempo`, and
that is all it does. So the primary tempo range is 1 to 240 and `$f1` upward
are the specials.

The result is written as two bytes to a CIA timer, low then high, through
pointers at `$11c(a6)` and `$120(a6)`. `$211660` sets those up: it opens
`ciaa.resource` and tries `AddICRVector` for timer A then timer B, and if both
are taken it rewrites the fourth byte of its own resource name from `a` to `b`
(`$21172e`) and tries `ciab.resource`. So the player takes whichever of the
four CIA timers it can get, and `$1d1(a6)` records which.

To turn a timer value into a rate, divide the CIA clock by it. That clock is
`PAULA_CLOCK_PAL / 5` = 709379, which the library never states, and its own
NTSC switch is what settles it: scale 470000 by `PAULA_CLOCK_NTSC /
PAULA_CLOCK_PAL` and you get 474326.46, and scale 1773447 the same way and you
get 1789771.995. Those round to the exact two constants `$2116ce` writes. Both
PAL constants are the NTSC ones divided by the Paula clock ratio, so the
divisor is the Paula clock over five and the resulting tick rate is the same on
either machine. `src/runtime/med.test.ts` asserts both.

Tempo 6 then ticks at 48.92 Hz and tempo 33 at 49.81, near a PAL frame and not
on it. `src/runtime/med.ts` places each interrupt at the instant it happens on
the sink's clock (`AudioSink.runTo`), so twelve seconds of tempo 33 is 598
ticks and not the 600 a frame counter gives it.

## Effects: there are two tables, and tracks 4 and up are MIDI

The per-track routine at `$210d3c` splits before it does anything:

    tst.b   $6(a5)          ; track marked MIDI?
    bne.w   $211208
    cmp.w   #$4, d7         ; track index >= 4?
    bge.w   $211208

So **`medplayer.library` sounds four Paula tracks and sends everything above
them to MIDI**. An eight-track MMD is not eight voices here.

There are **two** dispatch points, not one, and both tables are 32 entries
wide because MMD1 stores five bits of command (`andi.w #$1f,d6`, `$210996`):

| when | table | jump base | reached from |
|---|---|---|---|
| the row | `$2109fe` | `$210a3e` | `$2109f6` |
| every tick, the row's included | `$210daa` | `$210dea` | `$210da2` |

The row path falls into the tick path at `$210d30` with the counter freshly
cleared, which is the only way the tick handlers' `tst.b d3` branches are ever
reached with a zero. Commands `8`, `9`, `B`, `C`, `E` and `F` have no tick half
and land on the do-nothing exit at `$211072`; `0`, `1`, `2`, `4`, `5`, `6`, `7`,
`A` and `D` have no row half and land on `$210bfa`.

MIDI effects dispatch through their own table at `$21122e`, base `$21126e`. The
handlers build three-byte messages (`$e0` pitch bend for `1` and `2`, `$d0`
channel pressure for `D`, `$a0` for `A`, `$b0` for `4` and `E`) and send them
from `$cc(a6)`.

Six things in the Paula set that no reading of the format would give you:

**The vibrato table is not ProTracker's.** It is 32 signed bytes at `$21087a`:

    0, 25, 49, 71, 90, 106, 117, 125, 127, 125, 117, 106, 90, 71, 49, 25,
    0, -25, -49, -71, -90, -106, -117, -125, -127, -125, -117, -106, -90,
    -71, -49, -25

A full symmetric sine of amplitude 127, where ProTracker's is an unsigned
quarter-wave peaking at 255. The same 32 bytes appear in all three medplayer
builds and in `octaplayer` and `octamixplayer`, so one table serves the family.
`med.ts` carries it, and `med.test.ts` reads it back out of the binary.

**Arpeggio cycles low, high, base.** `$210e52` takes `d3 mod 3`: remainder 0
adds the low nibble, remainder 1 the high nibble, remainder 2 nothing.
ProTracker's order is base, high, low.

**`A` and `D` are the same handler**, `$210f62`, both plain volume slide.

**`C` converts decimal unless the song says hex.** `$210ae4`: with `flags` bit 4
clear the data byte is read as `(d >> 4) * 10 + (d & 15)`. With bit 7 set it
sets the instrument's volume in the sample table instead of the track's.

**`9` masks to five bits and reads 0 as 32.** `$210b2a`.

**`8` is hold and decay**, high nibble to `$9(a5)` and low to `$8(a5)`
(`$210b98`), whose defaults come from per-instrument tables at `$53e(a6)`.

Vibrato depth is scaled by `$22(a5)`, which two entry points set to 5 and 6, so
depth resolution is a per-command property and not a constant. Tremolo
(`$210f02`) uses the same table with a `>>3 & 31` position and `asr #7`,
clamping volume to 0..64.

## Synthsounds are two little bytecode interpreters

`$211072` and `$21107e` both test `$26(a5)` and, when it is set, call `$2105d6`.
That is the synth instrument's per-tick step, and it runs two independent
command lists, each with its own program counter, wait and speed counter:

- the **volume list**, over `volTable` at `$16` of the SynthInstr, dispatched
  at `$210660` through the table at `$210664`, base `$210684`
- the **waveform list**, over `wfTable` at `$96`, dispatched at `$210762`
  through the table at `$210766`, base `$210786`

The struct settles which is which: `$210648` reads `$15(a0,d0.w)` after one
increment, which is `volTable`, and it is `$4c(a5)` (the volume) that a data
byte sets. `$210704` then adds `$9e` to `a0` so the same `-$9` and `$78`
displacements reach `wfTable` and the `waveforms` array at `$116`.

A script byte below `$80` is data and one at or above it is a command, `& 15`
into the table. The interpreter keeps going within the same tick until it
reaches a data byte, a wait or the halt, so a run of commands costs nothing.

| | volume list | waveform list |
|---|---|---|
| `0` | this list's speed | this list's speed |
| `1` | wait n steps | wait n steps |
| `2` | step the volume down | period climbs each step |
| `3` | step the volume up | period falls each step |
| `4` | a waveform as the envelope | vibrato depth |
| `5` | the same, looping | vibrato speed, stored one higher |
| `6` | no envelope | back to the note's period |
| `7` | a step and nothing else | a waveform to shape the vibrato |
| `A` | jump the WAVEFORM list | jump the VOLUME list |
| `C` | a step and nothing else | arpeggio: the data run that follows |
| `D` | a step and nothing else | the end of an arpeggio run |
| `E` | jump | jump |
| `B` `F` | halt where it stands | halt where it stands |

`B` and `F` halt by storing the program counter back on top of itself
(`subq.b #1,d0`), so the list reads the same byte forever.

Three things that decide how a synth sounds and are not in any documentation:

**The volume list REPLACES the note's volume.** `$2106fe` writes `$4c(a5)`
into `$2(a5)` on every tick, gate or no gate, so a volume slide or a tremolo
on a synth track is overwritten the same tick it is computed.

**A pure synth reads the period table 24 notes lower.** `$210574` does
`suba.w #$30,a1` before storing the table pointer, where the sampled path at
`$210358` stores it as it is. So the same note number is not the same note.
A hybrid takes the sampled path and gets no bias.

**DEFECT: the period clamp does nothing.** `$21086e` reads
`cmp.w #$71,d5 / bge / moveq #$71,d1`, and `d1` is not the period. The clamp
writes a register nothing looks at, so a synth period runs straight past 113
and Paula is handed whatever comes out.

A hybrid is type `$fffe`: `$210568` follows `waveforms[0]` to a sampled header
and plays it the ordinary way, then `$2104ce` runs the synth init anyway, so
both scripts drive a sampled voice. And `$2102ca` is why a pure synth's DMA is
never stopped between notes, where a hybrid's is.

## Notes are five octaves, and the row is entered 24 words in

Sixteen finetuned period tables sit at `$212088`, 192 bytes apart. `$21035c`
picks one with the track's finetune and `$210370` indexes it with the note,
after `$21033a` has wrapped the note into 0..62 by whole octaves.

Each table is 60 real entries and then the top octave three times over, so a
note past the end lands in the top octave again rather than off the table.
Finetune 0 is ProTracker's row 0 with its first octave multiplied by four and
its second by two, which `med.ts` derives and `med.test.ts` checks word for
word against the binary. The other fifteen rows are MED's own arithmetic and
part company with ProTracker's finetuned rows by up to 13 counts, 0.45%.

**A row is not entered at its first word.** The sixteen pointers live at
`$212ca8` (`$121c(a6)`, and a6 is the player struct at `$211a8c`), and every
one of them is `$212088 + 48 + row * 192`. So note 0 of a sampled instrument is
word 24, which is ProTracker's 856, and the two octaves below it are reachable
only by the pure synth path, where `$21058c` takes the same 48 bytes straight
back off:

    021057a  lea.l      $121c(a6), a1
    021057e  move.b     $b(a5), d0        ; finetune, signed
    0210588  movea.l    (a1, d0.w), a1
    021058c  suba.w     #$30, a1          ; the synth's two octaves
    0210596  move.w     (a1, d1.w), d1    ; and NO wrap: $21033a is not on this path

The array is indexed with a signed finetune, so it runs -8 to +7 around
`$121c(a6)` and the eight longs below it are rows 8 to 15. That is what
`finetune & 0xf` comes to.

Reading the table from word 0 instead put every sampled note two octaves down.
It survived a full test suite because the tests checked the derivation against
the table and never against the pointer, and it took rendering a real module
next to another player's to hear it.

## Volume is scaled once, not at every write

`$211484` walks the sixteen tracks at song offset `$302` and stores
`(trackvol * mastervol) >> 4` per track. A note's volume is then
`svol * that >> 8` (`$2109d0`), and 64 against 64 gives 256, which is unity.
The volume slide at `$210f76` and the tremolo both work on that already-scaled
number, so a slide on a quiet track behaves differently from a slide on a loud
one. Scaling at the point of writing the register, which is the obvious way to
build it, gets that wrong.

## What this changes

- **#122**, the effects: done. Both tables are ported entry by entry.
- **#123**, sub-tick tempo: done.
- **#124**, synthsounds: done. Both interpreters and all 32 commands.
- **#116** is untouched. Four Paula tracks is all this library ever does, so
  anything wider still needs the mixer.

## Reproducing this

`src/cli/libdis.ts` does the romtag walk and the disassembly:

    npx tsx src/cli/libdis.ts fixtures/libs/medplayer/medplayer-1f2ca57f.library
    npx tsx src/cli/libdis.ts fixtures/libs/medplayer/medplayer-1f2ca57f.library \
      --lvo -66 --to '$2111e0'

The six distinct binaries are vendored under `fixtures/libs/medplayer/`, named by the
first four bytes of their checksum. `fixtures/` is gitignored: they are read
for behaviour and never redistributed. Copy them out of the corpus with

    ../amos-files/sources/amos-pd-library-cd-1994/files/Library2.0/MEDPLAYER.library
    ../amos-files/sources/aminet-dev-amos/files/medext71/MEDExt71/Libs/*.library
    ../amos-files/sources/amos-pd-library-cd-1994/files/Library1.3/MEDPLAYER.LIBRARY

## Family audit

The version-7 builds shipped with MED 7.1 are the authoritative set for the
shared extension: `medplayer.library` exposes 21 vectors (17 library calls
after the four Exec vectors), `octaplayer.library` exposes 18 (14 calls), and
`octamixplayer.library` exposes 17 (13 calls). The older version-2 builds are
retained as corroborating binaries, not selected in preference to version 7.

The audit found that the two software-mixed implementations existed but were
still hidden from `OpenLibrary`, and that MED 7.1 always constructed the
four-channel build regardless of its selected mode. Both Octa libraries are
now advertised at version 7, mode 1 constructs `octaplayer`, and mode 2
constructs `octamixplayer`. HQ, MIDI, 14-bit mode, requested mixing rate and
buffer size are also copied into the selected player and updated there after
initialisation.
