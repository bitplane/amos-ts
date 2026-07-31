import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { ansiToAmos, newLdosState } from './ldos'
import { lcompress, ldecompress } from './ldoslz'

/**
 * The eight keywords LDos 2.6 has and 2.5 does not, against routines 83 to 90
 * of `AMOSPro_LDos.Lib` and the entries in `Documentation/ldos.text`.
 *
 * The 2.5 tests next door bind 2.5's table; these need 2.6's, which is the
 * same 79 entries with eight appended.
 */
const table = new TokenTable(CORE_TOKENS)
const LDOS_SLOT = 10
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [LDOS_SLOT, extensionById('ldos-2.6')!.table] as const,
])

function run(src: string): { out: string; rt: Runtime } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 2_000_000,
    extensions,
    fs,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(2_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt }
}

describe('Lrol / Lror rotate, whatever the manual calls them', () => {
  it('bits leaving the top come back at the bottom', () => {
    // "Lrol - Perform logical shift left" says the manual, twice, and the
    // library's own error says "shift" too — but $3b12 is `rol.l #$8,d3`
    const { out } = run(
      [
        'Print Hex$(Lrol(4,$12345678))',
        'Print Hex$(Lror(4,$12345678))',
        'Print Hex$(Lrol(8,$FF000000))', // a shift would give 0
        'Print Hex$(Lror(1,1))',
      ].join('\n'),
    )
    expect(out.split('\n').slice(0, 4)).toEqual(['$23456781', '$81234567', '$FF', '$80000000'])
  })

  it('all 32 bits take part, and a rotate of 0 or 31 is legal', () => {
    const { out } = run(['Print Hex$(Lrol(0,$ABCD))', 'Print Hex$(Lror(31,2))'].join('\n'))
    expect(out.split('\n').slice(0, 2)).toEqual(['$ABCD', '$4'])
  })

  it('more than 31 is refused, and the bound is unsigned so -1 fails too', () => {
    // `cmp.l #$1f,d0 / bls` — error 26, "You can only shift 31 bits a time!"
    for (const bad of ['Print Lrol(32,1)', 'Print Lror(32,1)', 'Print Lrol(-1,1)']) {
      expect(() => run(bad), bad).toThrow(/only shift 31 bits/)
    }
  })
})

describe('Lprot Conv turns the low four bits over', () => {
  it('the manual\'s own worked example', () => {
    // "if MASK = %11010110 and we Lprot Conv it: %11011001"
    const { out } = run('Print Bin$(Lprot Conv(%11010110),8)')
    expect(out.trim()).toBe('%11011001')
  })

  it('and applying it twice gives the mask back', () => {
    const { out } = run('Print Lprot Conv(Lprot Conv($5A))')
    expect(out.trim()).toBe('90')
  })
})

describe('Lstrcmp', () => {
  it('1 when the first sorts after, 2 when the second does, 0 when equal', () => {
    const { out } = run(
      [
        'Print Lstrcmp("b","a")',
        'Print Lstrcmp("a","b")',
        'Print Lstrcmp("abc","abc")',
      ].join('\n'),
    )
    expect(out.split('\n').slice(0, 3).map((s) => s.trim())).toEqual(['1', '2', '0'])
  })

  it('when one is a prefix of the other, the longer wins', () => {
    const { out } = run(['Print Lstrcmp("abcd","abc")', 'Print Lstrcmp("abc","abcd")'].join('\n'))
    expect(out.split('\n').slice(0, 2).map((s) => s.trim())).toEqual(['1', '2'])
  })

  it('an empty string on either side is error 27', () => {
    expect(() => run('Print Lstrcmp("","a")')).toThrow(/Can't Strcmp empty strings/)
    expect(() => run('Print Lstrcmp("a","")')).toThrow(/Can't Strcmp empty strings/)
  })

  it('compares by byte value — the folding table is loaded and never used', () => {
    // $3b6a loads the 256-byte table at $3bea into a0 and no instruction in
    // the routine indexes it, so the manual's national-character handling is
    // absent from this build. "Ä" ($C4) therefore sorts after "Z" ($5A),
    // where a folded comparison would put it with "A".
    const { out } = run('Print Lstrcmp(Chr$(196),"Z")')
    expect(out.trim()).toBe('1')
  })
})

describe('Lhicol On / Off gate what SGR 2 does to Lansi', () => {
  const pen = (s: string): number[] =>
    [...s].map((c) => c.charCodeAt(0)).filter((_, i, a) => i > 0 && a[i - 1] === 0x50)

  it('16-colour mode is the default, and SGR 2 lifts pens into 8-15', () => {
    const st = newLdosState()
    expect(st.hicol).toBe(true)
    const s = ansiToAmos('\x1b[2m\x1b[31m', st)
    expect(pen(s)).toEqual([0x30 + 1 + 8]) // pen 1 becomes pen 9
  })

  it('Lhicol Off makes SGR 2 inert', () => {
    const st = newLdosState()
    st.hicol = false
    expect(pen(ansiToAmos('\x1b[2m\x1b[31m', st))).toEqual([0x30 + 1])
  })

  it('SGR 0 puts it back, and the paper never moves', () => {
    // `add.b $2b22(pc),d0` is on the pen path ($2a32) and has no counterpart
    // on the paper path ($2a1e)
    const st = newLdosState()
    ansiToAmos('\x1b[2m', st)
    expect(ansiToAmos('\x1b[41m', st)).toContain('\x1bB1')
    ansiToAmos('\x1b[0m', st)
    expect(st.ansiBright).toBe(0)
    expect(pen(ansiToAmos('\x1b[31m', st))).toEqual([0x30 + 1])
  })

  it('the keywords reach the state', () => {
    const { rt } = run('Lhicol Off')
    expect(rt.ldos.hicol).toBe(false)
    expect(run('Lhicol Off\nLhicol On').rt.ldos.hicol).toBe(true)
  })
})

describe('the Lcompress / Ldecompress format', () => {
  /** the output, and the length Ldecompress reports for it */
  const round = (input: Uint8Array): { got: Uint8Array; len: number } => {
    const packed = new Uint8Array(input.length * 2 + 256)
    const n = lcompress(input, packed, packed.length - 0x30)
    expect(n).toBeGreaterThan(0)
    const out = new Uint8Array(input.length + 64)
    const len = ldecompress(packed.subarray(0, n), out)
    return { got: out.subarray(0, input.length), len }
  }

  /**
   * The decoder runs all sixteen items of a control word before it looks at
   * the source pointer again, and Lcompress does not pad its final group, so
   * the output carries up to fifteen bytes past the real data and OUTLEN
   * counts them. See ldoslz.ts. Every round trip below therefore checks the
   * data and the overshoot separately.
   */
  const overshoot = (input: Uint8Array, len: number): number => len - input.length

  it('a run of one byte comes back', () => {
    const input = new Uint8Array(1000).fill(0x41)
    const { got, len } = round(input)
    expect(got).toEqual(input)
    expect(overshoot(input, len)).toBeLessThan(16)
  })

  it('repeated text comes back', () => {
    const text = 'the quick brown fox jumps over the lazy dog. '.repeat(40)
    const input = Uint8Array.from([...text].map((c) => c.charCodeAt(0)))
    const { got, len } = round(input)
    expect(got).toEqual(input)
    expect(overshoot(input, len)).toBeLessThan(16)
  })

  it('data with no structure comes back, and every byte value survives', () => {
    // a fixed pseudo-random sequence: incompressible, so almost all literals
    const input = new Uint8Array(2048)
    let s = 12345
    for (let i = 0; i < input.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      input[i] = (s >> 16) & 0xff
    }
    const { got, len } = round(input)
    expect(got).toEqual(input)
    expect(overshoot(input, len)).toBeLessThan(16)
  })

  it('short inputs and every length up to a control-word boundary', () => {
    for (let n = 1; n <= 40; n++) {
      const input = new Uint8Array(n)
      for (let i = 0; i < n; i++) input[i] = (i * 7) & 0xff
      const { got, len } = round(input)
      expect(got, `length ${n}`).toEqual(input)
      expect(overshoot(input, len), `length ${n}`).toBeLessThan(16)
    }
  })

  it('the overshoot is exactly the unused item slots of the last group', () => {
    // 16 literals fill a control word exactly, so nothing is over-decoded;
    // 17 starts a second group with fifteen slots to spare
    const exact = new Uint8Array(16)
    for (let i = 0; i < 16; i++) exact[i] = 0x80 + i
    expect(round(exact).len).toBe(16)

    const one = new Uint8Array(17)
    for (let i = 0; i < 17; i++) one[i] = 0x80 + i
    expect(round(one).len).toBe(17 + 15)
  })

  it('it actually compresses — a long run is a fraction of its size', () => {
    const input = new Uint8Array(4000).fill(0x2a)
    const packed = new Uint8Array(8192)
    const n = lcompress(input, packed, packed.length - 0x30)
    expect(n).toBeLessThan(100)
  })

  it('returns 0 when the destination is too small to hold the result', () => {
    const input = new Uint8Array(4096)
    for (let i = 0; i < input.length; i++) input[i] = (i * 131) & 0xff
    const packed = new Uint8Array(4096)
    expect(lcompress(input, packed, 64)).toBe(0)
  })
})

describe('the decoder, against streams this port did not produce', () => {
  /** build a stream by hand from the format, one control word at a time */
  const stream = (bits: number[], data: number[]): Uint8Array => {
    let ctrl = 0
    for (let i = 0; i < bits.length; i++) if (bits[i]) ctrl |= 1 << (15 - i)
    // a trailing control word is what stops the decoder, since it tests the
    // source pointer only after a refill
    return Uint8Array.from([ctrl >> 8, ctrl & 0xff, ...data, 0, 0])
  }
  /**
   * The leading bytes only. Every group runs its full sixteen items, so a
   * hand-built stream is followed by the zeros the decoder reads past its
   * end; what is being checked here is the item encoding.
   */
  const decode = (s: Uint8Array, n: number): number[] => {
    const out = new Uint8Array(4096)
    ldecompress(s, out)
    return [...out.subarray(0, n)]
  }

  it('a clear bit is one literal byte', () => {
    expect(decode(stream([0, 0, 0], [1, 2, 3]), 3)).toEqual([1, 2, 3])
  })

  it('high nibble 0 is a short run of low+3', () => {
    // token $05 -> run of 5+3 = 8, of the byte that follows
    expect(decode(stream([1], [0x05, 0xaa]), 8)).toEqual(new Array(8).fill(0xaa))
  })

  it('high nibble 1 is a long run of low + (b<<4) + 19', () => {
    // $12, $01 -> 2 + 16 + 19 = 37
    expect(decode(stream([1], [0x12, 0x01, 0x5c]), 37)).toEqual(new Array(37).fill(0x5c))
  })

  it('high nibble 3..15 is a match of that length', () => {
    // three literals, then $30/$00 -> len 3, dist = 0<<4 + 0 + 3 = 3
    expect(decode(stream([0, 0, 0, 1], [7, 8, 9, 0x30, 0x00]), 6)).toEqual([7, 8, 9, 7, 8, 9])
  })

  it('high nibble 2 is a long match, length in a third byte', () => {
    // $20/$00 -> dist 3, then len byte 0 -> 16
    expect(decode(stream([0, 0, 0, 1], [1, 2, 3, 0x20, 0x00, 0x00]), 6)).toEqual([1, 2, 3, 1, 2, 3])
  })

  it('a match may reach back less far than it is long, and repeats', () => {
    // three literals, then len 5 at distance 3: the copy is byte by byte, so
    // it walks into what it has just produced
    expect(decode(stream([0, 0, 0, 1], [1, 2, 3, 0x50, 0x00]), 8)).toEqual([1, 2, 3, 1, 2, 3, 1, 2])
  })

  it('a group runs all sixteen items whatever the source pointer does', () => {
    // two literals and nothing else: the remaining fourteen slots are decoded
    // from past the end of the data, which is the overshoot the round trips
    // above allow for
    const out = new Uint8Array(64)
    expect(ldecompress(Uint8Array.from([0x00, 0x00, 1, 2, 0, 0]), out)).toBe(16)
  })
})

describe('Lcompress and Ldecompress through the interpreter', () => {
  it('a bank round-trips through both, and the length is the compressed size', () => {
    const { out } = run(
      [
        'Reserve As Work 10,4096',
        'Reserve As Work 11,8192',
        'Reserve As Work 12,4096',
        'For I=0 To 4095 : Poke Start(10)+I,64+(I mod 4) : Next I',
        'L=Lcompress(Start(10),4096 To Start(11),8192)',
        'Print L<500',
        'O=Ldecompress(Start(11),L,Start(12))',
        // OUTLEN over-counts by the unused slots of the last group; the data
        // itself is exact, which is what the difference sum checks
        'Print O>=4096 and O<4096+16',
        'S=0 : For I=0 To 4095 : S=S+Abs(Peek(Start(10)+I)-Peek(Start(12)+I)) : Next I',
        'Print S',
      ].join('\n'),
    )
    expect(out.split('\n').slice(0, 3).map((s) => s.trim())).toEqual(['-1', '-1', '0'])
  })
})
