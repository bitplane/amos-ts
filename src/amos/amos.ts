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
 * DEVIATION: the machine runs the program in the editor's own memory. There is
 * one program block and `Prg_SetBanks` (+Verif.s:4714) points the interpreter
 * at the same banks the editor holds, so a `Reserve` inside the program leaves
 * a bank the editor can then save with it.
 *
 * Here the program is written out as a `.AMOS` image and loaded, so the
 * interpreter gets a COPY. What the run changes in its own banks is gone when
 * it stops. `Prg_Reloaded` (+Equ.s:1863) is the one thing that does come back,
 * because the editor's return path reads it.
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
import { Runtime } from '../runtime/runtime'
import { AmosRuntimeError } from '../interp/interp'
import type { AmosFS } from '../amiga/fs'


/**
 * A `.AMOS` file, or a listing, into a buffer the editor can hold.
 *
 * `Prg_Load` (+Verif.s:4930) is the first, and `EdLok` (+Edit.s:13420) is what
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
    return this.after(edCall(this.window, command, param))
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
    return this.after(edKey(this.window, k))
  }

  /** the program `Ed_Run` or `Ed_Escape` left waiting, once the command is over */
  private after(alert: number): number {
    const run = this.pending
    if (run === null) return alert
    this.pending = null
    return this.runIt(run)
  }

  /**
   * `Prg_RunIt`'s far side: the interpreter, and then `Ed_ErrRun`.
   *
   * DEVIATION: `VerPos(a5)` is the byte the program stopped ON, and this port
   * has the LINE. `AmosRuntimeError` carries a line number, so the cursor
   * lands at the start of the failing line rather than on the token.
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
      extensions: loaded.extensions,
      extBindings: loaded.bindings,
      banks: loaded.amos?.banks ?? [],
      ...(this.opts.onText !== undefined ? { onText: this.opts.onText } : {}),
      ...(this.opts.fs ? { fs: this.opts.fs } : {}),
    })
    this.runtime = rt
    return rt
  }

  private runIt(r: RunRequest): number {
    const w = r.window
    const rt = this.machine(true)
    let code = 0
    let at = -1
    let text: string | null = null
    try {
      rt.runHeadless(this.opts.maxFrames ?? 5_000)
      code = rt.interp.endCode
    } catch (e) {
      if (!(e instanceof AmosRuntimeError)) throw e
      code = e.code
      // an error with no number of its own has no message in either table, so
      // the text goes over as an extension's would: `Ed_GetError`'s a0
      if (code === 0) text = e.text
      at = w.prog.findLine(e.line - 1).at - w.prog.stBas
    }
    return edRunReturn(this.window, code, at, text)
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
