/**
 * The hardware tab: what is plugged into the machine.
 *
 * Every row comes out of `machine.hardware()` and nothing here names a
 * connector. That is the point of the slot list being a view rather than a
 * registry: a connector added to the model becomes a row without this file
 * being edited, and a row can never describe a machine that is not there.
 *
 * Each row is one drop-down of everything that could be in that connector,
 * with "nothing" among them where the socket can be emptied. Attach, detach
 * and a greyed-out button were three spellings of that one control.
 */
import type { Machine } from '../../amiga/machine'
import type { Slot } from '../../amiga/device'
import { CTRL_GAMEPAD, CTRL_JOYSTICK, Controller } from '../../amiga/controller'
import { FloppyDrive } from '../../amiga/trackdisk'
import { createList, facts, type Action, type Choice, type List, type RowSpec } from './list'
import { BINDINGS, NOTHING, currentFitting, fittings, iconFor, keysLabel } from './catalogue'
import type { InputSource } from './catalogue'
import type { JoyKeys } from '../player'
import type { AmigaAudioModel } from '../../amiga/mixer'
import { LED_FILTER_HZ, FIXED_FILTER_HZ } from '../../amiga/mixer'
import { Cpu } from '../../amiga/cpu'
import { PaulaAudio } from '../../amiga/audio'
import { BattClock } from '../../amiga/battclock'

/**
 * The half of a connector that belongs to the browser, not to the machine.
 *
 * A key mapping is the host standing in for a stick nobody has plugged into
 * their computer, and a granted Web Serial port is the host lending out real
 * hardware. `Machine` knows about controllers and cables and nothing about
 * either, which is why this is an interface the page passes in rather than
 * something read off the slot.
 */
export interface PageHost {
  keys(port: 0 | 1): JoyKeys
  setKeys(port: 0 | 1, keys: JoyKeys): void
  /** everything that could drive a gameport right now, pads included by name */
  sources(): InputSource[]
  /** which of them is driving this port, by `InputSource.id` */
  sourceOf(port: 0 | 1): string
  setSource(port: 0 | 1, source: InputSource): void
  serialSupported: boolean
  /** ask for a port; a grant attaches it, so this does not return a device */
  requestSerial(): void
  /** the CPU's ignore-clock mode, which the frame loop also has to hear about */
  setIgnoreClock(on: boolean): void
  setAudioModel(model: AmigaAudioModel): void
  /** the battery clock's wall time, which is its own and drifts from the host's */
  clockTime(): Date | null
  setClockTime(when: Date): void
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
function detailOf(host: PageHost, slot: Slot): { text: string; empty: boolean } {
  const drive = driveIn(slot)
  if (drive) {
    const disk = drive.medium
    return disk ? { text: `${disk.label}:`, empty: false } : { text: 'no disk', empty: true }
  }
  if (!slot.device) return { text: 'empty socket', empty: true }

  // a stick says what moves it, because that is the part a player has to know
  // and the alternative is expanding the row to find out
  const port = portOf(slot)
  if (port !== null && slot.device.name !== 'mouse') {
    const id = host.sourceOf(port)
    const src = host.sources().find((s) => s.id === id)
    const driver = src ? src.label : 'nothing to drive it'
    const how = host.keys(port) === 'none' ? driver : `${driver}, ${keysLabel(host.keys(port))}`
    return { text: `${slot.device.name}, ${how}`, empty: false }
  }
  return { text: slot.device.name, empty: false }
}

/**
 * One chip per row, most urgent first.
 *
 * No "fixed" chip any more: a socket that cannot be emptied says so by having
 * no "nothing" in its drop-down, and a label repeating it was one place too
 * many for the same fact.
 */
function chipOf(slot: Slot): RowSpec['chip'] {
  const drive = driveIn(slot)
  if (drive?.motorOn) return { text: 'motor', tone: 'on' }
  if (drive?.medium && drive.writeProtected) return { text: 'protected', tone: 'warn' }
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

/**
 * A datetime-local field, for the one device that keeps its own time.
 *
 * `datetime-local` because a battery clock has no zone: it is wall time, the
 * same thing a DateStamp is, and offering a zone picker would invent a concept
 * the chip does not have.
 */
function whenField(label: string, when: Date, set: (d: Date) => void): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'field'
  const name = document.createElement('span')
  name.textContent = label
  const input = document.createElement('input')
  input.type = 'datetime-local'
  input.step = '1'
  input.className = 'act'
  // the control takes local wall time and the chip holds UTC wall time, so the
  // string is built by hand rather than through toISOString, which would shift
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  input.value =
    `${p(when.getUTCFullYear(), 4)}-${p(when.getUTCMonth() + 1)}-${p(when.getUTCDate())}` +
    `T${p(when.getUTCHours())}:${p(when.getUTCMinutes())}:${p(when.getUTCSeconds())}`
  input.addEventListener('change', () => {
    const parsed = new Date(`${input.value}Z`)
    if (!Number.isNaN(parsed.getTime())) set(parsed)
  })
  wrap.append(name, input)
  return wrap
}

/** a labelled checkbox for the body */
function toggle(label: string, on: boolean, hint: string, set: (v: boolean) => void): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'field'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = on
  box.addEventListener('change', () => set(box.checked))
  const name = document.createElement('span')
  name.textContent = label
  const why = document.createElement('span')
  why.className = 'field-hint'
  why.textContent = hint
  wrap.append(box, name, why)
  return wrap
}

function bodyOf(machine: Machine, host: PageHost, slot: Slot): (body: HTMLElement) => void {
  return (body) => {
    // what it IS, before any of the numbers. `slot` and `takes` used to be the
    // first two rows here and they are facts about this code rather than about
    // the machine: a reader looking at "battery clock" already knows.
    if (slot.device) {
      const about = document.createElement('p')
      about.className = 'about'
      about.textContent = slot.device.description
      body.appendChild(about)
    }

    const pairs: [string, string][] = []
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
    const cpu = slot.device instanceof Cpu ? slot.device : null
    if (cpu) {
      // a rate to print and nothing that counts cycles: see ../../amiga/cpu.ts
      pairs.push(['clock', `${(cpu.hz / 1_000_000).toFixed(5)} MHz`], ['executes', 'nothing'])
    }
    if (slot.device instanceof PaulaAudio) {
      pairs.push(
        ['voices', '4'],
        ['led filter', `${LED_FILTER_HZ} Hz, CIA-A PRA bit 1`],
        ['fixed filter', `${FIXED_FILTER_HZ[slot.device.model]} Hz, no switch`],
      )
    }
    if (pairs.length > 0) body.appendChild(facts(pairs))

    if (cpu) {
      body.appendChild(
        toggle('ignore clock', cpu.ignoreClock, 'run flat out instead of at 50Hz', (v) =>
          host.setIgnoreClock(v),
        ),
      )
    }
    if (slot.device instanceof PaulaAudio) {
      body.appendChild(
        toggle(
          'led filter',
          machine.cia.ledBright,
          'CIA-A PRA bit 1, the same bit that dims the power light',
          (v) => {
            machine.cia.ledBright = v
          },
        ),
      )
    }
    if (slot.takes === 'clock' && slot.device) {
      const when = host.clockTime()
      if (when) {
        body.appendChild(whenField('reads', when, (d) => host.setClockTime(d)))
      }
    }

    // A CD32 pad is a two-button stick until a program clocks its extra
    // buttons out through the shift register on pin 5, so this is a fact about
    // the hardware rather than a permission: tick it and `ReadJoyPort` answers
    // JP_TYPE_GAMECTLR and lets all seven through, leave it and `lowlevel.ts`
    // masks the port down to red and blue, which are the only two a nine-pin
    // connector has lines for.
    const ctrl = slot.device instanceof Controller ? slot.device : null
    if (ctrl && (ctrl.type === CTRL_JOYSTICK || ctrl.type === CTRL_GAMEPAD)) {
      body.appendChild(
        toggle('cd32 pad', ctrl.type === CTRL_GAMEPAD, 'seven buttons instead of two', (v) => {
          ctrl.type = v ? CTRL_GAMEPAD : CTRL_JOYSTICK
        }),
      )
    }

    // the layout, not the source: a gamepad-driven port has no keys to show,
    // and changing which device is in the socket is the row's own drop-down
    const port = portOf(slot)
    if (port !== null && slot.device && host.keys(port) !== 'none') {
      body.appendChild(
        picker('keys', BINDINGS, String(host.keys(port)), (v) => host.setKeys(port, v as JoyKeys)),
      )
    }

  }
}

/**
 * Eject, which is the only verb left beside the drop-down.
 *
 * It survives because it is about the MEDIUM and the drop-down is about the
 * DEVICE. Taking a disk out is what a person did to a real machine every day;
 * taking the drive off its /SELn line is opening the case. A drive with a disk
 * in it can do both, and they mean different things.
 */
function actionsFor(slot: Slot): Action[] {
  const drive = driveIn(slot)
  return drive?.medium
    ? [{ label: 'eject', title: 'take the disk out, leaving the drive', run: () => drive.eject() }]
    : []
}

/**
 * The drop-down, which used to be attach and detach and a `fixed` flag.
 *
 * Emptying a socket is choosing "nothing", so a socket that cannot be emptied
 * is simply one whose list has no "nothing" in it. The page stops branching on
 * `Slot.fixed` and the machine keeps it, because it still has to refuse.
 */
function chooseFor(machine: Machine, host: PageHost, slot: Slot): RowSpec['choose'] {
  const port = portOf(slot)
  const options: Choice[] = fittings(slot, {
    serialSupported: host.serialSupported,
    sources: host.sources(),
  }).map((f) => ({
    id: f.id,
    label: f.label,
    run: () => {
      // Web Serial's chooser needs the gesture that just happened, and a
      // grant is what attaches the cable, so this one does not attach here
      if (f.hostSerial) {
        host.requestSerial()
        return
      }
      // the mixer is the host's, and setting the model is what changes the
      // device's own name, so this replaces the attach rather than following it
      if (f.audioModel) {
        host.setAudioModel(f.audioModel)
        return
      }
      if (!machine.attach(slot.id, f.make())) return
      if (port !== null && f.source) host.setSource(port, f.source)
    },
  }))
  if (options.length === 0) return undefined
  if (!slot.fixed) {
    options.push({
      id: NOTHING,
      label: 'nothing',
      run: () => {
        machine.detach(slot.id)
        // an unplugged port has to give the keys back, or it goes on eating
        // keystrokes a program is also reading with nothing on screen to say why
        if (port !== null) host.setKeys(port, 'none')
      },
    })
  }
  return { current: currentFitting(slot, port === null ? '' : host.sourceOf(port)), options }
}

function rowFor(machine: Machine, host: PageHost, slot: Slot): RowSpec {
  const detail = detailOf(host, slot)
  const chip = chipOf(slot)
  const choose = chooseFor(machine, host, slot)
  return {
    key: slot.id,
    icon: iconFor(slot),
    label: slot.label,
    detail: detail.text,
    empty: detail.empty,
    ...(chip ? { chip } : {}),
    actions: actionsFor(slot),
    ...(choose ? { choose } : {}),
    body: bodyOf(machine, host, slot),
  }
}

/**
 * A cheap description of everything the rows show.
 *
 * The list redraws from the model, and doing that fifty times a second would
 * rebuild the DOM under the pointer and throw away focus. Comparing this
 * instead means a rebuild happens when something actually moved.
 */
function signature(machine: Machine, host: PageHost): string {
  return machine
    .hardware()
    .map((slot) => {
      const drive = driveIn(slot)
      const live = drive
        ? `${drive.medium?.label ?? ''}|${drive.motorOn}|${drive.writeProtected}|${drive.cylinder}|${drive.changes}`
        : ''
      const port = portOf(slot)
      const keys = port === null ? '' : `${String(host.keys(port))}|${host.sourceOf(port)}`
      const dev = slot.device
      const extra =
        dev instanceof Controller
          ? String(dev.type)
          : dev instanceof Cpu
          ? String(dev.ignoreClock)
          : dev instanceof PaulaAudio
            ? dev.model
            : dev instanceof BattClock
              ? String(dev.skewMs)
              : ''
      const led = dev instanceof PaulaAudio ? String(machine.cia.ledBright) : ''
      return `${slot.id}:${dev?.name ?? ''}:${live}:${keys}:${extra}:${led}`
    })
    .join(';')
}

export interface HardwareTab {
  panel: HTMLElement
  frame(): void
}

export function createHardwareTab(machine: Machine, host: PageHost): HardwareTab {
  const panel = document.createElement('div')

  const intro = document.createElement('p')
  intro.className = 'panel-intro'
  intro.textContent =
    'Use the drop-downs to select components, expand sections to configure it.'
  panel.appendChild(intro)

  const listHost = document.createElement('div')
  panel.appendChild(listHost)
  const list: List = createList(listHost)

  let last = ''
  const draw = (): void => {
    const now = signature(machine, host)
    if (now === last) return
    last = now
    list.render(machine.hardware().map((slot) => rowFor(machine, host, slot)))
  }

  draw()
  return { panel, frame: draw }
}
