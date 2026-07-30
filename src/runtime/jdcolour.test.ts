import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { NA } from '../coverage/status'

const table = new TokenTable(CORE_TOKENS)
/** slot 20, from the source's own `ExtNb equ 20-1` */
const col = extensionById('jd-colour-2.0')!
const exts = new Map([[20, col.table]])

function run(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[20, col]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return out
}
const val = (expr: string): string => run(`Print ${expr}`).trim()

describe('JD Colour: the nibble arithmetic (+|col.s:214-640)', () => {
  it('splits and rebuilds a 12-bit colour', () => {
    expect(val('Jd Red Value($F80)')).toBe('15')
    expect(val('Jd Green Value($F80)')).toBe('8')
    expect(val('Jd Blue Value($F80)')).toBe('0')
    expect(val('Hex$(Jd Rgb Value(15,8,0))')).toBe('$F80')
  })

  it('Grey Colour averages the three into all three', () => {
    // (15+8+0)/3 = 7 in each
    expect(val('Hex$(Jd Grey Colour($F80))')).toBe('$777')
  })

  it('Antique Colour divides the sum by three, four and five', () => {
    // sum 15+8+0 = 23 -> 7, 5, 4: red keeps most, blue least, hence brown
    expect(val('Hex$(Jd Antique Colour($F80))')).toBe('$754')
  })

  it('False Colour ROTATES the components rather than inverting them', () => {
    // exg d1,d3 then exg d2,d3: red<-blue, green<-red, blue<-green
    expect(val('Jd False Colour($F80)')).toBe(String(0x0f8))
  })

  it('Negative and Complement subtract each nibble from 15', () => {
    expect(val('Jd Negative Colour($F80)')).toBe(String(0x07f))
    expect(val('Hex$(Jd Complement Colour($000))')).toBe('$FFF')
  })

  it('Mix Colours adds and clamps at 15', () => {
    expect(val('Hex$(Jd Mix Colours($123,$321))')).toBe('$444')
    expect(val('Hex$(Jd Mix Colours($F00,$F00))')).toBe('$F00')
  })

  it('the separations are the printing operation the library is named for', () => {
    // cyan averages the other two into green with a +1 rounding and forces $F
    expect(val('Hex$(Jd Separate Cyan($F80))')).toBe('$F8F')
    expect(val('Hex$(Jd Separate Red($F80))')).toBe('$F00')
    expect(val('Jd Separate Blue($F80)')).toBe('0')
    // black bands the total: 23 is the top band
    expect(val('Hex$(Jd Separate Black($F80))')).toBe('$FFF')
    expect(val('Jd Separate Black($000)')).toBe('0')
  })

  it('the swaps and Fit', () => {
    expect(val('Hex$(Jd Bswap($1234))')).toBe('$3412')
    expect(val('Jd Fit(10,5)')).toBe('-1')
    expect(val('Jd Fit(10,3)')).toBe('0')
  })
})

describe('JD Colour: the palette instructions', () => {
  it('Swap Colours and Copy Colour change the PALETTE', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$F00 : Colour 2,$00F',
      'Jd Swap Colours 1,2',
      'Print Colour(1);",";Colour(2)',
      'Jd Copy Colour 1 To 3',
      'Print Colour(3)',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual([`${0x00f}, ${0xf00}`, String(0x00f)])
  })

  it('Tone Colour brightens and darkens, clamped', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$777 : Jd Tone Colour 1,3 : Print Hex$(Colour(1))',
      'Colour 2,$222 : Jd Tone Colour 2,-5 : Print Colour(2)',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['$AAA', '0'])
  })

  it('Spread Palette ramps between two entries', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 0,$000 : Colour 4,$FFF',
      'Jd Spread Palette 0 To 4',
      'Print Hex$(Colour(2))',
    ].join('\n'))
    // halfway between black and white
    expect(out.trim()).toBe('$888')
  })

  it('Lightest and Darkest Colour scan the palette', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'For I=0 To 15 : Colour I,0 : Next I',
      'Colour 5,$FFF : Colour 9,$111 : Colour 0,$222',
      'Print Jd Lightest Colour;",";Jd Darkest Colour',
    ].join('\n'))
    expect(out.trim()).toBe('5, 1') // 1 is the first all-zero entry
  })

  it('the window, requester and whole-screen keywords are n/a', () => {
    for (const k of ['jd open con', 'jd request', 'jd screen convert', 'jd slide left', 'jd load palette']) {
      expect(NA.has(k), k).toBe(true)
    }
  })
})
