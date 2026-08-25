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
- `session.ts` — `AMOSPro_Editor_LastSession`, the two structure lists written
  as memory and relocated on the way back in.
- `zap.ts` — `Ed_ZapIn` and `Ed_ZapFonction`, the far side of `Call Editor` and
  `Ask Editor`.
- `menus.ts` — `EdM_Definition` decoded, and the AMOS branch's page of hidden
  programs.

179 of the 184 `JFonc` entries run. The 5 left fall into groups rather than
gaps: the interpreter (77, 105, 111), `Ed_Escape` (28), which waits on the
escape screen, and `Ed_GoMonitor` (145), which is +Monitor.s and 4,291 lines
of its own.


## The About box says nobody bought this copy

`Ed_About` (+Edit.s:4580) decodes two fields with `Sys_UnCode` (+B.s:595), a
XOR over a length-prefixed string: `UserReg` with $73 and `UserName`, sixteen
bytes further on, with $A5. Install.AMOS writes the buyer's details over both.
The shipped source (+B.s:314) holds "REGISTRATION #" and "Not Installed!"
spelled out one `dc.b "R"^$73` at a time, so an uninstalled AMOS Professional
puts those two strings where a name and a number belong.

`Ed_AboutExt` (:4609) browses the twenty-six extension slots one at a time,
and puts its own requester up again rather than returning to `Ed_Loop`, so the
whole browse is one command. Its Previous and Next write the slot number only
when they find a library, so at either end the button shows the same extension
again and nothing says the list has run out.


## Edt_Y is a sum, not a field

The four status bar arrows (13 to 16) work in PIXELS. `Ed_EtatMove`
(+Edit.s:1512) reads `Edt_Y`, adds `moveq #8,d0`, checks it against the two
bounds `Ed_RShLimits` (:1439) computed, and hands the result to
`Edt_WChangeHaut` (:12226), which writes `Edt_Y` and `Edt_BasY` back.

This port stores neither, because `Edt_WMaxSize` (:12511) gives the reason not
to: its walk adds `Ed_TitreSy`, then each visible window's two bars and its
rows, and stops at the window it was asked about. That sum IS `Edt_Y`. So
`topY` and `basY` add it up on demand and `Edt_WChange` becomes what it
already was underneath: a change to the neighbours' `Edt_WindTy`.

Both bounds are exclusive. `bls` refuses a position at the minimum and `bge`
one at the maximum, so an arrow stops one text row short of emptying the
window it is pushing against. It cannot empty the last window either, but only
because the windows tile the screen: `Edt_WChangeHaut`'s `.Last` arm lets the
top arrive at the bottom, and `Edt_WPlaceBas` returning a shortfall is
ignored.


## The printer is Par:

`Ed_PRTOpen` (+Edit.s:13974) is `moveq #43,d0 / JJsr L_Sys_GetMessage`, and
system message 43 is `Par:` (+Interpreter_Config.s:153, in the block headed
"Ports de communication"). Print Program and Print Block write to the parallel
port raw. printer.device is not opened, so the Preferences driver, the page
size and the character set never come into it, and a serial printer cannot be
reached at all. `L_PRT_Open` (+Lib.s:5411) takes the same message, so `Lprint`
goes the same way.

`Ed_PRTPrint` rewrites the string over itself before the write. When
`PI_PrtRet` is clear, a 13 whose next byte is a 10 is replaced by that 10, for
a printer that supplies its own line feed. `.Ip2` then measures how far the
READ pointer got, which counts the input, so each dropped carriage return
sends one byte of the buffer's old contents past what the loop built. With one
line ending per call that byte is the string's terminating zero. The shipped
`PI_PrtRet` is 1, so nothing hits it out of the box, and +Lib.s:5478 has the
same arithmetic.


## The 1.3 verdict is thirteen `bsr`s

`SetNot1.3` (+Verif.s:214) is two instructions and it decides what header the
next Save writes. `PTest` clears `VerNot1.3` at :76, the walk raises it and
never lowers it, and `Prg_TestIt` (:4428) copies it into `Prg_Not1.3`. A Pro
program that uses nothing beyond 1.3 is saved as `AMOS Basic v134` and runs
under 1.3.

Nine of the thirteen callers are in the walk: the three Pro classes in the
instruction table (29-AMOSPro, 2A-deja testee, 2C-variable reservee, with
50-Dialogues and 55-Procedure langage machine going to the first of them),
`Set Double Precision`, `Set Accessory`, `Trap`, `Equ_Verif`, `Ope_Array` and
the double-precision constant. `Ope_ProNormal` (:2652) is a tenth that no
table entry points at, so a Pro-only FUNCTION does not raise the flag on its
own; only the instruction table has a Pro class.

The other three are outside it. `Get_Includes` flags `Include` before the walk
starts, which the walk would have done anyway since `Include` is class 29.
`Ver_APCmp` flags a machine-code procedure whose body opens with `||apcmp||`,
which is what the AMOS Pro compiler writes. And after the walk is over, a bank
numbered above 16.

`Ed_Check1.3` (147) sets `VerCheck1.3`, which turns the flag into a stop: the
first construct 1.3 lacks ends the test with error 47 on its own line. `PTest`
clears the check at :186, ABOVE the bank loop, so message 48, "too many banks",
is reachable no other way -- anything in the source would have stopped the walk
before the banks were counted. Message 49 means the walk found nothing at all.


## A requester is a channel, a zone and a slot

`Ed_Dialogue` (+Edit.s:3107) runs an Interface program out of the resource
bank, and what it shows beyond its own text comes from `Ed_VDialogues`, the
sixteen variables `Ed_InitDialogues` opens channel 1 with. A requester that
asks a number reads it back with `Dia_GetValue`, whose d0 is the CHANNEL and
whose d1 is the ZONE: every editor caller passes channel 1 and zone 3, and the
two that ask twice use 4 and 7 for the second field.

Set Tab is the one whose Cancel is not a cancel. `Ed_STab` (:3716) never looks
at `Ed_Dialogue`'s answer -- it reads the field and stores it whatever the user
clicked.

`Ed_GetPlace` (:9915) is the other. Its Cancel clears `Prg_Change` and falls
into the Set Buffer Size requester with the size the file needs already in the
field, so a program too big for its buffer offers you a bigger buffer rather
than giving up.

The Infos box fills eight slots and has six lines. `Bnk.GetLength` hands back
Bobs in d1 and Icons in d2 and both are stored, but slot 5 is written twice
more before the requester opens, first with `BMenage` and then with `VerNInst`,
and slot 6 has no message beside it. What the box shows is the last write.

`VerNInst` counts one per STATEMENT, not one per token: the walk dispatches
once per instruction and the instruction's own routine eats its arguments, so
`A=1+2*3` counts one. A `Procedure` header is walked in phase 0 and again in
its own phase, and `subq.l #1,VerNInst` (+Verif.s:1529) takes the first back.

## Editing the menu edits the configuration

The four commands over it write nothing but `Ed_Config`. Program To Menu is
the editor for `Ed_AutoLoad`, and the program's name and command line become
two messages of `Ed_MnPrograms`. Key To Menu writes two bytes of `Ed_KFonc`,
which is 552 bytes inside the same block. Add and Delete User write the
`EdM_User` labels. All four raise `EdC_Changed`, so Quit offers to save them.

`Ed_GetFsMessage` (:5290) is why deleting is not removing. It answers the
first EMPTY record of a block rather than the first slot past the end, so
Delete User empties the label and Add User finds that hole again. A block only
grows when there is no hole in it.

Key To Menu clears the old shortcut BEFORE it asks for the new one, and
rebuilds the menu in between. Cancel the keystroke requester and the entry is
left with no shortcut at all: `[1][0]` is written over the record and nothing
undoes it.

Add User does not stop at adding. It writes the label and then runs Program To
Menu and Key To Menu one after the other, so making an entry walks you through
binding a program and a key to it without asking whether you wanted to.

## The menu is in the configuration file, not in the editor

`EdM_Init` (+Edit.s:12579) builds the menu bar out of two blocks of
`AMOSPro_Editor_Config`: `EdM_Definition`, one eight-byte record per entry,
and `EdM_Messages`, one label per record. Every field of a record is stored
plus 48 and taken back with `sub.b #"0"`, so a menu level of 12 is the
character `<` and a command of 145 is `\xc1`. Nothing in it is decimal.

Byte 0 does two jobs: it is the command number AND the "actif / inactif" flag
`EdM_ObCree` is passed, so a separator, whose command is 0, is the same thing
as an entry that cannot be chosen. A byte below `"0"` is a title.

The records and the labels run in lockstep, and a `"*"` record breaks the run
without consuming a label, because `EdM_Init` tests for it only after it has
stepped both. The shipped block is 199 records, three of them stars, and 196
labels.

**F5 is not a Help routine.** `Ed_GoHelp` is `moveq #26,d2 / bra Ed_FCall` and
d2 is 0-based, so F5 runs command 27, which is one of the 46 `Ed_UserMenu`
slots whose whole body is a requester saying the option is not assigned. The
Help accessory appears because `Ed_AutoLoad` binds a program to that slot. The
same is true of 172 to 178, where the assembler's own comments name them:
Interpretor Setup, Editor Setup, Editor Menus, Editor Dialogs, Test-Time,
Run-Time and Colour Palette.

**One of the 46 cannot be reached.** `Ed_FCall`'s `cmp.w #HiddenCommands-1,d2`
sends d2 of 183 and above to the hidden-program decoder, and d2 is one less
than the command, so command 184 never reaches `JFonc` at all. Its
`Ed_UserMenu` entry is assembled and dead.

**Next and Previous are not symmetric.** Both step by `EdM_HiddenMax-1`,
eleven, while the page shows twelve, so the pages overlap by one. Previous
refuses at zero and floors at zero; Next simply adds, and what stops it is
`EdM_BranchAMOS`, which pulls the position back to `count - 12` every time it
rebuilds the branch.

## The remote control is the editor with the requesters short-circuited

An accessory reaches the editor through `Call Editor` and `Ask Editor`, and
`Ed_Zappeuse` is the whole mechanism. `Ed_Dialogue` (+Edit.s:3108) tests it
before it draws anything and returns `Ed_ZapParam` instead, so every question
the editor would ask has the same answer: the number the accessory sent.
`Ed_GotoL` is the one command that reads that answer as a NUMBER rather than
as a button, which is how Call Editor 76 goes to a line. `Ed_Alert` (:7595)
tests it too and becomes `Ed_ZapAlert`, so the message that would have gone on
the status line comes back as error -1.

`FlagFonc` decides what may be driven. Bit 7 marks a command zappable and 90
of the 184 have it; bit 6 says the command needs a string, and exactly four do
-- Save As Name, Close Name, Rename and New Config. `Ed_RAlert` sits among the
remote-control routines and is not zappable at all.

**Two of the thirteen functions cannot be called.** `EdZ_Jump` (:2826) has
thirteen entries and `EdZ_NFonc equ 11` under it, and `cmp.l #EdZ_NFonc,d0` is
the only bound check there is. `EdZ_Token`, which tokenises a line, and
`EdZ_GetConfig`, which hands back the address of `Ed_Config`, are written,
assembled and unreachable. `EdZ_NewConfig` has the same shape at the block
level: `cmp.l #5,d0` stops at the run errors, so the menu programs, the user
menus and the menu definitions cannot be changed from a program even though
they come out of the same file.

Every coordinate comes back 1-based, because `EdZ_Coo` adds one to all six on
the way out. The block corners prove it by exception: `EdZ_Bloc`'s no-block
arm pops its own return address (`addq.l #4,sp`) and answers -1 from the
function itself, so it never reaches the addition.

## The eighth text block is not messages

Seven of the eight are `[pad][length][bytes]` records ending in `$FF`.
`EdM_Definition` is the menu tree, eight bytes a record, read with `lsr.l #3`
and terminated by the block's own length. `EdC_ChangeTexte` rebuilds a block
from `old length + delta` rather than by counting the records, which is what
preserves the byte the assembler's `Even` left after the `$FF`: the shipped
system block is 748 bytes for 747 bytes of records, and stays 748 across a
change.

## The session file is a memory dump, and its loader relocates it

`Ed_DoQuit` writes `Prg_List` and `Edt_List` to
`AMOSPro_Editor_LastSession` as raw structures, 240 bytes each for a program
and 246 for a window, each behind `[address:4][length:4][0:4]`. The address is
where the block sat in the machine that wrote it. That is not sloppiness: it
is the KEY. `Edt_Prg` and the three window links are pointers into those same
two lists, so `.PCree` (+Edit.s:541) writes each structure's NEW address into
the record's third long and `.Linke` (:658) rewrites every pointer by looking
the old one up. Nothing else in the editor is stored this way.

The header goes on last. The file opens with eight zero bytes and closes by
seeking back to write `"ApLC"` and the byte count after them, so a quit that
dies halfway leaves a file with no magic number and `Ed_WarmStart` reads it as
absent rather than as damaged.

What a warm start does NOT restore is the program. The structure carries the
buffer size, the marks, the cursor and `Prg_StModif`; the tokens come off disc
again, by the name in `Prg_NamePrg`, and `Prg_Load` recounts the lines and
clears `Prg_Change` on the way in. Delete one of those files between sessions
and the whole restore fails: `.Err` frees both lists and opens one empty
window, because a half-restored layout is worse than none.

## Quit invents names, and takes them off again

With `Ed_QuitFlags` bit 3 up, `.SavAll` writes every program out, and a
program with no name gets `New_Project_` and its window's position in the
list. The order of the tests is what makes that interesting: `.NoName` is
reached before `Prg_Change` is looked at, so an untouched empty window is
written to disc, while a NAMED program that has not changed is skipped.

`Prg_NoNamed` is how the invention is undone. It counts up as the name is
made, travels in the file, and `Ed_WarmStart` (:620) reads the program back,
clears the name, raises `Prg_Change` and deletes the file. An untitled program
survives a quit without ever acquiring a title.

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

## A machine-code procedure is a fold with 68k in it

`Ed_ProcML` (+Edit.s:8681) is the whole of Insert Machine Language, and it
builds a procedure by hand. It copies the `Procedure` line byte for byte, ORs
`%0101000000000000` into the flags word at offset 10, appends a three-word
line holding `@_apml_@`, drops the code hunk in behind it and closes with a
bare `End Proc`. The size long at offset 4 is the lot less 14, which is what
`Tk_SizeL` adds back to step a fold.

The two bits are the lock and machine language, and they go on together. That
is why the editor never shows 68k where lines should be: `Ed_ProcOpen` leaves
a locked procedure alone, so a machine-code one cannot be unfolded.

The one word that is not copied or constant is the parameter offset, and it is
negative. `lea 10+6(a3),a0` (:8735) is the length byte of the procedure's own
name record, `lea 2+2(a0,d0.w),a0` steps the name, and the token that lands
under `-2(a0)` decides it: a `[` and the word is how far BACK the parameter
list is from the word itself, no `[` and it is zero. The parameters stay in
the header line and the routine is told where to look.

Two things go wrong. `.Plo0` (:8713) reads longs one after another until one
equals $3E9, so it never looks at the hunk table it is walking over: a load
file whose first hunk is 1001 longs holds $000003E9 as that hunk's size, the
scan stops there, and the marker becomes the length. `Pload` reads the table
size and skips it, so the same file loads one way and not the other. And the
procedure is folded by `.Reloop` BEFORE the file is opened, so a file that
turns out not to be relocatable leaves the fold behind.

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
