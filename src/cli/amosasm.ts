/**
 * Read the shipped AMOS Professional assembler sources into something a cost
 * model can walk: one entry per instruction, a label index, and the routine
 * number of every `Lib_Par`.
 *
 * Routine numbers are not stored anywhere in the sources. `c/Make_Labels.AMOS`
 * computed them at build time and wrote `+LEqu.s`, which `alib` deletes on the
 * way out, so the archive has the code and not the numbering. That program is
 * itself an AMOS program, so this reproduces its algorithm rather than guessing
 * at one: scan `+ILib.s` from zero and then `+Lib.s`, incrementing on
 * `Lib_Def`, `Lib_Ext`, `Lib_Par`, `Lib_Int` and `Lib_Empty` in that hunt
 * order, and resetting the counter on `Lib_Pos` or `Lib_Ini`.
 *
 * Two independent checks say the result is right. The shipped `AMOSPro.Lib`
 * header declares its jump table as 3,082 bytes of `dc.w`, so 1,541 routines,
 * and the scan ends on 1,541. And `gentable.ts` already read every token's
 * routine number out of that binary: of the 797 token slots whose label this
 * resolves, 797 agree and none differ.
 */
import { readFileSync } from 'node:fs'

/** Where the sources live. The corpus copy under `AMOSPro Sources/` is a second
 * copy that runs 24 to 29 lines adrift, so citations must name this one. */
export const AMOS_SRC =
  '/home/gaz/src/tmp/amos/amos-files/sources/aminet-dev-amos/files/AMOSProfessional/AMOSProfessional'

/** Assembled in this order: `+Lib.s` includes `+ILib.s` at its line 1710, and
 * has no routine definer before that, so the counter runs ILib then Lib. */
export const SOURCES = ['+ILib.s', '+Lib.s', '+W.s', '+B.s'] as const

export interface Line {
  file: string
  /** 1-based, for citations */
  line: number
  /** the label in column 0, '' when there is none; local labels keep their dot */
  label: string
  /** lower-cased mnemonic with the size suffix stripped */
  mnem: string
  size: 'b' | 'w' | 'l'
  /** operands, split on top-level commas */
  ops: string[]
  raw: string
}

export interface Routine {
  num: number
  name: string
  file: string
  line: number
  /** index into the file's Line[] */
  at: number
}

export interface Sources {
  lines: Map<string, Line[]>
  /** `L_InBob` -> routine */
  byName: Map<string, Routine>
  /** routine number -> routine */
  byNum: Map<number, Routine>
  /** the counter's final value, which must equal the library's declared 1541 */
  slots: number
}

/**
 * Strip comments. The sources use three forms, and the third is the one that
 * bites: `;` to end of line, `*` in column 0, and a bare trailing comment with
 * no marker at all (`cmp.w #_TkVar,(a6)   Saute la variable`). Operands
 * therefore end at the first whitespace after the operand field.
 */
function stripComment(s: string): string {
  const semi = s.indexOf(';')
  return semi >= 0 ? s.slice(0, semi) : s
}

/** Split operands on commas that are not inside a string or parentheses. */
function splitOps(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (const c of s) {
    if (c === '"') quote = !quote
    else if (!quote && c === '(') depth++
    else if (!quote && c === ')') depth--
    if (c === ',' && depth === 0 && !quote) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function parseLine(file: string, n: number, raw: string): Line | null {
  if (raw.startsWith('*') || raw.startsWith(';')) return null
  const body = stripComment(raw)
  if (body.trim() === '') return null

  let label = ''
  let rest = body
  const lead = /^([A-Za-z_.][A-Za-z0-9_.]*):?/.exec(body)
  if (lead && !/^\s/.test(body)) {
    label = lead[1]!
    rest = body.slice(lead[0].length)
  }
  const m = /^\s+([A-Za-z_][A-Za-z0-9_]*)(\.[bwlBWL])?(?:\s+(\S+))?/.exec(rest)
  if (!m) return label ? { file, line: n, label, mnem: '', size: 'w', ops: [], raw } : null
  const size = (m[2]?.slice(1).toLowerCase() ?? 'w') as 'b' | 'w' | 'l'
  return {
    file,
    line: n,
    label,
    mnem: m[1]!.toLowerCase(),
    size,
    ops: splitOps(m[3] ?? ''),
    raw,
  }
}

/** The definers, in the hunt order `Make_Labels.AMOS` uses. */
const DEFINERS = ['Lib_Def', 'Lib_Ext', 'Lib_Par', 'Lib_Int']

export function loadSources(root = AMOS_SRC): Sources {
  const lines = new Map<string, Line[]>()
  const raws = new Map<string, string[]>()
  for (const f of SOURCES) {
    const text = readFileSync(`${root}/${f}`, 'latin1').replace(/\0/g, '')
    const rs = text.split('\n')
    raws.set(f, rs)
    const parsed: Line[] = []
    for (let i = 0; i < rs.length; i++) {
      const l = parseLine(f, i + 1, rs[i]!)
      if (l) parsed.push(l)
    }
    lines.set(f, parsed)
  }

  const byName = new Map<string, Routine>()
  const byNum = new Map<number, Routine>()
  let lab = 0
  let slots = 0
  for (const f of ['+ILib.s', '+Lib.s']) {
    const rs = raws.get(f)!
    const parsed = lines.get(f)!
    for (let i = 0; i < rs.length; i++) {
      const l = rs[i]!
      if (!l.includes('Lib_')) continue
      const setAt = l.indexOf('Lib_Pos') >= 0 ? l.indexOf('Lib_Pos') : l.indexOf('Lib_Ini')
      if (setAt >= 0) {
        lab = Number(argAfter(l, setAt)) || 0
        continue
      }
      let at = -1
      for (const k of DEFINERS) {
        at = l.indexOf(k)
        if (at >= 0) break
      }
      if (at < 0) {
        if (l.includes('Lib_Empty')) {
          lab++
          slots++
        }
        continue
      }
      const name = argAfter(l, at)
      if (name) {
        // the routine's code starts at the first parsed line after the definer
        const idx = parsed.findIndex((p) => p.line > i + 1)
        const r: Routine = { num: lab, name: `L_${name}`, file: f, line: i + 1, at: idx }
        byName.set(r.name, r)
        if (!byNum.has(lab)) byNum.set(lab, r)
      }
      lab++
      slots++
    }
  }
  void slots
  return { lines, byName, byNum, slots: lab }
}

/** The word after a keyword, the way the generator's three Peek$ loops take it. */
function argAfter(line: string, at: number): string {
  let i = at
  while (i < line.length && line[i]! > ' ') i++
  while (i < line.length && line[i]! <= ' ') i++
  let a = ''
  while (i < line.length && line[i]! > ' ') a += line[i++]!
  return a
}
