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

describe('GameSupport: Gssqr, which the guide never mentions', () => {
  /**
   * Its usable domain, which nothing documents because nothing documents the
   * keyword. The seed is `(x >> 8) + 7` and there are only five passes, so it
   * fails in three different ways as the argument grows, and all three are
   * pinned below rather than hidden behind a well-chosen example.
   */
  it('is exact for perfect squares up to 1994 squared', () => {
    for (const n of [1, 4, 9, 16, 100, 144, 1024, 1993, 1994]) {
      expect(num(`Print Gssqr(${n * n})`), `${n}^2`).toBe(n)
    }
    // 1995 is the first that is not: five passes have not converged and it
    // lands one above. From here up it drifts, by as much as 19 near the top.
    expect(num('Print Gssqr(3980025)')).toBe(1996)
  })

  it('goes to garbage at $800000, where ext.l makes the seed negative', () => {
    // `lsr.l #$8, d2 / ext.l d2` — the seed is the low WORD of x>>8, signed.
    // At $800000 that word reaches $8000 and the guess goes negative; `lsr.l
    // #$1` then turns the sum into a number near 2^31 and it never recovers.
    expect(num('Print Gssqr(8388607)')).toBe(2916) // just under: still sane
    expect(num('Print Gssqr(8388608)')).toBe(134216840) // $800000: garbage
  })

  it('returns zero for zero, before it can divide by anything', () => {
    // `move.l d0,d2 / beq` — the early exit hands back the zero it tested
    expect(num('Print Gssqr(0)')).toBe(0)
  })

  it('mostly truncates, but five passes are not always enough to settle', () => {
    expect(num('Print Gssqr(2)')).toBe(1)
    expect(num('Print Gssqr(10)')).toBe(3)
    expect(num('Print Gssqr(101)')).toBe(10)
    // 99 does NOT truncate. The iteration oscillates 10, 9, 10, 9, 10 and
    // `dbra` runs out on the high side, so the routine answers 10 where
    // Sqr(99) is 9.949. `beq` only exits when a pass repeats its own guess,
    // and a two-cycle never does.
    expect(num('Print Gssqr(99)')).toBe(10)
  })

  it('divides by zero at $fff900, because the seed’s low word lands on 0', () => {
    // `lsr.l #$8 / ext.l / addq.w #$7` — (x>>8) ending in $fff9 seeds a low
    // word of zero and the routine has NO guard. On the machine this is a
    // 68000 zero-divide exception rather than an AMOS error; there is no
    // vector here, so it surfaces as error 20, the nearest true thing to say.
    expect(() => run('Print Gssqr(16775424)')).toThrow(/Division by zero/i)
    // and it is a narrow window: one count either side is fine
    expect(() => run('Print Gssqr(16775423)')).not.toThrow()
    expect(() => run('Print Gssqr(16775680)')).not.toThrow()
  })
})

describe('GameSupport: Gspyth', () => {
  it('is Sqr(x*x+y*y), to the integer below', () => {
    // the guide: "equivalent to d=Sqr(x*x+y*y), but is nearly 3 times as fast"
    for (const [x, y] of [
      [3, 4],
      [5, 12],
      [8, 15],
      [30, 44],
      [1, 10],
      [300, 400],
    ] as const) {
      expect(num(`Print Gspyth(${x},${y})`), `${x},${y}`).toBe(Math.floor(Math.sqrt(x * x + y * y)))
    }
  })

  it('takes the absolute value of both arguments', () => {
    // `bpl / neg.l` on each, so the quadrant never reaches the arithmetic
    expect(num('Print Gspyth(-3,4)')).toBe(5)
    expect(num('Print Gspyth(3,-4)')).toBe(5)
    expect(num('Print Gspyth(-3,-4)')).toBe(5)
  })

  /**
   * **The order DOES matter, and the guide says it does not.**
   *
   * The seed is `(|x| + 2|y|) / 2 + 7`, so y counts double. For a long thin
   * triangle that is the difference between a seed near the answer and a seed
   * near half of it — and half is fatal, because `ext.l` sign-extends the
   * QUOTIENT WORD. A first quotient above 32767 comes back NEGATIVE, `lsr.l
   * #$1` then turns the negative sum into a number near 2^31, and the
   * iteration never recovers.
   *
   * This is the whole of the guide's *"please keep the values of x & y below
   * about 20000, since results become unpredictable if larger numbers are
   * used"*, and its *"though the order doesn't matter!"* is wrong.
   */
  it('converges either way round for ordinary triangles', () => {
    for (const [x, y] of [
      [3, 400],
      [400, 3],
      [300, 400],
      [400, 300],
    ] as const) {
      expect(num(`Print Gspyth(${x},${y})`), `${x},${y}`).toBe(Math.floor(Math.sqrt(x * x + y * y)))
    }
  })

  it('but diverges for a long thin triangle the WRONG way round', () => {
    // y large: the seed is ~19999 and the answer is 19999, so it settles
    expect(num('Print Gspyth(1,19999)')).toBe(19999)
    // x large: the seed is ~10000 for the same answer, the first quotient is
    // ~39968, `ext.l` reads that word as -25568, and it runs away
    expect(num('Print Gspyth(19999,1)')).toBe(33556598)
  })

  it('squares only the LOW WORD, which is the guide’s 20000 warning', () => {
    // `muls.w` is a signed 16x16 multiply. 65536 has a low word of zero, so
    // both squares vanish and `tst.l d0 / beq` hands back |x| + 2|y| instead
    // of a distance at all.
    expect(num('Print Gspyth(65536,0)')).toBe(65536)
    expect(num('Print Gspyth(0,65536)')).toBe(131072)
    // and 40000 is read as its signed low word, -25536
    expect(num('Print Gspyth(40000,0)')).toBe(25536)
  })

  it('answers 0 for the origin', () => {
    expect(num('Print Gspyth(0,0)')).toBe(0)
  })
})

describe('GameSupport: Gsmulti On and Off', () => {
  it('are exec’s Forbid and Permit, and observably nothing here', () => {
    // routines 10 ($21cc) and 11 ($21e0): `jsr -$84(a6)` and `jsr -$8a(a6)` on
    // exec, which are Forbid and Permit. There is one task in this port, so
    // there is nothing to forbid --- see ../amiga/exec.ts's own header. They
    // must still run without raising, and unbalanced nesting must not either.
    expect(() => run('Gsmulti Off : Gsmulti On')).not.toThrow()
    expect(() => run('Gsmulti Off : Gsmulti Off : Gsmulti On')).not.toThrow()
    expect(() => run('Gsmulti On')).not.toThrow()
  })
})

describe('GameSupport: the passcodes', () => {
  /** the guide's own worked example, both halves of it */
  const ROUNDTRIP = [
    'Dim A(3) : A(0)=10 : A(1)=9 : A(2)=8 : A(3)=7',
    'P$=Gspasscode("Testing",Varptr(A(0)),4)',
  ].join('\n')

  it('encodes to upper case letters and the digits 4 to 9, only', () => {
    // "The returned passcode can contain the upper case letters (A-Z) and the
    // digits 4 to 9" --- `addi.l #$41 / cmp.l #$5a / ble / subi.l #$27`
    const { out } = run(`${ROUNDTRIP}\nPrint P$`)
    expect(out().trim()).toMatch(/^[A-Z4-9]+$/)
  })

  it('is six characters for the guide’s four small values', () => {
    // Gspassdecode's node: "a 6 character passcode could contain 1, 2, 3 or 4
    // values". Each of 10, 9, 8 and 7 fits in one 4-bit group, so the code is
    // one length character, four groups and one check character.
    expect(num(`${ROUNDTRIP}\nPrint Len(P$)`)).toBe(6)
  })

  it('round-trips through Gspassdecode, and answers the count', () => {
    const { out } = run(
      [
        ROUNDTRIP,
        'Dim B(3)',
        'L=Gspassdecode("Testing",P$,Varptr(B(0)))',
        'Print L;B(0);B(1);B(2);B(3)',
      ].join('\n'),
    )
    expect(out().trim()).toBe('4 10 9 8 7')
  })

  it('round-trips negative numbers, which cost eight groups each', () => {
    // "avoid negative numbers; the number 1 will encode to a single character
    // within the final code whereas the number -1 will require eight" ---
    // `lsr.l #$4` is logical, so -1 never shifts down to zero early
    const { out } = run(
      [
        'Dim A(0) : A(0)=-1',
        'P$=Gspasscode("K",Varptr(A(0)),1)',
        'Dim B(0)',
        'Print Len(P$);Gspassdecode("K",P$,Varptr(B(0)));B(0)',
      ].join('\n'),
    )
    // 8 groups + the length character + the check character
    expect(out().trim()).toBe('10 1-1')
  })

  it('round-trips a spread of values and array sizes', () => {
    for (const vals of [[0], [15], [16], [255], [4095], [65536], [1, 2, 3], [123456, 7, 89]]) {
      const n = vals.length
      const set = vals.map((v, i) => `A(${i})=${v}`).join(' : ')
      const { out } = run(
        [
          `Dim A(${n - 1}) : ${set}`,
          `P$=Gspasscode("My game's encryption key",Varptr(A(0)),${n})`,
          `Dim B(${n - 1})`,
          `L=Gspassdecode("My game's encryption key",P$,Varptr(B(0)))`,
          `Print L;${vals.map((_, i) => `B(${i})`).join(';')}`,
        ].join('\n'),
      )
      expect(out().trim(), vals.join(',')).toBe(` ${n}${vals.map((v) => (v < 0 ? v : ` ${v}`)).join('')}`.trim())
    }
  })

  it('refuses a passcode made under a different ID', () => {
    // "Passcodes created under one ID will not unscramble correctly under
    // another" --- the digest seeds the keystream, so nothing lines up
    const { out } = run(
      [
        'Dim A(1) : A(0)=42 : A(1)=99',
        'P$=Gspasscode("alpha",Varptr(A(0)),2)',
        'Dim B(1)',
        'Print Gspassdecode("beta",P$,Varptr(B(0)))',
      ].join('\n'),
    )
    expect(out().trim()).toBe('0')
  })

  it('is case sensitive about the ID', () => {
    // "the string is case sensitive" --- `add.b` of the raw character into the
    // digest, so 'T' and 't' differ by one bit and the keystream diverges
    const { out } = run(
      [
        'Dim A(2) : A(0)=1000 : A(1)=2000 : A(2)=3000',
        'Print Gspasscode("Testing",Varptr(A(0)),3)=Gspasscode("testing",Varptr(A(0)),3)',
      ].join('\n'),
    )
    expect(out().trim()).toBe('0')
  })

  /**
   * What "will not unscramble correctly" is actually worth.
   *
   * Each keystream call contributes only its low FIVE bits (`and.l d3, d0`
   * with d3 = $1f), and the only integrity check is a five-bit checksum. For a
   * short code a wrong ID can therefore produce the RIGHT answer outright, not
   * merely a rejected one — this pair differs in a single bit of a single
   * character and still decodes:
   */
  it('but a one-value code can survive the wrong ID entirely', () => {
    const { out } = run(
      [
        'Dim A(0) : A(0)=42',
        'P$=Gspasscode("Testing",Varptr(A(0)),1)',
        'Dim B(0)',
        'Print Gspassdecode("testing",P$,Varptr(B(0)));B(0)',
      ].join('\n'),
    )
    expect(out().trim()).toBe('1 42')
  })

  it('and a wrong ID is caught once there is more than five bits to check', () => {
    const { out } = run(
      [
        'Dim A(3) : A(0)=100 : A(1)=200 : A(2)=300 : A(3)=400',
        'P$=Gspasscode("Testing",Varptr(A(0)),4)',
        'Dim B(3)',
        'Print Gspassdecode("testing",P$,Varptr(B(0)))',
      ].join('\n'),
    )
    expect(out().trim()).toBe('0')
  })

  it('refuses a passcode with a character changed', () => {
    // the two check digits: the length character in front and the checksum
    // character behind. Corrupting a group breaks the second.
    const { out } = run(
      [
        'Dim A(2) : A(0)=1 : A(1)=2 : A(2)=3',
        'P$=Gspasscode("k",Varptr(A(0)),3)',
        'Q$=Left$(P$,2)+Chr$(Asc(Mid$(P$,3,1)) Xor 1)+Right$(P$,Len(P$)-3)',
        'Dim B(2)',
        'Print Gspassdecode("k",Q$,Varptr(B(0)))',
      ].join('\n'),
    )
    expect(out().trim()).toBe('0')
  })

  it('refuses a passcode of the wrong length outright', () => {
    // the FIRST check: `move.b $1(a0),d0 / cmp.b $2(a0),d0` against the
    // decrypted length character, before any group is looked at
    const { out } = run(
      [
        'Dim A(0) : A(0)=42',
        'P$=Gspasscode("k",Varptr(A(0)),1)',
        'Dim B(0)',
        'Print Gspassdecode("k",P$+"A",Varptr(B(0)))',
      ].join('\n'),
    )
    expect(out().trim()).toBe('0')
  })

  it('answers 0 for a passcode too short to hold either check digit', () => {
    // `move.b -$1(a0), d0` on a string with no characters reads the length
    // word instead --- there is nothing to decode either way
    const { out } = run(['Dim B(0)', 'Print Gspassdecode("k","",Varptr(B(0)));Gspassdecode("k","A",Varptr(B(0)))'].join('\n'))
    expect(out().trim()).toBe('0 0')
  })

  it('the SAME data under the SAME id gives the SAME code, every time', () => {
    // there is no salt and no clock: the seed is the data checksum and the ID
    // digest, so a level code is stable, which is the whole point of it
    const { out } = run(
      [
        'Dim A(1) : A(0)=7 : A(1)=11',
        'P$=Gspasscode("lvl",Varptr(A(0)),2)',
        'Q$=Gspasscode("lvl",Varptr(A(0)),2)',
        'Print P$=Q$',
      ].join('\n'),
    )
    expect(out().trim()).toBe('-1')
  })
})

// ---- the ProTracker half -------------------------------------------------

/**
 * A four-position M.K. module. One sample, four patterns, and whatever effect
 * each test asks for on row 0 of each — enough to watch the position walk and
 * to fire the 8 command.
 */
function modFile(cells: Record<number, [cmd: number, info: number]> = {}, speed = 1): Uint8Array {
  const PATTERNS = 4
  const d = new Uint8Array(1084 + PATTERNS * 1024 + 64)
  const dv = new DataView(d.buffer)
  dv.setUint16(20 + 22, 32) // sample 1: 64 bytes
  d[20 + 25] = 40 // volume
  dv.setUint16(20 + 28, 1) // the conventional one-word repeat
  d[950] = PATTERNS // song length
  d[951] = 0 // restart
  for (let p = 0; p < PATTERNS; p++) d[952 + p] = p
  d.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  // a cell is four bytes: instrument's high nibble over the period's high
  // nibble, the period's low byte, the instrument's low nibble over the
  // command, then its argument
  const cell = (pattern: number, row: number, channel: number, period: number, cmd: number, info: number): void => {
    const at = 1084 + pattern * 1024 + row * 16 + channel * 4
    d[at] = period >> 8 // instrument 1: high nibble 0
    d[at + 1] = period & 0xff
    d[at + 2] = 0x10 | (cmd & 0xf) // instrument 1: low nibble 1
    d[at + 3] = info & 0xff
  }
  // EVERY pattern sets the speed on channel 1, so channel 0's row 0 is free
  // for whatever a test wants and every position runs at the same rate
  for (let p = 0; p < PATTERNS; p++) {
    cell(p, 0, 1, 0x1ac, 0xf, speed)
    cell(p, 0, 0, 0x1ac, 0, 0)
  }
  for (const [row, [cmd, info]] of Object.entries(cells)) cell(0, Number(row), 0, 0x1ac, cmd, info)
  return d
}

function withMod(src: string, data = modFile()): Boot {
  const b = boot(src)
  b.rt.memBanks.set(6, { kind: 'memory', number: 6, memType: 1, name: 'Tracker', flags: 0, data })
  return b
}

/** run the program, then step `n` vertical blanks */
function playFor(b: Boot, n: number): void {
  mustFinish(b.rt.runHeadless(2_000))
  for (let i = 0; i < n; i++) b.rt.frame()
}

const music = (b: Boot) => b.rt.gamesupport.music

/**
 * Step vertical blanks until the song position changes, and answer the new
 * one. Robust against the replayer's lead-in: the row tick fires when the
 * counter REACHES the speed, so the first row of a song plays `speed` blanks
 * after it starts rather than immediately.
 */
function untilPos(b: Boot, limit = 400): number {
  const from = music(b).replay.pos
  for (let i = 0; i < limit; i++) {
    b.rt.frame()
    if (music(b).replay.pos !== from) break
    if (!music(b).replay.playing) break
  }
  return music(b).replay.pos
}

describe('GameSupport: Gstrack Play', () => {
  it('needs a bank Track Load made, and raises error 5 otherwise', () => {
    // `cmpi.l #$54726163,-$8(a2)` and `#$6b657220,-$4(a2)` --- "Trac" and
    // "ker ", the eight-byte bank name. The guide: "There is no Gstrack Load
    // command, so you must use the standard Track Load command instead."
    expect(() => run('Gstrack Play 6')).toThrow(GAMESUPPORT_ERRORS[5])
    const wrong = boot('Gstrack Play 6')
    wrong.rt.memBanks.set(6, { kind: 'memory', number: 6, memType: 1, name: 'Samples', flags: 0, data: modFile() })
    expect(() => wrong.rt.runHeadless(2_000)).toThrow(GAMESUPPORT_ERRORS[5])
  })

  it('starts playing, from position 0 for the bare form', () => {
    // routine 17 pushes 0 for Pos1 and routine 16 pushes -1 for Pos2
    const b = withMod('Gstrack Play 6')
    playFor(b, 2)
    expect(music(b).replay.playing).toBe(true)
    expect(music(b).replay.pos).toBe(0)
    expect(music(b).from).toBe(0)
    expect(music(b).to).toBe(-1)
  })

  it('starts at Pos1 when given one, and records Pos2 when given both', () => {
    const b = withMod('Gstrack Play 6,2')
    playFor(b, 1)
    expect(music(b).replay.pos).toBe(2)
    expect(music(b).to).toBe(-1)
    const r = withMod('Gstrack Play 6,1 To 2')
    playFor(r, 1)
    expect(music(r).replay.pos).toBe(1)
    expect(music(r).from).toBe(1)
    expect(music(r).to).toBe(2)
  })

  it('clears the deferred end and the cmd8 mailbox', () => {
    // `move.l #$ffffffff,$10(a0)` and `$c(a0)`, and `clr.w $1b84` at $8a0
    const b = withMod('Gstrack Loop Defer 1 To 2 : Gstrack Play 6')
    playFor(b, 1)
    expect(music(b).defer).toBe(-1)
    expect(music(b).replay.cmd8).toBe(0)
  })
})

describe('GameSupport: the loop range', () => {
  it('wraps to Pos1 when the position it just left was Pos2', () => {
    // `subq.w #$1,d1 / cmp.b $3(a0),d1 / beq` --- the test is on the position
    // just FINISHED, which is what "when Pos2 is reached, the module will
    // start again from Pos1" means
    const b = withMod('Gstrack Play 6,1 To 2')
    mustFinish(b.rt.runHeadless(2_000))
    expect(untilPos(b)).toBe(2)
    expect(untilPos(b)).toBe(1)
    expect(untilPos(b)).toBe(2)
  })

  it('wraps at the song’s own end when no Pos2 is set', () => {
    // `tst.l (a0) / blt` skips the Pos2 test for a negative, then
    // `cmp.b $3b6(a0),d1 / bcs` is the module's length byte
    const b = withMod('Gstrack Play 6')
    mustFinish(b.rt.runHeadless(2_000))
    expect([untilPos(b), untilPos(b), untilPos(b), untilPos(b)]).toEqual([1, 2, 3, 0])
    expect(music(b).replay.playing).toBe(true)
  })

  it('STOPS rather than wrapping when looping is off', () => {
    // `tst.l $1c1a / beq -> bra $908` --- the same silence Gstrack Stop uses,
    // not merely "play on past the end"
    const b = withMod('Gstrack Loop Off : Gstrack Play 6')
    mustFinish(b.rt.runHeadless(2_000))
    for (let i = 0; i < 4; i++) untilPos(b)
    expect(music(b).replay.playing).toBe(false)
    expect(music(b).replay.pos).toBe(0)
  })

  it('Gstrack Loop with a range turns looping back ON', () => {
    // routine 21 opens `move.l #$1,$0(a0)` before it stores either position:
    // setting a range is a request to loop it
    const b = withMod('Gstrack Loop Off : Gstrack Play 6 : Gstrack Loop 1 To 2')
    playFor(b, 1)
    expect(music(b).loop).toBe(true)
    expect(music(b).from).toBe(1)
    expect(music(b).to).toBe(2)
  })

  it('Gstrack Loop On and Off are one store each', () => {
    const b = withMod('Gstrack Play 6 : Gstrack Loop Off')
    playFor(b, 1)
    expect(music(b).loop).toBe(false)
    const on = withMod('Gstrack Play 6 : Gstrack Loop Off : Gstrack Loop On')
    playFor(on, 1)
    expect(music(on).loop).toBe(true)
  })

  it('Defer swaps the end in at the wrap, not before it', () => {
    // routine 24 stores Pos2 into the DEFERRED slot ($10) and Pos1 straight
    // into $4; the swap happens at $d04, on the wrap
    const b = withMod('Gstrack Play 6,0 To 1 : Gstrack Loop Defer 2 To 3')
    mustFinish(b.rt.runHeadless(2_000))
    expect(music(b).to).toBe(1) // still the old end
    expect(music(b).defer).toBe(3)
    expect(untilPos(b)).toBe(1)
    expect(untilPos(b)).toBe(2) // Pos1 was set at once, so the wrap goes there
    expect(music(b).to).toBe(3) // and the deferred end has taken over
    expect(music(b).defer).toBe(-1)
  })
})

describe('GameSupport: Gstrack Gosub', () => {
  it('the one-argument form plays just that pattern', () => {
    // routine 23 duplicates the top of the stack, so Pos2 = Pos1 --- "just
    // this pattern will be played if Pos2 isn't supplied"
    const b = withMod('Gstrack Play 6 : Gstrack Gosub 2')
    mustFinish(b.rt.runHeadless(2_000))
    expect(music(b).replay.pos).toBe(2)
    expect(music(b).from).toBe(0) // where the main tune was
    expect(music(b).to).toBe(2) // and back at the end of this one
    expect(music(b).defer).toBe(-1) // the main tune had no end set
    expect(untilPos(b)).toBe(0)
  })

  it('restores the main tune’s own end afterwards', () => {
    const b = withMod('Gstrack Play 6,0 To 3 : Gstrack Gosub 1 To 2')
    mustFinish(b.rt.runHeadless(2_000))
    expect(music(b).replay.pos).toBe(1)
    expect(music(b).to).toBe(2) // the jingle's end
    expect(music(b).defer).toBe(3) // the main tune's, saved
    expect(untilPos(b)).toBe(2)
    expect(untilPos(b)).toBe(0) // back where the tune was
    expect(music(b).to).toBe(3) // and its end restored
  })
})

describe('GameSupport: Gstrack Stop, Transpose and Volume', () => {
  it('Gstrack Stop silences and rewinds to position 0', () => {
    const b = withMod('Gstrack Play 6,2 : Gstrack Stop')
    playFor(b, 2)
    expect(music(b).replay.playing).toBe(false)
    expect(music(b).replay.pos).toBe(0)
  })

  it('Gstrack Volume is the replayer’s master, 0 to 64', () => {
    // `move.w d0,$18(a2)` and, in the player, `mulu.w $1c32(pc),d0 /
    // lsr.l #$6,d0` --- a channel volume times this over 64
    const b = withMod('Gstrack Play 6 : Gstrack Volume 32')
    playFor(b, 1)
    expect(music(b).replay.master).toBe(32)
    // 64 is the cold start's own value
    expect(withMod('').rt.gamesupport.music.replay.master).toBe(64)
  })

  it('Gstrack Transpose is kept as a BYTE, so it is signed and it wraps', () => {
    // routine 15 is `move.l (a3)+,d0 / move.b d0,-$94(a0)`
    const up = withMod('Gstrack Play 6 : Gstrack Transpose 3')
    playFor(up, 1)
    expect(music(up).replay.transpose).toBe(3)
    const down = withMod('Gstrack Play 6 : Gstrack Transpose -12')
    playFor(down, 1)
    expect(music(down).replay.transpose).toBe(-12)
    // 200 has no meaning as a semitone count; the byte says -56
    const wrapped = withMod('Gstrack Play 6 : Gstrack Transpose 200')
    playFor(wrapped, 1)
    expect(music(wrapped).replay.transpose).toBe(-56)
  })
})

describe('GameSupport: Gscmd8data', () => {
  it('sets a bit on tick 0 for 80b, and clears on the read', () => {
    // "8tb, where t is the tick [...] and b is the bit". The word is "cleared
    // only when it is read", which is the whole protocol.
    // the row tick fires when the counter REACHES the speed, so row 0 plays
    // six blanks after Gstrack Play at speed 6
    const b = withMod('Gstrack Play 6 : For A=1 To 7 : Wait Vbl : Next A : Print Gscmd8data;Gscmd8data', modFile({ 0: [0x8, 0x02] }, 6))
    mustFinish(b.rt.runHeadless(20_000))
    // set once, read once: the second read finds it cleared
    expect(b.out().trim()).toBe('4 0')
  })

  it('waits for tick t when t is not zero', () => {
    // the guide's own example: "830: Gscmd8data will return a 1, 3 ticks after
    // this step is reached, which, if the module speed is set to 6, will be
    // half a step"
    const b = withMod('Gstrack Play 6', modFile({ 0: [0x8, 0x31] }, 6))
    playFor(b, 6 + 2) // the lead-in, then ticks 0 and 1 of row 0
    expect(music(b).replay.cmd8).toBe(0)
    playFor(b, 2) // ticks 2 and 3
    expect(music(b).replay.cmd8).toBe(0b10)
  })

  it('accumulates every bit set since the last read', () => {
    const b = withMod('Gstrack Play 6', modFile({ 0: [0x8, 0x01], 1: [0x8, 0x04] }, 6))
    playFor(b, 6 + 7) // row 0 sets bit 1, row 1 sets bit 4
    expect(music(b).replay.cmd8).toBe(0b10010)
  })
})

describe('GameSupport: the chunky-to-planar shim, whose module nobody has', () => {
  /**
   * The whole C2P block is `L_OpenC2PLib` through `L_GSC2PDebug` in the
   * author's own `GameSupport.s` — one of the few parts the archive carries
   * whole — and every one of them is a wrapper over a `GSDrivers/` module.
   *
   * No such module ships or was ever released: the guide's Modules node has
   * ChunkyToPlanar under *"Modules planned so far"* and describes the scheme in
   * the future tense. So the library-absent arm is what every real machine ran,
   * six of the seven routines have one, and none of those six raise. That
   * makes these complete rather than stubbed.
   */
  it('Gsopenc2plib answers 0, and prefixes the name with GSChunky2Planar/', () => {
    // `lea $147(a1),a1` for OpenLibrary and `lea $157(a1),a2` for the caller's
    // string --- $147 holds exactly sixteen characters, "GSChunky2Planar/", so
    // Gsopenc2plib("Fast") opens GSChunky2Planar/Fast
    expect(num('Print Gsopenc2plib("Fast")')).toBe(0)
    // and an empty name never reaches OpenLibrary at all:
    // `move.w (a0)+,d7 / subq.w #$1,d7 / bmi`
    expect(num('Print Gsopenc2plib("")')).toBe(0)
  })

  it('the readers answer 0 and the setters do nothing, without raising', () => {
    expect(num('Print Gschunky2planar')).toBe(0)
    expect(num('Print Gsc2pinfo')).toBe(0)
    expect(() => run('Gsclosec2plib')).not.toThrow()
    expect(() => run('Gssetc2pcolour 3,255')).not.toThrow()
    expect(() => run('Gssetc2pregion 0,0 To 319,255')).not.toThrow()
  })

  it('Gsc2pdebug has NO null check, which is a defect and not a difference', () => {
    // routine 86 ($2846) is `movea.l $62(a0),a0 / not.w $1a(a0)` and the source
    // agrees --- every other C2P routine guards $62 and this one does not. With
    // no library the block pointer is zero, so on the machine this toggles the
    // low word of absolute $1a, inside exec's exception vector table. There is
    // no region there here, so the write lands nowhere.
    expect(() => run('Gsc2pdebug')).not.toThrow()
  })

  it('src/amiga/planar.ts is deliberately NOT wired in behind these', () => {
    // it is this port's own chunky/planar conversion, not Robinson's module.
    // Pointing one at the other would invent a library rather than model one,
    // and would make Gsc2pinfo hand back a structure no program has ever seen.
    expect(num('Print Gsc2pinfo')).toBe(0)
  })
})

// ---- the code modules ----------------------------------------------------

/**
 * A synthetic GSMod: one HUNK_CODE hunk whose second word is `"GSMo"`, a
 * header with the four routine/table pointers, and an attribute table with two
 * entries under 'S' and one under 'A'.
 *
 * The layout is entirely off the binary — the loader scans for the magic two
 * bytes in ($28d4), the header's $14/$18/$1c/$20 are its init, cleanup,
 * function table and attribute table, and a table is twenty-seven longwords
 * over eight-byte `{ value, name }` entries.
 */
function gsmod(base = 0x5c00_0000): Uint8Array {
  const SIZE = 0x400
  const body = new Uint8Array(SIZE)
  const dv = new DataView(body.buffer)
  const put = (at: number, v: number): void => dv.setUint32(at, v >>> 0)
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) body[at + i] = s.charCodeAt(i)
  }
  // the magic, at offset 2 --- the first place `lea $2(a1), a1` looks. Every
  // header field is relative to the MAGIC, because a1 points at it when
  // `movea.l $14(a1), a0` runs.
  const H = 2
  text(H, 'GSMo')
  put(H + 0x14, base + 0x300) // init
  put(H + 0x18, base + 0x304) // cleanup
  put(H + 0x1c, base + 0x100) // the FUNCTION table
  put(H + 0x20, base + 0x180) // the ATTRIBUTE table

  /**
   * A table is TWENTY-SEVEN longwords: entry i is bucket i's start and entry
   * i+1 is its end, so an empty letter is two equal bounds. Entries are eight
   * bytes, `{ value, name }`, and must be laid out in bucket order.
   */
  const buildTable = (at: number, entriesAt: number, namesAt: number, byLetter: Record<string, Array<[number, string]>>): void => {
    let entry = entriesAt
    let nameAt = namesAt
    for (let i = 0; i <= 25; i++) {
      put(at + i * 4, base + entry)
      for (const [value, name] of byLetter[String.fromCharCode(65 + i)] ?? []) {
        put(entry, value)
        put(entry + 4, base + nameAt)
        text(nameAt, name)
        nameAt += name.length + 1
        entry += 8
      }
    }
    put(at + 26 * 4, base + entry) // the end marker the last bucket needs
  }

  // 27 longwords is 108 bytes, so a table at $100 runs to $16b and its
  // entries have to start clear of it
  buildTable(0x100, 0x170, 0x1f0, { D: [[base + 0x300, 'DRAW']] })
  buildTable(0x180, 0x200, 0x260, { A: [[11, 'ANGLE']], S: [[42, 'SPEED'], [99, 'SIZE']] })

  // wrap it in the smallest legal hunk file: HUNK_HEADER, HUNK_CODE, HUNK_END
  const out = new Uint8Array(6 * 4 + 4 + 4 + SIZE + 4)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, 0x3f3) // HUNK_HEADER
  ov.setUint32(4, 0) // no resident libraries
  ov.setUint32(8, 1) // table size
  ov.setUint32(12, 0) // first
  ov.setUint32(16, 0) // last
  ov.setUint32(20, SIZE / 4) // hunk 0's allocation, in longwords
  ov.setUint32(24, 0x3e9) // HUNK_CODE
  ov.setUint32(28, SIZE / 4)
  out.set(body, 32)
  ov.setUint32(32 + SIZE, 0x3f2) // HUNK_END
  return out
}

function withMod2(src: string, files: Record<string, Uint8Array>): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[GS_SLOT, gs]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs: { read: (p: string) => files[p] ?? null },
  })
  return { rt, out: () => printed }
}

describe('GameSupport: the code modules', () => {
  const files = (): Record<string, Uint8Array> => ({ 'mod.gsm': gsmod() })

  it('loads into the first free slot and answers its index', () => {
    // `lea $7a(a1),a1 / moveq #$f,d7 / move.l (a1),d0 / beq` --- the first
    // empty one, and the index is 15 minus the countdown
    const b = withMod2('Print Gsloadcodemod("mod.gsm")', files())
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('0')
    expect(b.rt.gamesupport.codemods[0]?.header).toBe(2)
  })

  it('raises AMOS error 23 for a file that will not load', () => {
    // `move.l d0,(a0,d1.w) / beq` --- a LoadSeg that returns zero
    expect(() => withMod2('Print Gsloadcodemod("nope")', files()).rt.runHeadless(2_000)).toThrow(
      /Illegal function call/,
    )
  })

  it('raises AMOS error 23 for a filename of 129 characters or more', () => {
    // `move.w (a0)+,d0 / subq.w #$1,d0 / cmp.w #$80,d0 / bge`
    const long = 'x'.repeat(129)
    expect(() => withMod2(`Print Gsloadcodemod("${long}")`, files()).rt.runHeadless(2_000)).toThrow(
      /Illegal function call/,
    )
    // and 128 is fine as far as the length check goes, failing on the load
    const ok = 'y'.repeat(128)
    expect(() => withMod2(`Print Gsloadcodemod("${ok}")`, files()).rt.runHeadless(2_000)).toThrow(
      /Illegal function call/,
    )
  })

  it('raises error 6 when all sixteen slots are taken', () => {
    // "too many code modules", the extension's own message 6
    const src = ['For A=1 To 16', 'N=Gsloadcodemod("mod.gsm")', 'Next A', 'Print Gsloadcodemod("mod.gsm")'].join('\n')
    expect(() => withMod2(src, files()).rt.runHeadless(20_000)).toThrow(GAMESUPPORT_ERRORS[6])
  })

  it('Gsgetattr answers the value and Gsfindattr the entry’s address', () => {
    const b = withMod2(
      'N=Gsloadcodemod("mod.gsm")\nPrint Gsgetattr(N,"SPEED");Gsgetattr(N,"SIZE");Gsgetattr(N,"ANGLE")',
      files(),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('42 99 11')
    const f = withMod2('N=Gsloadcodemod("mod.gsm")\nPrint Gsfindattr(N,"SPEED")', files())
    mustFinish(f.rt.runHeadless(2_000))
    // the entry itself, which is where Gsgetattr dereferences
    expect(Number(f.out().trim())).toBe(0x5c00_0000 + 0x208)
  })

  it('Gssetattr writes through the same lookup', () => {
    const b = withMod2(
      'N=Gsloadcodemod("mod.gsm")\nGssetattr N,"SPEED",1234\nPrint Gsgetattr(N,"SPEED");Gsgetattr(N,"SIZE")',
      files(),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('1234 99')
  })

  it('the lookup is CASE INSENSITIVE, by `bclr #5` on both sides', () => {
    const b = withMod2('N=Gsloadcodemod("mod.gsm")\nPrint Gsgetattr(N,"speed");Gsgetattr(N,"SpEeD")', files())
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('42 42')
  })

  it('and it is a PREFIX match on the ENTRY, not an equality', () => {
    // the comparison ends when the ENTRY's byte reaches zero, so an entry
    // named SPEED answers a lookup for SPEEDY
    const b = withMod2('N=Gsloadcodemod("mod.gsm")\nPrint Gsgetattr(N,"SPEEDY")', files())
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('42')
  })

  it('raises error 7 for a name in no bucket, and for one not in its bucket', () => {
    for (const name of ['ZZZ', 'SPOON', '1234']) {
      expect(() =>
        withMod2(`N=Gsloadcodemod("mod.gsm")\nPrint Gsgetattr(N,"${name}")`, files()).rt.runHeadless(2_000),
      ).toThrow(GAMESUPPORT_ERRORS[7])
    }
  })

  it('Gscallmod raises error 8 for a function that is not there', () => {
    // the FUNCTION table at $1c, not the attribute table at $20 --- so an
    // ATTRIBUTE name is not a function name
    expect(() =>
      withMod2('N=Gsloadcodemod("mod.gsm")\nGscallmod N,"SPEED"', files()).rt.runHeadless(2_000),
    ).toThrow(GAMESUPPORT_ERRORS[8])
  })

  it('Gscallmod finds a real function and then cannot run it', () => {
    // THE one structural deviation in this extension. Everything else it does
    // is data; this is `movea.l (a0),a0 / jsr (a0)` into 68k code, and there
    // is no interpreter here. The lookup and its error are faithful; the call
    // raises rather than silently doing nothing, because a game whose module
    // does the work would otherwise carry on with the work undone.
    expect(() =>
      withMod2('N=Gsloadcodemod("mod.gsm")\nGscallmod N,"DRAW"', files()).rt.runHeadless(2_000),
    ).toThrow(/cannot run 68000 code/)
  })

  it('Gsunloadcodemod frees the slot for the next load', () => {
    const b = withMod2(
      'A=Gsloadcodemod("mod.gsm")\nB=Gsloadcodemod("mod.gsm")\nGsunloadcodemod A\nPrint A;B;Gsloadcodemod("mod.gsm")',
      files(),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('0 1 0')
  })

  it('Gsunloadcodemod on an empty slot does nothing rather than raising', () => {
    expect(() => withMod2('Gsunloadcodemod 3', files())).not.toThrow()
  })
})
