/**
 * Extract Amiga disk images to directories.
 *
 * Corpus preparation: most surviving AMOS material is on floppies, and the
 * scanning tools (extscan, libscan) walk directory trees. This bridges the
 * two, using the same reader the browser uses to mount a dropped `.adf`, so
 * a bug here shows up in the port and vice versa.
 *
 * By default each image is written beside itself as `<name>.extracted/`,
 * which keeps the derived tree next to the image it came from — the corpus
 * treats extracted files as regenerable, and the image stays authoritative.
 *
 * Run: npm run cli -- src/cli/adfx.ts <dir|file>... [--out DIR] [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostPath, walkFiles } from './walk'
import { basename, dirname, join } from 'node:path'
import { adfInfo, isAdf, readAdf } from '../loader/adf'

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const outDir = outAt >= 0 ? args[outAt + 1] : undefined
const force = args.includes('--force')
const roots = args.filter((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1))
if (roots.length === 0) {
  console.error('usage: adfx <dir|file>... [--out DIR] [--force]')
  process.exit(1)
}

let images = 0
let files = 0
let skipped = 0
let failed = 0

for (const root of roots) {
  for (const entry of walkFiles(root)) {
    const image = hostPath(entry)
    if (!/\.adf$/i.test(image)) continue
    const bytes = new Uint8Array(readFileSync(entry))
    if (!isAdf(bytes)) {
      console.warn(`${image}: not an Amiga disk image (wrong size or signature)`)
      failed++
      continue
    }
    const target = outDir !== undefined
      ? join(outDir, basename(image).replace(/\.adf$/i, ''))
      : join(dirname(image), `${basename(image).replace(/\.adf$/i, '')}.extracted`)
    if (existsSync(target) && !force) {
      skipped++
      continue
    }
    let entries
    let info
    try {
      info = adfInfo(bytes)
      entries = readAdf(bytes)
    } catch (e) {
      console.warn(`${image}: ${(e as Error).message}`)
      failed++
      continue
    }
    for (const e of entries) {
      // paths come from a thirty-year-old filesystem: keep them inside the
      // target directory whatever they claim to be
      const segs = e.path.split('/').filter((s) => s !== '' && s !== '.' && s !== '..')
      if (segs.length === 0) continue
      const dest = join(target, ...segs)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, e.data)
      files++
    }
    images++
    console.log(
      `${basename(image).padEnd(42)} ${info.filesystem}  ${info.label.padEnd(22)} ${String(entries.length).padStart(4)} files`,
    )
  }
}

console.log(`\n${images} image(s) extracted, ${files} files` +
  (skipped > 0 ? `, ${skipped} already extracted (use --force)` : '') +
  (failed > 0 ? `, ${failed} failed` : ''))
