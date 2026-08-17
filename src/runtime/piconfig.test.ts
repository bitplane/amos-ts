import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PI_DEFAULTS, newPiConfig } from './piconfig.gen'

const SOURCE = join(__dirname, '..', '..', '..', 'AMOS-Professional-Official', '+Interpreter_Config.s')

describe('the interpreter config block (PI_*)', () => {
  it('carries the file selector and text reader defaults', () => {
    // +Interpreter_Config.s:85-105. These are the ones Fsel$ and Read Text
    // read directly, and the three toggles are what Fs_Close writes back.
    expect(PI_DEFAULTS.FsSort).toBe(1)
    expect(PI_DEFAULTS.FsSize).toBe(1)
    expect(PI_DEFAULTS.FsStore).toBe(1)
    expect([PI_DEFAULTS.FsDSx, PI_DEFAULTS.FsDSy]).toEqual([448, 158])
    expect([PI_DEFAULTS.FsDWx, PI_DEFAULTS.FsDWy]).toEqual([129 + 48, 50 + 20])
    expect(PI_DEFAULTS.FsDVApp).toBe(8)
    expect([PI_DEFAULTS.RtSx, PI_DEFAULTS.RtSy]).toEqual([640, 200])
    expect(PI_DEFAULTS.RtSpeed).toBe(8)
    expect([PI_DEFAULTS.DirSize, PI_DEFAULTS.DirMax]).toEqual([30, 128])
  })

  it('carries the three buffer sizes the source writes as products', () => {
    // `dc.l 1024*4`, `dc.w 42*6` and `dc.l 1024*32`. The generator's operand
    // used to stop at the '*' --- the same character the trailing comment
    // starts with --- and these three landed as 1024, 42 and 1024. Nothing
    // caught it: the offset walk counts a dc.l as four bytes whatever number
    // it holds, and no test read them.
    expect(PI_DEFAULTS.VNmMax).toBe(4096)
    expect(PI_DEFAULTS.TVDirect).toBe(252) // 42 direct-mode variables of 6 bytes
    expect(PI_DEFAULTS.DefSize).toBe(32768)
  })

  it('hands out an independent copy each time', () => {
    // the running interpreter edits its own block; the defaults must not move
    const a = newPiConfig()
    const b = newPiConfig()
    a.FsSort = 0
    a.DefEPa[0] = 0xfff
    expect(b.FsSort).toBe(1)
    expect(b.DefEPa[0]).toBe(0)
    expect(PI_DEFAULTS.FsSort).toBe(1)
    expect(PI_DEFAULTS.DefEPa[0]).toBe(0)
  })

  it.skipIf(!existsSync(SOURCE))('still agrees with +Interpreter_Config.s', () => {
    // re-read the source the generator was built from, so a regenerated file
    // that silently drifted (or a source update) fails here rather than
    // quietly changing the selector's shape
    const text = readFileSync(SOURCE, 'latin1')
    const stated = (name: string): number => {
      // the operand is the first token: the comment that follows it has no
      // consistent marker (`* 58- ...` on some lines, bare `40- ...` on others)
      const m = new RegExp(`^PI_${name}\\s+dc\\.[bwl]\\s+(\\S+)`, 'm').exec(text)
      if (!m) throw new Error(`PI_${name} not found in the source`)
      return m[1]!
        .split('+')
        .reduce((sum, term) => sum + term.split('*').reduce((p, f) => p * Number(f.trim()), 1), 0)
    }
    for (const name of ['FsSort', 'FsSize', 'FsStore', 'FsDSx', 'FsDSy', 'FsDWx', 'FsDWy', 'FsDVApp', 'RtSx', 'RtSy', 'RtSpeed', 'DirSize', 'DirMax', 'VNmMax', 'TVDirect', 'DefSize'] as const) {
      expect([name, PI_DEFAULTS[name]]).toEqual([name, stated(name)])
    }
  })
})
