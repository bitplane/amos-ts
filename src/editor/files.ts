/**
 * `Prg_Load` (+Verif.s:4789) and `Prg_Save` (:4964): the .AMOS file.
 *
 * A saved program is a 16-byte header, a big-endian u32 length, that many
 * bytes of tokens, and then the banks. `src/loader/amosfile.ts` reads the same
 * container for the player and is far more forgiving about the header, because
 * it has to cope with everything in the wild. This one is the editor's, and it
 * is exact in both directions.
 *
 * ## The header is two constants, and the save writes into them
 *
 * `H_1.3` and `H_Pro` (+Verif.s:4323) are sixteen bytes each, laid out so that
 * byte 11 is `v` in both. `Prg_Save` pokes the tested marker into that byte
 * and the maths flags into byte 15, in the CONSTANT, with `lea H_Pro(pc),a0`
 * and a `move.b`. The header a program is saved with is the header the last
 * save left behind.
 *
 * ## Which bytes are compared
 *
 * `Prg_Load` checks ten bytes for 1.3 (`AMOS Basic`) and eight for Pro
 * (`AMOS Pro`), so everything after that is decoration. `AMOS Pro   V1.00` and
 * `AMOS ProEd.v` both load; both come back out as `AMOS Pro101v`, because the
 * save writes the constant and not what was read.
 *
 * Byte 11 is `V` for a program that has passed Test and `v` for one that has
 * not, and nothing reads it back. `Ed_Load` sets `Prg_StModif` to 1 the moment
 * a load succeeds (`EdLok`, +Edit.s:13414), so a tested program reloads
 * untested however it was written.
 */
import type { ProgramBuffer } from './buffer'

/**
 * DEVIATION: what the editor needs of dos.library, which is five calls.
 *
 * `D_Open`, `D_Read`, `D_Write` and `D_Close` around a whole file are a read
 * or a write here, because nothing the editor does with a program is
 * incremental. `AmigaFS` in `src/amiga/vfs.ts` answers all five as it stands.
 */
export interface EditorFS {
  readFile(path: string): Uint8Array | null
  writeFile(path: string, data: Uint8Array): boolean
  exists(path: string): 'file' | 'dir' | null
  /** `_LVORename`, which is what `Ed_MakeBak` (+Edit.s:13697) is built on */
  rename(from: string, to: string): boolean
  deleteFile(path: string): boolean
}

/** `H_1.3` (+Verif.s:4323) */
export const H_13 = 'AMOS Basic v134 '

/** `H_Pro` (:4324). Bytes 12 to 15 are zero until a save writes into 15 */
export const H_PRO = 'AMOS Pro101v\x00\x00\x00\x00'

/** `EnHead` (+Edit.s:13296), which is what Save Block writes instead */
export const H_BLOCK = 'AMOS ProEd.v    '

/** `Prg_Load`'s d0 */
export const PRG = {
  OK: 0,
  /** `.DErr`: the file would not open, or would not read */
  DISK: -1,
  /** `.MErr`: `Prg_ChgTTexte` could not get the memory */
  MEMORY: -2,
  /** `.PAmos`: neither header matched */
  NOT_AMOS: -3,
  /** `.Papo`: the buffer is smaller than the file, and d1 says how much it needs */
  TOO_SMALL: 1,
} as const

/**
 * `Bnk.SaveVide` (+Lib.s:3873) and `Bnk.SaveAll` (:3838) with nothing to save.
 *
 * Both write the `AmBs` hunk name and a count word, so every program AMOS
 * Professional saves carries these six bytes whether it has banks or not.
 */
export const EMPTY_BANKS = Uint8Array.from([0x41, 0x6d, 0x42, 0x73, 0, 0])

/** what a .AMOS file holds, once the header has been read */
export interface ProgramFile {
  /** `Prg_Not1.3`, inverted: true for a Pro header */
  pro: boolean
  /** byte 15, `Prg_MathFlags`. A 1.3 header has a space there and no meaning */
  mathFlags: number
  /** byte 11: `V` has passed Test, `v` has not */
  tested: boolean
  /** the tokens, with no terminating zero word: the buffer supplies that */
  source: Uint8Array
  /** everything after the source, `AmBs` onwards, kept as bytes */
  banks: Uint8Array
}

/** `Prg_Load`'s answer: a code, and the file when the code is OK */
export interface ReadResult {
  error: number
  file: ProgramFile | null
  /** d1 at `.Papo`, the size the buffer would have to be */
  needs: number
}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)

const startsWith = (bytes: Uint8Array, s: string, n: number): boolean => {
  for (let i = 0; i < n; i++) if (bytes[i] !== (s.charCodeAt(i) & 0xff)) return false
  return true
}

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0

/**
 * `Prg_Load` (:4789) without the disc, and without the growing.
 *
 * `room` is the buffer the program has to fit in, which is `Prg_StTTexte` less
 * the zero word. Pass 0 for a caller that will make a buffer to suit.
 *
 * `.Load` adds 256 to the size before reporting it, which is the slack the
 * editor insists on: a program that fits its buffer EXACTLY is still refused
 * and reloaded into a bigger one.
 */
export function readProgramFile(file: Uint8Array, room = 0): ReadResult {
  const fail = (error: number): ReadResult => ({ error, file: null, needs: 0 })
  // `moveq #16+4,d3 / jsr D_Read` reads the header and the length together
  if (file.length < 20) return fail(PRG.DISK)
  // `.Ver1` is ten bytes and `.Ver2` is eight
  const pro = !startsWith(file, H_13, 10)
  if (pro && !startsWith(file, H_PRO, 8)) return fail(PRG.NOT_AMOS)
  const size = u32(file, 16)
  if (20 + size > file.length) return fail(PRG.DISK)
  const needs = size + 256
  if (room !== 0 && size >= room) return { error: PRG.TOO_SMALL, file: null, needs }
  return {
    error: PRG.OK,
    needs,
    file: {
      pro,
      // `move.b 15(a1),d7` runs on the Pro arm only, and 1.3 falls in with
      // `moveq #0,d7`
      mathFlags: pro ? file[15]! : 0,
      tested: file[11] === 0x56, // "V"
      source: file.subarray(20, 20 + size),
      banks: file.subarray(20 + size),
    },
  }
}

/**
 * `Prg_Save` (:4964), which is the header, the length, the body and the banks.
 *
 * The maths flags go into `H_Pro`'s byte 15 before the header is chosen, so a
 * 1.3 program is saved with a space there and the flags are lost. That is the
 * order the instructions are in: `lea H_Pro(pc),a0`, the `move.b`, and only
 * then `tst.b Prg_Not1.3(a6)`.
 */
export function writeProgramFile(p: ProgramFile): Uint8Array {
  const head = ascii(p.pro ? H_PRO : H_13)
  if (p.pro) head[15] = p.mathFlags & 0xff
  head[11] = p.tested ? 0x56 : 0x76 // "V" tested, "v" not
  const out = new Uint8Array(20 + p.source.length + p.banks.length)
  out.set(head, 0)
  const n = p.source.length
  out[16] = (n >>> 24) & 0xff
  out[17] = (n >>> 16) & 0xff
  out[18] = (n >>> 8) & 0xff
  out[19] = n & 0xff
  out.set(p.source, 20)
  out.set(p.banks, 20 + n)
  return out
}

/**
 * `.Loop bsr Tk_FindN / bne .Loop` (:4990): the program up to the first zero.
 *
 * The saved length stops at the terminating zero word rather than including
 * it, and `Prg_Load` writes a fresh one above whatever it reads. So the same
 * two bytes are dropped on the way out and put back on the way in, and a file
 * that carried one would gain a second.
 */
export function programSource(prog: ProgramBuffer): Uint8Array {
  let at = prog.stBas
  for (;;) {
    const n = prog.sizeOfLine(at)
    if (n === 0) break
    at += n
  }
  return prog.bytes.subarray(prog.stBas, at)
}

/**
 * `Ed_MakeBak` (+Edit.s:13697): the backup name, which is system message 21.
 *
 * `.Bak2` walks back from the terminator for a dot and stops when it reaches
 * the start, so the FIRST character is never tested. A name that is all
 * extension keeps it: `.AMOS` becomes `.AMOS.Bak` and not `.Bak`.
 */
export function bakName(name: string, suffix = '.Bak'): string {
  const cut = name.lastIndexOf('.')
  return cut > 0 ? name.slice(0, cut) + suffix : name + suffix
}

/**
 * `Ed_DNom` (+Edit.s:13425): the file's own name, past the last `/` or `:`.
 *
 * It walks back from the terminator and `addq.l #1,a0` steps forward off
 * whatever stopped it, so a name that ran to the start comes back whole.
 */
export function fileName(path: string): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const c = path[i]
    if (c === '/' || c === ':') return path.slice(i + 1)
  }
  return path
}
