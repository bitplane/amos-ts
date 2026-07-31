import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * TFT 0.6, against its own binary and the comments in its eight demos — the
 * shipped doc is a syntax list and stops before it says what anything does.
 * Routine numbers and addresses are the ones in src/runtime/tft.ts.
 */
const table = new TokenTable(CORE_TOKENS)
/** the slot the doc names: "auf Platz 25 `AMOSPro_tft.lib`" */
const TFT_SLOT = 25
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [TFT_SLOT, extensionById('tft-0.6')!.table] as const,
])

function run(src: string, frames = 200): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 2_000_000,
    extensions,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(frames)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt }
}
const val = (expr: string): string => run(`Print ${expr}`).out.trim()

describe('the word splitters take a VALUE, not an address', () => {
  it('Get High Word is the value divided by $10000', () => {
    // the doc writes `a=Get High Word(_adr)`, but $7ae is `and.l
    // #$ffff0000,d3 / swap d3` and the demo agrees: "Entspricht -
    // High=Wert/$10000"
    expect(val('Get High Word($12345678)')).toBe('4660') // $1234
    expect(val('Get Low Word($12345678)')).toBe('22136') // $5678
  })

  it('the high word comes back unsigned', () => {
    expect(val('Get High Word($FFFF0000)')).toBe('65535')
    expect(val('Get Low Word(-1)')).toBe('65535')
  })

  it('Var Mask is a plain 32-bit AND of its two arguments', () => {
    expect(val('Var Mask($FF00FF00,$12345678)')).toBe(String(0x12005600))
  })

  it('Tft Version is the constant 6', () => {
    expect(val('Tft Version')).toBe('6')
  })
})

describe('Qsort (routine 20)', () => {
  /** poke the values in, sort, and read them back through Leek */
  const sortDemo = (values: number[], first: number, last: number): number[] => {
    const { out } = run(
      [
        `Reserve As Work 10,${values.length * 4 + 16}`,
        ...values.map((v, i) => `Loke Start(10)+${i * 4},${v}`),
        `Qsort Start(10),${first},${last}`,
        `For I=0 To ${values.length - 1} : Print Leek(Start(10)+I*4) : Next I`,
      ].join('\n'),
    )
    return out.trim().split('\n').map((n) => parseInt(n.trim(), 10))
  }

  it('sorts an array of longs ascending', () => {
    expect(sortDemo([5, 3, 9, 1, 7], 0, 4)).toEqual([1, 3, 5, 7, 9])
  })

  it('the compare is signed — `cmp.l`, not `cmpa`', () => {
    expect(sortDemo([3, -1, 2, -5], 0, 3)).toEqual([-5, -1, 2, 3])
  })

  it('first and last are ELEMENT indices, and the range is respected', () => {
    // qsort_1_array calls `Qsort Varptr(TEST(0)),0,20` over Dim TEST(20)
    expect(sortDemo([9, 5, 1, 8, 2], 1, 3)).toEqual([9, 1, 5, 8, 2])
  })

  it('a zero address is error 11', () => {
    expect(() => run('Qsort 0,0,4')).toThrow(/error 11/)
  })

  it('an already-sorted array and a single element are left alone', () => {
    expect(sortDemo([1, 2, 3], 0, 2)).toEqual([1, 2, 3])
    expect(sortDemo([4, 4, 4, 4], 0, 3)).toEqual([4, 4, 4, 4])
  })
})

describe('the five VBL timers', () => {
  it('count UP from the Init value, once a frame, only while started', () => {
    // timer.amos: `Init Timer 1,100 ... Start Timer 1 ... Until Get Timer(1)=500`
    const { rt } = run(
      ['Init Timer 1,100', 'Init Timer 2,200', 'Start Timer 1', 'Wait 10'].join('\n'),
      60,
    )
    expect(rt.tft.timers[0]!.count).toBeGreaterThan(100)
    expect(rt.tft.timers[1]!.count).toBe(200) // never started
  })

  it('do NOT need Start Int — the demos never call it', () => {
    const { rt } = run(['Init Timer 3,0', 'Start Timer 3', 'Wait 5'].join('\n'), 40)
    expect(rt.tft.intOn).toBe(false)
    expect(rt.tft.timers[2]!.count).toBeGreaterThan(0)
  })

  it('Stop Timer freezes the count and Get Timer reads it back', () => {
    const { out } = run(
      ['Init Timer 4,7', 'Start Timer 4', 'Wait 3', 'Stop Timer 4', 'A=Get Timer(4)', 'Wait 3', 'Print Get Timer(4)=A'].join('\n'),
      60,
    )
    expect(out.trim()).toBe('-1')
  })

  it('the number must be 1 to 5 — error 4', () => {
    for (const bad of ['Init Timer 0,1', 'Start Timer 6', 'Stop Timer 0', 'Print Get Timer(6)']) {
      expect(() => run(bad), bad).toThrow(/error 4/)
    }
    expect(() => run('Init Timer 5,1\nStart Timer 5\nStop Timer 5')).not.toThrow()
  })
})

describe('Start Int and Init Bpl Scroll, the (Privat) pair', () => {
  it('Start Int refuses until Init Bpl Scroll has run — error 5', () => {
    // tft_error.amos traps exactly this: `Trap Start Int`
    expect(() => run('Start Int')).toThrow(/error 5/)
  })

  it('a table with a zero entry is error 6', () => {
    expect(() => run(['Reserve As Work 10,64', 'Init Bpl Scroll Start(10)'].join('\n'))).toThrow(
      /error 6/,
    )
  })

  it('a filled table arms it, and then Start Int is allowed', () => {
    const { rt } = run(
      [
        'Reserve As Work 10,64',
        'For I=0 To 9 : Loke Start(10)+I*4,I+1 : Next I',
        'Init Bpl Scroll Start(10)',
        'Start Int',
      ].join('\n'),
    )
    expect(rt.tft.scrollReady).toBe(true)
    expect(rt.tft.intOn).toBe(true)
    expect(run('Reserve As Work 10,64\nFor I=0 To 9 : Loke Start(10)+I*4,I+1 : Next I\nInit Bpl Scroll Start(10)\nStart Int\nStop Int').rt.tft.intOn).toBe(false)
  })
})

describe('the CPU screen clears', () => {
  /** fill with $FF, clear, then count what survived — all through AMOS */
  const clearsBytes = (kw: string, size: number): void => {
    const { out } = run(
      [
        `Reserve As Work 10,${size + 64}`,
        `For I=0 To ${size + 8} : Poke Start(10)+I,255 : Next I`,
        `${kw} Start(10)`,
        `S=0 : For I=0 To ${size - 1} : S=S+Peek(Start(10)+I) : Next I`,
        'Print S',
        `Print Peek(Start(10)+${size})`,
      ].join('\n'),
      2000,
    )
    const [sum, past] = out.trim().split('\n').map((n) => n.trim())
    expect(sum, 'every byte in range cleared').toBe('0')
    expect(past, 'the byte past the end untouched').toBe('255')
  }

  it('Cpu Clear Ntsc clears 8,000 bytes — 200 lines', () => {
    clearsBytes('Cpu Clear Ntsc', 0x1f40)
  })

  it('Cpu Clear Pal clears 10,240 bytes — 256 lines', () => {
    clearsBytes('Cpu Clear Pal', 0x2800)
  })

  it('an address below $1000 is refused — error 10', () => {
    // the demo: "`adr` muss eine Adresse groesser $1000 sein um das
    // versehentliche loeschen des Boot bereichs zu verhindern"
    expect(() => run('Cpu Clear Ntsc 16')).toThrow(/error 10/)
    expect(() => run('Cpu Clear Pal 16')).toThrow(/error 10/)
  })

  it('plain Cpu Clear has no routine to call — error 12', () => {
    // nothing in the twenty-two keywords ever writes workspace+$132
    expect(() => run('Cpu Clear $20000')).toThrow(/error 12/)
  })
})

describe('Set Bpl builds copper MOVEs for the bitplane pointers', () => {
  it('two longwords a plane, starting at BPL1PTH, and it returns the end', () => {
    const { out } = run(
      [
        'Reserve As Work 10,64', // the plane list
        'Reserve As Work 11,64', // the copper list
        'Loke Start(10),$71234',
        'Loke Start(10)+4,$85678',
        'E=Set Bpl(Start(11),0,Start(10),2)',
        'Print E-Start(11)',
        'For I=0 To 3 : Print Hex$(Leek(Start(11)+I*4)) : Next I',
      ].join('\n'),
    )
    const lines = out.trim().split('\n').map((n) => n.trim())
    expect(lines[0]).toBe('16') // 2 planes * 2 longs
    expect(lines.slice(1)).toEqual(['$E00007', '$E21234', '$E40008', '$E65678'])
  })

  it('the offset is added to every plane address', () => {
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Reserve As Work 11,64',
        'Loke Start(10),$1000',
        'E=Set Bpl(Start(11),$40,Start(10),1)',
        'Print Hex$(Leek(Start(11)+4))',
      ].join('\n'),
    )
    expect(out.trim()).toBe('$E21040')
  })
})

describe('what the library cannot answer', () => {
  it('Tft Error$ is empty — TFT never shipped the message table it reads', () => {
    // the keyword exists because AMOS's Error$ says nothing for an
    // extension's errors, and TFT then shipped no messages of its own
    expect(val('Tft Error$($1904)')).toBe('')
    expect(val('Tft Error$(0)')).toBe('')
  })

  it('Init Cpu Clear returns zero, and its table is never filled', () => {
    expect(val('Init Cpu Clear(1,1,0)')).toBe('0')
  })
})
