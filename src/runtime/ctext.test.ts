/**
 * CText 1.32, verified against CTEXT.Lib disassembled with `extdis ctext-1.0`
 * and against the 254 `.Cfnt` font tables on the AMOS PD CD, which are every
 * one of them exactly 768 bytes.
 *
 * The routine addresses in the comments are the ones in CTEXT.Lib's code hunk,
 * so a future reader can go back to the instruction that decided a behaviour.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { CT } from './ctext'

const table = new TokenTable(CORE_TOKENS)
/** the slot CText's own documentation recommends, and where the corpus has it */
const CTEXT_SLOT = 8
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [CTEXT_SLOT, extensionById('ctext-1.0')!.table] as const,
])

/**
 * A font table in the layout the `.Cfnt` files use: three 256-byte blocks of
 * icon number, advance width and Y offset, in that order.
 */
function cfnt(spec: Record<string, [icon: number, width: number, yoff: number]>): Uint8Array {
  const t = new Uint8Array(768)
  for (const [ch, [icon, w, y]] of Object.entries(spec)) {
    const c = ch.charCodeAt(0)
    t[c] = icon
    t[256 + c] = w
    t[512 + c] = y
  }
  return t
}

/**
 * Run a program with a font table already in the block — which is what
 * `Bload Dir$+"...CFNT",Font Data` does on a real machine.
 */
function run(src: string, font?: Uint8Array): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 200_000,
    extensions,
    onText: (t) => (out += t),
  })
  if (font) rt.ctext.block.set(font, CT.TABLES)
  const r = rt.runHeadless(2_000)
  mustFinish(r)
  return { out, rt }
}

const AB = cfnt({ A: [1, 5, 0], B: [2, 7, 0] })

describe('CText: the data block and its addresses', () => {
  it('Font Data points $1e past Font Base', () => {
    // routines 8 and 9 ($67e, $688): the second is the first plus $1e
    expect(run('Print Font Data-Font Base').out).toBe(' 30\n')
  })

  it('Font Base is an address, and Font Size writes the longs behind it', () => {
    // routine 5 ($4c4) writes the two longs at +$a and +$e; a program is free
    // to reach the same longs through Font Base, which is why it is exposed
    expect(
      run(['Font Size 9,0', 'Print Leek(Font Base+10)', 'Loke Font Base+10,4', 'Print Leek(Font Base+10)'].join('\n'))
        .out,
    ).toBe(' 9\n 4\n')
  })

  it('the three tables are reachable through Font Data, as Bload needs', () => {
    expect(
      run(
        [
          'Poke Font Data+65,7',
          'Poke Font Data+256+65,11',
          'Poke Font Data+512+65,3',
          'Print Peek(Font Data+65);Peek(Font Data+321);Peek(Font Data+577)',
        ].join('\n'),
      ).out,
    ).toBe(' 7 11 3\n')
  })
})

describe('CText: the pen advance', () => {
  it('Plen adds the per-character widths when the fixed width is 0', () => {
    expect(run('Font Size 0,0 : Print Plen("AB")', AB).out).toBe(' 12\n') // 5 + 7
  })

  it('a non-zero fixed width overrides the table for every character', () => {
    // `tst.l $a(a0) : beq` — the table is consulted only when +$a is zero
    expect(run('Font Size 8,0 : Print Plen("AB")', AB).out).toBe(' 16\n')
  })

  it('an unmapped character still advances', () => {
    // `cmp.l #$0,d1 : ble` skips the DRAW, not the advance
    const font = cfnt({ A: [1, 5, 0], B: [2, 7, 0], Z: [0, 4, 0] })
    expect(run('Font Size 0,0 : Print Plen("AZB")', font).out).toBe(' 16\n') // 5+4+7
  })

  it('an empty string measures zero', () => {
    expect(run('Font Size 0,0 : Print Plen("")', AB).out).toBe(' 0\n')
  })
})

describe('CText: kerning travels inside the string', () => {
  it('Kern$ returns ESC followed by the digit', () => {
    // routine 11 ($6ca): move.l #$30,d1 : add.l d0,d1 : move.b d1,$1d(a0)
    expect(run('K$=Kern$(3) : Print Len(K$);Asc(Left$(K$,1));Asc(Right$(K$,1))').out).toBe(' 2 27 51\n')
  })

  it('an embedded Kern$ shifts the pen once, then clears', () => {
    // +$12 is added to the pen and immediately zeroed ($60e-$616), so a kern
    // applies to the join it sits at and not to the rest of the string
    expect(run('Font Size 0,0 : Print Plen("A"+Kern$(3)+"B")', AB).out).toBe(' 15\n') // 5+3+7
    expect(run('Font Size 0,0 : Print Plen("A"+Kern$(3)+"BB")', AB).out).toBe(' 22\n') // 5+3+7+7
  })

  it('Kern$(0) is a no-op, being ESC then the digit zero', () => {
    expect(run('Font Size 0,0 : Print Plen("A"+Kern$(0)+"B")', AB).out).toBe(' 12\n')
  })
})

describe('CText: drawing', () => {
  it('Ctext pastes the mapped icon at the pen', () => {
    // A is icon 1 with width 5, B is icon 2 with width 7, both 4x4 solid
    const font = cfnt({ A: [1, 5, 0], B: [2, 7, 0] })
    const { rt } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Cls 0 : Curs Off',
        'Ink 5 : Bar 0,0 To 3,3 : Get Icon 1,0,0 To 4,4',
        'Ink 3 : Bar 0,0 To 3,3 : Get Icon 2,0,0 To 4,4',
        'Cls 0',
        'Font Size 0,0',
        'Ctext 20,50,"AB"',
      ].join('\n'),
      font,
    )
    // A at x=20 in pen 5, B five pixels along in pen 3
    expect(rt.screen.point(20, 50)).toBe(5)
    expect(rt.screen.point(25, 50)).toBe(3)
    // and nothing before the pen
    expect(rt.screen.point(19, 50)).toBe(0)
  })

  it('the Y table lifts each character off the baseline', () => {
    // `sub.l $e(a0),d3` when fixed, else `sub.l base[$21e+ch],d3` ($644-$652)
    const font = cfnt({ A: [1, 5, 4] })
    const { rt } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Cls 0 : Curs Off',
        'Ink 5 : Bar 0,0 To 3,3 : Get Icon 1,0,0 To 4,4',
        'Cls 0',
        'Font Size 0,0',
        'Ctext 20,50,"A"',
      ].join('\n'),
      font,
    )
    expect(rt.screen.point(20, 46)).toBe(5) // 50 - 4
    expect(rt.screen.point(20, 50)).toBe(0)
  })

  it('a fixed height overrides the Y table', () => {
    const font = cfnt({ A: [1, 5, 4] })
    const { rt } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Cls 0 : Curs Off',
        'Ink 5 : Bar 0,0 To 3,3 : Get Icon 1,0,0 To 4,4',
        'Cls 0',
        'Font Size 0,2',
        'Ctext 20,50,"A"',
      ].join('\n'),
      font,
    )
    expect(rt.screen.point(20, 48)).toBe(5) // 50 - 2, the table's 4 ignored
  })

  it('an unmapped character draws nothing but leaves its gap', () => {
    const font = cfnt({ A: [1, 5, 0], Z: [0, 6, 0], B: [2, 7, 0] })
    const { rt } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Cls 0 : Curs Off',
        'Ink 5 : Bar 0,0 To 3,3 : Get Icon 1,0,0 To 4,4',
        'Ink 3 : Bar 0,0 To 3,3 : Get Icon 2,0,0 To 4,4',
        'Cls 0',
        'Font Size 0,0',
        'Ctext 20,50,"AZB"',
      ].join('\n'),
      font,
    )
    expect(rt.screen.point(20, 50)).toBe(5)
    expect(rt.screen.point(26, 50)).toBe(0) // Z's gap, nothing drawn
    expect(rt.screen.point(31, 50)).toBe(3) // B at 20+5+6
  })
})
