/**
 * LDos — file and directory handling for AMOS, by Niklas Sjoberg.
 *
 * The first third-party extension implemented here, and the most used one in
 * the corpus after the stock libraries: 66 of 4,758 programs need it. Its
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
 * handlers serves both. 2.6's additions (`Lcompress`, `Ldecompress`, `Lrol`,
 * `Lror`, `Lhicol On/Off`, `Lstrcmp`, `Lprot Conv`) are documented nowhere in
 * the 325KB of LDos documentation available, so they are deliberately left
 * unimplemented rather than guessed at.
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
import { amigaMatch, hasWildcard } from './ldospat'

/** an AMOS string is bytes, not UTF-16 */
const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff))

/**
 * AmigaDOS datestamps count days from 1 Jan 1978. Ldate and Lstamp convert
 * between that and a "YYMMDD" string; the manual caps the useful range at
 * 2099 ("which should be enough?").
 */
/**
 * AmigaDOS FileInfoBlock entry types. The Lcat accessors read a real
 * FileInfoBlock field by field — verified by disassembly, where every one of
 * them indexes the documented offset: type at +4, protection at +116 ($74),
 * size at +124 ($7c), blocks at +128 ($80), date at +132 ($84) and comment
 * at +144 ($90). Which also explains Lcat Push's otherwise odd 264 bytes:
 * a 4-byte lock plus a 260-byte FileInfoBlock.
 */
const FIB_ST_USERDIR = 2
const FIB_ST_FILE = -3

const STAMP_EPOCH = Date.UTC(1978, 0, 1)
const DAY_MS = 86_400_000

export function stampToYmd(days: number): [number, number, number] {
  const d = new Date(STAMP_EPOCH + Math.max(0, days) * DAY_MS)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
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
  pushed: Map<number, LcatScan>
  /**
   * LDos tracks its own current directory. The manual is explicit that it
   * does not see AMOS's: "If you change the dir using the Dir$-command and
   * then try to open a file using Lopen, the file probably couldn't be
   * found, since Ldos hadn't noticed the directory-change". Null means none
   * has been set, so AMOS's current directory applies.
   */
  cwd: string | null
  /** the Ldev First/Ldev Next walk over volumes and assigns */
  devices: { names: string[]; index: number } | null

  /** Lset Eoln: the end-of-line byte Lstr looks for. Default 10 (manual:
   * "Default is 10, normal Amiga LineFeed. (Unlike AMOS which tends to use
   * 13 for some reason...)") */
  eoln: number
}

export const newLdosState = (): LdosState => ({ chans: new Map(), cat: null, pushed: new Map(), cwd: null, devices: null, eoln: 10 })

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
function catAt(rt: Runtime): { name: string; isDir: boolean; size: number; path: string } | null {
  const c = rt.ldos.cat
  if (!c) return null
  if (c.index < 0) return { name: c.dir, isDir: true, size: 0, path: c.dir }
  const e = c.entries[c.index]
  if (!e) return null
  const base = c.dir.endsWith(':') || c.dir.endsWith('/') ? c.dir : `${c.dir}/`
  return { ...e, path: base + e.name }
}

/** `Lopen` accepts channels 1..3 (manual: "Channel can range from 1 to 3") */
function channel(rt: Runtime, n: number): LdosChannel {
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

export function makeLdosInstructions(rt: Runtime): Record<string, Instr> {
  return {
    lopen(it) {
      // Lopen Channel,"Name",MODE — MODE 0 opens an existing file, 1 creates
      // a new one. "WARNING! If the file exist and MODE is 1 the file will be
      // erased. (the file will be 0 bytes long)"
      const n = it.evalInt()
      it.expect(',')
      const path = ldosPath(rt, it.evalStr())
      it.expect(',')
      const mode = it.evalInt()
      if (n < 1 || n > 3) throw new AmosError('Invalid Lchannel')
      let data: Uint8Array
      if (mode === 1) {
        data = new Uint8Array(0)
        rt.vfs?.writeFile(path, data) // created, and truncated if it existed
        rt.stampFile(path)
      } else {
        const existing = rt.fs?.read(path) ?? null
        if (existing === null) throw new AmosError('Invalid filename')
        data = Uint8Array.from(existing)
      }
      rt.ldos.chans.set(n, { path, data, pos: 0, dirty: mode === 1 })
    },
    lclose(it) {
      // "Do not ever forget to close a file ... otherwise the file, or even
      // the whole disk can be corrupt!!!" — here closing is what commits the
      // written bytes back to the filesystem.
      const n = it.evalInt()
      const c = channel(rt, n)
      flush(rt, c)
      rt.ldos.chans.delete(n)
    },
    'lset eoln'(it) {
      // "NUM may range from 0 to 255. Default is 10"
      rt.ldos.eoln = it.evalInt() & 0xff
    },
    lbstr(it) {
      // Lbstr A$,START — copy a string into a bank. "No check is done to see
      // whether the bufferlimit was exceeded or not", which the port cannot
      // reproduce: writes are bounded by the region they land in rather than
      // running on into whatever follows.
      const s = it.evalStr()
      it.expect(',')
      const addr = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (!m) throw new AmosError('You can not call with an empty argument!')
      const n = Math.min(s.length, m.data.length - m.off)
      for (let i = 0; i < n; i++) m.data[m.off + i] = s.charCodeAt(i) & 0xff
    },
    lreplace(it) {
      // Lreplace SEARCH,SWAP,START To STOP — "If SEARCH is found it will be
      // replaced by the SWAP-value."
      const search = it.evalInt() & 0xff
      it.expect(',')
      const swap = it.evalInt() & 0xff
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const stop = it.evalInt()
      const r = region(rt, start, stop)
      if (!r) return
      for (let i = r.from; i < r.to; i++) if (r.data[i] === search) r.data[i] = swap
    },
    lfilter(it) {
      // Lfilter LOW,HIGH,SWAP,START To STOP — "Everything between LOW and
      // HIGH (INCLUDING LOW and HIGH) will be replaced by SWAP."
      const low = it.evalInt() & 0xff
      it.expect(',')
      const high = it.evalInt() & 0xff
      it.expect(',')
      const swap = it.evalInt() & 0xff
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const stop = it.evalInt()
      const r = region(rt, start, stop)
      if (!r) return
      for (let i = r.from; i < r.to; i++) {
        const b = r.data[i]!
        if (b >= low && b <= high) r.data[i] = swap
      }
    },
    'lset comment'(it) {
      // Lset Comment "FileName","Comment" — '"Comment" may not be longer
      // than 79 characters and also works on directories as well.'
      const path = it.evalStr()
      it.expect(',')
      const comment = it.evalStr()
      rt.vfs?.setMeta(path, { comment: comment.slice(0, 79) })
    },
    'lset prot'(it) {
      // Lset Prot "FileName",MASK — 'MASK is a bitpattern like above',
      // e.g. %00000000 meaning ----rwed
      const path = it.evalStr()
      it.expect(',')
      rt.vfs?.setMeta(path, { protection: it.evalInt() & 0xff })
    },
    'lcat push'(it) {
      // Lcat Push ADR — "Each time you push something 264 bytes are used and
      // the next datas should thus be copied to ADR+264 ... Using Lcat Push
      // you simply move this internal data to a bank reserved by you. You may
      // now use Lcat on a different device/directory."
      const addr = it.evalInt()
      const c = rt.ldos.cat
      if (!c) return
      rt.ldos.pushed.set(addr, c)
      rt.ldos.cat = null
      // the real thing writes DOS locks and a FileInfoBlock into those 264
      // bytes; the scan lives beside the bank here, and a cookie is written
      // so Lcat Pull can tell a pushed block from an empty one
      const m = rt.resolveAddr(addr)
      if (m && m.off < m.data.length) m.data[m.off] = 0x4c // 'L'
    },
    'lcat pull'(it) {
      // Lcat Pull ADR — "if this address not contains Lcat-data AmigaDOS MAY
      // crash if you're unlucky!! If ADR points to NULLs (empty bank) you
      // will receive the errormessage 'No more entries in this dir'"
      const addr = it.evalInt()
      const c = rt.ldos.pushed.get(addr)
      if (!c) throw new AmosError('No more entries in this dir')
      rt.ldos.pushed.delete(addr)
      rt.ldos.cat = c
      const m = rt.resolveAddr(addr)
      if (m && m.off < m.data.length) m.data[m.off] = 0
    },
    lldir$(it) {
      // LLdir$ "new-dir" — LDos keeps its own current directory, because on
      // the real machine it never sees AMOS's Dir$ changes. The manual's own
      // advice is "Set Dir$ to desired value, and call LLdir$ Dir$".
      rt.ldos.cwd = it.evalStr()
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
    lupbuffer(it) {
      // Lupbuffer START To STOP — "Just like AMOS Upper$ this routine won't
      // handle national characters (due to AMOS isn't using a standard
      // keymap). Only A-Z and a-z are processed."
      const start = it.evalInt()
      it.expect('to')
      const r = region(rt, start, it.evalInt())
      if (!r) return
      for (let i = r.from; i < r.to; i++) {
        const b = r.data[i]!
        if (b >= 0x61 && b <= 0x7a) r.data[i] = b - 32
      }
    },
    llobuffer(it) {
      // The manual calls this "Llowbuffer"; the token table says Llobuffer,
      // and the table is what a program is written against.
      const start = it.evalInt()
      it.expect('to')
      const r = region(rt, start, it.evalInt())
      if (!r) return
      for (let i = r.from; i < r.to; i++) {
        const b = r.data[i]!
        if (b >= 0x41 && b <= 0x5a) r.data[i] = b + 32
      }
    },
    lold() {
      // "Lold - MAY CURRENTLY NOT BE USED!!  These are here for future
      // versions". Documented as unusable, so doing nothing is what the
      // manual describes; see the NOTES entry.
    },
    lcreate() {
      // "Lcreate - MAY CURRENTLY NOT BE USED!!" — as Lold.
    },
  }
}

export function makeLdosFunctions(rt: Runtime): Record<string, Func> {
  return {
    lload(_, a) {
      // A=Lload(Channel,DEST,LENGTH). "A will contain the number of bytes
      // actually read. If A is less than LENGTH you reached the end of the
      // file. If A equals to -1, a filerror occurred. It is perfectly legal
      // to request more data than the file contains, no error will be
      // produced because of this."
      const c = channel(rt, int(a[0] ?? VI(0)))
      const dest = int(a[1] ?? VI(0))
      const len = int(a[2] ?? VI(0))
      const m = rt.resolveAddr(dest)
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
    lseek(_, a) {
      // P=Lseek(Channel,POS). "Offsets are relative to the BEGINNING of the
      // file ... If POS is <0 no movement will take place, and the current
      // position in the file will be returned."
      const c = channel(rt, int(a[0] ?? VI(0)))
      const pos = int(a[1] ?? VI(0))
      if (pos < 0) return VI(c.pos)
      c.pos = pos
      return VI(pos)
    },
    lsize(_, a) {
      // S=Lsize("FileName"). "The file do not need to be open ... it is legal
      // to specify a directory as well. If "FileName" is a directory zero is
      // always returned."
      const path = str(a[0] ?? VS(''))
      if (rt.vfs?.exists(path) === 'dir') return VI(0)
      return VI(rt.fs?.read(path)?.length ?? 0)
    },
    'lfile type'(_, a) {
      // A=Lfile Type("FileName"). "A is greater than 0 if it is a directory,
      // or negative if it is a file" — which is true of AmigaDOS's own
      // fib_DirEntryType, and that is literally what the sibling Lcat Type
      // hands back (verified by disassembly). ST_USERDIR is 2 and ST_FILE
      // is -3, so those are the values, not 1 and -1.
      const path = ldosPath(rt, str(a[0] ?? VS('')))
      const kind = rt.vfs?.exists(path) ?? (rt.fs?.read(path) != null ? 'file' : null)
      return VI(kind === 'dir' ? FIB_ST_USERDIR : FIB_ST_FILE)
    },
    lwords(_, a) {
      // NUM=Lwords(STRING$). "If STRING$ is empty zero is returned."
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
    lwild(_, a) {
      // TEST=Lwild(A$). "TEST will be false (zero) if A$ contains no
      // wildcard(s), otherwise TEST may contain anything (usually 1)."
      return VI(hasWildcard(str(a[0] ?? VS(''))) ? 1 : 0)
    },
    lmatch(_, a) {
      // L=Lmatch(SOURCE$,S$). "PLEASE NOTE THAT BOTH STRINGS MUST BE NULL-
      // TERMINATED (+Chr$(0))" — a dos.library calling convention the caller
      // satisfies by appending Chr$(0), so the terminator is stripped here
      // rather than treated as part of the text.
      const trim = (v: string): string => (v.endsWith('\0') ? v.slice(0, -1) : v)
      return VI(amigaMatch(trim(str(a[0] ?? VS(''))), trim(str(a[1] ?? VS('')))) ? -1 : 0)
    },
    lskip(_, a) {
      // ADR=Lskip(CHAR,START To STOP). "ADR will contain the address AFTER
      // the last CHAR", stopping at STOP if every byte is CHAR.
      const ch = int(a[0] ?? VI(0)) & 0xff
      const start = int(a[1] ?? VI(0))
      const stop = int(a[2] ?? VI(0))
      const r = region(rt, start, stop)
      if (!r) return VI(start)
      let i = r.from
      while (i < r.to && r.data[i] === ch) i++
      return VI(start + (i - r.from))
    },
    'lback hunt'(_, a) {
      // ADR=Lback Hunt(CHAR,START To STOP). "Note that START is greater than
      // STOP since this routine works backwards."
      const ch = int(a[0] ?? VI(0)) & 0xff
      const start = int(a[1] ?? VI(0))
      const stop = int(a[2] ?? VI(0))
      const m = rt.resolveAddr(stop)
      if (!m) return VI(stop)
      const span = Math.max(0, Math.min(start - stop, m.data.length - m.off))
      for (let i = span; i >= 0; i--) {
        if (m.data[m.off + i] === ch) return VI(stop + i)
      }
      return VI(stop)
    },
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
    ldate(_, a) {
      // A$=Ldate(STAMP). "stamp is the number of days since 1 Jan 1978. A$
      // will be in the form of "YYMMDD" ... If the datestamp is less than
      // zero (below 1 Jan 1978) the string 780101 will be returned."
      const [y, m, d] = stampToYmd(int(a[0] ?? VI(0)))
      const pad = (n: number): string => String(n).padStart(2, '0')
      return VS(`${pad(y % 100)}${pad(m)}${pad(d)}`)
    },
    lstamp(_, a) {
      // S=Lstamp(YEAR,MONTH,DAY). "If the date is before 1 Jan 1978, 1 Jan
      // 1978 will still be returned."
      return VI(ymdToStamp(int(a[0] ?? VI(0)), int(a[1] ?? VI(1)), int(a[2] ?? VI(1))))
    },
    'lset file date'(_, a) {
      // TEST=Lset File Date("name",STAMP,MIN,TICKS). "TEST will be true (-1)
      // if the call was successful ... MIN are the number of minutes that
      // have passed since midnight. TICKS are the number of ticks that have
      // passed during the last minute (1 tick is the same as a VBL = 1/50 sec)"
      const path = str(a[0] ?? VS(''))
      if (rt.vfs?.exists(path) == null) return VI(0)
      const ok = rt.vfs.setMeta(path, {
        days: Math.max(0, int(a[1] ?? VI(0))),
        mins: int(a[2] ?? VI(0)),
        ticks: int(a[3] ?? VI(0)),
      })
      return VI(ok ? -1 : 0)
    },
    'lcat first'(_, a) {
      // F$=Lcat First("Directory") — a lock, not a first entry. "If the
      // directory didn't exist the error 'Invalid filename' will be produced".
      const dir = ldosPath(rt, str(a[0] ?? VS('')))
      const entries = rt.vfs?.listDir(dir) ?? null
      if (entries === null) throw new AmosError('Invalid filename')
      const sorted = [...entries].sort((x, y) => x.name.localeCompare(y.name))
      rt.ldos.cat = { dir, entries: sorted, index: -1 }
      return VS(dir)
    },
    'lcat next'(_) {
      // F$=Lcat Next — "If F$ is empty, there are no more files/directories
      // in this directory. Lcat Next won't work if you haven't used Lcat
      // First."
      const c = rt.ldos.cat
      if (!c) return VS('')
      c.index++
      const e = c.entries[c.index]
      return VS(e ? e.name : '')
    },
    'lcat type'(_) {
      // "A can be either positive, for directories, or negative for files" —
      // and the routine is simply `move.l $4(a0),d3` over a FileInfoBlock,
      // so what comes back is fib_DirEntryType itself: 2 for a directory,
      // -3 for a file.
      const e = catAt(rt)
      return VI(e === null ? 0 : e.isDir ? FIB_ST_USERDIR : FIB_ST_FILE)
    },
    'lcat size'(_) {
      // "it is fully legal to call this command even if the current 'file' is
      // a directory! If the current name belongs to a directory S will
      // contain 0. (Keep in mind that files which are zero bytes do exist, so
      // don't use this method instead of Lcat Type)"
      const e = catAt(rt)
      return VI(e === null || e.isDir ? 0 : e.size)
    },
    'lcat blocks'(_) {
      // "FFS can hold 512 bytes of data in one block"
      const e = catAt(rt)
      return VI(e === null || e.isDir ? 0 : Math.ceil(e.size / 512))
    },
    'lcat prot'(_) {
      const e = catAt(rt)
      return VI(e === null ? 0 : (rt.vfs?.meta(e.path).protection ?? 0))
    },
    'lcat comment'(_) {
      const e = catAt(rt)
      return VS(e === null ? '' : (rt.vfs?.meta(e.path).comment ?? ''))
    },
    'lcat stamp'(_) {
      const e = catAt(rt)
      return VI(e === null ? 0 : (rt.vfs?.meta(e.path).days ?? 0))
    },
    'ldev first'(_) {
      // A$=Ldev First(ADR) — "the devicename (like DF0: etc.) NOT contains a
      // colon". ADR receives a block of device info this port does not model.
      const names = [...(rt.vfs?.volumeNames() ?? []), ...(rt.vfs?.assignNames() ?? [])]
      rt.ldos.devices = { names, index: 0 }
      return VS(names[0] ?? '')
    },
    'ldev next'(_) {
      const d = rt.ldos.devices
      if (!d) return VS('')
      d.index++
      return VS(d.names[d.index] ?? '')
    },
    'lset var'(_, a) {
      // T=Lset Var("Name","VALUE") — 'Name' at most 50 characters, 'VALUE'
      // likewise, "This function will return true if successful. Name of the
      // variable is not case-sensitive."
      //
      // A global environment variable on the Amiga is a FILE in ENV:, which
      // is what SetVar with GVF_GLOBAL_ONLY writes — so that is where these
      // go. Dir "ENV:" lists them and the browser's file panel shows them,
      // exactly as on the real machine.
      const name = str(a[0] ?? VS(''))
      const value = str(a[1] ?? VS(''))
      if (name === '' || name.length > 50 || value.length > 50 || /[:/]/.test(name)) return VI(0)
      return VI(rt.vfs?.writeFile('ENV:' + name, latin1(value)) ? -1 : 0)
    },
    'lget var'(_, a) {
      // A$=Lget Var("Name") — "If A$ is empty the variable didn't exist."
      const name = str(a[0] ?? VS(''))
      if (name === '' || /[:/]/.test(name)) return VS('')
      const bytes = rt.vfs?.readFile('ENV:' + name)
      return VS(bytes ? String.fromCharCode(...bytes) : '')
    },
    'ldelete var'(_, a) {
      // T=Ldelete Var("Name") — "T will be true if a variable with the name
      // 'Name' was found and removed. If T is zero the variable didn't exist."
      const name = str(a[0] ?? VS(''))
      if (name === '' || /[:/]/.test(name)) return VI(0)
      return VI(rt.vfs?.deleteFile('ENV:' + name) ? -1 : 0)
    },
    'lsys stamp'(_) {
      // A=Lsys Stamp — "A will contain a datestamp which can be used in
      // conjunction with Ldate to print the current date."
      return VI(rt.host.clock.now().days)
    },
    'lsys time'(_) {
      // A$=Lsys Time — "A$ will be in the form "HHMMSS", hours, minutes,
      // seconds. No extra ":","." or "-" is added"
      const { mins, ticks } = rt.host.clock.now()
      const pad = (n: number): string => String(n).padStart(2, '0')
      return VS(`${pad(Math.floor(mins / 60) % 24)}${pad(mins % 60)}${pad(Math.floor(ticks / 50) % 60)}`)
    },
    'ldisk font'(_, a) {
      // A=Ldisk Font("name.font",SIZE) — "name is the fontname, '.font' MUST
      // follow it ... A will be >0 if the font loaded OK. If a <1 the font
      // wasn't on the disk or already in memory." It makes the font directly
      // available to Get Rom Fonts, so the disc font list is invalidated and
      // rebuilt from the Fonts: drawer.
      const name = str(a[0] ?? VS(''))
      if (!/\.font$/i.test(name)) return VI(0)
      if (rt.vfs?.read('Fonts:' + name) == null) return VI(0)
      rt.discFontCache = null
      return VI(1)
    },
    'llargest free'(_, a) {
      // A=Llargest Free(TYPE), 0 CHIP or 1 FAST. "This value is NOT the same
      // as the AMOS commands Fast Free and Chip Free, they return total
      // unallocated memory-size, not the largest size you can allocate in one
      // bank."
      const fast = int(a[0] ?? VI(0)) === 1
      return VI(fast ? Math.max(0, 0x80000 - rt.fastUsed()) : Math.max(0, 0x80000 - rt.chipUsed()))
    },
    'lchk data'(_, a) {
      // CHK=Lchk Data(ADR) — "ADR points to a buffer containing the datablock
      // (512 bytes)". The manual gives no algorithm; this is the standard
      // AmigaDOS block checksum, verified against real disks in the tests.
      const m = rt.resolveAddr(int(a[0] ?? VI(0)))
      if (!m || m.data.length - m.off < 512) return VI(0)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off, 512)
      let sum = 0
      for (let i = 0; i < 128; i++) if (i !== 5) sum = (sum + v.getUint32(i * 4, false)) >>> 0
      return VI((-sum | 0))
    },
    'lchk boot'(_, a) {
      // CHK=Lchk Boot(ADR) — "the bootchecksum isn't calculated in the same
      // way as the checksum of other blocks ... the bootblock actually
      // consists of TWO blocks ... and ADR should thus point to the TWO first"
      const m = rt.resolveAddr(int(a[0] ?? VI(0)))
      if (!m || m.data.length - m.off < 1024) return VI(0)
      const v = new DataView(m.data.buffer, m.data.byteOffset + m.off, 1024)
      let sum = 0
      for (let i = 0; i < 256; i++) {
        if (i === 1) continue // the checksum long itself
        sum += v.getUint32(i * 4, false)
        if (sum > 0xffffffff) sum = (sum + 1) >>> 0 // end-around carry
      }
      return VI(~sum | 0)
    },
    lstr(_, a) {
      // A$=Lstr(START To MAX). Reads from START up to the end-of-line byte
      // (Lset Eoln, default 10) or MAX. "The end-of-line-terminator is NOT
      // copied into the string, so the new startaddress of the next line
      // will be START+Len(A$)+1".
      const start = int(a[0] ?? VI(0))
      const max = int(a[1] ?? VI(0))
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

/** every LDos keyword this file implements, for the coverage manifest */
export const LDOS_IMPLEMENTED: readonly string[] = [
  'lopen', 'lclose', 'lset eoln', 'lbstr', 'lold', 'lcreate',
  'lload', 'lsave', 'lseek', 'lsize', 'lfile type', 'lstr',
  'lwords', 'lword', 'lwild', 'lmatch', 'lreplace', 'lfilter', 'lskip', 'lback hunt',
  'lget comment', 'lset comment', 'lget prot', 'lset prot', 'ldate', 'lstamp', 'lset file date',
  'lcat first', 'lcat next', 'lcat type', 'lcat size', 'lcat blocks', 'lcat prot', 'lcat comment',
  'lcat stamp', 'lcat push', 'lcat pull', 'ldev first', 'ldev next', 'lldir$',
  'lupbuffer', 'llobuffer', 'llargest free', 'lchk data', 'lchk boot',
  'lset var', 'lget var', 'ldelete var', 'ldisk font', 'lcrypt', 'ldecrypt',
  'lsys stamp', 'lsys time',
]

export type { Value }
