import { describe, expect, it } from 'vitest'
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

function run(src: string, opts: { map?: Uint8Array; nIcons?: number; ext?: typeof tome } = {}): Runtime {
  const ext = opts.ext ?? tome
  const exts = new Map([[7, ext.table]])
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[7, ext]]),
    maxSteps: 200_000,
  })
  if (opts.map) rt.memBanks.set(1, { kind: 'memory', number: 1, memType: 0, name: 'Map', flags: 0, data: opts.map })
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
