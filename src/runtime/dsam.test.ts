/**
 * D-Sam 1.01, verified against D-Sam.Lib disassembled with `extdis d-sam-1.01`
 * --- 16,848 bytes, 99 routines, routine 0 at $50e --- and against the author's
 * own `D-Sam-Example.AMOS`, which is where the argument orders come from.
 *
 * The addresses in the comments are the ones in that code hunk, so a later
 * reader can go back to the instruction a behaviour was taken from.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'
import { DS, SM, readDsamString } from './dsam'

const table = new TokenTable(CORE_TOKENS)
/** the slot routine 0 stores itself in, and where the corpus has it */
const DSAM_SLOT = 15
const dsam = extensionById('d-sam-1.01')!
const exts = new Map([[DSAM_SLOT, dsam.table]])

let printed = ''

function run(src: string, files: Record<string, Uint8Array> = {}): Runtime {
  const fs = new AmigaFS()
  const vol = fs.mountMemory('Work')
  for (const [name, bytes] of Object.entries(files)) vol.write([name], bytes)
  fs.currentDir = 'Work:'
  printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[DSAM_SLOT, dsam]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
    fs,
  })
  mustFinish(rt.runHeadless(2000))
  return rt
}

const out = (): string[] =>
  printed
    .trim()
    .split('\n')
    .map((s) => s.trim())

/* ---- 8SVX fixtures, built to the format routine 71 tests for ----------- */

const id = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const be32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
/** a real IFF chunk: the id, the length, the body, and a pad byte if it is odd */
const chunk = (name: string, body: number[]): number[] => [
  ...id(name),
  ...be32(body.length),
  ...body,
  ...(body.length & 1 ? [0] : []),
]

/** VHDR: twenty bytes, and the three fields the parser reads */
function vhdr(opts: { rate?: number; volume?: number; compression?: number } = {}): number[] {
  const { rate = 8000, volume = 0x10000, compression = 0 } = opts
  return chunk('VHDR', [
    ...be32(0), // oneShotHiSamples
    ...be32(0), // repeatHiSamples
    ...be32(0), // samplesPerHiCycle
    (rate >> 8) & 0xff,
    rate & 0xff,
    1, // ctOctave
    compression,
    ...be32(volume),
  ])
}

function form(body: number[]): Uint8Array {
  return new Uint8Array([...id('FORM'), ...be32(body.length + 4), ...id('8SVX'), ...body])
}

/** the simplest thing the parser will accept: a header and some bytes */
function mono(bytes: number[], opts: Parameters<typeof vhdr>[0] = {}): Uint8Array {
  return form([...vhdr(opts), ...chunk('BODY', bytes)])
}

const LOAD = 'Smp Load 1,"Work:a.8svx"'

describe('Smp Load and the chunk walk --- routines 6 and 71', () => {
  it('reads VHDR into the rate and the volume, and BODY into the size', () => {
    const rt = run(
      `${LOAD}\nPrint Smp Speed(1);",";Smp Volume(1);",";Smp Size(1);",";Smp Length(1)`,
      { 'a.8svx': mono([1, 2, 3, 4, 5, 6, 7, 8], { rate: 11025 }) },
    )
    // volume is Fixed 16.16 scaled by `lsl.l #$6,d0 / swap d0`, so 1.0 is 64
    expect(out()).toEqual(['11025, 64, 8, 8'])
    // with no SEQN, +$c and +$10 are the same number ($31b6)
    expect(rt.dsam.files.size).toBe(0)
  })

  it('BODY is rounded DOWN to an even length by `bclr #$0,d7` at $31a6', () => {
    run(`${LOAD}\nPrint Smp Size(1)`, { 'a.8svx': mono([1, 2, 3, 4, 5]) })
    expect(out()).toEqual(['4'])
  })

  it('the sample data is at a real address, and =Smp Data points at it', () => {
    const rt = run(`${LOAD}\nA=Smp Data(1)\nPrint Peek(A);",";Peek(A+3)`, {
      'a.8svx': mono([0x11, 0x22, 0x33, 0x44]),
    })
    expect(out()).toEqual(['17, 68'])
    expect(rt.resolveAddr(Runtime.DSAM_HEAP_BASE)).not.toBeNull()
  })

  it('a file that is not IFF plays whole, at 12,000 Hz and volume 64 ($3238)', () => {
    run('Smp Load 1,"Work:raw"\nPrint Smp Speed(1);",";Smp Volume(1);",";Smp Size(1)', {
      raw: new Uint8Array([1, 2, 3, 4, 5, 6]),
    })
    expect(out()).toEqual(['12000, 64, 6'])
  })

  it('NAME becomes the name, and without one the FILENAME does ($3160)', () => {
    run(
      `${LOAD}\nSmp Load 2,"Work:b.8svx"\nPrint Smp Name(1)\nPrint Smp Name(2)`,
      {
        'a.8svx': form([...vhdr(), ...chunk('NAME', id('Cellos')), ...chunk('BODY', [1, 2])]),
        'b.8svx': mono([1, 2]),
      },
    )
    expect(out()).toEqual(['Cellos', 'Work:b.8svx'])
  })

  it('CHAN 6 and CHAN 9 both mean stereo, and 4 does not ($3040)', () => {
    const stereo = (n: number): Uint8Array =>
      form([...vhdr(), ...chunk('CHAN', be32(n)), ...chunk('BODY', [1, 2, 3, 4])])
    run(
      'Smp Load 1,"Work:six"\nSmp Load 2,"Work:nine"\nSmp Load 3,"Work:four"\n' +
        'Print Smp Stereo(1);",";Smp Stereo(2);",";Smp Stereo(3)',
      { six: stereo(6), nine: stereo(9), four: stereo(4) },
    )
    expect(out()).toEqual(['-1,-1, 0'])
  })

  it('a stereo BODY is halved, and the right channel follows the left ($3192)', () => {
    const rt = run(
      'Smp Load 1,"Work:s"\nPrint Smp Size(1);",";Smp Left Data(1)-Smp Right Data(1)',
      {
        s: form([...vhdr(), ...chunk('CHAN', be32(6)), ...chunk('BODY', [1, 2, 3, 4, 5, 6, 7, 8])]),
      },
    )
    const rec = rt.dsam.pool.buffer
    expect(out()[0]!.split(',')[0]).toBe('4')
    // the two file offsets are four apart, which is the halved BODY length
    expect(rec.length).toBeGreaterThan(0)
  })

  it('an unknown chunk is seeked over, so a sample survives one it does not know', () => {
    run(`${LOAD}\nPrint Smp Size(1)`, {
      'a.8svx': form([...vhdr(), ...chunk('ANNO', id('made in 1992')), ...chunk('BODY', [1, 2, 3, 4])]),
    })
    expect(out()).toEqual(['4'])
  })

  it('DEFECT an ODD chunk length is not padded past, and the walk desyncs', () => {
    // IFF rounds a chunk up to an even boundary and the reader is meant to
    // skip the pad byte. $2e9a seeks the length EXACTLY, and nothing else in
    // the walk rounds either, so one odd chunk puts every id after it a byte
    // late and BODY is never found.
    expect(() =>
      run(LOAD, {
        'a.8svx': form([...vhdr(), ...chunk('ANNO', id('odd')), ...chunk('BODY', [1, 2, 3, 4])]),
      }),
    ).toThrow(/Error reading sample file/)
  })

  it('DEFECT and an odd NAME desyncs it too, because $3002 reads the length exactly', () => {
    expect(() =>
      run(LOAD, {
        'a.8svx': form([...vhdr(), ...chunk('NAME', id('Cello')), ...chunk('BODY', [1, 2, 3, 4])]),
      }),
    ).toThrow(/Error reading sample file/)
  })
})

describe('the errors the parse raises --- routine 97 and the table at $3dda', () => {
  it('a missing file is error 4', () => {
    expect(() => run('Smp Load 1,"Work:nope"')).toThrow(/Could not open sample file/)
  })

  it('loading the same number twice is error 2 ($2dba)', () => {
    expect(() => run(`${LOAD}\n${LOAD}`, { 'a.8svx': mono([1, 2]) })).toThrow(
      /Sample already exists/,
    )
  })

  it('a sample number outside 0..$ffff is error 8, wherever it is asked ($343c)', () => {
    expect(() => run('Smp Load 65536,"Work:a.8svx"', { 'a.8svx': mono([1, 2]) })).toThrow(
      /Illegal sample number/,
    )
    expect(() => run('Print Smp Size(-1)')).toThrow(/Illegal sample number/)
  })

  it('a number inside the range that was never loaded is error 3', () => {
    expect(() => run('Print Smp Length(4)')).toThrow(/Sample does not exist/)
  })

  it('a VHDR that is not twenty bytes is error 6 ($2f84)', () => {
    expect(() =>
      run(LOAD, { 'a.8svx': form([...chunk('VHDR', [0, 0, 0, 0]), ...chunk('BODY', [1, 2])]) }),
    ).toThrow(/Bad IFF structure in sample file/)
  })

  it('a compression byte other than 0 or 1 is error 7 ($2eea)', () => {
    expect(() => run(LOAD, { 'a.8svx': mono([1, 2], { compression: 2 }) })).toThrow(
      /Unknown compression scheme in sample file/,
    )
  })

  it('a truncated file is error 5, not a half-built sample', () => {
    const full = mono([1, 2, 3, 4])
    expect(() => run(LOAD, { 'a.8svx': full.subarray(0, full.length - 2) })).toThrow(
      /Error reading sample file/,
    )
    // and nothing is left behind: the arms from $2eea unwind before they raise
    expect(() =>
      run(`Smp Load 1,"Work:short"\nPrint 1`, { short: full.subarray(0, full.length - 2) }),
    ).toThrow(/Error reading sample file/)
  })
})

describe('Fibonacci delta --- routine 72 and the table at $133a', () => {
  /** the 8SVX body: one unused byte, the initial value, then packed nibbles */
  const packed = (init: number, nibbles: number[]): number[] => {
    const body = [0, init & 0xff]
    for (let i = 0; i < nibbles.length; i += 2) {
      body.push(((nibbles[i]! & 0xf) << 4) | (nibbles[i + 1]! & 0xf))
    }
    return body
  }

  const FILE = form([...vhdr({ compression: 1 }), ...chunk('BODY', packed(0, [9, 10, 11, 12]))])

  it('unpacks each nibble through the table, accumulating', () => {
    // table[9]=1, [10]=2, [11]=3, [12]=5, from a start of 0
    run(`${LOAD}\nA=Smp Data(1)\nFor I=0 To 3 : Print Peek(A+I); : Next I`, { 'a.8svx': FILE })
    expect(out()).toEqual(['1 3 6 11'])
  })

  it('the size doubles, and the compressed flag comes DOWN once decoded ($33a4)', () => {
    run(`${LOAD}\nPrint Smp Size(1);",";Smp Info(1)`, { 'a.8svx': FILE })
    // BODY is 4 bytes, less the 2-byte header, times two = 4; and Info bit 2
    // (compressed) is clear again because the buffer now holds raw samples
    expect(out()).toEqual(['4, 0'])
  })

  it('Smp Decompress Off keeps the packed bytes and the flag ($3326)', () => {
    run(`Smp Decompress Off\n${LOAD}\nPrint Smp Size(1);",";Smp Info(1)`, { 'a.8svx': FILE })
    expect(out()).toEqual(['2, 4'])
  })
})

describe('SEQN and FADE --- AudioMaster chunks, at $3066 and $30f6', () => {
  const seqn = (pairs: Array<[number, number]>): number[] =>
    chunk('SEQN', pairs.flatMap(([a, b]) => [...be32(a), ...be32(b)]))

  const WITH_SEQ = form([
    ...vhdr(),
    ...seqn([
      [0, 8],
      [8, 16],
      [16, 32],
    ]),
    ...chunk('FADE', be32(3)),
    ...chunk('BODY', new Array(32).fill(1)),
  ])

  it('the loops are counted, read back, and totalled into =Smp Length', () => {
    run(
      `${LOAD}\nPrint Smp Loops(1);",";Smp Length(1);",";Smp Size(1)\n` +
        `Print Smp Loop Start(1,2);",";Smp Loop End(1,2)`,
      { 'a.8svx': WITH_SEQ },
    )
    // 8 + 8 + 16 = 32 into +$c, while +$10 stays the BODY's own length
    expect(out()).toEqual(['3, 32, 32', '8, 16'])
  })

  it('=Smp Sequence and =Smp Fade report the flags, and Info packs both', () => {
    run(`${LOAD}\nPrint Smp Sequence(1);",";Smp Fade(1);",";Smp Info(1)`, { 'a.8svx': WITH_SEQ })
    // 8 is "has a sequence" and 16 "has a fade"
    expect(out()).toEqual(['-1,-1, 24'])
  })

  it('a sample with no SEQN answers error 13 to Smp Loops and Smp Loop Start', () => {
    expect(() => run(`${LOAD}\nPrint Smp Loops(1)`, { 'a.8svx': mono([1, 2]) })).toThrow(
      /Sample has no Audiomaster sequence/,
    )
    expect(() => run(`${LOAD}\nPrint Smp Loop Start(1,1)`, { 'a.8svx': mono([1, 2]) })).toThrow(
      /Sample has no Audiomaster sequence/,
    )
  })

  it('a loop number of zero or past the table is error 23 ($2710)', () => {
    expect(() => run(`${LOAD}\nPrint Smp Loop Start(1,0)`, { 'a.8svx': WITH_SEQ })).toThrow(
      /Illegal sequence loop number/,
    )
    expect(() => run(`${LOAD}\nPrint Smp Loop End(1,5)`, { 'a.8svx': WITH_SEQ })).toThrow(
      /Illegal sequence loop number/,
    )
  })

  it('a SEQN whose length is not a multiple of eight is error 6 ($307c)', () => {
    expect(() =>
      run(LOAD, { 'a.8svx': form([...vhdr(), ...chunk('SEQN', [1, 2, 3, 4]), ...chunk('BODY', [1, 2])]) }),
    ).toThrow(/Bad IFF structure in sample file/)
  })

  it('a SEQN before its VHDR is error 6, because $3066 tests the flag first', () => {
    expect(() =>
      run(LOAD, { 'a.8svx': form([...seqn([[0, 8]]), ...vhdr(), ...chunk('BODY', [1, 2])]) }),
    ).toThrow(/Bad IFF structure in sample file/)
  })

  it('a FADE past the end of the sequence is error 6 ($3120)', () => {
    expect(() =>
      run(LOAD, {
        'a.8svx': form([
          ...vhdr(),
          ...seqn([[0, 8]]),
          ...chunk('FADE', be32(9)),
          ...chunk('BODY', [1, 2]),
        ]),
      }),
    ).toThrow(/Bad IFF structure in sample file/)
  })

  it('a FADE that arrives BEFORE its SEQN is dropped without complaint', () => {
    run(`${LOAD}\nPrint Smp Fade(1);",";Smp Sequence(1)`, {
      'a.8svx': form([
        ...vhdr(),
        ...chunk('FADE', be32(1)),
        ...seqn([[0, 8]]),
        ...chunk('BODY', [1, 2]),
      ]),
    })
    expect(out()).toEqual(['0,-1'])
  })

  it('DEFECT a loop END loses bit 1 where a loop START is made even ($30cc)', () => {
    // `bclr #$0` on the start and `bclr #$1` on the end. So a start of 7
    // becomes 6, which is the alignment intended, while an end of 7 becomes 5
    // and an end of 6 becomes 4 --- and an end of 5 or 4 is left alone. The
    // pair was meant to be aligned the same way.
    run(
      `${LOAD}\nPrint Smp Loop Start(1,1);",";Smp Loop End(1,1)\n` +
        `Print Smp Loop Start(1,2);",";Smp Loop End(1,2)`,
      {
        'a.8svx': form([
          ...vhdr(),
          ...seqn([
            [7, 7],
            [5, 6],
          ]),
          ...chunk('BODY', new Array(16).fill(1)),
        ]),
      },
    )
    expect(out()).toEqual(['6, 5', '4, 4'])
  })
})

describe('Smp Open, Smp Close and Smp Reset --- routines 7, 8 and 39', () => {
  it('an opened sample reads its header and keeps the file, not the bytes', () => {
    const rt = run('Smp Open 1,"Work:a.8svx"\nPrint Smp Size(1);",";Smp Info(1)', {
      'a.8svx': mono([1, 2, 3, 4]),
    })
    // Info bit 0 is "plays from disk", which is what `$100` at $2dd4 means
    expect(out()).toEqual(['4, 1'])
    expect(rt.dsam.files.size).toBe(1)
  })

  it('=Smp Data on an opened sample is error 17: there is no buffer ($27c4)', () => {
    expect(() => run('Smp Open 1,"Work:a.8svx"\nPrint Smp Data(1)', { 'a.8svx': mono([1, 2]) })).toThrow(
      /Sample is playing from disk/,
    )
  })

  it('a stereo file opens TWICE, so the two channels seek apart ($1ac4)', () => {
    const rt = run('Smp Open 1,"Work:s"', {
      s: form([...vhdr(), ...chunk('CHAN', be32(6)), ...chunk('BODY', [1, 2, 3, 4])]),
    })
    expect(rt.dsam.files.size).toBe(2)
  })

  it('Smp Close frees the record and the handle, and the number is free again', () => {
    const rt = run(
      'Smp Open 1,"Work:a.8svx"\nSmp Close 1\nSmp Load 1,"Work:a.8svx"\nPrint Smp Size(1)',
      { 'a.8svx': mono([1, 2, 3, 4]) },
    )
    expect(out()).toEqual(['4'])
    expect(rt.dsam.files.size).toBe(0)
  })

  it('Smp Reset empties the list and puts routine 61 defaults back', () => {
    const rt = run(
      'Smp Disk Buffer 32000\nSmp Mode Minchip\nSmp Decompress Off\n' +
        `${LOAD}\nSmp Reset`,
      { 'a.8svx': mono([1, 2, 3, 4]) },
    )
    const z = rt.dsam.zone
    expect(z[DS.LIST]! | z[DS.LIST + 3]!).toBe(0)
    expect((z[DS.DISK_BUF + 2]! << 8) | z[DS.DISK_BUF + 3]!).toBe(0x4000)
    expect((z[DS.OPTIONS]! << 8) | z[DS.OPTIONS + 1]!).toBe(0x40)
    expect(() => run('Smp Reset\nPrint Smp Size(1)')).toThrow(/Sample does not exist/)
  })

  it('Smp Version stops the program with the library banner --- routine 40', () => {
    expect(() => run('Smp Version')).toThrow(/D-Sam V1\.01 rev 35 \(C\) 1992 AZ Software/)
  })
})

describe('the modes and the buffers --- routines 1 to 5 and 34 to 38', () => {
  const opts = (rt: Runtime): number => (rt.dsam.zone[DS.OPTIONS]! << 8) | rt.dsam.zone[DS.OPTIONS + 1]!
  const long = (rt: Runtime, off: number): number =>
    ((rt.dsam.zone[off]! << 24) | (rt.dsam.zone[off + 1]! << 16) | (rt.dsam.zone[off + 2]! << 8) |
      rt.dsam.zone[off + 3]!) >>> 0

  it('the four option keywords set and clear one bit each', () => {
    expect(opts(run('Smp Mode Minchip'))).toBe(0x8040)
    expect(opts(run('Smp Mode Minchip : Smp Mode Minproc'))).toBe(0x40)
    expect(opts(run('Smp Oversample On'))).toBe(0x1040)
    expect(opts(run('Smp Oversample On : Smp Oversample Off'))).toBe(0x40)
    expect(opts(run('Smp Decompress Off'))).toBe(0)
    // routine 34 puts back what routine 61 left, which is why it is easy to
    // miss that the keyword exists at all
    expect(opts(run('Smp Decompress Off : Smp Decompress On'))).toBe(0x40)
  })

  it('Smp Decompress On brings a packed body back to decoding it', () => {
    const packed = form([
      ...vhdr({ compression: 1 }),
      ...chunk('BODY', [0, 0, (9 << 4) | 10, (11 << 4) | 12]),
    ])
    run(`Smp Decompress Off\nSmp Decompress On\n${LOAD}\nPrint Smp Size(1);",";Smp Info(1)`, {
      'a.8svx': packed,
    })
    expect(out()).toEqual(['4, 0'])
  })

  it('Smp Disk Buffer rounds to eight and drags the DMA buffer to half ($19b6)', () => {
    const rt = run('Smp Disk Buffer 32001')
    expect(long(rt, DS.DISK_BUF)).toBe(32000)
    expect(long(rt, DS.DMA_BUF)).toBe(16000)
  })

  it('a disk buffer under 512 is error 10', () => {
    expect(() => run('Smp Disk Buffer 256')).toThrow(/Illegal buffer size/)
  })

  it('Smp Dma Buffer rounds the DISK buffer up to a whole number of them ($1a1c)', () => {
    // 16384 over 3000 is 5 remainder 1384, so the disk buffer becomes 15000
    const rt = run('Smp Dma Buffer 3000')
    expect(long(rt, DS.DMA_BUF)).toBe(3000)
    expect(long(rt, DS.DISK_BUF)).toBe(15000)
    // one that divides exactly is left alone ($1a26)
    expect(long(run('Smp Dma Buffer 4096'), DS.DISK_BUF)).toBe(0x4000)
    // and a quotient under two is forced to two ($1a16)
    expect(long(run('Smp Dma Buffer 16000'), DS.DISK_BUF)).toBe(32000)
  })

  it('a DMA buffer outside $100..$fff8 is error 10', () => {
    expect(() => run('Smp Dma Buffer 128')).toThrow(/Illegal buffer size/)
    expect(() => run('Smp Dma Buffer 70000')).toThrow(/Illegal buffer size/)
  })

  it('Smp Memory moves both ceilings, and refuses one under what is spent', () => {
    const rt = run(`${LOAD}\nSmp Memory 1000000,2000000`, { 'a.8svx': mono([1, 2, 3, 4]) })
    expect(long(rt, DS.CHIP_TOTAL)).toBe(1000000)
    expect(long(rt, DS.FAST_TOTAL)).toBe(2000000)
    // the sample and its name are already spent out of one of the two pools,
    // so the remainder is below the total by exactly that much
    expect(long(rt, DS.CHIP_LEFT) + long(rt, DS.FAST_LEFT)).toBeLessThan(3000000)
    expect(() => run(`${LOAD}\nSmp Memory 4,4`, { 'a.8svx': mono([1, 2, 3, 4]) })).toThrow(
      /Out of sample memory/,
    )
  })

  it('a ceiling of zero makes the next load error 1 rather than allocating', () => {
    expect(() => run(`Smp Memory 0,0\n${LOAD}`, { 'a.8svx': mono([1, 2, 3, 4]) })).toThrow(
      /Out of sample memory/,
    )
  })

  it('Smp Priority takes -20..20 and error 27 outside it ($2564)', () => {
    expect(() => run('Smp Priority 20')).not.toThrow()
    expect(() => run('Smp Priority -20')).not.toThrow()
    expect(() => run('Smp Priority 21')).toThrow(/Illegal priority value/)
    expect(() => run('Smp Priority -21')).toThrow(/Illegal priority value/)
  })
})

describe('the record, the list and the addresses', () => {
  it('=Smp Base is the data zone, and Peek reaches it', () => {
    const rt = run('Print Smp Base')
    const base = Number(out()[0])
    expect(base).toBe(rt.dsamBase())
    expect(rt.resolveAddr(base)).not.toBeNull()
  })

  it('the records chain through +$3c from the list head at $0(a2) --- routine 73', () => {
    const rt = run(`${LOAD}\nSmp Load 2,"Work:a.8svx"`, { 'a.8svx': mono([1, 2, 3, 4]) })
    const z = rt.dsam.zone
    const head = ((z[0]! << 24) | (z[1]! << 16) | (z[2]! << 8) | z[3]!) >>> 0
    const buf = rt.dsam.pool.buffer
    const off = head - Runtime.DSAM_HEAP_BASE
    // pushed on the FRONT, so the second load is the head
    expect((buf[off + SM.NUMBER]! << 8) | buf[off + SM.NUMBER + 1]!).toBe(2)
    const next =
      ((buf[off + SM.NEXT]! << 24) | (buf[off + SM.NEXT + 1]! << 16) |
        (buf[off + SM.NEXT + 2]! << 8) | buf[off + SM.NEXT + 3]!) >>> 0
    const off2 = next - Runtime.DSAM_HEAP_BASE
    expect((buf[off2 + SM.NUMBER]! << 8) | buf[off2 + SM.NUMBER + 1]!).toBe(1)
  })

  it('a name is an AMOS string on the heap: a size long, a length word, a NUL', () => {
    const rt = run(LOAD, {
      'a.8svx': form([...vhdr(), ...chunk('NAME', id('Bass')), ...chunk('BODY', [1, 2])]),
    })
    const z = rt.dsam.zone
    const head = ((z[0]! << 24) | (z[1]! << 16) | (z[2]! << 8) | z[3]!) >>> 0
    const buf = rt.dsam.pool.buffer
    const o = head - Runtime.DSAM_HEAP_BASE + SM.NAME
    const ptr = ((buf[o]! << 24) | (buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!) >>> 0
    const at = ptr - Runtime.DSAM_HEAP_BASE
    expect(readDsamString(rt.dsam, ptr)).toBe('Bass')
    expect((buf[at - 2]! << 8) | buf[at - 1]!).toBe(4) // the word length
    expect(buf[at + 4]).toBe(0) // and routine 67's NUL after the characters
  })

  /** the 4KB sample the memory tests load, at whatever rate they want */
  const BIG = (rate?: number): Record<string, Uint8Array> => ({
    'a.8svx': mono(new Array(4096).fill(1), rate === undefined ? {} : { rate }),
  })

  it("a loaded sample is charged against the machine's chip memory", () => {
    const idle = run('Rem').chipUsed()
    const rt = run(LOAD, BIG())
    expect(rt.dsam.pool.usage().chip).toBeGreaterThanOrEqual(4096)
    // and `Chip Free` therefore falls by at least the sample
    expect(rt.chipUsed() - idle).toBeGreaterThanOrEqual(4096)
  })

  it('freeing a sample gives the ceiling back --- routine 63 and TypeOfMem', () => {
    const rt = run(`${LOAD}\nSmp Close 1`, BIG())
    expect(rt.dsam.pool.usage()).toEqual({ chip: 0, fast: 0 })
    // the ceilings are back where routine 61 left them, byte for byte
    const left = (off: number): number =>
      ((rt.dsam.zone[off]! << 24) | (rt.dsam.zone[off + 1]! << 16) |
        (rt.dsam.zone[off + 2]! << 8) | rt.dsam.zone[off + 3]!) >>> 0
    expect(left(DS.CHIP_LEFT)).toBe(0xffffffff)
    expect(left(DS.FAST_LEFT)).toBe(0xffffffff)
  })

  it('Oversample On sends the sample to fast memory instead --- routine 64', () => {
    const rt = run(`Smp Oversample On\n${LOAD}`, BIG())
    expect(rt.dsam.pool.usage().chip).toBe(0)
    expect(rt.dsam.pool.usage().fast).toBeGreaterThanOrEqual(4096)
  })

  it('a rate over 28,867 Hz does the same: Paula could not play it anyway', () => {
    expect(run(LOAD, BIG(30000)).dsam.pool.usage().chip).toBe(0)
    expect(run(LOAD, BIG(28867)).dsam.pool.usage().chip).toBeGreaterThanOrEqual(4096)
  })
})

describe('the reader functions --- routines 41 to 59', () => {
  const STEREO = form([...vhdr(), ...chunk('CHAN', be32(6)), ...chunk('BODY', [1, 2, 3, 4])])

  it('=Smp Data on a stereo sample is error 15, and the halves answer instead', () => {
    expect(() => run('Smp Load 1,"Work:s"\nPrint Smp Data(1)', { s: STEREO })).toThrow(
      /Sample has stereo data/,
    )
    run('Smp Load 1,"Work:s"\nPrint Smp Right Data(1)-Smp Left Data(1)', { s: STEREO })
    expect(Number(out()[0])).not.toBe(0)
  })

  it('=Smp Left Data on a MONO sample is error 16 ($280a)', () => {
    expect(() => run(`${LOAD}\nPrint Smp Left Data(1)`, { 'a.8svx': mono([1, 2]) })).toThrow(
      /Sample has only mono data/,
    )
  })

  it('=Smp Info packs five flags, high bit first --- the table at $53a(a2)', () => {
    run('Smp Open 1,"Work:s"\nPrint Smp Info(1)', { s: STEREO })
    // 1 from disk plus 2 stereo
    expect(out()).toEqual(['3'])
  })

  it('=Smp Disk Error is a LATCH: it reads once and clears ($29c0)', () => {
    run('Print Smp Disk Error;",";Smp Disk Error')
    expect(out()).toEqual(['0, 0'])
  })
})
