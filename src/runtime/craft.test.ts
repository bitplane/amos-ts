import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { craftKey, craftScramble, craftUnscramble, CRAFT_CIPHER_TABLE } from './craft'

const table = new TokenTable(CORE_TOKENS)
/** slot 18, off Burton's list and confirmed by the disk's own forty examples */
const craft = extensionById('craft-1.0')!

function boot(src: string): { rt: Runtime; out: () => string } {
  const exts = new Map([[18, craft.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[18, craft]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string): { rt: Runtime; out: () => string } {
  const b = boot(src)
  mustFinish(b.rt.runHeadless(5000))
  return b
}

/** what `Print <expr>` puts on the screen, trimmed */
const val = (expr: string, pre = ''): string => run(`${pre}Print ${expr}`).out().trim()

/** a reserved bank filled with `bytes`, and the address of its first byte */
function withBank(bytes: number[], src: string): { rt: Runtime; out: () => string } {
  const poke = bytes.map((b, i) => `Poke Start(5)+${i},${b}`).join('\n')
  return run(`Reserve As Work 5,${Math.max(bytes.length, 16)}\n${poke}\n${src}`)
}

describe('CRAFT 1.0 — the case functions (routines 3, 4, 5)', () => {
  it('folds ASCII the way Upper$ and Lower$ do', () => {
    expect(val('Up Case$("Hello, World! 123")')).toBe('HELLO, WORLD! 123')
    expect(val('Lo Case$("Hello, World! 123")')).toBe('hello, world! 123')
    expect(val('Flip Case$("Hello, World!")')).toBe('hELLO, wORLD!')
  })

  it('folds Latin-1 too, which is the point of the keyword', () => {
    // the manual: "they can convert all the special characters too. These
    // characters include e.g. æ, ü, ä, ö, á, ç, é, ñ"
    const chars = 'Chr$(228)+Chr$(246)+Chr$(233)+Chr$(241)' // ä ö é ñ
    expect(val(`Up Case$(${chars})`)).toBe('\xc4\xd6\xc9\xd1') // Ä Ö É Ñ
    const caps = 'Chr$(196)+Chr$(214)+Chr$(201)+Chr$(209)'
    expect(val(`Lo Case$(${caps})`)).toBe('\xe4\xf6\xe9\xf1')
  })

  it('spares the two characters that have no other case (0xdf and 0xff)', () => {
    // ß and ÿ: Flip Case$ tests for both explicitly, and the other two miss
    // them because of where their ranges stop
    expect(val('Flip Case$(Chr$(223)+Chr$(255))')).toBe('\xdf\xff')
    expect(val('Up Case$(Chr$(255))')).toBe('\xff')
    expect(val('Lo Case$(Chr$(223))')).toBe('\xdf')
  })

  it('DEFECT: turns ÷ into × and back, because the fold is a range and a bchg', () => {
    // 0xd7 and 0xf7 are Latin-1's multiplication and division signs and they
    // sit inside the letter ranges at exactly the case offset. Nothing in the
    // routine excludes them the way 0xdf and 0xff are excluded.
    expect(val('Up Case$(Chr$(247))')).toBe('\xd7')
    expect(val('Lo Case$(Chr$(215))')).toBe('\xf7')
    expect(val('Flip Case$(Chr$(215)+Chr$(247))')).toBe('\xf7\xd7')
  })

  it('answers the empty string for the empty string (routine 30 with d0 zero)', () => {
    expect(val('"["+Up Case$("")+"]"')).toBe('[]')
  })
})

describe('CRAFT 1.0 — trimming (routines 6..9)', () => {
  it('trims spaces by default, one end each', () => {
    expect(val('"["+Left Trim$("   abc   ")+"]"')).toBe('[abc   ]')
    expect(val('"["+Right Trim$("   abc   ")+"]"')).toBe('[   abc]')
  })

  it('trims any character in the given set, not just one character', () => {
    // "you can use these functions to remove any character instead of spaces"
    // — and the scan is a dbeq over the whole trim string, so it is a SET
    expect(val('Left Trim$("xyxyabc","xy")')).toBe('abc')
    expect(val('Right Trim$("abc.,.,",".,")')).toBe('abc')
  })

  it('trims nothing from a string that is all trim characters, leaving empty', () => {
    expect(val('"["+Left Trim$("   ")+"]"')).toBe('[]')
  })

  it('an empty trim set is error 23, not a no-op (Rbcs routine 206)', () => {
    expect(() => run('Print Left Trim$("abc","")')).toThrow(/Illegal function call/)
    expect(() => run('Print Right Trim$("abc","")')).toThrow(/Illegal function call/)
  })
})

describe('CRAFT 1.0 — Bw Instr (routine 11)', () => {
  it('finds the LAST occurrence and answers a 1-based position', () => {
    expect(val('Bw Instr("abcabc","bc")')).toBe('5')
    expect(val('Bw Instr("abcabc","abc")')).toBe('4')
    expect(val('Bw Instr("hello","l")')).toBe('4')
  })

  it('answers 0 when there is no match, or either string is empty', () => {
    expect(val('Bw Instr("abc","z")')).toBe('0')
    expect(val('Bw Instr("","a")')).toBe('0')
    expect(val('Bw Instr("abc","")')).toBe('0')
  })

  it('will not accept an occurrence that extends past p', () => {
    // the manual is explicit, and the code gets it by starting the backwards
    // scan at s$+p and matching the LAST character of f$ there
    expect(val('Bw Instr("abcabc","bc",6)')).toBe('5')
    expect(val('Bw Instr("abcabc","bc",5)')).toBe('2')
    expect(val('Bw Instr("abcabc","bc",3)')).toBe('2')
    expect(val('Bw Instr("abcabc","bc",2)')).toBe('0')
  })

  it('clamps a p past the end and refuses a negative one', () => {
    expect(val('Bw Instr("abcabc","bc",99)')).toBe('5')
    expect(() => run('Print Bw Instr("abc","b",-1)')).toThrow(/Illegal function call/)
  })
})

describe('CRAFT 1.0 — Chr Conv$ (routine 12)', () => {
  it('replaces every occurrence of one code with another', () => {
    expect(val('Chr Conv$("a-b-c",45 To 32)')).toBe('a b c')
    expect(val('Chr Conv$("aaa",97 To 98)')).toBe('bbb')
  })

  it('leaves a string with no match alone, and handles the empty string', () => {
    expect(val('Chr Conv$("abc",122 To 121)')).toBe('abc')
    expect(val('"["+Chr Conv$("",65 To 66)+"]"')).toBe('[]')
  })

  it('range-checks both codes against 255 UNSIGNED, so -1 is error 23 too', () => {
    expect(() => run('Print Chr Conv$("a",256 To 65)')).toThrow(/Illegal function call/)
    expect(() => run('Print Chr Conv$("a",65 To 256)')).toThrow(/Illegal function call/)
    expect(() => run('Print Chr Conv$("a",-1 To 65)')).toThrow(/Illegal function call/)
  })
})

describe('CRAFT 1.0 — Str Count (routines 16 and 17)', () => {
  it('DEFECT: counts the SECOND argument inside the first, not the manual way round', () => {
    /*
     * The help says `Str Count(search$, string$)` — "how many times does the
     * search$ occur in the string$". The binary pops the last argument as the
     * needle and scans the first, and the author's own Dir_Read_Special.AMOS
     * writes `Str Count(A$,"*")` with A$ the path. Both witnesses beat the
     * help, so the first argument is the haystack.
     */
    expect(val('Str Count("a*b*c","*")')).toBe('2')
    expect(val('Str Count("*","a*b*c")')).toBe('0')
  })

  it('does not count occurrences starting inside another one', () => {
    // "when this function finds a search$, it jumps to the next character
    // after the occurrence" — so aaaa holds two aa, not three
    expect(val('Str Count("aaaa","aa")')).toBe('2')
    expect(val('Str Count("aaaaa","aa")')).toBe('2')
    expect(val('Str Count("abababa","aba")')).toBe('2')
  })

  it('answers 0 for an empty needle or haystack, and for a needle too long', () => {
    expect(val('Str Count("abc","")')).toBe('0')
    expect(val('Str Count("","a")')).toBe('0')
    expect(val('Str Count("ab","abc")')).toBe('0')
  })
})

describe('CRAFT 1.0 — the memory dumps (routines 24, 25, 26)', () => {
  it('Hex Dump$ writes uppercase pairs and spaces every sep bytes', () => {
    const b = withBank([0x00, 0x0f, 0xa0, 0xff, 0x10, 0x20], 'Print Hex Dump$(Start(5),6,2)')
    expect(b.out().trim()).toBe('000F A0FF 1020')
  })

  it('Hex Dump$ defaults sep to 4 (routine 24 pushes it)', () => {
    const b = withBank([1, 2, 3, 4, 5, 6], 'Print Hex Dump$(Start(5),6)')
    expect(b.out().trim()).toBe('01020304 0506')
  })

  it('Hex Dump$ puts no space at all when sep is 0 or at least len', () => {
    expect(withBank([1, 2, 3], 'Print Hex Dump$(Start(5),3,0)').out().trim()).toBe('010203')
    expect(withBank([1, 2, 3], 'Print Hex Dump$(Start(5),3,3)').out().trim()).toBe('010203')
    expect(withBank([1, 2, 3], 'Print Hex Dump$(Start(5),3,9)').out().trim()).toBe('010203')
  })

  it('Hex Dump$ range-checks sep on its HIGH word, so 65535 passes and 65536 does not', () => {
    expect(() => withBank([1], 'Print Hex Dump$(Start(5),1,65535)')).not.toThrow()
    expect(() => withBank([1], 'Print Hex Dump$(Start(5),1,65536)')).toThrow(/Illegal function call/)
  })

  it('Chr Dump$ keeps a byte only when b AND $60 is set', () => {
    // the manual's "0-31 and 128-159 are converted to full stop", which is
    // exactly the bytes with neither bit 5 nor bit 6
    const bytes = [65, 0, 31, 32, 127, 128, 159, 160, 255]
    const b = withBank(bytes, 'Print Chr Dump$(Start(5),9)')
    expect(b.out().trim()).toBe('A..\x20\x7f..\xa0\xff')
  })
})

describe('CRAFT 1.0 — Str Peek$ and Str Poke (routines 27, 28, 29)', () => {
  it('reads len bytes with no stop character', () => {
    const b = withBank([72, 101, 108, 108, 111], 'Print Str Peek$(Start(5),5)')
    expect(b.out().trim()).toBe('Hello')
  })

  it('stops before the stop character, which is how the disk reads its own lines', () => {
    // CRAFT_HyperText.AMOS: A$=Str Peek$(A+Start(1),80,Chr$(10))
    const b = withBank([97, 98, 10, 99, 100], 'Print Str Peek$(Start(5),5,Chr$(10))')
    expect(b.out().trim()).toBe('ab')
  })

  it('uses only the FIRST character of stop$ (d6 is loaded and never read)', () => {
    const b = withBank([97, 98, 10, 99], 'Print Str Peek$(Start(5),4,Chr$(10)+"b")')
    expect(b.out().trim()).toBe('ab')
  })

  it('DEFECT: drops a byte when the stop character never turns up', () => {
    // the scan walks all len bytes, then the same `subq.l #1` that exists to
    // strip the stop character eats a real one instead
    const b = withBank([97, 98, 99, 100], 'Print "["+Str Peek$(Start(5),4,Chr$(10))+"]"')
    expect(b.out().trim()).toBe('[abc]')
    // and the two-argument form, which never goes near that code, does not
    const c = withBank([97, 98, 99, 100], 'Print "["+Str Peek$(Start(5),4)+"]"')
    expect(c.out().trim()).toBe('[abcd]')
  })

  it('treats an empty stop$ as no stop$ at all', () => {
    const b = withBank([97, 98, 99], 'Print "["+Str Peek$(Start(5),3,"")+"]"')
    expect(b.out().trim()).toBe('[abc]')
  })

  it('Str Poke writes the characters and nothing else', () => {
    const b = withBank([0, 0, 0, 0], 'Str Poke Start(5),"AB"\nPrint Peek(Start(5));Peek(Start(5)+1);Peek(Start(5)+2)')
    expect(b.out().trim()).toBe('65 66 0')
  })

  it('Str Poke of an empty string writes nothing (the dbra is guarded by bcs)', () => {
    const b = withBank([7, 7], 'Str Poke Start(5),""\nPrint Peek(Start(5))')
    expect(b.out().trim()).toBe('7')
  })
})

describe('CRAFT 1.0 — the cipher (routines 19, 21, 22, 23)', () => {
  it('round-trips through Str Unscramble$, which is the whole contract', () => {
    const cases: Array<[string, string]> = [
      ['hello', 'key'],
      ['The quick brown fox jumps over the lazy dog', 'a'],
      ['x', 'a much longer password than the text'],
      ['aaaaaaaaaaaaaaaa', 'pw'],
    ]
    for (const [text, pass] of cases) {
      const back = val(`Str Unscramble$(Str Scramble$("${text}","${pass}"),"${pass}")`)
      expect(back, `${text} / ${pass}`).toBe(text)
    }
  })

  it('is not an XOR: the same plaintext byte encrypts differently each time', () => {
    const out = val('Str Scramble$("aaaaaaaa","k")')
    expect(new Set(out.split('')).size).toBeGreaterThan(1)
  })

  it('depends on the password, so the wrong one does not recover the text', () => {
    expect(val('Str Unscramble$(Str Scramble$("secret","right"),"wrong")')).not.toBe('secret')
  })

  it('refuses an empty password with error 23 (Rbeq routine 206)', () => {
    expect(() => run('Print Str Scramble$("a","")')).toThrow(/Illegal function call/)
    expect(() => run('Print Str Unscramble$("a","")')).toThrow(/Illegal function call/)
  })

  it('answers the empty string for empty input without touching the key', () => {
    expect(val('"["+Str Scramble$("","pw")+"]"')).toBe('[]')
  })

  it('mixes a longword of routine 23s own instruction stream into the key', () => {
    // the schedule ends `andi.w #30,d0 / add.l (-44,pc,d0.w),d5`, and -44 from
    // that extension word is $1078 — the routine's own first byte. The table
    // therefore opens with `movea.l (a3)+,a2 / moveq #0,d7`.
    expect([...CRAFT_CIPHER_TABLE.subarray(0, 4)]).toEqual([0x24, 0x5b, 0x7e, 0x00])
    expect(CRAFT_CIPHER_TABLE.length).toBe(32)
    // and $babeface is in there, because the seed load is one of the sixteen
    expect([...CRAFT_CIPHER_TABLE.subarray(12, 16)]).toEqual([0xba, 0xbe, 0xfa, 0xce])
  })

  it('is deterministic across calls with one key, byte for byte', () => {
    // the helpers directly, so a change to the keystream is caught even if no
    // keyword above happens to exercise the affected byte
    const src = Uint8Array.from('CRAFT', (c) => c.charCodeAt(0))
    const a = craftScramble(src, craftKey('pw'))
    const b = craftScramble(src, craftKey('pw'))
    expect([...a]).toEqual([...b])
    expect([...craftUnscramble(a, craftKey('pw'))]).toEqual([...src])
  })
})

describe('CRAFT 1.0 — the memory group (routines 32..40)', () => {
  it('Chip Max Block and Fast Max Block are AvailMem with MEMF_LARGEST', () => {
    // DEVIATION: the modelled pools track a total rather than a largest free
    // block, so these answer what Chip Free and Fast Free do — the same
    // substitution TURBO Plus's Chip Largest already carries
    const b = run('Print Chip Max Block\nPrint Fast Max Block')
    const [chip, fast] = b.out().trim().split('\n').map(Number)
    expect(chip).toBeGreaterThan(0)
    expect(fast).toBeGreaterThan(0)
  })

  it('Mem Copy copies an INCLUSIVE range', () => {
    // routine 35 computes `finish - start + 1` before CopyMem, so
    // `Mem Copy a,a To b` moves ONE byte, not zero
    const b = withBank(
      [1, 2, 3, 4, 0, 0, 0, 0],
      'Mem Copy Start(5),Start(5)+3 To Start(5)+4\nPrint Peek(Start(5)+4);Peek(Start(5)+7)',
    )
    expect(b.out().trim()).toBe('1 4')
    const c = withBank([9, 0], 'Mem Copy Start(5),Start(5) To Start(5)+1\nPrint Peek(Start(5)+1)')
    expect(c.out().trim()).toBe('9')
  })

  it('Mem Type refuses an odd address with error 25, "Address error"', () => {
    // routine 36's `btst #0,d3 / Rbne routine 208`, before TypeOfMem is called
    expect(() => run('Print Mem Type(1)')).toThrow(/Address error/)
    expect(() => run('Print Mem Type(3)')).toThrow(/Address error/)
  })

  it('Mem Type reports the manual bit table for a bank, and 0 off the map', () => {
    // APPROXIMATED: chip against fast is a flag on the bank here, not a
    // property of the address. Reserve As Work is fast, Reserve As Chip Work
    // is chip, and both are public.
    expect(val('Mem Type(Start(5))', 'Reserve As Work 5,16\n')).toBe('5')
    expect(val('Mem Type(Start(5))', 'Reserve As Chip Work 5,16\n')).toBe('3')
    expect(val('Mem Type(2)')).toBe('0')
  })

  it('Mem Scramble and Mem Unscramble round-trip a range in place', () => {
    const b = withBank(
      [1, 2, 3, 4],
      'Mem Scramble Start(5) To Start(5)+3,"pw"\n' +
        'A=Peek(Start(5))\n' +
        'Mem Unscramble Start(5) To Start(5)+3,"pw"\n' +
        'Print A;Peek(Start(5));Peek(Start(5)+3)',
    )
    // the first number is the scrambled byte 0, then bytes 0 and 3 restored
    expect(b.out().trim().endsWith('1 4')).toBe(true)
  })

  it('Mem Scramble refuses a backwards range and an empty password', () => {
    expect(() => withBank([1, 2], 'Mem Scramble Start(5)+1 To Start(5),"pw"')).toThrow(/Illegal function call/)
    expect(() => withBank([1, 2], 'Mem Scramble Start(5) To Start(5)+1,""')).toThrow(/Illegal function call/)
  })

  it('the bank forms take a bank number and check it unsigned, so 0 and 17 fail', () => {
    expect(() => run('Reserve As Work 5,16\nMem Scramble 5,"pw"')).not.toThrow()
    expect(() => run('Mem Scramble 0,"pw"')).toThrow(/Illegal function call/)
    expect(() => run('Mem Scramble 17,"pw"')).toThrow(/Illegal function call/)
  })

  it('Mem Str Count counts over a range, inclusive of both ends', () => {
    const b = withBank([97, 98, 97, 98, 97], 'Print Mem Str Count(Start(5) To Start(5)+4,"ab")')
    expect(b.out().trim()).toBe('2')
  })

  it('DEFECT: the bank form reads one byte past the bank', () => {
    /*
     * Routine 15 hands routine 17 the bank LENGTH where every other caller
     * hands it a length minus one, so the dbf runs an extra iteration. Mem
     * Scramble and Mem Unscramble use the same resolver and DO subtract
     * (routines 38 and 40), which is what makes this an omission rather than
     * a convention.
     *
     * What the extra byte holds is the machine's business, and on an Amiga it
     * is whatever follows the bank. Here every bank sits alone in its own
     * megabyte of the synthesized map, so the byte past the end reads as
     * zero — which is enough to SEE the defect, with a NUL needle, and is the
     * only content it can ever be given.
     */
    const b = run(
      'Reserve As Work 5,4\n' +
        'For I=0 To 3 : Poke Start(5)+I,88 : Next\n' +
        'Print Mem Str Count(5,Chr$(0))\n' +
        'Print Mem Str Count(Start(5) To Start(5)+3,Chr$(0))',
    )
    const [bank, range] = b.out().trim().split('\n')
    expect(range).toBe(' 0')
    expect(bank).toBe('1')
  })
})

/** a runtime with RAM: mounted and a small tree in it */
function withFS(src: string, opts: { free?: number } = {}): { rt: Runtime; out: () => string } {
  const fs = new AmigaFS()
  const ram = fs.mountMemory('RAM')
  ram.freeBlocks = opts.free ?? 100
  fs.writeFile('RAM:notes.txt', Uint8Array.from('hello world', (c) => c.charCodeAt(0)))
  fs.mkdir('RAM:Docs')
  fs.writeFile('RAM:Docs/a.txt', Uint8Array.from('aaa', (c) => c.charCodeAt(0)))
  fs.writeFile('RAM:Docs/b.txt', Uint8Array.from('bb', (c) => c.charCodeAt(0)))
  const exts = new Map([[18, craft.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[18, craft]]),
    maxSteps: 500_000,
    fs,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const fsVal = (expr: string, pre = ''): string => withFS(`${pre}Print ${expr}`).out().trim()

describe('CRAFT 1.0 — Dr File$ and Dr Path$ (routines 41, 42, 43)', () => {
  it('splits at the last / or : and keeps the separator with the path', () => {
    expect(fsVal('Dr File$("DF0:Games/Foo.AMOS")')).toBe('Foo.AMOS')
    expect(fsVal('Dr Path$("DF0:Games/Foo.AMOS")')).toBe('DF0:Games/')
    expect(fsVal('Dr File$("DF0:Foo")')).toBe('Foo')
    expect(fsVal('Dr Path$("DF0:Foo")')).toBe('DF0:')
  })

  it('Dr Path$ answers empty when there is no separator at all', () => {
    expect(fsVal('"["+Dr Path$("Foo.AMOS")+"]"')).toBe('[]')
  })

  it('DEFECT: Dr File$ loses the first character when there is no separator', () => {
    /*
     * Routine 43 leaves a1 on the separator and routine 41 steps past it with
     * `addq.l #1,a1`. With nothing to find, a1 has walked down to the FIRST
     * CHARACTER instead, so the same step skips it — the length is right and
     * the start is one late.
     */
    expect(fsVal('"["+Dr File$("abc")+"]"')).toBe('[bc\x00]')
  })
})

describe('CRAFT 1.0 — the disk queries (routines 44..49)', () => {
  it('reports blocks free, used and sized from the volume', () => {
    // RAM: is a memory volume: used is measured from what is in it, and free
    // is whatever the caller set, because RAM: has no capacity of its own
    expect(fsVal('Db Size("RAM:")')).toBe('512')
    expect(fsVal('Db Used("RAM:")')).toBe('1')
    expect(fsVal('Db Free("RAM:")')).toBe('100')
  })

  it('answers -1 for every one of them when the volume is not there', () => {
    // the Lock fails, so Info never runs — the manual's "If there is no disc
    // in the drive, these functions return a value of -1"
    expect(fsVal('Db Free("DF7:")')).toBe('-1')
    expect(fsVal('Db Used("DF7:")')).toBe('-1')
    expect(fsVal('Db Size("DF7:")')).toBe('-1')
    expect(fsVal('Disc State("DF7:")')).toBe('-1')
  })

  it('Disc State subtracts 80, turning AmigaDOS 80/81/82 into 0/1/2', () => {
    expect(fsVal('Disc State("RAM:")')).toBe('2')
  })

  it('Disc Type$ cuts the longword at the first NUL, and is empty for no disk', () => {
    expect(fsVal('Disc Type$("RAM:")')).toBe('DOS')
    expect(fsVal('"["+Disc Type$("DF7:")+"]"')).toBe('[]')
  })
})

describe('CRAFT 1.0 — the file queries (routines 50..54)', () => {
  it('reads length, type, protection and comment off the FileInfoBlock', () => {
    expect(fsVal('File Length("RAM:notes.txt")')).toBe('11')
    // fib_DirEntryType: negative for a file, positive for a directory
    expect(Number(fsVal('File Type("RAM:notes.txt")'))).toBeLessThan(0)
    expect(Number(fsVal('File Type("RAM:Docs")'))).toBeGreaterThan(0)
    expect(fsVal('File Length("RAM:Docs")')).toBe('0')
  })

  it('round-trips a comment and the protection bits', () => {
    expect(fsVal('File Comment$("RAM:notes.txt")', 'Set Comment "RAM:notes.txt","a note"\n')).toBe('a note')
    expect(fsVal('File Protect("RAM:notes.txt")', 'Set Protect "RAM:notes.txt",5\n')).toBe('5')
    // "If you want to get rid of the comment, simply use empty string"
    expect(fsVal('"["+File Comment$("RAM:notes.txt")+"]"', 'Set Comment "RAM:notes.txt",""\n')).toBe('[]')
  })

  it('raises on an object that is not there, and remembers the AmigaDOS number', () => {
    // 205 is ERROR_OBJECT_NOT_FOUND, and routine 212 records IoErr before it
    // raises — which is what leaves it behind for =Disc Error to report
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    const exts = new Map([[18, craft.table]])
    const rt = new Runtime(tokenize('Print File Length("RAM:nope")', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[18, craft]]),
      maxSteps: 100_000,
      fs,
    })
    expect(() => mustFinish(rt.runHeadless(2000))).toThrow(/Illegal function call/)
    expect(rt.craft.ioError).toBe(205)
  })

  it('Set Comment refuses a note past the 79 the FileNote holds', () => {
    expect(() => withFS(`Set Comment "RAM:notes.txt",String$("x",80)`)).toThrow(/Illegal function call/)
    expect(() => withFS(`Set Comment "RAM:notes.txt",String$("x",79)`)).not.toThrow()
  })
})

describe('CRAFT 1.0 — the directory scanner (routines 59..67)', () => {
  it('Dr Name$ answers the directory own name and opens the scan', () => {
    // "It is always the name of the directory" — Examine on a lock gives the
    // locked object, not its first child
    expect(fsVal('Dr Name$("RAM:Docs")')).toBe('Docs')
  })

  it('Dr Next$ walks the entries and answers empty at the end', () => {
    const b = withFS('A$=Dr Name$("RAM:Docs")\nDo\nB$=Dr Next$\nExit If B$=""\nPrint B$\nLoop')
    expect(b.out().trim().split('\n').sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('the accessors read the entry Dr Next$ last handed out', () => {
    const b = withFS('A$=Dr Name$("RAM:Docs")\nB$=Dr Next$\nPrint B$;Dr Length;Dr Type<0')
    // a.txt is 3 bytes and is a file, so Dr Type is negative
    expect(b.out().trim()).toBe('a.txt 3-1')
  })

  it('DEFECT-adjacent: reading past the end is an error, because the block is freed', () => {
    /*
     * Routine 60 frees the scan block on ERROR_NO_MORE_ENTRIES before it
     * answers "", so the NEXT call finds nothing to read. The manual says so
     * without saying why: "If you continue reading the directory after
     * getting an empty string, an error will be caused".
     */
    expect(() =>
      withFS('A$=Dr Name$("RAM:Docs")\nA$=Dr Next$\nA$=Dr Next$\nA$=Dr Next$\nA$=Dr Next$'),
    ).toThrow(/Illegal function call/)
  })

  it('Dr Next$ after a Dr Name$ that named a FILE is an error, not an empty string', () => {
    // `tst.l $4(a2) / Rbmi routine 212` on the saved fib_DirEntryType
    expect(() => withFS('A$=Dr Name$("RAM:notes.txt")\nA$=Dr Next$')).toThrow(/Illegal function call/)
  })

  it('Dr Forget closes the scan, so the accessors stop answering', () => {
    expect(() => withFS('A$=Dr Name$("RAM:Docs")\nDr Forget\nPrint Dr Length')).toThrow(/Illegal function call/)
  })

  it('Dr Fib hands back an address the FileInfoBlock can be Peeked at', () => {
    // routine 65 is `move.l a2,d3 / addq.l #8,d3` — the block's address, which
    // is why this port maps it rather than keeping a record
    const b = withFS(
      'A$=Dr Name$("RAM:Docs")\nB$=Dr Next$\nF=Dr Fib\n' +
        'Print Str Peek$(F+8,5);" ";Leek(F+124);" ";Deek(F+4)',
    )
    // fib_FileName at +8, fib_Size at +124, and the high word of fib_DirEntryType
    // fib_FileName at +8, fib_Size at +124, and Deek(F+4) is the HIGH word of
    // fib_DirEntryType — -3 for a file, so $ffff
    expect(b.out().trim()).toBe('a.txt  3  65535')
  })

  it('Dr Fib is the address the region publishes', () => {
    const b = withFS('A$=Dr Name$("RAM:Docs")\nPrint Dr Fib')
    expect(Number(b.out().trim())).toBe(Runtime.CRAFT_FIB_BASE)
  })
})
