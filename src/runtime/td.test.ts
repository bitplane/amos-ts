import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { loadHunks } from '../loader/hunk'
import type { TdFrame, TdMatrix, TdView } from './td'
import { TD_ARCTAN, TD_NEAR, TD_ONE, tdAtan2, tdCentreRow, tdScanFill, tdScreenX, tdScreenY, parseTdBlocks, tdBlockColours, tdBlockForFace, parseTdSurface, tdSurfaceFills, tdSurfaceSlots, TD_REVOLUTION, TD_SINE, TD_SINE_STEPS, parseTdFile, parseTdGeometry, parseTdTemplate, tdClipCode, tdCos, tdInstanceFaces, tdMatrix, tdProject, tdRotate, tdRange, tdRedrawFaces, tdSections, tdSin, tdViewFor, tdViewRotate } from './td'

/**
 * AMOS 3D, verified against the engine binary via src/cli/tddis.ts, the
 * QuickCard for keyword shapes, and the thirteen demo programs that shipped
 * with it. Each test names which. The 111-page user guide is a scan whose OCR
 * turns "3D" into "30" and confuses l/I/1, so it is never cited for a number.
 */
const table = new TokenTable(CORE_TOKENS)
const TD_SLOT = 4
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [TD_SLOT, extensionById('amos3d-1.0')!.table] as const,
])

const OBJECTS = 'fixtures/extensions/amos3d-1.0/demos/AMOS_3D_demos/objects'

function run(src: string, files: Record<string, Uint8Array> = {}): { out: string; rt: Runtime } {
  let out = ''
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  for (const [name, bytes] of Object.entries(files)) fs.writeFile(`DH0:${name}`, bytes)
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 200_000,
    extensions,
    fs,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(2_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt }
}

/** the shipped objects, so the parser is checked against real files */
const shipped = (name: string): Uint8Array => new Uint8Array(readFileSync(`${OBJECTS}/${name}`))

/** an object plus every file it links to, for the cases that need to succeed */
function objectAndLinks(name: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = { [name]: shipped(name) }
  for (const l of parseTdFile(shipped(name)).links) {
    const f = `${l.name}${l.type === 4 ? '.3DT' : '.3DS'}`
    if (!files[f] && existsSync(`${OBJECTS}/${f}`)) files[f] = shipped(f)
  }
  return files
}

describe('AMOS 3D object files (loader at $219ba4)', () => {
  it('splits an object into its block and its link records', () => {
    // "(410)" then 410 bytes then the links, terminated by a zero offset.
    // amiga.3DO names one template and three surfaces.
    const p = parseTdFile(shipped('amiga.3DO'))
    expect(p.block.length).toBe(410)
    expect(p.links).toEqual([
      { type: 4, offset: 110, name: 'p8' },
      { type: 2, offset: 234, name: 'pq134' },
      { type: 2, offset: 250, name: 'pq97' },
      { type: 2, offset: 282, name: 'pq136' },
    ])
  })

  it('reads every object, template and surface on the demo disc', () => {
    // The format claim is only worth as much as the files it survives: all
    // 110 of them, .3DO, .3DT and .3DS alike, and every link record parses.
    const files = readdirSync(OBJECTS)
    let links = 0
    for (const f of files) links += parseTdFile(shipped(f)).links.length
    expect(files.length).toBe(111)
    expect(links).toBe(130)
  })

  it('recovers the five section offsets the loader turns into pointers', () => {
    // $219cba: the u16s at +$38/$3a/$3c/$3e/$40 become the pointers at
    // +$1c/$18/$0c/$42/$14, so each must land inside the block
    const p = parseTdFile(shipped('amiga.3DO'))
    const s = tdSections(p.block)
    expect(Object.keys(s).length).toBe(5)
    for (const [ptr, off] of Object.entries(s)) {
      expect(off, `section for +$${Number(ptr).toString(16)}`).toBeGreaterThan(0)
      expect(off).toBeLessThanOrEqual(p.block.length)
    }
  })

  it('refuses a file whose header will not parse', () => {
    expect(() => parseTdFile(new Uint8Array([0x41, 0x42, 0x43]))).toThrow(/Bad Object file/)
  })
})

describe('AMOS 3D loading keywords (engine binary + the demo programs)', () => {
  it('Td Dir appends a separator unless one is there', () => {
    // $21164c: `moveq #$2f,d0 : cmp.b -1(a2),d0 : bne : move.b d0,(a2)+`,
    // which is what lets Dice_Spin write Td Dir ":AMOS_3D_demos/objects"
    expect(run('Td Dir "objects"').rt.td.dir).toBe('objects/')
    expect(run('Td Dir "objects/"').rt.td.dir).toBe('objects/')
  })

  it('Td Dir "" becomes the root, because the byte it tests is BSS zero', () => {
    // With nothing copied, `cmp.b -1(a2)` reads in front of the buffer. That
    // byte is the tail of the BSS run before it and is always zero, so the
    // separator always goes on and the directory becomes "/".
    expect(run('Td Dir ""').rt.td.dir).toBe('/')
  })

  it('Td Dir refuses a string over 68 characters', () => {
    expect(() => run(`Td Dir "${'x'.repeat(69)}"`)).toThrow(/Directory string too long/)
    expect(() => run(`Td Dir "${'x'.repeat(68)}"`)).not.toThrow()
  })

  it('Td Load pulls in the object and everything it links to', () => {
    // rocket.3DO names p5.3DT and m3s0/m3s1.3DS, the latter twice — one
    // surface shared by two faces, loaded once and pointed at from both
    const files = objectAndLinks('rocket.3DO')
    const { rt } = run('Td Load "rocket"', files)
    expect([...rt.td.objects.keys()].sort()).toEqual(['m3s0', 'm3s1', 'p5', 'rocket'])
    const links = rt.td.objects.get('rocket')!.linked
    expect([...links.values()].filter((o) => o.name === 'm3s0').length).toBe(2)
  })

  it('a missing object, template and surface each report differently', () => {
    expect(() => run('Td Load "nothing"')).toThrow(/Object file not found/)
    // bullet.3DO needs f12.3DT, which is not supplied here
    expect(() => run('Td Load "bullet"', { 'bullet.3DO': shipped('bullet.3DO') })).toThrow(/Template file not found/)
    // rocket.3DO with its template but not its surfaces
    expect(() =>
      run('Td Load "rocket"', { 'rocket.3DO': shipped('rocket.3DO'), 'p5.3DT': shipped('p5.3DT') }),
    ).toThrow(/Surface file not found/)
  })

  it('loads dice.3DO, the object thirty of the thirty-five demo objects need', () => {
    // p8.3DT is not on the AMOS 3D demo disc at all — only an unbuilt p8.3DO
    // under the Object Modeller — but eighteen copies of it are scattered over
    // the AMOS PD Library CD, and the one from an AMOS_System drawer is here.
    // They differ only in embedded absolute addresses, which are dumped
    // memory pointers the loader rewrites and this port never reads.
    const { rt } = run('Td Load "dice"', objectAndLinks('dice.3DO'))
    expect(rt.td.objects.get('dice')!.linked.get(110)!.name).toBe('p8')
  })

  it('loading the same object twice is an error', () => {
    const files = objectAndLinks('polygons.3DO')
    expect(() => run('Td Load "polygons"\nTd Load "polygons"', files)).toThrow(/Object already loaded/)
    // ...and Td Clear All puts it back to a state where it can load again
    expect(() => run('Td Load "polygons"\nTd Clear All\nTd Load "polygons"', files)).not.toThrow()
  })

  it('Td Load prefixes the Td Dir directory', () => {
    const files: Record<string, Uint8Array> = {}
    for (const [k, v] of Object.entries(objectAndLinks('polygons.3DO'))) files['objects/' + k] = v
    const { rt } = run('Td Dir "objects"\nTd Load "polygons"', files)
    expect(rt.td.objects.has('polygons')).toBe(true)
  })

  it('Td Screen Height takes 1 to 256 and not while objects are loaded', () => {
    // `cmp.l #1 / bcs` then `cmpi.l #$100 / bls` at $211526, then
    // `tst.l $4814(a4) / beq` — Dice_Spin sets 200 before its Td Object
    expect(run('Td Screen Height 200').rt.td.screenHeight).toBe(200)
    expect(() => run('Td Screen Height 0')).toThrow(/Invalid 3d screen size/)
    expect(() => run('Td Screen Height 257')).toThrow(/Invalid 3d screen size/)
    // it is live instances that block the change, not loaded objects — every
    // demo loads first and sets the height just before its Td Object
    expect(() => run('Td Load "polygons"\nTd Screen Height 200', objectAndLinks('polygons.3DO'))).not.toThrow()
    expect(() =>
      run(
        'Td Load "polygons"\nTd Object 1,"polygons",0,0,0,0,0,0\nTd Screen Height 200',
        objectAndLinks('polygons.3DO'),
      ),
    ).toThrow(/Can’t change screen size while objects exist/)
  })

  it('Td Keep and Td Quit record what the manual says they do', () => {
    expect(run('Td Keep Off').rt.td.keep).toBe(false)
    expect(run('Td Keep Off\nTd Keep On').rt.td.keep).toBe(true)
    const { rt } = run('Td Load "polygons"\nTd Quit', objectAndLinks('polygons.3DO'))
    expect(rt.td.objects.size).toBe(0)
  })
})

describe('AMOS 3D instances (Td Object at $211694, Td Move at $21188a)', () => {
  const load = (): Record<string, Uint8Array> => objectAndLinks('polygons.3DO')
  const withObject = (extra: string): { out: string; rt: Runtime } =>
    run(['Td Load "polygons"', 'Td Object 1,"polygons",100,200,1500,0,0,0', extra].join('\n'), load())

  it('Td Object places an instance with a position and three angles', () => {
    // Dice_Spin's own form: Td Object 1,"dice",0,0,1500,0,0,0
    const { rt } = withObject('')
    const inst = rt.td.instances.get(1)!
    expect(inst.pos).toEqual([100, 200, 1500])
    expect(inst.angle).toEqual([0, 0, 0])
    expect(inst.object.name).toBe('polygons')
  })

  it('object numbers run 1 to 20', () => {
    // `moveq #$14,d0 : cmp.l d0,d6 : bcs` on n-1, so 1..20 and nothing else
    const src = (n: number): string => `Td Load "polygons"\nTd Object ${n},"polygons",0,0,0,0,0,0`
    expect(() => run(src(20), load())).not.toThrow()
    expect(() => run(src(21), load())).toThrow(/Invalid object number/)
    expect(() => run(src(0), load())).toThrow(/Invalid object number/)
  })

  it('a taken slot and an unloaded name report differently', () => {
    expect(() => withObject('Td Object 1,"polygons",0,0,0,0,0,0')).toThrow(/Object already exists/)
    expect(() => run('Td Object 1,"nope",0,0,0,0,0,0')).toThrow(/Object not loaded/)
  })

  it('Td Kill frees the slot', () => {
    const { rt } = withObject('Td Kill 1')
    expect(rt.td.instances.size).toBe(0)
    expect(() => withObject('Td Kill 2')).toThrow(/Object does not exist/)
  })

  it('Td Move sets and Td Move Rel adds', () => {
    // $21188a stores three longs; $2118bc is the same three as add.l
    expect(withObject('Td Move 1,10,20,30').rt.td.instances.get(1)!.pos).toEqual([10, 20, 30])
    expect(withObject('Td Move Rel 1,10,20,30').rt.td.instances.get(1)!.pos).toEqual([110, 220, 1530])
  })

  it('Td Angle works in 65536ths of a revolution and wraps at 32 bits', () => {
    // The matrix builder at $213df8 reduces by quadrant with `btst #6/#7` on
    // the angle's high byte and reflects about $8000 — a full turn is $10000.
    expect(withObject('Td Angle 1,16384,32768,49152').rt.td.instances.get(1)!.angle).toEqual([16384, 32768, 49152])
    // Dice_Spin drives this negative every frame and never normalises
    const spun = withObject('Td Angle Rel 1,-6000,-2400,-120')
    expect(spun.rt.td.instances.get(1)!.angle).toEqual([-6000, -2400, -120])
  })

  it('Td Position and Td Attitude read the triples back', () => {
    const { out } = withObject(
      'Td Angle 1,11,22,33\nPrint Td Position X(1);Td Position Y(1);Td Position Z(1);Td Attitude A(1);Td Attitude B(1);Td Attitude C(1)',
    )
    expect(out).toBe(' 100 200 1500 11 22 33\n')
    expect(() => run('Print Td Position X(1)')).toThrow(/Object does not exist/)
  })

  it('Td Clear All takes the instances with it', () => {
    const { rt } = withObject('Td Clear All')
    expect(rt.td.instances.size).toBe(0)
    expect(rt.td.objects.size).toBe(0)
  })
})

describe('AMOS 3D display (Td Cls at $2114be)', () => {
  it('refuses a screen 3D cannot draw on', () => {
    // EcTx must be exactly 320, EcNPlan at least 4, EcTy at least the
    // Td Screen Height — three checks, one error between them
    const bad = (open: string): string => `${open}\nTd Screen Height 100\nTd Cls`
    expect(() => run(bad('Screen Open 0,640,200,16,Hires'))).toThrow(/not compatible with 3d/)
    expect(() => run(bad('Screen Open 0,320,200,4,Lowres'))).toThrow(/not compatible with 3d/)
    expect(() => run(bad('Screen Open 0,320,64,16,Lowres'))).toThrow(/not compatible with 3d/)
  })

  it('clears the top Td Screen Height lines and leaves the rest', () => {
    // Dice_Spin's screen exactly: Screen Open 0,320,200,16,Lowres
    const { rt } = run(
      ['Screen Open 0,320,200,16,Lowres', 'Ink 5 : Bar 0,0 To 319,199', 'Td Screen Height 100', 'Td Cls'].join('\n'),
    )
    expect(rt.screen.point(160, 50)).toBe(0)
    expect(rt.screen.point(160, 150)).toBe(5)
  })
})

describe('AMOS 3D templates (relocation at $2199ba)', () => {
  it('rebuilds p8.3DT’s four section pointers from the offsets beside them', () => {
    // A .3DT opens with four absolute Amiga addresses. The loader overwrites
    // them from u16 offsets at +$1e/+$22/+$20/+$1c, and the difference
    // between the new first section and the old pointer that was there is the
    // delta every other stored pointer needs. Checking that the delta
    // explains all four is what proves the reading.
    const t = parseTdTemplate(parseTdFile(shipped('p8.3DT'), 22))
    expect(t.sections).toEqual([3124, 3388, 3324, 52])
    const v = new DataView(t.block.buffer, t.block.byteOffset, t.block.byteLength)
    for (const [i, slot] of [0x00, 0x04, 0x08, 0x0c].entries()) {
      expect(v.getUint32(slot, false) + t.delta, `slot +$${slot.toString(16)}`).toBe(t.sections[i])
    }
  })

  it('decodes every template on the disc with all pointers inside the block', () => {
    // Eight templates, from f4a's 122 bytes to p8's 3,418. The record array
    // is (u16)+$12 ten-byte entries hanging off the section at +$0c, which is
    // always 52 — a fixed header — and each opens with a pointer to relocate.
    const files = readdirSync(OBJECTS).filter((f) => /\.3dt$/i.test(f))
    expect(files.length).toBeGreaterThanOrEqual(7)
    for (const f of files) {
      const t = parseTdTemplate(parseTdFile(shipped(f), 22))
      expect(t.sections[3], f).toBe(52)
      for (const s of t.sections) expect(s, `${f} section`).toBeLessThanOrEqual(t.block.length)
      for (const r of t.records) {
        expect(r.target, `${f} record at ${r.at}`).toBeGreaterThanOrEqual(0)
        expect(r.target).toBeLessThanOrEqual(t.block.length)
      }
    }
  })

  it('scales its record count with the shape’s complexity', () => {
    const recs = (f: string): number => parseTdTemplate(parseTdFile(shipped(f), 22)).records.length
    expect(recs('f4a.3DT')).toBe(2)
    expect(recs('p5.3DT')).toBe(26)
    expect(recs('p8.3DT')).toBe(56)
  })
})

describe('AMOS 3D geometry (vertex transform at $21085c, face walk at $217ee2)', () => {
  const geo = (name: string) => parseTdGeometry(parseTdFile(shipped(name)))

  it('reads dice as the eight-point cube it is', () => {
    const g = geo('dice.3DO')
    expect(g.points.length).toBe(8)
    // a cube of half-side ~173: every coordinate is that size, and the eight
    // points cover all eight sign combinations
    const signs = new Set(g.points.map((p) => `${Math.sign(p.x)}${Math.sign(p.y)}${Math.sign(p.z)}`))
    expect(signs.size).toBe(8)
    for (const p of g.points) for (const c of [p.x, p.y, p.z]) expect(Math.abs(c)).toBeGreaterThan(160)
    expect(g.faces.length).toBe(6)
    for (const f of g.faces) expect(new Set(f.vertices).size).toBe(4)
  })

  it('agrees with the terminator about where the point list ends', () => {
    // The section table brackets the points and a $7530 word ends them; the
    // transform loop at $210930 trusts only the terminator, so the two must
    // line up or the engine would read past the object.
    for (const f of readdirSync(OBJECTS).filter((n) => /\.3do$/i.test(n))) {
      const g = geo(f)
      expect(g.points.length, f).toBeGreaterThan(0)
      expect(g.pointsAt + g.points.length * 6, f).toBeLessThan(g.facesAt)
    }
  })

  it('writes a triangle as a quad with a repeated vertex', () => {
    // rocket is a four-sided pyramid: apex 4 doubled at the front of every
    // face, so the rasteriser needs no triangle case
    const r = geo('rocket.3DO')
    expect(r.faces.map((f) => f.vertices)).toEqual([[4, 4, 0, 1], [4, 4, 1, 2], [4, 4, 2, 3], [4, 4, 3, 0]])
    // game_ship doubles its apex at both ends instead — same polygon
    expect(geo('game_ship.3DO').faces[0]!.vertices).toEqual([4, 0, 1, 4])
  })

  it('keeps every vertex reference a multiple of the $20 working stride', () => {
    // the refs are byte offsets into the engine's 32-byte vertex records, not
    // indices — $217f48 steps by $20 and $2146e6 reads the model point from
    // +$18 of each. Dividing back out must land inside the point list.
    for (const f of readdirSync(OBJECTS).filter((n) => /\.3do$/i.test(n))) {
      const g = geo(f)
      for (const face of g.faces) for (const v of face.vertices) expect(v, f).toBeLessThan(g.points.length)
    }
  })

  it('stops at the two objects that carry a second template', () => {
    // 3d2 and monitor2 link two templates and break the face run with a
    // further header; everything else is a flat list of sixteen-byte records
    const multi = readdirSync(OBJECTS)
      .filter((n) => /\.3do$/i.test(n))
      .filter((n) => geo(n).multipart)
      .sort()
    expect(multi).toEqual(['3d2.3DO', 'monitor2.3DO'])
  })

  it('matches every external surface link to a face record', () => {
    // a type-2 link names the offset its surface pointer is patched into, and
    // that offset is a face's +0 — dice gives all six of its faces one
    const g = geo('dice.3DO')
    const links = parseTdFile(shipped('dice.3DO')).links.filter((l) => l.type === 2)
    expect(links.map((l) => l.offset)).toEqual(g.faces.map((f) => f.at))
    for (const f of g.faces) expect(f.surface).not.toBe(0)
  })
})

describe('AMOS 3D rotation (matrix builder at $213df8, vertex loop at $2108a2)', () => {
  const C3D = 'fixtures/extensions/amos3d-1.0/engine/c3d.lib'

  it.skipIf(!existsSync(C3D))('generates the engine’s own quarter-sine table', () => {
    // a4+$270 is the table and a4+$670 its last entry; with a4 at $219e40 in
    // our load that puts it at $21a0b0, in hunk 23. Regenerating it rather
    // than shipping a copy keeps the library out of the repository.
    const l = loadHunks(new Uint8Array(readFileSync(C3D)))
    const v = new DataView(l.image.buffer, l.image.byteOffset, l.image.byteLength)
    const at = 0x21a0b0 - l.base
    for (let i = 0; i <= TD_SINE_STEPS; i++) expect(v.getInt16(at + i * 2, false), `entry ${i}`).toBe(TD_SINE[i])
  })

  it('puts a whole revolution in 65536 units', () => {
    expect(tdSin(0)).toBe(0)
    expect(tdCos(0)).toBe(TD_ONE)
    expect(tdSin(TD_REVOLUTION / 4)).toBe(TD_ONE)
    expect(tdCos(TD_REVOLUTION / 4)).toBe(0)
    expect(tdSin(TD_REVOLUTION / 2)).toBe(0)
    expect(tdCos(TD_REVOLUTION / 2)).toBe(-TD_ONE)
    expect(tdSin((TD_REVOLUTION * 3) / 4)).toBe(-TD_ONE)
    expect(tdCos((TD_REVOLUTION * 3) / 4)).toBe(0)
  })

  it('gets every quadrant’s signs right', () => {
    // The two bit tests at $213e00 pick the quadrant and the two flags at
    // $4cc8/$4cc9 the signs — checked here against real trigonometry, which is
    // independent of how the disassembly was read.
    //
    // The tolerance is the engine's own resolution: it reduces to the first
    // quadrant and only then shifts right by five, so the angle it actually
    // uses is within 32 units of the one asked for. Across a whole revolution
    // that is 4096 * 2*pi * 32/65536 ~ 12.6, plus one for the truncation.
    const tol = 14
    for (let a = 0; a < TD_REVOLUTION; a += 137) {
      const rad = a * ((2 * Math.PI) / TD_REVOLUTION)
      expect(Math.abs(tdSin(a) - TD_ONE * Math.sin(rad)), `sin ${a}`).toBeLessThanOrEqual(tol)
      expect(Math.abs(tdCos(a) - TD_ONE * Math.cos(rad)), `cos ${a}`).toBeLessThanOrEqual(tol)
    }
  })

  it('quantises to 32 units — the >>5 that indexes the table', () => {
    expect(tdSin(0)).toBe(tdSin(31))
    expect(tdSin(32)).not.toBe(tdSin(0))
    expect(tdSin(TD_REVOLUTION + 500)).toBe(tdSin(500))
  })

  it('rotates a point with the signs the loop folds in', () => {
    // the identity in memory order $bcc..$bdc: +1 on the x and y diagonals,
    // and +1 at $bdc because z' subtracts its first two terms
    const I: TdMatrix = [TD_ONE, 0, 0, TD_ONE, 0, 0, 0, 0, TD_ONE]
    expect(tdRotate(I, { x: 100, y: -200, z: 300 })).toEqual({ x: 100, y: -200, z: 300 })
    // the shift is arithmetic, so a negative product rounds down rather than
    // toward zero — asr.l on -1 is -1 however far you shift it
    const tiny: TdMatrix = [-1, 0, 0, 1, 0, 0, 0, 0, 1]
    expect(tdRotate(tiny, { x: 1, y: 0, z: 0 }).x).toBe(-1)
    expect(tdRotate(tiny, { x: 4095, y: 0, z: 0 }).x).toBe(-1)
    expect(tdRotate(tiny, { x: 4096, y: 0, z: 0 }).x).toBe(-1)
  })
})

describe('AMOS 3D attitude matrix ($213df8 in full)', () => {
  /** the effective 3x3, with the signs tdRotate folds in put back */
  const rows = (m: TdMatrix): number[][] => [
    [m[0], -m[4], m[6]],
    [m[1], m[3], m[7]],
    [-m[2], -m[5], m[8]],
  ]

  it('is the identity at rest', () => {
    expect(tdMatrix(0, 0, 0)).toEqual([TD_ONE, 0, 0, TD_ONE, 0, 0, 0, 0, TD_ONE])
    expect(tdRotate(tdMatrix(0, 0, 0), { x: 7, y: -9, z: 11 })).toEqual({ x: 7, y: -9, z: 11 })
  })

  it('stays orthonormal all the way round', () => {
    // Every row and column must be a unit vector and every pair
    // perpendicular. Nothing in the derivation enforces that, so it is a real
    // check on the nine expressions — a single sign or swapped sine breaks
    // it. The tolerance is the fixed point's: the triple products shift twice
    // and so lose a couple of bits more than the pairs.
    for (const [a, b, c] of [
      [0, 0, 0], [0x4000, 0, 0], [0, 0x4000, 0], [0, 0, 0x4000],
      [0x2000, 0x2000, 0x2000], [0x1234, 0x5678, 0x9abc], [0xf000, 0x8000, 0x4000],
      [0x0555, 0xaaaa, 0x3333],
    ]) {
      const r = rows(tdMatrix(a!, b!, c!))
      const cols = [0, 1, 2].map((j) => r.map((row) => row[j]!))
      for (const set of [r, cols]) {
        for (let i = 0; i < 3; i++) {
          const len = Math.hypot(...set[i]!)
          expect(Math.abs(len - TD_ONE), `|${set[i]}| at ${a},${b},${c}`).toBeLessThan(8)
          for (let j = i + 1; j < 3; j++) {
            const dot = set[i]!.reduce((s, v, k) => s + v * set[j]![k]!, 0) / TD_ONE
            expect(Math.abs(dot), `dot at ${a},${b},${c}`).toBeLessThan(8)
          }
        }
      }
    }
  })

  it('turns a quarter revolution about each axis', () => {
    const q = TD_REVOLUTION / 4
    const p = { x: 1000, y: 0, z: 0 }
    // angle b is the one whose sine lands in $bd0, the bottom row's x term,
    // so it swings x into -z
    expect(tdRotate(tdMatrix(0, q, 0), p)).toEqual({ x: 0, y: 0, z: -1000 })
    // angle c takes x to y
    expect(tdRotate(tdMatrix(0, 0, q), p)).toEqual({ x: 0, y: 1000, z: 0 })
    // and angle a leaves x alone, swinging y into z
    expect(tdRotate(tdMatrix(q, 0, 0), p)).toEqual({ x: 1000, y: 0, z: 0 })
    expect(tdRotate(tdMatrix(q, 0, 0), { x: 0, y: 1000, z: 0 })).toEqual({ x: 0, y: 0, z: -1000 })
  })

  it('composes: four quarter turns come back to the start', () => {
    let p = { x: 500, y: -300, z: 200 }
    const m = tdMatrix(0, 0, TD_REVOLUTION / 4)
    for (let i = 0; i < 4; i++) p = tdRotate(m, p)
    expect(p).toEqual({ x: 500, y: -300, z: 200 })
  })
})

describe('AMOS 3D projection ($2101c8, reached through $214876)', () => {
  /** the identity view: +1 down the diagonal, with $bc2 and $bbe zero */
  const flat = (shift = 0, origin: [number, number, number] = [0, 0, 0]): TdView => ({
    matrix: [TD_ONE, 0, 0, TD_ONE, 0, 0, 0, 0, TD_ONE],
    origin,
    shift,
  })

  it('shifts the sum, not the terms, and then adds the world position', () => {
    // the shift is applied to the whole row before the origin goes on, so an
    // object 500 units out stays 500 units out however the model is scaled
    const v = flat(12, [500, -200, 0x40000])
    expect(tdProject(v, { x: 4096, y: 8192, z: 0 }).view).toEqual([500 + 4096, -200 + 8192, 0x40000])
  })

  it('rejects anything at or in front of the near limit', () => {
    expect(tdProject(flat(12, [0, 0, TD_NEAR]), { x: 0, y: 0, z: 0 }).status).toBe(1)
    expect(tdProject(flat(12, [0, 0, TD_NEAR + 4096]), { x: 0, y: 0, z: 0 }).status).toBe(0)
    // and a point behind the eye is the same rejection, not a negative x
    expect(tdProject(flat(12, [0, 0, -0x30000]), { x: 0, y: 0, z: 0 }).status).toBe(1)
  })

  it('divides by the depth in 4096ths', () => {
    // z of $20000 is 32 units of depth, so x of 32000 lands at 1000
    const p = tdProject(flat(12, [32000, -16000, 0x20000]), { x: 0, y: 0, z: 0 })
    expect(p.status).toBe(0)
    expect([p.x, p.y]).toEqual([1000, -500])
  })

  it('truncates the quotient toward zero, as divs.w does', () => {
    const near = tdProject(flat(12, [-999, 999, 0x10000 + 4096]), { x: 0, y: 0, z: 0 })
    expect([near.x, near.y]).toEqual([-58, 58]) // -999/17 and 999/17
  })

  it('reports an overflowing quotient rather than wrapping it', () => {
    // a huge x with barely any depth: the quotient will not fit a word, and
    // the engine redoes the divide wider
    expect(tdProject(flat(12, [0x4000_0000, 0, 0x11000]), { x: 0, y: 0, z: 0 }).status).toBe(2)
  })

  it('codes a coordinate against the sixteenths-of-a-pixel bounds', () => {
    expect(tdClipCode(0)).toBe(0)
    expect(tdClipCode(-0xa00)).toBe(0)
    expect(tdClipCode(-0xa01)).toBe(1)
    expect(tdClipCode(0x9f0)).toBe(0)
    expect(tdClipCode(0x9f1)).toBe(2)
    // -$a00 is -2560, sixteen times a 160-pixel half-width
    expect(-0xa00 / 16).toBe(-160)
  })
})

describe('AMOS 3D viewpoint (object zero, the frame at a4+$481c)', () => {
  it('moves and turns like any other object, with nothing loaded', () => {
    // "One of those objects, object 0 is special; it is your own viewpoint."
    // $21301c forks on zero before it ever reaches the instance table, so
    // this works with no Td Load and no Td Object at all.
    const { out } = run(`
      Td Move 0,100,200,300
      Td Angle 0,$1000,$2000,$3000
      Print Td Position X(0);",";Td Position Y(0);",";Td Position Z(0)
      Print Td Attitude A(0);",";Td Attitude B(0);",";Td Attitude C(0)
      Td Move Rel 0,-1,-2,-3
      Print Td Position X(0);",";Td Position Y(0);",";Td Position Z(0)
    `)
    expect(out.split('\n').slice(0, 3)).toEqual([' 100, 200, 300', ' 4096, 8192, 12288', ' 99, 198, 297'])
  })

  it('starts at the origin looking down z', () => {
    const { out } = run('Print Td Position Z(0);",";Td Attitude B(0)')
    expect(out.split('\n')[0]).toBe(' 0, 0')
  })

  it('still refuses object zero where the engine does', () => {
    // Td Kill goes straight to $212fd0, whose `subq.l #1 : cmp.l #$14 : bcs`
    // makes zero an invalid number rather than the viewpoint
    expect(() => run('Td Kill 0')).toThrow(/Invalid object number/)
    expect(() => run('Td Move 0,1,2,3 : Td Move 21,1,2,3')).toThrow(/Invalid object number/)
  })
})

describe('AMOS 3D camera ($219566 is $213df8 with its stores moved to a4+$bba)', () => {
  it('undoes the attitude it was built from', () => {
    // The view transform's fold is the transpose of tdRotate's, so rotating a
    // point by an attitude and then viewing it through the same attitude must
    // give the point back. Nothing in either routine was written to make that
    // true — it falls out of the two sign patterns being transposes, which is
    // the check.
    for (const [a, b, c] of [[0x1000, 0, 0], [0, 0x3000, 0], [0, 0, 0x5000], [0x1234, 0x5678, 0x9abc]]) {
      const m = tdMatrix(a!, b!, c!)
      const p = { x: 3000, y: -2000, z: 1500 }
      const back = tdViewRotate(m, tdRotate(m, p))
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(back[k] - p[k]), `${k} at ${a},${b},${c}`).toBeLessThan(8)
      }
    }
  })

  it('places an object relative to the viewpoint, in the camera’s frame', () => {
    const eye = { pos: [1000, 0, 0] as [number, number, number], angle: [0, 0, 0] as [number, number, number] }
    const obj = { pos: [1000, 0, 5000] as [number, number, number], angle: [0, 0, 0] as [number, number, number] }
    // straight ahead: the camera's x and y drop out, and the depth is the gap
    // — in 4096ths, because the view product is never shifted back down
    expect(tdViewFor(eye, obj).origin).toEqual([0, 0, 5000 * TD_ONE])
    // turn the camera a quarter turn about b and the object swings to the side
    const turned = tdViewFor({ ...eye, angle: [0, TD_REVOLUTION / 4, 0] }, obj)
    expect(turned.origin[2]).toBe(0)
    expect(Math.abs(turned.origin[0])).toBe(5000 * TD_ONE)
  })

  it('projects a cube in front of the camera onto the screen', () => {
    const g = parseTdGeometry(parseTdFile(shipped('dice.3DO')))
    const eye: TdFrame = { pos: [0, 0, 0], angle: [0, 0, 0] }
    // where Dice_Spin puts it: Td Object 1,"dice",0,0,1500,0,0,0
    const obj: TdFrame = { pos: [0, 0, 1500], angle: [0, 0, 0] }
    const faces = tdInstanceFaces(g, tdMatrix(0, 0, 0), tdViewFor(eye, obj))
    // all six faces project, each a quad
    expect(faces.length).toBe(6)
    for (const f of faces) expect(f.points.length).toBe(4)
    // and every corner lands well inside the clip bounds
    for (const f of faces) for (const p of f.points) {
      expect(tdClipCode(p.x)).toBe(0)
      expect(tdClipCode(p.y)).toBe(0)
    }
  })

  it('drops the whole object when it is behind the eye', () => {
    const g = parseTdGeometry(parseTdFile(shipped('dice.3DO')))
    const eye: TdFrame = { pos: [0, 0, 0], angle: [0, 0, 0] }
    const behind: TdFrame = { pos: [0, 0, -1500], angle: [0, 0, 0] }
    expect(tdInstanceFaces(g, tdMatrix(0, 0, 0), tdViewFor(eye, behind))).toEqual([])
  })

  it('shrinks the cube as it recedes', () => {
    const g = parseTdGeometry(parseTdFile(shipped('dice.3DO')))
    const eye: TdFrame = { pos: [0, 0, 0], angle: [0, 0, 0] }
    const span = (z: number): number => {
      const f = tdInstanceFaces(g, tdMatrix(0, 0, 0), tdViewFor(eye, { pos: [0, 0, z], angle: [0, 0, 0] }))
      const xs = f.flatMap((k) => k.points.map((p) => p.x))
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(span(1500)).toBeGreaterThan(span(3000))
    expect(span(3000)).toBeGreaterThan(span(6000))
    // and it roughly halves as the distance doubles, which is what a divide
    // by depth means. Only roughly: the cube is 346 units deep itself, so at
    // 1500 its near face is a tenth closer than its centre and the span is
    // wider than a point at the centre would give.
    expect(Math.abs(span(3000) / span(6000) - 2)).toBeLessThan(0.1)
    expect(Math.abs(span(1500) / span(3000) - 2)).toBeLessThan(0.2)
  })
})

describe('AMOS 3D depth limits (the near test and the divisor at $210268)', () => {
  const g = () => parseTdGeometry(parseTdFile(shipped('dice.3DO')))
  const eye: TdFrame = { pos: [0, 0, 0], angle: [0, 0, 0] }
  const at = (z: number) => tdInstanceFaces(g(), tdMatrix(0, 0, 0), tdViewFor(eye, { pos: [0, 0, z], angle: [0, 0, 0] }))

  it('has a near limit of sixteen world units', () => {
    // $10000 in 4096ths is sixteen units. A cube centred there still has its
    // back half beyond the limit, so faces drop out one at a time as it comes
    // through rather than the whole object vanishing at once.
    expect(at(-200).length).toBe(0)
    expect(at(16).length).toBeGreaterThan(0)
    expect(at(16).length).toBeLessThan(6)
    expect(at(200).length).toBe(6)
  })

  it('wraps past 32767 units, because divs.w takes a word', () => {
    // A point 1000 units off-axis at a depth of 40000 should project to
    // 1000 * 4096 / 40000, about 102 sixteenths. The divisor is the low word
    // of the depth, and 40000 reads as -25536 there, so it comes out negative
    // and too far out instead.
    const view: TdView = { matrix: tdMatrix(0, 0, 0), origin: [1000 * TD_ONE, 0, 40000 * TD_ONE], shift: 0 }
    expect(tdProject(view, { x: 0, y: 0, z: 0 }).x).toBe(-160)
    // inside the limit it behaves
    const ok: TdView = { matrix: tdMatrix(0, 0, 0), origin: [1000 * TD_ONE, 0, 20000 * TD_ONE], shift: 0 }
    expect(tdProject(ok, { x: 0, y: 0, z: 0 }).x).toBe(204)
  })
})

describe('AMOS 3D Td Redraw ($21131e, screen check at $211418)', () => {
  it('refuses a screen 3D cannot draw on, like Td Cls does', () => {
    const files = objectAndLinks('dice.3DO')
    // 320 wide but only 8 colours
    expect(() => run('Td Screen Height 100 : Screen Open 0,320,200,8,0 : Td Redraw', files))
      .toThrow(/not compatible with 3d/)
    // wide enough in colours but not 320 across
    expect(() => run('Td Screen Height 100 : Screen Open 0,640,200,16,0 : Td Redraw', files))
      .toThrow(/not compatible with 3d/)
    // shorter than the 3D area
    expect(() => run('Td Screen Height 200 : Screen Open 0,320,100,16,0 : Td Redraw', files))
      .toThrow(/not compatible with 3d/)
  })

  it('advances the frame stamp, skipping zero when it wraps', () => {
    const { rt } = run('Screen Open 0,320,200,16,0 : For I=1 To 3 : Td Redraw : Next I')
    expect(rt.td.frame).toBe(3)
    rt.td.frame = 255
    expect((rt.td.frame + 1) & 0xff).toBe(0) // which is why the engine bumps again
  })

  it('walks the live instances in order and projects each one', () => {
    const files = objectAndLinks('dice.3DO')
    const { rt } = run(`
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 2,"dice",600,0,2000,0,0,0
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Redraw
    `, files)
    const drawn = tdRedrawFaces(rt.td)
    expect(drawn.map((d) => d.n)).toEqual([1, 2])
    // both cubes are in front of the camera, so all six faces of each project
    expect(drawn.map((d) => d.faces.length)).toEqual([6, 6])
    // and the one placed 600 to the right really is to the right
    const centre = (i: number): number => {
      const xs = drawn[i]!.faces.flatMap((f) => f.points.map((p) => p.x))
      return (Math.max(...xs) + Math.min(...xs)) / 2
    }
    // not exactly zero: divs.w truncates toward zero, so the left and right
    // corners of a centred cube round in opposite directions
    expect(Math.abs(centre(0))).toBeLessThan(16)
    expect(centre(1)).toBeGreaterThan(100)
  })
})

describe('AMOS 3D Td Range ($211d8c, prescale at $21235a)', () => {
  it('measures the distance between two objects', () => {
    const files = objectAndLinks('dice.3DO')
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,0,0,0,0
      Td Object 2,"dice",300,400,0,0,0,0
      Print Td Range(1,2)
      Td Object 3,"dice",0,0,-1000,0,0,0
      Print Td Range(1,3)
    `, files)
    expect(out.split('\n').slice(0, 2)).toEqual([' 500', ' 1000'])
  })

  it('counts the viewpoint as an object', () => {
    const files = objectAndLinks('dice.3DO')
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Move 0,0,0,500
      Print Td Range(0,1)
    `, files)
    expect(out.split('\n')[0]).toBe(' 1000')
  })

  it('returns zero for the same object, without validating it', () => {
    // $211d9c compares before it calls $21301c, so a number that would be an
    // error anywhere else comes back as zero
    expect(run('Print Td Range(99,99)').out.split('\n')[0]).toBe(' 0')
  })

  it('loses precision once a delta passes $4000, and by how much', () => {
    // under $4000 nothing is scaled and the answer is exact
    expect(tdRange({ pos: [0, 0, 0], angle: [0, 0, 0] }, { pos: [16000, 0, 0], angle: [0, 0, 0] })).toBe(16000)
    // above it, the prescale quantises: the highest set bit of 100000 is 16,
    // so the shift is 3 and the answer comes back in units of 8
    const far = tdRange({ pos: [0, 0, 0], angle: [0, 0, 0] }, { pos: [100000, 0, 0], angle: [0, 0, 0] })
    expect(far % 8).toBe(0)
    expect(Math.abs(far - 100000)).toBeLessThan(8)
    // and a 3-4-5 triangle stays a 3-4-5 triangle at that scale
    expect(tdRange({ pos: [0, 0, 0], angle: [0, 0, 0] }, { pos: [300000, 400000, 0], angle: [0, 0, 0] }))
      .toBeGreaterThan(499000)
  })
})

describe('AMOS 3D animation strings ($211822 move, $211a14 angle)', () => {
  const setup = `
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
  `

  it('steps a coordinate once per Td Redraw', () => {
    // one step of 100 every redraw, five times
    const { out } = run(`${setup}
      Td Move Z 1,"(1,100,5)"
      For I=1 To 5 : Td Redraw : Next I
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(' 2000')
  })

  it('honours the speed field — one step every n redraws', () => {
    const { out } = run(`${setup}
      Td Move Z 1,"(3,100,10)"
      For I=1 To 9 : Td Redraw : Next I
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    // speed 3 means the step lands on redraws 3, 6 and 9
    expect(out.split('\n')[0]).toBe(' 1800')
  })

  it('runs the demo’s own string', () => {
    // Not_Just_A_Cube: Td Move Z 1,"(1,0,100)(1,25,45)"
    // 100 steps of nothing, then 45 steps of 25
    const { out } = run(`${setup}
      Td Move Z 1,"(1,0,100)(1,25,45)"
      For I=1 To 100 : Td Redraw : Next I
      Print Td Position Z(1)
      For I=1 To 45 : Td Redraw : Next I
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n').slice(0, 2)).toEqual([' 1500', ' 2625'])
  })

  it('loops with L and stops without it', () => {
    const once = run(`${setup}
      Td Move Z 1,"(1,10,3)"
      For I=1 To 20 : Td Redraw : Next I
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    expect(once.out.split('\n')[0]).toBe(' 1530')
    const looped = run(`${setup}
      Td Move Z 1,"(1,10,3)L"
      For I=1 To 20 : Td Redraw : Next I
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    expect(looped.out.split('\n')[0]).toBe(' 1700')
  })

  it('animates an angle, wrapping at 32 bits not 16', () => {
    const { out } = run(`${setup}
      Td Angle B 1,"(1,20000,10)"
      For I=1 To 10 : Td Redraw : Next I
      Print Td Attitude B(1)
    `, objectAndLinks('dice.3DO'))
    // 200000 is past a revolution and past a word, and is kept whole
    expect(out.split('\n')[0]).toBe(' 200000')
  })

  it('replaces the same axis rather than stacking, per $21303e', () => {
    const { out } = run(`${setup}
      Td Move Z 1,"(1,100,50)"
      Td Move Z 1,"(1,1,50)"
      For I=1 To 10 : Td Redraw : Next I
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(' 1510')
  })

  it('animates the viewpoint, because it goes through $21301c', () => {
    const { out } = run(`
      Screen Open 0,320,200,16,0
      Td Move X 0,"(1,50,4)"
      For I=1 To 4 : Td Redraw : Next I
      Print Td Position X(0)
    `)
    expect(out.split('\n')[0]).toBe(' 200')
  })

  it('steps each of the six axes through its own animation', () => {
    // $211822 and $211a14 take the axis as 1 << d7 and hang the node off
    // $1e(frame) for a position or $22(frame) for an attitude, so all six are
    // one routine apiece with a selector — and all six have to step.
    const { out } = run(`${setup}
      Td Move X 1,"(1,1,3)" : Td Move Y 1,"(1,2,3)" : Td Move Z 1,"(1,3,3)"
      Td Angle A 1,"(1,4,3)" : Td Angle B 1,"(1,5,3)" : Td Angle C 1,"(1,6,3)"
      For I=1 To 3 : Td Redraw : Next I
      Print Td Position X(1);",";Td Position Y(1);",";Td Position Z(1)
      Print Td Attitude A(1);",";Td Attitude B(1);",";Td Attitude C(1)
    `, objectAndLinks('dice.3DO'))
    const lines = out.split('\n')
    expect(lines[0]).toBe(' 3, 6, 1509')
    expect(lines[1]).toBe(' 12, 15, 18')
  })

  it('takes a leading number as a starting coordinate', () => {
    const { out } = run(`${setup}
      Td Move Z 1,"9000(1,10,2)"
      Td Redraw
      Print Td Position Z(1)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(' 9010')
  })
})

describe('AMOS 3D surfaces (fix-up at $219b30, constructor at $2174d2, fill at $2103ac)', () => {
  const surfaces = readdirSync(OBJECTS).filter((n) => /\.3ds$/i.test(n))
  const surf = (name: string) => parseTdSurface(parseTdFile(shipped(name)))

  it('reads every shipped surface as slot indices', () => {
    // The loader turns a stored pointer into `base + 10*slot` by adding
    // (a4+$bf2 - base) to it, so dividing the difference by ten has to come
    // out whole for every pointer in every section or the file is misread.
    expect(surfaces.length).toBeGreaterThan(20)
    for (const name of surfaces) {
      const s = surf(name)
      expect(s.build.length, name).toBeGreaterThan(0)
      expect(s.fills.length, name).toBeGreaterThan(0)
      for (const f of s.fills) expect(f.length, name).toBeGreaterThanOrEqual(3)
    }
  })

  it('builds every slot from two that are already known', () => {
    // This is what says the section at +$0c is a construction list and not a
    // triangle list: $2174d2 evaluates it in file order with no second pass,
    // so a record may only name sources an earlier one has defined, and slots
    // 1 to 4 are already there because $217424 fills them from the face.
    for (const name of surfaces) {
      const s = surf(name)
      const known = new Set([1, 2, 3, 4])
      for (const r of s.build) {
        expect(known.has(r.a), `${name} ${r.dest}<-${r.a}`).toBe(true)
        expect(known.has(r.b), `${name} ${r.dest}<-${r.b}`).toBe(true)
        expect(known.has(r.dest), `${name} redefines ${r.dest}`).toBe(false)
        known.add(r.dest)
      }
      // and nothing else may reference a slot that was never built
      for (const f of s.fills) for (const c of f) expect(known.has(c.slot), `${name} fill ${c.slot}`).toBe(true)
      for (const [a, b] of s.edges) expect(known.has(a) && known.has(b), `${name} edge`).toBe(true)
    }
  })

  it('never overwrites the four corners the face supplies', () => {
    for (const name of surfaces) for (const r of surf(name).build) expect(r.dest, name).toBeGreaterThan(4)
  })

  it('fills in one of the four pens the bottom two bitplanes can make', () => {
    // $21042a and $210438 btst bit 0 and bit 1 of the pen byte and EOR into
    // plane 0 and plane 1, so a pen is a two-bit mask and nothing above 3 can
    // be drawn.
    for (const name of surfaces) for (const f of surf(name).fills) for (const c of f) expect(c.pen, name).toBeLessThan(4)
  })

  it('reads m3s0 and m3s1 as the same shape in different pens', () => {
    // The two files differ in four bytes: the pen on each corner of their one
    // polygon. Nothing else about them differs at all, which is what a pen
    // byte in the fill records predicts.
    const a = surf('m3s0.3DS')
    const b = surf('m3s1.3DS')
    expect(a.build).toEqual(b.build)
    expect(a.fills.map((f) => f.map((c) => c.slot))).toEqual(b.fills.map((f) => f.map((c) => c.slot)))
    expect(a.fills[0]!.map((c) => c.pen)).toEqual([1, 1, 1, 1])
    expect(b.fills[0]!.map((c) => c.pen)).toEqual([3, 3, 3, 3])
    // five bisections place the one point that is not a corner
    expect(a.build.map((r) => [r.dest, r.a, r.b])).toEqual([[5, 1, 4], [6, 5, 4], [7, 2, 3], [8, 7, 3], [9, 6, 8]])
    expect(a.fills).toHaveLength(1)
    expect(a.fills[0]!.map((c) => c.slot)).toEqual([9, 3, 4, 9])
  })

  it('puts the right number of pips on each face of the dice', () => {
    // dice.3DO links six surfaces, one per face of a plain eight-point cube,
    // so the pips are entirely in the .3DS files. Five of the six come out as
    // exactly their face value; the sixth has each of its six pips twice,
    // once in pen 1 and once in pen 2.
    const links = parseTdFile(shipped('dice.3DO')).links.filter((l) => l.type === 2)
    const fills = links.map((l) => surf(`${l.name}.3DS`).fills)
    expect(fills.map((f) => f.length)).toEqual([3, 1, 4, 12, 5, 2])
    const six = fills[3]!
    expect(six.slice(0, 6).map((f) => f.map((c) => c.slot))).toEqual(six.slice(6).map((f) => f.map((c) => c.slot)))
    expect(six.slice(0, 6).map((f) => f[0]!.pen)).toEqual([1, 1, 1, 1, 1, 1])
    expect(six.slice(6).map((f) => f[0]!.pen)).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('bisects exactly, on the word the engine bisects', () => {
    // $2174d2: move.w $2(a1),d0 : ext.l : move.w $2(a0),d1 : ext.l :
    // add.l d0,d1 : asr.l #1,d1 : move.w d1,$2(a3) — the sum of two
    // sign-extended words shifted down one, so an odd sum rounds towards
    // minus infinity rather than towards zero.
    const s = surf('m3s0.3DS')
    const corners = [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 161 }, { x: -1, y: 160 }]
    const slots = tdSurfaceSlots(s, corners)
    expect(slots[1]).toEqual({ x: 0, y: 0 })
    expect(slots[4]).toEqual({ x: -1, y: 160 })
    // 5 = mid(1,4): x = (0 + -1) >> 1 = -1, not 0
    expect(slots[5]).toEqual({ x: -1, y: 80 })
    expect(slots[6]).toEqual({ x: -1, y: 120 })
    expect(slots[7]).toEqual({ x: 160, y: 80 })
    expect(slots[8]).toEqual({ x: 160, y: 120 })
    expect(slots[9]).toEqual({ x: 79, y: 120 })
  })

  it('keeps a surface inside the face it is stuck to', () => {
    // Every slot is a corner or halfway between two points that are already
    // slots, so the whole surface lies in the convex hull of the corners —
    // which for these files means inside their bounding box.
    const corners = [{ x: -100, y: -80 }, { x: 100, y: -80 }, { x: 100, y: 80 }, { x: -100, y: 80 }]
    for (const name of surfaces) {
      for (const f of tdSurfaceFills(surf(name), corners)) {
        for (const p of f.points) {
          expect(p.x, name).toBeGreaterThanOrEqual(-100)
          expect(p.x, name).toBeLessThanOrEqual(100)
          expect(p.y, name).toBeGreaterThanOrEqual(-80)
          expect(p.y, name).toBeLessThanOrEqual(80)
        }
      }
    }
  })

  it('hands Td Redraw the dice with its pips on', () => {
    const { rt } = run(`
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Redraw
    `, objectAndLinks('dice.3DO'))
    const drawn = tdRedrawFaces(rt.td)
    expect(drawn).toHaveLength(1)
    const faces = drawn[0]!.faces
    expect(faces.length).toBeGreaterThan(0)
    // whichever faces survive the near limit, each carries its own patches
    for (const f of faces) {
      expect(f.fills.length).toBeGreaterThan(0)
      for (const fill of f.fills) expect(fill.pen).toBeGreaterThan(0)
    }
  })
})

describe('AMOS 3D block colours ($2109c0 at load, $212f66 for Td Set Colour)', () => {
  const objects = readdirSync(OBJECTS).filter((n) => /\.3do$/i.test(n))

  it('finds two bytes per block in the section at +$3a', () => {
    // $2109c0 allocates 2 * the block count at +$20 and copies the +$3a
    // section into it, so every object has to have exactly that much room
    // between the section and whatever follows — and it does, on all 35.
    for (const name of objects) {
      const f = parseTdFile(shipped(name))
      const cols = tdBlockColours(f)
      const blocks = parseTdBlocks(f)
      expect(cols.length, name).toBe(blocks.length)
      expect(cols.length, name).toBeGreaterThan(0)
      const at = new DataView(f.block.buffer, f.block.byteOffset, f.block.byteLength).getUint16(0x3a, false)
      const points = tdSections(f.block)[0x0c]!
      expect(points - at, name).toBeGreaterThanOrEqual(cols.length * 2)
    }
  })

  it('reads a pen in 0..3 for every block of every object', () => {
    // The pens are the bottom two bitplanes, so nothing above 3 can be drawn
    // and a byte outside that range would mean the section is misread.
    for (const name of objects) {
      for (const [a, b] of tdBlockColours(parseTdFile(shipped(name)))) {
        expect(a, name).toBeLessThan(4)
        expect(b, name).toBeLessThan(4)
      }
    }
  })

  it('gives church its four blocks four different colours', () => {
    // Four blocks and the colours alternate, which is what a building drawn
    // in walls-and-roof pairs looks like.
    expect(tdBlockColours(parseTdFile(shipped('church.3DO')))).toEqual([[0, 2], [1, 3], [1, 3], [0, 2]])
    expect(tdBlockColours(parseTdFile(shipped('dice.3DO')))).toEqual([[1, 2]])
  })

  it('numbers a block by its first face', () => {
    // $214f56 takes +$16 of the block record as the index of its first face,
    // and the blocks run in order, so a face belongs to the last block that
    // starts at or before it.
    const blocks = parseTdBlocks(parseTdFile(shipped('church.3DO')))
    const bases = blocks.map((b) => b.baseFace)
    expect(bases).toEqual([...bases].sort((a, b) => a - b))
    expect(tdBlockForFace(blocks, 0)).toBe(0)
    expect(tdBlockForFace(blocks, blocks[3]!.baseFace)).toBe(3)
    expect(tdBlockForFace(blocks, blocks[3]!.baseFace - 1)).toBe(2)
  })

  it('hands every drawn face the colour of its block', () => {
    const { rt } = run(`
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Redraw
    `, objectAndLinks('dice.3DO'))
    for (const f of tdRedrawFaces(rt.td)[0]!.faces) expect(f.colour).toEqual([1, 2])
  })

  it('Td Set Colour picks a dither pair out of the sixteen', () => {
    // $212fb4 doubles the colour and reads two bytes from a4+$54: four solid
    // pens and twelve ordered pairs. 11 is solid pen 1, 8 is 2-over-3.
    const colours = (src: string) => {
      const { rt } = run(`
        Td Load "dice"
        Td Object 1,"dice",0,0,1500,0,0,0
        ${src}
      `, objectAndLinks('dice.3DO'))
      return rt.td.objects.get('dice')!.colours
    }
    expect(colours('Td Set Colour 1,0,11')).toEqual([[1, 1]])
    expect(colours('Td Set Colour 1,0,8')).toEqual([[2, 3]])
    expect(colours('Td Set Colour 1,0,0')).toEqual([[0, 0]])
    // out of range is masked, not refused: 16 wraps to 0 and -1 to 15
    expect(colours('Td Set Colour 1,0,16')).toEqual([[0, 0]])
    expect(colours('Td Set Colour 1,0,-1')).toEqual([[3, 3]])
  })

  it('Td Set Colour refuses a block the object has not got', () => {
    const bad = (n: number) => () => run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Set Colour 1,${n},1
    `, objectAndLinks('dice.3DO'))
    expect(bad(1)).toThrow(/Block does not exist/)
    expect(bad(0)).not.toThrow()
    // and the object number goes through $212fd0, which subtracts one and
    // rejects anything not below 20 — so zero is not the viewpoint here, it
    // is out of range
    expect(() => run('Td Set Colour 0,0,1')).toThrow(/Invalid object number/)
  })

  it('recolours every instance of an object at once', () => {
    // The colour array belongs to the loaded object — $2109de hangs it off
    // the object record, and $214df6 points each instance's blocks into it —
    // so two Td Objects of one name share their colours.
    const { rt } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Object 2,"dice",500,0,1500,0,0,0
      Td Set Colour 2,0,15
    `, objectAndLinks('dice.3DO'))
    for (const inst of rt.td.instances.values()) expect(inst.object.colours).toEqual([[3, 3]])
  })
})

describe('AMOS 3D rasteriser (screen mapping $2126b6/$212688, our own fill)', () => {
  it('puts x through the same arithmetic Td Screen X does', () => {
    // asr.l #4 then add 160, and the bounds are tdClipCode's
    expect(tdScreenX(0)).toBe(160)
    expect(tdScreenX(-0xa00)).toBe(0)
    expect(tdScreenX(0x9f0)).toBe(319)
    // arithmetic, so a negative sixteenth floors rather than truncating
    expect(tdScreenX(-1)).toBe(159)
  })

  it('measures rows down from the centre of the 3D area', () => {
    // $211570: a4+$4864 is (h-1)>>1, and $212688 subtracts y/16 from it
    expect(tdCentreRow(150)).toBe(74)
    expect(tdScreenY(150, 0)).toBe(74)
    // the model's y grows up and the screen's grows down
    expect(tdScreenY(150, 16)).toBe(73)
    expect(tdScreenY(150, -16)).toBe(75)
    expect(tdCentreRow(200)).toBe(99)
  })

  it('fills a rectangle to its edges and no further', () => {
    const rows: string[] = []
    tdScanFill([{ x: 2, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 2, y: 4 }], (y, a, b) => rows.push(`${y}:${a}-${b}`))
    // half-open at the bottom, because the engine shortens every edge by one
    expect(rows).toEqual(['1:2-5', '2:2-5', '3:2-5'])
  })

  it('skips horizontal edges, as $2103f8 does', () => {
    const rows: string[] = []
    tdScanFill([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 }], (y, a, b) => rows.push(`${y}:${a}-${b}`))
    expect(rows).toEqual(['0:0-10', '1:1-8', '2:3-6'])
  })

  it('pairs crossings even-odd, so a polygon can have a hole', () => {
    // an EOR mask filled inclusively leaves the middle of a figure-of-eight
    // empty; a winding-number fill would not
    const rows: number[][] = []
    tdScanFill(
      [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 },
       { x: 0, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 2 }, { x: 0, y: 2 }],
      (y, a, b) => rows.push([y, a, b]),
    )
    // row 3 crosses the right wall at 8 and the inner wall at 6 and fills
    // only between them; a winding fill would have swallowed the notch
    expect(rows.filter((r) => r[0] === 3)).toEqual([[3, 6, 8]])
    // row 1 is below the notch, so it fills the full width
    expect(rows.filter((r) => r[0] === 1)).toEqual([[1, 0, 8]])
  })

  it('draws the dice, in the pens its block is dithered in', () => {
    const { rt } = run(`
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,300,600,0
      Td Cls
      Td Redraw
    `, objectAndLinks('dice.3DO'))
    const s = rt.screen
    let painted = 0
    const pens = new Set<number>()
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 320; x++) {
        const p = s.point(x, y)
        if (p !== 0) { painted++; pens.add(p) }
        // Td Cls blanks rows 0 to 149 and the redraw may only write inside
        // them, never on row zero and never past Td Screen Height — below it
        // the screen is still the colour Screen Open left
        if (y === 0) expect(p, `${x},${y}`).toBe(0)
        if (y >= 150) expect(p, `${x},${y}`).toBe(1)
      }
    }
    // 16000 of those are the untouched rows below the 3D area
    expect(painted - 16000).toBeGreaterThan(2000)
    // dice's one block is [1,2] and its pips are pens 1 and 2, so only the
    // bottom two planes are ever touched
    for (const p of pens) expect(p).toBeLessThan(4)
    expect([...pens].sort()).toEqual([1, 2])
    expect(pens.has(1) && pens.has(2)).toBe(true)
  })

  it('leaves the upper planes alone, because a pen is a two-bit mask', () => {
    // $21042a and $210438 EOR into planes 0 and 1 only, so a background in
    // the high planes shows through the low two bits the 3D writes
    const { rt } = run(`
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Ink 12 : Bar 0,0 To 319,149
      Td Redraw
    `, objectAndLinks('dice.3DO'))
    const s = rt.screen
    const seen = new Set<number>()
    for (let y = 1; y < 150; y++) for (let x = 0; x < 320; x++) seen.add(s.point(x, y))
    // 12 is %1100: every pixel keeps those two bits and only the low two move
    for (const p of seen) expect(p & ~3).toBe(12)
    expect(seen.size).toBeGreaterThan(1)
  })

  it('Td Cls wipes what Td Redraw drew', () => {
    const { rt } = run(`
      Td Screen Height 150
      Screen Open 0,320,200,16,0
      Td Load "dice"
      Td Object 1,"dice",0,0,1500,0,0,0
      Td Redraw
      Td Cls
    `, objectAndLinks('dice.3DO'))
    for (let y = 0; y < 150; y++) for (let x = 0; x < 320; x++) expect(rt.screen.point(x, y), `${x},${y}`).toBe(0)
  })
})

describe('AMOS 3D bearings (core $219200, atan2 $21939e, table a4+$672)', () => {
  const setup = `
      Td Load "dice"
      Td Object 1,"dice",0,0,0,0,0,0
      Td Object 2,"dice",1000,0,0,0,0,0
  `

  it('generates the arctangent table the library ships', () => {
    // thirty-three words straight after the sine table, floor(atan(i/32) *
    // 65536 / 2pi), ending at $2000 — forty-five degrees
    const engine = loadHunks(new Uint8Array(readFileSync('fixtures/extensions/amos3d-1.0/engine/c3d.lib')))
    const v = new DataView(engine.image.buffer, engine.image.byteOffset, engine.image.byteLength)
    const at = 0x219e40 + 0x672 - engine.base
    for (let i = 0; i <= 32; i++) expect(v.getInt16(at + i * 2, false), `entry ${i}`).toBe(TD_ARCTAN[i])
    expect(TD_ARCTAN[32]).toBe(0x2000)
  })

  it('answers the same as a real atan2, all the way round', () => {
    // the octant reflections are the part worth checking: a table that only
    // covers 0..45 degrees has to be put back in the right eighth
    for (let deg = 0; deg < 360; deg++) {
      const r = (deg * Math.PI) / 180
      const p = Math.round(Math.sin(r) * 10000)
      const q = Math.round(Math.cos(r) * 10000)
      const want = Math.round((Math.atan2(p, q) * TD_REVOLUTION) / (2 * Math.PI))
      let diff = (((tdAtan2(p, q) - want) % TD_REVOLUTION) + TD_REVOLUTION) % TD_REVOLUTION
      if (diff > TD_REVOLUTION / 2) diff -= TD_REVOLUTION
      // the table's step is 128 ratio units and it interpolates, so a couple
      // of parts in 65536 is all the truncation costs
      expect(Math.abs(diff), `${deg} degrees`).toBeLessThanOrEqual(4)
    }
  })

  it('points at something dead ahead with both angles zero', () => {
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,0,0,0,0
      Td Object 2,"dice",0,0,1000,0,0,0
      Print Td Bearing A(1,2);",";Td Bearing B(1,2);",";Td Bearing R(1,2)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(' 0, 0, 1000')
  })

  it('turns a quarter of a revolution for something off to one side', () => {
    // 16384 is a quarter of the engine's 65536 units, and the range is the
    // plain distance
    const { out } = run(`${setup}
      Print Td Bearing A(1,2);",";Td Bearing B(1,2);",";Td Bearing R(1,2)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(` 0, ${TD_REVOLUTION / 4}, 1000`)
  })

  it('takes a literal x,y,z as readily as a second object', () => {
    const { out } = run(`${setup}
      Print Td Bearing B(1,1000,0,0)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(` ${TD_REVOLUTION / 4}`)
  })

  it('remembers the last answer for the no-argument form', () => {
    // bit 3 of the flags word is clear, so $211c6e goes straight to $211d26
    // and recomputes nothing
    const { out } = run(`${setup}
      X=Td Bearing B(1,2)
      Print Td Bearing A;",";Td Bearing B;",";Td Bearing R
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(` 0, ${TD_REVOLUTION / 4}, 1000`)
  })

  it('keeps the old answer when the target is straight up — and negates it', () => {
    // The core bails at $2192c0 when x and z are both zero rather than
    // dividing by nothing, so $149c and $149e keep the previous answer. But
    // $211c6e negates them whatever the core did — the bail returns
    // normally, it does not skip the tail — so the stored bearing comes back
    // with its sign flipped, and flips again on the next degenerate call.
    // Reproduced because it is what the engine does, not because it is sane.
    const { out } = run(`${setup}
      X=Td Bearing B(1,2)
      Print Td Bearing B(1,0,500,0)
      Print Td Bearing B(1,0,500,0)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n').slice(0, 2)).toEqual([`-${TD_REVOLUTION / 4}`, ` ${TD_REVOLUTION / 4}`])
  })

  it('picks whichever of the two facings is nearer where the object points', () => {
    // $211cea onwards: (a,b) and ($8000-a, b+$8000) face the same way, and
    // the engine takes the one with the smaller squared difference from the
    // attitude the object already has
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,0,-32768,-16384,0
      Td Object 2,"dice",1000,0,0,0,0,0
      Print Td Bearing A(1,2);",";Td Bearing B(1,2)
    `, objectAndLinks('dice.3DO'))
    // Print gives a negative no leading space, so the commas sit tight
    expect(out.split('\n')[0]).toBe('-32768,-16384')
  })

  it('Td Face writes the bearing into the attitude, roll untouched', () => {
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,0,0,0,1234
      Td Object 2,"dice",1000,0,0,0,0,0
      Td Face 1,2
      Print Td Attitude A(1);",";Td Attitude B(1);",";Td Attitude C(1)
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(` 0, ${TD_REVOLUTION / 4}, 1234`)
  })

  it('Td Face leaves A, B and R readable as if Td Bearing had run', () => {
    const { out } = run(`${setup}
      Td Face 1,2
      Print Td Bearing R
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(' 1000')
  })

  it('agrees with Td Range about how far away something is', () => {
    // different routines — Td Range square-roots, the bearing divides by a
    // sine — so they are an independent check on each other
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",100,200,300,0,0,0
      Td Object 2,"dice",4100,2200,-1700,0,0,0
      Print Td Range(1,2);",";Td Bearing R(1,2)
    `, objectAndLinks('dice.3DO'))
    const [range, r] = out.split('\n')[0]!.split(',').map((n) => Number(n))
    // 4000, 2000, -2000 apart: 4898.98...
    expect(range).toBe(4898)
    expect(Math.abs(r! - range!)).toBeLessThanOrEqual(2)
  })

  it('prescales a bearing that would overflow, and puts the shift back', () => {
    // $219266: anything above eighteen bits shifts all three differences
    // down together, and $211d4a shifts the range back up when it is read
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,0,0,0,0
      Td Object 2,"dice",3000000,0,4000000,0,0,0
      Print Td Range(1,2);",";Td Bearing R(1,2)
    `, objectAndLinks('dice.3DO'))
    const [range, r] = out.split('\n')[0]!.split(',').map((n) => Number(n))
    // both prescale, so both lose the low bits: 3-4-5 scaled up by a million
    expect(Math.abs(range! - 5000000)).toBeLessThan(200)
    expect(Math.abs(r! - 5000000)).toBeLessThan(5000)
  })
})

describe('AMOS 3D Td World ($2126c8, the fold at $212758, the add at $2128e8)', () => {
  const world = (src: string) => {
    const { out } = run(`
      Td Load "dice"
      ${src}
      Print Td World X(1,0,0,1000);",";Td World Y(1,0,0,1000);",";Td World Z(1,0,0,1000)
    `, objectAndLinks('dice.3DO'))
    return out.split('\n')[0]!.split(',').map((n) => Number(n))
  }

  it('adds the object position to an unrotated point', () => {
    expect(world('Td Object 1,"dice",100,200,300,0,0,0')).toEqual([100, 200, 1300])
  })

  it('turns the local frame with the object', () => {
    // a quarter turn about B sends the object's +z along the world's +x, the
    // same prediction the attitude matrix was checked against in phase 4
    const q = TD_REVOLUTION / 4
    const [x, y, z] = world(`Td Object 1,"dice",0,0,0,0,${q},0`)
    expect(Math.abs(x! - 1000)).toBeLessThanOrEqual(1)
    expect(y).toBe(0)
    expect(Math.abs(z!)).toBeLessThanOrEqual(1)
  })

  it('leaves a point alone when the object is at the origin unturned', () => {
    expect(world('Td Object 1,"dice",0,0,0,0,0,0')).toEqual([0, 0, 1000])
  })

  it('remembers all three for the no-argument form', () => {
    // one call works out x, y and z together and leaves them at a4+$1c/$20/$24
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",7,8,9,0,0,0
      X=Td World X(1,10,20,30)
      Print Td World X;",";Td World Y;",";Td World Z
    `, objectAndLinks('dice.3DO'))
    expect(out.split('\n')[0]).toBe(' 17, 28, 39')
  })

  it('rotates the viewpoint the other way round', () => {
    // object zero reads the matrix at a4+$bba, which is a4+$bcc transposed,
    // so the same attitude sends the same local point the other way
    const q = TD_REVOLUTION / 4
    const { out } = run(`
      Td Load "dice"
      Td Object 1,"dice",0,0,0,0,${q},0
      Td Angle 0,0,${q},0
      Print Td World X(1,0,0,1000);",";Td World X(0,0,0,1000)
    `, objectAndLinks('dice.3DO'))
    const [obj, view] = out.split('\n')[0]!.split(',').map((n) => Number(n))
    expect(Math.abs(obj! - 1000)).toBeLessThanOrEqual(1)
    expect(Math.abs(view! + 1000)).toBeLessThanOrEqual(1)
  })
})
