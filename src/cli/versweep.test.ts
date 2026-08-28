/**
 * The standing version sweep, and the evidence that it can find anything.
 *
 * Half of this file is the check — nothing registered is a later release of
 * something ported and left unnamed. The other half is the part that makes the
 * check worth running: a sweep that reports "nothing to do" proves nothing on
 * its own, so each release this tree actually lost to a missing binding is
 * unbound again here and has to come back.
 *
 * That second half earned its place immediately. The first criterion written
 * for `sweep` required the candidate to be a strict SUPERSET of the bound
 * release, which rejects `serial-1.2` — 15 shared keywords at 15 identical
 * ids, 23 dropped, nothing added — and `serial-1.2` is one of the three cases
 * the check exists to catch.
 */
import { describe, expect, it } from 'vitest'
import { sweep } from './versweep'
import { allExtensions } from '../ext/registry'
import { extensionImpls } from '../runtime/instr'

describe('version sweep', () => {
  /**
   * The check itself.
   *
   * A failure here is not a bug in this file: it means a registered release
   * shares every id it has in common with a ported one, so naming it in that
   * port's `ids` would move it off 0% with no code written. Add the string,
   * then run `extaudit <id>` to see what the release newly makes missing.
   */
  it('no registered release is an unbound later version of a ported one', () => {
    const bindable = sweep()
      .filter((c) => c.moved === 0)
      .map((c) => `${c.id}: ${c.agree} ids agree with ${c.against}, ${c.adds} new, ${c.drops} dropped`)
    expect(bindable).toEqual([])
  })

  /**
   * `renumbered` is reported and not bound, and these three are why the
   * reason is worth printing rather than dropping.
   *
   * Not one of them is a version pair. They are different extensions that
   * happen to share one to three keyword NAMES with something ported —
   * IntuiExtend's names reaching EasyLife — and every shared name sits at a
   * different id, which is exactly what a coincidence looks like and exactly
   * what a rebuilt table looks like too. The sweep cannot tell those apart
   * and does not try; it says "read the binary" and names the file to read.
   *
   * SEVEN have left the list the same way, and it is the same way each time:
   * the sweep only looks at extensions NO port claims. Explode went on
   * 2026-08-12 (its names reaching CText were the collision this list used to
   * illustrate), DME 2.0 followed when its ProTracker block landed, gui-1.5b
   * and gui-1.61 went when gui.ts named all three GUI releases in one `ids`,
   * intuition-1.3b went on 2026-08-21 when ./intuition.ts began, and both
   * IntuiExtend releases went on 2026-08-28. gui-1.5b and gui-1.61 were the
   * only entries this list has ever held that were a
   * real lineage rather than a collision: Pietro Ghizzoni rebuilt the token
   * table for each release, so 44 of 1.5b's names and 85 of 1.61's reappear in
   * 2.10 with exactly ONE id surviving in each, which by the sweep's own
   * measure is indistinguishable from a coincidence and is the opposite.
   *
   * The list is empty now, which on its own says nothing, so the pair that
   * emptied it is unbound again and has to come back reported the same way.
   */
  it('the renumbered candidates are name collisions, not releases', () => {
    expect(sweep().filter((c) => c.moved > 0)).toEqual([])
    const renumbered = sweep(['intuiextend-1.6', 'intuiextend-2.01b']).filter((c) => c.moved > 0)
    expect(renumbered.map((c) => c.id).sort()).toEqual(['intuiextend-1.6', 'intuiextend-2.01b'])
    // a handful of names each and no id in common: a collision, not a lineage
    for (const c of renumbered) {
      expect(c.agree, c.id).toBe(0)
      expect(c.moved, c.id).toBeLessThan(5)
    }
  })

  /**
   * The three releases this tree bound late, unbound again one at a time.
   *
   * One at a time and not all at once, because these are not independent:
   * hiding both EME identities leaves the EME port with nothing to compare
   * against and the sweep rightly finds nothing.
   */
  it.each([
    ['delta-1.6', 'delta-1.4', 26, 20],
    ['serial-1.2', 'amospro-ioports-2.0', 15, 0],
    ['eme-3.0', 'amospro-music-2.0', 49, 10],
  ])('would have caught %s', (id, against, agree, adds) => {
    const hit = sweep([id]).find((c) => c.id === id)
    expect(hit, `${id} was not reported at all`).toBeDefined()
    expect(hit!.moved, `${id} must be bindable, not renumbered`).toBe(0)
    expect(hit!.against).toBe(against)
    expect(hit!.agree).toBe(agree)
    expect(hit!.adds).toBe(adds)
  })

  /**
   * And the releases that were bound on purpose, which must look bindable too.
   *
   * These are the sweep's true positives at rest. If a criterion ever stops
   * recognising `ldos-2.6` under 2.5 or `range-2.0` under 1.0, it has stopped
   * being able to find the thing it is for.
   */
  it.each(['ldos-2.6', 'range-2.0', 'amcaf-1.50', 'tome-4.23', 'jd-prt-1.3', 'delta-1.4'])(
    '%s reads as bindable when unbound',
    (id) => {
      const hit = sweep([id]).find((c) => c.id === id)
      expect(hit, `${id} was not reported at all`).toBeDefined()
      expect(hit!.moved, `${id} has a shared name at a different id`).toBe(0)
    },
  )

  /**
   * IntuiExtend is the counter-case the criterion has to keep rejecting.
   *
   * 1.6 and 2.01b are one product two releases apart. Of 294 and 301 named
   * keywords they share 284 NAMES, and only 45 of those sit at the same id,
   * because 2.01b rebuilt its table rather than appending to it. The 45 is
   * what this comment used to report as the number of shared names, which
   * made a near-total overlap read as a handful.
   *
   * Both are ported now, so the sweep no longer has to make the call; the
   * pair is still compared directly here because it is the shape a wrong
   * criterion would wave through.
   */
  it('IntuiExtend 1.6 and 2.01b share names and almost no ids', () => {
    const ids = (id: string): Map<string, number> =>
      new Map(
        allExtensions()
          .find((e) => e.id === id)!
          .tokens.map((t) => [t.name.trim().replace(/^!/, '').toLowerCase(), t.id] as const)
          .filter(([n]) => n !== ''),
      )
    const a = ids('intuiextend-1.6')
    const b = ids('intuiextend-2.01b')
    const shared = [...a.keys()].filter((n) => b.has(n))
    expect(shared.length).toBe(284)
    expect(shared.filter((n) => a.get(n) === b.get(n)).length).toBe(45)
    // and one impl claims both, which is what took them off the list above
    const bound = new Set(extensionImpls().flatMap((i) => [...i.ids]))
    expect(bound.has('intuiextend-1.6')).toBe(true)
    expect(bound.has('intuiextend-2.01b')).toBe(true)
  })
})
