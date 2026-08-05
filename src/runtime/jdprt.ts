/**
 * JD Prt 1.3 / 1.4 — the printer companion of the JD set, by Joerg
 * Dommermuth. 63 keywords in 1.3, 69 in 1.4.
 *
 * The third library of the trio, at slot 21: `ExtNb equ 21-1` at the top of
 * its own source, and the disc's Extension_numbers recommends 20/21/22 for
 * Colour, Prt and JD.
 *
 * ## Evidence
 *
 * `prt.s`, PowerPacked in the 1.3 fixture, 14.5 KB unpacked — the author's
 * own source, "This file is public domain" in its header, dated 20.05.1993.
 * The 1.4 additions have no source and come out of `AMOSPro_Prt.Lib` 1.4
 * instead, disassembled: six routines that each load a data pointer and tail
 * into get_str, with their six strings read out of the data area at $1a6.
 *
 * ## What these keywords ARE
 *
 * String FUNCTIONS, every one of them, and that is the thing to get right
 * before anything else. The token table declares them "2" — a function
 * returning a string, no arguments — and routine 3 (`get_str`, +prt.s:445) is
 * the whole implementation: it asks AMOS for a string of the right length and
 * copies one of the fixed sequences below into it.
 *
 *   Lprint Jd Prt Bold;"heading";Jd Prt Bold Off
 *
 * So NOTHING is sent to the printer by these keywords. The program decides
 * where the sequence goes, and it usually goes through Lprint. There is no
 * state either: two calls return the same string.
 *
 * The sequences are the Amiga printer ANSI set, which is what makes them
 * portable across printers — printer.device's driver translates each one for
 * whatever is attached. The control introducer is the TWO-BYTE `ESC [`
 * throughout rather than the single-byte $9B, and the character sets are the
 * ISO designators `ESC ( x` rather than a numbered mode.
 *
 * ## Where 1.3 and 1.4 disagree
 *
 * Two of the 58 shared sequences changed, and the port answers per bound
 * version rather than picking one:
 *
 *   Jd Prt Center    1.3 `ESC [2 F`, 1.4 `ESC [3 F` — 3 is the ANSI code for
 *                    centring, so 1.4 fixed it
 *   Jd Prt Pline Up  1.3 `ESC L`, 1.4 `ESC I`
 *
 * ## The five that are not strings
 *
 * Jd Prt Shade, Aspect, Image, Threshold and Density are INSTRUCTIONS taking
 * a number, and they send nothing either: each calls intuition's GetPrefs,
 * pokes one field of the Preferences structure and calls SetPrefs
 * (+prt.s:803 and above). They configure the graphics dump a later Printer
 * Dump performs. Their bounds are the routines' own, each one error 23.
 */
import { VS, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { outdim } from './jd'
import { extensionById } from '../ext/registry'

const ESC = '\x1b'
/** the Amiga's CSI as this library writes it: two bytes, ESC then '[' */
const CSI = `${ESC}[`

/**
 * The data area of `prt.s`, in table order (+prt.s:206-438), plus the six
 * 1.4 additions from the 1.4 binary's own data area.
 */
const SEQUENCES: Record<string, string> = {
  'jd prt reset': `${ESC}c`,
  'jd prt init': `${ESC}1`,

  // the style pairs, as SGR
  'jd prt italics': `${CSI}3m`,
  'jd prt italics off': `${CSI}23m`,
  'jd prt under': `${CSI}4m`,
  'jd prt under off': `${CSI}24m`,
  'jd prt bold': `${CSI}1m`,
  'jd prt bold off': `${CSI}22m`,

  // pitch, CSI nw
  'jd prt elite': `${CSI}2w`,
  'jd prt elite off': `${CSI}1w`,
  'jd prt fine': `${CSI}4w`,
  'jd prt fine off': `${CSI}3w`,
  'jd prt enlarged': `${CSI}6w`,
  'jd prt enlarged off': `${CSI}5w`,

  // quality, CSI n"z
  'jd prt shadow': `${CSI}6"z`,
  'jd prt shadow off': `${CSI}5"z`,
  'jd prt double': `${CSI}4"z`,
  'jd prt double off': `${CSI}3"z`,
  'jd prt nlq': `${CSI}2"z`,
  'jd prt nlq off': `${CSI}1"z`,

  // super and subscript, CSI nv — each with its own "off"
  'jd prt super': `${CSI}2v`,
  'jd prt super off': `${CSI}1v`,
  'jd prt sub': `${CSI}4v`,
  'jd prt sub off': `${CSI}3v`,

  // the character sets: ISO designators, ESC ( x. The keyword ORDER is
  // printer.device's own 1-to-11 numbering, Danish split into I and II at
  // the two ends, which is what identifies the set
  'jd prt set us': `${ESC}(B`,
  'jd prt set french': `${ESC}(R`,
  'jd prt set german': `${ESC}(K`,
  'jd prt set uk': `${ESC}(A`,
  'jd prt set danishi': `${ESC}(E`,
  'jd prt set sweden': `${ESC}(H`,
  'jd prt set italian': `${ESC}(Y`,
  'jd prt set spanish': `${ESC}(Z`,
  'jd prt set japanese': `${ESC}(J`,
  'jd prt set norge': `${ESC}(6`,
  'jd prt set danishii': `${ESC}(C`,

  // proportional spacing and justification
  'jd prt prop': `${CSI}2p`,
  'jd prt prop off': `${CSI}1p`,
  'jd prt ljustify': `${CSI}5 F`,
  'jd prt rjustiy': `${CSI}7 F`, // the token table's own spelling
  'jd prt fjustify': `${CSI}6 F`,
  'jd prt center': `${CSI}3 F`, // 1.3 has 2; see the header
  'jd prt justify off': `${CSI}0 F`,

  // line spacing and partial line feeds
  'jd prt lspace eight': `${CSI}0z`,
  'jd prt lspace six': `${CSI}1z`,
  'jd prt pline up': `${ESC}I`, // 1.3 has ESC L; see the header
  'jd prt pline down': `${ESC}K`,

  // margins and tabs: "set at the current position", so no argument
  'jd prt set lmargin': `${ESC}#9`,
  'jd prt set rmargin': `${ESC}#0`,
  'jd prt set tmargin': `${ESC}#8`,
  'jd prt set bmargin': `${ESC}#2`,
  'jd prt clr margins': `${ESC}#3`,
  'jd prt set htab': `${ESC}H`,
  'jd prt set vtab': `${ESC}J`,
  'jd prt clr htab': `${CSI}0g`,
  'jd prt clr htabs': `${CSI}3g`,
  'jd prt clr vtab': `${CSI}1g`,
  'jd prt clr vtabs': `${CSI}4g`,
  'jd prt set def tabs': `${ESC}#5`,

  // 1.4's six, from its binary. Doubleunder emits the same bytes as the
  // doublestrike pair, and Borders Off the same as Clr Margins — the
  // author's own duplication, not a transcription slip
  'jd prt lf': `${ESC}E`,
  'jd prt reverse lf': `${ESC}M`,
  'jd prt doubleunder': `${CSI}4"z`,
  'jd prt doubleunder off': `${CSI}3"z`,
  'jd prt borders off': `${ESC}#3`,
  'jd prt ff': '\f',
}

/** the two entries 1.3 spells differently */
const V13: Record<string, string> = {
  'jd prt center': `${CSI}2 F`,
  'jd prt pline up': `${ESC}L`,
}

/**
 * The Preferences fields the five instructions poke, and the only state this
 * library has. A later Printer Dump is what reads them on the machine.
 */
export interface JdPrtPrefs {
  /** PrintShade at $ac: 0 black and white, 1 grey scale, 2 colour */
  shade: number
  /** bit 4 of $da — "grey scale 2", which Shade 3 sets and 0-2 clear */
  greyScale2: boolean
  /** PrintAspect at $aa: 0 horizontal, 1 vertical */
  aspect: number
  /** PrintImage at $a8: 0 positive, 1 negative */
  image: number
  /** PrintThreshold at $ae, 1 to 15 */
  threshold: number
  /** PrintDensity at $e0, 1 to 7 */
  density: number
}

export const defaultJdPrtPrefs = (): JdPrtPrefs => ({
  shade: 0,
  greyScale2: false,
  aspect: 0,
  image: 0,
  threshold: 7,
  density: 1,
})

/**
 * Whether the program bound a pre-1.4 release, which changes two strings.
 *
 * 1.1 belongs on this side with 1.3, and that is measured rather than assumed:
 * the two binaries carry the same 58 distinct escape sequences, with zero on
 * either side the other lacks, and the only byte string that differs between
 * them at all is the keyword NAME `jd prt sub of` against `prt sub of` in the
 * token table. 1.4 is the release that altered two of the sequences and added
 * two more, 60 to 1.3's 58. Getting this wrong would hand a 1.1 program 1.4's
 * bytes for the two that moved.
 */
function isPre14(rt: Runtime): boolean {
  for (const def of rt.extBindings?.values() ?? []) {
    if (def.id === 'jd-prt-1.3' || def.id === 'jd-prt-1.1') return true
  }
  return false
}

export function makeJdPrtFunctions(rt: Runtime): Record<string, Func> {
  const out: Record<string, Func> = {}
  for (const name of Object.keys(SEQUENCES)) {
    out[name] = (): Value => VS((isPre14(rt) ? V13[name] : undefined) ?? SEQUENCES[name]!)
  }
  return out
}

export function makeJdPrtInstructions(rt: Runtime): Record<string, Instr> {
  const prefs = (): JdPrtPrefs => rt.ioports.printerPrefs

  return {
    /**
     * Jd Prt Shade n — routine 64. 0 to 3, and 3 is the odd one: it sets bit
     * 4 of the byte at $da (grey scale 2) and stores 1 in PrintShade, where
     * 0, 1 and 2 clear that bit and store themselves.
     */
    'jd prt shade'(it) {
      const n = it.evalInt()
      if (n < 0 || n >= 4) outdim()
      const p = prefs()
      p.greyScale2 = n === 3
      p.shade = n === 3 ? 1 : n
    },
    /** Jd Prt Aspect n — routine 65, 0 or 1 */
    'jd prt aspect'(it) {
      const n = it.evalInt()
      if (n < 0 || n >= 2) outdim()
      prefs().aspect = n
    },
    /** Jd Prt Image n — routine 66, 0 or 1 */
    'jd prt image'(it) {
      const n = it.evalInt()
      if (n < 0 || n >= 2) outdim()
      prefs().image = n
    },
    /** Jd Prt Threshold n — routine 67, 1 to 15 */
    'jd prt threshold'(it) {
      const n = it.evalInt()
      if (n < 1 || n >= 16) outdim()
      prefs().threshold = n
    },
    /** Jd Prt Density n — routine 68, 1 to 7, stored as a byte */
    'jd prt density'(it) {
      const n = it.evalInt()
      if (n < 1 || n >= 8) outdim()
      prefs().density = n
    },
  }
}

/** exported for the tests: the five keywords that take a number */
export const PARAMETRIC_NAMES = [
  'jd prt shade',
  'jd prt aspect',
  'jd prt image',
  'jd prt threshold',
  'jd prt density',
]

/**
 * What 1.1 calls the 58 keywords 1.3 renamed.
 *
 * Every keyword gained a `Jd ` prefix between the two releases and nothing
 * else changed: all 58 of 1.1's names are 1.3's minus that prefix, no
 * exceptions either way, and the escape sequences behind them are identical.
 * So this is derived from the registered 1.1 table by the rule rather than
 * transcribed — a hand-written list of 58 pairs would be 58 chances to make a
 * typo that only shows up as a keyword silently doing nothing.
 *
 * Read off the registry, so if the 1.1 table ever changes this follows it, and
 * jdprt.test.ts pins the rule against the table so the derivation cannot
 * quietly stop matching.
 */
export function jdPrt11Aliases(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of extensionById('jd-prt-1.1')?.tokens ?? []) {
    const name = t.name.replace(/^!/, '').trim().toLowerCase()
    if (name === '') continue
    out[name] = `jd ${name}`
  }
  return out
}
