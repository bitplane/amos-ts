# amos-ts

A TypeScript reimplementation of the AMOS Professional interpreter and runtime,
so old AMOS games can run on the web.

Reference source: [AMOS-Professional-Official](https://github.com/Francaoz/AMOS-Professional-Official)
(68000 assembly, MIT licence). The strategy is **not** to translate the assembly,
but to reimplement the language and runtime from it:

- `.AMOS` files are *tokenized* programs plus resource banks — we load and
  interpret the token stream directly.
- The token table in `+Lib.s` is the authoritative instruction inventory.
- The Amiga hardware layer (`+W.s`) is replaced with Canvas/WebAudio.

Run it now at **[amos.bitplane.net](https://amos.bitplane.net)** — drop a
`.AMOS` file in and it plays. Every release is also pinned at
`amos.bitplane.net/v/<version>/`, so a page can embed one build and keep it.

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
console.log(out)   // "Hello\n 42\n" — the space before 42 is AMOS's, not a
                   // typo: it writes one before every non-negative number
```

`runHeadless(n)` runs up to `n` steps and returns a status: `ended`, `blocked`
(waiting on input, a `Wait`, or a resource still loading) or `running` if it
hit the step cap. Nothing in the runtime blocks the thread — a driver calls it
once per frame at 50 Hz, which is what the browser player does.

To load a real program, `parseAmosFile` gives you its token stream and banks.

## Layout

```
src/
  loader/    .AMOS / .Abk / IFF parsing (BinReader, bank formats)
  tokens/    token table, detokenizer (listings from tokenized programs)
  interp/    the interpreter: values, variables, control flow, instructions
  runtime/   the "virtual Amiga": screens, bobs, sprites, AMAL, audio, input
  cli/       node CLI tools (list/unpack/inspect AMOS files)
  web/       browser runner
fixtures/    gitignored — real .AMOS programs and .Abk banks for testing
docs/
  extensions/  the extension slot model, identification and evidence tiers
  amos3d/      the AMOS 3D file formats and engine, recovered from the binary
```

Two generated files sit at the top level: `KEYWORDS.md`, the per-keyword
coverage manifest (`npx tsx src/cli/genmanifest.ts`), and `UNIMPLEMENTED.md`,
the narrative gap list — including the honesty list of everywhere the port
knowingly differs from the original, split into what can still be closed and
what cannot.

## Commands

```
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # vite lib build to dist/
npm run cli -- src/cli/<tool>.ts <args>   # run a CLI tool via tsx
```

CLI tools in `src/cli/`:

| tool | what it does |
|---|---|
| `amoslist.ts` | detokenized listing plus banks |
| `amosrun.ts` | run a program headless (`.AMOS` or a plain-text listing) |
| `amoscat.ts` | detokenize to stdout — usable as an `rg --pre` preprocessor to grep AMOS source |
| `runreport.ts` | the interpreter coverage census, and the regression oracle |
| `scan.ts` | corpus parse census |
| `genmanifest.ts` | regenerate `KEYWORDS.md` from `src/coverage/status.ts` |
| `gentable.ts`, `genext.ts` | regenerate token tables from the original libraries |
| `extscan.ts`, `extdis.ts`, `extdemand.ts` | extension discovery, disassembly and demand ranking |
| `tddis.ts` | AMOS 3D: resolve a keyword to its engine routine and disassemble it |
| `adfx.ts` | read an Amiga floppy image |

Disassembly tools need `python3` with `capstone`.

## Status

**Core AMOS Professional is complete.** Every core area in `KEYWORDS.md` reads
100%: language, screens, drawing, menus, banks, text-io, objects, input, files,
memory, system, interface, AMAL, copper, palette, rainbows, windows and zones.
1089 keywords implemented, **1044 of them faithful** — verified against the 68k
source, the official manual, or byte-exact artifacts. 1486 tests.

**Every extension a stock AMOS Professional installs is complete**: Music (49,
including `Say` and the mouth stream), Compact, Compiler, Requester, and
IOPorts (38 — Serial, Printer and Parallel, with `Printer Dump` rendering a
page and `Serial Open` reaching real hardware through Web Serial).

Four third-party extensions are complete: **AMOS 3D** (64 keywords, the engine
reverse-engineered from `c3d.lib` — see `docs/amos3d/README.md`), **Personnal**
(116 across 1.0b and 1.1), **TURBO Plus** (153 across three versions) and
**LDos 2.5** (77).

### Corpus census

`npx tsx src/cli/runreport.ts --all` runs all 488 corpus programs headless.

| | |
|---|---|
| run to a stop | 478 |
| **run with nothing skipped** | **429 (90%)** |
| hit something unimplemented | 49 |

Read the second row, not the "ended with nothing skipped" line the tool
prints. That line counts only programs that *terminate*, and most AMOS
programs are games and demos that never do — 233 hit the step cap and 139
block waiting on input, both of which are correct behaviour, not failure.

`--by-program` says what the 49 are blocked on. It counts programs per
keyword rather than partitioning them, so these overlap: `dreg` blocks 29
and `doscall` 14, both host/68k calls that are n/a by policy; the rest is
almost entirely Intuition 1.3b, in a long tail where the widest single
keyword (`iscreen_open`) blocks 9. Hit counts are no guide here — `igadget
read` is skipped 141,835 times across just 3 programs.

**Reach is not correctness.** All of the above measures whether a program hits
a missing keyword. It says nothing about whether the pixels are right — see
`UNIMPLEMENTED.md` for every place the port knowingly falls short of the
original, split into what can still be closed and what cannot.

### Subsystems

- **Loader** — `.AMOS` containers (all signature variants seen in the wild)
  and banks: `AmSp`/`AmIc` sprites, `AmBk` memory banks (Pac.Pic., Samples,
  Music, Amal, Data...), IFF ILBM, Pac.Pic (ported line-by-line from
  `UnPack_Bitmap`), and the Compact packer, which re-packs every corpus
  picture byte for byte.
- **Tokens** — token tables extracted from the compiled AMOS Pro 2.00
  libraries (hunk file → `AP20` header → `C_Tk` table). The detokenizer
  reproduces editor-style listings; the tokenizer goes the other way, so tests
  are written in AMOS source.
- **Interpreter** — values, AMOS precedence and type rules, all control flow,
  procedures with the real scoping rules, Data/Read/Restore with computed
  labels, error trapping, Input/Print. Control flow is recomputed by a prescan
  rather than trusting inline branch links. Never blocks: `Wait`, `Wait Key`,
  `Wait Vbl` and `Input` set a `blocked` state the 50 Hz driver releases.
- **Display** — done to 100%. Screens, drawing, palette, rainbows, copper
  (system-generated *and* user lists), menus, windows, zones, dual playfield,
  HAM/EHB, hardware and STOS animation, a scanline compositor, and the
  composited mouse pointer from the machine mouse bank.
- **Audio** — done. The three players (music bank, MOD tracker, MED) and the
  wavetable synth, ported from `+Music.s` over an `AudioSink`, with the
  faithful read-and-clear Vumeter, voice stealing and reclaim, Sam Swap
  double-buffering and the LED filter.
- **AMAL** — the animation language reimplemented from TokAMAL/Animeur,
  including bank programs and PLay's recorded movements.
- **AMOS 3D** — the object format cracked from the binary (`.3DO`/`.3DT`/
  `.3DS`), the transform chain, camera, visibility, zones and collision, and
  our own scanline rasteriser. `docs/amos3d/README.md` documents the formats.
- **Dialog / Interface** — the resource banks, the dialog engine and the full
  `Start_FSel` file selector.
- **Browser runner** (`npm run dev`) — load a `.AMOS` file and watch it run at
  50 fps with keyboard, mouse and joystick. The Files panel is a file manager
  over the same virtual filesystem the program sees: drop in files, folders or
  zips, then rename, delete, make drawers, relabel volumes and drag rows
  between drawers.

Format notes recovered so far (verified against the corpus, and the
assembly in `+Lib.s`/`+Edit.s`):

- Token ids are byte offsets into the library token table; entries end in
  `$FF`, or `$FE`/`$FD` when an unnamed arg-count/function-form variant
  entry follows.
- Operators have ids that are negative offsets from the end of the editor's
  operator table (`=` is $FFA2, `+` is $FFC0, ...).
- Control flow tokens (`If`, `Else`, `For`, `Repeat`, `While`, `Do`,
  `Data`, `Else If`) carry a 2-byte inline branch link; `On`/`Exit`/
  `Exit If` carry 4 bytes; `Lvo()` caches a 6-byte vector offset;
  `Procedure` carries size/seed/flags and its size links to `End Proc`.
- `@_apml_@` marks machine-code procedures: raw 68k code follows inline in
  the token stream, which real AMOS `jsr`s directly. The loader captures the
  block and skips to `End Proc`; **this port never executes 68k**, so calling
  one is an error. Reading and disassembling 68k is a different matter and is
  how much of the extension work was done.

Language semantics recovered from the assembly and the corpus:

- `Print`/`Str$` write a leading space before non-negative numbers
  (`LongToAsc` "avec signe" in `+Lib.s`) — which is why the corpus is full
  of the `Str$(X)-" "` idiom: string subtraction removes occurrences of
  the right operand from the left.
- `Int()` on floats is a floor (`SPFloor`), not truncation; assignment to
  an integer variable truncates.
- `True` is -1, comparisons return -1/0; `/` between integers is integer
  division.
- Programs saved without the editor's Test pass store procedure calls and
  label targets as plain variable tokens — the interpreter falls back to
  procedure/label lookup for bare names.
- `Restore`/`Gosub` accept computed string expressions as label names
  (e.g. `Restore "Rn"+Mid$(Str$(N),2)`).

## Fixtures

`fixtures/` is not committed — the AMOS libraries and the commercial
extensions are not ours to redistribute. Put `.AMOS`/`.Abk` files there, e.g.
the Amos-Professional-AGA-Releases corpus, or your own old games. The corpus
integration test and `src/cli/gentable.ts` expect `fixtures/official-amos`
(the `AMOS/` release tree from AMOS-Professional-Official) and
`fixtures/aga-releases`; extension libraries go in
`fixtures/extensions/<id>/`.

Two notes for anyone searching the corpus. Tokenized `.AMOS` files are binary,
so a plain `grep -r` will silently skip them if your `grep` is ugrep — pass
`-a`, and run a positive control before believing a negative result. And
`src/cli/amoscat.ts` detokenizes to stdout, so `rg --pre amoscat` greps AMOS
source rather than token streams.

## Releasing

`npm run release [patch|minor|major]` runs the typecheck and the full suite,
bumps the version, tags and pushes. That one tag fires both workflows: the
library goes to npm (`publish.yml`) and the player to amos.bitplane.net
(`release.yml`), at `/`, `/v/latest/` and an immutable `/v/<version>/`.

CI runs on every push and pull request, but `fixtures/` is not committed, so
most of the suite skips there — see above. **CI catches build breaks, not
fidelity regressions.** Those need a local run with the corpus in place, plus
the census.

## Licence

MIT — see [LICENSE](LICENSE).

Speech is [narrator-ts](https://www.npmjs.com/package/narrator-ts) (MIT), a
reimplementation of the Amiga `narrator.device` and `translator.library`. It
ships a free rebuilt voice, not the Amiga's own tables, which are not
redistributable — so `Say` speaks, but it does not sound like a real Amiga.

This repository contains no AMOS Professional code or data. The reference
assembly is read from
[AMOS-Professional-Official](https://github.com/Francaoz/AMOS-Professional-Official)
and `fixtures/` is gitignored for the same reason.
