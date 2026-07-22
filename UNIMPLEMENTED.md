# What's not implemented (and what's approximated)

Status after milestone 4 (audio). Census over the 393-program corpus:
**371 run to a stop, 24 finish with nothing skipped.** Occurrence counts
below come from `runreport --all` (statements actually reached, so a
tight loop counts thousands of times).

## Not implemented — grouped, roughly by census weight

### Interface / Dialog language  (~130k hits — the biggest gap)
The AMOS "Interface" resource language: `Dialog`, `Dialog Box/Open/
Run/Close`, `VDialog`, `RDialog$`, `Choice`, `Hslider`/`Vslider`/
`Set Slider`, `Fsel$` (file selector), `Resource Bank`, `Resource
Screen Open`, `Resource$`. Like AMAL, it's a second compiled
mini-language (source in `+ILib.s`). Needed by the Productivity tools
and some game front-ends.

### Copper & direct hardware access  (~160k hits, almost all Planet Zybex)
`Cop Move/Movel/Wait/Swap/Logic`, `Copper Off`, `Logbase`, `Phybase`,
`Logic`, `Physic`, and raw memory: `Peek/Poke/Deek/Doke/Leek/Loke/
Peek$`, `Btst`, `Ror.b`, `Dreg/Areg`, `Doscall/Execall/Gfxcall`,
`Exec`. Supporting these means a decision: emulate a small slice of
chip RAM + custom registers, or accept that hardware-banging programs
stay partial.

### Music (tracker)  (~5k hits)
`Music`, `Music Off/Stop`, `Tempo`, `Mvolume`, `Voice` gating,
`Play/Play Off`, `Set Wave/Set Envel/Del Wave/Noise To`, `Track
Load/Play/Stop/Loop`, `Med *` (MED player), `Amplay`. Music banks are
converted Soundtracker modules; a proper player is a milestone of its
own.

### Speech  (~27k hits, one talking-head demo mostly)
`Say`, `Set Talk`, `Talk Misc`, `Mouth Read/Width/Height` — the Amiga
narrator.device formant synthesizer. Faithful reimplementation is a
research project; a modern TTS would not sound like an Amiga.

### Menus  (~6k hits)
`Menu$` definitions, `Set Menu`, `Menu On/Off/Key/Base/Called/Link/
Static/Inactive/Separate/Del`, `On Menu`, `Bank To Menu`/`Menu To
Bank`.

### Files & I/O channels  (~1k hits)
`Open In/Open Out/Close`, `Print #`, `Input #`, `Line Input #`,
`Input$(n)`, `Dir$`, `Sload/Ssave`. The virtual FS exists (Load/Load
Iff use it); sequential file channels don't yet.

### Windows, fonts and text styles
`Wind Open/Save/Close`, `Set Font`/`Get Fonts`/`Font$` (we always use
one 8x8 font), `Under/Shade/Inverse On/Off`, `Set Text`, `Set Paint`,
`Set Pattern`/`Set Line` (fill/line styles), `Set Curs`, `Cmove`,
`X Text/Y Text`, `Clw`, `Print Using`, escape-string functions
(`Border$`, `Pen$`, `Paper$`, `Tab$`, `Repeat$`, `Zone$`).

### Language-level
`Def Fn`/`Fn`, `Every n Proc/Gosub` (interrupt-driven procedures),
machine-code procedures (`@_apml_@` bodies are captured but 68k is
never executed; `Call`, `Areg`, `Dreg`), `Fix` (float display
precision), `Run`/`Prg Under`, `Command Line$`, `Err$`/`Errn`,
`Put Key`/`Clear Key`, bank management (`Reserve As Data/Work/Chip`,
`Erase`, `Bank Swap`, `Start` address function), `Read Text`,
`Appear`/`Zoom` (screen transitions), `Every On`.

### AMAL leftovers
`Amal n,#` (pre-compiled programs from an AMAL bank), `PLay` recorded
paths, `Bobsprite Col`/`Spritebob Col` cross-type collision.

### System / environment
`Amos To Front/Back`, `Amos Lock`, `Close Workbench/Editor`,
`Set Buffer`, `Set Accessory`, ARexx, the IOPorts extension (serial/
parallel/MIDI), printer channels, `Ntsc` (always PAL), `View`/
`Auto View On/Off`.

## Implemented but simplified — the honesty list

- **Bobs are composite-time overlays.** Equivalent to autoback for
  visuals, but `Bob Update`/`Bob Clear`/`Bob Draw`/`Set Bob` are
  no-ops, and reading pixels under a bob sees the background (real
  AMOS with single buffer would see the bob).
- **Double buffering is a no-op** (logical = physical). `Screen Swap`,
  `Logbase`, `Autoback` modes do nothing; programs relying on manual
  double-buffer flicker tricks will look wrong.
- **Rainbows are stored, not rendered** — `Set Rainbow`/`Rain`/
  `Rainbow` execute, but the composite doesn't do per-scanline
  palettes yet.
- **Writing modes**: only the default replace mode; `Writing`/`Gr
  Writing` XOR/OR/AND modes are ignored. `Ink` patterns ignored.
- **Fade is instant** (target palette applied immediately, no ramp).
- **HAM pictures decode as indexed** (wrong colours); EHB works.
- **Hardware sprites** use the front screen's palette 16–31 and ignore
  the real 4-per-scanline hardware limits (a superset).
- **Vumeter is synthesized** (deterministic wobble while a voice is
  busy) rather than measuring actual PCM amplitude.
- **Bell/Boom/Shoot** are modern approximations of the chip
  waveforms.
- **Sam Raw** is missing (needs bank-address memory model).
- **Print comma tab width** defaults to 13 (not yet verified against
  the console escape defaults).
- **Collision in AMAL** is allowed in any Synchro mode (original
  required Synchro Off).
- **`Timer=` accepted**, drives the frame clock directly.
- **Machine-code procedures** return immediately (skip mode) instead
  of executing 68k.
- Only tokenized `.AMOS` sources run — compiled AMOS executables are
  out of scope.

## Remaining census errors (16 programs)

- `screen not opened` (8): follow-ons from `Load` of missing files or
  unimplemented `Erase`/bank flows.
- `bank not reserved` (8): `Unpack` after a `Load` that couldn't find
  its file, or `Reserve` not implemented.
- `out of data` (2): a Data tutorial that errors on real AMOS too.
