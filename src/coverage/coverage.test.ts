import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { allExtensions } from '../ext/registry'
import { INSTR, FUNCS, RAWFUNCS } from '../interp/builtins'
import { makeAllInstructions, makeAllFunctions, makeRawFunctions, keywordLayerCollisions } from '../runtime/instr'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/tokenizer'
import { FAITHFUL, NA, STRUCTURAL } from '../coverage/status'

const table = new TokenTable(CORE_TOKENS)
const rt = new Runtime(tokenize('', table), table, {})
const registries = {
  coreInstr: Object.keys(INSTR),
  coreFuncs: Object.keys(FUNCS),
  runtimeInstr: Object.keys(makeAllInstructions(rt)),
  runtimeFuncs: Object.keys(makeAllFunctions(rt)),
  raw: [...Object.keys(RAWFUNCS), ...Object.keys(makeRawFunctions(rt))],
}
const implemented = new Set(Object.values(registries).flat())

const known = new Set<string>()
for (const e of CORE_TOKENS) {
  const n = e.name.replace(/^!/, '').trim().toLowerCase()
  if (n !== '') known.add(n)
}
// every registered extension, not just the stock ones: a third-party
// extension's keywords are as real as Music's, and classifying one requires
// the manifest to recognise it
for (const ext of allExtensions()) {
  for (const e of ext.tokens) {
    const n = e.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') known.add(n)
  }
}

describe('dispatch layers', () => {
  it('no two layers claim the same keyword name', () => {
    // The dispatch tables are keyed by NAME, where the machine keys core
    // keywords by token and extension keywords by (slot, id). Two layers
    // claiming one name is therefore a port-only hazard, and a silent one:
    // when Personnal's Sprite Col was added in a80e5bb it replaced core's,
    // broke two sprite tests and cost the census two programs, with no error
    // raised anywhere. mergeLayers resolves first-wins so core cannot be
    // clobbered, but a collision means two different keywords are sharing
    // one implementation and one of them is wrong. Fix it by not registering
    // the loser and recording why, as sprite col and right click are.
    expect(keywordLayerCollisions(rt)).toEqual([])
  })
})

describe('coverage manifest consistency', () => {
  it('every registered handler matches a real keyword (no dead handlers)', () => {
    const phantom = [...implemented].filter((n) => !known.has(n))
    expect(phantom).toEqual([])
  })

  it('every FAITHFUL entry is actually implemented', () => {
    const notRegistered = [...FAITHFUL].filter((n) => !implemented.has(n) && !STRUCTURAL.has(n))
    expect(notRegistered).toEqual([])
    const unknown = [...FAITHFUL].filter((n) => !known.has(n))
    expect(unknown).toEqual([])
  })

  it('NA entries are real tokens and never implemented', () => {
    const fake = [...NA].filter((n) => !known.has(n))
    expect(fake).toEqual([])
    const contradiction = [...NA].filter((n) => implemented.has(n))
    expect(contradiction).toEqual([])
  })
})
