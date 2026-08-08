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
