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
/** `do_Version` — WB_DISKVERSION, checked beside the magic by 34.2. */
export const ICON_VERSION = 1

/** `sizeof(struct DiskObject)` */
const DISK_OBJECT_BYTES = 78

/** `sizeof(struct DrawerData)` — a NewWindow at 48 bytes, then two longs. */
const DRAWER_DATA_BYTES = 56

/** `sizeof(struct Image)`, before its bitplanes. */
const IMAGE_BYTES = 20

/**
 * `do_Type`: what the icon is FOR. `WBDISK` through `WBKICK`, icon.h's own
 * numbering, and the reason a drawer and a tool look different on Workbench.
 */
export const WB_TYPE: Readonly<Record<number, string>> = {
  1: 'disk',
  2: 'drawer',
  3: 'tool',
  4: 'project',
  5: 'trashcan',
  6: 'device',
  7: 'kickstart',
  8: 'appicon',
}

/** one `struct Image` and its bitplanes, straight out of the file */
export interface IconImage {
  width: number
  height: number
  /** planes; a classic icon is 2 and a 2.x one is usually 3 or 4 */
  depth: number
  /**
   * The bitplanes, in the layout `graphics.library` blits from: one word per
   * 16 pixels, every row of a plane before the next plane begins.
   */
  data: Uint8Array
}

/** a `.info`, as far as this port reads one */
export interface Icon {
  /** `do_Type`, and `WB_TYPE` names it */
  type: number
  /** the normal image, or null for an icon that renders as nothing */
  normal: IconImage | null
  /** the second image, shown while the icon is selected */
  selected: IconImage | null
  /** `do_DefaultTool`, the program a project opens with */
  defaultTool: string
  toolTypes: string[]
  /** `do_StackSize`, which is a number a program was given and not a size */
  stackSize: number
  /** was there a DrawerData, which is what makes this a drawer rather than a tool */
  drawer: boolean
}

/**
 * Read a `.info`, or null.
 *
 * The walk is `GetDiskObject`'s: the pointers in a written-out DiskObject are
 * meaningless as addresses and are used only as present-or-absent flags, so
 * each non-zero one says "the thing I point at follows, in this order".
 *
 * Null for anything that is not a DiskObject, and null for a walk that runs
 * off the end. A truncated icon is not an icon with no tool types, and a
 * caller has to be able to tell those apart.
 */
export function readIcon(bytes: Uint8Array): Icon | null {
  if (bytes.length < DISK_OBJECT_BYTES) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length)
  if (dv.getUint16(0) !== ICON_MAGIC || dv.getUint16(2) !== ICON_VERSION) return null

  const gadgetRender = dv.getUint32(0x16)
  const selectRender = dv.getUint32(0x1a)
  // A BYTE, not a word. `do_Type` is `UBYTE do_Type; UBYTE do_Pad;` and
  // reading the pair gave 1024, 512 and 768 for the three commonest icons in
  // the corpus, which are 4, 2 and 3 shifted up a byte. The pad is
  // uninitialised in plenty of real icons, so it is not even a constant zero:
  // 167 files answered $04fe.
  const type = dv.getUint8(0x30)
  const defaultTool = dv.getUint32(0x32)
  const toolTypes = dv.getUint32(0x36)
  const drawerData = dv.getUint32(0x42)
  const toolWindow = dv.getUint32(0x46)
  const stackSize = dv.getUint32(0x4a)

  let p = DISK_OBJECT_BYTES
  if (drawerData) p += DRAWER_DATA_BYTES

  /**
   * A `struct Image` and, if it has any, its bitplanes.
   *
   * `ImageData` being zero is the case this reader got wrong first time: the
   * Image is still there and still 20 bytes, it simply has no pixels behind
   * it, and real icons do exercise that.
   */
  const readImage = (): IconImage | null | false => {
    if (p + IMAGE_BYTES > bytes.length) return false
    const w = dv.getUint16(p + 4)
    const h = dv.getUint16(p + 6)
    const depth = dv.getUint16(p + 8)
    const data = dv.getUint32(p + 10)
    p += IMAGE_BYTES
    if (!data) return null
    // one word per 16 pixels, every row, every plane
    const size = ((w + 15) >> 4) * 2 * h * depth
    if (p + size > bytes.length) return false
    const planes = bytes.subarray(p, p + size)
    p += size
    return { width: w, height: h, depth, data: planes }
  }

  /** a longword count and that many bytes, NUL terminated inside the count */
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

  let normal: IconImage | null = null
  let selected: IconImage | null = null
  if (gadgetRender) {
    const img = readImage()
    if (img === false) return null
    normal = img
  }
  if (selectRender) {
    const img = readImage()
    if (img === false) return null
    selected = img
  }

  let tool = ''
  if (defaultTool) {
    const s = readString()
    if (s === null) return null
    tool = s
  }

  const types: string[] = []
  if (toolTypes) {
    if (p + 4 > bytes.length) return null
    // the SIZE of the NULL-terminated pointer array, so one more entry than
    // there are strings
    const count = dv.getUint32(p) / 4 - 1
    p += 4
    if (!Number.isInteger(count) || count < 0 || count > bytes.length / 4) return null
    for (let i = 0; i < count; i++) {
      const s = readString()
      if (s === null) return null
      types.push(s)
    }
  }

  // do_ToolWindow follows and is not read; naming it keeps the walk honest
  void toolWindow
  return { type, normal, selected, defaultTool: tool, toolTypes: types, stackSize, drawer: drawerData !== 0 }
}

/**
 * The Tool Types of an icon, in file order.
 *
 * The original entry point and the one AMCAF's routine 342 is written
 * against, now the narrow half of `readIcon` rather than its own walk. Two
 * walks over the same structure was one too many the moment the second one
 * had to keep the images.
 */
export function iconToolTypes(bytes: Uint8Array): string[] | null {
  return readIcon(bytes)?.toolTypes ?? null
}
