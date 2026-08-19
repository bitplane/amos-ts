/**
 * A popup menu, for the one thing a click cannot say: WHICH.
 *
 * Left-clicking a disk puts it in the first free drive, which is the answer
 * nine times in ten. A two-disk game is the tenth: you want disk 2 in DF1:
 * whatever is in DF0:, and there is nowhere in a single click to say so.
 *
 * Built and destroyed per use rather than kept hidden, because a menu holds
 * closures over the thing that was clicked and a stale one would act on the
 * wrong disk. One at a time: opening a second closes the first.
 */

export interface MenuItem {
  label: string
  /** the greyed half of the row: what is in the drive already, and so on */
  detail?: string
  disabled?: boolean
  run(): void
}

let open: (() => void) | null = null

/** close whatever is up, if anything */
export function closeMenu(): void {
  open?.()
}

/**
 * Put a menu at a point on the page.
 *
 * `x`/`y` are viewport coordinates, which is what a MouseEvent gives, so the
 * menu is positioned `fixed` and needs no scroll arithmetic. It is nudged
 * back inside the window when it would hang off the right or the bottom.
 */
export function popupMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeMenu()
  if (items.length === 0) return

  const el = document.createElement('div')
  el.className = 'menu'
  el.setAttribute('role', 'menu')

  for (const item of items) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'menu-item'
    row.setAttribute('role', 'menuitem')
    row.disabled = item.disabled ?? false
    const label = document.createElement('span')
    label.textContent = item.label
    row.appendChild(label)
    if (item.detail !== undefined) {
      const detail = document.createElement('span')
      detail.className = 'menu-detail'
      detail.textContent = item.detail
      row.appendChild(detail)
    }
    row.addEventListener('click', () => {
      closeMenu()
      item.run()
    })
    el.appendChild(row)
  }

  document.body.appendChild(el)
  // measured after it is in the document, because a menu that has not been
  // laid out has no width to keep on the screen with
  const r = el.getBoundingClientRect()
  el.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 4))}px`
  el.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 4))}px`

  const away = (e: Event): void => {
    if (!el.contains(e.target as Node)) closeMenu()
  }
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeMenu()
  }
  // `capture`, so a click on something that stops propagation still shuts it
  document.addEventListener('mousedown', away, true)
  document.addEventListener('keydown', key, true)
  window.addEventListener('blur', closeMenu)

  open = () => {
    open = null
    document.removeEventListener('mousedown', away, true)
    document.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', closeMenu)
    el.remove()
  }
}
