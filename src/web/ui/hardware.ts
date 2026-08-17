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
function detailOf(slot: Slot): { text: string; empty: boolean } {
  const drive = driveIn(slot)
  if (drive) {
    const disk = drive.medium
    return disk ? { text: `${disk.label}:`, empty: false } : { text: 'no disk', empty: true }
  }
  return slot.device
    ? { text: slot.device.name, empty: false }
    : { text: 'empty socket', empty: true }
}

/** one chip per row, most urgent first */
function chipOf(slot: Slot): RowSpec['chip'] {
  const drive = driveIn(slot)
  if (drive?.motorOn) return { text: 'motor', tone: 'on' }
  if (drive?.medium && drive.writeProtected) return { text: 'protected', tone: 'warn' }
  if (slot.fixed) return { text: 'fixed', tone: 'fixed' }
  return undefined
}

function bodyOf(machine: Machine, slot: Slot): (host: HTMLElement) => void {
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
    stub(
      slot.fixed
        ? 'This connector cannot be emptied. Controls for what is on it are still to come.'
        : 'Controls and tests for this connector are still to come.',
    )(host)
    void machine
  }
}

function rowFor(machine: Machine, slot: Slot): RowSpec {
  const detail = detailOf(slot)
  const drive = driveIn(slot)
  const actions: Action[] = []
  if (drive?.medium) {
    actions.push({ label: 'eject', title: 'take the disk out, leaving the drive', run: () => drive.eject() })
  }
  if (!slot.fixed && slot.device) {
    actions.push({
      label: 'detach',
      title: 'unplug the device, leaving the connector',
      run: () => void machine.detach(slot.id),
    })
  }
  const chip = chipOf(slot)
  return {
    key: slot.id,
    label: slot.label,
    detail: detail.text,
    empty: detail.empty,
    ...(chip ? { chip } : {}),
    actions,
    body: bodyOf(machine, slot),
  }
}

/**
 * A cheap description of everything the rows show.
 *
 * The list redraws from the model, and doing that fifty times a second would
 * rebuild the DOM under the pointer and throw away focus. Comparing this
 * instead means a rebuild happens when something actually moved.
 */
function signature(machine: Machine): string {
  return machine
    .hardware()
    .map((slot) => {
      const drive = driveIn(slot)
      const live = drive
        ? `${drive.medium?.label ?? ''}|${drive.motorOn}|${drive.writeProtected}|${drive.cylinder}|${drive.changes}`
        : ''
      return `${slot.id}:${slot.device?.name ?? ''}:${live}`
    })
    .join(';')
}

export interface HardwareTab {
  panel: HTMLElement
  frame(): void
}

export function createHardwareTab(machine: Machine): HardwareTab {
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
    const now = signature(machine)
    if (now === last) return
    last = now
    list.render(machine.hardware().map((slot) => rowFor(machine, slot)))
  }

  draw()
  return { panel, frame: draw }
}
