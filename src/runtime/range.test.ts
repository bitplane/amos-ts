import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { NullAudio, PAULA_CLOCK_PAL } from '../amiga/paula'
import { Runtime } from './runtime'
import { RANGE_CLOCKS } from './range'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 9, twice over off the binary: `move.l a3,$178(a5)` and `moveq #$8,d0`.
 * The two builds share one port because 2.6's token table is a strict prefix
 * of 2.9Plus's — bound here as 2.9Plus, the superset.
 */
const range = extensionById('range-2.0')!

interface Boot {
  rt: Runtime
  audio: NullAudio
  out: () => string
}

function boot(src: string): Boot {
  const exts = new Map([[9, range.table]])
  const audio = new NullAudio()
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[9, range]]),
    audio,
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  return { rt, audio, out: () => printed }
}

function run(src: string): Boot {
  const b = boot(src)
  const r = b.rt.runHeadless(4000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return b
}

const num = (src: string): number => Number(run(src).out().trim())
const text = (src: string): string => run(src).out()

describe('Range — the two builds and the startup', () => {
  it('2.6 is a strict PREFIX of 2.9Plus, so one port serves both', () => {
    // all 52 entries identical: ids, specs and routine numbers alike
    const older = extensionById('range-1.0')!
    for (let i = 0; i < older.tokens.length; i++) {
      expect(range.tokens[i]).toEqual(older.tokens[i])
    }
    expect(range.tokens.length).toBeGreaterThan(older.tokens.length)
  })

  it('routine 0 picks the audio clock, and the constants are Paula\'s', () => {
    // `move.l #$361f0f,$48(a3)` and the NTSC branch `move.l #$369e99`
    expect(RANGE_CLOCKS.pal).toBe(0x361f0f)
    expect(RANGE_CLOCKS.ntsc).toBe(0x369e99)
    expect(boot('').rt.range.clock).toBe(PAULA_CLOCK_PAL)
  })
})

describe('Range — values and strings', () => {
  it('=Range(v, lo To hi) is a CLAMP (routine 3, $4fa)', () => {
    expect(num('Print Range(5,1 To 10)')).toBe(5)
    expect(num('Print Range(-3,1 To 10)')).toBe(1)
    expect(num('Print Range(99,1 To 10)')).toBe(10)
    expect(num('Print Range(1,1 To 10)')).toBe(1)
    expect(num('Print Range(10,1 To 10)')).toBe(10)
  })

  it('an inverted range answers lo, because the top test runs first', () => {
    // `bgt` clamps to hi and jumps BACK to the bottom test, which then fires
    expect(num('Print Range(5,10 To 1)')).toBe(10)
  })

  it('=Js Screen is a 336x224 box on a 16-pixel border (routine 6, $5d8)', () => {
    // $150 = 336 and $e0 = 224, a 320x200 display plus 16 pixels each side
    expect(num('Print Js Screen(0,0,0,0)')).toBe(-1)
    expect(num('Print Js Screen(0,0,-16,-16)')).toBe(-1)
    expect(num('Print Js Screen(0,0,-17,0)')).toBe(0)
    expect(num('Print Js Screen(0,0,319,0)')).toBe(-1)
    expect(num('Print Js Screen(0,0,320,0)')).toBe(0)
    expect(num('Print Js Screen(0,0,0,207)')).toBe(-1)
    expect(num('Print Js Screen(0,0,0,208)')).toBe(0)
  })

  it('Mk and Cv round-trip, big-endian (routines 8-10, 12-14)', () => {
    expect(num('Print Cvb(Mkb$(200))')).toBe(200)
    expect(num('Print Cvi(Mki$(4660))')).toBe(4660)
    expect(num('Print Cvl(Mkl$(305419896))')).toBe(305419896)
    // the widths are 1, 2 and 4 bytes
    expect(num('Print Len(Mkb$(1))')).toBe(1)
    expect(num('Print Len(Mki$(1))')).toBe(2)
    expect(num('Print Len(Mkl$(1))')).toBe(4)
    // and Mkb$ keeps only the low byte
    expect(num('Print Cvb(Mkb$(511))')).toBe(255)
  })

  it('Cvi and Cvb zero-extend, where Cvl cannot (clr.l d3 first)', () => {
    expect(num('Print Cvi(Mki$(65535))')).toBe(65535)
    expect(num('Print Cvl(Mkl$(-1))')).toBe(-1)
  })

  it('=Wrap walks BACKWARDS to a break character (routine 31, $872)', () => {
    // space, comma, full stop, question mark, exclamation mark, hyphen
    expect(num('Print Wrap("hello world here",11)')).toBe(11)
    expect(num('Print Wrap("hello world here",13)')).toBe(11)
    expect(num('Print Wrap("one-two",6)')).toBe(3)
    expect(num('Print Wrap("a,b",2)')).toBe(1)
  })

  it('=Wrap clamps past the end to the LENGTH, which is one byte too far', () => {
    // `cmp.w d2,d7 / bgt` substitutes the length, and `move.b $2(a1,d7.l)`
    // then indexes it 0-based --- so the first byte examined is one past the
    // string. With no break in "ab" the walk runs down to 0 and stops there,
    // `cmpi.l #$1,d7 / bge` having never looked at index 0 either
    expect(num('Print Wrap("ab",99)')).toBe(0)
    expect(num('Print Wrap("xyz",3)')).toBe(0)
    // and a break inside is still found from wherever the walk starts
    expect(num('Print Wrap("a b",99)')).toBe(1)
  })
})

describe('Range — the select-case built from two keywords and a latch', () => {
  it('Case / Of / =Case latch a matching arm (routines 16, 20, 19)', () => {
    expect(num('Case 2 : Of 1,10 : Of 2,20 : Of 3,30 : Print Case')).toBe(20)
  })

  it('Case CLEARS the result, so a run of misses answers 0', () => {
    // `move.l #$0,$4(a0)` in routine 16
    expect(num('Case 9 : Of 1,10 : Of 2,20 : Print Case')).toBe(0)
    expect(num('Case 1 : Of 1,10 : Case 5 : Print Case')).toBe(0)
  })

  it('the LAST matching Of wins, not the first — nothing stops a rewrite', () => {
    expect(num('Case 1 : Of 1,10 : Of 1,99 : Print Case')).toBe(99)
  })

  it('Case$ and Of$ compare by length then by content (routines 18, 22)', () => {
    expect(num('Case$ "two" : Of$ "one",1 : Of$ "two",2 : Print Case')).toBe(2)
    expect(num('Case$ "two" : Of$ "three",3 : Print Case')).toBe(0)
  })

  it('DEFECT: Of$ never compares byte 0, so a first-letter difference matches', () => {
    // `subq.l #$1,d0` then a loop ending on `tst.l d0 / bne` --- indices
    // len-1 down to 1, and index 0 is never reached
    expect(num('Case$ "bat" : Of$ "cat",7 : Print Case')).toBe(7)
    // a difference anywhere else still misses
    expect(num('Case$ "bat" : Of$ "bit",7 : Print Case')).toBe(0)
  })

  it('an EMPTY Case$ can never be matched, not even by another empty', () => {
    // routine 18 stores no subject at all for a zero length
    expect(num('Case$ "" : Of$ "",5 : Print Case')).toBe(0)
  })
})

describe('Range — Shuffle and Rand', () => {
  it('Shuffle leaves a permutation of 1..n that Rand reads back', () => {
    const b = run('Reserve As Data 1,256\nShuffle 1,10,7\nA$=""\nFor I=0 To 9 : A$=A$+Str$(Rand(I,1)) : Next I\nPrint A$')
    const got = b.out().trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n))
    expect(got).toHaveLength(10)
    expect([...got].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('the same seed gives the same order, and a different seed a different one', () => {
    const order = (seed: number): string =>
      text(`Reserve As Data 1,256\nShuffle 1,10,${seed}\nFor I=0 To 9 : Print Rand(I,1); : Next I`)
    expect(order(7)).toBe(order(7))
    expect(order(7)).not.toBe(order(3))
  })

  it('Shuffle raises on a bank that was never reserved', () => {
    expect(() => run('Shuffle 4,10,1')).toThrow(/bank not reserved/i)
  })
})

describe('Range — the object metrics', () => {
  it('the eight accessors answer -1 with no bank at all (routine 53, $cf2)', () => {
    // `move.l #$ffffffff,d3` is loaded BEFORE the range test and the callers
    // only overwrite it once they have an image
    expect(num('Print B Width(1)')).toBe(-1)
    expect(num('Print B Height(1)')).toBe(-1)
    expect(num('Print B Colours(1)')).toBe(-1)
    expect(num('Print I Width(1)')).toBe(-1)
    expect(num('Print I Height(1)')).toBe(-1)
    expect(num('Print I Colours(1)')).toBe(-1)
    expect(num('Print H Spot X(1)')).toBe(-1)
    expect(num('Print H Spot Y(1)')).toBe(-1)
  })

  it('a real image answers its header fields, and 0 or past the count is -1', () => {
    const b = boot('Print B Width(1);",";B Height(1);",";B Colours(1);",";H Spot X(1);",";H Spot Y(1);",";B Width(0);",";B Width(2)')
    b.rt.spriteBank = { images: [{ width: 32, height: 20, depth: 3, hotX: 4, hotY: 5, rowBytes: 4 }] } as never
    b.rt.runHeadless(4000)
    // width is the WORD count shifted left four, so always a multiple of 16;
    // colours is 2^planes, not the plane count
    expect(b.out().replace(/\s+/g, '')).toBe('32,20,8,4,5,-1,-1')
  })
})

describe('Range — the rest of this slice', () => {
  it('Sam Speed divides the clock onto the selected voices (routine 1, $4b2)', () => {
    const b = run('Sam Speed 5,8000')
    const freqs = b.audio.events.filter((e) => e.kind === 'freq')
    // bits 0 and 2 of the mask --- voices 0 and 2, and no others
    expect(freqs.map((e) => e.voice)).toEqual([0, 2])
  })

  it('Game Area and In Screen are the only pair that share their box', () => {
    // the low edge is the origin less the MARGIN, the high edge the origin
    // plus the WIDTH --- not symmetric
    expect(num('Game Area 16,16 To 320,200 : Print In Screen(0,0,0,0)')).toBe(-1)
    expect(num('Game Area 16,16 To 320,200 : Print In Screen(0,0,-16,0)')).toBe(-1)
    expect(num('Game Area 16,16 To 320,200 : Print In Screen(0,0,-17,0)')).toBe(0)
    expect(num('Game Area 16,16 To 320,200 : Print In Screen(0,0,319,0)')).toBe(-1)
    expect(num('Game Area 16,16 To 320,200 : Print In Screen(0,0,320,0)')).toBe(0)
  })

  it('In Screen SAVES its four arguments for In Screen Bob to read back', () => {
    const b = run('Game Area 16,16 To 320,200 : A=In Screen(10,20,30,40)')
    expect(b.rt.range).toMatchObject({ inOx: 10, inOy: 20, inX: 30, inY: 40 })
  })

  it('Bank Name pads to eight and Bank Name$ never trims (routines 56, 60)', () => {
    // `cmpi.l #$8,d0 / bge` sends anything of eight or more to seven
    expect(text('Reserve As Data 1,16\nBank Name 1,"Fred"\nPrint "["+Bank Name$(1)+"]"')).toContain('[Fred    ]')
    expect(text('Reserve As Data 1,16\nBank Name 1,"Longerthan8"\nPrint "["+Bank Name$(1)+"]"')).toContain('[Longerth]')
  })

  it('the paddle and printer lines answer for hardware that is not there', () => {
    // POTGO's START with no paddle attached, and CIA-B PRA idling high
    expect(() => run('Analog Scan')).not.toThrow()
    expect(num('Print Analog X(0)')).toBe(0)
    expect(num('Print Analog Y(1)')).toBe(0)
    expect(num('Print Busy Printer')).toBe(-1)
    expect(num('Print No Paper')).toBe(-1)
  })

  it('Float Bob Reset saves the counter and zeroes it (routines 29, 30)', () => {
    const b = run('Float Bob Reset\nPrint Last Float Bob')
    expect(b.out().trim()).toBe('0')
    expect(b.rt.range.floatSaved).toBe(0)
  })
})
