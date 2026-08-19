import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
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
  mustFinish(r)
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
  /*
   * These sort a memory BANK, and that is worth knowing about them: a bank's
   * bytes are an ordinary array, where the Varptr the demo actually passes —
   * `Qsort Varptr(TEST(0)),0,20` — is a write-through Proxy over a copy of
   * the AMOS variable. Every assertion below passed for months while the
   * keyword sorted nothing at all through the call shape it documents,
   * because the harness never used that shape. ../runtime/varptr.test.ts is
   * where the Varptr side is held now.
   */

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

describe('the hardware mouse readers ($8ec, $8f8)', () => {
  /**
   * Get Xmouse and Get Ymouse are the words TFT's interrupt leaves at +$08 and
   * +$0a of its workspace. The doc marks both "(Privat)", and they are the
   * HARDWARE position rather than AMOS's screen-relative X Mouse — so they are
   * answered from the same place this port's own hardware reads come from.
   */
  it('answer the hardware position, not the AMOS screen one', () => {
    let out = ''
    const rt = new Runtime(tokenize('Print Get Xmouse;",";Get Ymouse', table, extensions), table, {
      maxSteps: 2_000_000,
      extensions,
      onText: (t) => (out += t),
    })
    rt.input.mouseX = 300
    rt.input.mouseY = 120
    rt.runHeadless(200)
    expect(out.trim()).toBe('300, 120')
  })

  it('are words — the reads are `move.w`, so they wrap at 16 bits', () => {
    let out = ''
    const rt = new Runtime(tokenize('Print Get Xmouse', table, extensions), table, {
      maxSteps: 2_000_000,
      extensions,
      onText: (t) => (out += t),
    })
    rt.input.mouseX = 0x1_0005
    rt.runHeadless(200)
    expect(out.trim()).toBe('5')
  })
})

describe('TFT 0.7, the build that lives inside its own installer', () => {
  const tft07 = extensionById('tft-0.7')!
  const exts07 = new Map([
    ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
    [TFT_SLOT, tft07.table] as const,
  ])

  /** the same harness with 0.7 BOUND, which is what `Cpu Clear` asks about */
  function run07(src: string, frames = 200): { out: string; rt: Runtime } {
    let out = ''
    const rt = new Runtime(tokenize(src, table, exts07), table, {
      maxSteps: 2_000_000,
      extensions: exts07,
      extBindings: new Map([[TFT_SLOT, tft07]]),
      onText: (t) => (out += t),
    })
    mustFinish(rt.runHeadless(frames))
    return { out, rt }
  }
  const val07 = (expr: string): string => run07(`Print ${expr}`).out.trim()
  /** N real frames: runHeadless fast-forwards `Wait n` and runs none */
  const VBLS = (n: number): string => `For I=1 To ${String(n)} : Wait Vbl : Next I\n`

  it('shares 0.6\'s table up to id 392 and parts company after it', () => {
    const a = extensionById('tft-0.6')!.tokens
    const b = tft07.tokens
    for (let i = 0; i < 23; i++) expect([b[i]!.id, b[i]!.name, b[i]!.spec]).toEqual([a[i]!.id, a[i]!.name, a[i]!.spec])
    // id 408 is routine 27 in both, and a FUNCTION in one and an INSTRUCTION
    // in the other, so a program is portable between the builds only this far
    expect([a[23]!.id, a[23]!.name, a[23]!.spec]).toEqual([408, 'init cpu clear', '00,0,0'])
    expect([b[23]!.id, b[23]!.name, b[23]!.spec]).toEqual([408, 'init cpu clear long', 'I0,0,0'])
  })

  it('Init Cpu Clear Long fills the pointer 0.6 could never fill', () => {
    /*
     * routine 26 tests +$132 and raises error 12 on zero, and no keyword in
     * 0.6 writes it. Routine 27 in 0.7 does.
     *
     * POP ORDER. Routine 27 at $146c pops `(a3)+` three times with no save
     * first, and AMOS's first pop is the LAST argument, so d0 is `modulo`
     * and d2 is `lines`. These cases used to be written the other way round
     * and passed, because nothing here called it the way a program does:
     * TFT's own Cpu_Pervormens_Test says `Init Cpu Clear Long 256,10,0` and
     * got error 12 on the next line for the whole life of the port.
     *
     * The arithmetic is what settles it. `move.l d1,d7 / mulu.w #$4,d7 /
     * mulu.w d2,d7` puts d1*4*d2 at +$13a as the byte total, and 10*4*256 is
     * 10,240 --- one bitplane of the 320x256 screen the demo opens. The
     * other reading gives zero. `cmp.w #$e,d1` also caps d1 at 14, which no
     * line count would survive.
     */
    expect(() => run07('Cpu Clear $20000')).toThrow(/error 12/)
    expect(() => run07('Init Cpu Clear Long 20,10,0\nCpu Clear $20000')).not.toThrow()
    // and the shape the extension's own demo uses
    expect(() => run07('Init Cpu Clear Long 256,10,0\nCpu Clear $20000')).not.toThrow()
  })

  it('DEFECT: and the routine it installs clears nothing', () => {
    // the instruction it repeats comes out of a table at data+$142 that no
    // routine ever writes, so the generated code is a prologue, a run of zero
    // longwords and an rts
    const { rt } = run07('Reserve As Data 1,64\nFill Start(1) To Start(1)+63,$FFFFFFFF\nInit Cpu Clear Long 8,4,0\nCpu Clear Start(1)')
    const bank = rt.memBanks.get(1)!
    expect([...bank.data.slice(0, 8)]).toEqual([255, 255, 255, 255, 255, 255, 255, 255])
  })

  it('Init Cpu Clear Long checks its arguments and reports nothing', () => {
    // `cmp.w #$0,d1 / bls`, `cmp.w #$0,d2 / bls`, `cmp.w #$0,d0 / blt`, then
    // `cmp.w #$e,d1` with no modulo and `cmp.w #$d,d1` with one. Every failure
    // leaves +$132 zero, so Cpu Clear still raises 12.
    // written lines,length,modulo, which the routine pops as d2,d1,d0
    for (const args of ['10,0,0', '0,10,0', '10,10,-1', '10,15,0', '10,14,1']) {
      expect(() => run07(`Init Cpu Clear Long ${args}\nCpu Clear $20000`), args).toThrow(/error 12/)
    }
    // 14 longwords is the limit without a modulo and 13 with one
    expect(() => run07('Init Cpu Clear Long 10,14,0\nCpu Clear $20000')).not.toThrow()
    expect(() => run07('Init Cpu Clear Long 10,13,1\nCpu Clear $20000')).not.toThrow()
  })

  it('the three other stubs pop their arguments and do nothing', () => {
    // routine 28 is eight bytes, routine 31 is six, routine 32 is ten
    expect(run07('Init Cpu Clear Word 1,2,3\nPrint "ok"').out.trim()).toBe('ok')
    expect(run07('Make Tangens List 4,256\nPrint "ok"').out.trim()).toBe('ok')
    // and Get Tangens hands the FIRST argument straight back
    expect(val07('Get Tangens(1234,99)')).toBe('1234')
    expect(val07('Get Tangens(-7,0)')).toBe('-7')
  })

  it('Init Cpu Clear Word does NOT install a routine, which is the point of it', () => {
    expect(() => run07('Init Cpu Clear Word 0,10,20\nCpu Clear $20000')).toThrow(/error 12/)
  })

  it('Clear Cache is a flush with nothing to flush', () => {
    expect(run07('Clear Cache\nPrint "ok"').out.trim()).toBe('ok')
  })

  it('the Tick Timer pair is lowlevel.library ElapsedTime, at frame granularity', () => {
    // error 16 until Init Tick Timer has opened the library
    expect(() => run07('Print Get Tick Timer')).toThrow(/error 16/)
    // ElapsedTime reports the gap since the PREVIOUS call, in 1/65536 of a
    // second, and Init Tick Timer makes that call once to prime the context
    const ten = Number(run07(`Init Tick Timer\n${VBLS(10)}Print Get Tick Timer`).out.trim())
    expect(ten).toBe(Math.floor((10 * 65536) / 50))
    // and the second read measures from the first, not from the start. The
    // expected value is the difference of the two floors and not the floor of
    // the difference, which is one unit smaller: the context holds a rounded
    // reading, so the rounding is taken twice
    const b = run07(`Init Tick Timer\n${VBLS(10)}A=Get Tick Timer\n${VBLS(4)}Print Get Tick Timer`)
    expect(Number(b.out.trim())).toBe(Math.floor((14 * 65536) / 50) - Math.floor((10 * 65536) / 50))
  })

  it('DEVIATION: a gap shorter than a frame reads zero', () => {
    // the E clock would give about 200us; the vertical blank gives 20ms
    expect(run07('Init Tick Timer\nPrint Get Tick Timer').out.trim()).toBe('0')
  })
})
