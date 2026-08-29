import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { mustFinish } from '../testing/run'
import { describeIf } from '../testing/fixture'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { firstCodeHunk } from '../tokens/libtok'
import { extensionById } from '../ext/registry'
import { IE_TASK } from './intuiextend'
import { Runtime } from './runtime'
import {
  IE_KICKSTART_VERSION,
  IE_SYS_AGNUS,
  IE_SYS_CHIP,
  IE_SYS_CPU,
  ieAntiqTable,
  ieDateString,
  ieDepthToColour,
  ieDistance,
  ieFastHex,
  ieIntSqr,
  iePalAntiq,
  iePalGrey,
  iePalNegativ,
  ieRotateBytes,
  ieTag,
  ieWhatIs,
} from './intuiextendsys'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!

function run(src: string): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ie.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

const val = (expr: string, pre = ''): string => lines(`${pre}Print ${expr}`)[0] ?? ''

/** the four-character code =What Is answers with, as text */
const code = (n: number): string =>
  String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)

describe('IntuiExtend 2.01b — the high-word defects', () => {
  /**
   * The family this group is really about: a routine builds a value in d3's
   * low word with `not.w` / `andi.w` / `move.w`, AMOS reads the whole of d3,
   * and whatever was in the high word comes back with it.
   */
  it('Pal Negativ leaves the sign extension of 0 - colour in the high word', () => {
    // 0 - 5 is $fffffffb; not.w gives $ffff0004 and andi.w #$fff keeps it
    expect(iePalNegativ(5)).toBe(-65532)
    expect(iePalNegativ(5) >>> 16).toBe(0xffff)
    // and the low word is c - 1, not the 4095 - c a negative wants
    expect(iePalNegativ(5) & 0xfff).toBe(4)
  })

  it('Pal Negativ is only right for black, where there is no borrow', () => {
    expect(iePalNegativ(0)).toBe(0xfff)
    // white should inverct to 0 and does not
    expect(iePalNegativ(0xfff) & 0xfff).toBe(0xffe)
  })

  it('Pal Antiq leaves the divu remainder in the high word', () => {
    const t = ieAntiqTable()
    // $111: nibbles 1+1+1 = 3, divides exactly, so the high word is clean
    expect(iePalAntiq(0x111, t) >>> 16).toBe(0)
    // $211: 2+1+1 = 4, remainder 1
    expect(iePalAntiq(0x211, t) >>> 16).toBe(1)
    // $311: 3+1+1 = 5, remainder 2
    expect(iePalAntiq(0x311, t) >>> 16).toBe(2)
  })

  it('Pal Antiq picks the right sepia entry regardless', () => {
    const t = ieAntiqTable()
    expect(iePalAntiq(0x111, t) & 0xffff).toBe(0x100) // average 1
    expect(iePalAntiq(0x555, t) & 0xffff).toBe(0x531) // average 5
  })

  it('Pal Grey is the one of the four with a clean high word', () => {
    expect(iePalGrey(0x555)).toBe(0x555)
    expect(iePalGrey(0xfff)).toBe(0xfff)
    expect(iePalGrey(0x900) >>> 16).toBe(0)
    // 9 + 0 + 0 = 9, divided by three is 3
    expect(iePalGrey(0x900)).toBe(0x333)
  })

  it('Int Sqr goes negative once the root reaches 32768, from its ext.l', () => {
    expect(ieIntSqr(144)).toBe(12)
    expect(ieIntSqr(1_000_000)).toBe(1000)
    expect(ieIntSqr(0x3fff_0000)).toBeGreaterThan(0)
    // 32768 squared is 1073741824, and the root comes back sign-extended
    expect(ieIntSqr(1_073_741_824)).toBe(-32768)
  })
})

describe('IntuiExtend 2.01b — the sepia ramp', () => {
  it('is red = index, green two below, blue four, held at zero', () => {
    const t = ieAntiqTable()
    expect([...t.slice(0, 6)]).toEqual([0x000, 0x100, 0x200, 0x310, 0x420, 0x531])
    expect(t[15]).toBe(0xfdb)
  })
})

/** the tables against the shipped binary; fixtures/ is gitignored */
const LIB_DIR = 'fixtures/extensions/intuiextend-2.01b'
const libFile = existsSync(LIB_DIR)
  ? readdirSync(LIB_DIR).find((f) => /\.lib$/i.test(f))
  : undefined

describeIf('IntuiExtend 2.01b — tables against the binary', libFile !== undefined, () => {
  const code_ = (): Uint8Array =>
    firstCodeHunk(new Uint8Array(readFileSync(`${LIB_DIR}/${libFile}`)))

  it('reproduces the sepia ramp at $1d28+$58', () => {
    const c = code_()
    const s16 = (a: number): number => ((((c[a]! << 8) | c[a + 1]!) << 16) >> 16)
    const want = ieAntiqTable()
    for (let i = 0; i < 16; i++) expect(s16(0x1d28 + 0x58 + i * 2)).toBe(want[i])
  })

  it('finds the month table written as bytes where the loop reads longs', () => {
    const c = code_()
    const at = 0x1d28 + 0x1d2
    // January and February are longwords
    expect([c[at], c[at + 1], c[at + 2], c[at + 3]]).toEqual([0, 0, 0, 31])
    expect([c[at + 4], c[at + 5], c[at + 6], c[at + 7]]).toEqual([0, 0, 0, 28])
    // March onwards are single bytes: 31, 30, 31, 30 ...
    expect([c[at + 8], c[at + 9], c[at + 10], c[at + 11]]).toEqual([31, 30, 31, 30])
  })
})

describe('IntuiExtend 2.01b — Wb Date', () => {
  it('reports January and February correctly', () => {
    expect(ieDateString(0)).toBe('01/01/1978')
    expect(ieDateString(30)).toBe('31/01/1978')
    expect(ieDateString(31)).toBe('01/02/1978')
    expect(ieDateString(58)).toBe('28/02/1978')
  })

  it('cannot report a month past March, because the table is bytes read as longs', () => {
    // 1 March 1978 is day 59 and is right
    expect(ieDateString(59)).toBe('01/03/1978')
    // so is nothing after it: 31 December 1978 is day 364
    expect(ieDateString(364)).toBe('306/03/1978')
  })

  it('takes the leap day in February, on a bare year AND 3', () => {
    // 1980 is a leap year: day 730 is 1 Jan 1980
    expect(ieDateString(730)).toBe('01/01/1980')
    expect(ieDateString(730 + 59)).toBe('29/02/1980')
    expect(ieDateString(730 + 60)).toBe('01/03/1980')
  })

  it('answers the epoch, because nothing here keeps a calendar', () => {
    expect(val('Wb Date')).toBe('01/01/1978')
  })
})

describe('IntuiExtend 2.01b — What Is', () => {
  const from = (bytes: number[]) => (at: number, size: number): number => {
    let v = 0
    for (let i = 0; i < size; i++) v = ((v << 8) | (bytes[at + i] ?? 0)) >>> 0
    return v
  }
  const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

  it('reads an IFF ILBM as IffP', () => {
    const b = [...ascii('FORM'), 0, 0, 0, 0, ...ascii('ILBM')]
    expect(code(ieWhatIs(from(b)))).toBe('IffP')
  })

  it('falls back to Iff? for an unrecognised FORM', () => {
    const b = [...ascii('FORM'), 0, 0, 0, 0, ...ascii('ZZZZ')]
    expect(code(ieWhatIs(from(b)))).toBe('Iff?')
  })

  it('reads an AMOS Pro source and an AMOS bank', () => {
    expect(code(ieWhatIs(from(ascii('AMOS Pro'))))).toBe('APro')
    const bank = [...ascii('AmBk'), 0, 0, 0, 0, 0, 0, 0, 0, ...ascii('Samp')]
    expect(code(ieWhatIs(from(bank)))).toBe('ABSp')
  })

  it('reports every RIFF file as a WAVE, because that arm has no branch', () => {
    // the compare at $2944 against "WAVE" is never acted on
    const wave = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]
    const avi = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('AVI ')]
    expect(code(ieWhatIs(from(wave)))).toBe('Wave')
    expect(code(ieWhatIs(from(avi)))).toBe('Wave')
  })

  it('echoes the magic itself for the three that ask for it', () => {
    expect(code(ieWhatIs(from(ascii('ZOOM'))))).toBe('ZOOM')
    expect(code(ieWhatIs(from(ascii('Warp'))))).toBe('Warp')
  })

  it('answers -1 for anything it does not know', () => {
    expect(ieWhatIs(from(ascii('nope')))).toBe(-1)
  })

  it('spells PNG as the author did', () => {
    // "PGN ", which is a typo in the shipped table and not a transcription one
    expect(code(ieWhatIs(from([0x89, 0x50, 0x4e, 0x47])))).toBe('PGN ')
  })
})

describe('IntuiExtend 2.01b — the small ones', () => {
  it('Wb Fast Hex is eight digits, most significant first', () => {
    expect(ieFastHex(0x12345678)).toBe('12345678')
    expect(ieFastHex(0)).toBe('00000000')
    expect(ieFastHex(-1)).toBe('FFFFFFFF')
  })

  it('Wb Encrypt and Wb Decrypt are a byte rotation and its inverse', () => {
    const s = 'Hello, world'
    expect(ieRotateBytes(ieRotateBytes(s, true), false)).toBe(s)
    // "A" is $41; ror.b #1 is $a0
    expect(ieRotateBytes('A', true).charCodeAt(0)).toBe(0xa0)
  })

  it('Wb Tag packs a TagItem into eight bytes', () => {
    const t = ieTag(0x80000001, 0x1234)
    expect(t).toHaveLength(8)
    expect([...t].map((c) => c.charCodeAt(0))).toEqual([0x80, 0, 0, 1, 0, 0, 0x12, 0x34])
  })

  it('Wb Depth To Colour is two to the depth', () => {
    expect(ieDepthToColour(1)).toBe(2)
    expect(ieDepthToColour(4)).toBe(16)
    expect(ieDepthToColour(8)).toBe(256)
  })

  it('Wb Depth To Colour does not answer 1 for a depth of 0', () => {
    // d2 starts at -1, the dbra runs the whole way round and every bit is set
    expect(ieDepthToColour(0)).toBe(0)
  })

  it('Wb Distance is the integer hypotenuse', () => {
    expect(ieDistance(0, 0, 3, 4)).toBe(5)
    expect(ieDistance(10, 10, 13, 14)).toBe(5)
  })

  it('Int Sqr answers 1 for 0, so two identical points are one apart', () => {
    // `cmp.l d3,d0 / blt / addq.l #$1,d3` at $50c8 rounds up whenever the
    // remainder has reached the root, and at zero both are zero
    expect(ieIntSqr(0)).toBe(1)
    expect(ieDistance(0, 0, 0, 0)).toBe(1)
  })
})

describe('IntuiExtend 2.01b — the machine it reports', () => {
  it('answers for the modelled A1200, as the guide names the values', () => {
    expect(val('Sys Agnus')).toBe(`${IE_SYS_AGNUS}`) // "53 - AA Alice PAL"
    expect(val('Sys Chip')).toBe(`${IE_SYS_CHIP}`) // "8 - AA Lisa"
    expect(val('Sys Cpu')).toBe(`${IE_SYS_CPU}`) // 68020
    expect(val('Sys Math')).toBe('0') // no coprocessor fitted
  })

  it('Sys Kickstart answers the sign of the difference, not the version', () => {
    expect(val(`Sys Kickstart(${IE_KICKSTART_VERSION})`)).toBe('0')
    expect(val(`Sys Kickstart(${IE_KICKSTART_VERSION - 1})`)).toBe('1')
    expect(val(`Sys Kickstart(${IE_KICKSTART_VERSION + 1})`)).toBe('-1')
  })

  it('reports 50Hz on both counts, which is the PAL beamcon0 default', () => {
    expect(val('Vbl Freq')).toBe('50')
    expect(val('Power Freq')).toBe('50')
  })

  it('Shires is a constant and reads nothing', () => {
    expect(val('Shires')).toBe('32')
  })

  it('Switch Pal and Switch Ntsc write BEAMCON0, as Personnal Set Pal does', () => {
    expect(run('Switch Ntsc').rt.beamcon0).toBe(0)
    expect(run('Switch Pal').rt.beamcon0).toBe(0x20)
    expect(run('Switch 72').rt.beamcon0).toBe(0x80)
  })
})

describe('IntuiExtend 2.01b — memory and addresses', () => {
  it('Adr Inc and Adr Dec move a WORD at an address', () => {
    const src = `Reserve As Work 5,16\nDoke Start(5),1000\nAdr Inc Start(5)\nPrint Deek(Start(5))`
    expect(lines(src)).toEqual(['1001'])
  })

  it('Adr Add and Adr Sub take a value To an address', () => {
    const src = `Reserve As Work 5,16\nDoke Start(5),100\nAdr Add Start(5) To 5\nAdr Sub Start(5) To 3\nPrint Deek(Start(5))`
    expect(lines(src)).toEqual(['102'])
  })

  it('Adr Swap.w exchanges two words', () => {
    const src = `Reserve As Work 5,16\nDoke Start(5),11\nDoke Start(5)+2,22\nAdr Swap.w Start(5) To Start(5)+2\nPrint Deek(Start(5))\nPrint Deek(Start(5)+2)`
    expect(lines(src)).toEqual(['22', '11'])
  })

  it('Adr Swap.l exchanges two longs', () => {
    const src = `Reserve As Work 5,16\nLoke Start(5),111111\nLoke Start(5)+4,222222\nAdr Swap.l Start(5) To Start(5)+4\nPrint Leek(Start(5))\nPrint Leek(Start(5)+4)`
    expect(lines(src)).toEqual(['222222', '111111'])
  })

  /**
   * `addq.w #$2,d3` at $4ba0, so what comes back is the TEXT and the length
   * word sits two bytes below it. `Str Free`'s `move.w -(a0),d0` reads it
   * back from exactly there, which is what settles the offset.
   */
  it('Str Store answers the text, with the length word below it', () => {
    const src = `A=Str Store("Hi")\nPrint Deek(A-2)\nPrint Peek(A)\nPrint Peek(A+1)\nPrint Peek(A+2)`
    // the length two bytes below, then "Hi", then the terminator
    expect(lines(src)).toEqual(['2', '72', '105', '0'])
  })

  it('Str Free takes that same address and frees from two bytes below', () => {
    // the pair round-trips: freeing must not throw, and the block comes back
    const src = `A=Str Store("Hi")\nStr Free A\nB=Str Store("Hi")\nPrint A=B`
    expect(lines(src)).toEqual(['-1'])
  })

  it('Segment Base is -1 until something loads, and Load Seg cannot here', () => {
    expect(val('Segment Base')).toBe('-1')
    expect(val('Segment Base', 'Load Seg "c:list"\n')).toBe('-1')
  })
})

describe('IntuiExtend 2.01b — Search', () => {
  it('finds a byte and answers the address before the match', () => {
    const src = `Reserve As Work 5,16\nPoke Start(5),1\nPoke Start(5)+1,2\nPoke Start(5)+2,99\nA=Search(Start(5),Start(5)+16,99)\nPrint A-Start(5)`
    expect(lines(src)).toEqual(['2'])
  })

  it('answers -1 when it reaches the end', () => {
    const src = `Reserve As Work 5,16\nPrint Search(Start(5),Start(5)+16,77)`
    expect(lines(src)).toEqual(['-1'])
  })

  it('leaves the address it reached in COLOR00, which it writes as it scans', () => {
    const b = run(`Reserve As Work 5,16\nA=Search(Start(5),Start(5)+16,77)`)
    expect(b.rt.copRegs.pal[0]).toBe((b.rt.bankBase(5) + 16) & 0xfff)
  })
})

describe('IntuiExtend 2.01b — Wb Reset', () => {
  it('asks the machine for a cold reboot and ends the program', () => {
    const b = run('Wb Reset\nPrint "never"')
    expect(b.out()).not.toContain('never')
    expect(b.rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'wb reset' })
  })
})

describe('IntuiExtend 2.01b — Wb Swatch', () => {
  /** put a time in the six time registers, S1 first, and read it back */
  const at = (h10: number, h1: number, m10: number, m1: number, s10: number, s1: number): string => {
    const exts = new Map([[23, ie.table]])
    let printed = ''
    const rt = new Runtime(tokenize('Print Wb Swatch', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[23, ie]]),
      maxSteps: 100_000,
      onText: (t) => (printed += t),
    })
    const bc = rt.machine.battclock!
    const now = rt.host.clock.now()
    bc.read(now)
    const digits = [s1, s10, m1, m10, h1, h10]
    for (let i = 0; i < 6; i++) bc.write(i, digits[i]!, now)
    mustFinish(rt.runHeadless(5000))
    return printed.trim()
  }

  /** Sysn: "HEURE$=Chaîne sous le format 'HH:MM:SS'." */
  it('reads the six time registers as HH:MM:SS', () => {
    expect(at(1, 4, 2, 5, 3, 6)).toBe('14:25:36')
  })

  /** the registers come off the chip S1 first, so the string is built backwards */
  it('the highest register is the first character', () => {
    expect(at(2, 3, 5, 9, 0, 1)).toBe('23:59:01')
  })

  it('midnight is all zeroes', () => {
    expect(at(0, 0, 0, 0, 0, 0)).toBe('00:00:00')
  })

  /**
   * `andi.w #$f,d0` then `addi.b #$30,d0`, which is the conversion
   * ../amiga/battclock.ts records for the other two extensions that touch the
   * chip: a nibble of fifteen leaves as "?".
   */
  it('a nibble past nine comes out as its own ASCII', () => {
    expect(at(15, 15, 0, 0, 0, 0)).toBe('??:00:00')
  })

  /** no arguments, and a string answer */
  it('takes nothing and answers a string', () => {
    expect(ie.tokens.find((t) => t.name === 'wb swatch')!.spec).toBe('2')
  })
})

/**
 * The same keywords, reached through AMOS rather than through their helpers.
 *
 * Everything above calls the exported function directly, which checks the
 * arithmetic and not the wiring. A helper that is right and a keyword that
 * never reaches it look identical from outside, so src/coverage/gate.ts
 * fails the run when a FAITHFUL keyword is never dispatched. These are the
 * dispatches.
 */
describe('IntuiExtend 2.01b, reached through AMOS', () => {
  const W = 'Reserve As Work 5,64\n'
  const SCREEN = 'Screen Open 0,320,256,16,Lowres\nCls 0\n'

  it('Adr Dec takes one off the word (routine 234, $4a50)', () => {
    expect(lines(`${W}Doke Start(5),1000\nAdr Dec Start(5)\nPrint Deek(Start(5))`)).toEqual(['999'])
  })

  it('Adr Swap.b exchanges two bytes (routine 236, $4a5e)', () => {
    const src = `${W}Poke Start(5),11\nPoke Start(5)+1,22\nAdr Swap.b Start(5) To Start(5)+1\nPrint Peek(Start(5))\nPrint Peek(Start(5)+1)`
    expect(lines(src)).toEqual(['22', '11'])
  })

  it('Wb Locker records its argument and does nothing else (routine 99, $3526)', () => {
    // `move.w d0,-$90(a5)` is the entire routine, and no keyword reads the
    // variable back, so running it is all there is to see
    expect(lines('Wb Locker 3\nPrint "ok"')).toEqual(['ok'])
  })

  it('Wb Free Image ignores a null pointer (routine 102, $35ee)', () => {
    expect(lines('Wb Free Image 0\nPrint "ok"')).toEqual(['ok'])
  })

  it('Unload Seg leaves the segment slot at -1 (routine 24, $2ba0)', () => {
    // there is no 68000 here to have loaded one, so `Segment Base` reads the
    // -1 the routine writes whether or not anything was unloaded
    expect(lines('Unload Seg 0\nPrint Segment Base')).toEqual(['-1'])
  })

  it('Task Name points ln_Name at the string (routine 106, $3638)', () => {
    expect(lines('Task Name "amos" To My Task\nPrint "ok"')).toEqual(['ok'])
  })

  it('Wb Gauge splits the bar at X1 + (X2-X1) * P / 100 (routine 242, $4aba)', () => {
    // 0 + 99 * 50 / 100 is 49, so CJ runs to 49 and CF from 50
    const src = `${SCREEN}Wb Gauge 50,2,3,0,0 To 99,9\nPrint Point(10,5)\nPrint Point(60,5)`
    expect(lines(src)).toEqual(['2', '3'])
  })

  it('Quick Scroll copies a rectangle to an offset of itself (routine 282, $5426)', () => {
    const src = `${SCREEN}Ink 5\nBar 0,0 To 15,15\nQuick Scroll 0,0 To 16,16,32,0\nPrint Point(35,5)`
    expect(lines(src)).toEqual(['5'])
  })

  it('=Int Sqr, =Wb Distance and =Wb Depth To Colour (routines 276, 257, 316)', () => {
    expect(val('Int Sqr(144)')).toBe('12')
    // 3-4-5, through that same square root
    expect(val('Wb Distance(0,0 To 3,4)')).toBe('5')
    // every bit below depth set, and then one added, so 2^depth
    expect(val('Wb Depth To Colour(4)')).toBe('16')
  })

  it('=Pal Grey, =Pal Antiq and =Pal Filter (routines 69, 70, 243)', () => {
    expect(val('Pal Grey($900)')).toBe(String(0x333))
    // 5+5+5 divides by three exactly, so nothing is left in the high word
    expect(val('Pal Antiq($555)')).toBe(String(0x531))
    expect(val('Pal Filter($FFF,$F0)')).toBe(String(0xf0))
  })

  it('=Wb Fast Hex, and =Wb Encrypt back through =Wb Decrypt', () => {
    // 112 ($36a4) rols a nibble at a time, so all eight digits come out
    expect(val('Wb Fast Hex(255)')).toBe('000000FF')
    // 164 ($3c38) is `ror.b #$1` and 165 ($3c5e) is `rol.b #$1`
    expect(val('Wb Decrypt(Wb Encrypt("Hello"))')).toBe('Hello')
  })

  it('=My Task is the pointer AMOS keeps at -$1c(a5) (routine 17, $25da)', () => {
    expect(val('My Task')).toBe(String(IE_TASK))
  })

  it('=Wb Open answers a screen and =Wb Close succeeds (routines 14, 15)', () => {
    const src = 'A=Wb Open\nIf A<>0 Then Print "opened"\nPrint Wb Close'
    expect(lines(src)).toEqual(['opened', '1'])
  })

  it('=Wb Bob Image answers zero with no Bob bank (routine 101, $3590)', () => {
    expect(val('Wb Bob Image(1)')).toBe('0')
  })

  it('=What Is reads the signature at an address (routine 22, $268c)', () => {
    const src = `${W}Poke Start(5),Asc("Z")\nPoke Start(5)+1,Asc("O")\nPoke Start(5)+2,Asc("O")\nPoke Start(5)+3,Asc("M")\nPrint What Is(Start(5))`
    expect(code(Number(lines(src)[0]))).toBe('ZOOM')
  })
})
