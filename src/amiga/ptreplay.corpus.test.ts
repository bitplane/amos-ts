/** Binary pins for the ptreplay.library vectors used by The Game. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadHunks } from './hunk'
import { PTREPLAY_LIBRARY } from './ptreplay'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const path = join(root, 'fixtures', 'libs', 'ptreplay.library')
const present = existsSync(path)

function hunk(): Uint8Array {
  return loadHunks(new Uint8Array(readFileSync(path)), 0).image
}

describe.skipIf(!present)('ptreplay.library 6.6, as shipped', () => {
  it('has the identity and complete vector table this port records', () => {
    const file = readFileSync(path)
    expect(file.length).toBe(8048)
    expect(file.toString('latin1')).toContain('ptreplay.library 6.6 (1996-03-20)')
    expect(PTREPLAY_LIBRARY).toMatchObject({
      name: 'ptreplay.library', version: 6, revision: 6, librarySize: 52,
    })

    const c = hunk()
    const long = (o: number): number => ((c[o]! << 24) | (c[o + 1]! << 16) | (c[o + 2]! << 8) | c[o + 3]!) >>> 0
    // Resident + 22 is rt_Init; AUTOINIT + 4 points at the vector table.
    const autoinit = long(4 + 22)
    const vectors = long(autoinit + 4)
    const at = (lvo: number): number => long(vectors + (-lvo / 6 - 1) * 4)
    const want = PTREPLAY_LIBRARY.lvo
    expect(Object.fromEntries(Object.entries(want).map(([name, lvo]) => [name, at(lvo)]))).toEqual({
      loadModule: 0x27a,
      unloadModule: 0x36e,
      playModule: 0x3a6,
      stopModule: 0x4c0,
      pauseModule: 0x514,
      unpauseModule: 0x528,
      setVolume: 0x59e,
      getPosition: 0x5b6,
      getLength: 0x5c8,
      fadeModule: 0x6c2,
      channelOn: 0x6ea,
      channelOff: 0x772,
      setPosition: 0x7fe,
    })
  })

  it('stores volume and position without range checks', () => {
    const c = hunk()
    // SetVolume: null guard, then the caller's complete word goes to +$0e.
    expect([...c.subarray(0x59e, 0x5b6)]).toEqual([
      0xb1, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x67, 0x0e, 0x0c, 0xa8, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x08, 0x67, 0x04, 0x31, 0x40, 0x00, 0x0e, 0x4e, 0x75,
    ])
    // SetPosition writes d0.b directly to handle-$0c and returns success.
    expect([...c.subarray(0x7fe, 0x810)]).toEqual([
      0xb1, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x67, 0x08, 0x11, 0x40, 0xff, 0xf4,
      0x30, 0x3c, 0x00, 0x00, 0x4e, 0x75,
    ])
  })
})
