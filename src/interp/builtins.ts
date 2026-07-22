import type { Tok } from '../tokens/stream'
import type { Addr } from './prescan'
import { varKey } from './prescan'
import type { Interp } from './interp'
import { AmosError, VF, VI, VS, display, int, num, str, truthy, varType } from './values'
import type { Value } from './values'

/**
 * Instruction handlers. Called with the cursor just past the instruction
 * token; they parse their own arguments. Return 'jumped' after moving the
 * pc to a new statement (skips the statement-boundary check).
 */
export type Instr = (it: Interp, tok: Tok, addr: Addr) => void | 'jumped'
export type Func = (it: Interp, args: Value[]) => Value

const tokAt = (it: Interp, a: Addr): Tok | undefined => it.program.lines[a.li]?.tokens[a.ti]

function jumpFalse(it: Interp, onFalse: Addr): 'jumped' {
  it.setPc(onFalse)
  const t = it.tok()
  if (t !== undefined && (t.kind === 'core' || t.kind === 'ext') && it.names.of(t) === 'else if') {
    it.branchElseIf = t
  }
  return 'jumped'
}

function doExit(it: Interp, tok: Tok, n: number): 'jumped' {
  const c = it.ctrlOf(tok)
  if (c.kind !== 'exit') throw new AmosError('internal: bad Exit control info')
  if (n < 1) n = 1
  if (n > c.exits.length) throw new AmosError('Exit without enough open loops')
  it.loops.length = Math.max(0, it.loops.length - n)
  it.setPc(c.exits[n - 1]!)
  return 'jumped'
}

function inputAssign(target: { type: number; set(v: Value): void }, raw: string): void {
  if (target.type === 2) {
    target.set(VS(raw))
  } else {
    const n = parseFloat(raw.trim())
    target.set(VF(Number.isFinite(n) ? n : 0))
  }
}

export const INSTR: Record<string, Instr> = {
  // ---- output ----
  print(it) {
    let nl = true
    while (!it.atStmtEnd()) {
      if (it.accept(';')) {
        nl = false
        continue
      }
      if (it.accept(',')) {
        const pad = it.tabWidth - (it.col % it.tabWidth)
        it.write(' '.repeat(pad))
        nl = false
        continue
      }
      it.write(display(it.evalExpr()))
      nl = true
    }
    if (nl) it.write('\n')
  },
  centre(it) {
    it.write(it.evalStr())
  },
  locate(it) {
    let x = -1
    let y = -1
    if (!it.atStmtEnd() && it.nm() !== ',') x = it.evalInt()
    if (it.accept(',') && !it.atStmtEnd()) y = it.evalInt()
    it.io.locate?.(x, y)
    if (x >= 0) it.col = x
  },
  home(it) {
    it.io.locate?.(0, 0)
    it.col = 0
  },
  cls(it) {
    if (!it.atStmtEnd()) it.skipToStmtEnd() // optional colour / region args
    it.io.cls?.()
    it.col = 0
  },
  pen(it) {
    it.io.pen?.(it.evalInt())
  },
  paper(it) {
    it.io.paper?.(it.evalInt())
  },
  'curs on': () => {},
  'curs off': () => {},

  // ---- input ----
  input(it) {
    let prompt = ''
    if (it.tok()?.kind === 'str') {
      // prompt may be a full string expression: Input "GUESS"+Str$(N);T
      prompt = it.evalStr()
      it.accept(';') || it.accept(',')
    }
    const targets = [it.parseTarget()]
    while (it.accept(',')) targets.push(it.parseTarget())
    const line = it.io.input?.(prompt) ?? ''
    const parts = targets.length > 1 ? line.split(',') : [line]
    targets.forEach((tg, i) => inputAssign(tg, parts[i] ?? ''))
  },
  'line input'(it) {
    let prompt = ''
    if (it.tok()?.kind === 'str') {
      prompt = it.evalStr()
      it.accept(';') || it.accept(',')
    }
    inputAssign(it.parseTarget(), it.io.input?.(prompt) ?? '')
  },

  // ---- variables ----
  dim(it) {
    do {
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('variable expected in Dim')
      it.advance()
      it.expect('(')
      const dims: number[] = []
      for (;;) {
        dims.push(it.evalInt())
        if (it.accept(',')) continue
        it.expect(')')
        break
      }
      it.dimArray(varKey(t.name, t.flags), varType(t.flags), dims)
    } while (it.accept(','))
  },
  inc(it) {
    const tg = it.parseTarget()
    tg.set(VF(num(tg.get()) + 1))
  },
  dec(it) {
    const tg = it.parseTarget()
    tg.set(VF(num(tg.get()) - 1))
  },
  add(it) {
    const tg = it.parseTarget()
    it.expect(',')
    let v = num(tg.get()) + it.evalNum()
    if (it.accept(',')) {
      const base = it.evalNum()
      it.expect('to')
      const top = it.evalNum()
      if (v > top) v = base
      else if (v < base) v = top
    }
    tg.set(VF(v))
  },
  swap(it) {
    const a = it.parseTarget()
    it.expect(',')
    const b = it.parseTarget()
    if (a.type !== b.type) throw new AmosError('Type mismatch')
    const tmp = a.get()
    a.set(b.get())
    b.set(tmp)
  },

  // ---- control flow: if ----
  if(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'if') throw new AmosError('internal: bad If control info')
    const cond = truthy(it.evalExpr())
    if (cond) {
      // the branch's first statement follows directly (after Then, if any)
      it.accept('then')
      return 'jumped'
    }
    return jumpFalse(it, c.onFalse)
  },
  'else if'(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'elseif') throw new AmosError('internal: bad Else If control info')
    if (it.branchElseIf === tok) {
      // branched here from a false condition: evaluate ours
      it.branchElseIf = null
      const cond = truthy(it.evalExpr())
      if (cond) {
        it.accept('then')
        return 'jumped'
      }
      return jumpFalse(it, c.onFalse)
    }
    // fell through from a completed branch: skip to End If
    it.setPc(c.exit)
    return 'jumped'
  },
  else(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'else') throw new AmosError('internal: bad Else control info')
    it.setPc(c.exit)
    return 'jumped'
  },
  'end if': () => {},

  // ---- control flow: loops ----
  for(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'for') throw new AmosError('internal: bad For control info')
    const t = it.tok()
    if (t?.kind !== 'var') throw new AmosError('variable expected in For')
    it.advance()
    const key = varKey(t.name, t.flags)
    const vt = varType(t.flags)
    if (vt === 2) throw new AmosError('Type mismatch')
    it.expectOp('=')
    const start = it.evalNum()
    it.expect('to')
    const limit = it.evalNum()
    const step = it.accept('step') ? it.evalNum() : 1
    it.setVar(key, vt, VF(start))
    if (step >= 0 ? start <= limit : start >= limit) {
      const top = it.loops[it.loops.length - 1]
      const frame = { t: 'for' as const, tok, body: it.afterCurrentStatement(), varKey: key, varT: vt, step, limit }
      if (top?.tok === tok) it.loops[it.loops.length - 1] = frame
      else it.loops.push(frame)
      return
    }
    it.setPc(c.after)
    return 'jumped'
  },
  next(it) {
    const t = it.tok()
    let wantKey: string | null = null
    if (t?.kind === 'var') {
      it.advance()
      wantKey = varKey(t.name, t.flags)
    }
    while (it.loops.length > 0) {
      const top = it.loops[it.loops.length - 1]!
      if (top.t !== 'for') throw new AmosError('Next without For')
      if (wantKey === null || top.varKey === wantKey) break
      it.loops.pop()
    }
    const top = it.loops[it.loops.length - 1]
    if (top === undefined || top.t !== 'for') throw new AmosError('Next without For')
    const v = num(it.getVar(top.varKey!, top.varT!)) + top.step!
    it.setVar(top.varKey!, top.varT!, VF(v))
    if (top.step! >= 0 ? v <= top.limit! : v >= top.limit!) {
      it.setPc(top.body)
      return 'jumped'
    }
    it.loops.pop()
  },
  repeat(it, tok) {
    const top = it.loops[it.loops.length - 1]
    if (top?.tok !== tok) it.loops.push({ t: 'repeat', tok, body: it.afterCurrentStatement() })
  },
  until(it) {
    const top = it.loops[it.loops.length - 1]
    if (top === undefined || top.t !== 'repeat') throw new AmosError('Until without Repeat')
    if (!truthy(it.evalExpr())) {
      it.setPc(top.body)
      return 'jumped'
    }
    it.loops.pop()
  },
  while(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'while') throw new AmosError('internal: bad While control info')
    const top = it.loops[it.loops.length - 1]
    const have = top?.tok === tok
    if (truthy(it.evalExpr())) {
      if (!have) it.loops.push({ t: 'while', tok, body: it.afterCurrentStatement() })
      return
    }
    if (have) it.loops.pop()
    it.setPc(c.after)
    return 'jumped'
  },
  wend(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'wend') throw new AmosError('Wend without While')
    it.setPc(c.whileAddr)
    return 'jumped'
  },
  do(it, tok) {
    const top = it.loops[it.loops.length - 1]
    if (top?.tok !== tok) it.loops.push({ t: 'do', tok, body: it.afterCurrentStatement() })
  },
  loop(it, tok) {
    const c = it.ctrlOf(tok)
    if (c.kind !== 'loop') throw new AmosError('Loop without Do')
    it.setPc(c.start)
    return 'jumped'
  },
  exit(it, tok) {
    const n = it.atStmtEnd() ? 1 : it.evalInt()
    return doExit(it, tok, n)
  },
  'exit if'(it, tok) {
    const cond = truthy(it.evalExpr())
    const n = it.accept(',') ? it.evalInt() : 1
    if (cond) return doExit(it, tok, n)
  },

  // ---- control flow: jumps ----
  goto(it) {
    it.jumpLabel(it.parseLabelTarget())
    return 'jumped'
  },
  gosub(it) {
    const name = it.parseLabelTarget()
    it.gosubs.push(it.afterCurrentStatement())
    it.jumpLabel(name)
    return 'jumped'
  },
  return(it) {
    const frame = it.frames[it.frames.length - 1]!
    if (it.gosubs.length <= frame.gosubBase) throw new AmosError('Return without Gosub')
    it.setPc(it.gosubs.pop()!)
    return 'jumped'
  },
  pop(it) {
    const frame = it.frames[it.frames.length - 1]!
    if (it.gosubs.length <= frame.gosubBase) throw new AmosError('Pop without Gosub')
    it.gosubs.pop()
  },
  on(it) {
    const what = it.nm()
    if (what === 'error' || what === 'break') {
      it.unimpl(`on ${what}`)
      return
    }
    const n = it.evalInt()
    const kind = it.nm()
    if (kind !== 'goto' && kind !== 'gosub' && kind !== 'proc') {
      throw new AmosError('On without Goto/Gosub/Proc')
    }
    it.advance()
    const targets: string[] = []
    for (;;) {
      const t = it.tok()
      if (t !== undefined && (t.kind === 'labelRef' || t.kind === 'label' || t.kind === 'procCall' || t.kind === 'var')) {
        it.advance()
        targets.push(t.name)
      } else if (t?.kind === 'int') {
        it.advance()
        targets.push(String(t.value))
      } else {
        throw new AmosError('label expected in On')
      }
      if (!it.accept(',')) break
    }
    if (n < 1 || n > targets.length) return
    const target = targets[n - 1]!
    if (kind === 'proc') {
      it.callProc(target.toLowerCase(), [])
      return 'jumped'
    }
    if (kind === 'gosub') it.gosubs.push(it.afterCurrentStatement())
    it.jumpLabel(target)
    return 'jumped'
  },

  // ---- procedures ----
  'end proc'(it) {
    if (it.accept('[')) {
      it.lastParam = it.evalExpr()
      it.expect(']')
    }
    it.returnFromProc()
    return 'jumped'
  },
  'pop proc'(it) {
    it.returnFromProc()
    return 'jumped'
  },
  shared(it) {
    const frame = it.frames[it.frames.length - 1]!
    do {
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('variable expected in Shared')
      it.advance()
      if (it.accept('(')) it.expect(')')
      frame.shared.add(varKey(t.name, t.flags))
    } while (it.accept(','))
  },
  global(it) {
    do {
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('variable expected in Global')
      it.advance()
      if (it.accept('(')) it.expect(')')
      it.globals.add(varKey(t.name, t.flags))
    } while (it.accept(','))
  },

  // ---- data ----
  data(it) {
    it.skipToStmtEnd()
  },
  read(it) {
    do {
      const tg = it.parseTarget()
      tg.set(it.readDataItem())
    } while (it.accept(','))
  },
  restore(it) {
    if (it.atStmtEnd()) {
      it.restoreData({ li: 0, ti: 0 })
      return
    }
    const name = it.parseLabelTarget()
    const a = it.program.labels.get(name.toLowerCase())
    if (!a) throw new AmosError(`label not defined: ${name.toUpperCase()}`)
    it.restoreData(a)
  },

  // ---- error trapping ----
  'on error'(it) {
    it.inError = false
    if (it.accept('goto')) {
      it.errorHandler = { kind: 'goto', target: it.parseLabelTarget().toLowerCase() }
      return
    }
    if (it.accept('proc')) {
      it.errorHandler = { kind: 'proc', target: it.parseLabelTarget().toLowerCase() }
      return
    }
    it.errorHandler = null // bare On Error switches trapping off
  },
  trap(it) {
    it.errCode = 0
    try {
      it.step()
    } catch (e) {
      if (!(e instanceof AmosError)) throw e
      it.errCode = 1
      it.skipToStmtEnd()
    }
    return 'jumped'
  },
  error(it) {
    throw new AmosError(`Error ${it.evalInt()}`)
  },
  resume(it) {
    it.inError = false
    if (it.atStmtEnd()) {
      if (!it.errStmt) throw new AmosError('Resume without error')
      it.setPc(it.errStmt)
      return 'jumped'
    }
    it.jumpLabel(it.parseLabelTarget())
    return 'jumped'
  },
  'resume next'(it) {
    it.inError = false
    if (!it.errNext) throw new AmosError('Resume without error')
    it.setPc(it.errNext)
    return 'jumped'
  },
  'resume label'(it) {
    it.inError = false
    it.jumpLabel(it.parseLabelTarget())
    return 'jumped'
  },

  // ---- misc ----
  randomize(it) {
    it.seedRandom(it.evalInt())
  },
  degree(it) {
    it.degrees = true
  },
  radian(it) {
    it.degrees = false
  },
  wait(it) {
    it.io.wait?.(it.evalInt())
  },
  'wait key'(it) {
    it.io.waitKey?.()
  },
  'wait vbl'(it) {
    it.io.wait?.(1)
  },
  'set tab'(it) {
    it.tabWidth = Math.max(1, it.evalInt())
  },
  timer(it) {
    it.expectOp('=')
    it.evalInt() // TODO: writable Timer needs runtime clock support
  },
  end(it) {
    it.halt('ended')
    return 'jumped'
  },
  stop(it) {
    it.halt('stopped')
    return 'jumped'
  },
  edit(it) {
    it.halt('ended')
    return 'jumped'
  },
  direct(it) {
    it.halt('ended')
    return 'jumped'
  },
  'break on': () => {},
  'break off': () => {},
}

// ---- functions ------------------------------------------------------------

function arity(args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new AmosError('wrong number of arguments')
}

const toAngle = (it: Interp, v: number): number => (it.degrees ? (v * Math.PI) / 180 : v)
const fromAngle = (it: Interp, v: number): number => (it.degrees ? (v * 180) / Math.PI : v)

export const FUNCS: Record<string, Func> = {
  // math
  abs(_, a) {
    arity(a, 1)
    const v = a[0]!
    if (v.k === 'str') throw new AmosError('Type mismatch')
    return v.k === 'int' ? VI(Math.abs(v.n)) : VF(Math.abs(v.n))
  },
  sgn(_, a) {
    arity(a, 1)
    return VI(Math.sign(num(a[0]!)))
  },
  int(_, a) {
    arity(a, 1)
    return VI(Math.floor(num(a[0]!)))
  },
  sqr(_, a) {
    arity(a, 1)
    return VF(Math.sqrt(num(a[0]!)))
  },
  exp(_, a) {
    arity(a, 1)
    return VF(Math.exp(num(a[0]!)))
  },
  ln(_, a) {
    arity(a, 1)
    return VF(Math.log(num(a[0]!)))
  },
  log(_, a) {
    arity(a, 1)
    return VF(Math.log10(num(a[0]!)))
  },
  sin(it, a) {
    arity(a, 1)
    return VF(Math.sin(toAngle(it, num(a[0]!))))
  },
  cos(it, a) {
    arity(a, 1)
    return VF(Math.cos(toAngle(it, num(a[0]!))))
  },
  tan(it, a) {
    arity(a, 1)
    return VF(Math.tan(toAngle(it, num(a[0]!))))
  },
  asin(it, a) {
    arity(a, 1)
    return VF(fromAngle(it, Math.asin(num(a[0]!))))
  },
  acos(it, a) {
    arity(a, 1)
    return VF(fromAngle(it, Math.acos(num(a[0]!))))
  },
  atan(it, a) {
    arity(a, 1)
    return VF(fromAngle(it, Math.atan(num(a[0]!))))
  },
  hsin(_, a) {
    arity(a, 1)
    return VF(Math.sinh(num(a[0]!)))
  },
  hcos(_, a) {
    arity(a, 1)
    return VF(Math.cosh(num(a[0]!)))
  },
  htan(_, a) {
    arity(a, 1)
    return VF(Math.tanh(num(a[0]!)))
  },
  'pi#': (_, a) => {
    arity(a, 0)
    return VF(Math.PI)
  },
  rnd(it, a) {
    arity(a, 1)
    const n = int(a[0]!)
    return VI(n > 0 ? Math.floor(it.random() * (n + 1)) : 0)
  },
  max(_, a) {
    arity(a, 2)
    const [x, y] = [a[0]!, a[1]!]
    if (x.k === 'str' || y.k === 'str') return VS(str(x) > str(y) ? str(x) : str(y))
    if (x.k === 'int' && y.k === 'int') return VI(Math.max(x.n, y.n))
    return VF(Math.max(x.n, y.n))
  },
  min(_, a) {
    arity(a, 2)
    const [x, y] = [a[0]!, a[1]!]
    if (x.k === 'str' || y.k === 'str') return VS(str(x) < str(y) ? str(x) : str(y))
    if (x.k === 'int' && y.k === 'int') return VI(Math.min(x.n, y.n))
    return VF(Math.min(x.n, y.n))
  },

  // strings
  len(_, a) {
    arity(a, 1)
    return VI(str(a[0]!).length)
  },
  'chr$'(_, a) {
    arity(a, 1)
    return VS(String.fromCharCode(int(a[0]!) & 0xffff))
  },
  asc(_, a) {
    arity(a, 1)
    return VI(str(a[0]!).charCodeAt(0) || 0)
  },
  'str$'(_, a) {
    arity(a, 1)
    const v = a[0]!
    if (v.k === 'str') throw new AmosError('Type mismatch')
    return VS(display(v))
  },
  val(_, a) {
    arity(a, 1)
    const s = str(a[0]!).trim()
    const hex = /^([+-]?)\$([0-9a-f]+)/i.exec(s)
    if (hex) return VI(parseInt(hex[1] + hex[2]!, 16))
    const bin = /^([+-]?)%([01]+)/.exec(s)
    if (bin) return VI(parseInt(bin[1] + bin[2]!, 2))
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s)
    if (!m) return VI(0)
    const n = parseFloat(m[0])
    return /[.eE]/.test(m[0]) ? VF(n) : VI(n)
  },
  'left$'(_, a) {
    arity(a, 2)
    return VS(str(a[0]!).slice(0, Math.max(0, int(a[1]!))))
  },
  'right$'(_, a) {
    arity(a, 2)
    const n = Math.max(0, int(a[1]!))
    const s = str(a[0]!)
    return VS(n === 0 ? '' : s.slice(-n))
  },
  'mid$'(_, a) {
    arity(a, 2, 3)
    const s = str(a[0]!)
    const from = Math.max(1, int(a[1]!)) - 1
    const n = a.length === 3 ? Math.max(0, int(a[2]!)) : s.length - from
    return VS(s.slice(from, from + n))
  },
  instr(_, a) {
    arity(a, 2, 3)
    const s = str(a[0]!)
    const sub = str(a[1]!)
    const from = a.length === 3 ? Math.max(1, int(a[2]!)) - 1 : 0
    return VI(s.indexOf(sub, from) + 1)
  },
  'space$'(_, a) {
    arity(a, 1)
    return VS(' '.repeat(Math.max(0, int(a[0]!))))
  },
  'string$'(_, a) {
    arity(a, 2)
    const s = str(a[0]!)
    return VS((s[0] ?? ' ').repeat(Math.max(0, int(a[1]!))))
  },
  'upper$'(_, a) {
    arity(a, 1)
    return VS(str(a[0]!).toUpperCase())
  },
  'lower$'(_, a) {
    arity(a, 1)
    return VS(str(a[0]!).toLowerCase())
  },
  'flip$'(_, a) {
    arity(a, 1)
    return VS([...str(a[0]!)].reverse().join(''))
  },
  'bin$'(_, a) {
    arity(a, 1, 2)
    const s = (int(a[0]!) >>> 0).toString(2)
    const digits = a.length === 2 ? int(a[1]!) : s.length
    return VS('%' + s.slice(-digits).padStart(digits, '0'))
  },
  'hex$'(_, a) {
    arity(a, 1, 2)
    const s = (int(a[0]!) >>> 0).toString(16).toUpperCase()
    const digits = a.length === 2 ? int(a[1]!) : s.length
    return VS('$' + s.slice(-digits).padStart(digits, '0'))
  },

  // misc
  at(it, a) {
    arity(a, 2)
    // returns a cursor-positioning escape; headless we just move the column
    const x = int(a[0]!)
    const y = int(a[1]!)
    it.io.locate?.(x, y)
    if (x >= 0) it.col = x
    return VS('')
  },
  true: (_, a) => {
    arity(a, 0)
    return VI(-1)
  },
  false: (_, a) => {
    arity(a, 0)
    return VI(0)
  },
  timer(it, a) {
    arity(a, 0)
    return VI(it.io.timer?.() ?? 0)
  },
  'inkey$'(it, a) {
    arity(a, 0)
    return VS(it.io.inkey?.() ?? '')
  },
  // Param is a raw register: reading it with the wrong type suffix after a
  // skipped instruction is common, so coerce leniently instead of erroring
  param(it, a) {
    arity(a, 0)
    return VI(it.lastParam.k === 'str' ? 0 : int(it.lastParam))
  },
  'param#'(it, a) {
    arity(a, 0)
    return VF(it.lastParam.k === 'str' ? 0 : num(it.lastParam))
  },
  'param$'(it, a) {
    arity(a, 0)
    return VS(it.lastParam.k === 'str' ? it.lastParam.s : '')
  },
  errtrap(it, a) {
    arity(a, 0)
    return VI(it.errCode)
  },
  free: (_, a) => {
    arity(a, 0)
    return VI(1_000_000)
  },
  'chip free': (_, a) => {
    arity(a, 0)
    return VI(1_000_000)
  },
  'fast free': (_, a) => {
    arity(a, 0)
    return VI(1_000_000)
  },
}

export { tokAt }
