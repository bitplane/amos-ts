You are auditing ONE keyword of amos-ts, a TypeScript port of AMOS Professional
(an Amiga BASIC from 1992). Below you are given the ORIGINAL 68000 routine, read
out of the shipped AMOS Pro assembler sources, and the PORT's handler.

Decide whether the port does what the original does.

## Rules

1. **The assembler is ground truth.** The port's comments are claims under
   audit, not evidence. If a comment says the original does X, check X against
   the assembler yourself. A comment citing a line number proves nothing about
   what is at that line.
2. **Every finding quotes both sides.** Give the assembler line you read it
   from and the line of the PORT'S HANDLER that disagrees with it. Quote the
   handler, never a test: a test is evidence about the test. A finding with no
   quoted assembler line is not a finding. Drop it rather than reword it.
3. **Say when you cannot tell.** If the original branches into a routine you
   were not given, you cannot judge behaviour that depends on it. That is a
   finding of kind `unreadable`, naming the routine. Never guess what an
   unseen routine does.
   Read the helpers before claiming this. The port's handler is often three
   lines that call something, and the something is given to you further down
   under "the port's handler calls". `unreadable` is for what is genuinely
   absent, not for what you did not scroll to.
4. **Behaviour only.** Do not report style, naming, TypeScript idiom, speed,
   or missing tests. Report only what a running AMOS program could observe,
   plus prose that is false.
   A different SHAPE is not a difference. "The original goes through
   `L_GfxFunc` and the port calls `ellipse` directly" describes two ways of
   drawing the same ellipse, and is not a finding. Ask what a program would
   see, and if the answer is "the same thing", say nothing.
5. **Both directions count.** A check the original makes and the port does not
   is a finding. So is state the port writes and the original does not.
6. At most 5 findings, most serious first. Most keywords should come back
   clean, and a clean verdict with no findings is a good answer.
7. **Check the error paths.** Missing validation is the most common real
   defect: the original rejects an argument the port accepts. Compare every
   `Rb*` to an error routine against the port's `throw`, and say which AMOS
   error the original raises.

## Reading the 68000

These are facts about this codebase, not guesses. Rely on them.

- `Rbra`, `Rbsr`, `Rbeq`, `Rbne`, `Rbmi`, `Rbpl`, `Rble`, `Rbls` and the rest
  are macros wrapping a branch to a routine: `Rbeq L_ScNOp` is "branch to
  L_ScNOp if equal".
- `L_FonCall` raises AMOS error "Illegal function call". `L_Syntax` is a syntax
  error. `L_ScNOp` is reached when no screen is open and RAISES, error 47.
- **`moveq #n,d0` before `L_EcWiErr` is not error n.** `EcWiErr` (+Lib.s:12917)
  is `cmp.w #1,d0 / Rbeq L_OOfMem / add.w #EcEBase-1,d0 / Rbra L_GoError`, and
  `EcEBase equ 45` (+Equ.s:771), so it adds 44. d0 = 1 is Out of memory
  instead. The AMOS error a program sees is therefore n + 44:
  `L_ScNOp` is `moveq #3,d0` and error 47 "Screen not opened"; `L_BFonCall`
  (+Lib.s:12998) is `moveq #22,d0` and error 66 "Illegal block parameters";
  `L_WFonCall` is `moveq #16,d0` and error 60. Routines that reach
  `L_GoError` directly, like `RunErr`, do NOT add anything, and `moveq #41,d0 /
  bra RunErr` really is error 41. Name the number a program sees, and say which
  route you followed to it.
- **Arguments.** The LAST argument of the keyword arrives in `d3`. The rest sit
  on the AMOS argument stack and `(a3)+` pops them RIGHT TO LEFT, so for
  `Bar x1,y1 To x2,y2` the first pop is `x2`, the second `y1`, the third `x1`,
  and `d3` holds `y2`.
- `cmp.w d0,d2` followed by `Rble` branches when `d2 <= d0` (the operand
  order is source, destination, and the condition is on the destination).
- `a5` is the AMOS global base, so `ScOn(a5)` is a named global. `a1` is
  usually the current RastPort; `36(a1)` and `38(a1)` are its pen x and y.
- `tst.w ScOn(a5)` / `Rbeq L_ScNOp` at the top of a routine means "error 47 if
  no screen is open".
- French comments are the original author's.

## Already known — do not report these

True, recorded, and repeating them on every keyword buries what is specific to
yours.

- **No screen open.** `scr()` is `rt.screen`, a getter that THROWS
  `screen not opened`, and so does the original: `L_ScNOp` is `moveq #3,d0 /
  Rbra L_EcWiErr` (+Lib.s:12907), and `EcWiErr` adds `EcEBase-1` = 44 to reach
  AMOS error 47, "Screen not opened". `Rbeq L_ScNOp` raises, it does not
  return. The port agrees, so say nothing about it.

- **Spec `5` converts the argument before the routine runs.** `Sin`, `Cos`,
  `Tan`, `Hsin`, `Hcos` and `Htan` are spec `15`, which selects `Par_Angle`
  (+ILib.s:813): it evaluates the argument, forces it to float and applies
  `L_FFAngle` (+ILib.s:7601), degrees to radians, BEFORE reaching the routine.
  All six routine bodies are a bare `moveq #_LVOSPxxx,d2 / Rjmpt
  L_Math_Fonction` with no conversion in sight, so reading the body alone says
  the port converts and the original does not. It is the other way round. The
  port's `toAngle` is `FFAngle` and its `fromAngle` is `AAngle` (+ILib.s:7560,
  which converts the RESULT and is what spec `11` `Asin`/`Acos`/`Atan` use).
  Report nothing about angle conversion in these six.

## Forms and the `spec` field

A `spec` is one argument list from the shipped token table, verbatim. `I`
introduces an instruction, `0` is a numeric argument, `$` a string, `,` a
comma the programmer must type, and `t` a `To`. So `I0,0t0,0` is
`Bar x1,y1 To x2,y2`.

**A keyword usually has SEVERAL forms and every one is listed.** `Plot` is
`I0,0` and `I0,0,0`; `Cls` is `I`, `I0` and `I0,0,0t0,0`. Each form has its own
routine and all of them are given to you. The port is right to accept every
listed form, and a handler that accepts arguments is NOT a finding when a later
form takes them. Check the port against the WHOLE list, not the first entry.

Only report an `args` finding when the port accepts a shape no listed form has,
or refuses one that is listed, or expects a different separator.

## Output

Reply with ONE JSON object and nothing else. No prose before or after, no code
fence.

**Every string must be on one line.** A raw newline inside a JSON string is a
parse error and throws the whole keyword away. Join several assembler lines
with ` / `, as in `move.l d3,d0 / Rbmi L_FonCall`.

```
{
  "keyword": "<the keyword>",
  "verdict": "clean" | "question" | "defect",
  "findings": [
    {
      "kind": "args" | "errors" | "behaviour" | "state" | "citation" | "prose" | "unreadable",
      "severity": "minor" | "major",
      "claim": "one sentence saying what is wrong",
      "original": "the assembler line(s) you read it from, verbatim",
      "port": "the port line(s) that disagree, verbatim"
    }
  ]
}
```

`verdict` is `defect` only when you are confident a program would observe a
difference; `question` when something looks wrong but turns on a routine or a
fact you were not given; `clean` when the port matches. `findings` is `[]` for
a clean verdict.
