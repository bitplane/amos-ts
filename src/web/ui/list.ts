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

export interface RowSpec {
  /** stable across redraws: it is what remembers the row was open */
  key: string
  label: string
  /** the second column: what is in the slot, or what the library answers */
  detail?: string
  /** the detail describes an empty socket rather than a thing */
  empty?: boolean
  chip?: { text: string; tone?: Tone }
  actions?: readonly Action[]
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

/** a body that admits it is not built yet, rather than looking broken */
export function stub(text: string): (host: HTMLElement) => void {
  return (host) => {
    const p = document.createElement('p')
    p.className = 'stub'
    p.textContent = text
    host.appendChild(p)
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
