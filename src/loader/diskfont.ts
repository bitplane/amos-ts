/**
 * Amiga diskfont format: the `Fonts:` drawer holds a `<name>.font`
 * descriptor (FontContentsHeader, ID $0F00) beside a `<name>/` drawer
 * with one loadable file per pixel size. Each size file is a standard
 * single-hunk executable whose code hunk starts with a `moveq/rts` stub
 * followed by a DiskFontHeader (ID $0F80) embedding the graphics.library
 * TextFont struct. Pointer fields (tf_CharData/CharLoc/CharSpace/
 * CharKern) are RELOC32 offsets from the hunk base, i.e. plain offsets
 * when loaded at 0 — verified against the fonts on the user's original
 * Amiga partition (2001/8, Pica/32, ...).
 */

export interface DiskFont {
  ySize: number
  style: number
  flags: number
  xSize: number
  baseline: number
  loChar: number
  hiChar: number
  /** FPF_PROPORTIONAL */
  proportional: boolean
  /** bytes per bitmap row */
  modulo: number
  /** ySize rows of `modulo` bytes — all glyphs side by side */
  charData: Uint8Array
  /** per char loChar..hiChar+1: [bit offset, bit width] */
  charLoc: Array<[number, number]>
  /** advance per char (proportional fonts), else null → xSize */
  charSpace: Int16Array | null
  /** pen offset before drawing each char, else null → 0 */
  charKern: Int16Array | null
}

export interface FontContentsEntry {
  /** path relative to Fonts: (e.g. "2001/8") */
  file: string
  ySize: number
  style: number
  flags: number
}

const FCH_ID = 0x0f00
const TFCH_ID = 0x0f02 // tagged variant, same layout for our purposes
const DFH_ID = 0x0f80
const HUNK_HEADER = 0x3f3
const HUNK_CODE = 0x3e9

/** parse a `.font` descriptor; null when it isn't one (corrupt files
 * exist in the wild — the partition's Novell.font is garbage) */
export function parseFontDescriptor(bytes: Uint8Array): FontContentsEntry[] | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 4) return null
  const id = v.getUint16(0)
  if (id !== FCH_ID && id !== TFCH_ID) return null
  const n = v.getUint16(2)
  const out: FontContentsEntry[] = []
  for (let i = 0; i < n; i++) {
    const off = 4 + i * 260
    if (off + 260 > bytes.length) return null
    let file = ''
    for (let p = off; p < off + 256 && bytes[p] !== 0; p++) file += String.fromCharCode(bytes[p]!)
    out.push({
      file,
      ySize: v.getUint16(off + 256),
      style: bytes[off + 258]!,
      flags: bytes[off + 259]!,
    })
  }
  return out
}

/** parse a font size file (hunk executable with a DiskFontHeader) */
export function parseDiskFont(bytes: Uint8Array): DiskFont | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 0x20 || v.getUint32(0) !== HUNK_HEADER) return null
  // header: 0 resident names, table size, first, last, sizes[], then hunks
  let p = 8
  const tableSize = v.getUint32(p)
  p += 12 + tableSize * 4 // table size, first, last, sizes
  if (p + 8 > bytes.length || v.getUint32(p) !== HUNK_CODE) return null
  const codeLen = v.getUint32(p + 4) * 4
  const base = p + 8
  if (base + codeLen > bytes.length) return null
  const code = bytes.subarray(base, base + codeLen)
  const cv = new DataView(code.buffer, code.byteOffset, code.byteLength)
  // DiskFontHeader after the 4-byte stub + Node (14): dfh_FileID at +0x12
  if (cv.getUint16(0x12) !== DFH_ID) return null
  // TextFont at +0x3A (after dfh_Revision/Segment/Name[32]); its Message
  // header is 20 bytes → scalar fields at +0x4E
  const tf = 0x4e
  const ySize = cv.getUint16(tf)
  const style = code[tf + 2]!
  const flags = code[tf + 3]!
  const xSize = cv.getUint16(tf + 4)
  const baseline = cv.getUint16(tf + 6)
  const loChar = code[tf + 12]!
  const hiChar = code[tf + 13]!
  const charDataOff = cv.getUint32(tf + 14)
  const modulo = cv.getUint16(tf + 18)
  const charLocOff = cv.getUint32(tf + 20)
  const charSpaceOff = cv.getUint32(tf + 24)
  const charKernOff = cv.getUint32(tf + 28)
  const nChars = hiChar - loChar + 2 // +1 for the "notdef" glyph
  if (charDataOff + ySize * modulo > codeLen || charLocOff + nChars * 4 > codeLen) return null
  const charLoc: Array<[number, number]> = []
  for (let i = 0; i < nChars; i++) {
    charLoc.push([cv.getUint16(charLocOff + i * 4), cv.getUint16(charLocOff + i * 4 + 2)])
  }
  const words = (off: number): Int16Array | null => {
    if (off === 0 || off + nChars * 2 > codeLen) return null
    const a = new Int16Array(nChars)
    for (let i = 0; i < nChars; i++) a[i] = cv.getInt16(off + i * 2)
    return a
  }
  return {
    ySize,
    style,
    flags,
    xSize,
    baseline,
    loChar,
    hiChar,
    proportional: (flags & 0x20) !== 0,
    modulo,
    charData: code.slice(charDataOff, charDataOff + ySize * modulo),
    charLoc,
    charSpace: words(charSpaceOff),
    charKern: words(charKernOff),
  }
}

/** glyph pixel test: row y, x within the glyph's bit span */
export function glyphBit(f: DiskFont, ch: number, x: number, y: number): boolean {
  const idx = ch >= f.loChar && ch <= f.hiChar ? ch - f.loChar : f.hiChar - f.loChar + 1
  const [bitOff, width] = f.charLoc[idx]!
  if (x < 0 || x >= width || y < 0 || y >= f.ySize) return false
  const bit = bitOff + x
  const byte = f.charData[y * f.modulo + (bit >> 3)] ?? 0
  return ((byte >> (7 - (bit & 7))) & 1) !== 0
}

/** metrics for one char: pen offset (kern), glyph width, advance */
export function glyphMetrics(f: DiskFont, ch: number): { kern: number; width: number; advance: number } {
  const idx = ch >= f.loChar && ch <= f.hiChar ? ch - f.loChar : f.hiChar - f.loChar + 1
  return {
    kern: f.charKern?.[idx] ?? 0,
    width: f.charLoc[idx]![1],
    advance: f.charSpace?.[idx] ?? f.xSize,
  }
}
