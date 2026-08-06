import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { PARAMETRIC_NAMES, jdPrt11Aliases } from './jdprt'
import { makeAllFunctions } from './instr'
import { FAITHFUL } from '../coverage/status'

const table = new TokenTable(CORE_TOKENS)
/** slot 21, from the library's own source: `ExtNb equ 21-1` */
const prt = extensionById('jd-prt-1.4')!
const prt13 = extensionById('jd-prt-1.3')!

function runWith(def: typeof prt, src: string): { rt: Runtime; out: string } {
  let out = ''
  const exts = new Map([[21, def.table]])
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[21, def]]),
    maxSteps: 2_000_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  mustFinish(r)
  return { rt, out }
}
const run = (src: string): { rt: Runtime; out: string } => runWith(prt, src)
/** the string a keyword RETURNS — these are functions, not instructions */
const seq = (expr: string, def = prt): string => runWith(def, `Print ${expr}`).out.replace(/\n$/, '')

const ESC = '\x1b'
const CSI = `${ESC}[`

describe('JD Prt: the keywords are string functions', () => {
  /**
   * The whole shape of the library. The token table declares every one of the
   * sequence keywords "2" — a string function with no arguments — and routine
   * 3 (get_str, +prt.s:445) copies a fixed string out of the data area.
   * Nothing is sent anywhere; the program decides where the sequence goes,
   * usually through Lprint.
   */
  it('every sequence keyword is a function, not an instruction', () => {
    const sequenceKeywords = prt.tokens
      .map((t) => t.name.replace(/^!/, '').trim())
      .filter((n) => n && !PARAMETRIC_NAMES.includes(n))
    expect(sequenceKeywords.length).toBe(64)
    for (const n of sequenceKeywords) {
      const t = prt.tokens.find((x) => x.name.replace(/^!/, '').trim() === n)!
      expect(t.spec, n).toBe('2')
      expect(t.instr, n).toBe(0xffff)
    }
  })

  it('the value can be printed, concatenated and measured', () => {
    expect(seq('Jd Prt Bold')).toBe(`${CSI}1m`)
    expect(seq('Len(Jd Prt Bold)').trim()).toBe('4')
    expect(seq('Jd Prt Bold+"x"+Jd Prt Bold Off')).toBe(`${CSI}1mx${CSI}22m`)
  })

  it('nothing reaches the printer stream — these keywords do not send', () => {
    const { rt } = run('A$=Jd Prt Bold+Jd Prt Reset')
    expect(rt.ioports.printerOut).toEqual([])
  })

  it('CSI is the two-byte ESC [ here, not the single byte $9B', () => {
    const s = seq('Jd Prt Italics')
    expect([...s].map((c) => c.charCodeAt(0))).toEqual([0x1b, 0x5b, 0x33, 0x6d])
  })
})

describe('JD Prt: the sequences, out of the data area (+prt.s:206-438)', () => {
  it('reset and init', () => {
    expect(seq('Jd Prt Reset')).toBe(`${ESC}c`)
    expect(seq('Jd Prt Init')).toBe(`${ESC}1`)
  })

  it('the style pairs are SGR', () => {
    expect(seq('Jd Prt Italics')).toBe(`${CSI}3m`)
    expect(seq('Jd Prt Italics Off')).toBe(`${CSI}23m`)
    expect(seq('Jd Prt Under')).toBe(`${CSI}4m`)
    expect(seq('Jd Prt Under Off')).toBe(`${CSI}24m`)
    expect(seq('Jd Prt Bold Off')).toBe(`${CSI}22m`)
  })

  it('super and subscript are CSI nv, each with its OWN off', () => {
    expect(seq('Jd Prt Super')).toBe(`${CSI}2v`)
    expect(seq('Jd Prt Super Off')).toBe(`${CSI}1v`)
    expect(seq('Jd Prt Sub')).toBe(`${CSI}4v`)
    expect(seq('Jd Prt Sub Off')).toBe(`${CSI}3v`)
  })

  it('pitch is CSI nw and quality CSI n"z', () => {
    expect(seq('Jd Prt Elite')).toBe(`${CSI}2w`)
    expect(seq('Jd Prt Fine')).toBe(`${CSI}4w`)
    expect(seq('Jd Prt Enlarged')).toBe(`${CSI}6w`)
    expect(seq('Jd Prt Nlq')).toBe(`${CSI}2"z`)
    expect(seq('Jd Prt Shadow')).toBe(`${CSI}6"z`)
  })

  it('the margins and tabs take no argument — they set AT the position', () => {
    expect(seq('Jd Prt Set Lmargin')).toBe(`${ESC}#9`)
    expect(seq('Jd Prt Set Rmargin')).toBe(`${ESC}#0`)
    expect(seq('Jd Prt Set Htab')).toBe(`${ESC}H`)
    expect(seq('Jd Prt Clr Htabs')).toBe(`${CSI}3g`)
    expect(seq('Jd Prt Set Def Tabs')).toBe(`${ESC}#5`)
  })

  it("1.4's six additions, read out of its binary", () => {
    expect(seq('Jd Prt Lf')).toBe(`${ESC}E`)
    expect(seq('Jd Prt Reverse Lf')).toBe(`${ESC}M`)
    expect(seq('Jd Prt Ff')).toBe('\f')
    // doubleunder emits the doublestrike bytes and borders off the clr
    // margins bytes -- the author's duplication, kept
    expect(seq('Jd Prt Doubleunder')).toBe(seq('Jd Prt Double'))
    expect(seq('Jd Prt Borders Off')).toBe(seq('Jd Prt Clr Margins'))
  })
})

describe('JD Prt: the character sets identify the set', () => {
  /**
   * The sequences are ISO designators, and the KEYWORD ORDER is
   * printer.device's own character-set numbering 1 to 11 — including the
   * split of Danish into I and II at the two ends, which nothing would
   * reproduce by accident.
   */
  const ORDER = [
    ['us', 'B'],
    ['french', 'R'],
    ['german', 'K'],
    ['uk', 'A'],
    ['danishi', 'E'],
    ['sweden', 'H'],
    ['italian', 'Y'],
    ['spanish', 'Z'],
    ['japanese', 'J'],
    ['norge', '6'],
    ['danishii', 'C'],
  ] as const

  it('each is ESC ( followed by its designator', () => {
    for (const [name, d] of ORDER) expect(seq(`Jd Prt Set ${name}`)).toBe(`${ESC}(${d}`)
  })

  it('the token table carries them in printer.device order', () => {
    const names = prt.tokens
      .map((t) => t.name.replace(/^!/, '').trim())
      .filter((n) => n.startsWith('jd prt set ') && !n.includes('tab') && !n.includes('margin'))
    expect(names).toEqual(ORDER.map(([n]) => `jd prt set ${n}`))
  })
})

describe('JD Prt: 1.3 and 1.4 disagree on exactly two sequences', () => {
  it('Center is [2 F in 1.3 and [3 F in 1.4', () => {
    expect(seq('Jd Prt Center', prt13)).toBe(`${CSI}2 F`)
    expect(seq('Jd Prt Center', prt)).toBe(`${CSI}3 F`)
  })

  it('Pline Up is ESC L in 1.3 and ESC I in 1.4', () => {
    expect(seq('Jd Prt Pline Up', prt13)).toBe(`${ESC}L`)
    expect(seq('Jd Prt Pline Up', prt)).toBe(`${ESC}I`)
  })

  it('everything else agrees', () => {
    const shared = prt13.tokens
      .map((t) => t.name.replace(/^!/, '').trim())
      .filter((n) => n && !PARAMETRIC_NAMES.includes(n))
      .filter((n) => n !== 'jd prt center' && n !== 'jd prt pline up')
    expect(shared.length).toBe(56)
    for (const n of shared) {
      const call = `Jd Prt ${n.slice('jd prt '.length)}`
      expect(seq(call, prt13), n).toBe(seq(call, prt))
    }
  })
})

describe('JD Prt: the five Preferences instructions', () => {
  /**
   * Not sequences at all: GetPrefs, poke one field, SetPrefs (+prt.s:803 and
   * above). They configure the graphics dump a later Printer Dump performs.
   */
  it('each sets its Preferences field and sends nothing', () => {
    const { rt } = run(
      ['Jd Prt Aspect 1', 'Jd Prt Image 1', 'Jd Prt Threshold 9', 'Jd Prt Density 4'].join('\n'),
    )
    expect(rt.ioports.printerOut).toEqual([])
    const p = rt.ioports.printerPrefs
    expect([p.aspect, p.image, p.threshold, p.density]).toEqual([1, 1, 9, 4])
  })

  it('Shade 3 is the odd one: grey scale 2, stored as shade 1', () => {
    const p = run('Jd Prt Shade 3').rt.ioports.printerPrefs
    expect([p.shade, p.greyScale2]).toEqual([1, true])
    const q = run('Jd Prt Shade 3\nJd Prt Shade 2').rt.ioports.printerPrefs
    expect([q.shade, q.greyScale2]).toEqual([2, false])
  })

  it("every bound is the routine's own, and each is error 23", () => {
    for (const bad of [
      'Jd Prt Shade -1',
      'Jd Prt Shade 4',
      'Jd Prt Aspect 2',
      'Jd Prt Image 2',
      'Jd Prt Threshold 0',
      'Jd Prt Threshold 16',
      'Jd Prt Density 0',
      'Jd Prt Density 8',
    ]) {
      expect(() => run(bad), bad).toThrow(/illegal function call/)
    }
    expect(() => run('Jd Prt Shade 0\nJd Prt Threshold 15\nJd Prt Density 7')).not.toThrow()
  })
})

describe('JD Prt: every keyword is dispatched', () => {
  it('all 69 of 1.4 and all 63 of 1.3 run', () => {
    for (const def of [prt, prt13]) {
      const names = def.tokens.map((t) => t.name.replace(/^!/, '').trim()).filter(Boolean)
      expect(names.length).toBe(def === prt ? 69 : 63)
      for (const n of names) {
        const tail = n.slice('jd prt '.length)
        const src = PARAMETRIC_NAMES.includes(n) ? `Jd Prt ${tail} 1` : `Print Jd Prt ${tail}`
        expect(() => runWith(def, src), n).not.toThrow()
      }
    }
  })
})

/**
 * 1.1 through the alias mechanism.
 *
 * The release renamed all 58 keywords by adding a `Jd ` prefix, so before
 * `aliases` existed a 1.1 program reached no handler at all — silently, since
 * an unimplemented function returns a type-correct default rather than
 * erroring. These tests are the difference between that and working.
 */
describe('JD Prt 1.1: the release that spells everything differently', () => {
  const prt11 = extensionById('jd-prt-1.1')!

  it('answers for 1.1\'s unprefixed names', () => {
    expect(seq('Prt Bold', prt11)).toBe(`${CSI}1m`)
    expect(seq('Prt Under', prt11)).toBe(`${CSI}4m`)
    expect(seq('Prt Reset', prt11)).toBe(`${ESC}c`)
  })

  it('gives 1.1 the same bytes 1.3 gives, for all 58 keywords', () => {
    // The two binaries carry the same 58 distinct sequences and differ in one
    // byte string only, the keyword name itself (+prt.s:206-438 is the 1.3
    // data area; 1.1's is byte-identical below the names). The port must not
    // let the rename change an answer.
    //
    // EVERY alias, not a sample. Four were spot-checked here when the 58 were
    // promoted to FAITHFUL, and the release gate caught what that left: a
    // keyword classified faithful that no test ever dispatches is a claim
    // resting on the alias map being right rather than on the keyword
    // answering. Running all of them is also the cheapest proof of the port's
    // central assertion about this library, so it is the right test regardless
    // of the gate.
    const aliases = jdPrt11Aliases()
    expect(Object.keys(aliases).length).toBe(58)
    for (const [alias, canonical] of Object.entries(aliases)) {
      const got = seq(alias, prt11)
      expect(got, alias).toBe(seq(canonical, prt13))
      // and it is a real sequence rather than the empty string an
      // unimplemented function would hand back
      expect(got.length, alias).toBeGreaterThan(0)
    }
  })

  it('puts 1.1 on the pre-1.4 side of the two changed sequences', () => {
    // 1.4 alone altered these; a 1.1 program must not get 1.4's bytes
    expect(seq('Prt Center', prt11)).toBe(seq('Jd Prt Center', prt13))
    expect(seq('Prt Pline Up', prt11)).toBe(seq('Jd Prt Pline Up', prt13))
    expect(seq('Prt Center', prt11)).not.toBe(seq('Jd Prt Center', prt))
  })

  it('does not answer for the five keywords 1.3 added', () => {
    // Shade/Aspect/Image/Threshold/Density are instructions 1.1 never had, so
    // there is no alias for them and nothing should invent one
    const aliases = jdPrt11Aliases()
    for (const n of ['jd prt shade', 'jd prt aspect', 'jd prt image']) {
      expect(Object.values(aliases), n).not.toContain(n)
    }
  })

  it('the alias map matches the registered 1.1 table exactly', () => {
    // the map is derived by rule rather than transcribed; this pins the rule
    const aliases = jdPrt11Aliases()
    const names = prt11.tokens
      .map((t) => t.name.replace(/^!/, '').trim().toLowerCase())
      .filter((n) => n !== '')
    expect(Object.keys(aliases).sort()).toEqual([...new Set(names)].sort())
    for (const [alias, canonical] of Object.entries(aliases)) {
      expect(canonical, alias).toBe(`jd ${alias}`)
      expect(alias.startsWith('jd '), alias).toBe(false)
    }
  })

  it('every 1.1 name is FAITHFUL, exactly as its 1.3 counterpart is', () => {
    // status.ts carries the 58 as a literal list, which it has to -- it is
    // pure data with no imports. This pins that list against the rule the port
    // derives from, so the two cannot drift: a name added to the 1.1 table
    // without a matching FAITHFUL entry fails here rather than quietly
    // reporting an approximation the port does not have.
    for (const [alias, canonical] of Object.entries(jdPrt11Aliases())) {
      expect(FAITHFUL.has(canonical), canonical).toBe(true)
      expect(FAITHFUL.has(alias), alias).toBe(true)
    }
  })

  it('aliases are slot-bound, not global', () => {
    // `prt bold` must not become a plain name every layer can see: it belongs
    // to Prt 1.1 at the slot Prt 1.1 occupies
    const { rt } = runWith(prt11, 'Rem')
    const all = makeAllFunctions(rt)
    expect('ext21:prt bold' in all).toBe(true)
    expect('prt bold' in all).toBe(false)
  })

  it('a 1.4 program does not inherit 1.1\'s spelling', () => {
    const { rt } = runWith(prt, 'Rem')
    const all = makeAllFunctions(rt)
    expect('ext21:prt bold' in all).toBe(false)
    expect('jd prt bold' in all).toBe(true)
  })
})
