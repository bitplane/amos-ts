/**
 * JD Colour 1.4 / 2.0 — the colour companion of the JD set, by Joerg
 * Dommermuth. 44 keywords in 1.4, 56 in 2.0.
 *
 * A separate library at its own slot: the disc's Extension_numbers recommends
 * 20, 21 and 22 for Colour, Prt and JD, and the source agrees — `ExtNb equ
 * 20-1` at the top of |col.s. So it is its own registry identity and its own
 * EXT_IMPLS entry, sharing nothing with jd.ts but the author.
 *
 * ## Evidence
 *
 * `APD599/SOURCES/|col.s`, 34 KB unpacked, PowerPacked like its sibling. The
 * manual is JD's own (`JD_Manual.eng`), which documents all three libraries
 * together — which is why a reader of that manual cannot tell which keyword
 * belongs to which library, and the sources can.
 *
 * ## The colour model
 *
 * Everything works on a 12-bit $RGB word, one nibble each, and two helpers
 * carry the whole library (+|col.s:214, :221):
 *
 *   zerlege    splits a value into d1 = red, d2 = green, d3 = blue
 *   make_wert  reassembles d1*256 + d2*16 + d3
 *
 * The conversions are arithmetic on those three nibbles and nothing else, so
 * they are exactly testable — which is most of this slice.
 *
 * ## What is not here, and why
 *
 * 2.0 adds a second library's worth of unrelated keywords — a CON: window
 * (open/close/print/input con), a file requester, path and drive helpers, byte
 * and word swaps. Those that are pure computation are implemented below; those
 * that need a console window or a requester of their own are n/a in
 * coverage/status.ts, each with its reason, rather than being half-built.
 */
import { VI, VS, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { outdim } from './jd'

/** zerlege (+|col.s:221): a 12-bit colour into red, green, blue nibbles */
const split = (v: number): [number, number, number] => [(v >> 8) & 15, (v >> 4) & 15, v & 15]
/** make_wert (+|col.s:214): d1*256 + d2*16 + d3, with each nibble clamped */
const join = (r: number, g: number, b: number): number =>
  ((Math.min(15, Math.max(0, r)) << 8) | (Math.min(15, Math.max(0, g)) << 4) | Math.min(15, Math.max(0, b))) & 0xfff

/** `ppal` (+|col.s:185) — the 32 words Jd Pseudo Palette copies in, verbatim */
// prettier-ignore
const PPAL = Uint16Array.from([
  0x000, 0x00f, 0x04f, 0x06f, 0x0bf, 0x0cf, 0x0cf, 0x0ef,
  0x0ef, 0x0fe, 0x0f8, 0x0f7, 0x0f7, 0x0f2, 0x1f0, 0x4f0,
  0x4f0, 0x5f0, 0x8f0, 0x9f0, 0xaf0, 0xcf0, 0xef0, 0xfd0,
  0xfd0, 0xfc0, 0xfa0, 0xf90, 0xf90, 0xf80, 0xf60, 0xf00,
])

/**
 * The shared body of routines 52 and 53. `d0 = ScOnAd+$60 - 1`, and above 31
 * it becomes 15 rather than clamping — the routine's own `cmp.l #31,d0 / ble
 * / move.l #15,d0`. Equal totals answer with the highest index; see the
 * keyword.
 */
function extremeColour(rt: Runtime, lightest: boolean): number {
  const p = rt.screen.palette
  let colnb = (1 << rt.screen.depth) - 1
  if (colnb > 31) colnb = 15
  let best = 0
  let bestSum = lightest ? -1 : 0xfff
  for (let i = 0; i <= colnb; i++) {
    const [r, g, b] = split(p[i]! & 0xfff)
    const sum = r + g + b
    // >= / <= so the LAST index wins a tie, which is what the reversed
    // table plus a forward search comes out as
    if (lightest ? sum >= bestSum : sum <= bestSum) {
      bestSum = sum
      best = i
    }
  }
  return best
}

export function makeJdColourFunctions(rt: Runtime): Record<string, Func> {
  const arg = (a: Value[], i: number): number => int(a[i]!)

  return {
    /**
     * =Jd Grey Colour(c) — routine 8 (+|col.s:382). The average of the three
     * nibbles in all three: `add d3,d2 / add d1,d2 / divu #3,d2`, then that
     * value copied into red and blue.
     */
    'jd grey colour'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      const avg = Math.floor((r + g + b) / 3)
      return VI(join(avg, avg, avg))
    },

    /**
     * =Jd Antique Colour(c) — routine 9 (+|col.s:399). The sum of the nibbles
     * divided by three, four and five — red keeps the most and blue the least,
     * which is what makes it brown.
     */
    'jd antique colour'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      const s = r + g + b
      return VI(join(Math.floor(s / 3), Math.floor(s / 4), Math.floor(s / 5)))
    },

    /**
     * =Jd False Colour(c) — routine 10 (+|col.s:421). Two exchanges,
     * `exg d1,d3 / exg d2,d3`, which rotate the three components rather than
     * inverting anything: red takes blue's value, green takes red's, blue
     * takes green's.
     */
    'jd false colour'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      return VI(join(b, r, g))
    },

    /**
     * =Jd Mix Colours(c1,c2) — routine 11 (+|col.s:431). The two colours added
     * component by component, each clamped at 15.
     */
    'jd mix colours'(_, a): Value {
      const [r1, g1, b1] = split(arg(a, 0))
      const [r2, g2, b2] = split(arg(a, 1))
      return VI(join(r1 + r2, g1 + g2, b1 + b2))
    },

    /**
     * =Jd Negative Colour(c) and =Jd Complement Colour(c) — routines 12 and 13.
     * Each nibble subtracted from 15.
     */
    'jd negative colour'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      return VI(join(15 - r, 15 - g, 15 - b))
    },
    'jd complement colour'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      return VI(join(15 - r, 15 - g, 15 - b))
    },

    /** the three components, and the inverse (+|col.s:631 for Rgb Value) */
    'jd red value'(_, a): Value {
      return VI(split(arg(a, 0))[0])
    },
    'jd green value'(_, a): Value {
      return VI(split(arg(a, 0))[1])
    },
    'jd blue value'(_, a): Value {
      return VI(split(arg(a, 0))[2])
    },
    'jd rgb value'(_, a): Value {
      return VI(join(arg(a, 0), arg(a, 1), arg(a, 2)))
    },

    /**
     * THE SEPARATIONS — routines 17 to 23 (+|col.s:512-630). CMYK separation
     * of one colour, which is a printing operation and explains why this
     * library shipped beside a printer one.
     *
     * Cyan is the model (:617): the other two components are averaged into
     * green with a +1 rounding, and the remaining channel is forced to $F. The
     * black separation instead thresholds the total into bands.
     */
    'jd separate cyan'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      return VI(join(r, Math.floor((g + r + b + 1) / 3), 15))
    },
    'jd separate magenta'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      return VI(join(15, Math.floor((g + r + b + 1) / 3), b))
    },
    'jd separate yellow'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      return VI(join(r, 15, Math.floor((g + r + b + 1) / 3)))
    },
    'jd separate red'(_, a): Value {
      const [r] = split(arg(a, 0))
      return VI(join(r, 0, 0))
    },
    'jd separate green'(_, a): Value {
      const [, g] = split(arg(a, 0))
      return VI(join(0, g, 0))
    },
    'jd separate blue'(_, a): Value {
      const [, , b] = split(arg(a, 0))
      return VI(join(0, 0, b))
    },
    /**
     * Black is the odd one: the three nibbles are summed and the total falls
     * into bands (`cmp.w #19 / #16 / #13 / #10 ...`, :519), each band a grey.
     */
    'jd separate black'(_, a): Value {
      const [r, g, b] = split(arg(a, 0))
      const s = r + g + b
      const level = s >= 19 ? 15 : s >= 16 ? 12 : s >= 13 ? 9 : s >= 10 ? 6 : s >= 7 ? 3 : 0
      return VI(join(level, level, level))
    },

    /**
     * =Jd Lightest Colour and =Jd Darkest Colour — routines 52 and 53
     * (+|col.s:1752, :1792). The palette entry whose three nibbles add up to
     * the most, and to the least.
     *
     * Three details out of the routine that a plain "max of the palette" gets
     * wrong. The range is the SCREEN'S colour count from ScOnAd+$60 minus
     * one, not the whole palette — and if that comes out above 31 the routine
     * uses 15 instead. The sums are built into a private table walked
     * DOWNWARDS (`dbra d0` from colnb while storing forwards), and the search
     * for the extreme then walks that table forwards and answers with the
     * dbra counter, which turns back into the colour index. What survives the
     * reversal is the TIE-BREAK: equal totals answer with the HIGHEST index.
     */
    'jd lightest colour'(): Value {
      return VI(extremeColour(rt, true))
    },
    'jd darkest colour'(): Value {
      return VI(extremeColour(rt, false))
    },

    /**
     * =Jd Fit(n,divisor) — routine 55 (+|col.s:1862). `divs / muls / cmp`:
     * whether dividing and multiplying back gives the number again.
     *
     * It answers 1 and 0, NOT AMOS's -1 and 0 — `move.l #1,d3` is the true
     * case. A program writing `If Jd Fit(n,3)` cannot tell, one comparing
     * against True can.
     */
    'jd fit'(_, a): Value {
      const d = arg(a, 1)
      // `divs d1,d2` with a zero divisor is a trap on the machine
      if (d === 0) return VI(0)
      const n = arg(a, 0)
      return VI(Math.trunc(n / d) * d === n ? 1 : 0)
    },

    /**
     * The three swaps 2.0 added — routines 63, 64 and 65 ($2720, $2730, $2740
     * in AMOSPro_JDColour.Lib 2.0, which has no source and is disassembled).
     *
     * Each is one size SMALLER than the name suggests, and getting that wrong
     * silently gives plausible answers. Bswap works inside a BYTE, swapping
     * its two nibbles (`lsr.b #4 / lsl.b #4 / or.b`) and touching nothing
     * above bit 7. Wswap swaps the two bytes of the low WORD. Lswap is a bare
     * `swap d3` — the two halves of the longword.
     */
    'jd bswap'(_, a): Value {
      const v = arg(a, 0) & 0xff
      return VI(((v & 0x0f) << 4) | (v >> 4))
    },
    'jd wswap'(_, a): Value {
      const v = arg(a, 0) & 0xffff
      return VI(((v & 0xff) << 8) | (v >> 8))
    },
    'jd lswap'(_, a): Value {
      const v = arg(a, 0)
      return VI((((v & 0xffff) << 16) | ((v >>> 16) & 0xffff)) | 0)
    },

    /**
     * =Jd Key To Asc(code) — routine 78 at $2a32. A table lookup, not
     * arithmetic: it walks a 44-byte key table at $1bc of the structure
     * a5+$228 points at, comparing each byte against the argument, and answers
     * with the byte at the matching position of a second table 44 bytes
     * further on at $1e8. A zero byte in the first table ends the walk and the
     * answer is 0.
     *
     * The manual's example is `Jd Key To Asc(253) -> 49`, the character '1',
     * and 253 is not an Amiga rawkey — so the tables are AMOS's own, not the
     * keyboard's. This port does not carry that pair, and inventing a mapping
     * that happened to satisfy one documented example would be worse than
     * answering what the routine answers for a code it cannot find.
     *
     * DEVIATION: this returns 0, always, and it is the one keyword in the
     * Colour library whose behaviour is not reproduced. See NOTES.
     */
    'jd key to asc'(_, a): Value {
      void arg(a, 0)
      return VI(0)
    },

    /**
     * =Jd Cut Off$(s) — routine 56 (+|col.s:1876). Not a truncation, despite
     * the name: it SPREADS the string out, putting a space after every
     * character. `lop: move.b (a0)+,d0 / move.b d0,(a1)+ / move.b #' ',(a1)+`,
     * then `move.b #0,-(a1)` backs over the trailing space — so the result is
     * 2n-1 characters, "Test" coming back as "T e s t".
     *
     * Both bounds are error 23: an empty string (`beq error`) and one of 128
     * characters or more (`cmp.l #128,d0 / bge error`), the second because the
     * result would not fit the buffer it allocates.
     */
    'jd cut off$'(_, a): Value {
      const v = String(a[0]!.k === 'str' ? a[0]!.s : '')
      if (v.length === 0 || v.length >= 128) outdim()
      return VS(v.split('').join(' '))
    },
  }
}

export function makeJdColourInstructions(rt: Runtime): Record<string, Instr> {
  const pal = (): Uint16Array => rt.screen.palette

  return {
    /**
     * Jd Swap Colours a,b and Jd Copy Colour a To b — the palette entries
     * exchanged and copied. These change the PALETTE, where Jd Change Colours
     * and Jd Fill Colour change PIXELS and leave the palette alone — the
     * manual flags the latter two with "(palette will not be changed!)", which
     * is the pairing to get right before writing either.
     */
    'jd swap colours'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const p = pal()
      if (a < 0 || b < 0 || a >= p.length || b >= p.length) return
      const t = p[a]!
      p[a] = p[b]!
      p[b] = t
    },
    'jd copy colour'(it) {
      const a = it.evalInt()
      it.expect('to')
      const b = it.evalInt()
      const p = pal()
      if (a < 0 || b < 0 || a >= p.length || b >= p.length) return
      p[b] = p[a]!
    },

    /**
     * Jd Tone Colour n,amount — routine 28 (+|col.s:694). Brightens or darkens
     * one palette entry by adding the amount to each nibble, clamped.
     */
    'jd tone colour'(it) {
      const n = it.evalInt()
      it.expect(',')
      const by = it.evalInt()
      const p = pal()
      if (n < 0 || n >= p.length) return
      const [r, g, b] = split(p[n]! & 0xfff)
      p[n] = join(r + by, g + by, b + by)
    },

    /**
     * Jd Spread Palette a To b — routine 7 (+|col.s:261), the library's first
     * and longest. The entries BETWEEN two palette positions get a linear ramp
     * between their colours; the two ends are left alone.
     *
     * The guards are the routine's, and they are stricter than they look:
     * both arguments must be 1 to 31 inclusive, so COLOUR 0 IS REJECTED
     * (`cmp.l #0,d2 / ble _err`) — error 23, not a clamp. A reversed pair is
     * swapped and retried (`doswap: exg d1,d2 / bra again`) rather than
     * refused, and a gap smaller than two returns having done nothing, with
     * no error at all.
     *
     * The ramp itself runs through the FFP library — one step per component
     * computed as `(c2-c1)/diff` and ACCUMULATED, with SPFix at each entry.
     * SPFix truncates toward zero, so the ramp is written with truncation
     * rather than rounding, and it is accumulated here for the same reason:
     * the drift is part of what the ramp looks like.
     */
    'jd spread palette'(it) {
      let from = it.evalInt()
      it.expect('to')
      let to = it.evalInt()
      if (from > 31 || from <= 0 || to > 31 || to <= 0) outdim()
      if (to < from) [from, to] = [to, from]
      const diff = to - from
      if (diff < 2) return
      const p = pal()
      if (to >= p.length) return
      const [r1, g1, b1] = split(p[from]! & 0xfff)
      const [r2, g2, b2] = split(p[to]! & 0xfff)
      const step = [(r2 - r1) / diff, (g2 - g1) / diff, (b2 - b1) / diff]
      let acc = [r1, g1, b1]
      for (let i = from + 1; i < to; i++) {
        acc = [acc[0]! + step[0]!, acc[1]! + step[1]!, acc[2]! + step[2]!]
        p[i] = join(Math.trunc(acc[0]!), Math.trunc(acc[1]!), Math.trunc(acc[2]!))
      }
    },

    /**
     * Jd Pseudo Palette — routine 25 (+|col.s:641). Not a generated ramp: it
     * copies the fixed 32-entry table `ppal` (+|col.s:185) into colours 0 to
     * 31, unconditionally and whatever the screen's depth. The table is the
     * false-colour spread a pseudo-colour image wants — blue through green
     * and yellow to red — which is what makes it worth a keyword.
     */
    'jd pseudo palette'(it) {
      void it
      const p = pal()
      for (let i = 0; i < PPAL.length && i < p.length; i++) p[i] = PPAL[i]!
    },
  }
}
