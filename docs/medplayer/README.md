# medplayer.library

`src/runtime/med.ts` implements the `Med *` keywords of the stock Music
extension. Its replay was written from the published MMD0/MMD1 format, on the
stated grounds that the player itself "is NOT part of the AMOS source". That is
true and it was never the question. The library is in the corpus, in sixteen
places, and this is what it says.

## What is held

Three builds of `medplayer.library`, all of which call themselves
`Version 1.0` in `RT_IDSTRING` and none of which is the same code:

| sha256 | bytes | where | notes |
|---|---|---|---|
| `d408da50` | 7,832 | `Library1.3`, `Library3.0`, `WB-1.3`, `WB-2.1`, `WB-3.0` | no BPM mode |
| `1f2ca57f` | 12,608 | APD452/493/499/563/593/600/614/615, `Library2.0`, EMEDEMO, EME 3.0 demo, MMPlay\_CLI | **the AMOS Professional pairing**, 17 LVOs |
| `a93c8e42` | 19,928 | `MEDExt71/Libs`, in two archives | ships with the MED 7.1 extension, 21 LVOs |

Plus `octaplayer.library` (5 to 8 channels, MMD2) and `octamixplayer.library`
(0 to 64 channels, MMD3), both from MEDExt71. Neither is read here. They need
the software mixer, and holding them does not change that: see #116.

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

Every step is 2416 or 2417 except the ninth, which is 314 short of the
progression and cannot be derived from anything. That is the reason to read the
binary rather than reimplement the documented behaviour.

**Above 10 the timer is `470000 / tempo`.** The constant lives at `$c2(a6)` in
the player's state block and is initialised to 470000; `$2116ce` compares
`ExecBase+$212` against 50 and, when it is not 50, overwrites it with 474326.
So 470000 is PAL and 474326 is NTSC.

**In BPM mode the timer is `1773447 / (tempo * lines-per-beat)`.** Mode comes
from `flags2` bit 5 of the song (`$300(a0)`), and lines-per-beat is the low
five bits of the same byte, plus one. The BPM constant is `$53a(a6)`, 1773447
for PAL and 1789772 for NTSC. `d408da50` contains neither constant, so BPM mode
arrived after that build.

`F` with data 1 to `$f0` sets the primary tempo and calls straight into this
(`$210a4e`), so the range is 1 to 240 and `$f1` upward are the specials.

The result is written as two bytes to a CIA timer, low then high, through
pointers at `$11c(a6)` and `$120(a6)`. `$211660` sets those up: it opens
`ciaa.resource` and tries `AddICRVector` for timer A then timer B, and if both
are taken it rewrites the fourth byte of its own resource name from `a` to `b`
(`$21172e`) and tries `ciab.resource`. So the player takes whichever of the
four CIA timers it can get, and `$1d1(a6)` records which.

To turn a timer value into a rate, divide the CIA clock by it. That clock is
`PAULA_CLOCK_PAL / 5` = 709379, which is the standard relation and not
something this library states. Tempo 6 then ticks at 48.9 Hz, near enough a PAL
frame, which is why the port's "33 is one tick per vbl" reads roughly right and
is wrong in the third digit everywhere else.

## Effects: there are two tables, and tracks 4 and up are MIDI

The per-track routine at `$210d3c` splits before it does anything:

    tst.b   $6(a5)          ; track marked MIDI?
    bne.w   $211208
    cmp.w   #$4, d7         ; track index >= 4?
    bge.w   $211208

So **`medplayer.library` sounds four Paula tracks and sends everything above
them to MIDI**. An eight-track MMD is not eight voices here.

Paula effects dispatch through a 16-word table at `$210daa`, base `$210dea`;
MIDI effects through one at `$21122e`, base `$21126e`. The MIDI handlers build
three-byte messages (`$e0` pitch bend for `1` and `2`, `$d0` channel pressure
for `D`, `$a0` for `A`, `$b0` for `4` and `E`) and send them from `$cc(a6)`.

Six things in the Paula set that the port cannot have guessed:

**The vibrato table is not ProTracker's.** It is 32 signed bytes at `$21087a`:

    0, 25, 49, 71, 90, 106, 117, 125, 127, 125, 117, 106, 90, 71, 49, 25,
    0, -25, -49, -71, -90, -106, -117, -125, -127, -125, -117, -106, -90,
    -71, -49, -25

A full symmetric sine of amplitude 127, where ProTracker's is an unsigned
quarter-wave peaking at 255. The same 32 bytes appear in all three medplayer
builds and in `octaplayer` and `octamixplayer`, so one table serves the family.
`med.ts` currently uses `PT_SINE` and its comment says there is nothing to cite.
There is now, and it disagrees.

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
That is the synth instrument's per-frame step, and it runs two independent
command lists:

- the **waveform list**, dispatched at `$210660` through a 16-entry table at
  `$210664`, base `$210684`
- the **volume list**, dispatched at `$210762` through a table at `$210766`,
  base `$210786`

Each list is a byte script with its own program counter and its own speed
counter (`$2e(a5)` counts down to `$48(a5)`). Values below `$80` are data and
values at or above `$80` are commands, taken as `d1 & 15` into the table. The
volume list's own arithmetic is at `$2107a2` onward; `$21073a` is the waveform
change, reading a pointer from `$78(a0, d1.w * 4)`, which is the instrument's
waveform pointer array.

That is the shape. Decoding what each of the 32 commands does is #124's job,
not this read's.

## What this changes

- **#122**, the missing effects: both dispatch tables are located and every
  handler with them. The vibrato table, the arpeggio order, `A` equalling `D`
  and `C`'s decimal conversion are corrections to what is already there, not
  additions.
- **#123**, sub-tick tempo: the mapping is exact and above, including the one
  table entry that breaks its own pattern.
- **#124**, synthsounds: two interpreters, four addresses, 32 commands to read.
- **#116** is untouched. Four Paula tracks is all this library ever does, so
  anything wider still needs the mixer.

## Reproducing this

`src/cli/libdis.ts` does the romtag walk and the disassembly:

    npx tsx src/cli/libdis.ts fixtures/libs/medplayer/medplayer-1f2ca57f.library
    npx tsx src/cli/libdis.ts fixtures/libs/medplayer/medplayer-1f2ca57f.library \
      --lvo -66 --to '$2111e0'

The five binaries are vendored under `fixtures/libs/medplayer/`, named by the
first four bytes of their checksum. `fixtures/` is gitignored: they are read
for behaviour and never redistributed. Copy them out of the corpus with

    ../amos-files/sources/amos-pd-library-cd-1994/files/Library2.0/MEDPLAYER.library
    ../amos-files/sources/aminet-dev-amos/files/medext71/MEDExt71/Libs/*.library
    ../amos-files/sources/amos-pd-library-cd-1994/files/Library1.3/MEDPLAYER.LIBRARY
