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
import { preferencesBytes } from '../amiga/intuition'
import { execute } from '../amiga/process'
import { finishRequester, startRequester, type AlertSpec } from './requester'

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
  /** the turtle's variable block, mapped at Runtime.CRAFT_TURTLE_BASE */
  turtle: DataView
  /** the fractal cursor and its colour table */
  fractal: CraftFractal
  /** Forbid's nesting and the task priority */
  system: CraftSystem
  /** a Guru Alert or Sys Request the interpreter is blocked on */
  request: { chan: number; spec: AlertSpec } | null
}

/**
 * The turtle's variable block — what `=Tr Base` hands out the address of.
 *
 * It is the extension's workspace at `$208(a5)` from offset $2e on, and the
 * offsets below are the binary's less $2e. The whole group reads and writes
 * through it, so it is kept as bytes here rather than as fields: the manual
 * says "returns the address of the internal turtle variable area" and sends
 * the reader off to Peek it, and a second copy of the state would be a second
 * chance to disagree with what Peek sees.
 *
 * Every coordinate is signed 16.16 — routine 118 turns an argument into
 * `value << 16` and routine 113 seeds a new turtle at the centre of the
 * screen with a fraction of $8000, so the turtle stands in the middle of a
 * pixel rather than on its corner.
 *
 * The two directions are NOT 16.16. `$34`/`$38` are SIGN-MAGNITUDE: bit 31 is
 * the sign and the rest is a magnitude of at most $10000, so straight north
 * is dx = 0, dy = $80010000, which is minus one and not a huge positive
 * number. Routine 106 reads the sign with `tst.w` on the high word and
 * strips it with `bclr #$1f`, which is what puts the format beyond doubt.
 */
export const TR = {
  /** the flag bits below */
  flags: 0x00,
  /** heading, 2^32 = 360 degrees */
  angle: 0x02,
  /** sin(heading) = the x step, sign-magnitude 16.16 */
  dx: 0x06,
  /** -cos(heading) = the y step, so north is negative and the screen agrees */
  dy: 0x0a,
  x: 0x0e,
  y: 0x12,
  homeX: 0x16,
  homeY: 0x1a,
  /** Tr Proportions, 16.16, one by default */
  propX: 0x1e,
  propY: 0x22,
  /** rp_linpatcnt as the turtle remembers it */
  patCnt: 0x26,
  /** FRST_DOT: 1 for the first segment after a jump, 0 once a line has been drawn */
  frstDot: 0x27,
  /** characters of the TCL string left when the current command started */
  left: 0x28,
  /** the TCL string's length plus one; =Tr Error is this minus `left` */
  total: 0x2a,
  remX: 0x2c,
  remY: 0x30,
  remA: 0x34,
} as const

/** the block runs from $2e to $65 of the workspace */
export const TR_SIZEOF = 0x38

/** $30 holds the heading and $34/$38 do not */
const TRF_ANGLE = 0
/** $34/$38 hold the heading and $30 does not */
const TRF_DIR = 1
/** the pen is UP — `Tr Pen Up` is `bset`, so a zeroed block draws */
const TRF_PENUP = 2
/** $3c/$40 have been placed; clear means "put me in the middle of the screen" */
const TRF_PLACED = 3
/** inside Tr Exec, which is how routine 217 knows which error to raise */
const TRF_TCL = 4
/** the proportions are not 1:1, so routine 119 has to scale */
const TRF_PROP = 5
/** the Tr Remember slots hold something */
const TRF_REM = 6

export const newCraftState = (): CraftState => {
  const turtle = new DataView(new ArrayBuffer(TR_SIZEOF))
  trResetBlock(turtle)
  return {
    scan: null,
    scanType: 0,
    fib: new Uint8Array(FIB_SIZEOF),
    fields: null,
    ioError: 0,
    turtle,
    fractal: newCraftFractal(),
    system: newCraftSystem(),
    request: null,
  }
}

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

    // ---- the turtle ----

    /** =Tr Get Angle — routine 100 ($1dee) over routine 106 */
    'tr get angle': () => VI(trBamToDeg(craftTrAngle(rt))),
    /** =Tr X Pos — routine 111 ($22b8): `swap d0 / move.w d0,d3 / ext.l d3` */
    'tr x pos': () => VI(trWhole(craftTrPos(rt).x)),
    /** =Tr Y Pos — routine 112 ($22c6) */
    'tr y pos': () => VI(trWhole(craftTrPos(rt).y)),
    /** =Tr X Home — routine 129 ($26de), and this one DOES sign-extend */
    'tr x home': () => VI(trWhole(craftTrPos(rt) && rt.craft.turtle.getInt32(TR.homeX))),
    /** =Tr Y Home — routine 130 ($26ec) */
    'tr y home': () => VI(trWhole(craftTrPos(rt) && rt.craft.turtle.getInt32(TR.homeY))),
    /**
     * =Tr Pen State — routine 124 ($260e), `btst #2 / seq / ext.w / ext.l`, so
     * the answer is -1 for a pen that is DOWN. The flag is stored the other
     * way up: bit 2 set is up, which is why a zeroed block draws.
     */
    'tr pen state': () => VI(trFlag(rt.craft.turtle, TRF_PENUP) ? 0 : -1),
    /** =Tr Distance(x,y) — routine 121 ($2580) */
    'tr distance': (_, a) => VI(craftTrDistance(rt, trArgOf(rt, i0(a, 0), false), trArgOf(rt, i0(a, 1), false))),
    /**
     * =Amos Pri — routine 177 ($2f22), `ThisTask->ln_Pri` at offset 9, sign
     * extended. CONTESTED with TURBO Plus and slot-qualified for it.
     */
    'amos pri': () => VI(rt.craft.system.pri),

    /**
     * =Cli Here — routine 203 ($325a). `ThisTask->pr_CLI` is a BPTR, which is
     * what the two `adda.l a0,a0` are doing — shifting it left twice to make
     * an address — and then `cli_Background` at $2c decides: -1 for a
     * FOREGROUND CLI, 0 for a background one. A process with no CLI at all
     * takes the `beq` and answers 0 as well.
     *
     * A program under this port was not started from a shell, so it is 0 —
     * the same answer the machine gives a Workbench-launched program.
     */
    'cli here': () => VI(0),

    /**
     * =Guru Alert(line$[,...]) — routines 168 to 172 onto the body at routine
     * 173 ($2e5a). One to five lines, each under 78 characters, and at least
     * one of them not empty.
     */
    'guru alert'(it, a) {
      // "if the user presses the right mouse button, the function returns a
      // zero (False), but if the user presses the left button, the function
      // returns a value of -1". A real red alert has no gadgets at all and
      // reads the buttons directly, so these two stand in for them.
      return craftRequest(rt, it, craftAlertSpec(a.map((v) => str(v)), ['Left button', 'Right button']))
    },

    /**
     * =Sys Request(...) — routines 182 to 187 ($2fa8..$2fc6). AutoRequest,
     * through `ThisTask->pr_WindowPtr`, and the argument list is body lines
     * FIRST and the two gadget labels LAST: routine 187 reads the last two
     * off the stack before it walks back over one to five body lines, which
     * is how three arguments make one line and seven make five.
     */
    'sys request'(it, a) {
      const strs = a.map((v) => str(v))
      const neg = strs.pop() ?? ''
      const pos = strs.pop() ?? ''
      // "if you use empty strings \"\" instead of pos$ and neg$, the leftmost
      // button is 'Retry' and the rightmost is 'Cancel'" -- and both words are
      // in the hunk at $3096 and $308e, with their length bytes in front
      return craftRequest(rt, it, craftAlertSpec(strs, [pos || 'Retry', neg || 'Cancel']))
    },

    /** =Fr X Position — routine 140 ($27da), which raises if none was set */
    'fr x position': () => VI(frPlaced(rt).px),
    /** =Fr Y Position — routine 141 ($27f2) */
    'fr y position': () => VI(frPlaced(rt).py),
    /**
     * =Fr X Step — routine 145 ($285a). A step of zero has never been set and
     * is CRAFT's error 2; the read is `move.w` into a zeroed register, so the
     * $ffff the two-argument Fr Step can leave behind comes back as 65535.
     */
    'fr x step': () => VI(frStep(rt.craft.fractal.sx)),
    /** =Fr Y Step — routine 146 ($286c) */
    'fr y step': () => VI(frStep(rt.craft.fractal.sy)),
    /** =Fr Get Colour(index) — routine 148 ($28a0) */
    'fr get colour': (_, a) => {
      const table = frColours(rt)
      const index = i0(a, 0)
      if ((index >>> 0) > 0x400) illegal()
      return VI(table[index]!)
    },

    /**
     * =Tr Base — routine 137 ($2784), `moveq #$2e,d3 / add.l $208(a5),d3`:
     * the workspace address plus $2e, which is where the flags byte sits.
     * "Returns the address of the internal turtle variable area", and the
     * manual means it — the whole block is mapped here so a Peek of it agrees
     * with what the keywords see. See TR above for the offsets.
     */
    'tr base': () => VI(Runtime.CRAFT_TURTLE_BASE),
    /**
     * =Tr Error — routine 97 ($1d90), `$58 - $56`: the length of the string
     * plus one, less what was left when the failing command started, which is
     * that command's one-based position. A clean Tr Exec zeroes both with one
     * `clr.l`, so "if there were no errors, a value of zero is given".
     */
    'tr error': () => {
      const t = rt.craft.turtle
      return VI(((t.getUint16(TR.total) - t.getUint16(TR.left)) << 16) >> 16)
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

    // ---- the turtle ----

    /** Tr Reset — routine 98 ($1da2), and the `defaults` hook runs it too */
    'tr reset': () => craftTrReset(rt),
    /** Tr Angle a — routine 99 ($1dd2) */
    'tr angle': (it) => craftTrSetAngle(rt, it.evalInt()),
    /** Tr Right a — routine 103 ($1e62) */
    'tr right': (it) => craftTrTurn(rt, it.evalInt()),
    /** Tr Left a — routine 102 ($1e5c), `neg.l (a3) / Rbra routine 103` */
    'tr left': (it) => craftTrTurn(rt, -it.evalInt()),
    /** Tr Towards x,y — routine 104 ($1e7a) */
    'tr towards'(it) {
      craftScreen(rt)
      const p = trParsePair(rt, it)
      craftTrTowards(rt, p.x, p.y)
    },
    /** Tr Forward d — routine 107 ($20a6) */
    'tr forward': (it) => craftTrGo(rt, it, false),
    /** Tr Forw d — the same token routine, so the same handler */
    'tr forw': (it) => craftTrGo(rt, it, false),
    /** Tr Back d — routine 108 ($2100), `neg.l (a3) / Rbra routine 107` */
    'tr back': (it) => craftTrGo(rt, it, true),
    /** Tr Pen Up — routine 122 ($25f6), `bset #2`: the flag is "up" */
    'tr pen up': () => trSetFlag(rt.craft.turtle, TRF_PENUP),
    /** Tr Pen Down — routine 123 ($2602) */
    'tr pen down': () => trClrFlag(rt.craft.turtle, TRF_PENUP),
    /** Tr Move x,y — routine 114 ($2326) */
    'tr move'(it) {
      const p = trParsePair(rt, it)
      craftTrMove(rt, p.x, p.y)
    },
    /** Tr Move Rel dx,dy — routine 115 ($235c): scaled, and nothing drawn */
    'tr move rel'(it) {
      const p = trParsePair(rt, it)
      craftTrStep(rt, p.x.v, p.y.v, 0)
    },
    /** Tr Draw x,y — routine 116 ($236c) */
    'tr draw'(it) {
      const p = trParsePair(rt, it)
      craftTrDraw(rt, p.x, p.y)
    },
    /** Tr Draw Rel dx,dy — routine 117 ($2394): scaled, and drawn */
    'tr draw rel'(it) {
      const p = trParsePair(rt, it)
      craftTrStep(rt, p.x.v, p.y.v, 1)
    },
    /** Tr Proportions x[,y] — routines 125 and 126 ($2622, $2628) */
    'tr proportions'(it) {
      const one = (): number | null => (it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt())
      const x = one()
      // routine 125 duplicates the stacked value rather than passing a marker,
      // so the one-argument form really does set both from the same number
      craftTrProportions(rt, x, it.accept(',') ? one() : x)
    },
    /** Tr Set Home x,y — routine 127 ($268a) */
    'tr set home'(it) {
      const p = trParsePair(rt, it)
      craftTrSetHome(rt, p.x, p.y)
    },
    /** Tr Home — routine 128 ($26b4) */
    'tr home': () => craftTrHome(rt),
    /** Tr Remember X — routine 131 ($26fa) */
    'tr remember x': () => craftTrRemember(rt, false),
    /** Tr Remember Y — routine 132 ($2712) */
    'tr remember y': () => craftTrRemember(rt, true),
    /** Tr Remember A — routine 133 ($272a) */
    'tr remember a': () => craftTrRememberA(rt),
    /** Tr Memorize X — routine 134 ($2734) */
    'tr memorize x': () => craftTrMemorize(rt, false),
    /** Tr Memorize Y — routine 135 ($2750) */
    'tr memorize y': () => craftTrMemorize(rt, true),
    /** Tr Memorize A — routine 136 ($276c) */
    'tr memorize a': () => craftTrMemorizeA(rt),
    // ---- fractals ----

    /**
     * Fr Position x,y — routine 139 ($27a8). The plane coordinate of the
     * window's TOP LEFT corner, in units of 1/8192, and both bounded to a
     * signed word. It is also the only thing that sets the "position defined"
     * flag the drawing instructions insist on.
     */
    'fr position'(it) {
      const f = rt.craft.fractal
      const x = frCoord(it.evalInt())
      it.expect(',')
      f.py = frCoord(it.evalInt())
      f.px = x
      f.placed = true
    },

    /**
     * Fr Step xy / Fr Step [xstep],[ystep] — routines 143 and 142 ($2828,
     * $280a).
     *
     * DEFECT: and it takes the whole two-argument form with it. Routine 142
     * stores **d0** into the y step where it means d2, and d0 is the x
     * argument.
     * So `Fr Step 4,8` sets both steps to 4, and `Fr Step ,8` — where d0 is
     * the -1 that means "x omitted" — sets the y step to $ffff, which is
     * 65535 and sixty-four times the 1024 routine 144 just finished
     * enforcing. Only the one-argument form, which sets both from one number
     * on purpose, does what it says. That is presumably why the manual writes
     * `Fr Step xy` first.
     */
    'fr step'(it) {
      const f = rt.craft.fractal
      const x = frStepArg(it)
      if (!it.accept(',')) {
        f.sx = x
        f.sy = x
        return
      }
      const y = frStepArg(it)
      if (x >= 0) f.sx = x
      if (y >= 0) f.sy = x & 0xffff
    },

    /**
     * Fr Window screen / Fr Window [screen,]x,y,width,height — routines 151,
     * 152 and 153 ($294a, $295c, $2974).
     *
     * The one-argument form pushes four omitted markers and falls into the
     * five-argument one, so `Fr Window 2` is `Fr Window 2,,,,` and covers the
     * whole of screen 2. The four-argument form has no screen number and uses
     * the current one. "The x, y, width and height parameters are not checked
     * until a Fr Julia or Fr Mandelbrot instruction is issued" — routine 161
     * is where the clipping happens, and nothing here looks at them.
     */
    'fr window'(it) {
      const first = frWinArg(it)
      if (!it.accept(',')) {
        if ((first >>> 0) >= 8) throw new AmosError(ED_RUN_MESSAGES[50]!, 50)
        const s = rt.screens.get(first)
        if (!s) throw new AmosError(ED_RUN_MESSAGES[47]!, 47)
        frWindowFrom(rt, s, -1, -1, -1, -1)
        rt.craft.fractal.screen = first
        return
      }
      const a = frWinArg(it)
      it.expect(',')
      const b = frWinArg(it)
      it.expect(',')
      const c = frWinArg(it)
      if (!it.accept(',')) {
        // the four-argument form: x,y,width,height on the current screen
        const s = craftScreen(rt)
        frWindowFrom(rt, s, first, a, b, c)
        rt.craft.fractal.screen = rt.currentIndex
        return
      }
      const d = frWinArg(it)
      if ((first >>> 0) >= 8) throw new AmosError(ED_RUN_MESSAGES[50]!, 50)
      const s = rt.screens.get(first)
      if (!s) throw new AmosError(ED_RUN_MESSAGES[47]!, 47)
      frWindowFrom(rt, s, a, b, c, d)
      rt.craft.fractal.screen = first
    },

    /**
     * Fr Scan startline[,height] — routines 156 and 157 ($29f4, $2a08). The
     * one-argument form draws ONE line: `move.w #$1,$2c(a1)`.
     */
    'fr scan'(it) {
      const f = rt.craft.fractal
      const start = frWinArg(it)
      if (!it.accept(',')) {
        f.scanFrom = start
        f.scanLines = 1
        return
      }
      const h = frWinArg(it)
      if (h === 0) illegal()
      const lines = h > 0 ? h : f.scanLines
      if (start >= 0) f.scanFrom = start
      f.scanLines = lines
    },

    /** Fr Scan All — routine 155 ($29e4): line 0 and 16384 of them */
    'fr scan all'() {
      const f = rt.craft.fractal
      f.scanFrom = 0
      f.scanLines = 0x4000
    },

    /**
     * Fr Colour index,col — routine 147 ($287e). Index 0..1024 and colour
     * 0..255; index zero is the colour of a point INSIDE the set.
     */
    'fr colour'(it) {
      const table = frColours(rt)
      const index = it.evalInt()
      it.expect(',')
      const col = it.evalInt()
      if ((col >>> 0) > 0xff) illegal()
      if ((index >>> 0) > 0x400) illegal()
      table[index] = col
    },

    /**
     * Fr Julia cr,ci,iterations — routine 159 ($2a4c). The constant is in the
     * same 1/8192 units as the coordinates and the iteration limit is 1..1024.
     */
    'fr julia'(it) {
      const cr = frCoord(it.evalInt())
      it.expect(',')
      const ci = frCoord(it.evalInt())
      it.expect(',')
      const n = it.evalInt()
      if ((n >>> 0) > 0x400 || n === 0) illegal()
      frRender(rt, n - 1, { cr, ci })
    },

    /**
     * Fr Mandelbrot iterations — routine 160 ($2b8a), "identical to the Fr
     * Julia instruction" except that c comes from the pixel.
     *
     * DEFECT: not quite identical. Julia guards its iteration count with
     * `subq.w #$1,d0 / Rbcs`, which refuses only zero; this one uses `Rbls`,
     * which is carry OR zero, so it refuses ONE as well. `Fr Mandelbrot 1` is
     * error 23 where `Fr Julia 0,0,1` draws.
     */
    'fr mandelbrot'(it) {
      const n = it.evalInt()
      if ((n >>> 0) > 0x400 || n <= 1) illegal()
      frRender(rt, n - 1, null)
    },

    /**
     * Fr Reset — routine 138 ($278e): the window, the position flag and both
     * steps go, the scan band goes back to everything, and the colour table
     * is freed. The position VALUES are left where they are; only the flag
     * that says they mean anything is cleared.
     */
    'fr reset': () => craftFrReset(rt),

    // ---- Workbench, the CLI and the machine ----

    /**
     * Open Workbench — routine 162 ($2d9e). OpenWorkBench, and the result is
     * stashed in `$3c6(a5)` as `seq`, so a screen that opened leaves 0 there
     * and one that did not leaves -1. Nothing in this library reads it back.
     *
     * The name is CONTESTED with AMCAF, whose own is an empty no-op, so both
     * are slot-qualified and a program gets whichever slot it bound.
     */
    'open workbench': () => {
      rt.intuition.openWorkBench()
    },
    /** Wb To Front — routine 163 ($2db6), WBenchToFront */
    'wb to front': () => {
      rt.intuition.wBenchToFront()
    },
    /** Wb To Back — routine 164 ($2dc8), WBenchToBack */
    'wb to back': () => {
      rt.intuition.wBenchToBack()
    },

    /** Cli Execute cmd$ — routine 165 ($2dda) */
    'cli execute': (it) => {
      craftCli(rt, it.evalStr())
    },

    /**
     * Cli Print s$ — routine 166 ($2dfa): Output(), and `beq` straight out if
     * it is zero. A program launched from Workbench has no output handle, so
     * on the machine this does nothing at all — and that is what a program
     * running under this port is, so it does nothing here too. The length
     * comes from the AMOS string's own word, not from a NUL, so an embedded
     * zero is written like any other byte.
     */
    'cli print': (it) => {
      it.evalStr()
    },

    /**
     * Guru Meditation number,extra — routine 167 ($2e18). It does what it
     * says: `bset #$1f,d7` makes the alert a DEADEND one and `jmp -$6c(a6)`
     * is exec's Alert, which never comes back. The second argument is written
     * into the scratch area as the alert's parameter list.
     *
     * A deadend Alert is a crash, so this port treats it as one: the machine
     * is reset the way the two reset keywords ask for it. See ../amiga/
     * machine.ts for what a reset means here.
     */
    'guru meditation'(it) {
      const n = it.evalInt()
      it.expect(',')
      it.evalInt()
      rt.machine.requestReset('cold', `guru meditation $${(n >>> 0).toString(16)}`)
    },

    /*
     * Multi On and Multi Off are routines 174 and 175 ($2ee6, $2ef4) -- exec's
     * Permit at -$8a and Forbid at -$84 -- and are deliberately NOT here. They
     * are n/a for the reason JD's and MISC 1.0's pair already are, recorded in
     * ../coverage/status.ts: there is one task, nothing to forbid, and no
     * keyword in any of the three libraries that reads the nesting back. A
     * handler would be state no program can observe.
     */

    /**
     * Set Amos Pri n — routine 176 ($2f02), SetTaskPri on ThisTask. The bound
     * is written as a round trip rather than a comparison: `move.b d0,d1 /
     * ext.w / ext.l / cmp.l d0,d1 / Rbne routine 206`, so anything that does
     * not survive being cut to a signed byte is error 23.
     */
    'set amos pri'(it) {
      const n = it.evalInt()
      if (((n << 24) >> 24) !== n) illegal()
      rt.craft.system.pri = n
    },

    /**
     * Wb Def Prefs addr,size — routine 178 ($2f36), GetDefPrefs. AMOS routine
     * 431 turns the argument into an address and an odd one is error 25.
     */
    'wb def prefs'(it) {
      const addr = it.evalInt()
      it.expect(',')
      craftPrefsTo(rt, addr, it.evalInt(), true)
    },
    /** Wb Prefs addr,size — routine 179 ($2f58), GetPrefs */
    'wb prefs'(it) {
      const addr = it.evalInt()
      it.expect(',')
      craftPrefsTo(rt, addr, it.evalInt(), false)
    },
    /**
     * Set Wb Prefs addr,size[,realthing] — routines 180 and 181 ($2f7a,
     * $2f82), SetPrefs. The two-argument form pushes -1 for the third, so it
     * is the PERMANENT one: `moveq #$ff,d0 / move.l d0,-(a3)`.
     *
     * DEVIATION: the block is read and discarded. Nothing in this port takes
     * its Workbench palette, its pointer or its printer name from Preferences
     * — ../amiga/intuition.ts reads them off the disk instead — so there is
     * nowhere for a written Preferences to land. The address is still checked,
     * because that check is the extension's and not Intuition's.
     */
    'set wb prefs'(it) {
      const addr = it.evalInt()
      it.expect(',')
      it.evalInt()
      if (it.accept(',')) it.evalInt()
      if ((addr & 1) !== 0) addressError()
    },

    /**
     * Hard Reset / Warm Reset — routines 188 and 189 ($3106, $3122). Disable,
     * Supervisor, `RESET`, and a jump to $2, which is the ROM's entry. The
     * hard one does `clr.l $4.w` first, so the ROM finds no ExecBase and
     * builds a new one: a cold boot rather than a warm one.
     */
    'hard reset': () => rt.machine.requestReset('cold', 'craft hard reset'),
    'warm reset': () => rt.machine.requestReset('warm', 'craft warm reset'),

    /** Tr Exec cmd$[,count] — routines 95 and 96 ($1a48, $1a7c) */
    'tr exec'(it) {
      const src = it.evalStr()
      craftTrExec(rt, src, it.accept(',') ? it.evalInt() : 1)
    },
  }
}

/** Tr Forward and Tr Back, which differ only in the sign of their argument */
function craftTrGo(rt: Runtime, it: Interp, back: boolean): void {
  craftScreen(rt)
  const d = trParseArg(rt, it)
  craftTrForward(rt, back ? trNegArg(rt, d) : d)
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

/*
 * ---- the turtle's fixed point ----
 *
 * Transcribed instruction by instruction rather than rewritten in floating
 * point, because the turtle's position is 16.16 and the line it draws is the
 * INTEGER half of it: a rounding difference of one part in 65536 accumulates
 * over a few hundred steps of a spiral into a pixel somewhere else. Every
 * routine below keeps the original's registers, its word-versus-longword
 * operand sizes and its rounding, and the comments name the address rather
 * than the mathematics.
 *
 * Four pieces. Routine 110 is an integer square root by Newton's method.
 * $2220 is cosine as a Taylor series in 0.16. $21e4 puts those together into
 * sine and cosine for an angle already folded into the first octant, and
 * routine 109's jump table does the folding. Going the other way, $1ffe is
 * arcsine over a coefficient table and routine 106 recovers a heading from
 * the two direction words.
 */

const u16 = (v: number): number => v & 0xffff
const hiw = (v: number): number => Math.floor(v / 0x10000) & 0xffff
/** `lsr.w #1` followed by the `bcc / addq.w #1` that rounds the bit back in */
const halfUp = (v: number): number => u16((v >>> 1) + (v & 1))

/**
 * Routine 110 ($2278) — the integer square root everything else leans on.
 *
 * Newton, seeded by a normalising shift and iterated until two guesses agree:
 * `divu.w d3,d4 / add.w d3,d4 / roxr.w #1,d4 / addx.w d5,d4` is the unsigned
 * mean of the guess and the quotient, with the seventeenth bit carried
 * through X and the odd rounded up. The argument is decremented first, so 0
 * and 1 answer themselves, and $ffffffff answers $10000 — which is how 1.0
 * survives a format with no room for it.
 */
function trSqrt(v: number): number {
  const val = v >>> 0
  if (val <= 1) return val
  const d2 = (val - 1) >>> 0
  if (d2 >= 0xffff0000) return 0x10000
  let d4 = 0xffff
  if ((d2 & 0x8000_0000) === 0) {
    // `asl.l #2,d3 / bvs` — stop as soon as shifting two more bits would
    // reach the sign, and halve the seed for every step it did not
    let d3 = d2
    while ((d3 & 0xe000_0000) === 0) {
      d3 = (d3 << 2) >>> 0
      d4 = (d4 >>> 1) & 0xffff
    }
  }
  let d3 = 0
  // the original spins until the guess stops moving; the bound is far past
  // where a 32-bit Newton settles and exists only so that a `divu.w` which
  // overflows -- the 68000 answers that by leaving its operands alone --
  // cannot hang the interpreter
  for (let i = 0; i < 40; i++) {
    d3 = u16(d4)
    if (d3 === 0) break
    const q = Math.floor(d2 / d3)
    d4 = q > 0xffff ? u16(d2) : q
    const sum = d4 + d3
    d4 = u16(((sum >>> 1) | (sum & 0x1_0000 ? 0x8000 : 0)) + (sum & 1))
    if (d4 === d3) break
  }
  return u16(d3)
}

/**
 * $2220 — cosine of a 0.16 radian angle, as `1 - x²/2 + x⁴/24 - x⁶/720`.
 *
 * Each term is `mulu.w` on the previous one's high word, so every one is a
 * 0.16 value and the series runs out of precision exactly where the format
 * does. The divisors are written as the two steps the code takes: `divu.w #12
 * / lsr.w #1` is 24, and `divu.w #360 / lsr.w #1` is 720.
 */
function trCos(x: number): number {
  // `mulu.w d0,d0 / swap / bpl / addq.w #1` -- the high word, rounded up when
  // the half being discarded had its top bit set
  const sq = u16(x) * u16(x)
  const xx = u16(hiw(sq) + (sq & 0x8000 ? 1 : 0))
  if (xx === 0) return 0x10000
  let d2 = 0x10000 - halfUp(xx)
  let w = hiw(xx * xx)
  if (w === 0) return d2
  d2 += halfUp(Math.floor(w / 12))
  w = hiw(w * xx)
  if (w === 0) return d2
  return d2 - halfUp(Math.floor(w / 360))
}

/**
 * The coefficient table at $208e, read as `mulu.w (a0)+ / divu.w (a0)+ /
 * lsr.w #1` pairs — each entry is `m / 2d`, and the series they feed is
 * arcsine's `x + x³/6 + 3x⁵/40 + 5x⁷/112 + …`.
 *
 * DEFECT: one nibble wide. The fourth pair is 63/1403, and the coefficient it
 * stands for is 63/2816, so the divisor should be 1408 ($580) where the file
 * has 1403 ($57b). The other five are exact. It sits on the eleventh-order
 * term, so nothing drawn can show it — but it is what the table says and it
 * is what this reproduces.
 */
export const CRAFT_ASIN_TABLE = [3, 20, 5, 56, 35, 576, 63, 1403, 231, 6656, 143, 5120]

/**
 * $1ffe — arcsine of a 0.16 value, answered in the same binary angle the
 * heading uses.
 *
 * Nine terms: `x³/6` inline, six from the table, and two written out because
 * their divisors will not fit in a word. The closing `mulu.w #$a2f9 / lsr.l
 * #1 / add.l / lsr.l #2` is the one conversion here that has to be exact --
 * $a2f9 plus a half, over four, is 10430.375, and 2^32 over 2π·65536 is
 * 10430.378.
 */
function trAsinSeries(x: number): number {
  const round = 0x8000
  let d0 = u16(x)
  const xx = hiw(u16(x) * u16(x) + round)
  let w = hiw(u16(x) * xx + round)
  let d3 = halfUp(Math.floor(w / 3))
  if (d3 !== 0) {
    d0 = u16(d0 + d3)
    let running = true
    for (let i = 0; i < 6 && running; i++) {
      w = hiw(w * xx + round)
      d3 = halfUp(Math.floor((w * CRAFT_ASIN_TABLE[i * 2]!) / CRAFT_ASIN_TABLE[i * 2 + 1]!) & 0xffff)
      if (d3 === 0) running = false
      else d0 = u16(d0 + d3)
    }
    if (running) {
      // `mulu.w #$1923 / lsr.l #7 / divu.w #17 / lsr.w #8`, and the same again
      // over 19: the last two coefficients of the series, too big to tabulate
      w = hiw(w * xx + round)
      let q = Math.floor(((w * 0x1923) >>> 7) / 0x11) & 0xffff
      d3 = u16((q >>> 8) + ((q >>> 7) & 1))
      if (d3 !== 0) {
        d0 = u16(d0 + d3)
        w = hiw(w * xx + round)
        q = Math.floor(((w * 0x1923) >>> 8) / 0x13) & 0xffff
        d0 = u16(d0 + u16((q >>> 8) + ((q >>> 7) & 1)))
      }
    }
  }
  const scaled = d0 * 0xa2f9 + (d0 >>> 1)
  return ((scaled / 4) | 0) + ((scaled >>> 1) & 1)
}

/**
 * $1fba — arcsine over the whole quarter turn.
 *
 * Bit 16 set is the magnitude 1.0 a word cannot hold, and answers a right
 * angle directly. Above sin 45° ($b505) the series has run out of accuracy,
 * so it reflects: `mulu.w d0,d0 / neg.l d0` is `1 - x²` in 0.32, because 1.0
 * squared is 2^32 and wraps to nothing, and the root of that is the cosine to
 * take the arcsine of instead.
 */
function trAsin(x: number): number {
  if ((x & 0x1_0000) !== 0) return 0x4000_0000
  if (u16(x) >= 0xb505) return (0x4000_0000 - trAsinSeries(trSqrt(-(u16(x) * u16(x)) >>> 0))) | 0
  return x === 0 ? 0 : trAsinSeries(x)
}

/**
 * $21e4 — sine and cosine for an angle already folded into 0..45°.
 *
 * `asl.l #3` scales the octant across the whole longword and the multiply by
 * $c90fdaa2, which is π/4, turns it into 0.16 radians; exactly 45° overflows
 * that shift and is answered with the constant $c910 instead. Cosine then
 * comes from the series and sine from `sqrt(1 - cos²)` through the same 0.32
 * wrap the arcsine uses.
 */
function trSinCos8(a: number): { sin: number; cos: number } {
  let x: number
  if ((a >>> 0) >= 0x2000_0000) x = 0xc910
  else {
    const b = hiw((a << 3) >>> 0)
    const lo = b * 0xc90f + Math.floor((b * 0xdaa2) / 0x10000)
    x = u16(hiw(lo) + (lo & 0x8000 ? 1 : 0))
  }
  const cos = trCos(x)
  if (cos === 0) return { sin: 0x10000, cos: 0 }
  return { sin: trSqrt(-(u16(cos) * u16(cos)) >>> 0), cos }
}

/** flip the sign bit of a sign-magnitude direction word */
const trNeg = (v: number): number => (v ^ 0x8000_0000) >>> 0

/**
 * Routine 109's fold ($2138) — eight cases over the sign of the heading and
 * which quarter it lands in, each a swap of sine for cosine and a `bchg
 * #$1f` or two.
 *
 * The answer is dx = sin and dy = MINUS cos, which is why a heading of zero
 * comes out (0, -1): the turtle faces north, the screen's y grows downwards,
 * and the LOGO convention and the hardware agree with nothing negated later.
 * Tr Reset caches exactly that pair, `clr.l $34 / move.l #$80010000,$38`,
 * which is what confirms the format from the other end.
 */
function trDirection(angle: number): { dx: number; dy: number } {
  const a = angle | 0
  const m = (a < 0 ? -a : a) >>> 0
  const flip = a < 0
  let dx: number
  let dy: number
  if (m > 0x6000_0000) {
    const r = trSinCos8((-((m - 0x8000_0000) | 0)) >>> 0)
    dx = r.sin
    dy = r.cos
  } else if (m > 0x4000_0000) {
    const r = trSinCos8((m - 0x4000_0000) >>> 0)
    dx = r.cos
    dy = r.sin
  } else if (m > 0x2000_0000) {
    const r = trSinCos8((-((m - 0x4000_0000) | 0)) >>> 0)
    dx = r.cos
    dy = trNeg(r.sin)
  } else {
    const r = trSinCos8(m)
    dx = r.sin
    dy = trNeg(r.cos)
  }
  // a negative heading is the positive one mirrored about the vertical: each
  // of the four cases below the `tst.l d0 / bpl` carries ONE extra `bchg
  // #$1f,d0` over its positive twin and none of them touches d1
  return flip ? { dx: trNeg(dx), dy } : { dx, dy }
}

/**
 * Routine 101 ($1e10) — degrees to the turtle's binary angle.
 *
 * `divs.w #360` first and the remainder pulled into -180..179, which is the
 * manual's "there is no difference between using 180 or 540 (360+180)". The
 * scale is `$b60b << 8` plus `$c16c >> 9`, and that pair is 11930464.7 --
 * 2^32 over 360 to eight figures.
 */
function trDegToBam(deg: number): number {
  let d1 = (deg | 0) % 360
  if (d1 < -180) d1 += 360
  else if (d1 >= 180) d1 -= 360
  const neg = d1 < 0
  const m = u16(neg ? -d1 : d1)
  const v = (m * 0xb60b * 256 + halfUpLong(Math.floor((m * 0xc16c) / 256))) | 0
  return (neg ? -v : v) | 0
}

/** `lsr.l #1 / bcc / addq.l #1` -- the longword half the degree scale rounds */
const halfUpLong = (v: number): number => Math.floor(v / 2) + (v & 1)

/**
 * Routine 100 ($1dee) — the binary angle back to degrees, and the inverse is
 * NOT the same constant: `asr.l #2 / divs.w #$5b06 / asr.w #7` divides by
 * 11930624 where routine 101 multiplied by 11930464.7. Thirteen parts in a
 * million, well under the one degree the answer is rounded to.
 *
 * The last two instructions are the manual's promise: -180 becomes +180, so
 * "the result is always in the range -179 to 180 inclusive".
 */
function trBamToDeg(bam: number): number {
  const q = (((bam | 0) >> 2) / 0x5b06) | 0
  const s = q >> 7
  const w = ((s >= 0 && (q & 0x40) !== 0 ? s + 1 : s) << 16) >> 16
  return w === -180 ? 180 : w
}

/* ---- the turtle's state, and the keywords over it ---- */

const trFlag = (v: DataView, b: number): boolean => (v.getUint8(TR.flags) & (1 << b)) !== 0
const trSetFlag = (v: DataView, b: number): void => v.setUint8(TR.flags, v.getUint8(TR.flags) | (1 << b))
const trClrFlag = (v: DataView, b: number): void => v.setUint8(TR.flags, v.getUint8(TR.flags) & ~(1 << b))
/** the integer half of a 16.16 coordinate, which is the pixel it draws on */
const trWhole = (v: number): number => v >> 16

/**
 * Routine 98 ($1da2) — Tr Reset, and the initial state of everything.
 *
 * `move.b #$3,$2e(a1)` is the interesting instruction: it sets the two
 * "which representation is live" bits and CLEARS the rest, so the pen goes
 * DOWN (bit 2 clear is down), the position is forgotten and will be taken
 * from the screen again, the proportions switch off, and the Tr Remember
 * slots are dropped. The proportion VALUES at $4c/$50 are not touched, so a
 * later Tr Proportions with one parameter can still see the old other half.
 */
export function craftTrReset(rt: Runtime): void {
  trResetBlock(rt.craft.turtle)
}

/**
 * The same, over the bytes alone, because a fresh CraftState needs it too:
 * AMOS runs every extension's Default entry before a program starts, so the
 * flags are already 3 by the time the first keyword sees them and a turtle
 * with a zeroed block is a state the machine never presents.
 */
function trResetBlock(t: DataView): void {
  t.setUint8(TR.flags, 3)
  t.setInt32(TR.angle, 0)
  t.setUint32(TR.dx, 0)
  t.setUint32(TR.dy, 0x8001_0000)
  t.setUint8(TR.patCnt, 0xf)
  t.setUint8(TR.frstDot, 1)
  t.setInt32(TR.left, 0)
  t.setInt32(TR.remA, 0)
}

/**
 * Routine 113 ($22d4) — where the turtle is, placing it first if it has never
 * been anywhere.
 *
 * A turtle with bit 3 clear is put in the middle of the current screen, or at
 * 160,100 if none is open, with a fraction of $8000 — half a pixel, so the
 * turtle stands in the middle of one rather than on its corner and a step of
 * half a pixel either way still rounds to where it started. The home is set
 * to the same place, which is the manual's "the coordinates of the home are
 * in the middle of the screen by default".
 */
function craftTrPos(rt: Runtime): { x: number; y: number } {
  const t = rt.craft.turtle
  if (trFlag(t, TRF_PLACED)) return { x: t.getInt32(TR.x), y: t.getInt32(TR.y) }
  trSetFlag(t, TRF_PLACED)
  const s = rt.screens.get(rt.currentIndex)
  const x = (((s ? s.width >> 1 : 0xa0) & 0xffff) << 16) | 0x8000
  const y = (((s ? s.height >> 1 : 0x64) & 0xffff) << 16) | 0x8000
  t.setInt32(TR.x, x | 0)
  t.setInt32(TR.y, y | 0)
  t.setInt32(TR.homeX, x | 0)
  t.setInt32(TR.homeY, y | 0)
  return { x: x | 0, y: y | 0 }
}

/**
 * Routine 109 ($2106) — the heading as a pair of steps, computed from $30 if
 * the sine and cosine on hand are stale.
 *
 * The pair of `bset`/`btst` at the top is the whole design of this group:
 * $30 and $34/$38 are two spellings of one heading and each is recomputed
 * from the other only when someone asks for it. A turtle with NEITHER bit set
 * has never been touched, and this is where `Tr Reset` runs for it.
 */
function craftTrDir(rt: Runtime): { dx: number; dy: number } {
  const t = rt.craft.turtle
  if (trFlag(t, TRF_DIR)) return { dx: t.getUint32(TR.dx), dy: t.getUint32(TR.dy) }
  trSetFlag(t, TRF_DIR)
  if (!trFlag(t, TRF_ANGLE)) craftTrReset(rt)
  const d = trDirection(t.getInt32(TR.angle))
  t.setUint32(TR.dx, d.dx)
  t.setUint32(TR.dy, d.dy)
  return d
}

/**
 * Routine 106 ($1f56) — the heading as an angle, computed from the two steps
 * if the angle on hand is stale.
 *
 * The quadrant comes out of the two sign bits and the size out of one
 * arcsine, which is enough because the pair is always a unit vector. It reads
 * dy's sign with `tst.w $38(a1)` — a WORD test on the high half of the
 * longword, which only makes sense for sign-magnitude and is the second
 * witness for that format.
 */
function craftTrAngle(rt: Runtime): number {
  const t = rt.craft.turtle
  if (trFlag(t, TRF_ANGLE)) return t.getInt32(TR.angle)
  trSetFlag(t, TRF_ANGLE)
  if (!trFlag(t, TRF_DIR)) craftTrReset(rt)
  const dx = t.getUint32(TR.dx)
  const south = (t.getUint32(TR.dy) & 0x8000_0000) === 0
  const west = (dx & 0x8000_0000) !== 0
  const a = trAsin(dx & 0x7fff_ffff)
  const v = south ? (west ? a - 0x8000_0000 : 0x8000_0000 - a) : west ? -a : a
  t.setInt32(TR.angle, v | 0)
  return v | 0
}

/**
 * Routine 217 ($3328) — the failure every out-of-range turtle argument takes,
 * and the one place bit 4 of the flags is read.
 *
 * Inside `Tr Exec` it is CRAFT's own "Turtle error: illegal function call";
 * outside it is AMOS error 23. `bclr` rather than `btst`, so the bit is spent
 * on the way through and a second failure in the same string reports as the
 * plain AMOS one.
 */
function craftTrRange(rt: Runtime): never {
  const t = rt.craft.turtle
  const inTcl = trFlag(t, TRF_TCL)
  trClrFlag(t, TRF_TCL)
  if (!inTcl) illegal()
  return craftError(5)
}

/** an argument as routine 118 ($23a4) leaves it: 16.16, or the omitted marker */
interface TrArg {
  /** the value shifted into 16.16; zero when omitted */
  v: number
  omitted: boolean
}

/**
 * Routine 118 ($23a4) — every coordinate and distance in the group goes
 * through it.
 *
 * $80000000, AMOS's marker for a parameter written as nothing, comes back
 * with the carry set and a value of zero. Everything else is bounded
 * -32767..32767 by a pair of unsigned compares and shifted up sixteen bits.
 * NOTE the bound is not symmetric with a word: `cmpi.l #$ffff8001,d0 / bcc`
 * admits -32767 and below that falls through to `cmpi.l #$8000,d0 / Rbcc`,
 * so -32768 is rejected where -32767 is fine.
 */
function trArgOf(rt: Runtime, raw: number, omitted: boolean): TrArg {
  if (omitted) return { v: 0, omitted: true }
  if (raw < -32767 || raw > 32767) craftTrRange(rt)
  return { v: (raw << 16) | 0, omitted: false }
}

/** the same, read straight out of the token stream */
function trParseArg(rt: Runtime, it: Interp): TrArg {
  if (it.atStmtEnd() || it.nm() === ',') return { v: 0, omitted: true }
  return trArgOf(rt, it.evalInt(), false)
}

/** `x,y` -- the pair Tr Move, Tr Draw, Tr Set Home and the Rel forms all take */
function trParsePair(rt: Runtime, it: Interp): { x: TrArg; y: TrArg } {
  const x = trParseArg(rt, it)
  it.expect(',')
  return { x, y: trParseArg(rt, it) }
}

/** the screen-mode bits routines 105 and $246e read out of `$48(a0)`: HIRES and LACE */
function trMode(rt: Runtime): number {
  const s = rt.screens.get(rt.currentIndex)
  if (!s) return 0
  return (s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0)
}

/**
 * $24aa — the 16.16 by 16.16 multiply Tr Proportions is applied with, built
 * out of three `mulu.w`s and a `muls.w` with the signs handled by hand.
 */
function trMulFix(a: number, b: number): number {
  const aLo = u16(a)
  const bLo = u16(b)
  const bHi = (b >>> 16) & 0xffff
  const d7 = Math.floor((bLo * aLo + 0x8000) / 0x10000)
  const d5 = a < 0 ? -((((-a) >>> 16) & 0xffff) * bLo) : ((a >>> 16) & 0xffff) * bLo
  const d6 = bHi & 0x8000 ? -(u16(0x10000 - bHi) * aLo) : bHi * aLo
  const hh = u16((a >> 16) * (b >> 16))
  return (((hh << 16) | 0) + d5 + d6 + d7) | 0
}

/**
 * $246e — the aspect correction and the proportions, in that order.
 *
 * A hires screen's pixels are half as wide as the square ones the turtle
 * thinks in, so a step across gets doubled; an interlaced one's are half as
 * tall, so a step down does. A screen that is both gets neither, and that is
 * right: hires interlaced pixels are square again.
 */
function trScale(rt: Runtime, dx: number, dy: number): { dx: number; dy: number } {
  const t = rt.craft.turtle
  const mode = trMode(rt)
  let x = dx
  let y = dy
  if (mode === 0x8000) x = (x + x) | 0
  else if (mode === 4) y = (y + y) | 0
  if (trFlag(t, TRF_PROP)) {
    x = trMulFix(x, t.getInt32(TR.propX))
    y = trMulFix(y, t.getInt32(TR.propY))
  }
  return { dx: x, dy: y }
}

/**
 * Routine 105 ($1f3a) — the same aspect correction the other way round, for
 * Tr Towards and Tr Distance, which start from a screen delta and want a
 * square one.
 *
 * DEFECT: and a clear one, because the same eight instructions are written
 * correctly at $246e. The hires test loads the screen mode into d4 and then
 * the interlace test reads **d3**, which the caller left holding half the
 * turtle's current y. So the interlace half of this correction never fires
 * for any y that is not exactly 3, and `Tr Towards` on an interlaced screen
 * aims at the wrong point. The register is reproduced rather than repaired —
 * a caller's d3 goes in and the same comparison is made against it.
 */
function trUnscale(rt: Runtime, dx: number, dy: number, d3: number): { dx: number; dy: number } {
  const mode = trMode(rt)
  if (mode === 0x8000) return { dx: dx >> 1, dy }
  if (u16(d3) === 3) return { dx, dy: dy >> 1 }
  return { dx, dy }
}

/**
 * Routine 119 ($23d2) — every step the turtle takes ends here: scale the
 * delta, add it to the position, and draw the segment if the caller asked.
 *
 * `d2` carries three things at once, which is why the callers set it to
 * -1, 0, 1 and $ff rather than a flag. NEGATIVE skips the scaling, because an
 * absolute Tr Draw has already worked in screen pixels; ZERO means do not
 * draw; anything else draws.
 *
 * The line goes out as `Move` then `Draw` on graphics.library with the
 * RastPort's dash state managed by hand around it, which is what `$54` and
 * `$55` in the block are for — see craftTrLine.
 */
function craftTrStep(rt: Runtime, dx: number, dy: number, mode: number): void {
  const t = rt.craft.turtle
  const d = mode < 0 ? { dx, dy } : trScale(rt, dx, dy)
  const from = craftTrPos(rt)
  const to = { x: (from.x + d.dx) | 0, y: (from.y + d.dy) | 0 }
  t.setInt32(TR.x, to.x)
  t.setInt32(TR.y, to.y)
  if ((mode & 0xffff) === 0) {
    t.setUint8(TR.patCnt, 0xf)
    t.setUint8(TR.frstDot, 1)
    return
  }
  craftTrLine(rt, trWhole(from.x), trWhole(from.y), trWhole(to.x), trWhole(to.y))
}

/**
 * The drawing half of routine 119, and the two bytes of RastPort state the
 * turtle carries between segments.
 *
 * `$55` is FRST_DOT in rp_Flags: 1 for the first line after a jump and 0
 * afterwards, so a chain of turtle segments does not plot its joins twice.
 * `$54` is meant to be rp_linpatcnt, so that a `Set Line` dash runs unbroken
 * along a turtle path. It does not work, and the reason is one byte wide:
 * routine 119 writes it to `$1f(a1)` and reads it back from there, and
 * rp_linpatcnt is at $1e — $1f is the `dummy` field graphics.library ignores.
 * So `$54` round-trips through a hole and is always $f. It is kept here
 * because =Tr Base publishes it and a program can read it.
 *
 * The dash still continues, because graphics.library's `Draw` carries
 * rp_linpatcnt on its own and nothing here resets it; that is `linePtrnCont`
 * below. What the routine does do to it is the second half of the same slip:
 * the restore is `andi.l #$ff00fffe / or.l d6`, which KEEPS the counter the
 * draw left and ORs the one from before it back on top, so a Set Line phase
 * comes out of a turtle segment with bits from both.
 *
 * DEVIATION: FRST_DOT is not modelled. This port's Bresenham always plots the
 * first pixel, so a chained segment's join is drawn twice. With the default
 * solid pattern that is the same pixel in the same colour and invisible; with
 * a Set Line dash it advances the phase one step further than the machine.
 */
function craftTrLine(rt: Runtime, x0: number, y0: number, x1: number, y1: number): void {
  const t = rt.craft.turtle
  const s = craftScreen(rt)
  const before = s.rp.linePatCnt
  const cont = s.rp.linePtrnCont
  s.rp.linePtrnCont = true
  s.line(x0, y0, x1, y1)
  s.rp.linePatCnt = s.rp.linePatCnt | before
  s.rp.linePtrnCont = cont
  t.setUint8(TR.frstDot, 0)
}

/**
 * Routine 114 ($2326) — Tr Move, which is the only mover that does not go
 * through routine 119: it writes the position outright, so no aspect and no
 * proportions.
 *
 * "Either parameter may be omitted, just remember to write the comma", and
 * the omitted halves fall back correctly here: an omitted y is still in d1
 * from routine 113 and an omitted x is reloaded from $3c. Tr Draw and Tr Set
 * Home both try the same trick and both get it wrong; see their notes.
 */
function craftTrMove(rt: Runtime, x: TrArg, y: TrArg): void {
  const t = rt.craft.turtle
  const cur = craftTrPos(rt)
  const ny = y.omitted ? cur.y : (y.v & ~0xffff) | 0x8000
  const nx = x.omitted ? t.getInt32(TR.x) : (x.v & ~0xffff) | 0x8000
  t.setInt32(TR.x, nx | 0)
  t.setInt32(TR.y, ny | 0)
  t.setUint8(TR.patCnt, 0xf)
  t.setUint8(TR.frstDot, 1)
}

/**
 * Routine 116 ($236c) — Tr Draw, which turns the absolute target into a delta
 * and hands it to routine 119 with the scaling switched off.
 *
 * DEFECT: an omitted y is not handled. Routine 118 answers an omission by
 * zeroing **d0**, and the subtraction that would have made d1 a delta is
 * skipped along with it — so d1 is still the CURRENT y that routine 113 left
 * there, and routine 119 adds it to the position. `Tr Draw 100,` draws to
 * twice the current y. An omitted x is fine, because there d0 really is the
 * zero that makes the delta nothing. Tr Move next door, which assigns instead
 * of subtracting, gets both right.
 */
function craftTrDraw(rt: Runtime, x: TrArg, y: TrArg): void {
  const t = rt.craft.turtle
  const cur = craftTrPos(rt)
  const dy = y.omitted ? cur.y : (((y.v & ~0xffff) | 0x8000) - t.getInt32(TR.y)) | 0
  const dx = x.omitted ? 0 : (((x.v & ~0xffff) | 0x8000) - t.getInt32(TR.x)) | 0
  craftTrStep(rt, dx, dy, -1)
}

/**
 * Routine 107 ($20a6) — Tr Forward, the multiply that turns a heading and a
 * distance into a step.
 *
 * The sign handling is the part worth keeping: `neg.w d3` leaves the DISTANCE
 * negative in the high word while making the low word positive, so `eor.l
 * d3,d2` against the sign-magnitude direction gives the sign of the product
 * in one bit 31 without either operand having been converted. `btst #$10` is
 * the magnitude of exactly 1.0, which `mulu.w` cannot see because it lives in
 * bit 16 — that case shifts the distance up instead of multiplying.
 */
function craftTrForward(rt: Runtime, arg: TrArg): void {
  const t = rt.craft.turtle
  const dir = craftTrDir(rt)
  const dist = arg.v >> 16
  // the high word keeps the sign while the low word carries the magnitude
  const d3 = dist < 0 ? (0xffff_0000 | u16(-dist)) >>> 0 : dist
  const gun = (v: number): number => {
    const mag = (v & 0x1_0000) !== 0 ? (u16(d3) << 16) >>> 0 : u16(d3) * u16(v)
    return ((v ^ d3) & 0x8000_0000) !== 0 ? -mag | 0 : mag | 0
  }
  craftTrStep(rt, gun(dir.dx), gun(dir.dy), trFlag(t, TRF_PENUP) ? 0 : 0xff)
}

/**
 * Routine 104 ($1e7a) — Tr Towards, which points the turtle at a place
 * instead of at an angle.
 *
 * Both ends are halved before the subtraction so the difference cannot
 * overflow, then the delta is normalised onto a unit vector by dividing both
 * halves by their own length — `divu.w d2,d0` twice over the root from
 * routine 110 — and stored as the direction, leaving the ANGLE stale for
 * routine 106 to work out if anybody asks. A target the turtle is already
 * standing on turns it not at all.
 */
function craftTrTowards(rt: Runtime, x: TrArg, y: TrArg): void {
  const cur = craftTrPos(rt)
  const d2 = cur.x >> 1
  const d3 = cur.y >> 1
  let d0 = ((((x.v & ~0xffff) | 0x8000) >> 1) - d2) | 0
  let d1 = ((((y.v & ~0xffff) | 0x8000) >> 1) - d3) | 0
  if (d0 === 0 && d1 === 0) return
  const sc = trUnscale(rt, d0, d1, d3)
  d0 = sc.dx
  d1 = sc.dy
  const d6 = d0
  const d7 = d1
  let a = Math.abs(d0) >>> 0
  let b = Math.abs(d1) >>> 0
  // `lsl.l #1` on each in turn with the carry undoing it: both go up together
  // until ONE of them would lose its top bit, so the squares below keep as
  // many significant digits as a longword has room for
  while ((a & 0x8000_0000) === 0 && (b & 0x8000_0000) === 0) {
    a = (a << 1) >>> 0
    b = (b << 1) >>> 0
  }
  if (hiw(a) === 0) {
    trStoreDir(rt, 0, 0x10000, d6, d7)
    return
  }
  if (hiw(b) === 0) {
    trStoreDir(rt, 0x10000, 0, d6, d7)
    return
  }
  let sq = hiw(a) * hiw(a) + hiw(b) * hiw(b)
  if (sq > 0xffff_ffff) {
    sq = trHalfCarry(sq)
    a = a >>> 1
    b = b >>> 1
  }
  const len = trSqrt(sq)
  // `btst #$10,d2` — a length of exactly 1.0 skips both divisions, and the
  // `swap / clr.w / swap` that follows keeps the low word either way
  if ((len & 0x1_0000) === 0) {
    a = trDivW(a, len)
    b = trDivW(b, len)
  }
  trStoreDir(rt, a & 0xffff, b & 0xffff, d6, d7)
}

/** `add.l / bcs / roxr.l #1 / lsr.l #1` — the 33-bit sum brought back into 30 bits */
const trHalfCarry = (sum: number): number => ((0x8000_0000 | ((sum % 0x1_0000_0000) >>> 1)) >>> 1) >>> 0

/** `divu.w`, which on a quotient too big for a word leaves its operand alone */
function trDivW(v: number, by: number): number {
  const q = Math.floor(v / by)
  return q > 0xffff ? v : q
}

/** the tail of routine 104: put the signs back on and mark the angle stale */
function trStoreDir(rt: Runtime, dx: number, dy: number, sx: number, sy: number): void {
  const t = rt.craft.turtle
  t.setUint32(TR.dx, sx < 0 ? (dx | 0x8000_0000) >>> 0 : dx)
  t.setUint32(TR.dy, sy < 0 ? (dy | 0x8000_0000) >>> 0 : dy)
  trSetFlag(t, TRF_DIR)
  trClrFlag(t, TRF_ANGLE)
}

/**
 * Routine 121 ($2580) — =Tr Distance, Pythagoras over the same normalising
 * shift Tr Towards uses, with the shift count in d6 undone at the end.
 *
 * It goes through routine 105, so it inherits that routine's interlace bug:
 * the vertical half of the aspect correction is tested against a register the
 * caller left the turtle's y in.
 */
function craftTrDistance(rt: Runtime, x: TrArg, y: TrArg): number {
  const cur = craftTrPos(rt)
  const d2 = cur.x >> 1
  const d3 = cur.y >> 1
  let d0 = Math.abs(((((x.v & ~0xffff) | 0x8000) >> 1) - d2) | 0) >>> 0
  let d1 = Math.abs(((((y.v & ~0xffff) | 0x8000) >> 1) - d3) | 0) >>> 0
  const sc = trUnscale(rt, d0 | 0, d1 | 0, d3)
  d0 = sc.dx >>> 0
  d1 = sc.dy >>> 0
  /*
   * DEFECT: and a hard one. The normalising loop is `lsl.l #1,d0 / bcs / lsl.l
   * #1,d1 / bcc` back on itself, with nothing to stop it if BOTH are zero. A
   * carry can never appear, so `Tr Distance(Tr X Pos, Tr Y Pos)` — the
   * distance from the turtle to where it is standing — locks the machine up.
   * Tr Towards, which normalises the same way, tests for the zero pair first
   * and returns; routine 121 does not.
   *
   * DEVIATION: a port cannot reproduce a hang, so this answers 0. It is the
   * value the arithmetic would reach if the loop terminated.
   */
  if (d0 === 0 && d1 === 0) return 0
  // d6 counts the normalising shifts, one behind because `addq.l #1,d6` runs
  // at the top of the loop and the last pass shifts nothing
  let d6 = -2
  for (;;) {
    d6++
    if ((d0 & 0x8000_0000) !== 0 || (d1 & 0x8000_0000) !== 0) break
    d0 = (d0 << 1) >>> 0
    d1 = (d1 << 1) >>> 0
  }
  let sq = hiw(d0) * hiw(d0) + hiw(d1) * hiw(d1)
  if (sq > 0xffff_ffff) {
    sq = trHalfCarry(sq)
    d6--
  }
  const r = trSqrt(sq)
  const out = d6 < 0 ? (r << -d6) >>> 0 : r >>> d6
  const lost = d6 > 0 && (r & (1 << (d6 - 1))) !== 0
  return (out + (lost ? 1 : 0)) | 0
}

/**
 * Routine 127 ($268a) — Tr Set Home.
 *
 * DEFECT: the two fallbacks for an omitted parameter are CROSSED. The first
 * value off the stack is y and its fallback loads `$44`, the home X; the
 * second is x and its fallback loads `$48`, the home Y. So `Tr Set Home 10,`
 * moves the home's y onto the old home's x, and `Tr Set Home ,20` does the
 * mirror of it. Routine 114 next door reaches the same "keep what was there"
 * by a different route and gets it right, which is what makes this a slip
 * rather than a design.
 */
function craftTrSetHome(rt: Runtime, x: TrArg, y: TrArg): void {
  const t = rt.craft.turtle
  craftTrPos(rt)
  const d1 = y.omitted ? t.getInt32(TR.homeX) : y.v
  const d0 = x.omitted ? t.getInt32(TR.homeY) : x.v
  t.setInt32(TR.homeX, ((d0 & ~0xffff) | 0x8000) | 0)
  t.setInt32(TR.homeY, ((d1 & ~0xffff) | 0x8000) | 0)
}

/**
 * Routine 128 ($26b4) — Tr Home: the angle back to zero and a Tr Move onto
 * the home coordinates.
 *
 * DEFECT: the coordinates are handed to Tr Move as `moveq #0,d0 / move.w
 * $44(a1),d0`, which ZERO-extends the integer half. A home with a negative
 * coordinate therefore arrives at routine 118 as 32768 or more and is thrown
 * out — so `Tr Set Home -10,50` followed by `Tr Home` is error 23 rather than
 * a move. Everything else in the group treats a negative coordinate as
 * ordinary.
 */
function craftTrHome(rt: Runtime): void {
  const t = rt.craft.turtle
  craftTrPos(rt)
  const hx = (t.getInt32(TR.homeX) >>> 16) & 0xffff
  t.setInt32(TR.angle, 0)
  trSetFlag(t, TRF_ANGLE)
  trClrFlag(t, TRF_DIR)
  const hy = (t.getInt32(TR.homeY) >>> 16) & 0xffff
  craftTrMove(rt, trArgOf(rt, hx, false), trArgOf(rt, hy, false))
}

/**
 * Routines 131 and 132 ($26fa, $2712) — Tr Remember X and Y, and the one
 * thing they do beyond storing: the FIRST of them to run also primes the
 * OTHER slot from the matching home coordinate, so a Tr Memorize Y after only
 * a Tr Remember X puts the turtle on the home's y rather than on nothing.
 */
function craftTrRemember(rt: Runtime, wantY: boolean): void {
  const t = rt.craft.turtle
  const p = craftTrPos(rt)
  t.setInt32(wantY ? TR.remY : TR.remX, wantY ? p.y : p.x)
  if (trFlag(t, TRF_REM)) return
  trSetFlag(t, TRF_REM)
  t.setInt32(wantY ? TR.remX : TR.remY, t.getInt32(wantY ? TR.homeX : TR.homeY))
}

/** Routines 134 and 135 ($2734, $2750): the slot, or the home if nothing was ever remembered */
function craftTrMemorize(rt: Runtime, wantY: boolean): void {
  const t = rt.craft.turtle
  craftTrPos(rt)
  const from = trFlag(t, TRF_REM) ? (wantY ? TR.remY : TR.remX) : wantY ? TR.homeY : TR.homeX
  t.setInt32(wantY ? TR.y : TR.x, t.getInt32(from))
}

/**
 * Routine 126 ($2628) — Tr Proportions x[,y].
 *
 * "The limits of the parameters are -16 to 16 inclusive, and zero is not
 * allowed", and the check is exactly that pair of unsigned compares. An
 * omitted parameter leaves that coefficient alone; the ONE-argument form
 * (routine 125) is `move.l (a3),-(a3)`, which duplicates the stacked value so
 * both coefficients get it — "the x coefficient is used for the both
 * coordinates".
 *
 * The flag at bit 5 is recomputed from the pair afterwards rather than set,
 * so putting both back to 1 switches the scaling off again and costs nothing.
 */
function craftTrProportions(rt: Runtime, xs: number | null, ys: number | null): void {
  const t = rt.craft.turtle
  const one = (v: number | null): number => {
    if (v === null) return 0
    if (v === 0) craftTrRange(rt)
    if (v < -16 || v > 16) craftTrRange(rt)
    return (v << 16) | 0
  }
  const py = one(ys)
  const px = one(xs)
  if (px !== 0) t.setInt32(TR.propX, px)
  if (py !== 0) t.setInt32(TR.propY, py)
  if (t.getInt32(TR.propX) === 0x10000 && t.getInt32(TR.propY) === 0x10000) trClrFlag(t, TRF_PROP)
  else trSetFlag(t, TRF_PROP)
}

/** Routine 99 ($1dd2) — Tr Angle: the heading outright, leaving the direction stale */
function craftTrSetAngle(rt: Runtime, deg: number): void {
  const t = rt.craft.turtle
  t.setInt32(TR.angle, trDegToBam(deg))
  trSetFlag(t, TRF_ANGLE)
  trClrFlag(t, TRF_DIR)
}

/**
 * Routine 103 ($1e62) — Tr Right, and Tr Left through it: routine 102 is
 * `neg.l (a3) / Rbra routine 103`, negating the argument where it sits on the
 * stack rather than duplicating the routine.
 */
function craftTrTurn(rt: Runtime, deg: number): void {
  const t = rt.craft.turtle
  const a = craftTrAngle(rt)
  t.setInt32(TR.angle, (a + trDegToBam(deg)) | 0)
  trClrFlag(t, TRF_DIR)
}

/** Routine 108 ($2100) — Tr Back, `neg.l (a3)` in front of Tr Forward */
function trNegArg(rt: Runtime, a: TrArg): TrArg {
  return a.omitted ? a : trArgOf(rt, -(a.v >> 16), false)
}

/** Routine 133 ($272a) — Tr Remember A. It does NOT set the remembered flag */
function craftTrRememberA(rt: Runtime): void {
  rt.craft.turtle.setInt32(TR.remA, craftTrAngle(rt))
}

/** Routine 136 ($276c) — Tr Memorize A, which reads a slot Tr Reset zeroes */
function craftTrMemorizeA(rt: Runtime): void {
  const t = rt.craft.turtle
  t.setInt32(TR.angle, t.getInt32(TR.remA))
  trSetFlag(t, TRF_ANGLE)
  trClrFlag(t, TRF_DIR)
}

/**
 * Routine 95 ($1a48) — Tr Exec's repeat count. "If the count is specified,
 * the string is executed several (0-2000) times", and the guard is `cmpi.l
 * #$7d0,d0 / Rbhi routine 206` — UNSIGNED, so a negative count is a large
 * one and error 23 rather than nothing. A count of zero runs the string not
 * at all, because `subq.l #1,d0 / bcs` leaves before the first pass.
 */
function craftTrExec(rt: Runtime, src: string, count: number): void {
  if ((count >>> 0) > 2000) illegal()
  for (let i = 0; i < count; i++) craftTclRun(rt, src)
}

/* ---- TCL, the Turtle Control Language ---- */

/** the cursor routine 96 keeps in a0 and d7 */
interface TclCursor {
  s: string
  i: number
  n: number
}

/** error 4, "Turtle error: bad syntax" -- $1ac6, which spends the TCL bit first */
function tclSyntax(rt: Runtime): never {
  trClrFlag(rt.craft.turtle, TRF_TCL)
  return craftError(4)
}

/** error 6, "Turtle error: illegal number of parameters" -- $1ad6 */
function tclArity(rt: Runtime): never {
  trClrFlag(rt.craft.turtle, TRF_TCL)
  return craftError(6)
}

/**
 * $1ada — collect one command name.
 *
 * At most TWO capitals, because that is the longest name in the table; the
 * lower case after them is skipped, which is how `Forward` and `F` are the
 * same command and what the manual means by "only capital letters are
 * necessary in command names". A name ends at a space, a semicolon, a sign,
 * a comma or a digit, and anything else is a syntax error.
 *
 * The odd instruction is the one that shortens `H` to a single letter. There
 * is no two-letter command beginning with H, so allowing a second capital
 * could only ever produce a name that is not in the table; cutting it short
 * lets `H` butt straight up against the next command. It also means that
 * HOME spelled in full capitals parses as `H` and then tries to read `OM` as
 * the next command, which is a syntax error — the manual's "only capital
 * letters are NECESSARY" turns out to be load-bearing.
 */
function tclWord(rt: Runtime, c: TclCursor): string {
  let ch = 0
  for (;;) {
    if (c.i >= c.n) return ''
    ch = c.s.charCodeAt(c.i++)
    if (ch <= 0x20 || ch === 0x3b) continue
    break
  }
  if (ch < 0x41 || ch > 0x5a) tclSyntax(rt)
  let out = ''
  let room = 2
  for (;;) {
    room--
    if (room < 0) {
      c.i--
      return out
    }
    out += String.fromCharCode(ch)
    if (ch === 0x48 && room === 1) room--
    let next = 0
    for (;;) {
      if (c.i >= c.n) return out
      next = c.s.charCodeAt(c.i++)
      if (next <= 0x20 || next === 0x3b || (next >= 0x2b && next <= 0x2d) || (next >= 0x30 && next <= 0x39)) {
        c.i--
        return out
      }
      if (next < 0x2b || (next > 0x2d && next < 0x30) || (next > 0x39 && next < 0x41)) tclSyntax(rt)
      if (next <= 0x5a) break
      if (next < 0x61 || next > 0x7a) tclSyntax(rt)
    }
    ch = next
  }
}

/** what $1b6c leaves behind: a value, and whether a comma followed it */
interface TclNum {
  v: number
  omitted: boolean
  /** -1 nothing was there, 0 a comma ended it, 1 it ended by itself */
  kind: number
}

/**
 * $1b6c — one numeric argument.
 *
 * Decimal only, with an optional sign, and the accumulate is `add.l d2,d2`
 * three times over with a spare copy added back, so ten. Every one of those
 * adds is followed by `bcs` onto the syntax error, which is how a number
 * bigger than a longword is reported.
 *
 * A space INSIDE a number ends it: d3 is set on the first space and tested
 * before the next digit is taken, and the flag is cleared again at the top of
 * every iteration so it only ever means "the character before this one was a
 * space".
 */
function tclNumber(rt: Runtime, c: TclCursor): TclNum {
  let ch = 0
  for (;;) {
    if (c.i >= c.n) return { v: 0, omitted: true, kind: -1 }
    ch = c.s.charCodeAt(c.i++)
    if (ch <= 0x20) continue
    break
  }
  if (ch === 0x3b) return { v: 0, omitted: true, kind: -1 }
  if (ch === 0x2c) return { v: 0, omitted: true, kind: 0 }
  let neg = false
  let acc = 0
  if (ch === 0x2d) neg = true
  else if (ch !== 0x2b) {
    const d = ch - 0x30
    if (d < 0 || d > 9) {
      c.i--
      return { v: 0, omitted: true, kind: -1 }
    }
    acc = d
  }
  let kind = 1
  for (;;) {
    let spaced = false
    let done = false
    for (;;) {
      if (c.i >= c.n) {
        done = true
        break
      }
      ch = c.s.charCodeAt(c.i++)
      if (ch <= 0x20) {
        spaced = true
        continue
      }
      break
    }
    if (done) break
    if (ch === 0x3b) break
    if (ch === 0x2c) {
      kind = 0
      break
    }
    const d = ch - 0x30
    if (spaced || d < 0 || d > 9) {
      c.i--
      break
    }
    acc = acc * 10 + d
    if (acc > 0xffff_ffff) tclSyntax(rt)
  }
  let v = acc | 0
  if (neg) {
    if (acc === 0x8000_0000) tclSyntax(rt)
    v = -v | 0
  }
  return { v, omitted: false, kind }
}

/**
 * The table at $1c88 — twenty-two commands, every one of them a `Rbra` onto
 * the routine its AMOS keyword uses, so nothing in TCL is a second
 * implementation of anything. The exception is `I`/`P`, which have no keyword
 * at all and go straight to SetAPen and SetBPen.
 *
 * `mask` is the byte after the name and it is read one bit at a time: bit n-1
 * set means "stopping after n arguments is allowed", so 1 is exactly one
 * argument, 2 is exactly two, 3 is one or two, and 0 is none.
 */
interface TclCmd {
  mask: number
  run: (rt: Runtime, a: TclNum[]) => void
}

function tclTable(): Record<string, TclCmd> {
  const arg = (rt: Runtime, a: TclNum[], n: number): TrArg =>
    a[n] === undefined || a[n]!.omitted ? { v: 0, omitted: true } : trArgOf(rt, a[n]!.v, false)
  const raw = (a: TclNum[], n: number): number => (a[n] === undefined || a[n]!.omitted ? 0 : a[n]!.v)
  return {
    A: { mask: 1, run: (rt, a) => craftTrSetAngle(rt, raw(a, 0)) },
    B: { mask: 1, run: (rt, a) => craftTrForward(rt, trNegArg(rt, arg(rt, a, 0))) },
    D: { mask: 2, run: (rt, a) => craftTrDraw(rt, arg(rt, a, 0), arg(rt, a, 1)) },
    DR: { mask: 2, run: (rt, a) => craftTrStep(rt, arg(rt, a, 0).v, arg(rt, a, 1).v, 1) },
    F: { mask: 1, run: (rt, a) => craftTrForward(rt, arg(rt, a, 0)) },
    H: { mask: 0, run: (rt) => craftTrHome(rt) },
    I: { mask: 3, run: tclPen },
    L: { mask: 1, run: (rt, a) => craftTrTurn(rt, -raw(a, 0)) },
    M: { mask: 2, run: (rt, a) => craftTrMove(rt, arg(rt, a, 0), arg(rt, a, 1)) },
    MA: { mask: 0, run: craftTrMemorizeA },
    MR: { mask: 2, run: (rt, a) => craftTrStep(rt, arg(rt, a, 0).v, arg(rt, a, 1).v, 0) },
    MX: { mask: 0, run: (rt) => craftTrMemorize(rt, false) },
    MY: { mask: 0, run: (rt) => craftTrMemorize(rt, true) },
    P: { mask: 3, run: tclPen },
    PD: { mask: 0, run: (rt) => trClrFlag(rt.craft.turtle, TRF_PENUP) },
    PU: { mask: 0, run: (rt) => trSetFlag(rt.craft.turtle, TRF_PENUP) },
    R: { mask: 1, run: (rt, a) => craftTrTurn(rt, raw(a, 0)) },
    RA: { mask: 0, run: craftTrRememberA },
    RX: { mask: 0, run: (rt) => craftTrRemember(rt, false) },
    RY: { mask: 0, run: (rt) => craftTrRemember(rt, true) },
    SH: { mask: 2, run: (rt, a) => craftTrSetHome(rt, arg(rt, a, 0), arg(rt, a, 1)) },
    TO: { mask: 2, run: (rt, a) => craftTrTowards(rt, arg(rt, a, 0), arg(rt, a, 1)) },
  }
}

/**
 * $1d1a — `I`/`P`, TCL's only command with no keyword behind it. Two
 * arguments set the pattern colour through SetBPen and then the ink through
 * SetAPen; one sets the ink alone. Both are bounded 0..31 by `moveq #$20,d1 /
 * cmp.l d1,d0 / Rbcc routine 217`, and either may be written as nothing, in
 * which case no call is made at all.
 *
 * It resets the dash state afterwards, exactly as a jump does.
 */
function tclPen(rt: Runtime, a: TclNum[]): void {
  const s = craftScreen(rt)
  const set = (n: TclNum | undefined, to: (v: number) => void): void => {
    if (n === undefined || n.omitted) return
    if ((n.v >>> 0) >= 32) craftTrRange(rt)
    to(n.v)
  }
  if (a.length !== 1) set(a[1], (v) => (s.gPaper = v))
  set(a[0], (v) => (s.ink = v))
  rt.craft.turtle.setUint8(TR.patCnt, 0xf)
  rt.craft.turtle.setUint8(TR.frstDot, 1)
}

/**
 * Routine 96 ($1a7c) — one pass over a TCL string.
 *
 * The two words at $56 and $58 are what =Tr Error reports: the total length
 * plus one, and how much was left when the current command started. On a
 * clean run `clr.l $56` puts both back to zero, so the difference is zero;
 * on a failure the raise goes straight out and they keep the position.
 */
function craftTclRun(rt: Runtime, src: string): void {
  const t = rt.craft.turtle
  trSetFlag(t, TRF_TCL)
  const table = tclTable()
  const c: TclCursor = { s: src, i: 0, n: src.length }
  if (src.length !== 0) {
    t.setUint16(TR.total, u16(src.length + 1))
    for (;;) {
      t.setUint16(TR.left, u16(c.n - c.i))
      const word = tclWord(rt, c)
      if (word === '') break
      const cmd = table[word]
      if (cmd === undefined) tclSyntax(rt)
      const args: TclNum[] = []
      if (cmd.mask === 0) {
        if (tclNumber(rt, c).kind >= 0) tclArity(rt)
      } else {
        let mask = cmd.mask
        for (;;) {
          const n = tclNumber(rt, c)
          args.push(n)
          const bit = mask & 1
          mask = (mask >>> 1) & 0xff
          if (n.kind !== 0) {
            if (bit === 0) tclArity(rt)
            break
          }
          if (mask === 0) tclArity(rt)
        }
      }
      cmd.run(rt, args)
      if (c.i >= c.n) break
    }
  }
  trClrFlag(t, TRF_TCL)
  t.setInt32(TR.left, 0)
}

/*
 * ---- the fractal generator ----
 *
 * A cursor over the complex plane and a renderer, sharing the same workspace
 * the turtle uses and reaching it at lower offsets. Everything is 16-bit
 * fixed point with 8192 as one — the manual says so for the coordinates ("the
 * unit used is 1/8192", "by multiplying their real values by 8192") and the
 * iteration confirms it: a product of two of them has 26 fractional bits, and
 * `asl.l #3 / swap` is a multiply by eight and a shift down sixteen, which is
 * a division by 8192.
 *
 * The escape test is `cmp.l #$10000000,d4` on that 26-bit product, and
 * $10000000 over 2^26 is 4 — the standard |z|² ≥ 4.
 */

/** what the fractal half of the workspace holds; there is no Fr Base to publish it */
export interface CraftFractal {
  /** $e: the screen the window is on, or -1 for none */
  screen: number
  /** $10..$16: the window rectangle, unchecked until a set is drawn */
  wx: number
  wy: number
  ww: number
  wh: number
  /** $18: whether Fr Position has ever run */
  placed: boolean
  /** $1a/$1c: the plane coordinate of the window's top left corner, in 1/8192 */
  px: number
  py: number
  /** $1e/$20: the plane step between two pixels, 1..1024 */
  sx: number
  sy: number
  /** $26: 1025 bytes, index 0..1024, allocated on first use and freed by Fr Reset */
  colours: Uint8Array | null
  /** $2a/$2c: the Fr Scan band, reset after every drawing instruction */
  scanFrom: number
  scanLines: number
}

export const newCraftFractal = (): CraftFractal => ({
  screen: -1,
  wx: 0,
  wy: 0,
  ww: 0,
  wh: 0,
  placed: false,
  px: 0,
  py: 0,
  sx: 0,
  sy: 0,
  colours: null,
  scanFrom: 0,
  scanLines: 0x4000,
})

/** the escape radius squared, as routine 159 spells it: `movea.l #$10000000,a0` */
export const FR_ESCAPE = 0x1000_0000

/** one is 8192, so a product of two coordinates carries 26 fractional bits */
export const FR_ONE = 8192

const w16 = (v: number): number => (v << 16) >> 16
const mul16 = (a: number, b: number): number => (w16(a) * w16(b)) | 0

/**
 * Routine 149 ($28ba) — the colour table, allocated on first use and seeded
 * with a byte counter: index n gets colour n & 255. 1025 bytes, because the
 * index runs 0..1024 and zero is "this point is in the set".
 */
function frColours(rt: Runtime): Uint8Array {
  const f = rt.craft.fractal
  if (f.colours === null) {
    f.colours = new Uint8Array(1025).map((_, i) => i & 0xff)
  }
  return f.colours
}

/** routine 139's bound: a plane coordinate is a signed word */
function frCoord(v: number): number {
  if (v < -32768 || v > 32767) illegal()
  return v
}

/** routines 140 and 141: the position, or CRAFT's "No fractal position defined" */
function frPlaced(rt: Runtime): CraftFractal {
  const f = rt.craft.fractal
  if (!f.placed) craftError(1)
  return f
}

/** routines 145 and 146: a step of zero is "No fractal step specified" */
function frStep(v: number): number {
  if ((v & 0xffff) === 0) craftError(2)
  return v & 0xffff
}

/** Routine 138 ($278e), and the `defaults` hook: "automatically executed when an AMOS program is run" */
export function craftFrReset(rt: Runtime): void {
  const f = rt.craft.fractal
  f.scanFrom = 0
  f.scanLines = 0x4000
  f.screen = -1
  f.placed = false
  f.sx = 0
  f.sy = 0
  f.colours = null
}

/**
 * Routine 144 ($283a) — a step, which must be 1..1024. An omitted one comes
 * back as -1 and the caller tests for it with `bmi`.
 */
function frStepArg(it: Interp): number {
  if (it.atStmtEnd() || it.nm() === ',') return -1
  const v = it.evalInt()
  if ((v >>> 0) > 0x400 || (v & 0xffff) === 0) illegal()
  return v
}

/**
 * Routine 158 ($2a2c) — the window and scan arguments: omitted comes back as
 * -1, everything else must be 0..16383, and the caller reads the sign to tell
 * "not given" from "given as zero".
 */
function frWinArg(it: Interp): number {
  if (it.atStmtEnd() || it.nm() === ',') return -1
  const v = it.evalInt()
  if ((v >>> 0) >= 0x4000) illegal()
  return v
}

/**
 * Routine 154 ($2994) — the four window numbers, popped last-first.
 *
 * "You don't have to specify every parameter, but the commas must remain. An
 * omitted parameter is thought to mean 'as big as possible with the current
 * screen size'": an omitted x or y is zero, and an omitted width or height is
 * the screen's less the corner. The routine reaches back down its own
 * argument stack for that corner — `sub.w $6(a3),d0` reads the low word of a
 * value it has not popped yet — which is why an omitted y makes the height
 * the whole screen rather than the whole screen less nothing.
 */
function frWindowFrom(rt: Runtime, s: Screen, x: number, y: number, w: number, h: number): void {
  const f = rt.craft.fractal
  f.screen = -1
  if (h === 0 || w === 0) illegal()
  f.wh = h > 0 ? h : w16(s.height - Math.max(y, 0))
  f.ww = w > 0 ? w : w16(s.width - Math.max(x, 0))
  f.wy = y > 0 ? y : 0
  f.wx = x > 0 ? x : 0
}

/**
 * Routine 161 ($2c8c) — everything a drawing instruction needs, or nothing.
 *
 * Three refusals first, and they are CRAFT's own messages rather than AMOS's:
 * no window, no position, no step. Then the window is clipped against the
 * screen's clipping rectangle and the Fr Scan band, and the plane coordinate
 * of the first pixel is recomputed from whatever survived — so scanning a
 * band in the middle of the picture draws the same pixels there that a whole
 * one would.
 *
 * A screen with no bitplanes, or a band entirely off the window, answers Z
 * set and the caller draws nothing at all rather than failing.
 */
interface FrPlan {
  x0: number
  y0: number
  cols: number
  rows: number
  cr: number
  ci: number
}

function frPlan(rt: Runtime): FrPlan | null {
  const f = rt.craft.fractal
  if (f.screen < 0) craftError(0)
  if (!f.placed) craftError(1)
  if (f.sx === 0 || f.sy === 0) craftError(2)
  const s = rt.screens.get(f.screen)
  if (!s) craftError(0)
  // the clip rectangle AMOS keeps at $ee..$f4, which with no Set Clip is the
  // whole screen; the two maxima are exclusive here, as the subtractions show
  const cl = s.clip
  const clx1 = cl ? cl.x1 : 0
  const cly1 = cl ? cl.y1 : 0
  const clx2 = cl ? cl.x2 + 1 : s.width
  const cly2 = cl ? cl.y2 + 1 : s.height

  let d5 = w16(f.wh - f.scanFrom)
  if (d5 < 0) return null
  if (d5 > f.scanLines) d5 = f.scanLines
  let d4 = f.scanFrom
  let d6 = f.wx
  let d7 = f.ww
  let d0 = w16(cly1 - f.wy)
  if (d0 > 0) {
    d0 = w16(d0 - d4)
    if (d0 > 0) {
      d4 = w16(d4 + d0)
      d5 = w16(d5 - d0)
      if (d5 <= 0) return null
    }
  }
  d0 = w16(cly2 - w16(f.wy + d4))
  if (d0 <= 0) return null
  if (d0 < d5) d5 = d0
  d0 = w16(clx1 - d6)
  if (d0 > 0) {
    d6 = w16(d6 + d0)
    d7 = w16(d7 - d0)
    if (d7 <= 0) return null
  }
  d0 = w16(clx2 - d6)
  if (d0 <= 0) return null
  if (d0 < d7) d7 = d0

  // the plane coordinate of the first pixel that survived, `mulu.w` and a
  // word add -- so a big scan offset times a big step wraps rather than
  // saturating, exactly as it does on the machine
  const ci = w16((d4 === 0 ? 0 : -(((d4 & 0xffff) * (f.sy & 0xffff)) | 0)) + f.py)
  const dx = w16(d6 - f.wx)
  const cr = w16((dx === 0 ? 0 : ((dx & 0xffff) * (f.sx & 0xffff)) | 0) + f.px)
  return { x0: d6, y0: w16(f.wy + d4), cols: d7, rows: d5, cr, ci }
}

/**
 * The escape-time iteration, routines 159 and 160 sharing one loop.
 *
 * Julia takes c from the keyword and z from the pixel; Mandelbrot takes both
 * from the pixel, which is the whole difference between the two routines and
 * the reason the Mandelbrot one is sixty bytes shorter. The answer is the
 * iteration at which |z|² reached four, from 1, or ZERO for a point that
 * never escaped — "as the iteration count starts from one, the index number
 * zero has a special meaning".
 */
function frIterate(zr0: number, zi0: number, cr: number, ci: number, iterM1: number): number {
  let zr = w16(zr0)
  let zi = w16(zi0)
  let zi2 = mul16(zi, zi)
  let zrzi = mul16(zr, zi)
  let zr2 = mul16(zr, zr)
  let d4 = (zi2 + zr2) | 0
  let d6 = iterM1
  while (d4 < FR_ESCAPE) {
    d6--
    if (d6 < 0) return 0
    // `sub.l a2,d2 / asl.l #3 / swap` and `asl.l #4 / swap`: the products
    // carry 26 fractional bits and come back to 13
    const nzr = w16((((zr2 - zi2) | 0) << 3) >> 16)
    const nzi = w16((zrzi << 4) >> 16)
    zr = w16(nzr + cr)
    zi = w16(nzi + ci)
    zi2 = mul16(zi, zi)
    zrzi = mul16(zr, zi)
    zr2 = mul16(zr, zr)
    d4 = (zi2 + zr2) | 0
  }
  return iterM1 - d6 + 1
}

/**
 * The pixel walk both drawing instructions share.
 *
 * The original writes the colour a bit at a time with `bset`/`bclr` across
 * the screen's bitplanes, taking as many low bits of it as there are planes,
 * which is the manual's "the colour number may be bigger than the screen mode
 * would allow, because in such cases only the lower bits of the number are
 * used". Masking to the depth is the same thing said in one line.
 */
function frRender(rt: Runtime, iterM1: number, julia: { cr: number; ci: number } | null): void {
  const f = rt.craft.fractal
  const table = frColours(rt)
  const plan = frPlan(rt)
  if (plan !== null) {
    const s = rt.screens.get(f.screen)!
    const mask = (1 << s.depth) - 1
    let ci = plan.ci
    for (let row = 0; row < plan.rows; row++) {
      let cr = plan.cr
      for (let col = 0; col < plan.cols; col++) {
        const n = julia === null ? frIterate(cr, ci, cr, ci, iterM1) : frIterate(cr, ci, julia.cr, julia.ci, iterM1)
        s.plot(plan.x0 + col, plan.y0 + row, table[n]! & mask)
        cr = w16(cr + f.sx)
      }
      ci = w16(ci - f.sy)
    }
  }
  // "the scan area is always reset after a fractal drawing instruction"
  f.scanFrom = 0
  f.scanLines = 0x4000
}

/*
 * ---- Workbench, the CLI, and the machine ----
 *
 * The group that proves the claim at the top of this file. Not one of these
 * keywords opens a library: every one reaches a base AMOS is already holding,
 * and the three bases are worth writing down because they are also the best
 * evidence for which slot this extension belongs at.
 *
 *     -$18a6(a5)    IntuitionBase   OpenWorkBench -$d2, WBenchToFront -$156,
 *                                   WBenchToBack -$150, DisplayAlert -$5a,
 *                                   GetDefPrefs -$7e, GetPrefs -$84,
 *                                   SetPrefs -$144, AutoRequest -$15c
 *     $620(a5)      DOSBase         Output -$3c, Input -$36, Write -$30,
 *                                   Execute -$de
 *     $4 absolute   ExecBase        Forbid -$84, Permit -$8a, Alert -$6c,
 *                                   SetTaskPri -$12c, Disable -$78,
 *                                   Supervisor -$1e, ThisTask $114
 *
 * `-$18a6` sits eight bytes from the `-$18ae` GfxBase the turtle draws
 * through, which is the cross-check that the first one is read right.
 */

/** what this group keeps: nothing the machine would not keep for it */
export interface CraftSystem {
  /** ThisTask->ln_Pri, as Set Amos Pri leaves it */
  pri: number
}

export const newCraftSystem = (): CraftSystem => ({ pri: 0 })

/**
 * Routine 57 ($149e) turns an AMOS string into a NUL-terminated one for
 * dos.library. Nothing to model — a JS string is already the value — but it
 * is why `Cli Execute` can be handed a string with a zero length and gets an
 * empty command rather than a fault.
 */
function craftCli(rt: Runtime, cmd: string): number {
  // routine 165 passes Output() and Input(), so the command inherits the
  // console rather than running detached; ../amiga/process.ts records the
  // contrast with EasyLife's Elexec, which passes zero and does not
  return execute(rt.host.process, { command: cmd, io: { input: 'console', output: 'console' } })
}

/**
 * Routines 178, 179 and 181 ($2f36, $2f58, $2f82) — GetDefPrefs, GetPrefs and
 * SetPrefs, all three over an address the caller supplies.
 *
 * AMOS routine 431 turns the argument into an address and `btst #$0,d3 /
 * Rbne routine 208` refuses an odd one, which is AMOS error 25 rather than
 * anything of CRAFT's. The size is passed straight through, so a caller
 * asking for fewer bytes than the structure holds gets the front of it —
 * that is Intuition's contract and not this extension's.
 */
function craftPrefsTo(rt: Runtime, addr: number, size: number, def: boolean): void {
  if ((addr & 1) !== 0) addressError()
  const src = preferencesBytes(def)
  const n = Math.min(Math.max(size, 0), src.length)
  for (let i = 0; i < n; i++) {
    const m = rt.resolveWrite(addr + i)
    if (m) m.data[m.off] = src[i]!
  }
}

/**
 * Routine 173 ($2e5a) — the body of =Guru Alert, and of five arities that
 * differ only in how many lines they stack.
 *
 * It builds an IntuiText chain in the scratch area: each line is centred by
 * `asl.w #2 / subi.w #$140 / neg.w`, which is `320 - 4*length`, and stepped
 * ten pixels down the alert with `addi.w #$a,d6` from a first line at 14.
 * A line of 78 characters or more is error 23 and an empty one is skipped, so
 * five empty lines are error 23 too: `tst.w d5 / Rbeq routine 206` fires when
 * nothing at all was laid down.
 *
 * Then DisplayAlert (-$5a) with a RECOVERY_ALERT height, and the answer is
 * -1 for the left mouse button. AMOS's own display is taken down and put back
 * around it through the jump table at `$120(a0)`, because an alert owns the
 * screen while it is up.
 */
function craftAlertSpec(lines: string[], gadgets: string[]): AlertSpec {
  let any = false
  for (const line of lines) {
    if (line.length === 0) continue
    if (line.length >= 0x4e) illegal()
    any = true
  }
  if (!any) illegal()
  return { kind: 'alert', body: lines.filter((l) => l.length !== 0).join('\n'), gadgets }
}

/**
 * The block-and-resume both requesters share, which is the shape every
 * requester in this port takes: stand it up, block the interpreter on its
 * dialog channel, and read the answer when the keyword runs again.
 *
 * DEVIATION: DisplayAlert and AutoRequest are drawn by this port's own dialog
 * machinery rather than by Intuition. The alert's geometry is therefore not
 * the machine's -- routine 173 centres each line on `320 - 4*length` and
 * steps ten pixels a line, and none of that survives. What DOES survive is
 * everything a program can observe: which lines are refused, that an empty
 * set is error 23, and that the answer is -1 for the left button.
 */
function craftRequest(rt: Runtime, it: Interp, spec: AlertSpec): Value {
  const st = rt.craft
  if (st.request) {
    const r = finishRequester(rt, st.request.chan, st.request.spec)
    if (r === null) {
      it.block({ type: 'dialog', channel: st.request.chan }, true)
      return VI(0)
    }
    st.request = null
    // AutoRequest and DisplayAlert both answer TRUE for the LEFT choice, and
    // routine 173 turns anything non-zero into -1
    return VI(r.ret !== 0 ? -1 : 0)
  }
  const chan = startRequester(rt, spec)
  if (chan === null) return VI(0)
  st.request = { chan, spec }
  it.block({ type: 'dialog', channel: chan }, true)
  return VI(0)
}
