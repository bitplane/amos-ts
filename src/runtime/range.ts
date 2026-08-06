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
 *     $04/$08  Float Offset's x, y   $0c  Float Planes (2.9Plus)
 *     $10  the float-bob counter     $14  the counter Reset saved
 *     $18  the float-bob base        $1c/$20  List Bobs' step x, y
 *     $24  the bob bank's base       $28/$2c  Game Area x margin / width
 *     $30/$34  y margin / height     $38..$44  In Screen's saved coordinates
 *     $48  the audio clock
 *     $a0  the Case result           $a4  the Case subject
 *     $a8  the Case$ subject
 *
 * The Case three are the correction slice 1 needed. Every one of the four
 * routines reaches them through `lea $80(a0),a0` first, so what the listing
 * shows is `$20`, `$24` and `$28` — and reading those as absolute offsets put
 * them on top of Float Offset and Float Planes. `=Case` (routine 19) settles
 * it on its own: `lea $a0(a0),a0 / move.l (a0),d3`, the same field written
 * with the whole offset in one instruction.
 *
 * List Palette's escape template is at $76 in 2.9Plus and at $4c in 2.6 —
 * the only place the two blocks differ in layout, because 2.9Plus's new
 * keywords took the room between.
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
 * ## Where this port has got to
 *
 * Everything 2.6 has: values, strings, the select-case, the paddles, the
 * object metrics, the printer lines, the bank name, the float bobs, the three
 * colour remappers, `List Bobs`, `List Palette` and the screen-to-bank pair.
 * `Float Offset` came with them because `Float Bob` reads what it writes.
 *
 * Left: 2.9Plus's other 24 — the bank-string family, the colour search, the
 * library calls, `Spoint`/`Splot`, the push/pull stack, `Analyse`, the three
 * `Ch Key` readers, `Wipe` and `Set Bzone`.
 *
 * ## The keyword 2.9Plus cannot reach
 *
 * Routine 77 is ten instructions — `movea.l $178(a5),a0 / move.l (a3)+,$c(a0)`
 * — and its token entry names it `float planes`, the plane mask `Float Bob`
 * passes to AMOS. No program can call it: `splot`'s entry two before it is
 * missing its `-1` spec terminator, so the table walk swallows routine 77's
 * header and its name whole and re-syncs on a fragment called `t planes`
 * whose routine number is the ASCII `fl`. That is not this port's reading of
 * the table — `Ver_Ech` (+Verif.s:5259) walks it the same way, so AMOS on the
 * machine loses the keyword too. See src/ext/manifests/range-2.0.json.
 */
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import type { Runtime } from './runtime'
import { PAULA_CLOCK_NTSC, PAULA_CLOCK_PAL, periodToHz } from '../amiga/paula'
import type { BankImage } from './objects'

export interface RangeState {
  /** $a4 and $a8 — what `Case` and `Case$` last stored */
  caseNum: number
  caseStr: string | null
  /** $a0 — the value an `Of` matched, and what `=Case` returns */
  result: number
  /** $48 — PAL or NTSC, chosen once at startup */
  clock: number
  /** $10, $14, $18 — the float-bob counter, its saved copy, and the base */
  floatCount: number
  floatSaved: number
  floatBase: number
  /** $04, $08 — Float Offset's x and y, added to every Float Bob */
  floatOffX: number
  floatOffY: number
  /** $1c, $20 — the gap List Bobs leaves between images, in each axis */
  listStepX: number
  listStepY: number
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
 * Routine 0 ($42c in 2.6, $64e in 2.9Plus). The clock is the only thing it
 * computes; the rest of the block is `lea $68c(pc),a3` — a run of INITIALISED
 * DATA in the code hunk, not a zeroed workspace, and reading it is the only
 * way to know what these keywords do before anything sets them:
 *
 *     +$0c  -1     Float Planes, all planes    (2.9Plus; 2.6 has 0 there)
 *     +$1c  32     List Bobs' step, x          +$20  32   its step, y
 *     +$28  -16    Game Area's x margin        +$2c  320  its width
 *     +$30  -16    its y margin                +$34  200  its height
 *     +$48  $361f0f                            the PAL clock, overwritten
 *
 * Both builds carry the same figures. Slice 1 had every one of these at zero,
 * which made `In Screen` answer false for a program that had never called
 * `Game Area` — where the real default is a 320x200 box with a sixteen-pixel
 * margin on two sides, i.e. a whole screen.
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
  floatOffX: 0,
  floatOffY: 0,
  listStepX: 32,
  listStepY: 32,
  areaX: -16,
  areaW: 320,
  areaY: -16,
  areaH: 200,
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
function image(rt: Runtime, which: 1 | 2, n: number): BankImage | null {
  const bank = which === 1 ? rt.spriteBank : rt.iconBank
  if (!bank || n <= 0 || n > bank.images.length) return null
  return bank.images[n - 1] ?? null
}

/**
 * The colour remappers' shared walk — routines 35, 38 and 41 ($c50, $d18,
 * $dd2), which are the same 110-odd bytes three times with a different test
 * in the middle.
 *
 *     move.w (a0),d2 / add.w d2,d2      the width, WORDS -> bytes a row
 *     move.w $2(a0),d3 / move.w d3,d7
 *     mulu.w d2,d7                      d7 = one whole bitplane
 *     move.l d7,d2 / subq.w #$2,d2      the LAST word of a plane
 *   .word:
 *     moveq #$f,d5                      bit 15 first
 *   .bit:
 *     moveq #$0,d6                      the pixel, being assembled
 *     move.w $4(a0),d4 / subq.w #$1,d4  the depth, high plane first
 *   .plane:
 *     move.w d4,d1 / mulu.w d7,d1 / add.l d2,d1
 *     move.w $a(a0,d1.l),d0             the data begins at +$a
 *     btst.l d5,d0 / bne (bset.b d4,d6)
 *     dbra d4,.plane
 *     <the test>                        beq -> replace, else fall through
 *     dbra d5,.bit
 *     subq.l #$2,d2 / bge .word
 *
 * So it visits every pixel of the image backwards, assembling its colour
 * across the planes a bit at a time, and rewrites the same bits when the test
 * fires. The three tests are all this port has to vary, so they arrive as a
 * callback: `(v) => the new colour, or null to leave the pixel alone`.
 *
 * The header is the AMOS object record — width in WORDS at +0, height at +2,
 * depth at +4, the hot spot at +6/+8, and the planes, plane-major, from +$a.
 * `mulu.w d7,d1` is what says plane-major: plane N starts one whole plane in.
 */
function remap(img: BankImage, pick: (v: number) => number | null): void {
  const p = img.planeBytes()
  const planeSize = img.rowBytes * img.height
  for (let off = planeSize - 2; off >= 0; off -= 2) {
    for (let bit = 15; bit >= 0; bit--) {
      let v = 0
      for (let pl = img.depth - 1; pl >= 0; pl--) {
        const at = pl * planeSize + off + (bit >= 8 ? 0 : 1)
        if ((p[at] ?? 0) & (1 << (bit & 7))) v |= 1 << pl
      }
      const to = pick(v)
      if (to === null) continue
      for (let pl = img.depth - 1; pl >= 0; pl--) {
        const at = pl * planeSize + off + (bit >= 8 ? 0 : 1)
        const m = 1 << (bit & 7)
        p[at] = to & (1 << pl) ? (p[at] ?? 0) | m : (p[at] ?? 0) & ~m
      }
    }
  }
  // the same array, but the chunky cache above it is now stale
  img.planes = p
}

/**
 * The six colour keywords' front half — routines 33/34, 36/37 and 39/40, which
 * are the same twelve instructions six times:
 *
 *     moveq #$1,d2 / Rbsr routine 7     the bob bank; $2 for the icon bank
 *     move.w (a2),d7                    the image count
 *     movea.l a2,a0
 *     movea.l (a3)+,a2                  (the three-argument forms only)
 *     movea.l (a3)+,a1
 *     move.l (a3)+,d0
 *     subq.l #$1,d0 / andi.l #$ffff,d0
 *     cmp.w d7,d0 / bge .out            out of range: do nothing at all
 *     asl.l #$3,d0 / movea.l $2(a0,d0.w),a0
 *
 * NOTE the range test is on `n - 1` MASKED TO A WORD, so `n = 0` becomes
 * $ffff and falls out the top rather than the bottom. Same silence either
 * way: no error, no change, which is why these six cannot fail.
 */
function recolour(rt: Runtime, which: 1 | 2, n: number, pick: (v: number) => number | null): void {
  const img = image(rt, which, n)
  if (img) remap(img, pick)
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

    /**
     * Float Bob n, x, y, img — routine 27 ($afe). AMOS's own `Bob`, with a
     * number that climbs on its own:
     *
     *     move.l $c(a0),d6 / move.l (a0),d5     Float Planes, and +0
     *     move.l (a3)+,d4                       the image
     *     move.l (a3)+,d3 / add.l $8(a0),d3     y, plus Float Offset's y
     *     move.l (a3)+,d2 / add.l $4(a0),d2     x, plus its x
     *     move.l (a3)+,d1
     *     move.l d1,$18(a0)                     the BASE, kept for the clear
     *     move.l $10(a0),d7 / add.l d7,d1       + however many are already out
     *     addq.l #$1,d7 / move.l d7,$10(a0)
     *     moveq #$0,d7
     *     movea.l -$4(a5),a0 / jsr $c4(a0)
     *
     * So a program calls it once per thing it wants to draw and never picks
     * numbers: the first call this frame is bob n, the next n+1, and so on.
     * `Float Bob Reset` then closes the frame and `Float Bob Clear` takes
     * down whatever the last frame drew and this one did not.
     *
     * NOTE: d5 and d6 are loaded and passed to AMOS's routine, which is where
     * `Float Planes` (2.9Plus, +$c, default -1) would have taken effect. Bobs
     * here have no plane mask to put it in, so both are read and dropped —
     * and Float Planes is unreachable anyway, see the header.
     */
    'float bob'(it) {
      const s = st()
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const img = it.evalInt()
      s.floatBase = n
      const num = n + s.floatCount
      s.floatCount++
      rt.bobs.set(num, { n: num, x: x + s.floatOffX, y: y + s.floatOffY, image: img, screen: rt.currentIndex })
    },

    /**
     * Float Bob Clear — routine 28 ($b34), and it takes no arguments:
     *
     *     move.l $10(a0),d2 / move.l $14(a0),d6
     *     cmp.l d2,d6 / ble .out            nothing left over
     *     move.l $18(a0),d5
     *     add.l d5,d2 / add.l d5,d6
     *   .loop:
     *     move.l d2,d1
     *     movea.l -$4(a5),a0 / jsr $c8(a0)  Bob Off, one number
     *     addq.l #$1,d2 / cmp.l d6,d2 / blt .loop
     *
     * base+count up to base+saved, exclusive — the tail of the previous
     * frame that this one did not reuse. `ble` means an equal count clears
     * nothing, so a frame that draws as many as the last leaves them all.
     */
    'float bob clear'() {
      const s = st()
      if (s.floatSaved <= s.floatCount) return
      rt.clearBobs()
      for (let n = s.floatBase + s.floatCount; n < s.floatBase + s.floatSaved; n++) rt.bobs.delete(n)
    },

    /**
     * Float Offset x, y — routine 73 ($137e), 2.9Plus only. Two stores:
     * `move.l (a3)+,$8(a0)` then `move.l (a3)+,$4(a0)`, and the pops are in
     * reverse source order, so $4 is x and $8 is y. Only `Float Bob` reads
     * them, and it adds them to every position.
     */
    'float offset'(it) {
      const s = st()
      s.floatOffX = it.evalInt()
      it.expect(',')
      s.floatOffY = it.evalInt()
    },

    /**
     * List Palette — routine 32 ($bd6), sixty-four times round:
     *
     *     moveq #$0,d0
     *   .loop:
     *     movea.l $178(a5),a0
     *     move.b d0,d1 / addi.b #$30,d1
     *     move.b d1,$78(a0)             into a template held in the block
     *     move.l d0,-(a7)
     *     lea.l $76(a0),a1
     *     movea.l -$c(a5),a0 / jsr $4(a0)
     *     move.l (a7)+,d0 / addq.l #$1,d0
     *     moveq #$40,d6 / cmp.l d6,d0 / bne .loop
     *
     * The template at +$76 is `1b 42 30 20 20 20 20 20 00` — `ESC "B0"` and
     * five spaces, NUL-terminated (2.6 keeps the same nine bytes at +$4c).
     * `ESC "B"` is Paper: `CEsc` in +W.s indexes the escape table by
     * `letter - "A"` and its second entry is `Paper`, and the handler is
     * entered with `sub.w #"0",d1`, so the digit the extension writes is the
     * colour number rather than a character. `Compte` (+W.s:15630) counts
     * `ESC` plus two bytes as nothing printed, which is what makes this a
     * console string and not a length-word AMOS one.
     *
     * So: sixty-four five-character swatches, in sixty-four papers, one after
     * another with no line breaks — 320 characters, eight rows of a 40-column
     * window.
     *
     * NOTE `move.b d0,d1 / addi.b #$30,d1` runs past the digits — colour 10
     * is written as `:` and 63 as `o` — but the handler subtracts `"0"` back
     * off, so every one of the sixty-four is exact. The `.b` never overflows:
     * `"0" + 63` is 111.
     *
     * NOTE: this errors partway on any screen with fewer than 64 colours,
     * because the Paper escape is range-checked (+W.s:14893) and nothing here
     * asks how many the screen has. On the usual 16-colour screen it prints
     * sixteen swatches and then raises error 60. That is the keyword as
     * shipped, not a limitation of this port.
     */
    'list palette'(it) {
      for (let n = 0; n < 64; n++) {
        rt.screen.setPaperChecked(n)
        it.write('     ')
      }
    },

    /**
     * List Bobs / List Bobs from To to / List Bobs from To to, sx, sy —
     * routines 50, 51 and 52 ($ee8, $f00, $f0e), three doors into the worker
     * at 57 ($faa). 50 takes the whole bank (`move.w (a2),d0` for the count,
     * `d4 = 1`); 51 takes a range; 52 also stores the two steps at $1c/$20,
     * where they stay for later calls.
     *
     * The worker pastes each image at the walking position:
     *
     *     cmp.w (a2),d1 / bhi .out         past the count: stop dead
     *     lsl.w #$3,d1 / lea -$6(a2,d1.w),a2
     *     movea.l -$4(a5),a0 / jsr $11c(a0)
     *     addq.l #$1,d4 / cmp.l d5,d4 / bgt .out
     *     addq.l #$1,d6 / add.l $1c(a0),d6
     *     cmp.l #$140,d6 / blt .loop       320
     *     addq.l #$1,d7 / moveq #$0,d6 / add.l $20(a0),d7
     *     cmp.l #$c8,d7 / blt .loop        200
     *
     * so the step is `1 + $1c`, not `$1c` — 33 pixels by default, not 32 —
     * and both limits are the 320x200 of a default screen rather than this
     * screen's size. It runs off the right at 320 and stops entirely at 200,
     * so a bank of large images lists fewer than it has and says nothing.
     *
     * `jsr $11c(a0)` is the paste TOME's `Map Do` uses (see tome.ts), and it
     * draws at the raw x,y with no hot-spot subtraction, which is `Paste Bob`.
     */
    'list bobs'(it) {
      const s = st()
      const bank = rt.spriteBank
      let from = 1
      let to = bank ? bank.images.length : 0
      if (!it.atStmtEnd()) {
        from = it.evalInt()
        it.expect('to')
        to = it.evalInt()
        if (it.accept(',')) {
          s.listStepX = it.evalInt()
          it.expect(',')
          s.listStepY = it.evalInt()
        }
      }
      if (from === 0) return // `tst.l d4 / beq` before the loop is even entered
      let x = 0
      let y = 0
      for (let n = from; ; n++) {
        const img = image(rt, 1, n)
        if (!img) return // cmp.w (a2),d1 / bhi -- the count, inclusive
        rt.blit(rt.screen, img, x, y, img.opaque)
        if (n + 1 > to) return
        x += 1 + s.listStepX
        if (x >= 320) {
          y += 1 + s.listStepY
          x = 0
          if (y >= 200) return
        }
      }
    },

    /**
     * Exchange Bob Colours n, a, b / Exchange Icon Colours — routines 33 and
     * 34 ($c00, $c28) over the walk at 35 ($c50). The test is
     *
     *     cmpa.w d6,a1 / beq .swap
     *     cmpa.w d6,a2 / beq .swap
     *   .swap:
     *     move.w a1,d0 / add.w a2,d0 / sub.w d6,d0
     *
     * `a + b - v` is the swap written without a branch: a pixel of a becomes
     * b and one of b becomes a. Colour 0 is not special here — only `Make Bob
     * Colour` skips it.
     *
     * NOTE `cmpa.w` sign-extends the pixel to a long and compares the WHOLE
     * argument register, so `Exchange Bob Colours 1, 65536, 2` matches
     * nothing; a port that masked the argument to a word would have matched
     * colour 0 instead.
     */
    'exchange bob colours'(it) {
      exchange(rt, 1, it)
    },
    'exchange icon colours'(it) {
      exchange(rt, 2, it)
    },

    /**
     * Change Bob Colours n, from, to / Change Icon Colours — routines 36 and
     * 37 ($cc8, $cf0) over the walk at 38 ($d18). One test,
     * `cmpa.w d6,a1 / beq`, then `move.w a2,d6`: every pixel of the first
     * colour becomes the second and nothing else moves.
     */
    'change bob colours'(it) {
      change(rt, 1, it)
    },
    'change icon colours'(it) {
      change(rt, 2, it)
    },

    /**
     * Make Bob Colour n, colour / Make Icon Colour — routines 39 and 40
     * ($d86, $dac) over the walk at 41 ($dd2). Two arguments rather than
     * three, and the test is `tst.w d6 / bne` — every NON-ZERO pixel becomes
     * the colour given, which turns the image into a solid silhouette in one
     * colour and leaves the transparent parts transparent.
     */
    'make bob colour'(it) {
      makeColour(rt, 1, it)
    },
    'make icon colour'(it) {
      makeColour(rt, 2, it)
    },

    /**
     * Bank Screen top, bottom To n — routine 58 ($101e). The bank number is
     * the LAST argument, and it is the first thing popped:
     *
     *     move.l (a3)+,d2 / Rbsr routine 7      the bank
     *     move.l (a3)+,d2 / move.l (a3)+,d1     bottom, then top
     *     move.l d2,d3 / sub.l d1,d3
     *     blt .swap                             given the wrong way round
     *     move.l d1,d4 / moveq #$28,d0 / mulu.w d0,d4     top * 40
     *     move.l d3,d5 / moveq #$a,d0 / mulu.w d0,d5 / subq.l #$1,d5
     *     move.w d5,(a2)                        longs - 1, at bank+0
     *     movea.l $52c(a5),a0 / moveq #$14,d7   five planes down to zero
     *     addq.l #$4,a2 / move.l a2,d3
     *   .plane:
     *     movea.l (a0,d7.w),a1 / beq .next      a plane that is not there
     *     cmpa.l d3,a2 / beq .first             the very first one found
     *     adda.l d4,a1 / move.l d5,d6
     *     move.l (a1)+,(a2)+ / dbra d6
     *   .next:
     *     subq.l #$4,d7 / bge .plane
     *   .first:
     *     move.w d7,-$2(a2)                     which plane it started at
     *
     * Forty bytes a row is hard-coded, so this is a 320-wide screen's worth
     * however wide the screen actually is, and the rows are taken as one flat
     * run rather than row by row. The two words at the front of the bank are
     * what `Unbank Screen` needs and are why the two are a pair.
     *
     * NOTE: `top = bottom` gives `d5 = -1`, and `dbra` on -1 counts 65,536 —
     * a quarter of a megabyte written over whatever follows the bank. This
     * port stops at the end of the bank instead; there is no adjacent memory
     * here to corrupt, so there is nothing to reproduce.
     */
    'bank screen'(it) {
      const top = it.evalInt()
      it.expect(',')
      const bottom = it.evalInt()
      it.expect('to')
      const mem = rt.memBanks.get(it.evalInt())
      if (!mem) throw new AmosError('bank not reserved')
      const [y1, y2] = bottom < top ? [bottom, top] : [top, bottom]
      const rows = y2 - y1
      const bytes = rows * SCREEN_ROW_BYTES
      const planes = rt.screen.rp.bitMap.planeBytes()
      const planeSize = rt.screen.planeSize
      putW(mem.data, 0, rows * 10 - 1)
      let at = 4
      let first = true
      for (let p = 5; p >= 0; p--) {
        if (p >= rt.screen.depth) continue // a plane pointer that is zero
        if (first) {
          putW(mem.data, 2, p * 4)
          first = false
        }
        const src = p * planeSize + y1 * SCREEN_ROW_BYTES
        for (let i = 0; i < bytes && at < mem.data.length; i++, at++) mem.data[at] = planes[src + i] ?? 0
      }
    },

    /**
     * Unbank Screen n To top — routine 59 ($107a), the other half:
     *
     *     move.l (a3)+,d1 / move.l (a3)+,d2 / Rbsr routine 7
     *     move.l d1,d4 / moveq #$28,d0 / mulu.w d0,d4
     *     moveq #$0,d5 / move.w (a2),d5           the length back
     *     movea.l $52c(a5),a0
     *     moveq #$0,d7 / move.w $2(a2),d7         the plane it started at
     *     addq.l #$4,a2
     *   .plane:
     *     movea.l (a0,d7.w),a1 / adda.l d4,a1
     *     move.l d5,d6 / move.l (a2)+,(a1)+ / dbra d6
     *     subq.l #$4,d7 / bge .plane
     *
     * The row it lands on is the argument, not the row it came from, so the
     * pair is a way of moving a strip up or down the screen as well as of
     * keeping it.
     *
     * NOTE the null-plane test is on the way IN and not on the way out: this
     * one writes through `(a0,d7.w)` whatever it holds. A bank saved from a
     * deep screen and restored onto a shallow one writes to address zero on
     * the Amiga. Here the plane simply is not there and the write is dropped.
     */
    'unbank screen'(it) {
      const mem = rt.memBanks.get(it.evalInt())
      if (!mem) throw new AmosError('bank not reserved')
      it.expect('to')
      const top = it.evalInt()
      const bytes = (getW(mem.data, 0) + 1) * 4
      const planes = rt.screen.rp.bitMap.planeBytes()
      const planeSize = rt.screen.planeSize
      let at = 4
      for (let p = getW(mem.data, 2) >> 2; p >= 0; p--) {
        const dst = p * planeSize + top * SCREEN_ROW_BYTES
        for (let i = 0; i < bytes; i++, at++) {
          if (p < rt.screen.depth && dst + i < planeSize * (p + 1)) planes[dst + i] = mem.data[at] ?? 0
        }
      }
      rt.screen.rp.bitMap.invalidate()
    },
  }
}

/** `moveq #$28,d0 / mulu.w d0,d4` — forty, whatever the screen is */
const SCREEN_ROW_BYTES = 40

const putW = (b: Uint8Array, at: number, v: number): void => {
  b[at] = (v >> 8) & 0xff
  b[at + 1] = v & 0xff
}
const getW = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)

/** the three-argument colour keywords parse identically; only the test differs */
function twoColours(it: Interp): [number, number, number] {
  const n = it.evalInt()
  it.expect(',')
  const a = it.evalInt()
  it.expect(',')
  const b = it.evalInt()
  return [n, a, b]
}

function exchange(rt: Runtime, which: 1 | 2, it: Interp): void {
  const [n, a, b] = twoColours(it)
  recolour(rt, which, n, (v) => (v === a || v === b ? (a + b - v) & 0xffff : null))
}

function change(rt: Runtime, which: 1 | 2, it: Interp): void {
  const [n, from, to] = twoColours(it)
  recolour(rt, which, n, (v) => (v === from ? to & 0xffff : null))
}

function makeColour(rt: Runtime, which: 1 | 2, it: Interp): void {
  const n = it.evalInt()
  it.expect(',')
  const c = it.evalInt()
  recolour(rt, which, n, (v) => (v !== 0 ? c & 0xffff : null))
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

    /**
     * =In Screen Bob(n, img, ox, oy, x, y) — routine 63 ($1138), which is
     * routine 61 with a draw bolted on the end. The first forty-eight bytes
     * are `In Screen` instruction for instruction, over arguments 3 to 6;
     * then, if the point is inside,
     *
     *     move.l (a3)+,d0                     the image
     *     move.l $38(a0),d1 / sub.l $40(a0),d1 / move.l d1,-(a3)    x - ox
     *     move.l $3c(a0),d1 / sub.l $44(a0),d1 / move.l d1,-(a3)    y - oy
     *     move.l d0,-(a3)
     *     Rbsr routine 27                     Float Bob
     *     moveq #$1,d3
     *
     * It pushes three of Float Bob's four arguments back and lets the bob
     * number it never popped stand as the fourth, so `Float Bob`'s counter
     * advances exactly as if the program had called it. That is the whole
     * point of the keyword: one call per object, drawn only if it is on
     * screen, and the numbering closes up around the ones that are not.
     *
     * The coordinates it draws at are RELATIVE — the point less the origin —
     * so the origin is where the view is scrolled to.
     *
     * NOTE it answers **1**, where `In Screen` answers -1: `moveq #$1,d3`
     * against `moveq #$ff,d0 / move.l d0,d3`. Both are true to `If`, and
     * `Print In Screen Bob(...)` shows the difference.
     *
     * The miss path is `addq.l #$8,a3` — the two arguments it never popped,
     * discarded so the stack balances — and then 0.
     */
    'in screen bob': (_, a): Value => {
      const s = st()
      const n = int(a[0] ?? VI(0))
      const img = int(a[1] ?? VI(0))
      const ox = int(a[2] ?? VI(0))
      const oy = int(a[3] ?? VI(0))
      s.inX = int(a[4] ?? VI(0))
      s.inY = int(a[5] ?? VI(0))
      s.inOx = ox
      s.inOy = oy
      const okX = s.inX >= ox - s.areaX && s.inX < ox + s.areaW
      const okY = s.inY >= oy - s.areaY && s.inY < oy + s.areaH
      if (!okX || !okY) return VI(0)
      s.floatBase = n
      const num = n + s.floatCount
      s.floatCount++
      rt.bobs.set(num, {
        n: num,
        x: s.inX - ox + s.floatOffX,
        y: s.inY - oy + s.floatOffY,
        image: img,
        screen: rt.currentIndex,
      })
      return VI(1)
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
