/**
 * The page's tab shell.
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
 */

export interface Tab {
  /** the name in the URL fragment, so a tab is linkable */
  id: string
  label: string
  /** the panel element, built once by the caller and never replaced */
  panel: HTMLElement
  /** the tab has just become visible */
  show?(): void
  /** the tab is visible and the page is redrawing */
  frame?(): void
}

export interface TabHost {
  select(id: string): void
  readonly active: string
  /** redraw whichever panel is showing; call from the page's own loop */
  frame(): void
}

export function mountTabs(bar: HTMLElement, tabs: readonly Tab[]): TabHost {
  if (tabs.length === 0) throw new Error('mountTabs needs at least one tab')
  const buttons = new Map<string, HTMLButtonElement>()
  let active = tabs[0]!.id

  bar.setAttribute('role', 'tablist')
  for (const tab of tabs) {
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

  function select(id: string): void {
    const tab = tabs.find((t) => t.id === id)
    if (!tab || id === active) return
    active = id
    paint()
    // replaceState rather than assigning location.hash: a tab switch is not a
    // navigation, and filling the back button with them is worse than useless
    history.replaceState(null, '', `#${id}`)
    tab.show?.()
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

  const fromHash = location.hash.replace(/^#/, '')
  if (tabs.some((t) => t.id === fromHash)) active = fromHash
  paint()
  tabs.find((t) => t.id === active)?.show?.()

  return {
    select,
    get active() {
      return active
    },
    frame() {
      tabs.find((t) => t.id === active)?.frame?.()
    },
  }
}
