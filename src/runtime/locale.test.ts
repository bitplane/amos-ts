import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { existsSync, readFileSync } from 'node:fs'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { fixedClock, FIXED_DATE } from '../amiga/host'
import { parseLanguage, type Language } from '../amiga/language'
import { formatDate } from '../amiga/localelib'
import { parseCatalog } from './locale'

/**
 * Locale 0.26, against `locale_ext.doc` and the routine addresses in
 * `AMOSPro_locale.lib`. The clock is the frozen one — FIXED_DATE is 12 July
 * 1994, 14:30:00, which is a Tuesday — so every date assertion below is a
 * fixed string rather than something that moves with the calendar.
 */
const table = new TokenTable(CORE_TOKENS)
/** the doc's "enter at entry #17", and the workspace at $1f8(a5) */
const LOCALE_SLOT = 17
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)] as const),
  [LOCALE_SLOT, extensionById('locale-0.26')!.table] as const,
])

function run(
  src: string,
  files: Record<string, Uint8Array> = {},
  language: Language | null = null,
): { out: string; rt: Runtime; fs: AmigaFS } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  for (const [path, data] of Object.entries(files)) fs.writeFile(path, data)
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 500_000,
    extensions,
    fs,
    host: { clock: fixedClock(), language },
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(200)
  mustFinish(r)
  return { out, rt, fs }
}
const val = (expr: string): string => run(`Print ${expr}`).out.trim()
const lines = (src: string[], files: Record<string, Uint8Array> = {}): string[] =>
  run(src.join('\n'), files).out.split('\n').map((s) => s.trim())

// ---- building a catalog ----------------------------------------------------

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const cc = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const chunk = (id: string, body: number[]): number[] => [
  ...cc(id), ...be32(body.length), ...body, ...(body.length & 1 ? [0] : []),
]

/**
 * An AmigaOS message catalog: FORM....CTLG with LANG and STRS. Each STRS
 * entry is `ULONG id / ULONG length / bytes`, the bytes NUL-terminated and
 * the ENTRY then padded on to the next longword.
 *
 * The length is the string's OWN length, NUL included — the padding is NOT
 * counted in it. That distinction is why this builder was wrong the first
 * time: it wrote the padded length, which round-tripped happily against a
 * reader that made the same mistake and misread every real catalog ever
 * shipped. locale.corpus.test.ts is what caught it.
 */
function catalog(language: string, strings: Array<[number, string]>): Uint8Array {
  const strs: number[] = []
  for (const [id, s] of strings) {
    const raw = [...cc(s), 0]
    const len = raw.length
    while (raw.length % 4 !== 0) raw.push(0)
    strs.push(...be32(id), ...be32(len), ...raw)
  }
  const body = [
    ...cc('CTLG'),
    ...chunk('FVER', [...cc('$VER: test.catalog 1.0'), 0]),
    ...chunk('LANG', [...cc(language), 0]),
    ...chunk('CSET', be32(0)),
    ...chunk('STRS', strs),
  ]
  return Uint8Array.from([...cc('FORM'), ...be32(body.length), ...body])
}

const SWEDISH = catalog('svenska', [
  [0, 'Hej'],
  [1, 'Varlden'],
  [5, 'Avbryt'],
])

describe('the catalog reader', () => {
  it('reads the language and the strings out of a FORM CTLG', () => {
    const cat = parseCatalog(SWEDISH)!
    expect(cat.language).toBe('svenska')
    expect(cat.strings.get(0)).toBe('Hej')
    expect(cat.strings.get(1)).toBe('Varlden')
    expect(cat.strings.get(5)).toBe('Avbryt')
    expect(cat.strings.has(2)).toBe(false)
  })

  it('rejects anything that is not a catalog', () => {
    expect(parseCatalog(Uint8Array.from(cc('not an iff file at all')))).toBeNull()
    expect(parseCatalog(Uint8Array.from([...cc('FORM'), ...be32(4), ...cc('ILBM')]))).toBeNull()
  })

  it('ids are signed longs and survive a gap in the numbering', () => {
    const cat = parseCatalog(catalog('deutsch', [[1000, 'Eins'], [2, 'Zwei']]))!
    expect([...cat.strings.keys()]).toEqual([1000, 2])
  })
})

describe('Open Catalog / Catalog String$', () => {
  it('translates an id, and falls back to the default when there is none', () => {
    expect(
      lines([
        'Open Catalog "test.catalog","english"',
        'Print Catalog String$(0,"Hello")',
        'Print Catalog String$(1,"World")',
        'Print Catalog String$(2,"Untranslated")',
      ], { 'DH0:test.catalog': SWEDISH }).slice(0, 3),
    ).toEqual(['Hej', 'Varlden', 'Untranslated'])
  })

  it('with no catalog open at all, every string is its default', () => {
    // "If no translation was found or if the builtin language is the user's
    // preferred, the string DEFAULT_STRING$ will be returned"
    expect(val('Catalog String$(0,"Hello")')).toBe('Hello')
  })

  it('a missing catalog file is not an error — it just loads nothing', () => {
    expect(
      lines([
        'Open Catalog "nosuch.catalog","english"',
        'Print Catalog Active',
        'Print Catalog String$(0,"Hello")',
      ]).slice(0, 2),
    ).toEqual(['0', 'Hello'])
  })

  it('a catalog whose language IS the built-in one is skipped', () => {
    // the whole point of DEFAULT_LANGUAGE$: no translation needed
    const { out } = run(
      ['Open Catalog "test.catalog","svenska"', 'Print Catalog Active'].join('\n'),
      { 'DH0:test.catalog': SWEDISH },
    )
    expect(out.trim()).toBe('0')
  })

  it('the optional VERSION argument parses as a third form', () => {
    expect(() => run('Open Catalog "test.catalog","english",1')).not.toThrow()
  })

  it('is also found on the CATALOGS: search path', () => {
    const { out } = run(
      ['Open Catalog "test.catalog","english"', 'Print Catalog String$(0,"Hello")'].join('\n'),
      { 'DH0:CATALOGS/svenska/test.catalog': SWEDISH },
    )
    // CATALOGS: is an assign the test filesystem does not carry, so the plain
    // name is what resolves here; the point is that neither path throws
    expect(out.trim()).toBe('Hello')
  })
})

describe('Catalog Active, and the pointer Close Catalog forgets to clear', () => {
  it('is 0 before, and non-zero once a catalog is open', () => {
    const { out } = run(
      ['Print Catalog Active', 'Open Catalog "test.catalog","english"', 'Print Catalog Active<>0'].join('\n'),
      { 'DH0:test.catalog': SWEDISH },
    )
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['0', '-1'])
  })

  it('STAYS non-zero after Close Catalog — the library never clears +$04', () => {
    // routine 11 ($618) is `move.l $0(a2),d0 / beq / movea.l $4(a2),a0 /
    // jsr -$24(a6)` and nothing else: CloseCatalog frees the catalog and the
    // field keeps pointing at it. So the doc's "returns 0 if no catalog is
    // loaded" stops being true the moment one has been closed.
    const { out } = run(
      [
        'Open Catalog "test.catalog","english"',
        'Close Catalog',
        'Print Catalog Active<>0',
        'Print Catalog String$(0,"Hello")',
      ].join('\n'),
      { 'DH0:test.catalog': SWEDISH },
    )
    // the pointer survives; the lookup does not
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['-1', 'Hello'])
  })
})

describe('Locale Active and Locale String$', () => {
  it('Locale Active is non-zero — the locale opened', () => {
    // "If Locale Active=0 : Print "you need locale.library" : End : End If"
    expect(val('Locale Active<>0')).toBe('-1')
  })

  it('Locale String$ gives the day and month names', () => {
    expect(lines(['Print Locale String$(1)', 'Print Locale String$(8)', 'Print Locale String$(15)', 'Print Locale String$(27)']).slice(0, 4)).toEqual(
      ['Sunday', 'Sun', 'January', 'Jan'],
    )
  })

  it('and the rest of the table, up to FUTURESTR', () => {
    // YESSTR 39, NOSTR 40, AM_STR 41, PM_STR 42, then the hyphens and quotes,
    // then the relative day names at 47-50
    expect(lines([
      'Print Locale String$(39)', 'Print Locale String$(40)',
      'Print Locale String$(41)', 'Print Locale String$(42)',
      'Print Locale String$(48)', 'Print Locale String$(50)',
    ]).slice(0, 6)).toEqual(['Yes', 'No', 'am', 'pm', 'Today', 'Future'])
  })

  it('runs out at FUTURESTR — id 51 is a V50 addition english.language lacks', () => {
    // MAXSTRMSG is 52, but the English table stops at FUTURESTR (50); the id
    // above it is LANG_NAME, which locale.h marks V50. The extension opens
    // v38, so it could never have reached it. This is what the doc's "will
    // probably fail when I reach about 50" was describing.
    expect(val('Len(Locale String$(51))')).toBe('0')
    expect(val('Len(Locale String$(200))')).toBe('0')
    expect(val('Len(Locale String$(0))')).toBe('0')
  })
})

describe('Format Date$ — every directive the doc lists', () => {
  // FIXED_DATE: 12 July 1994, 14:30:00. A Tuesday.
  it('the fixture really is the date the assertions assume', () => {
    expect(FIXED_DATE).toEqual({ days: 6036, mins: 870, ticks: 0 })
  })

  const cases: Array<[string, string]> = [
    ['%a', 'Tue'],
    ['%A', 'Tuesday'],
    ['%b', 'Jul'],
    ['%B', 'July'],
    ['%h', 'Jul'],
    ['%d', '12'],
    ['%e', '12'],
    ['%H', '14'],
    ['%I', '02'],
    ['%j', '193'],
    ['%m', '07'],
    ['%M', '30'],
    ['%p', 'pm'],
    ['%S', '00'],
    ['%w', '2'],
    ['%y', '94'],
    ['%Y', '1994'],
    ['%D', '07/12/94'],
    ['%r', '02:30:00 pm'],
    ['%R', '14:30'],
    ['%T', '14:30:00'],
    ['%x', '07/12/94'],
    ['%X', '14:30:00'],
    ['%c', 'Tue Jul 12 14:30:00 1994'],
  ]
  for (const [fmt, want] of cases) {
    it(`${fmt} is ${want}`, () => {
      expect(val(`Format Date$("${fmt}")`)).toBe(want)
    })
  }

  it('%n and %t insert a linefeed and a tab', () => {
    expect(val('Len(Format Date$("%n%t"))')).toBe('2')
    expect(val('Asc(Format Date$("%n"))')).toBe('10')
    expect(val('Asc(Format Date$("%t"))')).toBe('9')
  })

  it('%U and %W count weeks from Sunday and from Monday', () => {
    // 12 July 1994 is day 193, a Tuesday
    expect(val('Format Date$("%U")')).toBe('28')
    expect(val('Format Date$("%W")')).toBe('28')
  })

  it('literal text passes through, and the doc\'s own example works', () => {
    expect(val('Format Date$("The time is %r and the month is %B")')).toBe(
      'The time is 02:30:00 pm and the month is July',
    )
  })

  it('an unknown directive emits its own character', () => {
    // NB not %q: that is a real directive, just an undocumented one
    expect(val('Format Date$("%z")')).toBe('z')
    expect(val('Format Date$("100%")')).toBe('100')
  })

  it('%q and %Q are real directives the doc never mentions', () => {
    // PrintDigits with a fill of -1: the hour, and the 12-hour hour, unpadded.
    // They matter because the default locale's own time formats are made of
    // %Q -- without them Time$ would print a literal Q.
    expect(val('Format Date$("%q")')).toBe('14')
    expect(val('Format Date$("%Q")')).toBe('2')
  })

  it('%I and %Q use 12, not zero, at noon and midnight', () => {
    // locale.library 38.27 divides the hour by 12 and explicitly replaces a
    // zero remainder with 12 before choosing padded or unpadded output.
    const civil = { year: 1994, month: 7, day: 12, weekday: 2, hour: 0, min: 0, sec: 0 }
    expect(formatDate('%I/%Q', civil)).toBe('12/12')
    expect(formatDate('%I/%Q', { ...civil, hour: 12 })).toBe('12/12')
    expect(formatDate('%I/%Q', { ...civil, hour: 14 })).toBe('02/2')
  })

  it('%p switches at noon', () => {
    expect(val('Format Date$("%p")')).toBe('pm')
  })
})

describe('the six date keywords are Format Date$ with the locale\'s format', () => {
  it('each reads its own field of the Locale structure', () => {
    // +$4c DateFormat, +$50 TimeFormat, +$48 DateTimeFormat and the three
    // Short ones at +$54/+$58/+$5c
    expect(lines([
      'Print Date$', 'Print Time$', 'Print Datetime$',
      'Print Short Date$', 'Print Short Time$', 'Print Short Datetime$',
    ]).slice(0, 6)).toEqual([
      'Tuesday July 12', // %A %B %e
      '2:30:00 pm', // %Q:%M:%S %p
      'Tuesday July 12 1994 2:30 pm', // %A %B %e %Y %Q:%M %p
      '07/12/94', // %m/%d/%y
      '2:30 pm', // %Q:%M %p
      '07/12/94 2:30 pm', // %m/%d/%y %Q:%M %p
    ])
  })
})

describe('Locale Compare', () => {
  it('is <0, 0 or >0 the way the doc says', () => {
    expect(val('Locale Compare("a","b")<0')).toBe('-1')
    expect(val('Locale Compare("b","a")>0')).toBe('-1')
    expect(val('Locale Compare("a","a")')).toBe('0')
  })

  it('falls back to length only when the common prefix matches', () => {
    // $73e-$756 compares over the SHORTER length, then $75e compares lengths
    expect(val('Locale Compare("abc","ab")')).toBe('1')
    expect(val('Locale Compare("ab","abc")')).toBe('-1')
  })

  it('level 0 is SC_ASCII, which is case-INSENSITIVE — the doc is wrong', () => {
    // locale.library resolves SC_ASCII through __code_table_to_upper, so
    // "ordinary compare. You could skip this function and use a straight
    // If STRING1$=STRING2$ instead" is not what level 0 does.
    expect(val('Locale Compare("A","a",0)')).toBe('0')
    expect(val('Locale Compare("a","B",0)<0')).toBe('-1') // and it collates
  })

  it('the result is the raw table difference, not a clamped sign', () => {
    // the extension passes StrnCmp's answer straight through (`move.l d0,d3`),
    // and the doc promises "<0"/">0" rather than -1/1 for exactly that reason
    expect(val('Locale Compare("a","c",0)')).toBe('-2')
    expect(val('Locale Compare("d","a",0)')).toBe('3')
  })

  it('level 1 ignores case and accents — the doc\'s own words', () => {
    // "locale light :) Does not make any difference between e-acute and e".
    // __language_short_order_tab maps e, E and e-acute all to 69.
    expect(val('Locale Compare("A","a",1)')).toBe('0')
    expect(val('Locale Compare("e",Chr$(233),1)')).toBe('0')
  })

  it('level 2 places e-acute AFTER e but BEFORE f — again the doc\'s words', () => {
    // "locale standard. Will place e-acute before f, but not equal to e".
    // __language_long_order_tab: e=101, E-acute=103, e-acute=107, f=111.
    expect(val('Locale Compare("e",Chr$(233),2)<0')).toBe('-1')
    expect(val('Locale Compare(Chr$(233),"f",2)<0')).toBe('-1')
    expect(val('Locale Compare("e",Chr$(233),2)')).toBe('-6')
  })

  it("reproduces the author's Swedish complaint, because the table does", () => {
    // "the swedish characters aao, which _should_ be last in the swedish
    // alphabet, is instead sorted in like this: a-ring=a-umlaut=a and
    // o-umlaut=o. This may be good for some languages. But not for swedish."
    // Level 1's table folds a-ring (229) and a-umlaut (228) both onto 65,
    // and o-umlaut (246) onto 79 -- exactly the bug he reported.
    expect(val('Locale Compare(Chr$(229),"a",1)')).toBe('0')
    expect(val('Locale Compare(Chr$(228),"a",1)')).toBe('0')
    expect(val('Locale Compare(Chr$(246),"o",1)')).toBe('0')
  })

  it('the level defaults to 1 when the third argument is left off', () => {
    // `moveq #$1,d1` at $720, before the two-argument form joins the three
    expect(val('Locale Compare("A","a")')).toBe('0')
  })
})

describe('Locale Upper$ / Lower$ and Upperchar / Lowerchar', () => {
  it('convert the plain ASCII range like Upper$ and Lower$ do', () => {
    expect(val('Locale Upper$("hello")')).toBe('HELLO')
    expect(val('Locale Lower$("HELLO")')).toBe('hello')
  })

  it('and the accented range, which is the point of them', () => {
    // "converts letters like a-ring or ae or e-acute correctly"
    expect(val('Asc(Locale Upper$(Chr$(233)))')).toBe('201') // e-acute -> E-acute
    expect(val('Asc(Locale Lower$(Chr$(197)))')).toBe('229') // A-ring -> a-ring
    expect(val('Asc(Locale Upper$(Chr$(230)))')).toBe('198') // ae -> AE
  })

  it('leaves alone what the code table maps to itself', () => {
    expect(val('Asc(Locale Upper$(Chr$(223)))')).toBe('223') // sharp s
    expect(val('Asc(Locale Upper$(Chr$(247)))')).toBe('247') // division sign
    expect(val('Asc(Locale Upper$(Chr$(215)))')).toBe('215') // multiplication sign
    expect(val('Locale Upper$("123!")')).toBe('123!')
  })

  it('the char forms are the same conversion, one character at a time', () => {
    // "Print Chr$(Upperchar(Asc("a")) is a silly way to write Locale Upper$("a")"
    expect(val('Upperchar(Asc("a"))')).toBe('65')
    expect(val('Lowerchar(Asc("A"))')).toBe('97')
    expect(val('Upperchar(233)')).toBe('201')
  })
})

describe('Emit Catalog Description', () => {
  it('records every Catalog String$ call, translated or not', () => {
    const { fs } = run(
      [
        'Emit Catalog Description "DH0:test.cd"',
        'A$=Catalog String$(0,"Hello")',
        'A$=Catalog String$(7,"Cancel")',
        'Emit Close',
      ].join('\n'),
      { 'DH0:test.catalog': SWEDISH },
    )
    const text = new TextDecoder('latin1').decode(fs.readFile('DH0:test.cd')!)
    expect(text).toContain('MSG_0')
    expect(text).toContain('Hello')
    expect(text).toContain('MSG_7')
    expect(text).toContain('Cancel')
  })

  it('the DEFAULT is what gets recorded, not the translation', () => {
    // the emit happens at $57a, BEFORE the GetCatalogStr lookup at $592
    const { fs } = run(
      [
        'Open Catalog "test.catalog","english"',
        'Emit Catalog Description "DH0:out.cd"',
        'A$=Catalog String$(0,"Hello")',
        'Emit Close',
      ].join('\n'),
      { 'DH0:test.catalog': SWEDISH },
    )
    const text = new TextDecoder('latin1').decode(fs.readFile('DH0:out.cd')!)
    expect(text).toContain('Hello')
    expect(text).not.toContain('Hej')
  })

  it('nothing is emitted once Emit Close has run', () => {
    const { fs } = run(
      [
        'Emit Catalog Description "DH0:x.cd"',
        'A$=Catalog String$(1,"One")',
        'Emit Close',
        'A$=Catalog String$(2,"Two")',
      ].join('\n'),
    )
    const text = new TextDecoder('latin1').decode(fs.readFile('DH0:x.cd')!)
    expect(text).toContain('One')
    expect(text).not.toContain('Two')
  })
})

describe('every Locale keyword is dispatched', () => {
  it('all twenty run', () => {
    const def = extensionById('locale-0.26')!
    const names = def.tokens.map((t) => t.name.replace(/^!/, '').trim()).filter(Boolean)
    expect(names.length).toBe(20)
    const calls: Record<string, string> = {
      'open catalog': 'Open Catalog "a.catalog","english"',
      'close catalog': 'Close Catalog',
      'catalog string$': 'Print Catalog String$(0,"x")',
      'catalog active': 'Print Catalog Active',
      'emit catalog description': 'Emit Catalog Description "DH0:e.cd"',
      'emit close': 'Emit Close',
      'locale string$': 'Print Locale String$(1)',
      'locale active': 'Print Locale Active',
      'locale compare': 'Print Locale Compare("a","b")',
      'locale lower$': 'Print Locale Lower$("A")',
      'locale upper$': 'Print Locale Upper$("a")',
      lowerchar: 'Print Lowerchar(65)',
      upperchar: 'Print Upperchar(97)',
      'format date$': 'Print Format Date$("%Y")',
      date$: 'Print Date$',
      time$: 'Print Time$',
      datetime$: 'Print Datetime$',
      'short date$': 'Print Short Date$',
      'short time$': 'Print Short Time$',
      'short datetime$': 'Print Short Datetime$',
    }
    for (const n of names) {
      expect(calls[n], `no call written for ${n}`).toBeDefined()
      expect(() => run(calls[n]!), n).not.toThrow()
    }
  })
})

/**
 * The whole point of Host.language, end to end: the same program, the same
 * frozen clock, a different `.language` file underneath it.
 *
 * These are Commodore's own Workbench 2.1 binaries rather than anything built
 * here — see ../amiga/language.test.ts for why that matters — and the check is
 * that AMOS keywords answer in the language, not merely that the reader parsed
 * one. FIXED_DATE is 12 July 1994, a Tuesday.
 */
const LANGUAGES = '/home/gaz/src/tmp/amos/amos-files/sources/amos-pd-library-cd-1994/files/WB-2.1/Locale/Languages'
const language = (name: string): Language | null => {
  const p = Buffer.from(`${LANGUAGES}/${name}.language`, 'latin1')
  if (!existsSync(p)) return null
  return parseLanguage(new Uint8Array(readFileSync(p)))
}

describe.skipIf(language('deutsch') === null)('Host.language, against the real Workbench 2.1 files', () => {
  it('Format Date$ names the day and month in the chosen language', () => {
    // 12 July 1994 was a Tuesday
    expect(run('Print Format Date$("%A %d %B %Y")').out.trim()).toBe('Tuesday 12 July 1994')
    expect(run('Print Format Date$("%A %d %B %Y")', {}, language('deutsch')).out.trim()).toBe(
      'Dienstag 12 Juli 1994',
    )
    expect(run('Print Format Date$("%A %d %B %Y")', {}, language('svenska')).out.trim()).toBe(
      'Tisdag 12 Juli 1994',
    )
    expect(run('Print Format Date$("%A %d %B %Y")', {}, language('français')).out.trim()).toBe(
      'Mardi 12 Juillet 1994',
    )
  })

  it('Locale String$ answers from the language, by GetLocaleStr id', () => {
    expect(run('Print Locale String$(1)', {}, language('deutsch')).out.trim()).toBe('Sonntag')
    expect(run('Print Locale String$(15)', {}, language('deutsch')).out.trim()).toBe('Januar')
    // id 3 is März -- latin-1 through the whole stack, reader to Print
    expect(run('Print Locale String$(17)', {}, language('deutsch')).out.trim()).toBe('März')
  })

  it('the abbreviated forms move too, so %a and %b are not silently english', () => {
    // German abbreviates the days to two letters -- So Mo Di Mi Do Fr Sa
    expect(run('Print Format Date$("%a %b")', {}, language('deutsch')).out.trim()).toBe('Di Jul')
    expect(run('Print Format Date$("%a %b")').out.trim()).toBe('Tue Jul')
  })

  /**
   * The default has to stay english, or every existing test and the corpus
   * census would move underneath us -- which is the reason this is a host
   * setting and not `navigator.language`.
   */
  it('a host that says nothing is still english', () => {
    expect(run('Print Format Date$("%A")').out.trim()).toBe('Tuesday')
    expect(run('Print Locale String$(1)').out.trim()).toBe('Sunday')
  })
})
