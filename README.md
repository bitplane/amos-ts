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

CLI tools: `amoslist.ts` (detokenized listing + banks), `amosrun.ts`
(run a program headless — .AMOS or plain-text listing), `scan.ts` (corpus
parse census), `runreport.ts` (interpreter coverage census),
`gentable.ts` (regenerate token tables from the original libraries).

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
- **Tokenizer** (`src/tokens/tokenizer.ts`): text → token stream, so tests
  are written in AMOS source and a future web editor can accept typed code.
- **Interpreter core** (`src/interp/`): values (int32/float/string),
  expressions with AMOS precedence and type rules (integer division,
  string subtraction), variables/arrays with type suffixes, all control
  flow (If/Else If, For, Repeat, While, Do/Exit, Goto/Gosub, On),
  procedures (params, locals, Shared/Global, Param, recursion),
  Data/Read/Restore (including computed label strings), error trapping
  (On Error Goto/Proc, Trap, Errtrap, Resume), Input/Print with tab
  zones, and ~70 core functions. Control flow is recomputed by a prescan
  (`prescan.ts`) instead of trusting the inline branch links, so
  tokenized-from-text programs run identically. Runs headless against an
  `AmosIO` interface; graphics/sound instructions are counted and skipped
  (`onUnimplemented: 'skip'`) — 389 of the 393 corpus programs run to a
  stop (the rest hit their intended error paths in a headless world).
- **Resumable execution**: the interpreter never blocks — `Wait`,
  `Wait Key`, `Wait Vbl` and `Input` set a `blocked` state and the driver
  (`Runtime.frame()`, 50Hz) releases it when the clock/keys/lines arrive.
  `run(slice)` bounds statements per frame so the browser stays live.
- **Runtime** (`src/runtime/`): screens as indexed framebuffers + RGB4
  palettes (the authentic default palette, recovered from
  `AMOSPro_Interpreter_Config`), drawing (Plot/Draw/Box/Bar/Circle/
  Ellipse/Polyline/Paint/Clip), the text console (8x8 font, Pen/Paper,
  scrolling, Centre/Locate/CUp...), palette ops (Colour/Palette/Fade/
  Shift), Screen Open/Display/Offset/Copy and z-ordering, rainbows
  (stored, not yet rendered), input devices (Inkey$, Key State, mouse,
  joystick), and a 640x400 RGBA compositor. All testable headless —
  the canvas only appears in `src/web`.
- **Browser runner** (`npm run dev`): load a `.AMOS` file, watch it run
  at 50 fps with keyboard/mouse/joystick input and an Input line box.
  The Files panel is a file manager over the same virtual filesystem the
  program sees: drop in files, folders or zips, then rename, delete, make
  drawers, relabel volumes, and drag rows between drawers to move them.
- **Objects** (`src/runtime/objects.ts`): sprite/icon banks decoded
  planar → chunky; bobs render as composite-time overlays (equivalent to
  autoback — the framebuffer keeps its background), hardware sprites
  draw over everything with colours 16-31; Paste Bob/Icon stamp the
  framebuffer; Get Bob grabs it; pixel-precise Bob Col/Sprite Col/Col;
  zones (Set Zone/Zone()/Mouse Zone); Load "x.abk" installs banks at
  runtime.
- **Pictures**: IFF ILBM loader (ByteRun1, CAMG modes, EHB palettes,
  palette-only files) for Load Iff, and a Pac.Pic decoder ported
  line-by-line from UnPack_Bitmap in `+Lib.s` for Unpack — all 16 corpus
  Pac.Pic banks decode pixel-perfect. Files resolve through a virtual
  filesystem (`AmosFS`) with Amiga assign mounts and case-insensitive
  paths.

- **AMAL** (`src/runtime/amal.ts`): the animation language, reimplemented
  from TokAMAL/Animeur in `+W.s` and stepped per channel each frame.
  Faithful semantics: lowercase = comments, strictly left-to-right 16-bit
  expressions, 8.8→16.16 fixed-point Move slopes with half-pixel bias,
  10-jumps-per-frame budget, background Anim, autotest `AU(...)` with
  Direct/eXit, For/Next, single-letter labels, Z()/XM/YM/K1/K2/J0/J1/
  BC/SC/C/XS/YS/XH/YH. Channels drive bobs, sprites, Screen Display and
  Screen Offset; BASIC sees Amreg (read/write), Chanan, Chanmv, Amalerr,
  Synchro modes and Amal On/Off/Freeze. AMAL bank programs (Amal n,#) and
  PLay paths are not supported yet.

- **Audio** (`src/runtime/audio.ts`): sample banks (format from GetSam
  in the Music extension source), Sam Bank/Play/Stop/Loop, Volume,
  Vumeter, and synthesized Bell/Shoot/Boom — all behind an `AudioSink`
  (WebAudio in the browser, a recording NullAudio headless). Tracker
  music and speech are not implemented.

See `UNIMPLEMENTED.md` for the full gap list and the honesty list of
simplifications.

Census after milestone 3: 373/393 corpus programs run to a stop, 26 end
with nothing skipped. The remaining skip list is dominated by the
Interface language (Dialog/Choice), audio (Sam Play/Vumeter/speech),
Print Using, and hardware pokes (copper lists, Leek/Poke — mostly
Planet Zybex).

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

`fixtures/` is not committed. Put `.AMOS`/`.Abk` files there, e.g. the
Amos-Professional-AGA-Releases corpus, or your own old games. The corpus
integration test and `src/cli/gentable.ts` expect `fixtures/official-amos`
(the `AMOS/` release tree from AMOS-Professional-Official) and
`fixtures/aga-releases`.
