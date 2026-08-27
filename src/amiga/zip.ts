/**
 * ZIP: read through its central directory, and written back out.
 *
 * The writer arrived with the Files panel, which hands a drawer to the
 * machine the browser is running on and needs a container the host will open
 * without being told what it is. It is beside the reader for the reason
 * `./ilbm.ts` and `./jpeg.ts` keep both halves in one file, and because the
 * reader is what the writer's test checks against.
 *
 * MOVED HERE from `src/runtime`, which holds the AMOS file formats. A ZIP is
 * not one: it is how the outside world hands this port a pile of files, and
 * README.md's test is met because the web front-end, `xadmaster.ts`'s ZIP
 * client and any later caller all want it and none owns it.
 *
 * The central directory rather than the local headers, because the local ones
 * can carry a zero size with the real one in a trailing descriptor, and the
 * directory always knows. The local header is still read for its own name and
 * extra lengths, since those may differ from the directory's copy and it is
 * the local ones that say where the data starts.
 *
 * DEFLATE goes through `DecompressionStream`, which browsers and Node 18+
 * have and which is asynchronous. That is the whole reason `XadClient.unarc`
 * may return a promise.
 */
import type { ArchiveEntry } from './tar'
import { civilFromStamp } from './datestamp'
export type { ArchiveEntry }

/**
 * gzip and raw deflate, through the platform.
 *
 * Exported because a `.tar.gz` needs the gzip half before `./tar.ts` can see
 * anything, and that router is the caller's rather than this file's.
 */
export async function inflate(data: Uint8Array, format: 'deflate-raw' | 'gzip'): Promise<Uint8Array> {
  const ds = new DecompressionStream(format)
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** one entry as the central directory describes it, before any inflating */
export interface ZipEntry {
  path: string
  /** the compression method: 0 stored, 8 deflate */
  method: number
  /** compressed length */
  packedSize: number
  /** decompressed length */
  size: number
  /** where the compressed bytes begin, past the local header */
  dataOffset: number
}

/**
 * The central directory, without inflating anything.
 *
 * Split out so a caller can LIST an archive cheaply. It also has to read each
 * local header, because the name and extra-field lengths there may differ
 * from the directory's copy and it is the local ones that fix where the data
 * starts.
 *
 * An empty list rather than a throw for anything that is not a zip: a caller
 * that guessed wrong should get "no entries", not an exception.
 */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End Of Central Directory, scanning back for PK\5\6. The comment it may
  // carry is why this is a search and not a fixed offset.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []
  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (off + 46 > bytes.length || view.getUint32(off, true) !== 0x02014b50) break
    const method = view.getUint16(off + 10, true)
    const packedSize = view.getUint32(off + 20, true)
    const size = view.getUint32(off + 24, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    const localOff = view.getUint32(off + 42, true)
    // Bit 11 of the general-purpose flags is the language-encoding flag, and
    // it is the only thing in a zip that says which of the two encodings a
    // name is in. Without it the byte-per-character reading is right: an
    // Amiga zip's names are Latin-1 and always were. With it they are UTF-8,
    // and reading those as Latin-1 turns one umlaut into two characters.
    const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen)
    const path =
      (view.getUint16(off + 8, true) & 0x0800) !== 0
        ? new TextDecoder().decode(nameBytes)
        : String.fromCharCode(...nameBytes)
    if (localOff + 30 > bytes.length) break
    const lNameLen = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    out.push({ path, method, packedSize, size, dataOffset: localOff + 30 + lNameLen + lExtraLen })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** one entry's bytes; null for a method other than stored or deflate */
export async function readZipEntry(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array | null> {
  const raw = bytes.subarray(e.dataOffset, e.dataOffset + e.packedSize)
  if (e.method === 0) return Uint8Array.from(raw)
  if (e.method === 8) return inflate(raw, 'deflate-raw')
  return null
}

/** Parse a .zip via its central directory. */
export async function readZip(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  const out: ArchiveEntry[] = []
  for (const e of readZipDirectory(bytes)) {
    if (e.path.endsWith('/')) continue
    const data = await readZipEntry(bytes, e)
    if (data !== null) out.push({ path: e.path, data })
  }
  return out
}

/**
 * Deflate, through the platform, and the other half of `inflate`.
 *
 * `CompressionStream` is the mirror of the `DecompressionStream` above and
 * arrived in the same browsers. Nothing here falls back on a deflate written
 * in TypeScript: a caller that cannot compress stores instead, which is a
 * legal zip and is what `writeZip` does with the answer.
 */
export async function deflate(data: Uint8Array, format: 'deflate-raw' | 'gzip'): Promise<Uint8Array> {
  const cs = new CompressionStream(format)
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/**
 * The CRC-32 every zip entry carries, and the only checksum in this file.
 *
 * PKZIP's is the ordinary reflected CRC-32 with polynomial $edb88320, the
 * same one `xadCalcCRC32` offers at LVO -102. The table is built on first use
 * rather than written out: 256 longwords of constant is a lot of source for
 * eight lines of arithmetic that reproduce it exactly.
 */
let crcTable: Uint32Array | null = null
export function crc32(data: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** one file going in, with the AmigaDOS date it already had */
export interface ZipInput {
  /** the path inside the archive, with `/` separators and no leading one */
  path: string
  data: Uint8Array
  /**
   * When it was last changed, as the volume recorded it.
   *
   * A DateStamp and not a host `Date`, because that is what the file HAS:
   * every entry in this filesystem carries days, minutes and ticks since 1
   * January 1978, and most of them came off a disk image stamped in 1992.
   * Reaching for the host clock here would replace all of that with today.
   */
  stamp?: { days: number; mins: number; ticks: number }
}

/**
 * MS-DOS's date and time, packed into two words.
 *
 * The format zip has carried since 1989: seconds in units of TWO, and a year
 * counted from 1980. AmigaDOS counts from 1978, so a stamp from the two years
 * between the epochs cannot be said at all and becomes 1 January 1980, which
 * is what every other zip writer does with one.
 */
function dosStamp(c: { year: number; month: number; day: number; hour: number; min: number; sec: number }): {
  time: number
  date: number
} {
  if (c.year < 1980) return { time: 0, date: (1 << 5) | 1 }
  return {
    time: (c.hour << 11) | (c.min << 5) | (c.sec >> 1),
    date: ((c.year - 1980) << 9) | (c.month << 5) | c.day,
  }
}

/**
 * A zip, for handing a drawer to the machine the browser is running on.
 *
 * Written rather than vendored because the alternative was shipping a zip
 * library to do what fits here: stored or deflated entries, no zip64, no
 * encryption, no split archives. What it must be is READABLE, and the test
 * checks that by putting its output back through `readZip` above.
 *
 * Names go out as UTF-8 with the language-encoding flag set, bit 11. An
 * AmigaDOS name is Latin-1 and the two disagree above 127, which is a real
 * difference on a corpus this old: a name with an umlaut in it is one byte in
 * the one encoding and two in the other, and a reader left to guess shows
 * mojibake for whichever it guessed wrong.
 */
export async function writeZip(files: readonly ZipInput[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.path)
    const crc = crc32(f.data)
    // Deflate, unless it made the file bigger. Already-crunched Amiga data is
    // most of what goes through here, and deflate expands it.
    let method = 8
    let body: Uint8Array
    try {
      body = await deflate(f.data, 'deflate-raw')
    } catch {
      body = f.data
      method = 0
    }
    if (body.length >= f.data.length) {
      body = f.data
      method = 0
    }
    const when = dosStamp(
      f.stamp
        ? civilFromStamp(f.stamp.days, f.stamp.mins, f.stamp.ticks)
        : { year: 1980, month: 1, day: 1, hour: 0, min: 0, sec: 0, weekday: 0 },
    )

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed: 2.0, which is deflate
    lv.setUint16(6, 0x0800, true) // bit 11: the name is UTF-8
    lv.setUint16(8, method, true)
    lv.setUint16(10, when.time, true)
    lv.setUint16(12, when.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    locals.push(local, body)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, when.time, true)
    cv.setUint16(14, when.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + body.length
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, end]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
