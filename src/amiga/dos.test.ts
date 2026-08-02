import { describe, expect, it } from 'vitest'
import {
  FFS_BLOCK_DATA,
  FIBF_ARCHIVE,
  FIBF_DELETE,
  FIBF_EXECUTE,
  FIBF_HIDDEN,
  FIBF_PURE,
  FIBF_READ,
  FIBF_SCRIPT,
  FIBF_WRITE,
  FIB_COMMENT,
  FIB_DIRENTRYTYPE,
  FIB_NUMBLOCKS,
  FIB_OWNERGID,
  FIB_OWNERUID,
  FIB_PROTECTION,
  FIB_RESERVED,
  FIB_RESERVED_SIZE,
  FIB_SIZEOF,
  FIB_SIZE_,
  MAX_COMMENT,
  OFS_BLOCK_DATA,
  ST_FILE,
  ST_LINKDIR,
  ST_LINKFILE,
  ST_ROOT,
  ST_SOFTLINK,
  ST_USERDIR,
  blocksFor,
  entryType,
  isDirType,
  permits,
} from './dos'

describe('fib_DirEntryType', () => {
  /**
   * The reason this module exists: LDos named these, adf.ts declared its own
   * copies and JD wrote the bare numbers, all for the same field.
   */
  it('is positive for a directory and negative for a file', () => {
    for (const t of [ST_ROOT, ST_USERDIR, ST_SOFTLINK, ST_LINKDIR]) expect(isDirType(t)).toBe(true)
    for (const t of [ST_FILE, ST_LINKFILE]) expect(isDirType(t)).toBe(false)
  })

  it('holds the values the extensions report', () => {
    // LDos: "2 for a directory, -3 for a file". JD's Jd File Type agrees.
    expect(ST_USERDIR).toBe(2)
    expect(ST_FILE).toBe(-3)
    expect(entryType(true)).toBe(ST_USERDIR)
    expect(entryType(false)).toBe(ST_FILE)
  })
})

describe('fib_Protection', () => {
  it('the low nibble DENIES and the high nibble grants', () => {
    // 0 is `----rwed`: everything permitted, nothing flagged
    expect(permits(0, FIBF_READ)).toBe(true)
    expect(permits(0, FIBF_WRITE)).toBe(true)
    expect(permits(0, FIBF_EXECUTE)).toBe(true)
    expect(permits(0, FIBF_DELETE)).toBe(true)
    expect(permits(0, FIBF_HIDDEN)).toBe(false)
    expect(permits(0, FIBF_ARCHIVE)).toBe(false)
  })

  it('a set low bit takes the permission away', () => {
    expect(permits(FIBF_WRITE, FIBF_WRITE)).toBe(false)
    expect(permits(FIBF_WRITE, FIBF_READ)).toBe(true) // only the one named
    expect(permits(0xff, FIBF_DELETE)).toBe(false)
  })

  it('a set high bit turns the flag ON', () => {
    expect(permits(FIBF_SCRIPT, FIBF_SCRIPT)).toBe(true)
    expect(permits(FIBF_PURE, FIBF_PURE)).toBe(true)
    expect(permits(0xff, FIBF_HIDDEN)).toBe(true)
  })

  it('the eight flags are the eight bits of a byte, in order', () => {
    const all = [FIBF_DELETE, FIBF_EXECUTE, FIBF_WRITE, FIBF_READ, FIBF_ARCHIVE, FIBF_PURE, FIBF_SCRIPT, FIBF_HIDDEN]
    expect(all).toEqual([1, 2, 4, 8, 16, 32, 64, 128])
    expect(all.reduce((a, b) => a | b)).toBe(0xff)
  })
})

describe('struct FileInfoBlock', () => {
  it('has the offsets LDos indexes', () => {
    expect(FIB_DIRENTRYTYPE).toBe(4)
    expect(FIB_PROTECTION).toBe(0x74)
    expect(FIB_SIZE_).toBe(0x7c)
    expect(FIB_NUMBLOCKS).toBe(0x80)
    expect(FIB_COMMENT).toBe(0x90)
  })

  it("is 260 bytes, which is what makes Lcat Push's 264 add up", () => {
    // a 4-byte lock plus the struct
    expect(FIB_SIZEOF).toBe(260)
    expect(FIB_SIZEOF + 4).toBe(264)
  })

  it('the fields tile the struct exactly, with no gap and no overlap', () => {
    // this is what caught the missing tail: comment + 80 lands at 224, not
    // 260, and the two owner words plus 32 reserved bytes are the difference
    expect(FIB_COMMENT + MAX_COMMENT + 1).toBe(FIB_OWNERUID)
    expect(FIB_OWNERUID + 2).toBe(FIB_OWNERGID)
    expect(FIB_OWNERGID + 2).toBe(FIB_RESERVED)
    expect(FIB_RESERVED + FIB_RESERVED_SIZE).toBe(FIB_SIZEOF)
  })
})

describe('fib_NumBlocks', () => {
  it('counts data blocks, rounding up', () => {
    expect(blocksFor(0)).toBe(0)
    expect(blocksFor(1)).toBe(1)
    expect(blocksFor(512)).toBe(1)
    expect(blocksFor(513)).toBe(2)
    expect(blocksFor(1024)).toBe(2)
  })

  it('an old-filesystem block holds 488 bytes, not 512', () => {
    // OFS spends 24 of the 512 on a block header
    expect(FFS_BLOCK_DATA - OFS_BLOCK_DATA).toBe(24)
    expect(blocksFor(512, OFS_BLOCK_DATA)).toBe(2)
    expect(blocksFor(488, OFS_BLOCK_DATA)).toBe(1)
  })

  it('refuses to divide by nothing', () => {
    expect(blocksFor(-5)).toBe(0)
    expect(blocksFor(100, 0)).toBe(0)
  })
})
