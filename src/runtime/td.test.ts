import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { loadHunks } from '../loader/hunk'
import type { TdMatrix } from './td'
import { TD_ONE, TD_REVOLUTION, TD_SINE, TD_SINE_STEPS, parseTdFile, parseTdGeometry, parseTdTemplate, tdCos, tdRotate, tdSections, tdSin } from './td'

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
