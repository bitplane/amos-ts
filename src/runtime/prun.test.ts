import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { MemoryFS } from '../amiga/fs'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

type Tk = string | { s: string } | { i: number }

/**
 * Assemble a minimal .AMOS file: the 16-byte signature, the source length,
 * then one record per line (length in words, indent, tokens, null token).
 * Enough for the small accessories these tests Prun.
 */
function amosFile(lines: Tk[][]): Uint8Array {
  const idOf = new Map<string, number>()
  for (const e of CORE_TOKENS) {
    const n = e.name.trim().replace(/^!/, '')
    if (!idOf.has(n)) idOf.set(n, e.id)
  }
  const body: number[] = []
  for (const line of lines) {
    const toks: number[] = []
    const u16 = (v: number): void => {
      toks.push((v >> 8) & 0xff, v & 0xff)
    }
    for (const t of line) {
      if (typeof t === 'string') {
        const id = idOf.get(t)
        if (id === undefined) throw new Error(`no such token: ${t}`)
        u16(id)
      } else if ('s' in t) {
        u16(0x0026)
        u16(t.s.length)
        for (const c of t.s) toks.push(c.charCodeAt(0))
        if (t.s.length % 2) toks.push(0)
      } else {
        u16(0x003e)
        toks.push((t.i >>> 24) & 0xff, (t.i >>> 16) & 0xff, (t.i >>> 8) & 0xff, t.i & 0xff)
      }
    }
    u16(0)
    body.push((toks.length + 2) / 2, 0, ...toks)
  }
  const out: number[] = []
  for (const c of 'AMOS Pro   V1.00') out.push(c.charCodeAt(0))
  out.push((body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff)
  out.push(...body)
  return new Uint8Array(out)
}

function boot(src: string, files: Record<string, Uint8Array>): { rt: Runtime; out: () => string } {
  const fs = new MemoryFS()
  for (const [path, bytes] of Object.entries(files)) fs.add(path, bytes)
  const text: string[] = []
  const rt = new Runtime(tokenize(src, table), table, {
    maxSteps: 200_000,
    fs,
    onText: (t) => text.push(t),
  })
  return { rt, out: () => text.join('') }
}

describe('Prun — a second program run as an accessory', () => {
  it('runs the accessory, then resumes after the Prun statement', () => {
    const { rt, out } = boot(['Print "A"', 'Prun "acc"', 'Print "C"'].join('\n'), {
      acc: amosFile([['print', { s: 'B' }]]),
    })
    rt.runHeadless(200)
    expect(out().replace(/\s+/g, ' ').trim()).toBe('A B C')
  })

  it('stops the lot when the accessory says Edit, rather than resuming the caller', () => {
    // `rErr1` (+ILib.s:1362) pulls the program stack and then jumps to
    // `Prg_JError`, so 1000 belongs to the editor and not to the caller.
    // `End` in the same place is what resumes after the Prun
    const { rt, out } = boot(['Print "A"', 'Prun "acc"', 'Print "C"'].join('\n'), {
      acc: amosFile([['print', { s: 'B' }], ['edit']]),
    })
    rt.runHeadless(200)
    expect(out().replace(/\s+/g, ' ').trim()).toBe('A B')
    expect(rt.interp.endCode).toBe(1000)
  })

  it('answers 1002 for System, which is the one code Ed_Errr sends elsewhere', () => {
    const { rt } = boot('System', {})
    rt.runHeadless(200)
    expect(rt.interp.endCode).toBe(1002)
  })

  it('gives the accessory its own bank list and restores the caller list', () => {
    // Prg_SetBanks (+Verif.s:4714) repoints Cur_Banks at the running
    // program's own array, so the caller's bank is invisible to the
    // accessory and the accessory's is gone by the time the caller resumes
    const { rt, out } = boot(['Reserve As Work 10,100', 'Prun "acc"', 'Print Length(10)'].join('\n'), {
      acc: amosFile([
        ['print', 'length', '(', { i: 10 }, ')'],
        ['reserve as work', { i: 10 }, ',', { i: 200 }],
      ]),
    })
    rt.runHeadless(200)
    expect(out().match(/-?\d+/g)).toEqual(['0', '100'])
    expect(rt.memBanks.get(10)!.data.length).toBe(100)
  })

  it('is illegal from inside an accessory (PRun_Acc, +ILib.s:1571)', () => {
    const { rt } = boot('Prun "acc"', { acc: amosFile([['prun', { s: 'acc' }]]) })
    expect(() => rt.runHeadless(200)).toThrow(/accessory/i)
  })

  it('is a file-not-found error when the program is missing', () => {
    const { rt } = boot('Prun "nope"', {})
    expect(() => rt.runHeadless(200)).toThrow(/file not found/)
  })

  it('leaves the caller variables and screens alone, and keeps the display', () => {
    // DefRunAcc, the d0=-1 arm of Prg_RunIt (+Verif.s:4398): an accessory
    // gets a semi graphic init, so the caller's screens survive both ways
    const { rt, out } = boot(
      ['A=7', 'Screen Open 1,320,100,4,Lowres', 'Prun "acc"', 'Print A'].join('\n'),
      { acc: amosFile([['print', { s: 'x' }]]) },
    )
    rt.runHeadless(200)
    expect(out()).toContain('7')
    expect(rt.screens.has(1)).toBe(true)
  })
})

describe('Run "file" leaves no state behind', () => {
  /**
   * `Run` swaps the program through replaceProgram, and three fields —
   * breakHandler, errFrameDepth, everyReturnDepth — used to be reset only by
   * pushProgram (Prun's path). So a break handler installed by the first
   * program survived into the second, naming a procedure that no longer exists.
   *
   * Prun was never affected: it saves and restores all three. Two hand-kept
   * reset lists for one operation was the actual defect; there is one now.
   */
  it('clears a break handler the previous program installed', () => {
    const rt = new Runtime(tokenize('Print "a"', table), table, { maxSteps: 100_000 })
    const i = rt.interp as unknown as {
      breakHandler: unknown
      errFrameDepth: number
      everyReturnDepth: number
    }
    i.breakHandler = { kind: 'proc', target: 'GONE' }
    i.errFrameDepth = 7
    i.everyReturnDepth = 3
    rt.runLines(tokenize('Print "b"', table))
    expect(i.breakHandler).toBeNull()
    expect(i.errFrameDepth).toBe(0)
    expect(i.everyReturnDepth).toBe(0)
  })
})

/**
 * DefRunAcc runs the extension default hooks where it skips the display
 * reinit — `Rbsr L_DefRunExtensions` (+ILib.s:403), the same call DefRun1
 * makes, over the twenty-six-slot table at ExtAdr (+Equ.s:1157) that AMCAF
 * indexes as `$f8(a5)`.
 */
describe('Prun and the extension slots', () => {
  it("runs every occupied slot's default routine before the accessory", () => {
    const { rt } = boot('Prun "acc"', { acc: amosFile([['print', { s: 'x' }]]) })
    rt.turbo.scene.iconBank = 5
    rt.runHeadless(200)
    // TURBO's +$4 puts Scene Icon Bank back to 2
    expect(rt.turbo.scene.iconBank).toBe(2)
  })
})
