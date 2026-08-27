# amos-ts

A TypeScript reimplementation of [AMOS Pro](https://github.com/Francaoz/AMOS-Professional-Official),
so you can embed your old games into web pages.

Keyword support covers most of the extensions I could find, but mostly hasn't been
play tested. Timings are a bit wrong, work is ongoing.

See it now at **[amos.bitplane.net](https://amos.bitplane.net)** - drop a
file (.amos, .adf, .zip, .lha etc) and see how it plays.

<table>
 <tr>
  <td><img src="https://amos.bitplane.net/library/bitplane.net/Eggit.png" alt="Eggit" width="260"></td>
  <td><img src="https://amos.bitplane.net/library/bitplane.net/NSLE.png" alt="NSLE" width="260"></td>
  <td><img src="https://amos.bitplane.net/library/bitplane.net/Thrusts.png" alt="Thrusts" width="260"></td>
 </tr>
 <tr>
  <td><img src="https://amos.bitplane.net/library/bitplane.net/Scrawler.png" alt="Scrawler" width="260"></td>
  <td><img src="https://amos.bitplane.net/library/bitplane.net/Goldfish.png" alt="Goldfish" width="260"></td>
  <td><img src="https://amos.bitplane.net/library/bitplane.net/Draw%20%27n%27%20Draw.png" alt="Draw 'n' Draw" width="260"></td>
 </tr>
</table>

Releases are pinned at `amos.bitplane.net/v/<version>/`, or build your own or
whatever.

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

Core AMOS Professional is done, `KEYWORDS.md` is an index of missing extension
keywords. Faithful means checked against the shipped 68k source or against the
library binary.

The extensions needed an operating system under them, so `src/amiga/` contains
shims for dos, graphics, intuition, asl, locale, diskfont, workbench and a few
couple more, modelled as far as the programs reach. `UNIMPLEMENTED.md` is where
the port knowingly differs from the original, split into what can still be
closed and what can't.

`docs/internals.md` covers what each subsystem does, and the file formats and
language semantics that reading the original turned up.

## Fixtures

`fixtures/` is not committed for the usual licensing reasons. Put your `.AMOS`
and `.Abk` files there. The corpus integration test and `src/cli/gentable.ts`
expect `fixtures/official-amos` (the `AMOS/` release tree from
AMOS-Professional-Official) and `fixtures/aga-releases`. Extension libraries go
in `fixtures/extensions/<id>/`.

## Licence

MIT. See [LICENSE](LICENSE).

Speech is [narrator-ts](https://www.npmjs.com/package/narrator-ts) (MIT), a
reimplementation of the Amiga `narrator.device` and `translator.library`. It
ships a free rebuilt voice rather than the Amiga's own tables, which are not
redistributable, so `Say` speaks without sounding like a real Amiga.

The code and AMOS graphics were derived from 
[AMOS-Professional-Official](https://github.com/Francaoz/AMOS-Professional-Official),
everything else was reverse engineered for compatibility purposes.

The library on amos.bitplane.net contains copyrighted works that are assumed to
be abandonware - if you'd like something removed please email gaz@bitplane.net
or open a ticket [here](https://github.com/bitplane/amos-library/issues) and
I'll purge it from the history.
