import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  extensionImpls,
} from '../runtime/instr'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/tokenizer'
import { FAITHFUL, NA, NOTES, SHARED_NOTES, STRUCTURAL } from '../coverage/status'

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
/**
 * A keyword a port only registers when a particular RELEASE is bound is still
 * implemented. `registries` is built from a runtime with no bindings, so it
 * sees the names the port registers unconditionally and none of the ones an
 * older table brings with it — jd-prt 1.1 spells all 58 of its keywords
 * without the `Jd ` prefix 1.3 added, and those handlers appear only when 1.1
 * is the bound table. Declaring them faithful and then failing the check would
 * be the manifest contradicting the port about work the port does.
 */
const aliasNames = extensionImpls().flatMap((impl) =>
  Object.values(impl.aliases ?? {}).flatMap((m) => Object.keys(m)),
)
const implemented = new Set([...Object.values(registries).flat(), ...aliasNames].map(unqualify))
/**
 * The same set WITHOUT the qualified entries, which is the right question to
 * ask of NA. A qualified registration answers for one slot's keyword, not for
 * the plain name every other layer shares — so it cannot contradict an n/a
 * classification of that plain name.
 *
 * JD-K3's `Jd Relabel` is the case that needed this. Two libraries in the JD
 * family use the name: K3's is dos.library renaming a volume, which AmigaFS
 * can do, while the main JD library's rewrites a root block through
 * trackdisk and is n/a with the rest of that block-device family. Collapsing
 * the two would have forced a choice between overstating JD and dropping a
 * keyword that works.
 */
const implementedPlain = new Set(
  Object.values(registries)
    .flat()
    .filter((n) => !/^ext\d+:/.test(n)),
)

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

  it('every NOTES key names a real keyword', () => {
    // A note keyed to a name no keyword has is dead documentation: it never
    // reaches KEYWORDS.md and nothing says so. Three did exactly that -- the
    // Locale port's notes for `date$`, `locale string$` and `locale upper$`
    // were written through a script that escaped the '$' into the KEY as well
    // as the value, so they sat inert as `date\$` until this test was added.
    const phantom = [...Object.keys(NOTES)].filter((n) => !known.has(n))
    expect(phantom).toEqual([])
  })

  it('every SHARED_NOTES entry names a real keyword and a note that exists', () => {
    // A group whose holder loses its note documents nothing while still
    // looking documented, which is worse than the flat map was -- so both
    // ends are checked. The keyword must exist, and the name it points at
    // must actually carry a reading.
    const bad: string[] = []
    for (const [name, holder] of Object.entries(SHARED_NOTES)) {
      if (!known.has(name)) bad.push(`${name} is not a keyword`)
      if (!known.has(holder)) bad.push(`${name} points at ${holder}, which is not a keyword`)
      if (!NOTES[holder]) bad.push(`${name} points at ${holder}, which has no NOTE`)
      if (NOTES[name]) bad.push(`${name} has its own NOTE and a SHARED_NOTES entry`)
    }
    expect(bad).toEqual([])
  })

  it('NA entries are real tokens and never implemented', () => {
    const fake = [...NA].filter((n) => !known.has(n))
    expect(fake).toEqual([])
    const contradiction = [...NA].filter((n) => implementedPlain.has(n))
    expect(contradiction).toEqual([])
  })

  /**
   * UNIMPLEMENTED.md names the extensions that are not begun, and the set it
   * names must be the set that reads 0%.
   *
   * This is an assertion rather than a generator on purpose. The prose beside
   * each row says what the extension is waiting on, which is a judgement and
   * has to be written; the LIST is a fact and must not be. Kept apart, the
   * document drifts in one direction only, and it did: thirteen extensions
   * were ported without leaving the not-implemented list, and ten more were
   * registered at 0% without joining it, so the table described neither the
   * past nor the present.
   *
   * A row leaving the table is the ratchet. A row that should have left and
   * did not is the failure this catches, at the commit that ports it.
   */
  it('UNIMPLEMENTED.md names exactly the extensions that read 0%', () => {
    const doc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'UNIMPLEMENTED.md')
    if (!existsSync(doc)) return
    const text = readFileSync(doc, 'utf8')

    const zero = allExtensions()
      .filter((e) => {
        const names = e.tokens
          .map((t) => t.name.replace(/^!/, '').trim().toLowerCase())
          .filter((n) => n !== '')
        return names.length > 0 && names.every((n) => !implemented.has(n) && !NA.has(n))
      })
      .map((e) => e.id)

    // Each row names the registry id in backticks. Matching on the id rather
    // than the prose name is the difference between a check and a nuisance:
    // an id is the extension's actual identity and cannot be spelled two
    // ways, where "MAXS Door Handler" and `maxsdoor-0.20` are the same row.
    const missing = zero.filter((id) => !text.includes(`\`${id}\``))
    expect(missing, 'these read 0% and UNIMPLEMENTED.md does not list them').toEqual([])
  })
})
