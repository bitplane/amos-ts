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

/** zerlege (+|col.s:221): a 12-bit colour into red, green, blue nibbles */
const split = (v: number): [number, number, number] => [(v >> 8) & 15, (v >> 4) & 15, v & 15]
/** make_wert (+|col.s:214): d1*256 + d2*16 + d3, with each nibble clamped */
const join = (r: number, g: number, b: number): number =>
  ((Math.min(15, Math.max(0, r)) << 8) | (Math.min(15, Math.max(0, g)) << 4) | Math.min(15, Math.max(0, b))) & 0xfff

export function makeJdColourFunctions(rt: Runtime): Record<string, Func> {
  const arg = (a: Value[], i: number): number => int(a[i]!)

  /** the palette of the current screen, which the palette keywords work on */
  const pal = (): Uint16Array => rt.screen.palette

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
     * =Jd Lightest Colour and =Jd Darkest Colour. The palette entry with the
     * greatest and least component total.
     */
    'jd lightest colour'(): Value {
      const p = pal()
      let best = 0
      let bestSum = -1
      for (let i = 0; i < p.length; i++) {
        const [r, g, b] = split(p[i]! & 0xfff)
        if (r + g + b > bestSum) {
          bestSum = r + g + b
          best = i
        }
      }
      return VI(best)
    },
    'jd darkest colour'(): Value {
      const p = pal()
      let best = 0
      let bestSum = 46
      for (let i = 0; i < p.length; i++) {
        const [r, g, b] = split(p[i]! & 0xfff)
        if (r + g + b < bestSum) {
          bestSum = r + g + b
          best = i
        }
      }
      return VI(best)
    },

    /** =Jd Fit(n,divisor) — whether the division comes out whole */
    'jd fit'(_, a): Value {
      const d = arg(a, 1)
      return VI(d !== 0 && arg(a, 0) % d === 0 ? -1 : 0)
    },

    /** the 2.0 byte, word and longword swaps */
    'jd bswap'(_, a): Value {
      const v = arg(a, 0)
      return VI(((v & 0xff) << 8) | ((v >> 8) & 0xff))
    },
    'jd wswap'(_, a): Value {
      const v = arg(a, 0)
      return VI((((v & 0xffff) << 16) | ((v >>> 16) & 0xffff)) | 0)
    },
    'jd lswap'(_, a): Value {
      const v = arg(a, 0)
      return VI(
        (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | ((v >>> 24) & 0xff)) | 0,
      )
    },

    /** =Jd Key To Asc(scancode) — the raw code as a character code */
    'jd key to asc'(_, a): Value {
      return VI(arg(a, 0) & 0x7f)
    },

    /** =Jd Cut Off$(s,n) — the string truncated to n characters */
    'jd cut off$'(_, a): Value {
      const v = String(a[0]!.k === 'str' ? a[0]!.s : '')
      const n = arg(a, 1)
      return VS(n >= 0 ? v.slice(0, n) : v)
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
     * Jd Spread Palette a To b — the entries between two palette positions
     * filled with a linear ramp between their colours.
     */
    'jd spread palette'(it) {
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      const p = pal()
      if (from < 0 || to < 0 || from >= p.length || to >= p.length || to === from) return
      const [r1, g1, b1] = split(p[from]! & 0xfff)
      const [r2, g2, b2] = split(p[to]! & 0xfff)
      const steps = Math.abs(to - from)
      const dir = to > from ? 1 : -1
      for (let i = 1; i < steps; i++) {
        const t = i / steps
        p[from + i * dir] = join(
          Math.round(r1 + (r2 - r1) * t),
          Math.round(g1 + (g2 - g1) * t),
          Math.round(b1 + (b2 - b1) * t),
        )
      }
    },

    /**
     * Jd Pseudo Palette — routine 25 (+|col.s:641). Fills the palette with a
     * generated spread rather than a loaded one.
     */
    'jd pseudo palette'(it) {
      void it
      const p = pal()
      for (let i = 0; i < p.length; i++) {
        const t = p.length <= 1 ? 0 : i / (p.length - 1)
        p[i] = join(Math.round(t * 15), Math.round(t * 15), Math.round(t * 15))
      }
    },
  }
}
