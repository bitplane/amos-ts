import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * JVP-NoKids 1.01, against the author's own `source/AMOSPro_JVP.Lib.s` and
 * `JVP_Extension.doc`, with the shipped binary settling anything the two
 * disagree on. Line numbers cited in the assertions are into that source.
 *
 * The doc names two example programs, "SortExample1" and "SortExample2", that
 * the archived release does not actually contain — so the sorts below are
 * built the way the doc tells a program to build them instead: an address
 * list, a 256-byte translation map, and a workspace of (ANT+3)*16.
 */
const table = new TokenTable(CORE_TOKENS)
/** "The extension is supposed to be at slot nr. 25", and `ExtNb equ 25-1` */
const JVP_SLOT = 25
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)] as const),
  [JVP_SLOT, extensionById('jvp-1.01')!.table] as const,
])

function run(src: string): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 2_000_000,
    extensions,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(200)
  mustFinish(r)
  return { out, rt }
}
const val = (expr: string): string => run(`Print ${expr}`).out.trim()
const lines = (src: string | string[]): string[] =>
  run(Array.isArray(src) ? src.join('\n') : src).out.split('\n').map((s) => s.trimEnd())

/** poke a run of bytes into a bank, as AMOS source */
const poke = (bank: number, at: number, bytes: number[]): string[] =>
  bytes.map((b, i) => `Poke Start(${bank})+${at + i},${b}`)
const chars = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
/** a DOS string: "MUST be terminated by a control-character [<Chr$(32)]" */
const dosStr = (bank: number, at: number, s: string): string[] =>
  poke(bank, at, [...chars(s), 0])
/** an AMOS string definition: the length word first, then the characters */
const amosStr = (bank: number, at: number, s: string): string[] => [
  `Doke Start(${bank})+${at},${s.length}`,
  ...poke(bank, at + 2, chars(s)),
]

/** the identity map — "start out by putting 1 at 1, 2 at 2 until 255" */
const IDENTITY_MAP = ['For I=0 To 255 : Poke Start(1)+I,I : Next I']

/**
 * A sort, set up as the doc prescribes. Strings go into bank 2 sixteen bytes
 * apart, their addresses into bank 3, DEST is bank 4 and WORK bank 5.
 *
 * DEST is pre-filled with -1 rather than left as the zeros Reserve gives it,
 * because a slot the library never writes would otherwise read back as 0 —
 * which is a valid element index, and happens to be the very index the sort
 * drops (see "the root is never emitted" below). Every expectation here would
 * pass for the wrong reason without this.
 */
function sortDemo(words: string[], mapSetup: string[], type: number): number[] {
  const n = words.length
  const amos = type !== 0
  const src = [
    'Reserve As Work 1,256', // MAP
    `Reserve As Work 2,${n * 16 + 32}`, // the strings
    `Reserve As Work 3,${n * 4 + 16}`, // SRC, the address list
    `Reserve As Work 4,${n * 4 + 16}`, // DEST
    `Reserve As Work 5,${(n + 3) * 16}`, // WORK, exactly the documented size
    `For I=0 To ${n - 1} : Loke Start(4)+I*4,-1 : Next I`,
    ...mapSetup,
    ...words.flatMap((w, i) =>
      amos ? amosStr(2, i * 16, w) : dosStr(2, i * 16, w),
    ),
    ...words.map((_, i) => `Loke Start(3)+${i * 4},Start(2)+${i * 16}`),
    `Jvp Bin Sort Type ${type}`,
    `Jvp Bin Sort Start(3),${n},Start(1) to Start(4),Start(5)`,
    `For I=0 To ${n - 1} : Print Leek(Start(4)+I*4) : Next I`,
  ].join('\n')
  return run(src).out.trim().split('\n').map((s) => parseInt(s.trim(), 10))
}

describe('Jvp Version', () => {
  it('is 101 — the version number times 100', () => {
    // `moveq #$65,d3` in the binary at $942; `Verz equ 101` at source:23
    expect(val('Jvp Version')).toBe('101')
  })
})

describe('Jvp Bin Sort over DOS strings', () => {
  it('returns the ORIGINAL INDEX of each string in sorted order', () => {
    // "you won't get any adresses or strings back, but an index-number that
    // shows where the string should be placed" — used as T$(n(nr)).
    // The trailing -1 is the dropped root; "pear" is this list's maximum.
    expect(sortDemo(['pear', 'apple', 'cherry'], IDENTITY_MAP, 0)).toEqual([1, 2, -1])
    // with the root NOT the maximum, every index comes back
    expect(sortDemo(['pear', 'apple', 'zebra'], IDENTITY_MAP, 0)).toEqual([1, 0, 2])
  })

  it('sorts a list that is already in order, and one in reverse', () => {
    // both exercise the running minimum/maximum shortcuts (SO_L1, SO_L2)
    // rather than the tree walk
    expect(sortDemo(['a', 'b', 'c', 'd'], IDENTITY_MAP, 0)).toEqual([0, 1, 2, 3])
    expect(sortDemo(['d', 'c', 'b', 'a'], IDENTITY_MAP, 0)).toEqual([3, 2, 1, -1])
  })

  it('the root is never emitted when it is the list maximum', () => {
    // A defect of the library's, confirmed in the shipped binary at $3e2:
    // the read-out ends on `move.l (a4,d1.w),d1 / asr.l #2,d2 / cmp.l #0,d2`
    // followed by tests of foer[0] and efter[0] ONLY. Coming back to the root
    // with both its links cleared exits, without ever testing skrevet[0] — so
    // element 0 is emitted only by the branch that descends into a RIGHT
    // child it does not have. DEST is left one entry short, and the entry is
    // always the last one, since a maximum sorts last.
    //
    // It hides on a real machine because DEST is usually a freshly reserved
    // bank or an integer array, both of which are zero, and the missing value
    // is index 0 — so the last row of a sorted listing quietly shows the
    // first record instead of the right one.
    expect(sortDemo(['z', 'a', 'm'], IDENTITY_MAP, 0)).toEqual([1, 2, -1])
    expect(sortDemo(['b', 'a'], IDENTITY_MAP, 0)).toEqual([1, -1])
  })

  it('handles a list needing the tree walk on both sides', () => {
    expect(sortDemo(['m', 'c', 'x', 'a', 'e', 'z', 'p'], IDENTITY_MAP, 0)).toEqual([
      3, 1, 4, 0, 6, 2, 5,
    ])
  })

  it('a control character ends a DOS string — Chr$(0), 10 or 13 all do', () => {
    // "Normaly you should use Chr$(0) for standard DOS format, but eg. code
    // 10 or 13 would do just fine"
    const src = [
      'Reserve As Work 1,256',
      'Reserve As Work 2,64',
      'Reserve As Work 3,16',
      'Reserve As Work 4,16',
      'Reserve As Work 5,80',
      ...IDENTITY_MAP,
      ...poke(2, 0, [...chars('bb'), 13]),
      ...poke(2, 16, [...chars('aa'), 10]),
      'Loke Start(3),Start(2)',
      'Loke Start(3)+4,Start(2)+16',
      'Loke Start(4),-1 : Loke Start(4)+4,-1',
      'Jvp Bin Sort Start(3),2,Start(1) to Start(4),Start(5)',
      'Print Leek(Start(4)) : Print Leek(Start(4)+4)',
    ].join('\n')
    // "aa" first, and "bb" dropped as the maximum-that-is-also-the-root
    expect(run(src).out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '-1'])
  })
})

describe('the MAP is what makes the sort customisable', () => {
  it('folding a to A makes the comparison case-insensitive', () => {
    // "put asc('A') at asc('a') would equel these characters"
    const fold = [...IDENTITY_MAP, 'For I=97 To 122 : Poke Start(1)+I,I-32 : Next I']
    expect(sortDemo(['Banana', 'apple', 'Cherry'], fold, 0)).toEqual([1, 0, 2])
    // and without it the capitals sort first, because ASCII says so
    expect(sortDemo(['Banana', 'apple', 'Cherry'], IDENTITY_MAP, 0)).toEqual([0, 2, 1])
  })

  it('an inverted map sorts backwards — "or even backwood sorting"', () => {
    const backwards = ['For I=0 To 255 : Poke Start(1)+I,255-I : Next I']
    // "a" maps highest now, so it is the maximum and the root, and drops
    expect(sortDemo(['a', 'b', 'c'], backwards, 0)).toEqual([2, 1, -1])
    expect(sortDemo(['c', 'b', 'a'], backwards, 0)).toEqual([0, 1, 2])
  })
})

describe('Jvp Bin Sort over AMOS strings', () => {
  it('reads the length word, so the address is Varptr(n$)-2', () => {
    expect(sortDemo(['pear', 'apple', 'cherry'], IDENTITY_MAP, 1)).toEqual([1, 2, -1])
    expect(sortDemo(['pear', 'apple', 'zebra'], IDENTITY_MAP, 1)).toEqual([1, 0, 2])
  })

  it('Varptr(n$)-2 is what a program actually passes', () => {
    // "if you want to create your list with Varptr calls, then you should use
    // adress=Varptr(n$)-2, that should take care of it"
    const src = [
      'Reserve As Work 1,256',
      'Reserve As Work 3,32',
      'Reserve As Work 4,32',
      'Reserve As Work 5,96',
      ...IDENTITY_MAP,
      'A$="moose" : B$="ant" : C$="zebra"',
      'Loke Start(3),Varptr(A$)-2',
      'Loke Start(3)+4,Varptr(B$)-2',
      'Loke Start(3)+8,Varptr(C$)-2',
      'For I=0 To 2 : Loke Start(4)+I*4,-1 : Next I',
      'Jvp Bin Sort Type 1',
      'Jvp Bin Sort Start(3),3,Start(1) to Start(4),Start(5)',
      'For I=0 To 2 : Print Leek(Start(4)+I*4) : Next I',
    ].join('\n')
    expect(run(src).out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '0', '2'])
  })

  it('an embedded control character is DATA here, not a terminator', () => {
    // the length word governs, which is the "little twist" the doc mentions
    const src = [
      'Reserve As Work 1,256',
      'Reserve As Work 2,64',
      'Reserve As Work 3,16',
      'Reserve As Work 4,16',
      'Reserve As Work 5,80',
      ...IDENTITY_MAP,
      'Doke Start(2),3',
      ...poke(2, 2, [chars('a')[0]!, 0, chars('z')[0]!]),
      'Doke Start(2)+16,3',
      ...poke(2, 18, chars('aaa')),
      'Loke Start(3),Start(2)',
      'Loke Start(3)+4,Start(2)+16',
      'Jvp Bin Sort Type 1',
      'Jvp Bin Sort Start(3),2,Start(1) to Start(4),Start(5)',
      'Print Leek(Start(4)) : Print Leek(Start(4)+4)',
    ].join('\n')
    // "a\0z" against "aaa": the second characters decide, 0 < 97
    expect(run(src).out.trim().split('\n').map((s) => s.trim())).toEqual(['0', '1'])
  })
})

describe('Jvp Bin Sort: the workspace', () => {
  it('the type defaults to 0, DOS strings', () => {
    // "Jvp Bin Sort Type are set to 0 (Dos-strings)" at Default/Run
    expect(run('Print 1').rt.jvp.sortType).toBe(0)
  })

  it('everything in the work area is ERASED', () => {
    const src = [
      'Reserve As Work 1,256',
      'Reserve As Work 2,64',
      'Reserve As Work 3,16',
      'Reserve As Work 4,16',
      'Reserve As Work 5,80',
      ...IDENTITY_MAP,
      'For I=0 To 79 : Poke Start(5)+I,255 : Next I',
      ...dosStr(2, 0, 'b'),
      ...dosStr(2, 16, 'a'),
      'Loke Start(3),Start(2) : Loke Start(3)+4,Start(2)+16',
      'Jvp Bin Sort Start(3),2,Start(1) to Start(4),Start(5)',
      // four parallel arrays of ANT longwords: foer, efter, hoved, skrevet.
      // Every byte of the 255s is gone — the routine fills all four with -1
      // before it starts, then the traversal clears each link it follows.
      'Print Leek(Start(5))', // foer[0], set to 4 by the insert, cleared again
      'Print Leek(Start(5)+8)', // efter[0], never used: "b" has no right child
      'Print Leek(Start(5)+28)', // skrevet[1], marked as it was emitted
    ].join('\n')
    expect(lines(src).slice(0, 3).map((s) => s.trim())).toEqual(['-1', '-1', '1'])
  })
})

describe('Jvp Str$ combines DOS strings at addresses', () => {
  const strDemo = (setup: string[], expr: string): string =>
    run([`Reserve As Work 2,256`, ...setup, `Print "[";${expr};"]"`].join('\n')).out.trim()

  it('pads each field to its length and separates with a space', () => {
    // "All lengths defaults to 20", "All Seperators defaults to ' '"
    expect(
      strDemo(
        [...dosStr(2, 0, 'ab'), ...dosStr(2, 16, 'cd'), 'Jvp Set Str Len 4,4,0,0,0,0'],
        'Jvp Str$(Start(2),Start(2)+16,0,0,0,0)',
      ),
    ).toBe('[ab   cd   ]')
  })

  it('truncates a source longer than its field', () => {
    expect(
      strDemo(
        [...dosStr(2, 0, 'abcdefgh'), 'Jvp Set Str Len 3,0,0,0,0,0', 'Jvp Set Str Sep 0'],
        'Jvp Str$(Start(2),0,0,0,0,0)',
      ),
    ).toBe('[abc]')
  })

  it('a length of 0 drops the field AND its separator', () => {
    expect(
      strDemo(
        [...dosStr(2, 0, 'xy'), 'Jvp Set Str Len 0,2,0,0,0,0'],
        'Jvp Str$(Start(2),Start(2),0,0,0,0)',
      ),
    ).toBe('[xy ]')
  })

  it('a separator of 0 emits nothing between fields', () => {
    expect(
      strDemo(
        [...dosStr(2, 0, 'ab'), 'Jvp Set Str Len 2,2,0,0,0,0', 'Jvp Set Str Sep 0,45,0,0,0,0'],
        'Jvp Str$(Start(2),Start(2),0,0,0,0)',
      ),
    ).toBe('[abab-]')
  })

  it('a null address leaves the field blank but still laid out', () => {
    // `cmpa.l #$0,a3 / beq` at $5fa
    expect(
      strDemo(
        [...dosStr(2, 0, 'zz'), 'Jvp Set Str Len 2,2,0,0,0,0', 'Jvp Set Str Sep 0'],
        'Jvp Str$(0,Start(2),0,0,0,0)',
      ),
    ).toBe('[  zz]')
  })

  it("writes one character past a field it overflows — the library's own bug", () => {
    // `addq.w #1,d7 / cmp.w StrLen(a1,d1),d7 / ble` continues while d7 still
    // EQUALS the width, so a source longer than its field spills one byte
    // into the next. With no separator to overwrite it and an empty field
    // after it, the spill shows: "ABC   " is what the lengths promise.
    expect(
      strDemo(
        [...dosStr(2, 0, 'ABCDEF'), ...dosStr(2, 16, ''), 'Jvp Set Str Len 3,3,0,0,0,0', 'Jvp Set Str Sep 0'],
        'Jvp Str$(Start(2),Start(2)+16,0,0,0,0)',
      ),
    ).toBe('[ABCD  ]')
  })

  it('and the separator hides it when there is one', () => {
    expect(
      strDemo(
        [...dosStr(2, 0, 'ABCDEF'), ...dosStr(2, 16, ''), 'Jvp Set Str Len 3,3,0,0,0,0', 'Jvp Set Str Sep 45'],
        'Jvp Str$(Start(2),Start(2)+16,0,0,0,0)',
      ),
    ).toBe('[ABC-   -]')
  })
})

describe('Jvp Cstr$ combines AMOS strings', () => {
  const c = (setup: string[], expr: string): string =>
    run([...setup, `Print "[";${expr};"]"`].join('\n')).out.trim()

  it('formats the same way, from string values', () => {
    expect(c(['Jvp Set Str Len 4,4,0,0,0,0'], 'Jvp Cstr$("ab","cd","","","","")')).toBe(
      '[ab   cd   ]',
    )
  })

  it('truncates, pads and honours the separators', () => {
    expect(
      c(
        ['Jvp Set Str Len 3,5,0,0,0,0', 'Jvp Set Str Sep 44,0,0,0,0,0'],
        'Jvp Cstr$("abcdef","gh","","","","")',
      ),
    ).toBe('[abc,gh   ]')
  })

  it('a control character inside the string is copied, not treated as an end', () => {
    // "These strings are standard AMOS strings, and do NOT need to be
    // terminated by anything special"
    const out = run(
      ['Jvp Set Str Len 3,0,0,0,0,0', 'Jvp Set Str Sep 0', 'A$="a"+Chr$(9)+"b"', 'Print Len(Jvp Cstr$(A$,"","","","",""))'].join('\n'),
    ).out.trim()
    expect(out).toBe('3')
  })

  it('an empty string is all padding', () => {
    expect(c(['Jvp Set Str Len 3,0,0,0,0,0', 'Jvp Set Str Sep 0'], 'Jvp Cstr$("","","","","","")')).toBe(
      '[   ]',
    )
  })
})

describe('Jvp Set Str Len / Jvp Set Str Sep', () => {
  it('both default the way Default/Run leaves them', () => {
    const { rt } = run('Print 1')
    expect(rt.jvp.strLen).toEqual([20, 20, 20, 20, 20, 20])
    expect(rt.jvp.strSep).toEqual([32, 32, 32, 32, 32, 32])
  })

  it('Set Str Len takes six, in the order they are written', () => {
    expect(run('Jvp Set Str Len 1,2,3,4,5,6').rt.jvp.strLen).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('Set Str Sep has three forms sharing one name', () => {
    // routines 4, 5 and 6: none, one, six
    expect(run('Jvp Set Str Sep 1,2,3,4,5,6').rt.jvp.strSep).toEqual([1, 2, 3, 4, 5, 6])
    expect(run('Jvp Set Str Sep 45').rt.jvp.strSep).toEqual([45, 45, 45, 45, 45, 45])
    expect(run('Jvp Set Str Sep 45\nJvp Set Str Sep').rt.jvp.strSep).toEqual([32, 32, 32, 32, 32, 32])
  })

  it('the no-argument form works mid-line too', () => {
    expect(run('Jvp Set Str Sep 45 : Jvp Set Str Sep : Print 1').rt.jvp.strSep[0]).toBe(32)
  })
})

/**
 * A message bank, built by hand to the doc's structure diagram. Every pointer
 * is relative to the bank start and every structure begins at an even
 * address, both of which the doc states outright.
 */
const MSG_BANK = [
  'Reserve As Work 6,200',
  ...poke(6, 0, chars('MSGB')),
  'Loke Start(6)+4,100', // -> the title
  'Loke Start(6)+8,20', // -> the group list, "Normaly 20/$14"
  'Loke Start(6)+12,0',
  'Loke Start(6)+16,0',
  'Doke Start(6)+20,1', // last group is 1: groups 0 and 1 exist
  'Loke Start(6)+22,40',
  'Loke Start(6)+26,60',
  'Doke Start(6)+40,0', // group 0: one subgroup
  'Loke Start(6)+42,80',
  'Doke Start(6)+60,0', // group 1: one subgroup
  'Loke Start(6)+62,120',
  'Doke Start(6)+80,1', // subgroup 0/0: items 0 and 1
  'Loke Start(6)+82,140',
  'Loke Start(6)+86,160',
  'Doke Start(6)+120,0', // subgroup 1/0: item 0 exists but has no string
  'Loke Start(6)+122,0',
  ...amosStr(6, 100, 'Title'),
  ...amosStr(6, 140, 'Hello'),
  ...amosStr(6, 160, 'World!'),
  'Jvp Set Msg Bank 6',
]

describe('the message bank', () => {
  it('Jvp Msg$(G,SG,IT) returns the message at those coordinates', () => {
    expect(lines([...MSG_BANK, 'Print Jvp Msg$(0,0,0)', 'Print Jvp Msg$(0,0,1)'])).toEqual([
      'Hello',
      'World!',
      '',
    ])
  })

  it('Jvp Msg$ with no arguments is the bank title', () => {
    // "Returns the special Tittle field of the bank"
    expect(run([...MSG_BANK, 'Print Jvp Msg$'].join('\n')).out.trim()).toBe('Title')
  })

  it('Jvp Msg Exists points at the string structure when there is one', () => {
    const out = run([...MSG_BANK, 'Print Jvp Msg Exists(0,0,0)>0'].join('\n')).out.trim()
    expect(out).toBe('-1') // true
  })

  it('and reports which coordinate was out of range', () => {
    // -1 group, -2 subgroup, -3 item (source:920-927), the opposite way round
    // from the order the doc lists them in
    const out = lines([
      ...MSG_BANK,
      'Print Jvp Msg Exists(2,0,0)',
      'Print Jvp Msg Exists(0,1,0)',
      'Print Jvp Msg Exists(0,0,2)',
      'Print Jvp Msg Exists(1,0,0)',
    ])
    expect(out.slice(0, 4).map((s) => s.trim())).toEqual(['-1', '-2', '-3', '0'])
  })

  it('an undefined or out-of-range message is the empty string', () => {
    // `cmp.l a0,a1 / bgt` turns every one of those into 0 before RetStr
    const out = lines([
      ...MSG_BANK,
      'Print "[";Jvp Msg$(1,0,0);"]"',
      'Print "[";Jvp Msg$(9,9,9);"]"',
    ])
    expect(out.slice(0, 2).map((s) => s.trim())).toEqual(['[]', '[]'])
  })

  it('Jvp Msg Bank is the bank number, and 0 when none is set', () => {
    expect(run([...MSG_BANK, 'Print Jvp Msg Bank'].join('\n')).out.trim()).toBe('6')
    expect(val('Jvp Msg Bank')).toBe('0')
  })

  it('a bank not starting "MSGB" is refused', () => {
    expect(() => run('Reserve As Work 6,64\nJvp Set Msg Bank 6')).toThrow(/Not a Message bank/)
  })

  it('and so is any Msg keyword before a bank has been set', () => {
    // "If you havn't set a correct Bank then an error will be reported"
    expect(() => run('Print Jvp Msg$')).toThrow(/Not a Message bank/)
    expect(() => run('Print Jvp Msg Exists(0,0,0)')).toThrow(/Not a Message bank/)
  })
})

describe('every JVP keyword is dispatched', () => {
  it('all eleven run', () => {
    const def = extensionById('jvp-1.01')!
    const names = def.tokens.map((t) => t.name.replace(/^!/, '').trim()).filter(Boolean)
    expect(names.length).toBe(11)
    const calls: Record<string, string> = {
      'jvp bin sort': 'Reserve As Work 1,256\nReserve As Work 3,16\nReserve As Work 4,16\nReserve As Work 5,80\nJvp Bin Sort Start(3),2,Start(1) to Start(4),Start(5)',
      'jvp bin sort type': 'Jvp Bin Sort Type 1',
      'jvp set str len': 'Jvp Set Str Len 1,2,3,4,5,6',
      'jvp set str sep': 'Jvp Set Str Sep',
      'jvp str$': 'Print Jvp Str$(0,0,0,0,0,0)',
      'jvp cstr$': 'Print Jvp Cstr$("","","","","","")',
      'jvp version': 'Print Jvp Version',
      'jvp set msg bank': [...MSG_BANK].join('\n'),
      'jvp msg bank': 'Print Jvp Msg Bank',
      'jvp msg exists': [...MSG_BANK, 'Print Jvp Msg Exists(0,0,0)'].join('\n'),
      'jvp msg$': [...MSG_BANK, 'Print Jvp Msg$'].join('\n'),
    }
    for (const n of names) {
      expect(calls[n], `no call written for ${n}`).toBeDefined()
      expect(() => run(calls[n]!), n).not.toThrow()
    }
  })
})
