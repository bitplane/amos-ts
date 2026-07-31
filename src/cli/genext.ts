/**
 * Generate src/ext/tables.gen.ts — the token table and metadata for every
 * extension in the registry, keyed by extension *identity*.
 *
 * Run: npm run cli -- src/cli/genext.ts
 *
 * Stock extensions come from the AMOS Pro system disc; third-party ones from
 * the manifests in src/ext/manifests/. Both end up in the same table so
 * that slot identification treats them alike: a slot number is a per-machine
 * config index, not an identity (see docs/extensions/README.md).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseAmosLib, parseAmosLibOld, type TokenEntry } from '../tokens/libtok'
import { tokensFromSource } from '../ext/tokensrc'
import type { ExtensionInfo } from '../ext/registry'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sys = join(root, 'fixtures', 'official-amos', 'APSystem')
/**
 * Manifests are tracked in the repository; the libraries they describe are not
 * (fixtures/ is gitignored — the AMOS material is not ours to redistribute).
 * So the registry's documentation and provenance survive a clone even though
 * the binaries have to be supplied locally.
 */
const manifestDir = join(root, 'src', 'ext', 'manifests')
const extDir = join(root, 'fixtures', 'extensions')

/**
 * The extensions shipped with AMOS Professional, with the slots the stock
 * AMOSPro_Interpreter_Config assigns them (+Interpreter_Config.s:152-157 —
 * message 15+n holds the filename for slot n).
 */
const STOCK: Array<{ id: string; name: string; slot: number; file: string; earlier?: string }> = [
  {
    id: 'amospro-music-2.0',
    name: 'Music',
    slot: 1,
    file: 'AMOSPro_Music.Lib',
    earlier:
      'An earlier build exists and is deliberately NOT registered: AMOSPro_Music.Lib $VER 1.0 on the AMOS PD CD (APD452/APSystem), 49 keywords whose names are all in this table and whose token IDS ARE IDENTICAL to it. The AMOS 1.3 Music at 38 keywords IS registered, as music-1.62, because its ids genuinely differ.',
  },
  {
    id: 'amospro-compact-2.0',
    name: 'Compact',
    slot: 2,
    file: 'AMOSPro_Compact.Lib',
    earlier:
      'An earlier build exists and is deliberately NOT registered: Compact.Lib $VER 1.2 from the Amiga Computing issue 66 coverdisk, same three keyword names and the same token ids.',
  },
  {
    id: 'amospro-request-2.0',
    name: 'Request',
    slot: 3,
    file: 'AMOSPro_Request.Lib',
    earlier:
      'An earlier build exists and is deliberately NOT registered: Request.Lib $VER 1.41 from the Amiga Computing issue 66 coverdisk, same three keyword names and the same token ids.',
  },
  { id: 'amospro-compiler-2.0', name: 'Compiler', slot: 5, file: 'AMOSPro_Compiler.Lib' },
  {
    id: 'amospro-ioports-2.0',
    name: 'IOPorts',
    slot: 6,
    file: 'AMOSPro_IOPorts.Lib',
    earlier:
      'An earlier build exists and is deliberately NOT registered: AMOSPro_IOPorts.Lib $VER 1.0 on the AMOS PD CD (APD452/APSystem), 39 entries, same names and same token ids. The AMOS 1.3 Serial.Lib 1.2 IS registered, as serial-1.2, because AMOS Pro folded serial, parallel and printer into one extension and renumbered, so its ids do differ.',
  },
]

/**
 * Why an earlier build can be the wrong thing to register.
 *
 * Identification works from the token IDS a program used, because a tokenised
 * program records (slot, id) and never a name. Two builds that share every id
 * are therefore indistinguishable in a program, no matter how their keywords
 * are spelled — so a second registry entry for one can never win an
 * identification, and can only turn `exact` into `probable` or `ambiguous`.
 *
 * Measured, not assumed: registering five such builds took Intuition's own
 * identification from exact to probable and cost it its `best` candidate
 * altogether, which ext.test.ts caught. They are recorded here on the sibling
 * instead, which loses no knowledge and keeps identification sharp.
 */

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

const infos: ExtensionInfo[] = []
const tables = new Map<string, TokenEntry[]>()

for (const { id, name, slot, file, earlier } of STOCK) {
  const raw = readFileSync(join(sys, file))
  const lib = parseAmosLib(raw)
  tables.set(id, lib.tokens)
  infos.push({
    id,
    name,
    version: '2.0',
    author: 'Europress Software',
    origin: 'stock',
    format: 'ap20',
    evidence: 'source',
    idBaseEvidence: 'calibrated',
    defaultSlot: slot,
    observedSlots: [slot],
    titleStrings: [],
    sha256: sha(raw),
    provenance: `AMOS Professional system disc (APSystem/${file}); slot ${slot} per +Interpreter_Config.s message ${15 + slot}.`,
    notes:
      'Ships with AMOS Professional and is assigned this slot by the stock interpreter config, so in practice it is always found there — but the slot is still only a config entry a user may change.' +
      (earlier === undefined ? '' : ` ${earlier}`),
  })
}

for (const file of readdirSync(manifestDir).sort()) {
  if (!file.endsWith('.json')) continue
  const m = JSON.parse(readFileSync(join(manifestDir, file), 'utf8'))
  const dir = m.id
  if (!existsSync(join(extDir, dir))) {
    console.warn(`skipping ${m.id}: fixtures/extensions/${dir} not present`)
    continue
  }
  let tokens: TokenEntry[]
  let hash = m.sha256 ?? ''
  if (m.source === 'tokens') {
    const src = readFileSync(join(extDir, dir, m.tokenSource), 'latin1')
    tokens = tokensFromSource(src, { defines: m.assembleDefines ?? [] })
    const base = m.idBase ?? 0
    if (base !== 0) tokens = tokens.map((t) => ({ ...t, id: t.id + base }))
    hash = sha(Buffer.from(src, 'latin1'))
  } else {
    const raw = readFileSync(join(extDir, dir, m.library))
    const lib = m.format === 'ap20' ? parseAmosLib(raw) : parseAmosLibOld(raw)
    tokens = lib.tokens
    hash = sha(raw)
  }
  tables.set(m.id, tokens)
  infos.push({
    id: m.id,
    name: m.name,
    version: m.version,
    author: m.author ?? 'unknown',
    origin: 'third-party',
    format: m.source === 'tokens' ? 'source' : m.format,
    evidence: m.evidence,
    idBaseEvidence: m.idBaseEvidence,
    defaultSlot: m.recommendedSlot,
    observedSlots: m.observedSlots ?? [],
    titleStrings: m.titleStrings ?? [],
    sha256: hash,
    provenance: `${m.provenance?.from ?? ''} ${m.provenance?.note ?? ''}`.trim(),
    notes: m.notes ?? '',
  })
  console.log(`${m.id}: ${tokens.length} tokens (${tokens.filter((t) => t.name).length} named)`)
}

let out = `// GENERATED by src/cli/genext.ts — do not edit.
//
// Extension token tables keyed by extension IDENTITY. A slot number is a
// per-installation index into the interpreter config, so it is never an
// identity: see docs/extensions/README.md and src/ext/identify.ts.
import type { TokenEntry } from '../tokens/libtok'
import type { ExtensionInfo } from './registry'

export const EXT_TABLES: Record<string, TokenEntry[]> = {
`
for (const [id, toks] of tables) {
  out += `  ${JSON.stringify(id)}: [\n`
  for (const t of toks) {
    out += `    { id: 0x${t.id.toString(16).padStart(4, '0')}, name: ${JSON.stringify(t.name)}, spec: ${JSON.stringify(t.spec)}, instr: 0x${(t.instr >>> 0).toString(16)}, func: 0x${(t.func >>> 0).toString(16)} },\n`
  }
  out += `  ],\n`
}
out += `}

export const EXT_INFO: ExtensionInfo[] = ${JSON.stringify(infos, null, 2).replace(/\n/g, '\n')}
`
writeFileSync(join(root, 'src', 'ext', 'tables.gen.ts'), out)
console.log(`wrote src/ext/tables.gen.ts: ${tables.size} extensions`)
