# amos-ts

A TypeScript reimplementation of [AMOS Pro](https://github.com/Francaoz/AMOS-Professional-Official),
so you can put your old games on the web.

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

Drop a file (.amos, .adf, .zip, .lha etc) into 
**[amos.bitplane.net](https://amos.bitplane.net)** and see how it plays.

Keyword support covers most of the extensions I could find, but mostly hasn't
been play tested. Timings are a bit wrong, work is ongoing.

## Embed it

```html
<div id="game" style="max-width: 640px"></div>
<script type="module">
  import { createPlayer } from 'https://amos.bitplane.net/v/latest/assets/amos-player.js'

  const player = createPlayer(document.getElementById('game'))
  const bytes = new Uint8Array(await (await fetch('MyGame.zip')).arrayBuffer())
  await player.loadArchive(bytes, 'MyGame.zip')
</script>
```

Versions are paths, so swap `latest` for a version number to pin it.
`/v/latest/` is under heavy development, so pin it unless you want the breakage.

`npm install amos-ts` gets the package with tools and other non-web things.

## Docs

- [docs/library.md](docs/library.md), the npm package: the interpreter, the
  loaders and the headless runner.
- [docs/internals.md](docs/internals.md), what each subsystem covers, where it
  lives, and the formats and semantics recovered from the original.
- [docs/cli.md](docs/cli.md), every CLI tool, and the gen* tools that rebuild
  the checked-in data.
- [docs/extensions/](docs/extensions/), the extension slot model, identification
  and evidence tiers.
- [docs/amos3d/](docs/amos3d/), the AMOS 3D file formats and engine, recovered
  from the binary.

`CLAUDE.md` holds the working rules: how evidence is ranked, what a quotation
may and may not do, and what each coverage classification claims.

## Commands

```
npm run dev        # the player, on a local server
npm test           # vitest, with the coverage gate at teardown
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint, correctness and suspicious rules only
npm run build      # vite lib build to dist/
npm run cli -- src/cli/<tool>.ts <args>   # run a CLI tool via tsx
```

`npm test` runs the faithfulness gate after vitest prints its summary, so read
the exit code. A run can report every test passing and still exit 1.

## Status

Core AMOS Professional is done. `KEYWORDS.md` is an index of the missing
extension keywords, and carries the counts. Faithful means checked against the
shipped 68k source or a dissassembled binary.

`src/amiga/` contains shims for dos, graphics, intuition, asl, locale, diskfont,
workbench and a few more, modelled as far as the programs reach.
`UNIMPLEMENTED.md` is where the port knowingly differs from the original, split
into what could be closed and what can't.

## Fixtures

`fixtures/` is not committed for the usual licensing reasons. Put your `.AMOS`
and `.Abk` files there. The corpus integration test and `src/cli/gentable.ts`
expect `fixtures/official-amos` (the `AMOS/` release tree from
AMOS-Professional-Official) and `fixtures/aga-releases`. Extension libraries go
in `fixtures/extensions/<id>/`.

## Licence

MIT. See [LICENSE](LICENSE).

Speech is [narrator-ts](https://www.npmjs.com/package/narrator-ts) (MIT), a
reimplementation of the Amiga `narrator.device` and `translator.library`.

The code and AMOS graphics were derived from
[AMOS-Professional-Official](https://github.com/Francaoz/AMOS-Professional-Official),
everything else was reverse engineered for compatibility purposes.

The library on amos.bitplane.net contains copyrighted works that are assumed to
be abandonware - if you'd like something removed please email gaz@bitplane.net
or open a ticket [here](https://github.com/bitplane/amos-library/issues) and
I'll purge it from the history.
