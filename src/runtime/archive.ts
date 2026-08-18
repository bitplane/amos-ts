import { MemoryVolume } from '../amiga/vfs'
import { isAdf, readAdf } from '../amiga/adf'
import { inflate } from '../amiga/zip'
import { readTar, type ArchiveEntry } from '../amiga/tar'
import { unarchive } from '../amiga/xadmaster'

/**
 * Filling the filesystem from something a user dropped on the page.
 *
 * The READERS moved out. ZIP, TAR and LHA live in `../amiga` as
 * `zip.ts`, `tar.ts` and `lha.ts`, and reach a caller through
 * `../amiga/xadmaster.ts`, which is AmigaOS's own answer to "what is in this
 * archive". None of them is an AMOS format, so none of them belonged here.
 *
 * What stays is the POLICY, which is this port's and not AmigaOS's: the order
 * things are tried, the fact that an unrecognised file is given to the tar
 * reader as a last guess, and that a floppy image is an archive at all. xad
 * has disk clients for exactly that and this port has `adf.ts` instead, so
 * the ADF case is handled here rather than pretended to be a client.
 */

export type { ArchiveEntry }

/**
 * Detect and read a zip, tar, tar.gz or lha archive, or an Amiga disk image.
 *
 * The order is deliberate. gzip is unwrapped first because a `.tar.gz` is two
 * formats and only the outer one is visible. ADF is tried before the fallback
 * because a floppy image is a plain run of sectors with no magic anywhere,
 * and most surviving AMOS material — coverdisks, the PD library, the
 * diskzines — is in that form. Anything still unclaimed goes to the tar
 * reader, which returns nothing rather than throwing.
 */
export async function readArchive(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return readTar(await inflate(bytes, 'gzip'))
  const { files } = await unarchive(bytes)
  if (files.length > 0) return files.map((f) => ({ path: f.path, data: f.data }))
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
