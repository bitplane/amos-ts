# What's not implemented (and what's approximated)

Every caveat here also carries a NOTES entry in `KEYWORDS.md`, which is
generated from `src/coverage/status.ts`. This is the narrative view.

**Where the port stands.** Core AMOS Professional is complete: the display
pipeline, the audio pipeline, the language, banks, files, menus, the Interface
dialog engine and the file selector are all at 100%, as are the AMOS 3D,
TURBO Plus and LDos 2.5 extensions.

Census over the 488-program corpus: **478 run to a stop.** The census also
prints "ended with nothing skipped" (83); ignore it as a coverage measure. It
counts only programs that *terminate*, and most AMOS programs are games and
demos that never do: 237 hit the step cap and 133 block waiting on input, both
correct behaviour.

The figure that matters — how many of those 478 run without hitting a single
unimplemented keyword — is **419 of 478, 88%**, up from 353 of 412 (86%) when
the corpus was 419 programs and before the two Personnal releases added 69 of
their own. `runreport --by-program` prints it, and ranks the gaps by how many
programs each blocks rather than how often it is reached. The two orders are
not the same and the difference is large: `igadget read` tops the occurrence
list at 141835 hits and blocks three programs, while `dreg` blocks
twenty-nine on sixty hits and `iscreen_open` blocks nine on eleven.

Occurrence counts below come from `runreport --all` and are statements
actually reached, so a tight loop counts thousands of times. That makes them a
measure of how hot a gap is, not how many programs it blocks — the two are
given separately where they differ.

## Not implemented — grouped, roughly by census weight

### Speech (~27k hits, mostly one talking-head demo)
`Say`, `Set Talk`, `Talk Misc/Stop`, `Mouth Read/Width/Height` — the
narrator.device formant synthesizer. A faithful reimplementation is a
research project; a modern TTS would not sound like an Amiga. Long
tail.

### Host-machine calls (~10k hits, mostly doscall)
`Doscall/Execall/Gfxcall/Intcall`, `Dreg/Areg`, `Exec`, `Call` and
machine-code procedures (68k is never executed — n/a by policy),
`Lib Open/Call/Close`, `Dev Open/Send/...` device I/O, ARexx and
`Open Port` — all classified n/a (they reach AmigaOS ROM, devices or
the ARexx system). `Varptr`/`=Array` now live in the fake address
space.

### Third-party extensions

**Done, and faithful.** AMOS 3D (64), TURBO Plus (153 across 1.0/1.9/2.15),
LDos 2.5 (77) and Compact (3). Only Compact ships source — `extensions/+Compact.s`
is in the AMOS tree. The other three were reverse-engineered from the shipped
binaries, so their evidence tier is disassembly rather than source — which
`docs/extensions/README.md` ranks alongside source, and which is what earlier
versions of this file got wrong when they called every token-table-only
extension "structural by definition". The token table is not the only thing a
shipped library tells you.

**Registered and detokenising, not implemented** — these programs list and load
with real keyword names instead of `{ext12:$02d4}`, then stop at the first
extension keyword:

| extension | keywords | note |
|---|---|---|
| AMCAF 1.50 | 278 | freeware, ships an AmigaGuide manual |
| **Intuition 1.3b** | **183** | **ships assembler source; the largest remaining gap, ~17 corpus programs** |
| Craft 1.0 | 136 | commercial (Black Legend) |
| GUI 2.10 / 1.61 | 118 / 103 | |
| Range 1.0 / 2.0 | 46 / 23 | |
| AMOSPro Colours | 27 | ships its assembler source |
| AGA 1.0 | 24 | |
| Misc 1.0 | 10 | public domain, source is the whole extension |
| LDos 2.6 | 8 | the delta over 2.5 |

`docs/extensions/README.md` explains the slot model and how an extension is
identified by fingerprint when slots collide.

**A caveat on those percentages.** Coverage is counted by keyword NAME, and
several extensions share names. Porting Personnal moved `p61-1.2` to 22%,
`amcaf-1.50` to 2% and `intuition-1.3b` to 1% without a line of any of them
being written — the names collide and the count cannot tell them apart. The
dispatch itself no longer has that problem: a layer that needs its own version
of a name another layer owns registers under a slot-qualified key
(`ext13:sprite col`) and the interpreter tries that first, which is how the
machine resolves it. The published table is what still over-reports.

### IOPorts extension (serial/parallel/printer — area 0%, 38 keywords)
`Serial *` (~14), `Parallel *` (~10), `Printer *` (~10). This is a stock
extension and `extensions/+IO_Ports.s` is in the source tree, so the
keyword surface — parameter checking, buffer semantics, the error paths
— is a port like any other; only the devices underneath it
(serial.device, parallel.device, printer.device) have no counterpart
here, and the host bridges that could stand in for them (Web Serial,
print dialogs) are integration work. The parallel hits in the census
(~19k) are one diagnostics accessory polling status registers.

### System / environment
Mostly done: `Run`, `Prg/Dev First$/Next$`, `System`, `Close
Workbench/Editor`, `Set Buffer`, the `Amos *` window keywords,
`Sprite Base`/`Icon Base` and the IFF ANIM `Frame *` family are all
faithful now, and `Prun` runs a second program in its own structure on a
real program stack (Prg_Push/Prg_Pull). Still missing: the
editor-integration keywords.

### Implemented but approximated — the honesty list

Everything here also carries a NOTES entry in `KEYWORDS.md`.

These fall into two kinds, and the difference matters. Some are **closable**
— nobody has done the work yet. Others **will not close** on this platform,
because the thing being approximated is a piece of Amiga hardware or host
machinery that does not exist here. Calling both "approximated" without
saying which is how a list like this quietly becomes furniture.

**Closable** (nobody has done the work yet):

- `td visible` — answers whether the last `Td Redraw` put any of the object
  on the screen. The engine's own answer comes from a culled-this-frame byte
  set by a bounding-sphere distance test made before any face is looked at
  (`$2190c8`), and that pass has not been read, so the two agree for an object
  rejected by the near limit and can differ at the far margin.

- `td surface points` — the four anchors are recorded where the engine
  records them and nothing maps a surface through them. A surface's first
  four slots are still the face's own corners; the only use of the anchors
  traced so far is `Td Surface` validating them, and what consumes them has
  not been found.

**Will not close** (the deviation is structural, not a gap):

- `td advanced` — hands back an Amiga address: `a4` itself for object zero,
  otherwise the instance pointer. There is no address space here for one to
  mean anything in, so it answers zero, for the same reason `peek` and `poke`
  do what they do.

- `td redraw` — the model is the engine's, the rasteriser is ours. Everything
  down to the last polygon is reproduced: the transform chain, the camera, the
  `.3DS` surfaces and the dither pair each block is drawn in. But the engine
  draws by handing the blitter one EOR line per edge in line mode and then
  running an area fill over the mask, and there is no blitter here. The same
  shapes are computed directly instead — a scanline fill, even-odd, edges
  half-open at the bottom — so what lands on the screen is the right polygons
  in the right pens but not guaranteed to be the same bits. A long, shallow
  edge can sit a column either side of where a Bresenham line would have put
  it, and the phase of the two-pen dither is a choice rather than a reading.

- `peek`/`poke`/`start`/`screen base` — there is no real address space, only
  banks and bitplanes mapped into a fake one.
- `set bob`'s `mask` argument — a raw blitter minterm (BLTCON0/1); a chunky
  renderer has no minterm to override. Its `planes` argument *is* honoured.
- `direct`/`edit`/`lprint` — no editor, no direct window, no printer device.
- `request on`/`off`/`wb` — the port never shows AmigaOS system requesters,
  so there is nothing for the mode to suppress.
- `key speed` — key repeat is generated by the host, not by us.
- `get disc fonts` with no `Fonts:` drawer mounted — what a machine has on
  disc is a property of that machine, not of AMOS; mount one and the real
  path runs.
- `chip free`/`fast free`/`free` — now respond to what the program actually
  allocates, but the pool sizes are our choice, not a real machine's.
- `ppsave`/`squash` — the original crunchers' encoders are not in the AMOS
  source, so byte-exact parity is unverifiable. Both decoders are faithful.
  (`Pack`/`Spack` are the opposite case: `extensions/+Compact.s` is in the
  tree, so the packer is a port and re-packs every corpus picture byte for
  byte.)
- `med play` — medplayer.library is not in the AMOS source either.
- Speech, IOPorts, `Doscall`/`Execall`/`Lib Open`/ARexx — host and ROM.

## Remaining census stoppers

- `blocked` (91): programs waiting on input or the mouse forever — mostly
  accessories and demos idling in event loops. Correct behaviour.
- `maxSteps` (220): games and demos that run their main loop happily until the
  step cap. The census can't "win" a game.
- errors (7): `bank not reserved` (2), `Next without For` (2), screens the
  program itself closed before drawing on them (2) — all of which error on
  real AMOS too — and one missing object file, `tinycube.3DO`, which is not in
  any archive found so far (it blocks the AMOS 3D demo Spunt's Village).
