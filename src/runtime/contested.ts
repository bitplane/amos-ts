/**
 * Which keyword names more than one product claims, and how urgent each is.
 *
 * This was the body of ../cli/contested.ts, which printed it and stopped
 * there. It moved here so a TEST can assert on it: the report told anyone who
 * ran it that AMCAF's `Blitter Copy` was answering with Personnal's handler,
 * and nothing made anyone run it.
 *
 * ## Why the existing guard did not catch that
 *
 * `keywordLayerCollisions` in ./instr.ts compares the handler tables — two
 * ports that both DEFINE a name. It is blind to the case here, where only one
 * side has a handler and the other side's programs silently get it. The
 * collision is in the TOKEN TABLES, which exist for every extension whether or
 * not anyone has ported it, and that is the earlier and more useful place to
 * look.
 *
 * ## The tiers
 *
 * `live` is the one that can be misdispatching today: two PORTED products
 * claim the name and something implements it, so one handler is answering for
 * both. `armed` becomes live the moment the other side is ported, or the
 * moment somebody implements a name both ported products currently leave
 * alone. `latent` is two unported products and costs nothing yet.
 *
 * A live name is only correct when some port has DECLARED it — moved it onto a
 * slot-qualified key with `qualified`, so it resolves by the slot the program
 * bound rather than by first-wins. `undeclaredLive()` is that invariant, and
 * ./contested.test.ts fails the build on it.
 */
import { CORE_TOKENS } from '../tokens/tables.gen'
import { TokenTable } from '../tokens/stream'
import { tokenize } from '../tokens/tokenizer'
import { allExtensions } from '../ext/registry'
import { Runtime } from './runtime'
import { extensionImpls, makeAllInstructions, makeAllFunctions } from './instr'

export type Tier = 'live' | 'armed' | 'latent'

export interface Contested {
  name: string
  /** the products claiming it, core first then alphabetical */
  products: string[]
  tier: Tier
  /** some port has moved it onto a slot-qualified key */
  declared: boolean
  /** something answers it today */
  implemented: boolean
}

export interface ContestedReport {
  rows: Contested[]
  /** product -> the registry ids under it */
  releases: Map<string, string[]>
  /** product -> every name any of its releases defines */
  claims: Map<string, Set<string>>
  ported: Set<string>
  /** the number of distinct keyword names across every product */
  distinct: number
}

/**
 * The product an identity belongs to: everything before the trailing version.
 *
 * `jd-colour-1.4` -> `jd-colour`, `sticks-1.01b` -> `sticks`. The version is a
 * dash followed by a digit and whatever letters and dots follow it, which is
 * the shape every id in the registry uses.
 */
const stem = (id: string): string => id.replace(/-\d[\w.]*$/, '')

/** keyword names out of a token table: no arity variants, no `!` prefixes */
function tokenNames(defs: Array<{ name: string }>): Set<string> {
  const out = new Set<string>()
  for (const e of defs) {
    const n = e.name.replace(/^!/, '').trim().toLowerCase()
    if (n !== '') out.add(n)
  }
  return out
}

export function contestedReport(): ContestedReport {
  /**
   * Stems the ports have declared to be the same product, mapped onto one
   * name. An `ExtensionImpl` listing several ids asserts that one body of code
   * serves them all, which is stronger than any string comparison — it is the
   * thing the stem heuristic is trying to guess. Personnal is why it is
   * needed: the registry calls its releases `personal-1.0b` and
   * `personnal-1.1`, because the library spells its own name both ways.
   */
  const alias = new Map<string, string>()
  for (const impl of extensionImpls()) {
    const canon = stem(impl.ids[0] ?? '')
    for (const id of impl.ids) alias.set(stem(id), canon)
  }
  const product = (id: string): string => alias.get(stem(id)) ?? stem(id)

  const claims = new Map<string, Set<string>>()
  const add = (p: string, ns: Set<string>): void => {
    const set = claims.get(p) ?? new Set<string>()
    for (const n of ns) set.add(n)
    claims.set(p, set)
  }

  // the core vocabulary is a product too, and the most dangerous one: an
  // extension that redefines `Cls` breaks programs that never asked for it
  add('AMOS core', tokenNames(CORE_TOKENS))
  const releases = new Map<string, string[]>()
  for (const ext of allExtensions()) {
    const p = product(ext.id)
    add(p, tokenNames(ext.tokens))
    releases.set(p, [...(releases.get(p) ?? []), ext.id])
  }

  const ported = new Set<string>()
  const declared = new Set<string>()
  for (const impl of extensionImpls()) {
    for (const id of impl.ids) ported.add(product(id))
    for (const n of impl.qualified ?? []) declared.add(n)
  }
  ported.add('AMOS core')

  const coreTable = new TokenTable(CORE_TOKENS)
  const rt = new Runtime(tokenize('', coreTable), coreTable, {})
  const implemented = new Set(
    [...Object.keys(makeAllInstructions(rt)), ...Object.keys(makeAllFunctions(rt))].map((n) =>
      n.replace(/^ext\d+:/, ''),
    ),
  )

  const owners = new Map<string, string[]>()
  for (const [p, ns] of claims) for (const n of ns) owners.set(n, [...(owners.get(n) ?? []), p])

  const rank = (p: string): string => (p === 'AMOS core' ? ' ' : p)
  const rows = [...owners]
    .filter(([, ps]) => ps.length > 1)
    .map(([name, ps]) => {
      const n = ps.filter((p) => ported.has(p)).length
      const impl = implemented.has(name)
      const tier: Tier = n > 1 ? (impl ? 'live' : 'armed') : n === 1 ? 'armed' : 'latent'
      return {
        name,
        products: ps.sort((a, b) => rank(a).localeCompare(rank(b))),
        tier,
        declared: declared.has(name),
        implemented: impl,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return { rows, releases, claims, ported, distinct: owners.size }
}

/**
 * The invariant: a live contested name that nobody has qualified.
 *
 * Two ported products spell it the same way, something implements it, and
 * dispatch is by name — so one product's handler is answering for the other's
 * programs, in every program, with no error. The fix is a `qualified`
 * declaration in ./instr.ts, which registers it as `ext<slot>:<name>` and
 * resolves by the slot the program actually bound.
 */
export function undeclaredLive(): Contested[] {
  return contestedReport().rows.filter((r) => r.tier === 'live' && !r.declared)
}
