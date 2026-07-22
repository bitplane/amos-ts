import { BinReader } from './binreader'

/**
 * .AMOS container: 16-byte signature, u32 tokenized-source length, source,
 * then optionally "AmBs" + u16 bank count + banks.
 *
 * Standalone .Abk files are a single bank without the AmBs wrapper.
 */
export interface AmosFile {
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

export function parseAmosFile(bytes: Uint8Array): AmosFile {
  const r = new BinReader(bytes)
  const diagnostics: string[] = []
  const signature = r.peekStr(16)
  if (signature.startsWith('AmSp') || signature.startsWith('AmIc') || signature.startsWith('AmBk')) {
    // bare .Abk bank file
    return { signature: signature.slice(0, 4), source: new Uint8Array(0), banks: parseBankList(r, 1, diagnostics), diagnostics }
  }
  r.skip(16)
  if (!SIGNATURE_RE.test(signature)) {
    diagnostics.push(`unknown signature ${JSON.stringify(signature)}`)
  }
  const srcLen = r.u32()
  const source = r.raw(srcLen)
  let banks: Bank[] = []
  if (r.remaining >= 6 && r.peekStr(4) === 'AmBs') {
    r.skip(4)
    const count = r.u16()
    banks = parseBankList(r, count, diagnostics)
  } else if (r.remaining > 0) {
    diagnostics.push(`${r.remaining} trailing bytes after source, no AmBs marker`)
  }
  return { signature, source, banks, diagnostics }
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
  // stored length includes the 8 bytes of length+flags word and name? — the
  // data length is lenFlags minus the 8-byte header that follows the length.
  const len = (lenFlags & 0x0fffffff) - 8
  const name = r.str(8)
  const data = r.raw(len)
  return { kind: 'memory', number, memType, name: name.replace(/\s+$/, ''), flags, data }
}
