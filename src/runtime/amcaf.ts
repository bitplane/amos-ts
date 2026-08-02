/**
 * AMCAF — Chris Hodges' extension, 281 keywords at slot 8. Freeware.
 *
 * The largest third-party extension in the archive and the best documented:
 * a 235KB AmigaGuide with a real manual entry for 234 of the 280 distinct
 * keywords, and 279 of the 281 names appearing somewhere in it.
 *
 * ## Identity: one port, two releases
 *
 * `amcaf-1.40` (26-Dec-95) and `amcaf-1.50` share **268 keyword names**.
 * 1.50 adds twelve and removes none, so it is 1.40 plus additions rather than
 * a reworking — which is exactly why the 1.50 manual documents 1.40. One port
 * serves both, the way the two Personnal releases and the three TURBOs do.
 *
 * ## Evidence tier: manual for 1.40, disassembly for what 1.50 added
 *
 * The author says so himself: *"AMCAF V1.50beta4 is the FINAL RELEASE!
 * FREEWARE!"* and, of the manual, *"Sorry, but I didn't have time to update
 * the manual. You'll have to find out the new commands since V1.40
 * yourself."*
 *
 * So the honest split is **manual tier for the 1.40 subset** and
 * **disassembly tier for the twelve 1.50 additions** — the transparency
 * group (`Trans Screen Static/Dynamic/Runtime`, `Alloc`/`Set Trans
 * Map`/`Source`), `Alloc Code Bank`, `Turbo Text`, `Pt Free Voice`, `Sload`
 * and `Ssave`. C2P is undocumented too: it appears only in the history node,
 * crediting Mikael Kalms' routine.
 *
 * Where the two disagree the binary wins. `extdis amcaf-1.50` decodes a
 * 45,532-byte code hunk, jump table at +18, 354 routines from $1c28.
 *
 * ## The Guide's history node is a primary source
 *
 * Unusually, the manual carries a dated changelog going back to 1993, and it
 * documents behaviour nothing else records — including bugs the author found
 * and fixed. Two examples worth having on file before the graphics slice:
 *
 * - *"Found and removed an error in the Blitter Fill commands. Blitter Fill
 *   filled the screen one line to deep -> memory got corrupted."*
 * - *"Error in the tokenlist caused a wrong syntax of Blitter Fill to be
 *   converted into Pt Play. Funny :)"*
 *
 * Both are FIXED by the releases we hold, so neither is reproduced; they are
 * recorded because a program written against an older AMCAF may have been
 * built around them.
 *
 * ## There is no error message table
 *
 * Unlike Personnal, JVP, TURBO and AMOS 3D, this extension ships **no error
 * strings at all** — the whole 45KB hunk contains no printable message text.
 * Failures go through AMOS's own error numbers, which the manual confirms
 * when it blames one on the host: *"this is a problem of AMOS"*.
 *
 * The one exception points the other way: `Io Error` and `Io Error$` return
 * **AmigaDOS** error codes and strings, not AMOS ones — *"Returns the last
 * dos error code"*, *"Returns a dos errorstring"*. Those belong to
 * `dos.library` and are slice 5's problem, not an extension error table.
 *
 * ## Contested names
 *
 * Thirteen of the 281 names are also spelled by something else, and seven of
 * those are ARMED — the other side is already ported, so a plain-name
 * registration would silently replace a working implementation:
 *
 *   Blitter Clear, Blitter Copy, Blitter Copy Limit,
 *   Set Ntsc, Set Pal, Speek              -> Personnal
 *   Sload, Ssave                          -> the Music extension, EME
 *
 * The decision is to declare all eight `qualified` in EXT_IMPLS, so they
 * register as `ext8:<name>` and dispatch resolves them by the slot the
 * program actually bound — which is what the machine does, where the two are
 * different tokens at different slots and coexist. Personnal keeps the plain
 * names.
 *
 * They cannot be declared ahead of the keywords: `extimpl.test.ts` requires
 * every qualified name to be one the port actually defines, which is what
 * stops the list rotting into a wish. So the declarations arrive with their
 * slices — Sload/Ssave in slice 5, the six Personnal names in slice 7.
 *
 * The remaining six are latent (neither side ported): `Bank Name`,
 * `Bank Name$`, `Open Workbench`, `Pal Spread`, `Raster Wait`, `Xfire`.
 *
 * ## State
 *
 * The extension keeps one data block, which `Amcaf Base` and `Amcaf Length`
 * hand a program the address and size of. Nothing is in it yet; each slice
 * adds the fields its keywords need.
 */

import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import { DAY_MS, STAMP_EPOCH, TICKS_PER_SECOND, stampToYmd } from '../amiga/datestamp'
import { MAX_COMMENT, blocksFor, entryType, protectionString } from '../amiga/dos'
import { amigaMatch } from '../amiga/dospattern'
import { joinAmigaPath } from '../amiga/vfs'

/**
 * The FileInfoBlock the Examine family fills in.
 *
 * `Examine Dir` "loads all information about the drawer into the
 * FileInfoBlock", `Examine Next$` steps it to each entry in turn, and
 * `Examine Object` fills it for one named object. The `Object *` accessors
 * then read whichever object it currently describes — which is why they all
 * have a no-argument form as well as a path one.
 */
export interface AmcafExamine {
  /** the directory being walked, or '' after Examine Stop */
  dir: string
  entries: string[]
  index: number
  /** the path the accessors currently answer for */
  current: string
}

export interface AmcafState {
  /** the single Examine context; the extension keeps exactly one */
  examine: AmcafExamine
  /** the last AmigaDOS error, which Io Error reports */
  ioError: number
  /**
   * Placeholder for the extension's data base.
   *
   * `Amcaf Base` returns its address and `Amcaf Length` its size, so a
   * program can poke the internals — which the manual describes as being for
   * "Assembler and C freaks" and warns about. Both are slice 10; until then
   * there is nothing to point at.
   */
  readonly present: true
}

export function newAmcafState(): AmcafState {
  return {
    examine: { dir: '', entries: [], index: -1, current: '' },
    ioError: 0,
    present: true,
  }
}

/**
 * The keyword tables, filled a slice at a time.
 *
 * Empty is the correct starting state and not a stub: a name nothing
 * registers is simply unimplemented, the census counts it as missing, and
 * `coverage.test.ts` requires that an n/a keyword have NO handler. Wiring the
 * port up before the first keyword proves the plumbing — identity resolution,
 * slot binding and the qualified names — separately from any behaviour.
 */
export function makeAmcafInstructions(rt: Runtime): Record<string, Instr> {
  void rt
  return {

    /**
     * Examine Dir directory$ — "loads all information about the drawer into
     * the FileInfoBlock. Additionally, the contents of the directory can be
     * read out by Examine Next$."
     */
    'examine dir'(it) {
      const dir = it.evalStr()
      const entries = rt.vfs?.listDir(dir) ?? null
      if (entries === null) {
        rt.amcaf.ioError = 205 // ERROR_OBJECT_NOT_FOUND
        amcafErr()
      }
      rt.amcaf.examine = { dir, entries: entries.map((e) => e.name), index: -1, current: dir }
      rt.amcaf.ioError = 0
    },

    /**
     * Examine Object file$ — "supplies you with all available information
     * about the [object], [readable through] the functions without any
     * parameters."
     */
    'examine object'(it) {
      const path = it.evalStr()
      if (!rt.vfs || rt.vfs.exists(path) === null) {
        rt.amcaf.ioError = 205
        amcafErr()
      }
      rt.amcaf.examine.current = path
      rt.amcaf.ioError = 0
    },

    /**
     * Examine Stop — "Aborts the reading process of a directory. After this
     * command, you may not make any further calls to Examine Next$."
     */
    'examine stop'() {
      rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
    },

    /** Protect Object pathfile$,prot — the bitmapped value straight through */
    'protect object'(it) {
      const path = it.evalStr()
      it.expect(',')
      rt.vfs?.setMeta(path, { protection: it.evalInt() & 0xff })
    },

    /** Set Object Comment pathfile$,comment$ — the FileNote, 79 characters */
    'set object comment'(it) {
      const path = it.evalStr()
      it.expect(',')
      rt.vfs?.setMeta(path, { comment: it.evalStr().slice(0, MAX_COMMENT) })
    },

    /**
     * Set Object Date pathfile$,date,time — the DateStamp, in the same two
     * packed values Current Date and Current Time hand out. "This command
     * only works on OS2.0 and higher."
     */
    'set object date'(it) {
      const path = it.evalStr()
      it.expect(',')
      const days = it.evalInt()
      it.expect(',')
      const t = it.evalInt()
      rt.vfs?.setMeta(path, { days, mins: timeMins(t), ticks: timeTicks(t) })
    },

    /**
     * File Copy sourcefile$ To targetfile$.
     *
     * "This command allows you to even copy a file of 3 MB in size, even if
     * you only got 100 KB of free memory" — the machine streams it in
     * chunks; there is no such limit here, and the result is the same file.
     */
    'file copy'(it) {
      const from = it.evalStr()
      it.expect('to')
      const to = it.evalStr()
      const data = rt.vfs?.readFile(from) ?? null
      if (data === null) {
        rt.amcaf.ioError = 205
        amcafErr()
      }
      rt.vfs?.writeFile(to, data)
      rt.amcaf.ioError = 0
    },

    /**
     * Wload / Dload file$,bank — "loads the file named file$ completely into
     * memory", the manual even giving the long way round:
     * `Open In 1,FILE$ : LE=Lof(1) : Close 1 : Reserve As Work BANK,LE ...`
     *
     * The pair differ only in the bank kind, Work against Data, which is the
     * Bank Temporary / Bank Permanent distinction again.
     */
    'wload'(it) {
      loadToBank(rt, it, false)
    },
    'dload'(it) {
      loadToBank(rt, it, true)
    },

    /** Wsave / Dsave file$,bank — "Dsave is exactly the same as Wsave" */
    'wsave'(it) {
      saveBank(rt, it)
    },
    'dsave'(it) {
      saveBank(rt, it)
    },

    /** Nop — routine 21 ($231a) is two bytes: `rts`. "has no effect et al" */
    nop() {},

    /**
     * Bank Permanent / Bank Temporary — routines 25 and 26.
     *
     * AMOS's bank flag bit 0 is the Data/Work distinction: a permanent bank
     * "will stay resident in your program until it is erased", a temporary
     * one goes at Default. The manual notes this "also has use on
     * MED-Modules ... and on Power and Imploder unpacked banks", which is
     * exactly the case of a bank built at run time that should outlive the
     * command that made it.
     */
    'bank permanent'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.flags |= 1
    },
    'bank temporary'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.flags &= ~1
    },

    /**
     * Bank To Chip / Bank To Fast — routines 27 and 28. The bank moves and
     * "will get a new starting address"; here the memory type is a flag on
     * the bank rather than a real pool, so the move is the flag.
     *
     * The manual's warning belongs to the machine and not to us: "Do not try
     * to replay musics or sounds that resist in fast ram."
     */
    'bank to chip'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.memType = 1
    },
    'bank to fast'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.memType = 0
    },

    /** Bank Name bank,name$ — routine 58. "the 8 characters long name" */
    'bank name'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      const b = rt.memBanks.get(n)
      if (!b) amcafErr()
      // "Most AMOS commands ignore this ID, but e.g the AMOS Tracker commands
      // require a bank named 'Tracker '" -- which is why it pads to eight
      b.name = name.slice(0, 8).padEnd(8, ' ')
    },

    /**
     * Bank Stretch bank To length — routine 53. "Extents the bank ... to the
     * given new length", and "During this process, the starting address of
     * the bank is changed", which is a realloc.
     */
    'bank stretch'(it) {
      const n = it.evalInt()
      it.expect('to')
      const len = it.evalInt()
      const b = rt.memBanks.get(n)
      if (!b || len < 0) amcafErr()
      const next = new Uint8Array(len)
      next.set(b.data.subarray(0, Math.min(len, b.data.length)))
      b.data = next
    },

    /** Bank Copy source To target, or start,end To target — routine 57/56 */
    'bank copy'(it) {
      const first = it.evalInt()
      let src: Uint8Array
      if (it.accept(',')) {
        const end = it.evalInt()
        it.expect('to')
        src = bankRegion(rt, first, end)
      } else {
        it.expect('to')
        src = bankRegion(rt, first, null)
      }
      const target = it.evalInt()
      const dst = rt.memBanks.get(target)
      if (!dst) {
        rt.reserveBank(target, src.length, 'Amcaf   ')
        rt.memBanks.get(target)!.data.set(src)
        return
      }
      const next = new Uint8Array(src.length)
      next.set(src)
      dst.data = next
    },

    /**
     * Bank Delta Encode / Decode — routines 30/29 and 32/31.
     *
     * "Delta encoding just stores the difference from one byte to the next,
     * so it certain hull curve patterns in samples can be seen more 'clearly'
     * for packing algorithms." Not a packer itself: the length never changes.
     */
    'bank delta encode'(it) {
      const r = bankArgs(rt, it)
      let prev = 0
      for (let i = 0; i < r.length; i++) {
        const v = r[i]!
        r[i] = (v - prev) & 0xff
        prev = v
      }
    },
    'bank delta decode'(it) {
      const r = bankArgs(rt, it)
      let prev = 0
      for (let i = 0; i < r.length; i++) {
        prev = (prev + r[i]!) & 0xff
        r[i] = prev
      }
    },

    ...bankCodeOps(rt),

  }
}

/**
 * The extension's failure path.
 *
 * Every range check in the library ends in the same branch — the
 * disassembler renders it `Rbmi routine 390` / `Rbeq routine 390` — and that
 * index is past the end of AMCAF's own 354-entry jump table, so it is a call
 * out of the extension rather than into it. With no message table anywhere in
 * the hunk there is nothing to read a text from.
 *
 * NOTE: which AMOS error it raises was not recovered. What a program can
 * observe through `Trap` is that the call failed, so it fails as AMOS's own
 * generic — the same choice the AGA port made for the same reason.
 */
const amcafErr: () => never = () => {
  throw new AmosError('Illegal function call', 23)
}

/**
 * The quarter-degree sine table, 1024 units to the turn, scaled by 256.
 *
 * `Qsin` reads a word from a table whose pointer sits at `$6aa` in the
 * extension's data block, multiplies by the radius and shifts right by 8
 * ($6326: `move.w (a0,d1.w),d3 / muls.w d0,d3 / asr.l #8,d3`). The shift
 * proves the scale is 256 and the `andi.w #$3ff` proves the length is 1024.
 *
 * NOTE: the table's CONTENTS were not recovered. It is not static data in the
 * code hunk — a search for it under three plausible scalings found nothing —
 * and the pointer is filled in by an init path that trampolines out of the
 * extension's own routine table. So the per-entry rounding here is ours, not
 * the library's, and Qsin/Qcos/Qarc are classified APPROXIMATED rather than
 * FAITHFUL: the scale and period are proven, individual entries may differ by
 * one from what the machine held.
 */
const SIN256 = Int16Array.from({ length: 1024 }, (_, i) => Math.round(Math.sin((2 * Math.PI * i) / 1024) * 256))

/** sign-extend a word, which is what `ext.l d3` does to the result */
const extW = (v: number): number => (v << 16) >> 16

/**
 * The shared tail of Qsin and Qcos ($6326, $6300).
 *
 * A radius of zero returns zero WITHOUT reading the angle — the routine tests
 * it first and steps `a3` past the second argument by hand. The `addx.w d2,d3`
 * after the shift adds the bit the `asr` pushed into X, so the result is
 * rounded on bit 7 rather than truncated, and the final `ext.l` narrows it to
 * a word: a radius large enough to overflow 16 bits wraps.
 */
function qtrig(angle: number, radius: number, quarterTurn: number): number {
  if (radius === 0) return 0
  const e = SIN256[(angle + quarterTurn) & 0x3ff]!
  const p = Math.imul(e, extW(radius))
  return extW((p >> 8) + ((p >> 7) & 1))
}


/* ------------------------------------------------------------------ *
 * Slice 2: strings
 * ------------------------------------------------------------------ */

/**
 * Scancode to key name, for `Scanstr$`.
 *
 * NOTE: AMCAF's own spellings were not recovered. The extension ships no
 * string table at all — a search of the whole hunk for "Space", "Escape",
 * "Return" and friends finds nothing — so the names must come from AMOS or
 * the keymap, neither of which is modelled as text here. These are the Amiga
 * rawkey names for the codes the port already tracks, which answers the
 * question a program is asking ("what key is this?") without claiming to be
 * character-for-character what the library printed. Classified APPROXIMATED.
 */
const KEY_NAMES: Record<number, string> = {
  0x45: 'Esc', 0x40: 'Space', 0x44: 'Return', 0x41: 'Backspace', 0x42: 'Tab', 0x46: 'Del',
  0x4c: 'Up', 0x4d: 'Down', 0x4e: 'Right', 0x4f: 'Left',
  0x60: 'Shift', 0x61: 'Shift', 0x63: 'Ctrl', 0x64: 'Alt', 0x65: 'Alt',
  0x10: 'Q', 0x11: 'W', 0x12: 'E', 0x13: 'R', 0x14: 'T', 0x15: 'Y', 0x16: 'U', 0x17: 'I', 0x18: 'O', 0x19: 'P',
  0x20: 'A', 0x21: 'S', 0x22: 'D', 0x23: 'F', 0x24: 'G', 0x25: 'H', 0x26: 'J', 0x27: 'K', 0x28: 'L',
  0x31: 'Z', 0x32: 'X', 0x33: 'C', 0x34: 'V', 0x35: 'B', 0x36: 'N', 0x37: 'M',
  0x01: '1', 0x02: '2', 0x03: '3', 0x04: '4', 0x05: '5',
  0x06: '6', 0x07: '7', 0x08: '8', 0x09: '9', 0x0a: '0',
  0x50: 'F1', 0x51: 'F2', 0x52: 'F3', 0x53: 'F4', 0x54: 'F5',
  0x55: 'F6', 0x56: 'F7', 0x57: 'F8', 0x58: 'F9', 0x59: 'F10',
}

/** the shared body of Lsstr$ and Lzstr$ (routines 178 and 177, $488e) */
function padNum(v: number, n: number, pad: string): string {
  // `Rbeq` on zero and `cmp.w #$a / Rbhi` bound n to 1..10
  if (n < 1 || n > 10) amcafErr()
  // "The sign of the number will not be printed"
  const digits = String(Math.abs(v))
  // the routine walks exactly n positions of a power-of-ten table, so digits
  // past the field are never emitted rather than overflowing it
  return digits.length > n ? digits.slice(digits.length - n) : digits.padStart(n, pad)
}

/* ------------------------------------------------------------------ *
 * Slice 3: date and time
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** Cd Weekday is 1 = Monday .. 7 = Sunday, and day 0 (1 Jan 1978) is a Sunday */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * AMCAF's packed time, which the manual spells out rather than leaving to be
 * guessed: *"the time is created out of Wordswap(minutes)+ticks"*.
 *
 * So the minutes since midnight sit in the HIGH word and the ticks — fiftieths
 * of a second within the minute, 0..2999 — in the low one. It says why, too:
 * *"This is NOT a value in the standard DOS-format as this one would require
 * two longwords."*
 */
const packTime = (mins: number, ticks: number): number => (((mins & 0xffff) << 16) | (ticks & 0xffff)) | 0
const timeMins = (t: number): number => (t >>> 16) & 0xffff
const timeTicks = (t: number): number => t & 0xffff

/* ------------------------------------------------------------------ *
 * Slice 4: banks
 * ------------------------------------------------------------------ */

/**
 * The two forms every bank command has: a bank number, or an explicit
 * `startaddress To endaddress` pair.
 *
 * The workers do not care which — they are handed a pointer and a length and
 * derive the count with `sub.l a0,d7`, so one region helper serves both. The
 * end address is EXCLUSIVE in that arithmetic.
 */
function bankRegion(rt: Runtime, a: number, b: number | null): Uint8Array {
  if (b === null) {
    const bank = rt.memBanks.get(a)
    if (!bank) amcafErr()
    return bank.data
  }
  const len = b - a
  if (len <= 0) amcafErr()
  const head = rt.resolveAddr(a)
  if (!head) amcafErr()
  const avail = head.data.length - head.off
  return head.data.subarray(head.off, head.off + Math.min(len, avail))
}

/** the `bank` / `start To end` argument pair every Bank Code command takes */
function bankArgs(rt: Runtime, it: Interp): Uint8Array {
  const first = it.evalInt()
  if (it.accept('to')) return bankRegion(rt, first, it.evalInt())
  return bankRegion(rt, first, null)
}

/**
 * The ten `Bank Code` encoders — five algorithms over bytes and words.
 *
 * Xor, Add, Rol and Ror are what their names say and the manual describes;
 * MIX is the one that needed the binary, and it is a small stream cipher
 * rather than a per-element operation (routines 37 and 47):
 *
 *     d1 = code XOR $AA          ; $FACE in the word version
 *     loop: d0 = d0 + d1         ; the key evolves every element
 *           (a0)+ = (a0) XOR d0
 *
 * So the key walks, which is why "So coded banks should be hard to decode"
 * and why decoding is the same command with the same code rather than the
 * negative one. The word form's constant is $FACE and NOT $AAAA, which is
 * the sort of thing only the binary tells you.
 *
 * Rol and Ror take a rotate count, so the manual bounds `code` to 1..7 on
 * `.b` and 1..15 on `.w`, and "To decode a bank either use the negative code
 * with the same instruction or the same key code along with the ... Ror
 * command" -- a negative count rotates the other way.
 */
function bankCodeOps(rt: Runtime): Record<string, Instr> {
  const out: Record<string, Instr> = {}
  const each = (r: Uint8Array, wide: boolean, f: (v: number, i: number) => number): void => {
    if (!wide) {
      for (let i = 0; i < r.length; i++) r[i] = f(r[i]!, i) & 0xff
      return
    }
    for (let i = 0; i + 1 < r.length; i += 2) {
      const v = f((r[i]! << 8) | r[i + 1]!, i >> 1) & 0xffff
      r[i] = (v >> 8) & 0xff
      r[i + 1] = v & 0xff
    }
  }
  const rot = (v: number, n: number, bits: number): number => {
    const mask = (1 << bits) - 1
    const k = ((n % bits) + bits) % bits
    return ((v << k) | (v >>> (bits - k))) & mask
  }
  for (const wide of [false, true]) {
    const sfx = wide ? '.w' : '.b'
    const bits = wide ? 16 : 8
    const mixConst = wide ? 0xface : 0xaa
    out[`bank code xor${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => v ^ code)
    }
    out[`bank code add${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => v + code)
    }
    out[`bank code mix${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      const step = (code ^ mixConst) & ((1 << bits) - 1)
      let k = code & ((1 << bits) - 1)
      each(bankArgs(rt, it), wide, (v) => {
        k = (k + step) & ((1 << bits) - 1)
        return v ^ k
      })
    }
    out[`bank code rol${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => rot(v, code, bits))
    }
    out[`bank code ror${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => rot(v, -code, bits))
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Slice 5: disk and DOS objects
 * ------------------------------------------------------------------ */

/**
 * Which object an `Object *` accessor answers for.
 *
 * Every one has two forms — with a path and without — and the no-argument
 * form reads whatever the Examine context currently describes. That is the
 * whole point of the family: walk a directory with Examine Next$ and read
 * each entry's details without naming it again.
 */
function objPath(rt: Runtime, a: Value[]): string {
  if (a.length > 0) return str(a[0]!)
  return rt.amcaf.examine.current
}

function objSize(rt: Runtime, path: string): number {
  if (!rt.vfs || rt.vfs.exists(path) !== 'file') return 0
  return rt.vfs.readFile(path)?.length ?? 0
}

/** Wload / Dload: the whole file into a bank, Work or Data */
function loadToBank(rt: Runtime, it: Interp, dataBank: boolean): void {
  const file = it.evalStr()
  it.expect(',')
  const n = it.evalInt()
  const bytes = rt.vfs?.readFile(file) ?? null
  if (bytes === null) {
    rt.amcaf.ioError = 205
    amcafErr()
  }
  rt.reserveBank(n, bytes.length, 'Amcaf   ', dataBank)
  rt.memBanks.get(n)!.data.set(bytes)
  rt.amcaf.ioError = 0
}

/** Wsave / Dsave: "Dsave is exactly the same as Wsave in every aspect" */
function saveBank(rt: Runtime, it: Interp): void {
  const file = it.evalStr()
  it.expect(',')
  const b = rt.memBanks.get(it.evalInt())
  if (!b) amcafErr()
  rt.vfs?.writeFile(file, b.data)
  rt.amcaf.ioError = 0
}

/**
 * `Io Error$` texts.
 *
 * These are dos.library's, not the extension's — AMCAF ships no strings at
 * all, and the manual says the function "Returns a dos errorstring". Only the
 * codes a modelled filesystem can actually produce are listed; anything else
 * gets the empty string the manual describes for an unknown number ("If no
 * error number exists, an empty string will be returned").
 */
const DOS_ERRORS: Record<number, string> = {
  103: 'insufficient free store',
  105: 'task table full',
  120: 'argument line invalid or too long',
  121: 'file is not an object module',
  202: 'object in use',
  203: 'object already exists',
  204: 'directory not found',
  205: 'object not found',
  206: 'invalid window',
  210: 'invalid stream component name',
  212: 'object not of required type',
  213: 'disk not validated',
  214: 'disk write protected',
  216: 'directory not empty',
  218: 'device not mounted',
  221: 'disk full',
  222: 'file is protected from deletion',
  223: 'file is write protected',
  224: 'file is read protected',
  225: 'not a valid DOS disk',
  226: 'no disk in drive',
}
const dosErrorText = (n: number): string => DOS_ERRORS[n] ?? ''

/**
 * The tool types of an icon, one per line.
 *
 * NOTE: `.info` files are Workbench icons and this port does not decode them.
 * A program asking for tool types it did not write gets an empty string,
 * which is the same answer the manual gives for a file with no icon.
 */
function toolTypes(rt: Runtime, name: string): string {
  // the icon has to exist for there to be anything to say; its contents are
  // a Workbench DiskObject this port does not decode
  return rt.vfs?.readFile(`${name}.info`) === null ? '' : ''
}

export function makeAmcafFunctions(rt: Runtime): Record<string, Func> {
  void rt
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0))
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))
  return {

    /**
     * =Chr.w$(v) / =Chr.l$(v) — routines 179 and 180. A number as its raw
     * bytes, big-endian, "Using this technique, you can save numbers as
     * normal strings". Chr.w$ ignores the upper 16 bits.
     */
    'chr.w$': (_, a) => {
      const v = i0(a, 0) & 0xffff
      return VS(String.fromCharCode((v >> 8) & 0xff, v & 0xff))
    },
    'chr.l$': (_, a) => {
      const v = i0(a, 0)
      return VS(String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
    },

    /**
     * =Asc.w(s$) / =Asc.l(s$) — routines 181 and 182, the way back.
     *
     * Asc.w is UNSIGNED ("the result will be between 0 and 65535") and Asc.l
     * is SIGNED ("can range between -2147483648 and +2147483647"), which is
     * the only asymmetry in the group. A string too short to hold the value
     * is an error in both.
     */
    'asc.w': (_, a) => {
      const t = s0(a, 0)
      if (t.length < 2) amcafErr()
      return VI(((t.charCodeAt(0) & 0xff) << 8) | (t.charCodeAt(1) & 0xff))
    },
    'asc.l': (_, a) => {
      const t = s0(a, 0)
      if (t.length < 4) amcafErr()
      let v = 0
      for (let i = 0; i < 4; i++) v = ((v << 8) | (t.charCodeAt(i) & 0xff)) >>> 0
      return VI(v | 0)
    },

    /**
     * =Lsstr$(v,n) / =Lzstr$(v,n) — routines 178 and 177 ($488e).
     *
     * A number right-justified in exactly n characters. Lsstr$ pads with
     * spaces and Lzstr$ with zeros, and NEITHER prints the sign — the
     * manual says so and the routine never emits one.
     */
    'lsstr$': (_, a) => VS(padNum(i0(a, 0), i0(a, 1), ' ')),
    'lzstr$': (_, a) => VS(padNum(i0(a, 0), i0(a, 1), '0')),

    /**
     * =Insstr$(a$,b$,pos) — routine 187 ($4a44).
     *
     * `pos` is a COUNT OF LEADING CHARACTERS KEPT, not a 1-based index: the
     * routine errors on a negative one (`Rbmi`) and on `pos > len(a$)`
     * (`cmp.w d5,d7 / Rbhi`), so the legal range is 0..len inclusive. The
     * manual's example agrees — inserting "dear " at 6 into "Hello Ben!"
     * keeps the six characters "Hello " and gives "Hello dear Ben!".
     *
     * An empty b$ returns a$ untouched, which the routine takes as a special
     * case before allocating anything.
     */
    'insstr$': (_, a) => {
      const base = s0(a, 0)
      const ins = s0(a, 1)
      const pos = i0(a, 2)
      if (pos < 0 || pos > base.length) amcafErr()
      if (ins === '') return VS(base)
      return VS(base.slice(0, pos) + ins + base.slice(pos))
    },

    /**
     * =Cutstr$(s$,pos1 To pos2) — routine 188 ($4aae). Removes the run from
     * pos1 to pos2 INCLUSIVE, counting from 1: the manual's example cuts
     * 7 To 11 out of "Hello dear Ben!" and gets "Hello Ben!", which is the
     * five characters "dear ".
     *
     * NOTE: the routine's middle runs into bytes the disassembler cannot
     * separate from code — the same misdecode `Vmod` hits — so the bound
     * checks it makes (`Rbmi` on a negative position, on pos2 < pos1, and on
     * pos1 past the end) are legible but the exact arithmetic is not. The
     * worked example is unambiguous and is what this follows.
     */
    'cutstr$': (_, a) => {
      const t = s0(a, 0)
      const p1 = i0(a, 1)
      const p2 = i0(a, 2)
      if (p1 < 0 || p2 < p1 || p1 > t.length) amcafErr()
      return VS(t.slice(0, Math.max(0, p1 - 1)) + t.slice(p2))
    },

    /** =Replacestr$(s$,search$ To replace$) — routine 189, every occurrence */
    'replacestr$': (_, a) => {
      const t = s0(a, 0)
      const find = s0(a, 1)
      if (find === '') return VS(t)
      return VS(t.split(find).join(s0(a, 2)))
    },

    /**
     * =Itemstr$(s$,n) and =Itemstr$(s$,n,sep$) — routines 190 and 191.
     *
     * Items are numbered FROM ZERO and separated by '|' unless a single
     * character is given. "Empty strings for s$ are not allowed and will
     * create an error message, however, empty items can be used without
     * hesitation. Trying to access a item, that does not exist, will create
     * an error aswell."
     */
    'itemstr$': (_, a) => {
      const t = s0(a, 0)
      const n = i0(a, 1)
      const sep = a.length > 2 ? s0(a, 2) : '|'
      if (t === '' || n < 0 || sep === '') amcafErr()
      const parts = t.split(sep[0]!)
      if (n >= parts.length) amcafErr()
      return VS(parts[n]!)
    },

    /**
     * =Scanstr$(scancode) — routine 278. "returns the name of a key
     * according to the parameter 'scancode' ... If there is no key for the
     * scancode, an empty string will be returned."
     */
    'scanstr$': (_, a) => VS(KEY_NAMES[i0(a, 0)] ?? ''),


    /**
     * =Current Date — "counts the days passed since 1st January 1978", which
     * is the AmigaDOS DateStamp day count exactly.
     */
    'current date': () => VI(rt.host.clock.now().days),

    /** =Current Time — the packed minutes/ticks pair described above */
    'current time': () => {
      const st = rt.host.clock.now()
      return VI(packTime(st.mins, st.ticks))
    },

    /** =Cd Day(date) — "a value between 1 and 31" */
    'cd day': (_, a) => VI(stampToYmd(i0(a, 0))[2]),
    /** =Cd Month(date) — "lies between 1 and 12" */
    'cd month': (_, a) => VI(stampToYmd(i0(a, 0))[1]),
    /** =Cd Year(date) — the year out of the stamp */
    'cd year': (_, a) => VI(stampToYmd(i0(a, 0))[0]),

    /**
     * =Cd Weekday(date) — "can range between 1 (monday) and 7 (sunday)".
     *
     * Day zero is 1 January 1978, which was a Sunday, so the count starts at
     * 7 and not at 1.
     */
    'cd weekday': (_, a) => VI((((i0(a, 0) % 7) + 7) % 7 === 0 ? 7 : ((i0(a, 0) % 7) + 6) % 7 + 1)),

    /** =Cd Date$(date) — "the format 'WWW DD-MMM-YY'" */
    'cd date$': (_, a) => {
      const d = i0(a, 0)
      const [y, m, day] = stampToYmd(d)
      const wd = WEEKDAYS[(((d % 7) + 7) % 7 + 6) % 7]!.slice(0, 3)
      const yy = String(y % 100).padStart(2, '0')
      return VS(`${wd} ${String(day).padStart(2, '0')}-${MONTHS[m - 1]}-${yy}`)
    },

    /**
     * =Cd String(date$) — dos.library's StrToDate, which is why the manual
     * says "This command only works on OS2.0 and higher".
     *
     * "DD-MMM-YY" or "DD-month-YY", plus the relative words the library
     * accepts: Today, Tomorrow, Yesterday and a weekday name, where
     * "weekday strings refer to the last occurence of the week, i.e 'Monday'
     * represents last monday and not next monday". -1 when it will not parse.
     */
    'cd string': (_, a) => {
      const t = s0(a, 0).trim().toLowerCase()
      const today = rt.host.clock.now().days
      if (t === 'today') return VI(today)
      if (t === 'tomorrow') return VI(today + 1)
      if (t === 'yesterday') return VI(today - 1)
      const wd = WEEKDAYS.findIndex((w) => w.toLowerCase() === t)
      if (wd >= 0) {
        // the LAST occurrence, so step back until the weekday matches
        for (let i = 1; i <= 7; i++) {
          const d = today - i
          if ((((d % 7) + 7) % 7 + 6) % 7 === wd) return VI(d)
        }
      }
      const m = /^(\d{1,2})-([a-z]+)-(\d{2,4})$/.exec(t)
      if (!m) return VI(-1)
      const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2])
      const monFull = MONTHS_FULL.findIndex((x) => x.toLowerCase() === m[2])
      const mi = mon >= 0 ? mon : monFull
      if (mi < 0) return VI(-1)
      const day = Number(m[1])
      let year = Number(m[3])
      // a two-digit year is 1978..2077, the range a DateStamp can hold
      if (year < 100) year += year < 78 ? 2000 : 1900
      const days = Math.floor((Date.UTC(year, mi, day) - STAMP_EPOCH) / DAY_MS)
      if (!Number.isFinite(days) || days < 0) return VI(-1)
      const [cy, cm, cd] = stampToYmd(days)
      if (cy !== year || cm !== mi + 1 || cd !== day) return VI(-1) // 31-Feb and friends
      return VI(days)
    },

    /** =Ct Hour(time) — "Separates the hour from the packed time" */
    'ct hour': (_, a) => VI(Math.floor(timeMins(i0(a, 0)) / 60)),
    /** =Ct Minute(time) — the minutes within the hour */
    'ct minute': (_, a) => VI(timeMins(i0(a, 0)) % 60),
    /** =Ct Second(time) — the ticks resolved to whole seconds */
    'ct second': (_, a) => VI(Math.floor(timeTicks(i0(a, 0)) / TICKS_PER_SECOND)),

    /**
     * =Ct Tick(time) — "Calculates the number of vertical blanks (=1/50 of a
     * second) from the parameter 'time'".
     *
     * NOTE: that sentence does not say whether the count is within the second
     * or within the minute, and the field itself is the whole low word. The
     * low word is what this returns, so Ct Tick and Ct Second read the same
     * field at two resolutions rather than partitioning it.
     */
    'ct tick': (_, a) => VI(timeTicks(i0(a, 0))),

    /** =Ct Time$(time) — "a string in the format 'HH:MM:SS'" */
    'ct time$': (_, a) => {
      const t = i0(a, 0)
      const mins = timeMins(t)
      const two = (n: number): string => String(n).padStart(2, '0')
      return VS(`${two(Math.floor(mins / 60))}:${two(mins % 60)}:${two(Math.floor(timeTicks(t) / TICKS_PER_SECOND))}`)
    },

    /**
     * =Ct String(time$) — dos.library's StrToTime, "HH:MM" or "HH:MM:SS",
     * and -1 when it will not parse. OS2.0 and higher, like Cd String.
     */
    'ct string': (_, a) => {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s0(a, 0).trim())
      if (!m) return VI(-1)
      const h = Number(m[1])
      const mi = Number(m[2])
      const sec = m[3] === undefined ? 0 : Number(m[3])
      if (h > 23 || mi > 59 || sec > 59) return VI(-1)
      return VI(packTime(h * 60 + mi, sec * TICKS_PER_SECOND))
    },


    /**
     * =Bank Checksum(bank) or (start To end) — routines 55 and 54 ($2782).
     *
     * A plain LONGWORD SUM of the region, then `eori.l #$faceface`. The
     * author liked that constant: the word-wide Bank Code Mix uses $FACE and
     * the byte-wide one $AA.
     *
     * The region is measured in longwords (`lsr.l #2`), so a trailing byte,
     * word or three bytes are not counted.
     */
    'bank checksum': (_, a) => {
      const r = bankRegion(rt, i0(a, 0), a.length > 1 ? i0(a, 1) : null)
      let sum = 0
      const longs = r.length >>> 2
      for (let i = 0; i < longs; i++) {
        const o = i * 4
        sum = (sum + (((r[o]! << 24) | (r[o + 1]! << 16) | (r[o + 2]! << 8) | r[o + 3]!) | 0)) | 0
      }
      return VI((sum ^ 0xfaceface) | 0)
    },

    /** =Bank Name$(bank) — routine 59 */
    'bank name$': (_, a) => {
      const b = rt.memBanks.get(i0(a, 0))
      if (!b) amcafErr()
      return VS(b.name)
    },


    /**
     * =Examine Next$ — the next entry's name, and "If the end of the
     * directory list is reached, file$ will contain an empty string and the
     * drawer will be closed."
     */
    'examine next$': () => {
      const e = rt.amcaf.examine
      e.index++
      const name = e.entries[e.index]
      if (name === undefined) {
        rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
        return VS('')
      }
      e.current = joinAmigaPath(e.dir, name)
      return VS(name)
    },

    /** =Object Type — positive for a directory, negative for a file */
    'object type': (_, a) => {
      const p = objPath(rt, a)
      const k = rt.vfs?.exists(p) ?? null
      return VI(k === null ? 0 : entryType(k === 'dir'))
    },
    /** =Object Size — zero for a directory, which has no byte size */
    'object size': (_, a) => VI(objSize(rt, objPath(rt, a))),
    /** =Object Blocks — "the number of blocks the object uses on a volume" */
    'object blocks': (_, a) => VI(blocksFor(objSize(rt, objPath(rt, a)))),
    /** =Object Name$ — the object's own name, without its path */
    'object name$': (_, a) => {
      const p = objPath(rt, a)
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut >= 0 ? p.slice(cut + 1) : p)
    },
    /** =Object Date — the DateStamp day count */
    'object date': (_, a) => VI(rt.vfs?.meta(objPath(rt, a)).days ?? 0),
    /** =Object Time — the same packed minutes/ticks Current Time uses */
    'object time': (_, a) => {
      const m = rt.vfs?.meta(objPath(rt, a))
      return VI(packTime(m?.mins ?? 0, m?.ticks ?? 0))
    },
    /** =Object Protection — the raw bitmap */
    'object protection': (_, a) => VI(rt.vfs?.meta(objPath(rt, a)).protection ?? 0),
    /** =Object Comment$ — the FileNote */
    'object comment$': (_, a) => VS(rt.vfs?.meta(objPath(rt, a)).comment ?? ''),

    /**
     * =Object Protection$(prot) — note the argument: this takes the NUMERIC
     * VALUE, not a path. "Object Protection$ function converts this numeric
     * value into a string in the format 'hsparwed'."
     */
    'object protection$': (_, a) => VS(protectionString(i0(a, 0) & 0xff)),

    /** =Filename$("DH2:AMOS/AMOSPro") is "AMOSPro" */
    'filename$': (_, a) => {
      const p = s0(a, 0)
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut >= 0 ? p.slice(cut + 1) : p)
    },
    /** =Path$("DH2:AMOS/AMOSPro") is "DH2:AMOS" — "a kind of Parent$" */
    'path$': (_, a) => {
      const p = s0(a, 0)
      const slash = p.lastIndexOf('/')
      if (slash >= 0) return VS(p.slice(0, slash))
      const colon = p.lastIndexOf(':')
      return VS(colon >= 0 ? p.slice(0, colon + 1) : '')
    },

    /**
     * =Pattern Match(source$,pattern$) — dos.library's ParsePattern and
     * MatchPattern, which is why "This command only works on OS2.0 and
     * higher". "The pattern may contain any regular DOS jokers[;] a asterik
     * (*) will be converted into '#?' automatically."
     */
    'pattern match': (_, a) => VI(amigaMatch(s0(a, 0), s0(a, 1).replace(/\*/g, '#?')) ? -1 : 0),

    /**
     * =Disk Type(directory$) — 0 a real device, 1 an assign, 2 a volume name.
     * "Using this function you can filter specific disk types out of a
     * device list."
     */
    'disk type': (_, a) => {
      // NOTE: an assign and a volume are not told apart here. The distinction
      // is a dos.library device-list walk, and this port's AmigaFS keeps its
      // assign map private, so a name that is not a floppy device answers 2.
      // APPROXIMATED for that reason.
      const name = s0(a, 0).replace(/:.*$/, '')
      return VI(/^df\d$/i.test(name) ? 0 : 2)
    },

    /**
     * =Disk State(directory$) — bit 0 write-protected or validating, bit 1
     * in use. The manual is candid about the third case: "If no disk is in
     * the drive, it normally should return -1, but I'm afraid..."
     *
     * Nothing here is write protected, being read from a mounted volume, and
     * nothing is mid-write when a keyword can observe it.
     */
    'disk state': (_, a) => VI(rt.vfs?.exists(s0(a, 0)) === null ? -1 : 0),

    /** =Io Error / =Io Error$ — the last AmigaDOS error, not an AMOS one */
    'io error': () => VI(rt.amcaf.ioError),
    'io error$': (_, a) => VS(dosErrorText(i0(a, 0))),

    /**
     * =Command Name$ — "the file name of the program under which AMOS or the
     * compiled program has been started. This is required for example to
     * read the own Tool Types."
     */
    'command name$': () => {
      // NOTE: nothing records the file a program was loaded from under a name
      // the program itself could have used, so this answers empty. A program
      // using it to find its own Tool Types gets the same nothing Tool Types$
      // gives, which at least keeps the pair consistent. APPROXIMATED.
      return VS('')
    },

    /**
     * =Tool Types$(filename$) — an icon's tool types, one per line.
     *
     * "The supplied file must not have a '.info' appended!" and "The various
     * Tool Types are seperated by a line feed character (Chr$(10)). So they
     * can be printed out easily using Print."
     */
    'tool types$': (_, a) => VS(toolTypes(rt, s0(a, 0))),

    /**
     * =Dos Hash(file$) — "Returns the hash value of a file. Only for
     * advanced users who want to read directly from dos disks."
     *
     * The AmigaDOS directory hash: fold the name, case-insensitively, into
     * a bucket. Its one caller is somebody walking a real disk's hash chains.
     */
    'dos hash': (_, a) => {
      const name = s0(a, 0)
      let h = name.length
      for (let i = 0; i < name.length; i++) {
        h = (h * 13 + (name.charCodeAt(i) & 0xff)) & 0x7ff
      }
      return VI(h % 72)
    },

    /** =Nfn — routine 22. "returns nothing useful ... used in speed testing" */
    nfn: () => VI(0),

    /**
     * =Cpu — routine 216 ($5026). Reads ExecBase+$128 (AttnFlags) and maps
     * the bits onto 68000/68010/68020/68030/68040/68060, cleverly: d3 starts
     * as the LONGWORD $109a0 (68000 decimal) and each hit overwrites only the
     * low WORD, so $9b4 turns it into $109b4 = 68020.
     *
     * The modelled machine is an A1200, which is AttnFlags bit 1 — the same
     * identity Jd Cpu reports and the same one the 2MB chip / fast-board
     * memory pools answer for.
     */
    cpu: () => VI(68020),

    /**
     * =Fpu — routine 217. Zero when nothing is fitted, which is the A1200 as
     * modelled; Jd Fpu agrees.
     */
    fpu: () => VI(0),

    /** =Even(v) — routine 193 ($4c9a): `btst #0` and -1 when the bit is clear */
    even: (_, a) => VI((i0(a, 0) & 1) === 0 ? -1 : 0),
    /** =Odd(v) — routine 192, the same test the other way up */
    odd: (_, a) => VI((i0(a, 0) & 1) !== 0 ? -1 : 0),

    /** =Wordswap(v) — routine 198 ($4cf6): one `swap d3` */
    wordswap: (_, a) => {
      const v = i0(a, 0)
      return VI(((v >>> 16) | (v << 16)) | 0)
    },

    /**
     * =Lsl(v,n) — routine 196 ($4ce2): `asl.l d0,d3`.
     *
     * The manual says "Rotates the number 'v' to the left", which it does not;
     * it shifts, and bits leaving the top are lost. Its own worked
     * description ("v*2 ... v*4 ... v*8") is the shift, so the word "rotates"
     * is loose writing rather than a second behaviour.
     */
    lsl: (_, a) => VI((i0(a, 0) << (i0(a, 1) & 63)) | 0),

    /**
     * =Lsr(v,n) — routine 197 ($4cec).
     *
     * DEVIATION: the keyword is named for a LOGICAL shift and the instruction
     * is `asr.l`, an arithmetic one, so the sign bit is replicated and a
     * negative value stays negative. That is the library's choice, and
     * it also makes the manual's claim — "does the same as a division by 2^n"
     * — false for negatives, because ASR rounds toward minus infinity where
     * division rounds toward zero. Lsr(-3,1) is -2, not -1. Reproduced.
     */
    lsr: (_, a) => VI(i0(a, 0) >> (i0(a, 1) & 63)),

    /**
     * =Binexp(a) — routine 194. 2^a, and the manual bounds a to 0..31.
     * A shift of 32 or more is undefined on the 68000 and meaningless here,
     * so the documented range is enforced.
     */
    binexp: (_, a) => {
      const n = i0(a, 0)
      if (n < 0 || n > 31) amcafErr()
      return VI((1 << n) | 0)
    },

    /**
     * =Binlog(v) — routine 195 ($4cc2), and the routine is the specification.
     *
     * Zero errors immediately (`Rbeq`). Otherwise it shifts right counting
     * until bit 0 is set, shifts once more, and errors if ANYTHING is left
     * (`tst.l d0 / Rbne`) — so a value that is not exactly a power of two is
     * an error rather than a floor, which is what the manual promises.
     */
    binlog: (_, a) => {
      const v = i0(a, 0) >>> 0
      if (v === 0 || (v & (v - 1)) !== 0) amcafErr()
      return VI(31 - Math.clz32(v))
    },

    /**
     * =Qsqr(v) — routine 271 ($6286): integer square root by Newton's method
     * over a scaled start, no maths library involved.
     *
     * Zero returns zero before anything else; a negative value takes the
     * `Rbmi` error branch.
     */
    qsqr: (_, a) => {
      const v = i0(a, 0)
      if (v === 0) return VI(0)
      if (v < 0) amcafErr()
      return VI(Math.floor(Math.sqrt(v)))
    },

    /**
     * =Qrnd(max) — routine 272. "totally identical to the Rnd function, with
     * the only difference, that this one is much faster", so it is the same
     * generator AMOS's own Rnd uses rather than a second one.
     */
    qrnd: (it, a) => VI(it.rndInt(i0(a, 0))),

    /** =Qsin(angle,radius) — routine 274 ($6326); 1024 units to the turn */
    qsin: (_, a) => VI(qtrig(i0(a, 0), i0(a, 1), 0)),
    /** =Qcos(angle,radius) — routine 273, a quarter turn ahead of Qsin */
    qcos: (_, a) => VI(qtrig(i0(a, 0), i0(a, 1), 256)),

    /**
     * =Qarc(deltax,deltay) — routine 275. The inverse of the pair: the angle
     * to a relative point, in the same 1024-to-the-turn units, "normally used
     * for all kinds of 'aiming-at' routines".
     */
    qarc: (_, a) => {
      const dx = i0(a, 0)
      const dy = i0(a, 1)
      const t = Math.round((Math.atan2(dy, dx) / (2 * Math.PI)) * 1024)
      return VI(t & 0x3ff)
    },

    /**
     * =Vin(val,lower To upper) — routine 184. True when the value lies
     * within the bounds, which the manual introduces with a joke about wine.
     */
    vin: (_, a) => {
      const v = i0(a, 0)
      return VI(v >= i0(a, 1) && v <= i0(a, 2) ? -1 : 0)
    },

    /**
     * =Vmod(val,upper) and =Vmod(val,lower To upper) — routines 185 and 186
     * ($49e6), two token forms of one idea.
     *
     * It WRAPS rather than clamping, which is what separates it from Vclip:
     * "If val exceeds upper by 1, it will be set to lower, if it exceeds
     * upper by 2, it will be set to lower+1. If it goes deeper than lower by
     * 1, it will be set to upper and so on." The routine divides by
     * `upper+1`, so the span is inclusive of both ends, and it takes the
     * `Rbmi` error branch on a negative upper bound.
     *
     * NOTE: the disassembly of the two-bound form runs into data the
     * disassembler renders as `dc.b "BCHCNuD"` and could not be read
     * straight through. The single-bound path is legible and the two-bound
     * one is implemented from the manual's worked description above.
     */
    vmod: (_, a) => {
      const v = i0(a, 0)
      const lower = a.length > 2 ? i0(a, 1) : 0
      const upper = a.length > 2 ? i0(a, 2) : i0(a, 1)
      if (upper < lower) amcafErr()
      const span = upper - lower + 1
      return VI(lower + (((v - lower) % span) + span) % span)
    },
  }
}
