/**
 * Generate KEYWORDS.md — the coverage manifest: every keyword in the
 * token tables classified faithful / approximated / missing / n-a.
 *
 *   npm run cli -- src/cli/genmanifest.ts
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { allExtensions } from '../ext/registry'
import { INSTR, FUNCS, RAWFUNCS } from '../interp/builtins'
import { makeInstructions, makeFunctions, makeRawFunctions, extensionImpls } from '../runtime/instr'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/tokenizer'
import { FAITHFUL, NA, STRUCTURAL, noteFor } from '../coverage/status'


/**
 * Where the manifest lives, resolved from THIS file rather than from the
 * working directory. `writeFileSync('KEYWORDS.md')` wrote wherever it was
 * invoked from, so running the tool out of a subdirectory silently left a
 * second copy there and the real one stale.
 */
export const MANIFEST = join(fileURLToPath(new URL('../..', import.meta.url)), 'KEYWORDS.md')

const table = new TokenTable(CORE_TOKENS)
const rt = new Runtime(tokenize('', table), table, {})
// slot-qualified handlers (`ext13:sprite col`) implement the keyword after
// the colon; see Names.qualified
const unqualify = (n: string): string => n.replace(/^ext\d+:/, '')
/**
 * A keyword a port registers only when a particular RELEASE is bound is still
 * implemented, and `rt` above has no bindings — so the alias maps have to be
 * asked directly. jd-prt 1.1 spells all 58 of its keywords without the `Jd `
 * prefix 1.3 added, and without this the manifest called a finished port 0%.
 *
 * coverage.test.ts carries the same rule; the two must agree, or the release
 * gate and the published manifest disagree about what exists.
 */
/**
 * The CORE's implemented names --- the interpreter's own builtins and the
 * runtime layers that are not an extension port.
 */
const coreImplemented = new Set(
  [
    ...Object.keys(INSTR),
    ...Object.keys(FUNCS),
    ...Object.keys(RAWFUNCS),
    ...Object.keys(makeRawFunctions(rt)),
    // the runtime's own layer --- screens, bobs, menus, banks and the rest of
    // AMOS proper. NOT the extension layers, which are credited per identity
    // below; merging the two is what made the measure wrong.
    ...Object.keys(makeInstructions(rt)),
    ...Object.keys(makeFunctions(rt)),
  ].map(unqualify),
)

/**
 * What each EXTENSION implements, keyed by registry identity.
 *
 * This used to be one flat set merged across every port, and the merge was a
 * lie: `FAITHFUL` is a set of NAMES, so an extension that had never been
 * ported was credited with any keyword whose name a ported one happened to
 * share. p61-1.2 reported 22% with no binding at all, because Personnal 1.1
 * has a `P61 Play` and a `P61 Stop` of its own. An extension with no
 * ExtensionImpl now implements nothing, whatever its table is called.
 */
/**
 * The official extensions the INTERPRETER implements rather than a port.
 *
 * Compact, Request, Compiler and most of Music shipped in the AMOS Pro box
 * and their keywords live in the runtime's own layer, not behind an
 * ExtensionImpl --- `Pack`, `Unpack`, `Request`, `Music`, `Play` and the rest
 * are simply part of what this interpreter does. They have no `ids` binding
 * to credit them from, so without this they would report 0% while working
 * perfectly. Listed explicitly, because the alternative is the flat
 * name-matching that made every other row unreliable.
 */
const CORE_EXTENSIONS = new Set([
  'amospro-compact-2.0',
  'amospro-request-2.0',
  'amospro-compiler-2.0',
  'amospro-music-2.0',
])

const extImplemented = new Map<string, Set<string>>()
for (const impl of extensionImpls()) {
  const names = [
    ...Object.keys(impl.instructions?.(rt) ?? {}),
    ...Object.keys(impl.functions?.(rt) ?? {}),
    ...Object.values(impl.aliases ?? {}).flatMap((m) => Object.keys(m)),
    // keywords the port deliberately leaves to the core handler, because the
    // extension's own author copied them from a core library and said so.
    // Credited here or the manifest reports a finished extension short and
    // points at keywords that already run; extimpl.test.ts checks the claim.
    ...(impl.viaCore ?? []),
  ].map(unqualify)
  for (const id of impl.ids) {
    const set = extImplemented.get(id) ?? new Set<string>()
    for (const n of names) set.add(n)
    extImplemented.set(id, set)
  }
}

function keywordNames(defs: Array<{ name: string }>): string[] {
  const out = new Set<string>()
  for (const e of defs) {
    const n = e.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') out.add(n)
  }
  return [...out].sort()
}

type Status = 'faithful' | 'approximated' | 'missing' | 'n/a'

/**
 * `ext` is the registry identity the keyword is being reported under, or
 * 'core'. The name alone is not enough: two extensions may spell a keyword
 * the same way and only one of them be ported.
 */
function classify(name: string, ext: string): Status {
  if (NA.has(name)) return 'n/a'
  // structural glue tokens (`:`, `(`, `then`, `step`, ...) are pure syntax
  // the parser handles exactly — faithful by construction
  if (STRUCTURAL.has(name)) return 'faithful'
  const impl =
    ext === 'core' || CORE_EXTENSIONS.has(ext)
      ? new Set([...coreImplemented, ...(extImplemented.get(ext) ?? [])])
      : (extImplemented.get(ext) ?? new Set<string>())
  if (impl.has(name)) return FAITHFUL.has(name) ? 'faithful' : 'approximated'
  return 'missing'
}

/** rough functional area, for rollups */
function area(name: string): string {
  // bare Get/Put are the random-access record keywords (Get #n / Put #n,
  // InGet/InPut +Lib.s:5294) — files, not the object-bank Get/Put family
  if (name === 'get' || name === 'put') return 'files'
  const first = name.split(' ')[0]!
  const map: Record<string, string> = {
    screen: 'screens', zoom: 'screens', appear: 'screens', view: 'screens', dual: 'screens',
    ntsc: 'screens', logic: 'screens', physic: 'screens', logbase: 'screens', phybase: 'screens',
    autoback: 'screens', default: 'screens',
    plot: 'drawing', draw: 'drawing', box: 'drawing', bar: 'drawing', circle: 'drawing',
    ellipse: 'drawing', polyline: 'drawing', polygon: 'drawing', paint: 'drawing', ink: 'drawing',
    gr: 'drawing', clip: 'drawing', point: 'drawing', set_paint: 'drawing',
    colour: 'palette', palette: 'palette', fade: 'palette', flash: 'palette', shift: 'palette',
    rain: 'rainbows', rainbow: 'rainbows',
    bob: 'objects', sprite: 'objects', paste: 'objects', get: 'objects', hot: 'objects',
    make: 'objects', no: 'objects', priority: 'objects', limit: 'objects', col: 'objects',
    bobsprite: 'objects', spritebob: 'objects', del: 'objects', ins: 'objects', put: 'objects',
    zone: 'zones', hzone: 'zones', reset: 'zones', reserve: 'banks',
    amal: 'amal', amreg: 'amal', channel: 'amal', synchro: 'amal', chanan: 'amal', chanmv: 'amal',
    amalerr: 'amal', amplay: 'amal', move: 'amal-stos', anim: 'amal-stos', movon: 'amal-stos',
    sam: 'audio', bell: 'audio', boom: 'audio', shoot: 'audio', volume: 'audio', voice: 'audio',
    vumeter: 'audio', led: 'audio', noise: 'audio', wave: 'audio', envel: 'audio', sload: 'audio', ssave: 'audio',
    music: 'music', tempo: 'music', mvolume: 'music', play: 'music', track: 'music', med: 'music', mubase: 'music',
    say: 'speech', mouth: 'speech', talk: 'speech',
    menu: 'menus', on_menu: 'menus', x_menu: 'menus',
    dialog: 'interface', vdialog: 'interface', vdialog$: 'interface', rdialog: 'interface',
    rdialog$: 'interface', edialog: 'interface', zdialog: 'interface', choice: 'interface',
    fsel$: 'interface', psel$: 'interface', hslider: 'interface', vslider: 'interface',
    resource: 'interface', resource$: 'interface', array: 'interface',
    wind: 'windows', window: 'windows', windon: 'windows', clw: 'windows', border: 'windows', title: 'windows',
    open: 'files', close: 'files', dir: 'files', mkdir: 'files', kill: 'files', rename: 'files',
    append: 'files', eof: 'files', lof: 'files', pof: 'files', field: 'files', input: 'files',
    print: 'text-io', lprint: 'text-io', using: 'text-io', locate: 'text-io', cls: 'text-io',
    home: 'text-io', pen: 'text-io', paper: 'text-io', centre: 'text-io', curs: 'text-io',
    cursor: 'text-io', cmove: 'text-io', cdown: 'text-io', cup: 'text-io', cleft: 'text-io',
    cright: 'text-io', cline: 'text-io', inverse: 'text-io', under: 'text-io', shade: 'text-io',
    text: 'text-io', tab$: 'text-io', memorize: 'text-io', remember: 'text-io', scroll: 'text-io',
    peek: 'memory', poke: 'memory', deek: 'memory', doke: 'memory', leek: 'memory', loke: 'memory',
    bset: 'memory', bclr: 'memory', bchg: 'memory', btst: 'memory', rol: 'memory', ror: 'memory',
    hunt: 'memory', fill: 'memory', copy: 'memory', varptr: 'memory', start: 'banks', length: 'banks',
    bank: 'banks', erase: 'banks', bload: 'banks', bsave: 'banks', bgrab: 'banks', bstart: 'banks',
    blength: 'banks', bsend: 'banks', list: 'banks',
    cop: 'copper', copper: 'copper',
    key: 'input', put_key: 'input', clear: 'input', scancode: 'input', scanshift: 'input',
    mouse: 'input', change: 'input', joy: 'input', jup: 'input', jdown: 'input', jleft: 'input',
    jright: 'input', fire: 'input', wait: 'flow', inkey$: 'input',
    arexx: 'system', amos: 'system', prg: 'system', run: 'system', exec: 'system', system: 'system',
    doscall: 'system', execall: 'system', gfxcall: 'system', intcall: 'system', lib: 'system',
    dev: 'system', port: 'system', areg: 'system', dreg: 'system', call: 'system', lvo: 'system',
    every: 'flow', edit: 'flow', direct: 'flow', end: 'flow', stop: 'flow',
  }
  return map[first] ?? map[name.replace(/ /g, '_')] ?? 'language'
}

interface Row {
  name: string
  status: Status
  ext: string
  note: string
}

/** Keep the manifest as an index; status.ts remains the evidence source. */
export function manifestNote(note: string | undefined): string {
  if (!note) return ''
  const sentences = note.split(/(?<=[.!?])\s+(?=(?:[A-Z`"']|NOTE|DEVIATION|DEFECT))/)
  const qualifications = sentences.filter((sentence) =>
    /\b(?:DEVIATION|DEFECT|NOTE:|manual|documentation|documented|guide|disagree|contradict|unverified|not reproduced|approximated)\b/i.test(sentence),
  )
  return [...new Set(qualifications)].join(' ')
}

const rows: Row[] = []
for (const n of keywordNames(CORE_TOKENS.filter((e) => e.id >= 0x54))) {
  rows.push({ name: n, status: classify(n, 'core'), ext: 'core', note: manifestNote(noteFor(n)) })
}
// Extensions are reported under their identity, not the slot they happened to
// occupy on somebody's machine — see docs/extensions/README.md.
/**
 * A keyword the CORE already defines is core's, and is not repeated. But two
 * EXTENSIONS may each define a keyword of the same name --- Personnal 1.1 and
 * p61-1.2 both have `P61 Play` --- and those are two keywords, in two
 * libraries, that a program reaches through two different slots. Reporting
 * only the first swallowed the other's row entirely and deflated its total.
 */
const coreNames = new Set(rows.map((r) => r.name))
for (const ext of allExtensions()) {
  for (const n of keywordNames(ext.tokens)) {
    if (coreNames.has(n)) continue
    rows.push({ name: n, status: classify(n, ext.id), ext: ext.id, note: manifestNote(noteFor(n)) })
  }
}

const byArea = new Map<string, Row[]>()
for (const r of rows) {
  const a = r.ext === 'core' ? area(r.name) : r.ext.toLowerCase()
  if (!byArea.has(a)) byArea.set(a, [])
  byArea.get(a)!.push(r)
}

const count = (rs: Row[], s: Status): number => rs.filter((r) => r.status === s).length
const pct = (rs: Row[]): string => {
  const done = count(rs, 'faithful') + count(rs, 'approximated')
  const total = rs.length - count(rs, 'n/a')
  return total === 0 ? '—' : `${Math.round((done / total) * 100)}%`
}

/**
 * Build the manifest text. Separated from writing it so `genmanifest.test.ts`
 * can compare against the committed file WITHOUT rewriting it — a check that
 * regenerates before it compares always passes and guards nothing.
 */
export function buildManifest(): string {
  let md = `# Keyword coverage manifest

GENERATED by \`src/cli/genmanifest.ts\` — do not edit. Classification
lives in \`src/coverage/status.ts\`; a keyword is **faithful** only when
its behaviour was verified against the original 68k source, the official
manual, or byte-exact artifacts. **approximated** = implemented and
tested against our own understanding. Percentages exclude n/a
(editor-internal tokens). Detailed evidence and assembly citations remain in
\`src/coverage/status.ts\`; this index includes only qualifications and known
deviations.

## Summary

| area | keywords | faithful | approximated | missing | coverage |
|---|---|---|---|---|---|
`
  const areas = [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [name, rs] of areas) {
    md += `| ${name} | ${rs.length} | ${count(rs, 'faithful')} | ${count(rs, 'approximated')} | ${count(rs, 'missing')} | ${pct(rs)} |\n`
  }
  md += `| **total** | ${rows.length} | ${count(rows, 'faithful')} | ${count(rows, 'approximated')} | ${count(rows, 'missing')} | ${pct(rows)} |\n`

  for (const [name, rs] of areas) {
    md += `\n## ${name} (${pct(rs)})\n\n`
    for (const status of ['faithful', 'approximated', 'missing', 'n/a'] as Status[]) {
      const subset = rs.filter((r) => r.status === status)
      if (subset.length === 0) continue
      md += `- **${status}**: ${subset.map((r) => r.note ? `\`${r.name}\` *(${r.note})*` : `\`${r.name}\``).join(', ')}\n`
    }
  }
  return md
}

/** the one-line summary the CLI prints, also asserted by the test */
export function manifestSummary(): string {
  const done = count(rows, 'faithful') + count(rows, 'approximated')
  return `${rows.length} keywords, ${done} implemented (${count(rows, 'faithful')} faithful), ${count(rows, 'missing')} missing, ${count(rows, 'n/a')} n/a`
}

// only when run as a script — importing this module must not write the file
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(MANIFEST, buildManifest())
  console.log(`KEYWORDS.md written: ${manifestSummary()}`)
}
