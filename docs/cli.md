# Command-line tools

Run a command with:

```sh
npm run cli -- src/cli/<tool>.ts <args>
```

The directory also contains shared Node-only modules and generators. Those are
listed separately so that a source file under `src/cli/` is not mistaken for a
survey that ought to be run periodically.

## Everyday commands

| tool | what it does |
|---|---|
| `amoslist.ts` | detokenized listing plus banks |
| `amoscat.ts` | detokenize to stdout, including use as an `rg --pre` filter |
| `amosrun.ts` | run a tokenized program or plain-text listing headlessly |
| `amosedit.ts` | run the AMOS Professional editor in a terminal; the browser has the complete scancode-driven interface |
| `keygrep.ts` | find corpus source lines using a keyword, after detokenizing with each program's extension tables |
| `keyspec.ts` | show the argument forms a keyword's own token table accepts |
| `runreport.ts` | run a chosen program tree headlessly and report runtime stops and skipped keywords |
| `renderaudio.ts` | render a supported module to WAV; `--to-mod` unpacks P61 |
| `audiocmp.ts` | compare rendered WAVs by pitch, frequency band and tempo |

`runreport` is an exploratory compatibility report, not a committed baseline.
It defaults to `fixtures/`; pass `../amos-files/sources` explicitly for a wide
corpus run. `--all` expands the printed error and keyword lists but does not
change which programs are scanned.

## Extension and binary investigation

| tool | what it does |
|---|---|
| `libcat.ts` | catalogue `.Lib` token tables as known, variant, renumbered or new; supports `--gap`, `--keywords`, `--json` and `--md` |
| `extdis.ts` | resolve an extension keyword to its 68k routine and disassemble it |
| `tddis.ts` | resolve an AMOS 3D keyword to its engine routine and disassemble it |
| `muidis.ts` | resolve a MUI class method to `muimaster.library` code; `--tree` prints the class tree |
| `libdis.ts` | walk an Amiga library's resident/function tables and disassemble its routines |
| `oscalls.ts` | report the AmigaOS library functions an extension calls |
| `errscan.ts` | report every registered binary's `L_ErrorExt` call sites and register setup |
| `citecheck.ts` | batch-report source and routine citations; tests enforce the mechanical checks |
| `contested.ts` | report keyword names claimed by more than one extension product |
| `versweep.ts` | compare registered releases for bindable, added or renumbered tables |
| `amosasm.ts`, `gencycles.ts`, `m68kcost.ts` | assembler parsing and cycle-cost analysis |
| `craftx.ts` | unpack the CRAFT installer disk's `Data` blobs |

`extdis`, `tddis`, `muidis` and `libdis` need Python with Capstone.

The extension registry and `KEYWORDS.md` are the current inventory. Earlier
whole-corpus discovery commands were removed after the collected corpus had
been indexed and its discoveries recorded in manifests. `libcat` remains for
checking genuinely new binary collections without presenting acquisition as a
routine development step.

## Generators

Generators deliberately rewrite checked-in data:

- `npm run gentables` runs `gentable.ts`, `genext.ts`, `genedmsg.ts`,
  `genmouse.ts`, `genamoscalls.ts`, `genpiconfig.ts` and `genptrig.ts`.
  Their inputs are the AMOS Professional source tree or local fixtures.
- `npm run gendocs` runs `genmanifest.ts` and `genextdoc.ts`, producing
  `KEYWORDS.md` and the generated registry table in `docs/extensions/README.md`.
- `gendecrunch.ts` and `genmui.ts` import one external library or header tree
  into a checked-in `.gen.ts` file.
- `genfont.ts`, `genjdcrypt.ts`, `genlocale.ts`, `gendatatypes.ts`,
  `genequates.ts`, `genedkeys.ts`, `genedres.ts` and `genverif.ts` are
  source-specific imports. Run them only when the named source changes.
- `genlibrary.ts` builds the browser library index and is also imported by the
  development server.

## Shared modules

These are implementation support, not commands to run:

- `corpus.ts` resolves checksum-indexed corpus files and the canonical AMOS
  assembler checkout used by citations.
- `walk.ts` walks old collections without corrupting Latin-1 Amiga filenames.
- `nodefs.ts` mounts host directories into the runtime's Amiga filesystem.
- `libpool.ts` reads and deduplicates extension token tables for `libcat`.
- `slottab.ts` reads an interpreter configuration embedded in a compiled
  program; its tests preserve the recovered format.
- `m68k.ts`, `m68kcost.ts`, `mdtable.ts` and `termkeys.ts` support the commands
  above.
