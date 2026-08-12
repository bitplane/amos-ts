/**
 * Explode 2.01, against `AMOSPro_Explode_Lib.s` — the author's own commented
 * assembler, which ships with the library — and against the German manual
 * beside it. `extdis explode-2.01` opens the binary the source built.
 *
 * The port is going in by functional group and this file grows with it.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { BankImage, ObjectBank } from './objects'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 7 — `ExtNb equ 7-1`, line 16 of the source */
const explode = extensionById('explode-2.01')!
const exts = new Map([[7, explode.table]])

function boot(src: string, fs?: AmigaFS): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[7, explode]]),
    ...(fs ? { fs } : {}),
    maxSteps: 500_000,
    onText: (t) => (out += t),
  })
  return { rt, out: () => out }
}

function run(src: string, fs?: AmigaFS): string {
  const b = boot(src, fs)
  mustFinish(b.rt.runHeadless(3_000))
  return b.out().trim().replace(/\s+/g, ' ')
}

/** a writable RAM: with one file on it */
function withFile(name: string, bytes: Uint8Array): AmigaFS {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.writeFile(`RAM:${name}`, bytes)
  return fs
}

/** a bare RAM: to save onto */
function emptyFs(): AmigaFS {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  return fs
}

const val = (expr: string, setup = ''): string => run(`${setup === '' ? '' : `${setup}\n`}Print ${expr}`)

describe('Explode: strings to numbers and back', () => {
  it('Byte, Word and Long read the leading characters big-endian', () => {
    // the first character sits at 2(a0), past the string block's length word
    expect(val('Byte("A")')).toBe('65')
    expect(val('Word(Chr$(1)+Chr$(2))')).toBe('258')
    expect(val('Long(Chr$(0)+Chr$(0)+Chr$(1)+Chr$(0))')).toBe('256')
  })

  it('Word is UNSIGNED and Long is SIGNED, which is the one asymmetry', () => {
    // routines 61 and 63: Byte and Word zero d3 first, Long does not
    expect(val('Word(Chr$(255)+Chr$(255))')).toBe('65535')
    expect(val('Long(Chr$(255)+Chr$(255)+Chr$(255)+Chr$(255))')).toBe('-1')
  })

  it('and a string too short reads zero rather than the next thing in the heap', () => {
    // explode.ts records this as a deviation: the machine reads on into the
    // string heap, and there is no heap here to read
    expect(val('Word("A")')).toBe('16640') // $41 then nothing
    expect(val('Long("")')).toBe('0')
  })

  it('Byte$, Word$ and Long$ are the inverses', () => {
    expect(val('Len(Byte$(65));" ";Asc(Byte$(65))')).toBe('1 65')
    expect(val('Len(Word$(258));" ";Word(Word$(258))')).toBe('2 258')
    expect(val('Len(Long$(123456));" ";Long(Long$(123456))')).toBe('4 123456')
  })

  it('and they truncate to their width rather than complaining', () => {
    expect(val('Asc(Byte$(321))')).toBe('65') // 321 & $ff
    expect(val('Word(Word$(65538))')).toBe('2')
  })
})

describe('Explode: the shifts, where the WIDTH is the whole behaviour', () => {
  /*
   * `lsl.b d2,d3` shifts the low byte of d3 and leaves the other three bytes
   * alone, and the routine returns the whole of d3. Three keywords per
   * direction exist for exactly this reason.
   */
  it('Lsl.b moves the low byte and leaves everything above it', () => {
    expect(val('Lsl.b(1,$1234)')).toBe(String(0x1268))
    expect(val('Lsl.w(1,$12345678)')).toBe(String(0x1234acf0 | 0))
    expect(val('Lsl.l(1,$1234)')).toBe(String(0x2468))
  })

  it('Lsr.b likewise, and the high bytes survive a shift that empties the field', () => {
    expect(val('Lsr.b(1,$1234)')).toBe(String(0x121a))
    expect(val('Lsr.b(8,$1234)')).toBe(String(0x1200))
    expect(val('Lsr.w(8,$12345678)')).toBe(String(0x12340056))
  })

  it('a count at or past the width empties the field; the count is taken mod 64', () => {
    expect(val('Lsl.b(8,$1234)')).toBe(String(0x1200))
    expect(val('Lsl.l(32,$1234)')).toBe('0')
    expect(val('Lsl.b(64,$1234)')).toBe(String(0x1234)) // 64 & 63 = 0
  })

  it('the .l forms handle the top bit, which is where a JS shift would go wrong', () => {
    expect(val('Lsl.l(1,$40000000)')).toBe(String(-2147483648))
    expect(val('Lsr.l(1,$80000000)')).toBe(String(0x40000000))
    expect(val('Lsr.l(31,$80000000)')).toBe('1')
  })
})

describe('Explode: Even, Odd and Align', () => {
  it('Even and Odd are one btst, answering -1', () => {
    expect(val('Even(4)')).toBe('-1')
    expect(val('Even(5)')).toBe('0')
    expect(val('Odd(5)')).toBe('-1')
    expect(val('Odd(4)')).toBe('0')
    // the test is bit 0, so a negative odd number is still odd
    expect(val('Odd(-3)')).toBe('-1')
  })

  it('Align rounds UP to a multiple and leaves an exact one alone', () => {
    expect(val('Align(10,4)')).toBe('12')
    expect(val('Align(12,4)')).toBe('12')
    expect(val('Align(1,512)')).toBe('512')
    expect(val('Align(0,4)')).toBe('0')
  })

  it('and an alignment of zero is AMOS error 23', () => {
    // `tst.l d0 / Rbeq L_IFunc`
    expect(() => run('A=Align(10,0)')).toThrow(/function call/i)
  })
})

describe('Explode: the print sequences', () => {
  /*
   * Routines 33 to 38 all tail into one three-byte builder: ESC, the
   * routine's own letter, and the argument plus "0". They change nothing
   * themselves — AMOS's Print does the work when it meets the escape.
   */
  it('each is ESC, a letter and a digit', () => {
    expect(val('Len(Pinv$(1))')).toBe('3')
    expect(val('Asc(Mid$(Pinv$(1),1,1))')).toBe('27')
    expect(val('Mid$(Pinv$(1),2,2)')).toBe('I1')
    expect(val('Mid$(Psad$(0),2,2)')).toBe('S0')
    expect(val('Mid$(Pund$(1),2,2)')).toBe('U1')
    expect(val('Mid$(Pcpn$(3),2,2)')).toBe('D3')
    expect(val('Mid$(Pjam$(2),2,2)')).toBe('W2')
    expect(val('Mid$(Pcsr$(0),2,2)')).toBe('C0')
  })

  it('the digit is a BYTE add, so an argument past 9 runs off the end of the digits', () => {
    // `addi.b #"0",d1` with nothing to stop it
    expect(val('Mid$(Pinv$(10),3,1)')).toBe(':')
    expect(val('Asc(Mid$(Pinv$(208),3,1))')).toBe('0') // wrapped right round
  })

  it('Pdef$ is eight sequences and sets the pen and paper the others cannot', () => {
    expect(val('Len(Pdef$)')).toBe('24')
    // ESC I0 S0 U0 P1 B0 D3 W0 C1
    expect(val('Mid$(Pdef$,2,2)')).toBe('I0')
    expect(val('Mid$(Pdef$,11,2)')).toBe('P1')
    expect(val('Mid$(Pdef$,14,2)')).toBe('B0')
    expect(val('Mid$(Pdef$,23,2)')).toBe('C1')
  })

  it('and AMOS Print ACTS on them, which needed three escapes core did not have', () => {
    // ESC I, S and U were missing from screen.ts until this batch; the
    // manual's own shape is `Print "a";Pinv$(1);"b"`
    const rt = boot('Print Pinv$(1);"x"').rt
    mustFinish(rt.runHeadless(2_000))
    expect(rt.screen.curWin.inverse).toBe(true)
    const off = boot('Print Pinv$(1);"x";Pinv$(0);"y"').rt
    mustFinish(off.runHeadless(2_000))
    expect(off.screen.curWin.inverse).toBe(false)
  })

  it('Pund$ and Psad$ reach the same fields Under On and Shade On set', () => {
    const u = boot('Print Pund$(1);"x"').rt
    mustFinish(u.runHeadless(2_000))
    expect(u.screen.curWin.style & 1).toBe(1)
    const s = boot('Print Psad$(1);"x"').rt
    mustFinish(s.runHeadless(2_000))
    expect(s.screen.curWin.shade).toBe(true)
  })

  it('and Pdef$ puts all three back, plus the pen and paper', () => {
    const rt = boot('Pen 5 : Paper 3 : Inverse On : Under On : Shade On\nPrint Pdef$').rt
    mustFinish(rt.runHeadless(2_000))
    const w = rt.screen.curWin
    expect([w.inverse, w.shade, w.style & 1]).toEqual([false, false, 0])
    expect([w.pen, w.paper]).toEqual([1, 0])
  })
})

describe('Explode: Format$, which is exec RawDoFmt', () => {
  /*
   * Routine 40 hands the string and a buffer to exec and copies back what
   * comes out, so the widths are exec's: %d eats a WORD off the buffer and
   * %ld a longword. The author's own example feeds it Rs Word for %d.
   */
  const withBuf = (fmt: string, pokes: string[]): string =>
    val(`Format$("${fmt}",Start(9))`, ['Reserve As Work 9,64', ...pokes].join('\n'))

  it('%d takes a WORD and %ld a longword', () => {
    expect(withBuf('v=%d', ['Doke Start(9),1234'])).toBe('v=1234')
    expect(withBuf('v=%ld', ['Loke Start(9),123456'])).toBe('v=123456')
    // and %d is signed off that word
    expect(withBuf('v=%d', ['Doke Start(9),$FFFF'])).toBe('v=-1')
  })

  it('walks the buffer, one argument after another', () => {
    expect(withBuf('%d.%d', ['Doke Start(9),1', 'Doke Start(9)+2,53'])).toBe('1.53')
    expect(withBuf('%x-%x', ['Doke Start(9),$28', 'Doke Start(9)+2,$4'])).toBe('28-4')
  })

  it('%s follows a longword POINTER, which is what Rs Aptr leaves', () => {
    const src = [
      'Reserve As Work 9,64',
      'A$="Explode"+Chr$(0)',
      'Loke Start(9),Varptr(A$)',
      'Print Format$("name=%s",Start(9))',
    ].join('\n')
    expect(run(src)).toBe('name=Explode')
  })

  it('handles a width, a zero pad and a literal percent', () => {
    expect(withBuf('[%6d]', ['Doke Start(9),42'])).toBe('[ 42]')
    expect(withBuf('[%-6d]', ['Doke Start(9),42'])).toBe('[42 ]')
    expect(withBuf('[%06d]', ['Doke Start(9),42'])).toBe('[000042]')
    expect(withBuf('100%%', [])).toBe('100%')
  })

  it('and a bank that was never reserved is AMOS error 36', () => {
    expect(() => run('A$=Format$("x",9)')).toThrow(/bank not reserved/i)
  })
})

describe('Explode: Bank Load, in its four arities', () => {
  const payload = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])

  it('with no bank named it loads to 8, which is my_BkDefault', () => {
    const out = run('Bank Load "RAM:f.dat"\nPrint Length(8);" ";Peek(Start(8)+3)', withFile('f.dat', payload))
    expect(out).toBe('8 4')
  })

  it('To names the bank, and the file lands whole', () => {
    const out = run('Bank Load "RAM:f.dat" To 5\nPrint Length(5);" ";Peek(Start(5))', withFile('f.dat', payload))
    expect(out).toBe('8 1')
  })

  it('the mask is Data in bit 0 and Chip in bit 1, and only those two', () => {
    // `andi.l #%11,d1`. The manual: "%11 = Chip + Data, %00 = Fast + Work"
    const fs = withFile('f.dat', payload)
    const b = boot(
      ['Bank Load "RAM:f.dat" To 5,%11', 'Bank Load "RAM:f.dat" To 6,%00', 'Bank Load "RAM:f.dat" To 7,%1100'].join('\n'),
      fs,
    )
    mustFinish(b.rt.runHeadless(3_000))
    // %11: a Data bank in chip memory, named "Data"
    expect(b.rt.memBanks.get(5)!.name).toBe('Data')
    expect(b.rt.memBanks.get(5)!.memType).toBe(1)
    // %00: a Work bank in fast memory
    expect(b.rt.memBanks.get(6)!.name).toBe('Work')
    expect(b.rt.memBanks.get(6)!.memType).toBe(0)
    // %1100 asks for the Bob and Icon bits, which the AND throws away
    expect(b.rt.memBanks.get(7)!.name).toBe('Work')
    expect(b.rt.memBanks.get(7)!.flags & 0xc).toBe(0)
  })

  it('mask and To together, in that order, and the mask always last', () => {
    const out = run('Bank Load "RAM:f.dat" To 9,%10\nPrint Length(9)', withFile('f.dat', payload))
    expect(out).toBe('8')
  })

  it('a bank that is already there is REPLACED, not refused', () => {
    // Bnk.Reserve erases first (+Lib.s:8470); Reserve As Work would be error 35
    const out = run(
      'Reserve As Work 5,4096\nBank Load "RAM:f.dat" To 5\nPrint Length(5)',
      withFile('f.dat', payload),
    )
    expect(out).toBe('8')
  })

  it('a missing file is error 94, the I/O error the port used to misname', () => {
    expect(() => run('Bank Load "RAM:nothere"', emptyFs())).toThrow(/I\/O error/i)
  })

  it('an empty filename and a bank of 65536 are both error 23', () => {
    expect(() => run('Bank Load ""', emptyFs())).toThrow(/function call/i)
    expect(() => run('Bank Load "RAM:f.dat" To 65536', withFile('f.dat', payload))).toThrow(/function call/i)
  })
})

describe('Explode: Bank Save', () => {
  it('writes the payload with NO header, so Bank Load reads it back', () => {
    // "Dabei wird kein Bank-Header vorangestellt"
    const fs = emptyFs()
    const out = run(
      [
        'Reserve As Data 6,4',
        'Poke Start(6),65 : Poke Start(6)+1,66 : Poke Start(6)+2,67 : Poke Start(6)+3,68',
        'Bank Save "RAM:out.dat",6',
        'Bank Load "RAM:out.dat" To 7',
        'Print Length(7);" ";Peek$(Start(7),4)',
      ].join('\n'),
      fs,
    )
    expect(out).toBe('4 ABCD')
    expect(fs.readFile('RAM:out.dat')!.length).toBe(4)
  })

  it('refuses a Bob bank with error 23, and does so BEFORE looking at the name', () => {
    // the bank pops first, so an empty name is not what raises here
    const fs = emptyFs()
    const b = boot('Bank Save "",1', fs)
    b.rt.spriteBank = new ObjectBank()
    b.rt.spriteBank.images = [new BankImage(16, 8, 2, 0, 0)]
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(/function call/i)
  })
})

describe('Explode: Bank As Work and Bank As Data', () => {
  it('move the Data bit, which is what Erase Temp tests', () => {
    const out = run(
      [
        'Reserve As Data 7,100',
        'Reserve As Work 8,100',
        'Bank As Work 7',
        'Bank As Data 8',
        'Erase Temp',
        'Print Length(8);" ";Errn',
      ].join('\n'),
    )
    // 8 became a Data bank and survived; 7 became Work and did not
    expect(out.startsWith('100')).toBe(true)
  })

  it('AND THEY RENAME the bank -- the part a skim misses', () => {
    const b = boot(
      ['Reserve As Data 7,100', 'Reserve As Work 8,100', 'Bank As Work 7', 'Bank As Data 8'].join('\n'),
    )
    mustFinish(b.rt.runHeadless(2_000))
    // `Reserve As Data` names the bank "Datas", and the compare is a
    // LONGWORD against an eight-byte field: the first four characters match
    // "Data", the first four are overwritten, and the s survives
    expect(b.rt.memBanks.get(7)!.name).toBe('Works')
    expect(b.rt.memBanks.get(8)!.name).toBe('Data')
  })

  it('and a bank whose first four characters are neither keeps its name', () => {
    const b = boot('Reserve As Work 4,100\nBank As Data 4')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.memBanks.get(4)!.name).toBe('Data')
    // a Tracker bank flipped to Data keeps its own name and moves only the bit
    const c = boot('Bank As Data 4')
    c.rt.memBanks.set(4, { kind: 'memory', number: 4, memType: 0, name: 'Tracker ', flags: 0, data: new Uint8Array(8) })
    mustFinish(c.rt.runHeadless(2_000))
    expect(c.rt.memBanks.get(4)!.name).toBe('Tracker ')
    expect(c.rt.memBanks.get(4)!.flags & 1).toBe(1)
  })
})

describe('Explode: Bank Free, Number, Finish and Bank Clone', () => {
  it('Bank Free finds the first free number at or above the minimum', () => {
    expect(run('Print Bank Free(1)')).toBe('1')
    expect(run('Reserve As Work 1,10\nReserve As Work 2,10\nPrint Bank Free(1)')).toBe('3')
    expect(run('Reserve As Work 1,10\nPrint Bank Free(5)')).toBe('5')
  })

  it('and a minimum of zero or below is error 23', () => {
    // `move.l d0,d2 / Rble L_IFunc`
    expect(() => run('A=Bank Free(0)')).toThrow(/function call/i)
    expect(() => run('A=Bank Free(-1)')).toThrow(/function call/i)
  })

  it('Number is the inverse of Start, which is the reason it exists', () => {
    // the manual's own example: Erase N does nothing, Erase Number(N) works
    expect(run('Reserve As Work 6,100\nPrint Number(Start(6))')).toBe('6')
    // and a bank NUMBER goes through Bnk.OrAdr unchanged
    expect(run('Reserve As Work 6,100\nPrint Number(6)')).toBe('6')
  })

  it('Finish is one past the payload, so Start()+Length() reaches it', () => {
    expect(run('Reserve As Work 6,100\nPrint Finish(6)-Start(6)')).toBe('100')
    expect(run('Reserve As Work 6,100\nPrint Finish(6)-(Start(6)+Length(6))')).toBe('0')
  })

  it('Bank Clone copies the flags, the name and the bytes, and not the number', () => {
    const b = boot(
      [
        'Reserve As Data 6,4',
        'Poke Start(6),77',
        'Bank Clone 6 To 9',
        'Print Length(9);" ";Peek(Start(9));" ";Number(Start(9))',
      ].join('\n'),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe('4 77 9')
    expect(b.rt.memBanks.get(9)!.name).toBe(b.rt.memBanks.get(6)!.name)
    expect(b.rt.memBanks.get(9)!.flags).toBe(b.rt.memBanks.get(6)!.flags)
  })

  it('and the destination pops FIRST, being the last argument', () => {
    // `move.l (a3)+,d7 ;Bk` then `move.l (a3)+,d0 ;Bk to clone`
    expect(run('Reserve As Work 6,8\nBank Clone 6 To 9\nPrint Length(6);" ";Length(9)')).toBe('8 8')
  })
})

describe('Explode: Bank To Chip', () => {
  it('moves a fast bank into chip memory and leaves a chip one alone', () => {
    const b = boot('Reserve As Work 6,64\nReserve As Chip Work 7,64\nBank To Chip 6\nBank To Chip 7')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.memBanks.get(6)!.memType).toBe(1)
    expect(b.rt.memBanks.get(7)!.memType).toBe(1)
  })

  it('and the bank keeps its number, its name and its bytes', () => {
    // HeadClone (routine 160, $3014) copies the number, flags, name and the spare
    // word onto the new bank, so the number is what survives the move
    const b = boot('Reserve As Data 6,4\nPoke Start(6),88\nBank To Chip 6\nPrint Peek(Start(6));" ";Number(6)')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe('88 6')
    expect(b.rt.memBanks.get(6)!.name).toBe('Datas')
  })
})

describe('Explode: Image Width, Image Height and Image Swap', () => {
  /** a sprite bank of three images with distinguishable sizes */
  function withBobs(): { rt: Runtime; out: () => string } {
    const b = boot(
      [
        'Print Image Width(1,1);" ";Image Height(1,1);" ";Image Width(1,2);" ";Image Height(1,2)',
        'Image Swap 1,1,2',
        'Print Image Width(1,1);" ";Image Height(1,1);" ";Image Width(1,2);" ";Image Height(1,2)',
      ].join('\n'),
    )
    const ob = new ObjectBank()
    ob.images = [new BankImage(32, 9, 2, 0, 0), new BankImage(64, 25, 2, 0, 0), new BankImage(16, 3, 2, 0, 0)]
    b.rt.spriteBank = ob
    return b
  }

  it('the width is the stored word times 16 and the height is not rounded', () => {
    const b = withBobs()
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split('\n')[0]!.replace(/\s+/g, ' ').trim()).toBe('32 9 64 25')
  })

  it('and Image Swap exchanges the two images, so the sizes follow', () => {
    const b = withBobs()
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split('\n')[1]!.replace(/\s+/g, ' ').trim()).toBe('64 25 32 9')
  })

  it('all three go quiet on a bad index or a bank that is not an object bank', () => {
    // every path falls to the same rts, with d3 still zero
    const b = boot(
      [
        'Reserve As Work 5,100',
        'Print Image Width(5,1);" ";Image Height(5,1);" ";Image Width(1,0);" ";Image Width(1,9)',
        'Image Swap 1,1,9',
        'Image Swap 5,1,2',
        'Print Image Width(1,1)',
      ].join('\n'),
    )
    const ob = new ObjectBank()
    ob.images = [new BankImage(32, 9, 2, 0, 0), new BankImage(64, 25, 2, 0, 0)]
    b.rt.spriteBank = ob
    mustFinish(b.rt.runHeadless(2_000))
    const lines = b.out().trim().split('\n')
    expect(lines[0]!.replace(/\s+/g, ' ').trim()).toBe('0 0 0 0')
    // the out-of-range swaps changed nothing
    expect(lines[1]!.trim()).toBe('32')
  })
})

describe('Explode: Bnk.OrAdr, which every one of these goes through', () => {
  it('a bank number that names nothing is error 36', () => {
    expect(() => run('Print Number(4)')).toThrow(/bank not reserved/i)
    expect(() => run('Print Finish(4)')).toThrow(/bank not reserved/i)
  })

  it('and 1024 is the line between a bank number and an address', () => {
    // `cmp.l #1024,d0 / bge.s .Skip` (+Lib.s:8082) -- so bank 2000 exists and
    // is still not what Number(2000) asks about
    expect(run('Reserve As Work 1023,8\nPrint Number(1023)')).toBe('1023')
    expect(run('Reserve As Work 2000,8\nPrint Number(2000)')).toBe('0')
    // by address it answers, because that is what 2000 and up mean here
    expect(run('Reserve As Work 2000,8\nPrint Number(Start(2000))')).toBe('2000')
  })
})
