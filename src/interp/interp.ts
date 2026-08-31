import type { Tok, TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { detokLine } from '../tokens/edtok'
import { Names } from './names'
import { prescan, scopeOfAddr, varKey } from './prescan'
import type { Addr, Ctrl, Program } from './prescan'
import { AmosError, amosErrorCode, coerce, defaultValue, display, ENT_NUL, ffpRound, funcCall, int, num, str, varType, VI } from './values'
import type { Value, VarType } from './values'
import type { AmosIO } from './io'
import { INSTR, FUNCS, RAWFUNCS } from './builtins'
import type { Instr as InstrFn, Func as FuncFn } from './builtins'
import { KEYWORD_PROBE } from '../coverage/probe'
import type { Controller } from '../amiga/controller'
import { Machine } from '../amiga/machine'
import { applyJoyBits, joyBitsOf } from './gameport'

export class AmosRuntimeError extends Error {
  constructor(
    /** the error on its own, without the line it happened on */
    readonly text: string,
    readonly line: number,
    readonly listing: string,
    /**
     * `Prg_JError`'s d0: the AMOS error number, which is what the editor
     * turns back into a message (`Ed_GetError` +Edit.s:8323). Zero when the
     * number is not known, which is what `Ed_GetError` reads as a TEST
     * message rather than a run-time one.
     */
    readonly code = 0,
    /**
     * `VerPos(a5)`: the byte offset, within the source block, of the token the
     * error was about. `rErr1` (+ILib.s:1370) writes `d7-2` there, which is
     * the last token the interpreter read, and `Ed_ErrEdit` (+Edit.s:8291)
     * reads it back to put the cursor on it. -1 when the lines came from text
     * and carry no offsets.
     */
    readonly at = -1,
  ) {
    super(`${text} — at line ${line}: ${listing.trim()}`)
  }
}

export interface AmosArray {
  type: VarType
  /** per-dimension element counts (Dim A(10) → [11]) */
  dims: number[]
  data: Value[]
}

export interface Frame {
  vars: Map<string, Value>
  arrays: Map<string, AmosArray>
  /** variable keys resolved in the global frame (Shared) */
  shared: Set<string>
  /** procedure parameter keys — always local, they shadow a Global of the
   * same name (AMOS params are passed by value into the proc's own frame) */
  params: Set<string>
  retAddr: Addr | null
  loopBase: number
  gosubBase: number
  /** caller's data pointer — procedures have their own (local Data) */
  savedDataPtr?: Addr
  savedDataInStmt?: boolean
  /**
   * The caller's error trapping, which a procedure does NOT inherit.
   *
   * CallProc pushes OnErrLine, ErrorChr and ErrorOn (+ILib.s:2586-2588) and
   * then does `clr.l OnErrLine(a5)` (+ILib.s:2603); End Proc pops all three
   * back (+ILib.s:2651-2653). So an error inside a called procedure is not
   * seen by the caller's On Error, and a handler armed inside a procedure is
   * gone the moment it returns.
   */
  savedErrorHandler?: { kind: 'goto' | 'proc'; target: string } | null
  savedInError?: boolean
  /**
   * ErrorChr, which CallProc saves (+ILib.s:2587) but does NOT clear. So the
   * flavour bit and any recorded Resume Label still read as the caller's
   * inside a handler procedure, and PopP puts the caller's back.
   */
  savedErrIsProc?: boolean
  savedResumeLabel?: string | null
}

export interface LoopFrame {
  t: 'for' | 'repeat' | 'while' | 'do'
  tok: Tok
  /** first statement of the loop body */
  body: Addr
  /** first statement after the loop — Goto outside unwinds the frame */
  end: Addr
  varKey?: string
  varT?: VarType
  step?: number
  limit?: number
}

export interface Target {
  type: VarType
  /** stable identity for the referenced cell (Varptr arena slots) */
  key?: string
  get(): Value
  set(v: Value): void
  /**
   * Set when the target is an ARRAY ELEMENT, with the array itself and the
   * element's linear index.
   *
   * `Varptr` needs both. An array is one contiguous block on the machine, so
   * `Varptr(A(0)) + 4` is `A(1)` and walking a pointer through an array is the
   * ordinary way to hand one to anything written in assembler — GameSupport's
   * `Gspasscode(ID$, Varptr(A(0)), 4)` is its own manual's example of it.
   * Without these an element resolves to a lone four-byte cell and the walk
   * reads whatever happens to sit beside it.
   */
  array?: { data: Value[]; type?: number }
  index?: number
}

/** Why execution is paused, waiting on the outside world. */
export type Block =
  | { type: 'wait'; until: number }
  | { type: 'waitKey' }
  /**
   * Waiting on the mouse, the keyboard, or either — what JD's Jd Mwait,
   * Jd Keywait, Jd Wait Amiga and Jd Wait Event block on (+|jd.s:2031-2743).
   * `keys` narrows it to a set of characters when the keyword takes one
   * (Keywait's allowed list); `amiga` requires the Amiga key held with it.
   *
   * `sdr` is a different kind of wait: the value CIA-A's keyboard serial
   * register held when the block was taken, resuming as soon as it holds
   * something else. It is there for the readers that go to the hardware
   * rather than to AMOS, and it wakes on things `key` cannot see — a key
   * being RELEASED, or a Shift going down, neither of which queues a
   * character. Range's Ch Key Scan is exactly a wait for one then the other.
   */
  | {
      type: 'waitInput'
      mouse: boolean
      key: boolean
      keys?: string
      amiga?: boolean
      sdr?: number
    }
  | { type: 'input'; prompt: string }
  | { type: 'dialog'; channel: number }
  | { type: 'fsel' }
  /** asl.library's requester, which blocks the statement the way Fsel$ does */
  | { type: 'asl' }
  /**
   * reqtools.library's requester, the same way. Its own type rather than
   * `asl`'s: a program can have an ASL file requester up and a reqtools
   * EZRequest waiting behind it, because two extensions can be loaded at
   * once and neither knows about the other.
   */
  | { type: 'rtreq' }
  | { type: 'readtext' }
  /**
   * EasyLife's `Eliconify Amos`, which is a LOOP in the extension: Begin,
   * then `Rbsr Eliconify Test` until it answers non-zero, then End. The
   * statement re-runs on resume, so the keyword itself does the polling and
   * this block only means "one frame has gone by" — the same shape as the JD
   * waiters, and for the same reason.
   */
  | { type: 'iconify' }
  /**
   * The Intuition Extension's waiters: `Iwait Event`, `Iwait Key` and their
   * neighbours poll and block again, so the keyword itself does the waiting
   * and this only means "one frame has gone by". Same shape as `iconify`.
   */
  | { type: 'ievent' }
  // the speech library is 88K of tables, imported on the first Say
  | { type: 'speech' }
  /**
   * A path named a volume that is not mounted, so the handler is asking for
   * it. `Lock()` does not come back until the disk turns up or the user
   * cancels, so the statement is rewound and runs again when it does.
   */
  | { type: 'insert'; volume: string }

/**
 * Live input state: half the machine's hardware and half this program's
 * place in it.
 *
 * Every field here used to be plain data on this object, which made two
 * different things look like one. `keys`, `sdr`, `mouseK` and `ports` are
 * DEVICES: there is one keyboard, one CIA-A serial register and two nine-pin
 * connectors, and they belong to the machine whether a program is running or
 * not. `keyQueue`, `lastScan`, `lastShift` and `mouseClickOld` are this
 * program's CONSUMPTION of them: `Inkey$` taking a keystroke is not a
 * hardware event, it is one reader deciding it has had that one.
 *
 * The split is not a tidiness argument, it is what breaks the moment there
 * are two programs. One keyboard, two queues. On the machine that is exactly
 * how it works, because keystrokes reach a program through Intuition's IDCMP
 * and the queue is per window.
 *
 * So the device half is now a VIEW of `../amiga/machine.ts` rather than a
 * copy of it, in the same way `joy` has always been a view of `ports[1]`.
 * Nothing that reads this changed, and the interesting consequence is that
 * `Peek($BFE001)` and `Mouse Key` finally read the same byte.
 */
export interface InputState {
  /** typed characters not yet consumed by Inkey$ / Wait Key */
  keyQueue: Array<{ ch: string; scan: number; shift?: number }>
  /** Amiga scancodes currently held down (Key State). The machine's keyboard. */
  keys: Set<number>
  /**
   * CIA-A's serial data register at $bfec01 — the last byte the keyboard
   * clocked in, encoded the way the keyboard encodes it (see
   * `src/amiga/keyboard.ts`). Not a scancode: the readers that go to the
   * hardware rather than to AMOS each decode it their own way, and two of
   * them decode it wrongly. Latched on key down AND key up.
   */
  sdr: number
  /** scancode of the last key returned by Inkey$ */
  lastScan: number
  /** shift byte captured with the last Inkey$ (SScan high byte) */
  lastShift: number
  /**
   * Mouse in AMOS hardware coords (lowres pixel + 128/50 origin).
   *
   * The machine's mouse. These two are also JOY0DAT's counters modulo 256,
   * which is why they live on the device: see `../amiga/mouse.ts`.
   */
  mouseX: number
  mouseY: number
  /**
   * Buttons currently held (bit 0 left, bit 1 right, bit 2 middle).
   *
   * The machine's mouse. These three bits are pins on two different chips —
   * CIA-A PRA bit 6, POTGOR bits 10 and 8 — and `../amiga/mouse.ts` says
   * which is which.
   */
  mouseK: number
  /** button state at the last Mouse Click read, for edge detection */
  mouseClickOld: number
  /**
   * The two gameports, as devices — `../amiga/controller.ts`.
   *
   * Indexed the way the hardware is: 0 is the mouse port, 1 the joystick
   * port, which is `Joy()`'s numbering too. This is where a controller's TYPE
   * and its seven buttons live, and `joy`/`joy0` below are a view of it
   * rather than a second copy.
   */
  ports: [Controller, Controller]
  /**
   * port-1 joystick bits (Joy(1)) — the `JOY_*` packing in ./gameport.ts.
   *
   * An accessor over `ports[1]`, so that the five bits and the device cannot
   * disagree: setting this sets the controller, and a controller set any
   * other way is visible here immediately. Assigning it assigns the whole
   * one-button-stick state — see `applyJoyBits`.
   */
  joy: number
  /** port-0 joystick bits (Joy(0)) — the mouse port; a distinct player */
  joy0: number
  /** Set Key$(1..20) function-key definition strings */
  funcKeys: string[]
}

/**
 * A view of one machine's input devices, plus this program's consumption
 * state.
 *
 * The machine may be passed as a thunk, and the Runtime passes one: its
 * `input` field is built before `opts.machine` has replaced the default, so a
 * captured object would bind to a machine that gets thrown away.
 */
/** what a machine with no keyboard on the ribbon is holding down */
const NO_KEYS: Set<number> = new Set()

export const newInputState = (machine: Machine | (() => Machine) = new Machine()): InputState => {
  const m = typeof machine === 'function' ? machine : (): Machine => machine
  return {
    get keys(): Set<number> {
      // no keyboard plugged in means no key is down. One shared set rather
      // than a new one per read: this is polled every frame by `Key State`.
      return m().keyboard?.held ?? NO_KEYS
    },
    get sdr(): number {
      return m().cia.sdr
    },
    set sdr(v: number) {
      m().cia.sdr = v
    },
    get mouseK(): number {
      // nothing plugged in holds no button down
      return m().mouse?.buttons ?? 0
    },
    set mouseK(v: number) {
      const mouse = m().mouse
      if (mouse) mouse.buttons = v
    },
    // the pointer belongs to the counters rather than to the mouse, so it
    // survives one being unplugged: ../amiga/machine.ts
    get mouseX(): number {
      return m().mouseX
    },
    set mouseX(v: number) {
      m().mouseX = v
    },
    get mouseY(): number {
      return m().mouseY
    },
    set mouseY(v: number) {
      m().mouseY = v
    },
    get ports(): [Controller, Controller] {
      return m().ports
    },
    get joy(): number {
      return joyBitsOf(m().ports[1])
    },
    set joy(bits: number) {
      applyJoyBits(m().ports[1], bits)
    },
    get joy0(): number {
      return joyBitsOf(m().ports[0])
    },
    set joy0(bits: number) {
      applyJoyBits(m().ports[0], bits)
    },
    ...newInputRest(),
  }
}

/** the part that is this program's rather than the machine's */
const newInputRest = (): Omit<
  InputState,
  'ports' | 'joy' | 'joy0' | 'keys' | 'sdr' | 'mouseK' | 'mouseX' | 'mouseY'
> => ({
  keyQueue: [],
  lastScan: 0,
  lastShift: 0,
  mouseClickOld: 0,
  funcKeys: [],
})

export interface InterpOptions {
  io?: AmosIO
  extensions?: Map<number, TokenTable>
  /** what to do with instructions the interpreter doesn't know yet */
  onUnimplemented?: 'throw' | 'skip'
  /** lifetime statement cap — a runaway-loop backstop */
  maxSteps?: number
  /** extra instruction handlers (e.g. the graphics runtime); override core */
  instructions?: Record<string, InstrFn>
  /** extra functions; override core */
  functions?: Record<string, FuncFn>
  /** functions that parse their own arguments (Match, Hunt, ...) */
  rawFunctions?: Record<string, (it: Interp, tok: Tok) => Value>
  input?: InputState
  /**
   * What one statement costs against `run`'s slice, in whatever unit the
   * caller's budget is in.
   *
   * The Runtime passes `CYCLES_PER_STATEMENT` and a budget of one vertical
   * blank's cycles, so the whole model is denominated in 68000 cycles. It
   * defaults to 1 because an Interp built on its own has no machine behind
   * it and nothing to convert to --- the census and the language tests count
   * statements, and should carry on counting statements.
   */
  statementCost?: number
  /**
   * What a bare TOKEN costs when it is not a statement: a `:`, a `Then`, a
   * label, a `Rem`.
   *
   * AMOS's inner loop reads a word and jumps through the token table whatever
   * the word is (`+ILib.s:505`), so a separator costs the seven instructions
   * of that loop and an immediate `rts` --- one dispatch, not a whole
   * statement. The Runtime passes `CYCLES_PER_DISPATCH`.
   *
   * Defaults to `statementCost`, which is the behaviour this replaced, so a
   * standalone Interp still counts every step as one.
   */
  dispatchCost?: number
  /**
   * The price of one token, which replaces `statementCost` when it is given.
   *
   * A statement is not a unit of work on the machine. The ChrGet loop
   * (+ILib.s:476) reads one token, indexes the token table, and jumps, so
   * `Bob N+2,METX(N),METY(N),3` costs sixteen trips through it and `Next J`
   * costs one. Charging both the same flat number is what made every
   * bob-moving loop in the corpus run an order of magnitude too fast.
   *
   * `first` is true for the token that begins the statement, which runs its
   * INSTRUCTION routine where the rest run their FUNCTION routine. The Runtime
   * passes `tokenCost` from `../runtime/cost.ts`; a standalone Interp leaves
   * this unset and carries on counting statements.
   */
  tokenCost?: (tok: Tok, first: boolean) => number
}

export interface RunResult {
  status: 'ended' | 'stopped' | 'maxSteps' | 'blocked' | 'paused'
  steps: number
  /**
   * `Prg_JError`'s d0 for the way this run finished, or 0 while it has not.
   *
   * `RunErr` (+ILib.s:1267) is one exit with a number in d0, and the numbers
   * are not all errors: `InEnd` (+ILib.s:518) is `moveq #NbEnd,d0` with
   * `NbEnd equ 10` (+Equ.s:770), `InStop` (+Lib.s:13013) is 9, and Edit,
   * Direct and System are 1000, 1001 and 1002. The editor's return path
   * branches on exactly those.
   */
  code: number
  /** instruction name → times skipped (onUnimplemented: 'skip' only) */
  unimplemented: Map<string, number>
}

/**
 * Everything Prg_DataSave (+Verif.s:4564) copies out of the a5 globals for a
 * program that is about to be pushed, plus the program itself — the state a
 * Prun'd accessory must not disturb.
 */
interface SavedProgram {
  program: Program
  pc: Addr
  frames: Frame[]
  loops: LoopFrame[]
  gosubs: Array<{ addr: Addr; loopBase: number }>
  globals: Set<string>
  dataPtr: Addr
  dataInStmt: boolean
  branchElseIf: Tok | null
  errorHandler: { kind: 'goto' | 'proc'; target: string } | null
  breakHandler: { kind: 'goto' | 'proc'; target: string } | null
  breakStops: boolean
  inError: boolean
  errStmt: Addr | null
  errNext: Addr | null
  resumeLabel: string | null
  errIsProc: boolean
  errFrameDepth: number
  every: Interp['every']
  everyReturnDepth: number
  userFns: Interp['userFns']
  stmtStart: Addr
  direct: number
  /**
   * Whether the pusher was stopped, and what it was waiting for.
   *
   * A Prun pushes mid-statement, so both are null there and this changes
   * nothing. A direct line is typed at a program that has usually stopped or
   * is blocked on a Wait, and that has to be true again when the line ends:
   * the machine goes back to the editor, not on with the program.
   */
  status: Interp['status']
  blocked: Block | null
}

const newFrame = (retAddr: Addr | null, loopBase: number, gosubBase: number): Frame => ({
  vars: new Map(),
  arrays: new Map(),
  shared: new Set(),
  params: new Set(),
  retAddr,
  loopBase,
  gosubBase,
})

/**
 * Thrown by `block(reason, rewind)` to abandon the rest of the current
 * statement. A singleton: it carries no information beyond its identity, and
 * Trap already re-throws anything that is not an AmosError, so it passes
 * through the one place that wraps a bare step().
 */
class BlockSignal extends Error {}
const BLOCK_SIGNAL = new BlockSignal('blocked')

export class Interp {
  readonly names: Names
  readonly program: Program
  readonly io: AmosIO
  pc: Addr = { li: 0, ti: 0 }
  frames: Frame[] = [newFrame(null, 0, 0)]
  loops: LoopFrame[] = []
  gosubs: Array<{ addr: Addr; loopBase: number }> = []
  globals = new Set<string>()
  /**
   * The three independent =Param slots (ParamE/ParamF/ParamC): End Proc[x]
   * writes only the slot matching x's type, leaving the others stale, so
   * =Param / =Param# / =Param$ read distinct values (FnEProc +ILib.s:2672).
   */
  paramInt = 0
  paramFloat = 0
  paramStr = ''
  /** the Else If token we branched to from a false condition, if any */
  branchElseIf: Tok | null = null
  dataPtr: Addr = { li: 0, ti: 0 }
  dataInStmt = false
  degrees = false
  /** Set Double Precision: false = single-precision FFP (the default) */
  doublePrecision = false

  /** round a float result to FFP precision unless Set Double Precision is on */
  ffp(n: number): number {
    return this.doublePrecision ? n : ffpRound(n)
  }
  // ---- error trapping (On Error / Trap / Resume) ----
  errorHandler: { kind: 'goto' | 'proc'; target: string } | null = null
  /** On Break Proc handler (InOnBreak +ILib.s:1861) */
  breakHandler: { kind: 'goto' | 'proc'; target: string } | null = null
  /**
   * `BitControl` in `ActuMask` (+Equ.s:827): does Ctrl-C STOP the program?
   *
   * True at start because `ActuMask` initialises to `%0111000100000000`
   * (+ILib.s:235), and bit 8 of that is set. `Break Off` and `On Break Proc`
   * each clear it, `Break On` sets it back.
   */
  breakStops = true
  /** the last error number caught by On Error (read by =Errn) */
  errCode = 0
  /** the last error number caught by Trap (read by =Errtrap) */
  trapCode = 0
  /** true while inside an On Error handler — a second error is fatal */
  inError = false
  errStmt: Addr | null = null
  errNext: Addr | null = null
  /**
   * Where a bare `Resume Label` will go, which `Resume Label name` records
   * rather than jumping to. This is ErrorChr's low 31 bits (+ILib.s:1928).
   */
  resumeLabel: string | null = null
  /**
   * ErrorChr bit 31: the armed handler is a PROCEDURE.
   *
   * `OnEPrc` sets it when the handler is armed (`bset #7,ErrorChr(a5)`,
   * +ILib.s:1907) and it cannot be read off `errorHandler` because the two
   * words live different lives inside a procedure. CallProc clears OnErrLine
   * (+ILib.s:2603) but only SAVES ErrorChr (+ILib.s:2587), so a handler
   * procedure sees no handler of its own while the flavour bit still stands
   * — which is what `Resume` and `Resume Label` test on the way out.
   */
  errIsProc = false
  /**
   * How many variables an Input / Line Input has already filled, against the
   * address of the statement filling them. Inn10 (+ILib.s:4970) reads a fresh
   * line per variable when the buffer runs out, and a statement that blocks
   * waiting for one re-runs from the top, so without this the variables it
   * already assigned would each eat another line.
   */
  inputProgress: { at: string; done: number } | null = null
  /** frame depth at the trapped error, so Resume can unwind a Proc handler */
  errFrameDepth = 0
  private stmtStart: Addr = { li: 0, ti: 0 }
  // default tab = 4, from the window-open defaults (Wo3a in +W.s)
  tabWidth = 4
  col = 0
  /** Rnd state (FnRnd in +Lib.s): LCG seed and the last result for Rnd(0) */
  rndSeed = 0x1234
  oldRnd = 0
  /** Fix state: digits after the point (-1 = proportional), exponent mode */
  fixDigits = -1
  fixExp = false
  /** Every n Gosub/Proc state (InEvery) */
  every: { ticks: number; kind: 'gosub' | 'proc'; target: string; nextFire: number; running: boolean; on: boolean } | null =
    null
  private everyReturnDepth = 0
  /** Def Fn definitions: name key -> params + expression address */
  userFns = new Map<string, { params: Array<{ key: string; type: number }>; body: Addr }>()
  private status: 'ended' | 'stopped' | 'maxSteps' | null = null
  unimplemented = new Map<string, number>()
  policy: 'throw' | 'skip'
  private maxSteps: number
  /** 50Hz frame counter, advanced by the runtime/driver; read by Timer */
  tick = 0
  /** when non-null, execution is paused until the driver clears it */
  blocked: Block | null = null
  /** live input devices (shared with the runtime/driver) */
  readonly inp: InputState
  private readonly instr: Record<string, InstrFn>
  private readonly funcs: Record<string, FuncFn>
  private readonly rawFuncs: Record<string, (it: Interp, tok: Tok) => Value>
  totalSteps = 0

  constructor(
    lines: TokenLine[],
    readonly table: TokenTable,
    opts: InterpOptions = {},
  ) {
    this.names = new Names(table, opts.extensions ?? new Map())
    this.program = prescan(lines, this.names)
    // the Test pass decided these, not the run: see Program.globals
    this.globals = new Set(this.program.globals)
    this.io = opts.io ?? { write: () => {} }
    this.policy = opts.onUnimplemented ?? 'throw'
    // no default cap: an interactive session runs forever, like the
    // machine did — the census/tests pass an explicit budget
    this.maxSteps = opts.maxSteps ?? Infinity
    this.instr = opts.instructions ? { ...INSTR, ...opts.instructions } : INSTR
    this.funcs = opts.functions ? { ...FUNCS, ...opts.functions } : FUNCS
    this.rawFuncs = { ...RAWFUNCS, ...opts.rawFunctions }
    this.inp = opts.input ?? newInputState()
    this.statementCost = opts.statementCost ?? 1
    this.dispatchCost = opts.dispatchCost ?? this.statementCost
    this.tokenCost = opts.tokenCost ?? null
  }

  /** what one statement costs against run()'s slice; see InterpOptions */
  readonly statementCost: number
  /** what a bare separator token costs instead; see InterpOptions */
  readonly dispatchCost: number
  /** per-token price, or null to charge a flat statement; see InterpOptions */
  private readonly tokenCost: ((tok: Tok, first: boolean) => number) | null
  /** true while costs are flat per statement, so keywords must charge their own extra */
  get tokenCostFlat(): boolean {
    return this.tokenCost === null
  }
  /** statement start -> its token cost, since a loop runs the same one often */
  private readonly stmtCostCache = new Map<number, number>()

  /**
   * What the statement beginning at (li, ti) costs, by its own tokens.
   *
   * The span runs to the next `:` or `Then`, neither of them included: each is
   * dispatched as a step of its own and charging it here as well would count
   * it twice.
   *
   * `single` is for those steps. `:`, `Then`, a label and a `Rem` dispatch one
   * token and return, which is what `dispatchOnly` already marks, and without
   * it the `:` step charged the whole rest of the line and then the statement
   * after it charged the same tokens again. `A=1 : B=2` came out 3.11 times a
   * two-line `A=1` / `B=2` when the colon is worth about 9%.
   */
  private statementCycles(li: number, ti: number, single: boolean): number {
    const key = li * 65536 + ti
    const hit = this.stmtCostCache.get(key)
    if (hit !== undefined) return hit
    const toks = this.program.lines[li]?.tokens ?? []
    let total = 0
    for (let k = ti; k < toks.length; k++) {
      const t = toks[k]!
      if (k > ti) {
        if (single) break
        const n = this.names.of(t)
        if (n === ':' || n === 'then') break
      }
      total += this.tokenCost!(t, k === ti)
    }
    const cost = Math.round(total)
    this.stmtCostCache.set(key, cost)
    return cost
  }

  /**
   * The step just taken was one token, not a statement.
   *
   * `run` charges `statementCost` unless a step says otherwise, and the four
   * that say otherwise are the ones that dispatch a token and return without
   * doing any work: `:`, `Then`, a label, and `Rem`.
   */
  private stepCost: number | null = null
  private dispatchOnly(): void {
    this.stepCost = this.dispatchCost
  }

  /**
   * Run "file" (RunII +ILib.s:1497): swap in a new program. Variables,
   * stacks, handlers and data pointers reset; the caller decides what
   * happens to screens and banks. The timer and step budget carry on.
   */
  replaceProgram(lines: TokenLine[]): void {
    ;(this as { program: Program }).program = prescan(lines, this.names)
    // statement costs are keyed by line and token index, so they belong to
    // the program that was loaded when they were computed
    this.stmtCostCache.clear()
    this.pc = { li: 0, ti: 0 }
    this.frames = [newFrame(null, 0, 0)]
    this.loops = []
    this.gosubs = []
    this.globals = new Set(this.program.globals)
    this.dataPtr = { li: 0, ti: 0 }
    this.dataInStmt = false
    this.branchElseIf = null
    this.errorHandler = null
    this.inError = false
    this.errStmt = null
    this.errNext = null
    this.resumeLabel = null
    this.errIsProc = false
    this.inputProgress = null
    this.every = null
    this.userFns = new Map()
    this.blocked = null
    this.status = null
    // These three used to be reset by pushProgram only, so `Run "file"` — which
    // calls replaceProgram directly — carried them into the new program. A
    // breakHandler is the one that bites: On Break Proc names a procedure, and
    // after Run that procedure no longer exists, so Ctrl-C jumped into nothing.
    // One list rather than two is the actual fix; pushProgram now inherits it.
    this.breakHandler = null
    this.breakStops = true
    this.errFrameDepth = 0
    this.everyReturnDepth = 0
  }

  /**
   * Execute statements until the program ends, blocks on the outside world,
   * or `slice` statements have run (status 'paused' — call run() again).
   */
  run(slice = Infinity): RunResult {
    let steps = 0
    while (this.status === null && this.blocked === null) {
      if (++this.totalSteps > this.maxSteps) {
        this.status = 'maxSteps'
        break
      }
      // `steps` is a COST, not a count. Under the Runtime the unit is 68000
      // cycles and a statement is CYCLES_PER_STATEMENT of them, so a keyword
      // that charges extra is charging cycles it really spent. Standalone the
      // unit is one statement, which is what the census counts.
      if (steps > slice) return this.result('paused', steps)
      try {
        this.dispatchEvery()
        this.step()
      } catch (e) {
        // a blocking statement unwound itself; pc is already rewound
        if (e === BLOCK_SIGNAL) break
        // `tst.w Direct(a5) / bne rErr1` (+ILib.s:1301-1302) sits with the Trap and
        // On Error Goto tests: an error in a typed line is never trapped, it
        // is reported to whoever typed it. The same instruction refuses to
        // trap errors 1000 and up, which are Edit and Direct themselves.
        // RunErr (+ILib.s:1266) opens `moveq #19,d1` and then, once the
        // closing routines have run, `cmp.w #11,d0 / beq.s .skip / cmp.w d1,d0
        // / bcs rErr1`. An error BELOW 19 cannot be diverted at all, and 11,
        // Out of variable space, is the single exception written into the
        // test. So a handler never sees Stop (9), Out of stack space (13) or
        // Illegal direct mode (17); those go straight to the report.
        const code = e instanceof AmosError ? amosErrorCode(e) : 0
        const divertible = code === 11 || code >= 19
        if (e instanceof AmosError && divertible && this.errorHandler !== null && !this.inError && this.direct === 0) {
          this.errCode = code
          this.inError = true
          this.errStmt = { li: this.stmtStart.li, ti: this.stmtStart.ti }
          this.errNext = this.afterCurrentStatement()
          const h = this.errorHandler
          // remember the frame depth so Resume can unwind an On Error Proc
          // handler (which enters as a procedure) back to here
          this.errFrameDepth = this.frames.length
          if (h.kind === 'proc') this.callProc(h.target, [], true)
          else this.jumpLabel(h.target)
          continue
        }
        if (e instanceof AmosError) {
          const li = Math.min(this.pc.li, this.program.lines.length - 1)
          const line = this.program.lines[li]
          const listing = line ? detokLine(line, this.table, { extensions: this.names.extensions }) : ''
          // `subq.l #2,a0` in rErr1: d7 is the next word to read, so the token
          // the error is about is the one before it
          const ti = Math.max(0, Math.min(this.pc.ti - 1, (line?.tokens.length ?? 1) - 1))
          throw new AmosRuntimeError(e.message, li + 1, listing, amosErrorCode(e), line?.offsets?.[ti] ?? -1)
        }
        throw e
      }
      // `stmtStart`, not the pc as it stood before step(): step() skips a
      // spent line before it begins, so the pc on the way in still points at
      // the end of the previous statement. Reading it there charged `Inc N`
      // and `Loop` nothing at all.
      steps +=
        (this.tokenCost !== null
          ? this.statementCycles(this.stmtStart.li, this.stmtStart.ti, this.stepCost !== null)
          : (this.stepCost ?? this.statementCost)) + this.pendingCharge
      this.stepCost = null
      this.pendingCharge = 0
    }
    return this.result(this.status ?? 'blocked', steps)
  }

  /** extra frame-budget cost accrued by the current statement (blitter ops) */
  private pendingCharge = 0

  /** charge n extra budget units for an expensive operation (Screen Copy,
   * big Cls) so a busy loop paces like the real blitter */
  charge(n: number): void {
    this.pendingCharge += Math.max(0, Math.floor(n))
  }

  /** fire a pending Every handler at a statement boundary */
  private dispatchEvery(): void {
    const ev = this.every
    if (ev === null || !ev.on || this.blocked !== null) return
    if (ev.running) {
      // handler finished when we are back at (or below) the entry depth
      if (this.gosubs.length <= this.everyReturnDepth && this.frames.length === 1) ev.running = false
      else return
    }
    if (this.tick < ev.nextFire) return
    ev.nextFire = this.tick + ev.ticks
    ev.running = true
    if (ev.kind === 'proc') {
      this.everyReturnDepth = this.gosubs.length
      const proc = this.program.procs.get(ev.target)
      if (!proc) throw new AmosError(`procedure not defined: ${ev.target.toUpperCase()}`)
      // return to the current statement (we are at a boundary)
      this.frames.push(newFrame({ li: this.pc.li, ti: this.pc.ti }, this.loops.length, this.gosubs.length))
      this.setPc(proc.body)
    } else {
      this.everyReturnDepth = this.gosubs.length
      this.gosubs.push({ addr: { li: this.pc.li, ti: this.pc.ti }, loopBase: this.loops.length })
      this.jumpLabel(ev.target)
    }
  }

  private result(status: RunResult['status'], steps: number): RunResult {
    return { status, steps, code: this.endCode, unimplemented: this.unimplemented }
  }

  /**
   * `RunErr`'s d0 for the way this program stopped.
   *
   * `halt` fills it in for the two plain endings and `Edit`, `Direct` and
   * `System` write their own first, because the machine tells them apart by
   * this number and by nothing else.
   */
  endCode = 0

  /**
   * `VerPos(a5)` for the same stop, or -1 when there is no offset to give.
   *
   * `RunErr` falls into `rErr1` (+ILib.s:1370), which writes `d7-2` there
   * before it leaves, so a Ctrl-C break records a position exactly as a
   * run-time error does. `Ed_Ligne` (+Edit.s:8344) names that line and
   * `Ed_ErrEdit` (:8291) puts the cursor on it.
   */
  endAt = -1

  /** `d7-2`: the source offset of the token the interpreter is sitting on */
  private stopOffset(): number {
    const line = this.program.lines[this.stmtStart.li]
    if (!line?.offsets) return -1
    const ti = Math.min(this.stmtStart.ti, line.tokens.length - 1)
    return line.offsets[Math.max(0, ti)] ?? -1
  }

  halt(status: 'ended' | 'stopped', returnToCaller = true): void {
    // `InEnd` is 10 and `InStop` is 9. A caller that set `endCode` itself --
    // Edit, Direct and System -- keeps what it wrote
    if (this.endCode === 0) this.endCode = status === 'ended' ? 10 : 9
    // `InEnd` (+ILib.s:520) is `moveq #NbEnd,d0 / bra RunErr` like every other
    // stop, and `rErr1` (:1362) writes `d7-2` into `VerPos(a5)` before it
    // leaves. So an ordinary End records a position too, and `Ed_Ligne` names
    // its line rather than line 1.
    this.endAt = this.stopOffset()
    // Prg_Pull (+Verif.s:4530). An accessory reaching the end of its program
    // does not stop the machine: the editor-return path pulls the program
    // stack, which puts back the interpreter data of whoever Prun'd it —
    // including the pc, so that program resumes after its Prun statement.
    if (status === 'ended' && returnToCaller && this.progStack.length > 0) {
      const top = this.progStack.pop()!
      // a direct line is not another PROGRAM: it never swapped the banks, so
      // there is nothing for the host to put back
      if (!top.direct) this.onProgramPop?.(top.host)
      this.restoreProgramState(top.state)
      return
    }
    this.status = status
  }

  // ---- the program stack (Prg_Push/Prg_Pull, +Verif.s:4499/4530) ----------

  private progStack: Array<{ state: SavedProgram; host: unknown; direct?: boolean }> = []

  /**
   * Unwind a typed line without running it to its end (Esc_Hide +Edit.s:9536).
   *
   * The host calls this when the line has thrown: the program underneath is
   * intact and has to be put back, including the `status` and `blocked` it
   * was left with, or an error typed at a stopped program restarts it.
   */
  exitDirect(): void {
    while (this.direct !== 0 && this.progStack.length > 0) {
      const top = this.progStack[this.progStack.length - 1]!
      if (!top.direct) break
      this.progStack.pop()
      this.restoreProgramState(top.state)
    }
  }

  /** called with the pusher's opaque state just before the pc is restored */
  onProgramPop: ((host: unknown) => void) | null = null

  /** true while a Prun'd program is running (Prg_Previous is set) */
  get nestedProgram(): boolean {
    return this.progStack.length > 0
  }

  /**
   * The state Prg_Push saved for the program underneath this one, which is
   * what `Bnk.PrevProgram` repoints Cur_Banks at.
   *
   * Direct mode uses the same stack here and is not a program, so those
   * entries are stepped over: on the 68000 a typed line runs inside the
   * program it was typed at, and Prg_Previous still names that program's
   * caller.
   */
  get previousProgramHost(): unknown {
    for (let i = this.progStack.length - 1; i >= 0; i--) {
      const e = this.progStack[i]!
      if (!e.direct) return e.host
    }
    return null
  }

  /**
   * Prg_Push: stack this program's interpreter data and start a new one.
   * Prg_DataNew then clears the new program's state, which is what
   * replaceProgram already does for Run.
   */
  pushProgram(lines: TokenLine[], host: unknown, resumeAt?: Addr): void {
    const state = this.saveProgramState()
    if (resumeAt) state.pc = resumeAt
    // replaceProgram resets breakHandler, errFrameDepth and everyReturnDepth
    this.replaceProgram(lines)
    this.progStack.push({ state, host })
  }

  /**
   * `Direct(a5)`: the editor's escape screen is up and a typed line is running.
   *
   * Set by `Esc_Appear` (+Edit.s:9362) and cleared by `Esc_Hide` (:9538). The
   * interpreter reads it in three places, all of them to NOT do something:
   * menu keyboard shortcuts are not explored (+ILib.s:972), `GoMenu` does not
   * branch to a menu handler (:1072), and an error is never trapped ---
   * neither `On Error Goto` nor `Trap` (:1330). A mistake in a typed line is
   * reported to the person who typed it.
   */
  direct = 0

  /**
   * Run one typed line against the program that is loaded (Ver_Direct
   * +Verif.s:71).
   *
   * This is `pushProgram` minus the variable reset. `frames`, `globals` and
   * `userFns` carry through untouched, which is the entire point: on the
   * machine the variable arena belongs to the interpreter rather than to a
   * program, and `ResDir` takes the direct slots out of the same `TabBas`. So
   * a typed `Print SCORE` reads the running program's SCORE, and a typed
   * `SCORE=0` writes it.
   *
   * The loops and gosubs do not carry through. A direct line is verified on
   * its own (`Phase` 1, one buffer), so a `Next` typed at a program stopped
   * inside a `For` has no loop to close and is a structure error, not a jump
   * back into the program.
   *
   * `halt` pops the state back when the line ends, the same path a Prun'd
   * program returns by.
   */
  pushDirect(lines: TokenLine[], host: unknown = null): void {
    const state = this.saveProgramState()
    ;(this as { program: Program }).program = prescan(lines, this.names)
    // statement costs are keyed by line and token index, so they belong to
    // the program that was loaded when they were computed
    this.stmtCostCache.clear()
    this.pc = { li: 0, ti: 0 }
    this.loops = []
    this.gosubs = []
    this.dataPtr = { li: 0, ti: 0 }
    this.dataInStmt = false
    this.branchElseIf = null
    this.blocked = null
    this.status = null
    this.direct = 1
    this.progStack.push({ state, host, direct: true })
  }

  private saveProgramState(): SavedProgram {
    return {
      program: this.program,
      pc: this.pc,
      frames: this.frames,
      loops: this.loops,
      gosubs: this.gosubs,
      globals: this.globals,
      dataPtr: this.dataPtr,
      dataInStmt: this.dataInStmt,
      branchElseIf: this.branchElseIf,
      errorHandler: this.errorHandler,
      breakHandler: this.breakHandler,
      breakStops: this.breakStops,
      inError: this.inError,
      errStmt: this.errStmt,
      errNext: this.errNext,
      resumeLabel: this.resumeLabel,
      errIsProc: this.errIsProc,
      errFrameDepth: this.errFrameDepth,
      every: this.every,
      everyReturnDepth: this.everyReturnDepth,
      userFns: this.userFns,
      stmtStart: this.stmtStart,
      direct: this.direct,
      status: this.status,
      blocked: this.blocked,
    }
  }

  private restoreProgramState(s: SavedProgram): void {
    ;(this as { program: Program }).program = s.program
    this.stmtCostCache.clear()
    this.pc = s.pc
    this.frames = s.frames
    this.loops = s.loops
    this.gosubs = s.gosubs
    this.globals = s.globals
    this.dataPtr = s.dataPtr
    this.dataInStmt = s.dataInStmt
    this.branchElseIf = s.branchElseIf
    this.errorHandler = s.errorHandler
    this.breakHandler = s.breakHandler
    this.breakStops = s.breakStops
    this.inError = s.inError
    this.errStmt = s.errStmt
    this.errNext = s.errNext
    this.resumeLabel = s.resumeLabel
    this.errIsProc = s.errIsProc
    this.errFrameDepth = s.errFrameDepth
    this.every = s.every
    this.everyReturnDepth = s.everyReturnDepth
    this.userFns = s.userFns
    this.stmtStart = s.stmtStart
    this.direct = s.direct
    this.blocked = s.blocked
    this.status = s.status
  }

  get done(): boolean {
    return this.status !== null
  }

  /**
   * Pause execution. With rewind, the pc returns to the start of the
   * current statement so it re-executes when unblocked (used by Input,
   * which needs its result mid-statement).
   */
  block(reason: Block, rewind = false): void {
    this.blocked = reason
    if (!rewind) return
    // Rewinding means "run this whole statement again when we resume", so the
    // rest of it must not be parsed now. Simply returning left the caller
    // reading tokens from the rewound pc: a blocking Func nested in a larger
    // expression — `_INFO_LOAD_[Fsel$(""),5]` — sent parseProcArgs back to the
    // start of the statement and it failed with `expected "]"`. Throwing
    // unwinds however deep the nesting goes.
    this.pc = { li: this.stmtStart.li, ti: this.stmtStart.ti }
    throw BLOCK_SIGNAL
  }

  // ---- cursor over the token stream -------------------------------------

  tok(): Tok | undefined {
    return this.program.lines[this.pc.li]?.tokens[this.pc.ti]
  }

  /** dispatch name of the current token (core/ext only) */
  nm(): string | undefined {
    const t = this.tok()
    return t === undefined ? undefined : this.names.of(t)
  }

  advance(): void {
    this.pc.ti++
  }

  /** if the current token is the named core token, consume it */
  accept(name: string): boolean {
    if (this.nm() === name) {
      this.advance()
      return true
    }
    return false
  }

  expect(name: string): void {
    if (!this.accept(name)) throw new AmosError(`expected "${name.toUpperCase()}"`)
  }

  /** if the current token is the given operator, consume it */
  acceptOp(op: string): boolean {
    const t = this.tok()
    if (t?.kind === 'op' && t.op.trim() === op) {
      this.advance()
      return true
    }
    return false
  }

  expectOp(op: string): void {
    if (!this.acceptOp(op)) throw new AmosError(`expected "${op}"`)
  }

  atStmtEnd(): boolean {
    const t = this.tok()
    if (t === undefined) return true
    const n = this.names.of(t)
    return n === ':' || n === 'else' || n === 'else if'
  }

  setPc(a: Addr): void {
    if (a.li < 0) throw new AmosError('internal: unresolved branch target')
    this.pc = { li: a.li, ti: a.ti }
  }

  /** address of the statement after the current one */
  afterCurrentStatement(): Addr {
    const toks = this.program.lines[this.pc.li]?.tokens ?? []
    for (let k = this.pc.ti; k < toks.length; k++) {
      if (this.names.of(toks[k]!) === ':') return { li: this.pc.li, ti: k + 1 }
    }
    return { li: this.pc.li + 1, ti: 0 }
  }

  skipToStmtEnd(): void {
    while (!this.atStmtEnd()) this.advance()
  }

  ctrlOf(tok: Tok): Ctrl {
    const c = this.program.ctrl.get(tok)
    if (!c) throw new AmosError('internal: missing control info')
    return c
  }

  unimpl(name: string): void {
    if (this.policy === 'throw') throw new AmosError(`unimplemented: ${name}`)
    this.unimplemented.set(name, (this.unimplemented.get(name) ?? 0) + 1)
    this.skipToStmtEnd()
  }

  // ---- output ------------------------------------------------------------

  write(text: string): void {
    this.io.write(text)
    const nl = text.lastIndexOf('\n')
    if (nl >= 0) this.col = text.length - nl - 1
    else this.col += text.length
  }

  // ---- variables ---------------------------------------------------------

  private frameFor(key: string, arrays: boolean): Frame {
    const top = this.frames[this.frames.length - 1]!
    if (this.frames.length === 1) return top
    // A Global name is global EVERYWHERE, including where a procedure takes
    // it as a parameter — binding the parameter assigns to the global slot
    // rather than making a local. That is not a guess: the parameter loop at
    // +ILib.s:2570 evaluates the argument, reads the parameter's own slot
    // offset and branches on its sign, and InPaGlo ("Si variable globale",
    // 2651) stores into VarGlo, the global table, instead of the frame it
    // just built.
    //
    // Viking-saxon tester is the program that needs it: WRITE takes TXT$ as
    // a parameter, HANDLE reads TXT$ and writes A$ with no declaration of
    // its own, and the big-letter routine only works if all three are the
    // same variables. eggit's _BOX -> X_BOX chain works either way, so the
    // rule was previously set from it by assumption.
    const k = arrays ? key + '()' : key
    if (top.shared.has(k) || this.globals.has(k)) return this.frames[0]!
    if (!arrays && top.params.has(key)) return top
    // arrays Dim'd at top level are visible only if declared Global/Shared;
    // otherwise a procedure sees its own
    return top
  }

  getVar(key: string, t: VarType): Value {
    const f = this.frameFor(key, false)
    return f.vars.get(key) ?? defaultValue(t)
  }

  setVar(key: string, t: VarType, v: Value): void {
    this.frameFor(key, false).vars.set(key, coerce(t, v))
  }

  /** parse "A(0)" style array references (Sort/Match) */
  parseArrayRef(): AmosArray {
    const t = this.tok()
    if (t?.kind !== 'var') throw new AmosError('array expected')
    this.advance()
    const key = varKey(t.name, t.flags)
    this.expect('(')
    while (!this.accept(')')) this.advance() // index ignored — whole array
    return this.getArray(key)
  }

  getArray(key: string): AmosArray {
    const arr = this.frameFor(key, true).arrays.get(key)
    if (!arr) throw new AmosError(`array not dimensioned: ${key.toUpperCase()}`)
    return arr
  }

  dimArray(key: string, t: VarType, dims: number[]): void {
    const f = this.frameFor(key, true)
    if (f.arrays.has(key)) throw new AmosError('array already dimensioned') // AlrDim
    let size = 1
    const counts = dims.map((d, i) => {
      if (d < 0 || d >= 0xffff) funcCall() // InDim limits
      size *= d + 1
      if (i < dims.length - 1 && size >= 0x10000) funcCall()
      return d + 1
    })
    f.arrays.set(key, { type: t, dims: counts, data: new Array<Value>(size).fill(defaultValue(t)) })
  }

  arrayIndex(arr: AmosArray, key: string, idx: number[]): number {
    if (idx.length !== arr.dims.length) throw new AmosError(`wrong number of indices for ${key.toUpperCase()}`)
    let linear = 0
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i]!
      if (v < 0 || v >= arr.dims[i]!) throw new AmosError(`array index out of range: ${key.toUpperCase()}`)
      linear = linear * arr.dims[i]! + v
    }
    return linear
  }

  /** Parse a variable or array-element reference at the cursor. */
  parseTarget(): Target {
    const t = this.tok()
    if (t?.kind !== 'var') throw new AmosError('variable expected')
    this.advance()
    const type = varType(t.flags)
    const key = varKey(t.name, t.flags)
    if (this.nm() === '(') {
      this.advance()
      const idx: number[] = []
      for (;;) {
        idx.push(int(this.evalExpr()))
        if (this.accept(',')) continue
        this.expect(')')
        break
      }
      const arr = this.getArray(key)
      const linear = this.arrayIndex(arr, key, idx)
      return {
        type,
        key: `${key}[${linear}]`,
        get: () => arr.data[linear]!,
        set: (v) => {
          arr.data[linear] = coerce(type, v)
        },
        array: arr,
        index: linear,
      }
    }
    return {
      type,
      key,
      get: () => this.getVar(key, type),
      set: (v) => this.setVar(key, type, v),
    }
  }

  // ---- expressions -------------------------------------------------------

  evalExpr(): Value {
    return this.parseExpr(0)
  }

  evalNum(): number {
    return num(this.evalExpr())
  }

  evalInt(): number {
    return int(this.evalExpr())
  }

  evalStr(): string {
    return str(this.evalExpr())
  }

  /**
   * Faithful port of New_Evalue (+ILib.s): a shift-reduce evaluator whose
   * "precedence" is the operator's token id compared unsigned — later
   * entries in the editor's operator table bind tighter. The ladder is
   *   xor < or < and < <> < >< < <= < =< < >= < => < = < < < > <
   *   + < - < mod < * < / < ^
   * with a strict > shift test, so even same-family operators nest:
   * 10*3/4 evaluates as 10*(3/4).
   */
  private parseExpr(minPrec: number): Value {
    let left = this.parseOperand()
    for (;;) {
      const t = this.tok()
      if (t?.kind !== 'op') return left
      if (t.id <= minPrec) return left
      this.advance()
      const right = this.parseExpr(t.id)
      left = binOp(t.op.trim(), left, right, this.doublePrecision)
    }
  }

  private parseOperand(): Value {
    // any operator token in operand position toggles the sign (OpeM):
    // "-5" negates, and so does the odd-but-real "--5" / "+5" behaviour
    let negations = 0
    while (this.tok()?.kind === 'op') {
      negations++
      this.advance()
    }
    let v: Value
    if (this.nm() === 'not') {
      // FnNot calls New_Evalue afresh: Not consumes the whole rest of
      // the expression (Not A=1 or B=2 is Not(A=1 or B=2))
      KEYWORD_PROBE?.add('not') // parsed as a prefix operator, so probed here
      this.advance()
      v = VI(~int(this.parseExpr(0)))
    } else {
      v = this.parseAtom()
    }
    if (negations % 2 === 1) {
      if (v.k === 'int') v = VI(-v.n)
      else if (v.k === 'float') v = { k: 'float', n: -v.n }
      else throw new AmosError('Type mismatch')
    }
    return v
  }

  private parseAtom(): Value {
    const t = this.tok()
    if (t === undefined) throw new AmosError('expression expected')
    switch (t.kind) {
      case 'int':
      case 'hex':
      case 'bin':
        this.advance()
        return VI(t.value)
      case 'float':
        this.advance()
        return { k: 'float', n: this.ffp(t.value) } // a float literal is stored at FFP precision
      case 'str':
        this.advance()
        return { k: 'str', s: t.value }
      case 'var': {
        const target = this.parseTarget()
        return target.get()
      }
      case 'core':
      case 'ext': {
        const name = this.names.of(t)
        if (name === '(') {
          this.advance()
          const v = this.evalExpr()
          this.expect(')')
          return v
        }
        if (name === 'fn') {
          KEYWORD_PROBE?.add(name) // intercepted before the dispatch tables
          this.advance()
          return this.callUserFn()
        }
        if (name !== undefined && this.rawFuncs[name]) {
          KEYWORD_PROBE?.add(name)
          this.advance()
          // the token goes through as well: the four equate spellings read
          // the value the Test pass poked into their own inline bytes
          return this.rawFuncs[name]!(this, t)
        }
        if (name !== undefined) {
          const qual = this.names.qualified(t)
          const fn = (qual === undefined ? undefined : this.funcs[qual]) ?? this.funcs[name]
          if (fn !== undefined) {
            KEYWORD_PROBE?.add(name)
            this.advance()
            const args: Value[] = []
            if (this.accept('(')) {
              if (!this.accept(')')) {
                for (;;) {
                  // elided argument, e.g. At(,10) — "keep current". The
                  // sentinel is EntNul because -1 is a value some functions
                  // take: Cmove$(-1,0) moves one column left.
                  if (this.nm() === ',' || this.nm() === ')') args.push(VI(ENT_NUL))
                  else args.push(this.evalExpr())
                  // 'To' separates range arguments in the token specs
                  // ("0,0T0"): Bob Col(1,2 To 5), Sprite Col, Range()...
                  if (this.accept(',') || this.accept('to')) continue
                  this.expect(')')
                  break
                }
              }
            }
            return fn(this, args)
          }
          if (this.policy === 'skip') {
            // skip mode: consume the arguments without evaluating (some
            // unknown functions have exotic syntax, e.g. "1 To 10") and
            // yield a typed default so the coverage census can see past
            this.advance()
            if (this.accept('(')) {
              let depth = 1
              while (depth > 0) {
                const n = this.nm()
                if (this.tok() === undefined) break
                if (n === '(') depth++
                else if (n === ')') depth--
                this.advance()
              }
            }
            this.unimplemented.set(name, (this.unimplemented.get(name) ?? 0) + 1)
            // return a type-correct default: extension functions often
            // return strings without a "$" name (Ldate, Lsys Time), so the
            // spec's return-type code (first char, 2=string) is authoritative
            const ret = this.names.specOf(t)?.[0]
            const str = ret === '2' || (ret === undefined && name.endsWith('$'))
            return str ? { k: 'str', s: '' } : VI(0)
          }
        }
        throw new AmosError(`unimplemented function: ${name ?? '?'}`)
      }
      default:
        throw new AmosError('expression expected')
    }
  }

  // ---- procedures --------------------------------------------------------

  parseProcArgs(): Value[] {
    const args: Value[] = []
    if (this.accept('[')) {
      if (!this.accept(']')) {
        for (;;) {
          args.push(this.evalExpr())
          if (this.accept(',')) continue
          this.expect(']')
          break
        }
      }
    }
    return args
  }

  /**
   * A Ctrl-C break from the host.
   *
   * The interrupt sets `BitControl` in `T_Actualise` (+W.s:12886) and the
   * per-statement test at `Tst00` (+ILib.s:961) decides what it means. The
   * ENABLE bit is consulted first, not the handler:
   *
   *     btst #BitControl,d4      * d4 is ActuMask -- break autorise?
   *     beq.s Tst01              * clear: go to the handler instead
   *     move.w d3,T_Actualise(a5)
   *     moveq #9,d0 / bra RunErr * set: stop, "Program interrupted"
   *
   * so `Break Off` with no handler swallows Ctrl-C entirely. Both handlers
   * were empty here, which made `Break Off` a no-op and left a program that
   * had asked not to be interrupted interruptible.
   */
  requestBreak(): void {
    if (this.status !== null) return
    if (this.breakStops) {
      // DEVIATION: the original stops by RAISING error 9, "Program
      // interrupted" (`moveq #9,d0 / bra RunErr`), so a program with `On Error
      // Goto` in force catches Ctrl-C and can carry on. This stops the
      // interpreter outright, which no handler can see.
      //
      // `moveq #9,d0` is the half that is NOT a deviation, and skipping it
      // left `endCode` at 0. `Ed_GetError` (+Edit.s:8323) reads a zero out of
      // the TEST table at index -1, so the requester came up as " at line 1."
      // with no message in it at all.
      this.endCode = 9
      this.endAt = this.stopOffset()
      this.status = 'stopped'
      return
    }
    const h = this.breakHandler
    if (!h) return // Break Off and nothing to run: the key does nothing
    this.blocked = null
    if (h.kind === 'proc') this.callProc(h.target, [])
    else this.jumpLabel(h.target)
  }

  callProc(name: string, args: Value[], errorEntry = false): void {
    const proc = this.program.procs.get(name)
    if (!proc) throw new AmosError(`procedure not defined: ${name.toUpperCase()}`)
    // Its body was never in the token stream to begin with — see ProcInfo.
    // Refusing the call is the honest answer: falling through to End Proc
    // would return normally from a procedure that did none of its work.
    if (proc.protectedBody) {
      throw new AmosError(`${name.toUpperCase()} is a protected procedure (${proc.protectedBody})`)
    }
    if (args.length !== proc.params.length) {
      throw new AmosError(`wrong number of parameters for ${name.toUpperCase()}`)
    }
    const frame = newFrame(this.afterCurrentStatement(), this.loops.length, this.gosubs.length)
    // Its own phase has already been verified, so every Shared in the body
    // is in force from the first statement -- including one written under
    // the assignment it is meant to cover.
    const shared = this.program.procShared.get(name)
    if (shared) for (const k of shared) frame.shared.add(k)
    for (let i = 0; i < args.length; i++) {
      const p = proc.params[i]!
      const v = coerce(p.type, args[i]!)
      // Where the argument lands is decided by the parameter's own slot, not
      // by the fact that it is a parameter: +ILib.s:2570 reads the offset and
      // branches on its sign, and InPaGlo (2651) stores into VarGlo. So a
      // parameter whose name was declared Global writes the GLOBAL, and the
      // binding has to agree with what a later read of that name resolves to
      // — binding one place and reading another is what made eggit's message
      // boxes come out empty in the first place.
      if (this.globals.has(p.key)) this.frames[0]!.vars.set(p.key, v)
      else frame.vars.set(p.key, v)
      frame.params.add(p.key)
    }
    // procedures get their own data pointer, starting at their first Data
    frame.savedDataPtr = this.dataPtr
    frame.savedDataInStmt = this.dataInStmt
    this.dataPtr = { li: proc.body.li, ti: proc.body.ti }
    this.dataInStmt = false
    // and they do not inherit the caller's error trapping — see Frame.
    // `errorEntry` is the .rErr0 door (+ILib.s:1330): it pushes the LIVE
    // ErrorOn rather than the 0 RInPro pushes, so the handler procedure runs
    // with the error still open while every ordinary call does not.
    frame.savedErrorHandler = this.errorHandler
    frame.savedInError = errorEntry ? false : this.inError
    frame.savedErrIsProc = this.errIsProc
    frame.savedResumeLabel = this.resumeLabel
    this.errorHandler = null
    if (!errorEntry) this.inError = false
    this.frames.push(frame)
    this.setPc(proc.body)
  }

  /**
   * Resume from an error handler: an On Error Proc handler entered as a
   * procedure frame, so pop back to the depth captured at the error (the
   * original's Resume does PopP, InResume ResP +ILib.s:1969).
   */
  unwindErrorHandler(): void {
    while (this.frames.length > this.errFrameDepth && this.frames.length > 1) {
      const frame = this.frames.pop()!
      this.loops.length = frame.loopBase
      this.gosubs.length = frame.gosubBase
      // PopP restores the same three words End Proc does, so the handler the
      // caller had armed is live again after Resume
      if (frame.savedErrorHandler !== undefined) this.errorHandler = frame.savedErrorHandler
      if (frame.savedInError !== undefined) this.inError = frame.savedInError
      if (frame.savedErrIsProc !== undefined) this.errIsProc = frame.savedErrIsProc
      if (frame.savedResumeLabel !== undefined) this.resumeLabel = frame.savedResumeLabel
    }
  }

  returnFromProc(): void {
    if (this.frames.length <= 1) throw new AmosError('End Proc without Procedure call')
    const frame = this.frames.pop()!
    this.loops.length = frame.loopBase
    this.gosubs.length = frame.gosubBase
    if (frame.savedDataPtr) {
      this.dataPtr = frame.savedDataPtr
      this.dataInStmt = frame.savedDataInStmt ?? false
    }
    if (frame.savedErrorHandler !== undefined) this.errorHandler = frame.savedErrorHandler
    if (frame.savedInError !== undefined) this.inError = frame.savedInError
    if (frame.savedErrIsProc !== undefined) this.errIsProc = frame.savedErrIsProc
    if (frame.savedResumeLabel !== undefined) this.resumeLabel = frame.savedResumeLabel
    this.setPc(frame.retAddr!)
  }

  // ---- flow helpers ------------------------------------------------------

  /**
   * Where a label name points FROM HERE.
   *
   * `Get_Label` (+Verif.s:3462) matches on the procedure serial as well as
   * the name, so the one written in this procedure wins over any other of
   * the same name. The flat map is the fallback rather than an error,
   * because a strict miss is a compile-time refusal in AMOS and this port
   * would rather run the program.
   */
  labelAddr(name: string): Addr | undefined {
    const key = name.toLowerCase()
    // no name is used twice, so the flat map already answers and the scope
    // walk is pure cost — this is the case for nearly every program
    if (this.program.scopedLabels.size === this.program.labels.size) return this.program.labels.get(key)
    const scope = scopeOfAddr(this.program, this.pc)
    return this.program.scopedLabels.get(`${scope ?? ''}\u0000${key}`) ?? this.program.labels.get(key)
  }

  /**
   * Jump to a label. Only Goto-style jumps unwind loop frames whose body
   * range does not contain the target (LGoto) — Gosub does not.
   */
  jumpLabel(name: string, unwind = false): void {
    const a = this.labelAddr(name)
    if (!a) throw new AmosError(`label not defined: ${name.toUpperCase()}`)
    if (unwind) {
      // the unwind floor is the deeper of the current procedure frame and
      // the most recent Gosub (BasA3, updated by both): a Goto never pops
      // loop frames opened before the enclosing Gosub/Proc
      const frame = this.frames[this.frames.length - 1]!
      const topGosub = this.gosubs[this.gosubs.length - 1]
      const floor = topGosub ? Math.max(frame.loopBase, topGosub.loopBase) : frame.loopBase
      while (this.loops.length > floor) {
        const top = this.loops[this.loops.length - 1]!
        const geBody = a.li > top.body.li || (a.li === top.body.li && a.ti >= top.body.ti)
        const ltEnd = top.end.li < 0 || a.li < top.end.li || (a.li === top.end.li && a.ti < top.end.ti)
        if (geBody && ltEnd) break
        this.loops.pop()
      }
    }
    this.setPc(a)
  }

  /** Parse a Goto/Gosub/Restore target and return the label name. */
  /**
   * The name token that follows a keyword which takes one outright, with no
   * expression fallback — `On Error Proc` is the case (OnEPrc +ILib.s:1900).
   * Every flavour of name token is accepted because the original does not
   * check: it steps over the keyword and reads the label-table offset from
   * whatever word comes next. Saved files carry a procedure name here as a
   * plain variable token, not as _TkPro.
   */
  parseNameToken(): string {
    const t = this.tok()
    if (t?.kind === 'var' || t?.kind === 'label' || t?.kind === 'labelRef' || t?.kind === 'procCall') {
      this.advance()
      return t.name
    }
    return this.parseLabelTarget()
  }

  parseLabelTarget(): string {
    const t = this.tok()
    if (t?.kind === 'labelRef' || t?.kind === 'label' || t?.kind === 'procCall') {
      this.advance()
      return t.name
    }
    // GetLabel (+ILib.s:2860) resolves only _TkLGo and _TkPro tokens by
    // name; anything else is "une expression", evaluated, with a string used
    // as-is and an integer rendered to digits. A variable token is therefore
    // normally an expression.
    //
    // The exception is a program saved without the editor's Test pass, which
    // stores its label targets as plain variable tokens. That fallback must
    // not swallow a real variable, and a type suffix settles it because an
    // AMOS label never has one — the name field holds "a" for both A and A$,
    // with the $ carried in the flags. Viking-saxon tester draws its big
    // letters with `Restore A$` against Data blocks labelled A: B: C:, and
    // matching on the bare name made every character in the game restore to
    // A: and draw an A.
    if (t?.kind === 'var' && varType(t.flags) === 0 && this.program.labels.has(t.name.toLowerCase())) {
      this.advance()
      return t.name
    }
    const v = this.evalExpr()
    return v.k === 'str' ? v.s : String(int(v))
  }

  // ---- data --------------------------------------------------------------

  readDataItem(targetType: VarType = 0): Value {
    const saved = this.pc
    const scope = this.dataScope()
    this.pc = { li: this.dataPtr.li, ti: this.dataPtr.ti }
    try {
      if (!this.dataInStmt) this.seekData(scope)
      // empty items (Data 1,,3) default by the target's type (InRdV)
      let v: Value
      if (this.tok() === undefined || this.nm() === ',' || this.nm() === ':') {
        v = targetType === 2 ? { k: 'str', s: '' } : VI(0)
      } else {
        v = this.evalExpr()
      }
      this.dataInStmt = this.accept(',')
      this.dataPtr = { li: this.pc.li, ti: this.pc.ti }
      return v
    } finally {
      this.pc = saved
    }
  }

  /** Data is procedure-scoped (InRead skips proc bodies, stops at End Proc). */
  private dataScope(): string | null {
    return this.frames.length > 1 ? scopeOfAddr(this.program, this.pc) : null
  }

  private seekData(scope: string | null): void {
    for (const a of this.program.dataToks) {
      if (a.li < this.dataPtr.li || (a.li === this.dataPtr.li && a.ti < this.dataPtr.ti)) continue
      if (scopeOfAddr(this.program, a) !== scope) continue
      this.pc = { li: a.li, ti: a.ti + 1 }
      this.dataInStmt = true
      return
    }
    throw new AmosError('out of data')
  }

  /** Fn NAME(args): evaluate a Def Fn expression with bound parameters. */
  private callUserFn(): Value {
    const t = this.tok()
    if (t === undefined || !('name' in t)) throw new AmosError('function name expected')
    this.advance()
    const def = this.userFns.get(varKey(t.name, 'flags' in t ? t.flags : 0))
    // FnNDef (+ILib.s:4265) is `moveq #15,d0`, and 15 is its own message
    if (!def) throw new AmosError(`Fn ${t.name.toUpperCase()} not defined`, 15)
    const args: Value[] = []
    if (this.accept('(')) {
      if (!this.accept(')')) {
        for (;;) {
          args.push(this.evalExpr())
          if (this.accept(',')) continue
          this.expect(')')
          break
        }
      }
    }
    // FnIlNb (+ILib.s:4263) is `moveq #16,d0` — FnFn reaches it from three
    // places, a `(` the definition did not have, a comma count that runs out
    // early, and a missing `)` or `=` in the stored definition
    if (args.length !== def.params.length) throw new AmosError('wrong number of arguments', 16)
    // FnFn assigns parameters straight into the real variables via
    // FindVar — they keep their new values after the call
    def.params.forEach((prm, i) => {
      this.setVar(prm.key, prm.type as VarType, args[i]!)
    })
    const savedPc = this.pc
    this.pc = { li: def.body.li, ti: def.body.ti }
    try {
      return this.evalExpr()
    } finally {
      this.pc = savedPc
    }
  }

  restoreData(addr: Addr): void {
    this.dataPtr = { li: addr.li, ti: addr.ti }
    this.dataInStmt = false
  }

  /**
   * Is a Data statement AT this address? `Restore label` asks it, as
   * `cmp.w #_TkData,(a0)+` (+ILib.s:4718).
   *
   * A label address is the token after the label, so an address past the end
   * of its line is a label that stood alone. `V1_StockLabel` resolved that
   * when it stored the label, walking on to the next line (+Verif.s:3435), and
   * an empty line does not stop the walk any more than an empty tail does.
   */
  dataAt(addr: Addr): boolean {
    let { li, ti } = addr
    while (li < this.program.lines.length && ti >= (this.program.lines[li]?.tokens.length ?? 0)) {
      li++
      ti = 0
    }
    return this.program.dataToks.some((d) => d.li === li && d.ti === ti)
  }

  // ---- random ------------------------------------------------------------

  seedRandom(seed: number): void {
    this.rndSeed = seed >>> 0
  }

  /**
   * =Rnd, ported from FnRnd in +Lib.s: Rnd(0) returns the previous result;
   * otherwise draw (seed*$BB40E62D+1)>>8 under the smallest 2^k-1 mask
   * covering |n| and retry until <= |n|. (The original mixes in the raster
   * beam position for n>0; we stay deterministic.)
   */
  /**
   * A deterministic pseudo raster beam, paced by executed statements
   * (~64 per scanline, 313 lines a frame). Feeds Rnd's VHPOSR mixing and
   * the $DFF004/$DFF006 beam-register reads — deterministic on purpose,
   * so runs reproduce, unlike the free-running hardware beam.
   */
  beamLine(): number {
    return Math.floor(this.totalSteps / 64) % 313
  }

  /** VHPOSR: vertical low byte in the high byte, horizontal in the low */
  beamWord(): number {
    return ((this.beamLine() & 0xff) << 8) | ((this.totalSteps * 29) & 0xff)
  }

  rndInt(n: number): number {
    // FnRnd (+Lib.s:1947): Rnd(0) = the last result; a NEGATIVE argument
    // masks out the VHPOSR term (and.w d2 with d2=0) — Rnd(-n) is the
    // pure generator, Rnd(n) word-adds the beam into the low 16 bits
    if (n === 0) return this.oldRnd
    const beamed = n > 0
    const limit = Math.abs(n)
    let mask = 0xffffff
    while (mask >>> 1 >= limit) mask >>>= 1
    for (;;) {
      this.rndSeed = (Math.imul(this.rndSeed, 0xbb40e62d) + 1) >>> 0
      const r = this.rndSeed >>> 8
      const lo = beamed ? (r + this.beamWord()) & 0xffff : r & 0xffff
      const v = ((r & 0xff0000) | lo) & mask
      if (v <= limit) {
        this.oldRnd = v
        return v
      }
    }
  }

  /** Print/Str$ float display honouring Fix (InFix in +Lib.s). */
  formatValue(v: Value): string {
    if (v.k !== 'float') return display(v)
    const sign = v.n < 0 ? '' : ' '
    if (this.fixExp) return sign + v.n.toExponential(this.fixDigits < 0 ? 6 : this.fixDigits).toUpperCase()
    if (this.fixDigits >= 0) return sign + v.n.toFixed(this.fixDigits)
    return display(v)
  }

  // ---- the statement dispatcher -----------------------------------------

  /** Execute one statement. Public so Trap can wrap a single statement. */
  step(): void {
    // roll over line ends
    while (this.pc.li < this.program.lines.length && this.pc.ti >= this.program.lines[this.pc.li]!.tokens.length) {
      this.pc = { li: this.pc.li + 1, ti: 0 }
    }
    if (this.pc.li >= this.program.lines.length) {
      this.halt('ended')
      return
    }
    this.stmtStart = { li: this.pc.li, ti: this.pc.ti }
    const tok = this.tok()!
    const tokAddr: Addr = { li: this.pc.li, ti: this.pc.ti }

    switch (tok.kind) {
      case 'label':
        this.dispatchOnly()
        this.advance()
        return
      case 'rem':
        // the Rem token's routine skips to the end of the line: one dispatch,
        // however long the comment is
        this.dispatchOnly()
        this.pc = { li: this.pc.li + 1, ti: 0 }
        return
      case 'var': {
        // programs saved without the editor's Test pass store procedure
        // calls as plain variable tokens — a bare name (no "=", no array
        // subscript) naming a known procedure is a call
        const next = this.program.lines[this.pc.li]!.tokens[this.pc.ti + 1]
        const nextName = next === undefined ? undefined : this.names.of(next)
        const isAssign = (next?.kind === 'op' && next.op.trim() === '=') || nextName === '('
        if (!isAssign && (nextName === '[' || this.program.procs.has(tok.name.toLowerCase()))) {
          this.advance()
          this.callProc(tok.name.toLowerCase(), this.parseProcArgs())
          return
        }
        const target = this.parseTarget()
        this.expectOp('=')
        target.set(this.evalExpr())
        this.endStatement()
        return
      }
      case 'procCall': {
        this.advance()
        this.callProc(tok.name.toLowerCase(), this.parseProcArgs())
        return
      }
      case 'proc': {
        // reached in normal flow: skip over the procedure body
        const c = this.program.ctrl.get(tok)
        if (c?.kind === 'proc') this.setPc(c.skip)
        else this.pc = { li: this.pc.li + 1, ti: 0 }
        return
      }
      case 'apml':
        // machine-code procedure body — can't run 68k code (yet?)
        this.unimpl('machine code procedure')
        if (this.policy === 'skip' && this.frames.length > 1) {
          this.returnFromProc()
        } else {
          this.pc = { li: this.pc.li + 1, ti: 0 }
        }
        return
      case 'labelRef':
        // e.g. "Then LABEL" — an implicit Goto
        this.advance()
        this.jumpLabel(tok.name, true)
        return
      case 'int':
        this.advance()
        this.jumpLabel(String(tok.value), true)
        return
      case 'core':
      case 'ext': {
        const name = this.names.of(tok)
        if (name === ':' || name === 'then') {
          // a separator, not a statement. `A=1 : B=2` used to cost three
          // statements where the machine spends two plus a dispatch, and
          // AMOS programmers wrote colons everywhere.
          this.dispatchOnly()
          this.advance()
          return
        }
        // a slot-qualified handler wins over the plain name: see Names.qualified
        const qual = this.names.qualified(tok)
        const handler = (qual === undefined ? undefined : this.instr[qual]) ?? (name === undefined ? undefined : this.instr[name])
        if (handler) {
          KEYWORD_PROBE?.add(name!)
          this.advance()
          // handlers that move the pc return 'jumped' and skip the
          // statement-boundary check (the new pc is a statement start)
          if (handler(this, tok, tokAddr) !== 'jumped') this.endStatement()
          return
        }
        this.unimpl(name ?? `token $${'id' in tok ? tok.id.toString(16) : '?'}`)
        return
      }
      default:
        this.unimpl(`statement starting with ${tok.kind}`)
        return
    }
  }

  /** After an instruction: we must be at a statement boundary. */
  private endStatement(): void {
    // a blocking function that rewound the pc (Dialog Run, Fsel$) leaves it
    // at the statement start on purpose — the statement re-executes later
    if (this.blocked !== null) return
    if (this.atStmtEnd()) return
    if (this.policy === 'skip') {
      this.skipToStmtEnd()
      return
    }
    throw new AmosError('syntax error (unexpected tokens at end of statement)')
  }
}

// ---- operators -----------------------------------------------------------

function binOp(op: string, a: Value, b: Value, double = false): Value {
  // FFP-round every float result (mathffp does the op at 24-bit precision)
  const flt = (n: number): Value => ({ k: 'float', n: double ? n : ffpRound(n) })
  if (a.k === 'str' || b.k === 'str') {
    const x = str(a)
    const y = str(b)
    switch (op) {
      case '+':
        return { k: 'str', s: x + y }
      case '-':
        // AMOS string subtraction: remove occurrences of y from x
        return { k: 'str', s: y === '' ? x : x.split(y).join('') }
      case '=':
        return VI(x === y ? -1 : 0)
      case '<>':
      case '><':
        return VI(x !== y ? -1 : 0)
      case '<':
        return VI(x < y ? -1 : 0)
      case '>':
        return VI(x > y ? -1 : 0)
      case '<=':
      case '=<':
        return VI(x <= y ? -1 : 0)
      case '>=':
      case '=>':
        return VI(x >= y ? -1 : 0)
      default:
        throw new AmosError('Type mismatch')
    }
  }
  const bothInt = a.k === 'int' && b.k === 'int'
  const x = a.n
  const y = b.n
  const int32 = (n: number): number => {
    // integer + and - raise Overflow (bvs in Op_Plus/Op_Moins)
    if (n < -0x80000000 || n > 0x7fffffff) throw new AmosError('Overflow')
    return n | 0
  }
  switch (op) {
    case '+':
      return bothInt ? VI(int32(x + y)) : flt(x + y)
    case '-':
      return bothInt ? VI(int32(x - y)) : flt(x - y)
    case '*': {
      if (!bothInt) return flt(x * y)
      // Op_Mult: when both magnitudes fit 16 bits the original uses a
      // single mulu with NO overflow check — the product silently wraps
      // (50000*50000 is -1794967296 on a real Amiga). Larger operands
      // take the checked slow path and raise Overflow.
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      const neg = x < 0 !== y < 0
      if (ax < 0x10000 && ay < 0x10000) {
        const m = (ax * ay) >>> 0
        return VI(neg ? -m | 0 : m | 0)
      }
      const exact = ax * ay
      if (exact > 0x7fffffff + (neg ? 1 : 0)) throw new AmosError('Overflow')
      return VI(neg ? -exact | 0 : exact | 0)
    }
    case '/':
      if (y === 0) throw new AmosError('division by zero')
      return bothInt ? VI(Math.trunc(x / y)) : flt(x / y)
    case 'mod': {
      // QuEntier: floats truncate to int. Op_Modulo treats the left
      // operand as UNSIGNED 32-bit, |right|, no zero check (mod 0
      // returns the left operand), result never negative.
      const li = Math.trunc(x) | 0
      const ri = Math.abs(Math.trunc(y) | 0)
      if (ri === 0) return VI(li)
      return VI((li >>> 0) % ri | 0)
    }
    case '^':
      /*
       * Op_Puis (+ILib.s:3418) is `bsr QueFloat` then Math_Operation with
       * _LVOSPPow, so `^` is mathtrans.library's SPPow and nothing else.
       *
       * SPPow's body is sixteen bytes and it throws the sign away:
       *
       *     tst.b   d7            the base
       *     bpl.b   .pow
       *     andi.b  #$7f,d7       negative: clear the sign bit
       *     bsr.b   .pow          ... and raise the MAGNITUDE
       *     ori.b   #$2,ccr       set V, and that is the whole complaint
       *     rts
       *     .pow jsr SPLog / jsr SPMul / jmp SPExp
       *
       * so `(-2)^3` is 8, not -8, and `(-9)^0.333` is 2.08 rather than an
       * error. SPLog does the same thing at its own entry. Both the 33.8
       * library on APD002 and the one shipped with MeXx carry those bytes.
       *
       * The V bit reaches nobody: Math_Operation (+ILib.s:7490) is `jsr
       * 0(a6,d2.w)` followed by `Ret_Float`, with no test of the condition
       * codes, so `^` cannot raise an error at all. This port threw Overflow
       * for a negative base with a fractional exponent, which is why jdlib's
       * `_RootPower` demo stopped on `(-9)^0.333` — the very case its POWER
       * procedure exists to put the sign back onto.
       */
      return flt(Math.pow(Math.abs(x), y))
    case '=':
      return VI(x === y ? -1 : 0)
    case '<>':
    case '><':
      return VI(x !== y ? -1 : 0)
    case '<':
      return VI(x < y ? -1 : 0)
    case '>':
      return VI(x > y ? -1 : 0)
    case '<=':
    case '=<':
      return VI(x <= y ? -1 : 0)
    case '>=':
    case '=>':
      return VI(x >= y ? -1 : 0)
    case 'and':
      return VI((Math.trunc(x) | 0) & (Math.trunc(y) | 0))
    case 'or':
      return VI((Math.trunc(x) | 0) | (Math.trunc(y) | 0))
    case 'xor':
      return VI((Math.trunc(x) | 0) ^ (Math.trunc(y) | 0))
    default:
      throw new AmosError(`unimplemented operator: ${op}`)
  }
}

