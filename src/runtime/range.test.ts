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

describe('Range — the float bobs (routines 27, 28, 63, 73)', () => {
  it('Float Bob numbers itself: base, base+1, base+2 ...', () => {
    // routine 27: `move.l $10(a0),d7 / add.l d7,d1 / addq.l #$1,d7`
    const b = run('Float Bob 5,10,20,1\nFloat Bob 5,30,40,2\nPrint Last Float Bob')
    expect(b.out().trim()).toBe('2')
    expect(b.rt.bobs.get(5)).toMatchObject({ x: 10, y: 20, image: 1 })
    expect(b.rt.bobs.get(6)).toMatchObject({ x: 30, y: 40, image: 2 })
    // $18 keeps the base the LAST call gave, for Float Bob Clear
    expect(b.rt.range.floatBase).toBe(5)
  })

  it('Float Offset shifts every Float Bob, x from $4 and y from $8', () => {
    // routine 73 pops in reverse source order: $8 first, then $4
    const b = run('Float Offset 100,200\nFloat Bob 1,10,20,1')
    expect(b.rt.range.floatOffX).toBe(100)
    expect(b.rt.range.floatOffY).toBe(200)
    expect(b.rt.bobs.get(1)).toMatchObject({ x: 110, y: 220 })
  })

  it('Float Bob Clear takes down the tail of the frame before', () => {
    // three last frame, one this frame: 1 stays, 2 and 3 go
    const b = run(['Float Bob 1,0,0,1', 'Float Bob 1,0,0,1', 'Float Bob 1,0,0,1', 'Float Bob Reset', 'Float Bob 1,0,0,1', 'Float Bob Clear'].join('\n'))
    expect(b.rt.range.floatSaved).toBe(3)
    expect(b.rt.range.floatCount).toBe(1)
    expect(b.rt.bobs.has(1)).toBe(true)
    expect(b.rt.bobs.has(2)).toBe(false)
    expect(b.rt.bobs.has(3)).toBe(false)
  })

  it('an equal count clears nothing — `cmp.l d2,d6 / ble`', () => {
    const b = run(['Float Bob 1,0,0,1', 'Float Bob Reset', 'Float Bob 1,0,0,1', 'Float Bob Clear'].join('\n'))
    expect(b.rt.bobs.has(1)).toBe(true)
  })

  it('Game Area defaults to the whole screen, not to zero', () => {
    // the block at $68c ships -16/320/-16/200; slice 1 had them all at 0,
    // which made a program that never called Game Area see nothing on screen
    const b = run('Print In Screen(0,0,100,100)')
    expect(b.out().trim()).toBe('-1')
    expect(b.rt.range.areaX).toBe(-16)
    expect(b.rt.range.areaW).toBe(320)
  })

  it('In Screen Bob draws relative to the origin, and answers 1 not -1', () => {
    // routine 63 pushes x-ox and y-oy back and calls routine 27
    const b = run('Print In Screen Bob(3,7,50,60,120,130)')
    expect(b.out().trim()).toBe('1') // `moveq #$1,d3`, where In Screen has -1
    expect(b.rt.bobs.get(3)).toMatchObject({ x: 70, y: 70, image: 7 })
  })

  it('In Screen Bob outside the area draws nothing and answers 0', () => {
    const b = run('Game Area 0,0 To 32,32\nPrint In Screen Bob(3,7,0,0,300,300)')
    expect(b.out().trim()).toBe('0')
    expect(b.rt.bobs.size).toBe(0)
    expect(b.rt.range.floatCount).toBe(0)
  })
})

describe('Range — the colour remappers (routines 33-41)', () => {
  /** two images in the bob bank, so the walk has something to walk */
  const withBank = (prog: string): Boot =>
    run(['Screen Open 0,320,200,16,Lowres', 'Ink 3', 'Bar 0,0 To 15,7', 'Ink 5', 'Bar 0,8 To 15,15', 'Get Bob 1,0,0 To 16,16', prog].join('\n'))

  const colours = (b: Boot): Set<number> => {
    const img = b.rt.spriteBank!.images[0]!
    const seen = new Set<number>()
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) seen.add(img.pixelAt(x, y))
    return seen
  }

  it('Change Bob Colours moves one colour and leaves the rest', () => {
    const b = withBank('Change Bob Colours 1,3,9')
    const c = colours(b)
    expect(c.has(9)).toBe(true)
    expect(c.has(3)).toBe(false)
    expect(c.has(5)).toBe(true) // untouched
  })

  it('Exchange Bob Colours swaps the pair, by a+b-v', () => {
    const b = withBank('Exchange Bob Colours 1,3,5')
    const img = b.rt.spriteBank!.images[0]!
    expect(img.pixelAt(0, 0)).toBe(5) // was 3
    expect(img.pixelAt(0, 12)).toBe(3) // was 5
  })

  it('Make Bob Colour flattens every NON-zero pixel — `tst.w d6 / bne`', () => {
    const b = withBank('Make Bob Colour 1,7')
    expect([...colours(b)].sort((x, y) => x - y)).toEqual([7])
  })

  it('a colour 0 that is transparent survives Make Bob Colour', () => {
    // the top-left 8x8 left at 0 by a smaller Bar, so 0 is present and stays
    const b = run(
      ['Screen Open 0,320,200,16,Lowres', 'Cls 0', 'Ink 4', 'Bar 8,8 To 15,15', 'Get Bob 1,0,0 To 16,16', 'Make Bob Colour 1,7'].join('\n'),
    )
    const img = b.rt.spriteBank!.images[0]!
    expect(img.pixelAt(0, 0)).toBe(0)
    expect(img.pixelAt(10, 10)).toBe(7)
  })

  it('an image number out of range changes nothing and raises nothing', () => {
    // `subq.l #$1,d0 / andi.l #$ffff,d0 / cmp.w d7,d0 / bge` --- and n = 0
    // becomes $ffff, so it falls out the top rather than the bottom
    const b = withBank('Change Bob Colours 99,3,9')
    expect(colours(b).has(3)).toBe(true)
    expect(() => run(['Screen Open 0,320,200,16,Lowres', 'Ink 3', 'Bar 0,0 To 15,15', 'Get Bob 1,0,0 To 16,16', 'Change Bob Colours 0,3,9'].join('\n'))).not.toThrow()
  })

  it('cmpa.w compares the WHOLE argument, so 65536 matches no pixel', () => {
    const b = withBank('Change Bob Colours 1,65536,9')
    expect(colours(b).has(9)).toBe(false)
  })
})

describe('Range — List Palette and List Bobs (routines 32, 50-52, 57)', () => {
  it('List Palette prints five spaces per colour until the papers run out', () => {
    // ESC "B" is Paper (CEsc in +W.s), and the escape is range-checked, so
    // a 16-colour screen gets sixteen swatches and then error 60
    const b = boot('Screen Open 0,320,200,16,Lowres\nList Palette')
    expect(() => b.rt.runHeadless(4000)).toThrow(/illegal text window parameter/)
    expect(b.out().length).toBe(16 * 5)
  })

  it('List Palette gets all sixty-four on a 64-colour screen', () => {
    const b = run('Screen Open 0,320,200,64,Lowres\nList Palette')
    expect(b.out().length).toBe(64 * 5)
  })

  it('List Bobs steps by 1 + the step, not by the step', () => {
    // `addq.l #$1,d6 / add.l $1c(a0),d6` --- 33 by default, and 52 stores
    // the pair for later calls to read
    const b = run(
      ['Screen Open 0,320,200,16,Lowres', 'Ink 3', 'Bar 0,0 To 15,15', 'Get Bob 1,0,0 To 16,16', 'List Bobs 1 To 1,10,10'].join('\n'),
    )
    expect(b.rt.range.listStepX).toBe(10)
    expect(b.rt.range.listStepY).toBe(10)
  })

  it('List Bobs stops dead at an image the bank has not got', () => {
    // `cmp.w (a2),d1 / bhi .out` --- no error, just an end
    expect(() =>
      run(['Screen Open 0,320,200,16,Lowres', 'Ink 3', 'Bar 0,0 To 15,15', 'Get Bob 1,0,0 To 16,16', 'List Bobs 1 To 40'].join('\n')),
    ).not.toThrow()
  })
})

describe('Range — Bank Screen and Unbank Screen (routines 58, 59)', () => {
  const prog = (extra: string): string =>
    ['Screen Open 0,320,200,4,Lowres', 'Cls 0', 'Ink 1', 'Bar 0,10 To 319,19', 'Reserve As Data 5,8192', extra].join('\n')

  it('the two words at the front are the length and the plane it started at', () => {
    const b = run(prog('Bank Screen 10,20 To 5'))
    const d = b.rt.memBanks.get(5)!.data
    // (20-10) rows * 10 longs - 1
    expect((d[0]! << 8) | d[1]!).toBe(10 * 10 - 1)
    // a two-plane screen: the walk comes down from five and the first
    // plane it finds is 1, whose table offset is 4
    expect((d[2]! << 8) | d[3]!).toBe(4)
  })

  it('a strip round-trips through a bank, and can land on another row', () => {
    const b = run(prog('Bank Screen 10,20 To 5\nCls 0\nUnbank Screen 5 To 100'))
    expect(b.rt.screen.rp.bitMap.pixelAt(0, 105)).toBe(1)
    expect(b.rt.screen.rp.bitMap.pixelAt(0, 15)).toBe(0) // it moved, it did not copy
  })

  it('the arguments given the wrong way round are swapped, not refused', () => {
    // `sub.l d1,d3 / blt .swap`
    const b = run(prog('Bank Screen 20,10 To 5'))
    expect((b.rt.memBanks.get(5)!.data[0]! << 8) | b.rt.memBanks.get(5)!.data[1]!).toBe(99)
  })

  it('an unreserved bank is an error, as Bank Name$ has', () => {
    expect(() => run('Screen Open 0,320,200,4,Lowres\nBank Screen 0,10 To 7')).toThrow()
  })
})

describe('Range — the icon forms of the colour remappers (routines 34, 37, 40)', () => {
  /**
   * Routines 34, 37 and 40 are 33, 36 and 39 with `moveq #$2,d2` where the
   * bob forms have `moveq #$1,d2` — the icon bank instead of the bob bank —
   * and they share the same three walks at 35, 38 and 41. Which is exactly
   * why they need their own test: the routine pairs are byte-identical apart
   * from that one immediate, so nothing but running them proves the port
   * reached the other bank.
   */
  const withIcons = (prog: string): Boot =>
    run(['Screen Open 0,320,200,16,Lowres', 'Ink 3', 'Bar 0,0 To 15,7', 'Ink 5', 'Bar 0,8 To 15,15', 'Get Icon 1,0,0 To 16,16', prog].join('\n'))

  it('Change Icon Colours reaches the ICON bank, not the bob bank', () => {
    const b = withIcons('Change Icon Colours 1,3,9')
    const img = b.rt.iconBank!.images[0]!
    expect(img.pixelAt(0, 0)).toBe(9)
    expect(img.pixelAt(0, 12)).toBe(5)
  })

  it('Exchange Icon Colours swaps the pair', () => {
    const b = withIcons('Exchange Icon Colours 1,3,5')
    const img = b.rt.iconBank!.images[0]!
    expect(img.pixelAt(0, 0)).toBe(5)
    expect(img.pixelAt(0, 12)).toBe(3)
  })

  it('Make Icon Colour flattens the non-zero pixels', () => {
    const b = withIcons('Make Icon Colour 1,7')
    const img = b.rt.iconBank!.images[0]!
    expect(img.pixelAt(0, 0)).toBe(7)
    expect(img.pixelAt(0, 12)).toBe(7)
  })
})

describe('Range — 2.9Plus: the stack, the values and the libraries', () => {
  it('Push stores its arguments REVERSED, and Pull indexes them', () => {
    // routines 81/79/82/83/84 pop in reverse source order and store forwards
    const b = run('Push 10,20,30\nPrint Pull(0);" ";Pull(1);" ";Pull(2)')
    expect(b.out().replace(/\s+/g, '')).toBe('302010')
  })

  it('Pull outside the six Push slots is not range-tested by the original', () => {
    // `move.l (a3)+,d0 / lsl.l #$2,d0 / move.l (a0,d0.l),d3` --- no check at
    // all; this port answers 0 rather than inventing what the block held
    expect(num('Print Pull(20)')).toBe(0)
  })

  it('Fmod is a WORD remainder, and its operands are the other way round', () => {
    // `divu.w d1,d3 / sub.w d3,d3 / swap d3`, and d3 is the SECOND argument
    expect(num('Print Fmod(7,23)')).toBe(2)
    expect(num('Print Fmod(3,10)')).toBe(1)
    expect(() => run('Print Fmod(0,10)')).toThrow()
  })

  it('Void swallows a value — routine 86 is two instructions', () => {
    expect(() => run('Void 42')).not.toThrow()
    expect(text('Void 42\nPrint "after"')).toContain('after')
  })

  it('Float Back keeps its long at the block\'s first field', () => {
    const b = run('Float Back 99')
    expect(b.rt.range.floatBack).toBe(99)
  })

  it('Library Open answers a base for a modelled library and 0 for the rest', () => {
    expect(num('Print Library Open("dos.library")')).not.toBe(0)
    expect(num('Print Library Open("nosuch.library")')).toBe(0)
    // `move.w (a2),d3 / beq` --- an empty name never reaches OpenLibrary
    expect(num('Print Library Open("")')).toBe(0)
    // CloseLibrary returns nothing, so d0 is undefined by the ABI
    expect(num('Print Library Close(0)')).toBe(0)
  })

  it('Key Scan reads CIA-A SDR, which nothing here drives', () => {
    // `move.b $bfec01.l,d3 / btst.b #$0,d3 / beq` --- an idle Amiga too
    expect(num('Print Key Scan')).toBe(0)
  })
})

describe('Range — 2.9Plus: the bank strings (routines 64-67)', () => {
  const setup = 'Reserve As Data 5,256\nBank Str End 0\n'

  it('Bank String writes the text, the terminator, and moves the pointer', () => {
    const b = run(setup + 'Bank String 5,"hello",0\nPrint Bank Str Ptr')
    expect(b.out().trim()).toBe('6') // five bytes and the terminator
    const d = b.rt.memBanks.get(5)!.data
    expect(String.fromCharCode(...d.slice(0, 5))).toBe('hello')
    expect(d[5]).toBe(0)
  })

  it('a list round-trips, and Bank Str$ walks it on its own', () => {
    const b = run(
      'Reserve As Data 5,256\nBank Str End 44\n' +
        'Bank String 5,"one",0\nBank String 5,"two",Bank Str Ptr\n' +
        'Print Bank Str$(5,0)\nPrint Bank Str$(5,Bank Str Ptr)',
    )
    expect(b.out().split('\n').filter((l) => l !== '')).toEqual(['one', 'two'])
  })

  it('DEFECT: the DEFAULT terminator is zero, and zero can never be found', () => {
    // `move.b -$1(a2,d2.l),d0 / beq .none` comes BEFORE `cmp.b $50(a0),d0`,
    // so a NUL always ends the search as a failure --- and $50 starts at
    // zero. Until a program calls `Bank Str End` with something else, every
    // `Bank Str$` answers the not-found Chr$(10), including one reading a
    // string `Bank String` has just written.
    const b = run(setup + 'Bank String 5,"hello",0\nPrint Len(Bank Str$(5,0));" ";Asc(Bank Str$(5,0))')
    expect(b.out().replace(/\s+/g, '')).toBe('110')
  })

  it('Bank Str End changes the terminator, a BYTE at $50', () => {
    const b = run('Reserve As Data 5,256\nBank Str End 44\nBank String 5,"ab",0\nPrint Bank Str$(5,0)')
    expect(b.rt.range.bankStrEnd).toBe(44)
    expect(b.rt.memBanks.get(5)!.data[2]).toBe(44)
    expect(b.out().trim()).toBe('ab')
  })

  it('an EMPTY string writes nothing and does not move the pointer', () => {
    // `move.w (a1),d2 / beq .out` --- before the terminator is written
    const b = run(setup + 'Bank String 5,"ab",10\nBank String 5,"",50\nPrint Bank Str Ptr')
    expect(b.out().trim()).toBe('13')
  })

  it('DEFECT: a bank with no terminator answers Chr$(10), not ""', () => {
    // `.none` builds a one-character string from `move.w #$a00` --- a line
    // feed --- and still advances the pointer by one
    const b = run('Reserve As Data 5,256\nBank Str End 44\nPrint Len(Bank Str$(5,0));" ";Asc(Bank Str$(5,0))')
    expect(b.out().replace(/\s+/g, '')).toBe('110')
  })
})

describe('Range — 2.9Plus: Spoint and Splot (routines 74, 76)', () => {
  const scr = 'Screen Open 0,320,200,16,Lowres\nCls 0\n'

  it('Splot writes a pixel and Spoint reads it back', () => {
    const b = run(scr + 'Splot 10,20,5,0\nPrint Spoint(10,20,0)')
    expect(b.out().trim()).toBe('5')
  })

  it('Splot REPLACES rather than combines — the bit is cleared first', () => {
    // `bclr.b d1,d5` before `btst.l d4,d3 / bset.b d1,d5`
    const b = run(scr + 'Splot 4,4,15,0\nSplot 4,4,1,0\nPrint Spoint(4,4,0)')
    expect(b.out().trim()).toBe('1')
  })

  it('they go straight at the bitplanes, past Ink and the clip', () => {
    const b = run(scr + 'Clip 100,100 To 110,110\nInk 7\nSplot 3,3,2,0\nPrint Point(3,3)')
    expect(b.out().trim()).toBe('2') // the Clip did not stop it
  })

  it('a screen that is not open does nothing and answers 0', () => {
    expect(num(scr + 'Print Spoint(1,1,4)')).toBe(0)
    expect(() => run(scr + 'Splot 1,1,1,4')).not.toThrow()
  })

  it('six planes is hard-coded, so colour 64 and up cannot be written', () => {
    // `cmp.w #$6,d4` --- and the 64-colour screen has eight
    const b = run('Screen Open 0,320,200,64,Lowres\nCls 0\nSplot 5,5,63,0\nPrint Spoint(5,5,0)')
    expect(b.out().trim()).toBe('63')
  })
})
