import { describe, expect, it } from 'vitest'
import { AmigaFS, MemoryVolume, amigaPattern } from './vfs'
import { readTar, readZip, volumeFromEntries } from './archive'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

function makeFs(): AmigaFS {
  const fs = new AmigaFS()
  const dh0 = fs.mountMemory('DH0')
  dh0.write(['Games', 'Zybex', 'level1.iff'], enc('LEVEL1'))
  dh0.write(['Games', 'Zybex', 'Music', 'theme.abk'], enc('THEME'))
  dh0.write(['S', 'startup-sequence'], enc('SS'))
  fs.currentDir = 'DH0:'
  return fs
}

describe('Amiga path resolution', () => {
  it('resolves absolute, relative and case-insensitive paths', () => {
    const fs = makeFs()
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toEqual(enc('LEVEL1'))
    expect(fs.readFile('dh0:games/zybex/LEVEL1.IFF')).toEqual(enc('LEVEL1'))
    fs.setCurrentDir('DH0:Games/Zybex')
    expect(fs.readFile('level1.iff')).toEqual(enc('LEVEL1'))
    expect(fs.readFile('Music/theme.abk')).toEqual(enc('THEME'))
  })

  it('treats empty components as parent (AmigaDOS "/")', () => {
    const fs = makeFs()
    fs.setCurrentDir('DH0:Games/Zybex/Music')
    expect(fs.readFile('/level1.iff')).toEqual(enc('LEVEL1')) // parent
    expect(fs.readFile('//Zybex/level1.iff')).toEqual(enc('LEVEL1')) // up twice, down
    expect(fs.readFile(':S/startup-sequence')).toEqual(enc('SS')) // ":" = volume root
  })

  it('expands assigns recursively', () => {
    const fs = makeFs()
    fs.assign('Data:', 'DH0:Games/Zybex')
    fs.assign('Tunes:', 'Data:Music')
    expect(fs.readFile('Data:level1.iff')).toEqual(enc('LEVEL1'))
    expect(fs.readFile('TUNES:theme.abk')).toEqual(enc('THEME'))
  })

  it('writes shadow read-only volumes and deletes hide files', () => {
    const fs = makeFs()
    expect(fs.writeFile('DH0:Games/Zybex/level1.iff', enc('NEW'))).toBe(true)
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toEqual(enc('NEW'))
    expect(fs.deleteFile('DH0:Games/Zybex/level1.iff')).toBe(true)
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toBeNull()
    expect(fs.exists('DH0:Games/Zybex/level1.iff')).toBeNull()
  })

  it('lists directories merged across layers', () => {
    const fs = makeFs()
    fs.writeFile('DH0:Games/Zybex/hiscores.dat', enc('HI'))
    const names = fs.listDir('DH0:Games/Zybex')!.map((e) => e.name).sort()
    expect(names).toEqual(['Music', 'hiscores.dat', 'level1.iff'])
  })

  it('matches AmigaDOS patterns', () => {
    expect(amigaPattern('#?.IFF').test('picture.iff')).toBe(true)
    expect(amigaPattern('*.iff').test('a.IFF')).toBe(true)
    expect(amigaPattern('level?.iff').test('level1.iff')).toBe(true)
    expect(amigaPattern('*.abk').test('a.iff')).toBe(false)
  })
})

describe('archives', () => {
  it('reads ustar tarballs into a volume', () => {
    // build a minimal ustar entry by hand
    const header = new Uint8Array(512)
    const put = (off: number, text: string): void => {
      for (let i = 0; i < text.length; i++) header[off + i] = text.charCodeAt(i)
    }
    put(0, 'dir/hello.txt')
    put(124, '00000000005 ') // size 5 octal
    header[156] = 48 // '0' regular file
    const body = new Uint8Array(512)
    body.set(enc('HELLO'))
    const tar = new Uint8Array(1536)
    tar.set(header, 0)
    tar.set(body, 512)
    const entries = readTar(tar)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.path).toBe('dir/hello.txt')
    const vol = volumeFromEntries(entries)
    expect(vol.read(['dir', 'hello.txt'])).toEqual(enc('HELLO'))
  })

  it('reads stored zips', async () => {
    // minimal single-entry STORE zip built by hand
    const name = enc('a.txt')
    const data = enc('ZIPDATA')
    const local = new Uint8Array(30 + name.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, 0, true) // store
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, 0, true) // local offset
    central.set(name, 46)
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(10, 1, true)
    ev.setUint32(12, central.length, true)
    ev.setUint32(16, local.length, true)
    const zip = new Uint8Array(local.length + central.length + 22)
    zip.set(local, 0)
    zip.set(central, local.length)
    zip.set(eocd, local.length + central.length)
    const entries = await readZip(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.path).toBe('a.txt')
    expect(entries[0]!.data).toEqual(data)
  })
})

describe('file channels', () => {
  const table = new TokenTable(CORE_TOKENS)

  function run(src: string): { rt: Runtime; out: string; fs: AmigaFS } {
    const fs = makeFs()
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000, fs, onText: (t) => (out += t) })
    const r = rt.runHeadless(1_000)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { rt, out, fs }
  }

  it('round-trips Print # / Input # with CRLF and comma fields', () => {
    const prog = [
      'Open Out 1,"DH0:save.dat"',
      'Print #1,"SCORE";42',
      'Print #1,"A";",";"B"',
      'Close 1',
      'Open In 2,"DH0:save.dat"',
      'Line Input #2,L$',
      'Input #2,X$,Y$',
      'Close',
      'Print L$;"/";X$;"/";Y$',
    ].join('\n')
    const { out, fs } = run(prog)
    expect(out).toBe('SCORE 42/A/B\n') // Input # splits at literal commas
    const raw = fs.readFile('DH0:save.dat')!
    expect(String.fromCharCode(...raw)).toBe('SCORE 42\r\nA,B\r\n')
  })

  it('supports Eof/Lof/Pof and Input$(channel,n)', () => {
    const prog = [
      'Open Out 1,"DH0:d" : Print #1,"ABCDEF"; : Close 1',
      'Open In 1,"DH0:d"',
      'Print Lof(1);Eof(1)',
      'A$=Input$(1,3)',
      'Print A$;Pof(1)',
      'Pof(1)=1',
      'Print Input$(1,2)',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe(' 6 0\nABC 3\nBC\n')
  })

  it('appends, renames, kills, and iterates directories', () => {
    const prog = [
      'Open Out 1,"DH0:log" : Print #1,"ONE" : Close 1',
      'Append 1,"DH0:log" : Print #1,"TWO" : Close 1',
      'Rename "DH0:log" To "DH0:log2"',
      'Open In 1,"DH0:log2" : Line Input #1,A$ : Line Input #1,B$ : Close',
      'Print A$;B$',
      'F$=Dir First$("DH0:Games/Zybex/*.iff")',
      'Print F$',
      'Print Dir Next$',
      'Kill "DH0:log2"',
      'Print Exist("DH0:log2")',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe('ONETWO\nlevel1.iff\n\n 0\n')
  })

  it('changes directory via Dir$ and Assign', () => {
    const prog = [
      'Assign "Res:" To "DH0:Games/Zybex"',
      'Dir$="Res:"',
      'Open In 1,"level1.iff"',
      'Print Lof(1) : Close',
      'Print Dir$',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe(' 6\nDH0:Games/Zybex\n')
  })
})
