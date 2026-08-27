import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { AdfVolume, adfInfo, isAdf, readAdf } from './adf'
import { ID_VALIDATED, ID_VALIDATING } from './dos'
import { AmigaFS } from './vfs'
import { DiskBuilder, DD_BYTES as DD, BSIZE, ROOT_BLOCK as ROOT } from '../testing/disk'

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

describe('AdfVolume — the image mounted as a filesystem', () => {
  const built = (): DiskBuilder => {
    const d = new DiskBuilder()
    d.file(ROOT, 7, 900, 'first.amos', text('one'))
    const sub = d.dir(ROOT, 9, 920, 'Music')
    d.file(sub, 2, 930, 'theme.abk', text('tune'))
    return d
  }

  it('reads, lists and resolves without flattening the disk', () => {
    const v = new AdfVolume(built().bytes)
    expect(v.label).toBe('TestDisk')
    expect(v.read(['first.amos'])).toEqual(text('one'))
    expect(v.read(['Music', 'theme.abk'])).toEqual(text('tune'))
    expect(v.list([])?.map((e) => e.name).sort()).toEqual(['Music', 'first.amos'])
    expect(v.list(['Music'])).toEqual([{ name: 'theme.abk', isDir: false, size: 4 }])
    expect(v.exists([])).toBe('dir')
    expect(v.exists(['Music'])).toBe('dir')
    expect(v.exists(['first.amos'])).toBe('file')
    expect(v.exists(['nope'])).toBe(null)
    // reading a directory is not reading a file
    expect(v.read(['Music'])).toBe(null)
    expect(v.list(['first.amos'])).toBe(null)
  })

  /**
   * A disk whose `bm_flag` is not -1 has an untrusted bitmap, and a real
   * machine answers that by running the VALIDATOR: it walks the directory
   * tree, marks every header, extension and data block, and the rest is free.
   * Reading the stale bitmap instead reports zero free for ever.
   *
   * `DiskBuilder` writes no bitmap at all, so every built disk is in exactly
   * that state, and so are 2 of the 6 shipped AMOS Professional floppies —
   * Tutorial and Examples. `=Dfree` on either said the disk was full to the
   * last block.
   */
  it('counts the blocks itself when the bitmap cannot be trusted', () => {
    const v = new AdfVolume(built().bytes)
    const info = v.dosInfo(0)!
    // root 880, then header 900 + its data block 901, dir 920, header 930 +
    // data block 931. Six, and no bitmap pages to add.
    expect(info.numBlocksUsed).toBe(6)
    expect(info.numBlocks).toBe(1758) // 1760 less the two boot blocks
    expect((info.numBlocks - info.numBlocksUsed) * info.bytesPerBlock).toBe(1752 * 512)
    // counting them does not clear the flag: the disk still says unclean, and
    // `Dev State` still has to report -2 for it
    expect(info.diskState).toBe(ID_VALIDATING)
  })

  it('reads the bitmap when it IS trusted, rather than walking', () => {
    const d = built()
    // bm_flag = -1 and a bitmap block at 1000 with every bit clear: no free
    // blocks at all, which the walk above would never conclude
    d.put(ROOT, 312, -1)
    d.put(ROOT, 316, 1000)
    const info = new AdfVolume(d.bytes).dosInfo(0)!
    expect(info.numBlocksUsed).toBe(1758)
    expect(info.diskState).toBe(ID_VALIDATED)
  })

  it('names are matched case-insensitively, as AmigaDOS does', () => {
    const v = new AdfVolume(built().bytes)
    expect(v.read(['FIRST.AMOS'])).toEqual(text('one'))
    expect(v.exists(['music', 'THEME.abk'])).toBe('file')
  })

  it('mounting does not touch a single data block', () => {
    // the point of the class. A file whose data blocks are garbage must not
    // stop the disk being mounted or listed — only reading THAT file fails,
    // which is what proves construction stayed in the header blocks
    const d = built()
    d.bytes.fill(0xff, 901 * BSIZE, 902 * BSIZE) // first.amos's only data block
    const v = new AdfVolume(d.bytes)
    expect(v.list([])?.map((e) => e.name).sort()).toEqual(['Music', 'first.amos'])
    expect(v.read(['Music', 'theme.abk'])).toEqual(text('tune'))
  })

  it('rejects a damaged image at construction rather than on first read', () => {
    const d = built()
    d.put(ROOT, 508, 0) // not ST_ROOT
    expect(() => new AdfVolume(d.bytes)).toThrow(/root block/)
    expect(() => new AdfVolume(new Uint8Array(1024))).toThrow(/not an Amiga disk image/)
  })

  it('survives a directory loop, like the flat reader', () => {
    const d = new DiskBuilder()
    const sub = d.dir(ROOT, 1, 900, 'Loop')
    d.put(sub, 24, ROOT)
    d.file(sub, 5, 910, 'ok.amos', text('data'))
    const v = new AdfVolume(d.bytes)
    expect(v.list(['Loop'])?.map((e) => e.name)).toEqual(['ok.amos'])
  })

  it('supplies its metadata through AmigaFS, under anything set explicitly', () => {
    const d = built()
    d.put(900, 320, 0x25) // protection
    d.name(900, 328, 'a note')
    d.put(900, 420, 4866) // days
    d.put(900, 424, 1115) // mins
    d.put(900, 428, 922) // ticks
    const fs = new AmigaFS()
    const v = new AdfVolume(d.bytes)
    fs.mount(v.label, v)

    expect(fs.meta('TestDisk:first.amos')).toEqual({
      comment: 'a note',
      protection: 0x25,
      days: 4866,
      mins: 1115,
      ticks: 922,
    })
    // a file the image says nothing about still reads back as the defaults
    expect(fs.meta('TestDisk:Music/theme.abk')).toEqual({ comment: '', protection: 0, days: 0, mins: 0, ticks: 0 })
    // an explicit set outranks the image, and only for what it names
    fs.setMeta('TestDisk:first.amos', { comment: 'mine' })
    expect(fs.meta('TestDisk:first.amos')).toMatchObject({ comment: 'mine', protection: 0 })
  })

  it('a file written over the image does not inherit its metadata', () => {
    // the overlay is a new file, not the 1991 one underneath it: it should
    // not arrive already carrying that file's protection bits and DateStamp
    const d = built()
    d.put(900, 320, 0x25)
    d.name(900, 328, 'a note')
    d.put(900, 420, 4866)
    const fs = new AmigaFS()
    fs.mount('TestDisk', new AdfVolume(d.bytes))
    expect(fs.meta('TestDisk:first.amos')).toMatchObject({ comment: 'a note', days: 4866 })
    fs.writeFile('TestDisk:first.amos', text('replaced'))
    expect(fs.meta('TestDisk:first.amos')).toEqual({ comment: '', protection: 0, days: 0, mins: 0, ticks: 0 })
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

  const images = (): string[] => execSync(`find ${CORPUS}/.. -iname '*.adf'`).toString().trim().split('\n')

  it('AdfVolume returns the same bytes as the flat reader, on every file of every disk', () => {
    // The flat reader is the one checked against the CD's own 1994 extraction
    // above, so agreeing with it file-for-file is what makes the volume's
    // lazy path trustworthy. A hand-built fixture could only prove the reader
    // agrees with the builder.
    let files = 0
    const differing: string[] = []
    for (const f of images()) {
      const bytes = new Uint8Array(readFileSync(f))
      const v = new AdfVolume(bytes)
      for (const e of readAdf(bytes)) {
        files++
        // compared by hand rather than through toEqual: a thousand deep
        // array comparisons take twenty seconds, and the report wants the
        // failing PATHS anyway
        const got = v.read(e.path.split('/'))
        if (got === null || got.length !== e.data.length || !e.data.every((b, i) => b === got[i])) {
          differing.push(`${f} ${e.path}`)
        }
      }
    }
    expect(differing).toEqual([])
    expect(files).toBeGreaterThan(1000)
  })

  it('the decoded DateStamps obey AmigaDOS\'s own bounds, which random bytes would not', () => {
    // The sharpest available check on the header offsets: mins is minutes
    // past midnight and ticks is fiftieths of a second within the minute, so
    // a field read from the wrong place blows past 1440/3000 almost at once.
    // Over the whole corpus the maxima come in at 1429 and 2999.
    let n = 0
    let inAmosYears = 0
    for (const f of images()) {
      const bytes = new Uint8Array(readFileSync(f))
      const v = new AdfVolume(bytes)
      for (const e of readAdf(bytes)) {
        const m = v.meta(e.path.split('/'))!
        expect(m.mins, `${f} ${e.path}`).toBeLessThan(1440)
        expect(m.ticks, `${f} ${e.path}`).toBeLessThan(3000)
        // and the protection long is used a byte wide by every keyword that
        // reads it, so nothing may be lurking above it
        expect(m.protection).toBeLessThan(256)
        n++
        const year = new Date(Date.UTC(1978, 0, 1) + m.days! * 86_400_000).getUTCFullYear()
        if (year >= 1988 && year <= 1995) inAmosYears++
      }
    }
    // these are AMOS-era floppies: the great majority date from when they
    // were written, which a misaligned read would scatter at random
    expect(inAmosYears / n).toBeGreaterThan(0.9)
  })

  it('reads real FileNotes as text, which is what fixes the comment offset', () => {
    // 31 files across the corpus carry one. An offset one field out would
    // give binary rubbish here, not English, so this is the load-bearing
    // check on OFF.comment and on the 79-byte BCPL length
    const v = new AdfVolume(new Uint8Array(readFileSync(`${CORPUS}/Issue1.adf`)))
    expect(v.label).toBe('Totally_AMOS_Nov_91')
    expect(v.meta(['PPmore'])).toEqual({
      comment: 'More commando to Popwerpacker 2.3a',
      protection: 0,
      days: 4866, // 29 April 1991, on a disk labelled November 91
      mins: 1115,
      ticks: 922,
    })
  })
})
