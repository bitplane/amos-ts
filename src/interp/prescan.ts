import type { Tok, TokenLine } from '../tokens/stream'
import { MACHINE_CODE_PROC } from '../tokens/stream'
import { varType } from './values'
import type { VarType } from './values'
import type { Names } from './names'
import { KEYWORD_PROBE } from '../coverage/probe'

/** Position in the program: line index + token index. */
export interface Addr {
  li: number
  ti: number
}

/**
 * Per-token control-flow info, computed before the run. (The original
 * interpreter gets the same information from inline branch links in the
 * token stream; we recompute it so programs tokenized from text — which
 * have no links — work identically.)
 *
 * Addr fields are patched in place during the scan; related tokens share
 * the same Addr object.
 */
export type Ctrl =
  | { kind: 'if'; singleLine: boolean; onFalse: Addr }
  | { kind: 'elseif'; singleLine: boolean; onFalse: Addr; exit: Addr }
  | { kind: 'else'; exit: Addr }
  | { kind: 'for'; after: Addr }
  | { kind: 'while'; after: Addr }
  | { kind: 'wend'; whileAddr: Addr }
  | { kind: 'loop'; start: Addr }
  /** on Repeat/Do tokens: where their loop ends (for Goto unwinding) */
  | { kind: 'loopStart'; after: Addr }
  | { kind: 'exit'; exits: Addr[] }
  | { kind: 'proc'; skip: Addr }

export interface ProcInfo {
  name: string
  /** parameter variable keys + types, in declaration order */
  params: Array<{ key: string; type: VarType }>
  /** first statement of the body */
  body: Addr
  /** statement after End Proc — where a Procedure token jumps in normal flow */
  skip: Addr
  /**
   * Set when the token stream has none of the body. That means AMOS Pro's
   * machine-language procedure, whose body is a 68k image — or, rarely, an
   * AMOS 1.x locked one that could not be deciphered, which on a sound file
   * does not happen (see procode.ts). The program still loads and everything
   * outside runs; a CALL is what cannot be honoured.
   */
  protectedBody?: 'machine code' | 'locked'
}

export interface Program {
  lines: TokenLine[]
  labels: Map<string, Addr>
  /**
   * The same labels keyed by `<procedure>\u0000<name>`, because a label
   * belongs to the procedure it is written in.
   *
   * `Get_Label` (+Verif.s:3462) builds its search key from `Phase(a5)` — the
   * verifier's per-procedure serial, `addq.w #1,Phase(a5)` once per procedure
   * (:138) — packed beside the name length, and matches with a single
   * `cmp.l (a0),d0`. `V1_StockLabel` (:3413) stores the same word, commented
   * "Longueur / Flags / Phase". Two procedures may therefore each hold a
   * label of the same name and they are different labels.
   *
   * Gush has four procedures with a `SCRDAT:` and its own copy of the same
   * twenty-five numbers, and two more sharing `RDAT:`. Resolving those
   * against one flat map sent `Restore SCRDAT` in the third procedure to the
   * fourth procedure's data, which the procedure-scoped Read cannot see, and
   * the game reported its own "Error #33: Undefined error!!".
   */
  scopedLabels: Map<string, Addr>
  procs: Map<string, ProcInfo>
  ctrl: Map<Tok, Ctrl>
  /**
   * Every name the MAIN program declares Global or Shared, as a var key.
   *
   * `InShared` (+ILib.s:4177) does nothing at run time: `Sha0` reads each
   * name's length, steps over it, skips an optional "()", loops on a comma
   * and returns. The scoping is decided by the Test pass instead. `VerSha`
   * (+Verif.s:3826) walks the whole main program in Phase 0, and `PTest`
   * (:73) verifies every procedure in a phase of its own afterwards, so a
   * procedure sees a Global written BELOW the line that calls it.
   */
  globals: Set<string>
  /**
   * Per-procedure `Shared` names, keyed by procedure name.
   *
   * Same routine, same reason: a procedure is one verify phase, so `Shared`
   * covers the whole body rather than the statements after it. `Locale`
   * (+Verif.s:3499) clears the global flags on the way in and `VerSha`'s
   * `move.b #1,5(a2)` sets this one, which `tst.w Phase(a5) / bne.s Sh1c`
   * (:3879) stops short of the 2 that means Global.
   */
  procShared: Map<string, Set<string>>
  /** every Data token, in program order (for Read/Restore) */
  dataToks: Addr[]
  /**
   * `Prg_Accessory`, set by the VERIFIER and therefore true for the whole
   * program, not just after the statement.
   *
   * VerSetA (+Verif.s:826) is `bsr SetNot1.3 / addq.b #1,Prg_Accessory(a5)`,
   * and Ver_APCmp (:1631) reads the same flag out of a saved program's
   * APrg_MathFlags high byte. Two places read it back: CheckScreenNumber
   * (+Lib.s:9167) gives an accessory ten screens instead of eight, and InRun1
   * (+ILib.s:1452) turns Run into Prun so an accessory chains rather than
   * replacing its host.
   */
  accessory: boolean
  warnings: string[]
}

/** name of the procedure whose body contains addr, or null (Data scoping) */
export function scopeOfAddr(program: Program, addr: Addr): string | null {
  for (const [name, p] of program.procs) {
    const afterBody = addr.li > p.body.li || (addr.li === p.body.li && addr.ti >= p.body.ti)
    const beforeSkip = addr.li < p.skip.li || (addr.li === p.skip.li && addr.ti < p.skip.ti)
    if (afterBody && beforeSkip) return name
  }
  return null
}

export function varKey(name: string, flags: number): string {
  const t = varType(flags)
  return name.toLowerCase() + (t === 1 ? '#' : t === 2 ? '$' : '')
}

type IfOpen = {
  t: 'if'
  li: number
  singleLine: boolean
  /** the If/Else If ctrl whose onFalse is still unresolved; null after Else */
  cur: { singleLine: boolean; onFalse: Addr } | null
  /** exit addrs of Else/Else If branches, all pointing at End If */
  exits: Addr[]
}
type LoopOpen = { t: 'for' | 'repeat' | 'while' | 'do'; after: Addr; addr: Addr; start: Addr }
type ProcOpen = { t: 'proc'; info: ProcInfo }
type Open = IfOpen | LoopOpen | ProcOpen

const newAddr = (): Addr => ({ li: -1, ti: -1 })
const setAddr = (a: Addr, to: Addr): void => {
  a.li = to.li
  a.ti = to.ti
}

export function prescan(lines: TokenLine[], names: Names): Program {
  const program: Program = {
    lines,
    labels: new Map(),
    scopedLabels: new Map(),
    procs: new Map(),
    ctrl: new Map(),
    globals: new Set(),
    procShared: new Map(),
    dataToks: [],
    accessory: false,
    warnings: [],
  }
  const stack: Open[] = []
  const warn = (li: number, msg: string): void => {
    program.warnings.push(`line ${li + 1}: ${msg}`)
  }

  /** Address of the statement following the statement containing {li,ti}. */
  const afterStatement = (li: number, ti: number): Addr => {
    const toks = lines[li]!.tokens
    for (let k = ti; k < toks.length; k++) {
      if (names.of(toks[k]!) === ':') return { li, ti: k + 1 }
    }
    return { li: li + 1, ti: 0 }
  }

  /** innermost-first exit targets of open loops (for Exit/Exit If) */
  const loopExits = (): Addr[] => {
    const out: Addr[] = []
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]!
      if (e.t === 'proc') break
      if (e.t !== 'if') out.push(e.after)
    }
    return out
  }

  const popLoop = (li: number, want: LoopOpen['t'], closer: string): LoopOpen | undefined => {
    // Search DOWN for the loop, splicing only it. An intervening If is left
    // on the stack (resolved by the end-of-line / End If cleanup), not
    // discarded — the common AMOS idiom `If C Then For..` on one line with
    // `If C Then Next` on the next puts the loop's closer inside its own
    // single-line If, so discarding that If would orphan its branch target.
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]!
      if (e.t === want) {
        stack.splice(i, 1)
        return e as LoopOpen
      }
      if (e.t === 'if') continue
      break
    }
    warn(li, `${closer} without matching ${want}`)
    return undefined
  }

  const labelSites: Array<[string, Addr]> = []
  for (let li = 0; li < lines.length; li++) {
    const toks = lines[li]!.tokens
    for (let ti = 0; ti < toks.length; ti++) {
      const tok = toks[ti]!
      const here: Addr = { li, ti }

      if (tok.kind === 'label') {
        const at: Addr = { li, ti: ti + 1 }
        program.labels.set(tok.name.toLowerCase(), at)
        labelSites.push([tok.name.toLowerCase(), at])
        continue
      }

      if (tok.kind === 'proc') {
        KEYWORD_PROBE?.add('proc') // a token kind, resolved here rather than dispatched
        const nameTok = toks[ti + 1]
        if (nameTok === undefined || !('name' in nameTok)) {
          warn(li, 'Procedure without a name')
          continue
        }
        const params: ProcInfo['params'] = []
        for (let k = ti + 2; k < toks.length; k++) {
          const p = toks[k]!
          if (p.kind === 'var') params.push({ key: varKey(p.name, p.flags), type: varType(p.flags) })
          else if (names.of(p) === ']') break
        }
        const info: ProcInfo = {
          name: nameTok.name.toLowerCase(),
          params,
          body: afterStatement(li, ti),
          skip: newAddr(),
        }
        // keyed on the body actually being absent, not on the flag: a locked
        // procedure has been deciphered by now and reads as ordinary lines,
        // and an AMOS Pro machine-language one carries its own `@_apml_@`
        // line and keeps its body, which the runtime handles itself
        if (tok.protectedBody) {
          info.protectedBody = tok.flags & MACHINE_CODE_PROC ? 'machine code' : 'locked'
        }
        program.procs.set(info.name, info)
        program.ctrl.set(tok, { kind: 'proc', skip: info.skip })
        stack.push({ t: 'proc', info })
        continue
      }

      const name = names.of(tok)
      if (name === undefined) continue

      switch (name) {
        case 'global':
        case 'shared': {
          // Read the declaration here rather than when the statement runs.
          // A procedure cannot nest in AMOS, so the innermost open proc is
          // the phase this declaration belongs to; anything else is Phase 0.
          let owner: string | null = null
          for (let i = stack.length - 1; i >= 0; i--) {
            const e = stack[i]!
            if (e.t === 'proc') {
              owner = e.info.name
              break
            }
          }
          let set = program.globals
          if (owner !== null) {
            set = program.procShared.get(owner) ?? new Set()
            program.procShared.set(owner, set)
          }
          const at = (k: number): string | undefined => {
            const t = toks[k]
            return t === undefined ? undefined : names.of(t)
          }
          for (let k = ti + 1; k < toks.length; k++) {
            const v = toks[k]
            if (v === undefined || v.kind !== 'var') break
            // `Global Y()` declares the ARRAY Y, a different variable from
            // the scalar: `bset #6,d2` (+Verif.s:3853) goes into the flag
            // byte the name search then compares.
            const arr = at(k + 1) === '('
            set.add(varKey(v.name, v.flags) + (arr ? '()' : ''))
            if (arr) k += 2
            if (at(k + 1) !== ',') break
            k++
          }
          break
        }
        case 'set accessory':
          // the verifier sets it, so it holds from the first line
          program.accessory = true
          break
        case 'if': {
          const ctrl = { kind: 'if' as const, singleLine: false, onFalse: newAddr() }
          program.ctrl.set(tok, ctrl)
          stack.push({ t: 'if', li, singleLine: false, cur: ctrl, exits: [] })
          break
        }
        case 'then': {
          for (let i = stack.length - 1; i >= 0; i--) {
            const e = stack[i]!
            if (e.t === 'if' && e.li === li && !e.singleLine) {
              e.singleLine = true
              if (e.cur) e.cur.singleLine = true
              break
            }
          }
          break
        }
        case 'else if': {
          const top = stack[stack.length - 1]
          if (top?.t !== 'if') {
            warn(li, 'Else If without If')
            break
          }
          const ctrl = { kind: 'elseif' as const, singleLine: top.singleLine, onFalse: newAddr(), exit: newAddr() }
          program.ctrl.set(tok, ctrl)
          // when the previous branch's condition is false, evaluate this one
          if (top.cur) setAddr(top.cur.onFalse, here)
          top.cur = ctrl
          top.exits.push(ctrl.exit)
          break
        }
        case 'else': {
          const top = stack[stack.length - 1]
          if (top?.t !== 'if') {
            warn(li, 'Else without If')
            break
          }
          const ctrl = { kind: 'else' as const, exit: newAddr() }
          program.ctrl.set(tok, ctrl)
          if (top.cur) setAddr(top.cur.onFalse, { li, ti: ti + 1 })
          top.cur = null
          top.exits.push(ctrl.exit)
          break
        }
        case 'end if': {
          const top = stack[stack.length - 1]
          if (top?.t !== 'if' || top.singleLine) {
            warn(li, 'End If without If')
            break
          }
          stack.pop()
          // false-branch and completed branches land on the End If token
          // itself; executing it is a no-op statement
          if (top.cur) setAddr(top.cur.onFalse, here)
          for (const e of top.exits) setAddr(e, here)
          break
        }
        case 'for': {
          const ctrl = { kind: 'for' as const, after: newAddr() }
          program.ctrl.set(tok, ctrl)
          stack.push({ t: 'for', after: ctrl.after, addr: here, start: afterStatement(li, ti) })
          break
        }
        case 'next': {
          const open = popLoop(li, 'for', 'Next')
          if (open) setAddr(open.after, afterStatement(li, ti))
          break
        }
        case 'repeat': {
          const after = newAddr()
          program.ctrl.set(tok, { kind: 'loopStart', after })
          stack.push({ t: 'repeat', after, addr: here, start: afterStatement(li, ti) })
          break
        }
        case 'until': {
          const open = popLoop(li, 'repeat', 'Until')
          if (open) setAddr(open.after, afterStatement(li, ti))
          break
        }
        case 'while': {
          const ctrl = { kind: 'while' as const, after: newAddr() }
          program.ctrl.set(tok, ctrl)
          stack.push({ t: 'while', after: ctrl.after, addr: here, start: afterStatement(li, ti) })
          break
        }
        case 'wend': {
          const open = popLoop(li, 'while', 'Wend')
          if (open) {
            setAddr(open.after, afterStatement(li, ti))
            program.ctrl.set(tok, { kind: 'wend', whileAddr: open.addr })
          }
          break
        }
        case 'do': {
          const after = newAddr()
          program.ctrl.set(tok, { kind: 'loopStart', after })
          stack.push({ t: 'do', after, addr: here, start: afterStatement(li, ti) })
          break
        }
        case 'loop': {
          const open = popLoop(li, 'do', 'Loop')
          if (open) {
            setAddr(open.after, afterStatement(li, ti))
            program.ctrl.set(tok, { kind: 'loop', start: open.start })
          }
          break
        }
        case 'exit':
        case 'exit if': {
          program.ctrl.set(tok, { kind: 'exit', exits: loopExits() })
          break
        }
        case 'end proc': {
          let open: Open | undefined
          while ((open = stack.pop()) !== undefined) {
            if (open.t === 'proc') break
            warn(li, `unclosed ${open.t} discarded at End Proc`)
          }
          if (open === undefined || open.t !== 'proc') {
            warn(li, 'End Proc without Procedure')
            break
          }
          setAddr(open.info.skip, afterStatement(li, ti))
          break
        }
        case 'data': {
          program.dataToks.push(here)
          break
        }
      }
    }

    // single-line If constructs never survive their line
    const lineEnd: Addr = { li, ti: toks.length }
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]!
      if (e.t === 'if' && e.singleLine) {
        if (e.cur) setAddr(e.cur.onFalse, lineEnd)
        for (const x of e.exits) setAddr(x, lineEnd)
        stack.splice(i, 1)
      }
    }
  }

  const endAddr: Addr = { li: lines.length, ti: 0 }
  for (const e of stack) {
    if (e.t === 'if') {
      if (e.cur) setAddr(e.cur.onFalse, endAddr)
      for (const x of e.exits) setAddr(x, endAddr)
      program.warnings.push(`unclosed If from line ${e.li + 1}`)
    } else if (e.t === 'proc') {
      setAddr(e.info.skip, endAddr)
      program.warnings.push(`Procedure ${e.info.name} has no End Proc`)
    } else {
      setAddr(e.after, endAddr)
      program.warnings.push(`unclosed ${e.t} loop`)
    }
  }

  // procedure bodies are known only now, so the scoped keys are built last
  for (const [name, at] of labelSites) {
    program.scopedLabels.set(`${scopeOfAddr(program, at) ?? ''}\u0000${name}`, at)
  }
  return program
}
