/**
 * The disclosure list, shared by every tab that lists things.
 *
 * Hardware and Libs put one row's worth of detail in the body. The demos tab
 * will put a grid of tiles in the same place, which is why the body is a
 * callback handed an empty element rather than anything this file understands.
 *
 * ## Why open state lives here
 *
 * These lists redraw from the model, not from themselves — `machine.hardware()`
 * is a view, so the honest way to show a drive that just started spinning is to
 * ask again and rebuild. Rebuilding a `<details>` loses whether it was open, so
 * the open keys are held here and reapplied. It is the same trick the files
 * tree already plays with `openDirs`, for the same reason.
 */

/** what a chip means, and it only ever means state */
export type Tone = 'none' | 'on' | 'warn' | 'bad' | 'fixed'

export interface Action {
  label: string
  title?: string
  disabled?: boolean
  run(): void
}

/** one entry in a row's drop-down */
export interface Choice {
  /** stable, and what `current` names */
  id: string
  label: string
  run(): void
}

export interface RowSpec {
  /** stable across redraws: it is what remembers the row was open */
  key: string
  /** one glyph in a column of its own, so the labels stay in line */
  icon?: string
  label: string
  /** the second column: what is in the slot, or what the library answers */
  detail?: string
  /** the detail describes an empty socket rather than a thing */
  empty?: boolean
  chip?: { text: string; tone?: Tone }
  actions?: readonly Action[]
  /**
   * What is in this slot, as a drop-down of everything that could be.
   *
   * One control instead of attach and detach both, because they were always
   * the same action: emptying a socket is choosing "nothing" from the list,
   * and a socket with no "nothing" in its list is one that cannot be emptied.
   * `current` is the option in effect, or `''` when it is none of them.
   */
  choose?: { current: string; options: readonly Choice[] }
  /** fills the disclosure body. A row with no body does not open. */
  body?(host: HTMLElement): void
}

export interface List {
  render(rows: readonly RowSpec[]): void
}

function button(a: Action): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'act'
  b.textContent = a.label
  if (a.title !== undefined) b.title = a.title
  b.disabled = a.disabled ?? false
  b.addEventListener('click', (e) => {
    // the actions sit inside the <summary>, where a click would otherwise
    // toggle the row open on its way past
    e.preventDefault()
    e.stopPropagation()
    a.run()
  })
  return b
}

function chooser(spec: NonNullable<RowSpec['choose']>): HTMLSelectElement {
  const sel = document.createElement('select')
  sel.className = 'act'

  // a slot holding something the list cannot name still has to show what it
  // holds, so an unmatched `current` gets an entry of its own rather than
  // silently selecting the first option and misreporting the machine
  if (!spec.options.some((o) => o.id === spec.current)) {
    const unknown = document.createElement('option')
    unknown.value = ''
    unknown.textContent = spec.current === '' ? '—' : spec.current
    sel.appendChild(unknown)
  }

  for (const o of spec.options) {
    const opt = document.createElement('option')
    opt.value = o.id
    opt.textContent = o.label
    opt.selected = o.id === spec.current
    sel.appendChild(opt)
  }

  // the control sits inside the <summary>, where any click toggles the row
  sel.addEventListener('click', (e) => e.stopPropagation())
  sel.addEventListener('keydown', (e) => e.stopPropagation())
  sel.addEventListener('change', () => {
    spec.options.find((o) => o.id === sel.value)?.run()
  })
  return sel
}

export function createList(host: HTMLElement): List {
  host.classList.add('list')
  const open = new Set<string>()

  return {
    render(rows) {
      // an open row that no longer exists stops being remembered here, so the
      // set cannot grow forever on a page that runs for hours
      const keys = new Set(rows.map((r) => r.key))
      for (const k of [...open]) if (!keys.has(k)) open.delete(k)

      host.textContent = ''
      for (const row of rows) {
        const item = document.createElement('details')
        item.className = 'item'
        item.open = open.has(row.key)
        item.addEventListener('toggle', () => {
          if (item.open) open.add(row.key)
          else open.delete(row.key)
        })

        const summary = document.createElement('summary')

        const caret = document.createElement('span')
        caret.className = 'caret'
        // a row with nothing to show keeps the column so the labels stay in
        // line, and says so by leaving the caret off
        caret.textContent = row.body ? '▶' : ''
        summary.appendChild(caret)

        const icon = document.createElement('span')
        icon.className = 'item-icon'
        icon.textContent = row.icon ?? ''
        // the glyph is a picture of the label, so it is not read out twice
        icon.setAttribute('aria-hidden', 'true')
        summary.appendChild(icon)

        const label = document.createElement('span')
        label.className = 'item-label'
        label.textContent = row.label
        summary.appendChild(label)

        const detail = document.createElement('span')
        detail.className = row.empty ? 'item-detail empty' : 'item-detail'
        detail.textContent = row.detail ?? ''
        summary.appendChild(detail)

        const chip = document.createElement('span')
        if (row.chip) {
          chip.className = `chip ${row.chip.tone ?? 'none'}`
          chip.textContent = row.chip.text
        }
        summary.appendChild(chip)

        const actions = document.createElement('span')
        actions.className = 'item-actions'
        for (const a of row.actions ?? []) actions.appendChild(button(a))
        if (row.choose && row.choose.options.length > 0) actions.appendChild(chooser(row.choose))
        summary.appendChild(actions)

        item.appendChild(summary)

        if (row.body) {
          const body = document.createElement('div')
          body.className = 'item-body'
          row.body(body)
          item.appendChild(body)
        } else {
          // no body means no disclosure: without this the row still opens, to
          // reveal nothing
          summary.addEventListener('click', (e) => e.preventDefault())
        }

        host.appendChild(item)
      }
    },
  }
}

/**
 * Name and value pairs, for the part of a body that is plain fact.
 *
 * Every panel has some of this — which line a drive answers, what version a
 * library opens at — and it is the half that needs no controls.
 */
export function facts(pairs: readonly (readonly [string, string])[]): HTMLElement {
  const dl = document.createElement('dl')
  dl.className = 'facts'
  for (const [name, value] of pairs) {
    const dt = document.createElement('dt')
    dt.textContent = name
    const dd = document.createElement('dd')
    dd.textContent = value
    dl.append(dt, dd)
  }
  return dl
}
