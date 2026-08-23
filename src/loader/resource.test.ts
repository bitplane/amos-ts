import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { parseAmosFile } from './amosfile'
import { isResourceBankName, parseResourceBank } from './resource'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')
const DEFAULT_ABK = join(FIXTURES, 'official-amos', 'APSystem', 'AMOSPro_Default_Resource.Abk')
const EXAMPLE_ABK = join(
  FIXTURES,
  'official-amos',
  'Tutorial',
  'Tutorials',
  'Interface',
  'Example_Resource.Abk',
)

function loadBank(path: string): ReturnType<typeof parseResourceBank> {
  const file = parseAmosFile(readFileSync(path))
  const bank = file.banks.find((b) => b.kind === 'memory' && isResourceBankName(b.name))
  if (!bank || bank.kind !== 'memory') throw new Error('no resource bank in file')
  return parseResourceBank(bank.data)
}

describe.skipIf(!existsSync(DEFAULT_ABK))('resource bank decoding', () => {
  it('decodes the system default resource bank (Dia_GetPuzzle layout)', () => {
    const res = loadBank(DEFAULT_ABK)
    // graphics: 93 packed images, all clean $06071963 bitmaps
    expect(res.graphics!.count).toBe(93)
    for (let n = 1; n <= res.graphics!.count; n++) {
      const img = res.graphics!.image(n)
      expect(img, `image ${n}`).not.toBeNull()
      expect(img!.width).toBeGreaterThan(0)
      expect(img!.height).toBeGreaterThan(0)
      expect(img!.screen).toBeNull() // bare bitmaps, no screen header
    }
    expect(res.graphics!.image(0)).toBeNull()
    expect(res.graphics!.image(94)).toBeNull()
    // screen parameters for Resource Screen Open (Dia_RScOpen +Lib.s:20995)
    expect(res.graphics!.nColors).toBe(8)
    expect(res.graphics!.mode & 0x8004).toBe(0x8000) // hires, not laced
    expect(res.graphics!.palette).toHaveLength(32)
    // messages: {pad,len,chars} records (Dia_FMess +Lib.s:23102)
    expect(res.messages!.length).toBeGreaterThan(10)
    for (const m of res.messages!) expect(m).toMatch(/^[\x20-\xff]*$/)
    // programs: word-length-prefixed ASCII dialog scripts
    expect(res.programs!.length).toBeGreaterThan(0)
    for (const p of res.programs!) {
      expect(p.length).toBeGreaterThan(0)
      // every script starts with a letter (a 2-letter mnemonic) or a run marker
      expect(p[0]).toMatch(/[A-Za-z[]/)
    }
  })

  it.skipIf(!existsSync(EXAMPLE_ABK))('decodes the tutorial example bank', () => {
    const res = loadBank(EXAMPLE_ABK)
    expect(res.graphics!.count).toBe(90)
    for (let n = 1; n <= 90; n++) expect(res.graphics!.image(n), `image ${n}`).not.toBeNull()
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('resource keywords', () => {
  const table = new TokenTable(CORE_TOKENS)

  function run(src: string): { rt: Runtime; out: string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000, onText: (t) => (out += t) })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    const r = rt.runHeadless(1_000)
    mustFinish(r)
    return { rt, out }
  }

  it('opens a resource screen with the bank palette and unpacks images', () => {
    const { rt } = run('Resource Screen Open 1,320,64,0\nResource Unpack 10,0,0')
    const s = rt.screens.get(1)!
    expect(s.nColors).toBe(8)
    expect(s.hires).toBe(true)
    expect(s.cursorOn).toBe(false) // flash 0 = cursor off (Dia_RScOpen .Cu0)
    expect([...s.palette.slice(0, 4)]).toEqual([0x000, 0x0f2, 0x077, 0xfff])
    let painted = 0
    for (let y = 0; y < 20; y++) for (let x = 0; x < 64; x++) if (s.point(x, y) !== 0) painted++
    expect(painted).toBeGreaterThan(0)
  })

  it('reads bank messages via Resource$ and errors on bad unpack indices', () => {
    const { out } = run('Print Resource$(1)\nPrint Resource$(0)')
    const lines = out.split('\n')
    expect(lines[0]!.length).toBeGreaterThan(0)
    expect(lines[1]).toBe('AMOSPro:')
    expect(() => run('Resource Unpack 999,0,0')).toThrow()
  })

  it('Resource$(-n) reads the interpreter-config messages (FnResource +ILib.s:6714, Txt1 block)', () => {
    const { out } = run(['Print Resource$(-13)', 'Print Resource$(-8)', 'Print Resource$(-15)', 'Print Resource$(-2000)'].join('\n'))
    const lines = out.split('\n')
    // message 13: the LatestNews path AMOSProHelp derives its help dir from
    expect(lines[0]).toBe('AMOSPro_Accessories:AMOSPro_Help/LatestNews')
    expect(lines[1]).toBe('AMOSPro_Default_Resource.Abk')
    expect(lines[2]).toBe('') // genuinely empty entry
    expect(lines[3]).toBe('') // editor tables aren't carried by the port
  })

  it('lets Resource Bank switch to a loaded user bank, falling back per section', () => {
    const bytes = readFileSync(EXAMPLE_ABK)
    const file = parseAmosFile(bytes)
    let out = ''
    const rt = new Runtime(tokenize('Resource Bank 16\nResource Unpack 1,0,0\nPrint Resource$(1)', table), table, {
      maxSteps: 200_000,
      banks: file.banks,
      onText: (t) => (out += t),
    })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    const r = rt.runHeadless(1_000)
    expect(r.status === 'ended' || r.status === 'stopped').toBe(true)
    // messages come from the default bank (example bank has no messages)
    expect(out.trim().length).toBeGreaterThan(0)
  })
})
