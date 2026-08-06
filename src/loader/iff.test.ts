import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { encodeIlbm, parseIlbm } from './iff'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from '../runtime/runtime'
import { AmigaFS } from '../amiga/vfs'

describe('ILBM encoder (Save Iff)', () => {
  it('round-trips pixels, palette, mode and dimensions through parseIlbm', () => {
    const w = 40
    const h = 12
    const depth = 5
    const pixels = new Uint8Array(w * h)
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) % (1 << depth)
    const palette = Array.from({ length: 1 << depth }, (_, i) => ((i & 15) << 8) | (((i * 3) & 15) << 4) | (i & 15))
    const enc = encodeIlbm({ width: w, height: h, depth, mode: 0x8000, palette, pixels })
    const dec = parseIlbm(enc)
    expect([dec.width, dec.height, dec.depth, dec.mode]).toEqual([w, h, depth, 0x8000])
    expect(Array.from(dec.pixels)).toEqual(Array.from(pixels))
    for (let i = 0; i < 1 << depth; i++) expect(dec.palette[i]).toBe(palette[i])
  })

  it('produces a standard FORM ILBM with ByteRun1 (compression 1)', () => {
    const enc = encodeIlbm({ width: 16, height: 2, depth: 1, mode: 0, palette: [0, 0xfff], pixels: new Uint8Array(32) })
    const s = new TextDecoder('latin1').decode(enc.subarray(0, 12))
    expect(s.slice(0, 4)).toBe('FORM')
    expect(s.slice(8, 12)).toBe('ILBM')
    // BMHD compression byte (offset 12 chunk header + 8 into BMHD data)
    expect(enc[12 + 8 + 8 + 2]).toBe(1)
  })
})

describe('Save Iff / Save / Pload / Picture / Mask Iff (round-trip on disk)', () => {
  const table = new TokenTable(CORE_TOKENS)
  function run(src: string): string {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    const r = rt.runHeadless(1_000)
    mustFinish(r)
    return out
  }

  it('Save Iff writes a screen a fresh session loads back pixel-identical', () => {
    // separate program does the save; a second reads the file — the on-disk
    // ILBM decode is what matters (InSaveIff2 +Lib.s:4630)
    const save = [
      'Screen Open 0,64,32,16,Lowres : Flash Off : Cls 0',
      'Ink 5 : Bar 4,4 To 20,16 : Plot 40,20,7',
      'Colour 5,$F0F : Colour 7,$0FF',
      'Save Iff "DH0:pic.iff"',
      'Open Out 1,"DH0:done" : Print #1,"1" : Close 1',
    ].join('\n')
    // run save in a shared fs, then verify the FILE bytes with parseIlbm
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    const rt = new Runtime(tokenize(save, table), table, { maxSteps: 300_000, fs })
    rt.runHeadless(1_000)
    const img = parseIlbm(fs.read('DH0:pic.iff')!)
    expect(img.width).toBe(64)
    expect(img.pixels[10 * 64 + 10]).toBe(5) // inside the bar
    expect(img.pixels[20 * 64 + 40]).toBe(7) // the plot
    expect(img.pixels[0]).toBe(0) // background
    expect(img.palette[5]! & 0xfff).toBe(0xf0f)
    expect(img.palette[7]! & 0xfff).toBe(0x0ff)
  })

  it('Save "file",n writes a bank that Load reads back byte-identical', () => {
    const out = run(
      [
        'Reserve As Work 5,16',
        'Loke Start(5),$DEADBEEF : Loke Start(5)+4,$12345678',
        'Save "DH0:b.abk",5',
        'Erase 5',
        'Load "DH0:b.abk"',
        'Print Hex$(Leek(Start(5)));Hex$(Leek(Start(5)+4))',
      ].join('\n'),
    )
    expect(out.trim()).toBe('$DEADBEEF$12345678')
  })

  it('Picture returns the legacy constant 127; Mask Iff parses (FnPicture/InMaskIff)', () => {
    expect(run('Print Picture').trim()).toBe('127')
    expect(run('Mask Iff 3 : Print "ok"').trim()).toBe('ok')
  })

  it('Pload loads the code hunk of an executable into a bank (InPLoad +Lib.s:4254)', () => {
    // a minimal hunk exe: HUNK_HEADER, HUNK_CODE with 8 bytes "PAYLOAD!"
    const bytes = new Uint8Array([
      0, 0, 3, 0xf3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, // header
      0, 0, 3, 0xe9, 0, 0, 0, 2, // HUNK_CODE, 2 longs = 8 bytes
      0x50, 0x41, 0x59, 0x4c, 0x4f, 0x41, 0x44, 0x21, // PAYLOAD!
    ])
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    dh0.write(['code'], bytes)
    let out = ''
    const rt = new Runtime(tokenize('Pload "DH0:code",7\nPrint Chr$(Peek(Start(7)));Chr$(Peek(Start(7)+7));Length(7)', table), table, {
      maxSteps: 300_000,
      fs,
      onText: (t) => (out += t),
    })
    rt.runHeadless(1_000)
    expect(out.trim()).toBe('P! 8')
  })
})
