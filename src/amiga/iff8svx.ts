/** A decoded IFF 8SVX voice. PCM values are signed eight-bit Paula samples. */
export interface Voice8svx {
  name: string
  rate: number
  volume: number
  compression: 0 | 1
  channels: 1 | 2
  left: Int8Array
  right?: Int8Array
  oneShot: number
  repeat: number
}

const FIB = [-34, -21, -13, -8, -5, -3, -2, -1, 0, 1, 2, 3, 5, 8, 13, 21] as const

const ascii = (d: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...d.subarray(at, at + n))

function fibDelta(body: Uint8Array): Int8Array | null {
  if (body.length < 2) return null
  const out = new Int8Array((body.length - 2) * 2)
  let sample = body[1]!
  let at = 0
  for (const byte of body.subarray(2)) {
    sample = (sample + FIB[byte >>> 4]!) & 0xff
    out[at++] = sample > 127 ? sample - 256 : sample
    sample = (sample + FIB[byte & 15]!) & 0xff
    out[at++] = sample > 127 ? sample - 256 : sample
  }
  return out
}

/** Decode uncompressed and Fibonacci-delta IFF 8SVX, including CHAN stereo. */
export function decode8svx(data: Uint8Array): Voice8svx | null {
  if (data.length < 12 || ascii(data, 0, 4) !== 'FORM' || ascii(data, 8, 4) !== '8SVX') return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const formEnd = Math.min(data.length, 8 + view.getUint32(4, false))
  let name = ''
  let rate = 0
  let volume = 0
  let compression: 0 | 1 | -1 = -1
  let channels: 1 | 2 = 1
  let oneShot = 0
  let repeat = 0
  let body: Uint8Array | null = null
  for (let at = 12; at + 8 <= formEnd;) {
    const id = ascii(data, at, 4)
    const len = view.getUint32(at + 4, false)
    const start = at + 8
    const end = start + len
    if (end > formEnd) return null
    if (id === 'VHDR') {
      if (len < 20) return null
      oneShot = view.getUint32(start, false)
      repeat = view.getUint32(start + 4, false)
      rate = view.getUint16(start + 12, false)
      const c = data[start + 15]!
      if (c !== 0 && c !== 1) return null
      compression = c
      volume = view.getUint32(start + 16, false)
    } else if (id === 'CHAN' && len >= 4) {
      const chan = view.getUint32(start, false)
      if (chan === 6 || chan === 9) channels = 2
    } else if (id === 'NAME') {
      const zero = data.subarray(start, end).indexOf(0)
      const stop = zero < 0 ? end : start + zero
      name = new TextDecoder('latin1').decode(data.subarray(start, stop))
    } else if (id === 'BODY') body = data.subarray(start, end)
    at = end + (len & 1)
  }
  if (compression < 0 || rate === 0 || body === null) return null
  const half = channels === 2 ? body.length >>> 1 : body.length
  const decode = (part: Uint8Array): Int8Array | null =>
    compression === 1
      ? fibDelta(part)
      : new Int8Array(part.buffer, part.byteOffset, part.byteLength).slice()
  const left = decode(body.subarray(0, half))
  const right = channels === 2 ? decode(body.subarray(half, half * 2)) : undefined
  if (left === null || right === null) return null
  return { name, rate, volume, compression: compression as 0 | 1, channels, left, ...(right ? { right } : {}), oneShot, repeat }
}

/** Put a voice in the one-sample bank consumed by AMOS `Sam Play`. */
export function voice8svxSampleBank(voice: Voice8svx): Uint8Array {
  const pcm = voice.right === undefined
    ? voice.left
    : Int8Array.from(voice.left, (left, i) => Math.max(-128, Math.min(127, Math.round((left + (voice.right![i] ?? left)) / 2))))
  const out = new Uint8Array(20 + pcm.length)
  const view = new DataView(out.buffer)
  view.setUint16(0, 1, false)
  view.setUint32(2, 6, false)
  const label = (voice.name || '8SVX').slice(0, 8).padEnd(8)
  for (let i = 0; i < 8; i++) out[6 + i] = label.charCodeAt(i)
  view.setUint16(14, Math.min(0xffff, voice.rate), false)
  view.setUint32(16, pcm.length, false)
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 20)
  return out
}
