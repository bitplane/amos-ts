import { MemoryVolume } from '../amiga/vfs'
import { isAdf, readAdf } from '../loader/adf'

/**
 * Dependency-free ZIP, TAR and ADF readers, for filling the virtual
 * filesystem from uploads. Deflate/gzip decompression uses
 * DecompressionStream (browsers and Node 18+); Amiga floppy images are
 * read by ../loader/adf.
 */

async function inflate(data: Uint8Array, format: 'deflate-raw' | 'gzip'): Promise<Uint8Array> {
  const ds = new DecompressionStream(format)
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

export interface ArchiveEntry {
  path: string
  data: Uint8Array
}

/** Parse a .zip via its central directory. */
export async function readZip(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // find End Of Central Directory (scan back for PK\5\6)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')
  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)
  const out: ArchiveEntry[] = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) break
    const method = view.getUint16(off + 10, true)
    const csize = view.getUint32(off + 20, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    const localOff = view.getUint32(off + 42, true)
    let path = ''
    for (let k = 0; k < nameLen; k++) path += String.fromCharCode(bytes[off + 46 + k]!)
    // local header: skip its (possibly different) name/extra lengths
    const lNameLen = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(dataStart, dataStart + csize)
    if (!path.endsWith('/')) {
      const data = method === 8 ? await inflate(raw, 'deflate-raw') : Uint8Array.from(raw)
      out.push({ path, data })
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Parse a .tar (ustar); pass gunzipped bytes for .tar.gz. */
export function readTar(bytes: Uint8Array): ArchiveEntry[] {
  const out: ArchiveEntry[] = []
  let off = 0
  while (off + 512 <= bytes.length) {
    if (bytes[off] === 0) break
    let name = ''
    for (let i = 0; i < 100 && bytes[off + i] !== 0; i++) name += String.fromCharCode(bytes[off + i]!)
    let sizeStr = ''
    for (let i = 124; i < 136 && bytes[off + i] !== 0; i++) sizeStr += String.fromCharCode(bytes[off + i]!)
    const size = parseInt(sizeStr.trim() || '0', 8)
    const type = bytes[off + 156]!
    // ustar prefix field extends the name
    let prefix = ''
    for (let i = 345; i < 500 && bytes[off + i] !== 0; i++) prefix += String.fromCharCode(bytes[off + i]!)
    const path = prefix !== '' ? `${prefix}/${name}` : name
    if ((type === 0 || type === 48) && name !== '') {
      out.push({ path, data: Uint8Array.from(bytes.subarray(off + 512, off + 512 + size)) })
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

/** Detect and read a zip / tar / tar.gz archive, or an Amiga disk image. */
export async function readArchive(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readZip(bytes)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return readTar(await inflate(bytes, 'gzip'))
  // an Amiga floppy image is a plain run of sectors — most surviving AMOS
  // material (coverdisks, the PD library, the diskzines) is in this form
  if (isAdf(bytes)) return readAdf(bytes)
  return readTar(bytes)
}

/** Fill a MemoryVolume from archive entries (slashes become directories). */
export function volumeFromEntries(entries: ArchiveEntry[]): MemoryVolume {
  const vol = new MemoryVolume()
  for (const e of entries) {
    const segs = e.path.split('/').filter((s) => s !== '' && s !== '.')
    if (segs.length > 0) vol.write(segs, e.data)
  }
  return vol
}
