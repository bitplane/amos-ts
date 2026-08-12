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
