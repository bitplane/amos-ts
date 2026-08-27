/**
 * Assemble the evidence bundle for auditing ONE core keyword.
 *
 * The audit's question is whether this port's handler does what the original
 * routine does. Answering it needs the original routine, and the point of this
 * tool is that it finds the routine WITHOUT asking the port where it is. The
 * port's own citation is a claim under audit; it cannot also be the index.
 *
 * The chain is three links and every one of them is checkable:
 *
 *   1. `CORE_TOKENS` comes from AMOSPro.Lib itself, so `circle` carrying
 *      `instr: 0x38e` is the shipped binary's own numbering, not a reading.
 *   2. `+lequ.s` maps 910 to `L_InCircle`. Two label files ship in the corpus
 *      and only this one agrees with the binary: `AMOSPro Sources/+lib_Labels.s`
 *      is dated 07-06-1993 and puts `L_InPlot2` at 404, `+lequ.s` is dated
 *      06-06-1996 and puts it at 904, and the binary says `draw to` is 908 and
 *      `circle` 910, which is the 1996 file exactly. Reading the 1993 one gives
 *      a routine 500 short in this region and it will be a real routine, just
 *      not this keyword's.
 *   3. `Lib_Par InCircle` in +Lib.s is where that routine's code starts. The
 *      macro (+Equ.s:2184) emits `L\<Lib_Count>:` and ignores its argument, so
 *      the argument is the author's own name for the routine and nothing
 *      enforces it. It is still the only name in the file, and it resolves all
 *      1,425 labels the token table reaches, 4 of them ambiguously.
 *
 * Run:  npx tsx src/cli/auditctx.ts circle
 *       npx tsx src/cli/auditctx.ts --list          every core keyword, one per line
 *       npx tsx src/cli/auditctx.ts --json circle   the bundle the auditor is given
 */
import ts from 'typescript'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_TOKENS, type TokenDef } from '../tokens/tables.gen'
import { FAITHFUL, NA, STRUCTURAL, noteFor } from '../coverage/status'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The AMOS Pro assembler sources, in the corpus.
 *
 * A worktree sits two levels below the checkout, so `../amos-files` from the
 * repo root misses; the candidates walk up until one hits. Absent, this tool
 * has nothing to say and says so rather than falling back to the port's own
 * citations, which is the one thing it must not do.
 */
function amosSources(): string | null {
  const tail = join('sources', 'aminet-dev-amos', 'files', 'AMOSProfessional', 'AMOSProfessional')
  for (const up of ['..', '../..', '../../..', '../../../..', '../../../../..']) {
    const p = resolve(ROOT, up, 'amos-files', tail)
    if (existsSync(p)) return p
  }
  return null
}

const SRC = amosSources()

/** the two files the Lib_* macros live in, in the order Lib_Count runs */
const ASM = ['+Lib.s', '+ILib.s']

function read(p: string): string[] {
  return readFileSync(p, 'latin1').split('\n')
}

/** routine number -> label, from the 1996 `+lequ.s`. See the header. */
function routineLabels(): Map<number, string> {
  const out = new Map<number, string>()
  if (!SRC) return out
  const p = join(SRC, 'AMOSPro Sources', '+lequ.s')
  if (!existsSync(p)) return out
  for (const ln of read(p)) {
    const m = /^L_([A-Za-z0-9_]+):\s*set\s+(\d+)/.exec(ln)
    if (m?.[1] !== undefined && m[2] !== undefined) out.set(Number(m[2]), m[1])
  }
  return out
}

export interface Routine {
  label: string
  file: string
  /** 1-based, the `Lib_Par` line itself */
  from: number
  /** 1-based, the line before the next Lib_* macro */
  to: number
  code: string
}

/**
 * Every Lib_* macro invocation, keyed by the name its author wrote.
 *
 * A routine runs to the next macro, which is what `Lib_Count` means: the
 * macros are consecutive labels in one table, so the code between two of them
 * belongs to the first. Four names appear twice and both sites are kept, since
 * picking one silently would be the same error this tool exists to avoid.
 */
function macroIndex(): Map<string, Routine[]> {
  const out = new Map<string, Routine[]>()
  if (!SRC) return out
  for (const f of ASM) {
    const p = join(SRC, f)
    if (!existsSync(p)) continue
    const lines = read(p)
    const at: Array<{ name: string; line: number }> = []
    for (let i = 0; i < lines.length; i++) {
      // 58 routines are named with a dot -- `Lib_Def Bnk.GetAdr` at
      // +Lib.s:7888 -- and stopping at the dot indexed it as `Bnk`, so every
      // `Rbsr L_Bnk.GetAdr` came back unresolved
      const m = /^\s*Lib_(?:Par|Def|Int|End|Empty|Cmp)\s+([A-Za-z0-9_.]+)/.exec(lines[i] ?? '')
      if (m?.[1] !== undefined) at.push({ name: m[1], line: i + 1 })
    }
    for (let i = 0; i < at.length; i++) {
      const here = at[i]
      if (here === undefined) continue
      const from = here.line
      const to = i + 1 < at.length ? (at[i + 1]?.line ?? lines.length) - 1 : lines.length
      const r: Routine = {
        label: here.name,
        file: f,
        from,
        to,
        code: lines.slice(from - 1, to).join('\n').replace(/\s+$/, ''),
      }
      const list = out.get(r.label) ?? []
      list.push(r)
      out.set(r.label, list)
    }
  }
  return out
}

const LABELS = routineLabels()
const MACROS = macroIndex()

/** the original code behind one routine number, or why there is none */
export function originalFor(routine: number): Routine | { unresolved: string } {
  if (routine <= 1) return { unresolved: `routine ${routine} is L_Nul — the keyword has no handler on this side` }
  const label = LABELS.get(routine)
  if (label === undefined) return { unresolved: `routine ${routine} is not in +lequ.s` }
  return byLabel(label)
}

function byLabel(label: string): Routine | { unresolved: string } {
  const hits = MACROS.get(label) ?? []
  const only = hits[0]
  if (only === undefined) return { unresolved: `no \`Lib_* ${label}\` in ${ASM.join(' or ')}` }
  if (hits.length > 1) {
    return { unresolved: `\`${label}\` appears ${hits.length} times: ${hits.map((h) => `${h.file}:${h.from}`).join(', ')}` }
  }
  return only
}

/**
 * The routines a routine hands off to.
 *
 * `Rbra L_EllCir` is where `Circle`'s actual drawing lives, and eleven
 * instructions that end in a branch say nothing about the keyword without it.
 * The AMOS macros wrap every inter-routine jump around an `L_` symbol, so the
 * callees are a regex away. There are more of them than the condition set:
 * `Rjsr`, `Rjmp`, `Rjmpt`, `Rjsrt`, `Rlea`, `Ljmp` and `Ljsr` are all at
 * +CEqu.s:35-77 and none of them start `Rb`, which cost eleven routines in
 * the second run alone.
 *
 * One level only, and error handlers are dropped. `L_FonCall` and `L_ScNOp`
 * are on the end of a third of the library and pulling them in every time
 * would bury the routine that was asked for.
 */
const NOT_WORTH_FOLLOWING = new Set(['L_FonCall', 'L_ScNOp', 'L_Nul', 'L_Syntax', 'L_ErrorExt'])

/**
 * Local labels, for the `bsr` that is not an `Rbsr`.
 *
 * `Left$` was reported unauditable because its routine is four instructions
 * ending `bsr RInMid` / `bra RInMid2`, and both are plain labels in the same
 * file rather than `L_` routines, so the `Rbxx` regex could not see them. A
 * routine whose whole body is a call to a local helper is exactly the routine
 * that cannot be judged without the helper.
 */
function localLabels(file: string): Map<string, { from: number; to: number; code: string }> {
  const out = new Map<string, { from: number; to: number; code: string }>()
  if (!SRC) return out
  const p = join(SRC, file)
  if (!existsSync(p)) return out
  const lines = read(p)
  const at: Array<{ name: string; line: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z][A-Za-z0-9_]*)\b/.exec(lines[i] ?? '')
    if (m?.[1] !== undefined && !/^(Lib_|MACRO|ENDM|IFNE|ENDC)/.test(m[1])) at.push({ name: m[1], line: i + 1 })
  }
  for (let i = 0; i < at.length; i++) {
    const here = at[i]
    if (here === undefined || out.has(here.name)) continue
    const to = Math.min(here.line + 40, at[i + 1]?.line ?? lines.length)
    out.set(here.name, { from: here.line, to, code: lines.slice(here.line - 1, to).join('\n').replace(/\s+$/, '') })
  }
  return out
}

const LOCALS = new Map<string, ReturnType<typeof localLabels>>()

/**
 * `EcCall Double` and `WiCall Print` are calls through a vector table, so the
 * name in the source is an equate rather than a label and no branch regex can
 * follow it.
 *
 * Thirteen keywords came back unauditable for exactly this reason. `Double
 * Buffer`'s whole routine is `EcCall Double / Rbne L_EcWiErr`, which says
 * nothing about double buffering without the far end.
 *
 * The macros are at `+Equ.s:632` and `+Equ.s:740`:
 *
 *     EcCall: MACRO
 *             move.l  T_EcVect(a5),a0
 *             jsr     \1*4(a0)
 *
 * So the argument is a slot number, `*4` because each table entry is one
 * `bra`. `+W.s:2464` loads `EcIn` into `T_EcVect` and `+W.s:13234` loads
 * `WiIn` into `T_WiVect`, and both tables are a flat run of `bra` in equate
 * order: 77 entries for the screens, 20 for the windows, 101 for the system.
 *
 * The equates sit directly above their own macro, counting up from zero, so
 * reading backwards from the `MACRO` line to the entry numbered 0 picks up
 * that block and no other. Slot 2 of the screen table is commented out
 * (`*		equ 2`), which is why the walk tolerates comment lines and why the
 * map can have holes.
 */
interface Vector {
  /** equate name to slot */
  slot: Map<string, number>
  /** slot to the label its `bra` names */
  target: string[]
  /** the file the targets live in */
  file: string
}

function equatesAbove(lines: string[], macroLine: number): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = macroLine - 2; i >= 0; i--) {
    const ln = lines[i] ?? ''
    if (ln.trim() === '' || ln.startsWith('*') || ln.startsWith(';')) continue
    // the number may be followed by an uncommented description --
    // `AddFlushRoutine	equ 96		Ajoute une routine flush` -- so anchoring
    // to end of line broke the walk on the system block's very first entry.
    // Requiring whitespace or EOL after the digits still rejects `equ 5*4`.
    const m = /^([A-Za-z][A-Za-z0-9_]*):?\s+equ\s+(\d+)(?:\s|$)/.exec(ln)
    if (m?.[1] === undefined || m[2] === undefined) break
    out.set(m[1], Number(m[2]))
    if (m[2] === '0') break
  }
  return out
}

function braTable(lines: string[], label: string): string[] {
  const at = lines.findIndex((l) => new RegExp(`^${label}:`).test(l))
  if (at < 0) return []
  const out: string[] = []
  for (let i = at; i < lines.length; i++) {
    const m = /\bbra(?:\.[sw])?\s+([A-Za-z][A-Za-z0-9_]*)/.exec(lines[i] ?? '')
    if (m?.[1] === undefined) break
    out.push(m[1])
  }
  return out
}

let VECTORS: Map<string, Vector> | null = null

function vectors(): Map<string, Vector> {
  if (VECTORS !== null) return VECTORS
  VECTORS = new Map()
  if (!SRC) return VECTORS
  const equ = join(SRC, '+Equ.s')
  const w = join(SRC, '+W.s')
  if (!existsSync(equ) || !existsSync(w)) return VECTORS
  const eLines = read(equ)
  const wLines = read(w)
  for (const [macro, table] of [
    ['EcCall', 'EcIn'],
    ['WiCall', 'WiIn'],
    // +Equ.s:366, installed at +W.s:9183. `Freeze` is `SyCall AMALFrz / rts`.
    ['SyCall', 'SyIn'],
  ] as const) {
    const at = eLines.findIndex((l) => new RegExp(`^${macro}:\\s+MACRO`).test(l))
    if (at < 0) continue
    const slot = equatesAbove(eLines, at + 1)
    const target = braTable(wLines, table)
    if (slot.size === 0 || target.length === 0) continue
    VECTORS.set(macro, { slot, target, file: '+W.s' })
  }
  return VECTORS
}

/**
 * The routines reached through `EcCall`/`WiCall` and their `A`/`D`/`2`
 * variants, which differ only in what they preload into `a1` and `d1`.
 */
function vectorCallees(code: string, seen: Set<string>, limit: number): Routine[] {
  const out: Routine[] = []
  const tables = vectors()
  if (tables.size === 0) return out
  for (const m of code.matchAll(/\b(Ec|Wi|Sy)Cal[lAD2]\s+([A-Za-z][A-Za-z0-9_]*)/g)) {
    if (out.length >= limit) break
    const v = tables.get(`${m[1]}Call`)
    const name = m[2]
    if (v === undefined || name === undefined) continue
    const idx = v.slot.get(name)
    if (idx === undefined) continue
    const sym = v.target[idx]
    if (sym === undefined || seen.has(sym)) continue
    if (!LOCALS.has(v.file)) LOCALS.set(v.file, localLabels(v.file))
    const hit = LOCALS.get(v.file)?.get(sym)
    if (!hit) continue
    seen.add(sym)
    out.push({ label: sym, file: v.file, from: hit.from, to: hit.to, code: hit.code })
  }
  return out
}

function callees(code: string, file: string, limit = 4): Routine[] {
  const out: Routine[] = []
  const seen = new Set<string>()
  for (const m of code.matchAll(/\b[RL][a-z]{2,5}\s+(L_[A-Za-z0-9_.]+)/g)) {
    const sym = m[1]
    if (sym === undefined || seen.has(sym) || NOT_WORTH_FOLLOWING.has(sym)) continue
    seen.add(sym)
    const r = byLabel(sym.slice(2))
    if (!('unresolved' in r)) out.push(r)
    if (out.length >= limit) break
  }
  out.push(...vectorCallees(code, seen, limit - out.length))
  if (!LOCALS.has(file)) LOCALS.set(file, localLabels(file))
  const locals = LOCALS.get(file)
  for (const m of code.matchAll(/^\s+(?:bsr|bra|jsr|jmp)(?:\.[sw])?\s+([A-Za-z][A-Za-z0-9_]*)/gm)) {
    const sym = m[1]
    if (sym === undefined || seen.has(sym) || out.length >= limit) continue
    const hit = locals?.get(sym)
    if (!hit) continue
    seen.add(sym)
    out.push({ label: sym, file, from: hit.from, to: hit.to, code: hit.code })
  }
  return out
}

// ---------------------------------------------------------------- the port

const RUNTIME = join(ROOT, 'src', 'runtime')
const INTERP = join(ROOT, 'src', 'interp')

export interface Handler {
  file: string
  from: number
  to: number
  code: string
  /** the `/** *\/` block immediately above, if the handler has one */
  doc: string | null
  /** DEVIATION:/DEFECT: lines inside the handler or its doc block */
  markers: string[]
}

/**
 * Where a keyword's handler is, and how much of the file is it.
 *
 * Handlers are object-literal methods — `circle(it) {` or `'draw to'(it) {` —
 * so the anchor is a line whose indent is 2 to 6 and whose name is the
 * keyword. The body runs to the brace that closes it; the scan skips strings,
 * template literals, regexes-as-strings and comments, because a `{` inside a
 * message string would otherwise swallow the rest of the file.
 */
function findHandler(name: string): Handler | null {
  /**
   * The keyword tables first, then everything else.
   *
   * Scanning in directory order found `plot` in dialog.ts and `ink` in
   * guistate.ts, both of them INTERFACE ROWS — `plot(x: number, y: number):
   * void` — and both alphabetically ahead of instr.ts. The bundle then said
   * "the port" over a type declaration, and the auditor answered, correctly,
   * that it had been given no implementation. Two keywords in the first ten.
   */
  const files: string[] = ['src/runtime/instr.ts', 'src/interp/builtins.ts']
  for (const [dir, abs] of [
    ['runtime', RUNTIME],
    ['interp', INTERP],
  ] as const) {
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) {
      const rel = `src/${dir}/${f}`
      if (f.endsWith('.ts') && !f.endsWith('.test.ts') && !files.includes(rel)) files.push(rel)
    }
  }

  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  /**
   * An AMOS keyword whose name is also a JavaScript keyword is only ever
   * QUOTED in a handler table, so an unquoted match is a `for` or an `if`
   * statement. `if` matched `  if (!isSpeakPath(path)) return {}` in
   * speech.ts's helper and the audit went on to report that AMOS's `If` fails
   * to evaluate a condition, which it does not have a handler for at all.
   */
  const JS_WORDS = new Set([
    'if', 'for', 'while', 'do', 'switch', 'case', 'else', 'try', 'catch',
    'return', 'new', 'delete', 'typeof', 'in', 'of', 'this', 'class', 'function',
    'var', 'let', 'const', 'break', 'continue', 'default', 'void', 'with',
  ])
  /*
   * `For`, `While`, `Do`, `If`, `Else`, `Return` and `Default` are all
   * handlers written in the unquoted shorthand -- `for(it, tok) {` -- so
   * demanding quotes lost all seven and the audit reported them unhandled.
   * They are also JavaScript statements, which is how `if` once matched an
   * `if (` in speech.ts and the auditor spent a run on someone else's code.
   *
   * What separates the two is the parameter list. A handler's first parameter
   * is `it` or nothing; a JS `if (cond)` or `return (x)` opens with an
   * expression, and `else {` has no parenthesis at all.
   */
  const jsWord = JS_WORDS.has(name)
  const re = new RegExp(`^( {2,6})(?:'${esc}'|"${esc}"|${esc})\\s*[(:]`, 'm')
  /*
   * A shorthand method opens its body on the same line and takes nothing but
   * plain parameter names: `for(it, tok) {`, `default() {`. Every JS
   * statement that reached this point failed one half or the other --
   * `if (it.atStmtEnd() || ...)` puts an expression in the brackets, and
   * `return (it) => {` ends in an arrow. Neither test is enough alone, so the
   * first parameter has to be the interpreter handle or absent as well:
   * `if (node) {` in instr.ts passes both other checks and was beating the
   * real `If` handler in builtins.ts on file order.
   */
  const shorthand =
    /^\s*[A-Za-z_$][\w$]*\s*\(\s*(?:\)|_?it\b(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\))\s*\{\s*$/

  for (const rel of files) {
    const path = join(ROOT, rel)
    if (!existsSync(path)) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i] ?? ''
      if (!re.test(ln)) continue
      // an unquoted JS keyword only counts as a handler if it reads like one
      if (jsWord && !/^\s*['"]/.test(ln) && !shorthand.test(ln)) continue
      // `name(args): Type` with no body is a signature in an interface, not a
      // handler; `polyline: polyish(false),` has no `)` before its colon and
      // stays, which is what a handler built by a factory looks like
      if (/\)\s*:\s*[\w<[]/.test(ln) && !/\{\s*$/.test(ln)) continue
      /*
       * A handler written `name: value` is built by a factory, so the value is
       * a CALL or an arrow -- `polyline: polyish(false),`. `end: c.after,` is a
       * field of a loop frame, and matching it made the audit report that
       * AMOS's `End` raises no error while quoting a `varKey` assignment.
       */
      const colon = /^\s*(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*:\s*(.*)$/.exec(ln)
      if (colon !== null && !/^(?:\(|async\b|function\b|[A-Za-z_$][\w$.]*\s*\()/.test(colon[1] ?? '')) continue
      const body = extent(lines, i)
      const doc = docAbove(lines, i)
      const chunk = lines.slice(i, body + 1).join('\n')
      const markers = [doc ?? '', chunk]
        .join('\n')
        .split('\n')
        .filter((l) => /\b(DEVIATION|DEFECT):/.test(l))
        .map((l) => l.trim())
      return { file: rel, from: i + 1, to: body + 1, code: chunk, doc, markers }
    }
  }
  return null
}

/** last line index of the method starting at `start`, by brace balance */
function extent(lines: string[], start: number): number {
  let depth = 0
  let seen = false
  for (let i = start; i < lines.length && i < start + 400; i++) {
    const l = strip(lines[i] ?? '')
    for (const c of l) {
      if (c === '{') {
        depth++
        seen = true
      } else if (c === '}') depth--
    }
    if (seen && depth <= 0) return i
  }
  return Math.min(start + 60, lines.length - 1)
}

/** a line with its string literals and comments blanked, for brace counting */
function strip(l: string): string {
  let out = ''
  let quote = ''
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '/' && l[i + 1] === '/') break
    out += c
  }
  return out
}

/** the doc block or run of line comments directly above a handler */
function docAbove(lines: string[], start: number): string | null {
  let i = start - 1
  while (i >= 0 && (lines[i] ?? '').trim() === '') i--
  if (i < 0) return null
  if ((lines[i] ?? '').trim().endsWith('*/')) {
    let j = i
    while (j >= 0 && !(lines[j] ?? '').includes('/*')) j--
    return j >= 0 ? lines.slice(j, i + 1).join('\n') : null
  }
  if ((lines[i] ?? '').trim().startsWith('//')) {
    let j = i
    while (j >= 0 && (lines[j] ?? '').trim().startsWith('//')) j--
    return lines.slice(j + 1, i + 1).join('\n')
  }
  return null
}

// ---------------------------------------------------------------- port helpers

/**
 * The port functions a handler delegates to.
 *
 * `box` came back unauditable with the note "original adjusts d1 before
 * calling GfxFunc, port does not" — but the port's whole body is
 * `scr().box(x1, y1, x2, y2)`, so the adjustment could only be inside
 * `box`, which was not in the bundle. A one-line handler is a pointer, and
 * auditing the pointer instead of the code answers nothing.
 *
 * Resolution is by name: the first definition found under src/, capped at
 * five. A wrong match costs the auditor a confusing block, which is better
 * than the certain failure of no block, and the name is printed so a wrong
 * one is obvious.
 *
 * `scr` is deliberately NOT skipped. Four of the first ten keywords came back
 * with the same unanswerable question — "the original returns silently when no
 * screen is open, does the port throw?" — and all four turn on `scr()`. One
 * helper answers it everywhere, and leaving it out would have put that
 * question on every drawing keyword in the library.
 */
const SKIP_HELPERS = new Set([
  // the interpreter's own parsing plumbing: present in every handler, and
  // never the thing a keyword's behaviour turns on
  'evalInt', 'evalExpr', 'evalStr', 'expect', 'accept', 'expectOp', 'acceptOp',
  'atStmtEnd', 'parseTarget', 'tok', 'peek', 'next',
  // value constructors and JS built-ins
  'str', 'int', 'num', 'VS', 'VI', 'VF', 'of', 'get', 'set', 'has', 'add',
  'push', 'pop', 'map', 'filter', 'slice', 'join', 'split', 'test', 'exec',
  'toString', 'Error', 'AmosError', 'Number', 'String', 'Math', 'Set', 'Map',
  'console', 'log', 'warn', 'if', 'for', 'while', 'return', 'throw', 'catch',
  'switch',
])
/**
 * The port functions a handler delegates to, resolved by the type checker.
 *
 * `box`'s handler is `scr().box(x1, y1, x2, y2)` and the adjustment the
 * original makes could only be inside `Screen.box`, so auditing the handler
 * alone answered nothing.
 *
 * Three name-matching heuristics were tried first and all three put the wrong
 * body in the bundle: file order resolved `box` to amcaf.ts, preferring the
 * calling file resolved `s.ellipse` to the `ellipse` KEYWORD HANDLER two
 * entries down instr.ts, and scoring by shared names tied and fell back to
 * file order again. A wrong body is worse than no body, because the auditor
 * reads it as evidence and reports on the wrong keyword's code.
 *
 * `scr().box` has exactly one correct answer and the compiler knows it, so ask
 * the compiler. Building the program costs a few seconds once, against 620
 * keywords.
 */
interface Helper {
  name: string
  file: string
  from: number
  code: string
}

let PROGRAM: ts.Program | null = null
let CHECKER: ts.TypeChecker | null = null

function program(): ts.Program | null {
  if (PROGRAM !== null) return PROGRAM
  const cfgPath = join(ROOT, 'tsconfig.json')
  if (!existsSync(cfgPath)) return null
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, ROOT)
  PROGRAM = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
  CHECKER = PROGRAM.getTypeChecker()
  return PROGRAM
}

/** the declaration a call expression actually reaches, or null */
function declarationOf(call: ts.CallExpression, checker: ts.TypeChecker): ts.Node | null {
  const sig = checker.getResolvedSignature(call)
  if (sig?.declaration !== undefined) return sig.declaration
  // an arrow assigned to a const has no signature declaration of its own
  const sym = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression,
  )
  const d = sym?.declarations?.[0]
  return d ?? null
}

function calleeName(call: ts.CallExpression): string {
  const e = call.expression
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  if (ts.isIdentifier(e)) return e.text
  return e.getText().slice(0, 40)
}

function portHelpers(h: Handler, depth = 2): Helper[] {
  const prog = program()
  const checker = CHECKER
  if (prog === null || checker === null) return []

  const abs = join(ROOT, h.file)
  const src = prog.getSourceFile(abs)
  if (src === undefined) return []

  const out: Helper[] = []
  const seen = new Set<string>()
  const cap = 8

  /** the node's own source text, trimmed to something a reader can hold */
  const emit = (name: string, decl: ts.Node): void => {
    const file = decl.getSourceFile()
    const rel = file.fileName.startsWith(ROOT) ? file.fileName.slice(ROOT.length + 1) : file.fileName
    // a declaration in node_modules or a .d.ts is a type, not this port's code
    if (rel.includes('node_modules') || file.fileName.endsWith('.d.ts')) return
    const from = file.getLineAndCharacterOfPosition(decl.getStart()).line + 1
    const to = file.getLineAndCharacterOfPosition(decl.getEnd()).line + 1
    if (to - from > 80) return
    // the handler under audit is not a helper for itself
    if (rel === h.file && from >= h.from && from <= h.to) return
    out.push({ name, file: rel, from, code: decl.getText() })
  }

  const scan = (node: ts.Node, within: { from: number; to: number } | null): ts.Node[] => {
    const found: ts.Node[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const f = n.getSourceFile()
        const line = f.getLineAndCharacterOfPosition(n.getStart()).line + 1
        if (within === null || (line >= within.from && line <= within.to)) {
          const name = calleeName(n)
          if (!seen.has(name) && !SKIP_HELPERS.has(name)) {
            seen.add(name)
            const d = declarationOf(n, checker)
            if (d !== null) {
              const before = out.length
              emit(name, d)
              if (out.length > before) found.push(d)
            }
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(node)
    return found
  }

  let frontier = scan(src, { from: h.from, to: h.to })
  for (let round = 1; round < depth && out.length < cap; round++) {
    const next: ts.Node[] = []
    for (const d of frontier) {
      if (out.length >= cap) break
      next.push(...scan(d, null))
    }
    if (next.length === 0) break
    frontier = next
  }
  return out.slice(0, cap)
}

// ---------------------------------------------------------------- tests

/**
 * Test files that RUN the keyword, with the lines that do.
 *
 * Matching the bare word finds prose: `circle` picked up four files whose only
 * mention was a sentence about a circle, and one of them was a citation test
 * for AMCAF. A test that runs a keyword writes it inside a string, because
 * that is what an AMOS program is here, so the match is anchored to a quote.
 *
 * Anchoring to the quote alone is still not enough. AMCAF's `Fast Circle` and
 * AMON's both contain ` Circle` inside a perfectly good string, so the keyword
 * has to be at the START of a statement: the head of the string, or after the
 * `:` that separates two AMOS statements. `Fast Circle` then fails because
 * `Fast ` is in front of it, which is the whole point.
 *
 * The statement-start test runs INSIDE the string literals only. Allowing a
 * bare `:` anywhere on the line matched the TypeScript annotation `b: Box` and
 * offered two requester tests as evidence about `Box`.
 */
function testsFor(name: string): Array<{ file: string; lines: string[] }> {
  const out: Array<{ file: string; lines: string[] }> = []
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inside = new RegExp(`(?:^|:)\\s*${esc}\\b`, 'i')
  const re = {
    test(line: string): boolean {
      for (const m of line.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
        const s = m[1] ?? m[2] ?? m[3] ?? ''
        for (const stmt of s.split('\\n')) if (inside.test(stmt)) return true
      }
      return false
    },
  }
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.test.ts')) {
        const hits = readFileSync(p, 'utf8')
          .split('\n')
          .map((l, n) => ({ l, n: n + 1 }))
          .filter(({ l }) => re.test(l))
        if (hits.length > 0) {
          out.push({ file: p.slice(ROOT.length + 1), lines: hits.slice(0, 12).map(({ l, n }) => `${n}: ${l.trim()}`) })
        }
      }
    }
  }
  walk(join(ROOT, 'src'))
  return out.slice(0, 4)
}

// ---------------------------------------------------------------- bundle

export interface Form {
  /** the argument spec the shipped token table gives, verbatim */
  spec: string
  instr: number
  func: number
}

export interface Bundle {
  keyword: string
  /**
   * Every form the keyword has, first entry first.
   *
   * A keyword is not one entry. `Plot` is `I0,0` terminated $FE and then a
   * NAMELESS entry `I0,0,0` behind it, and `Cls` has three forms the same way;
   * the Test pass walks that chain (`VerC` +Verif.s:3120) and so must this.
   * Reporting only the first cost two false defects in the first ten keywords
   * audited — `plot` and `cls` were both accused of accepting arguments the
   * original does not take, when the original takes them in a later form.
   */
  forms: Form[]
  /** the first form's spec, kept for the one-line header */
  spec: string
  classification: 'faithful' | 'approximated' | 'n/a' | 'structural'
  note: string | null
  instrRoutine: number
  funcRoutine: number
  original: Array<{ side: 'instruction' | 'function'; routine: number } & (Routine | { unresolved: string })>
  /** routines the originals branch into, one level deep */
  alsoReads: Routine[]
  handler: Handler | null
  /** the port functions the handler delegates to */
  helpers: Array<{ name: string; file: string; from: number; code: string }>
  tests: Array<{ file: string; lines: string[] }>
}

export function coreKeywords(): TokenDef[] {
  const seen = new Set<string>()
  return CORE_TOKENS.filter((t) => {
    const n = t.name.replace(/^!/, '').trim().toLowerCase()
    if (n === '' || seen.has(n)) return false
    seen.add(n)
    return true
  })
}

export function bundleFor(name: string): Bundle | null {
  const key = name.trim().toLowerCase()
  const i = CORE_TOKENS.findIndex((t) => t.name.replace(/^!/, '').trim().toLowerCase() === key)
  const tok = CORE_TOKENS[i]
  if (tok === undefined) return null

  // the named entry, then every nameless one behind it while the previous
  // entry said $FE — that chain is the keyword's other argument counts
  const forms: Form[] = [{ spec: tok.spec, instr: tok.instr, func: tok.func }]
  for (let j = i; CORE_TOKENS[j]?.end === 0xfe; j++) {
    const v = CORE_TOKENS[j + 1]
    if (v === undefined || v.name !== '') break
    forms.push({ spec: v.spec, instr: v.instr, func: v.func })
  }

  const original: Bundle['original'] = []
  const seenRoutine = new Set<number>()
  for (const f of forms) {
    for (const [side, routine] of [
      ['instruction', f.instr],
      ['function', f.func],
    ] as const) {
      if (routine <= 1 || seenRoutine.has(routine)) continue
      seenRoutine.add(routine)
      original.push({ side, routine, ...originalFor(routine) })
    }
  }

  const seen = new Set(original.filter((o) => 'label' in o).map((o) => (o as Routine).label))
  const alsoReads: Routine[] = []
  for (const o of original) {
    if (!('code' in o)) continue
    for (const r of callees(o.code, o.file)) {
      if (seen.has(r.label)) continue
      seen.add(r.label)
      alsoReads.push(r)
    }
  }

  const handler = findHandler(key)
  return {
    keyword: key,
    forms,
    spec: tok.spec,
    classification: STRUCTURAL.has(key)
      ? 'structural'
      : NA.has(key)
        ? 'n/a'
        : FAITHFUL.has(key)
          ? 'faithful'
          : 'approximated',
    note: noteFor(key) ?? null,
    instrRoutine: tok.instr,
    funcRoutine: tok.func,
    original,
    alsoReads,
    handler,
    helpers: handler ? portHelpers(handler) : [],
    tests: testsFor(key),
  }
}

// ---------------------------------------------------------------- cli

/**
 * `kwaudit.ts` imports `bundleFor`, so the CLI below must not run on import.
 * Without this guard it printed its usage line and exited 1 the moment the
 * runner loaded it.
 */
const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('auditctx.ts')

if (invokedDirectly) main()

function main(): void {
const args = process.argv.slice(2)

/**
 * How complete are the bundles?
 *
 * `plot` and `ink` were audited twice against an interface row in dialog.ts
 * because nothing checked that the handler found was a handler. A silent
 * resolution failure produces a confident verdict about the wrong code, so the
 * numbers are worth printing before a run of six hundred.
 */
if (args[0] === '--health') {
  const kws = coreKeywords()
  let noHandler = 0
  let noOriginal = 0
  let both = 0
  const files = new Map<string, number>()
  const missing: string[] = []
  for (const t of kws) {
    const b = bundleFor(t.name.replace(/^!/, '').trim().toLowerCase())
    if (!b) continue
    const hasO = b.original.some((o) => 'code' in o)
    if (b.handler === null) {
      noHandler++
      if (missing.length < 30) missing.push(b.keyword)
    } else files.set(b.handler.file, (files.get(b.handler.file) ?? 0) + 1)
    if (!hasO) noOriginal++
    if (b.handler !== null && hasO) both++
  }
  console.log(`${kws.length} core keywords`)
  console.log(`  ${both} have both a handler and original code`)
  console.log(`  ${noHandler} have no handler found`)
  console.log(`  ${noOriginal} have no original resolved`)
  console.log('\nhandlers by file:')
  for (const [f, n] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n.toString().padStart(4)}  ${f}`)
  console.log(`\nno handler: ${missing.join(', ')}`)
  process.exit(0)
}

if (args[0] === '--list') {
  for (const t of coreKeywords()) console.log(t.name.replace(/^!/, '').trim().toLowerCase())
  process.exit(0)
}

const json = args[0] === '--json'
const want = (json ? args[1] : args[0]) ?? ''
if (want === '') {
  console.error('usage: auditctx [--json] <keyword>   |   auditctx --list')
  if (!SRC) console.error('note: the AMOS sources were not found; set the corpus up at ../amos-files')
  process.exit(1)
}

const b = bundleFor(want)
if (!b) {
  console.error(`\`${want}\` is not a core keyword in the shipped token table`)
  process.exit(1)
}

if (json) {
  console.log(JSON.stringify(b, null, 2))
} else {
  console.log(`# ${b.keyword}   [${b.classification}]`)
  for (const f of b.forms) console.log(`form: spec ${JSON.stringify(f.spec)}  instr ${f.instr}  func ${f.func}`)
  console.log('')
  if (b.note) console.log(`## status.ts note\n${b.note}\n`)
  for (const o of b.original) {
    if ('unresolved' in o) {
      console.log(`## original (${o.side}, routine ${o.routine}) — UNRESOLVED: ${o.unresolved}\n`)
    } else {
      console.log(`## original (${o.side}, routine ${o.routine}) — ${o.label}, ${o.file}:${o.from}-${o.to}`)
      console.log('```\n' + o.code + '\n```\n')
    }
  }
  for (const r of b.alsoReads) {
    console.log(`## also reads — ${r.label}, ${r.file}:${r.from}-${r.to}`)
    console.log('```\n' + r.code + '\n```\n')
  }
  if (b.handler) {
    console.log(`## port — ${b.handler.file}:${b.handler.from}-${b.handler.to}`)
    if (b.handler.doc) console.log('```\n' + b.handler.doc + '\n```')
    console.log('```\n' + b.handler.code + '\n```\n')
    if (b.handler.markers.length > 0) console.log(`markers: ${b.handler.markers.join(' | ')}\n`)
    for (const hp of b.helpers) {
      console.log(`## the port calls ${hp.name} — ${hp.file}:${hp.from}`)
      console.log('```\n' + hp.code + '\n```\n')
    }
  } else {
    console.log('## port — NO HANDLER FOUND\n')
  }
  for (const t of b.tests) console.log(`## test ${t.file}\n${t.lines.join('\n')}\n`)
}
}
