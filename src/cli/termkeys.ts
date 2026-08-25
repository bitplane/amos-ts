/**
 * A terminal's bytes, as the editor's `EdKey`.
 *
 * The key map is `.Ed_KFonc` in +Editor_Config.s, 184 three-byte records of
 * scancode and qualifiers, and a terminal delivers neither: it sends
 * characters, and it folds Ctrl-A and SOH into the same byte. So what can be
 * recovered here is the ASCII, the scancode for the keys that have an escape
 * sequence, and Ctrl. Shift and Amiga combinations cannot be told apart from
 * the plain key and are out of reach.
 *
 * Kept out of ./amosedit.ts so it can be tested: that file puts the terminal
 * in raw mode as it loads.
 */
import { QUAL, type EdKey } from '../editor/keymap'

const ESC = '\x1b'

/** the four cursor keys, as `Cla_Special` (+W.s:12912) stores them */
const ARROWS: Record<string, [string, number]> = {
  A: ['\x1e', 0x4c],
  B: ['\x1f', 0x4d],
  C: ['\x1c', 0x4e],
  D: ['\x1d', 0x4f],
}

/** xterm's four shapes for F1 to F10, in the order the editor numbers them */
const FKEYS: Record<string, number> = {
  P: 0x50, Q: 0x51, R: 0x52, S: 0x53,
  '15': 0x54, '17': 0x55, '18': 0x56, '19': 0x57, '20': 0x58, '21': 0x59,
  '11': 0x50, '12': 0x51, '13': 0x52, '14': 0x53,
}

/**
 * One escape sequence or one byte, and how many bytes it took.
 *
 * A lone ESC is the Escape key, which is `Ed_Escape`. That is only knowable
 * once nothing follows it, so a bare ESC at the end of a chunk is treated as
 * the key: a terminal delivers a real sequence in one write.
 */
export function decode(buf: string): { key: EdKey; used: number } | null {
  if (buf.length === 0) return null
  const c = buf.charAt(0)
  if (c !== ESC) {
    if (c === '\r' || c === '\n') return { key: { ch: '\r', scan: 0x44 }, used: 1 }
    if (c === '\x7f' || c === '\x08') return { key: { ch: '\x08', scan: 0x41 }, used: 1 }
    if (c === '\t') return { key: { ch: '\t', scan: 0x42 }, used: 1 }
    const code = buf.charCodeAt(0)
    // Ctrl-A through Ctrl-Z arrive as 1 to 26 with no scancode of their own
    if (code >= 1 && code <= 26) {
      return { key: { ch: String.fromCharCode(code + 0x60), shift: QUAL.CTRL }, used: 1 }
    }
    return { key: { ch: c }, used: 1 }
  }
  if (buf.length === 1) return { key: { ch: '\x1b', scan: 0x45 }, used: 1 }
  const rest = buf.slice(1)
  const m = /^(?:\[|O)(\d*)(?:;\d+)?(.)/.exec(rest)
  if (m === null) return { key: { ch: '\x1b', scan: 0x45 }, used: 1 }
  const used = 1 + m[0].length
  const digits = m[1]!
  const final = m[2]!
  const arrow = ARROWS[final]
  if (arrow !== undefined && digits === '') return { key: { ch: arrow[0], scan: arrow[1] }, used }
  const fkey = FKEYS[digits === '' ? final : digits]
  if (fkey !== undefined) return { key: { scan: fkey, ch: '' }, used }
  if (final === '~' && digits === '3') return { key: { ch: '\x00', scan: 0x46 }, used } // Del
  if (final === 'H' || digits === '1') return { key: { ch: '', scan: 0x3d }, used } // Home
  if (final === 'F' || digits === '4') return { key: { ch: '', scan: 0x1d }, used } // End
  return { key: { ch: '' }, used }
}

