import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * 256-colour screens: eight bitplanes, AGA's banked colour registers, and
 * the LOCT low-nibble pass.
 *
 * The writer for all of this already existed before the reader did — Stars
 * 2.33's `Cop Palette` and `Cop True Palette` (runtime/stars.ts) emit exactly
 * the BPLCON3 bank selects and LOCT writes this exercises, and stars.test.ts
 * pins the word sequences they produce. So the round-trip tests below are two
 * independently written halves meeting, not one function agreeing with itself.
 */
const table = new TokenTable(CORE_TOKENS)
const STARS_SLOT = 20
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)] as const),
  [STARS_SLOT, extensionById('stars-2.33')!.table] as const,
])

function run(src: string | string[], withStars = false): Runtime {
  const ext = withStars ? extensions : undefined
  const rt = new Runtime(tokenize(Array.isArray(src) ? src.join('\n') : src, table, ext), table, {
    maxSteps: 3_000_000,
    ...(ext ? { extensions: ext } : {}),
  })
  const r = rt.runHeadless(2_000)
  mustFinish(r)
  // the list is INTERPRETED during composite, and that is what writes the
  // register file back to copRegs -- reading it before compositing sees the
  // state as the frame started, which is all zeros
  rt.composite()
  return rt
}

/** the rendered pixel as a full 24-bit RGB, not rounded to 12 */
const pix24 = (rt: Runtime, x: number, y: number): number => {
  const { data } = rt.composite()
  const o = ((y + 48) * 640 + x) * 4
  return data[o]! * 65536 + data[o + 1]! * 256 + data[o + 2]!
}

describe('a 256-colour screen', () => {
  it('opens with eight bitplanes where AMOS itself stops at 64 colours', () => {
    // Screen Open on a real Amiga cannot do this -- AMOS predates AGA. It is
    // here for the extensions that drive eight planes, so the AMOS-facing
    // error behaviour has to be unchanged for every count it used to reject.
    const rt = run('Print 1')
    const s = rt.openScreen(1, 320, 256, 256, 0)
    expect(s.depth).toBe(8)
    expect(s.rowBytes).toBe(40)
    expect(s.palette.length).toBe(256)
    expect(() => rt.openScreen(2, 320, 200, 128, 0)).toThrow() // still not a legal count
    expect(() => rt.openScreen(2, 320, 200, 3, 0)).toThrow()
  })

  it('keeps a pen above 31 distinct instead of folding it onto its bank-0 twin', () => {
    // the renderer used to mask every palette index to five bits
    const rt = run('Print 1')
    const s = rt.openScreen(1, 320, 256, 256, 0)
    s.palette[1] = 0xf00
    s.palette[33] = 0x00f
    expect(s.palette[1]).not.toBe(s.palette[33])
  })
})

describe('AGA colour banking in the copper-list interpreter', () => {
  it('BPLCON3 bits 13-15 select which 32 registers $180..$1be mean', () => {
    const rt = run([
      'Screen Open 0,320,200,2,Lowres',
      'Copper Off',
      'Cop Reset',
      'Cop Move $106,$0000 : Cop Move $180,$F00', // bank 0, colour 0 = red
      'Cop Move $106,$2000 : Cop Move $180,$00F', // bank 1, colour 32 = blue
      'Cop Move $106,$0000',
      'Cop Swap',
      'Wait Vbl',
    ])
    const pal = rt.copRegs.pal
    expect(pal[0]).toBe(0xf00) // bank 0 colour 0
    expect(pal[32]).toBe(0x00f) // bank 1 colour 0 is index 32
    // and the two did not overwrite each other, which is the whole point
    expect(pal[0]).not.toBe(pal[32])
  })

  it('LOCT ($200) writes the LOW nibbles without disturbing the high ones', () => {
    const rt = run([
      'Screen Open 0,320,200,2,Lowres',
      'Copper Off',
      'Cop Reset',
      'Cop Move $106,$0000 : Cop Move $180,$123', // high nibbles
      'Cop Move $106,$0200 : Cop Move $180,$456', // low nibbles, LOCT set
      'Cop Swap',
      'Wait Vbl',
    ])
    expect(rt.copRegs.pal[0]).toBe(0x123)
    expect(rt.copRegs.palLo[0]).toBe(0x456)
  })

  it('a write without LOCT replicates the high nibble, so ECS stays exact', () => {
    // this is what keeps every existing display test bit-identical: with
    // lo == hi, `hi << 4 | lo` is `hi * 17`, the old expansion exactly
    const rt = run([
      'Screen Open 0,320,200,2,Lowres',
      'Copper Off',
      'Cop Reset',
      'Cop Move $180,$ABC',
      'Cop Swap',
      'Wait Vbl',
    ])
    expect(rt.copRegs.pal[0]).toBe(0xabc)
    expect(rt.copRegs.palLo[0]).toBe(0xabc)
  })
})

describe('the round trip: Stars writes the palette, the display reads it', () => {
  it('Cop Palette lands 12-bit colours the renderer shows as ECS would', () => {
    const rt = run(
      [
        'Screen Open 0,320,200,2,Lowres',
        'Copper Off',
        'Cop Reset',
        'Reserve As Work 10,8',
        'Doke Start(10),$F80',
        'Cop Palette 0 To 0,Start(10)',
        'Cop Swap',
        'Wait Vbl',
      ],
      true,
    )
    expect(rt.copRegs.pal[0]).toBe(0xf80)
    // background is COLOR00, and 12-bit expands by nibble replication
    expect(pix24(rt, 100, 10)).toBe(0xff8800)
  })

  it('Cop True Palette reaches a colour no 12-bit palette can express', () => {
    // $12,$34,$56 is not a multiple of $11 in any component, so a 12-bit
    // palette literally cannot produce it -- only the LOCT pass can
    const rt = run(
      [
        'Screen Open 0,320,200,2,Lowres',
        'Copper Off',
        'Cop Reset',
        'Reserve As Work 10,8',
        'Poke Start(10),$12 : Poke Start(10)+1,$34 : Poke Start(10)+2,$56',
        'Cop True Palette 0 To 0,Start(10)',
        'Cop Swap',
        'Wait Vbl',
      ],
      true,
    )
    expect(rt.copRegs.pal[0]).toBe(0x135) // high nibbles
    expect(rt.copRegs.palLo[0]).toBe(0x246) // low nibbles
    expect(pix24(rt, 100, 10)).toBe(0x123456)
  })

  it('Cop Palette crossing a bank boundary keeps writing forwards', () => {
    // 32 colours from index 16 runs $1a0..$1be, wraps to $180 with the bank
    // stepped, and must NOT come back round onto the ones it just wrote
    const rt = run(
      [
        'Screen Open 0,320,200,2,Lowres',
        'Copper Off',
        'Cop Reset',
        'Reserve As Work 10,128',
        'For I=0 To 31 : Doke Start(10)+I*2,I+1 : Next I',
        'Cop Palette 16 To 47,Start(10)',
        'Cop Swap',
        'Wait Vbl',
      ],
      true,
    )
    const pal = rt.copRegs.pal
    for (let i = 0; i < 32; i++) expect(pal[16 + i]).toBe(i + 1)
    // nothing landed below 16 or above 47
    expect(pal[15]).toBe(0)
    expect(pal[48]).toBe(0)
  })
})
