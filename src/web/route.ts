/**
 * What a link to a disk looks like, and what one is allowed to look like.
 *
 * The page is one document with a fragment, so a link into it is
 * `#<tab>/<library path>`: `#play/bitplane-net/egg-it` runs Egg It and
 * `#browse/games` opens the Games shelf. Nothing here navigates. The whole
 * point of routing on the fragment is that the machine keeps its mounted
 * volumes across a link, and a real navigation would take four disks out of
 * the drives on the way to the same screen.
 *
 * ## Two forms, and only one of them is written
 *
 * `canonical()` is the form the page PRODUCES: lowercase, one hyphen for any
 * run of punctuation or space, `_` kept. `Draw 'n' draw` is `draw-n-draw`
 * and `AMOSPro_System` is `amospro_system`, because the AMOS disks are named
 * with underscores and an underscore needs no percent-escaping to survive
 * being pasted into a chat window.
 *
 * `loose()` is the form the page ACCEPTS, and it is deliberately blunter:
 * everything that is not a letter or a digit comes out. `Egg It`,
 * `egg%20it`, `EGG_IT` and `e-g-g-i-t` all key to `eggit`. Comparison is
 * always on the loose form, so a link that has been through a mail client, a
 * URL shortener and somebody's memory still lands, and only the link the
 * page hands back is tidy.
 *
 * ## Why the naming rule lives here and not in the indexer
 *
 * ../cli/genlibrary.ts stamps the same slug into every `id` in `index.json`,
 * and the two must agree or a generated link would not match its own index.
 * That file opens `node:fs`, so the page cannot import it; this one imports
 * nothing, so both can. The type-only import below is the same arrangement
 * ./ui/browse.ts already runs on.
 */
import type { LibraryFolder, LibraryItem } from '../cli/genlibrary'

/** drop the diacritics so `Über` keys as `uber` rather than as `ber` */
function flatten(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/gu, '')
}

/**
 * The written form of a name: `AMOS 3D` -> `amos-3d`.
 *
 * Underscore survives; every other run of punctuation, space or anything
 * else outside `a-z0-9` becomes ONE hyphen, and the ends are trimmed so
 * `(Demo).adf` is not `-demo-`.
 */
export function canonical(text: string): string {
  return flatten(text)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** the comparison form: letters and digits, nothing else. `Egg It` -> `eggit` */
export function loose(text: string): string {
  return flatten(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** a whole path as one comparison key, so two paths compare in one string */
function key(path: readonly string[]): string {
  return path.map(loose).join('/')
}

/** `AMOS/AMOS 3D` -> `amos/amos-3d`; the id genlibrary stamps into the index */
export function slugPath(path: string): string {
  return path.split('/').map(canonical).join('/')
}

/**
 * Where a disk lives, as the segments of its link.
 *
 * Built from `disk.path` and `name` rather than from the `id` the indexer
 * wrote, because the index is published by bitplane/amos-library on its own
 * schedule and is routinely older than the page reading it. A link the page
 * generates from the names in front of it is right on an index of any age,
 * and an older index's `id` still matches it, since matching is loose.
 */
export function itemPath(item: LibraryItem): string[] {
  const dir = item.disk.path.split('/').slice(0, -1)
  // `name` and not the last path segment: the indexer took the extension
  // off, and `.tar.gz` does not come off with one `replace`
  return [...dir, item.name].map(canonical)
}

/** what the fragment says: `#play/games/egg%20it` -> `['play','games','Egg It']` */
export function splitFragment(hash: string): string[] {
  return hash
    .replace(/^#/, '')
    .split('/')
    .map((seg) => {
      // a stray `%` is a typo, not a reason to throw on the way to a tab
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
    .filter((seg) => seg !== '')
}

/** `['play','games','egg-it']` -> `#play/games/egg-it` */
export function joinFragment(segs: readonly string[]): string {
  return (
    '#' +
    segs
      .filter((s) => s !== '')
      .map(encodeURIComponent)
      .join('/')
  )
}

export type Found =
  | { kind: 'folder'; folder: LibraryFolder; stack: LibraryFolder[]; path: string[] }
  | { kind: 'item'; item: LibraryItem; stack: LibraryFolder[]; path: string[] }

/** every folder and disk in the tree, each with the path a link would use */
function flat(root: LibraryFolder): Found[] {
  const out: Found[] = []
  const walk = (folder: LibraryFolder, stack: LibraryFolder[], path: string[]): void => {
    for (const sub of folder.folders) {
      const here = [...path, canonical(sub.name)]
      out.push({ kind: 'folder', folder: sub, stack: [...stack, sub], path: here })
      walk(sub, [...stack, sub], here)
    }
    for (const item of folder.items) out.push({ kind: 'item', item, stack, path: itemPath(item) })
  }
  walk(root, [root], [])
  return out
}

/**
 * The thing a link names, or null.
 *
 * Three passes, each blunter than the last, and the first one that answers
 * with exactly one thing wins:
 *
 * 1. the loose path, whole. `bitplane.net/Egg It` finds `bitplane-net/egg-it`.
 * 2. the loose path as a SUFFIX, so `#play/egg-it` works when only one disk
 *    in the library is called that. Somebody shortening a link by hand cuts
 *    the front off it, and that is the cut they make.
 * 3. the last segment alone against disk names, which is what is left of a
 *    link whose folder has since been renamed.
 *
 * A pass that matches two things answers nothing and falls through, and a
 * route that matches two disks in the end resolves to neither: opening the
 * wrong game is worse than saying the link is ambiguous.
 */
export function resolve(root: LibraryFolder, path: readonly string[]): Found | null {
  if (path.length === 0) return null
  const want = key(path)
  const all = flat(root)
  const one = (found: Found[]): Found | null => (found.length === 1 ? found[0]! : null)
  return (
    one(all.filter((f) => key(f.path) === want)) ??
    one(all.filter((f) => key(f.path).endsWith('/' + want))) ??
    one(all.filter((f) => f.kind === 'item' && loose(f.item.name) === loose(path[path.length - 1]!)))
  )
}
