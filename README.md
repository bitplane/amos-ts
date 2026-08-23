# amos-ts

A TypeScript reimplementation of [AMOS Pro](https://github.com/Francaoz/AMOS-Professional-Official),
so you can embed your old games into web pages.

Keyword supports most of the extensions I could find, but mostly hasn't been
play tested. Timings are a bit wrong etc.

Run it now at **[amos.bitplane.net](https://amos.bitplane.net)** - drop a
file (.amos, .adf, .zip etc) and see how it plays.

The project is under heavy development, so hotlink latest at risk of breakage.
Releases are pinned at `amos.bitplane.net/v/<version>/`, or build your own or
whatever.

You can see some of my old games [here](https://bitplane.net/dev/amos) for now,
I'll add a gallery to the main site in future.

---

## Install

```sh
npm install amos-ts
```

```js
import { Runtime, TokenTable, CORE_TOKENS, tokenize, defaultExtensionTables } from 'amos-ts'

const table = new TokenTable(CORE_TOKENS)
const exts = defaultExtensionTables()   // the stock extension slots

let out = ''
const rt = new Runtime(tokenize('Print "Hello" : Print 42', table, exts), table, {
  extensions: exts,
  onText: (t) => (out += t),
})
rt.runHeadless(1000)
console.log(out)   // "Hello\n 42\n". The space before 42 is AMOS's, not a
                   // typo: it writes one before every non-negative number
```

`runHeadless(n)` runs up to `n` steps and returns a status: `ended`, `blocked`
(waiting on input, a `Wait`, or a resource still loading) or `running` if it
hit the step cap. Nothing in the runtime blocks the thread. A driver calls it
once per frame at 50 Hz, which is what the browser player does.

To load a real program, `parseAmosFile` gives you its token stream and banks.

## Layout

```
src/
  loader/    .AMOS / .Abk / IFF parsing (BinReader, bank formats)
  tokens/    token table, the editor's tokeniser and detokeniser, number formats
  interp/    the interpreter: values, variables, control flow, instructions
  runtime/   the "virtual Amiga": screens, bobs, sprites, AMAL, audio, input
  amiga/     the modelled machine and OS beneath it. Paula, the blitter,
             graphics.library, dos.library, the ProTracker replay, the VFS
  ext/       the extension registry: identities, token tables, citations
  coverage/  what is implemented and how well it is known (status.ts)
  cli/       node CLI tools (list/unpack/inspect AMOS files)
  web/       browser runner
fixtures/    gitignored. Real .AMOS programs and .Abk banks for testing
docs/
  extensions/  the extension slot model, identification and evidence tiers
  amos3d/      the AMOS 3D file formats and engine, recovered from the binary
```

`CLAUDE.md` holds the working rules: how evidence is ranked, what a quotation
may and may not do, and what each coverage classification claims.

One generated file sits at the top level. `KEYWORDS.md` is the per-keyword
coverage manifest, written by `npx tsx src/cli/genmanifest.ts` from
`src/coverage/status.ts`. `UNIMPLEMENTED.md` beside it is written by hand: it
is the narrative gap list, and it carries the honesty list of everywhere the
port knowingly differs from the original, split into what can still be closed
and what cannot.

## Commands

```
npm test           # vitest, with the coverage gate at teardown
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint, correctness and suspicious rules only
npm run build      # vite lib build to dist/
npm run cli -- src/cli/<tool>.ts <args>   # run a CLI tool via tsx
```

`npm test` runs the faithfulness gate after vitest prints its summary, so read
the exit code. A run can report every test passing and still exit 1.

CLI tools in `src/cli/`:

| tool | what it does |
|---|---|
| `amoslist.ts` | detokenized listing plus banks |
| `amosrun.ts` | run a program headless (`.AMOS` or a plain-text listing) |
| `amoscat.ts` | detokenize to stdout, usable as an `rg --pre` preprocessor to grep AMOS source |
| `runreport.ts` | the interpreter coverage census, and the regression oracle |
| `scan.ts` | corpus parse census |
| `extscan.ts` | which extension each slot in a collection of programs held |
| `libscan.ts` | what each `.Lib` in a collection contains (`--gap` vs the registry) |
| `libdemand.ts` | rank extensions by how many programs identify to them |
| `libcat.ts` | catalogue a directory of `.Lib` files by identity |
| `libpool.ts` | pool several collections and report what is new |
| `versweep.ts` | which registered extensions are a later release of something already ported |
| `extdis.ts` | resolve an extension keyword to its 68k routine and disassemble it |
| `tddis.ts` | AMOS 3D: resolve a keyword to its engine routine and disassemble it |
| `muidis.ts` | MUI: resolve a class's method to its routine in `muimaster.library` and disassemble it (`--tree` for the class tree) |
| `m68k.ts` | the capstone bridge the three disassemblers share |
| `oscalls.ts` | which AmigaOS library functions an extension actually calls |
| `errscan.ts` | every `L_ErrorExt` call site in a binary, the registers set up, and the slot it states |
| `extaudit.ts` | which of an extension's implemented keywords have been read against its binary |
| `citecheck.ts` | every `routine N ($ADDR)` citation still names the code it claims to |
| `contested.ts` | keyword names two ported products both claim, and who answers |
| `renderaudio.ts` | play a module through its replayer and the mixer, and write a WAV (`--to-mod` unpacks a P61) |
| `audiocmp.ts` | compare two rendered WAVs: pitch classes, octave bands, tempo ratio |
| `adfx.ts` | read an Amiga floppy image |
| `craftx.ts` | unpack the CRAFT installer disk's `Data` blobs |
| `nodefs.ts`, `walk.ts`, `mdtable.ts` | the filesystem, corpus-walking and table helpers the others share |

The `gen*` tools regenerate checked-in data from the original material, and are
listed separately because running one is a deliberate act. They group by what
they read, which is what decides whether they can be chained:

- `npm run gentables` covers everything whose input is the AMOS Professional
  source tree or `fixtures/`: `gentable.ts`, `genext.ts`, `genedmsg.ts`,
  `genmouse.ts`, `genamoscalls.ts`, `genpiconfig.ts`, `genptrig.ts`. Each takes
  the tree's path as its first argument and defaults to
  `../AMOS-Professional-Official`.
- `npm run gendocs` covers `genmanifest.ts`, which writes `KEYWORDS.md`, and
  `genextdoc.ts`, which splices the registry table into
  `docs/extensions/README.md`. Both read the committed tables rather than the
  libraries, so they work without `fixtures/`.
- `gendecrunch.ts` and `genmui.ts` each read one library and write one
  `.gen.ts`: `decrunch.library`'s identification tables, and MUI 3.8's headers.
- `genfont.ts`, `genjdcrypt.ts` and `genlocale.ts` are one-off imports from
  material that is neither: a PSF console font, JD's own unpacked source, and
  an AROS checkout. Run each by hand with its path when that source changes.

Disassembly tools need `python3` with `capstone`.

## Status

**Core AMOS Professional is complete**, and so is every extension the port has
started. All twenty core areas in `KEYWORDS.md` read 100%: language, screens,
drawing, menus, banks, text-io, objects, input, files, flow, memory, system,
interface, AMAL, copper, palette, rainbows, windows and zones. So do 69
extension releases. Nothing is half-ported, and no row in the manifest sits
between 0% and 100%. What remains is extensions not yet begun.

**4,673 keywords implemented, 4,529 of them faithful.** Faithful means checked
against the 68k source or against the library binary, corroborated by
byte-exact artifacts. The order matters and is the project's governing rule:
the code that shipped outranks the prose about it, and documentation is
evidence only where there is no binary to read. Documentation alone never makes
a keyword faithful. That rule applies to this file too, which is why the
numbers above come from the manifest rather than from memory.

**Every extension a stock AMOS Professional installs is complete**: Music (49,
including `Say` and the mouth stream), Compact, Compiler, Requester, and
IOPorts (38, covering Serial, Printer and Parallel, with `Printer Dump`
rendering a page and `Serial Open` reaching real hardware through Web Serial).

The third-party extensions are the bulk of it. The largest are **AMCAF** (280,
across 1.40 and 1.50), **EasyLife** (156, across four releases), **TURBO Plus**
(152, across three), **CRAFT** (138), **JD** (133, across three), **Explode**
(131), **Personnal** (125), **Personal** (107), **The Game** (103) and **LDos**
(85, across 2.5 and 2.6). **AMOS 3D** (64) is the engine reverse-engineered
from `c3d.lib`, documented in `docs/amos3d/README.md`. `KEYWORDS.md` has the
full table.

### Corpus census

`npx tsx src/cli/runreport.ts --all` runs all 566 corpus programs headless.

| | |
|---|---|
| ran to a stop | 538 |
| **ran to a stop with nothing skipped** | **497 (92%)** |
| hit something unimplemented | 41 |

Read the second row, not the "ended with nothing skipped" line the tool prints.
That line counts only the 117 programs that *terminate*, and most AMOS programs
are games and demos that never do. 240 hit the step cap and 156 block waiting
on input, both of which are correct behaviour rather than failure.

Ranked by programs blocked rather than by occurrences, what is left is almost
entirely **n/a by policy**. This port reads 68k machine code and never executes
it, so `dreg` (30 programs), `doscall` (14), `call` and `areg` (4 each),
`machine code procedure` (2) and `gfxcall` (1) cannot move, and no keyword work
moves them. `dreg` alone is most of the 41.

Everything else is one or two programs each. `Ask Editor` (3 hits) and `Call
Editor` (2) are the editor phase, and `||apcmp||` is already classified with
them. Four OS DevKit spellings turn up once apiece: `_dos exist`,
`_wb to front`, `_path part`, `_request choice`. `Multi On` and `Multi Off`
block two programs each and `ext18:$4fc`/`$50e` one more, and those three are
an open question rather than a keyword gap --- both names ARE implemented, and
the two extensions carrying them read 100%, so what those programs put in slot
18 is not what the port binds there. Nobody has run it down yet.

**The Intuition family is gone from this list.** It was the whole of the
non-policy tail a release ago --- `iscreen_open` blocking 9 programs, `itext`
7, `iget$` and `reserve igadget` 4 each --- and `intuition-1.3b` now reads 183
of 183.

Hit counts are no guide here. `doscall` is skipped 10,166 times across 14
programs while `ask editor` blocks its one program on 3 hits.

`--by-program` counts programs per keyword rather than partitioning them, so
its rows overlap and cannot be added up.

**Reach is not correctness.** All of the above measures whether a program hits
a missing keyword. It says nothing about whether the pixels are right. See
`UNIMPLEMENTED.md` for every place the port knowingly falls short of the
original, split into what can still be closed and what cannot.

### Subsystems

- **Loader.** `.AMOS` containers, in every signature variant seen in the wild,
  and banks: `AmSp`/`AmIc` sprites, `AmBk` memory banks (Pac.Pic., Samples,
  Music, Amal, Data and the rest), IFF ILBM, Pac.Pic ported line by line from
  `UnPack_Bitmap`, and the Compact packer, which re-packs every corpus picture
  byte for byte.
- **Tokens.** Token tables extracted from the compiled AMOS Pro 2.00 libraries
  (hunk file, then `AP20` header, then `C_Tk` table), and the editor's own
  `Detok` and `Tokenise` ported byte for byte from `+Edit.s`. Every line of
  every program the project can reach goes out through one and back through
  the other and has to come back as the bytes it started as, once the fields
  the verifier owns are cleared: 124,468 lines under `fixtures/` and 1,063,966
  across the 3,873 programs in the corpus index. 0.18% do not, and each is a
  case the text cannot decide, classified by what is in the bytes rather than
  by which file it came from. A second tokenizer resolves procedure calls up
  front, which `Tokenise` leaves to the verifier, so tests can be written in
  AMOS source.
- **Interpreter.** Values, AMOS precedence and type rules, all control flow,
  procedures with the real scoping rules, Data/Read/Restore with computed
  labels, error trapping, Input and Print. A prescan recomputes control flow
  rather than trusting inline branch links. Nothing blocks the thread: `Wait`,
  `Wait Key`, `Wait Vbl` and `Input` set a `blocked` state the 50 Hz driver
  releases.
- **Display.** Complete, and **planar**. Screens and bank images are Amiga
  bitplanes with a chunky view derived from them, so `Logbase` pokes, bitplane
  extensions and a copper list aiming planes anywhere all address the real
  bytes rather than a translation. There is ONE renderer: the display comes
  from interpreting the copper list, system-generated or the program's own,
  walking BPLCON0/1/2/3, DDF/DIW, modulos, DMACON, the palette and the sprite
  pointers per scanline. That covers screens, drawing, palette, rainbows,
  menus, windows, zones, dual playfield, HAM and EHB, hardware and STOS
  animation, and the composited mouse pointer from the machine mouse bank.
- **Audio.** Complete. The three players (music bank, MOD tracker, MED) and the
  wavetable synth, ported from `+Music.s` over an `AudioSink`, with the
  read-and-clear Vumeter, voice stealing and reclaim, Sam Swap
  double-buffering and the LED filter.
- **AMAL.** The animation language reimplemented from TokAMAL and Animeur,
  including bank programs and PLay's recorded movements.
- **AMOS 3D.** The object format cracked from the binary (`.3DO`, `.3DT`,
  `.3DS`), the transform chain, camera, visibility, zones and collision, and a
  scanline rasteriser of our own. `docs/amos3d/README.md` documents the
  formats.
- **Dialog and Interface.** The resource banks, the dialog engine and the full
  `Start_FSel` file selector.
- **Browser runner** (`npm run dev`). Load a `.AMOS` file and watch it run at
  50 fps with keyboard, mouse and joystick. The Files panel is a file manager
  over the same virtual filesystem the program sees: drop in files, folders or
  zips, then rename, delete, make drawers, relabel volumes and drag rows
  between drawers.
- **Direct mode.** When the program stops, AMOS's escape screen comes down:
  the editor's own logo, buttons and function-key macros, with a one-line
  editor on it that runs what you type against the variables the program left
  behind. Escape flips it, both ways, the way `Ed_Escape` (`+Edit.s:8876`) and
  `Esc_Esc` (`:9125`) do. A running program keeps the key: nothing in AMOS
  interrupts one with Escape, and Ctrl-C is what does.

Format notes recovered so far, verified against the corpus and against the
assembly in `+Lib.s` and `+Edit.s`:

- Token ids are byte offsets into the library token table. Entries end in
  `$FF`, or `$FE`/`$FD` when an unnamed arg-count or function-form variant
  entry follows.
- Operators have ids that are negative offsets from the end of the editor's
  operator table (`=` is $FFA2, `+` is $FFC0, and so on).
- Control flow tokens (`If`, `Else`, `For`, `Repeat`, `While`, `Do`, `Data`,
  `Else If`) carry a 2-byte inline branch link. `On`, `Exit` and `Exit If`
  carry 4 bytes, `Lvo()` caches a 6-byte vector offset, and `Procedure` carries
  size, seed and flags, its size linking to `End Proc`.
- `@_apml_@` marks machine-code procedures: raw 68k code follows inline in the
  token stream, which real AMOS `jsr`s directly. The loader captures the block
  and skips to `End Proc`. **This port never executes 68k**, so calling one is
  an error. Reading and disassembling 68k is a different matter, and is how
  much of the extension work was done.

Language semantics recovered from the assembly and the corpus:

- `Print` and `Str$` write a leading space before non-negative numbers
  (`LongToAsc` "avec signe" in `+Lib.s`), which is why the corpus is full of
  the `Str$(X)-" "` idiom. String subtraction removes occurrences of the right
  operand from the left.
- `Int()` on floats is a floor (`SPFloor`) rather than a truncation, while
  assignment to an integer variable truncates.
- `True` is -1 and comparisons return -1 or 0. `/` between integers is integer
  division.
- Programs saved without the editor's Test pass store procedure calls and label
  targets as plain variable tokens, so the interpreter falls back to procedure
  and label lookup for bare names. `src/tokens/verify.ts` is a port of that
  Test pass, `+Verif.s`: it decides what a bare name really is, swaps an
  instruction for the argument-count variant its arguments fit, counts an
  extension's arguments into the byte behind its slot, and fills the branch
  links and variable offsets. 3,732 of the 3,873 programs in the corpus walk
  through it and 1,091 come out byte for byte identical to what the Amiga
  saved, and a program listed and retyped and verified again is the same bytes
  in all 539 fixtures cases the sweep can compare.
- `Restore` and `Gosub` accept computed string expressions as label names, for
  instance `Restore "Rn"+Mid$(Str$(N),2)`.

## Fixtures

`fixtures/` is not committed, because the AMOS libraries and the commercial
extensions are not ours to redistribute. Put `.AMOS` and `.Abk` files there,
whether that is the Amos-Professional-AGA-Releases corpus or your own old
games. The corpus integration test and `src/cli/gentable.ts` expect
`fixtures/official-amos` (the `AMOS/` release tree from
AMOS-Professional-Official) and `fixtures/aga-releases`. Extension libraries go
in `fixtures/extensions/<id>/`.

Two notes for anyone searching the corpus. Tokenized `.AMOS` files are binary,
so a plain `grep -r` silently skips them if your `grep` is ugrep. Pass `-a`,
and run a positive control before believing a negative result. And
`src/cli/amoscat.ts` detokenizes to stdout, so it works as an `rg --pre`
preprocessor and greps AMOS source rather than token streams. Write a one-line
wrapper that `exec`s it and point `--pre` at that.

## Releasing

`npm run release [patch|minor|major]` runs the typecheck and the full suite,
bumps the version, tags and pushes. That one tag fires both workflows: the
library goes to npm (`publish.yml`) and the player to amos.bitplane.net
(`release.yml`), at `/`, `/v/latest/` and an immutable `/v/<version>/`.

CI runs on every push and pull request, but `fixtures/` is not committed, so
most of the suite skips there. **CI catches build breaks, not fidelity
regressions.** Those need a local run with the corpus in place, plus the
census.

## Licence

MIT. See [LICENSE](LICENSE).

Speech is [narrator-ts](https://www.npmjs.com/package/narrator-ts) (MIT), a
reimplementation of the Amiga `narrator.device` and `translator.library`. It
ships a free rebuilt voice rather than the Amiga's own tables, which are not
redistributable, so `Say` speaks without sounding like a real Amiga.

This repository contains no AMOS Professional code or data. The reference
assembly is read from
[AMOS-Professional-Official](https://github.com/Francaoz/AMOS-Professional-Official)
and `fixtures/` is gitignored for the same reason.
