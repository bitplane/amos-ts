# What's not implemented (and what's approximated)

This is the narrative view. The authoritative, per-keyword list is
`KEYWORDS.md`, generated from `src/coverage/status.ts`: a keyword marked
**approximated** there carries a note saying exactly how it differs, and a few
marked **faithful** carry one too, where the behaviour is right but the
mechanism underneath it is not. Everything described below is one of those.

## Where the port stands

Core AMOS Professional is complete: the display pipeline, the audio pipeline,
the language, banks, files, menus, the Interface dialog engine and the file
selector all read 100%. So does every extension a stock installation ships,
and every third-party one the port has started.

**Every row in the manifest reads 0% or 100%.** An extension is finished or it
has not been begun, and that is the number to watch. A row appearing in the
middle means a thread was left hanging.

`KEYWORDS.md` carries the counts. They are not repeated here, because a
hand-copied total is a total that drifts, and this file has proved it twice.

`runreport` can measure a selected program tree, but its result depends on the
roots and fixtures supplied. This document records the durable reasons programs
stop rather than embedding another snapshot of a changing corpus.

## Not implemented

### Host-machine calls (~10k hits, mostly doscall)

`Doscall/Execall/Gfxcall/Intcall`, `Dreg/Areg`, `Exec`, `Call` and
machine-code procedures, `Lib Open/Call/Close` and ARexx — all classified n/a,
because they reach AmigaOS ROM or the ARexx system. 68k machine code is never
executed here, which is a policy rather than a gap: reading and disassembling
it is how much of the extension work was done. The `Dev *` family and
`Open Port` are NOT among them: they drive AMOS's own device layer, which is
modelled, over the four devices this port has a back end for.

Between them `dreg` (30 programs) and `doscall` (14) are the two widest gaps
in the census, and neither is closable.

AMOS Pro's own Object Editor is the visible case. `InCall` (+ILib.s:5852)
resolves its argument through `Bnk.OrAdr`, loads `CallReg(a5)` into d0-d7 and
a0-a2 — which is what `Dreg()`/`Areg()` write — and does `jsr (a4)`. So
`Object_Editor.AMOS` carries two Asm banks, 15 at 1,384 bytes and 14 at 720,
and calls into them 19 times. Bank 15 is the whole of `_ZOOM`: source corner,
destination corner, size and magnification in d1 to d7, both screens in a0 and
a1. Nothing else in the accessory draws the magnified sprite, so the left-hand
edit panel stays blank here while every other part of the editor works. The
handles, the palette, the tools and the object itself are AMOS and run.

### Third-party extensions

These are registered and detokenising but not implemented, so a program lists
and loads with real keyword names instead of `{ext12:$02d4}` and then stops at
the first extension keyword. The count is keywords with no handler at all.

Three rows read 0%, and they divide by what is in the way rather than by
size. `src/coverage/coverage.test.ts` checks both directions — every 0% row is
named, and no row is named that is FINISHED — so a ported extension cannot
quietly stay on the list and a half-built one cannot quietly leave it.

Blocked on a back-end nothing here models:

| extension | missing | what it is waiting on |
|---|---|---|
| OS DevKit 1.61 (`os-devkit-1.61`) | 1047 | a wrapper over most of AmigaOS. It needs the back-end, not the list, and 932 of the 1,047 now have one: 417 intuition, 139 graphics, 111 exec, 108 gadtools, 60 dos. What is left unmodelled is `iffparse` (40), `commodities` (24), `workbench` (11), `preferences` and `amigaguide` (3 each). `asl` and `icon` were on that list and are modelled now. 371 of the keywords are struct field accessors, and 1,012 of the 1,053 routines a keyword names are eight-byte trampolines |
| OrgAsm 1.0 (`orgasm-1.0`) | 13 | `intuition.library`, `gadtools.library` **and** 68k execution. Every keyword is one AmigaOS call — exec `Wait`/`WaitPort`/`OpenLibrary`/`CloseLibrary`, gadtools `GT_GetIMsg`/`GT_ReplyIMsg`, intuition `ItemAddress` and `DisplayAlert` — and the two that build the interface end in `jsr (a0)`, into the GadToolsBox blob the program Bloaded into bank 8. Read in full at 1,208 bytes, which is what moved it off the list below |
| BSDSocket 1.1.4 (`bsdsocket-1.1.4`) | 30 | `bsdsocket.library` **and** a host networking boundary. The only row blocked on something outside AmigaOS |

Blocked on nothing but the work, and the binary is readable, so the evidence
is there. Int 1.0 was here and reads 100% now, and so does D-Sam 1.01; what it left behind is
`src/amiga/asl.ts`, a working `asl.library` FILE requester with every word in
it read out of `asl.library` itself. BUtility's `Baslfilereq` is approximated
over AMOS's own `Fsel$` and could move onto it. GUI 2.10's two cannot: those
are the FONT and SCREEN-MODE requesters, and the screen-mode one still has no
display database to fill itself from.

**DME 2.0 is done, and it was the largest row in this file.** Thomas Reetz's
DOOM Music Extension is fifteen music formats plus a raw-sample player:
twelve players are separate Amiga libraries it opens by name, while three
players and the sampler are inside the 46,208-byte hunk. All fifteen formats
play. The internal players, and then SoundFX 1.3, FutureComposer 1.4 and 1.3,
SoundMon 2.0, DigiBooster 1.x, ScreamTracker 3, MED, OctaMED, FastTracker 2,
TFMX, PlaySID and OctaMix, were each read from their own engine or library.

The last two are worth a line each because of what they needed. PlaySID needed
a 6502 and a SID, because a PSID file is machine code and not a pattern table;
`src/amiga/mos6502.ts` passes Klaus Dormann's functional test to the trap at
$3469. OctaMix needed no new input at all in the end --- `DME_OctaMix.library`
demands bit 7 of `flags2` at $212e64 and nothing in the corpus or `fixtures/`
has it, so the port was written from the disassembly alone and `Omix Play` is
the one keyword in this port whose engine has never been run against a module
anyone wrote. `src/coverage/status.ts` says so in its own note rather than
letting the 100% imply otherwise.

**IntuiExtend 1.6 is done too, and it turned out to be mostly the same
library.** The row's old note said the two builds "share only 45 names of
294", which was the count that share a name AND a routine number. 284 of the
294 names are in 2.01b's table as well. The tables were renumbered and the
code very largely was not: each of those 284 routines was compared
instruction by instruction in both binaries and 233 came out the same, 213 of
them byte for byte. So the port binds to both identities, and
`src/runtime/intuiextend16.ts` holds only the difference.

Ten names are 1.6's alone. Six are spellings the author later fixed, down to
`shearch` for `search`, and each points at a routine identical in both
builds. Four are keywords 2.01b dropped, and three of those four deserved it:
`Iff Make Palette` hands iff.library a colour count where GetColorTable wants
the address to write the palette to, `Wb Menu Text` is a name sitting on
`Iff Get Error`'s routine with a five-argument spec the routine never pops,
and `Wb 3d Sort` is six bytes that pop two arguments and return, which is why
the author's own `3dSort.asc` sorts its faces in BASIC.

The 3D object format changed between the builds and nothing warns a program.
1.6 objects have no `IE3D` stamp, count their points from zero, and take
`Wb 3d Edge`'s two `To` arguments in the opposite order, while the token spec
stayed `I0,0,0t0,0` in both. `Wb 3d Clear Object` is a real keyword here that
zeroes an object's body; in 2.01b the name points at the routine that frees
it.

Two of 2.01b's defects are regressions this build does not have.
`Wb 3d Move Object` is byte-identical in both and correct here, because the
`move.w (a0)+` that reads a point count in 1.6 reads the high word of the
magic in 2.01b. And `Wb Swatch`'s divisor list is a real ten-entry table at
workspace+$198, which 1.6 points at and 2.01b does not: that is how the
2.01b note now knows the pointer was right once and moved.

**IntuiExtend 2.01b is done, and at 301 keywords it is the largest row this
file has ever lost.** DME 2.0 held that at 184.
CIERP Philippe's 301 keywords are the widest Intuition and AmigaOS reach any
third-party AMOS extension has outside OS DevKit: screens, windows, gadgets,
menus, IDCMP, requesters through `reqtools.library`, pictures through
`iff.library`, `trackdisk.device`, PowerPacker, a 3D transform and a fixed-
point maths block. There is no source for it and none was needed; the whole
23,084-byte hunk reads, and the workspace every keyword reaches through
`$258(a5)` is static data inside it, so the shipped NewScreen, NewWindow and
every table the library owns are in the file.

Two of the seven library groups answer nothing, and that is the port being
honest rather than incomplete. `workbench.library` and `icon.library` are not
in `src/amiga/exec.ts`'s map, so `OpenLibrary` returns 0 and the five
AppWindow and icon keywords take the failure arm they were written to take on
a 1.3 machine. GameSupport's `Gsiconify` reached the same wall on the same two
libraries and made the same choice.

What the reading turned up along the way is in `src/coverage/status.ts` and in
the port's own comments: `Wb Set Colour` hands SetRGB4's five arguments to
LoadRGB4 and can never set a colour, `Wb Get Wbicon` unbalances its stack so a
machine without `icon.library` does not return from it, `Wb Itext` allocates
one byte where it wanted twenty and then branches past the code that fills it
in, and `Wb Swatch` reads its divisor table out of the buffer it writes its
answer into. That last one has never gone wrong, and the note says why.

## Not applicable

Fifty keywords, listed in `KEYWORDS.md` under "Not applicable, by what would
retire it", grouped by the capability each one is waiting on.

The grouping used to be here, in prose, where nothing could check it against
the set it described. It is data in `src/coverage/status.ts` now, and
`coverage.test.ts` requires every n/a keyword to have a group and every group
to have members. A group emptying out means a capability arrived.

None of them is a gap. Each is a decision this port made: it does not execute
68k, it has no debugger to trap into, no hardware below the modelled layer, no
second task and no native compiler overlay. A few editor-table entries are
markers or commands rather than runnable language constructs. Reverse one of
those decisions and a whole group changes classification at once, which is why
they are worth watching as groups rather than as fifty separate lines.

## Implemented but approximated — the honesty list

These fall into two kinds, and the difference is the whole point of the list.
Some are **closable** — nobody has done the work yet. The rest **will not
close** on this platform, because the thing being approximated is a piece of
Amiga hardware or host machinery that does not exist here. Calling both
"approximated" without saying which is how a list like this quietly becomes
furniture.

### Closable — nobody has done the work yet

- `ldisk font` — reports whether the named font exists in the mounted `Fonts:`
  drawer, which is what the keyword is for, but cannot distinguish "already in
  memory" from "not on the disk": both answer false.

- `ldev first`/`ldev next` — walk the mounted volumes and the assigns and
  return the names, but the block of device information the real call writes
  to `ADR` (device type, unit number, handler name) is not modelled, so the
  address argument is accepted and ignored.

- `ovloadimage24`/`ovloadiff24`, `ovsavejpeg24` — the IFF half is exact and
  the JPEG half is conformant but not byte-identical: the forward DCT is this
  port's own float transform where the library uses IJG's integer one, and the
  decoder replicates chrominance where libjpeg filters it, which can put a
  4:2:0 picture about ten levels off what an Amiga would show.

- `ovappendcopper24` — the v4.3 routine has now been read: it appends a small
  hardware copper tail to each of twelve caller-owned lists. The port retains
  which lists are attached, but does not execute or rewrite Amiga copper
  instructions because that display is not composited here.

- `ovsetsprite24` — the v4.3 validation and state are reproduced, but the
  Amiga sprite itself is not composited into the OpalVision display.

### Will not close — the deviation is structural

**There is no address space.** `peek`/`poke`/`start`/`screen base` work
against banks and bitplanes mapped into a fake one. `td advanced` hands back
an Amiga address — `a4` itself for object zero, otherwise the instance
pointer — and there is nowhere here for one to mean anything, so it answers
zero.

**There is no AmigaOS.** `Doscall`/`Execall`/`Lib Open`/ARexx reach ROM and
libraries. `request on`/`off`/`wb` suppress system requesters the port never
shows. `lfreq` calls `req.library`, which the manual itself apologises for;
AMOS's own `Fsel$` stands in and returns the same thing. `Edit` and `Direct`
are implemented by the composed editor/runtime and expose their original exit
codes when a headless Runtime has no editor attached.

**No machine is attached to the ports.** `serial base`/`error`/`status`,
`printer base`/`error`/`online` and `parallel base`/`error`/`input$` report
the state of a port with nothing plugged into it — `printer online` returns
"not online", `serial status` reads every modem control line low, a timed read
finds no data and times out. The source distinguishes these states (its
failure path is `moveq #-1,d3`), so a real cable would show through; the
answers here are the true ones for a bare port. `key speed` is host-generated
key repeat. `get disc fonts` with no `Fonts:` drawer mounted reports what that
machine has on disc, which is a property of the machine, not of AMOS — mount
one and the real path runs.

**There is no scheduler and no allocator.** `multi no`/`multi yes` and `amos
pri` record a task priority — the binary's `SetTaskPri(FindTask(NULL), 20)` is
reproduced exactly — but nothing schedules against it. `chip free`/`fast
free`/`free` and `llargest free` respond to what the program actually
allocates, but the pool sizes are our choice and no figure can reflect genuine
fragmentation. `lcat blocks` reports `ceil(size / 512)` where the real routine
hands back the filesystem's own `fib_NumBlocks`.

**Some hardware is computed rather than reproduced.** The result is right; the
bit-level mechanism is not, and a program watching the mechanism would see the
difference.

- `td redraw` — the model is the engine's, the rasteriser is ours. Everything
  down to the last polygon is reproduced: the transform chain, the camera, the
  `.3DS` surfaces and the dither pair each block is drawn in. But the engine
  draws by handing the blitter one EOR line per edge in line mode and then
  running an area fill over the mask, and there is no blitter here. The same
  shapes are computed directly — a scanline fill, even-odd, edges half-open at
  the bottom — so what lands on the screen is the right polygons in the right
  pens but not guaranteed to be the same bits. A long, shallow edge can sit a
  column either side of where a Bresenham line would have put it, and the
  phase of the two-pen dither is a choice rather than a reading.

- `set bob` — the blitter's logic function is honoured, including the sign rule
  on the fourth argument that decides whether it is a minterm or the whole
  control word. Two things differ: the truth table is evaluated per pixel per
  plane rather than per word, so the *result* is the blitter's and the timing
  is not; and `BLTCON1`'s shift, fill and descending-mode bits are ignored,
  since `Set Bob` only ever supplies `BLTCON0`.

- `vbl wait` — four instructions in the binary, busy-waiting on the low byte
  of `VHPOSR` until it equals the requested line. That is sub-frame beam
  racing, and there is no beam here to race.

- `display stars` and `blit clear` — both reproduce their routine exactly
  inside its valid range, and both routines leave that range by walking into
  memory rather than by failing. A star plotted outside the screen writes over
  whatever is there; `Blit Clear` given a plane number whose low word is zero
  or negative passes its own guard with the counter negative and walks 65,536
  plane pointers. Neither is reproducible, so the star is skipped and the
  clear reports the error its in-range failure gives.

- `say` and the `Mouth *` family — the AMOS side is exact: the `~` phoneme
  form, the translator path, the range checks and the asynchronous form's
  mouth stream. The **voice** is not the Amiga's. narrator-ts ships a free
  rebuild of the formant tables, because `narrator.device`'s own are not
  redistributable, so `Say` speaks but does not sound like a real Amiga;
  supplying the original binary is that library's documented upgrade path.
  Two smaller ones: the whole utterance plays on voice 0 where the device
  allocates its own channels through `audio.device`, and the synchronous form
  does not hold the interpreter for the length of the audio.

- `ovupdatedelay24`, `ovregwait24`, `ovfreezeframe24` — three OpalVision
  keywords that wait on a raster. `UpdateDelay24` counts frames between frame
  buffer updates; `RegWait24` *"waits for register information to be updated
  ... or returns immediately if no updates are pending"*, and there is never
  anything pending here; `FreezeFrame24` needs the Scan Rate Converter module,
  an expansion card behind the card. What each one *sets* is kept and visible;
  what each one *waits for* has nothing to wait for. The frame buffer itself
  is modelled in full, so `Ovrefresh24` and `Ovdownloadframe24` are exact.

- `ovfadein24`/`ovfadeout24` — the fade is a timed palette ramp on the
  machine, taking a duration in frames, and is instant here. The endpoint is
  what is reproduced, including the routines' own refusal to touch a 15-bit
  screen.

**Some encoders are not in the AMOS source.** `ppsave`/`squash` write valid
files that an independent reference decoder reads, but the original crunchers'
encoders were never published, so byte-exact parity is unverifiable. Both
*decoders* are faithful. `med play` USED to be listed here on the same
grounds and is not one: medplayer.library is not in the AMOS source, but it is
in the corpus in three builds, and the replay is ported from the one AMOS
Professional ships with. `docs/medplayer/README.md` is the read.
`Pack`/`Spack` are the opposite and worth the
contrast: `extensions/+Compact.s` *is* in the tree, so the packer is a port
and re-packs every corpus picture byte for byte.

**The audio back end, now that it renders.** `src/amiga/mixer.ts` sums the
four voices to PCM and every replayer has been rendered and compared with an
independent player where one exists: MED and both MOD engines against ffmpeg's
libopenmpt, P61 against the same after unpacking its patterns back into a MOD.
Four things are knowingly short of that.

- **The LED filter is two one-poles at 3.3kHz.** The machine's is a two-pole
  Butterworth around an op-amp and no schematic was read, so the slope is right
  and the knee is soft. The bit that switches it is the machine's.
- **THX's synthesis answers to nothing.** No program on this machine reads the
  format. Its parser, period table, waveform generator and sequencer are each
  checked against something outside the reading that produced them
  (`thx.corpus.test.ts`); the envelopes, playlists and filter sweep are not.
- **AMCAF's row test is unread.** Six libraries share one ProTracker replay and
  they do not all decide when a row falls due the same way. Player 6.1A tests
  the speed with `beq` and the mt_ family with `bcs`; GameSupport, ptreplay and
  Music Omega have been read and agree with the mt_ default, and AMCAF's own
  replayer has never been disassembled.
- **The browser's worklet is untested.** `web/mixersink.ts` renders through
  `PaulaMixer` and feeds an AudioWorklet, and there is no browser in this repo
  to run it in. The queue policy that decides what to send, drop and trim is
  covered; the thirty-line processor is not, which is why it holds a queue and
  a cursor and no decisions. It falls back to the old buffer-source sink when
  the worklet will not start.

Smaller ones: `resource$` reads the interpreter-config messages, still a
transcription and sparse where the original is (the editor tables below −1001
are generated byte-for-byte from `+Editor_Config.s`). `load iff` decodes and
round-trips every ILBM in the corpus but is not a line-by-line port. `lpp
decrunch` deliberately keeps a validity check the manual is emphatic about not
having.

## Remaining census stoppers

Re-measure with `npx tsx src/cli/runreport.ts --all` rather than trusting the
counts below; they are a snapshot, and the point of the list is the shape.

Of 566 programs, 538 run to a stop: 240 hit the step cap, 156 block on input
and 142 end. Neither of the first two is a failure. A game running its main
loop cannot be "won" by a census, and an accessory idling on the mouse is
behaving correctly.

Of the 142 that end, 29 end on a runtime error, in 20 kinds. They sort into
three groups and only the last is ours:

- **Correct on a real Amiga too.** `bank not reserved` (3), `Next without For`
  (2) and screens the program closed before drawing on them (2). AMOS raises
  these as well.
- **Archive gaps and harness limits, the largest group.** `file not found`
  (5, all in one AGA procedure library) plus one more that stops the AMOS 3D
  demo Spunt's Village, and five TOME programs wanting `TOME_GOODIES:`
  directories and picture banks nothing here carries. D-Sam's own example is
  in this group and is not a gap at all: its first line is `Smp Open
  1,Fsel$("*.*")`, and a file requester nobody can click answers with an empty
  string, so `Could not open sample file` is the right answer to give it.
- **Undiagnosed, which is the honest tail.** `dialog syntax error` (2), `Disc
  error` (2), `Illegal function call` (2), `dialog function call error`,
  `variable expected`, `wrong number of parameters for TEST1`, `division by
  zero`, `Font not available`, and one loader read of 538,976,288 bytes that is
  plainly a length read out of the wrong place. Several are EasyLife demos,
  which is where to start.

`runreport` names the first program to hit each error, so this list can be
rebuilt rather than remembered.
