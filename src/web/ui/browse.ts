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
import type { Library, LibraryDisk, LibraryItem } from '../../cli/genlibrary'

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

/** the bytes of one disk, ready to mount */
export interface FetchedDisk {
  /** the host filename, which is what the player mangles a volume name out of */
  name: string
  bytes: Uint8Array
  disk: LibraryDisk
}

export interface BrowseOptions {
  /**
   * Every disk of the item, in insertion order: the first is the one that
   * goes in DF0:. Called after all of them have arrived, so a set is mounted
   * whole or not at all.
   */
  onOpen(item: LibraryItem, disks: FetchedDisk[]): void | Promise<void>
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

/**
 * The line under a card's name: what you get when you click it.
 *
 * Every figure here was read out of the disks by the indexer. The library
 * holds files and no metadata beside them, so there is nothing to say about
 * an item that the item does not say about itself.
 */
function factsFor(item: LibraryItem): string {
  const bytes = item.disks.reduce((n, d) => n + d.size, 0)
  const programs = item.disks.reduce((n, d) => n + d.programs, 0)
  const bits = [item.disks.length === 1 ? '1 disk' : `${item.disks.length} disks`, sizeText(bytes)]
  if (programs > 0) bits.push(programs === 1 ? '1 program' : `${programs} programs`)
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

  function card(item: LibraryItem): HTMLElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'card'
    // the labels the disks answer to once mounted, which is what a program
    // written to load `MyDisk:pic.iff` needs to be right
    b.title = item.disks.map((d) => (d.label === null || d.label === '' ? d.path : `${d.label}:`)).join(' ')

    const art = document.createElement('div')
    art.className = 'card-art'
    if (item.image === null) {
      // No cover yet is a normal state. A game belongs in the library
      // before somebody has grabbed a screenshot of it, so the tile says
      // what it is rather than showing a broken image.
      const none = document.createElement('span')
      none.className = 'card-noart'
      none.textContent = item.name
      art.appendChild(none)
    } else {
      const img = document.createElement('img')
      img.src = urlFor(base, item.image)
      img.alt = ''
      img.loading = 'lazy'
      // the whole page is one grid of these, and a missing file would
      // otherwise leave the browser's broken-image glyph in the middle of it
      img.addEventListener('error', () => art.classList.add('card-noimg'))
      art.appendChild(img)
    }
    b.appendChild(art)

    const name = document.createElement('span')
    name.className = 'card-name'
    name.textContent = item.name
    b.appendChild(name)

    const facts = document.createElement('span')
    facts.className = 'card-facts'
    facts.textContent = factsFor(item)
    b.appendChild(facts)

    b.addEventListener('click', () => void open(item))
    return b
  }

  async function open(item: LibraryItem): Promise<void> {
    if (opening) return
    opening = true
    try {
      const disks: FetchedDisk[] = []
      for (const [i, d] of item.disks.entries()) {
        opts.onStatus(`fetching ${item.name}, disk ${i + 1} of ${item.disks.length} (${sizeText(d.size)})`)
        const r = await get(urlFor(base, d.path))
        if (!r.ok) throw new Error(`${d.path}: HTTP ${r.status}`)
        const bytes = new Uint8Array(await r.arrayBuffer())
        // The index recorded the size when it opened the image. A short read
        // here mounts as an empty or damaged disk, which looks like a broken
        // emulator rather than a broken download, so it is caught by name.
        if (bytes.length !== d.size) {
          throw new Error(`${d.path}: got ${bytes.length} bytes, the index says ${d.size}`)
        }
        disks.push({ name: d.path.split('/').pop() ?? d.path, bytes, disk: d })
      }
      await opts.onOpen(item, disks)
    } catch (e) {
      opts.onStatus(`could not load ${item.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      opening = false
    }
  }

  function render(library: Library): void {
    host.textContent = ''
    if (library.version !== 1) {
      message(`this page reads library index version 1 and the server sent ${library.version}`, 'bad')
      return
    }
    if (library.groups.length === 0) {
      message('the library is empty')
      return
    }
    for (const group of library.groups) {
      const section = document.createElement('section')
      section.className = 'browse-group'
      const h = document.createElement('h2')
      if (group.image !== null) {
        // small, because the item covers are what you are choosing between;
        // this only says which shelf you are looking at
        const thumb = document.createElement('img')
        thumb.className = 'browse-thumb'
        thumb.src = urlFor(base, group.image)
        thumb.alt = ''
        thumb.addEventListener('error', () => thumb.remove())
        h.appendChild(thumb)
      }
      h.appendChild(document.createTextNode(group.name))
      section.appendChild(h)
      const grid = document.createElement('div')
      grid.className = 'browse-grid'
      for (const item of group.items) grid.appendChild(card(item))
      section.appendChild(grid)
      host.appendChild(section)
    }
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
