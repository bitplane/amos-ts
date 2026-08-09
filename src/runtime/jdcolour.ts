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
 * `APD599/SOURCES/|col.s`, 34 KB unpacked, PowerPacked like its sibling,
 * which covers 1.4. The keywords 2.0 ADDED have no source and are read off
 * `AMOSPro_JDColour.Lib` with `AMOSPro_JDColour.Lib.MAN` beside it, which
 * gives every one of them a signature and a one-line Funktion. The
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
import { Screen } from './screen'
import { finishRequester, startRequester } from './requester'
import type { RequesterSpec } from './requester'

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
 * The screen `Jd Guru` opens for itself: 640x32 hires, one plane, and screen
 * number 11 -- outside AMOS's user range of 0 to 7, so it cannot collide with
 * a program's own. `gpal` is two words, black and $D00.
 */
const GURU_SCREEN = 11
const GURU_WIDTH = 640
const GURU_HEIGHT = 32
const GURU_PALETTE = [0x000, 0xd00]

/**
 * `Jd Open Con` builds its filename as "CON:" + the caller's window string.
 * The "CON:" is a literal four bytes in the extension's data zone at +$214 and
 * the string is copied to +$218, which is why the routine hands `Open` a
 * pointer four bytes BEFORE the copy -- the two are one filename.
 */
const CON_PREFIX = 'CON:'

/** where the synthetic console handles start; a DOS BPTR is only ever tested against zero */
const CON_HANDLE_ORIGIN = 0x7f30_0000

export interface JdColourState {
  /** a modelled requester currently up for `Jd Request` */
  requestChan: number | null
  /** the guru alert currently up, and the screen to go back to */
  guru: { prev: number; flash: number } | null
  /** open CON: windows by handle, and the filename each was opened with */
  consoles: Map<number, string>
  nextConsole: number
}

export const newJdColourState = (): JdColourState => ({
  requestChan: null,
  guru: null,
  consoles: new Map(),
  nextConsole: CON_HANDLE_ORIGIN,
})

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


/**
 * The four resolution words `Jd Screen Convert` recognises, and the pixel
 * scale each implies. $8000 is hires, $0004 laced, and the pair combine.
 */
const JD_RES = { LOW: 0x0000, LOWLACE: 0x0004, HIRES: 0x8000, HIRESLACE: 0x8004 } as const


/**
 * The blit both `Jd Screen Convert` and the six slides end up performing:
 * every pixel of `src` into `dst`, scaled by whole pixels in each axis. The
 * machine reaches it as a run of `L_sccopy` calls -- AMOS's own Screen Copy,
 * minterm $CC -- one column or row at a time.
 */
export function jdBlit(rt: Runtime, src: number, dst: number, sx = 1, sy = 1): void {
  const a = rt.screens.get(src)
  const b = rt.screens.get(dst)
  if (!a || !b) return
  for (let y = 0; y < a.height; y++) {
    const ty = Math.floor(y * sy)
    if (ty >= b.height) break
    for (let x = 0; x < a.width; x++) {
      const tx = Math.floor(x * sx)
      if (tx >= b.width) break
      const c = a.point(x, y)
      for (let j = 0; j < Math.max(1, Math.ceil(sy)); j++) {
        for (let i = 0; i < Math.max(1, Math.ceil(sx)); i++) {
          if (tx + i < b.width && ty + j < b.height) b.plot(tx + i, ty + j, c)
        }
      }
    }
  }
}

/**
 * `Jd Change Colours` and `Jd Fill Colour` walk a rectangle pixel by pixel
 * with ReadPixel and WritePixel, and they share a DEFECT worth reproducing:
 * when a row ends, `Dmove mousek,d0` reloads the X register from the saved
 * `y1` rather than from `x1` -- `Dsave d1,mousek` put y1 there. Only the FIRST
 * row starts at x1; every row after it starts at column y1. The two are the
 * same routine with a different test, so both carry it, and a region anchored
 * at the origin (x1 = y1 = 0) hides it completely.
 */
function jdPixelSweep(
  rt: Runtime,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fn: (c: number) => number | null,
): void {
  const s = rt.screen
  let x = x1
  for (let y = y1; y <= y2; y++) {
    for (; x <= x2; x++) {
      if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue
      const to = fn(s.point(x, y))
      if (to !== null) s.plot(x, y, to)
    }
    x = y1 // the defect: the row restart takes y1, not x1
  }
}

/** the argument shape all six slides share: SOURCE To DEST */
export function jdSlide(rt: Runtime, it: Parameters<Instr>[0]): void {
  const src = it.evalInt()
  it.expect('to')
  const dst = it.evalInt()
  jdBlit(rt, src, dst)
}

/**
 * The six slides, as a table both libraries can mount.
 *
 * 4.6 carried them in the JD library at routines 98 to 103 and 5.3 dropped
 * them; JD Colour 1.4 has the same six at routines 41 to 46, and the routine
 * bodies are identical instruction for instruction. One implementation serves
 * both, which is why this is a factory rather than six entries in one table.
 */
export function makeJdSlides(rt: Runtime): Record<string, Instr> {
  return {
    'jd slide x': (it) => jdSlide(rt, it),
    'jd slide y': (it) => jdSlide(rt, it),
    'jd slide left': (it) => jdSlide(rt, it),
    'jd slide right': (it) => jdSlide(rt, it),
    'jd slide up': (it) => jdSlide(rt, it),
    'jd slide down': (it) => jdSlide(rt, it),
  }
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

    /**
     * Jd Red Value, Jd Green Value, Jd Blue Value and Jd Rgb Value — the three
     * components and the inverse (+|col.s:631 for Rgb Value).
     */
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
     * THE SEPARATIONS — Jd Separate Cyan, Jd Separate Magenta, Jd Separate
     * Yellow, Jd Separate Black, Jd Separate Red, Jd Separate Green and Jd
     * Separate Blue: routines 17 to 23 (+|col.s:512-630). CMYK separation of
     * one colour, which is a printing operation and explains why this library
     * shipped beside a printer one.
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
     * into bands, each band a grey. `Rbsr zerlege / add d1,d2 / add d3,d2`
     * then `cmp.w #19 / #16 / #13 / #10 ...` at +|col.s:519.
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
     * The three swaps 2.0 added — Jd Bswap, Jd Wswap and Jd Lswap, routines
     * 63, 64 and 65 ($2720, $2730, $2740
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

    /**
     * =Jd Mouse — routine 48 (+|col.s:1652), four instructions:
     *
     *     move.w -$1584(a5),d3 / ext.l d3 / moveq #0,d2 / rts
     *
     * A signed word straight out of the AMOS workspace, and nothing else. It
     * is the Show/Hide NESTING counter, which is what makes the keyword worth
     * having: AMOS's `Hide` can be stacked and only a matching run of `Show`s
     * brings the pointer back, so a program that did not do the stacking
     * itself has no other way to find out how deep it is. Zero is visible, and
     * each unmatched `Hide` takes it one further negative.
     *
     * The counter is `mouseShow` on the Runtime, which the core console
     * keywords keep; this keyword only reads it.
     */
    'jd mouse': (): Value => VI(rt.mouseShow),

    /**
     * =Jd Path$(p) and =Jd File$(p) — routines 61 and 60 (2.0 only, $26e8 and
     * $26ca), both over the scanner at routine 62 ($26fe):
     *
     *     lea (a2,d0.w),a1
     *     lop move.b -(a1),d1 / cmpi.b #$2f,d1 / beq / cmpi.b #$3a,d1 / beq
     *         subq.w #$1,d0 / bne lop
     *
     * A backward scan for the last '/' or ':', leaving d0 = the number of
     * characters up to AND INCLUDING it, or 0 when there is none. `Jd Path$`
     * copies those d0 bytes; `Jd File$` takes `len - d0` from just past the
     * separator.
     *
     * These were n/a as "split an AmigaDOS path the way its own requester
     * returns one". They do not touch the requester: the whole of both is the
     * scan above and a copy.
     */
    'jd path$'(_, a): Value {
      const p = String(a[0]!.k === 'str' ? a[0]!.s : '')
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut < 0 ? '' : p.slice(0, cut + 1))
    },

    /**
     * DEFECT: with no separator at all, `Jd File$` drops the first character
     * and reads one byte past the string.
     *
     * The scanner leaves d0 = 0 when it finds nothing, so `sub.l d0,d2` makes
     * the tail the WHOLE string and `addq.w #$1,a1` — which is there to step
     * over the separator — steps over the first character instead, a1 having
     * been left pointing at character zero rather than at a separator. The
     * `dbra` then copies the full length from one byte further on. So
     * `Jd File$("readme")` is "eadme" plus whatever byte follows the string in
     * the AMOS workspace.
     *
     * Reproduced as far as a string can be: the first character is dropped.
     * The trailing byte is not invented — there is no workspace here to read
     * past, and guessing at one would be worse than the length being short.
     */
    'jd file$'(_, a): Value {
      const p = String(a[0]!.k === 'str' ? a[0]!.s : '')
      if (p === '') return VS('')
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      if (cut >= 0) return VS(p.slice(cut + 1))
      return VS(p.slice(1)) // the defect, one byte short of the machine's
    },

    /**
     * =Jd Drive$(p) — routine 79 (2.0 only, $2a60), with its own copy of the
     * scanner at $2a76 that tests for ':' ALONE. So it answers everything up
     * to and including the last colon — the volume or assign — and the empty
     * string for a relative path. Also n/a until this was read.
     */
    'jd drive$'(_, a): Value {
      const p = String(a[0]!.k === 'str' ? a[0]!.s : '')
      const cut = p.lastIndexOf(':')
      return VS(cut < 0 ? '' : p.slice(0, cut + 1))
    },

    /**
     * =Jd Request(L1$,L2$,L3$,L4$,L5$,JA$,NEIN$) — routine 66 (2.0 only,
     * $2748), which is `moveq #$4,d2 / Rbra routine 71` and nothing else. The
     * manual: "Parameter: Texte (1-5), Ja-Text und Nein-Text", "Funktion :
     * Bool-Requester", "Ergebnis : -1/0 = ja/nein".
     *
     * Routine 71 ($2766) builds a chain of IntuiTexts by hand in a 1K buffer
     * at $4f2(a5) — all in topaz.font 8, left edge 15, and each line ten
     * pixels above the next, `d4 = d2*10+5` counting DOWN as the arguments pop
     * right to left, so they read top to bottom in the order written — and
     * then calls intuition.library's `AutoRequest` at `jsr -$15c(a6)` with the
     * window in a0, the body chain in a1, the two gadget texts in a2/a3 and a
     * width of `60 + widest*8` and height of `47 + top` in d2/d3. The result
     * is `move.l d0,d3 / beq / moveq #$ff,d3`: -1 for the positive gadget and
     * 0 for the negative, which is the manual's -1/0 = ja/nein.
     *
     * The DEFAULTS are worth spelling out, because they are conditional. The
     * scanner at $2846 answers a0 = -1 when it fell back to a default and 0
     * when the argument itself was non-empty. NEIN$ always has one ("Cancel",
     * the length-prefixed string at $283e), but JA$ gets its "Retry" ($2836)
     * ONLY through `move.l a0,d0 / beq $2798` — that is, only when NEIN$ was
     * left empty. So supplying a NEIN$ and leaving JA$ empty gives a gadget
     * with no text at all, while leaving both empty gives Retry/Cancel.
     *
     * An empty body line is dropped rather than drawn blank (the scanner is
     * called with no default for those five), and a call with all five empty
     * takes `tst.w d6 / Rbeq routine 73` — error 1, the same arm the 1K buffer
     * overflow takes.
     *
     * APPROXIMATED: there is no intuition.library here, so an Interface dialog
     * stands in, as it does for BUtility's reqtools requesters. See
     * requester.ts. DEVIATION: the topaz font, the pixel geometry and the
     * Workbench screen it would have opened on are the chrome that is lost;
     * the line order, the defaults, the drop-empties rule and the -1/0 are the
     * contract, and they are kept.
     */
    'jd request'(it, a): Value {
      const s = (i: number): string => (a[i]?.k === 'str' ? a[i]!.s : '')
      const body = [s(0), s(1), s(2), s(3), s(4)].filter((l) => l !== '')
      if (body.length === 0) outdim()
      const nein = s(6)
      // "Retry" is only reached when NEIN$ was empty -- see above
      const ja = s(5) !== '' ? s(5) : nein === '' ? 'Retry' : ''
      const spec: RequesterSpec = {
        kind: 'alert',
        body: body.join('\n'),
        gadgets: [ja, nein === '' ? 'Cancel' : nein],
      }
      if (rt.jdColour.requestChan !== null) {
        const r = finishRequester(rt, rt.jdColour.requestChan, spec)
        if (r === null) {
          it.block({ type: 'dialog', channel: rt.jdColour.requestChan }, true)
          return VI(0)
        }
        rt.jdColour.requestChan = null
        // gadget 1 is the leftmost, which is JA$; anything else is nein
        return VI(r.ret === 1 ? -1 : 0)
      }
      const chan = startRequester(rt, spec)
      if (chan === null) return VI(0)
      rt.jdColour.requestChan = chan
      it.block({ type: 'dialog', channel: chan }, true)
      return VI(0)
    },

    /**
     * =Jd Open Con(WS$) --- routine 74 ($28e8). The window string is copied
     * into the data zone at +$218 and `Open` is handed a pointer to +$214,
     * where the four literal bytes "CON:" already sit -- so the two are one
     * filename and the caller writes only the manual's "x/y/w/h/titel".
     * MODE_OLDFILE ($3ed) is the mode, which is what a console wants. Answers
     * the file handle, or 0 if it could not be opened.
     *
     * APPROXIMATED: there is no Intuition to put a window on, so a CON: window
     * is AMOS's own console -- the same substitution `Fsel$` makes for a file
     * requester. The geometry and the title are parsed and kept with the
     * handle but nothing draws them, and the text shares the program's screen
     * instead of having a window of its own. What a program can act on -- a
     * non-zero handle, text going out, a line coming back -- is unchanged.
     */
    'jd open con'(_, a): Value {
      const st = rt.jdColour
      const spec = a[0]?.k === 'str' ? a[0]!.s : ''
      const h = st.nextConsole++
      st.consoles.set(h, CON_PREFIX + spec)
      return VI(h)
    },

    /**
     * =Jd Input Con(CON-BASE) --- routine 77 ($2972). `FGets` of up to 256
     * bytes, then a scan that stops at the first NUL or linefeed to get the
     * length, so the newline the user typed is not part of the answer. The
     * 258-byte buffer is cleared afterwards.
     *
     * NOTE: a zero handle takes `beq.w $2a0e` straight to the `rts` without
     * setting d3 or d2, so on the machine the answer is an uninitialised
     * register pair -- a value of whatever type the last keyword happened to
     * leave behind. The empty string is the only safe reading of that.
     *
     * NOTE: the copy is one byte long for a one-character line. `cmp.w #$1,d0
     * / beq` jumps into the loop with d0 still 1, so `dbra` runs twice; the
     * length word still says 1, so a program cannot see the extra byte, but it
     * is written.
     */
    'jd input con'(it, a): Value {
      const h = int(a[0]!)
      if (h === 0 || !rt.jdColour.consoles.has(h)) return VS('')
      const line = it.io.input ? it.io.input('') : ''
      if (line === undefined) {
        it.block({ type: 'input', prompt: '' }, true)
        return VS('')
      }
      return VS(line)
    },

    /**
     * =Jd Guru(TEXT1$,TEXT2$) --- routine 38 (+|col.s:1164). An imitation of
     * the Guru Meditation alert, and the manual is plain about what it is for:
     * a two-line message the program cannot be got past without a click.
     *
     * It creates screen 11 -- 640x32, one plane, mode $8000, two colours from
     * `gpal`, which is `dc.w 0,$d00` -- makes it current, saves the screen
     * that was, and centres TEXT1$ on row 1 and TEXT2$ on row 2 through AMOS's
     * own Centre, each skipped when empty (`cmp.w #0,(a1)+ / beq`). Then it
     * alternates a border between the two pens and polls both mouse buttons
     * (`btst #6,$bfe001` and `btst #2,$dff016`), answering 1 for the left and
     * 2 for the right. On the way out screen 11 is deleted and ScOn/ScOnAd are
     * put back.
     *
     * The border is two rectangles: an outer one from (1,1) to (639,31) and
     * two verticals at x=2 and x=638, drawn by graphics.library Move and Draw.
     *
     * DEVIATION: the flash is not paced. On the machine the pen alternates
     * once per 65,536-iteration poll; here it advances once per frame, which
     * is the port-wide timing deviation rather than a JD one. What a program
     * can observe -- the screen, the text, the block, and which button ended
     * it -- is the same.
     */
    'jd guru'(it, a): Value {
      const st = rt.jdColour
      if (st.guru) {
        const k = rt.input.mouseK
        // bit 0 is the left button and bit 1 the right, which is the order
        // `btst #6,$bfe001` then `btst #2,$dff016` tests them in
        if ((k & 3) !== 0) {
          const { prev } = st.guru
          st.guru = null
          rt.closeScreen(GURU_SCREEN)
          if (prev >= 0) rt.setCurrent(prev)
          return VI(k & 1 ? 1 : 2)
        }
        // the border alternates while it waits
        st.guru.flash ^= 1
        guruBorder(rt, st.guru.flash)
        it.block({ type: 'waitInput', mouse: true, key: false }, true)
        return VI(0)
      }
      const text1 = a[0]?.k === 'str' ? a[0]!.s : ''
      const text2 = a[1]?.k === 'str' ? a[1]!.s : ''
      const prev = rt.screens.has(rt.currentIndex) ? rt.currentIndex : -1
      const scr = new Screen(GURU_SCREEN, GURU_WIDTH, GURU_HEIGHT, 2, 0x8000)
      rt.screens.set(GURU_SCREEN, scr)
      rt.order = rt.order.filter((i) => i !== GURU_SCREEN)
      rt.order.push(GURU_SCREEN)
      rt.currentIndex = GURU_SCREEN
      scr.cls(0)
      for (let i = 0; i < GURU_PALETTE.length; i++) scr.palette[i] = GURU_PALETTE[i]!
      // `cuoff` is `dc.b 27,'C0',0` -- the AMOS escape that hides the cursor
      scr.cursorOn = false
      // Locate 1,1 then Centre, Locate 2,2 then Centre; an empty line is not
      // printed at all rather than printed blank
      if (text1 !== '') {
        scr.locate(Math.max(0, (scr.cols - text1.length) >> 1), 1)
        it.write(text1)
      }
      if (text2 !== '') {
        scr.locate(Math.max(0, (scr.cols - text2.length) >> 1), 2)
        it.write(text2)
      }
      st.guru = { prev, flash: 1 }
      guruBorder(rt, 1)
      it.block({ type: 'waitInput', mouse: true, key: false }, true)
      return VI(0)
    },

  }
}

/**
 * The `box` subroutine (+|col.s:1237): an outer rectangle from (1,1) to
 * (639,31) and two verticals at x=2 and x=638 running from y=2 to y=31, all
 * in pen `d0`. Redrawn in the other pen each time round the wait loop, which
 * is what makes it flash.
 */
function guruBorder(rt: Runtime, pen: number): void {
  const s = rt.screens.get(GURU_SCREEN)
  if (!s) return
  const r = GURU_WIDTH - 1
  const b = GURU_HEIGHT - 1
  s.line(1, 1, r, 1, pen)
  s.line(r, 1, r, b, pen)
  s.line(r, b, 1, b, pen)
  s.line(1, b, 1, 1, pen)
  s.line(2, 2, 2, b, pen)
  s.line(r - 1, 2, r - 1, b, pen)
}

export function makeJdColourInstructions(rt: Runtime): Record<string, Instr> {
  const pal = (): Uint16Array => rt.screen.palette

  return {

    /**
     * Jd Setoutput Amiga and Jd Setoutput Amos --- routines 49 and 50
     * (+|col.s:1656, :1664), both guards over the toggle at routine 51:
     *
     *     L49  Dmove sop,d0 / cmp.l #1,d0 / bne setami / rts
     *     L50  Dmove sop,d0 / cmp.l #1,d0 / beq setamo / rts
     *
     * so each is idempotent -- asking for the convention already in force
     * returns without doing anything.
     *
     * Routine 51 SetFunction-patches dos.library's `Write` (offset -48) with a
     * stub of its own: `a0 = buffer + length - 2; cmp.b #13,(a0); bne through;
     * move.b #10,(a0)+; move.b #0,(a0); sub.l #1,d3`. A buffer whose
     * SECOND-TO-LAST byte is a carriage return has it replaced by a linefeed
     * and its length shortened by one, which turns AMOS's CR+LF line ends into
     * AmigaDOS's bare LF. `Jd Setoutput Amos` restores the saved vector.
     *
     * The flag is `Runtime.amigaLineEnds`, because the patch is on dos.library
     * and applies to every write AMOS makes rather than to this extension's.
     *
     * DEVIATION: the patch tests the second-to-last byte of EVERY buffer
     * handed to Write, so on the machine a binary `Put #` whose data happens
     * to end in CR and one more byte is rewritten too -- the patch cannot tell
     * text from anything else. Here the switch is applied where the line
     * terminator is written, so only line ends change. Reproducing the rest
     * would need a per-`Write` boundary that a buffered channel does not have.
     */

    /**
     * The six slides --- routines 41 to 46 (+|col.s:1380-1638). Each copies
     * SOURCE onto DEST a column or a row at a time through `L_sccopy`, AMOS's
     * own Screen Copy: Slide X walks a one-pixel column from the right edge
     * leftwards, laying each one down at its final resting place, and the
     * other five are the same loop over a different axis and direction. When
     * the last pass finishes, DEST holds SOURCE.
     *
     * DEVIATION: the animation is not paced, so what is written is the state
     * the routine ends in -- the choice `Jd Spread`, `Jd Tscroll` and
     * `Jd Squash` already make. The early exit is lost with it: on the machine
     * `L_getk` is polled every pass and key 117 stops the slide part way,
     * leaving a partial image that nothing here can produce.
     */
    ...makeJdSlides(rt),

    'jd setoutput amiga'() {
      rt.amigaLineEnds = true
    },
    'jd setoutput amos'() {
      rt.amigaLineEnds = false
    },

    /**
     * Jd Close Con CON-BASE --- routine 75 ($2926). `Close` on the handle,
     * skipped entirely when it is zero (`cmp.l #$0,d1 / beq`), so closing a
     * window that was never opened is not an error.
     */
    /**
     * Jd Screen Border COL,X1,Y1 To X2,Y2 --- routine 58 (+|col.s:1913). Four
     * filled rectangles, not an outline: everything OUTSIDE (x1,y1)-(x2,y2) is
     * painted in COL. The strips are left, right, top and bottom in that
     * order, each an AMOS Bar through the window vector at `$8c(a0)`, and the
     * screen's own width and height come from `$4c` and `$4e` of the control
     * block. With no current screen it takes `beq clserr` and does nothing.
     */
    'jd screen border'(it) {
      const col = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const s = rt.screens.get(rt.currentIndex)
      if (!s) return
      const w = s.width
      const h = s.height
      s.cls(col, 0, 0, Math.max(0, x1 - 1), h - 1)
      s.cls(col, x2, 0, w - 1, h - 1)
      s.cls(col, x1, 0, x2, Math.max(0, y1 - 1))
      s.cls(col, x1, y2, x2, h - 1)
    },

    /**
     * Jd Wait Raster LINE --- routine 59 (+|col.s:1959). The line is made
     * positive (`bpl rapo / neg.l d0`) and then folded into 0..256 by
     * repeated subtraction, and the routine spins on `$dff006` -- the high
     * byte of VHPOSR, which is the beam's vertical position -- until it
     * matches.
     *
     * DEVIATION: there is no beam here. A given raster line comes round once
     * per frame, so the wait is a frame, which is what AMOS's own `Wait Vbl`
     * does. A program using this to sync to the display gets frame-rate sync
     * rather than sub-frame; the folding arithmetic is reproduced because a
     * program can compute a line number from it.
     */
    'jd wait raster'(it) {
      let line = it.evalInt()
      if (line < 0) line = -line
      while (line >= 257) line -= 256
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },

    /**
     * Jd Change Colours COL1,COL2,X1,Y1 To X2,Y2 --- routine 39 (+|col.s:1283).
     * Every pixel in the rectangle that is COL1 becomes COL2 and every COL2
     * becomes COL1: a swap, not a replace. Carries the row-restart DEFECT
     * described on `jdPixelSweep`.
     */
    'jd change colours'(it) {
      const c1 = it.evalInt()
      it.expect(',')
      const c2 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      jdPixelSweep(rt, x1, y1, x2, y2, (c) => (c === c1 ? c2 : c === c2 ? c1 : null))
    },

    /**
     * Jd Fill Colour COL1 To COL2,X1,Y1 To X2,Y2 --- routine 40 (+|col.s:1335).
     * The same sweep with one test instead of two: every pixel that is COL2
     * becomes COL1. The pen is set once before the loop rather than per pixel,
     * which is the only difference in the code. Same row-restart DEFECT.
     */
    'jd fill colour'(it) {
      const c1 = it.evalInt()
      it.expect('to')
      const c2 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      jdPixelSweep(rt, x1, y1, x2, y2, (c) => (c === c2 ? c1 : null))
    },

    /**
     * Jd Save Palette FILE$ --- routine 36 (+|col.s:1089). The format IS
     * settled by the source: `apal` is `dc.b 'APal'` followed by `pal`, 32
     * words, and the routine writes all 68 bytes in one `Write`. MODE_NEWFILE
     * (1006), and an empty filename takes `Rbeq missing` before anything is
     * opened.
     */
    'jd save palette'(it) {
      const file = it.evalStr()
      if (file === '') return
      const out = new Uint8Array(68)
      out.set([0x41, 0x50, 0x61, 0x6c], 0) // 'APal'
      const v = new DataView(out.buffer)
      const pal = rt.screen.palette
      for (let i = 0; i < 32; i++) v.setUint16(4 + i * 2, (pal[i] ?? 0) & 0xffff)
      rt.vfs?.writeFile(file, out)
    },

    /**
     * Jd Load Palette FILE$ --- routine 37 (+|col.s:1122). Reads 68 bytes,
     * closes, and only then checks `cmp.l #'APal',(a0)+`; a file that does not
     * begin with the magic takes `kmissing` and the screen keeps the palette
     * it had. MODE_OLDFILE (1005).
     */
    'jd load palette'(it) {
      const file = it.evalStr()
      if (file === '') return
      const raw = rt.fs?.read(file)
      if (!raw || raw.length < 68) return
      const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      if (v.getUint32(0) !== 0x4150616c) return // 'APal'
      for (let i = 0; i < 32; i++) rt.screen.palette[i] = v.getUint16(4 + i * 2) & 0xfff
    },

    /**
     * Jd Screen Convert SOURCE,SRES To DEST,DRES --- routine 33 (+|col.s:871).
     * A resolution change done as a scaled copy: `cmp.l d6,d7 / bne do_it`
     * means identical resolutions do nothing at all, and only four of the
     * sixteen pairings have a conversion behind them -- the source's own
     * comments mark them with a `*`. Anything else falls out of the dispatch
     * on an `rts`.
     */
    'jd screen convert'(it) {
      const src = it.evalInt()
      it.expect(',')
      const sres = it.evalInt()
      it.expect('to')
      const dst = it.evalInt()
      it.expect(',')
      const dres = it.evalInt()
      if (sres === dres) return
      const wide = (r: number): boolean => (r & JD_RES.HIRES) !== 0
      const tall = (r: number): boolean => (r & JD_RES.LOWLACE) !== 0
      const sx = wide(sres) === wide(dres) ? 1 : wide(sres) ? 0.5 : 2
      const sy = tall(sres) === tall(dres) ? 1 : tall(sres) ? 0.5 : 2
      jdBlit(rt, src, dst, sx, sy)
    },

    'jd close con'(it) {
      const h = it.evalInt()
      if (h === 0) return
      rt.jdColour.consoles.delete(h)
    },

    /**
     * Jd Print Con CON-BASE,TEXT$ --- routine 76 ($2944). `Write` of the whole
     * string, with two guards ahead of it: a zero handle does nothing
     * (`cmp.l #$0,d1 / beq`) and so does an empty string (`cmp.w #$0,d3 /
     * beq`). No line ending is added; the caller supplies its own.
     */
    'jd print con'(it) {
      const h = it.evalInt()
      it.expect(',')
      const text = it.evalStr()
      if (h === 0 || text === '') return
      if (!rt.jdColour.consoles.has(h)) return
      it.write(text)
    },

    /**
     * Jd Rprint TEXT$ --- routine 54 (+|col.s:1833). Right-justified text, and
     * nothing to do with a printer: `XYCuWi` reads the cursor row, `$4c(a0)`
     * is the screen width in pixels and `divu #8` turns it into columns, then
     * `sub.w d1,d0` with the string length gives the column to Locate to
     * before Print. An empty string takes `beq leer` and prints nothing.
     *
     * NOTE: there is no clamp. `sub.w d1,d0 / ext.l d0` hands Locate a
     * NEGATIVE column when the string is wider than the screen, and a negative
     * column means "leave it where it is" -- so an over-long string prints
     * from wherever the cursor already was rather than from the left margin.
     * AMOS's own Centre clamps at zero; this does not.
     */
    'jd rprint'(it) {
      const text = it.evalStr()
      if (text === '') return // `move.w (a0)+,d1 / beq leer`
      const s = rt.screen
      s.locate(s.cols - text.length, -1)
      it.write(text)
    },

    /**
     * Jd Swap Colours a,b and Jd Copy Colour a To b — the palette entries
     * exchanged and copied. These change the PALETTE, where Jd Change Colours
     * and Jd Fill Colour change PIXELS and leave the palette alone — the
     * manual flags the latter two with "(Palette bleibt!)" -- the palette
     * stays -- which is the pairing to get right before writing either.
     *
     * Routines 26 (`L_cswap`, +|col.s:658) and 27 (`L_copc`, :680), and the
     * copy is the one whose direction is worth pinning because the token spec
     * is `I0t0` -- an argument, `To`, an argument -- and the pops are reversed:
     *
     *     move.l (a3)+, d1        the LAST argument: the destination
     *     move.l (a3)+, d2        the first: the source
     *     move.l d2, d1 / Rbsr get_colour
     *     move.l d1, d2 / Dmove colourno2, d1 / Rbsr set_colour
     *
     * so `Jd Copy Colour a To b` reads a and writes b, which reads the way it
     * is written rather than the way the stack hands it over.
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
