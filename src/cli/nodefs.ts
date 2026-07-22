import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { AmigaFS } from '../runtime/vfs'
import type { DirEntry, Volume } from '../runtime/vfs'

/** disk-backed read-only Volume with case-insensitive resolution */
export class NodeVolume implements Volume {
  constructor(readonly root: string) {}

  private hostPath(segs: string[]): string | null {
    let cur = this.root
    for (const seg of segs) {
      if (!existsSync(cur) || !statSync(cur).isDirectory()) return null
      const hit = readdirSync(cur).find((e) => e.toLowerCase() === seg.toLowerCase())
      if (hit === undefined) return null
      cur = join(cur, hit)
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
    return readdirSync(p).map((name) => {
      const st = statSync(join(p, name))
      return { name, isDir: st.isDirectory(), size: st.isFile() ? st.size : 0 }
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
  fs.currentDir = 'PROG:'
  if (existsSync(fixturesRoot)) {
    fs.mount('AMOSPro', new NodeVolume(fixturesRoot))
    for (const entry of readdirSync(fixturesRoot)) {
      if (statSync(join(fixturesRoot, entry)).isDirectory()) {
        fs.assign(`AMOSPro_${entry}`, `AMOSPro:${entry}`)
        fs.assign(entry, `AMOSPro:${entry}`)
      }
    }
    fs.assign('AMOSPro_System', 'AMOSPro:APSystem')
    fs.assign('df0', 'AMOSPro:')
  }
  // parent of the program dir as a second lookup for relative resources
  fs.mount('PARENT', new NodeVolume(dirname(dirname(file))))
  fs.assign(basename(dirname(dirname(file))), 'PARENT:')
  return fs
}
