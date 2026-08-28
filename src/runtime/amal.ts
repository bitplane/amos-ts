/**
 * AMAL — the AMOS Animation Language. A tiny compiled language stepped
 * once per 50Hz frame per channel, driving bobs/sprites/screens.
 *
 * Reimplemented from the original tokenizer+interpreter in +W.s
 * (TokAMAL / Animeur). Semantics kept faithfully:
 * - lowercase letters and unknown characters are comments/ignored
 * - expressions evaluate strictly left-to-right, 16-bit arithmetic
 * - Move uses 8.8→16.16 fixed-point slopes with a half-pixel bias
 * - Jump budget of 10 per frame (20 in autotest) — loops yield to the
 *   next frame instead of hanging
 * - Anim runs in the background while the main sequence continues
 * - labels are single letters A-Z; autotest is AU(...) with X to exit
 *   and D label to redirect the main sequence
 */

import type { AmalBank } from '../loader/amalbank'
import { sw16 } from './word'

export class AmalCompileError extends Error {
  constructor(
    message: string,
    /** character offset in the source string (for =Amalerr) */
    readonly position: number,
  ) {
    super(message)
  }
}

export type Operand =
  | { k: 'num'; v: number }
  | { k: 'A' }
  | { k: 'X' }
  | { k: 'Y' }
  | { k: 'R'; i: number } // internal R0-R9
  | { k: 'G'; i: number } // global RA-RZ
  | { k: 'XM' }
  | { k: 'YM' }
  | { k: 'K1' }
  | { k: 'K2' }
  | { k: 'J0' }
  | { k: 'J1' }
  | { k: 'O' }
  | { k: 'Z'; e: Expr }
  | { k: 'C'; e: Expr }
  | { k: 'V'; e: Expr }
  | { k: 'XS' | 'YS' | 'XH' | 'YH'; a: Expr; b: Expr }
  | { k: 'BC' | 'SC'; a: Expr; b: Expr; c: Expr }

export interface Expr {
  first: Operand
  rest: Array<[op: string, rhs: Operand]>
}

export type AmalOp =
  | { k: 'end' }
  | { k: 'pause' }
  | { k: 'wait' }
  | { k: 'jump'; t: number }
  | { k: 'direct'; t: number }
  | { k: 'exitAuto' }
  | { k: 'autoOn' }
  | { k: 'autoOff' }
  | { k: 'let'; dest: Operand; e: Expr }
  | { k: 'if'; e: Expr; then: AmalOp }
  | { k: 'for'; reg: Operand; from: Expr; to: Expr }
  | { k: 'next'; forI: number }
  | { k: 'move'; dx: Expr; dy: Expr; steps: Expr }
  | { k: 'anim'; count: Expr; frames: Array<{ img: Expr; delay: Expr }> }
  | { k: 'play'; e: Expr }

export interface AmalProgram {
  main: AmalOp[]
  auto: AmalOp[]
}

// ---- compiler -------------------------------------------------------------

class Lexer {
  pos = 0
  constructor(readonly src: string) {}

  /** next significant char: skips <33 and lowercase (comments), Esc+2 */
  next(): string | null {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos++]!
      const n = c.charCodeAt(0)
      if (n === 27) {
        this.pos += 2
        continue
      }
      if (c === '|' || c === '!') return c
      if (n < 33 || n > 90) continue
      return c
    }
    return null
  }

  peek(): string | null {
    const save = this.pos
    const c = this.next()
    this.pos = save
    return c
  }

  back(): void {
    this.pos--
  }

  err(msg: string): AmalCompileError {
    return new AmalCompileError(msg, this.pos)
  }
}

export function compileAmal(src: string): AmalProgram {
  const lx = new Lexer(src)
  const main: AmalOp[] = []
  const auto: AmalOp[] = []
  /** label letter → [scope, index]; scope: 0 = main, 1 = autotest */
  const labels = new Map<string, [number, number]>()
  const fixups: Array<{ scope: number; index: number; label: string; wantScope: number }> = []
  const forStack: number[] = []
  let inAuto = false
  const ops = (): AmalOp[] => (inAuto ? auto : main)

  const parseNumber = (first: string): number => {
    let neg = false
    let c: string | null = first
    if (c === '-') {
      neg = true
      c = lx.next()
    }
    let v = 0
    if (c === null) throw lx.err('number expected')
    if (c === '$') {
      let any = false
      for (;;) {
        c = lx.next()
        if (c !== null && /[0-9A-F]/.test(c)) {
          v = v * 16 + parseInt(c, 16)
          any = true
        } else {
          if (c !== null) lx.back()
          break
        }
      }
      if (!any) throw lx.err('bad hex number')
    } else {
      if (c === null || !/[0-9]/.test(c)) throw lx.err('number expected')
      v = c.charCodeAt(0) - 48
      for (;;) {
        c = lx.next()
        if (c !== null && /[0-9]/.test(c)) v = v * 10 + (c.charCodeAt(0) - 48)
        else {
          if (c !== null) lx.back()
          break
        }
      }
    }
    return neg ? -v : v
  }

  /** register or special target: A/X/Y/Rn/RA-RZ, or null */
  const parseReg = (c: string | null): Operand | null => {
    if (c === 'A') return { k: 'A' }
    if (c === 'X') return { k: 'X' }
    if (c === 'Y') return { k: 'Y' }
    if (c === 'R') {
      const d = lx.next()
      if (d !== null && /[0-9]/.test(d)) return { k: 'R', i: d.charCodeAt(0) - 48 }
      if (d !== null && /[A-Z]/.test(d)) return { k: 'G', i: d.charCodeAt(0) - 65 }
      throw lx.err('bad register')
    }
    return null
  }

  const parseArgs = (n: number): Expr[] => {
    if (lx.next() !== '(') throw lx.err('( expected')
    const out: Expr[] = []
    for (let i = 0; i < n; i++) {
      out.push(parseExpr())
      const c = lx.next()
      if (i < n - 1 ? c !== ',' : c !== ')') throw lx.err(i < n - 1 ? ', expected' : ') expected')
    }
    return out
  }

  const parseOperand = (): Operand => {
    const c = lx.next()
    if (c === null) throw lx.err('operand expected')
    switch (c) {
      case 'K': {
        const d = lx.next()
        if (d === '1') return { k: 'K1' }
        if (d === '2') return { k: 'K2' }
        throw lx.err('K1 or K2')
      }
      case 'J': {
        const d = lx.next()
        if (d === '0') return { k: 'J0' }
        if (d === '1') return { k: 'J1' }
        throw lx.err('J0 or J1')
      }
      case 'O':
        return { k: 'O' }
      case 'Z': {
        const [e] = parseArgs(1)
        return { k: 'Z', e: e! }
      }
      case 'V': {
        const [e] = parseArgs(1)
        return { k: 'V', e: e! }
      }
      case 'C': {
        const [e] = parseArgs(1)
        return { k: 'C', e: e! }
      }
      case 'B':
      case 'S': {
        // BC(n,f,t) / SC(n,f,t)
        if (lx.next() !== 'C') throw lx.err('BC/SC expected')
        const [a, b, cc] = parseArgs(3)
        return { k: c === 'B' ? 'BC' : 'SC', a: a!, b: b!, c: cc! }
      }
    }
    if (c === '-' || c === '$' || /[0-9]/.test(c)) return { k: 'num', v: parseNumber(c) }
    const reg = parseReg(c)
    if (reg === null) throw lx.err(`bad operand "${c}"`)
    if (reg.k === 'X' || reg.k === 'Y') {
      // XM/YM mouse, XS/YS/XH/YH conversions
      const d = lx.peek()
      if (d === 'M') {
        lx.next()
        return reg.k === 'X' ? { k: 'XM' } : { k: 'YM' }
      }
      if (d === 'S' || d === 'H') {
        lx.next()
        const [a, b] = parseArgs(2)
        const kind = (reg.k + d) as 'XS' | 'YS' | 'XH' | 'YH'
        return { k: kind, a: a!, b: b! }
      }
    }
    return reg
  }

  const OPS = ['=', '<>', '<', '>', '+', '-', '/', '*', '|', '&', '!']
  const parseExpr = (): Expr => {
    const first = parseOperand()
    const rest: Expr['rest'] = []
    for (;;) {
      const c = lx.next()
      if (c === null) break
      let op: string | null = null
      if (c === '<' && lx.peek() === '>') {
        lx.next()
        op = '<>'
      } else if (OPS.includes(c) && c !== '<>') {
        op = c
      }
      if (op === null) {
        lx.back()
        break
      }
      rest.push([op, parseOperand()])
    }
    return { first, rest }
  }

  const parseBranch = (): AmalOp => {
    const c = lx.next()
    if (c === 'J') {
      const l = lx.next()
      if (l === null || !/[A-Z]/.test(l)) throw lx.err('label expected')
      const op: AmalOp = { k: 'jump', t: -1 }
      ops().push(op)
      fixups.push({ scope: inAuto ? 1 : 0, index: ops().length - 1, label: l, wantScope: inAuto ? 1 : 0 })
      return op
    }
    if (c === 'D') {
      if (!inAuto) throw lx.err('Direct outside autotest')
      const l = lx.next()
      if (l === null || !/[A-Z]/.test(l)) throw lx.err('label expected')
      const op: AmalOp = { k: 'direct', t: -1 }
      ops().push(op)
      fixups.push({ scope: 1, index: ops().length - 1, label: l, wantScope: 0 })
      return op
    }
    if (c === 'X') {
      if (!inAuto) throw lx.err('Exit outside autotest')
      const op: AmalOp = { k: 'exitAuto' }
      ops().push(op)
      return op
    }
    throw lx.err('J, D or X expected')
  }

  for (;;) {
    const c = lx.next()
    if (c === null) break
    // label?
    if (/[A-Z]/.test(c) && lx.peek() === ':') {
      lx.next()
      if (labels.has(c)) throw lx.err(`label ${c} already defined`)
      labels.set(c, [inAuto ? 1 : 0, ops().length])
      continue
    }
    switch (c) {
      case 'J':
        parseBranch2('J')
        break
      case 'L': {
        const dest = parseReg(lx.next())
        if (dest === null) throw lx.err('register expected after Let')
        if (lx.next() !== '=') throw lx.err('= expected')
        ops().push({ k: 'let', dest, e: parseExpr() })
        break
      }
      case 'M': {
        if (inAuto) throw lx.err('Move not allowed in autotest')
        const dx = parseExpr()
        if (lx.next() !== ',') throw lx.err(', expected')
        const dy = parseExpr()
        if (lx.next() !== ',') throw lx.err(', expected')
        ops().push({ k: 'move', dx, dy, steps: parseExpr() })
        break
      }
      case 'F': {
        if (inAuto) throw lx.err('For not allowed in autotest')
        const reg = parseReg(lx.next())
        // AmFor (+W.s:8840) selects the register FILE by the sign of the
        // compiled offset -- `move.w (a3)+,d0 / bpl.s AmFr0` takes
        // `T_AmRegs(a5)`, the global RA-RZ, and a negative one takes
        // `AmIRegs+NbInterne*2(a6)`, the internal R0-R9. Both are legal, and
        // AmNxt repeats the same test. Ant Wars II's `barebones.AMOS` counts
        // its bob frames with `For RA=0 To 29`.
        if (reg === null || (reg.k !== 'R' && reg.k !== 'G')) throw lx.err('For needs a register')
        if (lx.next() !== '=') throw lx.err('= expected')
        const from = parseExpr()
        if (lx.next() !== 'T') throw lx.err('To expected')
        const to = parseExpr()
        forStack.push(ops().length)
        ops().push({ k: 'for', reg, from, to })
        break
      }
      case 'N': {
        if (inAuto) throw lx.err('Next not allowed in autotest')
        const reg = parseReg(lx.next())
        if (reg === null || (reg.k !== 'R' && reg.k !== 'G')) throw lx.err('Next needs a register')
        const forI = forStack.pop()
        if (forI === undefined) throw lx.err('Next without For')
        ops().push({ k: 'next', forI })
        break
      }
      case 'I': {
        const e = parseExpr()
        const before = ops().length
        ops().push({ k: 'if', e, then: { k: 'end' } })
        const then = parseBranch()
        // the branch op was appended after the if — fold it in
        ops().splice(before + 1)
        ;(ops()[before] as { then: AmalOp }).then = then
        if (then.k === 'jump' || then.k === 'direct') {
          const f = fixups[fixups.length - 1]!
          f.index = before
        }
        break
      }
      case 'W':
        if (inAuto) throw lx.err('Wait not allowed in autotest')
        ops().push({ k: 'wait' })
        break
      case 'P':
        if (lx.peek() === 'L') {
          lx.next()
          ops().push({ k: 'play', e: parseExpr() })
        } else {
          ops().push({ k: 'pause' })
        }
        break
      case 'E':
        ops().push({ k: 'end' })
        break
      case 'A': {
        if (lx.peek() === 'U') {
          // AUtotest
          lx.next()
          if (lx.next() !== '(') throw lx.err('( expected after AU')
          if (inAuto) throw lx.err('autotest already open')
          if (lx.peek() === ')') {
            lx.next()
            main.push({ k: 'autoOff' })
            break
          }
          main.push({ k: 'autoOn' })
          inAuto = true
          break
        }
        const count = parseExpr()
        if (lx.next() !== ',') throw lx.err(', expected')
        const frames: Array<{ img: Expr; delay: Expr }> = []
        if (lx.next() !== '(') throw lx.err('( expected')
        for (;;) {
          const img = parseExpr()
          if (lx.next() !== ',') throw lx.err(', expected')
          const delay = parseExpr()
          if (lx.next() !== ')') throw lx.err(') expected')
          frames.push({ img, delay })
          if (lx.peek() === '(') {
            lx.next()
            continue
          }
          break
        }
        ops().push({ k: 'anim', count, frames })
        break
      }
      case 'D':
      case 'X': {
        lx.back()
        parseBranch()
        break
      }
      case ')': {
        if (!inAuto) throw lx.err('autotest not open')
        auto.push({ k: 'exitAuto' })
        inAuto = false
        break
      }
      default:
        // unknown characters (separators like ; ) are ignored, as in AMOS
        break
    }
  }
  if (inAuto) auto.push({ k: 'exitAuto' })
  main.push({ k: 'end' })

  function parseBranch2(_c: string): void {
    const l = lx.next()
    if (l === null || !/[A-Z]/.test(l)) throw lx.err('label expected')
    ops().push({ k: 'jump', t: -1 })
    fixups.push({ scope: inAuto ? 1 : 0, index: ops().length - 1, label: l, wantScope: inAuto ? 1 : 0 })
  }

  // resolve labels
  for (const f of fixups) {
    const target = labels.get(f.label)
    if (target === undefined) throw new AmalCompileError(`label ${f.label} not defined`, lx.pos)
    const [scope, index] = target
    if (scope !== f.wantScope) throw new AmalCompileError(`jump across autotest boundary to ${f.label}`, lx.pos)
    const arr = f.scope === 1 ? auto : main
    const op = arr[f.index]!
    if (op.k === 'jump' || op.k === 'direct') op.t = index
    else if (op.k === 'if' && (op.then.k === 'jump' || op.then.k === 'direct')) op.then.t = index
  }

  return { main, auto }
}

// ---- runtime --------------------------------------------------------------

/** what a channel drives: read/write x, y and image */
export interface ChannelTarget {
  kind: string
  n: number
  get(): { x: number; y: number; a: number }
  set(x: number | null, y: number | null, a: number | null): void
}

/** host services the VM needs (provided by the Runtime) */
export interface AmalHost {
  globals: Int16Array // RA-RZ
  random(mask: number): number
  mouseX(): number
  mouseY(): number
  mouseKey(bit: number): number
  joy(port: number): number
  vumeter(voice: number): number
  col(n: number): number
  bobCol(n: number, f: number, t: number): number
  spriteCol(n: number, f: number, t: number): number
  xy(kind: 'XS' | 'YS' | 'XH' | 'YH', screen: number, v: number): number
  /** T_AmBank (+W.s:7186): bank 4 if it is named "Amal", else null */
  amalBank(): AmalBank | null
}


export class AmalChannel {
  pc: number | null = 0
  autoActive = false
  on = false
  frozen = false
  regs = new Int16Array(10)
  // Move state (AmCpt/AmDeltX/...): counter -1 = needs init
  private moveCount = -1
  private dxFix = 0
  private dyFix = 0
  private accX = 0
  private accY = 0
  // PLay state (AmDeltX/AmDeltY/AmVirgX/AmVirgY): raw offsets into the AMAL
  // bank payload, walked forwards or backwards depending on R1
  private playData: Uint8Array | null = null
  private playX = 0
  private playY = 0
  private waitX = 0
  private waitY = 0
  // background Anim state
  private anim: { countLeft: number; idx: number; delayLeft: number; frames: Array<{ img: Expr; delay: Expr }> } | null =
    null
  private forLimits = new Map<number, number>()

  constructor(
    readonly num: number,
    readonly prog: AmalProgram,
    public target: ChannelTarget,
  ) {}

  get moving(): boolean {
    return this.moveCount > 0
  }

  get animating(): boolean {
    return this.anim !== null
  }

  /**
   * The loop counter of a For/Next, from whichever register file it names.
   *
   * AmFor and AmNxt both branch on the sign of the compiled offset (+W.s:8840
   * and 8882), so one loop can count in an internal register and the next in
   * a global, and the two files never mix.
   */
  private loopReg(reg: Operand, host: AmalHost): number {
    if (reg.k === 'R') return this.regs[reg.i]!
    if (reg.k === 'G') return host.globals[reg.i]!
    return 0
  }

  private setLoopReg(reg: Operand, v: number, host: AmalHost): void {
    if (reg.k === 'R') this.regs[reg.i] = v
    else if (reg.k === 'G') host.globals[reg.i] = v
  }

  private evalOperand(o: Operand, host: AmalHost): number {
    switch (o.k) {
      case 'num':
        return sw16(o.v)
      case 'A':
        return sw16(this.target.get().a)
      case 'X':
        return sw16(this.target.get().x)
      case 'Y':
        return sw16(this.target.get().y)
      case 'R':
        return this.regs[o.i]!
      case 'G':
        return host.globals[o.i]!
      case 'XM':
        return sw16(host.mouseX())
      case 'YM':
        return sw16(host.mouseY())
      case 'K1':
        return host.mouseKey(1)
      case 'K2':
        return host.mouseKey(2)
      case 'J0':
        return sw16(host.joy(0))
      case 'J1':
        return sw16(host.joy(1))
      case 'O':
        return this.moveCount > 0 ? -1 : 0
      case 'Z':
        return sw16(host.random(this.eval(o.e, host)))
      case 'C':
        return sw16(host.col(this.eval(o.e, host)))
      case 'V':
        return sw16(host.vumeter(this.eval(o.e, host)))
      case 'XS':
      case 'YS':
      case 'XH':
      case 'YH':
        return sw16(host.xy(o.k, this.eval(o.a, host), this.eval(o.b, host)))
      case 'BC':
        return sw16(host.bobCol(this.eval(o.a, host), this.eval(o.b, host), this.eval(o.c, host)))
      case 'SC':
        return sw16(host.spriteCol(this.eval(o.a, host), this.eval(o.b, host), this.eval(o.c, host)))
    }
  }

  /** strictly left-to-right, 16-bit */
  eval(e: Expr, host: AmalHost): number {
    let v = this.evalOperand(e.first, host)
    for (const [op, rhs] of e.rest) {
      const r = this.evalOperand(rhs, host)
      switch (op) {
        case '=':
          v = v === r ? -1 : 0
          break
        case '<>':
          v = v !== r ? -1 : 0
          break
        case '<':
          v = v < r ? -1 : 0
          break
        case '>':
          v = v > r ? -1 : 0
          break
        case '+':
          v = sw16(v + r)
          break
        case '-':
          v = sw16(v - r)
          break
        case '*':
          v = sw16(Math.imul(v, r))
          break
        case '/':
          v = r === 0 ? 0 : sw16(Math.trunc(v / r))
          break
        case '|':
          v = sw16(v | r)
          break
        case '&':
          v = sw16(v & r)
          break
        case '!':
          v = sw16(v ^ r)
          break
      }
    }
    return v
  }

  private assign(dest: Operand, v: number, host: AmalHost): void {
    switch (dest.k) {
      case 'A':
        this.target.set(null, null, v)
        break
      case 'X':
        this.target.set(v, null, null)
        break
      case 'Y':
        this.target.set(null, v, null)
        break
      case 'R':
        this.regs[dest.i] = v
        break
      case 'G':
        host.globals[dest.i] = v
        break
      default:
        break // other destinations can't be assigned
    }
  }

  /** one 50Hz step */
  step(host: AmalHost): void {
    if (this.autoActive) this.runAuto(host)
    if (this.pc !== null) this.runMain(host)
    this.runAnim(host)
  }

  private runAuto(host: AmalHost): void {
    let budget = 20
    let pc = 0
    const ops = this.prog.auto
    while (pc < ops.length) {
      const op = ops[pc]!
      switch (op.k) {
        case 'exitAuto':
          return
        case 'jump':
          pc = op.t
          if (--budget <= 0) return
          continue
        case 'direct':
          this.pc = op.t
          this.moveCount = -1
          pc++
          continue
        case 'let':
          this.assign(op.dest, this.eval(op.e, host), host)
          pc++
          continue
        case 'if':
          if (this.eval(op.e, host) !== 0) {
            if (op.then.k === 'jump') {
              pc = op.then.t
              if (--budget <= 0) return
            } else if (op.then.k === 'direct') {
              this.pc = op.then.t
              this.moveCount = -1
              pc++
            } else {
              return // exitAuto
            }
          } else pc++
          continue
        case 'end':
          this.pc = null
          this.autoActive = false
          return
        default:
          pc++ // anything else is a no-op in autotest
      }
    }
  }

  private runMain(host: AmalHost): void {
    let budget = 10
    const ops = this.prog.main
    while (this.pc !== null && this.pc < ops.length) {
      const op = ops[this.pc]!
      switch (op.k) {
        case 'end':
          this.pc = null
          this.autoActive = false
          return
        case 'pause':
          this.pc++
          return
        case 'wait':
          this.pc = null
          return
        case 'jump':
          this.pc = op.t
          if (--budget <= 0) return
          continue
        case 'autoOn':
          this.autoActive = true
          this.pc++
          continue
        case 'autoOff':
          this.autoActive = false
          this.pc++
          continue
        case 'let':
          this.assign(op.dest, this.eval(op.e, host), host)
          this.pc++
          continue
        case 'if':
          if (this.eval(op.e, host) !== 0 && op.then.k === 'jump') {
            this.pc = op.then.t
            if (--budget <= 0) return
          } else this.pc++
          continue
        case 'for': {
          const from = this.eval(op.from, host)
          const to = this.eval(op.to, host)
          this.setLoopReg(op.reg, from, host)
          this.forLimits.set(this.pc, to)
          this.pc++
          continue
        }
        case 'next': {
          const forOp = ops[op.forI]!
          if (forOp.k === 'for') {
            const v = sw16(this.loopReg(forOp.reg, host) + 1)
            this.setLoopReg(forOp.reg, v, host)
            if ((this.forLimits.get(op.forI) ?? 0) >= v) {
              this.pc = op.forI + 1
              if (--budget <= 0) return
              continue
            }
          }
          this.pc++
          continue
        }
        case 'move': {
          if (this.moveCount < 0) {
            // init: compute 8.8 slopes (as the original), do the first step
            const dx = this.eval(op.dx, host)
            const dy = this.eval(op.dy, host)
            let steps = this.eval(op.steps, host)
            if (steps <= 0) steps = 1
            this.moveCount = steps
            const slope = (d: number): number => {
              const q = Math.trunc((Math.abs(d) << 8) / steps)
              return (d < 0 ? -q : q) << 8
            }
            this.dxFix = slope(dx)
            this.dyFix = slope(dy)
            const { x, y } = this.target.get()
            this.accX = (x << 16) | 0x8000
            this.accY = (y << 16) | 0x8000
            this.moveStep()
            return
          }
          this.moveCount--
          if (this.moveCount === 0) {
            this.moveCount = -1
            this.pc++
            continue
          }
          this.moveStep()
          return
        }
        case 'anim': {
          const count = this.eval(op.count, host)
          this.anim = { countLeft: count, idx: 0, delayLeft: 1, frames: op.frames }
          this.pc++
          continue
        }
        case 'play': {
          // AmPlay +W.s:8559. AmCpt is the same counter Move uses: decrement
          // it, then negative means "not started yet" (AmPli), positive means
          // the tempo has not elapsed (AmX), zero means take a step (AmPl0).
          this.moveCount--
          if (this.moveCount < 0) {
            // AmPli +W.s:8632 — look the movement up in the AMAL bank. A
            // missing bank, a number past the count and number 0 all fall
            // through to AmMvX, which simply runs on to the next instruction.
            const n = this.eval(op.e, host)
            const bank = host.amalBank()
            const mv = bank && n > 0 ? (bank.movements[n] ?? null) : null
            if (!bank || !mv) {
              this.pc++
              continue
            }
            this.regs[0] = sw16(mv.speed) // R0 = the record's own tempo
            this.regs[1] = 1 // R1 = 1: play forwards
            this.playData = bank.data
            this.playX = mv.xStart
            this.playY = mv.yStart
            this.waitX = 0
            this.waitY = 0
          } else if (this.moveCount > 0) {
            return
          }
          if (this.playData === null || this.playStep()) {
            this.pc++ // AmMvX: the movement is over
            continue
          }
          return
        }
        default:
          this.pc++
      }
    }
    if (this.pc !== null && this.pc >= ops.length) this.pc = null
  }

  /**
   * AmPl0 +W.s:8562 — one tempo tick of a recorded movement: one step off
   * the X stream, one off the Y stream, then AmCpt reloads from R0.
   *
   * A stream byte is either 0 (the movement ends — and it is a 0 *before*
   * the first step that ends a backwards replay), a 7-bit signed pixel step,
   * or, with bit 7 set, a pause of that many ticks. Returns true when the
   * movement is over, i.e. when the 68k branches to AmMvX.
   */
  private playStep(): boolean {
    const d = this.playData
    if (d === null) return true
    const dir = this.regs[1]!
    if (dir < 0) return true // R1 < 0 aborts the movement (bmi AmMvX)
    const forward = dir !== 0 // R1 = 0 replays the path in reverse
    const byteAt = (i: number): number => (i >= 0 && i < d.length ? d[i]! : 0)

    const bx = byteAt(this.playX)
    if (bx === 0) return true
    if (bx < 0x80) {
      // lsl.b #1 / asr.b #1: the step is signed on bit 6, so -64..63
      const step = (bx << 25) >> 25
      this.target.set(sw16(this.target.get().x + (forward ? step : -step)), null, null)
      this.playX += forward ? 1 : -1
    } else if (--this.waitX === 0) {
      this.playX += forward ? 1 : -1
    } else if (this.waitX < 0) {
      const n = bx & 0x7f
      if (n === 0) this.playX += forward ? 1 : -1
      else this.waitX = n
    }

    const by = byteAt(this.playY)
    if (by === 0) return true
    if (by < 0x80) {
      const step = (by << 25) >> 25
      this.target.set(null, sw16(this.target.get().y + (forward ? step : -step)), null)
      this.playY += forward ? 1 : -1
    } else if (--this.waitY === 0) {
      this.playY += forward ? 1 : -1
    } else if (this.waitY < 0) {
      const n = by & 0x7f
      if (n === 0) this.playY += forward ? 1 : -1
      else this.waitY = n
    }

    this.moveCount = this.regs[0]! // Ampwy3: reload AmCpt from the tempo
    return false
  }

  private moveStep(): void {
    this.accX = (this.accX + this.dxFix) | 0
    this.accY = (this.accY + this.dyFix) | 0
    const cur = this.target.get()
    const nx = this.accX >> 16
    const ny = this.accY >> 16
    this.target.set(nx !== cur.x ? nx : null, ny !== cur.y ? ny : null, null)
  }

  private runAnim(host: AmalHost): void {
    const an = this.anim
    if (an === null) return
    if (--an.delayLeft > 0) return
    for (;;) {
      if (an.idx < an.frames.length) {
        const f = an.frames[an.idx]!
        this.target.set(null, null, this.eval(f.img, host))
        an.delayLeft = Math.max(1, this.eval(f.delay, host))
        an.idx++
        return
      }
      // list exhausted: loop / count down
      if (an.countLeft !== 0) {
        an.countLeft--
        if (an.countLeft === 0) {
          this.anim = null
          return
        }
      }
      an.idx = 0
    }
  }
}
