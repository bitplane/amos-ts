/**
 * LDos's device family — routines 31, 32, 33 and 39 of `AMOSPro_LDos.Lib`.
 *
 * One channel, not eight, and the answers run the opposite way round from the
 * core `Dev *` family: `Ldevice Open` gives OpenDevice's own result, so zero
 * is success.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { AdfVolume } from '../amiga/adf'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
const ldos = extensionById('ldos-2.6')!
const exts = new Map([[6, ldos.table]])

function disk(): Uint8Array {
  const b = new Uint8Array(901_120)
  const v = new DataView(b.buffer)
  b[0] = 0x44
  b[1] = 0x4f
  b[2] = 0x53
  v.setInt32(880 * 512 + 0, 2, false)
  v.setInt32(880 * 512 + 12, 72, false)
  v.setInt32(880 * 512 + 508, 1, false)
  b[880 * 512 + 432] = 4
  return b
}

function run(src: string, image?: Uint8Array): string {
  let out = ''
  const fs = new AmigaFS()
  if (image) fs.mount('DF0', new AdfVolume(image))
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[6, ldos]]),
    maxSteps: 500_000,
    fs,
    onText: (t) => (out += t),
  })
  mustFinish(rt.runHeadless(500))
  return out.trim()
}

describe('Ldevice Open', () => {
  it('answers ZERO for success, which is OpenDevice\'s own result', () => {
    expect(run('Print Ldevice Open("trackdisk.device",0,0)')).toBe('0')
  })

  it('and non-zero for a device nothing is behind', () => {
    expect(run('Print Ldevice Open("nosuch.device",0,0)')).toBe('-1')
  })

  it('a second open is error 9, in the library\'s own words', () => {
    expect(() =>
      run('A=Ldevice Open("trackdisk.device",0,0) : B=Ldevice Open("trackdisk.device",0,0)'),
    ).toThrow(/Device already open/)
  })

  it('and Ldevice Close makes room for another', () => {
    expect(
      run('A=Ldevice Open("trackdisk.device",0,0) : Ldevice Close : Print Ldevice Open("trackdisk.device",0,0)'),
    ).toBe('0')
  })

  it('closing when nothing is open is not an error', () => {
    // both halves of routine 32 are guarded by their own pointer
    expect(run('Ldevice Close : Print 1')).toBe('1')
  })
})

describe('=Ldevice and =Ldevice Error', () => {
  it('moves the bytes and answers io_Actual', () => {
    const img = disk()
    img[7 * 512] = 0x7f
    const out = run(
      [
        'Reserve As Work 10,600',
        'A=Ldevice Open("trackdisk.device",0,0)',
        'N=Ldevice(2,Start(10),512,7*512)',
        'Print N;" ";Peek(Start(10))',
      ].join('\n'),
      img,
    )
    expect(out.split(/\s+/).map(Number)).toEqual([512, 0x7f])
  })

  it('without a channel it is error 10', () => {
    expect(() => run('Print Ldevice(2,0,512,0)')).toThrow(/Device not open/)
  })

  it('Ldevice Error reads io_Error as an UNSIGNED byte', () => {
    // `moveq #$0,d3` then `move.b $1f(a1),d3`, so -1 comes back as 255. An
    // empty drive is TDERR_DiskChanged, 29
    const out = run(
      ['A=Ldevice Open("trackdisk.device",1,0)', 'N=Ldevice(2,0,512,0)', 'Print Ldevice Error'].join('\n'),
      disk(),
    )
    expect(Number(out)).toBe(29)
  })

  it('and answers zero with no channel rather than raising', () => {
    expect(run('Print Ldevice Error')).toBe('0')
  })
})
