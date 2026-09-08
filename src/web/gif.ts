/** A deliberately small GIF89a writer for file-browser previews. */

export interface GifFrame {
  width: number
  height: number
  rgba: Uint8ClampedArray
  /** hundredths of a second */
  delay: number
}

const word = (out: number[], n: number): void => { out.push(n & 0xff, (n >>> 8) & 0xff) }

/** RGB332: one fixed palette keeps animation export cheap and deterministic. */
function palette(): number[] {
  const out: number[] = []
  for (let i = 0; i < 256; i++) {
    out.push(Math.round(((i >>> 5) & 7) * 255 / 7))
    out.push(Math.round(((i >>> 2) & 7) * 255 / 7))
    out.push(Math.round((i & 3) * 255 / 3))
  }
  return out
}

function pixels(f: GifFrame): Uint8Array {
  const out = new Uint8Array(f.width * f.height)
  for (let i = 0; i < out.length; i++) {
    const r = f.rgba[i * 4] ?? 0
    const g = f.rgba[i * 4 + 1] ?? 0
    const b = f.rgba[i * 4 + 2] ?? 0
    out[i] = (r & 0xe0) | ((g & 0xe0) >>> 3) | (b >>> 6)
  }
  return out
}

function lzw(data: Uint8Array): number[] {
  const bytes: number[] = []
  let bits = 0
  let held = 0
  let width = 9
  const code = (n: number): void => {
    held |= n << bits
    bits += width
    while (bits >= 8) {
      bytes.push(held & 0xff)
      held >>>= 8
      bits -= 8
    }
  }

  const reset = (): Map<string, number> => {
    width = 9
    return new Map<string, number>()
  }
  let dict = reset()
  let next = 258
  code(256)
  if (data.length > 0) {
    let prefix = data[0]!
    for (let i = 1; i < data.length; i++) {
      const suffix = data[i]!
      const key = `${prefix},${suffix}`
      const found = dict.get(key)
      if (found !== undefined) {
        prefix = found
        continue
      }
      code(prefix)
      if (next < 4096) {
        dict.set(key, next++)
        // The decoder creates a dictionary entry only after reading the next
        // code, so the writer changes width one allocation later. Advancing
        // at equality makes code 254 ten bits while a conforming decoder is
        // still reading nine, corrupting streams at the 256-colour boundary.
        if (next > (1 << width) && width < 12) width++
      } else {
        code(256)
        dict = reset()
        next = 258
      }
      prefix = suffix
    }
    code(prefix)
  }
  code(257)
  if (bits > 0) bytes.push(held & 0xff)
  const out: number[] = []
  for (let at = 0; at < bytes.length; at += 255) out.push(Math.min(255, bytes.length - at), ...bytes.slice(at, at + 255))
  out.push(0)
  return out
}

export function encodeGif(frames: readonly GifFrame[]): Uint8Array {
  if (frames.length === 0) throw new Error('animation has no frames')
  const width = frames[0]!.width
  const height = frames[0]!.height
  if (frames.some((f) => f.width !== width || f.height !== height)) throw new Error('GIF frames differ in size')
  const out = [...new TextEncoder().encode('GIF89a')]
  word(out, width); word(out, height)
  out.push(0xf7, 0, 0, ...palette())
  // loop forever
  out.push(0x21, 0xff, 11, ...new TextEncoder().encode('NETSCAPE2.0'), 3, 1, 0, 0, 0)
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0x04)
    word(out, Math.max(1, Math.min(0xffff, Math.round(f.delay))))
    out.push(0, 0)
    out.push(0x2c); word(out, 0); word(out, 0); word(out, width); word(out, height); out.push(0)
    out.push(8, ...lzw(pixels(f)))
  }
  out.push(0x3b)
  return Uint8Array.from(out)
}
