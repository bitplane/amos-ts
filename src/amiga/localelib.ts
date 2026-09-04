/**
 * A modelled `locale.library` — the AmigaOS 2.1+ localisation system, as much
 * of it as the machine here needs.
 *
 * This is a back-end rather than part of any one extension's port. The Locale
 * extension at slot 17 is the first caller and is a thin shim over exactly
 * these entry points, but dates, collation and case folding are not its
 * private business: LDos, JD and anything later that wants them should reach
 * the same implementation rather than growing a second one.
 *
 * ## Evidence
 *
 * The DATA — string ids, the English strings, the ISO-8859-1 case tables, the
 * two collation orders and the default locale's date templates — is extracted
 * from the AROS sources by src/cli/genlocale.ts into ./locale.gen.ts. That
 * generator's header explains why a clean-room reimplementation is strong
 * evidence for this particular material: it is ABI, so AROS has to match it
 * exactly. The BEHAVIOUR below is written against the documented API and
 * against AROS's own implementation of it, and the places where those two
 * disagree are called out at the point they arise.
 *
 * One independent check on the whole arrangement: the Locale structure field
 * order AROS declares is the one read straight out of `AMOSPro_locale.lib`,
 * whose `Date$` fetches +$4c — loc_DateFormat, the second of the six format
 * strings. The extension and AROS agree without either being told about the
 * other.
 *
 * ## What is deliberately fixed
 *
 * The locale is the built-in English one and does not follow the host. A real
 * Amiga answers from whatever the user set in Locale prefs, and `Intl` could
 * imitate that, but host.ts exists to keep a census run reproducible and a
 * date that moved with the machine running the suite would break exactly what
 * that boundary protects. A `.language` file could be modelled later; the
 * table-driven shape below is what would make that possible.
 */
import { yearDay, type Civil } from './datestamp'
import type { Language } from './language'
import { LANGUAGE_STRINGS, LONG_ORDER, SHORT_ORDER, STR_ID, TO_LOWER, TO_UPPER } from './localelib.gen'

export { DEFAULT_FORMATS, MAXSTRMSG, STR_ID } from './localelib.gen'
export { civilFromStamp, type Civil } from './datestamp'

/** StrnCmp types — SC_ASCII, SC_COLLATE1, SC_COLLATE2 (libraries/locale.h) */
export const SC_ASCII = 0
export const SC_COLLATE1 = 1
export const SC_COLLATE2 = 2

/**
 * `GetLocaleStr`. Ids run 1..MAXSTRMSG-1; english.language stops one short of
 * that, at FUTURESTR, because the id above it is LANG_NAME which locale.h
 * marks V50 — an AROS-era addition the v38 library has no string for.
 * Out of range answers with the empty string, as GetLangString's own
 * `if (id < MAXSTRMSG) ... else return NULL` does.
 */
export function getLocaleStr(id: number, lang?: Language | null): string {
  // the chosen language first, english underneath it. A `.language` library
  // that has no word for an id returns NULL and locale.library falls back, so
  // english is the floor rather than the alternative -- and in practice this
  // only shows at id 51, LANG_NAME, which no v38 language file carries at all.
  const own = lang?.strings[id]
  return own !== undefined && own !== '' ? own : (LANGUAGE_STRINGS[id] ?? '')
}

/** `ConvToUpper` / `ConvToLower`, one character through the code table */
export const convToUpper = (c: number): number => TO_UPPER[c & 0xff] ?? c
export const convToLower = (c: number): number => TO_LOWER[c & 0xff] ?? c

const mapString = (s: string, table: readonly number[]): string => {
  let out = ''
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(table[s.charCodeAt(i) & 0xff] ?? s.charCodeAt(i))
  return out
}
export const localeUpper = (s: string): string => mapString(s, TO_UPPER)
export const localeLower = (s: string): string => mapString(s, TO_LOWER)

/**
 * `StrnCmp`, which locale.library forwards straight to the language's
 * `strcompare` (function 16). The collation table is chosen by type:
 *
 *   SC_ASCII    __code_table_to_upper      — so level 0 is CASE-INSENSITIVE,
 *                                            not the byte compare the Locale
 *                                            extension's doc calls "ordinary"
 *   SC_COLLATE1 __language_short_order_tab — accents fold onto their base
 *   SC_COLLATE2 __language_long_order_tab  — accents sort near, not equal
 *
 * The loop is AROS's, and its shape matters: it stops on the first differing
 * pair OR on the NUL of string1, and it returns the raw table difference
 * rather than a clamped sign. An unknown type returns 0.
 */
export function strnCmp(s1: string, s2: string, length: number, type: number): number {
  const tab =
    type === SC_ASCII ? TO_UPPER : type === SC_COLLATE1 ? SHORT_ORDER : type === SC_COLLATE2 ? LONG_ORDER : null
  if (tab === null) return 0
  const at = (s: string, i: number): number => tab[s.charCodeAt(i) & 0xff] ?? 0
  let a = 0
  let i = 0
  let n = length
  // while (length-- && !(a = tab[*s1] - tab[*s2++]) && *s1++)
  while (n-- > 0) {
    const c1 = i < s1.length ? at(s1, i) : (tab[0] ?? 0)
    const c2 = i < s2.length ? at(s2, i) : (tab[0] ?? 0)
    a = c1 - c2
    if (a !== 0) break
    if (i >= s1.length) break // *s1++ was the NUL
    i++
  }
  return a
}

// ---- dates -----------------------------------------------------------------

/**
 * `PrintDigits(number, fill, len)`. A fill of -1 means no padding at all,
 * which is how %q, %Q and %w print; otherwise the number is padded to `len`
 * with the fill character. Digits beyond `len` are DROPPED, because the
 * routine emits at most `len` of them.
 */
function printDigits(n: number, fill: string | null, len: number): string {
  let s = ''
  let v = n
  let i = 0
  while ((v !== 0 || i === 0) && i < len) {
    s = String(v % 10) + s
    v = Math.floor(v / 10)
    i++
  }
  return fill === null ? s : s.padStart(len, fill)
}

/**
 * `FormatDate`.
 *
 * Every directive the Locale extension's doc lists, plus %q and %Q, which it
 * does not — and which matter, because the default locale's own time formats
 * are built from %Q. The compound directives are expanded by recursion, which
 * is what the doc's "same as ..." means and what AROS literally does.
 *
 * Two places where AmigaOS 38.27 does NOT follow AROS, both noted because
 * AROS is a reimplementation and its behaviour is not evidence of AmigaOS's:
 *
 *  - %j. AROS computes `mday + dayspermonth[month]` with no leap-year
 *    adjustment, while its own %U/%W apply one; the two disagree with each
 *    other from 1 March of any leap year, and the source carries a "TODO:
 *    Julian date not tested" beside it. The documented meaning is the day of
 *    the year, so this is leap-correct.
 *  - %I/%Q. AROS prints `hour % 12`, which makes both noon and midnight zero.
 *    The 38.27 machine code explicitly replaces a zero remainder with 12
 *    before applying the padded (%I) or unpadded (%Q) representation.
 *
 * %Z is documented nowhere in the extension and expands to nothing: AROS
 * marks it "Unimplemented in 3.1", so %C loses that field on a real machine
 * too.
 */
export function formatDate(fmt: string, t: Civil, lang?: Language | null): string {
  const rec = (f: string): string => formatDate(f, t, lang)
  let out = ''
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== '%') {
      out += fmt[i]
      continue
    }
    const c = fmt[++i]
    if (c === undefined) break // a trailing '%' emits nothing (case 0)
    switch (c) {
      case 'a': out += getLocaleStr(STR_ID.ABDAY_1 + t.weekday, lang); break
      case 'A': out += getLocaleStr(STR_ID.DAY_1 + t.weekday, lang); break
      case 'b': case 'h': out += getLocaleStr(STR_ID.ABMON_1 + t.month - 1, lang); break
      case 'B': out += getLocaleStr(STR_ID.MON_1 + t.month - 1, lang); break
      case 'c': out += rec('%a %b %d %H:%M:%S %Y'); break
      case 'C': out += rec('%a %b %e %T %Z %Y'); break
      case 'd': out += printDigits(t.day, '0', 2); break
      case 'x': case 'D': out += rec('%m/%d/%y'); break
      case 'e': out += printDigits(t.day, ' ', 2); break
      case 'H': out += printDigits(t.hour, '0', 2); break
      case 'I': out += printDigits(t.hour % 12 || 12, '0', 2); break
      case 'j': out += printDigits(yearDay(t), '0', 3); break
      case 'm': out += printDigits(t.month, '0', 2); break
      case 'M': out += printDigits(t.min, '0', 2); break
      case 'n': out += '\n'; break
      case 'p': out += getLocaleStr(t.hour < 12 ? STR_ID.AM_STR : STR_ID.PM_STR, lang); break
      case 'q': out += printDigits(t.hour, null, 2); break
      case 'Q': out += printDigits(t.hour % 12 || 12, null, 2); break
      case 'r': out += rec('%I:%M:%S %p'); break
      case 'R': out += rec('%H:%M'); break
      case 'S': out += printDigits(t.sec, '0', 2); break
      case 't': out += '\t'; break
      case 'X': case 'T': out += rec('%H:%M:%S'); break
      case 'U': case 'W': out += printDigits(weekNumber(t, c === 'U'), '0', 2); break
      case 'w': out += printDigits(t.weekday, null, 1); break
      case 'y': out += printDigits(t.year % 100, '0', 2); break
      case 'Y': out += printDigits(t.year, '0', 4); break
      case 'Z': break // "Unimplemented in 3.1"
      default: out += c
    }
  }
  return out
}

/**
 * %U and %W. AROS's arithmetic, which is not the obvious one: it walks the
 * day-of-year forward to the END of its week and then counts whole weeks, so
 * the days before the year's first full week are week 0.
 */
function weekNumber(t: Civil, sundayFirst: boolean): number {
  const days = yearDay(t)
  const tmp = sundayFirst
    ? days + (6 - t.weekday)
    : t.weekday !== 0
      ? days + (7 - t.weekday)
      : days
  if (tmp < 7) return 0
  return (tmp - (tmp % 7)) / 7
}

// ---- catalogs --------------------------------------------------------------

export interface Catalog {
  language: string
  strings: Map<number, string>
}

const fourcc = (b: Uint8Array, o: number): string =>
  String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0)
const be32 = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0

/**
 * `OpenCatalog`'s file reader: `FORM....CTLG` with `FVER`, `LANG`, `CSET` and
 * `STRS` chunks. The strings live in STRS as a run of
 * `ULONG id / ULONG length / bytes[length]`, the bytes NUL-terminated and the
 * ENTRY then padded on to the next multiple of four.
 *
 * That padding is the whole subtlety, and it is why this is checked against
 * 8,283 real catalogs (see locale.corpus.test.ts) rather than only against a
 * file the tests build themselves. The length field is the string's OWN
 * length, NUL included, and the padding is separate — `reqtools.catalog`
 * opens with id 1, length 5, `" _Ok\0"`, then three bytes of padding before
 * id 2. Reading the length as though it already included the padding
 * misaligns the walk after the first entry, which a self-built fixture that
 * pads its own lengths will happily fail to notice.
 */
export function parseCatalog(data: Uint8Array): Catalog | null {
  if (data.length < 12 || fourcc(data, 0) !== 'FORM' || fourcc(data, 8) !== 'CTLG') return null
  const cat: Catalog = { language: '', strings: new Map() }
  let p = 12
  const end = Math.min(data.length, 8 + be32(data, 4))
  while (p + 8 <= end) {
    const id = fourcc(data, p)
    const size = be32(data, p + 4)
    const body = p + 8
    if (body + size > data.length) break
    if (id === 'LANG') {
      let s = ''
      for (let i = 0; i < size && data[body + i] !== 0; i++) s += String.fromCharCode(data[body + i]!)
      cat.language = s
    } else if (id === 'STRS') {
      let q = body
      while (q + 8 <= body + size) {
        const strId = be32(data, q) | 0
        const len = be32(data, q + 4)
        q += 8
        if (q + len > body + size) break
        let s = ''
        for (let i = 0; i < len && data[q + i] !== 0; i++) s += String.fromCharCode(data[q + i]!)
        cat.strings.set(strId, s)
        q += (len + 3) & ~3 // the entry pads on to the next longword
      }
    }
    p = body + size + (size & 1) // IFF chunks pad to even
  }
  return cat
}

/** `GetCatalogStr`: the translation, or the caller's default */
export const getCatalogStr = (cat: Catalog | null, id: number, def: string): string =>
  cat?.strings.get(id) ?? def
