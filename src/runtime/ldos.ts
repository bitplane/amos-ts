/**
 * LDos — file and directory handling for AMOS, by Niklas Sjoberg.
 *
 * The most used third-party extension in the corpus after the stock libraries:
 * 66 of 4,758 programs need it. Its
 * keywords are all `L`-prefixed, so unlike most extensions they collide with
 * nothing in the core language or in any other registered table.
 *
 * ## Evidence
 *
 * Behaviour comes from `LdosV25.DOC`, the extension's own 81KB manual, which
 * documents every keyword with its syntax, parameter meanings, error results
 * and worked examples. That is manual-tier evidence, so these can be marked
 * faithful — tests cite the manual entry the way the core port cites 68k
 * source lines. There is no source for LDos, so where the manual is silent,
 * the behaviour is recorded as unknown rather than invented.
 *
 * Version note: LDos 2.5's token table is a strict prefix of 2.6's — the same
 * 79 entries at the same offsets, with 8 keywords appended — so one set of
 * handlers serves both. 2.6's additions are `Lcompress`, `Ldecompress`,
 * `Lrol`, `Lror`, `Lhicol On/Off`, `Lstrcmp` and `Lprot Conv`. They are
 * documented — `Documentation/ldos.text` and `LdosV25.guide` beside the 2.6
 * library carry all eight, which the 2.5 fixture's documents do not — and
 * routines 83 to 90 of the 2.6 binary settle what the prose leaves open.
 *
 * The two builds differ in more than keyword count, and each is the better
 * evidence for something. 2.5 says `$VER:Ldos_V2.5_Registered` and calls
 * itself "LDos Pro 1.0" internally, yet carries 68 copies of the shareware
 * nag; 2.6 calls itself "LDos Pro 1.1", has no `$VER` at all and no nag, so
 * the descriptive error messages the nag displaces in 2.5 are reachable in
 * it. Three of them are new: "Not enough memory to compress!" (25), "You can
 * only shift 31 bits a time!" (26) and "Can't Strcmp empty strings!" (27).
 *
 * ## Channels
 *
 * LDos keeps its own three channels, numbered 1 to 3, entirely separate from
 * AMOS's `Open In`/`Open Out`: the manual is explicit that "files opened with
 * the standard AMOS-command Open In or Open Out can not be closed with this
 * command", and that unlike AMOS, a single LDos channel supports both reading
 * and writing. So these do not share Runtime.fileChans.
 */
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import { DEST_MARGIN, lcompress, ldecompress } from './ldoslz'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/*
 * Error messages are the library's own, read out of its string table at
 * $609e..$6340 rather than invented. The author's English is preserved
 * exactly — "To short password-string!", "No enough words in string!" — on
 * the same principle as everything else here: a program that prints an
 * error is showing the user LDos's words, not ours.
 *
 * The shareware build this fixture is has a wrinkle worth recording: 69
 * copies of "UNREGISTERED SHAREWARE version of LDos!" are embedded, one per
 * routine, and the error paths print those instead of the descriptive
 * message. So the real table is present but unreachable in this build. The
 * descriptive messages are used here because they are what the extension
 * means to say, and because a nag is a property of one build rather than of
 * the keyword.
 */
import { amigaMatch, parsePatternResult } from '../amiga/dospattern'
import { pp20Decrunch } from '../amiga/powerpacker'
import { DEV_MODELLED, DEV_SERIAL_DEFAULTS } from './device'
import type { SerialPortHandle } from '../amiga/host'
import { execute } from '../amiga/process'
import { DAY_MS, STAMP_EPOCH, stampToYmd as amigaStampToYmd } from '../amiga/datestamp'
import { MAX_COMMENT, ST_FILE, ST_USERDIR, blocksFor } from '../amiga/dos'

/**
 * Convert an ANSI escape sequence to the AMOS console's own control codes,
 * as `Lansi` does.
 *
 * AMOS's console does not speak ANSI: it takes ESC followed by a letter and
 * a parameter byte (screen.ts:874, +Lib.s ChXxx) — ESC P n for pen, ESC B n
 * for paper, ESC X/Y n to locate, ESC O/N with a +128 bias to move
 * relatively. Lansi is the translator, which is why a BBS terminal written
 * in AMOS needs it.
 *
 * The manual notes a sequence "doesn't have to be complete if the rest of
 * the sequence follow in the next call(s)", so the tail of an unfinished
 * escape is carried over — hence the state on LdosState rather than a pure
 * function.
 */
export function ansiToAmos(input: string, state: LdosState): string {
  let out = ''
  let src = state.ansiPending + input
  state.ansiPending = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c !== '\x1b') {
      // $C is not an ANSI code at all, but the manual supports it "since many
      // BBS-programs (and AmigaDOS + others) use this". Routine 69 answers it
      // with `move.b #$19,(a2)+` -- chr 25, Clw -- and not a locate
      if (c === '\x0c') out += '\x19'
      else out += c // linefeed, carriage return and backspace pass through
      i++
      continue
    }
    if (src[i + 1] !== '[') {
      // not a CSI: if the buffer simply ends here, wait for the rest
      if (i + 1 >= src.length) break
      i += 2
      continue
    }
    // gather the parameter digits and the final letter
    let j = i + 2
    while (j < src.length && !/[A-Za-z@]/.test(src[j]!)) j++
    if (j >= src.length) break // incomplete: carry it to the next call
    const params = src.slice(i + 2, j)
    const final = src[j]!
    const nums = params.split(';').map((p) => (p === '' ? -1 : parseInt(p, 10)))
    const n = (k = 0): number => (nums[k] === undefined || nums[k]! < 0 ? 1 : nums[k]!)
    const esc = (op: string, v: number): string => '\x1b' + op + String.fromCharCode(48 + v)
    switch (final) {
      case 'm': {
        // "Lansi detects if style or colour is to be changed", and ESC[0m
        // resets to pen 1, paper 0, no style
        for (const raw of nums) {
          const v = raw < 0 ? 0 : raw
          if (v === 0) {
            out += esc('P', 1) + esc('B', 0) + '\x1bW' + String.fromCharCode(48)
            state.ansiBright = 0
          }
          // SGR 2 is the hi-col switch. Standard ANSI calls 2 "faint"; this
          // library uses it for the BBS convention of a second bank of eight
          // colours, and Lhicol Off is what makes it inert
          else if (v === 2) state.ansiBright = state.hicol ? 8 : 0
          else if (v >= 30 && v <= 37) out += esc('P', v - 30 + state.ansiBright)
          else if (v >= 40 && v <= 47) out += esc('B', v - 40)
          // Italics (shaded), Inverse and Underline are the supported
          // styles; the manual says other styles are simply ignored
          else if (v === 3) out += '\x1bW' + String.fromCharCode(48 + 1)
          else if (v === 4) out += '\x1bW' + String.fromCharCode(48 + 2)
          else if (v === 7) out += '\x1bW' + String.fromCharCode(48 + 4)
        }
        break
      }
      case 'A': out += '\x1bN' + String.fromCharCode(128 - n()); break // cursor up
      case 'B': out += '\x1bN' + String.fromCharCode(128 + n()); break // down
      case 'C': out += '\x1bO' + String.fromCharCode(128 + n()); break // right
      case 'D': out += '\x1bO' + String.fromCharCode(128 - n()); break // left
      case 'H': {
        // ESC[y;xH is Locate x,y — note the ANSI order is row then column
        const y = nums[0] === undefined || nums[0]! < 0 ? 1 : nums[0]!
        const x = nums[1] === undefined || nums[1]! < 0 ? 1 : nums[1]!
        out += esc('X', Math.max(0, x - 1)) + esc('Y', Math.max(0, y - 1))
        break
      }
      // The five arms below emit BARE console control codes rather than ESC
      // sequences, and routine 69 gives each of them as a single `move.b` --
      // `#$7` for K, `#$1a` for M, `#$19` for J, `#$14` for L, and `#$12`
      // repeated for @. Those are ClEol, ClLine, Clw, ScBas and ScDLine in
      // AMOS's own control table (+W.s:16570), so the translation is exact
      // and this port was dropping four of the five.
      case '@': out += '\x12'.repeat(Math.max(0, n())); break // ScDLine, n times
      case 'J': out += '\x19'; break // "even if only ESC[J ... the whole window is cleared"
      case 'K': out += '\x07'; break // ClEol
      case 'L': out += '\x14'; break // ScBas — open a line at the cursor
      case 'M': out += '\x1a'; break // ClLine
      case 'p':
        break // the cursor-visibility form, which routine 69 also ignores
      default:
        break
    }
    i = j + 1
  }
  // whatever is left is an unfinished sequence: hold it for the next call
  if (i < src.length) state.ansiPending = src.slice(i)
  return out
}

/** an AMOS string is bytes, not UTF-16 */
const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff))

/**
 * AmigaDOS datestamps count days from 1 Jan 1978. Ldate and Lstamp convert
 * between that and a "YYMMDD" string; the manual caps the useful range at
 * 2099 ("which should be enough?").
 */
/*
 * The Lcat accessors read a real FileInfoBlock field by field — verified by
 * disassembly, where every one of them indexes the documented offset. The
 * struct itself, its entry types and its protection bits are
 * ../amiga/dos.ts; what stays here is which of them each keyword reports.
 */

/**
 * LDos's view of a datestamp: the shared calendar, with LDos's own clamp on
 * top. The manual is explicit that `Ldate` floors at the epoch -- "If the
 * date is before 1 Jan 1978, 1 Jan 1978 will still be returned" -- and that
 * is LDos's rule, not AmigaDOS's, so it lives here rather than in
 * ../amiga/datestamp.ts where it would silently apply to everyone.
 */
export function stampToYmd(days: number): [number, number, number] {
  return amigaStampToYmd(Math.max(0, days))
}

/**
 * LDos's cipher, read out of AMOSPro_Ldos.lib itself (Lcrypt at $4400,
 * Ldecrypt at $4436, disassembled with capstone). The manual documents the
 * calling convention and says nothing whatever about the algorithm, so the
 * binary is the only specification there is:
 *
 *     moveq   #0,d7            ; key starts at zero
 *   .key:
 *     add.b   (a0)+,d7         ; NB add.b — only d7's low byte is affected
 *     eori.l  #3,d7            ;   ...but the XOR and rotate are full 32-bit
 *     rol.l   #1,d7
 *     dbra    d0,.key
 *
 * then, per longword, encrypt adds before masking and decrypt masks before
 * subtracting, which is what makes them exact inverses:
 *
 *     addi.l  #$20,(a1) : eor.l d7,(a1)+     ; Lcrypt
 *     eor.l   d7,(a1)   : subi.l #$20,(a1)+  ; Ldecrypt
 */
export function ldosKey(password: string): number {
  let key = 0
  for (let i = 0; i < password.length; i++) {
    const lo = ((key & 0xff) + (password.charCodeAt(i) & 0xff)) & 0xff
    key = ((key & 0xffffff00) | lo) >>> 0
    key = (key ^ 3) >>> 0
    key = (((key << 1) | (key >>> 31)) & 0xffffffff) >>> 0
  }
  return key >>> 0
}

export function ymdToStamp(year: number, month: number, day: number): number {
  const days = Math.floor((Date.UTC(year, month - 1, day) - STAMP_EPOCH) / DAY_MS)
  return Number.isFinite(days) ? Math.max(0, days) : 0
}

/** LDos channel: readable and writable at once, unlike an AMOS channel */
export interface LdosChannel {
  path: string
  /** the whole file, grown by writes */
  data: Uint8Array
  /** read/write cursor, always relative to the start of the file */
  pos: number
  /** whether anything has been written and needs flushing on close */
  dirty: boolean
}

/**
 * An Lcat directory scan. Lcat First "locks" a directory and Lcat Next walks
 * its entries, which is AmigaDOS Examine()/ExNext() rather than AMOS's Dir
 * First$/Dir Next$ — the manual says so ("Lcat First actually returns the
 * path, requested by you and doesn't read in all the files and directories
 * like Dir First\$") and the author's own Lrecursive.AMOS confirms it: the
 * result of Lcat First is discarded and every entry comes from Lcat Next.
 *
 * `index` is -1 while the lock still describes the directory itself, so the
 * accessors (Lcat Type, Lcat Size, ...) report the directory until the first
 * Lcat Next moves on to a real entry.
 */
export interface LcatScan {
  dir: string
  entries: Array<{ name: string; isDir: boolean; size: number }>
  index: number
}

export interface LdosState {
  chans: Map<number, LdosChannel>
  /** the current Lcat scan, if any */
  cat: LcatScan | null
  /** scans parked by Lcat Push, keyed by the bank address given to it */
  /** null where an unopened catalogue was pushed — a zero lock, faithfully */
  pushed: Map<number, LcatScan | null>
  /**
   * LDos tracks its own current directory. The manual is explicit that it
   * does not see AMOS's: "If you change the dir using the Dir$-command and
   * then try to open a file using Lopen, the file probably couldn't be
   * found, since Ldos hadn't noticed the directory-change". Null means none
   * has been set, so AMOS's current directory applies.
   */
  cwd: string | null
  /**
   * The requester's own remembered directory ("Whenever the user changes
   * directory it will be remembered by Ldos. This path does not affect
   * AMOS's (Dir$) path in any way") and the last selection, which the
   * manual says survives a Cancel.
   */
  freqDir: string
  freqFile: string
  /** Lpos Freq — "Default positions are 3,11" */
  freqX: number
  freqY: number
  /** Lcust Freq — "Default values are 12,30,14" */
  freqDevWidth: number
  freqFileWidth: number
  freqFiles: number
  /** Lfontsize Freq, updated only by a font-mode ($8) requester */
  freqFontSize: number
  /** the tail of an ANSI escape split across two Lansi calls */
  ansiPending: string
  /**
   * Lhicol On/Off (routines 87 and 88, $3b46 and $3b56), a byte in LDos's own
   * workspace at [$188(a5)]+$5bc. It gates whether SGR 2 may raise Lansi's
   * pens into 8-15; the manual says 16-colour mode is the default, and the
   * keyword exists to turn it OFF.
   */
  hicol: boolean
  /**
   * The offset Lansi adds to a pen, 0 or 8 — a single byte the library keeps
   * just below its output buffer ($2b22) and modifies in place. SGR 2 sets
   * it when `hicol` allows, SGR 0 clears it, and only the PEN path adds it:
   * `add.b $2b22(pc),d0` at $2a32 has no counterpart on the paper path at
   * $2a1e, so backgrounds stay in 0-7 whatever the mode.
   */
  ansiBright: number
  /** the Ldev First/Ldev Next walk over volumes and assigns */
  devices: { names: string[]; index: number } | null

  /** Lset Eoln: the end-of-line byte Lstr looks for. Default 10 (manual:
   * "Default is 10, normal Amiga LineFeed. (Unlike AMOS which tends to use
   * 13 for some reason...)") */
  eoln: number
  /** the single Ldevice channel: the IORequest at +$298 and its port at +$2c8 */
  device: LdosDevice | null
}

/**
 * LDos's one device channel. `Ldevice Open` raises error 9 rather than opening
 * a second, and every other keyword in the family raises error 10 without one.
 */
export interface LdosDevice {
  name: string
  unit: number
  flags: number
  /** io_Error at `$1f(a1)`, which `=Ldevice Error` reads as an unsigned byte */
  error: number
  serial?: SerialPortHandle
}

export const newLdosState = (): LdosState => ({ chans: new Map(), cat: null, pushed: new Map(), cwd: null, freqDir: '', freqFile: '', freqX: 3, freqY: 11,
  freqDevWidth: 12, freqFileWidth: 30, freqFiles: 14, freqFontSize: 0, ansiPending: '', devices: null,
  hicol: true, ansiBright: 0, eoln: 10, device: null })

/**
 * Resolve a path the way LDos does: against its own current directory when
 * Lldir$ has set one, and against AMOS's otherwise.
 */
function ldosPath(rt: Runtime, path: string): string {
  const cwd = rt.ldos.cwd
  if (cwd === null || /^[^:/]*:/.test(path)) return path
  return cwd.endsWith(':') || cwd.endsWith('/') ? cwd + path : `${cwd}/${path}`
}

/** the entry an Lcat accessor is currently looking at, or the locked dir */
/**
 * The current catalogue entry, or the library's error 7 if there is none.
 *
 * `Rbra routine 91` with `moveq #$7,d0` is "No more entries in this dir", and
 * every Lcat accessor takes it when the lock at $294 is absent.
 */
function catNow(rt: Runtime): NonNullable<ReturnType<typeof catAt>> {
  const e = catAt(rt)
  if (e === null) throw new AmosError('No more entries in this dir')
  return e
}

function catAt(rt: Runtime): { name: string; isDir: boolean; size: number; path: string } | null {
  const c = rt.ldos.cat
  if (!c) return null
  if (c.index < 0) return { name: c.dir, isDir: true, size: 0, path: c.dir }
  const e = c.entries[c.index]
  if (!e) return null
  const base = c.dir.endsWith(':') || c.dir.endsWith('/') ? c.dir : `${c.dir}/`
  return { ...e, path: base + e.name }
}

/**
 * What AmigaDOS would put in `fib_FileName` for a locked path.
 *
 * `Lcat First` answers this rather than the path it was given -- routine 20
 * builds its string from the FIB's +$8, and a lock knows the object's name
 * and not the route taken to it. A volume root reports the volume's own name,
 * without the colon.
 */
function fibFileName(path: string): string {
  const cut = path.replace(/[/:]+$/, '')
  const at = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf(':'))
  return at < 0 ? cut : cut.slice(at + 1)
}

/**
 * The open channel `n`, or the library's own error for why there isn't one.
 *
 * Routine 5 clamps the number to zero unless it is 1..3 and every caller then
 * takes two separate arms — `moveq #$0` for a number that was never a channel,
 * `moveq #$2` for one that is simply not open. Error 0 is "Invalid Lchannel"
 * and error 2 is "LFile not open" in the table at $3d14; answering the second
 * for both would tell a program the wrong thing about `Lload(9,...)`.
 */
function channel(rt: Runtime, n: number): LdosChannel {
  if (n < 1 || n > 3) throw new AmosError('Invalid Lchannel')
  const c = rt.ldos.chans.get(n)
  if (!c) throw new AmosError('LFile not open')
  return c
}

/** grow a channel's buffer so `end` bytes fit */
function ensure(c: LdosChannel, end: number): void {
  if (end <= c.data.length) return
  const grown = new Uint8Array(end)
  grown.set(c.data)
  c.data = grown
}

/** write a channel back to the filesystem */
function flush(rt: Runtime, c: LdosChannel): void {
  if (!c.dirty) return
  rt.vfs?.writeFile(c.path, c.data)
  rt.stampFile(c.path) // AmigaDOS dates a file when it is written
  c.dirty = false
}


/**
 * Split a string into words the way Lwords and Lword do.
 *
 * LdosV25.DOC: "Words are separated by either TAB (ASCII-value 9), comma
 * (','), space or doublequote ('\"'). If doublequotes aren't matched, all
 * text from the first doublequote will be treated as one word. Two
 * doublequotes without any text between them will be treated as one word
 * (this is a 'NULL'-word) ... If there are more than one separator (TAB,
 * SPACE, COMMA) following each other they will be ignored."
 *
 * Quoted words keep their quotes, which the manual flags as surprising and
 * deliberate: Lword returns them "even if there are text between the
 * doublequotes ... This makes it easy for the programmer to tell when more
 * than one word ... are to be regarded as ONE word."
 */
export function ldosWords(s: string): string[] {
  const sep = (c: string): boolean => c === '\t' || c === ' ' || c === ','
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && sep(s[i]!)) i++
    if (i >= s.length) break
    if (s[i] === '"') {
      const close = s.indexOf('"', i + 1)
      if (close < 0) {
        out.push(s.slice(i)) // unmatched: the rest is one word
        break
      }
      out.push(s.slice(i, close + 1)) // both quotes are kept
      i = close + 1
    } else {
      let j = i
      while (j < s.length && !sep(s[j]!) && s[j] !== '"') j++
      out.push(s.slice(i, j))
      i = j
    }
  }
  return out
}

/** a byte range in the fake address space, clipped to the region it lands in */
function region(rt: Runtime, start: number, stop: number): { data: Uint8Array; from: number; to: number } | null {
  const m = rt.resolveAddr(start)
  if (!m) return null
  const len = Math.max(0, Math.min(stop - start, m.data.length - m.off))
  return { data: m.data, from: m.off, to: m.off + len }
}

/** the same, for a range about to be WRITTEN — see Runtime.resolveWrite */
function regionWrite(rt: Runtime, start: number, stop: number): { data: Uint8Array; from: number; to: number } | null {
  const m = rt.resolveWrite(start)
  if (!m) return null
  const len = Math.max(0, Math.min(stop - start, m.data.length - m.off))
  return { data: m.data, from: m.off, to: m.off + len }
}

export function makeLdosInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Ldevice Close --- routine 32 ($1946). `RemPort` on the message port and
     * `CloseDevice` on the request, each guarded by its own pointer being
     * non-zero, so closing when nothing is open does nothing and is not an
     * error.
     */
    'ldevice close'() {
      rt.ldos.device?.serial?.close()
      rt.ldos.device = null
    },

    /**
     * Lhicol On — routine 87 ($3b46). "Force Lansi to use non-standard
     * hi-col codes in ANSI sequence ... Note! 16 colour mode is now the
     * default!" One byte in LDos's workspace; nothing else happens until
     * Lansi meets an SGR 2.
     */
    'lhicol on'() {
      rt.ldos.hicol = true
    },
    /** Lhicol Off — routine 88 ($3b56), the same byte cleared */
    'lhicol off'() {
      rt.ldos.hicol = false
    },
    /**
     * Lopen Channel,"Name",MODE — routine 1 ($e4c), 122 bytes. "WARNING! If
     * the file exist and MODE is 1 the file will be erased. (the file will be
     * 0 bytes long)"
     *
     *     move.l (a3)+, d4 / movea.l (a3)+, a0 / move.l (a3)+, d5
     *     Rbsr   routine 5                 the shared clamp
     *     tst.w  d5 / bne .num
     *     moveq  #$0, d0 / Rbra 91         error 0: not a channel NUMBER
     *  .num: lea $c(a2), a1 / lea (a2,d5.w), a4
     *     tst.l (a4) / beq .free
     *     moveq  #$1, d0 / Rbra 91         error 1: already assigned
     *  .free: ...copy the name...
     *     tst.w d4 / bne .new
     *     move.l #$3ed, d2 / bra .open     MODE_OLDFILE 1005
     *  .new: move.l #$3ee, d2              MODE_NEWFILE 1006
     *  .open: jsr -$1e(a6)                 dos.library Open
     *     tst.l d0 / bne .ok
     *     moveq  #$2, d0 / Rbra 91         error 2: LFile not open
     *
     * Three things the manual does not say. Reopening a channel that is
     * already open is error 1 rather than a silent replacement. The mode is
     * tested with `tst.w`, so it is any non-zero WORD that creates, not the
     * literal 1 -- which is what makes `Lcreate` below usable as the
     * argument. And a failed Open is error 2, the same "LFile not open" a
     * later Lload would give, not a filename error.
     *
     * NOTE: an empty name is a buffer overrun in the library and cannot be
     * reproduced. The copy is `move.w (a0)+,d0 / subq.w #$1,d0` then a
     * `dbra` loop, so a zero length underflows to $FFFF and writes 65536
     * bytes over LDos's own workspace at $188(a5)+$c. Here it copies nothing.
     */
    lopen(it) {
      const n = it.evalInt()
      it.expect(',')
      const path = ldosPath(rt, it.evalStr())
      it.expect(',')
      const mode = it.evalInt()
      if (n < 1 || n > 3) throw new AmosError('Invalid Lchannel')
      if (rt.ldos.chans.has(n)) throw new AmosError('LFile already assigned to channel')
      const create = (mode & 0xffff) !== 0
      let data: Uint8Array
      if (create) {
        data = new Uint8Array(0)
        rt.vfs?.writeFile(path, data) // created, and truncated if it existed
        rt.stampFile(path)
      } else {
        const existing = rt.fs?.read(path) ?? null
        if (existing === null) throw new AmosError('LFile not open')
        data = Uint8Array.from(existing)
      }
      rt.ldos.chans.set(n, { path, data, pos: 0, dirty: create })
    },
    /**
     * Lclose Channel — routine 2 ($ec6), 70 bytes. "Do not ever forget to
     * close a file ... otherwise the file, or even the whole disk can be
     * corrupt!!!" -- here closing is what commits the written bytes.
     *
     * It does NOT error on a channel that is not open, where every other
     * channel keyword does:
     *
     *     tst.l (a2) / bne .open
     *     movem.l (a7)+, a4-a6 / rts       nothing to close, and no error
     *  .open: move.l (a2), d1 / move.l #$0, (a2)
     *     jsr -$24(a6)                     Close, after the slot is cleared
     *
     * so `Lclose 1 : Lclose 1` is legal and only the number itself, error 0,
     * is rejected. The slot is cleared BEFORE the Close, which is why a
     * failing Close still frees the channel.
     */
    lclose(it) {
      const n = it.evalInt()
      if (n < 1 || n > 3) throw new AmosError('Invalid Lchannel')
      const c = rt.ldos.chans.get(n)
      if (!c) return
      rt.ldos.chans.delete(n)
      flush(rt, c)
    },
    /**
     * Lset Eoln NUM — routine 38 ($1aca), four instructions and no checking:
     * `movea.l $188(a5),a1 / adda.l #$2f6,a1 / move.l (a3)+,(a1)`.
     *
     * The manual's "NUM may range from 0 to 255" is a description of what is
     * useful rather than a limit the library imposes -- it stores the whole
     * longword and `Lstr` compares it with `cmp.b`, so only the low byte is
     * ever consulted. Masking here is the same thing observed.
     */
    'lset eoln'(it) {
      rt.ldos.eoln = it.evalInt() & 0xff
    },
    /**
     * Lbstr A$,START — routine 10 ($1084), 32 bytes and the thinnest keyword
     * in the extension: it pops the address and the string, takes the length
     * word, and is a straight `jsr -$270(a6)` to exec's CopyMem. A zero
     * length skips the call entirely; nothing else is checked, which is the
     * manual's "No check is done to see whether the bufferlimit was exceeded
     * or not".
     *
     * DEVIATION: writes are bounded by the region they land in rather than
     * running on into whatever follows, and an address in no region at all
     * raises error 18 where the library would simply scribble. There is no
     * error arm in routine 10 to be faithful to.
     */
    lbstr(it) {
      const s = it.evalStr()
      it.expect(',')
      const addr = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (!m) throw new AmosError('You can not call with an empty argument!')
      const n = Math.min(s.length, m.data.length - m.off)
      for (let i = 0; i < n; i++) m.data[m.off + i] = s.charCodeAt(i) & 0xff
    },
    /**
     * Lreplace SEARCH,SWAP,START To STOP — routine 42 ($1bc0). "If SEARCH is
     * found it will be replaced by the SWAP-value."
     *
     *     movea.l (a3)+, a1 / movea.l (a3)+, a0     STOP, then START
     *     move.l  (a3)+, d1 / move.l (a3)+, d0      SWAP, then SEARCH
     *     movea.l a1, a2 / suba.l a0, a2 / bpl .ok
     *     moveq   #$8, d0 / Rbra 91                 error 8
     *  .ok: move.b -(a0), d5                        step BEFORE the range
     *  .loop: cmpa.l a1, a0 / beq .end
     *     move.b (a0)+, d5 / cmp.b (a0), d0 / bne .loop
     *     move.b d1, (a0) / bra .loop
     *
     * The pre-decrement and the post-increment together make STOP INCLUSIVE:
     * the byte examined each pass is the one at the address a0 was just
     * advanced TO, and the loop only exits once a0 has reached STOP, by which
     * point STOP's own byte has already been tested. This port had it
     * exclusive.
     *
     * The `move.b -(a0),d5` before the loop reads one byte below START and
     * throws it away, which is harmless but is why the walk lines up.
     */
    lreplace(it) {
      const search = it.evalInt() & 0xff
      it.expect(',')
      const swap = it.evalInt() & 0xff
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const stop = it.evalInt()
      if (stop < start) throw new AmosError('Start is greater than max limit!')
      const r = region(rt, start, stop + 1)
      if (!r) return
      for (let i = r.from; i < r.to; i++) if (r.data[i] === search) r.data[i] = swap
    },
    /**
     * Lfilter LOW,HIGH,SWAP,START To STOP — routine 43 ($1bf6), the same walk
     * as Lreplace with a two-sided test. "Everything between LOW and HIGH
     * (INCLUDING LOW and HIGH) will be replaced by SWAP."
     *
     *     cmp.b (a0), d0 / bhi .next        LOW  above the byte: skip
     *     cmp.b (a0), d1 / bcs .next        HIGH below the byte: skip
     *     move.b d2, (a0)
     *
     * `bhi` and `bcs` are the unsigned pair, so the range is over 0..255 and
     * the manual's "INCLUDING LOW and HIGH" is exact -- both comparisons skip
     * only on a strict inequality. STOP is inclusive here too, and a STOP
     * below START is error 8.
     */
    lfilter(it) {
      const low = it.evalInt() & 0xff
      it.expect(',')
      const high = it.evalInt() & 0xff
      it.expect(',')
      const swap = it.evalInt() & 0xff
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const stop = it.evalInt()
      if (stop < start) throw new AmosError('Start is greater than max limit!')
      const r = region(rt, start, stop + 1)
      if (!r) return
      for (let i = r.from; i < r.to; i++) {
        const b = r.data[i]!
        if (b >= low && b <= high) r.data[i] = swap
      }
    },
    /**
     * Lset Comment "FileName","Comment" — routine 15 ($11e8). '"Comment" may
     * not be longer than 79 characters and also works on directories as
     * well.'
     *
     *     Rbsr    routine 14                  the shared lock-and-Examine
     *     cmpa.l  #$0, a0 / bne .ok
     *     Rbra    routine 91                  ...with routine 14's own d0
     *  .ok: lea $90(a0), a0                   fib_Comment
     *     move.w (a1)+, d0 / subq.w #$1, d0
     *     cmp.l  #$4e, d0 / bls .fits
     *     moveq  #$5, d0 / Rbra 91            error 5, "Invalid comment"
     *  .fits: ...copy into the FIB, then jsr -$b4(a6)   SetComment
     *
     * The 79 is `cmp.l #$4e` against the length LESS ONE, so it is exact and
     * it is an ERROR rather than a truncation -- this port was silently
     * cutting the comment at MAX_COMMENT. The comment is staged in the shared
     * FileInfoBlock's own comment field before SetComment is called, which is
     * why an Lcat scan in progress loses its comment when this runs; that is
     * invisible here because the scan holds its entries rather than a FIB.
     */
    'lset comment'(it) {
      const path = it.evalStr()
      it.expect(',')
      const comment = it.evalStr()
      if (comment.length > MAX_COMMENT) throw new AmosError('Invalid comment')
      rt.vfs?.setMeta(path, { comment })
    },
    /**
     * Lset Prot "FileName",MASK — routine 17 ($129c). 'MASK is a bitpattern
     * like above', e.g. %00000000 meaning ----rwed.
     *
     *     move.l (a3)+, d2 / movea.l (a3)+, a0     MASK, then the name
     *     move.w (a0)+, d0 / subq.w #$1, d0 / bpl .ok
     *     moveq  #$3, d0 / Rbra 91                 error 3, empty name
     *  .ok: ...copy the name... / jsr -$ba(a6)     SetProtection
     *     tst.l d0 / bne .done
     *     moveq  #$6, d0 / Rbra 91                 error 6
     *
     * Two error arms this port had neither of: an empty name is error 3, and
     * SetProtection answering zero -- which is what a name that does not
     * exist gives -- is error 6, "Unable to set protection-flags". Unlike
     * Lset Comment it does not lock or Examine first; it hands the name
     * straight to dos.library.
     *
     * DEVIATION: the mask is passed to SetProtection as a full longword and
     * is stored as a byte here, so the four AmigaDOS-reserved upper bits do
     * not survive. Nothing reads them: Lget Prot reads fib_Protection back
     * through the same byte.
     */
    'lset prot'(it) {
      const path = it.evalStr()
      it.expect(',')
      const mask = it.evalInt() & 0xff
      if (path.length === 0) throw new AmosError('Invalid filename')
      // SetProtection answers zero for a name that is not there, and `setMeta`
      // answers true for any resolvable path, so existence is the real test
      if (rt.vfs?.exists(path) == null) throw new AmosError('Unable to set protection-flags')
      rt.vfs.setMeta(path, { protection: mask })
    },
    /**
     * Lcat Push ADR / Lcat Pull ADR — routines 70 ($32f4) and 71 ($3336),
     * mirror images and neither of them checks anything at all:
     *
     *   push: movea.l (a3)+, a1
     *         move.l  $294(...), (a1)+          the lock, four bytes
     *         move.l  #$0, $294(...)            ...then cleared
     *         move.l  #$104, d0 / subq.w #$1, d0
     *         move.b  (a0)+, (a1)+ / dbra       260 bytes of the FIB
     *
     * 4 + 260 = the 264 the manual quotes: "Each time you push something 264
     * bytes are used and the next datas should thus be copied to ADR+264".
     * Pull is the same two moves the other way round.
     *
     * Push does NOT test the lock first, so pushing with no scan open stores
     * a zero and a stale FileInfoBlock -- and pull does not test it either.
     * The manual's "If ADR points to NULLs (empty bank) you will receive the
     * errormessage 'No more entries in this dir'" is therefore describing
     * something that happens LATER: the zero lands at $294 and the next Lcat
     * accessor takes its own error-7 arm. This port raised at the Lcat Pull
     * line instead, which reports the right thing at the wrong statement.
     *
     * DEVIATION: the 264 bytes written are a cookie rather than a real lock
     * and FileInfoBlock, because the scan is held beside the bank here. A
     * program that pushes and pulls sees no difference; one that reads the
     * bank's bytes would.
     */
    'lcat push'(it) {
      const addr = it.evalInt()
      const c = rt.ldos.cat
      rt.ldos.pushed.set(addr, c)
      rt.ldos.cat = null
      const m = rt.resolveWrite(addr)
      if (m && m.off < m.data.length) m.data[m.off] = c ? 0x4c : 0 // 'L'
    },
    'lcat pull'(it) {
      const addr = it.evalInt()
      // an address never pushed to reads as a bank full of zeros, which is a
      // null lock — the same state pushing an unopened catalogue leaves
      rt.ldos.cat = rt.ldos.pushed.get(addr) ?? null
      rt.ldos.pushed.delete(addr)
      const m = rt.resolveWrite(addr)
      if (m && m.off < m.data.length) m.data[m.off] = 0
    },
    /**
     * LLdir$ "new-dir" — routine 82 ($37de). LDos keeps its own current
     * directory, because on the real machine it never sees AMOS's Dir$
     * changes; the manual's own advice is "Set Dir\$ to desired value, and
     * call LLdir\$ Dir\$".
     *
     *     move.w (a0)+, d0 / cmp.w #$0, d0 / bls .bad
     *     ...copy the name...
     *     move.l #$fffffffe, d2 / jsr -$54(a6)     Lock, ACCESS_READ
     *     beq .nodir
     *     move.l d0, d1 / jsr -$7e(a6)             CurrentDir
     *  .bad:  moveq #$12, d0 / Rbra 91             error 18
     *  .nodir: moveq #$16, d0 / Rbra 91            error 22
     *
     * Two error arms, neither of them in this port: an empty string is error
     * 18 and a directory that will not lock is error 22, "LLdir\$ can't find
     * directory!". Anything lockable is accepted -- Lock does not care
     * whether it is a directory -- so the error's wording is broader than
     * what it tests.
     *
     * NOTE: the lock is never released, and neither is the one CurrentDir
     * hands back. That is a leak per call in the library and there is nothing
     * to reproduce here, where the current directory is a string.
     */
    lldir$(it) {
      const dir = it.evalStr()
      if (dir.length === 0) throw new AmosError('You can not call with an empty argument!')
      if (rt.vfs?.exists(dir) == null) throw new AmosError("LLdir$ can't find directory!")
      rt.ldos.cwd = dir
    },
    lcrypt(it) {
      // Lcrypt START,LONGS,"password" — "LONGS is the length divided by four.
      // Fx LONGS=Length(10)/4 ... the password is casesensitive!"
      const start = it.evalInt()
      it.expect(',')
      const longs = it.evalInt()
      it.expect(',')
      const key = ldosKey(it.evalStr())
      const m = rt.resolveAddr(start)
      if (!m) return
      const n = Math.min(longs, (m.data.length - m.off) >> 2)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off)
      for (let i = 0; i < n; i++) {
        v.setUint32(i * 4, ((((v.getUint32(i * 4, false) + 0x20) >>> 0) ^ key) >>> 0), false)
      }
    },
    ldecrypt(it) {
      // The exact inverse, and the only one of the pair that checks the
      // password: cmp.w #4,d0 / bcc. Lcrypt has no such check at all.
      const start = it.evalInt()
      it.expect(',')
      const longs = it.evalInt()
      it.expect(',')
      const password = it.evalStr()
      if (password.length < 4) throw new AmosError('To short password-string!')
      const key = ldosKey(password)
      const m = rt.resolveAddr(start)
      if (!m) return
      const n = Math.min(longs, (m.data.length - m.off) >> 2)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off)
      for (let i = 0; i < n; i++) {
        v.setUint32(i * 4, (((v.getUint32(i * 4, false) ^ key) >>> 0) - 0x20) >>> 0, false)
      }
    },
    /**
     * Lpp Decrunch START,END To DEST — routine 41 ($1b02), 190 bytes, and the
     * PowerPacker decoder inlined rather than called: `move.l $4(a2),d0`
     * takes the four efficiency bytes from the file's own header, `move.l
     * -(a0),d5` starts at the END and walks BACKWARDS, and the bit reader at
     * $1ba2 is `lsr.l #$1,d5 / roxl.l #$1,d1` refilling from `move.l -(a0),d5`
     * every 32 bits. That is PP20 exactly as ../amiga/powerpacker.ts decodes
     * it, so the shared decoder is the right one and its proof carries over.
     *
     * The three arguments unpile to a2 = the file START (where the header
     * is), a0 = its END, a1 = the destination END.
     *
     * "no test is done to see if the bank really contains a powerpacked file!
     * Be careful!" is literal -- there is no check anywhere in the routine.
     * DEVIATION: a bank that is not PP20 decrunches to nothing here rather
     * than scribbling over memory, which is as far as the warning goes.
     */
    'lpp decrunch'(it) {
      const start = it.evalInt()
      it.expect(',')
      const end = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const src = rt.resolveAddr(start)
      const dst = rt.resolveWrite(dest)
      if (!src || !dst || end <= start) return
      const file = src.data.subarray(src.off, src.off + Math.min(end - start, src.data.length - src.off))
      let outBytes: Uint8Array
      try {
        outBytes = pp20Decrunch(file)
      } catch {
        return // not a PowerPacked file
      }
      const n = Math.min(outBytes.length, dst.data.length - dst.off)
      dst.data.set(outBytes.subarray(0, n), dst.off)
    },
    /**
     * THE REQUESTER SETTINGS — Lset Freq Dir, Lpos Freq, Lcust Freq, and the
     * three readers Lget Freq Dir/File and Lfontsize Freq beside Lfreq below.
     *
     * All six are pure field access on LDos's workspace, and the routines are
     * short enough to be quoted whole. The map, from routines 34 ($19fe), 72
     * ($3372), 73 ($3390), 36 ($1a32), 37 ($1a7e) and 75 ($33d6):
     *
     *     +$314 +$316 +$318   Lcust Freq's three words, stored in REVERSE
     *                         argument order
     *     +$368 +$36a         Lpos Freq's two, first argument to $368
     *     +$36c               the font size Lfontsize Freq reads
     *     +$502               Lset Freq Dir's path, NUL-terminated
     *     +$586               the selected filename Lget Freq File reads
     *
     * None of them validates anything: Lset Freq Dir's copy is the same
     * `subq.w #$1,d0` dbra that overruns on an empty string, and the two
     * readers scan for a NUL with no ceiling. Both readers answer the shared
     * empty string when the field's first byte is zero, which is how the
     * manual's "A\$ will NOT empty even if the user clicked CANCEL" is
     * implemented -- nothing clears the field, rather than anything
     * remembering it.
     */
    'lset freq dir'(it) {
      // "If you haven't set path, the filerequester will use your programs
      // current directory ... This path does not affect AMOS's (Dir$) path"
      rt.ldos.freqDir = it.evalStr()
    },
    'lpos freq'(it) {
      // Lpos Freq X,Y — "only be used if the $40-flag is specified,
      // otherwise the requester pops up at the mousepointer"
      rt.ldos.freqX = it.evalInt()
      it.expect(',')
      rt.ldos.freqY = it.evalInt()
    },
    'lcust freq'(it) {
      // Lcust Freq DEVWIDTH,FILEWIDTH,FILES — "Default values are 12,30,14"
      rt.ldos.freqDevWidth = it.evalInt()
      it.expect(',')
      rt.ldos.freqFileWidth = it.evalInt()
      it.expect(',')
      rt.ldos.freqFiles = it.evalInt()
    },
    /**
     * Lupbuffer START To STOP — routine 44 ($1c34). "Just like AMOS Upper\$
     * this routine won't handle national characters (due to AMOS isn't using
     * a standard keymap). Only A-Z and a-z are processed."
     *
     *     movea.l a1, a2 / suba.l a0, a2 / bpl .ok
     *     moveq  #$8, d0 / Rbra 91         error 8, as the other ranges
     *  .ok: move.b -(a0), d5
     *  .loop: move.b (a0)+, d5             advance FIRST...
     *     cmpa.l a0, a1 / beq .end         ...then test for the end
     *     cmpi.b #$60, (a0) / bls .loop
     *     cmpi.b #$7b, (a0) / bcc .loop
     *     subi.b #$20, (a0) / bra .loop
     *
     * The bounds are exact: `bls #$60` passes $61 and up, `bcc #$7b` passes
     * $7a and down, so the range really is a-z. Llobuffer's are not.
     *
     * STOP is EXCLUSIVE here, and INCLUSIVE in Llobuffer below. The two
     * routines are otherwise the same loop; the difference is one
     * instruction's position -- Lupbuffer increments before the end test and
     * Llobuffer after it -- and it means `Lupbuffer a To b` covers a..b-1
     * where `Llobuffer a To b` covers a..b. The manual describes them in one
     * shared sentence and cannot distinguish them.
     */
    lupbuffer(it) {
      const start = it.evalInt()
      it.expect('to')
      const stop = it.evalInt()
      if (stop < start) throw new AmosError('Start is greater than max limit!')
      const r = region(rt, start, stop)
      if (!r) return
      for (let i = r.from; i < r.to; i++) {
        const b = r.data[i]!
        if (b >= 0x61 && b <= 0x7a) r.data[i] = b - 32
      }
    },
    /**
     * Llobuffer START To STOP — routine 45 ($1c72). The manual calls it
     * "Llowbuffer"; the token table says Llobuffer, and the table is what a
     * program is written against.
     *
     *     cmpi.b #$3f, (a0) / bls .loop
     *     cmpi.b #$5c, (a0) / bcc .loop
     *     addi.b #$20, (a0)
     *
     * DEFECT: those bounds are one out at BOTH ends. `bls #$3f` passes $40
     * and up where A is $41, and `bcc #$5c` passes $5b and down where Z is
     * $5a -- so `@` becomes a backtick and `[` becomes `{`, and the manual's
     * "Only A-Z and a-z are processed" is untrue of this half of the pair.
     * Lupbuffer's equivalents are exact, which is what makes it a slip rather
     * than a convention. Reproduced.
     */
    llobuffer(it) {
      const start = it.evalInt()
      it.expect('to')
      const stop = it.evalInt()
      if (stop < start) throw new AmosError('Start is greater than max limit!')
      const r = region(rt, start, stop + 1) // ...and here STOP is inclusive
      if (!r) return
      for (let i = r.from; i < r.to; i++) {
        const b = r.data[i]!
        if (b >= 0x40 && b <= 0x5b) r.data[i] = b + 32
      }
    },
  }
}

/**
 * The single-block ceiling `Llargest Free` reports against.
 *
 * LDos's policy, not exec's, which is why it is here: exec models a pool that
 * does not fragment, so its largest-block answer is the whole free total. This
 * keyword's manual insists the two differ, and half a megabyte is a plausible
 * largest bank on the machines LDos shipped for.
 */
const LDOS_LARGEST_BLOCK = 0x80000

/**
 * The longest pattern `Lwild` and `Lmatch` will hand to ParsePattern.
 *
 * `cmp.w #$32,d0 / bls` in routines 80 and 61. The destination is 98 bytes
 * (`moveq #$62,d3`) at the workspace scratch buffer, and ParsePattern needs
 * rather more than twice the source, so fifty is the author sizing his check
 * to his buffer rather than to anything in dos.library.
 */
const LDOS_PATTERN_MAX = 50

/**
 * dos.library 37+ is present, so the guard three keywords share never fires.
 *
 * `Lwild`, `Lmatch` and `Lset File Date` all open with `tst.w $2fa(...)` on
 * LDos's workspace and raise error 15, "You need dos.library 37+", when it is
 * zero. The word is set by the library's own init from the version it found;
 * ParsePattern, MatchPattern and SetFileDate are all V36/V37 entry points and
 * LDos will not call them on a 1.3 machine. The modelled machine is a 2.0+
 * one throughout -- src/amiga/exec.ts answers for the libraries -- so the
 * flag is set and error 15 is unreachable here. It is documented rather than
 * implemented because there is no way to reach it, not because it was
 * skipped: see the NOTES entries on all three keywords.
 */

export function makeLdosFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * =Ldevice Open(NAME$,UNIT,FLAGS) --- routine 31 ($18ca). A channel
     * already open is error 9, "Device already open"; otherwise
     * `FindTask(NULL)` fills the port's mp_SigTask, `AddPort` links it, the
     * name is copied and NUL-terminated, and `OpenDevice` runs. The answer is
     * OpenDevice's own result, so ZERO means success -- the opposite way round
     * from most of this library.
     *
     * There is one channel, not eight: the IORequest is a fixed block at
     * +$298 of the workspace. Which names open is `DEV_MODELLED` in
     * device.ts, the same four the core `Dev *` family can reach.
     */
    'ldevice open'(_, a): Value {
      const st = rt.ldos
      if (st.device) throw new AmosError('Device already open')
      const name = a[0]!.k === 'str' ? a[0]!.s : ''
      const unit = int(a[1]!)
      const flags = int(a[2]!)
      if (!DEV_MODELLED.has(name.toLowerCase())) return VI(-1) // IOERR_OPENFAIL
      let serial
      if (name.toLowerCase() === 'serial.device') {
        serial = rt.host?.serial?.open(unit, DEV_SERIAL_DEFAULTS) ?? undefined
        if (!serial) return VI(-1)
      }
      st.device = { name, unit, flags, error: 0, ...(serial ? { serial } : {}) }
      return VI(0)
    },

    /**
     * =Ldevice(COMMAND,DATA,LENGTH,OFFSET) --- routine 33 ($19a4). No channel
     * is error 10, "Device not open". The four arguments go straight into the
     * IORequest -- io_Command at $1c, io_Data at $28, io_Length at $24 and
     * io_Offset at $2c -- then `DoIO`, and the answer is io_Actual at $20.
     *
     * This is the same transfer the core `Dev Do` performs; the difference is
     * only that LDos passes the fields as arguments where the core family has
     * the program Doke them into the request itself.
     */
    'ldevice'(_, a): Value {
      const d = rt.ldos.device
      if (!d) throw new AmosError('Device not open')
      const r = rt.devTransfer(d.name, d.unit, d.serial, int(a[0]!), int(a[2]!), int(a[1]!), int(a[3]!))
      d.error = r.error
      return VI(r.actual)
    },

    /**
     * =Ldevice Error --- routine 39 ($1ad8), six instructions: `move.b
     * $1f(a1),d3` with d3 cleared first, so io_Error comes back as an
     * UNSIGNED byte. A device error of -1 therefore reads as 255.
     */
    'ldevice error': (): Value => VI(rt.ldos.device ? rt.ldos.device.error & 0xff : 0),

    /**
     * A=Lload(Channel,DEST,LENGTH) and A=Lsave(Channel,SOURCE,LENGTH) —
     * routines 3 ($f0c) and 4 ($f54) in 2.6, seventy-two bytes each and
     * identical for their first eight instructions. They share Lseek's channel
     * handling exactly:
     *
     *     move.l (a3)+, d3 / d2 / d5        LENGTH, DEST, then the CHANNEL
     *     Rbsr   routine 5                  clamps d5 to 0 unless it is 1..3
     *     tst.w  d5 / bne .ok
     *     moveq  #$0, d0 / Rbra routine 91  error 0: a bad channel NUMBER
     *  .ok: subq.w #$1, d5 / mulu.w #$4, d5
     *     movea.l $188(a5), a6 / lea (a6, d5.w), a4
     *     tst.l  (a4)                       ...then error 2 if not OPEN
     *
     * so all three of Lload, Lsave and Lseek distinguish "not a channel
     * number" from "not an open channel", and `channel()` below is that pair.
     */
    lload(_, a) {
      // "A will contain the number of bytes
      // actually read. If A is less than LENGTH you reached the end of the
      // file. If A equals to -1, a filerror occurred. It is perfectly legal
      // to request more data than the file contains, no error will be
      // produced because of this."
      const c = channel(rt, int(a[0] ?? VI(0)))
      const dest = int(a[1] ?? VI(0))
      const len = int(a[2] ?? VI(0))
      const m = rt.resolveWrite(dest)
      if (!m || len < 0) return VI(-1)
      const n = Math.max(0, Math.min(len, c.data.length - c.pos, m.data.length - m.off))
      m.data.set(c.data.subarray(c.pos, c.pos + n), m.off)
      c.pos += n
      return VI(n)
    },
    lsave(_, a) {
      // A=Lsave(Channel,SOURCE,LENGTH). "If A doesn't equal to LENGTH a
      // disk-error probably occurred (like disk full, or write error)".
      const c = channel(rt, int(a[0] ?? VI(0)))
      const src = int(a[1] ?? VI(0))
      const len = int(a[2] ?? VI(0))
      const m = rt.resolveAddr(src)
      if (!m || len < 0) return VI(-1)
      const n = Math.max(0, Math.min(len, m.data.length - m.off))
      ensure(c, c.pos + n)
      c.data.set(m.data.subarray(m.off, m.off + n), c.pos)
      c.pos += n
      c.dirty = true
      return VI(n)
    },
    /**
     * P=Lseek(Channel,POS) — 2.6's routine 6 ($fb4), 96 bytes. "Offsets are
     * relative to the BEGINNING of the file ... If POS is <0 no movement will
     * take place, and the current position in the file will be returned."
     *
     * The channel check is shared with Lload and Lsave, routine 5, and it is
     * a clamp rather than a test: `cmp.w #$3,d5 / bls` then `cmp.w #$1,d5 /
     * bcc`, and anything outside 1..3 is forced to zero. The caller then sees
     * the zero and takes its own error arm:
     *
     *     tst.w d5 / bne .ok
     *     moveq #$0, d0 / Rbra routine 91      bad channel NUMBER
     *  .ok: subq.w #$1, d5 / mulu.w #$4, d5    ...into the table at $188(a5)
     *     tst.l (a4) / bne .open
     *     moveq #$2, d0 / Rbra routine 91      channel not OPEN
     *
     * so a number outside 1..3 and a number that is simply not open are two
     * different errors, 0 and 2.
     *
     * READ AGAINST 2.6, deliberately. 2.5's same routine is 408 bytes because
     * the error arms are replaced by the shareware nag -- a COLOR00/BPLCON1
     * colour storm and a printed "UNREGISTERED SHAREWARE" banner. The header
     * above explains why 2.6 is the better evidence for everything except the
     * version string.
     */
    lseek(_, a) {
      const c = channel(rt, int(a[0] ?? VI(0)))
      const pos = int(a[1] ?? VI(0))
      if (pos < 0) return VI(c.pos)
      c.pos = pos
      return VI(pos)
    },
    /**
     * S=Lsize("FileName") — 2.6's routine 28 ($17cc), and in the clean build
     * it is twelve instructions:
     *
     *     movea.l (a3)+, a0
     *     Rbsr    routine 14          lock and Examine into a FileInfoBlock
     *     tst.l   (a0) / bne .ok
     *     Rbra    routine 91          nothing there
     *  .ok: move.l $7c(a0), d3        fib_Size
     *
     * $7c is fib_Size in `struct FileInfoBlock` (../amiga/dos.ts), which is
     * also why the manual's "if 'FileName' is a directory zero is always
     * returned" needs no special case in the library: AmigaDOS leaves fib_Size
     * zero for a directory, so the same field answers both.
     */
    lsize(_, a) {
      const path = str(a[0] ?? VS(''))
      if (rt.vfs?.exists(path) === 'dir') return VI(0)
      return VI(rt.fs?.read(path)?.length ?? 0)
    },
    /**
     * A=Lfile Type("FileName") — 2.6's routine 29 ($17f0), Lsize's twin: the
     * same lock-and-Examine through routine 14, the same null check, and then
     * one different offset, `move.l $4(a0),d3` where Lsize takes $7c.
     *
     * $4 is fib_DirEntryType. So the manual's "A is greater than 0 if it is a
     * directory, or negative if it is a file" is AmigaDOS's own field handed
     * straight back, which fixes the VALUES as well as the signs: ST_USERDIR
     * is 2 and ST_FILE is -3, not 1 and -1.
     */
    'lfile type'(_, a) {
      const path = ldosPath(rt, str(a[0] ?? VS('')))
      const kind = rt.vfs?.exists(path) ?? (rt.fs?.read(path) != null ? 'file' : null)
      return VI(kind === 'dir' ? ST_USERDIR : ST_FILE)
    },
    /**
     * NUM=Lwords(STRING$) and A$=Lword(WORD,STRING$) — routines 79 ($3694,
     * 144 bytes) and 78 ($3568, 300). Lword calls Lwords first (`Rbsr routine
     * 79`) to get the count, then refuses an index above it (`cmp.l d1,d3 /
     * bcs`) and an index of zero separately.
     *
     * The separator set is four `cmpi.b` in Lwords and is exactly what
     * `ldosWords` implements:
     *
     *     cmpi.b #$22, (a0)     a double quote GROUPS rather than separates
     *     cmpi.b #$20, (a0)     space
     *     cmpi.b #$2c, (a0)     comma
     *     cmpi.b #$9,  (a0)     tab
     *
     * "If STRING$ is empty zero is returned" is the `cmp.b #$0,d0 / beq` on
     * the length word before any of that.
     */
    lwords(_, a) {
      return VI(ldosWords(str(a[0] ?? VS(''))).length)
    },
    lword(_, a) {
      // A$=Lword(WORD,STRING$). "The first word in STRING$ is 1 (not zero)
      // ... If you request a word which doesn't exist an error will be
      // produced."
      const n = int(a[0] ?? VI(0))
      const words = ldosWords(str(a[1] ?? VS('')))
      if (n < 1 || n > words.length) throw new AmosError('No enough words in string!')
      return VS(words[n - 1]!)
    },
    /**
     * TEST=Lwild(A$) — routine 80 ($3724), a thin wrapper over dos.library
     * ParsePattern with two guards in front of it:
     *
     *     movea.l $188(a5), a1 / adda.l #$2fa, a1
     *     tst.w  (a1) / bne .have37
     *     moveq  #$f, d0 / Rbra 91           error 15, dos.library 37+
     *  .have37: movea.l (a3)+, a0
     *     move.w (a0)+, d0
     *     cmp.w  #$32, d0 / bls .ok
     *     moveq  #$10, d0 / Rbra 91          error 16, pattern too long
     *  .ok: moveq #$62, d3                   98 bytes of destination
     *     move.l a0, d1 / jsr -$348(a6)      ParsePattern, NOT ...NoCase
     *     move.l d0, d3
     *
     * so the answer is ParsePattern's verbatim -- 0 no wildcards, 1
     * wildcards, -1 unparseable -- and the LVO settles that the matching is
     * CASE SENSITIVE. LDos never calls the NoCase pair at -$3cc/-$3d2, which
     * AMCAF and jd-k3 both do.
     *
     * NOTE: unlike Lmatch below, routine 80 does NOT check that the string is
     * NUL-terminated -- it hands ParsePattern a pointer into the middle of
     * AMOS's string space and lets it read on until it happens to find a zero
     * byte. Here the string ends where it ends. A caller who follows the
     * manual and appends Chr$(0) gets the same answer either way.
     */
    lwild(_, a) {
      const pattern = str(a[0] ?? VS(''))
      if (pattern.length > LDOS_PATTERN_MAX) throw new AmosError('To long pattern/overflow/or no pattern')
      // ParsePattern consults RNF_WILDSTAR, so whether `*` counts as a
      // wildcard here depends on the machine — see Lmatch below
      return VI(parsePatternResult(pattern, rt.machine.wildStar))
    },
    /**
     * L=Lmatch(SOURCE$,S$) — routine 61 ($23c4), 156 bytes, and it checks far
     * more than Lwild does. The pattern is popped FIRST (it is the last
     * argument), the source is held in d7:
     *
     *     tst.w $2fa(...) / beq -> error 15         dos.library 37+
     *     movea.l (a3)+, a0 / move.l (a3)+, d7      PATTERN, then SOURCE
     *     move.w (a0)+, d0 / subq.w #$1, d0
     *     cmpi.b #$0, (a0, d0.w) / beq .term
     *     moveq  #$17, d0 / Rbra 91                 error 23
     *  .term: addq.w #$1, d0 / cmp.w #$32, d0 / bls .fits
     *     moveq  #$10, d0 / Rbra 91                 error 16
     *  .fits: jsr -$348(a6)                         ParsePattern
     *     cmp.l  #$0, d0 / bne .wild
     *     moveq  #$10, d0 / Rbra 91                 error 16 AGAIN
     *  .wild: ...the same NUL check on SOURCE, error 23...
     *     jsr -$34e(a6)                             MatchPattern
     *
     * Three things this port had wrong. The manual's "PLEASE NOTE THAT BOTH
     * STRINGS MUST BE NULL-TERMINATED (+Chr\$(0))" is not a calling
     * convention to be quietly absorbed -- it is CHECKED, on both strings,
     * and a string without one is error 23. And ParsePattern answering 0
     * takes the error arm too: a pattern with no wildcards in it is rejected,
     * which is what the "or no pattern" in error 16's text means. The port
     * stripped the terminator and accepted a plain string as a pattern.
     *
     * The length limit of 50 counts the terminator, because it is measured
     * after the `addq.w #$1` that undoes the index adjustment.
     */
    lmatch(_, a) {
      const nul = (v: string): string => {
        if (!v.endsWith('\0')) throw new AmosError('Command need NULL-terminated string!')
        return v.slice(0, -1)
      }
      const raw = str(a[1] ?? VS(''))
      const pattern = nul(raw)
      if (raw.length > LDOS_PATTERN_MAX) throw new AmosError('To long pattern/overflow/or no pattern')
      // RNF_WILDSTAR is a property of the machine's RootNode, not of whoever
      // set it: ParsePattern consults it on every call, so a program that has
      // used JD-K3's Jd Star Joker On gets `*` here too. See
      // ../amiga/machine.ts, and jdk3.ts routines 11 and 12 for where it is
      // set. It decides the "no pattern" arm as well: `*.txt` is a pattern on
      // a machine with the bit set and a plain string on one without
      if (parsePatternResult(pattern, rt.machine.wildStar) <= 0) {
        throw new AmosError('To long pattern/overflow/or no pattern')
      }
      const source = nul(str(a[0] ?? VS('')))
      return VI(amigaMatch(source, pattern, rt.machine.wildStar) ? -1 : 0)
    },
    /**
     * ADR=Lskip(CHAR,START To STOP) — routine 48 ($1d84). "ADR will contain
     * the address AFTER the last CHAR".
     *
     *     movea.l a1, a2 / suba.l a0, a2 / bpl .ok
     *     moveq  #$8, d0 / Rbra 91           error 8
     *  .ok: cmpa.l a1, a0 / beq .done
     *     cmp.b  (a0)+, d0 / beq .ok
     *  .done: move.b -(a0), d5               ...unconditionally
     *     move.l a0, d3
     *
     * DEFECT: the step back at `.done` is on the shared exit, so it undoes
     * the post-increment of the byte that did NOT match -- which is right --
     * but it also fires on the path where the scan simply reached STOP, where
     * there was no increment to undo. Every byte from START to STOP-1 being
     * CHAR therefore answers STOP-1, not STOP, and `Lskip(c, X To X)` answers
     * X-1. Reproduced: the manual's "will stop at STOP" is what the author
     * meant and not what he wrote, and a program that walks a buffer with
     * this will sit on the same byte forever at the end of it.
     */
    lskip(_, a) {
      const ch = int(a[0] ?? VI(0)) & 0xff
      const start = int(a[1] ?? VI(0))
      const stop = int(a[2] ?? VI(0))
      if (stop < start) throw new AmosError('Start is greater than max limit!')
      const r = region(rt, start, stop)
      if (!r) return VI(start - 1)
      let i = r.from
      while (i < r.to && r.data[i] === ch) i++
      const at = start + (i - r.from)
      return VI(at === stop ? at - 1 : at)
    },
    /**
     * ADR=Lback Hunt(CHAR,START To STOP) — routine 74 ($33a8). "Note that
     * START is greater than STOP since this routine works backwards."
     *
     *     movea.l a0, a2 / suba.l a1, a2 / bpl .ok
     *     bra .bad                          -> moveq #$12 = error 18
     *  .ok: cmpa.l a0, a1 / beq .done
     *     cmp.b  -(a0), d0 / bne .ok
     *  .done: move.l a0, d3
     *
     * The comparison is PRE-decrement, so START's own byte is never examined
     * -- the range walked is STOP..START-1, and this port was including
     * START. The reversed argument order gets its own error: a STOP above
     * START is 18, "You can not call with an empty argument!", where every
     * other range keyword here uses 8.
     *
     * A miss answers STOP, which is also what a hit AT STOP answers; the
     * routine has no way to distinguish them and neither does this.
     */
    'lback hunt'(_, a) {
      const ch = int(a[0] ?? VI(0)) & 0xff
      const start = int(a[1] ?? VI(0))
      const stop = int(a[2] ?? VI(0))
      if (start < stop) throw new AmosError('You can not call with an empty argument!')
      const m = rt.resolveAddr(stop)
      if (!m) return VI(stop)
      const span = Math.max(0, Math.min(start - stop, m.data.length - m.off))
      for (let i = span - 1; i >= 0; i--) {
        if (m.data[m.off + i] === ch) return VI(stop + i)
      }
      return VI(stop)
    },
    /**
     * A$=Lget Comment("name") and P=Lget Prot("name") — routines 13 ($10f2)
     * and 16 ($1274). Both lock and Examine through routine 14, take
     * `Rbra routine 91` on a null result, and then read one fixed offset of
     * the FileInfoBlock:
     *
     *     lea    $90(a0), a0     fib_Comment, an 80-byte BSTR area
     *     move.l $74(a0), d3     fib_Protection
     *
     * the same shape as Lsize's $7c and Lfile Type's $4, and the same layout
     * ../amiga/dos.ts models.
     */
    'lget comment'(_, a) {
      // A$=Lget Comment("FileName"). "A$ will contain nothing if there was no
      // filenote. This of course also works on directories."
      return VS(rt.vfs?.meta(str(a[0] ?? VS(''))).comment ?? '')
    },
    'lget prot'(_, a) {
      // A=Lget Prot("FileName") — bit 7 H, 6 S, 5 P, 4 A (active high);
      // bit 3 R, 2 W, 1 E, 0 D (active LOW, so a set bit denies it)
      return VI(rt.vfs?.meta(str(a[0] ?? VS(''))).protection ?? 0)
    },
    /**
     * Ldate — routine 18 ($12e0), 234 bytes of calendar arithmetic, and the
     * two constants that fix its epoch are in the first four instructions:
     * `moveq #$7,d1` and `move.l #$7ba,d3`. $7ba is 1978, the AmigaDOS epoch
     * year, and the leap test right after it is `andi.l #$3,d6 / bne` -- a
     * plain year-mod-4, with no century rule, which is correct for the range
     * a DateStamp can hold.
     */
    ldate(_, a) {
      // A$=Ldate(STAMP). "stamp is the number of days since 1 Jan 1978. A$
      // will be in the form of "YYMMDD" ... If the datestamp is less than
      // zero (below 1 Jan 1978) the string 780101 will be returned."
      const [y, m, d] = stampToYmd(int(a[0] ?? VI(0)))
      const pad = (n: number): string => String(n).padStart(2, '0')
      return VS(`${pad(y % 100)}${pad(m)}${pad(d)}`)
    },
    /**
     * S=Lstamp(YEAR,MONTH,DAY) — routine 19 ($13ca), 156 bytes, and its
     * guards are UNSIGNED, which makes them narrower than they look:
     *
     *     move.l (a3)+, d0          the DAY, popped first
     *     cmp.w  #$0, d0 / bhi .ok  `bhi` is unsigned above
     *     moveq  #$1, d0            ...so only an EXACT zero becomes 1
     *  .ok: move.l (a3)+, d1        the MONTH
     *     cmp.w  #$1, d1 / bhi .ok2
     *     moveq  #$1, d1            0 and 1 both become 1
     *
     * A NEGATIVE day or month has $FFxx in its low word, which is above zero
     * unsigned, so it passes the guard untouched and reaches the arithmetic.
     * "If the date is before 1 Jan 1978, 1 Jan 1978 will still be returned" is
     * the epoch floor further down, not this.
     *
     * DEFERRED: whether `ymdToStamp` reproduces that -- the guard catching
     * only zero, and a negative month reaching the date maths -- is not
     * settled here. See the pass list on #205.
     */
    lstamp(_, a) {
      return VI(ymdToStamp(int(a[0] ?? VI(0)), int(a[1] ?? VI(1)), int(a[2] ?? VI(1))))
    },
    /**
     * TEST=Lset File Date("name",STAMP,MIN,TICKS) — routine 81 ($3772).
     * "TEST will be true (-1) if the call was successful ... MIN are the
     * number of minutes that have passed since midnight. TICKS are the number
     * of ticks that have passed during the last minute (1 tick is the same as
     * a VBL = 1/50 sec)".
     *
     * The three values are stored straight into a DateStamp at the workspace
     * scratch buffer +$50 -- `move.l (a3)+,$8(a0)` TICKS, `$4(a0)` MINUTE,
     * `(a0)` DAYS, in that pop order -- and the whole thing goes to
     * dos.library SetFileDate at -$18c, whose result is returned verbatim. So
     * a name that does not exist answers 0 because SetFileDate fails, which
     * is the same answer the existence check here gives.
     *
     * It opens with the shared `tst.w $2fa(...)` dos.library 37+ guard, error
     * 15; see the constant above for why that cannot fire here.
     *
     * DEFECT: the empty-name check below it is dead code and is not
     * reproduced. `move.w (a1)+,d0 / cmp.w #$0,d0 / bcc` was meant to reject
     * a zero length, but `bcc` on a comparison against zero is always taken
     * -- nothing is ever unsigned-below zero -- so the error-18 arm at $37ba
     * can never be reached. What an empty name actually does is run the same
     * `subq.w #$1,d0` dbra overrun Lopen has, 65536 bytes across LDos's own
     * workspace, and that is not reproducible either.
     */
    'lset file date'(_, a) {
      const path = str(a[0] ?? VS(''))
      if (rt.vfs?.exists(path) == null) return VI(0)
      const ok = rt.vfs.setMeta(path, {
        days: Math.max(0, int(a[1] ?? VI(0))),
        mins: int(a[2] ?? VI(0)),
        ticks: int(a[3] ?? VI(0)),
      })
      return VI(ok ? -1 : 0)
    },
    /**
     * F$=Lcat First("Directory") — routine 20 ($1466), 222 bytes, and a lock
     * rather than a first entry. "If the directory didn't exist the error
     * 'Invalid filename' will be produced".
     *
     *     tst.l $294(...) / beq .fresh
     *     jsr -$5a(a6)                        UnLock any previous scan first
     *  .fresh: move.w (a0)+, d0 / subq.w #$1, d0 / bpl .named
     *     moveq #$3, d0 / Rbra 91             error 3, empty name
     *  .named: move.l #$fffffffe, d2 / jsr -$54(a6)    Lock, ACCESS_READ
     *     tst.l d0 / bne .locked
     *     moveq #$3, d0 / Rbra 91             error 3 again
     *  .locked: move.l d0, (a1)               ...stored at $294
     *     jsr -$66(a6)                        Examine, into the shared FIB
     *     lea $8(a0), a0                      fib_FileName
     *     ...strlen, then build the AMOS string...
     *
     * The returned string is fib_FileName -- the NAME of the locked object,
     * as AmigaDOS reports it -- and NOT the path the caller gave. The manual
     * says Lcat First "actually returns the path, requested by you", which is
     * near enough for `Lcat First("df0:")` and wrong for anything nested: a
     * lock on "DH0:top" answers "top". The binary wins over the manual, and
     * this port was returning the argument.
     *
     * Examine's own result is not tested. A lock that Examine fails on leaves
     * the FIB holding whatever the last scan put there, which is unreachable
     * here because the entries are held rather than a struct.
     */
    'lcat first'(_, a) {
      const arg = str(a[0] ?? VS(''))
      if (arg.length === 0) throw new AmosError('Invalid filename')
      const dir = ldosPath(rt, arg)
      const entries = rt.vfs?.listDir(dir) ?? null
      if (entries === null) throw new AmosError('Invalid filename')
      const sorted = [...entries].sort((x, y) => x.name.localeCompare(y.name))
      rt.ldos.cat = { dir, entries: sorted, index: -1 }
      return VS(fibFileName(dir))
    },
    /**
     * THE Lcat FAMILY — Lcat First, Lcat Next, Lcat Type, Lcat Size, Lcat
     * Blocks, Lcat Prot, Lcat Comment and Lcat Stamp. Read against 2.6, whose
     * error arms are reachable; 2.5 replaces them with the shareware nag.
     *
     * All eight key off two fields of the extension's data block:
     *
     *     $188(a5) + $294    the directory LOCK, a BPTR
     *     $188(a5) + $18c    ONE shared FileInfoBlock, longword-aligned
     *                        (`andi.l #$fffffffc`)
     *
     * and every one but Lcat First opens the same way -- routine 21 ($1544),
     * 22 ($15fe), 24 ($1686) and the rest:
     *
     *     movea.l $188(a5), a0 / adda.l #$294, a0
     *     tst.l   (a0) / bne .ok
     *     moveq   #$7, d0 / Rbra routine 91
     *
     * ERROR 7, which is "No more entries in this dir". So a program that asks
     * for a type or a size with no catalogue open gets an error, not a zero.
     *
     * Lcat Next's tail (:1582) settles what "no catalogue" covers. When ExNext
     * (`jsr -$6c(a6)`) fails it does not merely stop:
     *
     *     movea.l $188(a5), a1 / adda.l #$294, a1
     *     move.l  (a1), d1
     *     move.l  #$0, (a1)        the stored lock is CLEARED
     *     jsr     -$5a(a6)         ...and UnLocked
     *
     * so running off the end releases the lock, and every accessor afterwards
     * takes the error-7 arm. There is no state in which the library holds a
     * lock but has no current entry, which is why the two cases collapse here
     * into one `catNow` and why answering 0 was wrong in both.
     */
    'lcat next'(_) {
      // "If F$ is empty, there are no more files/directories in this
      // directory. Lcat Next won't work if you haven't used Lcat First."
      const c = rt.ldos.cat
      if (!c) return VS('')
      c.index++
      const e = c.entries[c.index]
      // ExNext failing UnLocks and clears, so the catalogue is gone, not spent
      if (!e) rt.ldos.cat = null
      return VS(e ? e.name : '')
    },
    'lcat type'(_) {
      // "A can be either positive, for directories, or negative for files" —
      // and the routine is simply `move.l $4(a0),d3` over a FileInfoBlock,
      // so what comes back is fib_DirEntryType itself: 2 for a directory,
      // -3 for a file.
      const e = catNow(rt)
      return VI(e.isDir ? ST_USERDIR : ST_FILE)
    },
    'lcat size'(_) {
      // "it is fully legal to call this command even if the current 'file' is
      // a directory! If the current name belongs to a directory S will
      // contain 0. (Keep in mind that files which are zero bytes do exist, so
      // don't use this method instead of Lcat Type)"
      const e = catNow(rt)
      return VI(e.isDir ? 0 : e.size)
    },
    'lcat blocks'(_) {
      // "FFS can hold 512 bytes of data in one block"
      const e = catNow(rt)
      return VI(e.isDir ? 0 : blocksFor(e.size))
    },
    'lcat prot'(_) {
      const e = catNow(rt)
      return VI(rt.vfs?.meta(e.path).protection ?? 0)
    },
    'lcat comment'(_) {
      const e = catNow(rt)
      return VS(rt.vfs?.meta(e.path).comment ?? '')
    },
    'lcat stamp'(_) {
      const e = catNow(rt)
      return VI(rt.vfs?.meta(e.path).days ?? 0)
    },
    /**
     * A$=Ldev First(ADR) and A$=Ldev Next(ADR) — routines 76 ($33e8) and 77
     * ($3496). "Please note that the devicename (like DF0: etc.) NOT contains
     * a colon", which is the BSTR's own content: the name comes from
     * dn_Name at +$28 and the leading length byte is stepped over.
     *
     * The walk is AmigaDOS's device list, followed by hand:
     *
     *     movea.l $22(a6), a0        DosLibrary->dl_Root
     *     move.l $18(a0), d0 / asl.l #$2, d0     rn_Info    -> DosInfo
     *     move.l $4(a0), d0  / asl.l #$2, d0     di_DevInfo -> DeviceNode
     *     move.l a0, $80(a4)                     ...remembered as the cursor
     *
     * and Ldev Next follows dn_Next at +$0. ADR receives twenty longwords:
     * dn_Type, then -- when dn_Startup at +$1c is above 2, i.e. a real BPTR
     * rather than a handler's flag -- fssm_Unit, a pointer to the device
     * name, and seventeen longs of DosEnvec. When it is not, or when
     * fssm_Environ is null, the rest is filled with zeros instead.
     *
     * Exhaustion has two steps, and this port had neither. A null dn_Next
     * writes -1 into the cursor and returns the EMPTY string; a call after
     * that finds the -1 and raises error 20, "No more devices in system!".
     * So the end of the walk can be read once and only once.
     *
     * DEVIATION: the twenty longwords are not written. The volume list here
     * has no DeviceNode behind it -- no unit number, no handler name, no
     * DosEnvec geometry -- so ADR is accepted and ignored, and a program that
     * reads the block back gets whatever was in its bank.
     */
    'ldev first'(_) {
      const names = [...(rt.vfs?.volumeNames() ?? []), ...(rt.vfs?.assignNames() ?? [])]
      rt.ldos.devices = { names, index: 0 }
      return VS(names[0] ?? '')
    },
    'ldev next'(_) {
      const d = rt.ldos.devices
      if (!d) return VS('')
      // `cmpa.l #$ffffffff,a0 / beq` -> error 20, one call past the end
      if (d.index >= d.names.length) throw new AmosError('No more devices in system!')
      d.index++
      return VS(d.names[d.index] ?? '')
    },
    /**
     * A$=Lfreq("Title",FLAGS) -- routine 30 ($1818). "A$ will contain the
     * full path and filename after the call. If the user clicked cancel, A$
     * will be empty."
     */
    lfreq(it, a) {
      // Routine 30 ($1818) confirms the manual's aside ("Currently the
      // req.library doesn't support CG-fonts"): the FLAGS go to the workspace
      // at +$31a, the title is copied to +$c and its pointer to +$2fe, a
      // 256-byte result buffer at +$460 is handed over at +$30a, and the
      // whole thing is one `jsr -$54(a6)` on the library base cached at +$74
      // -- req.library, not ASL. A zero result answers the shared empty
      // string; otherwise the NUL-terminated buffer becomes the answer.
      //
      // There is no req.library here, so AMOS's own Fsel$ stands in — see the
      // NOTES entry. The FLAGS are accepted and mostly cannot be honoured.
      if (rt.fsel) {
        if (rt.fsel.done) {
          const r = rt.fsel.result
          rt.fsel = null
          if (r !== '') {
            // remember the split, which Lget Freq Dir/File hand back and
            // which the manual says survives a Cancel
            const cut = Math.max(r.lastIndexOf('/'), r.lastIndexOf(':'))
            rt.ldos.freqDir = cut >= 0 ? r.slice(0, cut + 1) : ''
            rt.ldos.freqFile = r.slice(cut + 1)
          }
          return VS(r)
        }
        it.block({ type: 'fsel' }, true)
        return VS('')
      }
      const title = str(a[0] ?? VS(''))
      const dir = rt.ldos.freqDir !== '' ? rt.ldos.freqDir : (rt.ldos.cwd ?? '')
      if (!rt.startFsel(dir, rt.ldos.freqFile, title, '')) return VS('')
      it.block({ type: 'fsel' }, true)
      return VS('')
    },
    /**
     * Lget Freq File, Lget Freq Dir and Lfontsize Freq -- routines 36
     * ($1a32), 37 ($1a7e) and 75 ($33d6), the read side of the requester
     * settings mapped above.
     *
     * The first two scan a NUL-terminated field (+$586 and +$502) with no
     * ceiling and answer the shared empty string when its first byte is zero;
     * the third is `move.w $36c(...),d3` and nothing else. That is how the
     * manual's "A$ will hold the LAST selected file. A$ will NOT empty even
     * if the user clicked CANCEL, and something has been selected before"
     * works -- nothing CLEARS the field, rather than anything remembering it.
     * Likewise "you must set the filerequester to font-mode ($8-flag) in
     * order to update this field": routine 75 reports whatever last wrote
     * there, and nothing but a font-mode requester does.
     */
    'lget freq file'(_) {
      return VS(rt.ldos.freqFile)
    },
    'lget freq dir'(_) {
      return VS(rt.ldos.freqDir)
    },
    'lfontsize freq'(_) {
      return VI(rt.ldos.freqFontSize)
    },
    /**
     * T=Lset Var("Name","VALUE") — routine 64 ($24da). "This function will
     * return true if successful. Name of the variable is not case-sensitive."
     *
     *     tst.w $2fa(...) / beq -> error 15        dos.library 37+
     *     movea.l (a3)+, a0 / movea.l (a3)+, a1    VALUE, then NAME
     *     ...copy the name to the scratch buffer...
     *     moveq #$0, d3 / move.w (a0)+, d3         the value's LENGTH
     *     move.l #$100, d4                         GVF_GLOBAL_ONLY
     *     move.l a0, d2 / jsr -$384(a6)            SetVar
     *
     * A global environment variable on the Amiga is a FILE in ENV:, which is
     * what SetVar with GVF_GLOBAL_ONLY writes -- so that is where these go.
     * Dir "ENV:" lists them and the browser's file panel shows them, exactly
     * as on the real machine.
     *
     * NOTE: the manual's "must not exceed 50 characters" for both name and
     * value is advice, not a check. Routine 64 measures the value's length
     * and hands both straight to SetVar, whose own limits apply; nothing in
     * the routine counts to fifty.
     */
    'lset var'(_, a) {
      const name = str(a[0] ?? VS(''))
      const value = str(a[1] ?? VS(''))
      // DEVIATION: a name with a path separator in it would make a
      // subdirectory of ENV: on the real machine; here it is refused, because
      // the alternative is writing outside the variable namespace
      if (name === '' || /[:/]/.test(name)) return VI(0)
      return VI(rt.vfs?.writeFile('ENV:' + name, latin1(value)) ? -1 : 0)
    },
    'lrun'(_, a) {
      /*
       * A=Lrun("commands","WINDOW") — routine 50 ($33ca), and it is a script
       * runner rather than a single command. *"Since a new CLI is opened to
       * execute your program(s) ... After every command a linefeed, Chr$(10)
       * MUST follow"*, and *"you should NOT use EndCli as the last command,
       * Ldos will automatically append this"*.
       *
       * The routine, in order:
       *
       *   AllocSignal(-1), FindTask(NULL), AddPort()   a port named "ldos"
       *   build "NewCli " + window + " from t:ld.t"    contiguous from $3502
       *   Open("t:ld.t", 1006) / Write(commands)
       *   Write("t:sig_ldos\nEndCli >NIL:\n", 24)      the promised tail
       *   Close
       *   Open("t:sig_ldos", 1006) / Write(109 bytes) / Close
       *   Execute(that NewCli line, 0, 0)
       *   WaitPort / GetMsg / FreeSignal / RemPort
       *
       * which is why the manual demands `c:Run`, `c:NewCli`, `c:EndCli` and an
       * assigned `t:`. The script file and the exact command line ARE built
       * here, so most of the keyword is real and testable; only the Execute
       * needs a host (../amiga/process.ts).
       *
       * DEFECT: the return value is meaningless. The last thing before `rts`
       * is `jsr -$168(a6)` -- RemPort, which returns nothing -- and then
       * `move.l d0,d3` hands whatever it left to AMOS. The manual knows:
       * *"A will contain any number (see Technote below)"*. Reproduced as 0,
       * since one arbitrary value is as faithful as another.
       *
       * DEVIATION: `t:sig_ldos` is not written. It is 109 bytes of AmigaDOS
       * executable embedded in the library at $35c2 -- the helper that signals
       * the "ldos" port when the script finishes -- and this port neither
       * redistributes the library's code nor executes 68k, so writing it would
       * put someone else's binary in the tree for nothing to run.
       *
       * DEVIATION: it does not block. WaitPort waits for that helper, and with
       * no CLI started nothing will ever signal, so reproducing it would hang
       * the interpreter -- the same hang the manual warns about when a command
       * fails and *"the Shell/CLI-window will never be closed"*.
       */
      const commands = str(a[0] ?? VS(''))
      const window = str(a[1] ?? VS(''))
      // `Write(commands)` then 24 bytes at $359f, byte for byte
      rt.vfs?.writeFile('t:ld.t', latin1(commands + 't:sig_ldos\nEndCli >NIL:\n'))
      // "NewCli " at $3502 runs straight into the window string at $3509
      execute(rt.host.process, {
        command: `NewCli ${window} from t:ld.t`,
        io: { input: null, output: null },
      })
      return VI(0)
    },
    'lexecute'(_, a) {
      /*
       * A=Lexecute("programname") — routine 51 ($3630), twelve instructions:
       * copy the string NUL-terminated into a buffer at $c off LDos's block,
       * `moveq #$0,d2 / moveq #$0,d3`, `jsr -$de(a6)` Execute, and hand d0
       * straight back. *"A will be True if successful, False otherwise."*
       *
       * Both handles are zero, which is exactly what the manual means by
       * *"The program to be run can not use any CLI-I/O"* -- the same detached
       * call AMOS's own Exec and EasyLife's Elexec make.
       *
       * NOTE: the copy has no length check, so on the machine a long enough
       * name overruns the block it is copied into. Nothing to reproduce here,
       * where the string is a string.
       */
      const prog = str(a[0] ?? VS(''))
      return VI(execute(rt.host.process, { command: prog, io: { input: null, output: null } }))
    },
    'lget var'(_, a) {
      // A$=Lget Var("Name") — "If A$ is empty the variable didn't exist."
      const name = str(a[0] ?? VS(''))
      if (name === '' || /[:/]/.test(name)) return VS('')
      const bytes = rt.vfs?.readFile('ENV:' + name)
      return VS(bytes ? String.fromCharCode(...bytes) : '')
    },
    /**
     * T=Ldelete Var("Name") — routine 66 ($25dc). "T will be true if a
     * variable with the name 'Name' was found and removed. If T is zero the
     * variable didn't exist."
     *
     *     tst.w $2fa(...) / beq -> error 15
     *     move.w (a0)+, d0 / tst.w d0 / bne .named
     *     moveq #$12, d0 / Rbra 91                 error 18
     *  .named: ...copy... / move.l #$100, d2 / jsr -$390(a6)   DeleteVar
     *
     * An empty name is an ERROR here where Lset Var simply hands its empty
     * name to SetVar -- the pair are not symmetrical.
     */
    'ldelete var'(_, a) {
      const name = str(a[0] ?? VS(''))
      if (name === '') throw new AmosError('You can not call with an empty argument!')
      if (/[:/]/.test(name)) return VI(0)
      return VI(rt.vfs?.deleteFile('ENV:' + name) ? -1 : 0)
    },
    /**
     * A=Lrol(POSITIONS,VAR) — routine 85 ($3af6). The manual calls it "a
     * logical shift left" and the library's own error message says "You can
     * only shift 31 bits a time!", but the instruction is `rol.l`: bits
     * leaving the top come back in at the bottom. NOTE'd, because a program
     * written against the prose will disagree with the machine for any value
     * with bits set high enough to wrap.
     *
     * The bound is `cmp.l #$1f,d0` UNSIGNED, so a negative count fails it as
     * surely as 32 does.
     */
    lrol(_, a) {
      const positions = int(a[0] ?? VI(0))
      const v = int(a[1] ?? VI(0))
      if ((positions >>> 0) > 31) throw new AmosError('You can only shift 31 bits a time!')
      const n = positions & 31
      return VI((((v << n) | (v >>> (32 - n))) | 0) >> 0)
    },
    /** A=Lror(POSITIONS,VAR) — routine 86 ($3b1e), `ror.l`. See Lrol */
    lror(_, a) {
      const positions = int(a[0] ?? VI(0))
      const v = int(a[1] ?? VI(0))
      if ((positions >>> 0) > 31) throw new AmosError('You can only shift 31 bits a time!')
      const n = positions & 31
      return VI((((v >>> n) | (v << (32 - n))) | 0) >> 0)
    },
    /**
     * FLAGS=Lprot Conv(MASK) — routine 90 ($3cea), four `bchg`s on bits 0 to
     * 3. "Normally bit 0-3 in the protection mask is active low. To make
     * things easier you can use this command to pretend all bits are active
     * high", and since it toggles rather than sets, applying it twice gives
     * the mask back — which is what the manual tells you to do before
     * handing the result to Lset Prot.
     */
    'lprot conv'(_, a) {
      return VI(int(a[0] ?? VI(0)) ^ 0x0f)
    },
    /**
     * A=Lstrcmp(A$,B$) — routine 89 ($3b66). 1 if A$ sorts after B$, 2 if B$
     * sorts after A$, 0 if they are equal: the shorter string's length is
     * compared byte by byte, the first difference decides, and if neither
     * runs out first the LONGER one wins.
     *
     * NOTE. The manual sells this on national characters — "they may contain
     * national characters which are handled as far as possible ... much
     * better results than AMOS' built in routine, which doesn't know ANY
     * national characters!" — and the routine does carry a 256-byte folding
     * table at $3bea, plainly holding the accented letters folded onto A, E,
     * I, N, O, U and Y. It loads its address into a0 at $3b6a and then never
     * indexes it: the comparison at $3ba6 reads the string bytes straight.
     * So this build compares by byte value, and that is what is ported.
     */
    lstrcmp(_, a) {
      const s1 = str(a[0] ?? VS(''))
      const s2 = str(a[1] ?? VS(''))
      // `cmp.w #0,d0; bne` on the shorter length, so either being empty is
      // the error — the min is what gets tested
      if (s1.length === 0 || s2.length === 0) throw new AmosError("Can't Strcmp empty strings!")
      const n = Math.min(s1.length, s2.length)
      for (let i = 0; i < n; i++) {
        const d = s1.charCodeAt(i) - s2.charCodeAt(i)
        if (d !== 0) return VI(d > 0 ? 1 : 2)
      }
      if (s1.length === s2.length) return VI(0)
      return VI(s1.length > s2.length ? 1 : 2)
    },
    /**
     * _LEN=Lcompress(START, INLENGTH To DESTINATION, DESTLENGTH) — routine 83
     * ($382c). "If _LEN = 0 'Then data could not be compressed'. You should
     * the NOT use the DESTINATION buffer for anything."
     *
     * The format and the matcher are in ldoslz.ts. The $4000-byte hash table
     * the original allocates is an implementation detail of the packer and is
     * allocated there; the error it raises when it cannot get the memory is
     * kept, because a program can see it.
     */
    lcompress(_, a) {
      const start = int(a[0] ?? VI(0))
      const inLength = int(a[1] ?? VI(0))
      const dest = int(a[2] ?? VI(0))
      const destLength = int(a[3] ?? VI(0))
      const src = region(rt, start, start + inLength)
      const out = regionWrite(rt, dest, dest + destLength)
      if (!src || !out) throw new AmosError('Not enough memory to compress!')
      const input = src.data.subarray(src.from, src.to)
      // the packer may run up to two bytes past its own limit between
      // control words, which on the Amiga is what the 48-byte margin
      // absorbs; give it the same room rather than a buffer it can leave
      const scratch = new Uint8Array(out.to - out.from + 64)
      const limit = Math.max(0, out.to - out.from - DEST_MARGIN)
      const len = lcompress(input, scratch, limit)
      if (len === 0 || len > out.to - out.from) return VI(0)
      out.data.set(scratch.subarray(0, len), out.from)
      return VI(len)
    },
    /**
     * OUTLEN=Ldecompress(START, INLENGTH, DESTINATION) — routine 84 ($39d8).
     * "NOTE! YOU MUST MAKE SURE THAT DATA IS COMPRESSED. If you use this
     * command on bogus or uncompressed data it WILL crash!" It cannot crash
     * here: the decoder is bounded by the destination region, and garbage in
     * gives garbage out at whatever length the stream claims.
     */
    ldecompress(_, a) {
      const start = int(a[0] ?? VI(0))
      const inLength = int(a[1] ?? VI(0))
      const dest = int(a[2] ?? VI(0))
      const src = region(rt, start, start + inLength)
      const out = rt.resolveWrite(dest)
      if (!src || !out) return VI(0)
      const room = out.data.length - out.off
      const scratch = new Uint8Array(room)
      const len = ldecompress(src.data.subarray(src.from, src.to), scratch)
      const n = Math.min(len, room)
      out.data.set(scratch.subarray(0, n), out.off)
      return VI(len)
    },
    lansi(_, a) {
      // S$=Lansi(A$) — "S$ will contain a sequence containing AMOS control
      // characters. A$ is a normal ANSI-sequence which doesn't have to be
      // complete if the rest of the sequence follow in the next call(s)."
      return VS(ansiToAmos(str(a[0] ?? VS('')), rt.ldos))
    },
    /**
     * A=Lsys Stamp — routine 47 ($1d50), thirteen instructions: it aligns a
     * scratch DateStamp in its workspace, calls dos.library DateStamp at
     * -$c0, and returns `move.l (a2),d3` -- ds_Days and nothing else.
     */
    'lsys stamp'(_) {
      return VI(rt.host.clock.now().days)
    },
    /**
     * A$=Lsys Time — routine 46 ($1cac), the same DateStamp call and then six
     * digits built by hand. "A\$ will be in the form "HHMMSS", hours,
     * minutes, seconds. No extra ":","." or "-" is added".
     *
     *     move.l (a2)+, d0 / move.l (a2)+, d3 / move.l (a2), d5
     *     divu.w #$3c, d3            ds_Minute / 60  -> hours
     *     mulu.w #$3c, d6 / sub.l d6, d4            -> minutes
     *     divu.w #$32, d5            ds_Tick / 50    -> seconds
     *
     * so the tick rate is the PAL 50, not 60, and the seconds field is a
     * whole-second truncation. The two-digit helper at $1d24 reduces mod 100
     * first, which is unreachable for a real clock and is why no hour above
     * 99 is worried about here either.
     */
    'lsys time'(_) {
      const { mins, ticks } = rt.host.clock.now()
      const pad = (n: number): string => String(n).padStart(2, '0')
      return VS(`${pad(Math.floor(mins / 60) % 24)}${pad(mins % 60)}${pad(Math.floor(ticks / 50) % 60)}`)
    },
    /**
     * A=Ldisk Font("name.font",SIZE) — routine 52 ($2080). "name is the
     * fontname, '.font' MUST follow it ... A will be >0 if the font loaded
     * OK. If a <1 the font wasn't on the disk or already in memory."
     *
     *     lea $20e8(pc), a0 / move.l a4, (a0)+ / move.w d0, (a0)
     *                                       a TextAttr: ta_Name, ta_YSize
     *     move.w (a0)+, d0 / tst.w d0 / bne .named
     *     moveq #$12, d0 / Rbra 91          error 18, empty name
     *  .named: lea $20f0(pc), a1 / jsr -$198(a6)    OpenLibrary("diskfont")
     *     bne .open
     *     moveq #$b, d0 / Rbra 91           error 11
     *  .open: jsr -$1e(a6)                  OpenDiskFont(TextAttr)
     *     move.l d0, d3                     ...the FONT POINTER
     *
     * so the value is a `struct TextFont *`, not a flag -- the manual's ">0"
     * is a pointer being described as a truth value. A non-zero constant is
     * within that and is what this answers, there being no font structure to
     * hand back. NOTE: the font is opened and never closed, one leak per
     * call, and the manual's ".font MUST follow it" is its own advice rather
     * than a check: the routine hands the name to OpenDiskFont, which fails
     * on its own for anything else.
     *
     * The disc-font list invalidation below has no counterpart in routine 52.
     * It is how the effect the keyword exists for -- "makes the font directly
     * available to Get Rom Fonts" -- reaches AMOS here, where the real one
     * got it from having the font open in the system font list.
     */
    'ldisk font'(_, a) {
      const name = str(a[0] ?? VS(''))
      if (name === '') throw new AmosError('You can not call with an empty argument!')
      if (!/\.font$/i.test(name)) return VI(0)
      if (rt.vfs?.read('Fonts:' + name) == null) return VI(0)
      rt.discFontCache = null
      return VI(1)
    },
    /**
     * A=Llargest Free(TYPE), 0 CHIP or 1 FAST -- routine 49 ($1db4), which is
     * exec and nothing else: `cmp.l #$1,d1 / bne` picks $20004 or $20002,
     * MEMF_LARGEST with FAST or CHIP, and calls AvailMem at -$d8. See the
     * body for the ceiling this port puts on the answer.
     */
    'llargest free'(_, a) {
      // "This value is NOT the same
      // as the AMOS commands Fast Free and Chip Free, they return total
      // unallocated memory-size, not the largest size you can allocate in one
      // bank."
      //
      //
      // Routine 49 ($1db4) is exec and nothing else: `cmp.l #$1,d1 / bne`
      // picks $20004 or $20002 -- MEMF_LARGEST with FAST or CHIP -- and calls
      // AvailMem at -$d8. So the argument really is 1 for fast and anything
      // else for chip, and the keyword has no opinion of its own.
      //
      // DEVIATION: nothing here fragments, so the largest free block genuinely
      // IS the total free — which is what exec's availMem answers for
      // MEMF_LARGEST and what TURBO's Chip Largest returns. Answering that
      // would make this keyword identical to Chip Free and contradict the
      // sentence above, so the manual's distinction is honoured by capping at
      // LDOS_LARGEST_BLOCK instead. That ceiling is this port's invention:
      // LDos's own figure came from a real allocator walking a real free
      // list, and there is no free list here to walk. src/amiga/exec.ts says
      // the same from its side — a caller wanting fragmentation has to decide
      // its own ceiling, and this is the caller that does.
      const fast = int(a[0] ?? VI(0)) === 1
      const free = fast ? rt.fastFree() : rt.chipFree()
      return VI(Math.min(free, LDOS_LARGEST_BLOCK))
    },
    'lpp mem'(_, a) {
      // SIZE=Lpp Mem(END) — "END is the end of the previously loaded file.
      // It must not be the end of the bank, but the end of the file ...
      // (AMOS's banks are always rounded off to the nearest multiple of 4 and
      // may differ from the actual filesize)". A PP20 file records its
      // decrunched length in the top 24 bits of its final longword, which is
      // why the exact end matters rather than the bank's.
      //
      // Routine 40 ($1aec) is nine instructions and does no checking at all:
      // `subq.l #$4,d0 / movea.l d0,a0 / move.l (a0),d0 /
      //  andi.l #$ffffff00,d0 / asr.l #$8,d0`. The shift is ARITHMETIC, so a
      // trailer whose top bit is set answers a NEGATIVE size rather than a
      // large one -- which cannot arise from a real PP20 file, whose length
      // fits in 24 bits, but does from arbitrary data, and the manual's "It
      // does no validity checking" is exactly that.
      const end = int(a[0] ?? VI(0))
      const m = rt.resolveAddr(end - 4)
      if (!m || m.data.length - m.off < 4) return VI(0)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off, 4)
      return VI(v.getInt32(0, false) >> 8)
    },
    /**
     * CHK=Lchk Data(ADR) — routine 67 ($2634), 36 bytes. "ADR points to a
     * buffer containing the datablock (512 bytes)". The manual gives no
     * algorithm; the routine is the whole specification:
     *
     *     move.l (a0)+, d3 / add.l (a0)+, d3 ... four more   longs 0..4
     *     move.l (a0)+, d2                                   long 5, SKIPPED
     *     move.l #$79, d0
     *  .loop: add.l (a0)+, d3 / dbra d0, .loop               longs 6..127
     *     neg.l d3
     *
     * 5 + 1 + 122 = 128 longs, and the one held out is index 5 -- offset 20,
     * where an AmigaDOS data block keeps its checksum. Plain two's-complement
     * negation with no end-around carry, which is what separates it from
     * Lchk Boot below.
     */
    'lchk data'(_, a) {
      const m = rt.resolveAddr(int(a[0] ?? VI(0)))
      if (!m || m.data.length - m.off < 512) return VI(0)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off, 512)
      let sum = 0
      for (let i = 0; i < 128; i++) if (i !== 5) sum = (sum + v.getUint32(i * 4, false)) >>> 0
      return VI((-sum | 0))
    },
    /**
     * CHK=Lchk Boot(ADR) — routine 68 ($2658), 42 bytes. "the bootchecksum
     * isn't calculated in the same way as the checksum of other blocks ...
     * the bootblock actually consists of TWO blocks ... and ADR should thus
     * point to the TWO first".
     *
     *     move.l #$100, d5 / subq.w #$3, d5        253, so 254 dbra passes
     *     move.l (a1)+, d3                         long 0
     *     move.l (a1)+, d0                         long 1, SKIPPED
     *  .loop: add.l (a1)+, d3 / bcc .next
     *     addi.l #$1, d3                           the end-around carry
     *  .next: dbra d5, .loop
     *     neg.l d3 / beq .done
     *     subq.l #$1, d3                           ...making it NOT
     *  .done:
     *
     * 1 + 1 + 254 = 256 longs, the two blocks, and the one held out is index
     * 1 -- offset 4, the bootblock's own checksum. `neg` then `subq #1` is
     * one's complement, which is what a bootblock checksum is.
     *
     * DEFECT: the `beq` skips the decrement, so a block whose other 255 longs
     * sum to exactly zero answers 0 where the complement rule says -1. It is
     * a special case with nothing behind it -- the negation happens to be
     * zero, not the checksum -- and Lchk Data has no equivalent because it
     * never decrements. Reproduced.
     */
    'lchk boot'(_, a) {
      const m = rt.resolveAddr(int(a[0] ?? VI(0)))
      if (!m || m.data.length - m.off < 1024) return VI(0)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off, 1024)
      let sum = 0
      for (let i = 0; i < 256; i++) {
        if (i === 1) continue // the checksum long itself
        sum += v.getUint32(i * 4, false)
        if (sum > 0xffffffff) sum = (sum + 1) >>> 0 // end-around carry
      }
      const neg = -sum | 0
      return VI(neg === 0 ? 0 : neg - 1) // `neg.l / beq / subq.l #$1`
    },
    /**
     * Lold and Lcreate — routines 7 ($1014) and 8 ($101a), three instructions
     * each and both FUNCTIONS in the token table:
     *
     *     lold:    moveq #$0,d2 / moveq #$0,d3 / rts      integer 0
     *     lcreate: moveq #$1,d3 / moveq #$0,d2 / rts      integer 1
     *
     * (d2 is the AMOS result type, 0 for integer; d3 is the value.)
     *
     * The manual says "Lold - MAY CURRENTLY NOT BE USED!! These are here for
     * future versions", and this port took that literally and made them
     * no-op INSTRUCTIONS. The binary disagrees on both counts: they are the
     * two MODE constants `Lopen` takes, and `Lopen 1,"x",Lcreate` is a
     * working line. The binary wins over the manual, and the manual's
     * warning is stale prose about a feature that shipped.
     */
    lold() {
      return VI(0)
    },
    lcreate() {
      return VI(1)
    },
    /**
     * A$=Lstr(START To MAX) — routine 9 ($1020), 100 bytes. Reads from START
     * up to the end-of-line byte (`Lset Eoln`, default 10) or MAX. "The
     * end-of-line-terminator is NOT copied into the string, so the new
     * startaddress of the next line will be START+Len(A$)+1".
     *
     *     movea.l (a3)+, a4 / movea.l (a3)+, a0      MAX, then START
     *     movea.l a4, a6 / suba.l a2, a6 / bpl .ok
     *     moveq  #$8, d0 / Rbra 91                   error 8
     *  .ok: cmp.b (a1), d6 / beq .empty              already at the terminator
     *  .scan: cmpa.l a4, a1 / beq .len               stop AT max
     *     cmp.b  (a1)+, d6 / bne .scan
     *
     * The range check is a real error arm the manual does not mention: MAX
     * below START is error 8, "Start is greater than max limit!". Equal is
     * allowed and yields the empty string.
     *
     * The scan stops at MAX rather than after it, so MAX is exclusive -- a
     * four-byte window reads three bytes if none of them terminate.
     */
    lstr(_, a) {
      const start = int(a[0] ?? VI(0))
      const max = int(a[1] ?? VI(0))
      if (max < start) throw new AmosError('Start is greater than max limit!')
      const m = rt.resolveAddr(start)
      if (!m) return VS('')
      const limit = Math.min(m.data.length - m.off, Math.max(0, max - start))
      let s = ''
      for (let i = 0; i < limit; i++) {
        const b = m.data[m.off + i]!
        if (b === rt.ldos.eoln) break
        s += String.fromCharCode(b)
      }
      return VS(s)
    },
  } as Record<string, Func>
}

export type { Value }
