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
  hands the record back; applying one is the command layer's job, with
  `suppressed` raised while it does.
- `editbuf.ts` — `Edt_BufE`, one 256-byte slot per display row, which is
  where a line is TEXT rather than tokens.
- `edit.ts` — `Edt_`, the cursor and the cycle: `Ed_Untok` in, `Ed_PKey` and
  `Ed_Delete` on the text, `Ed_TokCur` back out to the program.
- `keymap.ts` — `Ed_Ky2Fonc` and `Ed_Fonc2Ky`, over the three tables in
  `keymap.gen.ts` that `src/cli/genedkeys.ts` reads out of the sources and
  checks against the shipped binaries.
- `commands.ts` — `JFonc` and `FlagFonc`. The cursor, the line editing, the
  marks and the long jumps; what a command needs that this port has not built
  yet is listed at the top of the file.
- `display.ts` — `Ed_ALigne` and the status line, as data rather than pixels.

Still missing before there is an editor a person can use: the block (`JFonc`
59 to 63), search and replace (66 to 68, 99 to 101), the file commands, and
applying an undo record. `undo.ts` hands the record back and nothing yet
replays it.

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
