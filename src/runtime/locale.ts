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
 * ## Where the answers come from
 *
 * All of it through ./amigalocale.ts, the modelled locale.library, whose data
 * is generated from the AROS sources by src/cli/genlocale.ts. Nothing about
 * dates, collation, case or the standard strings is decided in this file any
 * more -- it marshals arguments and gets out of the way, which is what the
 * extension itself does.
 *
 * The locale is the built-in English one rather than the host's, deliberately:
 * see amigalocale.ts.
 */
import { VI, VS, int, str } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import {
  DEFAULT_FORMATS,
  civilFromStamp,
  formatDate,
  getCatalogStr,
  getLocaleStr,
  localeLower,
  localeUpper,
  convToLower,
  convToUpper,
  parseCatalog,
  strnCmp,
  type Catalog,
  type Civil,
} from '../amiga/localelib'

export { parseCatalog } from '../amiga/localelib'

/** `OpenLocale(NULL)` succeeded; the value only ever has to be non-zero */
const LOCALE_PTR = 0x7f10_0000
/** the Catalog pointer Open Catalog reports through `Catalog Active` */
const CATALOG_PTR = 0x7f20_0000

const bytes = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff))

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
    return civilFromStamp(d.days, d.mins, d.ticks)
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
      return VS(getCatalogStr(s.catalog, id, def))
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
      return VS(getLocaleStr(int(a[0] ?? VI(0))))
    },

    /** =Format Date$(FORMAT$) — routine 20 ($770) */
    'format date$'(_, a) {
      return VS(formatDate(str(a[0] ?? VS('')), now()))
    },
    /** =Datetime$ — loc_DateTimeFormat, +$48 */
    datetime$() {
      return dated(DEFAULT_FORMATS.dateTime)
    },
    /** =Date$ — loc_DateFormat, +$4c ($788) */
    date$() {
      return dated(DEFAULT_FORMATS.date)
    },
    /** =Time$ — loc_TimeFormat, +$50 */
    time$() {
      return dated(DEFAULT_FORMATS.time)
    },
    /** =Short Datetime$ — loc_ShortDateTimeFormat, +$54 ($7ce) */
    'short datetime$'() {
      return dated(DEFAULT_FORMATS.shortDateTime)
    },
    /** =Short Date$ — loc_ShortDateFormat, +$58 */
    'short date$'() {
      return dated(DEFAULT_FORMATS.shortDate)
    },
    /** =Short Time$ — loc_ShortTimeFormat, +$5c */
    'short time$'() {
      return dated(DEFAULT_FORMATS.shortTime)
    },

    /**
     * =Locale Compare(S1$,S2$) and =Locale Compare(S1$,S2$,LEVEL) — routines
     * 17 and 18, LEVEL defaulting to 1 (`moveq #$1,d1` at $720).
     *
     * The routine compares over the SHORTER of the two lengths ($73e-$756
     * picks it with `cmp.w d2,d3 / bcc`), passes that length to StrnCmp, and
     * only if StrnCmp calls the stretch equal does it fall back to the
     * lengths — returning 1 when the first is longer and -1 (`moveq #$ff,d0`,
     * sign-extended) when the second is. StrnCmp's own answer is passed
     * through unchanged, so a difference from the collation table reaches
     * BASIC raw rather than clamped to a sign; the doc promising "<0" and
     * ">0" rather than -1 and 1 is describing exactly that.
     *
     * NOTE on the levels, and it corrects the doc. Level 0 is SC_ASCII, which
     * locale.library resolves through the to_UPPER table — so it is
     * case-INSENSITIVE, not the "ordinary compare" the doc calls it, and the
     * author's suggestion that "you could skip this function and use a
     * straight If STRING1$=STRING2$ instead" is wrong. Levels 1 and 2 are the
     * two collation orders, and they are the real ones now.
     */
    'locale compare'(_, a) {
      const s1 = str(a[0] ?? VS(''))
      const s2 = str(a[1] ?? VS(''))
      const level = a.length >= 3 ? int(a[2]!) : 1
      const n = Math.min(s1.length, s2.length)
      const d = strnCmp(s1, s2, n, level)
      if (d !== 0) return VI(d)
      if (s1.length === s2.length) return VI(0)
      return VI(s1.length > s2.length ? 1 : -1)
    },

    /**
     * =Locale Lower$(S$) / =Locale Upper$(S$) — routines 2 and 3 ($41a,
     * $490), a `ConvToLower`/`ConvToUpper` call per character. "Works just
     * like AMOS' normal Upper$ and Lower$, but converts letters like a or ae
     * or e correctly", so the accented range is what distinguishes them.
     *
     * The mapping is locale.library's own code table, so the characters with
     * no counterpart — the German sharp s, the division and multiplication
     * signs sitting inside the accented runs — come back unchanged because
     * the table maps them to themselves, not because of a special case here.
     */
    'locale lower$'(_, a) {
      return VS(localeLower(str(a[0] ?? VS(''))))
    },
    'locale upper$'(_, a) {
      return VS(localeUpper(str(a[0] ?? VS(''))))
    },
    /** =Lowerchar(C) / =Upperchar(C) — routines 4 and 5, the same table */
    lowerchar(_, a) {
      return VI(convToLower(int(a[0] ?? VI(0))))
    },
    upperchar(_, a) {
      return VI(convToUpper(int(a[0] ?? VI(0))))
    },
  }
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
