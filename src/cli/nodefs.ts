import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { AmigaFS } from '../amiga/vfs'
import type { DirEntry, Volume } from '../amiga/vfs'
import { modelledLibraries } from '../amiga/exec'

/** disk-backed read-only Volume with case-insensitive resolution */
export class NodeVolume implements Volume {
  constructor(readonly root: string) {}

  /**
   * Resolve an AMOS path to a host path, as raw bytes.
   *
   * Buffers rather than strings because **Amiga filenames are ISO-8859-1**,
   * and a byte like $E4 (a-umlaut) is not valid UTF-8. Node decodes directory
   * entries as UTF-8 by default, so such a name comes back with a replacement
   * character and every later stat/open on it fails — the PD corpus is full of
   * Finnish and Swedish programs that crashed the census this way. Reading the
   * entries as buffers keeps the bytes intact; they are decoded as Latin-1 only
   * to compare with what the program asked for, which is the encoding the
   * program itself is written in.
   */
  private hostPath(segs: string[]): Buffer | null {
    let cur = Buffer.from(this.root)
    for (const seg of segs) {
      if (!existsSync(cur) || !statSync(cur).isDirectory()) return null
      const want = seg.toLowerCase()
      const hit = readdirSync(cur, { encoding: 'buffer' }).find(
        (e) => e.toString('latin1').toLowerCase() === want,
      )
      if (hit === undefined) return null
      cur = Buffer.concat([cur, Buffer.from('/'), hit])
    }
    return cur
  }

  read(segs: string[]): Uint8Array | null {
    const p = this.hostPath(segs)
    if (p === null || !existsSync(p) || !statSync(p).isFile()) return null
    return readFileSync(p)
  }

  list(segs: string[]): DirEntry[] | null {
    const p = this.hostPath(segs)
    if (p === null || !existsSync(p) || !statSync(p).isDirectory()) return null
    return readdirSync(p, { encoding: 'buffer' }).map((raw) => {
      const st = statSync(Buffer.concat([p, Buffer.from('/'), raw]))
      return { name: raw.toString('latin1'), isDir: st.isDirectory(), size: st.isFile() ? st.size : 0 }
    })
  }

  exists(segs: string[]): 'file' | 'dir' | null {
    const p = this.hostPath(segs)
    if (p === null || !existsSync(p)) return null
    return statSync(p).isDirectory() ? 'dir' : 'file'
  }
}

/**
 * FS for running one .AMOS file: the release tree is the AMOSPro: volume
 * with the standard assigns, the program's own directory is PROG: and the
 * current dir — matching a hard-drive AMOS install.
 */
export function fsForFile(file: string, fixturesRoot = 'fixtures/official-amos'): AmigaFS {
  const fs = new AmigaFS()
  fs.mount('PROG', new NodeVolume(dirname(file)))
  // The current directory is the program's own drawer, but reached through
  // the volume mounted one level up — because on a real machine the volume is
  // the disc, not the drawer, and a leading colon means the disc's root. The
  // AMOS 3D demos are written that way throughout ("Td Dir
  // ':AMOS_3D_demos/objects'", "Load Iff ':AMOS_3D_demos/dicepic.iff'") and
  // cannot find anything if ':' stops at the drawer they are sitting in.
  // Relative paths are unaffected: PARENT:<drawer>/ is the same directory
  // PROG: is.
  fs.mount('PARENT', new NodeVolume(dirname(dirname(file))))
  fs.currentDir = `PARENT:${basename(dirname(file))}/`
  // RAM: is always present on a real AMOS machine (the ram-handler) —
  // a writable, initially-empty volume
  fs.mountMemory('RAM')
  fs.mountMemory('CLIPS') // the clipboard handler, which GUI 2.10 opens as CLIPS:0
  // SYS:Libs and LIBS:, one marker per modelled library — see mountSystem
  fs.mountSystem(modelledLibraries().map((l) => l.name))
  if (existsSync(fixturesRoot)) {
    fs.mount('AMOSPro', new NodeVolume(fixturesRoot))
    for (const raw of readdirSync(fixturesRoot, { encoding: 'buffer' })) {
      const entry = raw.toString('latin1')
      if (statSync(Buffer.concat([Buffer.from(fixturesRoot), Buffer.from('/'), raw])).isDirectory()) {
        fs.assign(`AMOSPro_${entry}`, `AMOSPro:${entry}`)
        fs.assign(entry, `AMOSPro:${entry}`)
      }
    }
    fs.assign('AMOSPro_System', 'AMOSPro:APSystem')
    fs.assign('df0', 'AMOSPro:')
  }
  // the parent volume also answers to its own directory name, as a disc would
  fs.assign(basename(dirname(dirname(file))), 'PARENT:')
  // a fonts drawer beside the program (or its parent) becomes FONTS:,
  // like the system assign AvailFonts scans
  for (const [dir, vol] of [
    [dirname(file), 'PROG'],
    [dirname(dirname(file)), 'PARENT'],
  ] as const) {
    const hit = existsSync(dir) && readdirSync(dir).find((e) => e.toLowerCase() === 'fonts' && statSync(join(dir, e)).isDirectory())
    if (hit) {
      fs.assign('Fonts', `${vol}:${hit}`)
      break
    }
  }
  return fs
}
