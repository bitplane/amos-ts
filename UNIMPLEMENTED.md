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
port has started: forty-nine extension releases read 100% in `KEYWORDS.md`,
among them AMCAF 1.40/1.50, the JD family, TOME, TURBO Plus, Personnal, LDos,
AMOS 3D, PowerBobs, MED 7.1, EME 3.0 and P61.

**Nothing is partially ported.** Of the ninety-odd rows in the manifest, none
sits between 0% and 100%: an extension is finished or it has not been begun.
That is the ratchet working, and it is the number to watch — a row appearing
in the middle means a thread was left hanging.

3244 keywords are implemented, 3137 of them faithful.

### The census

`npx tsx src/cli/runreport.ts --all` runs all 497 corpus programs headless.
**479 run to a stop, and 431 of those — 90% — do it without hitting a single
unimplemented keyword.** That second figure is the coverage measure.

The tool also prints "ended with nothing skipped" (83). Ignore it: it counts
only programs that *terminate*, and most AMOS programs are games and demos
that never do. Of the 479, 235 hit the step cap and 139 block waiting on
input — both correct behaviour, not failure.

`--by-program` ranks the remaining 50 by how many programs each gap blocks,
rather than by how often it is reached. The two orders are not the same and
the difference is large: `igadget read` tops the occurrence list at 141,835
hits and blocks three programs, while `dreg` blocks twenty-nine on sixty hits
and `iscreen_open` blocks nine on eleven. Occurrence counts are a measure of
how hot a gap is, never of how much it costs.

Those rows overlap and must not be summed. Partitioned, the 50 are **38 with
no extension keyword involved at all** — almost entirely the n/a host and 68k
escapes below — and **12 that are one extension's own test suite**, which the
next section takes apart.

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
extension keyword:

| extension | keywords | note |
|---|---|---|
| AMCAF 1.50 | 278 | freeware, ships an AmigaGuide manual |
| Intuition 1.3b | 183 | ships assembler source; needs `intuition.library` first |
| Craft 1.0 | 136 | commercial (Black Legend) |
| GUI 2.10 / 1.61 | 118 / 103 | |
| Range 1.0 / 2.0 | 46 / 23 | |
| AMOSPro Colours | 27 | ships its assembler source |
| AGA 1.0 | 24 | |
| Misc 1.0 | 10 | public domain, source is the whole extension |
| LDos 2.6 | 8 | the delta over 2.5 |

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

- **step cap (233)**: games and demos running their main loop happily until
  the cap. The census cannot "win" a game.
- **blocked (139)**: waiting on input or the mouse forever — accessories and
  demos idling in event loops. Correct behaviour.
- **errors (6 kinds, 10 programs)**: `bank not reserved` (2), `Next without
  For` (2) and screens the program closed before drawing on them (2) all error
  on real AMOS too. So does the last one, `Blit Clear` given a screen address
  where a plane number belongs — the range check is the library's, read out of
  routine 48, and TURBO rejects it too. `file not found` (2) and one `Object
  file not found` are archive gaps: `tinycube.3DO` is in no archive found so
  far, which is what stops the AMOS 3D demo Spunt's Village.

`runreport` names the first program to hit each error, so this list can be
rebuilt rather than remembered.
