/**
 * `PTest` (+Verif.s:73): the pass AMOS runs over a program before it runs it.
 *
 * The verifier is not a syntax checker bolted on the side. It WRITES: it
 * promotes a name to a procedure call or a line-number reference, swaps an
 * instruction for the argument-count variant that matches, counts an
 * extension's arguments into the byte behind its slot, and fills the link
 * words the interpreter jumps through. A saved program is what the verifier
 * left behind, not what `Tokenise` wrote, which is why the round trip in
 * ./roundtrip.ts has to clear those fields before it can compare bytes.
 *
 * This is PASS ONE. `SsTest` (:225) walks the token stream instruction by
 * instruction, picking a handler from the class byte the loaded token table
 * carries during a verification (see ./verif.gen.ts), and each handler knows
 * the shape of its own arguments. Phase 0 covers the main program and steps
 * OVER every procedure body; each procedure is then walked in a phase of its
 * own, which is where local variables come from.
 *
 * So what lands here is the argument matching and the promotions: the variant
 * an instruction resolves to, the count behind an extension slot, `Add`
 * choosing between its two forms, `Data`'s offset from the head of its line,
 * and a name becoming a procedure call or a line-number reference. Pass one
 * ZEROES the branch links rather than filling them, exactly as `clr.w (a6)+`
 * does, and it leaves the variable record's runtime link alone.
 *
 * Pass two is not here. `VerX` (:496) walks the relocation list to doke the
 * variable offsets and the label addresses, and `TablA` matches every open
 * structure to the one that closes it, which is where `For` learns the
 * distance to its `Next`. Those three fields are what ./roundtrip.ts still
 * has to clear.
 *
 * Measured over the 566 programs in fixtures/: 562 verify. Two want an equate
 * bank, which no part of this port reads yet, and two use an extension slot
 * nothing on this machine can identify, which is the error AMOS raises too.
 */
import { OPERATORS, T, TokenTable } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { VERIF_CLASSES } from './verif.gen'
import { TK } from './edtok'
import type { TokenEntry } from './libtok'
import { ED_TST_MESSAGES } from '../runtime/edmessages.gen'

/** the token ids the verifier branches on, from `+Equ.s:1995-2118` */
const TKV = {
  MINUS: 0xffca,
  COLON: 0x0054,
  COMMA: 0x005c,
  SEMICOLON: 0x0064,
  HASH: 0x006c,
  PAREN1: 0x0074,
  PAREN2: 0x007c,
  BRA1: 0x0084,
  BRA2: 0x008c,
  TO: 0x0094,
  AS: 0x01e6,
  GOTO: 0x02a8,
  GOSUB: 0x02b2,
  STEP: 0x0356,
  PROC: 0x0386,
  END_PROC: 0x0390,
  SHARED: 0x039e,
  GLOBAL: 0x03aa,
  USING: 0x04a6,
  MENU_CLOSE: 0x0934,
  SCREEN_DISPLAY: 0x0a18,
  SCREEN_OFFSET: 0x0a36,
  SCREEN_SIZE: 0x0a4e,
  RAINBOW: 0x0ddc,
  SPRITE: 0x1a94,
  BOB: 0x1b9e,
  ADD2: 0x0458,
  ADD4: 0x0462,
  /** `MnNDim`, the ceiling VerMn puts on a menu subscript */
  MENU_DIMS: 8,
} as const

/**
 * The verifier's own error table, `.Test1` in +Editor_Config.s. The codes are
 * the `moveq #N,d0` in front of each `bra VerErr` (+Verif.s:601-706) and are
 * one-based against ED_TST_MESSAGES.
 */
export const VERR = {
  BAD_STRUCTURE: 1,
  EXTENSION_MISSING: 5,
  ILLEGAL_DIRECT: 7,
  NO_EMPTY_BRACKETS: 14,
  SHARED_ALONE: 15,
  PROC_LIMITS_ALONE: 16,
  PROC_NOT_CLOSED: 17,
  PROC_NOT_OPENED: 18,
  ILLEGAL_PARAM_COUNT: 19,
  UNDEFINED_PROC: 20,
  DATA_AT_LINE_START: 4,
  USER_FN: 2,
  SYNTAX: 35,
  NOT_DIMENSIONED: 38,
  ALREADY_DIMENSIONED: 39,
  TYPE: 40,
  LABEL_TWICE: 42,
  TRAP: 43,
  EQU_TYPE: 54,
} as const

/**
 * Where a handler leaves the walk. Every arm of the instruction table ends in
 * one of four branches, and they are not interchangeable: `VerDP` demands a
 * colon or the end of the line before the next instruction, `VerLoop` reads
 * the next instruction straight away, which is what `Then` and a label do.
 */
type Go = 'dp' | 'loop' | 'line' | 'phase'

/** what `VerErr` (+Verif.s:711) throws away the whole verification with */
export class VerifyError extends Error {
  constructor(
    readonly code: number,
    readonly at: number,
  ) {
    super(`${ED_TST_MESSAGES[code - 1] ?? `verify error ${code}`} at $${at.toString(16)}`)
    this.name = 'VerifyError'
  }
}

/** VERIF_CLASSES by id, built once */
const CLASSES = new Map(VERIF_CLASSES.map((v) => [v.id, v]))
const CORE = new TokenTable(CORE_TOKENS)

/**
 * A token table with an entry-order index, because `VerC4` walks FORWARD from
 * one entry to the next when a spec did not match. It reaches the next entry
 * by address (`sub.l VerBase(a5),d0`), and an id is that address, so stepping
 * the array is the same step.
 */
interface Indexed {
  table: TokenTable
  entries: TokenEntry[]
  at: Map<number, number>
}
const indexed = new WeakMap<TokenTable, Indexed>()
function index(table: TokenTable): Indexed {
  let ix = indexed.get(table)
  if (ix === undefined) {
    const entries = table.entries as TokenEntry[]
    ix = { table, entries, at: new Map(entries.map((e, i) => [e.id, i])) }
    indexed.set(table, ix)
  }
  return ix
}

/** the variable-name record `V1_StoVar` builds, from `Sh1a` (+Verif.s:3860) */
interface VarRec {
  /** the padded name length, byte 0, which is part of the identity */
  len: number
  /** the type and array flags, byte 1 */
  flag: number
  /** byte 2, the offset in the variable buffer that pass two dokes back */
  offset: number
  /** byte 4, how many subscripts `Dim` gave it */
  dims: number
  /** byte 5: 0 local, 1 marked by Shared, 2 global for good */
  global: number
  name: string
}

export interface VerifyOptions {
  /** token tables for extensions, keyed by the slot number the line stores */
  extensions?: Map<number, TokenTable>
  /**
   * The slots holding an AP20-format library, `LBF_20` in `LB_Flags`
   * (+B.s:2255). Those count their own arguments, so `Ver_Extension` pokes
   * $FF where the count would go instead of the count.
   */
  ap20?: Set<number>
}

class Verifier {
  /** a6 */
  p = 0
  /** VerPos, the position an error points at */
  pos = 0
  /** VDLigne, the head of the line being walked */
  line = 0
  /** Parenth: how deep the expression is, and -1 once a function's own ) went by */
  paren = 0
  /** Phase: 0 is the main program, and every procedure gets one of its own */
  phase = 0
  /** VarLong, the next free offset in this phase's variable buffer */
  varLong = 0
  /** VNm, this phase's names; in phase 0 it becomes DVNm */
  locals: VarRec[] = []
  /** DVNm, the main program's names, which Shared makes reachable from a procedure */
  globals: VarRec[] = []
  /** every Procedure line phase 0 stepped over, to walk in a phase of its own */
  procedures: number[] = []

  constructor(
    readonly b: Uint8Array,
    readonly ext: Map<number, TokenTable>,
    readonly ap20: Set<number>,
  ) {}

  /* ---- the bytes ------------------------------------------------------- */

  u16(at: number): number {
    // AMOS reads whatever follows a malformed block; this port would read
    // undefined and walk on with a NaN pointer, so the walk stops instead
    if (at < 0 || at + 2 > this.b.length) throw new VerifyError(VERR.SYNTAX, this.pos)
    return (this.b[at]! << 8) | this.b[at + 1]!
  }

  put16(at: number, v: number): void {
    this.b[at] = (v >>> 8) & 0xff
    this.b[at + 1] = v & 0xff
  }

  /** `move.w (a6)+,d0` */
  next(): number {
    const v = this.u16(this.p)
    this.p += 2
    return v
  }

  /** `move.w (a6),d0` */
  peek(): number {
    return this.u16(this.p)
  }

  syntax(): never {
    throw new VerifyError(VERR.SYNTAX, this.pos)
  }

  fail(code: number): never {
    throw new VerifyError(code, this.pos)
  }

  /** `Finie` (+Verif.s:3897): nothing left that belongs to this instruction */
  finie(at = this.p): boolean {
    const d0 = this.u16(at)
    return d0 === 0 || d0 === TKV.COLON || d0 === TK.THEN || d0 === TK.ELSE
  }

  /** `cmp.w #_Tkx,(a6)+ / bne VerSynt` */
  want(id: number): void {
    this.pos = this.p
    if (this.next() !== id) this.syntax()
  }

  /** takes the token if it is there, the way `cmp.w / beq.s` reads */
  take(id: number): boolean {
    if (this.peek() !== id) return false
    this.p += 2
    return true
  }

  /* ---- the main loop --------------------------------------------------- */

  /** `SsTest` over one phase's worth of program, from `at` */
  run(at: number): void {
    this.p = at
    this.paren = 0
    for (;;) {
      // VerD: the line header, and a zero one ends the program. A block read
      // off disk stops one word short of one, because the zero is what
      // `Prg_Load` leaves in memory past the last line rather than something
      // the AmBs chunk carries.
      this.line = this.p
      if (this.p + 2 > this.b.length) return
      const head = this.u16(this.p)
      this.p += 2
      if (head === 0) return
      if (this.statements(true) === 'phase') return
    }
  }

  /**
   * `VerDd` (+Verif.s:250) and `VerLoop` (:271). The two differ only in the
   * six negative classes: at the head of a line they open a procedure or a
   * Data block, and anywhere else they are the errors that say so.
   */
  statements(first: boolean): 'line' | 'phase' {
    let atLineStart = first
    for (;;) {
      this.pos = this.p
      const id = this.next()
      if (id === 0) return 'line'
      if ((id & 0x8000) !== 0) this.syntax()
      const cls = this.classOf(id)
      let go: Go
      if (cls >= 0x80) {
        if (!atLineStart) {
          // VerLoop's own six: Shared and Global give "must be alone on a
          // line", Def Fn and Data "must be at the start", and the procedure
          // limits their own message
          if (cls === 0xfa || cls === 0xfb) this.fail(VERR.SHARED_ALONE)
          if (cls === 0xfc || cls === 0xfd) this.fail(VERR.DATA_AT_LINE_START)
          this.fail(VERR.PROC_LIMITS_ALONE)
        }
        switch (cls) {
          case 0xfa:
          case 0xfb:
            this.verSha()
            go = 'line'
            break
          case 0xfc:
            this.verDFn()
            go = 'dp'
            break
          case 0xfd:
            this.verData()
            go = 'dp'
            break
          case 0xfe:
            this.v1EndProc()
            go = 'phase'
            break
          default:
            go = this.v1Procedure()
        }
      } else {
        go = this.dispatch(cls, id)
      }
      atLineStart = false
      if (go === 'line' || go === 'phase') return go
      if (go === 'loop') continue
      // VerDP: a colon carries on, an Else is left for the next round
      this.pos = this.p
      const after = this.next()
      if (after === 0) return 'line'
      if (after === TKV.COLON) continue
      if (after !== TK.ELSE) this.syntax()
      this.p -= 2
    }
  }

  /** the class byte for a core token; an extension's own table is not swapped here */
  classOf(id: number): number {
    const c = CLASSES.get(id)
    if (c === undefined) this.syntax()
    return c.inst
  }

  opeClassOf(id: number): number {
    const c = CLASSES.get(id)
    if (c === undefined) this.syntax()
    return c.ope
  }

  /** `.Jmp` (+Verif.s:291), the eighty-eight arms of the instruction table */
  dispatch(cls: number, id: number): Go {
    switch (cls) {
      case 0x00: // Ver_Normal
      // 10-Debugging is `bra V1_Debug` only when the build sets Debug=2; the
      // shipped one assembles `bra Ver_Normal` there
      case 0x10:
      case 0x29: // Ver_NormalPro
      case 0x50:
      case 0x51:
      case 0x53:
      case 0x54:
      case 0x55:
      case 0x56:
        this.verNormal(id)
        return 'dp'
      case 0x02:
        this.verRem()
        return 'line'
      case 0x03:
        this.verSetBuffer()
        return 'dp'
      case 0x04:
      case 0x24:
        return 'dp' // Set Double Precision / Set Accessory: nothing to walk
      case 0x05:
        this.verSetStack()
        return 'dp'
      case 0x06: // a variable in instruction position
      case 0x08: // a name the tokeniser already made a procedure call
        this.v1IVariable()
        return 'dp'
      case 0x07:
        return this.verLab()
      case 0x09:
        this.verDim()
        return 'dp'
      case 0x0a:
      case 0x48:
        this.verPrint()
        return 'dp'
      case 0x0b:
        this.verExpE()
        this.want(TKV.COMMA)
        this.verPrint()
        return 'dp'
      case 0x0c:
      case 0x49:
        this.verInput()
        return 'dp'
      case 0x0d:
      case 0x4a:
        this.verExpE()
        this.want(TKV.COMMA)
        this.verInput1()
        return 'dp'
      case 0x0e:
      case 0x16:
        this.verVEnt()
        this.verGV()
        return 'dp'
      case 0x0f:
        this.v1Proc()
        return 'dp'
      case 0x11:
      case 0x12:
        this.verPalette(0)
        return 'dp'
      case 0x13:
        this.verRead()
        return 'dp'
      case 0x14:
        if (!this.finie()) this.v1GoLabel()
        return 'dp'
      case 0x15:
        this.verChannel()
        return 'dp'
      case 0x17:
      case 0x4f:
        this.verAdd()
        return 'dp'
      case 0x18:
        this.verPolyline()
        return 'dp'
      case 0x19:
        this.verField()
        return 'dp'
      case 0x1a:
        this.verCall()
        return 'dp'
      case 0x1b:
        this.verMenu()
        return 'dp'
      case 0x1c:
        if (this.peek() === TKV.PAREN1) this.verMenuIndex()
        return 'dp'
      case 0x1d:
        this.verSetMenu()
        return 'dp'
      case 0x1e:
        this.verMenuKey()
        return 'dp'
      case 0x1f:
        this.verMenuFlags()
        return 'dp'
      case 0x20:
        this.verFade()
        return 'dp'
      case 0x21:
        this.verSort()
        return 'dp'
      case 0x22:
        this.verSwap()
        return 'dp'
      case 0x23:
        this.verFollow()
        return 'dp'
      case 0x25:
        // Trap wants an instruction immediately after it
        if (this.finie()) this.fail(VERR.TRAP)
        return 'loop'
      case 0x26:
      case 0x27:
        this.verStruc(cls === 0x27)
        return 'dp'
      case 0x28:
        this.verExtension()
        return 'dp'
      case 0x2a: // Ver_DejaTesteePro
      case 0x2d: // Ver_DejaTestee
        this.verDejaTestee(id)
        return 'dp'
      case 0x2b: // Ver_VReservee
      case 0x2c:
        this.verVReservee(id)
        return 'dp'
      case 0x2e:
      case 0x2f:
        return 'line'
      case 0x30:
        this.v1For()
        return 'dp'
      case 0x31:
        this.v1Next()
        return 'dp'
      case 0x32:
      case 0x34:
      case 0x36:
        // Repeat, While and Do all clear their link and only While has a test
        this.put16(this.p, 0)
        this.p += 2
        if (cls === 0x34) this.verExpression()
        return 'dp'
      case 0x33:
        this.verExpression()
        return 'dp'
      case 0x35:
      case 0x37:
        return 'dp'
      case 0x38:
        this.v1Exit()
        return 'dp'
      case 0x39:
        this.v1ExitIf()
        return 'dp'
      case 0x3a:
        return this.v1If()
      case 0x3b:
        return this.v1Else()
      case 0x3c:
        this.put16(this.p, 0)
        this.p += 2
        this.verExpE()
        return 'dp'
      case 0x3d:
        return 'dp'
      case 0x3e:
      case 0x3f:
        this.v1GoLabel()
        return 'dp'
      case 0x40:
        return this.v1OnError()
      case 0x41:
        this.v1Proc()
        return 'dp'
      case 0x42:
        this.v1OnMenu()
        return 'dp'
      case 0x43:
        this.v1On()
        return 'dp'
      case 0x44:
        if (!this.finie()) this.v1GoLabel()
        return 'dp'
      case 0x45:
        if (!this.finie()) this.v1GoLabel()
        return 'dp'
      case 0x46:
        this.v1PopProc()
        return 'dp'
      case 0x47:
        this.v1Every()
        return 'dp'
      case 0x4b:
      case 0x4c:
      case 0x4d:
      case 0x4e:
        this.verMid(id)
        return 'dp'
      default:
        // 01-Syntax error, 52-Then and 57-APCmp Call all land here
        this.syntax()
    }
  }

  /* ---- the instruction handlers ---------------------------------------- */

  /** `Ver_Normal` (+Verif.s:476) */
  verNormal(id: number): void {
    const d = this.dInst(CORE, id)
    this.verI(d)
  }

  /** `Ver_DejaTestee` (:466): an entry the verifier already resolved once */
  verDejaTestee(id: number): void {
    this.verIDejaTestee(this.dInst(CORE, id).params)
  }

  /** `Ver_VReservee` (:439): `Timer=0` and the fourteen like it */
  verVReservee(id: number): void {
    const d = this.dInst(CORE, id)
    // VerVR: the byte after the V is the type the assignment has to match
    const type = d.params.charAt(0)
    const rest = { ...d, params: d.params.slice(1) }
    this.verF(rest)
    this.want(TK_EQUALS)
    const got = this.verExpression()
    if (got !== type) this.fail(VERR.TYPE)
  }

  /** `Ver_Extension` (:402) */
  verExtension(): void {
    const slot = this.b[this.p]!
    const nparamsAt = this.p + 1
    this.p += 2
    const id = this.next()
    const table = this.ext.get(slot)
    if (table === undefined) this.fail(VERR.EXTENSION_MISSING)
    const d = this.dInst(table, id)
    let n: number
    if (d.kind === 'I') {
      n = this.verI(d)
    } else if (d.kind === 'V') {
      const type = d.params.charAt(0)
      this.verF({ ...d, params: d.params.slice(1) })
      this.want(TK_EQUALS)
      const got = this.verExpression()
      if (got !== type) this.fail(VERR.TYPE)
      n = 0
    } else {
      this.syntax()
    }
    // an AP20 library counts its own arguments, so the byte reads $FF
    this.b[nparamsAt] = this.ap20.has(slot) ? 0xff : n & 0xff
  }

  /** `VerRem` (:744). A remark eats the rest of its line, terminator included. */
  verRem(): void {
    const len = this.u16(this.p)
    this.p += 2 + len + 2
  }

  /** `VerSBu` (:803) */
  verSetBuffer(): void {
    this.want(T.INT)
    this.p += 4
  }

  /** `VerSStack` (:788) */
  verSetStack(): void {
    this.want(T.INT)
    this.p += 4
  }

  /** `VerLab` (:762): a label, and `10 Data 1,2` after one */
  verLab(): Go {
    this.v1StockLabel()
    if (this.peek() !== TK.DATA) return 'loop'
    this.p += 2
    this.verData()
    return 'dp'
  }

  /** `VerDim` (:825) */
  verDim(): void {
    for (;;) {
      this.want(T.VARIABLE)
      this.b[this.p + 3]! &= 0x0f
      const a0 = this.varA0()
      if (this.u16(a0.end) !== TKV.PAREN1) this.syntax()
      this.b[this.p + 3]! |= 0x40
      const rec = this.stoVar(a0)
      if (!rec.fresh) this.fail(VERR.ALREADY_DIMENSIONED)
      rec.v.dims = this.verTablo()
      if (!this.take(TKV.COMMA)) return
    }
  }

  /** `VerPr` (:908) */
  verPrint(): void {
    if (this.peek() === TKV.HASH) {
      this.p += 2
      if (this.verExpression() === '2') this.fail(VERR.TYPE)
      if (this.peek() !== TKV.COMMA) return
      this.p += 2
    }
    for (;;) {
      if (this.finie()) return
      this.pos = this.p
      if (this.take(TKV.USING)) {
        if (this.verExpression() !== '2') this.fail(VERR.TYPE)
        this.want(TKV.SEMICOLON)
      }
      this.verExpression()
      const d0 = this.next()
      if (d0 === TKV.COMMA || d0 === TKV.SEMICOLON) continue
      this.p -= 2
      return
    }
  }

  /** `VerInp` (:943) */
  verInput(): void {
    if (this.peek() !== T.VARIABLE) {
      if (this.verExpression() !== '2') this.fail(VERR.TYPE)
      this.want(TKV.SEMICOLON)
    }
    this.verInput1()
  }

  /** `VerIn1` (:951) */
  verInput1(): void {
    for (;;) {
      this.verGV()
      if (!this.take(TKV.COMMA)) break
    }
    this.take(TKV.SEMICOLON)
  }

  /** `VerPal` (:962): up to 32 colours, comma separated */
  verPalette(from: number): void {
    let n = from
    for (;;) {
      n++
      this.verExpE()
      if (this.peek() !== TKV.COMMA) return
      this.p += 2
      if (n >= 32) return
    }
  }

  /** `VerFade` (:977) */
  verFade(): void {
    this.verExpE()
    if (this.take(TKV.COMMA)) {
      this.verPalette(1)
      return
    }
    if (!this.take(TKV.TO)) return
    this.verExpE()
    if (!this.take(TKV.COMMA)) return
    this.verExpE()
  }

  /** `VerMn` (:996): `Menu$(a,b,c)=` and its three optional strings */
  verMenu(): void {
    if (this.verTablo() >= TKV.MENU_DIMS) this.syntax()
    this.want(TK_EQUALS)
    for (let i = 0; i < 3; i++) {
      if (this.peek() !== TKV.COMMA) {
        if (this.verExpression() !== '2') this.fail(VERR.TYPE)
        if (this.peek() !== TKV.COMMA) return
      }
      this.p += 2
    }
    if (this.verExpression() !== '2') this.fail(VERR.TYPE)
  }

  /** `VerIMn` (:1026) */
  verMenuFlags(): void {
    if (this.peek() === TKV.PAREN1) {
      this.verMenuIndex()
      return
    }
    if (this.peek() >= TKV.MENU_CLOSE) this.syntax()
    this.verExpE()
  }

  /** `VIMn1` (:1033) */
  verMenuIndex(): void {
    if (this.verTablo() >= TKV.MENU_DIMS) this.syntax()
  }

  /** `VerSmn` (:1047) */
  verSetMenu(): void {
    this.verMenuIndex()
    this.want(TKV.TO)
    this.verExpE()
    this.want(TKV.COMMA)
    this.verExpE()
  }

  /** `VerMnK` (:1087) */
  verMenuKey(): void {
    this.verMenuIndex()
    if (!this.take(TKV.TO)) return
    const t = this.evalue()
    if (t === '2') return
    if (t !== '0') this.fail(VERR.TYPE)
    if (!this.take(TKV.COMMA)) return
    this.verExpE()
  }

  /** `VerFol` (:1107) */
  verFollow(): void {
    if (this.finie()) return
    do this.verExpression()
    while (this.take(TKV.COMMA))
  }

  /**
   * `VerData` (:1117).
   *
   * The word behind the token is the offset of the Data statement from the
   * head of its line, which is what `Restore` lands on. Pass one writes it
   * and pass two leaves it alone, so it is the one inline slot that is right
   * already.
   */
  verData(): void {
    this.put16(this.p, this.p - this.line)
    do {
      this.p += 2
      this.verExpression()
    } while (this.peek() === TKV.COMMA)
  }

  /** `VerRead` (:1129) */
  verRead(): void {
    for (;;) {
      this.verGV()
      if (this.peek() !== TKV.COMMA) return
      this.p += 2
    }
  }

  /** `VerChan` (:1145) */
  verChannel(): void {
    this.verExpE()
    this.want(TKV.TO)
    const d0 = this.next()
    const known =
      d0 === TKV.SCREEN_DISPLAY ||
      d0 === TKV.SCREEN_OFFSET ||
      d0 === TKV.SCREEN_SIZE ||
      d0 === TKV.BOB ||
      d0 === TKV.SPRITE ||
      d0 === TKV.RAINBOW
    if (!known) this.p -= 2 // Channel .. To ADDRESS
    this.verExpE()
  }

  /** `VerPo` (:1168) */
  verPolyline(): void {
    if (this.peek() !== TKV.TO) {
      do {
        this.verExpE()
        this.want(TKV.COMMA)
        this.verExpE()
      } while (this.take(TKV.TO))
      return
    }
    while (this.take(TKV.TO)) {
      this.verExpE()
      this.want(TKV.COMMA)
      this.verExpE()
    }
  }

  /** `VerMid` (:1182): `Mid$(a$,1,2)=b$` reaches the same entry as the function */
  verMid(id: number): void {
    const back = this.p
    this.p += 2
    this.verVarA()
    this.want(TKV.COMMA)
    this.p = back
    this.verF(this.dInst(CORE, id))
    this.want(TK_EQUALS)
    if (this.verExpression() !== '2') this.fail(VERR.TYPE)
  }

  /**
   * `VerAdd` (:1213).
   *
   * `Add` is two instructions wearing one name: the token becomes $0458 for
   * the two-argument form and $0462 once a third argument turns up, and the
   * tokeniser writes whichever the keyword table gave it.
   */
  verAdd(): void {
    const at = this.p - 2
    this.put16(at, TKV.ADD2)
    this.verVEnt()
    this.verGV()
    this.want(TKV.COMMA)
    this.verExpE()
    if (this.peek() !== TKV.COMMA) return
    this.put16(at, TKV.ADD4)
    this.p += 2
    this.verExpE()
    if (!this.take(TKV.TO)) return
    this.verExpE()
  }

  /** `VerFld` (:1237) */
  verField(): void {
    this.verExpE()
    if (this.peek() !== TKV.COMMA) this.syntax()
    do {
      this.p += 2
      this.verExpE()
      this.want(TKV.AS)
      this.verVarA()
    } while (this.peek() === TKV.COMMA)
  }

  /** `VerCall` (:1252) */
  verCall(): void {
    this.verExpE()
    while (this.peek() === TKV.COMMA) {
      this.p += 2
      this.verExpression()
    }
  }

  /** `VerSort` (:1058) */
  verSort(): void {
    const at = this.p
    this.verGV()
    if ((this.b[at + 5]! & 0x40) === 0) this.syntax()
  }

  /** `VerSwap` (:1066) */
  verSwap(): void {
    const a = this.verGV()
    this.want(TKV.COMMA)
    const b = this.verGV()
    if (a !== b) this.fail(VERR.TYPE)
  }

  /**
   * `VerStruI` and `VerStruIS` (:1262). Both go through `VStru`, which reads
   * the equate name out of the bank, and this port has no equate bank yet.
   */
  verStruc(_string: boolean): never {
    this.fail(VERR.EQU_TYPE)
  }

  /** `VerDFn` (:1029 of the FC arm) */
  verDFn(): void {
    this.want(T.VARIABLE)
    this.b[this.p + 3] = (this.b[this.p + 3]! & 0x0f) | 0x08
    const a0 = this.varA0()
    this.stoVar(a0)
    // VDfnR: the parameter list, if there is one
    if (this.take(TKV.PAREN1)) {
      for (;;) {
        this.verGV()
        if (this.take(TKV.COMMA)) continue
        this.want(TKV.PAREN2)
        break
      }
    }
    this.want(TK_EQUALS)
    const got = this.verExpression()
    if (got !== a0.type) this.fail(VERR.TYPE)
    if (this.peek() !== 0) this.fail(VERR.DATA_AT_LINE_START)
  }

  /* ---- structures ------------------------------------------------------ */

  /** `V1_For` (:1701) */
  v1For(): void {
    this.put16(this.p, 0)
    this.p += 2
    const t = this.verGV()
    if (t !== '0') this.fail(VERR.TYPE)
    this.want(TK_EQUALS)
    if (this.verExpression() !== t) this.fail(VERR.TYPE)
    this.pos = this.p
    this.want(TKV.TO)
    if (this.verExpression() !== t) this.fail(VERR.TYPE)
    if (this.take(TKV.STEP)) {
      if (this.verExpression() !== t) this.fail(VERR.TYPE)
    }
  }

  /** `V1_Next` (:1755) */
  v1Next(): void {
    if (!this.finie()) this.verGV()
  }

  /** `V1_Exit` (:1894) */
  v1Exit(): void {
    this.put16(this.p, 0)
    this.put16(this.p + 2, 0)
    this.p += 4
    if (this.peek() !== T.INT) return
    this.p += 6
  }

  /** `V1_ExitI` (:1933) */
  v1ExitIf(): void {
    this.put16(this.p, 0)
    this.put16(this.p + 2, 0)
    this.p += 4
    this.verExpE()
    if (this.peek() !== TKV.COMMA) return
    if (this.u16(this.p + 2) !== T.INT) this.syntax()
    this.p += 8
  }

  /**
   * `V1_If` (:1953). `Then` splits it: without one the rest of the line is
   * the structured body, with one the line carries its own consequent, and
   * `If a Then 100` is a jump to a line number.
   */
  v1If(): Go {
    this.put16(this.p, 0)
    this.p += 2
    this.verExpE()
    if (this.peek() !== TK.THEN) return 'dp'
    this.p += 2
    if (this.peek() !== T.LABEL_REF) return 'loop'
    this.v1SautLGoto()
    return 'dp'
  }

  /** `V1_Else` (:2110) */
  v1Else(): Go {
    this.put16(this.p, 0)
    this.p += 2
    if (this.peek() === TKV.COLON) return 'dp'
    if (this.peek() !== T.LABEL_REF) return 'loop'
    this.v1SautLGoto()
    return 'dp'
  }

  /** `V1_SautLGoto` (:2491): the line number behind a bare `Then`/`Else` */
  v1SautLGoto(): void {
    this.p += 2
    const len = this.b[this.p + 2]!
    this.p += 4 + len
  }

  /** `V1_On` (:2184): `On n Goto`, `Gosub` or `Proc`, and the count it pokes */
  v1On(): void {
    const at = this.p
    this.put16(this.p, 0)
    this.put16(this.p + 2, 0)
    this.p += 4
    this.verExpE()
    const d0 = this.next()
    let n = 0
    if (d0 === TKV.GOTO || d0 === TKV.GOSUB) {
      do {
        n++
        this.v1GoLabel()
      } while (this.take(TKV.COMMA))
    } else if (d0 === TKV.PROC) {
      do {
        n++
        this.goPro(false)
      } while (this.take(TKV.COMMA))
    } else {
      this.syntax()
    }
    this.put16(at + 2, n)
    this.put16(at, this.p - at - 4)
  }

  /** `V1_OnError` (:2236) */
  v1OnError(): Go {
    if (this.peek() === TKV.PROC) return 'loop'
    if (this.peek() !== TKV.GOTO) return 'dp'
    this.p += 2
    this.v1GoLabel()
    return 'dp'
  }

  /** `V1_OnMenu` (:1061) */
  v1OnMenu(): void {
    const d0 = this.next()
    if (d0 === TKV.GOTO || d0 === TKV.GOSUB) {
      do this.v1GoLabel()
      while (this.take(TKV.COMMA))
      return
    }
    if (d0 !== TKV.PROC) this.syntax()
    do this.goPro(false)
    while (this.take(TKV.COMMA))
  }

  /** `V1_PopProc` (:2268) */
  v1PopProc(): void {
    if (this.phase === 0) this.fail(VERR.PROC_NOT_OPENED)
    if (!this.take(TKV.BRA1)) return
    this.verExpression()
    this.want(TKV.BRA2)
  }

  /** `V1_Every` (:2281) */
  v1Every(): void {
    this.verExpE()
    const d0 = this.next()
    if (d0 === TKV.GOSUB) {
      this.v1GoLabel()
      return
    }
    if (d0 !== TKV.PROC) this.syntax()
    this.goPro(false)
  }

  /* ---- procedures ------------------------------------------------------ */

  /** `V1_Proc` (:1502) */
  v1Proc(): void {
    const at = this.p
    if (this.peek() !== T.VARIABLE && this.peek() !== T.PROC_CALL) this.syntax()
    this.p += 2
    this.v1IVariable()
    if (this.u16(at) !== T.PROC_CALL) this.fail(VERR.UNDEFINED_PROC)
  }

  /**
   * `V1_Procedure` (:1519).
   *
   * In phase 0 the body is not walked at all: the header is read, the name
   * goes in the label table, and the walk jumps to the line after `End Proc`,
   * picking up any `Shared` on the way. The body gets a phase of its own
   * later, which is what makes its variables local.
   */
  v1Procedure(): Go {
    this.p -= 2
    if (this.phase !== 0) return this.v1ProcedureIn()
    const start = this.p
    this.procedures.push(start)
    this.p += 10
    this.want(T.VARIABLE)
    this.b[this.p + 3] = (this.b[this.p + 3]! & 0x0f) | 0x80
    this.v1StockLabel()
    if (this.peek() === TKV.BRA1) {
      do {
        this.p += 2
        this.pos = this.p
        this.want(T.VARIABLE)
        this.b[this.p + 3]! &= 0x0f
        this.p += 4 + this.b[this.p + 2]!
      } while (this.peek() === TKV.COMMA)
      this.pos = this.p
      this.want(TKV.BRA2)
    }
    this.pos = this.p
    if (this.peek() !== 0) this.fail(VERR.PROC_LIMITS_ALONE)
    this.p += 2
    // a machine-code procedure is a block of 68k, not lines: step its length
    if ((this.b[start + 8]! & 0x10) !== 0) {
      const len = this.u32(start + 2)
      this.p = start + 12 + len
    } else {
      for (;;) {
        const head = this.b[this.p]!
        if (head === 0) this.fail(VERR.PROC_NOT_CLOSED)
        const tok = this.u16(this.p + 2)
        if (tok === TKV.END_PROC) {
          this.p += head * 2
          break
        }
        if (tok === TKV.SHARED || tok === TKV.GLOBAL) {
          const back = this.p
          this.p += 4
          this.vpSha()
          this.p = back
        }
        this.p += head * 2
      }
    }
    this.p -= 2
    this.put32(start + 2, this.p - start - 10)
    this.p += 2
    return 'line'
  }

  /** `V1_ProcedureIn` (:1656): the same header, walked to name the parameters */
  v1ProcedureIn(): Go {
    const start = this.p
    // a machine-code procedure carries its own variable size and is not walked
    if ((this.b[start + 8]! & 0x10) !== 0) {
      this.varLong = this.u16(start + 6)
      return 'phase'
    }
    this.p += 12
    this.p += 4 + this.b[this.p + 2]!
    if (this.peek() !== TKV.BRA1) return 'dp'
    do {
      this.p += 4
      this.stoVar(this.varA0())
    } while (this.peek() === TKV.COMMA)
    this.p += 2
    return 'dp'
  }

  /** `V1_EndProc` (:1676) */
  v1EndProc(): void {
    if (this.phase === 0) this.fail(VERR.PROC_NOT_OPENED)
    if (this.take(TKV.BRA1)) this.verExpression()
  }

  /**
   * `VerSha` (:3826) and `VpSha` (:3803). The first pass creates the names,
   * the second marks them so a procedure can find them in the global table.
   */
  verSha(): void {
    this.p -= 2
    if (this.phase === 0) {
      const back = this.p
      this.p += 2
      this.vpSha()
      this.p = back
    }
    this.p += 2
    for (;;) {
      this.pos = this.p
      this.want(T.VARIABLE)
      const len = this.b[this.p + 2]!
      this.b[this.p + 3]! &= 0x0f
      let flag = this.b[this.p + 3]!
      const name = this.nameAt(this.p + 4, len)
      this.p += 4 + len
      if (this.peek() === TKV.PAREN1) {
        flag |= 0x40
        this.b[this.p - len - 1]! |= 0x40
        if (this.u16(this.p + 2) !== TKV.PAREN2) this.fail(VERR.NO_EMPTY_BRACKETS)
        this.p += 4
      }
      // in phase 0 the table being searched is the one being built, which
      // only becomes DVNm once the main program is done
      const rec = this.find(this.phase === 0 ? this.locals : this.globals, len, flag, name)
      if (rec === undefined) this.fail(VERR.NOT_DIMENSIONED)
      if (rec.global !== 2) rec.global = this.phase === 0 ? 2 : 1
      const d0 = this.next()
      if (d0 === TKV.COMMA) continue
      if (d0 !== 0) this.fail(VERR.SHARED_ALONE)
      return
    }
  }

  /** `VpGv` (:3813): the creating half of Shared */
  vpSha(): void {
    for (;;) {
      this.pos = this.p
      this.want(T.VARIABLE)
      this.b[this.p + 3]! &= 0x0f
      const a0 = this.varA0()
      if (this.u16(a0.end) !== TKV.PAREN1) {
        this.stoVar(a0)
      } else {
        if (this.u16(a0.end + 2) !== TKV.PAREN2) this.fail(VERR.NO_EMPTY_BRACKETS)
        this.p = a0.end + 4
      }
      if (!this.take(TKV.COMMA)) return
    }
  }

  /* ---- names ----------------------------------------------------------- */

  /** `VarA0` (:3659): the type from the flag byte, and where the record ends */
  varA0(): { at: number; len: number; kind: number; type: string; end: number } {
    const at = this.p
    const len = this.b[at + 2]!
    // `and.b #%111,d0`: the type is the bottom three bits, and bits 3 to 7
    // are the user-function, array and procedure marks
    const kind = this.b[at + 3]! & 0x07
    return {
      at,
      len,
      kind,
      type: kind === 0 || kind === 1 ? '0' : '2',
      end: at + 4 + len,
    }
  }

  nameAt(at: number, len: number): string {
    return String.fromCharCode(...this.b.subarray(at, at + len))
  }

  find(list: VarRec[], len: number, flag: number, name: string): VarRec | undefined {
    return list.find((v) => v.len === len && v.flag === flag && v.name === name)
  }

  /**
   * `V1_StoVar` (:3521).
   *
   * A procedure looks in the global table first, but only at names `Shared`
   * marked; anything else is created local to the phase. The offset handed
   * out here is the one pass two dokes back over the token, so the link word
   * a saved program carries is decided at creation.
   */
  stoVar(a0: { at: number; end: number }): { v: VarRec; fresh: boolean } {
    // the length and the flag come off the record and not off the caller's
    // copy of it: `bset #6,3(a6)` runs BEFORE the call, so an array's identity
    // carries bit 6 and a scalar of the same name is a different variable
    const len = this.b[a0.at + 2]!
    const flag = this.b[a0.at + 3]!
    const name = this.nameAt(a0.at + 4, len)
    this.p = a0.end
    if (this.phase !== 0) {
      const g = this.globals.find(
        (v) => v.global !== 0 && v.len === len && v.flag === flag && v.name === name,
      )
      if (g !== undefined) return { v: g, fresh: false }
    }
    const found = this.find(this.locals, len, flag, name)
    if (found !== undefined) return { v: found, fresh: false }
    const v: VarRec = {
      len,
      flag,
      offset: this.varLong,
      dims: 0,
      global: 0,
      name,
    }
    this.varLong += 6
    this.locals.push(v)
    return { v, fresh: true }
  }

  /** `VerGV` (:1478): one variable, alone, array subscripts and all */
  verGV(): string {
    this.pos = this.p
    this.want(T.VARIABLE)
    this.b[this.p + 3]! &= 0x0f
    const a0 = this.varA0()
    if (this.u16(a0.end) !== TKV.PAREN1) {
      this.stoVar(a0)
      return a0.type
    }
    this.b[this.p + 3]! |= 0x40
    const rec = this.stoVar(a0)
    if (rec.fresh) this.fail(VERR.NOT_DIMENSIONED)
    this.verTablo()
    return a0.type
  }

  /** `VerVarA` (:1471) */
  verVarA(): void {
    if (this.verGV() !== '2') this.fail(VERR.TYPE)
  }

  /** `VerVEnt` (:1460): the variable an `Inc`/`Add` counts, read without moving */
  verVEnt(): void {
    const back = this.p
    this.want(T.VARIABLE)
    const a0 = this.varA0()
    if (a0.kind !== 0) this.fail(VERR.TYPE)
    this.p = back
  }

  /** `VerTablo` (:3675): the subscripts, and how many there were */
  verTablo(): number {
    this.pos = this.p
    this.want(TKV.PAREN1)
    const saved = this.paren
    let n = 0
    for (;;) {
      this.pos = this.p
      n++
      if (this.evalue() !== '0') this.fail(VERR.TYPE)
      if (this.paren === 0) {
        this.pos = this.p
        if (this.next() === TKV.COMMA) continue
        this.syntax()
      }
      break
    }
    if (this.paren !== -1) this.syntax()
    this.paren = saved
    return n
  }

  /**
   * `V1_IVariable` (:3207): a name at the head of a statement.
   *
   * It is an assignment if `=` follows, an array assignment if `(` does, and
   * a procedure call otherwise. The last case rewrites the token to $0012 and
   * sets bit 7 of the flag byte, which is a promotion the tokeniser can never
   * make on its own.
   */
  v1IVariable(): void {
    this.put16(this.p - 2, T.VARIABLE)
    this.b[this.p + 3]! &= 0x0f
    const a0 = this.varA0()
    const after = this.u16(a0.end)
    if (after !== TK_EQUALS && after !== TKV.PAREN1) {
      this.v1CallProc()
      return
    }
    let type = a0.type
    if (after === TKV.PAREN1) {
      this.b[this.p + 3]! |= 0x40
      const rec = this.stoVar(a0)
      if (rec.fresh) this.fail(VERR.NOT_DIMENSIONED)
      if (this.verTablo() !== rec.v.dims) this.fail(VERR.ILLEGAL_PARAM_COUNT)
    } else {
      this.stoVar(a0)
      type = a0.type
    }
    this.want(TK_EQUALS)
    this.pos = this.p
    if (this.verExpression() !== type) this.fail(VERR.TYPE)
  }

  /** `V1_FVariable` (:3243): the same name in an expression */
  v1FVariable(): string {
    this.b[this.p + 3]! &= 0x0f
    const a0 = this.varA0()
    if (this.u16(a0.end) !== TKV.PAREN1) {
      this.stoVar(a0)
      return a0.type
    }
    this.b[this.p + 3]! |= 0x40
    const rec = this.stoVar(a0)
    if (rec.fresh) this.fail(VERR.NOT_DIMENSIONED)
    if (this.verTablo() !== rec.v.dims) this.fail(VERR.ILLEGAL_PARAM_COUNT)
    return a0.type
  }

  /** `GoPro` (:3263) */
  goPro(withParams: boolean): void {
    const d0 = this.next()
    if (d0 === T.PROC_CALL) {
      this.v1CallProc(withParams)
      return
    }
    if (d0 !== T.VARIABLE) this.syntax()
    this.v1CallProc(withParams)
  }

  /** `V1_CallProc` (:3270) */
  v1CallProc(withParams = false): void {
    const a0 = this.varA0()
    this.put16(this.p - 2, T.PROC_CALL)
    this.b[this.p + 3]! |= 0x80
    this.p = a0.end
    this.pos = this.p
    if (this.peek() !== TKV.BRA1) return
    if (withParams) this.syntax()
    do {
      this.p += 2
      this.verExpression()
    } while (this.peek() === TKV.COMMA)
    this.pos = this.p
    this.want(TKV.BRA2)
  }

  /**
   * `V1_GoLabel` (:3362).
   *
   * A `Goto` takes either a label or an expression, and the tokeniser cannot
   * tell them apart. The rule is positional: a plain name with nothing but a
   * comma or the end of the statement behind it is a label, and the token
   * becomes $0018.
   */
  v1GoLabel(): void {
    let d0 = this.peek()
    if (d0 === T.LABEL_REF) {
      d0 = T.VARIABLE
      this.put16(this.p, d0)
    }
    if (d0 === T.VARIABLE && (this.b[this.p + 5]! & 0x0f) === 0) {
      const end = this.p + 6 + this.b[this.p + 4]!
      const after = this.u16(end)
      if (after === 0 || after === TKV.COMMA || this.finie(end)) {
        this.put16(this.p, T.LABEL_REF)
        this.p = end
        return
      }
    }
    this.evalue()
  }

  /** `V1_StockLabel` (:3413) */
  v1StockLabel(): void {
    const len = this.b[this.p + 2]!
    this.p += 4 + len
  }

  /* ---- expressions ----------------------------------------------------- */

  /** `Ver_ExpE` (:2512): the expression has to come out an integer */
  verExpE(): void {
    if (this.verExpression() !== '0') this.fail(VERR.TYPE)
  }

  /** `Ver_Expression` (:2520) */
  verExpression(): string {
    this.pos = this.p
    const t = this.evalue()
    if (this.paren !== 0) this.syntax()
    return t
  }

  /** `Ver_Evalue` (:2528) */
  evalue(): string {
    this.paren = 0
    return this.reEvalue()
  }

  /**
   * `Ver_REvalue` (:2530): the precedence climb.
   *
   * An operator's token id IS its precedence. They are negative offsets from
   * the end of `Dtk_Operateurs`, so the later an operator sits in that table
   * the larger its id reads unsigned, and `bhi` binds it tighter. `$7FFF` is
   * the limit that lets any of them in and no ordinary token.
   */
  reEvalue(limit = 0x7fff): string {
    let type = this.operande()
    for (;;) {
      const d0 = this.u16(this.p)
      this.p += 2
      if (d0 > limit) {
        const right = this.reEvalue(d0)
        type = this.operate(d0, type, right)
        continue
      }
      this.p -= 2
      if (limit === 0x7fff) {
        // Eva_Fin: a ) that nothing here opened belongs to the caller
        if (d0 === TKV.PAREN2) {
          this.paren--
          this.p += 2
        }
        return type
      }
      return type
    }
  }

  /** `Tst_Mixte`, `Tst_Comp`, `Tst_Puis` and `Tst_Chiffre` (:2556-2580) */
  operate(id: number, left: string, right: string): string {
    const name = OP_TEST.get(id)
    if (name === undefined) this.syntax()
    if (left !== right) this.fail(VERR.TYPE)
    if (name === 'comp') return '0'
    if (name === 'mixte') return right
    if (right !== '0') this.fail(VERR.TYPE)
    return right
  }

  /** `Ver_Operande` (:2582) */
  operande(): string {
    let sign = false
    for (;;) {
      const d0 = this.next()
      if (d0 === 0) {
        // Ope_Fin1: only a trailing comma may leave a parameter out
        if (this.u16(this.p - 4) !== TKV.COMMA) this.syntax()
        this.p -= 2
        if (sign) this.syntax()
        return '0'
      }
      if ((d0 & 0x8000) !== 0) {
        if (d0 !== TKV.MINUS || sign) this.syntax()
        sign = true
        continue
      }
      return this.operand(d0, sign)
    }
  }

  /** `.Jmp` (:2602), the forty arms of the operand table */
  operand(id: number, sign: boolean): string {
    const cls = this.opeClassOf(id)
    switch (cls) {
      case 0x00:
      case 0x05:
      case 0x13:
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x1f:
      case 0x21:
      case 0x22:
      case 0x23:
      case 0x24:
      case 0x25:
      case 0x26:
      case 0x27: {
        const d = this.dInst(CORE, id)
        this.verF(d)
        return checkType(d.kind)
      }
      case 0x02: {
        this.p -= 2
        if (this.u16(this.p - 2) !== TKV.COMMA) this.syntax()
        if (sign) this.syntax()
        return '0'
      }
      case 0x03: {
        this.p -= 2
        if (sign) this.syntax()
        return '0'
      }
      case 0x04:
        this.paren++
        return this.reEvalue()
      case 0x06:
        return this.opeExtension()
      case 0x07:
        return this.v1FVariable()
      case 0x08: {
        this.want(TKV.PAREN1)
        this.want(T.VARIABLE)
        this.v1FVariable()
        this.want(TKV.PAREN2)
        return '0'
      }
      case 0x09:
        return this.opeFn()
      case 0x0a: {
        const saved = this.paren
        const t = this.evalue()
        if (this.paren !== 0) this.syntax()
        this.paren = saved
        if (t === '2') this.fail(VERR.TYPE)
        return t
      }
      case 0x0b:
        if (this.verTablo() >= TKV.MENU_DIMS) this.syntax()
        return '0'
      case 0x0c:
      case 0x10:
      case 0x11:
      case 0x12:
        this.fail(VERR.EQU_TYPE)
        break
      case 0x0d:
      case 0x0e: {
        const at = this.p
        const d = this.dInst(CORE, id)
        this.verF(d)
        if ((this.b[at + 7]! & 0x40) === 0) this.syntax()
        return '0'
      }
      case 0x0f:
      case 0x20:
        return this.opeMinMax()
      case 0x14:
        this.p += 4
        return '0'
      case 0x15:
        this.p += 4
        return '0'
      case 0x16:
        this.p += 8
        return '0'
      case 0x17: {
        const n = this.u16(this.p)
        this.p += 2 + n + (n & 1)
        return '2'
      }
      case 0x18:
        return this.opeInstFonction(id)
      case 0x19: {
        const d = this.dInst(CORE, id)
        this.verFDejaTeste(d.params)
        return checkType(d.kind)
      }
      case 0x1a: {
        const d = this.dInst(CORE, id)
        const type = d.params.charAt(0)
        this.verF({ ...d, params: d.params.slice(1) })
        return checkType(type)
      }
      default:
        this.syntax()
    }
    this.syntax()
  }

  /** `Ope_Extension` (:2699) */
  opeExtension(): string {
    const slot = this.b[this.p]!
    const nparamsAt = this.p + 1
    this.p += 2
    const id = this.next()
    const table = this.ext.get(slot)
    if (table === undefined) this.fail(VERR.EXTENSION_MISSING)
    const d = this.dInst(table, id)
    if (d.kind === 'I') this.syntax()
    let type = d.kind
    let params = d.params
    if (d.kind === 'V') {
      type = params.charAt(0)
      params = params.slice(1)
    }
    const n = this.verF({ ...d, params })
    this.b[nparamsAt] = this.ap20.has(slot) ? 0xff : n & 0xff
    return checkType(type)
  }

  /** `Ope_Fn` (:2895): a call to a `Def Fn` */
  opeFn(): string {
    this.want(T.VARIABLE)
    this.b[this.p + 3] = (this.b[this.p + 3]! & 0x0f) | 0x08
    const a0 = this.varA0()
    const rec = this.stoVar(a0)
    if (rec.fresh) this.fail(VERR.USER_FN)
    if (this.peek() !== TKV.PAREN1) return a0.type
    this.p += 2
    const saved = this.paren
    for (;;) {
      this.evalue()
      if (this.paren !== 0) break
      this.pos = this.p
      if (this.next() !== TKV.COMMA) this.syntax()
    }
    if (this.paren !== -1) this.syntax()
    this.paren = saved
    return a0.type
  }

  /** `Ope_MinMax` (:2861) */
  opeMinMax(): string {
    this.want(TKV.PAREN1)
    const saved = this.paren
    const a = this.verExpression()
    this.want(TKV.COMMA)
    const b = this.evalue()
    if (this.paren !== -1) this.syntax()
    if (a !== b) this.fail(VERR.TYPE)
    this.paren = saved
    return b
  }

  /**
   * `Ope_InstFonction` (:2735): `Screen` and `Colour`, which are an
   * instruction and a function under one name. The $FD terminator says the
   * entry behind holds the function, and the token is rewritten to reach it.
   */
  opeInstFonction(id: number): string {
    const ix = index(CORE)
    let i = ix.at.get(id)
    if (i === undefined) this.syntax()
    for (;;) {
      const e = ix.entries[i]!
      const kind = e.spec.charAt(0)
      if (kind !== 'I') {
        this.put16(this.p - 2, e.id)
        this.verF({ table: CORE, i, kind, params: e.spec.slice(1) })
        return checkType(kind)
      }
      if (e.end !== 0xfd) this.syntax()
      i++
    }
  }

  /* ---- arguments ------------------------------------------------------- */

  /**
   * `Ver_DInst` (+Verif.s:3179), which points at the entry's spec and reads
   * its first byte: the kind, then the parameter list.
   *
   * `Ver_OlDInst` (:3191) is the same two things by a different route. The
   * fast one uses the spec offset the verify table carries and the old one
   * walks the name, because an extension's table may not have been swapped.
   * Here there is nothing to swap and one function answers both.
   */
  dInst(table: TokenTable, id: number): Definition {
    const ix = index(table)
    const i = ix.at.get(id)
    if (i === undefined) this.syntax()
    const spec = ix.entries[i]!.spec
    return { table, i, kind: spec.charAt(0) || TERM, params: spec.slice(1) }
  }

  /**
   * `VerI` (:2989): count an instruction's arguments, then match them.
   *
   * Returns the count, which is the byte `Ver_Extension` pokes behind the
   * slot for a pre-2.0 library.
   */
  verI(d: Definition): number {
    const at = this.p - 2
    const args = new ArgString()
    if (!this.finie()) {
      for (;;) {
        args.push(this.evalue())
        if (this.paren !== 0) this.syntax()
        const d1 = this.peek()
        if (d1 === TKV.COMMA) args.push(',')
        else if (d1 === TKV.TO) args.push('t')
        else break
        this.p += 2
      }
    }
    this.verC(args.text, d, at)
    return args.count
  }

  /** `VerI_DejaTestee` (:2972): the shape is known, so only the walk is left */
  verIDejaTestee(params: string): void {
    if (params === '') return
    let i = 1
    for (;;) {
      this.evalue()
      if (i >= params.length) return
      i += 2
      this.p += 2
    }
  }

  /** `VerF` (:3061): the same for a function, brackets and all */
  verF(d: Definition): number {
    const at = this.p - 2
    // VerF saves Parenth across the call and VerI does not: a function is an
    // operand inside somebody else's expression, and its own closing bracket
    // leaves the count at -1
    const saved = this.paren
    const args = new ArgString()
    if (this.peek() === TKV.PAREN1 && this.u16(this.p + 2) !== TKV.PAREN2) {
      this.p += 2
      for (;;) {
        args.push(this.evalue())
        if (this.paren === -1) break
        if (this.paren !== 0) this.syntax()
        this.pos = this.p
        const d1 = this.next()
        if (d1 === TKV.COMMA) args.push(',')
        else if (d1 === TKV.TO) args.push('t')
        else this.syntax()
      }
    } else if (this.peek() === TKV.PAREN1) {
      this.p += 4
    }
    this.verC(args.text, d, at)
    this.paren = saved
    return args.count
  }

  /** `VerF_DejaTeste` (:3042) */
  verFDejaTeste(params: string): void {
    if (params === '') return
    const saved = this.paren
    let i = 1
    for (;;) {
      this.p += 2
      this.evalue()
      if (i >= params.length) break
      i += 2
    }
    this.paren = saved
  }

  /**
   * `VerC` (:3120): the argument string against the entry's spec.
   *
   * A spec that does not match is not an error on its own. `VerC4` takes the
   * $FE terminator as licence to try the entry behind, which has no name and
   * exists only to be reached this way, and pokes its id over the token. That
   * is how `Screen Copy` with five arguments becomes a different instruction
   * from the same three letters. A type that is wrong stops it dead.
   */
  verC(args: string, d: Definition, at: number): void {
    const ix = index(d.table)
    let i = d.i
    let params = d.params
    for (;;) {
      if (this.match(args, params)) {
        if (i !== d.i) this.put16(at, ix.entries[i]!.id)
        return
      }
      if (ix.entries[i]!.end !== 0xfe) this.syntax()
      i++
      const spec = ix.entries[i]!.spec
      params = spec.charAt(0) === 'V' ? spec.slice(2) : spec.slice(1)
    }
  }

  /** `VerC0` to `VerC2`, which is the comparison on its own */
  match(args: string, params: string): boolean {
    if (params === '') return args === ''
    if (args === '') return false
    let a = 0
    let p = 0
    for (;;) {
      if (p >= params.length) return false
      const want = params.charAt(p++)
      const got = args.charAt(a++)
      if (want !== '3' && (want === '2' ? '2' : '0') !== got) this.fail(VERR.TYPE)
      if (a >= args.length) return p >= params.length
      const sep = args.charAt(a++)
      if (p >= params.length) return false
      if (params.charAt(p++) !== sep) return false
    }
  }

  u32(at: number): number {
    return ((this.u16(at) << 16) | this.u16(at + 2)) >>> 0
  }

  put32(at: number, v: number): void {
    this.put16(at, (v >>> 16) & 0xffff)
    this.put16(at + 2, v & 0xffff)
  }
}

/**
 * The twenty bytes `VerI` (+Verif.s:2989) builds its argument string in.
 *
 * Five cleared longs and an index, and the index stops dead at 18: `addq.w
 * #1,d0 / cmp.w #19,d0 / bcs.s VerI3 / subq.w #1,d0`. So an instruction with
 * more than ten arguments has the eleventh onwards written over the same byte,
 * and what `VerC` sees is ten. `Ipalette` with sixteen colours is stored as
 * the ten-argument variant with a count of nine, which is not a bug in the
 * program that wrote it.
 */
class ArgString {
  private chars: string[] = []
  private at = 0

  push(c: string): void {
    this.chars[this.at] = c
    this.chars.length = this.at + 1
    this.at++
    if (this.at >= 19) this.at--
  }

  get text(): string {
    return this.chars.join('')
  }

  /** `move.w 20(sp),d0 / addq.w #1,d0 / lsr.w #1,d0` */
  get count(): number {
    return (this.at + 1) >> 1
  }
}

interface Definition {
  table: TokenTable
  /** the entry's index, so `VerC` can step to the variant behind it */
  i: number
  /** the spec's first character: I, V, or the type a function returns */
  kind: string
  params: string
}

/** the spec terminator standing in for a kind when the entry has no spec at all */
const TERM = '\xff'

/**
 * The operator ids in table order, which is the order `OPERATORS` was built
 * in: each is a negative offset from the end of `Dtk_Operateurs`, so ascending
 * unsigned is the order the entries sit in, and it is also their precedence.
 */
const OPERATOR_IDS = [...OPERATORS.keys()].sort((a, b) => a - b)

/** `_TkEg`, the `=` operator, which is also how an assignment is written */
const TK_EQUALS = [...OPERATORS].find(([, name]) => name === '=')![0]

/**
 * `Ope_CheckType` (+Verif.s:2663): the spec's kind character as the type an
 * expression carries. A float and an "either" both come back as `0`, which is
 * why a spec of `1` never reaches `VerC` as anything but a number.
 */
function checkType(kind: string): string {
  return kind === '2' ? '2' : '0'
}

/**
 * Which of the four tests each operator uses, in the order
 * `Tst_Operateurs` (+Verif.s:5251) declares them.
 *
 * `Tst_Comp` returns an integer whatever it compared, `Tst_Mixte` keeps the
 * type it was given, and the rest demand two integers. `^` is `Tst_Puis`,
 * which only sets a maths flag before falling into `Tst_Chiffre`, so it is
 * not a fourth behaviour here.
 */
const OP_TESTS = [
  'chiffre', // xor
  'chiffre', // or
  'chiffre', // and
  'comp', // <>
  'comp', // ><
  'comp', // <=
  'comp', // =<
  'comp', // >=
  'comp', // =>
  'comp', // =
  'comp', // <
  'comp', // >
  'mixte', // +
  'mixte', // -
  'chiffre', // mod
  'chiffre', // *
  'chiffre', // /
  'chiffre', // ^
] as const
const OP_TEST = new Map(OPERATOR_IDS.map((id, i) => [id, OP_TESTS[i]!]))

/**
 * Verify a source block the way `PTest` (+Verif.s:73) does: the main program
 * first, then every procedure in a phase of its own.
 */
export function verify(src: Uint8Array, opts: VerifyOptions = {}): Uint8Array {
  const b = Uint8Array.from(src)
  const v = new Verifier(b, opts.extensions ?? new Map(), opts.ap20 ?? new Set())
  v.run(0)
  v.globals = v.locals
  for (const at of v.procedures) {
    v.phase++
    v.varLong = 0
    v.locals = []
    // `Locale` (:3499): a name Shared put in the global table stays reachable,
    // everything else goes back to being invisible from a procedure
    for (const g of v.globals) if (g.global !== 2) g.global = 0
    v.run(at + 2)
  }
  return b
}
