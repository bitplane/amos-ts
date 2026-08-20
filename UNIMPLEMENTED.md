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

### The census

The figures live in `README.md`, beside the command that produces them, and
are deliberately not repeated here. Two copies is how this file came to say
513 programs while README said the same thing differently and the truth was
565.

What belongs here is the part README does not carry: what the programs that
stop are stopping on. That is the section at the end.

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

### Third-party extensions

These are registered and detokenising but not implemented, so a program lists
and loads with real keyword names instead of `{ext12:$02d4}` and then stops at
the first extension keyword. The count is keywords with no handler at all.

Eleven rows read 0%, and they divide by what is in the way rather than by
size. One more row is listed with them and does NOT read 0%: DME 2.0 is
part-done, and it stays here until every one of its keywords lands.
`src/coverage/coverage.test.ts` checks both directions — every 0% row is
named, and no row is named that is FINISHED — so a ported extension cannot
quietly stay on the list and a half-built one cannot quietly leave it.

Blocked on a back-end nothing here models:

| extension | missing | what it is waiting on |
|---|---|---|
| OS DevKit 1.61 (`os-devkit-1.61`) | 1047 | a wrapper over most of AmigaOS. It needs the back-end, not the list. `gadtools` is modelled now and `datatypes` identifies without decoding, so what is left unmodelled is `asl`, `iffparse`, `commodities`, `workbench` and `amigaguide` |
| IntuiExtend 2.01b / 1.6 (`intuiextend-2.01b`, `intuiextend-1.6`) | 301 / 294 | Intuition. 2.01b rebuilt its table, so the two share 45 names of 294 and almost none at the same id, which is why they are two rows |
| OrgAsm 1.0 (`orgasm-1.0`) | 13 | `intuition.library`, `gadtools.library` **and** 68k execution. Every keyword is one AmigaOS call — exec `Wait`/`WaitPort`/`OpenLibrary`/`CloseLibrary`, gadtools `GT_GetIMsg`/`GT_ReplyIMsg`, intuition `ItemAddress` and `DisplayAlert` — and the two that build the interface end in `jsr (a0)`, into the GadToolsBox blob the program Bloaded into bank 8. Read in full at 1,208 bytes, which is what moved it off the list below |
| BSDSocket 1.1.4 (`bsdsocket-1.1.4`) | 30 | `bsdsocket.library` **and** a host networking boundary. The only row blocked on something outside AmigaOS |

Blocked on nothing but the work. Both hold a readable binary, so the evidence
is there:

| extension | missing | evidence held |
|---|---|---|
| Int 1.0 (`int-1.0`) | 2 | UNDER WAY, at 97%. Two keywords left and each is one back-end. `Wb Asl Req` opens `asl.library` and wants a file, font and screen-mode requester with a real window; the three settings it reads, `Wb Asl Pattern`, `Wb Asl Info` and `Wb Asl Dir`, are already there and so is `Wb File`, which takes the answer back. `Wb Dt Image To Screen` wants `datatypes.library` decoding, which `../amiga/datatypes.ts` identifies without doing. Everything else landed: the drawing group over wd_RPort, the input readers off CIA-A and the gameport, the IFF loader and its two readers, `Wb Paste Icon`, `Wb Default` and `Wb Save Iff` |
| DME 2.0 (`dme-2.0`) | 33 | UNDER WAY, at 85%. Thomas Reetz's DOOM Music Extension, fifteen music formats in one library. Eleven of them are separate Amiga libraries it opens by name; four are inside the 46,208-byte hunk. **Eleven of the fifteen play.** The four internal ones, and then SoundFX 1.3, FutureComposer 1.4 and 1.3, SoundMon 2.0, DigiBooster 1.x, ScreamTracker 3, MED and OctaMED, each read out of its own library in `libs/`. Three blocks of keywords left: OctaMix (15), FastTracker (9) and PlaySID (9), and all three are below rather than here --- each is blocked on something other than the work |
| D-SAM 1.01 (`d-sam-1.01`) | 50 | disassembly. `audio.device` and `dos.library` are both modelled |

All three of DME's remaining blocks are blocked on something other than the
work, which is why none of them is simply next:

| block | missing | what it is waiting on |
|---|---|---|
| OctaMix (`omix *`) | 15 | a module. `DME_OctaMix.library` refuses anything without `FLAG2_MIX` at $2130f4, and nothing in the 45,743-file corpus has the bit --- all 187 OctaMED Professional 6 modules are MMD2 without it. The library is mapped in `src/amiga/mmd2mix.ts`'s header rather than ported, because a port would have nothing to check against but its own reading |
| FastTracker (`xm *`) | 9 | an `.xm` module. `DME_FastTracker.library` is held and readable at 26,324 bytes |
| PlaySID (`sid *`) | 9 | a 6502 and a SID. `playsid.library` turned up on Aminet in `mus/play/PlaySID3.lha` and is in `fixtures/aminet/`, so the evidence is no longer the problem; the emulation is |

And one row on its own, blocked on evidence rather than on work or a back-end:

| extension | missing | what it is waiting on |
|---|---|---|
| Intuition 1.3b (`intuition-1.3b`) | 183 | a binary. Nothing in `src/amiga` is in the way, the back-end landed. The archive is `itokens.s`, `cmdlist` and the author's twelve test programs, so this is the only row where a port has no code to read |

**The sweep's answer is that nothing else is waiting.** No registered release
shares every id it has in common with a ported one and goes unnamed, so there
is no second Delta in the registry. Nor is there one in the corpus: `libcat`
over all 502 `.Lib` files finds 28 variants of registered libraries, and every
variant carrying keywords the registered release lacks is an AMOSTools stub —
a token table with the code stripped out. The one readable exception is not a
version at all, and it is the hybrid described at the end of this section.

Getting the criterion right took the test rather than the thinking. The first
version required a candidate to be a strict SUPERSET of the bound release,
which rejects `serial-1.2` — 15 shared keywords at 15 identical ids, 23
dropped, nothing added — and `serial-1.2` is one of the three cases the check
exists to catch. What actually matters is one thing: no name the two releases
share may sit at a different id. Adding keywords is the interesting case and
dropping them is harmless, since a handler no table entry reaches never fires.

The five candidates the sweep rejects as `renumbered` are not releases either.
They are different extensions sharing one to three keyword names with
something ported — Explode's reaching CText, IntuiExtend's reaching EasyLife —
with no id in common, which is what a coincidence looks like. IntuiExtend 1.6
and 2.01b remain the counter-case the criterion has to keep refusing: 45 shared
names of 294, almost none at the same id, because 2.01b rebuilt its table.

**What the stubs would add, if a real binary ever turns up.** Four of the
AMOSTools tables are later releases of something ported: `AMOSPro_TFT.Lib-V0.7`
brings seven keywords TFT 0.6 lacks (`Init Cpu Clear Long`/`Word`, `Clear
Cache`, `Make Tangens List`, `Get Tangens`, `Init Tick Timer`, `Get Tick
Timer`), `AMOSPro_3d.Lib-V1.02AP` brings `Td Rotate`, `3d.lib-V1.50` brings
`Td Tony 5`, and the two Music 3.0 demo tables bring ten to twelve of the
tracker keywords EME 3.0 already answers. None can be read — the code is gone
and both length fields are zero — so they stay with the other stubs.

**The one readable oddity is a hybrid.** `APD426/AMOS_System/Music.Lib` is a
legacy binary of 42 entries: 39 of AMOSPro Music's, plus `Starset`, `Starstop`
and `Starplay` at ids 528, 544 and 558. They are not Stars 2.33's, which names
everything `Stars Blast`, `Stars Reset` and so on; somebody merged a starfield
routine into their copy of Music.Lib. It is a registration question rather than
a binding one, and it is queued.

### muimaster.library — surveyed, and parked behind Intuition

MUI is a GUI toolkit by Stefan Stuntz, reached from AMOS through EasyLife's
twenty `Mui` keywords. It is a product in its own right and it is scoped like
one, so it is recorded here rather than counted against EasyLife.

**What exists.** `src/amiga/muimaster.ts` is the class factory: all 65 classes
with the right parents, the 714 constants and the `isg` flags, plus OM_NEW /
SET / GET / DISPOSE / ADDMEMBER / REMMEMBER, notifications with the four
`MUIV_Notify_*` pseudo-destinations, AskMinMax sizing and the Application
input loop. A program can build a tree, set and read attributes, register
notifications and drive its main loop. What it cannot do is *see* anything.

**What was learned from the binary.** `src/cli/muidis.ts` opens
`muimaster.library` 19.35 — an ordinary hunk binary, so `../amiga/hunk`
relocates it. Its class registry is twenty-byte entries at `$237088`
(`0`, name, superclass name, dispatcher, instance size), and each dispatcher
is a `dbeq` search of a method-ID table with a parallel handler table
immediately before it. Four things came out of it that the header could not
have given:

- **Only 35 of the 65 classes are built in.** The other 30 ship as separate
  binaries in `MUI/Libs/mui/*.mui` and are loaded on demand, so they need a
  second resolution path `muidis` does not have yet. `Scrmodelist` has an
  autodoc and no binary anywhere in MUI 3.8, so it is the one class here with
  nothing to read behind the documentation.
- **The class tree corroborates `mui.h` exactly**, 0 parent mismatches. The
  binary carries one class the header never mentions: `Cclist.mui`.
- **The autodocs undercount the protocol badly.** The 35 built-in classes hold
  507 method-table entries over 123 distinct ids, and **113 of those entries
  have no name in `mui.h` at all**. A port written to the documented list
  would silently omit every one of them, and there was no way to know which
  before this.
- **`Group` and `Family` broadcast.** Both call a routine ($215b90 and
  $21876e) BEFORE handing an unrecognised method to the superclass, which is
  what makes a method sent to a group reach everything in it. Nothing else in
  the 35 does that.

**Why it is parked.** MUI sits on `intuition.library`, and Intuition is the
prerequisite for roughly 550 keywords across five other extension rows as
well. Doing MUI first would mean building its render and input path twice.
The order is Intuition, then MUI on top of it.

**The deviation to fix when it resumes.** Nothing raises message 23, so the
port claims MUI is installed and then displays nothing. No Amiga was in that
state: either MUI was installed and a GUI appeared, or it was absent and the
program got 23 and took its fallback. The current third state turns a missing
toolkit into a silent hang instead of a diagnosis, and that is the worst
outcome for the programs this port exists to run.

**The shape of the work, in order**, once Intuition is there: the
`Setup → Show → AskMinMax → Layout → Draw` spine on Area, Window and
Application (39, 39 and 47 methods); then Group, the largest class in the
library at 67 methods, which owns both the layout engine and the broadcast;
then the widgets by reachability (Text, String, Gadget, Prop, List, Listview,
Numeric, Slider, Cycle, Radio, Scrollbar, Register, the Menu family, the Pop
family); then the 30 external classes; then `asl.library`, which `Popasl`
needs and which is the only support library still missing — intuition,
graphics, diskfont and boopsi already have what MUI asks of them.

**Three things that cannot be closed** and belong with the deviations rather
than the backlog: `Mui Hook` callbacks (ADDRESS is 68k machine code and there
is no 68k here — the `Amos Call` boundary), `Wait()` (one thread that must
return to the frame loop, so the signal mask NewInput assembles from every
port's `mp_SigBit` has no counterpart), and MUI's preferences (real sizes come
from the user's chosen frames, fonts and image specs; sizes here are derived
from the system font, so nothing will be pixel-exact against a configured
MUI).

Coverage in the wild is a signal, not a target. Most AMOS programs were never
published online, so a census over what *was* published measures the archive
as much as the port.

The evidence behind the ones that *are* done varies, and it is recorded per
extension rather than assumed: Personnal, Misc, AMOSPro Colours and Personnal
EXTRA ship full assembler source, and P61 ships the whole of Player 6.1A's.
TURBO Plus and LDos 2.5 have their own manuals, with individual keywords
settled by disassembling the shipped library where the prose was thin or
wrong. AMCAF, MED, PowerBobs, TOME and EME were read out of their binaries.
AMOS 3D had neither source nor a full manual — its engine was recovered from
`c3d.lib` outright (`docs/amos3d/README.md`). Disassembly ranks alongside
source in `docs/extensions/README.md`, because a shipped binary is more
authoritative than a manual, not less.

**The percentages used to over-report, and no longer do.** Coverage is counted
by keyword NAME, and several extensions share names, so porting Personnal once
moved `p61-1.2` to 22% and `amcaf-1.50` to 2% without a line of either being
written. #226 fixed the measure: an extension is credited only for names a port
declares against its registry identity, with `viaCore` for the keywords a
library's own author copied from another and said so. The mechanism for
dispatch is the same idea — a layer needing its own version of a name another
layer owns registers under a slot-qualified key (`ext13:sprite col`), which the
interpreter tries first.

**Dispatch had a version of it too, and this used to say it did not.** Two
PORTED products settle a shared name between them, one keeping the bare key as
the default and the other qualifying. A product that is registered but NOT
ported has no `ExtensionImpl` to take either half of that deal, so its programs
got whichever ported product held the bare key — twenty names, including
seventeen of Explode 2.01's and DME 2.0's `Nop`, which is a FUNCTION there and
an instruction in AMCAF. `undeclaredLive` could not see any of it, because it
requires both sides ported. `answeredForUnported` is the other half and the
ported side now qualifies all twenty, so the bare keys are gone.

Seven more were never wrong at all and only looked it: the report asked
`impl.qualified` whether a name had been declared, and EasyLife reaches `long`,
`word`, `pp crunch` and four others through `aliases`, which produce exactly
the same `ext16:` key. It asks the dispatch table now. That also cleared
`set protect` off the knowingly-undeclared list, where it had been sitting on a
note that said aliases "cannot be qualified".

The opposite failure is the live one, and it has bitten twice: an extension
that IS implemented reporting 0% because no `ExtensionImpl` named its identity.
EME 3.0 read 17% and `serial-1.2` read 0% while every one of their keywords
ran. If a row looks impossibly low, check the `ids` before believing it.

### System / environment

Mostly done: `Run`, `Prg/Dev First$/Next$`, `System`, `Close
Workbench/Editor`, `Set Buffer`, the `Amos *` window keywords, `Sprite
Base`/`Icon Base` and the IFF ANIM `Frame *` family are all faithful, and
`Prun` runs a second program in its own structure on a real program stack
(Prg_Push/Prg_Pull). Missing: the editor-integration keywords.

## Not applicable

Fifty keywords, listed in `KEYWORDS.md` under "Not applicable, by what would
retire it", grouped by the capability each one is waiting on.

The grouping used to be here, in prose, where nothing could check it against
the set it described. It is data in `src/coverage/status.ts` now, and
`coverage.test.ts` requires every n/a keyword to have a group and every group
to have members. A group emptying out means a capability arrived.

None of them is a gap. Each is a decision this port made: it does not execute
68k, it has no debugger to trap into, no hardware below the modelled layer, no
second task, no editor and no compiler overlay. Reverse one of those and a
whole group changes classification at once, which is why they are worth
watching as groups rather than as fifty separate lines.

## Implemented but approximated — the honesty list

These fall into two kinds, and the difference is the whole point of the list.
Some are **closable** — nobody has done the work yet. The rest **will not
close** on this platform, because the thing being approximated is a piece of
Amiga hardware or host machinery that does not exist here. Calling both
"approximated" without saying which is how a list like this quietly becomes
furniture.

### Closable — nobody has done the work yet

- `td visible` — answers whether the last `Td Redraw` put any of the object on
  screen. The engine's answer comes from a culled-this-frame byte set by a
  bounding-sphere distance test made before any face is looked at
  (`$2190c8`), and that pass has not been read, so the two agree for an object
  rejected by the near limit and can differ at the far margin.

- `td surface points` — the four anchors are recorded where the engine records
  them and nothing maps a surface through them. A surface's first four slots
  are still the face's own corners; the only use of the anchors traced so far
  is `Td Surface` validating them, and what consumes them has not been found.

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

- `ovdrawline24`, `ovdrawellipse24` — the AutoDocs fix the arguments and the
  clipping and say nothing about which pixels a slope lands on, and the
  library's own two routines have not been disassembled, so these are
  Bresenham and midpoint and can differ by a pixel.

- `ovscroll24`, `ovpalettemap24`, `ovappendcopper24`, `ovsetsprite24`,
  `ovsetloadaddress24` — four routines not yet read, followed from their
  AutoDoc descriptions alone.

### Will not close — the deviation is structural

**There is no address space.** `peek`/`poke`/`start`/`screen base` work
against banks and bitplanes mapped into a fake one. `td advanced` hands back
an Amiga address — `a4` itself for object zero, otherwise the instance
pointer — and there is nowhere here for one to mean anything, so it answers
zero.

**There is no AmigaOS.** `Doscall`/`Execall`/`Lib Open`/ARexx reach ROM and
libraries. `request on`/`off`/`wb` suppress system requesters the port never
shows. `direct`/`edit` need an editor and a direct window. `lfreq` calls
`req.library`, which the manual itself apologises for; AMOS's own `Fsel$`
stands in and returns the same thing.

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

Of 565 programs, 539 run to a stop: 245 hit the step cap, 147 block on input
and 147 end. Neither of the first two is a failure. A game running its main
loop cannot be "won" by a census, and an accessory idling on the mouse is
behaving correctly.

Of the 147 that end, 27 end on a runtime error, in 18 kinds. They sort into
three groups and only the last is ours:

- **Correct on a real Amiga too.** `bank not reserved` (3), `Next without For`
  (2) and screens the program closed before drawing on them (2). AMOS raises
  these as well.
- **Archive gaps, the largest group.** One `Object file not found`, because
  `tinycube.3DO` is in no archive found so far, which is what stops the AMOS
  3D demo Spunt's Village. `file not found` (3, all EasyLife demos), and five
  TOME programs wanting `TOME_GOODIES:` directories and a `levels/level1.map`
  that nothing here carries.
- **Undiagnosed, which is the honest tail.** `dialog syntax error` (2), `Disc
  error` (2), `dialog function call error`, `variable expected`, `wrong number
  of parameters for TEST1`, `Illegal function call` (2), `division by zero`,
  `music bank not found`, and one loader read of 538,976,288 bytes that is
  plainly a length read out of the wrong place. Several are EasyLife demos,
  which is where to start.

`runreport` names the first program to hit each error, so this list can be
rebuilt rather than remembered.
