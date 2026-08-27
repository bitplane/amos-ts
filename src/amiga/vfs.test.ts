import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { AmigaFS } from './vfs'
import { volumeFromEntries } from '../runtime/archive'
import { readTar } from './tar'
import { readZip } from './zip'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'

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

  it('takes a deleted directory\'s whole subtree with it', () => {
    // deleting something that lives in a read-only volume can only be
    // recorded, so the tombstone has to cover the children too
    const fs = makeFs()
    expect(fs.deleteAll('DH0:Games/Zybex')).toBe(true)
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toBeNull()
    expect(fs.readFile('DH0:Games/Zybex/Music/theme.abk')).toBeNull()
    expect(fs.exists('DH0:Games/Zybex/Music')).toBeNull()
    expect(fs.listDir('DH0:Games/Zybex')).toBeNull()
    expect(fs.listDir('DH0:Games')).toEqual([])
    // writing back under it brings the path to life again
    expect(fs.writeFile('DH0:Games/Zybex/new.iff', enc('N'))).toBe(true)
    expect(fs.exists('DH0:Games/Zybex')).toBe('dir')
    expect(fs.readFile('DH0:Games/Zybex/new.iff')).toEqual(enc('N'))
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toBeNull() // still gone
  })

  it('refuses to Kill a directory that still has anything in it', () => {
    // InKill (+Lib.s:4873) is DeleteFile(), which takes a file or an empty
    // directory and nothing else
    const fs = makeFs()
    expect(fs.deleteFile('DH0:Games/Zybex')).toBe(false)
    expect(fs.exists('DH0:Games/Zybex')).toBe('dir')
    expect(fs.deleteFile('DH0:Games/Zybex/Music/theme.abk')).toBe(true)
    expect(fs.deleteFile('DH0:Games/Zybex/Music')).toBe(true)
    expect(fs.exists('DH0:Games/Zybex/Music')).toBeNull()
  })

  it('renames directories, contents and all', () => {
    // InRename (+Lib.s:4886) is DOS Rename(), which moves directories too
    const fs = makeFs()
    expect(fs.rename('DH0:Games/Zybex', 'DH0:Games/Xybez')).toBe(true)
    expect(fs.exists('DH0:Games/Zybex')).toBeNull()
    expect(fs.readFile('DH0:Games/Xybez/level1.iff')).toEqual(enc('LEVEL1'))
    expect(fs.readFile('DH0:Games/Xybez/Music/theme.abk')).toEqual(enc('THEME'))
    // and it moves, not just renames
    expect(fs.rename('DH0:Games/Xybez', 'DH0:Xybez')).toBe(true)
    expect(fs.readFile('DH0:Xybez/Music/theme.abk')).toEqual(enc('THEME'))
    expect(fs.listDir('DH0:Games')).toEqual([])
  })

  it('keeps empty drawers when a directory moves', () => {
    const fs = makeFs()
    fs.mkdir('DH0:Games/Zybex/Empty')
    expect(fs.rename('DH0:Games/Zybex', 'DH0:Z2')).toBe(true)
    expect(fs.exists('DH0:Z2/Empty')).toBe('dir')
  })

  it('renames case-only, and refuses the impossible moves', () => {
    const fs = makeFs()
    expect(fs.rename('DH0:S/startup-sequence', 'DH0:S/Startup-Sequence')).toBe(true)
    expect(fs.listDir('DH0:S')!.map((e) => e.name)).toEqual(['Startup-Sequence'])
    // onto something that exists (ERROR_OBJECT_EXISTS)
    expect(fs.rename('DH0:Games/Zybex/level1.iff', 'DH0:S/Startup-Sequence')).toBe(false)
    // into itself
    expect(fs.rename('DH0:Games', 'DH0:Games/Inner')).toBe(false)
    // across devices (ERROR_RENAME_ACROSS_DEVICES) — no silent copy
    fs.mountMemory('RAM')
    expect(fs.rename('DH0:Games/Zybex/level1.iff', 'RAM:level1.iff')).toBe(false)
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toEqual(enc('LEVEL1'))
    // and something that isn't there at all
    expect(fs.rename('DH0:nope', 'DH0:nope2')).toBe(false)
  })

  it('relabels a volume, assigns and current dir following it', () => {
    const fs = makeFs()
    fs.assign('Res:', 'DH0:Games/Zybex')
    fs.writeFile('DH0:Games/Zybex/save.dat', enc('SAVE')) // lands in the overlay
    fs.deleteFile('DH0:S/startup-sequence') // and a tombstone
    fs.setCurrentDir('DH0:Games')
    expect(fs.renameVolume('DH0', 'Work')).toBe(true)
    expect(fs.volumeNames()).toEqual(['Work'])
    expect(fs.currentDir).toBe('Work:Games')
    expect(fs.readFile('Work:Games/Zybex/level1.iff')).toEqual(enc('LEVEL1')) // backing volume
    expect(fs.readFile('Work:Games/Zybex/save.dat')).toEqual(enc('SAVE')) // overlay
    expect(fs.exists('Work:S/startup-sequence')).toBeNull() // tombstone
    expect(fs.readFile('Res:level1.iff')).toEqual(enc('LEVEL1')) // assign retargeted
    expect(fs.readFile('DH0:Games/Zybex/level1.iff')).toBeNull() // old name is gone
    expect(fs.renameVolume('Work', 'a/b')).toBe(false)
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
    mustFinish(r)
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
    // Dir First$ entries are FnFillNext-formatted: marker + name padded to
    // 30 + 8-char size; the Music directory sorts first ('*' -> byte 1)
    expect(out).toBe('ONETWO\n' + '*Music'.padEnd(38) + '\n' + ' level1.iff'.padEnd(30) + '6'.padEnd(8) + '\n 0\n')
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

describe('running a game away from the machine it was written on', () => {
  // A 1997 program names its author's drives: DF0: because that is the floppy
  // it shipped on, DH1: because that is where it was installed. Those drives
  // cannot exist in a browser, so a host running a game out of an archive
  // points every drive name at the drawer the program came from and lets a
  // dead path fall back to the file's own name.
  //
  // OFF by default and deliberately: InDirD (+Lib.s:4799) locks the path and
  // branches to L_DiskError when it cannot, so the machine stops the program.
  // The census depends on that — a missing file has to look missing.
  function machine(): AmigaFS {
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    const zip = fs.mountMemory('GAME_ZIP')
    for (const v of [dh0, zip]) {
      v.write(['game', 'main.amos'], new Uint8Array([1]))
      v.write(['game', 'title.iff'], new Uint8Array([2]))
      v.write(['game', 'data', 'level1'], new Uint8Array([3]))
    }
    fs.currentDir = 'DH0:game'
    return fs
  }

  it('leaves every drive name unresolved by default', () => {
    const fs = machine()
    for (const p of ['df0:title.iff', 'dh1:title.iff', 'hd0:title.iff']) {
      expect(fs.exists(p), p).toBe(null)
    }
  })

  it('points all twelve drive names at the program drawer', () => {
    const fs = machine()
    fs.assignDrives('GAME_ZIP:game')
    for (const d of AmigaFS.DRIVES) {
      expect(fs.exists(`${d}:title.iff`), d).toBe('file')
    }
  })

  it('keeps a sub-drawer that really is in the archive', () => {
    const fs = machine()
    fs.assignDrives('GAME_ZIP:game')
    expect(fs.resolve('dh1:data/level1')?.canonical).toBe('GAME_ZIP:game/data/level1')
  })

  it('falls back to the filename when the drawers never existed here', () => {
    // Q.A.B. does Dir$="dh1:amos/amos_saves" and then loads by bare name;
    // that layout was on a hard disk nobody has any more
    const fs = machine()
    fs.strayVolume = 'currentDir'
    fs.assignDrives('GAME_ZIP:game')
    expect(fs.exists('dh1:amos/amos_saves/title.iff')).toBe('file')
  })

  it('rescues an assign the author invented, not just the drives', () => {
    // "saves:" and "apd85:" are as dead as DH1: and just as common
    const fs = machine()
    fs.strayVolume = 'currentDir'
    expect(fs.exists('saves:title.iff')).toBe('file')
    expect(fs.exists('apd85:title.iff')).toBe('file')
  })

  it('still cannot find a file that is not there', () => {
    // the fallback only ever returns a path when something real is at it —
    // it rescues a dead layout, it does not invent files
    const fs = machine()
    fs.strayVolume = 'currentDir'
    fs.assignDrives('GAME_ZIP:game')
    expect(fs.exists('df0:nope.iff')).toBe(null)
    expect(fs.exists('df0:amos/nope.iff')).toBe(null)
  })

  it('refuses a drive assign that points back through a drive', () => {
    // assigns expand before volumes, so DH0 -> "DH0:game" spins until the
    // cycle guard gives up and every path comes out as nonsense
    const fs = machine()
    expect(() => fs.assignDrives('DH0:game')).toThrow(/itself under a drive name/)
  })
})

describe('how much room a volume says it has', () => {
  /**
   * Zero free is a measurement: it says FULL. A memory volume has not
   * measured anything, because its capacity is the host's and not its own,
   * so it declines the question instead — which is what the `Volume`
   * interface says a tree built in memory should do.
   *
   * It used to answer `used + 0` and look exactly full. Nothing asked until
   * `=Dfree` started reporting what volumes said, and then the browser's own
   * DH0: claimed there was no room on a store that never refuses a write.
   */
  it('a memory volume declines rather than claiming to be full', () => {
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    dh0.write(['thing'], new Uint8Array(2048))
    expect(fs.volumeInfo('DH0')).toBeNull()
  })

  it('and answers once a caller supplies the free count', () => {
    // the Runtime knows its own pools, which is who this is for
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    dh0.freeBlocks = 100
    dh0.write(['thing'], new Uint8Array(2048))
    const info = fs.volumeInfo('DH0')!
    expect(info.numBlocksUsed).toBe(4) // 2048 / 512
    expect(info.numBlocks).toBe(104)
  })
})

describe('watching the filesystem', () => {
  const enc2 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

  it('reports a file put into a mounted volume, which writeFile never sees', () => {
    // the case the event exists for. A host unpacking an archive writes INTO
    // the volume; only a running program's writes go to the overlay, so a
    // listener on the filesystem's own methods would miss every dropped file
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    const seen: string[] = []
    fs.watch((e) => seen.push(`${e.kind} ${e.path}`))
    fs.writeTo('DH0', ['Games', 'zybex.amos'], enc2('x'))
    expect(seen).toEqual(['add DH0:Games/zybex.amos'])
  })

  it('reports a program writing through the filesystem too', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    const seen: string[] = []
    fs.watch((e) => seen.push(`${e.kind} ${e.path}`))
    // lands in the overlay rather than the volume, and still reports
    fs.writeFile('DH0:notes.txt', enc2('hi'))
    expect(seen).toEqual(['add DH0:notes.txt'])
  })

  it('makes a whole volume ONE event, because a mount is hundreds of files', () => {
    const fs = new AmigaFS()
    const seen: string[] = []
    fs.watch((e) => seen.push(`${e.kind} ${e.path}`))
    const vol = fs.mountMemory('DF0')
    expect(seen).toEqual(['add DF0:'])
    // and the volume is wired on the way in, so its own traffic reports
    vol.write(['boot.amos'], enc2('x'))
    expect(seen).toEqual(['add DF0:', 'add DF0:boot.amos'])
  })

  it('unmounts as one event and stops listening to what left', () => {
    const fs = new AmigaFS()
    const vol = fs.mountMemory('DF0')
    const seen: string[] = []
    fs.watch((e) => seen.push(`${e.kind} ${e.path}`))
    expect(fs.unmount('DF0')).toBe(true)
    expect(seen).toEqual(['remove DF0:'])
    // a caller holding the ejected volume cannot go on reporting into a
    // filesystem it is no longer part of
    vol.write(['stray.amos'], enc2('x'))
    expect(seen).toEqual(['remove DF0:'])
    expect(fs.unmount('DF0')).toBe(false)
  })

  it('reports a delete, and lets a listener stop', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.writeFile('DH0:gone.txt', enc2('x'))
    const seen: string[] = []
    const stop = fs.watch((e) => seen.push(`${e.kind} ${e.path}`))
    fs.deleteFile('DH0:gone.txt')
    expect(seen).toEqual(['remove DH0:gone.txt'])
    stop()
    fs.writeFile('DH0:after.txt', enc2('x'))
    expect(seen).toEqual(['remove DH0:gone.txt'])
  })
})
