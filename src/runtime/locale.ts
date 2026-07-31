/**
 * Locale Extension 0.26 — Johan Ostling, (C) 1994, slot 17. Twenty keywords
 * giving AMOS programs the AmigaOS 2.1+ localisation system: message
 * catalogs, locale-aware dates, and locale-aware collation and case.
 *
 * ## Evidence
 *
 * `AMOSPro_locale.lib` (2,436 bytes) and `locale_ext.doc` (8,814 bytes), both
 * in fixtures/extensions/locale-0.26. The doc lists every keyword and the
 * whole `Format Date$` directive set; the binary settles the rest and is
 * cited by address below. The slot is fixed by both: the doc says "on entry
 * #17", and every routine reaches its workspace through `$1f8(a5)`, which is
 * the per-slot extension data pointer for slot 17 — LDos at 10 uses `$188`,
 * TFT at 25 uses `$278`, and $188 + (17-10)*16 = $1f8.
 *
 * ## What the extension actually is
 *
 * A thin shim. Almost nothing happens in these 2.4KB: the cold start at $230
 * does `OpenLibrary("locale.library", 38)` (`jsr -$228(a6)` on ExecBase) and
 * then `OpenLocale(NULL)` (`jsr -$9c(a6)`), and every keyword after that is a
 * few instructions marshalling arguments into one library call —
 *
 *   $54e  GetLocaleStr   (-$4e)   =Locale String$
 *   $592  GetCatalogStr  (-$48)   =Catalog String$
 *   $62a  CloseCatalog   (-$24)   Close Catalog
 *   $748  StrnCmp        (-$b4)   =Locale Compare
 *
 * — plus ConvToLower/ConvToUpper for the case keywords and FormatDate for the
 * date family. The workspace it keeps is four longwords:
 *
 *   +$00  LocaleBase, or 0 if locale.library was not there
 *   +$04  the open Catalog
 *   +$08  the open Locale
 *   +$0c  the emit file handle
 *
 * `Locale Active` returns +$08 and `Catalog Active` returns +$04, which is
 * all those two keywords are ($632, $63e).
 *
 * ## The date family is one keyword six times over
 *
 * `Date$` is `move.l $4c(a0),d3` on the Locale followed by the same formatter
 * `Format Date$` uses ($782). Offset $4c is `loc_DateFormat` in the AmigaOS
 * Locale structure, and its neighbours are the other five:
 *
 *   +$48 DateTimeFormat   +$4c DateFormat   +$50 TimeFormat
 *   +$54 ShortDateTimeFormat  +$58 ShortDateFormat  +$5c ShortTimeFormat
 *
 * matching `Datetime$`, `Date$`, `Time$`, `Short Datetime$`, `Short Date$`
 * and `Short Time$` exactly. So all six are `Format Date$` handed a format
 * string the locale supplies, and there is one formatter here, not seven.
 *
 * ## The decision this port had to make: is locale.library present?
 *
 * It is modelled as PRESENT. The extension is explicitly built to survive its
 * absence — "This extension does NOT require locale.library to load", and
 * `Catalog String$` checks `move.l $0(a2),d1 / beq` and returns the caller's
 * default when LocaleBase is zero — so reporting it absent would be a
 * defensible reading of the binary. It is the wrong one to choose: it would
 * leave fourteen of the twenty keywords answering nothing, and the host
 * genuinely does have a clock and locale data, which is the same reasoning
 * that put the clock behind the Host boundary in the first place.
 *
 * So the locale.library slice this extension calls is implemented here:
 * catalog parsing, FormatDate, collation and case. Everything below that is
 * data, not GUI — no Intuition, no windows, no tasks — which is why this was
 * portable where Delta and JD-Int were not.
 *
 * ## Where the answers come from, and what that costs
 *
 * The locale itself is FIXED English rather than read from the host. That is
 * deliberate and it is a deviation: a real Amiga answers from whatever the
 * user set in Locale prefs, and JavaScript's `Intl` could imitate that. But
 * host.ts exists to keep a census run reproducible, and a date format that
 * changed with the machine running the suite would break exactly what that
 * boundary protects. NOTE'd in status.ts, along with the format strings
 * below, which are this port's own choice — no locale file ships with the
 * extension for them to be read from.
 */
import { VI, VS, int, str } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/** `OpenLocale(NULL)` succeeded; the value only ever has to be non-zero */
const LOCALE_PTR = 0x7f10_0000
/** the Catalog pointer Open Catalog reports through `Catalog Active` */
const CATALOG_PTR = 0x7f20_0000

const bytes = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff))

// ---- the locale ------------------------------------------------------------

/**
 * The built-in English locale. `loc_DateFormat` and its five neighbours are
 * the strings the date keywords read out of the Locale structure; with no
 * locale file present these are the port's own, chosen to match the shape
 * AmigaOS uses (day-month-year, 24-hour) rather than invented freely.
 */
const FORMATS = {
  dateTime: '%d-%b-%y %H:%M:%S', // +$48 loc_DateTimeFormat
  date: '%d-%b-%y', // +$4c loc_DateFormat
  time: '%H:%M:%S', // +$50 loc_TimeFormat
  shortDateTime: '%d-%b-%y %H:%M', // +$54 loc_ShortDateTimeFormat
  shortDate: '%d-%b-%y', // +$58 loc_ShortDateFormat
  shortTime: '%H:%M', // +$5c loc_ShortTimeFormat
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ABDAYS = DAYS.map((d) => d.slice(0, 3))
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const ABMONTHS = MONTHS.map((m) => m.slice(0, 3))

/**
 * `GetLocaleStr` string ids.
 *
 * NOTE, and this is the weakest claim in the port: the id assignment is
 * locale.library's own, published in Commodore's `locale.h`, and that header
 * is NOT in this archive. The extension's doc does not list the ids either —
 * it tells you to go and find them ("try this command out with a FOR loop...
 * This will probably fail when I reach about 50, but then you'll know"). So
 * the four documented blocks below are from the published header layout and
 * everything outside them answers with the empty string rather than a guess.
 */
function localeStr(id: number): string {
  if (id >= 1 && id <= 7) return DAYS[id - 1]!
  if (id >= 8 && id <= 14) return ABDAYS[id - 8]!
  if (id >= 15 && id <= 26) return MONTHS[id - 15]!
  if (id >= 27 && id <= 38) return ABMONTHS[id - 27]!
  return ''
}

// ---- the clock -------------------------------------------------------------

interface Civil {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  min: number
  sec: number
  weekday: number // 0 = Sunday
  yday: number // 1-366
}

/**
 * An AmigaDOS DateStamp — days since 1 January 1978, minutes since midnight,
 * ticks at 1/50s — turned into fields the formatter can use. 1 January 1978
 * was a Sunday, which is what makes the weekday a plain remainder.
 */
function civil(days: number, mins: number, ticks: number): Civil {
  const d = new Date(Date.UTC(1978, 0, 1) + days * 86_400_000)
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: Math.floor(mins / 60),
    min: mins % 60,
    sec: Math.floor(ticks / 50),
    weekday: ((days % 7) + 7) % 7,
    yday: Math.floor((d.getTime() - jan1) / 86_400_000) + 1,
  }
}

const pad = (n: number, w = 2, c = '0'): string => String(n).padStart(w, c)

/**
 * `FormatDate`. Every directive the doc lists, in the order it lists them —
 * the compound ones (%c, %C, %D, %r, %R, %T, %x, %X) are expanded by
 * recursion, which is what "same as ..." in the doc means.
 *
 * NOTE. %Z is referenced only inside %C's expansion ("%a %b %e %T %Z %Y") and
 * is not itself in the directive list; there is no time zone here to name, so
 * it expands to nothing and %C loses that field. An unknown directive emits
 * its own character, and a trailing '%' emits nothing.
 */
function formatDate(fmt: string, t: Civil): string {
  let out = ''
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] !== '%') {
      out += fmt[i]
      continue
    }
    const c = fmt[++i]
    if (c === undefined) break
    switch (c) {
      case 'a': out += ABDAYS[t.weekday]!; break
      case 'A': out += DAYS[t.weekday]!; break
      case 'b': case 'h': out += ABMONTHS[t.month - 1]!; break
      case 'B': out += MONTHS[t.month - 1]!; break
      case 'c': out += formatDate('%a %b %d %H:%M:%S %Y', t); break
      case 'C': out += formatDate('%a %b %e %T %Z %Y', t); break
      case 'd': out += pad(t.day); break
      case 'D': out += formatDate('%m/%d/%y', t); break
      case 'e': out += pad(t.day, 2, ' '); break
      case 'H': out += pad(t.hour); break
      case 'I': out += pad(t.hour % 12 === 0 ? 12 : t.hour % 12); break
      case 'j': out += pad(t.yday, 3); break
      case 'm': out += pad(t.month); break
      case 'M': out += pad(t.min); break
      case 'n': out += '\n'; break
      case 'p': out += t.hour < 12 ? 'AM' : 'PM'; break
      case 'r': out += formatDate('%I:%M:%S %p', t); break
      case 'R': out += formatDate('%H:%M', t); break
      case 'S': out += pad(t.sec); break
      case 't': out += '\t'; break
      case 'T': out += formatDate('%H:%M:%S', t); break
      // "week number, taking Sunday as first day of week" — the days before
      // the year's first Sunday are week 0, which is the C convention
      case 'U': out += pad(Math.floor((t.yday + 6 - t.weekday) / 7)); break
      case 'w': out += String(t.weekday); break
      case 'W': out += pad(Math.floor((t.yday + 6 - ((t.weekday + 6) % 7)) / 7)); break
      case 'x': out += formatDate('%m/%d/%y', t); break
      case 'X': out += formatDate('%H:%M:%S', t); break
      case 'y': out += pad(t.year % 100); break
      case 'Y': out += pad(t.year, 4); break
      case 'Z': break // no time zone to name here
      default: out += c
    }
  }
  return out
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
 * An AmigaOS message catalog: `FORM....CTLG` with `FVER`, `LANG`, `CSET` and
 * `STRS` chunks. The strings live in STRS as a run of
 * `ULONG id / ULONG length / bytes[length]`, each entry's data NUL-terminated
 * and padded so the length is a multiple of four.
 *
 * NOTE. This reader is written from the published CTLG layout, not from a
 * shipped catalog: the extension's archive contains no `.catalog` file, and
 * the parsing is locale.library's job rather than the extension's, so there
 * is nothing in these 2.4KB to check it against. The tests build a catalog
 * byte by byte and read it back, which pins the reader against the format as
 * this port understands it — not against a real Commodore-produced file.
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
        q += len
      }
    }
    p = body + size + (size & 1) // IFF chunks pad to even
  }
  return cat
}

// ---- state -----------------------------------------------------------------

export interface LocaleState {
  /** +$04's live meaning — nulled by Close Catalog so lookups stop */
  catalog: Catalog | null
  /** +$04 as the library keeps it, which Close Catalog does NOT clear */
  catalogPtr: number
  /** +$0c: the file Emit Catalog Description opened, and what it has written */
  emitPath: string | null
  emitText: string
}

export const newLocaleState = (): LocaleState => ({
  catalog: null,
  catalogPtr: 0,
  emitPath: null,
  emitText: '',
})

// ---- dispatch --------------------------------------------------------------

export function makeLocaleInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): LocaleState => rt.locale

  return {
    /**
     * Open Catalog NAME$,LANG$ and Open Catalog NAME$,LANG$,VERSION —
     * routines 9 and 8, two token forms of one name ($5c6 falls straight
     * through into routine 10 with d0 = 0 for the version).
     *
     * "Tries to open the catalog". A failure is not an error: the doc is
     * explicit that a missing catalog or a matching built-in language simply
     * leaves nothing loaded and `Catalog String$` goes on returning defaults.
     *
     * NOTE. The catalog is looked up as the plain name given, and then under
     * `CATALOGS:<language>/<name>` — the AmigaOS search path, minus the
     * PROGDIR: and LOCALE: entries that need a program directory this port
     * does not model.
     */
    'open catalog'(it) {
      const name = it.evalStr()
      it.expect(',')
      const builtin = it.evalStr()
      if (it.accept(',')) it.evalInt() // VERSION: "must be exactly this version"
      const s = st()
      s.catalog = null
      s.catalogPtr = 0
      const fs = rt.vfs
      if (!fs || name === '') return
      // the built-in language needs no catalog, which is the whole point
      for (const path of [name, `CATALOGS:${builtin}/${name}`]) {
        const data = fs.readFile(path)
        if (!data) continue
        const cat = parseCatalog(data)
        if (!cat) continue
        if (cat.language !== '' && cat.language.toLowerCase() === builtin.toLowerCase()) continue
        s.catalog = cat
        s.catalogPtr = CATALOG_PTR
        return
      }
    },

    /**
     * Close Catalog — routine 11 ($618), `CloseCatalog` and nothing else.
     *
     * NOTE, a defect of the library's: it never clears the pointer at +$04.
     * `Catalog Active` reads that field directly ($63e), so after Close
     * Catalog it goes on reporting a catalog that has been freed — the doc's
     * "returns 0 if no catalog is loaded" is not true once one has been
     * closed. Reproduced. What is NOT reproduced is a later `Catalog String$`
     * following the dangling pointer into freed memory; here the catalog is
     * gone and it returns the caller's default, which is what the routine
     * would do if the field had been cleared properly.
     */
    'close catalog'() {
      st().catalog = null
    },

    /**
     * Emit Catalog Description FILE$ — routine 14 ($64a). Opens the named
     * file with `Open(name, MODE_NEWFILE)` (`move.l #$3ee,d2`, 1006, then
     * `jsr -$1e(a6)` on DosBase) after checking `cmpi.w #$25,$14(a0)` — the
     * dos.library version must be 37 or better, which is the doc's [2.0].
     * From then on every `Catalog String$` call appends an entry.
     *
     * NOTE. The entry layout is this port's own. Routine 16 writes it, and
     * the disassembler loses that routine to AMOS's own call markers (the
     * $feXX words are macros, not 68k), so the exact bytes were not
     * recovered; the binary contains no template string to read either. What
     * is written here is the catcomp description shape the file is for — an
     * id line then the default string. A program that only feeds the file to
     * a translator will not notice; one that parses it byte for byte might.
     */
    'emit catalog description'(it) {
      const path = it.evalStr()
      const s = st()
      s.emitPath = path
      s.emitText = ''
      rt.vfs?.writeFile(path, new Uint8Array(0))
    },

    /**
     * Emit Close — routine 15 ($688), `Close` on the handle at +$0c and then
     * zero it. The doc warns that an interrupted program leaves the file
     * open, which is exactly what a handle in a workspace does.
     */
    'emit close'() {
      const s = st()
      if (s.emitPath !== null) rt.vfs?.writeFile(s.emitPath, bytes(s.emitText))
      s.emitPath = null
      s.emitText = ''
    },
  }
}

export function makeLocaleFunctions(rt: Runtime): Record<string, Func> {
  const st = (): LocaleState => rt.locale
  const now = (): Civil => {
    const d = rt.host.clock.now()
    return civil(d.days, d.mins, d.ticks)
  }

  /** the date family: one formatter, six locale-supplied format strings */
  const dated = (fmt: string): VSResult => VS(formatDate(fmt, now()))

  return {
    /**
     * =Catalog String$(ID, DEFAULT$) — routine 7 ($56a). `GetCatalogStr`
     * returns the caller's default when there is no catalog or no such id,
     * and the routine spots that by comparing the returned pointer with the
     * one it passed in (`cmp.l d0,d3`) and handing back the original AMOS
     * string rather than copying it.
     *
     * The emit file is written BEFORE the lookup ($57a), so a description
     * file records every string the program asked for, translated or not.
     */
    'catalog string$'(_, a) {
      const id = int(a[0] ?? VI(0))
      const def = str(a[1] ?? VS(''))
      const s = st()
      if (s.emitPath !== null) s.emitText += `MSG_${id}\n${def}\n;\n`
      return VS(s.catalog?.strings.get(id) ?? def)
    },

    /** =Catalog Active — routine 13 ($63e), the raw field at +$04 */
    'catalog active'() {
      return VI(st().catalogPtr)
    },

    /**
     * =Locale Active — routine 12 ($632), the Locale pointer at +$08. The doc
     * uses it as a yes/no ("If Locale Active=0"), and the value is only ever
     * a pointer, so this answers with a stable non-zero one.
     */
    'locale active'() {
      return VI(LOCALE_PTR)
    },

    /** =Locale String$(ID) — routine 6 ($53e), `GetLocaleStr` */
    'locale string$'(_, a) {
      return VS(localeStr(int(a[0] ?? VI(0))))
    },

    /** =Format Date$(FORMAT$) — routine 20 ($770) */
    'format date$'(_, a) {
      return VS(formatDate(str(a[0] ?? VS('')), now()))
    },
    /** =Datetime$ — loc_DateTimeFormat, +$48 */
    datetime$() {
      return dated(FORMATS.dateTime)
    },
    /** =Date$ — loc_DateFormat, +$4c ($788) */
    date$() {
      return dated(FORMATS.date)
    },
    /** =Time$ — loc_TimeFormat, +$50 */
    time$() {
      return dated(FORMATS.time)
    },
    /** =Short Datetime$ — loc_ShortDateTimeFormat, +$54 ($7ce) */
    'short datetime$'() {
      return dated(FORMATS.shortDateTime)
    },
    /** =Short Date$ — loc_ShortDateFormat, +$58 */
    'short date$'() {
      return dated(FORMATS.shortDate)
    },
    /** =Short Time$ — loc_ShortTimeFormat, +$5c */
    'short time$'() {
      return dated(FORMATS.shortTime)
    },

    /**
     * =Locale Compare(S1$,S2$) and =Locale Compare(S1$,S2$,LEVEL) — routines
     * 17 and 18, LEVEL defaulting to 1 (`moveq #$1,d1` at $720).
     *
     * The routine compares over the SHORTER of the two lengths ($73e-$756
     * picks it with `cmp.w d2,d3 / bcc`), and only if `StrnCmp` calls that
     * equal does it fall back to the lengths — returning 1 when the first is
     * longer and -1 (`moveq #$ff,d0`, sign-extended) when the second is.
     *
     * NOTE. Levels 1 and 2 fold accents here by decomposing to the base
     * letter, which is not AmigaOS's collation table and cannot be: the
     * table lives in a locale file this port has none of. The author's own
     * doc says the real one is wrong anyway — "the swedish characters aao,
     * which _should_ be last in the swedish alphabet, is instead sorted in
     * like this: a=a=a and o=o. This may be good for some languages. But not
     * for swedish." Level 0 is a plain byte compare and is exact.
     */
    'locale compare'(_, a) {
      const s1 = str(a[0] ?? VS(''))
      const s2 = str(a[1] ?? VS(''))
      const level = a.length >= 3 ? int(a[2]!) : 1
      const key = (s: string): string => {
        if (level <= 0) return s
        const flat = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
        return level === 1 ? flat.toLowerCase() : flat
      }
      const k1 = key(s1)
      const k2 = key(s2)
      const n = Math.min(k1.length, k2.length)
      for (let i = 0; i < n; i++) {
        const d = k1.charCodeAt(i) - k2.charCodeAt(i)
        if (d !== 0) return VI(d < 0 ? -1 : 1)
      }
      if (s1.length === s2.length) return VI(0)
      return VI(s1.length > s2.length ? 1 : -1)
    },

    /**
     * =Locale Lower$(S$) / =Locale Upper$(S$) — routines 2 and 3 ($41a,
     * $490), a `ConvToLower`/`ConvToUpper` call per character. "Works just
     * like AMOS' normal Upper$ and Lower$, but converts letters like a or ae
     * or e correctly", so the accented range is what distinguishes them.
     *
     * NOTE. Case is folded over Latin-1, which is the code set an Amiga of
     * this era used, and only where the pairing is unambiguous — the German
     * sharp s has no single-character upper case and is left alone, as the
     * library leaves it.
     */
    'locale lower$'(_, a) {
      return VS(mapCase(str(a[0] ?? VS('')), false))
    },
    'locale upper$'(_, a) {
      return VS(mapCase(str(a[0] ?? VS('')), true))
    },
    /** =Lowerchar(C) / =Upperchar(C) — routines 4 and 5, the same per character */
    lowerchar(_, a) {
      return VI(mapCase(String.fromCharCode(int(a[0] ?? VI(0)) & 0xff), false).charCodeAt(0))
    },
    upperchar(_, a) {
      return VI(mapCase(String.fromCharCode(int(a[0] ?? VI(0)) & 0xff), true).charCodeAt(0))
    },
  }
}

/** Latin-1 case folding, one character at a time as the library does it */
function mapCase(s: string, up: boolean): string {
  let out = ''
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (up) {
      // a-z, and the accented run at $e0-$fe excluding the division sign
      if (c >= 0x61 && c <= 0x7a) out += String.fromCharCode(c - 32)
      else if (c >= 0xe0 && c <= 0xfe && c !== 0xf7) out += String.fromCharCode(c - 32)
      else out += ch
    } else {
      if (c >= 0x41 && c <= 0x5a) out += String.fromCharCode(c + 32)
      else if (c >= 0xc0 && c <= 0xde && c !== 0xd7) out += String.fromCharCode(c + 32)
      else out += ch
    }
  }
  return out
}

type VSResult = ReturnType<typeof VS>

/** what this file implements, for the coverage manifest */
export const LOCALE_IMPLEMENTED: readonly string[] = [
  'open catalog', 'close catalog', 'catalog string$', 'catalog active',
  'emit catalog description', 'emit close',
  'locale string$', 'locale active', 'locale compare',
  'locale lower$', 'locale upper$', 'lowerchar', 'upperchar',
  'format date$', 'date$', 'time$', 'datetime$',
  'short date$', 'short time$', 'short datetime$',
]
