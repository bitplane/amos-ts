import { describe, expect, it } from 'vitest'
import { DOSFALSE, DOSTRUE, execute, launch, type ProcessHost } from './process'

/** the smallest thing hunk.ts will accept as an AmigaDOS binary */
function tinyBinary(): Uint8Array {
  const w: number[] = []
  const long = (n: number) => w.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
  long(0x3f3) // HUNK_HEADER
  long(0) // no resident library names
  long(1) // table size
  long(0) // first hunk
  long(0) // last hunk
  long(1) // hunk 0 is one long
  long(0x3e9) // HUNK_CODE
  long(1) // one long of code
  long(0x4e750000) // rts, padded
  long(0x3f2) // HUNK_END
  return Uint8Array.from(w)
}

describe('the process seam', () => {
  it('Execute answers DOSFALSE with no host, which is what dos.library says', () => {
    // not a stub: it is the answer the real call gives for a command that
    // cannot be run, and every caller already handles it
    expect(execute(undefined, { command: 'dir', io: { input: 'console', output: 'console' } })).toBe(DOSFALSE)
  })

  it('and DOSTRUE when a host runs it, with the handles it was given', () => {
    let seen: string | null = null
    let detached = false
    const host: ProcessHost = {
      execute(req) {
        seen = req.command
        detached = req.io.output === null
        return true
      },
    }
    expect(execute(host, { command: 'list', io: { input: null, output: null } })).toBe(DOSTRUE)
    expect(seen).toBe('list')
    // the difference between Craft's Cli Execute and EasyLife's Elexec
    expect(detached).toBe(true)
  })

  it('a launch distinguishes "will not load" from "will not start"', () => {
    // the order LoadSeg-then-CreateProc is what makes the two errors tellable
    // apart, and AMCAF raises a different one for each
    expect(launch(undefined, null, { name: 'gone', priority: 0, stackSize: 4096 })).toBe('noseg')
    expect(launch(undefined, Uint8Array.from([1, 2, 3, 4]), { name: 'junk', priority: 0, stackSize: 4096 })).toBe('noseg')
    expect(launch(undefined, tinyBinary(), { name: 'real', priority: 0, stackSize: 4096 })).toBe('noproc')
  })

  it('with a host that can start one, nothing fails', () => {
    const host: ProcessHost = { launch: () => true }
    expect(launch(host, tinyBinary(), { name: 'real', priority: 0, stackSize: 8192 })).toBeNull()
    // and the segment still has to load first
    expect(launch(host, null, { name: 'gone', priority: 0, stackSize: 8192 })).toBe('noseg')
  })

  it('the host sees what CreateProc was asked for', () => {
    let req: { name: string; priority: number; stackSize: number } | null = null
    const host: ProcessHost = {
      launch(r) {
        req = r
        return false
      },
    }
    launch(host, tinyBinary(), { name: 'c:list', priority: 0, stackSize: 4096 })
    expect(req).toEqual({ name: 'c:list', priority: 0, stackSize: 4096 })
  })
})
