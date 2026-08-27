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

export interface StripOptions {
  /** what a click on the power light does */
  onReset(): void
  /**
   * Is a program still going?
   *
   * A finished program looks exactly like a running one that is drawing
   * nothing: the canvas keeps its last frame and the loop keeps turning. This
   * is the only thing on the page that can tell the two apart.
   */
  isRunning(): boolean
  /** which program is loaded, shown so a transient status cannot lose it */
  programName(): string
  /**
   * Stopped where it stands.
   *
   * The control has to be here as well as on the player: the machine keeps
   * running while you are looking at the filesystem, and that is the tab you
   * are on when you want it to stop.
   */
  isPaused(): boolean
  setPaused(on: boolean): void
}

export function createStrip(machine: Machine, opts: StripOptions): Strip {
  const root = document.createElement('div')
  root.id = 'strip'

  // the power light is the reset, because on the machine it was: the button
  // beside it did this and the light is what told you it had happened
  const power = document.createElement('button')
  power.className = 'led power'
  power.type = 'button'
  power.textContent = 'power'
  power.title = 'reset the machine'
  power.addEventListener('click', opts.onReset)
  root.appendChild(power)

  // Not a light. The power light is one because the machine had one; nothing
  // on an A500 stops the CPU where it stands, so this is a button and looks
  // like the buttons on the panels rather than like the hardware.
  const pause = document.createElement('button')
  pause.className = 'act'
  pause.type = 'button'
  pause.addEventListener('click', () => opts.setPaused(!opts.isPaused()))
  root.appendChild(pause)

  const name = document.createElement('span')
  name.id = 'progname'
  root.appendChild(name)

  const run = document.createElement('span')
  run.className = 'chip'
  root.appendChild(run)

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
    const prog = opts.programName()
    if (name.textContent !== prog) name.textContent = prog

    const held = opts.isPaused()
    const wants = held ? 'resume' : 'pause'
    if (pause.textContent !== wants) {
      pause.textContent = wants
      pause.title = held ? 'start the machine again' : 'stop the machine where it is'
    }

    // Three states, not two. A paused machine is running a program that is
    // going nowhere, and reporting that as "running" is the same lie the
    // chip was added to stop: it looks identical on the canvas either way.
    const going = opts.isRunning()
    const say = held ? 'paused' : going ? 'running' : 'stopped'
    if (run.textContent !== say) {
      run.textContent = say
      run.className = say === 'running' ? 'chip on' : 'chip warn'
    }
    for (const [unit, el] of lights.entries()) {
      const drive = machine.drives[unit] ?? null
      el.classList.toggle('absent', drive === null)
      el.classList.toggle('lit', drive?.motorOn === true)
    }
  }

  frame()
  return { root, status, frame }
}
