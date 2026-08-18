/**
 * Every LHA on this machine, decoded and compared against `lhasa`.
 *
 * This is the test that decides whether `./lha.ts` is right, because the lh5
 * codec in it is an implementation of a published algorithm rather than a
 * port of anything. A round-trip through our own encoder would agree with
 * itself; `lhasa` is Simon Howard's, is not derived from this, and is the
 * reference every Linux distribution ships.
 *
 * `ancient` cannot stand in. Its LH decompressors are XPK sub-formats and it
 * has no LHA support, so a bare `-lh5-` stream sliced out of a real archive
 * answers "Unknown or invalid compression format".
 *
 * Skipped where `lhasa` is not installed or no archive is reachable, which is
 * every machine without the corpus.
 */
import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLha, readLhaHeaders } from './lha'
import { describeIf } from '../testing/fixture'

/**
 * Is lhasa on this machine?
 *
 * It prints usage and exits NON-ZERO when run with no arguments, so a plain
 * try/catch reports it missing when it is right there. Only ENOENT means
 * absent.
 */
function haveLhasa(): boolean {
  try {
    execFileSync('lhasa', [], { stdio: 'ignore' })
    return true
  } catch (e) {
    return (e as { code?: string }).code !== 'ENOENT'
  }
}

/** every .lha under the two places this repo keeps them */
function archives(): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || !existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (name.toLowerCase().endsWith('.lha')) out.push(p)
    }
  }
  walk('fixtures/aminet', 0)
  walk('../amos-files', 1)
  return out.slice(0, 30)
}

/**
 * What lhasa makes of an archive, keyed by lowercased path.
 *
 * Lowercased because lhasa applies a NAMING POLICY this file deliberately
 * does not: a level-0 member with no OS identifier is MS-DOS by convention
 * and lhasa lowercases it, so `TGE/GMS/IMPORTANT.TXT` lands as
 * `tge/gms/important.txt`. `lha.ts` keeps the stored name, because which case
 * a caller wants is the caller's decision. Comparing on content rather than
 * on spelling is what keeps that difference from reading as a decode bug.
 *
 * Names come back as Buffers, because an Amiga filename can hold bytes that
 * are not valid UTF-8 and Node will not hand those back as a usable string.
 */
function extractWith(archive: string): Map<string, Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'lha-oracle-'))
  const out = new Map<string, Uint8Array>()
  try {
    // one argument, not three: lhasa's usage is `[-]{...}[w=<dir>]` and it
    // does not take `-w=` separately
    execFileSync('lhasa', [`-xqw=${dir}`, archive], { stdio: 'ignore' })
    const walk = (d: Buffer): void => {
      for (const n of readdirSync(d, { encoding: 'buffer' } as never) as unknown as Buffer[]) {
        const p = Buffer.concat([d, Buffer.from('/'), n])
        if (statSync(p).isDirectory()) walk(p)
        else out.set(p.toString('latin1').slice(dir.length + 1).toLowerCase(), new Uint8Array(readFileSync(p)))
      }
    }
    walk(Buffer.from(dir))
  } catch {
    // an archive lhasa itself refuses is not this port's problem
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return out
}

const list = haveLhasa() ? archives() : []

describeIf('every LHA on this machine, against lhasa', list.length > 0, () => {
  it(`decodes ${list.length} archives byte for byte`, () => {
    let members = 0
    const wrong: string[] = []
    for (const archive of list) {
      const bytes = new Uint8Array(readFileSync(archive))
      const want = extractWith(archive)
      if (want.size === 0) continue
      const got = new Map(readLha(bytes).map((f) => [f.path.toLowerCase(), f.data]))
      for (const [path, w] of want) {
        const g = got.get(path)
        members++
        if (g === undefined) {
          wrong.push(`${archive}: missing ${path}`)
          continue
        }
        if (g.length !== w.length) {
          wrong.push(`${archive}: ${path} is ${g.length}, lhasa says ${w.length}`)
          continue
        }
        for (let i = 0; i < w.length; i++) {
          if (g[i] !== w[i]) {
            wrong.push(`${archive}: ${path} differs at byte ${i}`)
            break
          }
        }
      }
    }
    // a number rather than a bare pass, so a run that silently compared
    // nothing cannot look like a run that compared everything
    expect(members, 'members compared').toBeGreaterThan(500)
    expect(wrong.slice(0, 10)).toEqual([])
  })

  /**
   * The header walk has to agree on the SHAPE too, not only on the bytes it
   * managed to decode. A walk that lost a member would still pass the test
   * above for every member it kept.
   */
  it('finds the same number of members lhasa lists', () => {
    const off: string[] = []
    let checked = 0
    for (const archive of list) {
      const bytes = new Uint8Array(readFileSync(archive))
      const want = extractWith(archive)
      if (want.size === 0) continue
      const heads = readLhaHeaders(bytes).filter((h) => h.path !== '' && !h.path.endsWith('/'))
      checked++
      if (heads.length !== want.size) off.push(`${archive}: ${heads.length} headers, lhasa extracted ${want.size}`)
    }
    expect(checked, 'archives checked').toBeGreaterThan(10)
    expect(off).toEqual([])
  })
})
