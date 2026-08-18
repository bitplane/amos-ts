/**
 * ZIP, read through its central directory.
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
    let path = ''
    for (let k = 0; k < nameLen; k++) path += String.fromCharCode(bytes[off + 46 + k]!)
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
