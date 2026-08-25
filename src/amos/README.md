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

DEVIATION: the machine runs the program in the editor's own memory.
`Prg_SetBanks` (+Verif.s:4714) points the interpreter at the same banks the
editor holds, so a `Reserve` inside the program leaves a bank the editor can
save with it afterwards.

Here the window's program is written out as a `.AMOS` image and loaded, so the
interpreter gets a copy and what the run changed in its own banks is gone when
it stops. `Prg_Reloaded` (+Equ.s:1863) is the one thing that does come back,
because the editor's return path reads it.

DEVIATION: `VerPos(a5)` is the byte the program stopped ON, and
`AmosRuntimeError` carries a line number. So the cursor lands at the start of
the failing line rather than on the token, which is a column short of what
`Ed_ErrEdit` does.

## What is not here yet

`Ed_GoMonitor` (JFonc 145), the one command the editor still cannot run:
+Monitor.s is 4,291 lines of its own.

The escape screen is here, but only its two ends. `Ed_Escape` hides the editor
and `escapeBack` brings it back; what happens in between is
`Runtime.directScreen`, which has the buttons, the function keys and the
one-line editor already. `Esc_Loop`'s own arrows, which resize the escape
screen against `Es_Y1`/`Es_Y2`, are pixel geometry and are not ported.

There is also no key loop. `Amos.call` runs one command by number, which is
`Ed_FCall`, and a host that wants `Ed_Key` builds it out of `edKey` in
`src/editor/commands.ts`.
