/**
 * Range 2.6 / 2.9Plus — Shadow Software's AMOS Club extension, at slot 9.
 *
 * A grab-bag rather than a theme: a clamp, a shuffle, the MKB$/CVI binary
 * field conversions other BASICs have, a select-case built out of two
 * keywords and a latch, bob and icon metrics, floating bobs, bank naming and
 * the analogue paddles. It ships with TOME IV, which this port already has.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, two builds, no documentation for either.
 *
 * `Range.Lib` (4,088-byte hunk, Feb 1992) and `AMOSPro_Range.Lib` (5,760,
 * 2009). **The older is a strict prefix of the newer**: all 52 of its token
 * entries are byte-identical to the first 52 of the other, ids, specs and
 * routine numbers alike, so ONE port serves both — the same arrangement TOME
 * 3.1 and 4.23 have. 2.9Plus adds 25 keywords on the end and changes nothing.
 *
 * ## Identity, off the binaries
 *
 * Title strings: `AMOS Club Extension V2.6` at $ffd of the older, `AMOS Pro
 * Club Extension V2.9Plus` at $167a of the newer. So the versions are **2.6**
 * and **2.9Plus**; the registry ids `range-1.0` and `range-2.0` are this
 * port's own labels and the older manifest's "2.8" was wrong.
 *
 * Slot 9, twice over: routine 0 does `move.l a3,$178(a5)` —
 * `($178-$f8)/16 + 1 = 9` — and returns `moveq #$8,d0`, the slot zero-based.
 *
 * 2.9Plus is AMOS Pro ONLY and says so in its first instruction:
 *
 *     cmp.l #$41506578, d1      "APex"
 *     bne   .refuse             suba.l a0,a0 / moveq #$ff,d0
 *
 * which is why the two files are named `Range.Lib` and `AMOSPro_Range.Lib`.
 * 2.6 has no such check.
 *
 * ## Routine 0 identifies the machine, and the constants prove it
 *
 *     move.l  #$361f0f, $48(a3)
 *     movea.l -$8(a5), a0 / jsr $12c(a0)
 *     tst.w   d1 / beq .pal
 *     move.l  #$369e99, $48(a3)
 *
 * $361f0f is 3,546,895 and $369e99 is 3,579,545 — `PAULA_CLOCK_PAL` and
 * `PAULA_CLOCK_NTSC`, already constants in `../amiga/paula.ts`. The block's
 * $48 is the audio clock `Sam Speed` divides.
 *
 * ## The block at $178(a5)
 *
 *     $04  the Case result           $08  the Case subject
 *     $0c  the Case$ subject         $10  the float-bob counter
 *     $14  the counter Reset saved   $18  the float-bob base
 *     $1c  List Bobs step X          $20  step Y
 *     $24  the bob bank's base       $28/$2c  Game Area x margin / width
 *     $30/$34  y margin / height     $38..$44  In Screen's saved coordinates
 *     $48  the audio clock           $4c  List Palette's digit buffer
 *
 * ## Contested names — five, and all armed
 *
 * `bank name` and `bank name$` are AMCAF's, `library open` and `library
 * close` are Ercole's, and `range` itself is TURBO Plus's. Every one of those
 * is already ported, so all five are registered `qualified` and resolve as
 * `ext9:<name>`. It is the most collisions of any extension here.
 *
 * Three of the five are declared now. `library open` and `library close` are
 * 2.9Plus's and arrive with the slice that implements them: `extimpl.test.ts`
 * requires a qualified name to be one this port already defines, which is
 * what stops the list rotting into a wish.
 *
 * ## What is in this slice
 *
 * The self-contained half: values, strings, the select-case, the paddles, the
 * object metrics, the printer lines and the bank name. Left for the next: the
 * float bobs, the colour remappers, `List Bobs`, `List Palette` and the two
 * screen-to-bank copies, all of which reach into AMOS's own routines through
 * `-$4(a5)` and `$5fc(a5)`.
 */
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { PAULA_CLOCK_NTSC, PAULA_CLOCK_PAL, periodToHz } from '../amiga/paula'

export interface RangeState {
  /** $8 and $c — what `Case` and `Case$` last stored */
  caseNum: number
  caseStr: string | null
  /** $4 — the value an `Of` matched, and what `=Case` returns */
  result: number
  /** $48 — PAL or NTSC, chosen once at startup */
  clock: number
  /** $10, $14, $18 — the float-bob counter, its saved copy, and the base */
  floatCount: number
  floatSaved: number
  floatBase: number
  /** $28/$2c/$30/$34 — Game Area's margin and size, in each axis */
  areaX: number
  areaW: number
  areaY: number
  areaH: number
  /** $38..$44 — the coordinates In Screen was last given */
  inX: number
  inY: number
  inOx: number
  inOy: number
}

/**
 * Routine 0 ($42c). The clock is the only thing it computes; everything else
 * is the block's static zeroes.
 *
 * NOTE: the machine is PAL here. The NTSC branch is taken from a `tst.w d1`
 * on what an AMOS routine at `$12c(a0)` returns, and this port models a PAL
 * Amiga throughout — `PAULA_CLOCK` in paula.ts is the PAL figure for the same
 * reason.
 */
export const newRangeState = (): RangeState => ({
  caseNum: 0,
  caseStr: null,
  result: 0,
  clock: PAULA_CLOCK_PAL,
  floatCount: 0,
  floatSaved: 0,
  floatBase: 0,
  areaX: 0,
  areaW: 0,
  areaY: 0,
  areaH: 0,
  inX: 0,
  inY: 0,
  inOx: 0,
  inOy: 0,
})

/** so the NTSC constant is named rather than merely mentioned */
export const RANGE_CLOCKS = { pal: PAULA_CLOCK_PAL, ntsc: PAULA_CLOCK_NTSC }

/**
 * Routine 53 ($cf2) — resolve one image of the bob bank (d2 = 1) or the icon
 * bank (d2 = 2), or null.
 *
 *     Rbsr routine 7                       a2 = the bank's data
 *     move.l $0(a2), d7                    the image COUNT
 *     move.l #$ffffffff, d3                the answer, before any test
 *     move.l (a3)+, d0
 *     cmp.l d7,d0 / bgt .none              past the count
 *     tst.l d0 / beq .none                 or zero
 *     subq.l #$1,d0 / asl.l #$3,d0
 *     movea.l $2(a2,d0.l), a0              eight bytes an entry
 *
 * The -1 is loaded BEFORE the range test and the callers only overwrite d3
 * once they have an image, so every one of the eight accessors answers **-1**
 * out of range rather than 0. `cmp.l d7,d0 / bgt` is inclusive at the top,
 * which is right: the images are numbered from 1.
 */
function image(rt: Runtime, which: 1 | 2, n: number): { width: number; height: number; depth: number; hotX: number; hotY: number; rowBytes: number } | null {
  const bank = which === 1 ? rt.spriteBank : rt.iconBank
  if (!bank || n <= 0 || n > bank.images.length) return null
  return bank.images[n - 1] ?? null
}

export function makeRangeInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): RangeState => rt.range

  return {
    /**
     * Sam Speed voices, hz — routine 1 ($4b2).
     *
     * `d4 = clock / hz`, then one `move.w d4,$dff0X6` per set bit of the voice
     * mask: bit 0 is AUD0PER, bit 1 AUD1PER, bit 2 AUD2PER, bit 3 AUD3PER.
     * A `divu.w` by zero would trap on the machine; nothing checks.
     */
    'sam speed'(it) {
      const mask = it.evalInt()
      it.expect(',')
      const hz = it.evalInt()
      if (hz === 0) throw new AmosError('Illegal function call', 23)
      const period = Math.floor(st().clock / hz) & 0xffff
      // the sink takes a frequency; AUDxPER is a period, so it converts back
      // through the same table med.ts and music.ts use
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.audio.setFrequency(v, periodToHz(period))
    },

    /**
     * Shuffle bank, n, seed — routine 4 ($522), and the only long one here.
     *
     * It fills the bank with 1..n as words, then draws them out one at a time
     * into a second area past the first, and copies that back over the
     * original. The draw order is what `Rand` then reads, so the arithmetic
     * has to be exact rather than merely random-looking:
     *
     *     d3 = n            the count still live
     *     d4 = n * 2        the write cursor, in bytes, past the source
     *     d5 = n - 1        iterations
     *     d2 = seed
     *   loop:
     *     while (d2 >= d3) d2 -= d3        `sub.l d3,d2 / bra`
     *     pick = words[d2]                  append it
     *     words[d2] = words[d3 - 1]         the last live one fills the hole
     *     d3 -= 1
     *     d2 += d0 ; d0 += d2 ; d0 &= d3    the generator, folded on the count
     *     d5 -= 1 ; until d5 == 1
     *
     * then it appends words[1] and words[0] BY HAND — the loop stops one
     * short — and copies n words back from offset n*2 to offset 0.
     *
     * NOTE: the writes use `(a2,d4.w)`, a WORD index, so a bank big enough to
     * push the cursor past 32767 wraps rather than growing. Nothing checks
     * that the bank is 4n bytes either.
     */
    'shuffle'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      it.expect(',')
      let seed = it.evalInt()
      const mem = rt.memBanks.get(bank)
      if (!mem) throw new AmosError('bank not reserved')
      const w = new DataView(mem.data.buffer, mem.data.byteOffset, mem.data.byteLength)
      const put = (byteAt: number, v: number): void => {
        if (byteAt >= 0 && byteAt + 2 <= mem.data.length) w.setUint16(byteAt, v & 0xffff, false)
      }
      const get = (byteAt: number): number =>
        byteAt >= 0 && byteAt + 2 <= mem.data.length ? w.getUint16(byteAt, false) : 0
      for (let i = 0; i < n; i++) put(i * 2, i + 1)
      let live = n
      let cursor = n * 2
      let left = n - 1
      let idx = seed
      while (left !== 1 && live > 0) {
        while (idx >= live) idx -= live
        put(cursor, get(idx * 2))
        cursor += 2
        put(idx * 2, get((live - 1) * 2))
        live -= 1
        idx = idx + seed
        seed = (seed + idx) & live
        left -= 1
      }
      put(cursor, get(2))
      put(cursor + 2, get(0))
      for (let i = 0; i < n; i++) put(i * 2, get(n * 2 + i * 2))
    },

    /**
     * Case v — routine 16 ($6e4). Stores the subject at $8 and CLEARS the
     * result at $4, so a run of `Of`s that all miss leaves `=Case` at zero.
     */
    'case'(it) {
      const s = st()
      s.caseNum = it.evalInt()
      s.caseStr = null
      s.result = 0
    },

    /**
     * Case$ a$ — routine 18 ($6f8). An EMPTY string is stored as no subject at
     * all (`move.w (a1),d0 / beq` sends it to `move.l #$0,$c(a0)`), so `Of$`
     * can never match one — not even against another empty string.
     */
    'case$'(it) {
      const s = st()
      const v = it.evalStr()
      s.caseStr = v === '' ? null : v
      s.result = 0
    },

    /**
     * Of test, value — routine 20 ($734). `cmp.l $8(a0),d0 / beq` and then
     * `move.l d1,$4(a0)`.
     *
     * Nothing stops a later `Of` overwriting an earlier match, so the LAST
     * matching arm wins rather than the first — the opposite of a switch.
     */
    'of'(it) {
      const test = it.evalInt()
      it.expect(',')
      const value = it.evalInt()
      const s = st()
      if (test === s.caseNum && s.caseStr === null) s.result = value
    },

    /**
     * Of$ a$, value — routine 22 ($74c). The compare is by hand, length first
     * and then bytes from the END downwards (`subq.l #$1,d0` then a loop that
     * stops when d0 hits zero) — which never examines byte 0 of either string.
     *
     * DEFECT: `tst.l d0 / bne` exits the loop with d0 at zero
     * having compared indices len-1 down to 1, so two strings differing ONLY
     * in their first character match. `Of$ "cat"` matches a `Case$ "bat"`.
     */
    'of$'(it) {
      const a = it.evalStr()
      it.expect(',')
      const value = it.evalInt()
      const s = st()
      const subject = s.caseStr
      if (subject === null || subject.length !== a.length) return
      for (let i = a.length - 1; i >= 1; i--) if (a[i] !== subject[i]) return
      s.result = value
    },

    /**
     * Analog Scan — routine 24 ($784): `move.w #$1,$34(a0)` on $dff000, the
     * POTGO START bit, beginning the conversion `Analog X` and `Analog Y`
     * read one frame later. No vbl hook, unlike Ercole's `Prop On`.
     *
     * NOTE: nothing is attached to the pot pins, so the conversion never
     * completes — the same answer Ercole's `Paddle` and Sticks' `Stick Scan`
     * give for the same registers.
     */
    'analog scan'() {
      /* POTGO's START bit; with no paddle there is no conversion to start */
    },

    /**
     * Bank Name n, a$ — routine 56 ($d56).
     *
     * `subq.l #$8,a2` steps BACK from the bank's data to the eight name bytes
     * in front of it, fills them with spaces, then copies the string in. The
     * length is clamped by `cmpi.l #$8,d0 / bge` sending anything of eight or
     * more to `moveq #$7,d0` — so eight characters is the most, and the copy
     * runs backwards from the end.
     */
    'bank name'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      const mem = rt.memBanks.get(n)
      if (!mem) throw new AmosError('bank not reserved')
      mem.name = (name.length > 8 ? name.slice(0, 8) : name).padEnd(8, ' ')
    },

    /**
     * Game Area x, y To w, h — routine 62 ($f82), four stores and nothing
     * else. The pops are in reverse source order, so $34 takes the LAST
     * argument: $28 is x, $30 y, $2c w and $34 h.
     *
     * They are the margins `In Screen` tests against, and it is the only
     * reader of them.
     */
    'game area'(it) {
      const s = st()
      s.areaX = it.evalInt()
      it.expect(',')
      s.areaY = it.evalInt()
      it.expect('to')
      s.areaW = it.evalInt()
      it.expect(',')
      s.areaH = it.evalInt()
    },

    /** Float Bob Reset — routine 29 ($84e): $14 takes $10, and $10 goes to 0. */
    'float bob reset'() {
      const s = st()
      s.floatSaved = s.floatCount
      s.floatCount = 0
    },
  }
}

export function makeRangeFunctions(rt: Runtime): Record<string, Func> {
  const st = (): RangeState => rt.range

  return {
    /**
     * =Range(v, lo To hi) — routine 3 ($4fa). A CLAMP, whatever the name
     * suggests: `cmp.l d2,d0 / bgt` pins to the top and `cmp.l d1,d0 / blt`
     * to the bottom, and the value itself comes back otherwise.
     *
     * The top test runs FIRST and jumps back to the bottom test after
     * clamping, so an inverted range (hi below lo) answers lo.
     */
    'range': (_, a): Value => {
      const v = int(a[0] ?? VI(0))
      const lo = int(a[1] ?? VI(0))
      const hi = int(a[2] ?? VI(0))
      return VI(v > hi ? (hi < lo ? lo : hi) : v < lo ? lo : v)
    },

    /**
     * =Rand(i, bank) — routine 5 ($5c4). One word out of the bank `Shuffle`
     * filled, at word index i. No range check of any kind.
     */
    'rand': (_, a): Value => {
      const i = int(a[0] ?? VI(0))
      const mem = rt.memBanks.get(int(a[1] ?? VI(0)))
      if (!mem) throw new AmosError('bank not reserved')
      const at = i * 2
      if (at < 0 || at + 2 > mem.data.length) return VI(0)
      return VI((mem.data[at]! << 8) | mem.data[at + 1]!)
    },

    /**
     * =Js Screen(ox, oy, x, y) — routine 6 ($5d8), and undocumented, so the
     * name is the token table's and the meaning is the arithmetic's:
     *
     *     x >= ox - 16  and  x < ox - 16 + $150   and
     *     y >= oy - 16  and  y < oy - 16 + $e0
     *
     * $150 is 336 and $e0 is 224 — a 320x200 display plus a sixteen-pixel
     * border on every side. So it answers -1 while a point is within one
     * border's width of the screen, which is the test a game makes before
     * discarding an object that has left it.
     */
    'js screen': (_, a): Value => {
      const ox = int(a[0] ?? VI(0))
      const oy = int(a[1] ?? VI(0))
      const x = int(a[2] ?? VI(0))
      const y = int(a[3] ?? VI(0))
      const inX = x >= ox - 16 && x < ox - 16 + 0x150
      const inY = y >= oy - 16 && y < oy - 16 + 0xe0
      return VI(inX && inY ? -1 : 0)
    },

    /**
     * =Mkb$(v) / =Mki$(v) / =Mkl$(v) — routines 8, 9 and 10 ($642, $66c,
     * $694). One, two and four bytes of `v` as a string, big-endian, which is
     * what `Cvb`, `Cvi` and `Cvl` read back.
     *
     * Mkb$ masks with `asl.l #$8 / andi.l #$ff00` and then writes a WORD, so
     * the byte lands where a one-character string's first character goes and
     * the pad byte after it is whatever the allocator left.
     */
    'mkb$': (_, a): Value => VS(String.fromCharCode(int(a[0] ?? VI(0)) & 0xff)),

    'mki$': (_, a): Value => {
      const v = int(a[0] ?? VI(0)) & 0xffff
      return VS(String.fromCharCode((v >> 8) & 0xff, v & 0xff))
    },

    'mkl$': (_, a): Value => {
      const v = int(a[0] ?? VI(0)) >>> 0
      return VS(String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
    },

    /**
     * =Cvb(a$) / =Cvi(a$) / =Cvl(a$) — routines 12, 13 and 14 ($6b6, $6c6,
     * $6d6). `movea.l (a3)+,a0` then a byte, word or long at `$2(a0)` — past
     * the AMOS length word — and all three zero-extend rather than sign-
     * extend, `clr.l d3` first. Cvl is the exception by omission: it moves a
     * whole long and cannot extend anything.
     *
     * None of them checks the string is long enough.
     */
    'cvb': (_, a): Value => VI(byteAt(str(a[0] ?? VS('')), 0)),

    'cvi': (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      return VI((byteAt(s, 0) << 8) | byteAt(s, 1))
    },

    'cvl': (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      let v = 0
      for (let i = 0; i < 4; i++) v = (v << 8) | byteAt(s, i)
      return VI(v | 0)
    },

    /**
     * =Case — the unnamed second entry of `!case`, routine 19 ($724). Reads
     * the result at $4 that `Of` and `Of$` latch, and `Case`/`Case$` clear.
     */
    'case': (): Value => VI(st().result),

    /**
     * =Wrap(a$, at) — routine 31 ($872). Walks BACKWARDS from `at` looking for
     * a break character — space, comma, full stop, question mark, exclamation
     * mark or hyphen — and answers where it found one. Word wrap, in one
     * routine.
     *
     * Two edges are the routine's own and both are off by one.
     *
     * An `at` past the string is replaced by its LENGTH (`cmp.w d2,d7 / bgt`)
     * — but `move.b $2(a1,d7.l),d0` indexes the content 0-based, so the first
     * byte examined is one PAST the string. And the walk stops at index 1
     * (`cmpi.l #$1,d7 / bge`), never testing index 0, so a string whose only
     * break is its first character answers 0 having not seen it.
     */
    'wrap': (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      let at = int(a[1] ?? VI(0))
      if (at > s.length) at = s.length
      for (; at >= 1; at--) {
        const c = s[at]
        if (c === ' ' || c === ',' || c === '.' || c === '?' || c === '!' || c === '-') break
      }
      return VI(at)
    },

    /**
     * =Analog X(port) / =Analog Y(port) — routines 25 and 26 ($792, $7ba).
     *
     * `andi.l #$1,d0` MASKS the port rather than checking it, then indexes
     * $dff012 by two — POT0DAT or POT1DAT. X keeps the low byte and Y shifts
     * down from the high, which is the same pairing Ercole's `Paddle` uses
     * from the other end.
     *
     * NOTE: no paddle, so no conversion and both read 0.
     */
    'analog x': (_, a): Value => {
      void int(a[0] ?? VI(0))
      return VI(0)
    },

    'analog y': (_, a): Value => {
      void int(a[0] ?? VI(0))
      return VI(0)
    },

    /**
     * =B Width(n) / =I Width(n) — routines 42 and 45 ($bac, $c0c). The bank
     * stores a width in WORDS and this shifts it left four, so the answer is
     * always a multiple of 16. -1 when the image does not exist.
     */
    'b width': (_, a): Value => size(rt, 1, int(a[0] ?? VI(0)), 'w'),
    'i width': (_, a): Value => size(rt, 2, int(a[0] ?? VI(0)), 'w'),

    /** =B Height(n) / =I Height(n) — routines 43 and 46, the word at +2. */
    'b height': (_, a): Value => size(rt, 1, int(a[0] ?? VI(0)), 'h'),
    'i height': (_, a): Value => size(rt, 2, int(a[0] ?? VI(0)), 'h'),

    /**
     * =B Colours(n) / =I Colours(n) — routines 44 and 47. `moveq #$1,d3 /
     * asl.l d0,d3` over the plane count at +4, so it is 2^planes and not the
     * plane count itself.
     */
    'b colours': (_, a): Value => size(rt, 1, int(a[0] ?? VI(0)), 'c'),
    'i colours': (_, a): Value => size(rt, 2, int(a[0] ?? VI(0)), 'c'),

    /** =H Spot X(n) / =H Spot Y(n) — routines 48 and 49, the words at +6/+8. */
    'h spot x': (_, a): Value => size(rt, 1, int(a[0] ?? VI(0)), 'x'),
    'h spot y': (_, a): Value => size(rt, 1, int(a[0] ?? VI(0)), 'y'),

    /**
     * =Busy Printer — routine 54 ($d20). CIA-B PRA ($bfd000), the parallel
     * port's handshake lines: `andi.b #$5 / eori.b #$4`, so it answers -1
     * unless BUSY is low and SEL is high together.
     *
     * NOTE: nothing is attached and the lines idle high, so $bfd000 reads
     * $ff, `$ff & 5` is 5, the eor makes 1, and this answers -1 — busy. That
     * is what a disconnected parallel port really looks like, and it is the
     * same register Ercole's `Ext Fire` reads.
     */
    'busy printer': (): Value => VI(-1),

    /**
     * =No Paper — routine 55 ($d3e), bit 1 of the same register, -1 when it is
     * SET. Idle-high makes that -1 too.
     */
    'no paper': (): Value => VI(-1),

    /**
     * =Bank Name$(n) — routine 60 ($ef4). `subq.l #$8,a2` again, then eight
     * bytes verbatim into a string. Always eight characters, spaces included:
     * nothing trims.
     */
    'bank name$': (_, a): Value => {
      const mem = rt.memBanks.get(int(a[0] ?? VI(0)))
      if (!mem) throw new AmosError('bank not reserved')
      return VS(mem.name.padEnd(8, ' ').slice(0, 8))
    },

    /** =Last Float Bob — routine 30 ($862), the counter at $10. */
    'last float bob': (): Value => VI(st().floatCount),

    /**
     * =In Screen(ox, oy, x, y) — routine 61 ($f1c).
     *
     * It SAVES all four arguments first — $38/$3c take x and y, $40/$44 the
     * origin — which is not bookkeeping: `In Screen Bob` reads them back to
     * work out the offset it draws at. Then the same shape as `Js Screen`,
     * but against the four `Game Area` values rather than constants.
     */
    'in screen': (_, a): Value => {
      const s = st()
      const ox = int(a[0] ?? VI(0))
      const oy = int(a[1] ?? VI(0))
      s.inX = int(a[2] ?? VI(0))
      s.inY = int(a[3] ?? VI(0))
      s.inOx = ox
      s.inOy = oy
      // `sub.l $28(a0),d1` then `add.l $28 / add.l $2c` --- the low edge is
      // the origin less the MARGIN and the high edge the origin plus the
      // WIDTH, so the two are not symmetric about it
      const okX = s.inX >= ox - s.areaX && s.inX < ox + s.areaW
      const okY = s.inY >= oy - s.areaY && s.inY < oy + s.areaH
      return VI(okX && okY ? -1 : 0)
    },
  }
}

/** one byte of an AMOS string, or 0 past its end --- the 68k reads memory */
const byteAt = (s: string, i: number): number => (i < s.length ? s.charCodeAt(i) & 0xff : 0)

/** the four shapes routine 53's callers read out of an image header */
function size(rt: Runtime, which: 1 | 2, n: number, what: 'w' | 'h' | 'c' | 'x' | 'y'): Value {
  const img = image(rt, which, n)
  if (!img) return VI(-1)
  if (what === 'w') return VI(img.rowBytes * 8)
  if (what === 'h') return VI(img.height)
  if (what === 'c') return VI(1 << img.depth)
  return VI(what === 'x' ? img.hotX : img.hotY)
}
