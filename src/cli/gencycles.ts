/**
 * Cost every AMOS Professional keyword out of the assembler that implements it.
 *
 * The cost model used to charge one flat number per BASIC statement, fitted to
 * a delay loop in 18th Hole. That number reproduces `For J=0 To 280 : Next J`
 * exactly and is wrong by an order of magnitude for anything with arguments,
 * because on the machine a statement is not a unit of work: the ChrGet loop
 * dispatches one token at a time, and `Bob N+2,METX(N),METY(N),3` is sixteen
 * trips through it against `Next J`'s one.
 *
 * So this counts the real thing. `amosasm.ts` resolves each token's routine
 * number to a label in `+ILib.s` or `+Lib.s`; this walks that routine's code,
 * follows its calls, and adds up 68000 cycles from `m68kcost.ts`.
 *
 * What the walk does with the paths it cannot know:
 *
 * - At a conditional branch it costs both arms and takes the CHEAPER one.
 *   Fall-through looks like the obvious choice and is wrong: in hand-written
 *   68000 the common case is usually the branch, because the author puts the
 *   special case inline to keep the fast path short. `Inc A` on a scalar came
 *   out at 696 cycles under fall-through, 512 of which were `bsr GetTablo`
 *   (+ILib.s:3867) evaluating array subscripts that a scalar never has.
 * - A branch back to a line already being costed is a loop. It is priced at
 *   infinity so the other arm wins, which counts the body once and flags the
 *   routine. The trip count is data: `Cls`, `Bar` and the bob blitter run per
 *   word of the region they touch, and that term belongs to the blitter model.
 * - `WiCall`/`EcCall`/`SyCall` are `move.l T_xVect(a5),a0 / jsr n*4(a0)` into a
 *   table of `bra`s (+W.s:13235 installs the window one), so they resolve to a
 *   real routine and the 38 cycles of the dispatch are charged on top.
 *
 * Everything here counts an uncontended bus. On an A500 the display DMA steals
 * slots from the CPU and AMOS's inner loop is almost pure chip-RAM traffic, so
 * a screen-dependent multiplier belongs on top of these numbers, not inside
 * them.
 *
 * Run: npm run cli -- src/cli/gencycles.ts [--keyword bob] [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AMOS_SRC, SOURCES, loadSources, type Line, type Sources } from './amosasm'
import { dbccCost, instrCost } from './m68kcost'
import { CORE_TOKENS } from '../tokens/tables.gen'

/** `move.l T_WiVect(a5),a0` + `jsr n*4(a0)`, +Equ.s:740. */
const VECTOR_DISPATCH = 16 + 22

/**
 * One trip through the ChrGet loop, +ILib.s:476-481, with `Debug` set to 0 so
 * its `IFNE Debug` blocks assemble to nothing:
 *
 *     move.w  (a6)+,d0                8   next token
 *     bne.s   _Inst                  10   taken
 *     move.l  a6,d7                   4
 *     move.w  0(a4,d0.w),d1          14   index the token table
 *     move.l  -LB_Size(a4,d1.w),a0   18   index the jump table
 *     jsr     (a0)                   16
 *
 * The routine's own `rts` is counted in the routine, not here.
 */
export const DISPATCH_CYCLES = 8 + 10 + 4 + 14 + 18 + 16

const COND = ['beq', 'bne', 'bcs', 'bcc', 'blt', 'bge', 'bls', 'bhi', 'ble', 'bgt', 'bmi', 'bpl', 'bvs', 'bvc']
/** the R-macro conditional forms, +CEqu.s:88-125 */
const RCOND = new Set([
  'rbeq',
  'rbne',
  'rbcs',
  'rbcc',
  'rblt',
  'rbge',
  'rbls',
  'rbhi',
  'rble',
  'rbpl',
  'rbmi',
])

const DIRECTIVE =
  /^(dc|ds|dcb|even|cnop|rs|rsset|rsreset|rwreset|equ|set|incdir|include|opt|section|ifne|ifeq|ifnd|ifd|endc|end|macro|endm|rept|endr|version|printt|fail)$/
const DEFINER = /^lib_(par|def|int|ext|empty|end|ini|pos)$/

/** a branch that leads back into a line already being costed */
const LOOP_COST = 1e9

/**
 * Where AMOS goes when a keyword's precondition fails. `Cls` is
 * `tst.w ScOn(a5) / Rbeq L_ScNOp` (+Lib.s:8693) and `ScNOp` is
 * `moveq #3,d0 / Rbra L_EcWiErr` (+Lib.s:12907), which lands here. An arm that
 * only ever reaches one of these is the error case, never the normal path, so
 * the walk refuses it however cheap it looks.
 */
const ABORT_LABELS = new Set(['RunErr', 'RunErrExt', 'Erreur', 'ErrExt'])

interface Site {
  file: string
  idx: number
}

/** Cost from one line to the routine's return. */
interface Flow {
  cycles: number
  loops: boolean
  /** every path from here raises an error instead of returning */
  aborts: boolean
  /** the result depended on a loop cut-off, so it must not be memoised */
  tainted: boolean
}

export interface Analysis {
  cycles: number
  /** the routine contains a data-dependent loop, so `cycles` is a floor */
  loops: boolean
  /** call targets the walk could not resolve */
  unresolved: string[]
}

/** `NAME equ 11` from the equate files, for resolving WiCall/EcCall indices. */
function loadEquates(root: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of ['+Equ.s', '+WEqu.s', '+CEqu.s']) {
    const text = readFileSync(`${root}/${f}`, 'latin1').replace(/\0/g, '')
    for (const raw of text.split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*):?\s+equ\s+(\$?[0-9a-fA-F]+)\s*$/.exec(raw.split(';')[0]!.trimEnd())
      if (!m) continue
      const v = m[2]!.startsWith('$') ? parseInt(m[2]!.slice(1), 16) : Number(m[2])
      if (Number.isFinite(v) && !out.has(m[1]!)) out.set(m[1]!, v)
    }
  }
  return out
}

export class Coster {
  private readonly src: Sources
  private readonly equ: Map<string, number>
  /** file -> label -> index, globals only */
  private readonly globals = new Map<string, Map<string, number>>()
  /** 'Wi' | 'Ec' | 'Sy' -> slot -> routine label */
  private readonly vectors = new Map<string, string[]>()
  private readonly memo = new Map<string, Flow>()
  private readonly active = new Set<string>()
  private readonly unresolved = new Set<string>()

  constructor(root = AMOS_SRC) {
    this.src = loadSources(root)
    this.equ = loadEquates(root)
    for (const f of SOURCES) {
      const m = new Map<string, number>()
      const ls = this.src.lines.get(f)!
      for (let i = 0; i < ls.length; i++) {
        const lb = ls[i]!.label
        if (lb && !lb.startsWith('.') && !m.has(lb)) m.set(lb, i)
      }
      this.globals.set(f, m)
    }
    for (const [key, label] of [
      ['Wi', 'WiIn'],
      ['Ec', 'EcIn'],
      ['Sy', 'SyIn'],
    ] as Array<[string, string]>)
      this.vectors.set(key, this.readBranchTable(label))
  }

  get sources(): Sources {
    return this.src
  }

  /** A vector table is a run of `bra <routine>`; the nth entry is slot n. */
  private readBranchTable(label: string): string[] {
    for (const f of SOURCES) {
      const at = this.globals.get(f)!.get(label)
      if (at === undefined) continue
      const ls = this.src.lines.get(f)!
      const out: string[] = []
      for (let i = at; i < ls.length; i++) {
        const l = ls[i]!
        if (l.mnem !== 'bra' || l.ops.length !== 1) break
        out.push(l.ops[0]!)
      }
      return out
    }
    return []
  }

  /** Resolve a branch or call target to a line. */
  private resolve(from: Site, target: string): Site | null {
    const t = target.trim()
    if (t === '') return null
    if (t.startsWith('L_')) {
      const r = this.src.byName.get(t)
      return r && r.at >= 0 ? { file: r.file, idx: r.at } : null
    }
    const ls = this.src.lines.get(from.file)!
    if (t.startsWith('.')) {
      // a local label belongs to the nearest definition either side of the use
      for (let d = 1; d < 3000; d++) {
        if (from.idx + d < ls.length && ls[from.idx + d]!.label === t) return { file: from.file, idx: from.idx + d }
        if (from.idx - d >= 0 && ls[from.idx - d]!.label === t) return { file: from.file, idx: from.idx - d }
      }
      return null
    }
    const here = this.globals.get(from.file)!.get(t)
    if (here !== undefined) return { file: from.file, idx: here }
    for (const f of SOURCES) {
      const at = this.globals.get(f)!.get(t)
      if (at !== undefined) return { file: f, idx: at }
    }
    return null
  }

  /** Cost a named routine, e.g. `L_InBob`. */
  cost(name: string): Analysis | null {
    const r = this.src.byName.get(name)
    if (!r || r.at < 0) return null
    this.unresolved.clear()
    const f = this.costFrom({ file: r.file, idx: r.at })
    return {
      cycles: f.cycles >= LOOP_COST ? 0 : Math.round(f.cycles),
      loops: f.loops,
      unresolved: [...this.unresolved],
    }
  }

  /** Cycles from this line to the routine's return, cheaper arm at each branch. */
  private costFrom(site: Site): Flow {
    const key = `${site.file}:${site.idx}`
    const hit = this.memo.get(key)
    if (hit) return hit
    if (this.active.has(key)) return { cycles: LOOP_COST, loops: true, aborts: false, tainted: true }

    const ls = this.src.lines.get(site.file)!
    const l = ls[site.idx]
    if (!l) return { cycles: 0, loops: false, aborts: false, tainted: false }

    this.active.add(key)
    const r = this.evalLine(l, site)
    this.active.delete(key)
    if (!r.tainted) this.memo.set(key, r)
    return r
  }

  private next(site: Site): Flow {
    return this.costFrom({ file: site.file, idx: site.idx + 1 })
  }

  /** A call's cost: the callee's body, or 0 with a note when it cannot be found. */
  private call(from: Site, target: string): number {
    const site = this.resolve(from, target)
    if (!site) {
      this.unresolved.add(target)
      return 0
    }
    const f = this.costFrom(site)
    return f.cycles >= LOOP_COST ? 0 : f.cycles
  }

  private evalLine(l: Line, site: Site): Flow {
    const m = l.mnem
    const then = (own: number, rest: Flow): Flow => ({
      cycles: own + rest.cycles,
      loops: rest.loops,
      aborts: rest.aborts,
      tainted: rest.tainted,
    })
    if (ABORT_LABELS.has(l.label)) return { cycles: 0, loops: false, aborts: true, tainted: false }

    if (m === '' || DIRECTIVE.test(m)) return this.next(site)
    // a definer starts the next routine, so the previous one has ended
    if (DEFINER.test(m)) return { cycles: 0, loops: false, aborts: false, tainted: false }

    switch (m) {
      case 'rts':
        return { cycles: 16, loops: false, aborts: false, tainted: false }
      case 'ret_int':
      case 'ret_float':
      case 'ret_string':
        return { cycles: 20, loops: false, aborts: false, tainted: false }
      case 'ret_inst':
        return { cycles: 16, loops: false, aborts: false, tainted: false }
      case 'rte':
      case 'rtr':
        return { cycles: 20, loops: false, aborts: false, tainted: false }
    }

    // vector dispatch into the window, screen or system table
    const vec = /^(wi|ec|sy)cal[l2ad]$/.exec(m)
    if (vec) {
      let own = VECTOR_DISPATCH
      if (m.endsWith('a') || m.endsWith('d')) own += 8 // the lea / moveq the variant adds
      if (m.endsWith('2')) own += 12
      const slot = this.equ.get(l.ops[0] ?? '')
      const table = this.vectors.get(vec[1]![0]!.toUpperCase() + vec[1]![1]!) ?? []
      const target = slot === undefined ? undefined : table[slot]
      if (target === undefined) this.unresolved.add(`${m} ${l.ops[0] ?? '?'}`)
      else own += 10 + this.call(site, target) // the bra in the table, then the routine
      return then(own, this.next(site))
    }

    // the R-macros; the library loader patches each into a real m68k branch
    if (m === 'rbra' || m === 'rjmp' || m === 'rjmpt' || m === 'ljmp') {
      const t = this.resolve(site, l.ops[0] ?? '')
      if (!t) {
        this.unresolved.add(l.ops[0] ?? '?')
        return { cycles: 10, loops: false, aborts: false, tainted: false }
      }
      return then(m === 'rbra' ? 10 : 12, this.costFrom(t))
    }
    if (m === 'rbsr' || m === 'rjsr' || m === 'rjsrt' || m === 'ljsr') {
      return then((m === 'rbsr' ? 18 : 20) + this.call(site, l.ops[0] ?? ''), this.next(site))
    }
    if (m === 'rlea') return then(12, this.next(site))

    if (m === 'bra') {
      const t = this.resolve(site, l.ops[0] ?? '')
      if (!t) {
        this.unresolved.add(l.ops[0] ?? '?')
        return { cycles: 10, loops: false, aborts: false, tainted: false }
      }
      return then(10, this.costFrom(t))
    }
    if (m === 'bsr') return then(18 + this.call(site, l.ops[0] ?? ''), this.next(site))
    if (m === 'jsr') return then(instrCost('jsr', l.size, l.ops).cycles, this.next(site))
    if (m === 'jmp') return { cycles: instrCost('jmp', l.size, l.ops).cycles, loops: false, aborts: false, tainted: false }

    // conditional: cost both arms, keep the cheaper
    if (COND.includes(m) || RCOND.has(m) || /^db(ra|f|eq|ne|cc|cs|lt|ge|le|gt|mi|pl|hi|ls)$/.test(m)) {
      const isDb = m.startsWith('db')
      const target = this.resolve(site, l.ops[isDb ? 1 : 0] ?? '')
      const fall = this.next(site)
      const taken: Flow = target
        ? this.costFrom(target)
        : { cycles: LOOP_COST, loops: true, aborts: false, tainted: true }
      // Bcc.b is 8 falling through and 10 taken; DBcc is 14 out and 10 round
      const fallOwn = isDb ? dbccCost().cycles : RCOND.has(m) ? 12 : 8
      const arms: Array<[number, Flow]> = [
        [fallOwn + fall.cycles, fall],
        [10 + taken.cycles, taken],
      ]
      // an arm that only raises an error is not a path the keyword normally takes
      const live = arms.filter(([, f]) => !f.aborts)
      const pool = live.length > 0 ? live : arms
      const best = pool.reduce((a, b) => (a[0] <= b[0] ? a : b))
      return {
        cycles: best[0],
        loops: fall.loops || taken.loops,
        aborts: best[1].aborts,
        tainted: fall.tainted || taken.tainted,
      }
    }

    return then(instrCost(m, l.size, l.ops).cycles, this.next(site))
  }
}

/** The `dc.w <instr>,<func>` label pair of every entry in +Lib.s's token table. */
export function tokenLabels(root = AMOS_SRC): Array<[string, string]> {
  const lines = readFileSync(`${root}/+Lib.s`, 'latin1').replace(/\0/g, '').split('\n')
  const start = lines.findIndex((l) => l.startsWith('C_Tk'))
  const out: Array<[string, string]> = []
  let pend: [string, string] | null = null
  for (let i = start; i < lines.length; i++) {
    if (/^C_Lib/.test(lines[i]!)) break
    const m = /^(?:C_Tk)?\s*dc\.w\s+([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)/.exec(lines[i]!)
    if (m) {
      pend = [m[1]!, m[2]!]
      continue
    }
    // an entry is a routine pair followed by its dc.b name and spec block
    if (/^\s*dc\.b\s/.test(lines[i]!) && pend) {
      out.push(pend)
      pend = null
    }
  }
  return out
}

export interface TokenCost {
  /** token id, the byte offset of the entry in the library's token table */
  id: number
  name: string
  instrCycles: number | null
  funcCycles: number | null
  loops: boolean
}

/** Cost every core token. */
export function costTokens(c = new Coster()): TokenCost[] {
  const pairs = tokenLabels()
  const rows: TokenCost[] = []
  for (let i = 0; i < Math.min(pairs.length, CORE_TOKENS.length); i++) {
    const [iL, fL] = pairs[i]!
    const t = CORE_TOKENS[i]!
    const ia = iL.startsWith('L_') ? c.cost(iL) : null
    const fa = fL.startsWith('L_') ? c.cost(fL) : null
    rows.push({
      id: t.id,
      name: t.name,
      instrCycles: ia?.cycles ?? null,
      funcCycles: fa?.cycles ?? null,
      loops: Boolean(ia?.loops || fa?.loops),
    })
  }
  return rows
}

function main(): void {
  const argv = process.argv.slice(2)
  const only = argv.includes('--keyword') ? argv[argv.indexOf('--keyword') + 1] : undefined
  const c = new Coster()
  console.log(`routine slots: ${c.sources.slots} (AMOSPro.Lib declares 1541)`)
  console.log(`dispatch: ${DISPATCH_CYCLES} cycles per token`)
  const rows = costTokens(c)

  if (only !== undefined) {
    for (const r of rows.filter((r) => r.name.trim() === only)) console.log(r)
    return
  }

  const cost = (r: TokenCost): number => Math.max(r.instrCycles ?? 0, r.funcCycles ?? 0)
  const named = rows.filter((r) => r.name.trim() !== '' && cost(r) > 0)
  const sorted = [...named].sort((a, b) => cost(a) - cost(b))
  const pct = (p: number): number => cost(sorted[Math.floor((sorted.length - 1) * p)]!)
  console.log(`tokens: ${rows.length}, ${named.length} costed`)
  console.log(`  min ${cost(sorted[0]!)}  p25 ${pct(0.25)}  median ${pct(0.5)}  p75 ${pct(0.75)}  max ${cost(sorted[sorted.length - 1]!)}`)
  for (const k of ['next', 'inc', 'if', 'for', 'bob', 'print', 'wait vbl', 'paste bob', 'bar', 'point']) {
    const r = rows.find((x) => x.name.trim() === k)
    console.log(
      `  ${k.padEnd(14)} instr ${String(r?.instrCycles ?? '-').padStart(7)}  func ${String(r?.funcCycles ?? '-').padStart(7)}${r?.loops ? '  (loops)' : ''}`,
    )
  }

  if (argv.includes('--write')) {
    const out = [
      '// GENERATED by src/cli/gencycles.ts from the AMOS Pro 2.00 assembler sources — do not edit.',
      '// 68000 cycles for the routine behind each core token, on an uncontended bus.',
      '',
      'export interface TokenCycles {',
      '  /** cycles for the instruction form, null when the token has none */',
      '  instr: number | null',
      '  /** cycles for the function form */',
      '  func: number | null',
      '  /** the routine loops over its data, so the figure is a floor */',
      '  loops: boolean',
      '}',
      '',
      '/** Keyed by token id: the byte offset of the entry in the library token table. */',
      'export const TOKEN_CYCLES: Record<number, TokenCycles> = {',
      ...rows.map(
        (r) =>
          `  ${r.id}: { instr: ${r.instrCycles ?? 'null'}, func: ${r.funcCycles ?? 'null'}, loops: ${r.loops} },` +
          (r.name.trim() ? ` // ${r.name.trim()}` : ''),
      ),
      '}',
      '',
    ].join('\n')
    const p = join(import.meta.dirname, '..', 'runtime', 'cycles.gen.ts')
    writeFileSync(p, out)
    console.log(`wrote ${p}`)
  }
}

if (process.argv[1]?.endsWith('gencycles.ts')) main()
