import type { Tok } from '../tokens/stream'
import type { Addr } from './prescan'
import { varKey } from './prescan'
import type { Interp } from './interp'
import { AMOS_ERRORS, AmosError, amosErrorCode, funcCall, int, num, str, truthy, varType, VF, VI, VS } from './values'
import type { Value } from './values'
import { MAX_PORT, PORT_MOUSE } from './gameport'
import { ascToFloat } from '../tokens/numfmt'
import { ED_RUN_MESSAGES } from './errors.gen'

/**
 * Instruction handlers. Called with the cursor just past the instruction
 * token; they parse their own arguments. Return 'jumped' after moving the
 * pc to a new statement (skips the statement-boundary check).
 */
export type Instr = (it: Interp, tok: Tok, addr: Addr) => void | 'jumped'
export type Func = (it: Interp, args: Value[]) => Value


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

/**
 * declong (+ILib.s:7192), reading into a 32-bit accumulator the way the 68000
 * does. The high word is multiplied on its own and checked with `tst d0`,
 * which assembles WORD-sized, so a high word reaching 6554 overflows; `bcs`
 * then catches the x10 carrying out of 32 bits, and `bmi` rejects a total that
 * has turned negative. The digit add itself is allowed to wrap, so
 * Val("4294967297") is 1 rather than an error. minichr (+ILib.s:7166) drops
 * spaces, so "1 2 3" reads as 123.
 *
 * @param d0 the running total, non-zero only on the fall-through from binLong
 * @returns the value, or null when the number is out of range
 */
function decLong(s: string, d0 = 0): number | null {
  for (const ch of s) {
    if (ch === ' ') continue
    const d = ch.charCodeAt(0) - 48
    if (d < 0 || d > 9) break
    const hi = (d0 >>> 16) * 10
    if (hi > 0xffff) return null
    const t = ((hi << 16) >>> 0) + (d0 & 0xffff) * 10
    if (t > 0xffff_ffff) return null
    d0 = (t + d) >>> 0
    if (d0 & 0x8000_0000) return null
  }
  return d0 | 0
}

/**
 * hexalong (+ILib.s:7226): `cmp #9,d3 / beq ddh2` counts digits and gives up
 * on the ninth, so $FFFFFFFF reads but $0FFFFFFFF is 0 even though it fits.
 * There is no carry test, only that count. minichr2 (+ILib.s:7179) has no
 * space skip either, unlike the decimal and binary readers, so Val("$1 0")
 * is 1.
 */
function hexaLong(s: string): number | null {
  let d0 = 0
  let n = 0
  for (const ch of s) {
    const d = parseInt(ch, 16)
    if (Number.isNaN(d)) break
    d0 = ((d0 << 4) | d) >>> 0
    if (++n === 9) return null
  }
  return d0 | 0
}

/**
 * binlong (+ILib.s:7248): `roxl.l #1,d0 / bcs.s ddh2` rejects a 1 shifted off
 * bit 31, so the limit is the value and leading zeros cost nothing. The digit
 * counter is not a second limit: `cmp.w #33,d3 / beq ddh1` lands in declong's
 * loop, not its error exit, so a 33rd digit switches the reader to decimal and
 * keeps the total it already has.
 */
function binLong(s: string): number | null {
  let d0 = 0
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === ' ') continue
    if (ch !== '0' && ch !== '1') break
    if (d0 & 0x8000_0000) return null
    d0 = ((d0 << 1) | (ch === '1' ? 1 : 0)) >>> 0
    if (++n === 33) return decLong(s.slice(i + 1), d0)
  }
  return d0 | 0
}

/** ValRout-style number parsing, shared by =Val and Input */
export function parseAmosNumber(sIn: string): Value {
  // val1/val1c (+ILib.s:7026): spaces are skipped before the sign and again
  // before the radix character, and only one sign is taken
  const lead = /^ *([+-]?) */.exec(sIn)!
  const neg = lead[1] === '-'
  const rest = sIn.slice(lead[0].length)
  if (rest[0] === '$' || rest[0] === '%') {
    // val8 (+ILib.s:7145) negates AFTER the reader, so the sign applies to
    // hex and binary too
    const n = rest[0] === '$' ? hexaLong(rest.slice(1)) : binLong(rest.slice(1))
    return VI(n === null ? 0 : neg ? -n : n)
  }
  const s = rest.replace(/ /g, '')
  const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s)
  if (!m) return VI(0)
  // val4 (+ILib.s:7093) branches on d3, which is set by a point or by an
  // exponent, never by the value, and the float arm goes through AscToFloat
  if (/[.eE]/.test(m[0])) return VF(ascToFloat((neg ? '-' : '') + m[0]))
  const n = decLong(m[0])
  return VI(n === null ? 0 : neg ? -n : n)
}

function inputAssign(target: { type: number; set(v: Value): void }, raw: string): void {
  if (target.type === 2) target.set(VS(raw))
  else target.set(parseAmosNumber(raw))
}

/**
 * InnPut (+ILib.s:4912), the loop Input and Line Input share.
 *
 * They differ by one byte, pushed at entry: InInput pushes `","` and
 * InLineInput pushes 0. That byte is the field separator Inn2 stops a string
 * copy at, so Line Input's zero means "copy to the end of the line" and one
 * variable eats the lot.
 *
 * Inn10 then reads the token after the variable. A comma there demands a
 * comma in the BUFFER too (`cmp.b #",",(a2)+`); when the buffer has run out
 * the routine prints InnEnc's "?" and goes back to ReInp for a whole fresh
 * line, which is why `Line Input A$,B$` reads two lines rather than failing.
 *
 * A statement that blocks part-way has already filled some variables, so the
 * progress is remembered against the statement's address: re-running it must
 * not read a second line into a variable that already has one.
 */
function readInputTargets(
  it: Interp,
  key: string,
  prompt: string,
  targets: { type: number; set(v: Value): void }[],
  sep: string,
): 'jumped' | void {
  const saved = it.inputProgress
  let done = saved !== null && saved.at === key ? saved.done : 0
  let fields: string[] = []
  while (done < targets.length) {
    if (fields.length === 0) {
      const line = it.io.input ? it.io.input(done === 0 ? prompt : '? ') : ''
      if (line === undefined) {
        it.inputProgress = { at: key, done }
        it.block({ type: 'input', prompt: done === 0 ? prompt : '? ' }, true)
        return 'jumped'
      }
      fields = sep === '' ? [line] : line.split(sep)
    }
    inputAssign(targets[done]!, fields.shift()!)
    done++
  }
  it.inputProgress = null
}

/**
 * Print Using (us1/us50 +ILib.s:5205-5362). String values: '~' emits the
 * next source char (space when exhausted), other chars literal. Numbers:
 * the integer part scans RIGHT-to-LEFT ('#' pulls a digit or a space, and
 * when there is no sign slot the sign is CONSUMED-AS-SPACE so a bare-'#'
 * negative loses its '-'; overflow digits are DROPPED, not emitted); the
 * fraction/exponent part after the first of '.'/';'/'^' scans left-to-right
 * ('#' a fractional digit or '0'; ';' a non-printing marker → space; '^'
 * the progressive E±ddd exponent field).
 */
export function formatUsing(fmt: string, v: Value, it: Interp): string {
  if (v.k === 'str') {
    let si = 0
    return fmt.replace(/~/g, () => v.s[si++] ?? ' ')
  }
  const text = it.formatValue(v).trim()
  const neg = text.startsWith('-')
  const [dInt, dFrac = ''] = (neg ? text.slice(1) : text).split('.') as [string, string?]
  // split the format at the first of '.' ';' '^'
  let split = fmt.length
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '.' || fmt[i] === ';' || fmt[i] === '^') {
      split = i
      break
    }
  }
  const left = fmt.slice(0, split)
  const hasSignSlot = /[+-]/.test(left)
  // integer part, right-to-left; digits exhausted → space; overflow dropped
  const stream = dInt.split('')
  let out = ''
  for (let i = left.length - 1; i >= 0; i--) {
    const c = left[i]!
    if (c === '#') out = (stream.pop() ?? ' ') + out
    else if (c === '-') out = (neg ? '-' : ' ') + out
    else if (c === '+') out = (neg ? '-' : '+') + out
    else out = c + out
  }
  // a bare '#' negative with no sign slot loses its sign (consumed as space)
  void hasSignSlot
  // fraction part, left-to-right ('#' a digit or '0'; ';' → space).
  // The '^' scientific-exponent form (us20) is not implemented — mantissa
  // normalisation makes it fiddly and unverified, so a '^' is left literal.
  let fi = 0
  for (let i = split; i < fmt.length; i++) {
    const c = fmt[i]!
    if (c === '#') out += dFrac[fi++] ?? '0'
    else if (c === ';') out += ' '
    else if (c === '.') out += '.'
    else out += c
  }
  return out
}

/** Rol/Ror width,variable — rotate within b/w/l */
/** functions that parse their own arguments */
export const RAWFUNCS: Record<string, (it: Interp) => Value> = {
  match(it) {
    /*
     * Match(A(0),value): a binary search of a sorted array (FnMatch
     * +ILib.s:4449).
     *
     * The miss is the part the port had wrong. When the halving loop runs
     * out (d6 reaches 0), di7 walks d5 FORWARD one element at a time until
     * it meets one that is not smaller, and di8 then answers `move.l d5,d3 /
     * addq.l #1,d3 / neg.l d3` — the negated insertion point, counted from
     * 1. The port answered the negated last midpoint it happened to probe,
     * which is not a position a caller can insert at.
     *
     * The types have to agree first. `cmp.b d2,d5 / beq.s di3 / subq.w #1,d5
     * / beq.s di2 / bpl TypeMis` converts between integer and float and
     * refuses a string against a number, where the port coerced both ends to
     * strings and compared those. TypeMis (+Lib.s:12872) is `moveq #34,d0 /
     * Rbra L_GoError`, so 34 with no 44 added.
     */
    it.expect('(')
    const arr = it.parseArrayRef()
    it.expect(',')
    const v = it.evalExpr()
    it.expect(')')
    const elemIsStr = arr.data.length > 0 && arr.data[0]!.k === 'str'
    if (elemIsStr !== (v.k === 'str')) throw new AmosError(AMOS_ERRORS[34]!, 34)
    let lo = 0
    let hi = arr.data.length - 1
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
      if (c === 0) return VI(mid)
      if (c < 0) lo = mid + 1
      else hi = mid - 1
    }
    // lo is the first index whose element is larger, which is where di7 stops
    return VI(-(lo + 1))
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
        // sp20 (+ILib.s:5104) copies the format into the 256-byte scratch at
        // Buffer+256 and guards it with `cmp #120,d2 / bcc FonCall`. The
        // comment beside it says "pas plus de 200 caracteres"; the branch says
        // 120, and the branch is what runs.
        if (fmt.length >= 120) funcCall()
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
  /*
   * Pen and Paper are not setters. InPen (+Lib.s:13317) and InPaper
   * (+Lib.s:13309) each `lea` a three-byte template --- ESC "P" "0" and ESC
   * "B" "0" --- and fall into WnPp (+Lib.s:13323), which is `add.b #"0",d3 /
   * move.b d3,2(a1)` and then prints it. That add is a BYTE, so the colour
   * reaches the console modulo 256: Pen 256 is Pen 0 and Pen 300 is Pen 44.
   * The range check is at the far end, in Pen and Paper (+W.s:14864, 14850),
   * and it is `cmp.w EcNbCol(a4),d1 / bcc PErr7` against the screen's own
   * colour count. Checking the number the program wrote instead of the byte
   * that survives the template refuses values AMOS accepts.
   */
  pen(it) {
    it.io.pen?.((((it.evalInt() + 48) & 0xff) - 48) | 0)
  },
  paper(it) {
    it.io.paper?.((((it.evalInt() + 48) & 0xff) - 48) | 0)
  },
  'curs on': () => {},
  'curs off': () => {},

  // ---- input ----
  input(it) {
    const key = `${it.pc.li}:${it.pc.ti}`
    let prompt = '? ' // promptless Input prints "? " (IInp1)
    if (it.tok()?.kind === 'str') {
      // prompt may be a full string expression: Input "GUESS"+Str$(N);T
      prompt = it.evalStr()
      if (!it.accept(';')) it.accept(',')
    }
    const targets = [it.parseTarget()]
    while (it.accept(',')) targets.push(it.parseTarget())
    return readInputTargets(it, key, prompt, targets, ',')
  },
  'line input'(it) {
    const key = `${it.pc.li}:${it.pc.ti}`
    let prompt = '? '
    if (it.tok()?.kind === 'str') {
      prompt = it.evalStr()
      if (!it.accept(';')) it.accept(',')
    }
    // InLineInput (+ILib.s:4834) pushes a zero separator, so one variable
    // takes the whole line and a second one needs a second line
    const targets = [it.parseTarget()]
    while (it.accept(',')) targets.push(it.parseTarget())
    return readInputTargets(it, key, prompt, targets, '')
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
  // Inc/Dec/Add (InInc/InDec/InAdd +ILib.s:4353-4394) operate on the
  // variable's long directly (addq.l/add.l), so integers wrap at 32 bits.
  //
  // None of the three reads the type FindVar leaves in d2, and there is no
  // float variant beside them the way FnStrE has FnStrF. That reads like a
  // float variable would have 1 added to its FFP pattern, whose low byte is
  // the excess-64 exponent, so `Inc A#` would double A#. It cannot happen:
  // VerVEnt (+Verif.s:1460) is `bsr VarA0 / tst.b d0 / bne VerType`, so a
  // non-integer target is a type error before the program runs and the
  // float arm of all three routines is unreachable. The arithmetic below is
  // this port's, for a case the library never has to answer.
  inc(it) {
    const tg = it.parseTarget()
    if (tg.type === 0) tg.set(VI((int(tg.get()) + 1) | 0))
    else tg.set(VF(num(tg.get()) + 1))
  },
  dec(it) {
    const tg = it.parseTarget()
    if (tg.type === 0) tg.set(VI((int(tg.get()) - 1) | 0))
    else tg.set(VF(num(tg.get()) - 1))
  },
  add(it) {
    const tg = it.parseTarget()
    it.expect(',')
    if (tg.type === 0) {
      const e = it.evalInt()
      let v = (int(tg.get()) + e) | 0
      if (it.accept(',')) {
        // InAdd4: the wrap checks are signed 32-bit, base first
        const base = it.evalInt() | 0
        it.expect('to')
        const top = it.evalInt() | 0
        if (v < base) v = top
        else if (v > top) v = base
      }
      tg.set(VI(v))
      return
    }
    let v = num(tg.get()) + it.evalNum()
    if (it.accept(',')) {
      const base = it.evalNum()
      it.expect('to')
      const top = it.evalNum()
      if (v < base) v = top
      else if (v > top) v = base
    }
    tg.set(VF(v))
  },
  swap(it) {
    const a = it.parseTarget()
    it.expect(',')
    const b = it.parseTarget()
    // InSwap (+ILib.s:4273) exchanges one longword and never compares the
    // types, but the check is not missing, it is earlier: VerSwap
    // (+Verif.s:867) keeps the first variable's type on the stack and ends
    // `cmp.w (sp)+,d2 / beq VerDP / bne VerType`.
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
    if (it.gosubs.length <= frame.gosubBase) throw new AmosError('Return without Gosub', 1)
    const entry = it.gosubs.pop()!
    it.loops.length = Math.min(it.loops.length, entry.loopBase) // one stack in the original
    it.setPc(entry.addr)
    return 'jumped'
  },
  pop(it) {
    // InPop +ILib.s:2435: discards the Gosub return AND every loop frame
    // opened since that Gosub (the "BUG si POP au milieu d'une boucle"
    // behaviour — a3 is restored to BasA3)
    const frame = it.frames[it.frames.length - 1]!
    if (it.gosubs.length <= frame.gosubBase) throw new AmosError('Pop without Gosub', 2)
    const entry = it.gosubs.pop()!
    it.loops.length = Math.min(it.loops.length, entry.loopBase)
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
  /**
   * NOTE: the closing `]` is OPTIONAL, and this is AMOS's quirk rather than a
   * leniency of ours. V1_EndProc (+Verif.s:1676) is five instructions —
   * `cmp.w #_TkBra1,(a6)+ / bne.s .Skip / bsr Ver_Expression / .Skip bra VerX`
   * — and never mentions `_TkBra2`. InEndProc (+ILib.s:2631) does the same at
   * run time: `cmp.w #_TkBra1,(a6) / bne.s EPro1 / bsr FnEProc`, then it
   * restores the caller's a6 off the stack, so anything left on the line is
   * never read. Programs saved with the bracket missing therefore verify,
   * save and run, and there is one in the corpus — EasyLife's Tabifier line
   * 268 and Tag_Editor line 605, both
   * `End Proc [Mui New("Cycle.mui",Tag Str$(...)+Ellong$(0))`. The token
   * stream ends `007c 007c 0000` where every other End Proc in the same file
   * ends `007c 007c 008c 0000`.
   *
   * `Pop Proc` three screens down in the same file does check
   * (`cmp.w #_TkBra2,(a6)+ / beq VerDP / bra VerSynt`, +Verif.s:2275-2277), so the
   * asymmetry is deliberate-looking but is only in one of the pair.
   */
  'end proc'(it) {
    if (it.accept('[')) {
      // write only the slot matching the return value's type (FnEProc)
      const v = it.evalExpr()
      if (v.k === 'str') it.paramStr = v.s
      else if (v.k === 'float') it.paramFloat = v.n
      else it.paramInt = v.n
      it.accept(']')
    }
    it.returnFromProc()
    return 'jumped'
  },
  /** Unlike End Proc, V1_PopProc (+Verif.s:2268) does require the `]`. */
  'pop proc'(it) {
    if (it.accept('[')) {
      const v = it.evalExpr()
      if (v.k === 'str') it.paramStr = v.s
      else if (v.k === 'float') it.paramFloat = v.n
      else it.paramInt = v.n
      it.expect(']')
    }
    it.returnFromProc()
    return 'jumped'
  },
  shared(it) {
    // InShared (+ILib.s:4177) does nothing at run time — Sha0 walks its own
    // argument list, steps over an optional "()", loops on a comma and
    // returns. It never touches a variable table, because the editor's Test
    // pass has already assigned the slots; the instruction only has to get
    // out of the way at run time.
    //
    // So `Shared` in the MAIN program is not the no-op it looks like here: the
    // names it lists are the main program's variables, and every procedure
    // that mentions one gets that slot. Treating it as Global is what
    // reproduces the observable behaviour. TURBO's Starfield demo does exactly
    // this — Dim, then `Shared AANTAL,X_AS(),SPEED()` at the top level, then
    // procedures using the arrays with no declaration of their own.
    const frame = it.frames[it.frames.length - 1]!
    const inProc = it.frames.length > 1
    do {
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('variable expected in Shared')
      it.advance()
      // "Global Y()" declares the ARRAY Y, not the scalar Y — AMOS keeps
      // them as separate variables, so the declaration has to as well or a
      // scalar parameter named Y is wrongly treated as global (worms).
      const isArray = it.accept('(')
      if (isArray) it.expect(')')
      const key = varKey(t.name, t.flags) + (isArray ? '()' : '')
      if (inProc) frame.shared.add(key)
      else it.globals.add(key)
    } while (it.accept(','))
  },
  global(it) {
    do {
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('variable expected in Global')
      it.advance()
      // an array declaration is a different variable from the scalar
      const isArray = it.accept('(')
      if (isArray) it.expect(')')
      it.globals.add(varKey(t.name, t.flags) + (isArray ? '()' : ''))
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
  /**
   * Restore, and Restore label.
   *
   * With a label, `InRs1` (+ILib.s:4715) demands the label be followed by a
   * Data statement and nothing else: `bsr GetLabel / beq LbNDef / move.l d0,a0
   * / cmp.w #_TkData,(a0)+ / bne.s InRs2`, and `InRs2 moveq #41,d0 / bra
   * RunErr` is error 41, "No data after this label". `LbNDef` is `moveq #40,d0`
   * (+ILib.s:2940), "Label not defined".
   *
   * "Followed by" is what `V1_StockLabel` stored, not the raw next word. It
   * skips the label, and on an empty rest of line walks on to the line after:
   * `tst.w (a0) / bne.s .N2 / tst.w 2(a0) / beq.s .N2 / addq.l #4,a0`,
   * commented "Pointe la ligne suivante si on peut" (+Verif.s:3435). So a
   * label alone on its line and Data on the next is legal, and `dataAt` walks
   * the same way before it looks.
   */
  restore(it) {
    if (it.atStmtEnd()) {
      it.restoreData({ li: 0, ti: 0 })
      return
    }
    const name = it.parseLabelTarget()
    const a = it.labelAddr(name)
    if (!a) throw new AmosError(`label not defined: ${name.toUpperCase()}`, 40)
    if (!it.dataAt(a)) throw new AmosError('No data after this label', 41)
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
      // NOT GetLabel. InOnError's OnEPrc path (+ILib.s:2076) reads the name
      // token straight out of the stream:
      //
      //	OnEPrc:	addq.l	#4,a6		step over the Proc keyword
      //		move.w	(a6)+,d0	the label-table offset
      //		move.b	(a6),d1 / ext.w d1 / lea 2(a6,d1.w),a6
      //		move.l	LabHaut(a5),a2
      //		move.l	0(a2,d0.w),OnErrLine(a5)
      //
      // It never looks at the token's TYPE, which matters because the editor
      // saves a procedure name here as a plain variable token ($0006), not as
      // _TkPro ($0012). Routing it through parseLabelTarget made
      // `On Error Proc OOPS` evaluate OOPS as an undefined variable and store
      // the handler as "0" — latent until an error actually fired, which in
      // AMOSPro_Examples Help_71 is a bad record number, reported as
      // "procedure not defined: 0" long after the line that broke it.
      it.errorHandler = { kind: 'proc', target: it.parseNameToken().toLowerCase() }
      return
    }
    it.errorHandler = null // bare On Error switches trapping off
  },
  trap(it) {
    // Trap <instruction>: run one statement, capturing any error's number
    // into Errtrap (a slot separate from Errn — RunErr's .ETrap path never
    // touches ErrorOn); InTrap +ILib.s:2010
    it.trapCode = 0
    try {
      it.step()
    } catch (e) {
      if (!(e instanceof AmosError)) throw e
      it.trapCode = amosErrorCode(e)
      it.skipToStmtEnd()
    }
    return 'jumped'
  },
  error(it) {
    /*
     * Error n (InError +Lib.s:11396): `cmp.l #256,d3 / bcs.s .skip / move.l
     * #255,d3`. The compare is unsigned, so it clamps a negative to 255 as
     * well as anything past the table, and the program's own On Error
     * handler sees 255 rather than a number no message exists for.
     */
    const raw = it.evalInt()
    const n = raw >>> 0 >= 256 ? 255 : raw
    throw new AmosError(AMOS_ERRORS[n] ?? `Error ${n}`, n)
  },
  resume(it) {
    it.inError = false
    it.unwindErrorHandler() // pop an On Error Proc handler frame
    if (it.atStmtEnd()) {
      if (!it.errStmt) throw new AmosError('Resume without error', 7)
      it.setPc(it.errStmt)
      return 'jumped'
    }
    it.jumpLabel(it.parseLabelTarget())
    return 'jumped'
  },
  'resume next'(it) {
    it.inError = false
    it.unwindErrorHandler()
    if (!it.errNext) throw new AmosError('Resume without error', 7)
    it.setPc(it.errNext)
    return 'jumped'
  },
  'resume label'(it) {
    // InResumeLabel (+ILib.s:1916) opens with `bsr Finie / beq.s ResL1`, so
    // the two forms do opposite things. With a label it only RECORDS one and
    // returns, leaving the rest of the handler to run; the BARE form is the
    // one that pops the procedure and jumps. The port had the named form
    // jumping immediately, which skipped whatever the handler did next.
    if (!it.atStmtEnd()) {
      // `tst.l OnErrLine(a5) / beq NoOnErr` then `tst.w ErrorChr(a5) / bpl
      // NoOnErr`: a handler has to be registered AND it has to be a
      // procedure, because bit 31 is what On Error Proc sets
      if (it.errorHandler === null || it.errorHandler.kind !== 'proc') {
        throw new AmosError(ED_RUN_MESSAGES[5]!, 5)
      }
      it.resumeLabel = it.parseLabelTarget()
      return
    }
    // ResL1 (+ILib.s:1934)
    if (!it.inError) throw new AmosError(ED_RUN_MESSAGES[7]!, 7)
    it.unwindErrorHandler()
    it.inError = false
    // `bclr #31,d0 / beq NoOnErr` tests the bit as it WAS, so a non-procedure
    // handler fails here too; `tst.l d0 / beq ResLNo` then catches the case
    // where no label was ever recorded
    if (it.errorHandler === null || it.errorHandler.kind !== 'proc') {
      throw new AmosError(ED_RUN_MESSAGES[5]!, 5)
    }
    const target = it.resumeLabel
    if (target === null) throw new AmosError(ED_RUN_MESSAGES[6]!, 6)
    it.resumeLabel = null
    it.jumpLabel(target)
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
    // InWait +Lib.s:2046: negative = function call error; Wait 0 enters
    // Wait_Event (2115), an endless Sys_WaitMul loop only a break exits
    const n = it.evalInt()
    if (n < 0) funcCall()
    if (n === 0) it.block({ type: 'wait', until: Infinity })
    else it.block({ type: 'wait', until: it.tick + n })
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
    // assignment form: Mid$(A$,p[,n]) = expr (InMid2/InMid3 +ILib.s:6531;
    // the 2-arg form's count is $FFFF, clamped by target and source)
    it.expect('(')
    const tg = it.parseTarget()
    it.expect(',')
    const p = it.evalInt()
    const n = it.accept(',') ? it.evalInt() : 0xffff
    it.expect(')')
    it.expectOp('=')
    midStore(tg, p, n, str(it.evalExpr()))
  },
  'left$'(it) {
    // Left$(A$,n) = expr (InLeft +ILib.s:6442): position 0, count n
    it.expect('(')
    const tg = it.parseTarget()
    it.expect(',')
    const n = it.evalInt()
    it.expect(')')
    it.expectOp('=')
    midStore(tg, 0, n, str(it.evalExpr()))
  },
  'right$'(it) {
    // Right$(A$,n) = expr (InRight +ILib.s:6465): starts at len-n+1
    // (1-based), or the whole string when n >= len; count n
    it.expect('(')
    const tg = it.parseTarget()
    it.expect(',')
    const n = it.evalInt()
    it.expect(')')
    it.expectOp('=')
    if (n < 0) funcCall()
    const len = str(tg.get()).length
    midStore(tg, n >= len ? 0 : len - n + 1, n, str(it.evalExpr()))
  },
  every(it) {
    // Every n Gosub label / Every n Proc NAME (InEvery)
    // InEvery (+ILib.s:2040) is `tst.l d3 / beq FonCall / cmp.l #32767,d3 /
    // bcc FonCall`. bcc fires ON 32767, so the last usable count is 32766
    // and the port had been taking one more than AMOS does.
    const n = it.evalInt()
    if (n <= 0 || n >>> 0 >= 32767) funcCall()
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
  // Bset, Bclr, Bchg and the six rotates live in ../runtime/instr.ts: BsRout
  // (+ILib.s:5776) lets the target be an ADDRESS as well as a variable, and
  // reaching memory needs the runtime.
  'clear key'(it) {
    void it
    it.inp.keyQueue.length = 0
  },
  'key$'(it) {
    // Set Key$(n)="def": InKeyD (+Lib.s:13715) is `subq.l #1,d1 / cmp.l
    // #20,d1 / Rbcc L_FonCall` before SetFunk, so n runs 1 to 20
    it.expect('(')
    const n = it.evalInt()
    it.expect(')')
    it.expectOp('=')
    const def = it.evalStr()
    if (n < 1 || n > 20) funcCall()
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
  /**
   * `InEdit` (+ILib.s:1829): `move.w #1000,d0 / bra RunErr`, which is the
   * editor's "come back to the text".
   *
   * `returnToCaller` is false because `rErr1` pulls the program stack and
   * then jumps to `Prg_JError`: an accessory that says Edit does not resume
   * whoever Prun'd it, it stops the lot and the editor takes over.
   *
   * `exitDirect` first, because this is reached from a TYPED line as often as
   * from a program: `RunErrExt`'s `cmp.w #1000,d0 / bcc rErr1` sends 1000 and
   * up to `rErr1` before it looks at `Direct(a5)` at all, and `rErr1` pulls
   * the stack. Without the unwind a typed `Edit` left `Direct(a5)` set and
   * the interpreter halted under it: a dead program and an escape screen that
   * never prompted again.
   *
   * DEVIATION: the editor's side of this is `Ed_ErrRun` (+Edit.s:8252), and
   * a headless run has nobody to hand 1000 to. What the code buys with no
   * editor attached is that a caller can tell Edit from End.
   */
  edit(it) {
    it.endCode = 1000
    it.exitDirect()
    it.halt('ended', false)
    return 'jumped'
  },
  /** `InDirect` (+ILib.s:1837): 1001, which is `Ed_ErrDirect` */
  direct(it) {
    it.endCode = 1001
    it.exitDirect()
    it.halt('ended', false)
    return 'jumped'
  },
  /*
   * The three of them write one bit and one longword between them.
   *
   *     InBreakOn  (+ILib.s:1846)  bset #BitControl,ActuMask(a5) / clr.l OnBreak(a5)
   *     InBreakOff (+ILib.s:1853)  bclr #BitControl,ActuMask(a5)
   *     InOnBreak  (+ILib.s:1861)  GetLabel / move.l d0,OnBreak(a5)
   *                                bclr #BitControl,ActuMask(a5)
   *
   * `Break On` is not just "enable": it also FORGETS any On Break Proc, which
   * is the only way to take a handler back off. And `On Break Proc` clears the
   * enable bit itself, so naming a handler is what stops Ctrl-C killing the
   * program. `break on` and `break off` were both `() => {}`.
   */
  'break on'(it) {
    it.breakStops = true
    it.breakHandler = null
  },
  'break off'(it) {
    it.breakStops = false
  },
  'on break proc'(it) {
    it.breakHandler = { kind: 'proc', target: it.parseLabelTarget().toLowerCase() }
    it.breakStops = false
  },
  'set double precision'(it) {
    // No argument and no routine: the entry's spec is a bare `I` and its
    // instruction number is $10F, `L_InNull`, the same one `Set Accessory`
    // has. `VerDPre` (+Verif.s:773) is what does the work, setting MathFlags
    // to %10000011 at VERIFY time, which is also why it can only appear once
    // and has to come before any variable.
    it.doublePrecision = true
  },
  // AMOS Compiler directives. These steer the compiler pass; at runtime under
  // the interpreter the original routines are bare `rts` (Rien, +CompExt.s:324)
  // — so faithful behaviour is to consume the parameters and do nothing.
  'comp options'(it) {
    it.evalStr()
  },
  'comp test': () => {},
  'comp test on': () => {},
  'comp test off': () => {},
}

// ---- functions ------------------------------------------------------------

/**
 * The shared store of the Mid$/Left$/Right$ assignment forms (RInMid2
 * +ILib.s:6644): overwrite `count` chars of the target at 1-based `rawPos`
 * (0 acts like 1) with the source string, clamped by the target's
 * remaining length and the source length — the target's LENGTH never
 * changes. Negative position or count is a function call error; a
 * position past the end silently changes nothing.
 */
function midStore(tg: { get(): Value; set(v: Value): void }, rawPos: number, count: number, src: string): void {
  if (rawPos < 0 || count < 0) funcCall()
  const pos = rawPos === 0 ? 0 : rawPos - 1
  const s = str(tg.get())
  if (pos >= s.length || count === 0) return
  const n = Math.min(count, s.length - pos, src.length)
  if (n <= 0) return
  tg.set(VS(s.slice(0, pos) + src.slice(0, n) + s.slice(pos + n)))
}

/** select the joystick port's bits (port 0 = mouse port, 1 = joystick;
 * FJ +Lib.s:13716 errors on a port > 1) */
function joyPort(it: Parameters<Func>[0], portArg: Value): number {
  const p = int(portArg)
  if (p >>> 0 > MAX_PORT) funcCall()
  return p === PORT_MOUSE ? it.inp.joy0 : it.inp.joy
}

function arity(args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new AmosError('wrong number of arguments')
}

const toAngle = (it: Interp, v: number): number => (it.degrees ? (v * Math.PI) / 180 : v)
const fromAngle = (it: Interp, v: number): number => (it.degrees ? (v * 180) / Math.PI : v)

export const FUNCS: Record<string, Func> = {
  // math
  abs(it, a) {
    arity(a, 1)
    const v = a[0]!
    if (v.k === 'str') throw new AmosError('Type mismatch')
    return v.k === 'int' ? VI(Math.abs(v.n)) : VF(it.ffp(Math.abs(v.n)))
  },
  sgn(_, a) {
    arity(a, 1)
    return VI(Math.sign(num(a[0]!)))
  },
  int(_, a) {
    arity(a, 1)
    return VI(Math.floor(num(a[0]!)))
  },
  sqr(it, a) {
    arity(a, 1)
    const v = num(a[0]!)
    if (v < 0) funcCall() // FlPos
    return VF(it.ffp(Math.sqrt(v)))
  },
  exp(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.exp(num(a[0]!))))
  },
  ln(it, a) {
    arity(a, 1)
    const v = num(a[0]!)
    if (v < 0) funcCall()
    return VF(it.ffp(Math.log(v)))
  },
  log(it, a) {
    arity(a, 1)
    const v = num(a[0]!)
    if (v < 0) funcCall()
    return VF(it.ffp(Math.log10(v)))
  },
  sin(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.sin(toAngle(it, num(a[0]!)))))
  },
  cos(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.cos(toAngle(it, num(a[0]!)))))
  },
  tan(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.tan(toAngle(it, num(a[0]!)))))
  },
  asin(it, a) {
    arity(a, 1)
    return VF(it.ffp(fromAngle(it, Math.asin(num(a[0]!)))))
  },
  acos(it, a) {
    arity(a, 1)
    return VF(it.ffp(fromAngle(it, Math.acos(num(a[0]!)))))
  },
  atan(it, a) {
    arity(a, 1)
    return VF(it.ffp(fromAngle(it, Math.atan(num(a[0]!)))))
  },
  // spec "15" — the same angle-converting argument as Sin/Cos/Tan
  hsin(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.sinh(toAngle(it, num(a[0]!)))))
  },
  hcos(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.cosh(toAngle(it, num(a[0]!)))))
  },
  htan(it, a) {
    arity(a, 1)
    return VF(it.ffp(Math.tanh(toAngle(it, num(a[0]!)))))
  },
  'pi#': (it, a) => {
    arity(a, 0)
    return VF(it.ffp(Math.PI)) // FFP Pi# = 3.141593 (the ROM constant)
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
    if (n < 0 || n > 255) funcCall() // FnChr
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
  val(it, a) {
    arity(a, 1)
    const v = parseAmosNumber(str(a[0]!)) // ValRout, spaces skipped anywhere
    return v.k === 'float' ? VF(it.ffp(v.n)) : v
  },
  'left$'(_, a) {
    arity(a, 2)
    const n = int(a[1]!)
    if (n < 0) funcCall()
    return VS(str(a[0]!).slice(0, n))
  },
  'right$'(_, a) {
    arity(a, 2)
    const n = int(a[1]!)
    if (n < 0) funcCall()
    const s = str(a[0]!)
    return VS(n === 0 ? '' : s.slice(-n))
  },
  'mid$'(_, a) {
    arity(a, 2, 3)
    const s = str(a[0]!)
    const p = int(a[1]!)
    if (p < 0) funcCall() // RFnMid
    const from = p === 0 ? 0 : p - 1
    const n = a.length === 3 ? int(a[2]!) : 0xffff
    if (n < 0) funcCall()
    return VS(s.slice(from, from + n))
  },
  instr(_, a) {
    arity(a, 2, 3)
    const s = str(a[0]!)
    const needle = str(a[1]!)
    let from = 0
    if (a.length === 3) {
      const start = int(a[2]!)
      if (start < 0) funcCall() // FnInstr3
      from = start === 0 ? 0 : start - 1
    }
    if (needle === '') return VI(0) // InstrFind .if11
    return VI(s.indexOf(needle, from) + 1)
  },
  'space$'(_, a) {
    arity(a, 1)
    const n = int(a[0]!)
    if (n < 0) funcCall() // RString
    return VS(' '.repeat(n))
  },
  'string$'(_, a) {
    arity(a, 2)
    const s = str(a[0]!)
    const n = int(a[1]!)
    if (n < 0) funcCall()
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
  // AMOS Compiler state reads: no native compiler is (or can be) loaded, so
  // these report "compiler absent" — the values the originals return when the
  // APCMP overlay was never loaded (CompHere +CompExt.s:410 = 0, CompErr = "",
  // CompSize +CompExt.s:444 = 0).
  'comp err$': (_, a) => {
    arity(a, 0)
    return VS('')
  },
  'comp here': (_, a) => {
    arity(a, 0)
    return VI(0)
  },
  'comp size': (_, a) => {
    arity(a, 0)
    return VI(0)
  },
  // Multitasking introspection in a single-program runtime: no AMOS program
  // runs beneath this one (FnPrgUnder +ILib.s:1697) and the program state word
  // (FnPrgState +ILib.s:1774) is the plain running state.
  'prg state': (_, a) => {
    /*
     * FnPrgState (+ILib.s:1778) is `move.w T_AMOState(a5),d3 / ext.l d3`, and
     * T_AMOState has exactly two writers: `clr.w T_AMOState(a5)` under the
     * comment "Mode RUN-ONLY" (+B.s:930), and `move.w #1,T_AMOState(a5)`
     * under "Editeur present!" (+Edit.s:912). It answers whether the editor
     * is loaded, not what a program is doing.
     *
     * DEVIATION: this returns the run-only 0 always. The runtime here does
     * not know whether the browser editor is up, and nothing in it asks.
     */
    arity(a, 0)
    return VI(0)
  },
  'prg under': (_, a) => {
    arity(a, 0)
    return VI(0)
  },
  'inkey$'(it, a) {
    arity(a, 0)
    const k = it.inp.keyQueue.shift()
    if (k === undefined) return VS('')
    it.inp.lastScan = k.scan
    it.inp.lastShift = k.shift ?? 0
    return VS(k.ch)
  },
  'key$'(it, a) {
    // FnKeyD +Lib.s:13728: Key$(n) is the function-key DEFINITION string
    // (set by Key$(n)="..."), NOT a keyboard read
    arity(a, 1)
    const n = int(a[0]!)
    if (n < 1 || n > 20) funcCall()
    return VS(it.inp.funcKeys[n - 1] ?? '')
  },
  scancode(it, a) {
    // FnScancode +Lib.s:13602: returns the last scancode, then clears it
    arity(a, 0)
    const s = it.inp.lastScan
    it.inp.lastScan = 0
    return VI(s)
  },
  'key state'(it, a) {
    // FnKeyState +Lib.s:13620: n & $7F indexes the key matrix; n >= 128 errors
    arity(a, 1)
    const n = int(a[0]!)
    if (n >= 128 || n < 0) funcCall()
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
    // MRout +W.s:10598: bitmask of buttons newly pressed since the last
    // read (edge-detected vs the stored old state, then latched)
    arity(a, 0)
    const pressed = it.inp.mouseK & ~it.inp.mouseClickOld & 7
    it.inp.mouseClickOld = it.inp.mouseK
    return VI(pressed)
  },
  'mouse zone'(_it, a) {
    arity(a, 0)
    return VI(0) // zones arrive with the object/zone milestone
  },
  // Joy/Jup/... take a port 0 or 1 (FJ +Lib.s:13716 rejects >1). Port 1 is
  // the joystick port, port 0 the mouse port — two distinct players.
  joy(it, a) {
    arity(a, 1)
    return VI(joyPort(it, a[0]!))
  },
  jup(it, a) {
    arity(a, 1)
    return VI(joyPort(it, a[0]!) & 1 ? -1 : 0)
  },
  jdown(it, a) {
    arity(a, 1)
    return VI(joyPort(it, a[0]!) & 2 ? -1 : 0)
  },
  jleft(it, a) {
    arity(a, 1)
    return VI(joyPort(it, a[0]!) & 4 ? -1 : 0)
  },
  jright(it, a) {
    arity(a, 1)
    return VI(joyPort(it, a[0]!) & 8 ? -1 : 0)
  },
  fire(it, a) {
    arity(a, 1)
    return VI(joyPort(it, a[0]!) & 16 ? -1 : 0)
  },
  // =Param / =Param# / =Param$ read three independent typed slots
  param(it, a) {
    arity(a, 0)
    return VI(it.paramInt)
  },
  'param#'(it, a) {
    arity(a, 0)
    return VF(it.paramFloat)
  },
  'param$'(it, a) {
    arity(a, 0)
    return VS(it.paramStr)
  },
  errtrap(it, a) {
    // =Errtrap: the error number caught by the last Trap (FnErrTrap +ILib.s:2021)
    arity(a, 0)
    return VI(it.trapCode)
  },
  errn(it, a) {
    // =Errn: the number of the last trapped error (FnErrn +Lib.s:1716)
    arity(a, 0)
    return VI(it.errCode)
  },
  'err$'(it, a) {
    // =Err$(n): the message for error number n (FnErrD +Lib.s:1726)
    arity(a, 1)
    const n = a.length > 0 && int(a[0]!) >= 0 ? int(a[0]!) : it.errCode
    return VS(AMOS_ERRORS[n] ?? '')
  },
  'repeat$'(_, a) {
    /*
     * FnRepeat (+Lib.s:14108) is `tst.l d3 / Rbeq L_WFonCall / cmp.l #207,d3
     * / Rbcc L_WFonCall`, so the count is 1 to 206 and anything else is error
     * 60. The compare is unsigned, which covers the negatives.
     *
     * It then builds ChRpt through FinRpt (+Lib.s:14152), the same routine
     * Border$ and Zone$ use: `Esc R 0` + the text + `Esc R n`. The repeating
     * is the console's job (Repete, +W.s:14993), not the string's, so the
     * result is six characters longer than the text and NOT n copies of it.
     * Returning n copies gave the right picture and the wrong Len.
     */
    arity(a, 2)
    const n = int(a[1]!)
    if (n === 0 || n >>> 0 >= 207) throw new AmosError(AMOS_ERRORS[60]!, 60)
    return VS('\x1bR0' + str(a[0]!) + '\x1bR' + String.fromCharCode(48 + n))
  },
  'command line$'(_, a) {
    arity(a, 0)
    return VS('')
  },
  'display height'(_, a) {
    arity(a, 0)
    // TMaxRaw +W.s:2578 on a PAL machine; see the note in instr.ts
    return VI(311)
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
}

