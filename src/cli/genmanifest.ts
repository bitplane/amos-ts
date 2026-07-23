/**
 * Generate KEYWORDS.md — the coverage manifest: every keyword in the
 * token tables classified faithful / approximated / missing / n-a.
 *
 *   npm run cli -- src/cli/genmanifest.ts
 */
import { writeFileSync } from 'node:fs'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { INSTR, FUNCS, RAWFUNCS } from '../interp/builtins'
import { makeInstructions, makeFunctions, makeRawFunctions } from '../runtime/instr'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/tokenizer'
import { FAITHFUL, NA, NOTES, STRUCTURAL } from '../coverage/status'

const EXT_NAMES: Record<number, string> = { 1: 'Music', 2: 'Compact', 3: 'Request', 5: 'Compiler', 6: 'IOPorts' }

const table = new TokenTable(CORE_TOKENS)
const rt = new Runtime(tokenize('', table), table, {})
const implemented = new Set([
  ...Object.keys(INSTR),
  ...Object.keys(FUNCS),
  ...Object.keys(makeInstructions(rt)),
  ...Object.keys(makeFunctions(rt)),
  ...Object.keys(RAWFUNCS),
  ...Object.keys(makeRawFunctions(rt)),
])

function keywordNames(defs: Array<{ name: string }>): string[] {
  const out = new Set<string>()
  for (const e of defs) {
    const n = e.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') out.add(n)
  }
  return [...out].sort()
}

type Status = 'faithful' | 'approximated' | 'missing' | 'n/a'

function classify(name: string): Status {
  if (NA.has(name)) return 'n/a'
  // structural glue tokens (`:`, `(`, `then`, `step`, ...) are pure syntax
  // the parser handles exactly — faithful by construction
  if (STRUCTURAL.has(name)) return 'faithful'
  if (implemented.has(name)) return FAITHFUL.has(name) ? 'faithful' : 'approximated'
  return 'missing'
}

/** rough functional area, for rollups */
function area(name: string): string {
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

const rows: Row[] = []
for (const n of keywordNames(CORE_TOKENS.filter((e) => e.id >= 0x54))) {
  rows.push({ name: n, status: classify(n), ext: 'core', note: NOTES[n] ?? '' })
}
for (const [slot, defs] of EXTENSION_TOKENS) {
  for (const n of keywordNames(defs)) {
    if (rows.some((r) => r.name === n)) continue
    rows.push({ name: n, status: classify(n), ext: EXT_NAMES[slot] ?? `ext${slot}`, note: NOTES[n] ?? '' })
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

let md = `# Keyword coverage manifest

GENERATED by \`src/cli/genmanifest.ts\` — do not edit. Classification
lives in \`src/coverage/status.ts\`; a keyword is **faithful** only when
its behaviour was verified against the original 68k source, the official
manual, or byte-exact artifacts. **approximated** = implemented and
tested against our own understanding. Percentages exclude n/a
(editor-internal tokens).

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

writeFileSync('KEYWORDS.md', md)
const done = count(rows, 'faithful') + count(rows, 'approximated')
console.log(`KEYWORDS.md written: ${rows.length} keywords, ${done} implemented (${count(rows, 'faithful')} faithful), ${count(rows, 'missing')} missing, ${count(rows, 'n/a')} n/a`)
