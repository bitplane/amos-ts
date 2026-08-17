/**
 * datatypes, against the descriptors it was generated from and against real
 * files out of the corpus.
 *
 * Two halves. The DECODE is checked by re-reading the `DEVS:DataTypes` files
 * and comparing with the generated table, so a change to either shows up as a
 * disagreement rather than as one of them quietly drifting. The MATCHING is
 * checked against corpus pictures, because a mask that decodes perfectly and
 * identifies nothing would pass the first half.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DTF, DTHD, GID, LVO, WILDCARD, candidates, maskMatches, obtainDataType, parseDescriptor } from './datatypes'
import { SHIPPED_DATATYPES } from './datatypes.gen'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf, describeWith } from '../testing/fixture'

const DESCRIPTORS = '../amos-files/sources/amos-pd-library-cd-1994/files/Devs/DataTypes'
const FD = '../amos-files/sources/ultimate-amiga-amos-factory/files/gui210/GUI2/Tools/FD/datatypes_lib.fd'

const byName = (n: string) => SHIPPED_DATATYPES.find((d) => d.name === n)!

describe('the jump table', () => {
  /**
   * `datatypesPrivate1` takes the first slot, so the public list starts one
   * step below the bias, and three more private slots before GetDTString put
   * it at -138. This test is what found the second of those: the constant
   * said -132, which is what counting two gaps instead of three gives you.
   */
  it('every LVO is the one datatypes_lib.fd gives it', () => {
    if (!haveCorpus()) return
    const text = readFileSync(FD, 'utf8')
    let at = 0
    const offsets = new Map<string, number>()
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (line.startsWith('##bias')) {
        at = Number(line.split(/\s+/)[1])
        continue
      }
      if (line === '' || line.startsWith('*') || line.startsWith('##')) continue
      const name = line.match(/^(\w+)\s*\(/)?.[1]
      if (name === undefined) continue
      offsets.set(name, -at)
      at += 6
    }
    expect(offsets.get('datatypesPrivate1'), 'the private slot is first').toBe(-30)
    for (const [name, lvo] of Object.entries(LVO)) expect(offsets.get(name), name).toBe(lvo)
  })
})

describeIf('the generated table against the files it came from', haveCorpus(), () => {
  function fromDisk() {
    const out = []
    for (const name of readdirSync(DESCRIPTORS).sort()) {
      const path = join(DESCRIPTORS, name)
      if (!statSync(path).isFile()) continue
      const dt = parseDescriptor(new Uint8Array(readFileSync(path)))
      if (dt !== null) out.push(dt)
    }
    return out
  }

  it('decodes to exactly what datatypes.gen.ts holds', () => {
    expect(fromDisk()).toEqual([...SHIPPED_DATATYPES])
  })

  /** the drawer has .info files and a licence beside the descriptors */
  it('ignores everything in the drawer that is not a FORM DTYP', () => {
    const all = readdirSync(DESCRIPTORS).filter((n) => statSync(join(DESCRIPTORS, n)).isFile())
    expect(all.length).toBeGreaterThan(SHIPPED_DATATYPES.length)
    expect(fromDisk().length).toBe(SHIPPED_DATATYPES.length)
  })
})

describe('the descriptors', () => {
  it('holds the four groups the shipped set uses, and no others', () => {
    expect([...new Set(SHIPPED_DATATYPES.map((d) => d.groupID))].sort()).toEqual([GID.DOCUMENT, GID.PICTURE, GID.SOUND, GID.TEXT].sort())
  })

  /**
   * The flag is about how the file is built, not how it is matched: the three
   * whose masks start `F O R M` are the three marked IFF.
   */
  it('marks the IFF ones IFF and the text one ASCII', () => {
    const iff = SHIPPED_DATATYPES.filter((d) => (d.flags & DTF.TYPE_MASK) === DTF.IFF)
    expect(iff.map((d) => d.name).sort()).toEqual(['8SVX', 'FTXT', 'ILBM'])
    for (const d of iff) expect(d.mask.slice(0, 4)).toEqual([0x46, 0x4f, 0x52, 0x4d])
    expect(byName('AmigaGuide').flags & DTF.TYPE_MASK).toBe(DTF.ASCII)
    expect(byName('GIF').flags & DTF.TYPE_MASK).toBe(DTF.BINARY)
  })

  it('reads ILBM exactly as its DTHD says', () => {
    const d = byName('ILBM')
    expect([d.groupID, d.id, d.baseName, d.pattern]).toEqual(['pict', 'ilbm', 'ilbm', '#?'])
    expect(d.mask).toEqual([0x46, 0x4f, 0x52, 0x4d, WILDCARD, WILDCARD, WILDCARD, WILDCARD, 0x49, 0x4c, 0x42, 0x4d])
  })

  /**
   * Two things the shipped set does that a tidier table would not, both kept.
   * GIF's id is three characters and a NUL; the two Windows descriptors share
   * one id and are told apart only by baseName.
   */
  it('keeps the id as four raw bytes, NUL and duplicate included', () => {
    expect(byName('GIF').id).toBe('gif\0')
    const wind = SHIPPED_DATATYPES.filter((d) => d.id === 'wind')
    expect(wind.map((d) => d.name)).toEqual(['Windows Bitmap', 'Windows Icon'])
    expect(wind.map((d) => d.baseName)).toEqual(['bmp', 'ico'])
  })

  it('every pointer resolved to something, and every mask has length', () => {
    for (const d of SHIPPED_DATATYPES) {
      expect(d.name.length, d.name).toBeGreaterThan(0)
      expect(d.baseName.length, d.name).toBeGreaterThan(0)
      expect(d.pattern.startsWith('#?'), d.name).toBe(true)
      expect(d.mask.length, d.name).toBeGreaterThan(0)
      expect(d.groupID.length).toBe(4)
      expect(d.id.length).toBe(4)
    }
    expect(DTHD.SIZEOF).toBe(32)
  })
})

describe('matching', () => {
  const ilbm = (form: string): Uint8Array => {
    const b = new Uint8Array(64)
    b.set([...'FORM'].map((c) => c.charCodeAt(0)), 0)
    b.set([...form].map((c) => c.charCodeAt(0)), 8)
    return b
  }

  it('identifies an IFF by its FORM type, skipping the length', () => {
    expect(obtainDataType(ilbm('ILBM'), SHIPPED_DATATYPES)?.id).toBe('ilbm')
    expect(obtainDataType(ilbm('8SVX'), SHIPPED_DATATYPES)?.id).toBe('8svx')
    expect(obtainDataType(ilbm('FTXT'), SHIPPED_DATATYPES)?.id).toBe('ftxt')
    // the four length bytes really are wildcards
    const odd = ilbm('ILBM')
    odd.set([0xde, 0xad, 0xbe, 0xef], 4)
    expect(obtainDataType(odd, SHIPPED_DATATYPES)?.id).toBe('ilbm')
  })

  it('takes both GIF versions, because the version byte is wild', () => {
    for (const v of ['87a', '89a']) {
      const b = new Uint8Array([...`GIF${v}`].map((c) => c.charCodeAt(0)))
      expect(obtainDataType(b, SHIPPED_DATATYPES)?.baseName).toBe('gif')
    }
    // but not GIF8?b
    const wrong = new Uint8Array([...'GIF89b'].map((c) => c.charCodeAt(0)))
    expect(obtainDataType(wrong, SHIPPED_DATATYPES)).toBeNull()
  })

  it('identifies a JPEG by its JFIF marker', () => {
    const b = new Uint8Array(32)
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], 0)
    expect(obtainDataType(b, SHIPPED_DATATYPES)?.id).toBe('jpeg')
  })

  it('answers null for something no descriptor claims', () => {
    expect(obtainDataType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), SHIPPED_DATATYPES)).toBeNull()
  })

  it('will not match data shorter than the mask', () => {
    expect(maskMatches(byName('ILBM'), new Uint8Array([0x46, 0x4f]))).toBe(false)
  })

  /**
   * MacPaint's whole mask is one $00 byte, so it matches any file starting
   * with a zero. Every shipped descriptor has priority 0, so nothing in the
   * data separates them and this port's longest-mask-wins is what does. The
   * note on obtainDataType says so in as many words; this pins the behaviour.
   */
  it('lets the longer mask win a tie, which is this port s rule and not Commodore s', () => {
    expect(byName('MacPaint').mask).toEqual([0])
    const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 9, 9])
    expect(candidates(ico, SHIPPED_DATATYPES).map((d) => d.baseName)).toEqual(['ico', 'macpaint'])
    expect(obtainDataType(ico, SHIPPED_DATATYPES)?.baseName).toBe('ico')
    // and a lone zero byte still finds MacPaint, since nothing else claims it
    expect(obtainDataType(new Uint8Array([0, 0xff, 0xff]), SHIPPED_DATATYPES)?.baseName).toBe('macpaint')
  })
})

/**
 * The half a synthetic mask cannot check: real files off the corpus, which
 * carry whatever their authors actually wrote rather than what this test
 * expects them to.
 */
describeWith(
  'real IFF pictures out of the corpus',
  haveCorpus() ? corpusIndex() : null,
  (index) => {
    const paths = [...index.values()].filter((p) => /\.(iff|lbm|ilbm)$/i.test(p)).slice(0, 40)

    it('identifies every one of them as pict/ilbm', () => {
      expect(paths.length).toBeGreaterThan(0)
      let seen = 0
      for (const p of paths) {
        const full = corpusFile([...index.entries()].find(([, v]) => v === p)![0], index)
        if (full === null) continue
        const head = new Uint8Array(readFileSync(full)).subarray(0, 64)
        const dt = obtainDataType(head, SHIPPED_DATATYPES)
        // an .iff that is not an ILBM is a real thing; what must not happen
        // is one being claimed by a descriptor from another group
        if (dt !== null) {
          expect(dt.groupID, p).toBe(GID.PICTURE)
          seen++
        }
      }
      expect(seen, 'at least some corpus .iff files should identify').toBeGreaterThan(0)
    })
  },
)
