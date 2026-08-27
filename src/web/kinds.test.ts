import { describe, expect, it } from 'vitest'
import { identify } from './kinds'

/** a file with `head` at the front and `size` bytes in total */
const file = (head: string | number[], size = 64): Uint8Array => {
  const d = new Uint8Array(size)
  const bytes = typeof head === 'string' ? [...head].map((c) => c.charCodeAt(0)) : head
  d.set(bytes.slice(0, size))
  return d
}

/** a module with its tag at `at`, which is where every one of them hides it */
const tagged = (tag: string, at: number, size: number): Uint8Array => {
  const d = new Uint8Array(size)
  d.set([...tag].map((c) => c.charCodeAt(0)), at)
  return d
}

describe('identifying a file for the Files panel', () => {
  it('knows an AMOS program by its header, not its name', () => {
    // the corpus is full of extensionless programs: APD085's Snakes is
    // "AMOS Basic V1.00" from 1990 and is named Snakes
    const prog = identify('Snakes', file('AMOS Basic V1.00    '))
    expect(prog.group).toBe('program')
    expect(prog.openable).toBe(true)
  })

  it('takes a listing on its name, because a listing has no header', () => {
    const listing = new TextEncoder().encode('Print "hello"\nWait Vbl\n')
    expect(identify('demo.amos', listing).group).toBe('program')
    // the same bytes under another name are what they are
    expect(identify('notes.txt', listing).group).toBe('text')
  })

  it('knows all four kinds of .Abk, not just the memory one', () => {
    // There is no single bank magic and only `AmBk` used to be tested, so
    // every sprite bank in the corpus came back as `data` with nothing to
    // look at. These are the four `parseAmosFile` accepts.
    for (const [magic, name] of [
      ['AmBk', 'AMOS bank'],
      ['AmSp', 'AMOS sprites'],
      ['AmIc', 'AMOS icons'],
      ['AmBs', 'AMOS banks'],
    ] as const) {
      const bank = identify('thing.abk', file(magic))
      expect(bank.group, magic).toBe('bank')
      expect(bank.name, magic).toBe(name)
      expect(bank.container, magic).toBe(true)
    }
  })

  it('does not take a name for a bank magic', () => {
    // `.abk` on the end is not evidence: the corpus holds files named that
    // way that are something else entirely
    expect(identify('notreally.abk', file('JUNK')).group).not.toBe('bank')
  })

  it('knows a floppy image by its size and says what it is called', () => {
    const adf = new Uint8Array(901_120)
    adf.set([...'DOS'].map((c) => c.charCodeAt(0)))
    const k = identify('game.adf', adf)
    expect(k.group).toBe('disk')
    expect(k.openable).toBe(true)
    expect(k.container).toBe(true)
  })

  it('does not call a truncated disk image a disk', () => {
    // a short read is the failure this catches: 7-Zip has truncated corpus
    // files twice while reporting success
    const short = file('DOS\0', 900_000)
    expect(identify('game.adf', short).group).not.toBe('disk')
  })

  it('names the archive format rather than saying "archive"', () => {
    // the method id at 2 is the whole of xad's LhA recogniser, and the name
    // in the row is the client's own, so a reader sees LhA and not "archive"
    const lha = new Uint8Array(64)
    lha[0] = 0x20
    lha.set([...'-lh5-'].map((c) => c.charCodeAt(0)), 2)
    const k = identify('disk.lha', lha)
    expect(k.group).toBe('archive')
    expect(k.name).toBe('LhA')
    expect(k.container).toBe(true)
  })

  it('knows a zip', () => {
    const zip = file([0x50, 0x4b, 0x03, 0x04])
    expect(identify('stuff.zip', zip).group).toBe('archive')
  })

  it('knows gzip, which hides the format underneath it', () => {
    expect(identify('stuff.tar.gz', file([0x1f, 0x8b, 0x08, 0x00])).group).toBe('archive')
  })

  it('routes every module format to its own replayer', () => {
    expect(identify('a', tagged('MMD0', 0, 64)).format).toBe('med')
    expect(identify('a', tagged('MMD2', 0, 64)).format).toBe('omed')
    expect(identify('a', tagged('THX\0', 0, 64)).format).toBe('thx')
    expect(identify('a', tagged('P61A', 0, 64)).format).toBe('p61')
    expect(identify('a', tagged('FC14', 0, 64)).format).toBe('fc14')
    expect(identify('a', tagged('SMOD', 0, 64)).format).toBe('fc13')
    expect(identify('a', tagged('M.K.', 1080, 1100)).format).toBe('mod')
    expect(identify('a', tagged('SONG', 0x3c, 0x300)).format).toBe('sfx')
  })

  it('calls a module music and names the tracker', () => {
    const k = identify('title', tagged('M.K.', 1080, 1100))
    expect(k.group).toBe('music')
    expect(k.name).toBe('ProTracker')
  })

  it('does not let MacPaint claim a blank-named module', () => {
    // MacPaint's whole mask is one byte of $00 and a 15-sample module starts
    // with a sample name that is routinely blank. This is the ordering test:
    // ask the ten descriptors before the module sniffer and half the tracker
    // modules ever written come back as pictures.
    const mod = tagged('M.K.', 1080, 1100)
    expect(mod[0]).toBe(0)
    expect(identify('untitled', mod).group).toBe('music')
  })

  it('knows an IFF picture and an IFF sound apart', () => {
    const form = (kind: string): Uint8Array => {
      const d = new Uint8Array(64)
      d.set([...'FORM'].map((c) => c.charCodeAt(0)))
      d.set([...kind].map((c) => c.charCodeAt(0)), 8)
      return d
    }
    expect(identify('pic.iff', form('ILBM')).group).toBe('picture')
    expect(identify('bang.iff', form('8SVX')).group).toBe('sound')
  })

  it('knows a Workbench icon', () => {
    expect(identify('Disk.info', file([0xe3, 0x10, 0x00, 0x01])).group).toBe('icon')
  })

  it('says data rather than guessing, and empty rather than data', () => {
    expect(identify('x', null).name).toBe('empty')
    expect(identify('x', new Uint8Array(0)).name).toBe('empty')
    // high bytes with no header anybody knows
    expect(identify('x', file([0x8f, 0x2c, 0xd1, 0x03, 0xff, 0xa0])).group).toBe('data')
  })
})
