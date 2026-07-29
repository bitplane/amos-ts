import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostPath, walkFiles } from './walk'

/**
 * The name that ended a census of the AMOS PD Library CD: "Väliaikainen.AMOS"
 * on APD150, Finnish for "temporary", stored as ISO-8859-1 — $E4 for the
 * a-umlaut, which is not valid UTF-8.
 */
const LATIN1_NAME = Buffer.from([0x56, 0xe4, 0x6c, 0x69, 0x61, 0x69, 0x6b, 0x61, 0x69, 0x6e, 0x65, 0x6e]) // Väliaikainen

describe('walkFiles', () => {
  it('yields a path that still opens when the filename is not valid UTF-8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amos-walk-'))
    const file = Buffer.concat([Buffer.from(dir), Buffer.from('/'), LATIN1_NAME, Buffer.from('.AMOS')])
    writeFileSync(file, 'contents')

    const found = [...walkFiles(dir)]
    expect(found).toHaveLength(1)
    // the bytes survive the round trip: the path names the file it came from
    expect(readFileSync(found[0]!).toString()).toBe('contents')
    expect(hostPath(found[0]!)).toContain('Väliaikainen.AMOS')
  })

  it('descends through a directory whose own name is not valid UTF-8', () => {
    const root = mkdtempSync(join(tmpdir(), 'amos-walk-'))
    const sub = Buffer.concat([Buffer.from(root), Buffer.from('/'), LATIN1_NAME])
    mkdirSync(sub)
    writeFileSync(Buffer.concat([sub, Buffer.from('/inner.amos')]), 'x')

    const found = [...walkFiles(root)]
    expect(found.map(hostPath)).toEqual([`${root}/Väliaikainen/inner.amos`])
  })

  it('skips an entry it cannot stat instead of ending the walk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amos-walk-'))
    writeFileSync(join(dir, 'a.amos'), 'a')
    symlinkSync(join(dir, 'gone'), join(dir, 'dangling'))
    writeFileSync(join(dir, 'z.amos'), 'z')

    // a broken symlink is a fact of life in an old collection; the survey is
    // worth more than the entry it loses
    expect([...walkFiles(dir)].map((p) => hostPath(p).slice(dir.length + 1)).sort()).toEqual(['a.amos', 'z.amos'])
  })
})
