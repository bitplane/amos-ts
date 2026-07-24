/**
 * IFF ANIM frame machinery — a port of IffFormLoad/IffFormSize/
 * IffFormPlay (+Lib.s:6861-7500) behind =Frame Load/Length/Play/Skip
 * and Iff Anim.
 *
 * Frame buffers hold raw IFF FORMs back to back with an "AenD"
 * terminator (IffFormLoad strips FORM ANIM wrappers and counts the
 * children). Playing walks the chunk registry: BMHD/CAMG/CMAP/CCRT/
 * AMSC/ANHD are remembered, BODY draws a row-interleaved ILBM into the
 * current (or freshly created) screen's bitplanes, and DLTA applies
 * Jim Kent's ANIM5 per-plane vertical columns (op 5 only, as the 68k
 * enforces). The ANHD relative time lands in rt.iffReturn (=Frame
 * Param); Iff Anim double-buffers and swaps between frames exactly as
 * InIffAnim3 does, which is what makes ANIM5's two-frames-back deltas
 * come out right.
 */

import { AmosError } from '../interp/values'
import type { Runtime } from './runtime'

const fourcc = (b: Uint8Array, off: number): string =>
  String.fromCharCode(b[off] ?? 0, b[off + 1] ?? 0, b[off + 2] ?? 0, b[off + 3] ?? 0)

const u32 = (b: Uint8Array, off: number): number =>
  (((b[off] ?? 0) << 24) | ((b[off + 1] ?? 0) << 16) | ((b[off + 2] ?? 0) << 8) | (b[off + 3] ?? 0)) >>> 0

const u16 = (b: Uint8Array, off: number): number => (((b[off] ?? 0) << 8) | (b[off + 1] ?? 0)) >>> 0

const pad = (n: number): number => (n + 1) & ~1

/**
 * IffFormSize (+Lib.s:6916): bytes needed for the next `count` FORMs
 * (FORM ANIM wrappers add nothing, others 8 + padded length; +4 for
 * the AenD terminator). The position does not move.
 */
export function formSize(data: Uint8Array, pos: number, count: number): { bytes: number; frames: number } {
  let bytes = 0
  let frames = 0
  while (count > 0 && pos + 12 <= data.length) {
    if (fourcc(data, pos) !== 'FORM') throw new AmosError('bad IFF format')
    const len = u32(data, pos + 4)
    if (fourcc(data, pos + 8) === 'ANIM') {
      pos += 12
      continue
    }
    bytes += 8 + pad(len)
    pos += 8 + pad(len)
    frames++
    count--
  }
  return { bytes: bytes + 4, frames }
}

/**
 * IffFormLoad (+Lib.s:6861): copy `count` FORMs from `data` at `pos`
 * into `dest`, unwrapping FORM ANIM, terminating with "AenD". Returns
 * the frames copied and the new read position.
 */
export function formLoad(data: Uint8Array, pos: number, count: number, dest: Uint8Array): { frames: number; pos: number; bytes: number } {
  let frames = 0
  let out = 0
  while (count > 0 && pos + 12 <= data.length) {
    if (fourcc(data, pos) !== 'FORM') throw new AmosError('bad IFF format')
    const len = u32(data, pos + 4)
    if (fourcc(data, pos + 8) === 'ANIM') {
      pos += 12
      continue
    }
    const total = 8 + pad(len)
    if (out + total > dest.length) break
    dest.set(data.subarray(pos, Math.min(pos + total, data.length)), out)
    out += total
    pos += total
    frames++
    count--
  }
  if (out + 4 <= dest.length) dest.set([0x41, 0x65, 0x6e, 0x44], out) // "AenD"
  return { frames, pos, bytes: out + 4 }
}

interface ChunkState {
  bmhd: number
  cmap: number
  cmapLen: number
  camg: number
  anhd: number
}

/**
 * IffFormPlay (+Lib.s:7020): interpret `count` FORMs at `pos` in buf.
 * `param` = screen number to create at each BODY (null = EntNul,
 * draw to the current screen); `skip` = Frame Skip's bit 30. Returns
 * the position after the played forms.
 */
export function formPlay(rt: Runtime, buf: Uint8Array, pos: number, count: number, param: number | null, skip: boolean): number {
  const st: ChunkState = { bmhd: -1, cmap: -1, cmapLen: 0, camg: -1, anhd: -1 }
  let remaining = count
  let inForm = false
  for (;;) {
    if (pos + 4 > buf.length) return pos
    const id = fourcc(buf, pos)
    if (id === 'AenD') return pos
    if (id === 'FORM') {
      if (--remaining < 0) return pos
      inForm = true
      const type = fourcc(buf, pos + 8)
      if (type !== 'ILBM' && type !== 'ANIM') {
        pos += 8 + pad(u32(buf, pos + 4))
        continue
      }
      pos += 12
      continue
    }
    if (!inForm) throw new AmosError('bad IFF format')
    const len = u32(buf, pos + 4)
    switch (id) {
      case 'BMHD':
        st.bmhd = pos + 8
        break
      case 'CMAP':
        st.cmap = pos + 8
        st.cmapLen = len
        break
      case 'CAMG':
        st.camg = pos + 8
        break
      case 'ANHD':
      case 'AMSC':
        st.anhd = pos + 8
        break
      case 'BODY':
        if (!skip) playBody(rt, buf, pos + 8, len, st, param)
        break
      case 'DLTA':
        if (!skip) playDlta(rt, buf, pos + 8, st)
        break
    }
    pos += 8 + pad(len)
  }
}

/** IffBODY (+Lib.s:7146): screen creation, palette, plane decode */
function playBody(rt: Runtime, buf: Uint8Array, off: number, len: number, st: ChunkState, param: number | null): void {
  if (st.bmhd < 0) throw new AmosError('Illegal function call', 23)
  const w = u16(buf, st.bmhd)
  const h = u16(buf, st.bmhd + 2)
  const planes = buf[st.bmhd + 8] ?? 0
  const compressed = (buf[st.bmhd + 10] ?? 0) !== 0
  if (param !== null) {
    if (param < 0 || param >= 8) throw new AmosError(`illegal screen number: ${param}`)
    const camg = st.camg >= 0 ? u32(buf, st.camg) : 0
    const hires = (camg & 0x8000) !== 0
    rt.openScreen(param, w, h, Math.min(64, 1 << planes), hires ? 1 : 0)
  }
  const s = rt.screen
  // palette (IffPal): CMAP rgb triplets to 12-bit entries
  if (st.cmap >= 0) {
    const n = Math.min(32, Math.floor(st.cmapLen / 3))
    for (let i = 0; i < n; i++) {
      const r = buf[st.cmap + i * 3]! >> 4
      const g = buf[st.cmap + i * 3 + 1]! >> 4
      const b = buf[st.cmap + i * 3 + 2]! >> 4
      s.palette[i] = (r << 8) | (g << 4) | b
    }
  }
  // bounds exactly as IffB3: too wide or too deep cannot fit, too tall clamps
  if (w > s.width || planes > s.depth) throw new AmosError('bad IFF format')
  const rows = Math.min(h, s.height)
  const rowBytes = (w + 7) >> 3
  const planar = s.planarView('log', true)
  let src = off
  const end = off + len
  for (let y = 0; y < rows; y++) {
    for (let p = 0; p < planes; p++) {
      const dst = p * s.planeSize + y * s.rowBytes
      if (!compressed) {
        for (let i = 0; i < rowBytes && src < end; i++) planar[dst + i] = buf[src++]!
      } else {
        // ByteRun1
        let i = 0
        while (i < rowBytes && src < end) {
          const c = (buf[src++]! << 24) >> 24
          if (c >= 0) {
            for (let k = 0; k <= c && i < rowBytes; k++) planar[dst + i++] = buf[src++]!
          } else if (c !== -128) {
            const v = buf[src++]!
            for (let k = 0; k < 1 - c && i < rowBytes; k++) planar[dst + i++] = v
          }
        }
      }
    }
  }
}

/** IffDLTA (+Lib.s:7429): ANIM op 5 vertical per-plane columns */
function playDlta(rt: Runtime, buf: Uint8Array, off: number, st: ChunkState): void {
  if (st.anhd < 0) throw new AmosError('bad IFF format')
  if ((buf[st.anhd] ?? 0) !== 5) throw new AmosError('bad IFF format')
  rt.iffReturn = u32(buf, st.anhd + 14) // relative time -> =Frame Param
  const s = rt.screen
  const planar = s.planarView('log', true)
  const cols = s.rowBytes
  for (let p = 0; p < s.depth; p++) {
    const ptr = u32(buf, off + p * 4)
    if (ptr === 0) continue
    let src = off + ptr
    for (let col = 0; col < cols; col++) {
      let row = 0
      let ops = buf[src++] ?? 0
      while (ops-- > 0) {
        const op = buf[src++] ?? 0
        if (op & 0x80) {
          // uniq: copy op&0x7f bytes down the column
          for (let k = 0; k < (op & 0x7f); k++) {
            if (row < s.height) planar[p * s.planeSize + row * cols + col] = buf[src]!
            src++
            row++
          }
        } else if (op === 0) {
          // same: repeat one byte count times
          const count = buf[src++] ?? 0
          const v = buf[src++] ?? 0
          for (let k = 0; k < count; k++) {
            if (row < s.height) planar[p * s.planeSize + row * cols + col] = v
            row++
          }
        } else {
          row += op // skip
        }
      }
    }
  }
}
