import type { Tok, TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { detokLine } from '../tokens/detok'
import { Names } from './names'
import { prescan, scopeOfAddr, varKey } from './prescan'
import type { Addr, Ctrl, Program } from './prescan'
import {
  AmosError,
  VI,
  amosErrorCode,
  coerce,
  defaultValue,
  display,
  ffpRound,
  int,
  num,
  str,
  truthy,
  varType,
} from './values'
import type { Value, VarType } from './values'
import type { AmosIO } from './io'
import { INSTR, FUNCS, RAWFUNCS } from './builtins'
import type { Instr as InstrFn, Func as FuncFn } from './builtins'

export class AmosRuntimeError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly listing: string,
  ) {
    super(`${message} — at line ${line}: ${listing.trim()}`)
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
  retAddr: Addr | null
  loopBase: number
  gosubBase: number
  /** caller's data pointer — procedures have their own (local Data) */
  savedDataPtr?: Addr
  savedDataInStmt?: boolean
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
}

/** Why execution is paused, waiting on the outside world. */
export type Block =
  | { type: 'wait'; until: number }
  | { type: 'waitKey' }
  | { type: 'input'; prompt: string }
  | { type: 'dialog'; channel: number }
  | { type: 'fsel' }

/** Live input device state, owned by the runtime/driver and read by builtins. */
export interface InputState {
  /** typed characters not yet consumed by Inkey$ / Wait Key */
  keyQueue: Array<{ ch: string; scan: number; shift?: number }>
  /** Amiga scancodes currently held down (Key State) */
  keys: Set<number>
  /** scancode of the last key returned by Inkey$ */
  lastScan: number
  /** shift byte captured with the last Inkey$ (SScan high byte) */
  lastShift: number
  /** mouse in AMOS hardware coords (lowres pixel + 128/50 origin) */
  mouseX: number
  mouseY: number
  /** buttons currently held (bit 0 left, bit 1 right, bit 2 middle) */
  mouseK: number
  /** button state at the last Mouse Click read, for edge detection */
  mouseClickOld: number
  /** joystick bits: 1 up, 2 down, 4 left, 8 right, 16 fire */
  joy: number
  /** Set Key$(1..20) function-key definition strings */
  funcKeys: string[]
}

export const newInputState = (): InputState => ({
  keyQueue: [],
  keys: new Set(),
  lastScan: 0,
  lastShift: 0,
  mouseX: 128 + 160,
  mouseY: 50 + 100,
  mouseK: 0,
  mouseClickOld: 0,
  joy: 0,
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
  rawFunctions?: Record<string, (it: Interp) => Value>
  input?: InputState
}

export interface RunResult {
  status: 'ended' | 'stopped' | 'maxSteps' | 'blocked' | 'paused'
  steps: number
  /** instruction name → times skipped (onUnimplemented: 'skip' only) */
  unimplemented: Map<string, number>
}

const newFrame = (retAddr: Addr | null, loopBase: number, gosubBase: number): Frame => ({
  vars: new Map(),
  arrays: new Map(),
  shared: new Set(),
  retAddr,
  loopBase,
  gosubBase,
})

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
   * =Param / =Param# / =Param$ read distinct values (FnEProc +ILib.s:2701).
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
  /** the last error number caught by On Error (read by =Errn) */
  errCode = 0
  /** the last error number caught by Trap (read by =Errtrap) */
  trapCode = 0
  /** true while inside an On Error handler — a second error is fatal */
  inError = false
  errStmt: Addr | null = null
  errNext: Addr | null = null
  /** frame depth at the trapped error, so Resume can unwind a Proc handler */
  errFrameDepth = 0
  private stmtStart: Addr = { li: 0, ti: 0 }
  // default tab = 4, from the window-open defaults (Wo3a in +W.s)
  tabWidth = 4
  col = 0
  private rng = 0x2545f491
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
  private readonly rawFuncs: Record<string, (it: Interp) => Value>
  totalSteps = 0

  constructor(
    lines: TokenLine[],
    readonly table: TokenTable,
    opts: InterpOptions = {},
  ) {
    this.names = new Names(table, opts.extensions ?? new Map())
    this.program = prescan(lines, this.names)
    this.io = opts.io ?? { write: () => {} }
    this.policy = opts.onUnimplemented ?? 'throw'
    this.maxSteps = opts.maxSteps ?? 5_000_000
    this.instr = opts.instructions ? { ...INSTR, ...opts.instructions } : INSTR
    this.funcs = opts.functions ? { ...FUNCS, ...opts.functions } : FUNCS
    this.rawFuncs = { ...RAWFUNCS, ...opts.rawFunctions }
    this.inp = opts.input ?? newInputState()
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
      if (++steps > slice) return this.result('paused', steps)
      try {
        this.dispatchEvery()
        this.step()
      } catch (e) {
        if (e instanceof AmosError && this.errorHandler !== null && !this.inError) {
          this.errCode = amosErrorCode(e)
          this.inError = true
          this.errStmt = { li: this.stmtStart.li, ti: this.stmtStart.ti }
          this.errNext = this.afterCurrentStatement()
          const h = this.errorHandler
          // remember the frame depth so Resume can unwind an On Error Proc
          // handler (which enters as a procedure) back to here
          this.errFrameDepth = this.frames.length
          if (h.kind === 'proc') this.callProc(h.target, [])
          else this.jumpLabel(h.target)
          continue
        }
        if (e instanceof AmosError) {
          const li = Math.min(this.pc.li, this.program.lines.length - 1)
          const line = this.program.lines[li]
          const listing = line ? detokLine(line, this.table, { extensions: this.names.extensions }) : ''
          throw new AmosRuntimeError(e.message, li + 1, listing)
        }
        throw e
      }
    }
    return this.result(this.status ?? 'blocked', steps)
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
    return { status, steps, unimplemented: this.unimplemented }
  }

  halt(status: 'ended' | 'stopped'): void {
    this.status = status
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
    if (rewind) this.pc = { li: this.stmtStart.li, ti: this.stmtStart.ti }
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
    if (top.shared.has(key) || this.globals.has(key)) return this.frames[0]!
    // arrays Dim'd at top level are visible if declared Global/Shared only;
    // otherwise procedures see their own
    void arrays
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
      if (d < 0 || d >= 0xffff) throw new AmosError('function call error') // InDim limits
      size *= d + 1
      if (i < dims.length - 1 && size >= 0x10000) throw new AmosError('function call error')
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
          this.advance()
          return this.callUserFn()
        }
        if (name !== undefined && this.rawFuncs[name]) {
          this.advance()
          return this.rawFuncs[name]!(this)
        }
        if (name !== undefined) {
          const fn = this.funcs[name]
          if (fn !== undefined) {
            this.advance()
            const args: Value[] = []
            if (this.accept('(')) {
              if (!this.accept(')')) {
                for (;;) {
                  // elided argument, e.g. At(,10) — "keep current"
                  if (this.nm() === ',' || this.nm() === ')') args.push(VI(-1))
                  else args.push(this.evalExpr())
                  if (this.accept(',')) continue
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
            return name.endsWith('$') ? { k: 'str', s: '' } : VI(0)
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

  callProc(name: string, args: Value[]): void {
    const proc = this.program.procs.get(name)
    if (!proc) throw new AmosError(`procedure not defined: ${name.toUpperCase()}`)
    if (args.length !== proc.params.length) {
      throw new AmosError(`wrong number of parameters for ${name.toUpperCase()}`)
    }
    const frame = newFrame(this.afterCurrentStatement(), this.loops.length, this.gosubs.length)
    for (let i = 0; i < args.length; i++) {
      const p = proc.params[i]!
      frame.vars.set(p.key, coerce(p.type, args[i]!))
    }
    // procedures get their own data pointer, starting at their first Data
    frame.savedDataPtr = this.dataPtr
    frame.savedDataInStmt = this.dataInStmt
    this.dataPtr = { li: proc.body.li, ti: proc.body.ti }
    this.dataInStmt = false
    this.frames.push(frame)
    this.setPc(proc.body)
  }

  /**
   * Resume from an error handler: an On Error Proc handler entered as a
   * procedure frame, so pop back to the depth captured at the error (the
   * original's Resume does PopP, InResume ResP +ILib.s:1998).
   */
  unwindErrorHandler(): void {
    while (this.frames.length > this.errFrameDepth && this.frames.length > 1) {
      const frame = this.frames.pop()!
      this.loops.length = frame.loopBase
      this.gosubs.length = frame.gosubBase
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
    this.setPc(frame.retAddr!)
  }

  // ---- flow helpers ------------------------------------------------------

  /**
   * Jump to a label. Only Goto-style jumps unwind loop frames whose body
   * range does not contain the target (LGoto) — Gosub does not.
   */
  jumpLabel(name: string, unwind = false): void {
    const a = this.program.labels.get(name.toLowerCase())
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
  parseLabelTarget(): string {
    const t = this.tok()
    if (t?.kind === 'labelRef' || t?.kind === 'label' || t?.kind === 'procCall') {
      this.advance()
      return t.name
    }
    // un-Tested programs store label targets as plain variable tokens
    if (t?.kind === 'var' && this.program.labels.has(t.name.toLowerCase())) {
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
    if (!def) throw new AmosError(`Fn ${t.name.toUpperCase()} not defined`)
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
    if (args.length !== def.params.length) throw new AmosError('wrong number of arguments')
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

  // ---- random ------------------------------------------------------------

  seedRandom(seed: number): void {
    this.rng = seed | 0 || 0x2545f491
    this.rndSeed = seed >>> 0
  }

  random(): number {
    // xorshift32
    let x = this.rng
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rng = x | 0
    return (x >>> 0) / 0x100000000
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
    // FnRnd (+Lib.s:1976): Rnd(0) = the last result; a NEGATIVE argument
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
        this.advance()
        return
      case 'rem':
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
          this.advance()
          return
        }
        const handler = name === undefined ? undefined : this.instr[name]
        if (handler) {
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
      // Op_Puis: QueFloat — power is always a float operation
      return flt(Math.pow(x, y))
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

export { display, truthy }
