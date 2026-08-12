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
import { JOY_FIRE } from '../interp/gameport'

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

describe('Explode: the Rs structure allocator', () => {
  it('Rs Structure hands out a real address, and the three fields follow it', () => {
    // the manual's own example, minus the Print of an address that moves
    expect(run('Rs Structure 1,50\nPrint Rs Finish(1)-Rs Start(1);" ";Rs Length(1);" ";Rs(1)')).toBe('50 50 0')
  })

  it('and the address is one Poke and Peek can reach, which is the point', () => {
    expect(run('Rs Structure 0,16\nPoke Rs Start(0)+3,77\nPrint Peek(Rs Start(0)+3)')).toBe('77')
  })

  it('eight of them, 0 to 7, and 8 is error 23', () => {
    expect(run('Rs Structure 7,8\nPrint Rs Length(7)')).toBe('8')
    expect(() => run('Rs Structure 8,8')).toThrow(/function call/i)
  })

  it('a NEGATIVE number is out of range here, where the library walks off its data zone', () => {
    // `cmpi.l #8,d7 / Rbge` is signed and `mulu` sees only the low word, so
    // -1 computes 65535*12 on the machine
    expect(() => run('Rs Structure -1,8')).toThrow(/function call/i)
  })

  it('reserving over a live structure frees the old block first', () => {
    const b = boot('Rs Structure 0,64\nRs Structure 0,32')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.explode.rs[0]!.length).toBe(32)
  })
})

describe('Explode: Rs Start, Rs Finish, Rs Length and =Rs', () => {
  it('Rs Length is the only one that answers for a structure that is not there', () => {
    // `moveq #0,d3` before the test and `bge.s .Skip` instead of Rbge
    expect(run('Print Rs Length(0);" ";Rs Length(8);" ";Rs Length(-1)')).toBe('0 0 0')
  })

  it('and the other three raise error 23 on one', () => {
    expect(() => run('A=Rs Start(0)')).toThrow(/function call/i)
    expect(() => run('A=Rs Finish(0)')).toThrow(/function call/i)
    expect(() => run('A=Rs(0)')).toThrow(/function call/i)
  })

  it('=Rs is the cursor as an offset, so it counts what has been written', () => {
    expect(run('Rs Structure 0,64\nRs Byte 0,1\nRs Word 0,2\nRs Long 0,3\nPrint Rs(0)')).toBe('7')
  })
})

describe('Explode: writing into a structure', () => {
  const dump = (n: number): string =>
    `Rs Set 0,0 : For I=0 To ${n - 1} : Print Peek(Rs Start(0)+I);" "; : Next I`

  it('Rs Byte, Rs Word and Rs Long are big-endian and move the cursor by their width', () => {
    expect(run(['Rs Structure 0,16', 'Rs Byte 0,$AA', 'Rs Word 0,$1234', 'Rs Long 0,$01020304', dump(7)].join('\n'))).toBe(
      '170 18 52 1 2 3 4',
    )
  })

  it('and they write at an ODD address without complaint, which is why they exist', () => {
    // `move.b 2(a2),(a1)+` a byte at a time -- "Auch ungerade Adresse". A
    // move.w to an odd address is an address error on a 68000
    expect(run(['Rs Structure 0,16', 'Rs Byte 0,0', 'Rs Long 0,$01020304', 'Print Rs(0)'].join('\n'))).toBe('5')
  })

  it('Rs Char copies the characters -- and ONE BYTE TOO MANY', () => {
    // `dbeq d0,.1` counts from the LENGTH down to -1, so length+1 passes
    expect(run('Rs Structure 0,16\nRs Char 0,"AB"\nPrint Rs(0)')).toBe('3')
    expect(run(['Rs Structure 0,16', 'Rs Char 0,"AB"', dump(3)].join('\n'))).toBe('65 66 0')
  })

  it('and an EMPTY string does nothing at all, cursor included', () => {
    expect(run('Rs Structure 0,16\nRs Char 0,""\nPrint Rs(0)')).toBe('0')
    expect(run('Rs Structure 0,16\nRs Aptr 0,""\nPrint Rs(0)')).toBe('0')
  })

  it('Rs Aptr stores a POINTER to a NUL-terminated copy', () => {
    const out = run(
      ['Rs Structure 0,16', 'Rs Aptr 0,"Hi"', 'P=Leek(Rs Start(0))', 'Print Rs(0);" ";Peek(P);" ";Peek(P+1);" ";Peek(P+2)'].join('\n'),
    )
    // four bytes of pointer, then H, i and the byte the dbeq took too many
    expect(out).toBe('4 72 105 0')
  })

  it('and Format$ reads that pointer back, which is what the pair is for', () => {
    // the author's own shape: Rs Aptr then Format$(A$,Rs Start(0))
    expect(run('Rs Structure 0,16\nRs Aptr 0,"Explode"\nPrint Format$("name=%s",Rs Start(0))')).toBe('name=Explode')
  })

  it('writing to a structure that was never allocated is error 23', () => {
    expect(() => run('Rs Byte 0,1')).toThrow(/function call/i)
    expect(() => run('Rs Char 0,"a"')).toThrow(/function call/i)
  })
})

describe('Explode: the cursor, and Rs Clear and Rs Fill', () => {
  it('Rs Set is absolute from the start; Bset, Wset and Lset are relative and scaled', () => {
    // the manual's example, and it prints 60 for 20 + 10*2 + 5*4
    expect(run(['Rs Structure 0,60', 'Rs Bset 0,20', 'Rs Wset 0,10', 'Rs Lset 0,5', 'Print Rs(0)'].join('\n'))).toBe('60')
    expect(run(['Rs Structure 0,60', 'Rs Bset 0,20', 'Rs Set 0,0', 'Print Rs(0)'].join('\n'))).toBe('0')
  })

  it('and the amounts may be negative -- "Die Werte koennen dabei auch Negativ sein"', () => {
    expect(run(['Rs Structure 0,60', 'Rs Bset 0,20', 'Rs Lset 0,-3', 'Print Rs(0)'].join('\n'))).toBe('8')
  })

  it('Rs Clear zeroes the whole structure, cursor wherever it is', () => {
    const out = run(
      ['Rs Structure 0,4', 'Rs Long 0,$01020304', 'Rs Clear 0', 'Print Peek(Rs Start(0));" ";Peek(Rs Start(0)+3)'].join('\n'),
    )
    expect(out).toBe('0 0')
  })

  it('and on an unallocated structure it clears NOTHING, where the library clears 64K from address 0', () => {
    // `movea.l my_RsStart(a0),a1 / move.l my_RsLength(a0),d0 / subq.l #1,d0`
    // with no guard: a1 = 0 and d0 = -1, and dbra tests the low word
    expect(run('Rs Clear 0\nPrint "alive"')).toBe('alive')
  })

  it('Rs Fill writes count+1 bytes from the cursor', () => {
    const out = run(
      ['Rs Structure 0,16', 'Rs Fill 0,65,3', 'Print Rs(0);" ";Peek(Rs Start(0));" ";Peek(Rs Start(0)+3)'].join('\n'),
    )
    expect(out).toBe('4 65 65')
  })

  it('a count at or above the LENGTH writes nothing -- the guard is the wrong quantity', () => {
    // `cmp.l my_RsLength(a0),d6 / bge.s .2` tests the count against the
    // length, not the cursor against the end
    expect(run('Rs Structure 0,4\nRs Fill 0,65,4\nPrint Rs(0);" ";Peek(Rs Start(0))')).toBe('0 0')
  })

  it('and FILLING WITH ZERO WRITES ONE BYTE, because move.b sets Z and dbeq reads it', () => {
    expect(run('Rs Structure 0,16\nRs Fill 0,0,10\nPrint Rs(0)')).toBe('1')
  })
})

describe('Explode: Rs Erase', () => {
  it('with a number it frees that one and leaves the others', () => {
    expect(run(['Rs Structure 0,8', 'Rs Structure 1,16', 'Rs Erase 0', 'Print Rs Length(0);" ";Rs Length(1)'].join('\n'))).toBe(
      '0 16',
    )
  })

  it('with none it walks all eight -- L_RsEraseAll', () => {
    const out = run(
      ['Rs Structure 0,8', 'Rs Structure 3,16', 'Rs Structure 7,32', 'Rs Erase', 'Print Rs Length(0);" ";Rs Length(3);" ";Rs Length(7)'].join(
        '\n',
      ),
    )
    expect(out).toBe('0 0 0')
  })

  it('and a number out of range is silent, unlike the rest of the group', () => {
    expect(run('Rs Erase 9\nPrint "ok"')).toBe('ok')
  })

  it('the memory comes back, so a program can cycle structures', () => {
    const b = boot('Rs Structure 0,4096\nRs Erase 0\nRs Structure 1,4096')
    mustFinish(b.rt.runHeadless(2_000))
    // the freed block is reused rather than bumped past
    expect(b.rt.explode.rs[1]!.start).toBe(0x3800_0008)
  })
})

describe('Explode: the wait group', () => {
  it('the functions answer a MOUSE button negated and a key positive', () => {
    // `cmpi.w #3,d3 / bgt.s .Skip / neg.l d3` -- 3 or below is a mouse code
    const b = boot('Print Wait Loop')
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-1')
    const r = boot('Print Wait Loop')
    r.rt.input.mouseK = 2
    mustFinish(r.rt.runHeadless(2_000))
    expect(r.out().trim()).toBe('-2')
    const both = boot('Print Wait Loop')
    both.rt.input.mouseK = 3
    mustFinish(both.rt.runHeadless(2_000))
    expect(both.out().trim()).toBe('-3')
  })

  it('and a key comes back as itself', () => {
    const b = boot('Print Wait Loop')
    b.rt.input.keyQueue.push({ ch: 'A', scan: 0 })
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('65')
  })

  it('Pause answers 0 when nothing happened, which is the timeout', () => {
    expect(run('Print Pause(0)')).toBe('0')
  })

  it('Wait Mouse and Clear Mouse are the two halves of a click', () => {
    // Clear Mouse swallows a button that is already down; Wait Mouse waits
    // for the next one
    const b = boot('Clear Mouse\nPrint "through"')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('through')
    const w = boot('Wait Mouse\nPrint "clicked"')
    w.rt.input.mouseK = 1
    mustFinish(w.rt.runHeadless(2_000))
    expect(w.out().trim()).toBe('clicked')
  })

  it('Stop Loop ends on the JOYSTICK too, which Wait Loop does not', () => {
    // `btst #7,$BFE001` straight at CIA-A port A -- port 1's fire button
    const b = boot('Stop Loop\nPrint "fired"')
    b.rt.input.joy = JOY_FIRE
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('fired')
  })
})

describe('Explode: the file keywords', () => {
  const payload = Uint8Array.from([1, 2, 3, 4, 5])

  it('File Size and File Blocks answer -1 for a file that is not there', () => {
    // ";-1 = Fehler" in the author's own comment, and the only way to tell a
    // missing file from an empty one
    expect(run('Print File Size("RAM:nope")', emptyFs())).toBe('-1')
    expect(run('Print File Blocks("RAM:nope")', emptyFs())).toBe('-1')
  })

  it('and the real size for one that is', () => {
    expect(run('Print File Size("RAM:f.dat")', withFile('f.dat', payload))).toBe('5')
    expect(run('Print File Blocks("RAM:f.dat")', withFile('f.dat', payload))).toBe('1')
  })

  it('File Type is 0 missing, -1 a file and -2 a directory', () => {
    const fs = withFile('f.dat', payload)
    fs.mkdir('RAM:sub')
    expect(run('Print File Type("RAM:nope")', fs)).toBe('0')
    expect(run('Print File Type("RAM:f.dat")', fs)).toBe('-1')
    expect(run('Print File Type("RAM:sub")', fs)).toBe('-2')
  })

  it('File Path$ prefixes the current directory -- and keeps the NUL', () => {
    // DEFECT: `dbra d0,.4` runs one time too many and copies the terminator
    // into the AMOS string
    expect(run('Print Left$(File Path$("x"),5)', emptyFs())).toBe('RAM:x')
    expect(run('Print Asc(Right$(File Path$("x"),1))', emptyFs())).toBe('0')
    // "RAM:x" is five characters and the string is six
    expect(run('Print Len(File Path$("x"))', emptyFs())).toBe('6')
  })

  it('an empty or over-long filename is error 23 wherever it appears', () => {
    expect(() => run('A=File Size("")', emptyFs())).toThrow(/function call/i)
    expect(() => run(`A=File Size("${'x'.repeat(129)}")`, emptyFs())).toThrow(/function call/i)
  })

  it('Hof needs an OPEN channel and says so with error 97', () => {
    // `Rbeq L_FNopen` -- and 97 is a number this port could not name until
    // the error table was fixed
    expect(() => run('A=Hof(1)', emptyFs())).toThrow(/File not opened/i)
    expect(() => run('A=Hof(0)', emptyFs())).toThrow(/function call/i)
    expect(() => run('A=Hof(10)', emptyFs())).toThrow(/function call/i)
  })
})

describe('Explode: Cd Set, Cd Path$ and Cd Parent', () => {
  it('Cd Set appends a slash unless there is already one or a colon', () => {
    expect(run('Cd Set "DH0:work"\nPrint Cd Path$')).toBe('DH0:work/')
    expect(run('Cd Set "DH0:"\nPrint Cd Path$')).toBe('DH0:')
    expect(run('Cd Set "DH0:work/"\nPrint Cd Path$')).toBe('DH0:work/')
  })

  it('Cd Parent drops the last component and stops at the volume', () => {
    expect(run('Cd Set "DH0:a/b"\nCd Parent\nPrint Cd Path$')).toBe('DH0:a/')
    expect(run('Cd Set "DH0:a"\nCd Parent\nPrint Cd Path$')).toBe('DH0:')
    expect(run('Cd Set "DH0:"\nCd Parent\nPrint Cd Path$')).toBe('DH0:')
  })

  it('and an empty path is error 23, because the length test wraps', () => {
    expect(() => run('Cd Set ""')).toThrow(/function call/i)
  })
})

describe('Explode: the font slots', () => {
  it('are numbered 1 to 8, and 0 is as much an error as 9', () => {
    // `cmpi.l #my_FntMax,d0 / Rbpl` then `subq.l #1,d0 / Rbmi` -- the one
    // place this library counts from one
    expect(() => run('A=Font Height(0)')).toThrow(/function call/i)
    expect(() => run('A=Font Height(9)')).toThrow(/function call/i)
    expect(run('Print Font Height(1)')).toBe('0')
  })

  it('an unopened slot answers empty and zero rather than raising', () => {
    expect(run('Print Len(Font Name$(3));" ";Font Height(3);" ";Font Base(3)')).toBe('0 0 0')
  })

  it('and Font Close is silent about a slot that was never open', () => {
    expect(run('Font Close 4\nFont Close\nPrint "ok"')).toBe('ok')
  })
})

describe('Explode: the clock and the drives', () => {
  it('Hard Time$ and Hard Date$ are eight characters with their own separator', () => {
    expect(run('Print Len(Hard Time$);" ";Mid$(Hard Time$,3,1)')).toBe('8 :')
    expect(run('Print Len(Hard Date$);" ";Mid$(Hard Date$,3,1)')).toBe('8 -')
  })

  it('Set Hard Time and Set Hard Date check the LENGTH and nothing else', () => {
    // `cmpi.w #8,(a0)+ / Rbne L_IFunc`, and L_SetTimeDate never looks at the
    // separators -- it reads positions 0,1 3,4 6,7
    expect(run('Set Hard Time "12:34:56"\nPrint "ok"')).toBe('ok')
    expect(run('Set Hard Time "12x34x56"\nPrint "ok"')).toBe('ok')
    expect(() => run('Set Hard Time "12:34"')).toThrow(/function call/i)
    expect(() => run('Set Hard Date "01-02-034"')).toThrow(/function call/i)
  })

  it('Drive State is 0 for a drive that is not there', () => {
    expect(run('Print Drive State(3)', emptyFs())).toBe('0')
  })

  it('Dev State is 0 for a volume that is not there and -3 for a writable one', () => {
    expect(run('Print Dev State("NOPE:")', emptyFs())).toBe('0')
    expect(run('Print Dev State("RAM:")', emptyFs())).toBe('-3')
  })
})

describe('Explode: the system group', () => {
  it('Avail Free is the machine total, not AMOS’s own', () => {
    // "der insgesamt frei verwendbare Speicherbereich"
    expect(Number(run('Print Avail Free'))).toBeGreaterThan(0)
  })

  it('Vectorptr answers 0, which is a machine with nothing hooked into reboot', () => {
    expect(run('Print Vectorptr')).toBe('0')
  })

  it('Workbench and Amos State answer the two booleans they promise', () => {
    expect(run('Print Workbench;" ";Amos State')).toBe('-1 -1')
  })

  it('Explode$ names the library and Explode Base is its data zone', () => {
    expect(run('Print Left$(Explode$,7)')).toBe('Explode')
    // ExtNb equ 7-1, so slot 6 of the extension data region
    expect(run('Print Hex$(Explode Base)')).toBe('$78060000')
  })

  it('Extension$ takes the slot as it stands and Extension Base takes it plus one', () => {
    // `Extension$` indexes AdTokens directly; `Extension Base` does subq #1
    // first, so these two name the SAME extension
    expect(run('Print Hex$(Extension Base(8))')).toBe('$78070000')
    expect(run('Print Extension Base(0)')).toBe('0')
    // a slot with nothing in it answers the empty string, which is
    // `move.l ChVide(a5),d3` before the table is even indexed
    expect(run('Print Len(Extension$(2))')).toBe('0')
  })

  it('Amcaf Crack On and Off are accepted and crack nothing', () => {
    // the author's own manual: "Diese Befehle sind nicht legal, bei
    // Anwendung wird gegen das Urheberrecht verstossen"
    expect(run('Amcaf Crack On\nAmcaf Crack Off\nPrint "ok"')).toBe('ok')
  })

  it('Hardreset and Softreset stop the program, which is the nearest honest thing', () => {
    const b = boot('Print "before"\nSoftreset\nPrint "after"')
    b.rt.runHeadless(2_000)
    expect(b.out()).toContain('before')
    expect(b.out()).not.toContain('after')
  })
})
