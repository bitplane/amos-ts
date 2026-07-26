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
import { amigaMatch, hasWildcard } from './ldospat'

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

export interface LdosState {
  chans: Map<number, LdosChannel>
  /** Lset Eoln: the end-of-line byte Lstr looks for. Default 10 (manual:
   * "Default is 10, normal Amiga LineFeed. (Unlike AMOS which tends to use
   * 13 for some reason...)") */
  eoln: number
}

export const newLdosState = (): LdosState => ({ chans: new Map(), eoln: 10 })

/** `Lopen` accepts channels 1..3 (manual: "Channel can range from 1 to 3") */
function channel(rt: Runtime, n: number): LdosChannel {
  const c = rt.ldos.chans.get(n)
  if (!c) throw new AmosError(`Ldos: file not opened: channel ${n}`)
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
      const path = it.evalStr()
      it.expect(',')
      const mode = it.evalInt()
      if (n < 1 || n > 3) throw new AmosError('Ldos: channel must be 1 to 3')
      let data: Uint8Array
      if (mode === 1) {
        data = new Uint8Array(0)
        rt.vfs?.writeFile(path, data) // created, and truncated if it existed
      } else {
        const existing = rt.fs?.read(path) ?? null
        if (existing === null) throw new AmosError(`file not found: ${path}`)
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
      if (!m) throw new AmosError(`Ldos: address not in any bank: ${addr}`)
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
      // or negative if it is a file."
      const path = str(a[0] ?? VS(''))
      const kind = rt.vfs?.exists(path) ?? (rt.fs?.read(path) != null ? 'file' : null)
      return VI(kind === 'dir' ? 1 : -1)
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
      if (n < 1 || n > words.length) throw new AmosError(`Ldos: no word ${n} in that string`)
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
]

export type { Value }
