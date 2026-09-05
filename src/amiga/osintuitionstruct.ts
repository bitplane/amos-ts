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

/**
 * `struct IntuiMessage` after its 20-byte Exec Message header.  OS DevKit
 * routines 1547-1555 are straight reads of these fields at $14..$2c.
 */
export interface NativeIntuiMessage {
  class: number
  code: number
  qualifier: number
  iaddress: number
  mouseX: number
  mouseY: number
  seconds: number
  micros: number
  idcmpWindow: number
}

/** Apply the byte widths and signedness of those nine machine-code reads. */
export function nativeIntuiMessage(message: NativeIntuiMessage): NativeIntuiMessage {
  return {
    class: message.class >>> 0,
    code: message.code & 0xffff,
    qualifier: message.qualifier & 0xffff,
    iaddress: message.iaddress >>> 0,
    mouseX: (message.mouseX << 16) >> 16,
    mouseY: (message.mouseY << 16) >> 16,
    seconds: message.seconds >>> 0,
    micros: message.micros >>> 0,
    idcmpWindow: message.idcmpWindow >>> 0,
  }
}

/** `struct NotifyMessage.nm_NReq`, read by routine 1857 at offset $1a. */
export interface NativeNotifyMessage {
  request: number
}

export function notifyRequest(message: NativeNotifyMessage): number {
  return message.request >>> 0
}

/** `struct NotifyRequest.nr_UserData`, read by OS DevKit routine 1858 at +8. */
export interface NativeNotifyRequest {
  userData: number
}

export function notifyUserData(request: NativeNotifyRequest): number {
  return request.userData >>> 0
}

/** A graphics coordinate pair: two signed words, four bytes per entry. */
export interface NativeDot { x: number; y: number }

export function allocDots(count: number): NativeDot[] {
  return Array.from({ length: Math.max(0, count | 0) }, () => ({ x: 0, y: 0 }))
}

export function setDot(dots: NativeDot[], index: number, x: number, y: number): void {
  const dot = dots[index]
  if (dot) {
    dot.x = (x << 16) >> 16
    dot.y = (y << 16) >> 16
  }
}

/** Six-byte BooleanInfo: a word followed immediately by an unaligned long. */
export interface NativeBooleanInfo { flags: number; mask: number }

export const newNativeBooleanInfo = (): NativeBooleanInfo => ({ flags: 0, mask: 0 })

export function setBooleanInfo(info: NativeBooleanInfo, flags: number, mask: number): void {
  info.flags = flags & 0xffff
  info.mask = mask >>> 0
}

/** The public 44-byte `struct Gadget` fields OS DevKit exposes. */
export interface NativeGadget {
  next: number
  left: number
  top: number
  width: number
  height: number
  flags: number
  activation: number
  type: number
  render: number
  selectRender: number
  text: number
  mutualExclude: number
  specialInfo: number
  id: number
  userData: number
}

export const newNativeGadget = (): NativeGadget => ({
  next: 0, left: 0, top: 0, width: 0, height: 0,
  flags: 0, activation: 0, type: 0, render: 0, selectRender: 0,
  text: 0, mutualExclude: 0, specialInfo: 0, id: 0, userData: 0,
})

export function setGadgetBody(g: NativeGadget, left: number, top: number, width: number, height: number): void {
  g.left = left & 0xffff
  g.top = top & 0xffff
  g.width = width & 0xffff
  g.height = height & 0xffff
}

export function setGadgetFlags(g: NativeGadget, flags: number, activation: number, type: number): void {
  g.flags = flags & 0xffff
  g.activation = activation & 0xffff
  g.type = type & 0xffff
}

export function setGadgetRender(g: NativeGadget, render: number, selected: number): void {
  g.render = render >>> 0
  g.selectRender = selected >>> 0
}

export function setGadgetUser(g: NativeGadget, id: number, data: number): void {
  g.id = id & 0xffff
  g.userData = data >>> 0
}

/** OS DevKit's retained `NewScreen` definition used by its OpenScreen wrappers. */
export interface NativeScreenDefinition {
  left: number; top: number; width: number; height: number; depth: number
  detailPen: number; blockPen: number; viewModes: number; type: number
  font: number; title: number; bitMap: number
}

export const newNativeScreenDefinition = (): NativeScreenDefinition => ({
  left: 0, top: 0, width: 0, height: 0, depth: 0,
  detailPen: 0, blockPen: 0, viewModes: 0, type: 0,
  font: 0, title: 0, bitMap: 0,
})

export function setScreenDefinitionBody(
  s: NativeScreenDefinition, left: number, top: number, width: number, height: number, depth: number,
): void {
  s.left = left & 0xffff
  s.top = top & 0xffff
  s.width = width & 0xffff
  s.height = height & 0xffff
  s.depth = depth & 0xffff
}

/** The scalar/pointer fields read directly from public `struct Screen`. */
export interface NativeScreenFields {
  next: number; firstWindow: number; title: number; defaultTitle: number
  font: number; bitMap: number; layer: number
  width: number; height: number; depth: number
  detailPen: number; blockPen: number; mouseX: number; mouseY: number
  barHeight: number; viewModes: number; type: number
}

export const nativeScreenFields = (s: NativeScreenFields): NativeScreenFields => ({
  next: s.next >>> 0, firstWindow: s.firstWindow >>> 0,
  title: s.title >>> 0, defaultTitle: s.defaultTitle >>> 0,
  font: s.font >>> 0, bitMap: s.bitMap >>> 0, layer: s.layer >>> 0,
  width: s.width & 0xffff, height: s.height & 0xffff, depth: s.depth & 0xff,
  detailPen: s.detailPen & 0xff, blockPen: s.blockPen & 0xff,
  mouseX: (s.mouseX << 16) >> 16, mouseY: (s.mouseY << 16) >> 16,
  barHeight: s.barHeight & 0xff, viewModes: s.viewModes & 0xffff, type: s.type & 0xffff,
})

/** OS DevKit's private twelve-word DrawInfo pen defaults at $1b0..$1c7. */
export class NativeScreenDrawInfoPens {
  readonly pens = new Uint16Array(12)

  /** Routine 3005: nine V1 words, DETAIL through HIGHLIGHTTEXT. */
  defineV1(values: readonly number[]): void {
    for (let i = 0; i < 9; i++) this.pens[i] = values[i] ?? 0
  }

  /** Routine 3006: the three V2 bar pens immediately following V1. */
  defineV2(values: readonly number[]): void {
    for (let i = 0; i < 3; i++) this.pens[9 + i] = values[i] ?? 0
  }
}

/** `struct IntuiText`, intuition.i: three bytes, pad, two words, three pointers. */
export interface NativeIntuiText {
  frontPen: number
  backPen: number
  drawMode: number
  left: number
  top: number
  font: number
  text: number
  next: number
}

export const newNativeIntuiText = (): NativeIntuiText => ({
  frontPen: 0, backPen: 0, drawMode: 0, left: 0, top: 0, font: 0, text: 0, next: 0,
})

export function setIntuiTextDraw(text: NativeIntuiText | null, frontPen: number, backPen: number, drawMode: number): void {
  if (!text) return
  text.frontPen = frontPen & 0xff
  text.backPen = backPen & 0xff
  text.drawMode = drawMode & 0xff
}

export function setIntuiTextCorner(text: NativeIntuiText | null, left: number, top: number): void {
  if (!text) return
  text.left = left & 0xffff
  text.top = top & 0xffff
}

export function setIntuiText(
  text: NativeIntuiText | null,
  frontPen: number,
  backPen: number,
  drawMode: number,
  left: number,
  top: number,
  font: number,
  value: number,
  next: number,
): void {
  if (!text) return
  setIntuiTextDraw(text, frontPen, backPen, drawMode)
  setIntuiTextCorner(text, left, top)
  text.font = font >>> 0
  text.text = value >>> 0
  text.next = next >>> 0
}

/** `struct TextAttr`: name pointer, Y size word, style byte and flags byte. */
export interface NativeTextAttr {
  name: number
  ySize: number
  style: number
  flags: number
}

export const newNativeTextAttr = (): NativeTextAttr => ({ name: 0, ySize: 0, style: 0, flags: 0 })

export function setTextAttr(attr: NativeTextAttr | null, name: number, ySize: number, style: number, flags: number): void {
  if (!attr) return
  attr.name = name >>> 0
  attr.ySize = ySize & 0xffff
  attr.style = style & 0xff
  attr.flags = flags & 0xff
}
