/** Fixed-layout graphics.library records manipulated directly by OS DevKit. */

/** `struct RasInfo`: next/BitMap pointers followed by signed X/Y offsets. */
export interface NativeRasInfo {
  next: number
  bitMap: number
  xOffset: number
  yOffset: number
}

export const newNativeRasInfo = (): NativeRasInfo => ({ next: 0, bitMap: 0, xOffset: 0, yOffset: 0 })

export function setRasInfo(info: NativeRasInfo | null, next: number, bitMap: number, xOffset: number, yOffset: number): void {
  if (!info) return
  info.next = next >>> 0
  info.bitMap = bitMap >>> 0
  info.xOffset = (xOffset << 16) >> 16
  info.yOffset = (yOffset << 16) >> 16
}
