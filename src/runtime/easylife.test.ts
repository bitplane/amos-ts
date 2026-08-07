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
  it('is the block routine 300 points at, and the index is zero-based', () => {
    // Three call sites name their own message and pin it: routine 81 passes
    // 12 for "No Multi Zones Reserved", routine 87 passes 11 for "Multi Zone
    // Not Defined", routine 83 passes 10 for "Multi Zone Table Full"
    expect(EASYLIFE_ERRORS[10]).toBe('Multi Zone Table Full - No space to set new zone')
    expect(EASYLIFE_ERRORS[11]).toBe('Multi Zone Not Defined')
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

describe('EasyLife: multi-zones (routines 80-96)', () => {
  /** ElMz Reserve rounds up to even and takes over the whole zone table */
  const RES = (n: number): string => `Elmz Reserve ${n}\n`

  it('reserves n*3/2+1 records and hands the first n out as zones', () => {
    // routine 80: `addq.l #$1,d6 / andi.l #$fffffffe,d6` then
    // `move.l d6,d7 / asr.l #$1,d7 / add.l d6,d7 / addq.l #$1,d7`
    const { rt } = run(OPEN + RES(5))
    // 5 rounds to 6, and 6*3/2+1 = 10 records is what EcNZones becomes
    expect(rt.screen.zones.length).toBe(10)
    expect(rt.screen.multiZones?.slots.length).toBe(6)
    // the free list runs 0 -> 1 -> ... -> 5 -> $ffff, head 0
    expect(rt.screen.multiZones?.free).toBe(0)
    expect(rt.screen.multiZones?.slots.map((s) => s.next)).toEqual([1, 2, 3, 4, 5, -1])
  })

  it('refuses a table that would need 8192 records or more', () => {
    // `cmp.l #$2000,d5 / Rbcc routine 3`, and 5460*3/2+1 = 8191 — the guide's
    // "A maximum of 5460 multi zones can be defined. (There is a good reason
    // for that number!)"
    expect(run(OPEN + RES(5460)).rt.screen.multiZones?.slots.length).toBe(5460)
    expect(fails(OPEN + RES(5461))).toMatch(/Illegal function call/)
    // DEVIATION: zero or less is an unbounded write on the machine
    expect(fails(OPEN + RES(0))).toMatch(/Illegal function call/)
    expect(fails(OPEN + RES(-4))).toMatch(/Illegal function call/)
  })

  it('every multi-zone keyword needs the table, and says so in its own words', () => {
    for (const k of [
      'Elmz  Set 1,1,0,0 To 5,5',
      'Elmz  Set 1,1',
      'Elmz Erase 1',
      'Print Elmznsx(1,1)',
      'Print Elmzone(0,0)',
      'Print Elmzonen',
    ]) {
      expect(fails(OPEN + k + '\n')).toMatch(/No Multi Zones Reserved/)
    }
    // Elmzoneg is the exception: routine 93 never calls routine 81
    expect(run(OPEN + 'Print Elmzoneg\n').out).toBe(' 0\n')
  })

  it('Elmz Set stores a rectangle under (GROUP,ID) and sorts the corners', () => {
    const { out } = run(
      OPEN +
        RES(4) +
        'Elmz  Set 7,3,30,40 To 10,20\n' +
        'Print Elmznsx(7,3);Elmznsy(7,3);Elmznex(7,3);Elmzney(7,3)\n',
    )
    expect(out).toBe(' 10 20 30 40\n')
  })

  it('the same GROUP and ID overwrites in place rather than taking a slot', () => {
    const { rt } = run(OPEN + RES(4) + 'Elmz  Set 1,1,0,0 To 5,5\nElmz  Set 1,1,9,9 To 20,20\n')
    expect(rt.screen.multiZones?.free).toBe(1)
    expect(rt.screen.zones[0]).toEqual({ x1: 9, y1: 9, x2: 20, y2: 20 })
  })

  it('group and id are 1..65535, and zero is refused because zero means free', () => {
    const p = OPEN + RES(4)
    expect(fails(p + 'Elmz  Set 0,1,0,0 To 5,5\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Elmz  Set 1,0,0,0 To 5,5\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Elmz  Set 0,1\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Print Elmznsx(0,1)\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Print Elmznsx(1,0)\n')).toMatch(/Illegal function call/)
    // ...but routines 85, 86 and 87 all reach routine 81 BEFORE either
    // argument, so with no table it is the table that is complained about
    expect(fails(OPEN + 'Elmz  Set 0,0,0,0 To 5,5\n')).toMatch(/No Multi Zones Reserved/)
    expect(fails(OPEN + 'Print Elmznsx(0,0)\n')).toMatch(/No Multi Zones Reserved/)
  })

  it('the erase form is recognised at a colon as well as at end of line', () => {
    const { rt } = run(OPEN + RES(4) + 'Elmz  Set 1,1,0,0 To 5,5 : Elmz  Set 1,1 : Print 1\n')
    expect(rt.screen.multiZones?.free).toBe(0)
  })

  it('a full table is the extension\'s own "Multi Zone Table Full"', () => {
    // routine 83's `cmp.w #$ffff,d0` on the free-list head
    const p = OPEN + RES(2) + 'Elmz  Set 1,1,0,0 To 1,1\nElmz  Set 1,2,0,0 To 1,1\n'
    expect(run(p).rt.screen.multiZones?.free).toBe(-1)
    expect(fails(p + 'Elmz  Set 1,3,0,0 To 1,1\n')).toMatch(/Multi Zone Table Full/)
  })

  it('an undefined pair is "Multi Zone Not Defined", from routine 87', () => {
    expect(fails(OPEN + RES(4) + 'Print Elmznsx(1,1)\n')).toMatch(/Multi Zone Not Defined/)
  })

  it('DEFECT: Elmzney does not sign-extend where its three siblings do', () => {
    // routine 91 is `ext.l d3 / move.w $6(a1,d2.w),d3` and routines 88-90 are
    // the two the other way round, so only this one leaves the high word zero
    const { out } = run(
      OPEN + RES(2) + 'Elmz  Set 1,1,-30,-40 To -10,-20\nPrint Elmznsx(1,1);Elmznsy(1,1);Elmzney(1,1)\n',
    )
    // -20 comes back as 65516 while -30 and -40 come back negative
    expect(out).toBe('-30-40 65516\n')
  })

  it('NOTE: the sort is unsigned, so a rectangle straddling zero comes out inverted', () => {
    // `cmp.l d1,d5 / bcc` — two negatives keep their order, since unsigned
    // comparison preserves it, but -10 ($fffffff6) sorts ABOVE +10. The
    // guide promises "X1,Y1 and X2,Y2 are automatically sorted so X1 <= X2,
    // and Y1 <= Y2" for coordinates it also says may be -32768 to 32767.
    const { out } = run(
      OPEN + RES(2) + 'Elmz  Set 1,1,-10,-10 To 10,10\nPrint Elmznsx(1,1);Elmznex(1,1)\n',
    )
    expect(out).toBe(' 10-10\n')
  })

  it('Elmz Set GROUP,ID erases one zone, and a missing one is a no-op', () => {
    const { rt } = run(OPEN + RES(4) + 'Elmz  Set 1,1,0,0 To 5,5\nElmz  Set 1,1\n')
    // freed slots go back LIFO, so slot 0 is the head again
    expect(rt.screen.multiZones?.free).toBe(0)
    // DEVIATION: routine 86 tests `cmp.l #$ffff,d2` where its siblings test
    // `cmp.w`, and routine 82 answers -1 — so the not-found branch is dead
    // and the machine frees slot -1. A no-op here.
    expect(() => run(OPEN + RES(4) + 'Elmz  Set 9,9\n')).not.toThrow()
    // the RECTANGLE survives the erase; only the index entry is released
    expect(rt.screen.zones[0]).toEqual({ x1: 0, y1: 0, x2: 5, y2: 5 })
  })

  it('Elmz Erase takes a whole group and leaves the others', () => {
    const { rt } = run(
      OPEN +
        RES(6) +
        'Elmz  Set 1,1,0,0 To 5,5\nElmz  Set 2,1,0,0 To 5,5\nElmz  Set 1,2,0,0 To 5,5\n' +
        'Elmz Erase 1\n',
    )
    const used = rt.screen.multiZones!.slots.filter((s) => s.id !== 0)
    expect(used.length).toBe(1)
    expect(used[0]!.group).toBe(2)
  })

  it('Elmzone walks every zone containing the point, unlike =Zone', () => {
    // "You can find all the zones a point lies in, not just the first one in
    // the list (unlike standard zones)."
    const { out } = run(
      OPEN +
        RES(4) +
        'Elmz  Set 1,10,0,0 To 100,100\nElmz  Set 2,20,50,50 To 200,200\n' +
        'Print Elmzone(60,60);Elmzoneg\n' +
        'Print Elmzonen;Elmzoneg\n' +
        'Print Elmzonen;Elmzoneg\n',
    )
    expect(out).toBe(' 10 1\n 20 2\n 0 0\n')
  })

  it('the far corner is inclusive, where Set Zone refuses to make one', () => {
    // `cmp.w $6e(a0),d0 / bge` — x2 < x is the miss, so x2 == x is a hit
    const p = OPEN + RES(2) + 'Elmz  Set 1,1,10,10 To 20,20\n'
    expect(run(p + 'Print Elmzone(20,20)\n').out).toBe(' 1\n')
    expect(run(p + 'Print Elmzone(21,20)\n').out).toBe(' 0\n')
    expect(run(p + 'Print Elmzone(10,10)\n').out).toBe(' 1\n')
  })

  it('the three-argument form filters by group, and Elmzoneg follows it', () => {
    const p =
      OPEN + RES(4) + 'Elmz  Set 1,10,0,0 To 100,100\nElmz  Set 2,20,0,0 To 100,100\n'
    expect(run(p + 'Print Elmzone(5,5,2);Elmzoneg\n').out).toBe(' 20 2\n')
    // "ElMzoneg will still work if you specify a group ... but it will only
    // ever return group number GROUP, or 0 if no zone was found"
    expect(run(p + 'Print Elmzone(5,5,9);Elmzoneg\n').out).toBe(' 0 0\n')
  })

  it('an erased zone stops matching without its rectangle being touched', () => {
    const p = OPEN + RES(4) + 'Elmz  Set 1,1,0,0 To 100,100\n'
    expect(run(p + 'Print Elmzone(5,5)\n').out).toBe(' 1\n')
    const { rt, out } = run(p + 'Elmz  Set 1,1\nPrint Elmzone(5,5)\n')
    expect(out).toBe(' 0\n')
    expect(rt.screen.zones[0]).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 })
  })

  it('Reserve Zone erases the multi-zones, as the guide says it does', () => {
    // routine 81 recognises the table by the $0000fefd in its last record,
    // and SyResZ allocates a fresh one
    const { rt } = run(OPEN + RES(4) + 'Elmz  Set 1,1,0,0 To 5,5\nReserve Zone\n')
    expect(rt.screen.multiZones).toBe(null)
    expect(rt.screen.zones.length).toBe(0)
    expect(fails(OPEN + RES(4) + 'Reserve Zone 3\nPrint Elmzonen\n')).toMatch(/No Multi Zones Reserved/)
  })

  it('Elzb Add erases them too — it goes through the same routine 104', () => {
    const BANK =
      'Reserve As Work 5,32\n' +
      'Doke Start(5)+2,1 : Doke Start(5)+6,12 : Doke Start(5)+12,1\n' +
      'Doke Start(5)+14,7 : Doke Start(5)+16,8 : Doke Start(5)+18,9 : Doke Start(5)+20,10\n'
    const { rt } = run(OPEN + BANK + RES(4) + 'Elzb Add 0,5,1\n')
    expect(rt.screen.multiZones).toBe(null)
    expect(rt.screen.zones.length).toBe(1)
  })
})

describe('EasyLife: character searching (routines 18-53)', () => {
  it('Elf Asc finds the first occurrence, 1-based, and Elf Char takes a set', () => {
    const { out } = run(
      OPEN +
        'A$="hello world"\n' +
        'Print Elf Asc(A$,Asc("o"));Elf Char(A$,"wo");Elf Not Asc(A$,Asc("h"));Elf Not Char(A$,"hel")\n',
    )
    expect(out).toBe(' 5 5 2 5\n')
  })

  it('the third argument starts at P+1, which is what makes it chain', () => {
    // "to find the next occurance, you simply put the position of the last
    // occurance as the P parameter of the next search"
    const { out } = run(
      OPEN + 'A$="a,b,c"\nP=Elf Asc(A$,Asc(","),0)\nPrint P;Elf Asc(A$,Asc(","),P)\n',
    )
    expect(out).toBe(' 2 4\n')
  })

  it('a negative P is AMOS 23, against the guide, and a P past the end finds nothing', () => {
    // `tst.l d3 / Rbmi routine 3` in both routine 34 and routine 37
    expect(fails(OPEN + 'Print Elf Asc("abc",97,-1)\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Print Elf Last Asc("abc",97,-1)\n')).toMatch(/Illegal function call/)
    expect(run(OPEN + 'Print Elf Asc("abc",Asc("a"),99)\n').out).toBe(' 0\n')
  })

  it('a code outside 0..255 is AMOS 23 — `andi.l #$ffffff00,d4 / Rbne`', () => {
    expect(fails(OPEN + 'Print Elf Asc("abc",256)\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Print Elf Asc("abc",-1)\n')).toMatch(/Illegal function call/)
  })

  it('the backward searches start at P-1 and never use the fail flag', () => {
    const { out } = run(
      OPEN +
        'A$="a,b,c"\n' +
        'Print Elf Last Asc(A$,Asc(","));Elf Last Asc(A$,Asc(","),4)\n' +
        'Print Elf Last Not Asc("ab   ",Asc(" "));Elf Last Char(A$,",b")\n',
    )
    expect(out).toBe(' 4 2\n 2 4\n')
    // "very useful for removing the padding from padded strings"
    expect(run(OPEN + 'Print Elf Last Not Asc("hi",Asc(" "))\n').out).toBe(' 2\n')
  })

  it('Elf Control finds a byte below 32, and 128+ is not one', () => {
    expect(run(OPEN + 'Print Elf Control("ab"+Chr$(9)+"c")\n').out).toBe(' 3\n')
    expect(run(OPEN + 'Print Elf Control("abc")\n').out).toBe(' 0\n')
    // `cmp.b #$20,d0 / bcc` is unsigned
    expect(run(OPEN + 'Print Elf Control("a"+Chr$(200))\n').out).toBe(' 0\n')
  })

  it('Elf Nth Asc checks N and Elf Nth Char does not', () => {
    const p = OPEN + 'A$="banana"\n'
    expect(run(p + 'Print Elf Nth Asc(A$,Asc("a"),3);Elf Nth Char(A$,"an",4)\n').out).toBe(' 6 5\n')
    expect(run(p + 'Print Elf Nth Asc(A$,Asc("a"),9)\n').out).toBe(' 0\n')
    // routine 53 has `subq.l #$1,d5 / Rbmi routine 3`; routine 52 does not
    expect(fails(p + 'Print Elf Nth Asc(A$,Asc("a"),0)\n')).toMatch(/Illegal function call/)
    expect(run(p + 'Print Elf Nth Char(A$,"a",0)\n').out).toBe(' 0\n')
  })

  it('NOTE: Elf Num Char counts only the FIRST character of A$', () => {
    // routine 50 is `move.b (a0),d0 / move.l d0,-(a3) / Rbra routine 51` --
    // the guide's "occurances of any character from A$ are counted" is not
    // this routine
    const p = OPEN + 'A$="banana"\n'
    expect(run(p + 'Print Elf Num Asc(A$,Asc("a"));Elf Num Char(A$,"a")\n').out).toBe(' 3 3\n')
    expect(run(p + 'Print Elf Num Char(A$,"an")\n').out).toBe(' 3\n')
    expect(run(p + 'Print Elf Num Char(A$,"na")\n').out).toBe(' 2\n')
    expect(fails(p + 'Print Elf Num Char(A$,"")\n')).toMatch(/Illegal function call/)
  })

  it('NOTE: an empty set is not an error for the four `char` searches', () => {
    // the guide says it is; `move.w (a2),d7` loads 0 and the dbra falls
    // through, so Elf Char never matches and Elf Not Char always does
    expect(run(OPEN + 'Print Elf Char("abc","");Elf Not Char("abc","")\n').out).toBe(' 0 1\n')
    expect(run(OPEN + 'Print Elf Last Char("abc","");Elf Last Not Char("abc","")\n').out).toBe(' 0 3\n')
  })

  it('Elf Fail End makes a forward miss answer the length plus one', () => {
    const p = OPEN + 'A$="abc"\n'
    expect(run(p + 'Elf Fail End\nPrint Elf Asc(A$,Asc("z"));Elf Char(A$,"z");Elf Control(A$)\n').out).toBe(
      ' 4 4 4\n',
    )
    // ...and the backward pair are unaffected, and so is Elf Num
    expect(run(p + 'Elf Fail End\nPrint Elf Last Asc(A$,Asc("z"));Elf Num Asc(A$,Asc("z"))\n').out).toBe(' 0 0\n')
    // the state outlives the call and Elf Fail Start puts it back
    expect(run(p + 'Elf Fail End\nElf Fail Start\nPrint Elf Asc(A$,Asc("z"))\n').out).toBe(' 0\n')
    // boot state is Start
    expect(run(p + 'Print Elf Asc(A$,Asc("z"))\n').out).toBe(' 0\n')
  })

  it('Elpad pads on the right, and refuses a string already longer', () => {
    const { out } = run(
      OPEN + 'Print "["+Elpad Asc$("ab",Asc("."),5)+"]";"[";Elpad Char$("ab","-x",4);"]"\n',
    )
    expect(out).toBe('[ab...][ab--]\n')
    // equal length returns S$ unchanged...
    expect(run(OPEN + 'Print "["+Elpad Asc$("abc",46,3)+"]"\n').out).toBe('[abc]\n')
    // ...but LONGER is `cmp.l d4,d6 / Rbhi routine 3`, not the pass-through
    // the guide promises
    expect(fails(OPEN + 'Print Elpad Asc$("abcd",46,3)\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Print Elpad Asc$("ab",256,5)\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Print Elpad Char$("ab","",5)\n')).toMatch(/Illegal function call/)
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

  it('and the thirteen search names, where `elf` was `find`', () => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const src =
      OPEN +
      'A$="hello, world"\n' +
      'Print Find Asc(A$,Asc("o"));Find Char(A$,"ow");Find Not Asc(A$,Asc("h"));Find Not Char(A$,"hel")\n' +
      'Print Find Last Asc(A$,Asc("o"));Find Last Char(A$,"ow");Find Last Not Asc(A$,Asc("d"));Find Last Not Char(A$,"dl")\n' +
      'Print Find Control(A$+Chr$(7));Find Nth Asc(A$,Asc("l"),3);Find Nth Char(A$,"lo",2)\n' +
      'Print Find Num Asc(A$,Asc("l"));Find Num Char(A$,"lo")\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe(' 5 5 2 5\n 9 9 11 10\n 13 11 4\n 3 3\n')
  })

  it('and the ten multi-zone names, where the rename was not a prefix strip', () => {
    // `reserve multi zone` / `set multi zone` / `clear multi group` read as
    // English where 1.09 onwards is all `elmz`; `mzone`/`mzoneg`/`mzonen`
    // lose the `el` too. Same routines: 80, 85, 92, 88-91, 95, 96, 93.
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const src =
      OPEN +
      'Reserve Multi Zone 4\n' +
      'Set Multi Zone 3,7,10,20 To 30,40\n' +
      'Set Multi Zone 5,9,0,0 To 100,100\n' +
      'Print Mznsx(3,7);Mznsy(3,7);Mznex(3,7);Mzney(3,7)\n' +
      'Print Mzone(15,25);Mzoneg;Mzonen;Mzoneg\n' +
      'Clear Multi Group 3\n' +
      'Print Mzone(15,25);Mzoneg\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe(' 10 20 30 40\n 7 3 9 5\n 9 5\n')
  })
})
