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

## Fixtures

`fixtures/` is not committed. Put `.AMOS`/`.Abk` files there, e.g. the
Amos-Professional-AGA-Releases corpus, or your own old games.
