import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fsForFile } from './nodefs'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'

const table = new TokenTable(CORE_TOKENS)

describe('fsForFile', () => {
  it('mounts an empty writable RAM: like a real AMOS machine (the ram-handler)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amos-'))
    const prog = join(dir, 'p.amos')
    writeFileSync(prog, 'x')
    const fs = fsForFile(prog, join(dir, 'nope'))
    // RAM: resolves and starts empty, then a program can write and reread it
    expect(fs.listDir('RAM:')).toEqual([])
    let out = ''
    const src = [
      'Dir$="ram:"',
      'Open Out 1,"RAM:score.dat" : Print #1,"HI" : Close 1',
      'Open In 1,"RAM:score.dat" : Line Input #1,A$ : Close 1',
      'Print A$;" ";Dir$',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000, fs, onText: (t) => (out += t) })
    rt.runHeadless(1_000)
    expect(out).toBe('HI RAM:\n')
  })
})
