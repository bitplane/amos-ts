/**
 * Which extension every program in the filesystem actually uses.
 *
 * A tokenised program records an extension keyword as (slot, token id) and the
 * slot is only an index into the interpreter config of the machine it was
 * saved on. So a program does not say "I use TURBO Plus 1.9" anywhere; it says
 * "slot 12, id $04d2", and the set of ids it used in that slot is a
 * fingerprint of one specific token table. `../../ext/identify.ts` turns that
 * back into an identity, and this walks the filesystem doing it.
 *
 * The point is that no convention is needed. Nobody has to put demos in a
 * drawer named after the extension or maintain a list of which program shows
 * off what: drop an archive of real AMOS programs and every extension that has
 * something to run against finds it, because the programs say so themselves.
 *
 * ## Per program, never merged
 *
 * `src/cli/extscan.ts` learned this the hard way and its header says so: a
 * slot number belongs to a MACHINE, so two programs in one collection can hold
 * different extensions at the same slot, and merging their ids into one
 * fingerprint asks a question nothing has to answer. Slot 12 of one archive
 * left 39 of 110 ids unexplained when merged and looked like an undiscovered
 * fourth TURBO build; per program it is 105 programs on 1.9, 48 on 1.0 and one
 * on 2.15, with nothing missing at all.
 *
 * `identifyProgram` is per program already. This only has to avoid undoing it,
 * which means the aggregation below counts programs and never pools ids.
 *
 * ## Told, not asked
 *
 * `AmigaFS.watch` reports a file appearing or going away and this reads only
 * that file. There is nothing to re-walk on a drop, which matters because the
 * expensive half is the parse --- `parseAmosFile`, then `parseSource`, then a
 * fingerprint match against 88 token tables --- and a corpus is thousands of
 * programs.
 *
 * A whole VOLUME is one event, because an ADF mounting makes several hundred
 * files appear at once and finding out which would be the walk this exists to
 * avoid. That one case does walk, and only inside the volume that arrived.
 *
 * There was no add-time hook to attach to before this, which is worth stating
 * because it looks like there should have been: `isAmosProgram` runs when a
 * file arrives and is only a header sniff, and the real identification happens
 * in `../../loader/program.ts` when a program is RUN, which is far too late to
 * list what is available to run.
 */
import { parseAmosFile } from '../../loader/amosfile'
import { isAmosProgram } from '../../loader/program'
import { parseSource, TokenTable } from '../../tokens/stream'
import { CORE_TOKENS } from '../../tokens/tables.gen'
import { identifyProgram, type Confidence } from '../../ext/identify'
import type { AmigaFS } from '../../amiga/vfs'

export interface ProgramUse {
  /** the full path, which is what runs it */
  path: string
  /** the leaf, which is what a row prints */
  name: string
  /**
   * How sure the identification is, straight from `identifySlot`.
   *
   * Worth carrying rather than filtering on. An `ambiguous` program still
   * exercises the extension if the binding is right, and saying which ones are
   * guesses is more use than quietly dropping them.
   */
  confidence: Confidence
}

export interface ProgramIndex {
  /** extension id -> the programs that use it, by name */
  byExtension: Map<string, ProgramUse[]>
  /** programs parsed */
  scanned: number
  /** programs that would not parse at all */
  failed: number
  /**
   * Programs holding a slot the registry cannot explain.
   *
   * The actionable output, and the reason `extscan` exists: an unidentified
   * slot is a concrete request, "find the extension whose token table has an
   * entry at this offset taking this many arguments". Reachable by dropping a
   * file now rather than by running a CLI over a corpus.
   */
  unidentified: ProgramUse[]
}

/**
 * An AMOS program by CONTENT, or by name for a plain-text listing.
 *
 * The header is the reliable half: `AMOS Basic` or `AMOS Pro` in the first
 * sixteen bytes. Testing the name alone was a bug --- the AMOS editor saves
 * under whatever name you typed and nothing adds an extension, so a backup off
 * a real machine is full of programs called `Game` and `test2`, and every one
 * of them was invisible here while the files tree listed it as runnable. The
 * name test stays for the other direction: a plain-text listing has no header
 * to find, which is the same rule `main.ts` uses for the tree.
 */
const looksLikeProgram = (name: string, bytes: Uint8Array): boolean =>
  isAmosProgram(bytes) || (/\.amos$/i.test(name) && bytes.length > 0)

/** every file in every mounted volume, depth first */
function* walk(vfs: AmigaFS, dir: string, depth = 0): Generator<string> {
  // a deep tree is somebody's whole hard drive; this is a page redraw, not an
  // archive crawler, and eight levels reaches anything a program loads
  if (depth > 8) return
  for (const e of vfs.listDir(dir) ?? []) {
    const full = dir.endsWith(':') ? dir + e.name : `${dir}/${e.name}`
    if (e.isDir) yield* walk(vfs, full, depth + 1)
    else yield full
  }
}

/** what one program turned out to use, per slot */
interface Reading {
  /** extension id per slot, with `null` for a slot nothing explains */
  found: { id: string | null; confidence: Confidence }[]
  ok: boolean
}

export interface ProgramIndexer {
  /** what is known right now, aggregated by extension */
  current(): ProgramIndex
  /**
   * Bumped whenever the index changes.
   *
   * So a view can ask "is what I drew still true" for the cost of an integer
   * compare. A tab redrawing only when its tab is SHOWN goes stale in the one
   * case that matters, which is files landing while you are looking at it.
   */
  readonly revision: number
  /** stop listening */
  stop(): void
}

export function createProgramIndex(vfs: AmigaFS): ProgramIndexer {
  const core = new TokenTable(CORE_TOKENS)
  /** path -> what reading it found. The whole state; there is no other. */
  const known = new Map<string, Reading>()
  let revision = 0

  function read(path: string): void {
    const name = path.split('/').pop() ?? path
    const bytes = vfs.read(path)
    if (!bytes || !looksLikeProgram(name, bytes)) return
    revision++
    try {
      const amos = parseAmosFile(bytes)
      const ids = amos.source.length === 0 ? new Map() : identifyProgram(parseSource(amos.source, core))
      known.set(path, {
        ok: true,
        found: [...ids.values()].map((i) => ({ id: i.best?.id ?? null, confidence: i.confidence })),
      })
    } catch {
      // a listing that is not a tokenised program, or a truncated one. Not
      // worth a message per file; the count is what a reader needs.
      known.set(path, { ok: false, found: [] })
    }
  }

  /** a volume arrived or went away, which is the one event that is not one file */
  function volumeAdded(vol: string): void {
    for (const path of walk(vfs, vol)) read(path)
  }

  function forget(prefix: string): void {
    for (const path of [...known.keys()]) {
      if (path === prefix || path.startsWith(prefix.endsWith(':') ? prefix : `${prefix}/`)) {
        known.delete(path)
        revision++
      }
    }
  }

  const stop = vfs.watch((e) => {
    const isVolume = e.path.endsWith(':')
    if (e.kind === 'remove') forget(e.path)
    else if (isVolume) volumeAdded(e.path)
    else read(e.path)
  })

  // whatever was already mounted before anybody was listening
  for (const vol of vfs.volumeNames()) volumeAdded(`${vol}:`)

  return {
    get revision(): number {
      return revision
    },
    current(): ProgramIndex {
      const byExtension = new Map<string, ProgramUse[]>()
      const unidentified: ProgramUse[] = []
      let scanned = 0
      let failed = 0
      for (const [path, reading] of known) {
        if (!reading.ok) {
          failed++
          continue
        }
        scanned++
        const name = path.split('/').pop() ?? path
        for (const { id, confidence } of reading.found) {
          const use: ProgramUse = { path, name, confidence }
          if (id === null) {
            unidentified.push(use)
            continue
          }
          const list = byExtension.get(id)
          if (list) list.push(use)
          else byExtension.set(id, [use])
        }
      }
      for (const list of byExtension.values()) list.sort((a, b) => a.name.localeCompare(b.name))
      return { byExtension, scanned, failed, unidentified }
    },
    stop,
  }
}
