/**
 * AMon 1.04 and 1.03, against the two `AmosPro_Amon.lib` files — `extdis
 * amon-1.04` and `extdis amon-1.03` — and against the twelve example
 * programs the author shipped in `examples_asc/`.
 *
 * The examples are load-bearing here. AMon's documents are an install note
 * and a copyright page and describe no keyword at all, so every argument
 * ORDER below was settled by reading the routine and then checking it against
 * a line the author wrote: `Test Add Varptr(TEST(0)),Varptr(A(0)),TEST,-1,11`,
 * `Fast Joy1 _ADRX,1,_ADRY,1`, `Fast Circle 160,100,K,3`, `Count
 * Colour(30,12 To 77,199,3)`. A suite written from the disassembly alone
 * would have had the five-argument keywords right by luck or not at all.
 *
 * Two tests are the RELEASES disagreeing, and they are the reason this file
 * boots both identities: 1.03 ships its rodent limits as four zeros where
 * 1.04 ships 120..440 and 38..238, and 1.03's Fast Circle raises AMOS error
 * 23 for a negative colour where 1.04's raises 149.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { keyboardSdr } from '../amiga/keyboard'
import { DIR_LEFT, DIR_RIGHT, DIR_UP } from '../amiga/controller'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 25 — routine 0's `moveq #$18,d0`, and `$278(a5)` is `$f8 + 24*16` */
const amon = extensionById('amon-1.04')!
/** slot 16 — `moveq #$f,d0` and `$1e8(a5)`, one past the slot its own note asks for */
const amon103 = extensionById('amon-1.03')!

type Prep = (rt: Runtime) => void

function boot(src: string, prep?: Prep, ext = amon, slot = 25): { rt: Runtime; out: () => string } {
  let out = ''
  const exts = new Map([[slot, ext.table]])
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[slot, ext]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  prep?.(rt)
  return { rt, out: () => out }
}

function run(src: string, prep?: Prep, ext = amon, slot = 25): Runtime {
  const b = boot(src, prep, ext, slot)
  mustFinish(b.rt.runHeadless(2_000))
  return b.rt
}

/** run a program, then print an expression */
function val(expr: string, setup = '', prep?: Prep, ext = amon, slot = 25): string {
  const b = boot(`${setup === '' ? '' : `${setup}\n`}Print ${expr}`, prep, ext, slot)
  mustFinish(b.rt.runHeadless(2_000))
  return b.out().trim()
}

/** the pixel under a point of the current screen, which is where all four graphics keywords write */
const px = (rt: Runtime, x: number, y: number): number => rt.screen.rp.point(x, y)

describe('AMon: the rodent, read off JOY0DAT rather than through input.device', () => {
  /*
   * Routines 2 and 3 read `$dff00b` and `$dff00a` — JOY0DAT's low and high
   * bytes — difference each against the byte before, add that to the stored
   * position and clamp. The position only moves when the keyword is called.
   */
  it('starts clamped to the limits 1.04 ships in its zone', () => {
    // the zone's first four words are $78, $1b8, $26, $ee; the position
    // starts at 0,0, which is below both minima
    expect(val('Rodent X')).toBe('120')
    expect(val('Rodent Y')).toBe('38')
  })

  it('tracks the counter delta between calls', () => {
    // the mouse boots at 128+160 across, so the counter byte is 288 & $ff = 32
    // and the first read moves the position 32 from zero, still under the
    // minimum; nudging the mouse 20 further puts it 20 past it
    const b = boot('A=Rodent X : X Mouse=308 : B=Rodent X : Print A;",";B')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().replace(/\s+/g, '')).toBe('120,140')
  })

  it('folds the counter at 127 and not at 128, which is AMon and not the usual unwrap', () => {
    /*
     * `cmp.w #$7f,d0 / blt` wraps at 127 where ../amiga/gameport.ts's
     * counterDelta wraps at 128. A first delta of exactly 127 is therefore
     * -129 here and +127 there, and the two land on different sides of the
     * minimum: 120 against 127.
     */
    expect(val('Rodent X', '', (rt) => (rt.input.mouseX = 383))).toBe('120')
  })

  it('Limit Rodent sets all four bounds and Set Rodent moves without clamping', () => {
    /*
     * The counter delta of the first read is added to whatever Set Rodent
     * left: the mouse boots with a counter byte of 32 across and 150 down,
     * and 150 folds to -106. So the answers are 200+32 and 100-106 clamped
     * up to the floor of 0 — the position Set Rodent asked for is not what
     * the next read gives, and that is the routine.
     */
    expect(val('Rodent X', 'Limit Rodent 0,0 To 320,200 : Set Rodent 200,100')).toBe('232')
    expect(val('Rodent Y', 'Limit Rodent 0,0 To 320,200 : Set Rodent 200,100')).toBe('0')
    // and the clamp is the limits, applied on the read
    expect(val('Rodent X', 'Limit Rodent 10,10 To 20,20 : Set Rodent 200,100')).toBe('20')
  })

  it('1.03 ships four zeros instead, so the rodent cannot move until Limit Rodent', () => {
    expect(val('Rodent X', '', undefined, amon103, 16)).toBe('0')
    expect(val('Rodent Y', '', undefined, amon103, 16)).toBe('0')
    // and it works normally the moment the program says where it may go
    expect(val('Rodent X', 'Limit Rodent 0,0 To 320,200 : Set Rodent 55,5', undefined, amon103, 16)).toBe('87')
  })

  it('Lrodent, Rrodent and Rodent Key read the two button lines', () => {
    const press = (bits: number): Prep => (rt) => (rt.input.mouseK = bits)
    // `btst.b #$6,$bfe001` and `btst.b #$a,$dff016`, both active low, both -1
    expect(val('Lrodent', '', press(1))).toBe('-1')
    expect(val('Lrodent', '', press(2))).toBe('0')
    expect(val('Rrodent', '', press(2))).toBe('-1')
    expect(val('Rrodent', '', press(1))).toBe('0')
    // routine 8 adds them as 1 and 2 rather than answering -1
    expect(val('Rodent Key', '', press(0))).toBe('0')
    expect(val('Rodent Key', '', press(1))).toBe('1')
    expect(val('Rodent Key', '', press(2))).toBe('2')
    expect(val('Rodent Key', '', press(3))).toBe('3')
  })
})

describe('AMon: Video Wait', () => {
  it('takes 0 to 312 and raises AMOS error 48 outside it', () => {
    // `cmp.l #$139,d0 / Rbcc routine 51`, and $139 is 313
    expect(() => run('Video Wait 312')).not.toThrow()
    expect(() => run('Video Wait 313')).toThrow(/screen parameter/i)
    expect(() => run('Video Wait -1')).toThrow(/screen parameter/i)
  })
})

describe('AMon: the keyboard, read off CIA-A rather than through AMOS', () => {
  const clocked = (scan: number, down: boolean): Prep => (rt) => (rt.input.sdr = keyboardSdr(scan, down))

  it('Keycode answers the scancode of a key going DOWN and 0 for a release', () => {
    // `btst.b #$0` of the raw byte is the release flag complemented, so the
    // `not.b / ror.b #1` only ever runs on a press
    expect(val('Keycode', '', clocked(0x40, true))).toBe('64')
    expect(val('Keycode', '', clocked(0x40, false))).toBe('0')
    // an idle machine has clocked nothing at all
    expect(val('Keycode')).toBe('0')
  })

  it('Key Press compares the decoded byte and rejects a code of $80 or more', () => {
    expect(val('Key Press(64)', '', clocked(0x40, true))).toBe('-1')
    expect(val('Key Press(65)', '', clocked(0x40, true))).toBe('0')
    // the release decodes to $c0, which no legal argument can equal
    expect(val('Key Press(64)', '', clocked(0x40, false))).toBe('0')
    expect(() => run('A=Key Press(128)')).toThrow(/bad parameter/i)
    expect(() => run('A=Key Press(-1)')).toThrow(/bad parameter/i)
  })
})

describe('AMon: the joysticks', () => {
  /*
   * Fast Joy takes its two variables BY ADDRESS, which is the author's own
   * spelling: `_ADRX=Varptr(X) : Fast Joy1 _ADRX,1,_ADRY,1`.
   */
  const stick = (dirs: number): Prep => (rt) => (rt.input.ports[1].dirs = dirs)

  const moved = (dirs: number): string => {
    const b = boot('X=100 : Y=100 : AX=Varptr(X) : AY=Varptr(Y) : Fast Joy1 AX,3,AY,7 : Print X;",";Y', stick(dirs))
    mustFinish(b.rt.runHeadless(2_000))
    return b.out().trim().replace(/\s+/g, '')
  }

  it('Fast Joy1 adds the step to the variable the address points at', () => {
    expect(moved(DIR_RIGHT)).toBe('103,100')
    expect(moved(DIR_LEFT)).toBe('97,100')
    // up is bit8 ^ bit9 and left is bit 9; a diagonal moves both
    expect(moved(DIR_UP | DIR_LEFT)).toBe('97,93')
    expect(moved(0)).toBe('100,100')
  })

  it('Fast Joy0 reads the OTHER register, which is the mouse port', () => {
    /*
     * `move.w $dff00a` against routine 13's `$dff00c`. A MOUSE is on this
     * port, and its quadrature bits are the low two of each counter byte, so
     * where a program reads a direction depends on where the mouse is
     * standing — parked on a pair of even counts every one of the four tests
     * reads zero, and a stick in the joystick port cannot reach it at all.
     */
    const park: Prep = (rt) => {
      rt.input.mouseX = 0
      rt.input.mouseY = 0
    }
    const src = 'X=0 : Y=0 : AX=Varptr(X) : AY=Varptr(Y) : Fast Joy0 AX,1,AY,1'
    expect(val('X', src, park)).toBe('0')
    expect(
      val('X', src, (rt) => {
        park(rt)
        rt.input.ports[1].dirs = DIR_RIGHT
      }),
    ).toBe('0')
    // put the mouse where its own counters spell "right" and it does move
    expect(val('X', src, (rt) => ((rt.input.mouseX = 2), (rt.input.mouseY = 0)))).toBe('1')
  })

  it('Joy3 and Joy4 answer 0, which is what a machine with no adapter answers', () => {
    // CIA-B PRA and CIA-A PRB, every line idling high
    expect(val('Joy3')).toBe('0')
    expect(val('Joy4')).toBe('0')
  })
})

describe('AMon: the fixed-point trigonometry', () => {
  /*
   * `divu.w #$5a` splits the angle; sin mirrors the offset on ODD quadrants
   * and cos on EVEN ones; the product's high word is taken with a round-to-
   * nearest on the bit below it.
   */
  it('Mul Sin and Mul Cos walk the four quadrants', () => {
    expect(val('Mul Sin(0,64)')).toBe('0')
    expect(val('Mul Sin(30,64)')).toBe('32')
    expect(val('Mul Sin(90,64)')).toBe('64')
    expect(val('Mul Sin(180,64)')).toBe('0')
    expect(val('Mul Sin(270,64)')).toBe('-64')
    expect(val('Mul Cos(0,64)')).toBe('64')
    expect(val('Mul Cos(90,64)')).toBe('0')
    expect(val('Mul Cos(180,64)')).toBe('-64')
    expect(val('Mul Cos(270,64)')).toBe('0')
  })

  it('the sign of the value comes off before the multiply and goes back on after', () => {
    expect(val('Mul Sin(30,-64)')).toBe('-32')
    expect(val('Mul Cos(180,-64)')).toBe('64')
  })

  it('the table is not sin(x)*value rounded — 30 degrees is the one entry that says so', () => {
    /*
     * The shipped word at 30 degrees is 32768, the exact rounding of
     * 32767.5, where `Math.round(Math.sin(Math.PI / 6) * 65535)` gives 32767
     * — `Math.sin(Math.PI / 6)` is 0.49999999999999994. Multiply by 32767 and
     * the one-bit difference in the table becomes a whole unit in the answer,
     * so this is the assertion that would fail if the table were computed.
     */
    expect(val('Mul Sin(30,32767)')).toBe('16384')
  })

  it('the value is a WORD, so 65535 is minus one', () => {
    // `move.w d3,d0 / bpl / neg.w d3` takes the sign off the low word only
    expect(val('Mul Sin(30,65535)')).toBe('-1')
  })

  it('quadrants above the first three keep working, because the divide is unbounded', () => {
    expect(val('Mul Sin(390,64)')).toBe(val('Mul Sin(30,64)'))
    expect(val('Mul Cos(450,64)')).toBe(val('Mul Cos(90,64)'))
  })
})

describe('AMon: Fast Angle', () => {
  /*
   * A compass bearing from the SECOND point to the first, clockwise from
   * straight up, 576 units to the circle and 1-based. The three folding
   * constants are the author's and two of them are two short, which is why
   * the diagonal below is 503 and not 505.
   */
  it('puts the four cardinals where 576 units to the circle puts them', () => {
    expect(val('Fast Angle(0,0 To 0,10,0)')).toBe('1') // first point above the second
    expect(val('Fast Angle(10,0 To 0,0,0)')).toBe('145') // to its right, a quarter turn
    expect(val('Fast Angle(0,10 To 0,0,0)')).toBe('289') // below it, half
    expect(val('Fast Angle(0,0 To 10,0,0)')).toBe('432') // to its left, three quarters
  })

  it('the up-left diagonal lands two short of the arithmetic, and that is the binary', () => {
    // `neg / addi.w #$23e` is 574 where three quarters of 576 is 576-2
    expect(val('Fast Angle(0,0 To 10,10,0)')).toBe('503')
  })

  it('the resolution argument is a right shift, so r gives 576>>r steps', () => {
    // 144 >> 4 is 9, plus the 1
    expect(val('Fast Angle(10,0 To 0,0,4)')).toBe('10')
    expect(val('Fast Angle(10,0 To 0,0,7)')).toBe('2')
  })

  it('halves both deltas until each is inside the table, so scale does not matter', () => {
    expect(val('Fast Angle(1000,0 To 0,0,0)')).toBe('145')
    expect(val('Fast Angle(400,400 To 0,0,0)')).toBe(val('Fast Angle(4,4 To 0,0,0)'))
  })

  it('the three-argument form takes the other point from the RODENT position', () => {
    // routine 11 reads zone+$9cc and +$9ce directly, so it is the position as
    // the last Rodent X left it and not a fresh look at the hardware
    expect(val('Fast Angle(100,110,0)', 'Limit Rodent 0,0 To 320,200 : Set Rodent 100,100')).toBe('1')
    expect(val('Fast Angle(90,100,0)', 'Limit Rodent 0,0 To 320,200 : Set Rodent 100,100')).toBe('145')
  })
})

describe('AMon: the graphics primitives, straight into the bitplanes', () => {
  /*
   * All four reach the screen through `$52c(a5)` and write the planes
   * themselves — no clip region, no draw mode, no write mask. An out-of-range
   * coordinate draws nothing and is not an error; a negative colour is.
   */
  it('Fast Plot and Fast Point are each other', () => {
    const rt = run('Fast Plot 10,20,3')
    expect(px(rt, 10, 20)).toBe(3)
    expect(val('Fast Point(10,20)', 'Fast Plot 10,20,3')).toBe('3')
  })

  it('an out-of-range coordinate is silent and a negative colour is AMOS error 23', () => {
    expect(() => run('Fast Plot 10,-1,3')).not.toThrow()
    expect(() => run('Fast Plot -1,10,3')).not.toThrow()
    expect(() => run('Fast Plot 10,1000,3')).not.toThrow()
    expect(() => run('Fast Plot 10,10,-1')).toThrow(/function call/i)
    // Fast Point answers 0 out of range — see amon.ts for the two defects on
    // that path, neither of which is reproduced
    expect(val('Fast Point(-1,10)')).toBe('0')
    expect(val('Fast Point(10,-1)')).toBe('0')
  })

  it('Fast Circle plots eight octants a step, and its argument order is the example\'s', () => {
    // `Fast Circle 160,100,K,3` — centre, radius, colour
    const rt = run('Fast Circle 100,100,5,3')
    for (const [x, y] of [
      [105, 100],
      [95, 100],
      [100, 105],
      [100, 95],
    ]) {
      expect(px(rt, x!, y!), `${x},${y}`).toBe(3)
    }
    expect(px(rt, 100, 100)).not.toBe(3) // hollow
  })

  it('a negative radius draws nothing, and the negative-colour error is the RELEASE talking', () => {
    expect(() => run('Fast Circle 100,100,-1,3')).not.toThrow()
    // 1.04 checks the colour itself, `Rbmi routine 53`, which is error 149
    expect(() => run('Fast Circle 100,100,5,-1')).toThrow(/bad parameter/i)
    // 1.03 has no check of its own and lets its Fast Plot raise 23
    expect(() => run('Fast Circle 100,100,5,-1', undefined, amon103, 16)).toThrow(/function call/i)
  })

  it('Array Plot walks three arrays, COUNT+1 points, the way the example calls it', () => {
    const rt = run(
      [
        'Dim X(3),Y(3),C(3)',
        'For K=0 To 3',
        '  X(K)=10+K : Y(K)=20 : C(K)=K+1',
        'Next K',
        'Array Plot Varptr(X(0)),Varptr(Y(0)),Varptr(C(0)),3',
      ].join('\n'),
    )
    for (let k = 0; k <= 3; k++) expect(px(rt, 10 + k, 20), `point ${k}`).toBe(k + 1)
  })

  it('and takes a LITERAL colour when the third argument is $1000 or below', () => {
    // `cmpa.l #$1000,a4 / ble` — a Varptr is always above it, a colour never is
    const rt = run(
      ['Dim X(2),Y(2)', 'For K=0 To 2', '  X(K)=30+K : Y(K)=40', 'Next K', 'Array Plot Varptr(X(0)),Varptr(Y(0)),5,2'].join(
        '\n',
      ),
    )
    for (let k = 0; k <= 2; k++) expect(px(rt, 30 + k, 40)).toBe(5)
  })
})

describe('AMon: the three array keywords', () => {
  it('Test Add adds to the destination wherever the source matches', () => {
    // the author's own call: Test Add Varptr(TEST(0)),Varptr(A(0)),TEST,-1,11
    const b = boot(
      [
        'Dim T(4),A(4)',
        'For K=0 To 4',
        '  T(K)=K Mod 2 : A(K)=0',
        'Next K',
        'Test Add Varptr(T(0)),Varptr(A(0)),1,-7,4',
        'For K=0 To 4',
        '  Print A(K);" ";',
        'Next K',
      ].join('\n'),
    )
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/)).toEqual(['0', '-7', '0', '-7', '0'])
  })

  it('Count Colour counts the pixels of a colour on a line, endpoint excluded', () => {
    const setup = 'Fast Plot 5,0,3 : Fast Plot 6,0,3 : Fast Plot 10,0,3'
    // the walk samples x=0..9, so the pixel AT the endpoint is not counted
    expect(val('Count Colour(0,0 To 10,0,3)', setup)).toBe('2')
    expect(val('Count Colour(0,0 To 11,0,3)', setup)).toBe('3')
    // a zero-length line returns before the walk begins
    expect(val('Count Colour(5,0 To 5,0,3)', setup)).toBe('0')
  })

  it('Find Colour answers how many steps along the line the first one is, 1-based', () => {
    const setup = 'Fast Plot 5,0,3 : Fast Plot 6,0,3'
    expect(val('Find Colour(0,0 To 10,0,3)', setup)).toBe('6')
    expect(val('Find Colour(0,0 To 10,0,7)', setup)).toBe('0')
    // the start pixel itself is step 1
    expect(val('Find Colour(5,0 To 10,0,3)', setup)).toBe('1')
  })

  it('both walk diagonals with the same Bresenham the binary spells out twice', () => {
    const setup = 'Fast Plot 3,3,4 : Fast Plot 4,4,4'
    expect(val('Count Colour(0,0 To 8,8,4)', setup)).toBe('2')
    expect(val('Find Colour(0,0 To 8,8,4)', setup)).toBe('4')
  })
})
