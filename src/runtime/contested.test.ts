import { describe, expect, it } from 'vitest'
import { contestedReport, undeclaredLive } from './contested'

/**
 * Live contested names that are knowingly left on first-wins.
 *
 * This exists so the list is a DECISION rather than an oversight, and it should
 * stay empty. A name belongs here only when both products mean the same thing
 * by it and one handler genuinely serves both — not when nobody has got round
 * to the other side.
 */
const ALLOWED_UNDECLARED = new Set<string>([
  /**
   * AMCAF 1.50 added these deliberately as the Music extension's, and said so:
   *
   *   V1.43 02-Nov-96
   *   - Added Sload/Ssave. Just the same commands like in the music
   *     extension. Now you can really remove it!
   *
   * So one handler answering for both is the author's intent rather than an
   * accident, and a slot-qualified pair would give AMCAF programs a second
   * implementation of something he wrote to BE the first one. 1.40 does not
   * have them at all.
   */
  'sload',
  'ssave',
])

describe('contested keyword names', () => {
  /**
   * The guard that was missing.
   *
   * `keywordLayerCollisions` compares HANDLER tables, so it only fires when two
   * ports both define a name. It is blind to the commoner and quieter case:
   * one port implements a name, another product's token table also has it, and
   * that product's programs silently get the first port's handler.
   *
   * AMCAF's `Blitter Copy` was exactly that for the whole of its port —
   * `srcscreen,srcplane To dstscreen,dstplane[,minterm]` dispatching into
   * Personnal's address form. The report knew; nothing made anyone read it.
   */
  it('every live contested name has been qualified by some port', () => {
    const undeclared = undeclaredLive().filter((r) => !ALLOWED_UNDECLARED.has(r.name))
    const detail = undeclared.map((r) => `  ${r.name} — claimed by ${r.products.join(', ')}`).join('\n')
    expect(
      undeclared.map((r) => r.name),
      undeclared.length === 0
        ? ''
        : `these names are claimed by two PORTED products and something implements them, ` +
            `so one handler is answering for both:\n${detail}\n` +
            `Declare the name in \`qualified\` on the owning ExtensionImpl in instr.ts, ` +
            `which binds it to the slot the program actually loaded.`,
    ).toEqual([])
  })

  it('ALLOWED_UNDECLARED does not name something already fixed', () => {
    const live = new Set(contestedReport().rows.filter((r) => r.tier === 'live' && !r.declared).map((r) => r.name))
    for (const n of ALLOWED_UNDECLARED) expect(live, `${n} is no longer undeclared — drop it`).toContain(n)
  })

  it('the report can still describe itself', () => {
    const { rows, distinct, ported } = contestedReport()
    expect(distinct).toBeGreaterThan(1000)
    expect(rows.length).toBeGreaterThan(0)
    expect(ported.has('AMOS core')).toBe(true)
    // every row really is contested, and the tiers are exhaustive
    for (const r of rows) {
      expect(r.products.length).toBeGreaterThan(1)
      expect(['live', 'armed', 'latent']).toContain(r.tier)
    }
  })
})
