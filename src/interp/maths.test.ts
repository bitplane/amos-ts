import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, {
    maxSteps: 200_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return out
}

/** AMOS truth is -1; every assertion below is written as an in-language test. */
const isTrue = (expr: string, prelude = ''): boolean =>
  run(`${prelude}Print ${expr}`).trim() === '-1'

describe('angle mode (InRadian/InDegree +Lib.s:1913-1922)', () => {
  it('starts in radians — InRadian clears Angle(a5), and the variable area starts zeroed', () => {
    // Cos(Pi) is -1 only if the argument is being read as radians.
    expect(isTrue('Abs(Cos(Pi#)+1)<0.0001')).toBe(true)
    // 180 radians is nowhere near a half turn: cos(180 rad) is -0.5985
    expect(isTrue('Abs(Cos(180)+0.5984601)<0.0001')).toBe(true)
  })

  it('Degree then Radian switch the mode back and forth (Angle(a5) = -1 / 0)', () => {
    expect(isTrue('Abs(Cos(180)+1)<0.0001', 'Degree : ')).toBe(true)
    expect(isTrue('Abs(Cos(Pi#)+1)<0.0001', 'Degree : Radian : ')).toBe(true)
  })

  it('applies the mode to inverse functions in reverse (results converted out)', () => {
    // Acos(-1) is a half turn: Pi radians, or 180 degrees
    expect(isTrue('Abs(Acos(-1)-Pi#)<0.0001')).toBe(true)
    expect(isTrue('Abs(Acos(-1)-180)<0.001', 'Degree : ')).toBe(true)
    expect(isTrue('Abs(Asin(1)-90)<0.001', 'Degree : ')).toBe(true)
    expect(isTrue('Abs(Atan(1)-45)<0.001', 'Degree : ')).toBe(true)
  })
})

describe('transcendental functions', () => {
  it('Cos/Tan agree with their defining identities', () => {
    expect(isTrue('Abs(Cos(0)-1)<0.0001')).toBe(true)
    expect(isTrue('Abs(Tan(0))<0.0001')).toBe(true)
    // tan = sin/cos
    expect(isTrue('Abs(Tan(0.7)-Sin(0.7)/Cos(0.7))<0.0001')).toBe(true)
    // Pythagorean identity holds across the circle
    expect(isTrue('Abs(Sin(1.1)*Sin(1.1)+Cos(1.1)*Cos(1.1)-1)<0.0001')).toBe(true)
  })

  it('Exp inverts Log, and Exp(0) is 1', () => {
    expect(isTrue('Abs(Exp(0)-1)<0.0001')).toBe(true)
    expect(isTrue('Abs(Exp(1)-2.718282)<0.0001')).toBe(true)
    // Ln is the natural log; AMOS's Log is base 10, so it is Ln that inverts Exp
    expect(isTrue('Abs(Ln(Exp(2.5))-2.5)<0.0001')).toBe(true)
    expect(isTrue('Abs(Log(100)-2)<0.0001')).toBe(true)
  })

  it('Hcos/Htan satisfy the hyperbolic identities', () => {
    // cosh^2 - sinh^2 = 1
    expect(isTrue('Abs(Hcos(1.3)*Hcos(1.3)-Hsin(1.3)*Hsin(1.3)-1)<0.0001')).toBe(true)
    // tanh = sinh/cosh, and tanh is bounded by 1
    expect(isTrue('Abs(Htan(0.8)-Hsin(0.8)/Hcos(0.8))<0.0001')).toBe(true)
    // tanh is bounded by 1 (at 50 it is already 1 to FFP precision, so test lower)
    expect(isTrue('Htan(2)<1')).toBe(true)
    expect(isTrue('Abs(Htan(2)-0.9640276)<0.0001')).toBe(true)
    expect(isTrue('Abs(Hcos(0)-1)<0.0001')).toBe(true)
  })

  it('the inverse functions round-trip their forward counterparts', () => {
    expect(isTrue('Abs(Acos(Cos(0.9))-0.9)<0.0001')).toBe(true)
    expect(isTrue('Abs(Asin(Sin(0.6))-0.6)<0.0001')).toBe(true)
    expect(isTrue('Abs(Atan(Tan(0.4))-0.4)<0.0001')).toBe(true)
  })
})

describe('Not (FnNot +ILib.s — fresh New_Evalue, bitwise complement)', () => {
  it('complements every bit rather than mapping to 0/1', () => {
    // AMOS truth is -1 (all bits set), so Not of false is true and vice versa
    expect(run('Print Not 0')).toBe('-1\n')
    expect(run('Print Not -1')).toBe(' 0\n')
    // it is bitwise, not logical: ~5 = -6
    expect(run('Print Not 5')).toBe('-6\n')
    expect(run('Print Not 1')).toBe('-2\n')
  })

  /**
   * And it cannot be written with brackets. `Ope_Not` (+Verif.s:2881) starts a
   * FRESH evaluation, `Parenth` and all, and an evaluation that ends on a `)`
   * consumes it (`Eva_Fin`, :2547). So an inner `Not(...)` eats the bracket
   * belonging to whatever it was nested in and leaves the count at -1, which
   * is the `tst.w Parenth(a5) / bne VerSynt` two instructions later. `Not`
   * really does consume the rest.
   */
  it('is its own inverse', () => {
    expect(isTrue('A=12345', 'A=Not Not 12345 : ')).toBe(true)
    expect(() => run('Print Not(Not(12345))')).toThrow(/Syntax error/)
  })

  it('converts a float operand before complementing', () => {
    expect(run('Print Not 5.7')).toBe('-6\n')
  })
})

describe('bit rotation and clearing', () => {
  it('Rol.w/Ror.w rotate within 16 bits, wrapping through the ends', () => {
    // a bit rotated out of the top re-enters at the bottom
    expect(run('A=$8000 : Rol.w 1,A : Print A')).toBe(' 1\n')
    expect(run('A=1 : Ror.w 1,A : Print A')).toBe(' 32768\n')
    // rotating by the full width is the identity
    expect(run('A=$1234 : Rol.w 16,A : Print A')).toBe(' 4660\n')
    // and the word forms must not disturb anything above bit 15
    expect(run('A=1 : Ror.w 1,A : Print A>0')).toBe('-1\n')
  })

  it('Ror.l rotates within 32 bits', () => {
    expect(run('A=1 : Ror.l 1,A : Print A')).toBe('-2147483648\n')
    expect(run('A=1 : Ror.l 32,A : Print A')).toBe(' 1\n')
  })

  it('Bclr clears one bit and leaves the rest alone', () => {
    expect(run('A=3 : Bclr 0,A : Print A')).toBe(' 2\n')
    expect(run('A=3 : Bclr 1,A : Print A')).toBe(' 1\n')
    // clearing a bit that is already clear is a no-op
    expect(run('A=4 : Bclr 1,A : Print A')).toBe(' 4\n')
    // Bset then Bclr returns the original value
    expect(run('A=$F0 : Bset 2,A : Bclr 2,A : Print A')).toBe(' 240\n')
  })

  it('a target that is not a bare variable is an ADDRESS (BsRout +ILib.s:5776)', () => {
    // BsRout keeps the variable arm only while the token after the name
    // closes the call or ends the statement. `D+0` is neither, so BsR3 puts
    // a6 back and reads the whole thing as an address: the bit lands in the
    // byte D points at and D itself is untouched.
    const prog = [
      'Reserve As Work 10,16',
      'D=Start(10)',
      'Poke D,1',
      'Bset 3,D+0',
      'Print Peek(D)',
      'Print D=Start(10)',
      'Print Btst(3,D+0)',
    ].join('\n')
    expect(run(prog)).toBe(' 9\n-1\n-1\n')
  })

  it('the address arm works on a byte, word or long, not on the whole long', () => {
    // `move.w (a0),d1 / ror.w d0,d1 / move.w d1,(a0)` --- $1234 rotated four
    // to the right is $4123, and the byte arm sees only the high byte of it
    const prog = [
      'Reserve As Work 10,16',
      'D=Start(10)',
      'Doke D,$1234',
      'Ror.w 4,D+0',
      'Print Hex$(Deek(D))',
      'Ror.b 4,D+0',
      'Print Hex$(Deek(D))',
    ].join('\n')
    expect(run(prog)).toBe('$4123\n$1423\n')
  })

  it('a negative count is an Illegal function call (`tst.l d3 / bmi FonCall`)', () => {
    for (const stmt of ['Bset -1,A', 'Bclr -1,A', 'Bchg -1,A', 'Ror.l -1,A', 'Rol.b -1,A']) {
      expect(() => run(`A=1 : ${stmt}`)).toThrow(/Illegal function call/)
    }
    expect(() => run('A=1 : Print Btst(-1,A)')).toThrow(/Illegal function call/)
  })
})
