/** Audit OS DevKit keywords against the machine-layer backend inventory. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstCodeHunk } from '../amiga/hunk'
import { EXT_TABLES } from '../ext/tables.gen'
import { auditOsBackend, osBackendSummary } from '../ext/osbackend'

const path = join('fixtures', 'extensions', 'os-devkit-1.61', 'AMOSPro_OS_DevKit.Lib')
if (!existsSync(path)) {
  console.error(`${path} is not present`)
  process.exit(1)
}
const rows = auditOsBackend(EXT_TABLES['os-devkit-1.61']!, firstCodeHunk(new Uint8Array(readFileSync(path))))
const summary = osBackendSummary(rows)
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, rows }, null, 2))
else {
  console.log(`OS DevKit 1.61: ${summary.total} named keywords`)
  console.log(`  modelled-family candidate  ${summary.byStatus.modelled}`)
  console.log(`  known missing               ${summary.byStatus.missing}`)
  console.log(`  operation review required   ${summary.byStatus.review}`)
  console.log(`  referenced routines         ${summary.referencedRoutines}`)
  console.log(`  resolved worker routines    ${summary.workers}`)
  console.log(`  eight-byte routines         ${summary.eightByteRoutines}`)
  console.log(`  keywords with direct calls  ${summary.keywordsWithOsCalls}`)
  console.log(`  untraced direct calls       ${summary.untracedOsCalls}`)
  console.log('\nDirect calls by library (keywords / distinct LVOs)')
  for (const row of summary.byLibrary) {
    console.log(`  ${row.library.padEnd(22)} ${String(row.keywords).padStart(3)} / ${row.lvos}`)
  }
  console.log('\nNamespace audit')
  for (const group of summary.byFamily) {
    console.log(`${group.status.padEnd(8)} ${group.family.padEnd(16)} ${String(group.keywords).padStart(4)}`)
  }
}
