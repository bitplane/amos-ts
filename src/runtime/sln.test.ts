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
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
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
