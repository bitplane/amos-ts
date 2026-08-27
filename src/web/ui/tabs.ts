/**
 * The page's tab shell, and the address bar under it.
 *
 * ## Tabs are visibility, never mounting
 *
 * A program keeps running while you are looking at another tab, so switching
 * cannot tear a panel down: the canvas would lose its context and the machine
 * would lose the frame loop. Every panel is built once and stays in the
 * document, and switching sets the `hidden` attribute. The obvious
 * implementation, swapping innerHTML, is the one thing this file exists to
 * prevent.
 *
 * `frame()` is the exception a redraw needs. It fires only on the visible
 * panel, because a hardware table nobody is looking at costs the same to
 * rebuild as one somebody is.
 *
 * ## The fragment is a tab and a path
 *
 * `#play/bitplane-net/egg-it` is the Play tab showing that disk. The first
 * segment picks the tab and the rest is the tab's own business, handed to it
 * through `route()`; ../route.ts says what the rest means. A first segment
 * that names no tab is not an error, it is a path: `#egg-it` routes to
 * whichever tab is showing, so a link somebody typed from memory still lands.
 *
 * Which history call is used says what happened. Switching tab is
 * `replaceState`, because a tab is a view of one page and filling the back
 * button with view changes is worse than useless. Opening a disk or a folder
 * is `pushState`, because that IS somewhere you came from, and back should
 * take you off it. Neither reloads, which is the whole reason the fragment
 * carries this and a query string does not: the mounted volumes and whatever
 * is running survive a link.
 *
 * `hashchange` is the only listener. Everything this file writes goes through
 * push/replaceState, which does not fire it, so the event means the reader
 * did it: the back button, or typing in the address bar. `popstate` would
 * miss the typed one, which is a navigation rather than a traversal.
 */

import { joinFragment, splitFragment } from '../route'

export interface Tab {
  /** the name in the URL fragment, so a tab is linkable */
  id: string
  label: string
  /** the panel element, built once by the caller and never replaced */
  panel: HTMLElement
  /**
   * The tab has just become visible, at the path the fragment says.
   *
   * The path is empty for a bare `#browse`, which is a real instruction and
   * not a missing one: it is where the back button lands after walking into
   * a folder, and a tab that ignored it would show that folder under a URL
   * that says the root.
   */
  show?(path: readonly string[]): void
  /** the tab is visible and the page is redrawing */
  frame?(): void
  /**
   * The fragment names a path under this tab: a link, or the back button.
   *
   * Called with the tab already showing, and with an empty array when the
   * fragment is the bare tab name. Never called for a path this tab put in
   * the address bar itself, so a tab does not have to guard against
   * reopening what it has just opened.
   */
  route?(path: string[]): void
}

export interface TabHost {
  select(id: string): void
  /**
   * Show a tab AND a path under it, leaving a history entry behind.
   *
   * For the click that opens a disk or walks into a folder. The path is
   * remembered per tab, so switching to Hardware and back returns to the
   * link you were on rather than to the bare tab.
   */
  go(id: string, path: readonly string[], mode?: 'push' | 'replace'): void
  /**
   * Say what a tab's path is without going there or writing history.
   *
   * Play and Files are two views of one open disk, and only one of them is
   * landed on. Without this the other keeps the disk before it, and clicking
   * across to it puts a link to that older disk in the address bar under the
   * one that is actually running.
   */
  remember(id: string, path: readonly string[]): void
  readonly active: string
  /** the path under the tab that is showing */
  readonly path: readonly string[]
  /** redraw whichever panel is showing; call from the page's own loop */
  frame(): void
}

export function mountTabs(bar: HTMLElement, tabs: readonly Tab[]): TabHost {
  if (tabs.length === 0) throw new Error('mountTabs needs at least one tab')
  const buttons = new Map<string, HTMLButtonElement>()
  let active = tabs[0]!.id
  /** the path each tab was last on, so coming back to it comes back to that */
  const paths = new Map<string, readonly string[]>()

  bar.setAttribute('role', 'tablist')
  for (const tab of tabs) {
    /*
     * The separator is a real element, not a `::before` on the button.
     *
     * It reads `[Play|Hardware|…]`, and the selected tab inverts. A generated
     * pipe would sit inside the button it is generated on, so the inversion
     * would paint straight through it and the bar would show a blue block
     * with a pipe stranded in the middle of it. `aria-hidden` keeps the
     * punctuation out of the tablist, which is the only reason to prefer
     * generated content here and is cheaper to buy this way.
     */
    if (buttons.size > 0) {
      const sep = document.createElement('span')
      sep.className = 'slash tab-sep'
      sep.textContent = '|'
      sep.setAttribute('aria-hidden', 'true')
      bar.appendChild(sep)
    }
    const b = document.createElement('button')
    b.className = 'tab'
    b.type = 'button'
    b.id = `tab-${tab.id}`
    b.textContent = tab.label
    b.setAttribute('role', 'tab')
    b.addEventListener('click', () => select(tab.id))
    bar.appendChild(b)
    buttons.set(tab.id, b)

    tab.panel.classList.add('panel')
    tab.panel.setAttribute('role', 'tabpanel')
    tab.panel.setAttribute('aria-labelledby', b.id)
  }

  function paint(): void {
    for (const tab of tabs) {
      const on = tab.id === active
      tab.panel.hidden = !on
      const b = buttons.get(tab.id)!
      b.setAttribute('aria-selected', String(on))
      // only the selected tab is in the tab order; arrow keys move within it
      b.tabIndex = on ? 0 : -1
    }
  }

  /** what the address bar should read for a tab and its remembered path */
  function fragment(id: string): string {
    return joinFragment([id, ...(paths.get(id) ?? [])])
  }

  function select(id: string): void {
    const tab = tabs.find((t) => t.id === id)
    if (!tab || id === active) return
    active = id
    paint()
    // replaceState rather than assigning location.hash: a tab switch is not a
    // navigation, and filling the back button with them is worse than useless
    history.replaceState(null, '', fragment(id))
    tab.show?.(paths.get(id) ?? [])
  }

  function go(id: string, path: readonly string[], mode: 'push' | 'replace' = 'push'): void {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const was = location.hash
    paths.set(id, [...path])
    if (id !== active) {
      active = id
      paint()
      tab.show?.(path)
    }
    const now = fragment(id)
    // Same place, so no entry: clicking the disk that is already loaded
    // should not need two presses of the back button to leave it.
    if (now === was) return
    if (mode === 'push') history.pushState(null, '', now)
    // `replace` is for the link that has just been tidied into its canonical
    // spelling. The reader is standing on that entry, and pushing would put
    // their typo behind them for the back button to run again.
    else history.replaceState(null, '', now)
  }

  /**
   * The reader changed the fragment: back, forward, or typed it.
   *
   * An unknown first segment is a path rather than a mistake, so `#egg-it`
   * asks the tab that is showing to find Egg It. A tab that has no `route`
   * gets `show()` instead, which is what a bare `#hardware` has always done.
   */
  function fromHash(): void {
    const segs = splitFragment(location.hash)
    const named = segs.length > 0 && tabs.some((t) => t.id === segs[0])
    const id = named ? segs[0]! : active
    const path = named ? segs.slice(1) : segs
    const tab = tabs.find((t) => t.id === id)!
    paths.set(id, path)
    if (id !== active) {
      active = id
      paint()
    }
    if (path.length > 0 && tab.route) tab.route(path)
    else tab.show?.(path)
  }

  // arrow keys along the bar, which is what a tablist is expected to do
  bar.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const i = tabs.findIndex((t) => t.id === active)
    const next = tabs[(i + step + tabs.length) % tabs.length]!
    select(next.id)
    buttons.get(next.id)!.focus()
  })

  addEventListener('hashchange', fromHash)

  const boot = splitFragment(location.hash)
  if (boot.length > 0 && tabs.some((t) => t.id === boot[0])) {
    active = boot[0]!
    paths.set(active, boot.slice(1))
  } else if (boot.length > 0) {
    paths.set(active, boot)
  }
  paint()
  const opened = tabs.find((t) => t.id === active)!
  const bootPath = paths.get(active) ?? []
  // `route` and not `show` when there is a path: the tab is about to be sent
  // somewhere, and showing it first paints the library index behind a disk
  // that is already being fetched.
  if (bootPath.length > 0 && opened.route) opened.route([...bootPath])
  else opened.show?.(bootPath)

  return {
    select,
    go,
    remember(id: string, path: readonly string[]): void {
      if (tabs.some((t) => t.id === id)) paths.set(id, [...path])
      // and the address bar, when it is this tab's own path that changed
      if (id === active) history.replaceState(null, '', fragment(id))
    },
    get active() {
      return active
    },
    get path() {
      return paths.get(active) ?? []
    },
    frame() {
      tabs.find((t) => t.id === active)?.frame?.()
    },
  }
}
