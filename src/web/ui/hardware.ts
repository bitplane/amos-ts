/**
 * The hardware tab: what is plugged into the machine.
 *
 * Every row comes out of `machine.hardware()` and nothing here names a
 * connector. That is the point of the slot list being a view rather than a
 * registry: a connector added to the model becomes a row without this file
 * being edited, and a row can never describe a machine that is not there.
 *
 * `Slot.fixed` decides whether the row gets a detach button, so the page
 * leaves the control off rather than offering one and being refused.
 */
import type { Machine } from '../../amiga/machine'
import type { Slot } from '../../amiga/device'
import { FloppyDrive } from '../../amiga/trackdisk'
import { createList, facts, stub, type Action, type List, type RowSpec } from './list'
import { BINDINGS, fittings, iconFor, sourceLabel } from './catalogue'
import type { JoyKeys } from '../player'

/**
 * What drives a gameport, which the page owns rather than the machine.
 *
 * A key mapping is the host standing in for a stick nobody has plugged into
 * their computer. `Machine` knows about controllers and not about keyboards
 * being pressed into service as one, which is why this is an interface the
 * page passes in rather than something read off the slot.
 */
export interface JoyHost {
  keys(port: 0 | 1): JoyKeys
  setKeys(port: 0 | 1, keys: JoyKeys): void
}

/** which gameport a slot is, or null for the mouse's own fixed one */
const portOf = (slot: Slot): 0 | 1 | null =>
  slot.id === 'port0' ? 0 : slot.id === 'port1' ? 1 : null

/** the drive in a slot, or null: the only device with live state to show yet */
const driveIn = (slot: Slot): FloppyDrive | null =>
  slot.device instanceof FloppyDrive ? slot.device : null

/**
 * What the row says in its second column.
 *
 * A drive answers with its disk rather than with "floppy drive", because the
 * slot label already says DF0: and the disk is the part that changes. That is
 * the two-node split `dosextens.i` draws: the DEVICE node never goes away and
 * the VOLUME node comes and goes.
 */
function detailOf(joy: JoyHost, slot: Slot): { text: string; empty: boolean } {
  const drive = driveIn(slot)
  if (drive) {
    const disk = drive.medium
    return disk ? { text: `${disk.label}:`, empty: false } : { text: 'no disk', empty: true }
  }
  if (!slot.device) return { text: 'empty socket', empty: true }

  // a stick says what moves it, because that is the part a player has to know
  // and the alternative is expanding the row to find out
  const port = portOf(slot)
  if (port !== null) {
    return { text: `${slot.device.name}, ${sourceLabel(joy.keys(port))}`, empty: false }
  }
  return { text: slot.device.name, empty: false }
}

/** one chip per row, most urgent first */
function chipOf(slot: Slot): RowSpec['chip'] {
  const drive = driveIn(slot)
  if (drive?.motorOn) return { text: 'motor', tone: 'on' }
  if (drive?.medium && drive.writeProtected) return { text: 'protected', tone: 'warn' }
  if (slot.fixed) return { text: 'fixed', tone: 'fixed' }
  return undefined
}

/** a labelled picker for the body, which is a different shape from a row's */
function picker(label: string, options: readonly { value: string; label: string }[], current: string, pick: (v: string) => void): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'field'
  const name = document.createElement('span')
  name.textContent = label
  const sel = document.createElement('select')
  sel.className = 'act'
  for (const o of options) {
    const opt = document.createElement('option')
    opt.value = o.value
    opt.textContent = o.label
    opt.selected = o.value === current
    sel.appendChild(opt)
  }
  sel.addEventListener('change', () => pick(sel.value))
  wrap.append(name, sel)
  return wrap
}

function bodyOf(machine: Machine, joy: JoyHost, slot: Slot): (host: HTMLElement) => void {
  return (host) => {
    const pairs: [string, string][] = [
      ['slot', slot.id],
      ['takes', slot.takes],
    ]
    const drive = driveIn(slot)
    if (drive) {
      // the unit is which /SELn line the drive answers, cia.i:133-136
      pairs.push(
        ['unit', `/SEL${drive.unit}`],
        ['cylinder', String(drive.cylinder)],
        ['motor', drive.motorOn ? 'spinning' : 'stopped'],
        ['disk changes', String(drive.changes)],
      )
    }
    host.appendChild(facts(pairs))

    // the layout, not the source: a gamepad-driven port has no keys to show,
    // and changing which device is in the socket is the row's own drop-down
    const port = portOf(slot)
    if (port !== null && slot.device && joy.keys(port) !== 'none') {
      host.appendChild(
        picker('keys', BINDINGS, String(joy.keys(port)), (v) => joy.setKeys(port, v as JoyKeys)),
      )
    }

    stub(
      slot.fixed
        ? 'This connector cannot be emptied. Controls for what is on it are still to come.'
        : 'Controls and tests for this connector are still to come.',
    )(host)
    void machine
  }
}

/**
 * The two verbs, which are about different things.
 *
 * EJECT takes the disk out and leaves the drive, which is what a person did to
 * a real machine every day. DETACH takes the drive off its /SELn line, which is
 * opening the case. Both exist because both are real, and the everyday one is
 * listed first.
 */
function actionsFor(machine: Machine, joy: JoyHost, slot: Slot): Action[] {
  const out: Action[] = []
  const drive = driveIn(slot)
  if (drive?.medium) {
    out.push({ label: 'eject', title: 'take the disk out, leaving the drive', run: () => drive.eject() })
  }
  if (!slot.fixed && slot.device) {
    out.push({
      label: 'detach',
      title: 'unplug the device, leaving the connector',
      run: () => {
        machine.detach(slot.id)
        // an unplugged port must give the keys back, or it goes on eating
        // keystrokes a program is also reading and nothing on screen says why
        const port = portOf(slot)
        if (port !== null) joy.setKeys(port, 'none')
      },
    })
  }
  return out
}

function rowFor(machine: Machine, joy: JoyHost, slot: Slot): RowSpec {
  const detail = detailOf(joy, slot)
  const chip = chipOf(slot)
  const port = portOf(slot)
  // an occupied socket has nothing to offer: a swap is detach then attach, so
  // the two states never both show a drop-down
  const options = slot.device
    ? []
    : fittings(slot).map((f) => ({
        label: f.label,
        run: () => {
          if (!machine.attach(slot.id, f.make())) return
          if (port !== null && f.keys !== undefined) joy.setKeys(port, f.keys)
        },
      }))
  return {
    key: slot.id,
    icon: iconFor(slot),
    label: slot.label,
    detail: detail.text,
    empty: detail.empty,
    ...(chip ? { chip } : {}),
    actions: actionsFor(machine, joy, slot),
    ...(options.length > 0 ? { choose: { placeholder: 'attach…', options } } : {}),
    body: bodyOf(machine, joy, slot),
  }
}

/**
 * A cheap description of everything the rows show.
 *
 * The list redraws from the model, and doing that fifty times a second would
 * rebuild the DOM under the pointer and throw away focus. Comparing this
 * instead means a rebuild happens when something actually moved.
 */
function signature(machine: Machine, joy: JoyHost): string {
  return machine
    .hardware()
    .map((slot) => {
      const drive = driveIn(slot)
      const live = drive
        ? `${drive.medium?.label ?? ''}|${drive.motorOn}|${drive.writeProtected}|${drive.cylinder}|${drive.changes}`
        : ''
      const port = portOf(slot)
      const keys = port === null ? '' : String(joy.keys(port))
      return `${slot.id}:${slot.device?.name ?? ''}:${live}:${keys}`
    })
    .join(';')
}

export interface HardwareTab {
  panel: HTMLElement
  frame(): void
}

export function createHardwareTab(machine: Machine, joy: JoyHost): HardwareTab {
  const panel = document.createElement('div')

  const intro = document.createElement('p')
  intro.className = 'panel-intro'
  intro.textContent =
    'Every connector the machine has, whether or not anything is in it. An empty socket is a socket, not a missing feature.'
  panel.appendChild(intro)

  const listHost = document.createElement('div')
  panel.appendChild(listHost)
  const list: List = createList(listHost)

  let last = ''
  const draw = (): void => {
    const now = signature(machine, joy)
    if (now === last) return
    last = now
    list.render(machine.hardware().map((slot) => rowFor(machine, joy, slot)))
  }

  draw()
  return { panel, frame: draw }
}
