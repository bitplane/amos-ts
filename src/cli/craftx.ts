/**
 * Unpack the CRAFT installer disk's `Data*` blobs.
 *
 * Run: npm run cli -- src/cli/craftx.ts <dir-of-Data-blobs> <out-dir>
 *
 * The disk that CRAFT shipped on is an installer and seven opaque blobs, so
 * every readable thing about the extension except the library itself — the
 * 42KB help text, forty example programs, nine accessories — arrives packed.
 * This is what gets them out, and it is kept because `fixtures/` is not in
 * the repository: a clone with the archive can reproduce the vendored files
 * rather than trust them.
 *
 * The CONTAINER is the installer's, not the packer's, and is four lines:
 *
 *     [total:4]                  bytes of file data in this blob
 *     [path\0][size:2] x N       until the sizes add up to the total
 *     [ one \SOLARIS/ stream ]   the files, concatenated, in that order
 *
 * ../amiga/solaris.ts holds the codec and the account of where it was read.
 * Two blobs are not in this format and are skipped: Data0 is the library
 * behind an eight-byte prefix, and Data6 is a music module.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { isSolaris, solarisDecrunch } from '../amiga/solaris'

export interface BlobEntry {
  /** the AmigaDOS path the installer would have written it to */
  path: string
  size: number
  data: Uint8Array
}

/** Read one `Data*` blob, or null if it is not a packed container. */
export function readBlob(raw: Uint8Array): BlobEntry[] | null {
  if (raw.length < 8) return null
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const total = dv.getUint32(0)
  const names: Array<[string, number]> = []
  let at = 4
  let seen = 0
  while (seen < total) {
    let end = at
    while (end < raw.length && raw[end] !== 0) end++
    // a path is short, printable and terminated; anything else means this
    // blob is one of the two that are stored raw
    if (end >= raw.length || end === at || end - at > 120) return null
    const path = String.fromCharCode(...raw.subarray(at, end))
    if (!/^[\x20-\x7e]+$/.test(path)) return null
    if (end + 3 > raw.length) return null
    const size = dv.getUint16(end + 1)
    names.push([path, size])
    seen += size
    at = end + 3
  }
  if (seen !== total || !isSolaris(raw.subarray(at))) return null

  const all = solarisDecrunch(raw.subarray(at))
  const out: BlobEntry[] = []
  let p = 0
  for (const [path, size] of names) {
    out.push({ path, size, data: all.subarray(p, p + size) })
    p += size
  }
  return out
}

if (process.argv[1]?.endsWith('craftx.ts')) {
  const [, , from, to] = process.argv
  if (!from || !to) {
    console.error('usage: craftx.ts <dir-of-Data-blobs> <out-dir>')
    process.exit(2)
  }
  let files = 0
  for (let n = 0; n < 8; n++) {
    let raw: Uint8Array
    try {
      raw = new Uint8Array(readFileSync(join(from, `Data${n}`)))
    } catch {
      continue
    }
    const blob = readBlob(raw)
    if (!blob) {
      console.log(`Data${n}: not a packed container, skipped`)
      continue
    }
    for (const e of blob) {
      // "DF0:Examples/Turtle/Plant.AMOS" -> "Examples/Turtle/Plant.AMOS"
      const rel = e.path.includes(':') ? e.path.slice(e.path.indexOf(':') + 1) : e.path
      let dest = join(to, rel)
      /*
       * Two blobs carry the same paths with different contents: Data1's
       * accessories are AMOS 1.3 builds and Data4's are AMOS Pro ones, and
       * the installer picks a set by what it finds on the machine. Merging
       * them blind loses four files silently, so a differing collision keeps
       * both and says so.
       */
      if (existsSync(dest)) {
        const had = new Uint8Array(readFileSync(dest))
        const same = had.length === e.data.length && had.every((b, i) => b === e.data[i])
        if (same) continue
        dest = `${dest}.Data${n}`
        console.log(`  kept both builds of ${rel} (this one as ${rel}.Data${n})`)
      }
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, e.data)
      files++
    }
    console.log(`Data${n}: ${blob.length} files, ${blob.reduce((a, e) => a + e.size, 0)} bytes`)
  }
  console.log(`${files} files written to ${to}`)
}
