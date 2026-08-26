/**
 * The editor and the interpreter, in one place, which is what `+B.s` is.
 *
 * `src/editor` cannot run a program and `src/runtime` cannot open the editor:
 * the first would have to reach down past the layer it sits on and the second
 * would have to reach up. On the machine there is no such problem, because
 * `Prg_RunIt` (+Verif.s:4336) is a jump and not a call. It ends in `JJmp
 * L_New_ChrGet`, the editor's stack is thrown away with `move.l BasSp(a5),sp`,
 * and the editor comes BACK only when the program stops and longjmps to
 * `Prg_JError`. Nothing returns to anything.
 *
 * That is why the two halves meet here and not inside either one. `Ed_Run`
 * hands a `RunRequest` to `Editor.runProgram`, this keeps it, and the program
 * runs after the command has finished rather than inside it. Then
 * `edRunReturn` re-enters the editor with `RunErr`'s d0, which is exactly the
 * shape the machine has and not an approximation of it.
 *
 * ## What this port hands over, and what the machine hands over
 *
 * DEVIATION: the machine runs the program in the editor's own memory, and the
 * source pointer proves it: `Prg_SetBanks` (+Verif.s:4714) ends `move.l
 * Prg_StBas(a6),Prg_Source(a5)`, so the interpreter reads the very bytes the
 * editor is drawing. Here the program is written out as a `.AMOS` image and
 * loaded, so the TEXT is a copy and an edit during a run cannot reach it.
 *
 * The banks are not a copy. The same routine's first two instructions point
 * `Cur_Banks(a5)` and `Cur_Dialogs(a5)` into the program structure, so a
 * `Reserve` inside the program leaves a bank the editor can save with it.
 * `ProgramBuffer.liveBanks` is that pointer, set below.
 */
import { Edit, EditorAlert } from '../editor/edit'
import { Editor, type RunRequest } from '../editor/windows'
import { QUAL, type EdKey } from '../editor/keymap'
import { ProgramBuffer } from '../editor/buffer'
import { EditBuffer } from '../editor/editbuf'
import { UndoBuffer } from '../editor/undo'
import { drawWindows, edCall, edEscapeReturn, edKey, edRunReturn } from '../editor/commands'
import { PRG, programSource, readProgramFile, writeProgramFile, type EditorFS } from '../editor/files'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { isAmosProgram, loadProgram } from '../loader/program'
import { zapCall, zapFunction } from '../editor/zap'
import { Runtime, type EditorZap, type RuntimeOptions } from '../runtime/runtime'
import { EditorScreen } from './screen'
import { AmosRuntimeError } from '../interp/interp'
import type { AmosFS } from '../amiga/fs'


/**
 * A `.AMOS` file, or a listing, into a buffer the editor can hold.
 *
 * `Prg_Load` (+Verif.s:4789) is the first, and `EdLok` (+Edit.s:13420) is what
 * follows it: `move.b #1,Prg_StModif(a6)`, "force le test". Whatever byte 11
 * of the file said, a program that came off disc has not been tested by THIS
 * interpreter and the next Run has to test it.
 *
 * A listing goes through the editor's own tokeniser and the Test pass, which
 * is what a program typed in and left has been through before `Ed_Run` can
 * reach it.
 */
function loadInto(source: string | Uint8Array, table: TokenTable): ProgramBuffer {
  if (typeof source !== 'string' && isAmosProgram(source)) {
    const r = readProgramFile(source, 64 * 1024)
    if (r.error !== PRG.OK || r.file === null || r.file === undefined) throw new Error(`cannot load: Prg_Load answered ${r.error}`)
    const prog = ProgramBuffer.load(r.file.source, Math.max(64 * 1024, r.needs))
    prog.pro = r.file.pro
    prog.mathFlags = r.file.mathFlags
    prog.banks = r.file.banks
    prog.changed = false
    prog.modified = true
    return prog
  }
  const text = typeof source === 'string' ? source : new TextDecoder('latin1').decode(source)
  return ProgramBuffer.load(verify(tokeniseSource(text, table), {}).slice(0, -2))
}

/** the Escape key's Amiga scancode, which `Esc_L1` tests as `cmp.b #$45,d1` */
const ESCAPE_KEY = 0x45

export interface AmosOptions {
  /** the shared token table. One table: the editor tokenises what the interpreter runs */
  table?: TokenTable
  /** `Ed_Ty` (+Edit.s:394) worth of rows for the window the editor boots with */
  rows?: number
  /** where a running program's text goes */
  onText?: (text: string) => void
  /** the disc, for both halves */
  fs?: (EditorFS & AmosFS) | null
  /**
   * How long a program may run before this gives up on it.
   *
   * DEVIATION: the machine has no such limit. It runs until the program stops,
   * and a program that never stops is what Ctrl-C is for.
   */
  maxFrames?: number
  /**
   * Everything else the host's machine needs, handed straight to the Runtime.
   *
   * On the Amiga this is not an option at all: the editor and the interpreter
   * share `a5`, so a program runs on the machine the editor is already on --
   * the same screens, the same audio, the same `dos.library`. Here the host
   * owns those and a Runtime is built per Run, so what the host built once
   * has to be handed to each of them.
   */
  runtime?: Partial<RuntimeOptions>
  /**
   * The host owns the frame clock, so `Ed_Run` leaves the program waiting.
   *
   * Without it a command that asks for a program runs it to a stop inside the
   * `call` that asked, which is what a test wants. A display cannot: nothing
   * would be drawn until the program stopped. With it, `pendingRun` is what
   * `Ed_Run` left and the host calls `startRun` and then `finishRun`.
   */
  hostFrames?: boolean
}

export class Amos {
  readonly table: TokenTable
  readonly editor = new Editor()
  /** `Edt_Current` at boot, which is the window `Ed_Run` runs */
  readonly window: Edit
  /**
   * The interpreter this program has, from the first Run or Escape onwards.
   *
   * Not "while it is running": `Prg_RunIt` is what clears the variables, so
   * what a finished program left is still there for the escape screen to look
   * at, which is what direct mode under the editor is FOR.
   */
  runtime: Runtime | null = null

  /**
   * The editor's own screen, once a host has asked for one.
   *
   * Null until `openDisplay`, because a headless caller has no display and
   * `Ed_OpenIt` opening one would cost it an interpreter it never asked for.
   * `Ed_Opened(a5)` is the machine's flag for the same thing and the machine
   * has the same two states.
   */
  display: EditorScreen | null = null

  private pending: RunRequest | null = null
  private readonly opts: AmosOptions

  constructor(source: string | Uint8Array = '', opts: AmosOptions = {}) {
    this.opts = opts
    this.table = opts.table ?? new TokenTable(CORE_TOKENS)
    this.window = new Edit(
      loadInto(source, this.table),
      new EditBuffer(opts.rows ?? 20),
      new UndoBuffer(50),
      this.table,
      {},
      this.editor,
    )
    if (opts.fs !== undefined) this.editor.fs = opts.fs
    this.editor.runProgram = (r) => {
      this.pending = r
    }
    // `Edt_ClearVar` (+Edit.s:3035) frees the interpreter's variables.
    //
    // DEVIATION: it is `ClearVar` on the machine and the screens survive it.
    // Here the whole machine goes, and the next Run or Escape builds another
    // one -- which is what `Prg_RunIt` does anyway, so only a caller that
    // wanted the screens back afterwards can tell, and there is none: both
    // callers are on their way out of the editor.
    this.editor.clearVars = () => {
      this.runtime = null
    }
    // `Esc_Appear` and `Esc_Hide`, which are the AMOS screen underneath and
    // not the editor's, so they live on the Runtime
    this.editor.escapeScreen = (up) => {
      const rt = this.machine(false)
      if (up) rt.directScreen.open()
      else rt.directScreen.close()
    }
    drawWindows(this.editor)
  }

  /**
   * One editor command, and then whatever it asked for.
   *
   * `Ed_Loop` (+Edit.s:915) runs a command and comes back for the next key.
   * When the command was `Ed_Run` there is no coming back: the program runs
   * and the editor is re-entered from `Prg_JError`. So this answers the alert
   * of whichever of the two ends last.
   */
  call(command: number, param = 0): number {
    return this.paint(this.after(edCall(this.window, command, param)))
  }

  /**
   * One keystroke, which is `Ed_Key` (+Edit.s:1616).
   *
   * While the escape screen is up the keyboard is `Esc_L1`'s (:8917) and not
   * the editor's, and Escape is the one key that means something to both: it
   * is `Esc_Esc` there and `Ed_Escape` here.
   */
  key(k: EdKey): number {
    if (this.editor.escape) {
      if (k.scan === ESCAPE_KEY) return this.escapeBack()
      this.runtime?.directScreen.key(k.ch ?? '', k.scan ?? 0, ((k.shift ?? 0) & QUAL.SHIFT) !== 0)
      return 0
    }
    return this.paint(this.after(edKey(this.window, k)))
  }

  /**
   * `Ed_OpenIt`'s screen half, for a host that has a display.
   *
   * Answers the screen the editor draws on. `Ed_Appear` (+Edit.s:9646) makes
   * it current and puts it first, so from here every AMOS screen a program
   * opens is BEHIND the editor rather than instead of it.
   */
  openDisplay(): EditorScreen {
    const d = this.display ?? new EditorScreen(() => this.machine(false), this.editor)
    this.display = d
    d.open()
    return d
  }

  /**
   * `Ed_Appear`'s redraw, after whatever the command did.
   *
   * The machine repaints what changed: `Edt_EtatAff` is seven bits saying
   * which status fields are stale and `Ed_ALigne` redraws one row. Here every
   * visible row goes down again, which is more work than the machine does and
   * none of it visible. What this must NOT do is `Ed_DrawWindows`, because
   * that ends in `Ed_BufUntok` and would throw the keystroke away.
   */
  private paint(alert: number): number {
    this.display?.refresh()
    return alert
  }

  /** the program `Ed_Run` or `Ed_Escape` left waiting, once the command is over */
  private after(alert: number): number {
    if (this.pending === null || this.opts.hostFrames === true) return alert
    return this.runIt()
  }

  /**
   * `Prg_RunIt`'s far side: the interpreter, and then `Ed_ErrRun`.
   *
   * `VerPos(a5)` comes over on `AmosRuntimeError.at`, which is the offset
   * of the token the interpreter last read. `Ed_Ligne` cuts its window of the
   * line around that column and `Ed_ErrEdit` puts the cursor there.
   */
  /**
   * The interpreter this window's program has.
   *
   * `Prg_RunIt` calls `ClearVar` before every run (`.Skip1`, +Verif.s:4356),
   * so a fresh one per Run is right. Keeping it AFTERWARDS is what the escape
   * screen needs: direct mode exists to look at what the program left behind,
   * and a machine thrown away at the end of the run has nothing to look at.
   */
  private machine(fresh: boolean): Runtime {
    const had = this.runtime
    if (had !== null && !fresh) return had
    const w = this.window
    const file = writeProgramFile({
      pro: w.prog.pro,
      mathFlags: w.prog.mathFlags,
      tested: !w.prog.modified,
      source: programSource(w.prog),
      banks: w.prog.banks,
    })
    const loaded = loadProgram(file, this.table)
    const rt = new Runtime(loaded.lines, this.table, {
      ...this.opts.runtime,
      extensions: loaded.extensions,
      extBindings: loaded.bindings,
      banks: loaded.amos?.banks ?? [],
      editorZap: this.zap,
      ...(this.opts.onText !== undefined ? { onText: this.opts.onText } : {}),
      ...(this.opts.fs ? { fs: this.opts.fs } : {}),
    })
    this.runtime = rt
    // `Prg_SetBanks`: from here the editor reads the banks through the
    // interpreter, because on the machine there is one list and this is it
    w.prog.liveBanks = () => rt.serializeAllBanks()
    return rt
  }

  /**
   * `Ed_ZapIn` and `Ed_ZapFonction`, as the two keywords see them.
   *
   * `Ed_ZapX` (+Edit.s:2737) answers in d0 and a0, a number and a pointer to
   * characters, and that is the whole of the interface. What the editor does
   * in between is `src/editor/zap.ts`.
   *
   * DEVIATION: `Ed_ZapIn` runs `Ed_Loop` five more times before `Ed_ZapOut`,
   * counting with `Ed_ZapCounter` (:1141), so the display has settled before
   * the accessory gets control back. Nothing here draws.
   */
  private readonly zap: EditorZap = {
    call: (command, param, line) => {
      const a = zapCall(this.window, command, param, line)
      return { value: a.error, text: a.text }
    },
    ask: (n, param) => {
      const a = zapFunction(this.window, n, param)
      // `EdZ_Jump`'s entries answer d0/a0/d2; the two error arms set d2 to 2
      // as well, so both halves come back either way (:2814)
      return 'error' in a ? { value: a.error, text: a.text } : { value: a.value, text: a.text }
    },
  }

  private runIt(): number {
    const rt = this.startRun()
    try {
      rt.runHeadless(this.opts.maxFrames ?? 5_000)
      return this.finishRun(rt.interp.endCode)
    } catch (e) {
      if (!(e instanceof AmosRuntimeError)) throw e
      return this.finishRun(e)
    }
  }

  /**
   * `Prg_RunIt`'s jump, for a host that owns the frame clock.
   *
   * `runIt` above runs the program to a stop and re-enters the editor in one
   * call, which is what a test wants and what the machine's `JJmp
   * L_New_ChrGet` looks like from the outside. A display cannot do that: the
   * program has to be given a frame at a time or nothing is drawn while it
   * runs. So the two halves are separable, and `Prg_JError` is `finishRun`.
   */
  startRun(): Runtime {
    this.pending = null
    return this.machine(true)
  }

  /** whether `Ed_Run` asked for a program and the host has not started it */
  get pendingRun(): RunRequest | null {
    return this.pending
  }

  /**
   * `Ed_ErrRun` (+Edit.s:8252): the editor, re-entered with `RunErr`'s d0.
   *
   * Takes the number, or the error the interpreter threw, which carries the
   * number and `VerPos(a5)` with it.
   */
  finishRun(end: number | AmosRuntimeError): number {
    let code = 0
    let at = -1
    let text: string | null = null
    if (typeof end === 'number') code = end
    else {
      code = end.code
      // an error with no number of its own has no message in either table, so
      // the text goes over as an extension's would: `Ed_GetError`'s a0
      if (code === 0) text = end.text
      // `VerPos(a5)`, when the parse recorded one. The interpreter runs a copy
      // of this window's source, so an offset into that block is an offset
      // into this one
      at = end.at >= 0 ? end.at : this.window.prog.findLine(end.line - 1).at - this.window.prog.stBas
    }
    return this.paint(edRunReturn(this.window, code, at, text))
  }

  /**
   * `Esc_Esc` (+Edit.s:9125): the Escape key from inside the escape screen.
   *
   * The other half of `Ed_Escape`, and the only way back. It is a separate
   * entry for the same reason the run's return is: `Esc_Loop` reset the stack
   * on the way in and there is nothing to return through.
   */
  escapeBack(): number {
    return edEscapeReturn(this.window)
  }

  /** whether the escape screen is in front: `Direct(a5)` */
  get inEscape(): boolean {
    return this.editor.escape
  }

  /** the editor's status line as it stands, which is what a host draws */
  get alert(): { code: number; text: string } {
    return { code: this.window.alert, text: this.window.alertText }
  }

  /** `Ed_System` was reached: the editor is over */
  get done(): boolean {
    return this.editor.quit
  }
}

export { EditorAlert }
