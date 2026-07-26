/**
 * Locate — and optionally disassemble — the 68k routine behind an extension
 * keyword.
 *
 * Reading the shipped binary is the only evidence available for extensions
 * with neither source nor a manual, and it is better evidence than a manual:
 * LDos's documents a password-length check that only one of its two crypt
 * routines actually has. The difficulty was never the disassembly, it was
 * finding the routine — a 25KB code hunk with no symbols.
 *
 * ## The jump table
 *
 * Solved from AMOS's own source. `+Equ.s:2258` defines the macro every
 * library's jump table is built with:
 *
 *     MC   MACRO
 *          dc.w (L\<LC> - L\<LC0>)/2
 *          ENDM
 *
 * so each word is the distance from the *previous* routine, in words — a
 * delta-encoded table, which is why the entries are small and why searching
 * for absolute addresses finds nothing. Routine N therefore lives at
 * `first + 2 * sum(delta[0..N-1])`, and a token table entry's `instr`/`func`
 * field is N.
 *
 * The table's offset within the code hunk is found by calibration rather than
 * assumed: the correct one is the only one whose prefix sums land routine 0
 * on the first byte of code. Verified on LDos against three routines
 * identified independently by their content (Lcrypt, Lupbuffer, Lchk Data).
 *
 * Disassembly needs python3 with capstone (`CS_ARCH_M68K`). Without it the
 * address map still prints, which is the hard-won part.
 *
 * Run: npm run cli -- src/cli/extdis.ts <extension-id> [keyword] [--map]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstCodeHunk } from '../tokens/libtok'
import { extensionById, REGISTRY } from '../ext/registry'
import { AMOS_CALL_KINDS, AMOS_CALL_LOW, AMOS_CALL_MARKER, AMOS_ROUTINES } from '../ext/amoscalls.gen'

const args = process.argv.slice(2)
const showMap = args.includes('--map')
const [id, keyword] = args.filter((a) => !a.startsWith('--'))
if (!id) {
  console.error('usage: extdis <extension-id> [keyword] [--map]')
  console.error(`known: ${REGISTRY.map((e) => e.id).join(', ')}`)
  process.exit(1)
}

const ext = extensionById(id)
if (!ext) {
  console.error(`unknown extension: ${id}`)
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'fixtures', 'extensions', id)
if (!existsSync(dir)) {
  console.error(`fixtures/extensions/${id} is not present (fixtures/ is gitignored)`)
  process.exit(1)
}
const libFile = readdirSync(dir).find((f) => /\.lib$/i.test(f))
if (!libFile) {
  console.error(`no .Lib in fixtures/extensions/${id}`)
  process.exit(1)
}
const code = firstCodeHunk(new Uint8Array(readFileSync(join(dir, libFile))))
const view = new DataView(code.buffer, code.byteOffset, code.byteLength)
const u16 = (o: number): number => view.getUint16(o, false)

/** the highest routine number any keyword refers to */
let maxRoutine = 0
for (const t of ext.tokens) {
  for (const n of [t.instr, t.func]) if (n !== 0xffff && n > maxRoutine) maxRoutine = n
}

/**
 * The layout is computable from the header rather than guessed. The code
 * hunk opens with two size longs — the jump table's and the token table's —
 * then ten bytes of header, then the jump table, then the token table, and
 * the routines begin immediately after all of it:
 *
 *   [0,8)                       jump size, token size
 *   [8,18)                      header
 *   [18, 18+jumpSize)           delta-encoded jump table
 *   [18+jumpSize, +tokenSize)   token table   (parseAmosLibOld reads it here)
 *   [that, end)                 the routines; routine 0 first
 *
 * Checked on LDos: jump table at +18, routine 0 at $622, which is exactly
 * where the first instruction lives, and routines 62/63/44/67 then land on
 * Lcrypt, Ldecrypt, Lupbuffer and Lchk Data as identified by their content.
 */
const jumpSize = view.getUint32(0, false)
const tokenSize = view.getUint32(4, false)
const cal = { at: 18, first: 18 + jumpSize + tokenSize }
if (cal.first >= code.length) {
  console.error(`header implies routine 0 at $${cal.first.toString(16)}, past the ${code.length}-byte hunk`)
  process.exit(1)
}

const addr: number[] = [cal.first]
for (let i = 0; i < maxRoutine; i++) addr.push(addr[i]! + u16(cal.at + i * 2) * 2)

/**
 * Decode an AMOS call pseudo-instruction at `off`, if there is one.
 *
 * These are why a plain disassembler gives up mid-routine: they are not 68k
 * opcodes at all but four (or six) bytes of $FE, kind*16+$01, an optional
 * library selector, and a routine word. +CEqu.s:39-150 defines them.
 */
function decodeCall(off: number): { text: string; size: number } | null {
  if (code[off] !== AMOS_CALL_MARKER) return null
  const second = code[off + 1] ?? 0
  if ((second & 0x0f) !== AMOS_CALL_LOW) return null
  const form = AMOS_CALL_KINDS[second >> 4]
  if (!form) return null
  const viaLib = code[off + 2] !== undefined && form.viaLib !== undefined && code[off + 2] === 0xff
  if (form.viaLib && !form.plain) {
    const lib = code[off + 3] ?? 0
    const n = view.getUint16(off + 4, false)
    const name = lib === 0 ? (AMOS_ROUTINES[n] ?? `routine ${n}`) : `lib${lib} routine ${n}`
    return { text: `${form.viaLib.padEnd(10)} ${name}`, size: 6 }
  }
  void viaLib
  const n = view.getUint16(off + 2, false)
  // a plain call targets THIS library's own routine table
  const own = routineName(n)
  return { text: `${(form.plain ?? '?').padEnd(10)} ${own}`, size: 4 }
}

/**
 * Runs of printable text embedded in a routine. Extension code keeps its
 * error messages inline, and a disassembler renders them as plausible-looking
 * nonsense — `movea.l ([$6c6c, a2])` is the ASCII "ll". Finding them first is
 * what separates a readable listing from a misleading one.
 */
function textRuns(from: number, to: number): Array<{ at: number; end: number; text: string }> {
  const runs: Array<{ at: number; end: number; text: string }> = []
  let start = -1
  for (let i = from; i <= to; i++) {
    const b = i < to ? (code[i] ?? 0) : 0
    const printable = b >= 0x20 && b < 0x7f
    if (printable && start < 0) start = i
    else if (!printable && start >= 0) {
      if (i - start >= 6) {
        let text = ''
        for (let k = start; k < i; k++) text += String.fromCharCode(code[k]!)
        runs.push({ at: start, end: i, text })
      }
      start = -1
    }
  }
  return runs
}

/** name a routine of this library: its keyword if it has one, else its number */
function routineName(n: number): string {
  for (const t of ext!.tokens) {
    const nm = t.name.trim().replace(/^!/, '')
    if (nm !== '' && (t.instr === n || t.func === n)) return `routine ${n} (${nm})`
  }
  return `routine ${n}`
}

/** keyword name -> routine numbers */
const byName = new Map<string, { instr?: number; func?: number }>()
for (const t of ext.tokens) {
  const n = t.name.trim().replace(/^!/, '').toLowerCase()
  if (n === '') continue
  const e = byName.get(n) ?? {}
  if (t.instr !== 0xffff) e.instr = t.instr
  if (t.func !== 0xffff) e.func = t.func
  byName.set(n, e)
}

console.log(`${id}: ${libFile}, ${code.length} byte code hunk`)
console.log(`jump table at +${cal.at} (delta-encoded words), routine 0 at $${cal.first.toString(16)}, ${maxRoutine + 1} routines`)

if (showMap || !keyword) {
  console.log()
  for (const [name, e] of [...byName].sort((a, b) => (a[1].instr ?? a[1].func ?? 0) - (b[1].instr ?? b[1].func ?? 0))) {
    const parts: string[] = []
    if (e.instr !== undefined) parts.push(`instr ${e.instr} @ $${(addr[e.instr] ?? 0).toString(16)}`)
    if (e.func !== undefined) parts.push(`func ${e.func} @ $${(addr[e.func] ?? 0).toString(16)}`)
    console.log(`  ${name.padEnd(20)} ${parts.join('   ')}`)
  }
}

if (keyword) {
  const e = byName.get(keyword.toLowerCase())
  if (!e) {
    console.error(`\n${id} has no keyword "${keyword}"`)
    process.exit(1)
  }
  for (const [kind, n] of [
    ['instruction', e.instr],
    ['function', e.func],
  ] as const) {
    if (n === undefined) continue
    const start = addr[n]!
    const end = addr[n + 1] ?? code.length
    console.log(`\n=== ${keyword} (${kind}, routine ${n}) $${start.toString(16)}..$${end.toString(16)}, ${end - start} bytes ===`)
    try {
      // built line by line: a template literal would eat the Python
      // f-strings' braces and dollars
      const py = [
        'import sys',
        'from capstone import *',
        "c = open(sys.argv[1],'rb').read()",
        'md = Cs(CS_ARCH_M68K, CS_MODE_BIG_ENDIAN | CS_MODE_M68K_000)',
        'start, end = int(sys.argv[2]), int(sys.argv[3])',
        'pos = start',
        'while pos < end:',
        '    got = False',
        '    for i in md.disasm(c[pos:end], pos):',
        '        print("  %07x  %-10s %s" % (i.address, i.mnemonic, i.op_str))',
        '        pos = i.address + i.size; got = True',
        '    if not got:',
        '        print("  %07x  .dc.w      $%04x" % (pos, (c[pos] << 8) | c[pos + 1])); pos += 2',
      ].join('\n')
      const tmp = join(process.env.TMPDIR ?? '/tmp', 'extdis-' + String(process.pid) + '.bin')
      writeFileSync(tmp, code)
      const raw = execFileSync('python3', ['-c', py, tmp, String(start), String(end)], { encoding: 'utf8' }).trimEnd()
      // capstone cannot decode the AMOS call pseudo-instructions, so it
      // emits .dc.w for them (and then resyncs badly); rewrite those here
      const runs = textRuns(start, end)
      const lines: string[] = []
      let skipUntil = -1
      for (const line of raw.split('\n')) {
        const m = /^\s*([0-9a-f]+)\s/.exec(line)
        const at = m ? parseInt(m[1]!, 16) : -1
        if (at >= 0 && at < skipUntil) continue
        const run = runs.find((r) => at >= r.at && at < r.end)
        if (run) {
          lines.push(`  ${run.at.toString(16).padStart(7, '0')}  dc.b       ${JSON.stringify(run.text)}`)
          skipUntil = run.end
          continue
        }
        const call = at >= 0 ? decodeCall(at) : null
        if (call) {
          lines.push(`  ${at.toString(16).padStart(7, '0')}  ${call.text}`)
          skipUntil = at + call.size
        } else lines.push(line)
      }
      console.log(lines.join('\n'))
      unlinkSync(tmp)
    } catch {
      console.log('  (python3 + capstone not available — address range printed above)')
    }
  }
}
