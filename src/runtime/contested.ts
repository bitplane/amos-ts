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
  /** some port answers it on a slot-qualified key, by `qualified` or by `aliases` */
  declared: boolean
  /** something answers it today */
  implemented: boolean
  /**
   * A handler answers it under the BARE name, so any program reaches it
   * whatever it loaded. One product is allowed to hold this — it is the
   * default, and the other claimants qualify around it. What is never right is
   * an unported claimant, which has no port to qualify on and so has no way to
   * stop being answered for; see `answeredForUnported`.
   */
  plain: boolean
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
  for (const impl of extensionImpls()) for (const id of impl.ids) ported.add(product(id))
  ported.add('AMOS core')

  /**
   * Declared is asked of the DISPATCH TABLE, not of `impl.qualified`.
   *
   * Reading the declaration was the obvious way and it was wrong twice over.
   * `qualified` is not the only thing that produces a slot-qualified key:
   * `aliases` does too, and EasyLife 1.0's are why `long`, `long$`, `word`,
   * `word$`, `pp crunch`, `pp free` and `pp len` reported as undeclared
   * collisions when every one of them is already `ext16:` and reachable by
   * nothing else. Seven false alarms in a report whose whole job is to be
   * believed.
   *
   * And it answers the question that actually matters. `qualified` says a port
   * asked; the key says whether any program can still reach the name without
   * naming a slot. Those come apart whenever a port lists a name it does not
   * implement, and the second is the one a program can feel.
   */
  const coreTable = new TokenTable(CORE_TOKENS)
  const rt = new Runtime(tokenize('', coreTable), coreTable, {})
  const keys = [...Object.keys(makeAllInstructions(rt)), ...Object.keys(makeAllFunctions(rt))]
  const plain = new Set(keys.filter((n) => !/^ext\d+:/.test(n)))
  const implemented = new Set(keys.map((n) => n.replace(/^ext\d+:/, '')))
  const qualifiedKeys = new Set(keys.filter((n) => /^ext\d+:/.test(n)).map((n) => n.replace(/^ext\d+:/, '')))

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
        declared: qualifiedKeys.has(name),
        implemented: impl,
        plain: plain.has(name),
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

/**
 * The other half: a name answered under its bare spelling that a REGISTERED
 * BUT UNPORTED product also claims.
 *
 * `undeclaredLive` needs both sides ported, which is what let this through.
 * Two ported products settle a shared name between them — one keeps the bare
 * key as the default and the other qualifies, and each is served on its own
 * slots. An unported claimant cannot take either half of that deal. It has no
 * `ExtensionImpl` to declare anything on, so its programs get the other
 * product's handler under the other product's contract, and nothing in the
 * tree says so.
 *
 * That is not theoretical. `Nop` is a FUNCTION in DME 2.0 and an INSTRUCTION
 * in AMCAF; `Plane Swap` takes two arguments in Explode and three in TURBO
 * Plus; `Font Base` is `00` in Explode and `0` in CText. A program of the
 * unported product does not merely get the wrong behaviour, it gets a handler
 * that reads a different number of arguments off the stack.
 *
 * The fix is the same one, applied from the only side that can: the ported
 * product qualifies, the bare key goes away, and the unported product's
 * programs get an unimplemented keyword — which is what they have.
 */
export function answeredForUnported(): Contested[] {
  const { rows, ported } = contestedReport()
  return rows.filter((r) => r.plain && r.products.some((p) => !ported.has(p)) && r.products.some((p) => ported.has(p)))
}
