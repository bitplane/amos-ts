/** MacPaint 1.x: 512-byte header followed by PackBits-compressed 576x720 mono pixels. */

export interface MacPaintImage {
  width: 576
  height: 720
  pixels: Uint8Array
}

export function decodeMacPaint(data: Uint8Array): MacPaintImage | null {
  const size = 576 * 720 / 8
  if (data.length <= 512 || data[0] !== 0 || data[1] !== 0 || data[2] !== 0 || data[3] !== 0) return null
  const bits = new Uint8Array(size)
  let src = 512
  let dst = 0
  while (src < data.length && dst < size) {
    const op = (data[src++]! << 24) >> 24
    if (op >= 0) {
      const n = op + 1
      if (src + n > data.length || dst + n > size) return null
      bits.set(data.subarray(src, src + n), dst)
      src += n
      dst += n
    } else if (op !== -128) {
      const n = 1 - op
      if (src >= data.length || dst + n > size) return null
      bits.fill(data[src++]!, dst, dst + n)
      dst += n
    }
  }
  if (dst !== size || src !== data.length) return null
  const pixels = new Uint8Array(576 * 720)
  for (let i = 0; i < pixels.length; i++) pixels[i] = (bits[i >>> 3]! >>> (7 - (i & 7))) & 1
  return { width: 576, height: 720, pixels }
}
