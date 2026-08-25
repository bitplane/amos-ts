import { parsePacPic, type PacPicture } from './pacpic'

/**
 * Resource bank decoder — the bank behind the Interface language and the
 * Resource keywords (Dia_GetPuzzle, +Lib.s:14943).
 *
 * A resource bank is an ordinary AmBk memory bank whose 8-char name starts
 * "Reso" (checked via `cmp.l #"Reso",-8(a0)`). Payload layout, verified
 * byte-for-byte against AMOSPro_Default_Resource.Abk:
 *
 *   +0   word  section count (1..3)
 *   +2   long  offset of the graphics section (0 = absent)
 *   +6   long  offset of the messages section
 *   +10  long  offset of the programs section
 *   (+14 three section-length longs — writer bookkeeping, never read)
 *
 * Graphics section (Dia_RScOpen +Lib.s:20995, InResourceUnpack 14998):
 *   word nImages; nImages longs — 1-based offset table, offsets relative to
 *   the section base (`lsl.w #2; move.l -4+2(a0,d0.w)`); then word nColours,
 *   word mode ($8000 = hires, $4 = laced), 32 RGB4 palette words (passed to
 *   screen creation by Resource Screen Open). Each image is a bare
 *   $06071963 packed bitmap — the parsePacPic format with no screen header.
 *
 * Messages section (Dia_FMess +Lib.s:23073): consecutive records
 *   {pad byte, length byte, chars}; message n is found by walking n-1
 *   records (`move.b 1(a0),d1; lea 2(a0,d1.w),a0`); a negative length byte
 *   means out of range.
 *
 * Programs section (Dialog Box +Lib.s:14808, Dia_OpenChannel 19936):
 *   word count; count longs — 1-based offset table relative to the section
 *   base; each program is a word length followed by the ASCII dialog script.
 */

export interface ResourceGraphics {
  count: number
  nColors: number
  /** BPLCON0-style: $8000 hires, $4 laced */
  mode: number
  /** RGB4, 32 entries */
  palette: number[]
  /** 1-based, decoded lazily and cached; null when out of range */
  image(n: number): PacPicture | null
}

export interface ResourceBank {
  graphics: ResourceGraphics | null
  messages: string[] | null
  /** dialog scripts (Interface language source), program n = programs[n-1] */
  programs: string[] | null
}

const latin1 = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

export function isResourceBankName(name: string): boolean {
  return name.startsWith('Reso')
}

export function parseResourceBank(data: Uint8Array): ResourceBank {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const sections = v.getUint16(0)
  const offOf = (i: number): number => (sections >= i + 1 ? v.getUint32(2 + i * 4) : 0)

  let graphics: ResourceGraphics | null = null
  const gOff = offOf(0)
  if (gOff !== 0) {
    const count = v.getUint16(gOff)
    const tail = gOff + 2 + count * 4
    const nColors = v.getUint16(tail)
    const mode = v.getUint16(tail + 2)
    const palette: number[] = []
    for (let i = 0; i < 32; i++) palette.push(v.getUint16(tail + 4 + i * 2) & 0xfff)
    const cache = new Map<number, PacPicture | null>()
    graphics = {
      count,
      nColors,
      mode,
      palette,
      image(n: number): PacPicture | null {
        if (n < 1 || n > count) return null
        const hit = cache.get(n)
        if (hit !== undefined) return hit
        let pic: PacPicture | null
        try {
          pic = parsePacPic(data.subarray(gOff + v.getUint32(gOff + 2 + (n - 1) * 4)))
        } catch {
          pic = null
        }
        cache.set(n, pic)
        return pic
      },
    }
  }

  let messages: string[] | null = null
  const mOff = offOf(1)
  if (mOff !== 0) {
    // the walk has no explicit count: stop at a negative length byte
    // (Dia_FMess's out-of-range check) or at the next section's start
    let end = data.length
    for (const o of [offOf(0), offOf(2)]) if (o > mOff && o < end) end = o
    messages = []
    let p = mOff
    while (p + 1 < end) {
      const len = data[p + 1]!
      if (len & 0x80) break
      messages.push(latin1(data.subarray(p + 2, p + 2 + len)))
      p += 2 + len
    }
  }

  let programs: string[] | null = null
  const pOff = offOf(2)
  if (pOff !== 0) {
    const count = v.getUint16(pOff)
    programs = []
    for (let i = 1; i <= count; i++) {
      const off = pOff + v.getUint32(pOff + 2 + (i - 1) * 4)
      const len = v.getUint16(off)
      programs.push(latin1(data.subarray(off + 2, off + 2 + len)))
    }
  }

  return { graphics, messages, programs }
}
