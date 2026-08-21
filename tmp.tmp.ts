import { readFileSync } from 'node:fs'
import { extensionById } from './src/ext/registry'
import { parseAmosLib, parseAmosLibOld } from './src/tokens/libtok'
const reg = extensionById('intuition-1.3b')!
for (const f of ['Intuition.lib', 'Intuition.lib-AMOS1.3']) {
  const bytes = readFileSync(`fixtures/extensions/intuition-1.3b/${f}`)
  let got: ReturnType<typeof parseAmosLib> | null = null
  for (const fn of [parseAmosLib, parseAmosLibOld]) {
    try { got = fn(new Uint8Array(bytes)); break } catch { /* try the other layout */ }
  }
  if (!got) { console.log(f, 'neither layout read it'); continue }
  const mine = got.tokens.filter(t => t.name.trim() !== '')
  const theirs = reg.tokens.filter(t => t.name.trim() !== '')
  console.log(`${f}: ${mine.length} named tokens vs registry ${theirs.length}`)
  let diff = 0
  const byId = new Map(mine.map(t => [t.id, t]))
  for (const t of theirs) {
    const m = byId.get(t.id)
    if (!m) { if (diff++ < 5) console.log('  registry id not in binary:', t.id, JSON.stringify(t.name)); continue }
    if (m.name.trim().toLowerCase() !== t.name.trim().toLowerCase() || m.spec !== t.spec) {
      if (diff++ < 5) console.log(`  id ${t.id}: binary ${JSON.stringify(m.name)}/${JSON.stringify(m.spec)} vs registry ${JSON.stringify(t.name)}/${JSON.stringify(t.spec)}`)
    }
  }
  console.log('  differences:', diff)
}
