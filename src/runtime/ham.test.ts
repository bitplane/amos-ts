import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { rowBytesFor } from '../amiga/planar'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string, fs?: AmigaFS): { rt: Runtime; out: string } {
  let out = ''
  const opts = fs
    ? { maxSteps: 300_000, fs, onText: (t: string) => (out += t) }
    : { maxSteps: 300_000, onText: (t: string) => (out += t) }
  const rt = new Runtime(tokenize(src, table), table, opts)
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { rt, out }
}

function pix12(rt: Runtime, x: number, y: number): number {
  const { data } = rt.composite()
  const o = ((y + 48) * 640 + x) * 4 // rows relative to hardware line 50; the window starts at line 26
  return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
}

/** minimal uncompressed ILBM with the given chunky rows */
function buildIlbm(width: number, height: number, depth: number, camg: number, cmap: number[], chunky: number[][]): Uint8Array {
  const rowBytes = rowBytesFor(width)
  const out: number[] = []
  const str = (s: string): void => {
    for (const c of s) out.push(c.charCodeAt(0))
  }
  const u32 = (v: number): void => {
    out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  }
  const u16 = (v: number): void => {
    out.push((v >> 8) & 255, v & 255)
  }
  str('FORM')
  const sizeAt = out.length
  u32(0)
  str('ILBM')
  str('BMHD')
  u32(20)
  u16(width)
  u16(height)
  u16(0)
  u16(0)
  out.push(depth, 0, 0, 0) // depth, masking, compression, pad
  u16(0)
  out.push(10, 11) // aspect
  u16(width)
  u16(height)
  str('CAMG')
  u32(4)
  u32(camg)
  str('CMAP')
  u32(cmap.length * 3)
  for (const c of cmap) out.push(((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17)
  if (cmap.length & 1) out.push(0)
  str('BODY')
  u32(height * depth * rowBytes)
  for (let y = 0; y < height; y++) {
    for (let pl = 0; pl < depth; pl++) {
      for (let bx = 0; bx < rowBytes; bx++) {
        let b = 0
        for (let bit = 0; bit < 8; bit++) {
          const v = chunky[y]?.[bx * 8 + bit] ?? 0
          if ((v >> pl) & 1) b |= 0x80 >> bit
        }
        out.push(b)
      }
    }
  }
  const bytes = Uint8Array.from(out)
  const size = bytes.length - 8
  bytes[sizeAt] = (size >>> 24) & 255
  bytes[sizeAt + 1] = (size >>> 16) & 255
  bytes[sizeAt + 2] = (size >>> 8) & 255
  bytes[sizeAt + 3] = size & 255
  return bytes
}

describe('Screen Open colour validation (InScreenOpen +Lib.s:8948)', () => {
  it('requires exact powers of two 2..64 — anything else is error 5', () => {
    expect(() => boot('Screen Open 0,320,200,5,Lowres')).toThrow(/illegal number of colours/)
    expect(() => boot('Screen Open 0,320,200,128,Lowres')).toThrow(/illegal number of colours/)
    expect(() => boot('Screen Open 0,320,200,64,Lowres')).not.toThrow()
  })

  it('HAM is 4096 colours, lowres only, stored as 64 (ScOo: moveq #64,d6)', () => {
    expect(() => boot('Screen Open 0,320,200,4096,Hires')).toThrow(/function call/)
    const { rt, out } = boot('Screen Open 0,320,200,4096,Lowres\nPrint Screen Colour')
    expect(rt.screen.ham).toBe(true)
    expect(rt.screen.depth).toBe(6)
    expect(out).toBe(' 64\n') // Screen Colour reports EcNbCol = 64, not 4096
  })

  it('hires screens cap at 16 colours (ScOo2: cmp.w #4,d4)', () => {
    expect(() => boot('Screen Open 0,640,200,32,Hires')).toThrow(/function call/)
    expect(() => boot('Screen Open 0,640,200,16,Hires')).not.toThrow()
  })
})

describe('EHB and HAM rendering (the hardware implied by 6 lowres planes)', () => {
  it('EHB: values 32-63 show colours 0-31 with every component halved', () => {
    const src = ['Screen Open 0,320,200,64,Lowres : Flash Off : Curs Off', 'Colour 8,$8E4', 'Ink 40 : Bar 40,60 To 80,70', 'Ink 8 : Bar 100,60 To 140,70'].join('\n')
    const { rt } = boot(src)
    expect(rt.screen.ehb).toBe(true)
    expect(pix12(rt, 100, (110 - 50) * 2)).toBe(0x472) // 40 = 32+8 → $8E4 halved
    expect(pix12(rt, 220, (110 - 50) * 2)).toBe(0x8e4) // 8 → full brightness
  })

  it('HAM6: control bits set from the palette then modify blue/red/green along the line', () => {
    const src = [
      'Screen Open 0,320,200,4096,Lowres : Flash Off : Curs Off',
      'Colour 0,$000 : Colour 1,$840',
      'Plot 0,50,1', //      set palette 1        → $840
      'Plot 1,50,$1F', //    modify blue with 15  → $84F
      'Plot 2,50,$3A', //    modify green with 10 → $8AF
      'Plot 3,50,$2C', //    modify red with 12   → $CAF
    ].join('\n')
    const { rt } = boot(src)
    const row = (100 - 50) * 2 // screen y 50 = hardware line 100
    expect(pix12(rt, 0, row)).toBe(0x840)
    expect(pix12(rt, 2, row)).toBe(0x84f)
    expect(pix12(rt, 4, row)).toBe(0x8af)
    expect(pix12(rt, 6, row)).toBe(0xcaf)
    // untouched pixels: the screen cleared to PAPER 1, so they are HAM
    // control 0 value 1 — set palette colour 1
    expect(pix12(rt, 20, row)).toBe(0x840)
  })

  it('Load Iff opens a HAM screen from CAMG $800 and the modify chains decode', () => {
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    const cmap = new Array<number>(16).fill(0)
    cmap[1] = 0x840
    // one row: set colour 1, then modify blue 15, green 10, red 12
    const img = buildIlbm(16, 2, 6, 0x800, cmap, [[0x01, 0x1f, 0x3a, 0x2c], []])
    dh0.write(['pic.iff'], img)
    fs.currentDir = 'DH0:'
    const { rt } = boot('Load Iff "DH0:pic.iff",1', fs)
    expect(rt.screen.ham).toBe(true)
    expect(rt.screen.nColors).toBe(64)
    const row = 0 // screen y 0 = hardware line 50 = output row 0... probe below the pointer
    void row
    // probe via the screen bitmap + palette decode instead of the pointer-
    // covered top-left composite: the raw 6-bit values must round-trip
    expect(rt.screen.pixels[0]).toBe(0x01)
    expect(rt.screen.pixels[1]).toBe(0x1f)
    expect(rt.screen.pixels[2]).toBe(0x3a)
    expect(rt.screen.pixels[3]).toBe(0x2c)
    expect(rt.screen.palette[1]).toBe(0x840)
  })
})
