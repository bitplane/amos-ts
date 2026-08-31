/**
 * Run an AMOS program headless: text output to stdout, screens composited
 * in memory. Accepts a .AMOS file or a plain-text .amos listing.
 *
 *   npm run cli -- src/cli/amosrun.ts <file> [--strict] [--frames N] [--dump out.ppm]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { loadProgram } from '../loader/program'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { Runtime } from '../runtime/runtime'
import { fsForFile } from './nodefs'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const maxFrames = parseInt(opt('--frames') ?? '5000', 10)
const dump = opt('--dump')
const optValues = new Set([opt('--frames'), opt('--dump')].filter((v) => v !== undefined))
const file = args.find((a) => !a.startsWith('--') && !optValues.has(a))
if (!file) {
  console.error('usage: amosrun <file.AMOS | listing.txt> [--strict] [--frames N] [--dump out.ppm]')
  process.exit(1)
}

const table = new TokenTable(CORE_TOKENS)
const bytes = readFileSync(file)
const { lines, extensions, bindings, amos } = loadProgram(bytes, table)

const rt = new Runtime(lines, table, {
  commandName: basename(file),
  extensions,
  extBindings: bindings,
  onUnimplemented: strict ? 'throw' : 'skip',
  onText: (t) => process.stdout.write(t),
  banks: amos?.banks ?? [],
  fs: fsForFile(file),
})
for (const w of rt.interp.program.warnings) console.error(`warning: ${w}`)

const result = rt.runHeadless(maxFrames)
console.error(`\n--- ${result.status} after ${result.frames} frames, ${rt.interp.totalSteps} statements`)
if (result.unimplemented.size > 0) {
  const skipped = [...result.unimplemented].sort((a, b) => b[1] - a[1])
  console.error(`--- skipped unimplemented: ${skipped.map(([n, c]) => `${n}(${c})`).join(', ')}`)
}

if (dump !== undefined) {
  const { width, height, data } = rt.composite()
  const ppm = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    ppm[i * 3] = data[i * 4]!
    ppm[i * 3 + 1] = data[i * 4 + 1]!
    ppm[i * 3 + 2] = data[i * 4 + 2]!
  }
  writeFileSync(dump, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), ppm]))
  console.error(`--- composite written to ${dump}`)
}
