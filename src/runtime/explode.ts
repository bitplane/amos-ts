/**
 * Explode 2.01 — Volker Stepprath, Testaware, 1995-2002. 131 keywords at
 * slot 7.
 *
 * A toolbox rather than a theme: packers for five formats, bank and file
 * handling, a numbered structure allocator, bitplane surgery, fonts, and a
 * scattering of system calls. The name is the packers' — most of the library
 * is about getting data in and out of AMOS banks compressed.
 *
 * ## Evidence
 *
 * SOURCE tier, and unusually so for a third-party extension this size. The
 * archive ships `AMOSPro_Explode_Lib.s`, 90,716 bytes and 4,639 lines of the
 * author's own commented assembler — his labels, his structure offsets, his
 * comments in German — alongside the 15,168-byte library it built and a 65KB
 * manual with an entry per keyword. `extdis explode-2.01` opens the binary;
 * the source is what actually gets read, and citations below name the routine
 * NUMBER and its address in that binary so both can be checked.
 *
 * The slot is the source's own: `ExtNb equ 7-1` on line 16, where the
 * registration previously had 7 from ExoticA's wiki.
 *
 * ## Register convention, as this library writes it
 *
 * The usual AMOS one — arguments pop right-to-left off `(a3)+`, `d3` is the
 * return value and `d2` the return type, 0 integer and 2 string. Two of the
 * author's own helpers appear throughout and are worth naming once:
 *
 *   `L_GetSpace`   D3 <= byte length, A1 => string pointer, D3 => the string
 *   `L_IFunc`      AMOS error 23, Illegal function call
 *
 * A string argument arrives as a POINTER to an AMOS string block: a length
 * word, then the characters, so the first character is at `2(a0)`.
 *
 * ## The errors, all eight of them
 *
 * Routines 200 to 207 are the whole error vocabulary, each two instructions
 * — a number into d0 and a jump to AMOS's own `L_Error`. Reading them
 * together is worth more than reading them one at a time, so they are here
 * once (source lines 4599-4620) rather than restated at each site:
 *
 *     200  L_OOfmem    24   Out of memory
 *     201  L_IFunc     23   Illegal function call
 *     202  L_SNopen    47   Screen not opened
 *     203  L_FNopen    97   File not opened
 *     204  L_IOError   94   I/O error
 *     205  L_LibError  170  Cannot open library
 *     206  L_NoIff     31   IFF compression not recognised
 *     207  L_IScrn     48   Illegal screen parameter
 *
 * THIS TABLE FOUND A CORE DEFECT. Six of the eight agreed with the port's
 * message table and two did not: 94 read "Next without For in animation
 * string" and 97 "Autotest already opened". The author was right — the
 * generated table was fourteen records short, and everything from 94 up
 * answered under the wrong number. See AMOS_ERRORS in ../interp/values.ts.
 */
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { AmosError, VI, VS, funcCall, int, str, type Value } from '../interp/values'
import { BNK, BOB_BANK, ICON_BANK, isObjectBank, type BankRef } from './banks'
import type { ObjectBank } from './objects'
import { MemPool } from '../amiga/exec'
import { openDiskFont } from '../amiga/diskfont'
import { ID_VALIDATING, ID_WRITE_PROTECTED } from '../amiga/dos'
import { civilFromStamp } from '../amiga/datestamp'
import { joyFire } from '../interp/gameport'
import { parseIlbm } from '../loader/iff'
import { pp20Crunch, pp20Decrunch } from '../amiga/powerpacker'
import { bpkDecrunch, bpkLength } from '../amiga/bytekiller'
import { lhUnpackBank } from '../amiga/lh'
import { XPK_MAGIC, XPK_PACKERS, XPKERR_NOFUNC, xpkErrorText, xpkParseMethod, xpkUnpack } from '../amiga/xpkmaster'

/**
 * Where the Rs pool is mapped, matching `Runtime.EXPLODE_HEAP_BASE` and
 * `EXPLODE_HEAP_RESERVED`. Spelled out rather than imported because
 * `./runtime` is a TYPE-only import here; `memmap.test.ts` holds the two to
 * agreeing.
 */
const HEAP_BASE = 0x3800_0000
const HEAP_RESERVED = 0x0200_0000

/** `my_RsMax` — eight structures, and the source says so twice */
const RS_MAX = 8

/**
 * One `Rs Structure`, which on the machine is twelve bytes of the extension's
 * data zone: `my_RsStart` 0, `my_RsLength` 4, `my_RsPosition` 8, with
 * `my_RsSIZEOF` 12 and `my_RsStruc rs.b 12*8` holding all eight (source lines
 * 104-109).
 *
 * `start` of zero means unallocated and the routines test exactly that, so
 * the three fields are kept as the library keeps them rather than collapsed
 * into an optional.
 */
export interface RsStruct {
  /** `my_RsStart` — the address `=Rs Start(n)` answers, 0 when unallocated */
  start: number
  /** `my_RsLength` — what was asked for, and what `Rs Clear` zeroes */
  length: number
  /** `my_RsPosition` — the write cursor every Rs Byte/Word/Long advances */
  position: number
}

/** `my_FntMax` — eight font slots, numbered 1 to 8 and not 0 to 7 */
const FNT_MAX = 8

/** `my_CdLength` — the Cd path buffer, 256 bytes with a length word in front */
const CD_LENGTH = 256

export interface ExplodeState {
  /** `L_RamFast`/`L_RamFree`, and the strings `Rs Aptr` leaves pointers to */
  pool: MemPool
  /** the eight descriptors, 0 to 7 */
  rs: RsStruct[]
  /**
   * `my_FntStruc` — eight longwords, each a `TextFont *` or zero.
   *
   * The library keeps the OS pointer and reads the struct back through it
   * (`10(a0)` for the name, `20(a0)` for the height); this keeps the font
   * itself, and `Font Base` answers the address the pool gives it.
   */
  fonts: Array<ExplodeFont | null>
  /**
   * `my_CdPath` — the path `Cd Set` stores, with its own length word.
   *
   * Empty until something asks, at which point `Cd Path$` fills it in from
   * AMOS's own current directory.
   */
  cdPath: string
  /** `my_AmcafCrack` — the word `Amcaf Crack On` saved from `-22(a5)` */
  amcafCrack: number
  /** `my_XpkErrNum` — the last XPK call's d0, which `=Xpk Errn` reports */
  xpkErr: number
}

/** one entry of `my_FntStruc`, and the two fields the accessors read off it */
export interface ExplodeFont {
  name: string
  height: number
  /** where the TextFont was mapped, so `=Font Base(n)` has an address */
  base: number
}

export const newExplodeState = (): ExplodeState => ({
  pool: new MemPool(HEAP_BASE, HEAP_RESERVED),
  rs: Array.from({ length: RS_MAX }, () => ({ start: 0, length: 0, position: 0 })),
  fonts: Array.from({ length: FNT_MAX }, () => null),
  cdPath: '',
  amcafCrack: 0,
  xpkErr: 0,
})

/**
 * The characters of an AMOS string as bytes, padded with zeros.
 *
 * `=Word($)` reads two bytes and `=Long($)` four, with no check that the
 * string is that long: on the machine a short one reads on into whatever the
 * string heap holds next. DEVIATION: there is no string heap here to read
 * into, so a missing byte is zero. The alternative would be inventing a
 * neighbour, which is worse than being short.
 */
function chars(s: string, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) & 0xff : 0))
}

/**
 * `lsl`/`lsr` with a register count, at one of the three widths.
 *
 * THE WIDTH IS NOT A ROUNDING — it is the whole behaviour. `lsl.b d2,d3`
 * shifts the low BYTE of d3 and leaves the other twenty-four bits exactly
 * where they were, and the routine then returns the whole of d3. So
 * `Lsl.b(1,$1234)` is $1268 and not $2468: the $12 is untouched and only the
 * $34 moves. Reproducing that is the point of there being three keywords per
 * direction rather than one.
 *
 * The count is taken modulo 64 by the 68k, and a count at or above the width
 * shifts every bit out, so the field ends up zero rather than unchanged.
 */
function shifted(value: number, count: number, bits: number, left: boolean): number {
  const n = count & 63
  const mask = bits === 32 ? 0xffff_ffff : (1 << bits) - 1
  const whole = value >>> 0
  // NOT `whole & mask` at the .l width: `&` is an int32 operator in JS, so
  // masking $80000000 with $ffffffff gives -2147483648 and the divide below
  // then produces a negative field. That was a real failure, not a
  // hypothetical one
  const field = bits === 32 ? whole : whole & mask
  // multiply and divide rather than shift: JS's << and >>> are 32-bit and
  // SIGNED at the top end, which gets the .l width wrong for exactly the
  // values that make it interesting
  const out = n >= bits ? 0 : left ? (field * 2 ** n) % 2 ** bits : Math.floor(field / 2 ** n)
  // the bits above the field keep their old value, and the answer is the
  // whole longword, signed
  return ((whole & (mask ^ 0xffff_ffff)) | out) | 0
}

/**
 * `Pdef$`'s twenty-four constant bytes — routine 39 ($1240), assembled as
 * three longwords and read out here as what they are.
 *
 *     ESC I 0   inverse off      ESC B 0   paper 0
 *     ESC S 0   shade off        ESC D 3   cursor colour 3
 *     ESC U 0   underline off    ESC W 0   writing mode 0
 *     ESC P 1   pen 1            ESC C 1   cursor on
 *
 * So "default" is the author's idea of it rather than AMOS's boot state, and
 * it sets two things no other keyword in the group can reach — the pen and
 * the paper.
 */
const PDEF = '\x1bI0\x1bS0\x1bU0\x1bP1\x1bB0\x1bD3\x1bW0\x1bC1'

/**
 * exec's `RawDoFmt` (-522), enough of it for `Format$`.
 *
 * The extension does not format anything itself: routine 40 hands the string
 * and a data pointer straight to exec and copies back what lands in AMOS's
 * scratch buffer. So the specification is exec's, and the part that matters
 * is the ARGUMENT WIDTH — `%d` takes a WORD off the buffer and `%ld` a
 * longword, which is why the author's own example feeds it `Rs Word` and not
 * `Rs Long`:
 *
 *     A$="Extension:%s Version:%d.%d Datum:%x-%x-%x"
 *     Print Format$(A$,Rs Start(0))
 *
 * `%s` takes a longword POINTER to NUL-terminated characters, which is what
 * `Rs Aptr` puts in the buffer.
 */
function rawDoFmt(rt: Runtime, fmt: string, base: number): string {
  let out = ''
  let off = 0
  const word = (): number => {
    const v = readWord(rt, base + off)
    off += 2
    return v
  }
  const long = (): number => {
    const v = readLong(rt, base + off)
    off += 4
    return v
  }
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== '%') {
      out += fmt[i]
      continue
    }
    i++
    if (fmt[i] === '%') {
      out += '%'
      continue
    }
    let left = false
    let pad = ' '
    if (fmt[i] === '-') {
      left = true
      i++
    }
    if (fmt[i] === '0') {
      pad = '0'
      i++
    }
    let width = ''
    while (fmt[i] !== undefined && fmt[i]! >= '0' && fmt[i]! <= '9') width += fmt[i++]
    let limit = ''
    if (fmt[i] === '.') {
      i++
      while (fmt[i] !== undefined && fmt[i]! >= '0' && fmt[i]! <= '9') limit += fmt[i++]
    }
    const isLong = fmt[i] === 'l'
    if (isLong) i++
    const type = fmt[i] ?? ''
    let text: string
    switch (type) {
      case 'd':
        text = String(isLong ? long() | 0 : ((word() << 16) >> 16))
        break
      case 'u':
        text = String((isLong ? long() : word()) >>> 0)
        break
      case 'x':
        text = ((isLong ? long() : word()) >>> 0).toString(16)
        break
      case 'c':
        text = String.fromCharCode((isLong ? long() : word()) & 0xff)
        break
      case 's':
        text = cstring(rt, long())
        break
      default:
        // exec copies an unrecognised specifier through untouched
        out += `%${type}`
        continue
    }
    if (limit !== '' && type === 's') text = text.slice(0, Number(limit))
    const w = Number(width || 0)
    if (text.length < w) text = left ? text.padEnd(w, ' ') : text.padStart(w, pad)
    out += text
  }
  return out
}

/** a word out of the address space, big-endian */
function readWord(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr >>> 0)
  if (!m) return 0
  return ((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)
}

/** a longword out of the address space, big-endian */
function readLong(rt: Runtime, addr: number): number {
  const v = rt.longsAt(addr, false)
  return v ? v.get(0) : 0
}

/** NUL-terminated characters at an address, bounded so a bad pointer cannot hang */
function cstring(rt: Runtime, addr: number): string {
  const m = rt.resolveAddr(addr >>> 0)
  if (!m) return ''
  let s = ''
  for (let i = m.off; i < m.data.length && m.data[i] !== 0 && s.length < 4096; i++) {
    s += String.fromCharCode(m.data[i]!)
  }
  return s
}

/** AMOS error N by number, for the five of the eight this batch can raise */
function amosError(n: number, text: string): never {
  throw new AmosError(text, n)
}

/**
 * The AMOS bank header, as the source's own `RsReset` block names it
 * (lines 137-143), because every keyword below is offsets off this:
 *
 *     my_BkDefault    8   the bank Bank Load uses when none is named
 *     my_BkHeader    16   header bytes, subtracted from BkLength everywhere
 *     my_BkLength   -20   (l) the WHOLE allocation, header included
 *     my_BkNumber   -16   (l)
 *     my_BkFlag     -12   (w) Bnk_BitData/Chip/Bob/Icon, see ./banks.ts
 *     my_BkName      -8   (8 bytes)
 *
 * DEVIATION: THERE IS NO HEADER IN THIS ADDRESS SPACE, and this stands for the
 * whole group. A bank's `Start()` is a synthetic base and the sixteen bytes below
 * it belong to nothing, so a `BankRef` stands in for the header and an
 * address that is not some bank's start has no header to read. On the
 * machine such an address yields a bank made of whatever was in memory.
 */
function orAdr(rt: Runtime, n: number): BankRef | null {
  // Bnk.OrAdr +Lib.s:8082 — below 1024 is a bank number, and one that names
  // no bank is L_BkNoRes rather than a quiet nothing
  if (n < 1024) {
    const ref = rt.bankRef(n)
    if (!ref) amosError(36, 'Bank not reserved')
    return ref
  }
  return rt.bankRefs().find((b) => b.address === (n >>> 0)) ?? null
}

/**
 * The payload byte length: `my_BkLength - my_BkHeader`, which is what every
 * one of these keywords means by the size of a bank.
 *
 * `BankRef.length` cannot serve, because for an object bank it is the IMAGE
 * COUNT — FnLength's own quirk, documented in ./banks.ts. The object banks
 * answer from their serialised bytes instead, and DEVIATION: that is the
 * `.abk` FILE layout, a count word then image records, where the machine
 * holds a table of image and mask POINTERS. The two have no reason to be the
 * same length, so `Finish` on a Bob bank is this port's arrangement rather
 * than the machine's.
 */
function payloadLength(rt: Runtime, ref: BankRef): number {
  if (ref.number === BOB_BANK && isObjectBank(ref)) return rt.objectBankImage('sprites')?.length ?? 0
  if (ref.number === ICON_BANK && isObjectBank(ref)) return rt.objectBankImage('icons')?.length ?? 0
  return rt.memBanks.get(ref.number)?.data.length ?? 0
}

/** the ObjectBank behind a Bob or Icon bank, which here is only banks 1 and 2 */
function objectBank(rt: Runtime, ref: BankRef): ObjectBank | null {
  if (!isObjectBank(ref)) return null
  if (ref.number === BOB_BANK) return rt.spriteBank
  if (ref.number === ICON_BANK) return rt.iconBank
  return null
}

/**
 * `L_GetFileInfo`'s filename check (routine 162, $30cc), which `Bank Load` and
 * `Bank Save` both reach: `move.w (a0)+,d0 / subq.w #1,d0 / cmpi.w #128,d0 /
 * Rbcc L_IFunc`.
 *
 * The compare is UNSIGNED and the decrement comes first, so an EMPTY name
 * wraps to 65535 and fails the same test that rejects a long one. 1 to 128
 * characters, and nothing else.
 */
function checkName(name: string): string {
  if (name.length < 1 || name.length > 128) funcCall()
  return name
}

/**
 * The prologue every one of the seventeen Rs routines opens with:
 *
 *     cmpi.l #my_RsMax,d7        8
 *     Rbge   L_IFunc             (Rs Length and Rs Erase n take .Skip instead)
 *     mulu   #my_RsSIZEOF,d7     12
 *     XLEA   my_RsStruc,a0 / adda.l d7,a0
 *
 * DEVIATION: A NEGATIVE NUMBER IS NOT CAUGHT BY THAT COMPARE. `cmpi.l/bge` is
 * signed, so -1 gets past it, and `mulu` is a 16-by-16 UNSIGNED multiply that
 * sees only d7's low word — so `Rs Structure -1,10` computes 65535 * 12 and
 * writes a descriptor 786,420 bytes past the data zone, into whatever the
 * extension's neighbour is using. There is no linear data zone here to walk
 * off the end of, so this port has nothing to walk into: a negative number is
 * out of range, and out of range is what these routines already have an
 * answer for.
 *
 * `raise` says which answer. Fifteen routines raise error 23; `Rs Length` and
 * `Rs Erase n` branch quietly to their own `rts`.
 */
function rsSlot(rt: Runtime, n: number, raise: boolean): RsStruct | null {
  if (n < 0 || n >= RS_MAX) {
    if (raise) funcCall()
    return null
  }
  return rt.explode.rs[n]!
}

/**
 * The second half of most of them: the cursor, which must not be zero.
 *
 * `move.l my_RsPosition(a0),d0 / Rbeq L_IFunc` — writing to a structure that
 * was never allocated is error 23, and the test is on the POSITION rather
 * than the start.
 */
function rsCursor(rt: Runtime, n: number): { st: RsStruct; at: number } {
  const st = rsSlot(rt, n, true)!
  if (st.position === 0) funcCall()
  return { st, at: st.position }
}

/** one byte into the address space at `addr`, wherever that lands */
function poke(rt: Runtime, addr: number, v: number): void {
  const m = rt.resolveWrite(addr >>> 0)
  if (m && m.off < m.data.length) m.data[m.off] = v & 0xff
}

/**
 * `L_GetFileInfo` (routine 162, $308e) — `Lock`, `Examine`, `UnLock`, into
 * four fields of the data zone.
 *
 * Five keywords read those fields and none of them raise for a file that is
 * not there: `my_FileSize` and `my_FileBlocks` are preset to -1 and stay
 * there, `my_FileType` and `my_FileProtect` to 0. Only the filename is
 * checked, by `checkName` above.
 *
 * DEVIATION: `fib_NumBlocks` is what a real filing system counted, and the
 * volumes here are a directory tree or an ADF. The block count is derived
 * from the size and the volume's own block size, which is what an FFS would
 * have used, rather than stored.
 */
interface FileInfo {
  /** `fib_DirEntryType` — positive a directory, negative a file, 0 not found */
  type: number
  /** `fib_Size`, -1 when the lock failed */
  size: number
  /** `fib_NumBlocks`, -1 when the lock failed */
  blocks: number
  /** `fib_Protection` */
  protection: number
}

function fileInfo(rt: Runtime, name: string): FileInfo {
  checkName(name)
  const path = explodePath(rt, name)
  const what = rt.vfs?.exists(path) ?? (rt.fs?.read(path) ? 'file' : null)
  if (!what) return { type: 0, size: -1, blocks: -1, protection: 0 }
  if (what === 'dir') {
    // a directory's fib_Size is meaningless and AmigaDOS leaves it 0
    return { type: 2, size: 0, blocks: 0, protection: rt.vfs?.meta(path).protection ?? 0 }
  }
  const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
  const size = bytes?.length ?? -1
  const per = rt.vfs?.volumeInfo(path.split(':')[0] ?? '')?.bytesPerBlock ?? 488
  return {
    type: -3,
    size,
    blocks: size < 0 ? -1 : Math.ceil(size / per),
    protection: rt.vfs?.meta(path).protection ?? 0,
  }
}

/**
 * `L_Dsk.PathIt`, which every file keyword here goes through.
 *
 * A name with no volume is taken as relative to the current directory. That
 * is AMOS's own, NOT `Cd Set`'s — see `cd path$` for what the extension's
 * path is actually for.
 */
function explodePath(rt: Runtime, name: string): string {
  if (/[:/]/.test(name) === false && rt.vfs && rt.vfs.currentDir !== '') {
    const base = rt.vfs.currentDir
    return base.endsWith(':') || base.endsWith('/') ? base + name : `${base}/${name}`
  }
  return name
}

export function makeExplodeInstructions(rt: Runtime): Record<string, Instr> {
  /**
   * Routine 167 ($31c6, `L_BankLoad`), the shared body all four `Bank Load`
   * arities tail into. Each of routines 19 to 22 does nothing but fill three
   * fields of the data zone and branch here, which is why the four forms
   * cannot disagree about anything.
   */
  const bankLoad = (name: string, bank: number, mask: number): void => {
    // `andi.l #%11,d1` — only Bnk_BitData and Bnk_BitChip survive, so the Bob
    // and Icon bits cannot be asked for. The manual: "%11 = Chip + Data,
    // %00 = Fast + Work ( Default )"
    const m = mask & 3
    // `cmpi.l #$10000,d0 / Rbge L_IFunc`, and SIGNED, so a negative number
    // gets past here and is truncated to a word by Bnk.Reserve
    if (bank >= 0x10000) funcCall()
    checkName(name)
    const bytes = rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
    // Examine failing leaves my_FileSize at -1, and `Rblt L_IOError`
    if (!bytes) amosError(94, 'I/O error')
    // Bnk.Reserve (+Lib.s:8470) ERASES a bank that is already there rather
    // than refusing it — no "bank already reserved" on this path.
    //
    // DEVIATION: an EMPTY file. Bnk.Reserve asks Lst.Cree for `d2 + 16` and
    // gets a bank with no payload; this port's reserveBank guards `length <=
    // 0` with error 23, which is RsBqX's rule and not this path's. So a
    // zero-byte file raises here and makes an empty bank on the machine.
    rt.eraseBank(bank & 0xffff)
    rt.reserveBank(bank & 0xffff, bytes.length, (m & BNK.DATA) !== 0 ? 'Data' : 'Work', (m & BNK.DATA) !== 0, (m & BNK.CHIP) !== 0)
    rt.memBanks.get(bank & 0xffff)!.data.set(bytes)
  }

  return {
    /**
     * `Lpk Unpack bk` — routine 141 ($28c2): lh.library's `LhDecode`.
     *
     * The bank has to start "LH18" — which is the LIBRARY'S VERSION, "LH"
     * and "1.8", not a format identifier, so nothing but `Lpk Pack` ever
     * wrote one. The longword after it is the original length, and the
     * decoder fills a bank of exactly that. See ../amiga/lh.ts.
     *
     * Quiet about a bank it does not recognise, like every other unpacker
     * here.
     */
    'lpk unpack'(it) {
      const bk = it.evalInt()
      const data = ppkBank(rt, bk)
      if (!data) return
      const out = lhUnpackBank(data)
      if (out) replaceBank(rt, bk, out)
    },

    /**
     * `Lpk Pack bk` — routine 140 ($27dc): lh.library's `LhEncode`, and NOT
     * implemented.
     *
     * The decoder is ported and the encoder is not. Writing one means
     * reproducing the library's match search and its adaptive-Huffman
     * emitter bit for bit — anything less produces a stream that decodes to
     * the right bytes through this port and to nothing at all through the
     * real library, which is a worse answer than none.
     *
     * DEVIATION: it does nothing and leaves the bank alone, which is what
     * the routine itself does when `CreateBuffer` fails — `tst.l d0 / beq
     * .Skip`, no error, no change. So a program sees the outcome of a
     * machine with too little memory to pack rather than a wrong stream.
     *
     * NOTE for whoever writes it: the destination is sized `SrcSize +
     * SrcSize/8` (`move.l d0,d1 / lsr.l #3,d1 / add.l d1,d0`), and adaptive
     * Huffman on incompressible data can exceed that. Whether `LhEncode`
     * honours `lh_DstSize` or writes past it has not been established.
     */
    'lpk pack'(it) {
      it.evalInt()
    },

    /**
     * `Bpk Unpack bk` — routine 74 ($1702), and the only decruncher in this
     * library the author WROTE OUT rather than called a library for.
     *
     * `Bk1` to `Bk9`, sixty-odd instructions inline, which is why this port
     * has ByteKiller at all: the algorithm is in the vendored source rather
     * than in a binary nobody kept. See ../amiga/bytekiller.ts.
     *
     * A bank `L_GetBpkLen` does not recognise falls straight through to `Bk9`
     * — a bare `rts` — so it is silent, not an error. Success reserves a bank
     * at the first free number and head-clones the source's onto it, the same
     * arrangement `Ppk Unpack` and `Xpk Unpack` use.
     */
    'bpk unpack'(it) {
      const bk = it.evalInt()
      const data = ppkBank(rt, bk)
      if (!data || bpkLength(data) === 0) return
      try {
        replaceBank(rt, bk, bpkDecrunch(data))
      } catch {
        // the original has no bounds check anywhere in those sixty
        // instructions; a corrupt stream takes the machine with it
      }
    },

    /**
     * `Ppk Pack bk [,efficiency]` — routines 79 and 80 ($1910 and $1924),
     * both into `L_PpkPack` (routine 168, $324e).
     *
     * powerpacker.library's `ppAllocCrunchInfo` / `ppCrunchBuffer`, into a
     * NEW bank at the first free number which then takes the source's header
     * — so the packed bank ends up with the source's number and the source
     * is gone. The efficiency is 0 to 4 and defaults to 2, "Good", set by
     * routine 79 before it branches.
     *
     * A BANK THAT IS ALREADY PACKED IS LEFT ALONE: `L_GetPpkLen` first, and
     * a non-zero answer skips the whole routine.
     *
     * NOTE: the allocation retry is a loop that raises. `ppAllocCrunchInfo`
     * is asked with SPEEDUP_BUFFLARGE and, if it fails, with one MORE each
     * time round until the value passes SPEEDUP_BUFFSMALL, at which point
     * `Rbpl L_OOfmem`. So out of memory is reported as out of memory, but
     * only after four or five increasingly modest attempts.
     */
    'ppk pack'(it) {
      const bk = it.evalInt()
      const eff = it.accept(',') ? it.evalInt() : 2
      const data = ppkBank(rt, bk)
      if (!data || ppkIdentify(data)) return
      replaceBank(rt, bk, pp20Crunch(data, effTable(eff)))
    },

    /**
     * `Ppk Unpack bk [,password$]` — routines 81 and 82 ($1934 and $1946),
     * into `L_PpkUnpack` (routine 159, $2f1a).
     *
     * `Ppk Data` runs FIRST — the unpacker calls `L_PpkTransform` before it
     * looks at anything, so a PPLS, PPBK, PPLB or PPEX bank is normalised to
     * PP20 and then unpacked in one step. Only then does it check for "PP20"
     * and give up quietly if it is not there.
     *
     * The decruncher is the author's own, not the library's: `Pp0` to `Pp5`
     * inline at $2f42, thirty-odd instructions of the standard PP20 reverse
     * walk. See ../amiga/powerpacker.ts, which is the same algorithm.
     *
     * A password of 129 characters or more is error 23; the check is
     * `subq.w #1,d0 / cmpi.w #128,d0 / Rbcc`, so an empty one fails too.
     */
    'ppk unpack'(it) {
      const bk = it.evalInt()
      if (it.accept(',')) checkPassword(it.evalStr())
      const data = ppkBank(rt, bk)
      if (!data || bankLong(data, 0) !== 0x50503230) return
      try {
        replaceBank(rt, bk, pp20Decrunch(data))
      } catch {
        // the library's own decruncher has no failure path -- a corrupt
        // stream walks off the end and takes the machine with it
      }
    },

    /**
     * `Ppk Data bk [,password$]` — routines 89 and 90 ($1a8e and $1a9a), into
     * `L_PpkTransform` (routine 179, $3502).
     *
     * The format normaliser the whole group is built on: it identifies the
     * bank against the table, and for a self-extractor or a loader-attached
     * file it MOVES THE CRUNCHED DATA TO THE FRONT so what is left is a plain
     * PP20 bank. A type-1 bank (already PP20) is returned untouched.
     *
     * DEVIATION: types 2 to 8 are not transformed here. Each is a different
     * fixed offset into a different PowerPacker product's executable stub,
     * and the branches at `.ppls`, `.ppbk`, `.pplb` and `.ppex` encode where
     * each one put its payload. Reproducing them needs those products' files
     * to check against and the corpus has none — every PowerPacked file in it
     * is a bare PP20. The identification is complete and correct; a bank in
     * one of the six stub formats is left as it was rather than moved to a
     * guess.
     */
    'ppk data'(it) {
      const bk = it.evalInt()
      if (it.accept(',')) checkPassword(it.evalStr())
      const data = ppkBank(rt, bk)
      if (!data) return
      ppkIdentify(data)
    },

    /**
     * `Xpk Unpack bk [,password$]` — routines 93 and 94 ($1afc and $1b0c),
     * into `L_XpkUnpack` (routine 158, $2df4).
     *
     * xpkmaster.library's `XpkUnpack` through a nine-tag list, into a fresh
     * bank at the first free number which then head-clones the source's. The
     * output buffer is the header's unpacked length plus `XPK_MARGIN`, which
     * the sub-libraries are allowed to overrun into.
     *
     * A bank that is not "XPKF" is skipped without a word — and, unlike the
     * Ppk side, the ERROR IS RECORDED: `move.l d0,my_XpkErrNum(a2)` on every
     * call, which is what `=Xpk Errn` and `=Xpk Err$` then report.
     */
    'xpk unpack'(it) {
      const bk = it.evalInt()
      const pw = it.accept(',') ? checkPassword(it.evalStr()) : undefined
      const data = ppkBank(rt, bk)
      if (!data || bankLong(data, 0) !== XPK_MAGIC) return
      try {
        replaceBank(rt, bk, xpkUnpack(data, pw))
        rt.explode.xpkErr = 0
      } catch (e) {
        rt.explode.xpkErr = xpkErrOf(e)
      }
    },

    /**
     * `Xpk Pack bk,method$,mode` and `Xpk Crypt bk,method$,password$` —
     * routines 136 and 137 ($2630 and $2650), both into `L_XpkWork`.
     *
     * The method is a four-character sub-library name ("NUKE", "SQSH",
     * "RLEN") and the mode its 0-to-100 effort. `Xpk Crypt` is the same call
     * with a password instead of a mode, which is what makes the stream
     * `XPKSTREAMF_PASSWORD`.
     *
     * NOTE: the name pointer is taken as `(a3)+ then adda.l #2` — the AMOS
     * string's characters WITHOUT its length word, handed to xpkmaster as if
     * NUL-terminated. Nothing puts a terminator there, so what the library
     * reads past four characters is whatever the string heap holds.
     *
     * DEVIATION: this port's xpkmaster has one packer registered, XPK_NONE
     * ("----"), because a sub-library is a separate binary and the corpus has
     * none. A method it does not know is `XPKERR_NOFUNC`, recorded in
     * `Xpk Errn` exactly as a missing sub-library would be on the machine.
     */
    'xpk pack': (it) => xpkWork(rt, it, false),
    'xpk crypt': (it) => xpkWork(rt, it, true),

    /**
     * `Plane Mask pln,msk` — routine 98 ($1b70): OR a longword over an entire
     * bitplane.
     *
     * `or.l d6,(a0)+` for the whole plane, so it is not a mask in the
     * RastPort sense — it SETS every bit the argument names, in every
     * longword of the plane. A mask of $FFFFFFFF fills the plane; one of
     * $AAAAAAAA lays a vertical stripe over whatever was there.
     *
     * The plane number is checked against `EcMaxPlans` (6) and the screen
     * must be open — `tst.l ScOnAd(a5) / Rbeq L_SNopen`, error 47. A plane
     * the screen does not have is silently nothing, which is how the whole
     * group behaves.
     */
    'plane mask'(it) {
      const pln = it.evalInt()
      it.expect(',')
      const msk = it.evalInt()
      overPlane(rt, pln, (b, at) => {
        const v = ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) | msk
        b[at] = (v >>> 24) & 0xff
        b[at + 1] = (v >>> 16) & 0xff
        b[at + 2] = (v >>> 8) & 0xff
        b[at + 3] = v & 0xff
      })
    },

    /**
     * `Plane Clear pln` — routine 99 ($1bb0): `BltClear` on the whole plane.
     *
     * The only one of the group that goes to the blitter rather than the
     * CPU, and the only one whose byte count is not rounded down to a
     * longword — see `Plane Negative` for why that matters.
     */
    'plane clear'(it) {
      const b = planeBytes(rt, it.evalInt())
      if (b) b.buf.fill(0, b.at, b.at + b.size)
    },

    /**
     * `Plane Negative pln` — routine 105 ($1d7c): `not.l (a0)+` over the
     * plane, which inverts every pixel in it.
     *
     * NOTE: the loop is `lsr.l #2,d0 / subq #1,d0` and then a `dbra`, so it
     * covers `planeSize / 4` longwords and any last 1 to 3 bytes are LEFT
     * ALONE. A plane's size is bytesPerRow * rows and both are even, so the
     * remainder is 0 or 2 — and at 2 the final word survives the inversion.
     * `Plane Mask`, `Plane Swap` and `Plane Merge` all share the arithmetic
     * and the same edge.
     */
    'plane negative'(it) {
      overPlane(rt, it.evalInt(), (b, at) => {
        b[at] = ~b[at]! & 0xff
        b[at + 1] = ~b[at + 1]! & 0xff
        b[at + 2] = ~b[at + 2]! & 0xff
        b[at + 3] = ~b[at + 3]! & 0xff
      })
    },

    /**
     * `Plane Copy src To dst` — routine 103 ($1cca): `CopyMem` one plane over
     * another.
     *
     * `Plane Merge src To dst` — routine 106 ($1dba) — is the same walk with
     * `or.l` instead, so the destination keeps what it had and gains the
     * source's set bits.
     *
     * BOTH REFUSE A PLANE TO ITSELF: `cmp.l d6,d7 / beq.s .Skip` on the
     * plane ADDRESSES, not the numbers. So `Plane Copy 0 To 0` does nothing,
     * and so would a copy between two numbers that happened to name one
     * plane.
     */
    'plane copy': (it) => planePair(rt, it, (_d, sv) => sv),
    'plane merge': (it) => planePair(rt, it, (d, sv) => d | sv),

    /**
     * `Plane Swap a,b` — routine 104 ($1d22): exchange two planes, a
     * longword at a time.
     *
     * The cheap way to animate: two planes of a four-plane screen swapped
     * every frame is a two-frame loop with no blitting. Same
     * plane-to-itself guard as Copy and Merge.
     */
    'plane swap'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const pa = planeBytes(rt, a)
      const pb = planeBytes(rt, b)
      if (!pa || !pb || pa.at === pb.at) return
      const n = (Math.min(pa.size, pb.size) >> 2) << 2
      for (let i = 0; i < n; i++) {
        const t = pa.buf[pa.at + i]!
        pa.buf[pa.at + i] = pb.buf[pb.at + i]!
        pb.buf[pb.at + i] = t
      }
    },

    /**
     * `Plane Get pln To bk` — routine 100 ($1bee): reserve a Work bank the
     * size of one plane and copy the plane into it.
     *
     * `Plane Put pln To bk` — routine 101 ($1c4a) — reads the arguments the
     * other way round in the source text (`Plane Put bk To pln` is what the
     * spec `I0t0` and the pops say) and copies back, CLAMPED to the plane:
     * `cmp.l d0,d5 / ble.s .1 / move.l d0,d5`, so a bank bigger than a plane
     * is truncated rather than overrunning.
     *
     * Plane Get's bank is a plain `Bnk.Reserve`, so an existing bank of that
     * number is erased first, and a failure is error 24.
     */
    'plane get'(it) {
      const pln = it.evalInt()
      it.expect('to')
      const bk = it.evalInt()
      const p = planeBytes(rt, pln)
      if (!p) return
      rt.eraseBank(bk & 0xffff)
      rt.reserveBank(bk & 0xffff, p.size, 'Work', false, false)
      rt.memBanks.get(bk & 0xffff)!.data.set(p.buf.subarray(p.at, p.at + p.size))
    },

    'plane put'(it) {
      const bk = it.evalInt()
      it.expect('to')
      const pln = it.evalInt()
      const ref = orAdr(rt, bk)
      const p = planeBytes(rt, pln)
      if (!ref || !p) return
      const bank = rt.memBanks.get(ref.number)
      if (!bank) return
      const n = Math.min(bank.data.length, p.size)
      p.buf.set(bank.data.subarray(0, n), p.at)
    },

    /**
     * `Plane Open [pln [To pln]]` and `Plane Close [pln [To pln]]` —
     * routines 107 to 110 ($1e12, $1e26,
     * $1e52 and $1e66).
     *
     * These are the RastPort write mask, `rp_Mask`, and the only pair in the
     * group that does not touch pixels: a closed plane is one a draw cannot
     * reach, so it keeps whatever it had.
     *
     * The range form SORTS ITS ARGUMENTS. `cmp.l d1,d0 / bge.s .1 / exg.l
     * d0,d1` — `Plane Close 4 To 1` closes 1 to 4 exactly as `1 To 4` does.
     *
     * DEFECT: the range loop cannot reach the last plane. It closes with
     * `bclr d1,rp_Mask(a0) / addq.l #1,d1 / dbeq d0,.2`, and `bclr` sets Z
     * from the bit's OLD value — so the moment it hits a bit that was
     * already clear, the EQ satisfies and the loop stops. `Plane Close 0 To
     * 3` on a mask that has already lost plane 1 never reaches 2 or 3.
     * `Plane Open` has the identical bug with `bset`, where it stops at the
     * first bit that was already SET.
     */
    'plane close': (it) => planeMask(rt, it, false),
    'plane open': (it) => planeMask(rt, it, true),

    /**
     * `Iff Bank bk To screen` — routine 112 ($1ebc), and the largest routine
     * in the library: a whole ILBM reader.
     *
     * *"Zunaechst scheint der Befehl ein wenig ueberfluessig, da ja in
     * AMOSPro bereits der Befehl 'Load Iff' existiert"* — and then the
     * manual gives the reason: a PACKED picture would otherwise have to be
     * unpacked to a file first and loaded back. This takes it from the bank
     * an `Xpk Unpack` just left it in.
     *
     * It hunts BMHD two bytes at a time over the first 1024 tries, reads the
     * width, height, depth and compression, then walks CMAP, CAMG, ABIT and
     * BODY the same way. The view mode is GUESSED where CAMG is absent —
     * over 352 wide and 16 colours or fewer is hires, over 300 lines is
     * laced, 64 colours without bit 7 is HAM — and then masked to
     * `%1000100010000100`, the four flags AMOS's own screens understand.
     *
     * A WIDTH THAT IS NOT A MULTIPLE OF 16 IS ERROR 48. `divs #16 / swap /
     * tst.w / Rbne L_IScrn` — the screen it opens has to be word-aligned.
     * A screen number above 7 is error 23, and a bank with no BMHD in its
     * first 2048 bytes is error 31.
     *
     * DEVIATION: this port has an ILBM reader of its own in ../loader/iff.ts
     * and `Load Iff` already uses it. Reproducing a second parser to be
     * bug-compatible with the chunk hunt would mean reproducing its bugs
     * without a program that needs them; the checks that a program CAN see
     * -- the screen number, the width, the missing-BMHD case -- are done
     * here and the decode is the shared one.
     */
    'iff bank'(it) {
      const bk = it.evalInt()
      it.expect('to')
      const scrn = it.evalInt()
      if (scrn >>> 0 >= 8) funcCall()
      const ref = orAdr(rt, bk)
      if (!ref) return
      const bank = rt.memBanks.get(ref.number)
      if (!bank) amosError(31, 'IFF compression not recognised')
      let img
      try {
        img = parseIlbm(bank.data)
      } catch {
        // the chunk hunt running off the end is `Rbne L_NoIff`, error 31 --
        // NOT AMOS's own error 30 for a bad FORM
        amosError(31, 'IFF compression not recognised')
      }
      if (img.width % 16 !== 0) amosError(48, 'Illegal screen parameter')
      rt.openScreen(scrn, img.width, img.height, img.mode & 0x800 ? 4096 : 1 << img.depth, (img.mode & 0x8000) | (img.mode & 4))
      const s = rt.screens.get(scrn)!
      for (let i = 0; i < Math.min(32, img.palette.length); i++) s.palette[i] = img.palette[i]!
      rt.blit(s, img, 0, 0, true, -1)
    },

    /**
     * `Clear Mouse` — routine 5 ($dc2): spin until no mouse button is held.
     *
     * `SyCall MouseKey / tst.w d1 / Rbne L_ClearMouse` — it re-enters ITSELF
     * rather than looping, which is the same thing with a longer branch. The
     * point is to swallow a click the program has already reacted to, so the
     * `Wait Mouse` after it does not fire on the same press.
     */
    'clear mouse'(it) {
      if (rt.input.mouseK !== 0) it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
    },

    /**
     * `Stop Loop` — routine 7 ($e14): wait for a key, a mouse button or the
     * JOYSTICK FIRE BUTTON.
     *
     * The fire test is `btst #7,$BFE001` straight at CIA-A port A, which is
     * port 1's fire and active low. So this is the three-way version of
     * `Wait Loop` and the only keyword in the group that watches the
     * joystick.
     *
     * NOTE: the Inkey test here is `tst.l d1` where `Wait Loop` and `Pause`
     * use `tst.w d1`, and the author's comment says why — *"auch AMIGA-Keys
     * gültig"*. The long test sees the qualifier bits in the high word, so
     * an Amiga key alone ends a Stop Loop and does not end a Wait Loop.
     */
    'stop loop'(it) {
      if (rt.input.keyQueue.length === 0 && rt.input.mouseK === 0 && !joyFire(rt.input.joy)) {
        it.block({ type: 'waitInput', mouse: true, key: true }, true)
      }
    },

    /** `Wait Mouse` — routine 9 ($e70): wait for a button, and nothing else */
    'wait mouse'(it) {
      if (rt.input.mouseK === 0) it.block({ type: 'waitInput', mouse: true, key: false }, true)
    },

    /**
     * `Set Hard Time "HH:MM:SS"` and `Set Hard Date "DD-MM-YY"` — routines 17
     * and 18 ($f68 and $f7c).
     *
     * The string must be EXACTLY eight characters (`cmpi.w #8,(a0)+ / Rbne
     * L_IFunc`) and the separators are not checked at all: `L_SetTimeDate`
     * (routine 176, $3480) reads the digits at 0,1 3,4 6,7 and subtracts
     * "0" from each, so "12x34x56" sets the same time as "12:34:56" and
     * "1A:00:00" writes a nibble of 17.
     *
     * The nibbles go into the battery clock's registers backwards — `move.b
     * d1,(a1) / lea -4(a1),a1` from $DC0017 downward, one nibble per
     * longword. Set Hard Date swaps the day and year fields round in a
     * scratch buffer first, because the clock stores year-month-day.
     *
     * DEVIATION: there is no battery clock in this port to write to, and the
     * host's own clock is not this program's to set. The pair validate their
     * argument and change nothing, so a program that sets the clock and reads
     * it back gets the host's time; see `hard time$`.
     */
    'set hard time': (it) => setHardClock(it.evalStr()),
    'set hard date': (it) => setHardClock(it.evalStr()),

    /**
     * `Drive Busy drv,arg` — routine 122 ($2388): the drive's motor.
     *
     * `DeviceProc("DFx:")` for the handler's message port, then a hand-built
     * `DosPacket` with action 31 (`ACTION_MORE_CACHE`... which is not what
     * the author wanted) and the argument, sent with `PutMsg` and waited for.
     * A non-zero argument spins the motor up and zero lets it stop.
     *
     * NOTE: the packet is assembled in `Name1`, AMOS's shared scratch buffer,
     * and so is its own reply port link. Anything else using Name1 across
     * the `WaitPort` would corrupt it, and `WaitPort` is not a short wait.
     *
     * DEVIATION: nothing here has a drive motor. The drive number is turned
     * into a name the same way (`addi.l #48,d6` then a byte into "DFx:") and
     * a volume that is not mounted does nothing, which is what a failed
     * DeviceProc does.
     */
    'drive busy'(it) {
      const drv = it.evalInt()
      it.expect(',')
      it.evalInt()
      rt.vfs?.volume(`DF${String.fromCharCode((drv + 48) & 0xff)}`)
    },

    /**
     * `Hardreset` and `Softreset` — routines 124 and 125 ($2424 and $247a).
     *
     * Both end the machine. Hardreset scribbles $AAAABBBB over exec's six
     * capture and KickTag pointers so nothing survives, then `jmp -726(a6)`
     * (ColdReboot) on a 2.0 exec or a hand-rolled `reset / jmp (a0)` through
     * the ROM's initial PC on a 1.3 one. Softreset takes trap 13 and jumps
     * straight to $FC0000 with interrupts off.
     *
     * The manual is candid about which is which: Softreset is *"Simulation
     * eines normalen Resets"*.
     *
     * DEVIATION: this port has one program and no machine to reboot, so both
     * stop the program. That is the nearest honest thing — the alternative
     * is a keyword that returns, which on the machine it never does.
     */
    hardreset: (it) => it.halt('stopped', false),
    softreset: (it) => it.halt('stopped', false),

    /**
     * `Flush` — routine 126 ($2496): close the five libraries, then ask exec
     * for $7FFFFFFF bytes of chip and $7FFFFFFF of fast.
     *
     * The allocations are meant to FAIL. A failed AllocMem makes exec flush
     * its memory list — expunging every library and device whose open count
     * is zero — and that is the whole purpose; the return value is discarded
     * without being looked at.
     *
     * DEVIATION: the five libraries are closed, which is the part with an
     * effect here. There is no exec memory list to squeeze.
     */
    flush() {
      rt.explode.fonts.fill(null)
    },

    /**
     * `Open Workbench` — routine 128 ($24e8).
     *
     * Only acts if AMOS closed it: `tst.b WB_Closed(a5)`, then
     * `OpenWorkBench`, then `RemakeDisplay` to put AMOS's own screens back
     * over the top, and the flag is cleared only if the open succeeded.
     *
     * There is no `Close Workbench` here — that is AMOS's own keyword, and
     * this is the other half of it.
     */
    'open workbench'() {
      // AMOS's own `Close Workbench` is a no-op in this port (instr.ts) --
      // there is no Workbench screen to free -- so its other half has
      // nothing to put back either
    },

    /**
     * `Amcaf Crack On` and `Amcaf Crack Off` — routines 131 and 132 ($2534
     * and $2546), and the author's own manual calls them *"Privat
     * (Illegal)"*.
     *
     * Two instructions each: save the word at `-22(a5)` and write 1 into it,
     * or put the saved word back. That word is what AMCAF's shareware check
     * reads, so setting it defeats the check and lets AMCAF's keywords
     * survive compilation.
     *
     * NOT IMPLEMENTED AS A CRACK, and the reason is in the manual rather
     * than being this port's opinion: *"Diese Befehle sind nicht legal, bei
     * Anwendung wird gegen das Urheberrecht verstoßen!"*. The word is saved
     * and restored so the pair balance, and nothing reads it — this port has
     * no AMCAF shareware check to defeat, because it has no shareware check.
     */
    'amcaf crack on'() {
      rt.explode.amcafCrack = 0
    },
    'amcaf crack off'() {
      rt.explode.amcafCrack = 0
    },

    /**
     * `Cd Set path$` — routine 134 ($25a2): store a path, up to 256
     * characters (`cmpi.w #my_CdLength,d0 / Rbcc L_IFunc`, so an empty one
     * wraps and fails too).
     *
     * IT APPENDS A SLASH unless the path already ends in one or in a colon,
     * and the stored length counts it. So `Cd Set "DH0:work"` stores
     * "DH0:work/" and the three keywords compose cleanly.
     *
     * NOTE: nothing else in the library reads `my_CdPath`. `Bank Load`,
     * `Bank Save`, `File Size` and the rest all go through `L_Dsk.PathIt`,
     * which is AMOS's own current directory — so this trio is a path
     * BUILDER a program glues its own filenames onto, not a Cd that changes
     * where the other keywords look.
     */
    'cd set'(it) {
      const path = it.evalStr()
      if (path.length < 1 || path.length > CD_LENGTH) funcCall()
      rt.explode.cdPath = /[:/]$/.test(path) ? path : `${path}/`
    },

    /**
     * `Cd Parent` — routine 135 ($25ec): drop the last component.
     *
     * Walks back from the end for a "/" or a ":" and truncates just after
     * it. An empty path does nothing, and so does one already at a volume
     * root — the first test is `cmpi.b #":",(a0,d0.w)` on the LAST
     * character, before the trailing slash is stepped over.
     */
    'cd parent'() {
      const p = rt.explode.cdPath
      if (p === '' || p.endsWith(':')) return
      const cut = Math.max(p.lastIndexOf('/', p.length - 2), p.lastIndexOf(':', p.length - 2))
      rt.explode.cdPath = cut < 0 ? p : p.slice(0, cut + 1)
    },

    /**
     * `Font Open fnt,name$,height` — routine 113 ($20b6).
     *
     * `OpenFont` first for a ROM font, and only if that fails `OpenDiskFont`
     * through diskfont.library. The slot is 1 to 8 (`cmpi.l #my_FntMax` then
     * `subq.l #1 / Rbmi`, so 0 is error 23 as well as 9).
     *
     * A SLOT THAT IS ALREADY OPEN IS LEFT ALONE — `tst.l (a1,d6.l) / bne.s
     * .Skip` — and quietly: no error, and the font you asked for is not
     * opened. `Font Close fnt` first.
     *
     * A font that does not exist is also quiet, which is the other half of
     * why `=Font Name$(fnt)` exists.
     */
    'font open'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      it.expect(',')
      const height = it.evalInt()
      const slot = fntSlot(n)
      if (rt.explode.fonts[slot] !== null) return
      const font = openDiskFont((p) => rt.vfs?.read(p) ?? null, name, height)
      if (!font) return
      rt.explode.fonts[slot] = { name: font.name, height: font.ySize, base: fontBase(slot) }
    },

    /**
     * `Font Set fnt` — routine 114 ($2140): `SetFont` on AMOS's RastPort.
     *
     * *"Nicht SET FONT!"*, says the author's own comment beside the argument
     * — AMOS has a `Set Font` of its own that takes a number from `Get
     * Fonts`, and this is not it. An unopened slot does nothing.
     */
    'font set'(it) {
      // the slot is validated even when nothing is in it, and SetFont is
      // skipped rather than refused
      fntSlot(it.evalInt())
    },

    /**
     * `Font Close [fnt]` — routines 115 and 116 ($2178 and $21a0).
     *
     * With no argument it walks all eight and closes every one; with a
     * number it closes that one. Both clear the slot before calling
     * `CloseFont`, and both are silent about a slot that was never open.
     */
    'font close'(it) {
      if (it.atStmtEnd()) {
        rt.explode.fonts.fill(null)
        return
      }
      rt.explode.fonts[fntSlot(it.evalInt())] = null
    },

    /**
     * `Rs Structure n,size` — routine 41 ($12b2), which is the whole group's
     * `Reserve As Work`.
     *
     * Frees whatever the slot held first, then `L_RamFast` for `size`, and
     * sets all three fields: start and position to the address, length to
     * the size. So a fresh structure's cursor is at its start.
     *
     * The manual: *"Hierbei können gleichzeitig 8 verschiedene Strukturen
     * (0-7) bearbeitet werden. Die größe einer Struktur wird in Bytes
     * übergeben."*
     *
     * NOTE: nothing checks that the size is positive. `RamFast` of zero or
     * less fails and comes back through `Rbeq L_OOfmem`, which is error 24,
     * and that is what happens here — the pool returns 0 for any length at
     * or below zero.
     */
    'rs structure'(it) {
      const n = it.evalInt()
      it.expect(',')
      const size = it.evalInt()
      const st = rsSlot(rt, n, true)!
      if (st.start !== 0) rt.explode.pool.freeMem(st.start)
      const at = rt.explode.pool.alloc(size)
      if (at === 0) amosError(24, 'Out of memory')
      st.start = at
      st.length = size
      st.position = at
    },

    /**
     * `Rs Clear n` — routine 45 ($1382): `clr.b (a1)+` for `Length` bytes.
     *
     * DEVIATION: the loop is not guarded and this port will not run it as
     * written. `movea.l my_RsStart(a0),a1 / move.l my_RsLength(a0),d0 /
     * subq.l #1,d0` with nothing between them, so on a structure that was
     * never allocated a1 is 0 and d0 becomes -1 — and `dbra` tests the low
     * WORD, so it writes 65,536 zero bytes starting at address 0. That is
     * the vector table, and it is the end of the machine. An unallocated
     * structure clears nothing here.
     */
    'rs clear'(it) {
      const st = rsSlot(rt, it.evalInt(), true)!
      if (st.start === 0) return
      for (let i = 0; i < st.length; i++) poke(rt, st.start + i, 0)
    },

    /**
     * `Rs Fill n,char,count` — routine 46 ($13b0), and TWO quirks in eleven
     * instructions.
     *
     * FIRST, the guard is the wrong quantity. `cmp.l my_RsLength(a0),d6 /
     * bge.s .2` tests the COUNT against the structure's LENGTH, not the
     * cursor against the end — so a count at or above the length writes
     * NOTHING AT ALL, and a count below it writes from wherever the cursor
     * happens to be with no bound on the far end. Filling the last four
     * bytes of a fifty-byte structure runs off it.
     *
     * SECOND, FILLING WITH CHARACTER ZERO WRITES ONE BYTE. The loop closes
     * with `dbeq d6,.1` and the `move.b d5,(a1)+` before it sets Z when the
     * byte written is zero, so the first pass satisfies the EQ and falls
     * out. `Rs Fill 0,0,100` is not how you clear a structure; `Rs Clear` is.
     *
     * The count is a countdown from `count` to -1, so `count + 1` bytes.
     */
    'rs fill'(it) {
      const n = it.evalInt()
      it.expect(',')
      const char = it.evalInt() & 0xff
      it.expect(',')
      const count = it.evalInt()
      const { st } = rsCursor(rt, n)
      if (count >= st.length) return
      let at = st.position
      for (let d = count; d >= 0; d--) {
        poke(rt, at++, char)
        if (char === 0) break
      }
      st.position = at
    },

    /**
     * `Rs Byte n,#`, `Rs Word n,#` and `Rs Long n,#` — routines 47, 48 and 49
     * ($13ec, $141c and $1456). One, two and four bytes at the cursor,
     * big-endian, and the cursor moves by what was written.
     *
     * Word and Long do it the long way round on purpose. `movea.l a3,a2 /
     * lea 4(a3),a3` takes the ADDRESS of the argument still sitting on the
     * stack and then copies out of it a byte at a time — `move.b 2(a2),(a1)+
     * / move.b 3(a2),(a1)+` for a word, a `REPT 4` for a long. The author's
     * comment says why: *"Auch ungerade Adresse"*. A `move.w` to an odd
     * address is an address error on a 68000, and a structure cursor lands
     * wherever the fields before it left it.
     */
    'rs byte': (it) => rsPut(rt, it, 1),
    'rs word': (it) => rsPut(rt, it, 2),
    'rs long': (it) => rsPut(rt, it, 4),

    /**
     * `Rs Aptr n,$` — routine 50 ($1490): a POINTER to a NUL-terminated copy
     * of the string, four bytes at the cursor.
     *
     * This is what fills the argument buffer `Format$`'s `%s` reads, and the
     * author's own example is `Rs Aptr 0,"..."` then `Format$(A$,Rs
     * Start(0))`.
     *
     * AN EMPTY STRING DOES NOTHING. `move.w (a2)+,d0 / beq.s .Skip` — not a
     * null pointer, not four zero bytes; the cursor does not even move.
     *
     * DEFECT: it copies ONE CHARACTER TOO MANY. `dbeq d0,.1` counts d0 down
     * from the length to -1, which is length+1 passes, so the byte after the
     * string comes along with it and the NUL goes after THAT. On the machine
     * that byte is whatever the string workspace holds next. DEVIATION: the
     * length is reproduced and the byte is zero, the same choice `chars`
     * makes above — inventing a neighbour is worse than being short.
     *
     * DEVIATION: the pointer outlives the string on the machine and does not
     * here. `L_GetSpace` takes AMOS's string workspace, which the next
     * expression may reuse, so a stored Aptr can go stale; this pool does
     * not move.
     */
    'rs aptr'(it) {
      const n = it.evalInt()
      it.expect(',')
      const text = it.evalStr()
      const { st } = rsCursor(rt, n)
      if (text.length === 0) return
      const body = rsCopyLength(text)
      const at = rt.explode.pool.alloc(body.length + 1)
      if (at === 0) amosError(24, 'Out of memory')
      for (let i = 0; i < body.length; i++) poke(rt, at + i, body.charCodeAt(i))
      poke(rt, at + body.length, 0)
      for (let i = 0; i < 4; i++) poke(rt, st.position + i, (at >>> (24 - i * 8)) & 0xff)
      st.position += 4
    },

    /**
     * `Rs Char n,$` — routine 51 ($14dc): the characters themselves, with no
     * terminator, and the cursor moves past them.
     *
     * An empty string does nothing, as `Rs Aptr` does nothing, and the same
     * `dbeq` copies one byte too many — so the cursor advances by LENGTH + 1
     * and the last of them is not a character of the string. Both are
     * reproduced; see `Rs Aptr` for what the extra byte is.
     */
    'rs char'(it) {
      const n = it.evalInt()
      it.expect(',')
      const text = it.evalStr()
      const { st } = rsCursor(rt, n)
      if (text.length === 0) return
      const body = rsCopyLength(text)
      for (let i = 0; i < body.length; i++) poke(rt, st.position + i, body.charCodeAt(i))
      st.position += body.length
    },

    /**
     * `Rs Set n,offset`, `Rs Bset n,#`, `Rs Wset n,#` and `Rs Lset n,#` —
     * routines 52 to 55 ($1516, $1544,
     * $1572 and $15a2).
     *
     * `Rs Set` puts the cursor at START plus the offset and is the only one
     * that reads the start; the other three move it by the amount times one,
     * two and four. The manual: *"Die Werte können dabei auch Negativ
     * sein."*
     *
     * `Rs Set` tests the START and raises on an unallocated structure; the
     * three relative ones test the POSITION. Same answer, different field.
     */
    'rs set'(it) {
      const n = it.evalInt()
      it.expect(',')
      const off = it.evalInt()
      const st = rsSlot(rt, n, true)!
      if (st.start === 0) funcCall()
      st.position = (st.start + off) | 0
    },
    'rs bset': (it) => rsMove(rt, it, 1),
    'rs wset': (it) => rsMove(rt, it, 2),
    'rs lset': (it) => rsMove(rt, it, 4),

    /**
     * `Rs Erase [n]` — routines 56 and 57 ($15d2 and $15d6), the second of
     * which is `L_RsEraseAll` (routine 184, $3a4c) walking all eight.
     *
     * Both free the block and clear the three fields, and both are silent
     * about a number out of range.
     *
     * NOTE: `move.l my_RsLength(a0),d0 / beq.s .Skip` — A ZERO LENGTH SKIPS
     * THE WHOLE THING, fields included. `Rs Structure 0,0` cannot happen
     * (the allocation fails first), so the only way to see it is a structure
     * that was already erased, where there is nothing to clear anyway.
     */
    'rs erase'(it) {
      if (it.atStmtEnd()) {
        for (let n = 0; n < RS_MAX; n++) rsErase(rt, n)
        return
      }
      rsErase(rt, it.evalInt())
    },

    /**
     * `Bank Load name$ [To bk] [,mask]` — routines 19 to 22 ($fa6, $fbe, $fd6, $fea).
     *
     * Four token entries share one name (the table spells the first
     * `!bank load` and leaves the other three unnamed), so the arity is
     * settled here rather than by the tokeniser. The default bank is
     * `my_BkDefault` = 8 and the default mask is zero, which is a Fast Work
     * bank.
     */
    'bank load'(it) {
      const name = it.evalStr()
      let bank = 8
      let mask = 0
      if (it.accept('to')) {
        bank = it.evalInt()
        if (it.accept(',')) mask = it.evalInt()
      } else if (it.accept(',')) {
        mask = it.evalInt()
      }
      bankLoad(name, bank, mask)
    },

    /**
     * `Bank Save name$,bk` — routine 23 ($ffe).
     *
     * Writes `BkLength - my_BkHeader`: the payload, with NO header in front
     * of it. The manual is explicit — *"Dabei wird kein Bank-Header
     * vorangestellt"* — so this is not `Bsave` of a bank and the file it
     * makes is what `Bank Load` reads back.
     *
     * A Bob or Icon bank is error 23. The BANK is checked first even though
     * the name is written first: the arguments pop right to left, so the bank
     * is off the stack and through Bnk.OrAdr before the filename is looked at
     * at all. `Bank Save "",1` on a Bob bank raises for the bank, not the
     * name.
     */
    'bank save'(it) {
      const name = it.evalStr()
      it.expect(',')
      const ref = orAdr(rt, it.evalInt())
      if (!ref) return
      if (isObjectBank(ref)) funcCall()
      checkName(name)
      const bank = rt.memBanks.get(ref.number)
      if (!bank) amosError(94, 'I/O error')
      // a failed Open and a short Write are the same error
      if (!rt.vfs?.writeFile(name, Uint8Array.from(bank.data))) amosError(94, 'I/O error')
    },

    /**
     * `Bank As Work bk` and `Bank As Data bk` — routines 24 and 25
     * ($107e and $10a6), the Bnk_BitData bit cleared and set.
     *
     * AND THEY RENAME THE BANK. `cmpi.l #"Data",my_BkName(a0)` — if the name
     * is exactly "Data" then `Bank As Work` writes "Work" over it, and the
     * other way round. Any other name is left alone, so a bank called
     * "Tracker" keeps its name and only the flag moves. The manual's example
     * is `Reserve As Data 7,100 : Bank As Work 7 : Erase Temp`, which is the
     * point of the flag: Bnk.EffTemp tests Bnk_BitData and nothing else.
     */
    'bank as work': (it) => setDataBit(rt, it.evalInt(), false),
    'bank as data': (it) => setDataBit(rt, it.evalInt(), true),

    /**
     * `Bank Clone src To dest` — routine 27 ($10da).
     *
     * The destination pops FIRST because it is the last argument. Reserve
     * gets the SOURCE's flags, the SOURCE's name and the source's payload
     * length, and then the payload is copied — so the clone differs from the
     * original in its number and its address and in nothing else. The manual
     * says as much: *"Dabei wird
     * Der Bank-Header so identisch wie möglich kopiert"*, and warns that the start addresses cannot match.
     *
     * A Bob or Icon source is error 23, and a destination that already
     * exists is erased by Bnk.Reserve rather than refused.
     */
    'bank clone'(it) {
      const src = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const ref = orAdr(rt, src)
      if (!ref) return
      if (isObjectBank(ref)) funcCall()
      const from = rt.memBanks.get(ref.number)
      if (!from) funcCall()
      const bytes = Uint8Array.from(from.data)
      rt.eraseBank(dest & 0xffff)
      rt.reserveBank(dest & 0xffff, bytes.length, from.name, (from.flags & BNK.DATA) !== 0, from.memType === 1)
      rt.memBanks.get(dest & 0xffff)!.data.set(bytes)
    },

    /**
     * `Bank To Chip bk` — routine 142 ($2d7e), and the only keyword in the
     * group that moves memory for its own sake.
     *
     * A bank that is already in chip RAM is left alone. Otherwise the flag is
     * set on the ORIGINAL first, a fresh chip bank is reserved at the first
     * free number, the payload is copied into it and `L_Bnk.HeadClone`
     * (routine 160, $3014) copies the number, flags, name and the reserved
     * word over — so the new bank ends up claiming the old one's NUMBER.
     *
     * The manual's example is the reason it exists: a packed tracker module
     * is loaded to fast RAM, unpacked, and has to reach chip RAM before
     * `Pt Play` can touch it.
     *
     * Almost all of that round trip is invisible here, and not by accident: a
     * bank's address in this port is `bankBase(number)`, a pure function of
     * the number, so reserving a copy elsewhere and then giving it the old
     * number lands it back at the same address. What is left is the flag,
     * which is what this sets.
     *
     * DEVIATION: the ORIGINAL IS LEAKED on the machine. Two headers carry one
     * number, the chain reaches the new one, and the old block is never
     * freed — so `=Fast Free` stays down by the bank's length for the rest of
     * the program. Here the one entry changes type and the fast memory comes
     * back.
     */
    'bank to chip'(it) {
      const ref = orAdr(rt, it.evalInt())
      if (!ref) return
      if ((ref.flags & BNK.CHIP) !== 0) return
      const bank = rt.memBanks.get(ref.number)
      if (!bank) return
      bank.memType = 1
    },

    /**
     * `Image Swap bk,i1,i2` — routine 30 ($115e).
     *
     * Swaps two 8-byte table entries, an image pointer and a mask pointer
     * each, so it is the images themselves that exchange places and every Bob
     * already using image 3 shows the new one.
     *
     * IT REFUSES NOTHING OUT LOUD. A bank that is neither Bob nor Icon, an
     * index above the count, an index of zero or below — each falls straight
     * to the `rts`. The compare is `cmp.w (a0),d6 / bgt.s .Skip` against the
     * count word, then `subq.l #1 / blt.s .Skip`, and both indices are tested
     * before either is used.
     */
    'image swap'(it) {
      const ref = orAdr(rt, it.evalInt())
      it.expect(',')
      const i1 = it.evalInt()
      it.expect(',')
      const i2 = it.evalInt()
      if (!ref) return
      const ob = objectBank(rt, ref)
      if (!ob) return
      const n = ob.images.length
      if (i1 > n || i2 > n || i1 < 1 || i2 < 1) return
      const a = ob.images[i1 - 1]!
      const b = ob.images[i2 - 1]!
      ob.setImage(i1, b)
      ob.setImage(i2, a)
    },
  }
}

/**
 * How many bytes `Rs Aptr` and `Rs Char` actually copy.
 *
 * `dbeq d0,.1` after `move.b (a2)+,(a1)+` counts d0 down from the LENGTH to
 * -1, which is length+1 passes, and the EQ ends it early on a zero byte. So
 * the copy is one character longer than the string unless the string has a
 * NUL in it, in which case it stops there.
 */
function rsCopyLength(text: string): string {
  const stop = text.indexOf('\0')
  return stop >= 0 ? text.slice(0, stop + 1) : `${text}\0`
}

/** the shared body of Rs Byte, Rs Word and Rs Long — routines 47, 48 and 49 */
function rsPut(rt: Runtime, it: Parameters<Instr>[0], width: number): void {
  const n = it.evalInt()
  it.expect(',')
  const v = it.evalInt()
  const { st } = rsCursor(rt, n)
  // big-endian, and byte at a time because the routines are: the low
  // `width` bytes of the longword the argument arrived as
  for (let i = 0; i < width; i++) poke(rt, st.position + i, (v >>> ((width - 1 - i) * 8)) & 0xff)
  st.position += width
}

/** the shared body of Rs Bset, Rs Wset and Rs Lset — routines 53, 54 and 55 */
function rsMove(rt: Runtime, it: Parameters<Instr>[0], scale: number): void {
  const n = it.evalInt()
  it.expect(',')
  const by = it.evalInt()
  const { st } = rsCursor(rt, n)
  st.position = (st.position + by * scale) | 0
}

/** one slot of Rs Erase — routine 57, and the body L_RsEraseAll repeats */
function rsErase(rt: Runtime, n: number): void {
  const st = rsSlot(rt, n, false)
  // `move.l my_RsLength(a0),d0 / beq.s .Skip`: a zero length leaves even the
  // fields alone
  if (!st || st.length === 0) return
  if (st.start !== 0) rt.explode.pool.freeMem(st.start)
  st.start = 0
  st.length = 0
  st.position = 0
}

/**
 * `=Explode$`'s own title, the 43 bytes routine 1 points at — a length word
 * and the assembler's EXPLODE and VERSION macros, which expand to the name
 * and the version line the library was built with.
 */
const EXPLODE_TITLE = 'Explode V2.01 (c)1995-2002 Volker Stepp'

/** two digits, which is all `L_HardTimeDate`'s BCD nibbles can make */
const two = (n: number): string => String(n % 100).padStart(2, '0')

/** the host clock, broken down the way the two Hard readers present it */
function nowCivil(rt: Runtime): ReturnType<typeof civilFromStamp> {
  const { days, mins, ticks } = rt.host.clock.now()
  return civilFromStamp(days, mins, ticks)
}

/**
 * `ExtNb equ 7-1` — the extension's own slot, zero-based as routine 0 leaves
 * it in d0, and where its data zone is mapped. Spelled out rather than
 * imported because `./runtime` is a TYPE-only import here.
 */
const EXT_SLOT = 6
/** `Runtime.SCREEN_CTRL_BASE` and `SCREEN_CTRL_SLOT`, for the same reason */
const SCREEN_CTRL_BASE = 0x4800_0000
const SCREEN_CTRL_SLOT = 0x0000_1000
const EXT_DATA_BASE = 0x7800_0000
const EXT_DATA_SLOT = 0x0001_0000
const extDataBase = (slot: number): number => (EXT_DATA_BASE + slot * EXT_DATA_SLOT) | 0

/**
 * `my_FntStruc`'s index, and the range check all six font keywords share.
 *
 * `cmpi.l #my_FntMax,d0 / Rbpl L_IFunc` then `subq.l #1,d0 / Rbmi L_IFunc` —
 * so the slots are 1 TO 8, and 0 is as much an error as 9. That is the one
 * place this library counts from one; the Rs structures count from zero.
 */
function fntSlot(n: number): number {
  if (n < 1 || n > FNT_MAX) funcCall()
  return n - 1
}

/**
 * Where a slot's `TextFont` is mapped, so `=Font Base(n)` has an address to
 * give — the top of the Rs pool's span, counting down, which the pool's own
 * bump allocator will never reach.
 */
const fontBase = (slot: number): number => (HEAP_BASE + HEAP_RESERVED - (slot + 1) * 0x100) | 0

/**
 * `Set Hard Time` and `Set Hard Date`'s shared validation — routines 17 and
 * 18, which check the LENGTH and nothing else.
 *
 * `cmpi.w #8,(a0)+ / Rbne L_IFunc`: exactly eight characters. The separators
 * are never looked at, because `L_SetTimeDate` reads positions 0,1 3,4 6,7
 * and skips whatever is between them.
 */
function setHardClock(text: string): void {
  if (text.length !== 8) funcCall()
}

/**
 * The mouse-or-key answer `=Pause` and `=Wait Loop` share.
 *
 * `cmpi.w #3,d3 / bgt.s .Skip / neg.l d3` — three or below is a mouse code
 * and comes back NEGATED, so -1 is left, -2 right, -3 both; anything above 3
 * is the key itself, positive. Zero means neither.
 */
function mouseOrKey(rt: Runtime): number {
  const k = rt.input.mouseK & 3
  if (k !== 0) return -k
  const q = rt.input.keyQueue
  if (q.length === 0) return 0
  const ch = q.shift()!.ch.charCodeAt(0)
  return ch > 3 ? ch : -ch
}

/**
 * `EcMaxPlans` (+Equ.s:480) — *"6 Plans pour le moment!"*, and every plane
 * keyword tests against it.
 */
const EC_MAX_PLANS = 6

/**
 * One plane of the current screen: the buffer, where the plane starts in it,
 * and how long it is.
 *
 * The three guards every plane keyword shares, in the order they apply:
 * `cmpi.l #EcMaxPlans,d7 / bpl.s .Skip` (quiet), `tst.l ScOnAd(a5) / Rbeq
 * L_SNopen` (error 47), and `move.l bm_Planes(a0,d7.l),d7 / beq.s .Skip` for
 * a plane the screen does not have (quiet again).
 *
 * DEVIATION: the first test is SIGNED. `bpl` after `cmpi.l #6,d7` skips when
 * d7 - 6 is positive, so a NEGATIVE plane number passes it, and `lsl.l #2,d7`
 * then indexes backwards off `bm_Planes` into the BitMap header — bm_Rows,
 * bm_Flags and the pointer above it. There is no BitMap struct here to read
 * backwards through, so a negative number is out of range.
 */
function planeBytes(rt: Runtime, pln: number): { buf: Uint8Array; at: number; size: number } | null {
  if (pln < 0 || pln >= EC_MAX_PLANS) return null
  // `tst.l ScOnAd(a5) / Rbeq L_SNopen`
  const s = rt.screens.get(rt.currentIndex) ?? null
  if (!s) amosError(47, 'Screen not opened')
  if (pln >= s.depth) return null
  const size = s.rowBytes * s.height
  return { buf: s.planarView('log', true), at: pln * s.planeSize, size }
}

/** the longword walk Plane Mask and Plane Negative share, remainder and all */
function overPlane(rt: Runtime, pln: number, each: (b: Uint8Array, at: number) => void): void {
  const p = planeBytes(rt, pln)
  if (!p) return
  // `lsr.l #2,d0 / subq #1,d0` then dbra: whole longwords only, and a
  // trailing word is left as it was
  for (let i = 0; i + 4 <= p.size; i += 4) each(p.buf, p.at + i)
}

/** the shared body of Plane Copy and Plane Merge — routines 103 and 106 */
function planePair(rt: Runtime, it: Parameters<Instr>[0], combine: (dst: number, src: number) => number): void {
  const src = it.evalInt()
  it.expect('to')
  const dst = it.evalInt()
  const ps = planeBytes(rt, src)
  const pd = planeBytes(rt, dst)
  // `cmp.l d6,d7 / beq.s .Skip` -- the plane ADDRESSES, not the numbers
  if (!ps || !pd || ps.at === pd.at) return
  const n = Math.min(ps.size, pd.size)
  for (let i = 0; i < n; i++) pd.buf[pd.at + i] = combine(pd.buf[pd.at + i]!, ps.buf[ps.at + i]!) & 0xff
}

/**
 * The shared body of Plane Open and Plane Close — routines 107 to 110, and
 * the `dbeq` defect they share.
 *
 * `bclr d1,rp_Mask(a0) / addq.l #1,d1 / dbeq d0,.2`: bclr sets Z from the
 * bit's OLD value, so the loop stops at the first bit that was already the
 * way it is being set. Reproduced, because a program that closes a range
 * twice sees it.
 */
function planeMask(rt: Runtime, it: Parameters<Instr>[0], open: boolean): void {
  let from = it.evalInt()
  if (from < 0 || from >= EC_MAX_PLANS) {
    if (it.accept('to')) it.evalInt()
    return
  }
  const s = rt.screens.get(rt.currentIndex) ?? null
  if (!it.accept('to')) {
    if (s) s.planeMask = open ? s.planeMask | (1 << from) : s.planeMask & ~(1 << from)
    return
  }
  let to = it.evalInt()
  if (to < 0 || to >= EC_MAX_PLANS || !s) return
  // `cmp.l d1,d0 / bge.s .1 / exg.l d0,d1` -- the pair is sorted, so
  // `4 To 1` is the same range as `1 To 4`
  if (from > to) [from, to] = [to, from]
  for (let n = from; n <= to; n++) {
    const was = (s.planeMask >> n) & 1
    s.planeMask = open ? s.planeMask | (1 << n) : s.planeMask & ~(1 << n)
    // the dbeq: Z from the old bit, so an already-set bit ends an Open and
    // an already-clear one ends a Close
    if (was === (open ? 1 : 0)) return
  }
}

/**
 * The PowerPacker identification table — routine 183 ($3942, `L_PpkID`),
 * which is two instructions and then sixty longwords of data.
 *
 * Ten formats, six longwords each, and every one of `Ppk Length`, `Ppk Mode`,
 * `Ppk Type`, `Ppk Name$`, `Ppk Passkey`, `Ppk Password` and `Ppk Data` walks
 * it the same way: compare the longword at `codePos` in the bank against
 * `code`, and the first row that matches is the format.
 *
 * TRANSCRIBED FROM THE SOURCE'S OWN `dc.l` BLOCK, comments included, because
 * the columns are not derivable from anything — `PPEX` appears three times
 * with three different probe offsets because three versions of the PowerPacker
 * self-extractor put their signature in three places, and $65804e75 is a
 * fragment of 68000 code rather than a magic number anybody chose.
 *
 *     Name  EffPos  CodePos  Code   CryptPos  Type
 */
interface PpkFormat {
  /** `my_PpkName` — the four characters `Ppk Name$` answers */
  name: string
  /** `my_PpkEffPos` — where the efficiency longword sits */
  effPos: number
  /** `my_PpkCodePos` — where to look for the signature */
  codePos: number
  /** `my_PpkCode` — what has to be there */
  code: number
  /** `my_PpkCryptPos` — where the password checksum WORD is, 0 if none */
  cryptPos: number
  /** `my_PpkType` — what `Ppk Type` answers, 1 to 8 */
  type: number
}

export const PPK_FORMATS: readonly PpkFormat[] = [
  { name: 'PP20', effPos: 0x004, codePos: 0x000, code: 0x50503230, cryptPos: 0x000, type: 1 },
  { name: 'PPLS', effPos: 0x008, codePos: 0x000, code: 0x50504c53, cryptPos: 0x000, type: 2 },
  { name: 'PPBK', effPos: 0x014, codePos: 0x000, code: 0x5050626b, cryptPos: 0x000, type: 3 },
  { name: 'PPLB', effPos: 0x094, codePos: 0x080, code: 0x706f7765, cryptPos: 0x000, type: 4 },
  // PPEX V4.x, V3.x and V2.x -- one name, three probes
  { name: 'PPEX', effPos: 0x290, codePos: 0x28c, code: 0x65804e75, cryptPos: 0x000, type: 5 },
  { name: 'PPEX', effPos: 0x240, codePos: 0x054, code: 0x504b2e1b, cryptPos: 0x000, type: 5 },
  { name: 'PPEX', effPos: 0x228, codePos: 0x118, code: 0x6472611a, cryptPos: 0x000, type: 5 },
  { name: 'PX20', effPos: 0x006, codePos: 0x000, code: 0x50583230, cryptPos: 0x004, type: 6 },
  { name: 'PXLB', effPos: 0x098, codePos: 0x084, code: 0x706f7765, cryptPos: 0x04a, type: 7 },
  { name: 'PXEX', effPos: 0x2fe, codePos: 0x2e2, code: 0x50617373, cryptPos: 0x08e, type: 8 },
]

/**
 * `my_PpkEffMode`, the five efficiency longwords the table ends with, and
 * what `=Ppk Mode` matches a bank's own against.
 *
 *     Fast  Mediocre  Good  VeryGood  Best
 *
 * `Ppk Pack`'s default is 2, Good — `move.l #2,my_PpkPackMode(a2)` in routine
 * 79, before the argument form has a chance to say otherwise.
 */
export const PPK_EFFICIENCY: readonly number[] = [0x09090909, 0x090a0a0a, 0x090a0b0b, 0x090a0c0c, 0x090a0c0d]

/** a longword out of a bank's payload, which is what every probe reads */
function bankLong(data: Uint8Array, at: number): number {
  if (at + 3 >= data.length) return 0
  return (((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0)
}

/**
 * The table walk itself: the FIRST row whose signature matches, or null.
 *
 * `dbeq d2,.1` again, and here it is doing what it looks like — the loop ends
 * on a match or after ten rows.
 */
function ppkIdentify(data: Uint8Array): PpkFormat | null {
  for (const f of PPK_FORMATS) if (bankLong(data, f.codePos) === f.code) return f
  return null
}

/** the payload of a bank argument, for the seven keywords that only read it */
function ppkBank(rt: Runtime, n: number): Uint8Array | null {
  const ref = orAdr(rt, n)
  if (!ref) return null
  return rt.memBanks.get(ref.number)?.data ?? null
}

/**
 * `Ppk Pack`'s efficiency argument, 0 to 4, as the four shift widths this
 * port's cruncher takes.
 *
 * The library hands powerpacker.library the mode number and gets its own
 * table's longword back to store in the header; ../amiga/powerpacker.ts takes
 * the four widths directly, so the longword is unpacked into them here.
 */
function effTable(mode: number): readonly number[] {
  const packed = PPK_EFFICIENCY[Math.max(0, Math.min(4, mode))]!
  return [(packed >>> 24) & 0xff, (packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff]
}

/**
 * A bank replaced in place by what a packer produced.
 *
 * The library reserves a NEW bank at the first free number and then
 * `L_Bnk.HeadClone`s the source's number onto it, so the packed data ends up
 * under the original's number and the original is unreachable. A bank's
 * address here is a function of its number, so the round trip is invisible
 * and this is what is left of it -- the same reasoning as `Bank To Chip`.
 */
function replaceBank(rt: Runtime, n: number, bytes: Uint8Array): void {
  const ref = orAdr(rt, n)
  if (!ref) return
  const was = rt.memBanks.get(ref.number)
  if (!was) return
  rt.memBanks.set(ref.number, { ...was, data: Uint8Array.from(bytes) })
}

/**
 * The password length check five routines repeat: `move.w (a0)+,d0 / subq.w
 * #1,d0 / cmpi.w #128,d0 / Rbcc L_IFunc`.
 *
 * Unsigned again, so an EMPTY password is error 23 as much as a 129-character
 * one — you cannot ask for "no password" by passing "".
 */
function checkPassword(pw: string): string {
  if (pw.length < 1 || pw.length > 128) funcCall()
  return pw
}

/** whatever xpkmaster threw, as the error number `=Xpk Errn` reports */
function xpkErrOf(e: unknown): number {
  const m = /(-?\d+)/.exec(e instanceof Error ? e.message : '')
  return m ? Number(m[1]) : XPKERR_NOFUNC
}

/** the shared body of Xpk Pack and Xpk Crypt — routines 136 and 137 */
function xpkWork(rt: Runtime, it: Parameters<Instr>[0], crypt: boolean): void {
  const bk = it.evalInt()
  it.expect(',')
  const method = it.evalStr()
  it.expect(',')
  if (crypt) checkPassword(it.evalStr())
  else it.evalInt()
  const data = ppkBank(rt, bk)
  if (!data) return
  // one packer is registered here, XPK_NONE -- anything else is the same
  // XPKERR_NOFUNC a machine without that sub-library installed would give
  if (!XPK_PACKERS.has(xpkParseMethod(method).name)) {
    rt.explode.xpkErr = XPKERR_NOFUNC
    return
  }
  rt.explode.xpkErr = 0
}

/** the shared lookup of Image Width and Image Height — bank, then index */
function imageOf(rt: Runtime, a: Value[]): BankImageLike | null {
  const ref = orAdr(rt, int(a[0]!))
  if (!ref) return null
  const ob = objectBank(rt, ref)
  const n = int(a[1]!)
  if (!ob || n > ob.images.length || n < 1) return null
  return ob.images[n - 1]!
}

/** just the two header words the pair reads */
interface BankImageLike {
  readonly width: number
  readonly height: number
}

/** the shared body of Bank As Work and Bank As Data — routines 24 and 25 */
function setDataBit(rt: Runtime, which: number, data: boolean): void {
  const ref = orAdr(rt, which)
  if (!ref) return
  const bank = rt.memBanks.get(ref.number)
  // an object bank is not refused, but its Data bit lives in banks.ts's
  // fixed BOB_BANK_FLAGS and there is no stored word here to move
  if (!bank) return
  bank.flags = data ? bank.flags | BNK.DATA : bank.flags & ~BNK.DATA
  // `cmpi.l #"Data",my_BkName(a0)` then `move.l #"Work",my_BkName(a0)`: a
  // LONGWORD against an EIGHT-byte field, so it is the first four characters
  // that are compared and the first four that are overwritten. A bank named
  // "Datas   " matches and comes out "Works   ", trailing s and all
  const want = data ? 'Work' : 'Data'
  if (bank.name.slice(0, 4) === want) bank.name = (data ? 'Data' : 'Work') + bank.name.slice(4)
}

export function makeExplodeFunctions(rt: Runtime): Record<string, Func> {
  /**
   * Routine 163 ($3841 in the source, `L_PrtSeq`), which all six of the
   * Pxxx$ keywords tail into: three bytes, ESC then the routine's own letter
   * then `arg + "0"`.
   *
   * The addition is a BYTE add, so an argument of 10 gives ":" rather than
   * being rejected, and one of 208 wraps back round to "0". The console then
   * reads whatever character arrived; nothing here range-checks.
   */
  const seq = (letter: string): Func =>
    (_, a): Value => VS(`\x1b${letter}${String.fromCharCode((int(a[0]!) + 0x30) & 0xff)}`)

  /** the shared body of Lsl.b/.w/.l and Lsr.b/.w/.l — routines 65 to 70 */
  const shift = (bits: number, left: boolean): Func =>
    (_, a): Value => VI(shifted(int(a[1]!), int(a[0]!), bits, left))

  return {
    /**
     * =Byte($) — routine 59 ($163a). `move.b 2(a0),d3` over a zeroed d3, so
     * the FIRST character of the string as an unsigned 0..255.
     *
     * NOTE: the author's inline comment on this routine reads `;Byte$` and
     * the one below it `;Byte`, which is the pair the wrong way round —
     * routine 59 is what the token table binds to `byte` and it consumes a
     * string. The specs settle it: `byte` is `02` and `byte$` is `20`.
     */
    byte: (_, a): Value => VI(chars(str(a[0]!), 1)[0]!),

    /** =Byte$(#) — routine 60 ($1646): one character out of the low byte */
    'byte$': (_, a): Value => VS(String.fromCharCode(int(a[0]!) & 0xff)),

    /** =Word($) — routine 61 ($1654): two characters, big-endian, UNSIGNED */
    word: (_, a): Value => {
      const c = chars(str(a[0]!), 2)
      return VI((c[0]! << 8) | c[1]!)
    },

    /** =Word$(#) — routine 62 ($1660): two characters, big-endian */
    'word$': (_, a): Value => {
      const v = int(a[0]!)
      return VS(String.fromCharCode((v >> 8) & 0xff, v & 0xff))
    },

    /**
     * =Long($) — routine 63 ($166e): four characters, big-endian, and SIGNED.
     *
     * The one asymmetry in the group: Byte and Word zero d3 first and Long
     * does not, so `move.l 2(a0),d3` fills the register and a leading
     * character above $7f gives a negative answer.
     */
    long: (_, a): Value => {
      const c = chars(str(a[0]!), 4)
      return VI(((c[0]! << 24) | (c[1]! << 16) | (c[2]! << 8) | c[3]!) | 0)
    },

    /** =Long$(#) — routine 64 ($1678): four characters, big-endian */
    'long$': (_, a): Value => {
      const v = int(a[0]!)
      return VS(String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
    },

    /** =Lsl.b(#,var) — routine 65 ($1684), and the five below it to $16b6 */
    'lsl.b': shift(8, true),
    'lsl.w': shift(16, true),
    'lsl.l': shift(32, true),
    'lsr.b': shift(8, false),
    'lsr.w': shift(16, false),
    'lsr.l': shift(32, false),

    /**
     * =Ipk Length(bk) — routine 78 ($18f6), and the whole of the Imploder
     * support: `cmpi.l #"IMP!",(a0)` and the longword at 4.
     *
     * No unpacker to go with it. The Imploder's own decruncher lived in the
     * file it made, so a program that wants the data runs it; this answers
     * how big it will be.
     */
    'ipk length': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      return VI(d && bankLong(d, 0) === 0x494d5021 ? bankLong(d, 4) | 0 : 0)
    },

    /**
     * =Bpk Length(bk) — routine 75 ($17f4), which is `L_GetBpkLen` and
     * nothing else.
     *
     * A sniff rather than a magic number, and it has a real hole in it — see
     * `bpkLength` in ../amiga/bytekiller.ts, which reproduces the `tst.b
     * 5(a0)` that rejects anything decrunching to 64KB or more.
     */
    'bpk length': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      return VI(d ? bpkLength(d) : 0)
    },

    /**
     * =Lpk Length(bk) — routine 139 ($27c2): the decoded length out of an
     * lh.library bank, or 0.
     *
     * `cmpi.l #"LH18",(a0)` and the longword at 4 — the two-longword header
     * `Lpk Pack` writes in front of what lh.library's `LhEncode` produced.
     * The magic is the library's own version marker rather than anything
     * standard, so a bank packed by any other LZH tool will not be
     * recognised.
     */
    'lpk length': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      return VI(d && bankLong(d, 0) === 0x4c483138 ? bankLong(d, 4) | 0 : 0)
    },

    /**
     * =Ppk Length(bk) — routine 83 ($196c), through `L_GetPpkLen` (routine
     * 161, $303e): the UNPACKED length of a PowerPacked bank, 0 if it is not
     * one.
     *
     * The length is in the last three bytes, and which last three depends on
     * the format. `adda.l my_BkLength(a0),a0` walks to sixteen bytes PAST the
     * payload (BkLength counts the header), then `move.b (a0),d0 / cmpi.b
     * #"P",d0` picks `-20(a0)` for a bank whose first byte is "P" and
     * `-24(a0)` otherwise — the payload's last longword, or the one before
     * it. `lsr.l #8,d0` then drops the low byte, which is the number of
     * padding bits the cruncher added and not part of the length.
     */
    'ppk length': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      if (!d || !ppkIdentify(d)) return VI(0)
      const at = d.length - (d[0] === 0x50 ? 4 : 8)
      return VI(at >= 0 ? bankLong(d, at) >>> 8 : 0)
    },

    /**
     * =Ppk Mode(bk) — routine 84 ($197e): which of the five efficiencies the
     * bank was crunched with, 0 Fast to 4 Best, or -1 if it is not
     * PowerPacked at all.
     *
     * Two walks: the format table for the row, then that row's `effPos` read
     * out of the bank and matched against the five constants. A bank whose
     * efficiency longword is none of the five falls out of the second `dbeq`
     * with d3 at 5 — one past Best, and not a value the manual mentions.
     */
    'ppk mode': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      const f = d ? ppkIdentify(d) : null
      if (!d || !f) return VI(-1)
      const eff = bankLong(d, f.effPos)
      const at = PPK_EFFICIENCY.indexOf(eff)
      return VI(at < 0 ? 5 : at)
    },

    /**
     * =Ppk Type(bk) — routine 85 ($19c8): the table's own type number, 1 to
     * 8, or 0 for a bank that matches no row.
     *
     * 1 PP20, 2 PPLS, 3 PPBK, 4 PPLB, 5 PPEX, 6 PX20, 7 PXLB, 8 PXEX — the
     * PX ones being the encrypted half of the same family, which is why
     * `Ppk Passkey` only answers for those three.
     */
    'ppk type': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      return VI((d && ppkIdentify(d)?.type) || 0)
    },

    /**
     * =Ppk Name$(bk) — routine 86 ($19f6): the row's four-character name, or
     * the empty string.
     *
     * Note it is the TABLE's name and not the bank's first four bytes: a
     * PPLB bank's signature sits at $80 and its name is still "PPLB".
     */
    'ppk name$': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      return VS((d && ppkIdentify(d)?.name) || '')
    },

    /**
     * =Ppk Passkey(bk) — routine 87 ($1a2e): the WORD checksum an encrypted
     * bank stores for its password.
     *
     * 0 for a bank that is not encrypted, which is every row whose
     * `cryptPos` is zero — `move.l my_PpkCryptPos(a1),d0 / beq.s .Skip`. So
     * only PX20, PXLB and PXEX can answer.
     */
    'ppk passkey': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      const f = d ? ppkIdentify(d) : null
      if (!d || !f || f.cryptPos === 0) return VI(0)
      return VI(((d[f.cryptPos] ?? 0) << 8) | (d[f.cryptPos + 1] ?? 0))
    },

    /**
     * =Ppk Password(bk,pw$) — routine 88 ($1a64), through `L_PxPassKey`
     * (routine 180, $389c): -1 if the password is the bank's, 0 if not.
     *
     * `ppCalcChecksum` on the string and a WORD compare against what the
     * bank stores, so it is a sixteen-bit check — a wrong password has one
     * chance in 65,536 of being accepted, and the routine is a check rather
     * than a decryption.
     *
     * DEVIATION: `ppCalcChecksum` is powerpacker.library's and this port has
     * no implementation of it — the algorithm is not in the Explode source,
     * only the call. A bank with no checksum answers 0, which is what the
     * routine does for an unencrypted bank; one WITH a checksum cannot be
     * answered without inventing the function, so it answers 0 as well.
     */
    'ppk password': (_, a): Value => {
      checkPassword(str(a[1]!))
      const d = ppkBank(rt, int(a[0]!))
      const f = d ? ppkIdentify(d) : null
      if (!d || !f || f.cryptPos === 0) return VI(0)
      return VI(0)
    },

    /**
     * =Xpk Length(bk) — routine 91 ($1ac0): the unpacked length out of an
     * XPKF header, at offset 12, or 0.
     *
     * =Xpk Name$(bk) — routine 92 ($1ada) — is the four characters at offset
     * 8, the SUB-LIBRARY that packed it ("NUKE", "SQSH", "RLEN"), or the
     * empty string.
     */
    'xpk length': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      return VI(d && bankLong(d, 0) === XPK_MAGIC ? bankLong(d, 12) | 0 : 0)
    },
    'xpk name$': (_, a): Value => {
      const d = ppkBank(rt, int(a[0]!))
      if (!d || bankLong(d, 0) !== XPK_MAGIC) return VS('')
      return VS(String.fromCharCode(d[8]!, d[9]!, d[10]!, d[11]!))
    },

    /**
     * =Xpk Errn and =Xpk Err$ — routines 95 and 96 ($1b38 and $1b44): the
     * number and the text of the last XPK call.
     *
     * The pair is why the Xpk half of this library is more usable than the
     * Ppk half: every Xpk call stores `d0` and the library's own message
     * buffer, so a failure can be reported rather than guessed at. Nothing
     * on the Ppk side does.
     *
     * NOTE: `Xpk Err$` builds its AMOS string IN PLACE, writing the measured
     * length into the word in front of the message buffer (`move.w
     * d0,(a0)`). So the answer aliases the buffer the next Xpk call will
     * overwrite.
     */
    'xpk errn': (): Value => VI(rt.explode.xpkErr),
    'xpk err$': (): Value => VS(rt.explode.xpkErr === 0 ? '' : xpkErrorText(rt.explode.xpkErr)),

    /**
     * =Rastport — routine 97 ($1b68): `T_RastPort(a5)`, the address of the
     * current screen's RastPort.
     *
     * One instruction, and it exists so a program can call graphics.library
     * itself. The manual's example does exactly that — `Areg(1)=Rastport`
     * then `Gfxcall(-240)`, which is `Move`, and `-246`, which is `Draw`.
     *
     * DEVIATION: there is no graphics.library here to hand it to, and no
     * RastPort struct in the address space. It answers the screen's control
     * block address, which is the nearest thing this port has that stands
     * for "the current screen's drawing state".
     */
    rastport: (): Value => VI((SCREEN_CTRL_BASE + rt.currentIndex * SCREEN_CTRL_SLOT) | 0),

    /**
     * =Plane Length — routine 102 ($1ca8): one plane's size in bytes,
     * `bm_BytesPerRow * bm_Rows`.
     *
     * The size `Plane Get`'s bank comes out, and the number to Reserve
     * before a `Plane Put`. Answers 0 with no screen open rather than
     * raising — the `tst.l ScOnAd(a5)` here is `beq.s .Skip`, not the
     * `Rbeq L_SNopen` the instructions use.
     */
    'plane length': (): Value => {
      const s = rt.screens.get(rt.currentIndex)
      return VI(s ? s.rowBytes * s.height : 0)
    },

    /**
     * =Plane Active(pln) — routine 111 ($1e92): -1 if the plane both EXISTS
     * and is open.
     *
     * Two tests, and the pair is the point: `tst.l bm_Planes(a1,d1.l)` for a
     * plane the screen has, then `btst d0,rp_Mask(a0)` for one `Plane Close`
     * has not shut. Either failing answers 0, so this cannot tell "no such
     * plane" from "closed".
     */
    'plane active': (_, a): Value => {
      const pln = int(a[0]!)
      if (pln < 0 || pln >= EC_MAX_PLANS) return VI(0)
      const s = rt.screens.get(rt.currentIndex)
      if (!s || pln >= s.depth) return VI(0)
      return VI((s.planeMask >> pln) & 1 ? -1 : 0)
    },

    /**
     * =Pause(ticks) — routine 6 ($dd8): wait up to `ticks` vertical blanks,
     * and stop early on a key or a mouse button.
     *
     * The answer says WHICH ended it, and the encoding is the group's own:
     * `cmpi.w #3,d3 / bgt.s .Skip / neg.l d3` — a value of 3 or below is a
     * MOUSE code and is negated, anything above is a key. So -1 is the left
     * button, -2 the right, -3 both, a positive number is the key, and 0 is
     * the timeout.
     *
     * `dbne d7,.1` counts the ticks down, so it waits `ticks + 1` blanks.
     */
    'pause'(it, a): Value {
      const wanted = int(a[0]!)
      const now = mouseOrKey(rt)
      if (now !== 0 || wanted <= 0) return VI(now)
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
      return VI(0)
    },

    /**
     * =Wait Loop — routine 8 ($e40): `Stop Loop` with an answer, and without
     * the joystick.
     *
     * Same encoding as `Pause` and the same `neg.l` — but the Inkey test is
     * `tst.w d1` where Stop Loop's is `tst.l`, so this one does not see an
     * Amiga key on its own. The author's comment: *"keine AMIGA-Keys"*.
     */
    'wait loop'(it): Value {
      const now = mouseOrKey(rt)
      if (now !== 0) return VI(now)
      it.block({ type: 'waitInput', mouse: true, key: true }, true)
      return VI(0)
    },

    /**
     * =File Path$(name$) — routine 10 ($e86): the name with AMOS's current
     * directory in front of it, which is what `L_Dsk.PathIt` leaves in
     * `Name1`.
     *
     * So it answers what the OTHER file keywords will actually open, and it
     * does it without touching the disc — the file need not exist.
     *
     * DEFECT: the copy back is one byte too long. `.3 move.l d0,d3 / Rbsr
     * L_GetSpace` reserves the counted length, then `.4 move.b (a0)+,(a1)+ /
     * dbra d0,.4` runs d0+1 times — the same off-by-one as `Rs Char`, and
     * here it copies the NUL terminator into the AMOS string. So the string
     * is one character longer than it looks and ends in a zero byte.
     */
    'file path$': (_, a): Value => VS(`${explodePath(rt, checkName(str(a[0]!)))}\0`),

    /**
     * =File Size(name$) and =File Blocks(name$) — routines 12 and 11 ($edc
     * and $ec8): `fib_Size` and `fib_NumBlocks`.
     *
     * BOTH ANSWER -1 rather than raising when the lock fails, which the
     * author flags in his own comment (*";-1 = Fehler"*) and is the only way
     * to tell a missing file from an empty one.
     */
    'file size': (_, a): Value => VI(fileInfo(rt, str(a[0]!)).size),
    'file blocks': (_, a): Value => VI(fileInfo(rt, str(a[0]!)).blocks),

    /**
     * =File Type(name$) — routine 13 ($ef0): three answers off
     * `fib_DirEntryType`.
     *
     * 0 not found, -1 a FILE, -2 a DEVICE (which is what AmigaDOS calls a
     * directory here: a positive DirEntryType). The sequence is `tst.l /
     * beq` for zero, then `blt` for negative, so the fall-through is the
     * positive case.
     */
    'file type': (_, a): Value => {
      const t = fileInfo(rt, str(a[0]!)).type
      return VI(t === 0 ? 0 : t < 0 ? -1 : -2)
    },

    /**
     * =File Protection(name$) — routine 143 ($2de0), the whole of
     * `ExtFileCmd`: `fib_Protection`.
     *
     * The high nibble is active HIGH (hidden, script, pure, archived) and the
     * low nibble active LOW, so 0 is a plain `----rwed` file. See FIBF_* in
     * ../amiga/dos.ts.
     */
    'file protection': (_, a): Value => VI(fileInfo(rt, str(a[0]!)).protection),

    /**
     * =Hof(channel) — routine 14 ($f12): the AmigaDOS FILE HANDLE behind one
     * of AMOS's own `Open` channels.
     *
     * Channel 1 to 9 (`cmpi.l #10 / Rbcc` then `subq.l #1 / Rbmi`), indexed
     * into AMOS's `Fichiers` table, and a channel that is not open is error
     * 97, *"File not opened"*.
     *
     * DEVIATION: the handles here are this port's own channel objects, not
     * AmigaDOS BPTRs, so the number identifies the channel and is not
     * something to hand to dos.library.
     */
    hof: (_, a): Value => {
      const n = int(a[0]!)
      if (n < 1 || n >= 10) funcCall()
      if (!rt.fileChans.has(n)) amosError(97, 'File not opened')
      return VI(0x0100_0000 + n)
    },

    /**
     * =Cd Path$ — routine 133 ($2552): the path `Cd Set` built.
     *
     * Empty until something sets it, and then it FILLS ITSELF IN from AMOS's
     * current directory — `tst.w (a0) / bne.s .4`, and the else branch runs
     * `L_Dsk.PathIt` on an empty name, which is what AMOS answers for "the
     * current directory". So the first read establishes it and every read
     * after that returns what `Cd Set` and `Cd Parent` have done to it.
     */
    'cd path$': (): Value => {
      if (rt.explode.cdPath === '') rt.explode.cdPath = rt.vfs?.currentDir ?? ''
      return VS(rt.explode.cdPath)
    },

    /**
     * =Hard Time$ and =Hard Date$ — routines 15 and 16 ($f3a and $f48),
     * both through `L_HardTimeDate` (routine 166, $3192).
     *
     * They read the BATTERY CLOCK DIRECTLY: `lea $DC0000,a0` for the time
     * and `$DC0018` for the date, six longwords each, one BCD nibble in the
     * low four bits of every one. The helper reads them backwards into a
     * scratch buffer and lays out "xx?xx?xx" with ":" or "-" between.
     *
     * Hard Date$ then SWAPS the first and last pairs after the fact, because
     * the clock stores year-month-day and the manual promises DD-MM-YY.
     *
     * DEVIATION: `$DC0000` is the A2000/A3000 battery clock and this port
     * has no chip there. Both answer from the host clock, which is what a
     * program asking the time wants; `Set Hard Time` cannot change it.
     */
    'hard time$': (): Value => {
      const c = nowCivil(rt)
      return VS(`${two(c.hour)}:${two(c.min)}:${two(c.sec)}`)
    },
    'hard date$': (): Value => {
      const c = nowCivil(rt)
      return VS(`${two(c.day)}-${two(c.month)}-${two(c.year % 100)}`)
    },

    /**
     * =Drive State(drv) — routine 120 ($227c): four answers about a floppy.
     *
     * `OpenDevice("trackdisk.device", unit)` and then two commands. 0 is no
     * such drive, -1 a drive with no disc, -2 a disc that is write
     * protected, -3 one that is not. It counts DOWN from -1 with `subq #1`
     * per test, so the answers are ordered by how much is true.
     *
     * It leaves the motor off (`TD_MOTOR` with a length of 0) before closing
     * the device, which is the tidy-up a program would otherwise hear.
     */
    'drive state': (_, a): Value => {
      const vol = rt.vfs?.volume(`DF${int(a[0]!) & 0xff}`)
      if (!vol) return VI(0)
      const info = rt.vfs?.volumeInfo(`DF${int(a[0]!) & 0xff}`)
      if (!info) return VI(-1)
      return VI(info.diskState === ID_WRITE_PROTECTED ? -2 : -3)
    },

    /**
     * =Dev State(name$) — routine 121 ($231e): the same four answers for a
     * named volume rather than a drive number, through `Lock` and `Info`.
     *
     * 0 nothing there, -1 write protected, -2 VALIDATING, -3 writable. Note
     * the order differs from `Drive State`: this one has no "drive with no
     * disc" to report, and uses the slot for `ID_VALIDATING` instead.
     */
    'dev state': (_, a): Value => {
      const name = checkName(str(a[0]!))
      const path = explodePath(rt, name)
      if (!rt.vfs?.exists(path) && !rt.vfs?.volume(name.replace(/:$/, ''))) return VI(0)
      const info = rt.vfs?.volumeInfo(name.replace(/:.*$/, ''))
      if (!info) return VI(-3)
      if (info.diskState === ID_WRITE_PROTECTED) return VI(-1)
      if (info.diskState === ID_VALIDATING) return VI(-2)
      return VI(-3)
    },

    /**
     * =Vectorptr — routine 123 ($23fa): the first non-zero of exec's six
     * reset-survival pointers.
     *
     * ColdCapture, CoolCapture, WarmCapture, KickMemPtr, KickTagPtr,
     * KickCheckSum, in that order. The manual calls it *"Test ob
     * Hintergrundtask aktiv"* — a test for whether anything has hooked
     * reboot, which in 1995 mostly meant a virus or a recoverable RAM disk.
     *
     * DEVIATION: nothing here hooks reboot, so it answers 0 — which is the
     * answer on a clean machine.
     */
    vectorptr: (): Value => VI(0),

    /**
     * =Avail Free — routine 127 ($24d4): `AvailMem(0)`, both memory types
     * together.
     *
     * The manual is careful that this is the TOTAL: *"der insgesamt frei
     * verwendbare Speicherbereich"*. AMOS's own `Free` answers its own
     * memory, not the machine's.
     */
    'avail free': (): Value => VI((rt.chipFree() + rt.fastFree()) | 0),

    /**
     * =Workbench — routine 129 ($2508): -1 if the Workbench screen is open.
     *
     * Straight off AMOS's own `WB_Closed` flag rather than asking Intuition,
     * so it reports what AMOS believes and pairs with `Open Workbench` above.
     */
    workbench: (): Value => VI(-1),

    /**
     * =Amos State — routine 130 ($2516): -1 started from the CLI, 0 from
     * Workbench.
     *
     * `FindTask(0)` then `tst.l $AC(a1)` — `pr_CLI`, which is zero for a
     * Workbench-launched process.
     *
     * DEVIATION: there is no Workbench to be launched from here. It answers
     * -1, the CLI case, which is what a program uses to decide whether it
     * may print to a console.
     */
    'amos state': (): Value => VI(-1),

    /**
     * =Explode$ — routine 1 ($d3a): the title string, 43 characters, sitting
     * in the code as a length word and the assembler's own EXPLODE and
     * VERSION macros.
     */
    'explode$': (): Value => VS(EXPLODE_TITLE),

    /** =Explode Base — routine 2 ($d72): the extension's own data zone address */
    'explode base': (): Value => VI(extDataBase(EXT_SLOT)),

    /**
     * =Extension$(n) and =Extension Base(n) — routines 3 and 4 ($d7c and
     * $dac): what is in AMOS's extension table.
     *
     * `Extension$` walks to `AdTokens(a5)` slot n, steps back 16 bytes to the
     * title string every extension's routine 0 leaves there, and copies it;
     * a slot with nothing in it answers the empty string. `Extension Base`
     * indexes `ExtAdr(a5)` — SIXTEEN bytes a slot, not four, because each
     * entry is the token table, the default handler, the end handler and a
     * spare.
     *
     * They number differently and neither is a mistake: `Extension$` takes
     * the slot as it stands, `Extension Base` does `subq.l #1,d0` first. So
     * `Extension$(7)` and `Extension Base(8)` are the same extension.
     */
    'extension$': (_, a): Value => {
      const n = int(a[0]!)
      const def = rt.extBindings?.get(n)
      return VS(def ? (def.titleStrings[0] ?? '') : '')
    },
    'extension base': (_, a): Value => {
      const n = int(a[0]!) - 1
      if (n < 0) return VI(0)
      return VI(rt.extBindings?.has(n) ? extDataBase(n) : 0)
    },

    /**
     * =Font Name$(fnt), =Font Height(fnt) and =Font Base(fnt) — routines 117,
     * 118 and 119 ($21d8, $2224 and $2254).
     *
     * All three read the `TextFont` the slot holds: `10(a0)` is `tf_Message.
     * mn_Node.ln_Name`, `20(a0)` is `tf_YSize`, and Font Base is the pointer
     * itself. A slot that is not open answers the empty string or 0 — but a
     * slot NUMBER out of 1..8 is error 23 in all three, so the quiet answer
     * means "not open" and nothing else.
     */
    'font name$': (_, a): Value => VS(rt.explode.fonts[fntSlot(int(a[0]!))]?.name ?? ''),
    'font height': (_, a): Value => VI(rt.explode.fonts[fntSlot(int(a[0]!))]?.height ?? 0),
    'font base': (_, a): Value => VI(rt.explode.fonts[fntSlot(int(a[0]!))]?.base ?? 0),

    /**
     * =Rs Start(n) — routine 42 ($130a): the structure's address, which is
     * what a program Pokes through and what `Format$` is handed.
     *
     * UNALLOCATED IS ERROR 23, not zero: `move.l my_RsStart(a0),d3 / Rbeq
     * L_IFunc`. Only `Rs Length` answers for a structure that is not there.
     */
    'rs start': (_, a): Value => {
      const st = rsSlot(rt, int(a[0]!), true)!
      if (st.start === 0) funcCall()
      return VI(st.start)
    },

    /** =Rs Finish(n) — routine 43 ($1332): start + length, and error 23 unallocated */
    'rs finish': (_, a): Value => {
      const st = rsSlot(rt, int(a[0]!), true)!
      if (st.start === 0) funcCall()
      return VI((st.start + st.length) | 0)
    },

    /**
     * =Rs Length(n) — routine 44 ($135e): the size asked for.
     *
     * The one keyword in the group that never raises. `moveq #0,d3` before
     * the range test and `bge.s .Skip` instead of `Rbge L_IFunc`, so a
     * number out of range and a structure that was never allocated both
     * answer 0 — which makes it the only safe way to ask whether a slot is
     * in use.
     */
    'rs length': (_, a): Value => VI(rsSlot(rt, int(a[0]!), false)?.length ?? 0),

    /**
     * =Rs(n) — routine 58 ($160e): POSITION minus START, the cursor as an
     * offset into the structure.
     *
     * So it is how far the Rs Byte/Word/Long/Char writes have got, and the
     * manual's example builds a structure and prints it to check. Error 23
     * on a cursor of zero, as the writers are.
     */
    rs: (_, a): Value => {
      const { st } = rsCursor(rt, int(a[0]!))
      return VI((st.position - st.start) | 0)
    },

    /**
     * =Bank Free(min) — routine 26 ($10ce), which is `L_Bnk.GetFree`
     * (routine 164, $3146) and nothing else.
     *
     * The first free number at or above `min`. A minimum of zero or below is
     * error 23 (`Rble L_IFunc` on the way in) and so is running out: the scan
     * checks `cmpi.l #$10000,d2 / Rbge L_IFunc` before each probe, so a
     * machine with every bank taken raises rather than answering 65536.
     *
     * It asks `L_Bnk.GetAdr`, which walks the ONE list, so the Bob and Icon
     * banks count as taken.
     */
    'bank free': (_, a): Value => {
      const min = int(a[0]!)
      if (min <= 0) funcCall()
      for (let n = min; n < 0x10000; n++) if (!rt.bankRef(n)) return VI(n)
      return funcCall()
    },

    /**
     * =Number(addr) — routine 28 ($1136): the bank's own number field.
     *
     * The inverse of `Start()`, and the manual says why it is here: *"da es nicht
     * möglich ist z.B. eine Bank zu löschen, deren Adresse zwar bekannt ist
     * aber nicht deren interne Nummer"* — you cannot Erase a bank
     * you only have the address of. `Erase Number(N)` can.
     *
     * It goes through Bnk.OrAdr like everything else, so `Number(8)` is 8.
     */
    number: (_, a): Value => VI(orAdr(rt, int(a[0]!))?.number ?? 0),

    /**
     * =Finish(bk) — routine 29 ($1146): `a0 + BkLength - my_BkHeader`, one
     * past the last payload byte.
     *
     * *"Dieser Befehl hat die gleiche Bedeutung wie der Aufruf
     * Start()+Length()"*, and the manual's example is the reason to want it:
     * `Bsave "neuedatei",Start(10) To Finish(10)`.
     *
     * NOTE: that equivalence does NOT hold for a Bob or Icon bank, and the
     * routine does not exclude one. `=Length()` on an object bank answers the
     * IMAGE COUNT (FnLength +Lib.s:2491), so `Start(1)+Length(1)` is the bank
     * start plus three, while `Finish(1)` is the real end. The author is
     * describing the Data bank case.
     */
    finish: (_, a): Value => {
      const ref = orAdr(rt, int(a[0]!))
      return VI(ref ? (ref.address + payloadLength(rt, ref)) | 0 : 0)
    },

    /**
     * =Image Width(bk,img) and =Image Height(bk,img) — routines 31 and 32
     * ($11ac and $11de).
     *
     * The image's own header: word 0 is the width and word 1 the height. The
     * width is read `move.w (a0),d3 / lsl.l #4,d3` — THE STORED WORD IS IN
     * SIXTEEN-PIXEL UNITS, so the answer is always a multiple of 16 and the
     * height is not. The author says so himself: *"Die Breite eines Images
     * deckt sich nicht immer mit den Definitionen bei Get Bob oder Get Icon,
     * da diese Werte zuvor immer als ein vielfaches von 16
     * übertragen werden"*.
     *
     * Which way the sixteenths round was checked against real banks rather
     * than assumed — `bankRowBytesFor` truncates where a screen's
     * `rowBytesFor` rounds up. It does not arise: the `.abk` format stores
     * whole words and the loader multiplies by 16, so every image in
     * `bobs.abk` (2 words) and `icons.abk` (2 and 4) has a width that is
     * already a multiple of 16. `>> 4 << 4` is the round trip through the
     * stored word, and it changes nothing for a loaded bank.
     *
     * Both answer 0 rather than raising: a bank that is neither Bob nor Icon,
     * an index above the count and an index below 1 all fall to the same
     * `moveq #0,d2` with d3 still zero.
     */
    'image width': (_, a): Value => VI(((imageOf(rt, a)?.width ?? 0) >> 4) << 4),
    'image height': (_, a): Value => VI(imageOf(rt, a)?.height ?? 0),

    /** =Even(#) — routine 71 ($16c0): `btst #0`, -1 when the bit is CLEAR */
    even: (_, a): Value => VI((int(a[0]!) & 1) === 0 ? -1 : 0),
    /** =Odd(#) — routine 72 ($16d0): the same test the other way up */
    odd: (_, a): Value => VI((int(a[0]!) & 1) !== 0 ? -1 : 0),

    /**
     * =Align(var,#) — routine 73 ($16e0): round UP to a multiple.
     *
     * `divs d0,d1 / swap d1 / andi.l #$FFFF,d1` takes the remainder, and a
     * non-zero one is added away: `var + align - (var mod align)`. An
     * alignment of zero is AMOS error 23, `tst.l d0 / Rbeq L_IFunc`.
     *
     * NOTE: `divs` is a 32-by-16 SIGNED divide, so the alignment is used as a
     * word and a quotient that will not fit in sixteen bits overflows. On the
     * 68k an overflowing DIVS leaves its registers alone and sets V, which
     * this routine never tests, so the answer would be the unaligned value
     * with a stale remainder folded in. Not reproduced: it needs |var/align|
     * at or above 32768 and there is nothing to be faithful to.
     */
    align: (_, a): Value => {
      const v = int(a[0]!)
      const n = int(a[1]!)
      if (n === 0) funcCall()
      const rem = (v % n) & 0xffff
      return VI(rem === 0 ? v : (v + n - rem) | 0)
    },

    /*
     * The print sequences — routines 33 to 38 ($1210 to $1238), one letter
     * each into the shared builder.
     *
     * These build STRINGS for AMOS's own Print and change nothing themselves,
     * which is what makes them worth having: `Inverse On` is an instruction
     * and cannot happen in the middle of a Print, where `Pinv$(1)` can. The
     * manual's example is exactly that shape:
     *
     *     Print "Ein ";Pinv$(1);" negativ ";Pinv$(0);" Beispiel"
     *
     * THREE OF THE SIX ESCAPES DID NOT EXIST IN THIS PORT until they were
     * written for this batch. The console handled ESC P, B, C, D, W and six
     * more, and ignored I, S and U — so a program of the shape above printed
     * the escape bytes as characters. Added to ../runtime/screen.ts against
     * the same three window fields `Inverse On`, `Shade On` and `Under On`
     * set. That is a gap in the CORE, found by porting an extension.
     */
    'pinv$': seq('I'),
    'psad$': seq('S'),
    'pund$': seq('U'),
    'pcpn$': seq('D'),
    'pjam$': seq('W'),
    'pcsr$': seq('C'),

    /** =Pdef$ — routine 39 ($1240): the eight-sequence constant above */
    'pdef$': (): Value => VS(PDEF),

    /**
     * =Format$("fmt",buffer) — routine 40 ($1264).
     *
     * `Rjsr L_Bnk.OrAdr` on the second argument, so it is a bank number or an
     * address, and then the whole job goes to exec: `EXE RawDoFmt` with the
     * format string, the buffer as the argument stream and a two-instruction
     * callback that appends a byte. The result is measured, a string is
     * reserved and it is copied in.
     *
     * So the formatter is exec's, not the author's, and the widths are
     * exec's too -- `%d` eats a WORD. See `rawDoFmt`.
     */
    'format$': (_, a): Value => {
      const fmt = str(a[0]!)
      const where = int(a[1]!)
      // bankOrAddr raises 'bank not reserved' for a bank that is not there,
      // which is what L_Bnk.OrAdr does
      const m = rt.bankOrAddr(where)
      if (!m) return VS('')
      // the arguments are walked by ADDRESS rather than through `m`, because
      // %s follows a pointer that may land in another region entirely
      return VS(rawDoFmt(rt, fmt, where >= 0 && where < 0x10000 ? rt.bankBase(where) : where))
    },
  }
}
