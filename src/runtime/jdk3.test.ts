import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'

/**
 * JD-K3 1.1, against `AMOSPro_JDK3.Lib.MANUAL`. Six keywords at slot 19 —
 * the slot Andrew Burton's extension list gives it, and the one the corpus
 * shows.
 */
const table = new TokenTable(CORE_TOKENS)
const K3_SLOT = 19
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [K3_SLOT, extensionById('jd-k3-1.1')!.table] as const,
])

function run(src: string): { out: string; rt: Runtime; fs: AmigaFS } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.mountMemory('WORK')
  fs.currentDir = 'DH0:'
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 500_000,
    extensions,
    fs,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt, fs }
}
const val = (expr: string): string => run(`Print ${expr}`).out.trim()

describe('Jd Match — the AmigaDOS pattern syntax the manual lists', () => {
  it('the pattern is the FIRST argument and the string the second', () => {
    // "Vergleich, ob Pattern auf den String passt / 0=nein / 1=ja"
    expect(val('Jd Match("Test#?","Test-String")')).toBe('1')
    expect(val('Jd Match("Test-String","Test#?")')).toBe('0')
  })

  it('? is one character and #? is any run', () => {
    expect(val('Jd Match("?est","Test")')).toBe('1')
    expect(val('Jd Match("?est","Tests")')).toBe('0')
    expect(val('Jd Match("#?","anything at all")')).toBe('1')
  })

  it('(a|b) alternation, ~ negation and [abc] classes', () => {
    expect(val('Jd Match("(foo|bar)","bar")')).toBe('1')
    expect(val('Jd Match("(foo|bar)","baz")')).toBe('0')
    expect(val('Jd Match("~(foo)","bar")')).toBe('1')
    expect(val('Jd Match("~(foo)","foo")')).toBe('0')
    expect(val('Jd Match("[abc]","b")')).toBe('1')
    expect(val('Jd Match("[~abc]","d")')).toBe('1')
  })

  it('a-z ranges inside a class, and % matching nothing', () => {
    expect(val('Jd Match("[a-z]","q")')).toBe('1')
    expect(val('Jd Match("[a-z]","Q")')).toBe('0')
    expect(val('Jd Match("(foo|bar|%)","")')).toBe('1')
  })

  it('the comparison is case SENSITIVE without Nocase', () => {
    expect(val('Jd Match("test","Test")')).toBe('0')
    expect(val('Jd Match Nocase("test","Test")')).toBe('1')
    expect(val('Jd Match Nocase("TEST#?","test-string")')).toBe('1')
  })
})

describe('Jd Star Joker turns * into a wildcard', () => {
  it('* is NOT a wildcard by default', () => {
    // "Synonym for '#?', not available by default in 2.0. Available as an
    // option that can be turned on."
    expect(val('Jd Match("*t-S*","Test-String")')).toBe('0')
  })

  it('and is once Jd Star Joker On has run — the manual\'s own example', () => {
    // X=Jd Match Nocase("*t-S*,"Test-String") -> X=1
    const { out } = run('Jd Star Joker On\nPrint Jd Match Nocase("*t-S*","Test-String")')
    expect(out.trim()).toBe('1')
  })

  it('Jd Star Joker Off puts it back', () => {
    const { out, rt } = run(
      [
        'Jd Star Joker On',
        'Print Jd Match("*ring","Test-String")',
        'Jd Star Joker Off',
        'Print Jd Match("*ring","Test-String")',
      ].join('\n'),
    )
    expect(out.trim().split('\n').map((s) => s.trim())).toEqual(['1', '0'])
    expect(rt.jd.starJoker).toBe(false)
  })
})

describe('Jd Relabel renames a volume', () => {
  it('0 is success — the opposite way round from most of AMOS', () => {
    // "Ergebnis : 0=ok / 1=Fehler"
    const { out, fs } = run('Print Jd Relabel("WORK:","BACKUP")')
    expect(out.trim()).toBe('0')
    expect(fs.volumeNames().map((v) => v.toLowerCase())).toContain('backup')
    expect(fs.volumeNames().map((v) => v.toLowerCase())).not.toContain('work')
  })

  it('1 when the volume is not mounted, or the new name is unusable', () => {
    expect(val('Jd Relabel("NOSUCH:","X")')).toBe('1')
    expect(val('Jd Relabel("WORK:","")')).toBe('1')
    expect(val('Jd Relabel("WORK:","bad/name")')).toBe('1')
  })

  it('files under the volume come with it', () => {
    const { fs } = run(
      ['Open Out 1,"WORK:note.txt"', 'Print #1,"hello"', 'Close 1', 'A=Jd Relabel("WORK:","VOL2")'].join(
        '\n',
      ),
    )
    expect(fs.readFile('VOL2:note.txt')).not.toBeNull()
  })
})

describe('Jd Toggle Click', () => {
  it('flips the state each call, and reports nothing', () => {
    // "wechselt Status des Laufwerk-Klickens" — no parameter, no result
    const a = run('Jd Toggle Click').rt.jd.driveClick
    const b = run('Jd Toggle Click\nJd Toggle Click').rt.jd.driveClick
    expect(a).toBe(false) // clicking is on to begin with
    expect(b).toBe(true)
  })
})

describe('every JD-K3 keyword is dispatched', () => {
  it('all six run', () => {
    const def = extensionById('jd-k3-1.1')!
    const names = def.tokens.map((t) => t.name.replace(/^!/, '').trim()).filter(Boolean)
    expect(names.length).toBe(6)
    for (const n of names) {
      const call = n.startsWith('jd match')
        ? `Print ${n.replace(/\b\w/g, (c) => c.toUpperCase())}("a","a")`
        : n === 'jd relabel'
          ? 'Print Jd Relabel("DH0:","DH1")'
          : n.replace(/\b\w/g, (c) => c.toUpperCase())
      expect(() => run(call), n).not.toThrow()
    }
  })
})
