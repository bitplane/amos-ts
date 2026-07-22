import type { Tok, TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { detokLine } from '../tokens/detok'
import { Names } from './names'
import { prescan, varKey } from './prescan'
import type { Addr, Ctrl, Program } from './prescan'
import {
  AmosError,
  VI,
  coerce,
  defaultValue,
  display,
  int,
  num,
  str,
  truthy,
  varType,
} from './values'
import type { Value, VarType } from './values'
import type { AmosIO } from './io'
import { INSTR, FUNCS } from './builtins'

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
}

export interface LoopFrame {
  t: 'for' | 'repeat' | 'while' | 'do'
  tok: Tok
  /** first statement of the loop body */
  body: Addr
  varKey?: string
  varT?: VarType
  step?: number
  limit?: number
}

export interface Target {
  type: VarType
  get(): Value
  set(v: Value): void
}

export interface InterpOptions {
  io?: AmosIO
  extensions?: Map<number, TokenTable>
  /** what to do with instructions the interpreter doesn't know yet */
  onUnimplemented?: 'throw' | 'skip'
  maxSteps?: number
}

export interface RunResult {
  status: 'ended' | 'stopped' | 'maxSteps'
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
  gosubs: Addr[] = []
  globals = new Set<string>()
  lastParam: Value = VI(0)
  /** the Else If token we branched to from a false condition, if any */
  branchElseIf: Tok | null = null
  dataPtr: Addr = { li: 0, ti: 0 }
  dataInStmt = false
  degrees = false
  // ---- error trapping (On Error / Trap / Resume) ----
  errorHandler: { kind: 'goto' | 'proc'; target: string } | null = null
  /** nonzero after a trapped error (read by Errtrap) */
  errCode = 0
  /** true while inside an On Error handler — a second error is fatal */
  inError = false
  errStmt: Addr | null = null
  errNext: Addr | null = null
  private stmtStart: Addr = { li: 0, ti: 0 }
  // TODO: verify AMOS's default Print comma tab width against the console code
  tabWidth = 13
  col = 0
  private rng = 0x2545f491
  private status: RunResult['status'] | null = null
  unimplemented = new Map<string, number>()
  private policy: 'throw' | 'skip'
  private maxSteps: number

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
  }

  run(): RunResult {
    let steps = 0
    while (this.status === null) {
      if (++steps > this.maxSteps) {
        this.status = 'maxSteps'
        break
      }
      try {
        this.step()
      } catch (e) {
        if (e instanceof AmosError && this.errorHandler !== null && !this.inError) {
          this.errCode = 1
          this.inError = true
          this.errStmt = { li: this.stmtStart.li, ti: this.stmtStart.ti }
          this.errNext = this.afterCurrentStatement()
          const h = this.errorHandler
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
    return { status: this.status, steps, unimplemented: this.unimplemented }
  }

  halt(status: 'ended' | 'stopped'): void {
    this.status = status
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

  getArray(key: string): AmosArray {
    const arr = this.frameFor(key, true).arrays.get(key)
    if (!arr) throw new AmosError(`array not dimensioned: ${key.toUpperCase()}`)
    return arr
  }

  dimArray(key: string, t: VarType, dims: number[]): void {
    const counts = dims.map((d) => {
      if (d < 0) throw new AmosError('illegal array size')
      return d + 1
    })
    const size = counts.reduce((a, b) => a * b, 1)
    const f = this.frameFor(key, true)
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
        get: () => arr.data[linear]!,
        set: (v) => {
          arr.data[linear] = coerce(type, v)
        },
      }
    }
    return {
      type,
      get: () => this.getVar(key, type),
      set: (v) => this.setVar(key, type, v),
    }
  }

  // ---- expressions -------------------------------------------------------

  evalExpr(): Value {
    return this.parseExpr(1)
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

  private static PREC: Record<string, number> = {
    '^': 9,
    '*': 8,
    '/': 8,
    mod: 8,
    '+': 7,
    '-': 7,
    '=': 6,
    '<>': 6,
    '><': 6,
    '<': 6,
    '>': 6,
    '<=': 6,
    '=<': 6,
    '>=': 6,
    '=>': 6,
    and: 4,
    or: 3,
    xor: 3,
  }

  private parseExpr(minPrec: number): Value {
    let left = this.parseUnary()
    for (;;) {
      const t = this.tok()
      if (t?.kind !== 'op') return left
      const op = t.op.trim()
      const prec = Interp.PREC[op]
      if (prec === undefined || prec < minPrec) return left
      this.advance()
      const right = this.parseExpr(prec + 1)
      left = binOp(op, left, right)
    }
  }

  private parseUnary(): Value {
    const t = this.tok()
    if (t?.kind === 'op') {
      const op = t.op.trim()
      if (op === '-') {
        this.advance()
        const v = this.parseExpr(9)
        return v.k === 'int' ? VI(-v.n) : v.k === 'float' ? { k: 'float', n: -v.n } : (() => {
          throw new AmosError('Type mismatch')
        })()
      }
      if (op === '+') {
        this.advance()
        return this.parseUnary()
      }
    }
    if (this.nm() === 'not') {
      this.advance()
      return VI(~int(this.parseExpr(5)))
    }
    return this.parseAtom()
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
        return { k: 'float', n: t.value }
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
        if (name !== undefined) {
          const fn = FUNCS[name]
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
    this.frames.push(frame)
    this.setPc(proc.body)
  }

  returnFromProc(): void {
    if (this.frames.length <= 1) throw new AmosError('End Proc without Procedure call')
    const frame = this.frames.pop()!
    this.loops.length = frame.loopBase
    this.gosubs.length = frame.gosubBase
    this.setPc(frame.retAddr!)
  }

  // ---- flow helpers ------------------------------------------------------

  jumpLabel(name: string): void {
    const a = this.program.labels.get(name.toLowerCase())
    if (!a) throw new AmosError(`label not defined: ${name.toUpperCase()}`)
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

  readDataItem(): Value {
    const saved = this.pc
    this.pc = { li: this.dataPtr.li, ti: this.dataPtr.ti }
    try {
      if (!this.dataInStmt) this.seekData()
      const v = this.evalExpr()
      if (this.accept(',')) {
        this.dataInStmt = true
      } else {
        this.dataInStmt = false
      }
      this.dataPtr = { li: this.pc.li, ti: this.pc.ti }
      return v
    } finally {
      this.pc = saved
    }
  }

  private seekData(): void {
    for (const a of this.program.dataToks) {
      if (a.li > this.pc.li || (a.li === this.pc.li && a.ti >= this.pc.ti)) {
        this.pc = { li: a.li, ti: a.ti + 1 }
        this.dataInStmt = true
        return
      }
    }
    throw new AmosError('out of data')
  }

  restoreData(addr: Addr): void {
    this.dataPtr = { li: addr.li, ti: addr.ti }
    this.dataInStmt = false
  }

  // ---- random ------------------------------------------------------------

  seedRandom(seed: number): void {
    this.rng = seed | 0 || 0x2545f491
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
        this.jumpLabel(tok.name)
        return
      case 'int':
        this.advance()
        this.jumpLabel(String(tok.value))
        return
      case 'core':
      case 'ext': {
        const name = this.names.of(tok)
        if (name === ':' || name === 'then') {
          this.advance()
          return
        }
        const handler = name === undefined ? undefined : INSTR[name]
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
    if (this.atStmtEnd()) return
    if (this.policy === 'skip') {
      this.skipToStmtEnd()
      return
    }
    throw new AmosError('syntax error (unexpected tokens at end of statement)')
  }
}

// ---- operators -----------------------------------------------------------

function binOp(op: string, a: Value, b: Value): Value {
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
  const numV = (n: number): Value => (bothInt ? VI(n) : { k: 'float', n })
  switch (op) {
    case '+':
      return bothInt ? VI((x + y) | 0) : { k: 'float', n: x + y }
    case '-':
      return bothInt ? VI((x - y) | 0) : { k: 'float', n: x - y }
    case '*':
      return bothInt ? VI(Math.imul(x, y)) : { k: 'float', n: x * y }
    case '/':
      if (y === 0) throw new AmosError('division by zero')
      return bothInt ? VI(Math.trunc(x / y)) : { k: 'float', n: x / y }
    case 'mod': {
      const yi = Math.trunc(y) | 0
      if (yi === 0) throw new AmosError('division by zero')
      return VI((Math.trunc(x) | 0) % yi)
    }
    case '^':
      return numV(bothInt ? Math.trunc(Math.pow(x, y)) : Math.pow(x, y))
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
