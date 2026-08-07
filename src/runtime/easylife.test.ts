import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { EASYLIFE_ERRORS } from './easylife'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 16, from Andrew Burton's AMOS Extensions List. 1.10 is the reference
 * build every citation in easylife.ts is numbered against; ext.test.ts records
 * separately that a program alone cannot tell 1.09 from 1.10, since the demos
 * use neither of the two keywords that differ.
 */
const easylife = extensionById('easylife-1.10')!

interface Boot {
  rt: Runtime
  text: () => string
}

function boot(src: string): Boot {
  const exts = new Map([[16, easylife.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[16, easylife]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, text: () => printed }
}

function run(src: string): { rt: Runtime; out: string } {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(2000))
  return { rt: b.rt, out: b.text() }
}

const fails = (src: string): string => {
  const b = boot(src)
  try {
    b.rt.runHeadless(2000)
  } catch (e) {
    return (e as Error).message
  }
  return 'did not throw'
}

const OPEN = 'Screen Open 0,320,200,16,Lowres : Curs Off : Flash Off\n'

describe('EasyLife: reading a zone back (routines 4-14)', () => {
  it('Elznsx and its three siblings answer the corners Set Zone stored', () => {
    // the guide's own example, verbatim:
    //   Set Zone 1,10,20 To 30,40
    //   Print ElZnsx(1);",";ElZnsy(1)   ->  10, 20
    //   Print ElZnex(1);",";ElZney(1)   ->  30, 40
    const { out } = run(
      OPEN +
        'Reserve Zone 4 : Set Zone 1,10,20 To 30,40\n' +
        'Print Elznsx(1);",";Elznsy(1)\n' +
        'Print Elznex(1);",";Elzney(1)\n',
    )
    expect(out).toBe(' 10, 20\n 30, 40\n')
  })

  it('the two-argument form reads another screen, and each screen has its own table', () => {
    // routine 5 ($13a4) pops the screen and goes through L_GetEc, where
    // routine 4 takes T_EcCourant. The tables are EcAZones per screen.
    const { out } = run(
      OPEN +
        'Reserve Zone 2 : Set Zone 1,1,2 To 3,4\n' +
        'Screen Open 1,320,200,16,Lowres : Curs Off\n' +
        'Reserve Zone 2 : Set Zone 1,11,12 To 13,14\n' +
        'Print Elznsx(0,1);Elznsx(1,1);Elznsx(1)\n',
    )
    expect(out).toBe(' 1 11 11\n')
  })

  it('an unset zone reads as four zeroes, and zone 0 or past the count is AMOS 23', () => {
    // "If a zone has been reserved, but not defined with Set Zone, all four
    // functions will return 0" -- routine 6 range-checks against EcNZones
    // only, so a reserved-but-blank record is read, not refused
    expect(run(OPEN + 'Reserve Zone 4\nPrint Elznsx(3);Elzney(3)\n').out).toBe(' 0 0\n')
    expect(fails(OPEN + 'Reserve Zone 4\nPrint Elznsx(0)\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Reserve Zone 4\nPrint Elznsx(5)\n')).toMatch(/Illegal function call/)
  })

  it('the answer is UNSIGNED, against the guide and with Elzn Shift', () => {
    // `moveq #$0,d3` then `move.w -$8(a1,d5.w),d3` zero-extends. C_Elznsx
    // claims "signed integers. (-32768 to 32767)"; C_ElznShift's own worked
    // example says 65526, and the binary agrees with the second one.
    const { out } = run(
      OPEN + 'Reserve Zone 1 : Set Zone 1,10,10 To 50,20\nElzn Shift 0,-20,0\nPrint Elznsx(1);Elznex(1)\n',
    )
    expect(out).toBe(' 65526 30\n')
  })
})

describe('EasyLife: Elzn Shift (routines 15-17)', () => {
  it('shifts every zone when no range is given', () => {
    const { out } = run(
      OPEN +
        'Reserve Zone 2 : Set Zone 1,10,10 To 20,20 : Set Zone 2,30,30 To 40,40\n' +
        'Elzn Shift 0,5,7\n' +
        'Print Elznsx(1);Elznsy(1);Elznex(1);Elzney(1)\n' +
        'Print Elznsx(2);Elznsy(2)\n',
    )
    expect(out).toBe(' 15 17 25 27\n 35 37\n')
  })

  it('START To FINISH is inclusive and leaves the rest alone', () => {
    // "Will scroll zoes 4,5,6 & 7 to the left by 16 pixels, and down 10"
    const { out } = run(
      OPEN +
        'Reserve Zone 3\n' +
        'Set Zone 1,10,10 To 20,20 : Set Zone 2,10,10 To 20,20 : Set Zone 3,10,10 To 20,20\n' +
        'Elzn Shift 0,100,0,2 To 3\n' +
        'Print Elznsx(1);Elznsx(2);Elznsx(3)\n',
    )
    expect(out).toBe(' 10 110 110\n')
  })

  it('routine 16 refuses START 0, either bound at 65536, and FINISH below START', () => {
    const p = OPEN + 'Reserve Zone 4 : Set Zone 1,1,1 To 2,2\n'
    expect(fails(p + 'Elzn Shift 0,1,1,0 To 2\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Elzn Shift 0,1,1,1 To 65536\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Elzn Shift 0,1,1,3 To 2\n')).toMatch(/Illegal function call/)
    // routine 17's own check: FINISH past the reserved count
    expect(fails(p + 'Elzn Shift 0,1,1,1 To 5\n')).toMatch(/Illegal function call/)
  })

  it('DEVIATION: no zones reserved raises 23 where the routine would loop for ever', () => {
    // d4 = 1, d5 = 0, both shifted left three to 8 and 0, then `cmp.l d4,d5 /
    // beq` which can never match -- an unbounded write through a null
    // EcAZones. The guide documents this case as an Illegal function call.
    expect(fails(OPEN + 'Elzn Shift 0,1,1\n')).toMatch(/Illegal function call/)
  })

  it('a screen that is not open is error 47, not 23', () => {
    expect(fails(OPEN + 'Reserve Zone 1\nElzn Shift 3,1,1\n')).toMatch(/screen not opened/)
  })
})

describe('EasyLife: the zone bank (routines 100, 101, 104)', () => {
  /**
   * A bank the Zone Editor would have written: two groups, the offset table,
   * then a word count and eight bytes a zone. Built here because the archive
   * ships no zone bank -- what it PROVES is only that the reader agrees with
   * routine 101's arithmetic, which is why the layout is quoted in the doc
   * block rather than assumed.
   */
  const BANK = [
    'Reserve As Work 5,64',
    'Doke Start(5),0 : Doke Start(5)+2,2', // 2 groups
    'Doke Start(5)+4,0 : Doke Start(5)+6,20', // group 1 at +20
    'Doke Start(5)+8,0 : Doke Start(5)+10,42', // group 2 at +42
    // group 1: two zones
    'Doke Start(5)+20,2',
    'Doke Start(5)+22,1 : Doke Start(5)+24,2 : Doke Start(5)+26,3 : Doke Start(5)+28,4',
    'Doke Start(5)+30,5 : Doke Start(5)+32,6 : Doke Start(5)+34,7 : Doke Start(5)+36,8',
    // group 2: one zone
    'Doke Start(5)+42,1',
    'Doke Start(5)+44,90 : Doke Start(5)+46,91 : Doke Start(5)+48,92 : Doke Start(5)+50,93',
  ].join('\n')

  it('Elzb Add installs a group as the screen\'s zones, replacing what was there', () => {
    const { rt, out } = run(
      OPEN +
        BANK +
        '\nReserve Zone 7\n' +
        'Elzb Add 0,5,1\n' +
        'Print Elznsx(1);Elznsy(1);Elznex(1);Elzney(1)\n' +
        'Print Elznsx(2);Elzney(2)\n',
    )
    expect(out).toBe(' 1 2 3 4\n 5 8\n')
    // routine 104 stores the group's own count into EcNZones, so the seven
    // reserved above are gone rather than kept and partly overwritten
    expect(rt.screen.zones.length).toBe(2)
    expect(fails(OPEN + BANK + '\nElzb Add 0,5,1\nPrint Elznsx(3)\n')).toMatch(/Illegal function call/)
  })

  it('the group chosen indexes the offset table', () => {
    const { rt } = run(OPEN + BANK + '\nElzb Add 0,5,2\n')
    expect(rt.screen.zones.length).toBe(1)
    expect(rt.screen.zones[0]).toEqual({ x1: 90, y1: 91, x2: 92, y2: 93 })
  })

  it('group 0 and a group past the count are AMOS 23; a missing bank is 36', () => {
    expect(fails(OPEN + BANK + '\nElzb Add 0,5,0\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + BANK + '\nElzb Add 0,5,3\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + BANK + '\nElzb Add 0,9,1\n')).toMatch(/Bank not reserved/)
  })

  it('NOTE: any bank is accepted — routine 101 never checks the "Zones   " name', () => {
    // The guide documents a "Not a Zone Bank" error and the routine calls
    // L_Bnk_GetAdr with the number alone. A bank reserved under any name with
    // a plausible group count installs.
    const { rt } = run(OPEN + BANK + '\nBank Swap 5,5\nElzb Add 0,5,1\n')
    expect(rt.screen.zones.length).toBe(2)
  })
})

describe('EasyLife: El Overlap and the lap rectangle (routines 153-157)', () => {
  it('answers -1 and stores the intersection', () => {
    const { out } = run(
      OPEN +
        'A=El Overlap(0,0,100,100 To 50,60,200,200)\n' +
        'Print A;El Lapsx;El Lapsy;El Lapex;El Lapey\n',
    )
    expect(out).toBe('-1 50 60 100 100\n')
  })

  it('answers 0 when they miss, and still stores the (empty) rectangle', () => {
    const { out } = run(
      OPEN + 'A=El Overlap(0,0,10,10 To 20,20,30,30)\nPrint A;El Lapsx;El Lapex\n',
    )
    expect(out).toBe(' 0 20 10\n')
  })

  it('touching on one edge counts as overlapping — the test is inclusive', () => {
    // `cmp.l $a2(a0),d0 / bcs` only rejects lapex STRICTLY below lapsx
    const { out } = run(OPEN + 'Print El Overlap(0,0,10,10 To 10,10,20,20)\n')
    expect(out).toBe('-1\n')
  })

  it('the comparisons are unsigned, so a negative coordinate reads as a huge one', () => {
    // -1 is $ffffffff, which is above every positive coordinate, so it wins
    // the maximum for lapsx and the intersection comes out empty
    const { out } = run(OPEN + 'A=El Overlap(-1,0,10,10 To 0,0,10,10)\nPrint A;El Lapsx\n')
    expect(out).toBe(' 0-1\n')
  })

  it('NOTE: the four readers answer 0 before any El Overlap has run', () => {
    expect(run(OPEN + 'Print El Lapsx;El Lapsy;El Lapex;El Lapey\n').out).toBe(' 0 0 0 0\n')
  })
})

describe('EasyLife: the error table', () => {
  it('is the block routine 300 points at, indexed by the negated code', () => {
    // routine 299: `tst.l d0 / bmi .own / Rjmp L_Error`, and .own is
    // `neg.l d0 / Rbra routine 300`
    expect(EASYLIFE_ERRORS.length).toBe(42)
    expect(EASYLIFE_ERRORS[0]).toBe('Unable To Open Powerpacker Library V35+')
    expect(EASYLIFE_ERRORS[12]).toBe('No Multi Zones Reserved')
    expect(EASYLIFE_ERRORS[41]).toBe('Input string is of wrong type')
    // four empty slots between the MUI block and the structured variables
    expect(EASYLIFE_ERRORS.filter((m) => m === '').length).toBe(4)
    // the zone block raises none of them: routines 2, 3 and 159 all go
    // straight to L_Error with AMOS's own 47, 23 and 36
    expect(EASYLIFE_ERRORS.some((m) => /zone bank/i.test(m))).toBe(false)
  })
})

describe('EasyLife 1.0: the same routines under the unprefixed names', () => {
  /**
   * The rename between 1.0 and 1.09 was total, so a 1.0 program shares not one
   * keyword name with the build this port was written from. All six zone
   * names it does have are the later ones with `el` stripped, which is what
   * makes `aliases` the right shape here rather than a second implementation.
   */
  it('all six of 1.0 zone names reach the same handlers through aliases', () => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const src =
      OPEN +
      'Reserve As Work 5,32\n' +
      'Doke Start(5)+2,1 : Doke Start(5)+6,12 : Doke Start(5)+12,1\n' +
      'Doke Start(5)+14,7 : Doke Start(5)+16,8 : Doke Start(5)+18,9 : Doke Start(5)+20,10\n' +
      'Reserve Zone 2 : Set Zone 1,10,20 To 30,40\n' +
      'Zn Shift 0,1,1\n' +
      'Print Znsx(1);Znsy(1);Znex(1);Zney(1)\n' +
      'Zb Add 0,5,1\n' +
      'Print Znsx(1);Zney(1)\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe(' 11 21 31 41\n 7 10\n')
  })
})
