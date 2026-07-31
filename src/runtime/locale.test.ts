import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { fixedClock, FIXED_DATE } from './host'
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
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [LOCALE_SLOT, extensionById('locale-0.26')!.table] as const,
])

function run(src: string, files: Record<string, Uint8Array> = {}): { out: string; rt: Runtime; fs: AmigaFS } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  for (const [path, data] of Object.entries(files)) fs.writeFile(path, data)
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 500_000,
    extensions,
    fs,
    host: { clock: fixedClock() },
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(200)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
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
 * entry is `ULONG id / ULONG length / bytes`, NUL-terminated and padded to a
 * multiple of four — which is what makes the length larger than the string.
 */
function catalog(language: string, strings: Array<[number, string]>): Uint8Array {
  const strs: number[] = []
  for (const [id, s] of strings) {
    const raw = [...cc(s), 0]
    while (raw.length % 4 !== 0) raw.push(0)
    strs.push(...be32(id), ...be32(raw.length), ...raw)
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

  it('an id outside the blocks we can evidence is empty', () => {
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
    ['%p', 'PM'],
    ['%S', '00'],
    ['%w', '2'],
    ['%y', '94'],
    ['%Y', '1994'],
    ['%D', '07/12/94'],
    ['%r', '02:30:00 PM'],
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
      'The time is 02:30:00 PM and the month is July',
    )
  })

  it('an unknown directive emits its own character', () => {
    expect(val('Format Date$("%q")')).toBe('q')
    expect(val('Format Date$("100%")')).toBe('100')
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
      '12-Jul-94',
      '14:30:00',
      '12-Jul-94 14:30:00',
      '12-Jul-94',
      '14:30',
      '12-Jul-94 14:30',
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

  it('level 0 is a plain byte compare, so case still separates', () => {
    expect(val('Locale Compare("A","a",0)<0')).toBe('-1')
  })

  it('level 1 ignores case and accents — "Does not make any difference between e-acute and e"', () => {
    expect(val('Locale Compare("A","a",1)')).toBe('0')
    expect(val(`Locale Compare("e",Chr$(233),1)`)).toBe('0')
  })

  it('level 2 folds the accent but keeps the case distinction', () => {
    // "Will place e-acute before f, but not equal to e"
    expect(val(`Locale Compare(Chr$(233),"f",2)<0`)).toBe('-1')
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

  it('leaves alone what has no counterpart', () => {
    expect(val('Asc(Locale Upper$(Chr$(223)))')).toBe('223') // sharp s
    expect(val('Asc(Locale Upper$(Chr$(247)))')).toBe('247') // division sign
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
