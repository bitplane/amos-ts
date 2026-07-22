import type { Tok, TokenLine } from '../tokens/stream'
import { varType } from './values'
import type { VarType } from './values'
import type { Names } from './names'

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
}

export interface Program {
  lines: TokenLine[]
  labels: Map<string, Addr>
  procs: Map<string, ProcInfo>
  ctrl: Map<Tok, Ctrl>
  /** every Data token, in program order (for Read/Restore) */
  dataToks: Addr[]
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
    procs: new Map(),
    ctrl: new Map(),
    dataToks: [],
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
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      if (top.t === want) {
        stack.pop()
        return top
      }
      if (top.t === 'if') {
        warn(li, `unclosed If discarded while matching ${closer}`)
        stack.pop()
        continue
      }
      break
    }
    warn(li, `${closer} without matching ${want}`)
    return undefined
  }

  for (let li = 0; li < lines.length; li++) {
    const toks = lines[li]!.tokens
    for (let ti = 0; ti < toks.length; ti++) {
      const tok = toks[ti]!
      const here: Addr = { li, ti }

      if (tok.kind === 'label') {
        program.labels.set(tok.name.toLowerCase(), { li, ti: ti + 1 })
        continue
      }

      if (tok.kind === 'proc') {
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
        program.procs.set(info.name, info)
        program.ctrl.set(tok, { kind: 'proc', skip: info.skip })
        stack.push({ t: 'proc', info })
        continue
      }

      const name = names.of(tok)
      if (name === undefined) continue

      switch (name) {
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

  return program
}
