/**
 * Tabs inside a row, for a file that is several things at once.
 *
 * An `.AMOS` is a listing AND the banks beside it, and a bank is a picture or
 * a sprite sheet or a set of samples or a module. One body cannot show that,
 * and picking the "main" one would be choosing for the reader: a game whose
 * interesting part is its music is as common as one whose interesting part is
 * its code.
 *
 * Deliberately not `./tabs.ts`. That file is the PAGE's tab bar and owns the
 * address bar, history and panel visibility for the whole document; there is
 * one of it and it is a singleton in everything but name. This is a widget,
 * there is one per open row, and it knows nothing about URLs.
 *
 * A view is mounted the first time it is looked at and kept afterwards.
 * Decoding forty sprites or detokenising a 900-line program is not work to
 * repeat every time somebody clicks back and forth, and it is not work to do
 * at all for a tab nobody opens.
 */

export interface View {
  /** stable within one file, so the chosen tab survives a redraw */
  id: string
  label: string
  /** how many things are in it, shown beside the label when it is worth saying */
  count?: number
  /** fills the panel, called once */
  mount(host: HTMLElement): void
}

export interface Viewer {
  /** which tab is showing, for a caller that wants to put it back */
  readonly active: string
  show(id: string): void
}

export function createViewer(host: HTMLElement, views: readonly View[], startAt?: string): Viewer {
  const wrap = document.createElement('div')
  wrap.className = 'vw'
  const bar = document.createElement('div')
  bar.className = 'vw-tabs'
  bar.setAttribute('role', 'tablist')
  const panel = document.createElement('div')
  panel.className = 'vw-panel'
  wrap.append(bar, panel)
  host.appendChild(wrap)

  /** the mounted element of each view, once it has been looked at */
  const built = new Map<string, HTMLElement>()
  const buttons = new Map<string, HTMLButtonElement>()
  let active = ''

  function show(id: string): void {
    const view = views.find((v) => v.id === id)
    if (!view) return
    active = id
    for (const [key, b] of buttons) b.classList.toggle('on', key === id)
    for (const [key, el] of built) el.hidden = key !== id
    if (!built.has(id)) {
      const el = document.createElement('div')
      built.set(id, el)
      panel.appendChild(el)
      // After the element is in the map and in the document: a view that
      // throws while decoding a damaged bank must not take the tab bar down
      // with it, and it leaves an empty panel rather than a broken row.
      try {
        view.mount(el)
      } catch (e) {
        el.textContent = `this would not decode: ${e instanceof Error ? e.message : String(e)}`
        el.className = 'vw-bad'
      }
    }
  }

  for (const v of views) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'vw-tab'
    b.setAttribute('role', 'tab')
    b.textContent = v.count === undefined ? v.label : `${v.label} ${v.count}`
    b.addEventListener('click', (e) => {
      // the viewer lives inside a <summary>'s disclosure body, and a click
      // that reached the row would fold the whole thing shut
      e.preventDefault()
      e.stopPropagation()
      show(v.id)
    })
    buttons.set(v.id, b)
    bar.appendChild(b)
  }

  // One view needs no bar: a hex dump with a single tab above it is a tab bar
  // apologising for itself.
  if (views.length < 2) bar.hidden = true

  const first = startAt !== undefined && views.some((v) => v.id === startAt) ? startAt : views[0]?.id
  if (first !== undefined) show(first)

  return {
    get active(): string {
      return active
    },
    show,
  }
}
