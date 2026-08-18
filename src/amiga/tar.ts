/**
 * TAR, the ustar layout.
 *
 * MOVED HERE from `src/runtime` alongside `./zip.ts`, and for the same
 * reason. Sizes are octal text, the name is split across a 100-byte field and
 * a 155-byte prefix, and everything is padded to 512.
 *
 * Only regular files come back. Type 0 and type "0" are both regular, which
 * is not a quirk of this reader: the field is a character and a NUL there
 * means the same as the digit, because the earliest tars left it empty.
 */
export interface ArchiveEntry {
  path: string
  data: Uint8Array
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
