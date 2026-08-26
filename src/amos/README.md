# `src/amos`: the editor and the interpreter, joined

`src/editor` cannot run a program and `src/runtime` cannot open the editor.
The first would have to reach down past the layer it sits on, the second up.
That is a rule about this port's layering, not about AMOS, and this directory
is where the rule stops mattering.

On the machine there is nothing to join, because `Prg_RunIt` (+Verif.s:4336)
is not a call. It ends in `JJmp L_New_ChrGet`, the editor's stack is discarded
with `move.l BasSp(a5),sp`, and the editor gets control back only when the
program stops and longjmps to `Prg_JError`. Neither half returns to the other,
so neither half needs to know the other exists. What they share is `a5`.

## The display

`screen.ts` is `Ed_DrawTop` (+Edit.s:726) and `Ed_DrawWindows` (:11594), and
it draws nothing of its own. `Ed_OpenIt` (:305) opens `EcEdit`, screen 9,
through `L_Dia_RScOpen` like any other AMOS screen; `Ed_Appear` (:9646) makes
it current with `EcCalD Active,EcEdit`; everything after that is `WiCall
Print` of a string with console escapes in it. So the module opens screen 9,
unpacks the resource bank's furniture onto it, opens one AMOS text window per
editor window, and prints.

It is here rather than in `src/editor` because it needs `Screen` from
`src/runtime` and `Edit` from `src/editor`, and that is the whole reason this
directory exists.

Three numbers off the routine, since they read as arbitrary otherwise. A
window's AMOS windows are `Edt_Order * 8` and one past it (:11637), so the
first editor window is windows 8 and 9 and never window 0. The text window is
`Ed_Sx - 16` wide because a 16-pixel border runs down the right. The status
strip is `Ed_Sx - 32 - 64`, which is 68 characters, and that is where
`statusLine`'s default width comes from.

The program text is printed through `ESC J1` (system message 20), so a line
lands in plane 0 and the furniture in planes 1 and 2 survives being printed
over. That is the reason `ESC J` had to be ported at all.

DEVIATION: the memory bars are `L_Sl_Init`, the dialogue library's slider,
drawn through the sixteen colours of system message 23. That routine is not
ported; the proportion goes down in colour 4 and the rest in colour 0, which
are the two colours message 23 repeats. The figures are real.

DEVIATION: `EcFonc`, screen 8, is not opened. `Ed_OpenIt` sets `BitHide` on
it the instruction after opening it, and what it carries is the function-key
strip, which nothing calls up yet.

## The mouse

`Ed_Mouse` (+Edit.s:1206) asks `GetZone` and reads a number back, because
`Ed_DrawWindows` reserved one rectangle per part with `SyCall SetZone`. The
numbering is the whole answer: `Ed_BoutonsZones` is 128 and anything at or
above it is a top button; below it `zone & 7` says which part of the window
`zone & $FFF8` names -- 0 the text, 1 the status strip, 2 the bar below, 3 the
slider, 4 to 6 the three window buttons.

`EditorScreen.hitTest` is that lookup as arithmetic over the same rectangles,
and `Amos.mouse` is the dispatch. What the twelve top buttons run is system
message 13, one byte each: Escape, Workbench, Run, Test, Indent, Monitor, the
user menu, the two window steps, Insert, Open Procedure, Insert Line.

Two numbers that look arbitrary and are not. A click on the cell the cursor is
already in starts a block rather than moving it, and only on the press. A HELD
button does nothing for twenty polls and then moves the cursor every poll,
which is the drag that makes a block and the reason a twitch does not.

## The menus

The editor's menu bar is not the editor's. `EdM_Init` (+Edit.s:12579) walks
two blocks of the configuration -- `EdM_Definition`, one eight-byte record per
entry, and `EdM_Messages`, one label per record -- and hands each pair to
`EdM_ObCree`, which builds an ordinary AMOS MENU object with `L_MnFind` and
`L_MnIns`. So it is the same menu system `Menu$` gives a program, and
`src/runtime/menu.ts` is that system.

`menu.ts` here is the walk, the ink pairs `EdM_ObCree` writes, and the table
that turns a chosen path back into a command number. The right button is
`Ed_Mouse`'s FIRST test (:1249) and a pick ends the routine, so bit 1 never
reaches the window zones.

`EdM_BranchAMOS` (:12758) rebuilds the AMOS branch from the window list, which
is why the bar is rebuilt whenever that list changes. The three sections after
the first star record are its head, the per-program template, and its tail; a
program's three entries are numbered off `HiddenCommands` and `Ed_FCall`
(:2595) reads the program index back out of one number.

DEVIATION: `EdM_MarkAll` ticks the program the editor is showing. Nothing here
does, so the entries are told apart by name.

## The requesters

They are Interface programs, and this port already had the Interface language.
`Ed_InitDialogues` (+Edit.s:3054) opens dialogue channel 1 on program 1 of
`AMOSPro_Editor_Resource.Abk` -- that bank's graphics, the EDITOR's message
table, sixteen variables, a 1KB buffer -- and `Ed_DoDialog` (:3128) runs
`L_Dia_RunProgram` with the EdD_ number as the LABEL. Every requester the
editor has is a label in one 7,520-character script. `dialogue.ts` opens that
channel and `src/runtime/dialog.ts` runs it, so the requesters here are the
real ones and not a drawing of them.

Two numbers the script needs and does not carry. `Ed_DiaImages` is 66 and goes
into `Dia_PuzzleI` the instruction after the channel opens, so `UN 0,0,BP 13+`
means image 79 and not image 13; without it the requesters stamp the editor's
own buttons for their frame. And the messages are `Ed_Messages`, not the
bank's own seven strings, so `SV0,20ME` is "Quit AMOS Professional. Are you
sure?".

What does not come free is the waiting. `Ed_DoDialog` does not return until a
button is pressed and the command that asked is sitting in the middle of
itself; a browser cannot do that. `requester.ts` abandons the command instead,
the host puts the requester up over as many frames as the user takes, and then
the command runs AGAIN with the answer waiting for it. `Ed_Zappeuse` is why
that shape is legal at all: under `Call Editor` the machine's own
`Ed_Dialogue` answers `Ed_ZapParam` without drawing anything.

DEVIATION: whatever a command did before it asked, it does twice. Every
command that asks opens with `Ed_TokCur` and then asks, and writing the edit
buffer back twice changes nothing, but nothing checks that a command asking
LATE is not written.

DEVIATION: `Ed_File_Selector` (:14059), `Ed_LinkCursor` (:2342) and
`Mn_GetOption` (:5733) are not requesters and are not run here. The first is
its own routine, the other two wait for a click.

DEVIATION: the two separator drags are not ported. `Ed_MSepHaut` and
`Ed_MSepBas` follow the pointer until the button comes up, and `hitTest`
answers `status` and `bottom` for their zones without acting on them.

DEVIATION: a repaint redraws the whole editor. The machine repaints what
changed: `Edt_EtatAff` is seven bits saying which status fields are stale and
`Ed_ALigne` redraws one row.

## The shape

`Ed_Run` (+Edit.s:8165) does the editor's half and hands a `RunRequest` to
`Editor.runProgram`. `Amos` keeps it, lets the command finish, and only then
builds the interpreter, because running inside the command would nest the
program in a stack frame the machine has already thrown away. When the program
stops, `edRunReturn` re-enters the editor with `RunErr`'s d0.

Those numbers are the whole protocol. `RunErr` (+ILib.s:1267) is one exit with
a number in d0: 10 is End, 9 is Stop, 1000 Edit, 1001 Direct, 1002 System, and
anything from 1 to 255 is a run-time error. `Ed_Errr` (+Edit.s:8261) branches
on them and nothing else.

## What is copied that the machine does not copy

`Prg_SetBanks` (+Verif.s:4714) is five instructions between an `a0` save and
its restore, and they are what the two halves share:

    lea     Prg_Banks(a6),a0
    move.l  a0,Cur_Banks(a5)
    lea     Prg_Dialogs(a6),a0
    move.l  a0,Cur_Dialogs(a5)
    move.l  Prg_StBas(a6),Prg_Source(a5)

The banks are shared here too. `ProgramBuffer.liveBanks` is `Cur_Banks(a5)`,
and while an interpreter exists the editor reads the banks through it, so
`Reserve As Work 10,100` inside a program leaves a bank the editor then saves
with the source. Only `Prg_New` erases them: `Prg_RunIt` clears the variables
and nothing else, so the bank is still there on the second Run.

DEVIATION: the source is not shared. The window's program is written out as a
`.AMOS` image and loaded, so `Prg_Source(a5)` points at a copy and an edit made
while the program runs cannot reach it. `Prg_Reloaded` (+Equ.s:1863) is the one
thing that comes back the other way, because the editor's return path reads it.

`VerPos(a5)` comes over too. `rErr1` (+ILib.s:1370) stores `d7-2` there, which
is the token the interpreter last read, and `AmosRuntimeError.at` is the same
byte: `parseSource` records an offset per token and the interpreter reads
`pc.ti - 1` out of it. `Ed_Ligne` cuts its 73-character window around that
column, and `Ed_ErrEdit` puts the cursor on it.

## The remote control

`Call Editor` and `Ask Editor` are the other direction: an accessory driving
the editor rather than the editor running a program. `Runtime.editorZap` is the
door, and it is two methods because `Ed_ZapX` (+Edit.s:2737) answers in d0 and
a0 and that is all either keyword sees. `src/editor/zap.ts` is the far side.

The two answers are not shaped the same and the machine is where that comes
from. `Call Editor` ends in `ZapReturn` (+ILib.s:1763), which clears `Param$`
and fills it only when d0 is not zero, so a command that worked says nothing.
`Ask Editor` writes its own four instructions instead (+ILib.s:1635) and hangs
the string on `tst.w d2`, so a question answering text answers it whatever the
value is.

With no editor -- a program run from the CLI -- both are `tst.l
Edit_Segment(a5) / beq FonCall`, and this port raises the same Illegal function
call. Three of CRAFT's accessories in the corpus stop there, which is what they
would do on a real machine started the same way.

## What is not here yet

The monitor. `Ed_GoMonitor` runs, and answers "Monitor not found." because
`Editor.loadMonitor` has nothing to load: +Monitor.s is a 68k debugger and
belongs with the m68k work.

The escape screen is here, but only its two ends. `Ed_Escape` hides the editor
and `escapeBack` brings it back; what happens in between is
`Runtime.directScreen`, which has the buttons, the function keys and the
one-line editor already. `Esc_Loop`'s own arrows, which resize the escape
screen against `Es_Y1`/`Es_Y2`, are pixel geometry and are not ported.

The window that runs is the one `Ed_Run` named. `Edt_Runned(a5)` is that
window and it is not always the current one: `Ed_RunHidden` (+Edit.s:8105)
runs a program in a window with no screen area at all, and `Amos.machine`
used to build the interpreter out of `this.window` whatever it was asked for.

That is also what `Call Editor` needed. `Ed_ZapX` (:2737) opens by comparing
`Edt_Runned` with `Edt_Current` and refuses -6 when they are the same, so with
one window there was nothing else for them to be. The other half is `.PRun`
(+Verif.s:4366): asking for an accessory run only lets a program that IS one
take the accessory path, and what makes it one is `Set Accessory`, which the
Test pass counts (`VerSetA`, :825) and `ProgramBuffer.accessory` now carries.

There is no key loop. `Amos.call` runs one command by number, which is
`Ed_FCall`, and a host that wants `Ed_Key` builds it out of `edKey` in
`src/editor/commands.ts`.
