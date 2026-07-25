/**
 * Interpreter+runtime coverage census: run every corpus program headless
 * (screens in memory, blocking fast-forwarded) and report what stops us.
 *
 *   npm run cli -- src/cli/runreport.ts [fixturesDir] [--frames N]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.amos$/i.test(name)) yield p
  }
}

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
const statuses = new Map<string, number>()
const errors = new Map<string, number>()
const unimpl = new Map<string, number>()

for (const path of walk(root)) {
  const amos = parseAmosFile(readFileSync(path))
  if (amos.source.length === 0) continue
  files++
  try {
    const lines = parseSource(amos.source, table)
    const rt = new Runtime(lines, table, {
      extensions: extensionTablesFor(lines),
      onUnimplemented: 'skip',
      maxSteps: 120_000,
      banks: amos.banks,
      fs: fsForFile(path, path.includes('aga-releases') ? 'fixtures/aga-releases' : 'fixtures/official-amos'),
    })
    if (systemResource) rt.loadSystemResource(systemResource)
    if (mouseBank) rt.loadMouseBank(mouseBank)
    const result = rt.runHeadless(maxFrames)
    ran++
    const status = result.status === 'paused' ? 'frameCap' : result.status
    statuses.set(status, (statuses.get(status) ?? 0) + 1)
    if (result.status === 'ended' && result.unimplemented.size === 0) cleanEnd++
    for (const [name, n] of result.unimplemented) unimpl.set(name, (unimpl.get(name) ?? 0) + n)
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split(' — at line')[0]!
    errors.set(msg, (errors.get(msg) ?? 0) + 1)
  }
}

console.log(`programs: ${files}, ran to a stop: ${ran}, ended with nothing skipped: ${cleanEnd}`)
console.log('statuses:', Object.fromEntries(statuses))
console.log('\ntop runtime errors:')
for (const [msg, n] of [...errors].sort((a, b) => b[1] - a[1]).slice(0, args.includes("--all") ? 10000 : 25)) {
  console.log(`  ${String(n).padStart(4)}  ${msg}`)
}
console.log('\ntop skipped instructions (total occurrences):')
for (const [name, n] of [...unimpl].sort((a, b) => b[1] - a[1]).slice(0, args.includes("--all") ? 10000 : 40)) {
  console.log(`  ${String(n).padStart(8)}  ${name}`)
}
