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

/** `struct View`: viewport/copper pointers, signed Y/X offsets, modes long. */
export interface NativeView {
  viewPort: number
  lofCopper: number
  shfCopper: number
  dyOffset: number
  dxOffset: number
  modes: number
}

export const newNativeView = (): NativeView => ({
  viewPort: 0, lofCopper: 0, shfCopper: 0, dyOffset: 0, dxOffset: 0, modes: 0,
})

/**
 * Routine 1713 exactly, including its defect: the final long write targets
 * `$c`, replacing Y and X with the high/low halves of `modes`; v_Modes at
 * `$10` is never changed.
 */
export function setOsDevKitView(
  view: NativeView | null,
  viewPort: number,
  _x: number,
  _y: number,
  modes: number,
): void {
  if (!view) return
  view.viewPort = viewPort >>> 0
  view.dxOffset = modes << 16 >> 16
  // The big-endian long lands as high word Y, low word X.
  view.dyOffset = modes >> 16
}
