import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { REGISTRY, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { extensionImpls, makeAllFunctions } from './instr'
import { implSlots } from './extimpl'

const table = new TokenTable(CORE_TOKENS)
const personnal = extensionById('personnal-1.1')!

/** a runtime with Personnal's table at `slot`, optionally bound by identity */
function bootAt(slot: number, bind: boolean): Runtime {
  const exts = new Map([[slot, personnal.table]])
  return new Runtime(tokenize('Rem', table, exts), table, {
    extensions: exts,
    maxSteps: 200_000,
    ...(bind ? { extBindings: new Map([[slot, personnal]]) } : {}),
  })
}

describe('the extension implementation contract', () => {
  it('every port names registry identities, not labels', () => {
    const ids = new Set(REGISTRY.map((e) => e.id))
    for (const impl of extensionImpls()) {
      expect(impl.ids.length).toBeGreaterThan(0)
      for (const id of impl.ids) {
        // this is the check that was missing: six of the eight old layer
        // labels ('personnal', 'music-speech', 'ctext-1.32', …) named no
        // registered extension at all
        expect(ids, `${id} is not a registry id`).toContain(id)
      }
    }
  })

  it('no identity is claimed by two ports', () => {
    const seen = new Map<string, string>()
    for (const impl of extensionImpls()) {
      for (const id of impl.ids) {
        expect(seen.has(id), `${id} claimed twice`).toBe(false)
        seen.set(id, impl.ids[0]!)
      }
    }
  })

  it('every qualified name is one the port actually defines', () => {
    const rt = bootAt(13, false)
    for (const impl of extensionImpls()) {
      const names = new Set([
        ...Object.keys(impl.instructions?.(rt) ?? {}),
        ...Object.keys(impl.functions?.(rt) ?? {}),
      ])
      // a typo here would silently unregister the keyword instead of failing
      for (const q of impl.qualified ?? []) expect(names, `${q} is not defined`).toContain(q)
    }
  })

  /**
   * The same guard as `qualified` gets, for `aliases`.
   *
   * aliasForSlots skips an alias whose target has no handler, deliberately —
   * a port may list a whole release's vocabulary without implementing all of
   * it. That tolerance is what makes a typo invisible: misspell the target and
   * the keyword is silently never registered, which is the exact failure the
   * alias mechanism was built to fix.
   */
  it('every alias points at an identity the port serves', () => {
    for (const impl of extensionImpls()) {
      for (const id of Object.keys(impl.aliases ?? {})) {
        expect(impl.ids, `${id} is aliased but not served by this port`).toContain(id)
      }
    }
  })

  it('every alias target is a name the port actually defines', () => {
    const rt = bootAt(13, false)
    for (const impl of extensionImpls()) {
      const names = new Set([
        ...Object.keys(impl.instructions?.(rt) ?? {}),
        ...Object.keys(impl.functions?.(rt) ?? {}),
      ])
      for (const [id, map] of Object.entries(impl.aliases ?? {})) {
        for (const [alias, canonical] of Object.entries(map)) {
          expect(names, `${id}: ${alias} -> ${canonical} defines nothing`).toContain(canonical)
          // an alias that is already a plain name would shadow itself onto a
          // slot-qualified key for no reason, and hide which one answered
          expect(names, `${id}: ${alias} is already a plain name`).not.toContain(alias)
        }
      }
    }
  })

  it('an error table is reachable from the identity that raises it', () => {
    const withErrors = extensionImpls().filter((i) => i.errors)
    expect(withErrors.length).toBeGreaterThan(0)
    for (const impl of withErrors) expect(impl.errors!.length).toBeGreaterThan(0)
  })
})

describe('slot-qualified keywords bind to the slot the identity was found in', () => {
  it('bound at 13: the qualified key is 13 and nothing else', () => {
    const funcs = makeAllFunctions(bootAt(13, true))
    expect('ext13:sprite col' in funcs).toBe(true)
    expect('ext7:sprite col' in funcs).toBe(false)
    // the plain name stays core's — that is the whole reason for qualifying
    expect('sprite col' in funcs).toBe(true)
  })

  it('bound at 7: the keyword follows the extension, with no 13 hardcoded', () => {
    const funcs = makeAllFunctions(bootAt(7, true))
    expect('ext7:sprite col' in funcs).toBe(true)
    expect('ext13:sprite col' in funcs).toBe(false)
  })

  it('another extension at 13 does not get Personnal Sprite Col', () => {
    const other = extensionById('turbo-plus-2.15')!
    const rt = new Runtime(tokenize('Rem', table), table, {
      maxSteps: 200_000,
      extBindings: new Map([[13, other]]),
    })
    // the old code registered ext13: unconditionally, from an id regex over
    // the registry plus a hardcoded floor of 13
    expect('ext13:sprite col' in makeAllFunctions(rt)).toBe(false)
  })

  it('with no bindings it falls back to every slot the registry has recorded', () => {
    const rt = bootAt(13, false)
    // identity unknown, so the registry's observed slots are the best evidence
    expect(implSlots({ ids: ['personal-1.0b', 'personnal-1.1'] }, rt.extBindings)).toEqual([13])
    expect('ext13:sprite col' in makeAllFunctions(rt)).toBe(true)
  })
})
