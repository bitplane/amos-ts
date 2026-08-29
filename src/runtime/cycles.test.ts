import { describe, expect, it } from 'vitest'
import { TOKEN_CYCLES } from './cycles.gen'
import { CORE_TOKENS } from '../tokens/tables.gen'

/**
 * The generated table is the cost model's evidence, so these check the shape it
 * has to keep. Regenerating it needs the corpus (`npm run cli -- src/cli/gencycles.ts
 * --write`); these run against the committed file and so run everywhere.
 */
describe('token cycle table', () => {
  const id = (name: string): number => {
    const t = CORE_TOKENS.find((t) => t.name.trim() === name)
    if (!t) throw new Error(`no core token named ${name}`)
    return t.id
  }
  const cost = (name: string): number => {
    const c = TOKEN_CYCLES[id(name)]
    if (!c) throw new Error(`no cycles for ${name}`)
    return Math.max(c.instr ?? 0, c.func ?? 0)
  }

  it('covers every core token', () => {
    expect(Object.keys(TOKEN_CYCLES)).toHaveLength(CORE_TOKENS.length)
    for (const t of CORE_TOKENS) expect(TOKEN_CYCLES[t.id]).toBeDefined()
  })

  it('holds finite, non-negative cycle counts', () => {
    for (const [k, v] of Object.entries(TOKEN_CYCLES)) {
      for (const n of [v.instr, v.func]) {
        if (n === null) continue
        expect(Number.isFinite(n), `token ${k}`).toBe(true)
        expect(n, `token ${k}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  /**
   * The point of the table. A flat per-statement cost charged `Bob` and `Next`
   * the same 206 cycles; on the machine `Bob` walks the bob list and poses the
   * object where `Next` reads three longs off the loop stack and returns.
   */
  it('separates keywords a flat statement cost could not', () => {
    expect(cost('bob')).toBeGreaterThan(cost('next'))
    expect(cost('print')).toBeGreaterThan(cost('next'))
    expect(cost('inc')).toBeGreaterThan(cost('wait vbl') / 2)
  })

  /** `Next` reads 20(a3), 12(a3), 16(a3), adds and compares: +ILib.s:2115. */
  it('costs Next as the short loop-stack path it is', () => {
    expect(cost('next')).toBeGreaterThan(100)
    expect(cost('next')).toBeLessThan(300)
  })

  /** Routines that loop over their data report a floor, not a total. */
  it('flags the data-dependent routines', () => {
    expect(TOKEN_CYCLES[id('print')]?.loops).toBe(true)
  })
})
