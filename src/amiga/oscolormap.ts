/** Managed graphics.library ColorMap operations used by OS DevKit 1.61. */

export interface NativeColorMap {
  readonly count: number
  readonly components: Uint32Array
  freed: boolean
}

export function allocColorMap(count: number): NativeColorMap {
  const n = Math.max(0, count | 0)
  return { count: n, components: new Uint32Array(n * 3), freed: false }
}

/** FreeColorMap(NULL) is harmless; retained objects become unusable. */
export function freeColorMap(colorMap: NativeColorMap | null): void {
  if (colorMap) colorMap.freed = true
}

const liveIndex = (colorMap: NativeColorMap | null, index: number): number =>
  colorMap && !colorMap.freed && index >= 0 && index < colorMap.count ? index * 3 : -1

const repeatNibble = (value: number): number => ((value & 0xf) * 0x1111_1111) >>> 0

/** SetRGB4CM: expand the hardware nibble across the library's 32-bit component. */
export function setRgb4ColorMap(
  colorMap: NativeColorMap | null,
  index: number,
  red: number,
  green: number,
  blue: number,
): void {
  const at = liveIndex(colorMap, index)
  if (at < 0 || !colorMap) return
  colorMap.components[at] = repeatNibble(red)
  colorMap.components[at + 1] = repeatNibble(green)
  colorMap.components[at + 2] = repeatNibble(blue)
}

/** GetRGB4: return the most-significant nibble of each component as `$0RGB`. */
export function getRgb4(colorMap: NativeColorMap | null, index: number): number {
  const at = liveIndex(colorMap, index)
  if (at < 0 || !colorMap) return 0
  return ((colorMap.components[at]! >>> 20) & 0xf00)
    | ((colorMap.components[at + 1]! >>> 24) & 0x0f0)
    | (colorMap.components[at + 2]! >>> 28)
}

/** SetRGB32CM: components are already left-justified unsigned longs. */
export function setRgb32ColorMap(
  colorMap: NativeColorMap | null,
  index: number,
  red: number,
  green: number,
  blue: number,
): void {
  const at = liveIndex(colorMap, index)
  if (at < 0 || !colorMap) return
  colorMap.components[at] = red >>> 0
  colorMap.components[at + 1] = green >>> 0
  colorMap.components[at + 2] = blue >>> 0
}

/** GetRGB32's table payload (three longs per colour, with no header). */
export function getRgb32(colorMap: NativeColorMap | null, first: number, count: number): Uint32Array {
  if (!colorMap || colorMap.freed || count <= 0 || first < 0 || first >= colorMap.count) return new Uint32Array()
  const take = Math.min(count, colorMap.count - first)
  return colorMap.components.slice(first * 3, (first + take) * 3)
}
