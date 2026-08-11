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
import { FIB_SIZEOF, ID_WRITE_PROTECTED, MAX_COMMENT, entryType, fibBytes, type FibFields } from '../amiga/dos'
import type { VolumeInfo } from '../amiga/vfs'
import type { Screen } from './screen'

/**
 * CRAFT's one open directory scan, and the FileInfoBlock behind it.
 *
 * The extension keeps a single block: routine 67 allocates it on `Dr Name$`,
 * routine 66 (`Dr Forget`) frees it, and `Dr Next$` frees it itself on the
 * way out. Every accessor reads that one block, which is why the manual warns
 * that `Dr Next$` "changes all the information given by special functions".
 */
export interface CraftState {
  /** the entries `Dr Next$` has left to hand out, or null when no scan is open */
  scan: { dir: string; rest: string[] } | null
  /** fib_DirEntryType of the object `Dr Name$` locked -- routine 59's $4(a2) */
  scanType: number
  /** the published block, mapped at Runtime.CRAFT_FIB_BASE */
  fib: Uint8Array
  /** the same block decoded, which is what the accessors actually read */
  fields: FibFields | null
  /** the last AmigaDOS error, what `Disc Error` answers */
  ioError: number
}

export const newCraftState = (): CraftState => ({
  scan: null,
  scanType: 0,
  fib: new Uint8Array(FIB_SIZEOF),
  fields: null,
  ioError: 0,
})

/** AMOS error 23, "Illegal function call" — routine 206 */
const illegal = (): never => {
  throw new AmosError(ED_RUN_MESSAGES[23]!, 23)
}

/** AMOS error 25, "Address error" — routine 208, reached by an odd address */
const addressError = (): never => {
  throw new AmosError(ED_RUN_MESSAGES[25]!, 25)
}

/**
 * CRAFT's own messages: the NUL-separated table at $334c, which routine 218
 * ($333c) hands to AMOS with the index the caller left in d0.
 *
 * Only three of the seven belong to groups that are ported; the four turtle
 * and fractal ones are here because the table is one object and quoting half
 * of it would invite a second, disagreeing copy later. Routine 216, the only
 * one of these reached so far, is `moveq #3,d0 / Rbra routine 218` — and index
 * 3 landing on "Not a palette bank" for the one caller that is a palette-bank
 * name check is what confirms d0 is the index and the order is the file's.
 */
export const CRAFT_ERRORS = [
  'No fractal window defined',
  'No fractal position defined',
  'No fractal step specified',
  'Not a palette bank',
  'Turtle error: bad syntax',
  'Turtle error: illegal function call',
  'Turtle error: illegal number of parameters',
]

// annotated on the binding rather than the arrow so a call to it narrows: TS
// only treats a never-returning const as a terminator when the VARIABLE says so
const craftError: (n: number) => never = (n) => {
  throw new AmosError(CRAFT_ERRORS[n] ?? `CRAFT error ${n}`)
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


/**
 * Routine 43, the path splitter both `Dr File$` and `Dr Path$` sit on.
 *
 * Walks back from the end for `/` or `:` and answers the 1-BASED position of
 * the separator, or 0 when there is none.
 */
export function craftSplit(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]
    if (c === '/' || c === ':') return i + 1
  }
  return 0
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

    /**
     * =Dr File$(filespec$) — routine 41 ($12b0) over the splitter at 43.
     *
     * DEFECT: with NO separator in the string it answers the string shifted
     * one character left, with a byte of whatever follows on the end. Routine
     * 43 leaves a1 on the separator it found, and routine 41 does
     * `addq.l #1,a1` to step past it — but when the scan runs out instead of
     * matching, a1 has walked all the way down to the first CHARACTER, so the
     * same step skips it. The length is right and the start is one late, so
     * `Dr File$("abc")` is "bc" plus one byte past the string. Reproduced with
     * the trailing byte as NUL, which is the most this port can say about
     * memory it does not own.
     */
    'dr file$': (_, a) => {
      const s = s0(a, 0)
      const at = craftSplit(s)
      if (at === 0) return VS(s.length === 0 ? '' : `${s.slice(1)}\0`)
      return VS(s.slice(at))
    },

    /**
     * =Dr Path$(filespec$) — routine 42 ($12cc). Everything up to and
     * INCLUDING the last separator, and the empty string when there is none.
     * It copies from a2, the start of the string, so it never meets routine
     * 41's problem.
     */
    'dr path$': (_, a) => VS(s0(a, 0).slice(0, craftSplit(s0(a, 0)))),

    /** =Db Free(drive$) — routine 44 ($1304): id_NumBlocks - id_NumBlocksUsed */
    'db free': (_, a) => {
      const i = craftInfo(rt, s0(a, 0))
      return VI(i ? i.numBlocks - i.numBlocksUsed : -1)
    },
    /** =Db Used(drive$) — routine 45 ($131a): id_NumBlocksUsed */
    'db used': (_, a) => {
      const i = craftInfo(rt, s0(a, 0))
      return VI(i ? i.numBlocksUsed : -1)
    },
    /**
     * =Db Size(drive$) — routine 46 ($132c): id_BytesPerBlock.
     *
     * The manual says a block is "usually 488 bytes", which is the DATA a
     * 512-byte OFS block carries once its 24-byte header is taken off.
     * `id_BytesPerBlock` is the block, so this answers 512 — and the same
     * manual's Db Free/Db Used entry gets it right by pointing at the CLI's
     * `Info`, which prints 512 too.
     */
    'db size': (_, a) => {
      const i = craftInfo(rt, s0(a, 0))
      return VI(i ? i.bytesPerBlock : -1)
    },
    /**
     * =Disc State(drive$) — routine 47 ($133e), `id_DiskState - 80`, which
     * turns AmigaDOS's 80/81/82 into the manual's 0 write-protected, 1 not yet
     * validated, 2 validated. -1 when the Info fails, which is "no disc".
     */
    'disc state': (_, a) => {
      const i = craftInfo(rt, s0(a, 0))
      return VI(i ? i.diskState - ID_WRITE_PROTECTED : -1)
    },
    /**
     * =Disc Type$(drive$) — routine 48 ($1354). id_DiskType written out as
     * four bytes and cut at the first NUL, so OFS is "DOS" and FFS is
     * "DOS"+Chr$(1) exactly as the manual says. ID_NO_DISK_PRESENT is -1 and
     * the routine turns that into a zero longword, which cuts to "" — the
     * same answer a failed Info gives.
     */
    'disc type$': (_, a) => {
      const i = craftInfo(rt, s0(a, 0))
      const t = i && i.diskType !== -1 ? i.diskType >>> 0 : 0
      let out = ''
      for (let sh = 24; sh >= 0; sh -= 8) {
        const b = (t >>> sh) & 0xff
        if (b === 0) break
        out += String.fromCharCode(b)
      }
      return VS(out)
    },

    /** =File Protect(f$) — routine 50 ($13c8): fib_Protection */
    'file protect': (_, a) => VI(craftExamine(rt, s0(a, 0)).protection),
    /** =File Comment$(f$) — routine 51 ($13d4): fib_Comment */
    'file comment$': (_, a) => VS(craftExamine(rt, s0(a, 0)).comment),
    /** =File Length(f$) — routine 52 ($13e0): fib_Size, zero for a directory */
    'file length': (_, a) => VI(craftExamine(rt, s0(a, 0)).size),
    /**
     * =File Type(f$) — routine 53 ($13ec): fib_DirEntryType, so positive is a
     * directory and negative a file, which is the manual exactly.
     */
    'file type': (_, a) => VI(craftExamine(rt, s0(a, 0)).type),

    /**
     * =Disc Error — routine 58. The last AmigaDOS error, which every keyword
     * here sets through routine 212's IoErr.
     */
    'disc error': () => VI(rt.craft.ioError),

    /**
     * =Dr Name$(path$) — routine 59 ($14d0). Locks the path, Examines it and
     * answers fib_FileName, which for a directory is the DIRECTORY'S OWN name
     * — the manual's "It is always the name of the directory". It also opens
     * the scan: routine 67 allocates the block, the lock goes at +0 and
     * fib_DirEntryType is copied to +4 for `Dr Next$` to check.
     */
    'dr name$': (_, a) => {
      const path = s0(a, 0)
      const kind = rt.vfs?.exists(path) ?? null
      if (kind === null) craftDosError(rt, 205)
      const fields = craftFields(rt, path)
      craftPublish(rt, fields)
      const st = rt.craft
      st.scanType = fields.type
      st.scan =
        kind === 'dir' ? { dir: path, rest: (rt.vfs?.listDir(path) ?? []).map((e) => e.name) } : { dir: path, rest: [] }
      st.ioError = 0
      return VS(fields.name)
    },

    /**
     * =Dr Next$ — routine 60 ($151e). ExNext into the same block.
     *
     * Two things the manual only half says. `Rbmi routine 212` on the saved
     * fib_DirEntryType first, so calling this after a `Dr Name$` that named a
     * FILE is an error rather than an empty string. And when ExNext reports
     * ERROR_NO_MORE_ENTRIES the routine frees the scan block before answering
     * "" — which is why "If you continue reading the directory after getting
     * an empty string, an error will be caused": the block is gone and the
     * next call cannot find one.
     */
    'dr next$': () => {
      const st = rt.craft
      if (st.scan === null) craftDosError(rt, 232)
      if (st.scanType < 0) craftDosError(rt, 212)
      const name = st.scan.rest.shift()
      if (name === undefined) {
        craftForget(rt)
        return VS('')
      }
      craftPublish(rt, craftFields(rt, `${st.scan.dir}/${name}`))
      return VS(name)
    },

    /** =Dr Comment$ — routine 61 ($1568): the block's fib_Comment */
    'dr comment$': () => VS(craftCurrent(rt).comment),
    /** =Dr Protect — routine 62 ($1576): the block's fib_Protection */
    'dr protect': () => VI(craftCurrent(rt).protection),
    /** =Dr Length — routine 63 ($1584): the block's fib_Size */
    'dr length': () => VI(craftCurrent(rt).size),
    /** =Dr Type — routine 64 ($1592): the block's fib_DirEntryType */
    'dr type': () => VI(craftCurrent(rt).type),
    /**
     * =Dr Fib — routine 65 ($15a0), `move.l a2,d3 / addq.l #8,d3`: the ADDRESS
     * of the FileInfoBlock, eight bytes into the scan block.
     *
     * This is why the block is real mapped memory here rather than a record —
     * the manual sends the reader to an appendix of offsets and expects them
     * to Peek it. Runtime.CRAFT_FIB_BASE is where it lands.
     */
    'dr fib': () => {
      craftCurrent(rt)
      return VI(Runtime.CRAFT_FIB_BASE)
    },

    // ---- palettes ----

    /** =Pal Red(col) — routine 68 ($161e): routine 74, then bits 8-11 */
    'pal red': (_, a) => VI((craftGun(rt, i0(a, 0)) >> 8) & 15),
    /** =Pal Green(col) — routine 70 ($1630): routine 74, then bits 4-7 */
    'pal green': (_, a) => VI((craftGun(rt, i0(a, 0)) >> 4) & 15),
    /** =Pal Blue(col) — routine 72 ($1642): routine 74, then bits 0-3 */
    'pal blue': (_, a) => VI(craftGun(rt, i0(a, 0)) & 15),

    /**
     * =Pal Count(b) — routine 80 ($183a).
     *
     * `moveq #1,d0 / move.l d0,-(a3) / moveq #3,d2 / Rbsr routine 94`: it
     * stacks palette 1 and asks the resolver for a count. An unreserved bank
     * answers 0 rather than raising, which is the manual's "if the bank is
     * empty a value of zero is returned"; a bank that is reserved but is not
     * a palette bank still raises, because the resolver checks the name
     * before it looks at what the caller wanted.
     */
    'pal count': (_, a) => VI(craftPalResolve(rt, i0(a, 0), 1, PAL_COUNT).count),

    /**
     * =Bank Colour(b,n,index) — routine 92 ($1950).
     *
     * `ext.l d3` on the stored word, so the $FFFF a deleted colour leaves
     * behind comes back as -1: "if there is no colour available, a value of
     * -1 is returned".
     */
    'bank colour': (_, a) => {
      const w = craftPalResolve(rt, i0(a, 0), i0(a, 1), PAL_USE).read(palIndex(i0(a, 2)))
      return VI(w === PAL_ABSENT ? -1 : w)
    },
  }
}

/**
 * Routine 74 ($1652), the shared body behind =Pal Red, =Pal Green and =Pal
 * Blue: a whole colour value for the three callers to slice a nibble out of.
 *
 * Two things the manual gets right and one it never mentions.
 *
 * A NEGATIVE argument is not a register but a colour VALUE — `tst.w (a3) /
 * bpl` peeks at the high word of the stacked longword, and a negative one is
 * popped, negated and returned whole. That is "if it's negative, the function
 * returns a value which is calculated by taking the current component out of
 * the absolute value of the parameter, which is considered a colour value",
 * and it means `Pal Red(-$F0A)` is 15 with no screen state involved.
 *
 * A register number is bounds-checked against SIXTY-FOUR and then masked with
 * 31, and `btst #5,d2` on the original decides what happens next: colours
 * 32-63 read register n-32 and come back through `lsr.w #1 / andi.w #$777`.
 * That is Extra Half Brite, the manual's "(0-63)" is the only trace of it in
 * the documentation, and the test is on the NUMBER rather than on the screen
 * — a 16-colour screen answers the halved value just the same.
 */
function craftGun(rt: Runtime, arg: number): number {
  if (arg < 0) return -arg
  if (u32(arg) >= 64) illegal()
  const v = craftScreen(rt).palette[arg & 31]!
  return arg & 32 ? (v >> 1) & 0x777 : v
}

/**
 * Routine 75 ($1692), the shared body behind Set Red, Set Green and Set Blue.
 * The callers reach it with d4 = 8, 4 or 0, which is the shift.
 *
 * The clamp is exactly what the manual promises — "you don't have to worry
 * whether the value is too big or too small because these instructions
 * automatically convert them (x>15 => x=15 and x<0 => x=0)".
 *
 * THE BOUND IS NOT THE GETTER'S. Routine 74 admits 0-63 and reads the upper
 * half through the half-brite shift; this one is `moveq #$20,d0 / cmp.l d0,d3
 * / Rbcc routine 206`, so THIRTY-TWO. `Set Red 40,15` is error 23 while `Pal
 * Red(40)` answers happily. Reproduced as it stands: there is nothing to write
 * to for a half-brite colour — the register it would have to change is the one
 * 40's own value is derived from.
 */
function craftSetGun(rt: Runtime, it: Interp, shift: number): void {
  const col = it.evalInt()
  it.expect(',')
  const raw = it.evalInt()
  const v = raw < 0 ? 0 : raw > 15 ? 15 : raw
  if (u32(col) >= 32) illegal()
  const pal = craftScreen(rt).palette
  pal[col] = ((pal[col]! & ~(15 << shift)) | (v << shift)) & 0xfff
}

/** `tst.w $5fa(a5) / Rbeq routine 210` — the guard on every keyword in the group */
function craftScreen(rt: Runtime): Screen {
  const s = rt.screens.get(rt.currentIndex)
  if (!s) throw new AmosError(ED_RUN_MESSAGES[47]!, 47)
  return s
}

/**
 * Routine 212: IoErr, mapped through the table at $32e8 to an AMOS error.
 *
 * The table is pairs of bytes, an AmigaDOS code and the AMOS number to raise,
 * walked until the code matches or a zero ends it — so an unlisted IoErr
 * lands on the terminator's partner. `Disc Error` reads the AmigaDOS number
 * rather than the AMOS one, which is why it is recorded before the raise.
 */
function craftDosError(rt: Runtime, ioErr: number): never {
  rt.craft.ioError = ioErr
  throw new AmosError(ED_RUN_MESSAGES[23]!, 23)
}

/**
 * Routine 49: Lock, Info, UnLock, with `pr_WindowPtr` set to -1 across the
 * middle so AmigaDOS cannot pop its "please insert volume" requester. Answers
 * null where the Lock or the Info failed, which is every caller's -1.
 */
function craftInfo(rt: Runtime, drive: string): VolumeInfo | null {
  return rt.vfs?.volumeInfo(drive) ?? null
}

/** the fields Examine would fill in for `path` */
function craftFields(rt: Runtime, path: string): FibFields {
  const kind = rt.vfs?.exists(path) ?? null
  if (kind === null) craftDosError(rt, 205)
  const m = rt.vfs!.meta(path)
  const size = kind === 'file' ? (rt.vfs!.readFile(path)?.length ?? 0) : 0
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf(':'))
  return {
    type: entryType(kind === 'dir'),
    name: cut >= 0 ? path.slice(cut + 1) : path,
    protection: m.protection ?? 0,
    size,
    days: m.days ?? 0,
    mins: m.mins ?? 0,
    ticks: m.ticks ?? 0,
    comment: m.comment ?? '',
  }
}

/** write a FileInfoBlock into the one published block */
function craftPublish(rt: Runtime, f: FibFields): void {
  rt.craft.fib.set(fibBytes(f))
  rt.craft.fields = f
}

/**
 * Routine 54: Lock, Examine, UnLock, raising through routine 212 on either
 * failure. Unlike routine 49 it does NOT touch `pr_WindowPtr`, so on a real
 * machine a bad volume here really does put a requester up.
 */
function craftExamine(rt: Runtime, path: string): FibFields {
  const f = craftFields(rt, path)
  rt.craft.ioError = 0
  return f
}

/**
 * Routine 67 with d0 = -1: the whole scan block goes, FileInfoBlock included.
 * Clearing only the scan and leaving the block behind would let the accessors
 * go on answering from a directory nobody is reading any more.
 */
export function craftForget(rt: Runtime): void {
  const st = rt.craft
  st.scan = null
  st.scanType = 0
  st.fields = null
  st.fib.fill(0)
}

/**
 * What the `Dr` accessors read: the block as it stands. Routine 67 with d0=0
 * raises when no scan is open, which is the error the manual promises for a
 * `Dr Next$` past the end.
 */
function craftCurrent(rt: Runtime): FibFields {
  const f = rt.craft.fields
  if (f === null) craftDosError(rt, 232)
  return f
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

/*
 * ---- palette banks ----
 *
 * The record layout, which is routine 84's ($1870) and routine 94's ($1986)
 * between them and is in no documentation at all:
 *
 *     +0   "Palettes"      the bank's eight-byte name, and its type check
 *     +8   32 words        palette 1
 *     +72  32 words        palette 2, and so on
 *
 * So a bank of n palettes is 72 + 64*(n-1) bytes and holds `((length - 72) >>
 * 6) + 1` of them, which is what =Pal Count answers. A word of $FFFF is not a
 * colour but an ABSENCE, and it is the same $FFFF core AMOS's own PalRout
 * skips (see `get palette` in instr.ts) — which is what lets a masked palette
 * be installed by handing the whole 32 words to one routine and letting the
 * markers fall through.
 *
 * This port keeps the eight name bytes where the rest of the port keeps them,
 * in `MemoryBank.name`, so `data` here is the palettes alone and every length
 * the binary computes has 8 added back to it.
 */

/** the word a slot with no colour in it holds — routine 84's `move.w #$ffff,(a1)+` */
export const PAL_ABSENT = 0xffff

/** bytes per stored palette: 32 colour registers, one word each */
export const PAL_BYTES = 64

/** routine 94's d2 = 0: the bank must already be a palette bank */
const PAL_USE = 0
/** d2 = 1: make one if the bank is empty */
const PAL_MAKE = 1
/** d2 = 2: Reserve As Palette, which refuses a bank that is already there */
const PAL_RESERVE = 2
/** d2 = 3: =Pal Count, which tolerates an empty bank */
const PAL_COUNT = 3

/** one resolved palette slot: the bank's bytes, where the palette starts, and how many there are */
interface PalSlot {
  readonly count: number
  read(index: number): number
  write(index: number, word: number): void
}

/**
 * Routine 94 ($1986) — the resolver every palette-bank keyword goes through,
 * with d2 selecting which of the four jobs it is doing.
 *
 * It pops the palette number first and the bank second, because AMOS stacks
 * arguments left to right and this reads them off right to left. An omitted
 * palette ($80000000, AMOS's marker for a skipped parameter) becomes 1 —
 * which is the manual's "if you omit the parameter n, the instruction will
 * affect the first palette stored in the bank", stated only under Set Bank
 * Colour but true of every keyword here.
 *
 * The order of its refusals is worth keeping. The name is compared BEFORE the
 * length is judged, so a Work bank that is also too short is "Not a palette
 * bank" rather than error 36; and Reserve As Palette's "bank already
 * reserved" fires before either, so it never reports on a bank's contents.
 */
function craftPalResolve(rt: Runtime, bank: number, palette: number, mode: number): PalSlot {
  craftScreen(rt)
  // `cmpi.l #$10000,d3 / Rbcc routine 206` on the palette AFTER the subtract,
  // so palette 0 wraps to $ffffffff and fails the unsigned check
  const off = u32(palette - 1)
  if (off >= 0x10000) illegal()
  const at = off * PAL_BYTES
  // `subq.l #1,d0 / moveq #16,d1 / cmp.l d1,d0 / Rbcc routine 206` — banks
  // 1..16, unsigned, so bank 0 fails as surely as bank 17
  if (u32(bank - 1) >= 16) illegal()

  const ref = rt.bankRef(bank)
  if (ref === null) {
    if (mode === PAL_COUNT) return palSlot(new Uint8Array(0), 0, 0)
    // `tst.w d2 / Rbeq routine 209` — only d2 = 0 refuses to create
    if (mode === PAL_USE) throw new AmosError(ED_RUN_MESSAGES[36]!, 36)
    rt.reserveBank(bank, at + PAL_BYTES, 'Palettes', true)
    return palSlot(rt.memBanks.get(bank)!.data, at, 0)
  }
  if (mode === PAL_RESERVE) throw new AmosError(ED_RUN_MESSAGES[35]!, 35)
  if (ref.name !== 'Palettes') craftError(3)
  const mem = rt.memBanks.get(bank)
  // an object bank passes the length test and fails the name one; there is no
  // fourth case, because bankRef only ever answers one of the three
  if (mem === undefined) craftError(3)
  // the binary's length INCLUDES the eight name bytes this port keeps beside
  // the data, so both of its comparisons get them added back
  const room = mem.data.length - PAL_BYTES
  if (room < 0 || at > room) throw new AmosError(ED_RUN_MESSAGES[36]!, 36)
  return palSlot(mem.data, at, (room >> 6) + 1)
}

function palSlot(data: Uint8Array, at: number, count: number): PalSlot {
  return {
    count,
    read: (i) => (data[at + i * 2]! << 8) | data[at + i * 2 + 1]!,
    write(i, word) {
      data[at + i * 2] = (word >> 8) & 0xff
      data[at + i * 2 + 1] = word & 0xff
    },
  }
}

/**
 * The mask loop routines 84, 87 and 90 share, and the one place the mask's
 * polarity is fixed: bit n set copies colour n, bit n clear stores the $FFFF
 * marker INSTEAD. Routine 90 spells its version with `ror.l #1,d7` rather
 * than `lsr.l`, which is not a different rule but the same one written so
 * that d7 survives to be walked three times.
 */
function palMasked(mask: number, get: (i: number) => number): Uint16Array {
  const out = new Uint16Array(32)
  for (let i = 0; i < 32; i++) out[i] = mask & (1 << i) ? get(i) : PAL_ABSENT
  return out
}

/** the AMOS routine at `$3c(a0)`: 32 words into the screen, $FFFF meaning "leave this one" */
function palInstall(rt: Runtime, words: Uint16Array): void {
  const pal = craftScreen(rt).palette
  for (let i = 0; i < 32; i++) if (words[i] !== PAL_ABSENT) pal[i] = words[i]! & 0xfff
}

/**
 * `b[,n[,mask]]`, the shape Pal To Bank, Pal From Bank and Pal Swap Bank all
 * take, and the three trampolines in front of each of them.
 *
 * `omitted` is the middle parameter written as nothing at all — `Pal To Bank
 * 5,,7`. AMOS stacks $80000000 for it, and Pal To Bank's three-argument
 * trampoline (routine 83, `cmpi.l #$80000000,(a3)`) is the ONE place in the
 * group that looks: finding the marker there is what turns d2 from 0 to 1 and
 * lets that form create the bank. Its two-argument trampoline does not look,
 * so `Pal To Bank 5,` on an unreserved bank is error 36 where `Pal To Bank
 * 5,,7` reserves one. Pal From Bank and Pal Swap Bank never look at all.
 */
function palBankArgs(it: Interp): { bank: number; palette: number; mask: number; arity: number; omitted: boolean } {
  const bank = it.evalInt()
  let palette = 1
  let mask = -1
  let arity = 1
  let omitted = false
  if (it.accept(',')) {
    arity = 2
    if (it.atStmtEnd() || it.nm() === ',') omitted = true
    else palette = it.evalInt()
    if (it.accept(',')) {
      arity = 3
      mask = it.evalInt()
    }
  }
  return { bank, palette, mask, arity, omitted }
}

/**
 * `b_nro,n,index` — Set Bank Colour's first three, and Del Bank Colour's all.
 *
 * The palette may be written as nothing: "if you omit the parameter n, the
 * instruction will affect the first palette stored in the bank". There is no
 * marker test here, because routine 94 does it for all three of routines 91,
 * 92 and 93 — $80000000 arrives as the palette number and becomes 1.
 *
 * =Bank Colour is not one of the three. It takes the same list, but a FUNCTION
 * argument reaches this port already evaluated and an elided one arrives as -1,
 * which is indistinguishable from a caller who wrote -1 — so it reads its
 * three positionally and the elision is offered only where it can be seen.
 */
function craftBankColourArgs(it: Interp): [number, number, number] {
  const bank = it.evalInt()
  it.expect(',')
  const palette = it.nm() === ',' ? 1 : it.evalInt()
  it.expect(',')
  const index = it.evalInt()
  return [bank, palette, index]
}

/** `moveq #$20,d0 / cmp.l d0,d7 / Rbcc routine 206`, ahead of the bank in all three */
function palIndex(index: number): number {
  if (u32(index) >= 32) illegal()
  return index
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

    /**
     * Set Protect f$,bits — routine 55 ($1430), dos.library's SetProtection.
     * The manual tabulates the bits, and they are FIBF_* with the low four
     * active low: bit 0 delete, 1 execute, 2 write, 3 read, 4 archive,
     * 5 pure, 6 script, 7 hide.
     */
    'set protect'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bits = it.evalInt()
      if (!rt.vfs || rt.vfs.exists(path) === null) craftDosError(rt, 205)
      rt.vfs.setMeta(path, { protection: bits })
      rt.craft.ioError = 0
    },

    /**
     * Set Comment f$,com$ — routine 56, dos.library's SetComment.
     *
     * The manual's "the maximum length of the comment is 79 characters" is
     * the LIBRARY's limit, not the extension's: an over-long note is
     * ERROR_COMMENT_TOO_BIG from SetComment, which routine 212 turns into an
     * AMOS error. An empty string clears it, as the manual says.
     */
    'set comment'(it) {
      const path = it.evalStr()
      it.expect(',')
      const note = it.evalStr()
      if (!rt.vfs || rt.vfs.exists(path) === null) craftDosError(rt, 205)
      if (note.length > MAX_COMMENT) craftDosError(rt, 220)
      rt.vfs.setMeta(path, { comment: note })
      rt.craft.ioError = 0
    },

    /**
     * Dr Forget — routine 66 ($15ae), `moveq #-1,d0 / Rbra routine 67`: free
     * the scan block. The manual is right that it runs on Run and on Default;
     * the `defaults` hook below is where that happens.
     */
    'dr forget'() {
      craftForget(rt)
    },

    // ---- palettes ----

    /** Set Red col,val — routine 69 ($162a), `moveq #8,d4 / Rbra routine 75` */
    'set red': (it) => craftSetGun(rt, it, 8),
    /** Set Green col,val — routine 71 ($163c), d4 = 4 */
    'set green': (it) => craftSetGun(rt, it, 4),
    /** Set Blue col,val — routine 73 ($164c), d4 = 0 */
    'set blue': (it) => craftSetGun(rt, it, 0),

    /**
     * Pal Copy col1 To col2 — routine 78 ($1804). Reads col1, writes col2.
     * "Note that this instruction should not be used with flashing colours",
     * which is true of every keyword in this group: none of them touch the
     * Flash table, so the next flash step overwrites whatever they wrote.
     */
    'pal copy'(it) {
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      const pal = craftPair(rt, from, to)
      pal[to] = pal[from]!
    },

    /** Pal Swap col1,col2 — routine 77 ($17bc), a straight exchange through d4 */
    'pal swap'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const pal = craftPair(rt, a, b)
      const t = pal[a]!
      pal[a] = pal[b]!
      pal[b] = t
    },

    /**
     * Pal Spread col1 To col2 — routine 76 ($16d4). CRAFT's, not AMCAF's:
     * qualified in instr.ts, because the two spell the same name over
     * different parameters ("I0t0" here, "I0,0t0,0" there) and mean different
     * things by it. AMCAF's takes the two colour VALUES; this one takes two
     * REGISTERS and reads their current contents.
     *
     * "The colour next to col1 is transformed so that it looks a little bit
     * like col2. The next colour is transformed and it looks a little bit more
     * like col2 than the previous colour etc." Four details the prose leaves
     * out, all of them in the routine:
     *
     * - The ends are sorted. `sub.w d0,d1 / bcc / neg.w d1 / sub.w d1,d0`
     *   leaves the LOWER register in d0 and the distance in d1, so `Pal Spread
     *   7 To 2` fills the same registers as `Pal Spread 2 To 7`. Which end is
     *   which still matters, because the ramp runs from the value at the low
     *   register towards the value at the high one either way.
     * - Adjacent or equal registers do nothing: `beq` on the difference and
     *   `cmpi.w #1,d1 / bne` before the work starts.
     * - The far end is REWRITTEN, harmlessly. The loop runs `distance` times
     *   from the low register's neighbour, so its last write lands on col2
     *   itself. It cannot change it: the accumulated value is `target + 127 -
     *   r` for a truncated remainder r under `distance`, and `distance` is at
     *   most 31, so the bias always covers the shortfall.
     * - Every component carries +127 as a rounding bias, added once to the
     *   base and never removed, because the nibble is read out of bits 8-11 of
     *   an accumulator that keeps eight fractional bits below it.
     */
    'pal spread'(it) {
      const a = it.evalInt()
      it.expect('to')
      const b = it.evalInt()
      const pal = craftPair(rt, a, b)
      const lo = Math.min(a, b)
      const dist = Math.abs(a - b)
      if (dist <= 1) return
      palInstall(rt, palSpread(pal[lo]!, pal[lo + dist]!, lo, dist))
    },

    /**
     * Reserve As Palette b,n — routine 79 ($1834), `moveq #2,d2 / Rbra
     * routine 94`. "Reserves a palette bank b for n palettes."
     *
     * The resolver allocates `72 + 64*(n-1)` and stamps "Palettes" over the
     * first eight bytes, and `bset #31,d1` on the length says Data bank — so
     * a palette bank survives Erase Temp, like a Reserve As Data one and
     * unlike Reserve As Work.
     */
    'reserve as palette'(it) {
      const bank = it.evalInt()
      it.expect(',')
      craftPalResolve(rt, bank, it.evalInt(), PAL_RESERVE)
    },

    /**
     * Pal To Bank b[,n[,mask]] — routines 81, 82 and 83 ($184a, $1856, $185e)
     * onto the worker at routine 84 ($1870).
     *
     * The worker is eight instructions: resolve, then walk the screen's 32
     * registers against the mask, storing the colour where the bit is set and
     * $FFFF where it is not. So "the mask limits the colours transferred to
     * the bank" by writing an absence, not by leaving the slot alone — a
     * second Pal To Bank over the same palette with a narrower mask DELETES
     * what the first one put there.
     */
    'pal to bank'(it) {
      const a = palBankArgs(it)
      const make = a.arity === 1 || (a.arity === 3 && a.omitted) ? PAL_MAKE : PAL_USE
      const slot = craftPalResolve(rt, a.bank, a.palette, make)
      const pal = craftScreen(rt).palette
      const words = palMasked(a.mask, (i) => pal[i]! & 0xfff)
      for (let i = 0; i < 32; i++) slot.write(i, words[i]!)
    },

    /**
     * Pal From Bank b[,n[,mask]] — routines 85, 86 and 87 ($1892, $189a,
     * $18aa). "Note that if there is no bank b or it doesn't have enough
     * palettes, an error will be given", and that is d2 = 0 in all three
     * trampolines: this family never creates a bank, whatever is left out.
     *
     * The two-argument form hands the bank's own 64 bytes straight to AMOS,
     * markers and all, which is where "if you use Pal From Bank or Pal Swap
     * Bank, the colour whose representative is deleted from a bank, won't be
     * changed" comes from. The three-argument form ANDs the caller's mask on
     * top by writing $FFFF over what it excludes.
     */
    'pal from bank'(it) {
      const a = palBankArgs(it)
      const slot = craftPalResolve(rt, a.bank, a.palette, PAL_USE)
      palInstall(rt, palMasked(a.mask, (i) => slot.read(i)))
    },

    /**
     * Pal Swap Bank b[,n[,mask]] — routines 88, 89 and 90 ($18d8, $18e0,
     * $18e8). The screen's palette and the bank's change places.
     *
     * Routine 90 makes two masked copies in the work area before it writes
     * anything, which is what makes it a swap rather than two overwrites. But
     * the copy going BACK into the bank is masked the same way as the one
     * coming out, so a partial mask does not preserve the bank's other
     * colours — it ERASES them to $FFFF. The manual only claims the mask
     * "limits the colours transferred from the bank"; the damage on the
     * return leg is not mentioned anywhere, and it is the same $FFFF-for-
     * excluded rule Pal To Bank follows, applied where it costs something.
     */
    'pal swap bank'(it) {
      const a = palBankArgs(it)
      const slot = craftPalResolve(rt, a.bank, a.palette, PAL_USE)
      const pal = craftScreen(rt).palette
      const fromScreen = palMasked(a.mask, (i) => pal[i]! & 0xfff)
      const fromBank = palMasked(a.mask, (i) => slot.read(i))
      palInstall(rt, fromBank)
      for (let i = 0; i < 32; i++) slot.write(i, a.mask & (1 << i) ? fromScreen[i]! : PAL_ABSENT)
    },

    /**
     * Set Bank Colour b_nro,n,index,c — routine 91 ($192c).
     *
     * `moveq #$ff,d0 / cmp.l d0,d7 / beq` — the value is compared against
     * MINUS ONE as a longword before it is masked, and only that exact value
     * skips the `andi.w #$fff`. So -1 writes the absence marker and is the
     * one way to reach Del Bank Colour's effect through this keyword; -2 is
     * masked to $ffe and is an ordinary white.
     */
    'set bank colour'(it) {
      const [bank, palette, index] = craftBankColourArgs(it)
      it.expect(',')
      const c = it.evalInt()
      craftPalResolve(rt, bank, palette, PAL_USE).write(palIndex(index), c === -1 ? PAL_ABSENT : c & 0xfff)
    },

    /** Del Bank Colour b_nro,n,index — routine 93 ($196c): the marker, written */
    'del bank colour'(it) {
      const [bank, palette, index] = craftBankColourArgs(it)
      craftPalResolve(rt, bank, palette, PAL_USE).write(palIndex(index), PAL_ABSENT)
    },
  }
}

/** the bound routines 76, 77 and 78 share: both registers under 32, screen open */
function craftPair(rt: Runtime, a: number, b: number): Uint16Array {
  const pal = craftScreen(rt).palette
  if (u32(a) >= 32 || u32(b) >= 32) illegal()
  return pal
}

/**
 * Routine 76's inner loop, which is where Pal Spread's arithmetic lives.
 *
 * Each component is held in bits 8-11 of a 16-bit accumulator with eight
 * fractional bits beneath it, the step is `divs.w` — truncating towards zero,
 * not rounding — and +127 goes in once at the start. The buffer starts as 32
 * words of $FFFF and only the run gets written, so everything outside col1..
 * col2 is left alone when it is installed.
 *
 * The emitted word is built by a chain of shifts and masks (`lsl.w #4 / or.w
 * / andi.w #$ff00 / lsl.l #4 / or.w / lsr.l #8`) that reduces to taking bits
 * 8-11 of each accumulator, because none of them can reach $1000: the largest
 * base is $f00 and the bias is 127.
 */
function palSpread(from: number, to: number, lo: number, dist: number): Uint16Array {
  const out = new Uint16Array(32).fill(PAL_ABSENT)
  const gun = [0xf00, 0xf0, 0xf]
  const acc = gun.map((m, i) => ((from & m) << (i * 4)) + 127)
  const step = gun.map((m, i) => (((to & m) << (i * 4)) - ((from & m) << (i * 4))) / dist | 0)
  for (let k = 1; k <= dist; k++) {
    for (let i = 0; i < 3; i++) acc[i] = acc[i]! + step[i]!
    out[lo + k] = (((acc[0]! >> 8) & 15) << 8) | (((acc[1]! >> 8) & 15) << 4) | ((acc[2]! >> 8) & 15)
  }
  return out
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
