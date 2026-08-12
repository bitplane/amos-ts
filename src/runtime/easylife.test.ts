import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { parseAmosFile } from '../loader/amosfile'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { EASYLIFE_ERRORS } from './easylife'
import { AMOS_ERRORS } from '../interp/values'
import { IDCMP_CLOSEWINDOW } from '../amiga/intuition'
import { AmigaFS } from '../amiga/vfs'
import { pp20Crunch } from '../amiga/powerpacker'
import { xpkPack } from '../amiga/xpkmaster'

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

describe('EasyLife: the Workbench three and the XPK error field', () => {
  it('Open, then Test, then Close — and all three are TRUE', () => {
    // routines 118/119/120: OpenWorkBench, then WBenchToFront and only then
    // CloseWorkBench, else `moveq #$ff,d0`. "Elwb close returns true if the
    // workbench is closed when the function has finished executing, even if
    // it didn't close it because it was already closed."
    expect(run(OPEN + 'Print Elwb Open;Elwb Test;Elwb Close\n').out).toBe('-1-1-1\n')
  })

  it('Elxpk Error reads the field the five XPK keywords would write', () => {
    // routine 177 is twelve bytes over $b6, and 0 is "No error has occured"
    expect(run(OPEN + 'Print Elxpk Error\n').out).toBe(' 0\n')
  })
})

/**
 * The demos shipped with 1.10 carry REAL banks, which is what lets the zone
 * bank be checked against an artefact rather than against a bank this test
 * built to match its own reading:
 *
 *   Zone_Editor.AMOS    49901 "Zones"     250 bytes
 *   Tag_Editor.AMOS        13 "Tags"   21,936    and 14 "TagLists" 1,610
 *   Tabifier.AMOS          13 "Tags"   21,936    and 14 "TagLists" 1,610
 *   Struct-Tutorial*.AMOS  12 "Structs"
 *
 * so every format this extension defines has a specimen in the archive after
 * all. fixtures/ is gitignored, hence skipIf.
 */
const DEMOS = join(__dirname, '..', '..', 'fixtures', 'extensions', 'easylife-1.10', 'demos')
const demoBank = (file: string, name: string): Uint8Array | null => {
  if (!existsSync(join(DEMOS, file))) return null
  const a = parseAmosFile(new Uint8Array(readFileSync(join(DEMOS, file))))
  const b = a.banks.find((x) => x.kind === 'memory' && x.name === name)
  return b?.kind === 'memory' ? b.data : null
}

describe.skipIf(!existsSync(DEMOS))('EasyLife: the zone bank, against a real one', () => {
  it("reads Zone_Editor's own 250-byte Zones bank", () => {
    // The hand-built bank in the Elzb Add tests only proves the reader
    // agrees with the reading. THIS one is the Zone Editor's own output,
    // shipped in the accessory that writes them, so it is the reading that
    // is on trial.
    const data = demoBank('Zone_Editor.AMOS', 'Zones')!
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
    expect(v.getUint32(0, false)).toBe(1) // one group
    const off = v.getUint32(4, false)
    expect(off).toBe(8) // the offset table is one entry, so the group follows it
    expect(v.getUint16(off, false)).toBe(30) // thirty zones
    // and they are plausible screen rectangles for an editor's front panel
    const zone = (i: number): number[] => {
      const at = off + 2 + i * 8
      return [v.getUint16(at, false), v.getUint16(at + 2, false), v.getUint16(at + 4, false), v.getUint16(at + 6, false)]
    }
    expect(zone(0)).toEqual([11, 4, 608, 19])
    expect(zone(1)).toEqual([611, 4, 627, 19])
    expect(zone(3)).toEqual([119, 58, 154, 68])
    // ...and the whole table fits the bank exactly: 8 + 2 + 30*8 = 250
    expect(8 + 2 + 30 * 8).toBe(data.length)
  })

  it('and Elzb Add installs it, which is the reading end to end', () => {
    const data = demoBank('Zone_Editor.AMOS', 'Zones')!
    const b = boot(OPEN + 'Elzb Add 0,7,1\nPrint Elznsx(1);Elznsy(1);Elznex(1);Elzney(1)\n')
    b.rt.memBanks.set(7, { kind: 'memory', number: 7, memType: 0, name: 'Zones   ', flags: 0, data })
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text()).toBe(' 11 4 608 19\n')
    expect(b.rt.screen.zones.length).toBe(30)
  })
})

describe.skipIf(!existsSync(DEMOS))('EasyLife: the Tags bank, against a real one', () => {
  const TAGS = (): Uint8Array => demoBank('Tag_Editor.AMOS', 'Tags')!
  /** boots with Tag_Editor's own bank 13 in place */
  const bootTags = (src: string): Boot => {
    const b = boot(src)
    b.rt.memBanks.set(13, { kind: 'memory', number: 13, memType: 0, name: 'Tags    ', flags: 0, data: TAGS() })
    return b
  }
  const runTags = (src: string): string => {
    const b = bootTags(src)
    mustFinish(b.rt.runHeadless(2000))
    return b.text()
  }
  const failTags = (src: string): string => {
    const b = bootTags(src)
    try {
      b.rt.runHeadless(2000)
    } catch (e) {
      return (e as Error).message
    }
    return 'did not throw'
  }

  it('=Tag answers the real MUI values', () => {
    // TAG_USER is $80000000 and TAG_DONE 0, which is utility.library's own
    // definition, so the tree walk is landing on the right nodes
    expect(
      runTags(
        OPEN +
          'Print Hex$(Tag("TAG_DONE"));Hex$(Tag("TAG_IGNORE"));Hex$(Tag("TAG_USER"))\n' +
          'Print Hex$(Tag("MUIA_Window_Title"));Hex$(Tag("MUIA_Text_SetMax"))\n',
      ),
    ).toBe('$0$1$80000000\n$8042AD3D$80424D0A\n')
  })

  it('walks to both children and to the deepest nodes', () => {
    // MUIA_Text_SetMax is the ROOT (offset 0), so these are found by taking
    // the +$0 link, the +$2 link, and a long descent
    expect(
      runTags(OPEN + 'Print Hex$(Tag("MUIM_Show"));Hex$(Tag("RF_NUMARGS"));Hex$(Tag("MUIV_Window_Width_Visible"))\n'),
    ).toBe('$8042CC84$20$FFFFFF9C\n')
  })

  it('a name that is a proper prefix of a node is not a hit', () => {
    // "MUIA_Text_SetMa" runs out before the node does, which routine 204
    // sends down the +$0 link rather than calling a match
    expect(failTags(OPEN + 'A=Tag("MUIA_Text_SetMa")\n')).toContain('Unmatched tag')
    expect(failTags(OPEN + 'A=Tag("MUIA_Text_SetMaxx")\n')).toContain('Unmatched tag')
  })

  it('=Tag$ packs the longwords, and the To form appends the value', () => {
    expect(
      runTags(
        OPEN +
          'Print Len(Tag$("TAG_USER"));Len(Tag$("TAG_USER","TAG_DONE"));Len(Tag$("TAG_USER","TAG_DONE","TAG_IGNORE"))\n' +
          'A$=Tag$("TAG_USER","TAG_IGNORE" To $11223344)\n' +
          'Print Len(A$);Hex$(Ellong(A$));Hex$(Ellong(Mid$(A$,5,4)));Hex$(Ellong(Right$(A$,4)))\n',
      ),
    ).toBe(' 4 8 12\n 12$80000000$1$11223344\n')
  })

  it('and is Ellong$ of each tag joined, which is what the guide says', () => {
    expect(runTags(OPEN + 'Print Tag$("TAG_USER","TAG_DONE")=Ellong$(Tag("TAG_USER"))+Ellong$(Tag("TAG_DONE"))\n')).toBe(
      '-1\n',
    )
  })

  it('no bank 13 is error 36, a bank under another name is AMOS 23', () => {
    expect(fails(OPEN + 'A=Tag("TAG_DONE")\n')).toContain('Bank not reserved')
    const b = boot(OPEN + 'A=Tag("TAG_DONE")\n')
    b.rt.memBanks.set(13, {
      kind: 'memory',
      number: 13,
      memType: 0,
      name: 'Zones   ',
      flags: 0,
      data: TAGS(),
    })
    expect(() => mustFinish(b.rt.runHeadless(2000))).toThrow(/Illegal function call/)
  })

  it("Tag Str$'s two-string form is the tag then the string address", () => {
    // the guide's own example, A$=Tag Str$("MUIA_String_Contents","Fred" To OBJ)
    const b = bootTags(
      OPEN +
        'A$=Tag Str$("MUIA_String_Contents","Fred")\n' +
        'Print Len(A$)\nPrint Ellong(A$)=Tag("MUIA_String_Contents")\nPrint Ellong(Right$(A$,4))\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    const [len, same, at] = b.text().trim().split('\n')
    expect(len).toBe('8')
    expect(same).toBe('-1')
    expect(b.rt.easylife.tagStrings.get(Number(at) | 0)).toBe('Fred')
  })

  it('Tag Attach$ takes the CHILD OBJECT first and the tag second', () => {
    // the guide's own example, A$=Tag Attach(WIN_OBJ,"MUIA_Application_Window"),
    // "exactly the same as A$=Tag$("MUIA_Application_Window" To WIN_OBJ)".
    // Object 0 is the one value routine 238 will allocate a node for while
    // nothing is registered, so it is the only success this side of slice 11
    const b = bootTags(
      OPEN +
        'A$=Tag Attach$(0,"MUIA_Group_Child")\n' +
        'B$=Tag$("MUIA_Group_Child" To 0)\n' +
        'Print Len(A$)\nPrint A$=B$\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text().trim().split('\n')).toEqual(['8', '-1'])
  })

  it('Tag Attach$ cannot attach a real object without MUI, either way round', () => {
    expect(failTags(OPEN + 'A$=Tag Attach$(42,"MUIA_Group_Child")\n')).toContain('Illegal MUI Object Address')
    // the To form names the tag by value, so there is no lookup to do first
    expect(failTags(OPEN + 'A$=Tag Attach$(42 To 8)\n')).toContain('Illegal MUI Object Address')
    // routine 234 resolves the tag through routine 203 before routine 235
    // ever looks at the object, so an unknown tag is the error that surfaces
    expect(failTags(OPEN + 'A$=Tag Attach$(42,"NO_SUCH_TAG")\n')).toContain('Unmatched tag')
  })

  it('Tag Attach$ To form takes the tag as a number', () => {
    const b = bootTags(OPEN + 'A$=Tag Attach$(0 To 8)\nPrint Ellong(A$);Ellong(Right$(A$,4))\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text().trim()).toBe('8 0')
  })
})

describe.skipIf(!existsSync(DEMOS))('EasyLife: the MUI twenty, on a real muimaster', () => {
  const bootTags = (src: string): Boot => {
    const b = boot(src)
    b.rt.memBanks.set(13, {
      kind: 'memory',
      number: 13,
      memType: 0,
      name: 'Tags    ',
      flags: 0,
      data: demoBank('Tag_Editor.AMOS', 'Tags')!,
    })
    return b
  }
  const run = (src: string): string => {
    const b = bootTags(OPEN + src)
    mustFinish(b.rt.runHeadless(4000))
    return b.text()
  }
  const fails = (src: string): string => {
    const b = bootTags(OPEN + src)
    try {
      b.rt.runHeadless(4000)
    } catch (e) {
      return (e as Error).message
    }
    return 'did not throw'
  }

  it('Mui Begin then Mui New makes a real object', () => {
    // the guide's own shape: Begin, build a taglist, New
    expect(
      run(
        'Mui Begin True\n' +
          'T$=Tag$("MUIA_Window_Title" To 0)+Tag$("TAG_DONE")\n' +
          'W=Mui New("Window.mui",T$)\n' +
          'Print W<>0\n',
      ),
    ).toBe('-1\n')
  })

  it('Mui New without a Mui Begin is message 25', () => {
    expect(fails('W=Mui New("Window.mui")\n')).toContain('Missing Elmui Begin Instruction')
  })

  it('a class MUI does not have answers 0', () => {
    expect(run('Mui Begin False\nPrint Mui New("Nonsuch.mui")\n')).toBe(' 0\n')
  })

  it('Mui Application is one only, and Mui App reads it back', () => {
    expect(
      run('Mui Begin False\nA=Mui Application(Tag$("TAG_DONE"))\nPrint A<>0;A=Mui App\n'),
    ).toBe('-1-1\n')
    expect(
      fails('Mui Begin False\nA=Mui Application(Tag$("TAG_DONE"))\nMui Begin False\nB=Mui Application(Tag$("TAG_DONE"))\n'),
    ).toContain('Illegal function call')
  })

  it('Mui Set and Mui Get carry a value through MUI', () => {
    expect(
      run(
        'Mui Begin False\nW=Mui New("Window.mui")\n' +
          'Mui Set W,"MUIA_Window_Title",1234\n' +
          'Print Mui Get(W,"MUIA_Window_Title")\n',
      ),
    ).toBe(' 1234\n')
  })

  it('the To form takes the tag as a number', () => {
    expect(
      run(
        'Mui Begin False\nW=Mui New("Window.mui")\n' +
          'Mui Set W To Tag("MUIA_Window_Title"),7\n' +
          'Print Mui Get(W To Tag("MUIA_Window_Title"))\n',
      ),
    ).toBe(' 7\n')
  })

  it('Mui Set Str and Mui Get$ round-trip a string through the pool', () => {
    expect(
      run(
        'Mui Begin False\nS=Mui New("String.mui")\n' +
          'Mui Set Str S,"MUIA_String_Contents","Fred"\n' +
          'Print Mui Get$(S,"MUIA_String_Contents")\n',
      ),
    ).toBe('Fred\n')
  })

  it('Mui Get$ of a NULL string attribute is empty', () => {
    expect(run('Mui Begin False\nS=Mui New("String.mui")\nPrint Len(Mui Get$(S,"MUIA_String_Contents"))\n')).toBe(
      ' 0\n',
    )
  })

  it('Mui Do sends a method, and Mui Fn answers it', () => {
    // MUIM_Set is the method every Mui Set uses, so it is the one that can be
    // checked from both directions
    expect(
      run(
        'Mui Begin False\nW=Mui New("Window.mui")\n' +
          'M$=Ellong$(Tag("MUIM_Set"))+Ellong$(Tag("MUIA_Window_Title"))+Ellong$(99)\n' +
          'Mui Do W,M$\n' +
          'Print Mui Get(W,"MUIA_Window_Title")\n',
      ),
    ).toBe(' 99\n')
  })

  it('Mui Notify fires the method it was given', () => {
    expect(
      run(
        'Mui Begin False\nW=Mui New("Window.mui")\n' +
          'Mui Begin False\nD=Mui New("Window.mui")\n' +
          'M$=Ellong$(Tag("MUIM_Set"))+Ellong$(Tag("MUIA_Window_Title"))+Ellong$(55)\n' +
          'Mui Notify W,"MUIA_Window_Activate",1 To D,M$\n' +
          'Mui Set W,"MUIA_Window_Activate",1\n' +
          'Print Mui Get(D,"MUIA_Window_Title")\n',
      ),
    ).toBe(' 55\n')
  })

  /**
   * The main loop of every MUI program, and until the Application methods
   * landed it could not terminate: Mui Input answered 0 for ever, so a
   * program looping until Quit looped until the step cap.
   *
   * Application's dispatcher is $2148f0; ReturnID is $220812 (append to the
   * list at $80(a2)) and Input is $220066, falling into NewInput at $21f924,
   * which answers the first node's first longword.
   */
  it('Mui Input answers the ids Mui Do queued, oldest first, then 0', () => {
    expect(
      run(
        'Mui Begin False\nA=Mui Application(Tag$("TAG_DONE"))\n' +
          'Mui Do A,Ellong$(Tag("MUIM_Application_ReturnID"))+Ellong$(7)\n' +
          'Mui Do A,Ellong$(Tag("MUIM_Application_ReturnID"))+Ellong$(9)\n' +
          'Print Mui Input;Mui Input;Mui Input\n',
      ),
    ).toBe(' 7 9 0\n')
  })

  /**
   * The shape of every MUI main loop: a notification whose destination is
   * MUIV_Notify_Application (3) and whose method is ReturnID, so the id
   * surfaces at the top of the program's own loop.
   *
   * Driven off MUIA_Window_Activate rather than the MUIA_Window_CloseRequest
   * a real program would use, because CloseRequest is `..g` — MUI raises it
   * itself when the close gadget is hit, and nothing can raise it here until
   * windows open and IDCMP reaches them.
   */
  it('a notification reaching MUIM_Application_ReturnID comes back out of Mui Input', () => {
    expect(
      run(
        'Mui Begin False\nA=Mui Application(Tag$("TAG_DONE"))\n' +
          'Mui Begin False\nW=Mui New("Window.mui")\n' +
          'Mui Add W To A\n' +
          'M$=Ellong$(Tag("MUIM_Application_ReturnID"))+Ellong$(42)\n' +
          'Mui Notify W,"MUIA_Window_Activate",1 To 3,M$\n' +
          'Mui Set W,"MUIA_Window_Activate",1\n' +
          'Print Mui Input\n',
      ),
    ).toBe(' 42\n')
  })

  /**
   * `moveq #$ff,d0 / cmp.l $4(a5),d0` at $22082e sign-extends, so the id the
   * routine treats as Quit is MUIV_Application_ReturnID_Quit, $ffffffff — and
   * it is queued like any other, which is why the documented idiom of looping
   * until Input answers Quit works without Quit being special-cased.
   */
  it('the Quit id is queued and answered like any other', () => {
    expect(
      run(
        'Mui Begin False\nA=Mui Application(Tag$("TAG_DONE"))\n' +
          'Mui Do A,Ellong$(Tag("MUIM_Application_ReturnID"))+Ellong$(Tag("MUIV_Application_ReturnID_Quit"))\n' +
          'Print Mui Input=Tag("MUIV_Application_ReturnID_Quit")\n',
      ),
    ).toBe('-1\n')
  })

  /**
   * Mui Fn is Mui Do's function form — routine 226 sends the same method and
   * answers its result. The test that named it previously drove Mui Do and
   * Mui Get instead, so the keyword itself was never dispatched.
   */
  it('Mui Fn sends the method and answers its result', () => {
    expect(
      run(
        'Mui Begin False\nA=Mui Application(Tag$("TAG_DONE"))\n' +
          'R=Mui Fn(A,Ellong$(Tag("MUIM_Application_ReturnID"))+Ellong$(5))\n' +
          'Print R;Mui Input\n',
      ),
    ).toBe(' 0 5\n')
  })

  it('Mui Make Button and Mui Make Popbutton need no Mui Begin', () => {
    expect(run('B=Mui Make Button("Ok")\nP=Mui Make Popbutton(Tag("MUII_PopUp"))\nPrint B<>0;P<>0\n')).toBe('-1-1\n')
  })

  it('Mui Add and Mui Remove move a child in and out of the tree', () => {
    expect(
      run(
        'Mui Begin False\nG=Mui New("Group.mui")\n' +
          'Mui Begin False\nT=Mui New("Text.mui")\n' +
          'Mui Add T To G\nMui Remove T To G\nPrint 1\n',
      ),
    ).toBe(' 1\n')
    // adding twice is Illegal Function Call -- "the CHILD is already part of
    // the application tree"
    expect(
      fails(
        'Mui Begin False\nG=Mui New("Group.mui")\n' +
          'Mui Begin False\nT=Mui New("Text.mui")\n' +
          'Mui Add T To G\nMui Add T To G\n',
      ),
    ).toContain('Illegal function call')
  })

  it('Mui Dispose refuses a child and takes a parent down whole', () => {
    expect(
      fails(
        'Mui Begin False\nG=Mui New("Group.mui")\n' +
          'Mui Begin False\nT=Mui New("Text.mui")\n' +
          'Mui Add T To G\nMui Dispose T\n',
      ),
    ).toContain('Illegal function call')
    expect(
      fails(
        'Mui Begin False\nG=Mui New("Group.mui")\n' +
          'Mui Begin False\nT=Mui New("Text.mui")\n' +
          'Mui Add T To G\nMui Dispose G\nPrint Mui Get(T,"MUIA_UserData")\n',
      ),
    ).toContain('Illegal MUI Object Address')
  })

  it('an address MUI never handed out is message 24', () => {
    expect(fails('Mui Set 12345,"MUIA_Window_Title",1\n')).toContain('Illegal MUI Object Address')
    expect(fails('Print Mui Get(0,"MUIA_Window_Title")\n')).toContain('Illegal MUI Object Address')
  })

  it('Mui Input without an application object is message 24', () => {
    expect(fails('Print Mui Input\n')).toContain('Illegal MUI Object Address')
  })

  it('Mui Hook answers an address, and Mui Flush and Mui Request answer', () => {
    expect(run('H=Mui Hook($1000,$99)\nPrint H<>0\n')).toBe('-1\n')
    expect(
      run('Mui Begin False\nW=Mui New("Window.mui")\nMui Flush W\nPrint Mui Request(0,"T","Ok","Hi")\n'),
    ).toBe(' 0\n')
  })

  it('a laid-out object answers its own geometry through Mui Get', () => {
    // MUIA_Width and friends are "..g": MUI fills them in from the layout and
    // a program only reads them, which is why they are 0 until it has run
    const b = bootTags(
      OPEN +
        'Mui Begin False\nT=Mui New("Text.mui")\n' +
        'Mui Begin False\nG=Mui New("Group.mui",Tag$("MUIA_Group_Child" To T)+Tag$("TAG_DONE"))\n' +
        'Print Mui Get(G,"MUIA_Width")\n',
    )
    mustFinish(b.rt.runHeadless(4000))
    expect(b.text()).toBe(' 0\n')

    const grp = [...b.rt.easylife.mui.nodes.keys()]
      .map((k) => b.rt.boopsi.objectAt(k))
      .find((o) => o && o.cl.id === 'Group.mui')!
    b.rt.mui.askMinMax(grp)
    b.rt.mui.layout(grp, 5, 6, 120, 40)
    expect(b.rt.mui.get(grp, 0x8042b59c)).toBe(120)
    expect(b.rt.mui.get(grp, 0x8042bec6)).toBe(5)
    // and the Text child got the group's whole width, since a Text stretches
    const txt = b.rt.mui.children(grp)[0]!
    expect(b.rt.mui.boxOf(txt)!.width).toBe(120)
  })

  it("Mui Set Str's string is kept with the object and freed with it", () => {
    // Tag Keep True files the string under the object, so disposing frees it
    const b = bootTags(
      OPEN +
        'Tag Keep True\nMui Begin True\nS=Mui New("String.mui")\n' +
        'Mui Set Str S,"MUIA_String_Contents","Fred"\n' +
        'Print Mui Get$(S,"MUIA_String_Contents")\n' +
        'Mui Dispose S\n',
    )
    mustFinish(b.rt.runHeadless(4000))
    expect(b.text()).toBe('Fred\n')
    expect(b.rt.easylife.tagStrings.size).toBe(0)
  })
})

describe.skipIf(!existsSync(DEMOS))('EasyLife: Tag List$, against the real TagLists bank', () => {
  const bootLists = (src: string): Boot => {
    const b = boot(src)
    b.rt.memBanks.set(14, {
      kind: 'memory',
      number: 14,
      memType: 0,
      name: 'TagLists',
      flags: 0,
      data: demoBank('Tag_Editor.AMOS', 'TagLists')!,
    })
    return b
  }
  const failLists = (src: string): string => {
    const b = bootLists(src)
    try {
      b.rt.runHeadless(2000)
    } catch (e) {
      return (e as Error).message
    }
    return 'did not throw'
  }
  /** the expanded template as longwords */
  const expand = (src: string): number[] => {
    const b = bootLists(src)
    mustFinish(b.rt.runHeadless(2000))
    return b
      .text()
      .trim()
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .map((x) => Number(x) | 0)
  }

  it('expanding a template twice answers the same thing both times', () => {
    // the expansion patches a COPY of the template; patching the bank would
    // work once and then walk a patched pointer chain off the end of the body
    const out = expand(
      OPEN +
        'A$=Tag List$("MAKE_Menuitem",111,222)\n' +
        'B$=Tag List$("MAKE_Menuitem",111,222)\n' +
        'Print Len(A$)\nPrint Len(B$)\nPrint -(A$=B$)\n',
    )
    expect(out).toEqual([20, 20, 1])
  })

  it('MAKE_Menuitem patches its two argument sites and leaves the rest', () => {
    // its argument chain is 12 -> 4, so A1 lands at offset 4 and A2 at 12
    const out = expand(
      OPEN +
        'A$=Tag List$("MAKE_Menuitem",111,222)\n' +
        'For I=0 To 4 : Print Ellong(Mid$(A$,I*4+1,4)) : Next I\n',
    )
    expect(out.length).toBe(5)
    expect(out[0]).toBe(0x804218be | 0) // untouched tag
    expect(out[1]).toBe(111) // the site at offset 4, argument 1
    expect(out[2]).toBe(0x80422030 | 0) // untouched tag
    expect(out[3]).toBe(222) // the site at offset 12, argument 2
    expect(out[4]).toBe(0) // the terminator
  })

  it('argument index 0 takes the default rather than an argument', () => {
    // NOT_Menu's chain is 24 -> 12, and the site at 12 carries index 0
    const out = expand(
      OPEN +
        'A$=Tag List$("NOT_Menu",7)\n' +
        'For I=0 To 6 : Print Ellong(Mid$(A$,I*4+1,4)) : Next I\n',
    )
    expect(out.length).toBe(7)
    expect(out[6]).toBe(7) // the site at 24, argument 1
    expect(out[3]).toBe(0) // the site at 12, index 0 -> `$e8`, which is 0
    expect(out[2]).toBe(0x49893131 | 0) // untouched
  })

  it('the declared arity must match the call, and MAKE_Menuitem wants eight', () => {
    expect(failLists(OPEN + 'A$=Tag List$("MAKE_Menuitem",1,2,3,4)\n')).toContain('Illegal function call')
    expect(failLists(OPEN + 'A$=Tag List$("NOT_Menu",1,2,3,4,5,6,7,8)\n')).toContain('Illegal function call')
  })

  it('the pointer chain resolves into the bank, past the body', () => {
    // KeyButton (bank 67's copy of it) is the one template with a d7 chain;
    // bank 14's MAKE_KeyButton is the same shape
    const b = bootLists(OPEN + 'A$=Tag List$("MAKE_KeyButton",1,2)\nPrint Len(A$)\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text()).toBe(' 60\n')
  })

  it('an unknown list is message 22, no bank 14 is error 36', () => {
    expect(failLists(OPEN + 'A$=Tag List$("NO_SUCH_LIST")\n')).toContain('Unmatched tag')
    expect(fails(OPEN + 'A$=Tag List$("NOT_Menu",1,2,3,4)\n')).toContain('Bank not reserved')
  })
})

describe('EasyLife: the pattern block, on pattern.library 5.00', () => {
  it('Elpat Case and Elpat Nocase answer -1 and 0', () => {
    const { out } = run(
      OPEN +
        'Print Elpat Case("a*","aardvark");Elpat Case("a*","bad")\n' +
        'Print Elpat Case("FRED","fred");Elpat Nocase("FRED","fred")\n',
    )
    expect(out).toBe('-1 0\n 0-1\n')
  })

  it('takes the pattern first and the subject second', () => {
    // routine 132 pops the subject into a1 and the pattern into a0, which is
    // the order $21ae wants; getting it backwards would answer -1 here
    expect(run(OPEN + 'Print Elpat Case("b?b","bab")\n').out).toBe('-1\n')
    expect(run(OPEN + 'Print Elpat Case("bab","b?b")\n').out).toBe(' 0\n')
  })

  it('a bad pattern is one AMOS error, whichever of the five it was', () => {
    for (const p of ['ab#', 'ab~', '(ab', 'ab)', '[ab', 'ab]', '(a|)', "ab'"]) {
      expect([p, fails(OPEN + `A=Elpat Case("${p}","x")\n`)]).toEqual([
        p,
        expect.stringContaining('Illegal function call'),
      ])
    }
  })

  it('Elpat Set Case compiles once and Elpat Def matches against it', () => {
    const { out } = run(
      OPEN +
        'Elpat Set Case "#?.info"\n' +
        'Print Elpat Def("disk.info");Elpat Def("disk.INFO");Elpat Def("disk.inf")\n',
    )
    expect(out).toBe('-1 0 0\n')
  })

  it('and Set Nocase folds both sides', () => {
    expect(run(OPEN + 'Elpat Set Nocase "#?.info"\nPrint Elpat Def("disk.INFO")\n').out).toBe('-1\n')
  })

  it('setting a second pattern replaces the first without an Elpat Free', () => {
    // routine 136 opens with `Rbsr routine 139`
    const { rt, out } = run(
      OPEN + 'Elpat Set Case "a*"\nElpat Set Case "b*"\nPrint Elpat Def("bad");Elpat Def("aad")\n',
    )
    expect(out).toBe('-1 0\n')
    expect(rt.easylife.patDefault).not.toBe(null)
  })

  it('Elpat Def with none set is message 19, and Elpat Free is what causes it', () => {
    expect(fails(OPEN + 'A=Elpat Def("x")\n')).toContain('No Default Pattern Defined')
    expect(fails(OPEN + 'Elpat Set Case "a*"\nElpat Free\nA=Elpat Def("aa")\n')).toContain(
      'No Default Pattern Defined',
    )
    // and a second free is harmless, because routine 139 clears $98 first
    const { rt } = run(OPEN + 'Elpat Set Case "a*"\nElpat Free\nElpat Free\n')
    expect(rt.easylife.patDefault).toBe(null)
  })

  it('a pattern that will not compile is refused at Set, not at Def', () => {
    expect(fails(OPEN + 'Elpat Set Case "ab#"\n')).toContain('Illegal function call')
  })

  it('Elpat Test finds control characters', () => {
    const { out } = run(
      OPEN + 'Print Elpat Test("fred");Elpat Test("fred*");Elpat Test("(a)");Elpat Test("a-z")\n',
    )
    expect(out).toBe(' 0-1-1 0\n')
  })

  it('Elpat Escape makes a string match itself, which is the point of it', () => {
    const { out } = run(
      OPEN + 'A$=Elpat Escape$("100% off*")\nPrint A$\nPrint Elpat Case(A$,"100% off*")\n',
    )
    expect(out).toBe("100'% off'*\n-1\n")
  })

  it('Elpat Remove drops a quote before an ordinary character', () => {
    expect(run(OPEN + `Print Elpat Remove$("'f're'd")\n`).out).toBe('fred\n')
    expect(run(OPEN + 'Print Elpat Remove$("a*b")\n').out).toBe('a*b\n')
  })

  it("DEFECT: Elpat Remove unescapes control characters, so the guide's idiom misfires", () => {
    // $19f6's copy arm does not check what it is unescaping. A string that
    // was a plain literal before Remove is a live pattern after it, and the
    // guide's own "P$=Elpat Remove$(P$) : If Elpat Test(P$)" is the recipe
    // that walks into it.
    const { out } = run(
      OPEN +
        `A$="a'*"\n` +
        'Print Elpat Case(A$,"axyz")\n' +
        'B$=Elpat Remove$(A$)\nPrint B$\n' +
        'Print Elpat Case(B$,"axyz")\n',
    )
    expect(out).toBe(' 0\na*\n-1\n')
  })

  it('the whole subject must match, not a substring', () => {
    const { out } = run(
      OPEN + 'Print Elpat Case("b?b","bab");Elpat Case("b?b","baab");Elpat Case("fred","fredx")\n',
    )
    expect(out).toBe('-1 0 0\n')
  })
})

describe('EasyLife: Tag Str, Tag Keep and Tag Block Size', () => {
  const stored = (b: Boot, at: number): string | undefined => b.rt.easylife.tagStrings.get(at | 0)

  it('Tag Str stores a NUL-terminated copy and answers its address', () => {
    const b = boot(OPEN + 'A=Tag Str("Fred")\nPrint Peek(A);Peek(A+3);Peek(A+4)\n')
    mustFinish(b.rt.runHeadless(2000))
    // "F", "d", then the NUL the guide promises MUI gets
    expect(b.text()).toBe(' 70 100 0\n')
  })

  it('the address does not change, and two stores do not overlap', () => {
    const b = boot(OPEN + 'A=Tag Str("Fred")\nB=Tag Str("Barney")\nPrint B-A;Tag Str("Fred")-A\n')
    mustFinish(b.rt.runHeadless(2000))
    // (4+14)&~7 = 16 bytes for "Fred": link, length word, text, NUL, rounded
    // up to eight, and the same for "Barney" at (6+14)&~7. A second store of
    // the same text is a second node, not the first one found again.
    expect(b.text()).toBe(' 16 32\n')
  })

  it('an empty string is stored as the null pointer', () => {
    const { out } = run(OPEN + 'Print Tag Str("")\n')
    expect(out).toBe(' 0\n')
  })

  it('Tag Str$ is the same address in four characters', () => {
    const b = boot(OPEN + 'A$=Tag Str$("Fred")\nPrint Len(A$);Ellong(A$)\n')
    mustFinish(b.rt.runHeadless(2000))
    const [len, at] = b.text().trim().split(' ')
    expect(len).toBe('4')
    expect(stored(b, Number(at))).toBe('Fred')
  })

  it('Tag Keep takes any non-zero as True, and False puts it back', () => {
    const b = boot(OPEN + 'Tag Keep 7\nA=Tag Str("Fred")\nB=Tag Keep : Tag Keep False\n')
    // `Tag Keep` is an instruction, so the second line is the state check
    const c = boot(OPEN + 'Tag Keep 7\n')
    mustFinish(c.rt.runHeadless(2000))
    expect(c.rt.easylife.tagKeep).toBe(7)
    const d = boot(OPEN + 'Tag Keep 7\nTag Keep False\n')
    mustFinish(d.rt.runHeadless(2000))
    expect(d.rt.easylife.tagKeep).toBe(0)
    expect(b).toBeTruthy()
  })

  it('Tag Block Size takes $1000 to $40000 and refuses either side', () => {
    const b = boot(OPEN + 'Tag Block Size $4000\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.rt.easylife.tagBlockSize).toBe(0x4000)
    expect(fails(OPEN + 'Tag Block Size $fff\n')).toContain('Illegal function call')
    expect(fails(OPEN + 'Tag Block Size $40001\n')).toContain('Illegal function call')
    // the far corners are legal
    run(OPEN + 'Tag Block Size $1000\nTag Block Size $40000\n')
  })

  it('and refuses outright once a block has been allocated', () => {
    expect(fails(OPEN + 'A=Tag Str("Fred")\nTag Block Size $4000\n')).toContain('Illegal function call')
  })

  it('an OBJECT that no Mui New created is rejected', () => {
    // routine 238's `cmp.l (a1),d3` against `$c6`, which is 0 here
    expect(fails(OPEN + 'A=Tag Str("Fred" To 42)\n')).toContain('Illegal MUI Object Address')
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
      'Print I Open Workbench;I Test Workbench;I Close Workbench;\n' +
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
    // I Open Workbench / I Test Workbench / I Close Workbench are 1.0's
    // names for the Elwb three, and all three answer TRUE now that there is
    // an Intuition to open a Workbench screen with
    expect(printed).toBe('-1 0-1-1-1 3 0\n')
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

describe('EasyLife: the XPK block (routines 170-186)', () => {
  /** the five keywords all touch the disc, so they need a mounted volume */
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

  const failXpk = (src: string, put?: (fs: AmigaFS) => void): string => {
    const b = bootFs(src)
    put?.(b.fs)
    try {
      b.rt.runHeadless(2000)
    } catch (e) {
      return (e as Error).message
    }
    return 'did not throw'
  }

  it('Elxpk Lof answers the UNPACKED length of all three stream kinds', () => {
    const plain = new TextEncoder().encode('x'.repeat(300))
    const b = bootFs(
      OPEN + 'Print Elxpk Lof("ram:raw");Elxpk Lof("ram:pp");Elxpk Lof("ram:xpk")\n',
    )
    b.fs.writeFile('ram:raw', plain)
    b.fs.writeFile('ram:pp', pp20Crunch(plain))
    b.fs.writeFile('ram:xpk', xpkPack(plain, 'NONE'))
    mustFinish(b.rt.runHeadless(2000))
    // all three are 300 bytes once unpacked, and only the first is 300 on disc
    expect(b.out()).toBe(' 300 300 300\n')
  })

  it('Elxpk Bload writes the unpacked bytes at the address given', () => {
    const b = bootFs(
      OPEN +
        'Reserve As Work 7,64\n' +
        'Elxpk Bload "ram:c" To Start(7)\n' +
        'Print Elmem$(Start(7),11);Elxpk Error\n',
    )
    b.fs.writeFile('ram:c', pp20Crunch(new TextEncoder().encode('abcabcabcab')))
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe('abcabcabcab 0\n')
  })

  it('Bload takes uncrunched data too -- the guide says "transparently"', () => {
    const b = bootFs(
      OPEN + 'Reserve As Work 7,64\nElxpk Bload "ram:p" To Start(7)\nPrint Elmem$(Start(7),5)\n',
    )
    b.fs.writeFile('ram:p', new TextEncoder().encode('plain'))
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe('plain\n')
  })

  it('Elxpk Save then Elxpk Load round-trips a bank through the container', () => {
    const b = bootFs(
      OPEN +
        'Reserve As Data 9,32\n' +
        'Loke Start(9),$12345678\n' +
        'Elxpk Save 9 To "ram:b","NONE"\n' +
        'Erase 9\n' +
        'Print Length(9);\n' +
        'Elxpk Load "ram:b"\n' +
        'Print Hex$(Leek(Start(9)));Elxpk Error\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    // the bank came back at 9 with nothing said: its number rode in the
    // 24-byte header, at offset 8 of xsh_Initial
    expect(b.out()).toBe(' 0$12345678 0\n')
  })

  it('Load To BNKNO puts it somewhere else, and the name survives', () => {
    const b = bootFs(
      OPEN +
        'Reserve As Data 9,32\n' +
        'Loke Start(9),$AABBCCDD\n' +
        'Elxpk Save 9 To "ram:b","NONE"\n' +
        'Elxpk Load "ram:b" To 11\n' +
        'Print Hex$(Leek(Start(11)))\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe('$AABBCCDD\n')
    expect(b.rt.memBanks.get(11)?.name).toBe('Datas   ')
    expect(b.rt.memBanks.get(11)?.flags).toBe(1) // Bnk_BitData, out of the file
  })

  it('DEFECT: the loaded bank keeps its whole reservation, ULen + 232', () => {
    // $2a06's shrink frees nothing and leaks its replacement -- see the
    // handler's own note. A 32-byte bank saves as 56 bytes (24 + 32), so the
    // reservation is 56 + 256 - 24 = 288 and stays there.
    const b = bootFs(
      OPEN + 'Reserve As Data 9,32\nElxpk Save 9 To "ram:b","NONE"\nElxpk Load "ram:b" To 12\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.rt.memBanks.get(12)?.data.length).toBe(56 + 256 - 24)
  })

  it('Elxpk Bsave packs a block of memory, and Bload reads it back', () => {
    const b = bootFs(
      OPEN +
        'Reserve As Work 7,64\n' +
        'Elmem Start(7),"the quick brown fox"\n' +
        'Elxpk Bsave Start(7),19 To "ram:o","NONE"\n' +
        'Reserve As Work 8,320\n' +
        'Elxpk Bload "ram:o" To Start(8)\n' +
        'Print Elmem$(Start(8),19);Elxpk Lof("ram:o")\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe('the quick brown fox 19\n')
  })

  it('an uninstalled compressor is XPK error -15, through message 20', () => {
    // "Can't find required XPK library" -- exactly what an Amiga with an empty
    // LIBS:Compressors/ says, and the four methods below are all real ones.
    for (const m of ['NUKE', 'HUFF.50', 'RLEN', 'BLZW.99']) {
      expect(
        failXpk(OPEN + `Reserve As Data 9,32\nElxpk Save 9 To "ram:b","${m}"\n`),
      ).toMatch(/^An Xpk Error Has Occured/)
    }
  })

  it('Elxpk Error keeps the code the raise reported, and clears on success', () => {
    // $b6 is written before the branch to message 20, so the number outlives
    // the error -- which is the whole point of the keyword.
    const bad = bootFs(OPEN + 'Reserve As Data 9,32\nElxpk Save 9 To "ram:b","NUKE"\n')
    expect(() => bad.rt.runHeadless(2000)).toThrow(/An Xpk Error Has Occured/)
    expect(bad.rt.easylife.xpkError).toBe(-15) // XPKERR_MISSINGLIB

    const ok = bootFs(
      OPEN + 'Reserve As Data 9,32\nElxpk Save 9 To "ram:b","NONE"\nPrint Elxpk Error\n',
    )
    mustFinish(ok.rt.runHeadless(2000))
    expect(ok.out()).toBe(' 0\n')
  })

  it('a corrupt XPK file is a checksum failure, not a silent wrong answer', () => {
    const packed = xpkPack(new TextEncoder().encode('y'.repeat(64)), 'NONE')
    expect(
      failXpk(OPEN + 'Print Elxpk Lof("ram:bad")\n', (fs) => {
        packed[20] = (packed[20] ?? 0) ^ 0x80 // inside xsh_Initial
        fs.writeFile('ram:bad', packed)
      }),
    ).toMatch(/^An Xpk Error Has Occured/)
  })

  it('a file that is not there is the extension\'s own "Unable to open file"', () => {
    expect(failXpk(OPEN + 'Print Elxpk Lof("ram:nope")\n')).toMatch(
      new RegExp('^' + String(EASYLIFE_ERRORS[7])),
    )
  })

  it('saving a bank that does not exist is Bank not reserved', () => {
    expect(failXpk(OPEN + 'Elxpk Save 40 To "ram:b","NONE"\n')).toMatch(/Bank not reserved/)
    // and sprite/icon banks are not memory banks, so they read the same way --
    // "You may not save sprite or icon banks with this command"
    expect(failXpk(OPEN + 'Elxpk Save 1 To "ram:b","NONE"\n')).toMatch(/Bank not reserved/)
  })
})

describe('EasyLife 1.44: the two keywords that are a bare rts', () => {
  /** 1.44 has its own table; the port covers all four ids off one file */
  function boot144(src: string): { rt: Runtime; out: () => string } {
    const v = extensionById('easylife-1.44')!
    const exts = new Map([[16, v.table]])
    let printed = ''
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, v]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    return { rt, out: () => printed }
  }

  it('Elzqzqzq takes its four arguments and does nothing with them', () => {
    // routine 133 is `rts`, and the spec is I0,0t0,0
    const b = boot144(OPEN + 'A=5\nElzqzqzq 1,2 To 3,4\nPrint A\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe(' 5\n')
  })

  it('Elqqzqzqq takes six, and its arguments are still evaluated', () => {
    // routine 132 is `rts`, spec I0,0,0,0t0,0. The expressions are evaluated
    // by AMOS before the routine is entered, so a side effect in one happens.
    const b = boot144(OPEN + 'A=0\nElqqzqzqq 1,2,3,4 To 5,6\nPrint A\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe(' 0\n')
  })

  it('Ellock Font / Elunlock Fonts are 1.44 keeping 1.0’s spelling', () => {
    // 1.44's routines 111 and 112 are 1.0's numbers for the same pair, so the
    // rename to `elopen font` / `elclose fonts` happened in 1.09 and 1.44 was
    // branched from before it. Both are aliased onto the 1.09 handlers; with
    // no font mounted, Ellock Font takes message 15 as Elopen Font does.
    const bad = boot144(OPEN + 'F=Ellock Font("topaz.font",8)\n')
    expect(() => bad.rt.runHeadless(2000)).toThrow(/Unable to lock font/)
    const b = boot144(OPEN + 'Elunlock Fonts\nPrint 1\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out()).toBe(' 1\n')
  })

  it('both are reachable under 1.44 and absent from 1.10', () => {
    const names = (id: string): string[] =>
      (extensionById(id)!.table as unknown as { entries: Array<{ name?: string }> }).entries.map(
        (e) => String(e.name ?? '').trim().toLowerCase(),
      )
    expect(names('easylife-1.44')).toContain('elzqzqzq')
    expect(names('easylife-1.44')).toContain('elqqzqzqq')
    expect(names('easylife-1.10')).not.toContain('elzqzqzq')
    expect(names('easylife-1.10')).not.toContain('elqqzqzqq')
  })
})

/**
 * Structured variables, against Struct-Tutorial2's own Structs bank.
 *
 * The tutorial is the answer key it needs to be, because it prints its own
 * definitions in the comments the compiler left behind and then the constants
 * it generated from them:
 *
 *     ' item : structure
 *     '     name : string length 20
 *     '     value : integer
 *     ' end
 *     ' qhead : structure
 *     '     first : pointer to qelem
 *     '     last  : pointer to qelem
 *     '     type  : integer
 *     ' end
 *     ' qelem : structure
 *     '     next  : pointer to qelem
 *     '     data  : pointer
 *     ' end
 *     ST_ITEM=20: ST_NAME=26: ST_VALUE=32: ST_QHEAD=38: ST_FIRST=44
 *     ST_LAST=50: ST_TYPE=56: ST_QELEM=62: ST_NEXT=68: ST_DATA=74
 *
 * so every number this describe asserts is one the compiler wrote, not one
 * the reader derived. The 156-byte bank has a string element, both flavours
 * of pointer and plain integers, which is the whole of the typed-field engine
 * bar the ranged and boolean arms.
 */
describe.skipIf(!existsSync(DEMOS))('EasyLife: structured variables (routines 262-295)', () => {
  const STRUCTS = (): Uint8Array => demoBank('Struct-Tutorial2.AMOS', 'Structs')!
  /** the tutorial's own globals, so the tests read like its own source */
  const K =
    'ST_ITEM=20: ST_NAME=26: ST_VALUE=32: ST_QHEAD=38: ST_FIRST=44\n' +
    'ST_LAST=50: ST_TYPE=56: ST_QELEM=62: ST_NEXT=68: ST_DATA=74\n'

  const bootSt = (src: string): Boot => {
    const b = boot(OPEN + K + src)
    b.rt.memBanks.set(12, {
      kind: 'memory',
      number: 12,
      memType: 0,
      name: 'Structs ',
      flags: 0,
      data: STRUCTS(),
    })
    return b
  }
  const runSt = (src: string): string => {
    const b = bootSt(src)
    mustFinish(b.rt.runHeadless(2000))
    return b.text()
  }
  const failSt = (src: string): string => {
    const b = bootSt(src)
    try {
      b.rt.runHeadless(2000)
    } catch (e) {
      return (e as Error).message
    }
    return 'did not throw'
  }

  it('=St Lookup answers the addresses the compiler laid down', () => {
    // routine 294 returns `bank + offset`, not the offset: the definitions
    // start at the header's +16 (80 here) and `item` is the first of them.
    // ST_NAME resolves only UNDER its own structure, which is the guide's
    // "you pass an element name that is not an element of the particular
    // structure instance the command refers to".
    const b = bootSt('Print St Lookup(ST_ITEM,0)-St Lookup(ST_ITEM,0);\n')
    mustFinish(b.rt.runHeadless(2000))
    const base = b.rt.bankBase(12)
    const out = runSt(
      'Print St Lookup(ST_ITEM,0);St Lookup(ST_NAME,ST_ITEM);St Lookup(ST_QHEAD,0)\n',
    )
    expect(out).toBe(` ${base + 80} ${base + 88} ${base + 102}\n`)
  })

  it('=St New / =St Type / =St Len read the definition back', () => {
    // 4 header + 24 for a 20-character string (max+3 rounded up to even) + 4
    // for the integer = 32, which is what the guide's own arithmetic gives
    expect(runSt('I=St New(ST_ITEM)\nPrint St Type(I);St Len(I)\n')).toBe(' 20 32\n')
    expect(runSt('Q=St New(ST_QHEAD)\nPrint St Type(Q);St Len(Q)\n')).toBe(' 38 16\n')
  })

  it('St Set and =St Get carry an integer element through the pool', () => {
    expect(runSt('I=St New(ST_ITEM)\nSt Set I,ST_VALUE To -12345\nPrint St Get(I,ST_VALUE)\n')).toBe(
      '-12345\n',
    )
  })

  it('a fresh instance reads back as zero, because St New clears it', () => {
    expect(runSt('I=St New(ST_ITEM)\nPrint St Get(I,ST_VALUE);Len(St Get$(I,ST_NAME))\n')).toBe(
      ' 0 0\n',
    )
  })

  it('St Set Str and =St Get$ carry a string element', () => {
    expect(
      runSt('I=St New(ST_ITEM)\nSt Set Str I,ST_NAME To "Wibble"\nPrint St Get$(I,ST_NAME)\n'),
    ).toBe('Wibble\n')
  })

  it('=St Get on a string element answers the address of its characters', () => {
    // the guide: "St Get to return the address of the string within the
    // structure, where it is stored null-terminated", and the terminator is
    // what makes it usable "for any system library calls"
    expect(
      runSt(
        'I=St New(ST_ITEM)\nSt Set Str I,ST_NAME To "Hi"\nA=St Get(I,ST_NAME)\n' +
          'Print Chr$(Peek(A));Chr$(Peek(A+1));Peek(A+2);Deek(A-2)\n',
      ),
    ).toBe('Hi 0 2\n')
  })

  it('a string longer than the element is message 35', () => {
    expect(failSt('I=St New(ST_ITEM)\nSt Set Str I,ST_NAME To String$("x",21)\n')).toMatch(
      new RegExp('^' + EASYLIFE_ERRORS[35]),
    )
  })

  it('a typed pointer takes nil or an instance of its own type, and nothing else', () => {
    // $4f2: `tst.l d6 / beq` lets nil through untested, then the target's
    // type word is compared with the descriptor's
    expect(
      runSt(
        'Q=St New(ST_QHEAD)\nE=St New(ST_QELEM)\nSt Set Q,ST_FIRST To E\n' +
          'Print St Get(Q,ST_FIRST)-E;\nSt Set Q,ST_FIRST To 0\nPrint St Get(Q,ST_FIRST)\n',
      ),
    ).toBe(' 0 0\n')
    expect(
      failSt('Q=St New(ST_QHEAD)\nI=St New(ST_ITEM)\nSt Set Q,ST_FIRST To I\n'),
    ).toMatch(new RegExp('^' + EASYLIFE_ERRORS[34]))
  })

  it('a sub-structure element cannot be assigned — but there is none here to try', () => {
    // $544 is `bra.w $a08` and nothing else; none of the five Structs banks
    // in the archive declares a sub-structure, so this asserts the message
    // exists rather than pretending to reach it
    expect(EASYLIFE_ERRORS[36]).toBe('Substructure addresses cannot be changed')
  })

  it('the wrong number of subscripts is AMOS 23, not a private message', () => {
    // $364: `cmp.l d3,d1 / bne.w $9c2`, and $9c2 sets d0 = $17
    expect(failSt('I=St New(ST_ITEM)\nPrint St Get(I,ST_VALUE,0)\n')).toMatch(
      /^Illegal function call/,
    )
  })

  it('=Stv reads and Stv()= writes, which is St Get and St Set', () => {
    // undocumented, and new in 1.10: its four function slots ARE routines
    // 273-276, St Get's own trampolines
    expect(runSt('I=St New(ST_ITEM)\nStv(I,ST_VALUE)=99\nPrint Stv(I,ST_VALUE)\n')).toBe(' 99\n')
  })

  it('St Free returns the memory to the pool, and the next St New takes it back', () => {
    // the guide warns that "it is possible that the new structure does not
    // begin at the same address as the old" precisely because exec's
    // Deallocate coalesces and Allocate is first fit. Same size, so it does.
    expect(
      runSt('A=St New(ST_ITEM)\nSt Free A\nB=St New(ST_ITEM)\nPrint B-A\n'),
    ).toBe(' 0\n')
    // and two live instances are consecutive, 32 bytes apart
    expect(runSt('A=St New(ST_ITEM)\nB=St New(ST_ITEM)\nPrint B-A\n')).toBe(' 32\n')
  })

  it('St Free All empties every block', () => {
    const b = bootSt('A=St New(ST_ITEM)\nB=St New(ST_ITEM)\nSt Free All\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.rt.easylife.structs.live).toBe(0)
    expect(b.rt.easylife.structs.blocks.length).toBe(1)
    expect(b.rt.easylife.structs.blocks[0]?.free).toEqual([{ at: 0x18, len: 0x2000 - 0x20 }])
  })

  it('the pool block is the size the bank header asks for', () => {
    // bank+12 is $2000 in all five Structs banks in the archive
    const b = bootSt('A=St New(ST_ITEM)\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.rt.easylife.structs.blocks[0]?.data.length).toBe(0x2000)
    expect(b.rt.easylife.structs.live).toBe(1)
  })

  it('=St Dup copies the header too, St Copy does not', () => {
    // routine 267 moves size/4 longwords from the instance's start; routine
    // 268 does `addq.l #$4` on both sides first and moves size-4 bytes
    expect(
      runSt(
        'A=St New(ST_ITEM)\nSt Set A,ST_VALUE To 7\nSt Set Str A,ST_NAME To "abc"\n' +
          'B=St Dup(A)\nPrint St Type(B);St Get(B,ST_VALUE);St Get$(B,ST_NAME)\n',
      ),
    ).toBe(' 20 7abc\n')
    expect(
      runSt(
        'A=St New(ST_ITEM)\nSt Set A,ST_VALUE To 7\nB=St New(ST_ITEM)\nSt Copy A To B\n' +
          'Print St Get(B,ST_VALUE)\n',
      ),
    ).toBe(' 7\n')
  })

  it('St Copy between different types is AMOS 23 through routine 3', () => {
    // NOT message 39: "Cannot copy between structures of different types" is
    // in the table and nothing raises it
    expect(failSt('A=St New(ST_ITEM)\nB=St New(ST_QHEAD)\nSt Copy A To B\n')).toMatch(
      /^Illegal function call/,
    )
  })

  it('=St Cmp compares the ELEMENT against the string, which is the guide backwards', () => {
    // $57a `cmpm.b (a0)+,(a1)+` computes argument minus element and `blt`
    // returns +1, so "abc" against an element holding "hello" answers 1 where
    // the guide promises -1. The equal and prefix cases agree with it.
    expect(
      runSt(
        'I=St New(ST_ITEM)\nSt Set Str I,ST_NAME To "hello"\n' +
          'Print St Cmp(I,ST_NAME To "hello");St Cmp(I,ST_NAME To "abc");' +
          'St Cmp(I,ST_NAME To "zoo");St Cmp(I,ST_NAME To "hell")\n',
      ),
    ).toBe(' 0 1-1 1\n')
  })

  it('=St Output$ and St Input round-trip an instance', () => {
    expect(
      runSt(
        'A=St New(ST_ITEM)\nSt Set A,ST_VALUE To 1234\nSt Set Str A,ST_NAME To "zzz"\n' +
          'S$=St Output$(A)\nB=St New(ST_ITEM)\nSt Input B,S$\n' +
          'Print Len(S$);St Get(B,ST_VALUE);St Get$(B,ST_NAME)\n',
      ),
    ).toBe(' 32 1234zzz\n')
  })

  it('St Input checks the type first and the length second', () => {
    expect(
      failSt('A=St New(ST_QHEAD)\nB=St New(ST_ITEM)\nSt Input B,St Output$(A)\n'),
    ).toMatch(new RegExp('^' + EASYLIFE_ERRORS[41]))
    expect(failSt('B=St New(ST_ITEM)\nSt Input B,Chr$(0)+Chr$(20)\n')).toMatch(
      new RegExp('^' + EASYLIFE_ERRORS[40]),
    )
  })

  it('nothing works without bank 12, and the error is AMOS 36', () => {
    // $9ae, reached when the type-table callback (`Rjmp L_Bnk_GetAdr`)
    // answers 0 — the guide's "Bank 12 is not reserved"
    const b = boot(OPEN + K + 'A=St New(ST_ITEM)\n')
    let msg = 'did not throw'
    try {
      b.rt.runHeadless(2000)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/^Bank not reserved/)
  })

  it('an id bank 12 does not hold raises message 38', () => {
    // DEFECT: the 68k reaches L_Error with d0 unset here — see ERR_NOT_FOUND
    // in elstruct.ts. The port raises the message the table and the guide
    // both name, which is the only observable choice.
    expect(failSt('A=St New(21)\n')).toMatch(new RegExp('^' + EASYLIFE_ERRORS[38]))
  })
})

/**
 * The graph half — St Save, St Load and St Erase — over the queue the
 * tutorial builds, because a linked structure is the only thing that
 * exercises `ELST_TreeScan` at all.
 */
describe.skipIf(!existsSync(DEMOS))('EasyLife: saving and loading a graph of structures', () => {
  const K =
    'ST_ITEM=20: ST_NAME=26: ST_VALUE=32: ST_QHEAD=38: ST_FIRST=44\n' +
    'ST_LAST=50: ST_TYPE=56: ST_QELEM=62: ST_NEXT=68: ST_DATA=74\n'
  /** a two-element queue: head -> e1 -> e2, and e1/e2 both point at items */
  const BUILD =
    'Q=St New(ST_QHEAD)\n' +
    'I1=St New(ST_ITEM): St Set I1,ST_VALUE To 11\n' +
    'I2=St New(ST_ITEM): St Set I2,ST_VALUE To 22\n' +
    'E1=St New(ST_QELEM): St Set E1,ST_DATA To I1\n' +
    'E2=St New(ST_QELEM): St Set E2,ST_DATA To I2\n' +
    'St Set E1,ST_NEXT To E2\n' +
    'St Set Q,ST_FIRST To E1: St Set Q,ST_LAST To E2\n'

  const bootG = (src: string): { rt: Runtime; fs: AmigaFS; text: () => string } => {
    const exts = new Map([[16, easylife.table]])
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    let printed = ''
    const rt = new Runtime(tokenize(OPEN + K + src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, easylife]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
      fs,
    })
    rt.memBanks.set(12, {
      kind: 'memory',
      number: 12,
      memType: 0,
      name: 'Structs ',
      flags: 0,
      data: demoBank('Struct-Tutorial2.AMOS', 'Structs')!,
    })
    return { rt, fs, text: () => printed }
  }

  it('St Save writes "ElSt", the count and one record per instance', () => {
    const b = bootG(BUILD + 'St Save "RAM:q.st",Q\n')
    mustFinish(b.rt.runHeadless(2000))
    const f = b.fs.read('RAM:q.st')!
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength)
    expect(v.getUint32(0, false)).toBe(0x456c5374)
    // Q, E1, E2, I1, I2 — the scan is breadth-first from the root
    expect(v.getUint32(4, false)).toBe(5)
    expect(v.getUint32(8, false)).toBe(0)
    // 12 header + Q(4+16) + E1(4+16) + E2(4+16) + I1(4+32) + I2(4+32)
    expect(f.length).toBe(12 + 20 + 20 + 20 + 36 + 36)
  })

  it('=St Load relocates every pointer onto the new addresses', () => {
    // the whole point of the format: "all the pointers in all the structures
    // will automatically by relocated to the new addresses"
    const b = bootG(
      BUILD +
        'St Save "RAM:q.st",Q\nSt Free All\nR=St Load("RAM:q.st")\n' +
        'A=St Get(R,ST_FIRST): B=St Get(A,ST_NEXT)\n' +
        'Print St Get(St Get(A,ST_DATA),ST_VALUE);St Get(St Get(B,ST_DATA),ST_VALUE);' +
        '(St Get(R,ST_LAST)=B)\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text()).toBe(' 11 22-1\n')
  })

  it('a cycle back to the root saves the root twice — the guide says it should not', () => {
    // DEFECT: `move.l d3,(a1)` seeds the list with the root and never sets its
    // visited bit, so a pointer back to it appends it a second time. The
    // guide: "It is OK if your graph contains cycles ... Each instance is
    // only saved once." Two instances here, three records.
    //
    // `data` is the untyped pointer of a qelem, which is what makes the ring
    // expressible at all — `first` is typed and would refuse a qhead.
    const b = bootG(
      'Q=St New(ST_QHEAD)\nE=St New(ST_QELEM)\n' +
        'St Set Q,ST_FIRST To E\nSt Set E,ST_DATA To Q\n' +
        'St Save "RAM:c.st",Q\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    const f = b.fs.read('RAM:c.st')!
    expect(new DataView(f.buffer, f.byteOffset, f.byteLength).getUint32(4, false)).toBe(3)
    // and the third record is the root's address again, byte for byte
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength)
    expect(v.getUint32(12, false)).toBe(v.getUint32(12 + 20 + 20, false))
  })

  it('St Erase frees the whole graph, not just the root', () => {
    const b = bootG(BUILD + 'St Erase Q\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.rt.easylife.structs.live).toBe(0)
  })

  it('a file that is not "ElSt" is refused', () => {
    const b = bootG('R=St Load("RAM:junk")\n')
    b.fs.writeFile('RAM:junk', new Uint8Array(32))
    let msg = 'did not throw'
    try {
      b.rt.runHeadless(2000)
    } catch (e) {
      msg = (e as Error).message
    }
    // $a1c sets d0 = $62, and routine 299 hands a non-negative d0 to L_Error
    expect(msg).toMatch(/^File type mismatch/)
  })
})

describe('EasyLife 1.0: El Error, and the font pair before the rename', () => {
  const run10 = (src: string): string => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const rt = new Runtime(tokenize(OPEN + src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    return printed
  }

  it('=El Error reads the number of the last EasyLife error and clears it', () => {
    // routine 166 records d0 at $44 on its way to L_ErrorExt, routine 165
    // reads it back and writes zero. Message 12 is "No Multi Zones Reserved",
    // which `Mzone` raises when nothing has reserved any.
    expect(run10('On Error Goto 100\nA=Mzone(0,0)\n100 Print El Error;El Error\n')).toBe(' 12 0\n')
  })

  it('and it is zero before anything has gone wrong', () => {
    // the deviation recorded on the keyword: the doc says it clears to -1,
    // the instruction is `move.l #$0,(a2)`, and zero is also the initial
    // value — so "no error yet" and "already read" are indistinguishable
    expect(run10('Print El Error\n')).toBe(' 0\n')
  })

  it('Lock Font / Unlock Fonts are 1.09’s Elopen Font / Elclose Fonts', () => {
    // 1.0's routines 111 and 112 keep their font list at $56 and 1.09's 160
    // and 163 keep a chain at $7c, but the keyword is the same one: a name
    // and a size in, a font pointer out, and a close-them-all. 1.44 kept
    // 1.0's spelling on 1.0's routine numbers, which dates the rename to 1.09.
    // no font is mounted here, so `Lock Font` reaches the same message 15 the
    // Elopen Font test above asserts — which is the proof the alias lands on
    // that handler and not on nothing
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    const rt = new Runtime(tokenize(OPEN + 'F=Lock Font("topaz.font",8)\n', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, one]]),
      maxSteps: 200_000,
    })
    expect(() => rt.runHeadless(2000)).toThrow(/Unable to lock font/)
    // and the close-them-all half runs on an empty list without complaining
    expect(run10('Unlock Fonts\nPrint 1\n')).toBe(' 1\n')
  })
})

describe('EasyLife: Elzb Multi Add, and 1.0’s two names for it', () => {
  /**
   * Zone_Editor's own 250-byte Zones bank: one group, thirty zones, the same
   * artefact the Elzb Add tests use. `Elzb Multi Add` turns each of them into
   * a multi-zone rather than a plain one.
   */
  const bootZb = (src: string): Boot => {
    const b = boot(OPEN + src)
    b.rt.memBanks.set(7, {
      kind: 'memory',
      number: 7,
      memType: 0,
      name: 'Zones   ',
      flags: 0,
      data: demoBank('Zone_Editor.AMOS', 'Zones')!,
    })
    return b
  }

  it.skipIf(!existsSync(DEMOS))('the two-argument form numbers the group’s zones from one', () => {
    // routine 102: `moveq #$1,d6` then `addq.l #$1,d6` per zone, so the IDs
    // are bank order starting at 1, and the coordinates are the bank's own
    const b = bootZb(
      'Elmz Reserve 40\nElzb Multi Add 7,1\n' +
        'Print Elmznsx(1,1);Elmznsy(1,1);Elmznex(1,1);Elmzney(1,1);\nPrint Elmznsx(1,2)\n',
    )
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text()).toBe(' 11 4 608 19 611\n')
  })

  it.skipIf(!existsSync(DEMOS))('the one-argument form reserves for every group first', () => {
    // routine 103 counts every group's zones, calls routine 80 once with the
    // total, and only then adds — so no Elmz Reserve is needed beforehand.
    // Zone_Editor's bank has one group of thirty.
    // the bank's own zone 1 is (11,4)-(608,19) and its zone 30 (172,38)-(215,48)
    const b = bootZb('Elzb Multi Add 7\nPrint Elmznsx(1,1);Elmznsx(1,30);Elmzney(1,30)\n')
    mustFinish(b.rt.runHeadless(2000))
    expect(b.text()).toBe(' 11 172 48\n')
  })

  it.skipIf(!existsSync(DEMOS))('1.0 spells it Zb Multi Add and Zb Install', () => {
    const one = extensionById('easylife-1.0')!
    const exts = new Map([[16, one.table]])
    let printed = ''
    const rt = new Runtime(
      tokenize(OPEN + 'Zb Install 7\nZb Multi Add 7,1\nPrint Znsx(1);Amos Data\n', table, exts),
      table,
      {
        extensions: exts,
        extBindings: new Map([[16, one]]),
        maxSteps: 200_000,
        onText: (t) => (printed += t),
      },
    )
    rt.memBanks.set(7, {
      kind: 'memory',
      number: 7,
      memType: 0,
      name: 'Zones   ',
      flags: 0,
      data: demoBank('Zone_Editor.AMOS', 'Zones')!,
    })
    mustFinish(rt.runHeadless(2000))
    // the zones are in the table, and Amos Data is El Base(0) — a5, which
    // has no modelled address here
    expect(printed).toBe(' 11 0\n')
  })

  it('an unreserved bank is AMOS 36 in both forms', () => {
    expect(fails(OPEN + 'Elzb Multi Add 7\n')).toMatch(/^Bank not reserved/)
    expect(fails(OPEN + 'Elmz Reserve 4\nElzb Multi Add 7,1\n')).toMatch(/^Bank not reserved/)
  })
})

describe('EasyLife 1.09: Eltest, the author’s own V-form probe', () => {
  /** 1.09's table alone has it — the last of its 220 entries, at id $e4e */
  const run109 = (src: string): string => {
    const v = extensionById('easylife-1.09')!
    const exts = new Map([[16, v.table]])
    let printed = ''
    const rt = new Runtime(tokenize(OPEN + src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, v]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    return printed
  }

  it('the assignment form takes its three values and does nothing', () => {
    // 1.09's routine 255 is `moveq #$1,d0 / lea $c(a3),a3 / rts` — three
    // longwords popped, which is exactly the two arguments and the value
    expect(run109('A=7\nEltest(1,2)=99\nPrint A\n')).toBe(' 7\n')
  })

  it('and the function form answers zero', () => {
    // the deviation on the keyword: routine 256 sets d0, never d3 or d2, so
    // the machine answers whatever d3 held. Zero here, as an integer.
    expect(run109('Print Eltest(1,2)\n')).toBe(' 0\n')
  })

  it('and no other build has it — 1.10 put Stv at the id it used', () => {
    const names = (id: string): string[] =>
      (extensionById(id)!.table as unknown as { entries: Array<{ name?: string }> }).entries.map(
        (e) => String(e.name ?? '').replace(/^!/, '').trim().toLowerCase(),
      )
    expect(names('easylife-1.09')).toContain('eltest')
    for (const id of ['easylife-1.0', 'easylife-1.10', 'easylife-1.44']) {
      expect(names(id)).not.toContain('eltest')
    }
    expect(names('easylife-1.10')).toContain('stv')
  })
})

describe('EasyLife: the iconify family (routines 123-126)', () => {
  /** press and release the close gadget, through the real gadget path */
  const clickClose = (rt: Runtime): void => {
    const w = rt.intuition.windows[0]!
    const x = w.leftEdge + 2
    const y = w.topEdge + 2
    rt.intuition.handleInput(w.screenSlot, x, y, 1)
    rt.intuition.handleInput(w.screenSlot, x, y, 0)
  }

  /** activate the window with a left click, then use the right button in it */
  const rightClick = (rt: Runtime): void => {
    const w = rt.intuition.windows[0]!
    const x = w.leftEdge + w.closeWidth + 2
    const y = w.topEdge + 4
    for (const b of [1, 0, 2, 0]) rt.intuition.handleInput(w.screenSlot, x, y, b)
  }

  /** run as far as the Wait, so the injected click lands before the Test */
  const upToWait = (src: string): Boot => {
    const b = boot(src)
    b.rt.frame()
    return b
  }

  it('Eliconify Begin opens the Workbench and a window on it, and answers 0', () => {
    const { rt, out } = run(OPEN + 'Print Eliconify Begin(100,20,"Hello")\n')
    expect(out).toBe(' 0\n')
    expect(rt.intuition.workBenchOpen()).toBe(true)
    expect(rt.intuition.windows).toHaveLength(1)
    // len("Hello") * 8 + 80, and a title bar's worth of height
    expect(rt.intuition.windows[0]!.width).toBe(120)
    expect(rt.intuition.windows[0]!.height).toBe(11)
  })

  /** `tst.l $88(a2) / Rbne routine 3` — a second Begin is AMOS 23 */
  it('a second Eliconify Begin is an Illegal Function Call', () => {
    expect(fails(OPEN + 'A=Eliconify Begin(0,0,"a")\nB=Eliconify Begin(0,0,"b")\n')).toContain(
      AMOS_ERRORS[23],
    )
  })

  it('Eliconify Test and End before Begin are the same error', () => {
    expect(fails(OPEN + 'A=Eliconify Test\n')).toContain(AMOS_ERRORS[23])
    expect(fails(OPEN + 'Eliconify End\n')).toContain(AMOS_ERRORS[23])
  })

  it('Eliconify Test is 0 while the window has said nothing', () => {
    const { out } = run(OPEN + 'A=Eliconify Begin(0,0,"x")\nPrint Eliconify Test\n')
    expect(out).toBe(' 0\n')
  })

  it('1 for the close gadget', () => {
    const b = upToWait(OPEN + 'A=Eliconify Begin(0,0,"x")\nWait 3\nPrint Eliconify Test\n')
    clickClose(b.rt)
    mustFinish(b.rt.runHeadless(200))
    expect(b.text()).toBe(' 1\n')
  })

  it('and -1 for the right button used in the window', () => {
    const b = upToWait(OPEN + 'A=Eliconify Begin(0,0,"x")\nWait 3\nPrint Eliconify Test\n')
    rightClick(b.rt)
    mustFinish(b.rt.runHeadless(200))
    expect(b.text()).toBe('-1\n')
  })

  /**
   * The four coordinate filters: `bmi` on each and `cmp.w $8e(a2)` /
   * `cmp.w #$a` on the far side. Row 10 is the last row of an 11-high window
   * and the routine rejects it, so a message posted from there is skipped.
   */
  it('a message on the window’s last row, or past its width, is skipped', () => {
    const b = upToWait(OPEN + 'A=Eliconify Begin(0,0,"x")\nWait 3\nPrint Eliconify Test\n')
    const w = b.rt.intuition.windows[0]!
    w.mouseX = 4
    w.mouseY = 10 // the eleventh row of an eleven-row window
    w.post(IDCMP_CLOSEWINDOW, 0)
    w.mouseX = w.width // one past the last column
    w.mouseY = 4
    w.post(IDCMP_CLOSEWINDOW, 0)
    mustFinish(b.rt.runHeadless(200))
    expect(b.text()).toBe(' 0\n')
  })

  it('Eliconify End closes the window but leaves the Workbench', () => {
    const { rt } = run(OPEN + 'A=Eliconify Begin(0,0,"x")\nEliconify End\n')
    expect(rt.intuition.windows).toHaveLength(0)
    expect(rt.intuition.workBenchOpen()).toBe(true)
  })

  /**
   * Routine 123 is the other three in a loop, and the two answers it can
   * give are Test's with the 1 turned into a 0 — which is the opposite of
   * what the guide's table for this keyword says. See the notes.
   */
  it('Eliconify Amos: the close gadget answers 0, and the window is gone', () => {
    // runHeadless presses the close gadget for it, so this runs the whole
    // Begin/Test/End loop and comes back
    const { rt, out } = run(OPEN + 'Print Eliconify Amos(40,30,"Busy")\n')
    expect(out).toBe(' 0\n')
    expect(rt.intuition.windows).toHaveLength(0)
    expect(rt.intuition.workBenchOpen()).toBe(true)
  })

  it('Eliconify Amos: the right button answers -1', () => {
    const b = boot(OPEN + 'Print Eliconify Amos(40,30,"Busy")\n')
    b.rt.frame() // Begin runs, and the keyword blocks
    rightClick(b.rt)
    mustFinish(b.rt.runHeadless(200))
    expect(b.text()).toBe('-1\n')
    expect(b.rt.intuition.windows).toHaveLength(0)
  })

  it('a window it cannot fit on the Workbench answers 2', () => {
    const { out } = run(OPEN + 'Print Eliconify Begin(600,20,"Hello")\n')
    expect(out).toBe(' 2\n')
  })

  it('1.0 spells the whole family with one keyword, and it is Eliconify Amos', () => {
    const v = extensionById('easylife-1.0')!
    const exts = new Map([[16, v.table]])
    let printed = ''
    const rt = new Runtime(tokenize(OPEN + 'Print Iconify Amos(10,10,"Z")\n', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[16, v]]),
      maxSteps: 200_000,
      onText: (t) => (printed += t),
    })
    mustFinish(rt.runHeadless(2000))
    expect(printed).toBe(' 0\n')
  })
})

describe('EasyLife: the Workbench three, now that there is one', () => {
  it('Elwb Open is TRUE, and opens the screen', () => {
    const { rt, out } = run(OPEN + 'Print Elwb Open\n')
    expect(out).toBe('-1\n')
    expect(rt.intuition.workBenchOpen()).toBe(true)
  })

  it('Elwb Test is FALSE with no Workbench and TRUE once there is one', () => {
    expect(run(OPEN + 'Print Elwb Test\n').out).toBe(' 0\n')
    expect(run(OPEN + 'A=Elwb Open\nPrint Elwb Test\n').out).toBe('-1\n')
  })

  /**
   * "Elwb close returns true if the workbench is closed when the function has
   * finished executing, even if it didn't close it because it was already
   * closed" — the `moveq #$ff,d0` arm, taken when WBenchToFront finds nothing.
   */
  it('Elwb Close is TRUE when there was nothing to close', () => {
    expect(run(OPEN + 'Print Elwb Close\n').out).toBe('-1\n')
  })

  it('and TRUE when it closed one', () => {
    const { rt, out } = run(OPEN + 'A=Elwb Open\nPrint Elwb Close\n')
    expect(out).toBe('-1\n')
    expect(rt.intuition.workBenchOpen()).toBe(false)
  })

  it('FALSE when a window on it makes CloseWorkBench refuse', () => {
    const { rt, out } = run(OPEN + 'A=Eliconify Begin(0,0,"x")\nPrint Elwb Close\n')
    expect(out).toBe(' 0\n')
    expect(rt.intuition.workBenchOpen()).toBe(true)
  })
})
