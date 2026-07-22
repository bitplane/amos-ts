import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AmosFS } from '../runtime/fs'

/**
 * Disk-backed AmosFS with Amiga assign mounts and case-insensitive
 * resolution ("AMOSPro_Tutorial:Iff/Window.IFF" finds Tutorial/Iff/Window.Iff).
 */
export function createNodeFS(mounts: Record<string, string>, searchRoots: string[] = []): AmosFS {
  const caseWalk = (base: string, rest: string): string | null => {
    let cur = base
    for (const seg of rest.split('/')) {
      if (seg === '' || seg === '.') continue
      if (!existsSync(cur) || !statSync(cur).isDirectory()) return null
      const entries = readdirSync(cur)
      const hit = entries.find((e) => e.toLowerCase() === seg.toLowerCase())
      if (hit === undefined) return null
      cur = join(cur, hit)
    }
    return existsSync(cur) && statSync(cur).isFile() ? cur : null
  }

  return {
    read(path: string): Uint8Array | null {
      const p = path.replace(/\\/g, '/')
      const m = /^([^:/]+):(.*)$/.exec(p)
      const candidates: Array<[string, string]> = []
      if (m) {
        const mount = mounts[m[1]!.toLowerCase() + ':']
        if (mount !== undefined) candidates.push([mount, m[2]!])
        // unknown assigns also fall back to the search roots
        for (const root of searchRoots) candidates.push([root, m[2]!])
      } else {
        for (const root of searchRoots) candidates.push([root, p])
      }
      for (const [base, rest] of candidates) {
        const hit = caseWalk(base, rest)
        if (hit !== null) return readFileSync(hit)
      }
      return null
    },
  }
}

/** Mount table for the AMOS Pro release tree used by the fixture corpus. */
export function fixtureMounts(root: string): Record<string, string> {
  const mounts: Record<string, string> = {}
  if (!existsSync(root)) return mounts
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (!statSync(full).isDirectory()) continue
    mounts[`amospro_${entry.toLowerCase()}:`] = full
    mounts[`${entry.toLowerCase()}:`] = full
  }
  mounts['amospro:'] = root
  mounts['amospro_system:'] = join(root, 'APSystem')
  mounts['df0:'] = root
  return mounts
}

/** FS for running one .AMOS file: its own directory plus the fixture mounts. */
export function fsForFile(file: string, fixturesRoot = 'fixtures/official-amos'): AmosFS {
  return createNodeFS(fixtureMounts(fixturesRoot), [dirname(file), dirname(dirname(file))])
}
