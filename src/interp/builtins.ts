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

/** ValRout-style number parsing, shared by =Val and Input */
export function parseAmosNumber(sIn: string): Value {
  const s = sIn.replace(/ /g, '')
  const hex = /^([+-]?)\$([0-9a-f]+)/i.exec(s)
  if (hex) return VI(parseInt(hex[1] + hex[2]!, 16))
  const bin = /^([+-]?)%([01]+)/.exec(s)
  if (bin) return VI(parseInt(bin[1] + bin[2]!, 2))
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s)
  if (!m) return VI(0)
  const n = parseFloat(m[0])
  return /[.eE]/.test(m[0]) ? VF(n) : VI(n)
}

function inputAssign(target: { type: number; set(v: Value): void }, raw: string): void {
  if (target.type === 2) target.set(VS(raw))
  else target.set(parseAmosNumber(raw))
}

/**
 * Print Using (ssprint/us* in +ILib.s): '#' digit slots (space-padded,
 * right-aligned before '.', left-aligned after), '-' sign-if-negative,
 * '+' always-sign, other characters literal; '~' slots take string
 * characters. One expression per Using.
 */
export function formatUsing(fmt: string, v: Value, it: Interp): string {
  if (v.k === 'str') {
    let si = 0
    return fmt.replace(/~/g, () => v.s[si++] ?? ' ')
  }
  const text = it.formatValue(v).trim()
  const neg = text.startsWith('-')
  const digits = (neg ? text.slice(1) : text).split('.')
  const dInt = digits[0]!
  const dFrac = digits[1] ?? ''
  const dot = fmt.indexOf('.')
  const left = dot < 0 ? fmt : fmt.slice(0, dot)
  const hasSignSlot = /[+-]/.test(left)
  // digits fill '#' slots right-to-left; the sign joins the stream when
  // there is no explicit sign slot
  const stream = (hasSignSlot ? dInt : (neg ? '-' : '') + dInt).split('')
  let out = ''
  for (let i = left.length - 1; i >= 0; i--) {
    const c = left[i]!
    if (c === '#') out = (stream.pop() ?? ' ') + out
    else if (c === '-') out = (neg ? '-' : ' ') + out
    else if (c === '+') out = (neg ? '-' : '+') + out
    else out = c + out
  }
  if (stream.length > 0) out = stream.join('') + out // overflow: emit anyway
  if (dot >= 0) {
    out += '.'
    let fi = 0
    for (let i = dot + 1; i < fmt.length; i++) {
      if (fmt[i] === '#') out += dFrac[fi++] ?? '0'
      else out += fmt[i]!
    }
  }
  return out
}

/** Rol/Ror width,variable — rotate within b/w/l */
function rolror(width: number, left: boolean): Instr {
  return (it) => {
    const n = it.evalInt() % width
    it.expect(',')
    const tg = it.parseTarget()
    const v = int(tg.get())
    const mask = width === 32 ? -1 : (1 << width) - 1
    const x = v & mask
    const r = left ? ((x << n) | (x >>> (width - n))) & mask : ((x >>> n) | (x << (width - n))) & mask
    tg.set(VI((v & ~mask) | r))
  }
}

/** functions that parse their own arguments */
export const RAWFUNCS: Record<string, (it: Interp) => Value> = {
  match(it) {
    // Match(A(0),value): binary search of a sorted array; negative
    // -closest when not found
    it.expect('(')
    const arr = it.parseArrayRef()
    it.expect(',')
    const v = it.evalExpr()
    it.expect(')')
    let lo = 0
    let hi = arr.data.length - 1
    let closest = 0
    const cmp = (a: Value): number => {
      if (a.k === 'str' || v.k === 'str') {
        const x = str(a)
        const y = str(v)
        return x < y ? -1 : x > y ? 1 : 0
      }
      return a.n - v.n
    }
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const c = cmp(arr.data[mid]!)
      closest = mid
      if (c === 0) return VI(mid)
      if (c < 0) lo = mid + 1
      else hi = mid - 1
    }
    return VI(closest === 0 ? -1 : -closest)
  },
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
        it.write('\x09') // sp12: a literal TAB, interpreted by the console
        nl = false
        continue
      }
      if (it.nm() === 'using') {
        // Using formats exactly one following expression (sp11)
        it.advance()
        const fmt = it.evalStr()
        it.accept(';')
        it.write(formatUsing(fmt, it.evalExpr(), it))
        nl = true
        continue
      }
      it.write(it.formatValue(it.evalExpr()))
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
    let prompt = '? ' // promptless Input prints "? " (IInp1)
    if (it.tok()?.kind === 'str') {
      // prompt may be a full string expression: Input "GUESS"+Str$(N);T
      prompt = it.evalStr()
      it.accept(';') || it.accept(',')
    }
    const targets = [it.parseTarget()]
    while (it.accept(',')) targets.push(it.parseTarget())
    const line = it.io.input ? it.io.input(prompt) : ''
    if (line === undefined) {
      it.block({ type: 'input', prompt }, true)
      return 'jumped'
    }
    const parts = targets.length > 1 ? line.split(',') : [line]
    targets.forEach((tg, i) => inputAssign(tg, parts[i] ?? ''))
  },
  'line input'(it) {
    let prompt = '? '
    if (it.tok()?.kind === 'str') {
      prompt = it.evalStr()
      it.accept(';') || it.accept(',')
    }
    const line = it.io.input ? it.io.input(prompt) : ''
    if (line === undefined) {
      it.block({ type: 'input', prompt }, true)
      return 'jumped'
    }
    inputAssign(it.parseTarget(), line)
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
    // InFor performs NO initial test: the body always runs at least once,
    // the comparison happens at Next. (c.after remains for Exit.)
    void c
    const top = it.loops[it.loops.length - 1]
    const frame = {
      t: 'for' as const,
      tok,
      body: it.afterCurrentStatement(),
      end: c.after,
      varKey: key,
      varT: vt,
      step,
      limit,
    }
    if (top?.tok === tok) it.loops[it.loops.length - 1] = frame
    else it.loops.push(frame)
  },
  next(it) {
    // InNext ignores which variable is written after Next — it always
    // operates on the innermost loop (the token is skipped cosmetically)
    if (it.tok()?.kind === 'var') it.advance()
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
    if (top?.tok !== tok) {
      const c = it.ctrlOf(tok)
      it.loops.push({
        t: 'repeat',
        tok,
        body: it.afterCurrentStatement(),
        end: c.kind === 'loopStart' ? c.after : { li: -1, ti: -1 },
      })
    }
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
      if (!have) it.loops.push({ t: 'while', tok, body: it.afterCurrentStatement(), end: c.after })
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
    if (top?.tok !== tok) {
      const c = it.ctrlOf(tok)
      it.loops.push({
        t: 'do',
        tok,
        body: it.afterCurrentStatement(),
        end: c.kind === 'loopStart' ? c.after : { li: -1, ti: -1 },
      })
    }
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
    it.jumpLabel(it.parseLabelTarget(), true) // LGoto unwinds
    return 'jumped'
  },
  gosub(it) {
    const name = it.parseLabelTarget()
    it.gosubs.push({ addr: it.afterCurrentStatement(), loopBase: it.loops.length })
    it.jumpLabel(name)
    return 'jumped'
  },
  return(it) {
    const frame = it.frames[it.frames.length - 1]!
    if (it.gosubs.length <= frame.gosubBase) throw new AmosError('Return without Gosub')
    const entry = it.gosubs.pop()!
    it.loops.length = Math.min(it.loops.length, entry.loopBase) // one stack in the original
    it.setPc(entry.addr)
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
    if (kind === 'gosub') it.gosubs.push({ addr: it.afterCurrentStatement(), loopBase: it.loops.length })
    it.jumpLabel(target, kind === 'goto')
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
      tg.set(it.readDataItem(tg.type))
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
    const n = it.evalInt()
    if (n > 0) it.block({ type: 'wait', until: it.tick + n })
  },
  'wait key'(it) {
    it.block({ type: 'waitKey' })
  },
  'wait vbl'(it) {
    it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
  },
  'multi wait'(it) {
    it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
  },
  'set tab'(it) {
    it.tabWidth = Math.max(1, it.evalInt())
  },
  timer(it) {
    it.expectOp('=')
    it.tick = it.evalInt()
  },
  proc(it) {
    // explicit procedure call: Proc NAME[args]
    const t = it.tok()
    if (t === undefined || !('name' in t)) throw new AmosError('procedure name expected')
    it.advance()
    it.callProc(t.name.toLowerCase(), it.parseProcArgs())
    return 'jumped'
  },
  'mid$'(it) {
    // assignment form: Mid$(A$,p[,n]) = expr — overwrite part of a string
    it.expect('(')
    const tg = it.parseTarget()
    it.expect(',')
    const p = Math.max(1, it.evalInt()) - 1
    const n = it.accept(',') ? it.evalInt() : -1
    it.expect(')')
    it.expectOp('=')
    let repl = str(it.evalExpr())
    const s = str(tg.get())
    const len = n < 0 ? repl.length : Math.min(n, repl.length)
    repl = repl.slice(0, Math.min(len, Math.max(0, s.length - p)))
    tg.set(VS(s.slice(0, p) + repl + s.slice(p + repl.length)))
  },
  every(it) {
    // Every n Gosub label / Every n Proc NAME (InEvery)
    const n = it.evalInt()
    if (n <= 0 || n > 32767) throw new AmosError('function call error')
    const kind = it.nm()
    if (kind !== 'gosub' && kind !== 'proc') throw new AmosError('Every needs Gosub or Proc')
    it.advance()
    const t = it.tok()
    if (t === undefined || !('name' in t)) throw new AmosError('label expected')
    it.advance()
    it.every = { ticks: n, kind, target: t.name.toLowerCase(), nextFire: it.tick + n, running: false, on: true }
  },
  'every on'(it) {
    if (it.every) {
      it.every.on = true
      it.every.nextFire = it.tick + it.every.ticks
    }
  },
  'every off'(it) {
    if (it.every) it.every.on = false
  },
  'def fn'(it) {
    // Def Fn NAME[(params)] = expr — recorded, evaluated by Fn
    const t = it.tok()
    if (t?.kind !== 'var' && t?.kind !== 'procCall' && t?.kind !== 'labelRef') {
      throw new AmosError('function name expected')
    }
    it.advance()
    const params: Array<{ key: string; type: number }> = []
    if (it.accept('(')) {
      for (;;) {
        const p = it.tok()
        if (p?.kind !== 'var') throw new AmosError('parameter expected')
        it.advance()
        params.push({ key: varKey(p.name, p.flags), type: varType(p.flags) })
        if (it.accept(',')) continue
        it.expect(')')
        break
      }
    }
    it.expectOp('=')
    it.userFns.set(varKey(t.name, 'flags' in t ? t.flags : 0), {
      params,
      body: { li: it.pc.li, ti: it.pc.ti },
    })
    it.skipToStmtEnd()
  },
  sort(it) {
    // Sort A(0): ascending, in place, int/float/string arrays
    const arr = it.parseArrayRef()
    arr.data.sort((a, b) => {
      if (a.k === 'str' || b.k === 'str') return str(a) < str(b) ? -1 : str(a) > str(b) ? 1 : 0
      return a.n - b.n
    })
  },
  bset(it) {
    const n = it.evalInt()
    it.expect(',')
    const tg = it.parseTarget()
    tg.set(VI(int(tg.get()) | (1 << (n & 31))))
  },
  bclr(it) {
    const n = it.evalInt()
    it.expect(',')
    const tg = it.parseTarget()
    tg.set(VI(int(tg.get()) & ~(1 << (n & 31))))
  },
  bchg(it) {
    const n = it.evalInt()
    it.expect(',')
    const tg = it.parseTarget()
    tg.set(VI(int(tg.get()) ^ (1 << (n & 31))))
  },
  'rol.b': rolror(8, true),
  'rol.w': rolror(16, true),
  'rol.l': rolror(32, true),
  'ror.b': rolror(8, false),
  'ror.w': rolror(16, false),
  'ror.l': rolror(32, false),
  'clear key'(it) {
    void it
    it.inp.keyQueue.length = 0
  },
  'key$'(it) {
    // Set Key$(n)="def": store a function-key definition (+Lib.s:13757)
    it.expect('(')
    const n = it.evalInt()
    it.expect(')')
    it.expectOp('=')
    const def = it.evalStr()
    if (n < 1 || n > 20) throw new AmosError('function call error')
    while (it.inp.funcKeys.length < n) it.inp.funcKeys.push('')
    it.inp.funcKeys[n - 1] = def
  },
  lprint(it) {
    // printer output — evaluated and discarded
    while (!it.atStmtEnd()) {
      if (it.accept(';') || it.accept(',')) continue
      it.evalExpr()
    }
  },
  fix(it) {
    // InFix: n 0-15 = digits after the point; >=16 = proportional
    // default; negative = exponent notation with |n| digits
    const n = it.evalInt()
    const mag = Math.abs(n)
    it.fixExp = n < 0
    it.fixDigits = mag >= 16 ? -1 : mag
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
    const v = num(a[0]!)
    if (v < 0) throw new AmosError('function call error') // FlPos
    return VF(Math.sqrt(v))
  },
  exp(_, a) {
    arity(a, 1)
    return VF(Math.exp(num(a[0]!)))
  },
  ln(_, a) {
    arity(a, 1)
    const v = num(a[0]!)
    if (v < 0) throw new AmosError('function call error')
    return VF(Math.log(v))
  },
  log(_, a) {
    arity(a, 1)
    const v = num(a[0]!)
    if (v < 0) throw new AmosError('function call error')
    return VF(Math.log10(v))
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
  // spec "15" — the same angle-converting argument as Sin/Cos/Tan
  hsin(it, a) {
    arity(a, 1)
    return VF(Math.sinh(toAngle(it, num(a[0]!))))
  },
  hcos(it, a) {
    arity(a, 1)
    return VF(Math.cosh(toAngle(it, num(a[0]!))))
  },
  htan(it, a) {
    arity(a, 1)
    return VF(Math.tanh(toAngle(it, num(a[0]!))))
  },
  'pi#': (_, a) => {
    arity(a, 0)
    return VF(Math.PI)
  },
  rnd(it, a) {
    arity(a, 1)
    return VI(it.rndInt(int(a[0]!)))
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
    const n = int(a[0]!)
    if (n < 0 || n > 255) throw new AmosError('function call error') // FnChr
    return VS(String.fromCharCode(n))
  },
  asc(_, a) {
    arity(a, 1)
    return VI(str(a[0]!).charCodeAt(0) || 0)
  },
  'str$'(it, a) {
    arity(a, 1)
    const v = a[0]!
    if (v.k === 'str') throw new AmosError('Type mismatch')
    return VS(it.formatValue(v))
  },
  val(_, a) {
    arity(a, 1)
    return parseAmosNumber(str(a[0]!)) // ValRout, spaces skipped anywhere
  },
  'left$'(_, a) {
    arity(a, 2)
    const n = int(a[1]!)
    if (n < 0) throw new AmosError('function call error')
    return VS(str(a[0]!).slice(0, n))
  },
  'right$'(_, a) {
    arity(a, 2)
    const n = int(a[1]!)
    if (n < 0) throw new AmosError('function call error')
    const s = str(a[0]!)
    return VS(n === 0 ? '' : s.slice(-n))
  },
  'mid$'(_, a) {
    arity(a, 2, 3)
    const s = str(a[0]!)
    const p = int(a[1]!)
    if (p < 0) throw new AmosError('function call error') // RFnMid
    const from = p === 0 ? 0 : p - 1
    const n = a.length === 3 ? int(a[2]!) : 0xffff
    if (n < 0) throw new AmosError('function call error')
    return VS(s.slice(from, from + n))
  },
  instr(_, a) {
    arity(a, 2, 3)
    const s = str(a[0]!)
    const needle = str(a[1]!)
    let from = 0
    if (a.length === 3) {
      const start = int(a[2]!)
      if (start < 0) throw new AmosError('function call error') // FnInstr3
      from = start === 0 ? 0 : start - 1
    }
    if (needle === '') return VI(0) // InstrFind .if11
    return VI(s.indexOf(needle, from) + 1)
  },
  'space$'(_, a) {
    arity(a, 1)
    const n = int(a[0]!)
    if (n < 0) throw new AmosError('function call error') // RString
    return VS(' '.repeat(n))
  },
  'string$'(_, a) {
    arity(a, 2)
    const s = str(a[0]!)
    const n = int(a[1]!)
    if (n < 0) throw new AmosError('function call error')
    if (s === '') return VS('') // FnString: empty source -> empty
    return VS(s[0]!.repeat(n))
  },
  // a-z/A-Z only — Latin-1 accents pass through untouched
  'upper$'(_, a) {
    arity(a, 1)
    return VS(str(a[0]!).replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32)))
  },
  'lower$'(_, a) {
    arity(a, 1)
    return VS(str(a[0]!).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)))
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
    return VI(Math.floor(it.tick))
  },
  'inkey$'(it, a) {
    arity(a, 0)
    const k = it.inp.keyQueue.shift()
    if (k === undefined) return VS('')
    it.inp.lastScan = k.scan
    return VS(k.ch)
  },
  'key$'(it, a) {
    // FnKeyD +Lib.s:13757: Key$(n) is the function-key DEFINITION string
    // (set by Key$(n)="..."), NOT a keyboard read
    arity(a, 1)
    const n = int(a[0]!)
    if (n < 1 || n > 20) throw new AmosError('function call error')
    return VS(it.inp.funcKeys[n - 1] ?? '')
  },
  scancode(it, a) {
    // FnScancode +Lib.s:13631: returns the last scancode, then clears it
    arity(a, 0)
    const s = it.inp.lastScan
    it.inp.lastScan = 0
    return VI(s)
  },
  'key state'(it, a) {
    // FnKeyState +Lib.s:13649: n & $7F indexes the key matrix; n >= 128 errors
    arity(a, 1)
    const n = int(a[0]!)
    if (n >= 128 || n < 0) throw new AmosError('function call error')
    return VI(it.inp.keys.has(n & 0x7f) ? -1 : 0)
  },
  'x mouse'(it, a) {
    arity(a, 0)
    return VI(it.inp.mouseX)
  },
  'y mouse'(it, a) {
    arity(a, 0)
    return VI(it.inp.mouseY)
  },
  'mouse key'(it, a) {
    arity(a, 0)
    return VI(it.inp.mouseK)
  },
  'mouse click'(it, a) {
    // MRout +W.s:10627: bitmask of buttons newly pressed since the last
    // read (edge-detected vs the stored old state, then latched)
    arity(a, 0)
    const pressed = it.inp.mouseK & ~it.inp.mouseClickOld & 7
    it.inp.mouseClickOld = it.inp.mouseK
    return VI(pressed)
  },
  'mouse zone'(it, a) {
    arity(a, 0)
    return VI(0) // zones arrive with the object/zone milestone
  },
  joy(it, a) {
    arity(a, 1)
    return VI(it.inp.joy)
  },
  jup(it, a) {
    arity(a, 1)
    return VI(it.inp.joy & 1 ? -1 : 0)
  },
  jdown(it, a) {
    arity(a, 1)
    return VI(it.inp.joy & 2 ? -1 : 0)
  },
  jleft(it, a) {
    arity(a, 1)
    return VI(it.inp.joy & 4 ? -1 : 0)
  },
  jright(it, a) {
    arity(a, 1)
    return VI(it.inp.joy & 8 ? -1 : 0)
  },
  fire(it, a) {
    arity(a, 1)
    return VI(it.inp.joy & 16 ? -1 : 0)
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
  errn(it, a) {
    arity(a, 0)
    return VI(it.errCode)
  },
  'err$'(it, a) {
    arity(a, 1)
    void a
    return VS(it.errCode !== 0 ? 'error' : '')
  },
  'repeat$'(_, a) {
    arity(a, 2)
    const n = int(a[1]!)
    if (n < 0) throw new AmosError('function call error')
    return VS(str(a[0]!).repeat(n))
  },
  'command line$'(_, a) {
    arity(a, 0)
    return VS('')
  },
  'display height'(_, a) {
    arity(a, 0)
    return VI(283) // PAL visible lines
  },
  'tab$': (_, a) => {
    arity(a, 0)
    return VS('\x09')
  },
  'cleft$': (_, a) => {
    arity(a, 0)
    return VS('\x1d')
  },
  'cright$': (_, a) => {
    arity(a, 0)
    return VS('\x1c')
  },
  'cup$': (_, a) => {
    arity(a, 0)
    return VS('\x1e')
  },
  'cdown$': (_, a) => {
    arity(a, 0)
    return VS('\x1f')
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
