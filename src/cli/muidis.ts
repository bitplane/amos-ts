/**
 * Locate — and disassemble — the routine behind a MUI class's method.
 *
 * `src/amiga/muimaster.ts` was built from `libraries/mui.h`: the class tree,
 * the 714 constants and the `isg` flags. Those are transcribed rather than
 * read, and the file says so. This is the other side of it —
 * `muimaster.library` 19.35, the code that actually shipped, which under this
 * project's governing rule outranks the header wherever the two disagree.
 *
 * ## The path
 *
 * The library is an ordinary hunk binary: a 158K code hunk and a 3K data
 * hunk, so `../amiga/hunk` relocates it and everything below is readable.
 *
 * Its class registry is a table of twenty-byte entries in the data hunk, at
 * $237088 once hunk 0 is placed at $210000:
 *
 *     $00  0                  filled in at run time, once the class is made
 *     $04  -> "Area.mui"      the name MUI_NewObjectA takes
 *     $08  -> "Notify.mui"    the superclass, by name (0 means rootclass)
 *     $0c  -> dispatcher
 *     $10  -> instance size   `moveq #$6c,d0 / rts` for Area
 *
 * **The table is the authoritative class tree.** mui.h draws it in ASCII in
 * its opening comment and that drawing is what `MUI_SUPER` was read off; this
 * is the same tree as the library holds it, and `--tree` prints it so the two
 * can be compared. It carries one class mui.h never mentions: `Cclist.mui`.
 *
 * It also settles a question the header cannot: **only 35 classes are built
 * in.** The other thirty ship as separate binaries in `MUI/Libs/mui/*.mui`
 * and are loaded on demand, so they are a later slice and this tool does not
 * reach them yet. Every structural class is in the 35 — Area, Group, Window,
 * Application, Text, String, List, Prop, Numeric and the rest.
 *
 * ## The dispatchers
 *
 * Each is the same shape, a linear search of a method table:
 *
 *     movem.l a3-a4, -(a7)
 *     lea.l   $236b18.l, a4      ; the library's own base
 *     move.l  (a1), d0           ; msg->MethodID
 *     lea.l   $2145f4(pc), a3    ; the METHOD-ID table
 *     moveq   #$26, d1           ; one less than its length
 *     cmp.l   (a3)+, d0
 *     dbeq    d1, ...
 *     beq.b   found
 *     movea.l $18(a0), a0        ; not ours: cl->cl_Super
 *     movea.l $8(a0), a3         ;          ->cl_Dispatcher
 *     jsr     (a3)
 *   found:
 *     moveq   #$26, d0
 *     sub.w   d1, d0             ; the index the dbeq stopped at
 *     lsl.l   #$2, d0
 *     movea.l $214558(pc, d0.w), a3   ; the HANDLER table
 *     jsr     (a3)
 *
 * The two tables are contiguous — handlers first, then method ids — which is
 * the check this tool makes before believing what it decoded (`handlers +
 * 4*n == methods`). 34 of the 35 classes decode; `Mccprefs` is the exception
 * and genuinely has no methods of its own, dispatching straight to its super.
 *
 * Two classes do something extra on the way out. `Group` and `Family` call a
 * routine ($215b90 and $21876e) BEFORE handing an unrecognised method to the
 * superclass — the broadcast to children that makes a method sent to a group
 * reach everything in it. Nothing else in the 35 does that.
 *
 * ## What the tables are worth
 *
 * They are an inventory of what a class really implements, which is not what
 * the autodocs list. Area answers 39 methods; 13 of them have no name in
 * mui.h at all. A port that implements only the documented ones is not a port
 * of this library, and there was no way to know which those were until now.
 *
 * Needs `python3` with `capstone`, like `extdis` and `tddis`.
 *
 * Run: npm run cli -- src/cli/muidis.ts [class] [method|#index] [--tree]
 *      npm run cli -- src/cli/muidis.ts Area              # its method table
 *      npm run cli -- src/cli/muidis.ts Area MUIM_Draw    # one handler
 *      npm run cli -- src/cli/muidis.ts --tree            # the class tree
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadHunks } from '../amiga/hunk'
import { MUI } from '../amiga/muimaster.gen'
import { disasm } from './m68k'

const args = process.argv.slice(2)
const wantTree = args.includes('--tree')
const positional = args.filter((a) => !a.startsWith('--'))

const libPath =
  process.env.MUIMASTER ??
  join(
    homedir(),
    'src',
    'tmp',
    'amos',
    'amos-files',
    'sources',
    'aminet-mui-3.8',
    'files',
    'mui38usr',
    'MUI',
    'Libs',
    'muimaster.library',
  )

if (!existsSync(libPath)) {
  console.error(`muidis: no muimaster.library at ${libPath}`)
  console.error('Set $MUIMASTER to a copy of MUI 3.8\'s Libs/muimaster.library.')
  process.exit(1)
}

const lib = loadHunks(new Uint8Array(readFileSync(libPath)))
const dv = new DataView(lib.image.buffer, lib.image.byteOffset, lib.image.byteLength)
const L = (a: number): number => dv.getUint32(a - lib.base, false)

/**
 * The class table's first entry.
 *
 * Found rather than hardcoded: the entries are 20 bytes and the only ones
 * whose $04 is a "*.mui" string, so walking back from a known-good entry to
 * the first that stops matching finds the head wherever a rebuild puts it.
 */
const STRIDE = 20

function muiString(a: number): string | null {
  let o = a - lib.base
  if (o < 0 || o >= lib.image.length) return null
  let out = ''
  while (o < lib.image.length && lib.image[o] !== 0) {
    const c = lib.image[o]!
    if (c < 32 || c > 126) return null
    out += String.fromCharCode(c)
    o++
  }
  return out.endsWith('.mui') ? out : null
}

interface MuiClass {
  /** "Area.mui" as the library spells it */
  name: string
  /** short form, the key `MUI_SUPER` uses */
  short: string
  /** superclass short name, or "rootclass" where the field is 0 */
  super: string
  dispatcher: number
  /** the `moveq #n,d0 / rts` that answers the instance-data size */
  sizer: number
  entry: number
}

function classTable(): MuiClass[] {
  // any entry does to start; this one is Family, the first the data hunk holds
  let head = 0x237100
  while (muiString(L(head - STRIDE + 4))) head -= STRIDE
  const out: MuiClass[] = []
  for (let a = head; ; a += STRIDE) {
    const name = muiString(L(a + 4))
    if (!name) break
    const supAddr = L(a + 8)
    const sup = supAddr === 0 ? null : muiString(supAddr)
    out.push({
      name,
      short: name.replace(/\.mui$/, ''),
      super: sup === null ? 'rootclass' : sup.replace(/\.mui$/, ''),
      dispatcher: L(a + 12),
      sizer: L(a + 16),
      entry: a,
    })
  }
  return out
}

/** MethodID -> the name mui.h gives it, plus the BOOPSI ones it does not */
function methodNames(): Map<number, string> {
  const m = new Map<number, string>()
  for (const [k, v] of Object.entries(MUI)) if (typeof v === 'number' && k.startsWith('MUIM_')) m.set(v >>> 0, k)
  // boopsi's own, from intuition/classusr.h — not MUI's to declare
  const om: Record<number, string> = {
    0x101: 'OM_NEW',
    0x102: 'OM_DISPOSE',
    0x103: 'OM_SET',
    0x104: 'OM_GET',
    0x105: 'OM_ADDTAIL',
    0x106: 'OM_REMOVE',
    0x107: 'OM_NOTIFY',
    0x108: 'OM_UPDATE',
    0x109: 'OM_ADDMEMBER',
    0x10a: 'OM_REMMEMBER',
  }
  for (const [k, v] of Object.entries(om)) m.set(Number(k), v)
  return m
}

interface Method {
  id: number
  handler: number
  name: string | null
}

/**
 * A class's method table, decoded out of its dispatcher.
 *
 * Reads capstone's text rather than the opcodes: the three facts wanted are
 * each one instruction and each already resolved to an absolute address by
 * the disassembler, where decoding the PC-relative forms by hand would be
 * three more places to get an extension word wrong. `null` where the class
 * has no table of its own, which is a real answer and not a failure.
 */
function methodsOf(cl: MuiClass): Method[] | null {
  const names = methodNames()
  const head = (disasm(lib.image, lib.base, cl.dispatcher, cl.dispatcher + 40) ?? []).join('\n')
  const table = /lea\.l\s+\$([0-9a-f]+)\(pc\), a3/.exec(head)
  const count = /moveq\s+#\$([0-9a-f]+), d1/.exec(head)
  const found = /beq\.b\s+\$([0-9a-f]+)/.exec(head)
  if (!table || !count || !found) return null

  const tail = (disasm(lib.image, lib.base, parseInt(found[1]!, 16), parseInt(found[1]!, 16) + 24) ?? []).join('\n')
  const handlers = /movea\.l\s+\$([0-9a-f]+)\(pc, d0\.w\), a3/.exec(tail)
  if (!handlers) return null

  const n = parseInt(count[1]!, 16) + 1
  const mAddr = parseInt(table[1]!, 16)
  const hAddr = parseInt(handlers[1]!, 16)
  // the tables are contiguous, handlers first — if they are not, the shape
  // is not the one this tool understands and a guess would be worse than none
  if (hAddr + n * 4 !== mAddr) return null

  const out: Method[] = []
  for (let i = 0; i < n; i++) {
    const id = L(mAddr + i * 4) >>> 0
    out.push({ id, handler: L(hAddr + i * 4) >>> 0, name: names.get(id) ?? null })
  }
  return out
}

const classes = classTable()

if (wantTree || positional.length === 0) {
  if (wantTree) {
    const methodCount = classes.reduce((sum, c) => sum + (methodsOf(c)?.length ?? 0), 0)
    console.log(`${classes.length} built-in classes, ${methodCount} method-table entries, from the table at 0x${classes[0]!.entry.toString(16)}`)
    for (const c of classes) {
      const ms = methodsOf(c)
      console.log(
        `  ${c.short.padEnd(14)} < ${c.super.padEnd(12)} ` +
          `dispatcher 0x${c.dispatcher.toString(16)}  ${ms ? `${ms.length} methods` : 'pass-through'}`,
      )
    }
  } else {
    console.error('usage: muidis.ts [class] [method|#index] [--tree]')
    console.error(`classes: ${classes.map((c) => c.short).join(' ')}`)
    process.exit(1)
  }
  process.exit(0)
}

const wanted = positional[0]!.toLowerCase().replace(/\.mui$/, '')
const cl = classes.find((c) => c.short.toLowerCase() === wanted)
if (!cl) {
  console.error(`muidis: no built-in class "${positional[0]}"`)
  console.error(`classes: ${classes.map((c) => c.short).join(' ')}`)
  console.error('The other thirty MUI classes ship as MUI/Libs/mui/*.mui and are not reachable here.')
  process.exit(1)
}

const methods = methodsOf(cl)
// six bytes, not four: the big classes answer with `move.l #$49e,d0` rather
// than a moveq, and a four-byte window cuts the immediate in half
const sizer = disasm(lib.image, lib.base, cl.sizer, cl.sizer + 6) ?? []

if (!methods) {
  console.log(`${cl.short} < ${cl.super} — dispatches everything to its superclass, no table of its own`)
  process.exit(0)
}

if (positional.length === 1) {
  console.log(`${cl.short} < ${cl.super}   dispatcher 0x${cl.dispatcher.toString(16)}`)
  console.log(`instance size: ${sizer[0]?.trim() ?? '?'}`)
  console.log(`${methods.length} methods:`)
  for (const [i, m] of methods.entries()) {
    console.log(
      `  ${String(i).padStart(2)}  0x${m.id.toString(16).padStart(8, '0')}  ` +
        `0x${m.handler.toString(16)}  ${m.name ?? '(undocumented)'}`,
    )
  }
  process.exit(0)
}

const sel = positional[1]!
const idx = sel.startsWith('#')
  ? Number(sel.slice(1))
  : methods.findIndex((m) => (m.name ?? '').toLowerCase() === sel.toLowerCase())
const method = methods[idx]
if (!method) {
  console.error(`muidis: ${cl.short} has no method "${sel}"`)
  console.error(`methods: ${methods.map((m) => m.name ?? '?').join(' ')}`)
  process.exit(1)
}

/**
 * How far to disassemble a handler.
 *
 * There is no length anywhere — the handlers are simply laid out in order, so
 * the next one along is the end of this one. The last in the table has no
 * successor and gets a fixed window.
 */
const after = methods
  .map((m) => m.handler)
  .filter((h) => h > method.handler)
  .sort((a, b) => a - b)[0]
const end = after ?? method.handler + 0x200

console.log(`${cl.short}.${method.name ?? `#${idx}`} — 0x${method.handler.toString(16)}..0x${end.toString(16)}`)
console.log((disasm(lib.image, lib.base, method.handler, end) ?? ['(no python3/capstone)']).join('\n'))
