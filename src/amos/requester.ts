/**
 * `Ed_Dialogue` (+Edit.s:3107) for a host that cannot block.
 *
 * On the machine a requester is a jump into the Interface language and back:
 * `Ed_DoDialog` calls `L_Dia_RunProgram` and does not return until a button
 * is pressed. The editor command that asked is sitting in the middle of
 * itself the whole time.
 *
 * A browser has no way to sit in the middle of anything. So a command that
 * asks is ABANDONED, the host puts the requester up over as many frames as it
 * takes, and then the command is run AGAIN with the answer waiting for it.
 * The second run reaches the same question and is handed the recorded answer
 * instead of asking; if it asks a second question the same thing happens
 * again, one more answer at a time.
 *
 * DEVIATION: whatever the command did before it asked, it does twice, and
 * that is the cost of the whole arrangement. Every editor command that asks opens with
 * `Ed_TokCur` and then asks, and writing the edit buffer back to the program
 * twice changes nothing -- but a command that asked LATE would repeat real
 * work, and there is no check that stops one being written.
 *
 * `Ed_Zappeuse` is the machine's own version of this and is why the shape is
 * legal at all: under the ZAP remote control (`Call Editor`) `Ed_Dialogue`'s
 * first instruction answers `Ed_ZapParam` without drawing anything, so a
 * requester that never goes up is a state the editor already has.
 */
import type {
  Confirm,
  DialogueAnswer,
  EditorDialogues,
  SearchDialogue,
} from '../editor/search'

/** thrown out of a command that asked something nobody has answered yet */
export const ASKING = Symbol('editor requester')

/** what the command wanted to know, for a host to put on the screen */
export type EditorAsk =
  /** `Ed_Dialogue` with EdD_Search (4) or EdD_Replace (6) */
  | { kind: 'ask'; dialogue: SearchDialogue }
  /** everything else `Ed_Dialogue` runs, by its EdD_ number */
  | { kind: 'confirm'; confirm: Confirm }
  /** `Ed_File_Selector` (:14059): four messages in, a path back */
  | { kind: 'select'; which: number; name: string }
  /** EdD_Macro1 (13) and EdD_MacroD (18), which wait for a keystroke */
  | { kind: 'pressKey'; which: number }
  /** `Ed_LinkCursor` (:2342), which waits for a click on another window */
  | { kind: 'pickWindow' }
  /** `Mn_GetOption` (:5733): the requester goes up and a MENU entry is picked */
  | { kind: 'pickMenu'; which: number }
  /** `Dia_GetValue` with d2 of 2: one of the requester's fields, as text */
  | { kind: 'text'; zone: number }
  /** `Dia_GetVFlags` (+Lib.s:20926): `count` checkboxes from slot `from` */
  | { kind: 'flags'; from: number; count: number }
  /** `Dia_GetValue` (+Lib.s:20813): one of the fields, as a number */
  | { kind: 'value'; zone: number }

/** one answer, in whatever shape the question wants */
export type EditorAnswer = number | string | null | DialogueAnswer

/**
 * The `EditorDialogues` a replaying host installs.
 *
 * Every question is either already answered -- the run before this one asked
 * it and the host has since said -- or it is the new one, and asking it ends
 * the command.
 */
export class Requester implements EditorDialogues {
  /** the answers the host has given, in the order they were asked for */
  private answers: EditorAnswer[] = []
  private at = 0
  /** the question the last run stopped on */
  asked: EditorAsk | null = null

  /** a fresh run of the command: replay from the first answer again */
  begin(): void {
    this.at = 0
    this.asked = null
  }

  /** the host has answered; the command runs again and gets this at the same point */
  record(v: EditorAnswer): void {
    this.answers.push(v)
    this.asked = null
  }

  /** the command finished without asking, so the recorded answers are spent */
  done(): void {
    this.answers = []
    this.at = 0
    this.asked = null
  }

  /** whether a command is part-way through a run of questions */
  get open(): boolean {
    return this.answers.length > 0 || this.asked !== null
  }

  private next(ask: EditorAsk): EditorAnswer {
    if (this.at < this.answers.length) return this.answers[this.at++]!
    this.asked = ask
    throw ASKING
  }

  ask(d: SearchDialogue): DialogueAnswer {
    const a = this.next({ kind: 'ask', dialogue: d })
    // the machine reads the fields out of the requester before it looks at
    // the button, so a Cancel still answers with whatever was typed
    return typeof a === 'object' && a !== null ? a : { ...d, ok: a === 1 }
  }

  confirm(c: Confirm): number {
    return Number(this.next({ kind: 'confirm', confirm: c }) ?? 0)
  }

  select(which: number, name: string): string | null {
    const a = this.next({ kind: 'select', which, name })
    return typeof a === 'string' ? a : null
  }

  pressKey(which: number): number {
    return Number(this.next({ kind: 'pressKey', which }) ?? 0)
  }

  pickWindow(): number {
    return Number(this.next({ kind: 'pickWindow' }) ?? 0)
  }

  pickMenu(which: number): number {
    return Number(this.next({ kind: 'pickMenu', which }) ?? 0)
  }

  text(zone: number): string {
    const a = this.next({ kind: 'text', zone })
    return typeof a === 'string' ? a : String(a ?? '')
  }

  flags(from: number, count: number): number {
    return Number(this.next({ kind: 'flags', from, count }) ?? 0)
  }

  value(zone: number): number {
    return Number(this.next({ kind: 'value', zone }) ?? 0)
  }
}
