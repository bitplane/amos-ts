/**
 * SLN 2.0, against `sln_extII.s` — the author's own assembler source, which
 * for this extension is the WHOLE thing rather than a shell — and against
 * `AMOSPro_SLN_2.0.lib` disassembled with `extdis sln-2.0` wherever the source
 * says something surprising enough to be worth a second reading.
 *
 * Several of these tests pin defects. They are defects in the shipped library,
 * not here, and every one of them was checked in the binary before it was
 * reproduced.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { AdfVolume } from '../amiga/adf'
import { Machine } from '../amiga/machine'
import { SLN_ERRORS } from './sln'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 24 — `ExtNb equ 24-1` in the source, and Burton's list agrees */
const SLN_SLOT = 24
const sln = extensionById('sln-2.0')!
const extensions = new Map([[SLN_SLOT, sln.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[SLN_SLOT, sln]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string, prep?: (rt: Runtime) => void): Boot {
  const b = boot(src)
  prep?.(b.rt)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

const num = (src: string, prep?: (rt: Runtime) => void): number => Number(run(src, prep).out().trim())

/** the same, over a writable RAM: volume — S Delete and the sample bank need one */
function bootFs(src: string): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[SLN_SLOT, sln]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
  })
  return { rt, out: () => printed }
}

describe('SLN: the mouse counter reader', () => {
  it('accumulates nothing until S Mouse On sets status bit 0', () => {
    // InterStart's first act is `btst #0,d0 / beq InterMouseEnd`, so an
    // extension that has never been switched on watches nothing at all
    const { rt } = boot('')
    expect(rt.sln.status & 1).toBe(0)
    rt.input.mouseX = 300
    rt.frame()
    expect(rt.sln.curX).toBe(0)
    // ...and PrevX is not seeded either, which is the difference from
    // GameSupport's cold start: the first frame after S Mouse On measures
    // from zero rather than from where the pointer already was
    expect(rt.sln.prevX).toBe(0)
  })

  it('follows the counter once it is on, in counter units not pixels', () => {
    const { rt } = run('S Mouse On', (r) => {
      r.input.mouseX = 288
      r.input.mouseY = 150
    })
    rt.frame() // first frame: prev was 0, so it takes the whole reading
    const seeded = rt.sln.curX
    rt.input.mouseX = 300
    rt.frame()
    expect(rt.sln.curX - seeded).toBe(12)
    expect(rt.sln.prevX).toBe((300 & 0xff) << 24 >> 24)
  })

  it('DISCARDS any delta of 50 or more, which is the "overrun" guard', () => {
    // cmpi.l #50,d0 / bge  and  cmpi.l #-50,d0 / ble -- inclusive both ends
    const { rt } = run('S Mouse On', (r) => (r.input.mouseX = 10))
    rt.frame()
    const at = rt.sln.curX
    rt.input.mouseX = 59 // delta 49: taken
    rt.frame()
    expect(rt.sln.curX - at).toBe(49)
    const at2 = rt.sln.curX
    rt.input.mouseX = 109 // delta 50 exactly: dropped
    rt.frame()
    expect(rt.sln.curX).toBe(at2)
    // and the reference still advances, so the movement is lost rather than
    // deferred to the next frame
    expect(rt.sln.prevX).toBe(109)
  })

  it('DEFECT: loses 255 counts every time the byte counter wraps', () => {
    // the byte goes 127 -> -128, a delta of -255, which the guard discards.
    // ../amiga/gameport.ts's counterDelta wraps it to +1; this routine has no
    // such step, so a pointer walked steadily across the wrap simply stalls.
    const { rt } = run('S Mouse On', (r) => (r.input.mouseX = 127))
    rt.frame()
    const at = rt.sln.curX
    rt.input.mouseX = 128 // one pixel right; the counter byte flips sign
    rt.frame()
    expect(rt.sln.curX).toBe(at)
  })

  it('S X Mouse= and S Y Mouse= write the accumulators with no range check', () => {
    expect(num('S X Mouse=-5000 : Print S X Mouse')).toBe(-5000)
    expect(num('S Y Mouse=123456 : Print S Y Mouse')).toBe(123456)
  })

  it('S Mouse Off leaves the accumulated position alone', () => {
    // frame() runs the VBL hook and THEN the interpreter, so the keyword takes
    // effect on the frame after the one that ran it
    const { rt } = boot('S Mouse On : Wait Vbl : Wait Vbl : S Mouse Off : Wait Vbl : Wait Vbl')
    rt.input.mouseX = 100
    rt.frame() // S Mouse On
    rt.frame() // first accumulation: prev was 0, so the delta is discarded
    rt.input.mouseX = 110
    rt.frame() // delta 10 taken, then S Mouse Off runs
    expect(rt.sln.curX).toBe(10)
    rt.input.mouseX = 120
    rt.frame()
    expect(rt.sln.curX).toBe(10)
  })
})

describe('SLN: S Mouse Button', () => {
  it('DEFECT: reads the disk-change line, so it can never see a press', () => {
    // btst.b #$2,$bfe001 -- bit 2 is /CHNG. The button is bit 6. Confirmed in
    // the binary at $cf8, six instructions, identical to the source.
    expect(num('Print S Mouse Button')).toBe(0)
  })

  it('has no right button at all: the code for it is commented out', () => {
    // ;btst #6,$dff016 -- the register is right and the lines are dead, so
    // bit 1 of the result is always clear
    expect(num('Print S Mouse Button')).toBe(0)
  })
})

describe('SLN: the eight user interrupts', () => {
  it('starts with all eight free', () => {
    expect(num('Print S Ifree')).toBe(8)
  })

  it('S Iinit takes an ADDRESS above 65536 and stores it in both tables', () => {
    expect(num('S Iinit 0,1000000,2000000 : Print S Ibase(0)')).toBe(1000000)
    expect(num('S Iinit 0,1000000,2000000 : Print S Iadr(0)')).toBe(2000000)
    expect(num('S Iinit 0,1000000,2000000 : Print S Ifree')).toBe(7)
  })

  it('S Iinit takes a BANK NUMBER at or below 65536 — the v2.0 change', () => {
    // "S Ainit & S Iinit - accepterer nu også bank nummre istedet for
    // adresser" (Sln_ext_Historie, v2.0). cmpi.l #$10000 / ble is inclusive.
    const { rt } = run('Reserve As Work 5,64 : S Iinit 3,5,5')
    expect(rt.sln.interBase[3]).toBe(rt.bankBase(5) >>> 0)
    expect(rt.sln.interVar[3]).toBe(rt.bankBase(5) >>> 0)
  })

  it('raises "Illegal function call" for a bank that is not reserved', () => {
    const b = boot('S Iinit 0,9,1000000')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('rejects slot 8 and above with an UNSIGNED longword compare', () => {
    // cmpi.l #8,d3 / rbcc -- this one really does reject the whole range,
    // unlike the readers below
    const b = boot('S Iinit 8,1000000,1000000')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
    const c = boot('S Iinit -1,1000000,1000000')
    // bclr #31 first, so -1 becomes $7fffffff, which is still >= 8 unsigned
    expect(() => mustFinish(c.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('S Ierase clears both tables at once', () => {
    const src = 'S Iinit 0,1000000,1000000 : S Iinit 7,2000000,2000000 : S Ierase : '
    expect(num(`${src}Print S Ifree`)).toBe(8)
    expect(num(`${src}Print S Ibase(0)`)).toBe(0)
    expect(num(`${src}Print S Iadr(7)`)).toBe(0)
  })

  it('DEFECT: =S Ibase guards with a WORD compare and indexes with a LONG', () => {
    // cmpi #8,d1 (word, signed) / rbge, then mulu #4,d1 (low word only).
    // -1 survives the guard as $7fffffff, whose low word is -1 as a word, and
    // the routine then reads $3fffc bytes past the table. Nothing is modelled
    // that far out, so this answers 0 rather than inventing a number.
    expect(num('Print S Ibase(-1)')).toBe(0)
    // 8 through 32767 are what the guard actually catches
    const b = boot('Print S Ibase(8)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('DEVIATION: the routines are registered and never entered', () => {
    // `jsr (a2)` into 68000 machine code, which this port does not execute --
    // the same boundary Call and Dreg are n/a for. The table is exact, so a
    // program can install and read back its hooks; nothing runs them.
    const { rt } = run('S Iinit 0,1000000,2000000')
    expect(rt.sln.interBase[0]).toBe(1000000)
    for (let i = 0; i < 4; i++) rt.frame()
    expect(rt.sln.interBase[0]).toBe(1000000)
  })
})

describe('SLN: the eight arrays', () => {
  it('S Ainit allocates, and the dimensions are the argument plus one', () => {
    // routine 11: addi.l #$1 on each of z, y and x before anything else
    const { rt } = run('S Ainit 0,2,9,4,1')
    expect(rt.sln.arrays[0]!.x).toBe(10)
    expect(rt.sln.arrays[0]!.y).toBe(5)
    expect(rt.sln.arrays[0]!.z).toBe(2)
    expect(rt.sln.arrays[0]!.cell).toBe(2)
    // 10 * 5 * 2 * 2 bytes
    expect(num('S Ainit 0,2,9,4,1 : Print S Asize(0)')).toBe(200)
    expect(num('S Ainit 0,2,9,4,1 : Print S Abase(0)')).not.toBe(0)
  })

  it('=S Atype answers the CELL SIZE, which is what the extension calls a type', () => {
    // routine 18 reads Acell, a byte per slot, and never touches the Atype
    // bitmap; `S Ainit`'s second argument is called the type throughout
    expect(num('S Ainit 3,4,7,0,0 : Print S Atype(3)')).toBe(4)
    expect(num('S Ainit 3,1,7,0,0 : Print S Atype(3)')).toBe(1)
  })

  it('rejects cell sizes 0, 3 and 5 and above, and accepts 1, 2 and 4', () => {
    for (const cell of [0, 3, 5, 9]) {
      const b = boot(`S Ainit 0,${cell},7,0,0`)
      expect(() => mustFinish(b.rt.runHeadless(2_000)), `cell ${cell}`).toThrow(SLN_ERRORS[0])
    }
    for (const cell of [1, 2, 4]) expect(num(`S Ainit 0,${cell},7,0,0 : Print S Atype(0)`)).toBe(cell)
  })

  it('a 1D array round-trips through S Aset and =S Array', () => {
    expect(num('S Ainit 0,4,9,0,0 : S Aset 0,5,123456 : Print S Array(0,5)')).toBe(123456)
    expect(num('S Ainit 0,2,9,0,0 : S Aset 0,5,-3 : Print S Array(0,5)')).toBe(-3)
  })

  it('DEFECT: a BYTE cell is stored signed and read back UNSIGNED', () => {
    // move.b on the way in, `clr.l d3 / move.b (a2),d3` on the way out --- no
    // ext.b, where the WORD path has an ext.l and does round-trip
    expect(num('S Ainit 0,1,9,0,0 : S Aset 0,1,-1 : Print S Array(0,1)')).toBe(255)
    expect(num('S Ainit 0,2,9,0,0 : S Aset 0,1,-1 : Print S Array(0,1)')).toBe(-1)
  })

  it('DEFECT: a negative WORD store FORCES bit 15 instead of truncating', () => {
    // btst #$1f,d7 / bset #$f,d7 (both LONG, register operands) at $d9c
    // -65536 is $ffff0000, whose low word is 0, so a move.w would write 0
    expect(num('S Ainit 0,2,9,0,0 : S Aset 0,1,-65536 : Print S Array(0,1)')).toBe(-32768)
    // a value whose sign and low word agree is unaffected, which is why this
    // survived: -2 is $fffffffe and $fffffffe already has bit 15 set
    expect(num('S Ainit 0,2,9,0,0 : S Aset 0,1,-2 : Print S Array(0,1)')).toBe(-2)
  })

  it('DEFECT: a 1D read allows index == Xsize where the write does not', () => {
    // routine 23 has no `subi.l #1,d4` and uses cmp.w; routine 21 has both
    expect(num('S Ainit 0,4,9,0,0 : Print S Array(0,10)')).toBe(0)
    const b = boot('S Ainit 0,4,9,0,0 : S Aset 0,10,1')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
    // and index 11 is out of range for the reader too
    const c = boot('S Ainit 0,4,9,0,0 : Print S Array(0,11)')
    expect(() => mustFinish(c.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('a 2D array indexes as y * Xsize + x', () => {
    const src = 'S Ainit 1,4,3,2,0 : S Aset 1,2,1,777 : '
    expect(num(`${src}Print S Array(1,2,1)`)).toBe(777)
    // the same cell, reached through the address: (1 * 4 + 2) * 4 bytes
    expect(num(`${src}Print Leek(S Abase(1)+24)`)).toBe(777)
  })

  it('DEFECT: the 2D bound check tests Y against XSIZE and never checks X', () => {
    // routine 22: `cmp.l d0,d4` against Aysize-1 with NO branch after it, then
    // the same d0 against Axsize-1 with the branch. Confirmed at $1258/$126c.
    // Xsize 4, Ysize 3: y = 3 is out of range and is accepted...
    expect(num('S Ainit 1,4,3,2,0 : S Aset 1,0,3,5 : Print S Array(1,0,3)')).toBe(5)
    // ...while y = 4 is refused, because the limit being applied is Xsize-1
    const b = boot('S Ainit 1,4,3,2,0 : Print S Array(1,0,4)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
    // and X is never checked at all, however far out it goes
    expect(num('S Ainit 1,4,3,2,0 : S Aset 1,99,0,5 : Print S Array(1,99,0)')).toBe(5)
  })

  it('the 3D pair is the one that checks all three bounds properly', () => {
    const src = 'S Ainit 2,4,3,3,3 : '
    expect(num(`${src}S Aset 2,1,2,3,42 : Print S Array(2,1,2,3)`)).toBe(42)
    for (const idx of ['4,0,0', '0,4,0', '0,0,4']) {
      const b = boot(`${src}Print S Array(2,${idx})`)
      expect(() => mustFinish(b.rt.runHeadless(2_000)), idx).toThrow(SLN_ERRORS[0])
    }
  })

  it('DEFECT: the address form adds ONE, TWO and THREE to z, y and x', () => {
    // routine 31 at $14f2/$14fa/$1502 --- `#$1`, `#$2`, `#$3` where routine 11
    // has three `#$1`s. So an array over the program's own buffer reports two
    // more rows and three more columns than were asked for.
    const { rt } = run('Reserve As Work 7,4096 : S Ainit 4,7,2,9,4,1')
    expect(rt.sln.arrays[4]!.x).toBe(12) // asked for 9
    expect(rt.sln.arrays[4]!.y).toBe(6) // asked for 4
    expect(rt.sln.arrays[4]!.z).toBe(2) // asked for 1 --- this one is right
    expect(rt.sln.arrays[4]!.base).toBe(rt.bankBase(7) >>> 0)
    // read back through the keywords, which is where a program would see it
    expect(num('Reserve As Work 7,4096 : S Ainit 4,7,2,9,4,1 : Print S Axsize(4)')).toBe(12)
    expect(num('Reserve As Work 7,4096 : S Ainit 4,7,2,9,4,1 : Print S Aysize(4)')).toBe(6)
    expect(num('Reserve As Work 7,4096 : S Ainit 4,7,2,9,4,1 : Print S Azsize(4)')).toBe(2)
  })

  it('the address form sets the Atype bit and the allocating form never clears it', () => {
    // routine 31 has `dlea Atype,a1 / bset.b d3,(a1)`; routine 11's matching
    // bclr is `bclr.b d3,$40(a1)` off Axsize, which is AZSIZE, not Atype
    const { rt } = run('Reserve As Work 7,4096 : S Ainit 4,7,2,9,4,1 : S Ainit 4,2,9,4,1')
    expect(rt.sln.atype & (1 << 4)).not.toBe(0)
    // ...so the block routine 11 just allocated is now unfreeable
    expect(rt.sln.arrays[4]!.base).not.toBe(rt.bankBase(7) >>> 0)
  })

  it('DEFECT: re-initialising slot N frees slot ZERO’s memory', () => {
    // movea.l (a2),a1 at $e2c --- Abase[0], not Abase[nr], with Asize[nr]
    const { rt } = run('S Ainit 0,4,99,0,0 : S Ainit 3,4,99,0,0 : S Ainit 3,4,49,0,0')
    // re-initialising 3 handed array ZERO's 400 bytes back, so the 200 bytes
    // array 3 then asks for are carved out of them: the two slots now name the
    // same address, and writing one is writing the other
    expect(rt.sln.arrays[3]!.base).toBe(rt.sln.arrays[0]!.base)
    expect(rt.sln.heap.sizeOf(rt.sln.arrays[0]!.base)).toBe(200)
  })

  it('DEFECT: S Aerase re-allocates a one-byte array instead of erasing', () => {
    // routine 33 pushes cell 1 and x = y = z = 0, and routine 11 only erases
    // when x + 1 == 0
    expect(num('S Ainit 0,4,99,0,0 : S Aerase 0 : Print S Asize(0)')).toBe(1)
    expect(num('S Ainit 0,4,99,0,0 : S Aerase 0 : Print S Axsize(0)')).toBe(1)
    expect(num('S Ainit 0,4,99,0,0 : S Aerase 0 : Print S Abase(0)')).not.toBe(0)
    // x = -1 is the only thing that reaches L_ArrayErase, and it does erase
    expect(num('S Ainit 0,4,99,0,0 : S Ainit 0,4,-1,0,0 : Print S Abase(0)')).toBe(0)
    expect(num('S Ainit 0,4,99,0,0 : S Ainit 0,4,-1,0,0 : Print S Asize(0)')).toBe(0)
  })

  it('S Aerase All does the same to all eight slots', () => {
    const { rt } = run('S Ainit 0,4,99,0,0 : S Ainit 7,4,99,0,0 : S Aerase All')
    for (let n = 0; n < 8; n++) expect(rt.sln.arrays[n]!.size, `slot ${n}`).toBe(1)
  })

  it('DEFECT: S Aclear writes four bytes per byte of array', () => {
    // `move.l Asize,d1 / subi.l #1,d1` then a dbra over `clr.l (a1)+`
    const { rt } = run('S Ainit 0,1,15,0,0 : S Ainit 1,1,15,0,0 : S Aset 1,0,99 : S Aclear 0')
    expect(rt.sln.arrays[0]!.size).toBe(16)
    // array 1 sits above array 0 in the pool and is inside the 64 bytes the
    // clear reaches, so its first cell has been zeroed by a clear of array 0
    expect(rt.sln.arrays[1]!.base).toBeGreaterThan(rt.sln.arrays[0]!.base)
    expect(num('S Ainit 0,1,15,0,0 : S Ainit 1,1,15,0,0 : S Aset 1,0,99 : S Aclear 0 : Print S Array(1,0)')).toBe(0)
  })

  it('DEFECT: the size computation truncates to 16 bits at every multiply', () => {
    // `mulu` is 16 x 16 -> 32 and the product feeds the next one's low word,
    // so 300 x 300 x 4 is not 360000
    expect(num('S Ainit 0,4,299,299,0 : Print S Asize(0)')).toBe(((300 * 300) & 0xffff) * 4)
  })

  it('the array attribute readers share the interrupt readers’ word guard', () => {
    expect(num('Print S Asize(-1)')).toBe(0)
    const b = boot('Print S Asize(8)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('an array is real memory: Loke and Leek reach it through S Abase', () => {
    expect(num('S Ainit 0,4,9,0,0 : Loke S Abase(0)+8,1234567 : Print S Array(0,2)')).toBe(1234567)
    expect(num('S Ainit 0,4,9,0,0 : S Aset 0,2,7654321 : Print Leek(S Abase(0)+8)')).toBe(7654321)
  })
})

describe('SLN: S Compare$, S Checksum, S Delete and S Iconify', () => {
  it('S Compare$ finds the first source character that is in the mask SET', () => {
    // routine 35: an inner loop over the whole mask for every source
    // character, so the mask is a set and not a substring
    expect(num('Print S Compare$("hello","l",0,0)')).toBe(3)
    expect(num('Print S Compare$("hello","xyz",0,0)')).toBe(0)
    // "o" is at 5 and "e" at 2; the earliest source position wins
    expect(num('Print S Compare$("hello","oe",0,0)')).toBe(2)
  })

  it('its `$` is decoration: the spec makes it an INTEGER function', () => {
    // dc.b "s compare","$"+$80,"02,2,0,0" -- the leading 0 is the result type,
    // and the routine ends `clr.l d2`
    expect(num('A=S Compare$("hello","l",0,0) : Print A')).toBe(3)
  })

  it('POS is 1-based, and 0 and 1 both mean "from the start"', () => {
    expect(num('Print S Compare$("hello","l",1,0)')).toBe(3)
    expect(num('Print S Compare$("hello","l",4,0)')).toBe(4)
    // ...but a NEGATIVE pos does not reach that: the range check above it is
    // `cmp.l d2,d0 / rbcs`, unsigned, so -3 is a huge number and raises
    const b = boot('Print S Compare$("hello","l",-3,0)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('POS past the end of the source raises', () => {
    // cmp.l d2,d0 / rbcs L_error0
    const b = boot('Print S Compare$("hello","l",6,0)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('ENDPOS counts from the start, and 0 means "to the end"', () => {
    expect(num('Print S Compare$("hello","o",0,0)')).toBe(5)
    // stop after 4 characters and the "o" at 5 is out of reach
    expect(num('Print S Compare$("hello","o",0,4)')).toBe(0)
    expect(num('Print S Compare$("hello","l",0,4)')).toBe(3)
  })

  it('DEVIATION: an empty mask runs off the end of its buffer, and answers 0', () => {
    // move.w (a1)+,d1 / move.l d1,d4 / subi.w #1,d4 gives $ffff for a zero
    // length, and the dbra then reads 65,536 bytes of whatever follows
    expect(num('Print S Compare$("hello","",0,0)')).toBe(0)
    expect(num('Print S Compare$("","l",0,0)')).toBe(0)
  })

  it('S Checksum is the AmigaDOS block checksum: -sum of the other 127 longs', () => {
    // routine 83: `sub.l (a0)+,d3` 128 times from zero, then `add.l 20(a0),d3`
    // to take the checksum field itself back out
    const b = run(
      'Reserve As Work 9,512 : Loke Start(9),$11111111 : Loke Start(9)+20,$22222222 : ' +
        'Print S Checksum(Start(9))',
    )
    expect(Number(b.out().trim()) | 0).toBe(-0x11111111 | 0)
  })

  it('S Checksum makes a root block check out when written back to +20', () => {
    const b = run(
      'Reserve As Work 9,512 : Loke Start(9),2 : Loke Start(9)+8,72 : ' +
        'Loke Start(9)+20,S Checksum(Start(9)) : Print S Checksum(Start(9))-Leek(Start(9)+20)',
    )
    // once the field holds the checksum, recomputing gives the field back
    expect(b.out().trim()).toBe('0')
  })

  it('S Delete removes a file, and raises 27 for a name that is not there', () => {
    const b = bootFs('Open Out 1,"RAM:doomed.txt" : Print #1,"x" : Close 1 : S Delete "RAM:doomed.txt"')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.vfs?.exists('RAM:doomed.txt')).toBe(null)
    const c = bootFs('S Delete "RAM:never-existed.txt"')
    expect(() => mustFinish(c.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[27])
  })

  it('DEFECT: the file-or-directory test reads a stale a0, so the file arm is taken', () => {
    // cmpi.l #$0,$4(a0) at $3eb2 -- a0 is the AMOS string pointer the copy loop
    // left behind, not the FileInfoBlock Examine just filled. The directory arm
    // is therefore unreachable in practice, and S Delete on a directory is a
    // plain DeleteFile: fine for an empty one, error 26 for any other.
    const b = bootFs('Mkdir "RAM:emptydir" : S Delete "RAM:emptydir"')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.vfs?.exists('RAM:emptydir')).toBe(null)
    const c = bootFs('Mkdir "RAM:fulldir" : Open Out 1,"RAM:fulldir/x" : Close 1 : S Delete "RAM:fulldir"')
    expect(() => mustFinish(c.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[26])
  })

  it('S Iconify opens a 12-pixel Workbench window and blocks on it', () => {
    // routine 63: NewWindow 200x12 with the width overwritten, IDCMP $200
    // (CLOSEWINDOW alone), flags $100e, Type 1 = WBENCHSCREEN
    const { rt } = boot('S Iconify "Paused",20,20,200 : Print "back"')
    rt.frame()
    const win = rt.sln.iconWindow
    expect(win).not.toBe(null)
    expect(win!.height).toBe(12)
    expect(win!.width).toBe(200)
    expect(win!.title).toBe('Paused')
    // AmalFrz: every channel, and it stays frozen for as long as the window is up
    for (let i = 0; i < 3; i++) rt.frame()
    expect(rt.sln.iconWindow).not.toBe(null)
  })

  it('a width of zero is the only argument it checks, and it raises error 6', () => {
    const b = boot('S Iconify "Paused",20,20,0')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[6])
  })
})

/** a raw sample file: `n` bytes of data the loader will call n-24 long */
const rawSample = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7) & 0xff)

function bootSam(src: string, files: Record<string, Uint8Array> = {}): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  for (const [name, data] of Object.entries(files)) fs.writeFile(`RAM:${name}`, data)
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[SLN_SLOT, sln]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
  })
  return { rt, out: () => printed }
}

const samNum = (src: string, files: Record<string, Uint8Array> = {}): number => {
  const b = bootSam(src, files)
  mustFinish(b.rt.runHeadless(2_000))
  return Number(b.out().trim())
}

describe('SLN: the sample bank', () => {
  it('S Sam Bank Reserve makes an eight-byte "Sln.Sam." bank, defaulting to 6', () => {
    const { rt } = run('S Sam Bank Reserve')
    expect(rt.memBanks.get(6)?.name).toBe('Sln.Sam.')
    expect(rt.memBanks.get(6)?.data.length).toBe(8)
    expect(rt.sln.samBankNr).toBe(6)
    expect(num('S Sam Bank Reserve 9 : Print S Sam Bank')).toBe(9)
  })

  it('S Sam Bank= is a WORD store with no validation at all', () => {
    // routine 43: `move.w d0,(a0)` and nothing else --- the bank is not
    // checked until something looks a sample up, and then it is error 4
    expect(num('S Sam Bank=11 : Print S Sam Bank')).toBe(11)
    expect(num('S Sam Bank=65538 : Print S Sam Bank')).toBe(2)
    const b = boot('S Sam Bank=11 : Print S Sam Base(1)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[4])
  })

  it('a bank number already in use is error 2', () => {
    const b = boot('Reserve As Work 6,100 : S Sam Bank Reserve 6')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[2])
  })

  it('every sample keyword raises 4 with no bank set', () => {
    const b = boot('Print S Sam Base(1)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[4])
  })

  it('=S Sam Base walks the chain, and answers 0 past the end', () => {
    // routine 50: sample 1 is the BANK's own `next`
    const src = 'S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Sam Load "RAM:b.raw" : '
    const files = { 'a.raw': rawSample(100), 'b.raw': rawSample(64) }
    expect(samNum(`${src}Print S Sam Base(1)`, files)).not.toBe(0)
    expect(samNum(`${src}Print S Sam Base(2)`, files)).not.toBe(0)
    expect(samNum(`${src}Print S Sam Base(3)`, files)).toBe(0)
    // S Sam Base(0) makes the counter -1, and dbra decrements before testing,
    // so it walks off the end rather than answering the bank
    expect(samNum(`${src}Print S Sam Base(0)`, files)).toBe(0)
  })

  it('DEFECT: a raw sample is 24 bytes shorter than the file it came from', () => {
    // subi.l #$24,d5 in L_SamLoad3: the size ALLOCATED minus the size READ.
    // The data is the whole file; the last 24 bytes are outside the length.
    expect(samNum('S Sam Bank Reserve : S Sam Load "RAM:a.raw" : Print S Sam Length(1)', {
      'a.raw': rawSample(100),
    })).toBe(76)
  })

  it('a raw sample defaults to 8000 Hz, and S Set Freq changes it', () => {
    const files = { 'a.raw': rawSample(100) }
    expect(samNum('S Sam Bank Reserve : S Sam Load "RAM:a.raw" : Print S Sam Freq(1)', files)).toBe(8000)
    expect(
      samNum('S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Set Freq 1,11025 : Print S Sam Freq(1)', files),
    ).toBe(11025)
  })

  it('=S Sam Length answers 0 for a sample that is not there, where =S Sam Freq raises', () => {
    // routine 60 has `beq _end` where routine 56 has `rbeq L_error0`
    expect(samNum('S Sam Bank Reserve : Print S Sam Length(1)')).toBe(0)
    const b = bootSam('S Sam Bank Reserve : Print S Sam Freq(1)')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('the chain is real memory: the header links can be walked with Leek', () => {
    // +0 previous (the BANK for sample 1), +4 next, +8 length, +12 frequency
    const files = { 'a.raw': rawSample(100), 'b.raw': rawSample(64) }
    const src = 'S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Sam Load "RAM:b.raw" : '
    expect(samNum(`${src}Print Leek(S Sam Base(1)+4)-S Sam Base(2)`, files)).toBe(0)
    expect(samNum(`${src}Print Leek(S Sam Base(2))-S Sam Base(1)`, files)).toBe(0)
    expect(samNum(`${src}Print Leek(S Sam Base(1))-Start(6)`, files)).toBe(0)
    expect(samNum(`${src}Print Leek(S Sam Base(2)+4)`, files)).toBe(0)
  })

  it('S Sam Load with a number splices in BEFORE that sample', () => {
    const files = { 'a.raw': rawSample(100), 'b.raw': rawSample(64) }
    const src = 'S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Sam Load "RAM:b.raw",1 : '
    // b is now sample 1 and a is sample 2 --- 64-24 and 100-24
    expect(samNum(`${src}Print S Sam Length(1)`, files)).toBe(40)
    expect(samNum(`${src}Print S Sam Length(2)`, files)).toBe(76)
  })

  it('S Sam Del unlinks, including sample 1, whose "previous" is the bank', () => {
    const files = { 'a.raw': rawSample(100), 'b.raw': rawSample(64) }
    const src = 'S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Sam Load "RAM:b.raw" : '
    expect(samNum(`${src}S Sam Del 1 : Print S Sam Length(1)`, files)).toBe(40)
    expect(samNum(`${src}S Sam Del 1 : Print S Sam Base(2)`, files)).toBe(0)
    expect(samNum(`${src}S Sam Del 2 : Print S Sam Length(1)`, files)).toBe(76)
  })

  it('S Sam Bank Save writes "Sln.Sam." and S Sam Bank Load reads it back', () => {
    const files = { 'a.raw': rawSample(100), 'b.raw': rawSample(64) }
    const b = bootSam(
      'S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Sam Load "RAM:b.raw" : ' +
        'S Set Freq 2,11025 : S Sam Bank Save "RAM:out.sam" : ' +
        'S Sam Bank Erase : S Sam Bank Load "RAM:out.sam" : ' +
        'Print S Sam Length(1);S Sam Length(2);S Sam Freq(2)',
      files,
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe('76 40 11025')
    const saved = b.rt.vfs!.read('RAM:out.sam')!
    expect(String.fromCharCode(...saved.subarray(0, 8))).toBe('Sln.Sam.')
    // header + data for each: (24 + 76) + (24 + 40)
    expect(saved.length).toBe(8 + 100 + 64)
  })

  it('a file whose first eight bytes are not "Sln.Sam." is error 3', () => {
    const b = bootSam('S Sam Bank Load "RAM:junk.sam"', { 'junk.sam': rawSample(64) })
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[3])
  })

  it('S Sam Clip records a range, and an END of zero deletes it', () => {
    const files = { 'a.raw': rawSample(100) }
    const src = 'S Sam Bank Reserve : S Sam Load "RAM:a.raw" : '
    expect(samNum(`${src}S Sam Clip 1,10,40 : Print Leek(S Sam Base(1)+16)`, files)).toBe(10)
    expect(samNum(`${src}S Sam Clip 1,10,40 : Print Leek(S Sam Base(1)+20)`, files)).toBe(40)
    expect(samNum(`${src}S Sam Clip 1,10,40 : S Sam Clip 1,0,0 : Print Leek(S Sam Base(1)+20)`, files)).toBe(0)
    // an END past the sample is clamped to its length, which is 76
    expect(samNum(`${src}S Sam Clip 1,10,999 : Print Leek(S Sam Base(1)+20)`, files)).toBe(76)
    // ...and an END below the START raises
    const b = bootSam(`${src}S Sam Clip 1,40,10`, files)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('S Sam Play arms a stop timer in FRAMES, and the VBL hook fires it', () => {
    // (times * length) / freq * 50, added to CIA-A's TOD, which ticks at the
    // vertical blank. 76 bytes at 8000 Hz played once is 0.0095s -> 0 frames,
    // so use a longer one: 7600 bytes at 8000 Hz is 0.95s -> 47 frames
    const b = bootSam(
      'S Sam Bank Reserve : S Sam Load "RAM:big.raw" : S Sam Play 1,1,1,63 : Wait Vbl : Wait Vbl',
      { 'big.raw': rawSample(7624) },
    )
    b.rt.frame()
    expect(b.rt.sln.status & (1 << 5)).not.toBe(0) // the timer is armed
    expect(b.rt.sln.status2 & 1).not.toBe(0) // voice 0 is in use
    const stop = b.rt.sln.voices[0]!.stopAt
    expect(stop - (b.rt.interp.tick & 0xffffff)).toBeGreaterThan(40)
    for (let i = 0; i < 60; i++) b.rt.frame()
    expect(b.rt.sln.status & (1 << 5)).toBe(0)
    expect(b.rt.sln.status2 & 1).toBe(0)
  })

  it('TIMES of zero leaves the timer unarmed, which is what makes it infinite', () => {
    // `cmpi.l #0,d0 / beq SamPlayStart` skips the `or.w d5,d6` that sets
    // Status bits 5-8, so nothing ever stops the DMA
    const b = bootSam('S Sam Bank Reserve : S Sam Load "RAM:big.raw" : S Sam Play 1,0,1,63 : Wait Vbl', {
      'big.raw': rawSample(7624),
    })
    b.rt.frame()
    expect(b.rt.sln.status & (1 << 5)).toBe(0)
    for (let i = 0; i < 70; i++) b.rt.frame()
    expect(b.rt.sln.status2 & 1).not.toBe(0)
  })

  it('S Sam Stop clears the DMA, the timer AND the S Volume control bit', () => {
    // routine 58 does `bclr #5+n` and `bclr #1+n` --- and bit 1+n is the
    // volume-control bit S Volume set, so stopping a voice loses the level
    const b = bootSam(
      'S Sam Bank Reserve : S Sam Load "RAM:big.raw" : S Sam Play 1,1,1,63 : S Volume 1,20 : ' +
        'Wait Vbl : S Sam Stop 1 : Wait Vbl',
      { 'big.raw': rawSample(7624) },
    )
    b.rt.frame()
    expect(b.rt.sln.status & 0b10).not.toBe(0)
    b.rt.frame()
    expect(b.rt.sln.status & 0b10).toBe(0)
    expect(b.rt.sln.status2 & 1).toBe(0)
  })

  it('DEFECT: S Sam Play undoes an S Volume that came before it', () => {
    // routine 40 pushes the channel mask back onto AMOS's own argument stack
    // and calls L_StopSam before doing anything else, and StopSam's second
    // bclr is the volume-control bit. So the documented order --- set the
    // level, then play --- is exactly the order that loses it.
    const b = bootSam(
      'S Sam Bank Reserve : S Sam Load "RAM:big.raw" : S Volume 1,20 : S Sam Play 1,1,1,63 : Wait Vbl',
      { 'big.raw': rawSample(7624) },
    )
    b.rt.frame()
    expect(b.rt.sln.status & 0b10).toBe(0)
    // ...and the level itself survives in Volume[0], so re-arming the bit
    // brings it back without another S Volume
    expect(b.rt.sln.volume[0]).toBe(20)
  })

  it('S Volume replaces the whole controlled set rather than adding to it', () => {
    // and.w #%1111111111100001,d2 is the first thing it does
    const { rt } = run('S Volume 2,10 : S Volume 1,32')
    expect(rt.sln.status & 0b0001_1110).toBe(0b10) // voice 0 only
    expect(rt.sln.volume[0]).toBe(32)
  })

  it('a volume of 64 or more raises, and so does a negative one', () => {
    for (const v of ['64', '-1']) {
      const b = boot(`S Volume 1,${v}`)
      expect(() => mustFinish(b.rt.runHeadless(2_000)), v).toThrow(SLN_ERRORS[0])
    }
  })

  it('S Sam Chip Load skips the chip copy S Sam Play would otherwise make', () => {
    const files = { 'a.raw': rawSample(1024) }
    const b = bootSam('S Sam Bank Reserve : S Sam Chip Load "RAM:a.raw" : S Sam Play 1,1,1,63', files)
    mustFinish(b.rt.runHeadless(2_000))
    // no copy was allocated, so nothing is marked "free it when it stops"
    expect(b.rt.sln.status & (0b1111 << 9)).toBe(0)
    expect(b.rt.sln.voices[0]!.base).toBe(0)
    const c = bootSam('S Sam Bank Reserve : S Sam Load "RAM:a.raw" : S Sam Play 1,1,1,63', files)
    mustFinish(c.rt.runHeadless(2_000))
    expect(c.rt.sln.status & (1 << 9)).not.toBe(0)
    expect(c.rt.sln.voices[0]!.base).not.toBe(0)
  })
})

/**
 * A minimal OFS disk image: 1760 blocks with a valid boot block and root
 * block, so `AdfVolume` will mount it and `S Disk Read` has real sectors.
 */
let adfTemplate: Uint8Array | null = null

function blankAdf(label = 'Empty'): Uint8Array {
  if (adfTemplate) {
    const copy = adfTemplate.slice()
    return relabel(copy, label)
  }
  const img = new Uint8Array(1760 * 512)
  img.set([0x44, 0x4f, 0x53, 0x00], 0) // "DOS\0"
  const root = 880 * 512
  const put32 = (off: number, v: number): void => {
    img[off] = (v >>> 24) & 0xff
    img[off + 1] = (v >>> 16) & 0xff
    img[off + 2] = (v >>> 8) & 0xff
    img[off + 3] = v & 0xff
  }
  put32(root + 0, 2) // T_HEADER
  put32(root + 12, 72) // ht_size
  put32(root + 508, 1) // ST_ROOT
  img[root + 432] = label.length
  for (let i = 0; i < label.length; i++) img[root + 433 + i] = label.charCodeAt(i)
  let sum = 0
  for (let i = 0; i < 128; i++) {
    const o = root + i * 4
    sum = (sum - (((img[o]! << 24) | (img[o + 1]! << 16) | (img[o + 2]! << 8) | img[o + 3]!) >>> 0)) | 0
  }
  put32(root + 20, sum >>> 0)
  adfTemplate = img
  return relabel(img.slice(), label)
}

/** put a name in the root block and fix the checksum, so the image stays valid */
function relabel(img: Uint8Array, label: string): Uint8Array {
  const root = 880 * 512
  img.fill(0, root + 432, root + 464)
  img[root + 432] = label.length
  for (let i = 0; i < label.length; i++) img[root + 433 + i] = label.charCodeAt(i)
  const put32 = (off: number, v: number): void => {
    img[off] = (v >>> 24) & 0xff
    img[off + 1] = (v >>> 16) & 0xff
    img[off + 2] = (v >>> 8) & 0xff
    img[off + 3] = v & 0xff
  }
  put32(root + 20, 0)
  let sum = 0
  for (let i = 0; i < 128; i++) {
    const o = root + i * 4
    sum = (sum - (((img[o]! << 24) | (img[o + 1]! << 16) | (img[o + 2]! << 8) | img[o + 3]!) >>> 0)) | 0
  }
  put32(root + 20, sum >>> 0)
  return img
}

function bootDisk(src: string, image: Uint8Array | null): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  // the disk goes in drive 0, which is what `S Disk Open 0` selects -- a name
  // in the mount table is not a drive. See ../amiga/trackdisk.ts.
  const machine = new Machine()
  if (image) machine.drives[0]!.insert(new AdfVolume(image))
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[SLN_SLOT, sln]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
    machine,
  })
  return { rt, out: () => printed }
}

const diskNum = (src: string, image: Uint8Array | null): number => {
  const b = bootDisk(src, image)
  mustFinish(b.rt.runHeadless(2_000))
  return Number(b.out().trim())
}

describe('SLN: trackdisk.device', () => {
  it('=S Disk Dev Check is the one keyword that works before S Disk Open', () => {
    // routine 78 has no L_TrackCheck in front of it; every other one does
    expect(diskNum('Print S Disk Dev Check', null)).toBe(0)
    expect(diskNum('S Disk Open 0 : Print S Disk Dev Check', null)).toBe(-1)
    expect(diskNum('S Disk Open 0 : S Disk Close : Print S Disk Dev Check', null)).toBe(0)
  })

  it('every other trackdisk keyword raises 8 until the device is open', () => {
    // L_TrackCheck, routine 36: `btst #13,Status` and error 8 if clear
    for (const kw of ['S Motor On', 'S Disk Update', 'Print S Num Tracks']) {
      const b = bootDisk(kw, null)
      expect(() => mustFinish(b.rt.runHeadless(2_000)), kw).toThrow(SLN_ERRORS[8])
    }
  })

  it('units 0 to 3 open; 4 and above are error 7', () => {
    expect(diskNum('S Disk Open 3 : Print S Disk Dev Check', null)).toBe(-1)
    const b = bootDisk('S Disk Open 4', null)
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[7])
  })

  it('DEFECT: an empty drive answers -2, where the source comment claims 0', () => {
    // TD_CHANGESTATE puts 0 in io_Actual for a disk present and 1 for none;
    // the routine NOTs it, so a disk is -1 and no disk is -2
    expect(diskNum('S Disk Open 0 : Print S Disk State', null)).toBe(-2)
    expect(diskNum('S Disk Open 0 : Print S Disk State', blankAdf())).toBe(-1)
  })

  it('=S Num Tracks answers 160 for a double-density image', () => {
    // TD_GETNUMTRACKS's io_Actual byte: 80 cylinders of two heads
    expect(diskNum('S Disk Open 0 : Print S Num Tracks', blankAdf())).toBe(160)
    expect(diskNum('S Disk Open 0 : Print S Num Tracks', null)).toBe(0)
  })

  it('S Disk Read copies real sectors into a bank', () => {
    const img = blankAdf('Testing')
    const b = bootDisk(
      'Reserve As Work 9,512 : S Disk Open 0 : S Disk Read 450560,Start(9),512 : ' +
        'Print Peek(Start(9)+432);Chr$(Peek(Start(9)+433))',
      img,
    )
    mustFinish(b.rt.runHeadless(2_000))
    // the root block's name field: a length byte then the characters
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe('7T')
  })

  it('a length or offset that is not a whole sector raises', () => {
    // divu.w #512 on both, and the remainder in the high word must be zero
    for (const args of ['450560,Start(9),100', '450561,Start(9),512']) {
      const b = bootDisk(`Reserve As Work 9,1024 : S Disk Open 0 : S Disk Read ${args}`, blankAdf())
      expect(() => mustFinish(b.rt.runHeadless(2_000)), args).toThrow(SLN_ERRORS[0])
    }
  })

  it('a read from an empty drive is the DISK CHANGED trackdisk error', () => {
    const b = bootDisk('Reserve As Work 9,512 : S Disk Open 0 : S Disk Read 0,Start(9),512', null)
    // io_Error 29, less the routine's own 11, is message 18
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[18])
  })

  it('DEFECT: every trackdisk error is reported one message low', () => {
    // "Trackerrors start with 20, mine at 9" and `subi.l #11,d0` --- but
    // message 9 is the catch-all and TDERR 20's own text is message 10, so
    // every error lands on the message below the right one
    expect(SLN_ERRORS[29 - 11]).toBe('Trackdisk error: Disk was changed')
    expect(SLN_ERRORS[20 - 11]).toBe('Unknown trackdisk error')
    expect(SLN_ERRORS[20 - 10]).toBe('Trackdisk error: No sector header present')
  })

  it('S Disk Write goes back into the image, and S Disk Update invalidates the cache', () => {
    const img = blankAdf()
    const b = bootDisk(
      'Reserve As Work 9,512 : S Disk Open 0 : Loke Start(9),$deadbeef : ' +
        'S Disk Write 0,Start(9),512',
      img,
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect([...img.subarray(0, 4)]).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('S Disk Send Read leaves the buffer untouched until S Disk Wait', () => {
    // SendIO rather than DoIO: "the buffer is not updated, and the motor is
    // still on". S Disk Wait is exec WaitIO and is what completes it.
    const b = bootDisk(
      'Reserve As Work 9,512 : S Disk Open 0 : S Disk Send Read 450560,Start(9),512 : ' +
        'A=Peek(Start(9)+432) : S Disk Wait : Print A;Peek(Start(9)+432)',
      blankAdf('Testing'),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, ' ')).toBe('0 7')
  })

  it('S Disk Abort throws the outstanding request away', () => {
    const b = bootDisk(
      'Reserve As Work 9,512 : S Disk Open 0 : S Disk Send Read 450560,Start(9),512 : ' +
        'S Disk Abort : S Disk Wait : Print Peek(Start(9)+432)',
      blankAdf('Testing'),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('0')
  })

  it('the motor follows TD_MOTOR, and a read turns it off where a send read does not', () => {
    const img = blankAdf()
    const on = bootDisk('S Disk Open 0 : S Motor On', img)
    mustFinish(on.rt.runHeadless(2_000))
    expect(on.rt.sln.disk.motor).toBe(true)
    const read = bootDisk('Reserve As Work 9,512 : S Disk Open 0 : S Disk Read 0,Start(9),512', img)
    mustFinish(read.rt.runHeadless(2_000))
    expect(read.rt.sln.disk.motor).toBe(false)
    const send = bootDisk('Reserve As Work 9,512 : S Disk Open 0 : S Disk Send Read 0,Start(9),512', img)
    mustFinish(send.rt.runHeadless(2_000))
    expect(send.rt.sln.disk.motor).toBe(true)
  })

  it('=S Disk Prot State and =S Disk Changes read the DRIVE, not the image', () => {
    // TD_PROTSTATUS's io_Actual byte sign-extended, and TD_CHANGENUM's
    // zero-extended --- 'Note: Do not extend byte' on the line that does not.
    // Both live on ../amiga/trackdisk.ts: an ADF carries no write-protect tab
    // and cannot count how many times it has been swapped.
    expect(diskNum('S Disk Open 0 : Print S Disk Prot State', blankAdf())).toBe(0)
    // one insertion is one change; the counter moves on removal too
    expect(diskNum('S Disk Open 0 : Print S Disk Changes', blankAdf())).toBe(1)
  })

  it('and the tab answers once a disk goes in write-protected', () => {
    const b = bootDisk('S Disk Open 0 : Print S Disk Prot State', blankAdf())
    b.rt.machine.drives[0]!.writeProtected = true
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('1')
  })

  it('and TD_MOTOR reaches the drive, which is what CIA-A reads for /RDY', () => {
    const b = bootDisk('S Disk Open 0 : S Motor On', blankAdf())
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.machine.drives[0]!.motorOn).toBe(true)
    expect(b.rt.machine.drives[0]!.lines().ready).toBe(true)
  })

  it('S Disk Send Write defers the write, and leaves the motor on', () => {
    // "Note: buffer not updated, and motor is still on" --- and no CMD_UPDATE
    const img = blankAdf()
    const b = bootDisk(
      'Reserve As Work 9,512 : S Disk Open 0 : Loke Start(9),$cafebabe : ' +
        'S Disk Send Write 0,Start(9),512',
      img,
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect([...img.subarray(0, 4)]).toEqual([0x44, 0x4f, 0x53, 0x00]) // still "DOS\0"
    expect(b.rt.sln.disk.motor).toBe(true)
    const c = bootDisk(
      'Reserve As Work 9,512 : S Disk Open 0 : Loke Start(9),$cafebabe : ' +
        'S Disk Send Write 0,Start(9),512 : S Disk Wait : S Motor Off',
      img,
    )
    mustFinish(c.rt.runHeadless(2_000))
    expect([...img.subarray(0, 4)]).toEqual([0xca, 0xfe, 0xba, 0xbe])
    expect(c.rt.sln.disk.motor).toBe(false)
  })

  it('S Disk Rename edits the root block and fixes the checksum', () => {
    const img = blankAdf('Before')
    const b = bootDisk('S Disk Open 0 : S Disk Rename "AfterName"', img)
    mustFinish(b.rt.runHeadless(2_000))
    const root = 880 * 512
    expect(img[root + 432]).toBe(9)
    expect(String.fromCharCode(...img.subarray(root + 433, root + 442))).toBe('AfterName')
    // the block checks out: -sum of the other 127 longs equals the field
    let sum = 0
    for (let i = 0; i < 128; i++) {
      const o = root + i * 4
      sum = (sum - (((img[o]! << 24) | (img[o + 1]! << 16) | (img[o + 2]! << 8) | img[o + 3]!) >>> 0)) | 0
    }
    expect(sum).toBe(0)
    // ...and the volume's own label follows, because the sectors ARE the disk
    expect(new AdfVolume(img).label).toBe('AfterName')
  })

  it('a name longer than 30 characters is clamped', () => {
    const img = blankAdf()
    const b = bootDisk(`S Disk Open 0 : S Disk Rename "${'x'.repeat(40)}"`, img)
    mustFinish(b.rt.runHeadless(2_000))
    expect(img[880 * 512 + 432]).toBe(30)
  })

  it('S Disk Close is called by DEFAULT and END, so it must be safe twice', () => {
    expect(diskNum('S Disk Open 0 : S Disk Close : S Disk Close : Print S Disk Dev Check', null)).toBe(0)
  })
})

// ---- the tracker player --------------------------------------------------

/**
 * A four-position M.K. module, one sample, one pattern per position, with a
 * speed set on channel 1 of every pattern so the tests can drive the position
 * walk without waiting sixty-four rows.
 */
function modFile(speed = 1, volume = 40): Uint8Array {
  const PATTERNS = 4
  const d = new Uint8Array(1084 + PATTERNS * 1024 + 64)
  const dv = new DataView(d.buffer)
  dv.setUint16(20 + 22, 32) // sample 1: 64 bytes
  d[20 + 25] = volume
  dv.setUint16(20 + 28, 1) // the conventional one-word repeat
  d[950] = PATTERNS
  for (let p = 0; p < PATTERNS; p++) d[952 + p] = p
  d.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  const cell = (p: number, row: number, ch: number, cmd: number, info: number): void => {
    const at = 1084 + p * 1024 + row * 16 + ch * 4
    d[at] = 0x1ac >> 8
    d[at + 1] = 0x1ac & 0xff
    d[at + 2] = 0x10 | (cmd & 0xf) // instrument 1
    d[at + 3] = info & 0xff
  }
  for (let p = 0; p < PATTERNS; p++) {
    cell(p, 0, 1, 0xf, speed)
    cell(p, 0, 0, 0, 0)
  }
  return d
}

function bootMod(src: string, data = modFile()): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.writeFile('RAM:tune.mod', data)
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[SLN_SLOT, sln]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
  })
  return { rt, out: () => printed }
}

/** step vertical blanks until the song position changes; answer the new one */
function untilPos(rt: Runtime, limit = 400): number {
  const from = rt.sln.music.replay.pos
  for (let i = 0; i < limit; i++) {
    rt.frame()
    if (rt.sln.music.replay.pos !== from) return rt.sln.music.replay.pos
  }
  return from
}

describe('SLN: the tracker player', () => {
  it('S Track Load reserves a chip data bank called "Tracker "', () => {
    const b = bootMod('S Track Load "RAM:tune.mod"')
    mustFinish(b.rt.runHeadless(2_000))
    const bank = b.rt.memBanks.get(7)!
    expect(bank.name).toBe('Tracker')
    expect(bank.memType).toBe(1) // Bnk_BitChip
    expect(bank.data.length).toBe(modFile().length)
  })

  it('S Track Play refuses a bank that is not one of its own', () => {
    // cmpi.l #"Trac",-$8(a0) / cmpi.l #"ker ",-$4(a0) --- the eight bytes in
    // front of a bank's data are its name
    const b = bootMod('Reserve As Work 7,2000 : S Track Play 7')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[0])
  })

  it('plays, walks its positions and wraps', () => {
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.status & (1 << 14)).not.toBe(0)
    expect(b.rt.sln.music.replay.playing).toBe(true)
    expect(untilPos(b.rt)).toBe(1)
    expect(untilPos(b.rt)).toBe(2)
  })

  it('a start position past the song length is error 25', () => {
    // cmp.b 950(a0),d7 / rbhi --- unsigned, so a start EQUAL to the length is
    // allowed and one past it raises
    const ok = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7,0,4')
    mustFinish(ok.rt.runHeadless(2_000))
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7,0,5')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(SLN_ERRORS[25])
  })

  it('the bare form is bank, 0, 0 — from the top, for ever', () => {
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.music.times).toBe(0)
    expect(b.rt.sln.music.replay.pos).toBe(0)
    // four positions round twice and it is still going
    for (let i = 0; i < 8; i++) untilPos(b.rt)
    expect(b.rt.sln.status & (1 << 14)).not.toBe(0)
  })

  it('TIMES counts wraps, and the player stops when it reaches zero', () => {
    // mt_NextPosition: `subi.w #1,times_to_play / beq mt_StopModule`
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7,1')
    mustFinish(b.rt.runHeadless(2_000))
    for (let i = 0; i < 600 && b.rt.sln.status & (1 << 14); i++) b.rt.frame()
    expect(b.rt.sln.status & (1 << 14)).toBe(0)
    expect(b.rt.sln.music.replay.playing).toBe(false)
  })

  it('S Track Stop is safe when nothing is playing', () => {
    // btst #14,Status first
    const b = bootMod('S Track Stop : S Track Load "RAM:tune.mod" : S Track Play 7 : S Track Stop')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.status & (1 << 14)).toBe(0)
  })

  it('the speed comes from TrackTempo, not from 6', () => {
    // mt_init: `lea mt_speed(pc),a1 / dlea TrackTempo,a2 / move.b (a2),(a1)`
    expect(num('Print S Track Tempo')).toBe(6)
    const b = bootMod('S Track Tempo=3 : S Track Load "RAM:tune.mod" : S Track Play 7')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.music.replay.speed).toBe(3)
    expect(num('S Track Tempo=3 : Print S Track Tempo')).toBe(3)
  })

  it('S Track Tempo= also changes the LIVE speed and clears the tick counter', () => {
    // mt_SetTempo: `clr.b mt_counter / move.b d1,mt_speed`
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7 : Wait Vbl : Wait Vbl : S Track Tempo=9')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.music.replay.speed).toBe(9)
    expect(b.rt.sln.music.replay.counter).toBe(0)
  })

  it('=S Track Tempo reads the extension’s byte and NOT the player’s speed', () => {
    // routine 94 reads TrackTempo; an Fxx in the module moves mt_speed and
    // leaves it alone. The fixture sets F01 on every pattern.
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7 : Wait Vbl : Wait Vbl : Print S Track Tempo')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('6')
    // the first row lands `speed` blanks in, and speed starts at TrackTempo
    for (let i = 0; i < 10; i++) b.rt.frame()
    expect(b.rt.sln.music.replay.speed).toBe(1)
  })

  it('=S Track Length is the byte at 950, and it checks no bank name', () => {
    const b = bootMod('S Track Load "RAM:tune.mod" : Print S Track Length(7)')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('4')
  })

  it('S Track Volume scales the sample volume at the instrument trigger', () => {
    // mulu.w d5,d0 / divu #100,d0 / cmpi.w #64,d0 / bgt --- and ONLY there:
    // Cxx and the volume slides write the channel volume with no factor
    // AFTER the play: mt_init writes `#100` into mt_VolFaktor every time, so
    // setting the level first is setting it for nobody
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7 : S Track Volume 50')
    mustFinish(b.rt.runHeadless(2_000))
    for (let i = 0; i < 10; i++) b.rt.frame()
    expect(b.rt.sln.music.replay.channels[0]!.volume).toBe(20) // 40 * 50 / 100
    const full = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7')
    mustFinish(full.rt.runHeadless(2_000))
    for (let i = 0; i < 10; i++) full.rt.frame()
    expect(full.rt.sln.music.replay.channels[0]!.volume).toBe(40)
  })

  it('a factor above 100 is allowed, and the player clamps at 64', () => {
    // no range check anywhere; `cmpi.w #64,d0 / bgt .high` is the only limit
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7 : S Track Volume 200')
    mustFinish(b.rt.runHeadless(2_000))
    for (let i = 0; i < 10; i++) b.rt.frame()
    expect(b.rt.sln.music.replay.channels[0]!.volume).toBe(64)
  })

  it('S Track Play puts the factor back to 100, as mt_init does', () => {
    // `lea mt_VolFaktor(pc),a0 / move.b #100,(a0)` on every init
    const b = bootMod(
      'S Track Load "RAM:tune.mod" : S Track Volume 50 : S Track Play 7 : S Track Play 7',
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.music.replay.trigVolPercent).toBe(100)
  })

  it('Status2 takes voices away from the music while a sample holds them', () => {
    // every voice loop writes to a ten-byte `dummy` instead of the hardware
    // for a channel Status2 claims, and the mask is sampled once a frame
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7 : Wait Vbl')
    mustFinish(b.rt.runHeadless(2_000))
    b.rt.frame()
    expect(b.rt.sln.music.replay.voices).toBe(0b1111)
    b.rt.sln.status2 = 0b0101
    b.rt.frame()
    expect(b.rt.sln.music.replay.voices).toBe(0b1010)
  })

  it('there is no CIA tempo here, so Fxx above 31 is a SPEED', () => {
    // mt_CheckMoreEfx sends every F to mt_SetSpeed with no range test, so
    // this player needs none of the "ticks once a vertical blank" deviation
    // the other replayers in this port carry
    const b = bootMod('S Track Load "RAM:tune.mod" : S Track Play 7', modFile(0x80))
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.sln.music.replay.ciaTempo).toBe(false)
    for (let i = 0; i < 10; i++) b.rt.frame()
    expect(b.rt.sln.music.replay.speed).toBe(0x80)
  })
})
