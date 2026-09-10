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
import { DTA, DTF, DTHD, DTM, GID, LVO, PDTA, SDTA, TDTA, DataTypesService, WILDCARD, candidates, maskMatches, obtainDataType, parseDescriptor, releaseDataType } from './datatypes'
import { SHIPPED_DATATYPES } from './datatypes.gen'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf, describeWith } from '../testing/fixture'
import { MemPool } from './exec'
import { encodeIlbm, parseIlbm } from './ilbm'
import { BitMap, RastPort } from './graphics'
import { NullAudio } from './paula'
import { doMethodA } from './boopsi'

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

describe('datatype class objects', () => {
  const pool = (): MemPool => new MemPool(0x100000, 0x100000)

  it('owns decoded picture attributes and native class buffers', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const file = encodeIlbm({ width: 3, height: 2, depth: 2, mode: 0x8004,
      palette: [0x000, 0xf00, 0x0f0, 0x00f], pixels: Uint8Array.from([0, 1, 2, 3, 0, 1]) })
    const object = service.create('RAM:pic.iff', file, new Map())
    const attrs = service.objects.get(object)!.attributes
    expect(attrs.get(DTA.NominalHoriz)).toBe(3)
    expect(attrs.get(DTA.NominalVert)).toBe(2)
    expect(attrs.get(PDTA.ModeID)).toBe(0x8004)
    expect(attrs.get(PDTA.NumColors)).toBe(4)
    const header = attrs.get(PDTA.BitMapHeader)!
    expect(new DataView(memory.buffer.buffer).getUint16(header - memory.base)).toBe(3)
    expect(memory.buffer[attrs.get(PDTA.ColorRegisters)! - memory.base + 3]).toBe(255)
    const bitmap = attrs.get(PDTA.BitMap)!; const bitmapAt = bitmap - memory.base
    expect(memory.buffer[bitmapAt + 5]).toBe(2)
    expect(new DataView(memory.buffer.buffer).getUint16(bitmapAt)).toBe(2)
    const plane0 = new DataView(memory.buffer.buffer).getUint32(bitmapAt + 8)
    const plane1 = new DataView(memory.buffer.buffer).getUint32(bitmapAt + 12)
    expect([...memory.buffer.subarray(plane0 - memory.base, plane0 - memory.base + 4)]).toEqual([0x40, 0, 0xa0, 0])
    expect([...memory.buffer.subarray(plane1 - memory.base, plane1 - memory.base + 4)]).toEqual([0x20, 0, 0x80, 0])
    const frame = attrs.get(DTA.FrameInfo)! - memory.base
    expect([0, 4, 8, 12, 16, 20, 32].map(at => new DataView(memory.buffer.buffer).getUint32(frame + at)))
      .toEqual([0, 0x00010001, 0x04040400, 3, 2, 2, 6])
    expect(service.setAttrs(object, [{ tag: DTA.Width, data: 99 }], 12, 34)).toBe(1)
    expect(service.attr(object, DTA.Width)).toBe(99)
    expect(service.objects.get(object)).toMatchObject({ window: 12, requester: 34 })
    service.dispose(object)
    expect(memory.typeOfMem(header)).toBe(0)
  })

  it('advertises native picture methods, lays out and draws decoded pixels', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const file = encodeIlbm({ width: 3, height: 2, depth: 2, mode: 0,
      palette: [0x000, 0xf00, 0x0f0, 0x00f], pixels: Uint8Array.from([0, 1, 2, 3, 2, 1]) })
    const object = service.create('RAM:pic.iff', file, new Map())
    const methods = service.methodList(object); const dv = new DataView(memory.buffer.buffer)
    expect(Array.from({ length: 7 }, (_, i) => dv.getUint32(methods - memory.base + i * 4)))
      .toEqual([DTM.FrameBox, DTM.Select, DTM.ClearSelected, DTM.Copy, DTM.Print, DTM.Write, 0xffffffff])
    expect(doMethodA(service.objects.get(object)!.object, { MethodID: DTM.ProcLayout })).toBe(1)
    expect(service.objects.get(object)!.attributes.get(DTA.Methods)).toBe(methods)
    const rp = new RastPort(new BitMap(4, 3, 2, 2))
    expect(service.draw(object, rp, 1, 1, 2, 2, 1, 0)).toBe(true)
    expect([rp.point(1, 1), rp.point(2, 1), rp.point(1, 2), rp.point(2, 2)]).toEqual([1, 2, 2, 1])
  })

  it('derives visible units and clamps scrolling during layout', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const file = encodeIlbm({ width: 8, height: 6, depth: 1, mode: 0,
      palette: [0, 0xfff], pixels: new Uint8Array(48) })
    const object = service.create('RAM:pic.iff', file, new Map([[DTA.Width, 3], [DTA.Height, 2], [DTA.TopHoriz, 99], [DTA.TopVert, 4]]))
    expect(service.layout(object)).toBe(true)
    const attrs = service.objects.get(object)!.attributes
    expect([attrs.get(DTA.VisibleHoriz), attrs.get(DTA.VisibleVert), attrs.get(DTA.TopHoriz), attrs.get(DTA.TopVert)])
      .toEqual([3, 2, 5, 4])
  })

  it('answers the native FrameInfo shape for picture and document classes', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const picture = service.create('RAM:pic.iff', encodeIlbm({ width: 8, height: 6, depth: 2, mode: 0,
      palette: [0, 0x111, 0x222, 0x333], pixels: new Uint8Array(48) }), new Map())
    const pv = new DataView(service.frameBox(picture)!.buffer)
    expect([pv.getUint32(12), pv.getUint32(16), pv.getUint32(20), pv.getUint32(32)]).toEqual([8, 6, 2, 6])
    const guide = service.create('RAM:a.guide', Buffer.from('@database a\n@node main\nhello\n@endnode'), new Map())
    const gv = new DataView(service.frameBox(guide)!.buffer)
    expect([gv.getUint32(16), gv.getUint32(20), gv.getUint32(32)]).toEqual([1, 0, 2])
  })

  it('owns decoded 8SVX sample attributes', () => {
    const memory = pool(); const audio = new NullAudio(); const service = new DataTypesService(memory, SHIPPED_DATATYPES, () => audio)
    const id = (s: string): number[] => [...s].map(c => c.charCodeAt(0))
    const be = (n: number): number[] => [n >>> 24, n >>> 16, n >>> 8, n].map(v => v & 255)
    const chunk = (name: string, body: number[]): number[] => [...id(name), ...be(body.length), ...body]
    const body = [...chunk('VHDR', [...be(4), ...be(0), ...be(0), 0x1f, 0x40, 1, 0, ...be(0x10000)]), ...chunk('BODY', [1, 2, 3, 4])]
    const file = Uint8Array.from([...id('FORM'), ...be(body.length + 4), ...id('8SVX'), ...body])
    const object = service.create('RAM:hit.8svx', file, new Map())
    const attrs = service.objects.get(object)!.attributes
    expect(attrs.get(SDTA.SampleLength)).toBe(4)
    expect(attrs.get(SDTA.Volume)).toBe(64)
    expect(attrs.get(SDTA.Period)).toBeGreaterThan(0)
    const sample = attrs.get(SDTA.Sample)!
    expect([...memory.buffer.subarray(sample - memory.base, sample - memory.base + 4)]).toEqual([1, 2, 3, 4])
    const triggers = service.methodList(object, true); const tv = new DataView(memory.buffer.buffer)
    expect([tv.getUint32(triggers - memory.base), tv.getUint32(triggers - memory.base + 8), tv.getUint32(triggers - memory.base + 12)])
      .toEqual([expect.any(Number), 2, 0])
    expect(service.trigger(object, 2)).toBe(true)
    expect(audio.events.at(-1)).toMatchObject({ kind: 'play', voice: 0, volume: 64, loop: false })
    expect(audio.events.at(-1)!.freq).toBeGreaterThanOrEqual(8000)
    expect(audio.events.at(-1)!.freq).toBeLessThan(8010)
    expect(service.trigger(object, 1)).toBe(false)
    service.dispose(object); expect(audio.events.at(-1)).toMatchObject({ kind: 'stop', voice: 0 })
  })

  it('uses the shared AmigaGuide document for DTM_GOTO node state', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const bytes = Buffer.from('@database Manual.guide\n@node MAIN Main\nStart\n@endnode\n@node other Other\nRead @{B}this@{UB}.\n@endnode', 'latin1')
    const object = service.create('RAM:Manual.guide', bytes, new Map())
    expect(object).not.toBe(0); expect(service.goTo(object, 'OTHER')).toBe(true)
    const attrs = service.objects.get(object)!.attributes
    const stringAt = (address: number): string => {
      let text = ''; for (let at = address - memory.base; memory.buffer[at] !== 0; at++) text += String.fromCharCode(memory.buffer[at]!)
      return text
    }
    const text = stringAt(attrs.get(TDTA.Buffer)!)
    expect(text).toContain('Read this.')
    expect(stringAt(attrs.get(DTA.NodeName)!)).toBe('other')
    const methods = service.methodList(object); const dv = new DataView(memory.buffer.buffer)
    expect(Array.from({ length: 8 }, (_, i) => dv.getUint32(methods - memory.base + i * 4)))
      .toEqual([DTM.ClearSelected, DTM.Print, DTM.Copy, DTM.GoTo, DTM.Trigger, DTM.RemoveDTObject, DTM.FrameBox, 0xffffffff])
    expect(String.fromCharCode(...service.copyBytes(object)!)).toContain('Read this.')
    expect(service.writeBytes(object, 1)).toEqual(Uint8Array.from(bytes))
    expect(service.writeBytes(object, 0)).toBeNull()
  })

  it('writes raw pictures exactly and converts their IFF representation through the shared encoder', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const source = encodeIlbm({ width: 2, height: 1, depth: 1, mode: 0, palette: [0, 0xfff], pixels: Uint8Array.from([0, 1]) })
    const object = service.create('RAM:p.iff', source, new Map())
    expect(service.writeBytes(object, 1)).toEqual(source)
    expect(parseIlbm(service.writeBytes(object, 0)!)).toMatchObject({ width: 2, height: 1, depth: 1 })
    expect(service.writeBytes(object, 99)).toBeNull()
  })

  it('draws and writes from the exposed native bitmap and palette rather than its decoded source', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const source = encodeIlbm({ width: 2, height: 1, depth: 1, mode: 0,
      palette: [0, 0xfff], pixels: Uint8Array.from([0, 1]) })
    const object = service.create('RAM:p.iff', source, new Map())
    const attrs = service.objects.get(object)!.attributes
    const bitmapAt = attrs.get(PDTA.BitMap)! - memory.base
    const plane = new DataView(memory.buffer.buffer).getUint32(bitmapAt + 8)
    memory.buffer[plane - memory.base] = 0xc0 // both pixels now use pen 1
    const registers = attrs.get(PDTA.ColorRegisters)! - memory.base
    memory.buffer.set([0x11, 0x22, 0x33], registers + 3)
    const rp = new RastPort(new BitMap(2, 1, 1, 2))
    expect(service.draw(object, rp, 0, 0, 0, 0)).toBe(true)
    expect([rp.point(0, 0), rp.point(1, 0)]).toEqual([1, 1])
    expect(parseIlbm(service.writeBytes(object, 0)!)).toMatchObject({ pixels: Uint8Array.from([1, 1]), palette: [0, 0x123] })
  })

  it('triggers from the exposed native sample, voice header and attributes', () => {
    const memory = pool(); const audio = new NullAudio(); const service = new DataTypesService(memory, SHIPPED_DATATYPES, () => audio)
    const id = (s: string): number[] => [...s].map(c => c.charCodeAt(0))
    const be = (n: number): number[] => [n >>> 24, n >>> 16, n >>> 8, n].map(v => v & 255)
    const chunk = (name: string, body: number[]): number[] => [...id(name), ...be(body.length), ...body]
    const body = [...chunk('VHDR', [...be(4), ...be(0), ...be(0), 0x1f, 0x40, 1, 0, ...be(0x10000)]), ...chunk('BODY', [1, 2, 3, 4])]
    const object = service.create('RAM:hit.8svx', Uint8Array.from([...id('FORM'), ...be(body.length + 4), ...id('8SVX'), ...body]), new Map())
    const attrs = service.objects.get(object)!.attributes
    memory.buffer[attrs.get(SDTA.Sample)! - memory.base] = 0xfe
    expect(service.setAttrs(object, [{ tag: SDTA.SampleLength, data: 2 }, { tag: SDTA.Period, data: 500 },
      { tag: SDTA.Volume, data: 17 }])).toBe(3)
    expect(service.trigger(object, 2)).toBe(true)
    expect(audio.events.at(-1)).toMatchObject({ length: 2, volume: 17 })
    expect(audio.events.at(-1)!.freq).toBeCloseTo(7093.79, 1)
    expect([...audio.voiceState[0]!.pcm!]).toEqual([-2, 2])
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

  it('releases shared descriptors without invalidating them', () => {
    const dt = obtainDataType(ilbm('ILBM'), SHIPPED_DATATYPES)
    releaseDataType(dt)
    expect(dt?.baseName).toBe('ilbm')
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
