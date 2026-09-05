/** Complete native structures manipulated by OS DevKit routines 1370-1438. */

export interface NativeBorder {
  left: number
  top: number
  frontPen: number
  backPen: number
  drawMode: number
  count: number
  dots: number
  next: number
}

export const newNativeBorder = (): NativeBorder => ({
  left: 0, top: 0, frontPen: 0, backPen: 0, drawMode: 0, count: 0, dots: 0, next: 0,
})

export function setBorderDraw(border: NativeBorder | null, frontPen: number, backPen: number, drawMode: number): void {
  if (!border) return
  border.frontPen = frontPen & 0xff
  border.backPen = backPen & 0xff
  border.drawMode = drawMode & 0xff
}

export function setBorderCorner(border: NativeBorder | null, left: number, top: number): void {
  if (!border) return
  border.left = left & 0xffff
  border.top = top & 0xffff
}

export function setBorderDots(border: NativeBorder | null, count: number, dots: number): void {
  if (!border) return
  border.count = count & 0xff
  border.dots = dots >>> 0
}

export interface NativePropInfo {
  flags: number
  horizPot: number
  vertPot: number
  horizBody: number
  vertBody: number
  width: number
  height: number
  horizInc: number
  vertInc: number
  left: number
  top: number
}

export function setPropInfo(
  prop: NativePropInfo | null,
  flags: number,
  horizPot: number,
  vertPot: number,
  horizBody: number,
  vertBody: number,
): void {
  if (!prop) return
  Object.assign(prop, {
    flags: flags & 0xffff,
    horizPot: horizPot & 0xffff,
    vertPot: vertPot & 0xffff,
    horizBody: horizBody & 0xffff,
    vertBody: vertBody & 0xffff,
  })
}

export interface NativeStringInfo {
  buffer: number
  undoBuffer: number
  bufferPos: number
  maxChars: number
  dispPos: number
  undoPos: number
  numChars: number
  dispCount: number
  cLeft: number
  cTop: number
  extension: number
  longInt: number
  keyMap: number
}

export function setStringBuffers(
  info: NativeStringInfo | null,
  buffer: number,
  undoBuffer: number,
  bufferPos: number,
  maxChars: number,
  dispPos: number,
): void {
  if (!info) return
  Object.assign(info, {
    buffer: buffer >>> 0,
    undoBuffer: undoBuffer >>> 0,
    bufferPos: bufferPos & 0xffff,
    maxChars: maxChars & 0xffff,
    dispPos: dispPos & 0xffff,
  })
}

export function setStringInfo(
  info: NativeStringInfo | null,
  buffer: number,
  undoBuffer: number,
  bufferPos: number,
  maxChars: number,
  dispPos: number,
  extension: number,
  longInt: number,
  keyMap: number,
): void {
  if (!info) return
  setStringBuffers(info, buffer, undoBuffer, bufferPos, maxChars, dispPos)
  info.extension = extension >>> 0
  info.longInt = longInt | 0
  info.keyMap = keyMap >>> 0
}

/** `struct Image`, intuition.i: left/top/size/depth/data/pick/onoff/next. */
export interface NativeImage {
  left: number
  top: number
  width: number
  height: number
  depth: number
  data: number
  planePick: number
  planeOnOff: number
  next: number
}

export const newNativeImage = (): NativeImage => ({
  left: 0, top: 0, width: 0, height: 0, depth: 0, data: 0, planePick: 0, planeOnOff: 0, next: 0,
})

export function setImageBody(
  image: NativeImage | null,
  left: number,
  top: number,
  width: number,
  height: number,
  depth: number,
  data: number,
): void {
  if (!image) return
  Object.assign(image, {
    left: left & 0xffff,
    top: top & 0xffff,
    width: width & 0xffff,
    height: height & 0xffff,
    depth: depth & 0xffff,
    data: data >>> 0,
  })
}

export function setImagePlanes(image: NativeImage | null, planePick: number, planeOnOff: number): void {
  if (!image) return
  image.planePick = planePick & 0xff
  image.planeOnOff = planeOnOff & 0xff
}

/** intuition PointInImage, with the packed point unpacked by the wrapper. */
export function pointInImage(image: NativeImage, x: number, y: number): boolean {
  const left = (image.left << 16) >> 16
  const top = (image.top << 16) >> 16
  return x >= left && y >= top && x < left + image.width && y < top + image.height
}
