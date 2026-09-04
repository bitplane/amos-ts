/**
 * IntuiExtend 2.01b, the PowerPacker group.
 *
 * The PP20 codec has its own tests in ../amiga/powerpacker.test.ts, including
 * the one that matters most, `ancient` decoding what the encoder writes. What
 * is pinned here is the veneer: which of the six powerpacker.library entries
 * each keyword reaches, that ppCrunchBuffer works in place, and that the two
 * longs at workspace+$50 and +$54 hold what Pp3 and Pp4 say they do.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { PP_EFFICIENCY, pp20Crunch, pp20Decrunch } from '../amiga/powerpacker'
import { Runtime } from './runtime'
import { IE_PP_HEADER } from './intuiextendpp'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!
const extensions = new Map([[23, ie.table]])

/** 512 bytes with a great deal of structure, so the cruncher wins easily */
const TEXT = new TextEncoder().encode('ABCDEFGH'.repeat(64))

/** 32 bytes an LZ77 cruncher cannot do anything with */
function noise(n: number): Uint8Array {
  const out = new Uint8Array(n)
  let x = 0x1234_5678
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out[i] = (x >>> 16) & 0xff
  }
  return out
}

const FILES: Record<string, Uint8Array> = {
  'c.pp': pp20Crunch(TEXT),
  'plain.txt': TEXT,
  'rnd.bin': noise(32),
  // "PP20", an efficiency table and a four-byte trailer claiming four bytes of
  // plaintext, with not one crunched word between them
  'short.pp': new Uint8Array([0x50, 0x50, 0x32, 0x30, 9, 10, 12, 13, 0, 0, 4, 0]),
}

function boot(src: string): { rt: Runtime; out: () => string } {
  let printed = ''
  const fs = new AmigaFS()
  const ram = fs.mountMemory('RAM')
  for (const [name, data] of Object.entries(FILES)) ram.write([name], data)
  fs.currentDir = 'RAM:'
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[23, ie]]),
    maxSteps: 2_000_000,
    fs,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(20_000))
  return { rt, out: () => printed }
}

/**
 * AMOS puts a leading space in front of every non-negative number it prints,
 * so a `;" ";` separator between two of them lands two spaces. Collapse the
 * runs: the separator is there to keep two negatives from running together as
 * `-1-1`, not to be asserted on.
 */
const out = (src: string): string =>
  boot(src)
    .out()
    .trim()
    .replace(/\s+/g, ' ')

describe('IntuiExtend 2.01b — Pp Decrunch', () => {
  /**
   * ppLoadData puts the block at A1 and its length at A2, which routine 130
   * points at workspace+$50 and +$54 before it calls.
   */
  it('answers 0 and leaves the plaintext at Pp Start', () => {
    expect(out('R=Pp Decrunch("RAM:c.pp",4,0)\nPrint R;" ";Pp Len')).toBe('0 512')
  })

  it('the buffer holds the decrunched bytes', () => {
    const src = 'R=Pp Decrunch("RAM:c.pp",4,0)\nS=Pp Start\nPrint Peek(S);" ";Peek(S+1);" ";Peek(S+511)'
    // "A", "B" and the last "H" of the sixty-fourth repeat
    expect(out(src)).toBe('65 66 72')
  })

  /**
   * Pp1: "Si un fichier n'est pas compacté, il sera tout de même chargé en
   * mémoire." ppLoadData reads the magic and copies when it is not PP20.
   */
  it('loads an uncrunched file verbatim', () => {
    const src = 'R=Pp Decrunch("RAM:plain.txt",4,0)\nPrint R;" ";Pp Len;" ";Peek(Pp Start)'
    expect(out(src)).toBe('0 512 65')
  })

  /** PP_OPENERR, `ppbase.i`:39, and the two longs stay at the zero $3832 wrote */
  it('answers -1 for a file that is not there, and clears both longs', () => {
    const src = 'R=Pp Decrunch("RAM:none",4,0)\nPrint R;" ";Pp Start;" ";Pp Len'
    expect(out(src)).toBe('-1 0 0')
  })

  /** PP_UNKNOWNPP, `ppbase.i`:44, for a PP20 header over nothing */
  it('answers -6 for a PP20 file it cannot decrunch', () => {
    expect(out('Print Pp Decrunch("RAM:short.pp",4,0)')).toBe('-6')
  })

  /** COL is DECR_COL0 to DECR_NONE and reaches ppLoadData as D0 */
  it('accepts every decrunch colour', () => {
    const src = 'For C=0 To 4\nR=Pp Decrunch("RAM:c.pp",C,0)\nPrint R;\nPp Free\nNext C'
    expect(out(src)).toBe('0 0 0 0 0')
  })

  /**
   * Routine 130 clears workspace+$50 on the way in, so a second call with no
   * `Pp Free` between them loses the first block's address entirely: the
   * allocation is still live and nothing can name it any more.
   */
  it('a second decrunch does not reuse the first block', () => {
    const src =
      'R=Pp Decrunch("RAM:c.pp",4,0)\nS1=Pp Start\nR=Pp Decrunch("RAM:c.pp",4,0)\nS2=Pp Start\nPrint S1=S2'
    expect(out(src)).toBe('0')
  })
})

describe('IntuiExtend 2.01b — Pp Free, Pp Len and Pp Start', () => {
  /** Pp2: "Libère la mémoire occupée par le fichier décompacté." */
  it('Pp Free zeroes both longs', () => {
    const src = 'R=Pp Decrunch("RAM:c.pp",4,0)\nPp Free\nPrint Pp Start;" ";Pp Len'
    expect(out(src)).toBe('0 0')
  })

  /** and it takes no arguments at all: routine 147's spec is a bare "I" */
  it('Pp Free is an instruction with no arguments', () => {
    expect(ie.tokens.find((t) => t.name === 'pp free')!.spec).toBe('I')
  })

  it('both answer 0 before anything has been loaded', () => {
    expect(out('Print Pp Start;" ";Pp Len')).toBe('0 0')
  })

  /** freeing twice is harmless, because the first call cleared the address */
  it('Pp Free twice does not free the block twice', () => {
    const src = 'R=Pp Decrunch("RAM:c.pp",4,0)\nPp Free\nPp Free\nPrint Pp Start'
    expect(out(src)).toBe('0')
  })
})

describe('IntuiExtend 2.01b — Pp Crunch', () => {
  /**
   * ppCrunchBuffer is given one buffer and overwrites it, which is why Pp5
   * hands `Pp Write` the same START.
   */
  it('crunches in place and answers a size below the original', () => {
    const src =
      'R=Pp Decrunch("RAM:plain.txt",4,0)\nS=Pp Start\nL=Pp Len\nN=Pp Crunch(S,L,2,4)\nPrint N<L;" ";Peek(S)'
    // true, and the first byte is no longer "A"
    const parts = out(src).split(' ')
    expect(parts[0]).toBe('-1')
    expect(parts[1]).toBeDefined()
    expect(Number(parts[1])).not.toBe(65)
  })

  /**
   * Pp0's -1: "Overflow, la taille compactée du fichier est supérieure au
   * fichier lui- même."
   */
  it('answers -1 when the crunched block is bigger than the plain one', () => {
    const src = 'R=Pp Decrunch("RAM:rnd.bin",4,0)\nPrint Pp Crunch(Pp Start,Pp Len,0,4)'
    expect(out(src)).toBe('-1')
  })

  /** the answer excludes the eight header bytes `Pp Write` puts on */
  it('the answer is the body, not the file', () => {
    const src = 'R=Pp Decrunch("RAM:plain.txt",4,0)\nN=Pp Crunch(Pp Start,Pp Len,2,4)\nPrint N'
    const n = Number(out(src))
    expect(n).toBe(pp20Crunch(TEXT).length - IE_PP_HEADER)
  })

  /** LARG remains internal, while EFF selects the encoder's offset widths. */
  it('accepts every efficiency and returns a crunched body', () => {
    for (let eff = 0; eff <= 4; eff++) {
      const src = `R=Pp Decrunch("RAM:plain.txt",4,0)\nPrint Pp Crunch(Pp Start,Pp Len,2,${eff})`
      expect(Number(out(src))).toBeGreaterThan(0)
    }
  })
})

describe('IntuiExtend 2.01b — Pp Write', () => {
  const SAVE =
    'R=Pp Decrunch("RAM:plain.txt",4,0)\nS=Pp Start\nN=Pp Crunch(S,Pp Len,2,4)\nPp Write "RAM:out.pp",S To N,4\n'

  /** ppWriteDataHeader lays down "PP20" and the four offset widths */
  it('writes the eight-byte header in front of the body', () => {
    const b = boot(SAVE)
    const file = b.rt.vfs?.readFile('RAM:out.pp')
    expect(file).not.toBeNull()
    expect([...file!.subarray(0, 8)]).toEqual([0x50, 0x50, 0x32, 0x30, 9, 10, 12, 13])
  })

  /** and what comes out is a PP20 file the codec reads back byte for byte */
  it('round-trips through the codec', () => {
    const b = boot(SAVE)
    expect(pp20Decrunch(b.rt.vfs!.readFile('RAM:out.pp')!)).toEqual(TEXT)
  })

  /** the whole group in one program, which is what Pp3's Remarque describes */
  it('round-trips through Pp Decrunch', () => {
    const src = `${SAVE}Pp Free\nR2=Pp Decrunch("RAM:out.pp",4,0)\nPrint R2;" ";Pp Len;" ";Peek(Pp Start)`
    expect(out(src)).toBe('0 512 65')
  })

  it('writes each of powerpacker.library 36.10\'s five efficiency tables', () => {
    for (let eff = 0; eff <= 4; eff++) {
      const src =
        `R=Pp Decrunch("RAM:plain.txt",4,0)\nS=Pp Start\n` +
        `N=Pp Crunch(S,Pp Len,2,${eff})\nPp Write "RAM:out.pp",S To N,${eff}\n`
      const file = boot(src).rt.vfs!.readFile('RAM:out.pp')!
      expect([...file.subarray(4, 8)]).toEqual([...PP_EFFICIENCY[eff]!])
      expect(pp20Decrunch(file)).toEqual(TEXT)
    }
  })

  /** MODE_NEWFILE, so a file of the same name goes: Pp5 says "il sera écrasé" */
  it('overwrites a file that is already there', () => {
    const b = boot(`Pp Write "RAM:plain.txt",0 To 0,4\n`)
    expect(b.rt.vfs!.readFile('RAM:plain.txt')!.length).toBe(IE_PP_HEADER)
  })

  /** routine 156 has instr $9c and func $ffff, so there is no answer to read */
  it('Pp Write has no function form', () => {
    const t = ie.tokens.find((k) => k.name === 'pp write')!
    expect(t.spec).toBe('I2,0t0,0')
    expect(t.func).toBe(0xffff)
  })
})
