/**
 * Work out which extension a program's slot numbers actually referred to.
 *
 * A tokenised program records extension keywords as (slot, token id) with no
 * name or version attached, and the slot is only an index into the interpreter
 * config of whatever machine the program was saved on (see ./registry.ts). To
 * run someone else's program we therefore have to identify the extension from
 * the evidence the program itself carries:
 *
 *   1. The set of token ids used in that slot. A token id is the byte offset of
 *      its entry in the extension's token table, so the ids form a fingerprint
 *      of one specific table. A candidate must account for *every* observed id
 *      — one unexplained id disqualifies it outright.
 *   2. The parameter-count byte stored beside each use. Ver_Extension
 *      (+Verif.s:452-460) writes $FF there when the slot held an AP20-format
 *      library and the real argument count when it held an older one, so the
 *      byte both partitions candidates by library format and, for legacy
 *      libraries, gives a per-use arity that must agree with the candidate's
 *      parameter spec.
 *   3. Whether the ids land on entries that have usable names.
 *
 * When the evidence leaves more than one candidate standing we say so rather
 * than picking the popular one: a wrong binding silently mis-executes a
 * program, which is worse than declining to guess.
 */
import type { TokenLine, Tok, TokenTable } from '../tokens/stream'
import { allExtensions, defaultExtensionTables, extensionById, type Extension } from './registry'

/** What was seen in one slot across a program. */
export interface SlotUsage {
  slot: number
  /** token id -> the parameter-count bytes seen with it */
  uses: Map<number, Set<number>>
  /** total number of extension tokens seen in this slot */
  count: number
}

export type Confidence =
  /** Exactly one registered extension explains the evidence. */
  | 'exact'
  /** One candidate is clearly best but others are not fully excluded. */
  | 'probable'
  /** Several candidates explain the evidence equally well. */
  | 'ambiguous'
  /** Nothing in the registry explains it. */
  | 'unknown'

export interface Candidate {
  ext: Extension
  /** Fraction of distinct ids the candidate's table accounts for (0..1). */
  idCoverage: number
  /** Fraction of uses whose recorded arity agrees with the spec (0..1). */
  arityAgreement: number
  /** Fraction of resolved ids that carry a usable keyword name (0..1). */
  namedFraction: number
  score: number
  /** Why this candidate was rejected, if it was. */
  rejected?: string | undefined
}

export interface SlotIdentification {
  slot: number
  usage: SlotUsage
  confidence: Confidence
  best?: Extension | undefined
  candidates: Candidate[]
  /** Ids no candidate could resolve — the raw material for a wanted list. */
  unresolvedIds: number[]
}

/** Collect per-slot extension token usage from parsed program lines. */
export function collectUsage(lines: readonly TokenLine[]): Map<number, SlotUsage> {
  const slots = new Map<number, SlotUsage>()
  for (const ln of lines) {
    for (const t of ln.tokens as Tok[]) {
      if (t.kind !== 'ext') continue
      let u = slots.get(t.ext)
      if (!u) slots.set(t.ext, (u = { slot: t.ext, uses: new Map(), count: 0 }))
      let n = u.uses.get(t.id)
      if (!n) u.uses.set(t.id, (n = new Set()))
      n.add(t.nparams)
      u.count++
    }
  }
  return slots
}

/**
 * The number of arguments a parameter spec describes.
 *
 * The leading character is a marker, not an argument: "I" for an instruction,
 * otherwise the function's return-type code (0=int, 1=float, 2=string). What
 * follows is one code per argument, separated by "," or by "t" where the real
 * syntax uses `To` (as in `Ibar x,y To x2,y2` — spec "I0,0t0,0"). Counting the
 * separators is enough; we only need to know whether a recorded arity is
 * plausible, not to parse the call.
 */
export function specArity(spec: string): number | undefined {
  const body = spec.slice(1)
  if (body === '') return 0
  let n = 1
  for (const c of body) if (c === ',' || c === 't') n++
  return n
}

const AP20_MARKER = 0xff

/**
 * How much of the recorded-arity evidence must agree before a candidate is
 * believed. Not 1.0: a handful of variant entries carry a spec code that is
 * not a plain argument (Intuition's ten-code `Set Igadget Hslider` variant
 * records 9), so an exact-agreement rule would reject the right extension over
 * three uses in nine hundred. 0.9 keeps it a strong discriminator — a wrong
 * candidate that somehow resolved every id would still have to agree on nine
 * arities in ten — without being brittle.
 */
const ARITY_THRESHOLD = 0.9

function scoreCandidate(ext: Extension, usage: SlotUsage): Candidate {
  const ids = [...usage.uses.keys()]
  let resolved = 0
  let named = 0
  let arityChecked = 0
  let arityOk = 0

  for (const id of ids) {
    const entry = ext.tokens.find((t) => t.id === id)
    if (!entry) continue
    resolved++
    if (ext.table.name(id) !== undefined) named++
    const want = specArity(entry.spec)
    for (const npar of usage.uses.get(id)!) {
      // $FF means the library was AP20-format and the count was not recorded,
      // so it carries format evidence but no arity to check.
      if (npar === AP20_MARKER) continue
      // A zero where the keyword plainly takes arguments means the byte was
      // never written — the program was saved without a clean verify pass.
      // (Every instance of this in the corpus is in a file the extension
      // author named bug1.amos / bug2.amos.) Absence of a count, not a count.
      if (npar === 0 && want !== undefined && want > 0) continue
      arityChecked++
      if (want === undefined || want === npar) arityOk++
    }
  }

  const idCoverage = ids.length === 0 ? 0 : resolved / ids.length
  const arityAgreement = arityChecked === 0 ? 1 : arityOk / arityChecked
  const namedFraction = resolved === 0 ? 0 : named / resolved

  // The marker records the format of the library that was loaded when the
  // program was last verified, which is not necessarily the format of the copy
  // we hold: AMOS 1.3-era programs carry recorded counts for extensions that
  // shipped as AP20 libraries under AMOS Pro. So it is reported, not enforced.
  // The counts themselves remain a hard check — they are the real argument
  // count of that call and must agree with the entry's parameter spec.
  let rejected: string | undefined
  if (idCoverage < 1) rejected = `${ids.length - resolved} of ${ids.length} token ids not in its table`
  else if (arityAgreement < ARITY_THRESHOLD)
    rejected = `only ${Math.round(arityAgreement * 100)}% of recorded argument counts agree with its parameter specs`

  const score = idCoverage * 100 + arityAgreement * 10 + namedFraction
  return { ext, idCoverage, arityAgreement, namedFraction, score, rejected }
}

/** Identify the extension occupying one slot. */
export function identifySlot(usage: SlotUsage, pool: Extension[] = allExtensions()): SlotIdentification {
  const candidates = pool
    .map((e) => scoreCandidate(e, usage))
    .sort((a, b) => b.score - a.score)
  const survivors = candidates.filter((c) => !c.rejected)

  let confidence: Confidence = 'unknown'
  let best: Extension | undefined
  if (survivors.length === 1) {
    confidence = 'exact'
    best = survivors[0]!.ext
  } else if (survivors.length > 1) {
    // Prefer an extension actually observed in this slot before; otherwise the
    // evidence genuinely does not separate them.
    const seenHere = survivors.filter((c) => c.ext.observedSlots.includes(usage.slot))
    if (seenHere.length === 1) {
      confidence = 'probable'
      best = seenHere[0]!.ext
    } else {
      confidence = 'ambiguous'
      best = undefined
    }
  }

  const unresolvedIds =
    best === undefined
      ? [...usage.uses.keys()].sort((a, b) => a - b)
      : [...usage.uses.keys()].filter((id) => !best!.tokens.some((t) => t.id === id)).sort((a, b) => a - b)

  return { slot: usage.slot, usage, confidence, best, candidates, unresolvedIds }
}

export interface IdentifyOptions {
  /** Force a slot to a specific extension id, bypassing the evidence. */
  overrides?: Map<number, string>
  /** Restrict the candidate pool (used by tests). */
  pool?: Extension[]
}

/**
 * The extension token tables to run a program with.
 *
 * Slots the program's own evidence identifies win; anything left over falls
 * back to the stock interpreter config, which is the right answer for programs
 * written on an unmodified installation and a harmless one otherwise (an
 * unidentified slot has no table either way).
 */
export function extensionTablesFor(
  lines: readonly TokenLine[],
  opts: IdentifyOptions = {},
): Map<number, TokenTable> {
  const tables = defaultExtensionTables()
  for (const [slot, id] of identifyProgram(lines, opts)) {
    if (id.best) tables.set(slot, id.best.table)
  }
  return tables
}

/** Identify every extension slot a program uses. */
export function identifyProgram(
  lines: readonly TokenLine[],
  opts: IdentifyOptions = {},
): Map<number, SlotIdentification> {
  const pool = opts.pool ?? allExtensions()
  const out = new Map<number, SlotIdentification>()
  for (const [slot, usage] of collectUsage(lines)) {
    const forced = opts.overrides?.get(slot)
    if (forced !== undefined) {
      const ext = extensionById(forced)
      if (ext) {
        out.set(slot, {
          slot,
          usage,
          confidence: 'exact',
          best: ext,
          candidates: [],
          unresolvedIds: [...usage.uses.keys()].filter((id) => !ext.tokens.some((t) => t.id === id)),
        })
        continue
      }
    }
    out.set(slot, identifySlot(usage, pool))
  }
  return out
}
