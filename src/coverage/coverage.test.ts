import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { INSTR, FUNCS, RAWFUNCS } from '../interp/builtins'
import { makeInstructions, makeFunctions, makeRawFunctions } from '../runtime/instr'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/tokenizer'
import { FAITHFUL, NA, STRUCTURAL } from '../coverage/status'

const table = new TokenTable(CORE_TOKENS)
const rt = new Runtime(tokenize('', table), table, {})
const registries = {
  coreInstr: Object.keys(INSTR),
  coreFuncs: Object.keys(FUNCS),
  runtimeInstr: Object.keys(makeInstructions(rt)),
  runtimeFuncs: Object.keys(makeFunctions(rt)),
  raw: [...Object.keys(RAWFUNCS), ...Object.keys(makeRawFunctions(rt))],
}
const implemented = new Set(Object.values(registries).flat())

const known = new Set<string>()
for (const e of CORE_TOKENS) {
  const n = e.name.replace(/^!/, '').trim().toLowerCase()
  if (n !== '') known.add(n)
}
for (const [, defs] of EXTENSION_TOKENS) {
  for (const e of defs) {
    const n = e.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') known.add(n)
  }
}

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
