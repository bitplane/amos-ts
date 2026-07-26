import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS } from '../ext/registry'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'

/**
 * LDos, verified against its own manual (LdosV25.DOC). Each test names the
 * manual entry it checks, the way the core tests name the 68k routine.
 *
 * LDos is not a stock extension, so it has no slot in the default config.
 * The tokenizer is given its table under a spare slot, which is exactly the
 * situation a real user created by installing it wherever they liked.
 */
const table = new TokenTable(CORE_TOKENS)
const LDOS_SLOT = 10 // the slot it is observed in across the corpus
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [LDOS_SLOT, extensionById('ldos-2.5')!.table] as const,
])

const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

function run(src: string): { out: string; fs: AmigaFS; rt: Runtime } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 200_000,
    extensions,
    fs,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, fs, rt }
}

describe('LDos file channels (LdosV25.DOC)', () => {
  it('Lopen mode 1 creates and truncates, mode 0 opens an existing file', () => {
    // "MODE either 0 for opening an existing file or 1 for creating a new.
    // WARNING! If the file exist and MODE is 1 the file will be erased."
    const { out, fs } = run(
      [
        'Reserve As Work 10,32',
        'Lopen 1,"DH0:new.dat",1',
        'A=Lsave(1,Start(10),4)',
        'Lclose 1',
        'Print Lsize("DH0:new.dat")',
        'Lopen 2,"DH0:new.dat",1 : Lclose 2', // reopening with MODE 1 erases it
        'Print Lsize("DH0:new.dat")',
      ].join('\n'),
    )
    expect(out).toBe(' 4\n 0\n')
    expect(fs.readFile('DH0:new.dat')).toEqual(new Uint8Array(0))
  })

  it('Lopen mode 0 on a missing file is an error, and channels are 1 to 3', () => {
    expect(() => run('Lopen 1,"DH0:nope",0')).toThrow(/file not found/)
    expect(() => run('Lopen 4,"DH0:x",1')).toThrow(/channel must be 1 to 3/)
  })

  it('Lclose is what commits written bytes to the filesystem', () => {
    // the manual is emphatic that an unclosed file may be lost
    const { fs } = run(
      ['Reserve As Work 10,16', 'Loke Start(10),$41424344', 'Lopen 1,"DH0:w.dat",1', 'A=Lsave(1,Start(10),4)', 'Lclose 1'].join('\n'),
    )
    expect(fs.readFile('DH0:w.dat')).toEqual(enc('ABCD'))
  })

  it('Lload returns the bytes actually read, short at end of file', () => {
    // "If A is less than LENGTH you reached the end of the file ... It is
    // perfectly legal to request more data than the file contains, no error
    // will be produced because of this."
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lopen 1,"DH0:src.dat",1 : Loke Start(10),$41424344 : A=Lsave(1,Start(10),4) : Lclose 1',
        'Lopen 1,"DH0:src.dat",0',
        'Print Lload(1,Start(10),2)', // 2 of 4
        'Print Lload(1,Start(10),100)', // asks for far more than remains
        'Print Lload(1,Start(10),10)', // nothing left
        'Lclose 1',
      ].join('\n'),
    )
    expect(out).toBe(' 2\n 2\n 0\n')
  })

  it('Lload returns -1 when the destination is not a real address', () => {
    // "If A equals to -1, a filerror occurred"
    const { out } = run(
      ['Lopen 1,"DH0:e.dat",1 : Lclose 1', 'Lopen 1,"DH0:e.dat",0', 'Print Lload(1,0,4)', 'Lclose 1'].join('\n'),
    )
    expect(out).toBe('-1\n')
  })

  it('Lseek is absolute from the start, and a negative offset reports position', () => {
    // "Offsets are relative to the BEGINNING of the file ... If POS is <0 no
    // movement will take place, and the current position will be returned."
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lopen 1,"DH0:s.dat",1 : A=Lsave(1,Start(10),20) : Lclose 1',
        'Lopen 1,"DH0:s.dat",0',
        'Print Lseek(1,0)',
        'Print Lseek(1,10)',
        'Print Lseek(1,-1)', // reports, does not move
        'Print Lload(1,Start(10),5)', // so 10 bytes remain of 20
        'Lclose 1',
      ].join('\n'),
    )
    expect(out).toBe(' 0\n 10\n 10\n 5\n')
  })
})

describe('LDos file queries (LdosV25.DOC)', () => {
  it('Lsize returns the file length, and zero for a directory', () => {
    // "it is legal to specify a directory as well. If "FileName" is a
    // directory zero is always returned."
    const src = [
      'Reserve As Work 10,64',
      'Lopen 1,"DH0:sized.dat",1 : A=Lsave(1,Start(10),7) : Lclose 1',
      'Mkdir "DH0:adir"',
      'Print Lsize("DH0:sized.dat")',
      'Print Lsize("DH0:adir")',
    ].join('\n')
    expect(run(src).out).toBe(' 7\n 0\n')
  })

  it('Lfile Type is positive for a directory and negative for a file', () => {
    // "A is greater than 0 if it is a directory, or negative if it is a file"
    const src = [
      'Reserve As Work 10,16',
      'Lopen 1,"DH0:f.dat",1 : Lclose 1',
      'Mkdir "DH0:d"',
      'Print Lfile Type("DH0:d")',
      'Print Lfile Type("DH0:f.dat")',
    ].join('\n')
    expect(run(src).out).toBe(' 1\n-1\n')
  })
})

describe('LDos string handling (LdosV25.DOC)', () => {
  it('Lstr reads up to the terminator, which it does not include', () => {
    // "The end-of-line-terminator is NOT copied into the string, so the new
    // startaddress of the next line will be START+Len(A$)+1"
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "one"+Chr$(10)+"two"+Chr$(10),Start(10)',
        '_P=Start(10) : _M=Start(10)+64',
        'A$=Lstr(_P To _M) : Print A$;"/";Len(A$)',
        '_P=_P+Len(A$)+1',
        'B$=Lstr(_P To _M) : Print B$',
      ].join('\n'),
    )
    expect(out).toBe('one/ 3\ntwo\n')
  })

  it('Lset Eoln changes the terminator Lstr looks for', () => {
    // "NUM may range from 0 to 255. Default is 10, normal Amiga LineFeed.
    // (Unlike AMOS which tends to use 13 for some reason...)"
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "a,b"+Chr$(10),Start(10)',
        'Print Lstr(Start(10) To Start(10)+64)', // default 10: whole thing
        'Lset Eoln 44', // a comma
        'Print Lstr(Start(10) To Start(10)+64)',
      ].join('\n'),
    )
    expect(out).toBe('a,b\na\n')
  })

  it('Lstr stops at MAX when no terminator is found', () => {
    // "If no end-of-line-terminator is found, A$ will contain every character
    // between START and MAX"
    const { out } = run(
      ['Reserve As Work 10,64', 'Lbstr "abcdef",Start(10)', 'Print Lstr(Start(10) To Start(10)+3)'].join('\n'),
    )
    expect(out).toBe('abc\n')
  })
})

describe('LDos keywords the manual declares unusable', () => {
  it('Lold and Lcreate do nothing, as documented', () => {
    // "Lold - MAY CURRENTLY NOT BE USED!!" / "Lcreate - MAY CURRENTLY NOT BE
    // USED!! These are here for future versions" — so a program calling them
    // must not fail, and nothing observable may happen.
    const { out } = run('Lold : Lcreate : Print "ran"')
    expect(out).toBe('ran\n')
  })
})

describe('LDos word splitting (LdosV25.DOC)', () => {
  it("counts words exactly as the manual's own examples do", () => {
    // The manual lists these four results directly, which makes them the
    // best oracle available for the separator rules:
    //   Lwords("TAB Hi,, this TAB is just me") -> 5
    //   Lwords('Hi, "this is just" "" me')     -> 4
    //   Lwords('Hi "this is just" me')         -> 3
    //   Lwords('"Hi this is just me')          -> 1
    const q = 'Chr$(34)'
    const { out } = run(
      [
        'Print Lwords(Chr$(9)+" Hi,, this "+Chr$(9)+"is just me")',
        `Print Lwords("Hi, "+${q}+"this is just"+${q}+" "+${q}+${q}+" me")`,
        `Print Lwords("Hi "+${q}+"this is just"+${q}+" me")`,
        `Print Lwords(${q}+"Hi this is just me")`,
        'Print Lwords("")',
      ].join('\n'),
    )
    expect(out).toBe(' 5\n 4\n 3\n 1\n 0\n')
  })

  it('Lword is 1-based and keeps the quotes on a quoted word', () => {
    // "If a 'NULL'-word is specified ('""') an empty string will not be
    // returned, but both the doublequotes will be returned."
    const q = 'Chr$(34)'
    const { out } = run(
      [
        `S$="Hi, "+${q}+"this is just"+${q}+" "+${q}+${q}+" me"`,
        'Print Lword(1,S$)',
        'Print Lword(2,S$)',
        'Print Lword(3,S$)',
        'Print Lword(4,S$)',
        'Print Len(Lword(3,S$))',
      ].join('\n'),
    )
    expect(out).toBe('Hi\n"this is just"\n""\nme\n 2\n')
  })

  it('asking for a word that does not exist is an error', () => {
    // "If you request a word which doesn't exist an error will be produced."
    expect(() => run('Print Lword(9,"one two")')).toThrow(/no word 9/)
    expect(() => run('Print Lword(0,"one two")')).toThrow(/no word 0/)
  })
})

describe('LDos pattern matching (LdosV25.DOC)', () => {
  it('Lwild is false for plain text and true for a pattern', () => {
    // "TEST will be false (zero) if A$ contains no wildcard(s), otherwise
    // TEST may contain anything (usually 1)."
    const { out } = run(
      ['Print Lwild("readme.txt")', 'Print Lwild("#?.txt")', 'Print Lwild("(a|b)")', 'Print Lwild("[a-z]")'].join('\n'),
    )
    expect(out).toBe(' 0\n 1\n 1\n 1\n')
  })

  it('matches the wildcard forms the manual lists', () => {
    const z = '+Chr$(0)'
    const t = (src: string, pat: string): string => `Print Lmatch("${src}"${z},"${pat}"${z})`
    const { out } = run(
      [
        t('cat', 'c?t'),
        t('readme.txt', '#?.txt'),
        t('abc', '(abc|xyz)'),
        t('xyz', '(abc|xyz)'),
        t('q', '[a-z]'),
        t('Q', '[a-z]'),
        t('b', '[~ac]'),
        t('a', '[~ac]'),
        t('foo', '(foo|bar|%)'),
        t('', '(foo|bar|%)'),
        t('bar', '~(foo)'),
        t('foo', '~(foo)'),
      ].join('\n'),
    )
    expect(out).toBe('-1\n-1\n-1\n-1\n-1\n 0\n-1\n 0\n-1\n-1\n-1\n 0\n')
  })

  it('matches the whole string, not a substring', () => {
    const z = '+Chr$(0)'
    const { out } = run(
      [`Print Lmatch("readme.txt"${z},"read"${z})`, `Print Lmatch("readme.txt"${z},"read#?"${z})`].join('\n'),
    )
    expect(out).toBe(' 0\n-1\n')
  })
})

describe('LDos memory scanning (LdosV25.DOC)', () => {
  it('Lreplace swaps one byte value across a range', () => {
    // "will replace all tabs with spaces in bank number ten"
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "a"+Chr$(9)+"b"+Chr$(9)+"c",Start(10)',
        'Lreplace 9,Asc(" "),Start(10) To Start(10)+5',
        'Print Lstr(Start(10) To Start(10)+5)',
      ].join('\n'),
    )
    expect(out).toBe('a b c\n')
  })

  it('Lfilter swaps an inclusive range of byte values', () => {
    // "Everything between LOW and HIGH (INCLUDING LOW and HIGH)"
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "aBcDz",Start(10)',
        'Lfilter Asc("a"),Asc("z"),Asc("-"),Start(10) To Start(10)+5',
        'Print Lstr(Start(10) To Start(10)+5)',
      ].join('\n'),
    )
    expect(out).toBe('-B-D-\n')
  })

  it('Lskip returns the address after the last skipped character', () => {
    // "ADR will contain the address AFTER the last CHAR"
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr Chr$(10)+Chr$(10)+"x",Start(10)',
        'Print Lskip(10,Start(10) To Start(10)+8)-Start(10)',
        'Lbstr Chr$(10)+Chr$(10)+Chr$(10)+Chr$(10),Start(10)',
        'Print Lskip(10,Start(10) To Start(10)+3)-Start(10)',
      ].join('\n'),
    )
    expect(out).toBe(' 2\n 3\n')
  })

  it('Lback Hunt searches backwards from START down to STOP', () => {
    // "START is greater than STOP since this routine works backwards"
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "ab*cd*ef",Start(10)',
        'Print Lback Hunt(Asc("*"),Start(10)+8 To Start(10))-Start(10)',
        'Print Lback Hunt(Asc("Z"),Start(10)+8 To Start(10))-Start(10)',
      ].join('\n'),
    )
    expect(out).toBe(' 5\n 0\n')
  })
})
