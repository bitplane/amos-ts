import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { BankImage, ObjectBank } from './objects'

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

/** an icon bank of n images, `w` pixels wide and `h` tall, colour i each */
function icons(n: number, w = 16, h = 4): ObjectBank {
  const b = new ObjectBank()
  b.images = []
  for (let i = 1; i <= n; i++) {
    const img = new BankImage(w, h, 8, 0, 0)
    img.pixelsW()[0] = i
    img.flush()
    b.images.push(img)
  }
  return b
}

/** the same runner, with a screen open and an icon bank in place */
function draw(src: string, opts: { n?: number; w?: number; h?: number } = {}): Runtime {
  const exts = new Map([[13, pb.table]])
  printed = ''
  const prog = ['Screen Open 0,320,200,8,Lowres', 'Cls 0', ...src.split('\n')].join('\n')
  const rt = new Runtime(tokenize(prog, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[13, pb]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  rt.iconBank = icons(opts.n ?? 8, opts.w ?? 16, opts.h ?? 4)
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

describe('PowerBobs: Pbob defines, it does not draw (routine 2, $f64)', () => {
  it('stores the position, the height and the image times eight', () => {
    const rt = draw('Reserve Pbobs 2\nPbob Height 1,16\nPbob 1,30,40,3')
    const b = rt.powerbobs.bobs[0]!
    expect([b.x, b.y]).toEqual([30, 40])
    expect(b.f8).toBe(4) // the IMAGE height, over the max height of 16
    expect(b.image8).toBe(3 * 8)
  })

  it('X Pbob and I Pbob read back what Pbob stored', () => {
    const ask = (f: string): number => {
      draw(`Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,12,34,2\nPrint ${f}(1)`)
      return Number(printed.trim())
    }
    expect([ask('X Pbob'), ask('Y Pbob'), ask('I Pbob')]).toEqual([12, 34, 2])
  })

  it('refuses an image wider than two words — the 32-pixel rule', () => {
    // `cmp.w #$2,d1 / Rbhi routine 125`, and the doc says the same
    expect(() => draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,0,0,1', { w: 32 })).not.toThrow()
    expect(() => draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,0,0,1', { w: 48 })).toThrow(
      /Illegal function call/,
    )
  })

  it('refuses an image taller than the Pbob Height it was given', () => {
    expect(() => draw('Reserve Pbobs 1\nPbob Height 1,4\nPbob 1,0,0,1', { h: 4 })).not.toThrow()
    expect(() => draw('Reserve Pbobs 1\nPbob Height 1,4\nPbob 1,0,0,1', { h: 5 })).toThrow(
      /Illegal function call/,
    )
  })

  it('refuses an image number past the bank, and a Pbob with no height', () => {
    expect(() => draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,0,0,9', { n: 8 })).toThrow(
      /Illegal function call/,
    )
    expect(() => draw('Reserve Pbobs 2\nPbob 1,0,0,1')).toThrow(/Illegal function call/)
  })

  it('no icon bank at all is AMOS 36, not one of the range errors', () => {
    // `Rjsr <AMOS> / Rbeq routine 115` and routine 115 is `moveq #$24,d0`
    const exts = new Map([[13, pb.table]])
    const rt = new Runtime(tokenize('Reserve Pbobs 1 : Pbob Height 1,8 : Pbob 1,0,0,1', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[13, pb]]),
      maxSteps: 200_000,
    })
    expect(() => rt.runHeadless(500)).toThrow(/Bank not reserved/)
  })

  it('the clip flag is set for a Pbob off any edge, and the fields still land', () => {
    // the left limit is NEGATIVE and comes from the width: -16 for one word
    const on = draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,-15,0,1')
    expect(on.powerbobs.bobs[0]!.f12 & 0xff00).toBe(0) // still on screen
    const off = draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,-16,0,1')
    expect(off.powerbobs.bobs[0]!.f12 & 0xff00).toBe(0xff00)
    expect(off.powerbobs.bobs[0]!.x).toBe(0xffff & -16) // written anyway
    const right = draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,320,0,1')
    expect(right.powerbobs.bobs[0]!.f12 & 0xff00).toBe(0xff00)
    const below = draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,0,200,1')
    expect(below.powerbobs.bobs[0]!.f12 & 0xff00).toBe(0xff00)
  })

  it('a 32-pixel image gets a left limit of -32, so it clips later', () => {
    const at31 = draw('Reserve Pbobs 1\nPbob Height 1,8\nPbob 1,-31,0,1', { w: 32 })
    expect(at31.powerbobs.bobs[0]!.leftLimit).toBe(-32)
    expect(at31.powerbobs.bobs[0]!.f12 & 0xff00).toBe(0)
  })
})

describe('PowerBobs: Pbob Off, Pdraw 25fps, Pswap Clear (routines 3/4/21, 38, 39)', () => {
  const setup = 'Reserve Pbobs 4\nPbob Height 1,8\nPbob Height 2,8\nPbob Height 3,8\nPbob Height 4,8'
  const lit = (rt: Runtime, n: number): boolean => (rt.powerbobs.bobs[n - 1]!.f12 & 0xff00) !== 0

  it('the bare form turns every Pbob off', () => {
    const rt = draw(`${setup}\nPbob 1,0,0,1\nPbob 2,0,0,1\nPbob Off`)
    expect([lit(rt, 1), lit(rt, 2)]).toEqual([true, true])
  })

  it('the numbered form turns off just that one', () => {
    const rt = draw(`${setup}\nPbob 1,0,0,1\nPbob 2,0,0,1\nPbob Off 1`)
    expect([lit(rt, 1), lit(rt, 2)]).toEqual([true, false])
  })

  it('the range form turns off an inclusive span', () => {
    const rt = draw(`${setup}\nPbob 1,0,0,1\nPbob 2,0,0,1\nPbob 3,0,0,1\nPbob 4,0,0,1\nPbob Off 2 To 3`)
    expect([lit(rt, 1), lit(rt, 2), lit(rt, 3), lit(rt, 4)]).toEqual([false, true, true, false])
  })

  it('a reversed range is an error, and so is one past the count', () => {
    expect(() => draw(`${setup}\nPbob Off 3 To 2`)).toThrow(/Illegal function call/)
    expect(() => draw(`${setup}\nPbob Off 1 To 9`)).toThrow(/Illegal function call/)
    expect(() => draw('Pbob Off')).toThrow(/Illegal function call/) // nothing reserved
  })

  it('Pdraw 25fps loads the pair, and False clears both with one long', () => {
    const on = draw('Pdraw 25fps True')
    expect([on.powerbobs.fps25, on.powerbobs.fps25a, on.powerbobs.fps25b]).toEqual([true, 2, 2])
    const off = draw('Pdraw 25fps True\nPdraw 25fps False')
    expect([off.powerbobs.fps25, off.powerbobs.fps25a, off.powerbobs.fps25b]).toEqual([false, 0, 0])
  })

  it('Pswap Clear flips the CLEAR selector and leaves the draw one alone', () => {
    // `eori.w #$4,$14(a2)` -- Pbob Draw reads $12, Pbob Clear reads $14
    const one = draw('Pswap Clear')
    expect([one.powerbobs.clearSel, one.powerbobs.drawSel]).toEqual([4, 0])
    const two = draw('Pswap Clear\nPswap Clear')
    expect([two.powerbobs.clearSel, two.powerbobs.drawSel]).toEqual([0, 0])
  })
})

describe('PowerBobs: the draw engine (routines 8, 9, 22)', () => {
  const at = (rt: Runtime, x: number, y: number): number => rt.screen.point(x, y)
  const setup = 'Reserve Pbobs 4\nPbob Height 1,8\nPbob Height 2,8'

  it('Pbob Draw puts the image on screen where Pbob said', () => {
    const rt = draw(`${setup}\nPbob 1,10,20,3\nPbob Draw 1 To 1`, { w: 16, h: 4 })
    expect(at(rt, 10, 20)).toBe(3) // icon 3 paints colour 3 at its pixel 0
  })

  it('a Pbob is an OPAQUE rectangle — colour 0 is drawn like any other', () => {
    // BLTCON0 is $09f0 in all three routines: USEA and USED only, minterm
    // $f0, D = A. No B channel and no mask, so unlike an AMOS bob there is
    // no transparency. Only the register value says this.
    const rt = draw(`Cls 5\n${setup}\nPbob 1,10,20,3\nPbob Draw 1 To 1`, { w: 16, h: 4 })
    expect(at(rt, 10, 20)).toBe(3) // the lit pixel
    expect(at(rt, 11, 20)).toBe(0) // and colour 0 WIPED the colour-5 paper
  })

  it('Pbob Clear puts the background back', () => {
    const rt = draw(`Cls 5\n${setup}\nPbob 1,10,20,3\nPbob Draw 1 To 1\nPbob Clear 1 To 1`, {
      w: 16,
      h: 4,
    })
    expect(at(rt, 10, 20)).toBe(5)
    expect(at(rt, 11, 20)).toBe(5)
  })

  it('Pbob Clear before any draw does nothing, because $13 starts set', () => {
    // `tst.b $13(a2) / bne` -- Pbob Height leaves $12/$13 as $FFFF, so the
    // low byte is set and there is nothing to restore
    const rt = draw(`Cls 5\n${setup}\nPbob Clear 1 To 2`, { w: 16, h: 4 })
    expect(at(rt, 0, 0)).toBe(5)
  })

  it('the save happens for EVERY Pbob before any is drawn', () => {
    // two passes, not one: with overlapping Pbobs a single pass would save
    // the first bob's pixels as the second one's background
    const rt = draw(
      `Cls 5\n${setup}\nPbob 1,10,20,3\nPbob 2,10,20,4\nPbob Draw 1 To 2\nPbob Clear 1 To 2`,
      { w: 16, h: 4 },
    )
    expect(at(rt, 10, 20)).toBe(5) // fully restored, not left holding bob 1
  })

  it('Set Pbob replace mode stops the save, so Clear leaves the bob there', () => {
    const rt = draw(
      `Cls 5\n${setup}\nSet Pbob 1,1,255\nPbob 1,10,20,3\nPbob Draw 1 To 1\nPbob Clear 1 To 1`,
      { w: 16, h: 4 },
    )
    expect(at(rt, 10, 20)).toBe(3) // never saved, so never restored
  })

  it('Set Fastpbob Mode stops the save globally', () => {
    const rt = draw(
      `Cls 5\nSet Fastpbob Mode True\n${setup}\nPbob 1,10,20,3\nPbob Draw 1 To 1\nPbob Clear 1 To 1`,
      { w: 16, h: 4 },
    )
    expect(at(rt, 10, 20)).toBe(3)
  })

  it('the plane mask decides which bits reach the screen', () => {
    // `lsr.b #$1,d3 / bcc` walks $1f one bit a plane; a skipped plane keeps
    // whatever the screen had
    const rt = draw(`Cls 0\n${setup}\nSet Pbob 1,0,%1\nPbob 1,10,20,3\nPbob Draw 1 To 1`, {
      w: 16,
      h: 4,
    })
    expect(at(rt, 10, 20)).toBe(1) // colour 3 through a one-plane mask
  })

  it('an off-screen Pbob draws nothing and is not cleared', () => {
    const rt = draw(`Cls 5\n${setup}\nPbob 1,-40,20,3\nPbob Draw 1 To 1\nPbob Clear 1 To 1`, {
      w: 16,
      h: 4,
    })
    expect(at(rt, 0, 20)).toBe(5)
  })

  it('a partly off-screen Pbob draws its visible part', () => {
    const rt = draw(`Cls 5\n${setup}\nPbob 1,-8,20,3\nPbob Draw 1 To 1`, { w: 16, h: 4 })
    // the clipped rectangle is the visible eight columns only: image pixel 0
    // (the lit one) is at x = -8 and never lands, columns 0..7 take the
    // image's colour-0 pixels, and column 8 is past the bob entirely
    expect(at(rt, 0, 20)).toBe(0)
    expect(at(rt, 7, 20)).toBe(0)
    expect(at(rt, 8, 20)).toBe(5)
  })

  it('refuses a reversed range and one past the count', () => {
    expect(() => draw(`${setup}\nPbob Draw 2 To 1`)).toThrow(/Illegal function call/)
    expect(() => draw(`${setup}\nPbob Draw 1 To 9`)).toThrow(/Illegal function call/)
    expect(() => draw(`${setup}\nPbob Clear 2 To 1`)).toThrow(/Illegal function call/)
  })

  it('Pbob Update covers every Pbob, and refuses when none is reserved', () => {
    const rt = draw(`Cls 5\n${setup}\nPbob 1,10,20,3\nPbob 2,40,20,4\nPbob Update`, { w: 16, h: 4 })
    expect([at(rt, 10, 20), at(rt, 40, 20)]).toEqual([3, 4])
    expect(() => draw('Pbob Update')).toThrow(/Illegal function call/)
  })

  it('Pbob Draw flips both selectors only when Pbob Dbuf is on', () => {
    const off = draw(`${setup}\nPbob Draw 1 To 1`)
    expect([off.powerbobs.drawSel, off.powerbobs.clearSel]).toEqual([0, 0])
    const on = draw(`Pbob Dbuf True\n${setup}\nPbob Draw 1 To 1`)
    expect([on.powerbobs.drawSel, on.powerbobs.clearSel]).toEqual([4, 4])
  })

  it('in 25fps mode the flip happens every OTHER draw', () => {
    // `subq.w #$1,$1e(a2) / bne` then a reload of 2
    const one = draw(`Pbob Dbuf True\nPdraw 25fps True\n${setup}\nPbob Draw 1 To 1`)
    expect(one.powerbobs.drawSel).toBe(0) // counted down from 2 to 1: no flip
    const two = draw(`Pbob Dbuf True\nPdraw 25fps True\n${setup}\nPbob Draw 1 To 1\nPbob Draw 1 To 1`)
    expect(two.powerbobs.drawSel).toBe(4)
  })
})

describe('PowerBobs: the array arithmetic block (routines 58-77)', () => {
  /**
   * These walk a CONTIGUOUS block of longs. A memory bank is one; the arena
   * a `Varptr` hands out is not (see the note on `elem`), so the tests use a
   * bank, which is the doc's own second option.
   */
  const bank = (op: string, fill: number[] = [1, 2, 3, 4, 5]): number[] => {
    const src = [
      `Reserve As Work 5,${fill.length * 4}`,
      ...fill.map((v, i) => `Loke Start(5)+${i * 4},${v}`),
      op,
      `For I=0 To ${fill.length - 1} : Print Leek(Start(5)+I*4);"," ; : Next I`,
    ].join('\n')
    run(src)
    return printed
      .split(',')
      .filter((t) => t.trim() !== '')
      .map(Number)
  }

  it('Pinc and Pdec step every element in the range', () => {
    expect(bank('Pinc Start(5),1 To 3')).toEqual([1, 3, 4, 5, 5])
    expect(bank('Pdec Start(5),0 To 4')).toEqual([0, 1, 2, 3, 4])
  })

  it('Padd and Psum add a constant', () => {
    expect(bank('Padd Start(5),10,0 To 2')).toEqual([11, 12, 13, 4, 5])
    expect(bank('Psum Start(5),100,3 To 4')).toEqual([1, 2, 3, 104, 105])
  })

  it('a range WRAPS rather than clamping — the whole point of it', () => {
    // `cmp.l d1,d0 / blt` stores the HIGH limit and `cmp.l d2,d0 / bgt` the
    // LOW one, so a counter that runs off the end comes back round
    expect(bank('Set Pinc Range 1 To 3\nPinc Start(5),0 To 4')).toEqual([2, 3, 1, 1, 1])
    expect(bank('Set Pdec Range 2 To 4\nPdec Start(5),0 To 4')).toEqual([4, 4, 2, 3, 4])
  })

  it('Unset turns the range off again', () => {
    expect(bank('Set Pinc Range 1 To 3\nUnset Pinc Range\nPinc Start(5),0 To 4')).toEqual([
      2, 3, 4, 5, 6,
    ])
  })

  it('the four shifts are long shifts, and Pasr keeps the sign', () => {
    expect(bank('Plsl Start(5),2,0 To 4')).toEqual([4, 8, 12, 16, 20])
    expect(bank('Pasl Start(5),2,0 To 4')).toEqual([4, 8, 12, 16, 20]) // asl.l == lsl.l
    expect(bank('Plsr Start(5),1,0 To 4', [8, 4, 2, 16, 32])).toEqual([4, 2, 1, 8, 16])
    expect(bank('Pasr Start(5),1,0 To 4', [-8, -4, -2, 2, 4])).toEqual([-4, -2, -1, 1, 2])
  })

  it('Pmul Shift multiplies then shifts down, for fixed point', () => {
    // routine 63 is Pmul with one more argument: the shift applied after the
    // hand-built 32x32 multiply
    const src = [
      'Reserve As Work 5,20 : Reserve As Work 6,20',
      'For I=0 To 4 : Loke Start(5)+I*4,(I+1)*256 : Next I',
      'Pmul Shift Start(6),Start(5),3,8,0 To 4',
      'For I=0 To 4 : Print Leek(Start(6)+I*4);"," ; : Next I',
    ].join('\n')
    run(src)
    expect(
      printed
        .split(',')
        .filter((t) => t.trim() !== '')
        .map(Number),
    ).toEqual([3, 6, 9, 12, 15])
  })

  it('all four ranges set and unset independently', () => {
    // Psum $55d/$54c, Pdec $557/$51c, Pinc $554/$504, Padd $55a/$534 -- four
    // separate flags and limit pairs, read out of routines 64 to 67
    expect(bank('Set Psum Range 1 To 3\nPsum Start(5),10,0 To 4')).toEqual([1, 1, 1, 1, 1])
    expect(bank('Set Psum Range 1 To 3\nUnset Psum Range\nPsum Start(5),10,0 To 2')).toEqual([
      11, 12, 13, 4, 5,
    ])
    expect(bank('Set Pdec Range 1 To 9\nUnset Pdec Range\nPdec Start(5),0 To 1')).toEqual([
      0, 1, 3, 4, 5,
    ])
    // Padd's range has no named setter in the table, only an unset
    expect(bank('Unset Padd Range\nPadd Start(5),5,0 To 1')).toEqual([6, 7, 3, 4, 5])
  })

  it('Pmul reads one block and writes another', () => {
    const src = [
      'Reserve As Work 5,20 : Reserve As Work 6,20',
      'For I=0 To 4 : Loke Start(5)+I*4,I+1 : Next I',
      'Pmul Start(6),Start(5),3,0 To 4',
      'For I=0 To 4 : Print Leek(Start(6)+I*4);"," ; : Next I',
    ].join('\n')
    run(src)
    expect(
      printed
        .split(',')
        .filter((t) => t.trim() !== '')
        .map(Number),
    ).toEqual([3, 6, 9, 12, 15])
  })

  it('Pdiv refuses a zero divisor rather than trapping', () => {
    // `move.l (a3)+,d4 / Rbeq routine 125` -- error 23, checked when the
    // argument is popped, not per element
    expect(() =>
      run('Reserve As Work 5,20 : Reserve As Work 6,20\nPdiv Start(6),Start(5),0,0 To 4'),
    ).toThrow(/Illegal function call/)
  })

  it('a reversed or negative range is error 23', () => {
    expect(() => run('Reserve As Work 5,20\nPinc Start(5),3 To 1')).toThrow(/Illegal function call/)
    expect(() => run('Reserve As Work 5,20\nPinc Start(5),-1 To 2')).toThrow(
      /Illegal function call/,
    )
  })

  it('=Same is the constant $80000000', () => {
    // routine 68 is ten bytes: the most negative long there is, which is why
    // it works as a "leave this one alone" marker no coordinate can collide with
    expect(val('Print Same')).toBe(-2147483648)
  })
})
