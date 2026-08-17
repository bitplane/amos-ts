/**
 * The machine strip, which stays visible on every tab.
 *
 * The machine keeps running while you are looking at the filesystem or the
 * libraries, so something has to keep reporting on it. The drive lights are
 * `FloppyDrive.motorOn`, which CIA-B's select latch sets when a write to
 * $bfd100 pulls a unit's /SELn low, so they follow the register rather than
 * one extension's private idea of what the drives are doing.
 *
 * A unit with no drive on its line is drawn faint rather than dark: nothing
 * fitted and fitted-but-idle are different states, and `Drive State` answers
 * differently for them.
 */
import type { Machine } from '../../amiga/machine'
import { driveName } from '../../amiga/trackdisk'

export interface Strip {
  root: HTMLElement
  status: HTMLElement
  frame(): void
}

function led(label: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'led'
  el.textContent = label
  return el
}

export function createStrip(machine: Machine): Strip {
  const root = document.createElement('div')
  root.id = 'strip'

  const power = led('power')
  root.appendChild(power)

  const lights = machine.drives.map((_, unit) => {
    const el = led(driveName(unit))
    root.appendChild(el)
    return el
  })

  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  root.appendChild(spacer)

  const status = document.createElement('span')
  status.id = 'status'
  root.appendChild(status)

  const frame = (): void => {
    power.classList.toggle('lit', machine.power === 'on')
    for (const [unit, el] of lights.entries()) {
      const drive = machine.drives[unit] ?? null
      el.classList.toggle('absent', drive === null)
      el.classList.toggle('lit', drive?.motorOn === true)
    }
  }

  frame()
  return { root, status, frame }
}
