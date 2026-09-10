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
import { DTA, DTF, DTHD, DTM, GID, LVO, PDTA, SDTA, TDTA, DataTypesService, WILDCARD, candidates, dataTypeString, maskMatches, obtainDataType, parseDescriptor, releaseDataType } from './datatypes'
import { SHIPPED_DATATYPES } from './datatypes.gen'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf, describeWith } from '../testing/fixture'
import { MemPool } from './exec'
import { encodeIlbm, parseIlbm } from './ilbm'
import { encodeJpeg } from './jpeg'
import { BitMap, RastPort } from './graphics'
import { NullAudio } from './paula'
import type { PrinterPage } from './host'
import { GA, doMethodA } from './boopsi'

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
    expect(attrs.get(PDTA.GRegs)).not.toBe(attrs.get(PDTA.CRegs))
    expect([...memory.buffer.subarray(attrs.get(PDTA.ColorTable)! - memory.base,
      attrs.get(PDTA.ColorTable)! - memory.base + 4)]).toEqual([0, 1, 2, 3])
    expect(attrs.get(PDTA.DestBitMap)).toBe(attrs.get(PDTA.BitMap))
    expect(attrs.get(PDTA.ClassBitMap)).toBe(attrs.get(PDTA.BitMap))
    expect([PDTA.Allocated, PDTA.NumAlloc, PDTA.Screen, PDTA.FreeSourceBitMap, PDTA.NumSparse, PDTA.SparseTable]
      .map(tag => attrs.get(tag))).toEqual([0, 0, 0, 0, 0, 0])
    expect(attrs.get(PDTA.Remap)).toBe(1)
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
    expect(service.setAttrs(object, [{ tag: GA.Width, data: 99 }], 12, 34)).toBe(1)
    expect(service.attr(object, GA.Width)).toBe(99)
    expect(service.objects.get(object)).toMatchObject({ window: 12, requester: 34 })
    service.dispose(object)
    expect(memory.typeOfMem(header)).toBe(0)
  })

  it('shares a complete native DataType descriptor between obtain and DTA_DataType', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const file = encodeIlbm({ width: 1, height: 1, depth: 1, mode: 0, palette: [0, 0xfff], pixels: Uint8Array.of(1) })
    const descriptor = service.obtain(file); const again = service.obtain(file)
    expect(descriptor).toBe(again)
    const object = service.create('RAM:pic.iff', file, new Map())
    expect(service.attr(object, DTA.DataType)).toBe(descriptor)
    expect(service.attr(object, DTA.Data)).toBe(object)
    expect(service.attr(object, DTA.SourceType)).toBe(2)
    const dv = new DataView(memory.buffer.buffer)
    const header = dv.getUint32(descriptor - memory.base + 28)
    expect(dv.getUint32(descriptor - memory.base + 54)).toBe(58)
    expect(dv.getUint32(header - memory.base + DTHD.GroupID)).toBe(0x70696374)
    expect(dv.getUint32(header - memory.base + DTHD.ID)).toBe(0x696c626d)
    expect(dv.getUint16(header - memory.base + DTHD.MaskLen)).toBe(byName('ILBM').mask.length)
    const mask = dv.getUint32(header - memory.base + DTHD.Mask)
    expect([0, 1, 2, 3].map(i => dv.getUint16(mask - memory.base + i * 2))).toEqual([0x46, 0x4f, 0x52, 0x4d])
    service.release(descriptor)
    expect(memory.typeOfMem(descriptor)).not.toBe(0)
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
    const refreshed = new RastPort(new BitMap(3, 2, 2, 2))
    expect(service.refresh(object, [{ tag: DTA.TopHoriz, data: 0 }], 123, 0, refreshed)).toBe(true)
    expect([refreshed.point(0, 0), refreshed.point(1, 0), refreshed.point(2, 0)]).toEqual([0, 1, 2])
    expect(service.refresh(object, [], 0, 0, refreshed)).toBe(false)
  })

  it('derives visible units and clamps scrolling during layout', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const file = encodeIlbm({ width: 8, height: 6, depth: 1, mode: 0,
      palette: [0, 0xfff], pixels: new Uint8Array(48) })
    const object = service.create('RAM:pic.iff', file, new Map([[GA.Width, 3], [GA.Height, 2], [DTA.TopHoriz, 99], [DTA.TopVert, 4]]))
    expect(service.layout(object)).toBe(true)
    const attrs = service.objects.get(object)!.attributes
    expect([attrs.get(DTA.VisibleHoriz), attrs.get(DTA.VisibleVert), attrs.get(DTA.TopHoriz), attrs.get(DTA.TopVert)])
      .toEqual([3, 2, 5, 4])
    const domain = attrs.get(DTA.Domain)!; const dv = new DataView(memory.buffer.buffer)
    expect([dv.getInt16(domain - memory.base + 4), dv.getInt16(domain - memory.base + 6)]).toEqual([3, 2])
    expect(service.setAttrs(object, [{ tag: DTA.TotalHoriz, data: 4 }, { tag: DTA.TopHoriz, data: 99 },
      { tag: GA.Width, data: 7 }])).toBe(3)
    expect(attrs.get(DTA.TopHoriz)).toBe(1)
    expect(dv.getInt16(domain - memory.base + 4)).toBe(7)
  })

  it('answers the native FrameInfo shape for picture and document classes', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const picture = service.create('RAM:pic.iff', encodeIlbm({ width: 8, height: 6, depth: 2, mode: 0,
      palette: [0, 0x111, 0x222, 0x333], pixels: new Uint8Array(48) }), new Map())
    const pv = new DataView(service.frameBox(picture)!.buffer)
    expect([pv.getUint32(12), pv.getUint32(16), pv.getUint32(20), pv.getUint32(32)]).toEqual([8, 6, 2, 6])
    const guide = service.create('RAM:a.guide', Buffer.from('@database a\n@node main\nhello\n@endnode'), new Map())
    const gv = new DataView(service.frameBox(guide)!.buffer)
    expect([gv.getUint32(16), gv.getUint32(20), gv.getUint32(32)]).toEqual([8, 0, 2])
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
    const bytes = Buffer.from('@database Manual.guide\n@author Fred\n@version 2.1\n@node MAIN Main\nStart\n@endnode\n@node other Other\nRead @{B}this@{UB}.\n@endnode', 'latin1')
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
    expect(stringAt(attrs.get(DTA.ObjName)!)).toBe('Manual.guide')
    expect(stringAt(attrs.get(DTA.ObjAuthor)!)).toBe('Fred')
    expect(stringAt(attrs.get(DTA.ObjVersion)!)).toBe('2.1')
    const methods = service.methodList(object); const dv = new DataView(memory.buffer.buffer)
    expect(Array.from({ length: 8 }, (_, i) => dv.getUint32(methods - memory.base + i * 4)))
      .toEqual([DTM.ClearSelected, DTM.Print, DTM.Copy, DTM.GoTo, DTM.Trigger, DTM.RemoveDTObject, DTM.FrameBox, 0xffffffff])
    expect(String.fromCharCode(...service.copyBytes(object)!)).toContain('Read this.')
    const rp = new RastPort(new BitMap(96, 16, 2, 12))
    expect(service.refresh(object, [], 1, 0, rp)).toBe(true)
    expect(rp.cpX).toBe(40)
    attrs.set(TDTA.BufferLen, 4)
    expect(service.refresh(object, [], 1, 0, rp)).toBe(true)
    expect(rp.cpX).toBe(32)
    expect(service.writeBytes(object, 1)).toEqual(Uint8Array.from(bytes))
    expect(service.writeBytes(object, 0)).toBeNull()
  })

  it('implements AmigaGuide navigation triggers and retrace history', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const bytes = Buffer.from('@database Manual.guide\n@node MAIN Main\n@toc contents\n@help help\nStart\n@endnode\n' +
      '@node contents Contents\n@next other\nContents @{Other LINK other}\n@endnode\n@node other Other\nOther\n@endnode\n' +
      '@node index Index\nIndex\n@endnode\n@node help Help\nHelp\n@endnode', 'latin1')
    const object = service.create('RAM:Manual.guide', bytes, new Map())
    const node = (): string => service.objects.get(object)!.guideNode
    expect(service.trigger(object, 3)).toBe(true); expect(node()).toBe('contents')
    expect(service.trigger(object, 7)).toBe(true); expect(node()).toBe('other')
    expect(service.trigger(object, 5)).toBe(true); expect(node()).toBe('contents')
    expect(service.trigger(object, 8)).toBe(true)
    expect(service.trigger(object, 10)).toBe(true); expect(node()).toBe('other')
    expect(service.trigger(object, 5)).toBe(true); expect(node()).toBe('contents')
    expect(service.trigger(object, 17)).toBe(true); expect(node()).toBe('help')
    expect(service.trigger(object, 4)).toBe(true); expect(node()).toBe('index')
    expect(service.trigger(object, 0x0003000b, 'LINK other')).toBe(true); expect(node()).toBe('other')
    expect(service.trigger(object, 11, 'SYSTEM nope')).toBe(false)
  })

  it('routes AmigaGuide SYSTEM commands through the shared process seam', () => {
    const memory = pool(); let command = ''
    const service = new DataTypesService(memory, SHIPPED_DATATYPES, () => null, undefined,
      () => null, () => null, () => value => { command = value; return true })
    const object = service.create('RAM:a.guide', Buffer.from('@database a\n@node main\nhello\n@endnode'), new Map())
    expect(service.trigger(object, 0x0003000b, 'SYSTEM C:List RAM:')).toBe(true)
    expect(command).toBe('C:List RAM:')
  })

  it('prints text and pictures through the shared host backends', () => {
    const memory = pool(); let text = ''; const pages: PrinterPage[] = []
    const service = new DataTypesService(memory, SHIPPED_DATATYPES, () => null, undefined,
      () => value => { text += value }, () => page => pages.push(page))
    const guide = service.create('RAM:a.guide', Buffer.from('@database a\n@node main\nhello\n@endnode'), new Map())
    expect(service.doMethod(guide, { MethodID: DTM.Print })).toBe(1); expect(text).toContain('hello')
    const picture = service.create('RAM:p.iff', encodeIlbm({ width: 2, height: 1, depth: 1, mode: 0,
      palette: [0, 0xf00], pixels: Uint8Array.from([0, 1]) }), new Map())
    expect(service.doMethod(picture, { MethodID: DTM.Print,
      printAttrs: new Map([[DTA.DestCols, 320], [DTA.DestRows, 200], [DTA.Special, 0x44]]) })).toBe(1)
    expect(pages[0]).toMatchObject({ width: 2, height: 1, srcX: 0, srcY: 0,
      destCols: 320, destRows: 200, special: 0x44 })
    expect([...pages[0]!.pixels]).toEqual([0, 0, 0, 255, 255, 0, 0, 255])
  })

  it('maps the native text.datatype Line list from the authoritative buffer', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const id = (text: string): number[] => [...text].map(char => char.charCodeAt(0))
    const be = (value: number): number[] => [value >>> 24, value >>> 16, value >>> 8, value].map(byte => byte & 255)
    const chars = [...id('CHRS'), ...be(7), ...Buffer.from('one\ntwo', 'latin1'), 0]
    const file = Uint8Array.from([...id('FORM'), ...be(chars.length + 4), ...id('FTXT'), ...chars])
    const object = service.create('RAM:t.ftxt', file, new Map())
    const attrs = service.objects.get(object)!.attributes; const list = attrs.get(TDTA.LineList)!
    const view = new DataView(memory.buffer.buffer); const first = view.getUint32(list - memory.base)
    const second = view.getUint32(first - memory.base)
    expect(view.getUint32(first - memory.base + 12)).toBe(3)
    expect(view.getUint32(second - memory.base + 12)).toBe(3)
    expect(view.getUint16(first - memory.base + 24)).toBe(1)
    expect(view.getUint32(second - memory.base)).toBe(list + 4)
    expect(view.getUint32(second - memory.base + 4)).toBe(first)
  })

  it('copies and clears a text selection while drawing the complete buffer', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const id = (text: string): number[] => [...text].map(char => char.charCodeAt(0))
    const be = (value: number): number[] => [value >>> 24, value >>> 16, value >>> 8, value].map(byte => byte & 255)
    const chars = [...id('CHRS'), ...be(8), ...Buffer.from('one\nfour', 'latin1')]
    const file = Uint8Array.from([...id('FORM'), ...be(chars.length + 4), ...id('FTXT'), ...chars])
    const object = service.create('RAM:t.ftxt', file, new Map())
    expect(service.select(object, { minX: 8, minY: 0, maxX: 15, maxY: 15 })).toBe(true)
    expect(String.fromCharCode(...service.copyBytes(object)!)).toBe('ne\nfo')
    const rp = new RastPort(new BitMap(96, 24, 2, 12))
    expect(service.refresh(object, [], 1, 0, rp)).toBe(true); expect(rp.cpX).toBe(32)
    expect(service.clearSelected(object)).toBe(true)
    expect(String.fromCharCode(...service.copyBytes(object)!)).toBe('one\nfour')
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

  it('selects a native picture rectangle and copies only that region', () => {
    const memory = pool(); const service = new DataTypesService(memory, SHIPPED_DATATYPES)
    const source = encodeIlbm({ width: 3, height: 2, depth: 2, mode: 0, palette: [0, 0x111, 0x222, 0x333],
      pixels: Uint8Array.from([0, 1, 2, 3, 2, 1]) })
    const object = service.create('RAM:p.iff', source, new Map())
    expect(service.doMethod(object, { MethodID: DTM.Select, select: { minX: 2, minY: 1, maxX: 1, maxY: 0 } })).toBe(1)
    const box = service.attr(object, DTA.SelectDomain)!; const bv = new DataView(memory.buffer.buffer, box - memory.base, 8)
    expect([bv.getInt16(0), bv.getInt16(2), bv.getInt16(4), bv.getInt16(6)]).toEqual([1, 0, 2, 2])
    expect(parseIlbm(service.copyBytes(object)!)).toMatchObject({ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 2, 1]) })
    expect(service.doMethod(object, { MethodID: DTM.ClearSelected })).toBe(1)
    expect(service.attr(object, DTA.SelectDomain)).toBe(0)
    const callerBox = memory.alloc(8, { clear: true }); const caller = new DataView(memory.buffer.buffer, callerBox - memory.base, 8)
    caller.setInt16(0, 1); caller.setInt16(2, 0); caller.setInt16(4, 2); caller.setInt16(6, 1)
    expect(service.setAttrs(object, [{ tag: DTA.SelectDomain, data: callerBox }])).toBe(1)
    expect(service.attr(object, DTA.SelectDomain)).not.toBe(callerBox)
    caller.setInt16(0, 0)
    expect(parseIlbm(service.copyBytes(object)!)).toMatchObject({ width: 2, height: 1, pixels: Uint8Array.from([1, 2]) })
  })

  it('triggers from the exposed native sample, voice header and attributes', () => {
    const memory = pool(); const audio = new NullAudio(); const service = new DataTypesService(memory, SHIPPED_DATATYPES, () => audio)
    const id = (s: string): number[] => [...s].map(c => c.charCodeAt(0))
    const be = (n: number): number[] => [n >>> 24, n >>> 16, n >>> 8, n].map(v => v & 255)
    const chunk = (name: string, body: number[]): number[] => [...id(name), ...be(body.length), ...body]
    const body = [...chunk('VHDR', [...be(4), ...be(0), ...be(0), 0x1f, 0x40, 1, 0, ...be(0x10000)]), ...chunk('BODY', [1, 2, 3, 4])]
    const object = service.create('RAM:hit.8svx', Uint8Array.from([...id('FORM'), ...be(body.length + 4), ...id('8SVX'), ...body]), new Map())
    const attrs = service.objects.get(object)!.attributes
    expect([attrs.get(DTA.NominalHoriz), attrs.get(DTA.NominalVert)]).toEqual([54, 24])
    const icon = new RastPort(new BitMap(54, 24, 2, 8))
    expect(service.refresh(object, [], 1, 0, icon)).toBe(true)
    expect(icon.bitMap.pixels.some(pen => pen !== 0)).toBe(true)
    memory.buffer[attrs.get(SDTA.Sample)! - memory.base] = 0xfe
    expect(service.setAttrs(object, [{ tag: SDTA.SampleLength, data: 2 }, { tag: SDTA.Period, data: 500 },
      { tag: SDTA.Volume, data: 17 }])).toBe(3)
    expect(service.trigger(object, 2)).toBe(true)
    expect(audio.events.at(-1)).toMatchObject({ length: 2, volume: 17 })
    expect(audio.events.at(-1)!.freq).toBeCloseTo(7093.79, 1)
    expect([...audio.voiceState[0]!.pcm!]).toEqual([-2, 2])
    expect(service.setAttrs(object, [{ tag: SDTA.Volume, data: 99 }, { tag: SDTA.Period, data: 400 }])).toBe(2)
    expect(audio.voiceState[0]!.volume).toBe(64)
    expect(service.attr(object, SDTA.Volume)).toBe(64)
    expect(audio.voiceState[0]!.freq).toBeCloseTo(8867.24, 1)
    expect(service.setAttrs(object, [{ tag: SDTA.SampleLength, data: 0 }])).toBe(1)
    expect(audio.voiceState[0]!.playing).toBe(false)
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
  const id = (text: string): number[] => [...text].map(char => char.charCodeAt(0))
  const be = (value: number): number[] => [value >>> 24, value >>> 16, value >>> 8, value].map(byte => byte & 255)
  const chunk = (name: string, body: number[]): number[] => [...id(name), ...be(body.length), ...body, ...(body.length & 1 ? [0] : [])]
  const form = (kind: string, body: number[]): Uint8Array => Uint8Array.from([...id('FORM'), ...be(body.length + 4), ...id(kind), ...body])
  const ilbm = (): Uint8Array => encodeIlbm({ width: 1, height: 1, depth: 1, mode: 0,
    palette: [0, 0xfff], pixels: Uint8Array.of(1) })
  const svx = (): Uint8Array => form('8SVX', [...chunk('VHDR', [...be(1), ...be(0), ...be(0), 0x1f, 0x40, 1, 0, ...be(0x10000)]),
    ...chunk('BODY', [1])])
  const ftxt = (): Uint8Array => form('FTXT', chunk('CHRS', id('hello')))

  it('identifies an IFF by its FORM type, skipping the length', () => {
    expect(obtainDataType(ilbm(), SHIPPED_DATATYPES)?.id).toBe('ilbm')
    expect(obtainDataType(svx(), SHIPPED_DATATYPES)?.id).toBe('8svx')
    expect(obtainDataType(ftxt(), SHIPPED_DATATYPES)?.id).toBe('ftxt')
    // the four length bytes really are wildcards
    const odd = ilbm()
    odd.set([0xde, 0xad, 0xbe, 0xef], 4)
    expect(maskMatches(byName('ILBM'), odd)).toBe(true)
  })

  it('takes both GIF versions, because the version byte is wild', () => {
    for (const v of ['87a', '89a']) {
      const b = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQAOw==', 'base64'))
      b.set(id(v), 3)
      expect(obtainDataType(b, SHIPPED_DATATYPES)?.baseName).toBe('gif')
    }
    // but not GIF8?b
    const wrong = new Uint8Array([...'GIF89b'].map((c) => c.charCodeAt(0)))
    expect(obtainDataType(wrong, SHIPPED_DATATYPES)).toBeNull()
  })

  it('identifies a JPEG by its JFIF marker', () => {
    const b = encodeJpeg(new Uint8Array(8 * 8 * 3), 8, 8, { quality: 80 })
    expect(obtainDataType(b, SHIPPED_DATATYPES)?.id).toBe('jpeg')
  })

  it('answers null for something no descriptor claims', () => {
    expect(obtainDataType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), SHIPPED_DATATYPES)).toBeNull()
  })

  it('releases shared descriptors without invalidating them', () => {
    const dt = obtainDataType(ilbm(), SHIPPED_DATATYPES)
    releaseDataType(dt)
    expect(dt?.baseName).toBe('ilbm')
  })

  it('will not match data shorter than the mask', () => {
    expect(maskMatches(byName('ILBM'), new Uint8Array([0x46, 0x4f]))).toBe(false)
  })

  /**
   * MacPaint's whole mask is one $00 byte, so it also matches an ICO header.
   * The native walk tries its validation hook, rejects the structure, and
   * continues to the Windows Icon class.
   */
  it('uses concrete validation rather than an invented longest-mask tie break', () => {
    expect(byName('MacPaint').mask).toEqual([0])
    const ico = new Uint8Array(6 + 16 + 40 + 8 + 4 + 4); const view = new DataView(ico.buffer)
    view.setUint16(2, 1, true); view.setUint16(4, 1, true); ico.set([2, 1, 2, 0], 6)
    view.setUint16(10, 1, true); view.setUint16(12, 1, true); view.setUint32(14, ico.length - 22, true); view.setUint32(18, 22, true)
    view.setUint32(22, 40, true); view.setUint32(26, 2, true); view.setUint32(30, 2, true)
    view.setUint16(34, 1, true); view.setUint16(36, 1, true); view.setUint32(54, 2, true)
    ico.set([0, 0, 0, 0, 0xff, 0xff, 0xff, 0], 62); ico.set([0x40, 0, 0, 0], 70); ico.set([0x80, 0, 0, 0], 74)
    expect(candidates(ico, SHIPPED_DATATYPES).map((d) => d.baseName)).toEqual(['macpaint', 'ico'])
    expect(obtainDataType(ico, SHIPPED_DATATYPES)?.baseName).toBe('ico')
    expect(obtainDataType(new Uint8Array([0, 0xff, 0xff]), SHIPPED_DATATYPES)).toBeNull()
    const mac = new Uint8Array(512 + 405 * 2)
    for (let at = 512; at < mac.length; at += 2) mac.set([0x81, 0], at)
    expect(obtainDataType(mac, SHIPPED_DATATYPES)?.baseName).toBe('macpaint')
  })
})

describe('GetDTString', () => {
  it('uses the held V39 numeric and group IDs', () => {
    expect([dataTypeString(2000), dataTypeString(2100), dataTypeString(0x70696374), dataTypeString(0)])
      .toEqual(['Unknown data type for %s', 'Binary', 'Picture', ''])
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
