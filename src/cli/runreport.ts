/**
 * Interpreter+runtime coverage census: run every corpus program headless
 * (screens in memory, blocking fast-forwarded) and report what stops us.
 *
 *   npm run cli -- src/cli/runreport.ts [fixturesDir] [--frames N]
 */
import { readFileSync } from 'node:fs'
import { hostPath, walkFiles } from './walk'
import { fixedClock } from '../runtime/host'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionTablesFor } from '../ext/identify'
import { Runtime } from '../runtime/runtime'
import { fsForFile } from './nodefs'

const args = process.argv.slice(2)
const fIdx = args.indexOf('--frames')
const maxFrames = fIdx >= 0 ? parseInt(args[fIdx + 1] ?? '', 10) : 2_000
const root = args.filter((a) => !a.startsWith('--') && a !== String(maxFrames))[0] ?? 'fixtures'

const table = new TokenTable(CORE_TOKENS)

// the system default resource is part of the machine (Sys_Resource,
// loaded at AMOS Pro startup from config message 8)
let systemResource: Uint8Array | null = null
try {
  systemResource = readFileSync('fixtures/official-amos/APSystem/AMOSPro_Default_Resource.Abk')
} catch {
  // fixtures without the system files: dialogs will error faithfully
}
// so is the mouse bank (pointer shapes + system fill patterns, T_MouBank)
let mouseBank: Uint8Array | null = null
try {
  mouseBank = readFileSync('fixtures/machine/AMOSPro_Mouse.abk')
} catch {
  /* pattern dither fallbacks apply */
}

let files = 0
let ran = 0
let cleanEnd = 0
let ranClean = 0
const statuses = new Map<string, number>()
const errors = new Map<string, number>()
const unimpl = new Map<string, number>()
/** how many PROGRAMS each keyword blocks, as against how often it is reached */
const byProgram = new Map<string, number>()

for (const file of walkFiles(root)) {
  const path = hostPath(file)
  if (!/\.amos$/i.test(path)) continue
  // Parsing is inside the guard because a collection is not a fixtures tree:
  // a truncated header or a bank length that runs past the end of the file is
  // a program to report, not a reason to abandon the census.
  try {
    const amos = parseAmosFile(readFileSync(file))
    if (amos.source.length === 0) continue
    files++
    const lines = parseSource(amos.source, table)
    const rt = new Runtime(lines, table, {
      extensions: extensionTablesFor(lines),
      onUnimplemented: 'skip',
      maxSteps: 120_000,
      banks: amos.banks,
      // pinned, not inherited: a census whose numbers move with the calendar
      // could not be compared against yesterday's run
      host: { clock: fixedClock() },
      fs: fsForFile(path, path.includes('aga-releases') ? 'fixtures/aga-releases' : 'fixtures/official-amos'),
    })
    if (systemResource) rt.loadSystemResource(systemResource)
    if (mouseBank) rt.loadMouseBank(mouseBank)
    const result = rt.runHeadless(maxFrames)
    ran++
    const status = result.status === 'paused' ? 'frameCap' : result.status
    statuses.set(status, (statuses.get(status) ?? 0) + 1)
    if (result.status === 'ended' && result.unimplemented.size === 0) cleanEnd++
    // the figure that actually measures coverage: of the programs that ran to
    // a stop, how many never hit an unimplemented keyword. "ended with nothing
    // skipped" counts only programs that TERMINATE, and most AMOS programs are
    // games and demos that never do.
    if (result.unimplemented.size === 0) ranClean++
    for (const [name, n] of result.unimplemented) {
      unimpl.set(name, (unimpl.get(name) ?? 0) + n)
      byProgram.set(name, (byProgram.get(name) ?? 0) + 1)
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split(' — at line')[0]!
    errors.set(msg, (errors.get(msg) ?? 0) + 1)
  }
}

const pct = ran === 0 ? 0 : Math.round((ranClean / ran) * 100)
console.log(`programs: ${files}, ran to a stop: ${ran}, ended with nothing skipped: ${cleanEnd}`)
console.log(`ran to a stop with nothing skipped: ${ranClean} of ${ran} — ${pct}%`)
console.log('statuses:', Object.fromEntries(statuses))
console.log('\ntop runtime errors:')
for (const [msg, n] of [...errors].sort((a, b) => b[1] - a[1]).slice(0, args.includes("--all") ? 10000 : 25)) {
  console.log(`  ${String(n).padStart(4)}  ${msg}`)
}
const limit = args.includes('--all') ? 10000 : 40
if (args.includes('--by-program')) {
  // ranked by how many programs a keyword blocks rather than how often it is
  // reached — a keyword inside a tight loop counts thousands of times and
  // still only blocks one program
  console.log('\ntop skipped instructions (programs blocked, then occurrences):')
  for (const [name, p] of [...byProgram].sort((a, b) => b[1] - a[1] || (unimpl.get(b[0]) ?? 0) - (unimpl.get(a[0]) ?? 0)).slice(0, limit)) {
    console.log(`  ${String(p).padStart(4)} prog  ${String(unimpl.get(name) ?? 0).padStart(8)} hits  ${name}`)
  }
} else {
  console.log('\ntop skipped instructions (total occurrences):')
  for (const [name, n] of [...unimpl].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    console.log(`  ${String(n).padStart(8)}  ${name}`)
  }
}
