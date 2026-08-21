/**
 * Every string `./reqtools.ts` quotes, checked against the library it says it
 * read them out of.
 *
 * `src/ext/citations.test.ts` does this for the extension sources. This is
 * the same idea one layer down: a doc comment that names `$2f1a` is a claim
 * about a file, and a claim about a file can be run.
 *
 * The copy is `reqtools 38.1092 (21.9.93)`, 39,588 bytes, which the AMOS PD
 * Library CD ships three times. Two of the three are byte identical and the
 * third is 38.388, so the test names the path rather than trusting whichever
 * turns up first.
 *
 * Skipped where the corpus is not on this machine, which is CI.
 */
import { expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REQTOOLS_NAME, REQTOOLS_VSTRING, RT_TEXT } from './reqtools'
import { describeWith } from '../testing/fixture'

const PATH = resolve(
  process.cwd(),
  '..',
  'amos-files/sources/amos-pd-library-cd-1994/files/Library2.0/reqtools.library',
)

/**
 * Where the port says each string is, and the catalog id in front of it.
 *
 * A message is a UWORD id then the NUL-terminated default, so the id is the
 * two bytes BELOW the offset. The last six carry no id: they are plain
 * strings the library formats with, and `GetStr` never sees them.
 */
const CITED: Array<[keyof typeof RT_TEXT, number, number | null]> = [
  ['ok', 0x2d70, 1],
  ['cancel', 0x2f1a, 2],
  ['okBarCancel', 0x1702, 3],
  ['lastBarCancel', 0x1712, 0x64],
  ['request', 0x1722, 0x65],
  ['information', 0x172c, 0x66],
  ['minFmt', 0x1760, 0xc8],
  ['maxFmt', 0x173a, 0xc9],
  ['minMaxFmt', 0x1748, 0xca],
  ['tooSmall', 0x177c, 0xcb],
  ['tooBig', 0x178a, 0xcc],
  ['paletteColors', 0x8a8e, 0x12c],
  ['red', 0x8a3e, 0x12d],
  ['green', 0x8a46, 0x12e],
  ['blue', 0x8a50, 0x12f],
  ['copy', 0x8a5a, 0x130],
  ['swap', 0x8a62, 0x131],
  ['spread', 0x8a6a, 0x132],
  ['undo', 0x8a7c, 0x133],
  ['createDrawer', 0x2d78, 0x190],
  ['dirError', 0x2db2, 0x191],
  ['matchWinTitle', 0x2dd0, 0x192],
  ['drawer', 0x2de0, 0x193],
  ['assign', 0x2df0, 0x194],
  ['all', 0x2f30, 0x195],
  ['match', 0x2f38, 0x196],
  ['clear', 0x2f44, 0x197],
  ['volumes', 0x2f4e, 0x198],
  ['parent', 0x2f5a, 0x199],
  ['pattern', 0x2faa, 0x19a],
  ['get', 0x2fc0, 0x19b],
  ['dotInfo', 0x2fb6, 0x19c],
  ['selected', 0x2f24, 0x19d],
  ['full', 0x2dfa, 0x19e],
  ['couldntOpenFont', 0x2e52, 0x1f4],
  ['bold', 0x2f64, 0x1f5],
  ['italic', 0x2f6c, 0x1f6],
  ['underline', 0x2f76, 0x1f7],
  ['dashInterlaced', 0x2ed0, 0x258],
  ['dashHam', 0x2ec0, 0x259],
  ['dashEhb', 0x2ec8, 0x25a],
  ['regularSize', 0x2ede, 0x25b],
  ['textSize', 0x2eee, 0x25c],
  ['gfxSize', 0x2efa, 0x25d],
  ['maxSize', 0x2f0a, 0x25e],
  ['overscan', 0x2f84, 0x25f],
  ['width', 0x2f92, 0x260],
  ['height', 0x2fc8, 0x261],
  ['default', 0x2fa0, 0x262],
  ['colors', 0x2fd6, 0x263],
  ['max', 0x2fe2, 0x264],
  ['autoScroll', 0x2fea, 0x265],
  ['fontSample', 0x2e16, null],
  ['fontsAssign', 0x2dc4, null],
  ['anyPattern', 0x2dca, null],
  ['entrySizeFmt', 0x2de8, null],
  ['nameFmt', 0x2e06, null],
  ['selectedFmt', 0x2e10, null],
  ['modeFmt', 0x2eb2, null],
  ['sliderFmt', 0x8aa0, null],
]

const lib = existsSync(PATH) ? readFileSync(PATH) : null

describeWith('reqtools 38.1092, the binary itself', lib, (b) => {
  const at = (off: number, len: number): string => b.subarray(off, off + len).toString('latin1')

  it('is the copy this port read', () => {
    expect(b.length).toBe(39588)
    expect(at(0x2c, REQTOOLS_NAME.length)).toBe(REQTOOLS_NAME)
    expect(at(0x3d, REQTOOLS_VSTRING.length)).toBe(REQTOOLS_VSTRING)
  })

  it.each(CITED)('carries %s at its cited offset', (key, off, id) => {
    const want = RT_TEXT[key]
    expect(at(off, want.length)).toBe(want)
    // NUL-terminated, which is what makes the offset the whole string
    expect(b[off + want.length]).toBe(0)
    if (id !== null) expect(b.readUInt16BE(off - 2)).toBe(id)
  })

  it('does not have the three palette titles the later sources added', () => {
    // catalog.h in the 38.1436 sources defines ids $134 to $136 as
    // "Copy to...", "Swap with..." and "Spread to...". None of them is in
    // 38.1092: its palette requester runs Copy, Swap and Spread off a plain
    // title instead, which is why the port has no field for them
    for (const s of ['Copy to...', 'Swap with...', 'Spread to...']) {
      expect(b.includes(Buffer.from(s, 'latin1'))).toBe(false)
    }
  })

  it('pads three messages the later sources trimmed', () => {
    // 38.1436 spells these "_Width:", "_Height:" and "_AutoScroll:". 38.1092
    // pads them so the screenmode requester's labels end in a column, and the
    // binary is what this port follows
    expect(RT_TEXT.width).toBe('_Width   :')
    expect(RT_TEXT.height).toBe('_Height  :')
    expect(RT_TEXT.autoScroll).toBe('_AutoScroll :')
    expect(b.includes(Buffer.from('_Width:', 'latin1'))).toBe(false)
  })
})
