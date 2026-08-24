# `src/editor`: the AMOS Professional editor

`+Edit.s` is 15,381 lines and this is the port of it. Everything here is the
program-editing side: the buffer, the line table, the commands `JFonc`
dispatches, the key map and the display. The interpreter that runs a program
lives in `src/interp` and `src/runtime`, and the tokeniser and Test pass that
the editor drives live in `src/tokens`.

## What belongs here

A module belongs in `src/editor` when the running program cannot reach it.
The editor's buffer, its cursor, its blocks, its marks and its undo are all
state a program has no keyword for. `Ask Editor` and `Call Editor` are the
only doors between the two, and they are EasyLife's, not AMOS's.

Three things that look like they belong here do not:

- **The tokeniser and detokeniser** (`src/tokens/edtok.ts`). They are
  `+Edit.s:14226` and `:14717`, so they are literally editor code, but the
  loader and every test needs them and the editor is a caller like any other.
- **The Test pass** (`src/tokens/verify.ts`). `Ed_Test` is a JFonc command;
  what it calls is `+Verif.s`, which is its own thing.
- **Direct mode** (`src/runtime/directscreen.ts`). The escape screen comes
  down over a running program and is drawn on an AMOS screen, so it belongs
  with the runtime that owns the screens.

## What is here so far

- `buffer.ts` — the program block, the line table and the marks.
- `undo.ts` — the ring of six-byte records. `Ed_Undo` steps the ring and
  hands the record back; `JUndo` and `JRedo` in `commands.ts` apply it.
- `editbuf.ts` — `Edt_BufE`, one 256-byte slot per display row, which is
  where a line is TEXT rather than tokens.
- `edit.ts` — `Edt_`, the cursor and the cycle: `Ed_Untok` in, `Ed_PKey` and
  `Ed_Delete` on the text, `Ed_TokCur` back out to the program.
- `keymap.ts` — `Ed_Ky2Fonc` and `Ed_Fonc2Ky`, over the three tables in
  `keymap.gen.ts` that `src/cli/genedkeys.ts` reads out of the sources and
  checks against the shipped binaries.
- `commands.ts` — `JFonc` and `FlagFonc`, plus `JUndo`/`JRedo` and the key
  half of `Ed_Key`. The cursor, the line editing, the marks, the long jumps
  and the undo replay; what a command needs that this port has not built yet
  is listed at the top of the file.
- `display.ts` — `Ed_ALigne` and the status line, as data rather than pixels.
- `block.ts` — `Ed_Block`, the clipboard, and the three-part shape a block
  has to have. The operations on it are in `commands.ts`, with the rest of
  `JFonc`.
- `search.ts` — `SchBuffer`, `RepBuffer` and the two line walks the six search
  and replace commands share. The commands themselves are in `commands.ts`.
- `files.ts` — `Prg_Load` and `Prg_Save`, the two headers, and the four calls
  the editor makes to dos.library.

Still missing before there is an editor a person can use: the macros.
`Ed_Key` reads `EdMa_Play` before it reads the keyboard and writes `EdMa_List`
while one is recording, and none of that is here. Four file commands need a
second window and wait on one: Merge (84), Load Hidden (88), Open + Load (61)
and New All Hidden (102) all open a hidden `Edt_` structure and load into it.

## A saved program is exact, and its header is not

`Prg_Save` writes the header CONSTANT, `lea H_Pro(pc),a0`, so the version
string in the file is the saving editor's and not the file's. Reading and
writing all 3,960 corpus programs reproduces the source and the banks byte for
byte and rewrites the version on 2,396 of them: `AMOS Basic V1.3 ` becomes
`AMOS Basic V134 `, `AMOS Pro111v` becomes `AMOS Pro101v`.

The header is not a version stamp either way. `Prg_Not1.3` is the Test pass's
verdict on whether the program would run under AMOS 1.3, and byte 15 is the
maths flags Test worked out. Byte 11 is `V` or `v` for tested or not, and
`Prg_Load` never reads it: the load raises `Prg_StModif` unconditionally, so a
program always comes back from disc untested.

There is no bank writer in this port. `Bnk.Load` and `Bnk.SaveAll` are the
machine's, and what `ProgramBuffer.banks` holds is the bytes that followed the
source, kept to be written back unread.

## Search reads the listing, not the tokens

`Ed_SchFront` detokenises each line into `Ed_BufT` and runs `SchBuffer` over
the characters, so the editor searches what is on the screen rather than what
is in the program. Two things follow. A closed procedure detokenises to its
`Procedure` header and nothing else, so text inside a fold cannot be found or
replaced. And every one of the six commands opens with `Ed_TokCur`, because
the line being typed has to be back in the program before the walk reaches it.

Backwards is forwards, repeatedly: `Ed_SchBack` searches from line 0 and keeps
the last match before the cursor. There is no reverse scan anywhere in the
file.

## The requesters are the host's

`Ed_DiaS` (:6962) fills `Ed_SchBuf` and `Ed_SchMode` off an Intuition
requester, and this port has no Intuition. `Edit.dialogues` is where a host
puts one; null means the commands run on the buffers as they stand. The four
mode bits are the requester's four gadgets and nothing else reads them, so a
test sets `schMode` directly.

## A block is three things, not one

Because a program is tokens and only the line being edited is text, a block
between two arbitrary points cannot be one kind of thing. `Ed_BlockCopyA0`
keeps the first line's tail and the last line's head as CHARACTERS and
everything between as raw tokens, copied byte for byte. That is what makes a
paste cheap: `Ed_StoBlock` opens the gap and moves the middle in one go, and
only the two ends go through the tokeniser. `block.ts` has the layout.

## Undo runs the commands rather than restoring state

`JUndo` (+Edit.s:2030) is eight entries and most of them are a command.
`Un_Char` calls `Ed_Delete`, `Un_Join` calls `Ed_ReturnQuiet`, `Un_DLine`
calls `Ed_InsLine`. `Ed_FUndo` raised around the `jsr` is the only thing
stopping that from recording itself and going round in a circle, which is why
it is a counter and not a flag. Two of the sixteen entries are shared: a
split undone and a join redone are one routine with two labels on it.

## An alert is not an error

`Ed_Alert` (+Edit.s:7595) ends in `bra Ed_Loop`, not `rts`. It puts a message
in `Edt_EtAlert`, raises `EtA_Alert` and abandons the command wherever it had
got to, so the alert IS the control flow and `EditorAlert` is thrown to
reproduce it. That does not make it a failure. "Top of text" is what Home
says when it has worked, and `edCall` answers the message number rather than
throwing it on.

## The one thing to know before reading `buffer.ts`

A program being edited is not a list of lines. It is one block of tokens with
a zero word on the end, and the line table is a walk from the top. A closed
procedure counts as ONE line however many lines it holds, so folding one
changes every line number after it and nothing is cached that would have to be
told. `buffer.ts` says the rest.

## Citations

The same rule as everywhere else: `+Edit.s:11126` and `$7666` are checkable,
"the editor does" is not. Line numbers are the corpus copy, per
`CLAUDE.md`. Routines that live in the library rather than the editor say so:
the line walk is `Tk_FindL` in `+Verif.s`, not `+Edit.s`, because `Ed_FindL`
is four instructions around a `JJsrR`.

Two numberings for the same 184 commands, both in +Edit.s. `Ed_Ky2Fonc`
counts from 0 and `Ed_Fonc2Ky` twelve lines below counts from 1. This port
takes the 1-based numbers, because those are the ones the source's comments
and the manual use.
