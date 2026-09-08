/** Text payloads handled by Workbench's ascii and AmigaGuide datatypes. */

const latin1 = new TextDecoder('latin1')

/** Extract displayable text from an installed text/document datatype. */
export function decodeDataTypeText(bytes: Uint8Array, name: string): string | null {
  if (name === 'AmigaGuide') {
    const text = latin1.decode(bytes)
    return /^\s*@database\b/i.test(text) ? text : null
  }
  if (name !== 'FTXT' || bytes.length < 12) return null
  const id = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (id(0) !== 'FORM' || id(8) !== 'FTXT') return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = Math.min(bytes.length, 8 + v.getUint32(4, false))
  const parts: string[] = []
  for (let at = 12; at + 8 <= end;) {
    const size = v.getUint32(at + 4, false)
    const body = at + 8
    if (body + size > end) return null
    if (id(at) === 'CHRS') parts.push(latin1.decode(bytes.subarray(body, body + size)))
    at = body + size + (size & 1)
  }
  return parts.join('')
}
