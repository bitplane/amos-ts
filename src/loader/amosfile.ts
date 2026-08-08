import { BinReader } from './binreader'

/**
 * .AMOS container: 16-byte signature, u32 tokenized-source length, source,
 * then optionally "AmBs" + u16 bank count + banks.
 *
 * Standalone .Abk files are a single bank without the AmBs wrapper.
 */
export interface AmosFile {
  /** true when the banks came from an AmBs list (Load erases all banks first) */
  bankList?: boolean
  signature: string
  source: Uint8Array
  banks: Bank[]
  /** non-fatal oddities found while parsing */
  diagnostics: string[]
}

export type Bank = SpriteBank | MemoryBank

export interface SpriteBank {
  kind: 'sprites' | 'icons'
  sprites: Sprite[]
  /** 32 Amiga RGB4 palette entries */
  palette: number[]
}

export interface Sprite {
  /** width in pixels (stored as words in the file) */
  width: number
  height: number
  depth: number
  hotX: number
  hotY: number
  /** planar image data, width/16*2 * height * depth bytes */
  data: Uint8Array
}

export interface MemoryBank {
  kind: 'memory'
  number: number
  /** 0 = any/fast, 1 = chip ram */
  memType: number
  name: string
  flags: number
  data: Uint8Array
}

/**
 * Signature strings vary a lot in the wild ("AMOS Pro101v...", "AMOS Basic
 * v1.34", "AMOS Pro   V1.00", ...) — anything starting like this is accepted.
 */
const SIGNATURE_RE = /^AMOS (Basic|Pro)/

/**
 * Every view this reader hands out is a `subarray` of the bytes it was given,
 * so a caller that mutates one is mutating the file. That is deliberate and
 * cheap — a program's source and its banks are big — but it makes ONE thing
 * about the argument load-bearing: `.slice()` on a view of it has to COPY.
 *
 * For a `Uint8Array` it does. For a Node `Buffer` it does NOT: `Buffer` extends
 * `Uint8Array` and overrides `slice` as a deprecated alias of `subarray`, so
 * `bankData.slice(a, b)` answers a window onto the same memory and every write
 * lands in the bank. TypeScript sees a `Uint8Array` and says nothing.
 *
 * That cost real time. `readFileSync` answers a Buffer, so `amosrun` handed
 * one straight in while every test wrapped it in `new Uint8Array(...)`; EasyLife's
 * `Tag List$` expands a template by patching a copy of it, and the copy was
 * the bank. The first call to a template worked, corrupted it, and the second
 * walked a patched pointer chain off the end of the body. Tests green, CLI
 * crashing, the difference invisible in either file.
 *
 * So the reader normalises here, once, rather than every consumer remembering.
 * The check is the prototype rather than `Buffer.isBuffer`, because this
 * module must not know that Node exists.
 */
export function parseAmosFile(input: Uint8Array): AmosFile {
  const bytes = Object.getPrototypeOf(input) === Uint8Array.prototype ? input : new Uint8Array(input)
  const r = new BinReader(bytes)
  const diagnostics: string[] = []
  const signature = r.peekStr(16)
  if (signature.startsWith('AmSp') || signature.startsWith('AmIc') || signature.startsWith('AmBk')) {
    // bare .Abk bank file
    return { signature: signature.slice(0, 4), source: new Uint8Array(0), banks: parseBankList(r, 1, diagnostics), diagnostics }
  }
  if (signature.startsWith('AmBs')) {
    // bare multi-bank .Abk ("save all banks")
    r.skip(4)
    const count = r.u16()
    return { signature: 'AmBs', source: new Uint8Array(0), banks: parseBankList(r, count, diagnostics), bankList: true, diagnostics }
  }
  r.skip(16)
  if (!SIGNATURE_RE.test(signature)) {
    diagnostics.push(`unknown signature ${JSON.stringify(signature)}`)
  }
  const srcLen = r.u32()
  const source = r.raw(srcLen)
  let banks: Bank[] = []
  let bankList = false
  if (r.remaining >= 6 && r.peekStr(4) === 'AmBs') {
    r.skip(4)
    const count = r.u16()
    banks = parseBankList(r, count, diagnostics)
    bankList = true
  } else if (r.remaining > 0) {
    diagnostics.push(`${r.remaining} trailing bytes after source, no AmBs marker`)
  }
  return { signature, source, banks, bankList, diagnostics }
}

function parseBankList(r: BinReader, count: number, diagnostics: string[]): Bank[] {
  const banks: Bank[] = []
  for (let i = 0; i < count && r.remaining >= 4; i++) {
    const magic = r.str(4)
    if (magic === 'AmSp' || magic === 'AmIc') {
      banks.push(parseSpriteBank(r, magic === 'AmSp' ? 'sprites' : 'icons'))
    } else if (magic === 'AmBk') {
      banks.push(parseMemoryBank(r))
    } else {
      diagnostics.push(`unknown bank magic ${JSON.stringify(magic)} at offset ${r.pos - 4}`)
      break
    }
  }
  if (r.remaining > 0) diagnostics.push(`${r.remaining} bytes after last bank`)
  return banks
}

function parseSpriteBank(r: BinReader, kind: 'sprites' | 'icons'): SpriteBank {
  const count = r.u16()
  const sprites: Sprite[] = []
  for (let i = 0; i < count; i++) {
    const widthWords = r.u16()
    const height = r.u16()
    const depth = r.u16()
    const hotX = r.u16()
    const hotY = r.u16()
    const data = r.raw(widthWords * 2 * height * depth)
    sprites.push({ width: widthWords * 16, height, depth, hotX, hotY, data })
  }
  const palette: number[] = []
  for (let i = 0; i < 32; i++) palette.push(r.u16())
  return { kind, sprites, palette }
}

function parseMemoryBank(r: BinReader): MemoryBank {
  const number = r.u16()
  const memType = r.u16()
  const lenFlags = r.u32()
  const flags = lenFlags >>> 24
  // One longword carries both, exactly as AMOS reads it back (LB_Bank
  // +Lib.s:4090): `and.l #$0FFFFFFF,d2 / subq.l #8,d2` is the data length,
  // less the 8-byte name+header that follows it, and `tst.l d3 / bpl` tests
  // BIT 31 alone for Data-versus-Work. Chip-versus-Fast is not in here at all
  // — it is the memType word at +2, which AMOS reads separately.
  //
  // NOTE: the two masks overlap on bits 24-27, and that is the file format's
  // shape rather than a mistake here. It cannot bite: the only flag AMOS ever
  // sets is bit 31, and a bank would have to exceed 16MB for the length to
  // reach bit 24. The shift is by 24 rather than 28 so that `flags` lands in
  // the same 0..255 space as the `BNK` bits everything downstream compares
  // against; bit 31 arrives as 0x80.
  const len = (lenFlags & 0x0fffffff) - 8
  const name = r.str(8)
  const data = r.raw(len)
  return { kind: 'memory', number, memType, name: name.replace(/\s+$/, ''), flags, data }
}
