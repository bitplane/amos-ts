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
 */
import type { Library, LibraryFolder, LibraryItem } from '../../cli/genlibrary'

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

export interface BrowseOptions {
  /** the item's bytes, once they have arrived */
  onOpen(item: LibraryItem, bytes: Uint8Array): void | Promise<void>
  onStatus(text: string): void
  /** overridden by the tests, which have no server */
  fetch?: typeof globalThis.fetch
  base?: string
}

export interface BrowseTab {
  panel: HTMLElement
  /** fetch the index if it has not been fetched yet */
  show(): void
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

/** the index shape this page knows how to read */
const VERSION = 3

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

  const intro = document.createElement('p')
  intro.className = 'panel-intro'
  intro.textContent =
    'Disks from the library. Click one and it goes into the drives under its own volume label. A disk holding a single program starts it; anything else drops you in the file tree to pick from. Nothing is fetched until you ask for it.'
  panel.appendChild(intro)

  const host = document.createElement('div')
  panel.appendChild(host)

  let state: 'idle' | 'loading' | 'done' = 'idle'
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
  function tile(name: string, image: string | null, facts: string, title: string, go: () => void): HTMLElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'card'
    b.title = title

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

  /** how many items are under a folder, counting every folder below it */
  function itemsUnder(folder: LibraryFolder): number {
    return folder.items.length + folder.folders.reduce((n, f) => n + itemsUnder(f), 0)
  }

  async function open(item: LibraryItem): Promise<void> {
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
      await opts.onOpen(item, bytes)
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
      if (!last) el.addEventListener('click', () => enter(here.slice(0, i + 1)))
      nav.appendChild(el)
    })
    return nav
  }

  /** show a folder: its subfolders first, then the disks in it */
  function enter(stack: LibraryFolder[]): void {
    here = stack
    const folder = stack[stack.length - 1]!
    host.textContent = ''
    if (stack.length > 1) host.appendChild(breadcrumb())

    const grid = document.createElement('div')
    grid.className = 'browse-grid'
    for (const sub of folder.folders) {
      const n = itemsUnder(sub)
      grid.appendChild(
        tile(sub.name, sub.image, n === 1 ? '1 disk' : `${n} disks`, `open ${sub.name}`, () => enter([...stack, sub])),
      )
    }
    for (const item of folder.items) {
      grid.appendChild(tile(item.name, item.image, factsFor(item), titleFor(item), () => void open(item)))
    }
    host.appendChild(grid)
    if (folder.folders.length === 0 && folder.items.length === 0) message('nothing in here')
  }

  function render(library: Library): void {
    host.textContent = ''
    if (library.version !== VERSION) {
      message(`this page reads library index version ${VERSION} and the server sent ${library.version}`, 'bad')
      return
    }
    const root = library.root
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

  return {
    panel,
    show(): void {
      // Once, on the first visit. Not at page load, because the tab may
      // never be opened, and not on every visit, because the index does not
      // change while the page is up.
      if (state === 'idle') void load()
    },
  }
}
