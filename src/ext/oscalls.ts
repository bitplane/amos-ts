/** A traced Amiga library call made by 68k extension code. */
export interface OsCall {
  chain: string
  library?: string
  lvo: number
}

/** AMOS workspace slots whose identity is established by extension binaries. */
const A5_BASES: Readonly<Record<number, string>> = {
  [-0x18a6]: 'intuition.library',
  [-0x18ae]: 'graphics.library',
  [0x2b8]: 'dos.library',
}

/** Extension-owned slots reached through a block pointer stored in AMOS. */
const CHAIN_BASES: Readonly<Record<string, string>> = {
  // JD-Int
  'a5+520>+20': 'intuition.library',
  'a5+520>+24': 'graphics.library',
  // OS DevKit 1.61: routine 0 opens these names and stores each returned base
  // at the corresponding offset in the block whose pointer is at $228(a5).
  'a5+552>+680': 'dos.library',
  'a5+552>+684': 'graphics.library',
  'a5+552>+688': 'intuition.library',
  'a5+552>+692': 'gadtools.library',
  'a5+552>+696': 'workbench.library',
  'a5+552>+700': 'icon.library',
  'a5+552>+704': 'utility.library',
  'a5+552>+708': 'asl.library',
  'a5+552>+712': 'locale.library',
  'a5+552>+716': 'datatypes.library',
  'a5+552>+720': 'stoneplayer.library',
  'a5+552>+724': 'lowlevel.library',
  'a5+552>+728': 'iffparse.library',
  'a5+552>+732': 'layers.library',
  'a5+552>+736': 'commodities.library',
}

const moveaDest = (op: number, src: number): number =>
  (op & 0xf1ff) === (0x2068 | src) ? (op >> 9) & 7 : -1

export function libraryForChain(chain: string): string | undefined {
  if (chain === 'exec') return 'exec.library'
  const direct = /^a5([+-]\d+)$/.exec(chain)
  return CHAIN_BASES[chain] ?? (direct ? A5_BASES[Number(direct[1])] : undefined)
}

/**
 * Trace library calls in one code range. Starting at a routine boundary is
 * important: address-register provenance must not leak in from its neighbour.
 */
export function scanOsCalls(code: Uint8Array, from = 0, to = code.length): OsCall[] {
  const dv = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const calls: OsCall[] = []
  const source: Array<string | null> = [null, null, null, null, null, null, null, null]
  for (let i = from; i + 2 <= to; i += 2) {
    const op = dv.getUint16(i)
    if ((op & 0xf1ff) === 0x2078 && i + 4 <= to && dv.getUint16(i + 2) === 4) {
      source[(op >> 9) & 7] = 'exec'
      i += 2
      continue
    }
    if ((op & 0xf1ff) === 0x2079 && i + 6 <= to && dv.getUint32(i + 2) === 4) {
      source[(op >> 9) & 7] = 'exec'
      i += 4
      continue
    }
    if ((op & 0xf1f8) === 0x41e8 && i + 4 <= to) {
      const s = op & 7
      const d = (op >> 9) & 7
      const off = dv.getInt16(i + 2)
      source[d] = source[s] === null ? null : `${source[s]}>${off >= 0 ? '+' : ''}${off}`
      i += 2
      continue
    }
    if ((op & 0xf1f8) === 0x2050) {
      source[(op >> 9) & 7] = source[op & 7] ?? null
      continue
    }
    const d5 = moveaDest(op, 5)
    if (d5 >= 0 && i + 4 <= to) {
      const slot = dv.getInt16(i + 2)
      source[d5] = `a5${slot >= 0 ? '+' : ''}${slot}`
      i += 2
      continue
    }
    let stepped = false
    for (let s = 0; s < 8 && !stepped; s++) {
      const d = moveaDest(op, s)
      if (d < 0 || source[s] === null || i + 4 > to) continue
      const off = dv.getInt16(i + 2)
      source[d] = `${source[s]}>${off >= 0 ? '+' : ''}${off}`
      i += 2
      stepped = true
    }
    if (stepped) continue
    if ((op & 0xfff8) === 0x4ea8 && i + 4 <= to) {
      const chain = source[op & 7] ?? '?'
      const lvo = dv.getInt16(i + 2)
      const library = libraryForChain(chain)
      if (lvo < 0) calls.push(library ? { chain, library, lvo } : { chain, lvo })
      i += 2
      continue
    }
    if ((op & 0xf1c0) === 0x2040 || (op & 0xf1c0) === 0x2140) {
      const d = (op >> 9) & 7
      if ((op & 0x01c0) === 0x0040) source[d] = null
    }
  }
  return calls
}
