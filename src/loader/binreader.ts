/**
 * Big-endian binary reader for Amiga file formats (.AMOS, .Abk, IFF).
 * All multi-byte values on the Amiga are big-endian; strings are Latin-1.
 */
export class BinReader {
  private view: DataView
  pos = 0

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get length(): number {
    return this.bytes.length
  }

  get remaining(): number {
    return this.bytes.length - this.pos
  }

  u8(): number {
    const v = this.view.getUint8(this.pos)
    this.pos += 1
    return v
  }

  u16(): number {
    const v = this.view.getUint16(this.pos)
    this.pos += 2
    return v
  }

  u32(): number {
    const v = this.view.getUint32(this.pos)
    this.pos += 4
    return v
  }

  i16(): number {
    const v = this.view.getInt16(this.pos)
    this.pos += 2
    return v
  }

  i32(): number {
    const v = this.view.getInt32(this.pos)
    this.pos += 4
    return v
  }

  /** Read `n` raw bytes as a subarray (no copy). */
  raw(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.bytes.length) {
      throw new RangeError(`read of ${n} bytes at ${this.pos} exceeds length ${this.bytes.length}`)
    }
    const v = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }

  /** Read a fixed-length Latin-1 string. */
  str(n: number): string {
    let s = ''
    for (const b of this.raw(n)) s += String.fromCharCode(b)
    return s
  }

  /** Peek a fixed-length Latin-1 string without advancing. */
  peekStr(n: number): string {
    const save = this.pos
    const s = this.str(n)
    this.pos = save
    return s
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.bytes.length) {
      throw new RangeError(`seek to ${pos} outside 0..${this.bytes.length}`)
    }
    this.pos = pos
  }

  skip(n: number): void {
    this.seek(this.pos + n)
  }
}
