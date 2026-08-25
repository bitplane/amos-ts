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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstCodeHunk } from '../tokens/libtok'
import { routineAddresses } from '../ext/routines'
import { extensionById, REGISTRY } from '../ext/registry'
import { amosVector } from '../ext/amosvectors'
import { disasm } from './m68k'
import { AMOS_CALL_KINDS, AMOS_CALL_LOW, AMOS_CALL_MARKER, AMOS_CALL_SEL_J, AMOS_CALL_SEL_T, AMOS_EXT_LABELS, AMOS_ROUTINES } from '../ext/amoscalls.gen'

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
// the walk itself lives in ../ext/routines.ts so the citation checker and
// this disassembler agree by construction rather than by both getting it right
if (cal.first >= code.length) {
  console.error(`header implies routine 0 at $${cal.first.toString(16)}, past the ${code.length}-byte hunk`)
  process.exit(1)
}

/**
 * The table has an entry per routine, not per keyword, and the extras matter:
 * a keyword's routine is very often a six-byte trampoline — `Rbsr routine
 * 333` — into a shared worker that no token names. Building the whole table
 * (jumpSize/2 entries) is what makes those reachable, via `#333`.
 */
const addr = routineAddresses(code)

/**
 * Decode an AMOS call pseudo-instruction at `off`, if there is one.
 *
 * These are why a plain disassembler gives up mid-routine: they are not 68k
 * opcodes at all but four or six bytes of $FE, kind*16+$01, an optional
 * selector pair, and a routine word. +CEqu.s:39-150 defines them.
 *
 * The SIZE is the whole point. Kinds 0 and 1 always carry a selector and are
 * always six bytes; everything else is four. Reading an `Rjsr` as four bytes
 * puts the decoder two bytes out of step for the rest of the routine, and
 * because the wrong stream still disassembles into plausible instructions,
 * nothing announces it. That was this file's bug, and it is the reason a
 * citation had to be checkable rather than merely present.
 */
function decodeCall(off: number): { text: string; size: number } | null {
  if (code[off] !== AMOS_CALL_MARKER) return null
  const second = code[off + 1] ?? 0
  if ((second & 0x0f) !== AMOS_CALL_LOW) return null
  const form = AMOS_CALL_KINDS[second >> 4]
  if (!form) return null

  const sel = code[off + 2]
  if (sel === AMOS_CALL_SEL_J && form.j) {
    // C_CodeJ: the operand byte selects the LIBRARY. Library 0 is AMOS
    // itself, and the number is an AMOS 1.34 / AMOS Pro 1.0 label —
    // AMOS_EXT_LABELS, not the 2.0 list. See its doc block: the 2.0 list
    // named these for a year and named them wrong.
    const lib = code[off + 3] ?? 0
    const n = view.getUint16(off + 4, false)
    const name = lib === 0 ? (AMOS_EXT_LABELS[n] ?? `routine ${n}`) : `lib${lib} routine ${n}`
    return { text: `${form.j.padEnd(10)} ${name}`, size: 6 }
  }
  if (sel === AMOS_CALL_SEL_T && form.t) {
    // C_CodeT: the operand byte is a register index, and bit 3 marks Rlea
    // (load the address instead of jumping to it)
    const op = code[off + 3] ?? 0
    const n = view.getUint16(off + 4, false)
    const mnem = form.t === 'Rjsrt' && op & 8 ? 'Rlea' : form.t
    const reg = (op & 7) !== 0 ? `, a${op & 7}` : ''
    return { text: `${mnem.padEnd(10)} ${AMOS_ROUTINES[n] ?? `routine ${n}`}${reg}`, size: 6 }
  }
  if (!form.plain) return null

  const n = view.getUint16(off + 2, false)
  // a plain call targets THIS library's own routine table
  return { text: `${form.plain.padEnd(10)} ${routineName(n)}`, size: 4 }
}

/**
 * Runs of printable text embedded in a routine. Extension code keeps its
 * error messages inline, and a disassembler renders them as plausible-looking
 * nonsense — `movea.l ([$6c6c, a2])` is the ASCII "ll". Finding them first is
 * what separates a readable listing from a misleading one.
 */
function textRuns(from: number, to: number): Array<{ at: number; end: number; text: string }> {
  /**
   * Printability alone is not enough: `66 30 24 4e 2c 78` in TURBO's Reserve
   * Object worker is `bne.b` + `movea.l` + `movea.w`, and reads as "f0$N,x".
   * A real message is mostly letters and spaces; opcodes that happen to be
   * printable are mostly punctuation.
   *
   * This test alone is NOT enough either, and believing it cost two wrong
   * readings. `53 46 53 47 3f 46` is `subq.w #$1,d6 / subq.w #$1,d7 /
   * move.w d6,$8(a7)` and reads as "SFSG?F" — six bytes, five of them
   * letters, so 83% and through the filter. It appears in ELEVEN AMCAF
   * routines (92, 95, 225, 226-233) and it is the very instruction that
   * decides whether a region's far corner is inclusive, so hiding it hid the
   * answer. `4c 61 74 4a 40 66` in Ham Best is "LatJ@f" and is
   * `bsr / tst.w d0 / bne`.
   *
   * The caller therefore also requires the run to sit where control cannot
   * FALL IN — after an rts, a bra or a jmp. That is where a real inline
   * string lives, and no reachable instruction can be mistaken for one.
   */
  const looksLikeProse = (s: string): boolean =>
    s.length >= 12 || [...s].filter((c) => /[A-Za-z ]/.test(c)).length >= s.length * 0.75

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
        if (looksLikeProse(text)) runs.push({ at: start, end: i, text })
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
console.log(`jump table at +${cal.at} (delta-encoded words), routine 0 at $${cal.first.toString(16)}, ${addr.length} routines`)

/*
 * A token entry that names a routine the jump table does not have is the one
 * reliable sign that the TOKEN TABLE is malformed, and it is worth shouting
 * about because the symptom looks like the opposite. Range 2.9Plus's `splot`
 * entry is missing its `-1` spec terminator, so the walk runs on through the
 * next entry's `dc.w` pair and its name, and re-syncs one entry late on a
 * fragment whose routine numbers are the ASCII "fl"/"oa" of the swallowed
 * "float planes". This file used to report `maxRoutine + 1` from exactly that
 * fragment, which said "28,514 routines" and read as a jump-table calibration
 * failure — a whole afternoon's worth of chasing the wrong thing. The count
 * above now comes from the jump table itself, which is the only thing that
 * knows it, and the disagreement is reported here instead of hidden there.
 *
 * The advance rule is not ours to choose: `Ver_Ech` (+Verif.s:5231) walks the
 * table with `tst.b (a0)+ / bpl`, so a field ends at the first NEGATIVE byte
 * and a $00 does not terminate anything. See src/tokens/libtok.ts. AMOS on a
 * real Amiga therefore mis-reads this table exactly the way we do, which is
 * why the fragment is kept rather than repaired.
 */
/*
 * "No routine" is written with bit 15 set, and not always the same way: most
 * tables use $FFFF (`dc.w L_Nul`), PowerBobs writes $FFFE in four entries, and
 * AMOSPro.Lib's own table uses $8000 in the instruction slot of nine
 * function-only keywords (Min, Max, Btst, Match, X Menu, ...). None of those
 * is a jump-table index, so the test is the sign bit rather than the range —
 * checking the range alone reported all thirteen as malformed tables.
 */
const noRoutine = (n: number): boolean => (n & 0x8000) !== 0
const strays = ext.tokens.filter((t) => [t.instr, t.func].some((n) => !noRoutine(n) && n >= addr.length))
if (strays.length > 0) {
  console.log(`\n!! ${strays.length} token entr${strays.length === 1 ? 'y names a routine' : 'ies name routines'} the jump table does not have —`)
  console.log('   the token table is malformed, not the jump table:')
  for (const t of strays) {
    console.log(`     id ${t.id} ${JSON.stringify(t.name)} spec ${JSON.stringify(t.spec)} -> ${t.instr}/${t.func}`)
  }
}

/*
 * `--addr` dumps EVERY routine's address, named or not, one per line.
 *
 * `--map` only lists routines a token entry names, which is most of what a
 * reader wants but useless for the other job: checking that the citations in
 * the port still agree with the binary. That job used to be a shell recipe
 * living here, built on this output. It is now `src/cli/citecheck.ts` and
 * `src/ext/citations.test.ts`, which do it across every extension at once and
 * handle what the recipe could not — an address INSIDE the cited routine, a
 * version-qualified citation, and the continuation forms its regex silently
 * skipped.
 *
 * The recipe found twenty-four stale citations across AMCAF in #188. Most
 * were fourteen low on the number — the numbering that predates the
 * jump-table fix in #176 — and one, Limit Smouse, turned out to be pointing
 * at a routine whose behaviour the port had then copied. A wrong citation is
 * not a cosmetic problem: it is how a reading gets attributed to code that
 * never said it.
 */
if (args.includes('--addr')) {
  // `addr.length`, not `maxRoutine` — the latter is the highest routine a
  // TOKEN names, and the shared workers that no keyword names sit above it
  for (let n = 0; n < addr.length; n++) {
    const nm = routineName(n).replace(/^routine \d+ ?/, '')
    console.log(`${n}\t$${(addr[n] ?? 0).toString(16)}\t${nm}`)
  }
}

if (showMap || (!keyword && !args.includes('--addr'))) {
  console.log()
  for (const [name, e] of [...byName].sort((a, b) => (a[1].instr ?? a[1].func ?? 0) - (b[1].instr ?? b[1].func ?? 0))) {
    const parts: string[] = []
    if (e.instr !== undefined) parts.push(`instr ${e.instr} @ $${(addr[e.instr] ?? 0).toString(16)}`)
    if (e.func !== undefined) parts.push(`func ${e.func} @ $${(addr[e.func] ?? 0).toString(16)}`)
    console.log(`  ${name.padEnd(20)} ${parts.join('   ')}`)
  }
}

function disassemble(label: string, n: number): void {
  const start = addr[n]!
  const end = addr[n + 1] ?? code.length
  console.log(`\n=== ${label} (routine ${n}) $${start.toString(16)}..$${end.toString(16)}, ${end - start} bytes ===`)
  {
    // the walk marks each pseudo-instruction as `.amoscall <size>` and
    // steps over it; naming it is all that is left to do here
    const raw = disasm(code, 0, start, end, { amosCalls: true })
    if (raw === null) {
      console.log('  (python3 + capstone not available — address range printed above)')
    } else {
      const runs = textRuns(start, end)
      const lines: string[] = []
      let skipUntil = -1
      /**
       * Whether control can fall into the next address. A text run is only
       * believed where it cannot — see `textRuns` for the two readings that
       * believing the character test alone got wrong.
       *
       * The routine's first instruction is entered, so this starts false. A
       * genuine inline string usually begins ON the `rts` that precedes it
       * (`4e 75` is "Nu", which is why so many of them read as "NuWork    "),
       * and that falls out here for free: the rts is emitted as an
       * instruction, sets the flag, and the run is taken from the address
       * after it.
       */
      const BREAKS = /^(rts|rte|rtr|bra|jmp)(\.[bwl])?$/
      let unreachable = false
      /**
       * `movea.l -$4(a5),a0 / jsr $c4(a0)` is AMOS's SyCall/EcCall/WiCall
       * macro written out by hand — see src/ext/amosvectors.ts. The two are
       * always adjacent, because that is how the macro expands, so carrying
       * the slot exactly one line is both sufficient and safe: nothing else
       * can have overwritten a0 in between.
       */
      let a5slot: number | null = null
      const annotate = (text: string): string => {
        const call = /\bjsr\s+(?:\$([0-9a-f]+))?\(a0\)/.exec(text)
        const named = call && a5slot !== null ? amosVector(a5slot, parseInt(call[1] ?? '0', 16)) : null
        const load = /\bmovea?\.l\s+-\$([0-9a-f]+)\(a5\),\s*a0/.exec(text)
        a5slot = load ? parseInt(load[1]!, 16) : null
        return named ? `${text.trimEnd()}   ${named}` : text
      }
      for (const line of raw) {
        const m = /^\s*([0-9a-f]+)\s+(\S+)/.exec(line)
        const at = m ? parseInt(m[1]!, 16) : -1
        if (at >= 0 && at < skipUntil) continue
        const run = unreachable ? runs.find((r) => at >= r.at && at < r.end) : undefined
        if (run) {
          const text = run.text.slice(at - run.at)
          lines.push(`  ${at.toString(16).padStart(7, '0')}  dc.b       ${JSON.stringify(text)}`)
          skipUntil = run.end
          continue
        }
        const call = at >= 0 ? decodeCall(at) : null
        if (call) {
          lines.push(`  ${at.toString(16).padStart(7, '0')}  ${call.text}`)
          a5slot = null
          skipUntil = at + call.size
          unreachable = /^R(bra|jmp)\b/.test(call.text)
        } else {
          lines.push(annotate(line))
          unreachable = BREAKS.test(m ? m[2]! : '')
        }
      }
      console.log(lines.join('\n'))
    }
  }
}

if (keyword) {
  // "#333" dumps a routine the token table does not name — the shared worker
  // behind a trampoline
  const byNumber = /^#(\d+)$/.exec(keyword)
  if (byNumber) {
    const n = Number(byNumber[1])
    if (n >= addr.length) {
      console.error(`\n${id} has ${addr.length} routines; ${n} is out of range`)
      process.exit(1)
    }
    disassemble(routineName(n), n)
  } else {
    const e = byName.get(keyword.toLowerCase())
    if (!e) {
      console.error(`\n${id} has no keyword "${keyword}"`)
      process.exit(1)
    }
    if (e.instr !== undefined) disassemble(`${keyword} (instruction)`, e.instr)
    if (e.func !== undefined) disassemble(`${keyword} (function)`, e.func)
  }
}
