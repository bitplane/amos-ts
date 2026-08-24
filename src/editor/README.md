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
- `undo.ts` — the ring of six-byte records. The RECORDS are here; applying
  one is not, because seven of the eight actions replay through commands
  (`Ed_Delete`, `Ed_InsLine`, `Ed_PKey`) that do not exist yet. `Ed_Undo`
  steps the ring and hands the record back; the command layer will do the
  rest, with `suppressed` raised while it does.

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
