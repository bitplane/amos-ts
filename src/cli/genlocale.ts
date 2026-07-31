/**
 * Generate src/amiga/localelib.gen.ts from the AROS locale.library sources.
 *
 * ## Why AROS is the right source for this
 *
 * The Locale extension (slot 17) is a shim: it opens `locale.library` v38 and
 * every keyword is a few instructions around one library call. Porting it
 * therefore needs the library's DATA — the standard string ids, the English
 * strings behind them, the ISO-8859-1 case tables, the two collation orders
 * and the default locale's format strings. None of that is in the extension's
 * 2.4KB, none of it is in its documentation, and Commodore's `locale.h` is not
 * in this archive. The first cut of the port had to guess, and said so in five
 * separate NOTES.
 *
 * AROS is a clean-room reimplementation of AmigaOS, and for this particular
 * material that makes it strong rather than weak evidence: the string ids and
 * the Locale structure layout are ABI, so AROS has to match them exactly or
 * no Amiga binary would work against it. The struct layout is independently
 * confirmed here — the offsets AROS declares for loc_DateFormat and its
 * neighbours are the ones read straight out of the extension's own binary
 * ($4c and friends), which is a check on AROS rather than an assumption about
 * it.
 *
 * ## Licensing
 *
 * AROS is APL/LGPL. This generator EXTRACTS DATA — numeric tables, string ids
 * and format templates — and emits it as a data module; it copies no AROS
 * code, and the behaviour in ../amiga/localelib.ts is written against
 * the documented API rather than transcribed. Character-case tables and
 * collation orders for ISO-8859-1, the English names of the days and months,
 * and a struct's field order are interface facts, not creative expression.
 * The provenance is recorded in the generated header so it travels with the
 * data.
 *
 * Run: npm run cli -- src/cli/genlocale.ts [path-to-AROS]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const aros = process.argv[2] ?? join(homedir(), 'src', 'tmp', 'AROS')
const localeDir = join(aros, 'workbench', 'libs', 'locale')
const includeDir = join(aros, 'compiler', 'include', 'libraries')

const read = (p: string): string => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    console.error(`cannot read ${p}\nis AROS checked out? pass its path as the first argument`)
    process.exit(1)
  }
}

const english = read(join(localeDir, 'english.c'))
const defaultLocale = read(join(localeDir, 'defaultlocale.c'))
const localeH = read(join(includeDir, 'locale.h'))
const localeStdH = read(join(includeDir, 'localestd.h'))

/** strip C comments, which in these tables carry the index of every entry */
const decomment = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * The body of `<type> NAME[...] = { ... };`.
 *
 * The DEFINITION, not the `extern ... NAME[];` forward declaration that
 * precedes each of these tables — matching on the name alone finds the
 * declaration and then walks into whatever braces come next. Braces are
 * counted rather than searched for, because the tables hold `'{'` and `'}'`
 * as entries.
 */
function arrayBody(src: string, name: string): string {
  const def = new RegExp(`\\b${name}\\s*\\[[^\\]]*\\]\\s*=`).exec(src)
  if (!def) throw new Error(`${name}: no definition found`)
  const open = src.indexOf('{', def.index)
  if (open < 0) throw new Error(`${name} is not a braced array`)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]!
    if (c === "'" || c === '"') {
      // skip the literal, honouring escapes
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return src.slice(open + 1, i)
  }
  throw new Error(`${name}: unterminated initialiser`)
}

/** one C character escape */
function unescapeChar(body: string): number {
  if (body.startsWith('\\x')) return parseInt(body.slice(2), 16)
  if (body.startsWith('\\') && /^\\[0-7]+$/.test(body)) return parseInt(body.slice(1), 8)
  if (body.startsWith('\\')) {
    const map: Record<string, number> = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34 }
    return map[body[1]!] ?? body.charCodeAt(1)
  }
  return body.charCodeAt(0)
}

/**
 * A 256-entry ULONG table whose entries are integers or character literals.
 *
 * Scanned rather than split on commas: the tables contain `','` itself, and a
 * character literal's comma is not a separator.
 */
function numberTable(src: string, name: string): number[] {
  const out: number[] = []
  const body = decomment(arrayBody(src, name))
  for (const m of body.matchAll(/'((?:\\.|[^'\\])+)'|(-?\d+)/g)) {
    out.push(m[1] !== undefined ? unescapeChar(m[1]) : Number(m[2]))
  }
  if (out.length !== 256) throw new Error(`${name}: expected 256 entries, got ${out.length}`)
  if (out.some((n) => !Number.isInteger(n) || n < 0 || n > 0xff)) {
    throw new Error(`${name}: an entry is not a byte`)
  }
  return out
}

/** C string literals, in order */
function stringTable(src: string, name: string): string[] {
  const out: string[] = []
  for (const m of decomment(arrayBody(src, name)).matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    out.push(m[1]!.replace(/\\x([0-9a-f]{2})|\\(.)/gi, (_, hex: string | undefined, esc: string) =>
      String.fromCharCode(hex !== undefined ? parseInt(hex, 16) : unescapeChar('\\' + esc)),
    ))
  }
  return out
}

/** `#define NAME value` pairs, for the string ids */
function defines(src: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of src.matchAll(/^\s*#define\s+([A-Z_][A-Z0-9_]*)\s+(\d+)\s*(?:\/\*|$)/gm)) {
    out.set(m[1]!, Number(m[2]))
  }
  return out
}

// ---- extract ---------------------------------------------------------------

const toLower = numberTable(english, '__code_table_to_lower')
const toUpper = numberTable(english, '__code_table_to_upper')
const shortOrder = numberTable(english, '__language_short_order_tab')
const longOrder = numberTable(english, '__language_long_order_tab')
const strings = stringTable(english, '__language_strings')

const ids = new Map([...defines(localeStdH), ...defines(localeH)])
const MAXSTRMSG = ids.get('MAXSTRMSG')
const FUTURESTR = ids.get('FUTURESTR')
if (MAXSTRMSG === undefined || FUTURESTR === undefined) throw new Error('MAXSTRMSG/FUTURESTR not found')
/**
 * english.language stops at FUTURESTR, one short of MAXSTRMSG: the id above it
 * is LANG_NAME, which locale.h marks V50 — an AROS-era addition with no string
 * behind it in the English table, and nothing the v38 library this extension
 * opens would answer either.
 */
if (strings.length !== FUTURESTR + 1) {
  throw new Error(`__language_strings has ${strings.length} entries, FUTURESTR says ${FUTURESTR + 1}`)
}

/**
 * The six format strings out of `const struct Locale defLocale`. They sit in
 * declaration order at loc_DateTimeFormat and the five fields after it, which
 * the struct in locale.h fixes and the extension's own binary corroborates:
 * its Date$ reads +$4c and DateFormat is the second of the six.
 */
const defBody = defaultLocale.slice(defaultLocale.indexOf('defLocale'))
const fmtOrder = [
  'dateTime', 'date', 'time', 'shortDateTime', 'shortDate', 'shortTime',
] as const
const fmts: string[] = []
for (const m of defBody.matchAll(/"((?:\\.|[^"\\])*)"\s*,\s*\/\*\s*([^*]*?)\s*\*\//g)) {
  if (/Date|Time/i.test(m[2]!) && /%/.test(m[1]!)) fmts.push(m[1]!)
  if (fmts.length === 6) break
}
if (fmts.length !== 6) throw new Error(`found ${fmts.length} format strings, expected 6`)

// a few sanity checks that would catch AROS moving underneath us
const assertEq = (got: unknown, want: unknown, what: string): void => {
  if (got !== want) throw new Error(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
}
assertEq(strings[ids.get('DAY_1')!], 'Sunday', 'DAY_1')
assertEq(strings[ids.get('ABMON_12')!], 'Dec', 'ABMON_12')
assertEq(strings[ids.get('AM_STR')!], 'am', 'AM_STR')
assertEq(toUpper[0x61], 0x41, 'to_upper of a')
assertEq(toLower[0xc5], 0xe5, 'to_lower of A-ring')

// ---- emit ------------------------------------------------------------------

const list = (ns: number[]): string => {
  const rows: string[] = []
  for (let i = 0; i < ns.length; i += 16) rows.push('  ' + ns.slice(i, i + 16).join(', ') + ',')
  return rows.join('\n')
}

const out = `/**
 * GENERATED by src/cli/genlocale.ts — do not edit.
 *
 * AmigaOS locale.library data, extracted from the AROS sources
 * (workbench/libs/locale/english.c and defaultlocale.c, plus the string ids in
 * compiler/include/libraries/locale.h and localestd.h).
 *
 * AROS is a clean-room reimplementation of AmigaOS, licensed APL/LGPL. What is
 * reproduced here is data rather than code: the ISO-8859-1 case and collation
 * tables, the English names of the days and months, and the default locale's
 * date templates. The generator's header explains why that is the right
 * evidence for this and what it does not cover.
 *
 * Independently corroborated: the Locale structure field order these format
 * strings sit in is the one read out of AMOSPro_locale.lib itself, whose
 * \`Date$\` fetches +$4c — loc_DateFormat, the second of the six.
 */

/** MAXSTRMSG: GetLocaleStr ids run 1..${MAXSTRMSG - 1} */
export const MAXSTRMSG = ${MAXSTRMSG}

/** locale.library standard string ids (libraries/localestd.h, libraries/locale.h) */
export const STR_ID = {
${[...ids]
  .filter(([k]) => k !== 'MAXSTRMSG')
  .map(([k, v]) => `  ${k}: ${v},`)
  .join('\n')}
} as const

/** english.language's strings, indexed by the ids above; [0] is the blank */
export const LANGUAGE_STRINGS: readonly string[] = [
${strings.map((s) => `  ${JSON.stringify(s)},`).join('\n')}
]

/** defLocale's six date templates, in loc_DateTimeFormat..loc_ShortTimeFormat order */
export const DEFAULT_FORMATS = {
${fmtOrder.map((k, i) => `  ${k}: ${JSON.stringify(fmts[i])},`).join('\n')}
} as const

/** ConvToLower: __code_table_to_lower */
export const TO_LOWER: readonly number[] = [
${list(toLower)}
]

/** ConvToUpper: __code_table_to_upper. StrnCmp uses this for SC_ASCII */
export const TO_UPPER: readonly number[] = [
${list(toUpper)}
]

/** StrnCmp SC_COLLATE1: __language_short_order_tab */
export const SHORT_ORDER: readonly number[] = [
${list(shortOrder)}
]

/** StrnCmp SC_COLLATE2: __language_long_order_tab */
export const LONG_ORDER: readonly number[] = [
${list(longOrder)}
]
`

const dest = join(root, 'src', 'amiga', 'localelib.gen.ts')
writeFileSync(dest, out)
console.log(
  `localelib.gen.ts written: ${strings.length} strings (MAXSTRMSG ${MAXSTRMSG}), ` +
    `4 x 256-entry tables, ${fmts.length} format strings`,
)
