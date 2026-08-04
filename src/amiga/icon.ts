/**
 * icon.library — the `.info` file, as far as its Tool Types.
 *
 * A Workbench icon is a `struct DiskObject` written straight out to disk with
 * its pointers left in place. The pointers are meaningless as addresses, but
 * they are not ignored: each non-zero one says "the thing I point at follows,
 * in this order". So reading the file means walking the same sequence
 * `GetDiskObject` walks, using the pointers only as present/absent flags.
 *
 *     struct DiskObject           78 bytes
 *       do_Magic       +$00       $E310
 *       do_Version     +$02
 *       do_Gadget      +$04       struct Gadget, 44 bytes
 *         gg_Flags       +$0c(gadget)  = +$10 here
 *         gg_GadgetRender+$12(gadget)  = +$16 here
 *         gg_SelectRender+$16(gadget)  = +$1a here
 *       do_Type        +$30
 *       do_DefaultTool +$32
 *       do_ToolTypes   +$36       <- the field AMCAF's routine 342 reads,
 *                                    `movea.l $36(a1),a1`, which is how this
 *                                    offset was confirmed rather than assumed
 *       do_CurrentX    +$3a
 *       do_CurrentY    +$3e
 *       do_DrawerData  +$42
 *       do_ToolWindow  +$46
 *       do_StackSize   +$4a
 *
 * then, each only if its pointer was non-zero: DrawerData (56 bytes), the
 * gadget's image, the select image, the DefaultTool string, the ToolTypes
 * array, the ToolWindow string.
 *
 * An image is a 20-byte `struct Image` followed by its bitplanes -- but only
 * when `ImageData` is itself non-zero, which is the case this reader got wrong
 * first time round and which real icons do exercise.
 *
 * Strings are a longword byte-count and then that many bytes, NUL terminated
 * inside the count. The ToolTypes array is a longword giving the size of the
 * pointer array, so it holds `size/4 - 1` strings -- the array is NULL
 * terminated and the terminator is counted.
 */

/** `do_Magic` — WB_DISKMAGIC. A file without it is not an icon. */
export const ICON_MAGIC = 0xe310

/** `sizeof(struct DiskObject)` */
const DISK_OBJECT_BYTES = 78

/** `sizeof(struct DrawerData)` — a NewWindow at 48 bytes, then two longs. */
const DRAWER_DATA_BYTES = 56

/** `sizeof(struct Image)`, before its bitplanes. */
const IMAGE_BYTES = 20

/**
 * The Tool Types of an icon, in file order.
 *
 * Answers `null` when the bytes are not a DiskObject at all, or when the walk
 * would run off the end -- a truncated icon is not a zero-tooltype icon, and
 * the caller has to be able to tell those apart. An icon that simply has no
 * tool types answers an empty array.
 */
export function iconToolTypes(bytes: Uint8Array): string[] | null {
  if (bytes.length < DISK_OBJECT_BYTES) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
  if (dv.getUint16(0) !== ICON_MAGIC) return null

  const gadgetRender = dv.getUint32(0x16)
  const selectRender = dv.getUint32(0x1a)
  const defaultTool = dv.getUint32(0x32)
  const toolTypes = dv.getUint32(0x36)
  const drawerData = dv.getUint32(0x42)
  const toolWindow = dv.getUint32(0x46)

  let p = DISK_OBJECT_BYTES
  if (drawerData) p += DRAWER_DATA_BYTES

  /** skip a `struct Image` and, if it has any, its bitplane data */
  const skipImage = (): boolean => {
    if (p + IMAGE_BYTES > bytes.length) return false
    const w = dv.getUint16(p + 4)
    const h = dv.getUint16(p + 6)
    const depth = dv.getUint16(p + 8)
    const data = dv.getUint32(p + 10)
    // one word per 16 pixels, every row, every plane
    p += IMAGE_BYTES + (data ? ((w + 15) >> 4) * 2 * h * depth : 0)
    return p <= bytes.length
  }

  /** a longword count and that many bytes, NUL terminated within the count */
  const readString = (): string | null => {
    if (p + 4 > bytes.length) return null
    const n = dv.getUint32(p)
    p += 4
    if (n > bytes.length - p) return null
    let end = p
    while (end < p + n && bytes[end] !== 0) end++
    let s = ''
    for (let i = p; i < end; i++) s += String.fromCharCode(bytes[i]!)
    p += n
    return s
  }

  if (gadgetRender && !skipImage()) return null
  if (selectRender && !skipImage()) return null
  if (defaultTool && readString() === null) return null
  if (!toolTypes) return []

  if (p + 4 > bytes.length) return null
  // the size of the NULL-terminated pointer array, so one more entry than there
  // are strings
  const count = dv.getUint32(p) / 4 - 1
  p += 4
  if (!Number.isInteger(count) || count < 0 || count > bytes.length / 4) return null

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const s = readString()
    if (s === null) return null
    out.push(s)
  }
  // do_ToolWindow follows and is not read; naming it keeps the walk honest
  void toolWindow
  return out
}
