/**
 * Which registered extensions are a later release of something already ported,
 * and would answer today if the port named them.
 *
 * ## The failure this exists to stop
 *
 * A port declares the identities it serves in `ExtensionImpl.ids`. Dispatch is
 * by keyword NAME, so the moment an id is named, every keyword that release
 * shares with the bound one is answered by code that already exists. Until it
 * is named, that release reads 0% — not because anything is missing, but
 * because nothing said the two were the same library.
 *
 * That has happened three times: EME 3.0 read 17%, `serial-1.2` read 0% and
 * `delta-1.6` read 0%, and each was fixed by adding one string. Delta was the
 * worst of them — 26 of its 46 keywords were already implemented and identical
 * in id, and the row read zero.
 *
 * NOT five times, which is what the task that asked for this file said and
 * what UNIMPLEMENTED.md is careful to separate. `p61-1.2` at 22% and
 * `amcaf-1.50` at 2% were the OPPOSITE failure: coverage counted by keyword
 * name, so porting Personnal once credited two extensions nobody had written a
 * line of, and #226 fixed the measure rather than a binding. Both stories end
 * in "a percentage was wrong", and that is the whole of what they share.
 *
 * Three times is still a pattern, and a pattern found by eye will be missed
 * the fourth time.
 *
 * ## What makes a release bindable
 *
 * Not name overlap on its own. Two releases of one product can share every
 * keyword NAME and agree on nothing else: IntuiExtend 1.6 and 2.01b share 45
 * names of 294 and put almost none of them at the same id, because 2.01b
 * rebuilt its table rather than appending to it. Binding that would hand a
 * program 2.01b's `Wb Window` and run 1.6's routine for something else.
 *
 * An id is what a tokenised program actually holds, so the test is on ids, and
 * it is exactly one thing: NO NAME THE TWO RELEASES SHARE MAY HAVE MOVED.
 *
 * Nothing else disqualifies. A candidate that adds keywords is the interesting
 * case, since the additions are real gaps the moment it binds. A candidate
 * that DROPS them is bindable too — `ldos-2.5` under 2.6, `delta-1.4` under
 * 1.6, `serial-1.2` under AMOSPro IOPorts are all strict subsets, and a
 * handler with no table entry to reach it simply never fires.
 *
 * Requiring a superset was this check's own first mistake, and the test below
 * is what caught it: `serial-1.2` is 15 shared keywords at 15 identical ids
 * with 23 dropped and nothing added, and it is one of the two releases this
 * tree actually lost to a missing binding. A criterion that rejects a case it
 * was written to find is worse than no criterion, because it reports "nothing
 * to do" with the authority of having looked.
 *
 * `renumbered` — one or more shared names at different ids — is reported and
 * not bound. It does not break dispatch, since every identity brings its own
 * table and names are what dispatch uses; what it means is that the table was
 * REBUILT, so there is no longer any reason to think the routine behind a
 * shared name is the routine the port read. That is a question for the
 * binary, and the sweep says so rather than answering it.
 *
 * Usage:
 *   npm run cli -- src/cli/versweep.ts [--all]
 *
 * `--all` also prints the candidates that were rejected, with their reason.
 */
import { allExtensions, type Extension } from '../ext/registry'
import { extensionImpls } from '../runtime/instr'

/** keyword name -> id, for one release; unnamed entries are not keywords */
function byName(ext: Extension): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of ext.tokens) {
    const name = t.name.trim().replace(/^!/, '').toLowerCase()
    if (name !== '') out.set(name, t.id)
  }
  return out
}

type Reason = 'adds' | 'subset' | 'same' | 'renumbered'

interface Candidate {
  /** the unbound registry id */
  id: string
  /** the bound id it was compared against */
  against: string
  reason: Reason
  /** names in both, at the same id */
  agree: number
  /** names in both, at DIFFERENT ids — any of these is disqualifying */
  moved: number
  /** names the candidate has and the bound release does not */
  adds: number
  /** names the bound release has and the candidate does not */
  drops: number
}

function compare(cand: Extension, bound: Extension): Candidate {
  const a = byName(cand)
  const b = byName(bound)
  let agree = 0
  let moved = 0
  for (const [name, id] of b) {
    const there = a.get(name)
    if (there === undefined) continue
    if (there === id) agree++
    else moved++
  }
  const adds = [...a.keys()].filter((n) => !b.has(n)).length
  const drops = [...b.keys()].filter((n) => !a.has(n)).length
  const reason: Reason = moved > 0 ? 'renumbered' : adds > 0 ? 'adds' : drops > 0 ? 'subset' : 'same'
  return { id: cand.id, against: bound.id, reason, agree, moved, adds, drops }
}

/**
 * Every unbound release that shares keywords with a ported one.
 *
 * Compared against every bound identity rather than against the ones whose
 * NAME looks similar, because the registry's names do not decide this: the
 * Personnal port serves `personal-1.0b` and `personnal-1.1`, spelled two ways,
 * and AMOSPro IOPorts and `serial-1.2` are one port under two products.
 *
 * The best comparison for a candidate is the bound release it agrees with
 * most; ties go to the one that adds fewest, which is the closest release.
 *
 * `pretendUnbound` is how the test proves this finds anything. A sweep whose
 * answer is "nothing to do" is worth exactly as much as the evidence that it
 * would have said otherwise, so versweep.test.ts unbinds the releases this
 * tree missed by eye and requires every one of them back.
 */
export function sweep(pretendUnbound: readonly string[] = []): Candidate[] {
  const all = allExtensions()
  const hidden = new Set(pretendUnbound)
  const boundIds = new Set(extensionImpls().flatMap((i) => [...i.ids]).filter((id) => !hidden.has(id)))
  const bound = all.filter((e) => boundIds.has(e.id))
  const out: Candidate[] = []
  for (const cand of all) {
    if (boundIds.has(cand.id)) continue
    const scored = bound
      .map((b) => compare(cand, b))
      .filter((c) => c.agree + c.moved > 0)
      .sort((x, y) => y.agree - x.agree || x.moved - y.moved || x.adds - y.adds)
    const best = scored[0]
    if (best) out.push(best)
  }
  return out.sort((x, y) => y.agree - x.agree)
}

if (process.argv[1]?.endsWith('versweep.ts')) {
  const all = process.argv.includes('--all')
  const found = sweep()
  const bindable = found.filter((c) => c.moved === 0)
  const named = new Map(allExtensions().map((e) => [e.id, e] as const))
  const line = (c: Candidate): string => {
    const e = named.get(c.id)!
    const keywords = byName(e).size
    return (
      `  ${c.id.padEnd(22)} ${String(keywords).padStart(4)} keywords | ` +
      `${String(c.agree).padStart(4)} agree with ${c.against}, ` +
      `${c.moved} moved, ${c.adds} new, ${c.drops} dropped`
    )
  }
  console.log(`BINDABLE — no shared keyword has moved id: ${bindable.length}`)
  for (const c of bindable) console.log(line(c))
  if (all) {
    const rejected = found.filter((c) => c.moved > 0)
    console.log(`\nRENUMBERED — a shared name at a different id, so read the binary first: ${rejected.length}`)
    for (const c of rejected) console.log(`${c.reason.padStart(12)}${line(c)}`)
  } else {
    console.log(`\n${found.length - bindable.length} renumbered; --all to see them`)
  }
}
