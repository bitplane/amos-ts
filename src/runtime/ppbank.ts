/**
 * AMOS's "PPbk" bank container (+CompExt.s:686-767 / 492-553) — the header
 * `Ppload` and `Ppsave` wrap around a PowerPacked payload.
 *
 * NOT part of powerpacker.library, which is why it is here and not beside the
 * codec in ../amiga. PP20 is the format a ROM library defines; PPbk is a
 * sixteen-byte header AMOS invented to carry a bank NUMBER and its Bnk_Bit*
 * flags alongside the crunched bytes, and its definition is in AMOS's own
 * assembler source. A shared layer holds mechanism; a bank number is policy.
 *
 * ## Where the payload lands on load, which looks wrong and is not
 *
 * `ppLoad`'s memory-bank branch (+CompExt.s:490-527) reserves `banklen+16`,
 * writes a size at block+0, sets TempBuffer to block+4, and hands
 * `L_LoadUncrunch` a d2 of block+8. It then builds the bank node AT block+0,
 * which puts the name field
 * at block+16 and the data at block+24. Read that far and the payload appears
 * to land at block+8, eight bytes below where `Bnk.GetAdr` will look, with the
 * name falling on the number and flags words.
 *
 * It does not, because d2 is not the destination. `L_LoadUncrunch`
 * (+CompExt.s:645-651) does `move.l d2,a0 / lea 8(a0),a1 / add.l d3,a0` and
 * then `jsr _LVOppDecrunchBuffer(a6)`: a0 walks to the end of the crunched
 * bytes, and the destination a1 is d2 PLUS EIGHT. So the payload lands at
 * block+16, its name on the name field and its data at block+24.
 *
 * The object-bank branch settles the register convention without needing the
 * library's autodocs. At +CompExt.s:530-538 it reserves `banklen+8`, commented
 * "+ Securite pp", passes the buffer start as d2, and then reads the
 * decrunched result back from `TempBuffer+8`. Same eight bytes, same meaning,
 * and that branch is the one the three PPbk files in the corpus exercise.
 *
 * Three sums agree with it. `banklen` is `B_Length`'s answer, `datalen+8`, so
 * the allocation is `datalen+24` and a node with its data at +24 fits it to
 * the byte. The node length written at block+4 is `datalen+16`, which is what
 * `Bnk.Reserve` writes for the same bank (+Lib.s:8455). And the number, flags
 * and spare pokes go to block+8 through block+15, the gap between the list
 * header and the name, so they overwrite nothing that was loaded.
 *
 * No defect, and nothing here to reproduce. Written down because the reading
 * that says otherwise is the natural one, and it took `L_LoadUncrunch` to
 * rule out.
 */
import { DEFAULT_EFFICIENCY, pp20Crunch, pp20Decrunch } from '../amiga/powerpacker'

export interface PpBank {
  /** the bank number recorded in the header */
  number: number
  /** the AMOS bank flag word (Bnk_Bit* bits) */
  flags: number
  /**
   * The bank's eight-character name, which travels INSIDE the crunched
   * payload rather than in the PPbk header.
   *
   * `B_Copie2Buffer` (+CompExt.s:800-808) copies a memory bank with
   * `subq.l #8,a0` before the transfer, backing up from the bank's data
   * pointer onto the eight name bytes that `Bnk.Reserve` wrote at
   * node+16 (+Lib.s:8500-8504), and `B_Length` (+CompExt.s:772-780) sizes
   * the copy `length-8` to match. So a saved memory bank is name + data
   * and the sixteen-byte header carries no name at all.
   *
   * An object bank has none: `B_Length` takes the `.BB` branch, whose
   * comment is "Pas le nom" (+CompExt.s:782), and copies a bob count and
   * the images instead.
   */
  name?: string
  /** the decrunched bank payload, name already split off */
  data: Uint8Array
}

/** an object bank -- Bnk_BitBob or Bnk_BitIcon (+Equ.s:1839-1840) */
const objectBank = (flags: number): boolean => (flags & 0x0c) !== 0

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
  const payload = pp20Decrunch(file.subarray(16))
  if (objectBank(flags)) return { number, flags, data: payload }
  if (payload.length < 8) throw new Error('not a PPbk bank')
  // trailing spaces off, the way the bank loader hands a name over
  const name = String.fromCharCode(...payload.subarray(0, 8)).replace(/\s+$/, '')
  return { number, flags, name, data: payload.subarray(8) }
}

/** Build a PPbk file wrapping a PP20-crunched payload. */
export function writePpBank(bank: PpBank, eff: readonly number[] = DEFAULT_EFFICIENCY): Uint8Array {
  let payload = bank.data
  if (!objectBank(bank.flags)) {
    const named = new Uint8Array(8 + payload.length)
    const name = (bank.name ?? '').padEnd(8, ' ')
    for (let i = 0; i < 8; i++) named[i] = name.charCodeAt(i) & 0xff
    named.set(payload, 8)
    payload = named
  }
  const pp = pp20Crunch(payload, eff)
  const out = new Uint8Array(16 + pp.length)
  const dv = new DataView(out.buffer)
  out[0] = 0x50 // 'P'
  out[1] = 0x50 // 'P'
  out[2] = 0x62 // 'b'
  out[3] = 0x6b // 'k'
  dv.setUint16(4, bank.number & 0xffff)
  dv.setUint16(6, bank.flags & 0xffff)
  // "Longueur banque / buffer de crunch" is B_Length's answer, which for a
  // memory bank is `length-8` -- the payload WITH its name, not the data
  dv.setUint32(8, payload.length)
  dv.setUint32(12, pp.length) // crunched PP20 length
  out.set(pp, 16)
  return out
}
