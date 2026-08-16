import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { craftKey, craftScramble, craftUnscramble, CRAFT_CIPHER_TABLE, CRAFT_AMOS_BASE, TR } from './craft'

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

  it('Disc Error reports the AmigaDOS code, not the AMOS one', () => {
    /*
     * Routine 212 stores IoErr before it maps the code through the table at
     * $32e8, and routine 58 hands back the stored one. 205 is
     * ERROR_OBJECT_NOT_FOUND, which the map turns into AMOS's error 23 --
     * two different numbers for one failure, and this is the keyword that
     * sees the AmigaDOS half.
     */
    const b = withFS('E=0\nOn Error Goto SKIP\nA=File Length("RAM:nope.txt")\nSKIP:\nPrint Disc Error')
    expect(b.out().trim()).toBe('205')
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

  it('Dr Comment$ and Dr Protect read the same block as the rest', () => {
    // fib_Comment and fib_Protection out of the one FileInfoBlock, so they
    // answer for whatever Dr Next$ left there
    const b = withFS(
      'Set Comment "RAM:Docs/a.txt","first"\nSet Protect "RAM:Docs/a.txt",5\n' +
        'A$=Dr Name$("RAM:Docs")\nRepeat \nB$=Dr Next$\nUntil B$="a.txt" or B$=""\nPrint Dr Comment$;Dr Protect',
    )
    expect(b.out().trim()).toBe('first 5')
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

describe('CRAFT 1.0 — the colour guns (routines 68..75)', () => {
  it('Pal Red/Green/Blue slice the nibbles out of a colour register', () => {
    expect(val('Pal Red(1);Pal Green(1);Pal Blue(1)', 'Colour 1,$C5A\n')).toBe('12 5 10')
  })

  it('Set Red/Green/Blue change one nibble and leave the other two', () => {
    expect(val('Colour(3)', 'Colour 3,$123\nSet Red 3,15\n')).toBe(String(0xf23))
    expect(val('Colour(3)', 'Colour 3,$123\nSet Green 3,15\n')).toBe(String(0x1f3))
    expect(val('Colour(3)', 'Colour 3,$123\nSet Blue 3,15\n')).toBe(String(0x12f))
  })

  it('the setters clamp instead of erroring, exactly as the manual promises', () => {
    // "you don't have to worry whether the value is too big or too small
    // because these instructions automatically convert them (x>15 => x=15 and
    // x<0 => x=0)"
    expect(val('Colour(3)', 'Colour 3,$000\nSet Red 3,99\n')).toBe(String(0xf00))
    expect(val('Colour(3)', 'Colour 3,$FFF\nSet Red 3,-99\n')).toBe(String(0x0ff))
  })

  it('a NEGATIVE argument is a colour VALUE, not a register', () => {
    /*
     * Routine 74 peeks the high word with `tst.w (a3)`, and a negative
     * argument is popped, negated and handed straight back for the caller to
     * slice: "if it's negative, the function returns a value which is
     * calculated by taking the current component out of the absolute value of
     * the parameter, which is considered a colour value". No screen register
     * is read at all.
     */
    expect(val('Pal Red(-$F0A);Pal Green(-$F0A);Pal Blue(-$F0A)')).toBe('15 0 10')
  })

  it('UNDOCUMENTED: registers 32..63 read the half-brite value of register n-32', () => {
    /*
     * `btst #5,d2` on the colour number, then `lsr.w #1 / andi.w #$777`. The
     * manual's only trace of this is the parenthesis "(0-63)" under Pal Red,
     * and the test is on the NUMBER rather than on the screen -- a 16-colour
     * screen answers the halved value just the same, because nothing here
     * asks whether Extra Half Brite is switched on.
     */
    expect(val('Pal Red(33);Pal Green(33);Pal Blue(33)', 'Colour 1,$E85\n')).toBe('7 4 2')
    // the mask is applied AFTER the shift, so the bottom bit of each nibble
    // falls into the next one down and is then cut away
    expect(val('Pal Blue(33)', 'Colour 1,$011\n')).toBe('0')
  })

  it("DEFECT: the setter's bound is 32 where the getter's is 64", () => {
    // routine 74 is `cmpi.w #$40,d1`, routine 75 `moveq #$20,d0 / cmp.l d0,d3`
    expect(val('Pal Red(40)', 'Colour 8,$F00\n')).toBe('7')
    expect(() => run('Set Red 40,15')).toThrow(/Illegal function call/)
    expect(() => run('Print Pal Red(64)')).toThrow(/Illegal function call/)
  })

  it('every one of the six wants a screen open', () => {
    expect(() => run('Screen Close 0\nPrint Pal Red(0)')).toThrow(/Screen not opened/)
    expect(() => run('Screen Close 0\nSet Red 0,1')).toThrow(/Screen not opened/)
  })
})

describe('CRAFT 1.0 — the register keywords (routines 76..78)', () => {
  it('Pal Copy takes col1 to col2, one way only', () => {
    expect(val('Colour(1);Colour(2)', 'Colour 1,$ABC\nColour 2,$123\nPal Copy 1 To 2\n')).toBe('2748 2748')
    expect(val('Colour(1);Colour(2)', 'Colour 1,$ABC\nColour 2,$123\nPal Copy 2 To 1\n')).toBe('291 291')
  })

  it('Pal Swap exchanges two registers', () => {
    expect(val('Colour(1);Colour(2)', 'Colour 1,$ABC\nColour 2,$123\nPal Swap 1,2\n')).toBe('291 2748')
  })

  it('Pal Spread ramps the registers between its two ends', () => {
    /*
     * $000 to $FFF over four steps is $444, $777, $BBB -- and the middle one
     * is the arithmetic showing through. Each component runs in an
     * accumulator with eight fractional bits and a bias of +127 added once,
     * where rounding would want +128; the step here is exactly 960, so the
     * halfway value is 2047 and its nibble is 7 rather than the 8 one unit of
     * bias more would have given.
     */
    const pre = 'Colour 0,$000\nColour 4,$FFF\nPal Spread 0 To 4\n'
    expect(val('Colour(1);Colour(2);Colour(3)', pre)).toBe(`${0x444} ${0x777} ${0xbbb}`)
  })

  it('Pal Spread sorts its ends, so the ramp always runs low to high', () => {
    /*
     * `sub.w d0,d1 / bcc / neg.w d1 / sub.w d1,d0` leaves the LOWER register
     * in d0 whichever way round the caller wrote them, and the ramp then runs
     * from the value AT the low register towards the value at the high one.
     * Writing it backwards does not reverse the gradient.
     */
    const up = 'Colour 0,$000\nColour 4,$FFF\nPal Spread 0 To 4\n'
    const down = 'Colour 0,$000\nColour 4,$FFF\nPal Spread 4 To 0\n'
    expect(val('Colour(1);Colour(3)', up)).toBe(val('Colour(1);Colour(3)', down))
  })

  it('Pal Spread rewrites its far end, harmlessly, and touches nothing outside', () => {
    /*
     * The loop runs `distance` times starting at the low register's
     * neighbour, so its LAST write lands on col2 itself rather than stopping
     * short of it. That is invisible, and provably so: the accumulated value
     * is `target + 127 - r` where r is the truncated remainder, r is at most
     * distance-1 and distance is at most 31, so 127 - r never borrows out of
     * the nibble. col2 is rewritten with exactly what it held.
     *
     * Outside col1..col2 nothing is written at all -- the buffer starts as 32
     * words of the $FFFF marker and only the run is filled in.
     */
    const b = run('Colour 0,$000\nColour 7,$FFF\nColour 9,$789\nPal Spread 0 To 7\nPrint Colour(7);Colour(9)')
    expect(b.out().trim()).toBe(`${0xfff} ${0x789}`)
  })

  it('Pal Spread does nothing at all for adjacent or equal registers', () => {
    // `beq` on the difference, then `cmpi.w #1,d1 / bne`
    expect(val('Colour(4)', 'Colour 3,$000\nColour 4,$FFF\nPal Spread 3 To 4\n')).toBe(String(0xfff))
    expect(val('Colour(3)', 'Colour 3,$ABC\nPal Spread 3 To 3\n')).toBe(String(0xabc))
  })

  it('all three refuse a register of 32 or more', () => {
    expect(() => run('Pal Copy 0 To 32')).toThrow(/Illegal function call/)
    expect(() => run('Pal Swap 32,0')).toThrow(/Illegal function call/)
    expect(() => run('Pal Spread 0 To 32')).toThrow(/Illegal function call/)
  })
})

describe('CRAFT 1.0 — palette banks (routines 79..94)', () => {
  it('Reserve As Palette makes a bank of the size the record layout implies', () => {
    // 8 bytes of name and 64 per palette, so three palettes is 200 on the
    // machine -- this port keeps the name beside the data, so Length is 192
    const b = run('Reserve As Palette 5,3\nPrint Length(5);Pal Count(5)')
    expect(b.out().trim()).toBe('192 3')
  })

  it('Pal Count answers zero for a bank that is not there', () => {
    // "If the bank is empty a value of zero is returned" -- d2 = 3 is the one
    // mode routine 94 lets past its `tst.w d2 / Rbeq routine 209`
    expect(val('Pal Count(9)')).toBe('0')
  })

  it('Pal To Bank and Pal From Bank carry a palette out and back', () => {
    const b = run(
      'Reserve As Palette 5,2\nColour 1,$ABC\nPal To Bank 5,2\n' +
        'Colour 1,$000\nPal From Bank 5,2\nPrint Colour(1)',
    )
    expect(b.out().trim()).toBe(String(0xabc))
  })

  it('the one-argument Pal To Bank creates a one-palette bank', () => {
    // routine 81: `moveq #1,d0 / move.l d0,-(a3) / moveq #1,d2`
    const b = run('Colour 1,$ABC\nPal To Bank 7\nPrint Length(7);Pal Count(7);Bank Colour(7,1,1)')
    expect(b.out().trim()).toBe(`64 1 ${0xabc}`)
  })

  it('QUIRK: only the three-argument form creates a bank when n is left out', () => {
    /*
     * Routine 83 alone tests the stacked palette against $80000000, AMOS's
     * omitted-parameter marker, and sets d2 = 1 when it finds it. Routine 82,
     * the two-argument trampoline, does not look -- so the same omission
     * reserves a bank in one form and is error 36 in the other.
     */
    expect(() => run('Pal To Bank 6,,-1')).not.toThrow()
    expect(() => run('Pal To Bank 6,')).toThrow(/Bank not reserved/)
  })

  it('a mask writes ABSENCE over what it excludes, rather than skipping it', () => {
    /*
     * Routine 84 stores $FFFF where the mask bit is clear, and $FFFF is the
     * marker AMOS's own palette routine passes over. So a second Pal To Bank
     * with a narrower mask does not leave the first one's colours behind: it
     * deletes them, and =Bank Colour answers -1 for what is gone.
     */
    const b = run(
      'Reserve As Palette 5,1\nColour 1,$111\nColour 2,$222\nPal To Bank 5,1,%110\n' +
        'Pal To Bank 5,1,%10\nPrint Bank Colour(5,1,1);Bank Colour(5,1,2)',
    )
    expect(b.out().trim()).toBe(`${0x111}-1`)
  })

  it('an absent colour is left unchanged on the way back in', () => {
    // "if you use Pal From Bank or Pal Swap Bank, the colour index whose
    // representative is deleted from a bank, won't be changed"
    const b = run(
      'Colour 1,$111\nColour 2,$222\nPal To Bank 5\nDel Bank Colour 5,1,2\n' +
        'Colour 1,$000\nColour 2,$999\nPal From Bank 5\nPrint Colour(1);Colour(2)',
    )
    expect(b.out().trim()).toBe(`${0x111} ${0x999}`)
  })

  it('Pal Swap Bank really swaps, in both directions at once', () => {
    const b = run(
      'Colour 1,$111\nPal To Bank 5\nColour 1,$222\nPal Swap Bank 5\n' +
        'Print Colour(1);Bank Colour(5,1,1)',
    )
    expect(b.out().trim()).toBe(`${0x111} ${0x222}`)
  })

  it('DEFECT: a masked Pal Swap Bank erases the bank colours it did not swap', () => {
    /*
     * Routine 90's return leg is the same masked copy as its outward one, so
     * the bank's excluded slots are written with $FFFF rather than left
     * alone. The manual claims only that the mask "limits the colours
     * transferred from the bank"; nothing warns that the ones it does not
     * transfer are destroyed.
     */
    const b = run(
      'Colour 1,$111\nColour 2,$222\nPal To Bank 5\nPal Swap Bank 5,1,%10\n' +
        'Print Bank Colour(5,1,1);Bank Colour(5,1,2)',
    )
    expect(b.out().trim()).toBe(`${0x111}-1`)
  })

  it('Set Bank Colour writes one slot, and -1 alone deletes it', () => {
    /*
     * `moveq #$ff,d0 / cmp.l d0,d7 / beq` -- the comparison is against minus
     * one as a LONGWORD and only that exact value skips the `andi.w #$fff`.
     * So -1 is Del Bank Colour by another name and -2 is an ordinary $ffe.
     */
    const b = run(
      'Reserve As Palette 5,1\nSet Bank Colour 5,1,3,$ABC\nSet Bank Colour 5,1,4,-1\n' +
        'Set Bank Colour 5,1,5,-2\nPrint Bank Colour(5,1,3);Bank Colour(5,1,4);Bank Colour(5,1,5)',
    )
    expect(b.out().trim()).toBe(`${0xabc}-1 ${0xffe}`)
  })

  it('the palette number may be written as nothing, and means the first', () => {
    /*
     * "If you omit the parameter n, the instruction will affect the first
     * palette stored in the bank" -- routine 94 turns the $80000000 marker
     * into 1 for every keyword in the group, not just Set Bank Colour. Read
     * back through the FUNCTION with the palette spelled out, because an
     * elided function argument reaches this port as -1 and cannot be told
     * apart from one the caller wrote.
     */
    const b = run('Reserve As Palette 5,2\nSet Bank Colour 5,,3,$ABC\nDel Bank Colour 5,,4\n' +
      'Print Bank Colour(5,1,3);Bank Colour(5,1,4)')
    expect(b.out().trim()).toBe(`${0xabc}-1`)
  })

  it('a reserved bank that is not a palette bank is CRAFT own error', () => {
    /*
     * Routine 94 compares the bank's first eight bytes against "Palettes"
     * before it judges the length, and routine 216 is `moveq #3,d0 / Rbra
     * routine 218` -- index 3 of the message table at $334c.
     */
    expect(() => run('Reserve As Work 5,4096\nPal To Bank 5,1')).toThrow(/Not a palette bank/)
    expect(() => run('Reserve As Work 5,4096\nPrint Pal Count(5)')).toThrow(/Not a palette bank/)
    // and the name check comes FIRST: a too-short bank still reports this
    expect(() => run('Reserve As Work 5,8\nPal To Bank 5,1')).toThrow(/Not a palette bank/)
  })

  it('Reserve As Palette refuses a bank that is already there', () => {
    // d2 = 2 is checked before the name is, so it never reports on contents
    expect(() => run('Reserve As Palette 5,1\nReserve As Palette 5,1')).toThrow(/Bank already reserved/)
    expect(() => run('Reserve As Work 5,64\nReserve As Palette 5,1')).toThrow(/Bank already reserved/)
  })

  it('asking for a palette the bank does not hold is error 36', () => {
    // `cmp.l d0,d3 / bls` against `length - 72`, then `tst.w d2 / Rbmi 209`
    expect(() => run('Reserve As Palette 5,2\nPal To Bank 5,3')).toThrow(/Bank not reserved/)
    expect(() => run('Reserve As Palette 5,2\nPal From Bank 5,2')).not.toThrow()
  })

  it('the bank number is 1..16 and the colour index 0..31', () => {
    expect(() => run('Pal To Bank 0')).toThrow(/Illegal function call/)
    expect(() => run('Pal To Bank 17')).toThrow(/Illegal function call/)
    expect(() => run('Reserve As Palette 5,1\nSet Bank Colour 5,1,32,0')).toThrow(/Illegal function call/)
    expect(() => run('Reserve As Palette 5,1\nPrint Bank Colour(5,1,32)')).toThrow(/Illegal function call/)
  })

  it('a palette bank is a Data bank, so Erase Temp spares it', () => {
    // routine 94 allocates with `bset #31,d1` on the length, which is
    // Bnk_BitData -- the same bit Reserve As Data sets and Reserve As Work
    // leaves clear
    const b = run('Reserve As Palette 5,1\nReserve As Work 6,64\nErase Temp\nPrint Pal Count(5);Length(6)')
    expect(b.out().trim()).toBe('1 0')
  })
})

describe('CRAFT 1.0 — the turtle (routines 95..137)', () => {
  /** the pixels a turtle path left on screen 0, which draws in the current ink */
  const drawn = (src: string): number[][] => {
    const b = boot(src)
    mustFinish(b.rt.runHeadless(5000))
    const s = b.rt.screens.get(0)!
    const out: number[][] = []
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (s.point(x, y) === s.ink) out.push([x, y])
    return out
  }

  it('starts in the middle of the screen, facing north, with the pen down', () => {
    // routine 113 seeds the position from the screen and routine 98 leaves
    // bit 2 of the flags clear, which is the pen DOWN
    expect(val('Tr X Pos;Tr Y Pos;Tr Get Angle;Tr Pen State')).toBe('160 100 0-1')
  })

  it('walks the eight compass points, and north is up', () => {
    /*
     * Routine 109 hands back dx = sin and dy = MINUS cos, so a heading of
     * zero is (0, -1) and the turtle climbs the screen. The diagonals land on
     * 70.7 pixels of each, which the half-pixel fraction rounds to 71.
     */
    const at = (a: number): string => val('Tr X Pos;Tr Y Pos', `Tr Angle ${a}\nTr Forward 100\n`)
    expect([0, 45, 90, 135].map(at)).toEqual(['160 0', '231 29', '260 100', '231 171'])
    expect([180, 225, 270, 315].map(at)).toEqual(['160 200', '89 171', '60 100', '89 29'])
  })

  it('closes a thirty-six step circle exactly, which is the whole fixed point', () => {
    /*
     * Twenty pixels forward and ten degrees right, thirty-six times. Every
     * one of those steps goes through the sine series, the square root and a
     * 16.16 accumulate, and the position is only ever rounded when it is
     * READ -- so a turtle that comes back to 160,100 is a turtle whose
     * arithmetic has not drifted a part in 65536 over 36 turns.
     */
    expect(val('Tr X Pos;Tr Y Pos;Tr Get Angle', 'Tr Exec "F 20;R 10",36\n')).toBe('160 100 0')
  })

  it('Tr Forw is Tr Forward, the same routine under a second name', () => {
    // both token entries carry instruction 0x6b, so this is an alias and not
    // a second keyword -- "Tr Forw is simply a shortened form of Tr Forward"
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Angle 90\nTr Forw 25\n')).toBe('185 100')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Angle 90\nTr Forward 25\n')).toBe('185 100')
  })

  it('Tr Angle takes any integer and Tr Get Angle answers -179..180', () => {
    // "there is no difference between using 180 or 540 (360+180)", and
    // routine 100's last two instructions turn -180 into +180
    expect(val('Tr Get Angle', 'Tr Angle 540\n')).toBe('180')
    expect(val('Tr Get Angle', 'Tr Angle -180\n')).toBe('180')
    expect(val('Tr Get Angle', 'Tr Angle 725\n')).toBe('5')
    expect(val('Tr Get Angle', 'Tr Angle -725\n')).toBe('-5')
  })

  it('Tr Right and Tr Left turn relative to where the turtle already points', () => {
    expect(val('Tr Get Angle', 'Tr Angle 90\nTr Right 45\n')).toBe('135')
    expect(val('Tr Get Angle', 'Tr Angle 90\nTr Left 45\n')).toBe('45')
  })

  it('Tr Towards aims at a point, and the angle is recovered from the direction', () => {
    /*
     * Tr Towards writes the direction and marks the ANGLE stale, so reading
     * it back runs routine 106 -- the arcsine series over the coefficient
     * table -- rather than handing back what was stored.
     */
    const to = (x: number, y: number): string => val('Tr Get Angle', `Tr Towards ${x},${y}\n`)
    expect([to(210, 100), to(160, 50), to(210, 50), to(160, 150)]).toEqual(['90', '0', '45', '180'])
    expect([to(110, 100), to(110, 50), to(110, 150), to(210, 150)]).toEqual(['-90', '-45', '-135', '135'])
  })

  it('Tr Towards a point the turtle is already on turns it not at all', () => {
    // `sub.l d3,d1 / bne / tst.l d0 / bne / rts` -- the check routine 121 has
    // no equivalent of
    expect(val('Tr Get Angle', 'Tr Angle 33\nTr Towards Tr X Pos,Tr Y Pos\n')).toBe('33')
  })

  it('Tr Distance is Pythagoras over the same normalising shift', () => {
    expect(val('Tr Distance(160,150);Tr Distance(190,140);Tr Distance(100,100)')).toBe('50 50 60')
  })

  it('DEFECT: Tr Distance to the turtle own position never returns on a real Amiga', () => {
    /*
     * Routine 121 normalises with `lsl.l #1,d0 / bcs / lsl.l #1,d1 / bcc`
     * looping back on itself, and with both deltas zero a carry can never
     * appear. Tr Towards tests for that pair before it starts; this does not.
     * DEVIATION: a port cannot hang, so it answers the 0 the arithmetic would
     * have reached.
     */
    expect(val('Tr Distance(Tr X Pos,Tr Y Pos)')).toBe('0')
  })

  it('the pen decides whether a step leaves a line behind', () => {
    expect(drawn('Tr Pen Up\nTr Forward 10')).toEqual([])
    const line = drawn('Tr Forward 10')
    expect(line.length).toBe(11)
    expect(line[0]).toEqual([160, 90])
    expect(line[10]).toEqual([160, 100])
  })

  it('Tr Move jumps without drawing and Tr Draw draws without turning', () => {
    expect(drawn('Tr Move 10,10')).toEqual([])
    const l = drawn('Tr Move 10,10\nTr Draw 10,14')
    expect(l).toEqual([
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [10, 14],
    ])
    expect(val('Tr Get Angle;Tr X Pos;Tr Y Pos', 'Tr Angle 90\nTr Move 10,10\nTr Draw 20,10\n')).toBe('90 20 10')
  })

  it('either coordinate of Tr Move may be written as nothing', () => {
    // "Either parameter may be omitted, just remember to write the comma"
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 10,20\nTr Move 30,\n')).toBe('30 20')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 10,20\nTr Move ,40\n')).toBe('10 40')
  })

  it('DEFECT: an omitted y on Tr Draw doubles the coordinate instead of keeping it', () => {
    /*
     * Routine 116 makes a delta out of the target by subtracting the current
     * position, but routine 118 answers an omission by zeroing d0 and the
     * subtraction that would have made d1 a delta is skipped with it. So d1
     * is still the CURRENT y that routine 113 left in it, and routine 119
     * adds that to the position. An omitted x is fine, because there the
     * zero really is the delta that changes nothing.
     */
    // 121 and not 120: the half-pixel fraction the position carries doubles
    // along with the whole part
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 50,60\nTr Draw 100,\n')).toBe('100 121')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 50,60\nTr Draw ,80\n')).toBe('50 80')
  })

  it('the Rel forms take a step rather than a place', () => {
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 50,60\nTr Move Rel 10,-20\n')).toBe('60 40')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 50,60\nTr Draw Rel -10,20\n')).toBe('40 80')
  })

  it('Tr Proportions scales the relative movers and nothing else', () => {
    // "This instruction affects the Tr Forw, Tr Back, Tr Move Rel and Tr Draw
    // Rel instructions and their TCL counterparts"
    expect(val('Tr X Pos', 'Tr Proportions 2\nTr Angle 90\nTr Forward 50\n')).toBe('260')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Proportions 2,3\nTr Move Rel 10,10\n')).toBe('180 130')
    // absolute moves are in screen pixels whatever the coefficients say
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Proportions 2,3\nTr Move 10,10\n')).toBe('10 10')
  })

  it('one coefficient sets both, and zero or past sixteen is refused', () => {
    // routine 125 is `move.l (a3),-(a3)`, a duplicate of the stacked value
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Proportions -2\nTr Move Rel 10,10\n')).toBe('140 80')
    expect(() => run('Tr Proportions 0')).toThrow(/Illegal function call/)
    expect(() => run('Tr Proportions 17')).toThrow(/Illegal function call/)
    expect(() => run('Tr Proportions -16')).not.toThrow()
    // and putting both back to one switches the scaling off again
    expect(val('Tr X Pos', 'Tr Proportions 4\nTr Proportions 1\nTr Move Rel 10,\n')).toBe('170')
  })

  it('the home starts in the middle and Tr Home returns to it', () => {
    expect(val('Tr X Home;Tr Y Home')).toBe('160 100')
    expect(val('Tr X Pos;Tr Y Pos;Tr Get Angle', 'Tr Angle 90\nTr Move 10,10\nTr Home\n')).toBe('160 100 0')
    expect(val('Tr X Home;Tr Y Home', 'Tr Set Home 20,30\n')).toBe('20 30')
  })

  it('DEFECT: Tr Set Home crosses its two fallbacks', () => {
    /*
     * The first value off the stack is y and its omitted case loads $44, the
     * home X; the second is x and its omitted case loads $48, the home Y. So
     * leaving one out copies the OTHER coordinate over it. Routine 114
     * reaches the same "keep what was there" a different way and gets it
     * right, which is what makes this a slip.
     */
    expect(val('Tr X Home;Tr Y Home', 'Tr Set Home 20,30\nTr Set Home 99,\n')).toBe('99 20')
    expect(val('Tr X Home;Tr Y Home', 'Tr Set Home 20,30\nTr Set Home ,99\n')).toBe('30 99')
  })

  it('DEFECT: Tr Home cannot reach a home with a negative coordinate', () => {
    // `moveq #0,d0 / move.w $44(a1),d0` ZERO-extends the integer half, so -10
    // arrives at routine 118 as 65526 and is thrown out
    expect(val('Tr X Home', 'Tr Set Home -10,50\n')).toBe('-10')
    expect(() => run('Tr Set Home -10,50\nTr Home')).toThrow(/Illegal function call/)
  })

  it('Tr Remember and Tr Memorize are one slot each, not a stack', () => {
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 20,30\nTr Remember X\nTr Move 90,90\nTr Memorize X\n')).toBe('20 90')
    expect(val('Tr Get Angle', 'Tr Angle 45\nTr Remember A\nTr Angle 90\nTr Memorize A\n')).toBe('45')
    // the second Remember replaces the first
    expect(val('Tr X Pos', 'Tr Move 20,30\nTr Remember X\nTr Move 40,30\nTr Remember X\nTr Memorize X\n')).toBe('40')
  })

  it('the first Remember primes the other slot from the matching home', () => {
    // routines 131 and 132 each `bset #6` and, if the bit was clear, copy the
    // home coordinate into the slot they did NOT just write
    expect(val('Tr Y Pos', 'Tr Set Home 20,30\nTr Move 90,90\nTr Remember X\nTr Memorize Y\n')).toBe('30')
    // and with nothing remembered at all, Memorize lands on the home
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Set Home 20,30\nTr Move 90,90\nTr Memorize X\nTr Memorize Y\n')).toBe('20 30')
  })

  it('Tr Reset puts everything back, including the pen and the home', () => {
    // "the angle is set to the zero and the pen is set down... the turtle is
    // returned to the home, whose coordinates are also reset... the
    // instruction also resets the positions stored with the Tr Remember"
    const pre = 'Tr Angle 90\nTr Pen Up\nTr Set Home 5,5\nTr Move 90,90\nTr Remember X\nTr Reset\n'
    expect(val('Tr X Pos;Tr Y Pos;Tr Get Angle;Tr Pen State;Tr X Home', pre)).toBe('160 100 0-1 160')
  })

  it('Tr Base publishes the block the manual sends the reader to Peek', () => {
    const b = run('Tr Angle 90\nTr Move 20,30\nB=Tr Base\nPrint Peek(B);Leek(B+14);Leek(B+18);Deek(B+2)')
    // flags: angle live, direction stale, placed; then x and y in 16.16, and
    // the top word of the heading, which is $4000 for a right angle
    expect(b.out().trim()).toBe(`9 ${(20 << 16) | 0x8000} ${(30 << 16) | 0x8000} 16384`)
  })
})

describe('CRAFT 1.0 — TCL, the Turtle Control Language (routine 96)', () => {
  it('runs a semicolon-separated string of commands', () => {
    expect(val('Tr X Pos;Tr Y Pos;Tr Get Angle', 'Tr Exec "F 50;R 90;F 30"\n')).toBe('190 50 90')
  })

  it('takes the long spelling as well as the short, because lower case is skipped', () => {
    // "Only capital letters are necessary in command names"
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Exec "Forward 50;Right 90;Forw 30"\n')).toBe('190 50')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Exec "MoveRel 5,5;DrawRel 5,5"\n')).toBe('170 110')
  })

  it("QUIRK: HOME in full capitals is a syntax error where Home and H are not", () => {
    /*
     * The collector takes at most two capitals, and `H` is cut to one by an
     * instruction of its own -- there is no two-letter command starting with
     * H, so a second capital could only make a name that is not in the table.
     * That leaves OME to be read as the next command, and OM is not one.
     */
    expect(() => run('Tr Exec "Home"')).not.toThrow()
    expect(() => run('Tr Exec "H"')).not.toThrow()
    expect(() => run('Tr Exec "HOME"')).toThrow(/Turtle error: bad syntax/)
  })

  it('the count repeats the whole string, and zero runs it not at all', () => {
    expect(val('Tr Y Pos', 'Tr Exec "F 10",4\n')).toBe('60')
    expect(val('Tr Y Pos', 'Tr Exec "F 10",0\n')).toBe('100')
    // `cmpi.l #$7d0,d0 / Rbhi routine 206` is UNSIGNED, so a negative count
    // is a very large one
    expect(() => run('Tr Exec "F 1",2001')).toThrow(/Illegal function call/)
    expect(() => run('Tr Exec "F 1",-1')).toThrow(/Illegal function call/)
  })

  it('reports a bad command, a bad argument and a wrong argument count separately', () => {
    expect(() => run('Tr Exec "XX 1"')).toThrow(/Turtle error: bad syntax/)
    expect(() => run('Tr Exec "F 1,2"')).toThrow(/Turtle error: illegal number of parameters/)
    expect(() => run('Tr Exec "H 1"')).toThrow(/Turtle error: illegal number of parameters/)
    expect(() => run('Tr Exec "M 1"')).toThrow(/Turtle error: illegal number of parameters/)
    // routine 217 sees bit 4 of the flags and raises CRAFT's error rather
    // than AMOS's for an argument outside routine 118's bound
    expect(() => run('Tr Exec "F 99999"')).toThrow(/Turtle error: illegal function call/)
    expect(() => run('Tr Forward 99999')).toThrow(/Illegal function call/)
  })

  it('Tr Error is the position of the command that failed, and zero after a clean run', () => {
    // $58 - $56: the length plus one, less what was left when it started
    const b = boot('Tr Exec "F 10;R 90;ZZ"')
    expect(() => mustFinish(b.rt.runHeadless(5000))).toThrow(/bad syntax/)
    expect(b.rt.craft.turtle.getUint16(TR.total) - b.rt.craft.turtle.getUint16(TR.left)).toBe(11)
    expect(val('Tr Error', 'Tr Exec "F 10"\n')).toBe('0')
  })

  it('I and P are the only commands with no keyword behind them', () => {
    // "This instruction is a synonym to the Pen instruction"
    const b = run('Tr Exec "P 5,3"')
    expect([b.rt.screen.ink, b.rt.screen.gPaper]).toEqual([5, 3])
    expect(run('Tr Exec "I 7"').rt.screen.ink).toBe(7)
    expect(() => run('Tr Exec "I 32"')).toThrow(/Turtle error: illegal function call/)
  })

  it('every other command is the keyword routine, reached a second way', () => {
    const pairs: Array<[string, string]> = [
      ['A 90', 'Tr Angle 90'],
      ['L 30', 'Tr Left 30'],
      ['R 30', 'Tr Right 30'],
      ['B 20', 'Tr Back 20'],
      ['TO 10,10', 'Tr Towards 10,10'],
      ['M 40,50', 'Tr Move 40,50'],
      ['MR 4,5', 'Tr Move Rel 4,5'],
      ['D 40,50', 'Tr Draw 40,50'],
      ['DR 4,5', 'Tr Draw Rel 4,5'],
      ['SH 12,13', 'Tr Set Home 12,13'],
      ['H', 'Tr Home'],
      ['PU', 'Tr Pen Up'],
      ['PD', 'Tr Pen Down'],
      ['RX', 'Tr Remember X'],
      ['RY', 'Tr Remember Y'],
      ['RA', 'Tr Remember A'],
      ['MX', 'Tr Memorize X'],
      ['MY', 'Tr Memorize Y'],
      ['MA', 'Tr Memorize A'],
    ]
    const state = 'Print Tr X Pos;Tr Y Pos;Tr Get Angle;Tr X Home;Tr Y Home;Tr Pen State'
    for (const [tcl, kw] of pairs) {
      const viaTcl = run(`Tr Exec "F 7;R 20;${tcl}"\n${state}`).out()
      const viaKeyword = run(`Tr Forward 7\nTr Right 20\n${kw}\n${state}`).out()
      expect(viaTcl, tcl).toBe(viaKeyword)
    }
  })

  it('a number ends at a space, and a comma may stand for an omitted one', () => {
    // the `d3` flag in $1b6c is set by a space and tested before the next
    // digit, so "1 2" is two numbers rather than twelve
    expect(() => run('Tr Exec "M 1 2,3"')).toThrow(/Turtle error: illegal number of parameters/)
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 50,60\nTr Exec "M ,80"\n')).toBe('50 80')
    expect(val('Tr X Pos;Tr Y Pos', 'Tr Move 50,60\nTr Exec "M 70,"\n')).toBe('70 60')
  })
})

describe('CRAFT 1.0 — the fractal generator (routines 138..161)', () => {
  /** a rendered screen 0, read directly: Print would scroll text over the picture */
  const draw = (src: string): { at: (x: number, y: number) => number; row: (y: number, x0: number, n: number) => number[] } => {
    const b = boot(src)
    mustFinish(b.rt.runHeadless(20_000))
    const s = b.rt.screens.get(0)!
    return {
      at: (x, y) => s.point(x, y),
      row: (y, x0, n) => Array.from({ length: n }, (_, i) => s.point(x0 + i, y)),
    }
  }

  /** the standard setup: the whole screen, the origin at the top left, 1/128 per pixel */
  const SET = 'Fr Window 0\nFr Position 0,0\nFr Step 64\nFr Colour 0,5\n'

  it('the colour table starts as a byte counter and index zero means "in the set"', () => {
    // routine 149 allocates 1025 bytes and fills them with `move.b d2,(a0)+ /
    // addq.b #1,d2`, so it wraps every 256
    expect(val('Fr Get Colour(0);Fr Get Colour(1);Fr Get Colour(255);Fr Get Colour(256)')).toBe('0 1 255 0')
    expect(val('Fr Get Colour(7)', 'Fr Colour 7,31\n')).toBe('31')
    expect(() => run('Fr Colour 1025,1')).toThrow(/Illegal function call/)
    expect(() => run('Fr Colour 1,256')).toThrow(/Illegal function call/)
    expect(() => run('Print Fr Get Colour(1025)')).toThrow(/Illegal function call/)
  })

  it('the position and the step have to be set, and say so in CRAFT own words', () => {
    // routines 214 and 215, which are indices 1 and 2 of the message table
    expect(() => run('Print Fr X Position')).toThrow(/No fractal position defined/)
    expect(() => run('Print Fr X Step')).toThrow(/No fractal step specified/)
    expect(val('Fr X Position;Fr Y Position', 'Fr Position -100,200\n')).toBe('-100 200')
    expect(() => run('Fr Position 32768,0')).toThrow(/Illegal function call/)
  })

  it('a step is 1..1024 and one number sets both', () => {
    expect(val('Fr X Step;Fr Y Step', 'Fr Step 4\n')).toBe('4 4')
    expect(() => run('Fr Step 0')).toThrow(/Illegal function call/)
    expect(() => run('Fr Step 1025')).toThrow(/Illegal function call/)
    expect(() => run('Fr Step 1024')).not.toThrow()
  })

  it('DEFECT: the two-argument Fr Step never stores its second number', () => {
    /*
     * Routine 142 stores d0 into the y step where it means d2, and d0 is the
     * X argument. So both steps come out of the first number -- and when the
     * first is the one left out, d0 is the -1 that says so and the y step
     * becomes $ffff, sixty-four times the 1024 the routine has just finished
     * enforcing. Only the one-argument form works.
     */
    expect(val('Fr X Step;Fr Y Step', 'Fr Step 4,8\n')).toBe('4 4')
    expect(val('Fr X Step;Fr Y Step', 'Fr Step 4\nFr Step ,8\n')).toBe('4 65535')
    expect(val('Fr X Step;Fr Y Step', 'Fr Step 4\nFr Step 9,\n')).toBe('9 4')
  })

  it('draws the Mandelbrot set, and the origin is inside it', () => {
    /*
     * Position 0,0 with a step of 64 puts the complex origin at the top left
     * corner and walks 1/128 per pixel, so the whole of this window is the
     * cardioid's neighbourhood. Colour index 0 is a point that never escaped.
     */
    const d = draw(`${SET}Fr Mandelbrot 20`)
    expect(d.at(0, 0)).toBe(5)
    expect(d.at(0, 5)).toBe(5)
    // far enough out and it escapes on the first test: |c| over two
    expect(d.at(300, 0)).toBe(1)
  })

  it('walks the plane one step per pixel across and one DOWN the imaginary axis', () => {
    // `add.w (a7),d0` per pixel with the x step, and `sub.w $20(a1),d1` per
    // row -- SUBTRACTED, so the picture is the right way up mathematically
    const d = draw('Fr Window 0\nFr Position -16384,8192\nFr Step 128\nFr Colour 0,5\nFr Mandelbrot 50')
    // -2,+1 at the corner and 1/64 per pixel, so the origin is at 128,64
    expect(d.at(128, 64)).toBe(5)
    expect(d.at(96, 64)).toBe(5)
    expect(d.at(0, 0)).toBe(1)
  })

  it('Fr Julia takes its constant from the keyword where Fr Mandelbrot takes it from the pixel', () => {
    // "identical to the Fr Julia instruction" except for where c comes from,
    // which is the whole difference between routines 159 and 160
    const d = draw('Fr Window 0\nFr Position -16384,8192\nFr Step 128\nFr Colour 0,5\nFr Julia -820,1640,50')
    expect(d.at(128, 64)).toBe(5)
    expect(d.at(0, 0)).toBe(1)
  })

  it("DEFECT: Fr Mandelbrot refuses one iteration where Fr Julia accepts it", () => {
    // `subq.w #$1,d0 / Rbcs` in routine 159 against `Rbls` in routine 160:
    // BLS is carry OR zero, so the Mandelbrot arm throws out 1 as well as 0
    expect(() => run(`${SET}Fr Julia 0,0,1`)).not.toThrow()
    expect(() => run(`${SET}Fr Mandelbrot 1`)).toThrow(/Illegal function call/)
    expect(() => run(`${SET}Fr Mandelbrot 2`)).not.toThrow()
    expect(() => run(`${SET}Fr Mandelbrot 1025`)).toThrow(/Illegal function call/)
  })

  it('Fr Window bounds the picture, and one argument means the whole screen', () => {
    const d = draw(`Fr Window 0,10,10,20,10\nFr Position 0,0\nFr Step 64\nFr Colour 0,5\nFr Mandelbrot 20`)
    expect(d.row(10, 8, 4)).toEqual([1, 1, 5, 5])
    expect([d.at(29, 10), d.at(30, 10), d.at(10, 9), d.at(10, 20)]).toEqual([5, 1, 1, 1])
    // `Fr Window 0` pushes four omitted markers and falls into the five-argument
    // form, so it is `Fr Window 0,,,,` and covers everything -- the far corner
    // escapes on the first test, so it is index 1 and coloured to prove it
    expect(draw(`${SET}Fr Colour 1,6\nFr Mandelbrot 20`).at(319, 199)).toBe(6)
    expect(() => run('Fr Window 8')).toThrow(/Valid screen numbers/)
  })

  it('Fr Scan draws a band, and one line unless a height is given', () => {
    // routine 156 sets the height to ONE; Fr Scan All puts it back to 16384
    expect(draw(`${SET}Fr Scan 5,3\nFr Mandelbrot 20`).row(0, 0, 1).concat([])).toEqual([1])
    const band = draw(`${SET}Fr Scan 5,3\nFr Mandelbrot 20`)
    expect(Array.from({ length: 10 }, (_, y) => band.at(0, y))).toEqual([1, 1, 1, 1, 1, 5, 5, 5, 1, 1])
    const one = draw(`${SET}Fr Scan 5\nFr Mandelbrot 20`)
    expect(Array.from({ length: 8 }, (_, y) => one.at(0, y))).toEqual([1, 1, 1, 1, 1, 5, 1, 1])
  })

  it('a band draws the same pixels a whole picture would draw there', () => {
    // routine 161 recomputes the plane coordinate from the surviving corner,
    // `mulu.w $20(a1),d4 / neg.l d4 / add.w $1c(a1),d4`
    const whole = draw('Fr Window 0\nFr Position -16384,8192\nFr Step 128\nFr Colour 0,5\nFr Mandelbrot 30')
    const band = draw('Fr Window 0\nFr Position -16384,8192\nFr Step 128\nFr Colour 0,5\nFr Scan 64,1\nFr Mandelbrot 30')
    expect(band.row(64, 100, 40)).toEqual(whole.row(64, 100, 40))
  })

  it('the scan band is reset by every drawing instruction, and by Fr Scan All', () => {
    // "the scan area is always reset after a fractal drawing instruction"
    const twice = draw(`${SET}Fr Scan 5,3\nFr Mandelbrot 20\nFr Mandelbrot 20`)
    expect(twice.at(0, 0)).toBe(5)
    const cancelled = draw(`${SET}Fr Scan 5,3\nFr Scan All\nFr Mandelbrot 20`)
    expect(cancelled.at(0, 0)).toBe(5)
  })

  it('a colour bigger than the screen holds keeps only its low bits', () => {
    // the original writes the byte a bit at a time across as many bitplanes
    // as the screen has, which is the manual's "only the lower bits are used"
    expect(draw(`${SET}Fr Colour 0,21\nFr Mandelbrot 20`).at(0, 0)).toBe(21 & 15)
  })

  it('Fr Reset drops the window, the position, the steps and the colour table', () => {
    const pre = `${SET}Fr Colour 3,9\nFr Reset\n`
    expect(() => run(`${pre}Print Fr X Position`)).toThrow(/No fractal position defined/)
    expect(() => run(`${pre}Print Fr X Step`)).toThrow(/No fractal step specified/)
    expect(() => run(`${pre}Fr Position 0,0\nFr Step 8\nFr Mandelbrot 4`)).toThrow(/No fractal window defined/)
    expect(val('Fr Get Colour(3)', pre)).toBe('3')
  })
})

describe('CRAFT 1.0 — Workbench, the CLI and the machine (routines 162..203)', () => {
  /** one frame, which is enough to reach the dialog block and stop there */
  const park = (b: { rt: Runtime }): void => {
    b.rt.frame()
  }

  it('the Workbench three reach Intuition through a base AMOS already holds', () => {
    /*
     * `-$18a6(a5)` is IntuitionBase, eight bytes from the `-$18ae` GfxBase the
     * turtle draws through, and the offsets off it are OpenWorkBench -$d2,
     * WBenchToFront -$156 and WBenchToBack -$150. The library opens nothing:
     * there is not one library-name string in the whole hunk.
     */
    const b = run('Open Workbench')
    expect(b.rt.intuition.workBenchOpen()).toBe(true)
    expect(() => run('Open Workbench\nWb To Back\nWb To Front')).not.toThrow()
  })

  it('=Cli Here is zero for a program Workbench started, which is every program here', () => {
    // `ThisTask->pr_CLI` is a BPTR shifted left twice, then cli_Background at
    // $2c: -1 for a FOREGROUND CLI and 0 for a background one or for none
    expect(val('Cli Here')).toBe('0')
  })

  it('Set Amos Pri keeps a signed byte and =Amos Pri hands it back', () => {
    // the bound is a round trip rather than a compare: `move.b d0,d1 / ext.w /
    // ext.l / cmp.l d0,d1 / Rbne routine 206`
    expect(val('Amos Pri')).toBe('0')
    expect(val('Amos Pri', 'Set Amos Pri 5\n')).toBe('5')
    expect(val('Amos Pri', 'Set Amos Pri -20\n')).toBe('-20')
    expect(() => run('Set Amos Pri 128')).toThrow(/Illegal function call/)
    expect(() => run('Set Amos Pri -129')).toThrow(/Illegal function call/)
    expect(() => run('Set Amos Pri 127')).not.toThrow()
  })

  it('Wb Prefs fills the caller buffer with a Preferences structure', () => {
    /*
     * Routine 179 is GetPrefs over an address AMOS routine 431 resolves. The
     * two offsets this port has confirmed against a real `system-configuration`
     * are the four screen colours at 110 and PrinterFilename at 128, where
     * "generic" sits on the 1.3.3 disk -- see ../amiga/intuition.ts.
     */
    const b = run('Reserve As Work 5,300\nWb Prefs Start(5),232\nPrint Deek(Start(5)+110);Peek(Start(5));Str Peek$(Start(5)+128,7)')
    expect(b.out().trim()).toBe('90 8generic')
  })

  it('a Prefs buffer at an odd address is AMOS error 25, not one of CRAFT own', () => {
    // `btst #$0,d3 / Rbne routine 208`
    expect(() => run('Reserve As Work 5,300\nWb Prefs Start(5)+1,232')).toThrow(/Address error/)
    expect(() => run('Reserve As Work 5,300\nWb Def Prefs Start(5)+1,232')).toThrow(/Address error/)
    expect(() => run('Reserve As Work 5,300\nSet Wb Prefs Start(5)+1,232')).toThrow(/Address error/)
  })

  it('a short size copies the front of the structure and no more', () => {
    // the size goes straight to Intuition, so this is its contract not CRAFT's
    const b = run('Reserve As Work 5,300\nWb Prefs Start(5),4\nPrint Peek(Start(5));Peek(Start(5)+4)')
    expect(b.out().trim()).toBe('8 0')
  })

  it('both resets ask the machine for one, and only the hard one is cold', () => {
    // routine 188 does `clr.l $4.w` before the RESET so the ROM finds no
    // ExecBase and builds a new one; routine 189 leaves it alone
    expect(run('Hard Reset').rt.machine.pendingReset?.kind).toBe('cold')
    expect(run('Warm Reset').rt.machine.pendingReset?.kind).toBe('warm')
  })

  it('Guru Meditation is a DEADEND alert, so it crashes the machine', () => {
    // `bset #$1f,d7` is ALERT_TYPE deadend and `jmp -$6c(a6)` is exec's
    // Alert, which for a deadend one never returns
    expect(run('Guru Meditation 3,0').rt.machine.pendingReset?.kind).toBe('cold')
  })

  it('Guru Alert refuses an empty set of lines and a line of 78', () => {
    // `cmpi.w #$4e,d0 / Rbcc routine 206` per line, and `tst.w d5 / Rbeq
    // routine 206` when every line was empty
    expect(() => run('A=Guru Alert("")')).toThrow(/Illegal function call/)
    expect(() => run('A=Guru Alert("","","")')).toThrow(/Illegal function call/)
    expect(() => run(`A=Guru Alert(String$("x",78))`)).toThrow(/Illegal function call/)
    expect(() => run(`A=Guru Alert(String$("x",77))`)).not.toThrow()
    // an empty line among real ones is skipped rather than refused
    expect(() => run('A=Guru Alert("one","","three")')).not.toThrow()
  })

  it('Guru Alert answers 0 with nobody there to click, and -1 for the button', () => {
    expect(val('A', 'A=Guru Alert("Software Failure")\n')).toBe('0')
    const b = boot('A=Guru Alert("Software Failure") : Print A')
    park(b)
    const chan = b.rt.craft.request?.chan
    expect(chan).toBeDefined()
    b.rt.finishDialogRun(b.rt.dialogs.get(chan!)!, 1)
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out().trim()).toBe('-1')
  })

  it('an empty Sys Request label falls back to Retry and Cancel', () => {
    // "if you use empty strings "" instead of pos$ and neg$, the leftmost
    // button is 'Retry' and the rightmost is 'Cancel'" -- and both words sit
    // in the hunk at $3096 and $308e with their length bytes in front
    const b = boot('A=Sys Request("Disk?","","")')
    park(b)
    const d = b.rt.dialogs.get(b.rt.craft.request!.chan)!
    expect([d.vars[10], d.vars[11]]).toEqual(['Retry', 'Cancel'])
  })

  it('Sys Request reads its gadget labels off the END of the argument list', () => {
    /*
     * Routine 187 pulls the last two arguments before it walks back over one
     * to five body lines, which is how three arguments make a one-line
     * requester and seven make a five-line one.
     */
    const b = boot('A=Sys Request("Line one","Line two","Yes","No") : Print A')
    park(b)
    const d = b.rt.dialogs.get(b.rt.craft.request!.chan)!
    expect(d.vars[10]).toBe('Yes')
    expect(d.vars[11]).toBe('No')
    b.rt.finishDialogRun(d, 1)
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out().trim()).toBe('-1')
  })

  it('all five Sys Request arities parse, from one body line to five', () => {
    for (let n = 1; n <= 5; n++) {
      const body = Array.from({ length: n }, (_, i) => `"L${i}"`).join(',')
      expect(val('A', `A=Sys Request(${body},"Yes","No")\n`), `${n} lines`).toBe('0')
    }
  })

  it('Cli Execute inherits the console where EasyLife Elexec runs detached', () => {
    // routine 165 passes Output() and Input() to Execute; there is no shell
    // behind this port, so it answers DOSFALSE and nothing is invented
    expect(() => run('Cli Execute "list"')).not.toThrow()
    expect(() => run('Cli Print "hello"')).not.toThrow()
  })
})

describe('CRAFT 1.0 — the hardware and the odds and ends (routines 190..204)', () => {
  it('=Hw Mouse Key reads the two hardware registers, and so can a program', () => {
    /*
     * Routine 190 goes to the silicon rather than to AMOS -- `btst.b
     * #$6,$bfe001.l` for the left button on CIA-A's port A, and `#$a` and
     * `#$8` on POTGOR at $dff016 for the right and the middle. That is what
     * earns the manual's "it works whether the AMOS screen is displayed or
     * not", and it is why both registers are in the memory map: a program
     * that Peeks them itself has to get the same answer the keyword does.
     * All three bits are ACTIVE LOW.
     */
    const b = boot('Print Hw Mouse Key;Peek($BFE001);Deek($DFF016)')
    b.rt.input.mouseK = 1 | 4
    mustFinish(b.rt.runHeadless(5000))
    // left and middle down: CIA bit 6 clear, POTGOR bit 8 clear, bit 10 set.
    // The low two bits are OVL and LED, both clear on a booted machine with
    // the filter engaged -- see ../amiga/cia.ts. They read as 1 until the
    // chip was modelled, which made this $bf.
    expect(b.out().trim()).toBe(`5 ${0xbc} ${0xffff & ~(1 << 8)}`)
  })

  it('and answers nothing at all with no button down', () => {
    expect(val('Hw Mouse Key;Peek($BFE001);Deek($DFF016)')).toBe(`0 252 65535`)
  })

  it('and a Poke to it reaches the filter, which is what Change Led is', () => {
    // First 0.1's `Change Led` is `bchg.b #$1,$bfe001` (routine 3, $6c), so
    // a program can do it by hand and the sink has to follow
    const b = boot('Poke $BFE001,254\nPrint Peek($BFE001)')
    mustFinish(b.rt.runHeadless(5000))
    expect(b.out().trim()).toBe('254')
    expect(b.rt.ledFilter).toBe(false)
  })

  it('and ignores a write to the six input pins, as the data direction register does', () => {
    // bits 2 to 7 are pins. `move.b #$ff,$bfe001` sets OVL and LED and
    // nothing else, so the mouse button does not become stuck down.
    const b = boot('Poke $BFE001,255 : Print Peek($BFE001)')
    mustFinish(b.rt.runHeadless(5000))
    expect(b.out().trim()).toBe('255')
    b.rt.input.mouseK = 1
    expect(b.rt.machine.cia.pra()).toBe(0xff & ~(1 << 6))
  })

  it('the three Gr functions are the RastPort pens seen from outside', () => {
    // routines 193, 194 and 195 all reach routine 196 with $19, $1a and $1b:
    // rp_FgPen, rp_BgPen and rp_AOlPen. It is the same RastPort at
    // `-$18ca(a5)` the turtle draws its lines through.
    expect(val('Gr Ink;Gr Back;Gr Border', 'Ink 5,3,7\n')).toBe('5 3 7')
    expect(() => run('Screen Close 0\nPrint Gr Ink')).toThrow(/Screen not opened/)
  })

  it('Gr Centre puts a string in the middle of the screen', () => {
    const b = boot('Ink 3\nGr Centre 50,"AB"')
    mustFinish(b.rt.runHeadless(5000))
    const s = b.rt.screens.get(0)!
    // (320 - 2*8) / 2 = 152, and the y is the baseline
    let leftmost = -1
    for (let x = 0; x < s.width && leftmost < 0; x++) {
      for (let y = 40; y < 52; y++) if (s.point(x, y) === 3) leftmost = x
    }
    expect(leftmost).toBe(152)
  })

  it('the three swaps swap what their first letter says and nothing else', () => {
    // routine 200 is two nibbles, 201 two bytes, 202 one `swap d3`
    expect(val('B.Swap($AB);W.Swap($1234);L.Swap($12345678)')).toBe(`${0xba} ${0x3412} ${0x56781234}`)
    // the upper parts are left alone: B.Swap only ever answers a byte
    expect(val('B.Swap($12AB)')).toBe(String(0xba))
    expect(val('W.Swap($99001234)')).toBe(String(0x3412))
  })

  it('=Beam Wait refuses a line past =Display Height', () => {
    // the bound is AMOS's own, off the jump table at `$128(a0)` -- the same
    // number Display Height answers. DEVIATION: the wait itself is not
    // waited, for the reason AMCAF's Raster Wait already carries.
    expect(() => run('Beam Wait 100')).not.toThrow()
    expect(() => run('Beam Wait 400')).toThrow(/Illegal function call/)
  })

  it('=Craft Version is 100 and has to be divided by it', () => {
    // "if this function returns 100, the real version is 1.00"
    expect(val('Craft Version')).toBe('100')
  })

  it('=Amos Pro is a constant, and the two builds carry different ones', () => {
    /*
     * Routine 204 tests nothing: `moveq #?,d3 / moveq #$0,d2 / rts`. It is
     * still correct, because the constant differs between the builds --
     * `moveq #0,d3` in CRAFT.Lib and `moveq #-1,d3` in AMOSPro_CRAFT.Lib.
     * Every other address this file cites is the 1.3 build's; this is the one
     * keyword the two are known to disagree on, and a program under this port
     * has the Pro build loaded.
     */
    expect(val('Amos Pro')).toBe('-1')
  })

  it('=Amos Base is a constant, and named so it is findable', () => {
    // `move.l a5,d3` and nothing else. Nothing is mapped there: see the
    // keyword for why a page of zeros would be worse than an address that
    // answers nothing.
    expect(val('Amos Base')).toBe(String(CRAFT_AMOS_BASE))
    expect(run('Print Peek(Amos Base)').out().trim()).toBe('0')
  })

  it('=Y Beam is the nine-bit vertical position', () => {
    // `$dff004` as a LONGWORD, masked $1ff00 and shifted down eight: V8 from
    // VPOSR's bit 0 and V7-0 from VHPOSR's high byte
    expect(Number(val('Y Beam'))).toBeGreaterThanOrEqual(0)
    expect(Number(val('Y Beam'))).toBeLessThan(512)
  })
})
