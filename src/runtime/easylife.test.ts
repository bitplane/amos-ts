import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { EASYLIFE_ERRORS } from './easylife'
import { AmigaFS } from '../amiga/vfs'
import { pp20Crunch } from '../amiga/powerpacker'

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

describe('EasyLife: integers as strings, memory and banks (routines 46-79, 111, 158)', () => {
  it('Ellong$ and Elword$ are the raw bytes, most significant first', () => {
    const { out } = run(
      OPEN +
        'A$=Ellong$($12345678)\n' +
        'Print Len(A$);Asc(A$);Asc(Mid$(A$,2));Ellong(A$)=$12345678\n' +
        'B$=Elword$(-2)\nPrint Len(B$);Asc(B$);Elword(B$)\n',
    )
    expect(out).toBe(' 4 18 52-1\n 2 255-2\n')
  })

  it('Elword$ keeps the low two bytes without complaining, and Elword sign-extends', () => {
    // "ElWord$ does not give error messages if the value is out of range, it
    // simply stores the lower 2 bytes ... As Elword will return negative
    // numbers for 32768-65535"
    expect(run(OPEN + 'Print Elword(Elword$(40000))\n').out).toBe('-25536\n')
    expect(fails(OPEN + 'Print Ellong("abc")\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Print Elword("a")\n')).toMatch(/Illegal function call/)
  })

  it('Elextb and Elextw take the sign from the low byte and the low word', () => {
    expect(run(OPEN + 'Print Elextb(255);Elextw(65535);Elextb($1FF);Elextw($10001)\n').out).toBe('-1-1-1 1\n')
  })

  it('Elmem writes bytes and Elmem$ reads them back, with Elmem Inc chaining', () => {
    const { out } = run(
      OPEN +
        'Reserve As Work 5,64\n' +
        'A=Elmem Inc(Start(5),"one")\n' +
        'Elmem A,"two"\n' +
        'Print Elmem$(Start(5),6);A-Start(5)\n',
    )
    expect(out).toBe('onetwo 3\n')
  })

  it('the delimiter form stops before the delimiter, and needs a non-zero length', () => {
    const p = OPEN + 'Reserve As Work 5,64\nElmem Start(5),"ab"+Chr$(0)+"cd"\n'
    expect(run(p + 'Print Elmem$(Start(5),10,0)\n').out).toBe('ab\n')
    // not finding it stops at SLENGTH
    expect(run(p + 'Print Elmem$(Start(5),2,Asc("z"))\n').out).toBe('ab\n')
    expect(fails(p + 'Print Elmem$(Start(5),0,0)\n')).toMatch(/Illegal function call/)
    // `addq.l #$2,d3 / cmp.l #$10000,d3 / Rbcc` -- the real cap is 65533
    expect(fails(p + 'Print Elmem$(Start(5),65534)\n')).toMatch(/Illegal function call/)
  })

  it('Elbank Name$ pads to eight, and Els Bank Name demands exactly eight', () => {
    const p = OPEN + 'Reserve As Work 5,64\n'
    expect(run(p + 'Print "["+Elbank Name$(5)+"]"\n').out).toBe('[Work    ]\n')
    expect(run(p + 'Els Bank Name 5,"Message "\nPrint "["+Elbank Name$(5)+"]"\n').out).toBe('[Message ]\n')
    // the length is checked BEFORE the bank is looked up
    expect(fails(p + 'Els Bank Name 5,"short"\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Els Bank Name 9,"toolongxx"\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Els Bank Name 9,"Message "\n')).toMatch(/Bank not reserved/)
    expect(fails(p + 'Print Elbank Name$(9)\n')).toMatch(/Bank not reserved/)
    // ...and the guide's own idiom for trimming it, which uses slice 3
    expect(run(p + 'N$=Elbank Name$(5)\nPrint "["+Left$(N$,Elf Last Not Asc(N$,32))+"]"\n').out).toBe('[Work]\n')
  })

  it('Elbnk Here answers whether a bank is reserved', () => {
    expect(run(OPEN + 'Reserve As Work 5,64\nPrint Elbnk Here(5);Elbnk Here(9)\n').out).toBe('-1 0\n')
  })

  /**
   * A message bank as routine 147 reads one. NOTE: no real message bank
   * exists in the archive -- they came from a compiler the author never
   * released -- so this proves the reader agrees with the reading in the
   * `message` doc block, and nothing more.
   */
  const MSGBANK = [
    'Reserve As Work 5,128',
    'Els Bank Name 5,"Message "',
    // base+0: the entry area's offset from base, and the bound on the group
    // table is that value less 16, so 32 leaves room for groups 0..3
    'Loke Start(5),32 : Loke Start(5)+4,64',
    // base+8: group 0's entries run [0,12) -- two of them -- and group 1's
    // [12,12), which is none
    'Loke Start(5)+8,0 : Loke Start(5)+12,12 : Loke Start(5)+16,12',
    // the entries themselves, at base+32: offset then length
    'Loke Start(5)+32,0 : Doke Start(5)+36,5',
    'Loke Start(5)+38,5 : Doke Start(5)+42,3',
    // the text, at base + the longword at base+4
    'Elmem Start(5)+64,"helloabc"',
  ].join('\n')

  it('Elmessage$ walks the group table and the six-byte entries', () => {
    const { out } = run(
      OPEN + MSGBANK + '\nPrint Elmessage$(5,0,0);"/";Elmessage$(5,0,1);Elmessage Exists(5,0,0)\n',
    )
    expect(out).toBe('hello/abc-1\n')
  })

  it('out of range answers 0 for Exists and AMOS 23 for the reader', () => {
    const p = OPEN + MSGBANK + '\n'
    expect(run(p + 'Print Elmessage Exists(5,0,9);Elmessage Exists(5,9,0)\n').out).toBe(' 0 0\n')
    expect(fails(p + 'Print Elmessage$(5,0,9)\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Print Elmessage$(5,0,-1)\n')).toMatch(/Illegal function call/)
  })

  it('a bank that is not named "Message " is the extension\'s own error', () => {
    expect(fails(OPEN + 'Reserve As Work 5,64\nPrint Elmessage Exists(5,0,0)\n')).toMatch(/Not a message bank/)
    expect(fails(OPEN + 'Print Elmessage$(9,0,0)\n')).toMatch(/Bank not reserved/)
  })
})

describe('EasyLife: the bitwise block (routines 70-77)', () => {
  const B = OPEN + 'Reserve As Work 5,64\n'

  it('the word four set, clear, change and test a bit of a word', () => {
    const { out } = run(
      B +
        'Doke Start(5),0\n' +
        'Elwset 3,Start(5) : Elwset 15,Start(5)\n' +
        'Print Deek(Start(5));Elwtst(3,Start(5));Elwtst(4,Start(5))\n' +
        'Elwclr 3,Start(5) : Elwchg 15,Start(5) : Elwchg 0,Start(5)\n' +
        'Print Deek(Start(5))\n',
    )
    expect(out).toBe(' 32776-1 0\n 1\n')
  })

  it('Ellset and Elltst reach all 32 bits', () => {
    const { out } = run(
      B + 'Loke Start(5),0\nEllset 31,Start(5)\nPrint Elltst(31,Start(5));Elltst(30,Start(5))\n',
    )
    expect(out).toBe('-1 0\n')
  })

  it('the bit number is bounded per width, unsigned', () => {
    // `cmp.l #$10,d0 / Rbcc routine 3` and `cmp.l #$20,d0`
    expect(fails(B + 'Print Elwtst(16,Start(5))\n')).toMatch(/Illegal function call/)
    expect(fails(B + 'Print Elltst(32,Start(5))\n')).toMatch(/Illegal function call/)
    expect(fails(B + 'Print Elwtst(-1,Start(5))\n')).toMatch(/Illegal function call/)
    expect(fails(B + 'Elwset 16,Start(5)\n')).toMatch(/Illegal function call/)
    expect(fails(B + 'Ellset 32,Start(5)\n')).toMatch(/Illegal function call/)
  })

  it('DEFECT: Ellchg sets the bit instead of inverting it', () => {
    // routine 77's `01 c1` is bset where routine 76's `01 41` is bchg
    const { out } = run(
      B +
        'Loke Start(5),0\n' +
        'Ellchg 5,Start(5) : Print Elltst(5,Start(5));\n' +
        'Ellchg 5,Start(5) : Print Elltst(5,Start(5))\n' +
        // ...where the WORD sibling really does invert
        'Doke Start(5)+8,0\n' +
        'Elwchg 5,Start(5)+8 : Print Elwtst(5,Start(5)+8);\n' +
        'Elwchg 5,Start(5)+8 : Print Elwtst(5,Start(5)+8)\n',
    )
    expect(out).toBe('-1-1\n-1 0\n')
  })

  it('DEVIATION: Ellclr clears the bit, where the routine writes a stale d1', () => {
    // `20 10` loads the memory into d0, destroying the bit number, and the
    // bclr then operates on a d1 nothing loaded. Not reproducible; the
    // intent runs.
    const { out } = run(B + 'Loke Start(5),$FF\nEllclr 0,Start(5)\nPrint Leek(Start(5))\n')
    expect(out).toBe(' 254\n')
  })
})

describe('EasyLife: the PowerPacker buffers (routines 55-63)', () => {
  /** the buffers need a file system, which the shared `boot` above has not */
  function bootFs(src: string): { rt: Runtime; fs: AmigaFS; out: () => string } {
    const exts = new Map([[16, easylife.table]])
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    let printed = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, easylife]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
      fs,
    })
    return { rt, fs, out: () => printed }
  }

  it('Elpp Load reads a plain file, and Buf/Len describe it', () => {
    const b = bootFs(
      OPEN + 'Elpp Load 0,"ram:t",2\nPrint Elpp Len(0);Elmem$(Elpp Buf(0),5);Elpp Len(1);Elpp Buf(1)\n',
    )
    b.fs.writeFile('ram:t', new TextEncoder().encode('hello'))
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe(' 5hello 0 0\n')
  })

  it('a PP20 file is decrunched on the way in', () => {
    const b = bootFs(OPEN + 'Elpp Load 3,"ram:c",4\nPrint Elpp Len(3);Elmem$(Elpp Buf(3),11)\n')
    b.fs.writeFile('ram:c', pp20Crunch(new TextEncoder().encode('abcabcabcab')))
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe(' 11abcabcabcab\n')
  })

  it('Elpp Allocate makes an empty buffer and Elpp Free removes it', () => {
    const b = bootFs(
      OPEN +
        'Elpp Allocate 2,16\nPrint Elpp Len(2);\nElmem Elpp Buf(2),"hi"\nPrint Elmem$(Elpp Buf(2),2);\n' +
        'Elpp Free 2 : Elpp Free 2\nPrint Elpp Len(2)\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe(' 16hi 0\n')
  })

  it('the buffer number is bounded, and the readers use a WORD compare', () => {
    const p = OPEN
    expect(fails(p + 'Elpp Allocate 8,16\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Elpp Free 8\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'Print Elpp Buf(8)\n')).toMatch(/Illegal function call/)
    // ...but 65536 has a low word of 0, so `cmp.w #$8,d0` lets it past
    expect(run(p + 'Print Elpp Buf(65536)\n').out).toBe(' 0\n')
  })

  it('Elpp Crunch compresses to a file and answers its length', () => {
    const b = bootFs(
      OPEN +
        'Reserve As Work 5,600\n' +
        'For I=0 To 599 : Poke Start(5)+I,65 : Next I\n' +
        'L=Elpp Crunch("ram:out",Start(5),600,2,0)\n' +
        'Print L<600;Peek(Start(5))\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    // the source survives, which the real routine's in-place crunch does not
    // promise -- see the DEVIATION on elpp crunch
    expect(b.out()).toBe('-1 65\n')
  })

  it('Elpp Crunch bounds all three of its numeric arguments', () => {
    const p = OPEN + 'Reserve As Work 5,64\n'
    expect(fails(p + 'L=Elpp Crunch("ram:o",Start(5),64,5,0)\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'L=Elpp Crunch("ram:o",Start(5),64,0,3)\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'L=Elpp Crunch("ram:o",Start(5),0,0,0)\n')).toMatch(/Illegal function call/)
    expect(fails(p + 'L=Elpp Crunch("ram:o",Start(5),-1,0,0)\n')).toMatch(/Illegal function call/)
  })

  it('the load errors are the block the +8 arithmetic pins', () => {
    expect(fails(OPEN + 'Elpp Load 0,"",2\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Elpp Load 0,"ram:nope",2\n')).toMatch(/Unable to open file/)
  })

  it('Elpp Keep On and Off are state the Default hook will want', () => {
    const { rt } = run(OPEN + 'Elpp Keep On\n')
    expect(rt.easylife.ppKeep).toBe(true)
    expect(run(OPEN + 'Elpp Keep On\nElpp Keep Off\n').rt.easylife.ppKeep).toBe(false)
  })
})

describe('EasyLife: system, AmigaDOS and fonts (routines 105-163)', () => {
  /** the AmigaDOS half needs a writable volume with metadata */
  function bootVfs(src: string): { rt: Runtime; fs: AmigaFS; out: () => string } {
    const exts = new Map([[16, easylife.table]])
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    let printed = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, easylife]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
      fs,
    })
    return { rt, fs, out: () => printed }
  }

  it('El Base answers an extension slot, and bounds itself to 1..25', () => {
    // `$f8` is ExtAdr, sixteen bytes a slot -- +Equ.s:1176-1183
    expect(run(OPEN + 'Print El Base(16)<>0;El Base(3);El Base(-1)\n').out).toBe('-1 0 0\n')
    expect(fails(OPEN + 'Print El Base(26)\n')).toMatch(/Illegal function call/)
  })

  it('ElPro is a build-time true, and DEFECT: ElCompiled is true too', () => {
    // routine 148 is six bytes of `moveq #$ff,d3`; routine 149 compares a
    // longword that holds routine 158's first instruction, not "CplD"
    expect(run(OPEN + 'Print ElPro;Elcompiled\n').out).toBe('-1-1\n')
  })

  it('Elexists tells a file from a directory from neither', () => {
    const b = bootVfs(OPEN + 'Print Elexists("ram:f")<0;Elexists("ram:d")>0;Elexists("ram:no")\n')
    b.fs.writeFile('ram:f', new Uint8Array(2))
    b.fs.mkdir('ram:d')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe('-1-1 0\n')
  })

  it('ElProtect reads the bits and Els Protect writes them', () => {
    const b = bootVfs(OPEN + 'Print ElProtect("ram:f");\nEls Protect "ram:f",5\nPrint ElProtect("ram:f")\n')
    b.fs.writeFile('ram:f', new Uint8Array(2))
    mustFinish(b.rt.runHeadless(2000))
    // "the default flags '----rwed' have a value of 0"
    expect(b.out()).toBe(' 0 5\n')
  })

  it('a missing file is an error for ElProtect, and an empty name for Els Protect', () => {
    const a = bootVfs(OPEN + 'Print ElProtect("ram:no")\n')
    expect(() => a.rt.runHeadless(2000)).toThrow(/file not found/)
    const b = bootVfs(OPEN + 'Els Protect "",1\n')
    expect(() => b.rt.runHeadless(2000)).toThrow(/Illegal function call/)
  })

  it('Elexec is DOSFALSE without a host that can run anything', () => {
    // routine 143's Execute with both handles zero; `execute()` answers
    // DOSFALSE with no ProcessHost, "which is what dos.library answers when
    // the command does not exist"
    expect(run(OPEN + 'Print Elexec("list")\n').out).toBe(' 0\n')
  })

  it("Elreset runs an extension slot's Default hook, and bounds NUM", () => {
    // `$fc + (NUM-1)*16` is ExtAdr plus four, the DEFAULT routine pointer
    expect(() => run(OPEN + 'Elreset 16\n')).not.toThrow()
    expect(fails(OPEN + 'Elreset 0\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Elreset 26\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Elreset -1\n')).toMatch(/Illegal function call/)
  })

  it('Elraster Wait bounds the line to 0..255', () => {
    expect(fails(OPEN + 'Elraster Wait 256\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Elraster Wait -1\n')).toMatch(/Illegal function call/)
  })

  it('there is no CLI, so both standard handles are absent', () => {
    expect(run(OPEN + 'Print Elout Exists;Elin Exists\n').out).toBe(' 0 0\n')
    expect(fails(OPEN + 'Elout "hi"\n')).toMatch(/No STDOUT file handle exists/)
    expect(fails(OPEN + 'Print Elin$(4)\n')).toMatch(/No STDIN file handle exists/)
    expect(fails(OPEN + 'Print Elin Get$\n')).toMatch(/No STDIN file handle exists/)
  })

  it("a font that cannot be opened is the extension's own message 15", () => {
    // routine 160 tries graphics.library OpenFont, then diskfont.library
    // OpenDiskFont, and a miss on both is "Unable to lock font". A bare VFS
    // has no Fonts: assign, so every name misses.
    const b = bootVfs(OPEN + 'F=Elopen Font("topaz.font",8)\n')
    expect(() => b.rt.runHeadless(2000)).toThrow(/Unable to lock font/)
  })

  it('a FONTID not in the chain is AMOS 23, and Elclose Fonts empties it', () => {
    // "The parameter you supplied is not a FONTID returned from Elopen Font
    // (Or it has been closed again)" -- routines 161 and 162 walk the same
    // chain and both end at routine 3
    expect(fails(OPEN + 'Elset Font 12345\n')).toMatch(/Illegal function call/)
    expect(fails(OPEN + 'Elclose Font 12345\n')).toMatch(/Illegal function call/)
    const { rt } = run(OPEN + 'Elclose Fonts\n')
    expect(rt.easylife.fonts.size).toBe(0)
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

  it('and the string, memory and bank names', () => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const src =
      OPEN +
      'Reserve As Work 5,64\n' +
      'Set Bank Name 5,"Message "\n' +
      'A=Mem Inc(Start(5)+32,Long$(7)+Word$(9))\n' +
      'Mem A,"x"\n' +
      'Print Long(Mem$(Start(5)+32,4));Word(Mem$(Start(5)+36,2));Mem$(Start(5)+38,1)\n' +
      'Print Extb(255);Extw(65535);"[";Bank Name$(5);"]"\n' +
      'Loke Start(5),32 : Loke Start(5)+4,48\n' +
      'Loke Start(5)+8,0 : Loke Start(5)+12,6\n' +
      'Loke Start(5)+32,0 : Doke Start(5)+36,2\n' +
      'Mem Start(5)+48,"ok"\n' +
      'Print Message$(5,0,0)\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe(' 7 9x\n-1-1[Message ]\nok\n')
  })

  it('and the eight bitwise names, which merely lose the `el`', () => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const src =
      OPEN +
      'Reserve As Work 5,64 : Loke Start(5),0 : Doke Start(5)+8,0\n' +
      'Wset 3,Start(5)+8 : Wchg 4,Start(5)+8 : Wclr 3,Start(5)+8\n' +
      'Lset 20,Start(5) : Lchg 21,Start(5) : Lclr 20,Start(5)\n' +
      'Print Deek(Start(5)+8);Wtst(4,Start(5)+8);Leek(Start(5));Ltst(21,Start(5))\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    // Lchg sets rather than inverts, so bit 21 stays up after Lclr takes 20
    expect(printed).toBe(' 16-1 2097152-1\n')
  })

  it('and the seven PowerPacker names — 1.0 has no Pp Allocate', () => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.writeFile('ram:p', new TextEncoder().encode('data'))
    let printed = ''
    const src =
      OPEN +
      'Pp Keep On\n' +
      'Pp Load 1,"ram:p",4\n' +
      'Print Pp Len(1);Mem$(Pp Buf(1),4);\n' +
      // four bytes crunch LONGER than four bytes -- the PP20 header alone is
      // eight -- so this uses the padded copy the load left in the bank
      'Reserve As Work 5,600 : For I=0 To 599 : Poke Start(5)+I,66 : Next I\n' +
      'L=Pp Crunch("ram:q",Start(5),600,0,0)\n' +
      'Pp Free 1 : Pp Keep Off\n' +
      'Print Pp Len(1);L<600\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
      fs,
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe(' 4data 0-1\n')
    expect(rt.easylife.ppKeep).toBe(false)
  })

  it('and the six system names it has — 1.0 predates most of that block', () => {
    // 1.0 has `easy base` for `El Base`, and separately `amos data` for what
    // 1.10 folded into `El Base(0)`. It has no exists/exec/compiled/pro/
    // reset/stdin/font-open keywords at all.
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    fs.writeFile('ram:f', new Uint8Array(2))
    let printed = ''
    const src =
      OPEN +
      'Print Easy Base(16)<>0;Protect("ram:f");\n' +
      'Set Protect "ram:f",3\n' +
      'Print Protect("ram:f");Output Exists\n' +
      'Raster Wait 100\n'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
      fs,
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe('-1 0 3 0\n')
    // ...and `Output` raises, the standard handles being absent
    const b = new Runtime(tokenize(OPEN + 'Output "x"\n', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      fs,
    })
    expect(() => b.runHeadless(2000)).toThrow(/No STDOUT file handle exists/)
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
