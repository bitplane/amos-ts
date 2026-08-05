import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 13 — where the doc puts it: "Uses extension slot 13." */
const pb = extensionById('powerbobs-1.0')!

let printed = ''

function run(src: string): Runtime {
  const exts = new Map([[13, pb.table]])
  printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[13, pb]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

/** run `<setup> : Print <expr>` and read the number back off the console */
function val(src: string): number {
  run(src)
  return Number(printed.trim())
}

describe('PowerBobs: Reserve Pbobs (routine 6, $10e2)', () => {
  it('reserves a table of the size asked for', () => {
    const rt = run('Reserve Pbobs 10')
    expect(rt.powerbobs.count).toBe(10)
    expect(rt.powerbobs.bobs).toHaveLength(10)
    expect(rt.powerbobs.bobs[0]).toBeNull() // nothing is defined yet
  })

  it('refuses more than 64 — the shareware cap, in the binary', () => {
    // `cmp.l #$40,d0 / Rbhi routine 125`. The doc says a registered copy does
    // 256; this build does not, and that is the build we hold.
    expect(() => run('Reserve Pbobs 64')).not.toThrow()
    expect(() => run('Reserve Pbobs 65')).toThrow(/Illegal function call/)
  })

  it('refuses zero and negative counts', () => {
    // `move.l (a3)+,d0 / Rble routine 125` — signed, so 0 is refused too
    expect(() => run('Reserve Pbobs 0')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Pbobs -1')).toThrow(/Illegal function call/)
  })

  it('erases first, so a second Reserve replaces the table', () => {
    // `Rbsr routine 10` is the first instruction. That is also why the
    // `tst.w $c(a2) / Rbne` two instructions later can never fire.
    const rt = run('Reserve Pbobs 4 : Pbob Height 1,10 : Reserve Pbobs 2')
    expect(rt.powerbobs.count).toBe(2)
    expect(rt.powerbobs.bobs[0]).toBeNull() // the old structure went with it
  })
})

describe('PowerBobs: Pbob Height (routine 7, $1146)', () => {
  it('allocates the structure and a save buffer of height * 36', () => {
    // `mulu.w #$24` — six bytes a line for each of six bitplanes, which is
    // also why the doc caps a Pbob image at 32 pixels wide
    const rt = run('Reserve Pbobs 4 : Pbob Height 2,20')
    const b = rt.powerbobs.bobs[1]!
    expect(b).not.toBeNull()
    expect(b.maxHeight).toBe(20)
    expect(b.save).toHaveLength(20 * 36)
  })

  it('initialises the four non-zero fields the routine writes', () => {
    // `moveq #$ff,d0` SIGN-EXTENDS to $FFFFFFFF, so the two `move.w` stores
    // write $FFFF and only the `move.b` into $1f writes $FF
    const rt = run('Reserve Pbobs 1 : Pbob Height 1,8')
    const b = rt.powerbobs.bobs[0]!
    expect([b.f8, b.f12, b.planeMask]).toEqual([0xffff, 0xffff, 0xff])
    expect([b.x, b.y, b.image8, b.replace]).toEqual([0, 0, 0, 0])
  })

  it('refuses a number past the reserved count, and a height of zero', () => {
    expect(() => run('Reserve Pbobs 2 : Pbob Height 3,8')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Pbobs 2 : Pbob Height 0,8')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Pbobs 2 : Pbob Height 1,0')).toThrow(/Illegal function call/)
  })

  it('refuses to redefine a Pbob that already has a structure', () => {
    // `tst.l (a0,d6.w) / Rbne routine 125` — so a Pbob cannot be resized;
    // only Pbob Erase, which throws the whole table away, undoes it
    expect(() => run('Reserve Pbobs 2 : Pbob Height 1,8 : Pbob Height 1,16')).toThrow(
      /Illegal function call/,
    )
  })

  it('is 1-based, unlike the AMOS bobs', () => {
    // the doc: "the Pbob numbering starts at 1, not 0"
    const rt = run('Reserve Pbobs 3 : Pbob Height 1,4')
    expect(rt.powerbobs.bobs[0]).not.toBeNull()
    expect(rt.powerbobs.bobs[1]).toBeNull()
  })
})

describe('PowerBobs: Pbob Dbuf (routine 12, $20b2)', () => {
  it('makes Pbob Height allocate a second structure', () => {
    const rt = run('Pbob Dbuf True : Reserve Pbobs 2 : Pbob Height 1,8')
    expect(rt.powerbobs.bobs[0]).not.toBeNull()
    expect(rt.powerbobs.bobsDbuf[0]).not.toBeNull()
    expect(rt.powerbobs.bobsDbuf[0]!.save).toHaveLength(8 * 36)
  })

  it('stores $ffff rather than the flag it was given', () => {
    expect(run('Pbob Dbuf 1').powerbobs.dbuf).toBe(0xffff)
    expect(run('Pbob Dbuf 7').powerbobs.dbuf).toBe(0xffff)
    expect(run('Pbob Dbuf 0').powerbobs.dbuf).toBe(0)
  })

  it('set AFTER the heights leaves a table with no second half', () => {
    // routine 12 only sets a flag; it allocates nothing. This is why the doc
    // says "This command MUST preceed all following commands!"
    const rt = run('Reserve Pbobs 2 : Pbob Height 1,8 : Pbob Dbuf True')
    expect(rt.powerbobs.bobs[0]).not.toBeNull()
    expect(rt.powerbobs.bobsDbuf[0]).toBeNull()
  })
})

describe('PowerBobs: Set Pbob (routine 23, $2960)', () => {
  it('collapses every non-zero replace mode to $ff', () => {
    // `cmp.l #$0,d6 / beq` keeps zero; anything else is `moveq #$ff,d6`
    const rt = run('Reserve Pbobs 3 : Pbob Height 1,8 : Pbob Height 2,8 : Set Pbob 1,0,255 : Set Pbob 2,9,255')
    expect(rt.powerbobs.bobs[0]!.replace).toBe(0)
    expect(rt.powerbobs.bobs[1]!.replace).toBe(0xff)
  })

  it('keeps the plane mask as a BYTE', () => {
    // `move.b d7,$1f(a1)` — the doc's example is %100001 for planes 6 and 1
    const rt = run('Reserve Pbobs 1 : Pbob Height 1,8 : Set Pbob 1,0,%100001')
    expect(rt.powerbobs.bobs[0]!.planeMask).toBe(0b100001)
    const wide = run('Reserve Pbobs 1 : Pbob Height 1,8 : Set Pbob 1,0,511')
    expect(wide.powerbobs.bobs[0]!.planeMask).toBe(255)
  })

  it('writes both copies when Pbob Dbuf is on, so a swap keeps the setting', () => {
    const rt = run('Pbob Dbuf True : Reserve Pbobs 1 : Pbob Height 1,8 : Set Pbob 1,1,%11')
    expect(rt.powerbobs.bobsDbuf[0]!.replace).toBe(0xff)
    expect(rt.powerbobs.bobsDbuf[0]!.planeMask).toBe(0b11)
  })

  it('refuses a Pbob with no structure, where X Pbob does not', () => {
    // `move.l (a0,d5.w),d0 / Rbeq routine 125` — this one checks
    expect(() => run('Reserve Pbobs 2 : Set Pbob 1,0,255')).toThrow(/Illegal function call/)
  })
})

describe('PowerBobs: Pbob Erase and Set Fastpbob Mode (routines 10, 46)', () => {
  it('Pbob Erase drops the table and the count', () => {
    const rt = run('Reserve Pbobs 4 : Pbob Height 1,8 : Pbob Erase')
    expect(rt.powerbobs.count).toBe(0)
    expect(rt.powerbobs.bobs).toEqual([])
  })

  it('after an erase, every accessor is out of range again', () => {
    expect(() => run('Reserve Pbobs 4 : Pbob Height 1,8 : Pbob Erase : Print X Pbob(1)')).toThrow(
      /Illegal function call/,
    )
  })

  it('Set Fastpbob Mode is a plain global flag', () => {
    expect(run('Set Fastpbob Mode True').powerbobs.fastMode).toBe(true)
    expect(run('Set Fastpbob Mode False').powerbobs.fastMode).toBe(false)
  })
})

describe('PowerBobs: X Pbob, Y Pbob, I Pbob (routines 13, 14, 5)', () => {
  it('read the position and the image out of the structure', () => {
    // nothing has drawn yet, so all three answer the cleared fields
    expect(val('Reserve Pbobs 2 : Pbob Height 1,8 : Print X Pbob(1)')).toBe(0)
    expect(val('Reserve Pbobs 2 : Pbob Height 1,8 : Print Y Pbob(1)')).toBe(0)
    expect(val('Reserve Pbobs 2 : Pbob Height 1,8 : Print I Pbob(1)')).toBe(0)
  })

  it('I Pbob shifts down by three, because the image is kept times eight', () => {
    // `move.w $1c(a0),d3 / lsr.w #$3,d3` — the stride of AMOS's icon table,
    // so the draw path never has to multiply
    const rt = run('Reserve Pbobs 1 : Pbob Height 1,8')
    rt.powerbobs.bobs[0]!.image8 = 5 * 8
    expect(rt.powerbobs.bobs[0]!.image8 >>> 3).toBe(5)
  })

  it('the range checks are the same three instructions in all of them', () => {
    for (const f of ['X Pbob', 'Y Pbob', 'I Pbob']) {
      expect(() => run(`Reserve Pbobs 2 : Print ${f}(0)`), f).toThrow(/Illegal function call/)
      expect(() => run(`Reserve Pbobs 2 : Print ${f}(3)`), f).toThrow(/Illegal function call/)
    }
  })

  it('a reserved but undefined Pbob answers 0 rather than reading low memory', () => {
    // DEVIATION: reproduced only as far as the range checks. The real
    // routines do NOT test the structure pointer, so a Pbob with no Pbob
    // Height reads addresses $0/$2/$1c -- the 68000 exception vectors.
    expect(val('Reserve Pbobs 2 : Print X Pbob(1)')).toBe(0)
    expect(val('Reserve Pbobs 2 : Print I Pbob(2)')).toBe(0)
  })
})
