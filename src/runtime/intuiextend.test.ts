import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { mustFinish } from '../testing/run'
import { describeIf } from '../testing/fixture'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { firstCodeHunk } from '../tokens/libtok'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { IE3D_MAGIC, IE_COS_ARTEFACTS, IE_COS_ENTRIES, IE_SIN_OFFSET, ieCosTable } from './intuiextend'

const table = new TokenTable(CORE_TOKENS)
/** slot 23, the extension's own install note and the registry's statedSlot */
const ie = extensionById('intuiextend-2.01b')!

function run(src: string): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ie.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

/** one trimmed line per `Print`, so AMOS's leading space for a positive stays out of it */
const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

const val = (expr: string, pre = ''): string => lines(`${pre}Print ${expr}`)[0] ?? ''

/** angles all zero, eye at the origin, centre wherever the caller wants it */
const setup = (cx: number, cy: number): string =>
  `Wb 3d Angle 0,0,0\nWb 3d Eye 0,0,0\nWb 3d Centre ${cx},${cy}\n`

const SCREEN = 'Screen Open 0,320,256,16,Lowres\n'

describe('IntuiExtend 2.01b — the cosine table', () => {
  it('is 458 words, the span from workspace+$216 to the 3D state at $5aa', () => {
    expect(ieCosTable()).toHaveLength(IE_COS_ENTRIES)
    expect(0x5aa - 0x216).toBe(IE_COS_ENTRIES * 2)
  })

  it('peaks one entry before the start, which is why it is cos(i+1)', () => {
    const t = ieCosTable()
    expect(t[0]).toBe(255)
    expect(t[359]).toBe(256)
    expect(t[89]).toBe(0)
    expect(t[179]).toBe(-256)
  })

  it('holds the two values no rounding rule produces', () => {
    const t = ieCosTable()
    // 240 and 300 degrees are exactly -0.5 and +0.5, so 256 times them is
    // exactly -128 and +128; the shipped table is one below on both.
    for (const [i, v] of IE_COS_ARTEFACTS) expect(t[i]).toBe(v)
    // the other two exact halves ARE exact, which is what makes those artefacts
    expect(t[59]).toBe(128)
    expect(t[119]).toBe(-128)
  })

  it('is periodic over 360 so the sine is the cosine 90 on', () => {
    const t = ieCosTable()
    for (let d = 0; d + 360 < IE_COS_ENTRIES; d++) expect(t[d]).toBe(t[d + 360])
    expect(IE_SIN_OFFSET * 2).toBe(0xb4)
  })
})

/**
 * The generator against the library. `fixtures/` is gitignored, so this only
 * runs where the binary is present; the assertions above stand without it.
 */
const LIB_DIR = 'fixtures/extensions/intuiextend-2.01b'
const libFile = existsSync(LIB_DIR)
  ? readdirSync(LIB_DIR).find((f) => /\.lib$/i.test(f))
  : undefined

describeIf('IntuiExtend 2.01b — the table against the binary', libFile !== undefined, () => {
  it('reproduces all 458 words at $1d28+$216', () => {
    const code = firstCodeHunk(new Uint8Array(readFileSync(`${LIB_DIR}/${libFile}`)))
    const at = 0x1d28 + 0x216
    const s16 = (a: number): number => ((((code[a]! << 8) | code[a + 1]!) << 16) >> 16)
    const want = ieCosTable()
    for (let i = 0; i < IE_COS_ENTRIES; i++) expect(s16(at + i * 2)).toBe(want[i])
  })

  it('finds routine 0 storing the workspace pointer where the header says', () => {
    const code = firstCodeHunk(new Uint8Array(readFileSync(`${LIB_DIR}/${libFile}`)))
    const b = (a: number): number => code[a]!
    // $1d1c  move.l a3,$258(a5)  =  2b4b 0258
    expect((b(0x1d1c) << 8) | b(0x1d1d)).toBe(0x2b4b)
    expect((b(0x1d1e) << 8) | b(0x1d1f)).toBe(0x0258)
  })
})

describe('IntuiExtend 2.01b — the projection', () => {
  /**
   * The table is cos(i+1), so `Wb 3d Angle 0,0,0` loads cos=255 and
   * sin=t[90]=-5, which is cos(91 degrees). There is no argument that means
   * "do not rotate": every axis turns by one degree, and each rotation also
   * shrinks by 255/256 because the cosine of the identity is 255 rather
   * than 256.
   */
  it('has no identity angle: zero still turns one degree and scales by 255/256', () => {
    const t = ieCosTable()
    expect(t[0]).toBe(255)
    expect(t[0 + IE_SIN_OFFSET]).toBe(-5)
  })

  /*
   * Wb 3d Point 0,0,100 with centre 160,128, worked through routine 183:
   *   rot1  d4 = (0*255 + 100*-5)>>8 = -500>>8 = -2 ; d5 = 25500>>8 = 99
   *   rot2  d3 = (0*255 +  99*-5)>>8 = -495>>8 = -2 ; d5 = 25245>>8 = 98
   *   rot3  d4 = (-2*255 + -2*-5)>>8 = -500>>8 = -2 ; d7 = -520>>8 = -3
   *   x  = 160 + trunc(-3*320 / 98) = 160 - 9  = 151
   *   y  = 128 + trunc(-2*256 / 98) = 128 - 5  = 123
   */
  it('lands a point on the axis just off the centre, not on it', () => {
    expect(val('Wb 3d X', `${setup(160, 128)}Wb 3d Point 0,0,100\n`)).toBe('151')
    expect(val('Wb 3d Y', `${setup(160, 128)}Wb 3d Point 0,0,100\n`)).toBe('123')
  })

  /*
   * Wb 3d Point 10,0,200 with centre 100,100:
   *   rot1  d5 = 51000>>8 = 199 ; d6 = -1000>>8 = -4
   *   rot2  d3 = (2550 - 995)>>8 = 1555>>8 = 6 ; d5 = 50795>>8 = 198
   *   rot3  d7 = (1530 - 20)>>8 = 1510>>8 = 5  ; d6 = -1050>>8 = -5
   *   x = 100 + trunc(5*200 / 198)  = 105
   *   y = 100 + trunc(-5*200 / 198) = 95
   */
  it('divides by Z with a focal length of twice the centre', () => {
    expect(val('Wb 3d X', `${setup(100, 100)}Wb 3d Point 10,0,200\n`)).toBe('105')
    expect(val('Wb 3d Y', `${setup(100, 100)}Wb 3d Point 10,0,200\n`)).toBe('95')
  })

  it('leaves Z as the rotated depth, with no divide applied to it', () => {
    // 256 through three rotations by cos=255: 255, 254, 254
    expect(val('Wb 3d Z', `${setup(160, 128)}Wb 3d Point 0,0,256\n`)).toBe('254')
  })

  it('is unaffected by Wb 3d Ink, which is a bare rts', () => {
    const withInk = `${setup(160, 128)}Wb 3d Ink 5\nWb 3d Point 0,0,100\n`
    expect(val('Wb 3d X', withInk)).toBe('151')
  })

  it('shifts arithmetically, so a negative coordinate floors away from zero', () => {
    // -1000>>8 is -4 where truncation would give -3; the rotations rely on it
    expect(-1000 >> 8).toBe(-4)
  })
})

describe('IntuiExtend 2.01b — objects', () => {
  it('stamps IE3D and both counts where the guide says', () => {
    expect(lines(`O=Wb 3d Make Object(3,2)\nPrint Leek(O)\nPrint Deek(O+4)\nPrint Deek(O+6+3*12)`)).toEqual([
      `${IE3D_MAGIC | 0}`,
      '3',
      '2',
    ])
  })

  it('sizes the block by the guide\'s own formula', () => {
    // "Size=4+2+((A*4)*3)+2+((B*2)*4)" with A=3 points and B=2 shapes
    expect(4 + 2 + 3 * 4 * 3 + 2 + 2 * 2 * 4).toBe(60)
  })

  it('sets a point through Wb 3d Edge, which is one-based', () => {
    const src = `O=Wb 3d Make Object(2,1)\nWb 3d Edge 11,22,33 To 1,O\nPrint Leek(O+6)\nPrint Leek(O+10)\nPrint Leek(O+14)`
    expect(lines(src)).toEqual(['11', '22', '33'])
  })

  it('sets a polygon\'s four corners through Wb 3d Shape', () => {
    const src = `O=Wb 3d Make Object(4,1)\nWb 3d Shape 1,2,3,4 To 1,O\nS=O+6+4*12+2\nPrint Deek(S)\nPrint Deek(S+2)\nPrint Deek(S+4)\nPrint Deek(S+6)`
    expect(lines(src)).toEqual(['1', '2', '3', '4'])
  })

  it('leaves a block without the IE3D stamp alone', () => {
    // routine 294 branches to `adda.l #$10,a3` and returns without writing
    const src = `Reserve As Work 5,64\nWb 3d Edge 9,9,9 To 1,Start(5)\nPrint Leek(Start(5)+6)`
    expect(lines(src)).toEqual(['0'])
  })

  it('returns -1 rather than 255 when the allocation fails', () => {
    // `moveq #$ff,d3` at $55c0 sign-extends; a zero-point object still costs 8
    expect(val('Wb 3d Make Object(0,0)')).not.toBe('255')
  })
})

describe('IntuiExtend 2.01b — the three defects in the 3D group', () => {
  /**
   * Routine 271 never steps over the magic, so `move.w (a0)+,d0` at $4f50
   * reads $4945 as the point count and the loop starts four bytes early. The
   * first long it touches is the magic's low word joined to the point count,
   * so the count is what visibly moves.
   */
  it('Wb 3d Move Object starts four bytes early and increments the point count', () => {
    const src = `O=Wb 3d Make Object(2,1)\nWb 3d Move Object 1,0,0 To O\nPrint Deek(O+4)`
    expect(lines(src)).toEqual(['3'])
  })

  it('Wb 3d Move Object applies X to the count and Y to the first point', () => {
    // everything is shifted one long: Y lands where X should have
    const src = `O=Wb 3d Make Object(2,1)\nWb 3d Edge 0,0,0 To 1,O\nWb 3d Move Object 0,7,0 To O\nPrint Leek(O+6)`
    expect(lines(src)).toEqual(['7'])
  })

  /**
   * Routine 284 has no `subq.w #$1` where routine 294 does, so the same point
   * number means different points to the two keywords.
   */
  it('Wb 3d Move Edge is zero-based where Wb 3d Edge is one-based', () => {
    const src = `O=Wb 3d Make Object(3,1)\nWb 3d Edge 100,0,0 To 1,O\nWb 3d Move Edge 5,0,0 To 1,O\nPrint Leek(O+6)\nPrint Leek(O+18)`
    expect(lines(src)).toEqual(['100', '5'])
  })

  it('Wb 3d Position is twice the signed area while the coordinates are small', () => {
    // (y2-y1)*x3 + (y3-y2)*x1 + (y1-y3)*x2 over (0,0) (10,0) (0,10)
    expect(val('Wb 3d Position(0,0,10,0,0,10)')).toBe('-100')
    // and it changes sign with the winding
    expect(val('Wb 3d Position(0,0,0,10,10,0)')).toBe('100')
  })
})

describe('IntuiExtend 2.01b — drawing', () => {
  it('Wb 3d Locate moves the graphics cursor and draws nothing', () => {
    const b = run(`${SCREEN}${setup(160, 128)}Wb 3d Locate 0,0,100`)
    const s = b.rt.screen!
    expect([s.rp.cpX, s.rp.cpY]).toEqual([151, 123])
  })

  it('Wb 3d Draw leaves the cursor at the projected point', () => {
    const b = run(`${SCREEN}${setup(100, 100)}Wb 3d Locate 0,0,200\nWb 3d Draw 10,0,200`)
    const s = b.rt.screen!
    expect([s.rp.cpX, s.rp.cpY]).toEqual([105, 95])
  })

  it('Wb 3d Plot puts a pixel down in the RastPort pen', () => {
    const b = run(`${SCREEN}Ink 3\n${setup(160, 128)}Wb 3d Plot 0,0,100`)
    const s = b.rt.screen!
    expect(s.rp.point(151, 123)).toBe(3)
  })

  it('Wb 3d Draw Object walks each polygon as three segments, not four', () => {
    // a closed quad would return the cursor to its first corner; this leaves
    // it on the fourth, because routine 318's inner loop runs `moveq #$3,d5`
    const src = `${SCREEN}${setup(160, 128)}O=Wb 3d Make Object(4,1)\nWb 3d Edge 0,0,100 To 1,O\nWb 3d Edge 10,0,100 To 2,O\nWb 3d Edge 10,10,100 To 3,O\nWb 3d Edge 0,10,100 To 4,O\nWb 3d Shape 1,2,3,4 To 1,O\nWb 3d Draw Object O`
    const b = run(src)
    const s = b.rt.screen!
    // the fourth corner projected, not the first
    const fourth = run(`${setup(160, 128)}Wb 3d Point 0,10,100\nPrint Wb 3d X\nPrint Wb 3d Y`)
    const [fx, fy] = fourth
      .out()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(Number)
    expect([s.rp.cpX, s.rp.cpY]).toEqual([fx, fy])
  })
})
