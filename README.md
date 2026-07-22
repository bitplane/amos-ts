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
```

## Commands

```
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # vite lib build to dist/
npm run cli -- src/cli/<tool>.ts <args>   # run a CLI tool via tsx
```

## Status

- **Loader**: parses `.AMOS` containers (all signature variants seen in the
  wild) and banks: `AmSp`/`AmIc` sprite banks, `AmBk` memory banks
  (Pac.Pic., Samples, Music, Amal, Data, ...).
- **Tokens**: token tables are extracted from the compiled AMOS Pro 2.00
  libraries (hunk file → `AP20` header → `C_Tk` table) into
  `src/tokens/tables.gen.ts` by `src/cli/gentable.ts`. Covers the core 637
  instructions plus the Music/Compact/Request/Compiler/IOPorts extensions.
- **Detokenizer**: reproduces editor-style listings. Parses 100% of the
  453-file fixture corpus (token stream + banks).

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
- `@_apml_@` marks machine-code procedures: raw 68k code follows in the
  token stream and is `jsr`'d directly by the interpreter. The loader
  captures the code block and skips to `End Proc`.

## Fixtures

`fixtures/` is not committed. Put `.AMOS`/`.Abk` files there, e.g. the
Amos-Professional-AGA-Releases corpus, or your own old games. The corpus
integration test and `src/cli/gentable.ts` expect `fixtures/official-amos`
(the `AMOS/` release tree from AMOS-Professional-Official) and
`fixtures/aga-releases`.
