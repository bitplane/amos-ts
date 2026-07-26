import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * TURBO Plus, verified against TURBO_DocsV2.15.Asc — the extension's own
 * manual — and, where the manual is thin, against the disassembled routine.
 * Each test names which.
 *
 * Slot 12 is where the corpus and Andrew Burton's extensions list both put
 * TURBO, so that is where the tokenizer is given its table.
 */
const table = new TokenTable(CORE_TOKENS)
const TURBO_SLOT = 12
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [TURBO_SLOT, extensionById('turbo-plus-2.15')!.table] as const,
])

function run(src: string): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 200_000,
    extensions,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(2_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt }
}

describe('TURBO task priority (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Multi No sets priority 20 and Multi Yes puts it back to 0', () => {
    // The routine is SetTaskPri(FindTask(NULL), 20) — exec FindTask (-$126)
    // then SetTaskPri (-$12c) with 20 in d0 — matching the manual: "Under
    // AMOS Pro, Multi No sets the priority of AMOS Pro to 20".
    expect(run('Multi No').rt.turbo.priority).toBe(20)
    expect(run('Multi No : Multi Yes').rt.turbo.priority).toBe(0)
  })

  it('Amos Pri clamps to the documented range', () => {
    // "Value ranges from -128 to 20"
    expect(run('Amos Pri 5').rt.turbo.priority).toBe(5)
    expect(run('Amos Pri 100').rt.turbo.priority).toBe(20)
    expect(run('Amos Pri -200').rt.turbo.priority).toBe(-128)
  })
})

describe('TURBO input (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Left Click and Right Click report the mouse buttons as AMOS truth', () => {
    // Left Click disassembles to eight instructions: btst.b #6,$bfe001 —
    // CIA-A port A bit 6 — returning -1 when clear (pressed), 0 when set.
    const held = (mask: number): string => {
      let out = ''
      const rt = new Runtime(tokenize('Print Left Click;Right Click', table, extensions), table, {
        extensions,
        maxSteps: 10_000,
        onText: (t) => (out += t),
      })
      rt.input.mouseK = mask
      rt.runHeadless(10)
      return out
    }
    expect(held(0)).toBe(' 0 0\n')
    expect(held(1)).toBe('-1 0\n')
    expect(held(2)).toBe(' 0-1\n')
    expect(held(3)).toBe('-1-1\n')
  })

  it('Raw Key reads the same key state Key State does', () => {
    // "Does the same thing as the Key State function but works even if
    // multitasking is disabled. Returns true (-1) if key N is being
    // pressed." The manual's own example notes Raw Key(69) is ESC.
    let out = ''
    const rt = new Runtime(tokenize('Print Raw Key(69);Raw Key(70)', table, extensions), table, {
      extensions,
      maxSteps: 10_000,
      onText: (t) => (out += t),
    })
    rt.input.keys.add(69)
    rt.runHeadless(10)
    expect(out).toBe('-1 0\n')
  })
})

describe('TURBO Check zones (TURBO_DocsV2.15.Asc)', () => {
  // "CHECK commands are the TURBO version of AMOS Zone commands. These
  // commands are not compatible with the normal Zone commands!"
  const setup = ['Reserve Check 4', 'Set Check 0,10,10 To 50,50', 'Set Check 1,100,100 To 120,120']

  it('Check reports 1 inside a zone and 0 outside — not AMOS truth', () => {
    // "Returns 1 is the result is true, 0 if not" — note 1, not -1
    const { out } = run(
      [...setup, 'Print Check(0 To 3,20,20)', 'Print Check(0 To 3,200,200)', 'Print Check(0 To 3,110,110)'].join('\n'),
    )
    expect(out).toBe(' 1\n 0\n 1\n')
  })

  it('the start/end range excludes zones outside it', () => {
    // "The START and END parameters indicate which zones you want to check.
    // Ideal if there are many zones and you want to exclude some zones."
    const { out } = run([...setup, 'Print Check(0 To 0,110,110)', 'Print Check(1 To 1,110,110)'].join('\n'))
    expect(out).toBe(' 0\n 1\n')
  })

  it('Reset Check erases one definition, Check Erase all of them', () => {
    const { out } = run(
      [...setup, 'Reset Check 0', 'Print Check(0 To 3,20,20)', 'Check Erase', 'Print Check(0 To 3,110,110)'].join('\n'),
    )
    expect(out).toBe(' 0\n 0\n')
  })

  it('Set Check without reserving first is an error', () => {
    // "Execute this command before Setting any Check zones."
    expect(() => run('Set Check 0,0,0 To 10,10')).toThrow(/Illegal function call/)
  })

  it('Set Check normalises a rectangle given the other way round', () => {
    const { out } = run(['Reserve Check 1', 'Set Check 0,50,50 To 10,10', 'Print Check(0 To 0,20,20)'].join('\n'))
    expect(out).toBe(' 1\n')
  })
})

describe('TURBO timing (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Vbl Wait waits, and does not hang on any line value', () => {
    // The routine busy-waits on the low byte of VHPOSR ($dff006), which is
    // sub-frame beam racing; against a compositor that draws once a frame
    // there is no beam to race, so this waits a frame. See the NOTES entry.
    const { rt } = run('Vbl Wait 101 : Vbl Wait 0 : Vbl Wait 255')
    expect(rt.interp.done).toBe(true)
  })
})
