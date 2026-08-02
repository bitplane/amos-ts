/**
 * The AMOS `Samples` bank (bank 5) — the AMOS side of the audio layer.
 *
 * Paula itself is `../amiga/paula.ts`: the clock, the period arithmetic, the
 * volume range and the sink boundary. What is left here is a FILE FORMAT AMOS
 * invented and parses in `GetSam` (+Music.s), which the chip never sees — the
 * same rule that keeps `bobBltcon0` out of `blitter.ts`.
 */

export interface SampleEntry {
  name: string
  /** default playback rate in Hz */
  freq: number
  pcm: Int8Array
}

/**
 * Format (from GetSam in +Music.s): u16 count, then count u32 offsets
 * (relative to bank start), each pointing at { name[8], freq: u16,
 * length: u32, signed 8-bit PCM }.
 */
export function parseSampleBank(data: Uint8Array): SampleEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 2) return []
  const count = view.getUint16(0)
  const out: SampleEntry[] = []
  for (let i = 0; i < count; i++) {
    const tableOff = 2 + i * 4
    if (tableOff + 4 > data.length) break
    const off = view.getUint32(tableOff)
    if (off === 0 || off + 14 > data.length) {
      out.push({ name: '', freq: 0, pcm: new Int8Array(0) })
      continue
    }
    let name = ''
    for (let k = 0; k < 8; k++) name += String.fromCharCode(data[off + k]!)
    const freq = view.getUint16(off + 8)
    const length = view.getUint32(off + 10)
    const end = Math.min(off + 14 + length, data.length)
    out.push({
      name: name.trim(),
      freq,
      pcm: new Int8Array(data.buffer, data.byteOffset + off + 14, Math.max(0, end - (off + 14))),
    })
  }
  return out
}
