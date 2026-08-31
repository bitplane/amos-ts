/**
 * Read AMOS extension libraries off a directory tree and turn their token
 * tables into identification candidates.
 *
 * A PD library disc, install or coverdisk rip commonly carries many copies of
 * the same table under different filenames. This module reads the supported
 * layouts once and deduplicates them for `libcat`.
 *
 * The candidates produced here are deliberately *not* registry entries. They
 * carry no provenance, no evidence tier and no verified id base, so they are
 * a lead to be confirmed and written up by hand (see
 * docs/extensions/README.md), not something to be trusted on sight.
 *
 * Node-only — it reads directory trees and is not part of the package API.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { hostPath, walkFiles } from './walk'
import { parseAmosLib, parseAmosLibOld, parseAmosToolsTable, type TokenEntry } from '../tokens/libtok'
import { TokenTable } from '../tokens/stream'
import type { Extension } from '../ext/registry'

export interface ScannedLib {
  /** synthetic identity: file stem plus a hash of the table itself */
  id: string
  /** the file it was read from */
  file: string
  /** every path this same table was found at (collections repeat libraries) */
  copies: string[]
  /** which of the three layouts parsed it */
  format: 'AP20' | 'legacy' | 'amostools'
  tokens: TokenEntry[]
  /** entries carrying a real keyword name (the rest are arity variants) */
  named: number
  sha256: string
}

/**
 * Files worth trying a parser on.
 *
 * `.Lib` is the Amiga name. The trailing-version form is AMOSTools': its
 * `Extensions/` directory holds one file per RELEASE, named
 * `AMOSPro_CRAFT.Lib-V1.00`, so a plain `.lib$` test sees none of them — which
 * is why a directory of 132 token tables read as empty until this was widened.
 */
const isLibName = (p: string): boolean => /\.lib(-[^/]*)?$/i.test(p)

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
      let parsed: { tokens: TokenEntry[]; format: ScannedLib['format'] } | null = null
      // amostools first, and safely: parseAmosToolsTable refuses anything whose
      // routine words are not the `====` scrub, so a real library falls through
      // it rather than being misread. AP20 before legacy for the same reason in
      // reverse — a stock 2.0 library read as a legacy one yields a
      // plausible-looking table on the wrong base.
      for (const [format, fn] of [
        ['amostools', parseAmosToolsTable],
        ['AP20', parseAmosLib],
        ['legacy', parseAmosLibOld],
      ] as const) {
        try {
          const out = fn(bytes)
          const tokens = Array.isArray(out) ? out : out.tokens
          if (tokens.length > 0) {
            parsed = { tokens, format }
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
      const stem = basename(file).replace(/\.lib(-[^/]*)?$/i, '$1').toLowerCase()
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
 * The evidence tier is NOT among them, and it is the one field that depends on
 * WHICH parser read the file. A scan's input is normally a `.Lib`, so the
 * binary is in hand by construction and the tier is `disassembly` — the same
 * rule the registry runs on: the tier records what is available to read, and
 * nobody having read it yet is a different fact. This field said `table` for a
 * while, which claimed the opposite of what the scanner is.
 *
 * An `amostools` stub is the exception and the reason that rule has to be
 * stated rather than assumed. It is a token table with the library stripped
 * out from under it: no code, both hunk lengths zero, every routine word
 * overwritten with `====`. There is nothing to disassemble, so it caps at
 * `manual`, exactly as ../ext/registry.ts says and as ext.test.ts enforces for
 * the manifests.
 */
export function libAsExtension(lib: ScannedLib): Extension {
  return {
    id: lib.id,
    name: basename(lib.file),
    version: '',
    author: '',
    origin: 'third-party',
    format: lib.format === 'AP20' ? 'ap20' : lib.format === 'amostools' ? 'amostools' : 'legacy',
    evidence: lib.format === 'amostools' ? 'manual' : 'disassembly',
    idBaseEvidence: 'assumed',
    observedSlots: [],
    titleStrings: [],
    sha256: lib.sha256,
    provenance: `scanned from ${lib.file}`,
    notes: 'candidate from libcat — not a registry entry',
    tokens: lib.tokens,
    table: new TokenTable(lib.tokens, true),
  } as Extension
}
