/**
 * Delta 1.4, against `AMOSPro_Delta.Lib` disassembled with `extdis delta-1.4`
 * and against `AMOSPro_Delta.Guide`, which documents all twenty-six.
 *
 * Two of the defects here are pinned by comparison rather than by behaviour,
 * because the behaviour is the machine's and this port has no vector table to
 * corrupt and no interrupt to switch off. The five keywords Delta shares with
 * Misc 1.0 are pinned against Misc's own handlers, since Misc ships the source
 * that proves what they do.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { ffp } from './delta'

const table = new TokenTable(CORE_TOKENS)
/** slot 15 — the guide's install note, and routine 0's `moveq #$e,d0` */
const DELTA_SLOT = 15
const delta = extensionById('delta-1.4')!
const extensions = new Map([[DELTA_SLOT, delta.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[DELTA_SLOT, delta]]),
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

const text = (src: string, prep?: (rt: Runtime) => void): string => run(src, prep).out()

describe('Delta: the display pokes', () => {
  it('Delta Pal writes $2020, because a byte write reaches both halves', () => {
    // `move.b #$20,$dff1dc` is the register's HIGH half; PAL is bit 5 in the
    // low one, and only arrives because the 68000 duplicates the byte across
    // the bus. Personnal's Set Pal writes the same register as a word
    expect(run('Delta Pal').rt.beamcon0).toBe(0x2020)
  })

  it('Delta Ntsc clears BEAMCON0 outright', () => {
    expect(run('Delta Pal : Delta Ntsc').rt.beamcon0).toBe(0)
  })

  it('Delta No Synchro puts the program\'s byte in both halves', () => {
    expect(run('Delta No Synchro 1').rt.beamcon0).toBe(0x0101)
    expect(run('Delta No Synchro $FF').rt.beamcon0).toBe(0xffff)
    // a byte write, so anything above 255 is truncated
    expect(run('Delta No Synchro $123').rt.beamcon0).toBe(0x2323)
  })

  it('DEFECT: Delta Decrunch sets colour ONE and blacks colour zero', () => {
    // `move.l d0,$dff180` writes COLOR00 from the high word and COLOR01 from
    // the low one, so the guide's "This efect using colour 0" is backwards
    const { rt } = run('Screen Open 0,320,64,16,0 : Colour 0,$FFF : Delta Decrunch $F00')
    expect(rt.screen.palette[0]).toBe(0)
    expect(rt.screen.palette[1]).toBe(0xf00)
  })

  it('Delta Decrunch refuses 0 and anything from 4096 up', () => {
    const scr = 'Screen Open 0,320,64,16,0 : '
    expect(() => run(`${scr}Delta Decrunch 0`)).toThrow(/Illegal function call/)
    expect(() => run(`${scr}Delta Decrunch 4096`)).toThrow(/Overflow/)
    expect(() => run(`${scr}Delta Decrunch 4095`)).not.toThrow()
  })

  it('DEFECT: Delta Inter On does nothing, and Delta Inter Off is not reproduced', () => {
    // routine 6 is `move.w #$0,$dff09a` -- INTENA's bit 15 chooses set or
    // clear, and with it clear the write clears the bits present in $0000,
    // which is none. Routine 11 is `#$4000` and really does take INTEN down,
    // so a program can turn interrupts off and has no way back; reproducing
    // that means hanging, so both run and neither changes anything
    const { rt, out } = run('Delta Inter Off : Delta Inter On : Print 1')
    expect(out().trim()).toBe('1')
    // the vertical blank is still running, which on the machine it would not be
    const before = rt.interp.tick
    rt.frame()
    expect(rt.interp.tick).toBeGreaterThan(before)
  })

  it('DEFECT: both checks are word tests, so negatives pass and 65536 does not', () => {
    const scr = 'Screen Open 0,320,64,16,0 : '
    // `cmpi.w #$1000` is a SIGNED word compare, and -1 is $ffff as a word
    const { rt } = run(`${scr}Delta Decrunch -1`)
    expect(rt.screen.palette[1]).toBe(0xfff)
    // ...while 65536, whose low word is zero, is refused as if it were 0
    expect(() => run(`${scr}Delta Decrunch 65536`)).toThrow(/Illegal function call/)
  })
})

describe('Delta: the five keywords that are Misc 1.0\'s', () => {
  it('Delta Mouse Off clears sprite DMA, and nothing puts it back', () => {
    const { rt } = run('Delta Mouse Off')
    expect(rt.spriteDma).toBe(false)
  })

  it('DEFECT: the two drive-motor keywords are the wrong way round', () => {
    // both write $7f then $77 to CIA-B port B and differ only in the direction
    // register: On makes it all INPUTS, which stops driving /MTR
    expect(run('Delta Drive Motor On').rt.driveMotor).toBe(false)
    expect(run('Delta Drive Motor Off').rt.driveMotor).toBe(true)
    expect(run('Delta Drive Motor Off : Delta Drive Motor On').rt.driveMotor).toBe(false)
  })

  it('it is the same flag Misc 1.0\'s Dled On and Dled Off write', () => {
    // the same four writes from two extensions that do not know about each
    // other, which is why the flag is on the Runtime
    const misc = extensionById('misc-1.0')!
    const both = new Map([
      [DELTA_SLOT, delta.table],
      [20, misc.table],
    ])
    const rt = new Runtime(tokenize('Dled Off : Delta Drive Motor On', table, both), table, {
      extensions: both,
      extBindings: new Map([
        [DELTA_SLOT, delta],
        [20, misc],
      ]),
      maxSteps: 200_000,
    })
    mustFinish(rt.runHeadless(2_000))
    expect(rt.driveMotor).toBe(false)
  })

  it('Delta Change Disk returns instead of waiting for a floppy', () => {
    // there is no disk to swap and no Validator task to outlive; the
    // alternative is to block for ever
    expect(() => run('Delta Change Disk : Print 1')).not.toThrow()
    expect(text('Delta Change Disk : Print 1').trim()).toBe('1')
  })

  it('Delta Wait Fire waits until the button is down', () => {
    // held from the start, so it falls straight through
    expect(text('Delta Wait Fire : Print 1', (rt) => (rt.input.joy = 16)).trim()).toBe('1')
    // never pressed: the statement blocks and the program does not finish
    const b = boot('Delta Wait Fire : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })
})

describe('Delta: the waits', () => {
  it('Delta Wait Left Mouse falls through on a held button and blocks otherwise', () => {
    expect(text('Delta Wait Left Mouse : Print 1', (rt) => (rt.input.mouseK = 1)).trim()).toBe('1')
    const b = boot('Delta Wait Left Mouse : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })

  it('DEFECT: Delta Wait Double Mouse never waits for a RELEASE', () => {
    // press, delay, press -- with nothing between, so a button that is still
    // held when the delay runs out satisfies the second wait too and one click
    // counts as two
    const b = boot('Delta Wait Double Mouse 1 : Print 1')
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('1')
  })

  it('and it does not finish while the button is never pressed', () => {
    const b = boot('Delta Wait Double Mouse 100 : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })
})

describe('Delta: Reset', () => {
  it('asks the machine for a cold reset and ends the program', () => {
    // Misc 1.0's Reset instruction for instruction, and `clr.l $4.w` wipes
    // ExecBase, so the ROM cold-boots
    const { rt, out } = run('Delta Reset : Print 1')
    expect(rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'delta reset' })
    expect(out()).toBe('')
  })
})

describe('Delta: the constants', () => {
  it('Delta Pi# and Delta E# are FFP longwords, accurate to seven digits', () => {
    // $c90fdb42 and $adf85442: a 24-bit mantissa is all FFP has
    expect(ffp(0xc90fdb42)).toBeCloseTo(Math.PI, 6)
    expect(ffp(0xadf85442)).toBeCloseTo(Math.E, 6)
    // and not to eight, which is the point of spelling the format out
    expect(ffp(0xc90fdb42)).not.toBe(Math.PI)
    const p = Number(text('Print Delta Pi#').trim())
    const e = Number(text('Print Delta E#').trim())
    expect(p).toBeCloseTo(Math.PI, 5)
    expect(e).toBeCloseTo(Math.E, 5)
  })

  it('Delta Brithday is an integer and nothing says how to read it', () => {
    expect(Number(text('Print Delta Brithday').trim())).toBe(0x015f70ad)
  })

  it('the unit strings are the bytes the routines write', () => {
    expect(text('Print Delta Yard$').trim()).toBe('0.9144')
    expect(text('Print Delta Feet$').trim()).toBe('0.3048')
    expect(text('Print Delta Inch$').trim()).toBe('0.0254')
    expect(text('Print Delta English Mile$').trim()).toBe('1852')
    expect(text('Print Delta American Mile$').trim()).toBe('1853.25')
    expect(text('Print Delta Euler$').trim()).toBe('0.57722')
    expect(text('Print Delta About$').trim()).toBe('Delta of Opium^Hv^Fnz!')
  })

  it('two of them carry a unit that Val has to stop at', () => {
    // the guide's own `Radian#=Val(Delta Radian$)` depends on it
    expect(text('Print Delta Radian$').trim()).toBe('57.29578°')
    expect(text('Print Delta Degree$').trim()).toBe('0.01745rd')
    expect(Number(text('Print Val(Delta Radian$)').trim())).toBeCloseTo(57.29578, 4)
    expect(Number(text('Print Val(Delta Degree$)').trim())).toBeCloseTo(0.01745, 5)
  })
})
