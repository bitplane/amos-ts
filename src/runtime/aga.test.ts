import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * AGA 1.0 (Nigel Critten, F1 Licenceware), against `AGA_Doc` and every routine
 * in `AGA.lib` disassembled with `extdis aga-1.0`. Addresses in the assertions
 * are offsets into that code hunk.
 */
const table = new TokenTable(CORE_TOKENS)
/** "Type in at line 20 (excluding speech marks) AMOSPro_AGA.Lib" */
const AGA_SLOT = 20
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [AGA_SLOT, extensionById('aga-1.0')!.table] as const,
])

function run(src: string | string[]): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(Array.isArray(src) ? src.join('\n') : src, table, extensions), table, {
    maxSteps: 4_000_000,
    extensions,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(400)
  mustFinish(r)
  return { out, rt }
}

/** the chunky pixel at x,y of AGA screen n */
const pix = (rt: Runtime, n: number, x: number, y: number): number => {
  const bm = rt.screens.get(n)!.rp.bitMap
  const planes = bm.planeBytes()
  let v = 0
  const o = y * bm.bytesPerRow + (x >> 3)
  const bit = 0x80 >> (x & 7)
  for (let p = 0; p < bm.depth; p++) if (planes[p * bm.planeSize + o]! & bit) v |= 1 << p
  return v
}

const trapped = (line: string): boolean =>
  run(['Aga Screen Open 0', `Trap ${line}`, 'Print Errtrap']).out.trim() !== '0'

describe('AGA screens', () => {
  it('opens 320x256x8, and refuses a screen that already exists', () => {
    const { rt } = run(['Aga Screen Open 0'])
    const s = rt.screens.get(0)!
    expect([s.width, s.height, s.depth]).toEqual([320, 256, 8])
    expect(trapped('Aga Screen Open 0')).toBe(true) // error 1
    expect(trapped('Aga Screen Open 8')).toBe(true) // error 5
    expect(trapped('Aga Screen Open -1')).toBe(true)
  })

  it('Aga Screen takes the focus without bringing the screen forward', () => {
    // routine 23 ($155c) writes $8a and nothing else; the doc agrees --
    // "all future drawing operations will be carried out on this screen"
    const { rt } = run([
      'Aga Screen Open 0',
      'Aga Screen Open 1',
      'Aga Screen 0',
      'Aga Ink 5 : Aga Bar 0,0 To 9,9',
    ])
    expect(pix(rt, 0, 4, 4)).toBe(5)
    expect(pix(rt, 1, 4, 4)).toBe(0) // screen 1 untouched
  })

  it('a keyword with no screen open is the extension error 0', () => {
    expect(run(['Trap Aga Cls', 'Print Errtrap']).out.trim()).not.toBe('0')
  })

  it('Aga Screen Close does not promote another screen', () => {
    // "If you have more than one screen open and you close the top screen you
    // will have to use AGA Front Screen to bring a new screen to the front"
    const { rt } = run(['Aga Screen Open 0', 'Aga Screen Open 1', 'Aga Screen Close 1'])
    expect(rt.aga.current).toBe(-1)
    expect(rt.screens.get(1)).toBeUndefined()
  })
})

describe('AGA drawing', () => {
  it('Aga Ink is a BYTE, so 256 wraps to 0 ($13a0)', () => {
    // the doc says so and the store is `move.b` -- truncation, not a check
    const { rt } = run(['Aga Screen Open 0', 'Aga Ink 256'])
    expect(rt.aga.rp.fgPen).toBe(0) // Aga Ink is rp_FgPen
    const b = run(['Aga Screen Open 0', 'Aga Ink 257 : Aga Bar 0,0 To 4,4'])
    expect(pix(b.rt, 0, 2, 2)).toBe(1)
  })

  it("the extension's RastPort is its own, so AMOS's pens do not reach it", () => {
    // AGA screens are real AMOS Screens here, so the focused screen's own
    // RastPort carries whatever Ink and Set Planes last set. The extension
    // has one RastPort of its own at $228(a5) and draws through that, which
    // is what keeps AMOS's drawing state out of a library that has none.
    const { rt } = run([
      'Aga Screen Open 0',
      'Ink 7 : Set Line $F0F0', // AMOS's pen and dash, on screen 0's RastPort
      'Aga Ink 200 : Aga Bar 0,0 To 9,9',
      'Aga Ink 100 : Aga Box 20,20 To 40,40',
    ])
    expect(pix(rt, 0, 5, 5)).toBe(200) // Aga Ink, not AMOS's Ink 7
    // the top edge is solid all the way across: Set Line dashed AMOS's
    // rp_LinePtrn, and the extension's is still $FFFF
    for (let x = 20; x <= 40; x++) expect(pix(rt, 0, x, 20)).toBe(100)
    expect(rt.screens.get(0)!.ink).toBe(7) // and AMOS's own pen is untouched
  })

  it('Aga Bar refuses an inverted or degenerate rectangle ($124c)', () => {
    // `cmp.w d0,d2 / ble` and `cmp.w d1,d3 / ble` -> error 3. AMOS's own Bar
    // would swap the corners and draw; this one will not
    expect(trapped('Aga Bar 10,10 To 5,20')).toBe(true)
    expect(trapped('Aga Bar 10,10 To 20,5')).toBe(true)
    expect(trapped('Aga Bar 10,10 To 10,20')).toBe(true) // equal is also out
    expect(trapped('Aga Bar 10,10 To 20,20')).toBe(false)
  })

  it('Aga Box is an outline, Aga Bar is a fill', () => {
    const { rt } = run(['Aga Screen Open 0', 'Aga Ink 7', 'Aga Box 10,10 To 20,20'])
    expect(pix(rt, 0, 10, 10)).toBe(7) // corner
    expect(pix(rt, 0, 15, 10)).toBe(7) // top edge
    expect(pix(rt, 0, 15, 15)).toBe(0) // hollow
    const f = run(['Aga Screen Open 0', 'Aga Ink 7', 'Aga Bar 10,10 To 20,20'])
    expect(pix(f.rt, 0, 15, 15)).toBe(7)
  })

  it('Aga Cls fills with Aga Ink, or with the colour it is given', () => {
    const a = run(['Aga Screen Open 0', 'Aga Ink 3', 'Aga Cls'])
    expect(pix(a.rt, 0, 100, 100)).toBe(3)
    const b = run(['Aga Screen Open 0', 'Aga Ink 3', 'Aga Cls 9'])
    expect(pix(b.rt, 0, 100, 100)).toBe(9)
  })

  it('Aga Draw Mode 2 is XOR, so drawing twice restores the pixel', () => {
    const { rt } = run([
      'Aga Screen Open 0',
      'Aga Ink 6 : Aga Bar 0,0 To 9,9',
      'Aga Draw Mode 2',
      'Aga Ink 3 : Aga Bar 0,0 To 9,9',
      'Aga Bar 0,0 To 9,9',
    ])
    expect(pix(rt, 0, 5, 5)).toBe(6)
  })

  it('Aga Point reads back what the pen wrote', () => {
    expect(run(['Aga Screen Open 0', 'Aga Ink 200 : Aga Bar 0,0 To 9,9', 'Print Aga Point(5,5)']).out.trim()).toBe(
      '200',
    )
    // a colour above 31 is exactly what an eight-plane screen is for
    expect(run(['Aga Screen Open 0', 'Aga Ink 200 : Aga Bar 0,0 To 9,9', 'Print Aga Point(400,5)']).out.trim()).toBe(
      '0',
    )
  })
})

describe('the AGA state keywords', () => {
  it('Aga Front Screen hides the others and takes the focus ($1868)', () => {
    const { rt } = run(['Aga Screen Open 0', 'Aga Screen Open 1', 'Aga Front Screen 0'])
    expect(rt.aga.current).toBe(0)
    expect(rt.screens.get(0)!.visible).toBe(true)
    expect(rt.screens.get(1)!.visible).toBe(false)
    expect(trapped('Aga Front Screen 4')).toBe(true) // not open: error 0
  })

  it('Aga Clip is a flag with no validation ($1ad2)', () => {
    // `move.b d0,$c4(a2)` and nothing else -- the doc's own warning is that
    // turning it off means "any graphics going over the boundary will cause
    // a error", so there is nothing here to range-check
    expect(run(['Aga Screen Open 0', 'Aga Clip 0']).rt.aga.clip).toBe(false)
    expect(run(['Aga Screen Open 0', 'Aga Clip -1']).rt.aga.clip).toBe(true)
  })

  /**
   * It is `move.b` into the flag, so only the LOW BYTE reaches it. This port
   * tested the whole value and therefore disagreed with the library on every
   * multiple of 256 -- Aga Ink has the same truncation and the doc admits to it
   * there ("If it goes over 255 it will wrap around again"), but says nothing
   * about it here.
   */
  it('Aga Clip keeps only the low byte, so 256 turns clipping OFF', () => {
    expect(run(['Aga Screen Open 0', 'Aga Clip 256']).rt.aga.clip).toBe(false)
    expect(run(['Aga Screen Open 0', 'Aga Clip 512']).rt.aga.clip).toBe(false)
    expect(run(['Aga Screen Open 0', 'Aga Clip 257']).rt.aga.clip).toBe(true)
  })

  it('Aga Sprite Mode falls back to low res rather than erroring ($19fe)', () => {
    // the three cmp.w tests match 0, 1 and 2 and leave d3 at 0 otherwise, so
    // an out-of-range resolution is silently low res
    expect(run(['Aga Screen Open 0', 'Aga Sprite Mode 2']).rt.aga.spriteMode).toBe(2)
    expect(run(['Aga Screen Open 0', 'Aga Sprite Mode 9']).rt.aga.spriteMode).toBe(0)
    expect(trapped('Aga Sprite Mode 9')).toBe(false)
  })

  it('Aga Use Font and Aga Text draw with whatever face was opened', () => {
    // routine 54 ($2324) opens diskfont.library and OpenDiskFont; with no
    // Fonts: assign there is no face, and Aga Text still runs
    const { rt } = run([
      'Aga Screen Open 0',
      'Aga Use Font "topaz.font",8,0',
      'Aga Ink 15',
      'Aga Text 10,20,"HI"',
    ])
    expect(rt.aga.rp.font).toBe(null) // rp_Font, and nothing to open in a bare VFS
    expect(trapped('Aga Text 10,20,"HI"')).toBe(false)
  })
})

describe('the AGA palette', () => {
  it('Aga Colour splits 8-bit channels into the LOCT nibble pair ($158a)', () => {
    const { rt } = run(['Aga Screen Open 0', 'Aga Colour 1,$12,$34,$56'])
    expect(rt.copRegs.pal[1]).toBe(0x135) // high nibbles
    expect(rt.copRegs.palLo[1]).toBe(0x246) // low nibbles
  })

  it('=Aga Colour returns the 24-bit longword the doc gives examples for', () => {
    // "Red = $00FF0000, Blue = $000000FF, Green = $0000FF00"
    const r = run(['Aga Screen Open 0', 'Aga Colour 1,$FF,0,0', 'Print Hex$(Aga Colour(1))']).out.trim()
    expect(r).toBe('$FF0000')
    const g = run(['Aga Screen Open 0', 'Aga Colour 2,0,$FF,0', 'Print Hex$(Aga Colour(2))']).out.trim()
    expect(g).toBe('$FF00')
  })

  it('a colour above 255 is skipped silently, with no error ($1630)', () => {
    // `cmp.w #$ff,d0 / bgt` jumps past the two pokes and falls out -- it does
    // not wrap and it does not raise
    const { rt } = run(['Aga Screen Open 0', 'Aga Colour 256,$FF,$FF,$FF'])
    expect(rt.copRegs.pal[0]).not.toBe(0xfff)
    expect(trapped('Aga Colour 300,1,2,3')).toBe(false)
  })

  it('every open screen shares one palette, which is why the bank form has no screen argument', () => {
    const { rt } = run(['Aga Screen Open 0', 'Aga Screen Open 1', 'Aga Colour 5,$FF,0,0'])
    expect(rt.screens.get(0)!.palette[5]).toBe(0xf00)
    expect(rt.screens.get(1)!.palette[5]).toBe(0xf00)
  })

  it('Aga Get Bank Palette takes ONE argument and discards a byte per entry', () => {
    // the doc's "AGA Get Palette Bank bank To screen" is wrong three ways
    const { rt } = run([
      'Aga Screen Open 0',
      'Reserve As Work 10,1024',
      // entry 1 is 0RGB: the first byte is read into d0 and immediately
      // overwritten by the second, so only R,G,B survive
      'Poke Start(10)+4,$99 : Poke Start(10)+5,$FF : Poke Start(10)+6,$80 : Poke Start(10)+7,$11',
      'Aga Get Bank Palette 10',
    ])
    expect(rt.copRegs.pal[1]).toBe(0xf81)
    expect(rt.copRegs.palLo[1]).toBe(0xf01)
  })

  it('Aga Get Palette pops its argument and does nothing at all ($11d8)', () => {
    // four bytes: move.l (a3)+,d0 / rts. Undocumented, and NOT the keyword
    // the doc's "AGA Get Palette Bank" entry describes
    const { rt } = run(['Aga Screen Open 0', 'Aga Colour 1,$FF,0,0', 'Aga Get Palette 10'])
    expect(rt.copRegs.pal[1]).toBe(0xf00) // untouched
    expect(trapped('Aga Get Palette 999')).toBe(false) // and never errors
  })
})

describe('AGA blocks', () => {
  it('grabs, pastes, and refuses a block number outside 0..4000 ($1434)', () => {
    const { rt } = run([
      'Aga Screen Open 0',
      'Aga Ink 12 : Aga Bar 0,0 To 9,9',
      'Aga Get Block 1,0,0,10,10,0',
      'Aga Put Block 1,100,100',
    ])
    expect(pix(rt, 0, 105, 105)).toBe(12)
    expect(trapped('Aga Get Block 4001,0,0,4,4,0')).toBe(true)
    expect(trapped('Aga Get Block -1,0,0,4,4,0')).toBe(true)
  })

  it('a masked block lets colour 0 through, an unmasked one paints it', () => {
    const src = ['Aga Screen Open 0', 'Aga Ink 9 : Aga Bar 0,0 To 9,9', 'Aga Ink 4 : Aga Bar 20,20 To 29,29']
    const masked = run([...src, 'Aga Get Block 1,0,0,20,20,-1', 'Aga Put Block 1,100,100'])
    expect(pix(masked.rt, 0, 105, 105)).toBe(9) // the solid corner came over
    expect(pix(masked.rt, 0, 115, 115)).toBe(0) // colour 0 stayed transparent
    const solid = run([
      ...src,
      'Aga Ink 7 : Aga Bar 100,100 To 119,119',
      'Aga Get Block 1,0,0,20,20,0',
      'Aga Put Block 1,100,100',
    ])
    expect(solid.rt.screens.get(0) ? pix(solid.rt, 0, 115, 115) : -1).toBe(0) // painted over with 0
  })

  it('Aga Del Block on a block that is not there is error $a ($1c08)', () => {
    expect(trapped('Aga Del Block 77')).toBe(true)
    expect(
      run(['Aga Screen Open 0', 'Aga Get Block 3,0,0,4,4,0', 'Trap Aga Del Block 3', 'Print Errtrap']).out.trim(),
    ).toBe('0')
  })

  it('Aga Put Block clips at the screen edge rather than writing past it', () => {
    const { rt } = run([
      'Aga Screen Open 0',
      'Aga Ink 5 : Aga Bar 0,0 To 9,9',
      'Aga Get Block 1,0,0,10,10,0',
      'Aga Put Block 1,315,250',
    ])
    expect(pix(rt, 0, 317, 252)).toBe(5)
  })
})

describe('AGA pictures', () => {
  it('Aga Screen Copy moves a whole screen, and a sub-rectangle when given one', () => {
    const whole = run([
      'Aga Screen Open 0',
      'Aga Screen Open 1',
      'Aga Screen 0 : Aga Ink 11 : Aga Cls',
      'Aga Screen Copy 0 To 1',
    ])
    expect(pix(whole.rt, 1, 160, 128)).toBe(11)
    const part = run([
      'Aga Screen Open 0',
      'Aga Screen Open 1',
      'Aga Screen 0 : Aga Ink 6 : Aga Bar 0,0 To 9,9',
      'Aga Screen Copy 0,0,0,10,10 To 1,50,50',
    ])
    expect(pix(part.rt, 1, 55, 55)).toBe(6)
    expect(pix(part.rt, 1, 100, 100)).toBe(0)
  })

  it('Aga Load Bitplanes copies eight $2800-byte planes and opens the screen ($1804)', () => {
    // $2800 is 320/8 * 256, one whole plane; the screen is opened if it is
    // not already, which is why this does not need Aga Screen Open first
    const { rt } = run([
      'Reserve As Work 10,81920',
      'Poke Start(10),255', // plane 0, first byte: pixels 0..7 get bit 0
      'Poke Start(10)+10240,255', // plane 1: they get bit 1 too
      'Aga Load Bitplanes 10 To 3',
    ])
    expect(rt.screens.get(3)!.depth).toBe(8)
    expect(pix(rt, 3, 0, 0)).toBe(3)
    expect(pix(rt, 3, 8, 0)).toBe(0)
  })

  it('Aga Spack and Aga Unpack round-trip a screen through the Aga.Pic format', () => {
    const { rt } = run([
      'Aga Screen Open 0',
      'Aga Colour 7,$12,$34,$56',
      'Aga Ink 7 : Aga Cls',
      'Aga Ink 200 : Aga Bar 10,10 To 40,40',
      'Aga Spack 0 To 11',
      'Aga Unpack 11 To 5',
    ])
    expect(pix(rt, 5, 100, 100)).toBe(7)
    expect(pix(rt, 5, 20, 20)).toBe(200)
    // "if the screen isn't opened then one will be opened for you" -- and it
    // is opened the extension's way, with no AMOS console cursor on it
    expect(rt.screens.get(5)!.cursorOn).toBe(false)
    // the palette rode along in the 1024-byte header, LOCT half included
    expect(rt.copRegs.pal[7]).toBe(0x135)
    expect(rt.copRegs.palLo[7]).toBe(0x246)
  })

  it('the packed bank is named Aga.Pic and starts with 1024 palette bytes', () => {
    const { rt } = run(['Aga Screen Open 0', 'Aga Ink 1 : Aga Cls', 'Aga Spack 0 To 11'])
    const b = rt.memBanks.get(11)!
    expect(b.name).toBe('Aga.Pic')
    // a solid screen is 320 pixels a row in runs of at most 255, so two runs
    // a row: 1024 + 256 * 4 bytes
    expect(b.data.length).toBe(1024 + 256 * 4)
  })
})
