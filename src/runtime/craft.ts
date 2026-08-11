/**
 * CRAFT 1.0 — Hannu Rummukainen's extension for Black Legend, at slot 18.
 *
 * 138 keywords over eight groups that have almost nothing to do with each
 * other: string handling, a LOGO turtle, an AmigaDOS directory scanner,
 * palettes kept in memory banks, Mandelbrot and Julia, Workbench and CLI
 * access, memory queries, and hardware pokes. This file holds the string and
 * memory groups; the rest arrive in later batches.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier over an unusually good pair of second sources, and both
 * of them had to be unpacked before they could be read — see
 * ../amiga/solaris.ts. `AMOSPro_CRAFT.Lib` is a 13,396-byte code hunk, jump
 * table at +18, 220 routines from $cd2, and `extdis craft-1.0` resolves any
 * keyword to its routine. Beside it now sit `CRAFT_Help.AMOS`, whose bank 1
 * is 42,874 bytes of per-keyword manual by Janne Kalliola, and forty example
 * programs the author wrote and commented himself.
 *
 * Having all three is what makes the disagreements below findings rather
 * than guesses: where the help and the binary differ, an example program
 * usually settles which one a caller believed.
 *
 * ## The library opens nothing
 *
 * There is not one library-name string in the whole hunk. Where a keyword
 * needs AmigaOS it reaches through a base AMOS already holds — the memory
 * group here is `jsr` on ExecBase, taken from absolute $4, with no
 * OpenLibrary anywhere. That is also why the extension cannot report a
 * library failure: there is nothing to fail.
 *
 * ## Strings are allocated by routine 30
 *
 * Every string result goes through it: `tst.l d0` and, for a zero length,
 * a0 = the shared empty string at $68a(a5) with Z set, otherwise an AMOS
 * string of `(d0 & ~1) + 2` bytes with the length word written and a0 left
 * on the first character. Nothing below has to model that — a JS string is
 * the same value — but it is why every one of these keywords answers the
 * empty string rather than an error when handed a zero length.
 *
 * ## Defects
 *
 * - **`Str Count`'s arguments are the other way round from its manual.** The
 *   help says `Str Count(search$, string$)`, "counts how many times does the
 *   search$ occur in the string$". Routine 16 pops the LAST argument into a2
 *   and the first into a0, and routine 17 reads a2's length word as the
 *   needle and scans a0 — so the FIRST argument is the haystack. The
 *   author's own `Dir_Read_Special.AMOS` writes `Str Count(A$,"*")` with A$
 *   the path being searched, which is the binary's order and not the help's.
 *   Reproduced as the binary has it.
 *
 * - **`Mem Str Count(bank, search$)` scans one byte past the bank.** Routine
 *   15 hands back the bank length in d7, and routine 17 wants a length MINUS
 *   ONE there — which is what routine 16 (`Str Count`) and routine 13 (the
 *   `start To end` form) both pass. The bank form does not subtract, so its
 *   `dbf` runs one extra iteration. `Mem Scramble` and `Mem Unscramble` use
 *   the same resolver and DO subtract (routines 38 and 40, `subq.l #1,d0`),
 *   which is what shows the omission to be an omission.
 *
 * - **`Str Peek$(addr,len,stop$)` returns one byte short when stop$ is
 *   absent.** Routine 28 scans for the stop character with `cmp.b (a1)+,d0 /
 *   dbeq`, then takes `a1 - addr` as the length and subtracts one to drop the
 *   stop character. When the character never appears the scan still walks
 *   `len` bytes, so the same subtraction eats a real one. The two-argument
 *   form goes nowhere near this and returns all `len`.
 *
 * - **`Up Case$` and `Lo Case$` fold the two Latin-1 maths signs into each
 *   other.** Both work by `bchg #5` over a range rather than a table, and
 *   0xd7 (×) and 0xf7 (÷) sit inside those ranges at exactly the offset that
 *   separates a Latin-1 capital from its lower case. So `Up Case$("÷")` is
 *   "×" and `Lo Case$("×")` is "÷". `Flip Case$` inherits it. The manual's
 *   claim that these "can convert all the special characters too" is true and
 *   this is the price of how.
 *
 * ## The cipher
 *
 * `Str Scramble$`/`Str Unscramble$` and `Mem Scramble`/`Mem Unscramble` share
 * one stream cipher: routine 23 builds the key state, 19 encrypts and 21
 * decrypts. It is a real cipher rather than an XOR — the keystream depends on
 * a running 32-bit register, the plaintext, the password position and the
 * bytes remaining — and its key schedule ends with a flourish worth naming:
 *
 *     andi.w  #30,d0
 *     add.l   (-44,pc,d0.w),d5
 *
 * which is a 16-entry longword table at $1078, the address of routine 23
 * ITSELF. The schedule mixes in a longword of its own instruction stream,
 * chosen by a byte derived from the password. `CRAFT_CIPHER_TABLE` below is
 * those bytes, and it is data only because the code happens to be sitting
 * there — which is why it is written out rather than computed.
 */
import { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'

/** AMOS error 23, "Illegal function call" — routine 206 */
const illegal = (): never => {
  throw new AmosError(ED_RUN_MESSAGES[23]!, 23)
}

/** AMOS error 25, "Address error" — routine 208, reached by an odd address */
const addressError = (): never => {
  throw new AmosError(ED_RUN_MESSAGES[25]!, 25)
}

/**
 * The 32 bytes at $1078 that routine 23's key schedule indexes as sixteen
 * overlapping longwords. They are routine 23's own first instructions:
 * `movea.l (a3)+,a2 / moveq #0,d7 / move.w (a2)+,d7 / Rbeq 206 / move.l
 * #$babeface,d5 / ...`.
 */
export const CRAFT_CIPHER_TABLE = Uint8Array.from([
  0x24, 0x5b, 0x7e, 0x00, 0x3e, 0x1a, 0xfe, 0x41, 0x00, 0xce, 0x2a, 0x3c, 0xba, 0xbe, 0xfa, 0xce,
  0x9a, 0x87, 0xef, 0xbd, 0x32, 0x07, 0xde, 0x8a, 0x2c, 0x0a, 0x70, 0x5d, 0xda, 0x1a, 0xbb, 0x00,
])

/** the seed routine 23 starts from, before the password is folded in */
export const CRAFT_CIPHER_SEED = 0xbabeface

/** `Str Peek$`'s silent clamp when the length has a non-zero high word */
export const CRAFT_PEEK_CLAMP = 65500

/** `Hex Dump$`'s default separation, pushed by routine 24 */
export const CRAFT_HEX_SEP = 4

const u32 = (n: number): number => n >>> 0
const rol32 = (v: number, n: number): number => (n &= 31) === 0 ? u32(v) : u32((v << n) | (v >>> (32 - n)))
const ror32 = (v: number, n: number): number => rol32(v, 32 - (n & 31))
const rolByte = (v: number, n: number): number => ((v << n) | (v >>> (8 - n))) & 0xff
const rorByte = (v: number, n: number): number => rolByte(v, 8 - n)

/** the cipher state routine 23 leaves behind */
interface Cipher {
  /** d5, a full 32-bit register that is rotated long and mixed byte-wise */
  d5: number
  /** the password bytes; a2 walks them and wraps at the end */
  key: Uint8Array
  at: number
}

/**
 * Routine 23. An empty password is `Rbeq routine 206`, error 23.
 *
 * `rol.l d7,d5` uses the 68000's register rotate, whose count is taken mod
 * 64 — but d7 here is a string length that has already been range-checked by
 * AMOS, so the fold below (mod 32) is the same for every reachable value.
 */
export function craftKey(password: string): Cipher {
  if (password.length === 0) illegal()
  const key = Uint8Array.from(password, (c) => c.charCodeAt(0) & 0xff)
  let d5 = u32(CRAFT_CIPHER_SEED - key.length)
  d5 = rol32(d5, key.length % 64)
  let d0 = 93
  for (const b of key) {
    d5 = u32((d5 & ~0xff) | ((d5 + b) & 0xff))
    d0 = (d0 ^ d5) & 0xff
    d5 = rol32(d5, 5)
  }
  d0 &= 30
  const t = CRAFT_CIPHER_TABLE
  const pick = ((t[d0]! << 24) | (t[d0 + 1]! << 16) | (t[d0 + 2]! << 8) | t[d0 + 3]!) >>> 0
  return { d5: u32(d5 + pick), key, at: 0 }
}

/** the next password byte, wrapping — `cmpa.l d7,a2 / bcs / movea.l d6,a2` */
const keyByte = (c: Cipher): number => {
  const b = c.key[c.at]!
  c.at += 1
  if (c.at >= c.key.length) c.at = 0
  return b
}

/**
 * Routine 19, one byte at a time, with `count` counting DOWN from n-1 the way
 * d0 does. Every arithmetic step below is a byte op on a register whose other
 * three bytes survive, except `ror.l #3,d5`, which is not.
 */
export function craftScramble(src: Uint8Array, c: Cipher): Uint8Array {
  const out = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const count = (src.length - 1 - i) & 0xff
    const d4 = c.d5 & 0xff
    let d1 = (d4 - src[i]!) & 0xff
    c.d5 = u32((c.d5 & ~0xff) | ((c.d5 ^ d1) & 0xff))
    c.d5 = ror32(c.d5, 3)
    const d2 = (keyByte(c) + d4) & 0xff
    d1 = (d1 ^ d2) & 0xff
    d1 = rolByte(d1, 3)
    d1 = (d1 + count) & 0xff
    c.d5 = u32((c.d5 & ~0xff) | ((c.d5 - d1) & 0xff))
    out[i] = d1
  }
  return out
}

/** Routine 21, the inverse. */
export function craftUnscramble(src: Uint8Array, c: Cipher): Uint8Array {
  const out = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const count = (src.length - 1 - i) & 0xff
    let d1 = src[i]!
    const d4 = d1
    d1 = (d1 - count) & 0xff
    d1 = rorByte(d1, 3)
    const d2raw = (keyByte(c) + (c.d5 & 0xff)) & 0xff
    d1 = (d1 ^ d2raw) & 0xff
    const d2 = d1
    d1 = (d1 - (c.d5 & 0xff)) & 0xff
    d1 = -d1 & 0xff
    out[i] = d1
    c.d5 = u32((c.d5 & ~0xff) | ((c.d5 ^ d2) & 0xff))
    c.d5 = ror32(c.d5, 3)
    c.d5 = u32((c.d5 & ~0xff) | ((c.d5 - d4) & 0xff))
  }
  return out
}

/**
 * Routines 3, 4 and 5. Each is a `bchg #5` over ranges rather than a table,
 * which is what gives them Latin-1 for free and × / ÷ along with it.
 */
const upByte = (b: number): number =>
  (b >= 0x61 && b <= 0x7a) || (b >= 0xe0 && b <= 0xfe) ? b ^ 0x20 : b
const loByte = (b: number): number =>
  (b >= 0x41 && b <= 0x5a) || (b >= 0xc0 && b <= 0xde) ? b ^ 0x20 : b
const flipByte = (b: number): number =>
  (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0xc0 && b !== 0xdf && b !== 0xff)
    ? b ^ 0x20
    : b

const mapBytes = (s: string, f: (b: number) => number): string =>
  Array.from(s, (ch) => String.fromCharCode(f(ch.charCodeAt(0) & 0xff))).join('')

/**
 * Routine 17, shared by `Str Count` and both `Mem Str Count` forms.
 *
 * `count` is the caller's d7 and is a length MINUS ONE — the scan runs
 * `count + 1` bytes. On a hit it steps past the whole occurrence, which is
 * the help's "it jumps to the next character after the occurrence ... doesn't
 * count any occurrences which start inside another occurrence".
 */
export function craftCount(hay: Uint8Array, from: number, count: number, needle: Uint8Array): number {
  if (count >= 0x10000) illegal()
  if (needle.length === 0) return 0
  let left = count - (needle.length - 1)
  if (left < 0) return 0
  let at = from
  let found = 0
  while (left >= 0) {
    if (hay[at] === needle[0]) {
      let k = 1
      while (k < needle.length && hay[at + k] === needle[k]) k++
      if (k === needle.length) {
        found++
        at += needle.length
        left -= needle.length
        continue
      }
    }
    at++
    left--
  }
  return found
}

export function makeCraftFunctions(rt: Runtime): Record<string, Func> {
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0))
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))

  /** the bytes at an address, as routine 15 and the dump pair see memory */
  const readBytes = (addr: number, len: number): Uint8Array => {
    const out = new Uint8Array(Math.max(0, len))
    for (let i = 0; i < out.length; i++) {
      const m = rt.resolveAddr(addr + i)
      out[i] = m ? (m.data[m.off] ?? 0) : 0
    }
    return out
  }

  /** trims characters of `set` off one end — routines 7 and 9 */
  const trim = (s: string, set: string, right: boolean): string => {
    if (set.length === 0) illegal()
    let a = 0
    let b = s.length
    while (a < b && set.includes(s[right ? b - 1 : a]!)) {
      if (right) b--
      else a++
    }
    return s.slice(a, b)
  }

  return {
    /** =Up Case$(a$) — routine 3 ($d6e) */
    'up case$': (_, a) => VS(mapBytes(s0(a, 0), upByte)),
    /** =Lo Case$(a$) — routine 4 ($da4) */
    'lo case$': (_, a) => VS(mapBytes(s0(a, 0), loByte)),
    /** =Flip Case$(a$) — routine 5 ($dda), which spares only 0xdf and 0xff */
    'flip case$': (_, a) => VS(mapBytes(s0(a, 0), flipByte)),

    /**
     * =Left Trim$(a$[,trim$]) — routine 7 ($e30). The one-argument form is
     * routine 6, four instructions that push the inline string at $e2c — a
     * length word of 1 and a space — and `Rbra` here.
     */
    'left trim$': (_, a) => VS(trim(s0(a, 0), a.length > 1 ? s0(a, 1) : ' ', false)),
    /** =Right Trim$(a$[,trim$]) — routine 9 ($e78), routine 8 for the default */
    'right trim$': (_, a) => VS(trim(s0(a, 0), a.length > 1 ? s0(a, 1) : ' ', true)),

    /**
     * =Bw Instr(s$,f$[,p]) — routine 11 ($ec0). Backwards Instr: the result
     * is 1-based, 0 for no match, and an occurrence may not extend past `p`.
     *
     * `p` defaults to the length of s$ (routine 10 pushes it), is clamped to
     * that length when larger, and a negative one is `Rbmi routine 206`.
     */
    'bw instr': (_, a) => {
      const s = s0(a, 0)
      const f = s0(a, 1)
      let p = a.length > 2 ? i0(a, 2) : s.length
      if (p < 0) illegal()
      if (s.length === 0 || f.length === 0) return VI(0)
      if (p > s.length) p = s.length
      for (let start = p - f.length; start >= 0; start--) {
        if (s.startsWith(f, start)) return VI(start + 1)
      }
      return VI(0)
    },

    /**
     * =Chr Conv$(a$,chr1 To chr2) — routine 12 ($f20). Both codes are checked
     * against 255 unsigned before anything else, so 256 is error 23 and -1 is
     * too.
     */
    'chr conv$': (_, a) => {
      const s = s0(a, 0)
      const from = i0(a, 1)
      const to = i0(a, 2)
      if (u32(from) > 0xff || u32(to) > 0xff) illegal()
      return VS(mapBytes(s, (b) => (b === (from & 0xff) ? to & 0xff : b)))
    },

    /**
     * =Str Count(a$,search$) — routines 16 ($f94) and 17.
     *
     * DEFECT: the arguments are the other way round from the manual. See the
     * file header; the author's own example agrees with the binary.
     */
    'str count': (_, a) => {
      const hay = s0(a, 0)
      const needle = s0(a, 1)
      if (hay.length === 0) return VI(0)
      return VI(craftCount(Uint8Array.from(hay, (c) => c.charCodeAt(0) & 0xff), 0, hay.length - 1,
        Uint8Array.from(needle, (c) => c.charCodeAt(0) & 0xff)))
    },

    /**
     * =Mem Str Count(start To end,search$) — routine 13 ($f5a) — and
     * =Mem Str Count(bank,search$) — routine 14 ($f6a).
     *
     * The range form passes `end - start`, which routine 17 treats as a
     * length minus one, so the range is inclusive. DEFECT: the bank form
     * passes routine 15's length UNSUBTRACTED and reads one byte too many.
     */
    'mem str count': (_, a) => {
      const needle = Uint8Array.from(s0(a, a.length - 1), (c) => c.charCodeAt(0) & 0xff)
      if (a.length > 2) {
        const start = i0(a, 0)
        const span = i0(a, 1) - start
        if (span < 0) illegal()
        return VI(craftCount(readBytes(start, span + needle.length + 1), 0, span, needle))
      }
      const bank = craftBank(rt, i0(a, 0))
      // the missing subq.l #1,d0 — one byte past the bank is read
      return VI(craftCount(readBytes(bank.addr, bank.len + needle.length + 1), 0, bank.len, needle))
    },

    /** =Str Scramble$(s$,p$) — routines 18, 22, 23 and 19 */
    'str scramble$': (_, a) => {
      const key = craftKey(s0(a, 1))
      const src = Uint8Array.from(s0(a, 0), (c) => c.charCodeAt(0) & 0xff)
      return VS(String.fromCharCode(...craftScramble(src, key)))
    },
    /** =Str Unscramble$(s$,p$) — routines 20, 22, 23 and 21 */
    'str unscramble$': (_, a) => {
      const key = craftKey(s0(a, 1))
      const src = Uint8Array.from(s0(a, 0), (c) => c.charCodeAt(0) & 0xff)
      return VS(String.fromCharCode(...craftUnscramble(src, key)))
    },

    /**
     * =Hex Dump$(add,len[,sep]) — routine 25 ($10b2), routine 24 for the
     * two-argument form, which pushes a `sep` of 4.
     *
     * Digits are uppercase (`add.b #7` above nine, then `#48`) and a space
     * goes in after every `sep` bytes but never after the last, so the result
     * is `2*len + (len-1)/sep` characters. A `sep` of zero, or one that is at
     * least `len`, takes the no-spaces path. The length is range-checked by
     * `tst.w (a3)` on the argument's HIGH word, so a `sep` of 65536 or more
     * is error 23 while 65535 is fine.
     */
    'hex dump$': (_, a) => {
      const addr = i0(a, 0)
      const len = i0(a, 1)
      const sep = a.length > 2 ? i0(a, 2) : CRAFT_HEX_SEP
      if ((sep >>> 16) !== 0) illegal()
      const bytes = readBytes(addr, len)
      let out = ''
      for (let i = 0; i < bytes.length; i++) {
        if (i > 0 && sep > 0 && len > sep && i % sep === 0) out += ' '
        out += bytes[i]!.toString(16).toUpperCase().padStart(2, '0')
      }
      return VS(out)
    },

    /**
     * =Chr Dump$(add,len) — routine 26 ($1120). A byte is printable when
     * `b AND $60` is non-zero, which is exactly the manual's "0-31 and
     * 128-159" becoming a full stop and nothing else.
     */
    'chr dump$': (_, a) => {
      const bytes = readBytes(i0(a, 0), i0(a, 1))
      return VS(String.fromCharCode(...bytes.map((b) => ((b & 0x60) !== 0 ? b : 46))))
    },

    /**
     * =Str Peek$(addr,len[,stop$]) — routine 28 ($114a), routine 27 for the
     * two-argument form, which pushes a null pointer rather than a string.
     *
     * Only the FIRST character of stop$ is used: routine 28 loads its length
     * word into d6 and never reads d6 again. An empty stop$ is treated as
     * absent. A `len` with a non-zero high word is not an error but a silent
     * clamp to 65500.
     *
     * DEFECT: when the stop character is not found the result is one byte
     * short of `len`. See the file header.
     */
    'str peek$': (_, a) => {
      const addr = i0(a, 0)
      let len = i0(a, 1)
      if ((len >>> 16) !== 0) len = CRAFT_PEEK_CLAMP
      const stop = a.length > 2 ? s0(a, 2) : ''
      if (stop.length === 0) return VS(String.fromCharCode(...readBytes(addr, len)))
      const want = stop.charCodeAt(0) & 0xff
      const bytes = readBytes(addr, len)
      let n = bytes.indexOf(want)
      if (n < 0) n = len - 1 // the scan walked all len bytes and one is still dropped
      return VS(String.fromCharCode(...bytes.subarray(0, Math.max(0, n))))
    },

    /**
     * =Chip Max Block — routine 32 ($11fc). `move.l #$20002,d1` then routine
     * 34, which is `jsr -216(ExecBase)`: AvailMem(MEMF_CHIP|MEMF_LARGEST).
     * TURBO Plus's `Chip Largest` is the same call from another library, so
     * this shares rt.chipFree() with it, DEVIATION and all — the modelled
     * pools track a total rather than a largest free block, so these answer
     * what `Chip Free` does. A fragmented Amiga would answer less.
     */
    'chip max block': () => VI(rt.chipFree()),
    /** =Fast Max Block — routine 33 ($1206), `#$20004`, MEMF_FAST|MEMF_LARGEST */
    'fast max block': () => VI(rt.fastFree()),

    /**
     * =Mem Type address — routine 36 ($123a). `btst #0,d3` on the address
     * first, so an odd one is routine 208, AMOS error 25 "Address error";
     * then exec's TypeOfMem, whose flags are the manual's bit table (public,
     * chip, fast).
     */
    'mem type': (_, a) => {
      const addr = i0(a, 0)
      if ((addr & 1) !== 0) addressError()
      return VI(craftMemType(rt, addr))
    },
  }
}

/**
 * Routine 36's TypeOfMem, as far as this port can answer it.
 *
 * APPROXIMATED, and the reason is the one AMCAF's `Pt Bank` already carries:
 * a real machine decides chip against fast by where the address IS, and this
 * port models memory type as a FLAG ON THE BANK instead — `memType` in
 * ../loader/amosfile.ts, set from the bank header, because that is the only
 * place the information exists here. So an address inside a bank answers from
 * that flag, an address in any other modelled region answers fast, and an
 * address in no region at all answers 0, which is TypeOfMem's own answer for
 * memory that is not in the system list.
 */
function craftMemType(rt: Runtime, addr: number): number {
  for (const [n, bank] of rt.memBanks) {
    const base = rt.bankBase(n) >>> 0
    if ((addr >>> 0) >= base && (addr >>> 0) < base + bank.data.length) {
      return MEMF_PUBLIC | (bank.memType === 1 ? MEMF_CHIP : MEMF_FAST)
    }
  }
  return rt.resolveAddr(addr) ? MEMF_PUBLIC | MEMF_FAST : 0
}

/** the three bits the manual tabulates for =Mem Type */
const MEMF_PUBLIC = 1
const MEMF_CHIP = 2
const MEMF_FAST = 4

/**
 * Routine 15: bank 1..16 to its data address and length.
 *
 * `subq.l #1,d0 / moveq #16,d1 / cmp.l d1,d0 / Rbcc routine 206` — so the
 * check is unsigned and bank 0 fails it as surely as bank 17. The address is
 * the bank pointer plus EIGHT, stepping over the header, and the length has
 * bit 31 cleared because that is where the chip flag lives.
 *
 * A bank in range but not reserved is error 23 here. The original reads the
 * table entry regardless and would walk a null pointer; there is no null to
 * walk in this port, and answering 23 is what the range check next door
 * already does for a caller who names a bank that is not there.
 */
function craftBank(rt: Runtime, n: number): { addr: number; len: number } {
  if (u32(n - 1) >= 16) illegal()
  const bank = rt.memBanks.get(n)
  if (bank === undefined) return illegal()
  return { addr: rt.bankBase(n), len: bank.data.length }
}

export function makeCraftInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Str Poke addr,string$ — routine 29 ($119a). No length check and no
     * bound of any kind; a zero-length string writes nothing.
     */
    'str poke'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      for (let i = 0; i < s.length; i++) {
        const m = rt.resolveWrite(addr + i)
        if (m) m.data[m.off] = s.charCodeAt(i) & 0xff
      }
    },

    /**
     * Mem Copy start,finish To destination — routine 35 ($1222). The count is
     * `finish - start + 1`, so the range is INCLUSIVE, and the copy is exec's
     * CopyMem — which is why the manual sells it as "almost the same
     * instruction as Copy, but it allows you to use addresses which are not
     * dividend by four".
     */
    'mem copy'(it) {
      const start = it.evalInt()
      it.expect(',')
      const finish = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const n = finish - start + 1
      if (n <= 0) return
      const buf = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        const m = rt.resolveAddr(start + i)
        buf[i] = m ? (m.data[m.off] ?? 0) : 0
      }
      for (let i = 0; i < n; i++) {
        const m = rt.resolveWrite(dest + i)
        if (m) m.data[m.off] = buf[i]!
      }
    },

    /** Mem Scramble start To finish,p$ / Mem Scramble bank,p$ — routines 37, 38 */
    'mem scramble': (it) => craftMemCipher(rt, it, false),
    /** Mem Unscramble start To finish,p$ / bank,p$ — routines 39, 40 */
    'mem unscramble': (it) => craftMemCipher(rt, it, true),
  }
}

/**
 * The two memory cipher instructions, which differ only in the core they
 * tail into. Both forms are in place, and both resolve their span BEFORE the
 * password is popped — routine 23 runs first, which is why an empty password
 * is error 23 even when the span is nonsense.
 */
function craftMemCipher(rt: Runtime, it: Interp, back: boolean): void {
  const first = it.evalInt()
  let addr: number
  let len: number
  if (it.accept('to')) {
    const finish = it.evalInt()
    it.expect(',')
    const key = craftKey(it.evalStr())
    if (finish - first < 0) illegal()
    addr = first
    len = finish - first + 1
    craftApply(rt, addr, len, key, back)
    return
  }
  it.expect(',')
  const key = craftKey(it.evalStr())
  const bank = craftBank(rt, first)
  addr = bank.addr
  len = bank.len
  craftApply(rt, addr, len, key, back)
}

function craftApply(rt: Runtime, addr: number, len: number, key: Cipher, back: boolean): void {
  const buf = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    const m = rt.resolveAddr(addr + i)
    buf[i] = m ? (m.data[m.off] ?? 0) : 0
  }
  const out = back ? craftUnscramble(buf, key) : craftScramble(buf, key)
  for (let i = 0; i < len; i++) {
    const m = rt.resolveWrite(addr + i)
    if (m) m.data[m.off] = out[i]!
  }
}
