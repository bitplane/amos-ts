/**
 * A small OFS/FFS disk image, built by hand.
 *
 * Two suites need one and neither should carry its own copy. ../amiga/adf.ts
 * is judged against real images in the corpus; what this is for is the cases
 * a real image cannot supply, like two names hashed into one slot, a name in
 * slot 71, or a disk holding exactly one program.
 *
 * The reader walks every hash slot and follows the collision chains, so this
 * does not have to reproduce AmigaDOS's name hash: entries are placed in
 * chosen slots, which is what lets a test put two names in one deliberately.
 */
export const DD_BYTES = 901_120
export const BSIZE = 512
export const ROOT_BLOCK = 880

export class DiskBuilder {
  bytes = new Uint8Array(DD_BYTES)
  view = new DataView(this.bytes.buffer)

  constructor(ffs = false, label = 'TestDisk') {
    this.bytes[0] = 0x44 // 'D'
    this.bytes[1] = 0x4f // 'O'
    this.bytes[2] = 0x53 // 'S'
    this.bytes[3] = ffs ? 1 : 0
    this.put(ROOT_BLOCK, 0, 2) // T_HEADER
    this.put(ROOT_BLOCK, 12, 72) // hash table size
    this.put(ROOT_BLOCK, 508, 1) // ST_ROOT
    this.name(ROOT_BLOCK, 432, label)
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
