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
- `macros.ts` — `EdMa_`, the keystroke tape and the list it goes into.
- `windows.ts` — `Edt_List`, the windows, and everything an `a5` offset holds
  that a window does not. The commands over it are in `commands.ts`.
- `indent.ts` — `Indent`, the two counters that decide every line's indent
  byte.
- `config.ts` — `Ed_DConfig` and `AMOSPro_Editor_Config`: the block the editor
  remembers between sessions, and the eight text blocks behind it.

104 of the 184 `JFonc` entries run, and 46 of the rest are `Ed_UserMenu` slots
that never were commands. What is left falls into groups rather than gaps: the
interpreter (77, 111), the menus (73, 74, 135, 136, 179, 180), Quit and the
session file (82), the printer and the About boxes (86, 146, 148 to 151), the
ZAP remote control (69, 71, 182), the requesters that ask for one thing (26,
76, 83, 104), and the status bar's four arrows (13 to 16). `Ed_GoMonitor` (145)
is +Monitor.s and 4,291 lines of its own, and `Ed_Check1.3` (147) waits on a
verdict this port's verifier does not keep.

## The configuration is a memory block with a length on the front

`Ed_DConfig` is 1,202 contiguous bytes and the file is those bytes with their
own length written in front of them, then eight length-prefixed text blocks.
There are no field names on disc. `+Editor_Config.s:28` carries each offset as
a comment beside its default, because the offset IS the format.

The length is also the whole of the validation. `EdC_Load` compares it with
`Ed_FConfig-Ed_DConfig` and refuses a mismatch, and looks at nothing else.
`Ed_ConfigHead equ "ApCf"` is declared and used nowhere, and `Ed_Code` at 1198
is the four characters "1.10" and read by nothing: the file has both a magic
number and a version, and the loader ignores them.

Reading the shipped `AMOSPro_Editor_Config` back out gives the five message
tables this port generates from the assembler source, byte for byte, and three
more it had no copy of: the menu programs, the user menus and the menu
definitions.

## A command can be a program

`Ed_AutoLoad` is three bytes for each of the 184 commands, and `Ed_FCall`
(:2610) tests the first before it reaches `JFonc` at all. The shipped
configuration binds 37 commands to `AMOSPro_Help.AMOS`, and three of them are
real editor commands: 152, 153 and 154. So Save As Name from a menu runs Help,
and the same number from the ZAP remote control saves the program, because
`.Prg` tests `Ed_Zappeuse` before it branches.

## The Test pass is not a syntax check

`PTest` WRITES. It fills the link words, promotes names, and puts the size of
every procedure body into the `Procedure` line at offset 4. That last one is
why Open/Close, Close All and Indent all run `Ed_VaTester` before they touch
anything: a fold is stepped over by that size, and a procedure that has never
been tested carries a zero, so closing it lands 14 bytes into the middle of the
line's own name record.

Only a CLOSE tests. `btst #7,10(a2) / bne .PaOu` (+Edit.s:8823) jumps over the
call when the procedure is already closed, because nothing needs a size to
unfold.

`Prg_StModif` decides whether there is anything to do, and it is cleared BELOW
the call to `PTest` (+Verif.s:4427). An error never reaches that instruction,
so a program that fails Test stays modified and the next command tests it
again.

A failed Test leaves the cursor on the byte the walk stopped at, and when that
byte is inside a CLOSED procedure the cursor cannot go there: the column drops
to 0 and the real one is kept in `Prg_XEProc` against the fold being opened.
`Ed_ClEProc` (:8861) then runs before every command body, and the address is
worth exactly one of them.

## A window is a view, and `a5` is the editor

`Edt_` is one window and `Edit` is the port of it. What `Edit` does NOT own is
the two dozen fields that live at an `a5` offset instead: the search string,
the macros, the filename, the clipboard. Those are `Editor` in `windows.ts`,
and a window reaches them through accessors, so `e.schBuf` still reads the
search string and two windows on one editor genuinely share one.

`Ed_Block` is the clearest of them. One pointer for the whole editor means a
block cut in one window pastes into another, and there was never a decision
about it.

`Edt_Prg` is a pointer too. Split View (+Edit.s:2448) points a second window at
the same program and `Prg_Edited` counts the views, so the list is a list of
VIEWS and the programs behind it are however many distinct values it holds.
Splitting also frees the program's undo history and clears all ten of its
marks, because `Edt_New` runs `Prg_UndoCreate` on a6 and the split path never
loaded a6 with anything.

The vertical arithmetic is here and the pixels are not. `Edt_WindTy` is a count
of TEXT ROWS and it IS the edit buffer's row count, because `Ed_DrawWindows`
hands each window a slice of one allocation. `Ed_WMax` is `(Ed_Ty - 6) / 3`,
which is 8 on the shipped 256-line screen, and a window on its own gets 28
rows. `Edt_Y`, the sliders and the three buttons per window are dropped.

Both wraps in Next Window and Previous Window go to an END OF THE LIST rather
than to a visible window, and `Edt_Active` tests nothing but the height. A
window hidden by Hide Project keeps the height it had, so wrapping round onto
one makes the editor current on a window with no screen area.

## A macro is above the key map

`Ed_Key` (+Edit.s:1552) does three things before `Ed_Ky2Fonc` sees anything.
It reads the tape if one is playing, it writes to the tape if one is
recording, and it looks a live keystroke up in the macro list. So a macro
holds whatever a person could type, and the key map is what expands it.

The three arms do not compose. A key that comes out of a macro jumps straight
to the dispatch, and so does a key that has just been recorded, so a macro can
neither call another one nor record itself. That is one `bra .EndMac` in each
arm, and it is the whole of the nesting rule.

`macros.ts` has the file format, which is the linked list dumped to disc with
its link pointers in it.

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
