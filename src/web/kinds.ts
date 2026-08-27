/**
 * What is this file, in one answer, for the Files panel.
 *
 * ../amiga/datatypes.ts ends by saying that a caller wanting one answer for
 * any file asks it first and falls through, and that the fallthrough is the
 * caller's policy and deliberately not there. This is that caller. The three
 * identification subsystems ../amiga/xadmaster.ts names in its own header do
 * the work, and what is written here is only the ORDER they are asked in and
 * what the answer is called.
 *
 * ## Why datatypes is asked late rather than first
 *
 * MacPaint's whole mask is one byte of $00, so it matches any file starting
 * with a zero byte. A 15-sample ProTracker module starts with the first
 * character of a sample name and those are routinely blank, so asking
 * datatypes before the module sniffer files half the tracker modules ever
 * written under "MacPaint". `obtainDataType` prefers the longest mask and
 * that settles a tie between two descriptors, but nothing rescues a
 * descriptor that is the only match. So the specific questions go first and
 * the ten shipped descriptors catch what is left.
 *
 * ## Bytes, not names
 *
 * An extension is consulted twice and both times only where the bytes cannot
 * answer: a plain-text AMOS listing has no header to identify it, and a
 * tokenised program may have no extension. Everything else here reads the
 * file. The corpus is full of extensionless programs, and `Mother.3do` sits
 * beside `Manual.3DO` in one shipped drawer, so a rule built on names would
 * be wrong in both directions.
 *
 * DOM-free, so the suite can reach it.
 */
import { obtainDataType, GID } from '../amiga/datatypes'
import { SHIPPED_DATATYPES } from '../amiga/datatypes.gen'
import { recogFile } from '../amiga/xadmaster'
import { recogBuffer, type XfdBufferInfo } from '../amiga/xfdmaster'
import { detectModule, MOD_FORMAT_NAMES, type ModFormat } from '../amiga/modformat'
import { isAdf, adfInfo } from '../amiga/adf'
import { isAmosProgram } from '../loader/program'
import { ICON_MAGIC } from '../amiga/icon'

/**
 * The kinds a row can be.
 *
 * Coarser than the formats underneath, because this is what decides how a row
 * BEHAVES: whether it has a play button, whether it opens, whether the twisty
 * shows anything. `data` is the honest answer for a file nothing recognised
 * and is not a failure.
 */
export type KindGroup =
  | 'drawer'
  | 'program'
  | 'disk'
  | 'archive'
  | 'packed'
  | 'music'
  | 'picture'
  | 'sound'
  | 'text'
  | 'document'
  | 'bank'
  | 'icon'
  | 'data'

export interface Kind {
  group: KindGroup
  /** what to call it in the row: "ILBM", "LhA", "ProTracker" */
  name: string
  /** the machine can be given this: run it, mount it, unpack it */
  openable: boolean
  /** its members can be listed without putting it into the machine */
  container: boolean
  /** which replayer, when the group is `music` */
  format?: ModFormat
}

const kind = (group: KindGroup, name: string, extra: Partial<Kind> = {}): Kind => ({
  group,
  name,
  openable: false,
  container: false,
  ...extra,
})

/** `AmBk`, the header every AMOS bank file starts with (../loader/amosfile.ts) */
const isBank = (d: Uint8Array): boolean =>
  d.length >= 4 && d[0] === 0x41 && d[1] === 0x6d && d[2] === 0x42 && d[3] === 0x6b

/** `do_Magic` is WB_DISKMAGIC, and a .info without it is not an icon */
const isIcon = (d: Uint8Array): boolean => d.length >= 2 && ((d[0]! << 8) | d[1]!) === ICON_MAGIC

/**
 * gzip, which xad has no client for and which hides the format that matters.
 *
 * ../runtime/archive.ts unwraps it first for the same reason: a `.tar.gz` is
 * two formats and only the outer one is visible from here.
 */
const isGzip = (d: Uint8Array): boolean => d.length >= 2 && d[0] === 0x1f && d[1] === 0x8b

/**
 * Is this text?
 *
 * Asked last and only of what nothing else claimed. A NUL says binary
 * outright; past that it is the proportion of bytes outside the printable
 * range plus the three whitespace characters a listing uses. An AMOS listing
 * saved from the editor is Latin-1, so the test cannot be UTF-8 validity.
 */
function looksLikeText(d: Uint8Array): boolean {
  const n = Math.min(d.length, 512)
  if (n === 0) return false
  let odd = 0
  for (let i = 0; i < n; i++) {
    const b = d[i]!
    if (b === 0) return false
    if (b === 9 || b === 10 || b === 13) continue
    if (b < 32 || b === 127) odd++
  }
  return odd / n < 0.1
}

/**
 * One answer for one file.
 *
 * Wants the WHOLE file, which is worth saying because most of what it asks
 * would be happy with the first kilobyte. `isAdf` is why: a floppy image has
 * no magic, so it is recognised by its length being one of the three Amiga
 * geometries, and a prefix has the wrong length by definition. The cost of
 * that is paid by the panel caching the answer per path and size, not by
 * reading less.
 */
export function identify(name: string, bytes: Uint8Array | null): Kind {
  if (bytes === null || bytes.length === 0) return kind('data', 'empty')

  // AMOS first, because it is what this port is for and because both of its
  // spellings are cheap to test
  if (isAmosProgram(bytes)) return kind('program', 'AMOS program', { openable: true })
  if (isBank(bytes)) return kind('bank', 'AMOS banks', { container: true })

  // A disk image is a plain run of sectors with no magic anywhere, so `isAdf`
  // is a length against the three floppy geometries and then "DOS" at 0
  if (isAdf(bytes)) {
    const label = adfInfo(bytes).label
    return kind('disk', label === '' ? 'Amiga disk' : `Amiga disk ${label}:`, {
      openable: true,
      container: true,
    })
  }

  // holds other files
  if (isGzip(bytes)) return kind('archive', 'gzip', { openable: true })
  const arc = recogFile(bytes)
  if (arc !== null) return kind('archive', arc.name, { openable: true, container: true })

  // is packed. `recogBuffer` fills in the slave's own packer name, which is
  // the name the Amiga decruncher answers to and not one invented here
  const bi: XfdBufferInfo = { sourceBuffer: bytes }
  if (recogBuffer(bi)) return kind('packed', bi.packerName ?? 'packed')

  const mod = detectModule(bytes)
  if (mod !== null) return kind('music', MOD_FORMAT_NAMES[mod], { format: mod })

  if (isIcon(bytes)) return kind('icon', 'Workbench icon')

  // the ten shipped descriptors, now that nothing greedier can be caught by
  // MacPaint's one-byte mask
  const dt = obtainDataType(bytes, SHIPPED_DATATYPES)
  if (dt !== null) {
    if (dt.groupID === GID.PICTURE) return kind('picture', dt.name)
    if (dt.groupID === GID.SOUND) return kind('sound', dt.name)
    if (dt.groupID === GID.TEXT) return kind('text', dt.name)
    if (dt.groupID === GID.DOCUMENT) return kind('document', dt.name)
    return kind('data', dt.name)
  }

  // The two places a name is allowed to decide. A listing typed into the
  // editor and saved is plain text with no header, and `Load` will take it.
  if (/\.amos$/i.test(name)) return kind('program', 'AMOS listing', { openable: true })
  if (looksLikeText(bytes)) return kind('text', 'text')
  return kind('data', 'data')
}
