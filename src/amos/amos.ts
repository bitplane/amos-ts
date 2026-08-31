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
import {
  ED,
  ED_DIA_DISK_ERR,
  activate,
  diskMessage,
  drawWindows,
  edCall,
  edEscapeReturn,
  edKey,
  edRunReturn,
} from '../editor/commands'
import { ED_SYSTEME, ED_TST_MESSAGES } from '../runtime/edmessages.gen'
import { PRG, programSource, readProgramFile, writeProgramFile, type EditorFS } from '../editor/files'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { isAmosProgram, loadProgram } from '../loader/program'
import { defaultSlotBindings, extensionTitle } from '../ext/registry'
import { zapCall, zapFunction } from '../editor/zap'
import { Runtime, type EditorZap, type RuntimeOptions } from '../runtime/runtime'
import { EditorScreen } from './screen'
import { EditorMenu } from './menu'
import { ASKING, Requester, type EditorAnswer, type EditorAsk } from './requester'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
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
/**
 * The stock slot bindings, which is what a machine with the shipped
 * extensions installed has (`defaultSlotBindings`, ../ext/registry.ts).
 *
 * A LISTING has no extension table of its own -- it is text -- so the
 * tokeniser has to be told what is in the slots or `Track Loop On` is a
 * syntax error. `loadProgram` does exactly this for the same reason.
 */
function stockTables(): Map<number, TokenTable> {
  const m = new Map<number, TokenTable>()
  for (const [slot, ext] of defaultSlotBindings()) m.set(slot, ext.table)
  return m
}

function loadInto(source: string | Uint8Array, table: TokenTable): ProgramBuffer {
  if (typeof source !== 'string' && isAmosProgram(source)) {
    // No room limit. `Prg_Load` asks the memory for what the file needs and
    // says "Out of memory" when there is none, so a fixed budget here would
    // be this port pretending the machine has 64KB: `TOME.AMOS` is 78KB and
    // was refused. The 64KB stays as a MINIMUM, which is headroom to type in.
    const r = readProgramFile(source)
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
  const extensions = stockTables()
  return ProgramBuffer.load(verify(tokeniseSource(text, table, { extensions }), { extensions }).slice(0, -2))
}

/** the Escape key's Amiga scancode, which `Esc_L1` tests as `cmp.b #$45,d1` */
const ESCAPE_KEY = 0x45

/**
 * What the twelve `Ed_Boutons` run, which is system message 13.
 *
 * `Ed_MBouton` (+Edit.s:1406) indexes the message by `Bt_Number`: Escape,
 * Workbench, Run, Test, Indent, Monitor, the user menu, the two window
 * steps, Insert, Open Procedure and Insert Line.
 */
const ED_BUTTONS: readonly number[] = Array.from(ED_SYSTEME[12] ?? '', (c) => c.charCodeAt(0))

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
   * Whether a command that asks a question stops and waits for an answer.
   *
   * False leaves `Editor.dialogues` null, which is `Ed_Zappeuse`'s answer:
   * every requester takes its first button and nothing is drawn. That is what
   * a headless caller wants and what this port did before there was a host
   * that could draw one.
   */
  requesters?: boolean
  /**
   * The host owns the frame clock, so `Ed_Run` leaves the program waiting.
   *
   * Without it a command that asks for a program runs it to a stop inside the
   * `call` that asked, which is what a test wants. A display cannot: nothing
   * would be drawn until the program stopped. With it, `pendingRun` is what
   * `Ed_Run` left and the host calls `startRun` and then `finishRun`.
   */
  hostFrames?: boolean
  /**
   * Every machine this builds, before it runs anything.
   *
   * `Prg_RunIt` clears the variables and nothing else, but this port builds a
   * fresh `Runtime` per Run, so whatever the host set up on the last one has
   * to be set up again. `loadSystemResource` is the one that shows: without
   * it `Resource Screen Open` fails and `AMOSPro_Help` gives up with its own
   * "Out of memory" at line 465.
   */
  onMachine?: (rt: Runtime) => void
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

  /**
   * The token table in each extension slot, which the editor needs as much as
   * the interpreter does.
   *
   * `Ver_Extension` refuses a keyword whose slot holds no library, and on the
   * machine the slots are MACHINE state: the libraries were loaded before the
   * editor started and `T_ExtAdr` is what the Test pass looks at. Nothing
   * here loads a library, so what fills this is the program's own extension
   * table, which is the same answer for the same reason.
   *
   * Without it the Test pass refused every program that uses an extension.
   * `Ed_FCall` reports a failed test and a successful one with the same 0, so
   * what came out was "Ed_Run answered 0" and no program.
   */
  private readonly extensions = new Map<number, TokenTable>()

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
      { extensions: this.extensions },
      this.editor,
    )
    this.bindExtensions()
    if (opts.fs !== undefined) this.editor.fs = opts.fs
    // DEVIATION: with no host to draw them, `Ed_Dialogue` answered every
    // question with its first button. It now stops the command instead, and
    // a host with no requester has to say so by clearing this.
    if (opts.requesters !== false) this.editor.dialogues = this.requester
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
    // `Ed_OpenEditor`'s screen half. Null until a host asks for a display, so
    // a headless caller is not given one it never wanted.
    this.editor.openScreen = () => {
      this.display?.open()
    }
    // `WiCall Print` at the end of `Ed_ErrDirect` (+Edit.s:9315)
    this.editor.escapeText = (t) => {
      this.machine(false).directScreen.report(t)
    }
    // `Esc_Appear` and `Esc_Hide`, which are the AMOS screen underneath and
    // not the editor's, so they live on the Runtime
    this.editor.escapeScreen = (up) => {
      const rt = this.machine(false)
      if (up) {
        // `Ed_ErrDirect` (+Edit.s:9293) is `Prg_JError` while the escape
        // screen is up, so a typed `Edit` gets back to the editor
        rt.directScreen.onDirectEnd = (code) => this.errDirect(code)
        rt.directScreen.open()
      } else rt.directScreen.close()
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
    return this.attempt(() => this.after(edCall(this.window, command, param)))
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
   * One command, up to the first question nobody has answered.
   *
   * `Ed_Dialogue` does not return until a button is pressed and the command
   * that asked is sitting in the middle of itself the whole time. A host that
   * cannot block runs the command again instead, with the answers it has
   * given so far replayed into it. `./requester.ts` says what that costs.
   */
  private attempt(again: () => number): number {
    this.requester.begin()
    try {
      const alert = this.paint(again())
      this.requester.done()
      this.asking = null
      this.dError()
      return alert
    } catch (e) {
      if (e !== ASKING) throw e
      this.asking = again
      return this.paint(0)
    }
  }

  /**
   * `Ed_DError` (+Edit.s:14019): the command died on the disc, so say which.
   *
   * `run` (../editor/commands.ts) catches a `DiskError` and records the
   * AmigaDOS code, which is `Ed_DError`'s own control flow -- the command is
   * abandoned and the routine ends `bra Ed_Loop`. What it does on the way is
   * put a requester up, and NOBODY WAS. Every editor command that touched a
   * missing file failed silently, which is what made the User menu's
   * accessories look dead: `Ed_PrgCommand` on a disc that is not in the
   * machine threw 205, and 205 went into a field nothing read.
   *
   * The requester is not a question, so it is kept apart from `pendingAsk`:
   * the command is over and there is no run to replay an answer into.
   */
  private dError(): void {
    const dos = this.editor.diskError
    if (dos < 0) return
    this.editor.diskError = -1
    const text = ED_RUN_MESSAGES[diskMessage(dos) - 1] ?? ''
    this.report = { kind: 'confirm', confirm: { which: ED_DIA_DISK_ERR, strings: [text] } }
  }

  /**
   * A requester to put up that answers nowhere: a report, not a question.
   *
   * `Ed_DError` and `Ed_Alert` both end in `bra Ed_Loop`, so what they draw
   * outlives the command rather than blocking it. A host shows this the same
   * way it shows `pendingAsk` and throws the button away.
   */
  report: EditorAsk | null = null

  /** the report has been seen */
  dismissReport(): void {
    this.report = null
  }

  /** the question the last command stopped on, for a host to put on the screen */
  get pendingAsk(): EditorAsk | null {
    return this.requester.asked
  }

  /**
   * The host has answered; the command runs again and reaches the same point.
   *
   * Answers again if the command asks something else, and only when it gets
   * all the way through does it report its alert.
   */
  answer(v: EditorAnswer): number {
    const at = this.asking
    if (at === null) return 0
    this.requester.record(v)
    // `Ed_Ligne`'s requester is not saved and restored: its script has no
    // `SA`, because `Ed_ErrEdit` (+Edit.s:8275) is `Ed_OpenEditor / Esc_Hide
    // / Ed_Appear` and `Ed_Appear` redraws the whole editor over whatever the
    // requester left. A row-by-row repaint leaves the buttons standing.
    this.redraw = true
    return this.attempt(at)
  }

  /** the next repaint has to be `Ed_DrawWindows` and not `Ed_AffBuf` */
  private redraw = false

  /** abandon the question and the command with it, which is what a close does */
  cancelAsk(): void {
    this.requester.done()
    this.asking = null
  }

  /** the requester the editor asks, which records answers and replays them */
  readonly requester = new Requester()
  /** the command to run again once the question has an answer */
  private asking: (() => number) | null = null

  /**
   * `Ed_Mouse` (+Edit.s:1206): a click at a pixel on the editor's screen.
   *
   * `key` is the mouse-button mask AMOS's `MouseKey` answers, and the routine
   * opens `and.w #3,d7 / beq Ed_MQuit`, so only the two main buttons do
   * anything and a release does nothing. Bit 1, the right button, is the
   * menu; bit 0 places the cursor.
   *
   * `count` is `Ed_MkCpt(a5)`, how many polls this button has been held for.
   * It is zero on the press and rises while it is down, and the routine reads
   * it twice: a click on the cell the cursor is already in starts a block
   * (`Ed_BlocOn`) only on the press, and a HELD button drags the cursor
   * through the text after twenty polls.
   */
  mouse(x: number, y: number, key = 1, count = 0): number {
    const d = this.display
    if (d === null || (key & 3) === 0) return 0
    // `btst #1,d7 / beq.s .NoMenu / bsr Ed_MnGere` is the routine's first
    // test and a pick ends it, so the right button never reaches the zones.
    // `stepMenus` is what runs the menu; `pollMenu` collects the answer.
    if ((key & 2) !== 0) return 0
    const hit = d.hitTest(x, y)
    if (hit === null) return 0
    switch (hit.kind) {
      case 'button':
        // `Ed_MBouton` reads the command out of system message 13, one byte
        // per button, and `subq.w #1,d2` makes it 0-based for `Ed_FCall`.
        // This port counts commands from 1, so the byte goes over as it is.
        return this.call(ED_BUTTONS[hit.n - 1] ?? 0)
      case 'winButton':
        // `Bt_RoutIn` (:13868): 1 `Ed_BtWindowClose`, 2 `Ed_BtWindowHide`,
        // 3 `Ed_BtWindowSize`, and each takes the window off `Bt_Number`
        // rather than acting on the current one
        return this.onWindow(hit.w, [ED.CLOSE, ED.HIDE, ED.FLIP_SIZE][hit.n - 1] ?? 0)
      case 'status':
        // `.Same`: a click in another window's zone activates it, and one in
        // the current window's does nothing
        if (hit.w !== this.editor.current) activate(hit.w)
        return this.paint(0)
      case 'bottom':
        return 0
      case 'slider': {
        // `Sl_Clic`: the knob follows the pointer, so the row clicked becomes
        // the top of the window
        this.window.tokCur()
        hit.w.yPos = Math.max(0, Math.min(hit.w.prog.lineCount - 1, hit.row))
        hit.w.fill()
        return this.paint(0)
      }
      case 'text': {
        const w = hit.w
        // `.Pos`: a held button does nothing for twenty polls and then moves
        // the cursor every poll, which is the drag that makes a block
        if (count > 0 && count < 20) return 0
        if (w !== this.editor.current && !activate(w)) return 0
        // `cmp.w #250,d3 / bcc Ed_MQuit` and `cmp.w Prg_NLigne(a6),d2`: a
        // click past the longest line a window can hold, or past the last
        // line of the program, is not a click
        if (hit.col >= 250) return 0
        if (hit.row + w.yPos > w.prog.lineCount) return 0
        if (hit.row !== w.yCu) w.tokCur()
        if (hit.row === w.yCu && hit.col === w.xCu && count === 0) return this.call(ED.BLOCK_ON)
        w.yCu = hit.row
        w.xCu = hit.col
        return this.paint(0)
      }
    }
  }

  /**
   * A command aimed at a window that is not the current one.
   *
   * The three window buttons are the only things that do this: `Bt_Number`
   * holds `Edt_Window` and each routine runs `Edt_GetAd` to reach it, so a
   * window can be closed without being made current first.
   */
  private onWindow(w: Edit, command: number): number {
    return this.paint(this.after(edCall(w, command, 0)))
  }

  /**
   * `Ed_OpenIt`'s screen half, for a host that has a display.
   *
   * Answers the screen the editor draws on. `Ed_Appear` (+Edit.s:9646) makes
   * it current and puts it first, so from here every AMOS screen a program
   * opens is BEHIND the editor rather than instead of it.
   */
  openDisplay(): EditorScreen {
    const d = this.useDisplay()
    d.open()
    this.buildMenu()
    return d
  }

  /**
   * The display exists, but the screen is not up yet.
   *
   * `Ed_OpenEditor` is what opens the screens and it is called from a dozen
   * places -- `Ed_Ligne` before it draws its requester, `Ed_ErrEdit` on the
   * way back from a run, `Ed_GoMonitor` when the monitor is not there. A host
   * says once that it HAS a display and the editor opens it when it needs it.
   */
  useDisplay(): EditorScreen {
    const d = this.display ?? new EditorScreen(() => this.machine(false), this.editor)
    this.display = d
    return d
  }

  /**
   * `EdM_Init` (+Edit.s:12579): the menu bar, on the editor's screen.
   *
   * `Ed_Loop` (:1043) rebuilds it when it is not there -- `tst.l EdM_Table(a5)
   * / bne .Menula / bsr EdM_Init` -- and `EdM_BranchAMOS` runs again whenever
   * the window list changes, because the AMOS branch is a view of it.
   */
  private menuShape = ''

  private buildMenu(): void {
    const rt = this.runtime
    const d = this.display
    if (rt === null || d === null || !d.isOpen) return
    const shape = `${this.editor.list.map((w) => `${w.hidden}:${w.prog.name}`).join(',')}|${this.editor.posHidden}`
    if (shape === this.menuShape && rt.menu.roots.length > 0) return
    this.menuShape = shape
    this.menu.build(rt.menu, EditorScreen.EC_EDIT)
  }

  /**
   * `Ed_MnGere` (+Edit.s:1639), for a host driving frames.
   *
   * The right button is `Ed_Mouse`'s first test and a pick ends the routine,
   * so the menu is asked before the window zones and a chosen entry goes
   * straight to `Ed_FCall`. `stepMenus` runs the menu itself and latches the
   * path in `MnChoix`, so all that is left is the lookup and the call.
   *
   * Answers the alert the command left, or 0 for nothing chosen.
   */
  pollMenu(): number {
    const rt = this.runtime
    if (rt === null || this.display?.isOpen !== true || this.editor.escape) return 0
    this.buildMenu()
    if (rt.menu.choice !== -1) return 0
    rt.menu.choice = 0
    const cmd = this.menu.chosen(rt.menu.choix)
    if (cmd < 0) return 0 // `.NoChoix`
    // `moveq #0,d1 / bsr Ed_FCall`: the parameter is always zero here, and a
    // command at or above `HiddenCommands` carries its program in the number
    this.redraw = true
    return this.call(cmd)
  }

  /** the editor's menu bar, which is `EdM_Definition` walked (./menu.ts) */
  readonly menu = new EditorMenu(this.editor)

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
    // `Ed_Escape` (+Edit.s:8876) is `Ed_Hide` then `Esc_Appear`, and the
    // escape screen is drawn on the editor's own screen. Repainting the
    // editor after the command that raised it puts the editor straight back
    // over the top: its status line, its text, all of it.
    if (this.editor.escape) return alert
    // `Ed_Loop` (+Edit.s:1043): `tst.l EdM_Table(a5) / bne .Menula / bsr
    // EdM_Init`. The bar is rebuilt when it is not there, and the AMOS branch
    // whenever the window list it is a view of has changed.
    this.buildMenu()
    if (this.redraw) {
      this.redraw = false
      this.display?.draw()
    } else this.display?.refresh()
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
  private machine(fresh: boolean, on: Edit = this.editor.current ?? this.window): Runtime {
    const had = this.runtime
    if (had !== null && !fresh) return had
    const w = on
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
    this.opts.onMachine?.(rt)
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
  /**
   * Which extension is in which slot, read off the program that is loaded.
   *
   * `loadProgram` is what the interpreter uses, so the editor and the
   * interpreter agree about the slots by construction.
   */
  private bindExtensions(): void {
    this.extensions.clear()
    try {
      const w = this.window
      const loaded = loadProgram(
        writeProgramFile({
          pro: w.prog.pro,
          mathFlags: w.prog.mathFlags,
          tested: !w.prog.modified,
          source: programSource(w.prog),
          banks: w.prog.banks,
        }),
        this.table,
      )
      for (const [slot, t] of loaded.extensions) this.extensions.set(slot, t)
      // `AdTokens+4` (+Equ.s:1155), which is what both About boxes count and
      // name. Index 0 is slot 1, because `AdTokens` itself is the core table
      // and `Ed_About` counts from `AdTokens+4`.
      this.editor.extensions.fill(null)
      for (const [slot, ext] of loaded.bindings) {
        // `LB_Title`, which is the only field `Ed_AboutExt` reads
        if (slot >= 1 && slot <= 26) this.editor.extensions[slot - 1] = extensionTitle(ext)
      }
    } catch {
      /* a program the loader will not take has no slots to bind */
    }
  }

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
      return this.finishRun(rt.interp.endCode, rt.interp.endAt)
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
    const r = this.pending
    this.pending = null
    // `Edt_Runned(a5)` is the window whose program runs, and `Ed_RunHidden`
    // (+Edit.s:8213) is the reason it is not always the current one: it runs
    // a program in a window that has no screen area at all
    this.ran = r?.window ?? this.editor.current ?? this.window
    return this.machine(true, this.ran)
  }

  /** `Edt_Runned(a5)`, kept because `Ed_Errr` clears it on the way back */
  private ran: Edit | null = null

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
  finishRun(end: number | AmosRuntimeError, endAt = -1): number {
    // `Ed_Ligne` (+Edit.s:8344) asks before it does anything else, so the
    // return from a run is as much a question as a command is
    return this.attempt(() => this.errRun(end, endAt))
  }

  private errRun(end: number | AmosRuntimeError, endAt: number): number {
    let code = 0
    let at = endAt
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
      const w = this.ran ?? this.window
      at = end.at >= 0 ? end.at : w.prog.findLine(end.line - 1).at - w.prog.stBas
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
    const alert = edEscapeReturn(this.window)
    // `Esc_Esc` is `Esc_Hide` then `Ed_Appear`, and `Ed_Appear` (+Edit.s:9646)
    // is `Ed_DrawTop` and `Ed_DrawWindows`. The escape screen was drawn on
    // the editor's own screen, so without the redraw its logo, its buttons
    // and its text are still there under the editor's.
    this.redraw = true
    return this.paint(alert)
  }

  /**
   * `Ed_ErrDirect`'s tail (+Edit.s:9309), for a line typed at the escape
   * screen rather than a program that stopped.
   *
   *     cmp.w #1002,d1 / beq Ed_System
   *     cmp.w #1000,d1 / beq Esc_Esc
   *
   * A typed `Edit` is `Esc_Esc`, which is `Esc_Hide` then `Ed_Appear`. A
   * typed `System` ends the session. Everything else prompts again.
   */
  private errDirect(code: number): boolean {
    if (code === 1002) {
      this.editor.quit = true
      return true
    }
    if (code !== 1000) return false
    this.escapeBack()
    return true
  }

  /** whether the escape screen is in front: `Direct(a5)` */
  get inEscape(): boolean {
    return this.editor.escape
  }

  /**
   * `Ed_ErrTest` (+Edit.s:8246): why the Test pass refused the program.
   *
   * -1 for a command that did not test one. `Ed_FCall` answers 0 for a failed
   * test the same as for a success -- the cursor has already been moved and
   * the message comes from `Ed_TstMessages` rather than the editor's own
   * table -- so a host that gets 0 out of `Ed_Run` and no program has to look
   * here to find out why.
   */
  get testError(): { code: number; text: string } {
    const code = this.window.testError
    // `Ed_TstMessages` is a `GetMessage` table, so it is 1-based like every
    // other one: code 5 is "Extension not loaded" at index 4
    return { code, text: code < 0 ? '' : (ED_TST_MESSAGES[code - 1] ?? `test error ${code}`) }
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
