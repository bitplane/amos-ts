/**
 * AMOS's "PPbk" bank container (+CompExt.s:686-767 / 492-553) — the header
 * `Ppload` and `Ppsave` wrap around a PowerPacked payload.
 *
 * NOT part of powerpacker.library, which is why it is here and not beside the
 * codec in ../amiga. PP20 is the format a ROM library defines; PPbk is a
 * sixteen-byte header AMOS invented to carry a bank NUMBER and its Bnk_Bit*
 * flags alongside the crunched bytes, and its definition is in AMOS's own
 * assembler source. A shared layer holds mechanism; a bank number is policy.
 */
import { DEFAULT_EFFICIENCY, pp20Crunch, pp20Decrunch } from '../amiga/powerpacker'

export interface PpBank {
  /** the bank number recorded in the header */
  number: number
  /** the AMOS bank flag word (Bnk_Bit* bits) */
  flags: number
  /** the decrunched bank payload */
  data: Uint8Array
}

/** Parse a PPbk file: header + a PP20-crunched payload. */
export function parsePpBank(file: Uint8Array): PpBank {
  if (file.length < 16) throw new Error('not a PPbk bank')
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (String.fromCharCode(file[0]!, file[1]!, file[2]!, file[3]!) !== 'PPbk') {
    throw new Error('not a PPbk bank')
  }
  const number = dv.getUint16(4)
  const flags = dv.getUint16(6)
  // header: PPbk(4) number(2) flags(2) bankLen(4) ppLen(4) then the PP20 file
  const data = pp20Decrunch(file.subarray(16))
  return { number, flags, data }
}

/** Build a PPbk file wrapping a PP20-crunched payload. */
export function writePpBank(bank: PpBank, eff: readonly number[] = DEFAULT_EFFICIENCY): Uint8Array {
  const pp = pp20Crunch(bank.data, eff)
  const out = new Uint8Array(16 + pp.length)
  const dv = new DataView(out.buffer)
  out[0] = 0x50 // 'P'
  out[1] = 0x50 // 'P'
  out[2] = 0x62 // 'b'
  out[3] = 0x6b // 'k'
  dv.setUint16(4, bank.number & 0xffff)
  dv.setUint16(6, bank.flags & 0xffff)
  dv.setUint32(8, bank.data.length) // decrunched bank length
  dv.setUint32(12, pp.length) // crunched PP20 length
  out.set(pp, 16)
  return out
}
