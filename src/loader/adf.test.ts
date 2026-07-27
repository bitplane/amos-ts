import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { adfInfo, isAdf, readAdf } from './adf'

const DD = 901_120
const BSIZE = 512
const ROOT = 880

/**
 * Builds a small OFS/FFS disk image by hand. The reader walks every hash slot
 * and follows the collision chains, so it does not depend on AmigaDOS's name
 * hash being reproduced here — entries are simply placed in chosen slots,
 * which lets a test put two names in one slot deliberately.
 */
class DiskBuilder {
  bytes = new Uint8Array(DD)
  view = new DataView(this.bytes.buffer)

  constructor(ffs = false) {
    this.bytes[0] = 0x44 // 'D'
    this.bytes[1] = 0x4f // 'O'
    this.bytes[2] = 0x53 // 'S'
    this.bytes[3] = ffs ? 1 : 0
    this.put(ROOT, 0, 2) // T_HEADER
    this.put(ROOT, 12, 72) // hash table size
    this.put(ROOT, 508, 1) // ST_ROOT
    this.name(ROOT, 432, 'TestDisk')
  }

  put(block: number, off: number, v: number): void {
    this.view.setInt32(block * BSIZE + off, v, false)
  }

  name(block: number, off: number, s: string): void {
    const base = block * BSIZE + off
    this.bytes[base] = s.length
    for (let i = 0; i < s.length; i++) this.bytes[base + 1 + i] = s.charCodeAt(i)
  }

  /** link a header block into a directory's hash slot, chaining if occupied */
  link(dir: number, slot: number, block: number): void {
    const off = 24 + slot * 4
    const head = this.view.getUint32(dir * BSIZE + off, false)
    if (head === 0) this.put(dir, off, block)
    else {
      let b = head
      for (;;) {
        const next = this.view.getUint32(b * BSIZE + 496, false)
        if (next === 0) break
        b = next
      }
      this.put(b, 496, block)
    }
  }

  dir(parent: number, slot: number, block: number, name: string): number {
    this.put(block, 0, 2)
    this.put(block, 4, block)
    this.put(block, 508, 2) // ST_USERDIR
    this.put(block, 500, parent)
    this.name(block, 432, name)
    this.link(parent, slot, block)
    return block
  }

  file(parent: number, slot: number, block: number, name: string, data: Uint8Array, ffs = false): void {
    this.put(block, 0, 2)
    this.put(block, 4, block)
    this.put(block, 508, -3) // ST_FILE
    this.put(block, 500, parent)
    this.put(block, 324, data.length)
    this.name(block, 432, name)
    const payload = ffs ? BSIZE : BSIZE - 24
    const n = Math.ceil(data.length / payload)
    this.put(block, 8, n) // high_seq
    let pos = 0
    for (let i = 0; i < n; i++) {
      const db = block + 1 + i
      const len = Math.min(payload, data.length - pos)
      // the table is filled BACKWARDS from offset 308
      this.put(block, 308 - i * 4, db)
      if (i === 0) this.put(block, 16, db) // first_data
      if (!ffs) {
        this.put(db, 0, 8) // T_DATA
        this.put(db, 4, block)
        this.put(db, 8, i + 1) // seq
        this.put(db, 12, len)
        this.put(db, 16, i + 1 < n ? db + 1 : 0)
      }
      this.bytes.set(data.subarray(pos, pos + len), db * BSIZE + (ffs ? 0 : 24))
      pos += len
    }
    this.link(parent, slot, block)
  }
}

const text = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

describe('ADF disk images', () => {
  it('recognises Amiga images by size and signature', () => {
    expect(isAdf(new DiskBuilder().bytes)).toBe(true)
    expect(isAdf(new Uint8Array(DD))).toBe(false) // right size, no "DOS"
    expect(isAdf(new Uint8Array(1024))).toBe(false) // not a floppy geometry
  })

  it('walks the last hash slot, which is at offset 308 and not before it', () => {
    // The hash table is 72 longs at 24..308 *inclusive*. Treating 308 as an
    // exclusive limit drops slot 71 entirely, and does it silently — the file
    // just is not in the listing. Real disks land names there: on the Thrusts
    // compilation disk it was `thrusts.info`, which disappeared until the
    // bound was fixed.
    const d = new DiskBuilder()
    d.file(ROOT, 0, 900, 'first.abk', text('a'))
    d.file(ROOT, 71, 910, 'last.info', text('b'))
    const paths = readAdf(d.bytes).map((e) => e.path)
    expect(paths).toContain('last.info')
    expect(paths).toHaveLength(2)
  })

  it('reads the volume label and filesystem flags', () => {
    const ofs = adfInfo(new DiskBuilder(false).bytes)
    expect(ofs).toMatchObject({ label: 'TestDisk', filesystem: 'OFS', blocks: 1760 })
    expect(adfInfo(new DiskBuilder(true).bytes).filesystem).toBe('FFS')
  })

  it('reassembles a multi-block OFS file from the reversed block table', () => {
    // OFS data blocks carry a 24-byte header, so 488 bytes each: this file
    // needs three, and the table is filled backwards from offset 308
    const d = new DiskBuilder()
    const body = text('A'.repeat(1000) + 'B'.repeat(200))
    d.file(ROOT, 3, 900, 'big.abk', body)
    const es = readAdf(d.bytes)
    expect(es).toHaveLength(1)
    expect(es[0]!.path).toBe('big.abk')
    expect(es[0]!.data).toEqual(body)
  })

  it('reads FFS data blocks, which have no header', () => {
    const d = new DiskBuilder(true)
    const body = text('X'.repeat(1500))
    d.file(ROOT, 5, 900, 'ffs.dat', body, true)
    const es = readAdf(d.bytes)
    expect(es[0]!.data).toEqual(body)
  })

  it('follows hash collision chains and recurses into directories', () => {
    const d = new DiskBuilder()
    // two files deliberately sharing one hash slot
    d.file(ROOT, 7, 900, 'first.amos', text('one'))
    d.file(ROOT, 7, 910, 'second.amos', text('two'))
    const sub = d.dir(ROOT, 9, 920, 'Music')
    d.file(sub, 2, 930, 'theme.abk', text('tune'))
    const sub2 = d.dir(sub, 4, 940, 'Samples')
    d.file(sub2, 1, 950, 'hit.sam', text('bang'))

    const paths = readAdf(d.bytes).map((e) => e.path).sort()
    expect(paths).toEqual(['Music/Samples/hit.sam', 'Music/theme.abk', 'first.amos', 'second.amos'])
  })

  it('rejects an image with no root block rather than returning nonsense', () => {
    const d = new DiskBuilder()
    d.put(ROOT, 508, 0) // not ST_ROOT
    expect(() => readAdf(d.bytes)).toThrow(/root block/)
  })

  it('survives a directory loop instead of hanging', () => {
    // a damaged disk can point a subdirectory back at its own parent
    const d = new DiskBuilder()
    const sub = d.dir(ROOT, 1, 900, 'Loop')
    d.put(sub, 24, ROOT) // first hash slot points back at the root
    d.file(sub, 5, 910, 'ok.amos', text('data'))
    const es = readAdf(d.bytes)
    expect(es.map((e) => e.path)).toEqual(['Loop/ok.amos'])
  })
})

// The corpus lives outside the repo (see amos-files); these run when it is
// present and are skipped otherwise.
const CORPUS = '/home/gaz/src/tmp/amos/amos-files/sources/amos-pd-library-cd-1994/files/TotallyAmos'
describe.skipIf(!existsSync(`${CORPUS}/Issue1.adf`))('against real disks', () => {
  it("matches the CD's own 1994 extraction of the same disk", () => {
    // Totally AMOS issue 1 ships on the AMOS PD Library CD both as a DMS
    // image and as an already-extracted directory tree. Reading the image
    // and comparing byte-for-byte against that tree checks this reader
    // against an independent extraction made on the original hardware.
    const entries = readAdf(new Uint8Array(readFileSync(`${CORPUS}/Issue1.adf`)))
    // 112, not 111: `edit/a_a_amos.seq` hashes to slot 71, the last of the
    // hash table, and was invisible while the walk stopped short of offset
    // 308. The CD's own extraction has it, which is how we know 112 is right.
    expect(entries.length).toBe(112)

    let identical = 0
    const differing: string[] = []
    for (const e of entries) {
      const onDisc = `${CORPUS}/Issue1/${e.path}`
      if (!existsSync(onDisc)) continue
      const ref = new Uint8Array(readFileSync(onDisc))
      if (ref.length === e.data.length && ref.every((b, i) => b === e.data[i])) identical++
      else differing.push(e.path)
    }
    // fonts/emerald/17 is damaged on the image itself: its header claims 14
    // data blocks (high_seq, and a matching table) while the OFS next-pointer
    // chain dead-ends after 9, at exactly the byte where the two extractions
    // diverge. The table is what AmigaDOS uses and it agrees with the recorded
    // file size, so this reader follows it.
    expect(differing).toEqual(['fonts/emerald/17'])
    expect(identical).toBe(111)
  })

  it('reads every disk image in the corpus without failing', () => {
    const files = execSync(`find ${CORPUS}/.. -iname '*.adf'`).toString().trim().split('\n')
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const bytes = new Uint8Array(readFileSync(f))
      expect(isAdf(bytes), f).toBe(true)
      expect(readAdf(bytes).length, f).toBeGreaterThan(0)
    }
  })
})
