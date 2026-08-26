import type { PacPicture } from '../loader/pacpic'
import type { ResourceBank } from '../loader/resource'
import { sw16 } from './word'

/**
 * The Interface language — AMOS Pro's dialog scripting engine, ported from
 * the Dia_* routines in +Lib.s (the token tables at 21077-21244, the
 * character classes at 24689-24833, the interpreter at 21258+, the
 * expression evaluator at 22748+, the pre-pass at 19889-20222).
 *
 * A dialog program is raw ASCII: statements are 2-letter mnemonics with
 * comma-separated parameters, terminated by any separator (usually ';');
 * `[` `]` bracket routines (button draw/change routines, IF blocks, whole
 * label routines). It is NOT compiled: Dialog Open makes one syntax-check
 * pass recording label (LA) and user-instruction (UI) offsets, and every
 * Dialog Run re-interprets the text.
 *
 * Expressions are pure postfix over a 32-bit value stack: `SWSX-2/` is
 * (SW - SX) / 2. The stack must hold exactly one value at each terminator.
 */

// ---- errors (EDia_* +Equ.s:1151-1162) ----

export const DIALOG_ERRORS: Record<number, string> = {
  1: 'dialog syntax error',
  2: 'dialog out of memory',
  3: 'dialog label already defined',
  4: 'dialog label not defined',
  5: 'dialog channel already opened',
  6: 'dialog channel not opened',
  7: 'screen not opened',
  8: 'dialog variable not defined',
  9: 'dialog function call error',
  10: 'dialog type mismatch',
  11: 'dialog out of buffer',
  12: 'dialog wrong number of parameters',
}

export class DialogError extends Error {
  constructor(
    readonly code: number,
    readonly position: number,
  ) {
    super(DIALOG_ERRORS[code] ?? `dialog error ${code}`)
  }
}

// ---- instruction tables (Dia_Instr / Dia_NParam, +Lib.s:21079-21181) ----

export const DIALOG_INSTRS = [
  'EX', 'UN', 'LI', 'BO', 'SI', 'BA', 'PU', 'SV', 'IL', 'PR',
  'PO', 'IN', 'SF', 'SW', 'SL', 'SP', 'BU', 'JP', 'RU', 'BR',
  'ED', 'JS', 'RT', 'BC', 'KY', 'SA', 'DI', 'BL', 'LA', 'BQ',
  'HS', 'VS', 'AL', 'IL', 'ZC', 'UI', 'GB', 'GS', 'GL', 'IF',
  'SZ', 'XY', 'NW', 'VT', 'VL', 'HT', 'CA', 'SM', 'GE', 'GP',
  'SS',
] as const

export const DIALOG_NPARAMS = [
  0, 3, 4, 5, 2, 2, 1, 2, 0, 4,
  5, 3, 2, 1, 1, 2, 8, 1, 2, 1,
  8, 1, 0, 2, 2, 1, 8, 1, 1, 0,
  9, 9, 10, 10, 2, 0, 4, 4, 4, 1,
  1, 4, 0, 4, 4, 10, 1, 0, 4, 3,
  8,
]

/** first matching index, like the linear .Find scan */
function findInstr(mn: string): number {
  return DIALOG_INSTRS.indexOf(mn as (typeof DIALOG_INSTRS)[number])
}

// ---- character classes (Dia_Chr .Codes, +Lib.s:24700-24833) ----

const C_SKIP = 0
const C_LETTER = 1
const C_SIGN = 2
const C_END = 3 // NUL / end of text
const C_TERM = 4 // , ; : `
const C_DIGIT = 5 // 0-9 $ %

const CHR_CLASS = new Uint8Array(256).fill(C_SKIP)
{
  CHR_CLASS[0] = C_END
  // controls 1-31 and space: skip
  for (const c of '!"#&\'*+-/<=>?@[\\]^_') CHR_CLASS[c.charCodeAt(0)] = C_SIGN
  for (const c of '$%0123456789') CHR_CLASS[c.charCodeAt(0)] = C_DIGIT
  for (const c of ',;:`') CHR_CLASS[c.charCodeAt(0)] = C_TERM
  for (let c = 65; c <= 90; c++) CHR_CLASS[c] = C_LETTER
  // lowercase, '(' ')' '.' '{' '}' '~', DEL, and everything >= 128: skip
  // (note '|' carries the $80 skip bit in the original table, so the OR
  // operator is unreachable — transcribed faithfully)
}

// ---- expression function tokens (Dia_FTokens doc, +Lib.s:21196-21244) ----

/** single sign characters → dispatch index (the +Dialog_Funcs.bin sign list) */
const SIGN_FUNCS: Record<string, number> = {
  '+': 4, '-': 5, '*': 6, '/': 7, '"': 14, "'": 15, '#': 22, '!': 23,
  '=': 40, '\\': 41, '<': 42, '>': 43, '&': 44, '|': 45,
}

/** two-letter tokens → dispatch index */
const PAIR_FUNCS: Record<string, number> = {
  AR: 29, AS: 49,
  BX: 0, BY: 1, BP: 21,
  CX: 16,
  ME: 9, MI: 19, MA: 20, MZ: 24,
  NE: 8,
  P1: 31, P2: 32, P3: 33, P4: 34, P5: 35, P6: 36, P7: 37, P8: 38, P9: 39,
  SX: 2, SY: 3, SW: 17, SH: 18,
  TW: 11, TH: 12, TL: 48,
  VA: 13,
  XA: 25, XB: 27,
  YA: 26, YB: 28,
  ZP: 30, ZV: 46, ZN: 47,
}

// ---- host services ----

export interface DialogHost {
  /** current screen text sizes for SW/SH (EcTx/EcTy of T_EcCourant) */
  screenWidth(): number
  screenHeight(): number
  /** TW/TH via the current font */
  textWidth(s: string): number
  textHeight(): number
  /** AR/AS/list bridge: handle (a value > 1024) → live array values */
  resolveArray(handle: number): Array<number | string> | null
  /** raw memory for MZ / HT text addresses: up to maxLen bytes starting
   * at addr in the fake address space, or null if it doesn't resolve */
  readMem(addr: number, maxLen: number): Uint8Array | null
}

// ---- zones ----

export type ZoneKind = 'button' | 'edit' | 'digit' | 'list' | 'hyper' | 'key' | 'slider'

export interface DialogZone {
  kind: ZoneKind
  number: number
  /** screen coords (base already added, Dia_GetEntete) */
  x: number
  y: number
  sx: number
  sy: number
  pos: number
  min: number
  max: number
  /** script offsets of the [draw] and [change] routines */
  rdraw: number
  rchange: number
  /** ZoVar: the NextZone counter at creation */
  zvar: number
  nowait: boolean
  quit: boolean
  changing: boolean
  /** result pushed by BR from within this zone's routines */
  value: number | string | null
  // edit/digit state
  text?: string
  maxLen?: number
  pap?: number
  pen?: number
  // key zones
  code?: number
  shift?: number
  /** the zone a KY record activates (Dia_KyZone = LastZone) */
  ref?: DialogZone | null
  // sliders
  total?: number
  size?: number
  step?: number
  vertical?: boolean
  // lists (AL/IL)
  handle?: number
  count?: number
  scroll?: number
  sel?: number
  rows?: number
  listFlags?: number
  // hypertext (HT)
  htText?: string
  htLines?: string[]
  htZones?: Array<{ row: number; x0: number; x1: number; key: string }>
}

// ---- the channel ----

export class DialogChannel {
  script = ''
  labels = new Map<number, number>()
  userInstrs = new Map<string, { nParams: number; off: number }>()
  vars: Array<number | string> = []
  /** pseudo-vars -1/-2/-3 (Dia_BP / Dia_BR / current zone) */
  bp: number | string = 0
  br: number | string = 0
  curZone: DialogZone | null = null
  nextZone = 0
  baseX = 0
  baseY = 0
  sizeX = 0
  sizeY = 0
  xa = 0
  ya = 0
  xb = 0
  yb = 0
  /** PU: image number offset into the resource graphics */
  puzzleBase = 0
  screenNb = 0
  res: ResourceBank
  zones: DialogZone[] = []
  drawn = false
  frozen = false
  /**
   * Dia_Flags bit 4 (+Lib.s:24203): Return in an edit zone still reports the
   * zone number, but does not advance to the next editable field. The file
   * selector sets it so Return in the name box means "accept", not "move on".
   */
  noEditAdvance = false
  /** Dia_Return, read-and-cleared by =Dialog(n) */
  ret = 0
  runState: 'idle' | 'waiting' | 'done' = 'idle'
  /** RU flags/timer */
  runFlags = 0
  timer = 0
  timerStart = 0
  /**
   * `CA`'s addresses, for a host that knows what one of them is.
   *
   * `CA addr` calls 68k machine code, and this port does not execute any. The
   * editor is the caller that matters: `Ed_Ligne` (+Edit.s:8367) puts
   * `EdReCop` into `Ed_VDialogues` slot 4 and its requester ends `CA 4VA`.
   * `EdReCop` (:3043) is `SyCall WaitVbl / EcCall CopForce / rts`, three
   * instructions that force a copper rebuild, which this port does every
   * frame anyway. An address nobody registered is still a function call
   * error, because a dialog calling into memory this port cannot reach is
   * not something to do quietly.
   */
  machineCalls = new Map<number, () => void>()
  /** SS: dialog slider colours (SlDInit +Lib.s:20182) */
  sliderCfg = [0, 0, 0, 1, 4, 4, 4, 1, 0, 0, 0, 1, 3, 3, 3, 1]
  /** user-instruction call depth and param stack */
  uiParams: Array<Array<number | string>> = []
  /** last unpacked image size (Dia_PuzzleSx/Sy) */
  puzzleSx = 0
  puzzleSy = 0
  /** SA/BL screen blocks by number, and the SA restore order (LIFO) */
  blocks = new Map<number, { saved: unknown }>()
  saOrder: number[] = []
  /** paused execution across RU (resumed by stepDialogs) */
  exec: DialogExec | null = null
  /** the zone defined last (Dia_LastZone), attached to following KY records */
  lastZone: DialogZone | null = null
  /** a pressed nowait zone being tracked until mouse release (Dia_Release) */
  release: DialogZone | null = null
  /** the active edit/digit zone (Dia_Edited) */
  edited: DialogZone | null = null
  /** a held slider interaction: knob drag or track stepping (Sl_Clic) */
  drag: { z: DialogZone; mode: 'drag' | 'down' | 'up'; grab: number } | null = null

  constructor(
    readonly channel: number,
    readonly nVars: number,
    res: ResourceBank,
  ) {
    this.res = res
    for (let i = 0; i < nVars; i++) this.vars.push(0)
  }

  getVar(n: number): number | string {
    if (n === -1) return this.bp
    if (n === -2) return this.br
    return this.vars[n] ?? 0
  }

  setVar(n: number, v: number | string): void {
    if (n === -1) this.bp = v
    else if (n === -2) this.br = v
    else if (n >= 0 && n < this.vars.length) this.vars[n] = v
  }
}

// ---- the script cursor (Dia_Chr) ----

export class Cursor {
  pos = 0
  constructor(readonly text: string) {}

  /** classified read: skips skip-class chars, returns {ch, cls} */
  next(): { ch: string; cls: number } {
    for (;;) {
      if (this.pos >= this.text.length) return { ch: '\0', cls: C_END }
      const code = this.text.charCodeAt(this.pos++) & 0xff
      const cls = code >= 128 ? C_SKIP : CHR_CLASS[code]!
      if (cls === C_SKIP) continue
      return { ch: String.fromCharCode(code), cls }
    }
  }

  /** raw byte read (Dia_ChrC), for number/string scanning */
  raw(): string {
    if (this.pos >= this.text.length) return '\0'
    return this.text[this.pos++]!
  }

  back(): void {
    this.pos--
  }
}

/** number literal: decimal, $hex (upper A-F), %binary (Dia_FChif) */
function scanNumber(cur: Cursor, first: string): number {
  let base = 10
  let v = 0
  if (first === '$') base = 16
  else if (first === '%') base = 2
  else v = first.charCodeAt(0) - 48
  for (;;) {
    const c = cur.raw()
    if (c === '\0') break
    const d = digitVal(c, base)
    if (d < 0) {
      cur.back()
      break
    }
    v = (v * base + d) | 0
  }
  return v
}

function digitVal(c: string, base: number): number {
  const n = c.charCodeAt(0)
  if (n >= 48 && n <= 57) {
    const d = n - 48
    return d < base ? d : -1
  }
  if (base === 16 && n >= 65 && n <= 70) return n - 55
  return -1
}

// ---- pre-pass (Dia_OpenChannel, +Lib.s:19962-20155) ----

/**
 * One syntax-check pass over the whole script: every statement's mnemonic
 * must exist (or be a UI call), every parameter expression must scan, and
 * LA/UI statements are recorded. `[` and `]` are skipped at statement level.
 * Throws DialogError(code, position) exactly where the 68k stores
 * Dia_ErrorPos.
 */
export function prescanDialog(script: string): {
  labels: Map<number, number>
  userInstrs: Map<string, { nParams: number; off: number }>
} {
  const cur = new Cursor(script)
  const labels = new Map<number, number>()
  const userInstrs = new Map<string, { nParams: number; off: number }>()
  const synt = (): never => {
    throw new DialogError(1, cur.pos)
  }

  // syntax-mode expression scan; returns the terminator char
  const scanExpr = (): string => {
    for (;;) {
      const { ch, cls } = cur.next()
      if (cls === C_END) synt()
      if (cls === C_TERM) return ch
      if (cls === C_DIGIT) {
        scanNumber(cur, ch)
        continue
      }
      if (cls === C_SIGN) {
        const fn = SIGN_FUNCS[ch]
        if (fn === undefined) synt()
        if (ch === '"' || ch === "'") {
          // string literal: verbatim to the matching quote, controls illegal
          for (;;) {
            const c = cur.raw()
            if (c === '\0' || c.charCodeAt(0) < 32) synt()
            if (c === ch) break
          }
        }
        continue
      }
      // letter: the pair must exist in this letter's own list
      const second = cur.next()
      if (second.cls === C_END) synt()
      if (PAIR_FUNCS[ch + second.ch] === undefined) synt()
    }
  }

  // literal number after LA / UI count (digit class required)
  const literal = (): number => {
    const { ch, cls } = cur.next()
    if (cls !== C_DIGIT) synt()
    return scanNumber(cur, ch)
  }

  for (;;) {
    const first = cur.next()
    if (first.cls === C_END) break
    if (first.ch === '[' || first.ch === ']') continue
    const second = cur.next()
    if (second.cls === C_END) synt()
    const mn = first.ch + second.ch
    const idx = findInstr(mn)
    if (idx < 0) {
      // user-instruction call: skip comma-separated expressions
      const t = cur.next()
      if (t.cls === C_END) synt()
      if (t.cls !== C_TERM) {
        cur.back()
        while (scanExpr() === ',') {
          /* next parameter */
        }
      }
      continue
    }
    if (idx === 28) {
      // LA n; — literal label number < 65536, no duplicates
      const n = literal()
      if (n >= 65536 || n < 0) synt()
      if (labels.has(n)) throw new DialogError(3, cur.pos)
      const sep = cur.next()
      // the separator must be a true terminator class — a sign or digit
      // here is a syntax error too (`beq/bcs .Synt` +Lib.s:20104-20106)
      if (sep.cls !== C_TERM) synt()
      labels.set(n, cur.pos)
      continue
    }
    if (idx === 35) {
      // UIxy,n;[ — define a user instruction. The class checks come from
      // the CCR the class byte is loaded into (+Lib.s:20065-20071): the
      // first name char may be a letter OR a sign (only end, terminators
      // and digits are rejected — beq/bcc/bmi), the second any carry-set
      // class including digits (bcc only).
      const a = cur.next()
      if (a.cls !== C_LETTER && a.cls !== C_SIGN) synt()
      const b = cur.next()
      if (b.cls !== C_LETTER && b.cls !== C_SIGN && b.cls !== C_DIGIT) synt()
      const name = a.ch + b.ch
      if (findInstr(name) >= 0 || userInstrs.has(name)) throw new DialogError(3, cur.pos)
      const comma = cur.next()
      if (comma.ch !== ',') synt()
      const count = literal()
      if (count > 9) synt()
      // after the count a terminator class is required (`bcs .Synt` 20137)
      const sep = cur.next()
      if (sep.cls !== C_TERM && sep.cls !== C_END) synt()
      const bracket = cur.next()
      if (bracket.ch !== '[') synt()
      userInstrs.set(name, { nParams: count, off: cur.pos })
      continue
    }
    const nPar = DIALOG_NPARAMS[idx]!
    if (nPar === 0) {
      // separator required (terminator class)
      const t = cur.next()
      if (t.cls !== C_TERM) synt()
      continue
    }
    for (let i = 0; i < nPar; i++) {
      const term = scanExpr()
      if (i < nPar - 1 && term !== ',') throw new DialogError(12, cur.pos)
    }
  }
  return { labels, userInstrs }
}

// ---- runtime expression evaluation (Dia_Evalue, +Lib.s:22748+) ----

export type DialogValue = number | string

export interface EvalContext {
  ch: DialogChannel
  host: DialogHost
}


/**
 * Evaluate one postfix expression up to (and consuming) its terminator.
 * Returns the single remaining stack value; depth != 1 at the end is a
 * dialog syntax error, exactly like `cmp.w #1,d7` at .Fini.
 */
/**
 * What a string is worth when a script uses it as a number. The original has
 * a pointer there, so the only property scripts can depend on is that it is
 * not zero (see popInt).
 */
const STRING_AS_ADDRESS = 1

export function evalExpr(cur: Cursor, ctx: EvalContext): DialogValue {
  const stack: DialogValue[] = []
  const synt = (): never => {
    throw new DialogError(1, cur.pos)
  }
  const fonc = (): never => {
    throw new DialogError(9, cur.pos)
  }
  const pop = (): DialogValue => {
    if (stack.length === 0) synt()
    return stack.pop()!
  }
  const popInt = (): number => {
    const v = pop()
    // The 68k value stack is untyped 32 bits, so a string variable's value is
    // its address — never 0, not even for "". Scripts rely on that: the file
    // selector's own program guards its default title with `IF 0VA 0=`,
    // meaning "if variable 0 was never set". Coercing strings to 0 made every
    // supplied title vanish behind the default.
    return typeof v === 'number' ? v : STRING_AS_ADDRESS
  }
  const popStr = (): string => {
    const v = pop()
    return typeof v === 'string' ? v : String(v)
  }
  const need = (n: number): void => {
    if (stack.length < n) synt()
  }
  // AR/AS depth failures raise EDia_NPar (wrong number of parameters), not
  // a syntax error (`Rblt L_Dia_NPar` +Lib.s:22869/22891)
  const needP = (n: number): void => {
    if (stack.length < n) throw new DialogError(12, cur.pos)
  }

  const apply = (fn: number): void => {
    switch (fn) {
      case 0: // BX
        stack.push(ctx.ch.baseX)
        break
      case 1: // BY
        stack.push(ctx.ch.baseY)
        break
      case 2: // SX
        stack.push(ctx.ch.sizeX)
        break
      case 3: // SY
        stack.push(ctx.ch.sizeY)
        break
      case 4: { // + (32-bit add)
        need(2)
        const b = popInt()
        stack.push((popInt() + b) | 0)
        break
      }
      case 5: { // -
        need(2)
        const b = popInt()
        stack.push((popInt() - b) | 0)
        break
      }
      case 6: { // * — muls: 16x16 signed (low words)
        need(2)
        const b = popInt()
        stack.push(Math.imul(sw16(popInt()), sw16(b)))
        break
      }
      case 7: { // / — the dividend is truncated to its sign-extended low
        // word BEFORE the divs (`ext.l d1` at +Lib.s:22990), and the
        // quotient is the sign-extended low word again: 70000/2 is 2232 on
        // the Amiga, not 35000. Only a full-long zero divisor is a syntax
        // error (22989); a nonzero long with a zero low word would hit the
        // 68000 divide-by-zero trap — kept as a syntax error here.
        need(2)
        const b = popInt()
        if (b === 0 || sw16(b) === 0) synt()
        const a = sw16(popInt())
        const q = Math.trunc(a / sw16(b))
        // divs overflow (-32768/-1) leaves the register unchanged
        stack.push(q === 32768 ? a : q)
        break
      }
      case 8: { // NE — negate top in place, needs depth >= 1
        need(1)
        stack.push((-popInt()) | 0)
        break
      }
      case 9:
      case 10: { // ME — message n (1-based, Dia_FMess)
        need(1)
        const n = popInt()
        if (n <= 0) fonc()
        const msg = ctx.ch.res.messages?.[n - 1]
        if (msg === undefined) fonc()
        stack.push(msg!)
        break
      }
      case 11: // TW
        need(1)
        stack.push(ctx.host.textWidth(popStr()))
        break
      case 12: // TH
        stack.push(ctx.host.textHeight())
        break
      case 13: { // VA n — replace top with vars[n]
        need(1)
        stack.push(ctx.ch.getVar(popInt()))
        break
      }
      case 16: { // CX — centred x: max(0, sizeX - TW(t)) / 2
        need(1)
        const w = ctx.host.textWidth(popStr())
        stack.push(Math.max(0, ctx.ch.sizeX - w) >> 1)
        break
      }
      case 17: // SW
        stack.push(ctx.host.screenWidth())
        break
      case 18: // SH
        stack.push(ctx.host.screenHeight())
        break
      case 19: { // MI
        need(2)
        const b = popInt()
        stack.push(Math.min(popInt(), b))
        break
      }
      case 20: { // MA
        need(2)
        const b = popInt()
        stack.push(Math.max(popInt(), b))
        break
      }
      case 21: // BP
      case 30: // ZP
        stack.push(ctx.ch.bp)
        break
      case 22: { // # — int to ASCII
        need(1)
        stack.push(String(popInt()))
        break
      }
      case 23: { // ! — string concat (below + top)
        need(2)
        const b = popStr()
        stack.push(popStr() + b)
        break
      }
      case 24: { // MZ maxlen addr — copy a below-space-terminated string
        // Dia_FStZero (+Lib.s:23142): bytes from the address while >= 32,
        // capped at maxlen
        need(2)
        const maxLen = popInt()
        const at = pop()
        // DEVIATION: the machine's operand is a POINTER, because the caller
        // that fills the variable has one -- `Ed_AboutExt` (+Edit.s:4621)
        // puts `LB_Title(a0)` there, the address of the library's banner.
        // Nothing in this port has an address to give, so a caller writes the
        // characters into the variable and `MZ` finds a string sitting where
        // the 68k would have found a pointer. Cut it the same way: stop at
        // the first byte below 32, and never take more than maxLen.
        if (typeof at === 'string') {
          let cut = at.slice(0, Math.max(0, maxLen))
          for (let i = 0; i < cut.length; i++) {
            if (cut.charCodeAt(i) < 32) {
              cut = cut.slice(0, i)
              break
            }
          }
          stack.push(cut)
          break
        }
        const bytes = ctx.host.readMem(at, Math.max(0, maxLen))
        let s = ''
        if (bytes) {
          for (const b of bytes) {
            if (b < 32) break
            s += String.fromCharCode(b)
          }
        }
        stack.push(s)
        break
      }
      case 25: // XA
        stack.push(ctx.ch.xa)
        break
      case 26: // YA
        stack.push(ctx.ch.ya)
        break
      case 27: // XB
        stack.push(ctx.ch.xb)
        break
      case 28: // YB
        stack.push(ctx.ch.yb)
        break
      case 29: { // AR — array element (handle > 1024, Dia_FArray)
        needP(2)
        const i = popInt()
        const handle = popInt()
        if (handle <= 1024) fonc()
        const arr = ctx.host.resolveArray(handle)
        if (!arr || i < 0 || i >= arr.length) fonc()
        stack.push(arr![i]!) // raw long in the 68k: number or string alike
        break
      }
      case 46: // ZV
        stack.push(ctx.ch.curZone ? ctx.ch.curZone.zvar : ctx.ch.nextZone)
        break
      case 47: { // ZN — current zone number, error outside a zone routine
        if (!ctx.ch.curZone) synt()
        stack.push(ctx.ch.curZone!.number)
        break
      }
      case 48: { // TL — string length
        need(1)
        stack.push(popStr().length)
        break
      }
      case 49: { // AS — array size (0 stays 0)
        needP(1)
        const handle = popInt()
        if (handle === 0) {
          stack.push(0)
          break
        }
        if (handle <= 1024) fonc()
        const arr = ctx.host.resolveArray(handle)
        if (!arr) fonc()
        stack.push(arr!.length)
        break
      }
      case 40: { // =
        need(2)
        const b = popInt()
        stack.push(popInt() === b ? -1 : 0)
        break
      }
      case 41: { // \
        need(2)
        const b = popInt()
        stack.push(popInt() !== b ? -1 : 0)
        break
      }
      case 42: { // <
        need(2)
        const b = popInt()
        stack.push(popInt() < b ? -1 : 0)
        break
      }
      case 43: { // >
        need(2)
        const b = popInt()
        stack.push(popInt() > b ? -1 : 0)
        break
      }
      case 44: { // & — bitwise
        need(2)
        const b = popInt()
        stack.push(popInt() & b)
        break
      }
      case 45: { // |
        need(2)
        const b = popInt()
        stack.push(popInt() | b)
        break
      }
      default: {
        // P1..P9 (31-39): user-instruction parameters, first arg = P1
        if (fn >= 31 && fn <= 39) {
          const params = ctx.ch.uiParams[ctx.ch.uiParams.length - 1]
          if (!params) synt()
          const v = params![fn - 31]
          if (v === undefined) synt()
          stack.push(v!)
          break
        }
        synt()
      }
    }
  }

  for (;;) {
    const { ch, cls } = cur.next()
    if (cls === C_END || cls === C_TERM) break
    if (cls === C_DIGIT) {
      stack.push(scanNumber(cur, ch))
      continue
    }
    if (cls === C_SIGN) {
      if (ch === '"' || ch === "'") {
        // string literal, verbatim until the matching quote; a control
        // char ends it early (Dia_FStr pushes back, no error)
        let s = ''
        for (;;) {
          const c = cur.raw()
          if (c === '\0' || c.charCodeAt(0) < 32) {
            cur.back()
            break
          }
          if (c === ch) break
          s += c
        }
        stack.push(s)
        continue
      }
      const fn = SIGN_FUNCS[ch]
      if (fn === undefined) synt()
      apply(fn!)
      continue
    }
    // letter pair
    const second = cur.next()
    const fn = PAIR_FUNCS[ch + second.ch]
    if (fn === undefined) synt()
    apply(fn!)
  }
  if (stack.length !== 1) synt()
  return stack[0]!
}

// ---- drawing services (implemented by the Runtime on the bound screen) ----

export interface DialogDraw {
  /** Dia_Active / Dia_ReActive: set/restore the drawing target screen */
  activate(screenNb: number): void
  deactivate(): void
  /** stamp an unpacked resource image (UN/LI/VL/BO) */
  stamp(img: PacPicture, x: number, y: number): void
  /** BO middle fill: copy rect [x1,ySrc,x2,ySrc+h) to yDest (Dia_ScCopy) */
  copyRect(x1: number, ySrc: number, x2: number, h: number, yDest: number): void
  setPen(c: number): void
  setBPen(c: number): void
  setOutlinePen(c: number): void
  rectFill(x1: number, y1: number, x2: number, y2: number): void
  outlineRect(x1: number, y1: number, x2: number, y2: number): void
  line(x1: number, y1: number, x2: number, y2: number): void
  ellipse(x: number, y: number, rx: number, ry: number): void
  plot(x: number, y: number): void
  /** top-left text with the current pen and writing mode */
  text(x: number, y: number, s: string): void
  setWriting(mode: number): void
  setLinePattern(p: number): void
  setFillPattern(p: number, outline: number): void
  setFont(font: number, style: number): void
  grabBlock(x: number, y: number, w: number, h: number): unknown
  putBlock(saved: unknown): void
  clearKeys(): void
  clearClicks(): void
  /** ED/DI field: paper-filled cell row with the text in pen */
  editField(x: number, y: number, wChars: number, text: string, pap: number, pen: number, cursor: number): void
  /** opaque 8x8 text cells (list rows, hypertext segments) */
  textCells(x: number, y: number, s: string, pen: number, pap: number): void
  /** HS/VS dialog slider with the channel's colour set (Sl_Draw) */
  dialogSlider(cfg: number[], vertical: boolean, x: number, y: number, sx: number, sy: number, total: number, pos: number, size: number): void
}

export type ExecResult = { status: 'exit' } | { status: 'run' }

interface ExecFrame {
  kind: 'if' | 'ui'
  ret: number
}

/**
 * The statement interpreter (Dia_Loop +Lib.s:21258). One instance runs a
 * whole =Dialog Run; RU pauses it (status 'run') and stepDialogs resumes
 * the tail after the wait completes.
 */
export class DialogExec {
  readonly cur: Cursor
  private frames: ExecFrame[] = []
  private jsStack: number[] = []
  readonly ctx: EvalContext

  constructor(
    readonly ch: DialogChannel,
    readonly host: DialogHost,
    readonly draw: DialogDraw,
  ) {
    this.cur = new Cursor(ch.script)
    this.ctx = { ch, host }
  }

  private synt(): never {
    throw new DialogError(1, this.cur.pos)
  }

  private fonc(): never {
    throw new DialogError(9, this.cur.pos)
  }

  private evalOne(): DialogValue {
    return evalExpr(this.cur, this.ctx)
  }

  private evalInt(): number {
    const v = this.evalOne()
    return typeof v === 'number' ? v : 0
  }

  private evalStr(): string {
    const v = this.evalOne()
    return typeof v === 'string' ? v : String(v)
  }

  /** raw scan past the next unmatched `]` (Dia_If .Skip) */
  private skipBrackets(): void {
    let depth = 1
    for (;;) {
      const c = this.cur.raw()
      if (c === '\0') this.synt()
      if (c === '[') depth++
      else if (c === ']' && --depth === 0) return
    }
  }

  /** jump to label n (Dia_GetLabel: unknown label = offset 0) */
  private jumpLabel(n: number): void {
    this.cur.pos = this.ch.labels.get(n) ?? 0
  }

  run(startPos?: number): ExecResult {
    if (startPos !== undefined) this.cur.pos = startPos
    const ch = this.ch
    const draw = this.draw
    for (;;) {
      const first = this.cur.next()
      if (first.cls === C_END) this.synt() // must end with EX or ]
      if (first.ch === ']') {
        if (this.routineEnd()) return { status: 'exit' }
        continue
      }
      const second = this.cur.next()
      if (second.cls === C_END) this.synt()
      const mn = first.ch + second.ch
      const idx = findInstr(mn)
      if (idx < 0) {
        this.userCall(mn)
        continue
      }
      const nPar = DIALOG_NPARAMS[idx]!
      // self-parsing instructions (7+ params, .Params `cmp.w #7 bcc .Call`)
      if (nPar >= 7) {
        this.bigInstr(idx)
        continue
      }
      const v: DialogValue[] = []
      if (nPar === 0) {
        this.cur.next() // .NoPar: one classified char is always consumed
      } else {
        for (let i = 0; i < nPar; i++) v.push(this.evalOne())
      }
      const int = (i: number): number => {
        const x = v[i]
        return typeof x === 'number' ? x : 0
      }
      const str = (i: number): string => {
        const x = v[i]
        return typeof x === 'string' ? x : String(x)
      }
      switch (idx) {
        case 0: // EX — quit the current loop level, like `]` (Dia_Quit)
          if (this.routineEnd()) return { status: 'exit' }
          break
        case 1: // UN x,y,i
          this.unpack(int(2), int(0), int(1))
          break
        case 2: // LI x,y,i,x2
          this.tiled(false, int(0), int(1), int(2), int(3))
          break
        case 44: // VL x,y,i,y2
          this.tiled(true, int(0), int(1), int(2), int(3))
          break
        case 3: // BO x,y,i,x2,y2 — 9-patch (Dia_Box +Lib.s:21733)
          this.ninePatch(int(0), int(1), int(2), int(3), int(4))
          break
        case 4: // SI sx,sy — sx rounded up to 16
          ch.sizeX = (int(0) + 15) & ~15
          ch.sizeY = int(1)
          break
        case 5: // BA x,y — x masked to 16
          ch.baseX = int(0) & ~15
          ch.baseY = int(1)
          break
        case 6: // PU i
          ch.puzzleBase = int(0)
          break
        case 7: // SV n,v
          ch.setVar(int(0), v[1]!)
          break
        case 40: // SZ v — the next zone's ZoVar (Dia_ZVar)
          ch.nextZone = int(0)
          break
        case 41: // XY a,b,c,d — set XA/YA/XB/YB (Dia_XY)
          ch.xa = int(0)
          ch.ya = int(1)
          ch.xb = int(2)
          ch.yb = int(3)
          break
        case 9: { // PR x,y,text,ink
          this.print(int(0), int(1), str(2), int(3))
          break
        }
        case 10: { // PO x,y,text,p0,p1 — outlined print (Dia_Outline)
          const [x, y, t] = [int(0), int(1), str(2)]
          draw.setWriting(0)
          this.print(x - 1, y, t, int(3))
          this.print(x + 1, y, t, -1)
          this.print(x, y - 1, t, -1)
          this.print(x, y + 1, t, -1)
          this.print(x, y, t, int(4))
          break
        }
        case 43: { // VT x,y,text,pen — vertical text
          const [x, y, t, pen] = [int(0), int(1), str(2), int(3)]
          if (pen >= 0) draw.setPen(pen)
          ch.xa = x
          ch.ya = y
          ch.xb = x
          ch.yb = y
          const h = this.host.textHeight()
          for (let i = 0; i < t.length; i++) {
            draw.text(ch.baseX + x, ch.baseY + y + i * h, t[i]!)
            ch.xb += h // faithful quirk: XB advances, not YB
          }
          break
        }
        case 11: { // IN a,b,c — -1 keeps (order C,B,A in Dia_SInk)
          if (int(2) >= 0) draw.setOutlinePen(int(2))
          if (int(1) >= 0) draw.setBPen(int(1))
          if (int(0) >= 0) draw.setPen(int(0))
          break
        }
        case 12: // SF font,style — -1 keeps
          draw.setFont(int(0), int(1))
          break
        case 13: // SW mode — -1 keeps
          if (int(0) >= 0) draw.setWriting(int(0))
          break
        case 14: // SL pattern — -1 keeps
          if (int(0) >= 0) draw.setLinePattern(int(0))
          break
        case 15: // SP pattern,outline
          draw.setFillPattern(int(0), int(1))
          break
        case 17: // JP label
          this.jumpLabel(int(0))
          break
        case 28: // LA n — re-syncs to just after the label (Dia_Label)
          this.jumpLabel(int(0))
          break
        case 21: // JS label
          this.jsStack.push(this.cur.pos)
          this.jumpLabel(int(0))
          break
        case 22: { // RT
          const ret = this.jsStack.pop()
          if (ret === undefined) this.synt()
          this.cur.pos = ret!
          break
        }
        case 18: { // RU timer,flag — enter the wait loop (Dia_Run)
          ch.timer = int(0)
          ch.runFlags = int(1) & 0xff
          if (ch.runFlags & 1) draw.clearKeys()
          if (ch.runFlags & 2) draw.clearClicks()
          return { status: 'run' }
        }
        case 19: // BR v — button return value into pseudo-var -2
          ch.br = v[0]!
          break
        case 25: // SA n — save block with restore record
          ch.saOrder.push(int(0))
          this.grab(int(0))
          break
        case 27: // BL n — (re)grab without record
          this.grab(int(0))
          break
        case 29: // BQ — quit flag on the current zone
          if (!ch.curZone) this.synt()
          ch.curZone!.quit = true
          break
        case 42: // NW — nowait flag
          if (!ch.curZone) this.synt()
          ch.curZone!.nowait = true
          break
        case 23: { // BC n,pos — change another button (Dia_BChange)
          if (!ch.curZone) this.synt()
          if (ch.curZone!.changing) break
          const [n, pos] = [int(0), int(1)]
          for (const z of ch.zones) {
            if (z.kind !== 'button' || z.number !== n || z === ch.curZone) continue
            if (z.changing) continue
            if (z.pos !== pos) {
              z.changing = true
              z.pos = pos
              zoneDraw(ch, z, this.host, this.draw)
              zoneChange(ch, z, this.host, this.draw)
              z.changing = false
            }
            z.quit = false
          }
          break
        }
        case 24: { // KY code,shift — key affectation for the last zone
          const z: DialogZone = {
            kind: 'key',
            number: 0,
            x: 0,
            y: 0,
            sx: 0,
            sy: 0,
            pos: 0,
            min: 0,
            max: 0,
            rdraw: 0,
            rchange: 0,
            zvar: 0,
            nowait: false,
            quit: false,
            changing: false,
            value: null,
            code: int(0) & 0xff,
            shift: int(1) & 0xff,
            ref: ch.lastZone,
          }
          ch.zones.push(z)
          break
        }
        case 34: // ZC n,pos — update zone n (Dia_ZChange → Dia_ZUpdate)
          if (!ch.curZone) this.synt()
          updateZone(ch, int(0), int(1), null, null, this.host, this.draw)
          break
        case 36: { // GB x1,y1,x2,y2 — filled box, pen A
          const [x1, y1, x2, y2] = [int(0), int(1), int(2), int(3)]
          ch.xa = x1
          ch.ya = y1
          ch.xb = x2
          ch.yb = y2
          if (x2 <= x1 || y2 <= y1) this.fonc()
          draw.rectFill(ch.baseX + x1, ch.baseY + y1, ch.baseX + x2, ch.baseY + y2)
          break
        }
        case 37: { // GS x1,y1,x2,y2 — outline box
          const [x1, y1, x2, y2] = [int(0), int(1), int(2), int(3)]
          ch.xa = x1
          ch.ya = y1
          ch.xb = x2
          ch.yb = y2
          draw.outlineRect(ch.baseX + x1, ch.baseY + y1, ch.baseX + x2, ch.baseY + y2)
          break
        }
        case 38: { // GL x1,y1,x2,y2
          const [x1, y1, x2, y2] = [int(0), int(1), int(2), int(3)]
          ch.xa = x1
          ch.ya = y1
          ch.xb = x2
          ch.yb = y2
          draw.line(ch.baseX + x1, ch.baseY + y1, ch.baseX + x2, ch.baseY + y2)
          break
        }
        case 39: { // IF cond;[...] (Dia_If +Lib.s:21565)
          const cond = int(0)
          const bracket = this.cur.next()
          if (bracket.ch !== '[') this.synt()
          if (cond !== 0) {
            // run the block; the nested Dia_Loop restores a6 to the block
            // start on `]`, so the closing skip consumes exactly the block
            this.frames.push({ kind: 'if', ret: this.cur.pos })
          } else {
            this.skipBrackets()
          }
          break
        }
        case 46: {
          // CA addr — calls 68k machine code. Only an address the host has
          // named is callable; see `machineCalls`.
          const fn = ch.machineCalls.get(int(0))
          if (fn === undefined) this.fonc()
          fn!()
          break
        }
        case 47: // SM — interactive screen drag (no-op in the port)
          break
        case 48: { // GE x,y,r1,r2
          const [x, y, r1, r2] = [int(0), int(1), int(2), int(3)]
          if (r1 <= 0 || r2 <= 0) this.fonc()
          // faithful quirk: XA/YA both get x, XB/YB both get y
          ch.xa = x
          ch.ya = x
          ch.xb = y
          ch.yb = y
          draw.ellipse(ch.baseX + x, ch.baseY + y, r1, r2)
          break
        }
        case 49: { // GP x,y,i — unbased plot (Dia_GPlot quirks kept)
          const [x, y, i] = [int(0), int(1), int(2)]
          if (i >= 0) draw.setPen(i)
          ch.xa = x
          ch.ya = x
          ch.xb = y + 1
          ch.yb = y + 1
          draw.plot(x, y)
          break
        }
        case 8: // IL slot 8 — Dia_Illegal executes a literal `illegal` CPU
        // trap in the 68k (a debug leftover, +Lib.s:21851); raised as a
        // dialog syntax error here rather than crashing the host
        case 35: // UI reached at runtime — Dia_Synt
          this.synt()
          break
        default:
          this.synt()
      }
    }
  }

  /** instructions with 7+ parameters parse their own arguments (.Params) */
  private bigInstr(idx: number): void {
    if (idx === 50) {
      // SS a,b,c,p,a,b,c,p (Dia_SetSlider): 8 bytes, then copied over the
      // active set
      for (let i = 0; i < 8; i++) this.ch.sliderCfg[i] = this.evalInt() & 0xff
      for (let i = 0; i < 8; i++) this.ch.sliderCfg[8 + i] = this.ch.sliderCfg[i]!
      return
    }
    if (idx === 16) {
      // BU z,x,y,sx,sy,pos,min,max;[draw][change] (Dia_Button +Lib.s:22539)
      const z = this.zoneHeader('button')
      z.pos = this.evalInt()
      z.min = this.evalInt()
      z.max = this.evalInt()
      z.rdraw = this.getRout()
      z.rchange = this.getRout()
      this.ch.zones.push(z)
      this.ch.lastZone = z
      zoneDraw(this.ch, z, this.host, this.draw)
      return
    }
    if (idx === 20 || idx === 26) {
      // ED n,x,y,len,maxlen,init$,pap,pen / DI n,x,y,len,value,flag,pap,pen
      // (Dia_Edit 22066 / Dia_Digit 22030 via Dia_EdDiRout 22403)
      const z = this.edDiHeader(idx === 20 ? 'edit' : 'digit')
      if (idx === 20) {
        const maxLen = this.evalInt()
        if (maxLen <= 0 || maxLen > 1024) this.fonc()
        z.maxLen = maxLen
        z.text = this.evalStr().slice(0, maxLen)
      } else {
        const value = this.evalInt()
        const flag = this.evalInt()
        // digit fields edit up to window-width - 1 chars ("Largeur=
        // largeur fenetre-1", Dia_Digit +Lib.s:22023-22025)
        z.maxLen = (z.sx >> 3) - 1
        z.text = flag & 1 ? String(value) : ''
      }
      z.pap = this.evalInt()
      z.pen = this.evalInt()
      this.ch.zones.push(z)
      this.ch.lastZone = z
      drawEditZone(this.ch, z, this.draw)
      return
    }
    if (idx === 30 || idx === 31) {
      // HS/VS n,x,y,sx,sy,pos,window,total,step;[change] (Dia_Slider 22443)
      const z = this.zoneHeader('slider')
      z.vertical = idx === 31
      z.pos = this.evalInt()
      z.size = this.evalInt() // Sl_Window
      z.total = this.evalInt() // Sl_Global
      z.step = this.evalInt() // Sl_Scroll
      z.rchange = this.getRout()
      this.ch.zones.push(z)
      // no lastZone: only BU/ED/DI set Dia_LastZone (+Lib.s:22544/22073/
      // 22036), so KY cannot attach to sliders, lists or hypertext
      drawSliderZone(this.ch, z, this.draw)
      return
    }
    if (idx === 32 || idx === 33) {
      // AL n,x,y,tx,ty,array,pos,flags,pap,pen;[change] (Dia_List
      // +Lib.s:22309). Only AL reaches here: the first-match scan resolves
      // 'IL' to slot 8 (Dia_Illegal) in the 68k and here alike, so the
      // Inactive List entry at index 33 is dead in both implementations.
      const z = this.edDiHeader('list')
      z.rows = this.evalInt()
      z.sy = z.rows * 8
      const handle = this.evalInt()
      let count = 0
      if (handle !== 0) {
        if (handle <= 1024) this.fonc()
        const arr = this.host.resolveArray(handle)
        if (!arr || arr.length >= 32768) this.fonc()
        count = arr!.length
      }
      z.handle = handle
      z.count = count
      const pos = this.evalInt()
      z.scroll = pos >= count ? count : pos
      z.sel = -1
      z.pos = -1
      z.listFlags = this.evalInt() & 0xff
      z.pap = this.evalInt()
      z.pen = this.evalInt()
      z.rchange = this.getRout()
      this.ch.zones.push(z) // no lastZone (lists don't set Dia_LastZone)
      drawListZone(this.ch, z, this.host, this.draw)
      return
    }
    if (idx === 45) {
      // HT n,x,y,tx,ty,text,pos,zones,pap,pen;[change] (Dia_HyperText
      // +Lib.s:22164): text lines with {[keyword,pen,pap]segment} links
      const z = this.edDiHeader('hyper')
      z.rows = this.evalInt()
      z.sy = z.rows * 8
      const text = this.evalOne()
      if (typeof text === 'string') {
        // port extension: a string variable (Vdialog$) works directly
        z.htText = text
      } else {
        // the 68k takes a raw address of a NUL-terminated buffer; values
        // <= 1024 are rejected (`cmp.l #1*1024,d0` +Lib.s:22182)
        if (text <= 1024) this.fonc()
        const bytes = this.host.readMem(text, 1 << 20)
        if (!bytes) this.fonc()
        let end = 0
        while (end < bytes!.length && bytes![end] !== 0) end++
        let s = ''
        for (let i = 0; i < end; i++) s += String.fromCharCode(bytes![i]!)
        z.htText = s
      }
      z.htLines = splitHyperLines(z.htText!)
      // the line count lands in Dia_NextZone (+Lib.s:22276), so a ZV right
      // after an HT statement reads how many lines the text split into
      this.ch.nextZone = z.htLines.length
      z.scroll = this.evalInt()
      this.evalInt() // zones per line cap (DispMax) — not needed here
      z.pap = this.evalInt()
      z.pen = this.evalInt()
      z.rchange = this.getRout()
      z.pos = 0
      z.text = ''
      this.ch.zones.push(z) // no lastZone (HT doesn't set Dia_LastZone)
      drawHyperZone(this.ch, z, this.draw)
      return
    }
    this.synt()
  }

  /** Dia_EdDiRout: edit/digit header — x masked to 16, even char width, 8px rows */
  private edDiHeader(kind: ZoneKind): DialogZone {
    const ch = this.ch
    const number = this.evalInt()
    const rx = this.evalInt()
    ch.xa = rx
    ch.xb = rx
    const zx = (ch.baseX + rx) & ~15
    const ry = this.evalInt()
    ch.ya = ry
    ch.yb = ry + 8
    const zy = ch.baseY + ry
    const chars = (this.evalInt() + 1) & ~1
    if (chars === 0) this.synt()
    ch.xb += chars
    return {
      kind,
      number,
      x: zx,
      y: zy,
      sx: chars * 8,
      sy: 8,
      pos: 0,
      min: 0,
      max: 0,
      rdraw: 0,
      rchange: 0,
      zvar: ch.nextZone,
      nowait: false,
      quit: false,
      changing: false,
      value: null,
      text: '',
    }
  }

  /** Dia_GetEntete: zone number + geometry (base added), XA/YB updated */
  private zoneHeader(kind: ZoneKind): DialogZone {
    const ch = this.ch
    const number = this.evalInt()
    const rx = this.evalInt()
    const ry = this.evalInt()
    const sx = this.evalInt()
    const sy = this.evalInt()
    ch.xa = rx
    ch.ya = ry
    ch.xb = rx + sx
    ch.yb = ry + sy
    return {
      kind,
      number,
      x: ch.baseX + rx,
      y: ch.baseY + ry,
      sx,
      sy,
      pos: 0,
      min: 0,
      max: 0,
      rdraw: 0,
      rchange: 0,
      zvar: ch.nextZone,
      nowait: false,
      quit: false,
      changing: false,
      value: null,
    }
  }

  /**
   * Dia_GetRout +Lib.s:23849: a `[...]` routine — offset, or 0 when empty.
   *
   * DEVIATION: the 68k peek desynchronizes its bracket-depth count when the
   * routine's first char is another `[`. That bug is not reproduced — we
   * re-scan from the saved position, which is what the code plainly intends.
   */
  private getRout(): number {
    const bracket = this.cur.next()
    if (bracket.ch !== '[') this.synt()
    const off = this.cur.pos
    // peek: an immediately-closing bracket means "no routine"
    const save = this.cur.pos
    const peek = this.cur.next()
    if (peek.ch === ']') return 0
    this.cur.pos = save
    this.skipBrackets()
    return off
  }

  /** `]` or EX: pop a frame, or end the routine (returns true at top level) */
  private routineEnd(): boolean {
    const f = this.frames.pop()
    if (!f) return true
    if (f.kind === 'ui') {
      this.ch.uiParams.pop()
      this.cur.pos = f.ret
      return false
    }
    // if-frame: rewind to the block start and skip it as text (Dia_If
    // .Skip — a6 was restored to the block start by the nested Dia_Loop)
    this.cur.pos = f.ret
    this.skipBrackets()
    return false
  }

  /** unknown mnemonic: user-instruction call (Dia_Loop .Inst) */
  private userCall(mn: string): void {
    const def = this.ch.userInstrs.get(mn)
    if (!def) this.synt()
    if (this.ch.uiParams.length >= 10) this.fonc()
    const params: DialogValue[] = []
    if (def!.nParams === 0) {
      this.cur.next()
    } else {
      for (let i = 0; i < def!.nParams; i++) params.push(this.evalOne())
    }
    this.frames.push({ kind: 'ui', ret: this.cur.pos })
    this.ch.uiParams.push(params)
    this.cur.pos = def!.off
  }

  /** UN: stamp resource image i+puzzleBase at x,y (Dia_Unpack) */
  private unpack(i: number, x: number, y: number): void {
    const ch = this.ch
    const n = i + ch.puzzleBase
    if (n <= 0) this.synt()
    const g = ch.res.graphics
    if (!g || n > g.count) this.synt()
    const pic = g.image(n)
    if (!pic) this.synt()
    ch.xa = x
    ch.ya = y
    ch.xb = x
    ch.yb = y
    this.draw.stamp(pic!, ch.baseX + x, ch.baseY + y)
    ch.puzzleSx = pic!.width
    ch.puzzleSy = pic!.height
    ch.xb += pic!.width
    ch.yb += pic!.height
  }

  /** LI/VL: middle image i+1 tiled, capped by i and i+2 (Dia_Line/VLine) */
  private tiled(vertical: boolean, x: number, y: number, i: number, end: number): void {
    const ch = this.ch
    let cx = x
    let cy = y
    if (!vertical) {
      cx &= ~7
      end &= ~7
    } else {
      cx &= ~7
    }
    const start = vertical ? cy : cx
    let rem = end - start
    if (rem <= 0) this.fonc()
    // the body
    for (;;) {
      this.unpack(i + 1, cx, cy)
      const step = vertical ? ch.puzzleSy : ch.puzzleSx
      if (step === 0) break
      if (vertical) cy += step
      else cx += step
      rem -= step
      if (rem < step) break
    }
    // the near cap (image i at the original position)
    this.unpack(i, vertical ? cx & ~7 : x & ~7, vertical ? y : cy)
    // the far cap (image i+2 at end minus the cap size just recorded)
    if (vertical) this.unpack(i + 2, cx & ~7, end - ch.puzzleSy)
    else this.unpack(i + 2, end - ch.puzzleSx, cy)
    // Dia_BFin
    ch.xa = x & ~7
    ch.ya = y
  }

  /** BO: 9-patch — middle row drawn then copied down, then top and bottom */
  private ninePatch(x: number, y: number, i: number, x2: number, y2: number): void {
    const ch = this.ch
    let rem = y2 - y
    if (rem <= 0) this.fonc()
    // middle row (images i+3..i+5) at the top position
    this.tiled(false, x, y, i + 3, x2)
    const rowH = ch.puzzleSy
    if (rowH > 0) {
      rem -= rowH
      if (rem > 0) {
        let ySrc = y
        for (;;) {
          this.draw.copyRect(ch.baseX + (x & ~7), ch.baseY + ySrc, ch.baseX + (x2 & ~7), rowH, ch.baseY + ySrc + rowH)
          ySrc += rowH
          rem -= rowH
          if (rem < rowH) break
        }
      }
    }
    // top row (images i..i+2)
    this.tiled(false, x, y, i, x2)
    // bottom row (images i+6..i+8)
    this.tiled(false, x, y2 - ch.puzzleSy, i + 6, x2)
    ch.xa = x & ~7
    ch.ya = y
  }

  private print(x: number, y: number, t: string, ink: number): void {
    const ch = this.ch
    if (ink >= 0) this.draw.setPen(ink)
    ch.xa = x
    ch.ya = y
    ch.xb = x
    ch.yb = y
    this.draw.text(ch.baseX + x, ch.baseY + y, t)
    ch.xb += this.host.textWidth(t)
    ch.yb += this.host.textHeight()
  }

  /** SA/BL: grab the whole dialog box area as block n (Dia_Block2) */
  private grab(n: number): void {
    const ch = this.ch
    const bx = ch.baseX & ~15
    const sub = ch.baseX - bx
    const w = (ch.sizeX + sub + 15) & ~15
    ch.blocks.set(n, { saved: this.draw.grabBlock(bx, ch.baseY, w, ch.sizeY) })
  }

}

// ---- zone routine execution (Dia_BtDraw / Dia_ZoChange, +Lib.s:23817/24030) ----

interface ZoneSnapshot {
  baseX: number
  baseY: number
  sizeX: number
  sizeY: number
  xa: number
  ya: number
  xb: number
  yb: number
  bp: number | string
  br: number | string
  curZone: DialogZone | null
}

function snapshot(ch: DialogChannel): ZoneSnapshot {
  const { baseX, baseY, sizeX, sizeY, xa, ya, xb, yb, bp, br, curZone } = ch
  return { baseX, baseY, sizeX, sizeY, xa, ya, xb, yb, bp, br, curZone }
}

function restore(ch: DialogChannel, s: ZoneSnapshot): void {
  Object.assign(ch, s)
}

/**
 * Run a zone's [draw] routine with base/size set to the zone rectangle and
 * BP = the zone position (Dia_BtDraw).
 */
export function zoneDraw(ch: DialogChannel, z: DialogZone, host: DialogHost, draw: DialogDraw): void {
  if (z.rdraw <= 0) return
  const save = snapshot(ch)
  ch.sizeX = z.sx
  ch.sizeY = z.sy
  ch.baseX = z.x
  ch.baseY = z.y
  ch.bp = z.pos
  ch.curZone = z
  try {
    new DialogExec(ch, host, draw).run(z.rdraw)
  } finally {
    restore(ch, save)
  }
}

/**
 * Run a zone's [change] routine: BP = BR = position, quit/nowait cleared
 * first; returns the routine's BR result (the new position). Without a
 * routine the current position comes straight back (Dia_ZoChange).
 */
export function zoneChange(ch: DialogChannel, z: DialogZone, host: DialogHost, draw: DialogDraw): number {
  if (z.rchange <= 0) return z.pos
  const save = snapshot(ch)
  ch.bp = z.pos
  ch.br = z.pos
  ch.curZone = z
  z.quit = false
  z.nowait = false
  try {
    new DialogExec(ch, host, draw).run(z.rchange)
    return typeof ch.br === 'number' ? ch.br : 0
  } finally {
    restore(ch, save)
  }
}

/** draw an ED/DI field (the edit window content, Dia_Edit2 .Init string) */
export function drawEditZone(ch: DialogChannel, z: DialogZone, draw: DialogDraw): void {
  const active = ch.edited === z
  draw.editField(z.x, z.y, z.sx >> 3, z.text ?? '', z.pap ?? 0, z.pen ?? 1, active ? (z.text ?? '').length : -1)
}

/** draw an HS/VS slider zone with the channel's colours (Dia_Slider Sl_Draw) */
export function drawSliderZone(ch: DialogChannel, z: DialogZone, draw: DialogDraw): void {
  draw.dialogSlider(ch.sliderCfg, z.vertical === true, z.x, z.y, z.sx, z.sy, z.total ?? 0, z.pos, z.size ?? 0)
}

/**
 * AL/IL list rendering (Dia_LiAff +Lib.s:23706): elements are strings
 * (BASIC string arrays through =Array); flags bit0 prefixes "n - " index
 * numbers (bit1: 1-based); the selected row draws inverted.
 */
export function drawListZone(_ch: DialogChannel, z: DialogZone, host: DialogHost, draw: DialogDraw): void {
  const wChars = z.sx >> 3
  const arr = z.handle ? host.resolveArray(z.handle) : null
  const numW = String(z.count ?? 0).length
  for (let r = 0; r < (z.rows ?? 0); r++) {
    const i = (z.scroll ?? 0) + r
    let text = ''
    if (arr && i >= 0 && i < arr.length) {
      if ((z.listFlags ?? 0) & 1) {
        const shown = (z.listFlags ?? 0) & 2 ? i + 1 : i
        text = String(shown).padStart(numW) + ' - '
      }
      text += String(arr[i])
    }
    const selected = i === z.sel
    const pen = selected ? (z.pap ?? 0) : (z.pen ?? 1)
    const pap = selected ? (z.pen ?? 1) : (z.pap ?? 0)
    draw.editField(z.x, z.y + r * 8, wChars, '', pap, pen, -1)
    draw.textCells(z.x, z.y + r * 8, text.slice(0, wChars), pen, pap)
  }
}

/**
 * Split hypertext into lines (Dia_HyperText line scan, +Lib.s:22245-22270).
 * LF or CR each end a line, and only a FOLLOWING CR is absorbed into the
 * break: the CR-then-LF pairing at .C13 is dead code (both 10 and 13 branch
 * into .C10), so a CRLF text faithfully produces an extra blank line.
 * ESC skips the next TWO chars (.CEsc `addq.l #2,a0`). The final line is
 * always recorded (.CFini), so a trailing newline yields a trailing empty
 * line and the empty text is one empty line.
 */
export function splitHyperLines(text: string): string[] {
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '\x1b') {
      i += 2
      continue
    }
    if (c === '\n' || c === '\r') {
      if (text[i + 1] === '\r') i++
      lines.push(cur)
      cur = ''
      continue
    }
    // other sub-32 bytes stay inside the 68k line slice and would render
    // as raw glyphs; dropped here (display-level deviation)
    if (c >= ' ') cur += c
  }
  lines.push(cur)
  return lines
}

/**
 * HT rendering (Dia_TxDraw/TxAff): plain text in pen on paper; active
 * segments `{[keyword,pen,pap]shown}` drawn highlighted (default: colours
 * swapped) and recorded for hit-testing.
 */
export function drawHyperZone(_ch: DialogChannel, z: DialogZone, draw: DialogDraw): void {
  const wChars = z.sx >> 3
  const pap = z.pap ?? 0
  const pen = z.pen ?? 1
  z.htZones = []
  for (let r = 0; r < (z.rows ?? 0); r++) {
    const line = z.htLines?.[(z.scroll ?? 0) + r] ?? ''
    draw.editField(z.x, z.y + r * 8, wChars, '', pap, pen, -1)
    let x = 0
    let i = 0
    while (i < line.length && x < wChars) {
      if (line[i] === '{' && line[i + 1] === '[') {
        const endKey = line.indexOf(']', i + 2)
        const endSeg = line.indexOf('}', endKey >= 0 ? endKey : i)
        if (endKey < 0 || endSeg < 0) {
          i++
          continue
        }
        const keyPart = line.slice(i + 2, endKey)
        const [key, penS, papS] = keyPart.split(',')
        const shown = line.slice(endKey + 1, endSeg)
        const sPen = penS !== undefined && penS !== '' ? parseInt(penS, 10) : pap
        const sPap = papS !== undefined && papS !== '' ? parseInt(papS, 10) : pen
        const clipped = shown.slice(0, Math.max(0, wChars - x))
        draw.textCells(z.x + x * 8, z.y + r * 8, clipped, sPen, sPap)
        z.htZones.push({ row: r, x0: x, x1: x + clipped.length, key: key || shown })
        x += clipped.length
        i = endSeg + 1
        continue
      }
      // plain run until the next '{'
      let next = line.indexOf('{', i)
      if (next < 0) next = line.length
      const run = line.slice(i, next).slice(0, Math.max(0, wChars - x))
      draw.textCells(z.x + x * 8, z.y + r * 8, run, pen, pap)
      x += run.length
      i = next === i ? i + 1 : next
    }
  }
}

/** activate the first edit/digit zone (Dia_EdFirst +Lib.s:24596) */
export function editFirst(ch: DialogChannel, draw: DialogDraw): void {
  const prev = ch.edited
  ch.edited = ch.zones.find((z) => z.kind === 'edit' || z.kind === 'digit') ?? null
  if (prev !== ch.edited) {
    if (prev) drawEditZone(ch, prev, draw)
    if (ch.edited) drawEditZone(ch, ch.edited, draw)
  }
}

/** move to the next edit zone, wrapping (Dia_EdNext) */
export function editNext(ch: DialogChannel, draw: DialogDraw): void {
  const edits = ch.zones.filter((z) => z.kind === 'edit' || z.kind === 'digit')
  if (edits.length === 0) return
  const i = ch.edited ? edits.indexOf(ch.edited) : -1
  const prev = ch.edited
  ch.edited = edits[(i + 1) % edits.length]!
  if (prev && prev !== ch.edited) drawEditZone(ch, prev, draw)
  if (ch.edited) drawEditZone(ch, ch.edited, draw)
}

/** hit-test the channel's zones at screen coords (Dia_GetZ +Lib.s:24591) */
export function dialogZoneAt(ch: DialogChannel, x: number, y: number): DialogZone | null {
  for (const z of ch.zones) {
    if (z.kind === 'key') continue
    if (x >= z.x && x < z.x + z.sx && y >= z.y && y < z.y + z.sy) return z
  }
  return null
}

/** the item-th zone with a number (Dia_GetZoneAd +Lib.s:20902) */
export function dialogZoneByNumber(ch: DialogChannel, n: number, item = 1): DialogZone | null {
  let left = item
  for (const z of ch.zones) {
    if (z.kind === 'key' || z.number !== n) continue
    if (--left <= 0) return z
  }
  return null
}

/** a zone's result value + type (Dia_GetValue +Lib.s:20843) */
export function dialogZoneValue(z: DialogZone): { n: number; s: string | null } {
  switch (z.kind) {
    case 'button':
    case 'slider':
    case 'list':
      return { n: z.pos, s: null }
    case 'hyper':
      return z.pos !== 0 ? { n: z.pos, s: null } : { n: 0, s: z.text ?? '' }
    case 'digit': {
      const v = parseInt(z.text ?? '', 10)
      return { n: Number.isNaN(v) ? 0 : v, s: null }
    }
    case 'edit':
      return { n: 0, s: z.text ?? '' }
    default:
      return { n: 0, s: null }
  }
}

/**
 * Dialog Update / ZC: push a new value into every zone numbered n except
 * the current one (Dia_ZUpdate +Lib.s:23916). Per kind: buttons redraw and
 * fire their change routine even when the value is elided, but skip both
 * when it matches (.Bt); sliders take p5→total, p4→window, v→position and
 * ALWAYS redraw AND fire the change routine (.Sl 23966-23967); lists take
 * p5→max activable, p4→active row (also ZoPos), v→list position, unclamped,
 * and always redraw (.Li); hypertext skips entirely when the value is
 * elided (.Tx 23993-23994); string edits take a string value, digits the
 * decimal of an int (.Ed/.Di). Bt/Sl/Li/Tx clear the zone's quit flag
 * ("Pas de sortie!"); edit/digit don't.
 */
export function updateZone(
  ch: DialogChannel,
  n: number,
  v: number | string | null,
  p4: number | null,
  p5: number | null,
  host: DialogHost,
  draw: DialogDraw,
): void {
  for (const z of ch.zones) {
    if (z.kind === 'key' || z.number !== n || z === ch.curZone) continue
    if (z.kind === 'button') {
      const nv = typeof v === 'number' ? v : null
      if (nv !== null && nv === z.pos) {
        z.quit = false
        continue
      }
      if (nv !== null) z.pos = nv
      zoneDraw(ch, z, host, draw)
      zoneChange(ch, z, host, draw)
      z.quit = false
    } else if (z.kind === 'slider') {
      if (p5 !== null) z.total = p5
      if (p4 !== null) z.size = p4
      if (typeof v === 'number') z.pos = v
      drawSliderZone(ch, z, draw)
      zoneChange(ch, z, host, draw)
      z.quit = false
    } else if (z.kind === 'edit' || z.kind === 'digit') {
      if (v === null) continue
      if (z.kind === 'edit') {
        // an int here would be a bad string pointer (`cmp.l #1*1024`
        // +Lib.s:24006 → function call error)
        if (typeof v !== 'string') throw new DialogError(9, 0)
        z.text = v.slice(0, z.maxLen ?? 1024)
      } else {
        z.text = String(typeof v === 'number' ? v : 0)
      }
      drawEditZone(ch, z, draw)
    } else if (z.kind === 'list') {
      if (p5 !== null) z.count = p5
      if (p4 !== null) {
        z.sel = p4
        z.pos = p4
      }
      if (typeof v === 'number') z.scroll = v
      drawListZone(ch, z, host, draw)
      z.quit = false
    } else if (z.kind === 'hyper') {
      if (typeof v !== 'number') continue
      z.scroll = v
      drawHyperZone(ch, z, draw)
      z.quit = false
    }
  }
}

/**
 * Erase a drawn dialog (Dia_EffChanA0 +Lib.s:20726): close edit windows,
 * restore SA blocks in reverse order, delete them.
 */
export function eraseDialog(ch: DialogChannel, draw: DialogDraw): void {
  if (!ch.drawn) return
  draw.activate(ch.screenNb)
  for (let i = ch.saOrder.length - 1; i >= 0; i--) {
    const n = ch.saOrder[i]!
    const b = ch.blocks.get(n)
    if (b) {
      draw.putBlock(b.saved)
      ch.blocks.delete(n)
    }
  }
  ch.saOrder = []
  ch.blocks.clear()
  ch.edited = null
  ch.drag = null
  // zone records survive the erase — Rdialog reads them until the next
  // Dialog Run resets the buffer (Dia_RunProgram clears it, not the erase)
  draw.deactivate()
  ch.drawn = false
}
