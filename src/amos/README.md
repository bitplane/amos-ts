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

There is one window. `Ed_LoadHidden` and `Ed_RunHidden` are ported and an
accessory session needs two -- one being edited, one holding the accessory --
but `Amos.machine` builds the interpreter out of `this.window`, so a hidden
window's program cannot actually run. Until that moves, `Call Editor` from a
program `Ed_Run` started is always -6: it IS the current window, which is the
first thing `Ed_ZapIn` refuses.

There is also no key loop. `Amos.call` runs one command by number, which is
`Ed_FCall`, and a host that wants `Ed_Key` builds it out of `edKey` in
`src/editor/commands.ts`.
