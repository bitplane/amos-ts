/**
 * xfdmaster, against its own shipped headers and against real crunched data.
 *
 * The constants are checked by re-reading `xfdmaster.h` out of the vendored
 * developer archive, so a typo here fails rather than sitting quietly in a
 * table nobody rereads. The behaviour is checked by CRUNCHING something with
 * this port's own crunchers and handing the result back, which is the one
 * test that cannot pass by accident: a recogniser matching the wrong magic
 * would decrunch to the wrong bytes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LVO, SLAVES, XFDERR, XFDERR_TEXT, XFDFF, XFDPFB, XFDPFF, decrunchBuffer, getErrorText, recogBuffer, unpack } from './xfdmaster'
import type { XfdBufferInfo } from './xfdmaster'
import { pp20Crunch } from './powerpacker'
import { stcCrunch } from './stonecracker'
import { describeIf } from '../testing/fixture'
import { existsSync } from 'node:fs'

const DEV = 'fixtures/aminet/xfd/xfd_Developer'
const HEADER = `${DEV}/Include/C/libraries/xfdmaster.h`
const FD = `${DEV}/Include/FD/xfdmaster_lib.fd`
const LIB = 'fixtures/aminet/xfd/xfd_User/Libs/xfdmaster.library'

/** something with structure, so a wrong decrunch cannot look right */
const SAMPLE = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7 + (i >> 5)) & 0xff)

describeIf('against the shipped headers', existsSync(HEADER), () => {
  /** the header is ISO-8859, which is why this reads it as latin1 and not utf8 */
  const header = readFileSync(HEADER, 'latin1')

  function defines(prefix: string): Map<string, number> {
    const out = new Map<string, number>()
    for (const m of header.matchAll(new RegExp(`^#define\\s+(${prefix}\\w+)\\s+(0x[0-9a-fA-F]+|\\d+)`, 'gm'))) {
      out.set(m[1]!, Number(m[2]!))
    }
    return out
  }

  it('every XFDERR is the value xfdmaster.h gives it', () => {
    const doc = defines('XFDERR_')
    expect(doc.size).toBeGreaterThanOrEqual(25)
    for (const [name, value] of Object.entries(XFDERR)) {
      expect(doc.get(`XFDERR_${name}`), name).toBe(value)
    }
    // and nothing in the header is missing from the table
    expect([...doc.keys()].filter((k) => !(k.slice(7) in XFDERR))).toEqual([])
  })

  it('every packer-flag BIT is the header s bit', () => {
    const doc = defines('XFDPFB_')
    for (const [name, bit] of Object.entries(XFDPFB)) expect(doc.get(`XFDPFB_${name}`), name).toBe(bit)
    // the FF constants really are 1 << the B constants
    for (const [name, bit] of Object.entries(XFDPFB)) {
      expect(XFDPFF[name as keyof typeof XFDPFF]).toBe(1 << bit)
    }
  })

  /** an .fd with no private slots: bias, then six a step, all the way down */
  it('every LVO is the developer .fd s', () => {
    const text = readFileSync(FD, 'latin1')
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
    expect(offsets.size).toBe(Object.keys(LVO).length)
    for (const [name, lvo] of Object.entries(LVO)) expect(offsets.get(name), name).toBe(lvo)
  })

  /** the autodoc prints the offset under each synopsis, which is a second source */
  it('xfdRecogBuffer is -54 in the autodoc too', () => {
    const doc = readFileSync(`${DEV}/Include/Autodocs/xfdmaster.doc`, 'latin1')
    expect(doc).toContain('D0             -54         A0')
    expect(LVO.xfdRecogBuffer).toBe(-54)
  })
})

describe('recognition', () => {
  it('names PowerPacker and reports the length before decrunching', () => {
    const bi: XfdBufferInfo = { sourceBuffer: pp20Crunch(SAMPLE) }
    expect(recogBuffer(bi)).toBe(true)
    expect(bi.packerName).toBe('PowerPacker')
    expect(bi.packerFlags).toBe(XFDPFF.DATA)
    expect(bi.error).toBe(XFDERR.OK)
    expect(bi.finalTargetLen).toBe(SAMPLE.length)
  })

  it('names StoneCracker and reports its length', () => {
    const bi: XfdBufferInfo = { sourceBuffer: stcCrunch(SAMPLE) }
    expect(recogBuffer(bi)).toBe(true)
    expect(bi.packerName).toBe('StoneCracker 4.04')
    expect(bi.finalTargetLen).toBe(SAMPLE.length)
  })

  it('answers UNKNOWN for something no slave claims', () => {
    const bi: XfdBufferInfo = { sourceBuffer: SAMPLE }
    expect(recogBuffer(bi)).toBe(false)
    expect(bi.error).toBe(XFDERR.UNKNOWN)
    expect(bi.packerName).toBeUndefined()
  })

  it('answers NOSOURCE for an empty buffer', () => {
    const bi: XfdBufferInfo = { sourceBuffer: new Uint8Array(0) }
    expect(recogBuffer(bi)).toBe(false)
    expect(bi.error).toBe(XFDERR.NOSOURCE)
  })

  /**
   * A slave must never read past a short buffer: the library runs every
   * recogniser over every file, so one that threw would take the scan with
   * it. This walks every prefix of a real crunched file, which is the cheap
   * way to find an off-by-one in a magic test.
   */
  it('no recogniser throws or claims a truncated file', () => {
    const full = pp20Crunch(SAMPLE)
    for (let n = 0; n < 24; n++) {
      const bi: XfdBufferInfo = { sourceBuffer: full.subarray(0, n) }
      expect(() => recogBuffer(bi), `${n} bytes`).not.toThrow()
      if (n < 12) expect(bi.packerName, `${n} bytes`).toBeUndefined()
    }
  })
})

describe('decrunching', () => {
  it('round-trips PowerPacker back to the exact bytes', () => {
    const bi: XfdBufferInfo = { sourceBuffer: pp20Crunch(SAMPLE) }
    expect(recogBuffer(bi)).toBe(true)
    expect(decrunchBuffer(bi)).toBe(true)
    expect(bi.error).toBe(XFDERR.OK)
    expect(bi.targetBufSaveLen).toBe(SAMPLE.length)
    expect([...bi.targetBuffer!]).toEqual([...SAMPLE])
  })

  it('round-trips StoneCracker back to the exact bytes', () => {
    const bi: XfdBufferInfo = { sourceBuffer: stcCrunch(SAMPLE) }
    expect(recogBuffer(bi)).toBe(true)
    expect(decrunchBuffer(bi)).toBe(true)
    expect([...bi.targetBuffer!]).toEqual([...SAMPLE])
  })

  it('answers NOSLAVE when the caller skipped recogBuffer', () => {
    const bi: XfdBufferInfo = { sourceBuffer: pp20Crunch(SAMPLE) }
    expect(bi.packerName).toBeUndefined()
    expect(decrunchBuffer(bi)).toBe(false)
    expect(bi.error).toBe(XFDERR.NOSLAVE)
  })

  /**
   * A codec that throws or answers null is corrupt data, not a crash. Damage
   * the payload rather than the header, so recognition still succeeds and the
   * failure has to come from the decrunch.
   */
  it('turns a mangled payload into CORRUPTEDDATA', () => {
    const packed = pp20Crunch(SAMPLE)
    const broken = Uint8Array.from(packed)
    for (let i = 8; i < broken.length - 4; i++) broken[i] = 0xff
    const bi: XfdBufferInfo = { sourceBuffer: broken }
    expect(recogBuffer(bi)).toBe(true)
    expect(decrunchBuffer(bi)).toBe(false)
    expect(bi.error).toBe(XFDERR.CORRUPTEDDATA)
    expect(bi.targetBuffer).toBeUndefined()
  })

  it('answers NOSLAVE when the named packer is not in the list given', () => {
    const bi: XfdBufferInfo = { sourceBuffer: pp20Crunch(SAMPLE), packerName: 'Nonesuch' }
    expect(decrunchBuffer(bi)).toBe(false)
    expect(bi.error).toBe(XFDERR.NOSLAVE)
  })

  it('unpack does the whole dance, or answers null', () => {
    expect(unpack(pp20Crunch(SAMPLE))?.name).toBe('PowerPacker')
    expect([...unpack(stcCrunch(SAMPLE))!.data]).toEqual([...SAMPLE])
    expect(unpack(SAMPLE)).toBeNull()
  })
})

describe('the slave list', () => {
  it('is three, each with a distinct name and a real recogSize', () => {
    expect(SLAVES).toHaveLength(3)
    expect(new Set(SLAVES.map((s) => s.name)).size).toBe(3)
    for (const s of SLAVES) expect(s.recogSize, s.name).toBeGreaterThan(0)
  })

  /**
   * ByteKiller is absent on purpose. `./bytekiller.ts` decrunches it and its
   * header says bare ByteKiller data "has no magic AT ALL", so a recogniser
   * could only guess and would claim files belonging to the other three.
   */
  it('leaves out the one format that cannot be recognised', () => {
    expect(SLAVES.map((s) => s.name)).not.toContain('ByteKiller')
  })

  /** no two slaves may claim one file, which is what makes list order not matter yet */
  it('no two slaves recognise the same data', () => {
    for (const packed of [pp20Crunch(SAMPLE), stcCrunch(SAMPLE)]) {
      const hits = SLAVES.filter((s) => packed.length >= s.recogSize && s.recog(packed))
      expect(hits).toHaveLength(1)
    }
  })
})

describe('error text', () => {
  it('gives the binary wording, and its fallback for anything else', () => {
    expect(getErrorText(XFDERR.OK)).toBe('/no errors')
    expect(getErrorText(XFDERR.UNKNOWN)).toBe('unknown file')
    expect(getErrorText(XFDERR.CORRUPTEDDATA)).toBe('corrupted data')
    expect(getErrorText(XFDERR.NOHUNKHEADER)).toBe('file is not executable')
    expect(getErrorText(0x7fff)).toBe('undefined error')
  })

  it('has text for every code', () => {
    for (const [name, code] of Object.entries(XFDERR)) {
      expect(getErrorText(code), name).not.toBe('undefined error')
    }
  })

  it.skipIf(!existsSync(LIB))('uses the strings embedded in xfdmaster.library 39.15', () => {
    const binary = readFileSync(LIB, 'latin1')
    expect(binary).toContain('xfdmaster 39.15 (09.03.2003)')
    for (const text of Object.values(XFDERR_TEXT)) expect(binary).toContain(`${text}\0`)
    expect(binary).toContain('undefined error\0')
  })

  it('keeps the flag families apart', () => {
    // XFDFF influences recognition, XFDPFF describes what was recognised
    expect(XFDFF.RECOGEXTERN).toBe(1)
    expect(XFDPFF.RELOC).toBe(1)
    expect(XFDPFF.DATA).toBe(4)
  })
})
