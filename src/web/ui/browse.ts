/**
 * The Browse tab: the disk library, as covers you can click.
 *
 * The disks come from bitplane/amos-library and are published to
 * `/library/` on the same site by that repository's own job, not by a release
 * of the player. So this fetches an index it did not build and cannot assume
 * is there: the tab has to be readable when the fetch 404s, which is what
 * every local checkout looks like until the dev server is pointed at a
 * library.
 *
 * The index is written by ../../cli/genlibrary.ts, and the TYPES come from
 * there. That import must stay `import type`. genlibrary opens `node:fs`,
 * and a value import would pull it into the browser bundle.
 *
 * Every folder and every disk here is linkable, so this tab both READS a
 * path out of the address bar (`route`) and says when the reader has walked
 * to a new one (`onFolder`, `onOpen`). It never writes the address bar
 * itself: what the fragment should say depends on which tab you end up on,
 * and only ../main.ts knows that. ../route.ts holds the matching rules.
 */
import type { Library, LibraryFolder, LibraryItem } from '../../cli/genlibrary'
import { canonical, resolve } from '../route'
import { popupMenu } from './menu'

/**
 * Where the library is served from.
 *
 * An absolute path, deliberately. The player's own assets are relative
 * (`base: './'`) because the same bundle is published to `/`, `/v/latest/`
 * and `/v/<x.y.z>/`. The library is published ONCE, so a relative
 * `library/` would have `/v/0.9.1/` fetching `/v/0.9.1/library/index.json`
 * and getting nothing. Substituted at build time so a fork serving the site
 * from a subdirectory can say where its own copy lives.
 */
declare const __AMOS_LIBRARY__: string | undefined
export const LIBRARY_BASE: string = typeof __AMOS_LIBRARY__ === 'string' ? __AMOS_LIBRARY__ : '/library/'

/**
 * How a disk or a folder came to be opened, which decides what the address
 * bar does about it.
 *
 * `click` is the reader walking the library, and that is somewhere to come
 * back FROM: it gets a history entry. `link` is a fragment that already says
 * this, arriving from a link, a bookmark or the back button, and it gets the
 * entry it is already standing on rewritten with the tidy spelling. Pushing
 * there would put the reader's typo behind them in the history and re-run
 * the disk when they pressed back.
 */
export type Via = 'click' | 'link'

export interface BrowseOptions {
  /**
   * The item's bytes, once they have arrived. `drive` is set only when the
   * reader picked one off the right-click menu; without it the disk goes in
   * DF0: and is mounted under its own label like anything else.
   */
  onOpen(item: LibraryItem, bytes: Uint8Array, how: { drive?: number; via: Via }): void | Promise<void>
  /** the reader walked into a folder; `path` is what a link to it says */
  onFolder?(path: readonly string[]): void
  /** what is in each drive now, for the menu to show */
  drives(): readonly (string | null)[]
  onStatus(text: string): void
  /** overridden by the tests, which have no server */
  fetch?: typeof globalThis.fetch
  base?: string
}

/** what a fragment turned out to name, and where the tab now is */
export interface Routed {
  kind: 'item' | 'folder'
  /** the canonical spelling of what was found, for the address bar */
  path: string[]
  /** the folder the tab is showing, which for a disk is the shelf it is on */
  folder: string[]
}

export interface BrowseTab {
  panel: HTMLElement
  /**
   * The tab is showing, at the path the fragment says. Fetches the index the
   * first time; an empty path afterwards is the root of the library, which
   * is what the back button out of a folder means.
   */
  show(path?: readonly string[]): void
  /**
   * Go where a fragment says, fetching the index first if this is the first
   * thing the page does. Answers what it found, because a link naming a disk
   * hands over to the player and a link naming a folder or naming nothing in
   * the library stays here, and only the caller can switch tabs.
   */
  route(path: readonly string[]): Promise<Routed | null>
}

/** `AMOS/AMOS 3D.png` -> a URL, with the spaces and the rest escaped */
function urlFor(base: string, path: string): string {
  return base + path.split('/').map(encodeURIComponent).join('/')
}

/** 901120 -> "880K", because that is what the disk was called */
function sizeText(bytes: number): string {
  const k = bytes / 1024
  return k >= 1024 ? `${(k / 1024).toFixed(1)}M` : `${Math.round(k)}K`
}

/**
 * The volume label a disk answers to once mounted, which is what a program
 * written to load `MyDisk:pic.iff` needs to be right. Shown on hover, so a
 * wrong one is visible before anybody clicks.
 */
function titleFor(item: LibraryItem): string {
  const d = item.disk
  return d.label === null || d.label === '' ? d.path : `${d.label}:`
}

/**
 * The line under a card's name: what you get when you click it.
 *
 * Every figure here was read out of the disks by the indexer. The library
 * holds files and no metadata beside them, so there is nothing to say about
 * an item that the item does not say about itself.
 */
function factsFor(item: LibraryItem): string {
  const d = item.disk
  const bits = [sizeText(d.size)]
  if (d.filesystem !== null) bits.push(d.filesystem)
  if (d.bootable) bits.push('boots')
  if (d.programs > 0) bits.push(d.programs === 1 ? '1 program' : `${d.programs} programs`)
  return bits.join(' · ')
}

export function createBrowseTab(opts: BrowseOptions): BrowseTab {
  const base = opts.base ?? LIBRARY_BASE
  const get = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const panel = document.createElement('div')

  const host = document.createElement('div')
  panel.appendChild(host)

  let state: 'idle' | 'loading' | 'done' = 'idle'
  /** the index once it has arrived; what a link is resolved against */
  let root: LibraryFolder | null = null
  /** the fetch in flight, so a link and a tab switch share the one request */
  let inFlight: Promise<void> | null = null
  /** one item at a time: a second click while disks are in flight is ignored */
  let opening = false

  function message(text: string, tone?: 'bad'): void {
    host.textContent = ''
    const p = document.createElement('p')
    p.className = tone === 'bad' ? 'browse-empty bad' : 'browse-empty'
    p.textContent = text
    host.appendChild(p)
  }

  /**
   * One tile. A folder and an item look the same on purpose: they are both
   * "a picture with a name under it", and what tells them apart is what
   * happens when you click, which the facts line says.
   */
  function tile(
    name: string,
    image: string | null,
    facts: string,
    title: string,
    go: () => void,
    menu?: (e: MouseEvent) => void,
  ): HTMLElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'card'
    b.title = title
    if (menu) {
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        menu(e)
      })
    }

    const art = document.createElement('div')
    art.className = 'card-art'
    if (image === null) {
      // No picture anywhere above it is a normal state. A game belongs in the
      // library before somebody has grabbed a screenshot of it, so the tile
      // says what it is rather than showing a broken image.
      const none = document.createElement('span')
      none.className = 'card-noart'
      none.textContent = name
      art.appendChild(none)
    } else {
      const img = document.createElement('img')
      img.src = urlFor(base, image)
      img.alt = ''
      img.loading = 'lazy'
      // the whole page is one grid of these, and a missing file would
      // otherwise leave the browser's broken-image glyph in the middle of it
      img.addEventListener('error', () => art.classList.add('card-noimg'))
      art.appendChild(img)
    }
    b.appendChild(art)

    const label = document.createElement('span')
    label.className = 'card-name'
    label.textContent = name
    b.appendChild(label)

    const line = document.createElement('span')
    line.className = 'card-facts'
    line.textContent = facts
    b.appendChild(line)

    b.addEventListener('click', go)
    return b
  }

  /**
   * The drive menu for one disk.
   *
   * Only a disk image gets one: an archive has no label and no filesystem, so
   * there is no drive for it to go in.
   */
  function driveMenu(e: MouseEvent, item: LibraryItem): void {
    if (!/\.adf$/i.test(item.disk.path)) return
    const inside = opts.drives()
    popupMenu(
      e.clientX,
      e.clientY,
      inside.map((held, unit) => ({
        label: `Put in DF${unit}:`,
        detail: held ?? 'empty',
        run: () => void open(item, 'click', unit),
      })),
    )
  }

  /** how many items are under a folder, counting every folder below it */
  function itemsUnder(folder: LibraryFolder): number {
    return folder.items.length + folder.folders.reduce((n, f) => n + itemsUnder(f), 0)
  }

  async function open(item: LibraryItem, via: Via, drive?: number): Promise<void> {
    if (opening) return
    opening = true
    try {
      const d = item.disk
      opts.onStatus(`fetching ${item.name} (${sizeText(d.size)})`)
      const r = await get(urlFor(base, d.path))
      if (!r.ok) throw new Error(`${d.path}: HTTP ${r.status}`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      // The index recorded the size when it opened the file. A short read
      // here mounts as an empty or damaged disk, which looks like a broken
      // emulator rather than a broken download, so it is caught by name.
      if (bytes.length !== d.size) {
        throw new Error(`${d.path}: got ${bytes.length} bytes, the index says ${d.size}`)
      }
      await opts.onOpen(item, bytes, { ...(drive === undefined ? {} : { drive }), via })
    } catch (e) {
      opts.onStatus(`could not load ${item.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      opening = false
    }
  }

  /**
   * Where you are: the root, then every folder opened since.
   *
   * A stack rather than a path string, because the breadcrumb needs the
   * folders themselves and popping to any depth is then a `slice`.
   */
  let here: LibraryFolder[] = []

  function breadcrumb(): HTMLElement {
    const nav = document.createElement('nav')
    nav.className = 'crumbs'
    here.forEach((folder, i) => {
      if (i > 0) {
        const sep = document.createElement('span')
        sep.className = 'slash'
        sep.textContent = '/'
        sep.setAttribute('aria-hidden', 'true')
        nav.appendChild(sep)
      }
      const last = i === here.length - 1
      const el = document.createElement(last ? 'span' : 'a')
      // the root folder is the library itself and has no name of its own
      el.textContent = folder.name === '' ? 'library' : folder.name
      if (!last) el.addEventListener('click', () => walk(here.slice(0, i + 1)))
      nav.appendChild(el)
    })
    return nav
  }

  /** the link to a folder: the root has no name, so the path starts below it */
  function pathOf(stack: readonly LibraryFolder[]): string[] {
    return stack.slice(1).map((f) => canonical(f.name))
  }

  /**
   * The reader clicked a folder, which is both a render and a place to be.
   *
   * `enter` paints and nothing else, so routing can put the tab somewhere
   * without the address bar hearing about a move it made itself.
   */
  function walk(stack: LibraryFolder[]): void {
    enter(stack)
    opts.onFolder?.(pathOf(stack))
  }

  /** show a folder: its subfolders first, then the disks in it */
  function enter(stack: LibraryFolder[]): void {
    here = stack
    const folder = stack[stack.length - 1]!
    host.textContent = ''
    // Always, root included. A breadcrumb that appears at the second level
    // moves everything below it down by its own height the moment you click
    // a folder, which is a special case paid for in the reader's eyes.
    host.appendChild(breadcrumb())

    const grid = document.createElement('div')
    grid.className = 'browse-grid'
    for (const sub of folder.folders) {
      const n = itemsUnder(sub)
      grid.appendChild(
        tile(sub.name, sub.image, n === 1 ? '1 disk' : `${n} disks`, `open ${sub.name}`, () => walk([...stack, sub])),
      )
    }
    for (const item of folder.items) {
      grid.appendChild(
        tile(
          item.name,
          item.image,
          factsFor(item),
          titleFor(item),
          () => void open(item, 'click'),
          (e) => driveMenu(e, item),
        ),
      )
    }
    host.appendChild(grid)
    if (folder.folders.length === 0 && folder.items.length === 0) message('nothing in here')
  }

  function render(library: Library): void {
    host.textContent = ''
    // Read what you are given. The player and the library publish from
    // different repositories on different triggers, so an index written by an
    // older generator is a normal few minutes, not a fault. Say what is
    // happening and let it fix itself.
    root = (library?.root as LibraryFolder | undefined) ?? null
    if (!root) {
      message('the published library index is older than this page; it updates when the library next publishes')
      return
    }
    if (root.folders.length === 0 && root.items.length === 0) {
      message('the library is empty')
      return
    }
    enter([root])
  }

  async function load(): Promise<void> {
    state = 'loading'
    message('loading the library…')
    const url = urlFor(base, 'index.json')
    try {
      const r = await get(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      render((await r.json()) as Library)
      state = 'done'
    } catch (e) {
      // Naming the URL matters more than it looks: the library is published
      // by a different repository, so "there is no library here" and "the
      // player is looking in the wrong place" are both real and this is what
      // tells them apart.
      message(`no library at ${url} (${e instanceof Error ? e.message : String(e)})`, 'bad')
      state = 'idle'
    }
  }

  /**
   * The index, fetched at most once and shared.
   *
   * A link to a disk and the tab becoming visible both want it, and at boot
   * they happen within a frame of each other. Two fetches would be two
   * renders, and the second would drop the reader back at the root of the
   * library while the first was still opening what they asked for.
   */
  function ready(): Promise<void> {
    if (state === 'done') return Promise.resolve()
    if (inFlight === null) inFlight = load().finally(() => (inFlight = null))
    return inFlight
  }

  return {
    panel,
    show(path = []): void {
      // Once, on the first visit. Not at page load, because the tab may
      // never be opened, and not on every visit, because the index does not
      // change while the page is up.
      if (state === 'idle') {
        void ready()
        return
      }
      // Back out of a folder, to a fragment that names none. Only when the
      // index is already here: a bare `#play` must not drag the library down
      // behind a tab nobody has opened.
      if (path.length === 0 && root !== null) enter([root])
    },
    async route(path): Promise<Routed | null> {
      await ready()
      if (root === null) return null
      const found = resolve(root, path)
      if (found === null) {
        // Say what was asked for, not just that it failed. A link that has
        // outlived the disk it named and a link with a folder missing off
        // the front look identical from the reader's side, and the name they
        // typed is the one thing that tells them which they are looking at.
        opts.onStatus(`nothing in the library called ${path.join('/')}`)
        enter([root])
        return null
      }
      // The folder goes up first either way. For a disk that means the shelf
      // it came off is behind the player, so leaving the game lands there
      // rather than back at the root of the library.
      enter(found.stack)
      const folder = pathOf(found.stack)
      if (found.kind === 'folder') return { kind: 'folder', path: found.path, folder }
      await open(found.item, 'link')
      return { kind: 'item', path: found.path, folder }
    },
  }
}
