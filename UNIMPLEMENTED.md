# What's not implemented (and what's approximated)

Status after the audio completion pass (Paula-shaped voice layer, the
music bank player, the MOD tracker, the wavetable synth, the MED
player). Census over the 393-program corpus: **380 run to a stop, 100
end cleanly, 60 finish with nothing skipped.** Occurrence counts come
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
`Varptr`, `Lib Open/Call/Close`, `Dev *` device I/O. The library-call
keywords are classified n/a (they jump into AmigaOS ROM); `Varptr`
could join the fake address space.

### IOPorts extension (serial/parallel/printer — area 0%, 38 keywords)
`Serial *` (~14), `Parallel *` (~10), `Printer *` (~10). Host bridges
(Web Serial / print dialogs) — integration work, not 68k porting.
The parallel hits in the census (~19k) are one diagnostics accessory
polling status registers.

### System / environment (area 10%)
`Amos To Front/Back`, `Amos Here/Lock/Unlock` (window-system
integration), ARexx (6 keywords — host bridge), `Run`, `Prg First$/
Next$`, `Dev First$/Next$`, `Port`, `System`, `Close Workbench`,
`Set Buffer`, `Set Accessory`, `Set Tempras`, `Frame Load/Length`
(IFF ANIM playback), `Sprite Base`/`Icon Base` (addresses inside the
object banks — needs the banks mapped into the fake address space).

### Files: random access records
`Field`, `Open Random`, `Get #`/`Put #` (record I/O), `Open Port`.
Sequential channels, Dir$ and the VFS all work.

### Compact
`Pack`/`Spack` (screen compaction — `Unpack` of existing banks works;
the encoders are unwritten). `Squash`/`Unsquash` and PowerPacker are
done and verified.

### Misc language stragglers
`Read Text`, `Amal n,#` bank programs and their `Amplay` speed
setter (the AMAL/Anim/Move string forms all work).

## Implemented but approximated — the honesty list

Everything here also carries a NOTES entry in `KEYWORDS.md`.

- **Fsel$** runs the real resource-bank dialog, but Store and keyboard
  qualifiers are unhandled; edit fields use a simplified line editor.
- **Dialog engine**: MZ (raw-memory strings) returns "", CA (machine
  code) errors, SM (screen drag) is a no-op; `=Array` passes a handle,
  not a real address.
- **Med Play** reimplements the public MMD0/MMD1 format — the replay
  lived in medplayer.library, which is not in the AMOS source;
  synthsounds are silent and CIA timing is vbl-granular.
- **The players** start note triggers immediately instead of after
  the one-vbl DMA latch gap; a 2-byte repeat region plays silence.
- **Request On/Off/Wb** store the mode; no system requesters exist in
  the port.
- **Fonts**: one Topaz face; `Get Disc Fonts` reports the ROM list.
- **Rnd** mixes a deterministic statement-paced pseudo-beam instead of
  the free-running raster (runs reproduce); `Rnd(-n)` is the pure
  generator exactly as on the Amiga.
- **Sprite priority** is per-pair (PF2P) but global rather than
  per-screen; computed sprites approximate as the last pair. Hardware
  sprites ignore the 4-per-scanline DMA limit (a superset).
- **Copper Off** interprets COLOR/BPLxPT/BPLCON0/DMACON/DIWSTRT from
  user lists; DDF/modulos/BPLCON1-2/sprite pointers are parsed but
  ignored, and registers reset each frame rather than persisting.
- **Screen Base** maps a read-only synthesized control block; pokes
  into it are ignored.
- **Dual playfield** renders under the system copper only, one pair at
  a time.
- **FFP trig** matches mathtrans to ~24 bits, not necessarily the last
  bit.
- **Ppsave/Squash** write valid files but not byte-identical to the
  original crunchers' choices (the decoders are verified faithful).
- **Load** treats the sprite/icon append flag as overwrite; `Bload` of
  a small bank number creates a bank instead of erroring.
- **Edit/Direct** stop the program (there is no editor to return to);
  `Lprint` and printer/serial hosts are absent.
- Only tokenized `.AMOS` sources run — compiled AMOS executables are
  out of scope.

## Remaining census stoppers

- `blocked` (78): programs waiting on input/mouse forever — mostly
  accessories and demos that idle in event loops (correct behaviour).
- `maxSteps` (200): games and demos that run their main loop happily
  until the step cap — the census can't "win" a game.
- errors (13): missing data files for `Load` (fixtures don't ship
  every disc), `function call error` (4), `bank not reserved`
  follow-ons (4), and `Type mismatch` (2) in programs that error on
  real AMOS too.
