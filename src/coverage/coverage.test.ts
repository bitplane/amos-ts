import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { allExtensions } from '../ext/registry'
import { INSTR, FUNCS, RAWFUNCS } from '../interp/builtins'
import {
  makeAllInstructions,
  makeAllFunctions,
  makeRawFunctions,
  keywordLayerCollisions,
  builtinsShadowedByRuntime,
  DECLARED_BUILTIN_SHADOWS,
} from '../runtime/instr'
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
// a handler may be registered under a slot-qualified key (`ext13:sprite col`)
// when it needs its own version of a name another layer owns; the keyword it
// implements is the part after the colon. See Names.qualified.
const unqualify = (n: string): string => n.replace(/^ext\d+:/, '')
const implemented = new Set(Object.values(registries).flat().map(unqualify))

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

  it('every builtins entry the runtime overrides is a declared shadow', () => {
    // keywordLayerCollisions only scans the runtime layers, so a name defined
    // in BOTH src/interp/builtins.ts and a runtime layer was never checked. It
    // matters because Runtime.interp merges `{ ...INSTR, ...runtimeLayers }`
    // (runtime wins) while mergeLayers is first-wins, and because genmanifest
    // unions builtins with the runtime layers when deciding what is
    // implemented — so a new overlap would take coverage credit for a stub
    // that never runs in the real product.
    const shadowed = builtinsShadowedByRuntime(rt)
    const undeclared = shadowed.filter((k) => !DECLARED_BUILTIN_SHADOWS.has(k))
    expect(
      undeclared,
      'builtins entries the runtime silently overrides — either delete the ' +
        'builtins stub or add it to DECLARED_BUILTIN_SHADOWS with a reason',
    ).toEqual([])
    // and the declared set must not rot: every entry still has to be a real overlap
    const stale = [...DECLARED_BUILTIN_SHADOWS].filter((k) => !shadowed.includes(k))
    expect(stale, 'declared shadows that no longer overlap — remove them').toEqual([])
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
