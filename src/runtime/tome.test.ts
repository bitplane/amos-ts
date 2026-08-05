import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { firstCodeHunk } from '../tokens/libtok'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { BankImage, ObjectBank } from './objects'

const table = new TokenTable(CORE_TOKENS)
/** slot 7 — the slot the corpus actually shows TOME occupying */
const tome = extensionById('tome-4.23')!
const tome31 = extensionById('tome-3.1')!

/**
 * A map bank in the library's own format, read off the drawing routines:
 * `move.w $0(a1)` width in tiles, `move.w $2(a1)` height, then a byte a tile
 * indexed `$4(a1, d0.l)` with `d0 = y * width + x`.
 */
function mapBank(w: number, h: number, tiles: number[]): Uint8Array {
  const b = new Uint8Array(4 + w * h)
  b[0] = w >> 8
  b[1] = w & 0xff
  b[2] = h >> 8
  b[3] = h & 0xff
  b.set(tiles, 4)
  return b
}

/**
 * `n` icons, each one lit pixel of a distinct colour, so a paste is legible.
 *
 * An icon bank's images are 16 pixels wide whatever the picture is
 * (bankRowBytesFor truncates to whole words), so these are 16x1 with only
 * pixel 0 set. A tile paste is masked, colour 0 being transparent, so the
 * other fifteen columns write nothing and one icon marks exactly one pixel.
 */
function icons(n: number): ObjectBank {
  const b = new ObjectBank()
  b.images = []
  for (let i = 1; i <= n; i++) {
    const img = new BankImage(16, 1, 8, 0, 0)
    img.pixelsW()[0] = i
    img.flush()
    b.images.push(img) // images is 1-based, so image(i) is colour i
  }
  return b
}

let printed = ''

function run(src: string, opts: { map?: Uint8Array; briks?: Uint8Array; nIcons?: number; ext?: typeof tome } = {}): Runtime {
  const ext = opts.ext ?? tome
  const exts = new Map([[7, ext.table]])
  printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[7, ext]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  if (opts.map) rt.memBanks.set(1, { kind: 'memory', number: 1, memType: 0, name: 'Map', flags: 0, data: opts.map })
  if (opts.briks) rt.memBanks.set(2, { kind: 'memory', number: 2, memType: 0, name: 'Brik', flags: 0, data: opts.briks })
  rt.iconBank = icons(opts.nIcons ?? 8)
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

/**
 * What got drawn where, read back off the screen.
 *
 * Every drawing program below does `Cls 0` first. Screen Open leaves the
 * bitmap filled with the default paper, which is colour 1 — the same colour
 * icon 1 paints, so without the Cls a "nothing was drawn here" probe cannot
 * tell an untouched pixel from a tile 0.
 */
const at = (rt: Runtime, x: number, y: number): number => rt.screen.point(x, y)

/** run `<setup> : Print <expr>` and read the number back off the console */
function val(src: string, opts: Parameters<typeof run>[1] = {}): number {
  run(src, opts)
  return Number(printed.trim())
}

describe('TOME: the state the setters write', () => {
  it('Tile Size wraps into 1..32 rather than checking the range', () => {
    // routine 10 ($8ec): `subq.l #$1 / andi.l #$1f / addq.l #$1` on each
    // argument, which is ((n-1) & 31) + 1 -- so 33 is 1 and 0 is 32, with no
    // error either way. An earlier guess would have been a clamp.
    expect(run('Tile Size 16,16').tome).toMatchObject({ tileW: 16, tileH: 16 })
    expect(run('Tile Size 32,32').tome).toMatchObject({ tileW: 32, tileH: 32 })
    expect(run('Tile Size 33,33').tome).toMatchObject({ tileW: 1, tileH: 1 })
    expect(run('Tile Size 0,0').tome).toMatchObject({ tileW: 32, tileH: 32 })
    expect(run('Tile Size 1,64').tome).toMatchObject({ tileW: 1, tileH: 32 })
  })

  it('Map View stores four longs and validates nothing', () => {
    // routine 14 ($93e) is four stores and an rts
    const rt = run('Map View 10,20 To 110,120')
    expect(rt.tome).toMatchObject({ viewX1: 10, viewY1: 20, viewX2: 110, viewY2: 120 })
  })

  it('the block ships with the author\'s defaults, not zeroes', () => {
    // routine 0 ($59c) does not build the block: it points $158(a5) at static
    // data at $5f2 and clears only $68, $6c, $4a and eight animation bytes.
    // Everything else is what was assembled -- and $64/$66 do NOT agree with
    // $e/$12 there, which is why Map Hx and Map Fx answer for different tile
    // sizes until the first Tile Size call.
    expect(run('').tome).toMatchObject({
      tileW: 32, tileH: 32, tileWordW: 5, tileWordH: 5,
      mapBank: 6, brikBank: 7, tileTypBank: 8,
      viewX1: 0, viewY1: 0, viewX2: 320, viewY2: 192,
    })
    expect(val('Print Map Hx(32)')).toBe(6) // 32 / 5, off $64
    expect(val('Print Map Fx(32)')).toBe(0) // 32 AND 31, off $e
  })

  it('a map bank that is not reserved is AMOS\'s error, not one of TOME\'s two', () => {
    // routine 67 is `move.l $1a(a0),-(a3) / Rjsr <AMOS 431> / movea.l d3,a1`,
    // which is =Start(n) -- so the failure is FnStart's "bank not reserved"
    // and not the extension's 23 or 74
    expect(() => run('Map Bank 9 : Print Map X')).toThrow(/bank not reserved/i)
  })

  it('Map Bank keeps the NUMBER, not an address', () => {
    // routine 11 ($91a) stores the argument at $1a and resolves it at each
    // draw through routine 67, so the bank can be replaced between draws
    expect(run('Map Bank 3').tome.mapBank).toBe(3)
  })

  it('the other two bank setters are the same twelve bytes at $30 and $34', () => {
    // routines 12 ($926) and 13 ($932), identical to Map Bank but for the
    // offset. 3.1 calls the second one Tile Val Bank; same id, same routine.
    const rt = run('Brik Bank 4 : Tile Typ Bank 5')
    expect(rt.tome).toMatchObject({ brikBank: 4, tileTypBank: 5 })
    expect(run('Brik Bank 4 : Tile Val Bank 5', { ext: tome31 }).tome).toMatchObject({ brikBank: 4, tileTypBank: 5 })
  })
})

describe('TOME: Map Do, the engine (routine 15, $95c)', () => {
  const prog = (extra = '') =>
    ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Map Bank 1', 'Tile Size 1,1', 'Map View 0,0 To 4,3', extra].join('\n')

  it('fills the view from the map, tile by tile', () => {
    // a 4x3 map of distinct tiles, 1x1 tiles, a 4x3 view: one tile per pixel,
    // so the screen IS the map and every index can be checked
    const m = mapBank(4, 3, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3])
    const rt = run(prog('Map Do 0,0'), { map: m })
    // tile n draws icon n+1, whose single pixel is colour n+1
    expect(at(rt, 0, 0)).toBe(1)
    expect(at(rt, 1, 0)).toBe(2)
    expect(at(rt, 3, 0)).toBe(4)
    expect(at(rt, 0, 1)).toBe(5)
    expect(at(rt, 3, 2)).toBe(4)
  })

  it('the tile byte is 0-based and the icon it draws is tile + 1', () => {
    // `addq.l #$1,d1` before the icon lookup, in every drawing routine
    const rt = run(prog('Map Do 0,0'), { map: mapBank(1, 1, [0]) })
    expect(at(rt, 0, 0)).toBe(1)
  })

  it('starts at the map cursor the call is given', () => {
    const m = mapBank(4, 3, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3])
    const rt = run(prog('Map Do 2,1'), { map: m })
    // (2,1) is tile 6 -> icon 7
    expect(at(rt, 0, 0)).toBe(7)
  })

  it('wraps the map in both axes', () => {
    // the routines normalise by repeated add/subtract of the map size and
    // loop back to the test, so any cursor lands in range
    const m = mapBank(2, 2, [0, 1, 2, 3])
    expect(at(run(prog('Map Do 2,0'), { map: m }), 0, 0)).toBe(1) // x wraps to 0
    expect(at(run(prog('Map Do -1,0'), { map: m }), 0, 0)).toBe(2) // and negative
    expect(at(run(prog('Map Do 0,-1'), { map: m }), 0, 0)).toBe(3) // y likewise
    expect(at(run(prog('Map Do 6,0'), { map: m }), 0, 0)).toBe(1) // far outside
  })

  it('a tile is drawn whenever it STARTS before the far edge, so the last one can overhang', () => {
    // the loop tail is `add.l $e(a0),d6 / cmp.l $28(a0),d6 / blt.b $9ba` --
    // the test is AFTER the paste, on the start of the next tile. With 2-wide
    // tiles and a 5-wide view the third column starts at 4, which is < 5, so
    // it is drawn in full and runs two pixels past x2.
    const m = mapBank(4, 1, [0, 1, 2, 3])
    const src = ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Map Bank 1']
    const rt = run([...src, 'Tile Size 2,1', 'Map View 0,0 To 5,1', 'Map Do 0,0'].join('\n'), { map: m })
    expect(at(rt, 0, 0)).toBe(1)
    expect(at(rt, 2, 0)).toBe(2)
    expect(at(rt, 4, 0)).toBe(3) // starts at 4 < 5, so drawn
    expect(at(rt, 6, 0)).toBe(0) // 6 is not < 5, so the fourth is not
  })

  it('an empty view still draws one tile, because both loops are do-while', () => {
    // the paste at $9c2 is entered unconditionally: `blt` is the tail of the
    // loop, never its head. So a degenerate or reversed rectangle is not "draw
    // nothing", it is "draw exactly the tile at (x1,y1)".
    const m = mapBank(2, 2, [3, 0, 0, 0])
    const src = ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Map Bank 1', 'Tile Size 1,1']
    expect(at(run([...src, 'Map View 5,5 To 5,5', 'Map Do 0,0'].join('\n'), { map: m }), 5, 5)).toBe(4)
    expect(at(run([...src, 'Map View 5,5 To 0,0', 'Map Do 0,0'].join('\n'), { map: m }), 5, 5)).toBe(4)
  })
})

describe('TOME: the four edge draws', () => {
  const head = ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Map Bank 1', 'Tile Size 1,1', 'Map View 0,0 To 4,3']
  const m = () => mapBank(4, 3, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3])

  it('Map Left draws one column at the view left edge', () => {
    // routine 16 ($aa2) is Map Do with the row loop deleted
    const rt = run([...head, 'Map Left 1,0'].join('\n'), { map: m() })
    expect(at(rt, 0, 0)).toBe(2) // (1,0) is tile 1
    expect(at(rt, 0, 1)).toBe(6) // (1,1) is tile 5
    expect(at(rt, 1, 0)).toBe(0) // nothing beside it
  })

  it('Map Top draws one row at the view top edge', () => {
    const rt = run([...head, 'Map Top 0,1'].join('\n'), { map: m() })
    expect(at(rt, 0, 0)).toBe(5) // (0,1) is tile 4
    expect(at(rt, 1, 0)).toBe(6)
    expect(at(rt, 0, 1)).toBe(0) // nothing below
  })

  it('Map Right takes the SAME top-left cursor and finds the last column itself', () => {
    // routine 17 ($bae): (x2-x1) / tileWidth - 1 columns along from the
    // cursor, drawn at x2 - tileWidth. It is NOT "the map position of the
    // right edge" -- passing 0,0 with a 4-wide view draws map column 3.
    const rt = run([...head, 'Map Right 0,0'].join('\n'), { map: m() })
    expect(at(rt, 3, 0)).toBe(4) // (3,0) is tile 3, at the right edge
    expect(at(rt, 3, 1)).toBe(8)
    expect(at(rt, 0, 0)).toBe(0) // and nothing at the left
  })

  it('Map Bottom is Map Right on the other axis', () => {
    // routine 19 ($df2): (y2-y1) / tileHeight - 1 rows down, at y2 - tileH
    const rt = run([...head, 'Map Bottom 0,0'].join('\n'), { map: m() })
    expect(at(rt, 0, 2)).toBe(1) // (0,2) is tile 0
    expect(at(rt, 1, 2)).toBe(2)
    expect(at(rt, 0, 0)).toBe(0)
  })
})

describe('TOME: the two errors', () => {
  it('no icon bank is error 23 (routine 81)', () => {
    // `moveq #$17,d0 / Rjmp L_ScCopy`
    const exts = new Map([[7, tome.table]])
    const rt = new Runtime(tokenize('Map Bank 1 : Map Do 0,0', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[7, tome]]),
      maxSteps: 100_000,
    })
    const data = mapBank(1, 1, [0])
    rt.memBanks.set(1, { kind: 'memory', number: 1, memType: 0, name: 'Map', flags: 0, data })
    rt.iconBank = null
    expect(() => rt.runHeadless(200)).toThrow(/illegal function call/i)
  })

  it('a tile above the icon count is error 74, and equal to it is legal', () => {
    // `cmp.w $8(a0),d1 / Rbhi routine 82` -- Rbhi is UNSIGNED strictly
    // greater, so icon === count passes and count + 1 is "Icon not defined"
    const head = ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Map Bank 1', 'Tile Size 1,1', 'Map View 0,0 To 1,1']
    // two icons; tile 1 -> icon 2, exactly the count
    expect(() => run([...head, 'Map Do 0,0'].join('\n'), { map: mapBank(1, 1, [1]), nIcons: 2 })).not.toThrow()
    // tile 2 -> icon 3, one past
    expect(() => run([...head, 'Map Do 0,0'].join('\n'), { map: mapBank(1, 1, [2]), nIcons: 2 })).toThrow(
      /icon not defined/i,
    )
  })
})

describe('TOME 3.1 is 4.23 with one keyword renamed', () => {
  it('the first 35 entries agree on id, spec and routine', () => {
    // slice 0 established this against the binaries; pinned here so a
    // regenerated table cannot quietly break the shared port
    const a = tome31.tokens
    const b = tome.tokens
    expect(a.length).toBe(35)
    const key = (e: (typeof a)[number]): string => `${e.id}|${e.spec}|${e.instr}`
    for (let i = 0; i < a.length; i++) expect(key(a[i]!), `entry ${i}`).toBe(key(b[i]!))
  })

  it('the one rename is tile val bank -> tile typ bank at $1ba', () => {
    const diff = tome31.tokens
      .map((e, i) => ({ a: e.name, b: tome.tokens[i]!.name, id: e.id }))
      .filter((p) => p.a !== p.b)
    expect(diff).toEqual([{ a: 'tile val bank', b: 'tile typ bank', id: 0x1ba }])
  })
})

describe('TOME: the query functions', () => {
  const m = () => mapBank(4, 3, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3])

  it('Xtile and Ytile divide the pixel by the tile, relative to the view', () => {
    // routines 3 ($74c) and 2 ($732): `sub.l $20(a0),d3 / divu.w`
    const head = 'Map View 100,50 To 300,150 : Tile Size 16,8 : '
    expect(val(`${head}Print Xtile(100)`)).toBe(0)
    expect(val(`${head}Print Xtile(131)`)).toBe(1)
    expect(val(`${head}Print Xtile(132)`)).toBe(2)
    expect(val(`${head}Print Ytile(66)`)).toBe(2)
    // Map Pos X/Y are routines 63 and 64, the same code a second time
    expect(val(`${head}Print Map Pos X(132)`)).toBe(2)
    expect(val(`${head}Print Map Pos Y(66)`)).toBe(2)
  })

  it('a pixel left of the view overflows divu.w and answers the difference', () => {
    // the quotient of a huge unsigned dividend does not fit in sixteen bits,
    // so `divu.w` leaves d3 alone and `andi.l #$ffff` takes the low word of
    // what was being divided. -1 comes back as 65535, not as -1 or 0.
    expect(val('Map View 100,50 To 300,150 : Tile Size 16,8 : Print Xtile(99)')).toBe(0xffff)
    expect(val('Map View 100,50 To 300,150 : Tile Size 16,8 : Print Ytile(34)')).toBe(0xfff0)
  })

  it('Map Hx/Hy divide with no view, and Map Fx/Fy MASK rather than take a remainder', () => {
    // routines 32-35. The mask is `subq.w #$1` on the tile size, so it is only
    // the remainder for a power of two -- and Tile Size allows 1..32.
    expect(val('Tile Size 16,16 : Print Map Hx(100)')).toBe(6)
    expect(val('Tile Size 16,8 : Print Map Hy(100)')).toBe(12)
    expect(val('Tile Size 16,16 : Print Map Fx(100)')).toBe(4)
    expect(val('Tile Size 16,16 : Print Map Fy(100)')).toBe(4)
    // 24 is not a power of two, and there the pair stops being consistent:
    // 50 is 2 tiles and 2 pixels in, so Map Hx says 2 and a remainder would
    // say 2 -- but 50 AND 23 is 18, which is larger than the tile itself
    expect(val('Tile Size 24,24 : Print Map Hx(50)')).toBe(2)
    expect(val('Tile Size 24,24 : Print Map Fx(50)')).toBe(18)
  })

  it('Map X and Map Y read the bank header, not the cached copy', () => {
    // routines 21 ($f98) and 22 ($faa), each `Rbsr routine 67` then one move
    expect(val('Map Bank 1 : Print Map X', { map: m() })).toBe(4)
    expect(val('Map Bank 1 : Print Map Y', { map: m() })).toBe(3)
  })

  it('Map Tile is RAW and out of range is an error, not a wrap', () => {
    // routine 4 ($766): no `addq.l #$1`, and all four bounds go to routine 81
    expect(val('Map Bank 1 : Print Map Tile(1,1)', { map: m() })).toBe(5)
    expect(val('Map Bank 1 : Print Map Tile(3,2)', { map: m() })).toBe(3)
    expect(() => val('Map Bank 1 : Print Map Tile(4,0)', { map: m() })).toThrow(/illegal function call/i)
    expect(() => val('Map Bank 1 : Print Map Tile(-1,0)', { map: m() })).toThrow(/illegal function call/i)
    expect(() => val('Map Bank 1 : Print Map Tile(0,3)', { map: m() })).toThrow(/illegal function call/i)
  })

  it('Map Length sizes a Reserve and never touches a bank', () => {
    // routine 39 ($1466): `mulu.w d0,d3 / addq.l #$4,d3`
    expect(val('Print Map Length(40,25)')).toBe(1004)
    expect(val('Print Map Length(0,0)')).toBe(4)
  })

  it('Tile Count counts one byte value across the whole map', () => {
    // routine 65 ($1f4c), a `cmp.b` so only the low eight bits are compared
    expect(val('Map Bank 1 : Print Tile Count(0)', { map: m() })).toBe(2)
    expect(val('Map Bank 1 : Print Tile Count(3)', { map: m() })).toBe(2)
    expect(val('Map Bank 1 : Print Tile Count(9)', { map: m() })).toBe(0)
    expect(val('Map Bank 1 : Print Tile Count(256)', { map: m() })).toBe(2) // & $ff
  })

  it('Map Check REPAIRS the map and returns how many tiles it zeroed', () => {
    // routine 31 ($1284): `cmp.l d7,d2 / bge` against the icon count, then
    // `move.b #$0`. A tile at or above the count is one that would raise
    // error 74 mid-draw, so this is what makes a map safe after the icon
    // bank has been swapped for a smaller one.
    const data = mapBank(2, 2, [0, 4, 9, 1])
    run('Map Bank 1 : Print Map Check', { map: data, nIcons: 5 })
    expect(Number(printed.trim())).toBe(1) // only tile 9 is >= 5
    expect([...data.slice(4)]).toEqual([0, 4, 0, 1])
    // no icon bank at all is routine 70's error, raised before the map is read
    const noIcons = new Runtime(tokenize('Map Bank 1 : Print Map Check', table, new Map([[7, tome.table]])), table, {
      extensions: new Map([[7, tome.table]]),
      extBindings: new Map([[7, tome]]),
      maxSteps: 100_000,
    })
    noIcons.memBanks.set(1, { kind: 'memory', number: 1, memType: 0, name: 'Map', flags: 0, data })
    noIcons.iconBank = null
    expect(() => noIcons.runHeadless(200)).toThrow(/illegal function call/i)
  })

  it('Map Base answers 0 rather than inventing a pointer', () => {
    // routine 28 ($1158) hands back $158(a5) itself. APPROXIMATED: there is no
    // address here whose layout is the machine's, and 0 reads as "unavailable"
    expect(val('Print Map Base')).toBe(0)
  })
})

describe('TOME: briks (routines 5, 6, 23, 24, 25)', () => {
  /**
   * A brik bank in the library's own format, read off routine 5: a count
   * word, then a LONG per brik holding its offset from the bank's own base,
   * then each record as width word, height word, a byte a cell.
   */
  function brikBank(briks: Array<{ w: number; h: number; cells: number[] }>): Uint8Array {
    const head = 2 + briks.length * 4
    const size = head + briks.reduce((n, b) => n + 4 + b.w * b.h, 0)
    const b = new Uint8Array(size)
    const v = new DataView(b.buffer)
    v.setUint16(0, briks.length)
    let at = head
    briks.forEach((br, i) => {
      v.setUint32(2 + i * 4, at)
      v.setUint16(at, br.w)
      v.setUint16(at + 2, br.h)
      b.set(br.cells, at + 4)
      at += 4 + br.w * br.h
    })
    return b
  }

  const twoBriks = () =>
    brikBank([
      { w: 2, h: 2, cells: [0, 1, 2, 3] },
      { w: 3, h: 1, cells: [4, 5, 6] },
    ])

  /** put a brik bank in bank 2 and point Brik Bank at it */
  const withBriks = (src: string, opts: Parameters<typeof run>[1] = {}): Runtime =>
    run(`Brik Bank 2\n${src}`, { briks: twoBriks(), ...opts })

  it('Brik X, Brik Y and Briks read the bank head and a record', () => {
    // routine 25 ($10f2) is the count word; 5 ($7b2) walks the LONG table at
    // $2 to a record and reads its width; 6 ($7e0) is 5 plus one instruction
    expect(val('Brik Bank 2 : Print Briks', { briks: twoBriks() })).toBe(2)
    expect(val('Brik Bank 2 : Print Brik X(1)', { briks: twoBriks() })).toBe(2)
    expect(val('Brik Bank 2 : Print Brik Y(1)', { briks: twoBriks() })).toBe(2)
    expect(val('Brik Bank 2 : Print Brik X(2)', { briks: twoBriks() })).toBe(3)
    expect(val('Brik Bank 2 : Print Brik Y(2)', { briks: twoBriks() })).toBe(1)
  })

  it('brik numbers are 1-based and both ends error', () => {
    // `subi.l #$1,d6 / Rbmi routine 81` and `cmp.w $0(a2),d6 / Rbge routine 81`
    expect(() => val('Brik Bank 2 : Print Brik X(0)', { briks: twoBriks() })).toThrow(/illegal function call/i)
    expect(() => val('Brik Bank 2 : Print Brik X(3)', { briks: twoBriks() })).toThrow(/illegal function call/i)
  })

  it('Map Brik stamps a brik into the map and truncates at the far edges', () => {
    // routine 23 ($fbc): `cmp.w $16(a0),d4 / bge` ends the row early and the
    // next row picks up, `cmp.w $18(a0),d5 / bge` returns outright
    const m = mapBank(3, 3, [9, 9, 9, 9, 9, 9, 9, 9, 9])
    withBriks('Map Bank 1 : Map Brik 1,0,0', { map: m, briks: twoBriks() })
    expect([...m.slice(4)]).toEqual([0, 1, 9, 2, 3, 9, 9, 9, 9])
    // the same brik at x=2 loses its right column, and at y=2 its lower row
    const m2 = mapBank(3, 3, [9, 9, 9, 9, 9, 9, 9, 9, 9])
    withBriks('Map Bank 1 : Map Brik 1,2,2', { map: m2, briks: twoBriks() })
    expect([...m2.slice(4)]).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 0])
  })

  it('Paste Brik draws the brik as icons, stepping by the tile size', () => {
    // routine 24 ($1048), through the same icon paste the map draws use
    const rt = withBriks(
      ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Tile Size 1,1', 'Paste Brik 1,0,0'].join('\n'),
      { briks: twoBriks() },
    )
    // cell n draws icon n+1, so the 2x2 brik [0,1,2,3] paints 1,2 / 3,4
    expect(at(rt, 0, 0)).toBe(1)
    expect(at(rt, 1, 0)).toBe(2)
    expect(at(rt, 0, 1)).toBe(3)
    expect(at(rt, 1, 1)).toBe(4)
  })

  it('Paste Brik takes x and y UNSIGNED, so a negative one is off to the right', () => {
    // `clr.l d2 / move.w $a(a0),d2` zero-extends what was stored as a word,
    // so -1 is 65535 and the brik lands nowhere rather than one pixel left
    const rt = withBriks(
      ['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Tile Size 1,1', 'Paste Brik 1,-1,0'].join('\n'),
      { briks: twoBriks() },
    )
    for (let x = 0; x < 4; x++) expect(at(rt, x, 0)).toBe(0)
  })

  it('Tile Val reads the map, then the tile-type bank as 256-byte tables', () => {
    // routine 7 ($7ea): map lookup with all four bounds checked, then
    // `asl.l #$8,d6 / adda.l d6,a2 / move.b (a2,d4.l),d3`
    const m = mapBank(2, 1, [3, 200])
    const typ = new Uint8Array(512)
    typ[3] = 11 // table 0, tile 3
    typ[200] = 22 // table 0, tile 200
    typ[256 + 3] = 33 // table 1, tile 3
    expect(val('Map Bank 1 : Tile Typ Bank 2 : Print Tile Val(0,0,0)', { map: m, briks: typ })).toBe(11)
    expect(val('Map Bank 1 : Tile Typ Bank 2 : Print Tile Val(1,0,0)', { map: m, briks: typ })).toBe(22)
    expect(val('Map Bank 1 : Tile Typ Bank 2 : Print Tile Val(0,0,1)', { map: m, briks: typ })).toBe(33)
    expect(() => val('Map Bank 1 : Tile Typ Bank 2 : Print Tile Val(2,0,0)', { map: m, briks: typ })).toThrow(
      /illegal function call/i,
    )
  })
})

describe('TOME: the two strings the library ships (routines 26 and 27)', () => {
  const lib = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'extensions', 'tome-4.23', 'TOME.Lib')

  /** the length-prefixed string at `off` in the static block at $5f2 */
  function shipped(off: number): string {
    const code = firstCodeHunk(new Uint8Array(readFileSync(lib)))
    const at = 0x5f2 + off
    const n = (code[at]! << 8) | code[at + 1]!
    return String.fromCharCode(...code.slice(at + 2, at + 2 + n))
  }

  it('answers the right lengths', () => {
    // both routines copy a length-prefixed string byte by byte into AMOS
    // string space, $130(a0) for the version and $d6(a0) for the credit
    expect(val('Print Len(Tme Ver$)')).toBe(14)
    expect(val('Print Len(Tme Credit$)')).toBe(88)
  })

  it.skipIf(!existsSync(lib))('transcribes them byte for byte from TOME.Lib', () => {
    // the port carries these as literals, so the check that matters is
    // against the library itself rather than against a fixture built here
    run('A$=Tme Ver$ : B$=Tme Credit$ : Print A$;B$;')
    expect(printed).toBe(shipped(0x130) + shipped(0xd6))
    expect(shipped(0x130)).toContain('TOME V4.23')
    expect(shipped(0xd6)).toContain('by Aaron Fothergill')
  })
})
