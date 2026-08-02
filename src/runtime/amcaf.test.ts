import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * AMCAF (Chris Hodges), against `AMCAF.Guide` and `AMOSPro_AMCAF.Lib`
 * disassembled with `extdis amcaf-1.50`. Slice 0 proves the plumbing only:
 * identity, slot binding, and that wiring an empty port displaced nothing.
 */
const table = new TokenTable(CORE_TOKENS)
/** "Its documentation states the extension expects slot 8" */
const AMCAF_SLOT = 8
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [AMCAF_SLOT, extensionById('amcaf-1.50')!.table] as const,
])

function run(src: string | string[], onUnimplemented?: 'throw' | 'skip'): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(Array.isArray(src) ? src.join('\n') : src, table, extensions), table, {
    maxSteps: 1_000_000,
    extensions,
    ...(onUnimplemented ? { onUnimplemented } : {}),
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(200)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt }
}

describe('AMCAF identity', () => {
  it('both releases are registered and share one port', () => {
    const a = extensionById('amcaf-1.40')
    const b = extensionById('amcaf-1.50')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a!.author).toBe('Chris Hodges')
    expect(b!.author).toBe('Chris Hodges')
    expect(b!.defaultSlot).toBe(AMCAF_SLOT)
  })

  it('1.50 is 1.40 plus twelve keywords, removing none', () => {
    // which is why the 1.50 manual documents 1.40 and the author says he had
    // no time to update it -- one port can serve both
    const names = (id: string): Set<string> =>
      new Set(
        extensionById(id)!
          .tokens.filter((e) => e.name)
          .map((e) => e.name.replace(/^!/, '')),
      )
    const v140 = names('amcaf-1.40')
    const v150 = names('amcaf-1.50')
    expect([...v140].filter((n) => !v150.has(n))).toEqual([])
    expect([...v150].filter((n) => !v140.has(n))).toHaveLength(12)
    expect(v150.size).toBe(280)
  })
})

describe('the slice-0 wiring', () => {
  it('binds at slot 8: an AMCAF keyword resolves to its own name', () => {
    // the name in the error is the proof. `qsqr` is nothing core knows, so
    // it can only have come from slot 8's table -- identity, slot binding and
    // tokenisation all worked, and only the handler is missing
    expect(() => run(['Print Qsqr(4)'])).toThrow(/unimplemented function: qsqr/)
  })

  it('under the census policy it yields a typed default instead of throwing', () => {
    // 'skip' is how runreport sees past a missing keyword to count what the
    // rest of a program does. The spec's return-type code decides the type,
    // which matters for the string-returning keywords with no `$` in the name
    const { out, rt } = run(['Print Qsqr(4)', 'Print Amcaf Version$'], 'skip')
    // " 0" is AMOS's leading space for a non-negative number; the second line
    // is empty because Amcaf Version$ has spec "2" and defaults to a string
    expect(out).toBe(' 0\n\n')
    expect([...rt.interp.unimplemented.keys()].sort()).toEqual(['amcaf version$', 'qsqr'])
  })

  it('displaced nothing: the armed contested names still reach Personnal', () => {
    // the eight qualified declarations arrive with their slices. Until then
    // AMCAF must not have taken a name off a port that works. Personnal's
    // Blitter Clear zeroes a screen's planes through its control block, and
    // an empty AMCAF registering the plain name would have silenced it
    const { rt } = run([
      'Screen Open 0,320,200,2,Lowres : Ink 1 : Bar 0,0 To 9,9',
      'Blitter Clear Logbase(0)',
      'Print Point(5,5)',
    ])
    expect(rt).toBeTruthy()
  })
})
