import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { parseTdFile, tdSections } from './td'

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
    expect(files.length).toBe(110)
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

  it('p8.3DT is absent from this archive, so most demo objects cannot load', () => {
    // Not a defect in the port: thirty of the thirty-five objects on the demo
    // disc link to the template p8, and no p8.3DT exists anywhere in the
    // material — only an unbuilt p8.3DO under the Object Modeller. The engine
    // would say the same thing, and the manual warns of exactly this: "any
    // object which uses it will fail to load, either under OM or via Td Load".
    expect(() => run('Td Load "dice"', { 'dice.3DO': shipped('dice.3DO') })).toThrow(/Template file not found/)
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
    expect(() => run('Td Load "polygons"\nTd Screen Height 200', objectAndLinks('polygons.3DO'))).toThrow(
      /Can’t change screen size while objects exist/,
    )
  })

  it('Td Keep and Td Quit record what the manual says they do', () => {
    expect(run('Td Keep Off').rt.td.keep).toBe(false)
    expect(run('Td Keep Off\nTd Keep On').rt.td.keep).toBe(true)
    const { rt } = run('Td Load "polygons"\nTd Quit', objectAndLinks('polygons.3DO'))
    expect(rt.td.objects.size).toBe(0)
  })
})
