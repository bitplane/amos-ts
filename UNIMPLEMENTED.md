# What's not implemented (and what's approximated)

Status after the integration pass (Varptr/=Array variable arena,
Sprite Base/Icon Base bank memory, Run program chaining, random-
access records, IFF ANIM frames, the environment cluster), following
the audio pass and the faithfulness sweep. Census over the
405-program corpus: **397 run to a stop, 73 finish with nothing
skipped** (95 end, more now running their real event loops instead
of bailing at skipped keywords). Occurrence counts come
from `runreport --all` (statements actually reached, so a tight loop
counts thousands of times). Per-keyword detail lives in `KEYWORDS.md`
(generated); this is the narrative view.

The display pipeline is considered done: screens, drawing, palette,
rainbows, copper (system-generated AND user lists), menus, windows,
zones, dual playfield, HAM/EHB, hardware/STOS animation are all at
100%. The audio pipeline is now done too: the three players (music
bank, MOD tracker, MED) and the wavetable synth are ported from
+Music.s over the AudioSink, with the faithful read-and-clear
Vumeter, voice stealing/reclaim, Sam Swap double-buffering and the
LED filter. Every remaining caveat is NOTES'd in `KEYWORDS.md`; a
WebAudio sink renders it in the browser (per-tick control is
best-effort there).

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

### Third-party extensions (~620 keywords, all 0%)

Registered and detokenising, none implemented: Intuition 1.3b (183),
TURBO Plus (134), Personnal 1.0b (110), GUI 1.61 (103), LDos 2.5 (77),
Misc 1.0 (12). The token tables are ground truth and slot
identification is automatic, so these programs now list and load with
real keyword names instead of `{ext12:$02d4}` — they just stop at the
first extension keyword. `docs/extensions/README.md` explains the
identification model and the evidence tiers that decide which of these
can ever be marked faithful: Intuition, Personnal **and Misc** all ship
assembler source (Misc's `Misc_Extension.asm` is the whole extension,
public domain), so all three can reach faithful; LDos, TURBO Plus and
GUI are token-table-only, so keywords ported from them are structural by
definition.

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

- `td priority` — the value is recorded where the engine records it, in the
  object's render record at `+$42`, and nothing reads it. `$42` is written
  all over the `$215xxx` render code but no read of it as a sort key has
  turned up yet, so the draw order it is supposed to feed is not modelled and
  setting a priority changes no output.

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

**Closable, just not done**: nothing. The list is empty — `fsel$` was the
last entry, and the full `Start_FSel` port closed it.

Everything on this list has closed. Two of them closed by finding the
data rather than approximating it better: `Border$`'s box glyphs and
`Set Pattern`'s system patterns are in the source tree after all, as
`bin/+WFont.bin` and `bin/+AMOSPro_Mouse.abk` — linked into the interpreter
binary rather than loaded as files, which is why they did not look like
files. Both are baked in and exact now. `Resource$`'s editor message tables
were the same story: `+Editor_Config.s` declares them, so they are generated
rather than transcribed.

- **Fsel$** is the full `Start_FSel` port: config-sized screen, incremental
  directory read, the Sizes column, all twenty zones, the Store directory
  cache, Help-key type-ahead and the AppCentre slide. What remains is
  structural — the 68k reads the directory in a background task where the
  port reads one entry per frame on the one thread, and the low-memory
  selector has no memory cliff to fall off here.
- **Dialog engine**: MZ (raw-memory strings) returns "", CA (machine
  code) errors, SM (screen drag) is a no-op; `=Array` of a STRING
  array passes a handle (int/float arrays map to real arena blocks).
- **Med Play** reimplements the public MMD0/MMD1 format — the replay
  lived in medplayer.library, which is not in the AMOS source;
  synthsounds are silent and CIA timing is vbl-granular.
- **The players** model the one-vbl repeat latch (the trigger plays the
  whole sample, the repeat pointers arrive next interrupt). The
  ~5-scanline DMA-off/DMA-on wait inside a single frame is sub-frame
  timing a vbl-granular player cannot express.
- **Request On/Off/Wb** store the mode; no system requesters exist in
  the port.
- **Fonts**: real Amiga diskfonts render when a `Fonts:` drawer is
  mounted (`.font` descriptor plus the per-size glyph files); without
  one, the stock Workbench font list is reported (rom/disc masks per
  Get Fonts variant) and the built-in 8x8 face stands in. `Get Disc
  Fonts` on a machine with no drawer mounted has nothing faithful to
  report — the answer is a property of that machine, not of AMOS.
  Codes 0-31 and 128-159, `Border$`'s box glyphs among them, are exact:
  they come from bin/+WFont.bin, which AMOS pokes over the ROM font.
- **Rnd** mixes a deterministic statement-paced pseudo-beam instead of
  the free-running raster (runs reproduce); `Rnd(-n)` is the pure
  generator exactly as on the Amiga.
- **Sprite priority** is per-screen (EcCon2) and computed sprites (8+)
  go through the real multiplexer's channel allocator (HsAff). PF1P and
  PF2P are both live: they are positions in one interleaved stack of
  four sprite pairs and up to two playfields, drawn a scanline at a
  time, so a sprite can sit between the halves of a dual pair.
  Remaining: a sprite wide enough to span several channels draws at the
  priority of the first, and hardware sprites ignore the 4-per-scanline
  DMA limit (a superset).
- **Copper Off** takes its fetch geometry from the registers now: the
  bitplane pointer is walked as a byte pointer (so a mid-row address
  shears the picture), BPL1MOD joins the lines, DDF sets the width and
  where the data lands, BPLCON1 scrolls, DIW windows it, BPLCON2 orders
  the sprites and SPRxPT are decoded as real sprite structures.
  BPL2MOD is tracked but has no independent even-plane pointer to move
  in a chunky screen, so it only matters for a dual playfield — which
  this path still does not render.
- **Screen Base** maps a read-only synthesized control block; pokes
  into it are ignored.
- **Dual playfield** pairs are per-screen (EcDual), so several coexist
  down the display; they render under the system copper walk, so a
  Copper Off user list shows only the front playfield.
- **FFP trig** matches mathtrans to ~24 bits, not necessarily the last
  bit.
- **Ppsave/Squash** write valid files but not byte-identical to the
  original crunchers' choices (the decoders are verified faithful).
- **Edit/Direct** stop the program (there is no editor to return to);
  `Lprint` and printer/serial hosts are absent.
- Only tokenized `.AMOS` sources run — compiled AMOS executables are
  out of scope.

## Remaining census stoppers

- `blocked` (85): programs waiting on input/mouse forever — mostly
  accessories and demos that idle in event loops (correct behaviour).
- `maxSteps` (215): games and demos that run their main loop happily
  until the step cap — the census can't "win" a game.
- errors (8): `bank not reserved` follow-ons (4), `Next without For`
  (2) and screens the program itself closed before drawing on them
  (2) — programs that error on real AMOS too.
