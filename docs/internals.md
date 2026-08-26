# Subsystems, formats and semantics

What each part of the port covers, and what reading the original turned up
along the way. `KEYWORDS.md` is the per-keyword index and `UNIMPLEMENTED.md`
is where the port knowingly falls short; this is the middle ground.

## Subsystems

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
- **The editor**, in the browser and not only in a terminal. A program loads
  into a window and runs through `Ed_Run`, so `Edit` in a program comes back
  to the text it came from. All 184 `JFonc` commands, the key map matching on
  real scancodes, the mouse over `Ed_Mouse`'s zones, and the requesters
  running as the Interface programs they are: `Ed_InitDialogues`
  (`+Edit.s:3054`) opens dialogue channel 1 on program 1 of
  `AMOSPro_Editor_Resource.Abk` and every requester the editor has is a label
  in that one script.

## Formats and semantics

Format notes recovered so far, verified against the corpus and against the
assembly in `+Lib.s` and `+Edit.s`:

- Token ids are byte offsets into the library token table. Entries end in
  `$FF`, or `$FE`/`$FD` when an unnamed arg-count or function-form variant
  entry follows.
- Operators have ids that are negative offsets from the end of the editor's
  operator table (`=` is $FFA2, `+` is $FFC0, and so on).
- Control flow tokens (`If`, `Else`, `For`, `Repeat`, `While`, `Do`, `Data`,
  `Else If`) carry a 2-byte inline branch link. `On`, `Exit` and `Exit If`
  carry 4 bytes, and `Procedure` carries size, seed and flags, its size
  linking to `End Proc`.
- `Equ`, `Lvo`, `Struc` and `Struc$` carry 6 bytes: a longword value, a type
  digit and a flag byte. The Test pass looks the name up in
  `AMOSPro_System_Equates` and pokes all three in, so the value travels with
  the program and the run time never opens the file. Equates.Doc says why:
  "This allows you to send programs which contain Equates that someone else
  doesn't have access too."
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
