/**
 * AMOSPro Tools 1.01 — Tor Erik Ottinsen, thirty-three keywords at slot 23.
 *
 * *"The AMOSPro Tools extension was originally developed for personal use
 * only. As time passed it grew as I needed more commands."* It shows: a
 * byte-array-in-a-bank, a cursor you point at memory and then read and write
 * through, a two-line `Range`, an `Encode`/`Decode` pair, a checksum — and
 * eleven `Oui` keywords the guide declines to describe at all.
 *
 * ## Evidence
 *
 * BINARY tier with a good AmigaGuide. `AMOSPro_Tools.Lib` is a 2,164-byte code
 * hunk with 50 jump-table entries, 33 of which are keywords; `extdis
 * tools-1.01` disassembles it. `AMOSPro_Tools.Guide` documents twenty-two of
 * the thirty-three, gives the argument order for every one of them, and is
 * explicit about the rest:
 *
 *     The Tools Extension has got a number of interface commands used by my so
 *     far unreleased GUI System. These are internal commands of no use for
 *     anybody except me. I therefore choose to leave them undocumented.
 *
 * So the eleven `Oui` keywords are read off the binary alone, and what they
 * mean is what their instructions do. They are not stubs — every one has a
 * body — and the shape they make is consistent enough to describe, which is
 * done at `oui init` below.
 *
 * The slot is the guide's: *"Enter 'AMOSPro_Tools.Lib' into slot 23"*, and
 * routine 0 agrees — `move.l a3,$258(a5)` is `($258-$f8)/16+1 = 23`.
 *
 * ## The data zone
 *
 * Thirty-six bytes inside the code hunk, and routine 0 does nothing but
 * publish its address. Every field is therefore the assembled bytes:
 *
 *     +$00  0000 0000    Pos, the current memory position
 *     +$04  "Array   "   the bank name Array Dim reserves under
 *     +$0c  0000 0017    ArrayBank, 23 — the guide's "default is bank number 23"
 *     +$10  0000 0000    the array's X dimension, recorded and never read
 *     +$14  0000 0000    its Y dimension, likewise
 *     +$18  0000 0018    OuiBank, 24
 *     +$1c  "Oui Data"   the bank name Oui Init reserves under
 *
 * The two dimension fields at +$10 and +$14 are genuinely dead: `Array Dim`
 * writes both and no other routine reads either, because the stride `Array
 * Set` and `Array Get` need is kept in the ARRAY BANK's first longword
 * instead. They are described here and not modelled, since nothing can see
 * them.
 *
 * ## What the guide does not mention
 *
 * - **`Array Dim SX,SY` uses SX as the row stride and multiplies it by X.**
 *   The element at (X,Y) is at `X*(SX+1) + Y`, so the array you get is
 *   indexed `[0..SY][0..SX]` — the dimensions are the other way round from
 *   the guide's own `Dim _ARRAY(SX,SY)`, and from AMOS's. See `array set`.
 * - **Nothing bounds-checks anything.** The index is a WORD displacement, so
 *   it wraps at 32768 into negative and writes before the bank.
 * - **`Set Crypt` is a NOT.** `eori.b #$ff` per character, and the length word
 *   goes out in clear. The guide says as much in spirit — *"The algorithm used
 *   for encryption isn't very secure"* — but not that it is one instruction.
 * - **`Encode` and `Decode` are a different cipher entirely**, and a real one:
 *   a password byte, a 15-bit LCG and a running sum. See `encode`.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, VS, int } from '../interp/values'
import { MemPool } from '../amiga/exec'

/**
 * The extension's error table — one entry, raised by `Oui New` alone.
 *
 * Routine 48 ($806) is the standard message-printing half of the `L_ErrorExt`
 * pair every extension ships: `moveq #$0,d0 / moveq #$0,d1 / moveq #$16,d2 /
 * moveq #$0,d3` over a `lea` of the string. d2 is the extension number 23-1
 * and d0 is the index, which is 0 because there is only the one message.
 *
 * NOTE: this used to call `moveq #$0,d3` "the index", which it is not — d3
 * chooses whether the message is printed at all, and it is unfalsifiable from
 * Tools alone because a table of one makes index 0 and "print" indistinguishable.
 * The pair's other half is routine 49 ($83a), `d3 = -1` with no table, which is
 * what settles it. ../runtime/extimpl.ts's `errors` field carries the account.
 */
export const TOOLS_ERRORS = ['Maximum number of elements reached']

/** the bank names the data zone carries, both eight characters as AMOS wants */
const ARRAY_BANK_NAME = 'Array   '
const OUI_BANK_NAME = 'Oui Data'

/** the two defaults assembled into the data zone */
const DEFAULT_ARRAY_BANK = 23
const DEFAULT_OUI_BANK = 24

/**
 * Where the `Oui Reserve Text` buffers live, matching `Runtime.TOOLS_TEXT_BASE`
 * and `TOOLS_TEXT_RESERVED`. Spelled out rather than imported because
 * `./runtime` is a TYPE-only import here; `memmap.test.ts` holds the two to
 * agreeing. See `oui reserve text` for why there is a pool at all.
 */
const TEXT_BASE = 0x3c00_0000
const TEXT_RESERVED = 0x0400_0000

export interface ToolsState {
  /** Pos — where every Set and Get keyword reads and writes */
  pos: number
  /** ArrayBank, and Set Array Bank is the only thing that changes it */
  arrayBank: number
  /** OuiBank */
  ouiBank: number
  /** the strings `Oui Reserve Text` hands out addresses into */
  text: MemPool
}

export const newToolsState = (): ToolsState => ({
  pos: 0,
  arrayBank: DEFAULT_ARRAY_BANK,
  ouiBank: DEFAULT_OUI_BANK,
  text: new MemPool(TEXT_BASE, TEXT_RESERVED),
})

/* ---- reading and writing the modelled address space ------------------- */

const peek8 = (rt: Runtime, a: number): number => {
  const m = rt.resolveAddr(a >>> 0)
  return m ? (m.data[m.off] ?? 0) : 0
}

const poke8 = (rt: Runtime, a: number, v: number): void => {
  const m = rt.resolveWrite(a >>> 0)
  if (m) m.data[m.off] = v & 0xff
}

const peek16 = (rt: Runtime, a: number): number => (peek8(rt, a) << 8) | peek8(rt, a + 1)

const poke16 = (rt: Runtime, a: number, v: number): void => {
  poke8(rt, a, v >> 8)
  poke8(rt, a + 1, v)
}

const peek32 = (rt: Runtime, a: number): number =>
  ((peek16(rt, a) << 16) | peek16(rt, a + 2)) >>> 0

const poke32 = (rt: Runtime, a: number, v: number): void => {
  poke16(rt, a, v >>> 16)
  poke16(rt, a + 2, v & 0xffff)
}

/** an AMOS string's bytes — one per character, Latin-1, as the 68k sees it */
const bytesOf = (s: string): number[] => [...s].map((c) => c.charCodeAt(0) & 0xff)

/**
 * `(a0,d0.w)` — the index every bank routine here uses.
 *
 * A word displacement, sign-extended: an offset of 32768 or more addresses
 * BEFORE the bank rather than past it, and one above 65535 wraps. Nothing in
 * the extension checks a bound, so this is the only thing that decides where a
 * write lands.
 */
const disp = (v: number): number => ((v & 0xffff) << 16) >> 16

/** `L_Bnk_GetAdr` — the bank's address, or error 36 as every caller here does */
function bankAddr(rt: Runtime, n: number): number {
  if (!rt.memBanks.has(n)) throw new AmosError('Bank not reserved', 36)
  return rt.bankBase(n) >>> 0
}

export function makeToolsInstructions(rt: Runtime): Record<string, Instr> {
  /** the two-argument bank-offset write `Oui Set Data` and its siblings share */
  const ouiBase = (): number => bankAddr(rt, rt.tools.ouiBank)

  return {
    /**
     * Routine 3 — `Set Pos ADDRESS`. Two instructions, and the guide's warning
     * is the whole safety story: *"You should always set the current memory
     * position before using any of the other Set and Get commands. Not doing
     * this may crash the computer"*. It starts at zero.
     */
    'set pos'(it) {
      rt.tools.pos = it.evalInt() >>> 0
    },

    /** Routine 21 — `Add Pos INCREMENT`: `add.l d0,(a0)`, and a negative one steps back */
    'add pos'(it) {
      rt.tools.pos = (rt.tools.pos + it.evalInt()) >>> 0
    },

    /** Routine 5 — `Set Byte BYTE`, then Pos + 1 */
    'set byte'(it) {
      poke8(rt, rt.tools.pos, it.evalInt())
      rt.tools.pos = (rt.tools.pos + 1) >>> 0
    },

    /**
     * Routine 6 — `Set Word WORD`, big-endian, then Pos + 2.
     *
     * `move.b d0,$1(a1) / lsr.w #$8,d0 / move.b d0,(a1)` — the low byte first
     * and the high byte after it, which is the 68k's own order written out by
     * hand because the position is not guaranteed even.
     */
    'set word'(it) {
      poke16(rt, rt.tools.pos, it.evalInt() & 0xffff)
      rt.tools.pos = (rt.tools.pos + 2) >>> 0
    },

    /** Routine 7 — `Set Long LONGWORD`, the same four bytes by hand, then Pos + 4 */
    'set long'(it) {
      poke32(rt, rt.tools.pos, it.evalInt() >>> 0)
      rt.tools.pos = (rt.tools.pos + 4) >>> 0
    },

    /**
     * Routine 8 — `Set String STRING$`.
     *
     *     move.w (a2),d2 / addq.w #$1,d2 / move.b (a2)+,(a1)+ / dbra d2
     *
     * `a2` is the AMOS string, which begins with its LENGTH WORD, and the loop
     * runs `d2+1` times — so it copies the length word and then the
     * characters, `len + 2` bytes in all. That is the guide's *"incremented by
     * the length of the string + 2"*, and it is what makes `= Get String` able
     * to read the thing back without being told how long it is.
     */
    'set string'(it) {
      const s = bytesOf(it.evalStr())
      let at = rt.tools.pos
      poke16(rt, at, s.length)
      at += 2
      for (const b of s) poke8(rt, at++, b)
      rt.tools.pos = at >>> 0
    },

    /**
     * Routine 35 — `Set Crypt STRING$`.
     *
     * The same layout as `Set String`, with `eori.b #$ff` on each character
     * and the length word left in clear. So a scan of the memory still shows
     * exactly how long every string is and where the next one starts; only the
     * characters are complemented. The guide's *"please do not store any
     * sensitive data with this command"* is well judged.
     */
    'set crypt'(it) {
      const s = bytesOf(it.evalStr())
      let at = rt.tools.pos
      poke16(rt, at, s.length)
      at += 2
      for (const b of s) poke8(rt, at++, b ^ 0xff)
      rt.tools.pos = at >>> 0
    },

    /**
     * Routine 22 — `Set Array Bank BANK`, and the guide's own suggestion for
     * what it is for: *"By changing the array bank in the middle of the
     * program, you can in fact have two or more arrays."*
     */
    'set array bank'(it) {
      rt.tools.arrayBank = it.evalInt()
    },

    /**
     * Routine 16 — `Array Dim SX,SY`.
     *
     *     lea $14(a0),a0 / d2 = pop / addq.w #$1,d2 / move.l d2,(a0)
     *     lea $10(a0),a0 / d3 = pop / addq.w #$1,d3 / move.l d3,(a0)
     *     mulu.w d3,d2 / addq.w #$4,d2
     *     Bnk_Reserve(d0 = ArrayBank, d1 = 0, a0 = "Array   ", d2)
     *     move.l d3,(a0)
     *
     * `(SX+1)*(SY+1)` bytes plus four, and the four hold `SX+1` — the stride
     * every later access multiplies by. `d1 = 0` makes it a WORK bank rather
     * than a Data one, so `Erase Temp` takes the array with it.
     *
     * NOTE: the failure arm is `moveq #$18,d0` — AMOS error 24, "Out of
     * memory", not a complaint about the bank. `Bnk_Reserve` frees an existing
     * bank of that number and takes a new one, which is exactly what the guide
     * says: *"If the memory bank already exists, it will be erased before the
     * array bank is created!"*. This port's `Reserve` replaces too, and it has
     * no allocation that can fail, so the arm is unreachable here.
     *
     * NOTE: `addq.w #$1` and `mulu.w` are WORD operations on longword
     * arguments, so a dimension of 65535 becomes 0 and the reserve fails on
     * the length instead.
     */
    'array dim'(it) {
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      const stride = (sx + 1) & 0xffff
      const rows = (sy + 1) & 0xffff
      // `mulu.w` gives a longword and `addq.w #$4` adds to its LOW word only,
      // so the four bytes of header can wrap instead of carrying
      const product = stride * rows
      const bytes = (product & 0xffff_0000) | ((product + 4) & 0xffff)
      rt.reserveBank(rt.tools.arrayBank, bytes, ARRAY_BANK_NAME, false)
      poke32(rt, rt.bankBase(rt.tools.arrayBank) >>> 0, stride)
    },

    /**
     * Routine 17 — `Array Set X,Y,DATA`.
     *
     *     move.l (a0)+,d3 / mulu.w d3,d0 / add.w d1,d0 / move.b d2,(a0,d0.w)
     *
     * DEFECT: `d0` is X and `d3` is the stride the dimension stored, which is
     * `SX+1`. So the element at (X,Y) sits at `X*(SX+1) + Y`, and the array is
     * really indexed `[0..SY][0..SX]` — the dimensions are the other way round
     * from the guide's `Dim _ARRAY(SX,SY)` and from AMOS's own. It only stays
     * inside the allocation while `SX <= SY`: `Array Dim 100,10` followed by
     * `Array Set 100,10,n` writes ten kilobytes past a 1,122-byte bank.
     *
     * There is no bound check of any kind, and `add.w` then `(a0,d0.w)` means
     * the offset is taken modulo 65536 and SIGN-EXTENDED, so a big enough
     * index writes before the bank rather than after it.
     */
    'array set'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const data = it.evalInt()
      const base = bankAddr(rt, rt.tools.arrayBank)
      const stride = peek32(rt, base)
      poke8(rt, base + 4 + disp((x & 0xffff) * (stride & 0xffff) + y), data)
    },

    /**
     * Routine 25 — `Oui Set Bank BANK`, the `Oui` half's answer to `Set Array
     * Bank`. Undocumented; see `oui init` for what the bank holds.
     */
    'oui set bank'(it) {
      rt.tools.ouiBank = it.evalInt()
    },

    /**
     * Routine 40 — `Oui Init N`.
     *
     *     d2 = pop / d7 = d2 / addq.w #$1,d2 / lsl.l #$5,d2
     *     Bnk_Reserve(OuiBank, 0, "Oui Data", d2)
     *     move.b #$1,(a0)+ / move.b d7,(a0)
     *
     * This is the keyword that explains the whole undocumented half. `(N+1)`
     * records of THIRTY-TWO bytes, and the first two bytes of the bank — which
     * are also the first two bytes of record zero — are a COUNT set to 1 and a
     * MAXIMUM set to N. So record 0 is the header and records 1..N are the
     * elements, which is why `Oui New` starts at 1.
     *
     * A record, as the four accessors read it:
     *
     *     +$00..$1b   fourteen words, `Oui Edata`'s fields 0..13
     *     +$1a        the word `Oui New` sets to 1 after filling six of them
     *     +$1c        a pointer to an AMOS string, `Oui Reserve Text`'s
     *
     * The guide calls these *"internal commands of no use for anybody except
     * me"* and it is right that nothing else can use them; it is wrong that
     * they cannot be described.
     */
    'oui init'(it) {
      const n = it.evalInt()
      const records = ((n + 1) & 0xffff) * 32
      rt.reserveBank(rt.tools.ouiBank, records, OUI_BANK_NAME, false)
      const base = rt.bankBase(rt.tools.ouiBank) >>> 0
      poke8(rt, base, 1)
      poke8(rt, base + 1, n)
    },

    /**
     * Routine 39 — `Oui New A,B,C,D,E,F`.
     *
     *     d0 = (a0) / cmp.b $1(a0),d0 / bhi error
     *     lsl.w #$5,d0 / lea $c(a0,d0.w),a0
     *     moveq #$5,d0 / move.l (a3)+,d1 / move.w d1,-(a0) / dbra d0
     *     move.w #$1,$1a(a0)
     *
     * Six words written BACKWARDS from record+12, which lands them at record
     * offsets 0, 2, 4, 6, 8 and 10 — and because `(a3)+` pops right to left,
     * writing backwards puts the FIRST argument at offset 0. Then the word at
     * +$1a is set to 1, which reads as "this element is live".
     *
     * NOTE: it never increments the count. Successive `Oui New` calls all
     * write element 1 unless the program moves the counter on itself, which
     * it can: `Oui Set Data 0,n` writes exactly that byte. Given the rest of
     * the design that looks deliberate rather than missed — the count is a
     * cursor the caller drives, not a running total.
     *
     * The over-count arm raises the extension's only error, "Maximum number of
     * elements reached", and the compare is `bhi` on a BYTE, so it is the
     * count STRICTLY EXCEEDING the maximum that fails: element N itself is
     * allowed, and `Oui Init` reserved N+1 records for exactly that.
     */
    'oui new'(it) {
      const args: number[] = []
      for (let i = 0; i < 6; i++) {
        if (i > 0) it.expect(',')
        args.push(it.evalInt())
      }
      const base = ouiBase()
      const count = peek8(rt, base)
      if (count > peek8(rt, base + 1)) throw new AmosError(TOOLS_ERRORS[0]!)
      const rec = base + disp(count * 32)
      args.forEach((v, i) => poke16(rt, rec + i * 2, v & 0xffff))
      poke16(rt, rec + 0x1a, 1)
    },

    /**
     * Routine 28 — `Oui Set Data OFFSET,VALUE`: one byte anywhere in the Oui
     * bank, `move.b d1,(a0,d0.w)`. The counter at offset 0 is reachable this
     * way, which is what makes `Oui New`'s missing increment workable.
     */
    'oui set data'(it) {
      const off = it.evalInt()
      it.expect(',')
      const value = it.evalInt()
      poke8(rt, ouiBase() + disp(off), value)
    },

    /**
     * Routine 30 — `Oui Set Edata ELEMENT,FIELD,VALUE`.
     *
     * `lsl.w #$1,d0 / lsl.w #$5,d1 / add.l d1,d0` — field times two, element
     * times thirty-two, and a word written at the sum.
     */
    'oui set edata'(it) {
      const elem = it.evalInt()
      it.expect(',')
      const field = it.evalInt()
      it.expect(',')
      const value = it.evalInt()
      poke16(rt, ouiBase() + disp(elem * 32 + field * 2), value & 0xffff)
    },

    /**
     * Routine 31 — `Oui Reserve Text ELEMENT,LENGTH`.
     *
     *     lsl.w #$5,d0 / lea $1c(a0,d0.w),a1
     *     d3 = d4 / andi.w #$fffe,d3 / addq.w #$2,d3 / L_Demande
     *     move.l a0,(a1)
     *
     * An AMOS string of `(LENGTH & ~1) + 2` bytes, and its ADDRESS stored in
     * the element's +$1c.
     *
     * DEVIATION: `L_Demande` hands out AMOS's temporary string workspace, and
     * strings have no addresses in this port, so the buffer comes from a pool
     * of its own instead. That makes the pointer stable, which on the machine
     * it is not: the workspace is reclaimed by the next string expression the
     * program evaluates, so an element's text survives only until then. This
     * is the one place the port is KINDER than the library, and it is why
     * these keywords were for an unreleased system.
     *
     * NOTE: the reserved size is short. A string of length L needs `L+2` bytes
     * rounded up to even, and `(L & ~1) + 2` is two less than that whenever L
     * is odd. Nothing checks it — `Oui Set Text` writes what it is given.
     */
    'oui reserve text'(it) {
      const elem = it.evalInt()
      it.expect(',')
      const len = it.evalInt() & 0xffff
      const base = ouiBase()
      const block = rt.tools.text.alloc(Math.max(2, (len & ~1) + 2), { clear: true })
      poke32(rt, base + disp(elem * 32) + 0x1c, block)
    },

    /**
     * Routine 32 — `Oui Set Text ELEMENT,TEXT$`: the length word and then the
     * characters, written through the pointer `Oui Reserve Text` parked at the
     * element's +$1c. A pointer that was never reserved is zero, and the write
     * goes to address zero.
     */
    'oui set text'(it) {
      const elem = it.evalInt()
      it.expect(',')
      const s = bytesOf(it.evalStr())
      let at = peek32(rt, ouiBase() + disp(elem * 32) + 0x1c)
      poke16(rt, at, s.length)
      at += 2
      for (const b of s) poke8(rt, at++, b)
    },

    /**
     * Routine 42 — `Encode START,LENGTH,PASSWORD$`.
     *
     * The one piece of real cryptography here, and it is a stream cipher with
     * three parts added together per byte:
     *
     *     d6 = sum of the password's bytes, as a word
     *     d3 = the password's length - 1, taken as a WORD, so 65535 for len 1
     *     per byte:  d0 = plain + password[i mod len]
     *                d6 = (d6 * $24a1 + $24df) mod $8000     a 15-bit LCG
     *                d3 = d3 + d6
     *                cipher = d0 + d3
     *
     * `d3` is a running total that never resets, so the keystream depends on
     * the byte's POSITION as well as the password — the same plaintext byte
     * encodes differently at every offset. `Decode` (routine 44) is the same
     * loop with both additions turned into subtractions, and it is exact.
     *
     * NOTE: `d3` starts at 65535 rather than -1 because `subq.w #$1` on a
     * longword register that holds a small positive number leaves the high
     * word clear, and the `dbra` counts the low word down to $ffff. Only the
     * low byte of the sum ever reaches memory, so the constant is a constant
     * and the cipher is unaffected — but a reimplementation that used -1 would
     * produce different bytes.
     *
     * NOTE: an empty password makes `subq.w #$1,d3` give 65535 and the
     * checksum loop run 65,536 times over whatever follows the string, and the
     * wrap test `cmp.l a2,d4` never advances. Nothing sane can come of it and
     * nothing here reproduces it: an empty password is treated as no
     * substitution, which is what the loop would do if it terminated.
     */
    'encode'(it) {
      crypt(rt, it, +1)
    },

    /** Routine 44 — `Decode START,LENGTH,PASSWORD$`, the same loop subtracting */
    'decode'(it) {
      crypt(rt, it, -1)
    },
  }
}

/**
 * The body `Encode` and `Decode` share, which on the 68k is two copies of the
 * same seventy-eight bytes differing in `add.l`/`sub.l` at two instructions.
 */
function crypt(rt: Runtime, it: Parameters<Instr>[0], sign: 1 | -1): void {
  const start = it.evalInt() >>> 0
  it.expect(',')
  const length = it.evalInt()
  it.expect(',')
  const pass = bytesOf(it.evalStr())

  // `moveq #$0,d6 / move.b (a0)+,d0 / add.w d0,d6` over the password
  let lcg = pass.reduce((a, b) => (a + b) & 0xffff, 0)
  // `move.l d2,d3 / subq.w #$1,d3` and then a dbra to $ffff
  let run = 0xffff
  // `subq.w #$1,d5 / dbra d5` counts a WORD, so a length of 0 is 65,536 bytes
  const count = ((length - 1) & 0xffff) + 1
  for (let i = 0; i < count; i++) {
    const key = pass.length === 0 ? 0 : pass[i % pass.length]!
    lcg = (lcg * 0x24a1 + 0x24df) & 0x7fff
    run = (run + lcg) | 0
    const v = peek8(rt, start + i) + sign * key + sign * run
    poke8(rt, start + i, v & 0xff)
  }
}

export function makeToolsFunctions(rt: Runtime): Record<string, Func> {
  const ouiBase = (): number => bankAddr(rt, rt.tools.ouiBank)

  /** the length word plus that many characters, from an address */
  const readString = (at: number): string => {
    const len = peek16(rt, at)
    let s = ''
    for (let i = 0; i < len; i++) s += String.fromCharCode(peek8(rt, at + 2 + i))
    return s
  }

  return {
    /** Routine 4 — `=Get Pos`, the longword at the top of the data zone */
    'get pos': () => VI(rt.tools.pos | 0),

    /**
     * Routine 9 — `=Get Byte`, then Pos + 1. `moveq #$0,d3` first, so it is
     * UNSIGNED: 0..255, and a byte meant as signed needs the caller's own
     * sign extension.
     */
    'get byte': () => {
      const v = peek8(rt, rt.tools.pos)
      rt.tools.pos = (rt.tools.pos + 1) >>> 0
      return VI(v)
    },

    /** Routine 10 — `=Get Word`, big-endian and unsigned, then Pos + 2 */
    'get word': () => {
      const v = peek16(rt, rt.tools.pos)
      rt.tools.pos = (rt.tools.pos + 2) >>> 0
      return VI(v)
    },

    /**
     * Routine 12 — `=Get Long`, then Pos + 4.
     *
     * NOTE: unlike its two siblings this one has no `moveq #$0,d3` to clear
     * the register first, and it does not need one: four `move.b` and three
     * shifts fill all thirty-two bits, so whatever was in d3 is shifted out
     * before the result is complete. Worth saying because it looks like a bug
     * and is not.
     */
    'get long': () => {
      const v = peek32(rt, rt.tools.pos)
      rt.tools.pos = (rt.tools.pos + 4) >>> 0
      return VI(v | 0)
    },

    /**
     * Routine 14 — `=Get String`, then Pos + length + 2.
     *
     * The length word `Set String` wrote is the length it reads, so the pair
     * round-trips without the program tracking sizes — which is the guide's
     * argument for the whole group: *"a much better way of storing data than
     * using Print # and Input #"*.
     */
    'get string': () => {
      const s = readString(rt.tools.pos)
      rt.tools.pos = (rt.tools.pos + 2 + s.length) >>> 0
      return VS(s)
    },

    /** Routine 37 — `=Get Crypt`, `Set Crypt` backwards: `eori.b #$ff` per character */
    'get crypt': () => {
      const at = rt.tools.pos
      const len = peek16(rt, at)
      let s = ''
      for (let i = 0; i < len; i++) s += String.fromCharCode(peek8(rt, at + 2 + i) ^ 0xff)
      rt.tools.pos = (at + 2 + len) >>> 0
      return VS(s)
    },

    /** Routine 23 — `=Array Bank`, which starts at 23 and is the slot's own number */
    'array bank': () => VI(rt.tools.arrayBank),

    /**
     * Routine 18 — `=Array Get(X,Y)`, `Array Set`'s reader down to the
     * register: the same stride from the bank's first longword, the same
     * `X*(SX+1) + Y`, and the same absence of a bound. Unsigned, 0..255.
     */
    'array get': (_it, a) => {
      const base = bankAddr(rt, rt.tools.arrayBank)
      const stride = peek32(rt, base)
      const off = disp((int(a[0]!) & 0xffff) * (stride & 0xffff) + int(a[1]!))
      return VI(peek8(rt, base + 4 + off))
    },

    /**
     * Routine 20 — `=Range(A, MIN To MAX)`.
     *
     *     cmp.l d5,d3 / bgt -> d3 = d5      A above MAX
     *     cmp.l d4,d3 / blt -> d3 = d4      A below MIN
     *
     * Signed and in that order, so a MIN above its MAX answers MIN for
     * anything at or below MAX and MAX for anything above it — the clamp
     * inverts rather than refusing. The guide calls it *"a somewhat optimized
     * version of the Range command in the Shuffle Extension"*.
     */
    'range': (_it, a) => {
      const v = int(a[0]!)
      const lo = int(a[1]!)
      const hi = int(a[2]!)
      return VI(v > hi ? hi : v < lo ? lo : v)
    },

    /**
     * Routine 46 — `=Checksum(START To END)`.
     *
     *     cmp.l a2,d2 / bge / (swap them)
     *     d2 = END - START / d1 = d2 >> 2 / add.l (a2)+,d3 / dbra
     *     d2 = d2 & 3 / move.b (a2)+,d0 / add.l d0,d3 / dbra
     *
     * Longwords while there are four bytes left and then bytes, added into a
     * 32-bit total that wraps. The bounds are sorted first, so `Checksum(b To
     * a)` is `Checksum(a To b)` — the one defensive line in the extension.
     */
    'checksum': (_it, a) => {
      let from = int(a[0]!) >>> 0
      let to = int(a[1]!) >>> 0
      if ((to | 0) < (from | 0)) [from, to] = [to, from]
      let sum = 0
      let n = (to - from) >>> 0
      let at = from
      for (; n >= 4; n -= 4, at += 4) sum = (sum + peek32(rt, at)) | 0
      for (; n > 0; n--, at++) sum = (sum + peek8(rt, at)) | 0
      return VI(sum | 0)
    },

    /** Routine 26 — `=Oui Bank`, which starts at 24 */
    'oui bank': () => VI(rt.tools.ouiBank),

    /** Routine 27 — `=Oui Data(OFFSET)`: one unsigned byte anywhere in the Oui bank */
    'oui data': (_it, a) => VI(peek8(rt, ouiBase() + disp(int(a[0]!)))),

    /**
     * Routine 29 — `=Oui Edata(ELEMENT,FIELD)`: a WORD at `element*32 +
     * field*2`, unsigned, and the reader for what `Oui New` writes.
     */
    'oui edata': (_it, a) =>
      VI(peek16(rt, ouiBase() + disp(int(a[0]!) * 32 + int(a[1]!) * 2))),

    /**
     * Routine 33 — `=Oui Text(ELEMENT)`: the string at the pointer in the
     * element's +$1c. An element that was never given one reads a zero
     * pointer, and a zero-length string comes back.
     */
    'oui text': (_it, a) => VS(readString(peek32(rt, ouiBase() + disp(int(a[0]!) * 32) + 0x1c))),
  }
}
