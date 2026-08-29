/**
 * 68000 instruction timings, for costing AMOS routines out of the shipped
 * assembler rather than out of a fitted constant.
 *
 * Numbers are from the M68000 8-/16-/32-Bit Microprocessors User's Manual,
 * section 8 (instruction execution times), for the 68000 with a 16-bit bus.
 * They are bus-clock cycles at 7.09379 MHz, so a PAL frame is 141,876 of them.
 * Every count here assumes no chip-RAM contention: on an A500 the display DMA
 * steals bus slots from the CPU, and that is a separate multiplier applied
 * where the screen is known, not something folded into an instruction's cost.
 *
 * Two things the manual counts that this does not: the prefetch pipeline (a
 * taken branch refills it, which is already in the branch numbers) and the
 * data-dependent part of MULU/DIVU, which is averaged.
 */

/** Operand size, from the mnemonic's suffix. `.l` costs more on memory operands. */
export type Size = 'b' | 'w' | 'l'

/**
 * Effective-address calculation time, table 8-1. Byte and word share a column;
 * long has its own. `Dn`/`An` are free because the operand is already in the
 * register file.
 */
export function eaTime(operand: string, size: Size): number {
  const o = operand.trim()
  const long = size === 'l'
  if (/^[da][0-7]$/i.test(o) || /^sp$/i.test(o)) return 0
  if (/^#/.test(o)) return long ? 8 : 4
  if (/^-\(a[0-7]\)$/i.test(o)) return long ? 10 : 6
  if (/^\(a[0-7]\)\+$/i.test(o)) return long ? 8 : 4
  if (/^\(a[0-7]\)$/i.test(o)) return long ? 8 : 4
  // d8(An,Xn) — an index register makes it the expensive mode
  if (/\(\s*a[0-7]\s*,/i.test(o) || /\(\s*pc\s*,/i.test(o)) return long ? 14 : 10
  // d16(An) and d16(PC)
  if (/\(\s*(a[0-7]|pc)\s*\)$/i.test(o)) return long ? 12 : 8
  // a bare symbol is absolute; the assembler picks .w when it fits, and AMOS
  // addresses everything through a register, so absolute is rare and long.
  return long ? 16 : 12
}

/** MOVE's destination column, table 8-5: writing costs less than reading. */
function moveDest(operand: string, size: Size): number {
  const o = operand.trim()
  const long = size === 'l'
  if (/^[da][0-7]$/i.test(o) || /^sp$/i.test(o)) return 0
  if (/^-\(a[0-7]\)$/i.test(o)) return long ? 8 : 4
  if (/^\(a[0-7]\)\+?$/i.test(o)) return long ? 8 : 4
  if (/\(\s*a[0-7]\s*,/i.test(o)) return long ? 14 : 10
  if (/\(\s*a[0-7]\s*\)$/i.test(o)) return long ? 12 : 8
  return long ? 16 : 12
}

const isReg = (o: string): boolean => /^[da][0-7]$/i.test(o.trim()) || /^sp$/i.test(o.trim())
const isImm = (o: string): boolean => o.trim().startsWith('#')

/**
 * A conditional branch has two costs and no way to know which one runs. Both
 * are reported so the caller can pick: the analyser walks the fall-through and
 * so pays `notTaken`, and a loop back-edge pays `taken`.
 */
export interface Cost {
  cycles: number
  /** a Bcc/DBcc's other arm, when it differs */
  taken?: number
}

/** shift and rotate counts are `n` in `6+2n`; an unknown register count averages 4 */
function shiftCount(src: string | undefined): number {
  if (src === undefined) return 4
  const m = /^#(\$?)([0-9a-fA-F]+)$/.exec(src.trim())
  if (!m) return 4
  return parseInt(m[2]!, m[1] ? 16 : 10)
}

/**
 * Cost one assembled instruction. `mnem` is lower-cased without its size
 * suffix, `size` is the suffix (defaulting per instruction), `ops` the operand
 * list already split on the top-level comma.
 */
export function instrCost(mnem: string, size: Size, ops: string[]): Cost {
  const src = ops[0]
  const dst = ops[1]
  const long = size === 'l'

  switch (mnem) {
    case 'move':
    case 'movea':
      return { cycles: 4 + eaTime(src ?? 'd0', size) + moveDest(dst ?? 'd0', size) }
    case 'moveq':
      return { cycles: 4 }
    case 'lea':
      // LEA computes the address and writes it to An; no operand fetch.
      return { cycles: /\(\s*a[0-7]\s*,/i.test(src ?? '') ? 12 : /\(\s*(a[0-7]|pc)\s*\)$/i.test(src ?? '') ? 8 : 12 }
    case 'pea':
      return { cycles: 12 + eaTime(src ?? '', 'l') }

    case 'add':
    case 'sub':
    case 'and':
    case 'or':
    case 'cmp':
    case 'eor': {
      const toReg = isReg(dst ?? '')
      if (toReg) {
        // <ea>,Dn — long with a register or immediate source is 8, else 6
        const base = long ? (isReg(src ?? '') || isImm(src ?? '') ? 8 : 6) : 4
        return { cycles: base + eaTime(src ?? '', size) }
      }
      // Dn,<ea> — read, modify, write
      return { cycles: (long ? 12 : 8) + eaTime(dst ?? '', size) }
    }
    case 'adda':
    case 'suba':
    case 'cmpa':
      return { cycles: (long ? 6 : 8) + eaTime(src ?? '', size) }
    case 'addi':
    case 'subi':
    case 'andi':
    case 'ori':
    case 'eori':
    case 'cmpi': {
      if (isReg(dst ?? '')) return { cycles: long ? 16 : 8 }
      return { cycles: (long ? 20 : 12) + eaTime(dst ?? '', size) }
    }
    case 'addq':
    case 'subq': {
      if (isReg(dst ?? '')) return { cycles: long || /^a[0-7]$/i.test(dst ?? '') ? 8 : 4 }
      return { cycles: (long ? 12 : 8) + eaTime(dst ?? '', size) }
    }

    case 'tst':
      return { cycles: 4 + eaTime(src ?? '', size) }
    case 'clr':
      return { cycles: isReg(src ?? '') ? (long ? 6 : 4) : (long ? 12 : 8) + eaTime(src ?? '', size) }
    case 'not':
    case 'neg':
      return { cycles: isReg(src ?? '') ? (long ? 6 : 4) : (long ? 12 : 8) + eaTime(src ?? '', size) }
    case 'ext':
      return { cycles: 4 }
    case 'swap':
      return { cycles: 4 }
    case 'exg':
      return { cycles: 6 }

    case 'mulu':
    case 'muls':
      // 38 + 2n where n counts source bits; 70 is the manual's typical figure
      return { cycles: 70 + eaTime(src ?? '', 'w') }
    case 'divu':
      return { cycles: 140 + eaTime(src ?? '', 'w') }
    case 'divs':
      return { cycles: 158 + eaTime(src ?? '', 'w') }

    case 'lsl':
    case 'lsr':
    case 'asl':
    case 'asr':
    case 'rol':
    case 'ror':
    case 'roxl':
    case 'roxr': {
      if (ops.length < 2) return { cycles: 8 + eaTime(src ?? '', 'w') } // memory shift, one bit
      return { cycles: (long ? 8 : 6) + 2 * shiftCount(src) }
    }

    case 'btst':
      return { cycles: isReg(dst ?? '') ? 6 : 4 + eaTime(dst ?? '', 'b') }
    case 'bset':
    case 'bclr':
    case 'bchg':
      return { cycles: isReg(dst ?? '') ? 8 : 8 + eaTime(dst ?? '', 'b') }

    case 'bra':
      return { cycles: 10 }
    case 'bsr':
      return { cycles: 18 }
    case 'jmp':
      return { cycles: /\(\s*a[0-7]\s*\)$/i.test(src ?? '') ? 8 : /\(\s*a[0-7]\s*,/i.test(src ?? '') ? 14 : 12 }
    case 'jsr':
      return { cycles: /^\(\s*a[0-7]\s*\)$/i.test((src ?? '').trim()) ? 16 : /\(\s*a[0-7]\s*,/i.test(src ?? '') ? 22 : 20 }
    case 'rts':
      return { cycles: 16 }
    case 'rte':
    case 'rtr':
      return { cycles: 20 }
    case 'nop':
      return { cycles: 4 }

    case 'movem': {
      const list = (isReg(src ?? '') || /[-/]/.test(src ?? '') ? src : dst) ?? ''
      const n = countRegs(list)
      const toMem = /^-?\(/.test((dst ?? '').trim())
      return { cycles: (toMem ? 8 : 12) + (long ? 8 : 4) * n }
    }

    case 'link':
      return { cycles: 16 }
    case 'unlk':
      return { cycles: 12 }

    default:
      // Scc, TAS, and anything unrecognised: a plain register op is 4, and
      // guessing low is safer than inventing a large number for one opcode.
      if (/^s(cc|cs|eq|ne|ge|gt|le|lt|hi|ls|mi|pl|vc|vs|t|f)$/.test(mnem)) return { cycles: isReg(src ?? '') ? 6 : 12 }
      return { cycles: 4 }
  }
}

/** `d0-d7/a0-a6` and friends: how many registers a MOVEM list moves. */
export function countRegs(list: string): number {
  let n = 0
  for (const part of list.split('/')) {
    const range = /^([da])([0-7])-\1?([0-7])$/.exec(part.trim())
    if (range) {
      n += Number(range[3]) - Number(range[2]) + 1
      continue
    }
    if (/^[da][0-7]$/i.test(part.trim())) n++
  }
  return n || 1
}

/** Bcc: 10 when taken, and 8 (short) or 12 (word) when it falls through. */
export function branchCost(short: boolean): Cost {
  return { cycles: short ? 8 : 12, taken: 10 }
}

/** DBcc: 10 while it loops, 14 on the iteration that falls out. */
export function dbccCost(): Cost {
  return { cycles: 14, taken: 10 }
}
