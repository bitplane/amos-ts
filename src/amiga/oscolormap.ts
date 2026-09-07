/** Managed graphics.library ColorMap operations used by OS DevKit 1.61. */

export interface NativeColorMap {
  readonly count: number
  readonly components: Uint32Array
  readonly references: Uint16Array
  readonly exclusive: Uint8Array
  freed: boolean
}

export function allocColorMap(count: number): NativeColorMap {
  const n = Math.max(0, count | 0)
  return { count: n, components: new Uint32Array(n * 3), references: new Uint16Array(n), exclusive: new Uint8Array(n), freed: false }
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

export function findColor(colorMap: NativeColorMap | null, red: number, green: number, blue: number, maxPen: number): number {
  if (!colorMap || colorMap.freed || colorMap.count === 0) return -1
  const last = Math.min(colorMap.count - 1, maxPen < 0 ? colorMap.count - 1 : maxPen); let best = -1; let distance = Number.POSITIVE_INFINITY
  for (let pen = 0; pen <= last; pen++) {
    const at = pen * 3
    const dr = (colorMap.components[at]! >>> 16) - (red >>> 16); const dg = (colorMap.components[at + 1]! >>> 16) - (green >>> 16); const db = (colorMap.components[at + 2]! >>> 16) - (blue >>> 16)
    const next = dr * dr + dg * dg + db * db; if (next < distance) { distance = next; best = pen }
  }
  return best
}

export function obtainPen(colorMap: NativeColorMap | null, requested: number, red: number, green: number, blue: number, flags: number): number {
  if (!colorMap || colorMap.freed) return -1
  let pen = requested
  if (pen < 0) pen = [...colorMap.references].findIndex((refs, i) => refs === 0 && colorMap.exclusive[i] === 0)
  if (pen < 0 || pen >= colorMap.count || colorMap.exclusive[pen] !== 0 || ((flags & 1) !== 0 && colorMap.references[pen] !== 0)) return -1
  if ((flags & 2) === 0) setRgb32ColorMap(colorMap, pen, red, green, blue)
  colorMap.references[pen] = colorMap.references[pen]! + 1
  if ((flags & 1) !== 0) colorMap.exclusive[pen] = 1
  return pen
}

export function obtainBestPen(colorMap: NativeColorMap | null, red: number, green: number, blue: number): number {
  const pen = findColor(colorMap, red, green, blue, -1)
  if (pen >= 0 && colorMap) colorMap.references[pen] = colorMap.references[pen]! + 1
  return pen
}

export function releasePen(colorMap: NativeColorMap | null, pen: number): void {
  if (!colorMap || colorMap.freed || pen < 0 || pen >= colorMap.count || colorMap.references[pen] === 0) return
  colorMap.references[pen] = colorMap.references[pen]! - 1; if (colorMap.references[pen] === 0) colorMap.exclusive[pen] = 0
}
