/**
 * GameSupport 1.2, against `AMOSPro_GameSupport.Lib` disassembled with
 * `extdis gamesupport-1.2`, the author's partial source (`GameSupport.s` — the
 * shell only, six includes missing) and `GameSupport.guide`.
 *
 * Where guide and binary disagree the binary wins, and the disagreements are
 * pinned here so nobody quietly "fixes" them back to the prose.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { DIR_LEFT, DIR_RIGHT, DIR_UP } from '../amiga/controller'
import { JP_TYPE_JOYSTK, JPF_BUTTON_RED, JPF_JOY_UP } from '../amiga/lowlevel'
import { GAMESUPPORT_ERRORS } from './gamesupport'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 23 — `ExtNb equ 23-1` in the source, `$258(a5)` in the binary */
const GS_SLOT = 23
const gs = extensionById('gamesupport-1.2')!
const extensions = new Map([[GS_SLOT, gs.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[GS_SLOT, gs]]),
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

describe('GameSupport: the cold start', () => {
  it('seeds all four counter halves off the live registers', () => {
    // routine 0 $4de-$50e reads JOY1DAT then JOY0DAT, low byte then high, into
    // $42/$3a/$46/$3e. Seeding matters: the first Gsmousedx must measure from
    // installation, not from a zero the mouse was never at. The pointer starts
    // at hardware 288,150, and a counter is the position through 8 bits.
    const { rt } = boot('')
    expect(rt.gamesupport.prev[0]).toEqual({ x: 288 & 0xff, y: 150 & 0xff })
    // an unmoved mouse therefore accumulates nothing at the first vbl
    rt.frame()
    expect(rt.gamesupport.accumX).toBe(0)
    expect(rt.gamesupport.accumY).toBe(0)
  })

  it('starts at speed 1, which is a factor of 8', () => {
    // `move.l #$8,$2e(a0)` at $4d6 --- the factor is speed+7, so 8 is speed 1
    expect(boot('').rt.gamesupport.speed).toBe(8)
  })

  it('leaves Gstimer’s context at zero, which the guide calls garbage', () => {
    // the block at $1c1a is static and the cold start never writes $4a, so it
    // holds the file's own zeros --- "the first time this call is used, the
    // result will be garbage". It is not garbage, it is the uptime.
    expect(boot('').rt.gamesupport.clock.last).toBe(0)
  })
})

describe('GameSupport: Gsreadport', () => {
  it('hands back ReadJoyPort’s bitfield unchanged', () => {
    // routine 2 ($1d96) is `jsr -$1e(a6)` and `move.l d0,d3` --- -30 is the
    // first entry in lowlevel_lib.fd at its bias of 30
    const v = num('Print Gsreadport(1)', (rt) => {
      rt.input.ports[1].dirs = DIR_UP
      rt.input.joy = 16 | 1 // fire + up, through the accessor
    })
    expect(v).toBe(JP_TYPE_JOYSTK | JPF_JOY_UP | JPF_BUTTON_RED)
  })

  it('does NOT range-check its port, unlike Gsmousedx', () => {
    // there is no cmp/bmi pair in routine 2 at all. An out-of-range port
    // reaches ReadJoyPort, which answers JP_TYPE_NOTAVAIL --- zero.
    expect(num('Print Gsreadport(2)')).toBe(0)
    expect(num('Print Gsreadport(-1)')).toBe(0)
  })

  it('raises error 0 when lowlevel.library is not open', () => {
    // `move.l $52(a2),d3 / beq -> routine 100 with d0=0`. lowlevel.library is
    // modelled here so it opens; this is the arm a Kickstart 1.3 machine gets,
    // and the extension's own BugsFixed node is about getting it wrong.
    const b = boot('Print Gsreadport(1)')
    b.rt.gamesupport.lowlevel = false
    expect(() => b.rt.runHeadless(2_000)).toThrow(GAMESUPPORT_ERRORS[0])
  })
})

describe('GameSupport: the mouse counters', () => {
  it('port 0 accumulates at the VBL and reads to zero', () => {
    // routine 4's port-0 arm ($1e28) is `move.l $32(a2),d3` then
    // `move.l #$0,$32(a2)` --- the VBL hook at $1ba2 is what fills it
    const b = boot('Print Gsmousedx(0);Gsmousedx(0)')
    b.rt.input.mouseX += 10
    b.rt.frame()
    mustFinish(b.rt.runHeadless(2_000))
    // 10 counts at the default factor of 8: (10*8)>>3
    expect(b.out().trim()).toBe('10 0')
  })

  it('port 0 tracks the vertical counter separately', () => {
    const b = boot('Print Gsmousedy(0)')
    b.rt.input.mouseY += 7
    b.rt.frame()
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('7')
  })

  it('port 1 is differenced when asked, not at the VBL', () => {
    // routine 4's port-1 arm reads JOY1DAT live and remembers the byte. The
    // low byte is `bit1 = right, bit0 = right XOR down`, so right ALONE sets
    // both bits and the counter reads 3, not 1 --- that is the quadrature
    // encoding, and it is why a stick looks like a jittery mouse here.
    const b = boot('Print Gsmousedx(1);Gsmousedx(1)')
    b.rt.input.ports[1].dirs = DIR_RIGHT
    mustFinish(b.rt.runHeadless(2_000))
    // 3 counts, then nothing further because the stick has stopped moving
    expect(b.out().trim()).toBe('3 0')
  })

  it('port 1’s vertical byte carries left, not up', () => {
    // the high byte is `bit9 = left, bit8 = left XOR up` --- left and up share
    // it exactly as right and down share the low one. Left alone gives 3, up
    // alone gives 1, and a reader recovering up needs bit8 XOR bit9.
    const b = boot('Print Gsmousedy(1)')
    b.rt.input.ports[1].dirs = DIR_LEFT
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('3')
    const up = boot('Print Gsmousedy(1)')
    up.rt.input.ports[1].dirs = DIR_UP
    mustFinish(up.rt.runHeadless(2_000))
    expect(up.out().trim()).toBe('1')
  })

  it('wraps the delta through 8 bits, so a big jump is misreported', () => {
    // `cmp.l #$80 / bge -> sub #$100` at $1e3a. The guide warns about exactly
    // this: "otherwise very fast mouse movements will be misinterpreted".
    const b = boot('Print Gsmousedx(0)')
    b.rt.input.mouseX += 200 // 200 counts forward reads as 56 back
    b.rt.frame()
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-56')
  })

  it('raises error 2 on a port outside 0..1, negative first', () => {
    // `bmi` fires before the block is even loaded, then `cmp.l #$1 / bne`
    for (const src of ['Print Gsmousedx(2)', 'Print Gsmousedy(2)', 'Print Gsmousedx(-1)']) {
      expect(() => run(src), src).toThrow(GAMESUPPORT_ERRORS[2])
    }
  })
})

describe('GameSupport: Gssetmousespeed', () => {
  it('stores speed + 7 and scales by it', () => {
    // "dx=(dx*(speed+7))/8" --- speed 9 is a factor of 16, so twice normal,
    // which is what the guide's own example says: "gssetmousespeed 9 : rem
    // twice normal speed"
    const b = boot('Gssetmousespeed 9')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.gamesupport.speed).toBe(16)

    // and the accumulator ($32) is what the factor acts on, at VBL time
    b.rt.input.mouseX += 10
    b.rt.frame()
    expect(b.rt.gamesupport.accumX).toBe(20)
  })

  it('accepts 32760 and refuses 32761, exactly as the guide says', () => {
    // `addq.w #$7,d0 / tst.w d0 / bmi` --- 32760+7 is $7fff and 32761+7 is
    // $8000, which reads as negative. The guide says "the maximum value is
    // 32760(!)"; the ERROR MESSAGE says "between 0 and 32761" and is wrong.
    expect(() => run('Gssetmousespeed 32760')).not.toThrow()
    expect(() => run('Gssetmousespeed 32761')).toThrow(GAMESUPPORT_ERRORS[1])
  })

  it('refuses 0, so the message’s lower bound is wrong too', () => {
    // `move.l (a3)+,d0 / beq -> error 1` tests the whole long
    expect(() => run('Gssetmousespeed 0')).toThrow(GAMESUPPORT_ERRORS[1])
  })

  it('a speed of -7 stores a factor of zero and never raises', () => {
    // the WORD add makes the low word 0, which `tst.w` reads as not negative.
    // Every delta then scales to nothing --- a quirk, not a guard.
    const b = boot('Gssetmousespeed -7')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.gamesupport.speed & 0xffff).toBe(0)
    b.rt.input.mouseX += 100
    b.rt.frame()
    expect(b.rt.gamesupport.accumX).toBe(0)
  })
})

describe('GameSupport: Gstimer', () => {
  it('measures 1/65536ths of a second between calls', () => {
    // ElapsedTime at -102. The guide's own example is 200 vblanks, which at
    // PAL 50 Hz is four seconds: 200 * 65536 / 50.
    const b = boot('T=Gstimer : For A=1 To 200 : Wait Vbl : Next A : Print Gstimer')
    mustFinish(b.rt.runHeadless(20_000))
    expect(Number(b.out().trim())).toBe(Math.floor((200 * 65536) / 50))
  })

  it('the first call answers the uptime, which the guide calls garbage', () => {
    // the context is zero and never initialised, so the first result is
    // everything since the clock started rather than a duration
    const b = boot('For A=1 To 10 : Wait Vbl : Next A : Print Gstimer')
    mustFinish(b.rt.runHeadless(20_000))
    expect(Number(b.out().trim())).toBeGreaterThan(0)
  })

  it('raises error 0 without lowlevel.library, like Gsreadport', () => {
    const b = boot('Print Gstimer')
    b.rt.gamesupport.lowlevel = false
    expect(() => b.rt.runHeadless(2_000)).toThrow(GAMESUPPORT_ERRORS[0])
  })
})

describe('GameSupport: the gsjoystick driver, which nobody has', () => {
  it('Gscontrollertype and Gsreadsega answer 0 rather than raising', () => {
    // routines 98 ($2c30) and 99 ($2c54) both `move.l $66(a2),d0 / beq` to a
    // plain `moveq #$0,d3 / rts`. $66 is GSDrivers/gsjoystick.library, which
    // does not ship in the archive and which the guide's Modules node
    // describes in the future tense. Zero is what the routine returns on every
    // machine without it, so it is the faithful answer and not a stub.
    expect(num('Print Gscontrollertype')).toBe(0)
    expect(num('Print Gsreadsega')).toBe(0)
  })
})
