# amos-ts

A TypeScript reimplementation of [AMOS Pro](https://github.com/Francaoz/AMOS-Professional-Official),
so you can embed your old games into web pages.

Keyword support covers most of the extensions I could find, but mostly hasn't been
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
  editor/    +Edit.s: the program buffer, the commands, the key map, the windows
  amos/      the two halves joined, which is what +B.s is: the editor's Run
             builds an interpreter and the program's exit re-enters the editor
  ext/       the extension registry: identities, token tables, citations
  coverage/  what is implemented and how well it is known (status.ts)
  cli/       node CLI tools (list/unpack/inspect AMOS files)
  web/       browser runner
fixtures/    gitignored. Real .AMOS programs and .Abk banks for testing
docs/
  internals.md  what each subsystem covers, and the formats and semantics
                recovered from the original
  cli.md        every CLI tool, and the gen* tools that rebuild checked-in data
  extensions/   the extension slot model, identification and evidence tiers
  amos3d/       the AMOS 3D file formats and engine, recovered from the binary
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

The CLI tools live in `src/cli/`; `docs/cli.md` lists them.

## Status

Core AMOS Professional is done, and so is nearly every extension the port has
started. `KEYWORDS.md` is the index: **5,365 keywords faithful, 284
approximated**. All twenty core areas read 100%, and so do 82 of the 88
extension releases. Five of the rest read 0%, which means nobody has started
them; DME 2.0 reads 82%, which means somebody should finish it. A row is meant
to be 0% or 100%, because a half-ported extension is a state to leave rather
than a state to record.

Faithful means checked against the shipped 68k source or against the library
binary. Documentation alone never qualifies, which is the project's governing
rule and the reason those numbers come from the manifest rather than from
memory.

The extensions needed an operating system under them, so `src/amiga/` has one:
exec, dos, graphics, intuition, asl, locale, diskfont, workbench and a couple
of dozen more, modelled as far as the programs actually reach. That was never
the point. It is what porting the extensions cost.

Reach is not correctness. `npx tsx src/cli/runreport.ts --all` runs the corpus
headless and reports how many programs get through without hitting something
unimplemented; it says nothing about whether the pixels are right.
`UNIMPLEMENTED.md` is where the port knowingly differs from the original,
split into what can still be closed and what cannot.

`docs/internals.md` covers what each subsystem does, and the file formats and
language semantics that reading the original turned up.

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
