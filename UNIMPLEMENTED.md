# What's not implemented (and what's approximated)

This is the narrative view. The authoritative, per-keyword list is
`KEYWORDS.md`, generated from `src/coverage/status.ts`: a keyword marked
**approximated** there carries a note saying exactly how it differs, and a few
marked **faithful** carry one too, where the behaviour is right but the
mechanism underneath it is not. Everything described below is one of those.

## Where the port stands

Core AMOS Professional is complete — the display pipeline, the audio pipeline,
the language, banks, files, menus, the Interface dialog engine and the file
selector are all at 100%. So is every extension a stock installation ships
(Music, Compact, Request, Compiler, IOPorts) and every third-party one the
port has started: fifty-five extension releases read 100% in `KEYWORDS.md`,
among them AMCAF 1.40/1.50, the JD family, EasyLife, TOME, TURBO Plus,
Personnal, LDos, AMOS 3D, PowerBobs, MED 7.1, EME 3.0 and P61.

**Nothing is partially ported.** Of the ninety-odd rows in the manifest, none
sits between 0% and 100%: an extension is finished or it has not been begun.
That is the ratchet working, and it is the number to watch — a row appearing
in the middle means a thread was left hanging.

3874 keywords are implemented, 3765 of them faithful.

### The census

`npx tsx src/cli/runreport.ts --all` runs all 513 corpus programs headless.
**489 run to a stop, and 440 of those — 90% — do it without hitting a single
unimplemented keyword.** That second figure is the coverage measure.

The tool also prints "ended with nothing skipped" (90). Ignore it: it counts
only programs that *terminate*, and most AMOS programs are games and demos
that never do. Of the 489, 235 hit the step cap and 141 block waiting on
input — both correct behaviour, not failure.

`--by-program` ranks the remaining 49 by how many programs each gap blocks,
rather than by how often it is reached. The two orders are not the same and
the difference is large: `igadget read` tops the occurrence list at 141,835
hits and blocks three programs, while `dreg` blocks thirty on sixty-one hits
and `iscreen_open` blocks nine on eleven. Occurrence counts are a measure of
how hot a gap is, never of how much it costs.

Those rows overlap and must not be summed. Partitioned, the 49 are **36 with
no extension keyword involved at all** — almost entirely the n/a host and 68k
escapes below — and **13 that are an extension's own bundled programs**
(Intuition 1.3b's test suite and OS DevKit 1.61's `os_help`), which the next
section takes apart.

## Not implemented

### Host-machine calls (~10k hits, mostly doscall)

`Doscall/Execall/Gfxcall/Intcall`, `Dreg/Areg`, `Exec`, `Call` and
machine-code procedures, `Lib Open/Call/Close`, `Dev Open/Send/...` device
I/O, ARexx and `Open Port` — all classified n/a, because they reach AmigaOS
ROM, devices or the ARexx system. 68k machine code is never executed here,
which is a policy rather than a gap: reading and disassembling it is how much
of the extension work was done.

Between them `dreg` (29 programs) and `doscall` (14) are the two widest gaps
in the census, and neither is closable.

### Third-party extensions

**Registered and detokenising, not implemented.** These programs list and load
with real keyword names instead of `{ext12:$02d4}`, then stop at the first
extension keyword. The count is keywords with no handler at all:

| extension | missing | note |
|---|---|---|
| OS DevKit 1.61 | 1047 | a wrapper over most of AmigaOS; needs the back-end, not the list |
| GUI 2.10 / 1.61 / 1.5b | 204 / 103 / 48 | `intuition.library` |
| Intuition 1.3b | 183 | needs `intuition.library` first |
| Craft 1.0 | 136 | commercial (Black Legend) |
| The Game 0.9 | 103 | |
| Opal 1.1 | 78 | OpalVision hardware |
| D-SAM 1.01 | 50 | |
| Delta 1.6 / 1.4 | 46 / 26 | `intuition.library` |
| Tools 1.01 | 33 | |
| jd-int 1.3 | 33 | `intuition.library` — findings banked |
| BSDSocket 1.1.4 | 30 | sockets |
| LSerial 2.1 | 15 | |
| BUtility 1.21 | 15 | reqtools / asl |

**GameSupport 1.2 came off this table, and it is worth saying what it cost.**
All 37 read 100% and all 37 are faithful. Three of its five groups turned out
to be a shim over `GSDrivers/` modules their author described in the future
tense and never released — the Sega-pad driver behind `Gscontrollertype` and
`Gsreadsega`, and the whole chunky-to-planar block — and for those the
library-absent arm is not a stub but what every real machine ran. One keyword,
`Gscallmod`, is `jsr` into 68k code and waits on an interpreter this port does
not have; it is the only structural deviation in the extension. `Gsiconify`
waits on `workbench.library`'s AppIcon half and a blocking `WaitPort`, and
answers 1 — the routine's own error result — until then. Everything else is
data, and is done.

**SLN 2.0 came off this table too.** All 70 read 100% --- 68 faithful, one
approximated and one n/a --- and it was the cheapest large row on the board
for the reason the table said: `sln_extII.s` is the author's own assembler
source and, unlike `GameSupport.s`, it is the whole extension. What it cost
was not archaeology but arithmetic. **Fourteen defects shipped in it**, every
one confirmed in the binary before it was reproduced, and they are the reason
this row took as long as it did: `S Mouse Button` reads the floppy
disk-change line where it meant the fire button, so it can never report a
press; `S Ainit`'s free reads array ZERO's address with array N's size, so
re-initialising one array hands another's memory back; the two-dimensional
bound check compares Y against the X limit and never checks X at all; `S
Aclear` counts bytes and writes longwords; `S Aerase` re-allocates a one-byte
array instead of erasing; `S Delete` decides file-versus-directory on a stale
register four bytes past the AMOS string; `S Disk State` answers -2 for an
empty drive where its own comment promises 0; and every trackdisk error is
reported as the message below the right one. The one structural gap is
`S Iinit`, whose eight VBL hooks are 68k machine code --- the table is kept
exactly and nothing is ever entered. `S Mask$` is n/a because the author says
so on the line itself: *"This command is non-existent!!! DO NOT USE."*

Two things landed outside the extension. `AmigaFS.volume` and
`AdfVolume.image`/`invalidate` open a raw path past the filesystem, because
`S Disk Read` is `trackdisk.device` CMD_READ at a byte offset and an ADF *is*
the sector image it wants --- so a mounted disk is served byte for byte and
`S Disk Rename` really does rewrite the root block. And `Protracker` gained
`trigVolPercent`, the percentage SLN's replayer applies at the instrument
trigger and nowhere else.

**Make Lib 1.30 came off this table as well**, and it is the small row that
paid for something larger. All 32 read 100% and all 32 are faithful. Its
anonymous author wrote it because *"AMOSPro is missing usable memory
allocation routines and it doesn't have any routines to handle lists and nodes
at all"*, so it is `AllocMem`, `AllocVec`, a `malloc` with its own free-all,
eight of exec's list routines, a C-shaped `stdio` over `dos.library`, and
three graphics keywords belonging to neither. The manual documents every
keyword, which makes it one of the few rows where the binary and its own
description can be read against each other line by line — and they disagree
four times, the binary winning each time. `Ma Fopen`'s third mode is not `"a"`
but *every character that is not R or W*, empty strings included. `Ma Fread`,
`Ma Fwrite` and `Ma Fseek` each branch past the instruction that would have
written their result when the file handle is zero, so all three hand back
their own last argument: a write that never happened reports every byte sent.
`Ma Point` is not AMOS's `Point` — no clip window, and it walks `EcCurrent`
where AMOS walks `EcLogic`. And `Ma Realloc(0,n)` never writes a return value
at all. One defect is the binary's alone: `Ma Paste Icon` takes the plane
count from the SCREEN and never reads the icon's own, four bytes into the
record it has just loaded, so a one-plane icon on a four-plane screen paints
three planes of its neighbours.

What it paid for is `MemPool` in `src/amiga/exec.ts`. First-fit `AllocMem`
over one mapped buffer was written inside `sln.ts` with a note saying it would
move if a second extension ever wanted it; Make, whose whole first half is
`Ma Malloc` and exec lists, is that second extension, so it moved. Where the
pool is *mapped* stayed with the caller, because a memory region is the
caller's declaration and not exec's.

**This table has been wrong before, and the fix is to read it off
`KEYWORDS.md`.** It used to list AMCAF 1.50, Range 1.0 and 2.0, AMOSPro
Colours, AGA 1.0, Misc 1.0 and LDos 2.6 as unported when all six read 100% —
six stale rows out of nine, because the table is hand-maintained and the
manifest is generated. `KEYWORDS.md` is the source of truth; this is a
commentary on it.

**EasyLife is complete, and this document used to say otherwise.** All four
releases read 100% — 1.0 (72), 1.09 and 1.10 (156 each), 1.44 (108) — with
`iconify amos` the single approximation. The note that used to sit here called
it "part-ported, and what is left of it is the MUI block", which files a
DEPENDENCY as a gap in the dependent. EasyLife's own half of MUI is the
four-LVO trampoline and the string pool that keeps AMOS strings alive across
a taglist (`src/runtime/elmui.ts`, routines 231, 232, 238 and 241), and that
half is finished. `muimaster.library` is a separate product by another author,
installed separately, and EasyLife is built to run without it — message 23 is
`Could Not Open MUI Master Library V8+ (MUI V2.1+)`. It gets its own section
below rather than a footnote here. The iconify four came off this list when
`OpenWindow` landed, and they are the first keywords in the port to open a
real Intuition window.

Five of the sixteen rows above wait on the same thing: **`intuition.library`,
and a display path that can show a window.** That gate is now open, and the
answer turned out to be one AMOS already had. `display.ts` is a single
copper-list interpreter, so an Intuition screen has to express itself as
copper registers plus `BPLxPT` rather than as a second `Screen` — and AMOS
opens screens BASIC cannot name for exactly that reason (EcFonc 8, EcEdit 9,
EcFsel 10, EcReq 11, +Equ.s:792). The Workbench screen is one more of those,
at slot 12. `src/amiga/intuition.ts` has OpenWorkBench, CloseWorkBench,
WBenchToFront/Back, OpenWindow and CloseWindow on `src/amiga/layers.ts`,
with the system gadgets and an IDCMP port; the roughly 550 keywords those
five rows hold are now a keyword-list problem rather than a back-end one.

**Intuition's census weight is an artefact, and this document used to report
it as the largest remaining gap.** It is not. Twelve corpus programs reach an
Intuition keyword and all twelve are Intuition's own bundled test suite —
`inttest1`..`6`, `bug1`, `bug2`, `bcollin`, `intuiviewer`, `test0` — which
arrived in `fixtures/extensions/intuition-1.3b/progs/` with the extension
archive. Zero programs written to *use* it are in the corpus, and the huge
occurrence counts are those self-tests looping.

It is also the extension least able to move: its 183 keywords are windows,
gadgets, menus and requesters, so nearly all of them would land as n/a until
`intuition.library` exists in `src/amiga/`. That back-end, not the keyword
list, is the actual prerequisite — see `src/amiga/README.md`.

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
  autodoc but no binary in MUI 3.8 — manual tier only.
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
library's own author copied from another and said so. Dispatch never had the
problem — a layer needing its own version of a name another layer owns
registers under a slot-qualified key (`ext13:sprite col`), which the
interpreter tries first.

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

**Some encoders are not in the AMOS source.** `ppsave`/`squash` write valid
files that an independent reference decoder reads, but the original crunchers'
encoders were never published, so byte-exact parity is unverifiable. Both
*decoders* are faithful. `med play` is the same case — medplayer.library is
not in the source either. `Pack`/`Spack` are the opposite and worth the
contrast: `extensions/+Compact.s` *is* in the tree, so the packer is a port
and re-packs every corpus picture byte for byte.

Smaller ones: `resource$` reads the interpreter-config messages, still a
transcription and sparse where the original is (the editor tables below −1001
are generated byte-for-byte from `+Editor_Config.s`). `load iff` decodes and
round-trips every ILBM in the corpus but is not a line-by-line port. `lpp
decrunch` deliberately keeps a validity check the manual is emphatic about not
having.

## Remaining census stoppers

Of the 488 programs, 478 reach a stop. Where the other work goes:

- **step cap (235)**: games and demos running their main loop happily until
  the cap. The census cannot "win" a game.
- **blocked (141)**: waiting on input or the mouse forever — accessories and
  demos idling in event loops. Correct behaviour.
- **errors (16 kinds, 24 programs)**: `bank not reserved` (3), `Next without
  For` (2) and screens the program closed before drawing on them (2) all error
  on real AMOS too. Archive gaps are the largest group: one `Object file not
  found` (`tinycube.3DO` is in no archive found so far, which is what stops the
  AMOS 3D demo Spunt's Village), `file not found` (3, all EasyLife demos) and
  four TOME programs asking for `TOME_GOODIES:` directories and a
  `levels/level1.map` that no archive here carries.
- The remaining nine programs are **undiagnosed**, and are the honest tail of
  this list rather than a verdict: `dialog syntax error` (2), `Disc error` (2),
  `dialog function call error`, `variable expected`, `wrong number of
  parameters for TEST1`, `Illegal function call` and `music bank not found`.
  Five of the nine are EasyLife demos, which is where to start.

`runreport` names the first program to hit each error, so this list can be
rebuilt rather than remembered.
