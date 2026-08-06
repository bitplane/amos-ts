/**
 * Locate — and disassemble — the routine behind an AMOS 3D `Td` keyword.
 *
 * AMOS 3D is the only extension so far whose library is not the extension.
 * `3d.lib` is 4,876 bytes of token table, error strings and trampolines; the
 * engine is `c3d.lib`, "Voodoo AMOS-3D extension I 1.00 (c)1991", which the
 * stub loads at run time from `":amos_system/c3d.lib"`. So `extdis` finds the
 * keyword and stops at a `jmp`, and getting further needs the whole path.
 *
 * ## The path
 *
 * Every keyword in `3d.lib` is the same sixteen bytes:
 *
 *     move.w  #$fe3e, d0        ; a signed offset, see below
 *     move.w  #$28, d1          ; a byte offset into the engine's table
 *     movea.l $128(a5), a2      ; a2 = a fixed struct at $986 in 3d.lib
 *     jmp     -$228(a2)         ; the dispatcher at $75e
 *
 * `$128(a5)` is set by the extension's init (routine 0, `lea $986(pc),a2 :
 * move.l a2,$128(a5)`) and points into `3d.lib` itself, not into the engine —
 * which is why the dispatcher is readable without loading anything.
 *
 * The dispatcher loads the engine on first use, points a1 at a private stack
 * it AllocMem'd at init, and does `jmp (a2,d0.w)`. So **d0 is a signed offset
 * from $986 to an argument-marshalling stub**: a run of `move.l (a3)+,-(a1)`
 * that moves N arguments off AMOS's stack onto the engine's, with a longer
 * form for strings (`movea.l (a3)+,a0 : move.w (a0)+,d3 : ext.l d3` — pointer
 * and length pushed separately). Entering the run partway through is how one
 * block of pushes serves every arity. Counting the pushes from the entry
 * point therefore recovers the calling signature.
 *
 * They all fall into the tail at $7cc, which switches to the private stack
 * and does `movea.l $8(a2),a0 : movea.l (a0,d1.w),a0 : jsr (a0)`. `$8(a2)` is
 * the loaded engine's base, so **d1 is a byte offset into a table of 32-bit
 * function pointers at the front of the engine**.
 *
 * The engine is a C program built small-data — the dispatcher sets a4 from
 * `$18(a2)` before every call — which is why it is 29 hunks and why nothing
 * in it can be read until ./loader/hunk has relocated it.
 *
 * Run: npm run cli -- src/cli/tddis.ts [keyword|#index] [--table]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstCodeHunk } from '../tokens/libtok'
import { extensionById } from '../ext/registry'
import { hunkAt, loadHunks, readPtr } from '../amiga/hunk'
import { disasm } from './m68k'

const args = process.argv.slice(2)
const showTable = args.includes('--table')
const keyword = args.filter((a) => !a.startsWith('--'))[0]

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'fixtures', 'extensions', 'amos3d-1.0')
const stubPath = join(dir, '3d.lib')
const enginePath = join(dir, 'engine', 'c3d.lib')
for (const p of [stubPath, enginePath]) {
  if (!existsSync(p)) {
    console.error(`missing ${p} (fixtures/ is gitignored)`)
    process.exit(1)
  }
}

const ext = extensionById('amos3d-1.0')!
const stub = firstCodeHunk(new Uint8Array(readFileSync(stubPath)))
const sv = new DataView(stub.buffer, stub.byteOffset, stub.byteLength)
const engine = loadHunks(new Uint8Array(readFileSync(enginePath)))

/** the struct routine 0 puts in $128(a5), at $986 in the stub's code hunk */
const STRUCT = 0x986

/**
 * Where the engine's function-pointer table lives, as an offset into hunk 0.
 *
 * The stub's loader (at $828) LoadSeg()s c3d.lib, turns the BPTR into an
 * address, and calls the engine's init at `hunk0+2` with the two callback
 * tables in a0/a1 and DOSBase/GfxBase in d0/d1. Init clears its BSS, stashes
 * those bases, and finishes `lea $d0(pc),a0 : movea.l a4,a1 : rts` — so the
 * table it hands back is a fixed offset into its own first hunk, and a1 is
 * the small-data base the dispatcher then keeps in a4.
 */
const TABLE_OFFSET = 0xd0

/**
 * Rebuild the stub's delta-encoded jump table, exactly as extdis does: a
 * header of jumpSize and tokenSize longs, the table of deltas at +18, and
 * routine 0 immediately after the token table.
 */
function stubRoutines(): number[] {
  const jumpSize = sv.getUint32(0, false)
  const tokenSize = sv.getUint32(4, false)
  const addr = [18 + jumpSize + tokenSize]
  for (let i = 0; i + 1 < jumpSize / 2; i++) addr.push(addr[i]! + sv.getUint16(18 + i * 2, false) * 2)
  return addr
}

/** read the `move.w #x,d0 : move.w #y,d1` pair out of a sixteen-byte trampoline */
function trampoline(start: number, end: number): { d0: number; d1: number; d2: number | null } | null {
  if (start < 0 || end <= start) return null
  // Most keywords are the selector pair and nothing else, but a few do work
  // first — Td Redraw checks the screen is open, Td Cls likewise — so scan a
  // short way in for `move.w #x,d0 : move.w #y,d1` rather than demanding it
  // at the very start.
  let at = -1
  for (let i = start; i < end && i + 8 <= stub.length; i += 2) {
    if (sv.getUint16(i, false) === 0x303c && sv.getUint16(i + 4, false) === 0x323c) {
      at = i
      break
    }
  }
  if (at < 0) return null
  // The eighteen-byte shape adds `moveq #k,d2` and enters the dispatcher two
  // bytes in, past its own `moveq #-1,d2` — so k becomes a leading argument.
  // That is how Td Move X/Y/Z share one engine routine with an axis selector,
  // and likewise Angle A/B/C, Attitude A/B/C and Position X/Y/Z.
  const op = sv.getUint16(at + 8, false)
  const d2 = (op & 0xff00) === 0x7400 ? op & 0xff : null
  return { d0: (sv.getUint16(at + 2, false) << 16) >> 16, d1: sv.getUint16(at + 6, false), d2 }
}

/**
 * Walk the marshalling stub at `$986 + d0` and describe what it pushes.
 * `231b` is `move.l (a3)+,-(a1)` (one long argument); the five-instruction
 * run starting `205b` (`movea.l (a3)+,a0`) pushes a string as pointer and
 * length. The stubs share their tails, so entering one partway down is how a
 * single block of pushes serves every arity.
 */
function signature(d0: number): string {
  let at = STRUCT + d0
  const pushed: string[] = []
  for (let guard = 0; guard < 32; guard++) {
    const op = sv.getUint16(at, false)
    if (op === 0x231b) {
      // move.l (a3)+,-(a1)
      pushed.push('long')
      at += 2
    } else if (op === 0x205b) {
      // movea.l (a3)+,a0 : move.w (a0)+,d3 : ext.l d3 : move.l a0,-(a1) :
      // move.l d3,-(a1) — an AMOS string arrives as pointer and length
      pushed.push('string')
      at += 10
    } else if ((op & 0xff00) === 0x6000) {
      // A short bra further down the same block — the stubs overlap, so a
      // string form can still pick up a trailing long by branching into the
      // tail of the plain run. Follow it; the displacement is a signed byte.
      const disp = (op & 0xff) << 24 >> 24
      if (disp === 0) break
      at += 2 + disp
    } else {
      break
    }
  }
  return pushed.length ? pushed.join(', ') : '(none)'
}

/**
 * The engine is an ordinary relocated Amiga library, not an AMOS extension, so
 * it carries no AMOS call pseudo-instructions — `amosCalls` stays off.
 */
function disassemble(from: number, length: number): string {
  const lines = disasm(engine.image, engine.base, from, from + length)
  return lines === null ? '  (disassembly needs python3 with capstone)\n' : lines.join('\n') + '\n'
}

console.log(`amos3d-1.0: 3d.lib stub + engine/c3d.lib`)
console.log(`engine: ${engine.hunks.length} hunks relocated at $${engine.base.toString(16)}, ${engine.image.length} bytes`)

if (showTable) {
  for (const h of engine.hunks) {
    console.log(`  hunk ${String(h.index).padStart(2)} ${h.kind.padEnd(4)} $${h.base.toString(16)} +${h.length}`)
  }
  process.exit(0)
}

const addr = stubRoutines()
const rows: Array<{ name: string; kind: string; d0: number; d1: number; d2: number | null; target: number }> = []
for (const t of ext.tokens) {
  if (!t.name) continue
  for (const [kind, n] of [
    ['instr', t.instr],
    ['func', t.func],
  ] as const) {
    if (n === 0xffff || n === undefined) continue
    // bounded by where the next routine begins: several keywords share a
    // zero-length stub for the half they do not implement, and an unbounded
    // scan would walk out of one routine into the next one's selectors
    const tr = trampoline(addr[n] ?? -1, addr[n + 1] ?? stub.length)
    if (!tr) continue
    rows.push({ name: t.name, kind, d0: tr.d0, d1: tr.d1, d2: tr.d2, target: readPtr(engine, engine.base + TABLE_OFFSET + tr.d1) })
  }
}

if (!keyword) {
  const seen = new Set<string>()
  for (const r of rows) {
    const key = `${r.name}/${r.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(
      `  ${r.name.padEnd(20)} ${r.kind.padEnd(5)} $${r.target.toString(16)}  args(${[r.d2 === null ? null : `sel ${r.d2}`, signature(r.d0)].filter(Boolean).join(', ')})`,
    )
  }
  process.exit(0)
}

// `@<hex>` disassembles a raw image address — used to read the engine's init,
// which the loader calls at hunk0+2 and which hands back the jump table in a0
if (keyword.startsWith('@')) {
  const from = parseInt(keyword.slice(1), 16)
  const h = hunkAt(engine, from)
  console.log(`\n=== $${from.toString(16)} in hunk ${h?.index ?? '?'} ===`)
  process.stdout.write(disassemble(from, Math.min(h ? h.base + h.length - from : 256, 256)))
  process.exit(0)
}

const want = keyword.toLowerCase()
const hits = rows.filter((r) => r.name === want)
if (!hits.length) {
  console.error(`no Td keyword called "${keyword}"`)
  process.exit(1)
}
for (const r of hits) {
  const h = hunkAt(engine, r.target)
  const end = h ? Math.min(h.base + h.length, r.target + 512) : r.target + 512
  console.log(`\n=== ${r.name} (${r.kind}) d0=${r.d0} d1=${r.d1} -> $${r.target.toString(16)} in hunk ${h?.index ?? '?'} ===`)
  console.log(`    arguments pushed: ${signature(r.d0)}`)
  process.stdout.write(disassemble(r.target, end - r.target))
}
