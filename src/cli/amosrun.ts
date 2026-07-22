/**
 * Run an AMOS program headless: text output to stdout, everything
 * graphical stubbed. Accepts a .AMOS file or a plain-text .amos listing.
 *
 *   npm run cli -- src/cli/amosrun.ts <file> [--strict] [--max-steps N]
 */
import { readFileSync } from 'node:fs'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { tokenize } from '../tokens/tokenizer'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { Interp } from '../interp/interp'
import type { AmosIO } from '../interp/io'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const maxIdx = args.indexOf('--max-steps')
const maxSteps = maxIdx >= 0 ? parseInt(args[maxIdx + 1] ?? '', 10) : 2_000_000
const file = args.filter((a) => !a.startsWith('--') && a !== String(maxSteps))[0]
if (!file) {
  console.error('usage: amosrun <file.AMOS | listing.txt> [--strict] [--max-steps N]')
  process.exit(1)
}

const table = new TokenTable(CORE_TOKENS)
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))

const bytes = readFileSync(file)
const isAmos = /^AMOS (Basic|Pro)/.test(bytes.subarray(0, 16).toString('latin1'))
const lines = isAmos
  ? parseSource(parseAmosFile(bytes).source, table)
  : tokenize(bytes.toString('latin1'), table)

let ticks = 0
const io: AmosIO = {
  write: (t) => process.stdout.write(t),
  input: (prompt) => {
    process.stdout.write(prompt)
    return '' // headless: no stdin (yet)
  },
  wait: (n) => {
    ticks += n
  },
  timer: () => ticks,
}

const interp = new Interp(lines, table, {
  io,
  extensions,
  onUnimplemented: strict ? 'throw' : 'skip',
  maxSteps,
})
for (const w of interp.program.warnings) console.error(`warning: ${w}`)

const result = interp.run()
console.error(`\n--- ${result.status} after ${result.steps} statements`)
if (result.unimplemented.size > 0) {
  const skipped = [...result.unimplemented].sort((a, b) => b[1] - a[1])
  console.error(`--- skipped unimplemented: ${skipped.map(([n, c]) => `${n}(${c})`).join(', ')}`)
}
