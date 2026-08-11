/**
 * Read AMOS extension libraries off a directory tree and turn their token
 * tables into identification candidates.
 *
 * A collection that carries both programs and the `.Lib` files they needed —
 * a PD library disc, an install, a coverdisk rip — can identify its own slot
 * numbers: the token ids a program uses are byte offsets into one specific
 * table, so a library found next to the programs either accounts for every
 * observed id or is not what that slot held. This turns extscan's wanted
 * list from "find the extension with an entry at $04d2" into an answer.
 *
 * The candidates produced here are deliberately *not* registry entries. They
 * carry no provenance, no evidence tier and no verified id base, so they are
 * a lead to be confirmed and written up by hand (see
 * docs/extensions/README.md), not something to be trusted on sight.
 *
 * Node-only — this is why it lives under src/cli rather than src/ext.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { hostPath, walkFiles } from './walk'
import { parseAmosLib, parseAmosLibOld, type TokenEntry } from '../tokens/libtok'
import { TokenTable } from '../tokens/stream'
import type { Extension } from '../ext/registry'

export interface ScannedLib {
  /** synthetic identity: file stem plus a hash of the table itself */
  id: string
  /** the file it was read from */
  file: string
  /** every path this same table was found at (collections repeat libraries) */
  copies: string[]
  /** which of the two library layouts parsed it */
  format: 'AP20' | 'legacy'
  tokens: TokenEntry[]
  /** entries carrying a real keyword name (the rest are arity variants) */
  named: number
  sha256: string
}

/** files that are Amiga hunk objects but not extension libraries */
const isLibName = (p: string): boolean => /\.lib$/i.test(p)

/** fingerprint of a token table: its shape, independent of where it was found */
function tableHash(tokens: TokenEntry[]): string {
  const h = createHash('sha256')
  for (const t of tokens) h.update(`${t.id}:${t.name}:${t.spec}:${t.instr}:${t.func}\n`)
  return h.digest('hex')
}

export interface ScanResult {
  libs: ScannedLib[]
  /** files ending .lib that neither parser could read */
  unreadable: string[]
}

/**
 * Read every `.Lib` under the given roots, keeping one entry per distinct
 * token table. AP20 is tried first: a stock 2.0 library read as a legacy one
 * yields a plausible-looking but wrongly based table.
 */
export function scanLibraries(roots: string[]): ScanResult {
  const byHash = new Map<string, ScannedLib>()
  const unreadable: string[] = []
  for (const root of roots) {
    for (const entry of walkFiles(root)) {
      const file = hostPath(entry)
      if (!isLibName(file)) continue
      let bytes: Uint8Array
      try {
        bytes = readFileSync(entry)
      } catch {
        unreadable.push(file)
        continue
      }
      let parsed: { tokens: TokenEntry[]; format: 'AP20' | 'legacy' } | null = null
      for (const [format, fn] of [
        ['AP20', parseAmosLib],
        ['legacy', parseAmosLibOld],
      ] as const) {
        try {
          const lib = fn(bytes)
          if (lib.tokens.length > 0) {
            parsed = { tokens: lib.tokens, format }
            break
          }
        } catch {
          /* try the other layout */
        }
      }
      if (!parsed) {
        unreadable.push(file)
        continue
      }
      const sha256 = tableHash(parsed.tokens)
      const already = byHash.get(sha256)
      if (already) {
        already.copies.push(file)
        continue
      }
      const stem = basename(file).replace(/\.lib$/i, '').toLowerCase()
      byHash.set(sha256, {
        id: `${stem}-${sha256.slice(0, 8)}`,
        file,
        copies: [file],
        format: parsed.format,
        tokens: parsed.tokens,
        named: parsed.tokens.filter((t) => /[a-z]/i.test(t.name)).length,
        sha256,
      })
    }
  }
  return { libs: [...byHash.values()], unreadable }
}

/**
 * Dress a scanned library up as an Extension so identifySlot can score it
 * beside the registry. Everything that would make it a registry entry —
 * provenance, a calibrated id base, a write-up — is explicitly absent or
 * marked unknown, because a scan establishes none of those.
 *
 * The evidence tier is NOT among them. A scan's input is a `.Lib` file, so
 * the binary is in hand by construction and the tier is `disassembly`, the
 * same rule the registry runs on: the tier records what is available to
 * read, and nobody having read it yet is a different fact. This field said
 * `table` for a while, which claimed the opposite of what the scanner is —
 * that only a token table had been recovered — for the one code path that
 * can never be in that position.
 */
export function libAsExtension(lib: ScannedLib): Extension {
  return {
    id: lib.id,
    name: basename(lib.file),
    version: '',
    author: '',
    origin: 'third-party',
    format: lib.format === 'AP20' ? 'ap20' : 'legacy',
    evidence: 'disassembly',
    idBaseEvidence: 'assumed',
    observedSlots: [],
    titleStrings: [],
    sha256: lib.sha256,
    provenance: `scanned from ${lib.file}`,
    notes: 'candidate from libscan — not a registry entry',
    tokens: lib.tokens,
    table: new TokenTable(lib.tokens),
  } as Extension
}
