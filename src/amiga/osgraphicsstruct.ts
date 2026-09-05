/** Fixed-layout graphics.library records manipulated directly by OS DevKit. */

/** Public 40-byte `struct BitMap`, including all eight plane pointers. */
export interface NativeBitMap {
  bytesPerRow: number
  rows: number
  flags: number
  depth: number
  pad: number
  planes: number[]
}

export const newNativeBitMap = (): NativeBitMap => ({
  bytesPerRow: 0, rows: 0, flags: 0, depth: 0, pad: 0, planes: Array<number>(8).fill(0),
})

/** Routine 1689's word/word/byte/byte writes at offsets `$0..$5`. */
export function setBitMapData(
  bitMap: NativeBitMap | null,
  bytesPerRow: number,
  rows: number,
  depth: number,
  flags: number,
): void {
  if (!bitMap) return
  bitMap.bytesPerRow = bytesPerRow & 0xffff
  bitMap.rows = rows & 0xffff
  bitMap.depth = depth & 0xff
  bitMap.flags = flags & 0xff
}

/**
 * Routine 1690's useful range. Its signed byte comparison accidentally accepts
 * negative indices and writes before `bm_Planes`; native corruption is omitted.
 */
export function setBitMapPlane(bitMap: NativeBitMap | null, plane: number, pointer: number): boolean {
  if (!bitMap || plane < 0 || plane >= bitMap.depth) return false
  bitMap.planes[plane] = pointer >>> 0
  return true
}

/** Routine 1694 rejects negative and out-of-depth indices and otherwise reads a long. */
export function bitMapPlane(bitMap: NativeBitMap | null, plane: number): number {
  if (!bitMap || plane < 0 || plane >= bitMap.depth) return 0
  return bitMap.planes[plane] ?? 0
}

/** Public prefix of graphics.library `struct SimpleSprite`, offsets `$0..$b`. */
export interface NativeSimpleSprite {
  posCtlData: number
  height: number
  x: number
  y: number
  number: number
}

export const newNativeSimpleSprite = (): NativeSimpleSprite => ({ posCtlData: 0, height: 0, x: 0, y: 0, number: 0 })

/** Routines 1741-1743: direct unsigned word writes into SimpleSprite. */
export function setSimpleSpriteHeight(sprite: NativeSimpleSprite | null, height: number): void {
  if (sprite) sprite.height = height & 0xffff
}

export function setSimpleSpriteNumber(sprite: NativeSimpleSprite | null, number: number): void {
  if (sprite) sprite.number = number & 0xffff
}

export function setSimpleSpritePosition(sprite: NativeSimpleSprite | null, x: number, y: number): void {
  if (!sprite) return
  sprite.x = x & 0xffff
  sprite.y = y & 0xffff
}

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

/** graphics.library InitView clears the complete public View record. */
export function initView(view: NativeView | null): void {
  if (!view) return
  Object.assign(view, newNativeView())
}

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

/** Complete public `struct ViewPort` fields through vp_RasInfo at `$24`. */
export interface NativeViewPort {
  next: number
  colorMap: number
  dspIns: number
  sprIns: number
  clrIns: number
  uCopIns: number
  dWidth: number
  dHeight: number
  dxOffset: number
  dyOffset: number
  modes: number
  spritePriority: number
  extendedModes: number
  rasInfo: number
}

export const newNativeViewPort = (): NativeViewPort => ({
  next: 0, colorMap: 0, dspIns: 0, sprIns: 0, clrIns: 0, uCopIns: 0,
  dWidth: 0, dHeight: 0, dxOffset: 0, dyOffset: 0, modes: 0,
  spritePriority: 0, extendedModes: 0, rasInfo: 0,
})

/** graphics.library InitVPort clears the complete public ViewPort record. */
export function initViewPort(viewPort: NativeViewPort | null): void {
  if (!viewPort) return
  Object.assign(viewPort, newNativeViewPort())
}

export function setViewPortBody(
  viewPort: NativeViewPort | null,
  x: number,
  y: number,
  width: number,
  height: number,
  modes: number,
  spritePriority: number,
): void {
  if (!viewPort) return
  viewPort.dxOffset = x & 0xffff
  viewPort.dyOffset = y & 0xffff
  viewPort.dWidth = width & 0xffff
  viewPort.dHeight = height & 0xffff
  viewPort.modes = modes & 0xffff
  // Routine 1719 uses move.w at $22 even though vp_SpritePriorities is a byte.
  // On 68k the high byte lands there and the low byte clobbers vp_ExtendedModes.
  const priorityWord = spritePriority & 0xffff
  viewPort.spritePriority = priorityWord >>> 8
  viewPort.extendedModes = priorityWord & 0xff
}

/** Routine 1725's missing `(a0)`: return the word at absolute address `$18`. */
export const osDevKitViewPortWidth = (absoluteWord18: number): number => absoluteWord18 & 0xffff

/** Routine 1728's wrong source register: dereference stale d0, not argument d3. */
export const osDevKitViewPortY = (viewPortFromD0: NativeViewPort): number => viewPortFromD0.dyOffset & 0xffff
