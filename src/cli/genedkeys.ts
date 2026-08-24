/**
 * Generate src/editor/keymap.gen.ts — the three tables that decide what a
 * keystroke does in the editor.
 *
 * `.Ed_KFonc` (+Editor_Config.s:283) is the key map, and it is CONFIG: the
 * assembler block below is only the default, and Set Key Shortcut (JFonc 73)
 * rewrites it in place. `FlagFonc` (+Edit.s:3347) and `JFonc` (:3151) are
 * code, one byte and one `bra` per command in the same order.
 *
 * Both byte tables are checked against the shipped binaries before they are
 * written out, because a table this shape is exactly the kind that survives a
 * dropped line looking fine. `.Ed_KFonc` is at $288 of AMOSPro_Editor_Config
 * and `FlagFonc` at $1FC0 of AMOSPro_Editor, byte for byte.
 *
 *   npx tsx src/cli/genedkeys.ts [path-to-AMOS-Professional-Official]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? '../AMOS-Professional-Official'
const config = readFileSync(join(root, '+Editor_Config.s'), 'latin1').split('\n')
const edit = readFileSync(join(root, '+Edit.s'), 'latin1').split('\n')

/** the qualifier masks, +Equ.s:775-778 */
const QUAL: Record<string, number> = { Shf: 0b11, Ctr: 0b1000, Alt: 0b110000, Ami: 0b11000000 }

/** one `dc.b` field: a number, a $hex, a "char" or a sum of qualifier names */
function value(field: string): number {
  let n = 0
  for (const part of field.split('+')) {
    const t = part.trim()
    if (t.startsWith('$')) n += parseInt(t.slice(1), 16)
    else if (t.startsWith('"')) n += t.charCodeAt(1)
    else if (t in QUAL) n += QUAL[t]!
    else n += Number(t)
  }
  return n & 0xff
}

/**
 * `.Ed_KFonc`, to its `$FF,0` terminator.
 *
 * The comment on each line is separated by a tab or a run of spaces, so the
 * fields are whatever comes before the first of those. A single-space comment
 * would be read as data, which is why the byte count is checked below.
 */
function keyTable(): number[] {
  const start = config.findIndex((l) => l.startsWith('.Ed_KFonc'))
  if (start < 0) throw new Error('no .Ed_KFonc in +Editor_Config.s')
  const out: number[] = []
  for (let i = start; i < config.length; i++) {
    const line = config[i]!
    if (line.trim() === '') continue
    const at = line.indexOf('dc.b')
    if (at < 0) throw new Error(`+Editor_Config.s:${i + 1}: not a dc.b, and no terminator yet`)
    const fields = line
      .slice(at + 4)
      .split(/\t| {2,}/)
      .filter((s) => s.trim() !== '')[0]!
    for (const f of fields.split(',')) if (f.trim() !== '') out.push(value(f))
    if (out.length >= 2 && out[out.length - 2] === 0xff && out[out.length - 1] === 0) return out
  }
  throw new Error('.Ed_KFonc has no $FF terminator')
}

/** `FlagFonc`, one `dc.b %xxxxxxxx` per command */
function flagTable(): number[] {
  const start = edit.findIndex((l) => l.startsWith('FlagFonc'))
  if (start < 0) throw new Error('no FlagFonc in +Edit.s')
  const out: number[] = []
  for (let i = start + 1; i < edit.length; i++) {
    const m = /^\s*dc\.b\s+%([01]{8})/.exec(edit[i]!)
    if (m) {
      out.push(parseInt(m[1]!, 2))
      continue
    }
    if (/^\s*(;.*)?$/.test(edit[i]!)) continue
    return out
  }
  throw new Error('FlagFonc runs off the end of +Edit.s')
}

/** `JFonc`, one `bra` per command, with the routine name and its comment */
function jumpTable(): Array<{ routine: string; note: string }> {
  const start = edit.findIndex((l) => l.startsWith('JFonc:'))
  if (start < 0) throw new Error('no JFonc in +Edit.s')
  const out: Array<{ routine: string; note: string }> = []
  for (let i = start; i < edit.length; i++) {
    const line = edit[i]!
    const m = /\bbra\s+(\S+)/.exec(line)
    if (m) {
      const c = /\*\s*(.*?)\s*$/.exec(line)
      out.push({ routine: m[1]!, note: c ? c[1]! : '' })
      continue
    }
    // the `equ` lines that number the hidden-program and user-menu blocks
    if (/^\s*(;.*)?$/.test(line) || /\bequ\b/.test(line)) continue
    return out
  }
  throw new Error('JFonc runs off the end of +Edit.s')
}

const keys = keyTable()
const flags = flagTable()
const jumps = jumpTable()

if (flags.length !== jumps.length) throw new Error(`FlagFonc has ${flags.length}, JFonc has ${jumps.length}`)
if (keys.length !== jumps.length * 3 + 2) throw new Error(`.Ed_KFonc is ${keys.length} bytes for ${jumps.length}`)

/** the check that matters: the assembled bytes are in the shipped files */
function verify(file: string, bytes: number[], where: number): void {
  const bin = readFileSync(join(root, 'AMOS/APSystem', file))
  const at = bin.indexOf(Buffer.from(bytes))
  if (at !== where) throw new Error(`${file}: table at ${at}, expected ${where}`)
}
verify('AMOSPro_Editor_Config', keys, 648)
verify('AMOSPro_Editor', flags, 8128)

const hex = (b: number[]): string => {
  const s = b.map((n) => n.toString(16).padStart(2, '0')).join('')
  const rows: string[] = []
  for (let i = 0; i < s.length; i += 96) rows.push(`  '${s.slice(i, i + 96)}' +`)
  return rows.join('\n').replace(/ \+$/, '')
}

const out = `// GENERATED by src/cli/genedkeys.ts from +Editor_Config.s and +Edit.s — do not edit.
//
// What a keystroke does, in three tables of ${jumps.length} commands each. See
// ./keymap.ts for how they are walked; the shape is not obvious from the bytes.
//
// Copyright (c) 1992 Europress Software
// Copyright (c) 2020 Francois Lionet
// Published under the MIT licence as part of the official AMOS Professional
// source release.
const unhex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g)!, (b) => parseInt(b, 16))

/**
 * \`.Ed_KFonc\` (+Editor_Config.s:283), \$288 of the shipped
 * AMOSPro_Editor_Config: a VARIABLE-length list of two-byte {key, qualifiers}
 * records per command, each list closed by a zero byte, the whole table by
 * \`\$FF,0\`. The assembler default gives every command exactly one record, so
 * the file reads as ${jumps.length} groups of three, but Set Key Shortcut can put more
 * than one key on a command and the walk must not assume otherwise.
 */
export const ED_KFONC: Uint8Array = unhex(
${hex(keys)},
)

/**
 * \`FlagFonc\` (+Edit.s:3347), \$1FC0 of AMOSPro_Editor. One byte per command,
 * read by \`Ed_FCall\` (:2565) before the command runs. Bits, from the
 * assembler's own comment: 0 redraw the buffer, 1 redraw the line, 2 refuse
 * on a closed procedure, 5 allowed in a macro, 6 takes a command line,
 * 7 reachable from the ZAP remote control.
 */
export const FLAG_FONC: Uint8Array = unhex(
${hex(flags)},
)

/**
 * \`JFonc\` (+Edit.s:3151), the routine each command branches to. Index 0 is
 * command 1: \`Ed_FCall\` takes a 0-based number and every comment in the
 * source numbers from 1.
 */
export const ED_ROUTINES: readonly string[] = [
${jumps.map((j) => `  '${j.routine}',${j.note === '' ? '' : ` // ${j.note}`}`).join('\n')}
]
`

writeFileSync('src/editor/keymap.gen.ts', out)
console.log(`src/editor/keymap.gen.ts: ${jumps.length} commands, ${keys.length} key bytes`)
