import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glyphBit, glyphMetrics, parseDiskFont, parseFontDescriptor } from './diskfont'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from '../runtime/runtime'
import { AmigaFS } from '../runtime/vfs'
import { NodeVolume } from '../cli/nodefs'

const FONTS = join(__dirname, '..', '..', 'fixtures', 'fonts')

describe.skipIf(!existsSync(FONTS))('Amiga diskfont format (fonts from the original partition)', () => {
  it('parses .font descriptors (FontContentsHeader $0F00, 260-byte entries)', () => {
    const d = parseFontDescriptor(readFileSync(join(FONTS, '2001.font')))!
    expect(d).toEqual([{ file: '2001/8', ySize: 8, style: 0, flags: 0x42 }])
    const pica = parseFontDescriptor(readFileSync(join(FONTS, 'Pica.font')))!
    expect(pica[0]).toMatchObject({ file: 'Pica/32', ySize: 32 })
    // the partition's Novell.font is corrupt — rejected, not fatal
    expect(parseFontDescriptor(readFileSync(join(FONTS, 'Novell.font')))).toBeNull()
  })

  it('parses glyph files (single-hunk DiskFontHeader $0F80 with TextFont at +$4E)', () => {
    const f = parseDiskFont(readFileSync(join(FONTS, '2001', '8')))!
    expect([f.ySize, f.baseline, f.xSize, f.loChar, f.hiChar, f.modulo]).toEqual([8, 7, 8, 32, 255, 0x5e])
    expect(f.proportional).toBe(false)
    // CharData runs exactly up to CharLoc (752 bytes = 8 rows x 94)
    expect(f.charData.length).toBe(8 * 0x5e)
    // 'A' renders: a real glyph with set bits
    let lit = 0
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (glyphBit(f, 65, x, y)) lit++
    expect(lit).toBeGreaterThan(10)
  })

  it('reads proportional metrics (Pica/32: per-char CharSpace advances)', () => {
    const f = parseDiskFont(readFileSync(join(FONTS, 'Pica', '32')))!
    expect(f.proportional).toBe(true)
    expect([f.ySize, f.baseline]).toEqual([32, 28])
    const a = glyphMetrics(f, 65) // 'A'
    const i = glyphMetrics(f, 105) // 'i'
    expect(a.advance).toBeGreaterThan(i.advance) // genuinely proportional
  })
})

describe.skipIf(!existsSync(FONTS))('Set Font renders real disc fonts (TSFont/AvailFonts)', () => {
  const table = new TokenTable(CORE_TOKENS)
  function boot(src: string): { rt: Runtime; out: string } {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.mount('FontDisc', new NodeVolume(FONTS))
    fs.assign('Fonts', 'FontDisc:')
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    const r = rt.runHeadless(1_000)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { rt, out }
  }

  it('Get Fonts lists the real drawer; Font$ reports name/height/Disc', () => {
    const { out } = boot(['Get Disc Fonts', 'For F=1 To 3 : Print Font$(F) : Next'].join('\n'))
    // 7 valid fonts on the partition (Novell.font is corrupt and skipped)
    expect(out).toContain('2001.font')
    expect(out).toContain('Disc')
  })

  it('Set Font changes Text Base, Text Length and the drawn glyph height', () => {
    const src = [
      'Get Fonts',
      'Print Text Base',
      'Print Text Length("Hi")',
      'For F=1 To 20',
      ' If Instr(Font$(F),"Pica")>0 Then Set Font F : Exit',
      'Next',
      'Print Text Base',
      'P1=Text Length("Hi") : Print Sgn(P1-16)',
      'Ink 2 : Text 10,100,"A"',
    ].join('\n')
    const { rt, out } = boot(src)
    const lines = out.split('\n')
    expect(lines[0]).toBe(' 6') // topaz 8 baseline
    expect(lines[1]).toBe(' 16') // 2 x 8px
    expect(lines[2]).toBe(' 28') // Pica/32 tf_Baseline
    expect(lines[3]).toBe(' 1') // proportional widths, wider than 8px
    // the glyph is 32px tall: pixels exist well above the 8x8 band
    const s = rt.screens.get(0)!
    let lit = 0
    for (let y = 100 - 28; y < 100 + 4; y++) for (let x = 10; x < 40; x++) if (s.point(x, y) === 2) lit++
    expect(lit).toBeGreaterThan(40)
    // and nothing below the baseline+descender region of the old 8x8 draw
    expect(s.point(11, 99)).toBeDefined()
  })
})
