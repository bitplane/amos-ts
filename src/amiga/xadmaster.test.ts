/**
 * xadmaster, against its shipped headers and against real archives.
 *
 * The constants are re-read out of `xadmaster.h` and `xadmaster_lib.fd`, so a
 * typo fails here rather than sitting in a table nobody rereads. That check
 * has already earned itself: the LVO table was written by assuming private
 * slots this .fd does not have, and sixteen of the twenty-five entries were
 * out by between six and forty-two.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { CLIENTS, LHA_CLIENT, LVO, TAR_CLIENT, XADERR, XADERR_TEXT, XADFIB, XADFIF, ZIP_CLIENT, fileUnArc, getErrorText, getInfo, recogFile, unarchive } from './xadmaster'
import { describeIf } from '../testing/fixture'

const INC = 'fixtures/aminet/xad/xad/Include'
const HEADER = `${INC}/C/libraries/xadmaster.h`
const FD = `${INC}/FD/xadmaster_lib.fd`
const ARCHIVE = 'fixtures/aminet/xfd/xfdmaster.lha'
const LIB = 'fixtures/aminet/xad/xad/Libs/xadmaster.library'

describeIf('against the shipped headers', existsSync(HEADER), () => {
  /** the header is ISO-8859, so it is read as latin1 and not utf8 */
  const header = readFileSync(HEADER, 'latin1')

  it('every XADERR is the value xadmaster.h gives it', () => {
    const doc = new Map<string, number>()
    for (const m of header.matchAll(/^#define\s+(XADERR_\w+)\s+(0x[0-9a-fA-F]+|\d+)/gm)) {
      doc.set(m[1]!, Number(m[2]!))
    }
    expect(doc.size).toBe(26)
    for (const [name, value] of Object.entries(XADERR)) expect(doc.get(`XADERR_${name}`), name).toBe(value)
    // and nothing in the header is missing from the table
    expect([...doc.keys()].filter((k) => !(k.slice(7) in XADERR))).toEqual([])
  })

  it('every XADFIB is the header s bit, and XADFIF is one shifted by it', () => {
    const doc = new Map<string, number>()
    for (const m of header.matchAll(/^#define\s+(XADFIB_\w+)\s+(\d+)/gm)) doc.set(m[1]!, Number(m[2]!))
    for (const [name, bit] of Object.entries(XADFIB)) {
      expect(doc.get(`XADFIB_${name}`), name).toBe(bit)
      expect(XADFIF[name as keyof typeof XADFIF]).toBe(1 << bit)
    }
  })

  /**
   * No private slots in this .fd: bias, then six a step. Worth a test of its
   * own because the two other libraries in this directory both have gaps, and
   * carrying that habit here is exactly the mistake this caught.
   */
  it('every LVO is the .fd s, with no gaps anywhere', () => {
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
    // the no-gaps claim, stated as arithmetic rather than as prose
    expect(Object.values(LVO)).toEqual(Object.keys(LVO).map((_, i) => -(30 + i * 6)))
  })
})

describe('recognition', () => {
  const zip = (): Uint8Array => {
    const b = new Uint8Array(64)
    b.set([0x50, 0x4b, 0x03, 0x04], 0)
    return b
  }
  const tar = (): Uint8Array => {
    const b = new Uint8Array(1024)
    b.set([...'ustar'].map((c) => c.charCodeAt(0)), 257)
    return b
  }
  const lha = (): Uint8Array => {
    const b = new Uint8Array(64)
    b[0] = 20
    b.set([...'-lh5-'].map((c) => c.charCodeAt(0)), 2)
    return b
  }

  it('tells the three apart by content and not by name', () => {
    expect(recogFile(lha())?.name).toBe('LhA')
    expect(recogFile(zip())?.name).toBe('Zip')
    expect(recogFile(tar())?.name).toBe('Tar')
  })

  it('claims nothing for a file that is no archive', () => {
    expect(recogFile(new Uint8Array(1024))).toBeNull()
    expect(getInfo(new Uint8Array(1024)).lastError).toBe(XADERR.FILETYPE)
  })

  /**
   * The library runs every recogniser over every file, so a short buffer must
   * not throw. Walking every prefix is the cheap way to find an off-by-one in
   * a magic test.
   */
  it('no recogniser throws on a truncated file', () => {
    for (const make of [lha, zip, tar]) {
      const full = make()
      for (let n = 0; n < 300 && n < full.length; n++) {
        expect(() => recogFile(full.subarray(0, n)), `${n} bytes`).not.toThrow()
      }
    }
  })

  it('has one client per name and a real recogSize for each', () => {
    expect(CLIENTS).toHaveLength(3)
    expect(new Set(CLIENTS.map((c) => c.name)).size).toBe(3)
    for (const c of CLIENTS) expect(c.recogSize, c.name).toBeGreaterThan(0)
    expect([LHA_CLIENT, ZIP_CLIENT, TAR_CLIENT].every((c) => CLIENTS.includes(c))).toBe(true)
  })
})

describe('errors', () => {
  it('gives the binary wording and falls back to UNKNOWN', () => {
    expect(getErrorText(XADERR.FILETYPE)).toBe('filetype is unknown')
    expect(getErrorText(XADERR.EMPTY)).toBe('source contains no files')
    expect(getErrorText(XADERR.SHORTBUFFER)).toBe('buffer too short')
    expect(getErrorText(0x7fff)).toBe('unknown error')
  })

  it.skipIf(!existsSync(LIB))('uses the English strings embedded in xadmaster.library 12.1', () => {
    const binary = readFileSync(LIB, 'latin1')
    expect(binary).toContain('xadmaster 12.1 (28.09.2003)')
    for (const text of Object.values(XADERR_TEXT)) expect(binary).toContain(`${text}\0`)
  })

  it('has text for every code', () => {
    for (const [name, code] of Object.entries(XADERR)) {
      if (code === XADERR.UNKNOWN) continue
      expect(getErrorText(code), name).not.toBe('unknown error')
    }
  })

  /** EMPTY and FILETYPE are different answers and a caller shows them differently */
  it('separates "no client wanted it" from "a client found nothing"', () => {
    const empty = new Uint8Array(1024)
    empty.set([...'ustar'].map((c) => c.charCodeAt(0)), 257)
    expect(getInfo(empty).client).toBe('Tar')
    expect(getInfo(empty).lastError).toBe(XADERR.EMPTY)
    expect(getInfo(new Uint8Array(1024)).lastError).toBe(XADERR.FILETYPE)
  })
})

describeIf('a real archive end to end', existsSync(ARCHIVE), () => {
  const bytes = new Uint8Array(readFileSync(ARCHIVE))

  it('lists it without extracting anything', () => {
    const ai = getInfo(bytes)
    expect(ai.client).toBe('LhA')
    expect(ai.lastError).toBe(XADERR.OK)
    expect(ai.files.length).toBeGreaterThan(100)
    expect(ai.inSize).toBe(bytes.length)
    // entry numbers are 1-based, as the autodocs number them
    expect(ai.files[0]!.entryNumber).toBe(1)
    expect(ai.files.every((f) => f.size >= 0 && f.crunchSize >= 0)).toBe(true)
  })

  it('extracts one entry by itself', async () => {
    const ai = getInfo(bytes)
    const first = ai.files.find((f) => (f.flags & XADFIF.DIRECTORY) === 0 && f.size > 0)!
    const out = await fileUnArc(bytes, ai, first)
    expect(out).not.toBeNull()
    expect(out!.length).toBe(first.size)
    expect(ai.lastError).toBe(XADERR.OK)
  })

  it('extracts the whole archive', async () => {
    const { ai, files } = await unarchive(bytes)
    expect(ai.lastError).toBe(XADERR.OK)
    expect(files.length).toBe(ai.files.filter((f) => (f.flags & XADFIF.DIRECTORY) === 0).length)
    for (const f of files) expect(f.data.length).toBe(ai.files.find((e) => e.fileName === f.path)!.size)
  })

  it('reports the reason when a client cannot be found', async () => {
    const ai = getInfo(bytes)
    const wrong = { ...ai, client: 'Nonesuch' }
    expect(await fileUnArc(bytes, wrong, ai.files[0]!)).toBeNull()
    expect(wrong.lastError).toBe(XADERR.FILETYPE)
  })
})
