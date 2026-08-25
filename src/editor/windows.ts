/**
 * `Edt_List` (+Equ.s:1688): the editor's windows, and the state they share.
 *
 * A window is `Edt_`, one structure per view, and ./edit.ts is the port of
 * it. What is here is everything an `a5` offset holds instead: the list, which
 * window is current, and the two dozen fields that are one for the whole
 * editor rather than one per window. `Ed_Block` is the clearest of them --
 * every window cuts and pastes through the same clipboard, because there is
 * one pointer and not one per structure.
 *
 * `Edit` reaches all of it through accessors, so `e.schBuf` still reads the
 * search string and two windows on the same `Editor` genuinely share one.
 *
 * ## A window is not a program
 *
 * `Edt_Prg` is a pointer, and Split View (+Edit.s:2448) points two windows at
 * the same program: `Prg_Edited` counts them and the program structure is
 * freed when the count reaches zero. So the list is a list of VIEWS, and the
 * programs behind it are however many distinct `Edt_Prg` values it holds.
 *
 * ## Hidden is three states, not two
 *
 * `Edt_Hidden` is 0 for a window with a screen area, 1 for one asked to go
 * away, and 2 for one whose area has been taken down. `Edt_OpWindow` opens a
 * hidden window straight at 2 ("2 car aucune zone creee", :11282) and
 * `Edt_EffWindows` (:11880) is what turns a 1 into a 2. Everything that walks
 * the list tests `tst.b`, so 1 and 2 are both hidden and only 0 is visible.
 *
 * ## What is not modelled
 *
 * The pixels. `Ed_DrawWindows` (:11594) computes `Edt_Y`, `Edt_WindSx`, the
 * slider and three button structures per window, and `Edt_WChangeHaut` (:12226)
 * drags a separator with the mouse. None of that has a meaning without a
 * screen. The vertical arithmetic does: `Edt_WindTy` is a count of TEXT ROWS,
 * and `Edt_WMaxSize`, `Edt_WPlaceHaut` and `Edt_WSchrinkAll` are the sums that
 * decide how many each window gets. Those are here.
 */
import { A1200_POOLS } from '../amiga/exec'
import { PI_DEFAULTS } from '../runtime/piconfig.gen'
import { Block } from './block'
import type { ProgramBuffer } from './buffer'
import { EditorConfig } from './config'
import type { Edit } from './edit'
import type { EditorFS } from './files'
import type { Macro, MacroTape } from './macros'
import type { EditorDialogues } from './search'

/** `Ed_YTop` (+Edit.s:73): where the editor's first window starts */
const ED_YTOP = 0

/** `Ed_TitreSy` (:74): the title bar above every window */
const ED_TITRE_SY = 16

/** `Edt_EtatSy` (:75): the status bar above a window's text */
export const ED_ETAT_SY = 11

/** `Edt_BasSy` (:76): the bar below it */
export const ED_BAS_SY = 5

/** a window's own two bars */
const EDT_CHROME_SY = ED_ETAT_SY + ED_BAS_SY

/** one text row, in pixels: every size in this file is `lsl.w #3` away from a count */
export const ED_ROW_SY = 8

/**
 * One `Ed_AutoLoad` record: three bytes that replace a command with a program.
 *
 * `Ed_FCall` (:2612) tests the first byte and branches to `Ed_PrgCommand` when
 * it is not zero, so what makes an entry live is its FLAGS and not its
 * filename. Bit 0 loads the program into a hidden window, bit 2 reloads
 * whatever was there when it finishes.
 *
 * `program` and `line` are 1-based numbers into the `Ed_MnPrograms` text
 * block, and a `line` of 0 means the command line is the editor's current line
 * from the cursor rather than a stored string (`.NoCom`, :7874).
 */
export interface PrgCommand {
  /** the command that was asked for, 1-based */
  command: number
  flags: number
  program: string
  line: string | null
}

/**
 * What `Prg_RunIt` (+Verif.s:4336) is handed, as a request rather than a jump.
 *
 * DEVIATION: `Prg_RunIt` does not return. It ends in `JJmp L_New_ChrGet`, the
 * interpreter's fetch loop, and the editor gets control back only when the
 * program stops and longjmps to `Prg_JError`. Nothing in `src/editor` executes
 * a program, so the editor's half runs, this goes to the host, and the answer
 * comes back through a separate call.
 */
export interface RunRequest {
  /** `Edt_Runned(a5)`, the window whose program is about to run */
  window: Edit
  /** `Prg_RunIt`'s d0: 1 is an accessory, 0 a normal program */
  accessory: boolean
  /** `Ed_RunnedHidden(a5)`: it was started hidden, so the editor stays up */
  hidden: boolean
  /**
   * The command line at `TBuffer-256-6(Buffer)`.
   *
   * `Ed_Run` and `Ed_RunHidden` both `clr.l` it before they hand over, so it
   * is empty for everything but `Ed_PrgCommand`, which is the one caller that
   * writes a line for the program to read.
   */
  commandLine: string
}

export class Editor {
  /**
   * `Edt_List(a5)`, in list order: index 0 is the head.
   *
   * `Edt_OpWindow` links a new window in AFTER the current one and only a
   * first window goes to the head (:11266), so the order is the order the
   * windows are drawn down the screen and not the order they were opened.
   */
  list: Edit[] = []

  /** `Edt_Current(a5)` (+Equ.s:1689): the window `a4` points at */
  current: Edit | null = null

  /**
   * `Ed_WindowToDel(a5)` (+Equ.s:1723): a window `Ed_Loop` will delete.
   *
   * `Ed_RLoadHidden` (:13345) puts the window it just made here and Merge
   * leaves it, so the program Merge read is thrown away on the way back to the
   * loop. `Ed_LoadHidden` does the same load and then `clr.l` (:13380), which
   * is the whole difference between merging a file and keeping it.
   */
  windowToDel: Edit | null = null

  /**
   * `Ed_Config(a5)` (+Equ.s:1671): the block ./config.ts reads and writes.
   *
   * `Ed_DConfig` is not a copy of the file, it IS the file: the editor works
   * out of the block it loaded and `EdC_Save` writes it back where it lies.
   * Every field below that a command can change is one of its offsets.
   */
  config = new EditorConfig()

  /**
   * `EdC_Changed(a5)` (+Equ.s:1706): 0 untouched, 1 the user changed it, 2 it
   * came off disc.
   *
   * `EdC_Saved` (:4944) tests `cmp.b #1`, so a config that was LOADED is not
   * offered for saving and one the user altered is. `Ed_DoQuit` reads the same
   * byte through `Ed_QuitFlags` bit 1.
   */
  configChanged = 0

  /** `Ed_AutoSaveRef(a5)`: when the autosave timer last fired, -1 to restart it */
  autoSaveRef = 0

  /**
   * `Ed_ZapParam(a5)` (+Equ.s:1730): the number the ZAP remote control sent
   * with the command it is running.
   *
   * `Ed_Dialogue` (:3108) answers it INSTEAD of putting a requester up when
   * `Ed_Zappeuse` is set, so every question the editor asks under remote
   * control has the same answer, and `Ed_GotoL` reads it as the line to go to.
   */
  zapParam = 0

  /**
   * `VerNInst` (+Verif.s:277) as the last test left it: how many tokens the
   * walk dispatched.
   *
   * An interpreter global rather than an editor one, and the editor reads it
   * in exactly one place, the Infos box.
   */
  verNInst = 0

  /**
   * `Ed_Available` (:474): `AvailMem(MEMF_PUBLIC|MEMF_FAST)` and the same for
   * chip, which only the Infos box asks for.
   *
   * DEVIATION: there is no allocator under this editor. The pools are the ones
   * `src/amiga/exec.ts` models for a program, with nothing taken out of them,
   * so the figures are an A1200's totals and not a measurement. A host with a
   * running interpreter can put its own numbers here.
   */
  chipFree = A1200_POOLS.chip
  fastFree = A1200_POOLS.fast

  /** `Ed_Sy` (+Editor_Config.s:31): the editor screen's height in pixels */
  get sy(): number {
    return this.config.sy
  }

  set sy(n: number) {
    this.config.sy = n
  }

  /** `Ed_Ty` (+Edit.s:394): how many text rows that is, over all windows */
  get ty(): number {
    return (((this.sy + 7) & ~7) - 16 - ED_YTOP) >> 3
  }

  /**
   * `Ed_WMax` (:410): `(Ed_Ty - 6) / 3`, so 8 on the shipped 256-line screen.
   *
   * Three rows is the smallest a window can be worth opening, and the six taken
   * off first are the title bar and one window's chrome.
   */
  get wMax(): number {
    return Math.floor((this.ty - 6) / 3)
  }

  /**
   * `Ed_System` (:249) was reached: `Ed_DoQuit` has run and the editor is over.
   *
   * DEVIATION: what the machine does next is `L_TheEnd`, which frees the
   * banks, closes the screens and hands the Amiga back. There is nothing here
   * to hand back, so the flag stands in for the last step and a host reads it
   * to know the editor is done.
   */
  quit = false

  /**
   * `Prg_List(a5)` (+Equ.s:1672): every program structure, newest first.
   *
   * `Prg_NewStructure` (+Verif.s:4650) pushes onto the head and
   * `Prg_DelStructure` (:4680) unlinks, so this is a list of PROGRAMS where
   * `list` is a list of VIEWS: a split has two windows and one entry here.
   * `Ed_DoQuit` writes it to the session file ahead of the windows, because
   * every `Edt_Prg` points into it.
   */
  programs: ProgramBuffer[] = []

  /**
   * `Prg_NewStructure`'s two instructions that touch the list (:4655).
   *
   * The machine has no test to make, because a program structure is created
   * exactly once. Here the window's constructor is what registers, and Split
   * View builds a second window on a program already in the list, so the
   * membership test is what stands in for the missing call.
   */
  addProgram(prog: ProgramBuffer): void {
    if (!this.programs.includes(prog)) this.programs.unshift(prog)
  }

  /** `Prg_DelStructure`'s unlink (:4687), which `Edt_DelWindow` reaches at zero */
  delProgram(prog: ProgramBuffer): void {
    const at = this.programs.indexOf(prog)
    if (at >= 0) this.programs.splice(at, 1)
  }

  /**
   * `Ed_QuitFlags`: bit 0 asks before quitting on the last window's close
   * button (:11413), bit 1 saves the config, bit 2 the macros, bit 3 the list
   * of open programs. The shipped default is 1.
   */
  get quitFlags(): number {
    return this.config.quitFlags
  }

  set quitFlags(n: number) {
    this.config.quitFlags = n
  }

  /**
   * `Edt_Runned(a5)` (+Equ.s:1690): the window whose program is running.
   *
   * `Ed_ZapIn` compares it with `Edt_Current` and refuses when they are the
   * same, which is what stops an accessory from driving its own window.
   */
  runned: Edit | null = null

  /**
   * `Prg_Runned(a5)`: the programs that are running, newest first.
   *
   * `Prg_Push` (+Verif.s:4499) pushes and `Prg_Pull` (:4530) pops, and
   * `Prg_DejaRunned` (:4452) walks it comparing a6. That walk is the whole of
   * "is this program already running", and three places ask it: `Ed_RunIt`,
   * `Ed_CloseName` and `Ed_ZapIn`.
   *
   * The interpreter keeps the real stack, in src/interp/interp.ts. What is
   * here is the editor's view of it: which of ITS programs are out running.
   */
  running: ProgramBuffer[] = []

  /** `Prg_DejaRunned` (+Verif.s:4452) */
  dejaRunned(prog: ProgramBuffer): boolean {
    return this.running.includes(prog)
  }

  /** `Ed_RunnedHidden(a5)`: what is running was started hidden */
  runnedHidden = false

  /** `Ed_TstMesOn(a5)`: the "...Testing..." box is up, so someone must close it */
  tstMesOn = false

  /**
   * DEVIATION: `Prg_RunIt` (+Verif.s:4336), which runs a program and does not
   * come back. The editor's half is here; the run itself is the host's, and
   * null means nothing runs, which is where this port has been all along.
   */
  runProgram: ((r: RunRequest) => void) | null = null

  /**
   * `EsFlag(a5)`: the editor's screen is hidden.
   *
   * `Ed_Hide` (+Edit.s:9579) sets it and `Ed_Appear` (:9646) clears it, both
   * guarded, so hiding twice costs nothing and appearing when already up does
   * nothing. `Ed_Hide` also takes every warning box down on the way.
   */
  esFlag = false

  /**
   * `Direct(a5)`, as the EDITOR uses it: the escape screen is in front.
   *
   * `Esc_Appear` (+Edit.s:9329) sets it, `Esc_Hide` (:9507) clears it, and the
   * interpreter reads the same word to decide that an error in a typed line is
   * never trapped (`tst.w Direct(a5) / bne rErr1`, +ILib.s:1330). One word,
   * two owners; this is the editor's half and src/interp/direct.ts is the
   * other.
   */
  escape = false

  /**
   * DEVIATION: `Esc_Appear` and `Esc_Hide`, which are 178 and 72 lines of
   * screen work between them. Nothing in `src/editor` owns a display and the
   * escape screen is drawn on an AMOS screen rather than the editor's, so the
   * screen itself is `src/runtime/directscreen.ts` and this is the door.
   */
  escapeScreen: ((up: boolean) => void) | null = null

  /**
   * DEVIATION: `Ed_SamPlay` (+Edit.s:4799) plays one letter's sample out of
   * bank 5 of the editor's resource, which is a "Samp" bank the port has the
   * bytes of and no editor-side mixer for. The two guards are real and are
   * kept: `Ed_Sounds` off and the ZAP remote control both silence it.
   */
  playSample: ((letter: string) => void) | null = null

  /**
   * DEVIATION: `Ed_Wb` (+Edit.s:11201) is `EcCalD AMOS_WB,0` and nothing else,
   * which is what `Amos To Back` (+Lib.s:11337) is too. Nothing in
   * `src/editor` owns a display, so the flip goes to the host.
   */
  amosToBack: (() => void) | null = null

  /**
   * `Prg_Accessory(a5)`: the running program was started as an accessory.
   *
   * The gate on both halves of the remote control. `Prg_New` (+Verif.s:4626)
   * clears it, so a program that has been edited since it was launched is not
   * one any more.
   */
  accessory = false

  /** `Ed_ZapError(a5)`: 0, or the negative code the last remote call failed with */
  zapError = 0

  /** `Ed_ZapMessage(a5)`, as a message number rather than as the pointer it is */
  zapMessage = 0

  /**
   * `Ed_BufT+256` behind `$FFFE0102` (:7605): the last alert, kept for
   * `Ed_RAlert`.
   *
   * DEVIATION: the magic long is a guard against scratch memory. `Ed_BufT` is
   * the editor's general buffer and anything may have written over it since,
   * so `Ed_RAlert` (:7580) checks the four bytes before it believes the rest.
   * Nothing here shares the buffer, so the guard would always pass and what is
   * kept is the message number.
   */
  alertSaved = 0

  /** the same buffer's characters, for the one alert whose text is not in `Ed_Messages` */
  alertSavedText = ''

  /**
   * `Handle(a5)` once `Ed_PRTOpen` (+Edit.s:13974) has run, and null for the
   * printer that would not open.
   *
   * The name it opens is system message 43, which is `Par:`
   * (+Interpreter_Config.s:153, in the block headed "Ports de
   * communication"). So the editor writes to the parallel port raw: no
   * printer.device, no Preferences driver, no page size. `L_PRT_Open`
   * (+Lib.s:5411) takes the same message, so `Lprint` goes the same way.
   *
   * DEVIATION: `Handle` is an AmigaDOS file, and `EditorFS` has no `PRT:` to
   * open. The sink is the door instead, and false from it is `Ed_PErr`.
   */
  printer: ((data: Uint8Array) => boolean) | null = null

  /**
   * `PI_PrtRet` (+Interpreter_Config.s:45), which ships as 1.
   *
   * Zero means the printer supplies its own line feed, so `Ed_PRTPrint` drops
   * the carriage return in front of every 10. It belongs to the interpreter's
   * configuration block and the editor reads it from there.
   */
  prtRet = PI_DEFAULTS.PrtRet

  /**
   * `Ed_Avert` (+Equ.s:1704): the warning boxes standing in front of the text.
   *
   * `Ed_Avertir` (+Edit.s:7674) counts up and uses the count as the Interface
   * block number, so the boxes stack; `Ed_AverFin` (:7699) deletes the top one
   * and counts back down.
   *
   * DEVIATION: the machine keeps the count alone, since the box is already
   * drawn. What is kept here is the message number of each, because nothing
   * in this port draws and the number is the only evidence a box went up.
   */
  avert: number[] = []

  /**
   * `Ed_Zappeuse(a5)`: the ZAP remote control is driving, so nothing may ask.
   *
   * `Ed_File_Selector` answers 1 without drawing, `Ed_CloseWindowQuit` closes
   * without offering to quit, and `Prg_New` keeps the banks.
   */
  zappeuse = false

  /* ---- the a5 fields every window shares -------------------------------- */

  /**
   * `Ed_Block(a5)` (+Equ.s:1725): the editor's one clipboard.
   *
   * One pointer for the whole editor, so a block cut in one window pastes into
   * another. ./block.ts has the layout.
   */
  block = new Block()

  /**
   * `Ed_SchBuf` (+Equ.s:1757): what Search is looking for.
   *
   * 34 bytes on the machine, of which `Ed_DiaS`'s `move.l #32,(a2)+` lets the
   * user fill 32. It survives between commands, which is the whole of what
   * Search Next has to work with.
   */
  schBuf = ''

  /** `Ed_RepBuf` (+Equ.s:1758): the other 34 bytes, what it is replaced with */
  repBuf = ''

  /** `Ed_SchMode` (+Equ.s:1810), the four flag gadgets of ./search.ts's `SM` */
  get schMode(): number {
    return this.config.schMode
  }

  set schMode(n: number) {
    this.config.schMode = n
  }

  /** `EdMa_List(a5)` (+Equ.s:1710): the macros, most recently made first */
  macros: Macro[] = []

  /**
   * `EdMa_Play(a5)` (+Equ.s:1711): where playback has got to, null for none.
   *
   * `keys` is the macro's keystrokes and `at` is the byte offset into them,
   * which the machine keeps as a live pointer it steps by three.
   */
  macroPlay: { keys: Uint8Array; at: number } | null = null

  /** `EdMa_Tape(a5)` (+Equ.s:1712): the buffer being recorded into, null for none */
  macroTape: MacroTape | null = null

  /**
   * DEFECT: `EdMa_Change(a5)` (+Equ.s:1713), which nothing reads.
   *
   * `EdMa_Stop`, `EdMa_Del` and `EdMa_DelAll` all set it -- every change a
   * person can make to the macros. `Ed_DoQuit` (:4402) then reads
   * `EdMa_Changed`, one letter away at +Equ.s:1704, to decide whether to save
   * them on the way out. So recording a macro and quitting loses it, and the
   * only edits that survive are ones made after a Load As, which is what
   * happens to set the other flag.
   */
  macroChange = false

  /** `EdMa_Changed(a5)` (+Equ.s:1704): raised by Load As, and read by Quit */
  macroChanged = false

  /**
   * `Name1(a5)`: the filename every disc command works through.
   *
   * One buffer for the whole editor, filled by the file selector and read by
   * `Prg_Load`, `Prg_Save` and `Ed_MakeBak`. With no requester installed it is
   * what a command uses, which is exactly the ZAP path: `Ed_File_Selector`
   * answers 1 without asking when `Ed_Zappeuse` is set (+Edit.s:14061).
   */
  name1 = ''

  /**
   * `Dia_LastKey` (+Lib.s:24196): the keystroke the last requester was
   * answered with, as an `Inkey` long.
   *
   * EdD_Macro1 and EdD_MacroD wait for a key rather than a button, and this is
   * where the answer lands. With no requester installed it is what a macro
   * command uses, the same way `Name1` stands in for the file selector.
   */
  lastKey = 0

  /**
   * `Sys_Pathname(a5)`: the AMOSPro system directory.
   *
   * `Sys_AddPath` (+B.s:534) puts it in front of any name with no colon in
   * it, which is how the default macro and config files are found. The
   * machine works it out at boot from where AMOSPro was launched; this is the
   * assign `src/cli/nodefs.ts` mounts it under.
   */
  sysPath = 'AMOSPro_System:'

  /**
   * `Ed_SvBak` (+Editor_Config.s:46, default -1): rename the old file to
   * `.Bak` before saving over it.
   */
  get svBak(): boolean {
    return this.config.svBak
  }

  set svBak(v: boolean) {
    this.config.svBak = v
  }

  /**
   * DEVIATION: `DosBase`, which `D_Open` and `_LVORename` go through.
   *
   * The machine's editor calls dos.library directly and this port's model of
   * it is `src/amiga/vfs.ts`. Null means no filesystem, and every command that
   * needs one raises a disc error rather than pretending.
   */
  fs: EditorFS | null = null

  /**
   * `Ed_TstMessages` (+Equ.s:1676): the last command's Test failed, and this
   * is which of the 54 test messages it stopped on. -1 for none.
   *
   * DEVIATION: the same shape `diskError` has. The machine builds the text and
   * hands it to `Ed_Alert`; that table is the verifier's rather than the
   * editor's, so what is kept here is the code, and `Ed_ErrTest` has already
   * put the cursor on the byte the walk stopped at.
   */
  testError = -1

  /**
   * `Ed_DError` (+Edit.s:14019): the last command died on a disc error.
   *
   * DEVIATION: the machine reads `_LVOIoErr`, maps it through `ErDisked` into
   * `Ed_RunMessages` and puts up EdD_DiskErr. That message table is the
   * interpreter's and this port has not generated it, so what is kept is the
   * AmigaDOS code. 0 means the filesystem refused and did not say why.
   */
  diskError = -1

  /**
   * DEVIATION: the dialogues, which the machine draws and this port asks for.
   *
   * `Ed_DiaS` (:6962) fills `Ed_SchBuf` and `Ed_SchMode` off an Intuition
   * requester and answers 1 for Ok. There is no requester here, so the host
   * supplies one. Null means nobody did, and the commands then run on the
   * buffers as they stand, which is a dialogue that always says Ok and
   * changes nothing.
   */
  dialogues: EditorDialogues | null = null

  /**
   * DEVIATION: `Ed_PrgCommand` (+Edit.s:7868), which loads an AMOS program and
   * runs it in place of the command that was asked for.
   *
   * `Ed_AutoLoad` binds any of the 184 commands to a program, and the shipped
   * config binds 37 of them to `AMOSPro_Help.AMOS`. Running one needs the
   * interpreter, so this port makes the DECISION and hands what it decided to
   * the host; null means nothing happens and the command is still refused,
   * which is what a machine with the accessory missing does.
   */
  prgCommand: ((cmd: PrgCommand) => void) | null = null

  /**
   * `Ed_Insert` (+Editor_Config.s:90, default -1): insert rather than
   * overwrite.
   *
   * Config, so one flag for the whole editor. Flip it in one half of a split
   * view and the other half flips too.
   */
  get insert(): boolean {
    return this.config.insert
  }

  set insert(v: boolean) {
    this.config.insert = v
  }

  /** `Ed_Tabs` (+Editor_Config.s:59): three spaces */
  get tabs(): number {
    return this.config.tabs
  }

  set tabs(n: number) {
    this.config.tabs = n
  }

  /**
   * `T_Actualise`'s `BitControl` (+Equ.s:827): Ctrl-C is down.
   *
   * The editor's own loop simulates one at :1579 and `Ed_SchFront` reads it
   * with `bclr`, so the flag is consumed by whoever notices it first.
   */
  abort = false

  /**
   * `AdTokens+4` (+Equ.s:764): the twenty-six extension slots, by `LB_Title`.
   *
   * Index 0 is slot 1, because `AdTokens` itself is the core token table and
   * `Ed_About` counts from `AdTokens+4`. Null is a slot with no library in it,
   * which is `tst.l (a0)` on the machine, and an empty string is a library
   * whose `LB_Title` is zero -- `Ed_AboutExt`'s `.Empty dc.w 0` shows a blank
   * line for that rather than skipping the slot.
   *
   * DEVIATION: the machine holds a pointer to the whole library here and the
   * two About boxes are the only readers in the editor. The title is what
   * they read.
   */
  extensions: (string | null)[] = Array.from({ length: 26 }, () => null)

  /** `Ed_SCallFlags` (+Equ.s:1706): what the command that just ran wants redrawn */
  callFlags = 0

  /**
   * `EdM_PosHidden(a5)` (+Equ.s:1761): the first hidden program the AMOS menu
   * is showing, which `Ed_FCall` adds to every hidden-command index.
   *
   * `EdM_HiddenMax` is 12 (+Edit.s:114), so the menu pages by 11 at a time
   * through `EdM_PrevHidden` and `EdM_NextHidden` (JFonc 179 and 180). Those
   * two are the menu's and the menu is not ported, so nothing moves this yet.
   */
  posHidden = 0

  /* ---- the list ---------------------------------------------------------- */

  /**
   * `Edt_OpWindow`'s link (:11261): after `after`, or at the head.
   *
   * The machine has no list tail, so "after the current window" is the only
   * place a new one can go cheaply, and that is where every one of them goes.
   */
  link(after: Edit | null, w: Edit): void {
    const at = after === null ? -1 : this.list.indexOf(after)
    this.list.splice(at + 1, 0, w)
  }

  /**
   * `Edt_WCount` (:12433): visible windows, counting from the head and
   * stopping AFTER `upTo`.
   *
   * The `cmp.l d1,a0 / beq .Out` is below the count, so the window named is
   * included. Null counts the whole list, which is the `sub.l a0,a0` its two
   * callers pass.
   */
  count(upTo: Edit | null = null): number {
    let n = 0
    for (const w of this.list) {
      if (w.hidden === 0) n++
      if (w === upTo) break
    }
    return n
  }

  /** `Edt_WNext` (:12491): the first visible window after `w`, or null */
  wNext(w: Edit): Edit | null {
    const at = this.list.indexOf(w)
    if (at < 0) return null
    for (let i = at + 1; i < this.list.length; i++) {
      if (this.list[i]!.hidden === 0) return this.list[i]!
    }
    return null
  }

  /**
   * `Edt_WPrev` (:12472): the last visible window before `w`, or null.
   *
   * Forwards from the head keeping the last one seen, because the list has no
   * back pointer. A window that is not in the list at all answers the last
   * visible window there is, which is what `Edt_DelWindow` relies on.
   */
  wPrev(w: Edit): Edit | null {
    let found: Edit | null = null
    for (const other of this.list) {
      if (other === w) break
      if (other.hidden === 0) found = other
    }
    return found
  }

  /**
   * `Edt_WAutre` (:11960): make some other window current, `min` rows or more.
   *
   * Forwards first, and when the forward walk runs out it carries on
   * BACKWARDS from wherever it stopped, which is the end of the list rather
   * than the window it started at. So a window near the top that finds nothing
   * below it gets the last window on the screen and not the one above it.
   */
  wAutre(from: Edit, min = 1): Edit | null {
    let at = from
    for (;;) {
      const next = this.wNext(at)
      if (next === null) break
      at = next
      if (min <= at.windTy) return this.activate(at)
    }
    for (;;) {
      const prev = this.wPrev(at)
      if (prev === null) return null
      at = prev
      if (min <= at.windTy) return this.activate(at)
    }
  }

  private activate(w: Edit): Edit {
    this.current = w
    return w
  }

  /** `Edt_WAlone` (:12217): the only window with an area on the screen */
  alone(w: Edit): boolean {
    return w.first && w.last
  }

  /**
   * `Edt_WFirstLast` (:12412): which visible window is at the top and which at
   * the bottom.
   *
   * With nothing visible the machine writes `Edt_Last` through a null pointer.
   * No path reaches it: `Ed_WindowHide` refuses on the last window and
   * `Ed_DrawWindows` is the only caller.
   */
  firstLast(): void {
    let last: Edit | null = null
    for (const w of this.list) {
      w.first = false
      w.last = false
      if (w.hidden !== 0) continue
      if (last === null) w.first = true
      last = w
    }
    if (last !== null) last.last = true
  }

  /** `Edt_OrderWindows` (:11911): number the visible windows from 1, down the screen */
  orderWindows(): void {
    let n = 1
    for (const w of this.list) if (w.hidden === 0) w.order = n++
  }

  /**
   * `Edt_EffWindows` (:11880): take down the screen areas.
   *
   * The one part of it that outlives a screen: a window asked to hide is at
   * `Edt_Hidden` 1 until this runs, and this is what makes it 2.
   */
  effWindows(): void {
    for (const w of this.list) {
      if (w.window === 0) continue
      if (w.hidden === 2) continue
      if (w.hidden === 1) w.hidden = 2
      w.window = 0
    }
  }

  /**
   * `Edt_WMaxSize` (:12511): the most text rows `w` could have.
   *
   * Every other visible window is charged its chrome plus its rows, `w` is
   * charged its chrome and no rows, and what is left of `Ed_Sy` is the answer.
   * `limit` caps what the others are charged, so 1 asks how big `w` could be
   * if they were all squeezed to one row and -1 asks how big it can be without
   * touching them. One window on the shipped screen gets 28.
   */
  maxSize(w: Edit, limit: number): number {
    return this.wMaxSize(w, limit).rows
  }

  /**
   * `Edt_WMaxSize` (:12511) in full: d1, d2 and d0 rather than d0 alone.
   *
   * `min` is where the window's top could go if every window above it were
   * squeezed to `limit` rows, `max` is where the free pixels run out, and
   * `rows` is how many text rows are going spare. `Ed_RShLimits` and
   * `Ed_RSbLimits` want the first two and `Ed_WindowSize` the third.
   */
  wMaxSize(w: Edit, limit: number): { min: number; max: number; rows: number } {
    let used = ED_TITRE_SY
    let min = ED_TITRE_SY
    for (const other of this.list) {
      if (other === w) {
        min = used
        used += EDT_CHROME_SY
        continue
      }
      if (other.hidden !== 0) continue
      used += EDT_CHROME_SY
      let rows = other.windTy
      if (limit >= 0 && rows > limit) rows = limit
      used += rows * ED_ROW_SY
    }
    const free = this.sy - used
    return { min, max: min + free + EDT_CHROME_SY, rows: free >> 3 }
  }

  /**
   * `Edt_Y` (+Equ.s:1888): the top of the window's status bar, in pixels.
   *
   * DEVIATION: the machine stores it and `Edt_WChange` writes it. Nothing here
   * does, because `Edt_WMaxSize`'s own walk shows it is a function of the list:
   * the title bar, then every visible window before this one at its chrome
   * plus its rows. Storing it would be storing a sum this port can add up.
   */
  topY(w: Edit): number {
    let y = ED_TITRE_SY
    for (const other of this.list) {
      if (other === w) return y
      if (other.hidden !== 0) continue
      y += EDT_CHROME_SY + other.windTy * ED_ROW_SY
    }
    return y
  }

  /** `Edt_BasY`: the top of the bar BELOW the text, which is the same sum plus the text */
  basY(w: Edit): number {
    return this.topY(w) + ED_ETAT_SY + w.windTy * ED_ROW_SY
  }

  /**
   * `Edt_WChange` (:12266): the window is now `y` to `basY`, and its neighbours
   * pay for it.
   *
   * The two ends are independent. A top that goes UP takes rows off the
   * windows above, one row at a time down to one row each and then down to
   * none; a top that goes DOWN hands its rows to the window immediately above.
   * The bottom is the mirror of that.
   *
   * Answers false for `beq.s .Rien`, which is a move that changed nothing.
   */
  wChange(w: Edit, y: number, bas: number): boolean {
    // both ends are read before anything moves, because on the machine they
    // are stored words and the top adjustment does not touch `Edt_BasY`
    const oldY = this.topY(w)
    const oldBas = this.basY(w)
    w.windTy = (bas - y - ED_ETAT_SY) >> 3
    if (y !== oldY) {
      if (y < oldY) {
        // `Edt_WPlaceHaut` twice: once leaving every window a row, and again
        // taking the shortfall from windows it had spared
        const left = this.placeHaut(w, (oldY - y) >> 3, 1)
        if (left !== 0) this.placeHaut(w, left, 0)
      } else {
        const prev = this.wPrev(w)
        if (prev !== null) prev.windTy += (y - oldY) >> 3
      }
    }
    if (bas !== oldBas) {
      if (bas < oldBas) {
        const next = this.wNext(w)
        if (next !== null) next.windTy += (oldBas - bas) >> 3
      } else {
        const left = this.placeBas(w, (bas - oldBas) >> 3, 1)
        if (left !== 0) this.placeBas(w, left, 0)
      }
    }
    return true
  }

  /**
   * `Edt_WChangeHaut` (:12226): the top separator to pixel `y`.
   *
   * A window in the middle of the list carries its bottom along with it. The
   * LAST one cannot, since there is nothing below to give the rows to, so its
   * bottom stays where it is and only its height changes -- unless the top has
   * come down past the bottom, in which case the bottom follows and the window
   * is left with no text at all.
   */
  wChangeHaut(w: Edit, to: number): boolean {
    const y = to & ~7
    const oldY = this.topY(w)
    if (y === oldY) return false
    if (w.last) {
      const bas = this.basY(w)
      return this.wChange(w, y, Math.max(bas, y + ED_ETAT_SY))
    }
    return this.wChange(w, y, this.basY(w) + (y - oldY))
  }

  /**
   * `Edt_WChangeBas` (:12250): the bottom separator to pixel `y`.
   *
   * The rounding is `addq #Edt_BasSy / and #$FFF8 / subq #Edt_BasSy`, so the
   * bottom bar lands on a multiple of eight and `Edt_BasY` itself is always
   * five below one. The top comes down with it only when the bottom has passed
   * the top.
   */
  wChangeBas(w: Edit, to: number): boolean {
    const bas = ((to + ED_BAS_SY) & ~7) - ED_BAS_SY
    if (bas === this.basY(w)) return false
    const y = this.topY(w)
    return this.wChange(w, Math.min(y, bas - ED_ETAT_SY), bas)
  }

  /**
   * `Edt_WVideNext` (:11953): the current window has no rows left, so make
   * another one current.
   *
   * It runs after every separator move, and it is why dragging a separator
   * over the current window does not leave the cursor somewhere invisible.
   */
  videNext(): void {
    const w = this.current
    if (w === null || w.windTy !== 0) return
    this.wAutre(w)
  }

  /** `Edt_WSchrinkAll` (:12451): every visible window down to `size`, and the rows that frees */
  schrinkAll(size: number): number {
    let gain = 0
    for (const w of this.list) {
      if (w.hidden !== 0) continue
      if (size >= w.windTy) continue
      gain += w.windTy - size
      w.windTy = size
    }
    return gain
  }

  /**
   * `Edt_WPlaceHaut` (:12328): take `need` rows off the windows ABOVE `w`,
   * leaving each at least `min`. Answers the rows it could not find.
   *
   * It works down the list from `w` and stops the moment one window can pay
   * the rest, so the window immediately above is emptied to `min` before the
   * one above that is touched at all.
   */
  placeHaut(w: Edit, need: number, min: number): number {
    let at = w
    let left = need
    for (;;) {
      const prev = this.wPrev(at)
      if (prev === null) return left
      at = prev
      if (min >= at.windTy) continue
      if (left < at.windTy) {
        at.windTy -= left
        return 0
      }
      left -= at.windTy - min
      at.windTy = min
    }
  }

  /** `Edt_WPlaceBas` (:12352): the same, downwards */
  placeBas(w: Edit, need: number, min: number): number {
    let at = w
    let left = need
    for (;;) {
      const next = this.wNext(at)
      if (next === null) return left
      at = next
      if (min >= at.windTy) continue
      if (left < at.windTy) {
        at.windTy -= left
        return 0
      }
      left -= at.windTy - min
      at.windTy = min
    }
  }

  /** `Ed_GetHidden` (:11495): the `n`th hidden window, counting from 0 */
  getHidden(n: number): Edit | null {
    let left = n
    for (const w of this.list) {
      if (w.hidden === 0) continue
      if (left-- === 0) return w
    }
    return null
  }

  /**
   * `Edt_AccAdr` (:8064): the window already holding `name`, or null.
   *
   * Both names are cut back to the last `/` or `:` first (`Ed_DNom`, :13428)
   * and compared without case, so two programs of the same name in different
   * drawers are the same program to this.
   */
  accAdr(name: string): Edit | null {
    const want = baseName(name).toUpperCase()
    for (const w of this.list) if (baseName(w.prog.name).toUpperCase() === want) return w
    return null
  }

  /** `Edt_GetAd` (:12396): the window whose zone number is `window` */
  getAd(window: number): Edit | null {
    for (const w of this.list) if (w.window === window) return w
    return null
  }

  /** `Edt_DelLinkScroll` (:2373): every window that scrolls with `target` stops */
  delLinkScroll(target: Edit): void {
    for (const w of this.list) if (w.linkScroll === target) w.linkScroll = null
  }

  /**
   * `Edt_DelWindow` (:11511): the structure gone, and who is current after it.
   *
   * The order matters and is the machine's: the program's window count drops
   * first, then the next window is chosen while `w` is still in the list, then
   * the split chain and the scroll links are unpicked, then `w` leaves the
   * list. Choosing the next one first is why closing one half of a split view
   * hands the cursor to the other half: `Edt_LinkPrev` beats whatever the walk
   * found.
   */
  delWindow(w: Edit): void {
    // `L_Prg_DelStructure` and `Prg_UndoFree` when the count reaches zero;
    // the allocations are dropped by whoever stops holding them, and what is
    // left of the call is the list it takes the program out of
    w.prog.edited--
    if (w.prog.edited <= 0) this.delProgram(w.prog)
    if (this.current === w) {
      let next = this.wNext(w) ?? this.wPrev(w)
      const link = w.linkPrev ?? w.linkNext
      if (link !== null) next = link
      this.current = next
    }
    if (w.linkNext !== null) w.linkNext.linkPrev = w.linkPrev
    if (w.linkPrev !== null) w.linkPrev.linkNext = w.linkNext
    w.linkPrev = null
    w.linkNext = null
    this.delLinkScroll(w)
    const at = this.list.indexOf(w)
    if (at >= 0) this.list.splice(at, 1)
  }

  /** `Edt_DelWindows` (:11581): all of them, from the head */
  delWindows(): void {
    while (this.list.length !== 0) this.delWindow(this.list[0]!)
  }
}

/** `Ed_DNom` (+Edit.s:13428): the name after the last `/` or `:` */
function baseName(name: string): string {
  let at = name.length
  while (at > 0) {
    const c = name[at - 1]!
    if (c === '/' || c === ':') break
    at--
  }
  return name.slice(at)
}
