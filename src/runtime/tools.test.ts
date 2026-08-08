/**
 * AMOSPro Tools 1.01, against `AMOSPro_Tools.Lib` disassembled with
 * `extdis tools-1.01` and against `AMOSPro_Tools.Guide`.
 *
 * The guide documents twenty-two of the thirty-three and says of the other
 * eleven that they are *"internal commands of no use for anybody except me"*,
 * so those are pinned entirely from the binary — including the record layout
 * `Oui Init` reserves, which nothing but the four accessors describes.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 23 — the guide's install note, and `move.l a3,$258(a5)` in routine 0 */
const TOOLS_SLOT = 23
const tools = extensionById('tools-1.01')!
const extensions = new Map([[TOOLS_SLOT, tools.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[TOOLS_SLOT, tools]]),
    maxSteps: 400_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string, prep?: (rt: Runtime) => void): Boot {
  const b = boot(src)
  prep?.(b.rt)
  mustFinish(b.rt.runHeadless(4_000))
  return b
}

const num = (src: string, prep?: (rt: Runtime) => void): number =>
  Number(run(src, prep).out().trim())

/** every printed value as a number — AMOS's leading space is formatting, not data */
const vals = (src: string, prep?: (rt: Runtime) => void): number[] =>
  run(src, prep).out().trim().split(/\s+/).map(Number)

const text = (src: string): string => run(src).out()

/** a work bank to point Set Pos at */
const scratch = 'Reserve As Work 5,4096 : Set Pos Start(5) : '

describe('Tools: the memory cursor', () => {
  it('Get Pos starts at zero, and Set Pos and Add Pos move it', () => {
    expect(num('Print Get Pos')).toBe(0)
    expect(num('Set Pos 1000 : Print Get Pos')).toBe(1000)
    expect(num('Set Pos 1000 : Add Pos 24 : Print Get Pos')).toBe(1024)
    // "To decrement the current memory position, use a negative INCREMENT"
    expect(num('Set Pos 1000 : Add Pos -24 : Print Get Pos')).toBe(976)
  })

  it('Set Byte/Word/Long store big-endian and step by 1, 2 and 4', () => {
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5)',
      'Set Byte 65 : Set Word $1234 : Set Long $89ABCDEF',
      'Print Get Pos-Start(5);" ";Peek(Start(5));" ";Deek(Start(5)+1);" ";Leek(Start(5)+3)',
    ].join(' : ')
    expect(vals(src)).toEqual([7, 65, 0x1234, 0x89abcdef | 0])
  })

  it('the Get side reads back what the Set side wrote, and steps the same way', () => {
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5)',
      'Set Byte 200 : Set Word 40000 : Set Long -1',
      'Set Pos Start(5)',
      'Print Get Byte;" ";Get Word;" ";Get Long;" ";Get Pos-Start(5)',
    ].join(' : ')
    // Get Byte and Get Word clear d3 first, so both are unsigned; Get Long
    // fills all 32 bits and is signed
    expect(vals(src)).toEqual([200, 40000, -1, 7])
  })

  it('Set String writes the length word and the characters, and steps by len+2', () => {
    // `move.w (a2),d2 / addq.w #$1,d2 / dbra` copies from the LENGTH WORD on,
    // which is what makes Get String able to find the end
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5)',
      'Set String "Hello"',
      'Print Get Pos-Start(5);" ";Deek(Start(5));" ";Peek(Start(5)+2)',
    ].join(' : ')
    expect(vals(src)).toEqual([7, 5, 72])
  })

  it('Set String and Get String round-trip, back to back', () => {
    const src = [
      'Reserve As Work 5,256',
      'Set Pos Start(5)',
      'Set String "one" : Set String "" : Set String "three"',
      'Set Pos Start(5)',
      'A$=Get String : B$=Get String : C$=Get String',
      'Print A$;"/";B$;"/";C$;"/";Get Pos-Start(5)',
    ].join(' : ')
    // 3+2, 0+2 and 5+2 -- the empty string still costs its length word
    expect(text(src).trim()).toBe('one//three/ 14')
  })

  it('Set Crypt complements the characters and leaves the length in clear', () => {
    // `eori.b #$ff` per character, and the length word goes out untouched --
    // so the layout is still readable even though the text is not
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5)',
      'Set Crypt "AB"',
      'Print Deek(Start(5));" ";Peek(Start(5)+2);" ";Peek(Start(5)+3)',
    ].join(' : ')
    expect(vals(src)).toEqual([2, 255 - 65, 255 - 66])
  })

  it('Get Crypt undoes Set Crypt, and plain Get String does not', () => {
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5) : Set Crypt "Hi"',
      'Set Pos Start(5) : A$=Get Crypt',
      'Set Pos Start(5) : B$=Get String',
      'Print A$;"/";Asc(B$);"/";Get Pos-Start(5)',
    ].join(' : ')
    expect(text(src).trim()).toBe('Hi/ 183/ 4')
  })
})

describe('Tools: the byte array', () => {
  it('Array Bank starts at 23 and Set Array Bank moves it', () => {
    // the data zone's assembled `dc.l 23`, and the guide's "default is bank 23"
    expect(num('Print Array Bank')).toBe(23)
    expect(num('Set Array Bank 40 : Print Array Bank')).toBe(40)
  })

  it('Array Dim reserves (SX+1)*(SY+1)+4 bytes with the stride in front', () => {
    // `mulu.w d3,d2 / addq.w #$4,d2` then `move.l d3,(a0)` -- the four bytes
    // of header hold SX+1, which every later access multiplies by
    const src = [
      'Set Array Bank 5',
      'Array Dim 9,4',
      'Print Length(5);" ";Leek(Start(5))',
    ].join(' : ')
    expect(vals(src)).toEqual([54, 10])
  })

  it('stores and reads back a byte', () => {
    const src = [
      'Set Array Bank 5 : Array Dim 9,9',
      'Array Set 3,4,200',
      'Print Array Get(3,4)',
    ].join(' : ')
    expect(num(src)).toBe(200)
  })

  it('is unsigned, and keeps only the low byte', () => {
    const src = 'Set Array Bank 5 : Array Dim 9,9 : Array Set 0,0,-1 : Print Array Get(0,0)'
    expect(num(src)).toBe(255)
  })

  it('DEFECT: the stride is SX+1 and it multiplies X by it', () => {
    // so the element at (X,Y) is at X*(SX+1)+Y and the array is really indexed
    // [0..SY][0..SX] -- the dimensions are the other way round from the guide's
    // own `Dim _ARRAY(SX,SY)`. Array Dim 9,4 gives 50 usable bytes with a
    // stride of 10, so (4,9) is the last element in range and (9,4) is not
    const src = [
      'Set Array Bank 5 : Array Dim 9,4',
      'Array Set 4,9,111',
      // the last byte of the allocation, four header bytes in
      'Print Peek(Start(5)+4+49);" ";Array Get(4,9)',
    ].join(' : ')
    expect(vals(src)).toEqual([111, 111])
  })

  it('DEFECT: an index past the end is not checked and lands outside the bank', () => {
    // (9,4) is offset 9*10+4 = 94 in a 50-byte array, so `Array Dim 9,4`
    // followed by `Array Set 9,4` -- the corners the guide's own `Dim
    // _ARRAY(SX,SY)` promises -- writes 44 bytes past the bank. Nothing
    // raises. On the machine it lands in whatever follows; here it is
    // outside every region and is dropped, so the read finds nothing
    const src = [
      'Set Array Bank 5 : Array Dim 9,4',
      'Array Set 9,4,77',
      'Print Array Get(9,4)',
    ].join(' : ')
    expect(num(src)).toBe(0)
  })

  it('raises Bank not reserved when there is no array', () => {
    expect(() => run('Set Array Bank 51 : Array Set 0,0,1')).toThrow(/[Bb]ank not reserved/)
    expect(() => run('Set Array Bank 51 : Print Array Get(0,0)')).toThrow(/[Bb]ank not reserved/)
  })

  it('Array Dim replaces an existing bank rather than refusing', () => {
    // Bnk_Reserve frees an existing bank of that number and takes a new one,
    // which is what the guide says: "If the memory bank already exists, it
    // will be erased before the array bank is created!" The routine's only
    // failure arm is error 24, "Out of memory"
    const src = [
      'Set Array Bank 5 : Array Dim 9,9',
      'Array Set 0,0,5',
      'Array Dim 9,9',
      'Print Array Get(0,0)',
    ].join(' : ')
    expect(num(src)).toBe(0)
  })
})

describe('Tools: Range and Checksum', () => {
  it('Range clamps, inclusive at both ends', () => {
    expect(num('Print Range(5,1 To 10)')).toBe(5)
    expect(num('Print Range(0,1 To 10)')).toBe(1)
    expect(num('Print Range(99,1 To 10)')).toBe(10)
    expect(num('Print Range(1,1 To 10)')).toBe(1)
    expect(num('Print Range(10,1 To 10)')).toBe(10)
    expect(num('Print Range(-5,-10 To -1)')).toBe(-5)
  })

  it('Range with the bounds crossed answers one or the other, never the input', () => {
    // the MAX arm runs first AND returns -- `move.l d5,d3 / bra` lands on the
    // `rts`, skipping the MIN check -- so anything above MAX is MAX and
    // everything else falls through to MIN, which with crossed bounds is
    // everything else
    expect(num('Print Range(50,10 To 1)')).toBe(1)
    expect(num('Print Range(5,10 To 1)')).toBe(1)
    expect(num('Print Range(1,10 To 1)')).toBe(10)
    expect(num('Print Range(0,10 To 1)')).toBe(10)
  })

  it('Checksum adds longwords and then the odd bytes', () => {
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5) : Set Long 1 : Set Long 2 : Set Byte 3',
      'Print Checksum(Start(5) To Start(5)+9)',
    ].join(' : ')
    expect(num(src)).toBe(6)
  })

  it('Checksum sorts its bounds, so the order does not matter', () => {
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5) : Set Long 7',
      'Print Checksum(Start(5) To Start(5)+4);" ";Checksum(Start(5)+4 To Start(5))',
    ].join(' : ')
    expect(vals(src)).toEqual([7, 7])
  })

  it('Checksum of an empty range is zero', () => {
    expect(num('Reserve As Work 5,64 : Print Checksum(Start(5) To Start(5))')).toBe(0)
  })
})

describe('Tools: Encode and Decode', () => {
  it('round-trip through the same password', () => {
    const src = [
      'Reserve As Work 5,256',
      'Set Pos Start(5) : Set String "the quick brown fox"',
      'Encode Start(5),21,"secret"',
      'Set Pos Start(5) : A$=Get String',
      'Decode Start(5),21,"secret"',
      'Set Pos Start(5) : B$=Get String',
      'Print A$;"|";B$',
    ].join(' : ')
    const out = text(src).trim()
    const [scrambled, restored] = out.split('|')
    expect(restored).toBe('the quick brown fox')
    expect(scrambled).not.toBe('the quick brown fox')
  })

  it('a wrong password does not restore it', () => {
    const src = [
      'Reserve As Work 5,256',
      'Set Pos Start(5) : Set String "hello"',
      'Encode Start(5),7,"one"',
      'Decode Start(5),7,"two"',
      'Set Pos Start(5) : Print Get String',
    ].join(' : ')
    expect(text(src).trim()).not.toBe('hello')
  })

  it('the same plaintext byte encodes differently at different offsets', () => {
    // `d3` is a running sum of the LCG that never resets, so the keystream
    // depends on the position as well as the password
    const src = [
      'Reserve As Work 5,64',
      'Set Pos Start(5)',
      'Set Byte 65 : Set Byte 65 : Set Byte 65 : Set Byte 65',
      'Encode Start(5),4,"k"',
      'Print Peek(Start(5));" ";Peek(Start(5)+1);" ";Peek(Start(5)+2);" ";Peek(Start(5)+3)',
    ].join(' : ')
    const got = vals(src)
    expect(new Set(got).size).toBeGreaterThan(1)
  })

  it('the password repeats, so a longer region still decodes', () => {
    const src = [
      'Reserve As Work 5,256',
      'Set Pos Start(5) : Set String "abcdefghijklmnopqrstuvwxyz"',
      'Encode Start(5),28,"xy"',
      'Decode Start(5),28,"xy"',
      'Set Pos Start(5) : Print Get String',
    ].join(' : ')
    expect(text(src).trim()).toBe('abcdefghijklmnopqrstuvwxyz')
  })
})

describe('Tools: the undocumented Oui half', () => {
  it('Oui Bank starts at 24 and Oui Set Bank moves it', () => {
    expect(num('Print Oui Bank')).toBe(24)
    expect(num('Oui Set Bank 6 : Print Oui Bank')).toBe(6)
  })

  it('Oui Init reserves (N+1) 32-byte records and writes the count and maximum', () => {
    // `move.b #$1,(a0)+ / move.b d7,(a0)` -- the first two bytes of the bank,
    // which are also the first two bytes of record zero
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Print Length(6);" ";Oui Data(0);" ";Oui Data(1)',
    ].join(' : ')
    expect(vals(src)).toEqual([160, 1, 4])
  })

  it('Oui New fills six words from the front of the record and flags it at +$1a', () => {
    // written backwards from record+12 by `move.w d1,-(a0)`, which puts the
    // FIRST argument at offset 0 because the pops run right to left
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Oui New 11,22,33,44,55,66',
      'Print Oui Edata(1,0);" ";Oui Edata(1,1);" ";Oui Edata(1,5);" ";Oui Edata(1,13)',
    ].join(' : ')
    expect(vals(src)).toEqual([11, 22, 66, 1])
  })

  it('Oui New writes element 1 every time, because nothing increments the count', () => {
    // the counter is a cursor the caller drives -- Oui Set Data 0,n is exactly
    // the byte it lives in
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Oui New 1,0,0,0,0,0',
      'Oui New 2,0,0,0,0,0',
      'Print Oui Edata(1,0);" ";Oui Edata(2,0)',
    ].join(' : ')
    expect(vals(src)).toEqual([2, 0])

    const driven = [
      'Oui Set Bank 6 : Oui Init 4',
      'Oui New 1,0,0,0,0,0',
      'Oui Set Data 0,2',
      'Oui New 2,0,0,0,0,0',
      'Print Oui Edata(1,0);" ";Oui Edata(2,0)',
    ].join(' : ')
    expect(vals(driven)).toEqual([1, 2])
  })

  it('Oui New raises once the count passes the maximum, and not at it', () => {
    // `cmp.b $1(a0),d0 / bhi` -- strictly greater, and Oui Init reserved N+1
    // records so element N is the last legal one
    const at = [
      'Oui Set Bank 6 : Oui Init 2',
      'Oui Set Data 0,2',
      'Oui New 9,0,0,0,0,0',
      'Print Oui Edata(2,0)',
    ].join(' : ')
    expect(num(at)).toBe(9)

    const past = [
      'Oui Set Bank 6 : Oui Init 2',
      'Oui Set Data 0,3',
      'Oui New 9,0,0,0,0,0',
    ].join(' : ')
    expect(() => run(past)).toThrow(/Maximum number of elements reached/)
  })

  it('Oui Set Edata and Oui Edata are a word at element*32 + field*2', () => {
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Oui Set Edata 3,7,4321',
      // the same word through the byte accessor: 3*32 + 7*2 = 110
      'Print Oui Edata(3,7);" ";Oui Data(110)*256+Oui Data(111)',
    ].join(' : ')
    expect(vals(src)).toEqual([4321, 4321])
  })

  it('Oui Reserve Text parks a string address at the element +$1c', () => {
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Oui Reserve Text 2,20',
      'Print Leek(Start(6)+2*32+28)<>0',
    ].join(' : ')
    expect(num(src)).toBe(-1)
  })

  it('Oui Set Text and Oui Text round-trip through that pointer', () => {
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Oui Reserve Text 1,20 : Oui Reserve Text 2,20',
      'Oui Set Text 1,"first"',
      'Oui Set Text 2,"second"',
      'Print Oui Text(1);"/";Oui Text(2)',
    ].join(' : ')
    expect(text(src).trim()).toBe('first/second')
  })

  it('an element that was never reserved reads an empty string', () => {
    const src = [
      'Oui Set Bank 6 : Oui Init 4',
      'Print "[";Oui Text(3);"]"',
    ].join(' : ')
    expect(text(src).trim()).toBe('[]')
  })

  it('every Oui keyword needs the bank to exist', () => {
    expect(() => run('Oui Set Bank 51 : Print Oui Data(0)')).toThrow(/[Bb]ank not reserved/)
    expect(() => run('Oui Set Bank 51 : Oui Set Data 0,1')).toThrow(/[Bb]ank not reserved/)
    expect(() => run('Oui Set Bank 51 : Print Oui Edata(0,0)')).toThrow(/[Bb]ank not reserved/)
    expect(() => run('Oui Set Bank 51 : Oui New 1,2,3,4,5,6')).toThrow(/[Bb]ank not reserved/)
  })
})

describe('Tools: the cursor reaches anything with an address', () => {
  it('Set Pos into a bank and Peek agree', () => {
    const src = `${scratch}Set Long $DEADBEEF : Print Leek(Start(5))`
    expect(num(src)).toBe(0xdeadbeef | 0)
  })
})
