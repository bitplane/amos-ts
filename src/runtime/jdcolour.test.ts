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
/** the same without the trim, for the keywords where padding is the point */
const sval = (expr: string): string => run(`Print ${expr}`).replace(/\n$/, '')

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

  it('each swap is one size smaller than its name suggests', () => {
    // routines 63/64/65 in the 2.0 binary, which has no source: Bswap is the
    // two NIBBLES of a byte, Wswap the two bytes of a word, Lswap the halves
    // of the longword
    expect(val('Hex$(Jd Bswap($1234))')).toBe('$43')
    expect(val('Hex$(Jd Bswap($AB))')).toBe('$BA')
    expect(val('Hex$(Jd Wswap($1234))')).toBe('$3412')
    expect(val('Hex$(Jd Lswap($12345678))')).toBe('$56781234')
  })

  it('Fit answers 1 rather than AMOS true', () => {
    // routine 55 is `move.l #1,d3` on the true path (+|col.s:1862), so a
    // program comparing it against True gets the wrong answer
    expect(val('Jd Fit(10,5)')).toBe('1')
    expect(val('Jd Fit(10,3)')).toBe('0')
    expect(val('Jd Fit(10,0)')).toBe('0')
  })

  it('Cut Off$ SPREADS the string out; it does not cut anything off', () => {
    // routine 56 (+|col.s:1876) writes each character then a space, then
    // backs over the last one: 2n-1 characters
    expect(sval('Jd Cut Off$("Test")')).toBe('T e s t')
    expect(sval('Jd Cut Off$("a")')).toBe('a')
  })

  it('Cut Off$ raises error 23 on an empty string and at 128 characters', () => {
    expect(() => run('Print Jd Cut Off$("")')).toThrow(/illegal function call/)
    expect(() => run('Print Jd Cut Off$(String$("x",128))')).toThrow(/illegal function call/)
    expect(sval('Jd Cut Off$(String$("x",127))').length).toBe(253)
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

  it('Spread Palette ramps between two entries, ends untouched', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$000 : Colour 5,$FFF',
      'Jd Spread Palette 1 To 5',
      'Print Hex$(Colour(3));",";Hex$(Colour(1));",";Hex$(Colour(5))',
    ].join('\n'))
    // (15-0)/4 = 3.75 accumulated and truncated by SPFix at each entry:
    // 3.75 -> 3, 7.5 -> 7, 11.25 -> 11. Hex$ does not zero-pad, hence "$0"
    expect(out.trim()).toBe('$777,$0,$FFF')
  })

  it('Spread Palette rejects colour 0 outright — `cmp.l #0,d2 / ble _err`', () => {
    const head = 'Screen Open 0,320,200,16,Lowres\n'
    expect(() => run(head + 'Jd Spread Palette 0 To 4')).toThrow(/illegal function call/)
    expect(() => run(head + 'Jd Spread Palette 1 To 32')).toThrow(/illegal function call/)
  })

  it('a reversed pair is swapped, and a gap under two does nothing', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Colour 1,$000 : Colour 5,$FFF',
      'Jd Spread Palette 5 To 1',
      'Print Hex$(Colour(3))',
      'Colour 7,$F00 : Colour 8,$00F : Jd Spread Palette 7 To 8',
      'Print Hex$(Colour(7));",";Hex$(Colour(8))',
    ].join('\n'))
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['$777', '$F00,$F'])
  })

  it('Pseudo Palette copies the fixed table, it does not generate a ramp', () => {
    // `ppal` (+|col.s:185): 32 words, blue through green and yellow to red
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'Jd Pseudo Palette',
      'Print Hex$(Colour(0));",";Hex$(Colour(1));",";Hex$(Colour(15));",";Hex$(Colour(9))',
    ].join('\n'))
    expect(out.trim()).toBe('$0,$F,$4F0,$FE')
  })

  it('Lightest and Darkest Colour scan the palette', () => {
    const out = run([
      'Screen Open 0,320,200,16,Lowres',
      'For I=0 To 15 : Colour I,0 : Next I',
      'Colour 5,$FFF : Colour 9,$111 : Colour 0,$222',
      'Print Jd Lightest Colour;",";Jd Darkest Colour',
    ].join('\n'))
    // 5 is the brightest. The darkest is a tie among every all-zero entry,
    // and routines 52/53 answer with the HIGHEST index of a tie -- the table
    // they build is filled backwards and searched forwards
    expect(out.trim()).toBe('5, 15')
  })

  it("the scan stops at the SCREEN's colour count, not the palette's", () => {
    // `move.w $60(a0),d0 / sub.l #1,d0` off ScOnAd: a 4-colour screen looks
    // at entries 0 to 3 and cannot answer with 5 however bright it is
    const out = run([
      'Screen Open 0,320,200,4,Lowres',
      'For I=0 To 15 : Colour I,0 : Next I',
      'Colour 2,$F00 : Colour 5,$FFF',
      'Print Jd Lightest Colour',
    ].join('\n'))
    expect(out.trim()).toBe('2')
  })

  it('the window, requester and whole-screen keywords are n/a', () => {
    for (const k of ['jd open con', 'jd request', 'jd screen convert', 'jd slide left', 'jd load palette']) {
      expect(NA.has(k), k).toBe(true)
    }
  })
})
