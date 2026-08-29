# The CLI tools

Everything here runs through `npm run cli -- src/cli/<tool>.ts <args>`, which
is `tsx` with the project's config.

CLI tools in `src/cli/`:

| tool | what it does |
|---|---|
| `amoslist.ts` | detokenized listing plus banks |
| `amosrun.ts` | run a program headless (`.AMOS` or a plain-text listing) |
| `amosedit.ts` | the AMOS Professional editor, in a terminal. F1 runs the program, F2 tests it. A terminal has no scancodes, so most of the key map is out of reach there and the browser is where the editor is whole |
| `amoscat.ts` | detokenize to stdout, usable as an `rg --pre` preprocessor to grep AMOS source |
| `runreport.ts` | the interpreter coverage census, and the regression oracle |
| `scan.ts` | corpus parse census |
| `extscan.ts` | which extension each slot in a collection of programs held |
| `libscan.ts` | what each `.Lib` in a collection contains (`--gap` vs the registry) |
| `libdemand.ts` | rank extensions by how many programs identify to them |
| `libcat.ts` | catalogue a directory of `.Lib` files by identity |
| `libpool.ts` | pool several collections and report what is new |
| `versweep.ts` | which registered extensions are a later release of something already ported |
| `keyspec.ts` | what argument lists a keyword accepts, read off its own token table (`all` searches every one) |
| `keygrep.ts` | every line in the corpus that uses a keyword, detokenized with the extension tables its slots name |
| `extdis.ts` | resolve an extension keyword to its 68k routine and disassemble it |
| `tddis.ts` | AMOS 3D: resolve a keyword to its engine routine and disassemble it |
| `muidis.ts` | MUI: resolve a class's method to its routine in `muimaster.library` and disassemble it (`--tree` for the class tree) |
| `m68k.ts` | the capstone bridge the three disassemblers share |
| `oscalls.ts` | which AmigaOS library functions an extension actually calls |
| `errscan.ts` | every `L_ErrorExt` call site in a binary, the registers set up, and the slot it states |
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
