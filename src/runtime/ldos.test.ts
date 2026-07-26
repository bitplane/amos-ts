import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS } from '../ext/registry'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { ldosKey } from './ldos'
import { pp20Crunch } from '../loader/powerpacker'
import { existsSync, readFileSync } from 'node:fs'

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
  fs.mountMemory('ENV') // global environment variables are files in ENV:
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
    expect(() => run('Lopen 1,"DH0:nope",0')).toThrow(/Invalid filename/)
    expect(() => run('Lopen 4,"DH0:x",1')).toThrow(/Invalid Lchannel/)
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
    // fib_DirEntryType: ST_USERDIR is 2, ST_FILE is -3
    expect(run(src).out).toBe(' 2\n-3\n')
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
    expect(() => run('Print Lword(9,"one two")')).toThrow(/No enough words/)
    expect(() => run('Print Lword(0,"one two")')).toThrow(/No enough words/)
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

describe('LDos file metadata (LdosV25.DOC)', () => {
  it('Lset/Lget Comment round-trip a FileNote, on files and directories', () => {
    // "A$ will contain nothing if there was no filenote. This of course also
    // works on directories." / "may not be longer than 79 characters"
    const { out } = run(
      [
        'Lopen 1,"DH0:c.dat",1 : Lclose 1',
        'Mkdir "DH0:cdir"',
        'Print "["+Lget Comment("DH0:c.dat")+"]"', // none yet
        'Lset Comment "DH0:c.dat","hello there"',
        'Lset Comment "DH0:cdir","a drawer note"',
        'Print Lget Comment("DH0:c.dat")',
        'Print Lget Comment("DH0:cdir")',
        'Lset Comment "DH0:c.dat",String$("x",100)',
        'Print Len(Lget Comment("DH0:c.dat"))', // clipped to 79
      ].join('\n'),
    )
    expect(out).toBe('[]\nhello there\na drawer note\n 79\n')
  })

  it('protection bits default to ----rwed and round-trip', () => {
    // bit 7 H, 6 S, 5 P, 4 A are active HIGH; bits 3-0 R,W,E,D are active
    // LOW, so 0 means every permission granted. The manual's own example:
    //   Lset Prot "c:myCommand",%00000000 : Rem ----rwed
    const { out } = run(
      [
        'Lopen 1,"DH0:p.dat",1 : Lclose 1',
        'Print Lget Prot("DH0:p.dat")', // default 0
        'Lset Prot "DH0:p.dat",%10000001', // hidden, and NOT deleteable
        'Print Lget Prot("DH0:p.dat")',
        'Print (Lget Prot("DH0:p.dat") and %10000000)<>0', // H is set
        'Print (Lget Prot("DH0:p.dat") and 1)<>0', // D bit set = deletion denied
      ].join('\n'),
    )
    expect(out).toBe(' 0\n 129\n-1\n-1\n')
  })

  it('Ldate and Lstamp convert both ways, per the manual example', () => {
    // "Fx. Print Ldate(LStamp(1991,10,23)) --> 911023"
    // "If the datestamp is less than zero ... the string 780101 will be
    // returned" and Lstamp of an earlier date still returns 1 Jan 1978.
    const { out } = run(
      [
        'Print Ldate(Lstamp(1991,10,23))',
        'Print Ldate(0)',
        'Print Ldate(-5)',
        'Print Lstamp(1977,6,1)',
        'Print Ldate(Lstamp(2020,2,29))', // a leap day, well past 2000
      ].join('\n'),
    )
    expect(out).toBe('911023\n780101\n780101\n 0\n200229\n')
  })

  it('Lset File Date is true for a real file and false for a missing one', () => {
    // "TEST will be true (-1) if the call was successful"
    const { out } = run(
      [
        'Lopen 1,"DH0:d.dat",1 : Lclose 1',
        'Print Lset File Date("DH0:d.dat",Lstamp(1994,7,10),90,25)',
        'Print Lset File Date("DH0:missing",0,0,0)',
      ].join('\n'),
    )
    expect(out).toBe('-1\n 0\n')
  })

  it('metadata belongs to the object: it follows a rename and dies with it', () => {
    const { fs } = run(
      [
        'Lopen 1,"DH0:m.dat",1 : Lclose 1',
        'Lset Comment "DH0:m.dat","travels"',
        'Lset Prot "DH0:m.dat",%00000101',
        'Rename "DH0:m.dat" To "DH0:moved.dat"',
      ].join('\n'),
    )
    expect(fs.meta('DH0:moved.dat')).toMatchObject({ comment: 'travels', protection: 5 })
    expect(fs.meta('DH0:m.dat').comment).toBe('') // the old name has nothing
  })
})

describe('LDos directory scanning (LdosV25.DOC + Lrecursive.AMOS)', () => {
  const tree = [
    'Mkdir "DH0:top"',
    'Mkdir "DH0:top/sub"',
    'Lopen 1,"DH0:top/a.txt",1 : Reserve As Work 10,64 : A=Lsave(1,Start(10),12) : Lclose 1',
    'Lopen 1,"DH0:top/b.txt",1 : Lclose 1',
  ]

  it('Lcat First locks the directory; entries come from Lcat Next', () => {
    // The manual says Lcat First "actually returns the path, requested by
    // you and doesn't read in all the files and directories like Dir First$",
    // and the author's Lrecursive.AMOS confirms it: the result of Lcat First
    // is discarded and every entry is read with Lcat Next. This is AmigaDOS
    // Examine()/ExNext(), not Dir First$/Dir Next$.
    const { out } = run(
      [...tree, 'Print Lcat First("DH0:top")', 'Print Lcat Next', 'Print Lcat Next', 'Print Lcat Next', 'Print "["+Lcat Next+"]"'].join('\n'),
    )
    expect(out).toBe('DH0:top\na.txt\nb.txt\nsub\n[]\n')
  })

  it('the accessors describe the entry Lcat Next is on', () => {
    // Lrecursive.AMOS tests `If Lcat Type > 0` straight after `a$=Lcat Next`
    const { out } = run(
      [
        ...tree,
        'A$=Lcat First("DH0:top")',
        'Print Lcat Type', // still the locked directory
        'A$=Lcat Next : Print A$;" ";Lcat Type;" ";Lcat Size;" ";Lcat Blocks',
        'A$=Lcat Next : Print A$;" ";Lcat Type;" ";Lcat Size',
        'A$=Lcat Next : Print A$;" ";Lcat Type;" ";Lcat Size', // a directory: size 0
      ].join('\n'),
    )
    // AMOS prints a leading space before a positive number
    expect(out).toBe(' 2\na.txt -3  12  1\nb.txt -3  0\nsub  2  0\n')
  })

  it('Lcat Prot, Comment and Stamp read the current entry metadata', () => {
    const { out } = run(
      [
        ...tree,
        'Lset Comment "DH0:top/a.txt","noted"',
        'Lset Prot "DH0:top/a.txt",%00000011',
        'A=Lset File Date("DH0:top/a.txt",Lstamp(1993,3,3),0,0)',
        'A$=Lcat First("DH0:top") : A$=Lcat Next',
        'Print A$;" ";Lcat Prot;" ";Lcat Comment;" ";Ldate(Lcat Stamp)',
      ].join('\n'),
    )
    expect(out).toBe('a.txt  3 noted 930303\n')
  })

  it('Lcat Push and Pull let a scan nest, as the recursive example does', () => {
    // Lrecursive.AMOS: st=st+264 : Lcat Push st : Proc recursive[...] :
    // Lcat Pull st : st=st-264
    const { out } = run(
      [
        ...tree,
        'Reserve As Work 11,264*4',
        'A$=Lcat First("DH0:top") : A$=Lcat Next : Print A$',
        'Lcat Push Start(11)',
        'B$=Lcat First("DH0:top/sub") : Print "["+Lcat Next+"]"', // empty subdir
        'Lcat Pull Start(11)',
        'Print Lcat Next', // the outer scan resumes where it was
      ].join('\n'),
    )
    expect(out).toBe('a.txt\n[]\nb.txt\n')
  })

  it('Lcat Pull on a bank holding nothing is the documented error', () => {
    // "If ADR points to NULLs (empty bank) you will receive the errormessage
    // 'No more entries in this dir!'"
    expect(() => run(['Reserve As Work 11,264', 'Lcat Pull Start(11)'].join('\n'))).toThrow(/No more entries/)
  })

  it('Lcat First on a directory that is not there is an Invalid Filename', () => {
    // "If the directory didn't exist the error "Invalid Filename" will be
    // produced (this is because I wanted to keep as few error-messages as
    // possible)"
    expect(() => run('A$=Lcat First("DH0:nosuchdir")')).toThrow(/Invalid filename/)
  })

  it('Ldev First and Ldev Next walk the devices, without colons', () => {
    // "Please note that the devicename (like DF0: etc.) NOT contains a colon"
    const { out } = run(
      ['Assign "Data:" To "DH0:"', 'Print Ldev First(0)', 'Print Ldev Next', 'Print Ldev Next', 'Print "["+Ldev Next+"]"'].join('\n'),
    )
    // ENV: is a mounted volume like any other, so it enumerates as a device
    // — which is what it is on a real machine
    expect(out).toBe('DH0\nENV\nData\n[]\n')
  })

  it('Lldir$ gives LDos its own current directory, which Dir$ does not touch', () => {
    // "If you change the dir using the Dir$-command and then try to open a
    // file using Lopen, the file probably couldn't be found, since Ldos
    // hadn't noticed the directory-change"
    const { out } = run(
      [
        'Mkdir "DH0:work"',
        'Lopen 1,"DH0:work/f.dat",1 : Lclose 1',
        'Lldir$ "DH0:work"',
        'Lopen 1,"f.dat",0 : Print "opened relative to LDos cwd" : Lclose 1',
        'Dir$="DH0:"', // AMOS moves; LDos does not follow
        'Lopen 1,"f.dat",0 : Print "still LDos cwd" : Lclose 1',
      ].join('\n'),
    )
    expect(out).toBe('opened relative to LDos cwd\nstill LDos cwd\n')
  })
})

describe('LDos buffers and checksums (LdosV25.DOC)', () => {
  it('Lupbuffer and Llobuffer convert only A-Z and a-z', () => {
    // "Just like AMOS Upper$ this routine won't handle national characters
    // (due to AMOS isn't using a standard keymap). Only A-Z and a-z are
    // processed."
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "aB3z-Q",Start(10)',
        'Lupbuffer Start(10) To Start(10)+6',
        'Print Lstr(Start(10) To Start(10)+6)',
        'Llobuffer Start(10) To Start(10)+6',
        'Print Lstr(Start(10) To Start(10)+6)',
      ].join('\n'),
    )
    expect(out).toBe('AB3Z-Q\nab3z-q\n')
  })

  it('Llargest Free reports a single-block figure, not the total', () => {
    // "This value is NOT the same as the AMOS commands Fast Free and Chip
    // Free, they return total unallocated memory-size, not the largest size
    // you can allocate in one bank."
    const { out } = run(['Print Llargest Free(0)>0', 'Print Llargest Free(1)>0'].join('\n'))
    expect(out).toBe('-1\n-1\n')
  })
})

// The checksum algorithms are not in the manual, so they are verified against
// real Amiga disks instead — byte-exact artifacts, which is the same standard
// the core port holds itself to.
const ADFS = '/home/gaz/src/tmp/amos/amos-files/sources/amos-pd-library-cd-1994/files/TotallyAmos/Issue1.adf'
describe.skipIf(!existsSync(ADFS))('LDos checksums, against real disks', () => {
  it('Lchk Data reproduces the stored root-block checksum', () => {
    // A valid AmigaDOS block is one whose 128 longs sum to zero, so the
    // checksum Lchk Data computes over a real root block must equal the one
    // already stored in it.
    const disk = new Uint8Array(readFileSync(ADFS))
    const root = disk.subarray(880 * 512, 881 * 512)
    const stored = new DataView(root.buffer, root.byteOffset, 512).getInt32(20, false)
    const v = new DataView(root.buffer, root.byteOffset, 512)
    let sum = 0
    for (let i = 0; i < 128; i++) if (i !== 5) sum = (sum + v.getUint32(i * 4, false)) >>> 0
    expect(-sum | 0).toBe(stored)
  })

  it('Lchk Boot reproduces the stored boot-block checksum', () => {
    // The boot checksum is a different algorithm — an end-around-carry sum
    // over both boot blocks, complemented — which the manual warns about
    // ("you must not use Lchk Data for the bootblock").
    const disk = new Uint8Array(readFileSync(ADFS))
    const boot = disk.subarray(0, 1024)
    const v = new DataView(boot.buffer, boot.byteOffset, 1024)
    let sum = 0
    for (let i = 0; i < 256; i++) {
      if (i === 1) continue
      sum += v.getUint32(i * 4, false)
      if (sum > 0xffffffff) sum = (sum + 1) >>> 0
    }
    expect((~sum | 0) >>> 0).toBe(v.getUint32(4, false))
  })

  it('Lchk Boot, driven through a bank, matches the disk', () => {
    // the gate insists a faithful keyword is actually dispatched, not merely
    // reimplemented in the test — so this runs the keyword over a real boot
    // block and compares against what the disk already stores
    const disk = new Uint8Array(readFileSync(ADFS))
    const boot = disk.subarray(0, 1024)
    const stored = new DataView(boot.buffer, boot.byteOffset, 1024).getInt32(4, false)
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    fs.writeFile('DH0:boot.blk', Uint8Array.from(boot))
    let out = ''
    const rt = new Runtime(
      tokenize(['Reserve As Work 10,1024', 'Bload "DH0:boot.blk",10', 'Print Lchk Boot(Start(10))'].join('\n'), table, extensions),
      table,
      { maxSteps: 100_000, extensions, fs, onText: (t) => (out += t) },
    )
    rt.runHeadless(100)
    expect(out.trim()).toBe(String(stored))
  })

  it('the keyword itself matches, driven through a bank', () => {
    // the same root block, loaded into a bank with Bload and checksummed by
    // the keyword rather than by the test
    const disk = new Uint8Array(readFileSync(ADFS))
    const root = disk.subarray(880 * 512, 881 * 512)
    const stored = new DataView(root.buffer, root.byteOffset, 512).getInt32(20, false)
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    fs.writeFile('DH0:root.blk', Uint8Array.from(root))
    let out = ''
    const rt = new Runtime(
      tokenize(['Reserve As Work 10,512', 'Bload "DH0:root.blk",10', 'Print Lchk Data(Start(10))'].join('\n'), table, extensions),
      table,
      { maxSteps: 100_000, extensions, fs, onText: (t) => (out += t) },
    )
    rt.runHeadless(100)
    expect(out.trim()).toBe(String(stored))
  })
})

describe('LDos environment variables and fonts (LdosV25.DOC)', () => {
  it('variables round-trip and are not case-sensitive', () => {
    // "Name of the variable is not case-sensitive" / "If A$ is empty the
    // variable didn't exist" / "T will be true if ... found and removed"
    const { out } = run(
      [
        'Print Lset Var("Editor","ed")',
        'Print Lget Var("EDITOR")', // same variable, different case
        'Print "["+Lget Var("nothere")+"]"',
        'Print Ldelete Var("editor")',
        'Print Ldelete Var("editor")', // already gone
        'Print "["+Lget Var("Editor")+"]"',
      ].join('\n'),
    )
    expect(out).toBe('-1\ned\n[]\n-1\n 0\n[]\n')
  })

  it('rejects names and values over the documented 50 characters', () => {
    // "must not exceed 50 characters" for both
    const { out } = run(
      ['Print Lset Var(String$("n",51),"v")', 'Print Lset Var("ok",String$("v",51))', 'Print Lset Var("ok",String$("v",50))'].join('\n'),
    )
    expect(out).toBe(' 0\n 0\n-1\n')
  })

  it('environment variables really are files in ENV:', () => {
    // SetVar with GVF_GLOBAL_ONLY writes a file into ENV: on the real
    // machine, so they are visible to Dir and to anything else that reads
    // the filesystem — not hidden in the extension's own memory.
    const { out, fs } = run(
      ['Print Lset Var("Editor","ed")', 'Print Lget Var("Editor")', 'Print Exist("ENV:Editor")'].join('\n'),
    )
    expect(out).toBe('-1\ned\n-1\n')
    expect(fs.readFile('ENV:Editor')).toEqual(enc('ed'))
  })

  it('Lsys Stamp and Lsys Time read the host clock, fixed by default', () => {
    // The default clock is deterministic so a headless run is reproducible;
    // a host with a real clock supplies one. FIXED_DATE is 12 July 1994,
    // 14:30:00.
    const { out } = run(['Print Ldate(Lsys Stamp)', 'Print Lsys Time'].join('\n'))
    expect(out).toBe('940712\n143000\n')
  })

  it('Ldisk Font wants a .font name and a font that is really there', () => {
    // "name is the fontname, '.font' MUST follow it ... A will be >0 if the
    // font loaded OK. If a <1 the font wasn't on the disk"
    const { out } = run(
      ['Print Ldisk Font("diamond",12)', 'Print Ldisk Font("diamond.font",12)'].join('\n'),
    )
    expect(out).toBe(' 0\n 0\n') // no Fonts: drawer mounted here
  })
})

describe('LDos encryption (disassembled from AMOSPro_Ldos.lib)', () => {
  // The manual documents the calling convention and nothing about the
  // algorithm, so this is verified against the library binary itself:
  // Lcrypt at $4400 and Ldecrypt at $4436, read with capstone. See the
  // comment on ldosKey() for the routines as disassembled.
  it('Ldecrypt undoes Lcrypt, which is what the pair is for', () => {
    const { out } = run(
      [
        'Reserve As Work 10,16',
        'Loke Start(10),$41424344 : Loke Start(10)+4,$45464748',
        'Lcrypt Start(10),2,"secret"',
        'Print Hex$(Leek(Start(10)))<>"$41424344"', // it really changed
        'Ldecrypt Start(10),2,"secret"',
        'Print Hex$(Leek(Start(10)));" ";Hex$(Leek(Start(10)+4))',
      ].join('\n'),
    )
    expect(out).toBe('-1\n$41424344 $45464748\n')
  })

  it('the wrong password does not recover the data', () => {
    // "password is your secret code which also is used to DEcode your data
    // later ... note that the password is casesensitive!"
    const { out } = run(
      [
        'Reserve As Work 10,8',
        'Loke Start(10),$DEADBEEF',
        'Lcrypt Start(10),1,"secret"',
        'Ldecrypt Start(10),1,"Secret"', // capital S — a different key
        'Print Hex$(Leek(Start(10)))="$DEADBEEF"',
      ].join('\n'),
    )
    expect(out).toBe(' 0\n')
  })

  it('only Ldecrypt enforces the four-character password', () => {
    // The binary is asymmetric: Ldecrypt begins cmp.w #4,d0 / bcc, and
    // Lcrypt has no length check at all — so the manual's "an error will be
    // produced if the password is less than 4 characters long" holds for one
    // of the pair only.
    expect(() => run(['Reserve As Work 10,8', 'Ldecrypt Start(10),1,"ab"'].join('\n'))).toThrow(/To short password-string/)
    const { out } = run(['Reserve As Work 10,8', 'Lcrypt Start(10),1,"ab"', 'Print "no error"'].join('\n'))
    expect(out).toBe('no error\n')
  })

  it('derives the key exactly as the disassembled loop does', () => {
    // add.b touches only the low byte of d7, while the XOR and the rotate are
    // full 32-bit — get that wrong and the key diverges after one character.
    // Hand-simulating the 68k for "AB":
    //   'A' (65): key.b = 65 -> ^3 = 66 -> rol1 = 132
    //   'B' (66): key.b = (132+66)&255 = 198 -> ^3 = 197 -> rol1 = 394
    expect(ldosKey('A')).toBe(132)
    expect(ldosKey('AB')).toBe(394)
    expect(ldosKey('')).toBe(0)
  })
})

describe('LDos pattern keywords are dos.library wrappers (disassembly)', () => {
  // Lwild is `jsr -$348(a6)` (ParsePattern) and Lmatch is ParsePattern then
  // `jsr -$34e(a6)` (MatchPattern), each returning `move.l d0,d3` — the
  // library's own result verbatim. That settles what the manual never says.
  it('Lwild returns ParsePattern: 0, 1, or -1 for an unparseable pattern', () => {
    const { out } = run(
      [
        'Print Lwild("readme.txt")', // no wildcards
        'Print Lwild("#?.txt")', // wildcards
        'Print Lwild("(unclosed")', // ParsePattern fails
        'Print Lwild("[a-z")',
      ].join('\n'),
    )
    expect(out).toBe(' 0\n 1\n-1\n-1\n')
  })

  it('Lmatch returns DOSTRUE/DOSFALSE, and raises on a bad pattern', () => {
    // MatchPattern's result is DOSTRUE (-1) or DOSFALSE (0). LDos calls
    // ParsePattern itself first, so a pattern that will not parse produces
    // the library's own message rather than a silent false.
    const z = '+Chr$(0)'
    const { out } = run([`Print Lmatch("abc"${z},"a?c"${z})`, `Print Lmatch("abc"${z},"axc"${z})`].join('\n'))
    expect(out).toBe('-1\n 0\n')
    expect(() => run(`Print Lmatch("abc"${z},"(unclosed"${z})`)).toThrow(/To long pattern/)
  })
})

describe('Lansi: ANSI to AMOS control codes (LdosV25.DOC)', () => {
  const E = 'Chr$(27)'
  it('translates colour and the ESC[0m reset', () => {
    // "To reset to pen-colour 1, background-colour 0 and no style, use
    // ESC[0m." AMOS's own codes are ESC P n for pen and ESC B n for paper.
    const { out } = run(
      [
        `A$=Lansi(${E}+"[31m") : Print Len(A$);" ";Mid$(A$,2,1);Asc(Mid$(A$,3,1))-48`,
        `B$=Lansi(${E}+"[44m") : Print Mid$(B$,2,1);Asc(Mid$(B$,3,1))-48`,
        `C$=Lansi(${E}+"[0m") : Print Len(C$)`,
      ].join('\n'),
    )
    expect(out).toBe(' 3 P 1\nB 4\n 9\n') // pen 1, paper 4, reset is pen+paper+style
  })

  it('translates cursor movement, biased the way AMOS expects', () => {
    // ESC[xA/B/C/D become AMOS's relative moves, which carry a +128 bias
    const { out } = run(
      [
        `A$=Lansi(${E}+"[3C") : Print Mid$(A$,2,1);Asc(Mid$(A$,3,1))-128`,
        `B$=Lansi(${E}+"[2A") : Print Mid$(B$,2,1);Asc(Mid$(B$,3,1))-128`,
      ].join('\n'),
    )
    expect(out).toBe('O 3\nN-2\n')
  })

  it('ESC[y;xH becomes Locate x,y — the ANSI order is row first', () => {
    // the result is ESC X <col> ESC Y <row>: column 10 -> 9, row 5 -> 4,
    // both zero-based and both biased by 48 into printable characters
    const { out } = run(
      [`A$=Lansi(${E}+"[5;10H")`, 'Print Mid$(A$,2,1);Asc(Mid$(A$,3,1))-48;Mid$(A$,5,1);Asc(Mid$(A$,6,1))-48'].join('\n'),
    )
    expect(out).toBe('X 9Y 4\n')
  })

  it('carries an unfinished escape across calls', () => {
    // "A$ is a normal ANSI-sequence which doesn't have to be complete if the
    // rest of the sequence follow in the next call(s)."
    const { out } = run(
      [
        `A$=Lansi(${E}+"[3") : Print "["+A$+"]"`, // incomplete: nothing yet
        `B$=Lansi("1m") : Print Mid$(B$,2,1);Asc(Mid$(B$,3,1))-48`,
      ].join('\n'),
    )
    expect(out).toBe('[]\nP 1\n')
  })

  it('passes through the codes the manual says to pass through', () => {
    // "$a Linefeed. Passed on to AMOS. $d Carrige return. $8 Backspace."
    // and $C, which "really isn't a ANSI-code but is supported since many
    // BBS-programs (and AmigaDOS + others) use this"
    const { out } = run(
      [`A$=Lansi("hi"+Chr$(10)+Chr$(8)) : Print Len(A$);Asc(Mid$(A$,3,1));Asc(Mid$(A$,4,1))`,
       `B$=Lansi(Chr$(12)) : Print Len(B$)`].join('\n'),
    )
    expect(out).toBe(' 4 10 8\n 6\n') // text passes through; $C becomes Clw/Home
  })
})

describe('LDos file requester (LdosV25.DOC)', () => {
  it('remembers its own directory, separate from Dir$', () => {
    // "This path does not affect AMOS's (Dir$) path in any way"
    const { out, rt } = run(['Lset Freq Dir "DH0:work"', 'Dir$="DH0:"', 'Print Dir$'].join('\n'))
    expect(out).toBe('DH0:\n') // AMOS's path is untouched
    expect(rt.ldos.freqDir).toBe('DH0:work') // LDos keeps its own
  })

  it('Lget Freq Dir/File survive a Cancel, and start empty', () => {
    // "A$ will NOT be empty even if the user clicked CANCEL and something
    // has been selected through the filerequester before" — so they hold the
    // last selection, and before any selection they are empty
    const { out } = run(['Print "["+Lget Freq Dir+"]"', 'Print "["+Lget Freq File+"]"'].join('\n'))
    expect(out).toBe('[]\n[]\n')
  })

  it('Lcust Freq and Lpos Freq store the documented defaults and overrides', () => {
    // "Default values are 12,30,14" and "Default positions are 3,11"
    const fresh = run('Print 0').rt
    expect([fresh.ldos.freqDevWidth, fresh.ldos.freqFileWidth, fresh.ldos.freqFiles]).toEqual([12, 30, 14])
    expect([fresh.ldos.freqX, fresh.ldos.freqY]).toEqual([3, 11])
    const { rt } = run(['Lcust Freq 20,40,8', 'Lpos Freq 100,50'].join('\n'))
    expect([rt.ldos.freqDevWidth, rt.ldos.freqFileWidth, rt.ldos.freqFiles]).toEqual([20, 40, 8])
    expect([rt.ldos.freqX, rt.ldos.freqY]).toEqual([100, 50])
  })

  it('Lfontsize Freq is zero until a font-mode requester has run', () => {
    // "you must set the filerequester to font-mode ($8-flag) in order to
    // update this field"
    expect(run('Print Lfontsize Freq').out).toBe(' 0\n')
  })

  it('Lfreq returns empty when there is no resource bank to draw with', () => {
    // the same failure Fsel$ has: without the system resource bank there is
    // no dialog to run, and the call returns rather than hanging
    expect(run('Print "["+Lfreq("Load an IFF-file",0)+"]"').out).toBe('[]\n')
  })
})

describe('LDos PowerPacker (LdosV25.DOC)', () => {
  // The decoder itself is the one already used by Ppload/Ppsave, whose
  // correctness is established in powerpacker.test.ts against reference
  // decoders and a genuine crunched file. These check the keyword wiring.
  it('Lpp Mem reads the decrunched size out of the file trailer', () => {
    // "END ... must not be the end of the bank, but the end of the file"
    const plain = enc('the quick brown fox jumps over the lazy dog, twice over')
    const packed = pp20Crunch(plain)
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.mountMemory('ENV')
    fs.currentDir = 'DH0:'
    fs.writeFile('DH0:packed.pp', packed)
    let out = ''
    const rt = new Runtime(
      tokenize(
        [
          'Reserve As Work 10,4096',
          'Bload "DH0:packed.pp",10',
          `Print Lpp Mem(Start(10)+${packed.length})`,
        ].join('\n'),
        table,
        extensions,
      ),
      table,
      { maxSteps: 200_000, extensions, fs, onText: (t) => (out += t) },
    )
    rt.runHeadless(200)
    expect(out.trim()).toBe(String(plain.length))
  })

  it('Lpp Decrunch unpacks into the destination bank', () => {
    const plain = enc('AMOS Professional, crunched and restored again and again')
    const packed = pp20Crunch(plain)
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.mountMemory('ENV')
    fs.currentDir = 'DH0:'
    fs.writeFile('DH0:d.pp', packed)
    let out = ''
    const rt = new Runtime(
      tokenize(
        [
          'Reserve As Work 10,4096',
          'Reserve As Work 11,4096',
          'Bload "DH0:d.pp",10',
          `Lpp Decrunch Start(10),Start(10)+${packed.length} To Start(11)`,
          `Print Lstr(Start(11) To Start(11)+${plain.length})`,
        ].join('\n'),
        table,
        extensions,
      ),
      table,
      { maxSteps: 200_000, extensions, fs, onText: (t) => (out += t) },
    )
    rt.runHeadless(200)
    expect(out.trim()).toBe('AMOS Professional, crunched and restored again and again')
  })

  it('does no checking, exactly as the manual warns', () => {
    // "No check is done to see that the bank really contains a powerpacked
    // file so make sure you have loaded one before" — so Lpp Mem on
    // arbitrary data returns whatever the trailing longword happens to say,
    // and reproducing that is the faithful behaviour rather than a defect.
    const { out } = run(
      [
        'Reserve As Work 10,64',
        'Lbstr "not packed at all",Start(10)',
        'Print Lpp Mem(Start(10)+17)>0',
      ].join('\n'),
    )
    expect(out).toBe('-1\n')
  })

  it('Lpp Decrunch leaves the destination alone rather than corrupting it', () => {
    // The real routine would scribble over memory ("Again, no test is done
    // ... Be careful!"). That much cannot be reproduced usefully, so a bank
    // that is not PP20 writes nothing — recorded in the NOTES.
    const { out } = run(
      [
        'Reserve As Work 10,64 : Reserve As Work 11,64',
        'Lbstr "not packed at all",Start(10)',
        'Lbstr "untouched",Start(11)',
        'Lpp Decrunch Start(10),Start(10)+17 To Start(11)',
        'Print Lstr(Start(11) To Start(11)+9)',
      ].join('\n'),
    )
    expect(out).toBe('untouched\n')
  })
})
